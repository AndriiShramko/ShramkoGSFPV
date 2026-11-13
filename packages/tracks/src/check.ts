// The proof that a course can be flown on real walls (moved here from tools/bench/src/sonic-track-check.ts in train 1, lane
// tracks, stage T1, so the course generator and the simulator can run it; the bench file re-exports it unchanged).
// A track is a chain of gates in the scan frame, seen as the flight sees it: through the scene transform T(p) = s * p + t,
// against the voxel walls at the flown size (transformCollision), with the flight model's own overlap and sweep tests
// (sphereOverlaps, VoxelContactWorld.sweepOne: a swept sphere is proven free by its inflated cover).
// Proven for a margin (default 0.5 m): the start is free; every opening and frame swept by a sphere of the margin touches no
// wall; the legs start, gate 1, gate 2, ... the same; the straight run through each gate (up to 3 m each side) the same; every
// gate's axis is within 35 degrees of the leg in. Measured, not proven: the free radius at the start, over each opening and
// frame and every 0.25 m along each leg.
// This module is a proof, not a generator: it may use trigonometry (the ring outline); the generator's own files do not.
import { quatRotate, trackToObjects } from '@shramko/sonic-fpv';
import type { SonicObject, TrackFile, Vec3 } from '@shramko/sonic-fpv';
import { VoxelContactWorld, sphereOverlaps, transformCollision } from '@gsfpv/collision';
import type { VoxelCollision } from '@gsfpv/collision';

/** The plan's margin: openings and legs are clear by this much, flown metres. */
export const MARGIN_M = 0.5;
/** A gate's axis is within this of the leg in, degrees. */
export const AXIS_TOLERANCE_DEG = 35;
/** The straight run through a gate along its axis, at most this far each side, m. */
export const APPROACH_M = 3;
/** The free radius is looked for up to this (m); a clearance above it is reported as the cap. */
export const CAP_M = 6;
/** The free radius is measured every this far along a leg, m. */
export const PROBE_STEP_M = 0.25;
/** The craft's speed cap in the lesson (free-garden's assists), m/s: for the flight time estimate only. */
export const LESSON_SPEED_MPS = 5;

const DEG = Math.PI / 180;
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3): Vec3 => mul(a, 1 / (len(a) || 1));
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const r3 = (n: number): number => Math.round(n * 1000) / 1000;
const v3 = (a: Vec3): Vec3 => [r3(a[0]), r3(a[1]), r3(a[2])];
const angleDeg = (a: Vec3, b: Vec3): number => Math.acos(Math.max(-1, Math.min(1, dot(unit(a), unit(b))))) / DEG;

/** `p` (in the frame `col` is queried in) lies inside the walls' voxel grid; a flipped grid is queried at (-x, -y, z). */
export function insideGrid(col: VoxelCollision, p: Vec3): boolean {
    const f = col.flipXY ? -1 : 1;
    const q = [f * p[0], f * p[1], p[2]];
    const min = [col.gridMinX, col.gridMinY, col.gridMinZ];
    const n = [col.numVoxelsX, col.numVoxelsY, col.numVoxelsZ];
    for (let i = 0; i < 3; i++) {
        const lo = min[i]!, hi = lo + n[i]! * col.voxelResolution;
        if (!(q[i]! >= lo && q[i]! <= hi)) return false;
    }
    return true;
}

/** The walls as the session flies them: the scan's octree under T(p) = s * p + t. */
export function flownCollision(base: VoxelCollision, transform: readonly [number, number, number, number]): VoxelCollision {
    return transformCollision(base, transform[0], [transform[1], transform[2], transform[3]]);
}

/**
 * The largest radius, up to `cap`, of a sphere at `p` that touches no wall (the flight's own overlap test: doubling, then
 * bisection to a millimetre, so the cost follows the free radius and not the cap). 0 inside a wall.
 */
export function freeRadius(col: VoxelCollision, p: Vec3, cap = CAP_M): number {
    if (sphereOverlaps(col, p[0], p[1], p[2], 0.002)) return 0;
    let lo = 0.002;
    let hi = 0.25;
    while (hi < cap && !sphereOverlaps(col, p[0], p[1], p[2], hi)) {
        lo = hi;
        hi *= 2;
    }
    if (hi >= cap) {
        if (!sphereOverlaps(col, p[0], p[1], p[2], cap)) return cap;
        hi = cap;
    }
    for (let i = 0; i < 12; i++) {
        const m = (lo + hi) / 2;
        if (sphereOverlaps(col, p[0], p[1], p[2], m)) hi = m;
        else lo = m;
    }
    return lo;
}

