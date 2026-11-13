// The Tracks tab's data, typed, and what is worked out from it (apps/api/tracks_admin.py: GET /api/admin/tracks). No DOM and no i18n
// here, so the tab's logic and its tests run in Node (tools/bench/test/admin-tracks.test.ts). The server holds the truth about each
// course (its versions, marks, votes and broken reports); this module only says how a row is read and sorted, what a rename sends,
// and where "Open in the editor" goes (the simulator's page: course=<id>&edit=1, apps/fly/src/course/link.ts).

/** A version's authorship mark (tracks.py _mark): only the name a pilot typed is ever stored. */
export interface Mark {
    readonly kind: string;
    readonly name: string | null;
}

/** One course of a scene, as the admin sees it (tracks.py _row plus the rating), hidden ones included. */
export interface AdminTrackRow {
    readonly id: string;
    readonly version: number;
    readonly versions: readonly number[];
    readonly title: string;
    readonly gates: number;
    readonly lengthM: number;
    readonly created: string;
    readonly edited: string | null;
    readonly creator: Mark;
    readonly editor: Mark | null;
    readonly parent: { readonly id: string; readonly version: number } | null;
    readonly origin: { readonly id: string; readonly version: number } | null;
    readonly up: number;
    readonly down: number;
    readonly broken: number;
    /** false, true (the admin) or 'cap' (a full scene hid its oldest unrated course) */
    readonly hidden: boolean | string;
    readonly editable: boolean;
    readonly rating?: number;
}

export interface SceneCount {
    readonly scene: string;
    readonly tracks: number;
    readonly hidden: number;
}

export type SortBy = 'new' | 'votes' | 'broken';

/** The server's course id: `<scene hex>-<8 hex>` (tracks.py SERVER_ID). */
export const TRACK_ID = /^[0-9a-f]{6,32}-[0-9a-f]{8}$/;
/** The scene id (tracks.py SCENE_ID). */
export const SCENE_ID = /^[0-9a-f]{6,32}$/;
/** A course title's length on the server (tracks.py TITLE_LEN for a pilot's course; a generated one takes up to 120). */
export const TITLE_MIN = 3;
export const TITLE_MAX = 60;

export const isHidden = (r: Pick<AdminTrackRow, 'hidden'>): boolean => r.hidden !== false && r.hidden !== null && r.hidden !== undefined;

/** The words key of a mark's kind and the name to show (null for the generator and the admin, which have none). */
export function markParts(m: Mark | null): { kind: 'generator' | 'pilot' | 'admin' | 'other'; name: string | null } | null {
    if (!m) return null;
    const kind = m.kind === 'generator' || m.kind === 'pilot' || m.kind === 'admin' ? m.kind : 'other';
    const name = kind === 'pilot' && typeof m.name === 'string' && m.name.trim() !== '' ? m.name : null;
    return { kind, name };
}

/** Rows in the chosen order: newest first, most up-votes first (net, ties by newer), or most broken reports first. */
export function sortRows(rows: readonly AdminTrackRow[], by: SortBy): AdminTrackRow[] {
    const newer = (a: AdminTrackRow, b: AdminTrackRow): number => (a.created < b.created ? 1 : a.created > b.created ? -1 : a.id < b.id ? 1 : -1);
    const out = [...rows];
    if (by === 'new') return out.sort(newer);
    if (by === 'votes') return out.sort((a, b) => b.up - b.down - (a.up - a.down) || b.up - a.up || newer(a, b));
    return out.sort((a, b) => b.broken - a.broken || newer(a, b));
}

/** Rows whose title or id contains the query (case folded); an empty query keeps all. */
export function matches(r: AdminTrackRow, query: string): boolean {
    const q = query.trim().toLowerCase();
    return q === '' || r.title.toLowerCase().includes(q) || r.id.includes(q);
}

/** Why a new title is refused before it goes to the server, or null. The server checks the rest (letters, blocklist). */
export function titleIssue(title: string, old: string): 'same' | 'short' | 'long' | null {
    const t = title.trim();
    if (t === old.trim()) return 'same';
    if ([...t].length < TITLE_MIN) return 'short';
    if ([...t].length > TITLE_MAX) return 'long';
    return null;
}

/** The /1 file's author of an admin version of a generated course: /1 has no kind admin, and a file by the generator must keep the
 *  title "Course <x>" (tracks.py validator), so a renamed generated course is written as a person's file under this name. The
 *  server's marks still say "edited by the admin" (meta.json) and keep the generator as the creator. */
export const ADMIN_AUTHOR_NAME = 'Admin';

/** The body of a rename: the latest version's file with the new title. The server gives it the next version number, its
 *  parent and time, and marks it edited by the admin; the creator is kept (tracks_admin.py version). A generator's file becomes
 *  a person's file (ADMIN_AUTHOR_NAME, generator null): browser run A2 found the server refusing a generator file with a free title. */
export function renamed(file: Record<string, unknown>, title: string): Record<string, unknown> {
    const out: Record<string, unknown> = { ...file, title: title.trim().normalize('NFC') };
    const author = file.author as { kind?: unknown } | null | undefined;
    if (author?.kind !== 'person') {
        out.author = { kind: 'person', name: ADMIN_AUTHOR_NAME };
        out.generator = null;
    }
    return out;
}

/** The simulator's page with the course loaded and its editor open (course/link.ts serverOfLink, editOfLink). */
export function editorLink(locale: string, scene: string, id: string): string {
    const q = new URLSearchParams({ scene, course: id, edit: '1' });
    return `/${locale}/fly/?${q.toString()}`;
}

/** The scene list, the busiest first (ties by id), so the scene with courses to look at is on top. */
export function sortScenes(scenes: readonly SceneCount[]): SceneCount[] {
    return [...scenes].sort((a, b) => b.tracks - a.tracks || (a.scene < b.scene ? -1 : 1));
}
