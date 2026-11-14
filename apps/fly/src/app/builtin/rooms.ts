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
// leaves, 0 (who is around) and a near call are said (rooms/announce.ts: the sound mode's speech, else a polite live
// region). The panel "Fly with others" (pause menu, key 9) is rooms/panel.ts. Rooms never write into the sim, the input
// log or the runner (A6, tools/bench/test/rooms-a6.test.ts). Without a room and without the menu nothing here runs.
import { readShared, sharedQuery } from '@gsfpv/scenes';
import type { SharedSettings } from '@gsfpv/scenes';
import type { Feature, FlightContext } from '../context';
import { applyShared } from '../shared-visit';
import { q } from '../env';
import { t } from '../../i18n';
import { sharedOf } from '../../share/shared';
import { ROOM_ID_RE, createRoom, listRooms, openRoom, socketUrl } from '../../rooms/api';
import { loadCatalog } from '../../ui/scenes';
import { nextScan, ninePress, voteLine, voteView } from '../../rooms/vote';
import type { VoteMsg } from '../../rooms/vote';
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
import { roomKeys, welcomeLine } from '../../rooms/keys';
import { dialogOpen } from '../../devices/keyboard';
import { NameTags } from '../../rooms/tags';
import type { RacePage } from '../../rooms/race-page';
import { RACE_ON, tableRows } from '../../rooms/race';
import { closeVisit, openVisit } from '../../rooms/open-visit';

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/**
 * THE ONE CONSTANT (train1-plan.md section 8, step 6), flipped by lane rooms-public: true shows the pause menu's "Fly with
 * others" (key 9) and "who is around" (key 0) to everyone. While false they showed only on a page with ?rooms=1 or ?room=.
 */
export const ROOMS_MENU_PUBLIC = true;

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

