// The live video recorder (docs/architecture-v03.md F.1, F.2; items 19 and 14; decision D34).
// Recording is offered only for showcase scenes (their authors agreed to it), and every recorded
// frame carries the scene credit burned into the picture, so a clip shared anywhere keeps it.
// WebCodecs' VideoEncoder encodes; Mediabunny (MPL-2.0) only writes the MP4 container.
//
// 60 fps (item 19): the v0.2 recorder declared a 30 fps track and added every rendered frame, so a
// 60 Hz render wrote 29 duplicate timestamps a second (research-b 3.1, D-j). Here a FramePacer puts
// the rendered frames on a fixed 1/fps grid: each slot k gets the first frame within half a period
// of k/fps and is stamped exactly k/fps, so the file has a constant frame rate (DaVinci needs it).
// Up to two missed slots repeat the previous frame; a longer gap is dropped; both are counted and
// shown after stop. The file goes to disk while it is written (StreamTarget, fastStart false) into
// the pilot's folder or the browser's own storage (OPFS); memory only as the last fallback, capped.
//
// Everything above the targets line is pure (no DOM, no clock): tools/bench/test/rec.test.ts.
// Mediabunny is loaded with the first recording, so the flight page can import this module.
import type * as Mediabunny from 'mediabunny';
import type { Output, Mp4OutputFormat, StreamTarget, StreamTargetChunk } from 'mediabunny';

/** Mediabunny loads with the first recording: the flight page itself never needs it. */
let mediabunnyP: Promise<typeof Mediabunny> | null = null;
const mediabunny = (): Promise<typeof Mediabunny> => (mediabunnyP ??= import('mediabunny'));

export type RecFps = 30 | 60;
export type RecResolution = '1080p' | '1440p' | '2160p' | 'native';

// ------------------------------------------------------------------ pacing (pure)

/** What one rendered frame becomes: the slots to stamp now, and the slots lost before them. */
export interface PaceResult {
    /** ascending; the last one is this frame, any before it repeat the previous frame (missed slots) */
    slots: number[];
    /** missed slots beyond the repeat limit: not encoded at all (a gap in the file, counted) */
    dropped: number;
}

const NOTHING: PaceResult = Object.freeze({ slots: [], dropped: 0 }) as PaceResult;

/**
 * Rendered frames onto a fixed 1/fps grid (F.1). Slot k sits at t0 + k/fps, t0 being the first
 * frame. A frame takes every slot whose window [k - 1/2, k + 1/2) periods it has reached: at a
 * render as fast as the grid each frame takes one slot even when vsync jitters by a few ms; a
 * faster render leaves frames without a slot (not encoded); a slower one makes a frame reach
 * several slots, and the missed ones repeat the previous frame (at most `maxRepeat`, else dropped).
 */
export class FramePacer {
    readonly fps: number;
    readonly periodMs: number;
    readonly maxRepeat: number;
    private t0 = Number.NaN;
    private next = 0;
    private paused = false;
    private regrid = false;
    /** frames seen, frames that took no slot, slots stamped, repeated slots, dropped slots */
    rendered = 0;
    unused = 0;
    stamped = 0;
    duplicated = 0;
    dropped = 0;

    constructor(fps: RecFps, o: { maxRepeat?: number } = {}) {
        this.fps = fps;
        this.periodMs = 1000 / fps;
        this.maxRepeat = Math.max(0, Math.floor(o.maxRepeat ?? 2));
    }

    onRendered(nowMs: number): PaceResult {
        this.rendered++;
        if (this.paused || !Number.isFinite(nowMs)) {
            this.unused++;
            return NOTHING;
        }
        // the first frame, or the first after a pause: this frame is the next slot, the grid follows it
        if (Number.isNaN(this.t0) || this.regrid) {
            this.t0 = nowMs - this.next * this.periodMs;
            this.regrid = false;
        }
        const reach = Math.floor((nowMs - this.t0) / this.periodMs + 0.5);
        if (reach < this.next) {
            this.unused++;
            return NOTHING;
        }
        const missed = reach - this.next;
        const repeat = Math.min(missed, this.maxRepeat);
        const slots: number[] = [];
        for (let k = this.next; k < this.next + repeat; k++) slots.push(k);
        slots.push(reach);
        const dropped = missed - repeat;
        this.next = reach + 1;
        this.stamped += slots.length;
        this.duplicated += repeat;
        this.dropped += dropped;
        return { slots, dropped };
    }

