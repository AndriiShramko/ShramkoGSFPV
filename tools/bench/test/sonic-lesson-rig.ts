// A rig for the Node tests of the lesson host (v0.12 lane v12-flight step 9): the page around a lesson, with the real parts
// where the plan says "real" and a fake only for what a browser has. REAL: the flight model and its runner (FlightSession on
// a lesson's built-in world, a renderer that draws nothing), the lesson pilot every source flies through, the mode
// (SonicMode), the bridge, the lesson host, the sound package's lesson runner, the prefs store, the world swap of a lesson
// with other walls. FAKE: the engine (it records layers, cues and frames, and "speaks" a line in the time the package
// estimates for it, in the page's virtual clock, one line after the other like speechSynthesis) and the drawing of the
// helper's view (a recorder). Time is virtual: the rig steps the model at 1 kHz and a frame every 16 ms and moves the
// page clock (performance.now) itself, so a lesson of minutes runs in seconds. Not a test file (the name has no .test).
import { vi } from 'vitest';
import { MODE_CHANNEL, S, attitude } from '../../../packages/sim-core/src';
import { CuePlanner, createTranslator, defaultPrefs, getBuiltinTheme, nextLesson } from '../../../packages/sonic-fpv/src';
import type { ActiveCue, CueEvent, FlightSample, LessonDef, LessonLayers, Locale, SessionEvent, SonicFrameInput, SonicWorld, SpeechLine, Translator, Vec3 } from '../../../packages/sonic-fpv/src';
import { estimateSpeechS } from '../../../packages/sonic-fpv/src/audio/speech';
import { FlightSession } from '../../../apps/fly/src/session';
import type { SessionOptions } from '../../../apps/fly/src/session';
import { Bus } from '../../../apps/fly/src/app/context';
import type { AppEvents } from '../../../apps/fly/src/app/context';
import type { ActionHandler } from '../../../apps/fly/src/app/keys';
import { LessonPilot, rayClearance } from '../../../apps/fly/src/play/lesson-pilot';
import { LessonHost } from '../../../apps/fly/src/sonic/lessons';
import { engineDicts } from '../../../apps/fly/src/sonic/host-lines';
import type { LessonPage } from '../../../apps/fly/src/sonic/lessons';
import { buildScanLesson } from '../../../apps/fly/src/sonic/scan-lesson';
import { SonicMode } from '../../../apps/fly/src/sonic/mode';
import { lessonFlightWorld } from '../../../apps/fly/src/sonic/lesson-world';
import type { LessonWorld } from '../../../apps/fly/src/sonic/lesson-world';
import type { Prim } from '../../../apps/fly/src/sonic/primitives';
import { DEFAULT_LESSON_START_KEYS, DEFAULT_RUNNER_KEYS } from '../../../apps/fly/src/sonic/key-names';
import type { LessonStartKeys, RunnerKeys } from '../../../apps/fly/src/sonic/key-names';
import { mkStore } from '../../../packages/prefs/test/helpers';
import { VoxelContactWorld } from '../../../packages/collision/src';
import type { VoxelCollision } from '../../../packages/collision/src';
import type { TrackFile } from '../../../packages/sonic-fpv/src';

/** A renderer that draws nothing (as wind-session.test.ts). */
export function nullRenderer(): NonNullable<SessionOptions['renderer']> {
    const app = { on() { /* no frames */ }, off() { /* no frames */ } };
    return new Proxy({}, { get: (_t, k) => (k === 'app' ? app : k === 'then' ? undefined : () => undefined) }) as NonNullable<SessionOptions['renderer']>;
}

/**
 * The engine as the mode and the host drive it, recording. It holds the package's own CuePlanner and uses it as the real
 * engine does (update plans a frame, cue adds a one-off, setLayers switches layers), so the cues it reports are the ones a
 * recording would carry. A line "ends" when its time has passed in the page's clock.
 */
