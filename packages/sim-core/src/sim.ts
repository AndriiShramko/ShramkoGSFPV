// Quadcopter flight model, fixed 1 ms step, no DOM, deterministic.
//
// Frames: world is PlayCanvas world space (Y up, right-handed). Body: x right, y up (thrust),
// z back (the nose points to -z). Angular velocity w is in body frame, right-hand rule.
// Pilot / PID axes (Betaflight convention): roll + = roll right, pitch + = nose down,
// yaw + = yaw right. In body terms: roll = -w.z, pitch = -w.x, yaw = -w.y.
//
// Channels ch[0..7] in [-1, 1] after calibration: 0 roll (right +), 1 pitch (stick forward +),
// 2 throttle (-1 = low, +1 = full), 3 yaw (right +), 4 arm switch (> 0.5 on), 5 angle mode
// (> 0.5 on), 6..7 spare.

import { dcos, dsin, datan2, RAD2DEG, DEG2RAD } from './dmath';
import type { SimParams } from './params';
import { cellVoc } from './params';
import { setpointRate, throttleCurve } from './rates';

export const DT = 0.001;
export const DT_US = 1000;

export interface ContactOut {
    sphere: number;
    nx: number;
    ny: number;
    nz: number;
}

/** Collision provider. sim-core does not depend on any collision implementation. */
export interface ContactWorld {
    /**
     * n spheres move linearly from c0 to c1 (packed x,y,z world). r = radii, pad = extra
     * conservative inflation per sphere (rotation chord error). Returns the earliest fraction
     * t in [0, 1] at which any sphere of radius r touches solid, or -1 if the whole move is free.
     * On contact, out receives the sphere index and the outward surface normal.
     */
    sweep(c0: Float64Array, c1: Float64Array, r: Float64Array, pad: Float64Array, n: number, out: ContactOut): number;
    /** Push-out vector for a sphere overlapping solid; false when free. */
    pushOut(x: number, y: number, z: number, r: number, out: { x: number; y: number; z: number }): boolean;
}

export type SimEvent =
    | { type: 'arm'; tick: number }
    | { type: 'disarm'; tick: number; reason: string }
    | { type: 'contact'; tick: number; speed: number; regime: 'slide' | 'bounce' }
    | { type: 'crash'; tick: number; speed: number; nx: number; ny: number; nz: number; px: number; py: number; pz: number }
    | { type: 'rest'; tick: number }
    | { type: 'respawn'; tick: number };

// State layout in one Float64Array (hashed for determinism).
export const S = {
    px: 0, py: 1, pz: 2,
    vx: 3, vy: 4, vz: 5,
    qw: 6, qx: 7, qy: 8, qz: 9,
    wx: 10, wy: 11, wz: 12,
    m0: 13, m1: 14, m2: 15, m3: 16,
    iR: 17, iP: 18, iY: 19,
    dfR: 20, dfP: 21, dfY: 22,
    ffR: 23, ffP: 24, ffY: 25,
    spR: 26, spP: 27, spY: 28,
    splR: 29, splP: 30,
    soc: 31, volt: 32, amps: 33,
    armed: 34, crashed: 35, armSw: 36, sat: 37, restT: 38, crashT: 39,
    g1R: 40, g1P: 41, g1Y: 42, g2R: 43, g2P: 44, g2Y: 45,
    d2R: 46, d2P: 47, d2Y: 48,
    size: 49
} as const;

const PT1 = (fc: number) => {
    const rc = 1 / (2 * Math.PI * fc);
    return DT / (rc + DT);
};
// D-term filtering, Betaflight 4.5.1 defaults (flight/pid.h): LPF1 PT1 dynamic 75..150 Hz with
// throttle, LPF2 PT1 150 Hz. (The spec's single PT1 100 Hz was an estimate; this is the default.)
const DTERM_DYN_MIN = 75;
const DTERM_DYN_MAX = 150;
const K_DTERM2 = PT1(150);
// Betaflight 4.5.1 default gyro filtering (sensors/gyro.h): LPF1 PT1 250 Hz (dynamic minimum), LPF2 PT1 500 Hz.
// The sensor itself is ideal; these are the controller's filters and their phase lag.
const K_GYRO1 = PT1(250);
const K_GYRO2 = PT1(500);
const K_FF = PT1(30);
const K_RELAX = PT1(15);

