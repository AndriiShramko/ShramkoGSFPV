// Quality governor (phase D): keeps the frame rate at the display's own rate by lowering the
// render scale and the splat budget when frames are missed, and raising them again slowly.
// Pure logic on frame timestamps (no engine, no DOM), so it is tested without a GPU.
//
// A missed frame is an interval longer than 1.25 display periods: at 60 Hz a frame the GPU could
// not finish in time shows up as a 33 ms interval instead of 16.7 ms. The display period itself
// is learned from the shortest intervals seen (a 30 Hz screen stays 30 Hz: that is not "slow").

/** a frame interval above this many display periods counts as a missed frame */
export const MISSED_PERIODS = 1.25;

/**
 * The shortest period a frame is judged against, ms (lane loadq2, the lead's decision R1): frames that come at 60 a second
 * or faster are smooth enough (60 is the lead's estimate of what pilots accept), so a 144 Hz screen whose frames come at
 * 90 a second does not lower the detail. Before R1 the learned period alone was used: 2.5 ms with the frame rate free on
 * the RTX 4090, and every tenth frame of 17.8 ms stepped a hand-set 16 M down to 6 M (docs/wip/loadq.md, lq-wro-16unc).
 */
export const MIN_JUDGED_PERIOD_MS = 1000 / 60;

/**
 * R1 measured (loadq2, keeper log k-after-govlog3 on Wroclaw, frame rate free): every frame the keeper counted as missed
 * was a held frame of about 17.5 ms after a short one (the two together 21 to 26 ms, over 1.25 x 16.7) while the down
 * window held 130 to 140 frames a second, and the detail went down four steps. So the keeper also counts the pictures
 * drawn in the down window (judged frames that were not held): at MIN_SMOOTH_FPS or more a second it never steps down,
 * whatever share of the frames came late (60: the lead's estimate, as above).
 */
export const MIN_SMOOTH_FPS = 60;

/**
 * R2, the keeper does not alternate (estimates of the lead): a step up followed by a step down within FLAP_MS doubles the
 * calm wait before the next step up (upWindowMs at the start), up to MAX_UP_WAIT_MS; a step up that held for UP_HELD_MS
 * puts the wait back to its start.
 */
export const FLAP_MS = 10000;
export const MAX_UP_WAIT_MS = 120000;
export const UP_HELD_MS = 60000;

/** Frame intervals the display period is learned from before the governor judges any frame (2 s at 30 Hz). */
export const PERIOD_MIN_SAMPLES = 60;

export interface QualityStep {
    renderScale: number; // backbuffer / CSS pixels * devicePixelRatio
    splatBudgetMillions: number;
}

/**
 * The steps at the default top budget (4 M splats). A scene that asks for another budget (its link's
 * ?budget=, drawing.ts) moves the top: FrameGovernor.setTopBudget scales every step's budget by the
 * same factor, so the shares stay 1, 3/4, 5/8, 1/2, 3/8 of the top and the render scales stay as here.
 */
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
    /** frame intervals the display period is learned from before any frame is judged (PERIOD_MIN_SAMPLES) */
    periodMinSamples?: number;
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
    private readonly minSamples: number;

    constructor(minSamples = PERIOD_MIN_SAMPLES) {
        this.minSamples = minSamples;
    }

    /**
     * Enough intervals to trust the period (PERIOD_MIN_SAMPLES). Before that the estimate is a few
     * intervals' 5th percentile, i.e. their smallest: measured on ba7aa29d, the first intervals after a
     * reveal taught 9-16 ms on a 30 Hz display, and every on-time frame then read as missed.
     */
    get learned(): boolean {
        return this.dts.length >= this.minSamples;
    }

    /** One frame interval `dt` ending at `t` (both ms). */
    add(t: number, dt: number): void {
        this.dts.push({ t, dt });
        while (this.dts.length && t - this.dts[0].t > 30000) this.dts.shift();
        // every frame while learning (few samples, cheap), then every 30 frames
        if (this.ms === Infinity || !this.learned || ++this.sinceSort >= 30) {
            this.sinceSort = 0;
            const s = this.dts.map((x) => x.dt).sort((a, b) => a - b);
            this.ms = s[Math.floor(0.05 * (s.length - 1))];
        }
    }
}

