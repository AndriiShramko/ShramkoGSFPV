// The page's preferences store (docs/architecture-v03.md A.5, A.6; J "Lead contract step before
// wave 2"). boot.ts opens ONE PrefsStore per page, before the scene picker, on localStorage
// (openBrowserPrefs): the first v0.3 boot turns the v0.2 keys into the document, every later boot
// reads the document. Features reach it as ctx.prefs, the benches as window.__gsfpv.prefs.
//
// Wave 1 wiring, no visible change: every feature still reads and writes its own storage keys.
// Until wave 2 moves a reader and its writer onto the store, the writers of the settings the first
// boot migrated also write the store (mirror* below), so reading the store gives the value the app
// uses: the stick mode (controls.ts setStickMode), the walls switch per scan (app/walls.ts) and the
// first-visit warning (boot.ts). tools/bench/test/app-prefs.test.ts proves it, with controls.
// The other migrated values are a snapshot of the first v0.3 boot until their owners move them:
// radio profiles and the last input (W2-3), the scene library (W3-1), the voxel look (W3-4).
//
// Owner from wave 2: W2-1 (settings UI and persistence) extends this file. Wave 2 makes the store the
// truth for what the settings screen shows: the flight model and the camera are built from it
// (overridesFor, cameraFor), a pilot's change goes through pilotSet (stored, and the link's value for
// the same setting gives way, in the URL too), and the settings whose app code still keeps its own
// key follow the store through a bridge (the voxel look: bridgeVoxels; the walls: applyWalls).
import { COLLECTION_IDS, IdbKv, LEGACY_KEYS, LEGACY_PREFIXES, PREFS_KEY, SCHEMA, canonicalJson, openBrowserPrefs, settingsFromQuery } from '@gsfpv/prefs';
import type { BrowserOptions, CollectionId, Collections, Ctx, GroupId, ImportMode, ImportReport, MigrationInfo, PrefsFile, PrefsStore, PresetResolver, RatesValue, Schema, Scope, SetResult, ThrottleValue, PidValue } from '@gsfpv/prefs';
import type { GravityMode, ParamOverrides, PresetJson } from '@gsfpv/sim-core';
import type { ShowcaseScene } from '../ui/scenes';
import type { VoxelController, VoxelMode, VoxelPrefs, VoxelStyle } from '../voxels';
import { PRESETS } from '../presets';

/**
 * Drone preset fields and the admin's per-scan values (public/showcase.json) for the store's
 * defaults. field(): a numeric preset field (v_crash_ms, camera_fov_deg, ...); curated(): a
 * showcase entry's own field as written there ("walls": "off"); curatedScale(): its "scale"
 * (showcase v2, E.2; absent today, so a scene's size default is 1).
 */
export function presetResolver(presets: Readonly<Record<string, PresetJson>>, showcase: readonly ShowcaseScene[]): PresetResolver {
    const scenes = new Map<string, Readonly<Record<string, unknown>>>();
    for (const s of showcase) if (typeof s?.id === 'string' && !scenes.has(s.id)) scenes.set(s.id, s as unknown as Record<string, unknown>);
    const own = (scene: string, field: string): unknown => {
        const s = scenes.get(scene);
        return s && Object.hasOwn(s, field) ? s[field] : undefined;
    };
    return {
        field(id, key) {
            const p = Object.hasOwn(presets, id) ? presets[id] : undefined;
            const v = p && Object.hasOwn(p.fields, key) ? p.fields[key].value : undefined;
            return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
        },
        curatedScale(scene) {
            const v = own(scene, 'scale');
            return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined;
        },
        curated: own
    };
}

let page: { store: PrefsStore; dispose(): void; link: Map<string, string> } | null = null;

/**
 * Opens the page's store once (a second call returns the same store). `query`: the page's query
 * string (app/env.ts q); the settings it carries (?set.<id>=, and the legacy ?g= ?gm= ?drone=
 * ?walls= ...) go into the session layer, never stored, as the app applies them to this load.
 * `o`: the page's storage, window, document by default (tests pass fakes).
 */
