// The recorder of Fly by Sound (docs/wip/v12-plan.md section 4.3 step 2; spec section 7 of the sound package): the
// pilot's flight and voice into one session package, chunk by chunk, so a closed tab loses seconds, not the flight.
//
//   T (sonic.record)   first press: the app asks by voice (rec.ask, and rec.minor first for a minor); second press: yes.
//                      That second press calls getUserMedia in the same task (VoiceCapture.request), the browser asks for the
//                      microphone, and the recording starts when it has answered. A third press ends it.
//   frames             30 Hz FlightFrames from the bus event `sonicSample`, with the ids of the cues sounding
//   events             every `sonicEvent` as it comes (the replay's markers included), carried onto the recording clock
//   voice              MediaRecorder Opus in 1 s slices, appended to voice.webm as they arrive (VoiceCapture)
//   storage            the sound package's SessionWriter into an OPFS folder (store.ts); a flush every second
//
// One recording is one package. Nothing here talks to the flight: it listens (onSample, onEvent) and speaks (deps.say), and
// does nothing at all while no recording runs, so ordinary flight is unchanged. Everything the recorder owns can be
// replaced through RecorderDeps, which is how the Node tests drive it with fakes and the browser runs drive it for real.
import type { ChunkStore, FlightSample, GzipFn, SessionEvent, SessionManifest, SonicRuntime, SpeechLine, SurveyAnswers } from '@shramko/sonic-fpv';
import { SessionWriter, newSessionId, utf8Encode } from '@shramko/sonic-fpv';
import { SessionClock } from './clock';
import { consentFor, type PilotProfile } from './consent';
import { FrameSampler, Refusals, busEventWanted, eventProblem } from './frames';
import { buildManifestInput, type RecorderEnv } from './manifest-input';
import type { MicResult, VoiceCapture, VoiceSlice } from './voice';

export type RecorderPhase = 'idle' | 'asking' | 'starting' | 'recording' | 'closing' | 'finishing';
export type VoiceState = 'off' | 'recording' | 'denied' | 'unavailable' | 'failed';

export interface RecorderStatus {
    readonly phase: RecorderPhase;
    readonly sessionId: string | null;
    /** the recording clock, ms: how long this recording has run (0 when none) */
    readonly elapsedMs: number;
    readonly frames: number;
    readonly events: number;
    /** frames and events the package's own validators refused, so they were not written */
    readonly refused: number;
    readonly voice: VoiceState;
    readonly voiceBytes: number;
    /** the chunks go to the browser's file system (false: memory only, lost with the tab) */
    readonly durable: boolean;
    /** navigator.storage.persist() answered yes (true), no (false), or cannot say (null) */
    readonly persisted: boolean | null;
    readonly error: string | null;
    /** the last recording that finished here */
    readonly lastSessionId: string | null;
}

/** The session folders: OPFS in the page, memory in a test. */
export interface SessionStores {
    readonly durable: boolean;
    create(id: string): Promise<ChunkStore>;
    remove(id: string): Promise<void>;
}

export interface RecorderDeps {
    /** the page clock (performance.now) */
    nowMs(): number;
    /** wall clock as ISO 8601 */
    nowIso(): string;
    runtime(): SonicRuntime | null;
    /** what the page contributes to the manifest (read when a recording starts; may need a fetch, so it can be async) */
    env(): RecorderEnv | Promise<RecorderEnv>;
    stores: SessionStores;
    voice: VoiceCapture;
    /** the pilot's profile, read when a recording asks and starts */
    profile(): PilotProfile;
    /** a spoken line; never awaited here */
    say(line: SpeechLine): void;
    /** the spoken name of a key for the {key} of a line ('KeyT' -> 'T') */
    keyLabel(code: string): string;
    /** ids of the cues sounding now (default: the runtime's engine) */
    cues?(): readonly string[];
    random?: (n: number) => Uint8Array;
    /** one-member gzip for the flight log (default: the package's, CompressionStream); a test passes zlib's */
    gzip?: GzipFn;
    persist?(): Promise<boolean | null>;
    freeBytes?(): Promise<number | null>;
    holdLock?(id: string): Promise<() => void>;
    onStatus?(s: RecorderStatus): void;
    /** frames per chunk (default: the package's 90) and the longest a chunk stays open, ms of the recording clock */
    chunkFrames?: number;
    chunkMs?: number;
    /** how often the writer is flushed, ms (default 1000): what a crash can cost is about this much of flight */
    flushMs?: number;
    /** below this much free storage a recording is refused, bytes (default 50 MB) */
    minFreeBytes?: number;
    /** how long the app waits for the second press, ms (default 30 000) */
    askMs?: number;
}

