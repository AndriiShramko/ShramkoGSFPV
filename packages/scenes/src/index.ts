// Scenes: parse a SuperSplat link, load everything straight from the public CDN (never through
// our server), cache collision/settings with ETag revalidation, keep history and favourites
// in the browser only, with the version folder of each republished scene.

export const CDN = 'https://d28zzqy0iyovbz.cloudfront.net';
/** Posters live in their own bucket, in the same v<N> folder as the scene. */
const POSTERS = 'https://s3-eu-west-1.amazonaws.com/images.playcanvas.com/splat';

/** Scene ids seen so far are 8 hex chars; accept 6..32 so a longer id is not rejected blindly. */
const ID_RE = /^[0-9a-f]{6,32}$/i;

/** 'unsupported': the scene exists, but in a format the simulator cannot open yet (2025 compressed PLY). */
export type SceneErrorCode = 'invalid-link' | 'not-found' | 'network' | 'blocked' | 'unsupported';

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
    /** the v<N> folder the files come from: SuperSplat bumps it on every republish */
    version: number;
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

/**
 * What one lookup learned. S3 behind the CDN answers 403 alike for a missing file, a deleted old
 * version and a private scene, so 403/404 is "no"; a 5xx, a 429 or no answer at all is "unknown".
 */
type Seen = 'yes' | 'no' | 'unknown';

function seen(status: number): Seen {
    if (status >= 200 && status < 300) return 'yes';
    return status === 403 || status === 404 ? 'no' : 'unknown';
}

/** Two tries: one dropped request must not read as "no walls" or "does not exist". */
async function twice<T extends { seen: Seen }>(attempt: () => Promise<T>, silent: T): Promise<T> {
    let last = silent;
    for (let i = 0; i < 2; i++) {
        try {
            last = await attempt();
            if (last.seen !== 'unknown') return last;
        } catch {
            last = silent;
        }
    }
    return last;
}

async function exists(url: string, f: FetchLike): Promise<Seen> {
    // HEAD, not a ranged GET: 360 of the 2,934 streamed scenes store lod-meta.json gzip/br-encoded, and
    // one byte of such a stream makes Chrome fail the whole fetch (ERR_CONTENT_DECODING_FAILED), so those
    // scenes read as "no content". HEAD is CORS-safelisted; the CDN answers it with the same 200/403 and ACAO *.
    const x = await twice(async () => ({ seen: seen((await f(url, { method: 'HEAD' })).status) }), { seen: 'unknown' as Seen });
    return x.seen;
}

/**
 * SuperSplat keeps a scene under <id>/v<N>/ and bumps N on every republish; the current folder is the
 * highest one. The API that names N answers only superspl.at (CORS), so the CDN is asked window by
 * window. Old folders are usually deleted, not always: 18 of the 830 republished public scenes kept
 * some, at most 3 versions below the current one and never above it. So the search stops once the
 * highest folder found has CLEAR empty versions above it. Census of all 15,836 public scenes on
 * 2026-09-25: 94.8% v1, 99.5% v4 or lower, the highest v28. A scene that is not there costs 64 small 403s.
 */
export const VERSION_WINDOWS: ReadonlyArray<readonly [number, number]> = [[1, 5], [6, 12], [13, 32], [33, 64]];
const CLEAR = 4;

type Probe = { v: number; seen: Seen; r?: Response };

function probeSettings(id: string, v: number, f: FetchLike): Promise<Probe> {
    return twice(async () => {
        const r = await cachedFetch(`${CDN}/${id}/v${v}/settings.json`, f);
        const s = seen(r.status);
        return s === 'yes' ? { v, seen: s, r } : { v, seen: s };
    }, { v, seen: 'unknown' });
}

/** The current version and its settings; `onFound` hears each new best so its files can be asked early. */
async function findVersion(id: string, f: FetchLike, onFound: (v: number) => void): Promise<{ v: number; r: Response }> {
    let best: { v: number; r: Response } | null = null;
    let unsure = false;
    for (const [lo, hi] of VERSION_WINDOWS) {
        const vs = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
        for (const p of await Promise.all(vs.map((v) => probeSettings(id, v, f)))) {
            if (p.r) best = { v: p.v, r: p.r }; // ascending: the last hit is the highest
            else if (p.seen === 'unknown') unsure = true;
        }
        // a version that stayed silent above the best one is taken as absent: an older edit of the
        // scene (it takes a leftover folder AND a failed request) beats refusing a scene that loads
        if (best) {
            onFound(best.v);
            if (hi - best.v >= CLEAR) return best;
        }
    }
    if (best) return best;
    if (unsure) throw new SceneError('network', `scene ${id}: the CDN did not answer for every version`);
    throw new SceneError('not-found', `scene ${id} not found`);
}

