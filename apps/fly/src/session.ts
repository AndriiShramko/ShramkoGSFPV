// One flight: scene + collision + physics + renderer, driven from the engine's update event.
import { Sim, Runner, InputLog, S, compileParams, hoverSolve, SIM_CORE_VERSION, sha256Hex, attitude, spherePoses, replay as replayLog } from '@gsfpv/sim-core';
import type { SimParams, ParamOverrides, SimEvent, LogHeader } from '@gsfpv/sim-core';
import { fetchVoxelCollision, VoxelContactWorld, findSphereSpawn, NoCollisionError, openVoxelCollision } from '@gsfpv/collision';
import type { VoxelCollision, VoxelMetadata } from '@gsfpv/collision';
import { resolveScene, headingFromCamera, cachedFetch } from '@gsfpv/scenes';
import type { ResolvedScene } from '@gsfpv/scenes';
import { SplatRenderer } from '@gsfpv/render-pc';
import type { SplatBytes } from '@gsfpv/render-pc';
import { PRESETS, DEFAULT_PRESET } from './presets';
import { SimClock } from './simclock';

export interface SessionOptions {
    sceneId: string;
    preset?: string;
    overrides?: ParamOverrides;
    latencyMarker?: boolean;
    lagFrames?: number;
    renderScale?: number;
    /** loading state every 100 ms until the first view is on screen */
    onProgress?: (p: LoadProgress) => void;
}

