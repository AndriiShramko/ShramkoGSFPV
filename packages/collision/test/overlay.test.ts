// Voxel overlay (item 24): the block-level faces of the far level of detail equal a brute-force
// count over block occupancy, the grid UVs land on cell edges, floaters are flagged by volume,
// and the chunk plan spends its face budgets nearest first. Each claim has a control.
import { describe, expect, it } from 'vitest';
import {
    openVoxelCollision, buildChunkFaces, buildChunkBlockFaces, chunkDims, blockComponents, blockDims,
    overlayChunk, overlayChunkSize, occupiedChunks, floaterComponents, planChunks, chunkKey, chunkOfKey, FLOATER_M3
} from '../src/index';
import type { VoxelCollision } from '../src/index';
import { blocksFromFn, encodeCollision, loadFixture, sameSet, unrollQuads } from './helpers';
import type { Dims } from './helpers';

const ROOM: Dims = [64, 50, 58];
function roomSolid(x: number, y: number, z: number): boolean {
    if (y < 16) return true;
    const shell = x >= 4 && x < 60 && y < 46 && z >= 4 && z < 54 && (x < 6 || x >= 58 || y >= 44 || z < 6 || z >= 52);
    const floater = x >= 40 && x < 43 && y >= 30 && y < 33 && z >= 20 && z < 23;
    const dust = x === 30 && y === 38 && z === 12;
    return shell || floater || dust;
}
let seed = 5;
const rnd = (): number => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 4294967296; };
const RND: Dims = [40, 28, 36];
const fill = new Uint8Array(RND[0] * RND[1] * RND[2]).map(() => (rnd() < 0.08 ? 1 : 0));

const GRIDS: { name: string; col: VoxelCollision }[] = [
    { name: 'room', col: encodeCollision(ROOM, blocksFromFn(ROOM, roomSolid)) },
    { name: 'room, format 1.0 flipped, off-origin, 3.2 cm', col: encodeCollision(ROOM, blocksFromFn(ROOM, roomSolid), { version: '1.0', min: [-1.6, -1.25, 0.4], res: 0.032 }) },
    { name: 'sparse random 8 %', col: encodeCollision(RND, blocksFromFn(RND, (x, y, z) => fill[(z * RND[1] + y) * RND[0] + x] === 1)) }
];