    /** Slots passed so far (the next slot's index): the recording's length in frames. */
    get slotCount(): number {
        return this.next;
    }

    /**
     * While paused no frame takes a slot; the first frame after it takes the next slot and the grid
     * restarts there, so a pause (or a hidden tab) leaves neither a frozen stretch nor drops.
     */
    pause(on: boolean): void {
        if (on === this.paused) return;
        this.paused = on;
        if (!on) this.regrid = true;
    }

    get isPaused(): boolean {
        return this.paused;
    }
}

/** A slot's timestamp in microseconds (VideoFrame), exactly k/fps s up to the microsecond. */
export function slotUs(k: number, fps: number): number {
    return Math.round((k * 1_000_000) / fps);
}

// ------------------------------------------------------------------ names, sizes, rules (pure)

/** gsfpv-<scene>-<YYYYMMDD-HHMMSS>.mp4 in local time; n > 1 adds -n (two files in one second). */
export function recordingName(scene: string, d: Date, n = 1): string {
    const p = (x: number) => String(x).padStart(2, '0');
    const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
    const safe = scene.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || 'scene';
    return `gsfpv-${safe}-${stamp}${n > 1 ? `-${n}` : ''}.mp4`;
}

const RES_HEIGHT: Record<Exclude<RecResolution, 'native'>, number> = { '1080p': 1080, '1440p': 1440, '2160p': 2160 };

/**
 * The video size: the canvas as flown ('native'), or the canvas scaled to that height, never
 * above the canvas (an upscale adds no detail). Even sizes: H.264 needs them.
 */
export function outputSize(canvasW: number, canvasH: number, res: RecResolution): { width: number; height: number } {
    const w = Math.max(2, Math.floor(canvasW)), h = Math.max(2, Math.floor(canvasH));
    const even = (x: number) => Math.max(2, Math.round(x) & ~1);
    if (res === 'native' || !(res in RES_HEIGHT)) return { width: even(w), height: even(h) };
    const target = RES_HEIGHT[res];
    if (h <= target) return { width: even(w), height: even(h) };
    return { width: even((w * target) / h), height: even(target) };
}

/** Bits per second for this size and rate: w x h x fps x 0.1 (F.1). */
export function bitrateFor(width: number, height: number, fps: number): number {
    return Math.round(width * height * fps * 0.1);
}

/** Chrome offers hardware H.264 at a declared 60 fps only up to 1920 x 1080 (research-b 3.2). */
export function declareFramerate(width: number, height: number): boolean {
    return width * height <= 1920 * 1080;
}

/** The flight events auto-record follows (the runner's SimEvent, reduced to what matters here). */
export type AutoEvent = { type: 'arm' } | { type: 'disarm'; reason: string } | { type: 'crash' } | { type: 'respawn' } | { type: string; reason?: string };

/**
 * When auto-record starts and stops (F.2): it starts at arm and stops 3 s after a disarm that is
 * not a crash. A crash stops it only when auto-respawn is off (then 3 s after it, so the crash is
 * in the clip); with auto-respawn on the pilot is put back and flies on in the same recording. A
 * respawn that leaves the craft disarmed (R while flying) counts as a disarm. Any arm in between
 * cancels a pending stop.
 */
export class AutoRecordRules {
    static readonly STOP_AFTER_MS = 3000;
    private stopAt: number | null = null;
    private crashed = false;

    /** 'start' at arm; stops come from tick(). */
    onEvent(e: AutoEvent, nowMs: number, autoRespawn: boolean): 'start' | null {
        switch (e.type) {
            case 'arm':
                this.stopAt = null;
                this.crashed = false;
                return 'start';
            case 'disarm':
                if (e.reason === 'crash') {
                    this.crashed = true;
                    if (!autoRespawn) this.stopAt = nowMs + AutoRecordRules.STOP_AFTER_MS;
                } else this.stopAt = nowMs + AutoRecordRules.STOP_AFTER_MS;
                return null;
            case 'respawn':
                // an arm that keeps the craft armed follows in the same step and cancels this
                if (!(this.crashed && autoRespawn) && this.stopAt === null) this.stopAt = nowMs + AutoRecordRules.STOP_AFTER_MS;
                return null;
            default:
                return null;
        }
    }

