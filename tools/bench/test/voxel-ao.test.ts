// Lane vox4 (voxux4 V-2b): per-vertex ambient occlusion of the voxel overlay (apps/fly voxel-ao.ts).
// The corner rule, then a real chunk: a floor with a one-voxel wall standing on it darkens exactly the
// corners where floor meets wall, on both kinds of grid (v1.1 and the flipped v1.0), at voxels and blocks.
import { describe, expect, it } from 'vitest';
import { blockComponents, overlayChunk } from '@gsfpv/collision';
import type { VoxelCollision } from '@gsfpv/collision';
import { chunkAo, quadAo, vertexAo } from '../../../apps/fly/src/voxel-ao';
import { blocksFromFn, encodeCollision } from '../../../packages/collision/test/helpers';
import type { Dims } from '../../../packages/collision/test/helpers';

describe('vertexAo: the corner rule', () => {
    it('open, one side, side and corner, two sides', () => {
        expect(vertexAo(false, false, false)).toBe(0);
        expect(vertexAo(false, false, true)).toBe(1);
        expect(vertexAo(true, false, false)).toBe(1);
        expect(vertexAo(false, true, true)).toBe(2);
        expect(vertexAo(true, true, false)).toBe(3);
        expect(vertexAo(true, true, true)).toBe(3);
    });
});

const DIMS: Dims = [16, 16, 16];
const RES = 0.05;
// a floor (iy 0) and on it a wall one voxel thick at ix 8, 4 voxels high, across the whole z
const solid = (ix: number, iy: number, _iz: number): boolean => iy === 0 || (ix === 8 && iy >= 1 && iy <= 4);

function scene(version: '1.0' | '1.1'): VoxelCollision {
    return encodeCollision(DIMS, blocksFromFn(DIMS, solid), { res: RES, min: [0, 0, 0], version });
}

interface V { g: [number, number, number]; n: [number, number, number]; ao: number }

/** The chunk's vertices in grid indices (the flip undone) with their normal and AO level. */
function vertices(col: VoxelCollision, lod: number): V[] {
    const c = overlayChunk(col, { x: 0, y: 0, z: 0 }, 16, lod, blockComponents(col));
    const ao = chunkAo(col, { x: 0, y: 0, z: 0 }, 16, c, lod);
    expect(ao).not.toBeNull();
    const cell = RES * (lod === 0 ? 1 : 4);
    const s = (ax: number): number => (col.flipXY && ax < 2 ? -1 : 1);
    const out: V[] = [];
    for (let v = 0; v < c.quads * 4; v++) {
        const g = [0, 1, 2].map((ax) => Math.round((c.positions[v * 3 + ax] * s(ax) - [col.gridMinX, col.gridMinY, col.gridMinZ][ax]) / cell)) as [number, number, number];
        const n = [0, 1, 2].map((ax) => c.normals[v * 3 + ax] * s(ax)) as [number, number, number];
        out.push({ g, n, ao: ao![v] });
    }
    return out;
}

describe('chunkAo: a floor meeting a wall', () => {
    for (const version of ['1.1', '1.0'] as const) {
        it(`voxels (level 0), grid v${version}: dark where floor meets wall, open elsewhere`, () => {
            const col = scene(version);
            expect(col.flipXY).toBe(version === '1.0');
            const vs = vertices(col, 0);
            const floorTop = vs.filter((v) => v.n[1] === 1 && v.g[1] === 1);
            expect(floorTop.length).toBeGreaterThan(0);
            // the floor's top corners on the wall's two foot lines (x 8 and 9) are shaded, the rest open
            const foot = floorTop.filter((v) => v.g[0] === 8 || v.g[0] === 9);
            expect(foot.length).toBeGreaterThan(0);
            expect(foot.every((v) => v.ao >= 1)).toBe(true);
            expect(floorTop.filter((v) => v.g[0] !== 8 && v.g[0] !== 9).every((v) => v.ao === 0)).toBe(true);
            // the wall's side faces: their bottom corners touch the floor, the higher ones are open
            const side = vs.filter((v) => v.n[0] !== 0 && (v.g[0] === 8 || v.g[0] === 9) && v.g[1] >= 1);
            expect(side.length).toBeGreaterThan(0);
            expect(side.filter((v) => v.g[1] === 1).every((v) => v.ao >= 1)).toBe(true);
            expect(side.filter((v) => v.g[1] >= 2).every((v) => v.ao === 0)).toBe(true);
            // the wall's top and the floor's underside see nothing
            expect(vs.filter((v) => v.n[1] === 1 && v.g[1] === 5).every((v) => v.ao === 0)).toBe(true);
            expect(vs.filter((v) => v.n[1] === -1).every((v) => v.ao === 0)).toBe(true);
        });
    }

    it('blocks (level 1): the floor block row beside the wall block row is shaded, far rows open', () => {
        const vs = vertices(scene('1.1'), 1);
        // in blocks: floor block row by 0 everywhere, the wall's block column bx 2 rises to by 1
        const floorTop = vs.filter((v) => v.n[1] === 1 && v.g[1] === 1);
        expect(floorTop.filter((v) => v.g[0] === 2 || v.g[0] === 3).every((v) => v.ao >= 1)).toBe(true);
        expect(floorTop.filter((v) => v.g[0] === 0 || v.g[0] === 4).every((v) => v.ao === 0)).toBe(true);
    });

    it('the coarse levels stay unshaded', () => {
        const col = scene('1.1');
        const c = overlayChunk(col, { x: 0, y: 0, z: 0 }, 16, 2, blockComponents(col));
        expect(chunkAo(col, { x: 0, y: 0, z: 0 }, 16, c, 2)).toBeNull();
    });

    it('quadAo returns one level per vertex', () => {
        const pos = new Float32Array([0, 1, 0, 1, 1, 0, 1, 1, 1, 0, 1, 1]);
        const nrm = new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]);
        const ao = quadAo(pos, nrm, 1, { min: [0, 0, 0], flipXY: false, cell: 1, solid: (x, y) => y === 1 && x === 1 });
        // the row of cells (1, 1, any z) in front: the corners at x 1 have it beside and across them
        expect(Array.from(ao)).toEqual([0, 2, 2, 0]);
    });
});
