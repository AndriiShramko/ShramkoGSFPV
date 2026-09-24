// Scenes: parse a SuperSplat link, load everything straight from the public CDN (never through
// our server), cache collision/settings with ETag revalidation, keep history and favourites
// in the browser only.

export const CDN = 'https://d28zzqy0iyovbz.cloudfront.net';
export const S3 = 'https://s3-eu-west-1.amazonaws.com/splats.playcanvas.com';

/** Scene ids seen so far are 8 hex chars; accept 6..32 so a longer id is not rejected blindly. */
const ID_RE = /^[0-9a-f]{6,32}$/i;

export type SceneErrorCode = 'invalid-link' | 'not-found' | 'network' | 'blocked';

export class SceneError extends Error {
    code: SceneErrorCode;
    constructor(code: SceneErrorCode, message: string) {
        super(message);
        this.code = code;
        this.name = 'SceneError';
    }
}

/**
 * Accepts: https://superspl.at/scene/<id>, https://superspl.at/s?id=<id>, or a bare id.
 * Returns the lower-case id or null.
 */
export function parseSceneInput(raw: string): string | null {
    const s = raw.trim();
    if (ID_RE.test(s)) return s.toLowerCase();
    let u: URL;
    try {
        u = new URL(s.includes('://') ? s : `https://${s}`);
    } catch {
        return null;
    }
    const host = u.hostname.toLowerCase();
    if (host !== 'superspl.at' && host !== 'www.superspl.at') return null;
    const m = u.pathname.match(/^\/scene\/([0-9a-f]+)\/?$/i);
    if (m && ID_RE.test(m[1])) return m[1].toLowerCase();
    if (u.pathname === '/s' || u.pathname === '/s/') {
        const id = u.searchParams.get('id');
        if (id && ID_RE.test(id)) return id.toLowerCase();
    }
    return null;
}

export interface SceneCamera {
    position: [number, number, number];
    target: [number, number, number];
    fov: number;
}

