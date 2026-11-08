// Fly by Sound, the flight side (v0.12, lane v12-flight, docs/wip/v12-plan.md section 4.2): the mode in the page
// (sonic/mode.ts: the prefs' session layer, the lesson pilot for every source, the bridge's samples and events on
// the bus, R short and long, N, [ ] locked, touches), the sound engine in it (sonic/entry.ts: the one AudioContext
// made by the start screen's Start button, the engine, the captions, the pilot's sound settings) and the lessons that
// run in it (sonic/lessons.ts: the host of the sound package's lesson runner). One SonicMode per page, off until a lesson
// enters it.
//
// Loaded only on a page entered through ?sonic= (v12-int step 4): the feature app/builtin/sonic-flight.ts is a shim in the
// main chunk that calls installSonicFlight() when the page has an entry, and boot.ts loads this module (import(), see
// sonic/lazy-start.ts) when the pilot starts a lesson, before the flight is made. A page without ?sonic= never downloads
// this module, the lessons, the start screen or the sound package.
//
// Keys the mode takes: R short and long, N and [ ] (mode.ts); the digits answer a question asked (0 skips it), Z says the
// last line again, I says where the pilot is (and, through the page's status board, app/sonic-status.ts, what the recorder
// adds), G opens the sound glossary and comes back (lessons.ts); T and U belong to the recorder (lane v12-feedback, feature
// sonic-session). The pause menu gains "Fly by Sound: lessons and settings", the start screen over the flight. T U I Z G exist
// only on this page (keymap `when: 'sonic'`, v12-optin). Two keys of every page do the mode's own thing here (v12-optin,
// mode-keys.ts): L copies a link that opens this lesson in the mode, instead of the share panel's picture; K says the keys.
import { bindingOf } from '@gsfpv/prefs';
import { S, attitude } from '@gsfpv/sim-core';
import { sonicLinkPath } from '@gsfpv/scenes/sonic-link';
import { createSceneSampler } from '@shramko/sonic-fpv';
import { estimateSpeechS } from '@shramko/sonic-fpv/audio';
import type { AnalyticWorldInfo, FlightSample, LessonDef, LessonWorldRef, SessionEvent, SonicWorld, SpeechLine, TrackFile } from '@shramko/sonic-fpv';
import { FlightSession } from '../session';
import { copyText } from '../share/clipboard';
import { keyHelpLines, lessonLink, linkLine } from './mode-keys';
import type { SessionOptions } from '../session';
import { typing } from '../devices/keyboard';
import type { FlightContext } from '../app/context';
import { t, locale } from '../i18n';
import { SonicMode } from './mode';
import type { SonicEntry } from './entry';
import { PageRuntime } from './runtime';
import { digitAnswerHandler } from './digit-key';
import { LessonHost, EVENT_LOG_CAP } from './lessons';
import type { LessonPage } from './lessons';
import { PrimitiveStage, worldPrims } from './primitives';
import type { Prim } from './primitives';
import { lessonViewWorld } from './lesson-world';
import { buildScanLesson, clearScanPrefs, forceScanPrefs, loadLessonTrack } from './scan-lesson';
import type { ScanLesson } from './scan-lesson';
import { allProgress } from './store';
import { STATUS_ORDER, sayStatus, statusBoard } from '../app/sonic-status';
import { setLessonView } from '../app/sonic-view';

