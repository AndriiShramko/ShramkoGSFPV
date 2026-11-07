// The replay player (docs/wip/v12-plan.md section 4.3 step 5): a recorded flight played again, with the cues the pilot heard and the pilot's own
// voice, on ONE clock, the AudioContext's.
//
//   frames   the sound package's Replayer steps the recorded 30 Hz frames in order and gives, per frame, what the engine was fed (a
//            SonicFrameInput), the lesson's own speech lines and cues (actions), and the events it re-derives. The player feeds the engine
//            with them (engine.update / cue / say), the helper's view with the craft's pose, and nothing simulates: the flight IS the track.
//   voice    voice.webm, decoded, started on the audio clock (replay-voice.ts).
//   clock    "package time T is audio time A" is taken when the replay starts, resumes or seeks; frames are due when T + (now - A) reaches
//            their time, and the voice was started for exactly that moment. A stalled page catches up at the next frame; it never moves the
//            voice against the flight.
//
// What is replayed and what is not: the lesson's own spoken lines and its cues (touch, gate, lap, checkpoint, reset, fanfare) are made
// again by the lesson runner inside the Replayer; the host's own lines (menus, "recording started", the survey) are not, because a
// recorded `speech` event holds its text but not its parameters. The pilot's voice is the microphone's track as it was recorded.
//
// While a replay runs the flight lane's mode is in playback (runtime.playback(true): live input, the lesson and the live engine feed
// stop), the flight is paused and the camera is the player's. Everything is given back by close().
import { Replayer } from '@shramko/sonic-fpv';
import type { CueEvent, FlightFrame, LessonLayers, Quat, ReplaySetup, SessionPackage, SonicFrameInput, SonicPrefs, SpeechLine, ThemeDef, Vec3 } from '@shramko/sonic-fpv';
import { voicePlan } from './replay-voice';
import type { VoiceBuffer, VoiceDeps, VoiceHandle } from './replay-voice';

/** The parts of the sound engine a replay drives. */
export interface ReplayEngine {
    update(input: SonicFrameInput): void;
    cue(e: CueEvent): void;
    say(line: SpeechLine, o?: { readonly interrupt?: boolean }): Promise<void>;
    setLayers(layers: LessonLayers): void;
    setPrefs(prefs: SonicPrefs): void;
    setTheme(theme: ThemeDef): void;
}

/** The helper's view of the craft: begin takes the camera and pauses the flight, end gives them back. */
export interface PoseSink {
    begin(): void;
    show(pos: Vec3, quat: Quat): void;
    end(): void;
}

export type ReplayPhase = 'ready' | 'playing' | 'paused' | 'ended';

export interface ReplayState {
    readonly phase: ReplayPhase;
    /** package time now, ms */
    readonly tMs: number;
    readonly durationMs: number;
    readonly voice: 'none' | 'ready' | 'failed';
    readonly frame: number;
    readonly frames: number;
    /** how far behind the audio clock the view is shown, ms */
    readonly viewLagMs: number;
}

export interface ReplayDeps {
    /** the audio clock, seconds (AudioContext.currentTime) */
    now(): number;
    engine: ReplayEngine;
    pose: PoseSink;
    /** null: no audio output at all, the replay is silent */
    voice: VoiceDeps | null;
    /** the mode's own settings, given back to the engine when the replay lets go */
    own(): { readonly prefs: SonicPrefs; readonly theme: ThemeDef };
    /** the flight lane's runtime.playback */
    playback(on: boolean): void;
    /** how late what is heard reaches the ear, ms: the view is shown that much behind the audio clock so it meets the sound (read when the replay starts, resumes or seeks, not every frame: the browser's estimate moves) */
    viewLagMs?(): number;
    onChange?(s: ReplayState): void;
    /** frames stepped in one tick at most (default 600: twenty seconds a page that was hidden has to catch up) */
    maxCatchUp?: number;
}

const SILENT: LessonLayers = { on: [], heightBandM: null, hazardVoices: 0 };

/** Index of the last frame whose time is at or before `t`, -1 when `t` is before the first. */
export function frameAtOrBefore(frames: readonly FlightFrame[], t: number): number {
    let lo = 0;
    let hi = frames.length - 1;
    let found = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if ((frames[mid] as FlightFrame).t <= t) {
            found = mid;
            lo = mid + 1;
        } else hi = mid - 1;
    }
    return found;
}

