// Train 1, lane rooms (docs/wip/train1-plan.md): flying together: create a room, share its link, join, see and hear the
// other pilots' drones in the same scan. Owner: lane rooms. The feature is registered in app/features.ts on the train
// base, so the lane fills install() here (its code lives in apps/fly/src/rooms/) and never edits features.ts. The page
// hook it fills is RoomsHook (apps/fly/src/rooms/hook.ts, window.__gsfpv.rooms).
//
// Joining (?room=<id>, a Join in the list, or a room just created): the page opens the room's WebSocket; on the welcome it
// flies the room's scan (SceneHost.load, reason 'room') with the room's shared settings in the store's visit layer for that
// scan (never stored; the pilot's own drone, radio and rates stay his); every frame whose time crossed the next 1/15 s it
// sends its pose read from the shown sim (as sonic/bridge.ts reads it); the other pilots' drones are drawn 150 ms behind on
// the server's clock (rooms/interp.ts) under their own root (rooms/remote-stage.ts), with name tags (rooms/tags.ts). Joins,
// leaves, Shift+O (who is around) and a near call are said (rooms/announce.ts: the sound mode's speech, else a polite live
// region). The panel "Fly with others" (pause menu, Shift+L) is rooms/panel.ts. Rooms never write into the sim, the input
// log or the runner (A6, tools/bench/test/rooms-a6.test.ts). Without a room and without the menu nothing here runs.
import { readShared, sharedQuery } from '@gsfpv/scenes';
import type { SharedSettings } from '@gsfpv/scenes';
import type { Feature, FlightContext } from '../context';
import { applyShared } from '../shared-visit';
import { q } from '../env';
import { t } from '../../i18n';
import { isFormField } from '../../ui/hud';
import { sharedOf } from '../../share/shared';
import { ROOM_ID_RE, createRoom, listRooms, socketUrl } from '../../rooms/api';
import type { RoomInfo } from '../../rooms/api';
import { Announcer } from '../../rooms/announce';
import { NearWatch, nearText, nearest, whoLine } from '../../rooms/around';
import type { Other } from '../../rooms/around';
import { encodePose } from '../../rooms/codec';
import type { RoomsHook } from '../../rooms/hook';
import { RemoteTrack } from '../../rooms/interp';
import { loadNick, saveNick } from '../../rooms/nick';
import { roomsPanel } from '../../rooms/panel';
import { PoseClock, simPose } from '../../rooms/pose';
import { RemoteStage } from '../../rooms/remote-stage';
import type { RemoteDraw } from '../../rooms/remote-stage';
import { RoomSocket } from '../../rooms/socket';
import { listenRoomsKeys } from '../../rooms/keys';
import { NameTags } from '../../rooms/tags';

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/**
 * THE ONE CONSTANT the lead flips after the live two-browser check (train1-plan.md section 8, step 6): true shows the pause
 * menu's "Fly with others" and Shift+L to everyone. While false they show only on a page with ?rooms=1 or ?room=.
 */
export const ROOMS_MENU_PUBLIC = false;

/** Whether this page offers the panel: always once public, else only with ?rooms=1 or ?room=<id>. */
export function roomsShown(rooms: string | null, room: string | null, isPublic: boolean = ROOMS_MENU_PUBLIC): boolean {
    return isPublic || rooms === '1' || (room ?? '') !== '';
}

/** The room asked for by the page's address (?room=<id>, the value given); null without one. */
export function roomParam(v: string | null): string | null {
    return v === null || v === '' ? null : v;
}

/** The room's shared settings as the visit layer takes them: the drone is left out (each pilot flies his own). */
export function roomShared(room: Pick<RoomInfo, 'shared'>): SharedSettings {
    const s = readShared(room.shared ?? {});
    delete s.drone;
    return s;
}

/**
 * The link of a room: `/fly/?scene=<scan>&<shared settings>&room=<id>`. The scan rides along because only ?scene= starts a
 * flight in boot.ts (docs/wip/rooms.md, "For the lead"); the host key never goes into a link (the first WebSocket message).
 */
export function roomLink(origin: string, room: Pick<RoomInfo, 'id' | 'scene' | 'shared'>): string {
    const q = sharedQuery(roomShared(room));
    return `${origin}/fly/?scene=${encodeURIComponent(room.scene.id)}${q ? `&${q}` : ''}&room=${encodeURIComponent(room.id)}`;
}

const sameRender = (a: RoomInfo['scene']['render'], b: RoomInfo['scene']['render']): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const HOST_KEY = (id: string): string => `gsfpv.rooms.host.${id}`;
/** Near calls are checked this often, ms (estimate: a drone at 10 m/s moves 2.5 m in that time). */
const NEAR_EVERY_MS = 250;

function storage(kind: 'localStorage' | 'sessionStorage'): Storage | null {
    try {
        return window[kind];
    } catch {
        return null;
    }
}

