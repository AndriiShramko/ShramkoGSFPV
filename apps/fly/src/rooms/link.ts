// Lane rooms-public: a room link without a scene (/fly/?room=<id>, typed or cut short in a chat) opens the room's scan instead
// of the scene picker. The server knows the room's scan (GET /api/rooms/<id>, docs/rooms-protocol.md), so boot.ts asks it
// before it would show the picker; a link with ?scene= is opened as before and never asks.
import { parseSceneLink, writeSceneQuery } from '@gsfpv/scenes';
import { ROOM_ID_RE, getRoom } from './api';

type Fetch = typeof fetch;

/**
 * The scene link (a bare id with its drawing parameters, what boot.ts's go() parses) of the room `room` names, or null: no
 * room, a malformed id, a room the server does not have (gone, never made), no answer, or an answer without a scan id.
 */
export async function roomSceneLink(room: string | null, base = '', f: Fetch = fetch): Promise<string | null> {
    if (room === null || !ROOM_ID_RE.test(room)) return null;
    const a = await getRoom(base, room, f);
    if (!a.ok) return null;
    const scene = (a.value as { scene?: unknown }).scene as { id?: unknown; render?: Parameters<typeof writeSceneQuery>[2] } | undefined;
    if (!scene || typeof scene.id !== 'string') return null;
    const p = new URLSearchParams();
    writeSceneQuery(p, scene.id, scene.render);
    p.delete('scene');
    const raw = p.toString() === '' ? scene.id : `${scene.id}?${p.toString()}`;
    // what the server holds was checked when the room was made; a scan id go() would refuse is no link
    return parseSceneLink(raw) ? raw : null;
}
