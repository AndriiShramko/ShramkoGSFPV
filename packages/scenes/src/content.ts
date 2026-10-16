// What a SuperSplat scene folder holds for drawing, and in which order the simulator opens it (v0.8
// lane C, the owner's item 8). Pure: no fetch, no DOM.
//
// SuperSplat publishes a scene's splats as one of these files in its CDN folder <id>/v<N>/:
//   - lod-meta.json  streamed SOG ("ssog"): an octree of SOG files in several levels of detail; the
//                    engine streams the levels the view needs (the scene's own LOD);
//   - meta.json      one SOG file ("sog"/"sogs"): everything at once, no levels;
//   - scene.compressed.ply  the 2025 format, not supported (resolveScene says 'unsupported').
// The best file comes first: levels of detail on every device (SuperSplat's viewer streams lod-meta.json
// on phones too, with a smaller splat budget: @gsfpv/render-pc drawing.ts). SuperSplat is moving its
// uploads to streamed SOG (2026-10-16: 25 of the 48 newest public scenes) and a folder may one day hold
// both files; then the session opens lod-meta.json and keeps meta.json as the fallback for a broken
// lod-meta.json. A new file name SuperSplat introduces is one more row of CONTENT_FILES, best first.

/** How the renderer opens a content file (render-pc SplatRenderer.loadSplat reads the file name). */
export type ContentKind = 'lod-meta' | 'meta';

/** The content files of a scene folder, best first. */
export const CONTENT_FILES: ReadonlyArray<{ readonly file: string; readonly kind: ContentKind }> = [
    { file: 'lod-meta.json', kind: 'lod-meta' },
    { file: 'meta.json', kind: 'meta' }
];

/**
 * What the CDN said about one file: 'yes' (2xx), 'no' (403/404: S3 answers 403 for a missing file) or
 * 'unknown' (a 5xx, a 429, or no answer twice).
 */
export type ContentSeen = 'yes' | 'no' | 'unknown';

/** One file the session may open, in the order it tries them. */
export interface SceneContent {
    url: string;
    kind: ContentKind;
    /** the CDN confirmed the file (false: its lookup did not answer; it is tried, then the next one) */
    verified: boolean;
}

/**
 * The files to try, best first: every file the CDN did not deny, in CONTENT_FILES order, but only when
 * at least one of them is confirmed. A confirmed lod-meta.json comes before meta.json; an unconfirmed
 * one too (a dropped lookup must not silently cost a scene its levels of detail: the session falls back
 * to meta.json when it does not open). Empty when nothing is confirmed: the caller decides between "the
 * CDN did not answer" and "no content" (resolveScene).
 */
export function contentOrder(dir: string, seen: Readonly<Record<ContentKind, ContentSeen>>): SceneContent[] {
    const base = dir.endsWith('/') ? dir : `${dir}/`;
    if (!CONTENT_FILES.some((c) => seen[c.kind] === 'yes')) return [];
    return CONTENT_FILES
        .filter((c) => seen[c.kind] !== 'no')
        .map((c) => ({ url: `${base}${c.file}`, kind: c.kind, verified: seen[c.kind] === 'yes' }));
}

