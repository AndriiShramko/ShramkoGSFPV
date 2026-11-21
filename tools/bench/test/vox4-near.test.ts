// Lane vox4 (voxux4 V-2): the column under the craft and its judgement (the owner's Lublin hole).
import { describe, expect, it } from 'vitest';
import { chunksNear } from '@gsfpv/collision';
import type { VoxelCollision } from '@gsfpv/collision';
import { nearWalls } from '../../../apps/fly/src/voxel-near';
import type { NearChunkState } from '../../../apps/fly/src/voxel-near';

// Lublin 2f1ddf5f's grid (walls v1): 20 cm voxels, chunks of 32 (6.4 m), 132 x 11 x 136 chunks
const grid = (flipXY: boolean): VoxelCollision => ({ voxelResolution: 0.2, gridMinX: -451.2, gridMinY: -44, gridMinZ: -328.8, numVoxelsX: 4224, numVoxelsY: 352, numVoxelsZ: 4352, flipXY } as unknown as VoxelCollision);
const cell = (quads: number | null, o: Partial<NearChunkState> = {}): NearChunkState => ({ key: 1, occupied: true, wanted: 0, loaded: 0, pending: false, quads, group: null, ...o });

describe('chunksNear: the column under the craft', () => {
    it('a craft 36 m over the top of the grid (the Lublin spawn) gets the 3x3 columns down to the floor', () => {
        const n = chunksNear(grid(false), 32, 146.52, 62.04, -96.97);
        expect(n.inside).toBe(true);
        expect(n.chunks.length).toBe(9 * 11);
        expect(new Set(n.chunks.map((c) => c.y))).toEqual(new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
    });
    it('format 1.0 (file y = -world y): the floor is the top index', () => {
        // world y 62 over a grid whose file y runs -44..26.4 down from the top: file y -62 is under its index 0
        const n = chunksNear(grid(true), 32, -146.52, -62.04, -96.97);
        expect(n.inside).toBe(false);
        const m = chunksNear(grid(true), 32, -146.52, 30, -96.97);
        expect(m.inside).toBe(true);
        expect(Math.min(...m.chunks.map((c) => c.y))).toBe(Math.max(0, Math.floor((-30 + 44) / 6.4) - 1));
        expect(Math.max(...m.chunks.map((c) => c.y))).toBe(10);
    });
    it('beside the grid: outside, nothing near', () => {
        const n = chunksNear(grid(false), 32, 900, 0, 0);
        expect(n).toEqual({ inside: false, chunks: [] });
    });
});

describe('nearWalls', () => {
    it('Lublin: four drawn chunks of 39, 211, 48, 37 faces under 9 columns are thin', () => {
        const s = nearWalls(true, 9, 32, [cell(39), cell(211), cell(48), cell(37), cell(null, { occupied: false, loaded: null, wanted: null })]);
        expect(s.walls).toBe('thin');
        expect(s.cover).toBeCloseTo(335 / (9 * 1024), 5);
    });
    it('a full floor (one face per voxel square) is drawn', () => {
        expect(nearWalls(true, 9, 32, [cell(9 * 1024)]).walls).toBe('drawn');
        // coarse faces cover more: 4x4 voxels a face at level 1
        expect(nearWalls(true, 9, 32, [cell(600, { loaded: 1, wanted: 1 })]).walls).toBe('drawn');
    });
    it('a wall chunk not drawn yet (or waiting) is loading, not a hole to report', () => {
        expect(nearWalls(true, 9, 32, [cell(10), cell(null, { loaded: null })]).walls).toBe('loading');
        expect(nearWalls(true, 9, 32, [cell(10, { pending: true })]).walls).toBe('loading');
    });
    it('no wall chunk at all under the craft is thin; outside the grid is outside', () => {
        expect(nearWalls(true, 9, 32, []).walls).toBe('thin');
        expect(nearWalls(false, 0, 32, []).walls).toBe('outside');
    });
    it('a chunk drawn inside a group mesh (no count of its own) is not called thin', () => {
        expect(nearWalls(true, 9, 32, [cell(null, { loaded: 3, wanted: 3, group: -5 })]).walls).toBe('drawn');
    });
});
