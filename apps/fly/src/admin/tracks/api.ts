// The Tracks tab's door to the server (apps/api/tracks_admin.py): the scenes, a scene's courses (hidden ones too), a version's file,
// hide, delete (a version or the whole course), a new version by the admin (the rename), and the reset of votes or broken reports.
// No DOM and no i18n here.
import type { AdminClient } from '../api';
import type { AdminTrackRow, SceneCount } from './model';

const tid = (id: string): string => encodeURIComponent(id);

export class TracksAdminClient {
    constructor(private readonly api: AdminClient) {}

    scenes(): Promise<{ scenes: SceneCount[] }> {
        return this.api.get<{ scenes: SceneCount[] }>('tracks');
    }

    rows(scene: string): Promise<{ scene: string; tracks: AdminTrackRow[] }> {
        return this.api.get(`tracks?${new URLSearchParams({ scene }).toString()}`);
    }

    file(id: string, n: number): Promise<Record<string, unknown>> {
        return this.api.get(`tracks/${tid(id)}/v${n}`);
    }

    hide(id: string, hidden: boolean): Promise<{ ok: true; row: AdminTrackRow }> {
        return this.api.post(`tracks/${tid(id)}/hide`, { hidden });
    }

    /** n = null deletes the whole course; a version number deletes that version (the last one takes the course). */
    remove(id: string, n: number | null): Promise<{ ok: true; deleted?: string }> {
        return this.api.post(n === null ? `tracks/${tid(id)}/delete` : `tracks/${tid(id)}/v${n}/delete`, { confirm: true });
    }

    version(id: string, file: Record<string, unknown>): Promise<{ ok: true; id: string; version: number }> {
        return this.api.post(`tracks/${tid(id)}/versions`, file);
    }

    reset(id: string, what: 'votes' | 'broken'): Promise<{ ok: true; row: AdminTrackRow }> {
        return this.api.post(`tracks/${tid(id)}/${what}/reset`, { confirm: true });
    }
}
