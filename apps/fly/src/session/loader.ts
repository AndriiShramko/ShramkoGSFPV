// Loading a scan for a flight (split from v0.2's session.ts): the walls download beside the scan with
// their bytes counted, the first view of the scan (its coarse level, or the whole of a single file) is
// watched until it is drawable (reveal.ts: when, and why), and a progress report goes out every 100 ms
// until the first view is on screen, with what the view waits for while it is prepared.
import { sha256Hex } from '@gsfpv/sim-core';
import { fetchVoxelCollision, VoxelContactWorld, NoCollisionError } from '@gsfpv/collision';
import type { VoxelCollision } from '@gsfpv/collision';
import { cachedFetch } from '@gsfpv/scenes';
import type { ResolvedScene } from '@gsfpv/scenes';
import type { SplatRenderer, SplatBytes } from '@gsfpv/render-pc';
import { RevealWatch } from './reveal';
import type { FlyNow, RevealReason } from './reveal';

/** connect: scene settings, GPU, file lists; download: bytes; build: walls from bytes; prepare: first frame */
export type LoadStage = 'connect' | 'download' | 'build' | 'prepare' | 'done';
const STAGES: LoadStage[] = ['connect', 'download', 'build', 'prepare', 'done'];

/** One of the two downloads of the first view, in network bytes where the server says them. */
export interface LoadPart {
    loaded: number;
    total: number;
    /** `total` is the server's number, not an estimate */
    exact: boolean;
    /** in and usable */
    done: boolean;
    /** the server answered "not modified": this browser already has it */
    cached?: boolean;
}

export interface LoadProgress {
    stage: LoadStage;
    /** bytes of everything the first view needs: the scan's coarse level and the walls */
    loaded: number;
    total: number;
    exact: boolean;
    /** loaded / total, never below an earlier report (estimated totals move) */
    fraction: number;
    scan: LoadPart;
    /** null: no walls (yet known) for this scene */
    walls: LoadPart | null;
    /** performance.now() of the last byte of either download, 0 before the first */
    lastByteAt: number;
    /** scan images the engine gave up on */
    failed: number;
    /** the view was shown before the first view's files were all in (the pilot's Fly now, or REVEAL_STALL_MS of silence) */
    partial: boolean;
    /** the first view as the engine has it (render-pc FirstView), null before the scan is opened or with no scan drawn */
    view: LoadView | null;
    /** why the view was shown ('done' only; reveal.ts) */
    reveal: RevealReason | null;
    /** ms until the view is shown anyway (reveal.ts SETTLE_MS), null when no such bound runs */
    revealInMs: number | null;
    /** something of the scan is drawn and the wait has lasted long enough: the card offers Fly now */
    canFlyNow: boolean;
    /** the scene's v<N> folder once its settings were found (a republished scene's poster lives there), else null */
    version: number | null;
}

/** The first view while it is prepared: what the loading card shows so the wait never looks frozen. */
export interface LoadView {
    /** files of the first view (the coarse level and the environment of a streamed scan; 1 for a single file) */
    files: number;
    /** of those, the files whose bytes are all in */
    filesIn: number;
    /** splats of the first view (0: not known) */
    splats: number;
    /** splats the engine drew in the last frame */
    drawn: number;
    /** files the engine is still loading */
    loading: number;
}

interface WallsBytes {
    /** decoded bytes of the .bin read so far */
    got: number;
    /** decoded size of the .bin: 4 bytes per node and leaf word (scene.voxel.json) */
    decoded: number;
    /** Content-Length of the .bin: the compressed size on the wire */
    netTotal: number;
    /** the .bin's response headers are in */
    sized: boolean;
    cached: boolean;
    bodyDone: boolean;
    built: boolean;
    lastByteAt: number;
}

const PROGRESS_EVERY_MS = 100;
/** how often the first view is checked when the engine draws no frames (a hidden tab) */
const WATCH_EVERY_MS = 250;

/** Resolves after the next paint, or after 50 ms when no frames come (background tab). */
export function nextPaint(): Promise<void> {
    return new Promise((resolve) => {
        requestAnimationFrame(() => setTimeout(resolve, 0));
        setTimeout(resolve, 50);
    });
}

/** Same digest as sha256Hex, computed off the main thread where WebCrypto exists (19 MB: ~200 ms less jank). */
async function sha256Async(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) return sha256Hex(bytes);
    const d = new Uint8Array(await subtle.digest('SHA-256', bytes));
    let s = '';
    for (let i = 0; i < d.length; i++) s += d[i].toString(16).padStart(2, '0');
    return s;
}

/** The walls of a scan once built: the collision, its contact world, the digest of json + bin. */
export interface LoadedWalls {
    collision: VoxelCollision;
    world: VoxelContactWorld;
    sha256: string;
    ms: number;
}

