// Fly by Sound, the flight side (v0.12, lane v12-flight, docs/wip/v12-plan.md section 4.2): the mode in the page
// (sonic/mode.ts: the prefs' session layer, the lesson pilot for every source, the bridge's samples and events on
// the bus, R short and long, N, [ ] locked, touches), the sound engine in it (sonic/entry.ts: the one AudioContext
// made by the start screen's Start button, the engine, the captions, the pilot's sound settings) and the lessons that
// run in it (sonic/lessons.ts: the host of the sound package's lesson runner). One SonicMode per page, off until a lesson
// enters it. Every hook below does nothing while the mode is off: the frame, session and life listeners return at once,
// the keyup listener finds no press, the keys stay the scene's and the respawn's; a page that was not entered through
// ?sonic= has no entry at all and installs none of it.
//
// Keys the mode takes: R short and long, N and [ ] (mode.ts); the digits answer a question asked (0 skips it), Z says the
// last line again, I says where the pilot is, G opens the sound glossary and comes back (lessons.ts); T and U belong to the
// recorder (lane v12-feedback, features sonic-session). The pause menu gains "Fly by Sound: lessons and settings", the
// start screen over the flight.
import { bindingOf } from '@gsfpv/prefs';
import { S, attitude } from '@gsfpv/sim-core';
import type { SessionEvent } from '@shramko/sonic-fpv';
import { FlightSession } from '../../session';
import type { SessionOptions } from '../../session';
import { typing } from '../../devices/keyboard';
import type { Feature, FlightContext } from '../context';
import { t, locale } from '../../i18n';
import { SonicMode } from '../../sonic/mode';
import { sonicEntry } from '../../sonic/entry';
import type { SonicEntry } from '../../sonic/entry';
import { PageRuntime } from '../../sonic/runtime';
import { LessonHost, EVENT_LOG_CAP } from '../../sonic/lessons';
import type { LessonPage } from '../../sonic/lessons';
import { PrimitiveStage } from '../../sonic/primitives';
import { allProgress } from '../../sonic/store';

// window.__gsfpv.sonic: what the lesson is doing, for the acceptance runs (tools/bench/src/sonic-*.ts)
declare module '../test-hook' {
    interface TestHook {
        /** `events: false` leaves the list of the mode's events out (a poll every 50 ms need not carry hundreds of them) */
        sonic?: (events?: boolean) => {
            lesson: string | null;
            phase: string | null;
            attempt: number;
            touches: number;
            passed: boolean;
            asking: boolean;
            question: { id: string; options: number } | null;
            engine: string;
            /** the craft now: position (flown metres), nose (degrees, 0 = -Z, right positive), speed, motors on */
            pos: [number, number, number];
            yaw: number;
            speed: number;
            armed: boolean;
            speechQueue: number;
            lastLine: string | null;
            stagePrims: number;
            progress: ReturnType<typeof allProgress>;
            events: SessionEvent[];
        };
    }
}

const modes = new WeakMap<FlightContext, SonicMode>();
const hosts = new WeakMap<FlightContext, LessonHost>();

/** The mode of this page (a lesson enters it), or null before the feature installed. */
export function sonicMode(ctx: FlightContext): SonicMode | null {
    return modes.get(ctx) ?? null;
}

/** The lesson host of this page, or null on a page that was not entered through ?sonic=. */
export function lessonHost(ctx: FlightContext): LessonHost | null {
    return hosts.get(ctx) ?? null;
}

/** The craft's state for the test hook. */
function craftNow(ctx: FlightContext): { pos: [number, number, number]; yaw: number; speed: number; armed: boolean } {
    const sim = ctx.session.sim;
    if (!sim) return { pos: [0, 0, 0], yaw: 0, speed: 0, armed: false };
    const s = sim.s;
    return { pos: [s[S.px], s[S.py], s[S.pz]], yaw: attitude(s).yaw, speed: Math.hypot(s[S.vx], s[S.vy], s[S.vz]), armed: s[S.armed] > 0 };
}

