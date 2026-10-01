// Estimate the simulator's flight-model parameters from a Betaflight blackbox log (design H.4).
//
// What each estimate needs, and the model it fits (least squares, our own formulation):
// - rates as flown: the header's rate settings, checked against the logged setpoint vs sticks;
// - hover: 0.25 s windows with the accelerometer at 1 g straight up and still gyros give the hover
//   motor output w_h; the simulator's thrust is Tmax (V/Vnom)^2 w^2, so its TWR that reproduces the
//   hover is a_z (Vnom/V)^2 / w^2 per window;
// - thrust curve (no hover needed): body-z specific force against mean(w^2) (V/Vref)^2 over slow
//   flight, slope = the simulator TWR; and against sum(rpm^2), slope = k_T / (m g);
// - motor lag (needs bidirectional DShot rpm): per motor d(omega) = (dt/tau) (f(w V) - omega) with f
//   quadratic and the command delayed 0..6 samples (the best delay wins);
// - yaw (needs rpm): yaw acceleration = a sum(s_i omega_i^2) + b sum(s_i d(omega_i)/dt) - c r + d,
//   a = kappa k_T / I_z (drag torque), b = J_r / I_z (rotor inertia), c = yaw damping;
// - roll and pitch authority (needs rpm): angular acceleration = a sum(m_i omega_i^2) - c p + d, a = arm k_T / I;
// - duct / rotor drag: in-plane specific force = -(k omega/omega_h + c |v|) v_perp, the simulator's
//   model. Coast-downs (sticks centred, near level): v = v0 + integral of the measured acceleration,
//   with v0 unknown per coast, so no stop and no GPS is needed; the decay's shape gives k and c.
//   With GPS: steady cruise, velocity along the heading at the GPS ground speed.
// Uncertainties: delete-one-block jackknife over 8 contiguous blocks of the data (or over the coasts),
// not the OLS formula, which is far too optimistic for 1 kHz samples.

import { compileParams, hoverSolve, maxRate, setpointRate } from '@gsfpv/sim-core';
import type { PresetJson, RatesConfig, SimParams } from '@gsfpv/sim-core';
import { estimateAttitude, type Attitude } from './imu';
import { blocks, derivative, lowpass, median, ols, percentile } from './math';
import { GRAVITY, type Signals } from './signals';

export type Confidence = 'high' | 'medium' | 'low';

export interface Estimate {
    value: number;
    /** standard error (jackknife over blocks of time or over coasts) */
    se: number;
    unit: string;
    confidence: Confidence;
    /** samples (or windows, coasts) behind it */
    n: number;
    basis: string;
}

export interface FitOptions {
    /** the simulator preset to compare with and to express the results in */
    preset?: PresetJson;
    /** all-up weight with the battery, grams (kitchen scale); unlocks the mass-dependent numbers */
    massG?: number;
    /** date for the source tag; defaults to the log start date */
    date?: string;
}

export interface PresetField {
    field: string;
    now: unknown;
    proposed: unknown;
    source: string;
    confidence: Confidence;
    note: string;
}

export interface FitReport {
    log: {
        firmware: string;
        craft: string;
        date: string | null;
        durationS: number;
        flyingS: number;
        sampleHz: number;
        hasRpm: boolean;
        hasAcc: boolean;
        hasGps: boolean;
        /** our gated attitude estimate; its RMS difference to the flight controller's, when logged */
        attitude: 'none' | 'estimated' | { fcDiffDeg: { roll: number; pitch: number } };
    };
    estimates: Record<string, Estimate>;
    rates: { config: RatesConfig; maxDegS: { roll: number; pitch: number; yaw: number }; setpointErrDegS: number[] | null; stickP995: number[] | null; note: string } | null;
    notIdentified: { what: string; why: string }[];
    preset: { id: string; fields: PresetField[] } | null;
}

const MIX_ROLL = [-1, -1, 1, 1]; // M1 rear-right, M2 front-right, M3 rear-left, M4 front-left
const MIX_PITCH = [1, -1, 1, -1];
const MIX_YAW = [1, -1, -1, 1]; // + = CW prop (props-in default), whose reaction turns the nose left (+ yaw)
const BLOCKS = 8;
const RHO = 1.225;

function confidenceOf(value: number, se: number, k: number): Confidence {
    if (!Number.isFinite(se) || !Number.isFinite(value) || k < 3) return 'low';
    const rel = se / Math.abs(value);
    return rel < 0.1 ? 'high' : rel < 0.25 ? 'medium' : 'low';
}

/**
 * Delete-one-group jackknife: the full-data estimate, and its standard error from the estimates
 * with one group left out each time. `fit` returns one or more numbers (NaN when it cannot fit).
 */
function jackknife(groups: number[][], fit: (sel: number[]) => number[] | null): { value: number[]; se: number[]; k: number } | null {
    const full = fit(groups.flat());
    if (!full) return null;
    const loo: number[][] = [];
    for (let i = 0; i < groups.length; i++) {
        const v = fit(groups.filter((_, j) => j !== i).flat());
        if (v && v.every(Number.isFinite)) loo.push(v);
    }
    const k = loo.length;
    const se = full.map((_, c) => {
        if (k < 3) return Infinity;
        const m = loo.reduce((s, v) => s + v[c], 0) / k;
        return Math.sqrt(((k - 1) / k) * loo.reduce((s, v) => s + (v[c] - m) ** 2, 0));
    });
    return { value: full, se, k };
}

function estimate(j: { value: number[]; se: number[]; k: number }, c: number, unit: string, n: number, basis: string, scale = 1): Estimate {
    const value = j.value[c] * scale;
    const se = j.se[c] * Math.abs(scale);
    return { value, se, unit, confidence: confidenceOf(value, se, j.k), n, basis };
}

/** Flying: motors clearly above idle; the first and last 0.3 s of each stretch are dropped. */
function flyingMask(sig: Signals): Uint8Array {
    const n = sig.n;
    const m = new Uint8Array(n);
    if (!sig.motor) return m;
    for (let k = 0; k < n; k++) m[k] = meanMotor(sig, k) > 0.08 && (!sig.stick || sig.stick[3][k] > 0.01) ? 1 : 0;
    const edge = Math.max(1, Math.round(0.3 / sig.dt));
    const out = new Uint8Array(n);
    let runStart = -1;
    for (let k = 0; k <= n; k++) {
        if (k < n && m[k]) {
            if (runStart < 0) runStart = k;
        } else if (runStart >= 0) {
            for (let j = runStart + edge; j < k - edge; j++) out[j] = 1;
            runStart = -1;
        }
    }
    return out;
}

