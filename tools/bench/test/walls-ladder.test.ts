// Walls lane W1: a wall build never refuses a catalogue scan. planBase picks the finest level of
// detail that fits this device and keeps the coarser ones for when it runs out of room anyway;
// bakeBase walks that ladder. Level counts are the ones walls-scan-sizes.ts read from the CDN on
// 2026-11-13 (Wroclaw 70b50d42, Lublin 2f1ddf5f, Forest Floor ab5efa0e). No network, no GPU.
import { describe, expect, it } from 'vitest';
import { BASE_VOXEL_M, BakeGpuError, BakeRefusedError, bakeBase, gaussiansFromMeta, isRough, memCapGb, outOfRoom, planBase } from '../../../apps/fly/src/bake';
import type { BakeResult, GpuLimits, SceneSize } from '../../../apps/fly/src/bake';
import * as bakeModule from '../../../apps/fly/src/bake';

describe('the octree limits make the cell coarser', () => {
    // all three limit messages of splat-transform 3.6.4 move a base bake from 5 to 10 to 20 cm on the same data
    const tooMany = (e: unknown): boolean => (bakeModule as { tooManyBlocks?: (e: unknown) => boolean }).tooManyBlocks?.(e) ?? false;
    it('recognises every limit message', () => {
        expect(tooMany(new Error('Voxel output has more than 16777216 mixed blocks'))).toBe(true);
        expect(tooMany(new Error('Sparse octree mixed-leaf count (17000000) exceeds the limit'))).toBe(true);
        expect(tooMany(new Error('Sparse octree node count (17384514) exceeds the Laine-Karras 24-bit baseOffset limit'))).toBe(true);
        expect(tooMany('Sparse octree node count (17384514) exceeds')).toBe(true);
    });
    it('leaves other failures alone', () => {
        expect(tooMany(new Error('lod-meta.json: 404'))).toBe(false);
        expect(tooMany(null)).toBe(false);
    });
});

const PC: GpuLimits = { maxBufferSize: 2 ** 31, maxStorageBufferBindingSize: 2 ** 31 };
const IGPU: GpuLimits = { maxBufferSize: 2 ** 30, maxStorageBufferBindingSize: 2 ** 30 };
const WROCLAW = [43_090_000, 21_550_000, 10_770_000, 5_390_000, 2_690_000, 1_350_000, 670_000, 340_000, 170_000, 80_000];
const LUBLIN = [258_950_000, 129_480_000, 64_740_000, 32_370_000, 16_180_000, 8_090_000, 4_050_000];
const lod = (byLevel: number[]): SceneSize => ({ kind: 'lod-meta', gaussians: byLevel[0], lodLevels: byLevel.length, from: 'tree', etag: null, byLevel });

describe('planBase: the ladder of a base bake', () => {
    it('Wroclaw on this PC starts at the first level that fits, never empty', () => {
        const steps = planBase(lod(WROCLAW), { limits: PC, capGb: memCapGb(8) });
        expect(steps[0].level).toBe(2);
        expect(steps.map((s) => s.level)).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
        expect(steps.every((s) => s.voxelM === BASE_VOXEL_M)).toBe(true);
    });
    it('a 3 GB tab still needs level 2 for Wroclaw, a 259 M scan goes to level 5', () => {
        expect(planBase(lod(WROCLAW), { limits: PC, capGb: 3 })[0].level).toBe(2);
        expect(planBase(lod(LUBLIN), { limits: IGPU, capGb: memCapGb(8) })[0].level).toBe(5);
    });
    it('a scan that fits takes full detail', () => {
        const s = planBase({ kind: 'meta', gaussians: 4_019_918, lodLevels: 1, from: 'count', etag: null }, { limits: PC, capGb: 2 });
        expect(s).toEqual([{ level: 0, voxelM: BASE_VOXEL_M, gaussians: 4_019_918 }]);
    });
    it('a single file past the estimate is still tried, not refused', () => {
        const s = planBase({ kind: 'meta', gaussians: 60_000_000, lodLevels: 1, from: 'count', etag: null }, { limits: IGPU, capGb: 2 });
        expect(s.length).toBe(1);
        expect(s[0].level).toBe(0);
    });
    it('the level counts come from the tree', () => {
        const tree = { children: [{ lods: { 0: { count: 8 }, 1: { count: 4 }, 2: { count: 2 } } }, { lods: { 0: { count: 8 }, 1: { count: 4 }, 2: { count: 2 } } }] };
        expect(gaussiansFromMeta({ lodLevels: 3, tree }, 'lod-meta').byLevel).toEqual([16, 8, 4]);
    });
    it('rough means a lower level or a coarser cell', () => {
        expect(isRough({ level: 0, voxelM: BASE_VOXEL_M })).toBe(false);
        expect(isRough({ level: 2, voxelM: BASE_VOXEL_M })).toBe(true);
        expect(isRough({ level: 0, voxelM: 0.1 })).toBe(true);
    });
});

describe('bakeBase: out of room takes the next step by itself', () => {
    const fake = (fails: number, err: () => unknown) => {
        const levels: number[] = [];
        const bake = async (_u: string, _k: 'meta' | 'lod-meta', _d: unknown, _s: unknown, o: { level?: number; voxelM?: number } = {}): Promise<BakeResult> => {
            levels.push(o.level ?? 0);
            if (levels.length <= fails) throw err();
            return { json: new Uint8Array(1), bin: new Uint8Array(1), gaussians: 1, solidVoxels: 1, voxelM: o.voxelM ?? BASE_VOXEL_M, level: o.level ?? 0, ms: { read: 0, voxelize: 0, total: 0 }, peakJsHeapMb: null };
        };
        return { levels, bake: bake as never };
    };
    it('two GPU out-of-memory errors: the third level builds', async () => {
        const f = fake(2, () => new BakeGpuError('GPU out-of-memory error: x'));
        const stages: string[] = [];
        const r = await bakeBase('u/lod-meta.json', 'lod-meta', null as never, (s) => stages.push(s), { size: lod(WROCLAW), limits: PC, capGb: 2, bake: f.bake });
        expect(f.levels).toEqual([2, 3, 4]);
        expect(r.level).toBe(4);
        expect(r.tried).toBe(3);
        expect(stages.filter((s) => s === 'lighter').length).toBe(2);
    });
    it('a failure that is not about room ends the ladder', async () => {
        const f = fake(5, () => new BakeRefusedError('no-webgpu', null));
        await expect(bakeBase('u', 'lod-meta', null as never, () => undefined, { size: lod(WROCLAW), limits: PC, capGb: 2, bake: f.bake })).rejects.toThrow(/no-webgpu/);
        expect(f.levels.length).toBe(1);
    });
    it('what counts as out of room', () => {
        expect(outOfRoom(new RangeError('Array buffer allocation failed'))).toBe(true);
        expect(outOfRoom(new BakeRefusedError('memory', null))).toBe(true);
        expect(outOfRoom(new Error('Sparse octree mixed-leaf count (17000000) exceeds'))).toBe(true);
        // the third limit message of splat-transform 3.6.4 (seen offline on 0230d903 at 5 cm)
        expect(outOfRoom(new Error('Sparse octree node count (17384514) exceeds the Laine-Karras 24-bit baseOffset limit'))).toBe(true);
        expect(outOfRoom(new BakeRefusedError('empty', null))).toBe(false);
        expect(outOfRoom(new Error('lod-meta.json: 404'))).toBe(false);
    });
});
