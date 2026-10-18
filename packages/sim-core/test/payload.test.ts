// The cinelifter's camera load (ParamOverrides.payloadG; v0.9 lane D, docs/research/drone-models.md section 4).
// The motors do not change, so the thrust stays the preset's and the mass, thrust-to-weight, hover throttle, climb and
// inertia follow the load. Claims, each with a negative control that fails the same predicate:
//  - no override, and an override equal to the preset's own 2000 g, give the preset's numbers exactly (the default does
//    not move anything; the A6 hash of the default drone is pinned by tools/bench/test/a6-reference.test.ts);
//  - the thrust is the same whatever the load; the mass is the preset's plus the change; TWR x mass = the preset's thrust;
//  - hover throttle and inertia rise with the load, thrust-to-weight falls, and the climb after 8 s of full throttle
//    falls with it (control: the base params, with the override left out, show none of the changes);
//  - an empty frame (no camera) weighs the maker's take-off weight, 2872 g;
//  - a preset without a payload field ignores the override;
//  - a bad load is refused, and so is one that leaves no inertia.
import { describe, expect, it } from 'vitest';
import { MODE_CHANNEL, S, Sim, compileParams, hoverSolve, payloadChange } from '../src/index';
import type { SimParams } from '../src/index';
import { preset } from './model-helpers';

const CINE = 'taurusx8-komodo-6s';
const base = compileParams(preset(CINE));
const load = (g: number): SimParams => compileParams(preset(CINE), { payloadG: g });
const thrust = (sp: SimParams): number => 4 * sp.tmaxMotorNom;

function climb(sp: SimParams): number {
    const sim = new Sim(sp, null);
    sim.reset(0, 200, 0, 0);
    const ch = [0, 0, -1, 0, -1, MODE_CHANNEL.angle, 0, 0];
    sim.setChannels(ch); sim.step();
    ch[4] = 1; sim.setChannels(ch); sim.step();
    ch[2] = hoverSolve(sp, 1).stick * 2 - 1; sim.setChannels(ch);
    for (let i = 0; i < 1500; i++) sim.step();
    ch[2] = 1; sim.setChannels(ch);
    for (let i = 0; i < 8000; i++) sim.step();
    return sim.s[S.vy];
}

describe('camera load', () => {
    it('the preset\'s own load, given or not, changes nothing at all', () => {
        for (const sp of [load(2000), compileParams(preset(CINE), {})]) {
            expect(sp.mass).toBe(base.mass);
            expect(sp.twr).toBe(base.twr);
            expect(sp.tmaxMotorNom).toBe(base.tmaxMotorNom);
            expect(sp.inertia).toEqual(base.inertia);
            expect(sp.vNom).toBe(base.vNom);
        }
        expect(base.mass).toBeCloseTo(4.872, 9);
    });

    it('the thrust stays and the mass follows the load: TWR x mass is the preset\'s thrust', () => {
        for (const g of [0, 154, 1000, 2288, 3000]) {
            const sp = load(g);
            expect(thrust(sp)).toBe(thrust(base));
            expect(sp.mass).toBeCloseTo(4.872 - 2 + g / 1000, 9);
            expect(sp.twr * sp.mass).toBeCloseTo(base.twr * base.mass, 9);
        }
        // control: the predicate "the mass changed" fails on the base params
        expect(Math.abs(base.mass - 2.872)).toBeGreaterThan(1);
    });

    it('no camera is the maker\'s take-off weight (2872 g) and 5.6:1', () => {
        const none = load(0);
        expect(none.mass).toBeCloseTo(2.872, 9);
        expect(none.twr).toBeCloseTo((3.3 * 4.872) / 2.872, 9);
    });

    it('hover throttle, inertia and thrust-to-weight move the right way, monotonically', () => {
        const grams = [0, 154, 2000, 2288];
        const sps = grams.map(load);
        for (let i = 1; i < sps.length; i++) {
            expect(hoverSolve(sps[i], 1).stick).toBeGreaterThan(hoverSolve(sps[i - 1], 1).stick);
            expect(sps[i].inertia[0]).toBeGreaterThan(sps[i - 1].inertia[0]);
            expect(sps[i].inertia[1]).toBeGreaterThan(sps[i - 1].inertia[1]);
            expect(sps[i].twr).toBeLessThan(sps[i - 1].twr);
        }
        // roll and pitch stay one value (the model's symmetric inertia)
        for (const sp of sps) expect(sp.inertia[0]).toBe(sp.inertia[2]);
        // the lighter craft hovers lower: about 25 % without the camera against 41 % with it (research note section 5)
        expect(hoverSolve(sps[0], 1).stick).toBeLessThan(0.3);
        expect(hoverSolve(load(2000), 1).stick).toBeCloseTo(0.411, 2);
        // control: without the override, the predicate "hover differs from the 2000 g one" fails
        expect(Math.abs(hoverSolve(base, 1).stick - hoverSolve(load(2000), 1).stick)).toBeLessThan(1e-12);
    });

    it('it climbs faster without the camera and slower with the heavier one (8 s of full throttle)', () => {
        const none = climb(load(0)), def = climb(base), heavy = climb(load(2288));
        expect(none).toBeGreaterThan(def + 1); // drag-limited: the vertical drag area stands in for the props unloading, so the gain is small
        expect(heavy).toBeLessThan(def);
        expect(climb(load(2000))).toBe(def);
    });

    it('the inertia change is the point mass at the preset\'s arm', () => {
        const a = preset(CINE).fields.payload_arm_m.value as number[];
        const dm = -2;
        const want = (dm * ((a[1] ** 2 + a[2] ** 2) + (a[0] ** 2 + a[1] ** 2))) / 2;
        expect(load(0).inertia[0] - base.inertia[0]).toBeCloseTo(want, 12);
        expect(load(0).inertia[1] - base.inertia[1]).toBeCloseTo(dm * (a[0] ** 2 + a[2] ** 2), 12);
    });

    it('a preset without a payload field ignores the override', () => {
        const nazgul = preset('nazgulf5v3-6s');
        expect(compileParams(nazgul, { payloadG: 0 })).toEqual(compileParams(nazgul));
        expect(payloadChange(nazgul, 500)).toEqual({ dm: 0, dIpr: 0, dIy: 0 });
    });

    it('a bad load is refused', () => {
        for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) expect(() => load(bad)).toThrow(RangeError);
        // control: a good one is not
        expect(() => load(1500)).not.toThrow();
    });
});
