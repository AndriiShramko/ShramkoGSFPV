// The voxel view's frame rate keeper (lane voxview, V3): slow frames halve the near budgets' share
// down to a floor, fast frames give it back only after several looks in a row. Pure numbers.
import { describe, expect, it } from 'vitest';
import { keeperStep, KEEPER_MIN, KEEPER_FAST_TURNS, KEEPER_SLOW_MS, KEEPER_FAST_MS } from '../../../apps/fly/src/voxel-keeper';

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