/** The craft's pose at package time `t`, between two frames: the position straight, the attitude by normalised linear blending. */
export function poseAt(frames: readonly FlightFrame[], t: number): { readonly pos: Vec3; readonly quat: Quat } | null {
    const n = frames.length;
    if (n === 0) return null;
    const k = frameAtOrBefore(frames, t);
    const a = frames[Math.max(k, 0)] as FlightFrame;
    if (k < 0 || k >= n - 1) return { pos: a.p, quat: a.q };
    const b = frames[k + 1] as FlightFrame;
    const span = b.t - a.t;
    const u = span > 0 ? Math.min(1, Math.max(0, (t - a.t) / span)) : 0;
    const pos: Vec3 = [a.p[0] + (b.p[0] - a.p[0]) * u, a.p[1] + (b.p[1] - a.p[1]) * u, a.p[2] + (b.p[2] - a.p[2]) * u];
    // q and -q are the same attitude: take the nearer one
    const dot = a.q[0] * b.q[0] + a.q[1] * b.q[1] + a.q[2] * b.q[2] + a.q[3] * b.q[3];
    const s = dot < 0 ? -1 : 1;
    const x: [number, number, number, number] = [a.q[0] + (s * b.q[0] - a.q[0]) * u, a.q[1] + (s * b.q[1] - a.q[1]) * u, a.q[2] + (s * b.q[2] - a.q[2]) * u, a.q[3] + (s * b.q[3] - a.q[3]) * u];
    const len = Math.hypot(...x) || 1;
    return { pos, quat: [x[0] / len, x[1] / len, x[2] / len, x[3] / len] };
}

export class ReplayPlayer {
    private readonly deps: ReplayDeps;
    private readonly frames: readonly FlightFrame[];
    private readonly setup: ReplaySetup;
    private readonly replayer: Replayer;
    private readonly voiceBytes: Uint8Array | null;
    private readonly voiceOffsetMs: number;
    private voice: VoiceBuffer | null = null;
    private voiceState: ReplayState['voice'] = 'none';
    private handle: VoiceHandle | null = null;
    private phase: ReplayPhase = 'ready';
    private durationValue: number;
    private tRef = 0;
    private acRef = 0;
    private tHeld = 0;
    private entered = false;
    private lastStepped = 0;
    private lagMs = 0;
    private shownT = NaN;
    private tickT = NaN;

    constructor(deps: ReplayDeps, pkg: SessionPackage, setup: ReplaySetup) {
        this.deps = deps;
        this.frames = pkg.frames;
        this.setup = setup;
        this.replayer = new Replayer({ setup, frames: pkg.frames, events: pkg.events });
        this.voiceBytes = pkg.voice;
        this.voiceOffsetMs = pkg.manifest.clock.voiceOffsetMs ?? 0;
        this.durationValue = (pkg.frames.at(-1) as FlightFrame).t;
    }

    /** Decodes the voice, if there is one. A voice that cannot be decoded is reported in the state and the flight still replays. */
    async prepare(): Promise<void> {
        if (this.voiceBytes === null || this.voiceBytes.length === 0 || this.deps.voice === null) {
            this.voiceState = 'none';
            return;
        }
        try {
            this.voice = await this.deps.voice.decode(this.voiceBytes);
            this.voiceState = 'ready';
            this.durationValue = Math.max(this.durationValue, this.voiceOffsetMs + this.voice.duration * 1000);
        } catch {
            this.voice = null;
            this.voiceState = 'failed';
        }
        this.changed();
    }

    get state(): ReplayState {
        return { phase: this.phase, tMs: this.currentT(), durationMs: this.durationValue, voice: this.voiceState, frame: this.replayer.position, frames: this.frames.length, viewLagMs: this.lagMs };
    }

    get notes(): ReplaySetup['notes'] {
        return this.setup.notes;
    }

    get layers(): LessonLayers {
        return this.replayer.cuePlanner.layers;
    }

    /** Package time now, ms: ticks along the audio clock while playing, where it stopped otherwise. */
    currentT(): number {
        return this.phase === 'playing' ? Math.min(this.durationValue, this.tRef + (this.deps.now() - this.acRef) * 1000) : this.tHeld;
    }

    private changed(): void {
        this.deps.onChange?.(this.state);
    }

    private enter(): void {
        if (this.entered) return;
        this.entered = true;
        this.deps.playback(true);
        this.deps.pose.begin();
        // the engine sounds as it did for the pilot: his settings and theme, the lesson's layers
        this.deps.engine.setPrefs(this.setup.prefs);
        this.deps.engine.setTheme(this.setup.theme);
    }

    private silence(): void {
        this.deps.engine.setLayers(SILENT);
    }

    private stopVoice(): void {
        this.handle?.stop();
        this.handle = null;
    }

