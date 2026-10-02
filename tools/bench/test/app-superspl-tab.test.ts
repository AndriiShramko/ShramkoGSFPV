// W3-2: the SuperSplat tab's pure rules (apps/fly/src/ui/superspl-tab-logic.ts; docs/architecture-v03.md
// E.6, decision D35; owner's items 9, 10). Each claim has a negative control that must fire: the same
// assertion run on a deliberately wrong rule (or without the rule) fails.
import { describe, expect, it } from 'vitest';
import { normalizeQuery, pickRandomTopRated, supersplSearchUrl, SuperSplatError } from '../../../packages/scenes/src/superspl';
import type { ExploreItem, ExploreQuery } from '../../../packages/scenes/src/superspl';
import { SORT_KEYS, appendPage, defaultFilters, errorView, filtersFromStore, filtersToStore, hasMore, licenceLabel, nextSkip, randomExclusions, sizeParts, toQuery } from '../../../apps/fly/src/ui/superspl-tab-logic';
import type { TabFilters } from '../../../apps/fly/src/ui/superspl-tab-logic';

function item(id: string, likes = 10, format = 'sog'): ExploreItem {
    return { id, version: 1, title: id, author: 'a', license: null, downloadable: false, likes, views: 0, sizeBytes: 1, thumb: '', thumbs: { s: null, m: null, l: null, xl: null, mov: null }, createdAt: null, description: '', format, walkable: true };
}

/** superspl.at's own menu key for a query: the sort the "Open on SuperSplat" link carries. */
const uiKey = (q: ExploreQuery): string => new URL(supersplSearchUrl(q)).searchParams.get('sort') ?? '';

describe('filters -> the proxy query', () => {
    it('every sort of the menu lands on superspl.at\'s own menu entry of the same name', () => {
        for (const k of SORT_KEYS) expect(uiKey(toQuery({ ...defaultFilters(true), sort: k }))).toBe(k);
        // control: a swapped mapping (most liked asked as most viewed) is caught by the same round trip
        const wrong = (f: TabFilters): ExploreQuery => toQuery(f.sort === 'likes' ? { ...f, sort: 'views' } : f);
        expect(SORT_KEYS.filter((k) => uiKey(wrong({ ...defaultFilters(true), sort: k })) !== k)).toEqual(['likes']);
    });

    it('time applies except to trending; walkable and downloadable become features in the upstream order', () => {
        const f: TabFilters = { sort: 'newest', time: 'week', walkable: true, downloadable: true, search: ' old  church ', };
        const n = normalizeQuery(toQuery(f, 48));
        expect(n).toMatchObject({ sort: 'createdAt', order: -1, time: 'week', features: ['walkable', 'downloadable'], search: 'old church', skip: 48, limit: 24 });
        expect(normalizeQuery(toQuery({ ...f, sort: 'trending' })).time).toBe('all');
        // control: with neither box ticked no feature is asked (the boxes are what decides)
        expect(normalizeQuery(toQuery({ ...f, walkable: false, downloadable: false })).features).toEqual([]);
    });

    it('first visit: trending, and walkable follows the picker\'s "collision only" switch', () => {
        expect(defaultFilters(true)).toMatchObject({ sort: 'trending', walkable: true });
        expect(defaultFilters(false).walkable).toBe(false);
    });

    it('remembered filters survive a round trip; damage falls back field by field; search is not kept', () => {
        const f: TabFilters = { sort: 'largest', time: 'month', walkable: false, downloadable: true, search: 'castle' };
        expect(filtersFromStore(filtersToStore(f), defaultFilters(true))).toEqual({ ...f, search: '' });
        const fb = defaultFilters(true);
        expect(filtersFromStore('{"sort":"best","time":"month","walkable":"yes"}', fb)).toEqual({ ...fb, time: 'month' });
        expect(filtersFromStore('not json', fb)).toEqual(fb);
        expect(filtersFromStore(null, fb)).toEqual(fb);
    });
});

