// Stage F1-no-freeze: bakeCollision with the same signature, run in bake-worker.ts (its own WebGPU device),
// so the page's main thread stays free: the flight, the walls box line and the course go on during a build.
// A browser that gives a worker no WebGPU builds on the page as before (bakeCollision with the renderer's device).
import type { GraphicsDevice } from 'playcanvas';
import { BakeTimeoutError, bakeCollision, bakeErrorFromWire, gpuLimitsOf, markCounted, memCapGb } from './bake';
import type { BakeOptions, BakeResult } from './bake';
import type { BakeReply, BakeRequest } from './bake-worker';

/** where the current (or last) build runs: 'worker', or 'page' when a worker has no WebGPU (the box's note and the hook read it) */
export let lastBakeWhere: 'worker' | 'page' | null = null;
/** the worker said it has no WebGPU once: later builds of this page go to the page at once */
let noWorkerGpu: string | null = null;
/** a build step here can be stopped (it runs in a worker): the ladder may give it a time limit */
export function offThreadStoppable(): boolean {
    return noWorkerGpu === null && typeof Worker !== 'undefined';
}

/**
 * The worker's request: only data (bakeBase passes its whole option bag, with `bake`, `onStep` and `stepTimeout`
 * functions, which a worker message cannot carry: "could not be cloned", seen on Wroclaw in the F1 proof).
 */
export function workerRequest(contentUrl: string, kind: 'meta' | 'lod-meta', o: BakeOptions, pageHref: string, limits: BakeOptions['limits'], capGb: number): BakeRequest {
    return {
        contentUrl: new URL(contentUrl, pageHref).href,
        kind,
        o: { voxelM: o.voxelM, coarsenOnOctree: o.coarsenOnOctree, size: o.size, shipped: o.shipped, level: o.level, limits, capGb }
    };
}

export function bakeOffThread(contentUrl: string, kind: 'meta' | 'lod-meta', device: GraphicsDevice, onStage: (stage: 'size' | 'read' | 'voxelize' | 'done') => void, o: BakeOptions & { signal?: AbortSignal } = {}): Promise<BakeResult> {
    const page = (): Promise<BakeResult> => { lastBakeWhere = 'page'; return bakeCollision(contentUrl, kind, device, onStage, o); };
    if (noWorkerGpu !== null || typeof Worker === 'undefined') return page();
    // the worker's device has the same adapter: the limits and the memory budget are read here, once
    const signal = o.signal;
    const req = workerRequest(contentUrl, kind, o, location.href, o.limits !== undefined ? o.limits : gpuLimitsOf(device), o.capGb ?? memCapGb());
    return new Promise<BakeResult>((resolve, reject) => {
        let worker: Worker;
        try {
            worker = new Worker(new URL('./bake-worker.ts', import.meta.url), { type: 'module' });
            lastBakeWhere = 'worker';
        } catch {
            page().then(resolve, reject);
            return;
        }
        const end = (): void => { worker.terminate(); signal?.removeEventListener('abort', onAbort); };
        const onAbort = (): void => { end(); reject(new BakeTimeoutError('build step stopped')); };
        if (signal?.aborted) { onAbort(); return; }
        signal?.addEventListener('abort', onAbort);
        worker.onmessage = (ev: MessageEvent<BakeReply>) => {
            const m = ev.data;
            if (m.type === 'stage') onStage(m.stage);
            else if (m.type === 'done') { end(); markCounted(m.r.json, m.r.bin, m.r.solidVoxels); resolve(m.r); }
            else if (m.type === 'error') { end(); reject(bakeErrorFromWire(m.e)); }
            else { end(); noWorkerGpu = m.why; console.warn('walls build on the page:', m.why); page().then(resolve, reject); }
        };
        worker.onerror = (ev) => {
            // the worker's script failed to load or threw outside a build: build on the page instead
            ev.preventDefault();
            end();
            noWorkerGpu = String(ev.message || 'worker error');
            console.warn('walls build on the page:', noWorkerGpu);
            page().then(resolve, reject);
        };
        try {
            worker.postMessage(req);
        } catch (e) {
            // a request the worker cannot take: the build still runs (on the page), and the console says why
            end();
            console.warn('walls build on the page:', e);
            page().then(resolve, reject);
        }
    });
}
