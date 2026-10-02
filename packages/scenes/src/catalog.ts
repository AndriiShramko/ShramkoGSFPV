// The scene catalogue the picker shows (owner's admin, v0.6): the API's published list (GET /api/catalog,
// written by the admin at /admin/, apps/api/admin.py) or, when the API cannot answer, the static
// showcase.json shipped with the release. One shape for both; the picker's order IS the admin's order.
// No DOM here: the storefront (apps/fly/src/ui/scenes.ts) and the admin page share these rules.

export type CatalogKind = 'interior' | 'exterior' | 'other';
/** a text per language; English is the fallback */
export type LocalText = Partial<Record<'en' | 'es' | 'pl' | 'ru', string>>;

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
}

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
    if (typeof o.defaultDrone === 'string' && o.defaultDrone) s.defaultDrone = o.defaultDrone;
    if (o.walls === 'on' || o.walls === 'off') s.walls = o.walls;
    const pitch = texts(o.pitch);
    if (pitch) s.pitch = pitch;
    if (Array.isArray(o.collections)) s.collections = o.collections.filter((c): c is string => typeof c === 'string');
    if (o.pinned === true) s.pinned = true;
    if (o.hidden === true) s.hidden = true;
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
 * The picker's catalogue tab, from rows already filtered (pickerRows keeps the admin's order): the
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

/** A collection id from its English title: lower case, ASCII letters and digits, dashes (the API's rule). */
export function collectionId(title: string, taken: readonly string[]): string {
    const base = title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 28) || 'collection';
    let id = base;
    for (let i = 2; taken.includes(id); i++) id = `${base}-${i}`;
    return id;
}
