// The bridge between the flight and Fly by Sound (v0.12, docs/wip/v12-plan.md 2.1, 4.2 step 2 and 9.5): what the
// sound package and the recorder hear of a flight, and the events the replay needs from the host.
//
//   samples  one FlightSample per rendered frame (ctx.events 'sonicSample'): the flight model's state as the
//            frame shows it (the replay's sim while one plays), t on the mode's own clock (ms since start(),
//            running on through pauses: the clock of voice.webm), tick the model's.
//   touches  a contact (crashes off: a bounce, sim-core 'contact') after 0.5 s of quiet begins a touch; a
//            touch sets `touched` in the next sample. Contacts are read by a tick hook on Runner.onStep, at
//            the tick they happen; the hook is put on each runner the session makes (follow(): a new scene,
//            a new flight model) and taken off when the mode stops. With a lesson runner the runner derives
//            the 'touch' event from the sample (the replay does the same); without one the bridge writes it
//            itself by the runner's rule (material by six axis rays, the sample's speed and position).
//   events   every SessionEvent of the mode goes out as ctx.events 'sonicEvent', in order: the runner's (its
//            begin() writes 'lesson open'), and the host's markers the replay takes as inputs: 'key' events
//            with the actions reset.checkpoint, reset.start, next, and since v0.13 previous, repeat and
//            next-lesson (B, Z, the lesson menu), each written before the runner's call, and a 'speech'
//            event with the key speech.end whenever the host's speech queue runs empty and it calls
//            runner.spoken(t). The flight pausing and going on are 'session' pause and resume; the recorder
//            writes start, end, recovered.
//   pause    (v0.13 W8) where the bridge writes the session's pause and resume it calls runner.pause(t) and
//            runner.resume(t) at the same t (the replay takes them from those events): the lesson's clocks stand
//            while the flight waits; no speech.end and no runner.spoken while paused (the queue holds the lesson
//            menu's lines then), one after the resume when the queue is empty. The page tells the bridge at once
//            (syncPause on its 'pause' event), not only at the next frame.
//   silence  when the frames stop (the flight pauses, a replay drives the view, the mode stops) the engine
//            gets setLayers with no layer on, and the lesson's layers again when they go on; speech goes
//            through say(), which passes `interrupt` and keeps the speech queue that spoken() reports.
//
// Nothing here runs while the mode is off: no hook on any runner, no sample, no event, so an ordinary flight
// is the same flight (A6). Pure TypeScript over a small view of the session, so Node tests drive it.
import { S, attitude } from '@gsfpv/sim-core';
import type { Sim, SimEvent } from '@gsfpv/sim-core';
import { REPLAY_KEY_ACTIONS, SPEECH_END_KEY } from '@shramko/sonic-fpv';
import type { CueEvent, FlightSample, LessonLayers, LessonSession, MaterialClass, Pose, SessionEvent, SonicFrameInput, SonicWorld, SpeechLine, Vec3 } from '@shramko/sonic-fpv';

/** Contacts closer together than this are one touch: a touch begins after this much quiet, ticks (0.5 s). */
export const TOUCH_QUIET_TICKS = 500;

/** No layer sounds (what the engine gets when the frames stop). */
export const SILENT_LAYERS: LessonLayers = Object.freeze({ on: Object.freeze([]) as readonly never[], heightBandM: null, hazardVoices: 0 });

/** The runner as the bridge sees it: its model, its events (the tick's own are last in onStep) and the hook slot. */
export interface BridgeRunner {
    readonly sim: Sim;
    readonly events: readonly SimEvent[];
    onStep: ((sim: Sim) => void) | null;
}

/** The part of FlightSession the bridge reads (session/index.ts; a fake in tests). */
export interface BridgeSession {
    /** undefined before the walls are in and after dispose() */
    readonly runner: BridgeRunner | undefined;
    /** the model on screen: the replay's while one plays */
    readonly shownSim: Sim | undefined;
    readonly paused: boolean;
    readonly replaying: boolean;
}

