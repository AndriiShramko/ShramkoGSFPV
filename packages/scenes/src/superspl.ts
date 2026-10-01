// SuperSplat catalogue: the list superspl.at shows, with the same filters, for the scene picker.
// Owner's decision 2026-09-27 (docs/decisions.md D35). PlayCanvas' explore API answers CORS only for
// superspl.at, so the browser asks OUR caching proxy, GET /api/superspl/explore (apps/api/server.py),
// never PlayCanvas itself. Scenes are still loaded from the public CDN by resolveScene().
// Pure: no DOM globals. fetch, the session store, the clock and the RNG are injected.

export type ExploreSort = 'trending' | 'createdAt' | 'views' | 'starred' | 'size';
export type ExploreOrder = 1 | -1;
export type ExploreTime = 'all' | 'year' | 'month' | 'week' | 'day';
export type ExploreFeature = 'walkable' | 'downloadable';

export const EXPLORE_SORTS: readonly ExploreSort[] = ['trending', 'createdAt', 'views', 'starred', 'size'];
export const EXPLORE_TIMES: readonly ExploreTime[] = ['all', 'year', 'month', 'week', 'day'];
/** In the upstream's own order: requests list them this way, so equal filters share one cache entry. */
export const EXPLORE_FEATURES: readonly ExploreFeature[] = ['walkable', 'downloadable'];
/** The proxy's whitelist bounds (the proxy refuses anything outside them with a 400). */
export const EXPLORE_BOUNDS = { searchChars: 80, skipMax: 10000, limitMax: 48 } as const;

export interface ExploreQuery {
    sort: ExploreSort;
    order: ExploreOrder;
    /** 'all' when omitted; trending is always all-time (superspl.at forces it) */
    time?: ExploreTime;
    features?: ExploreFeature[];
    /** free text; superspl.at ignores one letter and strips < and > */
    search?: string;
    skip: number;
    limit: number;
}

/** A query with every field present, in the proxy's canonical form. */
export type NormalQuery = Required<ExploreQuery>;

export interface ExploreThumbs {
    s: string | null;
    m: string | null;
    l: string | null;
    xl: string | null;
    /** animated preview (webp) */
    mov: string | null;
}

export interface ExploreItem {
    id: string;
    /** the CDN folder v<N> the scene lives in now (resolveScene finds the same one) */
    version: number;
    title: string;
    author: string;
    /** SuperSplat licence code (by, by-sa, by-nd, by-nc, by-nc-sa, by-nc-nd) or null when downloads are off */
    license: string | null;
    downloadable: boolean;
    /** SuperSplat has no ratings: likes ("starred") are the rating */
    likes: number;
    views: number;
    sizeBytes: number;
    /** medium poster: the API's, else the S3 pattern for id + version */
    thumb: string;
    thumbs: ExploreThumbs;
    createdAt: string | null;
    /** at most 300 characters */
    description: string;
    /** storage format as the API names it ('sog', 'ssog', 'compressed.ply', ...; '' when unknown) */
    format: string;
    /** true when the page was asked with features=walkable (SuperSplat then has a collision file); null when not asked */
    walkable: boolean | null;
}

export interface ExplorePage {
    query: NormalQuery;
    /** scenes matching the filters on SuperSplat, over all pages */
    total: number;
    items: ExploreItem[];
    /** when our proxy read it from SuperSplat (ms since epoch) */
    fetchedAt: number;
    /** 'session': from this tab's cache; 'network': from the proxy */
    from: 'network' | 'session';
    /** the proxy's cache state for a network answer; 'stale' = SuperSplat was busy or down, an older copy */
    proxy: 'hit' | 'miss' | 'stale' | null;
}

export type SuperSplatErrorCode = 'disabled' | 'bad-query' | 'rate-limited' | 'busy' | 'upstream' | 'network' | 'bad-response';

