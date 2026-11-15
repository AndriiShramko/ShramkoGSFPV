// Train 3, lane course3, stage G1-progress (the owner's message 51: "I do not understand whether it hung or is working, at
// which stage, how long to wait"): one progress line for the walls build and for the course generation. The name of the
// step in plain words, step n of m and a percent, the time so far and what is left from the rates below; a step that runs
// past its estimate says so instead of a number. The page re-draws the line every second (PROGRESS_TICK_MS) and speaks it
// to Fly by Sound at the pace of SpeechPacer. DOM-free: tools/bench/test/course-progress.test.ts runs it in Node.
import { S } from '@gsfpv/sim-core';

/** The page re-draws the line this often (the owner: never silent for more than two seconds). A setting. */
export const PROGRESS_TICK_MS = 1000;

// ---- rates. Course: tools/bench/scripts/course-rate.mjs over the K1.1 audit (U:/Temp/gsfpv-train2/tracks2/audit-new,
// Node 22, this PC, 2026-11-14). One generateCourse try at 5 cm walls: 46.1 s (70b50d42), 30.7 s (887f27aa), 42.8 s
// (9baef54b), 32.7 s (ba7aa29d), mean 38.1 s; at 10 cm 5.5 and 6.3 s; at 20 cm 0.9 s: a factor 6.5 per halving of the cell,
// so the cell's exponent is 2.7. Forest Floor (ab5efa0e, 29 m3 free) 0.48 s a try. The free-space pass: 62 to 2376 ms.
// F2-fast-course (2026-11-15, CR-3): after the sweep fix (check.ts sweepFree, occupancy.ts) one fitCourse try of 24 gates
// over the quality map took 3336 ms on Wroclaw 70b50d42 and 2905 ms on Tunis 887f27aa (node --cpu-prof of
// course-quality-audit.ts --quality seed 1, GPU lock held, U:/Temp/gsfpv-train3/course3/f2/after2/*.top.txt): mean 3.1 s.
// The free step on the page is qualityMap + freeSpace: 1547 + 3547 ms on Wroclaw, 182 + 1082 ms on Tunis.

/** ms of one course try on 5 cm walls with a large free space (F2: mean of Wroclaw and Tunis, Node, see above) */
export const COURSE_TRY_MS_5CM = 3_100;
/** time of a try grows as cell^-0.9 (F2, course-quality-audit.ts --quality, 3 seeds, measured under load without the GPU
 *  lock: 10 cm 0230d903 2.4-4.9 s, 20 cm eb5f51dc 0.54-1.38 s; 5 cm 3.1 s and 20 cm 0.87 s give 0.92. Before F2 the
 *  sweeps made it 2.7) */
export const COURSE_CELL_EXPONENT = 0.9;
/** ESTIMATE: under this much free space a try is shorter in proportion (the four 5 cm scans had 15-25 thousand m3) */
export const COURSE_FULL_M3 = 15_000;
/** the shortest try measured (ab5efa0e, 0.48 s), rounded up */
export const COURSE_TRY_MIN_MS = 500;
/** the free step of the page (qualityMap and freeSpace over its box), the longest measured: Wroclaw 1547 + 3547 ms (F2) */
export const FREE_SPACE_MS = 5_100;

/** Expected ms of one course try on walls of cell `cellM` with `volumeM3` of free space (rates above). */
export function courseTryMs(cellM: number, volumeM3: number): number {
    const cell = cellM > 0 ? cellM : 0.05;
    const room = Math.min(1, Math.max(0, volumeM3) / COURSE_FULL_M3);
    return Math.max(COURSE_TRY_MIN_MS, Math.round(COURSE_TRY_MS_5CM * Math.pow(0.05 / cell, COURSE_CELL_EXPONENT) * room));
}

