// Collision baking in the browser for scenes published without it (phase C). The same library
// and the same defaults as the SuperSplat pipeline's CLI (splat-transform 3.6.4: 5 cm voxels,
// opacity cut-off 0.1), run on the renderer's own WebGPU device. Loaded on demand only: the
// library is ~5 MB and most flights never need it.
import type { GraphicsDevice } from 'playcanvas';
import { countSolidVoxelsFromBytes } from '@gsfpv/collision';

/** Above this the tab would need several GB (the CLI peaks at ~1 GB for 2.1 M Gaussians). */
export const BAKE_MAX_GAUSSIANS = 4_000_000;

export interface SceneSize {
    kind: 'meta' | 'lod-meta';
    gaussians: number; // the full-detail count that would be voxelised
    lodLevels: number;
}

export class BakeRefusedError extends Error {
    readonly size: SceneSize;
    constructor(size: SceneSize) {
        super(`scene too large to bake in the browser: ${size.gaussians} Gaussians (limit ${BAKE_MAX_GAUSSIANS})`);
        this.name = 'BakeRefusedError';
        this.size = size;
    }
}

export interface BakeResult {
    json: Uint8Array;
    bin: Uint8Array;
    gaussians: number;
    solidVoxels: number;
    ms: { read: number; voxelize: number; total: number };
    peakJsHeapMb: number | null;
}

/** How big is the scene? Read from its own metadata (a few KB), before anything heavy. */
export async function sceneSize(contentUrl: string, kind: 'meta' | 'lod-meta'): Promise<SceneSize> {
    const r = await fetch(contentUrl);
    if (!r.ok) throw new Error(`scene metadata ${r.status}`);
    const m = (await r.json()) as { count?: number; counts?: number[]; lodLevels?: number };
    if (kind === 'lod-meta') return { kind, gaussians: m.counts?.[0] ?? m.count ?? 0, lodLevels: m.lodLevels ?? m.counts?.length ?? 1 };
    return { kind, gaussians: m.count ?? 0, lodLevels: 1 };
}

function heapMb(): number | null {
    const m = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    return m ? m.usedJSHeapSize / 1048576 : null;
}

export async function bakeCollision(contentUrl: string, kind: 'meta' | 'lod-meta', device: GraphicsDevice, onStage: (stage: 'size' | 'read' | 'voxelize' | 'done') => void): Promise<BakeResult> {
    const t0 = performance.now();
    let peak = heapMb();
    const sample = () => { const h = heapMb(); if (h !== null && (peak === null || h > peak)) peak = h; };
    const timer = window.setInterval(sample, 200);
    try {
        onStage('size');
        const size = await sceneSize(contentUrl, kind);
        if (size.gaussians > BAKE_MAX_GAUSSIANS) throw new BakeRefusedError(size);
        onStage('read');
        const st = await import('@playcanvas/splat-transform');
        const wasmUrl = (await import('@playcanvas/splat-transform/lib/webp.wasm?url')).default;
        st.WebPCodec.wasmUrl = wasmUrl;
        const base = contentUrl.slice(0, contentUrl.lastIndexOf('/') + 1);
        const file = contentUrl.slice(base.length);
        const fs = new st.UrlReadFileSystem(base);
        const sources = await st.readFile({ filename: file, inputFormat: kind === 'lod-meta' ? 'lod' : 'sog', fileSystem: fs });
        const src = kind === 'lod-meta' ? st.selectLod(sources[0], 0) : sources[0];
        const table = await st.materializeToDataTable(src, st.createChunkDataPool());
        for (const s of sources) await s.close();
        const tRead = performance.now();
        sample();
        onStage('voxelize');
        const mem = new st.MemoryFileSystem();
        await st.writeVoxel({ filename: 'scene.voxel.json', dataTable: table, voxelResolution: 0.05, opacityCutoff: 0.1, createDevice: async () => device }, mem);
        const json = mem.results.get('scene.voxel.json');
        const bin = mem.results.get('scene.voxel.bin');
        if (!json || !bin) throw new Error('voxel writer produced no output');
        const t1 = performance.now();
        sample();
        onStage('done');
        return { json, bin, gaussians: table.numRows, solidVoxels: countSolidVoxelsFromBytes(json, bin), ms: { read: tRead - t0, voxelize: t1 - tRead, total: t1 - t0 }, peakJsHeapMb: peak };
    } finally {
        clearInterval(timer);
    }
}
