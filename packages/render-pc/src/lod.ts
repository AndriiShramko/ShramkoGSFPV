// Levels of detail (v0.8 lane C, the owner's item 8): what the renderer checks before it hands a
// streamed scan (lod-meta.json) to the engine, and what it reports about the levels at work. Pure: no
// engine, no DOM, so it runs in Node tests; renderer.ts uses it.

/** The deepest octree the check accepts (SuperSplat's policy: 1 + ceil(log2(N / 1 M)) levels; 13 seen). */
export const MAX_LOD_LEVELS = 64;

/**
 * A scan file that arrived but is not one the engine can open (not JSON, or a lod-meta.json that fails
 * lodMetaProblem): the file is damaged, not the network. SplatRenderer.loadSplat rejects with it so the
 * session can tell the pilot "this scan's files are damaged" (@gsfpv/scenes SceneError 'broken') instead
 * of a network or a generic error.
 */
export class BrokenFileError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'BrokenFileError';
    }
}

/**
 * The SOG versions the pinned engine reads: playcanvas 2.24.2 framework/parsers/sog.js loadTextures upgrades a meta.json
 * without `version` (version 1) and reads 2 and 3; any other version is its error "unsupported SOG version N". SuperSplat
 * publishes version 3 since 2026-11-10 (splat-transform 3.11); engine 2.23.2 read 1 and 2 only and never settled on a 3
 * (C:/dev/.gsfpv-lanes/designs/t7-scene-open.md). The engine pin and this list change together: the test
 * scan-sog-version.test.ts reads the engine's own parser and fails when they disagree.
 */
export const ENGINE_SOG_VERSIONS: readonly number[] = [1, 2, 3];

/**
 * A scan file in a format this simulator's engine does not read (a newer SOG version, or a format SuperSplat added):
 * not damaged and not the network. `format` names it ("SOG version 4"); the pilot is told "this scan uses a newer
 * format" with what to do next, never a loader that waits for ever.
 */
export class UnsupportedFormatError extends Error {
    readonly format: string;
    constructor(format: string, message: string) {
        super(message);
        this.format = format;
        this.name = 'UnsupportedFormatError';
    }
}

/** The SOG version of a meta.json (a single SOG or one chunk of a streamed scan): no `version` is version 1. */
export function sogVersion(meta: unknown): unknown {
    return isObject(meta) && meta.version !== undefined ? meta.version : 1;
}

/**
 * Why the engine cannot read this SOG meta.json's version ("SOG version 4"), or null when it can (ENGINE_SOG_VERSIONS).
 * Checked before the engine asset exists, so a scan SuperSplat writes in a version newer than the engine's is said
 * plainly and at once.
 */
export function sogVersionProblem(meta: unknown): string | null {
    const v = sogVersion(meta);
    return typeof v === 'number' && ENGINE_SOG_VERSIONS.includes(v) ? null : `SOG version ${JSON.stringify(v)}`;
}

/**
 * The SOG version problem of a streamed scan: lod-meta.json has its own format version (1), its chunks are SOG meta.json
 * files (a39abad1's sibling f924b0f5: chunk version 3), so the first chunk is read (one small GET through `get`, which
 * resolves to the parsed JSON) and checked like a single SOG. Null when the engine reads it, or when the chunk could not
 * be read: then the engine's own request decides (a network failure is not a format).
 */
export async function lodChunkVersionProblem(lodMetaUrl: string, lodMeta: unknown, get: (url: string) => Promise<unknown>): Promise<string | null> {
    const first = isObject(lodMeta) && Array.isArray(lodMeta.filenames) ? lodMeta.filenames[0] : undefined;
    if (typeof first !== 'string') return null;
    let chunk: unknown;
    try {
        chunk = await get(new URL(first, lodMetaUrl).toString());
    } catch {
        return null;
    }
    return sogVersionProblem(chunk);
}

/** A plain JSON object (not null, not an array). */
function isObject(x: unknown): x is Record<string, unknown> {
    return !!x && typeof x === 'object' && !Array.isArray(x);
}

