// The Sessions tab's door to the server (apps/api/sessions_admin.py): the list, a resend per channel, the deletion on request, and the path of the
// download. The download is a plain link (the admin's cookie goes with it, the browser saves the stream): a package of up to 100 MiB must not pass
// through a script. No DOM and no i18n here.
import type { AdminClient } from '../api';
import type { ChannelName, SessionsAnswer } from './model';

/** The streamed .zip of a stored recording, as an attachment. */
export const packagePath = (id: string): string => `/api/admin/sessions/${encodeURIComponent(id)}/package`;

export class SessionsClient {
    constructor(private readonly api: AdminClient) {}

    list(): Promise<SessionsAnswer> {
        return this.api.get<SessionsAnswer>('sessions');
    }

    /** The channel goes back to queued with its failures cleared; the server's worker sends it again at once. */
    resend(id: string, channel: ChannelName): Promise<{ ok: true; id: string; delivered: boolean }> {
        return this.api.post(`sessions/${encodeURIComponent(id)}/resend`, { channel });
    }

    /** The package and its state are removed (a pilot's or a parent's request); the server keeps a tombstone line. */
    remove(id: string): Promise<{ ok: true; id: string }> {
        return this.api.post(`sessions/${encodeURIComponent(id)}/delete`, { confirm: true });
    }
}