    /** 'stop' once a pending stop is due. */
    tick(nowMs: number): 'stop' | null {
        if (this.stopAt !== null && nowMs >= this.stopAt) {
            this.stopAt = null;
            return 'stop';
        }
        return null;
    }

    get pendingStopAt(): number | null {
        return this.stopAt;
    }

    reset(): void {
        this.stopAt = null;
        this.crashed = false;
    }
}

// ------------------------------------------------------------------ targets: where the file goes

/** The File System Access parts that TypeScript's DOM library does not have (Chromium only). */
interface PermissionHandle {
    queryPermission?(o: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
    requestPermission?(o: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
}
interface DirectoryEntries {
    values?(): AsyncIterable<FileSystemHandle>;
}

export type FolderAccess = PermissionState | 'unsupported';

/** queryPermission readwrite, before every start (Chrome may revoke it after long background time). */
export async function folderAccess(dir: FileSystemDirectoryHandle): Promise<FolderAccess> {
    const h = dir as FileSystemDirectoryHandle & PermissionHandle;
    if (!h.queryPermission) return 'granted'; // OPFS-style handles without the call: always writable
    try {
        return await h.queryPermission({ mode: 'readwrite' });
    } catch {
        return 'denied';
    }
}

/** requestPermission readwrite; only inside a click or key press (radio input cannot grant it). */
export async function askFolderAccess(dir: FileSystemDirectoryHandle): Promise<FolderAccess> {
    const h = dir as FileSystemDirectoryHandle & PermissionHandle;
    if (!h.requestPermission) return folderAccess(dir);
    try {
        return await h.requestPermission({ mode: 'readwrite' });
    } catch {
        return 'denied';
    }
}

/** The OS folder picker (Chromium desktop); null where there is none (Firefox, Safari, phones). */
export function folderPicker(): ((o: { id: string; mode: 'readwrite'; startIn: string }) => Promise<FileSystemDirectoryHandle>) | null {
    const w = globalThis as unknown as { showDirectoryPicker?: (o: { id: string; mode: 'readwrite'; startIn: string }) => Promise<FileSystemDirectoryHandle> };
    return typeof w.showDirectoryPicker === 'function' ? w.showDirectoryPicker.bind(globalThis) : null;
}

export interface RecordSink {
    write(chunk: { data: Uint8Array; position: number }): Promise<void>;
    close(): Promise<void>;
    abort(): Promise<void>;
}

export interface RecordTarget {
    /** folder: the pilot's folder; browser: the origin's private storage (OPFS); memory: RAM, capped */
    readonly kind: 'folder' | 'browser' | 'memory';
    /** the folder's name for the pilot ('folder'), else '' */
    readonly folder: string;
    open(name: string): Promise<RecordSink>;
    exists(name: string): Promise<boolean>;
    /** the written file, to offer after stop or to move into the folder later */
    file(name: string): Promise<Blob | null>;
    remove(name: string): Promise<void>;
    describe(): string;
}

function canWrite(): boolean {
    const p = (globalThis as unknown as { FileSystemFileHandle?: { prototype: object } }).FileSystemFileHandle?.prototype;
    return !!p && 'createWritable' in p;
}

/** Into a directory: the pilot's folder, or the OPFS one. Writes go to a swap file until close(). */
function dirTarget(kind: 'folder' | 'browser', getDir: () => Promise<FileSystemDirectoryHandle>, folder: string): RecordTarget {
    return {
        kind,
        folder,
        async open(name) {
            const dir = await getDir();
            const fh = await dir.getFileHandle(name, { create: true });
            const ws = await fh.createWritable({ keepExistingData: false });
            return {
                write: (c) => ws.write({ type: 'write', data: c.data as Uint8Array<ArrayBuffer>, position: c.position }),
                close: () => ws.close(),
                async abort() {
                    try { await ws.abort(); } catch { /* already closed */ }
                    try { await dir.removeEntry(name); } catch { /* never created */ }
                }
            };
        },
        async exists(name) {
            try {
                await (await getDir()).getFileHandle(name);
                return true;
            } catch {
                return false;
            }
        },
        async file(name) {
            try {
                return await (await (await getDir()).getFileHandle(name)).getFile();
            } catch {
                return null;
            }
        },
        async remove(name) {
            try { await (await getDir()).removeEntry(name); } catch { /* gone */ }
        },
        describe: () => (kind === 'folder' ? folder : 'browser storage')
    };
}

/** The pilot's chosen folder (its permission already granted). */
export function folderTarget(dir: FileSystemDirectoryHandle): RecordTarget {
    return dirTarget('folder', async () => dir, dir.name);
}

/** The folder in OPFS where recordings wait when no folder can be written. */
export const OPFS_DIR = 'recordings';

/** The origin private file system (Chrome, Firefox, Safari): no picker, offered after stop. */
export function opfsTarget(): RecordTarget | null {
    const sm = (globalThis as unknown as { navigator?: { storage?: { getDirectory?: () => Promise<FileSystemDirectoryHandle> } } }).navigator?.storage;
    if (!sm?.getDirectory || !canWrite()) return null;
    let dir: Promise<FileSystemDirectoryHandle> | null = null;
    return dirTarget('browser', () => (dir ??= sm.getDirectory!().then((root) => root.getDirectoryHandle(OPFS_DIR, { create: true }))), '');
}

/**
 * The last fallback: the file in memory, offered after stop. Mediabunny warns that large outputs in
 * RAM can crash the page, so the recorder stops it at its cap (2 min, F.1).
 */
export function memoryTarget(): RecordTarget {
    const files = new Map<string, Blob>();
    return {
        kind: 'memory',
        folder: '',
        async open(name) {
            let buf = new Uint8Array(1 << 20);
            let size = 0;
            return {
                async write(c) {
                    const end = c.position + c.data.byteLength;
                    if (end > buf.length) {
                        let n = buf.length;
                        while (n < end) n *= 2;
                        const grown = new Uint8Array(n);
                        grown.set(buf.subarray(0, size));
                        buf = grown;
                    }
                    buf.set(c.data, c.position);
                    size = Math.max(size, end);
                },
                async close() {
                    files.set(name, new Blob([buf.slice(0, size)], { type: 'video/mp4' }));
                    buf = new Uint8Array(0);
                },
                async abort() {
                    buf = new Uint8Array(0);
                }
            };
        },
        exists: async (name) => files.has(name),
        file: async (name) => files.get(name) ?? null,
        remove: async (name) => { files.delete(name); },
        describe: () => 'memory'
    };
}

/** Copies a finished recording into another target and removes the source (browser -> folder). */
export async function moveRecording(from: RecordTarget, name: string, to: RecordTarget): Promise<boolean> {
    const blob = await from.file(name);
    if (!blob) return false;
    const sink = await to.open(name);
    try {
        const reader = blob.stream().getReader();
        let pos = 0;
        for (;;) {
            const r = await reader.read();
            if (r.done) break;
            await sink.write({ data: r.value, position: pos });
            pos += r.value.byteLength;
        }
        await sink.close();
    } catch (e) {
        await sink.abort();
        throw e;
    }
    await from.remove(name);
    return true;
}

/** Keeps the newest `keep` recordings in the browser's storage (they count against its quota). */
export async function pruneBrowserRecordings(keep: number): Promise<number> {
    const t = opfsTarget();
    if (!t) return 0;
    const sm = (navigator as Navigator & { storage: { getDirectory(): Promise<FileSystemDirectoryHandle> } }).storage;
    try {
        const dir = await (await sm.getDirectory()).getDirectoryHandle(OPFS_DIR, { create: true });
        const values = (dir as FileSystemDirectoryHandle & DirectoryEntries).values?.();
        if (!values) return 0;
        const files: { name: string; t: number }[] = [];
        for await (const h of values) if (h.kind === 'file' && h.name.endsWith('.mp4')) files.push({ name: h.name, t: (await (h as FileSystemFileHandle).getFile()).lastModified });
        files.sort((a, b) => b.t - a.t);
        let n = 0;
        for (const f of files.slice(keep)) {
            await t.remove(f.name);
            n++;
        }
        return n;
    } catch {
        return 0;
    }
}

// ------------------------------------------------------------------ RECORDER (WebCodecs + Mediabunny)

/** One written file. */
export interface RecordedFile {
    name: string;
    bytes: number;
    frames: number;
    seconds: number;
}

export interface RecorderInfo {
    codec: string;
    width: number;
    height: number;
    fps: number;
    /** frames in the files (slots stamped) */
    frames: number;
    bytes: number;
    seconds: number;
    /** slots that repeat the previous picture, and slots with no picture at all (gaps, a busy encoder) */
    duplicated: number;
    dropped: number;
    /** the last file's name, and every file of this recording (a long one is split) */
    file: string;
    files: RecordedFile[];
    where: RecordTarget['kind'];
    folder: string;
    /** why it ended without a stop from the pilot: the memory cap, or an error (disk full, access lost) */
    ended: 'stop' | 'cap' | 'error';
    error?: string;
}

export interface RecorderOptions {
    width: number;
    height: number;
    fps: RecFps;
    credit: string;
    target: RecordTarget;
    /** the scene id, for the file names */
    scene: string;
    /** a new file every this many minutes (recording.splitMin) */
    splitMin?: number;
    /** stop by itself after this long (the memory target) */
    capSeconds?: number;
    /** wall clock for the names (tests) */
    now?: () => Date;
    /**
     * Test only, the negative control of F.5: v0.2's path. Every rendered frame is encoded with its
     * own render time into a track declared at 30 fps, which Mediabunny snaps to 1/30 s.
     */
    legacyV02?: boolean;
}

/** Encoder settings for this size: H.264 first (plays everywhere), VP9 as a fallback (D34). */
async function pickCodec(width: number, height: number, fps: number): Promise<{ muxCodec: 'avc' | 'vp9'; config: VideoEncoderConfig } | null> {
    const candidates: { muxCodec: 'avc' | 'vp9'; codec: string }[] = [
        { muxCodec: 'avc', codec: 'avc1.640033' }, // High 5.1: up to 4K
        { muxCodec: 'avc', codec: 'avc1.640032' },
        { muxCodec: 'avc', codec: 'avc1.42003e' },
        { muxCodec: 'vp9', codec: 'vp09.00.51.08' }
    ];
    const declare = declareFramerate(width, height);
    for (const c of candidates) {
        // above 1920 x 1080 the hardware encoder refuses a declared 60 fps: leave it out there
        for (const withRate of declare ? [true, false] : [false]) {
            const config: VideoEncoderConfig = { codec: c.codec, width, height, bitrate: bitrateFor(width, height, fps), latencyMode: 'quality', ...(withRate ? { framerate: fps } : {}) };
            try {
                const s = await VideoEncoder.isConfigSupported(config);
                if (s.supported) return { muxCodec: c.muxCodec, config };
            } catch { /* try the next one */ }
        }
    }
    return null;
}

/** A key frame every 120 frames (2 s at 60 fps). */
const KEY_EVERY = 120;
/** frames waiting in the encoder before a slot is given up (never stall the flight) */
const QUEUE_MAX = 8;

/** One file: its own encoder and MP4 output, so a split never waits for the previous file. */
class Part {
    readonly firstSlot: number;
    name = '';
    frames = 0;
    bytes = 0;
    failed: unknown = null;
    private readonly output: Output<Mp4OutputFormat, StreamTarget>;
    private readonly encoder: VideoEncoder;
    private writes: Promise<void>;
    private readonly sink: Promise<RecordSink>;

    constructor(mb: typeof Mediabunny, firstSlot: number, name: Promise<string>, target: RecordTarget, muxCodec: 'avc' | 'vp9', config: VideoEncoderConfig, trackFps: number, onError: (e: unknown) => void) {
        this.firstSlot = firstSlot;
        this.sink = name.then((n) => { this.name = n; return target.open(n); });
        this.sink.catch(() => { /* reported through the stream */ });
        const sink = this.sink;
        const ws = new WritableStream<StreamTargetChunk>({
            write: async (c) => {
                await (await sink).write({ data: c.data, position: c.position });
                this.bytes = Math.max(this.bytes, c.position + c.data.byteLength);
            },
            close: async () => { await (await sink).close(); },
            abort: async () => { try { await (await sink).abort(); } catch { /* nothing to remove */ } }
        });
        // fastStart false: mdat first, moov at the end, so nothing waits in memory for the whole file
        this.output = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: false }), target: new mb.StreamTarget(ws, { chunked: true, chunkSize: 4 * 1024 * 1024 }) });
        const track = new mb.EncodedVideoPacketSource(muxCodec);
        this.output.addVideoTrack(track, { frameRate: trackFps });
        const started = this.output.start();
        this.writes = started;
        const fail = (e: unknown) => {
            if (this.failed === null) {
                this.failed = e ?? new Error('recording failed');
                onError(this.failed);
            }
        };
        started.catch(fail);
        // packets must reach the container in decode order: chain the writes
        this.encoder = new VideoEncoder({
            output: (chunk, meta) => {
                const pkt = mb.EncodedPacket.fromEncodedChunk(chunk);
                this.writes = this.writes.then(() => track.add(pkt, meta)).catch(fail);
            },
            error: fail
        });
        this.encoder.configure(config);
    }

    get queue(): number {
        return this.encoder.state === 'configured' ? this.encoder.encodeQueueSize : Infinity;
    }

    encode(frame: VideoFrame, slot: number, fps: number): void {
        const ts = slotUs(slot - this.firstSlot, fps);
        const f = new VideoFrame(frame, { timestamp: ts, duration: slotUs(1, fps) });
        this.encoder.encode(f, { keyFrame: this.frames % KEY_EVERY === 0 });
        f.close();
        this.frames++;
    }

    /** v0.2's path (test-only control): the render time as the timestamp. */
    encodeAt(frame: VideoFrame, timestampUs: number): void {
        const f = new VideoFrame(frame, { timestamp: timestampUs });
        this.encoder.encode(f, { keyFrame: this.frames % 60 === 0 });
        f.close();
        this.frames++;
    }

    async finish(fps: number): Promise<RecordedFile> {
        if (this.failed === null) {
            await this.encoder.flush();
            this.encoder.close();
            await this.writes;
        }
        if (this.failed !== null) {
            await this.abort();
            throw this.failed;
        }
        await this.output.finalize();
        return { name: this.name, bytes: this.bytes, frames: this.frames, seconds: this.frames / fps };
    }

    async abort(): Promise<void> {
        try { if (this.encoder.state !== 'closed') this.encoder.close(); } catch { /* closed */ }
        try { await this.output.cancel(); } catch { /* not started */ }
        try { await (await this.sink).abort(); } catch { /* never opened */ }
    }
}

