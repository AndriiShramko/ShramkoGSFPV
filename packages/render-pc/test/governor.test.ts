import { describe, it, expect } from 'vitest';
import { FrameGovernor, LatencyGuard, DEFAULT_LATENCY_GUARD, inputToScreenMs } from '../src/governor';

/** Frames at a display period; `load(t)` says how many periods each frame takes (1 = on time). */
function run(g: FrameGovernor, period: number, seconds: number, load: (t: number) => number, t0 = 0): { t: number; steps: number[] } {
    let t = t0;
    const steps: number[] = [];
    g.onFrame(t);
    while (t < t0 + seconds * 1000) {
        t += period * load(t);
        g.onFrame(t);
        steps.push(g.step);
    }
    return { t, steps };
}

describe('quality governor', () => {
    it('keeps full quality when every frame is on time, at 60 Hz and at 30 Hz', () => {
        for (const p of [1000 / 60, 1000 / 30]) {
            const g = new FrameGovernor();
            run(g, p, 20, () => 1);
            expect(g.step).toBe(0);
            expect(g.changes).toBe(0);
            expect(g.displayPeriodMs).toBeCloseTo(p, 3);
        }
    });

    it('steps down within ~1 s when half the frames are missed, and back up after a calm 5 s', () => {
        const g = new FrameGovernor();
        const p = 1000 / 60;
        let k = 0;
        const heavy = run(g, p, 3, () => (k++ % 2 ? 2 : 1)); // every other frame takes two periods
        expect(g.step).toBeGreaterThan(0);
        const firstDown = heavy.steps.findIndex((s) => s > 0);
        expect(firstDown * p * 1.5).toBeLessThan(1500);
        const worst = g.step;
        run(g, p, 30, () => 1, heavy.t);
        expect(g.step).toBeLessThan(worst);
        expect(g.step).toBe(0);
    });

    it('a 60 -> 30 Hz display switch is learned, not treated as overload for long', () => {
        const g = new FrameGovernor();
        const a = run(g, 1000 / 60, 10, () => 1);
        run(g, 1000 / 30, 60, () => 1, a.t);
        expect(g.displayPeriodMs).toBeCloseTo(1000 / 30, 1);
        expect(g.step).toBe(0); // any early step-down has recovered once the period was re-learned
    });

    it('negative control: disabled, the same overload changes nothing', () => {
        const g = new FrameGovernor();
        g.enabled = false;
        let k = 0;
        run(g, 1000 / 60, 5, () => (k++ % 2 ? 2 : 1));
        expect(g.step).toBe(0);
        expect(g.changes).toBe(0);
    });

    it('frames the renderer held for the GPU queue are missed frames although rAF stays on time', () => {
        // the frame cap (SplatRenderer.maxFramesInFlight) holds every other picture for 3 s: the
        // animation frames still come every period, only the 'held' flag says the display repeated one
        const heldEvery = (g: FrameGovernor, flag: boolean) => {
            const p = 1000 / 30;
            g.onFrame(0);
            for (let i = 1; i <= 90; i++) g.onFrame(i * p, false, flag && i % 2 === 0);
        };
        const held = new FrameGovernor();
        heldEvery(held, true);
        expect(held.step).toBeGreaterThan(0);
        const blind = new FrameGovernor(); // control: the same frames without the flag look perfect
        heldEvery(blind, false);
        expect(blind.changes).toBe(0);
    });

    it('intervals the latency guard made on purpose are not missed frames', () => {
        // 8 skips of 3 periods within 2 s at 30 Hz: counted, that is > 10 % missed and a step down
        const skipsEvery = (g: FrameGovernor, excuse: boolean) => {
            const p = 1000 / 30;
            let t = 0;
            g.onFrame(t);
            for (let i = 0; i < 300; i++) {
                const skip = i > 60 && i < 120 && i % 7 === 0;
                t += skip ? 3 * p : p;
                g.onFrame(t, excuse && skip);
            }
        };
        const excused = new FrameGovernor();
        skipsEvery(excused, true);
        expect(excused.changes).toBe(0);
        const counted = new FrameGovernor(); // control: the same frames, not excused
        skipsEvery(counted, false);
        expect(counted.changes).toBeGreaterThan(0);
    });
});