// Walls: the browser bake's seconds per million Gaussians are bake.ts LADDER_S_PER_MILLION (9.5, walls-trials.ts) or what
// this machine measured on its last bake (wallcache loadBakeSpeed). The voxelising part of it, measured by the walls lane's
// probes (U:/Temp/gsfpv-train2/walls ladder.json, ladder-fixes.json, w3-chain*.json, lastBake.ms): Tunis 4.02 M Gaussians
// 7.4, 6.6, 6.4 s; Wroclaw level 2 10.7 M Gaussians 29.3 s; the most per million is 2.74 s.
/** voxelising seconds per million Gaussians (the most measured, above) */
export const VOXELIZE_S_PER_MILLION = 2.74;
// CR-2: the walls build holds the page's main thread inside @playcanvas/splat-transform (bake.ts: materializeToDataTable and
// cropToCore in the 'read' step, writeVoxel in 'voxelize'): freezes of 13.5 s and 10.0 s (G1-look, Wroclaw), the longest
// unchanged text 21.0 s (G4 build-look). The box says so before, and its moving bar (a compositor animation) goes on.
/** ESTIMATE rounded up from the freezes above: how long the line says the picture may stop */
export const FREEZE_NOTE_S = 25;
/** the steps of a walls build during which the picture may stop */
export function mayFreeze(stepKey: string): boolean {
    return stepKey === 'read' || stepKey === 'voxelize';
}
/** ESTIMATE: asking the scan its size (one small request) */
export const SIZE_MS = 1_000;

/** The steps of a walls build of `gaussians` on a device that bakes `sPerMillion` seconds per million. */
export function wallsSteps(gaussians: number, sPerMillion: number): Step[] {
    const total = (Math.max(0, gaussians) / 1e6) * sPerMillion * 1000;
    const voxelize = Math.min(total, (Math.max(0, gaussians) / 1e6) * VOXELIZE_S_PER_MILLION * 1000);
    return [
        { key: 'size', estMs: SIZE_MS },
        { key: 'read', estMs: Math.max(1000, Math.round(total - voxelize)) },
        { key: 'voxelize', estMs: Math.max(1000, Math.round(voxelize)) }
    ];
}

/** `make` (generateCourse in the worker) that says before every try how long it is expected to take: the first by
 *  `firstMs`, every later one by what the last try took here. */
export function layTries<A extends unknown[], R>(post: (estMs: number) => void, firstMs: number, now: () => number, make: (...a: A) => R): (...a: A) => R {
    let last: number | null = null;
    return (...a: A): R => {
        post(last ?? firstMs);
        const t = now();
        try {
            return make(...a);
        } finally {
            last = Math.max(1, Math.round(now() - t));
        }
    };
}

/** The steps of a course: the free space, then the obstacles (the estimate of a try comes from the worker). */
export function courseSteps(tryMs: number | null): Step[] {
    return [
        { key: 'free', estMs: FREE_SPACE_MS },
        { key: 'lay', estMs: tryMs ?? COURSE_TRY_MS_5CM }
    ];
}

export interface Step {
    readonly key: string;
    readonly estMs: number;
}

export type ProgressWhat = 'walls' | 'wallsLighter' | 'refine' | 'course';

export interface ProgressView {
    readonly what: ProgressWhat;
    readonly key: string;
    /** 1-based step number and the number of steps */
    readonly n: number;
    readonly m: number;
    /** the course: which try of the obstacles (1 on the first) */
    readonly attempt: number;
    readonly elapsedS: number;
    /** seconds left by the estimate; null when the step already runs past its estimate */
    readonly leftS: number | null;
    readonly pct: number;
}

/** The clock of one build: which step runs, since when, and the estimate of every step. */
export class ProgressClock {
    private steps: Step[];
    private i = 0;
    private readonly t0: number;
    private ti: number;
    private tries = 1;
    /** G4: the share of the running step the earlier tries already showed (a new try goes on from it, never back) */
    private stepBase = 0;
    /** G4: the highest percent shown so far; the line never goes back (message 51: "try 3 ... 75 %, then try 4 ... 63 %") */
    private shown = 0;

    constructor(public what: ProgressWhat, steps: readonly Step[], private readonly now: () => number) {
        this.steps = steps.slice();
        this.t0 = now();
        this.ti = this.t0;
    }

    /** The step `key` starts now (a new estimate when given); a key not in the plan is ignored. Entering the running step
     *  again (the next try of the obstacles) restarts its clock and counts the try. */
    enter(key: string, estMs?: number): void {
        const j = this.steps.findIndex((s) => s.key === key);
        if (j < 0) return;
        if (j === this.i && j > 0 && this.now() > this.ti) {
            this.tries++;
            const est = this.steps[j]!.estMs;
            const f = est > 0 ? Math.min(1, (this.now() - this.ti) / est) : 1;
            this.stepBase += (1 - this.stepBase) * f;
        } else if (j !== this.i) {
            this.tries = 1;
            this.stepBase = 0;
        }
        this.i = j;
        this.ti = this.now();
        if (estMs !== undefined && estMs > 0) this.steps[j] = { key, estMs };
    }