const P_SCALE = 0.032029;
const I_SCALE = 0.244381;
const D_SCALE = 0.000529;
// Betaflight 4.5.1 pid_init.c: Kf = FEEDFORWARD_SCALE * (F * 0.01)
const F_SCALE = 0.013754 * 0.01;
const ITERM_LIMIT = 400;
const RELAX_THRESHOLD = 40;
const ANGLE_MAX_DEG = 55;
const ANGLE_GAIN = 5; // 1/s: deg of error -> deg/s setpoint (Betaflight angle strength 50 class)

// quad X mixer, Betaflight order M1 RR, M2 FR, M3 RL, M4 FL; columns roll, pitch, yaw
const MIX_R = [-1, -1, 1, 1];
const MIX_P = [1, -1, 1, -1];
const MIX_Y = [-1, 1, 1, -1];

const MU = 0.4; // friction coefficient [estimate]
const SKIN = 0.001; // m, gap kept after a contact

export class Sim {
    readonly p: SimParams;
    readonly s = new Float64Array(S.size);
    readonly ch = new Float64Array(8);
    tick = 0;
    world: ContactWorld | null;
    events: SimEvent[] = [];
    /** optional: counts contact sweeps that started overlapping (should stay 0 in flight) */
    startOverlaps = 0;

    // scratch
    private c0: Float64Array;
    private c1: Float64Array;
    private rr: Float64Array;
    private pad: Float64Array;
    private nS: number;
    private cout: ContactOut = { sphere: -1, nx: 0, ny: 0, nz: 0 };
    private push = { x: 0, y: 0, z: 0 };
    private motorsOut = new Float64Array(4);
    private thrust = new Float64Array(4);

    constructor(p: SimParams, world: ContactWorld | null) {
        this.p = p;
        this.world = world;
        this.nS = p.spheres.length / 4;
        this.c0 = new Float64Array(this.nS * 3);
        this.c1 = new Float64Array(this.nS * 3);
        this.rr = new Float64Array(this.nS);
        this.pad = new Float64Array(this.nS);
        for (let i = 0; i < this.nS; i++) this.rr[i] = p.spheres[i * 4 + 3];
        this.reset(0, 0, 0, 0);
        this.ch[2] = -1;
        this.ch[4] = -1;
    }

    /** Place the craft level at (x, y, z) with heading yawDeg (0 = nose along -z, + = turned right). */
    reset(x: number, y: number, z: number, yawDeg: number): void {
        const s = this.s;
        s.fill(0);
        s[S.px] = x; s[S.py] = y; s[S.pz] = z;
        const h = -yawDeg * DEG2RAD * 0.5;
        // rotation about +y (which turns left), so a right heading is a negative angle
        s[S.qw] = dcos(h); s[S.qx] = 0; s[S.qy] = dsin(h); s[S.qz] = 0;
        s[S.soc] = 1;
        s[S.volt] = this.p.cells * cellVoc(1);
        s[S.armSw] = 1; // require a fresh off -> on transition
    }

    get armed(): boolean { return this.s[S.armed] > 0; }
    get crashed(): boolean { return this.s[S.crashed] > 0; }

    setChannels(ch: ArrayLike<number>): void {
        for (let i = 0; i < 8; i++) this.ch[i] = Math.fround(ch[i] ?? 0);
    }

    respawn(x: number, y: number, z: number, yawDeg: number): void {
        const soc = this.s[S.soc];
        this.reset(x, y, z, yawDeg);
        this.s[S.soc] = soc;
        this.s[S.volt] = this.p.cells * cellVoc(soc);
        this.events.push({ type: 'respawn', tick: this.tick });
    }

