// Lane gen4 (train 4, design C:/dev/.gsfpv-lanes/designs/gen4.md section 0): what the pilot asks of the course generator
// (level, spread, the voxels-only view) and what the plan answers. The shared contract of gen4a (packages/tracks) and
// gen4b (apps/fly): the page builds a CourseRequest from its dialog, the worker hands it to planCourse (plan.ts), the
// link names it ('g2.<seed36>.<level><spread>'). Pure: no DOM, no clock, no Math.random, no trigonometry (the cosines of
// LEVELS are literals).
import type { SceneTransform, TrackFile, Vec3, VoxelCollision } from './types';
import type { ElementKind } from './elements';
import type { FitDeadline } from './fit';

export type CourseLevel = 'beginner' | 'medium' | 'pro';
export type CourseSpread = 'compact' | 'wide';
/** what the scan analysis (scan.ts analyzeScan) reads the scan as */
export type ScanKind = 'room' | 'object' | 'street' | 'cityAbove' | 'plants' | 'unknown';

export interface CourseRequest {
    readonly seed: number;
    readonly level: CourseLevel;
    readonly spread: CourseSpread;
    /** the voxels-only view: scan quality is ignored, the whole scanned territory is used, up to VOXEL_VIEW_GATES gates */
    readonly anyQuality: boolean;
    /** lane w1-anchor: where the course grows from, the pilot's place (courseAnchor: flown m, whole metres); null only for an
     *  old 'g2.' link that names none, which keeps laying the course it laid before (from the analysis core, plan.ts anchorOf) */
    readonly anchor: CourseAnchor | null;
}
/** a course's anchor, flown world m rounded to whole metres (a link carries it, so the page lays the rounded place too) */
export type CourseAnchor = readonly [number, number, number];
/** the pilot's choice in the 'Generate a course' dialog: a request without its seed and its anchor (the page adds both) */
export type CourseAsk = Omit<CourseRequest, 'seed' | 'anchor'>;
export const REQUEST_DEFAULTS: Readonly<CourseAsk> = { level: 'medium', spread: 'compact', anyQuality: false };
/** the gates of a course in the voxels-only view (estimate; under SERVER_MAX_GATES 60) */
export const VOXEL_VIEW_GATES = 40;

/** Lengths in D = the flown craft's diameter (2 x boundRadius, flown m). Every value: source 'estimate' (design G7). */
export interface LevelRules {
    /** ring diameter and square side */
    readonly openingD: number;
    /** also the least spacing of two gates */
    readonly legMinD: number;
    readonly legMaxD: number;
    /** legMax = min(MAX_LEG_M 60, max(legMaxD * D, legMaxFloorM * min(1, zoneRadiusM / 20))) */
    readonly legMaxFloorM: number;
    /** cos of the largest turn at a gate */
    readonly turnCosMin: number;
    /** cos of the largest angle of the gate axis to its leg in */
    readonly axisCosMin: number;
    /** |height change| / horizontal length of a leg */
    readonly climbMax: number;
    readonly gatesMin: number;
    readonly gatesMax: number;
    readonly elements: readonly ElementKind[];
}
export const LEVELS: Readonly<Record<CourseLevel, LevelRules>> = {
    beginner: { openingD: 10, legMinD: 15, legMaxD: 60, legMaxFloorM: 6, turnCosMin: 0.5, axisCosMin: 0.965926, climbMax: 0.15, gatesMin: 5, gatesMax: 8, elements: ['single'] },
    medium: { openingD: 6, legMinD: 10, legMaxD: 80, legMaxFloorM: 12, turnCosMin: -0.258819, axisCosMin: 0.866025, climbMax: 0.35, gatesMin: 8, gatesMax: 14, elements: ['single', 'square', 'tunnel'] },
    pro: { openingD: 4, legMinD: 6, legMaxD: 120, legMaxFloorM: 20, turnCosMin: -0.866025, axisCosMin: 0.866025, climbMax: 0.8, gatesMin: 12, gatesMax: 24, elements: ['single', 'square', 'tunnel', 'flat', 'cube'] }
};

