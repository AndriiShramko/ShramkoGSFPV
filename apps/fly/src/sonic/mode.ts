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
//   N              the next step of the lesson (the 'key' event, runner.next); never a scene switch in the mode.
//   [ ]            locked: a lesson's distances are metres of its world (a note says so).
import type { PrefsStore } from '@gsfpv/prefs';
import type { Checkpoint, FlightSample, LessonDef, LessonSession, Pose, SonicFrameInput, SonicWorld } from '@shramko/sonic-fpv';
import type { FlightSession } from '../session';
import type { ActionHandler } from '../app/keys';
import type { AppEvents, Bus } from '../app/context';
import { SonicBridge, touchMaterial } from './bridge';
import type { BridgeEngine } from './bridge';

/** R held this long is the long press (back to the lesson's start), ms. */
export const LONG_PRESS_MS = 700;

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
            h.onKey('scene.next', () => this.next('KeyN')),
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
        e.update(input ?? { sample, world: this.bridge.world, target: this.bridge.runner?.target() ?? null, floorY: this.floorY });
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

    /**
     * The craft goes to `pose` by the respawn path: the session's spawn moves there and R's respawn takes it at the
     * next tick, a logged 'manual-start' respawn (the flight log replays it exactly).
     */
    place(pose: Pose): void {
        const s = this.host.session();
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
