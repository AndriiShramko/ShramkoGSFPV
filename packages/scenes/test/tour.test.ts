// The tour (packages/scenes/src/tour.ts; v0.9 lane N, the owner's item 9): N walks the owner's catalogue in
// his order, then SuperSplat, never repeating a scene until everything was seen; the SuperSplat leg of a step
// is bounded in time; the place in the walk is kept between visits only when the page hands in a store. Every
// claim has a negative control: the checker that proves it is run on a sequence that breaks the rule (or the
// same walk without the rule) and must fail.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SceneTour, SUPERSPLAT_READ_MS, TOUR_KEY, TOUR_KEEP_MS, TOUR_PAGE, MAX_PAGES_PER_STEP, catalogueOrder, storefront } from '../src/index';
import type { TourItem, TourPage, TourStep, TourStorage, TourScene, CatalogScene } from '../src/index';

/** A seeded generator (mulberry32). */
function rng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const hex = (prefix: string, i: number): string => `${prefix}${i.toString(16).padStart(4, '0')}`;
/** The owner's scenes: c0000001 .. c000000c (12), in his order. */
const CAT = Array.from({ length: 12 }, (_, i) => hex('c000', i + 1));
/** A SuperSplat list of `n` scenes, all of a format the simulator opens: 5500.... */
const list = (n: number, format = 'sog'): TourItem[] => Array.from({ length: n }, (_, i) => ({ id: hex('5500', i + 1), format }));

class MapStore implements TourStorage {
    readonly m = new Map<string, string>();
    getItem(k: string): string | null { return this.m.get(k) ?? null; }
    setItem(k: string, v: string): void { this.m.set(k, v); }
}

/** SuperSplat's list as pages; `calls` records every page asked for. */
function pagesOf(items: readonly TourItem[], calls: [number, number][] = []) {
    return async (skip: number, limit: number): Promise<TourPage> => {
        calls.push([skip, limit]);
        return { items: items.slice(skip, skip + limit), total: items.length };
    };
}

interface Opts {
    catalogue?: readonly string[];
    failed?: Set<string>;
    pages?: ((skip: number, limit: number) => Promise<TourPage>) | null;
    store?: TourStorage;
    now?: () => number;
    seed?: number;
    onSearch?: () => void;
    readTimeoutMs?: number;
}
const NOW = 1_800_000_000_000;
function tour(o: Opts = {}): SceneTour {
    return new SceneTour({
        catalogue: () => o.catalogue ?? CAT,
        failed: (id) => o.failed?.has(id) ?? false,
        pages: o.pages === undefined ? pagesOf(list(100)) : o.pages,
        store: o.store,
        onSearch: o.onSearch,
        readTimeoutMs: o.readTimeoutMs,
        now: o.now ?? (() => NOW),
        rng: rng(o.seed ?? 1)
    });
}

/** Press N `n` times from `start` (the scene the page opened with), the way the page does: note it, ask, fly there. */
async function walk(t: SceneTour, start: string | null, n: number, order: 'sequential' | 'random' = 'sequential'): Promise<TourStep[]> {
    if (start) t.noteFlown(start);
    const out: TourStep[] = [];
    let cur = start;
    for (let i = 0; i < n; i++) {
        const s = await t.next(cur, order);
        if (!s) break;
        out.push(s);
        cur = s.id;
    }
    return out;
}

/** The first repeated id of a sequence, or null: the claim "no repeats" is `firstRepeat(...) === null`. */
function firstRepeat(ids: readonly string[]): string | null {
    const seen = new Set<string>();
    for (const id of ids) {
        if (seen.has(id)) return id;
        seen.add(id);
    }
    return null;
}

describe('the catalogue in the order a visitor sees it', () => {
    const sc = (id: string, extra: Partial<TourScene> = {}): TourScene => ({ id, ...extra });

    it('pinned scenes first, then the rest, each in the admin\'s order; hidden scenes are not in the tour', () => {
        const scenes = [sc('a'), sc('b', { pinned: true }), sc('c', { hidden: true }), sc('d'), sc('e', { pinned: true })];
        expect(catalogueOrder(scenes)).toEqual(['b', 'e', 'a', 'd']);
    });

    it('is the order the picker\'s catalogue tab draws (storefront: Featured row, then the rest)', () => {
        const mk = (id: string, pinned?: boolean): CatalogScene => ({ id, title: id, author: '', license: '', kind: 'other', collision: false, ...(pinned ? { pinned } : {}) });
        const scenes = ['a1b2c3d4', 'b1b2c3d4', 'c1b2c3d4', 'd1b2c3d4', 'e1b2c3d4'].map((id, i) => mk(id, i === 2 || i === 4));
        const shop = storefront(scenes.map((s) => ({ id: s.id })), { collections: [], scenes }, null);
        expect(catalogueOrder(scenes)).toEqual([...shop.featured, ...shop.rest].map((r) => r.id));
        // control: the admin's plain order is not the storefront's once something is pinned
        expect(scenes.map((s) => s.id)).not.toEqual([...shop.featured, ...shop.rest].map((r) => r.id));
    });
});

