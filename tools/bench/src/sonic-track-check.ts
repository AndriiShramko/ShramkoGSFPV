// v0.12 Fly by Sound, lane v12-flight step 10 (docs/wip/v12-plan.md 4.2): the proof that a track file can be flown on the real
// walls of its scan. A track is a chain of gates laid out by hand in the scan frame (plan 2.7); here it is seen as the flight
// sees it: through the scene transform the lesson forces (T(p) = s * p + t, Winter Garden x5), against the scan's own voxel
// walls as the session builds them for flying (the same octree, cells s times larger: transformCollision), with the flight
// model's own overlap and sweep tests (sphereOverlaps, VoxelContactWorld.sweepOne: a sphere swept along a segment is proven
// free by its inflated cover, so no step size can miss a wall).
//
// What is proven, in flown metres, for a margin (default 0.5 m, the plan's number):
//   start     a sphere of the margin's radius at the start pose is free;
//   openings  every gate's opening (its disc or square, from the centre out to the frame) and the frame itself (the ring's tube,
//             the square's bars), swept by a sphere of the margin's radius, touches no wall;
//   legs      the polyline start, gate 1, gate 2, ... swept by a sphere of the margin's radius touches no wall;
//   approach  the straight run through each gate along its axis (up to 3 m before and after) the same;
//   direction every gate's axis (its local -Z, the way it is passed) is within 35 degrees of the leg in, so a pilot who flies the
//             leg crosses the gate forward and inside its opening (the lesson runner's rule, goals.ts: a pass counts only from
//             the gate's +Z side to its -Z side). The leg out is not held to it: after a gate the course may turn back (a
//             crossing of an earlier gate's plane the wrong way is no pass and no miss); its angle is reported.
// And measured, not proven by the threshold: the free radius (the largest sphere that touches no wall, bisection on the same
// overlap test) at the start, over each opening and frame, and every 0.25 m along each leg: the margin the course really has.
// Controls (run every time, in the evidence): the proof is applied at the margin the track really has, plus and minus 2 cm (it
// passes at the lower, fails at the higher); the same track with a gate pushed into the nearest wall, and with a gate carried
// through the wall, each fails in the right place.
//
//   cd tools/bench && npx tsx src/sonic-track-check.ts [--track <file>] [--margin <m>]   (Node only: no browser, no GPU;
//                                                      the scan's walls from .cache/scenes, downloaded once)
// Evidence: evidence/<date>/sonic-track-check.json and sonic-track-check.png (the course seen from above). Exit 1 on a failure.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { parseTrack, quatRotate, trackToObjects, yawQuat } from '../../../packages/sonic-fpv/src';
import type { SonicObject, TrackFile, Vec3 } from '../../../packages/sonic-fpv/src';
import { VoxelContactWorld, sphereOverlaps, transformCollision } from '@gsfpv/collision';
import type { VoxelCollision } from '@gsfpv/collision';
import { REPO, today, writeEvidence } from './evidence';

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
function frame(g: SonicObject): { ex: Vec3; ey: Vec3; ez: Vec3 } {
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
}

/** The flown start of a track: its own start, else the first gate's neighbourhood is not guessed (a track needs one). */
function flownStart(track: TrackFile, transform: readonly [number, number, number, number]): { pos: Vec3; yawDeg: number } | null {
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
    const sw = sweeperOf(col);
    const gates = trackToObjects(track, { transform });
    const issues: string[] = [];
    const start = flownStart(track, transform);
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
    return { marginM, ok, startClear, startFreeM: r3(startFreeM), gates: reports, legs, pathM: r3(pathM), minGapM: r3(Number.isFinite(minGap) ? minGap : 0), minFreeM: r3(minFree), issues };
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

// ------------------------------------------------------------------ a picture from above

function crc32(buf: Uint8Array): number {
    let crc = 0xffffffff;
    for (let n = 0; n < buf.length; n++) {
        let c = (crc ^ buf[n]!) & 0xff;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        crc = (crc >>> 8) ^ c;
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
    const len4 = Buffer.alloc(4);
    len4.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), Buffer.from(data)]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len4, td, crc]);
}

export function pngBytes(w: number, h: number, rgb: Uint8Array): Buffer {
    const raw = Buffer.alloc((w * 3 + 1) * h);
    for (let y = 0; y < h; y++) {
        raw[y * (w * 3 + 1)] = 0;
        Buffer.from(rgb.buffer, rgb.byteOffset + y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1);
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0);
    ihdr.writeUInt32BE(h, 4);
    ihdr[8] = 8;
    ihdr[9] = 2;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array(0))]);
}

/**
 * The course seen from above, flown metres: a column is dark when a wall stands in it anywhere between the lowest and the
 * highest gate (with the margin above and below), light otherwise; each gate is a bar across its opening, the legs are lines.
 */