const DIR: Dims[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

/** Brute force over blocks: a block is solid when any of its voxels is (isVoxelSolid, one call each). */
function blockSolidFn(col: VoxelCollision): (bx: number, by: number, bz: number) => boolean {
    const memo = new Map<number, boolean>();
    const [nx, ny, nz] = blockDims(col);
    return (bx, by, bz) => {
        if (bx < 0 || by < 0 || bz < 0 || bx >= nx || by >= ny || bz >= nz) return false;
        const k = (bz * ny + by) * nx + bx;
        let v = memo.get(k);
        if (v === undefined) {
            v = false;
            for (let z = 0; z < 4 && !v; z++) for (let y = 0; y < 4 && !v; y++) for (let x = 0; x < 4 && !v; x++) v = col.isVoxelSolid(bx * 4 + x, by * 4 + y, bz * 4 + z);
            memo.set(k, v);
        }
        return v;
    };
}

function bruteBlockFaces(col: VoxelCollision, chunk: { x: number; y: number; z: number }, size: number): Set<string> {
    const solid = blockSolidFn(col);
    const cells = size / 4;
    const out = new Set<string>();
    for (let z = 0; z < cells; z++) for (let y = 0; y < cells; y++) for (let x = 0; x < cells; x++) {
        const bx = chunk.x * cells + x, by = chunk.y * cells + y, bz = chunk.z * cells + z;
        if (!solid(bx, by, bz)) continue;
        for (let d = 0; d < 6; d++) if (!solid(bx + DIR[d][0], by + DIR[d][1], bz + DIR[d][2])) out.add(`${d},${bx},${by},${bz}`);
    }
    return out;
}

/** The same collision seen with 4x bigger cells: unrollQuads then reads block-level quads in block units. */
const asBlocks = (col: VoxelCollision): VoxelCollision =>
    ({ flipXY: col.flipXY, voxelResolution: col.voxelResolution * 4, gridMinX: col.gridMinX, gridMinY: col.gridMinY, gridMinZ: col.gridMinZ }) as unknown as VoxelCollision;

describe('block-level faces (far level of detail)', () => {
    for (const g of GRIDS) {
        it(`${g.name}: every chunk equals brute force over blocks, winding and area intact, chunks tile`, () => {
            let total = 0;
            for (const size of [16, 32]) {
                const [cx, cy, cz] = chunkDims(g.col, size);
                let sum = 0;
                for (let z = 0; z < cz; z++) for (let y = 0; y < cy; y++) for (let x = 0; x < cx; x++) {
                    const m = buildChunkBlockFaces(g.col, { x, y, z }, size);
                    const brute = bruteBlockFaces(g.col, { x, y, z }, size);
                    const u = unrollQuads(asBlocks(g.col), m);
                    expect(m.faces).toBe(brute.size);
                    expect(sameSet(brute, u.faces)).toEqual({ missing: 0, extra: 0 });
                    expect({ d: u.duplicates, w: u.badWinding, r: u.notARun, o: u.offGrid, a: u.area }).toEqual({ d: 0, w: 0, r: 0, o: 0, a: m.faces });
                    sum += m.faces;
                }
                if (total) expect(sum).toBe(total); // the same grid in 16- or 32-voxel chunks
                total = sum;
            }
            expect(total).toBeGreaterThan(100);
        });
    }

    it('control: one solid voxel is 6 voxel faces but one whole block cube; the room has 10x+ fewer faces at block level', () => {
        const one = encodeCollision([16, 16, 16], blocksFromFn([16, 16, 16], (x, y, z) => x === 5 && y === 9 && z === 2));
        const fine = buildChunkFaces(one, { x: 0, y: 0, z: 0 }, 16);
        const coarse = buildChunkBlockFaces(one, { x: 0, y: 0, z: 0 }, 16);
        expect([fine.faces, coarse.faces, fine.indices.length / 6, coarse.indices.length / 6]).toEqual([6, 6, 6, 6]);
        const span = (m: typeof fine): number => Math.max(...Array.from(m.positions.filter((_, i) => i % 3 === 0))) - Math.min(...Array.from(m.positions.filter((_, i) => i % 3 === 0)));
        expect(span(fine)).toBeCloseTo(0.05, 6);
        expect(span(coarse)).toBeCloseTo(0.2, 6);
        const room = GRIDS[0].col;
        let f = 0, c = 0;
        const [cx, cy, cz] = chunkDims(room, 32);
        for (let z = 0; z < cz; z++) for (let y = 0; y < cy; y++) for (let x = 0; x < cx; x++) {
            f += buildChunkFaces(room, { x, y, z }, 32).faces;
            c += buildChunkBlockFaces(room, { x, y, z }, 32).faces;
        }
        expect(c * 10).toBeLessThan(f);
    });
});

describe('overlayChunk: grid UVs and floater flags', () => {
    it('UVs are whole numbers of cells at every corner, for both levels and both formats', () => {
        for (const g of GRIDS.slice(0, 2)) {
            for (const lod of [0, 1] as const) {
                const m = overlayChunk(g.col, { x: 0, y: 0, z: 0 }, 32, lod);
                expect(m.quads).toBeGreaterThan(10);
                let off = 0, spanned = 0;
                for (let i = 0; i < m.uvs.length; i++) if (Math.abs(m.uvs[i] - Math.round(m.uvs[i])) > 1e-3) off++;
                // a quad's UV extent equals its size in cells (the texture repeats once per cell)
                for (let k = 0; k < m.quads; k++) {
                    const du = Math.abs(m.uvs[(k * 4 + 2) * 2] - m.uvs[k * 4 * 2]) + Math.abs(m.uvs[(k * 4 + 2) * 2 + 1] - m.uvs[k * 4 * 2 + 1]);
                    if (du >= 2 - 1e-3) spanned++;
                }
                expect(off).toBe(0);
                expect(spanned).toBe(m.quads);
                expect(m.normals.length).toBe(m.positions.length);
            }
        }
    });

    it('control: UVs taken from the wrong corner (no flip correction) miss the cell edges', () => {
        const g = GRIDS[1].col; // flipped, off-origin
        const m = overlayChunk(g, { x: 0, y: 0, z: 0 }, 32, 0);
        let off = 0;
        for (let v = 0; v < m.quads * 4; v++) {
            // y: -1.25 m is not a whole number of 3.2 cm cells, so the flip matters there
            if (m.normals[v * 3 + 1] === 0) { const u = (m.positions[v * 3 + 1] - g.gridMinY) / g.voxelResolution; if (Math.abs(u - Math.round(u)) > 1e-3) off++; }
        }
        expect(off).toBeGreaterThan(0);
    });

    it('the 3-voxel floater and the dust voxel are flagged, the room is not; without components nothing is', () => {
        const col = GRIDS[0].col;
        const comp = blockComponents(col);
        const fl = floaterComponents(comp, col.voxelResolution);
        const m = overlayChunk(col, { x: 1, y: 0, z: 0 }, 32, 0, comp, fl);
        expect(m.floaterQuads).toBeGreaterThan(0);
        expect(m.floaterQuads).toBeLessThan(m.quads / 4);
        // every flagged quad lies inside the floater's or the dust voxel's box
        let outside = 0;
        for (let k = 0; k < m.quads; k++) {
            if (!m.floater[k]) continue;
            const [x, y, z] = [0, 1, 2].map((a) => Math.round((m.positions[k * 12 + a] / 0.05) * 1000) / 1000);
            const inFloater = x >= 40 && x <= 43 && y >= 30 && y <= 33 && z >= 20 && z <= 23;
            const inDust = x >= 30 && x <= 31 && y >= 38 && y <= 39 && z >= 12 && z <= 13;
            if (!inFloater && !inDust) outside++;
        }
        expect(outside).toBe(0);
        const plain = overlayChunk(col, { x: 1, y: 0, z: 0 }, 32, 0);
        expect(plain.floaterQuads).toBe(0);
        // the same pieces at the block level
        const mc = overlayChunk(col, { x: 1, y: 0, z: 0 }, 32, 1, comp, fl);
        expect(mc.floaterQuads).toBeGreaterThan(0);
    });

    it('floaters by volume: the largest piece never is one; a 0 m³ threshold flags nothing', () => {
        const col = GRIDS[0].col;
        const comp = blockComponents(col);
        const fl = floaterComponents(comp, col.voxelResolution);
        const big = comp.sizes.indexOf(Math.max(...comp.sizes));
        expect(fl[big]).toBe(0);
        expect(fl.reduce((a, b) => a + b, 0)).toBe(comp.count - 1);
        expect(floaterComponents(comp, col.voxelResolution, 0).reduce((a, b) => a + b, 0)).toBe(0);
        expect(FLOATER_M3).toBe(0.5);
    });
});

describe('occupied chunks and the chunk plan', () => {
    it('occupiedChunks equals a brute-force scan of every chunk (control: an empty chunk is not listed)', () => {
        for (const g of GRIDS) {
            const comp = blockComponents(g.col);
            const size = 16;
            const occ = occupiedChunks(g.col, comp, size);
            const dims = chunkDims(g.col, size);
            const brute: number[] = [];
            const solid = blockSolidFn(g.col);
            for (let z = 0; z < dims[2]; z++) for (let y = 0; y < dims[1]; y++) for (let x = 0; x < dims[0]; x++) {
                let any = false;
                for (let bz = 0; bz < 4 && !any; bz++) for (let by = 0; by < 4 && !any; by++) for (let bx = 0; bx < 4 && !any; bx++) any = solid(x * 4 + bx, y * 4 + by, z * 4 + bz);
                if (any) brute.push(chunkKey(dims, x, y, z));
            }
            expect(Array.from(occ)).toEqual(brute);
            const k = brute[brute.length - 1];
            expect(chunkKey(dims, ...chunkOfKey(dims, k))).toBe(k);
        }
        const room = GRIDS[0].col;
        const dims = chunkDims(room, 16);
        const empty = chunkKey(dims, 1, 1, 1); // voxels 16..31 on every axis: above the floor, inside the walls, clear of the floater and dust
        expect(Array.from(occupiedChunks(room, blockComponents(room), 16)).includes(empty)).toBe(false);
    });

    it('nearest first, level 0 until its budget, then level 1, never past the radius', () => {
        const { meta, bin, spawn } = loadFixture();
        const col = openVoxelCollision(meta, bin);
        const size = overlayChunkSize(col.voxelResolution);
        expect(size).toBe(48);
        const comp = blockComponents(col);
        const occ = new Set(occupiedChunks(col, comp, size));
        const known = { fine: new Map<number, number>(), coarse: new Map<number, number>() };
        // measure every chunk once, so the plan works with real numbers
        for (const k of occ) {
            const [x, y, z] = chunkOfKey(chunkDims(col, size), k);
            known.fine.set(k, overlayChunk(col, { x, y, z }, size, 0).quads);
            known.coarse.set(k, overlayChunk(col, { x, y, z }, size, 1).quads);
        }
        const plan = planChunks(col, size, occ, spawn[0], spawn[1], spawn[2], { radius: 12, fineQuads: 150_000, coarseQuads: 60_000, known });
        const d = plan.chunks.map((c) => c.dist);
        expect([...d].sort((a, b) => a - b)).toEqual(d);
        const firstCoarse = plan.chunks.findIndex((c) => c.lod === 1);
        expect(firstCoarse).toBeGreaterThan(0);
        expect(plan.chunks.slice(firstCoarse).every((c) => c.lod === 1)).toBe(true);
        expect(plan.fineQuads).toBeLessThanOrEqual(150_000);
        expect(plan.coarseQuads).toBeLessThanOrEqual(60_000);
        expect(Math.max(...d)).toBeLessThanOrEqual(12);
        const sumFine = plan.chunks.filter((c) => c.lod === 0).reduce((a, c) => a + known.fine.get(c.key)!, 0);
        expect(sumFine).toBe(plan.fineQuads);
        console.log(`[overlay] 39e63ce9 plan r 12 m: ${plan.chunks.length} chunks, fine to ${plan.fineRadius.toFixed(1)} m (${plan.fineQuads} quads), all to ${plan.radius.toFixed(1)} m (+${plan.coarseQuads})`);
        // controls: an unlimited fine budget keeps everything at level 0; no fine budget makes it all level 1
        const all = planChunks(col, size, occ, spawn[0], spawn[1], spawn[2], { radius: 12, fineQuads: 1e9, coarseQuads: 0, known });
        expect(all.chunks.every((c) => c.lod === 0)).toBe(true);
        expect(all.chunks.length).toBeGreaterThan(plan.chunks.filter((c) => c.lod === 0).length);
        const none = planChunks(col, size, occ, spawn[0], spawn[1], spawn[2], { radius: 12, fineQuads: 0, coarseQuads: 1e9, known });
        expect(none.chunks.every((c) => c.lod === 1)).toBe(true);
        expect(none.chunks.length).toBe(all.chunks.length);
        // a camera far outside the grid sees nothing
        expect(planChunks(col, size, occ, 1000, 0, 0, { radius: 20, fineQuads: 1e9, coarseQuads: 1e9 }).chunks.length).toBe(0);
    });

    it('chunk size follows the voxel size (about 2.4 m, multiple of 4, 32..128)', () => {
        expect([0.05, 0.032, 0.016, 0.008, 0.2].map(overlayChunkSize)).toEqual([48, 76, 128, 128, 32]);
        for (const r of [0.05, 0.032, 0.016]) expect(overlayChunkSize(r) % 4).toBe(0);
        expect(() => overlayChunkSize(0)).toThrow(RangeError);
    });
});
