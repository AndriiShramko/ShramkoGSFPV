// G.1 mesh: exposed voxel faces per chunk, merged into 1-D runs, equal to a brute-force count
// over isVoxelSolid (G.6: 3 synthetic grids and 32^3 chunks of the 39e63ce9 fixture).
import { describe, expect, it } from 'vitest';
import {
    openVoxelCollision, buildChunkFaces, chunkAt, chunkDims, blockComponents, componentAt, syntheticRoom, usesOctree
} from '../src/index';
import type { VoxelCollision, ChunkMesh } from '../src/index';
import { blocksFromFn, bruteFaces, encodeCollision, lcg, loadFixture, openRaw, sameSet, unrollQuads } from './helpers';
import type { Dims } from './helpers';

const rnd = lcg(11);
const RANDOM_DIMS: Dims = [44, 36, 40];
const randomFill = new Uint8Array(RANDOM_DIMS[0] * RANDOM_DIMS[1] * RANDOM_DIMS[2]).map(() => (rnd() < 0.3 ? 1 : 0));
const randomSolid = (x: number, y: number, z: number): boolean => randomFill[(z * RANDOM_DIMS[1] + y) * RANDOM_DIMS[0] + x] === 1;

// A room: a 2-voxel shell, a floor slab of full blocks (solid markers above the leaf level), a
// pillar, a 3x3x3 floater and a single floating voxel. 50 and 58 are not multiples of 4.
const ROOM_DIMS: Dims = [64, 50, 58];
function roomSolid(x: number, y: number, z: number): boolean {
    if (y < 16) return true;
    const shell = x >= 4 && x < 60 && y < 46 && z >= 4 && z < 54 && (x < 6 || x >= 58 || y >= 44 || z < 6 || z >= 52);
    const pillar = x >= 20 && x < 23 && z >= 30 && z < 34 && y < 44;
    const floater = x >= 40 && x < 43 && y >= 30 && y < 33 && z >= 20 && z < 23;
    const dust = x === 30 && y === 38 && z === 12;
    return shell || pillar || floater || dust;
}
const CHECKER_DIMS: Dims = [24, 24, 24];
const checkerSolid = (x: number, y: number, z: number): boolean => (x + y + z) % 2 === 0;

const GRIDS: { name: string; col: VoxelCollision }[] = [
    { name: 'random 30 %', col: encodeCollision(RANDOM_DIMS, blocksFromFn(RANDOM_DIMS, randomSolid)) },
    { name: 'room with floaters', col: encodeCollision(ROOM_DIMS, blocksFromFn(ROOM_DIMS, roomSolid)) },
    { name: 'checkerboard', col: encodeCollision(CHECKER_DIMS, blocksFromFn(CHECKER_DIMS, checkerSolid)) },
    { name: 'room, format 1.0 (flipped), off-origin grid', col: encodeCollision(ROOM_DIMS, blocksFromFn(ROOM_DIMS, roomSolid), { version: '1.0', min: [-1.6, -1.25, 0.4], res: 0.032 }) },
    { name: 'room, full blocks as leaves (no solid markers)', col: encodeCollision(ROOM_DIMS, blocksFromFn(ROOM_DIMS, roomSolid), { solidMarkers: false }) }
];

/** Every unit face of every quad, probed through the collision's own world-space query. */
function probeWorld(col: VoxelCollision, m: ChunkMesh): { inside: number; outside: number; bad: number } {
    const res = col.voxelResolution;
    const r = 0.3 * res; // touches only the voxel it sits in
    const push = { x: 0, y: 0, z: 0 };
    let inside = 0, outside = 0, bad = 0;
    for (let k = 0; k < m.indices.length / 6; k++) {
        const v0 = m.indices[k * 6], v1 = m.indices[k * 6 + 1], v3 = m.indices[k * 6 + 5];
        const P = (v: number): number[] => [m.positions[v * 3], m.positions[v * 3 + 1], m.positions[v * 3 + 2]];
        const p0 = P(v0), U = P(v1).map((x, i) => x - p0[i]), V = P(v3).map((x, i) => x - p0[i]);
        const n = [m.normals[v0 * 3], m.normals[v0 * 3 + 1], m.normals[v0 * 3 + 2]];
        const nu = Math.round(Math.hypot(U[0], U[1], U[2]) / res), nv = Math.round(Math.hypot(V[0], V[1], V[2]) / res);
        for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
            const c = p0.map((x, a) => x + (U[a] * (i + 0.5)) / nu + (V[a] * (j + 0.5)) / nv);
            if (col.querySphere(c[0] - n[0] * res * 0.5, c[1] - n[1] * res * 0.5, c[2] - n[2] * res * 0.5, r, push)) inside++; else bad++;
            if (!col.querySphere(c[0] + n[0] * res * 0.5, c[1] + n[1] * res * 0.5, c[2] + n[2] * res * 0.5, r, push)) outside++; else bad++;
        }
    }
    return { inside, outside, bad };
}