export class CinemaRecorder {
    readonly width: number;
    readonly height: number;
    readonly fps: RecFps;
    readonly credit: string;
    readonly target: RecordTarget;
    readonly pacer: FramePacer;
    recording = false;
    /** luminance spread of the credit strip in the last composed frame (acceptance check) */
    lastCreditStripStd = 0;
    /** the recording ended by itself (memory cap, an error): the info as stop() gives it */
    onEnded: ((info: RecorderInfo) => void) | null = null;
    private readonly o: RecorderOptions;
    private readonly comp: OffscreenCanvas;
    private readonly ctx: OffscreenCanvasRenderingContext2D;
    private codec = '';
    private muxCodec: 'avc' | 'vp9' = 'avc';
    private config: VideoEncoderConfig | null = null;
    private mb: typeof Mediabunny | null = null;
    private part: Part | null = null;
    private done: Promise<RecordedFile>[] = [];
    private prev: VideoFrame | null = null;
    private composed = 0;
    private duplicated = 0;
    private dropped = 0;
    private usedNames = new Set<string>();
    private error: unknown = null;
    private ending: Promise<RecorderInfo> | null = null;
    private legacyT0 = -1;

    constructor(o: RecorderOptions) {
        this.o = o;
        // even sizes: H.264 needs them
        this.width = Math.max(2, o.width & ~1);
        this.height = Math.max(2, o.height & ~1);
        this.fps = o.fps;
        this.credit = o.credit;
        this.target = o.target;
        this.pacer = new FramePacer(o.fps);
        this.comp = new OffscreenCanvas(this.width, this.height);
        this.ctx = this.comp.getContext('2d', { willReadFrequently: false })!;
    }