export class FakeEngine {
    readonly planner = new CuePlanner({ theme: getBuiltinTheme('soft'), prefs: defaultPrefs() });
    private cues_: readonly ActiveCue[] = [];
    layers: LessonLayers[] = [];
    cues: CueEvent[] = [];
    said: { line: SpeechLine; interrupt: boolean; text: string; at: number }[] = [];
    frames = 0;
    lastInput: SonicFrameInput | null = null;
    inputs: SonicFrameInput[] = [];
    onSpeech: ((line: SpeechLine, text: string) => void) | null = null;
    private queue: { endsAt: number; resolve: () => void; key: string; start: number }[] = [];
    private lastEnd = 0;
    /**
     * true: as the real engine with "my screen reader speaks" (selfVoice off): it says nothing and each line waits its own time
     * from when it is handed over, all at once, no queue, an interrupt cuts nothing (v12-int step 6). false: speechSynthesis's queue.
     */
    parallel = false;
    private readonly tr: Translator;

    constructor(private readonly clock: { t: number }, locale: Locale = 'en') {
        // the real engine's dictionaries: the package's and the page's own spoken lines (host-lines.ts; v0.13 stage B says more of them)
        this.tr = createTranslator(locale, engineDicts());
    }

    setLayers(l: LessonLayers): void {
        this.layers.push(l);
        this.planner.setLayers(l);
    }

    cue(e: CueEvent): void {
        this.cues.push(e);
        this.planner.cue(e, this.lastInput?.sample.t ?? 0);
    }

    update(i: SonicFrameInput): void {
        this.frames++;
        this.lastInput = i;
        if (this.inputs.length < 5000) this.inputs.push(i);
        this.cues_ = this.planner.plan(i).cues;
    }

    /** reset() calls so far (the lesson host's at every lesson it opens, v13-int step 1) */
    resets = 0;
    /** the control of v13-int step 1: reset() forgets nothing, as an engine made before the package's reset (s13-int) */
    keepOnReset = false;

    /** As the package's FlyBySoundEngine.reset(): the planner from nothing, the last frame and its cues forgotten (a cue before the next frame is stamped at 0). */
    reset(): void {
        this.resets++;
        if (this.keepOnReset) return;
        this.planner.reset();
        this.cues_ = [];
        this.lastInput = null;
    }

    /** The cues sounding in the last frame. */
    activeCues(): readonly ActiveCue[] {
        return this.cues_;
    }

    /**
     * How each line ended (v13-int review F1): said to its end, or cut by an interrupting line (speechSynthesis.cancel()) at `at`; `start`
     * is when the voice began it (a cut line queued behind others never began: its start lies after its cut).
     */
    ends: { key: string; start: number; at: number; cut: boolean }[] = [];
    /**
     * As Chrome's speechSynthesis (seen in sonic-v13-page R, v13-int review F1): a line cancelled before it began reports nothing, and the
     * package's speech resolves its promise only at its safety timeout. null: every cancelled line resolves at once (the rig's default).
     */
    lateCancelMs: number | null = null;

    say(line: SpeechLine, o?: { interrupt?: boolean }): Promise<void> {
        const text = this.tr.text(line);
        const interrupt = o?.interrupt === true;
        this.said.push({ line, interrupt, text, at: this.clock.t });
        this.onSpeech?.(line, text);
        if (this.parallel) return new Promise<void>((resolve) => this.queue.push({ endsAt: this.clock.t + estimateSpeechS(text, 1) * 1000, resolve, key: line.key, start: this.clock.t }));
        // speechSynthesis.cancel() ends what is queued at once (a line that had not begun, with lateCancelMs, reports it that much later)
        if (interrupt) {
            for (const q of this.queue) {
                this.ends.push({ key: q.key, start: q.start, at: this.clock.t, cut: true });
                if (this.lateCancelMs !== null && q.start > this.clock.t) void this.wait(this.lateCancelMs).then(q.resolve);
                else q.resolve();
            }
            this.queue = [];
            this.lastEnd = this.clock.t;
        }
        const start = Math.max(this.clock.t, this.lastEnd);
        const endsAt = start + estimateSpeechS(text, 1) * 1000;
        this.lastEnd = endsAt;
        return new Promise<void>((resolve) => this.queue.push({ endsAt, resolve, key: line.key, start }));
    }

    /** Resolves when `ms` of the page's clock have passed (at the frame that reaches it, as a line's end). */
    wait(ms: number): Promise<void> {
        return new Promise<void>((resolve) => this.waits.push({ endsAt: this.clock.t + ms, resolve }));
    }

