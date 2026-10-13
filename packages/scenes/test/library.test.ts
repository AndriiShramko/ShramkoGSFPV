// The scene library (docs/architecture-v03.md E.1, E.10): the history cap of 100, the favourites'
// order and the merge. Each block ends with a negative control that must fire.
import { describe, expect, it } from 'vitest';
import { library as L, emptyLibrary, mergeLibraries, lastScene, HISTORY_CAP, failedRecently, pickerList, pickerEmpty, tabCandidates, filterCandidates, favouriteEntries, DEFAULT_FILTER, TAB_FILTERS, tabObeys } from '../src/index';
import type { CuratedCard, PickerTabId, SceneFilter, SceneLibraryData } from '../src/index';

/** The cards a tab shows (pickerList without the hidden count). */
const pickerRows = (tab: PickerTabId, curated: readonly CuratedCard[], d: SceneLibraryData, f: SceneFilter) => pickerList(tab, curated, d, f).rows;

const open = (d: SceneLibraryData, id: string, now: number, extra: { title?: string; hasCollision?: boolean | null } = {}): SceneLibraryData =>
    L.recordOpen(d, { id, version: 1, title: extra.title, hasCollision: extra.hasCollision ?? true }, now);

describe('scene library: history', () => {
    it('keeps the newest 100, newest first, one entry per scene', () => {
        let d = emptyLibrary();
        for (let i = 0; i < 130; i++) d = open(d, `s${i}`, 1000 + i);
        d = open(d, 's50', 5000); // reopened: moves to the front, still once
        expect(d.history.length).toBe(HISTORY_CAP);
        expect(d.history[0].id).toBe('s50');
        expect(d.history[1].id).toBe('s129');
        expect(d.history.filter((e) => e.id === 's50').length).toBe(1);
        // the oldest ones fell out
        expect(d.history.some((e) => e.id === 's0')).toBe(false);
        expect(lastScene(d)?.id).toBe('s50');
    });

    it('counts flights and airtime only for scenes in the history; a good open clears a failure', () => {
        let d = open(emptyLibrary(), 'a', 1);
        d = L.recordFlight(d, 'a', 12.5);
        d = L.recordFlight(d, 'zz', 3);
        expect(d.history).toEqual([expect.objectContaining({ id: 'a', flights: 1, airtimeS: 12.5 })]);
        d = L.recordFailure(d, 'a', 'network', 10);
        expect(failedRecently(d, 'a', 20)).toBe(true);
        expect(failedRecently(d, 'a', 10 + 25 * 3600e3)).toBe(false);
        d = open(d, 'a', 30);
        expect(failedRecently(d, 'a', 40)).toBe(false);
        // a scene never opened that fails goes to the end: it is not "the last scene"
        d = L.recordFailure(d, 'x', 'not-found', 50);
        expect(d.history.map((e) => e.id)).toEqual(['a', 'x']);
        expect(lastScene(d)?.id).toBe('a');
    });
});

describe('scene library: favourites', () => {
    it('a new star goes first, unstarring keeps the order of the rest', () => {
        let d = emptyLibrary();
        for (const id of ['a', 'b', 'c']) d = L.toggleFavourite(d, id).data;
        expect(d.favourites).toEqual(['c', 'b', 'a']);
        const r = L.toggleFavourite(d, 'b');
        expect(r.on).toBe(false);
        expect(r.data.favourites).toEqual(['c', 'a']);
        expect(L.toggleFavourite(r.data, 'b')).toEqual({ data: expect.objectContaining({ favourites: ['b', 'c', 'a'] }), on: true });
    });

    it('control: the input is never changed in place (a caller holding the old data keeps it)', () => {
        const d = L.toggleFavourite(emptyLibrary(), 'a').data;
        const before = JSON.stringify(d);
        L.toggleFavourite(d, 'b');
        L.recordFlight(open(d, 'a', 1), 'a', 1);
        expect(JSON.stringify(d)).toBe(before);
    });
});