function meanMotor(sig: Signals, k: number): number {
    let s = 0;
    for (const mo of sig.motor!) s += mo[k];
    return s / sig.motor!.length;
}

function sumRpm2(sig: Signals, k: number): number {
    let s = 0;
    for (const r of sig.rpm!) s += r[k] * r[k];
    return s;
}

function meanRpm(sig: Signals, k: number): number {
    let s = 0;
    for (const r of sig.rpm!) s += r[k];
    return s / sig.rpm!.length;
}

export function fitLog(sig: Signals, opt: FitOptions = {}): FitReport {
    const notIdentified: FitReport['notIdentified'] = [];
    const estimates: Record<string, Estimate> = {};
    const fly = flyingMask(sig);
    const flyIdx: number[] = [];
    for (let k = 0; k < sig.n; k++) if (fly[k]) flyIdx.push(k);
    const fs = 1 / sig.dt;
    const sp: SimParams | null = opt.preset ? compileParams(opt.preset) : null;
    const massKg = opt.massG ? opt.massG / 1000 : null;
    const nMotors = sig.motor?.length ?? 0;
    const volts = sig.vbat ? lowpass(sig.vbat, fs, 2) : null;
    const flyV = volts ? median(flyIdx.filter((_, i) => i % 10 === 0).map((k) => volts[k])) : NaN;
    // voltage all thrust numbers are expressed at: the preset's loaded full-pack voltage, else the log's median
    const vRef = sp ? sp.vNom : Number.isFinite(flyV) ? flyV : 1;
    const vRefNote = sp ? `the preset's Vnom ${vRef.toFixed(2)} V` : Number.isFinite(flyV) ? `the median flight voltage ${vRef.toFixed(2)} V` : 'no voltage in the log';

    // ---------------------------------------------------------------- rates as flown
    let rates: FitReport['rates'] = null;
    if (sig.config.rates) {
        const rc = sig.config.rates;
        let err: number[] | null = null;
        let use: number[] | null = null;
        if (sig.stick) {
            use = [0, 1, 2].map((i) => percentile(flyIdx.map((k) => Math.abs(sig.stick![i][k])), 0.995));
            if (sig.setpoint) {
                const axes = ['roll', 'pitch', 'yaw'] as const;
                err = [0, 1, 2].map((i) => median(flyIdx.map((k) => Math.abs(setpointRate(rc.type, sig.stick![i][k], rc[axes[i]], rc.rateLimit) - sig.setpoint![i][k]))));
            }
        }
        rates = {
            config: rc,
            maxDegS: { roll: maxRate(rc, 'roll'), pitch: maxRate(rc, 'pitch'), yaw: maxRate(rc, 'yaw') },
            setpointErrDegS: err,
            stickP995: use,
            note: sig.config.ratesNote + (err ? '; the logged setpoints follow these curves (median error per axis in deg/s)' : '; no setpoint field to check them against')
        };
    } else notIdentified.push({ what: 'rates', why: sig.config.ratesNote });

    // ---------------------------------------------------------------- hover and thrust
    let hoverW = NaN; // motor output that hovers at hoverV
    let hoverV = NaN;
    let hoverSumRpm2 = NaN; // sum of rpm^2 over the motors that holds 1 g
    if (!sig.motor || !sig.acc) {
        notIdentified.push({ what: 'hover throttle, TWR', why: sig.motor ? 'no accelerometer in the log (acc off or fields disabled)' : 'no motor[] fields in the log' });
    } else {
        const acc = sig.acc;
        const win = Math.max(8, Math.round(0.25 / sig.dt));
        const wins: { w: number; thr: number; v: number; r2: number; az: number }[] = [];
        for (let s = 0; s + win <= sig.n; s += win) {
            let ok = true;
            let sw = 0, sw2 = 0, sthr = 0, sv = 0, sr2 = 0, saz = 0;
            for (let k = s; k < s + win && ok; k++) {
                const g2 = sig.gyro[0][k] ** 2 + sig.gyro[1][k] ** 2 + sig.gyro[2][k] ** 2;
                if (!fly[k] || acc[2][k] < 0.97 || acc[2][k] > 1.03 || acc[0][k] ** 2 + acc[1][k] ** 2 > 0.05 * 0.05 || g2 > 0.2 * 0.2) ok = false;
                const w = meanMotor(sig, k);
                sw += w;
                sw2 += w * w;
                saz += acc[2][k];
                sthr += sig.stick ? sig.stick[3][k] : NaN;
                sv += volts ? volts[k] : NaN;
                sr2 += sig.rpm ? sumRpm2(sig, k) : NaN;
            }
            const mw = sw / win;
            if (ok && sw2 / win - mw * mw < 0.015 * 0.015) wins.push({ w: mw, thr: sthr / win, v: sv / win, r2: sr2 / win, az: saz / win });
        }
        const hoverS = wins.length * win * sig.dt;
        if (hoverS >= 2) {
            const groups = blocks(wins.map((_, i) => i), Math.min(BLOCKS, wins.length));
            const med = (f: (x: (typeof wins)[number]) => number) => (sel: number[]) => [median(sel.map((i) => f(wins[i])))];
            const basis = `${wins.length} still-hover windows of 0.25 s`;
            const jw = jackknife(groups, med((x) => x.w));
            if (jw) {
                estimates.hoverMotor = estimate(jw, 0, 'fraction', wins.length, basis);
                hoverW = jw.value[0];
            }
            if (sig.stick) {
                const jt = jackknife(groups, med((x) => x.thr));
                if (jt) estimates.hoverThrottle = estimate(jt, 0, '%', wins.length, 'throttle stick after the curve (the OSD throttle)', 100);
            }
            if (volts) {
                hoverV = median(wins.map((x) => x.v));
                const jv = jackknife(groups, med((x) => x.v));
                if (jv) estimates.hoverVolts = estimate(jv, 0, 'V', wins.length, 'pack voltage while hovering');
            }
            // per window: a_z = TWR (V/vRef)^2 w^2 in the simulator's thrust model
            const jtw = jackknife(groups, med((x) => (x.az * (volts ? (vRef / x.v) ** 2 : 1)) / (x.w * x.w)));
            if (jtw) estimates.twrHoverMatched = estimate(jtw, 0, 'ratio', wins.length, `still hover in the simulator's thrust model Tmax (V/Vnom)^2 w^2, at ${vRefNote}`);
            if (sig.rpm) hoverSumRpm2 = median(wins.map((x) => x.r2 / x.az));
        }
        const tc = thrustCurve(sig, fly, volts, vRef, vRefNote);
        if (tc) {
            estimates.twrThrustFit = tc.twr;
            if (tc.kTperMg) estimates.thrustPerRpm2 = tc.kTperMg;
            if (!Number.isFinite(hoverW) && Number.isFinite(flyV)) {
                hoverV = flyV;
                hoverW = vRef / hoverV / Math.sqrt(tc.twr.value);
                estimates.hoverMotor = { ...tc.twr, value: hoverW, se: (0.5 * hoverW * tc.twr.se) / tc.twr.value, unit: 'fraction', basis: `from the thrust fit at the median flight voltage ${hoverV.toFixed(2)} V (no still hover in the log)` };
            }
            if (!Number.isFinite(hoverSumRpm2) && tc.kTperMg) hoverSumRpm2 = 1 / tc.kTperMg.value;
        }
        if (hoverS < 2) {
            notIdentified.push({
                what: 'hover throttle stick %',
                why: `only ${hoverS.toFixed(1)} s of still hover in the log (needs 2 s: hold a still hover for 10 s)${tc ? '; the hover motor output and TWR come from the thrust fit instead' : ''}`
            });
            if (!tc) notIdentified.push({ what: 'TWR', why: 'no still hover and too little slow flight for the thrust fit' });
        }
        // Full-throttle rpm, when the pilot punched out: thrust ~ rpm^2 gives the real TWR.
        if (sig.rpm && Number.isFinite(hoverSumRpm2)) {
            const full: number[] = [];
            for (const k of flyIdx) if (sig.motor.every((m) => m[k] > 0.97)) full.push(sumRpm2(sig, k) * (volts ? (vRef / volts[k]) ** 2 : 1));
            if (full.length * sig.dt >= 0.3) {
                estimates.twrFromRpm = { value: percentile(full, 0.9) / hoverSumRpm2, se: NaN, unit: 'ratio', confidence: 'medium', n: full.length, basis: `sum(rpm^2) at full throttle (${(full.length * sig.dt).toFixed(2)} s, scaled to ${vRefNote}) / at hover` };
            } else notIdentified.push({ what: 'TWR from rpm', why: 'no full-throttle punch-out long enough (0.3 s with all motors above 97 %)' });
        }
    }

    // ---------------------------------------------------------------- motor lag
    if (!sig.rpm || !sig.motor) {
        notIdentified.push({ what: 'motor lag tau', why: 'needs bidirectional DShot rpm (eRPM[] fields; dshot_bidir = ON)' });
    } else {
        const idx = flyIdx.filter((k) => k > 8 && k < sig.n - 1 && sig.t[k + 1] - sig.t[k] < 1.5 * sig.dt);
        const rpmMed = median(idx.filter((_, i) => i % 10 === 0).map((k) => meanRpm(sig, k)));
        // The same zero-phase 40 Hz low-pass on the rpm and on the command: it leaves a first-order
        // lag between them unchanged but removes the telemetry noise that would bias the fit.
        const omF = sig.rpm.map((r) => lowpass(r, fs, 40));
        // (u and u^2 are filtered separately: the filter commutes with the linear lag, not with the square)
        const uF = sig.motor.map((m) => lowpass(Float64Array.from(m, (x, k) => x * (volts ? volts[k] : 1)), fs, 40));
        const u2F = sig.motor.map((m) => lowpass(Float64Array.from(m, (x, k) => (x * (volts ? volts[k] : 1)) ** 2), fs, 40));
        const lagFit = (i: number, d: number) => (sel: number[]) => {
            const om = omF[i];
            const uu = uF[i];
            const uu2 = u2F[i];
            const r = ols(sel, 4, (k, x) => {
                x[0] = om[k];
                x[1] = uu[k - d];
                x[2] = uu2[k - d];
                x[3] = 1;
                return om[k + 1] - om[k];
            });
            return r && r.beta[0] < 0 ? { tau: -sig.dt / r.beta[0], r2: r.r2 } : null;
        };
        const delays: number[] = [];
        for (let i = 0; i < nMotors; i++) {
            let best = { d: 0, r2: -Infinity };
            for (let d = 0; d <= 6; d++) {
                const r = lagFit(i, d)(idx);
                if (r && r.r2 > best.r2) best = { d, r2: r.r2 };
            }
            delays.push(best.d);
        }
        const meanTau = (sel: number[]) => {
            const t = delays.map((d, i) => lagFit(i, d)(sel)?.tau ?? NaN);
            return t.every(Number.isFinite) ? [t.reduce((a, b) => a + b, 0) / t.length] : null;
        };
        const j = jackknife(blocks(idx, BLOCKS), meanTau);
        if (j) {
            const d = median(delays);
            estimates.motorTau = estimate(j, 0, 'ms', idx.length, `first-order lag from motor command to rpm, mean of ${nMotors} motors; command-to-telemetry delay ${d} samples (${(d * sig.dt * 1000).toFixed(1)} ms) on top`, 1000);
            const lo = meanTau(idx.filter((k) => meanRpm(sig, k) < rpmMed));
            const hi = meanTau(idx.filter((k) => meanRpm(sig, k) >= rpmMed));
            if (lo) estimates.motorTauLowRpm = { value: lo[0] * 1000, se: NaN, unit: 'ms', confidence: estimates.motorTau.confidence, n: idx.length, basis: 'below the median rpm' };
            if (hi) estimates.motorTauHighRpm = { value: hi[0] * 1000, se: NaN, unit: 'ms', confidence: estimates.motorTau.confidence, n: idx.length, basis: 'above the median rpm' };
        }
    }

    // ---------------------------------------------------------------- yaw and roll/pitch authority
    if (!sig.rpm || nMotors !== 4) {
        notIdentified.push({ what: 'rotor inertia, yaw torque, roll/pitch authority', why: sig.rpm ? 'the fit assumes a quad X (4 motors)' : 'needs bidirectional DShot rpm (eRPM[] fields)' });
    } else {
        const fc = 25;
        const om = sig.rpm.map((r) => lowpass(r, fs, fc));
        const omDot = om.map((r) => derivative(r, sig.t));
        const g = sig.gyro.map((x) => lowpass(x, fs, fc));
        const gDot = g.map((x) => derivative(x, sig.t));
        const idx = flyIdx.filter((k) => k > 2 && k < sig.n - 2);
        const groups = blocks(idx, BLOCKS);
        const sumSq = (pat: number[], k: number) => pat[0] * om[0][k] ** 2 + pat[1] * om[1][k] ** 2 + pat[2] * om[2][k] ** 2 + pat[3] * om[3][k] ** 2;
        const sumDot = (pat: number[], k: number) => pat[0] * omDot[0][k] + pat[1] * omDot[1][k] + pat[2] * omDot[2][k] + pat[3] * omDot[3][k];
        const yawFit = (sign: number) => (sel: number[]) => {
            const r = ols(sel, 4, (k, x) => {
                x[0] = sign * sumSq(MIX_YAW, k);
                x[1] = sign * sumDot(MIX_YAW, k);
                x[2] = g[2][k];
                x[3] = 1;
                return gDot[2][k];
            });
            return r ? [r.beta[0], r.beta[1], -r.beta[2], r.r2] : null;
        };
        const all = yawFit(1)(idx);
        const sign = all && all[0] < 0 ? -1 : 1; // props-out (yaw_motors_reversed) flips the pattern
        const jy = jackknife(groups, yawFit(sign));
        if (jy) {
            const r2 = jy.value[3].toFixed(2);
            estimates.yawDragPerRpm2 = estimate(jy, 0, '1/rad', idx.length, `yaw drag torque per rpm^2 (kappa k_T / I_z); R^2 ${r2}${sign < 0 ? '; props-out rotation' : ''}`);
            estimates.yawDamping = estimate(jy, 2, '1/s', idx.length, 'yaw rate damping');
            const eb = estimate(jy, 1, 'ratio', idx.length, 'rotor inertia / yaw inertia (J_r / I_z) from the yaw kick of rotor acceleration');
            if (eb.value > 0 && eb.confidence !== 'low') estimates.rotorInertiaRatio = eb;
            else notIdentified.push({ what: 'rotor inertia', why: `J_r/I_z = ${eb.value.toExponential(2)} +- ${eb.se.toExponential(1)}: not distinguishable from 0 (fly sharp yaw flicks, H.4 step D)` });
        }
        for (const [name, pat, axis] of [['roll', MIX_ROLL, 0], ['pitch', MIX_PITCH, 1]] as const) {
            const j = jackknife(groups, (sel) => {
                const r = ols(sel, 3, (k, x) => {
                    x[0] = sumSq(pat, k);
                    x[1] = g[axis][k];
                    x[2] = 1;
                    return gDot[axis][k];
                });
                return r ? [r.beta[0]] : null;
            });
            if (j) estimates[`${name}AuthorityPerRpm2`] = estimate(j, 0, '1/rad', idx.length, `${name} acceleration per differential rpm^2 (arm k_T / I)`);
        }
    }

    // ---------------------------------------------------------------- drag
    let att: Attitude | null = null;
    if (sig.acc) att = estimateAttitude(sig);
    if (!sig.acc || !sig.motor) notIdentified.push({ what: 'duct / rotor drag, CdA', why: 'needs the accelerometer and motor outputs' });
    else {
        // body drag of the preset, as the simulator applies it: 0.5 rho CdA |v| v / m
        const cFixed = sp ? (0.5 * sp.rho * sp.cda[0]) / (massKg ?? sp.mass) : null;
        const drag = fitDrag(sig, att!, fly, volts, hoverW, hoverV, hoverSumRpm2, cFixed);
        if (drag.k) estimates.ductDrag = drag.k;
        if (drag.jointK) estimates.ductDragJoint = drag.jointK;
        if (drag.c) {
            estimates.quadDragPerM = drag.c;
            if (massKg) {
                const c = drag.c;
                estimates.cdaHorizontal = { ...c, value: ((2 * massKg * c.value) / RHO) * 1e4, se: ((2 * massKg * c.se) / RHO) * 1e4, unit: 'cm^2', basis: `${c.basis}; CdA = 2 m c / rho with m = ${opt.massG} g` };
            }
        }
        for (const w of drag.why) notIdentified.push(w);
    }

    // ---------------------------------------------------------------- express in the preset
    const preset = opt.preset ? presetDiff(opt, sig, sp!, estimates, rates, hoverSumRpm2, massKg, notIdentified) : null;
    let flyingS = 0;
    for (let k = 1; k < sig.n; k++) if (fly[k]) flyingS += Math.min(sig.t[k] - sig.t[k - 1], 0.02);
    return {
        log: {
            firmware: sig.config.firmware,
            craft: sig.config.craft,
            date: sig.config.date,
            durationS: sig.n ? sig.t[sig.n - 1] : 0,
            flyingS,
            sampleHz: Math.round(fs),
            hasRpm: !!sig.rpm,
            hasAcc: !!sig.acc,
            hasGps: !!sig.gps,
            attitude: !att ? 'none' : att.fcDiffDeg ? { fcDiffDeg: att.fcDiffDeg } : 'estimated'
        },
        estimates,
        rates,
        notIdentified,
        preset
    };
}

