// Stick step response (v0.5 latency work): how fast the craft follows a stick step in each mode.
// The angle mode is checked against Betaflight 4.5's self-level loop re-implemented here from its
// formulas (docs/architecture-v03.md B.1) around an ideal first-order rate loop of 15 ms, so a lost or
// weakened angle feed-forward, an extra filter, or a changed level gain shows up as a slower step.
// Measured 2026-10-02 (tools/bench/src/step-response.ts, pavo20pro-3s): angle half-stick roll
// 10/50/90 % at 37/98/187 ms, the reference 36/100/191 ms; acro half stick 4/12/37 ms.
import { describe, it, expect } from 'vitest';
import { params, hovering, rate } from './model-helpers';
import { setpointRate, attitude } from '../src/index';
import type { ParamOverrides } from '../src/index';

interface Times { motor: number; t10: number; t50: number; t90: number }

/** Hover, then step one stick; times (ms) to the first motor change and 10/50/90 % of the target. */
function step(mode: 'acro' | 'angle', axis: 'roll' | 'pitch', stick: number, o: ParamOverrides = {}): Times {
    const p = params('pavo20pro-3s', o);
    const { sim, ch } = hovering(p, mode);
    const m0 = Array.from(sim.motorCmd);
    const a0 = attitude(sim.s)[axis];
    const rc = p.rates;
    const ax = axis === 'roll' ? rc.roll : rc.pitch;
    const sp = setpointRate(rc.type, stick, ax, rc.rateLimit);
    const target = mode === 'angle' ? (p.level.limitDeg * sp) / setpointRate(rc.type, 1, ax, rc.rateLimit) : sp;
    ch[axis === 'roll' ? 0 : 1] = stick;
    sim.setChannels(ch);
    const out: Times = { motor: -1, t10: -1, t50: -1, t90: -1 };
    for (let t = 1; t <= 1500; t++) {
        sim.step();
        if (out.motor < 0 && m0.some((m, i) => Math.abs(sim.motorCmd[i] - m) > 0.002)) out.motor = t;
        const v = mode === 'angle' ? attitude(sim.s)[axis] - a0 : rate(sim, axis);
        const f = v / target;
        if (out.t10 < 0 && f >= 0.1) out.t10 = t;
        if (out.t50 < 0 && f >= 0.5) out.t50 = t;
        if (out.t90 < 0 && f >= 0.9) out.t90 = t;
    }
    return out;
}

/**
 * The self-level loop from its formulas, for a unit angle step: rate = (target - angle) * gain/10
 * + feed-forward, feed-forward = ffGain * d(target)/dt through a 3-stage low-pass of ffSmoothMs,
 * the sum through a 3-stage low-pass at outHz, and the craft's rate follows that with a first-order
 * lag of tauMs (our rate loop with motors measures about 15 ms). Times to 10/50/90 %, ms.
 */
function reference(gain = 50, ffGain = 0.5, ffSmoothMs = 80, outHz = 50, tauMs = 15): Omit<Times, 'motor'> {
    const dt = 1e-4;
    const corr = 1.961459177; // the 3-stage cascade is -3 dB at the cutoff, not each stage
    const k = (fc: number) => dt / (1 / (2 * Math.PI * fc * corr) + dt);
    const kf = k(1000 / (2 * Math.PI * ffSmoothMs)), ko = k(outHz);
    const a = [0, 0, 0], o = [0, 0, 0];
    let ang = 0, w = 0, prev = 0;
    const r = { t10: -1, t50: -1, t90: -1 };
    for (let i = 1; i <= 15000; i++) {
        const target = 1;
        const ff = (ffGain * (target - prev)) / dt;
        prev = target;
        a[0] += (ff - a[0]) * kf; a[1] += (a[0] - a[1]) * kf; a[2] += (a[1] - a[2]) * kf;
        const sp = (target - ang) * (gain / 10) + a[2];
        o[0] += (sp - o[0]) * ko; o[1] += (o[0] - o[1]) * ko; o[2] += (o[1] - o[2]) * ko;
        w += ((o[2] - w) * dt) / (tauMs / 1000);
        ang += w * dt;
        const ms = Math.round(i * dt * 1000);
        if (r.t10 < 0 && ang >= 0.1) r.t10 = ms;
        if (r.t50 < 0 && ang >= 0.5) r.t50 = ms;
        if (r.t90 < 0 && ang >= 0.9) r.t90 = ms;
    }
    return r;
}

describe('stick step response', () => {
    it('the motors answer a stick step in the first 1 ms tick, in acro and in angle', () => {
        for (const mode of ['acro', 'angle'] as const) {
            for (const s of [0.25, 0.5, 1]) expect(step(mode, 'roll', s).motor).toBe(1);
        }
    });

    it('acro: half the commanded rate within 20 ms and 90 % within 50 ms (roll and pitch, 25-100 % stick)', () => {
        for (const axis of ['roll', 'pitch'] as const) {
            for (const s of [0.25, 0.5, 1]) {
                const r = step('acro', axis, s);
                expect(r.t50).toBeGreaterThan(0);
                expect(r.t50).toBeLessThanOrEqual(20);
                expect(r.t90).toBeLessThanOrEqual(50);
            }
        }
        // control: a rate loop at 1/8 of its gains fails the bound (a 4x slower motor does not: the
        // loop drives through it, 90 % at 35 ms)
        expect(step('acro', 'roll', 0.5, { pid: { roll: [7, 14, 5, 0] } }).t90).toBeGreaterThan(50);
    });

    it('angle: follows the self-level reference within 20 ms at 10/50/90 % (25-100 % stick)', () => {
        const ref = reference();
        expect(ref.t50).toBeGreaterThan(80); // the reference itself: 36/100/191 ms
        for (const s of [0.25, 0.5, 1]) {
            const r = step('angle', 'roll', s);
            // the reference's rate loop is an ideal lag: at quarter stick ours is 15 ms quicker to 90 %
            expect(Math.abs(r.t10 - ref.t10)).toBeLessThanOrEqual(20);
            expect(Math.abs(r.t50 - ref.t50)).toBeLessThanOrEqual(20);
            expect(Math.abs(r.t90 - ref.t90)).toBeLessThanOrEqual(20);
        }
        const p = step('angle', 'pitch', 0.5);
        expect(Math.abs(p.t50 - ref.t50)).toBeLessThanOrEqual(20);
    });

    it('control: without the angle feed-forward the same check fails (90 % only after ~450 ms)', () => {
        const ref = reference();
        const r = step('angle', 'roll', 0.5, { level: { ffGain: 0 } });
        expect(r.t90 - ref.t90).toBeGreaterThan(200);
        // and the reference agrees with the model on that variant too (470 and 433 ms)
        expect(Math.abs(r.t90 - reference(50, 0).t90)).toBeLessThanOrEqual(0.1 * reference(50, 0).t90);
    });

    it('a stronger level (strength 100) is faster in the model and in the reference alike', () => {
        const r = step('angle', 'roll', 0.5, { level: { gain: 100 } });
        const ref = reference(100);
        expect(r.t50).toBeLessThan(step('angle', 'roll', 0.5).t50 - 20);
        expect(Math.abs(r.t50 - ref.t50)).toBeLessThanOrEqual(20);
    });
});
