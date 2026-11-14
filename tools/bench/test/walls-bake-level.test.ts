import { describe, expect, it } from 'vitest';

// The offline bake picks the LOD level whose Gaussians fit the voxeliser's one GPU buffer
// (Wroclaw 70b50d42 level 0 failed at 5 cm and at 10 cm on that buffer, not on the cell size).
const mod: Record<string, unknown> = await import(new URL('../../walls/bake-published.mjs', import.meta.url).href);
type Fit = (counts: (number | null)[], start?: number, kept?: number, max?: number) => number;
type IsBuf = (text: string) => boolean;

// gaussiansByLevel of 70b50d42 from tools/bench/scripts/walls-scan-sizes.ts (sizes.json)
const WROCLAW = [43090329, 21545169, 10772588, 5386297, 2693152, 1346579, 673294, 336650, 168328, 84168];

describe('levelThatFits', () => {
    it('is exported by the bake tool', () => {
        expect(typeof mod.levelThatFits).toBe('function');
        expect(typeof mod.isGaussianBufferError).toBe('function');
    });

    it('steps Wroclaw down to level 1 (level 0 kept 97.9 % = 2699252224 bytes, over 2147483648)', () => {
        const fit = mod.levelThatFits as Fit;
        expect(fit(WROCLAW, 0, 0.979)).toBe(1);
        expect(Math.round(WROCLAW[0] * 0.979) * 64).toBeGreaterThan(2147483648);
    });

    it('keeps level 0 when it fits and never goes finer than asked', () => {
        const fit = mod.levelThatFits as Fit;
        expect(fit([11748234, 5874117], 0, 0.9848)).toBe(0);
        expect(fit(WROCLAW, 3, 1)).toBe(3);
    });

    it('gives the coarsest level when nothing fits, and trusts a level with no count', () => {
        const fit = mod.levelThatFits as Fit;
        expect(fit([9e9, 8e9, 7e9], 0, 1)).toBe(2);
        expect(fit([9e9, null, 1], 0, 1)).toBe(1);
    });

    it('tells the Gaussian buffer error from an octree error', () => {
        const isBuf = mod.isGaussianBufferError as IsBuf;
        expect(isBuf('Buffer size (2699252224) exceeds the max buffer size limit (2147483648).')).toBe(true);
        expect(isBuf('octree block count exceeded')).toBe(false);
    });
});