    static get supported(): boolean {
        return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined' && typeof OffscreenCanvas !== 'undefined' && typeof WritableStream !== 'undefined';
    }

    /** Seconds recorded so far (slots / fps). */
    get seconds(): number {
        return this.o.legacyV02 ? (this.legacyT0 < 0 ? 0 : (performance.now() - this.legacyT0) / 1000) : this.pacer.slotCount / this.fps;
    }

    private uniqueName(): Promise<string> {
        const now = (this.o.now ?? (() => new Date()))();
        return (async () => {
            for (let n = 1; n < 100; n++) {
                const name = recordingName(this.o.scene, now, n);
                if (this.usedNames.has(name)) continue;
                if (await this.target.exists(name)) continue;
                this.usedNames.add(name);
                return name;
            }
            throw new Error('no free file name');
        })();
    }

    private newPart(firstSlot: number): Part {
        const trackFps = this.o.legacyV02 ? 30 : this.fps;
        return new Part(this.mb!, firstSlot, this.uniqueName(), this.target, this.muxCodec, this.config!, trackFps, (e) => this.fail(e));
    }

    /** Picks the encoder and opens the first file; resolves with the codec string. */
    async start(): Promise<string> {
        if (this.recording) return this.codec;
        const fps = this.o.legacyV02 ? 30 : this.fps;
        this.mb = await mediabunny();
        const pick = await pickCodec(this.width, this.height, fps);
        if (!pick) throw new Error('no WebCodecs video encoder for this size');
        if (this.o.legacyV02) pick.config = { ...pick.config, framerate: 30, bitrate: Math.round(this.width * this.height * 30 * 0.15) };
        this.codec = pick.config.codec;
        this.muxCodec = pick.muxCodec;
        this.config = pick.config;
        this.part = this.newPart(0);
        this.recording = true;
        return this.codec;
    }