/** The page as the lesson host sees it. */
function pageOf(ctx: FlightContext, mode: SonicMode, entry: SonicEntry, stage: PrimitiveStage, showMenu: () => void): LessonPage {
    return {
        mode,
        store: ctx.prefs,
        locale,
        stage,
        onEvent: (cb) => ctx.events.on('sonicEvent', cb),
        path: () => entry.setup.prefs.path,
        session: () => ctx.session,
        // a lesson with other walls: the flown session is replaced, the way the scene host replaces a scan (app/scene-host.ts),
        // the flight held meanwhile (pause 'scene'), the drone, its rules and the gust seed kept
        async swapTo(lw) {
            const swap = entry.swapSession;
            if (!swap) throw new Error('the page cannot swap its session');
            const old = ctx.session;
            ctx.pause('scene');
            try {
                ctx.clearCrash();
                const opts: SessionOptions = {
                    sceneId: lw.builtin.scene.id,
                    world: lw.builtin,
                    renderer: old.renderer,
                    paused: true,
                    preset: old.presetId,
                    overrides: old.overrides,
                    policy: old.policy,
                    crashOn: old.crashOn,
                    windSeed: old.windSeed
                };
                old.dispose();
                const next = await FlightSession.start(ctx.canvas, opts);
                await next.visible;
                swap(next, { id: lw.builtin.scene.id });
            } finally {
                ctx.resume('scene');
            }
        },
        // a scan lesson (module 7) flies the scan the page flies: its world and track come with step 10
        scanWorld: () => null,
        showMenu,
        clock: () => performance.now()
    };
}