export class SuperSplatError extends Error {
    code: SuperSplatErrorCode;
    status: number | null;
    /** seconds, when the proxy said how long to wait */
    retryAfterS: number | null;
    constructor(code: SuperSplatErrorCode, message: string, status: number | null = null, retryAfterS: number | null = null) {
        super(message);
        this.name = 'SuperSplatError';
        this.code = code;
        this.status = status;
        this.retryAfterS = retryAfterS;
    }
}

const POSTERS = 'https://s3-eu-west-1.amazonaws.com/images.playcanvas.com/splat';
const ID_RE = /^[0-9a-f]{6,32}$/;
// Cc (C0, DEL, C1) and lone surrogates: the proxy refuses them
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;

function bad(msg: string): never {
    throw new SuperSplatError('bad-query', msg);
}

function whole(v: unknown, name: string, lo: number, hi: number, dflt: number): number {
    if (v === undefined) return dflt;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < lo || v > hi) bad(`${name} must be an integer ${lo}..${hi}`);
    return v;
}

/**
 * superspl.at's search rule, plus what the proxy needs: control characters and < > removed, whitespace
 * runs become one space, at most 80 characters (code points, never half a pair), one letter = no search.
 */
export function cleanSearch(raw: string): string {
    const s = raw.replace(CONTROL_RE, ' ').replace(/[<>]/g, '').split(/\s+/).filter(Boolean).join(' ');
    const cut = Array.from(s).slice(0, EXPLORE_BOUNDS.searchChars).join('').trim();
    return Array.from(cut).length > 1 ? cut : '';
}

/** Fills defaults and checks every field; throws SuperSplatError('bad-query') on a value the proxy would refuse. */
export function normalizeQuery(q: Partial<ExploreQuery>): NormalQuery {
    const sort = q.sort ?? 'trending';
    if (!EXPLORE_SORTS.includes(sort)) bad(`sort must be one of ${EXPLORE_SORTS.join('|')}`);
    const order = q.order ?? -1;
    if (order !== 1 && order !== -1) bad('order must be 1 or -1');
    let time = q.time ?? 'all';
    if (!EXPLORE_TIMES.includes(time)) bad(`time must be one of ${EXPLORE_TIMES.join('|')}`);
    if (sort === 'trending') time = 'all';
    const want = q.features ?? [];
    for (const f of want) if (!EXPLORE_FEATURES.includes(f)) bad(`features must be a subset of ${EXPLORE_FEATURES.join(',')}`);
    return {
        sort,
        order,
        time,
        features: EXPLORE_FEATURES.filter((f) => want.includes(f)),
        search: cleanSearch(q.search ?? ''),
        skip: whole(q.skip, 'skip', 0, EXPLORE_BOUNDS.skipMax, 0),
        limit: whole(q.limit, 'limit', 1, EXPLORE_BOUNDS.limitMax, 32)
    };
}

/** The proxy's query string for a normalized query: fixed order, so one page has one cache key. */
export function exploreQueryString(n: NormalQuery): string {
    const p = new URLSearchParams();
    p.set('sort', n.sort);
    p.set('order', String(n.order));
    p.set('time', n.time);
    if (n.features.length) p.set('features', n.features.join(','));
    if (n.search) p.set('search', n.search);
    p.set('skip', String(n.skip));
    p.set('limit', String(n.limit));
    return p.toString();
}

// superspl.at's sort menu (bundle TopNavSearchContext-*.js, read 2026-09-27): UI key -> API sort/order.
// Pairs without a menu entry (views/likes/trending ascending) open the descending list.
const UI_SORT: Record<string, string> = {
    'trending:-1': 'trending', 'trending:1': 'trending',
    'createdAt:-1': 'newest', 'createdAt:1': 'oldest',
    'views:-1': 'views', 'views:1': 'views',
    'starred:-1': 'likes', 'starred:1': 'likes',
    'size:-1': 'largest', 'size:1': 'smallest'
};

/**
 * The same list on superspl.at, for an "Open on SuperSplat" link. Its /search page reads `q`, `sort`
 * (its own menu keys), `time` (absent = past month, so it is always written except for trending, which
 * is all-time) and `features`. Paging is not part of their URL.
 */