    step(): void {
        const s = this.s;
        const p = this.p;
        const ch = this.ch;
        this.tick++;

        // ---- arming (edge of the arm switch, throttle low, not crashed) ----
        const sw = ch[4] > 0.5 ? 1 : 0;
        const thrStick = (ch[2] + 1) * 0.5;
        if (sw === 1 && s[S.armSw] === 0 && s[S.armed] === 0) {
            if (thrStick <= 0.05 && s[S.crashed] === 0) {
                s[S.armed] = 1;
                s[S.iR] = s[S.iP] = s[S.iY] = 0;
                this.events.push({ type: 'arm', tick: this.tick });
            }
        }
        if (sw === 0 && s[S.armed] === 1) {
            s[S.armed] = 0;
            this.events.push({ type: 'disarm', tick: this.tick, reason: 'switch' });
        }
        s[S.armSw] = sw;

        // ---- body rotation matrix from q ----
        const qw = s[S.qw], qx = s[S.qx], qy = s[S.qy], qz = s[S.qz];
        const r00 = 1 - 2 * (qy * qy + qz * qz), r01 = 2 * (qx * qy - qw * qz), r02 = 2 * (qx * qz + qw * qy);
        const r10 = 2 * (qx * qy + qw * qz), r11 = 1 - 2 * (qx * qx + qz * qz), r12 = 2 * (qy * qz - qw * qx);
        const r20 = 2 * (qx * qz - qw * qy), r21 = 2 * (qy * qz + qw * qx), r22 = 1 - 2 * (qx * qx + qy * qy);

        const wx = s[S.wx], wy = s[S.wy], wz = s[S.wz];
        const armed = s[S.armed] > 0 && s[S.crashed] === 0;

        // ---- setpoints ----
        const rc = p.rates;
        let spR = setpointRate(rc.type, ch[0], rc.roll, rc.rateLimit);
        let spP = setpointRate(rc.type, ch[1], rc.pitch, rc.rateLimit);
        const spY = setpointRate(rc.type, ch[3], rc.yaw, rc.rateLimit);
        if (ch[5] > 0.5) {
            // angle (self-level) mode on roll and pitch.
            // body axes in world: right = (r00, r10, r20), up = (r01, r11, r21), back = (r02, r12, r22)
            const rollDeg = datan2(-r10, r11) * RAD2DEG; // right side below the horizon = roll right
            const pitchDeg = datan2(r12, Math.sqrt(r02 * r02 + r22 * r22)) * RAD2DEG; // nose down +
            const tgtR = ch[0] * ANGLE_MAX_DEG;
            const tgtP = ch[1] * ANGLE_MAX_DEG;
            spR = (tgtR - rollDeg) * ANGLE_GAIN;
            spP = (tgtP - pitchDeg) * ANGLE_GAIN;
        }

        let thr: number;
        if (p.gravityMode === 'auto-throttle') {
            thr = autoThrottle(thrStick, this.hoverThr);
        } else {
            thr = throttleCurve(thrStick, p.throttle);
        }

        // ---- rate PID in Betaflight units ----
        const gR = this.gyroFilter(0, -wz * RAD2DEG);
        const gP = this.gyroFilter(1, -wx * RAD2DEG);
        const gY = this.gyroFilter(2, -wy * RAD2DEG);
        const sat = s[S.sat] > 0;
        const fcD = DTERM_DYN_MIN + (DTERM_DYN_MAX - DTERM_DYN_MIN) * (thr < 0 ? 0 : thr > 1 ? 1 : thr);
        const kD1 = PT1(fcD);
        const pidR = this.axisPid(0, spR, gR, p.pid.roll, sat, armed, 500, kD1);
        const pidP = this.axisPid(1, spP, gP, p.pid.pitch, sat, armed, 500, kD1);
        const pidY = this.axisPid(2, spY, gY, p.pid.yaw, sat, armed, 400, kD1);

        // ---- mixer with airmode ----
        const out = this.motorsOut;
        if (armed) {
            let mn = Infinity, mx = -Infinity;
            for (let i = 0; i < 4; i++) {
                const m = pidR * MIX_R[i] + pidP * MIX_P[i] + pidY * MIX_Y[i];
                out[i] = m;
                if (m < mn) mn = m;
                if (m > mx) mx = m;
            }
            const range = mx - mn;
            let t = thr;
            if (range > 1) {
                const inv = 1 / range;
                for (let i = 0; i < 4; i++) out[i] *= inv;
                mn *= inv; mx *= inv;
            }
            t = t < -mn ? -mn : t > 1 - mx ? 1 - mx : t;
            s[S.sat] = range > 1 ? 1 : 0;
            for (let i = 0; i < 4; i++) {
                let v = out[i] + t;
                v = v < 0 ? 0 : v > 1 ? 1 : v;
                out[i] = p.idle + (1 - p.idle) * v;
            }
        } else {
            for (let i = 0; i < 4; i++) out[i] = 0;
            s[S.sat] = 0;
        }

        // ---- motors ----
        const volt = s[S.volt];
        const vr = volt / p.vNom;
        const tmax = p.tmaxMotorNom * vr * vr;
        const th = this.thrust;
        let tSum = 0;
        let tauX = 0, tauY = 0, tauZ = 0;
        let power = 0;
        const mp = p.motorPos;
        const a = p.tau > 0 ? DT / p.tau : 1;
        const aa = a > 1 ? 1 : a;
        for (let i = 0; i < 4; i++) {
            const k = S.m0 + i;
            s[k] += (out[i] - s[k]) * aa;
            const w = s[k];
            const T = tmax * w * w;
            th[i] = T;
            tSum += T;
            // r x (0, T, 0) = (-rz T, 0, rx T)
            tauX += -mp[i * 3 + 2] * T;
            tauZ += mp[i * 3] * T;
            tauY += p.motorYaw[i] * p.kappa * T;
            power += p.kappa * T * (w * p.omegaMaxPerVolt * volt);
        }

        // ---- battery ----
        const amps = volt > 0.1 ? power / (p.eta * volt) : 0;
        let soc = s[S.soc] - (amps * DT) / p.capacityAs;
        if (soc < 0) soc = 0;
        s[S.soc] = soc;
        s[S.amps] = amps;
        s[S.volt] = p.cells * cellVoc(soc) - amps * p.rPack;

        // ---- forces (world) ----
        const vx = s[S.vx], vy = s[S.vy], vz = s[S.vz];
        // velocity in body frame: R^T v
        const bvx = r00 * vx + r10 * vy + r20 * vz;
        const bvy = r01 * vx + r11 * vy + r21 * vz;
        const bvz = r02 * vx + r12 * vy + r22 * vz;
        const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
        const kd = -0.5 * p.rho * speed;
        const dbx = kd * p.cda[0] * bvx;
        const dby = kd * p.cda[1] * bvy + tSum;
        const dbz = kd * p.cda[2] * bvz;
        const fx = r00 * dbx + r01 * dby + r02 * dbz;
        const fy = r10 * dbx + r11 * dby + r12 * dbz - p.mass * p.gravity;
        const fz = r20 * dbx + r21 * dby + r22 * dbz;

        // ---- integrate (semi-implicit Euler) ----
        const px0 = s[S.px], py0 = s[S.py], pz0 = s[S.pz];
        const q0w = qw, q0x = qx, q0y = qy, q0z = qz;
        const invM = 1 / p.mass;
        const nvx = vx + fx * invM * DT;
        const nvy = vy + fy * invM * DT;
        const nvz = vz + fz * invM * DT;
        s[S.vx] = nvx; s[S.vy] = nvy; s[S.vz] = nvz;
        s[S.px] = px0 + nvx * DT; s[S.py] = py0 + nvy * DT; s[S.pz] = pz0 + nvz * DT;

        // Rotation: I w' = tau - w x I w, integrated through the world-frame angular momentum
        // (L_w += R tau dt), which keeps |L| exact when no torque acts; w follows from the new
        // attitude. Semi-implicit: the attitude update uses the predicted new w.
        const I0 = p.inertia[0], I1 = p.inertia[1], I2 = p.inertia[2];
        const lbx = I0 * wx, lby = I1 * wy, lbz = I2 * wz;
        const lwx = r00 * lbx + r01 * lby + r02 * lbz + (r00 * tauX + r01 * tauY + r02 * tauZ) * DT;
        const lwy = r10 * lbx + r11 * lby + r12 * lbz + (r10 * tauX + r11 * tauY + r12 * tauZ) * DT;
        const lwz = r20 * lbx + r21 * lby + r22 * lbz + (r20 * tauX + r21 * tauY + r22 * tauZ) * DT;
        // predictor with the old attitude
        const pwx = (r00 * lwx + r10 * lwy + r20 * lwz) / I0;
        const pwy = (r01 * lwx + r11 * lwy + r21 * lwz) / I1;
        const pwz = (r02 * lwx + r12 * lwy + r22 * lwz) / I2;
        integrateQuat(s, pwx, pwy, pwz);
        const aw = s[S.qw], ax = s[S.qx], ay = s[S.qy], az = s[S.qz];
        const n00 = 1 - 2 * (ay * ay + az * az), n01 = 2 * (ax * ay - aw * az), n02 = 2 * (ax * az + aw * ay);
        const n10 = 2 * (ax * ay + aw * az), n11 = 1 - 2 * (ax * ax + az * az), n12 = 2 * (ay * az - aw * ax);
        const n20 = 2 * (ax * az - aw * ay), n21 = 2 * (ay * az + aw * ax), n22 = 1 - 2 * (ax * ax + ay * ay);
        s[S.wx] = (n00 * lwx + n10 * lwy + n20 * lwz) / I0;
        s[S.wy] = (n01 * lwx + n11 * lwy + n21 * lwz) / I1;
        s[S.wz] = (n02 * lwx + n12 * lwy + n22 * lwz) / I2;

        // ---- contact ----
        if (this.world) this.contact(px0, py0, pz0, q0w, q0x, q0y, q0z);

        // crashed body settling: rest detection and 4 s cap
        if (s[S.crashed] > 0) {
            s[S.crashT] += DT;
            const v2 = s[S.vx] * s[S.vx] + s[S.vy] * s[S.vy] + s[S.vz] * s[S.vz];
            const w2 = s[S.wx] * s[S.wx] + s[S.wy] * s[S.wy] + s[S.wz] * s[S.wz];
            if (v2 < 0.0025 && w2 < 0.25) s[S.restT] += DT; else s[S.restT] = 0;
            if (s[S.restT] >= 0.5 || s[S.crashT] >= 4) {
                if (s[S.crashed] === 1) {
                    s[S.crashed] = 2; // settled
                    this.events.push({ type: 'rest', tick: this.tick });
                }
                s[S.vx] = s[S.vy] = s[S.vz] = 0;
                s[S.wx] = s[S.wy] = s[S.wz] = 0;
                s[S.px] = px0; s[S.py] = py0; s[S.pz] = pz0;
                s[S.qw] = q0w; s[S.qx] = q0x; s[S.qy] = q0y; s[S.qz] = q0z;
            }
        }
    }