export function openPagePrefs(showcase: readonly ShowcaseScene[], query: string, o: BrowserOptions & { schema?: Schema; presets?: Readonly<Record<string, PresetJson>> } = {}): PrefsStore {
    if (page) return page.store;
    const { schema = SCHEMA, presets = PRESETS, ...browser } = o;
    // storageManager null: no navigator.storage.persist() yet. Firefox answers it with a prompt,
    // which would be a visible change; W2-1 asks for it together with Settings -> Data (A.5).
    const resolver = presetResolver(presets, showcase);
    let opened: ReturnType<typeof openBrowserPrefs>;
    try {
        opened = openBrowserPrefs(schema, resolver, { storageManager: null, ...browser });
    } catch (e) {
        // nothing reads the store yet: a store that cannot open must not take the page down with it
        console.error('prefs: the stored settings could not be opened; this page keeps them in memory', e);
        opened = openBrowserPrefs(schema, resolver, { ...browser, storageManager: null, storage: null, openKv: () => Promise.reject(new Error('no storage')) });
    }
    // the link's settings, and the parameter each came from: a pilot's change of one takes it out of the URL
    const link = new Map<string, string>();
    for (const v of settingsFromQuery(schema, query).values) if (opened.store.setSession(v.id, v.value).ok) link.set(v.id, v.param);
    page = { store: opened.store, dispose: opened.dispose, link };
    return opened.store;
}

/** The page's store, or null before boot.ts opened it. */
export function pagePrefs(): PrefsStore | null {
    return page?.store ?? null;
}

/** Tests: forget the page's store (its listeners go, pending writes are flushed). */
export function closePagePrefs(): void {
    page?.dispose();
    page = null;
}

// ------------------------------------------------------------------ wave 1 bridges (see the header)

/**
 * While a bridge puts the store's value into an app key (applyWalls), the app's own writer must not
 * mirror it back: that would store a reset value as the pilot's explicit choice.
 */
let holdMirror = 0;

/** controls.ts setStickMode: the pilot picked a stick mode on the Controls screen. */
export function mirrorStickMode(m: 1 | 2, store: PrefsStore | null = pagePrefs()): void {
    if (holdMirror) return;
    store?.set('input.stickMode', String(m));
}

/**
 * app/walls.ts: the pilot switched the walls of `scene`. Remembered (the walls menu, C, Settings):
 * the pilot's choice for that scan, and any ?walls= of this load no longer describes the flight.
 * Not remembered (the test hook): this load only, like ?walls=.
 */
export function mirrorWallsChoice(scene: string, on: boolean, remember: boolean, store: PrefsStore | null = pagePrefs()): void {
    if (!store || holdMirror) return;
    const v = on ? 'on' : 'off';
    if (remember) {
        store.set('scene.walls', v, { scene });
        store.clearSession('scene.walls');
    } else store.setSession('scene.walls', v);
}

/** boot.ts: the pilot answered the first-visit warning. */
export function mirrorWarned(store: PrefsStore | null = pagePrefs()): void {
    store?.updateCollection('ui', (d) => { d.warned = true; });
}

// ------------------------------------------------------------------ the flight model from the store (W2-1)

/**
 * How each setting of the flight model becomes a field of sim-core's ParamOverrides (A.7: the
 * 'life' settings). One table, so the flight's start, the settings screen's close, the drone picker
 * and the Betaflight import all build the same model from the same values. Settings another agent
 * ships later (crash.enabled: W2-2; level.*: W2-3) are mapped already: they only flip their status.
 * Camera FOV and uptilt are not here: they are render-only (D-h, applyCamera).
 */
