// Collision baking in the browser: walls for scenes published without them (phase C, 5 cm) and
// finer walls for scenes whose shipped walls leave no room under a chair (refine, 1.6 cm; the
// measurements behind every number here are in .cache/lat-vox/voxel-plan.md, 2026-09-27). The same
// library and defaults as the SuperSplat pipeline's CLI (splat-transform 3.6.4, opacity cut-off
// 0.1), run on the renderer's own WebGPU device. The library is ~5 MB and loaded on demand only:
// most flights never need it. Everything above bakeCollision is pure and runs in Node tests.
import type { GraphicsDevice } from 'playcanvas';
import { countSolidVoxelsFromBytes } from '@gsfpv/collision';

/** Part of the walls cache key: a new library version may voxelise differently. */
export const BAKE_TOOL = 'splat-transform@3.6.4';
export const OPACITY_CUTOFF = 0.1;
/** Walls for a scene without any: the SuperSplat default. */
export const BASE_VOXEL_M = 0.05;
/** Refine target: at 2 cm the lanes under the chairs are already 86-94 % of their 0.8 cm width,
 *  and 0.8 cm costs 5x the octree and 168-220 us of contact query per 1 ms physics tick. */
export const REFINE_VOXEL_M = 0.016;
/** When the octree would not fit at 1.6 cm. */
export const REFINE_FALLBACK_VOXEL_M = 0.02;
/** Shipped walls this fine or finer: nothing to gain. */
export const FINE_ENOUGH_M = 0.02;
/** Shipped walls this coarse or coarser are refined without asking when the bake is short. */
export const AUTO_FROM_M = 0.04;

/** The voxeliser uploads every Gaussian into one storage buffer of 64 B each (index.mjs:14281). */
export const GPU_BYTES_PER_GAUSSIAN = 64;
/** Peak process memory with only the position + geometric columns: 0.17 GB per million Gaussians. */
export const GB_PER_MILLION = 0.17;
/** Octree offsets are 24 bit (index.mjs:34925); a whole-scene bake past this throws after a minute. */
export const OCTREE_NODE_LIMIT = 16_777_216;
/** Margin under the format limit for the prediction below (it was within 5 % on 7a475d38). */
export const MAX_PREDICTED_NODES = 12_000_000;
/** Octree nodes grow as voxel^-2.33 (fit on 7a475d38: 2.33 and 2.32). */
export const NODE_EXPONENT = 2.33;
/** First guess of the browser's bake time per million Gaussians (1.6 cm, calibration PC, x1.33 for
 *  the browser); replaced by what this machine measured after its first bake. */
export const DEFAULT_S_PER_MILLION = 4;
/** Refine without asking up to this long (or 1.5x this load's time to the first view, if longer). */
export const AUTO_MAX_S = 20;
export const OFFER_MAX_S = 180;
/** Longer than this: refused (a local 16 m tile around the drone is the answer, not built yet). */
export const OFFER_LONG_MAX_S = 600;

export interface SceneSize {
    kind: 'meta' | 'lod-meta';
    gaussians: number; // the full-detail count that would be voxelised
    lodLevels: number;
    /** where the count came from: a lod-meta.json of SuperSplat has neither counts nor count */
    from: 'tree' | 'counts' | 'count' | 'none';
    /** ETag (or Last-Modified) of the scene file: part of the walls cache key */
    etag: string | null;
}

interface LodNode {
    lods?: Record<string, { count?: number } | undefined>;
    children?: LodNode[];
}

/** Sum of the full-detail (LOD 0) counts over the tree's leaves: what selectLod(0) will read. */
export function lod0FromTree(tree: LodNode | undefined): number {
    let n = 0;
    const stack: LodNode[] = tree ? [tree] : [];
    while (stack.length) {
        const node = stack.pop()!;
        const c = node.lods?.['0']?.count;
        if (typeof c === 'number' && Number.isFinite(c)) n += c;
        if (Array.isArray(node.children)) stack.push(...node.children);
    }
    return n;
}

/** How many Gaussians a bake would voxelise, from the scene's own metadata. */
export function gaussiansFromMeta(m: { count?: number; counts?: number[]; lodLevels?: number; tree?: LodNode }, kind: 'meta' | 'lod-meta', etag: string | null = null): SceneSize {
    if (kind === 'meta') return { kind, gaussians: m.count ?? 0, lodLevels: 1, from: typeof m.count === 'number' ? 'count' : 'none', etag };
    const tree = lod0FromTree(m.tree);
    const lodLevels = m.lodLevels ?? m.counts?.length ?? 1;
    if (tree > 0) return { kind, gaussians: tree, lodLevels, from: 'tree', etag };
    if (typeof m.counts?.[0] === 'number') return { kind, gaussians: m.counts[0], lodLevels, from: 'counts', etag };
    if (typeof m.count === 'number') return { kind, gaussians: m.count, lodLevels, from: 'count', etag };
    return { kind, gaussians: 0, lodLevels, from: 'none', etag };
}

