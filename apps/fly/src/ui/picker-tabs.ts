// Extra tabs of the scene picker (docs/architecture-v03.md E.6, E.8; lead contract step before wave 3).
// A feature registers a tab here (the SuperSplat catalogue, W3-2) instead of editing ui/scenes.ts:
// the picker shows its built-in tabs (Showcase, Recent, Favourites) and then every registered tab in
// `order`, and when one is selected it hands the tab the list area. The tab picks a scene through
// the host, exactly like a card or a pasted link does (parseSceneInput -> resolveScene).
import type { SceneFilter } from '@gsfpv/scenes';

/** Where a picked scene came from (the scene_open beacon; apps/api/server.py EVENTS keeps the same list). */
export type PickSource = 'showcase' | 'paste' | 'history' | 'superspl' | 'random' | 'next' | 'favourite';

export interface PickerTabHost {
    /** fly this scene: an id or any SuperSplat link (an invalid one shows the picker's invalid-link message) */
    pick(idOrLink: string, source: PickSource): void;
    /** show a message in the picker's error line (codes as ScenePicker.showError) */
    showError(code: string, msg?: string): void;
    /** the picker's filter as the pilot set it (collision only, kind, flown) */
    readonly filter: Readonly<SceneFilter>;
}

export interface PickerTab {
    /** data-tab value and the id in the picker's tablist; unique */
    id: string;
    /** i18n key of the tab's label */
    labelKey: string;
    /** built-ins use 10 (Showcase), 20 (Recent), 30 (Favourites) */
    order: number;
    /** true: the picker hides its own filter row while this tab is open (the tab has its own) */
    ownFilters?: boolean;
    /** fill `host` (the picker's list area, already empty); return a cleanup run when another tab opens or the picker goes */
    mount(host: HTMLElement, ctx: PickerTabHost): (() => void) | void;
}

const registry: PickerTab[] = [];

/** Register a tab for every picker opened from now on; returns the unregister function. */
export function registerPickerTab(tab: PickerTab): () => void {
    if (registry.some((t) => t.id === tab.id) || ['showcase', 'recent', 'favourites'].includes(tab.id)) throw new Error(`picker tab "${tab.id}" exists`);
    registry.push(tab);
    registry.sort((a, b) => a.order - b.order);
    return () => {
        const i = registry.indexOf(tab);
        if (i >= 0) registry.splice(i, 1);
    };
}

export function pickerTabs(): readonly PickerTab[] {
    return registry;
}
