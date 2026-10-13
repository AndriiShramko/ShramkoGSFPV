// The scene catalogue the picker shows (owner's admin, v0.6): the API's published list (GET /api/catalog,
// written by the admin at /admin/, apps/api/admin.py) or, when the API cannot answer, the static
// showcase.json shipped with the release. One shape for both; the picker's order IS the admin's order.
// No DOM here: the storefront (apps/fly/src/ui/scenes.ts) and the admin page share these rules.

export type CatalogKind = 'interior' | 'exterior' | 'other';
/** a text per language; English is the fallback */
export type LocalText = Partial<Record<'en' | 'es' | 'pl' | 'ru', string>>;

/** Where the scanned place is (WGS84 degrees, 3 decimals: about 100 m); feeds the wind of the place and the scene's page. */
export interface SceneGeo {
    lat: number;
    lon: number;
    /** a human name of the place, "Wroclaw, Poland" */
    place?: string;
}

/**
 * The scene's wind, as a weather report gives it: fromDeg is the compass direction the wind blows FROM
 * (0 north, 90 east, clockwise), speed the mean in m/s at 10 m, gust the amplitude of the gusts above
 * the mean in m/s. source: typed by the admin, or the prevailing wind of the place (climate data).
 */
export interface SceneWind {
    fromDeg: number;
    speed: number;
    gust: number;
    source: 'manual' | 'climate';
}

/**
 * How SuperSplat's viewer was asked to draw the scene (its link's ?budget=8&stochastic): budgetM is the
 * splat budget in millions; stochastic is the sort-free, dithered drawing (desktop WebGPU only).
 */
export interface SceneRender {
    budgetM?: number;
    stochastic?: boolean;
}

/** What SuperSplat said about the scene when the admin added it (quoted short and credited on the scene's page). */
export interface SceneOrigin {
    /** the scene's page on superspl.at */
    url: string;
    /** the author's description, at most 600 characters */
    description?: string;
    tags?: string[];
    /** when it was published on SuperSplat, ISO date */
    created?: string;
    /** the author's SuperSplat user name (the credit links to their page there); `author` is the name shown */
    user?: string;
}

export interface CatalogScene {
    id: string;
    title: string;
    author: string;
    license: string;
    kind: CatalogKind;
    collision: boolean;
    /** the CDN folder v<N> the scene lives in (resolveScene finds the current one anyway) */
    version?: number;
    /** poster override (S3 or the CDN, <id>/v<N>/<size>.webp); else posterUrl(id) */
    thumb?: string;
    voxelCm?: number;
    sizeMb?: number;
    /** SuperSplat's storage format ('ssog', 'sog'...) as the admin saw it when adding the scene */
    format?: string;
    /** the scan's bounding box in metres along its x, y, z (scale 1), from the collision file's sceneBounds; the scene page's size facts */
    extentM?: [number, number, number];
    defaultDrone?: string;
    /** the admin's default for the walls switch: "off" for a noisy scan (floating splats make phantom walls); absent = on */
    walls?: 'on' | 'off';
    /** the admin's default floater filter (G.3, prefs scene.dropFloaters): pieces of the walls under N blocks dropped; absent = 0 */
    dropFloaters?: number;
    /** the admin's verified size of the scan (E.7), 0.25..4; absent = 1 */
    scale?: number;
    /** one line under the title of a featured card */
    pitch?: LocalText;
    collections?: string[];
    /** shown in the Featured row at the top of the picker */
    pinned?: boolean;
    /** kept in the admin's list, not shown to pilots (the public catalogue leaves it out) */
    hidden?: boolean;
    geo?: SceneGeo;
    /**
     * The compass bearing (degrees, 0 north, clockwise) of the scene's forward axis, the flown world's -z
     * (PlayCanvas, +y up): the direction the HUD calls heading 0. Headings grow turning right, so a
     * compass bearing B is scene heading B - compassDeg. Absent: the forward axis counts as north (the
     * wind's fromDeg is then read against it). Lane E, docs/wip/v07-e.md section 1.
     */
    compassDeg?: number;
    /** the scene's wind; it blows the drone's own air: m/s around the real-size drone at any Scene size */
    wind?: SceneWind;
    /**
     * Collisions are ignored above this height (outdoor scans with floating sky splats): metres along +y
     * in the scan's own coordinates, the world before the pilot's Scene size (E.7, T(w) = s*w + t) at
     * scale 1, so it is flown at s * ceilingM + t_y. A voxel whose lower face is at or above it is
     * ignored; one the plane cuts through still collides (packages/collision ceiling.ts).
     */
    ceilingM?: number;
    render?: SceneRender;
    /** our own words about the scene for its page (search and answer engines), per language; never SuperSplat's text */
    about?: LocalText;
    origin?: SceneOrigin;
}

