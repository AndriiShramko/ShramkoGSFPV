// Fly by Sound's mode in the flight page (v0.12, docs/wip/v12-plan.md 1, 2.4, 2.6 and 4.2 step 5; spec sections 1.7
// and 5): what changes while the mode runs, and how the pilot's resets work. The feature app/builtin/sonic-flight.ts
// installs one per page; the entry (step 8) and the lessons (step 9) call enter() and leave().
//
//   while entered  the prefs' session layer holds crash.enabled false (a touch is a soft bump: sim-core 'contact',
//                  no crash view, no automatic respawn) and input.play easy (the keyboard and the touch sticks fly
//                  the game scheme, whose keys the lesson pilot reads as intents); the lesson's assists go to the
//                  input (InputHost.setLesson: the lesson pilot for every source); the bridge runs (samples and
//                  events on the page's bus); the keys below are the mode's. leave() gives every one of them back.
//   touches        every touched sample counts (touches), pings through the engine when there is one (step 7), and
//                  re-centres the craft at the last checkpoint when the lesson says 'bump-recentre' and no lesson
//                  runner does it (a runner asks for the place itself, through its actions).
//   R              a short press: back to the last checkpoint reached (none: the start); held LONG_PRESS_MS: back
//                  to the lesson's start. Both are the 'key' event the replay reads, the runner's reset when there
//                  is one, then place(): the session's spawn moves to the pose and respawnStart() makes it a logged
//                  'manual-start' respawn, exact in a replay of the flight log (the time-based rewind Y is not used).
//   N              the next step of the lesson (the 'key' event, runner.next), once per press; never a scene switch in the mode:
//                  Shift+N (Shift is the descent key, so it is easily held with N) is the same step, Shift+F a note.
//   B, Z           (v0.13, W5, M41-6) B the step before (runner.previous), Z the step's whole task again with its sounds
//                  (runner.repeat), each the 'key' event first, once per press. While a lesson runs the mode's keys win over
//                  the page's actions on the same keys: B is the feedback form's key (feedback.open) everywhere else, and
//                  the form stays in the pause menu; N is the scene rotation's.
//   [ ]            locked: a lesson's distances are metres of its world (a note says so).
//   scan lessons   the prefs' session layer also holds the lesson's scene size and the walls on (scan-lesson.ts), taken off
//                  again by leave(); the keys [ ] above are why the size cannot move meanwhile.
import type { PrefsStore } from '@gsfpv/prefs';
import type { Checkpoint, FlightSample, LessonDef, LessonSession, Pose, SonicFrameInput, SonicWorld } from '@shramko/sonic-fpv';
import type { FlightSession } from '../session';
import type { ActionHandler } from '../app/keys';
import type { AppEvents, Bus } from '../app/context';
import { SonicBridge, touchMaterial } from './bridge';
import type { BridgeEngine } from './bridge';
import { clearScanPrefs, forceScanPrefs } from './scan-lesson';

/** R held this long is the long press (back to the lesson's start), ms. */
export const LONG_PRESS_MS = 700;
/** The frames whose engine cost is kept for hearCost. */
export const COST_KEEP = 3000;

/** The prefs the mode holds in the session layer while it runs, and their values. */
// (input.howToFly off: the card that shows the keys by itself on a first visit is a sight-first dialog in the page's live
// region; a lesson speaks its own keys, and K still opens the card by hand)
export const MODE_PREFS: Readonly<Record<string, unknown>> = Object.freeze({ 'crash.enabled': false, 'input.play': 'easy', 'input.howToFly': false });

/** What the mode needs of the page (FlightContext's parts; fakes in tests). */
export interface ModeHost {
    readonly events: Bus<AppEvents>;
    readonly prefs: Pick<PrefsStore, 'setSession' | 'clearSession'>;
    session(): FlightSession;
    /** InputHost.setLesson: the lesson pilot for every source, or none */
    setLesson(assists: LessonDef['assists'] | null): void;
    /** KeyRouter.on: the last handler registered for an action runs; the returned function gives it back */
    onKey(action: string, run: ActionHandler): () => void;
    /** a short note on the screen (the HUD's flash) */
    note(key: string): void;
}

