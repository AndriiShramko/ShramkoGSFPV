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

/** One mesh of the plan as the share sees it (overlay.ts PlannedChunk). */
export interface ShareItem { key: number; lod: number; dist: number; members?: number; farDist?: number }

/**
 * What the walls line shows (V2): the share of the planned wall chunks that are ON SCREEN at their
 * planned level. `drawnAt(key)` is the level a mesh is drawn at now, undefined while it waits for
 * its upload (a mesh the worker built but the overlay has not uploaded is not counted). A group
 * counts its members; the far distance drawn is its farthest chunk's.
 */
export function drawnShare(plan: readonly ShareItem[], drawnAt: (key: number) => number | undefined): { total: number; drawn: number; share: number; farM: number; drawnFarM: number; perLevel: number[]; meshesPerLevel: number[] } {
    let total = 0, drawn = 0, farM = 0, drawnFarM = 0;
    const perLevel = [0, 0, 0, 0], meshesPerLevel = [0, 0, 0, 0];
    for (const c of plan) {
        const n = c.members ?? 1, far = c.farDist ?? c.dist;
        total += n;
        farM = Math.max(farM, far);
        if (drawnAt(c.key) !== c.lod) continue;
        drawn += n;
        drawnFarM = Math.max(drawnFarM, far);
        perLevel[c.lod] += n;
        meshesPerLevel[c.lod]++;
    }
    return { total, drawn, share: total ? Math.floor((drawn / total) * 100) : 100, farM, drawnFarM, perLevel, meshesPerLevel };
}

/** How far back the fill's pace is read (ms): the last 2 s, so the slow first near chunks do not drag it. Estimate. */
export const FILL_PACE_MS = 2000;

/** One reading of the share on screen (percent) at time `t` (ms). */
export interface FillSample { t: number; share: number }

/**
 * Seconds left until the whole scene is on screen, from the pace of the last FILL_PACE_MS: `samples` are the
 * readings since the fill began, oldest first (the first one is the fill's start), `share` the share now.
 * When nothing came in the last FILL_PACE_MS the pace since the start is used. null when nothing is drawn yet
 * or all is, or no pace can be told.
 */
export function fillLeftS(samples: readonly FillSample[], now: number, share: number): number | null {
    if (!(share > 0) || share >= 100 || samples.length === 0) return null;
    let ref = samples[0];
    for (const s of samples) if (s.t <= now - FILL_PACE_MS) ref = s;
    const left = (from: FillSample): number | null => {
        const dt = now - from.t, ds = share - from.share;
        return dt > 0 && ds > 0 ? Math.max(1, Math.round((dt * (100 - share)) / ds / 1000)) : null;
    };
    return left(ref) ?? left(samples[0]);
}

/** Keep the readings fillLeftS needs: the first one and those from FILL_PACE_MS before `now` (one older kept). */
export function trimFillSamples(samples: FillSample[], now: number): void {
    let cut = 1;
    while (cut + 1 < samples.length && samples[cut + 1].t <= now - FILL_PACE_MS) cut++;
    if (cut > 1) samples.splice(1, cut - 1);
}
