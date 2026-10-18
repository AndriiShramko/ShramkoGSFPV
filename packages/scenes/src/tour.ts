// The tour: the one ordered source of "the next scene" (v0.9 lane N, the owner's item 9). N, and the scene
// after a crash when scenes.autoSwitch is on, walk it:
//   1. the owner's catalogue, as the picker's catalogue tab shows it (pinned scenes first, then the rest,
//      each in the admin's order). The walls flag never filters it: the owner published these scenes, and
//      9 of his 13 have no walls file (the cause of "N cycles only 3-4 scenes", rotation.ts header);
//   2. once every catalogue scene was seen, SuperSplat: the pages of the SuperSplat tab's defaults, read
//      lazily one at a time and consumed in order, skipping our own scenes, scenes already seen, scenes
//      that failed to load lately and formats the simulator is not known to open;
//   3. nothing left (all seen, or SuperSplat did not answer): a new round from the catalogue (`again`).
// A scene is never brought twice until a new round starts. "Seen" is every scene on screen (the page's
// first, N, a pick, a pasted link). Order `sequential` takes the first unseen catalogue scene after the
// current one, round the list; `random` draws uniformly among the unseen.
// The place in the walk CAN survive the visit, but only when the page hands in a `store` (the page does not:
// the owner asked for no such thing, and a visitor who had walked the list once would meet SuperSplat on the
// first N of the next visit, which looks like the bug of item 9 again; app/tour.ts, decision D64). The record:
// the seen catalogue scenes and how far into the SuperSplat list the tour has read, in one small record in
// that storage (every access is guarded). A record older than TOUR_KEEP_MS is ignored: the trending list and
// the catalogue have moved on.
// The SuperSplat leg of a step is bounded (SUPERSPLAT_READ_MS): a slow or stalled proxy counts as "SuperSplat
// did not answer", the step falls back to the catalogue (`again`) instead of leaving N dead while it waits.
// Pure: no DOM globals. The pages, the storage, the clock and the random numbers come in through deps.
import { EXPLORE_BOUNDS, formatVerdict } from './superspl';

/** What the tour needs of a catalogue scene (CatalogScene has more). */
export interface TourScene { id: string; pinned?: boolean; hidden?: boolean }

/**
 * The catalogue in the order a visitor sees it on the picker's catalogue tab (storefront: the Featured
 * row of pinned scenes, then the rest), each part in the admin's order; scenes the admin hid are not
 * shown to pilots and not in the tour.
 */
export function catalogueOrder(scenes: readonly TourScene[]): string[] {
    const shown = scenes.filter((s) => !s.hidden);
    return [...shown.filter((s) => s.pinned), ...shown.filter((s) => !s.pinned)].map((s) => s.id);
}

/** One SuperSplat list entry, as far as the tour looks at it. */
export interface TourItem { id: string; format?: string }
/** One page of the SuperSplat list: its entries and the size of the whole list. */
export interface TourPage { items: readonly TourItem[]; total: number }
/** The page at `skip` with `limit` entries; throws when it cannot be read (the proxy busy, offline). */
export type TourPages = (skip: number, limit: number) => Promise<TourPage>;

/** The subset of Web Storage the tour uses (the page's localStorage, or a Map-backed one in tests). */
export interface TourStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}

export const TOUR_KEY = 'gsfpv.tour.v1';
/** A remembered position older than this is not used. */
export const TOUR_KEEP_MS = 30 * 24 * 3600 * 1000;
/**
 * Entries per SuperSplat page: the same as the SuperSplat tab's, so the tab and the tour ask the proxy
 * for the same pages (one cache entry each; tools/bench/test/app-tour.test.ts keeps the two equal).
 */
export const TOUR_PAGE = 24;
/** Seen catalogue scenes kept between visits (a catalogue is far smaller; this only bounds a damaged record). */
const SEEN_KEPT = 500;
/**
 * SuperSplat pages one step may read looking for a scene it can bring (our own scenes, scenes seen and
 * formats we cannot open are passed over): a page full of them does not turn one N into a run of requests
 * (the proxy allows a visitor 60 a minute). Hitting the limit counts as "nothing to bring now".
 */
export const MAX_PAGES_PER_STEP = 6;
/**
 * The most one step waits for SuperSplat's pages, all of them together (the same 4 s as the catalogue's own
 * load, loadCatalog). The proxy may take 10 s upstream and a bad mobile connection longer; N and the scene
 * after a crash are ignored while a step is being decided, so the wait has to end.
 */
