// Recording (docs/architecture-v03.md F.1, F.2; items 19 and 14; D34): where a recording goes, the
// folder the pilot chose (its handle in IndexedDB, its name in recording.folder), the permission to
// write it, and auto-record (starts at arm, stops 3 s after a disarm that is not a crash). The cinema
// bar (builtin/cinema.ts) is its UI; the recorder itself is ../../cinema.ts.
//
// Where a file goes, in order: the pilot's folder when the browser lets us write it; else the
// browser's own storage (OPFS), offered after stop, and moved into the folder once access is given;
// else memory, offered after stop, at most 2 minutes.
// The permission can only be asked inside a click or a key press: radio and gamepad input cannot
// grant it (research-b 3.4), so an auto recording started by the radio's arm switch goes to the
// browser's storage while the bar offers "Allow saving to <folder>".
import { IdbKv, SCHEMA } from '@gsfpv/prefs';
import type { FolderValue, PrefsStore } from '@gsfpv/prefs';
import {
    AutoRecordRules, CinemaRecorder, askFolderAccess, folderAccess, folderPicker, folderTarget, memoryTarget, moveRecording, opfsTarget, outputSize, pruneBrowserRecordings
} from '../../cinema';
import type { AutoEvent, FolderAccess, RecFps, RecResolution, RecorderInfo, RecordTarget } from '../../cinema';

/** IndexedDB key of the folder handle in the 'handles' store. */
export const FOLDER_KEY = 'recording.folder';
/** The memory fallback keeps the whole file in RAM: it stops itself after this long (F.1). */
export const MEMORY_CAP_S = 120;
/** Recordings kept in the browser's storage (they count against its quota). */
export const KEEP_IN_BROWSER = 3;

/** A finished recording as the pilot sees it. */
export interface Saved {
    info: RecorderInfo;
    /** files to save by hand (the browser's storage or memory): name, link, size */
    offer: { name: string; url: string; bytes: number }[];
    /** browser-storage files that went on into the folder once access was given */
    moved: number;
}

export interface RecordingDeps {
    prefs: PrefsStore;
    canvas: HTMLCanvasElement;
    /** the scene flown: its id, and its credit when it is a showcase scene (null: recording not allowed, D34) */
    scene: () => { id: string; credit: string | null };
    /** auto-respawn is on (then a crash does not stop auto-record) */
    autoRespawn: () => boolean;
}

/** Auto-respawn counts only once its setting ships (W2-2); until then a crash ends the flight. */
export function autoRespawnShipped(prefs: PrefsStore): boolean {
    return SCHEMA.byId.get('respawn.auto')?.status === 'shipped' && prefs.get<boolean>('respawn.auto') === true;
}

let kvP: Promise<IdbKv> | null = null;
const kv = (): Promise<IdbKv> => (kvP ??= IdbKv.open());

export class Recording {
    folder: FileSystemDirectoryHandle | null = null;
    /** the folder's access as last seen ('none': no folder chosen) */
    access: FolderAccess | 'none' = 'none';
    recorder: CinemaRecorder | null = null;
    /** the recording running was started by auto-record (its rules stop it) */
    autoRun = false;
    last: Saved | null = null;
    /** a start or stop is under way */
    busy = false;
    /** something the bar shows changed */
    onChange: () => void = () => {};
    /** the recording ended by itself (memory cap, disk full, access lost) */
    onEnded: (s: Saved) => void = () => {};
    readonly rules = new AutoRecordRules();
    /** test only (the hook): minutes per file instead of recording.splitMin */
    splitMinOverride: number | null = null;
    private paused = { flight: false, hidden: false };
    private offerUrls: string[] = [];
    private pending: Promise<unknown> = Promise.resolve();

    constructor(private readonly d: RecordingDeps) {}

    get supported(): boolean {
        return CinemaRecorder.supported;
    }

    /** A showcase scene (D34) in a browser that can encode video. */
    get allowed(): boolean {
        return this.d.scene().credit !== null && this.supported;
    }

    get canPick(): boolean {
        return folderPicker() !== null;
    }

