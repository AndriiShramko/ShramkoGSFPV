// The voxel view's frame rate keeper (lane voxview, V3). Pure: the controller (voxels.ts) feeds it
// the mean frame time of the last second and multiplies the face budgets of the near levels by the
// share it returns. A smaller share only moves chunks to coarser cubes sooner: the whole-scene plan
// (packages/collision overlay.ts planChunks, `whole`) still draws every chunk at its coarsest level,
// so the far part is never removed.

/** How often the keeper looks at the frames (ms). */
export const KEEPER_EVERY_MS = 1000;
/** Slower than this mean frame (ms, under 25 frames a second) halves the share (estimate, not measured on a weak device). */
export const KEEPER_SLOW_MS = 40;
/** Faster than this (ms, over 50 frames a second) for KEEPER_FAST_TURNS looks doubles it again (estimate). */
export const KEEPER_FAST_MS = 20;
export const KEEPER_FAST_TURNS = 4;
/** The smallest share: the near budgets never drop under one eighth (estimate). */
export const KEEPER_MIN = 0.125;

/** One look of the keeper: the share now, the mean frame time (ms) and the fast looks in a row so far. */
export function keeperStep(detail: number, frameMs: number, fast: number): { detail: number; fast: number } {
    if (!(frameMs > 0)) return { detail, fast };
    if (frameMs > KEEPER_SLOW_MS) return { detail: Math.max(KEEPER_MIN, detail / 2), fast: 0 };
    if (frameMs < KEEPER_FAST_MS) {
        const n = fast + 1;
        if (n >= KEEPER_FAST_TURNS && detail < 1) return { detail: Math.min(1, detail * 2), fast: 0 };
        return { detail, fast: n };
    }
    return { detail, fast: 0 };
}