export interface Sweeper {
    /** true when a sphere of radius r swept from a to b touches no wall */
    free(a: Vec3, b: Vec3, r: number): boolean;
}

export function sweeperOf(col: VoxelCollision): Sweeper {
    const w = new VoxelContactWorld(col);
    return { free: (a, b, r) => w.sweepOne(a[0], a[1], a[2], b[0], b[1], b[2], r) < 0 };
}

/** The axes of a gate in the flown world: x and y across the opening, z behind it (the craft crosses toward -z). */
export function frame(g: SonicObject): { ex: Vec3; ey: Vec3; ez: Vec3 } {
    return { ex: quatRotate(g.quat, [1, 0, 0]), ey: quatRotate(g.quat, [0, 1, 0]), ez: quatRotate(g.quat, [0, 0, 1]) };
}

/** The shape's outline in the gate's plane, as closed polylines at fractions of its opening, in the flown world; and its frame's line. */
interface Outline {
    /** the opening's rings from the inside out, ending at the opening's edge; the frame's own line last */
    readonly loops: readonly (readonly Vec3[])[];
    /** from the centre to points of the edge */
    readonly spokes: readonly Vec3[];
    /** half size of the opening (ring: radius; square: half side) */
    readonly half: number;
}

const FRACTIONS = [1 / 3, 2 / 3, 1] as const;

export function outlineOf(g: SonicObject): Outline | null {
    const { ex, ey } = frame(g);
    const c = g.pos;
    const at = (x: number, y: number): Vec3 => add(c, add(mul(ex, x), mul(ey, y)));
    const s = g.shape;
    if (s.kind === 'ring') {
        const half = s.diameter / 2;
        const N = 64;
        const circle = (rho: number): Vec3[] => Array.from({ length: N + 1 }, (_, i) => at(rho * Math.cos((2 * Math.PI * i) / N), rho * Math.sin((2 * Math.PI * i) / N)));
        const loops = [...FRACTIONS.map((f) => circle(half * f)), circle(half + s.tube)];
        const spokes = Array.from({ length: 24 }, (_, i) => at((half + s.tube) * Math.cos((2 * Math.PI * i) / 24), (half + s.tube) * Math.sin((2 * Math.PI * i) / 24)));
        return { loops, spokes, half };
    }
    if (s.kind === 'square' || s.kind === 'cube-frame') {
        const half = s.side / 2;
        const rect = (h: number): Vec3[] => [at(-h, -h), at(h, -h), at(h, h), at(-h, h), at(-h, -h)];
        const loops = [...FRACTIONS.map((f) => rect(half * f)), rect(half + s.bar / 2)];
        const spokes = [at(-half, -half), at(half, -half), at(half, half), at(-half, half), at(0, -half), at(half, 0), at(0, half), at(-half, 0)];
        return { loops, spokes, half };
    }
    return null;
}

export interface GateReport {
    readonly id: string;
    readonly index: number;
    /** flown world */
    readonly centre: Vec3;
    readonly diameterM: number | null;
    readonly yawDeg: number;
    /** the opening, its frame and the run through it are clear by the margin */
    readonly clear: boolean;
    /** the free radius, the smallest over the opening, the frame and the run through it, m, and where (flown world) */
    readonly freeM: number;
    readonly freeAt: Vec3;
    readonly axisInDeg: number;
    /** the angle between the axis and the leg out (information: a course may turn back after a gate) */
    readonly axisOutDeg: number;
    /** the course's turn at this gate: the angle between the leg in and the leg out */
    readonly turnDeg: number;
    readonly directionOk: boolean;
}

export interface LegReport {
    readonly from: string;
    readonly to: string;
    readonly lengthM: number;
    readonly clear: boolean;
    /** the smallest free radius sampled along the leg, m, and where (flown world) */
    readonly freeM: number;
    readonly at: Vec3;
}

export interface TrackReport {
    readonly marginM: number;
    readonly ok: boolean;
    readonly startClear: boolean;
    readonly startFreeM: number;
    readonly gates: readonly GateReport[];
    readonly legs: readonly LegReport[];
    readonly pathM: number;
    readonly minGapM: number;
    readonly minFreeM: number;
    readonly issues: readonly string[];
    /** ids ('start' or a gate's) that lie outside the walls' grid: the proof stopped before any sweep (empty otherwise) */
    readonly outside: readonly string[];
}