export async function resolveScene(id: string, f: FetchLike = fetch, blocked: string[] = []): Promise<ResolvedScene> {
    if (!ID_RE.test(id)) throw new SceneError('invalid-link', `not a scene id: ${id}`);
    if (blocked.includes(id)) throw new SceneError('blocked', `scene ${id} was taken down on request`);
    const files = (v: number) => {
        const dir = `${CDN}/${id}/v${v}`;
        return {
            lod: `${dir}/lod-meta.json`,
            meta: `${dir}/meta.json`,
            ply: `${dir}/scene.compressed.ply`,
            // walls from the CDN, not S3: the same objects (ETag, sha256) with the same CORS and 304s,
            // 0.2-0.6 s for 15-19 MB where S3 took up to 19 s
            walls: `${dir}/scene.voxel.json`
        };
    };
    // what a folder holds does not depend on the search: ask v1 (95% of scenes) at once and any other
    // version the moment it is found. lod-meta and meta together: 62% of scenes are meta-only.
    const asked = new Map<number, Promise<[Seen, Seen, Seen]>>();
    const ask = (v: number): Promise<[Seen, Seen, Seen]> => {
        let p = asked.get(v);
        if (!p) {
            const at = files(v);
            p = Promise.all([exists(at.lod, f), exists(at.meta, f), exists(at.walls, f)]);
            asked.set(v, p);
        }
        return p;
    };
    void ask(1);
    const { v, r } = await findVersion(id, f, (found) => { void ask(found); });
    const at = files(v);
    const [lod, meta, walls] = await ask(v);
    let contentUrl: string;
    let contentKind: 'lod-meta' | 'meta';
    if (lod === 'yes') {
        contentUrl = at.lod;
        contentKind = 'lod-meta';
    } else if (meta === 'yes') {
        contentUrl = at.meta;
        contentKind = 'meta';
    } else if (lod === 'unknown' || meta === 'unknown') {
        throw new SceneError('network', `scene ${id} v${v}: the CDN did not say which format it is`);
    } else if ((await exists(at.ply, f)) === 'yes') {
        // 2025 uploads (19% of the catalogue): the engine parses PLY, but bake and load progress know only lod-meta/meta
        throw new SceneError('unsupported', `scene ${id} v${v} is a legacy compressed PLY, not supported yet`);
    } else {
        throw new SceneError('not-found', `scene ${id} v${v} has no splat content on the CDN`);
    }
    const settings = (await r.json()) as Record<string, unknown>;
    rememberVersion(id, v);
    const bg = (settings.background as { color?: number[] } | undefined)?.color;
    return {
        id,
        version: v,
        settings,
        camera: readCamera(settings),
        contentUrl,
        contentKind,
        // "unknown" is worth a try: the walls loader reads a 403 as "no walls" and a real failure as one
        collisionUrl: walls === 'no' ? null : at.walls,
        background: bg,
        tonemapping: typeof settings.tonemapping === 'string' ? settings.tonemapping : undefined
    };
}

/** Poster image of a scene; it sits in the scene's current v<N> folder like the splats. */
export function posterUrl(id: string, size: 'm' | 'l' | 'xl' = 'm', version: number = knownVersion(id)): string {
    return `${POSTERS}/${id}/v${version}/${size}.webp`;
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
const KEY_FAV = 'gsfpv.favourites.v1'; // gitleaks:allow (a localStorage key name, not a secret)
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

const KEY_VERSIONS = 'gsfpv.versions.v1';
const MAX_VERSIONS = 200;

function readVersions(): Array<[string, number]> {
    const all = readJson<unknown>(KEY_VERSIONS, []);
    return Array.isArray(all) ? all.filter((e): e is [string, number] => Array.isArray(e) && typeof e[0] === 'string' && Number.isInteger(e[1])) : [];
}

/** The v<N> folder a scene was last resolved to here; 1 for the 95% never republished. */
export function knownVersion(id: string): number {
    const v = readVersions().find((e) => e[0] === id)?.[1] ?? 1;
    return v > 1 ? v : 1;
}

/** Only republished scenes get an entry, newest first, so recent and favourite posters find their folder. */
function rememberVersion(id: string, v: number): void {
    if (knownVersion(id) === v) return;
    const rest = readVersions().filter((e) => e[0] !== id);
    writeJson(KEY_VERSIONS, (v > 1 ? [[id, v], ...rest] : rest).slice(0, MAX_VERSIONS));
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
