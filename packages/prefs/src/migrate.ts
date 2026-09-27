// Migrations (A.5). Version 0 is the loose storage keys written before v0.3 (v0.2, and the releases
// on main after it), read once into a "legacy bag"; 0 -> 1 turns the bag into the first document.
// The legacy keys are only read, never written or removed, so rolling back still finds them;
// migration 1 -> 2 (v0.4) deletes them.

import { SCHEMA_VERSION } from './schema';
import { DEFAULT_FILTER, PREFS_APP_VERSION, emptyDoc, isReservedKey, normalizeDoc, sortHistory, validFilter, validLastInput, validLibraryEntry, validRadioProfile, VERSIONS_CAP } from './doc';
import type { LibraryEntry, PrefsDoc, RadioProfileItem } from './doc';
import { VOXEL_STYLES } from './defs/voxels';
import { WALLS_OPTIONS } from './defs/scene';

/** Every fixed storage key the simulator writes before v0.3 (apps/fly/src, packages/scenes), by what it holds. */
export const LEGACY_KEYS = {
    profiles: 'gsfpv.profiles.v1', // Record<deviceKey, Profile> (controls.ts)
    stickMode: 'gsfpv.stickMode', // '1' | '2' (controls.ts)
    lastInput: 'gsfpv.lastInput', // { kind, key? } (controls.ts)
    history: 'gsfpv.history.v1', // HistoryEntry[] (scenes)
    favourites: 'gsfpv.favourites.v1', // string[] (scenes)
    filter: 'gsfpv.filter.v1', // SceneFilter (scenes)
    versions: 'gsfpv.versions.v1', // [id, version][] of republished scenes (scenes)
    warned: 'gsfpv.warned', // '1' after the first-visit warning (main.ts)
    lastLog: 'gsfpv.lastLog', // { label, header, endTick, hash, b64 } (main.ts) -> IndexedDB, not the doc
    voxels: 'gsfpv.voxels' // { style, opacityOverlay, opacityOnly } (voxels.ts, main after v0.2)
} as const;

/** Keys with the scene id after the prefix: one key per scan (flightwalls.ts, main after v0.2). */
export const LEGACY_PREFIXES = {
    walls: 'gsfpv.walls.' // 'on' | 'off': the pilot's walls switch for that scan
} as const;

/**
 * Keys the simulator writes that are not preferences, so they never move into the document, are
 * never exported and never follow the pilot to another computer. Each with the reason. A test
 * scans the sources: a new key must be a legacy key, a legacy prefix or listed here.
 */
export const MACHINE_LOCAL_KEYS: Readonly<Record<string, string>> = {
    // wallcache.ts: seconds per million Gaussians the last walls bake took on this machine
    // (download included). A measurement of this PC's GPU and network that sizes the next refine,
    // not a choice: another computer bakes at its own speed, and a pilot never sets it.
    'gsfpv.bakeSecondsPerMillion': "this machine's measured walls-bake speed, a calibration of its GPU and network, not a pilot's choice"
};

export interface LegacyBag { format: 'gsfpv-legacy'; version: 0; keys: Record<string, string> }

/**
 * Reads the legacy keys through a read-only accessor (a throwing read counts as absent). `keys`
 * lists the storage's keys, for the per-scan ones (LEGACY_PREFIXES); without it they are not
 * found. Machine-local keys are never read.
 */
export function readLegacy(read: (key: string) => string | null, keys?: () => readonly string[]): LegacyBag {
    const out: Record<string, string> = {};
    const take = (k: string) => {
        if (Object.hasOwn(MACHINE_LOCAL_KEYS, k)) return;
        let v: string | null = null;
        try {
            v = read(k);
        } catch {
            v = null;
        }
        if (typeof v === 'string') out[k] = v;
    };
    for (const k of Object.values(LEGACY_KEYS)) take(k);
    let all: readonly string[] = [];
    try {
        all = keys?.() ?? [];
    } catch {
        all = [];
    }
    for (const k of [...all].sort()) if (Object.values(LEGACY_PREFIXES).some((p) => k.startsWith(p) && k.length > p.length)) take(k);
    return { format: 'gsfpv-legacy', version: 0, keys: out };
}