/** Where the bridge's output goes: the page's event bus (sonicSample, sonicEvent). */
export interface BridgeOut {
    sample(s: FlightSample): void;
    event(e: SessionEvent): void;
}

/** What of the engine the bridge and the mode drive: the layers, one-off cues and speech (contract SonicEngine). */
export interface BridgeEngine {
    setLayers(layers: LessonLayers): void;
    cue(e: CueEvent): void;
    say(line: SpeechLine, o?: { readonly interrupt?: boolean }): Promise<void>;
    /** once per rendered frame (SonicMode.hear); the bridge itself never calls it */
    update?(input: SonicFrameInput): void;
    /**
     * Forgets what is sounding (the package's SonicEngine.reset, s13-int; v13-int step 1): the lesson host calls it when it opens a
     * lesson, before the bridge's clock starts again at 0, so the next lesson does not voice the last one's held hazard sectors for
     * 0.3 s with its own walls. Absent on an older engine.
     */
    reset?(): void;
}

/**
 * The craft rests on the respawn platform: the invisible one-way disc a fresh start (a reset, an attempt's return to its
 * start, a bump-recentre) parks it on (sim-core C.2). Its contacts with the disc are not touches: a lesson that allows no
 * touch would be failed by every restart otherwise. The disc is part of the model's state (S.platOn, its centre, radius
 * and top), so this reads the model and only the model; once the craft has left it the disc is off.
 */
export function onPlatform(sim: Sim): boolean {
    const s = sim.s;
    if (!(s[S.platOn] > 0)) return false;
    const d = Math.hypot(s[S.px] - s[S.platX], s[S.pz] - s[S.platZ]);
    // the lowest point of the body within a hair of the disc's top, over the disc: resting on it
    const bottom = s[S.py] - sim.p.bodyBottom;
    return d <= s[S.platR] + sim.p.boundRadius && bottom - s[S.platY] < 0.05;
}

/** The axis rays of a touch's material, as the lesson runner looks (sonic-fpv runner.ts touchMaterial). */
const AXES: readonly Vec3[] = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]];

/** The surface class nearest to `p` along the six axes within 5 m ('wall' when nothing is found), the runner's rule. */
export function touchMaterial(world: SonicWorld | null, p: Vec3): MaterialClass {
    if (!world) return 'wall';
    let best: { d: number; m: MaterialClass } | null = null;
    for (const d of AXES) {
        const hit = world.castRay(p, d, 5);
        if (hit !== null && (best === null || hit.distance < best.d)) best = { d: hit.distance, m: hit.material };
    }
    return best === null ? 'wall' : best.m;
}

