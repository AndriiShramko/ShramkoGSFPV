// R32 (weak-devices-plan.md 2.1): the governor starts at the step this device settled at on its last flight.
import { describe, expect, it } from 'vitest';
import * as gov from '../src/governor';

// the members are read through a loose view so that the old governor (without them) fails by an assertion
type Loose = Record<string, unknown>;
const G = gov as unknown as Loose;
const fn = (name: string) => (typeof G[name] === 'function' ? (G[name] as (...a: unknown[]) => unknown) : () => undefined);

/** feed `n` frames at period `p` ms from `t0`, every `missEvery`-th one late by a whole period; returns the last t */
function feed(g: gov.FrameGovernor, t0: number, n: number, p: number, missEvery = 0): number {
    let t = t0;
    for (let i = 0; i < n; i++) {
        t += missEvery && i % missEvery === 0 ? 2 * p : p;
        g.onFrame(t);
    }
    return t;
}

describe('governor start step (R32)', () => {
    it('startAt puts the governor on a lower step, clamped to the steps', () => {
        const g = new gov.FrameGovernor();
        const startAt = (g as unknown as Loose).startAt as ((s: number) => void) | undefined;
        startAt?.call(g, 3);
        expect(g.step).toBe(3);
        expect(g.current.splatBudgetMillions).toBe(2);
        startAt?.call(g, 99);
        expect(g.step).toBe(g.steps.length - 1);
        startAt?.call(g, -2);
        expect(g.step).toBe(0);
    });

    it('a started governor still climbs back after a calm window', () => {
        const g = new gov.FrameGovernor();
        ((g as unknown as Loose).startAt as ((s: number) => void) | undefined)?.call(g, 2);
        expect(g.step).toBe(2);
        // 60 frames to learn the 30 Hz period, then 6 s calm: one step up
        feed(g, 0, 60 + 180, 33.3);
        expect(g.step).toBe(1);
    });

    it('settledStep reports a step only after it held for the given time', () => {
        const g = new gov.FrameGovernor();
        const settled = (t: number, hold: number) => ((g as unknown as Loose).settledStep as ((t: number, h: number) => number | null) | undefined)?.call(g, t, hold);
        // before any frame is judged: nothing settled
        expect(settled(0, 1000)).toBeNull();
        // a device missing every second frame steps down
        let t = feed(g, 0, 60, 33.3);
        t = feed(g, t, 60, 33.3, 2);
        expect(g.step).toBeGreaterThan(0);
        const s = g.step;
        expect(settled(t, gov.GOVERNOR_SETTLE_MS ?? 10000)).toBeNull();
        // then holds on that step for 10 s with a frame missed now and then (too many to climb, too few to drop)
        g.enabled = false;
        expect(settled(t + 20000, 10000)).toBeNull();
        g.enabled = true;
        expect(settled(t + 20000, 10000)).toBe(s);
    });

    it('a step held while the scan streams is not settled; it settles after a hold without streaming (LP-1)', () => {
        const g = new gov.FrameGovernor();
        const settled = (t: number, hold: number) => ((g as unknown as Loose).settledStep as ((t: number, h: number) => number | null) | undefined)?.call(g, t, hold);
        // 60 frames to learn the 30 Hz period, then 12 s on time while the streamer reports progress every 10th frame
        let t = feed(g, 0, 60, 33.3);
        for (let i = 0; i < 360; i++) { t += 33.3; g.onFrame(t, false, false, i % 10 === 0); }
        expect(g.step).toBe(0);
        expect(settled(t, 10000)).toBeNull();
        // streaming stops: 10 s later the step counts as settled
        t = feed(g, t, 301, 33.3);
        expect(settled(t, 10000)).toBe(0);
    });

    it('a strong desktop never starts below the top step, the other classes may (LP-1)', () => {
        const may = fn('governorMayStartLower');
        expect(may('desktop-strong')).toBe(false);
        expect(may('desktop-weak')).toBe(true);
        expect(may('phone')).toBe(true);
    });

    it('the record is read back only for the same device and a step that exists', () => {
        const id = fn('governorDeviceId')('desktop-weak', 'intel xe-lp') as string;
        expect(id).toBe('desktop-weak|intel xe-lp');
        const rec = fn('governorStartRecord')(id, 3) as string;
        const read = fn('savedStartStep');
        expect(read(rec, id, 5)).toBe(3);
        expect(read(rec, 'desktop-strong|intel xe-lp', 5)).toBe(0);
        expect(read(rec, id, 3)).toBe(0);
        expect(read('{"v":2,"id":"desktop-weak|intel xe-lp","step":3}', id, 5)).toBe(0);
        expect(read('not json', id, 5)).toBe(0);
        expect(read(null, id, 5)).toBe(0);
        expect(gov.GOVERNOR_START_KEY).toBe('gsfpv.governor.start');
    });
});
