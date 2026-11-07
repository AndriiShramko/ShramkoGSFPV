// The pilot's voice (docs/wip/v12-plan.md section 4.3 step 2): the microphone through getUserMedia and MediaRecorder,
// Opus in WebM, one slice a second, each slice handed on as bytes as it arrives (the recorder appends it to
// voice.webm at once, so a closed tab loses at most the slice in flight).
//
// getUserMedia is called from request(), which the recorder calls straight from the key press: some browsers
// show their permission question only for a call made inside a user activation, and the question is hard to reach
// with a screen reader (a helper clicks it), so the call is made as early as possible and the session starts after
// the answer. Denied or missing: the flight is recorded without the voice and the package says so.
//
// The browser objects come in through MicDeps, so Node tests drive the same code with fakes.

/** What the recorder needs of a MediaRecorder. */
export interface RecorderLike {
    readonly state: string;
    ondataavailable: ((e: { readonly data: { readonly size: number; arrayBuffer(): Promise<ArrayBuffer> } }) => void) | null;
    onstart: (() => void) | null;
    onstop: (() => void) | null;
    onerror: ((e: unknown) => void) | null;
    start(timesliceMs?: number): void;
    stop(): void;
}

/** What the recorder needs of a MediaStream. */
export interface StreamLike {
    getTracks(): { stop(): void; onended?: unknown }[];
}

export interface MicDeps {
    /** the browser can record audio at all (a secure page with mediaDevices and MediaRecorder) */
    available(): boolean;
    getUserMedia(): Promise<StreamLike>;
    /** the recorder of a stream in this MIME type, or null when the browser cannot make Opus in WebM */
    createRecorder(stream: StreamLike, bitsPerSecond: number): RecorderLike | null;
}

/** The MIME type of voice.webm. */
export const VOICE_MIME = 'audio/webm;codecs=opus';
/** Speech at 32 kbit/s is clear and small: a minute is 240 KB. */
export const VOICE_BITS_PER_SECOND = 32000;
export const SLICE_MS = 1000;
const START_TIMEOUT_MS = 3000;
const STOP_TIMEOUT_MS = 4000;

export type MicResult = 'granted' | 'denied' | 'unavailable';

/** One slice of voice, as it was handed on: where it comes in the track and when it arrived on the recording clock. */
export interface VoiceSlice {
    readonly index: number;
    /** the recording clock when the browser handed the slice over, ms */
    readonly t: number;
    readonly bytes: number;
}

/** The page's real microphone and MediaRecorder. */
export function browserMic(): MicDeps {
    return {
        available() {
            const g = globalThis as { MediaRecorder?: unknown; navigator?: Navigator };
            return typeof g.MediaRecorder === 'function' && typeof g.navigator?.mediaDevices?.getUserMedia === 'function';
        },
        getUserMedia() {
            return navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 }, video: false });
        },
        createRecorder(stream, bitsPerSecond) {
            const MR = (globalThis as { MediaRecorder?: { new (s: MediaStream, o?: MediaRecorderOptions): MediaRecorder; isTypeSupported(t: string): boolean } }).MediaRecorder;
            if (MR === undefined || !MR.isTypeSupported(VOICE_MIME)) return null;
            return new MR(stream as unknown as MediaStream, { mimeType: VOICE_MIME, audioBitsPerSecond: bitsPerSecond }) as unknown as RecorderLike;
        }
    };
}

/** `p`, or `fallback` when it has not settled after `ms`; the timer never outlives the call. */
function within<T, F>(p: Promise<T>, ms: number, fallback: F): Promise<T | F> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve(fallback), ms);
        p.then(
            (v) => { clearTimeout(timer); resolve(v); },
            (e: unknown) => { clearTimeout(timer); reject(e); }
        );
    });
}

export class VoiceCapture {
    private stream: StreamLike | null = null;
    private rec: RecorderLike | null = null;
    private chain: Promise<void> = Promise.resolve();
    private sliceCount = 0;
    private byteCount = 0;
    private failure: unknown = null;
    private endedByDevice = false;

    constructor(private readonly deps: MicDeps) {}

    get available(): boolean {
        return this.deps.available();
    }

    get slices(): number {
        return this.sliceCount;
    }

