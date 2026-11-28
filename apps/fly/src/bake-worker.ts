// Stage F1-no-freeze: the walls build off the page's main thread. splat-transform's read
// (materializeToDataTable) and the CPU part of writeVoxel held the page for 10 to 21 s on Wroclaw
// 70b50d42 (course3 Facts G1-look); here they run in a worker with its own WebGPU device (Chrome gives
// navigator.gpu to workers). One worker per build step: terminating it is the only way to stop a step
// (the library has no abort), and it frees the step's memory and GPU buffers at once.
import { bakeCollision, bakeErrorToWire } from './bake';
import type { BakeKind, BakeOptions, BakeResult } from './bake';
import { gzip, wallsSha } from './wallcache';

export interface BakeRequest { contentUrl: string; kind: BakeKind; o: BakeOptions }
export type BakeReply =
    | { type: 'stage'; stage: 'size' | 'read' | 'voxelize' | 'done' }
    | { type: 'done'; r: BakeResult }
    | { type: 'error'; e: ReturnType<typeof bakeErrorToWire> }
    | { type: 'nogpu'; why: string };

interface WorkerScope { postMessage(m: unknown, transfer?: Transferable[]): void; onmessage: ((ev: MessageEvent<BakeRequest>) => void) | null }
const scope = globalThis as unknown as WorkerScope & { window?: unknown; navigator?: { gpu?: unknown } };

async function workerDevice(): Promise<import('playcanvas').GraphicsDevice> {
    // PlayCanvas's WebGPU device reads window.navigator.gpu: in a worker the global scope stands in for window
    // (set before the engine module is evaluated: it decides its environment when it loads)
    if (scope.window === undefined) scope.window = scope;
    const pc = await import('playcanvas');
    const canvas = new OffscreenCanvas(1024, 512);
    const d = new pc.WebgpuGraphicsDevice(canvas as unknown as HTMLCanvasElement, { antialias: false, depth: false, stencil: false } as never);
    await d.createDevice();
    return d;
}

scope.onmessage = (ev) => {
    const { contentUrl, kind, o } = ev.data;
    void (async () => {
        if (!scope.navigator?.gpu || typeof OffscreenCanvas === 'undefined') {
            scope.postMessage({ type: 'nogpu', why: 'no WebGPU in a worker' } satisfies BakeReply);
            return;
        }
        let device: import('playcanvas').GraphicsDevice;
        try {
            device = await workerDevice();
        } catch (e) {
            scope.postMessage({ type: 'nogpu', why: String((e as Error)?.message ?? e).slice(0, 200) } satisfies BakeReply);
            return;
        }
        try {
            const r = await bakeCollision(contentUrl, kind, device, (stage) => scope.postMessage({ type: 'stage', stage } satisfies BakeReply), o);
            // the hash and the store's gzip are done here: on the page they held its main thread for about
            // 0.35 s and 4.2 s on Wroclaw (course-path-probe PROFILE=1, 2026-11-15)
            r.sha256 = await wallsSha(r.json, r.bin);
            r.binGz = await gzip(r.bin);
            scope.postMessage({ type: 'done', r } satisfies BakeReply, [r.json.buffer, r.bin.buffer, r.binGz.buffer] as Transferable[]);
        } catch (e) {
            scope.postMessage({ type: 'error', e: bakeErrorToWire(e) } satisfies BakeReply);
        } finally {
            try { device.destroy(); } catch { /* the worker ends anyway */ }
        }
    })();
};
