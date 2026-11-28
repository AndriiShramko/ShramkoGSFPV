// Prop wash sized by the sources on every craft (train 5 lane w3-model, docs/wip/w3-model.md "## Design";
// sim-core wake.ts). For a 65 mm whoop, the default 2-inch ducted craft and a 5-inch quad: the mean loss at the
// peak ratio lies in the measured range (Veismann 2022: 6 to 35 %, base blade 20 %) and is zero outside the
// band; each rotor's thrust fluctuates on its own (independent streams that repeat exactly); the multiplier 0
// is the model without the term. Every check has a control that must fail the same predicate.

import { describe, expect, it } from 'vitest';
import {
    S, Sim, WAKE_DUCT_SHIFT, WAKE_HI, WAKE_LO, WAKE_LOSS_PEAK, WAKE_PEAK, WAKE_SHAKE_PEAK, compileParams,
    inducedVelocity, wakeBump, wakeIntensity, wakeRotorNoise
} from '../src/index';
import type { ParamOverrides, SimParams } from '../src/index';
import { PRESET_IDS, hovering, preset } from './model-helpers';

const WHOOP = 'air65-1s', DEFAULT = 'pavo20pro-3s', FIVE = 'nazgulf5v3-6s';
const p = (id: string, o: ParamOverrides = {}): SimParams => compileParams(preset(id), o);
/** hover induced velocity of the craft: its mass, rotor disks and count */
const vh = (sp: SimParams): number => inducedVelocity(sp.mass * 9.81, sp.rho, sp.wakeArea);
/** the measured range of the mean loss at the peak (Veismann, Yos, Gharib 2022, by blade shape) */
const MEASURED: [number, number] = [0.06, 0.35];

/**
 * Hover, then hold an axial descent at `ratio` x v_h for `ms` ticks (the vertical speed is set before every
 * step, so the craft stays at that point of the band). Returns every rotor's thrust factor of every tick:
 * the thrust the step made over the clean-air thrust of the same motor state.
 */
function heldDescent(sp: SimParams, ratio: number, ms = 2000): number[][] {
    const { sim } = hovering(sp, 'angle');
    const th = (sim as unknown as { thrust: Float64Array }).thrust;
    const v = ratio * vh(sp);
    const out: number[][] = [];
    for (let i = 0; i < ms; i++) {
        sim.s[S.vx] = 0; sim.s[S.vy] = -v; sim.s[S.vz] = 0;
        const vr = sim.s[S.volt] / sp.vNom;
        const tmax = sp.tmaxMotorNom * vr * vr;
        sim.step();
        const f: number[] = [];
        for (let r = 0; r < 4; r++) f.push(th[r] / (tmax * sim.s[S.m0 + r] * sim.s[S.m0 + r]));
        out.push(f);
    }
    return out;
}
const meanLoss = (fs: number[][]): number => 1 - fs.reduce((a, f) => a + f[0] + f[1] + f[2] + f[3], 0) / (4 * fs.length);

