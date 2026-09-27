// G.1 components: 26-connected components of occupied 4x4x4 blocks (G.6), cross-checked against
// research-b 4.1's measurement of 39e63ce9, a dense flood fill, and a planted isolated voxel.
import { describe, expect, it } from 'vitest';
import {
    openVoxelCollision, blockComponents, blockIndex, componentAt, forEachBlock, blockDims, countSolidVoxels,
    syntheticRoom, syntheticOpen
} from '../src/index';
import type { BlockComponents, VoxelCollision } from '../src/index';
import { encodeCollision, lcg, loadFixture, setVoxel } from './helpers';
import type { BlockMasks, Dims } from './helpers';

const popcount = (v: number): number => {
    v = v - ((v >>> 1) & 0x55555555);
    v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
    return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
};

/** Independent reference: flood fill over a dense block grid. Returns sorted component sizes. */
function floodSizes(col: VoxelCollision, connectivity: 6 | 26): number[] {
    const [nx, ny, nz] = blockDims(col);
    const occ = new Uint8Array(nx * ny * nz);
    for (let bz = 0; bz < nz; bz++) for (let by = 0; by < ny; by++) for (let bx = 0; bx < nx; bx++) {
        let any = false;
        for (let z = 0; z < 4 && !any; z++) for (let y = 0; y < 4 && !any; y++) for (let x = 0; x < 4 && !any; x++) any = col.isVoxelSolid(bx * 4 + x, by * 4 + y, bz * 4 + z);
        if (any) occ[(bz * ny + by) * nx + bx] = 1;
    }
    const sizes: number[] = [];
    const stack: number[] = [];
    for (let i = 0; i < occ.length; i++) {
        if (occ[i] !== 1) continue;
        occ[i] = 2;
        stack.push(i);
        let n = 0;
        while (stack.length) {
            const j = stack.pop()!;
            n++;
            const x = j % nx, y = Math.floor(j / nx) % ny, z = Math.floor(j / (nx * ny));
            for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
                if (!dx && !dy && !dz) continue;
                if (connectivity === 6 && Math.abs(dx) + Math.abs(dy) + Math.abs(dz) !== 1) continue;
                const X = x + dx, Y = y + dy, Z = z + dz;
                if (X < 0 || Y < 0 || Z < 0 || X >= nx || Y >= ny || Z >= nz) continue;
                const k = (Z * ny + Y) * nx + X;
                if (occ[k] === 1) {
                    occ[k] = 2;
                    stack.push(k);
                }
            }
        }
        sizes.push(n);
    }
    return sizes.sort((a, b) => a - b);
}

const sortedSizes = (c: BlockComponents): number[] => Array.from(c.sizes).sort((a, b) => a - b);

function fromVoxels(dims: Dims, voxels: [number, number, number][]): VoxelCollision {
    const nb = dims.map((d) => Math.ceil(d / 4));
    const blocks: BlockMasks = new Map();
    for (const [x, y, z] of voxels) setVoxel(blocks, nb, x, y, z);
    return encodeCollision(dims, blocks);
}