/** What enter() takes: the lesson (null: free flight in the mode), its runner and the world sound reads. */
export interface ModeStart {
    readonly lesson?: LessonDef | null;
    readonly runner?: LessonSession | null;
    readonly world?: SonicWorld | null;
    /** world y of the floor: the height layer's zero (default 0) */
    readonly floorY?: number;
}

export class SonicMode {
    readonly bridge: SonicBridge;
    /** touches since enter() */
    touches = 0;
    lesson: LessonDef | null = null;
    /** world y of the floor the engine hears the height from */
    floorY = 0;
    private readonly host: ModeHost;
    private on = false;
    /** the recorder's replay drives the view and the engine (SonicRuntime.playback): live frames are not heard */
    private playing = false;
    private offs: (() => void)[] = [];
    /** the engine's frame costs, a ring (hearCost) */
    private readonly cost = new Float64Array(COST_KEEP);
    private costN = 0;
    /** the last checkpoint reached, when no runner keeps it */
    private checkpoint: Checkpoint | null = null;
    private pressAt: number | null = null;
    private longDone = false;
    /** placed by the mode itself since the last sample (a re-centre): the next touch is not this one's echo */
    private placedAt = -Infinity;

    constructor(host: ModeHost) {
        this.host = host;
        this.bridge = new SonicBridge({ sample: (s) => host.events.emit('sonicSample', s), event: (e) => host.events.emit('sonicEvent', e) });
    }

    get active(): boolean {
        return this.on;
    }

    /** The engine the mode sounds through (step 7), or null. */
    set engine(e: BridgeEngine | null) {
        this.bridge.engine = e;
    }

    get engine(): BridgeEngine | null {
        return this.bridge.engine;
    }

    /** The mode starts (or starts again with another lesson). */
    enter(o: ModeStart = {}): void {
        if (this.on) this.leave();
        this.on = true;
        const h = this.host;
        for (const [id, v] of Object.entries(MODE_PREFS)) h.prefs.setSession(id, v);
        // a scan lesson flies its scan at the lesson's size, walls on (the session was made with them: the entry and the
        // lesson host set them before the scan loaded; this keeps them while the mode runs)
        if (o.lesson) forceScanPrefs(h.prefs, o.lesson.world);
        this.lesson = o.lesson ?? null;
        this.touches = 0;
        this.checkpoint = null;
        this.pressAt = null;
        this.playing = false;
        this.floorY = o.floorY ?? 0;
        h.setLesson(this.lesson ? this.lesson.assists : null);
        const b = this.bridge;
        b.world = o.world ?? null;
        b.layers = this.lesson ? this.lesson.layers : null;
        b.start(h.session());
        if (o.runner) b.begin(o.runner);
        else b.runner = null;
        this.offs = [
            h.onKey('respawn.start', (e, source) => this.pressR(source === 'key' ? e.repeat : false, source)),
            // N: one next step per press, whatever its auto-repeat does (in the ears lessons every call skips a line, a scene
            // or a question, so a held N would run through the whole lesson)
            h.onKey('scene.next', (e) => {
                if (!e.repeat) this.next('KeyN');
            }),
            // Shift is the game scheme's descent key: a pilot who holds it and presses N sends the chord Shift+N, which the
            // scene rotation reads as "a random scene", and Shift+F as "the next favourite". Neither may take the pilot out
            // of the lesson (N's own rule): Shift+N is the next step that was meant, Shift+F is a note
            h.onKey('scene.random', (e) => {
                if (!e.repeat) this.next('KeyN');
            }),
            h.onKey('scene.favourite', (e) => {
                if (!e.repeat) h.note('sonic.sceneLocked');
            }),
            // B: the step before (in a lesson the feedback form's key is the lesson's; the pause menu still has the form)
            h.onKey('feedback.open', (e) => {
                if (!e.repeat) this.previous('KeyB');
            }),
            // Z: the task of the step again, with its sounds (the runner's repeat, not the last line)
            h.onKey('sonic.repeat', (e) => {
                if (!e.repeat) this.repeat('KeyZ');
            }),
            h.onKey('scale.down', () => h.note('sonic.scaleLocked')),
            h.onKey('scale.up', () => h.note('sonic.scaleLocked'))
        ];
    }