export class SonicBridge {
    /** the lesson runner of the mode now: it derives touches, takes the markers; null without a lesson */
    runner: LessonSession | null = null;
    /** the world sound reads (touch materials without a runner) */
    world: SonicWorld | null = null;
    /** the engine (step 7), or null: then nothing sounds and say() only keeps the queue */
    engine: BridgeEngine | null = null;
    /** the layers that sound while the frames run (the lesson's), or null for none */
    layers: LessonLayers | null = null;
    private readonly out: BridgeOut;
    private readonly clock: () => number;
    private session: BridgeSession | null = null;
    private t0 = 0;
    private on = false;
    private inPlayback = false;
    private attached: BridgeRunner | null = null;
    private hook: ((sim: Sim) => void) | null = null;
    /** what was on the runner's onStep before the hook (called first by it, put back by detach) */
    private prevHook: ((sim: Sim) => void) | null = null;
    private lastContactTick = -Infinity;
    private touchPending = false;
    /** the frames run and the layers are on (false: silenced) */
    private sounding = false;
    private pausedNow = false;
    private speaking = 0;
    /**
     * Counts every start() and stop(): a line said in one run of the mode (one lesson) that ends in a later one must not
     * take a line off the later run's count (see say()).
     */
    private epoch = 0;
    private lastLine: SpeechLine | null = null;
    /**
     * "My screen reader speaks" (the engine's selfVoice off; v12-int step 6): the engine says nothing and waits each line's time on
     * its own, all the lines of a burst at once, while a screen reader reads them one after the other. True: the host's queue
     * counts them one after the other too, so the end of speech (the speech.end marker, runner.spoken) comes when the last line
     * would have been read, not when the longest one would, and the lesson does not go on while the reader is on its intro. The
     * lines still go to the engine at once (their speech events and captions are where the runner asked for them, as a replay
     * re-derives them). Set by the page from the pilot's settings; null: the engine's own waits, as before.
     */
    sequential: (() => boolean) | null = null;
    /** how long a line takes to read, ms (the engine's own estimate at the pilot's speaking speed); `sequential` needs it */
    readTimeMs: ((text: string) => number) | null = null;
    /** waits `ms` (the page's timers; a test passes its own clock's) */
    wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    /** when the last line of the sequential queue will have been read, on the bridge's clock (ms) */
    private readEnd = -Infinity;
    /** the lines of the sequential queue not yet read: a line that interrupts, or a new run of the mode, cuts them */
    private readonly readCuts = new Set<() => void>();
    /** the text of the line just handed to the engine (its onSpeech, speech(), runs inside engine.say) */
    private handed: string | null = null;
    /**
     * The lesson's own lines (say with `lesson`: the runner's, the host's line at a lesson's start) handed to the engine and not ended yet,
     * in the order they were handed (v13-int review F1).
     */
    private lessonLines: { readonly line: SpeechLine }[] = [];
    /**
     * Lines of the lesson that a line of the host's own cut (the lesson menu's, the start screen's, K's help, I's status: they interrupt):
     * the lesson's speech is not theirs to drop. They are said again, whole and in order, once the host is done: when its lines are over
     * while the flight runs, or when the flight goes on (sayAgainLater). A newer line of the lesson drops them (the lesson moved on: N, Z, B,
     * the menu's step items). Before review F1 they were lost: Escape early in a lesson took the first lines of its task with it.
     */
    private cutLines: SpeechLine[] = [];
    /** lines of the host's own handed and not ended yet (this run of the mode) */
    private hostSpeaking = 0;
    /** a line was said since the flight last went on (sayAgainLater: one said at the resume, "Resume.", is heard before the lesson's) */
    private saidSinceResume = false;
    /**
     * Called after every call the bridge makes into the lesson runner (begin, reset, next, spoken): the runner may have
     * queued things to do (say a line, place the craft, ask a question), and the host takes them at once instead of
     * at the next frame. Set once by the lesson host; it survives start() and stop().
     */
    afterRunner: (() => void) | null = null;

    constructor(out: BridgeOut, clock: () => number = () => performance.now()) {
        this.out = out;
        this.clock = clock;
    }

    /** The mode runs (start() .. stop()). */
    get running(): boolean {
        return this.on;
    }

    /** The mode's clock now: ms since start(), whole ms. */
    now(): number {
        return Math.round(this.clock() - this.t0);
    }

    /** The mode starts on this session: the clock starts at 0, the tick hook goes on its runner. */
    start(session: BridgeSession): void {
        if (this.on) this.stop();
        this.on = true;
        this.epoch++;
        this.t0 = this.clock();
        this.inPlayback = false;
        this.lastContactTick = -Infinity;
        this.touchPending = false;
        this.pausedNow = session.paused || session.replaying;
        this.sounding = false;
        this.speaking = 0;
        this.lastLine = null;
        this.forgetLines();
        this.cutReading();
        this.follow(session);
    }

    /** A new run of the mode, or its end: the lesson's lines of the run before are nobody's to say again (F1). */
    private forgetLines(): void {
        this.lessonLines = [];
        this.cutLines = [];
        this.hostSpeaking = 0;
        this.saidSinceResume = false;
    }

    /** The lines of the sequential queue are over now (cut by an interrupting line, or the run of the mode ended). */
    private cutReading(): void {
        for (const cut of this.readCuts) cut();
        this.readCuts.clear();
        this.readEnd = -Infinity;
    }

