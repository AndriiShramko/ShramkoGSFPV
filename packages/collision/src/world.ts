// Contact world for the flight model on top of the vendored voxel collision.
//
// Sweep guarantee: a sphere of radius r moving along a segment is inside the union of spheres
// of radius r + h centred at points spaced 2h apart along it (triangle inequality). So if
// every such inflated sphere is free, the whole swept volume is free — no step size can miss a
// wall. When an inflated test hits, the interval is bisected down to LEAF metres and the
// earliest flagged leaf is reported, so the reported contact is never later than the true one
// by more than LEAF. The overlap test below is our own code (it does not call querySphere),
// which keeps the tunnelling oracle — built on querySphere — independent of the sweep.

import type { VoxelCollision } from './vendor/voxel-collision';
import { PENETRATION_EPSILON } from './vendor/collision';

export const LEAF = 0.00025; // m, contact time resolution along the path

export interface ContactOut {
    sphere: number;
    nx: number;
    ny: number;
    nz: number;
}

export interface SweepStats {
    overlapTests: number;
}

/** True when a sphere overlaps any solid voxel by more than the upstream epsilon. */
export function sphereOverlaps(col: VoxelCollision, xw: number, yw: number, z: number, r: number): boolean {
    if (col.nodes.length === 0 || r <= PENETRATION_EPSILON) return false;
    const flip = col.flipXY;
    const x = flip ? -xw : xw;
    const y = flip ? -yw : yw;
    const res = col.voxelResolution;
    const gx = col.gridMinX, gy = col.gridMinY, gz = col.gridMinZ;
    const ixMin = Math.floor((x - r - gx) / res), ixMax = Math.floor((x + r - gx) / res);
    const iyMin = Math.floor((y - r - gy) / res), iyMax = Math.floor((y + r - gy) / res);
    const izMin = Math.floor((z - r - gz) / res), izMax = Math.floor((z + r - gz) / res);
    const lim = r - PENETRATION_EPSILON;
    const lim2 = lim * lim;
    for (let iz = izMin; iz <= izMax; iz++) {
        const vz0 = gz + iz * res;
        const nz = z < vz0 ? vz0 : z > vz0 + res ? vz0 + res : z;
        const dz = z - nz;
        const dz2 = dz * dz;
        if (dz2 >= lim2) continue;
        for (let iy = iyMin; iy <= iyMax; iy++) {
            const vy0 = gy + iy * res;
            const ny = y < vy0 ? vy0 : y > vy0 + res ? vy0 + res : y;
            const dy = y - ny;
            const dyz = dz2 + dy * dy;
            if (dyz >= lim2) continue;
            for (let ix = ixMin; ix <= ixMax; ix++) {
                const vx0 = gx + ix * res;
                const nx = x < vx0 ? vx0 : x > vx0 + res ? vx0 + res : x;
                const dx = x - nx;
                if (dyz + dx * dx >= lim2) continue;
                if (col.isVoxelSolid(ix, iy, iz)) return true;
            }
        }
    }
    return false;
}

export class VoxelContactWorld {
    readonly col: VoxelCollision;
    stats: SweepStats = { overlapTests: 0 };
    private push = { x: 0, y: 0, z: 0 };

    constructor(col: VoxelCollision) {
        this.col = col;
    }

    overlap(x: number, y: number, z: number, r: number): boolean {
        this.stats.overlapTests++;
        return sphereOverlaps(this.col, x, y, z, r);
    }

    /** Earliest t in [0,1] where sphere (a -> b, radius r) touches solid, or -1. */
    sweepOne(ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number): number {
        const dx = bx - ax, dy = by - ay, dz = bz - az;
        const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (L < 1e-12) {
            return this.overlap(ax, ay, az, r + LEAF) ? (this.overlap(ax, ay, az, r) ? 0 : 1e-12) : -1;
        }
        // whole-segment cover first (cheap in open air)
        if (!this.overlap(ax + dx * 0.5, ay + dy * 0.5, az + dz * 0.5, r + L * 0.5)) return -1;
        const seg = Math.max(1, Math.ceil(L / (r * 0.5)));
        for (let j = 0; j < seg; j++) {
            const t0 = j / seg, t1 = (j + 1) / seg;
            const hit = this.bisect(ax, ay, az, dx, dy, dz, L, r, t0, t1);
            if (hit >= 0) {
                if (hit === 0) return this.overlap(ax, ay, az, r) ? 0 : 1e-12;
                return hit;
            }
        }
        return -1;
    }