export interface StopOptions {
    /**
     * Runs between the pilot's stop and the end of the package, with the voice still recording: the survey. It returns
     * the answers (written as survey.json) or null.
     */
    readonly survey?: (env: SurveyEnv) => Promise<SurveyAnswers | null>;
}

/** What a survey needs of the recording it runs inside. */
export interface SurveyEnv {
    /** the recording clock, ms */
    now(): number;
    readonly sessionId: string;
    readonly profile: PilotProfile;
}

export interface FinishedRecording {
    readonly id: string;
    readonly manifest: SessionManifest;
    readonly frames: number;
    readonly events: number;
    readonly refused: number;
}

export const DEFAULT_MIN_FREE_BYTES = 50 * 1024 * 1024;
const DEFAULT_ASK_MS = 30_000;
const DEFAULT_FLUSH_MS = 1000;
const STATUS_MS = 1000;
const T_KEY = 'KeyT';

export class Recorder {
    private phaseValue: RecorderPhase = 'idle';
    private readonly clock: SessionClock;
    private sampler = new FrameSampler();
    private refusals = new Refusals();
    private writer: SessionWriter | null = null;
    private store: ChunkStore | null = null;
    private releaseLock: (() => void) | null = null;
    private flushTimer: ReturnType<typeof setInterval> | null = null;
    private statusTimer: ReturnType<typeof setInterval> | null = null;
    private askTimer: ReturnType<typeof setTimeout> | null = null;
    private voiceState: VoiceState = 'off';
    private sessionId: string | null = null;
    private lastId: string | null = null;
    private errorText: string | null = null;
    private persisted: boolean | null = null;
    private sliceMarks = 0;
    private voiceOffsetSet = false;
    private pendingSlices: Uint8Array[] = [];
    private stopping: Promise<FinishedRecording | null> | null = null;
    private profileAtStart: PilotProfile | null = null;
    /** the folder made for a recording that has not yet written its manifest */
    private emptyId: string | null = null;
    private frameCount = 0;
    private eventCount = 0;

    constructor(private readonly deps: RecorderDeps) {
        this.clock = new SessionClock(deps.nowMs);
    }

    get phase(): RecorderPhase {
        return this.phaseValue;
    }

    /** The recording clock now, ms. */
    now(): number {
        return this.clock.now();
    }

    status(): RecorderStatus {
        return {
            phase: this.phaseValue,
            sessionId: this.sessionId,
            elapsedMs: this.phaseValue === 'idle' || this.phaseValue === 'asking' || this.phaseValue === 'starting' ? 0 : this.clock.now(),
            frames: this.frameCount,
            events: this.eventCount,
            refused: this.refusals.total + this.sampler.refused.total,
            voice: this.voiceState,
            voiceBytes: this.deps.voice.bytes,
            durable: this.deps.stores.durable,
            persisted: this.persisted,
            error: this.errorText,
            lastSessionId: this.lastId
        };
    }

    /** What was refused (frames and events the package would not take), for a report. */
    refusalReport(): { readonly total: number; readonly first: readonly string[]; readonly clockJumps: number } {
        return { total: this.refusals.total + this.sampler.refused.total, first: [...this.refusals.first, ...this.sampler.refused.first].slice(0, 5), clockJumps: this.clock.jumps };
    }

    private setPhase(p: RecorderPhase): void {
        this.phaseValue = p;
        this.emit();
    }

    private emit(): void {
        try {
            this.deps.onStatus?.(this.status());
        } catch {
            // a listener's trouble is not the recording's
        }
    }

    // ------------------------------------------------------------------ the key

    /** Key T: ask, then confirm, then stop. Call it straight from the key press (the confirm calls getUserMedia). */
    pressRecord(): void {
        switch (this.phaseValue) {
            case 'idle':
                this.ask();
                break;
            case 'asking':
                void this.confirm();
                break;
            case 'recording':
                void this.stop();
                break;
            default:
                break; // starting, closing, finishing: the press is already being answered
        }
    }