const PARAM_FIELDS: Readonly<Record<string, (o: ParamOverrides, v: unknown) => void>> = {
    'physics.vCrash': (o, v) => { o.vCrash = v as number; },
    'physics.gravity': (o, v) => { o.gravity = v as number; },
    'physics.gravityMode': (o, v) => { o.gravityMode = v as GravityMode; },
    'physics.twr': (o, v) => { o.twr = v as number; },
    'physics.tauMs': (o, v) => { o.tauMs = v as number; },
    'physics.dragScale': (o, v) => { o.cdaScale = v as number; },
    'physics.ductDrag': (o, v) => { o.ductDrag = v as number; },
    'physics.propInertia': (o, v) => { o.propInertia = v as number; },
    // the setting is a percentage, sim-core a fraction (0.055 = Betaflight dshot_idle_value 550)
    'physics.idlePct': (o, v) => { o.idle = (v as number) / 100; },
    'tune.pid': (o, v) => { const p = v as PidValue; o.pid = { roll: [...p.roll], pitch: [...p.pitch], yaw: [...p.yaw] }; },
    'tune.rates': (o, v) => { const r = v as RatesValue; o.rates = { type: r.type, roll: { ...r.roll }, pitch: { ...r.pitch }, yaw: { ...r.yaw }, rateLimit: r.rateLimit }; },
    'tune.throttle': (o, v) => { const t = v as ThrottleValue; o.throttle = { mid: t.mid, expo: t.expo }; },
    'crash.enabled': (o, v) => { o.crashOn = v as boolean; },
    'level.angleLimitDeg': (o, v) => { o.level = { ...o.level, limitDeg: v as number }; },
    'level.strength': (o, v) => { o.level = { ...o.level, gain: v as number }; },
    'level.horizonStrength': (o, v) => { o.level = { ...o.level, horizonStrength: v as number }; }
};

/** The settings that build the flight model (overridesFor), by id. */
export const FLIGHT_MODEL_SETTINGS: readonly string[] = Object.keys(PARAM_FIELDS);

/**
 * The flight model's overrides for `drone`, from the store (A.6, A.7). Only what differs from the
 * drone's preset goes in: a value the pilot chose, or one the URL set for this load. The preset
 * fills the rest, so the log header lists exactly the pilot's changes. Per-drone values are this
 * drone's own: one drone's tune never reaches another (D-c; review findings C1, C10).
 */
export function overridesFor(store: PrefsStore, drone: string): ParamOverrides {
    const o: ParamOverrides = {};
    const ctx: Ctx = { drone };
    for (const [id, put] of Object.entries(PARAM_FIELDS)) {
        if (!store.schema.byId.has(id)) continue;
        const v = store.get(id, ctx);
        if (v === null || v === undefined) continue; // a tune of null: the preset's own
        if (!store.isExplicit(id, ctx) && canonicalJson(v) === canonicalJson(store.defaultOf(id, ctx))) continue;
        put(o, v);
    }
    return o;
}

/** The drone the store says is flown, as a preset that exists. */
export function droneOf(store: PrefsStore, presets: Readonly<Record<string, PresetJson>> = PRESETS): string {
    const d = store.get<string>('drone.current');
    return Object.hasOwn(presets, d) ? d : (store.defaultOf<string>('drone.current'));
}

/** The pilot's camera for `drone` (A.7, D-h): render-only, never part of the flight model. */
export function cameraFor(store: PrefsStore, drone: string): { fovDeg: number; uptiltDeg: number } {
    return { fovDeg: store.get<number>('camera.fovDeg', { drone }), uptiltDeg: store.get<number>('camera.uptiltDeg', { drone }) };
}

/** Puts the store's camera of the drone flown on the session: no new flight model, the craft never moves. */
export function applyCamera(session: { presetId: string; setCamera(fovDeg: number | null, uptiltDeg: number | null): void }, store: PrefsStore): void {
    const c = cameraFor(store, session.presetId);
    session.setCamera(c.fovDeg, c.uptiltDeg);
}

/**
 * The voxel grid's look and view, two ways (until W3-4 moves the controller onto the store): the
 * store is the truth, so at install and on every store change the controller takes the store's
 * values; a change made on the controller (the walls menu's block, V) goes into the store. The
 * controller's own key (gsfpv.voxels) is written only by its remembered setters, so `saved` tells a
 * pilot's change (remembered: it goes into the store) from a this-load-only one (?vopacity, the
 * test hook: it does not). The view (voxels.show) is this load's only in both.
 */
