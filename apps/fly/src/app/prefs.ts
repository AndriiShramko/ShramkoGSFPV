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
// Owner from wave 2: W2-1 (settings UI and persistence) extends this file.
import { SCHEMA, openBrowserPrefs, settingsFromQuery } from '@gsfpv/prefs';
import type { BrowserOptions, Ctx, MigrationInfo, PrefsFile, PrefsStore, PresetResolver, Schema, Scope, SetResult } from '@gsfpv/prefs';
import type { PresetJson } from '@gsfpv/sim-core';
import type { ShowcaseScene } from '../ui/scenes';
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

let page: { store: PrefsStore; dispose(): void } | null = null;

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
    const opened = openBrowserPrefs(schema, presetResolver(presets, showcase), { storageManager: null, ...browser });
    for (const v of settingsFromQuery(schema, query).values) opened.store.setSession(v.id, v.value);
    page = { store: opened.store, dispose: opened.dispose };
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

/** controls.ts setStickMode: the pilot picked a stick mode on the Controls screen. */
export function mirrorStickMode(m: 1 | 2, store: PrefsStore | null = pagePrefs()): void {
    store?.set('input.stickMode', String(m));
}

/**
 * app/walls.ts: the pilot switched the walls of `scene`. Remembered (the walls menu, C, Settings):
 * the pilot's choice for that scan, and any ?walls= of this load no longer describes the flight.
 * Not remembered (the test hook): this load only, like ?walls=.
 */
export function mirrorWallsChoice(scene: string, on: boolean, remember: boolean, store: PrefsStore | null = pagePrefs()): void {
    if (!store) return;
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
        flush: () => store.flush()
    };
}
