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
import { inDenseBand, qualityShare, standGround, stepsFrom, tileOf } from './quality';
import { gateExit } from './path';
import type { QualityMap } from './quality';
import type { FreeSpace } from './freespace';
import { createRng } from './rng';
import { composeElements } from './elements';
import type { Composed } from './elements';
import { MAX_LEG_M, SERVER_MAX_GATES } from './server';
import type { Rng } from './rng';

export const GENERATOR_NAME = 'gsfpv-course';
export const GENERATOR_VERSION = '1';
/** G2: a course laid over a quality map (band and spread walk); the same seed lays another course than version 1.
 *  course4 review CU-3: '4' since lane course4 C0 (gates stand over the ground: the same seed lays other gates than the
 *  version 3 on main), so course/link.ts bestKey ('.g<major>') keeps the best laps of the two apart. */
export const GENERATOR_VERSION_QUALITY = '4';

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
    /** K1.2: the course's size against the plan's (1). Gate sizes and the free radius a gate needs are multiplied by it;
     *  legs, spacing and margin are set by scaledParams. 1 leaves every course as it was (same trackDigest). */
    readonly scale: number;
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
    laps: 3, // estimate
    scale: 1
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
    /** G2: where the scan is good (quality.ts). Gates go into its dense band over well-scanned tiles and the walk spreads
     *  over the whole box instead of keeping within OUT_LEGS legs of the start. Without it every course is as before. */
    readonly quality?: QualityMap;
    /** X3: the scene's own spawn, flown world (the session's spawn, not the craft: one seed gives every pilot the same
     *  course). A closed course starts at the gate nearest it (startNearSpawn); without it the start cell's centre is used. */
    readonly spawn?: Vec3;
    /** CR-1: what the walk did (audits and probes). Not written into the file: the server keeps a fixed list of params keys
     *  (server.ts PARAM_KEYS, apps/api/tracks.py), and these are diagnostics, not the course. */
    readonly onWalk?: (w: WalkInfo) => void;
    /** course4 C4: compose the walk's course into competition elements (elements.ts). Off: the course is as before
     *  (the sound mode's course-ask job does not ask for them: its pilot passes single upright gates). */
    readonly elements?: boolean;
    /** course5 Z2 (lead's decision A3, review CU-7): the flown craft's boundRadius, flown m: fitCourse's smallest gate lets
     *  it pass (courseScales). Absent: the smallest craft of the catalogue (SMALLEST_DRONE_RADIUS_M). Not in the file. */
    readonly craftRadiusM?: number;
    /** course4 C4: what the composition drew and placed (audits and tests) */
    readonly onElements?: (c: Composed) => void;
    /** gen4a A2 (plan.ts planCourse): where the course may stand, from the scan's analysis. Absent: the walk of before. */
    readonly place?: CoursePlace;
}

/** gen4a A2: the zone of a course the pilot asked for (plan.ts). The walk is the plain one (no quality map): out within
 *  reachM of the start, away from the gates laid, then home toward the start; the ring always closes at the last gate that
 *  sees the start (not only from half way). */
export interface CoursePlace {
    /** a gate's centre may stand here (flown world): the scanned territory, the quality, the kind's rule */
    readonly at: (p: Vec3) => boolean;
    /** the course starts at the candidate nearest this point (the analysis core), flown world */
    readonly start: Vec3;
    /** the walk's out half keeps within this of the start, flown m */
    readonly reachM: number;
    /** the gates the walk wants (LEVELS' gatesMin..gatesMax) */
    readonly gates: number;
    /** the most gates the course may have with its composed elements (LEVELS' gatesMax; absent: SERVER_MAX_GATES) */
    readonly maxGates?: number;
    /** |height change| / horizontal length of a leg at most */
    readonly climbMax: number;
    /** generator.version of the course ('5.<b|m|p><c|w|v>'); '.e2' and '.s<shift>' are added as for the old walk */
    readonly version: string;
}

/** CR-1, CR-4: the walk of one generateCourse call, handed to CourseOptions.onWalk */
export interface WalkInfo {
    /** the dense band used, m above the ground (null without a quality map) */
    readonly band: readonly [number, number] | null;
    readonly banded: boolean;
    /** fix3b Y2: the top of the eye band the gates were laid in, m above the ground under them (2 when nothing forced
     *  more; 0 when the band was not used: no quality map, or too few cells in any band up to the dense band's top) */
    readonly eyeHi: number;
    /** the seeded far target's steps from the start, m (0 without one) */
    readonly farM: number;
    /** gates laid when the walk turned home (-1: it never did) */
    readonly outGates: number;
    readonly backtracks: number;
    readonly wanted: number;
    /** gates the walk laid before the course was proven whole */
    readonly walked: number;
    /** gates cut because the course closes at an earlier gate that sees the start */
    readonly cutClose: number;
    /** gates dropped by the whole-course proof: 'gate' (opening or direction), 'leg' (blocked leg), 'last' (no reason found) */
    readonly drops: readonly string[];
    readonly kept: number;
    /** course4 C3: candidates the walk refused, by rule, summed over its steps (cands: the pool's size; reach, pot, turn,
     *  space, sweep, proof), and why it stopped */
    readonly refused?: Readonly<Record<string, number>>;
    readonly stop?: string;
}

/** fix3b Y2 (owner's message 52, 2026-11-15): "the detail, the highest density of the point cloud, is at the level of
 *  human eyes, near the ground ... they are all somewhere over a person's head". The centre of a gate stands 1.2 to 2.0 m
 *  above the ground under it (the first wall voxel below it), 1.6 m when nothing forces another height; the lead's rule. */