/** How big is the scene? Read from its own metadata (a few KB), before anything heavy. */
export async function sceneSize(contentUrl: string, kind: 'meta' | 'lod-meta', f: (u: string) => Promise<Response> = fetch): Promise<SceneSize> {
    const r = await f(contentUrl);
    if (!r.ok) throw new Error(`scene metadata ${r.status}`);
    const etag = r.headers.get('etag') ?? r.headers.get('last-modified');
    return gaussiansFromMeta((await r.json()) as Parameters<typeof gaussiansFromMeta>[0], kind, etag);
}

export interface GpuLimits {
    maxBufferSize: number;
    maxStorageBufferBindingSize: number;
}

/** The limits of the device the voxeliser will run on (PlayCanvas asks the adapter for its maximum). */
export function gpuLimitsOf(device: GraphicsDevice | null | undefined): GpuLimits | null {
    const l = (device as unknown as { wgpu?: { limits?: Partial<GpuLimits> } } | null)?.wgpu?.limits;
    if (!l || typeof l.maxBufferSize !== 'number' || typeof l.maxStorageBufferBindingSize !== 'number') return null;
    return { maxBufferSize: l.maxBufferSize, maxStorageBufferBindingSize: l.maxStorageBufferBindingSize };
}

/**
 * Memory a tab may spend on a bake. The plan's rule is min(3 GB, deviceMemory / 4); Chrome reports
 * deviceMemory rounded down and capped at 8, so a big PC reads as 8 -> 2 GB. Browsers without it: 8.
 */
export function memCapGb(deviceMemory: number | undefined = (globalThis.navigator as (Navigator & { deviceMemory?: number }) | undefined)?.deviceMemory): number {
    return Math.min(3, (deviceMemory ?? 8) / 4);
}

export type RefuseReason = 'no-webgpu' | 'size' | 'gpu-buffer' | 'memory' | 'octree' | 'time' | 'empty';

export class BakeRefusedError extends Error {
    readonly reason: RefuseReason;
    readonly size: SceneSize | null;
    /** the most Gaussians the gates let through here (0 when the reason is not the size) */
    readonly maxGaussians: number;
    constructor(reason: RefuseReason, size: SceneSize | null, maxGaussians = 0, detail = '') {
        super(`bake refused (${reason})${size ? `: ${size.gaussians} Gaussians` : ''}${maxGaussians ? `, limit ${maxGaussians}` : ''}${detail ? `; ${detail}` : ''}`);
        this.name = 'BakeRefusedError';
        this.reason = reason;
        this.size = size;
        this.maxGaussians = maxGaussians;
    }
}

/** The GPU reported an error inside the bake: its result cannot be trusted. */
export class BakeGpuError extends Error {
    constructor(msg: string) {
        super(msg);
        this.name = 'BakeGpuError';
    }
}

/** The most Gaussians one whole-scene bake may take on this device and memory budget. */
export function maxGaussians(limits: GpuLimits | null, capGb: number): number {
    const byMem = Math.floor((capGb / GB_PER_MILLION) * 1e6);
    if (!limits) return byMem;
    const byGpu = Math.floor(Math.min(limits.maxBufferSize, limits.maxStorageBufferBindingSize) / GPU_BYTES_PER_GAUSSIAN);
    return Math.min(byMem, byGpu);
}

/** Octree nodes at `voxelM`, from the shipped walls of the same scene. */
export function predictNodes(shipped: { voxelM: number; nodes: number }, voxelM: number): number {
    return shipped.nodes * Math.pow(shipped.voxelM / voxelM, NODE_EXPONENT);
}

/** The finest whole-scene voxel the 24-bit octree allows for this scene. */
export function finestVoxel(shipped: { voxelM: number; nodes: number }): number {
    return shipped.voxelM * Math.pow(shipped.nodes / OCTREE_NODE_LIMIT, 1 / NODE_EXPONENT);
}

/**
 * The hard gates, before anything is downloaded or put on the GPU. A 43 M-Gaussian scene asks for a
 * 2.75 GB buffer above the 2 GiB limit, and the library then returns an EMPTY octree as success.
 */