    private ask(): void {
        this.errorText = null;
        this.setPhase('asking');
        if (this.deps.profile().minor) this.deps.say({ key: 'rec.minor' });
        this.deps.say({ key: 'rec.ask', params: { key: this.deps.keyLabel(T_KEY) } });
        this.askTimer = setTimeout(() => this.cancel(), this.deps.askMs ?? DEFAULT_ASK_MS);
    }

    /** The pilot did not say yes: nothing was asked of the microphone, nothing was written. */
    cancel(): void {
        if (this.phaseValue !== 'asking') return;
        if (this.askTimer !== null) clearTimeout(this.askTimer);
        this.askTimer = null;
        this.setPhase('idle');
        this.deps.say({ key: 'rec.off' });
    }

    /**
     * The pilot said yes (the second press of T, or a helper's button). The microphone is asked for first, in this same
     * task; the recording starts when it has answered. Resolves true when it started.
     */
    async confirm(): Promise<boolean> {
        if (this.phaseValue !== 'asking') return false;
        if (this.askTimer !== null) clearTimeout(this.askTimer);
        this.askTimer = null;
        this.setPhase('starting');
        const mic = this.deps.voice.request(); // before any await: this is the user's key press
        try {
            return await this.begin(mic);
        } catch (e) {
            await this.abort(e);
            return false;
        }
    }

    // ------------------------------------------------------------------ start

    private async begin(micAsk: Promise<MicResult>): Promise<boolean> {
        const profile = this.deps.profile();
        this.profileAtStart = profile;
        const [mic, persisted, free, env] = await Promise.all([micAsk, this.deps.persist?.() ?? Promise.resolve(null), this.deps.freeBytes?.() ?? Promise.resolve(null), Promise.resolve(this.deps.env())]);
        const rt = this.deps.runtime();
        if (rt === null) {
            this.deps.voice.release();
            this.errorText = 'the sound mode is off';
            this.setPhase('idle');
            return false;
        }
        const minFree = this.deps.minFreeBytes ?? DEFAULT_MIN_FREE_BYTES;
        if (free !== null && free < minFree) {
            this.deps.voice.release();
            this.errorText = `only ${Math.floor(free / 1048576)} MB of browser storage are left, ${Math.ceil(minFree / 1048576)} MB are needed`;
            this.setPhase('idle');
            this.deps.say({ key: 'rec.off' });
            return false;
        }
        this.persisted = persisted;
        const startIso = this.deps.nowIso();
        const consent = consentFor(profile, { voice: mic === 'granted', at: startIso });
        const id = newSessionId(this.deps.random);
        const input = buildManifestInput({ runtime: rt, env, consent, profile, startIso, id });
        const store = await this.deps.stores.create(id);
        this.emptyId = id;
        this.releaseLock = (await this.deps.holdLock?.(id)) ?? null;
        this.clock.begin();
        this.sampler = new FrameSampler();
        this.refusals = new Refusals();
        this.frameCount = 0;
        this.eventCount = 0;
        this.sliceMarks = 0;
        this.voiceOffsetSet = false;
        this.pendingSlices = [];
        const writer = await SessionWriter.start({
            sink: store,
            manifest: input,
            ...(this.deps.random === undefined ? {} : { random: this.deps.random }),
            ...(this.deps.gzip === undefined ? {} : { gzip: this.deps.gzip }),
            ...(this.deps.chunkFrames === undefined ? {} : { chunkFrames: this.deps.chunkFrames }),
            ...(this.deps.chunkMs === undefined ? {} : { chunkMs: this.deps.chunkMs }),
            onError: (e) => this.onWriterError(e)
        });
        this.writer = writer;
        this.store = store;
        this.sessionId = id;
        this.emptyId = null; // the manifest is written: what follows is a session that can be recovered

        // the voice, if the microphone was allowed
        this.voiceState = mic === 'granted' ? 'off' : mic;
        if (mic === 'granted') {
            try {
                const started = await this.deps.voice.start((bytes, slice) => this.onSlice(bytes, slice), () => this.clock.now());
                writer.setVoiceOffset(started.offsetMs);
                this.markStart(started);
                this.voiceOffsetSet = true;
                this.voiceState = 'recording';
                for (const held of this.pendingSlices) this.writeVoice(held);
                this.pendingSlices = [];
            } catch (e) {
                this.voiceState = 'failed';
                this.noteProblem(`the voice could not be recorded: ${e instanceof Error ? e.message : String(e)}`);
                this.deps.voice.release();
            }
        }

        this.write({ t: 0, kind: 'session', what: 'start' });
        this.write({ t: this.clock.now(), kind: 'recording', what: 'start' });
        if (mic !== 'granted' && mic === 'denied') this.write({ t: this.clock.now(), kind: 'recording', what: 'mic-denied' });
        this.flushTimer = setInterval(() => this.flushNow(), this.deps.flushMs ?? DEFAULT_FLUSH_MS);
        this.statusTimer = setInterval(() => this.emit(), STATUS_MS);
        this.setPhase('recording');
        if (mic === 'denied') this.deps.say({ key: 'rec.mic-denied' });
        else this.deps.say({ key: 'rec.started' });
        return true;
    }

