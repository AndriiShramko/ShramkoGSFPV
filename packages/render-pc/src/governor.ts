// Quality governor (phase D): keeps the frame rate at the display's own rate by lowering the
// render scale and the splat budget when frames are missed, and raising them again slowly.
// Pure logic on frame timestamps (no engine, no DOM), so it is tested without a GPU.
//
// A missed frame is an interval longer than 1.5 display periods: at 60 Hz a frame the GPU could
// not finish in time shows up as a 33 ms interval instead of 16.7 ms. The display period itself
// is learned from the shortest intervals seen (a 30 Hz screen stays 30 Hz: that is not "slow").

export interface QualityStep {
    renderScale: number; // backbuffer / CSS pixels * devicePixelRatio
    splatBudgetMillions: number;
}

export const DEFAULT_STEPS: QualityStep[] = [
    { renderScale: 1, splatBudgetMillions: 4 },
    { renderScale: 0.85, splatBudgetMillions: 3 },
    { renderScale: 0.7, splatBudgetMillions: 2.5 },
    { renderScale: 0.6, splatBudgetMillions: 2 },
    { renderScale: 0.5, splatBudgetMillions: 1.5 }
];

export interface GovernorOptions {
    downWindowMs: number; // look this far back before stepping down
    downMissRatio: number; // step down above this share of missed frames
    upWindowMs: number; // a calm period this long before stepping up
    upMissRatio: number; // ... with at most this share of missed frames
}

export const DEFAULT_GOVERNOR: GovernorOptions = { downWindowMs: 1000, downMissRatio: 0.1, upWindowMs: 5000, upMissRatio: 0.01 };

/**
 * The display period, learned from frame intervals: the 5th percentile of the last 30 s,
 * re-sorted every 30 frames. A 60 -> 30 Hz switch is learned within 30 s; half the frames missed
 * is not (the short intervals still say 60 Hz).
 */
export class DisplayPeriod {
    private dts: { t: number; dt: number }[] = [];
    private sinceSort = 0;
    ms = Infinity;

    /** One frame interval `dt` ending at `t` (both ms). */
    add(t: number, dt: number): void {
        this.dts.push({ t, dt });
        while (this.dts.length && t - this.dts[0].t > 30000) this.dts.shift();
        if (this.ms === Infinity || ++this.sinceSort >= 30) {
            this.sinceSort = 0;
            const s = this.dts.map((x) => x.dt).sort((a, b) => a - b);
            this.ms = s[Math.floor(0.05 * (s.length - 1))];
        }
    }
}

export class FrameGovernor {
    enabled = true;
    step = 0;
    readonly steps: QualityStep[];
    readonly opts: GovernorOptions;
    private last = -1;
    private period = new DisplayPeriod();
    private log: { t: number; missed: boolean }[] = [];
    private lastChange = -Infinity;
    changes = 0;

    constructor(steps: QualityStep[] = DEFAULT_STEPS, opts: GovernorOptions = DEFAULT_GOVERNOR) {
        this.steps = steps;
        this.opts = opts;
    }

    get current(): QualityStep {
        return this.steps[this.step];
    }

    get displayPeriodMs(): number {
        return this.period.ms;
    }

    /**
     * Feed one frame timestamp (ms). Returns the new step when the quality changes, else null.
     * `excused`: the interval ending here was made on purpose (the latency guard skipped a frame),
     * so it says nothing about the GPU keeping up and is not counted as a missed frame.
     */
    onFrame(t: number, excused = false): QualityStep | null {
        if (this.last < 0) { this.last = t; return null; }
        const dt = t - this.last;
        this.last = t;
        if (excused) return null;
        if (dt <= 0 || dt > 1000) return null; // paused tab, debugger: not a frame-rate signal
        this.period.add(t, dt);
        const period = this.period.ms;
        this.log.push({ t, missed: dt > 1.5 * period });
        while (this.log.length && t - this.log[0].t > this.opts.upWindowMs) this.log.shift();
        if (!this.enabled) return null;
        const since = t - this.lastChange;
        const ratio = (win: number) => {
            let n = 0, m = 0;
            for (let i = this.log.length - 1; i >= 0 && t - this.log[i].t <= win; i--) { n++; if (this.log[i].missed) m++; }
            return n ? m / n : 0;
        };
        if (since >= this.opts.downWindowMs && this.step < this.steps.length - 1 && ratio(this.opts.downWindowMs) > this.opts.downMissRatio) {
            this.step++;
            this.lastChange = t;
            this.changes++;
            return this.current;
        }
        if (since >= this.opts.upWindowMs && this.step > 0 && ratio(this.opts.upWindowMs) <= this.opts.upMissRatio) {
            this.step--;
            this.lastChange = t;
            this.changes++;
            return this.current;
        }
        return null;
    }
}

