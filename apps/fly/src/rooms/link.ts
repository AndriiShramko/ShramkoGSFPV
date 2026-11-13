// Lane rooms-public: a room link without a scene (/fly/?room=<id>, typed or cut short in a chat) opens the room's scan instead
// of the scene picker. The server knows the room's scan (GET /api/rooms/<id>, docs/rooms-protocol.md), so boot.ts asks it
// before it would show the picker; a link with ?scene= is opened as before and never asks.
import { parseSceneLink, writeSceneQuery } from '@gsfpv/scenes';
import { ROOM_ID_RE, getRoom } from './api';

type Fetch = typeof fetch;

/**
 * How long a room link waits for the rooms service before the picker opens, ms. An estimate, not measured: the local rig answers
 * at once, the live proxy's own limit was not measured (review RP-4); long enough for a slow mobile answer, short for a wait.
 */
export const ROOM_LINK_WAIT_MS = 8000;

/** What boot.ts gives openFirst(). */
export interface FirstOpen {
    /** open this scene link (boot.ts go(), as a pasted link) */
    go(raw: string): void;
    /** no scene to open: the picker */
    picker(): void;
    /** true while the room is asked for its scan (a short line on the page, said by a screen reader), false when it answered */
    waiting(on: boolean): void;
    /** the room's scene link (default roomSceneLink) */
    ask?(room: string): Promise<string | null>;
}

/**
 * boot.ts's first scene (review RP-5): ?scene= opens at once, in the caller's task (gtag reads the address after it); a room link
 * without a scene after the room named its scan, else (no room, gone, offline, too slow, an error) the picker; no link, the picker.
 */
export function openFirst(scene: string | null, room: string | null, d: FirstOpen): Promise<void> {
    if (scene) {
        d.go(scene);
        return Promise.resolve();
    }
    if (!room) {
        d.picker();
        return Promise.resolve();
    }
    d.waiting(true);
    const ask = d.ask ?? ((r: string) => roomSceneLink(r));
    return ask(room).then((raw) => raw, () => null).then((raw) => {
        d.waiting(false);
        if (raw) d.go(raw);
        else d.picker();
    });
}

/**
 * The scene link (a bare id with its drawing parameters, what boot.ts's go() parses) of the room `room` names, or null: no
 * room, a malformed id, a room the server does not have (gone, never made), no answer, or an answer without a scan id.
 */
export async function roomSceneLink(room: string | null, base = '', f: Fetch = fetch, ms = ROOM_LINK_WAIT_MS): Promise<string | null> {
    if (room === null || !ROOM_ID_RE.test(room)) return null;
    // review RP-4: a rooms service that holds the request must not leave the page with neither a scene nor the picker. The signal
    // stops a real fetch (and its body); the race stops any fetch, also one that ignores the signal
    const timed: Fetch = (u, init) => f(u, { ...init, signal: AbortSignal.timeout(ms) });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<null>((res) => { timer = setTimeout(() => res(null), ms); });
    const a = await Promise.race([getRoom(base, room, timed), late]).finally(() => clearTimeout(timer));
    if (a === null || !a.ok) return null;
    const scene = (a.value as { scene?: unknown }).scene as { id?: unknown; render?: Parameters<typeof writeSceneQuery>[2] } | undefined;
    if (!scene || typeof scene.id !== 'string') return null;
    const p = new URLSearchParams();
    writeSceneQuery(p, scene.id, scene.render);
    p.delete('scene');
    const raw = p.toString() === '' ? scene.id : `${scene.id}?${p.toString()}`;
    // what the server holds was checked when the room was made; a scan id go() would refuse is no link
    return parseSceneLink(raw) ? raw : null;
}
