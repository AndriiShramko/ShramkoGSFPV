// The face tracker's worker (lane head4, stage H3): MediaPipe Face Landmarker, driven by face-worker-core.ts. Started by
// face-tracker.ts only while "Turn my head to listen" is on. The wasm runtime and the model come from our own origin (assets.ts).
import { FaceLandmarker } from '@mediapipe/tasks-vision';
import { runFaceWorker } from './face-worker-core';
import type { LandmarkerLike, WorkerScopeLike } from './face-worker-core';

runFaceWorker(self as unknown as WorkerScopeLike, async (files, options) => (await FaceLandmarker.createFromOptions(files, options)) as unknown as LandmarkerLike);
