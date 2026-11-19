// Lane edit4s (train 4, E6): the course editor keeps the pilot's work as drafts in this browser, from the first change on,
// several automatic versions per scene, and a way back to each (Course > Versions). Pure list rules and one storage port;
// the timing (2 s after the last change, at once before a loss, on pagehide) lives in parts/keep.ts.
// Kept in localStorage (the browser storage store.ts already uses): a draft is private, needs no account and does not count
// against the server's create limit. IndexedDB was rejected (async, more code for a 6-12 KB entry).
import type { TrackFile } from '@shramko/sonic-fpv';
import { UNDO_MAX, type Course, type CourseCheck, type EditorState } from '@gsfpv/tracks';

/** one storage key per scene */
export const DRAFTS_PREFIX = 'gsfpv.course.drafts.v1.';
/** entries kept per scene, newest first (design edit4 4) */
export const DRAFTS_KEPT = 10;
/** at most one entry a minute for the same kind of change: the newest is updated in place inside this window */
export const DRAFT_GAP_MS = 60_000;
/** scenes kept; the scene drafted longest ago is dropped */
export const DRAFT_SCENES = 3;
/** a draft is written this long after the last change */
export const DRAFT_DEBOUNCE_MS = 2_000;

/**
 * What made the change a draft records: the seam's ChangeBy (design edit4 1.1: an EditAction kind, 'drag', 'fix', 'piece',
 * 'clear', 'new', 'restore', 'generate') or 'leave' (written because the page or the editor closes).
 */
export type DraftBy = string;

export interface DraftEntry {
    /** ms since 1970 */
    readonly t: number;
    readonly by: DraftBy;
    readonly title: string;
    /** the server course it was edited from, null for a generated or new course */
    readonly sourceId: string | null;
    readonly gates: number;
    /** true once this state was saved on the server (kept, not deleted) */
    readonly saved: boolean;
    readonly track: TrackFile;
    /** true when the pilot dropped this course on purpose (Generate or another course, asked twice): it stays in Versions
     *  and neither it nor an older draft comes back by itself (review edit4s R1) */
    readonly dropped?: boolean;
}

interface SceneDrafts {
    readonly v: 1;
    /** ms of the newest write, to drop the oldest scene */
    readonly at: number;
    readonly list: readonly DraftEntry[];
}

/** the browser storage the drafts need (window.localStorage fits; tests pass a fake) */
export type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

export type DraftWrite = 'ok' | 'blocked';