/** What the loader reads of the session it loads for. */
export interface LoaderHost {
    readonly renderer: SplatRenderer | undefined;
    readonly scene: ResolvedScene | undefined;
    /** the scan is drawn (false: ?render=off) */
    readonly drawScan: boolean;
}

export class SessionLoader {
    private readonly host: LoaderHost;
    private readonly onProgress: ((p: LoadProgress) => void) | null;
    private progressTimer = 0;
    private lastProgress: LoadProgress | null = null;
    private wallsBytes: WallsBytes | null = null;
    private coarseReady = false;
    private coarseForced = false;
    private loadDone = false;
    /** the first view's watch while it runs (watchCoarse) */
    private watch: RevealWatch | null = null;
    private reveal: RevealReason | null = null;
    private stopWatch: (() => void) | null = null;

    constructor(host: LoaderHost, onProgress?: (p: LoadProgress) => void) {
        this.host = host;
        this.onProgress = onProgress ?? null;
        if (this.onProgress) {
            this.progressTimer = window.setInterval(() => this.emit(), PROGRESS_EVERY_MS);
            this.emit();
        }
    }

    /** Download and build the voxel walls, counting the .bin's bytes as they arrive; null: the scan has none. */
    async loadWalls(url: string): Promise<LoadedWalls | null> {
        const w: WallsBytes = { got: 0, decoded: 0, netTotal: 0, sized: false, cached: false, bodyDone: false, built: false, lastByteAt: 0 };
        this.wallsBytes = w;
        const tC = performance.now();
        const net = async (u: string, init?: RequestInit): Promise<Response> => {
            const r = await fetch(u, init);
            if (!u.endsWith('.voxel.bin')) return r;
            if (r.status === 304) {
                w.cached = true;
                w.sized = true;
                return r;
            }
            if (!r.ok || !r.body) return r;
            w.netTotal = Number(r.headers.get('content-length')) || 0;
            w.sized = true;
            const counted = r.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
                transform(chunk, ctl) {
                    w.got += chunk.byteLength;
                    w.lastByteAt = performance.now();
                    ctl.enqueue(chunk);
                }
            }));
            // the stream is already decoded: the compressed Content-Length would not describe it
            const headers = new Headers(r.headers);
            headers.delete('content-length');
            return new Response(counted, { status: r.status, statusText: r.statusText, headers });
        };
        // Cache Storage + ETag: a second visit gets "not modified" instead of 10 MB again
        const get = async (u: RequestInfo | URL): Promise<Response> => {
            const s = String(u);
            const r = await cachedFetch(s, net);
            if (s.endsWith('.voxel.json') && r.ok) {
                try {
                    const m = (await r.clone().json()) as { nodeCount?: number; leafDataCount?: number };
                    w.decoded = 4 * ((m.nodeCount ?? 0) + (m.leafDataCount ?? 0));
                } catch { /* fetchVoxelCollision reports a broken file */ }
            }
            return r;
        };
        try {
            const fc = await fetchVoxelCollision(url, get);
            w.bodyDone = true;
            this.emit();
            await nextPaint(); // "Building the walls" reaches the screen before the work below
            const both = new Uint8Array(fc.jsonBytes.length + fc.binBytes.length);
            both.set(fc.jsonBytes, 0);
            both.set(fc.binBytes, fc.jsonBytes.length);
            const sha256 = await sha256Async(both);
            return { collision: fc.collision, world: new VoxelContactWorld(fc.collision), sha256, ms: performance.now() - tC };
        } catch (e) {
            if (!(e instanceof NoCollisionError)) throw e;
            return null;
        } finally {
            w.built = true;
        }
    }

    /**
     * Resolves, with the reason (reveal.ts), when the first view is drawable: its files are in and the
     * engine drew it, or the bound after that, or the pilot's Fly now, or REVEAL_STALL_MS of silence.
     * Read from the state each frame (the gsplat 'frame:ready') and every WATCH_EVERY_MS (no frames in a
     * hidden tab), so a single file, a streamed scan, the browser's cache and an in-page switch on the
     * page's renderer are all the same case. stop() ends the watch (the session was disposed).
     */
    watchCoarse(flyNow?: FlyNow): Promise<RevealReason> {
        if (!this.host.drawScan) return Promise.resolve().then(() => { this.coarseReady = true; this.reveal = 'ready'; return 'ready' as const; });
        const renderer = this.host.renderer!;
        return new Promise<RevealReason>((resolve) => {
            const sys = renderer.app.systems.gsplat!;
            const watch = new RevealWatch(performance.now());
            this.watch = watch;
            let pilot = false;
            let done = false;
            const finish = (why: RevealReason): void => {
                if (done) return;
                done = true;
                off();
                const sb = renderer.splatBytes();
                this.coarseReady = true;
                this.coarseForced = (why === 'pilot' || why === 'stall') && !(sb.listed && sb.complete);
                this.reveal = why;
                resolve(why);
            };
            const check = (): void => {
                const v = renderer.firstView();
                const why = watch.step({ ...v, lastByteAt: Math.max(v.lastByteAt, this.wallsBytes?.lastByteAt ?? 0) }, performance.now(), pilot);
                if (why) finish(why);
            };
            const handler = (): void => check();
            sys.on('frame:ready', handler);
            const timer = window.setInterval(check, WATCH_EVERY_MS);
            const off = (): void => {
                sys.off('frame:ready', handler);
                clearInterval(timer);
                this.watch = null;
                this.stopWatch = null;
            };
            this.stopWatch = off;
            flyNow?.bind(() => { pilot = true; check(); });
            check();
        });
    }

    /** The first view is on screen: a last report, then the reports stop. */
    done(): void {
        this.loadDone = true;
        this.emit();
        this.stop();
    }

    /** The reports and the first view's watch stop (the view is shown, or the session was disposed). */
    stop(): void {
        clearInterval(this.progressTimer);
        this.progressTimer = 0;
        this.stopWatch?.();
    }

    private stageNow(sb: SplatBytes | null, w: WallsBytes | null): LoadStage {
        if (this.loadDone) return 'done';
        const draw = this.host.drawScan;
        // the bar needs both totals: the walls' size is known from their json even before the .bin answers
        if ((draw ? !sb?.listed : !sb) || (w && !w.sized && !w.built && w.decoded === 0)) return 'connect';
        // after a forced reveal nothing more is awaited; logic-only (?render=off) awaits no scan at all
        const scanIn = !draw || this.coarseReady || !!sb?.complete;
        const wallsIn = !w || w.bodyDone || w.built;
        if (!scanIn || !wallsIn) return 'download';
        if (w && !w.built) return 'build';
        return 'prepare';
    }

    emit(): void {
        if (!this.onProgress) return;
        const sb = this.host.renderer ? this.host.renderer.splatBytes() : null;
        const w = this.wallsBytes;
        const scan: LoadPart = { loaded: sb?.received ?? 0, total: sb?.total ?? 0, exact: !!sb?.exact, done: !!sb?.complete || (this.coarseReady && !this.coarseForced) };
        let walls: LoadPart | null = null;
        if (w) {
            // the body arrives decoded: its share of the compressed size is what the network carried
            const total = w.cached ? 0 : w.netTotal > 0 ? w.netTotal : w.decoded;
            const loaded = w.cached ? 0 : w.netTotal > 0 && w.decoded > 0 ? Math.min(w.netTotal, (w.got / w.decoded) * w.netTotal) : w.got;
            walls = { loaded, total: Math.max(total, loaded), exact: w.cached || (w.sized && (w.netTotal > 0 || w.decoded > 0)), done: w.built, cached: w.cached };
        }
        // the first view as the engine has it, once the scan is opened (while it is prepared the card shows it)
        const fv = sb && this.host.drawScan && sb.listed ? this.host.renderer!.firstView() : null;
        const view: LoadView | null = fv ? { files: fv.files, filesIn: fv.filesIn, splats: fv.splats, drawn: fv.drawn, loading: fv.loading } : null;
        const now = performance.now();
        const prev = this.lastProgress;
        let stage = this.stageNow(sb, w);
        if (prev && STAGES.indexOf(prev.stage) > STAGES.indexOf(stage)) stage = prev.stage;
        const loaded = Math.max(prev?.loaded ?? 0, scan.loaded + (walls?.loaded ?? 0));
        const total = Math.max(loaded, scan.total + (walls?.total ?? 0));
        const raw = stage === 'done' && !this.coarseForced ? 1 : stage === 'connect' || total <= 0 ? 0 : loaded / total;
        const p: LoadProgress = {
            stage,
            loaded,
            total,
            exact: scan.exact && (walls?.exact ?? true),
            fraction: Math.max(prev?.fraction ?? 0, raw),
            scan,
            walls,
            lastByteAt: Math.max(sb?.lastByteAt ?? 0, w?.lastByteAt ?? 0),
            failed: sb?.failed ?? 0,
            partial: this.coarseForced,
            view,
            reveal: this.loadDone ? this.reveal : null,
            revealInMs: this.watch ? this.watch.revealInMs(now) : null,
            // only where the walls are in (the flight needs them): the view is all that is left to wait for
            canFlyNow: !this.loadDone && !!fv && !!this.watch && (!w || w.built) && this.watch.canFlyNow({ ...fv }, now),
            // undefined until resolveScene returns (the first reports come before it)
            version: this.host.scene?.version ?? null
        };
        this.lastProgress = p;
        try { this.onProgress(p); } catch (e) { console.error(e); }
    }
}
