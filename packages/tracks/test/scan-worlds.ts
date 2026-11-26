// Lane gen4a: four analytic scans of the kinds the course generator tells apart (flown metres, transform identity, y up).
// Shared by scan.test.ts (the analysis) and plan.test.ts (the placement).
import { analyticCollision } from '@gsfpv/collision';
import type { VoxelCollision } from '@gsfpv/collision';
import type { Vec3 } from '../src/types';

const inBox = (x: number, y: number, z: number, lo: readonly number[], hi: readonly number[]): boolean =>
    x >= lo[0]! && x < hi[0]! && y >= lo[1]! && y < hi[1]! && z >= lo[2]! && z < hi[2]!;

/** a fixed share of the voxels on (fuzz): an integer hash of the voxel's index, no Math.random */
function fuzz(x: number, y: number, z: number, voxelM: number, perMille: number): boolean {
    const ix = Math.floor(x / voxelM), iy = Math.floor(y / voxelM), iz = Math.floor(z / voxelM);
    let h = (Math.imul(ix, 73856093) ^ Math.imul(iy, 19349663) ^ Math.imul(iz, 83492791)) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0;
    return ((h ^ (h >>> 15)) >>> 0) % 1000 < perMille;
}

/** A closed room 10 x 4 x 8 m inside (shell 0.2 m), air around it out to the grid's edge; voxel 0.1 m. */
export const ROOM_IN: [Vec3, Vec3] = [[0, 0, 0], [10, 4, 8]];
export function scannedRoom(): VoxelCollision {
    return analyticCollision([-1.5, -0.5, -1.5], [11.5, 5, 9.5], 0.1, (x, y, z) =>
        inBox(x, y, z, [-0.2, -0.2, -0.2], [10.2, 4.2, 8.2]) && !inBox(x, y, z, ROOM_IN[0], ROOM_IN[1]));
}

/** A table 0.8 x 0.6 m (top 1 voxel thick at 0.75 m, four legs) with a skull (a shell 3 voxels thick, r 0.15 m) off its
 *  centre, and nothing but air to 2 m up and 1.2 m around; voxel 0.025 m. */
export const SKULL: Vec3 = [0.15, 0.9, 0.1];
export const TABLE_HALF: [number, number] = [0.4, 0.3];
export function tableAndSkull(): VoxelCollision {
    const r = 0.15, shell = 0.075;
    return analyticCollision([-1.6, -0.05, -1.5], [1.6, 2.0, 1.5], 0.025, (x, y, z) => {
        if (inBox(x, y, z, [-TABLE_HALF[0], 0.725, -TABLE_HALF[1]], [TABLE_HALF[0], 0.75, TABLE_HALF[1]])) return true;
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
            const lx = sx * (TABLE_HALF[0] - 0.04), lz = sz * (TABLE_HALF[1] - 0.04);
            if (inBox(x, y, z, [lx - 0.02, 0, lz - 0.02], [lx + 0.02, 0.725, lz + 0.02])) return true;
        }
        const d2 = (x - SKULL[0]) * (x - SKULL[0]) + (y - SKULL[1]) * (y - SKULL[1]) + (z - SKULL[2]) * (z - SKULL[2]);
        return d2 <= r * r && d2 >= (r - shell) * (r - shell);
    });
}

/** A city filmed from above, 120 x 120 m: a fuzzy ground shell 2 m thick (one voxel in ten) under buildings 16 x 16 m on a
 *  30 m pitch, 12 to 21 m high, solid (SuperSplat's walls are solid under every surface: scan-kind-audit --profile);
 *  voxel 0.2 m. */
