// Lane center-throttle (docs/wip/center-throttle.md): where a throttle rests decides the throttle style, the pilot's
// choice wins, and the wizard keeps the rest it measured. Negative controls: a moving stick and a silent controller
// decide nothing; the same wizard run with the throttle held down measures 'bottom', not 'centre'.
import { afterEach, describe, expect, it } from 'vitest';
import { RestWatch, TUNING, classifyThrottleRest, profileStyle, readThrottleRest, readThrottleStyle, resolveStyle, restStyle, springsOf } from '../src';
import type { Profile } from '../src';
import { idealHuman } from '../src/sim/human';
import { invSet, Rig } from './helpers';
import { mulberry32 } from '../src/sim/signals';

/** The DJI FPV Remote Controller 3's rest offsets, measured (known-devices.ts deadbandFact; evidence/2026-10-15/dji-rc3/): units of 660. */
const DJI_REST = [-11 / 660, -8 / 660, 0];

/** Feed a watch `ms` of samples at 125 Hz (8 ms, a radio's report rate) from `f(t)`, starting at `t0`; the last answer. */
function feed(w: RestWatch, f: (t: number) => number, ms: number, t0 = 0): ReturnType<RestWatch['update']> {
    let r = w.rest;
    for (let t = t0; t <= t0 + ms; t += 8) r = w.update(f(t), t);
    return r;
}

describe('classifyThrottleRest: the wizard\'s own thresholds', () => {
    it('the DJI\'s measured rest offsets are the centre; the bottom is the bottom; 30 % up is parked; the top end is not the bottom', () => {
        for (const v of DJI_REST) expect(classifyThrottleRest(v), String(v)).toBe('centre');
        expect(classifyThrottleRest(-1)).toBe('bottom');
        expect(classifyThrottleRest(-(1 - TUNING.END_TOL))).toBe('bottom');
        expect(classifyThrottleRest(-0.4)).toBe('parked'); // 30 % of the travel
        expect(classifyThrottleRest(1)).toBe('parked');
        expect(classifyThrottleRest(TUNING.CENTRE_TOL)).toBe('centre');
        expect(classifyThrottleRest(TUNING.CENTRE_TOL + 0.01)).toBe('parked');
        expect(classifyThrottleRest(Number.NaN)).toBeNull();
    });
    it('a rest in the centre flies centred; the bottom and a parked stick fly from zero', () => {
        expect(restStyle('centre')).toBe('centred');
        expect(restStyle('bottom')).toBe('zero');
        expect(restStyle('parked')).toBe('zero');
    });
});

describe('RestWatch: the first still half second of this connection', () => {
    it('rest in the centre (the DJI as shipped): centre after STILL_MS, not before', () => {
        for (const v of DJI_REST) {
            const w = new RestWatch();
            expect(feed(w, () => v, TUNING.STILL_MS - 8)).toBeNull();
            expect(feed(w, () => v, 16, TUNING.STILL_MS)).toBe('centre');
        }
    });
    it('rest at the bottom (the screws tightened for manual flying): bottom', () => {
        expect(feed(new RestWatch(), () => -1, 600)).toBe('bottom');
        expect(feed(new RestWatch(), () => -660 / 660 + 0.004, 600)).toBe('bottom');
    });
    it('a noisy stick (jitter of +-0.015, more than the DJI\'s few units) still decides', () => {
        const rnd = mulberry32(7);
        expect(feed(new RestWatch(), () => (rnd() - 0.5) * 0.03, 600)).toBe('centre');
        const rnd2 = mulberry32(8);
        expect(feed(new RestWatch(), () => -1 + rnd2() * 0.03, 600)).toBe('bottom');
    });
    it('negative control: a stick being moved decides nothing (a slow sweep and a stir)', () => {
        expect(feed(new RestWatch(), (t) => Math.sin(t / 300), 5000)).toBeNull();
        expect(feed(new RestWatch(), (t) => ((t / 8) % 2 === 0 ? 0.5 : -0.5), 5000)).toBeNull();
    });
    it('negative control: a controller that reports nothing yet (no sample, NaN samples) decides nothing', () => {
        const w = new RestWatch();
        expect(w.rest).toBeNull();
        expect(feed(w, () => Number.NaN, 2000)).toBeNull();
    });
    it('a stick moved, then let go in the centre: decided by the let-go window; then it stays until reset (no change in flight)', () => {
        const w = new RestWatch();
        expect(feed(w, (t) => Math.sin(t / 50), 1000)).toBeNull();
        expect(feed(w, () => 0.01, 600, 1008)).toBe('centre');
        expect(feed(w, () => -1, 2000, 1700)).toBe('centre');
        w.reset();
        expect(feed(w, () => -1, 600, 4000)).toBe('bottom');
    });
});

