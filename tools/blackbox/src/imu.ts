// Attitude from the logged gyro and accelerometer, for the drag fit.
//
// A Mahony complementary filter (Mahony, Hamel, Pflimlin, "Nonlinear complementary filters on the
// special orthogonal group", IEEE TAC 2008) in the Betaflight body frame (x forward, y left, z up),
// with one change that matters offline: the accelerometer corrects the attitude only while it
// measures gravity alone, i.e. while the in-plane specific force is near zero (level and not
// accelerating sideways). A flight controller also corrects during fast flight and coast-downs,
// where drag tilts the specific force; that biases its attitude by degrees exactly when the drag fit
// needs it. Between those still moments the attitude is the integrated gyro. Yaw is free: it only
// turns the horizontal plane, which the fit does not need.

import { lowpass } from './math';
import type { Signals } from './signals';

export interface Attitude {
    /** + = right side down, rad */
    roll: Float64Array;
    /** + = nose down, rad */
    pitch: Float64Array;
    /** body -> earth rotation, 9 numbers per sample, row-major */
    R: Float64Array;
    /** 1 where the accelerometer corrected the attitude (level, still) */
    still: Uint8Array;
    /** RMS difference to the flight controller's own estimate (debug ATTITUDE), deg; null without it */
    fcDiffDeg: { roll: number; pitch: number } | null;
}

function fromQuat(w: number, x: number, y: number, z: number, R: Float64Array, o: number): void {
    R[o] = 1 - 2 * (y * y + z * z);
    R[o + 1] = 2 * (x * y - w * z);
    R[o + 2] = 2 * (x * z + w * y);
    R[o + 3] = 2 * (x * y + w * z);
    R[o + 4] = 1 - 2 * (x * x + z * z);
    R[o + 5] = 2 * (y * z - w * x);
    R[o + 6] = 2 * (x * z - w * y);
    R[o + 7] = 2 * (y * z + w * x);
    R[o + 8] = 1 - 2 * (x * x + y * y);
}

export function estimateAttitude(sig: Signals): Attitude {
    const n = sig.n;
    const R = new Float64Array(n * 9);
    const roll = new Float64Array(n);
    const pitch = new Float64Array(n);
    const still = new Uint8Array(n);
    const fs = 1 / sig.dt;
    const acc = sig.acc ? sig.acc.map((a) => lowpass(a, fs, 10)) : null;
    let w = 1, x = 0, y = 0, z = 0;
    let bx = 0, by = 0, bz = 0; // gyro bias estimate (integral term)
    let run = 0; // consecutive samples that look like gravity alone
    const runNeeded = Math.round(0.5 / sig.dt);
    const [gx, gy, gz] = sig.gyro;
    for (let k = 0; k < n; k++) {
        const dt = k > 0 ? Math.min(0.02, Math.max(0, sig.t[k] - sig.t[k - 1])) : 0;
        let ox = gx[k] - bx, oy = gy[k] - by, oz = gz[k] - bz;
        if (acc) {
            const ax = acc[0][k], ay = acc[1][k], az = acc[2][k];
            const nrm = Math.sqrt(ax * ax + ay * ay + az * az);
            const rate = Math.sqrt(gx[k] * gx[k] + gy[k] * gy[k] + gz[k] * gz[k]);
            // gravity alone: 1 g, (almost) no in-plane force, slow rotation, for 0.5 s in a row; the
            // first second always corrects (the quad sits on the ground or hovers after arming)
            run = Math.abs(nrm - 1) < 0.02 && Math.hypot(ax, ay) < 0.02 && rate < 0.2 ? run + 1 : 0;
            const gate = sig.t[k] < 1 || run >= runNeeded;
            if (gate && nrm > 0.5) {
                still[k] = sig.t[k] < 1 ? 0 : 1;
                const vx = 2 * (x * z - w * y), vy = 2 * (y * z + w * x), vz = 1 - 2 * (x * x + y * y);
                const ex = (ay * vz - az * vy) / nrm, ey = (az * vx - ax * vz) / nrm, ez = (ax * vy - ay * vx) / nrm;
                const kp = sig.t[k] < 1 ? 5 : 1;
                ox += kp * ex;
                oy += kp * ey;
                oz += kp * ez;
                if (sig.t[k] >= 1) {
                    bx -= 0.05 * ex * dt;
                    by -= 0.05 * ey * dt;
                    bz -= 0.05 * ez * dt;
                }
            }
        }
        const h = 0.5 * dt;
        const nw = w + (-x * ox - y * oy - z * oz) * h;
        const nx = x + (w * ox + y * oz - z * oy) * h;
        const ny = y + (w * oy - x * oz + z * ox) * h;
        const nz = z + (w * oz + x * oy - y * ox) * h;
        const inv = 1 / Math.sqrt(nw * nw + nx * nx + ny * ny + nz * nz);
        w = nw * inv; x = nx * inv; y = ny * inv; z = nz * inv;
        fromQuat(w, x, y, z, R, k * 9);
        roll[k] = Math.atan2(R[k * 9 + 7], R[k * 9 + 8]);
        pitch[k] = Math.asin(Math.max(-1, Math.min(1, -R[k * 9 + 6])));
    }
    let fcDiffDeg: Attitude['fcDiffDeg'] = null;
    if (sig.fcAttitude) {
        let sr = 0, sp = 0;
        for (let k = 0; k < n; k++) {
            sr += (roll[k] - sig.fcAttitude.roll[k]) ** 2;
            sp += (pitch[k] - sig.fcAttitude.pitch[k]) ** 2;
        }
        fcDiffDeg = { roll: (Math.sqrt(sr / n) * 180) / Math.PI, pitch: (Math.sqrt(sp / n) * 180) / Math.PI };
    }
    return { roll, pitch, R, still, fcDiffDeg };
}
