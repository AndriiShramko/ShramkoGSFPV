// Review finding C6: the Sim constructor and lifeSim / the page disagreed on hoverThr at zero
// gravity (0.4 vs 0), so a zero-g auto-throttle flight replayed in a `new Sim` climbed 13 m higher
// and its saved hash did not verify. One owner now (hoverThrOf, set by the constructor). Control:
// the old constructor rule (0.4 when hoverSolve says 0) on the same flight.

import { describe, expect, it } from 'vitest';
import { MODE_CHANNEL, S, Sha256, Sim, compileParams, hoverSolve, hoverThrOf, lifeSim } from '../src/index';
import type { ParamOverrides } from '../src/index';
import { PRESET } from './log-kit';

/** 2 s of centre stick in auto-throttle, armed; the trace hash and the height gained. */
function centreStick(sim: Sim): { hash: string; dy: number } {
    sim.reset(0, 100, 0, 0);
    const ch = [0, 0, -1, 0, -1, MODE_CHANNEL.angle, 0, 0];
    sim.setChannels(ch); sim.step();
    ch[4] = 1; sim.setChannels(ch); sim.step();
    ch[2] = 0; sim.setChannels(ch);
    const y0 = sim.s[S.py];
    const h = new Sha256();
    const bytes = new Uint8Array(sim.s.buffer);
    for (let i = 0; i < 2000; i++) { sim.step(); h.update(bytes); }
    return { hash: h.digestHex(), dy: sim.s[S.py] - y0 };
}

const ZERO_G: ParamOverrides = { gravity: 0, gravityMode: 'auto-throttle' };
const MOON: ParamOverrides = { gravity: 1.62, gravityMode: 'auto-throttle' };
// a world this craft cannot hover in: 60 m/s^2 needs more than full output from a Pavo20 Pro
const HEAVY: ParamOverrides = { gravity: 60, gravityMode: 'auto-throttle' };

describe('hoverThr has one owner (review C6)', () => {
    it('zero gravity: a new Sim, lifeSim and the page get the same hoverThr (0) and fly the same trace', () => {
        const p = compileParams(PRESET, ZERO_G);
        expect(hoverSolve(p, 1).motor).toBe(0);
        const a = new Sim(p, null), b = lifeSim(p, null);
        expect(a.hoverThr).toBe(0);
        expect(b.hoverThr).toBe(0);
        const ra = centreStick(a), rb = centreStick(b);
        expect(ra.hash).toBe(rb.hash);
        // centre stick at zero g holds the height (the auto-throttle map's floor is 0.02 of the range)
        expect(Math.abs(ra.dy)).toBeLessThan(3);
    });

    it('control: the old constructor rule (0.4 when hoverSolve says 0) climbs at centre stick and gives another trace', () => {
        const p = compileParams(PRESET, ZERO_G);
        const page = new Sim(p, null);
        const old = new Sim(p, null);
        old.hoverThr = 0.4;
        const rp = centreStick(page), ro = centreStick(old);
        expect(ro.hash).not.toBe(rp.hash);
        expect(ro.dy - rp.dy).toBeGreaterThan(10);
    });

    it('a craft that cannot hover gets full output (not NaN) in every Sim; the Moon and Earth keep hoverSolve\'s value', () => {
        const heavy = compileParams(PRESET, HEAVY);
        expect(Number.isNaN(hoverSolve(heavy, 1).motor)).toBe(true);
        expect(hoverThrOf(heavy)).toBe(1);
        const s = lifeSim(heavy, null);
        const r = centreStick(s);
        expect(Array.from(s.s).every(Number.isFinite)).toBe(true);
        expect(r.hash).toBe(centreStick(new Sim(heavy, null)).hash);
        for (const o of [MOON, { gravityMode: 'auto-throttle' } as ParamOverrides]) {
            const p = compileParams(PRESET, o);
            expect(new Sim(p, null).hoverThr).toBe(hoverSolve(p, 1).motor);
        }
    });
});