export const sonicFlight: Feature = {
    id: 'sonic-flight',
    install(ctx) {
        const mode = new SonicMode({
            events: ctx.events,
            prefs: ctx.prefs,
            session: () => ctx.session,
            setLesson: (a) => ctx.input.setLesson(a),
            onKey: (action, run) => ctx.keys.on(action, run),
            note: (key) => ctx.hud.flash(t(key), 2500)
        });
        modes.set(ctx, mode);
        const offs: (() => void)[] = [];
        const entry = sonicEntry();
        let host: LessonHost | null = null;
        let stage: PrimitiveStage | null = null;
        const log: SessionEvent[] = [];
        // the page was entered through ?sonic=: the engine, its captions and speech, the lessons and their keys are the mode's
        if (entry) {
            const audio = entry.setup.audio;
            mode.engine = audio.engine;
            // every line the engine says is a 'speech' event (the replay's and the report's) once the mode runs
            audio.engine.onSpeech = (line, text) => mode.bridge.speech(line.key, text);
            ctx.sonic = new PageRuntime(entry.setup, mode);
            document.body.classList.add('sonic-mode');
            stage = new PrimitiveStage(ctx.renderer);
            const screen = entry.screen;
            // the start screen over the flight: the flight waits behind it, a lesson chosen on it opens, Escape and Back close it
            const showMenu = (): void => {
                if (!screen) return;
                ctx.pause('panel');
                screen.show();
            };
            const closeMenu = (): void => {
                screen?.hide();
                ctx.resume('panel');
            };
            const h = new LessonHost(pageOf(ctx, mode, entry, stage, showMenu));
            host = h;
            hosts.set(ctx, h);
            screen?.bind({
                onStart: (id) => {
                    closeMenu();
                    void h.open(id).then((ok) => { if (!ok) showMenu(); });
                },
                onClose: closeMenu
            });
            offs.push(ctx.events.on('sonicEvent', (e) => {
                log.push(e);
                if (log.length > EVENT_LOG_CAP) log.shift();
            }));
            offs.push(ctx.menu.add({ id: 'pause.sonic', action: null, labelKey: 'sonic.menu.lessons', order: 95, section: 'tools', run: () => showMenu() }));
            // Z, I and G: keys of the mode, each ignored while no lesson runs
            offs.push(ctx.keys.on('sonic.repeat', (e) => { if (!e.repeat && mode.active) void h.repeat(); }));
            offs.push(ctx.keys.on('sonic.status', (e) => { if (!e.repeat && mode.active) void mode.bridge.say(h.status(), true); }));
            offs.push(ctx.keys.on('sonic.glossary', (e) => { if (!e.repeat && mode.active) void h.glossary(); }));
            // the first lesson: its world is the one the page was made on (the entry built it); a lesson that cannot open
            // (a scan lesson before step 10) leaves the pilot at the start screen, not on a silent page
            if (entry.lessonId) {
                if (entry.world) h.seed(entry.lessonId, entry.world);
                void h.open(entry.lessonId).then((ok) => { if (!ok) showMenu(); });
            } else showMenu();
            ctx.hook.sonic = (withEvents = true) => ({
                lesson: h.lesson ? h.lesson.id : null,
                phase: h.runner ? h.runner.phase : null,
                attempt: h.runner ? h.runner.attempt : 0,
                touches: h.runner ? h.runner.touches : 0,
                passed: h.runner ? h.runner.phase === 'passed' : false,
                asking: h.asking,
                question: h.pending ? { id: h.pending.id, options: h.pending.options } : null,
                engine: audio.engine.state,
                ...craftNow(ctx),
                speechQueue: mode.bridge.speechQueue,
                lastLine: mode.bridge.last ? mode.bridge.last.key : null,
                stagePrims: stage ? stage.count : 0,
                progress: allProgress(ctx.prefs),
                events: withEvents ? [...log] : []
            });
        }
        offs.push(
            ctx.events.on('frame', ({ now }) => {
                const sample = mode.frame(now);
                if (!sample) return;
                // a lesson steps its runner and chooses what the engine hears; without one the engine hears the flight
                if (host?.active) host.frame(sample);
                else mode.hear(sample);
            }),
            // a new scene: the bridge's tick hook follows its runner; the lesson pilot starts from the new craft
            ctx.events.on('session', (s) => {
                if (!mode.active) return;
                mode.follow(s);
                ctx.input.lessonPilot?.resetFlight();
            }),
            // a new life (a reset, a respawn, a new flight model): the same, for the runner it may have made
            ctx.events.on('life', () => {
                if (!mode.active) return;
                mode.follow(ctx.session);
                ctx.input.lessonPilot?.resetFlight();
            })
        );
        // R's release decides short (the last checkpoint) from long (the start, taken while held)
        const rCodes = new Set((bindingOf('respawn.start')?.keys ?? []).map((k) => k.code));
        const onKeyUp = (e: KeyboardEvent): void => {
            if (rCodes.has(e.code)) mode.releaseR();
        };
        // the digits answer a question the lesson asked (0 skips it); with none asked the key is not ours
        const onDigit = (e: KeyboardEvent): void => {
            if (!host || !host.asking || e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
            const m = /^(?:Digit|Numpad)(\d)$/.exec(e.code);
            if (!m || typing(e.target)) return;
            e.preventDefault();
            e.stopPropagation();
            host.answer(Number(m[1]));
        };
        // a hidden tab draws no frames: the engine must not go on sounding the last layers
        const onVisibility = (): void => {
            if (document.visibilityState !== 'visible') mode.bridge.silence();
        };
        addEventListener('keyup', onKeyUp, true);
        addEventListener('keydown', onDigit, true);
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
            host?.close();
            mode.leave();
            for (const off of offs) off();
            removeEventListener('keyup', onKeyUp, true);
            removeEventListener('keydown', onDigit, true);
            document.removeEventListener('visibilitychange', onVisibility);
            if (entry) {
                stage?.dispose();
                entry.setup.audio.engine.onSpeech = null;
                document.body.classList.remove('sonic-mode');
                delete ctx.sonic;
                delete ctx.hook.sonic;
                hosts.delete(ctx);
            }
            modes.delete(ctx);
        };
    }
};
