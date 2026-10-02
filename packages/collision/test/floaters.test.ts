// G.3 / G.6 phantom walls: dropFloaters removes exactly the connected pieces smaller than N blocks
// and nothing else (every kept block keeps its 64-bit voxel mask, every dropped block is empty),
// deterministically. Controls: N = 0 removes nothing; a piece of exactly N blocks stays; a ray
// through a dropped floater hits before and passes after, a big wall is still hit.
import { describe, expect, it } from 'vitest';
import { blockComponents, componentAt, dropFloaters, floaterDigestParts, forEachBlock, blockDims, openVoxelCollision, componentsOf } from '../src/index';
import type { VoxelCollision } from '../src/index';
import { encodeCollision, loadFixture, setVoxel } from './helpers';
import type { BlockMasks, Dims } from './helpers';
import { wallsDigest } from '../../../apps/fly/src/session/world';

/** Every occupied block with its mask, keyed like components.ts. */
function blockMap(col: VoxelCollision): Map<number, string> {
    const [nbx, nby, nbz] = blockDims(col);
    const out = new Map<number, string>();
    forEachBlock(col, [0, 0, 0], [nbx, nby, nbz], (bx, by, bz, lo, hi) => out.set((bz * nby + by) * nbx + bx, `${lo}:${hi}`));
    return out;
}

const sortedSizes = (col: VoxelCollision): number[] => Array.from(blockComponents(col).sizes).sort((a, b) => a - b);

/**
 * A 64-block floor slab (16 x 4 blocks, y = 0), and floating pieces well apart from it and from
 * each other: a lone voxel (1 block), a 3-block bar, a 5-block bar, and a fully solid 2x2x2-block
 * cube (8 blocks, encoded as one solid node above the last level).
 */
function world(version: '1.0' | '1.1' = '1.1'): { col: VoxelCollision; dims: Dims; pieces: Record<string, [number, number, number]> } {
    const dims: Dims = [128, 64, 64]; // 32 x 16 x 16 blocks
    const nb = dims.map((d) => d / 4);
    const blocks: BlockMasks = new Map();
    for (let iz = 0; iz < 16; iz++) for (let ix = 0; ix < 64; ix++) setVoxel(blocks, nb, ix, 1, iz); // slab: 16 x 1 x 4 blocks
    setVoxel(blocks, nb, 100, 40, 40); // lone voxel
    for (let ix = 80; ix < 92; ix++) setVoxel(blocks, nb, ix, 30, 10); // 3 blocks
    for (let iz = 20; iz < 40; iz++) setVoxel(blocks, nb, 20, 50, iz); // 5 blocks
    for (let iz = 48; iz < 56; iz++) for (let iy = 32; iy < 40; iy++) for (let ix = 104; ix < 112; ix++) setVoxel(blocks, nb, ix, iy, iz); // solid 2x2x2 blocks
    const col = encodeCollision(dims, blocks, { version });
    return { col, dims, pieces: { lone: [100, 40, 40], bar3: [84, 30, 10], bar5: [20, 50, 30], cube8: [105, 33, 49], slab: [10, 1, 5] } };
}

/** Is voxel (ix, iy, iz) solid, by the vendored lookup. */
const solid = (col: VoxelCollision, v: [number, number, number]) => col.isVoxelSolid(v[0], v[1], v[2]);

