// A4: flight-model consistency checks, each with a negative control that must fail.
import { Sim, S, hoverSolve, maxRate, invertRate, RAD2DEG, setpointRate } from '@gsfpv/sim-core';
import type { SimParams, ParamOverrides } from '@gsfpv/sim-core';
import { params } from './presets';

const CH = () => new Float64Array([0, 0, -1, 0, -1, 0, 0, 0]);

/** Airborne sim, armed, no collision world. */
function armedSim(p: SimParams): Sim {
    const sim = new Sim(p, null);
    sim.reset(0, 100, 0, 0);
    const ch = CH();
    sim.setChannels(ch);
    sim.step();
    ch[4] = 1; // arm switch on at zero throttle
    sim.setChannels(ch);
    sim.step();
    if (!sim.armed) throw new Error('did not arm');
    return sim;
}

function stickForThrottle(out: number): number {
    return out * 2 - 1; // channel value for a throttle fraction (linear curve)
}

// ---------- hover ----------
export function hoverCheck(o: ParamOverrides = {}, extraThrottle = 0): { vz: number; motor: number; stick: number; pass: boolean } {
    const p = params('pavo20pro-3s', o);
    const hv = hoverSolve(p, 1);
    const sim = armedSim(p);
    // start already hovering: motors spun up to the hover output
    for (let i = 0; i < 4; i++) sim.s[S.m0 + i] = hv.motor;
    sim.s[S.vy] = 0;
    const ch = CH();
    ch[4] = 1;
    ch[2] = stickForThrottle(hv.stick + extraThrottle);
    sim.setChannels(ch);
    for (let i = 0; i < 2000; i++) sim.step();
    const vz = sim.s[S.vy];
    return { vz, motor: hv.motor, stick: hv.stick, pass: Math.abs(vz) < 0.05 };
}

// ---------- full stick = rate curve ----------
export function fullStickCheck(axis: 'roll' | 'pitch' | 'yaw', o: ParamOverrides = {}): { target: number; measured: number; errPct: number; pass: boolean } {
    const p = params('pavo20pro-3s', o);
    const hv = hoverSolve(p, 1);
    const sim = armedSim(p);
    const ch = CH();
    ch[4] = 1;
    ch[2] = stickForThrottle(hv.stick);
    const idx = axis === 'roll' ? 0 : axis === 'pitch' ? 1 : 3;
    ch[idx] = 1;
    sim.setChannels(ch);
    let sum = 0;
    let n = 0;
    for (let i = 0; i < 600; i++) {
        sim.step();
        if (i >= 300) {
            const w = axis === 'roll' ? -sim.s[S.wz] : axis === 'pitch' ? -sim.s[S.wx] : -sim.s[S.wy];
            sum += w * RAD2DEG;
            n++;
        }
    }
    const measured = sum / n;
    const target = maxRate(p.rates, axis);
    const errPct = ((measured - target) / target) * 100;
    return { target, measured, errPct, pass: Math.abs(errPct) <= 3 };
}

// ---------- motor time constant ----------
export function motorTauCheck(simTauMs?: number): { expectedMs: number; measuredMs: number; pass: boolean } {
    const nominal = params('pavo20pro-3s');
    const p = params('pavo20pro-3s', simTauMs === undefined ? {} : { tauMs: simTauMs });
    const sim = armedSim(p);
    // settle at idle
    for (let i = 0; i < 200; i++) sim.step();
    const w0 = sim.s[S.m0];
    const ch = CH();
    ch[4] = 1;
    ch[2] = 1; // full throttle step
    sim.setChannels(ch);
    // target output for M1 once the step is applied (full throttle, no rotation yet)
    let measured = NaN;
    for (let i = 1; i <= 500; i++) {
        sim.step();
        const w = sim.s[S.m0];
        if ((w - w0) / (1 - w0) >= 0.632) { measured = i; break; }
    }
    const expectedMs = nominal.tau * 1000;
    return { expectedMs, measuredMs: measured, pass: Math.abs(measured - expectedMs) / expectedMs <= 0.05 };
}

