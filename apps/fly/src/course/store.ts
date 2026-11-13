// Courses saved for everyone per scene (train 1, lane tracks, T3; the API: docs/tracks-api.md, apps/api/tracks.py). The list
// of a scene is fetched when the scene loads; the newest course is loaded only when the pilot asks for it (Shift+T without a
// course, or the pause menu), and builtin/course.ts proves it on the pilot's own walls (checkTrack in the course worker)
// before it shows it. "Save for everyone" posts the course the pilot generated. Nothing here touches the flight.
import type { TrackFile } from '@shramko/sonic-fpv';
import { SERVER_SCENE_ID, SERVER_TRACK_ID, validateServerTrack } from '@gsfpv/tracks';

export interface CourseRow {
    id: string;
    version: number;
    title: string;
    gates: number;
    lengthM: number;
    created: string;
    /** train 2 (tracks-plan 2.6, 2.9): who made it first, who edited it last (null when never edited), the votes */
    creator?: CourseMark | null;
    editor?: CourseMark | null;
    edited?: string | null;
    up?: number;
    down?: number;
    rating?: number;
}

/** an authorship mark of a list row as apps/api/tracks.py _mark sends it: kind 'pilot' with the pilot's name, 'admin' or
 *  'generator' with name null */
export interface CourseMark { kind: string; name: string | null }

export type Voted = { ok: true; up: number; down: number; v: number } | { ok: false; problem: string };
/** a saved pilot's course: the edit token comes only with a new course or fork (kept in this tab, for its next versions) */
export type SavedMine = { ok: true; id: string; version: number; token: string | null } | { ok: false; problem: string };

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export type Saved = { ok: true; id: string; version: number } | { ok: false; problem: string };
export type Loaded = { ok: true; track: TrackFile } | { ok: false; problem: string };

export class CourseStore {
    constructor(private readonly fetchFn: Fetch = (i, init) => fetch(i, init), private readonly base = '/api/tracks') {}

    /** The scene's courses, newest first; [] for a scene id the server does not keep, or when the API cannot be reached. */
    async list(scene: string, fresh = false): Promise<CourseRow[]> {
        if (!SERVER_SCENE_ID.test(scene)) return [];
        try {
            // fresh: past the browser's 30 s cache of the list (right after a save, lane review TR-14 c)
            const url = `${this.base}?scene=${encodeURIComponent(scene)}`;
            const r = await (fresh ? this.fetchFn(url, { cache: 'no-store' }) : this.fetchFn(url));
            if (!r.ok) return [];
            const j = (await r.json()) as { v?: number; tracks?: unknown };
            if (j.v !== 1 || !Array.isArray(j.tracks)) return [];
            return (j.tracks as CourseRow[]).filter((x) => typeof x?.id === 'string' && SERVER_TRACK_ID.test(x.id) && Number.isInteger(x.version) && x.version >= 1);
        } catch {
            return [];
        }
    }

    /** One course file, held to the contract (the server's own check is not trusted alone). */
    async load(row: Pick<CourseRow, 'id' | 'version'>): Promise<Loaded> {
        try {
            const r = await this.fetchFn(`${this.base}/${encodeURIComponent(row.id)}/v${row.version}`);
            if (!r.ok) return { ok: false, problem: `http ${r.status}` };
            const v = validateServerTrack(await r.json());
            if (!v.ok) return { ok: false, problem: `invalid: ${v.issues.slice(0, 2).join('; ')}`.slice(0, 200) };
            if (v.track.id !== row.id) return { ok: false, problem: 'id differs from the list' };
            return { ok: true, track: v.track };
        } catch (e) {
            return { ok: false, problem: e instanceof Error ? e.message.slice(0, 200) : 'network' };
        }
    }

    /**
     * A pilot's course (author kind person): a new course or a fork (body `parent` = the source) without `token`, a new version
     * of the pilot's own course with the token the create answered (POST .../versions).
     */
    async saveMine(track: TrackFile, token: string | null = null): Promise<SavedMine> {
        const v = validateServerTrack(JSON.parse(JSON.stringify(track)));
        if (!v.ok) return { ok: false, problem: `invalid: ${v.issues.slice(0, 2).join('; ')}`.slice(0, 200) };
        const url = token ? `${this.base}/${encodeURIComponent(track.id)}/versions` : this.base;
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (token) headers['X-Track-Token'] = token;
        try {
            const r = await this.fetchFn(url, { method: 'POST', headers, body: JSON.stringify(track) });
            const j = (await r.json().catch(() => ({}))) as { id?: unknown; version?: unknown; editToken?: unknown; error?: unknown };
            if (r.status === 201 && typeof j.id === 'string' && SERVER_TRACK_ID.test(j.id) && typeof j.version === 'number') {
                return { ok: true, id: j.id, version: j.version, token: typeof j.editToken === 'string' ? j.editToken : token };
            }
            return { ok: false, problem: `http ${r.status}${typeof j.error === 'string' ? ` ${j.error}` : ''}` };
        } catch (e) {
            return { ok: false, problem: e instanceof Error ? e.message.slice(0, 200) : 'network' };
        }
    }

