// The face tracker on the page's side (lane head4, stage H3): HeadTracker (types.ts) over the worker face-worker.ts. The
// camera stream plays into a video element that is never put on the page; each new camera picture becomes an ImageBitmap
// moved to the worker, one at a time (a picture that comes while the worker reads the last one is skipped, so the delay never
// grows). The worker answers with three angles a picture (face-protocol.ts); nothing of the picture comes back or is kept.
import { HEAD_ASSET_DIR } from './assets';
import type { FaceWorkerIn, FaceWorkerOut } from './face-protocol';
import type { HeadPose } from './pose';
import type { HeadTracker } from './types';

/** The part of a Worker this uses. */
export interface FaceWorkerLike {
    postMessage(m: FaceWorkerIn, transfer?: Transferable[]): void;
    onmessage: ((e: MessageEvent<FaceWorkerOut>) => void) | null;
    onerror: ((e: unknown) => void) | null;
    terminate(): void;
}

/** Calls `frame` once per new camera picture with its capture time (ms, performance.now()'s clock); returns its stop. */
export type FrameSource = (stream: MediaStream, frame: (grab: () => Promise<ImageBitmap>, tMs: number) => void) => Promise<() => void>;

/** One read picture, for the probe (tools/bench/scripts/head4-tracker.mjs): numbers only. */
export interface FaceStat {
    readonly tMs: number;
    readonly workMs: number;
    readonly face: boolean;
}

export interface FaceTrackerDeps {
    readonly worker: () => FaceWorkerLike;
    /** the absolute URL of the folder with the wasm and the model (ends with '/') */
    readonly base: string;
    readonly frames: FrameSource;
    /** the first start downloads about 8 MB (gzip): a slow line gets this long before the start counts as failed */
    readonly readyTimeoutMs?: number;
    readonly onStat?: (s: FaceStat) => void;
    /** the worker's load time, ms (the probe reports it) */
    readonly onReady?: (loadMs: number) => void;
}

export const FACE_READY_TIMEOUT_MS = 90_000;

export class FaceTracker implements HeadTracker {
    private worker: FaceWorkerLike | null = null;
    private stopFrames: (() => void) | null = null;
    private busy = false;

    constructor(private readonly d: FaceTrackerDeps) {}

    async start(stream: MediaStream, onFace: (raw: HeadPose | null, tMs: number) => void): Promise<void> {
        this.stop();
        const w = this.d.worker();
        this.worker = w;
        await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('face tracker load timed out')), this.d.readyTimeoutMs ?? FACE_READY_TIMEOUT_MS);
            w.onerror = () => {
                clearTimeout(timer);
                reject(new Error('face tracker worker failed'));
            };
            w.onmessage = (e) => {
                clearTimeout(timer);
                if (e.data.kind === 'ready') {
                    this.d.onReady?.(e.data.loadMs);
                    resolve();
                } else reject(new Error('face tracker did not load'));
            };
            w.postMessage({ kind: 'init', base: this.d.base });
        }).catch((e: unknown) => {
            this.stop();
            throw e;
        });
        if (this.worker !== w) throw new Error('stopped while loading');
        w.onerror = null;
        w.onmessage = (e) => {
            const m = e.data;
            if (m.kind !== 'face' && m.kind !== 'none') return;
            this.busy = false;
            this.d.onStat?.({ tMs: m.tMs, workMs: m.workMs, face: m.kind === 'face' });
            onFace(m.kind === 'face' ? { yawDeg: m.yawDeg, pitchDeg: m.pitchDeg, rollDeg: m.rollDeg } : null, m.tMs);
        };
        this.busy = false;
        const stopFrames = await this.d.frames(stream, (grab, tMs) => {
            if (this.busy || this.worker !== w) return;
            this.busy = true;
            grab().then(
                (bitmap) => {
                    if (this.worker !== w) bitmap.close();
                    else w.postMessage({ kind: 'frame', bitmap, tMs }, [bitmap]);
                },
                () => {
                    this.busy = false;
                }
            );
        });
        if (this.worker !== w) {
            stopFrames();
            throw new Error('stopped while starting');
        }
        this.stopFrames = stopFrames;
    }

    stop(): void {
        this.stopFrames?.();
        this.stopFrames = null;
        const w = this.worker;
        this.worker = null;
        this.busy = false;
        if (w) {
            w.onmessage = null;
            w.onerror = null;
            w.postMessage({ kind: 'close' });
            w.terminate();
        }
    }
}

/**
 * The browser's frame source: a video element off the page, one callback per new camera picture
 * (requestVideoFrameCallback; its captureTime is the camera's own time where the browser gives it).
 */
export const videoFrames: FrameSource = async (stream, frame) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await video.play();
    let live = true;
    let handle = 0;
    const next = (): void => {
        handle = video.requestVideoFrameCallback((now, meta) => {
            if (!live) return;
            const t = (meta as { captureTime?: number }).captureTime ?? now;
            frame(() => createImageBitmap(video), t);
            next();
        });
    };
    next();
    return () => {
        live = false;
        video.cancelVideoFrameCallback(handle);
        video.pause();
        video.srcObject = null;
    };
};

/** The page's tracker: the module worker, the files under the app's base. Loaded with tracking.ts only. */
export function createFaceTracker(o: Pick<FaceTrackerDeps, 'onStat' | 'onReady'> = {}): FaceTracker {
    return new FaceTracker({
        worker: () => new Worker(new URL('./face-worker.ts', import.meta.url), { type: 'module' }) as unknown as FaceWorkerLike,
        base: new URL(import.meta.env.BASE_URL + HEAD_ASSET_DIR, location.href).href,
        frames: videoFrames,
        ...o
    });
}
