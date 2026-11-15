// The voxel view's frame rate keeper (lane voxview, V3): slow frames halve the near budgets' share
// down to a floor, fast frames give it back only after several looks in a row. Pure numbers.
import { describe, expect, it } from 'vitest';
import { drawnShare, fillLeftS, trimFillSamples, keeperStep, KEEPER_MIN, KEEPER_FAST_TURNS, KEEPER_SLOW_MS, KEEPER_FAST_MS } from '../../../apps/fly/src/voxel-keeper';

describe('voxel frame rate keeper', () => {
    it('halves the share on slow frames, never under the floor', () => {
        let d = 1;
        for (let i = 0; i < 10; i++) d = keeperStep(d, KEEPER_SLOW_MS + 10, 0).detail;
        expect(d).toBe(KEEPER_MIN);
        expect(KEEPER_MIN).toBeGreaterThan(0);
    });

    it('gives the share back only after enough fast looks in a row', () => {
        let s = { detail: 0.25, fast: 0 };
        for (let i = 1; i < KEEPER_FAST_TURNS; i++) {
            s = keeperStep(s.detail, KEEPER_FAST_MS - 5, s.fast);
            expect(s.detail).toBe(0.25);
        }
        s = keeperStep(s.detail, KEEPER_FAST_MS - 5, s.fast);
        expect(s.detail).toBe(0.5);
        // a frame between the two bounds breaks the row
        expect(keeperStep(0.5, (KEEPER_FAST_MS + KEEPER_SLOW_MS) / 2, 3)).toEqual({ detail: 0.5, fast: 0 });
    });

    it('keeps the share at a steady 30 Hz display (33 ms)', () => {
        expect(keeperStep(1, 33.3, 0).detail).toBe(1);
        expect(keeperStep(0.5, 33.3, 2)).toEqual({ detail: 0.5, fast: 0 });
    });
});

describe('voxel view: the share in the walls line', () => {
    const plan = [
        { key: 1, lod: 0, dist: 1 },
        { key: 2, lod: 1, dist: 10 },
        { key: -5, lod: 3, dist: 50, members: 8, farDist: 120 }
    ];
    it('counts only meshes on screen at their level: a mesh waiting for its upload is not drawn', () => {
        const drawn = new Map([[1, 0], [2, 1], [-5, 3]]);
        const pending = new Set([-5]);
        const s = drawnShare(plan, (k) => (pending.has(k) ? undefined : drawn.get(k)));
        expect(s.total).toBe(10);
        expect(s.drawn).toBe(2);
        expect(s.share).toBeLessThan(100);
        expect(s.share).toBe(20);
        expect(s.drawnFarM).toBe(10);
        expect(s.farM).toBe(120);
        const all = drawnShare(plan, (k) => drawn.get(k));
        expect(all.share).toBe(100);
        expect(all.drawnFarM).toBe(120);
        expect(all.perLevel).toEqual([1, 1, 0, 8]);
        expect(all.meshesPerLevel).toEqual([1, 1, 0, 1]);
    });
    it('a mesh drawn at another level than planned is not counted', () => {
        expect(drawnShare(plan, (k) => (k === -5 ? 2 : k === 1 ? 0 : 1)).drawn).toBe(2);
    });
});

describe('voxel view: time left while the whole scene fills', () => {
    it('follows the pace of the last 2 s, not the slow start', () => {
        // slow near chunks: 2 % in 8 s, then 5 % in the last 2 s -> 93 % left at 5 % per 2 s
        expect(fillLeftS([{ t: 0, share: 0 }, { t: 8000, share: 2 }, { t: 9000, share: 4 }], 10000, 7)).toBe(37);
        // a fill younger than 2 s reads from its start
        expect(fillLeftS([{ t: 0, share: 0 }, { t: 1000, share: 20 }], 1500, 40)).toBe(2);
    });
    it('falls back to the pace since the start when the last 2 s brought nothing', () => {
        expect(fillLeftS([{ t: 0, share: 0 }, { t: 5000, share: 50 }, { t: 7000, share: 50 }], 9000, 50)).toBe(9);
    });
    it('says nothing with no pace or when full', () => {
        expect(fillLeftS([{ t: 0, share: 0 }], 5000, 0)).toBeNull();
        expect(fillLeftS([{ t: 0, share: 0 }], 5000, 100)).toBeNull();
        expect(fillLeftS([{ t: 0, share: 0 }], 0, 50)).toBeNull();
        expect(fillLeftS([], 5000, 50)).toBeNull();
    });
    it('keeps the first reading and the last 2 s', () => {
        const s = [0, 1000, 3000, 6000, 7000, 8000, 9000].map((t) => ({ t, share: t / 100 }));
        trimFillSamples(s, 9000);
        expect(s.map((x) => x.t)).toEqual([0, 7000, 8000, 9000]);
    });
});
