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
    /** Gaussians of every level of detail, finest first (a streamed scan; absent: only `gaussians`) */
    byLevel?: number[];
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

/** Gaussians of every level over the tree's leaves (index = level); zeros where the tree is silent. */
export function levelsFromTree(tree: LodNode | undefined, levels: number): number[] {
    const out = new Array<number>(Math.max(1, levels)).fill(0);
    const stack: LodNode[] = tree ? [tree] : [];
    while (stack.length) {
        const node = stack.pop()!;
        for (const [k, v] of Object.entries(node.lods ?? {})) {
            const i = Number(k);
            if (typeof v?.count === 'number' && Number.isFinite(v.count) && i >= 0 && i < out.length) out[i] += v.count;
        }
        if (Array.isArray(node.children)) stack.push(...node.children);
    }
    return out;
}

/** How many Gaussians a bake would voxelise, from the scene's own metadata. */
export function gaussiansFromMeta(m: { count?: number; counts?: number[]; lodLevels?: number; tree?: LodNode }, kind: 'meta' | 'lod-meta', etag: string | null = null): SceneSize {
    if (kind === 'meta') return { kind, gaussians: m.count ?? 0, lodLevels: 1, from: typeof m.count === 'number' ? 'count' : 'none', etag };
    const tree = lod0FromTree(m.tree);
    const lodLevels = m.lodLevels ?? m.counts?.length ?? 1;
    if (tree > 0) return { kind, gaussians: tree, lodLevels, from: 'tree', etag, byLevel: levelsFromTree(m.tree, lodLevels) };
    if (typeof m.counts?.[0] === 'number') return { kind, gaussians: m.counts[0], lodLevels, from: 'counts', etag, byLevel: m.counts.slice() };
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

/** One way to build walls for a scan without them: which level of detail, which cell. */
export interface BaseStep {
    level: number;
    voxelM: number;
    /** Gaussians this step reads */
    gaussians: number;
}

/**
 * The ladder of a base bake (walls stage W1): it never refuses a scan. Every level of detail holds
 * half the Gaussians of the one above (measured on the 13 catalogue scans, walls-scan-sizes.ts), so
 * the finest level that passes the GPU-buffer and memory gates comes first and every coarser level
 * after it, for when the device runs out of memory anyway. A cell too small for the octree format
 * is the bake's own business (it goes 2x and 4x coarser on the same data). A single-file scan has
 * one level: it is tried even past the estimate (the estimate is not the device's real limit).
 */
export function planBase(size: SceneSize, o: { limits: GpuLimits | null; capGb: number }): BaseStep[] {
    const levels = size.byLevel && size.byLevel.length ? size.byLevel : [size.gaussians];
    const max = maxGaussians(o.limits, o.capGb);
    const steps = levels.map((g, level) => ({ level, voxelM: BASE_VOXEL_M, gaussians: g })).filter((s) => s.gaussians > 0);
    const first = steps.findIndex((s) => s.gaussians <= max);
    if (first < 0) return steps.length ? [steps[steps.length - 1]] : [{ level: 0, voxelM: BASE_VOXEL_M, gaussians: size.gaussians }];
    return steps.slice(first);
}

/** Walls of a lower level or a coarser cell than the base: the pilot is told so in one line. */
export function isRough(r: { level: number; voxelM: number }): boolean {
    return r.level > 0 || r.voxelM > BASE_VOXEL_M + 1e-6;
}

/** The device or the tab ran out of room for this step: the next, lighter step may still fit. */
export function outOfRoom(e: unknown): boolean {
    if (e instanceof BakeGpuError) return true;
    if (e instanceof BakeRefusedError) return e.reason === 'gpu-buffer' || e.reason === 'memory' || e.reason === 'octree';
    if (e instanceof RangeError) return true;
    return /out of memory|allocation failed|allocate|device (was )?lost|mixed blocks|mixed-leaf|Sparse octree node count/i.test(String((e as { message?: unknown } | null)?.message ?? e));
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
    /** the level of detail the walls were built from (0: full detail) */
    level: number;
    /** share of the level's Gaussians inside the dense core the walls were built from (cropToCore) */
    kept?: number;
    ms: { read: number; voxelize: number; total: number };
    peakJsHeapMb: number | null;
}

/**
 * The dense core of a scan, the same rule as the published walls (tools/walls/bake-published.mjs cropBox):
 * per axis the CROP_TAIL and 1 - CROP_TAIL quantiles of the positions, widened by CROP_MARGIN of that
 * span plus CROP_PAD_M. Settings chosen, not measured; the offline bakes kept 98.5 to 99.9 % of the Gaussians.
 */
export const CROP_TAIL = 0.005;
export const CROP_MARGIN = 0.15;
export const CROP_PAD_M = 5;
/** positions read for the quantiles (every n-th row); an estimate, enough for a 0.5 % tail */
export const CROP_SAMPLE = 1_000_000;

export function coreBox(axes: ArrayLike<number>[], tail = CROP_TAIL, margin = CROP_MARGIN, pad = CROP_PAD_M, sample = CROP_SAMPLE): { min: number[]; max: number[] } {
    const min: number[] = [];
    const max: number[] = [];
    for (const a of axes) {
        const step = Math.max(1, Math.floor(a.length / sample));
        const s = new Float32Array(Math.ceil(a.length / step));
        for (let i = 0, j = 0; i < a.length; i += step, j++) s[j] = a[i];
        s.sort();
        const n = s.length;
        const lo = s[Math.max(0, Math.floor(n * tail))];
        const hi = s[Math.min(n - 1, Math.max(0, Math.ceil(n * (1 - tail)) - 1))];
        const m = (hi - lo) * margin + pad;
        min.push(lo - m);
        max.push(hi + m);
    }
    return { min, max };
}

type CropLib = Pick<typeof import('@playcanvas/splat-transform'), 'Column' | 'DataTable'>;
type Table = import('@playcanvas/splat-transform').DataTable;

/**
 * The rows of `table` inside its dense core, without a copy: the kept rows are moved to the front in place
 * and the result views the first k of every column (the same transform). Raw positions, as the columns hold them.
 */
export function cropToCore(st: CropLib, table: Table): { table: Table; kept: number } {
    const x = table.getColumnByName('x')?.data;
    const y = table.getColumnByName('y')?.data;
    const z = table.getColumnByName('z')?.data;
    const n = table.numRows;
    if (!x || !y || !z || n === 0) return { table, kept: 1 };
    const box = coreBox([x, y, z]);
    const order = new Uint32Array(n);
    let k = 0;
    for (let i = 0; i < n; i++) {
        const inside = x[i] >= box.min[0] && x[i] <= box.max[0] && y[i] >= box.min[1] && y[i] <= box.max[1] && z[i] >= box.min[2] && z[i] <= box.max[2];
        if (inside) order[k++] = i;
    }
    if (k === n || k === 0) return { table, kept: 1 };
    let r = k;
    for (let i = 0; i < n; i++) {
        const inside = x[i] >= box.min[0] && x[i] <= box.max[0] && y[i] >= box.min[1] && y[i] <= box.max[1] && z[i] >= box.min[2] && z[i] <= box.max[2];
        if (!inside) order[r++] = i;
    }
    table.permuteRowsInPlace(order);
    const cols = table.columns.map((c) => new st.Column(c.name, c.data.subarray(0, k)));
    return { table: new st.DataTable(cols, table.transform), kept: k / n };
}

export interface BakeOptions {
    /** default: the 5 cm of a scene without walls */
    voxelM?: number;
    /** base bake only: when the octree would exceed the format's limit (a very large exterior),
     *  try 2x and 4x the voxel size on the same data instead of failing (the result says which) */
    coarsenOnOctree?: boolean;
    /** the size already read for the cache key (saves a request) */
    size?: SceneSize;
    /** the shipped walls, for the octree-size gate of a refine */
    shipped?: { voxelM: number; nodes: number } | null;
    /** the level of detail of a streamed scan to build from (default 0, full detail) */
    level?: number;
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
/**
 * The library reports the format's limits only in its message, and not always as an Error. splat-transform
 * 3.6.4 has three: "more than N mixed blocks", "Sparse octree mixed-leaf count (...) exceeds" and
 * "Sparse octree node count (...) exceeds the Laine-Karras 24-bit baseOffset limit"; a coarser cell helps all three.
 */
export function tooManyBlocks(e: unknown): boolean {
    return e != null && /mixed blocks|Sparse octree (node|mixed-leaf) count/i.test(String((e as { message?: unknown }).message ?? e));
}

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
        const full = o.size ?? await sceneSize(contentUrl, kind);
        const level = kind === 'lod-meta' ? Math.max(0, Math.min(o.level ?? 0, full.lodLevels - 1)) : 0;
        const size = level > 0 && full.byLevel?.[level] ? { ...full, gaussians: full.byLevel[level] } : full;
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
        const src = kind === 'lod-meta' ? st.selectLod(sources[0], level) : sources[0];
        // only what the voxeliser reads (as the CLI does): same octree, bit for bit, at half the memory
        // (15.4 M Gaussians: 2.65 GB instead of 5.6 GB with the colour columns)
        const whole = await st.materializeToDataTable(src, st.createChunkDataPool(), new Set(['position', 'geometric']));
        for (const s of sources) await s.close();
        // a few floaters kilometres out make the voxeliser walk the whole bound (Wroclaw: 13.5 km, still
        // voxelising after 20 min): build the walls of the dense core, as the published walls are built
        const core = cropToCore(st, whole);
        const table = core.table;
        const tRead = performance.now();
        sample();
        onStage('voxelize');
        const mem = new st.MemoryFileSystem();
        // a buffer the GPU refuses is only logged by the library, which then writes an empty octree:
        // catch the error itself, not only its result
        const gpu = (device as unknown as { wgpu?: GpuErrorScopes }).wgpu ?? null;
        gpu?.pushErrorScope('out-of-memory');
        gpu?.pushErrorScope('validation');
        // the format holds at most 2^24 mixed blocks; a very large exterior at 5 cm exceeds it and the
        // library says so only after the work. A base bake then goes coarser on the same data
        const sizes = o.coarsenOnOctree ? [voxelM, voxelM * 2, voxelM * 4] : [voxelM];
        let failure: unknown = null;
        let used = voxelM;
        for (const v of sizes) {
            failure = null;
            used = v;
            try {
                await st.writeVoxel({ filename: 'scene.voxel.json', dataTable: table, voxelResolution: v, opacityCutoff: OPACITY_CUTOFF, createDevice: async () => device }, mem);
            } catch (e) {
                failure = e;
            }
            if (!tooManyBlocks(failure)) break;
        }
        const validation = gpu ? await gpu.popErrorScope() : null;
        const oom = gpu ? await gpu.popErrorScope() : null;
        if (validation || oom) throw new BakeGpuError(`GPU ${validation ? 'validation' : 'out-of-memory'} error: ${(validation ?? oom)!.message.slice(0, 200)}`);
        if (tooManyBlocks(failure)) throw new BakeRefusedError('octree', size, 0, `even at ${Math.round(used * 100)} cm`);
        if (failure) throw failure;
        const json = mem.results.get('scene.voxel.json');
        const bin = mem.results.get('scene.voxel.bin');
        if (!json || !bin) throw new Error('voxel writer produced no output');
        const solidVoxels = assertWalls(json, bin);
        const t1 = performance.now();
        sample();
        onStage('done');
        return { json, bin, gaussians: table.numRows, kept: core.kept, solidVoxels, voxelM: used, level, ms: { read: tRead - t0, voxelize: t1 - tRead, total: t1 - t0 }, peakJsHeapMb: peak };
    } finally {
        clearInterval(timer);
    }
}

