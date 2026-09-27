// A4: flight-model consistency checks, each with a negative control that must fail.
// sim-core/0.2.0 adds the H.5 checks (duct drag, rotor inertia, top speed, terminal velocity) and
// the Pavo20 feel figures against v0.2 and the research targets (docs/architecture-v03.md H).
// Run directly (`tsx tools/bench/src/a4-physics.ts`) it writes evidence/<date>/v03-a4-physics.json.
import { pathToFileURL } from 'node:url';
import { Sim, S, hoverSolve, maxRate, invertRate, RAD2DEG, setpointRate, attitude, MODE_CHANNEL, SIM_CORE_VERSION } from '@gsfpv/sim-core';
import type { SimParams, ParamOverrides } from '@gsfpv/sim-core';
import { params } from './presets';
import { writeEvidence } from './evidence';

// acro unless a check says otherwise: since 0.2.0 ch[5] = 0 is horizon, not "not angle"
const CH = () => new Float64Array([0, 0, -1, 0, -1, MODE_CHANNEL.acro, 0, 0]);

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

function stickForThrottle(stick: number): number {
    return stick * 2 - 1; // channel value for a stick fraction (hoverSolve().stick is already through the throttle curve)
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
export function fullStickCheck(axis: 'roll' | 'pitch' | 'yaw', o: ParamOverrides = {}, id = 'pavo20pro-3s'): { target: number; measured: number; errPct: number; pass: boolean } {
    const p = params(id, o);
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
    sim.s[S.hold] = 0; // free body, not parked at the spawn
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
export function terminalVelocityCheck(cdaScale = 1, o: ParamOverrides = {}): { measured: number; expected: number; errPct: number; pass: boolean } {
    const p = params('pavo20pro-3s', { ...o, cdaScale });
    const sim = new Sim(p, null);
    sim.reset(0, 1000, 0, 0);
    sim.s[S.hold] = 0; // free fall, not parked at the spawn
    for (let i = 0; i < 30000; i++) sim.step();
    const measured = -sim.s[S.vy];
    const nominal = params('pavo20pro-3s');
    const expected = Math.sqrt((2 * nominal.mass * nominal.gravity) / (nominal.rho * nominal.cda[1]));
    const errPct = ((measured - expected) / expected) * 100;
    return { measured, expected, errPct, pass: Math.abs(errPct) <= 3 };
}

// ---------- H.5: Pavo20 feel (sim-core/0.2.0) ----------

const PRO = 'pavo20pro-3s';

/** Armed and hovering at 100 m in `mode` for 1.5 s (motors spun up from idle). */
function hovering(p: SimParams, mode: 'acro' | 'angle'): { sim: Sim; ch: Float64Array } {
    const sim = armedSim(p);
    const ch = CH();
    ch[4] = 1;
    ch[5] = MODE_CHANNEL[mode];
    ch[2] = stickForThrottle(hoverSolve(p, 1).stick);
    sim.setChannels(ch);
    for (let i = 0; i < 1500; i++) sim.step();
    return { sim, ch };
}

/** Level in angle mode at hover throttle, then 10 m/s forward: time and distance to 5 and 2 m/s. */
export function coastDown(o: ParamOverrides = {}, id = PRO): { t10to5s: number; t10to2s: number; distTo2m: number } {
    const { sim } = hovering(params(id, o), 'angle');
    sim.s[S.vz] = -10;
    let t5 = NaN, dist = 0;
    for (let i = 1; i <= 40000; i++) {
        sim.step();
        const v = Math.hypot(sim.s[S.vx], sim.s[S.vz]);
        dist += v * 0.001;
        if (Number.isNaN(t5) && v <= 5) t5 = i / 1000;
        if (v <= 2) return { t10to5s: t5, t10to2s: i / 1000, distTo2m: dist };
    }
    return { t10to5s: t5, t10to2s: Infinity, distTo2m: dist };
}

/** Angle-mode cruise at 20 deg tilt, 90 deg yaw at half stick while holding pitch: s of sideslip above 30 deg. */
export function sideslip(o: ParamOverrides = {}, id = PRO): { cruiseMs: number; slipOver30s: number } {
    const p = params(id, o);
    const { sim, ch } = hovering(p, 'angle');
    ch[1] = invertRate(p.rates.type, (20 / p.level.limitDeg) * maxRate(p.rates, 'pitch'), p.rates.pitch, p.rates.rateLimit);
    sim.setChannels(ch);
    for (let i = 0; i < 8000; i++) sim.step();
    const cruise = Math.hypot(sim.s[S.vx], sim.s[S.vz]);
    const yaw0 = attitude(sim.s).yaw;
    const wrap = (a: number) => ((a + 540) % 360) - 180;
    let turned = false, tEnd = -1, t30 = 0;
    for (let i = 1; i <= 15000; i++) {
        if (!turned && wrap(attitude(sim.s).yaw - yaw0) >= 90) { turned = true; tEnd = i; }
        ch[3] = turned ? 0 : 0.5;
        sim.setChannels(ch);
        sim.step();
        const vh = Math.hypot(sim.s[S.vx], sim.s[S.vz]);
        const slip = Math.abs(wrap((Math.atan2(sim.s[S.vx], -sim.s[S.vz]) * 180) / Math.PI - attitude(sim.s).yaw));
        if (turned && vh > 0.3 && slip > 30) t30 = (i - tEnd) / 1000;
    }
    return { cruiseMs: cruise, slipOver30s: t30 };
}

/** Full yaw stick step from hover (acro): t63/t90 and peak over the setpoint. */
export function yawStep(o: ParamOverrides = {}, id = PRO): { setpoint: number; t63ms: number; t90ms: number; peak: number; overshootPct: number } {
    const p = params(id, o);
    const { sim, ch } = hovering(p, 'acro');
    ch[3] = 1;
    sim.setChannels(ch);
    const sp = setpointRate(p.rates.type, 1, p.rates.yaw, p.rates.rateLimit);
    let t63 = -1, t90 = -1, peak = 0;
    for (let i = 1; i <= 400; i++) {
        sim.step();
        const r = -sim.s[S.wy] * RAD2DEG;
        if (t63 < 0 && r >= 0.632 * sp) t63 = i;
        if (t90 < 0 && r >= 0.9 * sp) t90 = i;
        if (r > peak) peak = r;
    }
    return { setpoint: sp, t63ms: t63, t90ms: t90, peak, overshootPct: (peak / sp - 1) * 100 };
}

/** Full-stick 200 ms yaw flick with 80 ms thumb ramps at 16 ms frames: heading change after the stick is centred. */
export function yawFlick(o: ParamOverrides = {}, id = PRO): { cmdDeg: number; gotDeg: number; afterCentredDeg: number } {
    const p = params(id, o);
    const { sim, ch } = hovering(p, 'acro');
    const hold = 200;
    let head = 0, cmd = 0, atRelease = 0;
    for (let i = 1; i <= hold + 80 + 600; i++) {
        const tf = Math.floor((i - 1) / 16) * 16;
        ch[3] = Math.min(Math.min(1, tf / 80), tf >= hold + 80 ? Math.max(0, 1 - (tf - hold - 80) / 80) : 1);
        sim.setChannels(ch);
        sim.step();
        head += -sim.s[S.wy] * RAD2DEG * 0.001;
        cmd += setpointRate(p.rates.type, sim.ch[3], p.rates.yaw, p.rates.rateLimit) * 0.001;
        if (i === hold + 160) atRelease = head;
    }
    return { cmdDeg: cmd, gotDeg: head, afterCentredDeg: head - atRelease };
}

/** Full throttle, attitude held in acro at the pitch that keeps vy ~ 0 (bisection). */
export function topSpeed(o: ParamOverrides = {}, id = PRO): { kmh: number; pitchDeg: number } {
    const p = params(id, o);
    const run = (deg: number) => {
        const { sim } = hovering(p, 'acro');
        const th = (-deg * Math.PI) / 180;
        sim.s[S.qw] = Math.cos(th / 2); sim.s[S.qx] = Math.sin(th / 2); sim.s[S.qy] = 0; sim.s[S.qz] = 0;
        sim.s[S.wx] = sim.s[S.wy] = sim.s[S.wz] = 0;
        const ch = CH();
        ch[4] = 1; ch[2] = 1;
        sim.setChannels(ch);
        for (let i = 0; i < 15000; i++) sim.step();
        let vy = 0, vh = 0;
        for (let i = 0; i < 1000; i++) { sim.step(); vy += sim.s[S.vy]; vh += Math.hypot(sim.s[S.vx], sim.s[S.vz]); }
        return { vy: vy / 1000, vh: vh / 1000 };
    };
    let lo = 30, hi = 89, r = run(60);
    for (let i = 0; i < 20; i++) {
        const mid = (lo + hi) / 2;
        r = run(mid);
        if (r.vy > 0) lo = mid; else hi = mid;
    }
    return { kmh: r.vh * 3.6, pitchDeg: (lo + hi) / 2 };
}

/** Steady tilt in angle mode for a held roll stick (2 s). */
export function angleTilt(id = PRO): Record<string, number> {
    const out: Record<string, number> = {};
    for (const x of [0.1, 0.25, 0.5, 0.75, 1]) {
        const { sim, ch } = hovering(params(id), 'angle');
        ch[0] = x;
        sim.setChannels(ch);
        for (let i = 0; i < 2000; i++) sim.step();
        out[x] = attitude(sim.s).roll;
    }
    return out;
}

/** Hover figures with the preset's idle and throttle curve (reported, not gated: no 3S reference exists). */
export function hoverFigures(id = PRO): Record<string, unknown> {
    const p = params(id);
    const f = hoverSolve(p, 1), h = hoverSolve(p, 0.5);
    const pct = (x: number) => Math.round(x * 1000) / 10;
    return {
        idle: p.idle, throttleCurve: p.throttle,
        fullPack: { motorOutput: f.motor, throttlePct: pct(f.throttle), stickPct: pct(f.stick) },
        halfPack: { motorOutput: h.motor, throttlePct: pct(h.throttle), stickPct: pct(h.stick) }
    };
}

/**
 * v0.2 figures (sim-core/0.1.0 at 60fa9de with the v0.2 presets), measured with this file's metric
 * code on a snapshot of that tree (.cache/v03/w1/model/feel.ts); they equal research-physics (c).
 * The v0.2 model no longer exists in the tree, so they are recorded, not re-run.
 */
const V02 = {
    'pavo20pro-3s': {
        massG: 153, maxRates: { roll: 670, pitch: 670, yaw: 665.7 },
        hover: { idle: 0.055, fullPack: { motorOutput: 0.393, throttlePct: 35.8, stickPct: 35.8 }, halfPack: { throttlePct: 41.5, stickPct: 41.5 } },
        coast: { t10to5s: 4.54, t10to2s: 17.97, distTo2m: 72.6 },
        yawStep: { t63ms: 71, t90ms: 95, peak: 901, overshootPct: 34.5 }, yawFlickAfterCentredDeg: -15.8,
        sideslip: { cruiseMs: 11.5, slipOver30s: 3.78 },
        angleTilt: { '0.1': 5.5, '0.25': 13.75, '0.5': 27.5, '0.75': 41.25, '1': 55 }
    },
    'pavo20pro2-3s': {
        massG: 161, maxRates: { roll: 670, pitch: 670, yaw: 668.7 },
        hover: { idle: 0.055, fullPack: { motorOutput: 0.349, throttlePct: 31.1, stickPct: 31.1 }, halfPack: { throttlePct: 36.2, stickPct: 36.2 } },
        coast: { t10to5s: 4.78, t10to2s: 18.92, distTo2m: 76.4 },
        yawStep: { t63ms: 61, t90ms: 80, peak: 915, overshootPct: 36.6 }, yawFlickAfterCentredDeg: -16.9,
        sideslip: { cruiseMs: 11.8, slipOver30s: 3.88 },
        angleTilt: { '0.1': 5.5, '0.25': 13.75, '0.5': 27.5, '0.75': 41.25, '1': 55 }
    }
};

/** Research targets (research-physics (c), prototypes outside the Sim; design H.2 / H.5 / B.5). */
const TARGETS = {
    maxRates: '670 deg/s on all axes (BetaFPV keeps the Betaflight 4.5 default ACTUAL 7/67/0)',
    coastT10to2s: 'predicted 2.3 s at k = 0.6; gate 1.8-3.0 s',
    yawStep: 'predicted t90 21 ms, overshoot 5.6 %; gate overshoot <= 10 %',
    yawFlickAfterCentredDeg: 'predicted 0.8 deg at J_r = 2e-7 (v0.2 tune)',
    sideslipOver30s: 'predicted 1.5 s; gate <= 2 s',
    hover: 'about 32.5 % throttle with 10 % idle predicted for the Pro (no 3S hover figure published); reported, not gated',
    topSpeedKmh: 'predicted 94; gate 85-110',
    angleTilt: 'Betaflight 4.5: 1.2 / 4.9 / 16.6 / 34.9 / 60 deg at stick 0.1 / 0.25 / 0.5 / 0.75 / 1'
};

function feel(id: string): Record<string, unknown> {
    const p = params(id);
    const rates = { roll: fullStickCheck('roll', {}, id).measured, pitch: fullStickCheck('pitch', {}, id).measured, yaw: fullStickCheck('yaw', {}, id).measured };
    return {
        massG: p.mass * 1000, pid: p.pid, idle: p.idle, ductDragPerS: p.ductDrag, rotorInertiaKgm2: p.rotorInertia,
        maxRates: rates, hover: hoverFigures(id), coast: coastDown({}, id), yawStep: yawStep({}, id),
        yawFlickAfterCentredDeg: yawFlick({}, id).afterCentredDeg, sideslip: sideslip({}, id), topSpeed: topSpeed({}, id), angleTilt: angleTilt(id)
    };
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
    // H.5 (sim-core/0.2.0): Pavo20 Pro, duct drag 0.6 1/s, J_r 2e-7 kg m^2
    const coast = coastDown();
    const coastCtl = coastDown({ ductDrag: 0 });
    const slip = sideslip();
    const slipCtl = sideslip({ ductDrag: 0 });
    const yaw = yawStep();
    const yawCtl = yawStep({ propInertia: 0 });
    const top = topSpeed();
    const topCtl = topSpeed({ cdaScale: 0.3 });
    const termNoDuct = terminalVelocityCheck(1, { ductDrag: 0 });
    const termCda = terminalVelocityCheck(1.02);
    const coastOk = (t: number) => t >= 1.8 && t <= 3.0;
    const termRel = (a: number, b: number) => Math.abs(a / b - 1);
    const checks = {
        hover: { ...hover, control: { name: 'throttle +0.02 must climb', vz: hoverCtl.vz, fired: hoverCtl.vz > 0.05 } },
        fullStick: { ...full, pass: full.roll.pass && full.pitch.pass && full.yaw.pass },
        motorTau: { ...tau, control: { name: 'tau = 0 must fail the check', measuredMs: tauCtl.measuredMs, fired: !tauCtl.pass } },
        airmodeZeroThrottle: air,
        pidStep: { ...step, control: { name: 'Kp x3 must be caught (overshoot/oscillation)', overshootPct: stepCtl.overshootPct, oscillations: stepCtl.oscillations, fired: !stepCtl.pass } },
        moonHover: { idealBattery: moonIdeal, withSag: { ...moonSag, note: 'informational: with battery sag the hover output is lower because the pack sits above V_nom at hover current' } },
        zeroGAngularMomentum: L,
        terminalVelocity: { ...term, control: { name: 'doubled CdA must shift v_term', measured: termCtl.measured, fired: Math.abs(termCtl.measured - term.measured) / term.measured > 0.2 } },
        coastDown: { ...coast, gate: '1.8-3.0 s from 10 to 2 m/s', pass: coastOk(coast.t10to2s), control: { name: 'duct drag 0 (v0.2) must fail', t10to2s: coastCtl.t10to2s, fired: !coastOk(coastCtl.t10to2s) } },
        sideslip: { ...slip, gate: 'above 30 deg for at most 2 s after a 90 deg yaw', pass: slip.slipOver30s <= 2, control: { name: 'duct drag 0 must fail', slipOver30s: slipCtl.slipOver30s, fired: slipCtl.slipOver30s > 2 } },
        yawStep: { ...yaw, gate: 'overshoot <= 10 %', pass: yaw.overshootPct <= 10, control: { name: 'J_r = 0 must fail', overshootPct: yawCtl.overshootPct, fired: yawCtl.overshootPct > 10 } },
        topSpeed: { ...top, gate: '85-110 km/h', pass: top.kmh >= 85 && top.kmh <= 110, control: { name: 'CdA x 0.3 must leave the band', kmh: topCtl.kmh, fired: topCtl.kmh > 110 } },
        terminalVelocityUnchanged: {
            withDuctDrag: term.measured, withoutDuctDrag: termNoDuct.measured, analytic: term.expected, gate: 'within 0.5 % of k = 0 and of sqrt(2 m g / (rho CdA))',
            pass: termRel(term.measured, termNoDuct.measured) <= 0.005 && termRel(term.measured, term.expected) <= 0.005,
            control: { name: 'a 2 % larger CdA must move it by more than 0.5 %', measured: termCda.measured, fired: termRel(termCda.measured, term.measured) > 0.005 }
        },
        hoverThrottle: { note: 'reported, not gated: no 3S hover figure is published', 'pavo20pro-3s': hoverFigures('pavo20pro-3s'), 'pavo20pro2-3s': hoverFigures('pavo20pro2-3s') }
    };
    const h5 = [checks.coastDown, checks.sideslip, checks.yawStep, checks.topSpeed, checks.terminalVelocityUnchanged];
    const pass =
        hover.pass && checks.hover.control.fired && checks.fullStick.pass && tau.pass && checks.motorTau.control.fired &&
        air.pass && step.pass && checks.pidStep.control.fired && moonIdeal.pass && L.pass && term.pass && checks.terminalVelocity.control.fired &&
        h5.every((c) => c.pass && c.control.fired);
    return { pass, checks };
}

/** Before (v0.2) and after (this tree) for both Pavo20 presets, with the research targets. */
export function feelReport(): Record<string, unknown> {
    return { simCore: SIM_CORE_VERSION, targets: TARGETS, before: V02, after: { 'pavo20pro-3s': feel('pavo20pro-3s'), 'pavo20pro2-3s': feel('pavo20pro2-3s') } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const t0 = Date.now();
    const a4 = runA4();
    const file = writeEvidence('v03-a4-physics', { ...a4, feel: feelReport(), runtimeMs: Date.now() - t0 });
    console.log('A4', a4.pass ? 'PASS' : 'FAIL', '->', file);
    if (!a4.pass) process.exitCode = 1;
}
