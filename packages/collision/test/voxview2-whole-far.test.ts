// voxview2 VR-9: the whole-scene plan (the view of voxels alone) keeps every occupied chunk for an
// eye far outside the grid too. Measured before the fix on Housefly d10c5638 (about 31 m across):
// 140 m above the spawn the plan held 0 chunks and the screen showed no voxel.
import { describe, expect, it } from 'vitest';
import { blockComponents, occupiedChunks, planChunks } from '../src/index';
import { blocksFromFn, encodeCollision } from './helpers';
import type { Dims } from './helpers';

let seed = 7;
const rnd = (): number => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 4294967296; };
const D: Dims = [96, 40, 120];
const fill = new Uint8Array(D[0] * D[1] * D[2]).map(() => (rnd() < 0.004 ? 1 : 0));
const col = encodeCollision(D, blocksFromFn(D, (x, y, z) => y < 3 || fill[(z * D[1] + y) * D[0] + x] === 1));

describe('voxview2: the whole-scene plan from far outside the scene', () => {
    const size = 16;
    const occ = new Set(occupiedChunks(col, blockComponents(col), size));
    const span = Math.max(...D) * col.voxelResolution;
    const eyes: Array<[number, number, number]> = [
        [1, 4, 1],
        [1, 4 + 10 * span, 1],
        [1, 4 - 10 * span, 1],
        [-10 * span, 4, 1],
        [1, 4, 10 * span],
        [10 * span, 10 * span, 10 * span]
    ];

    it('plans every occupied chunk once wherever the eye is', () => {
        expect(occ.size).toBeGreaterThan(10);
        for (const e of eyes) {
            const plan = planChunks(col, size, occ, e[0], e[1], e[2], { radius: 0.5, fineQuads: 400, coarseQuads: 300, whole: true, farQuads: 200 });
            const keys = plan.chunks.map((c) => c.key);
            expect({ eye: e, n: keys.length }).toEqual({ eye: e, n: occ.size });
            expect(new Set(keys).size).toBe(keys.length);
        }
    });

    it('without the whole view an eye far outside still plans nothing (the radius holds)', () => {
        const far = eyes[1];
        const cut = planChunks(col, size, occ, far[0], far[1], far[2], { radius: 0.5, fineQuads: 400, coarseQuads: 300 });
        expect(cut.chunks.length).toBe(0);
    });
});