describe('scene library: merge', () => {
    it('newer open wins, counts take the larger, favourites keep the first order then the second', () => {
        let a = open(emptyLibrary(), 'x', 100, { title: 'X old' });
        a = L.recordFlight(a, 'x', 10);
        a = open(a, 'y', 200);
        a = { ...a, favourites: ['y', 'x'], versions: { x: 2 } };
        let b = open(emptyLibrary(), 'x', 300, { title: 'X new' });
        b = open(b, 'z', 50);
        b = L.recordFlight(L.recordFlight(L.recordFlight(b, 'z', 1), 'z', 1), 'z', 1);
        b = { ...b, favourites: ['z', 'x', 'q'], versions: { x: 1, z: 3 } };
        const m = mergeLibraries(a, b);
        expect(m.history.map((e) => e.id)).toEqual(['x', 'y', 'z']);
        expect(m.history[0]).toEqual(expect.objectContaining({ id: 'x', title: 'X new', lastFlown: 300, flights: 1, airtimeS: 10 }));
        expect(m.history[2].flights).toBe(3);
        expect(m.favourites).toEqual(['y', 'x', 'z', 'q']);
        expect(m.versions).toEqual({ x: 2, z: 3 });
        // merging the same library twice changes nothing
        expect(mergeLibraries(m, m)).toEqual(m);
    });

    it('a failure newer than both opens is kept, an older one is not', () => {
        const a = L.recordFailure(open(emptyLibrary(), 'x', 100), 'x', 'network', 500);
        const b = open(emptyLibrary(), 'x', 300);
        expect(mergeLibraries(a, b).history[0].failCode).toBe('network');
        const c = open(emptyLibrary(), 'x', 900);
        expect(mergeLibraries(a, c).history[0].failCode).toBeUndefined();
    });

    it('control: a naive concat keeps duplicates and the wrong order (the merge is what fixes it)', () => {
        const a = open(open(emptyLibrary(), 'x', 1), 'y', 2);
        const b = open(emptyLibrary(), 'x', 3);
        const naive = [...a.history, ...b.history].map((e) => e.id);
        expect(naive).toEqual(['y', 'x', 'x']);
        expect(mergeLibraries(a, b).history.map((e) => e.id)).toEqual(['x', 'y']);
    });
});

describe('scene library: a favourite keeps what it was starred with (title, walls, version)', () => {
    const CURATED = [{ id: '39e63ce9', title: 'Modlinek Villa', collision: true, kind: 'interior' }];

    it('starred from the SuperSplat tab, never opened: in Favourites under the walls filter with its title; not in Recent', () => {
        const d = L.toggleFavourite(emptyLibrary(), 'ab12cd34', { title: 'Old mill', hasCollision: true, version: 3 }).data;
        expect(d.favourites).toEqual(['ab12cd34']);
        expect(pickerRows('favourites', CURATED, d, DEFAULT_FILTER)).toEqual([{ id: 'ab12cd34', title: 'Old mill', collision: true, flights: 0, fav: true }]);
        expect(pickerRows('recent', CURATED, d, DEFAULT_FILTER)).toEqual([]);
        expect(lastScene(d)).toBeNull();
        expect(favouriteEntries(d)[0].version).toBe(3);
        expect(d.versions).toEqual({ ab12cd34: 3 });
        // opened later: the same entry, now in Recent, its title kept
        const o = L.recordOpen(d, { id: 'ab12cd34', version: 3, hasCollision: true }, 50);
        expect(pickerRows('recent', CURATED, o, DEFAULT_FILTER).map((r) => r.title)).toEqual(['Old mill']);
        // starring again with less known never forgets what is known
        const again = L.toggleFavourite(L.toggleFavourite(o, 'ab12cd34').data, 'ab12cd34', { hasCollision: null }).data;
        expect(favouriteEntries(again)[0]).toEqual(expect.objectContaining({ title: 'Old mill', hasCollision: true }));
        // unstarring a scene never opened drops its entry again
        expect(L.toggleFavourite(d, 'ab12cd34').data.history).toEqual([]);
    });

    it('starred without walls: stays in Favourites under the walls filter, with its title and collision false (the no-walls badge)', () => {
        const d = L.toggleFavourite(emptyLibrary(), 'ee00ee00', { title: 'Field', hasCollision: false }).data;
        const card = { id: 'ee00ee00', title: 'Field', collision: false, flights: 0, fav: true };
        expect(pickerRows('favourites', CURATED, d, DEFAULT_FILTER)).toEqual([card]);
        expect(pickerRows('favourites', CURATED, d, { ...DEFAULT_FILTER, collisionOnly: false })).toEqual([card]);
    });

    it('an id-only list (stored by an older release) still reads: walls unknown, shown under the filter', () => {
        const d = { ...emptyLibrary(), favourites: ['ff00ff00', '39e63ce9'] };
        expect(pickerRows('favourites', CURATED, d, DEFAULT_FILTER)).toEqual([
            { id: 'ff00ff00', title: 'ff00ff00', collision: null, flights: 0, fav: true },
            { id: '39e63ce9', title: 'Modlinek Villa', collision: true, flights: 0, fav: true }
        ]);
    });

    it('control: starred with the id only (as the SuperSplat tab did) the card has no title, and the old picker rule (unknown walls = no walls) hid it', () => {
        const d = L.toggleFavourite(emptyLibrary(), 'ab12cd34').data;
        expect(pickerRows('favourites', CURATED, d, DEFAULT_FILTER)[0]).toEqual(expect.objectContaining({ title: 'ab12cd34', collision: null }));
        const oldRule = favouriteEntries(d).map((e) => ({ id: e.id, collision: e.hasCollision ?? false })).filter((s) => s.collision);
        expect(oldRule).toEqual([]);
    });
});

