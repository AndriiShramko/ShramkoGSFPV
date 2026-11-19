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
import { analyzeScan, scanTile } from './scan';
import type { ScanAnalysis } from './scan';
import { LEVELS, VOXEL_VIEW_GATES, courseLinkId } from './request';
import type { CourseRequest, LevelRules, PlanAnswer, PlanHooks, PlanInput, PlanStats } from './request';
import type { SceneTransform, TrackFile, TrackGate, Vec3 } from './types';

/** a tile is well scanned from this share of the scan's best tenth (ESTIMATE, design section 3) */
export const GOOD_Q = 0.5;
/** cityAbove: a gate's centre stands at least this many m x unit over the ground (ESTIMATE, design: 4 m) */
export const CITY_LOW_M = 4;
/** candidates per wanted gate below which a zone rule is dropped (ESTIMATE: generate.ts BAND_CANDS_PER_GATE) */
export const ZONE_CANDS_PER_GATE = 8;
/** compact: the zone's radius is at least this many shortest legs (ESTIMATE, design: 3 legs) */
export const COMPACT_LEGS = 3;
/** the most a leg may be, flown m (server.ts / apps/api/tracks.py MAX_LEG_M) */
const MAX_LEG_M = 60;
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

export function planRules(request: CourseRequest, craftRadiusM: number, a: ScanAnalysis): PlanRules {
    const level = LEVELS[request.level];
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

/** the zone's rules, strictest first; `tier` 0 all, 1 without the quality rule, 2 without the kind rule */
export function zoneAt(a: ScanAnalysis, request: CourseRequest, rules: PlanRules, openingM: number, tier: number): (p: Vec3) => boolean {
    const k = openingM / RING_DIAMETER_M;
    const half = (SQUARE_SIDE_M / 2 + SQUARE_BAR_M) * k;
    const u = a.unitM;
    const compact = request.spread === 'compact' && !request.anyQuality;
    const r2 = rules.zoneR * rules.zoneR;
    const objR2 = 9 * a.coreRadiusM * a.coreRadiusM;
    return (p) => {
        if (!insideAt(a, p, half, openingM)) return false;
        if (compact && flat2(p, a.core) > r2) return false;
        const t = scanTile(a, p);
        if (tier < 1 && !request.anyQuality && a.quality[t]! < GOOD_Q) return false;
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
function zoneBox(a: ScanAnalysis, request: CourseRequest, rules: PlanRules, openingM: number): { min: Vec3; max: Vec3 } | null {
    const compact = request.spread === 'compact' && !request.anyQuality;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let tz = 0; tz < a.nz; tz++)
        for (let tx = 0; tx < a.nx; tx++) {
            const t = tz * a.nx + tx;
            if (a.footprint[t] !== 1 || !Number.isFinite(a.groundTop[t]!)) continue;
            const lx = a.x0 + tx * a.tileM, lz = a.z0 + tz * a.tileM;
            const c: Vec3 = [lx + a.tileM / 2, 0, lz + a.tileM / 2];
            if (compact && Math.sqrt(flat2(c, a.core)) > rules.zoneR + a.tileM) continue;
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

/** where the walk starts: over the core, half way between its ground and its roof or ceiling (a street at eye height;
 *  the walk takes the nearest zone cell) */
function startOf(a: ScanAnalysis, openingM: number): Vec3 {
    const t = scanTile(a, a.core);
    const g = t >= 0 ? a.groundTop[t]! : NaN;
    if (!Number.isFinite(g)) return a.core;
    const c = a.ceiling[t]!, r = a.roofTop[t]!;
    const eye = g + EYE_HI_M * a.unitM;
    const top = a.kind === 'street' ? eye : Number.isFinite(c) ? c : Number.isFinite(r) ? Math.max(r, eye) : eye;
    return [a.core[0], Math.max(g + lowEdgeM(a, openingM) + openingM, (g + top) / 2), a.core[2]];
}

/** the starts tried in turn: startOf, then one opening over the core's roof when that is higher (inside the territory:
 *  insideAt allows a centre up to two openings over the roofs) */
function startsOf(a: ScanAnalysis, openingM: number): Vec3[] {
    const s = startOf(a, openingM);
    const t = scanTile(a, a.core);
    const r = t >= 0 ? a.roofTop[t]! : NaN;
    return Number.isFinite(r) && r + openingM > s[1] + openingM ? [s, [a.core[0], r + openingM, a.core[2]]] : [s];
}

/** the version letters of a request (request.ts courseLinkId: 'g2.<seed>.<letters>') */
function letters(r: CourseRequest): string {
    return courseLinkId(r).split('.')[2] ?? '';
}

/** the course of `input.request` on `input.walls`; never throws for a scan without room: answers ok false */
export function planCourse(input: PlanInput, hooks: PlanHooks = {}): PlanAnswer {
    const { walls, transform, request } = input;
    const now = hooks.deadline?.now;
    const late = (): boolean => !!hooks.deadline && hooks.deadline.now() >= hooks.deadline.at;
    hooks.onStep?.('analyse', 0);
    const a = analyzeScan(walls, transform);
    const rules = planRules(request, input.craftRadiusM || SMALLEST_DRONE_RADIUS_M, a);
    // a compact course that keeps under gatesMin in the core's zone is laid over the whole scan too (a bare room's core is
    // a corner) before the opening steps down; the version letters stay the asked ones
    const asks: { req: CourseRequest; rules: PlanRules }[] = [{ req: request, rules }];
    if (request.spread === 'compact' && !request.anyQuality) {
        const wide: CourseRequest = { ...request, spread: 'wide' };
        asks.push({ req: wide, rules: planRules(wide, input.craftRadiusM || SMALLEST_DRONE_RADIUS_M, a) });
    }
    const version = `${GENERATOR_VERSION_PLAN}.${letters(request)}`;
    const elements = input.elements && rules.level.elements.length > 1;
    let best: { track: TrackFile; opening: number } | null = null;
    let lastMs = 0;
    /** the 4 D gate's room at this size (fitSize of a no-room answer) */
    let ratio = 0;
    // the kind rule is the owner's own ask for a room (G5: the course inside), a city from above (G4: over the roofs) and
    // plants (G6: between the leaves): the ladder keeps it there (Winter Garden pro laid gates outside the glass), and only a
    // scan with no course at all under it is laid again without it (never a refusal: a plant tray flown at x1)
    const strictKind = a.kind === 'room' || a.kind === 'cityAbove' || a.kind === 'plants';
    for (const topTier of strictKind ? [1, 2] : [2]) {
        if (best) break;
        for (let oi = 0; oi < rules.openings.length && !late(); oi++) {
            const opening = rules.openings[oi]!;
            const k = opening / RING_DIAMETER_M;
            // a shrunk opening shrinks the legs with it (a 1 m plant tray has no 15 D leg for a whoop)
            const shrink = opening / rules.openings[0]!;
            const p = scaledParams(k, COURSE_DEFAULTS);
            const starts = startsOf(a, opening);
            for (const ask of asks) {
                if (late() || (best && best.track.gates.length >= rules.level.gatesMin)) break;
                const R = ask.rules;
                const box = zoneBox(a, ask.req, R, opening);
                if (!box) continue;
                hooks.onStep?.('free', 0);
                const zone2 = zoneAt(a, ask.req, R, opening, 2);
                const legMax = R.legMaxM * shrink;
                const reach = (R.gates * legMax) / 2 + legMax;
                // the walk keeps within the diameter of a circle of the loop's own length (gates x the mean leg / pi; the start is on
                // the loop, not at its centre): a 127 m zone let a pro
                // course wander out and its closing leg pass the server's 60 m (1994c65c); never under half of 60 m (two gates
                // within it of the start are within 60 m of each other)
                const loopR = Math.max((R.gates * (R.legMinM * shrink + legMax) * 0.5) / Math.PI, MAX_LEG_M / 2);
                const freeFrom = (spawn: Vec3): FreeSpace => freeAtMargin(walls, { spawn, bounds: clipBox(box, spawn, reach, opening, walls.voxelResolution), unitM: a.unitM, kind: a.kind === 'room' ? 'indoor' : 'auto', goodAt: zone2, enclosureMin: 0 }, p.marginM);
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
                if (oi === rules.openings.length - 1) ratio = Math.max(ratio, roomRatio(free, k, zoneAt(a, ask.req, R, opening, 2)));
                let tier = 0;
                while (tier < topTier && zoneCount(free, k, zoneAt(a, ask.req, R, opening, tier)) < ZONE_CANDS_PER_GATE * R.gates) tier++;
                const params = { ...p, legMinM: R.legMinM * shrink, legMaxM: R.legMaxM * shrink, spacingM: R.legMinM * shrink, turnCosMin: R.level.turnCosMin, axisCosMin: R.level.axisCosMin, gatesMin: R.level.gatesMin, gatesMax: Math.max(R.gates, R.level.gatesMax) };
                // a zone with enough cells can still be a broken sheet (Wroclaw's eye band over 7.2 m tiles at 0.4 m cells:
                // every walk stopped at 1-2 gates): the looser tiers are walked at the same opening before the opening shrinks
                for (; tier <= topTier && !late(); tier++) {
                    const place: CoursePlace = { at: zoneAt(a, ask.req, R, opening, tier), start, reachM: Math.min(R.zoneR, loopR), gates: R.gates, maxGates: R.level.gatesMax, climbMax: R.level.climbMax, version };
                    hooks.onStep?.('lay', lastMs);
                    const t0 = now ? now() : 0;
                    const track = generateCourse(free, walls, { seed: request.seed, scene: input.scene, transform, created: input.created, spawn: start, params, place, elements, craftRadiusM: input.craftRadiusM });
                    if (now) lastMs = now() - t0;
                    if (track.gates.length > 0 && (!best || track.gates.length > best.track.gates.length)) best = { track, opening };
                    if (best && best.track.gates.length >= rules.level.gatesMin) break;
                }
            }
            if (best && best.track.gates.length >= rules.level.gatesMin) break;
        }
    }
    if (!best) return { ok: false, reason: 'no-room', kind: a.kind, fitSize: fitSizeFor(transform[0], ratio) };
    const track: TrackFile = { ...best.track, id: courseLinkId(request), title: courseTitle(request.seed) };
    const start = flownStart(track, transform) ?? { pos: a.core, yawDeg: 0 };
    return { ok: true, track, stats: placementStats(track, a, transform), start, shrunk: best.opening < rules.openings[0]! - 1e-9 };
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
    let good = 0, outside = 0, under = 0, near = 0;
    for (const g of gs) {
        const t = scanTile(scan, g.pos);
        if (t >= 0 && scan.quality[t]! >= GOOD_Q) good++;
        // outside the scanned territory: off the footprint, or higher over the roofs than two openings
        if (t < 0 || scan.footprint[t] !== 1 || (Number.isFinite(scan.roofTop[t]!) && g.pos[1] > scan.roofTop[t]! + 2 * g.opening + 1e-6)) outside++;
        const gt = t >= 0 ? scan.groundTop[t]! : NaN;
        if (Number.isFinite(gt) && g.pos[1] - g.half < gt + lowEdgeM(scan, g.opening) - 1e-6) under++;
        if (Number.isFinite(gt) && g.pos[1] < gt + CITY_LOW_M * scan.unitM) near++;
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
        goodShare: n ? good / n : 0,
        outside,
        underGround: under,
        nearGroundShare: n ? near / n : 0,
        // the smallest opening of the course (a square's side is 1.25 x the ring's diameter of its step)
        openingM: n ? Math.min(...gs.map((g) => g.opening)) : 0
    };
}
