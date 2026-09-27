// The stored document (A.4): one localStorage key holds every setting and the collections (radio
// profiles, scene library, lifetime stats, UI flags). The export file is the same document plus
// exportedAt and origin. Validators here repair what they can and drop what they cannot, so a
// hand-edited or half-written document never breaks the page.

import { SCHEMA_VERSION } from './schema';

export const PREFS_KEY = 'gsfpv.prefs.v1';
export const PREFS_FORMAT = 'gsfpv-prefs';
export const PREFS_APP_VERSION = '0.3.0';

export type SettingsMap = Record<string, unknown>;
export interface PrefsSettings { global: SettingsMap; drone: Record<string, SettingsMap>; scene: Record<string, SettingsMap> }

/** An @gsfpv/input Profile, kept unchanged: prefs checks only what it needs to key and load it. */
export interface RadioProfileItem { version: 1; deviceKey: string; axes: Record<string, unknown>; [k: string]: unknown }
export type InputKind = 'hid' | 'gamepad' | 'touch' | 'keyboard';
/** The input flown last time (v0.2 controls.ts LastInput), so the next scan starts with it. */
export interface LastInput { kind: InputKind; key?: string }
export interface RadioProfiles { v: 1; items: Record<string, RadioProfileItem>; last: LastInput | null }

export interface SceneFilter { collisionOnly: boolean; kind: 'all' | 'interior' | 'exterior'; flown: 'all' | 'flown' | 'new'; maxMb: number | null }
export interface LibraryEntry { id: string; version: number; title?: string; author?: string; license?: string; lastFlown: number; flights: number; airtimeS: number; hasCollision: boolean | null; failedAt?: number; failCode?: string }
export interface SceneLibraryData { v: 1; history: LibraryEntry[]; favourites: string[]; filter: SceneFilter; versions: Record<string, number> }

export interface DroneTotals { flights: number; airtimeS: number; distanceM: number; crashes: number }
export interface StatsTotals { v: 1; byDrone: Record<string, DroneTotals> }

export interface UiState { v: 1; warned: boolean }

export interface Collections { radioProfiles: RadioProfiles; sceneLibrary: SceneLibraryData; stats: StatsTotals; ui: UiState }
export type CollectionId = 'radioProfiles' | 'sceneLibrary' | 'stats' | 'ui';
export const COLLECTION_IDS: readonly CollectionId[] = ['radioProfiles', 'sceneLibrary', 'stats', 'ui'];

export interface PrefsDoc {
    format: typeof PREFS_FORMAT;
    version: number;
    app: string;
    savedAt: string;
    settings: PrefsSettings;
    collections: Collections;
}
/** The export file: the document, possibly without some collections, plus where and when it was made. */
export interface PrefsFile extends Omit<PrefsDoc, 'collections'> { collections: Partial<Collections>; exportedAt: string; origin: string }

export const DEFAULT_FILTER: SceneFilter = { collisionOnly: true, kind: 'all', flown: 'all', maxMb: null };
/** v0.2 kept 100 history entries and 200 known versions (packages/scenes). */
export const HISTORY_CAP = 100;
export const VERSIONS_CAP = 200;

export function defaultCollection<K extends CollectionId>(k: K): Collections[K] {
    const all: Collections = {
        radioProfiles: { v: 1, items: {}, last: null },
        sceneLibrary: { v: 1, history: [], favourites: [], filter: { ...DEFAULT_FILTER }, versions: {} },
        stats: { v: 1, byDrone: {} },
        ui: { v: 1, warned: false }
    };
    return all[k];
}

export function emptyDoc(app = PREFS_APP_VERSION, savedAt = new Date(0).toISOString()): PrefsDoc {
    return {
        format: PREFS_FORMAT,
        version: SCHEMA_VERSION,
        app,
        savedAt,
        settings: { global: {}, drone: {}, scene: {} },
        collections: { radioProfiles: defaultCollection('radioProfiles'), sceneLibrary: defaultCollection('sceneLibrary'), stats: defaultCollection('stats'), ui: defaultCollection('ui') }
    };
}

export function clone<T>(v: T): T {
    return v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T);
}

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const nonNeg = (v: unknown): number => (fin(v) && v > 0 ? v : 0);
const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

// ------------------------------------------------------------------ keys from outside data

/**
 * Keys that never become keys of a map built from outside data (a stored or imported document, a
 * legacy key, a drone or scene id): assigning '__proto__' replaces a plain object's prototype
 * (values no preview shows, yet reads find), and 'constructor' / 'prototype' lead to built-ins
 * (review must-fix 3). Other inherited names (toString...) are safe as long as maps are read and
 * written through own() / hasOwn, which the store and import do.
 */
export const RESERVED_KEYS: readonly string[] = ['__proto__', 'constructor', 'prototype'];
export function isReservedKey(k: string): boolean {
    return RESERVED_KEYS.includes(k);
}
/** A map's own value, never an inherited one. */
export function own<T>(m: Readonly<Record<string, T>>, k: string): T | undefined {
    return Object.hasOwn(m, k) ? m[k] : undefined;
}
/**
 * Where dropped reserved keys are reported (import): a path such as `settings.drone.constructor`.
 * Absent: dropped silently (a stored document at boot).
 */
