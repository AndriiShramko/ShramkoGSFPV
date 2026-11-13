// Analytic worlds for the course tests (flown metres, transform identity, y up).
import { analyticCollision } from '@gsfpv/collision';
import type { VoxelCollision } from '@gsfpv/collision';
import type { SceneTransform, Vec3 } from '../src/types';

export const IDENTITY: SceneTransform = [1, 0, 0, 0];
export const VOXEL_M = 0.1;
const inBox = (x: number, y: number, z: number, lo: Vec3, hi: Vec3): boolean => x >= lo[0] && x < hi[0] && y >= lo[1] && y < hi[1] && z >= lo[2] && z < hi[2];

/**
 * Three rooms in a row along x, each 10 x 5 x 10 m inside, walls 0.4 m: A [0, 10], B [10.4, 20.4], C [20.8, 30.8].
 * A and B are joined by a door 2.5 m wide and 3 m high; C is sealed. Everything outside the rooms is solid.
 */
export const ROOM_A: [Vec3, Vec3] = [[0, 0, 0], [10, 5, 10]];
export const ROOM_B: [Vec3, Vec3] = [[10.4, 0, 0], [20.4, 5, 10]];
export const ROOM_C: [Vec3, Vec3] = [[20.8, 0, 0], [30.8, 5, 10]];
const DOOR: [Vec3, Vec3] = [[9.9, 0, 4], [10.5, 3, 6.5]];
export const SPAWN_A: Vec3 = [5, 2.5, 5];

export function threeRooms(): VoxelCollision {
    const free = (x: number, y: number, z: number): boolean => [ROOM_A, ROOM_B, ROOM_C, DOOR].some(([lo, hi]) => inBox(x, y, z, lo, hi));
    return analyticCollision([-0.4, -0.4, -0.4], [31.2, 5.4, 10.4], VOXEL_M, (x, y, z) => !free(x, y, z));
}

/**
 * One room 10 x 5 x 10 m inside (walls 0.4 m) with a 2 m square hole in its +x wall (z 4..6, y 1.5..3.5), standing in an
 * open yard: a floor and nothing else, out to the grid's edge (x to 30, z -10..20, y to 6). The yard is what a badly
 * scanned wall lets the flood fill into.
 */
export const HOLE_WALL_X = 10.4;
export function roomWithHole(): VoxelCollision {
    const solid = (x: number, y: number, z: number): boolean => {
        if (y < 0) return true;
        const inShell = inBox(x, y, z, [-0.4, 0, -0.4], [10.4, 5.4, 10.4]);
        if (!inShell) return false;
        if (inBox(x, y, z, [0, 0, 0], [10, 5, 10])) return false;
        if (inBox(x, y, z, [9.9, 1.5, 4], [10.5, 3.5, 6])) return false;
        return true;
    };
    return analyticCollision([-0.4, -0.4, -10], [30, 6, 20], VOXEL_M, solid);
}
