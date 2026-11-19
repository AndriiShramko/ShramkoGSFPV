// The messages between the page and the face tracker's worker (lane head4, stage H3). The page posts one camera picture at a
// time as an ImageBitmap (moved, not copied; the worker closes it after reading). The worker answers with numbers only: the
// picture's time, the head's three angles (or that no face was seen) and how long the reading took. No picture, landmark or
// face data ever comes back, so nothing of the face can be kept, drawn or sent by the page.
import { poseFromFaceMatrix } from './pose';

/** page -> worker */
export type FaceWorkerIn =
    | { readonly kind: 'init'; readonly base: string }
    | { readonly kind: 'frame'; readonly bitmap: ImageBitmap; readonly tMs: number }
    | { readonly kind: 'close' };

/** worker -> page: numbers and a tag, nothing else */
export type FaceWorkerOut =
    | { readonly kind: 'ready'; readonly loadMs: number }
    | { readonly kind: 'error' }
    | { readonly kind: 'face'; readonly tMs: number; readonly workMs: number; readonly yawDeg: number; readonly pitchDeg: number; readonly rollDeg: number }
    | { readonly kind: 'none'; readonly tMs: number; readonly workMs: number };

/** The answer for one picture: the first face's matrix (column-major 4 x 4) or null when no face was found. */
export function faceReply(matrix: ArrayLike<number> | null, tMs: number, workMs: number): FaceWorkerOut {
    if (!matrix || matrix.length < 16) return { kind: 'none', tMs, workMs };
    const p = poseFromFaceMatrix(matrix);
    if (!Number.isFinite(p.yawDeg) || !Number.isFinite(p.pitchDeg) || !Number.isFinite(p.rollDeg)) return { kind: 'none', tMs, workMs };
    return { kind: 'face', tMs, workMs, yawDeg: p.yawDeg, pitchDeg: p.pitchDeg, rollDeg: p.rollDeg };
}

/** Face Landmarker's options: one face, the pose matrix, no blendshapes, on the CPU (the scene keeps the GPU). */
export const FACE_OPTIONS = {
    runningMode: 'VIDEO',
    numFaces: 1,
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: true,
    delegate: 'CPU'
} as const;