// ------------------------------------------------------------------ latency guard
//
// Chrome's compositor can get stuck drawing every main frame one or two BeginFrames late (cc's
// "main thread high-latency mode"): after the scan loads, and again after any main-thread task
// of about 40 ms or more. The frame rate does not change, only the delay: rAF -> presentation is
// 3 or 2 display periods instead of 1 (measured 2026-09-27 at 30 Hz: 100 / 67 / 33 ms, and the
// page never recovers by itself). Chrome leaves the mode only when BeginFrames pass with no main
// frame pending, so the guard skips the engine's rAF for a moment. Measured on the live page at
// 30 Hz: a skip of 3 periods reached 1 frame from 3 and from 2 every time (6 of 6); 1 period
// removes one late frame (3 -> 2, 2 -> 1: 4 of 4); 2 periods from 2 worked only 3 times in 9 and
// once made it 3. The guard therefore skips 3 periods, measures again, and on a second failure
// steps down one period at a time, until it is at 1 frame.
//
// It measures rather than assumes: the renderer inserts a text node in a rAF and Chrome's Element
// Timing reports the presentation time of the frame that committed it, the same frame as the
// canvas (checked against Event Timing on keys: 3.05 / 2.05 / 1.01 frames vs 3.03 / 2.03 / 1.01).

export type GuardAction = { kind: 'measure' } | { kind: 'skip'; ms: number } | null;

export interface LatencyGuardOptions {
    /** recover when rAF -> presentation is at least this many periods (states are 1, 2, 3) */
    actFrames: number;
    /** a routine measurement this often, ms: catches slow states no hitch announced */
    sampleEveryMs: number;
    /** after a skip, measure again this long after the loop resumed, ms */
    settleMs: number;
    /** after a frame interval above 1.5 periods, measure this many periods later */
    hitchDelayFrames: number;
    /** skips in one recovery before waiting `backoffMs`, doubled after each failed recovery up to `maxBackoffMs` */
    maxSkips: number;
    backoffMs: number;
    maxBackoffMs: number;
    /** a measurement that has not come back after this long is dropped (hidden tab) */
    measureTimeoutMs: number;
    /** never hold the loop longer than this, ms */
    maxSkipMs: number;
}

export const DEFAULT_LATENCY_GUARD: LatencyGuardOptions = {
    actFrames: 1.5,
    sampleEveryMs: 2000,
    settleMs: 250,
    hitchDelayFrames: 3,
    maxSkips: 4,
    backoffMs: 10000,
    maxBackoffMs: 80000,
    measureTimeoutMs: 1500,
    maxSkipMs: 150
};

export interface GuardLogEntry {
    t: number;
    what: 'sample' | 'skip' | 'trigger' | 'backoff' | 'gpu';
    /** rAF -> presentation in display periods (sample) */
    frames?: number;
    /** skip length */
    ms?: number;
}

export class LatencyGuard {
    /** measure rAF -> presentation (for the HUD too); set by the app once the scan is on screen */
    active = false;
    /** also skip frames to leave a slow state (?guard=0 turns only this off) */
    recover = true;
    readonly opts: LatencyGuardOptions;
    readonly period = new DisplayPeriod();
    /** last measured rAF -> presentation, ms; NaN before the first measurement */
    rafToPresentMs = NaN;
    lastSampleAt = -Infinity;
    skips = 0;
    readonly log: GuardLogEntry[] = [];
    private lastFrame = -1;
    private lastNow = -1;
    private measureAt = 0;
    /** a measurement owed to a hitch; kept while another measurement is out */
    private hitchDue = Infinity;
    private pendingSince = -1;
    private excuseNext = false;
    private episodeSkips = 0;
    private backoffUntil = -Infinity;
    private backoff: number;

    constructor(opts: LatencyGuardOptions = DEFAULT_LATENCY_GUARD) {
        this.backoff = opts.backoffMs;
        this.opts = opts;
    }

    /** rAF -> presentation of the last measurement in display periods (NaN before one). */
    get frames(): number {
        return this.rafToPresentMs / this.period.ms;
    }

    private note(e: GuardLogEntry): void {
        this.log.push(e);
        if (this.log.length > 200) this.log.shift();
    }

    /** Measure at the next frame (the scan was revealed, the tab came back, ...). */
    trigger(t: number): void {
        if (!this.active) return;
        this.measureAt = Math.min(this.measureAt, Math.max(t, this.backoffUntil));
        this.note({ t, what: 'trigger' });
    }

