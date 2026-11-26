// Lane gen4a (train 4, design gen4.md section 3): the course the pilot asked for (request.ts) on the walls of the flight.
//
//   analyse   analyzeScan: the quality map, the scanned territory, ground, roofs, ceilings, the core and the kind (scan.ts).
//   size      D = the flown craft's diameter; the gate's opening is the level's openingD x D (the ladder step k =
//             opening / RING_DIAMETER_M, so the old gate shapes, margins and proofs are reused through scaledParams), and
//             it steps down to RING_MIN_DRONE_DIAMETERS (4 D) when nothing fits (shrunk).
//   zone      a gate's centre stands inside the scanned territory (footprint, over groundTop + the low edge, under
//             roofTop + 2 openings), on a tile of quality >= GOOD_Q (not with anyQuality), and by the scan's kind: a room
//             under its ceiling, a city from above at least CITY_LOW_M x unit over the ground (between and over the roofs),
//             a street at eye level, an object near its core, plants under their leaves' top. Compact keeps within
//             zoneR of the core, wide takes the whole footprint.
//   walk      generateCourse with CourseOptions.place: the plain walk from the zone's cell nearest the core, out within
//             zoneR and home; always closed (generate.ts closeAt).
//   relax     when the zone holds too few candidates, the quality rule and then the kind rule are dropped (never a
//             refusal while a gate fits anywhere in the territory).
import { COURSE_DEFAULTS, EYE_HI_M, EYE_LO_M, LOW_EDGE_M, RING_DIAMETER_M, RING_MIN_FREE_M, RING_TUBE_M, SQUARE_BAR_M, SQUARE_SIDE_M, courseTitle, generateCourse } from './generate';
import type { CoursePlace } from './generate';
import { RING_MIN_DRONE_DIAMETERS, SMALLEST_DRONE_RADIUS_M, freeAtMargin, scaledParams } from './fit';
import { FREE_DEFAULTS, clearanceM, cellCentre } from './freespace';
import type { FreeSpace } from './freespace';
import { flownStart } from './check';
import { MAX_LEG_M } from './server';
import { analyzeScan, scanTile } from './scan';
import type { ScanAnalysis } from './scan';
import { LEVELS, VOXEL_VIEW_GATES, courseLinkId } from './request';
import type { CourseLevel, CourseRequest, LevelRules, PlanAnswer, PlanHooks, PlanInput, PlanStats } from './request';
import type { SceneTransform, TrackFile, TrackGate, Vec3 } from './types';

/** a tile is well scanned from this share of the scan's best tenth (ESTIMATE, design section 3) */
export const GOOD_Q = 0.5;
/** cityAbove: a gate's centre stands at least this many m x unit over the ground (ESTIMATE, design: 4 m) */
export const CITY_LOW_M = 4;
/** candidates per wanted gate below which a zone rule is dropped (ESTIMATE: generate.ts BAND_CANDS_PER_GATE) */
export const ZONE_CANDS_PER_GATE = 8;
/** compact: the zone's radius is at least this many shortest legs (ESTIMATE, design: 3 legs) */
export const COMPACT_LEGS = 3;
/** gen4a A3: walks per zone tier (the asked seed, then seeds derived from it) while the course stays under gatesMin (a
 *  street walk turns corners and no late gate sees the start: Wroclaw beginner seed 1 closed at 1 gate) */
export const WALK_VARIANTS = 3;
/** one walk down planCourse's opening ladder: the zone tiers tried at each opening; `always` false: a pass that drops a
 *  rule (quality, or the kind rule of a room, cityAbove or plants), run only when no pass before laid a course at all */
interface LadderPass {
    readonly tiers: readonly number[];
    readonly always: boolean;
}
/** the walk seed of variant v (0: the asked seed itself); the same link always gives the same variants */
export function walkSeed(seed: number, v: number): number {
    return v === 0 ? seed >>> 0 : (seed ^ Math.imul(0x9e3779b1, v)) >>> 0;
}
/** the version of an asked course: '5.<b|m|p><c|w|v>' (the same letters as the link, request.ts) */
export const GENERATOR_VERSION_PLAN = '5';

/** The rules a course is laid by, all in flown m (derived from the request, the craft and the analysis). */
export interface PlanRules {
    readonly level: LevelRules;
    readonly D: number;
    /** the ladder of openings tried, flown m: the level's, then down to 4 D */
    readonly openings: readonly number[];
    readonly zoneR: number;
    readonly legMinM: number;
    readonly legMaxM: number;
    readonly gates: number;
}