    private bisect(ax: number, ay: number, az: number, dx: number, dy: number, dz: number, L: number, r: number, t0: number, t1: number): number {
        const tm = (t0 + t1) * 0.5;
        const half = L * (t1 - t0) * 0.5;
        if (!this.overlap(ax + dx * tm, ay + dy * tm, az + dz * tm, r + half)) return -1;
        if (L * (t1 - t0) <= LEAF) return t0;
        const left = this.bisect(ax, ay, az, dx, dy, dz, L, r, t0, tm);
        if (left >= 0) return left;
        return this.bisect(ax, ay, az, dx, dy, dz, L, r, tm, t1);
    }

    sweep(c0: Float64Array, c1: Float64Array, r: Float64Array, pad: Float64Array, n: number, out: ContactOut): number {
        let best = -1;
        let bestK = -1;
        for (let k = 0; k < n; k++) {
            const t = this.sweepOne(c0[k * 3], c0[k * 3 + 1], c0[k * 3 + 2], c1[k * 3], c1[k * 3 + 1], c1[k * 3 + 2], r[k] + pad[k]);
            if (t >= 0 && (best < 0 || t < best)) {
                best = t;
                bestK = k;
            }
        }
        if (best < 0) return -1;
        out.sphere = bestK;
        const cx = c0[bestK * 3] + (c1[bestK * 3] - c0[bestK * 3]) * best;
        const cy = c0[bestK * 3 + 1] + (c1[bestK * 3 + 1] - c0[bestK * 3 + 1]) * best;
        const cz = c0[bestK * 3 + 2] + (c1[bestK * 3 + 2] - c0[bestK * 3 + 2]) * best;
        this.normalAt(cx, cy, cz, r[bestK], c1[bestK * 3] - c0[bestK * 3], c1[bestK * 3 + 1] - c0[bestK * 3 + 1], c1[bestK * 3 + 2] - c0[bestK * 3 + 2], out);
        return best;
    }

    /** Outward normal near a touching sphere: upstream push-out of a slightly larger sphere. */
    normalAt(x: number, y: number, z: number, r: number, mx: number, my: number, mz: number, out: ContactOut): void {
        const p = this.push;
        for (const grow of [0.002, 0.005, 0.01, 0.02]) {
            if (this.col.querySphere(x, y, z, r + grow, p)) {
                const l = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
                if (l > 1e-9) {
                    out.nx = p.x / l; out.ny = p.y / l; out.nz = p.z / l;
                    return;
                }
            }
        }
        const l = Math.sqrt(mx * mx + my * my + mz * mz);
        if (l > 1e-12) { out.nx = -mx / l; out.ny = -my / l; out.nz = -mz / l; } else { out.nx = 0; out.ny = 1; out.nz = 0; }
    }

    pushOut(x: number, y: number, z: number, r: number, out: { x: number; y: number; z: number }): boolean {
        return this.col.querySphere(x, y, z, r, out);
    }

    isFreeAt(x: number, y: number, z: number): boolean {
        return this.col.isFreeAt(x, y, z);
    }
}

/**
 * Visit every solid voxel whose cell intersects the world-space box, reporting the cell's
 * world-space min corner and size. Used to build crash geometry near an impact.
 */
export function forEachSolidVoxel(
    col: VoxelCollision,
    minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number,
    cb: (x: number, y: number, z: number, size: number) => void,
    limit = 20000
): number {
    const flip = col.flipXY;
    // raw-space box (flip negates x and y)
    const rx0 = flip ? -maxX : minX, rx1 = flip ? -minX : maxX;
    const ry0 = flip ? -maxY : minY, ry1 = flip ? -minY : maxY;
    const res = col.voxelResolution;
    const ix0 = Math.max(0, Math.floor((rx0 - col.gridMinX) / res)), ix1 = Math.min(col.numVoxelsX - 1, Math.floor((rx1 - col.gridMinX) / res));
    const iy0 = Math.max(0, Math.floor((ry0 - col.gridMinY) / res)), iy1 = Math.min(col.numVoxelsY - 1, Math.floor((ry1 - col.gridMinY) / res));
    const iz0 = Math.max(0, Math.floor((minZ - col.gridMinZ) / res)), iz1 = Math.min(col.numVoxelsZ - 1, Math.floor((maxZ - col.gridMinZ) / res));
    let n = 0;
    for (let iz = iz0; iz <= iz1; iz++) {
        for (let iy = iy0; iy <= iy1; iy++) {
            for (let ix = ix0; ix <= ix1; ix++) {
                if (!col.isVoxelSolid(ix, iy, iz)) continue;
                const x0 = col.gridMinX + ix * res, y0 = col.gridMinY + iy * res, z0 = col.gridMinZ + iz * res;
                // world min corner: flipping maps [x0, x0+res] to [-x0-res, -x0]
                cb(flip ? -x0 - res : x0, flip ? -y0 - res : y0, z0, res);
                if (++n >= limit) return n;
            }
        }
    }
    return n;
}
