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

/**
 * A simulated Chrome compositor: it presents `late` frames after the one that committed, the
 * load leaves it at 2 late frames, a skip of k periods removes up to k of them (as measured on the
 * live page: 34 ms -> one, 67 ms from 2 frames and 100 ms from 3 -> all), a 60 ms task adds one back.
 */
class Page {
    t = 0;
    late = 2;
    readonly P: number;
    holdUntil = 0;
    /** submit -> GPU done the renderer reports with each measurement */
    submitToDone = NaN;
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
            const a = g.onFrame(this.t);
            if (a?.kind === 'measure') pending.push({ at: this.t + 3 * this.P, value: (1 + this.late) * this.P + 0.5 });
        }
    }
    skip(ms: number): void {
        const missed = Math.floor(ms / this.P); // BeginFrames that pass with no main frame
        this.late = Math.max(0, this.late - missed);
        this.holdUntil = this.t + ms;
    }
    longTask(ms: number): void {
        this.t += ms;
        this.late = Math.max(this.late, 1);
    }
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
    it('frames queued on the GPU (submit -> done above a period) are not skipped: that delay is the queue', () => {
        const page = new Page(1000 / 30);
        page.submitToDone = 150; // another app renders (measured: 156 ms with a 42 ms GPU load)
        const g = new LatencyGuard();
        page.run(g, 2000);
        g.active = true;
        g.trigger(page.t);
        page.run(g, 10000);
        expect(g.skips).toBe(0);
        expect(g.log.some((e) => e.what === 'gpu')).toBe(true);
        // control: the same slow state with an idle GPU is skipped out of
        page.submitToDone = 12;
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
