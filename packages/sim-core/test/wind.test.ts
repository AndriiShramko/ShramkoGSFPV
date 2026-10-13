// The wind of the place (v0.7 lane E, wind.ts and its use in sim.ts): the frames, the gradient, the
// gust noise, and the flight model's response, each with a control that fails when the feature is
// broken (docs/wip/v07-e.md section 7).

import { describe, expect, it } from 'vitest';
import {
    GUST_OCTAVES, MODE_CHANNEL, S, Sha256, Sim, WIND_MAX_HEIGHT_M, WIND_MIN_HEIGHT_M, bearingToScene, compileParams, compileWind,
    gustNoise, hoverSolve, windProblem, windProfile
} from '../src/index';
import type { ParamOverrides, WindConfig } from '../src/index';
import { PRESET } from './log-kit';

const WIND: WindConfig = { fromDeg: 0, speed: 5, gust: 0, compassDeg: 0, seed: 1, groundM: 0 };

/** An armed craft in angle mode at hover throttle, sticks centred, no walls: `ticks` steps; the trace hash and the end state. */
function hover(o: ParamOverrides, ticks: number, at: [number, number, number] = [0, 2, 0], frame?: (sim: Sim) => void): { hash: string; sim: Sim } {
    const p = compileParams(PRESET, o);
    const sim = new Sim(p, null);
    sim.reset(at[0], at[1], at[2], 0);
    frame?.(sim);
    const stick = hoverSolve(p, 1).stick;
    const ch = [0, 0, -1, 0, -1, MODE_CHANNEL.angle, 0, 0];
    sim.setChannels(ch);
    sim.step();
    ch[4] = 1;
    sim.setChannels(ch);
    sim.step();
    expect(sim.armed).toBe(true);
    ch[2] = stick * 2 - 1;
    sim.setChannels(ch);
    const h = new Sha256();
    const bytes = new Uint8Array(sim.s.buffer);
    for (let i = 0; i < ticks; i++) {
        sim.step();
        h.update(bytes);
    }
    return { hash: h.digestHex(), sim };
}

const horiz = (sim: Sim): [number, number] => [sim.s[S.vx], sim.s[S.vz]];

describe('frames: compass bearings into the scene frame (heading 0 = -z, right turn +)', () => {
    it('north is -z with compass 0, +x with the scene facing west (compass 270), and a north wind blows to +z', () => {
        const [nx, nz] = bearingToScene(0, 0);
        expect(nx).toBeCloseTo(0, 12);
        expect(nz).toBeCloseTo(-1, 12);
        // the scene's forward axis points west: north is a right turn of 90 deg from it, i.e. +x
        const [wx, wz] = bearingToScene(0, 270);
        expect(wx).toBeCloseTo(1, 12);
        expect(wz).toBeCloseTo(0, 12);
        const f = compileWind(WIND)!;
        expect(f.dx).toBeCloseTo(0, 12);
        expect(f.dz).toBeCloseTo(1, 12);
        // looking downwind (south, +z) the right hand points west (-x)
        expect(f.cx).toBeCloseTo(-1, 12);
    });

    it('control: adding the compass instead of subtracting it puts north elsewhere', () => {
        const psi = ((0 + 90) * Math.PI) / 180;
        const [x] = bearingToScene(0, 90);
        expect(Math.abs(x - Math.sin(psi))).toBeGreaterThan(1.5);
    });
});

describe('the wind gradient', () => {
    it('is 1 at 10 m, a 1/8 power law between the clamps, flat outside them', () => {
        expect(windProfile(10)).toBe(1);
        for (const h of [0.5, 1, 3, 25, 120, 200]) expect(windProfile(h)).toBeCloseTo(Math.pow(h / 10, 1 / 8), 12);
        expect(windProfile(-5)).toBe(windProfile(WIND_MIN_HEIGHT_M));
        expect(windProfile(5000)).toBe(windProfile(WIND_MAX_HEIGHT_M));
        expect(windProfile(WIND_MIN_HEIGHT_M)).toBeCloseTo(0.6877, 4);
        expect(windProfile(WIND_MAX_HEIGHT_M)).toBeCloseTo(1.4542, 4);
    });
});

describe('gust noise', () => {
    it('is a pure function of (seed, axis, tick): the same values in any order; in [-1, 1], smooth, about zero on average', () => {
        const ticks = Array.from({ length: 4000 }, (_, i) => i * 37);
        const fwd = ticks.map((t) => gustNoise(9, 0, t));
        const back = [...ticks].reverse().map((t) => gustNoise(9, 0, t)).reverse();
        expect(back).toEqual(fwd);
        let sum = 0, maxStep = 0, prev = gustNoise(9, 1, 0), lo = 1, hi = -1;
        for (let t = 1; t <= 600_000; t++) {
            const n = gustNoise(9, 1, t);
            sum += n;
            maxStep = Math.max(maxStep, Math.abs(n - prev));
            lo = Math.min(lo, n);
            hi = Math.max(hi, n);
            prev = n;
        }
        expect(lo).toBeGreaterThanOrEqual(-1);
        expect(hi).toBeLessThanOrEqual(1);
        expect(hi - lo).toBeGreaterThan(0.8); // it does gust
        expect(maxStep).toBeLessThan(0.01); // no jumps from one millisecond to the next
        expect(Math.abs(sum / 600_000)).toBeLessThan(0.15);
    }, 60000);

    it('control: another seed or another axis gives other gusts', () => {
        const a = Array.from({ length: 50 }, (_, i) => gustNoise(9, 0, i * GUST_OCTAVES[0].ticks + 123));
        const b = Array.from({ length: 50 }, (_, i) => gustNoise(10, 0, i * GUST_OCTAVES[0].ticks + 123));
        const c = Array.from({ length: 50 }, (_, i) => gustNoise(9, 2, i * GUST_OCTAVES[0].ticks + 123));
        expect(b).not.toEqual(a);
        expect(c).not.toEqual(a);
    });
});