    /** A vote on a course: 1 up, -1 down, 0 takes it back; `voter` is this browser's random id (voterId()). */
    async vote(id: string, v: 1 | -1 | 0, voter: string): Promise<Voted> {
        if (!SERVER_TRACK_ID.test(id) || !/^[0-9a-f]{32}$/.test(voter)) return { ok: false, problem: 'bad-vote' };
        try {
            const r = await this.fetchFn(`${this.base}/${encodeURIComponent(id)}/vote`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ v, voter }) });
            const j = (await r.json().catch(() => ({}))) as { up?: unknown; down?: unknown; v?: unknown; error?: unknown };
            if (r.ok && typeof j.up === 'number' && typeof j.down === 'number') return { ok: true, up: j.up, down: j.down, v: typeof j.v === 'number' ? j.v : v };
            return { ok: false, problem: `http ${r.status}${typeof j.error === 'string' ? ` ${j.error}` : ''}` };
        } catch (e) {
            return { ok: false, problem: e instanceof Error ? e.message.slice(0, 200) : 'network' };
        }
    }

    async save(track: TrackFile): Promise<Saved> {
        const v = validateServerTrack(JSON.parse(JSON.stringify(track)));
        if (!v.ok) return { ok: false, problem: `invalid: ${v.issues.slice(0, 2).join('; ')}`.slice(0, 200) };
        try {
            const r = await this.fetchFn(this.base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(track) });
            const j = (await r.json().catch(() => ({}))) as { id?: unknown; version?: unknown; error?: unknown };
            if (r.status === 201 && typeof j.id === 'string' && SERVER_TRACK_ID.test(j.id)) return { ok: true, id: j.id, version: 1 };
            return { ok: false, problem: `http ${r.status}${typeof j.error === 'string' ? ` ${j.error}` : ''}` };
        } catch (e) {
            return { ok: false, problem: e instanceof Error ? e.message.slice(0, 200) : 'network' };
        }
    }
}

const VOTER_KEY = 'gsfpv.course.voter';
const VOTES_KEY = 'gsfpv.course.votes';
const TOKENS_KEY = 'gsfpv.course.tokens';
/** the newest edit tokens kept (review TK-7; a token is no personal data, it only lets this browser add a version) */
export const TOKENS_KEPT = 50;

type Store = Pick<Storage, 'getItem' | 'setItem'> | null | undefined;

/** globalThis.localStorage, or null when the browser blocks site storage: the getter itself throws then (review TK-2, the
 *  same guard as packages/prefs/src/browser.ts). */
export function siteStorage(): Storage | null {
    try {
        return globalThis.localStorage ?? null;
    } catch {
        return null;
    }
}

function read(store: Store, key: string): string | null {
    try {
        return store?.getItem(key) ?? null;
    } catch {
        return null;
    }
}

function write(store: Store, key: string, value: string): void {
    try {
        store?.setItem(key, value);
    } catch {
        /* private mode or storage blocked: kept for this page visit only */
    }
}

/** This browser's random voter id (tracks-plan 2.7: 128 bits kept by the browser); made once. */
export function voterId(store: Store = siteStorage()): string {
    const had = read(store, VOTER_KEY);
    if (had && /^[0-9a-f]{32}$/.test(had)) return had;
    const a = new Uint8Array(16);
    crypto.getRandomValues(a);
    const id = [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
    write(store, VOTER_KEY, id);
    return id;
}

/** The votes this browser gave (course id -> 1 or -1), so the list shows the pilot's own vote after a reload. */
export function myVotes(store: Store = siteStorage()): Record<string, number> {
    try {
        const j = JSON.parse(read(store, VOTES_KEY) ?? '{}') as unknown;
        return j && typeof j === 'object' ? (j as Record<string, number>) : {};
    } catch {
        return {};
    }
}

export function rememberVote(id: string, v: number, store: Store = siteStorage()): void {
    const all = myVotes(store);
    if (v === 0) delete all[id];
    else all[id] = v;
    const keep = Object.fromEntries(Object.entries(all).slice(-500));
    write(store, VOTES_KEY, JSON.stringify(keep));
}

/** The edit tokens of the pilot's own courses (course id -> token), kept across reloads (review TK-7). */
export function myTokens(store: Store = siteStorage()): Record<string, string> {
    try {
        const j = JSON.parse(read(store, TOKENS_KEY) ?? '{}') as unknown;
        if (!j || typeof j !== 'object' || Array.isArray(j)) return {};
        return Object.fromEntries(Object.entries(j as Record<string, unknown>).filter((e): e is [string, string] =>
            SERVER_TRACK_ID.test(e[0]) && typeof e[1] === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(e[1])));
    } catch {
        return {};
    }
}

export function rememberToken(id: string, token: string, store: Store = siteStorage()): void {
    const all = myTokens(store);
    delete all[id];
    all[id] = token;
    write(store, TOKENS_KEY, JSON.stringify(Object.fromEntries(Object.entries(all).slice(-TOKENS_KEPT))));
}