    /** The mode stops: the hook comes off, the engine falls silent; nothing more goes out. */
    stop(): void {
        if (!this.on) return;
        this.detach();
        this.silence();
        this.on = false;
        this.epoch++;
        this.forgetLines();
        this.cutReading();
        this.session = null;
        this.runner = null;
    }

    /**
     * The session now (a new scene: ctx.events 'session') or its runner now (a new flight model: 'life'):
     * the tick hook moves to the runner if it changed. Cheap when nothing changed; nothing while the mode is off.
     */
    follow(session: BridgeSession): void {
        if (!this.on) return;
        this.session = session;
        const r = session.runner;
        if (r === this.attached) return;
        this.detach();
        if (!r) return;
        const prev = r.onStep;
        const hook = (sim: Sim): void => {
            prev?.(sim);
            this.tick(r, sim);
        };
        r.onStep = hook;
        this.attached = r;
        this.hook = hook;
        this.prevHook = prev;
    }

    private detach(): void {
        const r = this.attached;
        // put back what was there, unless someone hooked in after us (then ours stays a pass-through below)
        if (r && r.onStep === this.hook) r.onStep = this.prevHook;
        this.attached = null;
        this.hook = null;
        this.prevHook = null;
    }

    /** The tick hook: this tick's contacts (the last events of the runner) begin a touch after 0.5 s of quiet. */
    private tick(r: BridgeRunner, sim: Sim): void {
        if (!this.on || r !== this.attached) return;
        const ev = r.events;
        for (let i = ev.length - 1; i >= 0; i--) {
            const e = ev[i];
            if (e.tick !== sim.tick) break;
            if (e.type === 'contact' || e.type === 'crash') {
                // resting on the respawn platform is no touch, and does not start the quiet clock either
                if (e.type === 'contact' && onPlatform(sim)) continue;
                if (sim.tick - this.lastContactTick >= TOUCH_QUIET_TICKS) this.touchPending = true;
                this.lastContactTick = sim.tick;
            } else if (e.type === 'respawn') this.lastContactTick = -Infinity; // the craft was moved: the next contact is a new touch
        }
    }

    /** A replay of the recorder drives the view and the engine (SonicRuntime.playback): live samples stop. */
    playback(on: boolean): void {
        this.inPlayback = on;
        if (on) this.silence();
    }

    /**
     * One rendered frame: the sample of the flight now, sent out and returned; null when the mode is off, a
     * playback runs, or there is no model (a scene switch). The flight pausing or going on goes out as a
     * 'session' event, and the engine's layers follow (silent while paused).
     */
    frame(): FlightSample | null {
        const ses = this.session;
        if (!this.on || this.inPlayback || !ses) return null;
        this.follow(ses);
        const sim = ses.shownSim;
        if (!sim) return null;
        const t = this.now();
        const paused = ses.paused || ses.replaying;
        this.pauseState(paused, t);
        if (paused) this.silence();
        else this.sound();
        const s = sim.s;
        const a = attitude(s);
        const touched = this.touchPending && !paused;
        if (touched) this.touchPending = false;
        const sample: FlightSample = {
            t,
            tick: sim.tick,
            pos: [s[S.px], s[S.py], s[S.pz]],
            vel: [s[S.vx], s[S.vy], s[S.vz]],
            quat: [s[S.qw], s[S.qx], s[S.qy], s[S.qz]],
            rate: [s[S.wx], s[S.wy], s[S.wz]],
            yawDeg: a.yaw,
            pitchDeg: a.pitch,
            rollDeg: a.roll,
            sticks: [sim.ch[0], sim.ch[1], sim.ch[2], sim.ch[3]],
            armed: s[S.armed] > 0,
            touched,
            paused
        };
        this.out.sample(sample);
        // without a lesson runner the touch event is the bridge's, by the runner's rule (with one, the runner writes it)
        if (touched && !this.runner) {
            const speed = Math.round(Math.hypot(sample.vel[0], sample.vel[1], sample.vel[2]) * 100) / 100;
            this.event({ t, kind: 'touch', material: touchMaterial(this.world, sample.pos), speed, pos: sample.pos });
        }
        return sample;
    }

