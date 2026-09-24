// Bot pilot: a closed-loop "perfect pilot" that flies the simulator through the SAME input
// pipeline as a human (it only produces stick channels). Used to fly every automated test.
//
// Outer loop: position/velocity -> desired thrust vector. Attitude: geometric error on SO(3)
// -> body-rate setpoints -> sticks via the inverse of the craft's own rate curve (acro mode).
// Throttle: required thrust -> motor output at the current pack voltage -> stick.

import { S, invertRate, dsin, dcos, DEG2RAD, RAD2DEG } from '@gsfpv/sim-core';
import type { Sim, SimParams } from '@gsfpv/sim-core';

export type BotTask =
    | { kind: 'idle' }
    | { kind: 'hover'; target: [number, number, number]; yawDeg: number }
    | { kind: 'path'; points: [number, number, number][]; speed: number; yawDeg: number }
    | { kind: 'dash'; from: [number, number, number]; dir: [number, number, number]; speed: number; yawDeg: number };

export interface BotStatus {
    task: string;
    waypoint: number;
    done: boolean;
}

export class BotPilot {
    readonly p: SimParams;
    task: BotTask = { kind: 'idle' };
    armed = false;
    private t0 = 0;
    private wp = 0;
    private dashT0 = -1;
    readonly ch = new Float64Array(8);
    status: BotStatus = { task: 'idle', waypoint: 0, done: false };
    kp = 6;
    kd = 4.5;
    kR = 14;
    aMax = 25;
    tiltMaxDeg = 75;
    /** waypoint acceptance radius, m */
    acceptRadius = 0.1;

    constructor(p: SimParams) {
        this.p = p;
        this.ch[2] = -1;
        this.ch[4] = -1;
    }

    setTask(t: BotTask, sim: Sim): void {
        this.task = t;
        this.wp = 0;
        this.dashT0 = -1;
        this.t0 = sim.tick;
        this.status = { task: t.kind, waypoint: 0, done: false };
    }

    /** Arm sequence: switch off -> on with throttle low. Call once per bot tick. */
    private armSequence(sim: Sim): boolean {
        if (sim.armed) return true;
        const ch = this.ch;
        ch[0] = 0; ch[1] = 0; ch[3] = 0; ch[2] = -1;
        ch[4] = ch[4] > 0 ? -1 : 1; // toggle until the sim reports armed
        return false;
    }

