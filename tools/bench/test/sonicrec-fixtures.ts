// Fakes for the Node tests of Fly by Sound's session side (lane v12-feedback): an in-memory file system with the
// failure modes of OPFS that matter (a write that fails, a tab that dies with a write in flight), the sound mode's
// runtime as the flight lane will expose it (ctx.sonic), a microphone with a recorder that makes slices, and synthetic
// samples. Nothing here is a test.
import zlib from 'node:zlib';
import { createAnalyticWorld, defaultPrefs, getLesson, resolveTheme } from '../../../packages/sonic-fpv/src';
import type { FlightSample, GzipFn, SessionEvent, SonicEngine, SonicRuntime, SpeechLine } from '../../../packages/sonic-fpv/src';
import type { DirectoryLike, FileLike, WritableLike } from '../../../apps/fly/src/sonic-session/store';
import type { MicDeps, RecorderLike, StreamLike } from '../../../apps/fly/src/sonic-session/voice';

export const nodeGzip: GzipFn = (bytes) => Promise.resolve(new Uint8Array(zlib.gzipSync(bytes)));

// ------------------------------------------------------------------ an in-memory OPFS

export class QuotaError extends Error {
    constructor() {
        super('The quota has been exceeded.');
        this.name = 'QuotaExceededError';
    }
}

/** Shared by a directory tree: the switches that make writes fail. */
export interface FsFaults {
    /** the next `n` writes succeed, every one after fails with a quota error (null: no limit) */
    writesLeft: number | null;
    /** the tab is dead: writes in flight are lost, new ones never complete (they throw) */
    dead: boolean;
    /** every removeEntry fails (a busy file) */
    removeFails: boolean;
    /** count of files committed */
    commits: number;
}

export class FakeFile implements FileLike {
    readonly kind = 'file' as const;
    bytes = new Uint8Array(0);
    modified = 0;
    constructor(readonly name: string, private readonly faults: FsFaults) {}

    async getFile() {
        const bytes = this.bytes;
        return { size: bytes.length, lastModified: this.modified, arrayBuffer: async () => bytes.slice().buffer };
    }

    async createWritable(): Promise<WritableLike> {
        if (this.faults.dead) throw new Error('the tab is gone');
        const parts: Uint8Array[] = [];
        let closed = false;
        return {
            write: async (data) => {
                if (this.faults.dead) throw new Error('the tab is gone');
                parts.push(data.slice());
            },
            close: async () => {
                if (this.faults.dead) throw new Error('the tab is gone');
                if (this.faults.writesLeft !== null) {
                    if (this.faults.writesLeft <= 0) throw new QuotaError();
                    this.faults.writesLeft--;
                }
                // the swap file replaces the real one in one step
                let n = 0;
                for (const p of parts) n += p.length;
                const out = new Uint8Array(n);
                let at = 0;
                for (const p of parts) {
                    out.set(p, at);
                    at += p.length;
                }
                this.bytes = out;
                this.modified = Date.now();
                this.faults.commits++;
                closed = true;
            },
            abort: async () => {
                if (!closed) parts.length = 0;
            }
        };
    }
}

export class FakeDirectory implements DirectoryLike {
    readonly kind = 'directory' as const;
    readonly files = new Map<string, FakeFile>();
    readonly dirs = new Map<string, FakeDirectory>();

    constructor(readonly name: string, readonly faults: FsFaults = { writesLeft: null, dead: false, removeFails: false, commits: 0 }) {}

    async getFileHandle(name: string, options: { create?: boolean } = {}): Promise<FileLike> {
        let f = this.files.get(name);
        if (f === undefined) {
            if (options.create !== true) throw Object.assign(new Error(`${name} not found`), { name: 'NotFoundError' });
            f = new FakeFile(name, this.faults);
            this.files.set(name, f);
        }
        return f;
    }

    async getDirectoryHandle(name: string, options: { create?: boolean } = {}): Promise<DirectoryLike> {
        let d = this.dirs.get(name);
        if (d === undefined) {
            if (options.create !== true) throw Object.assign(new Error(`${name} not found`), { name: 'NotFoundError' });
            d = new FakeDirectory(name, this.faults);
            this.dirs.set(name, d);
        }
        return d;
    }

    async removeEntry(name: string): Promise<void> {
        if (this.faults.removeFails) throw new Error('busy');
        if (!this.files.delete(name) && !this.dirs.delete(name)) throw Object.assign(new Error(`${name} not found`), { name: 'NotFoundError' });
    }

    async *entries(): AsyncIterable<[string, FileLike | DirectoryLike]> {
        for (const [n, f] of [...this.files]) yield [n, f];
        for (const [n, d] of [...this.dirs]) yield [n, d];
    }

    /** Kills the tab: nothing more is written, what was committed stays. */
    kill(): void {
        this.faults.dead = true;
    }

    /** A new tab over the same files. */
    revive(): void {
        this.faults.dead = false;
    }

    /** Every file name in this directory, sorted. */
    names(): string[] {
        return [...this.files.keys()].sort();
    }
}

// ------------------------------------------------------------------ the sound mode's runtime