    /** throttle output at which the craft hovers (fresh pack), used by auto-throttle */
    hoverThr = 0.4;

    private gyroFilter(ax: number, raw: number): number {
        const s = this.s;
        const a = S.g1R + ax, b = S.g2R + ax;
        s[a] += (raw - s[a]) * K_GYRO1;
        s[b] += (s[a] - s[b]) * K_GYRO2;
        return s[b];
    }

    private axisPid(ax: number, sp: number, gyro: number, g: number[], sat: boolean, armed: boolean, limit: number, kD1: number): number {
        const s = this.s;
        const iK = S.iR + ax, dK = S.dfR + ax, fK = S.ffR + ax, spK = S.spR + ax;
        const e = sp - gyro;
        // D on the gyro through the D-term filter chain
        const d1 = s[dK] + (gyro - s[dK]) * kD1;
        s[dK] = d1;
        const d2K = S.d2R + ax;
        const prevD = s[d2K];
        const dNow = prevD + (d1 - prevD) * K_DTERM2;
        s[d2K] = dNow;
        const dTerm = -g[2] * D_SCALE * ((dNow - prevD) / DT);
        // feed-forward on setpoint derivative, PT1 filtered
        const spDelta = (sp - s[spK]) / DT;
        s[spK] = sp;
        const ffPrev = s[fK];
        const ffRaw = g[3] * F_SCALE * spDelta;
        const ff = ffPrev + (ffRaw - ffPrev) * K_FF;
        s[fK] = ff;
        // I with iterm relax (roll, pitch) and no windup while saturated or disarmed
        let iErr = e;
        if (ax < 2) {
            const lK = S.splR + ax;
            const lpf = s[lK] + (sp - s[lK]) * K_RELAX;
            s[lK] = lpf;
            const hp = sp - lpf;
            const relax = 1 - (hp < 0 ? -hp : hp) / RELAX_THRESHOLD;
            iErr = e * (relax > 0 ? relax : 0);
        }
        if (armed && !sat) {
            let I = s[iK] + g[1] * I_SCALE * iErr * DT;
            I = I < -ITERM_LIMIT ? -ITERM_LIMIT : I > ITERM_LIMIT ? ITERM_LIMIT : I;
            s[iK] = I;
        }
        if (!armed) s[iK] = 0;
        let sum = g[0] * P_SCALE * e + s[iK] + dTerm + ff;
        sum = sum < -limit ? -limit : sum > limit ? limit : sum;
        return sum / 1000;
    }

