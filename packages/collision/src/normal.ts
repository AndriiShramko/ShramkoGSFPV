// A cheap surface normal at a ray's hit on voxel walls (v0.12 Fly by Sound, docs/wip/v12-plan.md 4.2 step 3): sound
// casts 30 rays a frame and wants each hit's surface direction (floor, ceiling or wall; the time to collision along
// it). The vendored querySurfaceNormal scores 9 candidate planes on 5 x 5 patches three layers deep, 1350 voxel
// lookups a hit: 3 ms a frame for 30 rays at Winter Garden x5 (tools/bench/src/sonic-rays.ts), three times the
// frame's budget. This one looks at the hit voxel's neighbourhood: the normal is the weighted sum of the directions
// to the empty voxels, so it points out of the solid (26 or 124 lookups). On a flat floor or wall it is the face's
// normal; on a voxelised slope it averages the steps; on a panel one voxel thin, empty on both sides, it cancels and
// the answer is null (the caller then takes the face the ray entered). How often it gives a hit the same class as
// querySurfaceNormal, and at what angle, is measured in the bench.

import type { VoxelCollision } from './vendor/voxel-collision';

/** Offsets of the (2R + 1)^3 neighbourhood, each with its weight vector o * exp(-|o|^2 / 2) (a Gaussian derivative, sigma one voxel). */
function offsets(r: number): Float64Array {
    const out: number[] = [];
    for (let z = -r; z <= r; z++) {
        for (let y = -r; y <= r; y++) {
            for (let x = -r; x <= r; x++) {
                if (x === 0 && y === 0 && z === 0) continue;
                const w = Math.exp(-(x * x + y * y + z * z) / 2);
                out.push(x, y, z, x * w, y * w, z * w);
            }
        }
    }
    return new Float64Array(out);
}
const NEAR: Float64Array[] = [offsets(1), offsets(2)];

/** Below this share of the sum a flat surface gives (one half space empty), the neighbourhood gives no direction. */
const MIN_SHARE = 0.15;
const HALF: number[] = NEAR.map((o) => {
    let y = 0;
    for (let k = 0; k < o.length; k += 6) if (o[k + 1] > 0) y += o[k + 4];
    return y;
});

/**
 * Outward unit normal of the walls at (x, y, z), a point where a ray along (dx, dy, dz) met them (world frame), or
 * null when the neighbourhood is no surface (a thin panel, a lone voxel seen through, a point in no voxel).
 * `radius` 1 looks at the 26 neighbours of the hit voxel, 2 at the 124 of its 5 x 5 x 5 block (smoother on noisy
 * scans, five times the lookups); the normal is the Gaussian-weighted sum of the directions to the empty ones.
 */
export function voxelNormal(col: VoxelCollision, x: number, y: number, z: number, dx: number, dy: number, dz: number, radius: 1 | 2 = 1): [number, number, number] | null {
    const flip = col.flipXY;
    // the raw frame of the octree: a legacy grid stores x and y negated
    const rx = flip ? -x : x, ry = flip ? -y : y;
    const rdx = flip ? -dx : dx, rdy = flip ? -dy : dy;
    const res = col.voxelResolution;
    // the voxel the ray entered: the hit point nudged a quarter voxel on along the ray (as querySurfaceNormal does)
    const nudge = res * 0.25;
    const ix = Math.floor((rx + Math.sign(rdx) * nudge - col.gridMinX) / res);
    const iy = Math.floor((ry + Math.sign(rdy) * nudge - col.gridMinY) / res);
    const iz = Math.floor((z + Math.sign(dz) * nudge - col.gridMinZ) / res);
    const o = NEAR[radius - 1];
    let sx = 0, sy = 0, sz = 0;
    for (let k = 0; k < o.length; k += 6) {
        if (col.isVoxelSolid(ix + o[k], iy + o[k + 1], iz + o[k + 2])) continue;
        sx += o[k + 3];
        sy += o[k + 4];
        sz += o[k + 5];
    }
    const l = Math.hypot(sx, sy, sz);
    if (l < MIN_SHARE * HALF[radius - 1]) return null;
    return flip ? [-sx / l, -sy / l, sz / l] : [sx / l, sy / l, sz / l];
}

/**
 * The normal of the voxel face a ray entered through at (x, y, z): the axis whose grid plane the point lies on,
 * pointing back against the ray. Exact for a voxel face, blind to slopes; null for a point on no grid plane (a ray
 * that started inside the walls).
 */
export function faceNormal(col: VoxelCollision, x: number, y: number, z: number, dx: number, dy: number, dz: number): [number, number, number] | null {
    const flip = col.flipXY;
    const raw = [flip ? -x : x, flip ? -y : y, z];
    const rd = [flip ? -dx : dx, flip ? -dy : dy, dz];
    const min = [col.gridMinX, col.gridMinY, col.gridMinZ];
    const res = col.voxelResolution;
    let axis = -1;
    let best = 1e-6;
    for (let a = 0; a < 3; a++) {
        if (Math.abs(rd[a]) < 1e-9) continue;
        const f = (raw[a] - min[a]) / res;
        const off = Math.abs(f - Math.round(f));
        if (off < best) {
            best = off;
            axis = a;
        }
    }
    if (axis < 0) return null;
    const n: [number, number, number] = [0, 0, 0];
    n[axis] = rd[axis] > 0 ? -1 : 1;
    if (flip) {
        n[0] = -n[0];
        n[1] = -n[1];
    }
    return n;
}
