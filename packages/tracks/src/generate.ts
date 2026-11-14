// A random course of gates in the well scanned free space of a scan (docs/wip/tracks-plan.md 2.2, requirement R1, at its
// smallest: ring and square gates only, no dive gates, pillars or zones yet). Seeded and pure: + - * /, Math.sqrt, integer
// grids, rounding, and a table of 16 yaws with literal quaternions; no Math.random, no trigonometry, no clock (the caller
// passes `created`). Same seed + same walls + same generator version = the same trackDigest in Node and in browsers.
//
//   count     N = clamp(round(4 + V / 40), 4, 24) gates for V flown m3 of usable free space.
//   kinds     the cell's sure free radius picks the shape: >= 2.2 m a square race gate with a 1.5 m opening, >= 1.4 m a
//             ring of 1.2 m; less: no gate there.
//   order     a seeded walk over a strided pool of the candidate cells: each next gate 3-15 m from the last,
//             a turn of at most 120 degrees, the leg straight and free (a swept sphere of the margin), the gate's axis the
//             leg's direction rounded to one of 16 yaws and within 30 degrees of the leg (the proof allows 35).
//   proof     every gate added is proven alone by checkTrack (check.ts): the leg from where the walk stands, its opening,
//             frame and run; a gate that fails is dropped and the next candidate tried. The finished course is proven
//             whole and gates are dropped until it holds. It is closed (laps) at the last gate at least half way along
//             that sees the start, else open (laps 1). After `tries` the course is shorter, never invalid. The proof's
//             result goes into generator.params.proof (unmeasured: ok and path length).
import type { Pose, Quat, SceneTransform, TrackFile, TrackGate, Vec3, VoxelCollision } from './types';
import { MARGIN_M, checkTrack, sweeperOf } from './check';
import { cellCentre, clearanceM } from './freespace';
import type { FreeSpace } from './freespace';
import { createRng } from './rng';
import type { Rng } from './rng';

export const GENERATOR_NAME = 'gsfpv-course';
export const GENERATOR_VERSION = '1';

export interface CourseParams {
    /** the proof's margin, flown m */
    readonly marginM: number;
    readonly legMinM: number;
    readonly legMaxM: number;
    /** the cosine of the largest turn at a gate (120 degrees: -0.5) */
    readonly turnCosMin: number;
    /** the cosine of the largest angle between a gate's axis and its leg in (30 degrees: 0.866) */
    readonly axisCosMin: number;
    readonly gatesMin: number;
    readonly gatesMax: number;
    /** flown m3 of free space per gate above the first four */
    readonly m3PerGate: number;
    /** gate candidates proven before the course is cut short */
    readonly tries: number;
    /** two gates are at least this far apart, flown m */
    readonly spacingM: number;
    readonly laps: number;
}

/** Estimates from tracks-plan.md 2.2 unless tools/bench/src/tracks-generate.ts reports them as measured. */
export const COURSE_DEFAULTS: CourseParams = {
    marginM: MARGIN_M,
    legMinM: 3, // estimate (plan 2.2)
    legMaxM: 15, // estimate (plan 2.2)
    turnCosMin: -0.5, // cos 120 deg, plan 2.2
    axisCosMin: 0.866, // cos 30 deg: 5 degrees inside the proof's 35 (estimate)
    gatesMin: 4, // plan 2.2
    gatesMax: 24, // plan 2.2
    m3PerGate: 40, // estimate (plan 2.2)
    tries: 200, // plan 2.2
    spacingM: 3, // estimate: the shortest leg
    laps: 3 // estimate
};

/** Gate sizes, flown m (plan 2.2): the shape a cell's sure free radius allows. */
export const SQUARE_MIN_FREE_M = 2.2; // estimate (plan 2.2)
export const RING_MIN_FREE_M = 1.4; // estimate (plan 2.2)
export const SQUARE_SIDE_M = 1.5; // estimate (plan 2.2): a racing gate's opening
export const SQUARE_BAR_M = 0.1; // estimate: a visible bar
export const RING_DIAMETER_M = 1.2; // estimate (plan 2.2): a ring a whoop passes
export const RING_TUBE_M = 0.08; // estimate: a visible tube
/** the most candidate cells the walk reads (a stride over the usable cells; estimate: 20 000 x 24 gates stays fast) */
const POOL_MAX = 20000;
/** the out half keeps within this many longest legs of the start (estimate: Winter Garden walked to 56 m and ran out of
 *  candidates at the scan's edge without it, evidence of the walk before this rule) */