export interface MigrateOptions {
    app?: string;
    savedAt?: string;
    /** reserved keys dropped from the result (doc.ts RESERVED_KEYS) are listed here (import reports them) */
    dropped?: string[];
}
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
                // a reserved device key would set the map's prototype (doc.ts RESERVED_KEYS)
                if (r && !isReservedKey(r.deviceKey)) {
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
                if (Array.isArray(e) && typeof e[0] === 'string' && e[0] && !isReservedKey(e[0]) && Number.isInteger(e[1]) && e[1] > 1 && !Object.hasOwn(versions, e[0])) versions[e[0]] = e[1];
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

    fromLegacyVoxels(bag, doc, note);
    fromLegacyWalls(bag, doc, note);
    // lastLog goes to IndexedDB (browser.ts migrateLastLog); it is not part of the document
    return doc;
}

/**
 * What main's voxels.ts wrote for a field the pilot never changed (its DEFAULT_PREFS; a test keeps
 * the two equal). main saved the whole object at every change, so a stored field equal to this is
 * no evidence of a choice and is not migrated: a later change of the default reaches that pilot.
 */
export const MAIN_VOXEL_DEFAULTS = { style: 'wire', opacityOverlay: 0.55, opacityOnly: 1 } as const;

/** gsfpv.voxels -> voxels.style, voxels.opacity, voxels.opacityOnly: main's loadVoxelPrefs rules (an unknown style or an opacity outside 0.05-1 was its default). */
function fromLegacyVoxels(bag: LegacyBag, doc: PrefsDoc, note: MigrationNote): void {
    const K = LEGACY_KEYS.voxels;
    const v = json(bag, K, note);
    if (v === undefined) return;
    if (!v || typeof v !== 'object' || Array.isArray(v)) {
        note.ignored.push({ key: K, why: 'not an object' });
        return;
    }
    const o = v as Record<string, unknown>;
    const why: string[] = [];
    let moved = false;
    if (o.style !== undefined) {
        if (typeof o.style !== 'string' || !VOXEL_STYLES.includes(o.style)) why.push(`style '${String(o.style)}' is not one of ${VOXEL_STYLES.join(', ')}`);
        else if (o.style !== MAIN_VOXEL_DEFAULTS.style) {
            doc.settings.global['voxels.style'] = o.style;
            moved = true;
        }
    }
    for (const [field, id] of [['opacityOverlay', 'voxels.opacity'], ['opacityOnly', 'voxels.opacityOnly']] as const) {
        const x = o[field];
        if (x === undefined) continue;
        if (typeof x !== 'number' || !(x >= 0.05 && x <= 1)) why.push(`${field} ${String(x)} is not within 0.05-1`);
        else if (x !== MAIN_VOXEL_DEFAULTS[field]) {
            doc.settings.global[id] = x;
            moved = true;
        }
    }
    if (moved) note.moved.push(K);
    if (why.length) note.ignored.push({ key: K, why: why.join('; ') });
}

/** A SuperSplat scene id as main keys it (packages/scenes parseSceneInput: 6-32 hex digits, lower case). */
const SCENE_ID = /^[0-9a-f]{6,32}$/;

/** gsfpv.walls.<scene> -> scene.walls of that scene. main wrote it only when the pilot switched, so each one is a choice. */
function fromLegacyWalls(bag: LegacyBag, doc: PrefsDoc, note: MigrationNote): void {
    const P = LEGACY_PREFIXES.walls;
    for (const [key, value] of Object.entries(bag.keys)) {
        if (!key.startsWith(P)) continue;
        const scene = key.slice(P.length);
        if (!SCENE_ID.test(scene) || isReservedKey(scene)) note.ignored.push({ key, why: `'${scene}' is not a scene id` });
        else if (!WALLS_OPTIONS.includes(value)) note.ignored.push({ key, why: `value '${value}' is not on or off` });
        else {
            (doc.settings.scene[scene] ??= {})['scene.walls'] = value;
            note.moved.push(key);
        }
    }
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
    const doc = normalizeDoc(v as Record<string, unknown>, o.app, o.dropped);
    doc.version = SCHEMA_VERSION;
    return doc;
}

export interface LegacyMigration { doc: PrefsDoc; note: MigrationNote; found: string[] }

/**
 * First v0.3 boot: the legacy keys into a document. Pure: the same keys always give the same
 * document. `keys` lists the storage's keys, for the per-scan ones (LEGACY_PREFIXES).
 */
export function migrateLegacy(read: (key: string) => string | null, o: MigrateOptions = {}, keys?: () => readonly string[]): LegacyMigration {
    const bag = readLegacy(read, keys);
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