// window.__gsfpv.sonic: what the lesson is doing, for the acceptance runs (tools/bench/src/sonic-*.ts)
declare module '../app/test-hook' {
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
            /** the next gate or zone the runner asks for (the target layer's), flown metres, or null */
            target: { id: string; pos: [number, number, number] } | null;
            /** what the engine's frame costs in this page, ms (SonicMode.hearCost) */
            cost: { n: number; p50: number; p95: number; p99: number; max: number };
            /** the walls flown: cell size (m) and whether the session flies a built-in world */
            walls: { voxelM: number | null; builtin: boolean; scene: string; scale: number };
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
        /**
         * What the scene sampler's rays cost in this page: the sampler (30 rays against the world of the lesson, hazards, sectors) run
         * `frames` times at the craft's last sample, the heading turning once round, in one timed span (the page's clock is coarse), after a
         * warm-up. ms per frame; null while no lesson runs.
         */
        sonicRays?: (frames?: number) => { frames: number; msPerFrame: number; raysPerFrame: number } | null;
        /** the last link L made in the mode (v12-optin): its address and whether the clipboard took it (null: still copying) */
        sonicLink?: { url: string; copied: boolean | null } | null;
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

/** The tracks fetched so far, by id and version (a track is never edited in place: a version is fixed). */
type TrackCache = Map<string, Promise<TrackFile>>;

/**
 * The page brings the scan to a scan lesson: it flies it already (the entry loaded it at the lesson's size), or the scan is
 * loaded in the page's own scene switch (the radio and the settings stay; a line says so, the engine is silent meanwhile),
 * or it is flown at another size and is put to the lesson's. Then the lesson's world over the scan and the track.
 */
async function scanLesson(ctx: FlightContext, mode: SonicMode, entry: SonicEntry, tracks: TrackCache, lesson: LessonDef): Promise<ScanLesson | null> {
    const w: LessonWorldRef = lesson.world;
    if (w.kind !== 'scan') return null;
    const key = `${w.track?.id ?? ''}@${w.track?.version ?? 0}`;
    let pending = tracks.get(key);
    if (!pending) {
        // the release serves the track next to the page's own files, under its base (/fly/)
        pending = loadLessonTrack(w, fetch, import.meta.env.BASE_URL);
        tracks.set(key, pending);
        pending.catch(() => tracks.delete(key));
    }
    const say = (line: string): void => void entry.setup.audio.engine.say({ key: line }, { interrupt: false }).catch(() => undefined);
    let track: TrackFile;
    try {
        track = await pending;
    } catch (e) {
        say('sonic.say.scanFailed');
        throw e;
    }
    const [s, tx, ty, tz] = w.transform;
    const ses = ctx.session;
    if (ses.builtin || ses.scene.id !== w.sceneId) {
        forceScanPrefs(ctx.prefs, w);
        mode.bridge.silence();
        say('sonic.say.scanLoading');
        const ok = await ctx.scenes.load(w.sceneId, 'pick');
        if (!ok || ctx.session.builtin || ctx.session.scene.id !== w.sceneId) {
            // the lesson does not open: the scan's size and walls are not kept in the prefs for a flight that is not the lesson's
            clearScanPrefs(ctx.prefs);
            say('sonic.say.scanFailed');
            throw new Error(`the scan ${w.sceneId} did not load`);
        }
    } else if (Math.abs(ses.transform.s - s) > 1e-9 || ses.transform.t.some((v, i) => Math.abs(v - ([tx, ty, tz][i] as number)) > 1e-9)) {
        ses.setTransform({ s, t: [tx, ty, tz] });
        ctx.renderer.renderOnce();
    }
    const now = ctx.session;
    return buildScanLesson(track, {
        sceneId: w.sceneId,
        sceneVersion: now.scene.version,
        spawn: { pos: [now.spawn[0], now.spawn[1], now.spawn[2]], yawDeg: now.spawn[3] },
        // asked each time: the session is replaced by a scene switch, the walls by a refine
        src: { collision: () => ctx.session.collision, transform: () => ctx.session.transform }
    });
}

/** The page as the lesson host sees it. */
function pageOf(ctx: FlightContext, mode: SonicMode, entry: SonicEntry, stage: PrimitiveStage, tracks: TrackCache, showMenu: () => void): LessonPage {
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
        // a scan lesson (module 7): the scan at the lesson's size, walls on, then its world over the track (sonic/scan-lesson.ts)
        scanLesson: (lesson) => scanLesson(ctx, mode, entry, tracks, lesson),
        showMenu,
        clock: () => performance.now()
    };
}