export type BaseStage = 'size' | 'read' | 'voxelize' | 'lighter' | 'done';

/**
 * Walls for a scan without any, whatever its size: the ladder of planBase, one step after another
 * until one fits this device. Only a failure that is not about room (no WebGPU, a network error,
 * empty walls) ends it early. `bake` is bakeCollision (a test passes its own).
 */
export async function bakeBase(contentUrl: string, kind: 'meta' | 'lod-meta', device: GraphicsDevice, onStage: (stage: BaseStage) => void, o: BakeOptions & { bake?: typeof bakeCollision } = {}): Promise<BakeResult & { tried: number }> {
    const bake = o.bake ?? bakeCollision;
    onStage('size');
    const size = o.size ?? await sceneSize(contentUrl, kind);
    const limits = o.limits !== undefined ? o.limits : gpuLimitsOf(device);
    const steps = planBase(size, { limits, capGb: o.capGb ?? memCapGb() });
    let last: unknown = null;
    for (let i = 0; i < steps.length; i++) {
        if (i > 0) onStage('lighter');
        try {
            // a step the plan let through past the estimate (the last level) is tried for real
            const r = await bake(contentUrl, kind, device, (s) => onStage(s), { ...o, size, level: steps[i].level, voxelM: steps[i].voxelM, coarsenOnOctree: true, capGb: i === steps.length - 1 ? Number.POSITIVE_INFINITY : o.capGb, limits: i === steps.length - 1 ? null : o.limits });
            return { ...r, tried: i + 1 };
        } catch (e) {
            last = e;
            if (!outOfRoom(e)) throw e;
        }
    }
    throw last;
}
