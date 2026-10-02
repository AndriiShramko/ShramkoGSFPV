// The scene library (docs/architecture-v03.md E.1): the scenes flown (history, newest first, at
// most 100), the pilot's favourites (newest star first), the picker's filter, the republished
// scenes' versions and the scenes that failed to load. Pure: every function takes the data and
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

/** Star or unstar: a new star goes first (the order F walks), unstarring keeps the others' order. */
export function toggleFavourite(d: SceneLibraryData, id: string): { data: SceneLibraryData; on: boolean } {
    const on = !d.favourites.includes(id);
    return { data: { ...d, favourites: on ? [id, ...d.favourites] : d.favourites.filter((x) => x !== id) }, on };
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

/** The scene opened last (the picker's "Continue" card), or null. */
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
