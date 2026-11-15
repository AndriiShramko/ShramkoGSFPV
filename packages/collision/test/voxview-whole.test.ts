// The voxel view's whole scene (lane voxview, X2): far cubes of 8 and 16 voxels cover every wall
// cell under them (their exposed faces equal a brute-force count over the merged occupancy), and
// the whole-scene plan gives every occupied chunk a level (none cut away), keeps the nearest ones
// per voxel and only gets coarser with distance. Each claim has a control.
import { describe, expect, it } from 'vitest';
import {
    buildChunkBlockFaces, blockComponents, occupiedChunks, overlayChunk, overlayLevels, levelCellVoxels, planChunks, COARSE_LEVELS,
    groupPlan, groupKey, groupOfKey, overlapKeys, chunkKey, FAR_GROUP
} from '../src/index';
import { blocksFromFn, encodeCollision } from './helpers';
import type { Dims } from './helpers';
import type { PlannedChunk } from '../src/index';

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

describe('voxel view: far group meshes', () => {
    // a synthetic whole plan over 16 x 4 x 16 chunks: levels by distance from a corner, some cells empty
    const dims = [16, 4, 16];
    const lodAt = (d: number): number => (d < 3 ? 0 : d < 6 ? 1 : d < 10 ? 2 : 3);
    const plan: PlannedChunk[] = [];
    for (let z = 0; z < dims[2]; z++) for (let y = 0; y < dims[1]; y++) for (let x = 0; x < dims[0]; x++) {
        if ((x * 7 + y * 3 + z * 5) % 11 === 0) continue;
        const dist = Math.hypot(x, y, z);
        plan.push({ key: chunkKey(dims, x, y, z), x, y, z, lod: lodAt(dist), dist });
    }
    plan.sort((a, b) => a.dist - b.dist);
    const byKey = new Map(plan.map((c) => [c.key, c]));
    const joined = groupPlan(dims, plan);
    /** the chunk keys a planned mesh covers (its own key, or its group's planned chunks) */
    const cover = (m: PlannedChunk): number[] => {
        const g = groupOfKey(dims, m.key);
        if (!g) return [m.key];
        const out: number[] = [];
        for (let z = g.z * g.g; z < (g.z + 1) * g.g; z++) for (let y = g.y * g.g; y < (g.y + 1) * g.g; y++) for (let x = g.x * g.g; x < (g.x + 1) * g.g; x++) {
            if (x < dims[0] && y < dims[1] && z < dims[2] && byKey.has(chunkKey(dims, x, y, z))) out.push(chunkKey(dims, x, y, z));
        }
        return out;
    };

    it('group keys are negative, apart from chunk keys, and name their group back', () => {
        for (const g of [2, 4, 8]) {
            const k = groupKey(dims, g, 1, 0, 1);
            expect(k).toBeLessThan(0);
            expect(groupOfKey(dims, k)).toEqual({ g, x: 1, y: 0, z: 1 });
        }
        expect(groupOfKey(dims, chunkKey(dims, 3, 1, 2))).toBeNull();
    });

    it('every wall chunk is covered by exactly one mesh, and a group holds one level only', () => {
        const seen = new Map<number, number>();
        for (const m of joined) {
            const keys = cover(m);
            if (m.group) {
                expect(keys.length).toBe(m.members);
                expect(FAR_GROUP[m.lod]).toContain(m.group);
                for (const k of keys) expect(byKey.get(k)!.lod).toBe(m.lod);
            }
            for (const k of keys) seen.set(k, (seen.get(k) ?? 0) + 1);
        }
        expect(seen.size).toBe(plan.length);
        for (const n of seen.values()) expect(n).toBe(1);
        // far chunks are joined: far fewer meshes than chunks
        expect(joined.length).toBeLessThan(plan.length / 3);
    });

    it('the near cells keep their size: no level 0 chunk is joined, nearest first', () => {
        const near = plan.filter((c) => c.lod === 0).map((c) => c.key).sort();
        expect(joined.filter((m) => m.lod === 0).map((m) => m.key).sort()).toEqual(near);
        expect(joined.filter((m) => m.lod === 0 && m.group)).toEqual([]);
        for (let i = 1; i < joined.length; i++) expect(joined[i].dist).toBeGreaterThanOrEqual(joined[i - 1].dist);
    });

    it('a mesh and the meshes over the same chunks at another grain find each other (no hole on a swap)', () => {
        const g = joined.find((m) => m.group === 8)!;
        expect(g).toBeDefined();
        const over = new Set(overlapKeys(dims, g.key));
        for (const k of cover(g)) expect(over.has(k)).toBe(true);
        const c = cover(g)[0];
        expect(overlapKeys(dims, c)).toContain(g.key);
    });

    it('a group mesh built the worker way covers every wall cell of its chunks', () => {
        // the test grid (96 x 40 x 120 voxels) in chunks of 32: one group of 4 covers it all
        const m = overlayChunk(col, { x: 0, y: 0, z: 0 }, 32 * 4, 3);
        expect(m.faces).toBe(bruteFaces(16));
        const m2 = overlayChunk(col, { x: 0, y: 0, z: 0 }, 32 * 4, 2);
        expect(m2.faces).toBe(bruteFaces(8));
    });

    it('the whole plan with groups covers every occupied chunk of real walls once', () => {
        const comp = blockComponents(col);
        const occ = new Set(occupiedChunks(col, comp, 32));
        const p = planChunks(col, 32, occ, 0, 0, 0, { radius: 5, fineQuads: 50, coarseQuads: 50, whole: true, groups: true, farQuads: 0 });
        expect(p.covered).toBe(occ.size);
        expect(p.chunks.reduce((s, c) => s + (c.members ?? 1), 0)).toBe(occ.size);
    });
});