/** the level one step harder (beginner -> medium -> pro; pro stays): its walk turns sharper and its legs are shorter */
export const HARDER: Readonly<Record<CourseLevel, CourseLevel>> = { beginner: 'medium', medium: 'pro', pro: 'pro' };

/**
 * gap-gen S1: the rules of `level` walked by the walk of `walk`: the turn, axis and climb rules and the shortest leg of
 * `walk`; the opening ladder, the gate counts and the elements stay the level's. A street has no room for a beginner's loop
 * of 60 degree turns (Wroclaw 70b50d42 beginner: 2 of 5 gates) and a skull on a table at x1 none for a medium's 105
 * degree turns (no course at all, while pro's 150 degree turns laid 3 gates): the opening is what makes a level easy to
 * fly, so a sharper walk with the level's own gates is kept over a short course or none.
 */
export function walkedBy(level: CourseLevel, walk: CourseLevel): LevelRules {
    const own = LEVELS[level], w = LEVELS[walk];
    return walk === level ? own : { ...own, legMinD: Math.min(own.legMinD, w.legMinD), turnCosMin: w.turnCosMin, axisCosMin: w.axisCosMin, climbMax: w.climbMax };
}

/** one ask of the fallback chain: the request laid (its level's gates) and the level whose walk lays it */
export interface FallbackAsk {
    readonly req: CourseRequest;
    readonly walk: CourseLevel;
}

/**
 * gap-gen S1 (G1: never a refusal at the size he flies): the asks walked in turn while no course at all was laid: the asked
 * one; compact when wide was asked (the walk keeps near the core: a smaller box, a shorter loop); then compact with the walk
 * of each harder level (the design said 'one level easier'; an easier level has a larger gate, longer legs and gentler
 * turns, so it never fits where the asked one did not; the code wins). The course keeps the asked link (the chain is fixed,
 * so the same link lays the same course).
 */
export function fallbackAsks(request: CourseRequest): FallbackAsk[] {
    const out: FallbackAsk[] = [{ req: request, walk: request.level }];
    const compact: CourseRequest = { ...request, spread: 'compact', anyQuality: false };
    if (request.spread === 'wide' || request.anyQuality) out.push({ req: compact, walk: request.level });
    for (let w = request.level; HARDER[w] !== w; ) {
        w = HARDER[w];
        out.push({ req: compact, walk: w });
    }
    return out;
}

export function planRules(request: CourseRequest, craftRadiusM: number, a: ScanAnalysis, walk: CourseLevel = request.level): PlanRules {
    const level = walkedBy(request.level, walk);
    const D = 2 * craftRadiusM;
    const openings: number[] = [];
    for (let d = level.openingD; d > RING_MIN_DRONE_DIAMETERS; d = Math.max(RING_MIN_DRONE_DIAMETERS, d * 0.75)) openings.push(d * D);
    openings.push(RING_MIN_DRONE_DIAMETERS * D);
    const legMinM = level.legMinD * D;
    const wide = request.spread === 'wide' || request.anyQuality;
    const zoneR = wide ? Math.max(a.extentM / 2, a.coreRadiusM) : Math.max(a.coreRadiusM, COMPACT_LEGS * legMinM);
    const legMaxRaw = Math.min(MAX_LEG_M, Math.max(level.legMaxD * D, level.legMaxFloorM * Math.min(1, zoneR / 20)));
    const legMaxM = Math.max(1.5 * legMinM, Math.min(legMaxRaw, 2 * zoneR));
    const gatesMax = request.anyQuality ? VOXEL_VIEW_GATES : level.gatesMax;
    const gates = Math.max(level.gatesMin, Math.min(gatesMax, Math.round((2 * zoneR) / ((legMinM + legMaxM) / 2))));
    return { level, D, openings, zoneR, legMinM, legMaxM, gates };
}

/** the lowest a gate's lower edge may be over the tile's ground, flown m: LOW_EDGE_M x unit, never over one opening (a
 *  table-top scan flown at x1 has no 0.3 m of air over its table for a whoop's gate) */
export function lowEdgeM(a: ScanAnalysis, openingM: number): number {
    return Math.min(LOW_EDGE_M * a.unitM, openingM);
}

const flat2 = (a: Vec3, b: Vec3): number => (a[0] - b[0]) * (a[0] - b[0]) + (a[2] - b[2]) * (a[2] - b[2]);

/** the territory rule: centre p with a gate reaching `half` above and below it: its lower edge over the ground plus the
 *  low edge, its centre at most two openings over the roofs (the walk's free radius of 1.4 rings keeps a gate's top edge
 *  further from a skull than two openings minus its half would allow) */