export function topView(track: TrackFile, col: VoxelCollision, transform: readonly [number, number, number, number], pxPerM = 12): Buffer {
    const gates = trackToObjects(track, { transform });
    const start = flownStart(track, transform);
    const pts: Vec3[] = [...(start ? [start.pos] : []), ...gates.map((g) => g.pos)];
    const pad = 12;
    const x0 = Math.min(...pts.map((p) => p[0])) - pad, x1 = Math.max(...pts.map((p) => p[0])) + pad;
    const z0 = Math.min(...pts.map((p) => p[2])) - pad, z1 = Math.max(...pts.map((p) => p[2])) + pad;
    const yLo = Math.min(...pts.map((p) => p[1])) - 1, yHi = Math.max(...pts.map((p) => p[1])) + 1;
    const W = Math.ceil((x1 - x0) * pxPerM), H = Math.ceil((z1 - z0) * pxPerM);
    const img = new Uint8Array(W * H * 3).fill(235);
    const cell = 1 / pxPerM;
    for (let j = 0; j < H; j++) {
        for (let i = 0; i < W; i++) {
            const x = x0 + (i + 0.5) * cell, z = z0 + (j + 0.5) * cell;
            let hit = false;
            for (let y = yLo; y <= yHi && !hit; y += 0.5) hit = sphereOverlaps(col, x, y, z, 0.05);
            if (hit) {
                const p = (j * W + i) * 3;
                img[p] = 30;
                img[p + 1] = 30;
                img[p + 2] = 36;
            }
        }
    }
    const put = (x: number, z: number, rgb: readonly number[], r = 1): void => {
        const i = Math.round((x - x0) * pxPerM), j = Math.round((z - z0) * pxPerM);
        for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
            const a = i + di, b = j + dj;
            if (a < 0 || b < 0 || a >= W || b >= H) continue;
            const p = (b * W + a) * 3;
            img[p] = rgb[0]!;
            img[p + 1] = rgb[1]!;
            img[p + 2] = rgb[2]!;
        }
    };
    const line = (a: Vec3, b: Vec3, rgb: readonly number[], r = 1): void => {
        const n = Math.max(2, Math.ceil(len([b[0] - a[0], 0, b[2] - a[2]]) * pxPerM));
        for (let k = 0; k <= n; k++) put(a[0] + ((b[0] - a[0]) * k) / n, a[2] + ((b[2] - a[2]) * k) / n, rgb, r);
    };
    for (let i = 0; i + 1 < pts.length; i++) line(pts[i]!, pts[i + 1]!, [40, 120, 220], 0);
    gates.forEach((g, k) => {
        const { ex } = frame(g);
        const half = g.shape.kind === 'ring' ? g.shape.diameter / 2 : g.shape.kind === 'square' || g.shape.kind === 'cube-frame' ? g.shape.side / 2 : 1;
        line(add(g.pos, mul(ex, -half)), add(g.pos, mul(ex, half)), [230, 90, 20], 1);
        // the way it is passed: a short tick on the -z side
        const ez = frame(g).ez;
        line(g.pos, add(g.pos, mul(ez, -1.5)), [200, 40, 40], 0);
        put(g.pos[0], g.pos[2], [20, 160, 60], 2 + (k === 0 ? 1 : 0));
    });
    if (start) put(start.pos[0], start.pos[2], [20, 60, 220], 3);
    return pngBytes(W, H, img);
}

// ------------------------------------------------------------------ the command

function cliArg(name: string): string | null {
    const i = process.argv.indexOf(name);
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : null;
}

export const DEFAULT_TRACK = join(REPO, 'apps', 'fly', 'public', 'sonic', 'tracks', '7a475d38-rings-v1.json');

