// K1.2 (lane tracks2): a course for every scan that has room for one gate. The plan's course (scale 1: 1.2-1.5 m gates,
// 3-15 m legs, 4 gates at least) does not fit a small scan (Forest Floor ab5efa0e: 29.3 m3 of free space, every seed gave
// 1 gate). fitCourse tries the plan's size first, then smaller courses: gates, the free radius they need, legs, spacing,
// the proof's margin and the free space a gate takes all shrink by the same factor, down to what the smallest drone of
// the simulator flies. When no course reaches gatesMin it answers the one with the most gates (the smallest sensible
// course), never nothing while one gate fits.
import type { SceneTransform } from '@shramko/sonic-fpv';
import type { TrackFile, VoxelCollision } from './types';
import { marginOf } from './check';
import { wallsCheck } from './editor';
import { upgradeTrack } from './format';
import { COURSE_DEFAULTS, generateCourse } from './generate';
import type { CourseOptions, CourseParams } from './generate';
import { FREE_DEFAULTS, freeSpace } from './freespace';
import type { FreeSpace, FreeSpaceOptions } from './freespace';
import { MARGIN_M } from './check';

/** The smallest drone's size: air65-1s and meteor65pro-1s, boundRadius 0.0425 m (measured: tools/bench/src/drone-sizes.ts,
 *  the simulator's compileParams over packages/sim-core/presets). */
export const SMALLEST_DRONE_RADIUS_M = 0.0425;
/** The smallest ring opening, in diameters of the smallest drone (estimate: room for a whoop to miss the centre). */
export const RING_MIN_DRONE_DIAMETERS = 4;
/** The scales tried, largest first: the ladder of gate sizes (course4 C3, owner's message 57: a room gets gates for a
 *  whoop). The square's opening (SQUARE_SIDE_M x scale) steps 1.5, 1.0, 0.6, 0.45 m, the ring's (RING_DIAMETER_M x scale)
 *  1.2, 0.8, 0.48, 0.36 m. 0.6 m is about a tiny whoop's race gate (estimate). The last keeps the ring at
 *  RING_MIN_DRONE_DIAMETERS diameters of the smallest drone: 0.34 m / 1.2 m = 0.283, rounded up to 0.3. */
export const COURSE_SCALES: readonly number[] = [1, 2 / 3, 0.4, 0.3];
/** derived seeds tried per scale (the page's earlier rule, lane review TR-8: 3) */
export const SEEDS_PER_SCALE = 3;
/** Review T2-6, ESTIMATE: the worker's time for fitCourse, under the page's GENERATE_LIMIT_MS (150 s) by room for
 *  freeSpace and the answer. 3 x 3 tries at the 15.5-22.9 s a course measured on 887f27aa could pass 150 s. */
export const FIT_BUDGET_MS = 120_000;

/** Review FY-1, ESTIMATE: a course is taken at once when it has at least this share of the gates the generator wanted
 *  (generator.params.wanted); a shorter proven one is kept while the next seeds of the same scale are tried. Wroclaw seed 3
 *  walked 4 of 24 (gate-place-audit, fix3b/fixes/fy1-before.json) and fitCourse took it, as gatesMin is 4. */
export const FULL_SHARE = 0.5;
/** The gates a course needs to be taken at once: gatesMin, or FULL_SHARE of the generator's wanted count if more. Only a
 *  course over a quality map (generator version 3 and up) is judged so: a link to a course of versions 1 and 2 regenerates
 *  the very course it had. */
export function fullOf(t: TrackFile, gatesMin: number): number {
    const major = Number(/^(\d+)/.exec(String(t.generator?.version ?? ''))?.[1] ?? 0);
    const want = (t.generator?.params as { wanted?: unknown } | undefined)?.wanted;
    return Math.max(gatesMin, major >= 3 && typeof want === 'number' ? Math.ceil(FULL_SHARE * want) : 0);
}
/** When fitCourse must stop: `at` on the clock `now` (ms). */
export interface FitDeadline {
    readonly at: number;
    readonly now: () => number;
}

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

/**
 * course4 C3: the free space for a smaller step of the ladder: read at the step's margin, and a room counts from the
 * plan's smallest room (minRoomM3) times the step cubed, as the gates and legs shrink by the step (the low room of
 * every-scan.test.ts: 3.9 m3 of cells at the 0.4 step, under the plan's 8 m3).
 */
export function freeAtMargin(walls: VoxelCollision, opts: FreeSpaceOptions, marginM: number): FreeSpace {
    const k = Math.min(1, marginM / MARGIN_M);
    const U = Math.max(1, opts.unitM ?? 1);
    return freeSpace(walls, { ...opts, marginM, minRoomM3: (opts.minRoomM3 ?? FREE_DEFAULTS.minRoomM3 * U * U * U) * k * k * k });
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
    /** the course passed the generator's own final proof (checkTrack with the turns after the gates, stricter than the Save) */
    readonly proven: boolean;
}

/**
 * Lane fix3b: the generator's final proof (generate.ts, generator.params.proof) is the Save check plus the turn after
 * each gate. A course whose proof failed is not given while a proven one can be had: the next seed or scale is tried.
 * A course without a proof record (no gates, or a fake generator in tests) counts as proven.
 */
export function provenCourse(t: TrackFile): boolean {
    const p = t.generator?.params?.proof as { ok?: boolean } | null | undefined;
    return p?.ok !== false;
}

/**
 * Lane fix3b: the generator ends with the very check the edit mode's Save runs on the course as the pilot gets it
 * (wallsCheck on upgradeTrack of the file, at marginOf(file), in the flown transform): a course it refuses is not given
 * while another seed or scale gives one it passes. Only a course with a proof record is checked (a fake generator in
 * tests gives none).
 */