    /**
     * The flight paused or went on (v0.13 W8, the package's review R8): the 'session' event, and the lesson runner with it at the same
     * t, runner.pause(t) or runner.resume(t) (the replay takes the pause from that event). While paused the lesson's clocks stand (a
     * question asked before the lesson menu does not time out in it, an attempt's time limit waits, a pause in a band is no time
     * held) and the runner hears no end of speech (the queue holds the menu's lines then); after resume it hears it once, at once
     * when the queue is already empty (else when it runs empty).
     */
    private pauseState(paused: boolean, t: number): void {
        if (paused === this.pausedNow) return;
        this.pausedNow = paused;
        this.event({ t, kind: 'session', what: paused ? 'pause' : 'resume' });
        const run = this.runner;
        if (!run) return;
        this.events(paused ? run.pause(t) : run.resume(t));
        this.afterRunner?.();
        if (paused) return;
        // lines of the lesson a host line cut while the flight waited: said again first, and the end of speech comes after them (F1)
        if (this.cutLines.length > 0) this.sayAgainLater();
        else if (this.speaking === 0) this.spoken();
    }

    /**
     * The flight went on with lines of the lesson waiting to be said again (F1). What the page does at once decides when: a line of the
     * lesson (a menu item that moves it: Next step, Repeat the task) drops them; a line of the host's ("Resume.", K's "Back to the
     * flight.") is heard first, and they follow when it ends (say()); nothing at all: they are said now, the first cutting what the
     * closed menu, screen or help was still saying.
     */
    private sayAgainLater(): void {
        this.saidSinceResume = false;
        const run = this.epoch;
        queueMicrotask(() => {
            if (run !== this.epoch || this.pausedNow) return;
            if (this.cutLines.length === 0) {
                if (this.speaking === 0) this.spoken();
                return;
            }
            if (!this.saidSinceResume) this.sayAgain(true);
        });
    }

    /** The lesson's lines a host line cut, said again whole and in order (F1); the first may cut what is being said. */
    private sayAgain(interruptFirst: boolean): void {
        const lines = this.cutLines;
        this.cutLines = [];
        lines.forEach((line, i) => void this.say(line, interruptFirst && i === 0, { lesson: true }));
    }

    /** Lines of the lesson wait to be said again (F1). */
    get waitingToSayAgain(): number {
        return this.cutLines.length;
    }

    /**
     * The flight's pause now, without waiting for the next frame (the page's 'pause' event: the lesson menu, the pause menu, K's
     * help hold the flight and speak at once, and the runner must be paused before their first line ends).
     */
    syncPause(): void {
        const ses = this.session;
        if (!this.on || this.inPlayback || !ses) return;
        const paused = ses.paused || ses.replaying;
        this.pauseState(paused, this.now());
        if (paused) this.silence();
    }

    /** The flight is paused for the mode (the runner waits with it). */
    get paused(): boolean {
        return this.pausedNow;
    }

    /** The frames stop (also a hidden tab, the page says so): the engine gets no layer, once. */
    silence(): void {
        if (this.sounding) this.engine?.setLayers(SILENT_LAYERS);
        this.sounding = false;
    }

    private sound(): void {
        if (this.sounding) return;
        this.sounding = true;
        this.engine?.setLayers(this.layers ?? SILENT_LAYERS);
    }

    /** New layers (a lesson, a step of it): sent at once while the frames run. */
    setLayers(layers: LessonLayers | null): void {
        this.layers = layers;
        if (this.sounding) this.engine?.setLayers(layers ?? SILENT_LAYERS);
    }

    // ------------------------------------------------------------------ events and the replay's markers

    /** One event of the mode, sent out (nothing while the mode is off). */
    event(e: SessionEvent): void {
        if (this.on) this.out.event(e);
    }

