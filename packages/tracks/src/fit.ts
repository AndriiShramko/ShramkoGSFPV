// K1.2 (lane tracks2): a course for every scan that has room for one gate. The plan's course (scale 1: 1.2-1.5 m gates,
// 3-15 m legs, 4 gates at least) does not fit a small scan (Forest Floor ab5efa0e: 29.3 m3 of free space, every seed gave
// 1 gate). fitCourse tries the plan's size first, then smaller courses: gates, the free radius they need, legs, spacing,
// the proof's margin and the free space a gate takes all shrink by the same factor, down to what the smallest drone of
// the simulator flies. When no course reaches gatesMin it answers the one with the most gates (the smallest sensible
// course), never nothing while one gate fits.
import type { TrackFile, VoxelCollision } from './types';
import { COURSE_DEFAULTS, generateCourse } from './generate';
import type { CourseOptions, CourseParams } from './generate';
import type { FreeSpace } from './freespace';

/** The smallest drone's size: air65-1s and meteor65pro-1s, boundRadius 0.0425 m (measured: tools/bench/src/drone-sizes.ts,
 *  the simulator's compileParams over packages/sim-core/presets). */
export const SMALLEST_DRONE_RADIUS_M = 0.0425;
/** The smallest ring opening, in diameters of the smallest drone (estimate: room for a whoop to miss the centre). */
export const RING_MIN_DRONE_DIAMETERS = 4;
/** The scales tried, largest first. The last keeps the ring (1.2 m x scale) at RING_MIN_DRONE_DIAMETERS diameters of the
 *  smallest drone: 0.34 m / 1.2 m = 0.283, rounded up to 0.3. 0.5 is the step between (estimate). */
export const COURSE_SCALES: readonly number[] = [1, 0.5, 0.3];
/** derived seeds tried per scale (the page's earlier rule, lane review TR-8: 3) */
export const SEEDS_PER_SCALE = 3;

/** The plan's params at `scale`: lengths times scale, the free space a gate takes times scale cubed. */
export function scaledParams(scale: number, base: CourseParams = COURSE_DEFAULTS): CourseParams {
    if (scale === 1) return base;
    return {
        ...base,
        marginM: base.marginM * scale,
        legMinM: base.legMinM * scale,
        legMaxM: base.legMaxM * scale,
        spacingM: base.spacingM * scale,
        m3PerGate: base.m3PerGate * scale * scale * scale,
        scale
    };
}

/** The next seed after `s` (the same derivation as the page's enoughGates). */
export function nextSeed(s: number): number {
    return (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0;
}

export interface FitResult {
    /** the course, or null only when not one gate fits at the smallest scale */
    readonly track: TrackFile | null;
    /** the course has fewer than gatesMin gates */
    readonly short: boolean;
    readonly scale: number;
    /** courses generated */
    readonly tried: number;
}

/**
 * The first course of at least `gatesMin` gates over COURSE_SCALES (each with SEEDS_PER_SCALE derived seeds); at scale 1
 * the seeds and courses are exactly those of the page's enoughGates before K1.2. Else the course with the most gates.
 */
export function fitCourse(free: FreeSpace, walls: VoxelCollision, opts: CourseOptions, gatesMin: number = COURSE_DEFAULTS.gatesMin, make: typeof generateCourse = generateCourse): FitResult {
    let best: TrackFile | null = null;
    let bestScale = 1;
    let tried = 0;
    for (const scale of COURSE_SCALES) {
        const params = { ...scaledParams(scale), ...(opts.params ?? {}) };
        let s = opts.seed >>> 0;
        for (let i = 0; i < SEEDS_PER_SCALE; i++) {
            const t = make(free, walls, { ...opts, seed: s & 0x7fffffff, params });
            tried++;
            if (t.gates.length >= gatesMin) return { track: t, short: false, scale, tried };
            if (t.gates.length > (best?.gates.length ?? 0)) {
                best = t;
                bestScale = scale;
            }
            s = nextSeed(s);
        }
    }
    return { track: best, short: best !== null, scale: bestScale, tried };
}