describe('paging', () => {
    it('a scene is never shown twice when the list moves between pages', () => {
        const a = [item('aaaaaa01'), item('aaaaaa02')];
        const out = appendPage(a, [item('aaaaaa02'), item('aaaaaa03')]);
        expect(out.map((x) => x.id)).toEqual(['aaaaaa01', 'aaaaaa02', 'aaaaaa03']);
        // control: a plain concatenation shows aaaaaa02 twice
        const plain = [...a, item('aaaaaa02'), item('aaaaaa03')].map((x) => x.id);
        expect(new Set(plain).size).toBeLessThan(plain.length);
    });

    it('"Load more" only while a full page came back and the total says more', () => {
        const full = { query: { skip: 0, limit: 24 }, total: 100, items: new Array(24).fill(0) };
        expect(hasMore(full)).toBe(true);
        expect(nextSkip(full)).toBe(24);
        expect(hasMore({ ...full, total: 24 })).toBe(false);
        expect(hasMore({ ...full, items: new Array(10).fill(0) })).toBe(false);
        expect(hasMore({ query: { skip: 9990, limit: 24 }, total: 50000, items: new Array(24).fill(0) })).toBe(false); // the proxy's skip bound
    });
});

describe('Random top-rated skips the scene on screen and failed ones', () => {
    const invalid = 'This is not a SuperSplat link';
    const rng = () => 0;

    it('the only candidate is the scene on screen: nothing is picked', () => {
        const ex = randomExclusions({ urlScene: 'c0ffee01', pickerError: '', invalidLinkText: invalid, failed: [] });
        expect(pickRandomTopRated([item('c0ffee01', 99)], { rng, current: ex.current, broken: ex.broken })).toBeNull();
        // control: without the exclusions the same pool hands the scene on screen back
        expect(pickRandomTopRated([item('c0ffee01', 99)], { rng })?.item.id).toBe('c0ffee01');
    });

    it('a scene that failed to load is skipped later too, after another scene is in the address', () => {
        const first = randomExclusions({ urlScene: 'dead0001', pickerError: 'This scene does not exist on SuperSplat', invalidLinkText: invalid, failed: [] });
        expect(first.broken).toEqual(['dead0001']);
        const later = randomExclusions({ urlScene: 'beef0002', pickerError: '', invalidLinkText: invalid, failed: first.broken });
        const pool = [item('dead0001', 99), item('beef0002', 50), item('cafe0003', 10)];
        expect(pickRandomTopRated(pool, { rng, current: later.current, broken: later.broken })?.item.id).toBe('cafe0003');
        // control: forgetting the failed list picks the failed scene again (it is the best-liked)
        expect(pickRandomTopRated(pool, { rng, current: later.current })?.item.id).toBe('dead0001');
    });

    it('an invalid pasted link is not a failed scene', () => {
        expect(randomExclusions({ urlScene: 'beef0002', pickerError: invalid, invalidLinkText: invalid, failed: [] }).broken).toEqual([]);
        // control: any other error line marks the scene in the address as failed
        expect(randomExclusions({ urlScene: 'beef0002', pickerError: 'Network error', invalidLinkText: invalid, failed: [] }).broken).toEqual(['beef0002']);
    });
});

describe('errors and labels', () => {
    it('a busy proxy (503) says busy and how long to wait; offline says offline', () => {
        expect(errorView(new SuperSplatError('busy', 'catalogue answered 503', 503, 7.2))).toEqual({ key: 'busy', retryAfterS: 8 });
        expect(errorView(new SuperSplatError('upstream', 'catalogue answered 502', 502))).toEqual({ key: 'upstream', retryAfterS: null });
        expect(errorView(new SuperSplatError('network', 'x'), false).key).toBe('offline');
        // control: anything unknown is the generic message, never busy
        expect(errorView(new Error('boom')).key).toBe('other');
    });

    it('licence and size read as people write them', () => {
        expect(licenceLabel('by-nc-sa')).toBe('CC BY-NC-SA');
        expect(licenceLabel(null)).toBe('');
        expect(sizeParts(163_119_059, 'en')).toEqual({ key: 'mb', n: '163' });
        expect(sizeParts(2_450_000_000, 'en')).toEqual({ key: 'gb', n: '2.5' });
        expect(sizeParts(3_400_000, 'pl')).toEqual({ key: 'mb', n: '3,4' });
        expect(sizeParts(0, 'en')).toBeNull();
    });
});