describe('N walks the catalogue, then SuperSplat', () => {
    it('from the first scene: all 12 in the owner\'s order, then a SuperSplat scene', async () => {
        const steps = await walk(tour(), CAT[0], 14);
        expect(steps.slice(0, 11)).toEqual(CAT.slice(1).map((id) => ({ id, from: 'catalogue' })));
        expect(steps[11]).toEqual({ id: hex('5500', 1), from: 'superspl' });
        expect(steps[12]).toEqual({ id: hex('5500', 2), from: 'superspl' });
    });

    it('from the middle: the rest of the list, round to the start, then SuperSplat', async () => {
        const steps = await walk(tour(), CAT[4], 12);
        expect(steps.map((s) => s.id)).toEqual([...CAT.slice(5), ...CAT.slice(0, 4), hex('5500', 1)]);
    });

    it('from a scene outside the catalogue (a link): from the top of the catalogue', async () => {
        const steps = await walk(tour(), hex('9900', 1), 3);
        expect(steps.map((s) => s.id)).toEqual(CAT.slice(0, 3));
    });

    it('SuperSplat is read lazily: nothing is asked while the catalogue lasts, then one page at a time', async () => {
        const calls: [number, number][] = [];
        const t = tour({ pages: pagesOf(list(100), calls) });
        await walk(t, CAT[0], 11);
        expect(calls).toEqual([]);
        await t.next(CAT[11], 'sequential');
        expect(calls).toEqual([[0, TOUR_PAGE]]);
        await walk(t, null, TOUR_PAGE - 1);
        expect(calls.length).toBe(1);
        await t.next(null, 'sequential');
        expect(calls).toEqual([[0, TOUR_PAGE], [TOUR_PAGE, TOUR_PAGE]]);
    });

    it('SuperSplat entries we cannot or should not bring are passed over, the rest keep the list\'s order', async () => {
        const items: TourItem[] = [
            { id: hex('5500', 1), format: 'sog' },
            { id: CAT[3], format: 'sog' }, // one of the owner\'s own
            { id: hex('5500', 3), format: 'compressed.ply' }, // legacy: the simulator cannot open it
            { id: hex('5500', 4), format: '' }, // unknown format: not brought without a check
            { id: hex('5500', 5), format: 'ssog' },
            { id: hex('5500', 6), format: 'sog' }, // failed to load lately
            { id: hex('5500', 7), format: 'sog' } // the visitor flew it by hand
        ];
        const t = tour({ pages: pagesOf(items), failed: new Set([hex('5500', 6)]) });
        t.noteFlown(hex('5500', 7));
        const steps = (await walk(t, CAT[0], 14)).slice(11);
        expect(steps).toEqual([{ id: hex('5500', 1), from: 'superspl' }, { id: hex('5500', 5), from: 'superspl' }, { id: CAT[0], from: 'again' }]);
    });

    it('no scene comes twice until everything was seen: 12 + 60 steps, then a new round', async () => {
        const steps = await walk(tour({ pages: pagesOf(list(60)) }), CAT[0], 80);
        const ids = steps.map((s) => s.id);
        const again = steps.findIndex((s) => s.from === 'again');
        // the first round: the catalogue (minus the one it started on) and all 60, once each
        expect(again).toBe(11 + 60);
        expect(firstRepeat([CAT[0], ...ids.slice(0, again)])).toBeNull();
        expect(new Set(ids.slice(0, again)).size).toBe(71);
        // the new round starts at the catalogue and walks it in order
        expect(ids.slice(again, again + 3)).toEqual([CAT[0], CAT[1], CAT[2]]);
        // control: the checker does flag a repeat
        expect(firstRepeat([...ids.slice(0, again), CAT[3]])).toBe(CAT[3]);
    });

    it('the random order draws every catalogue scene once before SuperSplat, over many seeds', async () => {
        for (let seed = 1; seed <= 60; seed++) {
            const steps = await walk(tour({ seed }), CAT[0], 13, 'random');
            const ids = steps.map((s) => s.id);
            expect(steps.slice(0, 11).every((s) => s.from === 'catalogue')).toBe(true);
            expect([...ids.slice(0, 11), CAT[0]].sort()).toEqual([...CAT].sort());
            expect(steps[11].from).toBe('superspl');
        }
        // control: the order really is random (not the owner's order) for most seeds
        const same = (await walk(tour({ seed: 3 }), CAT[0], 11, 'random')).map((s) => s.id).join() === CAT.slice(1).join();
        expect(same).toBe(false);
    });
});