export const SUPERSPLAT_READ_MS = 4000;

const ID = /^[0-9a-f]{6,32}$/;

export interface TourDeps {
    /** the owner's scenes in tour order (catalogueOrder), all of them: failed ones are left out by the tour */
    catalogue(): readonly string[];
    /** failed to load lately (the library's 24 h rule): left out for now */
    failed(id: string): boolean;
    /** the SuperSplat list; null: the tour stays in the catalogue */
    pages: TourPages | null;
    /** where the position is kept between visits; absent: nowhere (every visit walks the list from its start) */
    store?: TourStorage;
    /** a step is about to read a SuperSplat page from the network, once per step (the page says "looking" if it drags on) */
    onSearch?(): void;
    /** the budget of one step's SuperSplat reads in ms (default SUPERSPLAT_READ_MS) */
    readTimeoutMs?: number;
    now?(): number;
    rng?(): number;
    /** may this SuperSplat entry be brought (default: a format the simulator opens, formatVerdict) */
    opens?(item: TourItem): boolean;
    /** entries per page (default TOUR_PAGE) */
    pageSize?: number;
}

export type TourOrder = 'sequential' | 'random';
/** Where a step came from: the catalogue, SuperSplat, or `again` = everything was seen, a new round began. */
export type TourFrom = 'catalogue' | 'superspl' | 'again';
export interface TourStep { id: string; from: TourFrom }

interface Saved { v: 1; at: number; seen: string[]; ss: number }

/** The SuperSplat list as the tour reads it: a buffer of the entries read and not yet consumed. */
interface Stream {
    buffer: TourItem[];
    /** the `skip` of the next page to read */
    nextSkip: number;
    /** entries of the list consumed so far (brought or passed over): what is kept between visits */
    consumed: number;
    /** entries to pass over at the top of the first page read (a resume that lands inside a page) */
    skipFirst: number;
    exhausted: boolean;
}

export class SceneTour {
    private readonly d: TourDeps;
    private readonly pageSize: number;
    private seen = new Set<string>();
    private stream: Stream;

    constructor(deps: TourDeps) {
        this.d = deps;
        this.pageSize = Math.max(1, Math.min(EXPLORE_BOUNDS.limitMax, Math.floor(deps.pageSize ?? TOUR_PAGE)));
        const saved = this.load();
        for (const id of saved?.seen ?? []) this.seen.add(id);
        this.stream = this.freshStream(saved?.ss ?? 0);
    }

    /** A scene is on screen (the page's first, a pick, a link, or one the tour brought): it is not brought again this round. */
    noteFlown(id: string): void {
        if (this.seen.has(id)) return;
        this.seen.add(id);
        this.save();
    }

    /**
     * The scene after `current` (the one on screen; null before any), or null when there is nothing to go to
     * (the catalogue is empty or only the current scene, and SuperSplat has nothing). One call at a time: the
     * page's scene host does not decide again while a switch is being decided (SceneHost.go).
     */
    async next(current: string | null, order: TourOrder): Promise<TourStep | null> {
        if (current) this.seen.add(current);
        const fromCatalogue = this.fromCatalogue(current, order);
        if (fromCatalogue) return this.take(fromCatalogue, 'catalogue');
        const fromList = await this.fromSuperSplat();
        if (fromList) return this.take(fromList, 'superspl');
        // everything was seen, or SuperSplat has nothing to give now: a new round from the catalogue. A list
        // read to its end starts over too; a list that merely failed to answer is read on from where it was.
        this.seen = new Set(current ? [current] : []);
        if (this.stream.exhausted) this.stream = this.freshStream(0);
        const again = this.fromCatalogue(current, order);
        if (!again) {
            this.save();
            return null;
        }
        return this.take(again, 'again');
    }

    private take(id: string, from: TourFrom): TourStep {
        this.seen.add(id);
        this.save();
        return { id, from };
    }

    /** The next unseen catalogue scene, or null when the catalogue is all seen. */
    private fromCatalogue(current: string | null, order: TourOrder): string | null {
        const all = this.d.catalogue();
        const open = all.filter((id) => !this.d.failed(id));
        const unseen = open.filter((id) => !this.seen.has(id));
        if (unseen.length === 0) return null;
        if (order === 'random') {
            const x = (this.d.rng ?? Math.random)();
            return unseen[Math.min(unseen.length - 1, Math.max(0, Math.floor(x * unseen.length)))];
        }
        // the first unseen one after the current scene, round the list (a current scene outside it: from the top)
        const at = current === null ? -1 : all.indexOf(current);
        for (let k = 1; k <= all.length; k++) {
            const id = all[(at + k + all.length) % all.length];
            if (!this.seen.has(id) && !this.d.failed(id)) return id;
        }
        return null;
    }