export function installSonicFlight(ctx: FlightContext, entry: SonicEntry): () => void {
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
    let host: LessonHost | null = null;
    let stage: PrimitiveStage | null = null;
    const log: SessionEvent[] = [];
    // the page was entered through ?sonic=: the engine, its captions and speech, the lessons and their keys are the mode's
    const audio = entry.setup.audio;
    mode.engine = audio.engine;
    // every line the engine says is a 'speech' event (the replay's and the report's) once the mode runs
    audio.engine.onSpeech = (line, text) => mode.bridge.speech(line.key, text);
    // "my screen reader speaks": the lesson waits for its lines read one after the other, as the reader reads them (v12-int step 6)
    mode.bridge.sequential = () => !entry.setup.prefs.selfVoice;
    mode.bridge.readTimeMs = (text) => estimateSpeechS(text, entry.setup.prefs.speechRate) * 1000;
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
    const h = new LessonHost(pageOf(ctx, mode, entry, stage, new Map(), showMenu));
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
    let lastSample: FlightSample | null = null;
    offs.push(ctx.events.on('sonicSample', (smp) => { lastSample = smp; }));
    ctx.hook.sonicRays = (frames = 400) => {
        const smp = lastSample;
        const world = h.world;
        if (!smp || !world) return null;
        const sampler = createSceneSampler();
        const run = (n: number): number => {
            const t0 = performance.now();
            for (let i = 0; i < n; i++) sampler.sample({ ...smp, yawDeg: smp.yawDeg + (360 * i) / n }, world);
            return performance.now() - t0;
        };
        run(60);
        return { frames, msPerFrame: Math.round((run(frames) / frames) * 1000) / 1000, raysPerFrame: 30 };
    };
    offs.push(ctx.menu.add({ id: 'pause.sonic', action: null, labelKey: 'sonic.menu.lessons', order: 95, section: 'tools', run: () => showMenu() }));
    // the replay of a recording draws each lesson of it in the helper's view, whatever lesson runs now (v12-int step 5;
    // app/sonic-view.ts, the session side's replay-host.ts): an analytic world from its spec, an ears lesson's floor, a scan
    // lesson's gates only while the page flies that scan; restore() puts the running lesson's view back
    const viewStage = stage;
    const primsOf = (lesson: LessonDef | null, world: SonicWorld | null): readonly Prim[] | null => {
        if (world !== null && world.kind === 'analytic') return worldPrims(world as AnalyticWorldInfo);
        if (lesson === null) return null;
        if (lesson.world.kind === 'scan') {
            const scan = h.scan;
            return scan !== null && h.lesson?.world.kind === 'scan' && h.lesson.world.sceneId === lesson.world.sceneId && ctx.session.scene.id === lesson.world.sceneId ? scan.prims : null;
        }
        const own = lessonViewWorld(lesson);
        return own === null ? null : worldPrims(own);
    };
    setLessonView(ctx, {
        canShow: (lesson, world) => primsOf(lesson, world) !== null,
        show(lesson, world) {
            const prims = primsOf(lesson, world);
            if (prims === null) {
                viewStage.clear();
                return false;
            }
            viewStage.show(prims);
            viewStage.setTarget(null);
            return true;
        },
        restore: () => h.redraw(),
        reopen: () => void h.reopen(),
        scanWorld(lesson) {
            const scan = h.scan;
            if (scan === null || lesson.world.kind !== 'scan' || h.lesson?.world.kind !== 'scan' || h.lesson.world.sceneId !== lesson.world.sceneId || ctx.session.scene.id !== lesson.world.sceneId) return null;
            return { world: scan.world, objects: scan.objects, start: scan.start, floorY: scan.floorY };
        }
    });
    offs.push(() => setLessonView(ctx, null));
    // Z and G: keys of the mode, each ignored while no lesson runs
    offs.push(ctx.keys.on('sonic.repeat', (e) => { if (!e.repeat && mode.active) void h.repeat(); }));
    offs.push(ctx.keys.on('sonic.glossary', (e) => { if (!e.repeat && mode.active) void h.glossary(); }));
    // I: where the pilot is, in one press: the lesson's line (status.lesson, or status.none when none runs), then what the
    // other features add (the recorder's status.recording-on or -off). The only handler of I: the others add providers to
    // the page's status board (app/sonic-status.ts), because the key router runs only the last handler of an action.
    // Through the mode's speech queue while a lesson runs (its speech events and markers), else the engine itself.
    const board = statusBoard(ctx);
    offs.push(board.add({ order: STATUS_ORDER.lesson, line: () => h.status() }));
    offs.push(
        ctx.keys.on('sonic.status', (e) => {
            if (e.repeat) return;
            void sayStatus(board, (line, interrupt) => (mode.active ? mode.bridge.say(line, interrupt) : audio.engine.say(line, { interrupt })));
        })
    );
    // a line of the mode's own keys: through the lesson's speech queue while one runs (its speech events), else the engine itself
    const sayLine = (line: SpeechLine, interrupt: boolean): Promise<void> => (mode.active ? mode.bridge.say(line, interrupt) : audio.engine.say(line, { interrupt }));
    const capOf = (action: string): string => ctx.keys.caps(action).map((c) => c.cap).join(' ');
    // L (v12-optin, mode-keys.ts): a link that opens this lesson in the mode (no language in it: the server sends whoever opens it to
    // his own), copied, then said and captioned; in screen-reader mode the captions are the live region the reader announces. Not
    // copied (the browser refused): said, with the link in the captions for a helper. The pause menu's and the top bar's Share stay
    // the picture panel, for a helper. The key router runs the last handler of an action, so this one wins over share.ts's.
    ctx.hook.sonicLink = null;
    offs.push(
        ctx.keys.on('share.open', (e) => {
            if (e.repeat) return;
            e.preventDefault();
            const lesson = h.lesson;
            const url = `${location.origin}${sonicLinkPath(lessonLink(lesson, entry.setup.prefs))}`;
            ctx.hook.sonicLink = { url, copied: null };
            void copyText(url).then((copied) => {
                ctx.hook.sonicLink = { url, copied };
                if (!copied) entry.setup.captions.add(url);
                return sayLine(linkLine(copied, lesson !== null, capOf('share.open')), true);
            }).catch(() => undefined);
        }),
        // K: the mode's keys, said one after the other (the first cuts what is being said, as I and Z do); the "How to fly" card stays
        // in the pause menu, where K opens it while the menu is up
        ctx.keys.on('help.keys', (e) => {
            if (e.repeat) return;
            keyHelpLines(capOf).forEach((line, i) => void sayLine(line, i === 0).catch(() => undefined));
        }),
        () => {
            delete ctx.hook.sonicLink;
        }
    );
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
        target: (() => {
            const o = h.runner?.target();
            return o ? { id: o.id, pos: [o.pos[0], o.pos[1], o.pos[2]] as [number, number, number] } : null;
        })(),
        cost: mode.hearCost(),
        walls: { voxelM: ctx.session.collision ? ctx.session.collision.voxelResolution : null, builtin: !!ctx.session.builtin, scene: ctx.session.scene.id, scale: ctx.session.transform.s },
        ...craftNow(ctx),
        speechQueue: mode.bridge.speechQueue,
        lastLine: mode.bridge.last ? mode.bridge.last.key : null,
        stagePrims: stage ? stage.count : 0,
        progress: allProgress(ctx.prefs),
        events: withEvents ? [...log] : []
    });
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
    // the digits answer a question the lesson asked (0 skips it); with none asked the key is not ours (digit-key.ts)
    const onDigit = digitAnswerHandler({ host: () => host, paused: () => ctx.session.paused, typing });
    // a hidden tab draws no frames: the engine must not go on sounding the last layers
    const onVisibility = (): void => {
        if (document.visibilityState !== 'visible') {
            mode.bridge.silence();
            mode.cancelR();
        }
    };
    // R released in another window never sends its keyup here: the held R is dropped, not turned into a long press (review D7)
    const onBlur = (): void => mode.cancelR();
    addEventListener('keyup', onKeyUp, true);
    addEventListener('keydown', onDigit, true);
    addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
        host?.close();
        mode.leave();
        for (const off of offs) off();
        removeEventListener('keyup', onKeyUp, true);
        removeEventListener('keydown', onDigit, true);
        removeEventListener('blur', onBlur);
        document.removeEventListener('visibilitychange', onVisibility);
        stage?.dispose();
        entry.setup.audio.engine.onSpeech = null;
        document.body.classList.remove('sonic-mode');
        delete ctx.sonic;
        delete ctx.hook.sonic;
        delete ctx.hook.sonicRays;
        hosts.delete(ctx);
        modes.delete(ctx);
    };
}