    /** Pause (the flight is paused, the tab hidden): no slots pass, and the grid restarts after it. */
    pause(on: boolean): void {
        this.pacer.pause(on);
    }

    /** Draws the canvas and the credit into the video picture. */
    private compose(source: CanvasImageSource): void {
        const c = this.ctx;
        c.drawImage(source, 0, 0, this.width, this.height);
        // the credit, bottom left, readable on any scene (D34: in every frame)
        const fs = Math.max(14, Math.round(this.height / 40));
        c.font = `600 ${fs}px system-ui, sans-serif`;
        const pad = Math.round(fs * 0.6);
        const w = c.measureText(this.credit).width + pad * 2;
        const h = fs + pad * 2;
        const y = this.height - h - pad;
        c.fillStyle = 'rgba(0,0,0,0.55)';
        c.fillRect(pad, y, w, h);
        c.fillStyle = '#ffffff';
        c.textBaseline = 'middle';
        c.fillText(this.credit, pad * 2, y + h / 2);
        if (this.composed % 30 === 0) this.lastCreditStripStd = this.stripStd(pad, y, Math.min(w, this.width - pad), h);
        this.composed++;
    }

    /** Call right after the engine rendered a frame (same task), with the WebGPU canvas. */
    addFrame(source: CanvasImageSource, nowMs: number): void {
        if (!this.recording || !this.part) return;
        if (this.o.legacyV02) return this.addLegacy(source, nowMs);
        const pace = this.pacer.onRendered(nowMs);
        this.dropped += pace.dropped;
        if (pace.slots.length === 0) return;
        const last = pace.slots.length - 1;
        let cur: VideoFrame | null = null;
        for (let i = 0; i <= last; i++) {
            const slot = pace.slots[i];
            if (this.o.capSeconds && slot >= this.o.capSeconds * this.fps) {
                this.endBy('cap');
                break;
            }
            this.maybeSplit(slot);
            const part = this.part!;
            const repeat = i < last;
            if (part.queue > QUEUE_MAX || (repeat && !this.prev)) {
                this.dropped++; // the encoder is behind: give the slot up, never stall the flight
                continue;
            }
            if (!repeat) {
                this.compose(source);
                cur = new VideoFrame(this.comp, { timestamp: 0 });
            }
            part.encode(repeat ? this.prev! : cur!, slot, this.fps);
            if (repeat) this.duplicated++;
        }
        if (cur) {
            this.prev?.close();
            this.prev = cur;
        }
    }