// v0.8 item 8 (docs/wip/v08-c.md): a streamed scan's hitches are not GPU overload. Measured on
// ba7aa29d (evidence/2026-10-16/v08-lod-probe-before-2.json): after the reveal 154 files were requested
// at once and frames of 124, 67 and 42 ms followed, then 34-41 ms frames while they arrived; the old
// rule stepped 4 M -> 2 M and render scale 1 -> 0.6 in 2.5 s and needed 17 s to climb back.
describe('quality governor: streaming hitches', () => {
    const P = 1000 / 30;
    /** 30 Hz frames for `n` frames; `late(i)`: periods frame i takes; `streamed(i)`, `held(i)`: its flags. */
    function feed(g: FrameGovernor, n: number, late: (i: number) => number, streamed: (i: number) => boolean, held: (i: number) => boolean = () => false): void {
        let t = 0;
        // 2 s of calm first: the display period is learned before anything happens
        g.onFrame(t);
        for (let i = 0; i < 60; i++) g.onFrame(t += P);
        for (let i = 0; i < n; i++) {
            t += P * late(i);
            g.onFrame(t, false, held(i), streamed(i));
        }
    }
    // the reveal's burst, then every 4th frame 1.4 periods while files arrive (6 s)
    const revealLate = (i: number) => (i < 3 ? [3.7, 2, 1.3][i] : i % 4 === 0 ? 1.4 : 1);

    it('late frames while the streamer works are not counted: full quality stays', () => {
        const g = new FrameGovernor();
        // the streamer reports progress on the frame before each late one (its work lands in the next interval)
        feed(g, 180, revealLate, (i) => i < 3 || (i + 1) % 4 === 0 || i % 4 === 0);
        expect(g.changes).toBe(0);
        expect(g.streamHitches).toBeGreaterThan(40);
    });

    it('a late frame right after the frame that streamed is excused too (the work lands in the next interval)', () => {
        const g = new FrameGovernor();
        // progress only on the frame BEFORE each late one
        feed(g, 180, (i) => (i % 4 === 0 ? 1.4 : 1), (i) => (i + 1) % 4 === 0);
        expect(g.changes).toBe(0);
        // control: progress two frames before is too old: counted, 25 % missed, a step down
        const old = new FrameGovernor();
        feed(old, 180, (i) => (i % 4 === 0 ? 1.4 : 1), (i) => (i + 2) % 4 === 0);
        expect(old.changes).toBeGreaterThan(0);
    });

    it('negative control: the same frames without the streaming flag step down (the v0.7 rule)', () => {
        const g = new FrameGovernor();
        feed(g, 180, revealLate, () => false);
        expect(g.changes).toBeGreaterThan(0);
        expect(g.step).toBeGreaterThan(0);
    });

    it('a real overload while streaming still lowers the drawing: every frame late, progress on 1 frame in 4', () => {
        const g = new FrameGovernor();
        feed(g, 90, () => 2, (i) => i % 4 === 0);
        expect(g.step).toBeGreaterThan(0);
    });

    it('frames held for the GPU count even while streaming (that is the GPU, not the streamer)', () => {
        const g = new FrameGovernor();
        feed(g, 90, () => 1, () => true, (i) => i % 2 === 0);
        expect(g.step).toBeGreaterThan(0);
        expect(g.streamHitches).toBe(0);
    });
});

/**
 * A simulated Chrome compositor: it presents `late` frames after the one that committed, the
 * load leaves it at 2 late frames, a skip of 1 period removes one and a skip of 3 periods all of
 * them (as measured on the live page), a 60 ms task adds one back. `stubborn` skips of 3 periods
 * fail first (2 periods failed 6 times in 9 on the live page; the guard must not depend on luck).
 */