function checkChunk(col: VoxelCollision, chunk: { x: number; y: number; z: number }, size: number): { faces: number; quads: number } {
    const m = buildChunkFaces(col, chunk, size);
    const brute = bruteFaces(col, chunk, size);
    const u = unrollQuads(col, m);
    expect(m.faces).toBe(brute.size);
    expect(sameSet(brute, u.faces)).toEqual({ missing: 0, extra: 0 });
    expect({ duplicates: u.duplicates, badWinding: u.badWinding, notARun: u.notARun, offGrid: u.offGrid }).toEqual({ duplicates: 0, badWinding: 0, notARun: 0, offGrid: 0 });
    // merging keeps the total face area
    expect(u.area).toBe(m.faces);
    expect(m.positions.length).toBe((m.indices.length / 6) * 12);
    expect(m.normals.length).toBe(m.positions.length);
    return { faces: m.faces, quads: m.indices.length / 6 };
}

describe('buildChunkFaces equals brute force on synthetic octrees', () => {
    for (const g of GRIDS) {
        for (const size of [16, 32]) {
            it(`${g.name}, chunk ${size}: every chunk's face set, winding and area`, () => {
                expect(usesOctree(g.col)).toBe(true);
                const [cx, cy, cz] = chunkDims(g.col, size);
                let faces = 0, quads = 0;
                for (let z = 0; z < cz; z++) for (let y = 0; y < cy; y++) for (let x = 0; x < cx; x++) {
                    const r = checkChunk(g.col, { x, y, z }, size);
                    faces += r.faces;
                    quads += r.quads;
                }
                // chunks tile: the sum equals one brute-force pass over the whole grid
                const whole = bruteFaces(g.col, { x: 0, y: 0, z: 0 }, Math.max(g.col.numVoxelsX, g.col.numVoxelsY, g.col.numVoxelsZ));
                expect(faces).toBe(whole.size);
                expect(faces).toBeGreaterThan(1000);
                if (g.name === 'checkerboard') expect(quads).toBe(faces); // nothing touches: nothing to merge
                else expect(quads).toBeLessThan(faces);
            });
        }
    }

    it('the quads sit where the collision has them: solid behind every face, free in front (both formats)', () => {
        for (const g of [GRIDS[1], GRIDS[3]]) {
            const m = buildChunkFaces(g.col, { x: 0, y: 0, z: 0 }, 32);
            const p = probeWorld(g.col, m);
            expect(p.bad).toBe(0);
            expect(p.inside).toBe(m.faces);
        }
    });

    it('control: the checks catch a moved quad, a dropped quad and a flipped triangle', () => {
        const col = GRIDS[1].col;
        const m = buildChunkFaces(col, { x: 1, y: 0, z: 1 }, 32);
        const brute = bruteFaces(col, { x: 1, y: 0, z: 1 }, 32);
        // push the first x-facing quad one voxel out along its normal
        const moved = { ...m, positions: m.positions.slice() };
        const k = Array.from({ length: m.indices.length / 6 }, (_, i) => i).find((i) => m.normals[i * 12] !== 0)!;
        for (let v = k * 4; v < k * 4 + 4; v++) moved.positions[v * 3] += m.normals[k * 12] * col.voxelResolution;
        const um = unrollQuads(col, moved);
        expect(sameSet(brute, um.faces).missing).toBeGreaterThan(0);
        expect(probeWorld(col, moved).bad).toBeGreaterThan(0);
        const dropped = { ...m, indices: m.indices.slice(6) };
        expect(sameSet(brute, unrollQuads(col, dropped).faces).missing).toBeGreaterThan(0);
        const flipped = { ...m, indices: m.indices.slice() };
        [flipped.indices[1], flipped.indices[2]] = [flipped.indices[2], flipped.indices[1]];
        expect(unrollQuads(col, flipped).badWinding).toBe(1);
    });
});

