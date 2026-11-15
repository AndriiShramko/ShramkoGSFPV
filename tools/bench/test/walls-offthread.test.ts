// Stage F1-no-freeze (lane course3): the walls build runs in a worker (apps/fly/src/bake-worker.ts) and a build never
// hangs: a ladder step that runs past its limit is stopped (its signal aborts, which terminates the worker) and the next,
// lighter step is taken. Errors cross the worker boundary as plain data and come back as the same classes, so the
// ladder's "out of room, go lighter" rule still reads them. No network, no GPU, fake timers only.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BakeRefusedError, bakeBase, outOfRoom } from '../../../apps/fly/src/bake';
import type { BakeResult, GpuLimits, SceneSize } from '../../../apps/fly/src/bake';
import * as bakeModule from '../../../apps/fly/src/bake';

const m = bakeModule as unknown as Record<string, unknown>;
const PC: GpuLimits = { maxBufferSize: 4294967292, maxStorageBufferBindingSize: 4294967292 };
// Wroclaw 70b50d42's levels as walls-ladder.test.ts reads them (lod-meta counts, 2026-11-13)
const WROCLAW: SceneSize = { gaussians: 21_470_000, lodLevels: 4, byLevel: [21_470_000, 15_400_000, 10_720_000, 5_390_000], etag: null } as unknown as SceneSize;
const ok = (gaussians: number): BakeResult => ({ json: new Uint8Array(1), bin: new Uint8Array(1), gaussians, kept: gaussians, solidVoxels: 1, voxelM: 0.05, level: 0, ms: { read: 0, voxelize: 0, total: 0 }, peakJsHeapMb: null } as unknown as BakeResult);

afterEach(() => { vi.useRealTimers(); });

describe('a build step past its limit gives way to the next, lighter step', () => {
    it('stops the hung step (its signal aborts) and returns the next step\'s walls', async () => {
        vi.useFakeTimers();
        const signals: (AbortSignal | undefined)[] = [];
        const bake = (_u: string, _k: string, _d: unknown, _s: unknown, o: { signal?: AbortSignal; level?: number }): Promise<BakeResult> => {
            signals.push(o.signal);
            // the first step never ends (the build that did not resolve in 420 s); the second ends at once
            return signals.length === 1 ? new Promise<BakeResult>(() => undefined) : Promise.resolve(ok(5_390_000));
        };
        let state = 'pending';
        let result: (BakeResult & { tried: number }) | null = null;
        void bakeBase('u/lod-meta.json', 'lod-meta', null as never, () => undefined, { size: WROCLAW, limits: PC, capGb: 2, bake: bake as never, stepTimeout: () => 1000 } as never)
            .then((r) => { state = 'done'; result = r; }, (e) => { state = `failed: ${String(e)}`; });
        await vi.advanceTimersByTimeAsync(1001);
        expect(state).toBe('done');
        expect(result!.tried).toBe(2);
        expect(signals.length).toBe(2);
        expect(signals[0]?.aborted).toBe(true);
    });

    it('a step that ends in time is not stopped', async () => {
        vi.useFakeTimers();
        const signals: (AbortSignal | undefined)[] = [];
        const bake = (_u: string, _k: string, _d: unknown, _s: unknown, o: { signal?: AbortSignal }): Promise<BakeResult> => {
            signals.push(o.signal);
            return new Promise((res) => setTimeout(() => res(ok(10_720_000)), 500));
        };
        const p = bakeBase('u/lod-meta.json', 'lod-meta', null as never, () => undefined, { size: WROCLAW, limits: PC, capGb: 2, bake: bake as never, stepTimeout: () => 1000 } as never);
        await vi.advanceTimersByTimeAsync(5000);
        const r = await p;
        expect(r.tried).toBe(1);
        expect(signals[0]?.aborted).toBe(false);
    });

    it('the limit is three times the step estimate, at least 180 s', () => {
        expect(typeof m.stepTimeoutMs).toBe('function');
        const limit = m.stepTimeoutMs as (s: { gaussians: number; level: number; voxelM: number }, spm: number) => number;
        // Wroclaw level 2 at 9.5 s per million: 102 s estimated -> 305 s
        expect(limit({ gaussians: 10_720_000, level: 2, voxelM: 0.05 }, 9.5)).toBeCloseTo(3 * 10.72 * 9.5 * 1000, 0);
        // a small scan: never under 180 s (a loaded machine reads slower)
        expect(limit({ gaussians: 300_000, level: 0, voxelM: 0.05 }, 9.5)).toBe(180_000);
    });
});

describe('the request to the worker carries data only', () => {
    it('bakeBase\'s option bag (with its functions) becomes a request a worker message can carry', async () => {
        const off = await import('../../../apps/fly/src/bake-off-thread') as unknown as Record<string, unknown>;
        // the first browser run failed here: "Failed to execute 'postMessage' on 'Worker': function ... could not be cloned"
        expect(typeof off.workerRequest).toBe('function');
        const make = off.workerRequest as (u: string, k: string, o: unknown, href: string, l: unknown, c: number) => { contentUrl: string; o: Record<string, unknown> };
        const bag = { size: WROCLAW, limits: undefined, capGb: 2, level: 2, voxelM: 0.05, coarsenOnOctree: true, sPerMillion: 9.5, bake: () => 0, onStep: () => 0, stepTimeout: () => 1, signal: new AbortController().signal };
        const req = make('/scenes/70b50d42/lod-meta.json', 'lod-meta', bag, 'http://localhost:5724/en/fly/', PC, 2);
        expect(() => structuredClone(req)).not.toThrow();
        expect(req.contentUrl).toBe('http://localhost:5724/scenes/70b50d42/lod-meta.json');
        expect(req.o.level).toBe(2);
        expect(req.o.limits).toEqual(PC);
    });
});

describe('errors from the worker come back as their classes', () => {
    it('a refusal keeps its reason, a timeout its class, out of room its words', () => {
        expect(typeof m.bakeErrorToWire).toBe('function');
        const to = m.bakeErrorToWire as (e: unknown) => unknown;
        const from = m.bakeErrorFromWire as (w: unknown) => Error;
        const trip = (e: unknown): Error => from(structuredClone(to(e)));
        const refused = trip(new BakeRefusedError('memory', WROCLAW, 7_000_000));
        expect(refused).toBeInstanceOf(BakeRefusedError);
        expect((refused as BakeRefusedError).reason).toBe('memory');
        expect((refused as BakeRefusedError).maxGaussians).toBe(7_000_000);
        const TimeoutClass = m.BakeTimeoutError as new (s: string) => Error;
        expect(trip(new TimeoutClass('step 1 of 3 ran past 305 s'))).toBeInstanceOf(TimeoutClass);
        const room = trip(new Error('Failed to allocate buffer: out of memory'));
        expect(outOfRoom(room)).toBe(true);
        expect(trip('plain text failure').message).toBe('plain text failure');
    });
});