describe('validation', () => {
    it('a sound config passes; out-of-range numbers and a fractional seed are refused by name', () => {
        expect(windProblem(WIND)).toBeNull();
        expect(windProblem({ ...WIND, speed: 31 })).toMatch(/wind\.speed/);
        expect(windProblem({ ...WIND, fromDeg: -1 })).toMatch(/wind\.fromDeg/);
        expect(windProblem({ ...WIND, seed: 1.5 })).toMatch(/wind\.seed/);
        expect(windProblem({ ...WIND, groundM: Number.NaN })).toMatch(/wind\.groundM/);
        expect(() => compileParams(PRESET, { wind: { ...WIND, gust: 99 } })).toThrow(RangeError);
    });
});

describe('the flight model in wind (drag on the airspeed)', () => {
    it('no wind field and a still-air field (speed 0, gust 0) fly bit for bit the same: the model without wind is untouched', () => {
        const none = hover({}, 3000);
        const still = hover({ wind: { ...WIND, speed: 0, gust: 0 } }, 3000);
        expect(still.hash).toBe(none.hash);
        expect(compileParams(PRESET, { wind: { ...WIND, speed: 0, gust: 0 } }).wind).toBeNull();
    });

    it('a level craft drifts with the air: after 12 s its horizontal velocity is the wind; control: no wind, no drift', () => {
        const calm = hover({}, 12000);
        // from the west: blows to +x (east, compass 0); the ground 10 m below the start
        const windy = hover({ wind: { ...WIND, fromDeg: 270, groundM: -10 } }, 12000);
        const [cx, cz] = horiz(calm.sim);
        expect(Math.hypot(cx, cz)).toBeLessThan(0.05);
        const w = windy.sim.windNow;
        const [vx, vz] = horiz(windy.sim);
        expect(w[0]).toBeGreaterThan(4); // 5 m/s at 10 m is ~4.8 m/s at 8-12 m above the ground
        expect(Math.abs(w[2])).toBeLessThan(1e-9);
        expect(Math.abs(vx - w[0])).toBeLessThan(0.15 * w[0]);
        expect(Math.abs(vz)).toBeLessThan(0.15 * w[0]);
        expect(windy.hash).not.toBe(calm.hash);
    });

    it('higher above the ground the wind is stronger: the same flight with the ground 40 m lower drifts faster by the gradient', () => {
        const low = hover({ wind: { ...WIND, fromDeg: 270 } }, 12000);
        const high = hover({ wind: { ...WIND, fromDeg: 270, groundM: -40 } }, 12000);
        const hLow = low.sim.s[S.py] - 0, hHigh = high.sim.s[S.py] + 40;
        const ratio = high.sim.windNow[0] / low.sim.windNow[0];
        expect(ratio).toBeCloseTo(windProfile(hHigh) / windProfile(hLow), 2);
        expect(high.sim.s[S.vx]).toBeGreaterThan(low.sim.s[S.vx] * 1.1);
    });

    it('the ground follows the scene transform (setSceneFrame): s = 2, ty = -10 puts groundM 5 at 0 m', () => {
        const a = hover({ wind: { ...WIND, groundM: 5 } }, 2000, [0, 2, 0], (sim) => sim.setSceneFrame(2, -10));
        expect(a.sim.windGroundY).toBe(0);
        const b = hover({ wind: { ...WIND, groundM: 0 } }, 2000);
        expect(a.hash).toBe(b.hash); // both measure from a ground at y = 0
        // control: the same scene frame ignored (identity) measures from y = 5
        const c = hover({ wind: { ...WIND, groundM: 5 } }, 2000);
        expect(c.hash).not.toBe(a.hash);
    });

    it('gusts: the same seed gives the same trajectory; control: another seed gives another', () => {
        const g = { ...WIND, gust: 3, seed: 77 };
        const a = hover({ wind: g }, 6000);
        const b = hover({ wind: g }, 6000);
        const c = hover({ wind: { ...g, seed: 78 } }, 6000);
        expect(b.hash).toBe(a.hash);
        expect(c.hash).not.toBe(a.hash);
    });

    it('adds no hashed state: the state layout is the one the A6 reference was recorded with', () => {
        expect(S.size).toBe(70);
        expect(new Sim(compileParams(PRESET, { wind: WIND }), null).s.length).toBe(70);
    });
});