/** ?room= put into (or taken out of) the address bar without a reload. */
function setRoomParam(id: string | null): void {
    const u = new URL(location.href);
    if (id === null) u.searchParams.delete('room');
    else u.searchParams.set('room', id);
    history.replaceState(history.state, '', u.toString());
}

interface Live { sock: RoomSocket; stop(): void }

export const rooms: Feature = {
    id: 'rooms',
    install(ctx: FlightContext) {
        // the page reads its address once, as q (app/env.ts; packages/prefs/src/url.ts lists room and rooms)
        const first = roomParam(q.get('room'));
        const shown = roomsShown(q.get('rooms'), q.get('room'));
        let nick = loadNick(storage('localStorage')).nick;
        const h: Mutable<RoomsHook> = { state: 'off', room: first, slot: null, members: [], remotes: [], said: [], problem: null, nick, link: null, tags: [] };
        ctx.hook.rooms = h;
        // an ordinary flight is the same flight: nothing below runs without a room or the menu
        if (first === null && !shown) return;

        const announcer = new Announcer({ runtime: () => ctx.sonic ?? null, said: (k) => { h.said = k; }, current: () => h.said });
        const stage = new RemoteStage(ctx.renderer);
        const tags = new NameTags(ctx.ui, () => ctx.renderer.camera);
        let live: Live | null = null;
        /** the other pilots drawn in the last frame, with their names (Shift+O, the near call) */
        let others: Other[] = [];
        let nearAt = 0;
        const near = new NearWatch();
        const say = (key: string, vars?: Record<string, string | number>, interrupt = false): void => announcer.announce(key, t(key, vars), interrupt);

        const join = (room: string, hostKey?: string): void => {
            live?.stop();
            h.room = room;
            h.problem = null;
            h.link = null;
            if (!ROOM_ID_RE.test(room)) {
                h.problem = 'bad-id';
                return;
            }
            const tracks = new Map<number, RemoteTrack>();
            const poses = new PoseClock();
            const hk = hostKey ?? storage('sessionStorage')?.getItem(HOST_KEY(room)) ?? undefined;
            /** the room's scan, once the welcome came and that scan is flown */
            let roomScene: string | null = null;
            let welcomed = false;
            let lostSaid = false;
            const members = (): void => {
                h.members = [...sock.members].sort((a, b) => a[0] - b[0]).map(([slot, n]) => ({ slot, nick: n }));
                h.slot = sock.slot;
            };
            const enter = async (r: RoomInfo): Promise<void> => {
                roomScene = null;
                const id = r.scene.id;
                applyShared(ctx.prefs, id, roomShared(r), new Map());
                if (id !== ctx.scene.id || !sameRender(r.scene.render, ctx.scene.render)) {
                    await ctx.scenes.load(id, 'room', r.scene.render);
                    if (ctx.scene.id !== id) {
                        h.problem = 'scene';
                        return;
                    }
                }
                roomScene = id;
            };
            const sock = new RoomSocket({ url: socketUrl(location), room, nick, hostKey: hk }, {
                state: (s) => {
                    h.state = s;
                    h.problem = sock.problem;
                    h.slot = sock.slot;
                    if (s === 'lost' && welcomed && !lostSaid) {
                        lostSaid = true;
                        say('rooms.say.lost');
                    }
                    if (s === 'off' && sock.problem !== null && sock.problem !== 'closed' && sock.problem !== 'left') say('rooms.say.problem', { code: sock.problem });
                },
                welcome: (w) => {
                    tracks.clear();
                    members();
                    h.link = roomLink(location.origin, w.room);
                    lostSaid = false;
                    if (!welcomed) say('rooms.say.welcome', { name: w.room.name, n: sock.members.size });
                    welcomed = true;
                    void enter(w.room);
                },
                joined: (m) => {
                    members();
                    say('rooms.say.joined', { nick: m.nick, n: sock.members.size });
                },
                left: (slot) => {
                    const gone = h.members.find((m) => m.slot === slot)?.nick ?? `#${slot + 1}`;
                    tracks.delete(slot);
                    members();
                    say('rooms.say.left', { nick: gone, n: sock.members.size });
                },
                snapshot: (s, local) => {
                    for (const m of s.members) {
                        if (m.slot === sock.slot) continue;
                        let tr = tracks.get(m.slot);
                        if (!tr) tracks.set(m.slot, (tr = new RemoteTrack()));
                        tr.push(s.serverMs, m.pose, local);
                    }
                }
            });
            sock.connect();

            const offFrame = ctx.events.on('frame', ({ now }) => {
                const inRoom = sock.state === 'joined' && roomScene !== null && roomScene === ctx.scene.id;
                const ses = ctx.session;
                const sim = ses.shownSim;
                if (inRoom && sim) {
                    const seq = poses.due(now);
                    if (seq !== null) sock.sendPose(encodePose(simPose(sim, seq, ses.paused || ses.replaying)));
                }
                const serverNow = sock.clock.serverNow(now);
                const draw: RemoteDraw[] = [];
                const seen: { slot: number; pos: [number, number, number]; ageMs: number }[] = [];
                const named: Other[] = [];
                const frozen = new Set<number>();
                if (inRoom && serverNow !== null) {
                    for (const [slot, tr] of tracks) {
                        const n = sock.members.get(slot);
                        if (n === undefined) continue;
                        const sh = tr.sample(serverNow);
                        if (!sh) continue;
                        draw.push({ slot, pos: sh.pos, quat: sh.quat, frozen: sh.frozen });
                        const pos: [number, number, number] = [sh.pos[0], sh.pos[1], sh.pos[2]];
                        seen.push({ slot, pos, ageMs: Math.round(now - tr.lastArrival) });
                        named.push({ slot, nick: n, pos });
                        if (sh.frozen) frozen.add(slot);
                    }
                }
                stage.show(draw);
                others = named;
                h.remotes = seen;
                const hudShown = ctx.hud.visible && ctx.hud.root.style.display !== 'none';
                tags.update(named.map((o) => ({ ...o, frozen: frozen.has(o.slot) })), hudShown);
                h.tags = tags.slots;
                // the near call (rooms-plan.md 2.7): once per drone that comes close, not while paused
                if (sim && inRoom && !ses.paused && now - nearAt >= NEAR_EVERY_MS) {
                    nearAt = now;
                    const me = simPose(sim, 0, false);
                    for (const n of near.update(nearest(me.pos, me.quat, named, Infinity), now)) {
                        announcer.announce('rooms.say.near', t('rooms.say.near', { text: nearText(n, t) }));
                    }
                }
            });
            live = {
                sock,
                stop: () => {
                    offFrame();
                    sock.leave();
                    stage.show([]);
                    tags.update([], false);
                    others = [];
                    h.state = 'off';
                    h.remotes = [];
                    h.members = [];
                    h.slot = null;
                    h.tags = [];
                    h.link = null;
                }
            };
        };

        const leave = (): void => {
            if (!live) return;
            live.stop();
            live = null;
            say('rooms.say.youLeft');
            h.room = null;
            setRoomParam(null);
        };

        const create = async (name: string, listed: boolean): Promise<string | null> => {
            const shared = sharedOf(ctx.prefs, ctx.scene.id, { meta: ctx.scene.meta, hasWalls: !!ctx.session.baseCollision });
            const scene = ctx.scene.render ? { id: ctx.scene.id, render: ctx.scene.render } : { id: ctx.scene.id };
            const a = await createRoom('', { scene, shared, name, listed });
            if (!a.ok) {
                h.problem = a.error;
                return a.error;
            }
            try {
                storage('sessionStorage')?.setItem(HOST_KEY(a.value.id), a.value.hostKey);
            } catch {
                // storage blocked: the host key holds for this page only
            }
            setRoomParam(a.value.id);
            join(a.value.id, a.value.hostKey);
            return null;
        };

        const openPanel = (): void => {
            const s = live?.sock;
            const r = s && s.state !== 'off' ? s.room : null;
            ctx.pause('panel');
            roomsPanel(ctx.ui, {
                nick,
                room: s && r ? {
                    name: r.name, link: h.link ?? roomLink(location.origin, r), cap: r.cap,
                    members: h.members.map((m) => ({ ...m, you: m.slot === s.slot }))
                } : null,
                saveNick: (v) => {
                    const ok = saveNick(storage('localStorage'), v);
                    if (ok !== null) h.nick = nick = ok;
                    return ok;
                },
                create,
                join: (id) => {
                    setRoomParam(id);
                    join(id);
                },
                leave,
                list: async () => {
                    const a = await listRooms('');
                    return a.ok ? a.value.rooms : null;
                }
            }, () => ctx.resume('panel'));
        };

        const offs: (() => void)[] = [];
        if (shown) {
            offs.push(ctx.menu.add({ id: 'pause.rooms', action: 'rooms.panel', labelKey: 'pause.rooms', order: 72, section: 'tools', run: openPanel }));
            // the keymap lines stay 'planned' while hidden (review RV-1, rooms/keys.ts): this page takes the chords itself
            offs.push(listenRoomsKeys(window, (action, e) => {
                if (isFormField(e.target)) return false;
                if (action === 'rooms.panel') {
                    if (document.querySelector('#ui .screen, #ui .panel')) return false;
                    if (!e.repeat) openPanel();
                    return true;
                }
                if (e.repeat) return true;
                const sim = ctx.session.shownSim;
                if (!live || live.sock.state !== 'joined' || !sim) {
                    say('rooms.say.noRoom', undefined, true);
                    return true;
                }
                const me = simPose(sim, 0, false);
                const line = whoLine(nearest(me.pos, me.quat, others), t);
                announcer.announce(line.key, line.text, true);
                return true;
            }));
        }
        if (first !== null) join(first);

        return () => {
            for (const off of offs) off();
            live?.stop();
            live = null;
            stage.dispose();
            tags.dispose();
            announcer.dispose();
        };
    }
};