describe('failures and the end of the list', () => {
    it('a catalogue scene that failed lately is skipped; control: the same walk without the rule returns it', async () => {
        const failed = new Set([CAT[2]]);
        expect((await walk(tour({ failed }), CAT[0], 3)).map((s) => s.id)).toEqual([CAT[1], CAT[3], CAT[4]]);
        expect((await walk(tour(), CAT[0], 3)).map((s) => s.id)).toEqual([CAT[1], CAT[2], CAT[3]]);
    });

    it('SuperSplat not answering: a new round of the catalogue (says so), the list is read on from where it was', async () => {
        let up = false;
        const inner = pagesOf(list(100));
        const t = tour({ pages: async (s, l) => { if (!up) throw new Error('busy'); return inner(s, l); } });
        const down = await walk(t, CAT[0], 13);
        expect(down[11]).toEqual({ id: CAT[0], from: 'again' });
        expect(down[12]).toEqual({ id: CAT[1], from: 'catalogue' });
        // back up: after the second round, the first SuperSplat scene, not one past it
        up = true;
        const rest = await walk(t, null, 12);
        expect(rest.find((s) => s.from === 'superspl')).toEqual({ id: hex('5500', 1), from: 'superspl' });
    });

    it('no SuperSplat at all (pages null): the catalogue goes round, never stuck', async () => {
        const steps = await walk(tour({ pages: null }), CAT[0], 30);
        expect(steps.length).toBe(30);
        expect(steps.filter((s) => s.from === 'again').length).toBeGreaterThan(0);
        expect(steps.every((s) => CAT.includes(s.id))).toBe(true);
    });

    it('a list read to its end starts over with the new round', async () => {
        const steps = await walk(tour({ pages: pagesOf(list(5)) }), CAT[0], 11 + 5 + 14);
        const at = steps.findIndex((s) => s.from === 'again');
        expect(at).toBe(16);
        // second round: the catalogue (12 scenes), then the list again from its top
        expect(steps[at + 12]).toEqual({ id: hex('5500', 1), from: 'superspl' });
    });

    it('one scene only (the one on screen) and nothing else: nothing to go to', async () => {
        const t = tour({ catalogue: [CAT[0]], pages: null });
        t.noteFlown(CAT[0]);
        expect(await t.next(CAT[0], 'sequential')).toBeNull();
        expect(await tour({ catalogue: [], pages: null }).next(null, 'sequential')).toBeNull();
    });

    it('a page full of scenes it cannot bring does not turn one N into a run of requests', async () => {
        const calls: [number, number][] = [];
        const junk = list(TOUR_PAGE * 10, 'compressed.ply');
        const good = list(5).map((x) => ({ ...x, id: hex('7700', Number.parseInt(x.id.slice(4), 16)) }));
        const t = tour({ pages: pagesOf([...junk, ...good], calls) });
        await walk(t, CAT[0], 11);
        const s = await t.next(CAT[11], 'sequential');
        expect(calls.length).toBe(MAX_PAGES_PER_STEP);
        expect(s?.from).toBe('again');
        // the new round walks the catalogue; the N after it goes on reading where the last stopped
        const round = await walk(t, null, 10);
        expect(round.every((x) => x.from === 'catalogue')).toBe(true);
        const found = await t.next(round[round.length - 1].id, 'sequential');
        expect(calls[MAX_PAGES_PER_STEP]).toEqual([MAX_PAGES_PER_STEP * TOUR_PAGE, TOUR_PAGE]);
        expect(found?.from).toBe('superspl');
    });

    it('never the scene on screen, even when nobody told the tour it is there (random order, many seeds)', async () => {
        for (let seed = 1; seed <= 60; seed++) {
            expect((await tour({ seed }).next(CAT[3], 'random'))?.id).not.toBe(CAT[3]);
        }
    });
});