interface ThrustCurve {
    /** simulator TWR at vRef: body-z specific force (g) = TWR mean(w_i^2) (V / vRef)^2 */
    twr: Estimate;
    /** k_T / (m g): 1 / (sum of rpm^2 that holds 1 g) */
    kTperMg: Estimate | null;
}

function thrustCurve(sig: Signals, fly: Uint8Array, volts: Float64Array | null, vRef: number, vRefNote: string): ThrustCurve | null {
    if (!sig.acc || !sig.motor) return null;
    const fs = 1 / sig.dt;
    const n = sig.n;
    const w2 = new Float64Array(n);
    const r2 = sig.rpm ? new Float64Array(n) : null;
    for (let k = 0; k < n; k++) {
        let s = 0;
        for (const m of sig.motor) s += m[k] * m[k];
        const v = volts ? volts[k] / vRef : 1;
        w2[k] = (s / sig.motor.length) * v * v;
        if (r2) r2[k] = sumRpm2(sig, k);
    }
    // 5 Hz on everything, so the accelerometer's own filter and the motor lag do not bias the slope
    const az = lowpass(sig.acc[2], fs, 5);
    const axy = lowpass(Float64Array.from(sig.acc[0], (x, k) => Math.hypot(x, sig.acc![1][k])), fs, 5);
    const w2f = lowpass(w2, fs, 5);
    const r2f = r2 ? lowpass(r2, fs, 5) : null;
    const idx: number[] = [];
    for (let k = 0; k < n; k++) {
        if (!fly[k] || axy[k] > 0.25) continue;
        if (Math.hypot(sig.gyro[0][k], sig.gyro[1][k], sig.gyro[2][k]) > 3.5) continue;
        if (!sig.motor.every((m) => m[k] > 0.1 && m[k] < 0.95)) continue;
        idx.push(k);
    }
    if (idx.length * sig.dt < 5) return null;
    const groups = blocks(idx, BLOCKS);
    const jt = jackknife(groups, (sel) => {
        const a = ols(sel, 1, (k, x) => ((x[0] = w2f[k]), az[k]));
        return a ? [a.beta[0]] : null;
    });
    if (!jt) return null;
    const twr = estimate(jt, 0, 'ratio', idx.length, `thrust fit over ${(idx.length * sig.dt).toFixed(0)} s of slow flight in the simulator's thrust model, at ${vRefNote}`);
    let kTperMg: Estimate | null = null;
    if (r2f) {
        const jk = jackknife(groups, (sel) => {
            const a = ols(sel, 1, (k, x) => ((x[0] = r2f[k]), az[k]));
            return a ? [a.beta[0]] : null;
        });
        if (jk) kTperMg = estimate(jk, 0, '1/(rad/s)^2', idx.length, 'thrust per summed rpm^2 over the weight, k_T / (m g)');
    }
    return { twr, kTperMg };
}