class Page {
    t = 0;
    late = 2;
    readonly P: number;
    holdUntil = 0;
    /** submit -> GPU done the renderer reports with each measurement */
    submitToDone = NaN;
    /** the next callback runs this late behind its rAF timestamp (a task the timestamps do not show) */
    private lateNext = 0;
    constructor(P: number) {
        this.P = P;
    }
    /** Run frames for `ms`, feeding the guard; measurements come back 3 frames later. */
    run(g: LatencyGuard, ms: number): void {
        const end = this.t + ms;
        const pending: { at: number; value: number }[] = [];
        while (this.t < end) {
            this.t += this.P;
            if (this.t < this.holdUntil) continue; // no rAF while the guard holds the loop
            for (let i = pending.length - 1; i >= 0; i--) {
                if (pending[i].at > this.t) continue;
                const a = g.onSample(this.t, pending[i].value, this.submitToDone);
                pending.splice(i, 1);
                if (a?.kind === 'skip') this.skip(a.ms);
            }
            if (this.t < this.holdUntil) continue;
            const a = g.onFrame(this.t, this.t + this.lateNext);
            this.lateNext = 0;
            if (a?.kind === 'measure') pending.push({ at: this.t + 3 * this.P, value: (1 + this.late) * this.P + 0.5 });
        }
    }
    /** the next this many long skips do nothing */
    stubborn = 0;
    skip(ms: number): void {
        const missed = Math.floor(ms / this.P); // BeginFrames that pass with no main frame
        this.holdUntil = this.t + ms;
        if (missed >= 2 && this.stubborn > 0) { this.stubborn--; return; }
        this.late = missed >= 3 ? 0 : Math.max(0, this.late - missed);
    }
    /** `hidden`: the BeginFrame that waited keeps its timestamp, only the callback is late */
    longTask(ms: number, hidden = false): void {
        if (hidden) this.lateNext = ms;
        else this.t += ms;
        this.late = Math.max(this.late, 1);
    }
}

/** The same page, but the guard is fed rAF timestamps only (the first version of the guard). */
function runWithoutCallbackTime(page: Page): Page['run'] {
    return (g: LatencyGuard, ms: number) => {
        const orig = g.onFrame.bind(g);
        g.onFrame = (t: number) => orig(t, t);
        Page.prototype.run.call(page, g, ms);
        g.onFrame = orig;
    };
}

describe('latency guard', () => {
    for (const hz of [30, 60]) {
        it(`at ${hz} Hz: from the loaded state (3 frames) to 1 frame within 3 s, and back after a 60 ms task`, () => {
            const page = new Page(1000 / hz);
            const g = new LatencyGuard();
            page.run(g, 2000); // loading: the period is learned, nothing is measured yet
            expect(g.skips).toBe(0);
            g.active = true;
            g.trigger(page.t);
            page.run(g, 3000);
            expect(page.late).toBe(0);
            expect(g.frames).toBeLessThanOrEqual(1.2);
            expect(g.skips).toBeGreaterThanOrEqual(1);
            expect(g.skips).toBeLessThanOrEqual(2);
            const before = g.skips;
            page.longTask(60); // a hitch: the frame interval shows it, the guard measures and recovers
            page.run(g, 3000);
            expect(page.late).toBe(0);
            expect(g.skips).toBeGreaterThan(before);
            // calm: routine measurements only, no more skips
            const calm = g.skips;
            page.run(g, 20000);
            expect(g.skips).toBe(calm);
            expect(g.log.filter((e) => e.what === 'sample').length).toBeGreaterThan(8);
        });
    }

    it('when long skips do not take, it steps down one period at a time and still gets to 1 frame', () => {
        const page = new Page(1000 / 30);
        page.stubborn = 2;
        const g = new LatencyGuard();
        page.run(g, 2000);
        g.active = true;
        g.trigger(page.t);
        page.run(g, 3000);
        expect(page.late).toBe(0);
        const lens = g.log.filter((e) => e.what === 'skip').map((e) => e.ms);
        expect(lens).toEqual([101, 101, 34, 34]);
    });

    it('a task that only makes the callback late (same rAF timestamps) is caught within a few frames', () => {
        for (const withNow of [true, false]) {
            const page = new Page(1000 / 30);
            const g = new LatencyGuard();
            page.run(g, 2000);
            g.active = true;
            g.trigger(page.t);
            page.run(g, 3000);
            expect(page.late).toBe(0);
            page.run(g, 1000); // mid-way between two routine measurements
            const t0 = page.t;
            page.longTask(60, true);
            if (!withNow) page.run = runWithoutCallbackTime(page); // control: timestamps only
            page.run(g, 600);
            const skip = g.log.find((e) => e.what === 'skip' && e.t > t0);
            if (withNow) expect(skip && skip.t - t0).toBeLessThan(400);
            else expect(skip).toBeUndefined(); // only the routine measurement, later, would find it
        }
    });

    it('negative control: recover off (?guard=0) measures the slow state and never skips', () => {
        const page = new Page(1000 / 30);
        const g = new LatencyGuard();
        page.run(g, 2000);
        g.active = true;
        g.recover = false;
        g.trigger(page.t);
        page.run(g, 5000);
        expect(g.skips).toBe(0);
        expect(page.late).toBe(2);
        expect(g.frames).toBeGreaterThanOrEqual(2.9);
    });

    it('a state skipping cannot fix (GPU-bound) is tried a few times, then left alone for a while', () => {
        const page = new Page(1000 / 30);
        page.skip = function (ms: number) { this.holdUntil = this.t + ms; }; // late frames never go away
        const g = new LatencyGuard();
        page.run(g, 2000);
        g.active = true;
        g.trigger(page.t);
        page.run(g, 5000);
        expect(g.skips).toBe(DEFAULT_LATENCY_GUARD.maxSkips);
        page.run(g, DEFAULT_LATENCY_GUARD.backoffMs - 6000);
        expect(g.skips).toBe(DEFAULT_LATENCY_GUARD.maxSkips);
        expect(g.log.some((e) => e.what === 'backoff')).toBe(true);
    });
});

