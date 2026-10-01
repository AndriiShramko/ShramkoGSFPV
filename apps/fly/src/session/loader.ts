// Loading a scan for a flight (split from v0.2's session.ts, behaviour unchanged): the walls
// download beside the scan with their bytes counted, the coarse level of the scan is watched until
// it is resident, and a progress report goes out every 100 ms until the first view is on screen.
import { sha256Hex } from '@gsfpv/sim-core';
import { fetchVoxelCollision, VoxelContactWorld, NoCollisionError } from '@gsfpv/collision';
import type { VoxelCollision } from '@gsfpv/collision';
import { cachedFetch } from '@gsfpv/scenes';
import type { ResolvedScene } from '@gsfpv/scenes';
import type { SplatRenderer, SplatBytes } from '@gsfpv/render-pc';

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
    /** the view was shown after REVEAL_STALL_MS of silence, not because the scan was in */
    partial: boolean;
    /** the scene's v<N> folder once its settings were found (a republished scene's poster lives there), else null */
    version: number | null;
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
/** no new byte and no change in the engine's streaming state for this long: show what there is */
const REVEAL_STALL_MS = 30000;

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

    /** Resolves when the coarse level is resident, or when loading has been silent for REVEAL_STALL_MS. */
    watchCoarse(): Promise<void> {
        if (!this.host.drawScan) return Promise.resolve().then(() => { this.coarseReady = true; });
        const renderer = this.host.renderer!;
        return new Promise<void>((resolve) => {
            const sys = renderer.app.systems.gsplat!;
            let streaming = false;
            let state = '';
            let changedAt = performance.now();
            const finish = (forced: boolean): void => {
                sys.off('frame:ready', handler);
                clearInterval(watchdog);
                this.coarseReady = true;
                this.coarseForced = forced;
                resolve();
            };
            const handler = (_cam: unknown, _layer: unknown, ready: boolean, loading: number): void => {
                const st = `${ready}/${loading}`;
                if (st !== state) {
                    state = st;
                    changedAt = performance.now();
                }
                // coarse level streamed in and fully resident -> reveal, then stream the detail
                if (loading > 0) streaming = true;
                if (ready && loading === 0 && streaming) finish(false);
            };
            sys.on('frame:ready', handler);
            // never block the pilot forever, but only on silence: a slow link that still delivers keeps going
            const watchdog = window.setInterval(() => {
                if (performance.now() - Math.max(changedAt, renderer.splatBytes().lastByteAt) > REVEAL_STALL_MS) finish(true);
            }, 1000);
        });
    }

    /** The first view is on screen: a last report, then the reports stop. */
    done(): void {
        this.loadDone = true;
        this.emit();
        this.stop();
    }

    stop(): void {
        clearInterval(this.progressTimer);
        this.progressTimer = 0;
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
            // undefined until resolveScene returns (the first reports come before it)
            version: this.host.scene?.version ?? null
        };
        this.lastProgress = p;
        try { this.onProgress(p); } catch (e) { console.error(e); }
    }
}