describe('resolveStyle: the pilot\'s choice wins, then what is measured, then the table', () => {
    it('order: choice > seen now > wizard > table > from zero', () => {
        expect(resolveStyle({})).toEqual({ style: 'zero', why: 'default' });
        expect(resolveStyle({ springs: true })).toEqual({ style: 'centred', why: 'table' });
        expect(resolveStyle({ springs: true, wizard: 'bottom' })).toEqual({ style: 'zero', why: 'wizard' });
        expect(resolveStyle({ springs: true, wizard: 'bottom', seen: 'centre' })).toEqual({ style: 'centred', why: 'seen' });
        expect(resolveStyle({ springs: true, seen: 'bottom' })).toEqual({ style: 'zero', why: 'seen' });
        expect(resolveStyle({ springs: false, seen: 'centre', choice: 'zero' })).toEqual({ style: 'zero', why: 'choice' });
        expect(resolveStyle({ springs: true, seen: 'bottom', choice: 'centred' })).toEqual({ style: 'centred', why: 'choice' });
    });
    it('the DJI FPV Remote Controller starts centred; a TX16S (no known entry) starts from zero', () => {
        const dji = { known: 'dji-virtual-joystick' } as Profile;
        expect(springsOf(dji)).toBe(true);
        expect(profileStyle(dji, null)).toEqual({ style: 'centred', why: 'table' });
        expect(profileStyle(dji, 'bottom')).toEqual({ style: 'zero', why: 'seen' });
        expect(profileStyle({ ...dji, throttleStyle: 'zero' }, 'centre')).toEqual({ style: 'zero', why: 'choice' });
        const tx = {} as Profile;
        expect(springsOf(tx)).toBe(false);
        expect(profileStyle(tx, null)).toEqual({ style: 'zero', why: 'default' });
        expect(profileStyle(tx, 'centre').style).toBe('centred');
    });
    it('saved values: only the known words are read', () => {
        expect(readThrottleStyle('centred')).toBe('centred');
        expect(readThrottleStyle('auto')).toBeUndefined();
        expect(readThrottleStyle(1)).toBeUndefined();
        expect(readThrottleRest('bottom')).toBe('bottom');
        expect(readThrottleRest('middle')).toBeUndefined();
    });
});

describe('the wizard keeps where the throttle rested at its "Let go" step (Profile.throttleRest)', () => {
    const rigs: Rig[] = [];
    afterEach(() => { rigs.length = 0; });
    const run = (lower: boolean): Profile => {
        const rig = new Rig({ ...idealHuman('AETR', invSet(0)), lowerThrottleInCentre: lower });
        rigs.push(rig);
        expect(rig.until(() => rig.flew, 180000)).toBe(true);
        return rig.st.profile!;
    };
    it('throttle held down at the step (as the screen asks): bottom', () => {
        expect(run(true).throttleRest).toBe('bottom');
    });
    it('throttle left where the stir left it (a spring stick let go would be the centre): not bottom', () => {
        const p = run(false);
        expect(p.throttleRest).toBeDefined();
        expect(p.throttleRest).not.toBe('bottom');
    });
});