function insideAt(a: ScanAnalysis, p: Vec3, half: number, openingM: number): boolean {
    const t = scanTile(a, p);
    if (t < 0 || a.footprint[t] !== 1) return false;
    const g = a.groundTop[t]!, r = a.roofTop[t]!;
    if (!Number.isFinite(g) || p[1] - half < g + lowEdgeM(a, openingM)) return false;
    return !Number.isFinite(r) || p[1] <= r + 2 * openingM;
}

/** the loosest zone tier: the territory only (zoneAt) */
export const LOOSEST_TIER = 3;

/** the zone's rules, strictest first; `tier` 0 all, 1 without the quality rule, 2 without the kind rule (the quality rule
 *  kept: Forest Floor at x1 has no whoop gate under its leaves, and its courses then left the good tiles: goodShare
 *  0.4-0.6), 3 (LOOSEST_TIER) without both */
export function zoneAt(a: ScanAnalysis, request: CourseRequest, rules: PlanRules, openingM: number, tier: number, anchor: Vec3): (p: Vec3) => boolean {
    const k = openingM / RING_DIAMETER_M;
    const half = (SQUARE_SIDE_M / 2 + SQUARE_BAR_M) * k;
    const u = a.unitM;
    const compact = request.spread === 'compact' && !request.anyQuality;
    const r2 = rules.zoneR * rules.zoneR;
    // the object's own rule stays round the object (the analysis core): a course round the skull, not round the pilot
    const objR2 = 9 * a.coreRadiusM * a.coreRadiusM;
    return (p) => {
        if (!insideAt(a, p, half, openingM)) return false;
        if (compact && flat2(p, anchor) > r2) return false;
        const t = scanTile(a, p);
        if ((tier === 0 || tier === 2) && !request.anyQuality && a.quality[t]! < GOOD_Q) return false;
        if (tier >= 2) return true;
        const g = a.groundTop[t]!;
        switch (a.kind) {
            case 'room': {
                const c = a.ceiling[t]!;
                return Number.isFinite(c) && p[1] + half <= c;
            }
            case 'cityAbove':
                return p[1] >= g + CITY_LOW_M * u;
            case 'street':
                return p[1] >= g + EYE_LO_M * u && p[1] <= g + EYE_HI_M * u + half;
            case 'object':
                return flat2(p, a.core) <= objR2;
            case 'plants': {
                const r = a.roofTop[t]!;
                return Number.isFinite(r) && p[1] + half <= r;
            }
            default:
                return true;
        }
    };
}

/** the Scene sizes a no-room answer may offer (the same steps as apps/fly course/finish.ts NO_COURSE_SIZES) */
export const FIT_SIZES: readonly number[] = Object.freeze([1, 2, 3, 5, 10, 30]);
/** fitSize asks this much more than the free radius alone: a usable room needs volume past the gate's own radius
 *  (MEASURED, plan.test.ts crowdedPocket: radius 0.55 of the need at x1, the radius alone asks x2 which has no room) */
export const FIT_SLACK = 1.25;

/** the largest free radius of any free cell in a zone (a no-room scan has no usable cell to measure) against the radius
 *  a ring of step k needs (>= 1: a gate fits) */
function roomRatio(free: FreeSpace, k: number, at: (p: Vec3) => boolean): number {
    let best = 0;
    for (let i = 0; i < free.solid.length; i++) {
        if (free.solid[i] !== 0) continue;
        const c = clearanceM(free, i);
        if (c > best && at(cellCentre(free, i))) best = c;
    }
    return best / (RING_MIN_FREE_M * k);
}

/**
 * The Scene size at which a no-room scan gives the smallest gate room: the walls grow with the size and the craft does
 * not, so the free radius grows as size; `ratio` is the largest free radius against the 4 D gate's need at `size`. The
 * first FIT_SIZES step over `size` that reaches FIT_SLACK x size / ratio (a ratio >= 1 that still gave no course asks the next step:
 * more room for the legs); null when no step is large enough or there is no free cell at all.
 */
export function fitSizeFor(size: number, ratio: number): number | null {
    if (!(ratio > 0)) return null;
    const want = (FIT_SLACK * size) / Math.min(1, ratio);
    for (const s of FIT_SIZES) if (s > size + 1e-6 && s >= want - 1e-6) return s;
    return null;
}

/** the walk's candidate cells (generate.ts walkCourse without a quality map: usable, a ring's free radius) in a zone */
function zoneCount(free: FreeSpace, k: number, at: (p: Vec3) => boolean): number {
    let n = 0;
    for (let i = 0; i < free.room.length; i++) if (free.room[i]! >= 0 && clearanceM(free, i) >= RING_MIN_FREE_M * k && at(cellCentre(free, i))) n++;
    return n;
}

