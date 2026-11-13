// Train 1, lane rooms: the HTTP half of protocol rooms/1 (docs/rooms-protocol.md "HTTP"): create a room, read one, the
// list of listed rooms; and where the WebSocket is. `base` is the page's origin ('' on the page; the rig's address in
// Node tests).
import type { SceneRender, SharedSettings } from '@gsfpv/scenes';

/** secrets.token_urlsafe(8) on the server: 11 characters */
export const ROOM_ID_RE = /^[A-Za-z0-9_-]{11}$/;

export interface RoomScene { id: string; render?: SceneRender }

/** A room as the server shows it (docs/rooms-protocol.md `Room`). */
export interface RoomInfo {
    id: string;
    name: string;
    scene: RoomScene;
    shared?: SharedSettings;
    course?: string;
    cap: number;
    members: number;
    listed: boolean;
    /** 'persistent': an open room (lane rooms2, R27): no host, no shared settings */
    kind: 'temp' | 'persistent';
    state: 'open';
    createdAt: number;
}

export interface CreateBody { scene: RoomScene; shared?: SharedSettings; name?: string; listed?: boolean }

export type Answer<T> = { ok: true; value: T } | { ok: false; error: string; status: number };

type Fetch = typeof fetch;

async function call<T>(f: Fetch, url: string, init?: RequestInit): Promise<Answer<T>> {
    let res: Response;
    try {
        res = await f(url, init);
    } catch {
        return { ok: false, error: 'network', status: 0 };
    }
    let body: unknown = null;
    try { body = await res.json(); } catch { body = null; }
    if (!res.ok) {
        const e = body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string' ? (body as { error: string }).error : `http-${res.status}`;
        return { ok: false, error: e, status: res.status };
    }
    return { ok: true, value: body as T };
}

export function createRoom(base: string, body: CreateBody, f: Fetch = fetch): Promise<Answer<{ id: string; hostKey: string }>> {
    return call(f, `${base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

/** Lane rooms2 (R27): the open room to join from the scan `scene` (the service picks it, docs/rooms-protocol.md). */
export function openRoom(base: string, scene: string, f: Fetch = fetch): Promise<Answer<{ id: string; room: RoomInfo }>> {
    return call(f, `${base}/api/rooms/open`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scene: { id: scene } }) });
}

export function getRoom(base: string, id: string, f: Fetch = fetch): Promise<Answer<RoomInfo>> {
    return call(f, `${base}/api/rooms/${encodeURIComponent(id)}`);
}

/** A 200 without a rooms array (a static server with no rooms API answers the page's own HTML or nothing) is not a
 *  list: answered as an error, so the panel shows "no list" instead of throwing on `value.rooms`. */
export async function listRooms(base: string, f: Fetch = fetch): Promise<Answer<{ v: number; rooms: RoomInfo[] }>> {
    const a = await call<{ v: number; rooms: RoomInfo[] }>(f, `${base}/api/rooms`);
    if (a.ok && !(a.value && typeof a.value === 'object' && Array.isArray(a.value.rooms))) return { ok: false, error: 'bad-body', status: 200 };
    return a;
}

/** The WebSocket's address for a page at `loc` (ws: on http, wss: on https). */
export function socketUrl(loc: { protocol: string; host: string }): string {
    return `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}/api/rooms/ws`;
}
