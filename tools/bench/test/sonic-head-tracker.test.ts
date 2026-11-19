// Lane head4, stage H3: the face tracker in a worker (apps/fly/src/sonic/head/face-tracker.ts, face-worker.ts,
// face-protocol.ts, assets.ts) and the loading line of tracking.ts.
//   - the worker answers with numbers only: a tag, the picture's time, the work time and three angles; no picture, no landmark;
//   - the worker closes every picture it is given, skips a time that does not grow, and loads its files from our own origin;
//   - the page moves one picture at a time (transferred, not copied) and skips pictures while the worker reads;
//   - a worker that fails to load rejects the start and is ended; stop ends the worker and the camera's frame source;
//   - a tracker that takes longer than a second to load is said to be loading, a fast one is not;
//   - the files are pinned by size and hash, and nothing of them is fetched from another origin.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runFaceWorker } from '../../../apps/fly/src/sonic/head/face-worker-core';
import type { WorkerScopeLike } from '../../../apps/fly/src/sonic/head/face-worker-core';
import { HEAD_ASSETS, HEAD_ASSET_DIR, HEAD_MODEL, HEAD_WASM_BINARY, HEAD_WASM_LOADER } from '../../../apps/fly/src/sonic/head/assets';
import { faceReply } from '../../../apps/fly/src/sonic/head/face-protocol';
import type { FaceWorkerIn, FaceWorkerOut } from '../../../apps/fly/src/sonic/head/face-protocol';
import { FaceTracker } from '../../../apps/fly/src/sonic/head/face-tracker';
import type { FaceWorkerLike } from '../../../apps/fly/src/sonic/head/face-tracker';
import type { HeadPose } from '../../../apps/fly/src/sonic/head/pose';
import { createHeadTracking, LOADING_LINE_MS } from '../../../apps/fly/src/sonic/head/tracking';
import type { HeadTracker } from '../../../apps/fly/src/sonic/head/types';

/** a face turned to the camera's -x by 30 degrees (the pilot's right), column-major 4 x 4 */
function faceMatrix(yawDeg: number): number[] {
    const a = (yawDeg * Math.PI) / 180;
    // column 0 (x axis), column 1 (up), column 2 (out of the face), column 3 (position)
    return [Math.cos(a), 0, Math.sin(a), 0, 0, 1, 0, 0, -Math.sin(a), 0, Math.cos(a), 0, 1, 2, -40, 1];
}

function onlyNumbers(m: FaceWorkerOut): void {
    for (const [k, v] of Object.entries(m)) {
        if (k === 'kind') expect(typeof v).toBe('string');
        else expect(typeof v).toBe('number');
    }
}

class FakeBitmap {
    closed = false;
    close(): void {
        this.closed = true;
    }
}

