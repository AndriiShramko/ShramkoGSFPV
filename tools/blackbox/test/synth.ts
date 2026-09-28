// A synthetic blackbox log flown by the simulator itself: the H.4 flight script (hover, punch-outs,
// coast-downs, yaw flicks, roll and pitch flicks) on a known preset, written as a real binary log with
// Betaflight 4.5 field names, units and axis conventions. Fitting it must give the preset back.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODE_CHANNEL, S, Sim, compileParams, hoverSolve, setpointRate, throttleCurve } from '@gsfpv/sim-core';
import type { FlightMode, ParamOverrides, PresetJson, SimParams } from '@gsfpv/sim-core';
import { BlackboxWriter, type FieldSpec } from './encode';

export function loadPreset(id: string): PresetJson {
    return JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'sim-core', 'presets', `${id}.json`), 'utf8')) as PresetJson;
}

const F = (name: string, signed: boolean, iP: number, iE: number, pP: number, pE: number): FieldSpec => ({ name, signed, iPredictor: iP, iEncoding: iE, pPredictor: pP, pEncoding: pE });
// Field set and encodings as Betaflight 4.5 writes them (blackbox.c field definitions).
const FIELDS: FieldSpec[] = [
    F('loopIteration', false, 0, 1, 6, 9),
    F('time', false, 0, 1, 2, 0),
    ...[0, 1, 2, 3].map((i) => F(`rcCommand[${i}]`, i < 3, 0, i < 3 ? 0 : 1, 1, 8)),
    ...[0, 1, 2, 3].map((i) => F(`setpoint[${i}]`, true, 0, 0, 1, 8)),
    F('vbatLatest', false, 9, 3, 1, 6),
    ...[0, 1, 2].map((i) => F(`gyroADC[${i}]`, true, 0, 0, 3, 0)),
    ...[0, 1, 2].map((i) => F(`accSmooth[${i}]`, true, 0, 0, 3, 0)),
    ...[0, 1, 2, 3].map((i) => F(`debug[${i}]`, true, 0, 0, 3, 0)),
    F('motor[0]', false, 11, 1, 3, 0),
    ...[1, 2, 3].map((i) => F(`motor[${i}]`, false, 5, 0, 3, 0)),
    ...[0, 1, 2, 3].map((i) => F(`eRPM[${i}]`, false, 0, 1, 1, 0))
];

export interface SynthOptions {
    presetId?: string;
    overrides?: ParamOverrides;
    /** log the flight controller's attitude (debug_mode ATTITUDE); otherwise the fit estimates it */
    attitudeDebug?: boolean;
    /** leave out the eRPM fields (no bidirectional DShot) */
    noRpm?: boolean;
    /** sensor noise (deterministic): gyro 1 deg/s, accelerometer 0.01 g, rpm 0.5 % RMS; on by default */
    noise?: boolean;
}

/** Deterministic Gaussian-ish noise (sum of 4 uniforms from an LCG), unit variance. */
function noiseSource(seed: number): () => number {
    let st = seed >>> 0;
    const u = () => ((st = (Math.imul(st, 1664525) + 1013904223) >>> 0) / 4294967296) - 0.5;
    return () => (u() + u() + u() + u()) * Math.sqrt(3);
}

// hold: the pilot keeps the altitude with the throttle (a real pilot does; a fixed stick sinks as the pack drains)
// brake: the pilot tilts against the horizontal velocity until the quad stands still
type Step = { ms: number; roll?: number; pitch?: number; yaw?: number; thr?: number; mode?: FlightMode; hold?: boolean; brake?: boolean };

/** The H.4 flight script, as stick commands over time. */
function script(hover: number): Step[] {
    const s: Step[] = [];
    const hov = (ms: number, mode: FlightMode = 'angle') => s.push({ ms, thr: hover, mode, hold: true });
    hov(12000); // A: still hover
    for (let i = 0; i < 3; i++) {
        s.push({ ms: 300, thr: 1, mode: 'angle' }); // B: punch-out, then throttle cut to stop the climb
        s.push({ ms: 1250, thr: 0, mode: 'angle' });
        hov(3000);
    }
    for (const axis of ['pitch', 'pitch', 'pitch', 'roll', 'roll', 'roll'] as const) {
        // C: accelerate 2.5 s, then centre the sticks and let it coast to a stop
        s.push({ ms: 2500, [axis]: 0.5, thr: hover * 1.08, mode: 'angle', hold: true });
        hov(7000);
        s.push({ ms: 3000, mode: 'angle', hold: true, brake: true }); // the pilot stops what is left of the drift
        hov(1000);
    }
    for (const [amp, ms] of [[1, 300], [-1, 300], [1, 400], [-1, 400], [0.5, 400], [-0.5, 400], [1, 3000]] as const) {
        s.push({ ms, yaw: amp, thr: hover, mode: 'angle' }); // D: yaw flicks and one spin
        hov(2000);
    }
    for (const axis of ['roll', 'pitch'] as const) {
        for (let i = 0; i < 3; i++) {
            // E: acro flick out and back, then angle mode levels it
            s.push({ ms: 120, [axis]: 0.6, thr: hover, mode: 'acro' });
            s.push({ ms: 120, [axis]: -0.6, thr: hover, mode: 'acro' });
            hov(2000);
        }
    }
    return s;
}