    /** The mode stops: every key, pref and assist back as it was, the bridge stopped (the engine silent). */
    leave(): void {
        if (!this.on) return;
        this.on = false;
        for (const off of this.offs) off();
        this.offs = [];
        const h = this.host;
        for (const id of Object.keys(MODE_PREFS)) h.prefs.clearSession(id);
        clearScanPrefs(h.prefs);
        h.setLesson(null);
        this.bridge.stop();
        this.lesson = null;
        this.pressAt = null;
    }

    /** True while a replay drives the engine (playback(true)). */
    get inPlayback(): boolean {
        return this.playing;
    }

    /** The replay takes the engine (true) or gives it back (false); live input and the lesson are the caller's to stop. */
    playback(on: boolean): void {
        this.playing = on;
        this.bridge.playback(on);
    }

    /**
     * The engine hears this frame: `input` (a lesson's own, a module-0 scene's demo frame) or, by default, the flight
     * in its world with the runner's target. Nothing in playback or without an engine.
     */
    hear(sample: FlightSample, input?: SonicFrameInput | null): void {
        const e = this.bridge.engine;
        if (!this.on || this.playing || !e?.update) return;
        const t0 = performance.now();
        e.update(input ?? { sample, world: this.bridge.world, target: this.bridge.runner?.target() ?? null, floorY: this.floorY });
        this.cost[this.costN++ % COST_KEEP] = performance.now() - t0;
    }

    /**
     * What the engine's frame cost in this page (ms, the last COST_KEEP frames since the page began): the scene sampler's rays and
     * the cue planner, on the main thread, for the plan's budget of 1 ms p95 (v12-plan.md 2.4). Measured here, not in Node.
     */
    hearCost(): { readonly n: number; readonly p50: number; readonly p95: number; readonly p99: number; readonly max: number } {
        const n = Math.min(this.costN, COST_KEEP);
        if (n === 0) return { n: 0, p50: 0, p95: 0, p99: 0, max: 0 };
        const sorted = Array.from(this.cost.subarray(0, n)).sort((a, b) => a - b);
        const q = (p: number): number => Math.round((sorted[Math.min(n - 1, Math.floor(p * (n - 1)))] as number) * 1000) / 1000;
        return { n: this.costN, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: Math.round((sorted[n - 1] as number) * 1000) / 1000 };
    }

    /** A new scene session or a new flight model: the bridge's tick hook follows it. */
    follow(session: FlightSession): void {
        this.bridge.follow(session);
    }

    // ------------------------------------------------------------------ R: short and long

    /** R went down (a key's auto-repeat is not a new press; a radio switch's action has no release: a short press). */
    pressR(repeat: boolean, source: 'key' | 'switch' = 'key'): void {
        if (!this.on || repeat) return;
        if (source === 'switch') {
            this.resetTo('checkpoint', 'KeyR');
            return;
        }
        this.pressAt = this.host.session().paused ? null : performance.now();
        this.longDone = false;
        if (this.pressAt === null) this.resetTo('checkpoint', 'KeyR');
    }

    /**
     * The window lost focus or the tab was hidden while R was down: the browser sends no keyup to the page, so the press would
     * stay "held", and the frame clock going on would make it the long press (back to the lesson's start) 0.7 s later, or at
     * once when the pilot comes back. The held R is dropped (the keyboard source forgets its held keys on blur the same way).
     */
    cancelR(): void {
        this.pressAt = null;
    }