interface DragFit {
    k: Estimate | null;
    c: Estimate | null;
    /** the rotor drag of the joint fit, when k itself was fitted with the body drag held */
    jointK?: Estimate | null;
    why: { what: string; why: string }[];
}

interface Coast {
    /** sample indices */
    idx: number[];
    /** integral of the earth-frame acceleration from the start, 3 per sample (x, y, z) */
    I: Float64Array;
    /** first two rows of R^T per sample (earth -> body x, y), 6 per sample */
    P: Float64Array;
    /** body in-plane specific force, m/s^2, 2 per sample */
    f: Float64Array;
    /** rotor-speed scale omega / omega_hover per sample */
    s: Float64Array;
    /** true: I starts from a still hover before the coast, so it is the velocity itself */
    anchored: boolean;
    /** seconds since the start of the integration (the anchor, or the coast start) */
    tau: Float64Array;
}

/**
 * Drag from the in-plane specific force f = -(k s + c |v|) v_perp.
 * Coasts: v(t) = v0 + I(t) with v0 unknown per coast, solved by alternating least squares
 * (v0 given k, c; then k, c given v0). GPS cruise: v known, one least-squares fit.
 */
function fitDrag(sig: Signals, att: Attitude, fly: Uint8Array, volts: Float64Array | null, hoverW: number, hoverV: number, hoverSumRpm2: number, cFixedBody: number | null): DragFit {
    const why: DragFit['why'] = [];
    let jointK: Estimate | null = null;
    const n = sig.n;
    const acc = sig.acc!;
    const R = att.R;
    // rotor-speed scale of the linear term: omega / omega_hover (or w V / (w_h V_h) without rpm)
    const scale = (k: number) => {
        if (sig.rpm && Number.isFinite(hoverSumRpm2)) return Math.sqrt(sumRpm2(sig, k) / hoverSumRpm2);
        const v = volts && Number.isFinite(hoverV) ? volts[k] / hoverV : 1;
        return Number.isFinite(hoverW) ? (meanMotor(sig, k) * v) / hoverW : NaN;
    };
    if (!Number.isFinite(scale(flyIdxMid(fly)))) {
        why.push({ what: 'duct / rotor drag', why: 'no hover reference (the drag rate is defined at hover rotor speed): hold a still hover first' });
        return { k: null, c: null, why };
    }

    // ---- coasts: sticks centred and near level for >= 1.5 s after a push.
    // The velocity is the integral of the earth-frame acceleration. It starts from zero at the last
    // still moment within 8 s before the coast (the H.4 script hovers still before each push); when
    // there is none, the start speed is fitted (only possible when the coast visibly slows down).
    const coasts: Coast[] = [];
    const earthAcc = (j: number, out: number[]) => {
        const o = j * 9;
        const ax = acc[0][j] * GRAVITY, ay = acc[1][j] * GRAVITY, az = acc[2][j] * GRAVITY;
        out[0] = R[o] * ax + R[o + 1] * ay + R[o + 2] * az;
        out[1] = R[o + 3] * ax + R[o + 4] * ay + R[o + 5] * az;
        out[2] = R[o + 6] * ax + R[o + 7] * ay + R[o + 8] * az - GRAVITY;
    };
    if (sig.stick) {
        const quiet = (k: number) => fly[k] && Math.abs(sig.stick![0][k]) < 0.05 && Math.abs(sig.stick![1][k]) < 0.05 && Math.abs(sig.stick![2][k]) < 0.05 && Math.abs(att.roll[k]) < 0.5 && Math.abs(att.pitch[k]) < 0.5;
        const minLen = Math.round(1.5 / sig.dt);
        const maxLen = Math.round(6 / sig.dt);
        const look = Math.round(8 / sig.dt);
        const a0 = [0, 0, 0], a1 = [0, 0, 0];
        let k = 0;
        while (k < n) {
            if (!quiet(k)) {
                k++;
                continue;
            }
            let e = k;
            while (e < n && quiet(e)) e++;
            if (e - k >= minLen) {
                // the anchor: the last still sample (0.5 s of gravity alone) before the coast
                let anchor = -1;
                for (let j = k; j >= Math.max(1, k - look); j--) {
                    if (att.still[j]) {
                        anchor = j;
                        break;
                    }
                }
                const start = anchor >= 0 ? anchor : k;
                const end = Math.min(e, k + maxLen);
                const m = end - k;
                const I = new Float64Array(m * 3);
                const P = new Float64Array(m * 6);
                const f = new Float64Array(m * 2);
                const s = new Float64Array(m);
                let ix = 0, iy = 0, iz = 0;
                for (let j = start + 1; j < end; j++) {
                    // trapezoid on the earth-frame acceleration
                    const dt = sig.t[j] - sig.t[j - 1];
                    earthAcc(j - 1, a0);
                    earthAcc(j, a1);
                    ix += 0.5 * (a0[0] + a1[0]) * dt;
                    iy += 0.5 * (a0[1] + a1[1]) * dt;
                    iz += 0.5 * (a0[2] + a1[2]) * dt;
                    if (j < k) continue;
                    const q = j - k;
                    I[q * 3] = ix;
                    I[q * 3 + 1] = iy;
                    I[q * 3 + 2] = iz;
                }
                for (let q = 0; q < m; q++) {
                    const j = k + q;
                    const o = j * 9;
                    // body x, y axes in the earth frame = columns 0, 1 of R
                    P[q * 6] = R[o]; P[q * 6 + 1] = R[o + 3]; P[q * 6 + 2] = R[o + 6];
                    P[q * 6 + 3] = R[o + 1]; P[q * 6 + 4] = R[o + 4]; P[q * 6 + 5] = R[o + 7];
                    f[q * 2] = acc[0][j] * GRAVITY;
                    f[q * 2 + 1] = acc[1][j] * GRAVITY;
                    s[q] = scale(j);
                }
                if (anchor < 0) {
                    // without an anchor I starts at 0 at the coast start: shift the first sample's value in
                    const ox = I[0], oy = I[1], oz = I[2];
                    for (let q = 0; q < m; q++) {
                        I[q * 3] -= ox;
                        I[q * 3 + 1] -= oy;
                        I[q * 3 + 2] -= oz;
                    }
                }
                const tau = new Float64Array(m);
                for (let q = 0; q < m; q++) tau[q] = sig.t[k + q] - sig.t[start];
                const speed0 = Math.hypot(I[0], I[1]);
                const change = Math.hypot(I[(m - 1) * 3] - I[0], I[(m - 1) * 3 + 1] - I[1]);
                if (anchor >= 0 ? speed0 >= 1.5 : change >= 1) coasts.push({ idx: Array.from({ length: m }, (_, q) => k + q), I, P, f, s, anchored: anchor >= 0, tau });
            }
            k = e;
        }
    }

    /**
     * k, c by alternating least squares. Per coast, the velocity is v(t) = I(t) + A(t) u with u
     * unknown: anchored coasts u = e (a constant acceleration error: accelerometer bias or a small
     * attitude error, v = I + e (t - t_anchor)); free coasts u = (v0, e).
     */
    const fitCoastSet = (cs: Coast[], cFixed?: number): number[] | null => {
        if (!cs.length) return null;
        let k = 0.3;
        let c = cFixed ?? 0.01;
        const u = cs.map((co) => new Array<number>(co.anchored ? 0 : 3).fill(0));
        const vel = (co: Coast, uq: number[], t: number, out: number[]) => {
            out[0] = co.I[t * 3] + (co.anchored ? 0 : uq[0]);
            out[1] = co.I[t * 3 + 1] + (co.anchored ? 0 : uq[1]);
            out[2] = co.I[t * 3 + 2] + (co.anchored ? 0 : uq[2]);
        };
        const rows: [number, number][] = [];
        cs.forEach((co, q) => {
            for (let t = 0; t < co.idx.length; t++) rows.push([q, t]);
        });
        const v = [0, 0, 0];
        for (let iter = 0; iter < 40; iter++) {
            // u per coast given k, c: f = -g P (I + A u), g = k s + c |v| (|v| from the last iterate)
            for (let q = 0; q < cs.length; q++) {
                const co = cs[q];
                const p = u[q].length;
                if (p === 0) continue;
                const r = ols(
                    Array.from({ length: 2 * co.idx.length }, (_, i) => i),
                    p,
                    (i, x) => {
                        const t = i >> 1;
                        const ax = i & 1;
                        vel(co, u[q], t, v);
                        const g = k * co.s[t] + c * Math.hypot(v[0], v[1], v[2]);
                        const o = t * 6 + ax * 3;
                        const pv = [co.P[o], co.P[o + 1], co.P[o + 2]];
                        for (let d = 0; d < 3; d++) x[d] = -g * pv[d];
                        return co.f[t * 2 + ax] + g * (pv[0] * co.I[t * 3] + pv[1] * co.I[t * 3 + 1] + pv[2] * co.I[t * 3 + 2]);
                    }
                );
                if (r) u[q] = r.beta;
            }
            // k, c given u (or k alone, with c fixed)
            const r = ols(
                Array.from({ length: rows.length * 2 }, (_, i) => i),
                cFixed === undefined ? 2 : 1,
                (i, x) => {
                    const [q, t] = rows[i >> 1];
                    const co = cs[q];
                    const ax = i & 1;
                    vel(co, u[q], t, v);
                    const o = t * 6 + ax * 3;
                    const vb = co.P[o] * v[0] + co.P[o + 1] * v[1] + co.P[o + 2] * v[2];
                    const sp = Math.hypot(v[0], v[1], v[2]);
                    x[0] = -co.s[t] * vb;
                    if (cFixed === undefined) x[1] = -sp * vb;
                    return co.f[t * 2 + ax] + (cFixed === undefined ? 0 : cFixed * sp * vb);
                }
            );
            if (!r) return null;
            const nc = cFixed ?? r.beta[1];
            const moved = Math.abs(r.beta[0] - k) + 10 * Math.abs(nc - c);
            k = r.beta[0];
            c = nc;
            if (moved < 1e-7) break;
        }
        // a free coast's start speed is only determined if it slowed down clearly (end < 60 % of start)
        const ratios = cs
            .map((co, q) => {
                if (co.anchored) return NaN;
                const m = co.idx.length - 1;
                vel(co, u[q], 0, v);
                const s0 = Math.hypot(v[0], v[1]);
                vel(co, u[q], m, v);
                return Math.hypot(v[0], v[1]) / s0;
            })
            .filter(Number.isFinite);
        return ratios.length && median(ratios) >= 0.6 ? [NaN, NaN] : [k, c];
    };

    let kE: Estimate | null = null;
    let cE: Estimate | null = null;
    let coastProblem = '';
    if (coasts.length >= 2) {
        const nA = coasts.filter((c) => c.anchored).length;
        const basis = `${coasts.length} coast-downs (${nA} integrated from a still hover before the push, ${coasts.length - nA} with the start speed fitted)`;
        const groups = coasts.map((_, i) => [i]);
        // Joint fit of both terms; at whoop coast speeds the quadratic term is small, so k and c trade
        // off. With the preset's body drag known, k is fitted alone and c only reported.
        const j = jackknife(groups, (sel) => fitCoastSet(sel.map((i) => coasts[i])));
        const jk = cFixedBody !== null ? jackknife(groups, (sel) => fitCoastSet(sel.map((i) => coasts[i]), cFixedBody)) : null;
        if (j && j.value.every(Number.isFinite)) {
            kE = jk && jk.value.every(Number.isFinite)
                ? estimate(jk, 0, '1/s', coasts.length, `rotor/duct momentum drag at hover rotor speed, body drag held at the preset's CdA; ${basis}`)
                : estimate(j, 0, '1/s', coasts.length, `rotor/duct momentum drag at hover rotor speed (joint fit with the body drag); ${basis}`);
            cE = estimate(j, 1, '1/m', coasts.length, `quadratic body drag 0.5 rho CdA / m, joint fit with the rotor drag (weakly identified at coast speeds); ${basis}`);
            if (jk) jointK = estimate(j, 0, '1/s', coasts.length, `joint fit of both drag terms; ${basis}`);
        } else if (j) {
            coastProblem = `${coasts.length} coasts without a still hover before them and without a clear slow-down, so their speed is unknown (hover still before each push, H.4 step C)`;
        }
    }

    // ---- GPS cruise, only when there are no coasts
    let gpsRows = 0;
    if (!kE && sig.gps && sig.stick) {
        const g = sig.gps;
        const rows: { vx: number; vy: number; v: number; fx: number; fy: number; s: number }[] = [];
        let j = 0;
        for (let q = 1; q < g.t.length - 1; q++) {
            if (g.sats[q] < 6 || g.speed[q] < 2) continue;
            while (j < n - 1 && sig.t[j] < g.t[q]) j++;
            if (!fly[j]) continue;
            if (Math.abs(sig.gyro[2][j]) > 0.5 || Math.abs(att.roll[j]) > 0.35 || Math.abs(sig.stick[0][j]) > 0.1 || Math.abs(sig.stick[2][j]) > 0.1) continue;
            // steady: the GPS speed changed less than 1 m/s around this fix
            if (Math.abs(g.speed[q + 1] - g.speed[q - 1]) > 1) continue;
            // level flight, velocity along the heading: body = R_rp^T (speed, 0, 0) with R_rp = Ry(pitch) Rx(roll)
            const sr = Math.sin(att.roll[j]), cp = Math.cos(att.pitch[j]), spp = Math.sin(att.pitch[j]);
            const w = Math.max(1, Math.round(0.02 / sig.dt));
            let fx = 0, fy = 0, ss = 0, cnt = 0;
            for (let i = Math.max(0, j - w); i <= Math.min(n - 1, j + w); i++, cnt++) {
                fx += acc[0][i] * GRAVITY;
                fy += acc[1][i] * GRAVITY;
                ss += scale(i);
            }
            rows.push({ vx: cp * g.speed[q], vy: spp * sr * g.speed[q], v: g.speed[q], fx: fx / cnt, fy: fy / cnt, s: ss / cnt });
        }
        gpsRows = rows.length;
        if (gpsRows >= 50) {
            const idx = rows.map((_, i) => i);
            const j2 = jackknife(blocks(idx, BLOCKS), (sel) => {
                const r = ols(
                    sel.flatMap((i) => [2 * i, 2 * i + 1]),
                    2,
                    (q, x) => {
                        const r0 = rows[q >> 1];
                        const v = q & 1 ? r0.vy : r0.vx;
                        x[0] = -r0.s * v;
                        x[1] = -r0.v * v;
                        return q & 1 ? r0.fy : r0.fx;
                    }
                );
                return r ? r.beta : null;
            });
            if (j2) {
                const basis = `${gpsRows} GPS cruise fixes (level flight along the heading assumed)`;
                kE = estimate(j2, 0, '1/s', gpsRows, `rotor/duct momentum drag at hover rotor speed; ${basis}`);
                cE = estimate(j2, 1, '1/m', gpsRows, `quadratic body drag 0.5 rho CdA / m; ${basis}`);
            }
        }
    }
    if (!kE) {
        why.push({ what: 'duct / rotor drag, CdA', why: `${coastProblem || `${coasts.length} coast-down(s) (need 2: sticks centred and near level for 1.5 s after a push)`} and ${gpsRows} usable GPS cruise fixes (need 50): fly the H.4 coast-downs` });
        return { k: null, c: null, why };
    }
    // A term whose interval includes 0 (or is negative) is not identified: report it as such.
    const keep = (e: Estimate | null, what: string): Estimate | null => {
        if (!e) return null;
        if (e.value <= 0 || !(e.value > 2 * e.se)) {
            why.push({ what, why: `${e.value.toPrecision(3)} +- ${e.se.toPrecision(2)} ${e.unit}: not distinguishable from 0 with this data (${e.basis})` });
            return null;
        }
        return e;
    };
    return { k: keep(kE, 'duct / rotor drag'), c: keep(cE, 'quadratic body drag (CdA)'), jointK, why };
}

