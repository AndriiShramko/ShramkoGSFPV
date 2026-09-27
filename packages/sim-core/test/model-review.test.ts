// Adversarial review of the W1-3 model (B.5, C.8, C.12 items 1-4, H.1): claims re-checked where
// the author's tests did not go, and the defects found, each with its negative control.

import { describe, expect, it } from 'vitest';
import { MODE_CHANNEL, Sha256, Sim, attitude, hoverSolve, invertThrottle, lifeSim, normalizeRespawnOpts, setpointRate } from '../src/index';
import type { FlightMode, SimParams } from '../src/index';
import { S, hovering, params, roll } from './model-helpers';

const PRESETS = ['pavo20pro-3s', 'pavo20pro2-3s', 'pavo20pro2-4s', 'pavopico-2s', 'meteor65pro-1s', 'air65-1s'];

/** Armed at (0, 100, 0) through a keepArmed reset with pack `soc`, holding throttle stick `stick` in angle mode for `ms`. */
function holdStick(p: SimParams, soc: number, stick: number, ms: number, sim = new Sim(p, null)): Sim {
    sim.setChannels([0, 0, -1, 0, 1, MODE_CHANNEL.angle, 0, 0]);
    sim.reset(0, 100, 0, 0, { keepArmed: true, soc });
    sim.setChannels([0, 0, stick * 2 - 1, 0, 1, MODE_CHANNEL.angle, 0, 0]);
    for (let i = 0; i < ms; i++) sim.step();
    return sim;
}

describe('auto-throttle: hoverSolve().stick (the director reads it for the wedged rule) and the Sim\'s own hover', () => {
    const cases: [number, number][] = [[1.62, 1], [1.62, 0.5], [1.62, 0.2], [9.81, 1], [9.81, 0.5], [9.81, 0.2]];

    it('the stick hoverSolve() returns holds altitude on the Moon and on Earth, with a full, half and low pack', () => {
        const bad: string[] = [];
        for (const [gravity, soc] of cases) {
            const p = params('pavo20pro-3s', { gravityMode: 'auto-throttle', gravity });
            const sim = holdStick(p, soc, hoverSolve(p, soc).stick, 3000);
            if (!(Math.abs(sim.s[S.vy]) < 0.5)) bad.push(`g ${gravity} soc ${soc}: vy ${sim.s[S.vy].toFixed(3)}`);
        }
        expect(bad).toEqual([]);
        expect(hoverSolve(params('pavo20pro-3s', { gravityMode: 'auto-throttle' }), 1).stick).toBe(0.5);
    });

    it('control: the curve-inverted stick (what hoverSolve returned before) sinks at more than 2 m/s in every case', () => {
        for (const [gravity, soc] of cases) {
            const p = params('pavo20pro-3s', { gravityMode: 'auto-throttle', gravity });
            const h = hoverSolve(p, soc);
            const sim = holdStick(p, soc, invertThrottle(h.throttle, p.throttle), 3000);
            expect(sim.s[S.vy], `g ${gravity} soc ${soc}`).toBeLessThan(-2);
        }
    });

    it('a Sim made without the page setting hoverThr flies auto-throttle exactly like lifeSim (the replay\'s Sim)', () => {
        const p = params('pavo20pro-3s', { gravityMode: 'auto-throttle', gravity: 1.62 });
        const trace = (sim: Sim): string => {
            const h = new Sha256();
            const bytes = new Uint8Array(sim.s.buffer, sim.s.byteOffset, sim.s.byteLength);
            sim.setChannels([0, 0, -1, 0, 1, MODE_CHANNEL.angle, 0, 0]);
            sim.reset(0, 100, 0, 0, { keepArmed: true });
            sim.setChannels([0.1, 0, 0, 0, 1, MODE_CHANNEL.angle, 0, 0]);
            for (let i = 0; i < 2000; i++) { sim.step(); h.update(bytes); }
            return h.digestHex();
        };
        const page = new Sim(p, null);
        expect(page.hoverThr).toBe(hoverSolve(p, 1).motor);
        expect(trace(page)).toBe(trace(lifeSim(p, null)));
        // centre stick holds altitude with the Sim's own value
        expect(Math.abs(holdStick(p, 1, 0.5, 3000).s[S.vy])).toBeLessThan(0.1);
    });

    it('control: v0.2\'s default hoverThr (0.4, when the page forgot to set it) gives another trace and climbs at centre stick', () => {
        const p = params('pavo20pro-3s', { gravityMode: 'auto-throttle', gravity: 1.62 });
        const old = new Sim(p, null);
        old.hoverThr = 0.4;
        const sim = holdStick(p, 1, 0.5, 3000, old);
        expect(sim.s[S.vy]).toBeGreaterThan(1);
    });
});

describe('RespawnOpts.soc that is not a number', () => {
    it('reset({ soc: NaN }) keeps the pack, and every hashed slot stays finite', () => {
        const p = params();
        const sim = holdStick(p, 0.6, hoverSolve(p, 0.6).stick, 200);
        const before = sim.s[S.soc];
        sim.setChannels([0, 0, -1, 0, 1, MODE_CHANNEL.angle, 0, 0]);
        sim.reset(0, 100, 0, 0, { keepArmed: true, soc: NaN });
        expect(sim.s[S.soc]).toBe(before);
        sim.setChannels([0, 0, 0, 0, 1, MODE_CHANNEL.angle, 0, 0]);
        for (let i = 0; i < 500; i++) sim.step();
        expect(Array.from(sim.s).every(Number.isFinite)).toBe(true);
        // the log path drops it too (the record then says "keep")
        expect(normalizeRespawnOpts({ soc: NaN }).soc).toBeUndefined();
    });

    it('control: a real number still replaces the pack', () => {
        const sim = new Sim(params(), null);
        sim.reset(0, 100, 0, 0, { soc: 0.5 });
        expect(sim.s[S.soc]).toBe(0.5);
    });
});

