// Levels of detail (v0.8 lane C, the owner's item 8): what the renderer checks before it hands a
// streamed scan (lod-meta.json) to the engine, and what it reports about the levels at work. Pure: no
// engine, no DOM, so it runs in Node tests; renderer.ts uses it.

/** The deepest octree the check accepts (SuperSplat's policy: 1 + ceil(log2(N / 1 M)) levels; 13 seen). */
export const MAX_LOD_LEVELS = 64;

/**
 * Why the engine cannot open this lod-meta.json, or null when it can. The engine (playcanvas 2.23
 * GSplatOctree) reads `lodLevels`, `filenames` and `tree` in its constructor, inside the HTTP callback
 * of its own request: a file without them throws there, and the asset then neither loads nor fails, so
 * the scan would wait forever. Checked first, such a file is an error the session can fall back from
 * (the scene's next content file, @gsfpv/scenes content.ts).
 */
export function lodMetaProblem(json: unknown): string | null {
    if (!json || typeof json !== 'object' || Array.isArray(json)) return 'not a JSON object';
    const m = json as { lodLevels?: unknown; filenames?: unknown; tree?: unknown };
    const n = m.lodLevels;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > MAX_LOD_LEVELS) return `lodLevels ${JSON.stringify(n)} is not a whole number from 1 to ${MAX_LOD_LEVELS}`;
    if (!Array.isArray(m.filenames) || m.filenames.length === 0) return 'no filenames';
    if (!m.filenames.every((f) => typeof f === 'string' && f.length > 0)) return 'a filename is not a string';
    if (!m.tree || typeof m.tree !== 'object' || Array.isArray(m.tree)) return 'no tree';
    return null;
}

/** What the scan on screen is drawn from and how its levels of detail work right now (SplatRenderer.lodState). */
export interface LodState {
    /** 'lod-meta': a streamed octree (levels of detail); 'meta': one SOG file; null: no scan loaded */
    kind: 'lod-meta' | 'meta' | null;
    /** levels of detail in the scan (1 for a single file) */
    levels: number;
    /** the LOD range the engine may pick from: [finest, coarsest] (0 = the finest level) */
    range: [number, number];
    /**
     * 'coarse': only the coarsest level, while the first view loads (D27); 'auto': every level, by
     * distance, under the splat budget (the default once the scan is shown); 'final': the finest level
     * everywhere (cinema mode, the video export); 'single': one level only (a single file, or an
     * octree SuperSplat built with one level), nothing to choose
     */
    mode: 'coarse' | 'auto' | 'final' | 'single';
    /** splats the engine drew in the last frame */
    drawn: number;
    /** the splat budget, millions */
    budgetM: number;
    /** files of the scan the engine still loads */
    loading: number;
}

/** The mode for a scan's kind and the engine component's LOD range (see LodState.mode). */
export function lodMode(kind: LodState['kind'], levels: number, rangeMin: number, rangeMax: number): LodState['mode'] {
    if (kind !== 'lod-meta' || levels <= 1) return 'single';
    if (rangeMin >= levels - 1) return 'coarse';
    if (rangeMax <= 0) return 'final';
    return 'auto';
}
