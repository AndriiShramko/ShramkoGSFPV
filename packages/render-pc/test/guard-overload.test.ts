import { describe, it, expect } from 'vitest';
import { FrameGovernor, LatencyGuard } from '../src/governor';

// Found by the live D acceptance (2026-09-27): with every frame late (a machine that cannot keep up),
// the guard took each late frame for a slow compositor and skipped; the governor excuses skipped
// intervals, so quality never went down. Overload is the governor's job: the guard must stand back.
const P = 1000 / 30;

function feed(g: LatencyGuard, from: number, frames: number, periods: number): number {
    let t = from;
    for (let i = 0; i < frames; i++) {
        t += periods * P;
        g.onFrame(t, t);
    }
    return t;
}

describe('latency guard under overload', () => {
    it('does not skip when the frames themselves keep coming late, and lets the governor step down', () => {
        const g = new LatencyGuard();
        g.active = true;
        let t = feed(g, 0, 90, 1); // learn the period on normal frames
        t = feed(g, t, 30, 2); // every frame now takes 2 periods
        expect(g.overloaded(t)).toBe(true);
        expect(g.onSample(t, 3 * P)).toBeNull(); // slow, but it is load: no skip

        // the governor, fed the same late frames (none excused), lowers the quality
        const gov = new FrameGovernor();
        let u = 0;
        gov.onFrame(u);
        for (let i = 0; i < 90; i++) { u += P; gov.onFrame(u); }
        for (let i = 0; i < 60; i++) { u += 2 * P; gov.onFrame(u, false); }
        expect(gov.step).toBeGreaterThan(0);
    });

    it('control: with regular frames the same slow sample is a slow compositor and gets a skip', () => {
        const g = new LatencyGuard();
        g.active = true;
        const t = feed(g, 0, 120, 1);
        expect(g.overloaded(t)).toBe(false);
        expect(g.onSample(t, 3 * P)?.kind).toBe('skip');
    });
});