export function bridgeVoxels(store: PrefsStore, v: VoxelController, saved: () => VoxelPrefs): () => void {
    let applying = false;
    const toController = (): void => {
        applying = true;
        try {
            const style = store.get<VoxelStyle>('voxels.style'), over = store.get<number>('voxels.opacity'), only = store.get<number>('voxels.opacityOnly');
            if (v.prefs.style !== style || v.prefs.opacityOverlay !== over || v.prefs.opacityOnly !== only) {
                v.prefs.style = style;
                v.prefs.opacityOverlay = over;
                v.prefs.opacityOnly = only;
                v.configure({}); // draws the new look, not remembered in the controller's own key
            }
            const show = store.get<VoxelMode>('voxels.show');
            if (v.mode !== show) v.setMode(show);
        } finally {
            applying = false;
        }
    };
    const toStore = (): void => {
        if (applying) return;
        const k = saved();
        if (k.style === v.prefs.style && k.opacityOverlay === v.prefs.opacityOverlay && k.opacityOnly === v.prefs.opacityOnly) {
            if (store.get('voxels.style') !== v.prefs.style) store.set('voxels.style', v.prefs.style);
            if (store.get('voxels.opacity') !== v.prefs.opacityOverlay) store.set('voxels.opacity', v.prefs.opacityOverlay);
            if (store.get('voxels.opacityOnly') !== v.prefs.opacityOnly) store.set('voxels.opacityOnly', v.prefs.opacityOnly);
        }
        if (store.get('voxels.show') !== v.mode) store.set('voxels.show', v.mode);
    };
    toController();
    const offV = v.onChange(toStore);
    const offS = store.onChange((c) => { if (c.id.startsWith('voxels.')) toController(); });
    return () => { offV(); offS(); };
}

// ------------------------------------------------------------------ the pilot's changes (W2-1)

/** The settings this page's link set (?drone=, ?g=, ?set.<id>=...), each with its URL parameter. */
export function linkSettings(): ReadonlyMap<string, string> {
    return page?.link ?? new Map();
}

/**
 * The pilot changed a setting (the settings screen, the drone picker, the Betaflight import): it is
 * stored for good (A.6), and a value this page's link set for the same setting gives way to it,
 * in the session layer and in the address bar, so neither now nor after a reload does the link
 * win over what the pilot just chose (item 20). A setting that is never stored (persist: false)
 * lives in the session layer, so that layer is its value and stays.
 */
export function pilotSet(store: PrefsStore, id: string, value: unknown, ctx?: Ctx): SetResult {
    const r = store.set(id, value, ctx);
    if (r.ok) forgetLink(store, id);
    return r;
}

/** The pilot's reset of one setting: the default again, also over a link's value. */
export function pilotReset(store: PrefsStore, id: string, ctx?: Ctx): void {
    store.reset(id, ctx);
    forgetLink(store, id);
}

/** Every link value gives way (Reset all, Erase everything): the address bar keeps only what is not a setting. */
export function forgetAllLinks(store: PrefsStore): void {
    for (const id of [...linkSettings().keys()]) forgetLink(store, id);
    store.clearSession();
    // the session layer of the settings that are never stored is their value: back to the default too
    for (const d of store.schema.defs) if (d.persist === false) store.reset(d.id);
}

function forgetLink(store: PrefsStore, id: string): void {
    if (store.schema.byId.get(id)?.persist === false) return;
    store.clearSession(id);
    const param = page?.store === store ? page.link.get(id) : undefined;
    if (param === undefined || !page) return;
    page.link.delete(id);
    try {
        const u = new URL(location.href);
        u.searchParams.delete(param);
        history.replaceState(history.state, '', u);
    } catch {
        /* no history (tests): the session layer is cleared, which is what this load uses */
    }
}

/** The flight model the store describes: the drone flown and its overrides (only what differs from its preset). */
export function modelOf(store: PrefsStore, presets: Readonly<Record<string, PresetJson>> = PRESETS): { drone: string; overrides: ParamOverrides } {
    const drone = droneOf(store, presets);
    return { drone, overrides: overridesFor(store, drone) };
}

/** Does the session fly another model than the store describes? (undefined fields count as absent) */
export function modelDiffers(session: { presetId: string; overrides: ParamOverrides }, store: PrefsStore): boolean {
    const m = modelOf(store);
    return m.drone !== session.presetId || canonicalJson(m.overrides) !== canonicalJson(session.overrides);
}

/**
 * Puts the store's flight model on the session when it differs (A.7: 'life' settings, applied once):
 * a new flight model, and a craft in the air goes on from where it is (applyLifeSettings). true when
 * it changed anything. The flight's start, the settings screen's close, the drone picker and the
 * Betaflight import call this, so all four fly what the screen shows.
 */