/** a time of day as the pilot's clock shows it (14:32) */
export function clockOf(ms: number): string {
    const d = new Date(ms);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** the gates and laps, the part of a course a pilot changes: two tracks with the same key are the same course */
export function courseKey(track: Pick<TrackFile, 'gates' | 'laps' | 'start'>): string {
    return JSON.stringify([track.gates, track.laps, track.start]);
}

function isEntry(x: unknown): x is DraftEntry {
    const e = x as DraftEntry;
    return !!e && typeof e.t === 'number' && typeof e.by === 'string' && typeof e.title === 'string' && (e.sourceId === null || typeof e.sourceId === 'string')
        && typeof e.gates === 'number' && typeof e.saved === 'boolean' && !!e.track && Array.isArray(e.track.gates);
}

/** the scene's drafts, newest first; [] when none, unreadable or storage blocked */
export function readDrafts(store: DraftStorage | null, scene: string): DraftEntry[] {
    try {
        const raw = store?.getItem(DRAFTS_PREFIX + scene);
        if (!raw) return [];
        const j = JSON.parse(raw) as Partial<SceneDrafts>;
        if (j.v !== 1 || !Array.isArray(j.list)) return [];
        return j.list.filter(isEntry).sort((a, b) => b.t - a.t).slice(0, DRAFTS_KEPT);
    } catch {
        return [];
    }
}

/**
 * The list with `e` added: an unchanged course adds nothing; the newest entry is replaced when it is younger than a minute
 * and of the same kind (so a drag of many small moves is one version); at most DRAFTS_KEPT, newest first.
 */
export function addDraft(list: readonly DraftEntry[], e: DraftEntry): DraftEntry[] {
    const top = list[0];
    if (top && !top.dropped && courseKey(top.track) === courseKey(e.track) && top.title === e.title && top.saved === e.saved) return [...list];
    const rest = top && !top.dropped && top.by === e.by && !top.saved && e.t - top.t < DRAFT_GAP_MS ? list.slice(1) : list;
    return [e, ...rest].slice(0, DRAFTS_KEPT);
}

/** the list with `e` on top marked dropped (the same course on top is marked, not added twice) */
export function dropDraft(list: readonly DraftEntry[], e: DraftEntry): DraftEntry[] {
    const top = list[0];
    if (top && !top.saved && courseKey(top.track) === courseKey(e.track) && top.title === e.title) return [{ ...top, dropped: true }, ...list.slice(1)];
    return [{ ...e, dropped: true }, ...list].slice(0, DRAFTS_KEPT);
}

/** after a save: the entries holding exactly the saved course are marked saved (the list keeps them) */
export function markSaved(list: readonly DraftEntry[], saved: TrackFile): DraftEntry[] {
    const k = courseKey(saved);
    return list.map((e) => (courseKey(e.track) === k ? { ...e, saved: true } : e));
}

/** the scenes that keep drafts, the newest write first */
function scenesOf(store: DraftStorage): { scene: string; at: number }[] {
    const out: { scene: string; at: number }[] = [];
    for (let i = 0; i < store.length; i++) {
        const k = store.key(i);
        if (!k || !k.startsWith(DRAFTS_PREFIX)) continue;
        let at = 0;
        try {
            at = Number((JSON.parse(store.getItem(k) ?? '{}') as Partial<SceneDrafts>).at) || 0;
        } catch {
            /* unreadable: the oldest */
        }
        out.push({ scene: k.slice(DRAFTS_PREFIX.length), at });
    }
    return out.sort((a, b) => b.at - a.at);
}

/**
 * Writes the scene's list and keeps at most DRAFT_SCENES scenes. A full storage drops the oldest (another scene first, else
 * this scene's oldest entry) and tries once more; 'blocked' when that fails too or storage is off.
 */
export function writeDrafts(store: DraftStorage | null, scene: string, list: readonly DraftEntry[], now: number): DraftWrite {
    if (!store) return 'blocked';
    const put = (l: readonly DraftEntry[]): boolean => {
        try {
            store.setItem(DRAFTS_PREFIX + scene, JSON.stringify({ v: 1, at: now, list: l } satisfies SceneDrafts));
            return true;
        } catch {
            return false;
        }
    };
    let ok = put(list);
    if (!ok) {
        const others = scenesOf(store).filter((s) => s.scene !== scene);
        const oldest = others[others.length - 1];
        if (oldest) {
            try {
                store.removeItem(DRAFTS_PREFIX + oldest.scene);
            } catch {
                /* blocked */
            }
            ok = put(list);
        } else if (list.length > 1) ok = put(list.slice(0, -1));
    }
    if (!ok) return 'blocked';
    for (const s of scenesOf(store).slice(DRAFT_SCENES)) {
        try {
            store.removeItem(DRAFTS_PREFIX + s.scene);
        } catch {
            /* blocked */
        }
    }
    return 'ok';
}

/**
 * The editor with `course` put in as ONE undo step (Ctrl+Z gives back the course before it), the selection kept where it
 * fits. The design's EditAction 'replace' (stage S0, packages/tracks/src/editor.ts) does the same; until it exists, this.
 */
export function restoredState(state: EditorState, course: Course, check: CourseCheck): EditorState {
    const undo = [...state.undo, { course: state.course, selected: state.selected }].slice(-UNDO_MAX);
    const selected = Math.max(0, Math.min(course.gates.length - 1, state.selected));
    return { course, selected, undo, redo: [], problems: check(course) };
}

/** the course the editor opened, as the restore rule needs it */
export interface OpenedCourse {
    readonly source: 'generated' | 'server' | 'new' | 'draft';
    readonly track: TrackFile;
    /** ms the opened course was made or last saved on the server; null when unknown (a generated course counts as oldest) */
    readonly madeAt: number | null;
}

/**
 * The draft to bring back when the editor opens, or null: the newest unsaved draft that differs from the opened course and
 * is newer than it. A server course takes back only its own drafts (another course's work stays in Versions); a generated
 * or new course is a throwaway, so any unsaved draft of the scene comes back over it.
 */
export function draftToRestore(list: readonly DraftEntry[], opened: OpenedCourse): DraftEntry | null {
    const k = courseKey(opened.track);
    const own = opened.source === 'server' || opened.source === 'draft';
    for (const e of list) {
        if (e.saved) continue;
        if (own && e.sourceId !== opened.track.id) continue;
        if (opened.madeAt !== null && e.t <= opened.madeAt) continue;
        if (e.dropped) return null;
        return courseKey(e.track) === k ? null : e;
    }
    return null;
}