const OUT_LEGS = 2;
/** leg sweeps a step may spend finding 4 open options (estimate) */
const SWEEPS_PER_STEP = 64;

export interface CourseOptions {
    readonly seed: number;
    readonly scene: { readonly id: string; readonly version: number };
    /** the scene transform the walls were flown at: positions are written in the scan frame */
    readonly transform: SceneTransform;
    readonly params?: Partial<CourseParams>;
    /** ISO 8601; the package reads no clock */
    readonly created?: string;
    /** test seam: the random source (the determinism test's control injects Math.random through it) */
    readonly rng?: (seed: number) => Rng;
}

/** N for V flown m3. */
export function courseCount(volumeM3: number, p: CourseParams = COURSE_DEFAULTS): number {
    return Math.max(p.gatesMin, Math.min(p.gatesMax, Math.round(4 + volumeM3 / p.m3PerGate)));
}

// cos of m * 11.25 degrees for m = 0..8 (literals: no trigonometry in the generator)
const COS = [1, 0.98078528, 0.92387953, 0.83146961, 0.70710678, 0.55557023, 0.38268343, 0.19509032, 0];
function cosStep(m: number): number {
    m = ((m % 32) + 32) % 32;
    if (m <= 8) return COS[m]!;
    if (m <= 16) return -COS[16 - m]!;
    if (m <= 24) return -COS[m - 16]!;
    return COS[32 - m]!;
}
const sinStep = (m: number): number => cosStep(m - 8);
const r6 = (v: number): number => {
    const r = Math.round(v * 1e6) / 1e6;
    return r === 0 ? 0 : r;
};
const r3 = (v: number): number => {
    const r = Math.round(v * 1000) / 1000;
    return r === 0 ? 0 : r;
};

/** Yaw k (k * 22.5 degrees): the way the gate is passed, (sin, 0, -cos) as yawQuat says. */
export function yawForward(k: number): Vec3 {
    return [sinStep(2 * k), 0, -cosStep(2 * k)];
}
/** yawQuat(k * 22.5) from the table, rounded to 1e-6. */
export function yawQuatStep(k: number): Quat {
    return [r6(cosStep(k)), 0, r6(-sinStep(k)), 0];
}
/** The table yaw nearest a direction's horizontal part. */
export function nearestYaw(d: Vec3): number {
    let best = 0, bestDot = -Infinity;
    for (let k = 0; k < 16; k++) {
        const f = yawForward(k);
        const v = f[0] * d[0] + f[2] * d[2];
        if (v > bestDot) {
            bestDot = v;
            best = k;
        }
    }
    return best;
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: Vec3): number => Math.sqrt(dot(a, a));
const dist2 = (a: Vec3, b: Vec3): number => dot(sub(a, b), sub(a, b));

/** The course's title for a seed: 'Course ' and the seed in base 36 (plan section 7). */
export function courseTitle(seed: number): string {
    return `Course ${(seed >>> 0).toString(36)}`;
}

/** The course's id for a seed (the link form g1.<seed>). */
export function courseId(seed: number): string {
    return `g1.${(seed >>> 0).toString(36)}`;
}