function flyIdxMid(fly: Uint8Array): number {
    let count = 0;
    for (let k = 0; k < fly.length; k++) count += fly[k];
    let seen = 0;
    for (let k = 0; k < fly.length; k++) if (fly[k] && ++seen >= count / 2) return k;
    return 0;
}

function presetDiff(opt: FitOptions, sig: Signals, sp: SimParams, e: Record<string, Estimate>, rates: FitReport['rates'], hoverSumRpm2: number, massKg: number | null, notIdentified: FitReport['notIdentified']): { id: string; fields: PresetField[] } {
    const p = opt.preset!;
    const date = opt.date ?? sig.config.date ?? 'undated';
    const source = `measured:blackbox-${date}`;
    const fields: PresetField[] = [];
    const now = (f: string) => p.fields[f]?.value;
    const add = (field: string, proposed: unknown, confidence: Confidence, note: string, src = source) => fields.push({ field, now: now(field), proposed, source: src, confidence, note });
    const sig3 = (x: number) => Number(x.toPrecision(3));
    const twr = e.twrHoverMatched ?? e.twrThrustFit;
    if (twr) add('twr', sig3(twr.value), twr.confidence, `${e.twrHoverMatched ? 'still hover' : 'thrust fit'}; hover motor output ${e.hoverMotor ? e.hoverMotor.value.toFixed(3) : '?'}${e.twrFromRpm ? `; rpm at full throttle says ${e.twrFromRpm.value.toFixed(2)} (the simulator's w^2 thrust curve cannot match both)` : ''}`);
    if (e.motorTau) add('motor_tau_ms', sig3(e.motorTau.value), e.motorTau.confidence, `+- ${e.motorTau.se.toFixed(1)} ms${e.motorTauLowRpm && e.motorTauHighRpm ? `; ${e.motorTauLowRpm.value.toFixed(1)} ms below / ${e.motorTauHighRpm.value.toFixed(1)} ms above the median rpm` : ''}`);
    const iy = sp.inertia[1];
    const omegaNom = sp.omegaMaxPerVolt * sp.vNom;
    // k_T: from the mass and the hover rpm when both are known, else from the preset (Tmax at omega_max)
    const measuredKT = massKg !== null && Number.isFinite(hoverSumRpm2);
    const kT = measuredKT ? (massKg! * GRAVITY) / hoverSumRpm2 : sp.tmaxMotorNom / (omegaNom * omegaNom);
    const kTnote = measuredKT ? `k_T from ${opt.massG} g and the hover rpm` : "k_T from the preset's Tmax and KV (no --mass)";
    if (e.rotorInertiaRatio) add('rotor_inertia_kgm2', Number((e.rotorInertiaRatio.value * iy).toPrecision(2)), e.rotorInertiaRatio.confidence, `J_r / I_z = ${e.rotorInertiaRatio.value.toExponential(2)} times the preset's I_z ${iy.toExponential(2)} kg m^2 (an estimate)`);
    if (e.yawDragPerRpm2) {
        const kappa = (e.yawDragPerRpm2.value * iy) / kT;
        add('motor_kappa_m', sig3(kappa), e.yawDragPerRpm2.confidence === 'high' && measuredKT ? 'medium' : 'low', `yaw fit x the preset's I_z / k_T (${kTnote}); I_z is an estimate, so this is the weakest link`);
    }
    if (e.rollAuthorityPerRpm2 && e.pitchAuthorityPerRpm2 && measuredKT) {
        // lever arm about the roll and pitch axes: the motor's sideways offset (motorPos x)
        const arm = Math.abs(sp.motorPos[0]);
        const a = 0.5 * (e.rollAuthorityPerRpm2.value + e.pitchAuthorityPerRpm2.value);
        const worst: Confidence = [e.rollAuthorityPerRpm2.confidence, e.pitchAuthorityPerRpm2.confidence].includes('low') ? 'low' : 'medium';
        add('inertia_roll_pitch_kgm2', Number(((arm * kT) / a).toPrecision(2)), worst, `arm ${(arm * 1000).toFixed(1)} mm x k_T / mean roll-pitch authority; ${kTnote}`);
    } else if (e.rollAuthorityPerRpm2) {
        notIdentified.push({ what: 'roll/pitch inertia', why: 'needs the all-up mass (--mass) and the hover rpm to turn the authority into an inertia' });
    }
    if (e.ductDrag) add('rotor_drag_per_s', sig3(e.ductDrag.value), e.ductDrag.confidence, `+- ${e.ductDrag.se.toFixed(2)} 1/s; ${e.ductDrag.basis}`);
    if (e.cdaHorizontal && e.cdaHorizontal.confidence === 'high') add('cda_horizontal_cm2', sig3(e.cdaHorizontal.value), e.cdaHorizontal.confidence, e.cdaHorizontal.basis);
    else if (e.cdaHorizontal) notIdentified.push({ what: 'CdA (proposal)', why: `${e.cdaHorizontal.value.toFixed(0)} +- ${e.cdaHorizontal.se.toFixed(0)} cm^2 is not firm enough to change the preset: at coast speeds the body drag is small next to the rotor drag (a fast straight pass, H.4 step F, pins it)` });
    if (massKg) add('auw_g', opt.massG, 'high', 'weighed by the pilot', 'measured:owner');
    const cfg = sig.config;
    if (rates) {
        const rc = rates.config;
        add('rates', { type: rc.type, roll: [rc.roll.rcRate, rc.roll.rate, rc.roll.expo], pitch: [rc.pitch.rcRate, rc.pitch.rate, rc.pitch.expo], yaw: [rc.yaw.rcRate, rc.yaw.rate, rc.yaw.expo], rate_limit: rc.rateLimit }, rates.setpointErrDegS && Math.max(...rates.setpointErrDegS) < 5 ? 'high' : 'medium', `log header; max ${rates.maxDegS.roll.toFixed(0)}/${rates.maxDegS.pitch.toFixed(0)}/${rates.maxDegS.yaw.toFixed(0)} deg/s`);
    }
    if (cfg.pid) for (const ax of ['roll', 'pitch', 'yaw'] as const) add(`pid_${ax}`, cfg.pid[ax], 'high', 'log header (P, I, D, F)');
    if (cfg.throttle) add('throttle', cfg.throttle, 'high', 'log header thr_mid / thr_expo');
    if (cfg.idle) add('motor_idle', cfg.idle.fraction, 'high', cfg.idle.dynamicMinRpm > 0 ? `log header; dynamic idle ${cfg.idle.dynamicMinRpm} rpm is on, which the simulator does not model` : 'log header');
    // leave out fields that would not change
    return { id: p.id, fields: fields.filter((f) => JSON.stringify(f.now) !== JSON.stringify(f.proposed)) };
}

/** Hover the preset gives today, for the report. */
export function presetHover(p: PresetJson): { motor: number; throttlePct: number } {
    const h = hoverSolve(compileParams(p), 1);
    return { motor: h.motor, throttlePct: h.stick * 100 };
}
