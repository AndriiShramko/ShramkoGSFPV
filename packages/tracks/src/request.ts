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
}
export const REQUEST_DEFAULTS: Readonly<Omit<CourseRequest, 'seed'>> = { level: 'medium', spread: 'compact', anyQuality: false };
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

/** a link's course: 'g1.<seed36>' stays the old generator (old links rebuild the very same course) */
export type CourseLink = { readonly kind: 'legacy'; readonly seed: number } | { readonly kind: 'request'; readonly request: CourseRequest };

const LEVEL_CODE: Readonly<Record<CourseLevel, string>> = { beginner: 'b', medium: 'm', pro: 'p' };
const CODE_LEVEL: Readonly<Record<string, CourseLevel>> = { b: 'beginner', m: 'medium', p: 'pro' };
const LEGACY_RE = /^g1\.([0-9a-z]{1,7})$/;
const REQUEST_RE = /^g2\.([0-9a-z]{1,7})\.([bmp])([cwv])$/;

function seedOf(s36: string): number | null {
    const seed = parseInt(s36, 36);
    return Number.isFinite(seed) && seed >= 0 && seed <= 0xffffffff ? seed : null;
}

/** 'g2.<seed36>.<b|m|p><c|w|v>'; v: the voxels-only view (anyQuality, which always spreads over the whole scan) */
export function courseLinkId(r: CourseRequest): string {
    const spread = r.anyQuality ? 'v' : r.spread === 'wide' ? 'w' : 'c';
    return `g2.${(r.seed >>> 0).toString(36)}.${LEVEL_CODE[r.level]}${spread}`;
}

/** the course a link's `course=` value names, or null when it names no generated course */
export function parseCourseLink(id: string): CourseLink | null {
    const old = LEGACY_RE.exec(id);
    if (old) {
        const seed = seedOf(old[1]!);
        return seed === null ? null : { kind: 'legacy', seed };
    }
    const m = REQUEST_RE.exec(id);
    if (!m) return null;
    const seed = seedOf(m[1]!);
    if (seed === null) return null;
    const s = m[3]!;
    return { kind: 'request', request: { seed, level: CODE_LEVEL[m[2]!]!, spread: s === 'c' ? 'compact' : 'wide', anyQuality: s === 'v' } };
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
    /** flown world */
    readonly spawn: Vec3;
    readonly scene: { readonly id: string; readonly version: number };
    /** ISO 8601 */
    readonly created: string;
    /** the flown craft's boundRadius; the page without one passes SMALLEST_DRONE_RADIUS_M */
    readonly craftRadiusM: number;
    readonly request: CourseRequest;
    /** false for the sound mode's course ask */
    readonly elements: boolean;
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
/** shrunk: the level's opening did not fit and a smaller one (down to 4 D) was used; fitSize: the Scene size at which the
 *  4 D gate fits, or null when none does */
export type PlanAnswer =
    | { readonly ok: true; readonly track: TrackFile; readonly stats: PlanStats; readonly start: { readonly pos: Vec3; readonly yawDeg: number }; readonly shrunk: boolean }
    | { readonly ok: false; readonly reason: 'no-room'; readonly kind: ScanKind; readonly fitSize: number | null };