/** the free-space box: the zone's tiles, from the lowest ground to the highest roof plus two openings */
function zoneBox(a: ScanAnalysis, request: CourseRequest, rules: PlanRules, openingM: number, anchor: Vec3): { min: Vec3; max: Vec3 } | null {
    const compact = request.spread === 'compact' && !request.anyQuality;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let tz = 0; tz < a.nz; tz++)
        for (let tx = 0; tx < a.nx; tx++) {
            const t = tz * a.nx + tx;
            if (a.footprint[t] !== 1 || !Number.isFinite(a.groundTop[t]!)) continue;
            const lx = a.x0 + tx * a.tileM, lz = a.z0 + tz * a.tileM;
            const c: Vec3 = [lx + a.tileM / 2, 0, lz + a.tileM / 2];
            if (compact && Math.sqrt(flat2(c, anchor)) > rules.zoneR + a.tileM) continue;
            x0 = Math.min(x0, lx);
            x1 = Math.max(x1, lx + a.tileM);
            z0 = Math.min(z0, lz);
            z1 = Math.max(z1, lz + a.tileM);
            y0 = Math.min(y0, a.groundTop[t]!);
            const r = a.roofTop[t]!;
            y1 = Math.max(y1, (Number.isFinite(r) ? r : a.groundTop[t]!) + 2 * openingM, a.groundTop[t]! + EYE_HI_M * a.unitM + openingM);
        }
    if (!(x1 > x0)) return null;
    // a tile and an opening more at each side: the walls that close the footprint stand in the box, so the free space's
    // enclosure rays hit them (a box cut at the footprint's edge leaves a closed pocket 'badly scanned' at any size)
    const pad = a.tileM + openingM;
    return { min: [x0 - pad, y0 - openingM, z0 - pad], max: [x1 + pad, y1 + openingM, z1 + pad] };
}

/** the free-space cell a course is laid in at most, in openings (a ring's free radius is measured in cells) */
export const CELL_PER_OPENING = 0.5;

/**
 * The zone box clipped to the course's own reach around the start: a loop of N legs of at most L m spans at most N x L / 2,
 * and the box is shrunk further until maxCells cells of max(blockM, CELL_PER_OPENING x opening) hold it. A 1 km aerial
 * scan flown at x1 by a whoop (Laval eb5f51dc) gave a 3.2 m cell against a 0.85 m gate in the whole-scan box: no cell
 * usable, no course.
 */
export function clipBox(box: { min: Vec3; max: Vec3 }, start: Vec3, reachM: number, openingM: number, voxelM: number): { min: Vec3; max: Vec3 } {
    const cell = Math.max(4 * voxelM, CELL_PER_OPENING * openingM);
    const maxVol = FREE_DEFAULTS.maxCells * cell * cell * cell;
    let h = reachM;
    let out = box;
    for (let i = 0; i < 8; i++) {
        const min = [0, 1, 2].map((ax) => Math.max(box.min[ax]!, Math.min(start[ax]!, box.max[ax]!) - h)) as unknown as Vec3;
        const max = [0, 1, 2].map((ax) => Math.min(box.max[ax]!, Math.max(start[ax]!, box.min[ax]!) + h)) as unknown as Vec3;
        out = { min, max };
        const vol = (max[0] - min[0]) * (max[1] - min[1]) * (max[2] - min[2]);
        if (!(vol > maxVol)) break;
        h *= 0.98 * Math.cbrt(maxVol / vol);
    }
    return out;
}

/** How far an asked course reaches from its start, flown m (shrink: the opening against the level's). */
export interface WalkReach {
    /** the out half keeps within it (CoursePlace.reachM): the zone, and the diameter of a circle of the loop's own length
     *  (gates x the mean leg / pi; the start is on the loop, not at its centre), never under half of the server's 60 m leg
     *  (two gates within it of the start are within 60 m of each other). A 127 m zone let a pro course wander out and its
     *  closing leg pass the server's 60 m (1994c65c). */
    readonly walkR: number;
    /** the free-space box's half size around the start (clipBox): the walk's reach and one leg past it (the way home starts
     *  from the out half's last gate), never more than the whole loop laid out straight. That straight loop (24 x 20 m pro
     *  legs: 260 m) over 1994c65c (voxel 0.8 m) gave a box of 3.2 m cells against a 0.43 m gate: pro wide had no course at
     *  all (audit run 4); with this box, 24 gates in 1.8 s. */
    readonly boxR: number;
}

