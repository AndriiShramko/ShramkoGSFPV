// The scene library (docs/architecture-v03.md E.1): the scenes flown (history, newest first, at
// most 100), the pilot's favourites (newest star first), the picker's filter, the republished
// scenes' versions and the scenes that failed to load. A scene starred before it was ever opened
// (the SuperSplat tab) keeps its title, walls flag and version in a history entry that was never
// opened (lastFlown 0): the favourites list stays plain ids (the stored format every release reads),
// and the opened history (opened()) leaves those entries out. Pure: every function takes the data and
// returns new data; where it is kept (the prefs collection `sceneLibrary`, or v0.2's own keys in a
// page without the store) is the caller's business (index.ts useLibraryStore).

export interface SceneFilter {
    collisionOnly: boolean;
    kind: 'all' | 'interior' | 'exterior';
    flown: 'all' | 'flown' | 'new';
    maxMb: number | null;
}

export const DEFAULT_FILTER: SceneFilter = { collisionOnly: true, kind: 'all', flown: 'all', maxMb: null };

export interface LibraryEntry {
    id: string;
    version: number;
    title?: string;
    author?: string;
    license?: string;
    /** ms since 1970: the last open */
    lastFlown: number;
    /** arms counted in this scene */
    flights: number;
    airtimeS: number;
    /** the scene has walls; null: not known yet */
    hasCollision: boolean | null;
    /** the last failed load (ms since 1970) and its SceneError code; cleared by the next good open */
    failedAt?: number;
    failCode?: string;
}

/** The same shape as @gsfpv/prefs' collection `sceneLibrary`. */
export interface SceneLibraryData {
    v: 1;
    history: LibraryEntry[];
    favourites: string[];
    filter: SceneFilter;
    versions: Record<string, number>;
}

export const HISTORY_CAP = 100;
/** A scene that failed to load is left out of the rotation this long (E.3). */
export const FAILED_SKIP_MS = 24 * 3600 * 1000;

export function emptyLibrary(): SceneLibraryData {
    return { v: 1, history: [], favourites: [], filter: { ...DEFAULT_FILTER }, versions: {} };
}

function entry(id: string): LibraryEntry {
    return { id, version: 1, lastFlown: 0, flights: 0, airtimeS: 0, hasCollision: null };
}

/** Newest first, one entry per id, at most HISTORY_CAP. */
function capped(h: LibraryEntry[]): LibraryEntry[] {
    return h.slice(0, HISTORY_CAP);
}

/** A scene opened (loaded and on screen): first in the history; a failure noted before is cleared. */
export function recordOpen(d: SceneLibraryData, e: Pick<LibraryEntry, 'id' | 'version' | 'title' | 'hasCollision'>, now: number): SceneLibraryData {
    const old = d.history.find((x) => x.id === e.id);
    const next: LibraryEntry = { ...(old ?? entry(e.id)), lastFlown: now, version: e.version >= 1 ? e.version : old?.version ?? 1 };
    next.hasCollision = e.hasCollision ?? next.hasCollision;
    if (e.title) next.title = e.title;
    delete next.failedAt;
    delete next.failCode;
    return { ...d, history: capped([next, ...d.history.filter((x) => x.id !== e.id)]) };
}

/** A flight in a scene (the first arm): its count and airtime grow; a scene not in the history is not added. */
export function recordFlight(d: SceneLibraryData, id: string, airtimeS: number): SceneLibraryData {
    if (!d.history.some((x) => x.id === id)) return d;
    return { ...d, history: d.history.map((x) => (x.id === id ? { ...x, flights: x.flights + 1, airtimeS: x.airtimeS + Math.max(0, airtimeS) } : x)) };
}

/** What the place a scene is starred from knows of it (a card of the SuperSplat tab, the picker). */
export interface FavouriteMeta { title?: string; hasCollision?: boolean | null; version?: number }

/**
 * Star or unstar: a new star goes first (the order F walks), unstarring keeps the others' order.
 * `meta` (title, walls, version) is kept with the scene: on its history entry, or on a new entry that
 * was never opened (lastFlown 0) for a scene starred before it was flown; what is known already is
 * only filled in, never replaced by an unknown. Unstarring drops such a never-opened entry again.
 */
