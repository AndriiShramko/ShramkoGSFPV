// The page's tour (packages/scenes tour.ts; v0.9 lane N, the owner's item 9): the one ordered source of N
// and of the scene after a crash. This file only wires the pure tour to the page: the owner's catalogue
// the page loaded, the library's failed list, the SuperSplat tab's defaults read through the same caching
// proxy and the same session cache as the tab, and (only when asked, PageTourOptions.remember) localStorage
// for the position between visits.
import { SceneTour, SuperSplatCatalog, catalogueOrder, failedRecently, getFilter, getLibrary } from '@gsfpv/scenes';
import type { CatalogScene, CatalogStore, TourPages, TourStorage } from '@gsfpv/scenes';
import type { PrefsStore } from '@gsfpv/prefs';
import { defaultFilters, toQuery } from '../ui/superspl-tab-logic';

/** This tab's session storage when it works (the proxy's pages are kept there), else memory only. */
function sessionStore(): CatalogStore | undefined {
    try {
        const s = window.sessionStorage;
        s.getItem('gsfpv.tour.probe');
        return s;
    } catch {
        return undefined;
    }
}

/** localStorage for the position; every call may throw (blocked storage), the tour guards each one. */
const position: TourStorage = {
    getItem: (k) => localStorage.getItem(k),
    setItem: (k, v) => localStorage.setItem(k, v)
};

/**
 * The SuperSplat list the tour reads: the SuperSplat tab's defaults (trending, all time). Walkable only
 * while the picker's walls filter is on and the setting "scenes without walls" is off: asked at every
 * page, so a changed setting applies from the next page.
 */
export function superSplatPages(catalog: SuperSplatCatalog, walkable: () => boolean): TourPages {
    return async (skip, limit) => {
        const page = await catalog.explore(toQuery(defaultFilters(walkable()), skip, limit));
        return { items: page.items.map((it) => ({ id: it.id, format: it.format })), total: page.total };
    };
}

export interface PageTourOptions {
    /** a SuperSplat page is about to be read from the network (the host says "looking" if it drags on) */
    onSearch?(): void;
    /**
     * Keep the place in the walk between visits (localStorage, 30 days). Off: every visit walks the owner's
     * list from its start, so N on a second day does not jump to SuperSplat (decision D45; the owner has not
     * asked for a memory). Turning it on is this one flag.
     */
    remember?: boolean;
}

/** The tour of this page: `scenes` is the owner's catalogue as the page loaded it. */
export function pageTour(scenes: readonly CatalogScene[], prefs: PrefsStore, o: PageTourOptions = {}): SceneTour {
    const catalog = new SuperSplatCatalog({ store: sessionStore() });
    return new SceneTour({
        catalogue: () => catalogueOrder(scenes),
        failed: (id) => failedRecently(getLibrary(), id, Date.now()),
        pages: superSplatPages(catalog, () => getFilter().collisionOnly && prefs.get<boolean>('scenes.allowNoWalls') !== true),
        store: o.remember ? position : undefined,
        onSearch: o.onSearch
    });
}