export function walkReach(R: PlanRules, shrink: number): WalkReach {
    const legMax = R.legMaxM * shrink;
    const reach = (R.gates * legMax) / 2 + legMax;
    const loopR = Math.max((R.gates * (R.legMinM * shrink + legMax) * 0.5) / Math.PI, MAX_LEG_M / 2);
    const walkR = Math.min(R.zoneR, loopR);
    return { walkR, boxR: Math.min(reach, walkR + legMax) };
}

/**
 * Every leg of a track within the server's MAX_LEG_M, flown m: validateServerTrack's own leg rule (each gate to the next,
 * and the last to the first when the course has laps). planCourse keeps no course the Save would refuse: Lublin pro wide
 * seed 2 walked a 61 m leg from gate 1 to gate 2 (audit run 5); its other rules (a whoop's gate size in scene units over
 * x5.6) are the format's, not the walk's, and are not asked here.
 */
export function legsWithinServer(track: TrackFile): boolean {
    const s = track.transform[0];
    const g = track.gates;
    const legs: [number, number][] = g.slice(1).map((_, i) => [i, i + 1]);
    if ((track.laps ?? 1) > 1 && g.length > 1) legs.push([g.length - 1, 0]);
    return legs.every(([a, b]) => {
        const p = g[a]!.pos, q = g[b]!.pos;
        const dx = p[0]! - q[0]!, dy = p[1]! - q[1]!, dz = p[2]! - q[2]!;
        return Math.sqrt(dx * dx + dy * dy + dz * dz) * s <= MAX_LEG_M;
    });
}

/** a tile a course can grow from: on the scanned footprint, with ground */
const usableTile = (a: ScanAnalysis, t: number): boolean => t >= 0 && a.footprint[t] === 1 && Number.isFinite(a.groundTop[t]!);

/**
 * Lane w1-anchor (design w1-diag, R1): where a course grows from, flown world. The request's anchor is the pilot's place
 * (the drone in the air or paused in the air; the spawn, the author's camera, when parked or just loaded); when its own tile
 * is not usable, the nearest usable tile's centre (at the anchor's height), never the core. A request with no anchor is an
 * old 'g2.' link: the analysis core, the course that link laid before this lane (a.core = the detail-richest window of the
 * voxels, which on eb5f51dc lies 485 m from the author's camera in a badly captured field: w1-diag Cause).
 */
export function anchorOf(input: PlanInput, a: ScanAnalysis): Vec3 {
    const p = input.request.anchor;
    if (!p) return a.core;
    const at: Vec3 = [p[0], p[1], p[2]];
    if (usableTile(a, scanTile(a, at))) return at;
    let best = -1, bestD = Infinity;
    for (let t = 0; t < a.nx * a.nz; t++) {
        if (!usableTile(a, t)) continue;
        const cx = a.x0 + ((t % a.nx) + 0.5) * a.tileM, cz = a.z0 + (Math.floor(t / a.nx) + 0.5) * a.tileM;
        const d = (cx - at[0]) * (cx - at[0]) + (cz - at[2]) * (cz - at[2]);
        if (d < bestD) {
            bestD = d;
            best = t;
        }
    }
    return best < 0 ? at : [a.x0 + ((best % a.nx) + 0.5) * a.tileM, at[1], a.z0 + (Math.floor(best / a.nx) + 0.5) * a.tileM];
}

/** where the walk starts: over the anchor (anchorOf), half way between its ground and its roof or ceiling (a street at eye
 *  height; the walk takes the nearest zone cell) */
function startOf(a: ScanAnalysis, openingM: number, anchor: Vec3): Vec3 {
    const t = scanTile(a, anchor);
    const g = t >= 0 ? a.groundTop[t]! : NaN;
    if (!Number.isFinite(g)) return anchor;
    const c = a.ceiling[t]!, r = a.roofTop[t]!;
    const eye = g + EYE_HI_M * a.unitM;
    const top = a.kind === 'street' ? eye : Number.isFinite(c) ? c : Number.isFinite(r) ? Math.max(r, eye) : eye;
    return [anchor[0], Math.max(g + lowEdgeM(a, openingM) + openingM, (g + top) / 2), anchor[2]];
}

/** the starts tried in turn: startOf, then one opening over the anchor's roof when that is higher (inside the territory:
 *  insideAt allows a centre up to two openings over the roofs) */
function startsOf(a: ScanAnalysis, openingM: number, anchor: Vec3): Vec3[] {
    const s = startOf(a, openingM, anchor);
    const t = scanTile(a, anchor);
    const r = t >= 0 ? a.roofTop[t]! : NaN;
    return Number.isFinite(r) && r + openingM > s[1] + openingM ? [s, [anchor[0], r + openingM, anchor[2]]] : [s];
}

/** the version letters of a request (request.ts courseLinkId: 'g2.<seed>.<letters>') */
function letters(r: CourseRequest): string {
    return courseLinkId(r).split('.')[2] ?? '';
}

