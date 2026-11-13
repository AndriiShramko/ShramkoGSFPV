// Train 1, lane rooms (docs/wip/train1-plan.md): flying together: create a room, share its link, join, see and hear the
// other pilots' drones in the same scan. Owner: lane rooms. The feature is registered in app/features.ts on the train
// base, so the lane fills install() here (its code lives in apps/fly/src/rooms/) and never edits features.ts. The page
// hook it fills is RoomsHook (apps/fly/src/rooms/hook.ts, window.__gsfpv.rooms).
//
// Stage R2 (the client core): with ?room=<id> the page opens the room's WebSocket; on the welcome it flies the room's scan
// (SceneHost.load, reason 'room') with the room's shared settings in the store's visit layer for that scan (never
// stored; the pilot's own drone, radio and rates stay his); every frame whose time crossed the next 1/15 s it sends its
// pose read from the shown sim (as sonic/bridge.ts reads it); the other pilots' drones are drawn 150 ms behind on the
// server's clock (rooms/interp.ts) under their own root (rooms/remote-stage.ts). Rooms never write into the sim, the
// input log or the runner (A6, tools/bench/test/rooms-a6.test.ts). Without ?room= nothing here runs.
// The panel, the names, speech and Shift+L / Shift+O are stage R3.
import { readShared } from '@gsfpv/scenes';
import type { SharedSettings } from '@gsfpv/scenes';
import type { Feature, FlightContext } from '../context';
import { applyShared } from '../shared-visit';
import { ROOM_ID_RE, socketUrl } from '../../rooms/api';
import type { RoomInfo } from '../../rooms/api';
import { encodePose } from '../../rooms/codec';
import type { RoomsHook } from '../../rooms/hook';
import { RemoteTrack } from '../../rooms/interp';
import { PoseClock, simPose } from '../../rooms/pose';
import { RemoteStage } from '../../rooms/remote-stage';
import type { RemoteDraw } from '../../rooms/remote-stage';
import { RoomSocket } from '../../rooms/socket';

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** The room asked for by the page's address: ?room=<id>; null without one. */
export function roomParam(search: string): string | null {
    const v = new URLSearchParams(search).get('room');
    return v === null || v === '' ? null : v;
}

/** The room's shared settings as the visit layer takes them: the drone is left out (each pilot flies his own). */
export function roomShared(room: Pick<RoomInfo, 'shared'>): SharedSettings {
    const s = readShared(room.shared ?? {});
    delete s.drone;
    return s;
}

const sameRender = (a: RoomInfo['scene']['render'], b: RoomInfo['scene']['render']): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export const rooms: Feature = {
    id: 'rooms',
    install(ctx: FlightContext) {
        const room = roomParam(location.search);
        const h: Mutable<RoomsHook> = { state: 'off', room, slot: null, members: [], remotes: [], said: [], problem: null };
        ctx.hook.rooms = h;
        // an ordinary flight is the same flight: nothing below runs without a room
        if (room === null) return;
        if (!ROOM_ID_RE.test(room)) {
            h.problem = 'bad-id';
            return;
        }
        const stage = new RemoteStage(ctx.renderer);
        const tracks = new Map<number, RemoteTrack>();
        const poses = new PoseClock();
        /** the room's scan, once the welcome came and that scan is flown */
        let roomScene: string | null = null;

        const members = (): void => {
            h.members = [...sock.members].sort((a, b) => a[0] - b[0]).map(([slot, nick]) => ({ slot, nick }));
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
        const sock = new RoomSocket({ url: socketUrl(location), room, nick: '' }, {
            state: (s) => {
                h.state = s;
                h.problem = sock.problem;
                h.slot = sock.slot;
            },
            welcome: (w) => {
                tracks.clear();
                members();
                void enter(w.room);
            },
            joined: () => members(),
            left: (slot) => {
                tracks.delete(slot);
                members();
            },
            snapshot: (s, local) => {
                for (const m of s.members) {
                    if (m.slot === sock.slot) continue;
                    let t = tracks.get(m.slot);
                    if (!t) tracks.set(m.slot, (t = new RemoteTrack()));
                    t.push(s.serverMs, m.pose, local);
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
            if (inRoom && serverNow !== null) {
                for (const [slot, t] of tracks) {
                    if (!sock.members.has(slot)) continue;
                    const sh = t.sample(serverNow);
                    if (!sh) continue;
                    draw.push({ slot, pos: sh.pos, quat: sh.quat, frozen: sh.frozen });
                    seen.push({ slot, pos: [sh.pos[0], sh.pos[1], sh.pos[2]], ageMs: Math.round(now - t.lastArrival) });
                }
            }
            stage.show(draw);
            h.remotes = seen;
        });

        return () => {
            offFrame();
            sock.leave();
            stage.dispose();
            h.state = 'off';
            h.remotes = [];
        };
    }
};