describe('prop wash: on every craft, from its own data', () => {
    it('every preset carries the term at the default multiplier; v_h follows mass, rotor size and count', () => {
        for (const id of PRESET_IDS) {
            const c = p(id);
            expect(c.wakeLoss, id).toBe(WAKE_LOSS_PEAK);
            expect(c.wakeShake, id).toBe(WAKE_SHAKE_PEAK);
            expect(c.wakeArea, id).toBeGreaterThan(0);
        }
        // the research note's table: Air65 5.68 m/s, Pavo20 Pro 7.85 m/s, a 5-inch 7.0 (650 g) to 7.5 (736 g) m/s
        expect(vh(p(WHOOP))).toBeGreaterThan(5.4);
        expect(vh(p(WHOOP))).toBeLessThan(6.0);
        expect(vh(p(DEFAULT))).toBeGreaterThan(7.5);
        expect(vh(p(DEFAULT))).toBeLessThan(8.2);
        expect(vh(p(FIVE))).toBeGreaterThan(6.8);
        expect(vh(p(FIVE))).toBeLessThan(7.8);
        // ducts move the band, open props do not
        expect([p(WHOOP).wakeShift, p(DEFAULT).wakeShift, p(FIVE).wakeShift]).toEqual([WAKE_DUCT_SHIFT, WAKE_DUCT_SHIFT, 0]);
    });

    it('the band: 0 below WAKE_LO and above WAKE_HI, 1 at WAKE_PEAK, smooth in between', () => {
        expect(wakeBump(WAKE_PEAK)).toBe(1);
        for (const x of [0, 0.2, WAKE_LO, WAKE_HI, 2, 5]) expect(wakeBump(x), String(x)).toBe(0);
        expect(wakeBump(1)).toBeGreaterThan(0.5);
        expect(wakeBump(1.5)).toBeGreaterThan(0.3);
        // the sideways fade: at mu = 1 a fifth
        expect(wakeIntensity(WAKE_PEAK * 6, 6, 6)).toBeCloseTo(0.2, 12);
        // control: a ducted craft at the open rotor's peak is not at its own peak
        expect(wakeIntensity(WAKE_PEAK * 6, 0, 6, WAKE_DUCT_SHIFT)).toBeLessThan(1);
    });

    it('in a held descent at the peak ratio the mean loss is in the measured range on a whoop, the default craft and a 5-inch; zero outside the band', () => {
        for (const id of [WHOOP, DEFAULT, FIVE]) {
            const sp = p(id);
            const peak = WAKE_PEAK + sp.wakeShift;
            const at = meanLoss(heldDescent(sp, peak));
            expect(at, `${id} loss at the peak ${at}`).toBeGreaterThan(MEASURED[0]);
            expect(at, id).toBeLessThan(MEASURED[1]);
            expect(Math.abs(at - WAKE_LOSS_PEAK), `${id} ${at}`).toBeLessThan(0.02);
            for (const x of [0.2, WAKE_LO + sp.wakeShift - 0.05, WAKE_HI + sp.wakeShift + 0.05, 2.5]) {
                const fs = heldDescent(sp, x, 300);
                expect(fs.every((f) => f.every((v) => Math.abs(v - 1) < 1e-12)), `${id} at ${x} v_h`).toBe(true);
            }
        }
        // control: with the multiplier 0 the same descent at the peak loses nothing
        expect(Math.abs(meanLoss(heldDescent(p(DEFAULT, { wake: 0 }), WAKE_PEAK + WAKE_DUCT_SHIFT, 300)))).toBeLessThan(1e-12);
    });

    it('in the band each rotor fluctuates on its own, by the measured SD', () => {
        const sp = p(DEFAULT);
        const fs = heldDescent(sp, WAKE_PEAK + sp.wakeShift, 4000);
        const keep = 1 - WAKE_LOSS_PEAK;
        // SD of each rotor's thrust over its mean: WAKE_SHAKE_PEAK (Veismann 2022 0.09 to 0.12, NASA 2021 0.1)
        for (let r = 0; r < 4; r++) {
            const xs = fs.map((f) => f[r] / keep - 1);
            const m = xs.reduce((a, b) => a + b, 0) / xs.length;
            const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) * (b - m), 0) / xs.length);
            expect(sd, `rotor ${r}`).toBeGreaterThan(0.06);
            expect(sd, `rotor ${r}`).toBeLessThan(0.14);
        }
        // the rotors differ from each other at almost every tick (the old model scaled all four alike)
        const differ = fs.filter((f) => Math.max(...f) - Math.min(...f) > 1e-3).length;
        expect(differ / fs.length).toBeGreaterThan(0.95);
    });

    it('the per-rotor noise: zero mean, SD 1, the four streams independent, and it repeats exactly', () => {
        const N = 200000;
        const xs: number[][] = [[], [], [], []];
        for (let t = 0; t < N; t++) for (let r = 0; r < 4; r++) xs[r].push(wakeRotorNoise(r, t));
        const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
        const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(mean(a.map((v) => (v - m) * (v - m)))); };
        const corr = (a: number[], b: number[]) => { const ma = mean(a), mb = mean(b); let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - ma) * (b[i] - mb); return s / a.length / (sd(a) * sd(b)); };
        for (let r = 0; r < 4; r++) {
            expect(Math.abs(mean(xs[r])), `mean ${r}`).toBeLessThan(0.05);
            expect(Math.abs(sd(xs[r]) - 1), `sd ${r}`).toBeLessThan(0.05);
            for (let q = r + 1; q < 4; q++) expect(Math.abs(corr(xs[r], xs[q])), `corr ${r}-${q}`).toBeLessThan(0.05);
        }
        // control: a stream with itself one tick later is strongly correlated (it is band-limited, not white)
        expect(corr(xs[0].slice(1), xs[0].slice(0, -1))).toBeGreaterThan(0.5);
        // repeats exactly for the seed
        for (const t of [0, 1, 999, 123456]) for (let r = 0; r < 4; r++) expect(wakeRotorNoise(r, t)).toBe(xs[r][t]);
        // and a flight through the wash repeats bit for bit
        const a = heldDescent(p(WHOOP), 1.4, 500), b = heldDescent(p(WHOOP), 1.4, 500);
        expect(b).toEqual(a);
    });

    it('the multiplier: 0 off, 1 the sources\' size, 2 twice (loss capped at WAKE_LOSS_MAX)', () => {
        for (const id of PRESET_IDS) {
            const off = p(id, { wake: 0 });
            expect([off.wakeLoss, off.wakeShake, off.wakeArea, off.wakeShift], id).toEqual([0, 0, 0, 0]);
            expect(p(id, { wake: 2 }).wakeLoss, id).toBeCloseTo(2 * WAKE_LOSS_PEAK, 12);
        }
        // 0 is the model without the term: a drop and a catch through the wake is the same flight as no sinking at all would give
        const drop = (sp: SimParams): Float64Array => {
            const { sim, ch } = hovering(sp, 'angle');
            ch[2] = -1; sim.setChannels(ch);
            for (let i = 0; i < 800; i++) sim.step();
            ch[2] = 0.2; sim.setChannels(ch);
            for (let i = 0; i < 1500; i++) sim.step();
            return sim.s.slice();
        };
        const zero = drop(p(DEFAULT, { wake: 0 }));
        expect(drop(p(DEFAULT, { wake: 0 }))).toEqual(zero);
        // control: the default multiplier changes that flight
        expect(drop(p(DEFAULT))).not.toEqual(zero);
    });

    it('a preset must give its rotor and its duct; the v0.8 per-preset wake_loss / wake_shake are refused', () => {
        const pj = preset(FIVE);
        const { prop_diameter_mm: _d, ...noDisk } = pj.fields; void _d;
        expect(() => compileParams({ ...pj, fields: noDisk })).toThrow(/prop_diameter_mm/);
        const { ducted: _u, ...noDuct } = pj.fields; void _u;
        expect(() => compileParams({ ...pj, fields: noDuct })).toThrow(/ducted/);
        expect(() => compileParams({ ...pj, fields: { ...pj.fields, wake_loss: { value: 0.25, source: 'estimate' } } })).toThrow(/wake_loss/);
        expect(() => p(FIVE, { wake: -1 })).toThrow(RangeError);
        // control: the preset as shipped compiles, and a sourced wake_scale multiplies
        expect(compileParams({ ...pj, fields: { ...pj.fields, wake_scale: { value: 0.5, source: 'measured:test' } } }).wakeLoss).toBeCloseTo(0.5 * WAKE_LOSS_PEAK, 12);
    });
});
