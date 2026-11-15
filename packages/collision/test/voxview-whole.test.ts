// The voxel view's whole scene (lane voxview, X2): far cubes of 8 and 16 voxels cover every wall
// cell under them (their exposed faces equal a brute-force count over the merged occupancy), and
// the whole-scene plan gives every occupied chunk a level (none cut away), keeps the nearest ones
// per voxel and only gets coarser with distance. Each claim has a control.
import { describe, expect, it } from 'vitest';
import {
    buildChunkBlockFaces, blockComponents, occupiedChunks, overlayChunk, overlayLevels, levelCellVoxels, planChunks, COARSE_LEVELS
} from '../src/index';
import { blocksFromFn, encodeCollision } from './helpers';
import type { Dims } from './helpers';

let seed = 11;
const rnd = (): number => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 4294967296; };
const D: Dims = [96, 40, 120];
const fill = new Uint8Array(D[0] * D[1] * D[2]).map(() => (rnd() < 0.004 ? 1 : 0));
const solid = (x: number, y: number, z: number): boolean => y < 3 || fill[(z * D[1] + y) * D[0] + x] === 1;
const col = encodeCollision(D, blocksFromFn(D, solid));

/** Exposed faces of the occupancy where a cell of `c` voxels is solid when any voxel in it is. */
function bruteFaces(c: number): number {
    const n = D.map((d) => Math.ceil(d / c));
    const occ = new Uint8Array(n[0] * n[1] * n[2]);
    for (let z = 0; z < D[2]; z++) for (let y = 0; y < D[1]; y++) for (let x = 0; x < D[0]; x++) {
        if (solid(x, y, z)) occ[(Math.floor(z / c) * n[1] + Math.floor(y / c)) * n[0] + Math.floor(x / c)] = 1;
    }
    const at = (x: number, y: number, z: number): number => (x < 0 || y < 0 || z < 0 || x >= n[0] || y >= n[1] || z >= n[2] ? 0 : occ[(z * n[1] + y) * n[0] + x]);
    let f = 0;
    for (let z = 0; z < n[2]; z++) for (let y = 0; y < n[1]; y++) for (let x = 0; x < n[0]; x++) {
        if (!at(x, y, z)) continue;
        f += 6 - at(x + 1, y, z) - at(x - 1, y, z) - at(x, y + 1, z) - at(x, y - 1, z) - at(x, y, z + 1) - at(x, y, z - 1);
    }
    return f;
}

describe('voxel view: far cubes', () => {
    it('levels 2 and 3 are cubes of 8 and 16 voxels, offered when they divide the chunk', () => {
        expect(COARSE_LEVELS).toEqual([2, 4]);
        expect([0, 1, 2, 3].map(levelCellVoxels)).toEqual([1, 4, 8, 16]);
        expect(overlayLevels(48)).toEqual([0, 1, 2, 3]);
        expect(overlayLevels(40)).toEqual([0, 1, 2]);
        expect(overlayLevels(36)).toEqual([0, 1]);
    });

    it('a far cube covers every wall cell under it: exposed faces equal the merged brute force', () => {
        // one chunk over the whole grid (128 voxels), closed at its border like the overlay's
        for (const merge of [1, 2, 4]) {
            const m = buildChunkBlockFaces(col, { x: 0, y: 0, z: 0 }, 128, { closedBorder: true, merge });
            expect(m.faces).toBe(bruteFaces(4 * merge));
        }
        // control: the brute force of another cell size differs, so the count tells the levels apart
        expect(bruteFaces(8)).not.toBe(bruteFaces(16));
    });

    it('the cube edge of a level is its cell size in metres (grid UVs count cells)', () => {
        const c = overlayChunk(col, { x: 0, y: 0, z: 0 }, 48, 3);
        expect(c.quads).toBeGreaterThan(0);
        const xs = new Set<number>();
        for (let i = 0; i < c.positions.length; i += 3) xs.add(Math.round(c.positions[i] / col.voxelResolution));
        for (const x of xs) expect(x % 16).toBe(0);
    });
});

describe('voxel view: the whole-scene plan', () => {
    const size = 16;
    const occ = new Set(occupiedChunks(col, blockComponents(col), size));
    const at = [1, 4, 1];

    it('plans every occupied chunk once, whatever the radius and budgets', () => {
        const plan = planChunks(col, size, occ, at[0], at[1], at[2], { radius: 0.5, fineQuads: 400, coarseQuads: 300, whole: true, farQuads: 200 });
        const keys = plan.chunks.map((c) => c.key);
        expect(new Set(keys).size).toBe(keys.length);
        expect(keys.length).toBe(occ.size);
        expect(plan.perLevel.reduce((a, b) => a + b, 0)).toBe(occ.size);
        // control: the same plan without `whole` cuts the far part away
        const cut = planChunks(col, size, occ, at[0], at[1], at[2], { radius: 0.5, fineQuads: 400, coarseQuads: 300 });
        expect(cut.chunks.length).toBeLessThan(occ.size);
    });

    it('keeps the nearest chunks per voxel and only gets coarser with distance', () => {
        const plan = planChunks(col, size, occ, at[0], at[1], at[2], { radius: 0.5, fineQuads: 3000, coarseQuads: 600, whole: true, farQuads: 300 });
        expect(plan.chunks[0].lod).toBe(0);
        for (let i = 1; i < plan.chunks.length; i++) {
            expect(plan.chunks[i].dist).toBeGreaterThanOrEqual(plan.chunks[i - 1].dist);
            expect(plan.chunks[i].lod).toBeGreaterThanOrEqual(plan.chunks[i - 1].lod);
        }
        expect(plan.chunks[plan.chunks.length - 1].lod).toBe(3);
        expect(plan.perLevel.every((n) => n > 0)).toBe(true);
    });

    it('a smaller budget (the frame rate keeper) moves chunks to coarser cubes, never out of the plan', () => {
        const full = planChunks(col, size, occ, at[0], at[1], at[2], { radius: 0.5, fineQuads: 3000, coarseQuads: 600, whole: true, farQuads: 300 });
        const low = planChunks(col, size, occ, at[0], at[1], at[2], { radius: 0.5, fineQuads: 3000 / 8, coarseQuads: 600 / 8, whole: true, farQuads: 300 / 8 });
        expect(low.chunks.length).toBe(full.chunks.length);
        expect(low.perLevel[0]).toBeLessThan(full.perLevel[0]);
        expect(low.perLevel[3]).toBeGreaterThan(full.perLevel[3]);
    });
});