export function generateCourse(free: FreeSpace, walls: VoxelCollision, opts: CourseOptions): TrackFile {
    const p: CourseParams = { ...COURSE_DEFAULTS, ...(opts.params ?? {}) };
    const seed = opts.seed >>> 0;
    const rng = (opts.rng ?? createRng)(seed);
    const T = opts.transform;
    const s = T[0];
    const toScan = (w: Vec3): Vec3 => [r3((w[0] - T[1]) / s), r3((w[1] - T[2]) / s), r3((w[2] - T[3]) / s)];
    const toFlown = (q: Vec3): Vec3 => [s * q[0] + T[1], s * q[1] + T[2], s * q[2] + T[3]];
    const sweeper = sweeperOf(walls);
    const N = courseCount(free.volumeM3, p);

    // candidates: usable cells roomy enough for a ring, then a farthest-point sample
    const all: number[] = [];
    for (let i = 0; i < free.room.length; i++) if (free.room[i]! >= 0 && clearanceM(free, i) >= RING_MIN_FREE_M) all.push(i);
    const stride = Math.max(1, Math.ceil(all.length / POOL_MAX));
    const offset = all.length > 0 ? rng.int(0, stride - 1) : 0;
    const pool: number[] = [];
    for (let k = offset; k < all.length; k += stride) pool.push(all[k]!);
    // the walk reads the whole (strided) pool: a farthest-point sample of 8 per gate spread 192 points over 47 000 m3 of
    // Winter Garden, so after 1-4 gates no sample lay 3-15 m from the last (evidence run of bf7dc3d9: tries 6-11)
    const cands = pool.map((i) => ({ pos: cellCentre(free, i), free: clearanceM(free, i), used: false }));

    const startW: Vec3 = free.startCell >= 0 ? cellCentre(free, free.startCell) : [T[1], T[2], T[3]];
    const shapeFor = (freeM: number): TrackGate['shape'] =>
        freeM >= SQUARE_MIN_FREE_M ? { kind: 'square', side: r3(SQUARE_SIDE_M / s), bar: r3(SQUARE_BAR_M / s) } : { kind: 'ring', diameter: r3(RING_DIAMETER_M / s), tube: r3(RING_TUBE_M / s) };
    const build = (gates: TrackGate[], startYaw: number, from: Vec3 = startW, laps: number = p.laps): TrackFile => ({
        format: 'shramko-sonic-track/1',
        id: courseId(seed),
        version: 1,
        parent: null,
        title: courseTitle(seed),
        scene: { kind: 'scan', id: opts.scene.id, version: opts.scene.version },
        transform: [T[0], T[1], T[2], T[3]],
        gates,
        laps,
        start: { pos: toScan(from), yawDeg: startYaw * 22.5 } satisfies Pose,
        author: { kind: 'generator', name: GENERATOR_NAME },
        generator: { name: GENERATOR_NAME, version: GENERATOR_VERSION, seed, params: {} },
        created: opts.created ?? '2026-01-01T00:00:00.000Z'
    });

    const gates: TrackGate[] = [];
    const flownGates: Vec3[] = [];
    let cur = startW;
    let prevDir: Vec3 | null = null;
    let tries = 0;
    let stop = 'tries';
    let back = false;
    const turnOk = (from: Vec3, prev: Vec3 | null, to: Vec3): Vec3 | null => {
        const leg = sub(to, from);
        const L = len(leg);
        if (L < p.legMinM || L > p.legMaxM) return null;
        const u: Vec3 = [leg[0] / L, leg[1] / L, leg[2] / L];
        if (prev && dot(u, prev) < p.turnCosMin) return null;
        if (dot(yawForward(nearestYaw(u)), u) < p.axisCosMin) return null;
        return u;
    };
    while (gates.length < N && tries < p.tries) {
        const options: { c: (typeof cands)[number]; u: Vec3; score: number }[] = [];
        // out (first half): within OUT_LEGS legs of the start; back: toward the start. A walk with nothing in reach turns back.
        if (gates.length >= Math.ceil(N / 2)) back = true;
        const reach2 = OUT_LEGS * OUT_LEGS * p.legMaxM * p.legMaxM;
        for (const c of cands) {
            if (!back && dist2(startW, c.pos) > reach2) continue;
            if (c.used) continue;
            const u = turnOk(cur, prevDir, c.pos);
            if (!u) continue;
            let near = Infinity;
            for (const g of flownGates) near = Math.min(near, dist2(g, c.pos));
            near = Math.min(near, dist2(startW, c.pos));
            if (near < p.spacingM * p.spacingM) continue;
            // out: away from what is laid; back (the second half): toward the start, so the lap can close
            options.push({ c, u, score: back ? -dist2(startW, c.pos) : near });
        }
        options.sort((a, b) => b.score - a.score);
        // the best 4 whose leg is free (at most SWEEPS_PER_STEP sweeps); a blocked leg does not use the candidate up,
        // it may be free from the next gate (marking it used left the walk back 20 m short of the start on Winter Garden)
        const open: typeof options = [];
        for (let j = 0, sweeps = 0; j < options.length && open.length < 4 && sweeps < SWEEPS_PER_STEP; j++, sweeps++) {
            if (sweeper.free(cur, options[j]!.c.pos, p.marginM)) open.push(options[j]!);
        }
        if (open.length === 0) {
            if (!back) {
                back = true;
                continue;
            }
            stop = options.length === 0 ? 'no candidate in reach' : 'no free leg';
            break;
        }
        const o = open[rng.int(0, open.length - 1)]!;
        o.c.used = true;
        tries++;
        const k = nearestYaw(o.u);
        const gate: TrackGate = { id: `g${gates.length + 1}`, shape: shapeFor(o.c.free), pos: toScan(o.c.pos), quat: yawQuatStep(k), direction: 'forward' };
        // one-gate proof: the leg from where the walk stands and this gate's opening, frame and run (the whole course is
        // proven once at the end); proving the whole course per candidate cost about 44 s a course on real walls
        const trial = build([gate], k, cur, 1); // open: the one-gate proof has no leg out (laps did not matter to it before K1)
        if (!checkTrack(trial, walls, T, p.marginM, false).ok) continue;
        gates.push(gate);
        flownGates.push(toFlown(gate.pos));
        cur = flownGates[flownGates.length - 1]!;
        prevDir = o.u;
    }

    // the finished course, proven whole. Closed (laps) when a gate at least half way along sees the start: the course
    // ends there. Otherwise it stays open (laps 1, no leg back): popping gates until the last sees the start left 1-2
    // gates on big scans.
    const renumber = (gs: TrackGate[]): TrackGate[] => gs.map((g, i) => ({ ...g, id: `g${i + 1}` }));
    const closeAt = (gs: TrackGate[]): number => {
        for (let n = gs.length; n >= Math.max(1, Math.ceil(gs.length / 2)); n--) if (sweeper.free(toFlown(gs[n - 1]!.pos), startW, p.marginM)) return n;
        return 0;
    };
    let course = renumber(gates);
    let laps = p.laps;
    for (let guard = 0; guard < 2 * p.tries && course.length > 0; guard++) {
        const n = closeAt(course);
        if (n > 0) {
            course = renumber(course.slice(0, n));
            laps = p.laps;
        } else laps = 1;
        const startYaw = nearestYaw(sub(toFlown(course[0]!.pos), startW));
        const r = checkTrack(build(course, startYaw, startW, laps), walls, T, p.marginM, false);
        if (r.ok) break;
        const bad = r.gates.findIndex((g) => !g.clear || !g.directionOk);
        const badLeg = r.legs.findIndex((l) => !l.clear);
        const drop = bad >= 0 ? bad : badLeg >= 0 ? Math.max(0, badLeg - 1) : course.length - 1;
        course = renumber(course.filter((_, i) => i !== drop));
    }
    if (course.length === 0) laps = p.laps;
    const startYaw = course.length ? nearestYaw(sub(toFlown(course[0]!.pos), startW)) : 0;
    const shell = build(course, startYaw, startW, laps);
    // unmeasured: the free-radius probes of a measured proof took about 5 s on the three-room test world (time-scratch run,
    // docs/wip/tracks.md Findings); the caller measures when it needs the numbers
    const proof = course.length ? checkTrack(shell, walls, T, p.marginM, false) : null;
    return {
        ...shell,
        generator: {
            name: GENERATOR_NAME,
            version: GENERATOR_VERSION,
            seed,
            params: {
                marginM: p.marginM,
                cellM: r3(free.cellM),
                freeDigest: free.digest,
                wanted: N,
                rooms: free.rooms.length,
                volumeM3: r3(free.volumeM3),
                tries,
                walked: gates.length,
                stop: gates.length >= N ? 'count' : stop,
                closed: course.length > 0 && laps > 1,
                proof: proof ? { ok: proof.ok, marginM: p.marginM, pathM: proof.pathM } : null
            }
        }
    };
}