    private contact(px0: number, py0: number, pz0: number, q0w: number, q0x: number, q0y: number, q0z: number): void {
        const s = this.s;
        const p = this.p;
        const world = this.world!;
        const n = this.nS;
        const sp = p.spheres;
        // sphere centres at the start and end of the tick
        spherePoses(sp, n, px0, py0, pz0, q0w, q0x, q0y, q0z, this.c0);
        spherePoses(sp, n, s[S.px], s[S.py], s[S.pz], s[S.qw], s[S.qx], s[S.qy], s[S.qz], this.c1);
        // rotation chord error bound: d * dtheta^2 / 8
        const wmag = Math.sqrt(s[S.wx] * s[S.wx] + s[S.wy] * s[S.wy] + s[S.wz] * s[S.wz]);
        const dth = wmag * DT;
        for (let i = 0; i < n; i++) {
            const lx = sp[i * 4], ly = sp[i * 4 + 1], lz = sp[i * 4 + 2];
            const d = Math.sqrt(lx * lx + ly * ly + lz * lz);
            this.pad[i] = (d * dth * dth) / 8 + 1e-9;
        }
        const t = world.sweep(this.c0, this.c1, this.rr, this.pad, n, this.cout);
        if (t < 0) return;

        const k = this.cout.sphere;
        if (t === 0) {
            // started overlapping: push the craft out and stop
            this.startOverlaps++;
            const cx = this.c0[k * 3], cy = this.c0[k * 3 + 1], cz = this.c0[k * 3 + 2];
            if (world.pushOut(cx, cy, cz, this.rr[k] + 1e-4, this.push)) {
                s[S.px] = px0 + this.push.x; s[S.py] = py0 + this.push.y; s[S.pz] = pz0 + this.push.z;
            } else {
                s[S.px] = px0; s[S.py] = py0; s[S.pz] = pz0;
            }
            s[S.qw] = q0w; s[S.qx] = q0x; s[S.qy] = q0y; s[S.qz] = q0z;
        } else {
            // move to the contact position (translation interpolated, keep start rotation)
            s[S.px] = px0 + (s[S.px] - px0) * t;
            s[S.py] = py0 + (s[S.py] - py0) * t;
            s[S.pz] = pz0 + (s[S.pz] - pz0) * t;
            s[S.qw] = q0w; s[S.qx] = q0x; s[S.qy] = q0y; s[S.qz] = q0z;
            // keep a small skin so tangential motion along the surface is not reported as contact
            const kx = this.c0[k * 3] + (s[S.px] - px0), ky = this.c0[k * 3 + 1] + (s[S.py] - py0), kz = this.c0[k * 3 + 2] + (s[S.pz] - pz0);
            const sx = this.cout.nx * SKIN, sy = this.cout.ny * SKIN, sz = this.cout.nz * SKIN;
            if (!world.pushOut(kx + sx, ky + sy, kz + sz, this.rr[k], this.push)) {
                s[S.px] += sx; s[S.py] += sy; s[S.pz] += sz;
            }
        }

        // contact geometry
        const nx = this.cout.nx, ny = this.cout.ny, nz = this.cout.nz;
        const qw = s[S.qw], qx = s[S.qx], qy = s[S.qy], qz = s[S.qz];
        const lx = sp[k * 4], ly = sp[k * 4 + 1], lz = sp[k * 4 + 2], rk = sp[k * 4 + 3];
        // world offset of the sphere centre from the COM, then to the contact point
        const r00 = 1 - 2 * (qy * qy + qz * qz), r01 = 2 * (qx * qy - qw * qz), r02 = 2 * (qx * qz + qw * qy);
        const r10 = 2 * (qx * qy + qw * qz), r11 = 1 - 2 * (qx * qx + qz * qz), r12 = 2 * (qy * qz - qw * qx);
        const r20 = 2 * (qx * qz - qw * qy), r21 = 2 * (qy * qz + qw * qx), r22 = 1 - 2 * (qx * qx + qy * qy);
        const ox = r00 * lx + r01 * ly + r02 * lz - nx * rk;
        const oy = r10 * lx + r11 * ly + r12 * lz - ny * rk;
        const oz = r20 * lx + r21 * ly + r22 * lz - nz * rk;
        // angular velocity in world
        const bwx = s[S.wx], bwy = s[S.wy], bwz = s[S.wz];
        const wwx = r00 * bwx + r01 * bwy + r02 * bwz;
        const wwy = r10 * bwx + r11 * bwy + r12 * bwz;
        const wwz = r20 * bwx + r21 * bwy + r22 * bwz;
        // contact point velocity v + w x r
        const cvx = s[S.vx] + (wwy * oz - wwz * oy);
        const cvy = s[S.vy] + (wwz * ox - wwx * oz);
        const cvz = s[S.vz] + (wwx * oy - wwy * ox);
        const vn = cvx * nx + cvy * ny + cvz * nz; // < 0 approaching
        const approach = -vn;

        const flying = s[S.crashed] === 0;
        if (flying && approach >= p.vCrash) {
            s[S.crashed] = 1;
            s[S.crashT] = 0;
            s[S.restT] = 0;
            if (s[S.armed] > 0) {
                s[S.armed] = 0;
                this.events.push({ type: 'disarm', tick: this.tick, reason: 'crash' });
            }
            for (let i = 0; i < 4; i++) s[S.m0 + i] = 0;
            this.events.push({
                type: 'crash', tick: this.tick, speed: approach, nx, ny, nz,
                px: s[S.px] + ox, py: s[S.py] + oy, pz: s[S.pz] + oz
            });
        } else if (flying && approach > 0.05) {
            this.events.push({ type: 'contact', tick: this.tick, speed: approach, regime: approach >= p.vBounce ? 'bounce' : 'slide' });
        }
        if (approach <= 0) return;

        // impulse with speed-dependent restitution and Coulomb friction
        let e: number;
        if (s[S.crashed] > 0) e = 0.3 / (1 + approach * 0.5);
        else if (approach < p.vBounce) e = 0.1;
        else e = 0.35 / (1 + (approach - p.vBounce) * 0.5);

        const I0 = this.p.inertia[0], I1 = this.p.inertia[1], I2 = this.p.inertia[2];
        // effective mass along n: 1/m + n . ((I^-1 (r x n)) x r), inertia in body frame
        const effN = invEff(nx, ny, nz, ox, oy, oz, r00, r01, r02, r10, r11, r12, r20, r21, r22, I0, I1, I2);
        const jn = ((1 + e) * approach) / (1 / p.mass + effN);
        let ix = nx * jn, iy = ny * jn, iz = nz * jn;
        // tangential velocity
        const tvx = cvx - vn * nx, tvy = cvy - vn * ny, tvz = cvz - vn * nz;
        const tv = Math.sqrt(tvx * tvx + tvy * tvy + tvz * tvz);
        if (tv > 1e-9) {
            const tx = tvx / tv, ty = tvy / tv, tz = tvz / tv;
            const effT = invEff(tx, ty, tz, ox, oy, oz, r00, r01, r02, r10, r11, r12, r20, r21, r22, I0, I1, I2);
            let jt = tv / (1 / p.mass + effT);
            if (jt > MU * jn) jt = MU * jn;
            ix -= tx * jt; iy -= ty * jt; iz -= tz * jt;
        }
        applyImpulse(s, p.mass, ix, iy, iz, ox, oy, oz, r00, r01, r02, r10, r11, r12, r20, r21, r22, I0, I1, I2);
    }
}