    /** Produce the channel frame for the current sim state. */
    update(sim: Sim): Float64Array {
        const ch = this.ch;
        const t = this.task;
        if (t.kind === 'idle' || sim.crashed) {
            ch[0] = 0; ch[1] = 0; ch[3] = 0; ch[2] = -1;
            if (sim.crashed) ch[4] = -1;
            return ch;
        }
        if (!this.armSequence(sim)) return ch;
        ch[4] = 1;
        const s = sim.s;
        const px = s[S.px], py = s[S.py], pz = s[S.pz];
        let tx = px, ty = py, tz = pz, vtx = 0, vty = 0, vtz = 0;
        if (t.kind === 'hover') {
            [tx, ty, tz] = t.target;
        } else if (t.kind === 'path') {
            const target = t.points[Math.min(this.wp, t.points.length - 1)];
            const dx = target[0] - px, dy = target[1] - py, dz = target[2] - pz;
            const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
            const accept = this.acceptRadius;
            if (d < accept && this.wp < t.points.length - 1) this.wp++;
            else if (d < accept && this.wp === t.points.length - 1) this.status.done = true;
            this.status.waypoint = this.wp;
            const sp = Math.min(t.speed, d * 1.5);
            if (d > 1e-6) { vtx = (dx / d) * sp; vty = (dy / d) * sp; vtz = (dz / d) * sp; }
            tx = px + vtx * 0.15; ty = py + vty * 0.15; tz = pz + vtz * 0.15;
            if (this.wp === t.points.length - 1 && d < 0.6) { [tx, ty, tz] = target; vtx = vty = vtz = 0; }
        } else if (t.kind === 'dash') {
            if (this.dashT0 < 0) this.dashT0 = sim.tick;
            const el = (sim.tick - this.dashT0) / 1000;
            // accelerate at 12 m/s^2 up to speed, then hold it; lateral error pulled to the line
            const accelT = t.speed / 12;
            const along = el < accelT ? 0.5 * 12 * el * el : 0.5 * 12 * accelT * accelT + (el - accelT) * t.speed;
            const vAlong = el < accelT ? 12 * el : t.speed;
            tx = t.from[0] + t.dir[0] * along; ty = t.from[1] + t.dir[1] * along; tz = t.from[2] + t.dir[2] * along;
            vtx = t.dir[0] * vAlong; vty = t.dir[1] * vAlong; vtz = t.dir[2] * vAlong;
        }
        const yawDeg = t.yawDeg;

        // desired acceleration
        let ax = this.kp * (tx - px) + this.kd * (vtx - s[S.vx]);
        let ay = this.kp * (ty - py) + this.kd * (vty - s[S.vy]);
        let az = this.kp * (tz - pz) + this.kd * (vtz - s[S.vz]);
        const ah = Math.sqrt(ax * ax + az * az);
        if (ah > this.aMax) { ax *= this.aMax / ah; az *= this.aMax / ah; }
        if (ay > 20) ay = 20; if (ay < -8) ay = -8;
        // drag feed-forward (horizontal area)
        const vx = s[S.vx], vy = s[S.vy], vz = s[S.vz];
        const v = Math.sqrt(vx * vx + vy * vy + vz * vz);
        const kdrag = (0.5 * this.p.rho * this.p.cda[0] * v) / this.p.mass;
        let fx = this.p.mass * (ax + kdrag * vx);
        let fy = this.p.mass * (ay + this.p.gravity + kdrag * vy);
        let fz = this.p.mass * (az + kdrag * vz);
        // tilt limit
        const tiltMax = this.tiltMaxDeg * DEG2RAD;
        const fh = Math.sqrt(fx * fx + fz * fz);
        if (fy < 1e-3) fy = 1e-3;
        const maxH = fy * Math.tan(tiltMax);
        if (fh > maxH) { fx *= maxH / fh; fz *= maxH / fh; }
        const T = Math.sqrt(fx * fx + fy * fy + fz * fz);
        const b3x = fx / T, b3y = fy / T, b3z = fz / T;
        // desired back axis: opposite the heading, made orthogonal to b3
        const hx = dsin(yawDeg * DEG2RAD), hz = -dcos(yawDeg * DEG2RAD);
        let zx = -hx, zy = 0, zz = -hz;
        const dz = zx * b3x + zy * b3y + zz * b3z;
        zx -= dz * b3x; zy -= dz * b3y; zz -= dz * b3z;
        const zn = Math.sqrt(zx * zx + zy * zy + zz * zz);
        zx /= zn; zy /= zn; zz /= zn;
        // x = y cross z
        const xx = b3y * zz - b3z * zy, xy = b3z * zx - b3x * zz, xz = b3x * zy - b3y * zx;
        // current rotation
        const qw = s[S.qw], qx = s[S.qx], qy = s[S.qy], qz = s[S.qz];
        const r00 = 1 - 2 * (qy * qy + qz * qz), r01 = 2 * (qx * qy - qw * qz), r02 = 2 * (qx * qz + qw * qy);
        const r10 = 2 * (qx * qy + qw * qz), r11 = 1 - 2 * (qx * qx + qz * qz), r12 = 2 * (qy * qz - qw * qx);
        const r20 = 2 * (qx * qz - qw * qy), r21 = 2 * (qy * qz + qw * qx), r22 = 1 - 2 * (qx * qx + qy * qy);
        // M = Rd^T R ; e_R = 1/2 vee(M - M^T)
        const d00 = xx, d10 = xy, d20 = xz; // Rd columns: x, y(b3), z
        const d01 = b3x, d11 = b3y, d21 = b3z;
        const d02 = zx, d12 = zy, d22 = zz;
        const m01 = d00 * r01 + d10 * r11 + d20 * r21;
        const m02 = d00 * r02 + d10 * r12 + d20 * r22;
        const m10 = d01 * r00 + d11 * r10 + d21 * r20;
        const m12 = d01 * r02 + d11 * r12 + d21 * r22;
        const m20 = d02 * r00 + d12 * r10 + d22 * r20;
        const m21 = d02 * r01 + d12 * r11 + d22 * r21;
        const ex = 0.5 * (m21 - m12);
        const ey = 0.5 * (m02 - m20);
        const ez = 0.5 * (m10 - m01);
        let wx = -this.kR * ex, wy = -this.kR * ey, wz = -this.kR * ez;
        const wm = Math.sqrt(wx * wx + wy * wy + wz * wz);
        const wMax = 12;
        if (wm > wMax) { wx *= wMax / wm; wy *= wMax / wm; wz *= wMax / wm; }
        const rc = this.p.rates;
        ch[0] = invertRate(rc.type, -wz * RAD2DEG, rc.roll, rc.rateLimit);
        ch[1] = invertRate(rc.type, -wx * RAD2DEG, rc.pitch, rc.rateLimit);
        ch[3] = invertRate(rc.type, -wy * RAD2DEG, rc.yaw, rc.rateLimit);
        // thrust along the current body up axis
        const upDot = b3x * r01 + b3y * r11 + b3z * r21;
        const tNeed = T / Math.max(0.3, upDot);
        const volt = s[S.volt];
        const tmax = this.p.tmaxMotorNom * (volt / this.p.vNom) * (volt / this.p.vNom);
        let out = Math.sqrt(Math.max(0, tNeed / 4 / tmax));
        if (out > 1) out = 1;
        let stick = (out - this.p.idle) / (1 - this.p.idle);
        stick = stick < 0 ? 0 : stick > 1 ? 1 : stick;
        ch[2] = stick * 2 - 1;
        ch[5] = 0;
        return ch;
    }
}

/** Find a horizontal direction from p with a wall between minD and maxD metres (ray per 10 deg). */
export function findWall(
    ray: (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number) => { x: number; y: number; z: number } | null,
    p: [number, number, number], minD = 2.5, maxD = 8
): { dir: [number, number, number]; dist: number; yawDeg: number } | null {
    let best: { dir: [number, number, number]; dist: number; yawDeg: number } | null = null;
    for (let a = 0; a < 360; a += 10) {
        const r = a * DEG2RAD;
        const dx = dsin(r), dz = -dcos(r);
        const h = ray(p[0], p[1], p[2], dx, 0, dz, maxD);
        if (!h) continue;
        const d = Math.sqrt((h.x - p[0]) ** 2 + (h.z - p[2]) ** 2);
        if (d >= minD && (!best || Math.abs(d - (minD + maxD) / 2) < Math.abs(best.dist - (minD + maxD) / 2))) {
            best = { dir: [dx, 0, dz], dist: d, yawDeg: a };
        }
    }
    return best;
}