    /**
     * The next SuperSplat entry the tour may bring; null: the list is read to its end, or could not be read
     * (an error, or no answer within the step's budget: the page is read again by the next step).
     */
    private async fromSuperSplat(): Promise<string | null> {
        const opens = this.d.opens ?? ((it: TourItem) => formatVerdict(it.format ?? '') === 'opens');
        const s = this.stream;
        // one budget for all the pages of this step, started with the first read
        let timer: ReturnType<typeof setTimeout> | undefined;
        let late: Promise<'late'> | null = null;
        try {
            for (let read = 0; ; read++) {
                while (s.buffer.length > 0) {
                    const it = s.buffer.shift()!;
                    s.consumed++;
                    // the owner's scenes are all seen (or failed) by now, so they are passed over here as well
                    if (this.seen.has(it.id) || this.d.failed(it.id) || !opens(it)) continue;
                    return it.id;
                }
                if (s.exhausted || !this.d.pages || read >= MAX_PAGES_PER_STEP) return null;
                if (!late) {
                    this.d.onSearch?.();
                    const ms = this.d.readTimeoutMs ?? SUPERSPLAT_READ_MS;
                    late = new Promise<'late'>((resolve) => { timer = setTimeout(() => resolve('late'), ms); });
                }
                let page: TourPage | 'late';
                try {
                    // a page that arrives after the budget is dropped (race keeps its rejection handled)
                    page = await Promise.race([this.d.pages(s.nextSkip, this.pageSize), late]);
                } catch {
                    return null;
                }
                if (page === 'late') return null;
                const end = s.nextSkip + this.pageSize;
                s.nextSkip = end;
                // the proxy allows skip up to EXPLORE_BOUNDS.skipMax; an empty page ends the list as well
                if (end >= page.total || end > EXPLORE_BOUNDS.skipMax || page.items.length === 0) s.exhausted = true;
                let items = page.items.slice();
                if (s.skipFirst > 0) {
                    const passed = Math.min(s.skipFirst, items.length);
                    s.consumed += passed;
                    items = items.slice(passed);
                    s.skipFirst = 0;
                }
                s.buffer.push(...items);
            }
        } finally {
            clearTimeout(timer);
        }
    }

    /** A stream that resumes after `consumed` entries: the page they end in, minus the entries of it already passed. */
    private freshStream(consumed: number): Stream {
        const base = Math.floor(consumed / this.pageSize) * this.pageSize;
        return { buffer: [], nextSkip: base, consumed: base, skipFirst: consumed - base, exhausted: false };
    }

    // ---- the position between visits: every access may throw (private mode, blocked storage), none is required ----
    private load(): Saved | null {
        const store = this.d.store;
        if (!store) return null;
        try {
            const raw = store.getItem(TOUR_KEY);
            if (!raw) return null;
            const v = JSON.parse(raw) as Partial<Saved> | null;
            const now = (this.d.now ?? Date.now)();
            if (!v || v.v !== 1 || typeof v.at !== 'number' || !Number.isFinite(v.at) || now - v.at >= TOUR_KEEP_MS || v.at > now + 24 * 3600 * 1000) return null;
            const ss = typeof v.ss === 'number' && Number.isInteger(v.ss) && v.ss >= 0 && v.ss <= EXPLORE_BOUNDS.skipMax ? v.ss : 0;
            const seen = Array.isArray(v.seen) ? v.seen.filter((x): x is string => typeof x === 'string' && ID.test(x)).slice(-SEEN_KEPT) : [];
            return { v: 1, at: v.at, seen, ss };
        } catch {
            return null;
        }
    }

    private save(): void {
        const store = this.d.store;
        if (!store) return;
        try {
            // only the catalogue's scenes are kept by id; the SuperSplat list is kept as a position
            const own = new Set(this.d.catalogue());
            const seen = [...this.seen].filter((id) => own.has(id)).slice(-SEEN_KEPT);
            // a resume that has not read its first page yet still owes its skipFirst entries: they are part of the position
            const rec: Saved = { v: 1, at: (this.d.now ?? Date.now)(), seen, ss: this.stream.consumed + this.stream.skipFirst };
            store.setItem(TOUR_KEY, JSON.stringify(rec));
        } catch {
            /* blocked or full: the tour goes on in memory */
        }
    }
}
