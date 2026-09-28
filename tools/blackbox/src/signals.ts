// Turn a decoded Betaflight log into SI signals for the fit.
//
// Axes: Betaflight logs gyro and accelerometer in one right-handed body frame, x forward, y left,
// z up (FLU): roll + = right side down, pitch + = nose down, yaw + = nose left. (Read from the
// firmware's mixer: the yaw PID sum is negated before the mixer unless yaw_motors_reversed, and
// the IMU feeds gyro and accelerometer into one Mahony filter.) Units in the log:
// gyroADC deg/s (x10 with blackbox_high_resolution), accSmooth in acc_1G units, motor in DShot
// units 48..2047 (or PWM us), eRPM in 100 eRPM, vbatLatest in 0.01 V (Betaflight 4+) or 0.1 V (3.x).

import type { AxisRates, RatesConfig, RatesType } from '@gsfpv/sim-core';
import type { DecodedLog } from './decode';

export interface Signals {
    n: number;
    /** seconds from the first frame */
    t: Float64Array;
    /** median sample interval, s */
    dt: number;
    /** body rates FLU, rad/s */
    gyro: [Float64Array, Float64Array, Float64Array];
    /** specific force FLU, in g (1 = 9.80665 m/s^2); null if not logged */
    acc: [Float64Array, Float64Array, Float64Array] | null;
    /** motor output as a fraction of full (0 = stopped, 1 = full), Betaflight motor order */
    motor: Float64Array[] | null;
    /** rotor speed, rad/s; null without bidirectional DShot telemetry */
    rpm: Float64Array[] | null;
    /** pack voltage, V */
    vbat: Float64Array | null;
    /** sticks: roll, pitch, yaw -1..1 (rcCommand / 500), throttle 0..1 after the curve (rcCommand) */
    stick: [Float64Array, Float64Array, Float64Array, Float64Array] | null;
    /** rate setpoints deg/s (FLU signs) and the mixer throttle 0..1; null before Betaflight 3.2 */
    setpoint: [Float64Array, Float64Array, Float64Array] | null;
    mixerThrottle: Float64Array | null;
    /** the flight controller's own roll / pitch estimate (debug_mode ATTITUDE), rad */
    fcAttitude: { roll: Float64Array; pitch: Float64Array } | null;
    gps: { t: Float64Array; speed: Float64Array; course: Float64Array; altitude: Float64Array; sats: Float64Array } | null;
    config: LogConfig;
}

export interface LogConfig {
    firmware: string;
    version: { major: number; minor: number; patch: number } | null;
    craft: string;
    date: string | null;
    motorPoles: number | null;
    /** rates as configured, in the simulator's form; null when the header has none it can read */
    rates: RatesConfig | null;
    ratesNote: string;
    pid: { roll: number[]; pitch: number[]; yaw: number[] } | null;
    throttle: { mid: number; expo: number } | null;
    /** static idle fraction and dynamic idle rpm */
    idle: { fraction: number; dynamicMinRpm: number } | null;
    debugMode: number | null;
    highResolution: boolean;
    dshot: boolean;
}

const RATES_TYPES: RatesType[] = ['BETAFLIGHT', 'RACEFLIGHT', 'KISS', 'ACTUAL'];
const G = 9.80665;

const ints = (s: string | undefined): number[] | null => (s ? s.split(',').map((x) => Number.parseInt(x, 10)) : null);

function logConfig(log: DecodedLog): LogConfig {
    const h = log.headers;
    const v = log.sys.version;
    const four = !!v && v.major >= 4;
    let rates: RatesConfig | null = null;
    let ratesNote = '';
    const rt = h.rates_type !== undefined ? Number(h.rates_type) : null;
    const rc = ints(h.rc_rates);
    const ex = ints(h.rc_expo);
    const sr = ints(h.rates);
    const lim = ints(h.rate_limits);
    if (rt !== null && rc && ex && sr) {
        if (rt >= 0 && rt < RATES_TYPES.length) {
            const ax = (i: number): AxisRates => ({ rcRate: rc[i], rate: sr[i], expo: ex[i] });
            rates = { type: RATES_TYPES[rt], roll: ax(0), pitch: ax(1), yaw: ax(2), rateLimit: lim ? Math.min(...lim) : 1998 };
            ratesNote = 'from the log header';
        } else ratesNote = `rates_type ${rt} (QUICK) is not implemented in the simulator`;
    } else if (h.rcRate !== undefined) {
        ratesNote = 'Betaflight 3.x rate headers (rcRate/rcExpo/rates) are not converted; read the rates from a diff instead';
    } else ratesNote = 'no rate headers';
    const pidOf = (name: string, ff: number | undefined) => {
        const p = ints(h[name]);
        return p ? [p[0], p[1], p[2], ff ?? 0] : null;
    };
    const ff = ints(h.ff_weight) ?? [];
    const pr = pidOf('rollPID', ff[0]);
    const pp = pidOf('pitchPID', ff[1]);
    const py = pidOf('yawPID', ff[2]);
    const idleRaw = h.motor_idle ?? h.dshot_idle_value;
    const dyn = h.dyn_idle_min_rpm !== undefined ? Number(h.dyn_idle_min_rpm) * 100 : 0;
    const dt = h['Log start datetime'];
    return {
        firmware: log.sys.firmware,
        version: v,
        craft: h['Craft name'] ?? '',
        date: dt && !dt.startsWith('0000') ? dt.slice(0, 10) : null,
        motorPoles: h.motor_poles ? Number(h.motor_poles) : null,
        rates,
        ratesNote,
        pid: pr && pp && py ? { roll: pr, pitch: pp, yaw: py } : null,
        throttle: h.thr_mid !== undefined ? { mid: Number(h.thr_mid), expo: Number(h.thr_expo ?? 0) } : null,
        idle: idleRaw !== undefined ? { fraction: Number(idleRaw) / 10000, dynamicMinRpm: dyn } : null,
        debugMode: h.debug_mode !== undefined ? Number(h.debug_mode) : null,
        highResolution: h.blackbox_high_resolution === '1',
        dshot: log.sys.motorOutputHigh === 2047 || (four && Number(h.motor_pwm_protocol ?? 0) >= 5)
    };
}