/**
 * Every field of a CatalogScene, once, in the interface's order. The compiler checks the list against the
 * interface both ways (a new field must be added here, a field here must exist there), so code that has to
 * cover every field reads it from here: the admin page names each field catalogDiff or factChanges reports
 * with the label admin.key.<field>, and a test (packages/i18n/test/admin-parity.test.ts) checks each one
 * has that label in every language.
 */
export const CATALOG_SCENE_FIELDS = Object.keys({
    id: 1, title: 1, author: 1, license: 1, kind: 1, collision: 1, version: 1, thumb: 1, voxelCm: 1, sizeMb: 1, format: 1, extentM: 1,
    defaultDrone: 1, walls: 1, dropFloaters: 1, scale: 1, pitch: 1, collections: 1, pinned: 1, hidden: 1, geo: 1, compassDeg: 1, wind: 1,
    ceilingM: 1, render: 1, about: 1, origin: 1
} satisfies Record<keyof CatalogScene, 1>) as readonly (keyof CatalogScene)[];

export interface CatalogCollection {
    id: string;
    title: LocalText;
}

export interface SceneCatalog {
    collections: CatalogCollection[];
    scenes: CatalogScene[];
}

const ID = /^[0-9a-f]{6,32}$/;
const KINDS: readonly CatalogKind[] = ['interior', 'exterior', 'other'];

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown, lo: number, hi: number): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : undefined);

function texts(v: unknown): LocalText | undefined {
    if (typeof v === 'string') return v ? { en: v } : undefined;
    if (!v || typeof v !== 'object') return undefined;
    const out: LocalText = {};
    for (const l of ['en', 'es', 'pl', 'ru'] as const) {
        const s = (v as Record<string, unknown>)[l];
        if (typeof s === 'string' && s) out[l] = s;
    }
    return Object.keys(out).length ? out : undefined;
}

function readGeo(v: unknown): SceneGeo | undefined {
    if (!v || typeof v !== 'object') return undefined;
    const o = v as Record<string, unknown>;
    const lat = num(o.lat, -90, 90);
    const lon = num(o.lon, -180, 180);
    if (lat === undefined || lon === undefined) return undefined;
    const g: SceneGeo = { lat, lon };
    if (typeof o.place === 'string' && o.place) g.place = o.place.slice(0, 80);
    return g;
}

function readWind(v: unknown): SceneWind | undefined {
    if (!v || typeof v !== 'object') return undefined;
    const o = v as Record<string, unknown>;
    const fromDeg = num(o.fromDeg, 0, 360);
    const speed = num(o.speed, 0, 30);
    const gust = num(o.gust, 0, 20);
    if (fromDeg === undefined || speed === undefined || gust === undefined) return undefined;
    return { fromDeg, speed, gust, source: o.source === 'climate' ? 'climate' : 'manual' };
}

function readRender(v: unknown): SceneRender | undefined {
    if (!v || typeof v !== 'object') return undefined;
    const o = v as Record<string, unknown>;
    const r: SceneRender = {};
    const b = num(o.budgetM, 0.25, 32);
    if (b !== undefined) r.budgetM = b;
    if (o.stochastic === true) r.stochastic = true;
    return Object.keys(r).length ? r : undefined;
}

const ORIGIN_URL = /^https:\/\/superspl\.at\/[A-Za-z0-9/_?=&.-]{1,200}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/;
/** a SuperSplat user name (origin.user) */
const USER = /^[A-Za-z0-9_.-]{1,40}$/;

function readOrigin(v: unknown): SceneOrigin | undefined {
    if (!v || typeof v !== 'object') return undefined;
    const o = v as Record<string, unknown>;
    if (typeof o.url !== 'string' || !ORIGIN_URL.test(o.url)) return undefined;
    const out: SceneOrigin = { url: o.url };
    if (typeof o.description === 'string' && o.description) out.description = o.description.slice(0, 600);
    if (Array.isArray(o.tags)) {
        const tags = o.tags.filter((t): t is string => typeof t === 'string' && t.length > 0).map((t) => t.slice(0, 30)).slice(0, 12);
        if (tags.length) out.tags = tags;
    }
    if (typeof o.created === 'string' && ISO_DATE.test(o.created)) out.created = o.created;
    if (typeof o.user === 'string' && USER.test(o.user)) out.user = o.user;
    return out;
}