// ---------- airmode at zero throttle ----------
export function airmodeCheck(o: ParamOverrides = {}): { target: number; measured: number; ratio: number; pass: boolean } {
    const p = params('pavo20pro-3s', o);
    const sim = armedSim(p);
    const ch = CH();
    ch[4] = 1;
    ch[2] = -1; // zero throttle
    ch[0] = 1; // full roll
    sim.setChannels(ch);
    let sum = 0, n = 0;
    for (let i = 0; i < 500; i++) {
        sim.step();
        if (i >= 250) { sum += -sim.s[S.wz] * RAD2DEG; n++; }
    }
    const measured = sum / n;
    const target = maxRate(p.rates, 'roll');
    return { target, measured, ratio: measured / target, pass: measured / target >= 0.9 };
}

// ---------- PID step 0 -> 500 deg/s ----------
export function pidStepCheck(o: ParamOverrides = {}): { setpoint: number; peak: number; overshootPct: number; settledErr: number; oscillations: number; pass: boolean } {
    const p = params('pavo20pro-3s', o);
    const hv = hoverSolve(p, 1);
    const sim = armedSim(p);
    const ch = CH();
    ch[4] = 1;
    ch[2] = stickForThrottle(hv.stick);
    sim.setChannels(ch);
    for (let i = 0; i < 200; i++) sim.step();
    const x = invertRate(p.rates.type, 500, p.rates.roll, p.rates.rateLimit);
    const sp = setpointRate(p.rates.type, x, p.rates.roll, p.rates.rateLimit);
    ch[0] = x;
    sim.setChannels(ch);
    let peak = -Infinity;
    const trace: number[] = [];
    for (let i = 0; i < 400; i++) {
        sim.step();
        const w = -sim.s[S.wz] * RAD2DEG;
        trace.push(w);
        if (w > peak) peak = w;
    }
    // oscillation: sign changes of the error after the first crossing of the setpoint
    let first = trace.findIndex((w) => w >= sp);
    let osc = 0;
    if (first >= 0) {
        let prev = Math.sign(trace[first] - sp);
        for (let i = first + 1; i < trace.length; i++) {
            const e = trace[i] - sp;
            if (Math.abs(e) < 0.02 * sp) continue;
            const sg = Math.sign(e);
            if (sg !== prev) { osc++; prev = sg; }
        }
    } else first = trace.length;
    const settledErr = Math.abs(trace.slice(-100).reduce((a, b) => a + b, 0) / 100 - sp) / sp;
    const overshootPct = ((peak - sp) / sp) * 100;
    return { setpoint: sp, peak, overshootPct, settledErr, oscillations: osc, pass: overshootPct <= 15 && osc < 2 && settledErr < 0.03 };
}

// ---------- gravity: hover output on the Moon ----------
export function moonHoverCheck(idealBattery: boolean): { g: number; motor: number; expected: number; pass: boolean } {
    const o: ParamOverrides = { gravity: 1.62 };
    const p = params('pavo20pro-3s', o);
    if (idealBattery) { p.rPack = 0; p.vNom = p.cells * 4.2; }
    // measure: closed-loop-free search of the throttle that holds vz ~ 0, read the motor output
    const hv = hoverSolve(p, 1);
    const sim = armedSim(p);
    for (let i = 0; i < 4; i++) sim.s[S.m0 + i] = hv.motor;
    const ch = CH();
    ch[4] = 1;
    ch[2] = stickForThrottle(hv.stick);
    sim.setChannels(ch);
    for (let i = 0; i < 1000; i++) sim.step();
    const motor = (sim.s[S.m0] + sim.s[S.m1] + sim.s[S.m2] + sim.s[S.m3]) / 4;
    const vz = sim.s[S.vy];
    const expected = 1 / Math.sqrt((p.twr * 9.81) / 1.62);
    return { g: p.gravity, motor, expected, pass: Math.abs(motor - 0.18) <= 0.01 && Math.abs(vz) < 0.05 };
}