    private waits: { endsAt: number; resolve: () => void }[] = [];

    /** Lines whose time has passed end now. */
    tick(): void {
        const now0 = this.clock.t;
        const doneWaits = this.waits.filter((w) => w.endsAt <= now0);
        if (doneWaits.length > 0) {
            this.waits = this.waits.filter((w) => w.endsAt > now0);
            for (const w of doneWaits) w.resolve();
        }
        const now = this.clock.t;
        const due = this.queue.filter((q) => q.endsAt <= now);
        if (due.length === 0) return;
        this.queue = this.queue.filter((q) => q.endsAt > now);
        for (const q of due) {
            this.ends.push({ key: q.key, start: q.start, at: q.endsAt, cut: false });
            q.resolve();
        }
    }

    get speaking(): boolean {
        return this.queue.length > 0;
    }

    /**
     * The direction of the last sound a step played (module 0 plays one before each question): a 'repeat-cue' since v0.13 (a
     * named sound is played three times, M41-5), a 'preview' before.
     */
    lastPreviewDir(): Vec3 | null {
        for (let i = this.cues.length - 1; i >= 0; i--) {
            const c = this.cues[i]!;
            if (c.kind === 'preview') return c.dir;
            if (c.kind === 'repeat-cue') return c.dir ?? null;
        }
        return null;
    }
}

/**
 * A scan for the rig to fly (module 7): the walls as the flight flies them (a scan's octree under its scene size), the track,
 * and where the craft waits. The session is a built-in world over those walls (the only way to fly given walls without the
 * network), so the page's scene switch is not run: the scan is "already flown", as when the page was entered on the lesson.
 */
export interface RigScan {
    readonly sceneId: string;
    /** the walls flown (transformCollision of the scan's grid) */
    readonly collision: VoxelCollision;
    readonly sha256: string;
    readonly track: TrackFile;
    /** T(p) = s * p + t, as the lesson forces it */
    readonly transform: readonly [number, number, number, number];
    /** where the craft is first made (flown world) */
    readonly spawn: readonly [number, number, number, number];
}

/** What a scripted pilot asks for each 10 ms: the intents (sticks) and a digit for a question. */
export interface Intent {
    forward?: number;
    strafe?: number;
    lift?: number;
    turn?: number;
    answer?: number;
}
export type Control = (r: Rig) => Intent | null;

export class Rig {
    readonly clock = { t: 0 };
    readonly events = new Bus<AppEvents>();
    readonly sonic: SessionEvent[] = [];
    readonly sessionPrefs = new Map<string, unknown>();
    readonly keys = new Map<string, ActionHandler[]>();
    store = mkStore();
    readonly engine = new FakeEngine(this.clock);
    readonly swaps: string[] = [];
    readonly shown: { count: number; ids: string[] }[] = [];
    readonly stage = {
        target: null as string | null,
        cleared: 0,
        show: (p: readonly Prim[]): void => { this.shown.push({ count: p.length, ids: [...new Set(p.flatMap((x) => (x.objectId ? [x.objectId] : [])))] }); },
        setTarget: (id: string | null): void => { this.stage.target = id; },
        clear: (): void => { this.stage.cleared++; }
    };
    menus = 0;
    /** a session swap is under way: the page's flight is held (nothing steps) until it is done */
    swapping = false;
    paths: 'full' | 'fast' = 'full';
    /** the names of the pilot's keys the page gives the runner (v0.13 W3; the page's are its keyboard layout's) */
    keyNames: RunnerKeys = DEFAULT_RUNNER_KEYS;
    /** the pilot's speaking speed the page gives the runner (SonicPrefs.speechRate) */
    speechRate = 1;
    /** called when a lesson with other walls starts being swapped in (the old lesson's runner is still the host's then) */
    onSwap: (() => void) | null = null;
    /** the names the line at every lesson's start says (v0.13 B6; the page's are its keyboard layout's) */
    lessonKeys: LessonStartKeys = DEFAULT_LESSON_START_KEYS;
    pilot: LessonPilot | null = null;
    session!: FlightSession;
    mode!: SonicMode;
    host!: LessonHost;
    last: FlightSample | null = null;
    private readonly out = new Float32Array(8);