/** a link's course: 'g1.<seed36>' stays the old generator (old links rebuild the very same course); a 'g2.' link's `adds`:
 *  the parts laid by Add here after its first course, in order (lane w1-dialog; empty for a course laid at once) */
export type CourseLink = { readonly kind: 'legacy'; readonly seed: number } | { readonly kind: 'request'; readonly request: CourseRequest; readonly adds: readonly CourseRequest[] };
/** the Add here parts one link carries at most (the address stays short; a longer course travels as a saved one) */
export const MAX_ADDS = 4;
/** joins a link's parts: 'g2.<first>_<seed36>.<b|m|p><c|w|v>.<x>.<y>.<z>_...' ('_' stays as it is in an address) */
export const ADD_SEP = '_';

const LEVEL_CODE: Readonly<Record<CourseLevel, string>> = { beginner: 'b', medium: 'm', pro: 'p' };
const CODE_LEVEL: Readonly<Record<string, CourseLevel>> = { b: 'beginner', m: 'medium', p: 'pro' };
const LEGACY_RE = /^g1\.([0-9a-z]{1,7})$/;
const REQUEST_RE = /^g2\.([0-9a-z]{1,7})\.([bmp])([cwv])(?:\.(-?\d{1,6})\.(-?\d{1,6})\.(-?\d{1,6}))?$/;

/** the anchor of a flown place: whole metres (-0 as 0), the one form a link holds and planCourse is given */
export function courseAnchor(p: ArrayLike<number>): CourseAnchor {
    const r = (v: number): number => Math.round(v) + 0;
    return [r(p[0]!), r(p[1]!), r(p[2]!)];
}

function seedOf(s36: string): number | null {
    const seed = parseInt(s36, 36);
    return Number.isFinite(seed) && seed >= 0 && seed <= 0xffffffff ? seed : null;
}

/** 'g2.<seed36>.<b|m|p><c|w|v>[.<x>.<y>.<z>]'; v: the voxels-only view (anyQuality, which always spreads over the whole
 *  scan); x y z: the anchor, flown whole metres (lane w1-anchor; a link without them is an old one: anchor null) */
export function courseLinkId(r: CourseRequest): string {
    const spread = r.anyQuality ? 'v' : r.spread === 'wide' ? 'w' : 'c';
    const at = r.anchor ? `.${courseAnchor(r.anchor).join('.')}` : '';
    return `g2.${(r.seed >>> 0).toString(36)}.${LEVEL_CODE[r.level]}${spread}${at}`;
}

/** lane w1-dialog: the link of `base` (a course's own link id) with one Add here part more; null when `base` is no 'g2.'
 *  link, the part has no anchor, or the link holds MAX_ADDS parts already (such a course travels only when saved) */
export function addedLinkId(base: string, add: CourseRequest): string | null {
    const b = parseCourseLink(base);
    if (!b || b.kind !== 'request' || !add.anchor || b.adds.length >= MAX_ADDS) return null;
    return `${base}${ADD_SEP}${courseLinkId(add).slice('g2.'.length)}`;
}

function requestOf(m: RegExpExecArray, at: number): CourseRequest | null {
    const seed = seedOf(m[at]!);
    if (seed === null) return null;
    const s = m[at + 2]!;
    const anchor: CourseAnchor | null = m[at + 3] !== undefined ? [Number(m[at + 3]) + 0, Number(m[at + 4]) + 0, Number(m[at + 5]) + 0] : null;
    return { seed, level: CODE_LEVEL[m[at + 1]!]!, spread: s === 'c' ? 'compact' : 'wide', anyQuality: s === 'v', anchor };
}

const ADD_RE = /^([0-9a-z]{1,7})\.([bmp])([cwv])\.(-?\d{1,6})\.(-?\d{1,6})\.(-?\d{1,6})$/;