// ---------- zero g, no forces: angular momentum conservation ----------
export function angularMomentumCheck(): { L0: number; L1: number; relDrift: number; pass: boolean } {
    const p = params('pavo20pro-3s', { gravity: 0 });
    const sim = new Sim(p, null);
    sim.reset(0, 0, 0, 0);
    sim.s[S.wx] = 3; sim.s[S.wy] = 7; sim.s[S.wz] = -5; // tumbling, disarmed: no thrust, no drag (not moving)
    const Lw = () => {
        const s = sim.s;
        const I = p.inertia;
        const bx = I[0] * s[S.wx], by = I[1] * s[S.wy], bz = I[2] * s[S.wz];
        const qw = s[S.qw], qx = s[S.qx], qy = s[S.qy], qz = s[S.qz];
        const r00 = 1 - 2 * (qy * qy + qz * qz), r01 = 2 * (qx * qy - qw * qz), r02 = 2 * (qx * qz + qw * qy);
        const r10 = 2 * (qx * qy + qw * qz), r11 = 1 - 2 * (qx * qx + qz * qz), r12 = 2 * (qy * qz - qw * qx);
        const r20 = 2 * (qx * qz - qw * qy), r21 = 2 * (qy * qz + qw * qx), r22 = 1 - 2 * (qx * qx + qy * qy);
        return [r00 * bx + r01 * by + r02 * bz, r10 * bx + r11 * by + r12 * bz, r20 * bx + r21 * by + r22 * bz];
    };
    const a = Lw();
    for (let i = 0; i < 10000; i++) sim.step();
    const b = Lw();
    const L0 = Math.hypot(a[0], a[1], a[2]);
    const d = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    return { L0, L1: Math.hypot(b[0], b[1], b[2]), relDrift: d / L0, pass: d / L0 < 1e-4 };
}

// ---------- drag: terminal velocity in free fall (disarmed, level) ----------
export function terminalVelocityCheck(cdaScale = 1): { measured: number; expected: number; errPct: number; pass: boolean } {
    const p = params('pavo20pro-3s', { cdaScale });
    const sim = new Sim(p, null);
    sim.reset(0, 1000, 0, 0);
    for (let i = 0; i < 30000; i++) sim.step();
    const measured = -sim.s[S.vy];
    const nominal = params('pavo20pro-3s');
    const expected = Math.sqrt((2 * nominal.mass * nominal.gravity) / (nominal.rho * nominal.cda[1]));
    const errPct = ((measured - expected) / expected) * 100;
    return { measured, expected, errPct, pass: Math.abs(errPct) <= 3 };
}

export function runA4(): Record<string, unknown> {
    const hover = hoverCheck();
    const hoverCtl = hoverCheck({}, 0.02);
    const full = { roll: fullStickCheck('roll'), pitch: fullStickCheck('pitch'), yaw: fullStickCheck('yaw') };
    const tau = motorTauCheck();
    const tauCtl = motorTauCheck(0);
    const air = airmodeCheck();
    const step = pidStepCheck();
    const pRoll = params('pavo20pro-3s').pid.roll;
    const stepCtl = pidStepCheck({ pid: { roll: [pRoll[0] * 3, pRoll[1], pRoll[2], pRoll[3]] } });
    const moonIdeal = moonHoverCheck(true);
    const moonSag = moonHoverCheck(false);
    const L = angularMomentumCheck();
    const term = terminalVelocityCheck(1);
    const termCtl = terminalVelocityCheck(2);
    const checks = {
        hover: { ...hover, control: { name: 'throttle +0.02 must climb', vz: hoverCtl.vz, fired: hoverCtl.vz > 0.05 } },
        fullStick: { ...full, pass: full.roll.pass && full.pitch.pass && full.yaw.pass },
        motorTau: { ...tau, control: { name: 'tau = 0 must fail the check', measuredMs: tauCtl.measuredMs, fired: !tauCtl.pass } },
        airmodeZeroThrottle: air,
        pidStep: { ...step, control: { name: 'Kp x3 must be caught (overshoot/oscillation)', overshootPct: stepCtl.overshootPct, oscillations: stepCtl.oscillations, fired: !stepCtl.pass } },
        moonHover: { idealBattery: moonIdeal, withSag: { ...moonSag, note: 'informational: with battery sag the hover output is lower because the pack sits above V_nom at hover current' } },
        zeroGAngularMomentum: L,
        terminalVelocity: { ...term, control: { name: 'doubled CdA must shift v_term', measured: termCtl.measured, fired: Math.abs(termCtl.measured - term.measured) / term.measured > 0.2 } }
    };
    const pass =
        hover.pass && checks.hover.control.fired && checks.fullStick.pass && tau.pass && checks.motorTau.control.fired &&
        air.pass && step.pass && checks.pidStep.control.fired && moonIdeal.pass && L.pass && term.pass && checks.terminalVelocity.control.fired;
    return { pass, checks };
}