describe('buildChunkFaces follows isVoxelSolid in its corner cases', () => {
    it('a solid node overhanging a grid that is not a multiple of 4 voxels: faces stop at the grid', () => {
        const col = openRaw([6, 5, 7], 1, [0xff000000 >>> 0], [], { res: 0.05, min: [0, 0, 0], version: '1.1' });
        const r = checkChunk(col, { x: 0, y: 0, z: 0 }, 8);
        expect(r.faces).toBe(2 * (6 * 5 + 5 * 7 + 6 * 7));
        expect(r.quads).toBeLessThan(r.faces);
    });

    it('a mixed leaf and a solid node above the leaf level apply to every block below them', () => {
        // depth 3: root has children in octants 0 and 1; octant 0 is a mixed leaf at level 1 (4^3
        // blocks all with the same mask), octant 1 a solid node at level 1
        const col = openRaw([32, 32, 32], 3, [((0b11 << 24) | 1) >>> 0, 0, 0xff000000 >>> 0], [0x8421f00f, 0x00ff1248], { res: 0.05, min: [0, 0, 0], version: '1.1' });
        let faces = 0;
        for (const size of [8, 16, 32]) {
            const [cx, cy, cz] = chunkDims(col, size);
            let sum = 0;
            for (let z = 0; z < cz; z++) for (let y = 0; y < cy; y++) for (let x = 0; x < cx; x++) sum += checkChunk(col, { x, y, z }, size).faces;
            if (faces) expect(sum).toBe(faces);
            faces = sum;
        }
        expect(faces).toBeGreaterThan(1000);
    });

    it('analytic worlds (no octree) are read through their own isVoxelSolid', () => {
        const room = syntheticRoom(0.05, 1);
        expect(usesOctree(room)).toBe(false);
        const [cx, cy, cz] = chunkDims(room, 16);
        let faces = 0;
        for (let z = 0; z < cz; z++) for (let y = 0; y < cy; y++) for (let x = 0; x < cx; x++) faces += checkChunk(room, { x, y, z }, 16).faces;
        expect(faces).toBeGreaterThan(0);
    });

    it('empty and invalid requests', () => {
        const col = GRIDS[1].col;
        expect(buildChunkFaces(col, { x: -1, y: 0, z: 0 }, 32).faces).toBe(0);
        expect(buildChunkFaces(col, { x: 9, y: 9, z: 9 }, 32).indices.length).toBe(0);
        expect(() => buildChunkFaces(col, { x: 0, y: 0, z: 0 }, 30)).toThrow(RangeError);
        expect(() => buildChunkFaces(col, { x: 0.5, y: 0, z: 0 }, 32)).toThrow(RangeError);
        const other = blockComponents(GRIDS[0].col);
        expect(() => buildChunkFaces(col, { x: 0, y: 0, z: 0 }, 32, { components: other })).toThrow(/another voxel grid/);
    });
});

describe('component per vertex (floater colouring)', () => {
    it('the floater and the dust voxel carry their own small components, the room the big one', () => {
        const col = GRIDS[1].col;
        const comp = blockComponents(col);
        const m = buildChunkFaces(col, { x: 1, y: 0, z: 0 }, 32, { components: comp });
        expect(m.component!.length).toBe((m.indices.length / 6) * 4);
        const floater = componentAt(comp, 41 >> 2, 31 >> 2, 21 >> 2);
        const room = componentAt(comp, 0, 0, 0);
        expect(floater).not.toBe(room);
        expect(comp.sizes[floater]).toBeLessThan(10);
        const ids = new Set(m.component);
        expect(ids.has(floater)).toBe(true);
        expect(ids.has(room)).toBe(true);
        // each quad's vertices share one id, and it is the component of the voxel behind the quad
        const res = col.voxelResolution;
        let wrong = 0;
        for (let k = 0; k < m.indices.length / 6; k++) {
            const id = m.component![k * 4];
            for (let c = 1; c < 4; c++) if (m.component![k * 4 + c] !== id) wrong++;
            const p = [0, 1, 2].map((a) => (m.positions[k * 12 + a] + m.positions[k * 12 + 6 + a]) / 2);
            // half a voxel behind the quad's centre is inside the run (on an even run, on a border
            // between two of its voxels, which share a component either way); format 1.1, no flip
            const behind = p.map((x, a) => x - m.normals[k * 12 + a] * res * 0.5);
            const idx = behind.map((x, a) => Math.floor((x - [col.gridMinX, col.gridMinY, col.gridMinZ][a]) / res));
            if (componentAt(comp, idx[0] >> 2, idx[1] >> 2, idx[2] >> 2) !== id) wrong++;
        }
        expect(wrong).toBe(0);
        const withoutComp = buildChunkFaces(col, { x: 1, y: 0, z: 0 }, 32);
        expect(withoutComp.component).toBeUndefined();
    });
});