/** The flown start of a track: its own start, else the first gate's neighbourhood is not guessed (a track needs one). */
export function flownStart(track: TrackFile, transform: readonly [number, number, number, number]): { pos: Vec3; yawDeg: number } | null {
    if (!track.start) return null;
    const [s, tx, ty, tz] = transform;
    const p = track.start.pos;
    return { pos: [s * p[0] + tx, s * p[1] + ty, s * p[2] + tz], yawDeg: track.start.yawDeg };
}

/**
 * The proof, for `track` laid in the scan frame, on `col` (the flown walls: flownCollision) through `transform`, at `marginM`.
 * Pure over the walls: Node tests give it analytic walls and walls the real scan makes. `measure` false skips the free radii
 * (reported as the cap), which only the proof's margin needs when it is searched for (provenMargin).
 */
export function checkTrack(track: TrackFile, col: VoxelCollision, transform: readonly [number, number, number, number], marginM = MARGIN_M, measure = true): TrackReport {
    const gates = trackToObjects(track, { transform });
    const start = flownStart(track, transform);
    // lane review TR-3: outside the walls' grid counts as free to the sweeps, and a gate far out made them run for minutes;
    // a course is proven only inside the grid, and one that leaves it is refused before any sweep
    const out = [...(start ? [{ id: 'start', p: start.pos }] : []), ...gates.map((g) => ({ id: g.id, p: g.pos }))].filter((x) => !insideGrid(col, x.p));
    if (out.length > 0) {
        const issues = out.slice(0, 4).map((x) => `${x.id}: outside the walls' grid`);
        return { marginM, ok: false, startClear: false, startFreeM: 0, gates: [], legs: [], pathM: 0, minGapM: 0, minFreeM: 0, issues, outside: out.map((x) => x.id) };
    }
    const sw = sweeperOf(col);
    const issues: string[] = [];
    if (!start) issues.push('the track has no start pose');
    const startPos: Vec3 = start ? start.pos : gates[0]!.pos;
    const startFreeM = measure ? freeRadius(col, startPos) : sphereOverlaps(col, startPos[0], startPos[1], startPos[2], marginM) ? 0 : CAP_M;
    const startClear = startFreeM >= marginM;
    if (!startClear) issues.push(`start: a sphere of ${marginM} m does not fit (free radius ${r3(startFreeM)} m)`);

    const points: { id: string; p: Vec3 }[] = [{ id: 'start', p: startPos }, ...gates.map((g) => ({ id: g.id, p: g.pos }))];
    const legs: LegReport[] = [];
    let pathM = 0;
    let minGap = Infinity;
    for (let i = 0; i + 1 < points.length; i++) {
        const a = points[i]!;
        const b = points[i + 1]!;
        const length = len(sub(b.p, a.p));
        pathM += length;
        if (i > 0) minGap = Math.min(minGap, length);
        const clear = sw.free(a.p, b.p, marginM);
        let free = CAP_M;
        let at = a.p;
        const n = measure ? Math.max(1, Math.ceil(length / PROBE_STEP_M)) : -1;
        for (let k = 0; k <= n; k++) {
            const p = add(a.p, mul(sub(b.p, a.p), k / n));
            const f = freeRadius(col, p);
            if (f < free) {
                free = f;
                at = p;
            }
        }
        legs.push({ from: a.id, to: b.id, lengthM: r3(length), clear, freeM: r3(free), at: v3(at) });
        if (!clear) issues.push(`leg ${a.id} to ${b.id}: a sphere of ${marginM} m touches a wall (free radius along it ${r3(free)} m at ${v3(at).join(', ')})`);
    }

    const reports: GateReport[] = gates.map((g, i) => {
        const o = outlineOf(g);
        const { ez } = frame(g);
        const axis = mul(ez, -1); // the way the gate is passed
        const prev = points[i]!.p;
        const next = i + 1 < gates.length ? gates[i + 1]!.pos : null;
        const legIn = sub(g.pos, prev);
        const legOut = next ? sub(next, g.pos) : legIn;
        const inDeg = angleDeg(axis, legIn);
        const outDeg = angleDeg(axis, legOut);
        let clear = true;
        let free = CAP_M;
        let freeAt: Vec3 = g.pos;
        const probe = (p: Vec3): void => {
            if (!measure) return;
            const f = freeRadius(col, p);
            if (f < free) {
                free = f;
                freeAt = p;
            }
        };
        if (o) {
            for (const loop of o.loops) for (let k = 0; k + 1 < loop.length; k++) if (!sw.free(loop[k]!, loop[k + 1]!, marginM)) clear = false;
            for (const s of o.spokes) if (!sw.free(g.pos, s, marginM)) clear = false;
            // the free radius over the opening on a 0.25 m grid and along the frame
            const { ex, ey } = frame(g);
            const h = o.half;
            for (let x = -h; x <= h + 1e-9; x += PROBE_STEP_M) {
                for (let y = -h; y <= h + 1e-9; y += PROBE_STEP_M) {
                    if (g.shape.kind === 'ring' && Math.hypot(x, y) > h) continue;
                    probe(add(g.pos, add(mul(ex, x), mul(ey, y))));
                }
            }
            for (const p of o.loops[o.loops.length - 1]!) probe(p);
        } else {
            issues.push(`gate ${g.id}: a ${g.shape.kind} is not a gate shape`);
            clear = false;
        }
        // the run through the gate along its axis
        const run = Math.min(APPROACH_M, 0.4 * Math.min(len(legIn), len(legOut) || len(legIn)));
        const from = add(g.pos, mul(ez, run));
        const to = add(g.pos, mul(axis, run));
        if (!sw.free(from, to, marginM)) clear = false;
        probe(from);
        probe(to);
        const directionOk = inDeg <= AXIS_TOLERANCE_DEG;
        const turnDeg = angleDeg(legIn, legOut);
        if (!clear) issues.push(`gate ${g.id}: the opening, its frame or the run through it is not clear by ${marginM} m (free radius ${r3(free)} m)`);
        if (!directionOk) issues.push(`gate ${g.id}: its axis is ${r3(inDeg)} deg off the leg in (at most ${AXIS_TOLERANCE_DEG}): the leg in does not cross it forward`);
        const yawDeg = Math.atan2(axis[0], -axis[2]) / DEG;
        return { id: g.id, index: i, centre: v3(g.pos), diameterM: g.shape.kind === 'ring' ? r3(g.shape.diameter) : null, yawDeg: r3(yawDeg), clear, freeM: r3(free), freeAt: v3(freeAt), axisInDeg: r3(inDeg), axisOutDeg: r3(outDeg), turnDeg: r3(turnDeg), directionOk };
    });

    const minFree = Math.min(startFreeM, ...legs.map((l) => l.freeM), ...reports.map((g) => g.freeM));
    const ok = issues.length === 0;
    return { marginM, ok, startClear, startFreeM: r3(startFreeM), gates: reports, legs, pathM: r3(pathM), minGapM: r3(Number.isFinite(minGap) ? minGap : 0), minFreeM: r3(minFree), issues, outside: [] };
}