export function applyModel(session: { presetId: string; overrides: ParamOverrides; applyLifeSettings(presetId: string, overrides: ParamOverrides): void }, store: PrefsStore): boolean {
    if (!modelDiffers(session, store)) return false;
    const m = modelOf(store);
    session.applyLifeSettings(m.drone, m.overrides);
    return true;
}

/** The part of the walls switch (app/walls.ts) the bridge uses. */
interface WallsLike { has(): boolean; on(): boolean; set(on: boolean, remember?: boolean): void }

const wallsKey = (scene: string): string => `${LEGACY_PREFIXES.walls}${scene}`;

/**
 * The walls of `scene` follow the store (until the walls' reader moves onto it, wave 3): the
 * switch is set to the store's value (a new flight model, like C), and the scan's own key, which
 * the next flight starts from (flightwalls.ts loadWallsChoice), says the same: the pilot's value
 * when explicit, nothing after a reset (so the admin's default rules again). The switch's mirror
 * into the store is held back meanwhile: a reset must not come back as an explicit value.
 * true when the switch changed.
 */
export function applyWalls(walls: WallsLike, store: PrefsStore, scene: string, storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null = safeStorage()): boolean {
    if (!walls.has() || !store.schema.byId.has('scene.walls')) return false;
    const ctx = { scene };
    const want = store.get<string>('scene.walls', ctx) === 'on';
    const explicit = store.isExplicit('scene.walls', ctx);
    let changed = false;
    holdMirror++;
    try {
        if (walls.on() !== want) {
            walls.set(want, true);
            changed = true;
        }
    } finally {
        holdMirror--;
    }
    try {
        if (explicit) storage?.setItem(wallsKey(scene), want ? 'on' : 'off');
        else storage?.removeItem(wallsKey(scene));
    } catch {
        /* blocked storage: the store's own banner says so */
    }
    return changed;
}

function safeStorage(): Storage | null {
    try {
        return globalThis.localStorage ?? null;
    } catch {
        return null;
    }
}

// ------------------------------------------------------------------ Settings -> Data (W2-1)

/** What Settings -> Data shows about the storage. */
export interface StorageStatus {
    /** false: private window, blocked or full storage; changes last until the tab closes */
    writable: boolean;
    persisted: 'yes' | 'no' | 'unknown';
    /** the stored document's size, in characters of its text */
    bytes: number;
}

export function storageStatus(store: PrefsStore, storage: Pick<Storage, 'getItem'> | null = safeStorage()): StorageStatus {
    let bytes = 0;
    try {
        bytes = storage?.getItem(PREFS_KEY)?.length ?? 0;
    } catch {
        bytes = 0;
    }
    return { writable: store.writable, persisted: store.persisted, bytes };
}

type StorageManagerLike = Pick<StorageManager, 'persisted' | 'persist'>;

function storageManager(): StorageManagerLike | null {
    try {
        return navigator.storage ?? null;
    } catch {
        return null;
    }
}

/** Reads navigator.storage.persisted() into the store (never a prompt). */
export async function readPersisted(store: PrefsStore, sm: StorageManagerLike | null = storageManager()): Promise<StorageStatus['persisted']> {
    try {
        if (sm?.persisted) store.persisted = (await sm.persisted()) ? 'yes' : 'no';
    } catch {
        /* keep the last known state */
    }
    return store.persisted;
}

/**
 * navigator.storage.persist(), only from the pilot's click in Settings -> Data (A.5, A.12: Firefox
 * answers it with a prompt, so never at boot or on a change).
 */
export async function askPersistence(store: PrefsStore, sm: StorageManagerLike | null = storageManager()): Promise<StorageStatus['persisted']> {
    if (!sm?.persist) return store.persisted;
    try {
        store.persisted = (await sm.persist()) ? 'yes' : 'no';
    } catch {
        /* keep the last known state */
    }
    return store.persisted;
}

/** The export file's name, A.4: gsfpv-settings-YYYY-MM-DD.json (the local date). */
export function exportFileName(now: Date = new Date()): string {
    const p = (n: number) => String(n).padStart(2, '0');
    return `gsfpv-settings-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}.json`;
}

/** The part of IdbKv (@gsfpv/prefs browser.ts) erasing uses. */
export interface EraseKv { keys(s: 'logs' | 'handles'): Promise<string[]>; delete(s: 'logs' | 'handles', k: string): Promise<void>; close(): void }

