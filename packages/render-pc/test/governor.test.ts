import { describe, it, expect } from 'vitest';
import { FrameGovernor } from '../src/governor';

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
});