/** The largest margin at which the track still passes (bisection on checkTrack; 0 when it fails even at `lo`). */
export function provenMargin(track: TrackFile, col: VoxelCollision, transform: readonly [number, number, number, number], lo = 0.05, hi = 6): number {
    if (!checkTrack(track, col, transform, lo, false).ok) return 0;
    if (checkTrack(track, col, transform, hi, false).ok) return hi;
    let a = lo;
    let b = hi;
    for (let i = 0; i < 14; i++) {
        const m = (a + b) / 2;
        if (checkTrack(track, col, transform, m, false).ok) a = m;
        else b = m;
    }
    return a;
}

/** The nearest wall point to `p` by rays in the 26 neighbour directions, or null. */
export function nearestWall(col: VoxelCollision, p: Vec3, reach = 40): { point: Vec3; distance: number; dir: Vec3 } | null {
    let best: { point: Vec3; distance: number; dir: Vec3 } | null = null;
    for (let x = -1; x <= 1; x++) {
        for (let y = -1; y <= 1; y++) {
            for (let z = -1; z <= 1; z++) {
                if (x === 0 && y === 0 && z === 0) continue;
                const d = unit([x, y, z]);
                const h = col.queryRay(p[0], p[1], p[2], d[0], d[1], d[2], reach);
                if (!h) continue;
                const distance = Math.hypot(h.x - p[0], h.y - p[1], h.z - p[2]);
                if (!best || distance < best.distance) best = { point: [h.x, h.y, h.z], distance, dir: d };
            }
        }
    }
    return best;
}

/** The track with gate `index` moved to `to` (a flown-world point; the scan frame is T^-1), everything else as it was. */
export function withGateAt(track: TrackFile, index: number, to: Vec3, transform: readonly [number, number, number, number]): TrackFile {
    const [s, tx, ty, tz] = transform;
    const p: Vec3 = [(to[0] - tx) / s, (to[1] - ty) / s, (to[2] - tz) / s];
    return { ...track, gates: track.gates.map((g, i) => (i === index ? { ...g, pos: p } : g)) };
}