/** `{ min: [x, y, z], max: [x, y, z] }` with finite numbers: a node's box as the engine reads it. */
function isBound(b: unknown): boolean {
    const v3 = (a: unknown) => Array.isArray(a) && a.length >= 3 && a.slice(0, 3).every((x) => typeof x === 'number' && Number.isFinite(x));
    return isObject(b) && v3(b.min) && v3(b.max);
}

/**
 * Why the engine cannot open this lod-meta.json, or null when it can. The engine (playcanvas 2.23
 * GSplatOctreeResource -> GSplatOctree -> GSplatOctreeNode) builds the whole octree in its constructor,
 * inside the HTTP callback of its own request. What it throws on there comes back as the asset's own
 * error ("Error loading gsplat octree: ... [TypeError ...]": its Http calls the callback inside a
 * try/catch; measured in review R2 on releases 0df437d and eef522b with a leaf that has no bound), in
 * English and only after the asset was made. Checked first, such a file is told apart as damaged
 * (BrokenFileError: the scene error 'broken' and the pilot's own text) and the scene's next content file
 * is tried before any engine asset exists (@gsfpv/scenes content.ts).
 *
 * What the engine reads, and so what is checked (tested against the engine's own constructor, lod.test.ts):
 *   - `lodLevels` (a whole number; 0 or a fraction would build an octree with no levels);
 *   - `filenames`: strings (each goes through its path helpers); `environment`, when set, a string;
 *   - `tree.bound` (the scan's box) and every node: a leaf (`lods` set) needs a `bound` with min and max of
 *     three numbers and, for each level it lists, an entry whose `file` is an index into `filenames`; an
 *     inner node's `children` must be a list of nodes. A tree without a single leaf has nothing to draw.
 * The walk is iterative (a deep tree cannot overflow the stack) and stops at the first problem.
 */
export function lodMetaProblem(json: unknown): string | null {
    if (!isObject(json)) return 'not a JSON object';
    const n = json.lodLevels;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > MAX_LOD_LEVELS) return `lodLevels ${JSON.stringify(n)} is not a whole number from 1 to ${MAX_LOD_LEVELS}`;
    const files = json.filenames;
    if (!Array.isArray(files) || files.length === 0) return 'no filenames';
    if (!files.every((f) => typeof f === 'string' && f.length > 0)) return 'a filename is not a string';
    if (json.environment && typeof json.environment !== 'string') return 'environment is not a file name';
    const tree = json.tree;
    if (!isObject(tree)) return 'no tree';
    if (!isBound(tree.bound)) return 'the tree has no bound (min and max of three numbers)';
    const stack: unknown[] = [tree];
    let leaves = 0;
    while (stack.length > 0) {
        const node = stack.pop();
        if (!isObject(node)) return 'a tree node is not an object';
        if (node.lods) {
            // a leaf: its box and, per level it lists, the file and range of its splats
            leaves++;
            if (!isObject(node.lods) && !Array.isArray(node.lods)) return 'a leaf\'s lods is not a list of levels';
            if (!isBound(node.bound)) return `leaf ${leaves} has no bound (min and max of three numbers)`;
            const lods = node.lods as Record<string, unknown>;
            for (let i = 0; i < n; i++) {
                const l = lods[String(i)];
                if (!l) continue; // a level the leaf does not have: the engine leaves it empty
                if (!isObject(l)) return `leaf ${leaves} level ${i} is not an object`;
                const f = l.file;
                if (typeof f !== 'number' || !Number.isInteger(f) || f < 0 || f >= files.length) return `leaf ${leaves} level ${i}: file ${JSON.stringify(f)} is not one of the ${files.length} filenames`;
            }
        } else if (node.children) {
            if (!Array.isArray(node.children)) return 'a node\'s children is not a list';
            for (const c of node.children) stack.push(c);
        }
        // a node with neither: the engine skips it
    }
    if (leaves === 0) return 'the tree has no leaves (nothing to draw)';
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
