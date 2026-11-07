// The replay's grip on the flight page (docs/wip/v12-plan.md section 4.3 step 5): everything the player needs of the page, taken from the
// FlightContext in one place, so the player itself knows nothing of the simulator.
//   engine       ctx.sonic.engine, the sound mode's engine (the flight lane's), fed recorded frames
//   clock, voice the AudioContext the engine runs on, reached through its input node (the same way the recorder reads the sample rate);
//                the voice goes into that node too, in front of the engine's limiter
//   view         the camera: the session's cameraOverride is set (the session stops posing it) and the renderer's setPose is called per
//                frame; the flight is paused with the 'panel' reason; both are given back at the end
//   playback     ctx.sonic.playback(true): the mode stops live input, the lesson and its own feed to the engine while the replay drives it
// Nothing here runs while the sound mode is off: link() answers null then, and the controller says so.
import type { SonicWorld } from '@shramko/sonic-fpv';
import type { FlightContext } from '../app/context';
import type { ReplayDeps } from './replay-player';
import { webAudioVoice } from './replay-voice';

export interface ReplayLink {
    readonly deps: ReplayDeps;
    /** the world the mode shows now (null: none), to say when the recording was flown somewhere else */
    readonly world: SonicWorld | null;
    /** the scan scene on screen, for a recording of a scan */
    readonly sceneId: string | null;
}

export interface ReplayHost {
    /** the pieces of the page a replay uses, or null while the sound mode is off */
    link(): ReplayLink | null;
    /** `cb` once per displayed frame; returns the way to stop */
    frames(cb: () => void): () => void;
    /** `cb` when the replay can no longer go on (the mode went off, another scene came in); returns the way to stop */
    lost(cb: () => void): () => void;
}

interface AudioLike {
    readonly currentTime: number;
    readonly outputLatency?: number;
    readonly baseLatency?: number;
    readonly destination: AudioNode;
}

/** The engine's AudioContext, through the node every Web Audio node carries (the engine's auxInput). */
function audioOf(ctx: FlightContext): { ac: AudioLike | null; node: AudioNode | null } {
    const node = ctx.sonic?.engine.auxInput as (AudioNode & { context?: AudioLike }) | null | undefined;
    return { ac: node?.context ?? null, node: node ?? null };
}

export function createReplayHost(ctx: FlightContext): ReplayHost {
    return {
        link() {
            const rt = ctx.sonic;
            if (rt === undefined) return null;
            const { ac, node } = audioOf(ctx);
            const session = ctx.session;
            let previous = false;
            const deps: ReplayDeps = {
                now: () => (ac !== null ? ac.currentTime : performance.now() / 1000),
                engine: rt.engine,
                pose: {
                    begin() {
                        ctx.pause('panel');
                        previous = session.cameraOverride;
                        session.cameraOverride = true;
                    },
                    show(pos, q) {
                        ctx.renderer.setPose(pos[0], pos[1], pos[2], q[0], q[1], q[2], q[3], session.cameraUptiltDeg);
                    },
                    end() {
                        session.cameraOverride = previous;
                        ctx.resume('panel');
                    }
                },
                voice: ac !== null && node !== null ? webAudioVoice(ac as unknown as AudioContext, node) : null,
                own: () => ({ prefs: rt.prefs, theme: rt.theme }),
                playback: (on) => rt.playback(on),
                viewLagMs: () => Math.max(0, ((ac?.outputLatency ?? ac?.baseLatency ?? 0) as number) * 1000)
            };
            return { deps, world: rt.world, sceneId: ctx.scene?.id ?? null };
        },
        frames: (cb) => ctx.events.on('frame', cb),
        lost(cb) {
            const off = ctx.events.on('session', cb);
            const modeOn = ctx.events.on('frame', () => {
                if (ctx.sonic === undefined) cb();
            });
            return () => {
                off();
                modeOn();
            };
        }
    };
}