    private addLegacy(source: CanvasImageSource, nowMs: number): void {
        const part = this.part!;
        if (part.queue > QUEUE_MAX) return;
        if (this.legacyT0 < 0) this.legacyT0 = nowMs;
        this.compose(source);
        const f = new VideoFrame(this.comp, { timestamp: 0 });
        part.encodeAt(f, Math.round((nowMs - this.legacyT0) * 1000));
        f.close();
    }

    /** A new file every splitMin minutes: nothing reaches the disk before close(), so this bounds a tab crash's loss. */
    private maybeSplit(slot: number): void {
        const min = this.o.splitMin;
        if (!min || !(min > 0) || !this.part) return;
        const every = Math.max(1, Math.round(min * 60 * this.fps));
        if (slot - this.part.firstSlot < every) return;
        const finished = this.part.finish(this.fps);
        finished.catch(() => { /* reported by stop() */ });
        this.done.push(finished);
        this.part = this.newPart(slot);
    }

    private fail(e: unknown): void {
        if (this.error !== null) return;
        this.error = e;
        this.endBy('error');
    }

    private endBy(why: 'cap' | 'error'): void {
        if (!this.recording) return;
        void this.finishAll(why).then((info) => this.onEnded?.(info));
    }

    /** Finishes every file; the info has the counts the pilot sees after stop. */
    stop(): Promise<RecorderInfo> {
        return this.finishAll('stop');
    }

