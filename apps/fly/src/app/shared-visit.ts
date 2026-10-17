// The receiver's half of a shared link's scene settings (v0.9 lane C, item 15 of the owner's message 22;
// the sender's half is share/shared.ts, the text of the link @gsfpv/scenes shared-settings.ts).
//
// A link that carries settings (/fly/?scene=<id>&sz=3&wl=0&...) opens the scene with them for that visit,
// without touching the pilot's saved settings: boot.ts reads them once (parseSharedSettings) and puts
// them into the store's VISIT layer for that one scene (PrefsStore.setVisit: read only for that scene,
// never stored). Everything that reads a setting for a scene already asks the store with the scene named
// (wallsWanted, storedTransform, storedDropFloaters, storedCeiling, windFor), so the flight starts with
// them and a Reset (clearVisit) reaches the flight live, as any change of the store does. The drone is
// the simulator's own ?drone=, which the store's URL layer holds for the page (app/prefs.ts linkSettings).
//
// This file is the pure part (tools/bench/test/shared-visit.test.ts): the mapping to setting ids, what is
// still shared, the chip's items, Keep and Reset on the store. The chip and the address bar are
// app/builtin/shared-settings.ts's. The visit lives while the pilot is on that scene: a scene switch ends it.
import { isEmptyShared } from '@gsfpv/scenes';
import type { SharedSettings } from '@gsfpv/scenes';
import type { PrefsStore } from '@gsfpv/prefs';
import { forgetLinkValue, pilotSet } from './prefs';

/** One shared item and the settings of the store it becomes: `main` tells whether the item still stands. */
interface Item {
    item: keyof SharedSettings;
    main: string;
    entries: [id: string, value: unknown][];
}

/** The store settings each item of a share becomes (the drone is not here: it is the URL layer's). */
export function visitItems(s: SharedSettings): Item[] {
    const out: Item[] = [];
    if (s.size !== undefined) out.push({ item: 'size', main: 'scene.transform', entries: [['scene.transform', { s: s.size, t: [0, 0, 0], v: 0 }]] });
    if (s.walls !== undefined) out.push({ item: 'walls', main: 'scene.walls', entries: [['scene.walls', s.walls]] });
    if (s.floaters !== undefined) out.push({ item: 'floaters', main: 'scene.dropFloaters', entries: [['scene.dropFloaters', s.floaters]] });
    if (s.wind !== undefined) {
        out.push({
            item: 'wind',
            main: 'wind.mode',
            entries: s.wind === 'off'
                ? [['wind.mode', 'off']]
                : [['wind.mode', 'custom'], ['wind.fromDeg', s.wind.fromDeg], ['wind.speed', s.wind.speed], ['wind.gust', s.wind.gust]]
        });
    }
    if (s.ceiling !== undefined) {
        out.push({ item: 'ceiling', main: 'scene.ceiling', entries: s.ceiling === 'off' ? [['scene.ceiling', 'off']] : [['scene.ceiling', 'custom'], ['scene.ceilingM', s.ceiling]] });
    }
    return out;
}

/**
 * Puts the settings of a shared link into the visit layer of `scene`; returns what stands (an item whose
 * setting the store refused is taken out again, whole). `link`: the settings the page's URL layer holds
 * (app/prefs.ts linkSettings), which is where the drone comes in.
 */
export function applyShared(prefs: PrefsStore, scene: string, shared: SharedSettings, link: ReadonlyMap<string, string>): SharedSettings {
    const applied: SharedSettings = {};
    for (const it of visitItems(shared)) {
        const done: string[] = [];
        let ok = true;
        for (const [id, value] of it.entries) {
            if (prefs.setVisit(scene, id, value).ok) done.push(id);
            else { ok = false; break; }
        }
        if (ok) (applied as Record<string, unknown>)[it.item] = shared[it.item];
        else for (const id of done) prefs.clearVisit(scene, id);
    }
    if (shared.drone !== undefined && link.has('drone.current') && prefs.get('drone.current') === shared.drone) applied.drone = shared.drone;
    return applied;
}