/** throttle mapping for auto-throttle gravity mode: stick 0.5 -> hover. */
function autoThrottle(u: number, hover: number): number {
    const h = hover < 0.02 ? 0.02 : hover > 0.98 ? 0.98 : hover;
    return u <= 0.5 ? (u / 0.5) * h : h + ((u - 0.5) / 0.5) * (1 - h);
}

function invEff(
    nx: number, ny: number, nz: number, ox: number, oy: number, oz: number,
    r00: number, r01: number, r02: number, r10: number, r11: number, r12: number, r20: number, r21: number, r22: number,
    I0: number, I1: number, I2: number
): number {
    // c = r x n (world) -> body -> I^-1 -> world -> x r -> . n
    const cx = oy * nz - oz * ny, cy = oz * nx - ox * nz, cz = ox * ny - oy * nx;
    const bx = (r00 * cx + r10 * cy + r20 * cz) / I0;
    const by = (r01 * cx + r11 * cy + r21 * cz) / I1;
    const bz = (r02 * cx + r12 * cy + r22 * cz) / I2;
    const wx = r00 * bx + r01 * by + r02 * bz;
    const wy = r10 * bx + r11 * by + r12 * bz;
    const wz = r20 * bx + r21 * by + r22 * bz;
    const kx = wy * oz - wz * oy, ky = wz * ox - wx * oz, kz = wx * oy - wy * ox;
    return kx * nx + ky * ny + kz * nz;
}