class FakeWorker implements FaceWorkerLike {
    sent: { m: FaceWorkerIn; transfer?: Transferable[] }[] = [];
    onmessage: ((e: MessageEvent<FaceWorkerOut>) => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    terminated = false;
    postMessage(m: FaceWorkerIn, transfer?: Transferable[]): void {
        this.sent.push({ m, transfer });
    }
    reply(m: FaceWorkerOut): void {
        this.onmessage?.({ data: m } as MessageEvent<FaceWorkerOut>);
    }
    terminate(): void {
        this.terminated = true;
    }
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function rig() {
    const workers: FakeWorker[] = [];
    let frame: ((grab: () => Promise<ImageBitmap>, tMs: number) => void) | null = null;
    let framesStopped = 0;
    let grabs = 0;
    const faces: { raw: HeadPose | null; tMs: number }[] = [];
    const tracker = new FaceTracker({
        worker: () => {
            const w = new FakeWorker();
            workers.push(w);
            return w;
        },
        base: 'https://gsfpv.example/fly/headtrack/',
        frames: async (_s, f) => {
            frame = f;
            return () => {
                framesStopped++;
            };
        },
        readyTimeoutMs: 1000
    });
    const picture = (tMs: number): void =>
        frame?.(async () => {
            grabs++;
            return new FakeBitmap() as unknown as ImageBitmap;
        }, tMs);
    const start = (): Promise<void> => tracker.start({} as MediaStream, (raw, tMs) => faces.push({ raw, tMs }));
    return { tracker, workers, faces, picture, start, grabs: () => grabs, framesStopped: () => framesStopped };
}

describe('face tracker protocol (lane head4, H3)', () => {
    it('answers with numbers only: a face gives its angles, none or a broken matrix gives no face', () => {
        const face = faceReply(faceMatrix(30), 123.5, 7.25);
        expect(face.kind).toBe('face');
        onlyNumbers(face);
        expect(Object.keys(face).sort()).toEqual(['kind', 'pitchDeg', 'rollDeg', 'tMs', 'workMs', 'yawDeg']);
        if (face.kind !== 'face') throw new Error('face');
        expect(face.yawDeg).toBeCloseTo(30, 6);
        expect(face.pitchDeg).toBeCloseTo(0, 6);
        expect(face.rollDeg).toBeCloseTo(0, 6);
        const none = faceReply(null, 1, 2);
        expect(none).toEqual({ kind: 'none', tMs: 1, workMs: 2 });
        expect(faceReply([1, 2, 3], 1, 2).kind).toBe('none');
        expect(faceReply(new Array(16).fill(Number.NaN), 1, 2).kind).toBe('none');
    });

    it('pins every file by size and hash and serves it from our own folder, no other origin at run time', () => {
        expect(HEAD_ASSETS.map((a) => a.name)).toEqual([HEAD_WASM_LOADER.name, HEAD_WASM_BINARY.name, HEAD_MODEL.name]);
        for (const a of HEAD_ASSETS) {
            expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
            expect(a.bytes).toBeGreaterThan(100_000);
            expect(a.name).not.toContain('/');
        }
        expect(HEAD_ASSET_DIR).toBe('headtrack/');
        expect(HEAD_WASM_LOADER.name).toContain('module');
    });
});

describe('face tracker worker (lane head4, H3)', () => {
    it('loads from the given folder, reads each picture once, closes it and answers with numbers only', async () => {
        const posted: FaceWorkerOut[] = [];
        const created = { detect: 0, closed: false, files: [] as unknown[] };
        const scope: WorkerScopeLike = { onmessage: null, postMessage: (m) => posted.push(m), close: () => {} };
        runFaceWorker(scope, async (files, opts) => {
            created.files = [files, opts];
            return {
                detectForVideo: (_b, t) => {
                    created.detect++;
                    return { facialTransformationMatrixes: t < 50 ? [] : [{ data: faceMatrix(-20) }] };
                },
                close: () => {
                    created.closed = true;
                }
            };
        });
        const self = scope as unknown as { onmessage: (e: { data: FaceWorkerIn }) => void };
        self.onmessage({ data: { kind: 'init', base: 'https://gsfpv.example/fly/headtrack/' } });
        await flush();
        expect(posted[0]?.kind).toBe('ready');
        const [files, opts] = created.files as [Record<string, string>, Record<string, unknown> & { baseOptions: Record<string, string> }];
        expect(files.wasmLoaderPath).toBe('https://gsfpv.example/fly/headtrack/' + HEAD_WASM_LOADER.name);
        expect(files.wasmBinaryPath).toBe('https://gsfpv.example/fly/headtrack/' + HEAD_WASM_BINARY.name);
        expect(opts.baseOptions.modelAssetPath).toBe('https://gsfpv.example/fly/headtrack/' + HEAD_MODEL.name);
        expect(opts.outputFaceBlendshapes).toBe(false);
        expect(opts.outputFacialTransformationMatrixes).toBe(true);

        const pics = [new FakeBitmap(), new FakeBitmap(), new FakeBitmap()];
        self.onmessage({ data: { kind: 'frame', bitmap: pics[0] as unknown as ImageBitmap, tMs: 10 } });
        self.onmessage({ data: { kind: 'frame', bitmap: pics[1] as unknown as ImageBitmap, tMs: 100 } });
        // a time that does not grow is not read (the video mode would throw), still closed and answered
        self.onmessage({ data: { kind: 'frame', bitmap: pics[2] as unknown as ImageBitmap, tMs: 100 } });
        expect(pics.every((p) => p.closed)).toBe(true);
        expect(created.detect).toBe(2);
        expect(posted.slice(1).map((m) => m.kind)).toEqual(['none', 'face', 'none']);
        for (const m of posted) onlyNumbers(m);
        const face = posted[2];
        if (face?.kind !== 'face') throw new Error('face');
        expect(face.yawDeg).toBeCloseTo(-20, 6);
        self.onmessage({ data: { kind: 'close' } });
        expect(created.closed).toBe(true);
    });
});

describe('face tracker, page side (lane head4, H3)', () => {
    it('moves one picture at a time, skips pictures while the worker reads, hands the angles on', async () => {
        const r = rig();
        const started = r.start();
        const w = r.workers[0] as FakeWorker;
        expect(w.sent[0]?.m).toEqual({ kind: 'init', base: 'https://gsfpv.example/fly/headtrack/' });
        w.reply({ kind: 'ready', loadMs: 5 });
        await started;
        r.picture(10);
        await flush();
        r.picture(20);
        r.picture(30);
        await flush();
        expect(r.grabs()).toBe(1);
        const sent = w.sent[1];
        expect(sent?.m.kind).toBe('frame');
        if (sent?.m.kind !== 'frame') throw new Error('frame');
        expect(sent.transfer).toEqual([sent.m.bitmap]);
        expect(sent.m.tMs).toBe(10);
        w.reply({ kind: 'face', tMs: 10, workMs: 4, yawDeg: 12, pitchDeg: -3, rollDeg: 1 });
        w.reply({ kind: 'none', tMs: 40, workMs: 4 });
        expect(r.faces).toEqual([
            { raw: { yawDeg: 12, pitchDeg: -3, rollDeg: 1 }, tMs: 10 },
            { raw: null, tMs: 40 }
        ]);
        r.picture(50);
        await flush();
        expect(r.grabs()).toBe(2);
        r.tracker.stop();
        expect(w.terminated).toBe(true);
        expect(w.sent.at(-1)?.m).toEqual({ kind: 'close' });
        expect(r.framesStopped()).toBe(1);
    });

    it('a worker that cannot load rejects the start and is ended', async () => {
        const r = rig();
        const started = r.start();
        const w = r.workers[0] as FakeWorker;
        w.reply({ kind: 'error' });
        await expect(started).rejects.toThrow();
        expect(w.terminated).toBe(true);
        expect(r.framesStopped()).toBe(0);
    });
});

describe('loading line (lane head4, H3)', () => {
    afterEach(() => vi.useRealTimers());

    async function run(loadMs: number): Promise<string[]> {
        vi.useFakeTimers();
        const said: string[] = [];
        const tracker: HeadTracker = { start: async () => {}, stop: () => {} };
        const t = createHeadTracking({
            media: () => ({ getUserMedia: async () => ({ getTracks: () => [] }) as unknown as MediaStream }),
            tracker: () => new Promise((res) => setTimeout(() => res(tracker), loadMs)),
            listener: () => null,
            say: async (id) => {
                said.push(id);
            },
            narrator: () => true
        });
        const started = t.start();
        await vi.advanceTimersByTimeAsync(loadMs + 10);
        expect(await started).toBe('on');
        await vi.advanceTimersByTimeAsync(LOADING_LINE_MS * 2);
        return said;
    }

    it('says the tracker is loading when it takes longer than a second, and not when it is quick', async () => {
        expect(await run(3000)).toEqual(['loading']);
        expect(await run(200)).toEqual([]);
    });
});