export function savesUntouched(t: TrackFile, walls: VoxelCollision, transform: SceneTransform): boolean {
    if (!t.generator?.params?.proof || t.gates.length === 0) return true;
    return wallsCheck(walls, transform, marginOf(t))(upgradeTrack(t)).length === 0;
}

/**
 * Review FY-3: a course the Save check refuses untouched loses the gates the check names (a gate in a wall or facing the
 * wrong way: that gate; a leg through a wall: its far gate, or its near one when the far end is the start or the finish),
 * one round at a time, until the check passes it. Null when no gate is named (the start itself is in a wall) or none is
 * left. The proof record keeps the generator's verdict; only its gates change.
 */
export function trimToSave(t: TrackFile, walls: VoxelCollision, transform: SceneTransform): TrackFile | null {
    let cur = t;
    for (let round = 0; round < t.gates.length; round++) {
        const problems = wallsCheck(walls, transform, marginOf(cur))(upgradeTrack(cur));
        if (problems.length === 0) return cur;
        const ids = new Set(cur.gates.map((g) => g.id));
        const named = new Set<string>();
        for (const p of problems) {
            if (p.code === 'outside' || p.code === 'gate-wall' || p.code === 'gate-direction') named.add(p.gate);
            else if (p.code === 'leg-wall') named.add(ids.has(p.to) ? p.to : p.from);
        }
        // one gate a round, the earliest named: a gate moved into a wall also turns its next gate's way in, and that
        // gate is mended by the first one's drop (the next round checks again)
        const drop = cur.gates.findIndex((g) => named.has(g.id));
        const gates = cur.gates.filter((_, i) => i !== drop);
        if (gates.length === cur.gates.length || gates.length === 0) return null;
        cur = { ...cur, gates: gates.map((g, i) => ({ ...g, id: `g${i + 1}` })) };
    }
    return null;
}

/**
 * The first course of at least `gatesMin` gates over COURSE_SCALES (each with SEEDS_PER_SCALE derived seeds); at scale 1
 * the seeds and courses are exactly those of the page's enoughGates before K1.2. Else the course with the most gates.
 */
export function fitCourse(free: FreeSpace, walls: VoxelCollision, opts: CourseOptions, gatesMin: number = COURSE_DEFAULTS.gatesMin, make: typeof generateCourse = generateCourse, deadline: FitDeadline | null = null, refree: ((marginM: number) => FreeSpace) | null = null): FitResult {
    // course4 C3: a smaller gate needs a smaller margin, and the free space read at the plan's margin (0.5 m) may hold no
    // cell at all in a room (Modlinek 39e63ce9: 0 usable cells at 0.5 m, 2204 at 0.25 m; Winter Garden 7a475d38: the spawn's
    // fill reached 2 cells at 0.5 m, 3029488 at 0.25 m; gate-place-audit --diag --margin). A step whose margin is under the
    // free space's reads it again at that margin (refree, once per margin)
    const frees = new Map<number, FreeSpace>();
    const freeAt = (m: number): FreeSpace => {
        if (!refree || !(m < free.marginM - 1e-9)) return free;
        let f = frees.get(m);
        if (!f) frees.set(m, (f = refree(m)));
        return f;
    };
    let best: TrackFile | null = null;
    let bestScale = 1;
    let bestOk = false;
    let tried = 0;
    let longest = 0;
    const end = (): FitResult => {
        // review FY-3: no try passed the Save check: the best one loses the gates the check names (a proof that failed
        // stays failed: trimming cannot mend it)
        if (best && !bestOk && provenCourse(best)) {
            const cut = trimToSave(best, walls, opts.transform);
            if (cut) return { track: cut, short: cut.gates.length < gatesMin, scale: bestScale, tried, proven: true };
        }
        return { track: best, short: best !== null && (best.gates.length < gatesMin || !bestOk), scale: bestScale, tried, proven: best !== null && bestOk };
    };
    for (const scale of COURSE_SCALES) {
        const params = { ...scaledParams(scale), ...(opts.params ?? {}) };
        let s = opts.seed >>> 0;
        for (let i = 0; i < SEEDS_PER_SCALE; i++) {
            // review T2-6: with a course in hand, a try that would end past the deadline is not started (the page's
            // watchdog would end the worker and the pilot would get nothing); the longest try so far is the estimate
            if (deadline && best && deadline.now() + longest > deadline.at) return end();
            const t0 = deadline ? deadline.now() : 0;
            const t = make(freeAt(params.marginM), walls, { ...opts, seed: s & 0x7fffffff, params });
            const ok = provenCourse(t) && savesUntouched(t, walls, opts.transform);
            if (deadline) longest = Math.max(longest, deadline.now() - t0);
            tried++;
            if (ok && t.gates.length >= fullOf(t, gatesMin)) return { track: t, short: false, scale, tried, proven: true };
            // a proven course beats an unproven one of any length; among the same kind the one with more gates
            if (t.gates.length > 0 && ((ok && !bestOk) || (ok === bestOk && t.gates.length > (best?.gates.length ?? 0)))) {
                best = t;
                bestScale = scale;
                bestOk = ok;
            }
            s = nextSeed(s);
        }
        // review FY-1: a proven course of at least gatesMin gates at this scale beats any course of a smaller one.
        // course4 review CU-5: below the plan's size a course under its full share does not stop the ladder: the next step
        // is tried and the course with more gates kept (Forest Floor ab5efa0e: 10 gates at the old step 0.5, then 5-7 at the
        // new 2/3, which stopped the ladder; c3/before.json, c3p2/after2.json). Step 1 keeps FY-1 (street tables unchanged).
        if (best && bestOk && best.gates.length >= (scale < 1 ? fullOf(best, gatesMin) : gatesMin)) return end();
    }
    return end();
}