export function synthLog(opt: SynthOptions = {}): { bytes: Uint8Array; params: SimParams; preset: PresetJson } {
    const preset = loadPreset(opt.presetId ?? 'pavo20pro-3s');
    const p = compileParams(preset, opt.overrides ?? {});
    const sim = new Sim(p, null);
    sim.reset(0, 100, 0, 0);
    const hover = hoverSolve(p, 1).stick;
    const poles = 12;
    const fields = opt.noRpm ? FIELDS.filter((f) => !f.name.startsWith('eRPM')) : FIELDS;
    const rc = p.rates;
    const w = new BlackboxWriter(
        fields,
        {
            'Firmware revision': 'Betaflight 4.5.1 (77d01ba3b) GSFPV-SIM',
            'Log start datetime': '2026-09-28T12:00:00.000+00:00',
            'Craft name': `sim ${preset.id}`,
            'P ratio': '32',
            maxthrottle: '2000',
            gyro_scale: '0x3f800000',
            acc_1G: '2048',
            motor_poles: String(poles),
            debug_mode: opt.attitudeDebug ? '76' : '0',
            rates_type: String(['BETAFLIGHT', 'RACEFLIGHT', 'KISS', 'ACTUAL'].indexOf(rc.type)),
            rc_rates: [rc.roll.rcRate, rc.pitch.rcRate, rc.yaw.rcRate].join(','),
            rc_expo: [rc.roll.expo, rc.pitch.expo, rc.yaw.expo].join(','),
            rates: [rc.roll.rate, rc.pitch.rate, rc.yaw.rate].join(','),
            rate_limits: [rc.rateLimit, rc.rateLimit, rc.rateLimit].join(','),
            rollPID: p.pid.roll.slice(0, 3).join(','),
            pitchPID: p.pid.pitch.slice(0, 3).join(','),
            yawPID: p.pid.yaw.slice(0, 3).join(','),
            ff_weight: [p.pid.roll[3], p.pid.pitch[3], p.pid.yaw[3]].join(','),
            thr_mid: String(p.throttle.mid),
            thr_expo: String(p.throttle.expo),
            dshot_idle_value: String(Math.round(p.idle * 10000)),
            blackbox_high_resolution: '0'
        },
        { minthrottle: 1070, motorOutputLow: 48 + Math.round(p.idle * 1999), vbatref: Math.round(p.cells * 4.2 * 100), iInterval: 32, pDenom: 1 }
    );
    // arm: throttle low, switch edge
    const ch = [0, 0, -1, 0, -1, MODE_CHANNEL.angle, 0, 0];
    sim.setChannels(ch);
    sim.step();
    ch[4] = 1;
    sim.setChannels(ch);
    sim.step();
    if (!sim.armed) throw new Error('synthetic flight did not arm');
    const R2D = 180 / Math.PI;
    const noisy = opt.noise ?? true;
    const gen = noiseSource(12345);
    const nz = () => (noisy ? gen() : 0);
    let it = 0;
    const s = sim.s;
    const prevV = [s[S.vx], s[S.vy], s[S.vz]];
    for (const st of script(hover)) {
        ch[0] = st.roll ?? 0;
        ch[1] = st.pitch ?? 0;
        ch[3] = st.yaw ?? 0;
        ch[2] = (st.thr ?? hover) * 2 - 1;
        ch[5] = MODE_CHANNEL[st.mode ?? 'angle'];
        sim.setChannels(ch);
        let base = hover;
        for (let n = 0; n < st.ms; n++) {
            if (st.hold) {
                if (n % 100 === 0) base = hoverSolve(p, s[S.soc]).stick;
                const tilt = st.brake || st.roll || st.pitch ? 1.08 : 1;
                ch[2] = Math.max(0, Math.min(1, base * tilt - 0.05 * s[S.vy])) * 2 - 1;
                if (st.brake) {
                    // velocity in the body: forward = -z, right = +x (simulator axes)
                    const qw = s[S.qw], qx = s[S.qx], qy = s[S.qy], qz = s[S.qz];
                    const bvx = (1 - 2 * (qy * qy + qz * qz)) * s[S.vx] + 2 * (qx * qy + qw * qz) * s[S.vy] + 2 * (qx * qz - qw * qy) * s[S.vz];
                    const bvz = 2 * (qx * qz + qw * qy) * s[S.vx] + 2 * (qy * qz - qw * qx) * s[S.vy] + (1 - 2 * (qx * qx + qy * qy)) * s[S.vz];
                    ch[1] = Math.max(-0.5, Math.min(0.5, 0.4 * bvz)); // moving forward (bvz < 0): nose up
                    ch[0] = Math.max(-0.5, Math.min(0.5, -0.4 * bvx)); // moving right: bank left
                }
                sim.setChannels(ch);
            }
            // rotation body -> world at the start of the step (the forces of the step use it)
            const qw = s[S.qw], qx = s[S.qx], qy = s[S.qy], qz = s[S.qz];
            const r00 = 1 - 2 * (qy * qy + qz * qz), r01 = 2 * (qx * qy - qw * qz), r02 = 2 * (qx * qz + qw * qy);
            const r10 = 2 * (qx * qy + qw * qz), r11 = 1 - 2 * (qx * qx + qz * qz), r12 = 2 * (qy * qz - qw * qx);
            const r20 = 2 * (qx * qz - qw * qy), r21 = 2 * (qy * qz + qw * qx), r22 = 1 - 2 * (qx * qx + qy * qy);
            // rpm telemetry reaches the flight controller one loop late: log the rotor speed before this step
            const rpmBefore = [0, 1, 2, 3].map((i) => (s[S.m0 + i] * p.omegaMaxPerVolt * s[S.volt] * 60) / (2 * Math.PI));
            sim.step();
            // specific force = (dv/dt - gravity), in the simulator body (x right, y up, z back)
            const fx = (s[S.vx] - prevV[0]) / 0.001, fy = (s[S.vy] - prevV[1]) / 0.001 + p.gravity, fz = (s[S.vz] - prevV[2]) / 0.001;
            prevV[0] = s[S.vx]; prevV[1] = s[S.vy]; prevV[2] = s[S.vz];
            const bx = r00 * fx + r10 * fy + r20 * fz, by = r01 * fx + r11 * fy + r21 * fz, bz = r02 * fx + r12 * fy + r22 * fz;
            // Betaflight body FLU: x forward = -z, y left = -x, z up = +y
            const acc = [-bz, -bx, by].map((v) => Math.round((v / 9.80665 + 0.01 * nz()) * 2048));
            const gyro = [-s[S.wz], -s[S.wx], s[S.wy]].map((v) => Math.round(v * R2D + 1.0 * nz()));
            // attitude as the firmware's Euler angles: roll + right side down, pitch + nose down
            const upx = -r12, upy = -r10, upz = r11; // world up in the FLU body
            const attRoll = Math.round(Math.atan2(upy, upz) * R2D * 10);
            const attPitch = Math.round(Math.asin(Math.max(-1, Math.min(1, -upx))) * R2D * 10);
            const thrStick = (ch[2] + 1) / 2;
            // the simulator's yaw stick + turns the nose right; Betaflight's rcCommand and setpoint are + for nose left
            const spR = setpointRate(rc.type, ch[0], rc.roll, rc.rateLimit);
            const spP = setpointRate(rc.type, ch[1], rc.pitch, rc.rateLimit);
            const spY = -setpointRate(rc.type, ch[3], rc.yaw, rc.rateLimit);
            const thrCurve = throttleCurve(thrStick, p.throttle);
            const motors = [0, 1, 2, 3].map((i) => 48 + Math.round(sim.motorCmd[i] * 1999));
            const volt = s[S.volt];
            const erpm = rpmBefore.map((r) => Math.round((r * (1 + 0.005 * nz()) * (poles / 2)) / 100));
            const row = [
                it,
                1_000_000 + it * 1000,
                Math.round(ch[0] * 500), Math.round(ch[1] * 500), Math.round(-ch[3] * 500), Math.round(1000 + thrCurve * 1000),
                Math.round(spR), Math.round(spP), Math.round(spY), Math.round(thrCurve * 1000),
                Math.round(volt * 100),
                ...gyro,
                ...acc,
                opt.attitudeDebug ? attRoll : 0, opt.attitudeDebug ? attPitch : 0, 0, 0,
                ...motors,
                ...(opt.noRpm ? [] : erpm)
            ];
            w.frame(row, it);
            it++;
        }
    }
    return { bytes: w.end(), params: p, preset };
}