describe('blockComponents on synthetic grids (G.6)', () => {
    // a 3-block slab, a floater two blocks above it and a single dust voxel far away
    const slab: [number, number, number][] = [];
    for (let x = 0; x < 12; x++) for (let z = 0; z < 4; z++) slab.push([x, 0, z]);
    const grid = fromVoxels([40, 40, 40], [...slab, [5, 13, 1], [6, 13, 1], [30, 30, 30]]);

    it('a body with 2 floaters gives 3 components with the right sizes', () => {
        const c = blockComponents(grid);
        expect(c.count).toBe(3);
        expect(sortedSizes(c)).toEqual([1, 1, 3]);
        const body = componentAt(c, 0, 0, 0);
        expect(componentAt(c, 1, 0, 0)).toBe(body);
        expect(componentAt(c, 2, 0, 0)).toBe(body);
        expect(componentAt(c, 1, 3, 0)).not.toBe(body);
        expect(componentAt(c, 7, 7, 7)).not.toBe(componentAt(c, 1, 3, 0));
        // ids follow the lowest key, so the body (block 0) is 0
        expect(body).toBe(0);
        expect(Array.from(c.keys)).toEqual([...c.keys].sort((a, b) => a - b));
    });

    it('control: a diagonal-only neighbour is joined with 26-connectivity and not with 6', () => {
        // blocks (0,0,0), (1,1,1) by a corner, then (2,2,1) and (3,1,1) by edges: only diagonal contacts
        const diag = fromVoxels([16, 16, 16], [[0, 0, 0], [4, 4, 4], [8, 8, 4], [12, 4, 4]]);
        const c26 = blockComponents(diag);
        const c6 = blockComponents(diag, { connectivity: 6 });
        expect(c26.count).toBe(1);
        expect(c6.count).toBe(4);
        expect(sortedSizes(c26)).toEqual(floodSizes(diag, 26));
        expect(sortedSizes(c6)).toEqual(floodSizes(diag, 6));
    });

    it('equals a dense flood fill on a random grid, for both connectivities', () => {
        const rnd = lcg(3);
        const vox: [number, number, number][] = [];
        for (let i = 0; i < 700; i++) vox.push([Math.floor(rnd() * 90), Math.floor(rnd() * 70), Math.floor(rnd() * 81)]);
        const col = fromVoxels([90, 70, 81], vox);
        for (const conn of [6, 26] as const) {
            const c = blockComponents(col, { connectivity: conn });
            expect(sortedSizes(c)).toEqual(floodSizes(col, conn));
            expect(c.blockIds.length).toBe(c.keys.length);
            expect(Array.from(c.sizes).reduce((a, b) => a + b, 0)).toBe(c.keys.length);
        }
        const c26 = blockComponents(col), c6 = blockComponents(col, { connectivity: 6 });
        expect(c26.count).toBeGreaterThan(20);
        expect(c26.count).toBeLessThan(c6.count);
    });

    it('lookups: -1 for empty and off-grid blocks', () => {
        const c = blockComponents(grid);
        expect(blockIndex(c, 5, 5, 5)).toBe(-1);
        expect(componentAt(c, -1, 0, 0)).toBe(-1);
        expect(componentAt(c, 99, 0, 0)).toBe(-1);
        expect(c.keys[blockIndex(c, 7, 7, 7)]).toBe((7 * 10 + 7) * 10 + 7);
    });

    it('analytic worlds are walked voxel by voxel, and refused when that would take minutes', () => {
        const room = blockComponents(syntheticRoom(0.05, 1));
        expect(room.count).toBe(1);
        expect(room.sizes[0]).toBe(10 * 10 * 10 - 8 * 8 * 8);
        expect(() => blockComponents(syntheticOpen(0.05, 1000))).toThrow(RangeError);
    });
});