describe('SuperSplat is asked within a bounded time (the 13th press on a slow connection)', () => {
    afterEach(() => { vi.useRealTimers(); });

    /** A step started now; `settled()` says whether it has answered, `result()` what. */
    function start(t: SceneTour, from: string): { settled: () => boolean; result: () => TourStep | null | undefined } {
        let done = false;
        let res: TourStep | null | undefined;
        void t.next(from, 'sequential').then((r) => { done = true; res = r; });
        return { settled: () => done, result: () => res };
    }

    /** the owner's list all seen: the next step has to go to SuperSplat */
    async function allSeen(t: SceneTour): Promise<void> {
        for (const id of CAT) t.noteFlown(id);
    }

    it('a page that never answers: the step ends at the budget with a new round (again), not never', async () => {
        vi.useFakeTimers();
        const t = tour({ pages: () => new Promise<TourPage>(() => undefined) });
        await allSeen(t);
        const step = start(t, CAT[11]);
        await vi.advanceTimersByTimeAsync(SUPERSPLAT_READ_MS - 1);
        expect(step.settled()).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        expect(step.settled()).toBe(true);
        expect(step.result()).toEqual({ id: CAT[0], from: 'again' });
    });

    it('control: the same page with the bound switched off (a budget longer than the test waits) is still waiting', async () => {
        vi.useFakeTimers();
        const t = tour({ pages: () => new Promise<TourPage>(() => undefined), readTimeoutMs: 24 * 3600 * 1000 });
        await allSeen(t);
        const step = start(t, CAT[11]);
        await vi.advanceTimersByTimeAsync(SUPERSPLAT_READ_MS * 5);
        expect(step.settled()).toBe(false);
    });

    it('the budget is for the whole step: pages that each take 3 s and bring nothing end it at 4 s, not after 6 pages', async () => {
        vi.useFakeTimers();
        let asked = 0;
        // every entry is one the owner's list already has: nothing to bring, so the step wants the next page
        const slow = (skip: number, limit: number): Promise<TourPage> => new Promise((resolve) => {
            asked++;
            setTimeout(() => resolve({ items: CAT.slice(0, limit).map((id) => ({ id, format: 'sog' })), total: 1000 }), 3000);
        });
        const t = tour({ pages: slow });
        await allSeen(t);
        const step = start(t, CAT[11]);
        await vi.advanceTimersByTimeAsync(SUPERSPLAT_READ_MS);
        expect(step.settled()).toBe(true);
        expect(step.result()?.from).toBe('again');
        // the second page was asked for at 3 s and dropped at 4 s; no third request went out past the budget
        expect(asked).toBe(2);
        await vi.advanceTimersByTimeAsync(10 * 1000);
        expect(asked).toBe(2);
    });

    it('a page that arrives late is dropped; the next step asks for the same page again and gets its scene', async () => {
        vi.useFakeTimers();
        const calls: [number, number][] = [];
        let slow = true;
        const pages = (skip: number, limit: number): Promise<TourPage> => {
            calls.push([skip, limit]);
            const page = { items: list(100).slice(skip, skip + limit), total: 100 };
            return slow ? new Promise((resolve) => setTimeout(() => resolve(page), SUPERSPLAT_READ_MS + 2000)) : Promise.resolve(page);
        };
        const t = tour({ pages });
        await allSeen(t);
        const first = start(t, CAT[11]);
        await vi.advanceTimersByTimeAsync(SUPERSPLAT_READ_MS);
        expect(first.result()?.from).toBe('again');
        await vi.advanceTimersByTimeAsync(5000); // the dropped page lands; nothing happens
        slow = false;
        // everything is walked again (the new round), then the list: the page asked for is page 0 once more
        for (const id of CAT) t.noteFlown(id);
        const second = start(t, CAT[11]);
        await vi.advanceTimersByTimeAsync(0);
        expect(second.result()).toEqual({ id: hex('5500', 1), from: 'superspl' });
        expect(calls).toEqual([[0, TOUR_PAGE], [0, TOUR_PAGE]]);
    });

    it('says it is searching once per step that goes to the network, never while the catalogue or the buffer answers', async () => {
        let searches = 0;
        const t = tour({ onSearch: () => { searches++; } });
        await walk(t, CAT[0], 11); // the catalogue answers every press
        expect(searches).toBe(0);
        await t.next(CAT[11], 'sequential'); // the 12th press: page 0
        expect(searches).toBe(1);
        await t.next(hex('5500', 1), 'sequential'); // the buffer of that page answers
        expect(searches).toBe(1);
        // a step that has to read several pages says it once
        let many = 0;
        const t2 = tour({ onSearch: () => { many++; }, pages: pagesOf([...list(2 * TOUR_PAGE, 'compressed.ply'), ...list(3).map((x, i) => ({ ...x, id: hex('6600', i + 1) }))]) });
        await allSeen(t2);
        const s = await t2.next(CAT[11], 'sequential');
        expect(s?.from).toBe('superspl');
        expect(many).toBe(1);
    });
});

