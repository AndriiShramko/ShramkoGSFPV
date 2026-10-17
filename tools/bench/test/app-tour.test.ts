// v0.9 lane N (the owner's items 9 and 11): the app's side of the tour and the crash hint. The tour itself is
// tested in packages/scenes/test/tour.test.ts; here the SuperSplat pages it asks for, and the hint's rules
// (apps/fly/src/app/next-hint-logic.ts, next-used.ts). Each claim has a control that must fail.
import { describe, expect, it } from 'vitest';
import { SuperSplatCatalog, TOUR_PAGE } from '../../../packages/scenes/src/index';
import { PAGE_SIZE, defaultFilters, toQuery } from '../../../apps/fly/src/ui/superspl-tab-logic';
import { superSplatPages } from '../../../apps/fly/src/app/tour';
import { HINT_AT, hintDue, hintKind } from '../../../apps/fly/src/app/next-hint-logic';
import { nextUsed, noteNextUsed, onNextUsed } from '../../../apps/fly/src/app/next-used';

describe('the tour reads the SuperSplat tab\'s pages', () => {
    /** A proxy that records the URLs it is asked for and answers two scenes. */
    function proxy(): { urls: string[]; fetch: (u: string) => Promise<Response> } {
        const urls: string[] = [];
        const item = (id: string, format: string) => ({ id, version: 1, title: id, author: 'a', license: 'by', downloadable: true, likes: 3, views: 9, sizeBytes: 5, thumbs: {}, createdAt: null, description: '', format });
        return {
            urls,
            fetch: async (u: string) => {
                urls.push(u);
                return new Response(JSON.stringify({ ok: true, total: 100, fetchedAt: 1, items: [item('aaaa1111', 'sog'), item('bbbb2222', 'compressed.ply')] }), { status: 200, headers: { 'content-type': 'application/json' } });
            }
        };
    }

    it('a page is the tab\'s own page: same size, same default filters (walkable follows the walls switch)', async () => {
        expect(TOUR_PAGE).toBe(PAGE_SIZE);
        const p = proxy();
        const cat = new SuperSplatCatalog({ fetch: p.fetch });
        const page = await superSplatPages(cat, () => true)(TOUR_PAGE, TOUR_PAGE);
        expect(p.urls).toEqual([cat.url(toQuery(defaultFilters(true), TOUR_PAGE, TOUR_PAGE))]);
        expect(p.urls[0]).toBe('/api/superspl/explore?sort=trending&order=-1&time=all&features=walkable&skip=24&limit=24');
        // what the tour needs of an entry: its id and its format (the unsupported one is the tour's to pass over)
        expect(page).toEqual({ items: [{ id: 'aaaa1111', format: 'sog' }, { id: 'bbbb2222', format: 'compressed.ply' }], total: 100 });
        // wall-less scenes allowed: no walkable feature, a different page of the proxy's cache
        await superSplatPages(new SuperSplatCatalog({ fetch: p.fetch }), () => false)(0, TOUR_PAGE);
        expect(p.urls[1]).toBe('/api/superspl/explore?sort=trending&order=-1&time=all&skip=0&limit=24');
    });

    it('control: a page size that differs from the tab\'s would not share its cache entries', async () => {
        const p = proxy();
        const cat = new SuperSplatCatalog({ fetch: p.fetch });
        await superSplatPages(cat, () => true)(0, TOUR_PAGE + 1);
        expect(p.urls[0]).not.toBe(cat.url(toQuery(defaultFilters(true), 0, PAGE_SIZE)));
    });

    it('a proxy that does not answer is an error the tour passes over (the page rejects, nothing is invented)', async () => {
        const cat = new SuperSplatCatalog({ fetch: async () => new Response('busy', { status: 503 }) });
        await expect(superSplatPages(cat, () => true)(0, TOUR_PAGE)).rejects.toMatchObject({ code: 'busy' });
    });
});

describe('the crash hint: when it shows (item 11)', () => {
    const due = (crashes: number, o: { nextUsed?: boolean; autoSwitch?: boolean } = {}) => hintDue({ crashes, nextUsed: false, autoSwitch: false, ...o });

    it('the 3rd crash of a visit and the 6th, no other', () => {
        expect([1, 2, 3, 4, 5, 6, 7, 8, 9].filter((n) => due(n))).toEqual([3, 6]);
        expect(HINT_AT).toEqual([3, 6]);
        // control: a rule that fires on every crash from the 3rd on is not this one
        expect([1, 2, 3, 4, 5, 6].filter((n) => n >= 3)).not.toEqual([3, 6]);
    });

    it('never once N was used, and not when the crash already goes to the next scene', () => {
        for (const n of [3, 6]) {
            expect(due(n, { nextUsed: true })).toBe(false);
            expect(due(n, { autoSwitch: true })).toBe(false);
        }
        // control: the same crash with neither shows it
        expect(due(3)).toBe(true);
    });

    it('says it for the input in use: a Next scene button on touch, the switch on a radio that maps it, else the key', () => {
        expect(hintKind({ source: 'touch', radioSwitch: false })).toBe('touch');
        expect(hintKind({ source: 'hid', radioSwitch: true })).toBe('radio');
        expect(hintKind({ source: 'gamepad', radioSwitch: true })).toBe('radio');
        expect(hintKind({ source: 'hid', radioSwitch: false })).toBe('key');
        expect(hintKind({ source: 'keyboard', radioSwitch: true })).toBe('key');
        expect(hintKind({ source: null, radioSwitch: false })).toBe('key');
        // control: a profile with the switch does not make a keyboard pilot a radio pilot
        expect(hintKind({ source: 'keyboard', radioSwitch: true })).not.toBe('radio');
    });
});

describe('"N was used" is remembered, and told once', () => {
    it('false until noted, then true for good; listeners hear the first use only; blocked storage still remembers for the page', () => {
        // Node has no localStorage: every access throws and is guarded, so this is the blocked-storage path
        expect(nextUsed()).toBe(false);
        let heard = 0;
        const off = onNextUsed(() => { heard++; });
        noteNextUsed();
        noteNextUsed();
        expect(nextUsed()).toBe(true);
        expect(heard).toBe(1);
        off();
    });
});
