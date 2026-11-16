// Lane loadq2 (docs/wip/loadq.md, part loadq2): the frame rate keeper judges a frame against at least a 60 Hz period
// (R1), does not alternate (R2), and judges the frames after a rest or a gap as a whole window (review LR-3).
import { describe, expect, it } from 'vitest';
import { FrameGovernor } from '../src/governor';

type Frame = { dt: number; held?: boolean };

/** Feed frames from `t` for `ms` (dt from `next`); returns the end time and the step changes. */
function run(g: FrameGovernor, t: number, ms: number, next: (i: number) => Frame, changes: { t: number; step: number }[] = []) {
    const end = t + ms;
    for (let i = 0; t < end; i++) {
        const f = next(i);
        t += f.dt;
        if (g.onFrame(t, false, f.held === true)) changes.push({ t, step: g.step });
    }
    return { t, changes };
}

describe('R1: frames at 60 a second or faster never lower the detail', () => {
    it('a free frame rate (learned period 2.5 ms) with every eighth frame at 17.8 ms keeps the top step', () => {
        const g = new FrameGovernor();
        const r = run(g, 0, 20000, (i) => ({ dt: i % 8 === 7 ? 17.8 : 2.5 }));
        expect(g.judgedPeriodMs).toBeCloseTo(1000 / 60, 3);
        expect(r.changes).toEqual([]);
        expect(g.step).toBe(0);
    });
    it('a 144 Hz screen at 72 pictures a second (every other frame held) keeps the top step', () => {
        const g = new FrameGovernor();
        const r = run(g, 0, 20000, (i) => ({ dt: 6.94, held: i > 200 && i % 2 === 1 }));
        expect(r.changes).toEqual([]);
    });
    it('still lowers the detail when frames come slower than 60 a second (40 ms on a 144 Hz screen)', () => {
        const g = new FrameGovernor();
        const a = run(g, 0, 4000, () => ({ dt: 6.94 }));
        const b = run(g, a.t, 3000, (i) => ({ dt: i % 3 === 0 ? 40 : 6.94 }));
        expect(b.changes.length).toBeGreaterThan(0);
        expect(g.step).toBeGreaterThan(0);
    });
});

describe('R2: the keeper does not alternate', () => {
    it('a step up followed by a step down within 10 s doubles the wait before the next step up, up to 2 minutes', () => {
        const g = new FrameGovernor();
        let t = run(g, 0, 4000, () => ({ dt: 33.3 })).t; // 30 Hz learned
        const waits: number[] = [];
        for (let k = 0; k < 7; k++) {
            // overload until a step down
            const ch: { t: number; step: number }[] = [];
            for (let i = 0; ch.length === 0 && i < 10000; i++) t = run(g, t, 50, () => ({ dt: 50 }), ch).t;
            const downAt = ch[0].t;
            // calm until a step up
            const up: { t: number; step: number }[] = [];
            for (let i = 0; up.length === 0 && i < 100000; i++) t = run(g, t, 100, () => ({ dt: 33.3 }), up).t;
            waits.push(Math.round((up[0].t - downAt) / 1000));
        }
        expect(waits).toEqual([5, 10, 20, 40, 80, 120, 120]);
    });
    it('the wait goes back to its start after a step up that held for a minute', () => {
        const g = new FrameGovernor();
        let t = run(g, 0, 4000, () => ({ dt: 33.3 })).t;
        for (let k = 0; k < 3; k++) {
            const ch: { t: number; step: number }[] = [];
            for (let i = 0; ch.length === 0; i++) t = run(g, t, 50, () => ({ dt: 50 }), ch).t;
            const up: { t: number; step: number }[] = [];
            for (let i = 0; up.length === 0; i++) t = run(g, t, 100, () => ({ dt: 33.3 }), up).t;
        }
        expect(g.upWaitMs).toBe(20000);
        t = run(g, t, 61000, () => ({ dt: 33.3 })).t;
        expect(g.upWaitMs).toBe(5000);
    });
});

describe('LR-3: the frames after a rest or a gap are judged as a whole window', () => {
    it('one late frame right after a gap of 3 s does not step down', () => {
        const g = new FrameGovernor();
        const a = run(g, 0, 5000, () => ({ dt: 16.7 }));
        const b = run(g, a.t + 3000, 900, (i) => ({ dt: i === 1 ? 40 : 16.7 }));
        expect(b.changes).toEqual([]);
    });
    it('after rest() a step down needs a whole second of judged frames, and comes when they stay late', () => {
        const g = new FrameGovernor();
        let t = run(g, 0, 5000, () => ({ dt: 16.7 })).t;
        for (let i = 0; i < 30; i++) { t += 33; g.rest(t); }
        const early = run(g, t, 900, () => ({ dt: 40 }));
        expect(early.changes).toEqual([]);
        const later = run(g, early.t, 600, () => ({ dt: 40 }));
        expect(later.changes.length).toBe(1);
    });
    it('calm(): not before the frames are judged, yes after a calm second, no while frames are missed', () => {
        const g = new FrameGovernor();
        let t = run(g, 0, 500, () => ({ dt: 16.7 })).t;
        expect(g.calm(t)).toBe(false);
        t = run(g, t, 3000, () => ({ dt: 16.7 })).t;
        expect(g.calm(t)).toBe(true);
        t = run(g, t, 300, () => ({ dt: 40 })).t;
        expect(g.calm(t)).toBe(false);
    });
});