/** the course a link's `course=` value names, or null when it names no generated course */
export function parseCourseLink(id: string): CourseLink | null {
    const old = LEGACY_RE.exec(id);
    if (old) {
        const seed = seedOf(old[1]!);
        return seed === null ? null : { kind: 'legacy', seed };
    }
    const [first, ...rest] = id.split(ADD_SEP);
    const m = REQUEST_RE.exec(first!);
    if (!m || rest.length > MAX_ADDS) return null;
    const request = requestOf(m, 1);
    if (!request) return null;
    const adds: CourseRequest[] = [];
    for (const part of rest) {
        const a = ADD_RE.exec(part);
        const r = a ? requestOf(a, 1) : null;
        if (!r) return null;
        adds.push(r);
    }
    return { kind: 'request', request, adds };
}

/** 'analyse': the scan analysis; 'free': the free space; 'lay': one try of the gates */
export type PlanStep = 'analyse' | 'free' | 'lay';
export interface PlanHooks {
    /** a step starts, with its expected ms */
    readonly onStep?: (step: PlanStep, estMs: number) => void;
    readonly deadline?: FitDeadline;
}
export interface PlanInput {
    /** flown walls, as the worker builds them */
    readonly walls: VoxelCollision;
    /** [s, tx, ty, tz] of the flight now */
    readonly transform: SceneTransform;
    /** flown world: the author's camera (session findSpawn); planCourse grows the course from request.anchor, not from here */
    readonly spawn: Vec3;
    readonly scene: { readonly id: string; readonly version: number };
    /** ISO 8601 */
    readonly created: string;
    /** the flown craft's boundRadius; the page without one passes SMALLEST_DRONE_RADIUS_M */
    readonly craftRadiusM: number;
    readonly request: CourseRequest;
    /** false for the sound mode's course ask */
    readonly elements: boolean;
    /** lane w1-dialog, Add here: the course shown now, laid on these walls. Its gates stay gate for gate; the request's
     *  course is laid round its anchor away from them and spliced into the ring (extend.ts joinCourses). Absent: a new course. */
    readonly keep?: TrackFile | null;
}
/** the measured placement, for the page hook, the probes and the Node audit (placementStats) */
export interface PlanStats {
    readonly kind: ScanKind;
    readonly gates: number;
    readonly closed: boolean;
    /** straight, flown m, last gate to gate 1 (0 when closed) */
    readonly startFinishM: number;
    /** gate 1 to the analysis core, flown m */
    readonly startToCoreM: number;
    /** the finish (the last gate; gate 1 when closed) to the analysis core, flown m */
    readonly finishToCoreM: number;
    /** share of gates whose top edge is under the leaves' top (roofTop of its tile): plants G6 */
    readonly underTopShare: number;
    /** share of gates on tiles of quality >= GOOD_Q */
    readonly goodShare: number;
    /** gates outside the scanned territory (must be 0) */
    readonly outside: number;
    /** gates whose lower edge is under groundTop + LOW_EDGE_M (must be 0) */
    readonly underGround: number;
    /** gates with centre under groundTop + 4 m * unit (cityAbove: <= 0.2) */
    readonly nearGroundShare: number;
    readonly openingM: number;
}
/** shrunk: the level's opening did not fit and a smaller one (down to 4 D) was used; eased: the asked request laid no
 *  course at all and the course is the one of an easier ask (compact, then one level easier: plan.ts fallbackAsks);
 *  fitSize: the Scene size at which the 4 D gate fits, or null when none does */
export type PlanAnswer =
    | { readonly ok: true; readonly track: TrackFile; readonly stats: PlanStats; readonly start: { readonly pos: Vec3; readonly yawDeg: number }; readonly shrunk: boolean; readonly eased: boolean }
    | { readonly ok: false; readonly reason: 'no-room'; readonly kind: ScanKind; readonly fitSize: number | null }
    /** Add here: no course laid round the anchor joined the kept ring (or the kept course has SERVER_MAX_GATES already) */
    | { readonly ok: false; readonly reason: 'no-join'; readonly kind: ScanKind; readonly fitSize: null };