    /** New estimates for the steps (a lighter way of the walls); the time so far goes on. */
    replan(steps: readonly Step[], what?: ProgressWhat): void {
        this.steps = steps.slice();
        this.i = 0;
        this.ti = this.now();
        this.tries = 1;
        this.stepBase = 0;
        if (what) this.what = what;
    }

    view(): ProgressView {
        const now = this.now();
        const step = this.steps[this.i] ?? { key: '', estMs: 0 };
        const inStep = Math.max(0, now - this.ti);
        const later = this.steps.slice(this.i + 1).reduce((a, s) => a + s.estMs, 0);
        const before = this.steps.slice(0, this.i).reduce((a, s) => a + s.estMs, 0);
        const total = before + step.estMs + later;
        const over = inStep > step.estMs;
        const inShare = step.estMs > 0 ? Math.min(1, inStep / step.estMs) : 1;
        const done = before + step.estMs * (this.stepBase + (1 - this.stepBase) * inShare);
        const pct = total > 0 ? Math.min(99, Math.floor((100 * done) / total)) : 0;
        this.shown = Math.max(this.shown, pct);
        return {
            what: this.what,
            key: step.key,
            n: this.i + 1,
            m: this.steps.length,
            attempt: this.tries,
            elapsedS: Math.floor((now - this.t0) / 1000),
            leftS: over ? null : Math.ceil((step.estMs - inStep + later) / 1000),
            pct: this.shown
        };
    }
}

type T = (key: string, params?: Record<string, string | number>) => string;

/** m:ss */
export function clock(s: number): string {
    const v = Math.max(0, Math.round(s));
    return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`;
}

/** Seconds left as the line says them: up to a minute by 5 s, then by half minutes (an estimate is not a stopwatch). */
export function roundLeft(s: number): number {
    if (s <= 60) return Math.max(5, Math.ceil(s / 5) * 5);
    return Math.ceil(s / 30) * 30;
}

function stepText(v: ProgressView, t: T): string {
    if (v.key === 'lay' && v.attempt > 1) return t('progress.step.layAgain', { k: v.attempt });
    return t(`progress.step.${v.key}`);
}

/** The line on the screen: what, which step, n of m, percent, the time so far and what is left. */
export function progressLine(v: ProgressView, t: T): string {
    const p = { what: t(`progress.what.${v.what}`), step: stepText(v, t), n: v.n, m: v.m, pct: v.pct, elapsed: clock(v.elapsedS) };
    return v.leftS === null ? t('progress.lineOver', p) : t('progress.line', { ...p, left: clock(roundLeft(v.leftS)) });
}

/** The spoken line: shorter, no percent and no clock digits. */
export function spokenLine(v: ProgressView, t: T): string {
    const p = { what: t(`progress.what.${v.what}`), step: stepText(v, t), n: v.n, m: v.m };
    if (v.leftS === null) return t('progress.spokenOver', p);
    const left = roundLeft(v.leftS);
    return left >= 60 ? t('progress.spokenMin', { ...p, min: Math.round(left / 60) }) : t('progress.spokenSec', { ...p, s: left });
}

/** ESTIMATE (a setting): a spoken progress line on every new step, else at most every SPEAK_EVERY_MS. */
export const SPEAK_EVERY_MS = 20_000;
/** a new step that comes sooner than this after the last line waits for the next tick (no lines on top of each other) */
export const SPEAK_GAP_MS = 4_000;

/** When to speak: a new step or try at once (after SPEAK_GAP_MS), otherwise every SPEAK_EVERY_MS. */
export class SpeechPacer {
    private last = -Infinity;
    private said = '';

    constructor(private readonly now: () => number) {}

    due(v: ProgressView): boolean {
        const t = this.now();
        const key = `${v.what}/${v.key}/${v.attempt}`;
        const gap = t - this.last;
        const ok = key !== this.said ? gap >= SPEAK_GAP_MS : gap >= SPEAK_EVERY_MS;
        if (ok) {
            this.last = t;
            this.said = key;
        }
        return ok;
    }
}

/** A course that arrives while the drone flies is announced this long before its gates appear (a setting). */
export const COURSE_WARN_MS = 3_000;

/** The craft sits armed-off at its spawn (session.swapWallsIfParked's rule): a course may appear at once. */
export function isParked(s: ArrayLike<number>, spawn: ArrayLike<number>): boolean {
    return s[S.hold] !== 0 && Math.hypot(s[S.px]! - spawn[0]!, s[S.py]! - spawn[1]!, s[S.pz]! - spawn[2]!) <= 1e-3;
}