export interface ResolvedScene {
    id: string;
    settings: Record<string, unknown>;
    camera: SceneCamera | null;
    contentUrl: string;
    contentKind: 'lod-meta' | 'meta';
    collisionUrl: string | null;
    background: number[] | undefined;
    tonemapping: string | undefined;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const CACHE = 'gsfpv-scenes-v1';

/**
 * GET with Cache Storage + If-None-Match revalidation (S3 sends no-cache but exposes ETag).
 * Falls back to a plain fetch where Cache Storage is unavailable.
 */
export async function cachedFetch(url: string, f: FetchLike = fetch): Promise<Response> {
    let cache: Cache | null = null;
    try {
        cache = typeof caches !== 'undefined' ? await caches.open(CACHE) : null;
    } catch {
        cache = null;
    }
    const hit = cache ? await cache.match(url) : undefined;
    const etag = hit?.headers.get('etag');
    let r: Response;
    try {
        r = await f(url, etag ? { headers: { 'If-None-Match': etag } } : undefined);
    } catch (e) {
        if (hit) return hit;
        throw new SceneError('network', `network error loading ${url}: ${String(e)}`);
    }
    if (r.status === 304 && hit) return hit;
    if (r.ok && cache) {
        try { await cache.put(url, r.clone()); } catch { /* quota / opaque */ }
    }
    return r;
}

function num3(v: unknown): [number, number, number] | null {
    return Array.isArray(v) && v.length >= 3 && v.every((x) => typeof x === 'number') ? [v[0], v[1], v[2]] : null;
}

function readCamera(settings: Record<string, unknown>): SceneCamera | null {
    // settings v2: cameras[0].initial; v1: camera
    const cams = settings.cameras as Array<{ initial?: Record<string, unknown> }> | undefined;
    const c = (cams?.[0]?.initial ?? settings.camera) as Record<string, unknown> | undefined;
    if (!c) return null;
    const position = num3(c.position);
    const target = num3(c.target);
    if (!position || !target) return null;
    return { position, target, fov: typeof c.fov === 'number' ? c.fov : 90 };
}

async function exists(url: string, f: FetchLike): Promise<boolean> {
    // a ranged GET is cheap and, unlike HEAD, is what the CDN is configured for
    try {
        const r = await f(url, { headers: { Range: 'bytes=0-0' } });
        return r.ok || r.status === 206;
    } catch {
        return false;
    }
}

export async function resolveScene(id: string, f: FetchLike = fetch, blocked: string[] = []): Promise<ResolvedScene> {
    if (!ID_RE.test(id)) throw new SceneError('invalid-link', `not a scene id: ${id}`);
    if (blocked.includes(id)) throw new SceneError('blocked', `scene ${id} was taken down on request`);
    const sUrl = `${CDN}/${id}/v1/settings.json`;
    const lod = `${CDN}/${id}/v1/lod-meta.json`;
    const meta = `${CDN}/${id}/v1/meta.json`;
    const colJson = `${S3}/${id}/v1/scene.voxel.json`;
    // the three lookups are independent: run them together
    const [sr, hasLod, hasCollision] = await Promise.all([cachedFetch(sUrl, f), exists(lod, f), exists(colJson, f)]);
    if (sr.status === 403 || sr.status === 404) throw new SceneError('not-found', `scene ${id} not found`);
    if (!sr.ok) throw new SceneError('network', `settings ${sr.status}`);
    const settings = (await sr.json()) as Record<string, unknown>;
    let contentUrl = lod;
    let contentKind: 'lod-meta' | 'meta' = 'lod-meta';
    if (!hasLod) {
        if (await exists(meta, f)) {
            contentUrl = meta;
            contentKind = 'meta';
        } else {
            throw new SceneError('not-found', `scene ${id} has no splat content on the CDN`);
        }
    }
    const bg = (settings.background as { color?: number[] } | undefined)?.color;
    return {
        id,
        settings,
        camera: readCamera(settings),
        contentUrl,
        contentKind,
        collisionUrl: hasCollision ? colJson : null,
        background: bg,
        tonemapping: typeof settings.tonemapping === 'string' ? settings.tonemapping : undefined
    };
}

// ---------------- history, favourites, filter (browser storage, try/catch) ----------------

export interface HistoryEntry {
    id: string;
    title?: string;
    lastFlown: number;
    flights: number;
    hasCollision: boolean | null;
}

const KEY_HISTORY = 'gsfpv.history.v1';
const KEY_FAV = 'gsfpv.favourites.v1';
const KEY_FILTER = 'gsfpv.filter.v1';

function readJson<T>(key: string, fallback: T): T {
    try {
        const s = localStorage.getItem(key);
        return s ? (JSON.parse(s) as T) : fallback;
    } catch {
        return fallback;
    }
}

function writeJson(key: string, v: unknown): void {
    try {
        localStorage.setItem(key, JSON.stringify(v));
    } catch {
        /* private mode / quota */
    }
}

export function getHistory(): HistoryEntry[] {
    return readJson<HistoryEntry[]>(KEY_HISTORY, []);
}

export function recordOpen(id: string, hasCollision: boolean | null, title?: string): void {
    const h = getHistory();
    const i = h.findIndex((e) => e.id === id);
    const e: HistoryEntry = i >= 0 ? h[i] : { id, lastFlown: 0, flights: 0, hasCollision };
    e.lastFlown = Date.now();
    e.hasCollision = hasCollision ?? e.hasCollision;
    if (title) e.title = title;
    if (i >= 0) h.splice(i, 1);
    h.unshift(e);
    writeJson(KEY_HISTORY, h.slice(0, 100));
}

export function recordFlight(id: string): void {
    const h = getHistory();
    const e = h.find((x) => x.id === id);
    if (e) {
        e.flights++;
        writeJson(KEY_HISTORY, h);
    }
}

export function getFavourites(): string[] {
    return readJson<string[]>(KEY_FAV, []);
}

export function toggleFavourite(id: string): boolean {
    const f = getFavourites();
    const i = f.indexOf(id);
    if (i >= 0) f.splice(i, 1); else f.unshift(id);
    writeJson(KEY_FAV, f);
    return i < 0;
}

export interface SceneFilter {
    collisionOnly: boolean;
    kind: 'all' | 'interior' | 'exterior';
    flown: 'all' | 'flown' | 'new';
    maxMb: number | null;
}

export const DEFAULT_FILTER: SceneFilter = { collisionOnly: true, kind: 'all', flown: 'all', maxMb: null };

export function getFilter(): SceneFilter {
    return { ...DEFAULT_FILTER, ...readJson<Partial<SceneFilter>>(KEY_FILTER, {}) };
}

export function setFilter(f: SceneFilter): void {
    writeJson(KEY_FILTER, f);
}

/** Spawn heading (deg, right-turn positive, 0 = -z) from the authored camera. */
export function headingFromCamera(c: SceneCamera): number {
    const fx = c.target[0] - c.position[0];
    const fz = c.target[2] - c.position[2];
    return (Math.atan2(fx, -fz) * 180) / Math.PI;
}