/** Who keeps the flight paused (FlightSession.pause). */
export type PauseHolder = 'menu' | 'controls' | 'bake';

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
function nextPaint(): Promise<void> {
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

export interface Timings {
    settingsMs: number;
    collisionMs: number | null;
    firstFrameMs: number | null;
    visibleMs: number | null;
}

interface ReplayState {
    sim: Sim;
    log: InputLog;
    rec: number;
    endTick: number;
    t0: number;
    startTick: number;
    ch: Float32Array;
}

export class FlightSession {
    renderer!: SplatRenderer;
    scene!: ResolvedScene;
    collision: VoxelCollision | null = null;
    collisionSha256: string | null = null;
    world: VoxelContactWorld | null = null;
    params!: SimParams;
    overrides: ParamOverrides = {};
    sim!: Sim;
    runner!: Runner;
    log!: InputLog;
    spawn: [number, number, number, number] = [0, 0, 0, 0];
    presetId = DEFAULT_PRESET;
    /** page clock -> sim clock (pauses, restarts, skipped stalls) and the inputs not yet stepped */
    readonly clock = new SimClock();
    frames = 0;
    timings: Timings = { settingsMs: 0, collisionMs: null, firstFrameMs: null, visibleMs: null };
    /** resolves when the streamed splats have been rendered (loading finished, splats on screen) */
    visible!: Promise<void>;
    crashes = 0;
    flightStartTick = 0;
    lagFrames = 0;
    private lagQueue: number[] = [];
    onFrame: ((s: FlightSession, dtMs: number) => void) | null = null;
    onEvent: ((e: SimEvent) => void) | null = null;
    private evIdx = 0;
    readonly createdAt = performance.now();
    private readonly holds = new Set<PauseHolder>();
    get paused(): boolean {
        return this.clock.paused;
    }
    /** when true the crash view owns the camera */
    cameraOverride = false;
    replayState: ReplayState | null = null;
    safePoint: [number, number, number, number] | null = null;
    private lastContactTick = -1e9;
    frameTimes: number[] = [];
    private onProgress: ((p: LoadProgress) => void) | null = null;
    private progressTimer = 0;
    private lastProgress: LoadProgress | null = null;
    private wallsBytes: WallsBytes | null = null;
    private coarseReady = false;
    private coarseForced = false;
    private loadDone = false;

    static async start(canvas: HTMLCanvasElement, o: SessionOptions): Promise<FlightSession> {
        const s = new FlightSession();
        if (o.onProgress) {
            s.onProgress = o.onProgress;
            s.progressTimer = window.setInterval(() => s.emitProgress(), PROGRESS_EVERY_MS);
            s.emitProgress();
        }
        try {
            await s.init(canvas, o);
        } catch (e) {
            s.stopProgress();
            // the render loop starts before the walls land: stop it, the page shows the error instead
            try { s.renderer?.destroy(); } catch { /* half-built */ }
            throw e;
        }
        return s;
    }

    private async init(canvas: HTMLCanvasElement, o: SessionOptions): Promise<void> {
        const tS = performance.now();
        this.scene = await resolveScene(o.sceneId);
        this.timings.settingsMs = performance.now() - tS;
        this.presetId = o.preset && PRESETS[o.preset] ? o.preset : DEFAULT_PRESET;
        this.overrides = o.overrides ?? {};
        this.params = compileParams(PRESETS[this.presetId], this.overrides);
        this.renderer = await SplatRenderer.create(canvas, { renderScale: o.renderScale ?? 1, hFovDeg: this.params.cameraFovDeg, latencyMarker: !!o.latencyMarker });
        this.renderer.setToneMapping(this.scene.tonemapping);
        this.renderer.setBackground(this.scene.background);
        const splatLoad = this.renderer.loadSplat(this.scene.contentUrl);
        // the walls download beside the scan, not before it: one slow host no longer holds up the other
        const walls = this.scene.collisionUrl ? this.loadWalls(this.scene.collisionUrl) : Promise.resolve();
        walls.catch(() => { /* awaited below; this only keeps an early failure from counting as unhandled */ });
        await splatLoad;
        // the chunks stream once the engine runs; until the flight model exists, look from the scan's camera
        const cam = this.scene.camera;
        if (cam) this.renderer.setCameraLookAt(cam.position[0], cam.position[1], cam.position[2], cam.target[0], cam.target[1], cam.target[2]);
        const coarse = this.watchCoarse();
        this.renderer.app.on('update', () => this.frame());
        this.renderer.app.on('frameend', () => {
            if (this.timings.firstFrameMs === null) this.timings.firstFrameMs = performance.now() - this.createdAt;
        });
        this.renderer.start();
        await walls;
        this.spawn = this.findSpawn();
        this.buildSim();
        this.lagFrames = o.lagFrames ?? 0;
        // on screen = coarse level resident and walls in; only then the detail streams (it would slow the walls)
        this.visible = coarse.then(() => {
            this.timings.visibleMs = performance.now() - this.createdAt;
            this.renderer.revealFullDetail();
            this.loadDone = true;
            this.emitProgress();
            this.stopProgress();
        });
    }

    /** Download and build the voxel walls, counting the .bin's bytes as they arrive. */
    private async loadWalls(url: string): Promise<void> {
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
            this.emitProgress();
            await nextPaint(); // "Building the walls" reaches the screen before the work below
            const both = new Uint8Array(fc.jsonBytes.length + fc.binBytes.length);
            both.set(fc.jsonBytes, 0);
            both.set(fc.binBytes, fc.jsonBytes.length);
            this.collisionSha256 = await sha256Async(both);
            this.collision = fc.collision;
            this.world = new VoxelContactWorld(fc.collision);
            this.timings.collisionMs = performance.now() - tC;
        } catch (e) {
            if (!(e instanceof NoCollisionError)) throw e;
        } finally {
            w.built = true;
        }
    }

    /** Resolves when the coarse level is resident, or when loading has been silent for REVEAL_STALL_MS. */
    private watchCoarse(): Promise<void> {
        return new Promise<void>((resolve) => {
            const sys = this.renderer.app.systems.gsplat!;
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
                if (performance.now() - Math.max(changedAt, this.renderer.splatBytes().lastByteAt) > REVEAL_STALL_MS) finish(true);
            }, 1000);
        });
    }

    private stageNow(sb: SplatBytes | null, w: WallsBytes | null): LoadStage {
        if (this.loadDone) return 'done';
        // the bar needs both totals: the walls' size is known from their json even before the .bin answers
        if (!sb?.listed || (w && !w.sized && !w.built && w.decoded === 0)) return 'connect';
        const scanIn = this.coarseReady || sb.complete; // after a forced reveal nothing more is awaited
        const wallsIn = !w || w.bodyDone || w.built;
        if (!scanIn || !wallsIn) return 'download';
        if (w && !w.built) return 'build';
        return 'prepare';
    }

    private emitProgress(): void {
        if (!this.onProgress) return;
        const sb = this.renderer ? this.renderer.splatBytes() : null;
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
            version: (this.scene as ResolvedScene | undefined)?.version ?? null
        };
        this.lastProgress = p;
        try { this.onProgress(p); } catch (e) { console.error(e); }
    }

    private stopProgress(): void {
        clearInterval(this.progressTimer);
        this.progressTimer = 0;
    }

    private findSpawn(): [number, number, number, number] {
        const cam = this.scene.camera;
        let pos: [number, number, number] = cam ? [...cam.position] : [0, 1.5, 0];
        const yaw = cam ? headingFromCamera(cam) : 0;
        if (this.collision) {
            const push = { x: 0, y: 0, z: 0 };
            const R = this.params.boundRadius + 0.03;
            if (this.collision.querySphere(pos[0], pos[1], pos[2], R, push)) {
                const out = { x: 0, y: 0, z: 0 };
                if (findSphereSpawn(this.collision, pos[0], pos[1], pos[2], R, out)) pos = [out.x, out.y, out.z];
            }
        }
        return [pos[0], pos[1], pos[2], yaw];
    }

    logHeader(): LogHeader {
        return {
            format: 'gsfpv-input-log/1',
            simCore: SIM_CORE_VERSION,
            preset: this.presetId,
            configHash: sha256Hex(new TextEncoder().encode(JSON.stringify({ o: this.overrides, p: this.presetId }))),
            collisionSha256: this.collisionSha256,
            spawn: this.spawn,
            seed: 0
        };
    }

    /** (Re)create the flight model at the spawn; sim time restarts at 0 with a fresh log. */
    private buildSim(): void {
        this.sim = new Sim(this.params, this.world);
        this.sim.reset(this.spawn[0], this.spawn[1], this.spawn[2], this.spawn[3]);
        this.sim.hoverThr = hoverSolve(this.params, 1).motor;
        this.log = new InputLog(this.logHeader());
        this.runner = new Runner(this.sim, this.log, true);
        this.runner.trajectory = [];
        // while paused (menu, settings, drone pick) sim time 0 is the moment the flight resumes
        this.clock.restart(performance.now());
        this.evIdx = 0;
        this.flightStartTick = 0;
        this.safePoint = null;
    }

    /** Change drone / physics settings: a new flight model at the same scene. */
    rebuildSim(presetId: string, overrides: ParamOverrides): void {
        this.presetId = PRESETS[presetId] ? presetId : DEFAULT_PRESET;
        this.overrides = overrides;
        this.params = compileParams(PRESETS[this.presetId], overrides);
        this.renderer.setFov(this.params.cameraFovDeg);
        this.buildSim();
    }

    /** page time (ms, performance.now() / event.timeStamp) -> sim microseconds */
    toSimUs(tMs: number): number {
        return this.clock.toSimUs(tMs);
    }

    /** Feed a channel frame from any input source (stamped on the sim clock when stepped). */
    input(ch: ArrayLike<number>, tMs: number, id?: number): void {
        if (!this.runner || this.paused || this.replayState) return;
        this.clock.push(ch, tMs, id);
    }

    /**
     * Pause or release on behalf of `who`; the flight runs when nobody holds it. The pause menu and
     * the panels it opens share 'menu' (a panel takes the menu's pause over); the Controls screen and
     * a bake hold their own, so closing one of them cannot start the flight under another.
     */
    pause(on: boolean, who: PauseHolder = 'menu'): void {
        if (on) this.holds.add(who);
        else this.holds.delete(who);
        this.clock.pause(this.holds.size > 0, performance.now());
    }

    private frame(): void {
        if (!this.runner) return; // the engine already streams the scan while the walls download
        const now = performance.now();
        this.frameTimes.push(now);
        if (this.frameTimes.length > 600) this.frameTimes.shift();
        if (this.replayState) {
            this.replayFrame(now);
            this.frames++;
            this.onFrame?.(this, 0);
            return;
        }
        this.clock.advance(this.runner, now); // nothing while paused
        for (; this.evIdx < this.runner.events.length; this.evIdx++) {
            const e = this.runner.events[this.evIdx];
            if (e.type === 'crash') this.crashes++;
            if (e.type === 'contact' || e.type === 'crash') this.lastContactTick = e.tick;
            this.onEvent?.(e);
        }
        if (this.runner.events.length > 2048) {
            this.runner.events.splice(0, this.evIdx);
            this.evIdx = 0;
        }
        this.trackSafePoint();
        if (!this.cameraOverride) {
            const s = this.sim.s;
            const frac = this.paused ? 0 : Math.max(0, Math.min(0.001, (this.toSimUs(now) - this.sim.tick * 1000) / 1e6));
            this.renderer.setPose(s[S.px] + s[S.vx] * frac, s[S.py] + s[S.vy] * frac, s[S.pz] + s[S.vz] * frac, s[S.qw], s[S.qx], s[S.qy], s[S.qz], this.params.cameraUptiltDeg);
        }
        if (this.lagFrames > 0) {
            this.lagQueue.push(this.runner.lastAppliedId);
            while (this.lagQueue.length > this.lagFrames + 1) this.lagQueue.shift();
            this.renderer.setMarker(this.lagQueue[0]);
        } else {
            this.renderer.setMarker(this.runner.lastAppliedId);
        }
        this.frames++;
        this.onFrame?.(this, 0);
    }

    /** Remember a pose we can respawn at: armed, flying, no contact for 0.5 s, body clear with margin. */
    private trackSafePoint(): void {
        const s = this.sim.s;
        if (this.sim.tick % 500 !== 0 || s[S.armed] === 0 || s[S.crashed] > 0 || this.sim.tick - this.lastContactTick < 500) return;
        if (this.collision) {
            const push = { x: 0, y: 0, z: 0 };
            if (this.collision.querySphere(s[S.px], s[S.py], s[S.pz], this.params.boundRadius + 0.05, push)) return;
            if (!this.collision.isFreeAt(s[S.px], s[S.py], s[S.pz])) return;
        }
        this.safePoint = [s[S.px], s[S.py], s[S.pz], attitude(s).yaw];
    }

    respawn(fromSafePoint = false): void {
        const p = fromSafePoint && this.safePoint ? this.safePoint : this.spawn;
        this.runner.respawn(p[0], p[1], p[2], p[3]);
        this.flightStartTick = this.sim.tick;
    }

    /**
     * Is the respawn point clear: does the craft's bounding sphere touch no wall? Inside the voxel
     * grid this agrees with isFreeAt; above a scan (an authored camera high up) isFreeAt says "no
     * data" although there is only air, so the body test is the one that answers the question.
     */
    spawnIsFree(p: [number, number, number, number] = this.spawn): boolean {
        if (!this.collision) return true;
        const push = { x: 0, y: 0, z: 0 };
        return !this.collision.querySphere(p[0], p[1], p[2], this.params.boundRadius + 0.01, push);
    }

    /**
     * Collision baked in this tab (phase C): swap it in, rebuild the model on it and move the
     * spawn out of any wall. The input log restarts, because a replay needs the same collision.
     */
    installCollision(json: Uint8Array, bin: Uint8Array): void {
        const metadata = JSON.parse(new TextDecoder().decode(json)) as VoxelMetadata;
        this.collision = openVoxelCollision(metadata, bin);
        const both = new Uint8Array(json.length + bin.length);
        both.set(json, 0);
        both.set(bin, json.length);
        this.collisionSha256 = sha256Hex(both);
        this.world = new VoxelContactWorld(this.collision);
        if (!this.spawnIsFree()) this.spawn = this.findSpawn();
        this.rebuildSim(this.presetId, this.overrides);
    }

    // ------------------------------------------------------------------ replay (input log only)

    /** Replay the flight from its input log: fast-forward to `fromTick`, then play in real time. */
    startReplay(log: InputLog, fromTick: number, toTick: number): boolean {
        const h = log.header;
        if (h.simCore !== SIM_CORE_VERSION || h.collisionSha256 !== this.collisionSha256) return false;
        const sim = new Sim(this.params, this.world);
        sim.reset(h.spawn[0], h.spawn[1], h.spawn[2], h.spawn[3]);
        const st: ReplayState = { sim, log, rec: 0, endTick: toTick, t0: 0, startTick: Math.max(0, fromTick), ch: new Float32Array(8) };
        this.replayStep(st, st.startTick);
        st.t0 = performance.now();
        this.replayState = st;
        return true;
    }

    private replayStep(st: ReplayState, untilTick: number): void {
        const ch = st.ch;
        while (st.sim.tick < untilTick && st.sim.tick < st.endTick) {
            const tickT = (st.sim.tick + 1) * 1000;
            while (st.rec < st.log.count) {
                const t = st.log.record(st.rec, ch);
                if (t > tickT) break;
                if ((t & 1) === 1) st.sim.respawn(ch[0], ch[1], ch[2], ch[3]);
                else st.sim.setChannels(ch);
                st.rec++;
            }
            st.sim.step();
        }
    }

    private replayFrame(now: number): void {
        const st = this.replayState!;
        const target = st.startTick + Math.floor(now - st.t0);
        this.replayStep(st, target);
        const s = st.sim.s;
        if (!this.cameraOverride) this.renderer.setPose(s[S.px], s[S.py], s[S.pz], s[S.qw], s[S.qx], s[S.qy], s[S.qz], this.params.cameraUptiltDeg);
        if (st.sim.tick >= st.endTick) this.replayState = null;
    }

    stopReplay(): void {
        this.replayState = null;
    }

    /** Hash of a full replay of a log (for verification in a fresh tab). */
    replayHash(log: InputLog, endTick: number): string {
        const h = log.header;
        const sim = new Sim(this.params, this.world);
        sim.reset(h.spawn[0], h.spawn[1], h.spawn[2], h.spawn[3]);
        return replayLog(sim, log, endTick);
    }

    /** Replay a log and sample the position every `every` ticks (B15: divergence of a tampered log). */
    replayTrack(log: InputLog, endTick: number, every = 100): { hash: string; track: number[] } {
        const h = log.header;
        const sim = new Sim(this.params, this.world);
        sim.reset(h.spawn[0], h.spawn[1], h.spawn[2], h.spawn[3]);
        const track: number[] = [];
        const hash = replayLog(sim, log, endTick, (x) => { if (x.tick % every === 0) track.push(x.s[S.px], x.s[S.py], x.s[S.pz]); });
        return { hash, track };
    }

    // ------------------------------------------------------------------ self-tests used by acceptance

    /**
     * Thrust-to-weight measured in the model like on a thrust stand: level, full throttle, the craft
     * held in place while the motors spin up (so drag does not enter), then released for 20 ms;
     * (a + g) / g. Battery sag under load stays in, as on a real stand.
     */
    measureTwr(): number {
        const sim = new Sim(this.params, null);
        sim.reset(0, 100, 0, 0);
        const ch = new Float32Array([0, 0, -1, 0, -1, 1, 0, 0]);
        sim.setChannels(ch); sim.step();
        ch[4] = 1; sim.setChannels(ch); sim.step();
        ch[2] = 1; sim.setChannels(ch);
        const hold = () => { sim.s[S.px] = 0; sim.s[S.py] = 100; sim.s[S.pz] = 0; sim.s[S.vx] = 0; sim.s[S.vy] = 0; sim.s[S.vz] = 0; };
        for (let i = 0; i < 300; i++) { sim.step(); hold(); }
        for (let i = 0; i < 20; i++) sim.step();
        const a = sim.s[S.vy] / 0.02;
        return (a + this.params.gravity) / this.params.gravity;
    }

    /** Disarmed drop from the spawn: mean downward acceleration until contact or 0.5 s. */
    dropTest(): { g: number; measured: number; fallM: number } {
        const sim = new Sim(this.params, this.world);
        sim.reset(this.spawn[0], this.spawn[1], this.spawn[2], this.spawn[3]);
        const ch = new Float32Array([0, 0, -1, 0, -1, 0, 0, 0]);
        sim.setChannels(ch); sim.step();
        ch[4] = 1; sim.setChannels(ch); sim.step(); // arm releases the parked craft
        ch[4] = -1; sim.setChannels(ch); sim.step(); // disarm: motors off, free fall
        const y0 = sim.s[S.py], v0 = sim.s[S.vy];
        let n = 0;
        for (; n < 500; n++) {
            const before = sim.events.length;
            sim.step();
            if (sim.events.slice(before).some((e) => e.type === 'contact' || e.type === 'crash')) break;
        }
        const tt = n / 1000;
        const fall = y0 - sim.s[S.py];
        // s = v0 t + a t^2 / 2 (downwards positive)
        const measured = tt > 0.05 ? (2 * (fall + v0 * tt)) / (tt * tt) : NaN;
        return { g: this.params.gravity, measured, fallM: fall };
    }

    /**
     * In-browser tunnelling check through the live flight model: the craft is launched at `speed`
     * towards walls; an oracle (upstream querySphere) resamples every tick's path every voxel/4.
     */
    tunnelSelfTest(passes: number, speed: number, seed = 1): { passes: number; speed: number; contacts: number; penetrations: number } {
        const col = this.collision;
        if (!col) return { passes: 0, speed, contacts: 0, penetrations: 0 };
        let a = seed >>> 0;
        const rng = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
        const p = this.params;
        const n = p.spheres.length / 4;
        const push = { x: 0, y: 0, z: 0 };
        const c0 = new Float64Array(n * 3), c1 = new Float64Array(n * 3), tmp = new Float64Array(n * 3);
        const step = col.voxelResolution / 4;
        let done = 0, contacts = 0, penetrations = 0, tries = 0;
        // near the spawn first; if walls are not within reach there, anywhere inside the voxel grid
        const g0 = [col.gridMinX, col.gridMinY, col.gridMinZ];
        const gs = [col.numVoxelsX * col.voxelResolution, col.numVoxelsY * col.voxelResolution, col.numVoxelsZ * col.voxelResolution];
        while (done < passes && tries < passes * 400) {
            tries++;
            const wide = tries > passes * 50;
            let ox = wide ? g0[0] + rng() * gs[0] : this.spawn[0] + (rng() - 0.5) * 6;
            let oy = wide ? g0[1] + rng() * gs[1] : this.spawn[1] + (rng() - 0.5) * 2;
            let oz = wide ? g0[2] + rng() * gs[2] : this.spawn[2] + (rng() - 0.5) * 6;
            if (wide && !col.isFreeAt(ox, oy, oz)) continue;
            if (col.querySphere(ox, oy, oz, p.boundRadius + 0.05, push)) continue;
            const ang = rng() * Math.PI * 2;
            const dx = Math.cos(ang), dz = Math.sin(ang), dy = (rng() - 0.5) * 0.4;
            const dl = Math.hypot(dx, dy, dz);
            // wide search: look further for a surface and start 0.5..3 m in front of it (as the A5 harness does)
            const hit = col.queryRay(ox, oy, oz, dx / dl, dy / dl, dz / dl, wide ? 30 : 6);
            if (!hit) continue;
            if (wide) {
                const back = Math.min(Math.hypot(hit.x - ox, hit.y - oy, hit.z - oz), 0.5 + rng() * 2.5);
                ox = hit.x - (dx / dl) * back; oy = hit.y - (dy / dl) * back; oz = hit.z - (dz / dl) * back;
                if (col.querySphere(ox, oy, oz, p.boundRadius + 0.05, push)) continue;
            }
            const sim = new Sim(p, this.world);
            sim.reset(ox, oy, oz, (ang * 180) / Math.PI);
            sim.s[S.hold] = 0;
            sim.s[S.vx] = (dx / dl) * speed; sim.s[S.vy] = (dy / dl) * speed; sim.s[S.vz] = (dz / dl) * speed;
            let hitWall = false;
            for (let k = 0; k < 2000 && !hitWall; k++) {
                const s = sim.s;
                spherePoses(p.spheres, n, s[S.px], s[S.py], s[S.pz], s[S.qw], s[S.qx], s[S.qy], s[S.qz], c0);
                const before = sim.events.length;
                sim.step();
                spherePoses(p.spheres, n, s[S.px], s[S.py], s[S.pz], s[S.qw], s[S.qx], s[S.qy], s[S.qz], c1);
                // oracle: resample every sphere's path during this tick
                for (let i = 0; i < n; i++) {
                    const L = Math.hypot(c1[i * 3] - c0[i * 3], c1[i * 3 + 1] - c0[i * 3 + 1], c1[i * 3 + 2] - c0[i * 3 + 2]);
                    const m = Math.max(1, Math.ceil(L / step));
                    for (let j = 0; j <= m; j++) {
                        const f = j / m;
                        tmp[0] = c0[i * 3] + (c1[i * 3] - c0[i * 3]) * f;
                        tmp[1] = c0[i * 3 + 1] + (c1[i * 3 + 1] - c0[i * 3 + 1]) * f;
                        tmp[2] = c0[i * 3 + 2] + (c1[i * 3 + 2] - c0[i * 3 + 2]) * f;
                        if (col.querySphere(tmp[0], tmp[1], tmp[2], p.spheres[i * 4 + 3], push)) { penetrations++; j = m + 1; i = n; }
                    }
                }
                if (sim.events.slice(before).some((e) => e.type === 'crash' || e.type === 'contact')) { hitWall = true; contacts++; }
            }
            done++;
        }
        return { passes: done, speed, contacts, penetrations };
    }

    /** HUD numbers */
    hud(): { armed: boolean; crashed: boolean; throttlePct: number; speed: number; altitude: number; timeS: number; crashes: number; volts: number; roll: number; pitch: number } {
        const sim = this.replayState ? this.replayState.sim : this.sim;
        const s = sim.s;
        const a = attitude(s);
        return {
            armed: s[S.armed] > 0,
            crashed: s[S.crashed] > 0,
            throttlePct: Math.round(((sim.ch[2] + 1) / 2) * 100),
            speed: Math.hypot(s[S.vx], s[S.vy], s[S.vz]),
            altitude: s[S.py] - this.spawn[1],
            timeS: (sim.tick - this.flightStartTick) / 1000,
            crashes: this.crashes,
            volts: s[S.volt],
            roll: a.roll,
            pitch: a.pitch
        };
    }

    frameStats(): { p50: number; p99: number; hz: number } {
        const f = this.frameTimes;
        const d = f.slice(1).map((t, i) => t - f[i]).sort((x, y) => x - y);
        if (d.length === 0) return { p50: NaN, p99: NaN, hz: NaN };
        const p50 = d[d.length >> 1];
        return { p50, p99: d[Math.floor(0.99 * (d.length - 1))], hz: 1000 / p50 };
    }
}
