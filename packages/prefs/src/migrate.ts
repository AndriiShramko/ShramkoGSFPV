// Migrations (A.5). Version 0 is v0.2's loose storage keys, read once into a "legacy bag"; 0 -> 1
// turns the bag into the first document. The legacy keys are only read, never written or
// removed, so rolling back to v0.2 still finds them; migration 1 -> 2 (v0.4) deletes them.

import { SCHEMA_VERSION } from './schema';
import { DEFAULT_FILTER, PREFS_APP_VERSION, emptyDoc, normalizeDoc, sortHistory, validFilter, validLastInput, validLibraryEntry, validRadioProfile, VERSIONS_CAP } from './doc';
import type { LibraryEntry, PrefsDoc, RadioProfileItem } from './doc';

/** Every storage key the v0.2 simulator writes (apps/fly/src, packages/scenes), by what it holds. */
export const LEGACY_KEYS = {
    profiles: 'gsfpv.profiles.v1', // Record<deviceKey, Profile> (controls.ts)
    stickMode: 'gsfpv.stickMode', // '1' | '2' (controls.ts)
    lastInput: 'gsfpv.lastInput', // { kind, key? } (controls.ts)
    history: 'gsfpv.history.v1', // HistoryEntry[] (scenes)
    favourites: 'gsfpv.favourites.v1', // string[] (scenes)
    filter: 'gsfpv.filter.v1', // SceneFilter (scenes)
    versions: 'gsfpv.versions.v1', // [id, version][] of republished scenes (scenes)
    warned: 'gsfpv.warned', // '1' after the first-visit warning (main.ts)
    lastLog: 'gsfpv.lastLog' // { label, header, endTick, hash, b64 } (main.ts) -> IndexedDB, not the doc
} as const;

export interface LegacyBag { format: 'gsfpv-legacy'; version: 0; keys: Record<string, string> }

/** Reads the v0.2 keys through a read-only accessor (a throwing read counts as absent). */
export function readLegacy(read: (key: string) => string | null): LegacyBag {
    const keys: Record<string, string> = {};
    for (const k of Object.values(LEGACY_KEYS)) {
        let v: string | null = null;
        try {
            v = read(k);
        } catch {
            v = null;
        }
        if (typeof v === 'string') keys[k] = v;
    }
    return { format: 'gsfpv-legacy', version: 0, keys };
}

export interface MigrateOptions { app?: string; savedAt?: string }
export interface MigrationNote { moved: string[]; ignored: { key: string; why: string }[] }

export interface Migration {
    from: number;
    to: number;
    about: string;
    run(input: unknown, o: MigrateOptions, note: MigrationNote): unknown;
}

function json(bag: LegacyBag, key: string, note: MigrationNote): unknown {
    const s = bag.keys[key];
    if (s === undefined) return undefined;
    try {
        return JSON.parse(s);
    } catch {
        note.ignored.push({ key, why: 'not JSON' });
        return undefined;
    }
}