    private constructor() {
        vi.spyOn(performance, 'now').mockImplementation(() => this.clock.t);
    }

    /**
     * A page on the first lesson's world (or, with `scan`, on that scan). `store`: the pilot's saved state of an earlier page
     * (progress, best times) instead of an empty one.
     */
    static async make(first: LessonDef, o: { scan?: RigScan; store?: ReturnType<typeof mkStore> } = {}): Promise<Rig> {
        const rig = new Rig();
        if (o.store) rig.store = o.store;
        const scan = o.scan ?? null;
        const lw = scan ? null : lessonFlightWorld(first);
        if (!scan && !lw) throw new Error('the rig flies built-in worlds');
        rig.session = scan ? await rig.startScan(scan) : await rig.start(lw as LessonWorld);
        rig.events.on('sonicEvent', (e) => rig.sonic.push(e));
        rig.mode = new SonicMode({
            events: rig.events,
            prefs: {
                setSession: (id: string, v: unknown) => { rig.sessionPrefs.set(id, v); return { ok: true, value: v } as never; },
                clearSession: (id?: string) => { if (id) rig.sessionPrefs.delete(id); }
            },
            session: () => rig.session,
            setLesson: (a) => {
                if (!a) { rig.pilot = null; return; }
                if (rig.pilot) rig.pilot.setAssists(a);
                else rig.pilot = new LessonPilot({ sim: () => rig.session.sim, paused: () => false, ground: (sim) => rayClearance(rig.session.collision, sim) }, a);
            },
            onKey: (action, run) => {
                const list = rig.keys.get(action) ?? [];
                list.push(run);
                rig.keys.set(action, list);
                return () => { const i = list.indexOf(run); if (i >= 0) list.splice(i, 1); };
            },
            note: () => undefined
        });
        rig.mode.engine = rig.engine as never;
        rig.engine.onSpeech = (line, text) => rig.mode.bridge.speech(line.key, text);
        const page: LessonPage = {
            mode: rig.mode,
            store: rig.store,
            locale: 'en',
            stage: rig.stage,
            onEvent: (cb) => rig.events.on('sonicEvent', cb),
            path: () => rig.paths,
            session: () => rig.session,
            swapTo: async (w) => {
                rig.swaps.push(w.builtin.scene.id);
                rig.swapping = true;
                // a test's look into the page while the next lesson's walls are being made (a key pressed meanwhile)
                rig.onSwap?.();
                try {
                    rig.session.dispose();
                    rig.session = await rig.start(w);
                    // what the feature does on the page's 'session' event
                    rig.mode.follow(rig.session);
                    rig.pilot?.resetFlight();
                } finally {
                    rig.swapping = false;
                }
            },
            scanLesson: async () =>
                scan
                    ? buildScanLesson(scan.track, {
                          sceneId: scan.sceneId,
                          sceneVersion: 1,
                          spawn: { pos: [scan.spawn[0], scan.spawn[1], scan.spawn[2]], yawDeg: scan.spawn[3] },
                          // the walls are flown already (a built-in session has the identity transform): the scene size is the scan's
                          src: { collision: () => rig.session.collision, transform: () => ({ s: scan.transform[0], t: [scan.transform[1], scan.transform[2], scan.transform[3]] }) }
                      })
                    : null,
            showMenu: () => { rig.menus++; },
            clock: () => rig.clock.t,
            keyNames: () => rig.keyNames,
            speechRate: () => rig.speechRate,
            lessonKeys: () => rig.lessonKeys
        };
        rig.host = new LessonHost(page);
        if (lw) rig.host.seed(first.id, lw);
        return rig;
    }

    private async startScan(scan: RigScan): Promise<FlightSession> {
        const scene = { id: scan.sceneId, version: 1, settings: {}, camera: null, contentUrl: '', contentKind: 'meta', content: [], collisionUrl: null, background: [0.02, 0.02, 0.03], tonemapping: undefined } as unknown as NonNullable<SessionOptions['world']>['scene'];
        const ses = await FlightSession.start({} as HTMLCanvasElement, {
            sceneId: scan.sceneId,
            world: { scene, collision: scan.collision, contact: new VoxelContactWorld(scan.collision), sha256: scan.sha256, spawn: scan.spawn },
            renderer: nullRenderer(),
            crashOn: false,
            windSeed: 5
        });
        ses.onLife = () => this.pilot?.resetFlight();
        return ses;
    }