/** the course of `input.request` on `input.walls`; never throws for a scan without room: answers ok false */
export function planCourse(input: PlanInput, hooks: PlanHooks = {}): PlanAnswer {
    const { walls, transform, request } = input;
    const now = hooks.deadline?.now;
    /** the longest lay so far, ms: a lay that would end past the deadline is not started (fit.ts fitCourse's rule, review
     *  T2-6 / CV-5: the page's watchdog ends a worker that runs on past FIT_BUDGET_MS and the pilot gets only a failure) */
    let longest = 0;
    const late = (): boolean => !!hooks.deadline && hooks.deadline.now() + longest >= hooks.deadline.at;
    hooks.onStep?.('analyse', 0);
    const a = analyzeScan(walls, transform);
    // lane w1-anchor: every start, the compact zone and its box grow from the pilot's place, never the core (an old link: the core)
    const anchor = anchorOf(input, a);
    const craftR = input.craftRadiusM || SMALLEST_DRONE_RADIUS_M;
    const rules = planRules(request, craftR, a);
    /** the asks of one ladder: `req` itself, and when it is compact the same over the whole scan (a compact course that
     *  keeps under gatesMin in the core's zone is laid over the whole scan too: a bare room's core is a corner) before the
     *  opening steps down; the version letters stay the asked ones */
    type Ask = FallbackAsk & { rules: PlanRules };
    const asksOf = (req: CourseRequest, walk: CourseLevel): Ask[] => {
        const out: Ask[] = [{ req, walk, rules: planRules(req, craftR, a, walk) }];
        if (req.spread === 'compact' && !req.anyQuality) {
            const wide: CourseRequest = { ...req, spread: 'wide' };
            out.push({ req: wide, walk, rules: planRules(wide, craftR, a, walk) });
        }
        return out;
    };
    const version = `${GENERATOR_VERSION_PLAN}.${letters(request)}`;
    // set inside `lay` (a closure): the cast keeps TypeScript from narrowing it to null here
    let best = null as { track: TrackFile; opening: number; ask: FallbackAsk; tier: number } | null;
    const bestGates = (): number => best?.track.gates.length ?? 0;
    let lastMs = 0;
    /** the 4 D gate's room at this size (fitSize of a no-room answer) */
    let ratio = 0;
    // the kind rule is the owner's own ask for a room (G5: the course inside), a city from above (G4: over the roofs) and
    // plants (G6: between the leaves): the ladder keeps it there (Winter Garden pro laid gates outside the glass), and only a
    // scan with no course at all under it is laid again without it (never a refusal: a plant tray flown at x1)
    const strictKind = a.kind === 'room' || a.kind === 'cityAbove' || a.kind === 'plants';
    // the quality rule is a zone rule too (G3: the course in the best scanned part): every opening of the ladder is tried
    // with it, and a short course in the good part is kept over a full one beside it (Forest Floor beginner: 5 gates at
    // 10 D with 0.4-0.6 of them on good tiles before; 2 gates on good tiles at the ladder's floor now)
    // A room and an object are the exception: their kind rule (a ceiling over the cell; within 3 core radii of the object)
    // already bounds the scanned part, while a bare room's floor or the table under a skull reads as poor detail, so there
    // the quality rule is dropped at the same opening (the room's beginner course shrank, the skull's pro course kept 1
    // gate over the skull instead of 3 round it)
    const passes: readonly LadderPass[] = a.kind === 'room' || a.kind === 'object'
        ? [{ tiers: [0, 1], always: true }, { tiers: [2, LOOSEST_TIER], always: false }]
        : strictKind
          ? [{ tiers: [0], always: true }, { tiers: [1], always: false }, { tiers: [2], always: false }, { tiers: [LOOSEST_TIER], always: false }]
          : [{ tiers: [0, 2], always: true }, { tiers: [1, LOOSEST_TIER], always: false }];
    /** the opening ladder of one level: `asks` at each opening, the passes in turn, until `want` gates */
    const ladder = (asks: Ask[], want: number, tierOk: ((t: number) => boolean) | null = null): void => {
        const enough = (): boolean => bestGates() >= want;
        const openings = asks[0]!.rules.openings;
        const elements = input.elements && asks[0]!.rules.level.elements.length > 1;
        for (const pass of passes) {
            if (enough() || late()) break;
            if (!pass.always && bestGates() > 0 && !tierOk) continue;
            for (let oi = 0; oi < openings.length && !late(); oi++) {
                const opening = openings[oi]!;
                const k = opening / RING_DIAMETER_M;
                // a shrunk opening shrinks the legs with it (a 1 m plant tray has no 15 D leg for a whoop)
                const shrink = opening / openings[0]!;
                const p = scaledParams(k, COURSE_DEFAULTS);
                const starts = startsOf(a, opening, anchor);
                for (const ask of asks) {
                    if (late() || enough()) break;
                    const R = ask.rules;
                    const box = zoneBox(a, ask.req, R, opening, anchor);
                    if (!box) continue;
                    hooks.onStep?.('free', 0);
                    const zone2 = zoneAt(a, ask.req, R, opening, LOOSEST_TIER, anchor);
                    const { walkR, boxR } = walkReach(R, shrink);
                    const freeFrom = (spawn: Vec3): FreeSpace => freeAtMargin(walls, { spawn, bounds: clipBox(box, spawn, boxR, opening, walls.voxelResolution), unitM: a.unitM, kind: a.kind === 'room' ? 'indoor' : 'auto', goodAt: zone2, enclosureMin: 0 }, p.marginM);
                    let start = starts[0]!;
                    let free = freeFrom(start);
                    // a start in a pocket (under a housefly's body, between its legs) reaches a few cells: the air over the roof
                    // is tried too and the start whose free space holds more zone cells is kept
                    let room = zoneCount(free, k, zone2);
                    for (let si = 1; si < starts.length && room < ZONE_CANDS_PER_GATE * R.gates && !late(); si++) {
                        const f2 = freeFrom(starts[si]!), r2 = zoneCount(f2, k, zone2);
                        if (r2 > room) {
                            free = f2;
                            room = r2;
                            start = starts[si]!;
                        }
                    }
                    if (oi === openings.length - 1) ratio = Math.max(ratio, roomRatio(free, k, zoneAt(a, ask.req, R, opening, LOOSEST_TIER, anchor)));
                    const params = { ...p, legMinM: R.legMinM * shrink, legMaxM: R.legMaxM * shrink, spacingM: R.legMinM * shrink, turnCosMin: R.level.turnCosMin, axisCosMin: R.level.axisCosMin, gatesMin: R.level.gatesMin, gatesMax: Math.max(R.gates, R.level.gatesMax) };
                    // a zone with enough cells can still be a broken sheet (Wroclaw's eye band over 7.2 m tiles at 0.4 m cells:
                    // every walk stopped at 1-2 gates): the pass's looser tier is walked at the same opening before it shrinks
                    const lay = (t: number, v: number): void => {
                        const place: CoursePlace = { at: zoneAt(a, ask.req, R, opening, t, anchor), start, reachM: walkR, gates: R.gates, maxGates: R.level.gatesMax, climbMax: R.level.climbMax, version: v ? `${version}.w${v}` : version, kinds: R.level.elements };
                        hooks.onStep?.('lay', lastMs);
                        const t0 = now ? now() : 0;
                        const track = generateCourse(free, walls, { seed: walkSeed(request.seed, v), scene: input.scene, transform, created: input.created, spawn: start, params, place, elements, craftRadiusM: input.craftRadiusM });
                        if (now) {
                            lastMs = now() - t0;
                            longest = Math.max(longest, lastMs);
                        }
                        if (track.gates.length > 0 && track.gates.length > bestGates() && legsWithinServer(track)) best = { track, opening, ask, tier: t };
                    };
                    // a tier with too few cells is not walked unless it is the pass's last; each tier's derived seeds are walked
                    // before the tier loosens
                    const last = pass.tiers[pass.tiers.length - 1]!;
                    const sparse = (t: number): boolean => t !== last && zoneCount(free, k, zoneAt(a, ask.req, R, opening, t, anchor)) < ZONE_CANDS_PER_GATE * R.gates;
                    for (const t of pass.tiers) {
                        if (late() || enough()) break;
                        if (sparse(t) || (tierOk && !tierOk(t))) continue;
                        for (let v = 0; v < WALK_VARIANTS && !late() && !enough(); v++) lay(t, v);
                    }
                }
                if (enough()) break;
            }
        }
    };
    const chain = fallbackAsks(request);
    // an ask already walked (a compact fallback's own whole-scan ask is the asked wide one) is not walked again
    const walked = new Set<string>();
    const keyOf = (x: FallbackAsk): string => `${x.req.spread}.${x.req.anyQuality}.${x.walk}`;
    for (let i = 0; i < chain.length && !best && !late(); i++) {
        const asks = asksOf(chain[i]!.req, chain[i]!.walk).filter((x) => !walked.has(keyOf(x)));
        for (const x of asks) walked.add(keyOf(x));
        if (asks.length) ladder(asks, rules.level.gatesMin);
    }
    // a course under gatesMin is walked once more by the next harder walk (walkedBy) down the asked level's openings, in the
    // passes a course already laid skips too, but in no tier looser than the short course's own (G3: a short course in the
    // good part is kept over a full one beside it); it is kept only with more gates
    if (best && bestGates() < rules.level.gatesMin && HARDER[best.ask.walk] !== best.ask.walk && !late()) {
        const own = best.tier;
        ladder(asksOf(best.ask.req, HARDER[best.ask.walk]), rules.level.gatesMin, (t) => t === own || t === 0 || own === LOOSEST_TIER);
    }
    if (!best) return { ok: false, reason: 'no-room', kind: a.kind, fitSize: fitSizeFor(transform[0], ratio) };
    const track: TrackFile = { ...best.track, id: courseLinkId(request), title: courseTitle(request.seed) };
    const start = flownStart(track, transform) ?? { pos: anchor, yawDeg: 0 };
    // eased: laid nearer the core than asked or by a sharper walk than the level's (fallbackAsks, the short course's walk)
    const b = best.ask;
    const eased = b.walk !== request.level || b.req.anyQuality !== request.anyQuality || (request.spread === 'wide' && b.req.spread === 'compact');
    return { ok: true, track, stats: placementStats(track, a, transform), start, shrunk: best.opening < rules.openings[0]! - 1e-9, eased };
}