function applyImpulse(
    s: Float64Array, m: number, ix: number, iy: number, iz: number, ox: number, oy: number, oz: number,
    r00: number, r01: number, r02: number, r10: number, r11: number, r12: number, r20: number, r21: number, r22: number,
    I0: number, I1: number, I2: number
): void {
    s[S.vx] += ix / m; s[S.vy] += iy / m; s[S.vz] += iz / m;
    const tx = oy * iz - oz * iy, ty = oz * ix - ox * iz, tz = ox * iy - oy * ix;
    s[S.wx] += (r00 * tx + r10 * ty + r20 * tz) / I0;
    s[S.wy] += (r01 * tx + r11 * ty + r21 * tz) / I1;
    s[S.wz] += (r02 * tx + r12 * ty + r22 * tz) / I2;
}

/** q <- q * exp(w dt / 2), renormalised. */
function integrateQuat(s: Float64Array, wx: number, wy: number, wz: number): void {
    const wm = Math.sqrt(wx * wx + wy * wy + wz * wz);
    const half = wm * DT * 0.5;
    let dw = 1, dx = 0, dy = 0, dz = 0;
    if (wm > 1e-12) {
        const sn = dsin(half) / wm;
        dw = dcos(half);
        dx = wx * sn; dy = wy * sn; dz = wz * sn;
    }
    const qw = s[S.qw], qx = s[S.qx], qy = s[S.qy], qz = s[S.qz];
    let nw = qw * dw - qx * dx - qy * dy - qz * dz;
    let nx = qw * dx + qx * dw + qy * dz - qz * dy;
    let ny = qw * dy - qx * dz + qy * dw + qz * dx;
    let nz = qw * dz + qx * dy - qy * dx + qz * dw;
    const inv = 1 / Math.sqrt(nw * nw + nx * nx + ny * ny + nz * nz);
    nw *= inv; nx *= inv; ny *= inv; nz *= inv;
    s[S.qw] = nw; s[S.qx] = nx; s[S.qy] = ny; s[S.qz] = nz;
}