export function toggleFavourite(d: SceneLibraryData, id: string, meta: FavouriteMeta = {}): { data: SceneLibraryData; on: boolean } {
    const on = !d.favourites.includes(id);
    const favourites = on ? [id, ...d.favourites] : d.favourites.filter((x) => x !== id);
    const old = d.history.find((x) => x.id === id);
    let history = d.history;
    if (on) {
        const e: LibraryEntry = { ...(old ?? entry(id)) };
        if (meta.title) e.title = meta.title;
        if (typeof meta.hasCollision === 'boolean') e.hasCollision = meta.hasCollision;
        if (meta.version && meta.version > e.version) e.version = meta.version;
        history = old ? d.history.map((x) => (x.id === id ? e : x)) : capped([...d.history, e]);
    } else if (old && old.lastFlown === 0 && old.failedAt === undefined) {
        history = d.history.filter((x) => x.id !== id);
    }
    const versions = on && meta.version && meta.version > 1 ? { ...d.versions, [id]: Math.max(meta.version, d.versions[id] ?? 0) } : d.versions;
    return { data: { ...d, favourites, history, versions }, on };
}

/** The scenes opened here, newest first (the Recent tab, the history rotation): never-opened entries left out. */
export function opened(d: SceneLibraryData): LibraryEntry[] {
    return d.history.filter((e) => e.lastFlown > 0);
}

/** Each favourite with what is known of it, in the favourites' order; an id-only favourite (older lists) has walls unknown. */
export function favouriteEntries(d: SceneLibraryData): LibraryEntry[] {
    return d.favourites.map((id) => {
        const e = d.history.find((x) => x.id === id);
        return e ? { ...e, version: Math.max(e.version, d.versions[id] ?? 1) } : { ...entry(id), version: d.versions[id] ?? 1 };
    });
}

/** What the picker needs of a curated scene. */
export interface CuratedCard { id: string; title: string; collision: boolean; kind: string }

/** One card of the picker's built-in tabs; collision null: not known (shown under the walls filter, never hidden on a guess). */
export interface PickerRow { id: string; title: string; collision: boolean | null; flights: number; fav: boolean }

/** The picker's built-in tabs: the owner's catalogue (`showcase`), the pilot's own Recent and Favourites. */
export type PickerTabId = 'showcase' | 'recent' | 'favourites';

/** The parts of SceneFilter a tab can obey (maxMb is kept in the stored filter but no tab reads it yet). */
export type FilterKey = 'collisionOnly' | 'kind' | 'flown';

/**
 * Which filter controls each built-in tab obeys (the owner's item 4, v0.7). The walls filter (default on)
 * is a discovery tool: it applies where scenes come to the pilot (Recent, and the SuperSplat tab, which
 * has its own filters), never to a list someone chose by hand. The catalogue is the owner's shop window:
 * every scene he published is on it, a scene without walls with a "no walls" badge. Favourites are the
 * pilot's own picks: a starred scene stays there, badge and all. Kind only means something for the
 * catalogue (Recent and Favourites have no kind for scenes outside it). The picker hides a control the
 * open tab does not obey, so a filter never looks active while doing nothing.
 */
export const TAB_FILTERS: Readonly<Record<PickerTabId, readonly FilterKey[]>> = {
    showcase: ['kind', 'flown'],
    recent: ['collisionOnly', 'flown'],
    favourites: ['flown']
};

/** Does this tab obey this filter control (TAB_FILTERS)? */
export function tabObeys(tab: PickerTabId, key: FilterKey): boolean {
    return TAB_FILTERS[tab].includes(key);
}

/** A card before the filter: what the filter controls look at (kind null: not in the catalogue). */
export interface PickerCandidate extends PickerRow { kind: string | null }

/** One built-in tab after the filter: its cards, and how many the filter hid (an empty tab says why). */
export interface PickerList { rows: PickerRow[]; hidden: number }

/**
 * The cards of one tab before any filter (pickerList filters them): the catalogue in the admin's order,
 * Recent newest first, Favourites in the star order; a scene in the catalogue takes its title and walls
 * from there, any other keeps what it was opened or starred with.
 */
export function tabCandidates(tab: PickerTabId, curated: readonly CuratedCard[], d: SceneLibraryData): PickerCandidate[] {
    const byId = new Map(curated.map((s) => [s.id, s]));
    const flights = (id: string): number => d.history.find((e) => e.id === id)?.flights ?? 0;
    const base: { id: string; title: string; collision: boolean | null; kind: string | null }[] =
        tab === 'showcase' ? curated.map((s) => ({ id: s.id, title: s.title, collision: s.collision, kind: s.kind }))
        : (tab === 'recent' ? opened(d) : favouriteEntries(d)).map((e) => {
            const c = byId.get(e.id);
            return { id: e.id, title: c?.title ?? e.title ?? e.id, collision: c ? c.collision : e.hasCollision, kind: c?.kind ?? null };
        });
    return base.map((s) => ({ ...s, flights: flights(s.id), fav: d.favourites.includes(s.id) }));
}

/**
 * The candidates the given filter controls let through: walls (collision false is out; unknown stays,
 * never hidden on a guess), kind, flown. The one place the filter's rules live; pickerList applies the
 * controls a tab obeys (TAB_FILTERS).
 */