export const EYE_M = 1.6;
export const EYE_LO_M = 1.2;
export const EYE_HI_M = 2.0;
/** the lower edge of a gate's frame stays this far above the ground (the lead's rule) */
export const LOW_EDGE_M = 0.3;
/** an eye-level cell's least free radius, flown m (estimate: a 1.2 m ring's radius, its tube and LOW_EDGE_M under it;
 *  RING_MIN_FREE_M of 1.4 m measured to the ground kept every cell centre under 2.2 m out of a 0.6-0.8 m grid) */
export const EYE_FREE_M = 1.0;
/** when too few cells lie in the eye band, its top is raised by this much at a time up to the dense band's top (estimate) */
const EYE_STEP_M = 0.4;
/** review FY-6, ESTIMATE: the scan's flown scale (transform[0]) within this of 1 counts as its true size for the eye band */
export const EYE_SCALE_TOL = 0.2;
/** fix3b Y2 (message 52: "at the ends of streets, where the quality is already quite bad"): no gate and no leg where the
 *  tile's quality (quality.ts near) is under this share of the scan's best quarter (estimate: before Y2 the gates of
 *  Wroclaw, Tunis and Opole stood at 0.18-0.28 of it, gate-place-audit.ts, place-before.json) */
export const POOR_SHARE = 0.15;
/** course4 C0 (4): freeSpace's goodAt for a course over a quality map: a well-scanned tile of at least POOR_SHARE (the
 *  tile rule of the eye band in walkCourse) */
export function goodForGate(q: QualityMap): (p: Vec3) => boolean {
    return (p) => {
        const t = tileOf(q, p);
        return t >= 0 && q.good[t] === 1 && qualityShare(q, p) >= POOR_SHARE;
    };
}
/** fix3b Y2: a leg's quality is read every this many m along it (gate-place-audit.ts reads every 1 m; 2 m let legs of
 *  Wroclaw down to 0.04-0.11 of the best quarter through, place-after.json) */
const LEG_STEP_M = 1;
/** G2: the band candidates are used when there are at least this many per wanted gate (estimate), else every candidate */
const BAND_CANDS_PER_GATE = 8;
/** G2: the out half's way is about this share of a longest leg per gate (estimate: the legs are 3-15 m and a leg along a
 *  street is a little longer than the way's cell steps say) */
const SPREAD_LEG_SHARE = 0.7;
/** G2: the far target is drawn from the candidates at least this share of the planned way out (estimate) */
const SPREAD_FAR_MIN = 0.8;
/** G4 (message 51, "the street is long and scanned further, but there are no obstacles there"): the longest leg of a
 *  course laid over a quality map, flown m (estimate: a racing straight; the 15 m legs of plan 2.2 kept every Wroclaw
 *  course within 76 m of its start on a street scanned for 200 m). Courses without a map keep p.legMaxM. */
const SPREAD_LEG_MAX_M = 25;
/** G2: leg sweeps a step of the spread walk may spend (estimate: the options sorted by the wanted way, not by distance,
 *  put more blocked legs first) */
const SPREAD_SWEEPS_PER_STEP = 2048;
/** G2: the free radius that still adds to a candidate's score, flown m (estimate: half a narrow street) */
const SPREAD_ROOM_M = 4;
/** G2: the most candidate cells the spread walk reads (estimate: a step scans them all, 24 steps stay under a second) */
const SPREAD_POOL_MAX = 250_000;
/** G2: how many times a spread walk may step back from a dead end (estimate) */
const SPREAD_BACKTRACKS = 8;
/** F3: the straight distance from the start from which a cell counts for the steps-per-metre ratio (estimate: nearer
 *  cells are a few steps around the spawn's own corner) */
const SPREAD_RATIO_MIN_M = 20;
/** F3 (message 51: "the street is long and scanned further with the same density, but there are no obstacles there"):
 *  the second arm's target B lies on the other side of the start when the way from A to it is at least its own steps
 *  plus this share of A's (estimate: the way A to B passes near the start). Wroclaw courses went out one arm of the
 *  crossing only (audit F3, course3-70b50d42-top.png). */
const SPREAD_ARM_APART = 0.8;
/** F3: a second arm is taken only when its way is at least this long, in metres times the plan's scale (estimate: about
 *  two legs; a stub of a few metres behind the spawn, as at a street's closed end, keeps the one-arm walk). A share of
 *  the first arm (0.5) left Tunis one-armed once the arms were planned in straight metres (audit4). */
const SPREAD_ARM_MIN_M = 30;
/** course5 Z2: the nearest candidates a start with no first leg may move to (estimate: each is a scan of the candidates) */
const START_MOVE_TRIES = 64;

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

/**
 * Stage X3 (train 3, lane fix3a): a closed course starts at the gate nearest the scene's spawn (straight distance, flown
 * world; ties keep the lower number). The ring is turned, not changed: the same gates in the same places, the same direction
 * of travel, renumbered g1.. from that gate. Turning it changes two legs (the leg back to the start now closes before the
 * new gate 1, and the old last and first gates are joined directly), so the turned ring is kept only when `proven` holds
 * for it (the whole-course proof); otherwise, and for an open course, the generator's order stays. `yawOf` gives the start
 * yaw toward a course's gate 1. Measured on 50 courses (tools/bench/src/gate-one-audit.ts, docs/wip/fix3a.md): on 32 of
 * 33 closed rings the nearest gate was not gate 1.
 */
export function startNearSpawn(
    course: readonly TrackGate[],
    spawn: Vec3,
    toFlown: (q: Vec3) => Vec3,
    proven: (gates: TrackGate[], startYaw: number) => boolean,
    yawOf: (gates: readonly TrackGate[]) => number
): TrackGate[] {
    if (course.length < 2) return [...course];
    let k = 0;
    let best = Infinity;
    course.forEach((g, i) => {
        const d = dist2(toFlown(g.pos as Vec3), spawn);
        if (d < best) {
            best = d;
            k = i;
        }
    });
    if (k === 0) return [...course];
    const turned = [...course.slice(k), ...course.slice(0, k)].map((g, i) => ({ ...g, id: `g${i + 1}` }));
    return proven(turned, yawOf(turned)) ? turned : [...course];
}