describe('fixture 39e63ce9 (format 1.0, 5 cm)', () => {
    const { meta, bin, spawn } = loadFixture();
    const col = openVoxelCollision(meta, bin);

    it('the 27 chunks of 32^3 around the spawn and the partial far corner equal brute force', () => {
        const c = chunkAt(col, spawn[0], spawn[1], spawn[2], 32);
        let faces = 0, quads = 0;
        for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const r = checkChunk(col, { x: c.x + dx, y: c.y + dy, z: c.z + dz }, 32);
            faces += r.faces;
            quads += r.quads;
        }
        const [ex, ey, ez] = chunkDims(col, 32);
        checkChunk(col, { x: ex - 1, y: ey - 1, z: ez - 1 }, 32);
        console.log(`[mesh] 39e63ce9 spawn chunk ${JSON.stringify(c)} and neighbours: ${faces} faces -> ${quads} quads`);
        expect(faces).toBeGreaterThan(10000);
        expect(quads).toBeLessThan(faces);
    });

    it('all 1 344 chunks together have exactly the brute-force number of faces of the whole grid', () => {
        const [cx, cy, cz] = chunkDims(col, 32);
        let faces = 0;
        for (let z = 0; z < cz; z++) for (let y = 0; y < cy; y++) for (let x = 0; x < cx; x++) faces += buildChunkFaces(col, { x, y, z }, 32).faces;
        // counted, not collected: a set of 900 k keys costs seconds
        let brute = 0;
        for (let iz = 0; iz < col.numVoxelsZ; iz++) for (let iy = 0; iy < col.numVoxelsY; iy++) for (let ix = 0; ix < col.numVoxelsX; ix++) {
            if (!col.isVoxelSolid(ix, iy, iz)) continue;
            brute += +!col.isVoxelSolid(ix + 1, iy, iz) + +!col.isVoxelSolid(ix - 1, iy, iz) + +!col.isVoxelSolid(ix, iy + 1, iz)
                + +!col.isVoxelSolid(ix, iy - 1, iz) + +!col.isVoxelSolid(ix, iy, iz + 1) + +!col.isVoxelSolid(ix, iy, iz - 1);
        }
        expect(cx * cy * cz).toBe(1344);
        expect(faces).toBe(brute);
        expect(faces).toBe(897870);
    });

    it('every face of the spawn chunk has solid behind it and free space in front, in world space', () => {
        const c = chunkAt(col, spawn[0], spawn[1], spawn[2], 32);
        const t0 = performance.now();
        const m = buildChunkFaces(col, c, 32);
        const ms = performance.now() - t0;
        const p = probeWorld(col, m);
        console.log(`[mesh] 39e63ce9 spawn chunk: ${m.faces} faces, ${m.indices.length / 6} quads, built in ${ms.toFixed(1)} ms; probes ${JSON.stringify(p)}`);
        expect(m.faces).toBeGreaterThan(1000);
        expect(p).toEqual({ inside: m.faces, outside: m.faces, bad: 0 });
        // control: the same mesh against the data read without the format 1.0 flip is mostly wrong
        const unflipped = openVoxelCollision(meta, bin, { forceFlip: false });
        expect(probeWorld(unflipped, m).bad).toBeGreaterThan(m.faces / 4);
    });
});