    get bytes(): number {
        return this.byteCount;
    }

    /** The first failure of the recorder or of a slice, or null. */
    get error(): unknown {
        return this.failure;
    }

    /** The microphone went away (unplugged, taken by another program) while recording. */
    get lost(): boolean {
        return this.endedByDevice;
    }

    /**
     * Asks for the microphone. Call it straight from the key press or the click that gives consent, before any await.
     * Resolves 'granted' (the stream is held), 'denied' (the pilot or the policy said no) or 'unavailable' (no
     * microphone, in use, no WebM/Opus recorder, an insecure page).
     */
    request(): Promise<MicResult> {
        if (!this.deps.available()) return Promise.resolve('unavailable');
        let asked: Promise<StreamLike>;
        try {
            asked = this.deps.getUserMedia();
        } catch {
            return Promise.resolve('unavailable');
        }
        return asked.then(
            (stream) => {
                this.stream = stream;
                return 'granted' as const;
            },
            (e: unknown) => {
                const name = (e as { name?: string } | null)?.name ?? '';
                return /^(NotAllowedError|SecurityError|PermissionDeniedError)$/.test(name) ? ('denied' as const) : ('unavailable' as const);
            }
        );
    }

    /**
     * Starts recording the held stream. `now` is the recording clock. The result says where voice.webm starts on that
     * clock: `offsetMs` is the moment start() was called, `startEventMs` the moment the browser's start event arrived.
     * The browser begins to capture when start() is called and tells it a few tens of milliseconds later, so the call is
     * the better anchor: measured against tone bursts at known times, the start event put every burst about 67 ms late,
     * the call put them within a few ms (tools/bench/src/sonicrec-recorder.ts, check C). `onSlice` gets every slice in
     * order. Throws when there is no stream or the browser cannot make Opus in WebM.
     */
    async start(onSlice: (bytes: Uint8Array, slice: VoiceSlice) => void, now: () => number): Promise<{ offsetMs: number; startEventMs: number }> {
        if (this.stream === null) throw new Error('no microphone stream: request() first');
        const rec = this.deps.createRecorder(this.stream, VOICE_BITS_PER_SECOND);
        if (rec === null) throw new Error('this browser cannot record Opus in WebM');
        this.rec = rec;
        this.sliceCount = 0;
        this.byteCount = 0;
        this.failure = null;
        this.endedByDevice = false;
        for (const track of this.stream.getTracks()) track.onended = () => { this.endedByDevice = true; };
        rec.ondataavailable = (e) => {
            if (e.data.size === 0) return;
            const index = this.sliceCount++;
            const t = now();
            const blob = e.data;
            // slices are read one after the other, so they reach the file in the order they were made
            this.chain = this.chain.then(async () => {
                const bytes = new Uint8Array(await blob.arrayBuffer());
                this.byteCount += bytes.length;
                onSlice(bytes, { index, t, bytes: bytes.length });
            }).catch((err: unknown) => {
                if (this.failure === null) this.failure = err;
            });
        };
        rec.onerror = (e) => {
            if (this.failure === null) this.failure = e;
        };
        const started = new Promise<number>((resolve) => {
            rec.onstart = () => resolve(now());
        });
        const calledAt = now();
        rec.start(SLICE_MS);
        const at = await within(started, START_TIMEOUT_MS, null);
        if (at === null) {
            try {
                rec.stop();
            } catch {
                // never started
            }
            throw new Error('the voice recorder did not start');
        }
        return { offsetMs: calledAt, startEventMs: at };
    }

    /** Stops the recorder and waits until its last slice has been handed on. */
    async stop(): Promise<void> {
        const rec = this.rec;
        if (rec !== null && rec.state !== 'inactive') {
            const stopped = new Promise<void>((resolve) => {
                rec.onstop = () => resolve();
            });
            try {
                rec.stop();
                await within(stopped, STOP_TIMEOUT_MS, undefined);
            } catch (e) {
                if (this.failure === null) this.failure = e;
            }
        }
        await this.chain;
        this.rec = null;
    }

    /** Lets go of the microphone (the browser's recording light goes out). */
    release(): void {
        if (this.stream !== null) for (const track of this.stream.getTracks()) track.stop();
        this.stream = null;
    }
}