export function supersplSearchUrl(q: Partial<ExploreQuery> = {}): string {
    const n = normalizeQuery({ ...q, skip: undefined, limit: undefined });
    const parts: string[] = [];
    if (n.search) parts.push(`q=${encodeURIComponent(n.search)}`);
    parts.push(`sort=${UI_SORT[`${n.sort}:${n.order}`]}`);
    if (n.sort !== 'trending') parts.push(`time=${n.time}`);
    if (n.features.length) parts.push(`features=${n.features.join(',')}`);
    return `https://superspl.at/search?${parts.join('&')}`;
}

// ---------------- reading the proxy's answer ----------------

function str(v: unknown, max: number): string {
    return typeof v === 'string' ? v.slice(0, max) : '';
}

function count(v: unknown): number {
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
}

function url(v: unknown): string | null {
    return typeof v === 'string' && v.startsWith(`${POSTERS}/`) ? v : null;
}

function readItem(x: unknown, walkable: boolean | null): ExploreItem | null {
    if (!x || typeof x !== 'object') return null;
    const o = x as Record<string, unknown>;
    if (typeof o.id !== 'string' || !ID_RE.test(o.id)) return null;
    const version = typeof o.version === 'number' && Number.isInteger(o.version) && o.version >= 1 ? o.version : 1;
    const t = (o.thumbs && typeof o.thumbs === 'object' ? o.thumbs : {}) as Record<string, unknown>;
    const thumbs: ExploreThumbs = { s: url(t.s), m: url(t.m), l: url(t.l), xl: url(t.xl), mov: url(t.mov) };
    return {
        id: o.id,
        version,
        title: str(o.title, 200),
        author: str(o.author, 64),
        license: typeof o.license === 'string' && o.license ? o.license : null,
        downloadable: o.downloadable === true,
        likes: count(o.likes),
        views: count(o.views),
        sizeBytes: count(o.sizeBytes),
        thumb: thumbs.m ?? `${POSTERS}/${o.id}/v${version}/m.webp`,
        thumbs,
        createdAt: typeof o.createdAt === 'string' ? o.createdAt : null,
        description: str(o.description, 300),
        format: str(o.format, 24),
        walkable
    };
}

function readPage(raw: unknown, n: NormalQuery): Omit<ExplorePage, 'from' | 'proxy'> {
    const o = raw as Record<string, unknown> | null;
    if (!o || o.ok !== true || !Array.isArray(o.items)) throw new SuperSplatError('bad-response', 'the catalogue answer has no item list');
    const walkable = n.features.includes('walkable') ? true : null;
    const items = o.items.map((x) => readItem(x, walkable)).filter((x): x is ExploreItem => x !== null);
    const fetchedS = typeof o.fetchedAt === 'number' && Number.isFinite(o.fetchedAt) ? o.fetchedAt : 0;
    return { query: n, total: typeof o.total === 'number' ? count(o.total) : n.skip + items.length, items, fetchedAt: fetchedS * 1000 };
}