export function checkBake(size: SceneSize, voxelM: number, o: { limits: GpuLimits | null; capGb: number; webgpu?: boolean; shipped?: { voxelM: number; nodes: number } | null }): void {
    if (o.webgpu === false) throw new BakeRefusedError('no-webgpu', size);
    if (!(size.gaussians > 0)) throw new BakeRefusedError('size', size);
    const max = maxGaussians(o.limits, o.capGb);
    if (o.limits && size.gaussians * GPU_BYTES_PER_GAUSSIAN > Math.min(o.limits.maxBufferSize, o.limits.maxStorageBufferBindingSize)) throw new BakeRefusedError('gpu-buffer', size, max);
    if ((size.gaussians / 1e6) * GB_PER_MILLION > o.capGb) throw new BakeRefusedError('memory', size, max);
    if (o.shipped && predictNodes(o.shipped, voxelM) > MAX_PREDICTED_NODES) throw new BakeRefusedError('octree', size, 0, `${Math.round(predictNodes(o.shipped, voxelM))} nodes predicted`);
}

/** Refuse walls without a single solid voxel: flying through everything is not "walls built". */
export function assertWalls(json: Uint8Array, bin: Uint8Array): number {
    let solid = 0;
    try {
        solid = countSolidVoxelsFromBytes(json, bin);
    } catch {
        solid = 0;
    }
    if (!(solid > 0)) throw new BakeRefusedError('empty', null);
    return solid;
}

export type WallsAction = 'none' | 'auto' | 'offer' | 'offer-long' | 'refused';

export interface RefinePlan {
    action: WallsAction;
    /** the voxel the refine would build, null when there is nothing to build */
    voxelM: number | null;
    estimateS: number;
    reason?: RefuseReason;
    predictedNodes?: number;
    maxGaussians?: number;
}

/**
 * What to do about a scene's shipped walls (voxel-plan sec. 4): refine without asking when they are
 * coarse and the bake is short, offer it when it is longer or the walls are already fairly fine,
 * nothing when they are fine enough or no gate lets the bake through.
 */
export function planRefine(o: { shipped: { voxelM: number; nodes: number }; size: SceneSize; limits: GpuLimits | null; capGb: number; webgpu: boolean; sPerMillion: number; visibleMs: number | null }): RefinePlan {
    const { shipped, size } = o;
    const estimateS = (size.gaussians / 1e6) * o.sPerMillion;
    if (shipped.voxelM <= FINE_ENOUGH_M + 1e-6) return { action: 'none', voxelM: null, estimateS };
    const voxelM = [REFINE_VOXEL_M, REFINE_FALLBACK_VOXEL_M].find((v) => v < shipped.voxelM - 1e-6 && predictNodes(shipped, v) <= MAX_PREDICTED_NODES) ?? null;
    if (voxelM === null) return { action: 'refused', voxelM: null, estimateS, reason: 'octree', predictedNodes: Math.round(predictNodes(shipped, REFINE_FALLBACK_VOXEL_M)) };
    try {
        checkBake(size, voxelM, { limits: o.limits, capGb: o.capGb, webgpu: o.webgpu, shipped });
    } catch (e) {
        if (e instanceof BakeRefusedError) return { action: 'refused', voxelM, estimateS, reason: e.reason, maxGaussians: e.maxGaussians };
        throw e;
    }
    const predictedNodes = Math.round(predictNodes(shipped, voxelM));
    const autoMax = Math.max(AUTO_MAX_S, 1.5 * ((o.visibleMs ?? 0) / 1000));
    if (shipped.voxelM >= AUTO_FROM_M - 1e-6 && estimateS <= autoMax) return { action: 'auto', voxelM, estimateS, predictedNodes };
    if (estimateS <= OFFER_MAX_S) return { action: 'offer', voxelM, estimateS, predictedNodes };
    if (estimateS <= OFFER_LONG_MAX_S) return { action: 'offer-long', voxelM, estimateS, predictedNodes };
    return { action: 'refused', voxelM, estimateS, reason: 'time', predictedNodes };
}

export interface BakeResult {
    json: Uint8Array;
    bin: Uint8Array;
    gaussians: number;
    solidVoxels: number;
    voxelM: number;
    ms: { read: number; voxelize: number; total: number };
    peakJsHeapMb: number | null;
}

export interface BakeOptions {
    /** default: the 5 cm of a scene without walls */
    voxelM?: number;
    /** the size already read for the cache key (saves a request) */
    size?: SceneSize;
    /** the shipped walls, for the octree-size gate of a refine */
    shipped?: { voxelM: number; nodes: number } | null;
    /** test only: pretend the device has these limits */
    limits?: GpuLimits | null;
    capGb?: number;
}

type GpuErrorScopes = { pushErrorScope(f: 'validation' | 'out-of-memory'): void; popErrorScope(): Promise<{ message: string } | null> };

function heapMb(): number | null {
    const m = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    return m ? m.usedJSHeapSize / 1048576 : null;
}

