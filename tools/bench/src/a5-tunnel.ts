// A5: tunnelling. Straight passes at a fixed speed, stepped at the simulator's 1 ms tick through
// our swept test. An independent oracle — upstream querySphere, resampling the path every
// voxel/4, no sweep code — must find ZERO points where the body overlaps solid before the point
// where the sweep stopped it. Negative control: an endpoint-only test at frame steps (1/30 s,
// 1/144 s) must miss at least one collision, otherwise the harness is blind.

import type { VoxelCollision } from '@gsfpv/collision';
import { VoxelContactWorld } from '@gsfpv/collision';

export interface Body {
    local: Float64Array; // n x (x, y, z) body frame
    r: Float64Array;
    n: number;
}

export interface PassResult {
    sweepStopDist: number; // distance travelled before the sweep reported contact (Infinity = none)
    oracleFirstOverlap: number; // first oracle overlap distance along the path (Infinity = none)
    penetrations: number; // oracle overlaps before the sweep stop
    ctl30: 'ok' | 'tunnel' | 'late';
    ctl144: 'ok' | 'tunnel' | 'late';
}

export function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** World sphere centres for body position p and rotation matrix R (row-major 9). */
function centres(b: Body, px: number, py: number, pz: number, R: Float64Array, out: Float64Array): void {
    for (let i = 0; i < b.n; i++) {
        const lx = b.local[i * 3], ly = b.local[i * 3 + 1], lz = b.local[i * 3 + 2];
        out[i * 3] = px + R[0] * lx + R[1] * ly + R[2] * lz;
        out[i * 3 + 1] = py + R[3] * lx + R[4] * ly + R[5] * lz;
        out[i * 3 + 2] = pz + R[6] * lx + R[7] * ly + R[8] * lz;
    }
}

const push = { x: 0, y: 0, z: 0 };

/** Oracle: does the body overlap solid at path distance s? Upstream querySphere only. */
function oracleOverlap(col: VoxelCollision, b: Body, sx: number, sy: number, sz: number, dx: number, dy: number, dz: number, s: number, R: Float64Array, tmp: Float64Array): boolean {
    centres(b, sx + dx * s, sy + dy * s, sz + dz * s, R, tmp);
    for (let i = 0; i < b.n; i++) {
        if (col.querySphere(tmp[i * 3], tmp[i * 3 + 1], tmp[i * 3 + 2], b.r[i], push)) return true;
    }
    return false;
}

/**
 * Endpoint-only control: a frame-rate test that only looks at the body at frame endpoints.
 * 'tunnel' = the first frame endpoint after the body first touches solid is free again, i.e.
 * the body went through the obstacle between two free endpoints and the test never saw it.
 * 'late' = detected, but only after penetrating. 'ok' = nothing to hit on this path.
 */
function endpointOnly(col: VoxelCollision, b: Body, sx: number, sy: number, sz: number, dx: number, dy: number, dz: number, stepLen: number, firstOverlap: number, R: Float64Array, tmp: Float64Array): 'ok' | 'tunnel' | 'late' {
    if (firstOverlap === Infinity) return 'ok';
    const m = Math.ceil(firstOverlap / stepLen - 1e-12);
    const e = m * stepLen;
    return oracleOverlap(col, b, sx, sy, sz, dx, dy, dz, e, R, tmp) ? 'late' : 'tunnel';
}

export function runPass(
    col: VoxelCollision, world: VoxelContactWorld, b: Body,
    sx: number, sy: number, sz: number, dx: number, dy: number, dz: number,
    speed: number, maxLen: number, R: Float64Array, oracleStep: number,
    c0: Float64Array, c1: Float64Array, pad: Float64Array, tmp: Float64Array
): PassResult {
    const tickLen = speed * 0.001;
    const cout = { sphere: -1, nx: 0, ny: 0, nz: 0 };
    // --- our sweep, one sim tick at a time ---
    let s = 0;
    let stop = Infinity;
    while (s < maxLen) {
        const ns = Math.min(maxLen, s + tickLen);
        centres(b, sx + dx * s, sy + dy * s, sz + dz * s, R, c0);
        centres(b, sx + dx * ns, sy + dy * ns, sz + dz * ns, R, c1);
        const t = world.sweep(c0, c1, b.r, pad, b.n, cout);
        if (t >= 0) { stop = s + (ns - s) * t; break; }
        s = ns;
    }
    // --- oracle: resample [0, min(stop, maxLen)] every oracleStep, plus the stop point ---
    const end = Math.min(stop, maxLen);
    let penetrations = 0;
    let firstOverlap = Infinity;
    const nS = Math.ceil(end / oracleStep);
    for (let k = 0; k <= nS; k++) {
        const d = Math.min(end, k * oracleStep);
        if (oracleOverlap(col, b, sx, sy, sz, dx, dy, dz, d, R, tmp)) {
            penetrations++;
            if (d < firstOverlap) firstOverlap = d;
        }
    }
    // first oracle overlap along the whole pass (for the control), continuing past the stop
    if (firstOverlap === Infinity) {
        const nAll = Math.ceil(maxLen / oracleStep);
        for (let k = Math.max(0, nS - 1); k <= nAll; k++) {
            const d = Math.min(maxLen, k * oracleStep);
            if (oracleOverlap(col, b, sx, sy, sz, dx, dy, dz, d, R, tmp)) { firstOverlap = d; break; }
        }
    }
    const ctl30 = endpointOnly(col, b, sx, sy, sz, dx, dy, dz, speed / 30, firstOverlap, R, tmp);
    const ctl144 = endpointOnly(col, b, sx, sy, sz, dx, dy, dz, speed / 144, firstOverlap, R, tmp);
    return { sweepStopDist: stop, oracleFirstOverlap: firstOverlap, penetrations, ctl30, ctl144 };
}

/** Random rotation matrix (uniform quaternion) from rng. */
export function randomRotation(rng: () => number, out: Float64Array, levelish = false): void {
    let qw: number, qx: number, qy: number, qz: number;
    if (levelish) {
        // yaw anywhere, roll/pitch within +-45 deg: how a whoop actually flies
        const yaw = rng() * 2 * Math.PI, pitch = (rng() - 0.5) * Math.PI / 2, roll = (rng() - 0.5) * Math.PI / 2;
        const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2), cr = Math.cos(roll / 2), sr = Math.sin(roll / 2);
        qw = cy * cp * cr + sy * sp * sr; qx = cy * sp * cr + sy * cp * sr; qy = sy * cp * cr - cy * sp * sr; qz = cy * cp * sr - sy * sp * cr;
    } else {
        const u1 = rng(), u2 = rng(), u3 = rng();
        qw = Math.sqrt(1 - u1) * Math.sin(2 * Math.PI * u2); qx = Math.sqrt(1 - u1) * Math.cos(2 * Math.PI * u2);
        qy = Math.sqrt(u1) * Math.sin(2 * Math.PI * u3); qz = Math.sqrt(u1) * Math.cos(2 * Math.PI * u3);
    }
    out[0] = 1 - 2 * (qy * qy + qz * qz); out[1] = 2 * (qx * qy - qw * qz); out[2] = 2 * (qx * qz + qw * qy);
    out[3] = 2 * (qx * qy + qw * qz); out[4] = 1 - 2 * (qx * qx + qz * qz); out[5] = 2 * (qy * qz - qw * qx);
    out[6] = 2 * (qx * qz - qw * qy); out[7] = 2 * (qy * qz + qw * qx); out[8] = 1 - 2 * (qx * qx + qy * qy);
}