interface Live { sock: RoomSocket; readonly race: RacePage | null; stop(): void }

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
        /** the other pilots drawn in the last frame, with their names (key 0, the near call) */
        let others: Other[] = [];
        let nearAt = 0;
        const near = new NearWatch();
        const say = (key: string, vars?: Record<string, string | number>, interrupt = false): void => announcer.announce(key, t(key, vars), interrupt);
        /** the key of a rooms action as the key list shows it (9, 0), for the lines that name it */
        const keyOf = (action: string): string => ctx.keys.caps(action)[0]?.cap ?? '';
        // lane rooms2: the catalogue's order and titles, for "the next scan" and the vote lines; read once, at the first join
        let order: string[] = [];
        const titles = new Map<string, string>();
        let catalog: Promise<boolean> | null = null;
        /** true once the catalogue is read (a failed read is asked again next time) */
        const askCatalog = (): Promise<boolean> => (catalog ??= loadCatalog().then((c) => {
            order = c.scenes.map((s) => s.id);
            for (const s of c.scenes) titles.set(s.id, s.title ?? s.id);
            return true;
        }, () => {
            catalog = null;
            return false;
        }));
        /** the visit settings an open room set, to clear on leaving (review RM-4) */
        let aligned: { scene: string; ids: string[] } | null = null;
        const unalign = (): void => {
            if (aligned) closeVisit(ctx.prefs, aligned.scene, aligned.ids);
            aligned = null;
        };
        const title = (id: string): string => titles.get(id) ?? (id === ctx.scene.id ? ctx.scene.meta?.title : undefined) ?? id;
        /** a race line: said (interrupting) and shown (lane rooms2, stage Q2) */
        const tell = (key: string, vars: Record<string, string | number>, interrupt: boolean): void => {
            const text = t(key, vars);
            announcer.announce(key, text, interrupt);
            ctx.hud.flash(text, 4000);
        };
        const roomName = (r: RoomInfo): string => (r.kind === 'persistent' ? t('rooms.open.name') : r.name);

        const join = (room: string, hostKey?: string): void => {
            live?.stop();
            h.room = room;
            h.problem = null;
            h.link = null;
            h.vote = null;
            h.kind = null;
            h.roomScene = null;
            void askCatalog();
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
                h.roomScene = null;
                h.kind = r.kind;
                const id = r.scene.id;
                // an open room has no shared settings and no drawing of its own: each pilot keeps his (lane rooms2)
                const open = r.kind === 'persistent';
                // review RM-5: an open room on a scan this page cannot fly (not in the catalogue, or its load fails):
                // the pilot goes to the open room of his own scan instead of staying where he sees nobody
                if (open && id !== ctx.scene.id && order.length > 0 && !order.includes(id)) return ownOpen();
                unalign();
                // review RM-4: an open room flies the catalogue's size and walls, so poses and seed courses match
                if (open) aligned = { scene: id, ids: openVisit(ctx.prefs, id) };
                else applyShared(ctx.prefs, id, roomShared(r), new Map());
                if (id !== ctx.scene.id || (!open && !sameRender(r.scene.render, ctx.scene.render))) {
                    await ctx.scenes.load(id, 'room', r.scene.render);
                    if (ctx.scene.id !== id) {
                        h.problem = 'scene';
                        if (open) return ownOpen();
                        return;
                    }
                }
                roomScene = id;
                h.roomScene = id;
            };
            const onVote = (m: VoteMsg): void => {
                // review RM-10: 'busy', 'same' and 'wait' answer a proposal; the open vote (if any) stays
                if (m.state === 'open' || m.state === 'passed' || m.state === 'failed') h.vote = voteView(m, sock.slot);
                const line = voteLine(m, sock.slot, title, (s) => sock.members.get(s) ?? `#${s + 1}`, keyOf('rooms.panel'));
                const text = t(line.key, line.params);
                announcer.announce(line.key, text, true);
                ctx.hud.flash(text, 6000);
            };
            let race: RacePage | null = null;
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
                    // with a sound lesson running the digits are the lesson's (sonic/digit-key.ts): 0 works after it (RP-1)
                    if (!welcomed) {
                        const line = welcomeLine(!!ctx.sonic?.runner, roomName(w.room), sock.members.size, keyOf('rooms.who'));
                        say(line.key, line.params);
                    }
                    welcomed = true;
                    void enter(w.room);
                    if (w.vote) onVote(w.vote);
                    if (w.race) race?.onMsg(w.race);
                },
                vote: onVote,
                race: (m) => race?.onMsg(m),
                scene: (r) => {
                    // a vote passed: the room flies another scan; this page loads it and starts there (lane rooms2)
                    h.vote = null;
                    tracks.clear();
                    h.link = roomLink(location.origin, r);
                    void enter(r);
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
            // the race page reaches the course view and the sound package: loaded only when the race is on (RACE_ON)
            if (RACE_ON) {
                void import('../../rooms/race-page').then((m) => {
                    if (sock.state === 'off') return;
                    race = new m.RacePage(ctx, sock, tell);
                    h.race = race.h;
                });
            }
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
                if (inRoom) race?.frame(now);
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
                get race() { return race; },
                stop: () => {
                    offFrame();
                    unalign();
                    race?.dispose();
                    h.race = null;
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
                    h.vote = null;
                    h.kind = null;
                    h.roomScene = null;
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

        /** lane rooms2 (R27), key 9 outside a room: the open room the service picks, no form; when the service does not
         *  answer, the panel opens instead (its list and create) with the reason in the hook */
        const joinOpen = async (): Promise<void> => {
            // review RM-7: a scan outside the catalogue (hidden, by link) is not put in the public list: the panel
            // opens instead, where the pilot creates a room and chooses whether it is listed
            if ((await askCatalog()) && !order.includes(ctx.scene.id)) {
                openPanel();
                return;
            }
            const a = await openRoom('', ctx.scene.id);
            if (!a.ok) {
                h.problem = a.error;
                openPanel();
                return;
            }
            setRoomParam(a.value.id);
            join(a.value.id);
        };
        /** review RM-5: the open room of the pilot's own scan (the service skips busy rooms of other scans) */
        const ownOpen = async (): Promise<void> => {
            const a = await openRoom('', ctx.scene.id, fetch, true);
            if (!a.ok) {
                h.problem = a.error;
                return;
            }
            setRoomParam(a.value.id);
            join(a.value.id);
        };
        const proposeNext = (): string | null => nextScan(order, live?.sock.room?.scene.id ?? ctx.scene.id);

        const openPanel = (): void => {
            const s = live?.sock;
            const r = s && s.state !== 'off' ? s.room : null;
            const next = proposeNext();
            const race = RACE_ON && s && r && s.state === 'joined' ? live?.race ?? null : null;
            // the table on demand: the service answers with the last race's table (the hook and key 0 have it next time)
            if (race) s?.table();
            ctx.pause('panel');
            roomsPanel(ctx.ui, {
                nick,
                race: race ? { start: () => void race.propose(), rows: tableRows(race.h.table) } : null,
                vote: s && r && s.state === 'joined' ? {
                    open: h.vote ? { title: title(h.vote.scene), yes: h.vote.yes, need: h.vote.need, mine: h.vote.mine } : null,
                    next: next === null ? null : title(next),
                    propose: () => { if (next !== null) s.propose(next); },
                    agree: () => s.agree()
                } : null,
                room: s && r ? {
                    name: roomName(r), link: h.link ?? roomLink(location.origin, r), cap: r.cap,
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
            // the two keys go through the page's router like every other key (review RV-1, lane rooms-public): 9 and 0, bound
            // nowhere else in the keymap (packages/prefs keymap.ts; the router skips text fields itself). Fly by Sound's lesson
            // takes the digits before the router while it runs (sonic/digit-key.ts); what each key does is rooms/keys.ts
            const inRoom = (): boolean => !!live && live.sock.state === 'joined' && !!ctx.session.shownSim;
            const rk = roomKeys({
                dialogUp: () => dialogOpen() || !!document.querySelector('#ui .screen, #ui .panel'),
                inRoom,
                openPanel,
                nine: () => ninePress(!!live && live.sock.state !== 'off', h.vote ?? null),
                joinOpen: () => void joinOpen(),
                agree: () => live?.sock.agree(),
                sayNoRoom: () => say('rooms.say.noRoom', { panel: keyOf('rooms.panel') }, true),
                sayWho: () => {
                    const sim = ctx.session.shownSim;
                    if (!sim) return;
                    const me = simPose(sim, 0, false);
                    const line = whoLine(nearest(me.pos, me.quat, others), t);
                    // lane rooms2, stage Q2: during or after a race his place comes first, then who is around
                    const st = live?.race?.standing() ?? null;
                    if (st) announcer.announce(st.key, t(st.key, st.params), true);
                    announcer.announce(line.key, line.text, !st);
                }
            });
            offs.push(ctx.keys.on('rooms.panel', rk.panel.run, rk.panel.opts));
            offs.push(ctx.keys.on('rooms.who', rk.who.run, rk.who.opts));
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