describe('blockComponents on fixture 39e63ce9 (research-b 4.1)', () => {
    const { meta, bin } = loadFixture();
    const col = openVoxelCollision(meta, bin);
    const c = blockComponents(col);
    const blocks: BlockMasks = new Map();
    const [nbx, nby] = blockDims(col);
    let voxels = 0;
    forEachBlock(col, [0, 0, 0], blockDims(col), (bx, by, bz, lo, hi) => {
        blocks.set((bz * nby + by) * nbx + bx, [lo, hi]);
        voxels += popcount(lo) + popcount(hi);
    });

    it('reproduces the measured 57 components over 38 117 occupied blocks, largest 34 967', () => {
        expect(c.keys.length).toBe(38117);
        expect(c.count).toBe(57);
        expect(Math.max(...c.sizes)).toBe(34967);
        expect(blockDims(col)).toEqual([127, 51, 90]);
        // the block walk loses no voxel: same total as the independent octree counter
        expect(voxels).toBe(1165978);
        expect(countSolidVoxels(col.treeDepth, col.nodes, col.leafData)).toBe(voxels);
    });

    it('control: a planted isolated voxel is its own component', () => {
        // re-encode the fixture's blocks: first prove the copy is the same data
        const dims: Dims = [col.numVoxelsX, col.numVoxelsY, col.numVoxelsZ];
        const opts = { res: col.voxelResolution, min: [col.gridMinX, col.gridMinY, col.gridMinZ] as Dims, version: '1.0' as const };
        const copy = encodeCollision(dims, blocks, opts);
        const rnd = lcg(5);
        let differ = 0;
        for (let i = 0; i < 20000; i++) {
            const x = Math.floor(rnd() * dims[0]), y = Math.floor(rnd() * dims[1]), z = Math.floor(rnd() * dims[2]);
            if (copy.isVoxelSolid(x, y, z) !== col.isVoxelSolid(x, y, z)) differ++;
        }
        expect(differ).toBe(0);
        expect(countSolidVoxels(copy.treeDepth, copy.nodes, copy.leafData)).toBe(1165978);
        const cc = blockComponents(copy);
        expect(cc.count).toBe(57);
        expect(sortedSizes(cc)).toEqual(sortedSizes(c));

        // an empty block whose 26 neighbours are empty too, far from the scan
        let spot: number[] | null = null;
        for (let bz = 1; bz < 89 && !spot; bz += 7) for (let by = 1; by < 50 && !spot; by += 5) for (let bx = 1; bx < 126 && !spot; bx += 11) {
            let clear = true;
            for (let dz = -1; dz <= 1 && clear; dz++) for (let dy = -1; dy <= 1 && clear; dy++) for (let dx = -1; dx <= 1 && clear; dx++) {
                if (componentAt(c, bx + dx, by + dy, bz + dz) >= 0) clear = false;
            }
            if (clear) spot = [bx, by, bz];
        }
        expect(spot).not.toBeNull();
        const planted: BlockMasks = new Map([...blocks].map(([k, m]) => [k, [m[0], m[1]] as [number, number]]));
        const v = [spot![0] * 4 + 2, spot![1] * 4 + 1, spot![2] * 4 + 3];
        setVoxel(planted, [nbx, nby], v[0], v[1], v[2]);
        const pc = blockComponents(encodeCollision(dims, planted, opts));
        expect(pc.count).toBe(58);
        const id = componentAt(pc, spot![0], spot![1], spot![2]);
        expect(pc.sizes[id]).toBe(1);
        expect(Array.from(pc.blockIds).filter((b) => b === id).length).toBe(1);
        // the rest keeps its grouping
        expect(sortedSizes(pc)).toEqual([1, ...sortedSizes(c)].sort((a, b) => a - b));
        // opposite case: the same voxel planted in an empty block on top of the scan is not a component of its own
        let above: number[] | null = null;
        for (let i = 0; i < c.keys.length && !above; i++) {
            const k = c.keys[i];
            const b = [k % nbx, Math.floor(k / nbx) % nby, Math.floor(k / (nbx * nby))];
            if (b[1] + 1 < nby && componentAt(c, b[0], b[1] + 1, b[2]) < 0) above = b;
        }
        expect(above).not.toBeNull();
        const joined: BlockMasks = new Map([...blocks].map(([k, m]) => [k, [m[0], m[1]] as [number, number]]));
        setVoxel(joined, [nbx, nby], above![0] * 4 + 2, (above![1] + 1) * 4, above![2] * 4 + 1);
        const jc = blockComponents(encodeCollision(dims, joined, opts));
        expect(jc.count).toBe(57);
        expect(componentAt(jc, above![0], above![1] + 1, above![2])).toBe(componentAt(jc, above![0], above![1], above![2]));
    });
});