export class FrameGovernor {
    enabled = true;
    step = 0;
    /** the steps at the current top budget (setTopBudget); the first is the top */
    steps: QualityStep[];
    readonly opts: GovernorOptions;
    /** the constructor's steps: setTopBudget scales their budgets */
    private readonly base: QualityStep[];
    private last = -1;
    private period: DisplayPeriod;
    /** each judged frame: missed or not */
    private log: { t: number; missed: boolean; held: boolean }[] = [];
    private lastChange = -Infinity;
    changes = 0;
    /**
     * Missed frames that came while the scan was streaming (onFrame `streamed`): counted like every other
     * missed frame, kept apart only for the report (F3's data, a bug report's details).
     */
    streamHitches = 0;
    /** the previous frame reported streaming: its work can make this interval late */
    private streamedBefore = false;
    /** the time of the last frame that reported streaming (onFrame `streamed`); settledStep waits for calm after it */
    private lastStreamed = -Infinity;
    /** the display period is learned and frames are judged (see onFrame) */
    private judging = false;
    /** frames are judged for a step down only a whole down window after this (a gap, the end of a rest: rest()) */
    private windowFrom = -Infinity;
    /** the previous judged interval, ms (a held frame spans it and its own) */
    private prevDt = 0;
    /** R2: the calm wait before a step up now, ms, and the time of the last step up (-Infinity: none open) */
    upWaitMs: number;
    private lastUpAt = -Infinity;

    constructor(steps: QualityStep[] = DEFAULT_STEPS, opts: GovernorOptions = DEFAULT_GOVERNOR) {
        this.base = steps;
        this.steps = steps.map((s) => ({ ...s }));
        this.opts = opts;
        this.period = new DisplayPeriod(opts.periodMinSamples ?? PERIOD_MIN_SAMPLES);
        this.upWaitMs = opts.upWindowMs;
    }

    /**
     * The period a frame is judged against, ms: the learned display period, at least MIN_JUDGED_PERIOD_MS (R1).
     * Infinity before anything was learned.
     */
    get judgedPeriodMs(): number {
        return Math.max(this.period.ms, MIN_JUDGED_PERIOD_MS);
    }

    /**
     * A frame at rest (lane loadq G6, apps/fly quality.ts): the slower frames of a still picture are chosen, not missed,
     * so nothing is judged or learned; the next judged frame measures from this one, and a step down needs a whole down
     * window of judged frames after the rest (review LR-3: the first heavy frames after a move were judged alone).
     */
    rest(t: number): void {
        this.last = t;
        this.streamedBefore = false;
        this.prevDt = 0;
        this.windowFrom = t;
    }

    get current(): QualityStep {
        return this.steps[this.step];
    }

    /** The top step's splat budget, millions: what the governor gives when no frame is missed. */
    get topBudgetMillions(): number {
        return this.steps[0].splatBudgetMillions;
    }

    /**
     * Make `m` million splats the top level (a scene's link asked for that budget, drawing.ts). Every
     * step's budget scales by m / the constructor's top, so the governor lowers the budget from there
     * in the same proportions; the step it is on and its history stay (a missed frame a moment ago
     * still counts). Returns true when the steps changed.
     */
    setTopBudget(m: number): boolean {
        if (!(m > 0) || !Number.isFinite(m)) throw new RangeError(`bad top budget ${m}`);
        const k = m / this.base[0].splatBudgetMillions;
        const next = this.base.map((s) => ({ renderScale: s.renderScale, splatBudgetMillions: s.splatBudgetMillions * k }));
        if (next.every((s, i) => s.splatBudgetMillions === this.steps[i].splatBudgetMillions)) return false;
        this.steps = next;
        return true;
    }

    get displayPeriodMs(): number {
        return this.period.ms;
    }

    /**
     * Start from step `s` instead of the top (weak-devices-plan 2.1, R32): the step this browser settled at on its last
     * flight (savedStartStep). Clamped to the steps; the governor still moves up after a calm upWindowMs, so a start
     * that is too low costs a few seconds of a lower budget, not a frozen page.
     */
    startAt(s: number): void {
        if (!Number.isFinite(s)) return;
        this.step = Math.max(0, Math.min(this.steps.length - 1, Math.round(s)));
    }

    /**
     * The step when it has held for `holdMs` of judged frames at time `t` (no step change since) and the scan's
     * streamer made no progress in that time, else null: the step this device settles at while it flies a loaded
     * view, worth remembering for the next load. Steps taken while a streamed scan loads (its hitches count as
     * missed frames, onFrame) are not remembered (review LP-1).
     */
    settledStep(t: number, holdMs: number): number | null {
        if (!this.judging || !this.enabled) return null;
        return t - Math.max(this.lastChange, this.lastStreamed) >= holdMs ? this.step : null;
    }

    /**
     * The keeper has judged this load's frames and would not step down now: off, at its lowest step, or judging with a
     * whole down window since its last change (or rest) and no more missed frames in it than it allows. The still rise
     * (lane loadq G6) waits for this, so the flight's step is chosen before the detail rises (review LR-4).
     */
    calm(t: number): boolean {
        if (!this.enabled || this.step >= this.steps.length - 1) return true;
        if (!this.judging || t - Math.max(this.lastChange, this.windowFrom) < this.opts.downWindowMs) return false;
        return this.downWindow(t).n > 0 && !this.tooSlow(t);
    }