    /** Several, in order (a runner's step, begin, reset, next, answer, spoken). */
    events(list: readonly SessionEvent[]): void {
        for (const e of list) this.event(e);
    }

    /**
     * A lesson begins now: the runner's begin() events go out (the first is 'lesson open', the replay's start). A lesson that begins
     * while the flight is paused (a recording started under its consent dialog opens the lesson again) waits from its start: the
     * pause is written and given to the runner at once, its resume comes with the flight's.
     */
    begin(run: LessonSession): void {
        this.runner = run;
        const t = this.now();
        this.events(run.begin(t));
        if (this.pausedNow) {
            this.event({ t, kind: 'session', what: 'pause' });
            this.events(run.pause(t));
        }
        this.afterRunner?.();
    }

    /** A key the pilot pressed, with the action it did (REPLAY_KEY_ACTIONS for the ones the replay acts on). */
    key(code: string, action: string | null): void {
        this.event({ t: this.now(), kind: 'key', code, action });
    }

    /** R short: the key event the replay reads, then the runner's reset; the pose to put the craft at, or null. */
    resetTo(to: 'checkpoint' | 'start', code: string): { pose: Pose } | null {
        this.key(code, to === 'checkpoint' ? REPLAY_KEY_ACTIONS.resetCheckpoint : REPLAY_KEY_ACTIONS.resetStart);
        const run = this.runner;
        if (!run) return null;
        const r = run.reset(to, this.now());
        this.events(r.events);
        this.afterRunner?.();
        return { pose: r.pose };
    }

    /**
     * A key that moves the lesson (N, B, Z, the lesson menu's items): the key event with its REPLAY_KEY_ACTIONS action first (the
     * replay takes the key from it), then the runner's call at the same t, its events out, its actions taken.
     */
    private keyCall(code: string, action: string, call: (run: LessonSession, t: number) => readonly SessionEvent[]): void {
        const t = this.now();
        this.event({ t, kind: 'key', code, action });
        const run = this.runner;
        if (!run) return;
        this.events(call(run, t));
        this.afterRunner?.();
    }

    /** N: the next step; from the lesson's last step the next lesson (the runner's 'go'). */
    next(code: string): void {
        this.keyCall(code, REPLAY_KEY_ACTIONS.next, (run, t) => run.next(t));
    }

    /** B (v0.13): the step before; from the first step the lesson before; while flying the task again, the attempt dropped. */
    previous(code: string): void {
        this.keyCall(code, REPLAY_KEY_ACTIONS.previous, (run, t) => run.previous(t));
    }

    /** Z (v0.13): the step's whole task again, its named sounds three times (while flying the attempt waits for it). */
    repeatTask(code: string): void {
        this.keyCall(code, REPLAY_KEY_ACTIONS.repeat, (run, t) => run.repeat(t));
    }

    /** The lesson menu's Next lesson: at once, this lesson marked skipped unless it was passed. */
    nextLesson(code: string): void {
        this.keyCall(code, REPLAY_KEY_ACTIONS.nextLesson, (run, t) => run.nextLesson(t));
    }