export type DroppedKeys = string[] | undefined;
/** The own entries of a map whose keys are usable, the reserved ones reported. */
function usable<T>(m: Record<string, T>, path: string, dropped: DroppedKeys): [string, T][] {
    return Object.entries(m).filter(([k]) => {
        if (!isReservedKey(k)) return true;
        dropped?.push(`${path}.${k}`);
        return false;
    });
}

// ------------------------------------------------------------------ collection validators

/** v0.2 parseProfile's test: version 1, a device key, axes, and an arm input this version reads. */
export function validRadioProfile(v: unknown): RadioProfileItem | null {
    const o = obj(v);
    if (!o || o.version !== 1 || !str(o.deviceKey) || !obj(o.axes)) return null;
    const arm = o.arm as { kind?: unknown } | null | undefined;
    if (arm && arm.kind !== 'axis' && arm.kind !== 'button' && arm.kind !== 'key') return null;
    return o as RadioProfileItem;
}

export function validLastInput(v: unknown): LastInput | null {
    const o = obj(v);
    if (!o || (o.kind !== 'hid' && o.kind !== 'gamepad' && o.kind !== 'touch' && o.kind !== 'keyboard')) return null;
    return str(o.key) ? { kind: o.kind, key: o.key } : { kind: o.kind };
}

export function validFilter(v: unknown): SceneFilter {
    const o = obj(v) ?? {};
    const f: SceneFilter = { ...DEFAULT_FILTER };
    if (typeof o.collisionOnly === 'boolean') f.collisionOnly = o.collisionOnly;
    if (o.kind === 'all' || o.kind === 'interior' || o.kind === 'exterior') f.kind = o.kind;
    if (o.flown === 'all' || o.flown === 'flown' || o.flown === 'new') f.flown = o.flown;
    if (o.maxMb === null || (fin(o.maxMb) && o.maxMb > 0)) f.maxMb = o.maxMb as number | null;
    return f;
}

export function validLibraryEntry(v: unknown): LibraryEntry | null {
    const o = obj(v);
    if (!o || !str(o.id)) return null;
    const e: LibraryEntry = {
        id: o.id,
        version: Number.isInteger(o.version) && (o.version as number) > 1 ? (o.version as number) : 1,
        lastFlown: nonNeg(o.lastFlown),
        flights: Number.isInteger(o.flights) && (o.flights as number) > 0 ? (o.flights as number) : 0,
        airtimeS: nonNeg(o.airtimeS),
        hasCollision: typeof o.hasCollision === 'boolean' ? o.hasCollision : null
    };
    for (const k of ['title', 'author', 'license', 'failCode'] as const) if (str(o[k])) e[k] = o[k] as string;
    if (fin(o.failedAt)) e.failedAt = o.failedAt;
    return e;
}

/** Newest first by lastFlown, one entry per id, at most HISTORY_CAP. */
export function sortHistory(h: readonly LibraryEntry[]): LibraryEntry[] {
    const seen = new Set<string>();
    const out: LibraryEntry[] = [];
    for (const e of [...h].sort((a, b) => b.lastFlown - a.lastFlown)) {
        if (seen.has(e.id)) continue;
        seen.add(e.id);
        out.push(e);
    }
    return out.slice(0, HISTORY_CAP);
}

function validVersions(v: unknown, dropped?: DroppedKeys): Record<string, number> {
    const out: Record<string, number> = {};
    const o = obj(v) ?? {};
    for (const [id, n] of usable(o, 'collections.sceneLibrary.versions', dropped)) if (id && Number.isInteger(n) && (n as number) >= 1) out[id] = n as number;
    const keys = Object.keys(out);
    if (keys.length > VERSIONS_CAP) for (const k of keys.slice(VERSIONS_CAP)) delete out[k];
    return out;
}

function validTotals(v: unknown): DroneTotals | null {
    const o = obj(v);
    if (!o) return null;
    return { flights: nonNeg(o.flights), airtimeS: nonNeg(o.airtimeS), distanceM: nonNeg(o.distanceM), crashes: nonNeg(o.crashes) };
}

/**
 * Repairs a collection: bad entries are dropped, missing fields get their defaults. null if it is
 * not an object. Reserved keys and ids (RESERVED_KEYS) are dropped and, given `dropped`, reported.
 */
