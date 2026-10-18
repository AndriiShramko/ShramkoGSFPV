// What a share carries of the sharer's scene settings (v0.9 lane C, item 15 of the owner's message 22),
// the sender's half: which of the settings the sharer flies a scene with differ from the scene's own
// defaults. The text of the link is @gsfpv/scenes shared-settings.ts (writer and strict reader); the
// receiver's half (the page's query -> the store's visit layer, the chip with Keep / Reset) is
// app/shared-visit.ts and app/builtin/shared-settings.ts.
//
// One reader for every place a share starts: a flight (top bar, L, pause, crash, stats, after a recording)
// and a picker card both read the store with the scene named, so what the sharer sees is what goes out,
// also when his own link brought some of it (the store's visit layer is read too). The scene's defaults
// are the store's defaults: the owner's Scene size, the catalogue's walls / floaters / ceiling / wind, the
// default drone. Nothing here touches the DOM or the page: share/page.ts asks the page's store.
//
// Not carried, on purpose: the live wind of the place (mode "now" is weather, not a setting), the view
// (camera, position), anything that is the pilot's and not the scene's (rates, controls, HUD).
import { readShared } from '@gsfpv/scenes';
import type { CatalogScene, SharedSettings } from '@gsfpv/scenes';
import type { PrefsStore } from '@gsfpv/prefs';
import { sceneCeiling, storedCeiling } from '../session/ceiling-source';
import { customWind, windMode } from '../session/wind-source';

/** What the sender reads of the store. */
export type SharedSource = Pick<PrefsStore, 'get' | 'defaultOf'>;

/** What the sender knows of the scene: the catalogue entry (wind, walls), and whether the scan has walls (null: not known yet). */
export interface SharedScene {
    meta?: Pick<CatalogScene, 'wind' | 'collision'>;
    hasWalls?: boolean | null;
}

const close = (a: number, b: number): boolean => Math.abs(a - b) < 5e-4;

/**
 * The settings the sharer flies `sceneId` with that differ from the scene's defaults, in the link's own
 * rounding (readShared). Empty when he flies it as it comes.
 */
export function sharedOf(prefs: SharedSource, sceneId: string, scene: SharedScene = {}): SharedSettings {
    const ctx = { scene: sceneId };
    const out: Record<string, unknown> = {};

    const size = prefs.get<{ s: number }>('scene.transform', ctx).s;
    if (!close(size, prefs.defaultOf<{ s: number }>('scene.transform', ctx).s)) out.size = size;

    // a scan without walls has nothing to switch (the flag is not known for a card of a scene never opened here: ask the catalogue)
    const hasWalls = scene.hasWalls ?? (scene.meta ? scene.meta.collision !== false : null);
    if (hasWalls !== false) {
        const walls = prefs.get<string>('scene.walls', ctx);
        if (walls !== prefs.defaultOf<string>('scene.walls', ctx) && (walls === 'on' || walls === 'off')) out.walls = walls;
    }

    const floaters = prefs.get<number>('scene.dropFloaters', ctx);
    if (floaters !== prefs.defaultOf<number>('scene.dropFloaters', ctx)) out.floaters = floaters;

    const own = scene.meta?.wind;
    const mode = windMode(prefs.get('wind.mode', ctx));
    if (mode === 'off') {
        // still air is no difference where the scene has none either
        if (own && (own.speed > 0 || own.gust > 0)) out.wind = 'off';
    } else if (mode === 'custom') {
        const c = customWind(prefs, sceneId);
        const calm = c.speed <= 0 && c.gust <= 0;
        const same = own ? close(c.fromDeg, own.fromDeg) && close(c.speed, own.speed) && close(c.gust, own.gust) : calm;
        if (!same) out.wind = calm ? 'off' : c;
    } // 'scene' is the scene's own wind; 'now' is today's weather at the place: neither is carried

    const ceiling = storedCeiling(prefs, sceneId);
    const sceneOwn = sceneCeiling(prefs, sceneId);
    // null is no ceiling at all: none against one differs, two heights differ when they are not the same height
    if (ceiling === null || sceneOwn === null ? ceiling !== sceneOwn : !close(ceiling, sceneOwn)) out.ceiling = ceiling ?? 'off';

    const drone = prefs.get<string>('drone.current');
    if (drone !== prefs.defaultOf<string>('drone.current')) out.drone = drone;

    return readShared(out);
}
