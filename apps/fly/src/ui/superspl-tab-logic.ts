// The SuperSplat tab's pure rules (no DOM, no i18n): filters <-> the proxy query, paging, what the
// random pick skips, error codes -> message keys, card labels. ui/scenes-superspl.ts draws them;
// tools/bench/test/app-superspl-tab.test.ts checks them. Owner's items 9 and 10, decision D35.
import { EXPLORE_BOUNDS, EXPLORE_TIMES, SuperSplatError } from '@gsfpv/scenes';
import type { ExploreItem, ExploreOrder, ExploreQuery, ExploreSort, ExploreTime } from '@gsfpv/scenes';

/** superspl.at's sort menu, in its order (trending / newest / oldest / most viewed / most liked / largest / smallest). */
export type SortKey = 'trending' | 'newest' | 'oldest' | 'views' | 'likes' | 'largest' | 'smallest';
export const SORT_KEYS: readonly SortKey[] = ['trending', 'newest', 'oldest', 'views', 'likes', 'largest', 'smallest'];

const SORT_QUERY: Record<SortKey, { sort: ExploreSort; order: ExploreOrder }> = {
    trending: { sort: 'trending', order: -1 },
    newest: { sort: 'createdAt', order: -1 },
    oldest: { sort: 'createdAt', order: 1 },
    views: { sort: 'views', order: -1 },
    likes: { sort: 'starred', order: -1 },
    largest: { sort: 'size', order: -1 },
    smallest: { sort: 'size', order: 1 }
};

/** Scenes per page: 2, 3 and 4 columns all end on a full row. */
export const PAGE_SIZE = 24;

export interface TabFilters {
    sort: SortKey;
    time: ExploreTime;
    walkable: boolean;
    downloadable: boolean;
    /** as typed; cleanSearch (packages/scenes) decides what is sent */
    search: string;
}

/** First visit: trending like superspl.at's front page; walkable follows the picker's "collision only" switch. */
export function defaultFilters(collisionOnly: boolean): TabFilters {
    return { sort: 'trending', time: 'all', walkable: collisionOnly, downloadable: false, search: '' };
}

/** Trending is all-time on superspl.at, so the time menu does nothing there. */
export function timeApplies(sort: SortKey): boolean {
    return sort !== 'trending';
}

export function toQuery(f: TabFilters, skip = 0, limit = PAGE_SIZE): ExploreQuery {
    const s = SORT_QUERY[f.sort] ?? SORT_QUERY.trending;
    const features: ExploreQuery['features'] = [];
    if (f.walkable) features.push('walkable');
    if (f.downloadable) features.push('downloadable');
    return { sort: s.sort, order: s.order, time: timeApplies(f.sort) ? f.time : 'all', features, search: f.search, skip, limit };
}

/** The remembered filters (search is not kept: it is for this visit). */
export function filtersToStore(f: TabFilters): string {
    return JSON.stringify({ sort: f.sort, time: f.time, walkable: f.walkable, downloadable: f.downloadable });
}

/** Reads what filtersToStore wrote; a damaged or unknown value falls back field by field. */
export function filtersFromStore(raw: string | null, fallback: TabFilters): TabFilters {
    let o: Record<string, unknown> = {};
    try {
        const v = raw ? (JSON.parse(raw) as unknown) : null;
        if (v && typeof v === 'object' && !Array.isArray(v)) o = v as Record<string, unknown>;
    } catch {
        /* damaged: defaults */
    }
    return {
        sort: SORT_KEYS.includes(o.sort as SortKey) ? (o.sort as SortKey) : fallback.sort,
        time: EXPLORE_TIMES.includes(o.time as ExploreTime) ? (o.time as ExploreTime) : fallback.time,
        walkable: typeof o.walkable === 'boolean' ? o.walkable : fallback.walkable,
        downloadable: typeof o.downloadable === 'boolean' ? o.downloadable : fallback.downloadable,
        search: ''
    };
}

/** The grid after one more page: a scene already shown is not shown twice (trending moves between pages). */
export function appendPage(shown: readonly ExploreItem[], page: readonly ExploreItem[]): ExploreItem[] {
    const ids = new Set(shown.map((x) => x.id));
    const out = shown.slice();
    for (const it of page) if (!ids.has(it.id)) { ids.add(it.id); out.push(it); }
    return out;
}

interface PageLike { query: { skip: number; limit: number }; total: number; items: readonly unknown[] }

export function nextSkip(p: PageLike): number {
    return p.query.skip + p.query.limit;
}

/** Another page exists: this one was full, the total says more, and the proxy allows that skip. */
export function hasMore(p: PageLike): boolean {
    const next = nextSkip(p);
    return p.items.length >= p.query.limit && next < p.total && next <= EXPLORE_BOUNDS.skipMax;
}

/**
 * What "Random top-rated" must skip. The scene in the address (?scene=) is on screen or has just been
 * opened; when the picker shows a load error, that scene failed, so it joins the failed list for the
 * rest of this visit. An invalid pasted link is the pilot's typo, not a failed scene.
 */
export function randomExclusions(o: { urlScene: string | null; pickerError: string; invalidLinkText: string; failed: readonly string[] }): { current: string | null; broken: string[] } {
    const broken = [...new Set(o.failed)];
    const err = o.pickerError.trim();
    if (o.urlScene && err && err !== o.invalidLinkText.trim() && !broken.includes(o.urlScene)) broken.push(o.urlScene);
    return { current: o.urlScene, broken: broken.slice(-50) };
}

export type ErrorKey = 'busy' | 'rate-limited' | 'upstream' | 'offline' | 'network' | 'other';

/** A failure as the tab tells it: the message key (superspl.error.<key>) and the proxy's wait, if it gave one. */
export function errorView(e: unknown, online = true): { key: ErrorKey; retryAfterS: number | null } {
    if (!online) return { key: 'offline', retryAfterS: null };
    if (e instanceof SuperSplatError) {
        const wait = e.retryAfterS && e.retryAfterS > 0 ? Math.ceil(e.retryAfterS) : null;
        if (e.code === 'busy') return { key: 'busy', retryAfterS: wait };
        if (e.code === 'rate-limited') return { key: 'rate-limited', retryAfterS: wait };
        if (e.code === 'upstream') return { key: 'upstream', retryAfterS: wait };
        if (e.code === 'network') return { key: 'network', retryAfterS: null };
    }
    return { key: 'other', retryAfterS: null };
}

/** SuperSplat's licence code as people read it ('by-nc-sa' -> 'CC BY-NC-SA'); none when downloads are off. */
export function licenceLabel(code: string | null): string {
    return code ? `CC ${code.toUpperCase()}` : '';
}

/** Size in MB (or GB from 1000 MB), locale digits; key is the i18n unit (superspl.size.mb / .gb). */
export function sizeParts(bytes: number, locale: string): { key: 'mb' | 'gb'; n: string } | null {
    if (!(bytes > 0)) return null;
    const mb = bytes / 1e6;
    if (mb >= 1000) return { key: 'gb', n: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(mb / 1000) };
    return { key: 'mb', n: new Intl.NumberFormat(locale, { maximumFractionDigits: mb < 10 ? 1 : 0 }).format(mb) };
}

/** 55 711 -> "56K" / "56 тыс." as the locale writes it. */
export function countLabel(n: number, locale: string): string {
    return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}