/** a gate's opening and its reach above and below its centre, flown m */
function gateSize(g: TrackGate, s: number): { opening: number; half: number } {
    const sh = g.shape as { kind: string; diameter?: number; tube?: number; side?: number; bar?: number };
    if (sh.kind === 'ring') return { opening: (sh.diameter ?? 0) * s, half: ((sh.diameter ?? 0) / 2 + (sh.tube ?? 0) / 2) * s };
    if (sh.side !== undefined) return { opening: sh.side * s, half: (sh.side / 2 + (sh.bar ?? 0)) * s };
    return { opening: 0, half: 0 };
}

/** the measured placement of `track` against the analysis of its scan */
export function placementStats(track: TrackFile, scan: ScanAnalysis, transform: SceneTransform): PlanStats {
    const s = transform[0];
    const toFlown = (q: readonly number[]): Vec3 => [s * q[0]! + transform[1], s * q[1]! + transform[2], s * q[2]! + transform[3]];
    const gs = track.gates.map((g) => ({ pos: toFlown(g.pos), ...gateSize(g, s) }));
    const closed = track.laps > 1;
    let good = 0, outside = 0, under = 0, near = 0, underTop = 0;
    for (const g of gs) {
        const t = scanTile(scan, g.pos);
        if (t >= 0 && scan.quality[t]! >= GOOD_Q) good++;
        // outside the scanned territory: off the footprint, or higher over the roofs than two openings
        if (t < 0 || scan.footprint[t] !== 1 || (Number.isFinite(scan.roofTop[t]!) && g.pos[1] > scan.roofTop[t]! + 2 * g.opening + 1e-6)) outside++;
        const gt = t >= 0 ? scan.groundTop[t]! : NaN;
        if (Number.isFinite(gt) && g.pos[1] - g.half < gt + lowEdgeM(scan, g.opening) - 1e-6) under++;
        if (Number.isFinite(gt) && g.pos[1] < gt + CITY_LOW_M * scan.unitM) near++;
        // under the leaves' top: the gate's top edge under the tile's highest roofs (the plants rule of zoneRule)
        if (t >= 0 && Number.isFinite(scan.roofTop[t]!) && g.pos[1] + g.half <= scan.roofTop[t]! + 1e-6) underTop++;
    }
    const n = gs.length;
    const first = gs[0], last = gs[n - 1];
    const d3 = (a: Vec3, b: Vec3): number => Math.sqrt((a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1]) + (a[2] - b[2]) * (a[2] - b[2]));
    return {
        kind: scan.kind,
        gates: n,
        closed,
        startFinishM: closed || !first || !last ? 0 : d3(last.pos, first.pos),
        startToCoreM: first ? Math.sqrt(flat2(first.pos, scan.core)) : 0,
        finishToCoreM: closed ? (first ? Math.sqrt(flat2(first.pos, scan.core)) : 0) : last ? Math.sqrt(flat2(last.pos, scan.core)) : 0,
        underTopShare: n ? underTop / n : 0,
        goodShare: n ? good / n : 0,
        outside,
        underGround: under,
        nearGroundShare: n ? near / n : 0,
        // the smallest opening of the course (a square's side is 1.25 x the ring's diameter of its step)
        openingM: n ? Math.min(...gs.map((g) => g.opening)) : 0
    };
}
