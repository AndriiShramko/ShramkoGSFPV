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
import { CuePlanner, DICTS, createTranslator, defaultPrefs, getBuiltinTheme, nextLesson } from '../../../packages/sonic-fpv/src';
import type { ActiveCue, CueEvent, FlightSample, LessonDef, LessonLayers, Locale, SessionEvent, SonicFrameInput, SonicWorld, SpeechLine, Translator, Vec3 } from '../../../packages/sonic-fpv/src';
import { estimateSpeechS } from '../../../packages/sonic-fpv/src/audio/speech';
import { FlightSession } from '../../../apps/fly/src/session';
import type { SessionOptions } from '../../../apps/fly/src/session';
import { Bus } from '../../../apps/fly/src/app/context';
import type { AppEvents } from '../../../apps/fly/src/app/context';
import type { ActionHandler } from '../../../apps/fly/src/app/keys';
import { LessonPilot, rayClearance } from '../../../apps/fly/src/play/lesson-pilot';
import { LessonHost } from '../../../apps/fly/src/sonic/lessons';
import type { LessonPage } from '../../../apps/fly/src/sonic/lessons';
import { SonicMode } from '../../../apps/fly/src/sonic/mode';
import { lessonFlightWorld } from '../../../apps/fly/src/sonic/lesson-world';
import type { LessonWorld } from '../../../apps/fly/src/sonic/lesson-world';
import type { Prim } from '../../../apps/fly/src/sonic/primitives';
import { mkStore } from '../../../packages/prefs/test/helpers';

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
    private queue: { endsAt: number; resolve: () => void }[] = [];
    private lastEnd = 0;
    private readonly tr: Translator;

    constructor(private readonly clock: { t: number }, locale: Locale = 'en') {
        this.tr = createTranslator(locale, DICTS);
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

    /** The cues sounding in the last frame. */
    activeCues(): readonly ActiveCue[] {
        return this.cues_;
    }

    say(line: SpeechLine, o?: { interrupt?: boolean }): Promise<void> {
        const text = this.tr.text(line);
        const interrupt = o?.interrupt === true;
        this.said.push({ line, interrupt, text, at: this.clock.t });
        this.onSpeech?.(line, text);
        // speechSynthesis.cancel() ends what is queued at once
        if (interrupt) {
            for (const q of this.queue) q.resolve();
            this.queue = [];
            this.lastEnd = this.clock.t;
        }
        const start = Math.max(this.clock.t, this.lastEnd);
        const endsAt = start + estimateSpeechS(text, 1) * 1000;
        this.lastEnd = endsAt;
        return new Promise<void>((resolve) => this.queue.push({ endsAt, resolve }));
    }

    /** Lines whose time has passed end now. */
    tick(): void {
        const now = this.clock.t;
        const due = this.queue.filter((q) => q.endsAt <= now);
        if (due.length === 0) return;
        this.queue = this.queue.filter((q) => q.endsAt > now);
        for (const q of due) q.resolve();
    }

    get speaking(): boolean {
        return this.queue.length > 0;
    }

    /** The last preview cue's direction (module 0 plays one before each question). */
    lastPreviewDir(): Vec3 | null {
        for (let i = this.cues.length - 1; i >= 0; i--) {
            const c = this.cues[i]!;
            if (c.kind === 'preview') return c.dir;
        }
        return null;
    }
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
    readonly store = mkStore();
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
    pilot: LessonPilot | null = null;
    session!: FlightSession;
    mode!: SonicMode;
    host!: LessonHost;
    last: FlightSample | null = null;
    private readonly out = new Float32Array(8);

    private constructor() {
        vi.spyOn(performance, 'now').mockImplementation(() => this.clock.t);
    }

    /** A page on the first lesson's world. `speechEnds`: false makes the speech never report its end (the runner then estimates). */
    static async make(first: LessonDef): Promise<Rig> {
        const rig = new Rig();
        const lw = lessonFlightWorld(first);
        if (!lw) throw new Error('the rig flies built-in worlds');
        rig.session = await rig.start(lw);
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
            scanWorld: () => null,
            showMenu: () => { rig.menus++; },
            clock: () => rig.clock.t
        };
        rig.host = new LessonHost(page);
        rig.host.seed(first.id, lw);
        return rig;
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