/**
 * Whole-file reads for the bake. splat-transform's UrlReadFileSystem probes with `Range: bytes=0-0`
 * and then reads byte ranges; SuperSplat serves some files brotli/gzip-encoded (about 12 % of the
 * streamed scenes), where the ranges address the ENCODED bytes and the page gets pieces it cannot
 * decode ("Expected property name ... at position 1" on bd04e182). A plain fetch lets the browser
 * decode the whole file; the files are in its HTTP cache already (the renderer loaded them).
 */
export function wholeFileSystem(st: Pick<typeof import('@playcanvas/splat-transform'), 'MemoryReadFileSystem'>, base: string, f: (u: string) => Promise<Response> = fetch): import('@playcanvas/splat-transform').ReadFileSystem {
    return {
        async createSource(filename, progress) {
            const r = await f(base + filename);
            if (!r.ok) throw new Error(`${filename}: ${r.status}`);
            // one throw-away store per file: only the returned source keeps the bytes
            const mem = new st.MemoryReadFileSystem();
            mem.set(filename, new Uint8Array(await r.arrayBuffer()));
            return mem.createSource(filename, progress);
        }
    };
}

export async function bakeCollision(contentUrl: string, kind: 'meta' | 'lod-meta', device: GraphicsDevice, onStage: (stage: 'size' | 'read' | 'voxelize' | 'done') => void, o: BakeOptions = {}): Promise<BakeResult> {
    const voxelM = o.voxelM ?? BASE_VOXEL_M;
    const t0 = performance.now();
    let peak = heapMb();
    const sample = () => { const h = heapMb(); if (h !== null && (peak === null || h > peak)) peak = h; };
    const timer = window.setInterval(sample, 200);
    try {
        onStage('size');
        const size = o.size ?? await sceneSize(contentUrl, kind);
        const limits = o.limits !== undefined ? o.limits : gpuLimitsOf(device);
        checkBake(size, voxelM, { limits, capGb: o.capGb ?? memCapGb(), webgpu: (device as unknown as { isWebGPU?: boolean }).isWebGPU !== false, shipped: o.shipped ?? null });
        onStage('read');
        const st = await import('@playcanvas/splat-transform');
        const wasmUrl = (await import('@playcanvas/splat-transform/lib/webp.wasm?url')).default;
        st.WebPCodec.wasmUrl = wasmUrl;
        const base = contentUrl.slice(0, contentUrl.lastIndexOf('/') + 1);
        const file = contentUrl.slice(base.length);
        const fs = wholeFileSystem(st, base);
        const sources = await st.readFile({ filename: file, inputFormat: kind === 'lod-meta' ? 'lod' : 'sog', fileSystem: fs });
        const src = kind === 'lod-meta' ? st.selectLod(sources[0], 0) : sources[0];
        // only what the voxeliser reads (as the CLI does): same octree, bit for bit, at half the memory
        // (15.4 M Gaussians: 2.65 GB instead of 5.6 GB with the colour columns)
        const table = await st.materializeToDataTable(src, st.createChunkDataPool(), new Set(['position', 'geometric']));
        for (const s of sources) await s.close();
        const tRead = performance.now();
        sample();
        onStage('voxelize');
        const mem = new st.MemoryFileSystem();
        // a buffer the GPU refuses is only logged by the library, which then writes an empty octree:
        // catch the error itself, not only its result
        const gpu = (device as unknown as { wgpu?: GpuErrorScopes }).wgpu ?? null;
        gpu?.pushErrorScope('out-of-memory');
        gpu?.pushErrorScope('validation');
        let failure: unknown = null;
        try {
            await st.writeVoxel({ filename: 'scene.voxel.json', dataTable: table, voxelResolution: voxelM, opacityCutoff: OPACITY_CUTOFF, createDevice: async () => device }, mem);
        } catch (e) {
            failure = e;
        }
        const validation = gpu ? await gpu.popErrorScope() : null;
        const oom = gpu ? await gpu.popErrorScope() : null;
        if (validation || oom) throw new BakeGpuError(`GPU ${validation ? 'validation' : 'out-of-memory'} error: ${(validation ?? oom)!.message.slice(0, 200)}`);
        if (failure) throw failure;
        const json = mem.results.get('scene.voxel.json');
        const bin = mem.results.get('scene.voxel.bin');
        if (!json || !bin) throw new Error('voxel writer produced no output');
        const solidVoxels = assertWalls(json, bin);
        const t1 = performance.now();
        sample();
        onStage('done');
        return { json, bin, gaussians: table.numRows, solidVoxels, voxelM, ms: { read: tRead - t0, voxelize: t1 - tRead, total: t1 - t0 }, peakJsHeapMb: peak };
    } finally {
        clearInterval(timer);
    }
}
