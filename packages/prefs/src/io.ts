// Import planning (A.4): pure functions from (current document, file, mode) to the next document
// and the report the preview shows. The store applies the plan; nothing here touches storage.

import { boundsOf, canonicalJson, checkValue } from './schema';
import type { PresetResolver, Schema, Scope } from './schema';
import { COLLECTION_IDS, clone, normalizeDoc, parseDocInput, sortHistory, validateCollection } from './doc';
import type { CollectionId, Collections, LibraryEntry, PrefsDoc, PrefsSettings } from './doc';
import { runMigrations } from './migrate';

export interface ImportChange { id: string; key: string | null; from: unknown; to: unknown }
export interface ImportReport {
    ok: boolean;
    fromVersion: number;
    changes: ImportChange[];
    clamped: string[];
    dropped: { id: string; why: string }[];
    unknown: string[];
    collections: Record<CollectionId, { added: number; changed: number }>;
    error?: 'not-a-settings-file' | 'newer-version' | 'corrupt';
}
export type ImportMode = 'replace' | 'merge';
export interface ImportPlan { doc: PrefsDoc | null; report: ImportReport }

/** One stored value: where it sits and what it is. key is the drone or scene id, null for global. */
export interface Entry { scope: Scope; key: string | null; id: string; value: unknown }

export function entriesOf(s: PrefsSettings): Entry[] {
    const out: Entry[] = [];
    for (const [id, value] of Object.entries(s.global)) out.push({ scope: 'global', key: null, id, value });
    for (const scope of ['drone', 'scene'] as const) {
        for (const [key, m] of Object.entries(s[scope])) for (const [id, value] of Object.entries(m)) out.push({ scope, key, id, value });
    }
    return out;
}

export function entryAt(s: PrefsSettings, scope: Scope, key: string | null, id: string): unknown {
    if (scope === 'global') return s.global[id];
    return key === null ? undefined : s[scope][key]?.[id];
}

export function putEntry(s: PrefsSettings, scope: Scope, key: string | null, id: string, value: unknown): void {
    if (value === undefined) {
        if (scope === 'global') delete s.global[id];
        else if (key !== null && s[scope][key]) {
            delete s[scope][key][id];
            if (!Object.keys(s[scope][key]).length) delete s[scope][key];
        }
        return;
    }
    if (scope === 'global') s.global[id] = value;
    else if (key !== null) (s[scope][key] ??= {})[id] = value;
}

const emptyCounts = (): Record<CollectionId, { added: number; changed: number }> => ({
    radioProfiles: { added: 0, changed: 0 },
    sceneLibrary: { added: 0, changed: 0 },
    stats: { added: 0, changed: 0 },
    ui: { added: 0, changed: 0 }
});

function fail(error: NonNullable<ImportReport['error']>, fromVersion = 0): ImportPlan {
    return { doc: null, report: { ok: false, fromVersion, changes: [], clamped: [], dropped: [], unknown: [], collections: emptyCounts(), error } };
}

/**
 * Checks every incoming value against its def: out of range is clamped and reported, a wrong type
 * or option is dropped and reported, an unknown id is kept (it may belong to a newer version).
 */
function sanitize(raw: PrefsSettings, schema: Schema, presets: PresetResolver, currentDrone: string | undefined, r: ImportReport): PrefsSettings {
    const out: PrefsSettings = { global: {}, drone: {}, scene: {} };
    const unknown = new Set<string>();
    for (const e of entriesOf(raw)) {
        const def = schema.byId.get(e.id);
        if (!def) {
            unknown.add(e.id);
            putEntry(out, e.scope, e.key, e.id, clone(e.value));
            continue;
        }
        if (def.scope !== e.scope) {
            r.dropped.push({ id: e.id, why: `stored as ${e.scope}, but it is a ${def.scope} setting` });
            continue;
        }
        const bounds = def.type === 'number' ? boundsOf(def, presets, e.scope === 'drone' ? (e.key ?? undefined) : currentDrone) : undefined;
        const c = checkValue(def, e.value, bounds);
        if (!c.ok) {
            r.dropped.push({ id: e.id, why: c.reason });
            continue;
        }
        if (c.clamped) r.clamped.push(e.key === null ? e.id : `${e.id}@${e.key}`);
        putEntry(out, e.scope, e.key, e.id, c.value);
    }
    r.unknown = [...unknown].sort();
    return out;
}

/** Merge rules (A.4): profiles by device key, favourites as a union, history by id with the
 * latest lastFlown. Where the design is silent the rule is idempotent: merging a file twice
 * equals merging it once (stats take the larger total, the warning flag stays set). */