/**
 * Settings -> Data -> Erase everything: every setting, every collection (radios, scans, flight
 * stats, the first-visit answer), the link's values, the keys the app still reads until their owner
 * moves them onto the store (v0.2's keys: radios, stick mode, scans, voxels, walls per scan) and the
 * saved flight logs and recording folder in IndexedDB. The walls cache stays: it is this machine's
 * data, not the pilot's settings (browser.ts IDB_STORES). The caller reloads the page afterwards.
 */
export async function eraseEverything(store: PrefsStore, o: { storage?: Pick<Storage, 'length' | 'key' | 'removeItem'> | null; idb?: () => Promise<EraseKv> } = {}): Promise<void> {
    forgetAllLinks(store);
    store.resetAll({ settings: true, collections: COLLECTION_IDS });
    store.flush();
    const storage = o.storage !== undefined ? o.storage : safeStorage();
    const legacy: readonly string[] = Object.values(LEGACY_KEYS);
    const prefixes: readonly string[] = Object.values(LEGACY_PREFIXES);
    try {
        const keys: string[] = [];
        for (let i = 0; storage && i < storage.length; i++) {
            const k = storage.key(i);
            if (k !== null && (legacy.includes(k) || prefixes.some((p) => k.startsWith(p)))) keys.push(k);
        }
        for (const k of keys) storage?.removeItem(k);
    } catch {
        /* blocked storage: nothing was kept there either */
    }
    try {
        const kv = await (o.idb ?? (() => IdbKv.open()))();
        try {
            for (const s of ['logs', 'handles'] as const) for (const k of await kv.keys(s)) await kv.delete(s, k);
        } finally {
            kv.close();
        }
    } catch {
        /* no IndexedDB: nothing stored there */
    }
}

// ------------------------------------------------------------------ window.__gsfpv.prefs

/** What the benches drive: enough to read, change, reset and export, and to see what boot did. */
export interface PrefsHook {
    get(id: string, ctx?: Ctx): unknown;
    defaultOf(id: string, ctx?: Ctx): unknown;
    isExplicit(id: string, ctx?: Ctx): boolean;
    /** as the pilot would (stored, even when equal to the default) */
    set(id: string, value: unknown, ctx?: Ctx): SetResult;
    reset(id: string, ctx?: Ctx): void;
    explicitList(ctx?: Ctx): { id: string; scope: Scope; key: string | null; value: unknown }[];
    export(): PrefsFile;
    /** what the first v0.3 boot migrated (null: the document already existed) */
    migrated(): MigrationInfo | null;
    /** false: private window, blocked or full storage */
    writable(): boolean;
    /** write pending changes now (they are debounced 250 ms) */
    flush(): void;
    /** Settings -> Data and "Reset this group", as the screen calls them */
    resetGroup(group: GroupId, ctx?: Ctx): void;
    resetAll(o?: { settings?: boolean; collections?: readonly CollectionId[] }): void;
    previewImport(file: unknown, mode?: ImportMode): ImportReport;
    importFile(file: unknown, mode?: ImportMode): ImportReport;
    collection<K extends CollectionId>(k: K): Readonly<Collections[K]>;
    /** the flight model the store describes for a drone (the drone flown when omitted) */
    overrides(drone?: string): ParamOverrides;
}

export function prefsHook(store: PrefsStore): PrefsHook {
    return {
        get: (id, ctx) => store.get(id, ctx),
        defaultOf: (id, ctx) => store.defaultOf(id, ctx),
        isExplicit: (id, ctx) => store.isExplicit(id, ctx),
        set: (id, value, ctx) => store.set(id, value, ctx),
        reset: (id, ctx) => store.reset(id, ctx),
        explicitList: (ctx) => store.explicitList(ctx),
        export: () => store.exportFile(),
        migrated: () => store.migrated,
        writable: () => store.writable,
        flush: () => store.flush(),
        resetGroup: (group, ctx) => store.resetGroup(group, ctx),
        resetAll: (o) => store.resetAll(o),
        previewImport: (file, mode) => store.previewImport(file, mode),
        importFile: (file, mode) => store.importFile(file, mode),
        collection: (k) => store.collection(k),
        overrides: (drone) => overridesFor(store, drone ?? droneOf(store))
    };
}
