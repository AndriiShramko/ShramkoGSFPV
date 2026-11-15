// Walls built in the browser (apps/fly/src/bake.ts, wallcache.ts), the parts that run without a GPU:
// the size gate reads what a bake will voxelise, the hard gates refuse before any GPU work, an empty
// octree is never "walls", the refine plan of voxel-plan sec. 4, and the walls store (keys, sha256
// checks, stale keys, eviction, zip export / import). Fixture 39e63ce9 only, no network.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateRawSync, gunzipSync } from 'node:zlib';
import { countSolidVoxelsFromBytes } from '@gsfpv/collision';
import {
    AUTO_MAX_S, BakeRefusedError, REFINE_FALLBACK_VOXEL_M, REFINE_VOXEL_M, assertWalls, checkBake, finestVoxel, gaussiansFromMeta, maxGaussians,
    memCapGb, planRefine, predictNodes, sceneSize
} from '../../../apps/fly/src/bake';
import type { GpuLimits, SceneSize } from '../../../apps/fly/src/bake';
import * as wallcache from '../../../apps/fly/src/wallcache';
import { MemKv, WallCache, crc32, gunzip, gzip, keyText, unzip, wallsKey, wallsSha, zipStore } from '../../../apps/fly/src/wallcache';
import type { WallsKeyInput } from '../../../apps/fly/src/wallcache';
const flyLocale = (l: string): Record<string, string> => JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'packages', 'i18n', 'locales', 'fly', `${l}.json`), 'utf8')) as Record<string, string>;
const [en, es, pl, ru] = ['en', 'es', 'pl', 'ru'].map(flyLocale);

// lane fix3a: walls built here are kept, also when the size request failed before the build, and the walls
// line can say when they are not (keepBuilt). On origin/main the helper does not exist: the first check fails.
describe('walls built here are kept, or the line says they are not (fix3a)', () => {
    const keep = (wallcache as Record<string, unknown>).keepBuilt as typeof wallcache.keepBuilt;
    const kv = () => new WallCache(new MemKv(), 'memory');
    const json = new TextEncoder().encode('{"walls":1}');
    const bin = new Uint8Array(4096).fill(7);
    let clock = 0;
    const now = () => (clock += 5);

    it('the key made before the build is used; the row is in the store when the promise resolves', async () => {
        expect(typeof keep).toBe('function');
        const c = kv();
        let made = 0;
        const r = await keep({ input: input(), makeInput: async () => { made++; return null; }, put: (i) => c.put(i, json, bin), now });
        expect(r.ok).toBe(true);
        expect(made).toBe(0);
        expect(r.key).toBe(await wallsKey(input()));
        expect(r.bytes).toBeGreaterThan(0);
        expect(r.ms).toBeGreaterThan(0);
        expect(await c.get(r.key!)).not.toBeNull();
    });

    it('no key before the build (the size request failed): it is made again and the walls are kept', async () => {
        expect(typeof keep).toBe('function');
        const c = kv();
        const r = await keep({ input: null, makeInput: async () => input({ etag: null }), put: (i) => c.put(i, json, bin), now });
        expect(r.ok).toBe(true);
        expect(await c.get(await wallsKey(input({ etag: null })))).not.toBeNull();
    });

    it('no key at all, or a store that throws: ok false with the reason, never a silent loss', async () => {
        expect(typeof keep).toBe('function');
        const c = kv();
        const none = await keep({ input: null, makeInput: async () => { throw new Error('scene metadata 503'); }, put: (i) => c.put(i, json, bin), now });
        expect(none).toMatchObject({ ok: false, key: null, error: 'no-key' });
        expect(await c.rows()).toHaveLength(0);
        const full = await keep({ input: input(), makeInput: async () => null, put: async () => { throw new Error('QuotaExceededError'); }, now });
        expect(full.ok).toBe(false);
        expect(full.error).toContain('QuotaExceededError');
        expect(full.key).toBe(await wallsKey(input()));
    });

    it('the walls line has the kept and not-kept words in en, es, pl, ru', () => {
        for (const l of [en, es, pl, ru] as Array<Record<string, string>>) {
            expect(l['bake.notKept']?.length).toBeGreaterThan(20);
            expect(l['bake.keeping']?.length).toBeGreaterThan(10);
        }
        expect(new Set([en, es, pl, ru].map((l) => (l as Record<string, string>)['bake.notKept'])).size).toBe(4);
    });
});