    // ------------------------------------------------------------------ while it records

    /** One FlightSample per rendered frame (the bridge's `sonicSample`). Keeps one in 30 Hz. Never throws into the flight. */
    onSample(s: FlightSample): void {
        if (this.phaseValue !== 'recording' || this.writer === null) return;
        try {
            const t = this.clock.sample(s.t);
            const frame = this.sampler.take(s, t, this.cuesNow());
            if (frame !== null) {
                this.writer.frame(frame);
                this.frameCount++;
            }
        } catch (e) {
            this.refusals.add('sample', e instanceof Error ? e.message : String(e));
        }
    }

    /** Every event of the mode (the bridge's `sonicEvent`), on the recording clock. Never throws into the flight. */
    onEvent(e: SessionEvent): void {
        if ((this.phaseValue !== 'recording' && this.phaseValue !== 'closing') || this.writer === null) return;
        if (!busEventWanted(e, this.phaseValue)) return;
        this.write({ ...e, t: this.clock.fromHost(e.t) } as SessionEvent);
    }

    private cuesNow(): readonly string[] {
        try {
            if (this.deps.cues !== undefined) return this.deps.cues();
            return this.deps.runtime()?.engine.activeCues().map((c) => c.id) ?? [];
        } catch {
            return [];
        }
    }

    /** Writes one event the package accepts; anything else is counted and dropped. */
    private write(e: SessionEvent): void {
        const writer = this.writer;
        if (writer === null) return;
        const problem = eventProblem(e);
        if (problem !== null) {
            this.refusals.add('event', problem);
            return;
        }
        try {
            writer.event(e);
            this.eventCount++;
        } catch (err) {
            this.refusals.add('event', err instanceof Error ? err.message : String(err));
        }
    }

    private onSlice(bytes: Uint8Array, slice: VoiceSlice): void {
        if (!this.voiceOffsetSet) {
            this.pendingSlices.push(bytes);
            return;
        }
        this.writeVoice(bytes);
        this.markSlice(slice);
    }