/** The part of `applied` that still stands: a setting the pilot changed himself has left the visit layer, and his value counts. */
export function stillShared(prefs: PrefsStore, scene: string, applied: SharedSettings, link: ReadonlyMap<string, string>): SharedSettings {
    const live = prefs.visitOf(scene);
    const out: SharedSettings = {};
    for (const it of visitItems(applied)) if (Object.hasOwn(live, it.main)) (out as Record<string, unknown>)[it.item] = applied[it.item];
    if (applied.drone !== undefined && link.has('drone.current') && prefs.get('drone.current') === applied.drone) out.drone = applied.drone;
    return out;
}

/** The visit in progress: the scene it is for and what was applied (set by boot.ts, read by the chip). */
export interface SharedVisit {
    scene: string;
    applied: SharedSettings;
}

let current: SharedVisit | null = null;

/** The visit of this page, or null when no shared link brought settings. */
export function sharedVisit(): SharedVisit | null {
    return current;
}

/** A link brought settings for `scene` (nothing is remembered for an empty set). */
export function beginSharedVisit(scene: string, applied: SharedSettings): void {
    current = isEmptyShared(applied) ? null : { scene, applied };
}

/** The visit is over (Keep, Reset, a scene switch, or every item changed by the pilot). */
export function endSharedVisit(): void {
    current = null;
}

/** One entry of the chip: the i18n key of its words and what fills them. */
export interface ChipItem {
    key: string;
    args: Record<string, string | number>;
}

const num = (n: number): string => String(Number(n.toFixed(2)));

/** What the chip's words need from the page: the preset's name, and a ceiling height as the pilot reads it. */
export interface ChipWords {
    /** names the drone preset (the page has the presets; this file does not) */
    droneName?: (id: string) => string;
    /** a ceiling in scan metres as metres above the start at the size flown (builtin ceiling panel); scan metres when absent */
    ceilingHeight?: (scanM: number) => number;
}

/** The chip's words for the settings that stand, in the link's order: `shared.item.<what>` with its numbers. */
export function chipItems(s: SharedSettings, w: ChipWords = {}): ChipItem[] {
    const droneName = w.droneName ?? ((id: string) => id);
    const ceilingHeight = w.ceilingHeight ?? ((c: number) => c);
    const out: ChipItem[] = [];
    if (s.size !== undefined) out.push({ key: 'shared.item.size', args: { x: num(s.size) } });
    if (s.walls !== undefined) out.push({ key: s.walls === 'off' ? 'shared.item.wallsOff' : 'shared.item.wallsOn', args: {} });
    if (s.floaters !== undefined) out.push(s.floaters === 0 ? { key: 'shared.item.floatersOff', args: {} } : { key: 'shared.item.floaters', args: { n: s.floaters } });
    if (s.wind !== undefined) out.push(s.wind === 'off' ? { key: 'shared.item.windOff', args: {} } : { key: 'shared.item.wind', args: { speed: num(s.wind.speed), from: Math.round(s.wind.fromDeg) } });
    if (s.ceiling !== undefined) out.push(s.ceiling === 'off' ? { key: 'shared.item.ceilingOff', args: {} } : { key: 'shared.item.ceiling', args: { h: num(ceilingHeight(s.ceiling)) } });
    if (s.drone !== undefined) out.push({ key: 'shared.item.drone', args: { name: droneName(s.drone) } });
    return out;
}

/**
 * Keep: the shared settings become the pilot's own, as if he had set each by hand. The drone goes through
 * pilotSet, which stores it and lets the URL layer go of it. Returns the setting ids stored.
 */
export function keepShared(prefs: PrefsStore, visit: SharedVisit): string[] {
    const kept = prefs.keepVisit(visit.scene);
    if (visit.applied.drone !== undefined && prefs.get('drone.current') === visit.applied.drone && pilotSet(prefs, 'drone.current', visit.applied.drone).ok) kept.push('drone.current');
    return kept;
}

/** Reset: the pilot's own settings again (the visit layer and the URL layer's drone let go; nothing is stored). */
export function resetShared(prefs: PrefsStore, visit: SharedVisit): void {
    prefs.clearVisit(visit.scene);
    if (visit.applied.drone !== undefined) forgetLinkValue(prefs, 'drone.current');
}