    private finishAll(why: RecorderInfo['ended']): Promise<RecorderInfo> {
        if (this.ending) return this.ending;
        if (!this.part) return Promise.reject(new Error('not recording'));
        this.recording = false;
        const last = this.part;
        this.part = null;
        const all = [...this.done, why === 'error' ? last.abort().then(() => ({ name: last.name, bytes: 0, frames: 0, seconds: 0 })) : last.finish(this.fps)];
        this.ending = Promise.allSettled(all).then((rs) => {
            this.prev?.close();
            this.prev = null;
            const files: RecordedFile[] = [];
            let err: unknown = this.error;
            for (const r of rs) {
                if (r.status === 'fulfilled') { if (r.value.frames > 0 || r.value.bytes > 0) files.push(r.value); }
                else err ??= r.reason;
            }
            const frames = files.reduce((n, f) => n + f.frames, 0);
            const info: RecorderInfo = {
                codec: this.codec,
                width: this.width,
                height: this.height,
                fps: this.o.legacyV02 ? 30 : this.fps,
                frames,
                bytes: files.reduce((n, f) => n + f.bytes, 0),
                seconds: this.o.legacyV02 ? this.seconds : frames / this.fps,
                duplicated: this.duplicated,
                dropped: this.dropped,
                file: files.length ? files[files.length - 1].name : '',
                files,
                where: this.target.kind,
                folder: this.target.folder,
                ended: err !== null && err !== undefined ? 'error' : why,
                ...(err !== null && err !== undefined ? { error: String((err as Error)?.message ?? err) } : {})
            };
            return info;
        });
        return this.ending;
    }

    private stripStd(x: number, y: number, w: number, h: number): number {
        const d = this.ctx.getImageData(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h))).data;
        let s = 0, s2 = 0, n = 0;
        for (let i = 0; i < d.length; i += 16) {
            const L = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
            s += L; s2 += L * L; n++;
        }
        const m = s / n;
        return Math.sqrt(Math.max(0, s2 / n - m * m));
    }
}
