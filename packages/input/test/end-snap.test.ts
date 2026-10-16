// Stick ends near the device's full scale are the full scale (v0.8 lane B, the owner's item 7: "the
// sticks feel more sensitive"). The wizard sets a stick's ends to the farthest it saw; a stick seldom
// pushed quite to its end got a short range and read every move larger. TUNING.END_SNAP: an end seen
// at 85 % or more of the device's own scale (+-1) is +-1. Controls: a radio whose sticks stop at 80 %
// (reduced weights) keeps its ends as seen, and the throttle is never snapped (its bottom must read
// 0 % for the arm gate).
import { describe, expect, it } from 'vitest';
import { CalibrationWizard, TUNING, mapFrame } from '../src/calib';
import type { Profile, RawFrame } from '../src/calib';
import { idealHuman, newWizardAdapter, runHuman } from '../src/sim/human';
import { invSet } from './helpers';

/** The ideal person on a radio whose channels reach only `limit` of their scale; the profile the wizard built. */
function profileFor(limit: number): Profile {
    const cfg = { ...idealHuman('AETR', invSet(0)), rangeLimit: limit };
    let w: CalibrationWizard | null = null;
    const o = runHuman(() => (w = new CalibrationWizard('k', 'n')), newWizardAdapter(), cfg, 180000);
    expect(o.kind, o.problems.join('; ')).toBe('correct');
    return (w as unknown as CalibrationWizard).state.profile!;
}

const read = (p: Profile, ch: number, v: number): number => {
    const ax = new Float32Array(8);
    ax[2] = -1;
    ax[ch] = v;
    return mapFrame(p, { t: 0, axes: ax, buttons: 0 } as RawFrame, new Float32Array(8))[ch === 2 ? 2 : ch === 3 ? 3 : ch];
};

describe('the wizard takes the full scale for stick ends seen near it', () => {
    it('sticks that reached 88 % read their scale: half a stick reads half, not 57 %', () => {
        expect(TUNING.END_SNAP).toBe(0.85);
        const p = profileFor(0.88);
        for (const fn of ['roll', 'pitch', 'yaw'] as const) {
            expect(p.axes[fn].max, fn).toBe(1);
            expect(p.axes[fn].min, fn).toBe(-1);
        }
        expect(read(p, 0, 0.44)).toBeCloseTo(0.44, 2); // half of the stick's 88 % travel on the device's scale
    });

    it('control: a radio whose sticks stop at 80 % (reduced weights) keeps them: full stick still reads full', () => {
        const p = profileFor(0.8);
        expect(p.axes.roll.max).toBeLessThan(0.85);
        expect(read(p, 0, 0.8)).toBeGreaterThan(0.99);
    });

    it('control: the throttle is never snapped: at the bottom of an 88 % throttle it reads 0 %, at its top 100 %', () => {
        const p = profileFor(0.88);
        expect(p.axes.throttle.min).toBeGreaterThan(-0.9);
        expect((read(p, 2, -0.88) + 1) / 2).toBeLessThan(0.01);
        expect((read(p, 2, 0.88) + 1) / 2).toBeGreaterThan(0.99);
    });
});