// ---------------- the catalogue ----------------

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** The subset of the Web Storage API used here (pass the page's session storage; a Map-backed one is the default). */
export interface CatalogStore {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

export class MemoryStore implements CatalogStore {
    private m = new Map<string, string>();
    getItem(k: string): string | null {
        return this.m.get(k) ?? null;
    }
    setItem(k: string, v: string): void {
        this.m.set(k, v);
    }
    removeItem(k: string): void {
        this.m.delete(k);
    }
}

export interface CatalogOptions {
    /** false: every call rejects with 'disabled' and nothing is asked (the picker's feature flag) */
    enabled?: boolean;
    fetch?: FetchLike;
    /** where the proxy is; default the site's own `/api/superspl` */
    base?: string;
    /** this tab's cache: pass the page's session storage; default in memory only */
    store?: CatalogStore;
    /** at most this long in the tab's cache; the proxy's max-age shortens it, no max-age means not kept (default 10 min) */
    ttlMs?: number;
    now?: () => number;
    /** pages kept in the store, oldest dropped first (default 40, about 1-2 MB) */
    maxStored?: number;
}

const PREFIX = 'gsfpv.superspl.v1:';
const INDEX = `${PREFIX}index`;
export const CATALOG_TTL_MS = 10 * 60 * 1000;

interface Stored {
    exp: number;
    page: Omit<ExplorePage, 'from' | 'proxy'>;
}

export type RandomOptions = Omit<PickOptions, 'rng'> & { rng?: () => number } & TopRatedOptions & {
    /**
     * Without it, a scene whose format the API does not name (formatVerdict 'unknown', e.g. '') is never
     * picked. With it, such a scene may be drawn, and is returned only when the check says 'yes'; 'no' or
     * 'unknown' rules it out and the draw is repeated. 'yes' / 'no' are remembered by this catalogue per
     * scene version. A check built on resolveScene (index.ts) fits: it rejects a legacy PLY with
     * 'unsupported'. This file itself asks only the proxy (D35), so the check is the caller's.
     */
    check?: OpensCheck;
};

export interface TopRatedOptions {
    /** how many scenes (default 200: the owner's "top 200 walkable by likes, all time", E.5) */
    size?: number;
    /** scenes per request (default 40: 5 requests for 200) */
    pageSize?: number;
    /** default ['walkable']: scenes with a collision file */
    features?: ExploreFeature[];
}

export class SuperSplatCatalog {
    readonly enabled: boolean;
    private readonly f: FetchLike;
    private readonly base: string;
    private readonly store: CatalogStore;
    private readonly ttlMs: number;
    private readonly now: () => number;
    private readonly maxStored: number;
    private readonly inflight = new Map<string, Promise<ExplorePage>>();
    /** RandomOptions.check verdicts, per `<id>/v<version>` */
    private readonly opensSeen = new Map<string, 'yes' | 'no'>();

    constructor(o: CatalogOptions = {}) {
        this.enabled = o.enabled ?? true;
        this.f = o.fetch ?? ((u, i) => globalThis.fetch(u, i));
        this.base = (o.base ?? '/api/superspl').replace(/\/+$/, '');
        this.store = o.store ?? new MemoryStore();
        this.ttlMs = o.ttlMs ?? CATALOG_TTL_MS;
        this.now = o.now ?? (() => Date.now());
        this.maxStored = Math.max(1, o.maxStored ?? 40);
    }

    /** The proxy URL of a query (normalized). */
    url(q: Partial<ExploreQuery>): string {
        return `${this.base}/explore?${exploreQueryString(normalizeQuery(q))}`;
    }

    /**
     * One page of the list. From this tab's cache while it is fresh, else from the proxy; the same page asked
     * again while its request is open shares that request.
     */
    explore(q: Partial<ExploreQuery>): Promise<ExplorePage> {
        if (!this.enabled) return Promise.reject(new SuperSplatError('disabled', 'the SuperSplat catalogue is switched off'));
        let n: NormalQuery;
        try {
            n = normalizeQuery(q);
        } catch (e) {
            return Promise.reject(e);
        }
        const qs = exploreQueryString(n);
        const cached = this.read(qs);
        if (cached) return Promise.resolve({ ...cached, from: 'session', proxy: null });
        let p = this.inflight.get(qs);
        if (!p) {
            p = this.load(qs, n).finally(() => this.inflight.delete(qs));
            this.inflight.set(qs, p);
        }
        return p;
    }

    /**
     * The best-liked scenes, all time, asked page by page (one request at a time, so the proxy's bucket
     * and this visitor's limit see a trickle), without duplicates, best first. Every visitor asks the same
     * pages, so the proxy answers them from its cache: about 5 upstream calls per 10 min in total.
     * A failure after the first page returns what was read; a failure of the first page rejects.
     */
    async topRated(o: TopRatedOptions = {}): Promise<ExploreItem[]> {
        const pages = this.topPages(o);
        const seen = new Map<string, ExploreItem>();
        for (let r = await pages.next(); !r.done; r = await pages.next()) for (const it of r.value) if (!seen.has(it.id)) seen.set(it.id, it);
        return [...seen.values()].sort(byRating).slice(0, Math.max(1, Math.floor(o.size ?? 200)));
    }

    /**
     * A random scene among the best-liked (see pickRandomTopRated), reading only as many pages as it needs:
     * the best tier is on the first page, so one request usually does (about 0.6 s cold, measured); the next
     * page is read only when every complete tier read so far is used up (flown recently, broken, on screen).
     */
    async randomTopRated(o: RandomOptions = {}): Promise<PickResult | null> {
        const tierSize = Math.max(1, Math.floor(o.tierSize ?? 20));
        const check = o.isBroken ? undefined : o.check; // a caller's own isBroken rule replaces the format rule
        const ruledOut = new Set<string>(o.broken ?? []);
        const verdictOf = (it: ExploreItem) => this.opensSeen.get(`${it.id}/v${it.version}`);
        const isBroken = o.isBroken ?? ((it: ExploreItem) => {
            const v = formatVerdict(it.format);
            return v === 'unsupported' || (v === 'unknown' && (!check || verdictOf(it) === 'no'));
        });
        const opts: PickOptions = { ...o, rng: o.rng ?? Math.random, broken: ruledOut, isBroken };
        const pool = new Map<string, ExploreItem>();
        // draws again while the pick is a scene of unknown format that the check does not confirm
        const draw = async (counts: (p: PickResult) => boolean): Promise<PickResult | null> => {
            for (;;) {
                const pick = pickRandomTopRated([...pool.values()], opts);
                if (!pick || !counts(pick) || !check || formatVerdict(pick.item.format) !== 'unknown') return pick;
                const key = `${pick.item.id}/v${pick.item.version}`;
                let seen = this.opensSeen.get(key);
                if (!seen) {
                    const v = await check(pick.item).catch(() => 'unknown' as const);
                    if (v !== 'unknown') this.opensSeen.set(key, v);
                    seen = v === 'unknown' ? undefined : v;
                }
                if (seen === 'yes') return pick;
                ruledOut.add(pick.item.id); // a legacy PLY, or no clear answer: not this time
            }
        };
        const pages = this.topPages(o);
        // a pick counts only from a tier that is complete in what was read (the pages come best first)
        const complete = (p: PickResult) => !p.relaxed && (p.tier + 1) * tierSize <= pool.size;
        for (let r = await pages.next(); !r.done; r = await pages.next()) {
            for (const it of r.value) if (!pool.has(it.id)) pool.set(it.id, it);
            const pick = await draw(complete);
            if (pick && complete(pick)) return pick;
        }
        return draw(() => true);
    }

    /** Pages of the best-liked list, best first; stops at the end, and after a failure past the first page. */
    private async *topPages(o: TopRatedOptions): AsyncGenerator<ExploreItem[]> {
        const size = Math.max(1, Math.floor(o.size ?? 200));
        const pageSize = Math.min(EXPLORE_BOUNDS.limitMax, Math.max(1, Math.floor(o.pageSize ?? 40)));
        for (let skip = 0; skip < size && skip <= EXPLORE_BOUNDS.skipMax; skip += pageSize) {
            const limit = Math.min(pageSize, size - skip);
            let page: ExplorePage;
            try {
                page = await this.explore({ sort: 'starred', order: -1, time: 'all', features: o.features ?? ['walkable'], skip, limit });
            } catch (e) {
                if (skip === 0) throw e;
                return;
            }
            yield page.items;
            if (page.items.length < limit || skip + limit >= page.total) return;
        }
    }

    /** Forget every page this catalogue stored. */
    clear(): void {
        for (const k of this.index()) this.remove(k);
        this.tryStore(() => this.store.removeItem(INDEX));
    }

    private async load(qs: string, n: NormalQuery): Promise<ExplorePage> {
        let r: Response;
        try {
            // credentials: 'omit' - the proxy needs no cookie and nginx would drop it anyway.
            // cache: 'no-store' - the browser's HTTP cache must not hand back an answer it kept: its
            // max-age would then count a second time here, and the data could reach 20 min (review C8).
            // This tab's session store is the only cache on this side.
            r = await this.f(`${this.base}/explore?${qs}`, { headers: { Accept: 'application/json' }, credentials: 'omit', cache: 'no-store' });
        } catch (e) {
            throw new SuperSplatError('network', `the catalogue did not answer: ${String(e)}`);
        }
        const retry = Number(r.headers.get('retry-after'));
        const retryAfterS = Number.isFinite(retry) && retry > 0 ? retry : null;
        if (!r.ok) {
            const code: SuperSplatErrorCode = r.status === 400 ? 'bad-query' : r.status === 429 ? 'rate-limited' : r.status === 503 ? 'busy' : 'upstream';
            let why = '';
            try {
                const b = (await r.json()) as { detail?: unknown };
                why = typeof b.detail === 'string' ? `: ${b.detail}` : '';
            } catch {
                /* not JSON (nginx error page) */
            }
            throw new SuperSplatError(code, `catalogue answered ${r.status}${why}`, r.status, retryAfterS);
        }
        let raw: unknown;
        try {
            raw = await r.json();
        } catch {
            throw new SuperSplatError('bad-response', 'the catalogue answer is not JSON', r.status);
        }
        const page = readPage(raw, n);
        const xc = r.headers.get('x-cache');
        const proxy = xc === 'hit' || xc === 'miss' || xc === 'stale' ? xc : null;
        // keep it no longer than the proxy says it stays fresh (its max-age is what is left of its 10 min).
        // No max-age, no keeping: a stale copy, and a hit in its last second ("no-cache"), are not kept (C8).
        const m = /max-age=(\d+)/.exec(r.headers.get('cache-control') ?? '');
        const keepMs = m ? Math.min(this.ttlMs, Number(m[1]) * 1000) : 0;
        if (keepMs > 0) this.write(qs, { exp: this.now() + keepMs, page });
        return { ...page, from: 'network', proxy };
    }

    // ---- this tab's cache: every access may throw (private mode, quota), none of it is required ----
    private tryStore<T>(f: () => T): T | undefined {
        try {
            return f();
        } catch {
            return undefined;
        }
    }

    private index(): string[] {
        const raw = this.tryStore(() => this.store.getItem(INDEX));
        try {
            const v = raw ? (JSON.parse(raw) as unknown) : [];
            return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
        } catch {
            return [];
        }
    }

    private remove(qs: string): void {
        this.tryStore(() => this.store.removeItem(PREFIX + qs));
    }

    private read(qs: string): Omit<ExplorePage, 'from' | 'proxy'> | null {
        const raw = this.tryStore(() => this.store.getItem(PREFIX + qs));
        if (!raw) return null;
        try {
            const s = JSON.parse(raw) as Stored;
            if (typeof s.exp === 'number' && this.now() < s.exp && s.page && Array.isArray(s.page.items)) return s.page;
        } catch {
            /* damaged entry */
        }
        this.remove(qs);
        return null;
    }

    private write(qs: string, s: Stored): void {
        const idx = this.index().filter((k) => k !== qs);
        idx.push(qs);
        while (idx.length > this.maxStored) this.remove(idx.shift()!);
        const put = () => {
            this.store.setItem(PREFIX + qs, JSON.stringify(s));
            this.store.setItem(INDEX, JSON.stringify(idx));
        };
        if (this.tryStore(() => (put(), true))) return;
        // full: drop our older pages and try once more
        for (const k of idx.splice(0, idx.length - 1)) this.remove(k);
        this.tryStore(put);
    }
}

// ---------------- random scene, highest rated first ----------------

/** Formats the simulator opens (resolveScene: lod-meta.json for 'ssog', meta.json for 'sog' and 'sogs'). */
export const SUPPORTED_FORMATS: readonly string[] = ['sog', 'ssog', 'sogs'];
/** Formats the simulator cannot open yet (resolveScene: 'unsupported'). */
export const UNSUPPORTED_FORMATS: readonly string[] = ['compressed.ply'];

/**
 * What the API's format field says. It does not label old uploads reliably: legacy compressed-PLY scenes
 * come back with format '' (review C9; 2026-10-01, top 40 walkable by likes: both ''-format scenes, among
 * them the best-liked of all, c67edb74, have only scene.compressed.ply on the CDN). So only the formats
 * named above count as known; anything else is 'unknown' and is not picked without a check.
 */
export function formatVerdict(format: string): 'opens' | 'unsupported' | 'unknown' {
    if (SUPPORTED_FORMATS.includes(format)) return 'opens';
    return UNSUPPORTED_FORMATS.includes(format) ? 'unsupported' : 'unknown';
}

/** A look at whether a scene opens, for a scene whose format the API does not name (see RandomOptions.check). */
export type OpensCheck = (it: ExploreItem) => Promise<'yes' | 'no' | 'unknown'>;

export interface PickOptions {
    /** uniform in [0, 1): inject a seeded one for a repeatable pick */
    rng: () => number;
    /** the scene on screen: never picked */
    current?: string | null;
    /** flown recently: skipped while anything else is left, then allowed again (relaxed) */
    recent?: Iterable<string>;
    /** known broken (failed to load lately, taken down): never picked */
    broken?: Iterable<string>;
    /** more "broken" rules; default: any format the simulator is not known to open (formatVerdict) */
    isBroken?: (it: ExploreItem) => boolean;
    minLikes?: number;
    /** scenes per rating tier (default 20) */
    tierSize?: number;
}

export interface PickResult {
    item: ExploreItem;
    /** 0 = the tierSize best-liked scenes of the pool, 1 = the next ones, ... */
    tier: number;
    /** how many scenes the pick was drawn from */
    candidates: number;
    /** every usable scene was flown recently, so recent ones were allowed again */
    relaxed: boolean;
}

/** Likes, then views, then id: a total order, so the same pool always ranks the same way. */
function byRating(a: ExploreItem, b: ExploreItem): number {
    return b.likes - a.likes || b.views - a.views || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * "Random across all of SuperSplat, highest rating first" (the owner, 2026-09-27). The pool is ranked by
 * likes and cut into tiers of tierSize. The pick is uniform among the usable scenes of the best tier that
 * still has one, so the best-liked scenes come first and a lower tier is reached only when every scene
 * above it was flown recently, is broken or is on screen. Deterministic for a given pool, options and rng.
 */
export function pickRandomTopRated(pool: readonly ExploreItem[], o: PickOptions): PickResult | null {
    const tierSize = Math.max(1, Math.floor(o.tierSize ?? 20));
    const broken = new Set(o.broken ?? []);
    const recent = new Set(o.recent ?? []);
    const isBroken = o.isBroken ?? ((it: ExploreItem) => formatVerdict(it.format) !== 'opens');
    const minLikes = o.minLikes ?? 0;
    const unique = new Map<string, ExploreItem>();
    for (const it of pool) if (!unique.has(it.id)) unique.set(it.id, it);
    const ranked = [...unique.values()].sort(byRating);
    const usable = (it: ExploreItem) => it.id !== o.current && !broken.has(it.id) && !isBroken(it) && it.likes >= minLikes;
    const pick = (ok: (it: ExploreItem) => boolean, relaxed: boolean): PickResult | null => {
        for (let t = 0; t * tierSize < ranked.length; t++) {
            const c = ranked.slice(t * tierSize, (t + 1) * tierSize).filter(ok);
            if (!c.length) continue;
            let x = o.rng();
            if (!(x >= 0 && x < 1)) x = 0;
            return { item: c[Math.min(c.length - 1, Math.floor(x * c.length))], tier: t, candidates: c.length, relaxed };
        }
        return null;
    };
    return pick((it) => usable(it) && !recent.has(it.id), false) ?? pick(usable, true);
}