export interface FakeRuntime {
    readonly runtime: SonicRuntime;
    /** every line the engine was asked to say */
    readonly spoken: SpeechLine[];
    cues: string[];
}

/** ctx.sonic as the flight lane will expose it: a lesson in its analytic world, the soft theme, an engine that records what it says. */
export function fakeRuntime(lessonId: string | null = 'walls-hall'): FakeRuntime {
    const spoken: SpeechLine[] = [];
    const state = { cues: ['height.tone', 'room.bed'] as string[] };
    const lesson = lessonId === null ? null : getLesson(lessonId);
    const world = lesson !== null && lesson.world.kind === 'analytic' ? createAnalyticWorld(lesson.world.spec) : null;
    const engine = {
        state: 'running',
        async start() {},
        async suspend() {},
        async resume() {},
        async close() {},
        setTheme() {},
        setPrefs() {},
        setLayers() {},
        update() {},
        cue() {},
        async say(line: SpeechLine) {
            spoken.push(line);
        },
        activeCues: () => state.cues.map((id) => ({ id, layer: 'height', dir: null, distance: null, rateHz: null, pitchHz: null, rough: 0 })),
        onSpeech: null,
        auxInput: null
    } as unknown as SonicEngine;
    const runtime: SonicRuntime = { engine, prefs: defaultPrefs(), theme: resolveTheme('soft', {}), world, lesson, runner: null, playback() {} };
    return {
        runtime,
        spoken,
        get cues() {
            return state.cues;
        },
        set cues(v: string[]) {
            state.cues = v;
        }
    };
}

// ------------------------------------------------------------------ the microphone

export type MicMode = 'grant' | 'deny' | 'missing' | 'unsupported';

/** A recorder that makes a slice every `sliceMs` of real time, deterministic bytes, and a final one on stop. */
export class FakeRecorder implements RecorderLike {
    state = 'inactive';
    ondataavailable: RecorderLike['ondataavailable'] = null;
    onstart: (() => void) | null = null;
    onstop: (() => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    private timer: ReturnType<typeof setInterval> | null = null;

    constructor(private readonly mic: FakeMic) {}

    private slice(): void {
        const bytes = new Uint8Array(this.mic.bytesPerSlice);
        for (let i = 0; i < bytes.length; i++) bytes[i] = (this.mic.emitted.length * 31 + i) & 0xff;
        this.mic.emitted.push(bytes);
        this.ondataavailable?.({ data: { size: bytes.length, arrayBuffer: async () => bytes.slice().buffer } });
    }

    start(sliceMs = 1000): void {
        this.state = 'recording';
        setTimeout(() => this.onstart?.(), this.mic.startDelayMs);
        this.timer = setInterval(() => this.slice(), Math.min(sliceMs, this.mic.sliceMs));
    }

    stop(): void {
        if (this.timer !== null) clearInterval(this.timer);
        this.timer = null;
        this.slice();
        this.state = 'inactive';
        setTimeout(() => this.onstop?.(), 2);
    }
}

export class FakeMic implements MicDeps {
    readonly emitted: Uint8Array[] = [];
    asked = 0;
    stopped = 0;
    constructor(public mode: MicMode = 'grant', readonly sliceMs = 20, readonly bytesPerSlice = 300, readonly startDelayMs = 5) {}

    available(): boolean {
        return this.mode !== 'unsupported';
    }

    getUserMedia(): Promise<StreamLike> {
        this.asked++;
        if (this.mode === 'deny') return Promise.reject(Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' }));
        if (this.mode === 'missing') return Promise.reject(Object.assign(new Error('Requested device not found'), { name: 'NotFoundError' }));
        return Promise.resolve({ getTracks: () => [{ stop: () => { this.stopped++; }, onended: null }] });
    }

    createRecorder(): RecorderLike | null {
        return new FakeRecorder(this);
    }

    /** The voice the recorder should have written: every slice the fake made, joined. */
    voice(): Uint8Array {
        let n = 0;
        for (const s of this.emitted) n += s.length;
        const out = new Uint8Array(n);
        let at = 0;
        for (const s of this.emitted) {
            out.set(s, at);
            at += s.length;
        }
        return out;
    }
}

// ------------------------------------------------------------------ samples and events

/** A craft circling at 2 m/s; `t` is the host's clock. */
export function sampleAt(t: number, tick = Math.round(t)): FlightSample {
    const a = t / 1700;
    return {
        t,
        tick,
        pos: [Math.cos(a) * 3, 2.5, Math.sin(a) * 3],
        vel: [-Math.sin(a) * 2, 0, Math.cos(a) * 2],
        quat: [1, 0, 0, 0],
        rate: [0, 0, 0],
        yawDeg: 0,
        pitchDeg: 0,
        rollDeg: 0,
        sticks: [0.1, -0.2, 0, 0.05],
        armed: true,
        touched: false,
        paused: false
    };
}

export const lessonOpen = (t: number, lessonId = 'walls-hall'): SessionEvent => ({ t, kind: 'lesson', lessonId, version: 1, what: 'open', attempt: 0 });