// Review FX-1 to FX-3 of lane fix3a: built walls go in use only after their store write (FX-1), a page-memory store is
// not "kept" (FX-2), and a failed write is never silent whatever line the box shows (FX-3). The helpers do not exist on
// the code before the review: the type checks fail first.
describe('walls are in use only once kept; a lost keep is always said (fix3a review)', () => {
    const lib = wallcache as Record<string, unknown>;
    const keep = lib.keepBuilt as typeof wallcache.keepBuilt;
    const json = new TextEncoder().encode('{"walls":1}');
    const bin = new Uint8Array(1024).fill(3);
    const now = () => 1;
    const ok = { ok: true, key: 'k', ms: 1, bytes: 1 };
    const failed = { ok: false, key: 'k', ms: 1, bytes: 0, error: 'QuotaExceededError' };

    it('FX-1: use() runs after the write ended, not before; a write that hangs lets the walls in after the wait', async () => {
        const then = lib.keepThenUse as typeof wallcache.keepThenUse;
        expect(typeof then).toBe('function');
        const order: string[] = [];
        let end: (r: typeof ok) => void = () => {};
        const kept = new Promise<typeof ok>((r) => (end = r)).then((r) => (order.push('kept'), r));
        let wake: () => void = () => {};
        const p = then(kept, () => order.push('use'), 5000, () => new Promise<void>((r) => (wake = r)));
        await Promise.resolve();
        expect(order).toEqual([]);
        end(ok);
        expect(await p).toEqual(ok);
        expect(order).toEqual(['kept', 'use']);
        const hung = then(new Promise(() => {}), () => order.push('use-late'), 5000, () => new Promise<void>((r) => (wake = r)));
        await Promise.resolve();
        expect(order).not.toContain('use-late');
        wake();
        expect(await hung).toBeNull();
        expect(order).toContain('use-late');
    });

    it('FX-1: in walls.ts every built walls queue() waits for keepThenUse (base and refine)', () => {
        const src = readFileSync(join(__dirname, '../../../apps/fly/src/walls.ts'), 'utf8');
        const at = [...src.matchAll(/queue\(r\.json/g)].map((m) => m.index!);
        expect(at.length).toBe(2);
        for (const i of at) expect(src.slice(Math.max(0, i - 400), i)).toContain('await keepThenUse(kept');
    });

    it('FX-2: walls that went only into the page memory store are not kept', async () => {
        expect(typeof keep).toBe('function');
        const c = new WallCache(new MemKv(), 'memory');
        const r = await keep({ input: input(), makeInput: async () => null, put: async (i) => ({ ...(await c.put(i, json, bin)), memory: true }), now });
        expect(r).toMatchObject({ ok: false, error: 'memory' });
    });

    it('FX-3: a failed keep is said on the done line, after another line, or alone; a kept one leaves the box', () => {
        const line = lib.keptLine as typeof wallcache.keptLine;
        expect(typeof line).toBe('function');
        const done = 'Walls built.';
        const keeping = `${done} Keeping`;
        expect(line(done, done, keeping, failed, 'NOT')).toBe(`${done} NOT`);
        expect(line(keeping, done, keeping, failed, 'NOT')).toBe(`${done} NOT`);
        expect(line('Finer walls are in.', done, keeping, failed, 'NOT')).toBe('Finer walls are in. NOT');
        expect(line('', done, keeping, failed, 'NOT')).toBe('NOT');
        expect(line(keeping, done, keeping, ok, 'NOT')).toBe(done);
        expect(line('Other', done, keeping, ok, 'NOT')).toBeNull();
        expect(line(done, done, keeping, { ...failed, error: 'off' }, 'NOT')).toBeNull();
    });
});

const FIX = join(__dirname, '..', '..', '..', 'fixtures', '39e63ce9');
const lodMeta = JSON.parse(readFileSync(join(FIX, 'lod-meta.json'), 'utf8'));
const json = new Uint8Array(readFileSync(join(FIX, 'scene.voxel.json')));
const binRaw = new Uint8Array(readFileSync(join(FIX, 'scene.voxel.bin')));
const bin = binRaw[0] === 0x1f && binRaw[1] === 0x8b ? new Uint8Array(gunzipSync(binRaw)) : binRaw;

/** Dawn on the RTX 4090 (voxel-plan sec. 3): both limits 2 GiB. */
const RTX4090: GpuLimits = { maxBufferSize: 2 ** 31, maxStorageBufferBindingSize: 2 ** 31 };
const size = (gaussians: number): SceneSize => ({ kind: 'lod-meta', gaussians, lodLevels: 4, from: 'tree', etag: null });
/** The showcase scenes, LOD-0 sums of their trees and their shipped walls. */
const MODLINEK = { n: 3_803_289, shipped: { voxelM: 0.05, nodes: 46_796 } };
const WINTER_GARDEN = { n: 15_400_551, shipped: { voxelM: 0.032, nodes: 2_070_758 } };
const TUNIS = { n: 43_031_431, shipped: { voxelM: 0.05, nodes: 4_139_739 } };
const S9D09 = { n: 14_960_000, shipped: { voxelM: 0.05, nodes: 106_975 } };

function emptyOctree(nodes: number[] = [], leaves: number[] = []): { json: Uint8Array; bin: Uint8Array } {
    const m = { version: '1.1', gridBounds: { min: [0, 0, 0], max: [0.8, 0.8, 0.8] }, sceneBounds: { min: [0, 0, 0], max: [0.8, 0.8, 0.8] }, voxelResolution: 0.05, leafSize: 4, treeDepth: 2, numInteriorNodes: 0, numMixedLeaves: 0, nodeCount: nodes.length, leafDataCount: leaves.length };
    return { json: new TextEncoder().encode(JSON.stringify(m)), bin: new Uint8Array(new Uint32Array([...nodes, ...leaves]).buffer) };
}

describe('B-2: the size gate reads the Gaussians a bake voxelises', () => {
    it('SuperSplat lod-meta.json has neither counts nor count: N comes from the tree (control: the old rule reads 0)', () => {
        expect('counts' in lodMeta || 'count' in lodMeta).toBe(false);
        const s = gaussiansFromMeta(lodMeta, 'lod-meta');
        expect(s.gaussians).toBe(3_803_289); // = the plan's sum and the bake's table.numRows
        expect(s.from).toBe('tree');
        const shippedRule = (m: { counts?: number[]; count?: number }) => m.counts?.[0] ?? m.count ?? 0;
        expect(shippedRule(lodMeta)).toBe(0); // negative control: the guard of bake.ts before this fix
    });

    it('control: a file with counts gives the same N; the tree wins when both are there', () => {
        const withCounts = { lodLevels: 4, counts: [3_803_289, 2_000_000, 1_000_000, 500_000] };
        expect(gaussiansFromMeta(withCounts, 'lod-meta')).toMatchObject({ gaussians: 3_803_289, from: 'counts' });
        expect(gaussiansFromMeta({ ...lodMeta, counts: [1] }, 'lod-meta')).toMatchObject({ gaussians: 3_803_289, from: 'tree' });
        expect(gaussiansFromMeta({ count: 2_144_439 }, 'meta')).toMatchObject({ gaussians: 2_144_439, from: 'count' });
        expect(gaussiansFromMeta({}, 'lod-meta')).toMatchObject({ gaussians: 0, from: 'none' });
    });

    it('sceneSize keeps the ETag for the walls key', async () => {
        const f = async () => new Response(JSON.stringify(lodMeta), { headers: { etag: '"abc"' } });
        expect(await sceneSize('https://cdn/x/v1/lod-meta.json', 'lod-meta', f)).toMatchObject({ gaussians: 3_803_289, etag: '"abc"' });
    });

    it('an unknown size is refused, not baked blind', () => {
        expect(() => checkBake(size(0), 0.05, { limits: RTX4090, capGb: 3 })).toThrow(BakeRefusedError);
    });
});

describe('B-3: hard gates before any GPU work; an empty octree is never walls', () => {
    it('limits faked below N x 64 B refuse the bake (control: the real limits let 39e63ce9 through)', () => {
        const low: GpuLimits = { maxBufferSize: MODLINEK.n * 64 - 1, maxStorageBufferBindingSize: 2 ** 31 };
        const e = (() => { try { checkBake(size(MODLINEK.n), 0.016, { limits: low, capGb: 3 }); return null; } catch (x) { return x as BakeRefusedError; } })();
        expect(e).toBeInstanceOf(BakeRefusedError);
        expect(e!.reason).toBe('gpu-buffer');
        expect(e!.maxGaussians).toBe(MODLINEK.n - 1);
        expect(() => checkBake(size(MODLINEK.n), 0.016, { limits: RTX4090, capGb: 2, shipped: MODLINEK.shipped })).not.toThrow();
    });

    it('Tunis (43 M) needs a 2.75 GB buffer above 2 GiB: refused before the library would write an empty octree', () => {
        expect(() => checkBake(size(TUNIS.n), 0.05, { limits: RTX4090, capGb: 3 })).toThrow(/gpu-buffer/);
        expect(maxGaussians(RTX4090, 3)).toBe(Math.floor((3 / 0.17) * 1e6));
        expect(maxGaussians(RTX4090, 100)).toBe(2 ** 31 / 64); // 33.5 M
    });

    it('memory budget: min(3 GB, deviceMemory / 4); Chrome caps deviceMemory at 8', () => {
        expect(memCapGb(8)).toBe(2);
        expect(memCapGb(4)).toBe(1);
        expect(memCapGb(64)).toBe(3);
        expect(() => checkBake(size(WINTER_GARDEN.n), 0.016, { limits: RTX4090, capGb: 2 })).toThrow(/memory/);
        expect(() => checkBake(size(WINTER_GARDEN.n), 0.016, { limits: RTX4090, capGb: 3 })).not.toThrow();
        expect(() => checkBake(size(3_000_000), 0.05, { limits: RTX4090, capGb: 2, webgpu: false })).toThrow(/no-webgpu/);
    });

    it('a planted empty octree is refused: no nodes, or nodes whose leaves hold no voxel (control: the shipped walls)', () => {
        const none = emptyOctree();
        expect(() => assertWalls(none.json, none.bin)).toThrow(BakeRefusedError);
        try { assertWalls(none.json, none.bin); } catch (e) { expect((e as BakeRefusedError).reason).toBe('empty'); }
        // one interior node with one child: a mixed leaf whose 64-bit mask is all zero
        const hollow = emptyOctree([(0x01 << 24) | 1, 0], [0, 0]);
        expect(countSolidVoxelsFromBytes(hollow.json, hollow.bin)).toBe(0);
        expect(() => assertWalls(hollow.json, hollow.bin)).toThrow(/empty/);
        expect(() => assertWalls(new TextEncoder().encode('not json'), new Uint8Array(0))).toThrow(/empty/);
        expect(assertWalls(json, bin)).toBe(countSolidVoxelsFromBytes(json, bin));
        expect(assertWalls(json, bin)).toBeGreaterThan(1_000_000); // 1.17 M voxels at 5 cm
    });
});

describe('refine plan (voxel-plan sec. 4)', () => {
    it('octree prediction matches the measured bakes within 10 %', () => {
        expect(predictNodes(MODLINEK.shipped, 0.016) / 690_000).toBeCloseTo(1, 1); // measured 0.69 M
        expect(predictNodes(WINTER_GARDEN.shipped, 0.016) / 10_850_000).toBeCloseTo(1, 1); // measured 10.85 M
        expect(finestVoxel(WINTER_GARDEN.shipped)).toBeCloseTo(0.013, 3); // measured: 1.6 cm works, 1.2 cm fails
        expect(finestVoxel(MODLINEK.shipped)).toBeCloseTo(0.004, 3);
    });

    const plan = (sc: { n: number; shipped: { voxelM: number; nodes: number } }, capGb = 3, sPerMillion = 4, visibleMs = 2000) =>
        planRefine({ shipped: sc.shipped, size: size(sc.n), limits: RTX4090, capGb, webgpu: true, sPerMillion, visibleMs });

    it('the showcase scenes get the plan table: Modlinek auto, Winter Garden and 9d09ab82 offer, Tunis refused', () => {
        expect(plan(MODLINEK)).toMatchObject({ action: 'auto', voxelM: REFINE_VOXEL_M });
        expect(plan(MODLINEK).estimateS).toBeLessThanOrEqual(AUTO_MAX_S);
        expect(plan(WINTER_GARDEN)).toMatchObject({ action: 'offer', voxelM: REFINE_VOXEL_M }); // 3.2 cm: never by itself
        expect(plan(S9D09)).toMatchObject({ action: 'offer', voxelM: REFINE_VOXEL_M }); // ~60 s
        // Tunis fails twice: the octree (finest whole-scene voxel 2.74 cm) and the 2.75 GB GPU buffer
        expect(plan(TUNIS)).toMatchObject({ action: 'refused', reason: 'octree' });
        expect(finestVoxel(TUNIS.shipped)).toBeCloseTo(0.0274, 3);
        expect(plan(WINTER_GARDEN, 2)).toMatchObject({ action: 'refused', reason: 'memory' }); // a PC that reports 8 GB
    });

    it('nothing below 2 cm; 2 cm when 1.6 cm would overflow the octree; the time bands', () => {
        expect(plan({ n: MODLINEK.n, shipped: { voxelM: 0.02, nodes: 400_000 } })).toMatchObject({ action: 'none', voxelM: null });
        expect(plan({ n: MODLINEK.n, shipped: { voxelM: 0.05, nodes: 900_000 } })).toMatchObject({ voxelM: REFINE_FALLBACK_VOXEL_M });
        expect(plan({ n: MODLINEK.n, shipped: { voxelM: 0.05, nodes: 3_000_000 } })).toMatchObject({ action: 'refused', reason: 'octree' });
        expect(plan(MODLINEK, 3, 20).action).toBe('offer'); // 76 s
        expect(plan(MODLINEK, 3, 100).action).toBe('offer-long'); // 380 s
        expect(plan(MODLINEK, 3, 200)).toMatchObject({ action: 'refused', reason: 'time' }); // 760 s
        expect(plan(MODLINEK, 3, 20, 60_000).action).toBe('auto'); // a slow load: up to 1.5x its time
    });
});

const input = (over: Partial<WallsKeyInput> = {}): WallsKeyInput => ({ sceneId: '39e63ce9', version: 1, etag: '"cc4c4df96435377134ded250719d2699"', base: 'a'.repeat(64), voxelM: 0.016, ...over });

describe('walls store: keys and checks', () => {
    it('the key is made of everything the bytes depend on, in a fixed order', async () => {
        const k = await wallsKey(input());
        expect(k).toMatch(/^[0-9a-f]{64}$/);
        expect(await wallsKey(input())).toBe(k);
        expect(keyText(input())).toContain('splat-transform@3.6.4');
        for (const over of [{ etag: '"new"' }, { version: 2 }, { base: 'b'.repeat(64) }, { voxelM: 0.02 }, { sceneId: '7a475d38' }, { box: '-8,-4,-8,8,8,8' }]) {
            expect(await wallsKey(input(over))).not.toBe(k);
        }
    });

    it('a reload finds the walls with the same sha256 (no second bake); a new ETag misses and marks the old walls stale', async () => {
        const kv = new MemKv();
        let bakes = 0;
        const getOrBake = async (c: WallCache, i: WallsKeyInput) => {
            const hit = await c.get(await wallsKey(i));
            if (hit) return { sha: hit.row.sha256, from: 'cache' };
            bakes++;
            const row = await c.put(i, json, bin, { gaussians: MODLINEK.n, bakeMs: 13000 });
            return { sha: row.sha256, from: 'bake' };
        };
        const first = await getOrBake(new WallCache(kv, 'idb', async () => null), input());
        const reload = await getOrBake(new WallCache(kv, 'idb', async () => null), input());
        expect(first.from).toBe('bake');
        expect(reload).toEqual({ sha: first.sha, from: 'cache' });
        expect(first.sha).toBe(await wallsSha(json, bin));
        expect(bakes).toBe(1);
        // SuperSplat overwrote the scene in place: the ETag changed
        const c = new WallCache(kv, 'idb', async () => null);
        const moved = input({ etag: '"deadbeef"' });
        expect(await c.get(await wallsKey(moved))).toBeNull();
        expect(c.lastMiss).toBe('absent');
        expect(await c.markStale(moved, await wallsKey(moved))).toBe(1);
        expect((await c.rows())[0].stale).toBe(true);
    });

    it('stored bytes that no longer match their sha256 are deleted and missed', async () => {
        const kv = new MemKv();
        const c = new WallCache(kv, 'idb', async () => null);
        const row = await c.put(input(), json, bin);
        const data = kv.map.get(`walls:${row.key}`) as { json: Uint8Array; binGz: Blob };
        const raw = new Uint8Array(await gunzip(data.binGz));
        raw[1000] ^= 0xff;
        kv.map.set(`walls:${row.key}`, { json: data.json, binGz: new Blob([await gzip(raw) as Uint8Array<ArrayBuffer>]) });
        expect(await c.get(row.key)).toBeNull();
        expect(c.lastMiss).toBe('corrupt');
        expect(await c.rows()).toHaveLength(0);
    });

    it('evicts least recently used above the cap, stale ones first, never the walls just stored', async () => {
        const kv = new MemKv();
        const one = json.length + (await gzip(bin)).length;
        // quota so small that only two sets of walls fit (10 % of it)
        const c = new WallCache(kv, 'idb', async () => one * 25);
        const a = await c.put(input({ sceneId: 'aaaaaaaa' }), json, bin);
        const b = await c.put(input({ sceneId: 'bbbbbbbb' }), json, bin);
        await kv.put(`wallsmeta:${a.key}`, { ...(await kv.get(`wallsmeta:${a.key}`)) as object, lastUsedAt: 1 });
        await kv.put(`wallsmeta:${b.key}`, { ...(await kv.get(`wallsmeta:${b.key}`)) as object, lastUsedAt: 2, stale: true });
        const cNew = await c.put(input({ sceneId: 'cccccccc' }), json, bin);
        const left = (await c.rows()).map((r) => r.sceneId).sort();
        expect(left).toEqual(['aaaaaaaa', 'cccccccc']); // b was stale, so it went although a is older
        expect(left).toContain(cNew.sceneId);
    });
});

describe('walls store: carried to another PC as a zip', () => {
    async function exported() {
        const c = new WallCache(new MemKv(), 'idb', async () => null);
        const row = await c.put(input(), json, bin, { gaussians: MODLINEK.n, bakeMs: 12000 });
        const other = await c.put(input({ sceneId: '9d09ab82', base: 'c'.repeat(64) }), json, bin);
        return { zip: await c.exportZip(), row, other };
    }

    it('import on a clean profile finds the walls with the same sha256, no bake', async () => {
        const { zip, row } = await exported();
        const clean = new WallCache(new MemKv(), 'idb', async () => null);
        expect(await clean.get(row.key)).toBeNull(); // negative control: nothing there before the import
        const rep = await clean.importZip(zip);
        expect(rep.rejected).toEqual([]);
        expect(rep.imported.map((r) => r.sceneId).sort()).toEqual(['39e63ce9', '9d09ab82']);
        const hit = await clean.get(row.key);
        expect(hit?.row.sha256).toBe(row.sha256);
        expect(Buffer.compare(Buffer.from(hit!.bin), Buffer.from(bin))).toBe(0);
    });

    it('a corrupted .bin is rejected by its sha256, the other walls still come in', async () => {
        const { zip, row } = await exported();
        const files = await unzip(zip);
        const raw = await gunzip(files.get(`walls/${row.key}.voxel.bin.gz`)!);
        raw[5000] ^= 0x01; // one bit, then a valid gzip and a valid zip CRC around it
        files.set(`walls/${row.key}.voxel.bin.gz`, await gzip(raw));
        const bad = zipStore([...files].map(([name, data]) => ({ name, data })));
        const clean = new WallCache(new MemKv(), 'idb', async () => null);
        const rep = await clean.importZip(bad);
        expect(rep.rejected).toEqual([{ key: row.key, sceneId: '39e63ce9', reason: 'sha256' }]);
        expect(rep.imported.map((r) => r.sceneId)).toEqual(['9d09ab82']);
        expect(await clean.get(row.key)).toBeNull();
    });

    it('a damaged download fails loudly (CRC-32); an edited key or empty walls are rejected', async () => {
        const { zip, row } = await exported();
        const torn = zip.slice();
        torn[200] ^= 0xff; // inside index.json's bytes
        await expect(new WallCache(new MemKv()).importZip(torn)).rejects.toThrow(/CRC-32|index|JSON/);
        const files = await unzip(zip);
        const doc = JSON.parse(new TextDecoder().decode(files.get('walls/index.json')!));
        doc.walls[0].input.etag = '"forged"';
        const e = emptyOctree();
        const eInput = input({ sceneId: 'eeeeeeee' });
        const eKey = await wallsKey(eInput);
        doc.walls.push({ ...doc.walls[1], key: eKey, input: eInput, sceneId: 'eeeeeeee', sha256: await wallsSha(e.json, e.bin) });
        files.set('walls/index.json', new TextEncoder().encode(JSON.stringify(doc)));
        files.set(`walls/${eKey}.voxel.json`, e.json);
        files.set(`walls/${eKey}.voxel.bin.gz`, await gzip(e.bin));
        const rep = await new WallCache(new MemKv()).importZip(zipStore([...files].map(([name, data]) => ({ name, data }))));
        expect(rep.rejected.map((r) => r.reason).sort()).toEqual(['empty', 'key']);
        expect(rep.imported).toHaveLength(1);
        expect(rep.rejected.find((r) => r.reason === 'key')?.key).toBe(row.key);
    });

    it('reads a zip packed again with deflate (another tool), and checks it too', async () => {
        const data = new TextEncoder().encode('walls '.repeat(1000));
        const stored = zipStore([{ name: 'a.txt', data }]);
        const comp = new Uint8Array(deflateRawSync(data));
        // rewrite the one entry as method 8 with the compressed bytes: local header, data, central directory, end
        const name = new TextEncoder().encode('a.txt');
        const local = stored.slice(0, 30 + name.length);
        const lv = new DataView(local.buffer);
        lv.setUint16(8, 8, true);
        lv.setUint32(18, comp.length, true);
        const cdStart = 30 + name.length + data.length;
        const cd = stored.slice(cdStart, cdStart + 46 + name.length);
        const cv = new DataView(cd.buffer);
        cv.setUint16(10, 8, true);
        cv.setUint32(20, comp.length, true);
        const end = stored.slice(stored.length - 22);
        const ev = new DataView(end.buffer);
        ev.setUint32(12, cd.length, true);
        ev.setUint32(16, local.length + comp.length, true);
        const z = new Uint8Array(local.length + comp.length + cd.length + end.length);
        z.set(local, 0); z.set(comp, local.length); z.set(cd, local.length + comp.length); z.set(end, local.length + comp.length + cd.length);
        const out = await unzip(z);
        expect(new TextDecoder().decode(out.get('a.txt')!)).toBe('walls '.repeat(1000));
        expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926); // the CRC-32 check value
    });
});