describe('angle mode beyond the author\'s table (B.5)', () => {
    /** steady roll and pitch after 2 s at sticks (r, p) in angle mode */
    function steady(p: SimParams, r: number, pt: number): [number, number] {
        const { sim, ch } = hovering(p, 'angle', 500);
        ch[0] = r; ch[1] = pt;
        sim.setChannels(ch);
        for (let i = 0; i < 2000; i++) sim.step();
        const a = attitude(sim.s);
        return [a.roll, a.pitch];
    }
    const want = (p: SimParams, x: number) => (60 * setpointRate(p.rates.type, x, p.rates.roll, p.rates.rateLimit)) / setpointRate(p.rates.type, 1, p.rates.roll, p.rates.rateLimit);

    it('on all six presets: a left stick mirrors the right one, and a diagonal stick tilts both axes as the table says', () => {
        const bad: string[] = [];
        for (const id of PRESETS) {
            const p = params(id);
            const [l] = steady(p, -0.5, 0);
            const [dr, dp] = steady(p, 0.5, 0.5);
            const w = want(p, 0.5);
            if (!(Math.abs(l + w) <= 0.3 && Math.abs(dr - w) <= 0.3 && Math.abs(dp - w) <= 0.3)) bad.push(`${id}: left ${l.toFixed(2)}, diagonal ${dr.toFixed(2)}/${dp.toFixed(2)}, want ${w.toFixed(2)}`);
        }
        expect(bad).toEqual([]);
    });

    it('control: the v0.2 limit (55 deg) misses the same check', () => {
        const p = params('pavo20pro-3s', { level: { limitDeg: 55 } });
        const [dr] = steady(p, 0.5, 0.5);
        expect(Math.abs(dr - want(p, 0.5))).toBeGreaterThan(0.3);
    });

    it('from upside down (roll 120, 179, -179, 180 deg) with centred sticks it is within 1 deg of level after 1.5 s', () => {
        for (const deg of [120, 179, -179, 180]) {
            const { sim, ch } = hovering(params(), 'angle', 1000);
            const h = (-deg * Math.PI) / 360;
            sim.s[S.qw] = Math.cos(h); sim.s[S.qx] = 0; sim.s[S.qy] = 0; sim.s[S.qz] = Math.sin(h);
            ch[2] = 0.2;
            sim.setChannels(ch);
            for (let i = 0; i < 1500; i++) sim.step();
            expect(Math.abs(roll(sim)), `from ${deg}`).toBeLessThan(1);
        }
    });

    it('control: acro from the same pose stays upside down', () => {
        const { sim, ch } = hovering(params(), 'acro', 1000);
        const h = (-179 * Math.PI) / 360;
        sim.s[S.qw] = Math.cos(h); sim.s[S.qx] = 0; sim.s[S.qy] = 0; sim.s[S.qz] = Math.sin(h);
        ch[2] = 0.2;
        sim.setChannels(ch);
        for (let i = 0; i < 1500; i++) sim.step();
        expect(Math.abs(roll(sim))).toBeGreaterThan(170);
    });
});

describe('the motor step at a mode switch (B.5): bounded into a levelled mode, not out of one', () => {
    /** largest per-tick change of any motor command in the 20 ticks after switching from -> into at roll stick `x` held 1.5 s */
    function stepAtSwitch(p: SimParams, from: FlightMode, into: FlightMode, x: number): number {
        const { sim, ch } = hovering(p, from, 500);
        ch[0] = x;
        sim.setChannels(ch);
        for (let i = 0; i < 1500; i++) sim.step();
        let prev = Array.from(sim.motorCmd);
        ch[5] = MODE_CHANNEL[into];
        sim.setChannels(ch);
        let worst = 0;
        for (let i = 0; i < 20; i++) {
            sim.step();
            const m = Array.from(sim.motorCmd);
            for (let k = 0; k < 4; k++) worst = Math.max(worst, Math.abs(m[k] - prev[k]));
            prev = m;
        }
        return worst;
    }

    it('into angle at a held half stick: under 0.2 per tick on the Pro and the Pro II (F = 41)', () => {
        for (const id of ['pavo20pro-3s', 'pavo20pro2-3s']) expect(stepAtSwitch(params(id), 'acro', 'angle', 0.5), id).toBeLessThan(0.2);
    });

    it('out of angle into acro at a held half stick the motors step by the acro demand (above 0.2), as Betaflight does; the 0.2 bound of B.5 holds for switches into a levelled mode only', () => {
        const step = stepAtSwitch(params(), 'angle', 'acro', 0.5);
        console.log(`angle -> acro at half stick: ${step.toFixed(3)} per tick`);
        expect(step).toBeGreaterThan(0.2);
        // control: with centred sticks the same switch is smooth (the step is the pilot's stick, not the switch)
        expect(stepAtSwitch(params(), 'angle', 'acro', 0)).toBeLessThan(0.05);
    });
});