/** World centres of the body spheres for pose (p, q). */
export function spherePoses(
    sp: Float64Array, n: number, px: number, py: number, pz: number,
    qw: number, qx: number, qy: number, qz: number, out: Float64Array
): void {
    const r00 = 1 - 2 * (qy * qy + qz * qz), r01 = 2 * (qx * qy - qw * qz), r02 = 2 * (qx * qz + qw * qy);
    const r10 = 2 * (qx * qy + qw * qz), r11 = 1 - 2 * (qx * qx + qz * qz), r12 = 2 * (qy * qz - qw * qx);
    const r20 = 2 * (qx * qz - qw * qy), r21 = 2 * (qy * qz + qw * qx), r22 = 1 - 2 * (qx * qx + qy * qy);
    for (let i = 0; i < n; i++) {
        const lx = sp[i * 4], ly = sp[i * 4 + 1], lz = sp[i * 4 + 2];
        out[i * 3] = px + r00 * lx + r01 * ly + r02 * lz;
        out[i * 3 + 1] = py + r10 * lx + r11 * ly + r12 * lz;
        out[i * 3 + 2] = pz + r20 * lx + r21 * ly + r22 * lz;
    }
}

/** Attitude helpers for HUD / bot (deterministic). Degrees. */
export function attitude(s: Float64Array): { roll: number; pitch: number; yaw: number } {
    const qw = s[S.qw], qx = s[S.qx], qy = s[S.qy], qz = s[S.qz];
    // body axes in world: right (r00,r10,r20), up (r01,r11,r21), back (r02,r12,r22)
    const r10 = 2 * (qx * qy + qw * qz);
    const r11 = 1 - 2 * (qx * qx + qz * qz);
    const r02 = 2 * (qx * qz + qw * qy), r12 = 2 * (qy * qz - qw * qx), r22 = 1 - 2 * (qx * qx + qy * qy);
    // heading of the nose (-back) on the ground, right turn positive, 0 = -z
    const yaw = datan2(-r02, r22) * RAD2DEG;
    // nose below the horizon = positive pitch
    const pitch = datan2(r12, Math.sqrt(r02 * r02 + r22 * r22)) * RAD2DEG;
    // right side below the horizon = positive roll
    const roll = datan2(-r10, r11) * RAD2DEG;
    return { roll, pitch, yaw };
}