function fromLegacy(bag: LegacyBag, o: MigrateOptions, note: MigrationNote): PrefsDoc {
    const doc = emptyDoc(o.app ?? PREFS_APP_VERSION, o.savedAt);
    const K = LEGACY_KEYS;

    // stick mode: v0.2 wrote String(m) only when the pilot picked one, so it is an explicit choice
    const sm = bag.keys[K.stickMode];
    if (sm === '1' || sm === '2') {
        doc.settings.global['input.stickMode'] = sm;
        note.moved.push(K.stickMode);
    } else if (sm !== undefined) note.ignored.push({ key: K.stickMode, why: `value '${sm}' is not 1 or 2` });

    const profiles = json(bag, K.profiles, note);
    if (profiles !== undefined) {
        if (profiles && typeof profiles === 'object' && !Array.isArray(profiles)) {
            let n = 0;
            for (const p of Object.values(profiles as Record<string, unknown>)) {
                const r: RadioProfileItem | null = validRadioProfile(p);
                if (r) {
                    doc.collections.radioProfiles.items[r.deviceKey] = r;
                    n++;
                }
            }
            if (n) note.moved.push(K.profiles);
            if (n < Object.keys(profiles).length) note.ignored.push({ key: K.profiles, why: `${Object.keys(profiles).length - n} profile(s) this version cannot read` });
        } else note.ignored.push({ key: K.profiles, why: 'not a map of profiles' });
    }

    const last = json(bag, K.lastInput, note);
    if (last !== undefined) {
        const l = validLastInput(last);
        if (l) {
            doc.collections.radioProfiles.last = l;
            note.moved.push(K.lastInput);
        } else note.ignored.push({ key: K.lastInput, why: 'unknown input kind' });
    }

    // versions: v0.2 kept [id, version] pairs, newest first, only for republished scenes (> 1)
    const vers = json(bag, K.versions, note);
    const versions: Record<string, number> = {};
    if (vers !== undefined) {
        if (Array.isArray(vers)) {
            for (const e of vers) {
                if (Array.isArray(e) && typeof e[0] === 'string' && e[0] && Number.isInteger(e[1]) && e[1] > 1 && !(e[0] in versions)) versions[e[0]] = e[1];
                if (Object.keys(versions).length >= VERSIONS_CAP) break;
            }
            note.moved.push(K.versions);
        } else note.ignored.push({ key: K.versions, why: 'not a list of [id, version]' });
    }
    doc.collections.sceneLibrary.versions = versions;

    const hist = json(bag, K.history, note);
    if (hist !== undefined) {
        if (Array.isArray(hist)) {
            // a v0.2 entry has no version or airtime: the version comes from the versions list
            const entries = hist.map((h) => validLibraryEntry(h && typeof h === 'object' ? { ...h, version: versions[(h as { id?: string }).id ?? ''] ?? 1 } : h)).filter((e): e is LibraryEntry => e !== null);
            doc.collections.sceneLibrary.history = sortHistory(entries);
            note.moved.push(K.history);
        } else note.ignored.push({ key: K.history, why: 'not a list' });
    }

    const fav = json(bag, K.favourites, note);
    if (fav !== undefined) {
        if (Array.isArray(fav)) {
            doc.collections.sceneLibrary.favourites = [...new Set(fav.filter((x): x is string => typeof x === 'string' && x.length > 0))];
            note.moved.push(K.favourites);
        } else note.ignored.push({ key: K.favourites, why: 'not a list' });
    }

    const filt = json(bag, K.filter, note);
    if (filt !== undefined) {
        // v0.2 read it as { ...DEFAULT_FILTER, ...stored }
        doc.collections.sceneLibrary.filter = validFilter({ ...DEFAULT_FILTER, ...(filt && typeof filt === 'object' ? filt : {}) });
        note.moved.push(K.filter);
    }

    const warned = bag.keys[K.warned];
    if (warned !== undefined) {
        doc.collections.ui.warned = warned === '1';
        note.moved.push(K.warned);
    }
    // lastLog goes to IndexedDB (browser.ts migrateLastLog); it is not part of the document
    return doc;
}

export const MIGRATIONS: readonly Migration[] = [
    {
        from: 0,
        to: 1,
        about: 'v0.2 storage keys into the first document',
        run: (input, o, note) => {
            const bag = input as LegacyBag;
            if (!bag || bag.format !== 'gsfpv-legacy') throw new Error('migration 0 -> 1 needs a legacy bag');
            return fromLegacy(bag, o, note);
        }
    }
];

/** Runs the chain from `from` up to SCHEMA_VERSION; the result is a normalized document. */
export function runMigrations(input: unknown, from: number, o: MigrateOptions = {}, note: MigrationNote = { moved: [], ignored: [] }): PrefsDoc {
    let v = input;
    for (let at = from; at < SCHEMA_VERSION; ) {
        const m = MIGRATIONS.find((x) => x.from === at);
        if (!m) throw new Error(`no migration from version ${at}`);
        v = m.run(v, o, note);
        at = m.to;
    }
    const doc = normalizeDoc(v as Record<string, unknown>, o.app);
    doc.version = SCHEMA_VERSION;
    return doc;
}

export interface LegacyMigration { doc: PrefsDoc; note: MigrationNote; found: string[] }

/** First v0.3 boot: the v0.2 keys into a document. Pure: the same keys always give the same document. */
export function migrateLegacy(read: (key: string) => string | null, o: MigrateOptions = {}): LegacyMigration {
    const bag = readLegacy(read);
    const note: MigrationNote = { moved: [], ignored: [] };
    const doc = runMigrations(bag, 0, o, note);
    return { doc, note, found: Object.keys(bag.keys) };
}

/** v0.2's single saved flight log (main.ts saveLastLog), validated before it moves to IndexedDB. */
export interface LegacyLastLog { label: string; header: Record<string, unknown>; endTick: number; hash: string; b64: string }

export function parseLegacyLastLog(text: string | null): LegacyLastLog | null {
    if (!text) return null;
    try {
        const v = JSON.parse(text) as Partial<LegacyLastLog>;
        if (!v || typeof v !== 'object' || typeof v.label !== 'string' || !v.header || typeof v.header !== 'object' || !Number.isInteger(v.endTick) || typeof v.hash !== 'string' || typeof v.b64 !== 'string') return null;
        return { label: v.label, header: v.header as Record<string, unknown>, endTick: v.endTick as number, hash: v.hash, b64: v.b64 };
    } catch {
        return null;
    }
}