export const SLAB_TOP_M = 2;
export const STREET_AT: Vec3 = [27, 3, 27];
export const ROOF_AT: Vec3 = [12, 3, 12];
export function cityFromAbove(): VoxelCollision {
    const v = 0.2;
    return analyticCollision([-5, -1, -5], [125, 25, 125], v, (x, y, z) => {
        if (x < 0 || z < 0 || x >= 120 || z >= 120 || y < 0) return false;
        if (y < SLAB_TOP_M) return fuzz(x, y, z, v, 100);
        const i = Math.floor(x / 30), j = Math.floor(z / 30);
        const bx = x - i * 30 - 4, bz = z - j * 30 - 4;
        if (bx < 0 || bz < 0 || bx >= 16 || bz >= 16) return false;
        const h = SLAB_TOP_M + 10 + ((i * 3 + j * 5) % 4) * 3;
        return y < h + v;
    });
}

/** A pocket 2 x 1.2 x 2 m carved in a solid block (as 5dfeb49b's bowl is) and crowded with posts 5 cm thick every 0.3 m:
 *  no 4 D gate of a whoop fits between them at x1, one does when the scan is three times larger; voxel 0.025 m. */
export const POCKET_IN: [Vec3, Vec3] = [[0, 0, 0], [2, 1.2, 2]];
export function crowdedPocket(): VoxelCollision {
    const post = (v: number): boolean => v - Math.floor(v / 0.4) * 0.4 < 0.1;
    return analyticCollision([-0.2, -0.2, -0.2], [2.2, 1.4, 2.2], 0.025, (x, y, z) => !inBox(x, y, z, POCKET_IN[0], POCKET_IN[1]) || (post(x) && post(z)));
}

/** Lane w1-anchor: a wide open place 100 x 100 m (as eb5f51dc): a solid ground 1 m thick, a well-captured village round
 *  the author's camera (FRINGE_SPAWN; blocks 4 x 4 m, 3 to 6 m high on a 10 m pitch over x, z 5-45) and a badly captured
 *  fringe in the far corner (x, z 70-100: one voxel in fifty floating up to 9 m, many runs a column): the voxels' roughest
 *  window, the analysis core, lies in the fringe, 70 m and more from the camera; voxel 0.25 m. */
export const FRINGE_SPAWN: Vec3 = [22, 2.5, 22];
/** the far street corner of the village, 28 m from the camera: where the pilot flew to */
export const FRINGE_MOVED: Vec3 = [42, 2.5, 42];
export function fringeField(): VoxelCollision {
    const v = 0.25;
    return analyticCollision([-2, -0.5, -2], [102, 12, 102], v, (x, y, z) => {
        if (x < 0 || z < 0 || x >= 100 || z >= 100 || y < 0) return false;
        if (y < 1) return true;
        if (x >= 70 && z >= 70) return y < 9 && fuzz(x, y, z, v, 20);
        if (x < 5 || z < 5 || x >= 45 || z >= 45) return false;
        const i = Math.floor((x - 5) / 10), j = Math.floor((z - 5) / 10);
        const bx = x - 5 - i * 10, bz = z - 5 - j * 10;
        return bx < 4 && bz < 4 && y < 1 + 3 + ((i + 2 * j) % 4);
    });
}

/** A tray of plants 1 x 1 m: soil 4 cm, stems every 0.25 m 0.4 m high, a leaf ball (r 8 cm) on each and one half way;
 *  voxel 0.02 m; air to 1.5 m up (a gate a whoop passes over the leaves). */
export function plantTray(): VoxelCollision {
    return analyticCollision([-0.2, -0.04, -0.2], [1.2, 1.5, 1.2], 0.02, (x, y, z) => {
        if (x < 0 || z < 0 || x >= 1 || z >= 1) return false;
        if (y < 0.04) return y >= 0;
        const sx = 0.125 + Math.round((x - 0.125) / 0.25) * 0.25, sz = 0.125 + Math.round((z - 0.125) / 0.25) * 0.25;
        const dx = x - sx, dz = z - sz;
        if (Math.abs(dx) < 0.01 && Math.abs(dz) < 0.01 && y < 0.44) return true;
        for (const ly of [0.24, 0.44]) {
            const ox = ly === 0.24 ? 0.06 : 0;
            const d2 = (dx - ox) * (dx - ox) + (y - ly) * (y - ly) + dz * dz;
            if (d2 <= 0.08 * 0.08) return true;
        }
        return false;
    });
}