describe('the place in the walk, when the page keeps it (the page does not unless asked: D64)', () => {
    it('the next visit resumes in the catalogue where the last one stopped', async () => {
        const store = new MapStore();
        const first = await walk(tour({ store }), CAT[0], 5);
        expect(first.map((s) => s.id)).toEqual(CAT.slice(1, 6));
        // a new page load with a link to the first scene: the scenes seen yesterday are not brought again
        const second = await walk(tour({ store }), CAT[0], 3);
        expect(second.map((s) => s.id)).toEqual(CAT.slice(6, 9));
        // control: a page without storage starts from the top again
        expect((await walk(tour(), CAT[0], 3)).map((s) => s.id)).toEqual(CAT.slice(1, 4));
    });

    it('and in SuperSplat: the page the last visit ended in is read first, the entries passed are not repeated', async () => {
        const store = new MapStore();
        await walk(tour({ store }), CAT[0], 11 + 30);
        expect(JSON.parse(store.m.get(TOUR_KEY)!).ss).toBe(30);
        const calls: [number, number][] = [];
        const back = await walk(tour({ store, pages: pagesOf(list(100), calls) }), CAT[0], 2);
        expect(calls[0]).toEqual([TOUR_PAGE, TOUR_PAGE]);
        expect(back.map((s) => s.id)).toEqual([hex('5500', 31), hex('5500', 32)]);
        expect(back[0].from).toBe('superspl');
    });

    it('a position that has not read its page yet is not lost by an N that stays in the catalogue', async () => {
        const store = new MapStore();
        await walk(tour({ store }), CAT[0], 11 + 30);
        // a visit that only opens a scene and flies it: the position is rewritten with the same ss
        const t = tour({ store });
        t.noteFlown(hex('9900', 1));
        expect(JSON.parse(store.m.get(TOUR_KEY)!).ss).toBe(30);
    });

    it('a scene the owner adds later comes first; one he removes is forgotten', async () => {
        const store = new MapStore();
        await walk(tour({ store }), CAT[0], 11);
        const added = hex('c000', 99);
        const grown = await walk(tour({ store, catalogue: [...CAT, added] }), CAT[0], 2);
        expect(grown[0]).toEqual({ id: added, from: 'catalogue' });
        expect(grown[1].from).toBe('superspl');
        const shrunk = [...CAT.slice(0, 5)];
        const t = tour({ store, catalogue: shrunk });
        t.noteFlown(hex('5500', 5));
        expect(JSON.parse(store.m.get(TOUR_KEY)!).seen.every((id: string) => shrunk.includes(id))).toBe(true);
    });

    it('a record older than 30 days is ignored (control: one day short of it is used)', async () => {
        const store = new MapStore();
        await walk(tour({ store }), CAT[0], 5);
        // each case reads its own copy of the record (a walk writes the store)
        const later = (ms: number) => {
            const copy = new MapStore();
            copy.m.set(TOUR_KEY, store.m.get(TOUR_KEY)!);
            return tour({ store: copy, now: () => NOW + ms });
        };
        expect((await walk(later(TOUR_KEEP_MS + 1000), CAT[0], 2)).map((s) => s.id)).toEqual(CAT.slice(1, 3));
        const used = await walk(later(TOUR_KEEP_MS - 24 * 3600 * 1000), CAT[0], 2);
        expect(used.map((s) => s.id)).toEqual(CAT.slice(6, 8));
    });

    it('a damaged or foreign record, a clock in the future and a storage that throws all fall back to the top', async () => {
        for (const raw of ['{', 'null', '[]', '{"v":2,"at":1,"seen":[],"ss":0}', JSON.stringify({ v: 1, at: NOW + 3 * 24 * 3600 * 1000, seen: CAT, ss: 5 }), JSON.stringify({ v: 1, at: 'x', seen: CAT, ss: 5 })]) {
            const store = new MapStore();
            store.m.set(TOUR_KEY, raw);
            expect((await walk(tour({ store }), CAT[0], 2)).map((s) => s.id)).toEqual(CAT.slice(1, 3));
        }
        const hostile: TourStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
        expect((await walk(tour({ store: hostile }), CAT[0], 2)).map((s) => s.id)).toEqual(CAT.slice(1, 3));
        // odd values inside a good record are dropped one by one
        const odd = new MapStore();
        odd.m.set(TOUR_KEY, JSON.stringify({ v: 1, at: NOW, seen: [CAT[1], 42, '<script>', null], ss: -4 }));
        expect((await walk(tour({ store: odd }), CAT[0], 2)).map((s) => s.id)).toEqual([CAT[2], CAT[3]]);
    });
});