    /** The judged frames of the last down window: all, missed, and pictures drawn (not held). */
    private downWindow(t: number): { n: number; m: number; drawn: number } {
        let n = 0, m = 0, drawn = 0;
        for (let i = this.log.length - 1; i >= 0 && t - this.log[i].t <= this.opts.downWindowMs; i--) {
            n++;
            if (this.log[i].missed) m++;
            if (!this.log[i].held) drawn++;
        }
        return { n, m, drawn };
    }

    /** The down window has more missed frames than allowed and fewer than MIN_SMOOTH_FPS pictures a second (R1). */
    private tooSlow(t: number): boolean {
        const w = this.downWindow(t);
        return w.n > 0 && w.m / w.n > this.opts.downMissRatio && w.drawn * 1000 < MIN_SMOOTH_FPS * this.opts.downWindowMs;
    }

    /**
     * Feed one frame timestamp (ms). Returns the new step when the quality changes, else null.
     * `excused`: the interval ending here was made on purpose (the latency guard skipped a frame),
     * so it says nothing about the GPU keeping up and is not counted as a missed frame.
     * `held`: the renderer did not draw the frame before this one because the GPU had not finished
     * the previous one (SplatRenderer.maxFramesInFlight): the display repeated a picture, a missed
     * frame although the animation frames themselves came on time.
     * `streamed`: the scan's streamer made progress since the previous frame (SplatRenderer.streamTicks:
     * a level-of-detail file requested or arrived, the count of files in flight changed). It does not
     * change the judgement: a missed or held frame here or at the next frame counts like any other and is
     * also counted in streamHitches, for the report. A streamed scan (levels of detail, D27) streams all
     * the time it is flown, so an excuse for streaming would hide a real overload for the whole flight;
     * and a lower budget does lighten the streamer (fewer, coarser nodes). The owner's coarse city scan
     * came from this governor's clock and period, not from streaming (v0.8 item 8, review R1,
     * docs/wip/v08-c.md).
     */
    onFrame(t: number, excused = false, held = false, streamed = false): QualityStep | null {
        if (streamed) this.lastStreamed = t;
        if (this.last < 0) {
            this.last = t;
            this.streamedBefore = streamed;
            return null;
        }
        const dt = t - this.last;
        this.last = t;
        const streaming = streamed || this.streamedBefore;
        this.streamedBefore = streamed;
        if (excused) return null;
        // paused tab, debugger: not a frame-rate signal; a step down then needs a whole window of frames after it
        if (dt <= 0 || dt > 1000) { this.windowFrom = t; this.prevDt = 0; return null; }
        this.period.add(t, dt);
        // a frame is late only against a display period learned from enough frames
        if (!this.period.learned) return null;
        // the first judged frame starts the clock as a change would: a share of missed frames needs a
        // whole window of judged frames (one held frame among the first four is not "25 % of a second")
        if (!this.judging) {
            this.judging = true;
            this.lastChange = t;
        }
        const period = this.judgedPeriodMs;
        // 1.25 periods: a frame that took ~1.4 periods already makes the display repeat one (a 45 ms
        // frame on a 30 Hz screen); 1.5 let a steady 22 fps pass as 'on time'. A held frame repeated the previous
        // picture: the picture changed after this interval and the one before, judged against the same bound (R1:
        // two 7 ms intervals of a 144 Hz screen are a 14 ms picture, faster than 60 a second)
        const missed = held ? this.prevDt + dt > MISSED_PERIODS * period : dt > MISSED_PERIODS * period;
        this.prevDt = dt;
        if (missed && streaming) this.streamHitches++;
        this.log.push({ t, missed, held });
        while (this.log.length && t - this.log[0].t > this.opts.upWindowMs) this.log.shift();
        if (!this.enabled) return null;
        const since = t - this.lastChange;
        // R2: a step up that held for UP_HELD_MS puts the wait back to its start
        if (this.lastUpAt > -Infinity && t - this.lastUpAt >= UP_HELD_MS) { this.upWaitMs = this.opts.upWindowMs; this.lastUpAt = -Infinity; }
        // the share of missed frames in the last `win` ms
        const ratio = (win: number) => {
            let n = 0, m = 0;
            for (let i = this.log.length - 1; i >= 0 && t - this.log[i].t <= win; i--) {
                n++;
                if (this.log[i].missed) m++;
            }
            return n ? m / n : 0;
        };
        if (since >= this.opts.downWindowMs && t - this.windowFrom >= this.opts.downWindowMs && this.step < this.steps.length - 1 && this.tooSlow(t)) {
            // R2: down again soon after a step up: the next step up waits twice as long
            if (t - this.lastUpAt < FLAP_MS) this.upWaitMs = Math.min(MAX_UP_WAIT_MS, this.upWaitMs * 2);
            this.lastUpAt = -Infinity;
            this.step++;
            this.lastChange = t;
            this.changes++;
            return this.current;
        }
        if (since >= this.upWaitMs && this.step > 0 && ratio(this.opts.upWindowMs) <= this.opts.upMissRatio) {
            this.lastUpAt = t;
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
    /** frames that are late this often in the last `overloadWindowMs` are an overload, not a slow
     *  compositor: no skips then (the quality governor lowers the load; skipping would hide it) */
    overloadShare: number;
    overloadWindowMs: number;
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
    maxSkipMs: 150,
    overloadShare: 0.3,
    overloadWindowMs: 1500
};

export interface GuardLogEntry {
    t: number;
    what: 'sample' | 'skip' | 'trigger' | 'backoff' | 'gpu' | 'overload' | 'held';
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
    /**
     * A recording (or the video export) runs: measure, but do not skip. A skip of 3 periods is 2-3
     * slots of the 60 fps file that repeat the previous picture (W4-1, live R1: 4 skips in 10 s were
     * 8 of the file's 59 repeated slots); the guard skips again once the recording stops.
     */
    holdSkips = false;
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
    /** recent frame intervals (our own skips left out): late = above 1.5 periods */
    private recent: { t: number; late: boolean }[] = [];

    constructor(opts: LatencyGuardOptions = DEFAULT_LATENCY_GUARD) {
        this.backoff = opts.backoffMs;
        this.opts = opts;
    }

    /** Late frames make up at least `overloadShare` of the recent ones (8 frames at least). */
    overloaded(t: number): boolean {
        const r = this.recent.filter((x) => t - x.t <= this.opts.overloadWindowMs);
        return r.length >= 8 && r.filter((x) => x.late).length / r.length >= this.opts.overloadShare;
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
        if (!excused && dt > 0 && dt <= 1000 && Number.isFinite(P)) {
            this.recent.push({ t, late: dt > MISSED_PERIODS * P });
            while (this.recent.length && t - this.recent[0].t > this.opts.overloadWindowMs) this.recent.shift();
        }
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
        // the frames themselves keep coming late (CPU or GPU cannot keep up): that is the governor's
        // job; a skip would also hide these late frames from it (it excuses the skipped interval)
        if (this.overloaded(t)) {
            this.episodeSkips = 0;
            this.measureAt = t + this.opts.sampleEveryMs;
            this.note({ t, what: 'overload' });
            return null;
        }
        if (this.holdSkips) {
            this.episodeSkips = 0;
            this.measureAt = t + this.opts.sampleEveryMs;
            this.note({ t, what: 'held' });
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

// ------------------------------------------------------------------ the step a device starts at
//
// weak-devices-plan.md 2.1 (R32): a weak device that starts every load at the top step misses frames for its first
// seconds on the way down. The step it settled at is remembered per browser (localStorage), keyed by the device class
// and the GPU's name, and the next load starts there (FrameGovernor.startAt). Another class or GPU starts at the top.

/** localStorage key of the remembered step (the record's `v` is its version). */
export const GOVERNOR_START_KEY = 'gsfpv.governor.start';

/**
 * How long a step must hold before it is remembered, ms: two of the governor's calm windows (DEFAULT_GOVERNOR
 * upWindowMs 5000), so a step taken while the scan loads and left again 5 s later is not kept. An estimate, not measured.
 */
export const GOVERNOR_SETTLE_MS = 10000;

/**
 * Whether a device of this class may start below the top step: not 'desktop-strong', so nothing changes for a strong
 * PC at default settings (weak-devices-plan focus point 4, review LP-1). Its step is still remembered, never used.
 */
export function governorMayStartLower(deviceClass: string): boolean {
    return deviceClass !== 'desktop-strong';
}

/**
 * The device's id in the record: its class and the GPU's name (gpuName). The plan's "release major" is the record's
 * version `v` (governorStartRecord): the app carries no release number; a change of the governor's steps bumps `v`.
 */
export function governorDeviceId(deviceClass: string, gpu: string): string {
    return `${deviceClass}|${gpu}`;
}

/** The stored record for `id` at `step`. */
export function governorStartRecord(id: string, step: number): string {
    return JSON.stringify({ v: 1, id, step });
}

/** The step to start at from the stored record `raw`: its step when the record is for `id`, else 0 (the top). */
export function savedStartStep(raw: string | null | undefined, id: string, steps: number): number {
    if (!raw) return 0;
    try {
        const r = JSON.parse(raw) as { v?: unknown; id?: unknown; step?: unknown };
        if (r?.v !== 1 || r.id !== id || typeof r.step !== 'number' || !Number.isInteger(r.step)) return 0;
        return r.step >= 0 && r.step < steps ? r.step : 0;
    } catch {
        return 0;
    }
}