export function validateCollection<K extends CollectionId>(k: K, v: unknown, dropped?: DroppedKeys): Collections[K] | null {
    const o = obj(v);
    if (!o) return null;
    const path = `collections.${k}`;
    switch (k) {
        case 'radioProfiles': {
            const items: Record<string, RadioProfileItem> = {};
            // re-keyed by deviceKey: the key is what a reconnecting radio is found by
            for (const [key, p] of usable(obj(o.items) ?? {}, `${path}.items`, dropped)) {
                const r = validRadioProfile(p);
                if (!r) continue;
                if (isReservedKey(r.deviceKey)) {
                    if (r.deviceKey !== key) dropped?.push(`${path}.items.${r.deviceKey}`);
                    continue;
                }
                items[r.deviceKey] = r;
            }
            return { v: 1, items, last: validLastInput(o.last) } as Collections[K];
        }
        case 'sceneLibrary': {
            const ids = (list: unknown[], field: string, id: (x: unknown) => unknown) => list.filter((x) => {
                const i = id(x);
                if (typeof i !== 'string' || !isReservedKey(i)) return true;
                dropped?.push(`${path}.${field}.${i}`);
                return false;
            });
            const history = sortHistory(ids(Array.isArray(o.history) ? o.history : [], 'history', (e) => obj(e)?.id).map(validLibraryEntry).filter((e): e is LibraryEntry => e !== null));
            const favourites = [...new Set(ids(Array.isArray(o.favourites) ? o.favourites : [], 'favourites', (f) => f).filter(str))];
            return { v: 1, history, favourites, filter: validFilter(o.filter), versions: validVersions(o.versions, dropped) } as Collections[K];
        }
        case 'stats': {
            const byDrone: Record<string, DroneTotals> = {};
            for (const [id, t] of usable(obj(o.byDrone) ?? {}, `${path}.byDrone`, dropped)) {
                const r = validTotals(t);
                if (id && r) byDrone[id] = r;
            }
            return { v: 1, byDrone } as Collections[K];
        }
        case 'ui':
            return { v: 1, warned: o.warned === true } as Collections[K];
    }
    return null;
}

/** A map of setting ids (a spread would keep an own '__proto__' key that a later assignment turns into a prototype). */
function validSettingsMap(v: unknown, path: string, dropped: DroppedKeys): SettingsMap {
    const out: SettingsMap = {};
    for (const [id, x] of usable(obj(v) ?? {}, path, dropped)) out[id] = x;
    return out;
}

function validNested(v: unknown, path: string, dropped: DroppedKeys): Record<string, SettingsMap> {
    const out: Record<string, SettingsMap> = {};
    for (const [k, m] of usable(obj(v) ?? {}, path, dropped)) {
        const mm = obj(m);
        if (!k || !mm) continue;
        const inner = validSettingsMap(mm, `${path}.${k}`, dropped);
        if (Object.keys(inner).length) out[k] = inner;
    }
    return out;
}

/**
 * The document shape with every part repaired; values are not checked against the schema here
 * (the store and import do that per def, and unknown ids are kept on purpose). Reserved keys
 * (RESERVED_KEYS) are dropped at every level, and listed in `dropped` when it is given.
 */
export function normalizeDoc(o: Record<string, unknown>, app = PREFS_APP_VERSION, dropped?: DroppedKeys): PrefsDoc {
    const s = obj(o.settings) ?? {};
    const c = obj(o.collections) ?? {};
    const doc = emptyDoc(typeof o.app === 'string' ? o.app : app, typeof o.savedAt === 'string' ? o.savedAt : new Date(0).toISOString());
    doc.version = Number.isInteger(o.version) ? (o.version as number) : SCHEMA_VERSION;
    doc.settings = { global: validSettingsMap(s.global, 'settings.global', dropped), drone: validNested(s.drone, 'settings.drone', dropped), scene: validNested(s.scene, 'settings.scene', dropped) };
    for (const k of COLLECTION_IDS) {
        const v = validateCollection(k, c[k], dropped);
        if (v) (doc.collections as unknown as Record<string, unknown>)[k] = v;
    }
    return doc;
}

/** Parses stored or imported text (or an already parsed object) and checks format and version. */
export function parseDocInput(input: unknown): { ok: true; raw: Record<string, unknown>; version: number } | { ok: false; error: 'not-a-settings-file' | 'newer-version' | 'corrupt'; version?: number } {
    let v = input;
    if (typeof v === 'string') {
        try {
            v = JSON.parse(v);
        } catch {
            return { ok: false, error: 'corrupt' };
        }
    }
    const o = obj(v);
    if (!o || o.format !== PREFS_FORMAT) return { ok: false, error: 'not-a-settings-file' };
    if (!Number.isInteger(o.version) || (o.version as number) < 1) return { ok: false, error: 'corrupt' };
    if ((o.version as number) > SCHEMA_VERSION) return { ok: false, error: 'newer-version', version: o.version as number };
    if (o.settings !== undefined && !obj(o.settings)) return { ok: false, error: 'corrupt' };
    if (o.collections !== undefined && !obj(o.collections)) return { ok: false, error: 'corrupt' };
    return { ok: true, raw: o, version: o.version as number };
}

/** `gsfpv-settings-YYYY-MM-DD.json` (A.4), in UTC so the name does not depend on the machine's zone. */
export function exportFileName(nowMs: number): string {
    return `gsfpv-settings-${new Date(nowMs).toISOString().slice(0, 10)}.json`;
}