describe('dropFloaters removes exactly the pieces smaller than N (G.3)', () => {
    for (const version of ['1.1', '1.0'] as const) {
        it(`format ${version}: sizes 1, 3, 5, 8, 64; N = 5 drops the 1- and 3-block pieces, the rest is identical`, () => {
            const { col, pieces } = world(version);
            expect(sortedSizes(col)).toEqual([1, 3, 5, 8, 64]);
            const f = dropFloaters(col, 5);
            expect(f.components).toBe(5);
            expect(f.pieces).toBe(2);
            expect(f.blocks).toBe(4);
            expect(f.shared).toBe(0);
            expect(sortedSizes(f.collision)).toEqual([5, 8, 64]);
            // every kept block has its very mask, every dropped block is gone, nothing else appears
            const comps = blockComponents(col);
            const before = blockMap(col), after = blockMap(f.collision);
            for (const [key, mask] of before) {
                const id = comps.blockIds[comps.keys.indexOf(key)];
                if (comps.sizes[id] < 5) expect(after.has(key)).toBe(false);
                else expect(after.get(key)).toBe(mask);
            }
            expect(after.size).toBe(before.size - 4);
            expect(solid(f.collision, pieces.lone)).toBe(false);
            expect(solid(f.collision, pieces.bar3)).toBe(false);
            expect(solid(f.collision, pieces.bar5)).toBe(true);
            expect(solid(f.collision, pieces.slab)).toBe(true);
            // the base is not touched
            expect(solid(col, pieces.lone)).toBe(true);
            expect(sortedSizes(col)).toEqual([1, 3, 5, 8, 64]);
            expect(f.collision.flipXY).toBe(col.flipXY);
        });
    }

    it('control: a piece of exactly N blocks stays, one block more in N drops it', () => {
        const { col, pieces } = world();
        expect(solid(dropFloaters(col, 5).collision, pieces.bar5)).toBe(true);
        expect(solid(dropFloaters(col, 6).collision, pieces.bar5)).toBe(false);
        // the solid 2x2x2-block cube is one node above the last level: dropped whole at N = 9, kept at N = 8
        expect(solid(dropFloaters(col, 8).collision, pieces.cube8)).toBe(true);
        const f9 = dropFloaters(col, 9);
        expect(solid(f9.collision, pieces.cube8)).toBe(false);
        expect(sortedSizes(f9.collision)).toEqual([64]);
    });

    it('control: N = 0 removes nothing (the base itself), and so does N = 1 (no piece is smaller than 1 block)', () => {
        const { col } = world();
        expect(dropFloaters(col, 0).collision).toBe(col);
        const f1 = dropFloaters(col, 1);
        expect(f1.pieces).toBe(0);
        expect(f1.collision).toBe(col);
    });

    it('refuses a filter outside 0..64 or not whole', () => {
        const { col } = world();
        expect(() => dropFloaters(col, -1)).toThrow(RangeError);
        expect(() => dropFloaters(col, 65)).toThrow(RangeError);
        expect(() => dropFloaters(col, 2.5)).toThrow(RangeError);
    });

    it('a ray through a floater hits before and passes after; control: the floor is still hit', () => {
        const { col } = world();
        const f = dropFloaters(col, 5);
        const res = col.voxelResolution;
        // straight down through the lone voxel (x 100, z 40) from above it: the voxel, then the empty floor area beyond the slab
        const x = (100 + 0.5) * res, z = (40 + 0.5) * res, y = 60 * res;
        const before = col.queryRay(x, y, z, 0, -1, 0, 10);
        const after = f.collision.queryRay(x, y, z, 0, -1, 0, 10);
        expect(before).not.toBeNull();
        expect(Math.abs(before!.y - 41 * res)).toBeLessThan(res);
        expect(after).toBeNull();
        // control: down onto the slab (x 10, z 5) is a hit in both
        const fx = 10.5 * res, fz = 5.5 * res;
        const a = col.queryRay(fx, y, fz, 0, -1, 0, 10), b = f.collision.queryRay(fx, y, fz, 0, -1, 0, 10);
        expect(a).not.toBeNull();
        expect(b).toEqual(a);
    });

    it('is deterministic: the same bytes give the same words and hash; the cache hands back one result', () => {
        const a = world().col, b = world().col;
        const fa = dropFloaters(a, 9), fb = dropFloaters(b, 9);
        expect(Array.from(fa.collision.nodes)).toEqual(Array.from(fb.collision.nodes));
        expect(Array.from(fa.collision.leafData)).toEqual(Array.from(fb.collision.leafData));
        expect(wallsDigest(fa.collision)).toBe(wallsDigest(fb.collision));
        expect(dropFloaters(a, 9)).toBe(fa);
        // control: another filter gives other walls and another hash
        expect(wallsDigest(dropFloaters(a, 5).collision)).not.toBe(wallsDigest(fa.collision));
        expect(floaterDigestParts(fa.collision)).toHaveLength(3);
    });
});

describe('dropFloaters on the scan 39e63ce9 (CC BY fixture, 57 pieces)', () => {
    const { meta, bin } = loadFixture();
    const col = openVoxelCollision(meta, bin);
    const comps = componentsOf(col);
    const before = blockMap(col);

    it('N = 64 drops every piece under 64 blocks and keeps every other block with its mask', () => {
        const small = Array.from(comps.sizes).filter((n) => n < 64);
        expect(comps.count).toBe(57);
        expect(small.length).toBeGreaterThan(0);
        const f = dropFloaters(col, 64);
        expect(f.pieces).toBe(small.length);
        expect(f.blocks).toBe(small.reduce((a, b) => a + b, 0));
        expect(f.shared).toBe(0);
        const after = blockMap(f.collision);
        let kept = 0, dropped = 0;
        const index = new Map(Array.from(comps.keys, (k, i) => [k, i] as const));
        for (const [key, mask] of before) {
            const i = index.get(key)!;
            if (comps.sizes[comps.blockIds[i]] < 64) { expect(after.has(key)).toBe(false); dropped++; } else { expect(after.get(key)).toBe(mask); kept++; }
        }
        expect(after.size).toBe(kept);
        expect(dropped).toBe(f.blocks);
        const fc = blockComponents(f.collision);
        expect(fc.count).toBe(57 - small.length);
        expect(Math.min(...Array.from(fc.sizes))).toBeGreaterThanOrEqual(64);
        // a block of the largest piece is still where it was
        const big = comps.keys[Array.from(comps.blockIds).indexOf(Array.from(comps.sizes).indexOf(34967))];
        expect(after.get(big)).toBe(before.get(big));
        expect(componentAt(comps, -1, 0, 0)).toBe(-1);
    });
});
