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
//            with the actions reset.checkpoint, reset.start and next, and a 'speech' event with the key
//            speech.end whenever the host's speech queue runs empty and it calls runner.spoken(t). The flight
//            pausing and going on are 'session' pause and resume; the recorder writes start, end, recovered.
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
        this.follow(session);
    }

    /** The mode stops: the hook comes off, the engine falls silent; nothing more goes out. */
    stop(): void {
        if (!this.on) return;
        this.detach();
        this.silence();
        this.on = false;
        this.epoch++;
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
        if (paused !== this.pausedNow) {
            this.pausedNow = paused;
            this.event({ t, kind: 'session', what: paused ? 'pause' : 'resume' });
        }
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

    /** A lesson begins now: the runner's begin() events go out (the first is 'lesson open', the replay's start). */
    begin(run: LessonSession): void {
        this.runner = run;
        this.events(run.begin(this.now()));
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

    /** N: the key event the replay reads, then the runner's next step. */
    next(code: string): void {
        this.key(code, REPLAY_KEY_ACTIONS.next);
        if (this.runner) {
            this.events(this.runner.next(this.now()));
            this.afterRunner?.();
        }
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
     */
    async say(line: SpeechLine, interrupt = false): Promise<void> {
        if (!this.on) return;
        this.lastLine = line;
        this.speaking++;
        const run = this.epoch;
        try {
            await this.engine?.say(line, { interrupt });
        } finally {
            if (run === this.epoch) {
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
        this.event({ t: this.now(), kind: 'speech', key, text });
    }

    /** The host's speech queue ran empty: the speech.end marker, then what the runner does on it. */
    spoken(): void {
        if (!this.on) return;
        const t = this.now();
        this.event({ t, kind: 'speech', key: SPEECH_END_KEY, text: '' });
        if (this.runner) {
            this.events(this.runner.spoken(t));
            this.afterRunner?.();
        }
    }
}