    private async start(lw: LessonWorld): Promise<FlightSession> {
        const ses = await FlightSession.start({} as HTMLCanvasElement, { sceneId: lw.builtin.scene.id, world: lw.builtin, renderer: nullRenderer(), crashOn: false, windSeed: 5 });
        ses.onLife = () => this.pilot?.resetFlight();
        return ses;
    }

    /** What the feature's frame listener does. */
    frame(): void {
        const s = this.mode.frame(this.clock.t);
        if (!s) return;
        this.last = s;
        if (this.host.active) this.host.frame(s);
        else this.mode.hear(s);
    }

    /** A key as the router runs it: the last handler of the action. */
    press(action: string, o: { repeat?: boolean; source?: 'key' | 'switch' } = {}): boolean {
        const run = this.keys.get(action)?.at(-1);
        if (!run) return false;
        run({ repeat: o.repeat ?? false, code: '' } as KeyboardEvent, o.source ?? 'key');
        return true;
    }

    async flush(): Promise<void> {
        for (let i = 0; i < 5; i++) await Promise.resolve();
    }

    /**
     * `ms` of the page's time: the pilot's intents every 10 ms through the lesson pilot into the model, the model at 1 kHz,
     * a frame every 16 ms (the host's), the speech running on. `until` ends the run early.
     */
    async run(ms: number, control: Control | null = null, until: (() => boolean) | null = null): Promise<void> {
        for (let i = 0; i < ms; i += 2) {
            // the page's flight is held while a lesson's session is being swapped (the pause 'scene'): nothing steps meanwhile
            if (this.swapping) {
                await this.flush();
                i -= 2;
                continue;
            }
            const t = this.clock.t;
            if (t % 10 === 0 && this.pilot) {
                const k = (control ? control(this) : null) ?? {};
                if (k.answer !== undefined && this.host.asking) this.host.answer(k.answer);
                this.pilot.apply([k.strafe ?? 0, k.forward ?? 0, k.lift ?? 0, k.turn ?? 0, -1, 0, 0, 0], this.out, t);
                this.out[5] = MODE_CHANNEL.angle;
                this.session.runner.enqueue({ tUs: t * 1000, ch: Array.from(this.out) });
            }
            this.clock.t += 2;
            this.session.runner.advanceTo(this.clock.t * 1000);
            if (this.clock.t % 16 === 0) {
                this.engine.tick();
                this.frame();
                await this.flush();
                if (until && until()) return;
            }
        }
    }

    // ---------------------------------------------------------------- what a pilot sees

    get world(): SonicWorld {
        return this.host.world as SonicWorld;
    }

    get pos(): Vec3 {
        const s = this.session.sim.s;
        return [s[S.px], s[S.py], s[S.pz]];
    }

    get vel(): Vec3 {
        const s = this.session.sim.s;
        return [s[S.vx], s[S.vy], s[S.vz]];
    }

    get speed(): number {
        const v = this.vel;
        return Math.hypot(v[0], v[1], v[2]);
    }

    /** The nose, degrees (0 = -Z, positive turns right). */
    get yaw(): number {
        return attitude(this.session.sim.s).yaw;
    }

    /** The events of the mode of one kind. */
    of<K extends SessionEvent['kind']>(kind: K): Extract<SessionEvent, { kind: K }>[] {
        return this.sonic.filter((e): e is Extract<SessionEvent, { kind: K }> => e.kind === kind);
    }

    lessonEvents(what: Extract<SessionEvent, { kind: 'lesson' }>['what']): Extract<SessionEvent, { kind: 'lesson' }>[] {
        return this.of('lesson').filter((e) => e.what === what);
    }

    get passed(): boolean {
        return this.lessonEvents('passed').length > 0;
    }

    dispose(): void {
        this.session.dispose();
    }
}

export { defaultPrefs, nextLesson };