export function mergeCollection<K extends CollectionId>(k: K, cur: Collections[K], inc: Collections[K]): Collections[K] {
    switch (k) {
        case 'radioProfiles': {
            const a = cur as Collections['radioProfiles'], b = inc as Collections['radioProfiles'];
            return { v: 1, items: { ...clone(a.items), ...clone(b.items) }, last: clone(b.last ?? a.last) } as Collections[K];
        }
        case 'sceneLibrary': {
            const a = cur as Collections['sceneLibrary'], b = inc as Collections['sceneLibrary'];
            const byId = new Map<string, LibraryEntry>();
            for (const e of a.history) byId.set(e.id, e);
            for (const e of b.history) {
                const had = byId.get(e.id);
                if (!had || e.lastFlown >= had.lastFlown) byId.set(e.id, e);
            }
            const versions = { ...a.versions };
            for (const [id, v] of Object.entries(b.versions)) versions[id] = Math.max(v, versions[id] ?? 1);
            return clone({ v: 1, history: sortHistory([...byId.values()]), favourites: [...a.favourites, ...b.favourites.filter((f) => !a.favourites.includes(f))], filter: b.filter, versions }) as Collections[K];
        }
        case 'stats': {
            const a = cur as Collections['stats'], b = inc as Collections['stats'];
            const byDrone = clone(a.byDrone);
            for (const [id, t] of Object.entries(b.byDrone)) {
                const o = byDrone[id];
                byDrone[id] = o ? { flights: Math.max(o.flights, t.flights), airtimeS: Math.max(o.airtimeS, t.airtimeS), distanceM: Math.max(o.distanceM, t.distanceM), crashes: Math.max(o.crashes, t.crashes) } : { ...t };
            }
            return { v: 1, byDrone } as Collections[K];
        }
        case 'ui': {
            const a = cur as Collections['ui'], b = inc as Collections['ui'];
            return { v: 1, warned: a.warned || b.warned } as Collections[K];
        }
    }
    return clone(inc);
}

/** What a collection change amounts to for the preview ("1 radio, 3 favourites"). */
function countCollection(k: CollectionId, before: unknown, after: unknown): { added: number; changed: number } {
    const diffMaps = (a: Record<string, unknown>, b: Record<string, unknown>) => {
        let added = 0, changed = 0;
        for (const [id, v] of Object.entries(b)) {
            if (!(id in a)) added++;
            else if (canonicalJson(a[id]) !== canonicalJson(v)) changed++;
        }
        for (const id of Object.keys(a)) if (!(id in b)) changed++;
        return { added, changed };
    };
    switch (k) {
        case 'radioProfiles': {
            const a = before as Collections['radioProfiles'], b = after as Collections['radioProfiles'];
            const r = diffMaps(a.items, b.items);
            if (canonicalJson(a.last) !== canonicalJson(b.last)) r.changed++;
            return r;
        }
        case 'sceneLibrary': {
            const a = before as Collections['sceneLibrary'], b = after as Collections['sceneLibrary'];
            const r = diffMaps(Object.fromEntries(a.history.map((e) => [e.id, e])), Object.fromEntries(b.history.map((e) => [e.id, e])));
            r.added += b.favourites.filter((f) => !a.favourites.includes(f)).length;
            r.changed += a.favourites.filter((f) => !b.favourites.includes(f)).length;
            if (canonicalJson(a.filter) !== canonicalJson(b.filter)) r.changed++;
            if (canonicalJson(a.versions) !== canonicalJson(b.versions)) r.changed++;
            return r;
        }
        case 'stats':
            return diffMaps((before as Collections['stats']).byDrone, (after as Collections['stats']).byDrone);
        case 'ui':
            return { added: 0, changed: canonicalJson(before) === canonicalJson(after) ? 0 : 1 };
    }
    return { added: 0, changed: 0 };
}

/**
 * Plans an import. replace (the default, for moving computers): the file's settings replace all
 * settings, and each collection the file carries replaces ours. merge: the file's values win
 * setting by setting, and collections merge by the rules above.
 */
export function planImport(current: PrefsDoc, file: unknown, mode: ImportMode, schema: Schema, presets: PresetResolver, currentDrone: string | undefined, app?: string): ImportPlan {
    const p = parseDocInput(file);
    if (!p.ok) return fail(p.error, p.version ?? 0);
    const incoming = p.version < schema.version ? runMigrations(p.raw, p.version, { app }) : normalizeDoc(p.raw, app);
    const report: ImportReport = { ok: true, fromVersion: p.version, changes: [], clamped: [], dropped: [], unknown: [], collections: emptyCounts() };
    const settings = sanitize(incoming.settings, schema, presets, currentDrone, report);

    const rawCols = (p.raw.collections ?? {}) as Record<string, unknown>;
    const next = clone(current);
    if (mode === 'replace') next.settings = settings;
    else for (const e of entriesOf(settings)) putEntry(next.settings, e.scope, e.key, e.id, e.value);

    for (const k of COLLECTION_IDS) {
        if (rawCols[k] === undefined) continue;
        const inc = validateCollection(k, rawCols[k]);
        if (!inc) {
            report.dropped.push({ id: `collection.${k}`, why: 'type' });
            continue;
        }
        const merged = mode === 'replace' ? inc : mergeCollection(k, current.collections[k], inc);
        report.collections[k] = countCollection(k, current.collections[k], merged);
        (next.collections as unknown as Record<string, unknown>)[k] = merged;
    }

    // the preview lists known settings only; unknown ids are reported on their own
    const seen = new Set<string>();
    for (const e of [...entriesOf(current.settings), ...entriesOf(next.settings)]) {
        const k = JSON.stringify([e.scope, e.key, e.id]);
        if (seen.has(k) || !schema.byId.has(e.id)) continue;
        seen.add(k);
        const from = entryAt(current.settings, e.scope, e.key, e.id);
        const to = entryAt(next.settings, e.scope, e.key, e.id);
        if (canonicalJson(from) !== canonicalJson(to)) report.changes.push({ id: e.id, key: e.key, from: clone(from), to: clone(to) });
    }
    return { doc: next, report };
}