/**
 * Review FX-5: generator.version of a course; a closed ring turned to start near the spawn adds `.s<shift>` (its gate 1
 * was gate shift + 1 of the walk), so course/link.ts bestKey keeps its best laps apart from the unturned order. A course
 * that was not turned keeps the plain version, and its best laps keep their keys.
 */
export function generatorVersion(quality: boolean, startShift: number, elements = false): string {
    // course5 Z3: '.e2' since a refused element is drawn again at a later gate (another course than '.e1' for a seed)
    const v = (quality ? GENERATOR_VERSION_QUALITY : GENERATOR_VERSION) + (elements ? '.e2' : '');
    return startShift > 0 ? `${v}.s${startShift}` : v;
}

/** The course's title for a seed: 'Course ' and the seed in base 36 (plan section 7). */
export function courseTitle(seed: number): string {
    return `Course ${(seed >>> 0).toString(36)}`;
}

/** The course's id for a seed (the link form g1.<seed>). */
export function courseId(seed: number): string {
    return `g1.${(seed >>> 0).toString(36)}`;
}

export function generateCourse(free: FreeSpace, walls: VoxelCollision, opts: CourseOptions): TrackFile {
    // F3: over a quality map the two-arm walk comes first; when it ends short of N gates (it stopped in a narrow place
    // between its arms: eb5f51dc seed 1 kept 6, Tunis seeds 2, 19, 20 kept 9-10 in audit5) the one-arm walk of the same
    // seed is tried too and the course with more gates kept (a tie keeps the two-arm course). onWalk hears the kept walk.
    if (!opts.quality) return walkCourse(free, walls, opts, false);
    let infoA: WalkInfo | null = null;
    const a = walkCourse(free, walls, { ...opts, onWalk: (w) => (infoA = w) }, false);
    const want = (a.generator?.params as { wanted?: number } | undefined)?.wanted ?? 0;
    if (a.gates.length >= want) {
        if (infoA) opts.onWalk?.(infoA);
        return a;
    }
    let infoB: WalkInfo | null = null;
    const b = walkCourse(free, walls, { ...opts, onWalk: (w) => (infoB = w) }, true);
    const keep = b.gates.length > a.gates.length ? b : a;
    const info = keep === b ? infoB : infoA;
    if (info) opts.onWalk?.(info);
    return keep;
}