    get autoOn(): boolean {
        return this.d.prefs.get<boolean>('recording.auto') === true;
    }

    setAuto(on: boolean): void {
        this.d.prefs.set('recording.auto', on);
        this.onChange();
    }

    get recording(): boolean {
        return !!this.recorder?.recording;
    }

    get seconds(): number {
        return this.recorder?.seconds ?? 0;
    }

    /** The folder named by recording.folder, from IndexedDB, and its access now. */
    async load(): Promise<void> {
        const named = this.d.prefs.get<FolderValue | null>('recording.folder');
        if (!named) return;
        try {
            const h = await (await kv()).get<FileSystemDirectoryHandle>('handles', FOLDER_KEY);
            if (!h || typeof h !== 'object' || h.kind !== 'directory') return;
            this.folder = h;
            this.access = await folderAccess(h);
        } catch {
            this.folder = null;
            this.access = 'none';
        }
        this.onChange();
    }

    /** Re-reads the access (Chrome revokes it after long background time): before every start, on return to the tab. */
    async refreshAccess(): Promise<FolderAccess | 'none'> {
        if (!this.folder) return (this.access = 'none');
        const a = await folderAccess(this.folder);
        if (a !== this.access) {
            this.access = a;
            this.onChange();
        }
        return a;
    }

    /** The OS folder picker; call it straight from a click (it needs the click's activation). */
    async pick(): Promise<boolean> {
        const picker = folderPicker();
        if (!picker) return false;
        let dir: FileSystemDirectoryHandle;
        try {
            dir = await picker({ id: 'gsfpv-rec', mode: 'readwrite', startIn: 'videos' });
        } catch {
            return false; // cancelled
        }
        await this.useFolder(dir);
        return true;
    }

    /** Makes `dir` the folder (the picker's result; the acceptance passes an OPFS folder the same way). */
    async useFolder(dir: FileSystemDirectoryHandle): Promise<void> {
        this.folder = dir;
        this.access = await folderAccess(dir);
        try {
            await (await kv()).put('handles', FOLDER_KEY, dir);
        } catch { /* kept for this page only */ }
        this.d.prefs.set('recording.folder', { name: dir.name });
        this.onChange();
    }

    async forget(): Promise<void> {
        this.folder = null;
        this.access = 'none';
        try {
            await (await kv()).delete('handles', FOLDER_KEY);
        } catch { /* nothing stored */ }
        this.d.prefs.reset('recording.folder');
        this.onChange();
    }

    /** "Allow saving to <folder>": asks for access; only inside a click or a key press. */
    async allow(): Promise<FolderAccess | 'none'> {
        if (!this.folder) return 'none';
        this.access = await askFolderAccess(this.folder);
        this.onChange();
        return this.access;
    }

    /** The place for the next file: the folder when writable (asking inside a click), else the browser, else memory. */
    private async target(activation: boolean): Promise<RecordTarget> {
        if (this.folder) {
            let a = await folderAccess(this.folder);
            if (a === 'prompt' && activation) a = await askFolderAccess(this.folder);
            this.access = a;
            if (a === 'granted') return folderTarget(this.folder);
        }
        return opfsTarget() ?? memoryTarget();
    }

    /**
     * Starts a recording at the quality as flown (cinema mode only raises it). `activation`: called
     * inside a click or a key press, so the folder's permission may be asked. `legacyV02`: test only,
     * the negative control (v0.2's 30 fps track).
     */
    async start(o: { auto: boolean; activation: boolean; legacyV02?: boolean }): Promise<string> {
        const scene = this.d.scene();
        if (scene.credit === null) throw new Error('recording is only for showcase scenes');
        if (!this.supported) throw new Error('WebCodecs unavailable');
        if (this.recorder?.recording || this.busy) return '';
        this.busy = true;
        this.onChange();
        try {
            const target = await this.target(o.activation);
            if (target.kind === 'browser') await pruneBrowserRecordings(KEEP_IN_BROWSER - 1);
            const fps = Number(this.d.prefs.get<string>('recording.fps')) === 30 ? 30 : 60;
            const res = this.d.prefs.get<RecResolution>('recording.resolution');
            const size = outputSize(this.d.canvas.width, this.d.canvas.height, res);
            const r = new CinemaRecorder({
                ...size,
                fps: fps as RecFps,
                credit: scene.credit,
                target,
                scene: scene.id,
                splitMin: this.splitMinOverride ?? this.d.prefs.get<number>('recording.splitMin'),
                capSeconds: target.kind === 'memory' ? MEMORY_CAP_S : undefined,
                legacyV02: o.legacyV02
            });
            const codec = await r.start();
            r.pause(this.paused.flight || this.paused.hidden);
            r.onEnded = (info) => {
                if (this.recorder === r) this.recorder = null;
                void this.finish(info, r.target).then((s) => this.onEnded(s));
            };
            this.recorder = r;
            this.autoRun = o.auto;
            return codec;
        } finally {
            this.busy = false;
            this.onChange();
        }
    }