/** One entry from the network, or null when it is not a scene; unknown fields are dropped. */
export function readScene(v: unknown): CatalogScene | null {
    if (!v || typeof v !== 'object') return null;
    const o = v as Record<string, unknown>;
    if (typeof o.id !== 'string' || !ID.test(o.id) || typeof o.title !== 'string' || !o.title) return null;
    const s: CatalogScene = {
        id: o.id,
        title: o.title,
        author: str(o.author),
        license: str(o.license),
        kind: KINDS.includes(o.kind as CatalogKind) ? (o.kind as CatalogKind) : 'other',
        collision: o.collision !== false
    };
    const n: [keyof CatalogScene, number | undefined][] = [
        ['version', num(o.version, 1, 999999)], ['voxelCm', num(o.voxelCm, 0.1, 100)], ['sizeMb', num(o.sizeMb, 0.01, 100000)],
        ['dropFloaters', num(o.dropFloaters, 0, 64)], ['scale', num(o.scale, 0.25, 4)]
    ];
    for (const [k, x] of n) if (x !== undefined) (s as unknown as Record<string, unknown>)[k] = x;
    if (typeof o.thumb === 'string' && /^https:\/\/[^\s"'<>]+\.webp$/.test(o.thumb)) s.thumb = o.thumb;
    if (typeof o.format === 'string' && o.format) s.format = o.format;
    if (Array.isArray(o.extentM) && o.extentM.length === 3) {
        const e = o.extentM.map((x) => num(x, 0, 100000));
        if (e.every((x) => x !== undefined)) s.extentM = e as [number, number, number];
    }
    if (typeof o.defaultDrone === 'string' && o.defaultDrone) s.defaultDrone = o.defaultDrone;
    if (o.walls === 'on' || o.walls === 'off') s.walls = o.walls;
    const pitch = texts(o.pitch);
    if (pitch) s.pitch = pitch;
    if (Array.isArray(o.collections)) s.collections = o.collections.filter((c): c is string => typeof c === 'string');
    if (o.pinned === true) s.pinned = true;
    if (o.hidden === true) s.hidden = true;
    const geo = readGeo(o.geo);
    if (geo) s.geo = geo;
    const compass = num(o.compassDeg, 0, 360);
    if (compass !== undefined) s.compassDeg = compass;
    const wind = readWind(o.wind);
    if (wind) s.wind = wind;
    const ceiling = num(o.ceilingM, -10000, 10000);
    if (ceiling !== undefined) s.ceilingM = ceiling;
    const render = readRender(o.render);
    if (render) s.render = render;
    const about = texts(o.about);
    if (about) s.about = about;
    const origin = readOrigin(o.origin);
    if (origin) s.origin = origin;
    return s;
}

/** A catalogue document (the API's or showcase.json); null when it has no scene list at all. */
export function readCatalog(doc: unknown): SceneCatalog | null {
    if (!doc || typeof doc !== 'object' || !Array.isArray((doc as { scenes?: unknown }).scenes)) return null;
    const d = doc as { scenes: unknown[]; collections?: unknown };
    const seen = new Set<string>();
    const scenes = d.scenes.map(readScene).filter((s): s is CatalogScene => !!s && !seen.has(s.id) && !!seen.add(s.id));
    const collections: CatalogCollection[] = [];
    if (Array.isArray(d.collections)) {
        for (const c of d.collections) {
            const id = (c as { id?: unknown })?.id;
            const title = texts((c as { title?: unknown })?.title);
            if (typeof id === 'string' && title) collections.push({ id, title });
        }
    }
    return { collections, scenes };
}

/** The text in this language, else English, else any. */
export function localText(t: LocalText | undefined, locale: string): string {
    if (!t) return '';
    return t[locale as keyof LocalText] ?? t.en ?? Object.values(t).find(Boolean) ?? '';
}

/**
 * The picker's catalogue tab, from rows already filtered (pickerList keeps the admin's order): the
 * Featured row (pinned scenes), the collections that have a scene among the rows, and the rest
 * (not pinned; only the chosen collection's when one is chosen).
 */
export function storefront<R extends { id: string }>(rows: readonly R[], catalog: SceneCatalog, collection: string | null): {
    featured: R[];
    collections: CatalogCollection[];
    rest: R[];
} {
    const byId = new Map(catalog.scenes.map((s) => [s.id, s]));
    const inCol = (r: R, c: string): boolean => byId.get(r.id)?.collections?.includes(c) ?? false;
    const collections = catalog.collections.filter((c) => rows.some((r) => inCol(r, c.id)));
    const chosen = collection && collections.some((c) => c.id === collection) ? collection : null;
    return {
        featured: rows.filter((r) => byId.get(r.id)?.pinned),
        collections,
        rest: rows.filter((r) => !byId.get(r.id)?.pinned && (chosen === null || inCol(r, chosen)))
    };
}

/** A copy of the list with one item moved from one position to another (clamped); the admin's reorder. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
    const out = list.slice();
    if (from < 0 || from >= out.length) return out;
    const [x] = out.splice(from, 1);
    out.splice(Math.max(0, Math.min(out.length, to)), 0, x);
    return out;
}

/** How one scene of the draft differs from the live catalogue (catalogDiff). */
export interface SceneChange {
    id: string;
    title: string;
    kind: 'added' | 'changed' | 'moved' | 'removed';
    /** the fields that differ (a changed scene; sorted) */
    fields?: string[];
}

/** Everything the draft changes against the live catalogue: the admin's "not published yet" list. */
export interface CatalogDiff {
    scenes: SceneChange[];
    /** the collections list differs (added, removed, renamed or reordered) */
    collections: boolean;
    /** scenes, collections or the order differ: Publish has something to do */
    dirty: boolean;
}

/** One value in a canonical form for comparing (object keys sorted, missing = undefined). */
function canonical(v: unknown): string {
    if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
    if (v && typeof v === 'object') {
        const o = v as Record<string, unknown>;
        return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
    }
    return JSON.stringify(v ?? null);
}

/** Defaults the API writes for a field the admin never set: absent and default compare equal. */
const FIELD_DEFAULTS: Record<string, unknown> = { walls: 'on', pinned: false, hidden: false, collections: [], collision: true };

/**
 * The admin's draft against the live catalogue (both as GET /api/admin/catalog sends them): scenes added,
 * removed, changed (with the fields) and moved (same fields, another place among the scenes both keep).
 * Pure; the admin page draws it as badges and the "N changes not published" line.
 */
export function catalogDiff(draft: SceneCatalog, live: SceneCatalog | null): CatalogDiff {
    const liveScenes = live?.scenes ?? [];
    const before = new Map(liveScenes.map((s) => [s.id, s]));
    const after = new Map(draft.scenes.map((s) => [s.id, s]));
    const value = (s: CatalogScene, k: string): string => canonical((s as unknown as Record<string, unknown>)[k] ?? FIELD_DEFAULTS[k]);
    // the scenes both lists keep, in the draft's order: the fewest of them that moved are the ones outside
    // the longest run that kept its live order (one scene dragged = one "moved", not every scene it passed)
    const livePos = new Map(liveScenes.filter((s) => after.has(s.id)).map((s, i) => [s.id, i]));
    const kept = draft.scenes.filter((s) => livePos.has(s.id)).map((s) => s.id);
    const stayed = longestIncreasing(kept.map((id) => livePos.get(id)!)).map((i) => kept[i]);
    const moved = new Set(kept.filter((id) => !stayed.includes(id)));
    const scenes: SceneChange[] = [];
    draft.scenes.forEach((s) => {
        const old = before.get(s.id);
        if (!old) {
            scenes.push({ id: s.id, title: s.title, kind: 'added' });
            return;
        }
        const keys = [...new Set([...Object.keys(old), ...Object.keys(s)])].filter((k) => value(old, k) !== value(s, k)).sort();
        if (keys.length) scenes.push({ id: s.id, title: s.title, kind: 'changed', fields: keys });
        else if (moved.has(s.id)) scenes.push({ id: s.id, title: s.title, kind: 'moved' });
    });
    for (const s of liveScenes) if (!after.has(s.id)) scenes.push({ id: s.id, title: s.title, kind: 'removed' });
    const collections = canonical(draft.collections) !== canonical(live?.collections ?? []);
    return { scenes, collections, dirty: collections || scenes.length > 0 };
}

/** The indexes of one longest strictly increasing subsequence of `a` (patience sorting, O(n log n)). */
function longestIncreasing(a: readonly number[]): number[] {
    const tails: number[] = []; // tails[k]: index in a of the smallest last value of an increasing run of length k+1
    const prev: number[] = new Array(a.length).fill(-1);
    for (let i = 0; i < a.length; i++) {
        let lo = 0;
        let hi = tails.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (a[tails[mid]] < a[i]) lo = mid + 1; else hi = mid;
        }
        if (lo > 0) prev[i] = tails[lo - 1];
        tails[lo] = i;
    }
    const out: number[] = [];
    for (let i = tails.length ? tails[tails.length - 1] : -1; i >= 0; i = prev[i]) out.push(i);
    return out.reverse();
}

/** A collection id from its English title: lower case, ASCII letters and digits, dashes (the API's rule). */
export function collectionId(title: string, taken: readonly string[]): string {
    const base = title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 28) || 'collection';
    let id = base;
    for (let i = 2; taken.includes(id); i++) id = `${base}-${i}`;
    return id;
}
