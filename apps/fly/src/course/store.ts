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
}

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
            return (j.tracks as CourseRow[]).filter((x) => typeof x?.id === 'string' && SERVER_TRACK_ID.test(x.id) && x.version === 1);
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