    /**
     * Speaks a line through the engine, `interrupt` passed on; the queue of lines is counted, and when it runs
     * empty spoken() reports it (the speech.end marker and runner.spoken). The text event of the line is the
     * engine's (onSpeech: speech()).
     *
     * The count belongs to one run of the mode (start() .. stop()): entering the next lesson starts it again at zero while
     * the engine may still be saying the last line of the lesson that was left (G, a lesson chosen on the start screen),
     * and that line ends later, cut by the new lesson's first line or on its own. Such a line is no part of the new run:
     * it takes nothing off its count and reports no end of speech (it would otherwise make the new lesson's queue look
     * empty while its own first line was being said, and the runner would go on before its intro ended).
     *
     * `lesson`: a line of the lesson (the runner's, the host's line at a lesson's start), not of the host's own menus and keys (review
     * F1). A host line that interrupts cuts the lesson's lines that were not said to their end: they are said again once the host is done
     * (cutLines). A line of the lesson that comes later drops those (the lesson moved on), and one that interrupts ends the lesson's own.
     */
    async say(line: SpeechLine, interrupt = false, o: { readonly lesson?: boolean } = {}): Promise<void> {
        if (!this.on) return;
        const lesson = o.lesson === true;
        if (lesson) {
            // the lesson moved on: what a host line cut of its older words is not said again; its own interrupt ends its own lines
            this.cutLines = [];
            if (interrupt) this.lessonLines = [];
        } else if (interrupt && this.lessonLines.length > 0) {
            this.cutLines.push(...this.lessonLines.map((l) => l.line));
            this.lessonLines = [];
        }
        if (!this.pausedNow) this.saidSinceResume = true;
        const mine = lesson ? { line } : null;
        if (mine) this.lessonLines.push(mine);
        else this.hostSpeaking++;
        this.lastLine = line;
        this.speaking++;
        const run = this.epoch;
        const readTime = this.sequential?.() === true ? this.readTimeMs : null;
        // a line that interrupts: what was being read and what waited for its turn are over now
        if (readTime !== null && interrupt) this.cutReading();
        this.handed = null;
        const said = this.engine?.say(line, { interrupt }) ?? Promise.resolve();
        try {
            if (readTime === null) {
                await said;
                return;
            }
            // "my screen reader speaks": read after the lines before it, its own time from when they end (from now when none is read)
            const ends = Math.max(this.clock(), this.readEnd) + readTime(this.handed ?? '');
            this.readEnd = ends;
            let cut: () => void = () => undefined;
            const cutNow = new Promise<void>((resolve) => {
                cut = resolve;
            });
            this.readCuts.add(cut);
            try {
                await Promise.race([
                    (async (): Promise<void> => {
                        await said;
                        const left = ends - this.clock();
                        if (left > 0) await this.wait(left);
                    })(),
                    cutNow
                ]);
            } finally {
                this.readCuts.delete(cut);
            }
        } finally {
            if (run === this.epoch) {
                if (mine) {
                    const i = this.lessonLines.indexOf(mine);
                    if (i >= 0) this.lessonLines.splice(i, 1);
                } else {
                    this.hostSpeaking = Math.max(0, this.hostSpeaking - 1);
                    // the host's lines are over while the flight runs: the lesson's lines they cut are said again now, before the end of
                    // speech can be counted (F1)
                    if (this.hostSpeaking === 0 && this.cutLines.length > 0 && !this.pausedNow) this.sayAgain(false);
                }
                this.speaking = Math.max(0, this.speaking - 1);
                if (this.speaking === 0) this.spoken();
            }
        }
    }

    /** The line last spoken through say(), for Z (hear it again), or null. */
    get last(): SpeechLine | null {
        return this.lastLine;
    }

    /** Z: the last line again, cutting what is being said now. Resolves when it ends; nothing when there is none. */
    repeat(): Promise<void> {
        const line = this.lastLine;
        return line ? this.say(line, true) : Promise.resolve();
    }

    /** Lines waiting or being spoken through say(). */
    get speechQueue(): number {
        return this.speaking;
    }

    /** A line was spoken (the engine's onSpeech): its event, for captions and events.jsonl. */
    speech(key: string, text: string): void {
        this.handed = text;
        this.event({ t: this.now(), kind: 'speech', key, text });
    }

    /**
     * The host's speech queue ran empty: the speech.end marker, then what the runner does on it. Not while the flight is paused (W8):
     * the queue then held the lesson menu's (or K's, or I's) lines, not the lesson's; the runner hears it after the resume.
     */
    spoken(): void {
        if (!this.on || this.pausedNow) return;
        const t = this.now();
        this.event({ t, kind: 'speech', key: SPEECH_END_KEY, text: '' });
        if (this.runner) {
            this.events(this.runner.spoken(t));
            this.afterRunner?.();
        }
    }
}
