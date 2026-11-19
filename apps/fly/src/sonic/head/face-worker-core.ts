// The face tracker worker's message handling (lane head4, stage H3), apart from MediaPipe so a test can give its own
// landmarker: face-worker.ts is the worker's entry and passes MediaPipe's Face Landmarker here.
// One camera picture at a time comes in (face-protocol.ts); it is read, closed at once, and only numbers go back.
import { HEAD_MODEL, HEAD_WASM_BINARY, HEAD_WASM_LOADER } from './assets';
import { FACE_OPTIONS, faceReply } from './face-protocol';
import type { FaceWorkerIn, FaceWorkerOut } from './face-protocol';

/** The files the landmarker loads (MediaPipe's WasmFileset) and its options, as face-worker.ts hands them on. */
export interface LandmarkerFiles {
    readonly wasmLoaderPath: string;
    readonly wasmBinaryPath: string;
}
export interface LandmarkerOptions {
    readonly baseOptions: { readonly modelAssetPath: string; readonly delegate: 'CPU' | 'GPU' };
    readonly runningMode: 'VIDEO';
    readonly numFaces: number;
    readonly outputFaceBlendshapes: boolean;
    readonly outputFacialTransformationMatrixes: boolean;
}

/** The part of MediaPipe's FaceLandmarker this uses. */
export interface LandmarkerLike {
    detectForVideo(image: ImageBitmap, tMs: number): { readonly facialTransformationMatrixes?: readonly { readonly data: ArrayLike<number> }[] };
    close(): void;
}

export type CreateLandmarker = (files: LandmarkerFiles, options: LandmarkerOptions) => Promise<LandmarkerLike>;

/** The worker's global as this uses it. */
export interface WorkerScopeLike {
    onmessage: ((e: MessageEvent<FaceWorkerIn>) => void) | null;
    postMessage(m: FaceWorkerOut): void;
    close(): void;
}

export function runFaceWorker(scope: WorkerScopeLike, create: CreateLandmarker): void {
    let landmarker: LandmarkerLike | null = null;
    let lastT = -Infinity;

    const init = async (base: string): Promise<void> => {
        const t0 = performance.now();
        try {
            landmarker = await create(
                { wasmLoaderPath: base + HEAD_WASM_LOADER.name, wasmBinaryPath: base + HEAD_WASM_BINARY.name },
                {
                    baseOptions: { modelAssetPath: base + HEAD_MODEL.name, delegate: FACE_OPTIONS.delegate },
                    runningMode: FACE_OPTIONS.runningMode,
                    numFaces: FACE_OPTIONS.numFaces,
                    outputFaceBlendshapes: FACE_OPTIONS.outputFaceBlendshapes,
                    outputFacialTransformationMatrixes: FACE_OPTIONS.outputFacialTransformationMatrixes
                }
            );
            scope.postMessage({ kind: 'ready', loadMs: performance.now() - t0 });
        } catch {
            scope.postMessage({ kind: 'error' });
        }
    };

    const frame = (bitmap: ImageBitmap, tMs: number): void => {
        const t0 = performance.now();
        let matrix: ArrayLike<number> | null = null;
        try {
            // the video mode wants a growing time
            if (landmarker && tMs > lastT) {
                lastT = tMs;
                matrix = landmarker.detectForVideo(bitmap, tMs).facialTransformationMatrixes?.[0]?.data ?? null;
            }
        } catch {
            matrix = null;
        } finally {
            bitmap.close();
        }
        scope.postMessage(faceReply(matrix, tMs, performance.now() - t0));
    };

    scope.onmessage = (e) => {
        const m = e.data;
        if (m.kind === 'init') void init(m.base);
        else if (m.kind === 'frame') frame(m.bitmap, m.tMs);
        else {
            landmarker?.close();
            landmarker = null;
            scope.close();
        }
    };
}