    private writeVoice(bytes: Uint8Array): void {
        try {
            this.writer?.voice(bytes);
        } catch (err) {
            this.voiceState = 'failed';
            this.noteProblem(`the voice could not be written: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    /**
     * A sync mark per slice: when it came in on the recording clock against its place in the track, next to the session in
     * voice-sync.jsonl. The package format has no field for it (see docs/wip/v12-feedback.md): the file is for measuring the
     * drift of the voice against the flight, and the package itself carries only voiceOffsetMs.
     */
    private markSlice(slice: VoiceSlice): void {
        this.sliceMarks++;
        this.appendMark({ k: slice.index, t: Math.round(slice.t), bytes: slice.bytes });
    }

    /** The first mark: when the recorder was started (voiceOffsetMs) and when the browser said it had started. */
    private markStart(started: { readonly offsetMs: number; readonly startEventMs: number }): void {
        this.appendMark({ start: { called: Math.round(started.offsetMs * 10) / 10, event: Math.round(started.startEventMs * 10) / 10 } });
    }

    private appendMark(mark: object): void {
        const store = this.store;
        if (store === null) return;
        void Promise.resolve(store.append('voice-sync.jsonl', utf8Encode(`${JSON.stringify(mark)}\n`))).catch(() => undefined);
    }

    private noteProblem(text: string): void {
        this.errorText = text;
        this.emit();
    }

    private onWriterError(e: unknown): void {
        const text = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
        this.noteProblem(`the recording cannot be stored: ${text}`);
        // the writer has stopped; what it wrote stays in the browser's storage and is offered again at the next start
        if (this.phaseValue === 'recording') void this.abort(e);
    }

    /** Writes what is buffered (also called when the tab is hidden or closing: a best effort there). */
    flushNow(): void {
        const w = this.writer;
        if (w === null || this.phaseValue === 'finishing') return;
        w.flush().catch(() => undefined); // a failure is reported through onError
    }

    // ------------------------------------------------------------------ stop

    /**
     * The pilot ends the recording. The flight and the events stop here; the voice goes on while `options.survey` runs, then
     * the package is finished. Resolves with the finished recording, or null when it could not be finished.
     */
    stop(options: StopOptions = {}): Promise<FinishedRecording | null> {
        if (this.stopping !== null) return this.stopping;
        if (this.phaseValue !== 'recording') return Promise.resolve(null);
        this.stopping = this.doStop(options).finally(() => {
            this.stopping = null;
        });
        return this.stopping;
    }

    private async doStop(options: StopOptions): Promise<FinishedRecording | null> {
        this.write({ t: this.clock.now(), kind: 'recording', what: 'stop' });
        this.setPhase('closing');
        this.deps.say({ key: 'rec.stopped' });
        let answers: SurveyAnswers | null = null;
        if (options.survey !== undefined && this.sessionId !== null && this.profileAtStart !== null) {
            try {
                answers = await options.survey({ now: () => this.clock.now(), sessionId: this.sessionId, profile: this.profileAtStart });
            } catch (e) {
                this.noteProblem(`the survey stopped: ${e instanceof Error ? e.message : String(e)}`);
            }
        }
        return this.finish(answers);
    }

    private async finish(answers: SurveyAnswers | null): Promise<FinishedRecording | null> {
        const writer = this.writer;
        const id = this.sessionId;
        if (writer === null || id === null) return null;
        this.setPhase('finishing');
        this.clearTimers();
        this.write({ t: this.clock.now(), kind: 'session', what: 'end' });
        try {
            await this.deps.voice.stop();
        } catch (e) {
            this.noteProblem(`the voice recorder did not stop cleanly: ${e instanceof Error ? e.message : String(e)}`);
        }
        let manifest: SessionManifest | null = null;
        try {
            if (answers !== null) writer.survey(answers);
            manifest = await writer.finish({ ended: this.deps.nowIso(), complete: true });
        } catch (e) {
            this.noteProblem(`the recording could not be finished: ${e instanceof Error ? e.message : String(e)}`);
        }
        const result: FinishedRecording | null = manifest === null ? null : { id, manifest, frames: this.frameCount, events: this.eventCount, refused: this.refusals.total + this.sampler.refused.total };
        this.deps.voice.release();
        this.releaseLock?.();
        this.releaseLock = null;
        this.writer = null;
        this.store = null;
        this.voiceState = 'off';
        if (result !== null) this.lastId = id;
        this.sessionId = null;
        this.setPhase('idle');
        // spoken only when it worked: a pilot who hears "saved" has a package
        if (result !== null) this.deps.say({ key: 'rec.saved' });
        return result;
    }

    /** The recording cannot go on (storage failed, the sound mode went away): let go of everything, keep what was written. */
    private async abort(reason: unknown): Promise<void> {
        const text = reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason);
        this.clearTimers();
        if (this.errorText === null) this.errorText = text;
        try {
            await this.deps.voice.stop();
        } catch {
            // the recorder is gone already
        }
        this.deps.voice.release();
        this.releaseLock?.();
        this.releaseLock = null;
        this.writer = null;
        this.store = null;
        this.voiceState = 'off';
        this.sessionId = null;
        const empty = this.emptyId;
        this.emptyId = null;
        if (empty !== null) await this.deps.stores.remove(empty).catch(() => undefined);
        this.setPhase('idle');
        this.deps.say({ key: 'rec.stopped' });
    }

    private clearTimers(): void {
        if (this.flushTimer !== null) clearInterval(this.flushTimer);
        if (this.statusTimer !== null) clearInterval(this.statusTimer);
        if (this.askTimer !== null) clearTimeout(this.askTimer);
        this.flushTimer = null;
        this.statusTimer = null;
        this.askTimer = null;
    }

    /** Lets go of timers and the microphone (the page is going away, or a test is over). A recording in progress is not finished: its chunks stay, recoverable. */
    dispose(): void {
        this.clearTimers();
        this.deps.voice.release();
        this.releaseLock?.();
        this.releaseLock = null;
    }
}