function walkCourse(free: FreeSpace, walls: VoxelCollision, opts: CourseOptions, oneArm: boolean): TrackFile {
    const p: CourseParams = { ...COURSE_DEFAULTS, ...(opts.params ?? {}) };
    const seed = opts.seed >>> 0;
    const rng = (opts.rng ?? createRng)(seed);
    const T = opts.transform;
    const s = T[0];
    const toScan = (w: Vec3): Vec3 => [r3((w[0] - T[1]) / s), r3((w[1] - T[2]) / s), r3((w[2] - T[3]) / s)];
    const toFlown = (q: Vec3): Vec3 => [s * q[0] + T[1], s * q[1] + T[2], s * q[2] + T[3]];
    const sweeper = sweeperOf(walls);
    const P = opts.place;
    const N = P ? P.gates : courseCount(free.volumeM3, p);
    const k = p.scale;

    // candidates: usable cells roomy enough for a ring, then a farthest-point sample
    let all: number[] = [];
    for (let i = 0; i < free.room.length; i++) if (free.room[i]! >= 0 && clearanceM(free, i) >= (opts.quality ? EYE_FREE_M : RING_MIN_FREE_M) * k) all.push(i);
    // gen4a A2: only the cells of the asked zone
    if (P) all = all.filter((i) => P.at(cellCentre(free, i)));
    // G2: only cells in the dense band over a well-scanned tile, when there are enough of them
    const Q = opts.quality;
    let banded = false;
    // fix3b Y2: over a quality map the gates stand at the eye level of a person (EYE_LO_M to EYE_HI_M above the ground under
    // them, moved toward EYE_M inside their cell as far as the cell's free radius allows) in tiles of at least POOR_SHARE
    // of the best quarter's quality; the band's top is raised by the least amount when too few cells lie in it
    let eyeHi = 0;
    const eyeAt = new Map<number, { pos: Vec3; free: number }>();
    // review FY-6: a person's eye level means something only on a scan flown at its true size and at the plan's course size;
    // a scaled course or a scan flown bigger or smaller (a macro scan) goes straight to the dense band
    if (Q && k === 1 && Math.abs(s - 1) <= EYE_SCALE_TOL) {
        const rMin = EYE_FREE_M * k;
        const slack = 1; // estimate: the tile's ground against the ground under the cell (a step, a slope)
        const near: { i: number; c: Vec3; h: number; d: number; free: number }[] = [];
        for (const i of all) {
            const c = cellCentre(free, i);
            const t = tileOf(Q, c);
            if (t < 0 || !Q.good[t] || qualityShare(Q, c) < POOR_SHARE) continue;
            const ht = c[1] - Q.ground[t]!;
            if (!(ht > -slack && ht < Math.max(EYE_HI_M, Q.band[1]) + slack)) continue;
            const g = standGround(walls, Q, c, Math.max(EYE_HI_M, Q.band[1]) + slack);
            if (!Number.isFinite(g)) continue;
            const fr = clearanceM(free, i);
            near.push({ i, c, h: c[1] - g, d: Math.max(0, Math.min(free.cellM / 2, fr - rMin)), free: fr });
        }
        const top = Math.max(EYE_HI_M, Q.band[1]);
        for (let hi = EYE_HI_M; hi <= top + 1e-9 && !banded; hi += EYE_STEP_M) {
            const got: { i: number; pos: Vec3; free: number }[] = [];
            for (const e of near) {
                const y = Math.min(e.h + e.d, Math.max(e.h - e.d, EYE_M));
                const fr = e.free - Math.abs(y - e.h);
                const half = fr >= SQUARE_MIN_FREE_M * k ? (SQUARE_SIDE_M / 2 + SQUARE_BAR_M) * k : (RING_DIAMETER_M / 2 + RING_TUBE_M / 2) * k;
                if (y >= EYE_LO_M && y <= hi + 1e-9 && y - half >= LOW_EDGE_M) got.push({ i: e.i, pos: [e.c[0], e.c[1] + (y - e.h), e.c[2]], free: fr });
            }
            if (got.length >= BAND_CANDS_PER_GATE * N) {
                all = got.map((e) => e.i);
                for (const e of got) eyeAt.set(e.i, { pos: e.pos, free: e.free });
                eyeHi = r3(hi);
                banded = true;
            }
        }
    }
    if (Q && !banded) {
        all = all.filter((i) => clearanceM(free, i) >= RING_MIN_FREE_M * k);
        const inBand = all.filter((i) => inDenseBand(Q, cellCentre(free, i)));
        if (inBand.length >= BAND_CANDS_PER_GATE * N) {
            all = inBand;
            banded = true;
        }
    }
    // G2: the spread walk reads a denser pool: 20 000 cells over a 240 m box left 31 within a leg of a gate on eb5f51dc,
    // all 5 that the turn allowed behind a wall (G2_DEBUG run of seed 3)
    const stride = Math.max(1, Math.ceil(all.length / (banded ? SPREAD_POOL_MAX : POOL_MAX)));
    const offset = all.length > 0 ? rng.int(0, stride - 1) : 0;
    const pool: number[] = [];
    for (let k = offset; k < all.length; k += stride) pool.push(all[k]!);
    // the walk reads the whole (strided) pool: a farthest-point sample of 8 per gate spread 192 points over 47 000 m3 of
    // Winter Garden, so after 1-4 gates no sample lay 3-15 m from the last (evidence run of bf7dc3d9: tries 6-11)
    // fix3b Y2: an eye-level course's leg stays in the well-scanned part: every LEG_STEP_M along it at least POOR_SHARE (the
    // walk's legs and, at the end, every leg of the finished course: a dropped gate joins its neighbours, a closed course
    // flies from its last gate back to the start)
    // a start (the scan's spawn) in a poor tile is where the pilot begins anyway: its legs are not judged
    let startPoor: Vec3 | null = null;
    const legWell = (a: Vec3, b: Vec3): boolean => {
        if (!Q || eyeHi === 0 || a === startPoor || b === startPoor) return true;
        const dx = b[0] - a[0], dz = b[2] - a[2];
        const n = Math.max(1, Math.ceil(Math.sqrt(dx * dx + dz * dz) / LEG_STEP_M)); // sqrt, not hypot: check-architecture's rule
        for (let j = 0; j <= n; j++) if (qualityShare(Q, [a[0] + ((b[0] - a[0]) * j) / n, 0, a[2] + ((b[2] - a[2]) * j) / n]) < POOR_SHARE) return false;
        return true;
    };
    const cands = pool.map((i) => ({ cell: i, pos: eyeAt.get(i)?.pos ?? cellCentre(free, i), free: eyeAt.get(i)?.free ?? clearanceM(free, i), used: false }));
    // course4 C3: a smaller course (scale < 1, the ladder's lower steps) starts where a ring could stand: the nearest cell
    // (in steps along the free space) with a ring's free radius. Winter Garden 7a475d38's spawn cell has a free radius of
    // 0.256 m; every leg from it hit a wall at the 0.2 m margin of step 0.4 (gate-place-audit walks: wall 360 of 360,
    // no gate laid). The plan's size keeps its start, so its courses and trackDigests stay as they were.
    let startCell = free.startCell;
    // gen4a A2: the course starts in the scan's best part (the zone's cell nearest the core), not at the spawn
    if (P) {
        let bd = Infinity;
        startCell = -1;
        for (const i of all) {
            const d = dist2(cellCentre(free, i), P.start);
            if (d < bd) {
                bd = d;
                startCell = i;
            }
        }
    }
    if (k !== 1 && startCell >= 0 && clearanceM(free, startCell) < RING_MIN_FREE_M * k) {
        const S0 = stepsFrom(free, startCell);
        let best = -1;
        for (let i = 0; i < S0.length; i++) if (S0[i]! > 0 && (best < 0 || S0[i]! < S0[best]!) && clearanceM(free, i) >= RING_MIN_FREE_M * k) best = i;
        if (best >= 0) startCell = best;
    }

    // G2 spread walk (only over a quality map): the way along the free space from the start (fromS) and to a seeded far
    // target (toT), both in cell steps. The out half lays its gates evenly along the way to the target, the back half
    // evenly along the way home, so a long street gets gates along its length and the count is the same N every time.
    const halfN = Math.ceil(N / 2);
    let fromS: Int32Array | null = null;
    let toT: Int32Array | null = null;
    let farM = 0;
    // G4: a course over a quality map may take longer legs (the way out and its gates reach along the street)
    const legMaxM = Q ? Math.max(p.legMaxM, SPREAD_LEG_MAX_M * k) : p.legMaxM;
    // course5 Z2: a start from which no candidate is a first leg moves to the candidate nearest to it that has one. Forest
    // Floor ab5efa0e at Scene size x15 and x20: the spawn stood 21 m and 28 m straight over the nearest candidate, so every
    // first leg failed the leg rules (gate-place-audit walks: turn 5922 of 2961 candidates, course4/z2/ff-x15.json). A
    // start that has a first leg keeps its place, so every course laid before stays as it was.
    if (startCell >= 0 && cands.length > 0) {
        const firstLeg = (a: Vec3, b: Vec3): boolean => {
            const leg = sub(b, a);
            const L = len(leg);
            if (L < p.legMinM || L > legMaxM) return false;
            const u: Vec3 = [leg[0] / L, leg[1] / L, leg[2] / L];
            return dot(yawForward(nearestYaw(u)), u) >= p.axisCosMin;
        };
        const hasLeg = (a: Vec3): boolean => cands.some((c) => firstLeg(a, c.pos));
        const s0 = cellCentre(free, startCell);
        if (!hasLeg(s0)) {
            const byNear = cands.map((c) => ({ c, d: dist2(s0, c.pos) })).sort((x, y) => x.d - y.d);
            for (let j = 0; j < Math.min(byNear.length, START_MOVE_TRIES); j++) {
                const c = byNear[j]!.c;
                // where a ring could stand (course4 C3's rule for the start), so a start in a nook does not stay in it
                if (clearanceM(free, c.cell) >= RING_MIN_FREE_M * k && hasLeg(cellCentre(free, c.cell))) {
                    startCell = c.cell;
                    break;
                }
            }
        }
    }
    // F3: the walk's phases: gates up to ends[i] head for pots[i] (null: the plain walk). One arm: out to the far
    // target, then home. Two arms (over a map, when the start has way on both sides): out to A, across the start to B,
    // then home, the gates shared by the phases' lengths.
    let ends: number[] = [halfN, N];
    let pots: (Int32Array | null)[] = [null, null];
    if (Q && startCell >= 0) {
        const S = stepsFrom(free, startCell);
        fromS = S;
        let maxS = 0;
        for (const c of cands) maxS = Math.max(maxS, S[c.cell]!);
        // F3: steps run along the grid's axes, legs straight: on Wroclaw's diagonal streets a metre flown took about 1.4
        // steps, so the way planned in steps reached about 80 m an arm (audit3). The planned way is scaled by the scan's
        // median steps per metre of straight distance (cells at least SPREAD_RATIO_MIN_M away; clamp 1-1.8, estimate).
        const ratios: number[] = [];
        for (const c of cands) {
            const d = Math.sqrt(dist2(c.pos, cellCentre(free, startCell)));
            if (S[c.cell]! > 0 && d >= SPREAD_RATIO_MIN_M) ratios.push((S[c.cell]! * free.cellM) / d);
        }
        ratios.sort((a, b) => a - b);
        const perM = ratios.length ? Math.min(1.8, Math.max(1, ratios[ratios.length >> 1]!)) : 1;
        const W = Math.round((N * SPREAD_LEG_SHARE * legMaxM * perM) / free.cellM);
        const pick = (D: number, ok: (c: (typeof cands)[number]) => boolean = () => true): (typeof cands)[number] | null => {
            const far = D > 0 ? cands.filter((c) => S[c.cell]! >= SPREAD_FAR_MIN * D && S[c.cell]! <= D && ok(c)) : [];
            return far.length > 0 ? far[rng.int(0, far.length - 1)]! : null;
        };
        // two arms: A within a quarter of the whole way, B on the other side of the start within what is left
        const A = oneArm ? null : pick(Math.min(maxS, Math.round(W / 4)));
        const toA = A ? stepsFrom(free, A.cell) : null;
        let B: (typeof cands)[number] | null = null;
        if (A && toA) {
            const sA = S[A.cell]!;
            const apart = (c: (typeof cands)[number]): boolean => toA[c.cell]! >= 0 && toA[c.cell]! >= S[c.cell]! + SPREAD_ARM_APART * sA;
            let maxB = 0;
            for (const c of cands) if (S[c.cell]! > 0 && apart(c)) maxB = Math.max(maxB, S[c.cell]!);
            const DB = Math.min(maxB, Math.round(W / 2) - sA);
            if (DB * free.cellM >= SPREAD_ARM_MIN_M * k * perM) B = pick(DB, apart);
        }
        if (A && toA && B) {
            const toB = stepsFrom(free, B.cell);
            const la = S[A.cell]!, lab = Math.max(1, toB[A.cell]!), lb = S[B.cell]!;
            const sum = la + lab + lb;
            const nA = Math.max(1, Math.round((N * la) / sum)), nAB = Math.max(1, Math.round((N * lab) / sum));
            ends = [nA, Math.min(N - 1, nA + nAB), N];
            pots = [toA, toB, S];
            toT = toA;
            farM = Math.max(la, lb) * free.cellM;
        } else {
            // one arm (the walk before F3): the far target within the planned way out
            const t = pick(Math.min(maxS, Math.round((halfN * SPREAD_LEG_SHARE * legMaxM) / free.cellM)));
            if (t) {
                toT = stepsFrom(free, t.cell);
                farM = S[t.cell]! * free.cellM;
            }
            pots = [toT, S];
        }
    }
    const last = ends.length - 1;
    const phaseOf = (n: number): number => {
        for (let i = 0; i < last; i++) if (n < ends[i]!) return i;
        return last;
    };
    let forced = 0;
    let curCell = startCell;

    const startW: Vec3 = startCell >= 0 ? cellCentre(free, startCell) : [T[1], T[2], T[3]];
    if (Q && qualityShare(Q, startW) < POOR_SHARE) startPoor = startW;
    const shapeFor = (freeM: number): TrackGate['shape'] =>
        freeM >= SQUARE_MIN_FREE_M * k ? { kind: 'square', side: r3((SQUARE_SIDE_M * k) / s), bar: r3((SQUARE_BAR_M * k) / s) } : { kind: 'ring', diameter: r3((RING_DIAMETER_M * k) / s), tube: r3((RING_TUBE_M * k) / s) };
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
        generator: { name: GENERATOR_NAME, version: Q ? GENERATOR_VERSION_QUALITY : GENERATOR_VERSION, seed, params: {} },
        created: opts.created ?? '2026-01-01T00:00:00.000Z'
    });

    const gates: TrackGate[] = [];
    const flownGates: Vec3[] = [];
    let cur = startW;
    let prevDir: Vec3 | null = null;
    let tries = 0;
    let stop = 'tries';
    let back = false;
    let outGates = -1;
    let backtracks = 0;
    const trail: { cur: Vec3; cell: number; dir: Vec3 | null }[] = [];
    const legMemo = new Map<number, boolean>();
    let legMemoAt: Vec3 | null = null;
    let nearM = Infinity;
    let nearUp = 0;
    for (const c of cands) {
        const d = dist2(startW, c.pos);
        if (d < nearM) {
            nearM = d;
            nearUp = c.pos[1] - startW[1];
        }
    }
    // course5 Z2: how far the nearest candidate lies from the start (m) and how much higher: a scan flown at a large Scene
    // size had every first leg refused by the leg bounds
    const refused = { cands: cands.length, nearM: r3(Math.sqrt(nearM)), nearUp: r3(nearUp), legMaxM: r3(legMaxM), startFree: startCell >= 0 ? r3(clearanceM(free, startCell)) : -1, reach: 0, pot: 0, turn: 0, space: 0, sweep: 0, wall: 0, exit: 0, well: 0, proof: 0 };
    const turnOk = (from: Vec3, prev: Vec3 | null, to: Vec3): Vec3 | null => {
        const leg = sub(to, from);
        const L = len(leg);
        if (L < p.legMinM || L > legMaxM) return null;
        const u: Vec3 = [leg[0] / L, leg[1] / L, leg[2] / L];
        if (prev && dot(u, prev) < p.turnCosMin) return null;
        if (dot(yawForward(nearestYaw(u)), u) < p.axisCosMin) return null;
        if (P && Math.abs(leg[1]) > P.climbMax * Math.sqrt(leg[0] * leg[0] + leg[2] * leg[2])) return null;
        return u;
    };
    while (gates.length < N && tries < p.tries) {
        const options: { c: (typeof cands)[number]; u: Vec3; score: number }[] = [];
        // out (first half): within OUT_LEGS legs of the start; back: toward the start. A walk with nothing in reach turns back.
        // G2: over a quality map the walk keeps going out along the well-scanned extent and turns back only when nothing is
        // ahead: a street has no room for a U-turn of at most 120 degrees, so the half-way turn ended eb5f51dc's walks at
        // 9 of 24 gates (audit seeds 1-2); the course then stays open (laps 1) unless its last gates see the start
        const phase = Math.max(forced, phaseOf(gates.length));
        back = phase === last;
        if (back && outGates < 0) outGates = gates.length;
        // G2: over a quality map the out half spreads over the whole well-scanned box (Wroclaw: every course stayed within
        // 30 m of the start on a street scanned for 300 m)
        const spread = fromS !== null && pots[phase] !== null;
        const reach2 = spread ? Infinity : P ? P.reachM * P.reachM : OUT_LEGS * OUT_LEGS * p.legMaxM * p.legMaxM;
        // G2: the step count the next gate should have: the rest of the way shared evenly by the gates still to lay
        const pot = pots[phase] ?? null;
        const left = Math.max(1, ends[phase]! - gates.length);
        const want = spread && pot && curCell >= 0 && pot[curCell]! >= 0 ? (pot[curCell]! * (left - 1)) / left : 0;
        for (const c of cands) {
            if (!back && dist2(startW, c.pos) > reach2) {
                refused.reach++;
                continue;
            }
            if (c.used) continue;
            if (spread && pot![c.cell]! < 0) {
                refused.pot++;
                continue;
            }
            const u = turnOk(cur, prevDir, c.pos);
            if (!u) {
                refused.turn++;
                continue;
            }
            let near = Infinity;
            for (const g of flownGates) near = Math.min(near, dist2(g, c.pos));
            near = Math.min(near, dist2(startW, c.pos));
            if (near < p.spacingM * p.spacingM) {
                refused.space++;
                continue;
            }
            // out: away from what is laid; back (the second half): toward the start, so the lap can close.
            // G2: nearest to the wanted step count along the way
            // (in m, plus the free radius up to SPREAD_ROOM_M: the middle of a street, where a leg is free more often)
            const score = spread ? -Math.abs(pot![c.cell]! - want) * free.cellM + Math.min(c.free, SPREAD_ROOM_M) : back ? -dist2(startW, c.pos) : near;
            options.push({ c, u, score });
        }
        options.sort((a, b) => b.score - a.score);
        // the best 4 whose leg is free (at most SWEEPS_PER_STEP sweeps); a blocked leg does not use the candidate up,
        // it may be free from the next gate (marking it used left the walk back 20 m short of the start on Winter Garden)
        const open: typeof options = [];
        // K1.2: a smaller course (scale < 1, a small scan) skips a gate with no way on from it: in a 4 x 3 x 4 m room the
        // walk went to a corner first, where every next leg turned back more than turnCosMin allows (the walk stopped at
        // 1 gate). The plan's size keeps its walk, so its courses and trackDigests stay as they were.
        const wayOn = (o: (typeof options)[number]): boolean => {
            if (k === 1) return true;
            for (const c2 of cands) if (!c2.used && c2 !== o.c && turnOk(o.c.pos, o.u, c2.pos)) return true;
            return false;
        };
        const sweepsMax = spread ? SPREAD_SWEEPS_PER_STEP : SWEEPS_PER_STEP;
        // CR-4: over a quality map the turn out of the last gate toward the candidate (path.ts gateExit, as check.ts proves
        // it for the whole course) must be clear too: with 25 m legs on a street that turn hit a wall and the final proof
        // dropped up to 10 of 24 walked gates (Wroclaw audit seed 4). Courses without a map keep their walk and digests.
        const lastIn = Q && gates.length > 0 && prevDir ? sub(cur, trail[trail.length - 1]!.cur) : null;
        const lastAxis = lastIn && prevDir ? yawForward(nearestYaw(prevDir)) : null;
        const exitOk = (to: Vec3): boolean => {
            if (!lastIn || !lastAxis) return true;
            const e = gateExit(cur, lastAxis, lastIn, sub(to, cur));
            return !e || sweeper.free(e, to, p.marginM);
        };
        // F2: a gate refused by its one-gate proof leaves the walk where it stands, and the next round swept the same legs
        // again; while `cur` stays the same object (a laid gate or a step-back replaces it) the answers are kept
        if (legMemoAt !== cur) {
            legMemo.clear();
            legMemoAt = cur;
        }
        const legOk = (c: (typeof cands)[number]): boolean => {
            let v = legMemo.get(c.cell);
            if (v === undefined) {
                const wall = sweeper.free(cur, c.pos, p.marginM);
                const ex = wall && exitOk(c.pos);
                v = ex && legWell(cur, c.pos);
                if (!wall) refused.wall++;
                else if (!ex) refused.exit++;
                else if (!v) refused.well++;
                legMemo.set(c.cell, v);
            }
            return v;
        };
        for (let j = 0, sweeps = 0; j < options.length && open.length < 4 && sweeps < sweepsMax; j++, sweeps++) {
            if (legOk(options[j]!.c) && wayOn(options[j]!)) open.push(options[j]!);
            else refused.sweep++;
        }
        // G2: a spread walk that is stuck steps back one gate (left used: a dead end) and walks on from the gate before
        if (open.length === 0 && spread && gates.length > 0 && backtracks < SPREAD_BACKTRACKS * (ends.length - 1)) {
            backtracks++;
            gates.pop();
            flownGates.pop();
            const prev = trail.pop()!;
            cur = prev.cur;
            curCell = prev.cell;
            prevDir = prev.dir;
            // CR-6: a step-back below the gate where the walk turned home puts it back on the way out (else the out half
            // ends short of the far target and the walk heads home from a gate of the out half)
            // F3: the same for a step-back below the start of the phase the walk was forced into
            // (a phase without a target is not walked back into: the walk before F3 stayed on its way home there)
            const was = phaseOf(gates.length);
            if (pots[was] === null) forced = Math.max(forced, phase);
            else if (forced > was) forced = was;
            if (toT !== null && outGates > gates.length) {
                back = false;
                outGates = -1;
            }
            continue;
        }
        if (open.length === 0) {
            if (!back) {
                // a dead end of a phase: the walk heads for the next phase's target
                forced = phase + 1;
                if (forced === last) outGates = gates.length;
                continue;
            }
            stop = options.length === 0 ? 'no candidate in reach' : 'no free leg';
            break;
        }
        const o = open[rng.int(0, open.length - 1)]!;
        o.c.used = true;
        tries++;
        const yk = nearestYaw(o.u);
        const gate: TrackGate = { id: `g${gates.length + 1}`, shape: shapeFor(o.c.free), pos: toScan(o.c.pos), quat: yawQuatStep(yk), direction: 'forward' };
        // one-gate proof: the leg from where the walk stands and this gate's opening, frame and run (the whole course is
        // proven once at the end); proving the whole course per candidate cost about 44 s a course on real walls
        const trial = build([gate], yk, cur, 1); // open: the one-gate proof has no leg out (laps did not matter to it before K1)
        if (!checkTrack(trial, walls, T, p.marginM, false, true).ok) {
            refused.proof++;
            continue;
        }
        trail.push({ cur, cell: curCell, dir: prevDir });
        gates.push(gate);
        flownGates.push(toFlown(gate.pos));
        cur = flownGates[flownGates.length - 1]!;
        curCell = o.c.cell;
        prevDir = o.u;
    }

    // the finished course, proven whole. Closed (laps) when a gate at least half way along sees the start: the course
    // ends there. Otherwise it stays open (laps 1, no leg back): popping gates until the last sees the start left 1-2
    // gates on big scans.
    const renumber = (gs: TrackGate[]): TrackGate[] => gs.map((g, i) => ({ ...g, id: `g${i + 1}` }));
    // F3: a two-arm walk passes the start between its arms; the gate there sees the start too, and closing the course at it
    // cut 9-12 of 24 gates on Wroclaw (audit2). Such a course closes only in its home phase (from the gate where the walk
    // turned home; gates dropped since the walk shift that index down).
    const homeFrom = ends.length > 2 ? (outGates >= 0 ? outGates : ends[last - 1]!) : 0;
    const closeAt = (gs: TrackGate[]): number => {
        // gen4a A2 (G4): an asked course always closes, at the last gate that sees the start
        const low = P ? 1 : Math.max(1, Math.ceil(gs.length / 2), homeFrom - (gates.length - gs.length) + 1);
        // review FY-1: the ring ends only at a gate whose legs home (to the start and on to gate 1) run over a well-scanned
        // scan; judging them after the cut dropped one last gate a time and thinned Wroclaw seed 1 from 24 walked to 18
        for (let n = gs.length; n >= low; n--) {
            const end = toFlown(gs[n - 1]!.pos);
            // gen4a A3: an asked course's closing leg (last gate to gate 1, flown on every lap) keeps the server's leg limit
            // (1994c65c pro compact seed 1 closed over 60 m and the Save refused it)
            if (P && len(sub(end, toFlown(gs[0]!.pos))) > MAX_LEG_M) continue;
            if (sweeper.free(end, startW, p.marginM) && legWell(end, startW) && legWell(end, toFlown(gs[0]!.pos))) return n;
        }
        return 0;
    };
    let course = renumber(gates);
    let laps = p.laps;
    let cutClose = 0;
    const drops: string[] = [];
    for (let guard = 0; guard < 2 * p.tries && course.length > 0; guard++) {
        const n = closeAt(course);
        if (n > 0) {
            cutClose += course.length - n;
            course = renumber(course.slice(0, n));
            laps = p.laps;
        } else laps = 1;
        const startYaw = nearestYaw(sub(toFlown(course[0]!.pos), startW));
        const r = checkTrack(build(course, startYaw, startW, laps), walls, T, p.marginM, false, true);
        // fix3b Y2: the first leg of the finished course that crosses a poor tile (point 0 is the start; a closed course
        // also flies from its last gate to the start and to gate 1): its far gate is dropped (the last gate for the way home)
        const pts = [startW, ...course.map((g) => toFlown(g.pos))];
        let poor = -1;
        for (let i = 0; i + 1 < pts.length && poor < 0; i++) if (!legWell(pts[i]!, pts[i + 1]!)) poor = i;
        if (poor < 0 && laps > 1 && (!legWell(pts[pts.length - 1]!, startW) || !legWell(pts[pts.length - 1]!, pts[1]!))) poor = course.length - 1;
        if (r.ok && poor < 0) break;
        const bad = r.gates.findIndex((g) => !g.clear || !g.directionOk);
        const badLeg = r.legs.findIndex((l) => !l.clear);
        const drop = bad >= 0 ? bad : badLeg >= 0 ? Math.max(0, badLeg - 1) : !r.ok ? course.length - 1 : Math.min(poor, course.length - 1);
        drops.push(bad >= 0 ? 'gate' : badLeg >= 0 ? 'leg' : !r.ok ? 'last' : 'poor');
        course = renumber(course.filter((_, i) => i !== drop));
    }
    if (course.length === 0) laps = p.laps;
    // review FX-5: a course turned to start near the spawn is another course for its best laps: generatorVersion
    // records the turn (the server keeps a fixed list of params keys, the version is a free string)
    const walked = course;
    // review FY-4: the turned ring's first leg (start to the gate nearest the spawn) is judged for a poor scan too
    if (laps > 1) course = startNearSpawn(course, opts.spawn ?? startW, toFlown, (gs, yaw) => legWell(startW, toFlown(gs[0]!.pos)) && checkTrack(build(gs, yaw, startW, laps), walls, T, p.marginM, false, true).ok, (gs) => nearestYaw(sub(toFlown(gs[0]!.pos), startW)));
    const startShift = course.length ? Math.max(0, walked.findIndex((g) => g.pos === course[0]!.pos)) : 0;
    let startYaw = course.length ? nearestYaw(sub(toFlown(course[0]!.pos), startW)) : 0;
    // course4 C4: the proven course composed into elements; each element is proven with its neighbours, and the whole
    // course once more (a course that fails it keeps its single gates)
    let composed = false;
    if (opts.elements && course.length > 0) {
        const single = course;
        const comp = composeElements({
            gates: course, closed: laps > 1, start: startW, toFlown: (q) => toFlown(q), toScan, s, k, marginM: p.marginM, sweeper,
            axisOf: (g) => { const q = g.quat; const w = q[0], y = q[2]; return [r6(-2 * w * y), 0, r6(-(1 - 2 * y * y))]; },
            legWell, rng: (opts.rng ?? createRng)((seed ^ 0x5eed1) >>> 0), maxGates: Math.min(SERVER_MAX_GATES, P?.maxGates ?? SERVER_MAX_GATES),
            proven: (gs, from) => checkTrack(build(gs, nearestYaw(sub(toFlown(gs[0]!.pos), from)), from, 1), walls, T, p.marginM, false, true).ok
        });
        opts.onElements?.(comp);
        // gen4a A2: an asked course keeps its composed elements only when every gate of them stands in its zone
        const inZone = !P || comp.gates.every((g) => P.at(toFlown(g.pos as Vec3)));
        if (inZone && (comp.gates.length !== single.length || comp.gates.some((g, i) => g.shape.kind !== single[i]!.shape.kind))) {
            const yaw = nearestYaw(sub(toFlown(comp.gates[0]!.pos), startW));
            if (checkTrack(build(comp.gates, yaw, startW, laps), walls, T, p.marginM, false, true).ok) {
                course = comp.gates;
                startYaw = yaw;
                composed = true;
            }
        }
    }
    const shell = build(course, startYaw, startW, laps);
    // unmeasured: the free-radius probes of a measured proof took about 5 s on the three-room test world (time-scratch run,
    // docs/wip/tracks.md Findings); the caller measures when it needs the numbers
    const proof = course.length ? checkTrack(shell, walls, T, p.marginM, false, true) : null;
    opts.onWalk?.({ band: Q ? [r3(Q.band[0]), r3(Q.band[1])] : null, banded, eyeHi, farM: r3(farM), outGates, backtracks, wanted: N, walked: gates.length, cutClose, drops, kept: course.length, refused, stop });
    return {
        ...shell,
        generator: {
            name: GENERATOR_NAME,
            // course4 review CU-3: '.e1' only when the elements changed the course; an unchanged one keeps its key
            version: P ? `${P.version}${composed ? '.e2' : ''}${startShift > 0 ? `.s${startShift}` : ''}` : generatorVersion(!!Q, startShift, composed),
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
                proof: proof ? { ok: proof.ok, marginM: p.marginM, pathM: proof.pathM } : null,
                // only a scaled course says so: the plan's size keeps its params and trackDigest as before K1.2
                ...(k !== 1 ? { scale: k, legMinM: r3(p.legMinM), legMaxM: r3(p.legMaxM) } : {})
                // CR-1: the walk's diagnostics of a course over a quality map go to opts.onWalk, not here: the server
                // refuses params keys it does not know (generator.version '2' marks such a course)
            }
        }
    };
}