    /** Takes the reference "package time `tMs` is now on the audio clock" and starts the voice for exactly that moment. */
    private anchor(tMs: number): void {
        this.tRef = tMs;
        this.acRef = this.deps.now();
        this.lagMs = Math.max(0, Math.min(150, this.deps.viewLagMs?.() ?? 0));
        this.stopVoice();
        if (this.voice !== null && this.deps.voice !== null) {
            const plan = voicePlan(this.voiceOffsetMs, tMs, this.voice.duration);
            if (plan.audible) this.handle = this.deps.voice.play(this.voice, this.acRef + plan.atS, plan.offsetS);
        }
    }

    play(): void {
        if (this.phase === 'playing') return;
        if (this.phase === 'ended') this.seekTo(0);
        this.enter();
        this.deps.engine.setLayers(this.layers);
        this.anchor(this.tHeld);
        this.phase = 'playing';
        this.showPose(this.tHeld);
        this.changed();
    }

    pause(): void {
        if (this.phase !== 'playing') return;
        this.tHeld = this.currentT();
        this.phase = 'paused';
        this.stopVoice();
        this.silence();
        this.changed();
    }

    /** Moves to package time `ms` (the replay core re-plays from the start when that is behind it). Keeps playing if it was playing. */
    seek(ms: number): void {
        const was = this.phase === 'playing';
        this.seekTo(ms);
        if (was) {
            this.anchor(this.tHeld);
        } else if (this.entered && this.phase !== 'ended') {
            this.phase = 'paused';
        }
        this.showPose(this.tHeld);
        this.changed();
    }

    private seekTo(ms: number): void {
        const t = Math.min(Math.max(0, ms), this.durationValue);
        const k = frameAtOrBefore(this.frames, t);
        let last = null;
        if (k < 0) this.replayer.reset();
        else last = this.replayer.seek(k);
        if (last !== null && this.entered) this.deps.engine.update(last.input);
        this.tHeld = t;
        this.tRef = t;
        this.acRef = this.deps.now();
        if (this.phase === 'ended') this.phase = 'paused';
    }

    private showPose(t: number): void {
        if (!this.entered) return;
        const p = poseAt(this.frames, t - this.lagMs);
        this.shownT = t - this.lagMs;
        if (p !== null) this.deps.pose.show(p.pos, p.quat);
    }

    /** Once per displayed frame: the frames now due are stepped and fed to the engine, the view shows the pose, the end is noticed. */
    tick(): void {
        if (this.phase !== 'playing') return;
        const t = this.currentT();
        this.tickT = t;
        const due: ReturnType<Replayer['step']>[] = [];
        const cap = this.deps.maxCatchUp ?? 600;
        while (due.length < cap && !this.replayer.done && (this.frames[this.replayer.position] as FlightFrame).t <= t) due.push(this.replayer.step());
        // a page that stalled catches up: the engine hears the last frame, and a line or a cue from long ago is not played in a burst
        const burst = due.length > 3;
        due.forEach((s, i) => {
            if (s === null) return;
            this.lastStepped = s.frame.t;
            if (!burst || i === due.length - 1) this.deps.engine.update(s.input);
            if (burst && s.frame.t < t - 500) return;
            for (const a of s.actions) {
                if (a.kind === 'say') void this.deps.engine.say(a.line, { interrupt: a.interrupt }).catch(() => undefined);
                else if (a.kind === 'cue') this.deps.engine.cue(a.event);
            }
        });
        this.showPose(t);
        if (t >= this.durationValue && this.replayer.done) {
            this.tHeld = this.durationValue;
            this.phase = 'ended';
            this.stopVoice();
            this.silence();
            this.changed();
        }
    }

    /** Lets go of everything the replay took: the voice, the engine's settings, the camera, the flight. */
    close(): void {
        this.stopVoice();
        if (this.entered) {
            this.silence();
            const own = this.deps.own();
            this.deps.engine.setPrefs(own.prefs);
            this.deps.engine.setTheme(own.theme);
            this.deps.pose.end();
            this.deps.playback(false);
            this.entered = false;
        }
        this.phase = 'ready';
        this.tHeld = 0;
        this.replayer.reset();
        this.changed();
    }

    /** Package time of the frame last stepped (for tests and the evidence run). */
    get steppedT(): number {
        return this.lastStepped;
    }

    /** The package time the last tick ran at (the clock read once for the whole tick): the frames due then were fed in it. For tests and the evidence run. */
    get lastTickT(): number {
        return this.tickT;
    }

    /** The package time of the pose last given to the camera (the clock read once per tick, the view's lag taken off): for tests and the evidence run. */
    get lastShownT(): number {
        return this.shownT;
    }

    /** The reference of the clock: package time `tMs` was audio time `acS` when the replay last started, resumed or sought. */
    get reference(): { readonly acS: number; readonly tMs: number } {
        return { acS: this.acRef, tMs: this.tRef };
    }
}