export function filterCandidates(cands: readonly PickerCandidate[], keys: readonly FilterKey[], f: SceneFilter): PickerCandidate[] {
    const walls = keys.includes('collisionOnly') && f.collisionOnly;
    const kind = keys.includes('kind') && f.kind !== 'all' ? f.kind : null;
    const flown = keys.includes('flown') ? f.flown : 'all';
    return cands
        .filter((s) => !walls || s.collision !== false)
        .filter((s) => kind === null || s.kind === kind)
        .filter((s) => flown === 'all' || (flown === 'flown' ? s.flights > 0 : s.flights === 0));
}

/**
 * The cards of the picker's Showcase, Recent and Favourites tabs after the filter controls the tab obeys
 * (TAB_FILTERS), and how many the filter hid (ui/scenes.ts draws them; pickerEmpty says why a tab is empty).
 */
export function pickerList(tab: PickerTabId, curated: readonly CuratedCard[], d: SceneLibraryData, f: SceneFilter): PickerList {
    const all = tabCandidates(tab, curated, d);
    const rows = filterCandidates(all, TAB_FILTERS[tab], f).map(({ id, title, collision, flights, fav }) => ({ id, title, collision, flights, fav }));
    return { rows, hidden: all.length - rows.length };
}

/**
 * Why a built-in tab shows no card, as the key of its text (scenes.empty.<reason>): 'filter' when the
 * filter hid every card (the tab is not empty, the filter is), else the tab's own "nothing here yet".
 */
export function pickerEmpty(tab: PickerTabId, list: PickerList): 'filter' | PickerTabId {
    return list.hidden > 0 ? 'filter' : tab;
}

/** A scene that failed to load: kept in the history (the picker still lists it), skipped by the rotation for a day. */
export function recordFailure(d: SceneLibraryData, id: string, code: string, now: number): SceneLibraryData {
    const old = d.history.find((x) => x.id === id);
    if (old) return { ...d, history: d.history.map((x) => (x.id === id ? { ...x, failedAt: now, failCode: code } : x)) };
    // never opened here: at the end of the history, so it does not become "the last scene"
    return { ...d, history: capped([...d.history, { ...entry(id), failedAt: now, failCode: code }]) };
}

/** Failed to load less than FAILED_SKIP_MS ago. */
export function failedRecently(d: SceneLibraryData, id: string, now: number): boolean {
    const e = d.history.find((x) => x.id === id);
    return !!e && e.failedAt !== undefined && now - e.failedAt < FAILED_SKIP_MS;
}

/** The scene opened last (the picker's "Continue" card), or null; a starred, never-opened scene is not one. */
export function lastScene(d: SceneLibraryData): LibraryEntry | null {
    let best: LibraryEntry | null = null;
    for (const e of d.history) if (e.lastFlown > 0 && (!best || e.lastFlown > best.lastFlown)) best = e;
    return best;
}

/**
 * Two libraries as one (an import, v0.2's keys into the store): per scene the newer open wins its
 * fields, counts and airtime take the larger (the same flights may be in both), a failure is kept
 * when it is newer than both opens; favourites keep `a`'s order, then `b`'s new ones in theirs;
 * `a`'s filter; versions take the higher.
 */
export function mergeLibraries(a: SceneLibraryData, b: SceneLibraryData): SceneLibraryData {
    const byId = new Map<string, LibraryEntry>();
    for (const e of [...a.history, ...b.history]) {
        const o = byId.get(e.id);
        if (!o) { byId.set(e.id, { ...e }); continue; }
        const [newer, older] = e.lastFlown > o.lastFlown ? [e, o] : [o, e];
        const m: LibraryEntry = { ...older, ...newer, flights: Math.max(e.flights, o.flights), airtimeS: Math.max(e.airtimeS, o.airtimeS), version: Math.max(e.version, o.version) };
        m.hasCollision = newer.hasCollision ?? older.hasCollision;
        m.title = newer.title ?? older.title;
        const fail = [e, o].filter((x) => x.failedAt !== undefined).sort((x, y) => y.failedAt! - x.failedAt!)[0];
        if (fail && fail.failedAt! > m.lastFlown) { m.failedAt = fail.failedAt; m.failCode = fail.failCode; } else { delete m.failedAt; delete m.failCode; }
        byId.set(e.id, m);
    }
    const history = capped([...byId.values()].sort((x, y) => y.lastFlown - x.lastFlown));
    const favourites = [...a.favourites, ...b.favourites.filter((f) => !a.favourites.includes(f))];
    const versions: Record<string, number> = { ...b.versions };
    for (const [id, v] of Object.entries(a.versions)) versions[id] = Math.max(v, versions[id] ?? 0);
    return { v: 1, history, favourites: [...new Set(favourites)], filter: { ...a.filter }, versions };
}