describe('latency guard and the GPU', () => {
    it('frames queued on the GPU (submit -> done above 1.5 periods) are not skipped: that delay is the queue', () => {
        const page = new Page(1000 / 30);
        page.submitToDone = 150; // another app renders (measured: 156 ms with a 42 ms GPU load)
        const g = new LatencyGuard();
        page.run(g, 2000);
        g.active = true;
        g.trigger(page.t);
        page.run(g, 10000);
        expect(g.skips).toBe(0);
        expect(g.log.some((e) => e.what === 'gpu')).toBe(true);
        // control: the same slow state with a lightly loaded, down-clocked GPU is skipped out of
        page.submitToDone = 1000 / 30; // one full period of work, no queue behind it
        page.run(g, 3000);
        expect(g.skips).toBeGreaterThan(0);
        expect(page.late).toBe(0);
    });

    it('each failed recovery waits twice as long as the one before', () => {
        const page = new Page(1000 / 30);
        page.skip = function (ms: number) { this.holdUntil = this.t + ms; };
        const g = new LatencyGuard();
        page.run(g, 2000);
        g.active = true;
        g.trigger(page.t);
        page.run(g, 60000);
        const waits = g.log.filter((e) => e.what === 'backoff').map((e) => Math.round(e.ms ?? NaN));
        expect(waits.slice(0, 3)).toEqual([10000, 20000, 40000]);
        expect(g.skips).toBe(DEFAULT_LATENCY_GUARD.maxSkips * waits.length);
    });
});

describe('input -> screen estimate', () => {
    it('is radio + half a period + measured rAF -> presentation + one period of composition', () => {
        const P = 1000 / 30;
        // measured on the live page: 3 frames as loaded, 1 frame recovered (plan: about 152 / 85 ms)
        expect(inputToScreenMs(P, 3 * P, 10)).toBeCloseTo(2 + 0.5 * P + 3 * P + P, 6);
        expect(Math.round(inputToScreenMs(P, P, 10))).toBe(85);
        expect(Math.round(inputToScreenMs(1000 / 60, 1000 / 60, 5))).toBe(44);
    });

    it('a GPU queue seen after the last measurement raises it; without a measurement it is one period plus the queue', () => {
        const P = 1000 / 30;
        expect(inputToScreenMs(P, P, P + 100)).toBeCloseTo(2 + 0.5 * P + P + 100 + P, 6);
        expect(inputToScreenMs(P, NaN, NaN)).toBeCloseTo(2 + 0.5 * P + P + P, 6);
    });
});