describe('scene library: what a listing knew of a scene (v0.7 D1: credit a scan outside the catalogue)', () => {
    const facts = { title: 'Old Mill', author: 'Jane Scan', license: 'CC BY-SA' };

    it('picked from the SuperSplat tab: the facts survive the open that follows, and a full history', () => {
        let d = emptyLibrary();
        for (let i = 0; i < HISTORY_CAP; i++) d = open(d, `s${i}`, 1000 + i);
        d = L.rememberFacts(d, 'ab12cd34', facts);
        expect(L.factsOf(d, 'ab12cd34')).toEqual(facts);
        // the open a moment later (scene-host/flight: recordOpen with the title only) keeps author and licence
        d = open(d, 'ab12cd34', 9000, { title: 'Old Mill' });
        expect(L.factsOf(d, 'ab12cd34')).toEqual(facts);
        expect(d.history.length).toBe(HISTORY_CAP);
        // a never-opened entry is not "the last scene" and not in Recent
        expect(lastScene(L.rememberFacts(emptyLibrary(), 'cafe0001', facts))).toBeNull();
    });

    it('an unknown never replaces a known value', () => {
        const d = L.rememberFacts(L.rememberFacts(emptyLibrary(), 'ab12cd34', facts), 'ab12cd34', { title: 'Old Mill v2' });
        expect(L.factsOf(d, 'ab12cd34')).toEqual({ ...facts, title: 'Old Mill v2' });
        expect(L.factsOf(d, 'ffff0000')).toEqual({});
    });

    it('control: appended at the end like a star (toggleFavourite), a full history drops the facts at once', () => {
        let d = emptyLibrary();
        for (let i = 0; i < HISTORY_CAP; i++) d = open(d, `s${i}`, 1000 + i);
        const appended = { ...d, history: [...d.history, { id: 'ab12cd34', version: 1, lastFlown: 0, flights: 0, airtimeS: 0, hasCollision: null, ...facts }].slice(0, HISTORY_CAP) };
        expect(L.factsOf(appended, 'ab12cd34')).toEqual({});
    });
});