    /** Stops and saves; the files to save by hand are in the result's offer. */
    async stop(): Promise<Saved | null> {
        const r = this.recorder;
        if (!r) return null;
        this.recorder = null;
        this.busy = true;
        this.rules.reset();
        this.onChange();
        try {
            return await this.finish(await r.stop(), r.target);
        } finally {
            this.busy = false;
            this.onChange();
        }
    }

    /** After stop: browser-storage files go on into the folder when it can be written now, the rest are offered. */
    private async finish(info: RecorderInfo, from: RecordTarget): Promise<Saved> {
        for (const u of this.offerUrls.splice(0)) URL.revokeObjectURL(u);
        const saved: Saved = { info, offer: [], moved: 0 };
        if (from.kind !== 'folder') {
            const canMove = from.kind === 'browser' && this.folder && (await this.refreshAccess()) === 'granted';
            for (const f of info.files) {
                if (canMove) {
                    try {
                        if (await moveRecording(from, f.name, folderTarget(this.folder!))) { saved.moved++; continue; }
                    } catch { /* offered below */ }
                }
                const blob = await from.file(f.name);
                if (!blob) continue;
                const url = URL.createObjectURL(blob);
                this.offerUrls.push(url);
                saved.offer.push({ name: f.name, url, bytes: blob.size });
            }
            if (saved.moved === info.files.length && saved.moved > 0) {
                saved.info = { ...info, where: 'folder', folder: this.folder?.name ?? '' };
            }
        }
        this.last = saved;
        return saved;
    }

    /** The engine drew a frame (same task): the recorder takes it. */
    frame(nowMs: number): void {
        const r = this.recorder;
        if (r?.recording) {
            r.addFrame(this.d.canvas, nowMs);
            this.strip = r.lastCreditStripStd;
        }
    }

    private strip = 0;
    /** Luminance spread of the credit strip in the last recording's frames (D34 acceptance: the credit is there). */
    get creditStripStd(): number {
        return this.strip;
    }

    /** Once per frame: a pending auto stop that is due. */
    tick(nowMs: number): void {
        if (this.rules.tick(nowMs) === 'stop' && this.recorder && this.autoRun) void this.queue(() => this.stop());
    }

    /** A flight event: auto-record starts at arm (only on a showcase scene, with Auto on). */
    onSim(e: AutoEvent, nowMs: number, activation: boolean): void {
        if (!this.autoOn || !this.allowed) return;
        const act = this.rules.onEvent(e, nowMs, this.d.autoRespawn());
        if (act === 'start' && !this.recorder && !this.busy) void this.queue(() => this.start({ auto: true, activation }).catch(() => ''));
    }

    /** Starts and stops one after another (an arm right after a stop must not race it). */
    queue<T>(fn: () => Promise<T>): Promise<T> {
        const p = this.pending.then(fn, fn);
        this.pending = p.catch(() => undefined);
        return p;
    }

    /** The flight is paused or the tab hidden: no frames pass, and none are counted as dropped. */
    pause(reason: 'flight' | 'hidden', on: boolean): void {
        this.paused[reason] = on;
        this.recorder?.pause(this.paused.flight || this.paused.hidden);
    }
}