/** debug_mode index of ATTITUDE: 75 in 4.4, 76 in 4.5 / 2025.12 / 2026.6 (build/debug.h order). */
function attitudeDebugIndex(v: LogConfig['version']): number | null {
    if (!v) return null;
    if (v.major === 4 && v.minor === 4) return 75;
    if ((v.major === 4 && v.minor >= 5) || v.major >= 2025) return 76;
    return null;
}

export function extractSignals(log: DecodedLog): Signals {
    const m = log.main;
    const n = m.length;
    const cfg = logConfig(log);
    const time = m.col('time');
    const t = new Float64Array(n);
    for (let k = 0; k < n; k++) t[k] = (time[k] - time[0]) * 1e-6;
    const gaps: number[] = [];
    for (let k = 1; k < n && gaps.length < 20000; k++) gaps.push(t[k] - t[k - 1]);
    gaps.sort((a, b) => a - b);
    const dt = gaps.length ? gaps[gaps.length >> 1] : 0.001;

    const hr = cfg.highResolution ? 0.1 : 1;
    const deg = Math.PI / 180;
    const col = (name: string, scale: number) => {
        const c = m.col(name);
        const out = new Float64Array(n);
        for (let k = 0; k < n; k++) out[k] = c[k] * scale;
        return out;
    };
    const gyro = [0, 1, 2].map((i) => col(`gyroADC[${i}]`, log.sys.gyroScale * hr * deg)) as Signals['gyro'];
    const acc = m.has('accSmooth[0]') ? ([0, 1, 2].map((i) => col(`accSmooth[${i}]`, 1 / log.sys.acc1G)) as Signals['acc']) : null;

    let motor: Float64Array[] | null = null;
    if (m.has('motor[0]')) {
        // DShot: 48 = stopped, 2047 = full; PWM protocols: 1000 us = stopped, maxthrottle = full.
        const zero = cfg.dshot ? 48 : 1000;
        const full = cfg.dshot ? 2047 : log.sys.maxthrottle;
        motor = [];
        for (let i = 0; i < 8 && m.has(`motor[${i}]`); i++) motor.push(col(`motor[${i}]`, 1 / (full - zero)).map((x) => x - zero / (full - zero)));
    }
    let rpm: Float64Array[] | null = null;
    if (m.has('eRPM[0]') && cfg.motorPoles) {
        const k = (100 / (cfg.motorPoles / 2)) * ((2 * Math.PI) / 60);
        rpm = [];
        for (let i = 0; i < 8 && m.has(`eRPM[${i}]`); i++) rpm.push(col(`eRPM[${i}]`, k));
        // an all-zero telemetry channel means no bidirectional DShot
        if (rpm.every((r) => r.every((x) => x === 0))) rpm = null;
    }
    const vbat = m.has('vbatLatest') ? col('vbatLatest', cfg.version && cfg.version.major >= 4 ? 0.01 : 0.1) : null;
    let stick: Signals['stick'] = null;
    if (m.has('rcCommand[3]')) {
        const r = [0, 1, 2].map((i) => col(`rcCommand[${i}]`, hr / 500));
        const th = col('rcCommand[3]', hr).map((x) => (x - 1000) / 1000);
        stick = [r[0], r[1], r[2], th];
    }
    const setpoint = m.has('setpoint[0]') ? ([0, 1, 2].map((i) => col(`setpoint[${i}]`, hr)) as Signals['setpoint']) : null;
    const mixerThrottle = m.has('setpoint[3]') ? col('setpoint[3]', 1 / 1000) : null;
    let fcAttitude: Signals['fcAttitude'] = null;
    const att = attitudeDebugIndex(cfg.version);
    if (att !== null && cfg.debugMode === att && m.has('debug[0]') && m.has('debug[1]')) {
        // attitude in decidegrees (imu.c Euler angles from its rotation matrix): roll = atan2 of the
        // up vector's y and z in the body, + = right side down; pitch = asin(-up.x), + = nose down
        fcAttitude = { roll: col('debug[0]', 0.1 * deg), pitch: col('debug[1]', 0.1 * deg) };
    }
    let gps: Signals['gps'] = null;
    const g = log.gps;
    if (g.length > 2 && g.has('GPS_speed') && g.has('time')) {
        const gt = g.col('time');
        gps = {
            t: Float64Array.from(gt, (x) => (x - time[0]) * 1e-6),
            speed: Float64Array.from(g.col('GPS_speed'), (x) => x / 100),
            course: g.has('GPS_ground_course') ? Float64Array.from(g.col('GPS_ground_course'), (x) => (x / 10) * deg) : new Float64Array(g.length),
            altitude: g.has('GPS_altitude') ? Float64Array.from(g.col('GPS_altitude')) : new Float64Array(g.length),
            sats: g.has('GPS_numSat') ? Float64Array.from(g.col('GPS_numSat')) : new Float64Array(g.length)
        };
    }
    return { n, t, dt, gyro, acc, motor, rpm, vbat, stick, setpoint, mixerThrottle, fcAttitude, gps, config: cfg };
}

export const GRAVITY = G;