describe('the owner\'s catalogue shows every published scene (item 4, v0.7)', () => {
    // the two scenes the owner added in /admin/ without a SuperSplat collision file
    const CATALOGUE = [
        { id: '39e63ce9', title: 'Modlinek Villa', collision: true, kind: 'interior' },
        { id: '70b50d42', title: 'Wroclaw Cathedral', collision: false, kind: 'exterior' },
        { id: '0230d903', title: 'Muster Truck Show', collision: false, kind: 'exterior' }
    ];

    it('the default filter (walls only) keeps the catalogue whole; scenes without walls stay, marked by collision: false', () => {
        const rows = pickerRows('showcase', CATALOGUE, emptyLibrary(), DEFAULT_FILTER);
        expect(DEFAULT_FILTER.collisionOnly).toBe(true);
        expect(rows.map((r) => r.id)).toEqual(['39e63ce9', '70b50d42', '0230d903']);
        expect(rows.find((r) => r.id === '70b50d42')?.collision).toBe(false);
    });

    it('the walls filter applies to Recent only; a starred scene stays in Favourites; kind applies to the catalogue only', () => {
        let d = emptyLibrary();
        d = L.recordOpen(d, { id: '0230d903', version: 1, hasCollision: false }, 10);
        d = L.toggleFavourite(d, '0230d903').data;
        expect(pickerRows('recent', CATALOGUE, d, DEFAULT_FILTER)).toEqual([]);
        expect(pickerRows('favourites', CATALOGUE, d, DEFAULT_FILTER)).toEqual([{ id: '0230d903', title: 'Muster Truck Show', collision: false, flights: 0, fav: true }]);
        expect(pickerRows('recent', CATALOGUE, d, { ...DEFAULT_FILTER, collisionOnly: false }).map((r) => r.id)).toEqual(['0230d903']);
        expect(pickerRows('showcase', CATALOGUE, d, { ...DEFAULT_FILTER, kind: 'interior' }).map((r) => r.id)).toEqual(['39e63ce9']);
        expect(pickerRows('recent', CATALOGUE, d, { ...DEFAULT_FILTER, collisionOnly: false, kind: 'interior' }).map((r) => r.id)).toEqual(['0230d903']);
    });

    it('every tab says which controls it obeys; only Recent obeys the walls filter', () => {
        expect(tabObeys('showcase', 'collisionOnly')).toBe(false);
        expect(tabObeys('favourites', 'collisionOnly')).toBe(false);
        expect(TAB_FILTERS.recent).toContain('collisionOnly');
    });

    it('control: the v0.6 rule (every filter control on every tab) hides the owner\'s two scenes, and a starred one, under the default filter', () => {
        const every = ['collisionOnly', 'kind', 'flown'] as const;
        expect(filterCandidates(tabCandidates('showcase', CATALOGUE, emptyLibrary()), every, DEFAULT_FILTER).map((r) => r.id)).toEqual(['39e63ce9']);
        const d = L.toggleFavourite(emptyLibrary(), '0230d903').data;
        expect(filterCandidates(tabCandidates('favourites', CATALOGUE, d), every, DEFAULT_FILTER)).toEqual([]);
    });
});

describe('an empty tab says why (item 4, v0.7)', () => {
    const CATALOGUE = [
        { id: '39e63ce9', title: 'Modlinek Villa', collision: true, kind: 'interior' },
        { id: '0230d903', title: 'Muster Truck Show', collision: false, kind: 'exterior' }
    ];

    it('Recent with only a no-walls scene under the walls filter: "no scans match the filter", not "scans you open appear here"', () => {
        const d = L.recordOpen(emptyLibrary(), { id: '0230d903', version: 1, hasCollision: false }, 10);
        const list = pickerList('recent', CATALOGUE, d, DEFAULT_FILTER);
        expect(list).toEqual({ rows: [], hidden: 1 });
        expect(pickerEmpty('recent', list)).toBe('filter');
    });

    it('a tab with nothing in it says so in its own words; the catalogue too', () => {
        expect(pickerEmpty('recent', pickerList('recent', CATALOGUE, emptyLibrary(), DEFAULT_FILTER))).toBe('recent');
        expect(pickerEmpty('favourites', pickerList('favourites', CATALOGUE, emptyLibrary(), DEFAULT_FILTER))).toBe('favourites');
        expect(pickerEmpty('showcase', pickerList('showcase', [], emptyLibrary(), DEFAULT_FILTER))).toBe('showcase');
    });

    it('the catalogue under a kind and flown filter that hides every scene: the filter\'s words', () => {
        const list = pickerList('showcase', CATALOGUE, emptyLibrary(), { ...DEFAULT_FILTER, kind: 'interior', flown: 'flown' });
        expect(list).toEqual({ rows: [], hidden: 2 });
        expect(pickerEmpty('showcase', list)).toBe('filter');
        // control: once the interior scene was flown, it is a card again
        const d = L.recordFlight(L.recordOpen(emptyLibrary(), { id: '39e63ce9', version: 1, hasCollision: true }, 10), '39e63ce9', 30);
        expect(pickerList('showcase', CATALOGUE, d, { ...DEFAULT_FILTER, kind: 'interior', flown: 'flown' }).rows.map((r) => r.id)).toEqual(['39e63ce9']);
    });
});
