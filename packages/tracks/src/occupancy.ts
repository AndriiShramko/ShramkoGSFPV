// F2-fast-course: the flight's sphere overlap test (collision world.ts sphereOverlaps) with the same answer, faster. One bit
// per super block of SUPER x SUPER x SUPER voxels says whether any voxel in it is solid (built once per walls from the
// octree's blocks, collision mesh.ts forEachBlock); the test reads voxels only in occupied super blocks the sphere reaches.
// On 5 cm walls a sphere of 0.625 m (the generator's leg sweeps) reads about 8 000 voxels through the octree when no wall is
// near; here it reads a few dozen bits. Every voxel that is read is judged by sphereOverlaps' own arithmetic, and a super
// block is skipped only when its whole box lies farther than the test's limit (with a small slack), so the answer is the same.
import { blockDims, forEachBlock, sphereOverlaps } from '@gsfpv/collision';
import type { VoxelCollision } from '@gsfpv/collision';

/** collision vendor/collision.ts PENETRATION_EPSILON (not exported by the package); sweep-fast.test.ts holds the two equal */
const PENETRATION_EPSILON = 1e-4;
/** voxels per super block edge (a multiple of the octree block of 4) */
export const SUPER = 8;
/** a super block is skipped only when it is farther than the limit by this much, m (float slack of the box arithmetic) */
const SKIP_SLACK_M = 1e-6;

export interface Occupancy {
    readonly sx: number;
    readonly sy: number;
    readonly sz: number;
    readonly bits: Uint32Array;
}

const cache = new WeakMap<VoxelCollision, Occupancy>();

/** The super block bits of `col`, built on first use and kept while the walls live. */
export function occupancyOf(col: VoxelCollision): Occupancy {
    const had = cache.get(col);
    if (had) return had;
    const sx = Math.ceil(col.numVoxelsX / SUPER), sy = Math.ceil(col.numVoxelsY / SUPER), sz = Math.ceil(col.numVoxelsZ / SUPER);
    const bits = new Uint32Array(Math.ceil((sx * sy * sz) / 32));
    const per = SUPER / 4;
    forEachBlock(col, [0, 0, 0], blockDims(col), (bx, by, bz) => {
        const i = (Math.floor(bz / per) * sy + Math.floor(by / per)) * sx + Math.floor(bx / per);
        bits[i >>> 5]! |= 1 << (i & 31);
    });
    const occ = { sx, sy, sz, bits };
    cache.set(col, occ);
    return occ;
}

/** sphereOverlaps(col, xw, yw, z, r), read through the super block bits of `occ` (occupancyOf(col)). */
export function overlapsFast(col: VoxelCollision, occ: Occupancy, xw: number, yw: number, z: number, r: number): boolean {
    if (col.nodes.length === 0 || r <= PENETRATION_EPSILON) return sphereOverlaps(col, xw, yw, z, r);
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
    const skip = (lim + SKIP_SLACK_M) * (lim + SKIP_SLACK_M);
    const S = SUPER, span = SUPER * res;
    const szMin = Math.max(0, Math.floor(izMin / S)), szMax = Math.min(occ.sz - 1, Math.floor(izMax / S));
    const syMin = Math.max(0, Math.floor(iyMin / S)), syMax = Math.min(occ.sy - 1, Math.floor(iyMax / S));
    const sxMin = Math.max(0, Math.floor(ixMin / S)), sxMax = Math.min(occ.sx - 1, Math.floor(ixMax / S));
    const bits = occ.bits;
    for (let bz = szMin; bz <= szMax; bz++) {
        const z0 = gz + bz * span;
        const cz = z < z0 ? z0 - z : z > z0 + span ? z - z0 - span : 0;
        if (cz * cz >= skip) continue;
        for (let by = syMin; by <= syMax; by++) {
            const y0 = gy + by * span;
            const cy = y < y0 ? y0 - y : y > y0 + span ? y - y0 - span : 0;
            if (cz * cz + cy * cy >= skip) continue;
            for (let bx = sxMin; bx <= sxMax; bx++) {
                const i = (bz * occ.sy + by) * occ.sx + bx;
                if ((bits[i >>> 5]! & (1 << (i & 31))) === 0) continue;
                const x0 = gx + bx * span;
                const cx = x < x0 ? x0 - x : x > x0 + span ? x - x0 - span : 0;
                if (cz * cz + cy * cy + cx * cx >= skip) continue;
                // the voxels of this super block inside the sphere's box, judged as sphereOverlaps judges them
                const zA = Math.max(izMin, bz * S), zB = Math.min(izMax, bz * S + S - 1);
                const yA = Math.max(iyMin, by * S), yB = Math.min(iyMax, by * S + S - 1);
                const xA = Math.max(ixMin, bx * S), xB = Math.min(ixMax, bx * S + S - 1);
                for (let iz = zA; iz <= zB; iz++) {
                    const vz0 = gz + iz * res;
                    const nz = z < vz0 ? vz0 : z > vz0 + res ? vz0 + res : z;
                    const dz = z - nz;
                    const dz2 = dz * dz;
                    if (dz2 >= lim2) continue;
                    for (let iy = yA; iy <= yB; iy++) {
                        const vy0 = gy + iy * res;
                        const ny = y < vy0 ? vy0 : y > vy0 + res ? vy0 + res : y;
                        const dy = y - ny;
                        const dyz = dz2 + dy * dy;
                        if (dyz >= lim2) continue;
                        for (let ix = xA; ix <= xB; ix++) {
                            const vx0 = gx + ix * res;
                            const nx = x < vx0 ? vx0 : x > vx0 + res ? vx0 + res : x;
                            const dx = x - nx;
                            if (dyz + dx * dx >= lim2) continue;
                            if (col.isVoxelSolid(ix, iy, iz)) return true;
                        }
                    }
                }
            }
        }
    }
    return false;
}