    /**
     * Every engine frame, inside its rAF: `t` the rAF timestamp, `now` when the callback ran.
     * A 'measure' is done in this frame.
     */
    onFrame(t: number, now = t): GuardAction {
        const dt = this.lastFrame >= 0 ? t - this.lastFrame : NaN;
        const dNow = this.lastNow >= 0 ? now - this.lastNow : NaN;
        this.lastFrame = t;
        this.lastNow = now;
        // the interval that contains our own skip says nothing about the display or a hitch
        const excused = this.excuseNext;
        this.excuseNext = false;
        if (!excused && dt > 0 && dt <= 1000) this.period.add(t, dt);
        const P = this.period.ms;
        if (!this.active || !Number.isFinite(P)) return null;
        // a main-thread task that long can put the compositor back into its slow state. It shows as
        // a late callback more than as a gap in rAF timestamps: a BeginFrame that waited for the
        // task keeps its own time (a 60 ms task went unnoticed by timestamps alone)
        const hitch = !excused && ((dt > 1.5 * P && dt <= 1000) || (dNow > 1.5 * P && dNow <= 1000) || now - t > 0.5 * P);
        if (hitch) this.hitchDue = Math.min(this.hitchDue, Math.max(t + this.opts.hitchDelayFrames * P, this.backoffUntil));
        if (this.pendingSince >= 0) {
            if (t - this.pendingSince < this.opts.measureTimeoutMs) return null;
            this.pendingSince = -1; // never reported (hidden, covered): try again at the next routine check
            this.measureAt = t + this.opts.sampleEveryMs;
        }
        if (t < Math.min(this.measureAt, this.hitchDue)) return null;
        this.hitchDue = Infinity;
        this.pendingSince = t;
        return { kind: 'measure' };
    }

    /**
     * A measurement came back: `ms` from the rAF that committed it to its presentation.
     * `submitToDoneMs`: how long the GPU currently takes to finish a submitted frame (NaN: unknown).
     */
    onSample(t: number, ms: number, submitToDoneMs = NaN): GuardAction {
        this.pendingSince = -1;
        this.rafToPresentMs = ms;
        this.lastSampleAt = t;
        const P = this.period.ms;
        const f = ms / P;
        this.note({ t, what: 'sample', frames: Math.round(f * 100) / 100 });
        if (!this.active) return null;
        if (!this.recover || !(f >= this.opts.actFrames)) {
            this.episodeSkips = 0;
            if (f < this.opts.actFrames) this.backoff = this.opts.backoffMs;
            this.measureAt = t + this.opts.sampleEveryMs;
            return null;
        }
        // frames queue on the GPU (too heavy, or another app renders): the delay is that queue, and
        // skipping would only add stutter; the quality governor deals with a GPU that is too slow.
        // Not at 1 period: at a light load the driver lowers the clock until one frame's work
        // nearly fills its share (4090 at 30 Hz: 18 ms at 1100 MHz, 14 ms at 1700 MHz)
        if (submitToDoneMs > 1.5 * P) {
            this.episodeSkips = 0;
            this.measureAt = t + this.opts.sampleEveryMs;
            this.note({ t, what: 'gpu', ms: Math.round(submitToDoneMs) });
            return null;
        }
        if (this.episodeSkips >= this.opts.maxSkips) {
            // skipping did not help: try again later, less often each time
            this.episodeSkips = 0;
            this.backoffUntil = t + this.backoff;
            this.measureAt = this.backoffUntil;
            this.backoff = Math.min(this.opts.maxBackoffMs, this.backoff * 2);
            this.note({ t, what: 'backoff', ms: this.backoffUntil - t });
            return null;
        }
        this.episodeSkips++;
        this.skips++;
        // 3 periods twice (the way out of 3 and of 2 frames that always worked), then 1 period at a
        // time (each removed one late frame); never 2 periods (it failed 6 times in 9)
        const periods = this.episodeSkips <= 2 ? 3 : 1;
        const skip = Math.min(this.opts.maxSkipMs, periods * P + 1);
        this.excuseNext = true;
        this.measureAt = t + skip + this.opts.settleMs;
        this.note({ t, what: 'skip', ms: Math.round(skip) });
        return { kind: 'skip', ms: skip };
    }
}

/** EdgeTX sends a USB report every 1 ms (4 ms with some RF modules): 2 ms is the typical radio delay. */
export const RADIO_MS = 2;

/**
 * Stick -> screen estimate (ms) for the HUD, stage by stage at display period P:
 * radio 2 + half a period waiting for the frame that reads the input + rAF -> presentation
 * + one period of desktop composition and scan-out. rAF -> presentation is the measured value
 * (it contains the compositor's late frames and any GPU queue at the time of the measurement);
 * the GPU queue seen since (submit -> GPU done above one period) raises it between measurements.
 * Without a measurement it is one period plus that queue.
 */
export function inputToScreenMs(periodMs: number, rafToPresentMs: number, submitToDoneMs: number): number {
    const P = periodMs;
    const queue = Number.isFinite(submitToDoneMs) ? Math.max(0, submitToDoneMs - P) : 0;
    const r2p = Math.max(Number.isFinite(rafToPresentMs) ? rafToPresentMs : 0, P + queue);
    return RADIO_MS + 0.5 * P + r2p + P;
}