    /** R came up: a short press is the checkpoint (a long one has already gone to the start). */
    releaseR(): void {
        if (this.pressAt === null) return;
        this.pressAt = null;
        if (!this.longDone) this.resetTo('checkpoint', 'KeyR');
    }

    /** Once per frame: R held long enough is the long press, at once (the pilot hears it while still holding). */
    private pollR(now: number): void {
        if (this.pressAt === null || this.longDone || now - this.pressAt < LONG_PRESS_MS) return;
        this.longDone = true;
        this.resetTo('start', 'KeyR');
    }

    /** Back to the last checkpoint (none: the start) or to the lesson's start: the key event, the runner's reset, the craft placed. */
    resetTo(to: 'checkpoint' | 'start', code: string): void {
        if (!this.on) return;
        const r = this.bridge.resetTo(to, code);
        const pose = r ? r.pose : this.ownPose(to);
        if (pose) this.place(pose);
    }

    /** Where a reset goes when no runner says: the last checkpoint reached, else the lesson's start, else the spawn as it is. */
    private ownPose(to: 'checkpoint' | 'start'): Pose | null {
        if (to === 'checkpoint' && this.checkpoint) return this.checkpoint.pose;
        return this.lesson ? this.lesson.start : null;
    }

    /** N: the next step of the lesson. */
    next(code: string): void {
        if (!this.on) return;
        this.bridge.next(code);
    }

    /** B: the step before (from the first, the lesson before). */
    previous(code: string): void {
        if (!this.on) return;
        this.bridge.previous(code);
    }

    /** Z: the step's whole task again. */
    repeat(code: string): void {
        if (!this.on) return;
        this.bridge.repeatTask(code);
    }

    /** The lesson menu's Next lesson. */
    nextLesson(code: string): void {
        if (!this.on) return;
        this.bridge.nextLesson(code);
    }

    /** The lesson menu's Previous lesson. */
    previousLesson(code: string): void {
        if (!this.on) return;
        this.bridge.previousLesson(code);
    }

    /**
     * The craft goes to `pose` by the respawn path: the session's spawn moves there and R's respawn takes it at the
     * next tick, a logged 'manual-start' respawn (the flight log replays it exactly).
     */
    place(pose: Pose): void {
        const s = this.host.session();
        // a scene is being swapped (the session is gone): nobody to place, and a key pressed meanwhile must not throw
        if (s.disposed) return;
        s.spawn = [pose.pos[0], pose.pos[1], pose.pos[2], pose.yawDeg];
        s.respawnStart();
        this.placedAt = performance.now();
    }

    // ------------------------------------------------------------------ frames

    /** Once per rendered frame: the sample (sent out by the bridge), R's long press, the touches. */
    frame(now: number): FlightSample | null {
        if (!this.on) return null;
        this.pollR(now);
        const sample = this.bridge.frame();
        if (!sample) return null;
        if (!this.bridge.runner) this.track(sample);
        if (sample.touched) this.touched(sample);
        return sample;
    }

    /** The checkpoints reached, when no runner keeps them (the runner's rule: within radiusM of `at`). */
    private track(s: FlightSample): void {
        for (const cp of this.lesson?.checkpoints ?? []) {
            if (cp === this.checkpoint) continue;
            const d = Math.hypot(s.pos[0] - cp.at[0], s.pos[1] - cp.at[1], s.pos[2] - cp.at[2]);
            if (d <= cp.radiusM) this.checkpoint = cp;
        }
    }

    private touched(s: FlightSample): void {
        this.touches++;
        const material = touchMaterial(this.bridge.world, s.pos);
        const speed = Math.hypot(s.vel[0], s.vel[1], s.vel[2]);
        this.bridge.engine?.cue({ kind: 'touch', material, dir: null, speed });
        // a runner asks for the re-centre itself (a 'place' action); without one the mode does it
        if (!this.bridge.runner && this.lesson?.assists.onTouch === 'bump-recentre' && performance.now() - this.placedAt > 500) {
            const pose = this.ownPose('checkpoint');
            if (pose) this.place(pose);
        }
    }
}