async function main(): Promise<void> {
    const file = cliArg('--track') ?? DEFAULT_TRACK;
    const margin = Number(cliArg('--margin') ?? MARGIN_M);
    const parsed = parseTrack(readFileSync(file, 'utf8'));
    if (!parsed.ok) throw new Error(`${file}: ${parsed.issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`);
    const track = parsed.value;
    const { loadScene } = await import('./scenes');
    const scene = await loadScene(track.scene.id);
    const transform = track.transform;
    const col = flownCollision(scene.collision, transform);
    const t0 = performance.now();
    const report = checkTrack(track, col, transform, margin);
    const ms = Math.round(performance.now() - t0);
    const checks: { name: string; pass: boolean; value?: unknown }[] = [];
    const check = (name: string, pass: boolean, value?: unknown): void => {
        checks.push({ name, pass, value });
        console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${value === undefined ? '' : '  ' + JSON.stringify(value).slice(0, 300)}`);
    };
    console.log(`${track.id} v${track.version}: ${track.gates.length} gates, ${report.pathM} m of path, walls ${r3(col.voxelResolution * 100)} cm cells (${scene.metadata.voxelResolution * 100} cm x ${transform[0]}), the proof took ${ms} ms`);
    for (const g of report.gates) console.log(`  gate ${g.id}: centre ${g.centre.join(', ')} d ${g.diameterM} yaw ${g.yawDeg}  free ${g.freeM} m at ${g.freeAt.join(', ')}  axis ${g.axisInDeg} deg off the leg in, turn ${g.turnDeg} deg  ${g.clear && g.directionOk ? 'ok' : 'NOT OK'}`);
    for (const l of report.legs) console.log(`  leg ${l.from} -> ${l.to}: ${l.lengthM} m  free ${l.freeM} m at ${l.at.join(', ')}  ${l.clear ? 'ok' : 'NOT CLEAR'}`);

    check(`start, every opening, every frame, every leg and every run through a gate: a sphere of ${margin} m touches no wall (${track.gates.length} gates, ${report.legs.length} legs, flown at x${transform[0]})`, report.ok, report.issues.length ? report.issues : { minFreeM: report.minFreeM, pathM: report.pathM });
    check('every gate is passed forward: its axis is within 35 degrees of the leg in', report.gates.every((g) => g.directionOk), report.gates.map((g) => [g.id, g.axisInDeg, g.turnDeg]));
    // controls
    const proven = provenMargin(track, col, transform);
    check(`control: the proof is no empty test: the track passes at ${r3(proven - 0.02)} m and fails at ${r3(proven + 0.02)} m (the largest margin it holds is ${r3(proven)} m)`, proven > 0.1 && checkTrack(track, col, transform, proven - 0.02, false).ok && !checkTrack(track, col, transform, proven + 0.02, false).ok, { provenMarginM: r3(proven) });
    const mid = Math.floor(track.gates.length / 2);
    const g = trackToObjects(track, { transform })[mid]!;
    const wall = nearestWall(col, g.pos);
    if (wall) {
        const into = withGateAt(track, mid, add(wall.point, mul(wall.dir, 0.3)), transform);
        const r1 = checkTrack(into, col, transform, margin, false);
        check(`control: gate ${g.id} pushed 0.3 m into the nearest wall (${r3(wall.distance)} m away) is refused, and the refusal names that gate`, !r1.ok && r1.issues.some((s) => s.includes(`gate ${g.id}`)), r1.issues.slice(0, 3));
        const through = withGateAt(track, mid, add(wall.point, mul(wall.dir, 6)), transform);
        const r2 = checkTrack(through, col, transform, margin, false);
        check(`control: gate ${g.id} carried 6 m beyond the nearest wall makes a leg that crosses it, which is refused`, !r2.ok && r2.legs.some((l) => !l.clear), r2.legs.filter((l) => !l.clear).map((l) => `${l.from}->${l.to}`));
    } else check('control: a wall was found near the middle gate to push it into', false);
    const reversed: TrackFile = { ...track, gates: track.gates.map((gt, i) => (i === mid ? { ...gt, quat: yawQuat(180) } : gt)) };
    check('control: a gate turned half way round (its axis against the leg in) is refused as not passed forward', (() => { const r = checkTrack(reversed, col, transform, margin, false); return !r.ok && r.issues.some((s) => s.includes('deg off the leg in')); })(), undefined);

    const stamp = today();
    const dir = join(REPO, 'evidence', stamp);
    mkdirSync(dir, { recursive: true });
    const png = topView(track, col, transform);
    writeFileSync(join(dir, 'sonic-track-check.png'), png);
    const out = writeEvidence('sonic-track-check', {
        step: 'v12-flight 10: the Winter Garden ring track proven clear on the real walls',
        track: { id: track.id, version: track.version, file: file.replace(REPO, '').replace(/\\/g, '/'), gates: track.gates.length, transform },
        walls: { scene: track.scene.id, cm: r3(scene.metadata.voxelResolution * 100), flownCm: r3(col.voxelResolution * 100), sha256: scene.sha256 },
        marginM: margin,
        provenMarginM: r3(proven),
        proofMs: ms,
        estimate: { flightS: Math.round(report.pathM / LESSON_SPEED_MPS), note: 'path length over the lesson speed cap: an estimate, not a flight' },
        report,
        checks,
        pass: checks.every((c) => c.pass)
    });
    console.log(`evidence ${out}; picture evidence/${stamp}/sonic-track-check.png; ${checks.filter((c) => c.pass).length}/${checks.length} checks pass`);
    process.exitCode = checks.every((c) => c.pass) ? 0 : 1;
}

const argv1 = (process.argv[1] ?? '').replace(/\\/g, '/');
if (/\/sonic-track-check\.(ts|js|mjs)$/.test(argv1)) await main();
