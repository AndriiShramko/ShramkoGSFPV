// One flight: scene + collision + physics + renderer, driven from the engine's update event.
// Split from v0.2's session.ts (v0.3 W2-2): loading in loader.ts, replays in replay.ts, the
// acceptance self-tests in selftest.ts; the flight model lives here.
//
// The flight model runs on the lives runner (log format /3, /2 still replays; docs/architecture-v03.md
// C.9, docs/wip/v07-e.md section 3): a life
// starts at the first spawn, at every respawn and at every change of a 'life' setting, and each
// life's header carries its params, walls and start state, so it replays on its own. Respawns
// are decided by the RespawnDirector inside the runner's step loop (C.6: after a crash, when stuck,
// R and Y), so every respawn is a log record and lands on the same tick at any frame split.
import { Sim, Runner, S, compileParams, SIM_CORE_VERSION, sha256Hex, attitude, FlightStats, RespawnDirector, StateHistory, DEFAULT_RESPAWN_POLICY, hoverStickOf, makeLifeHeader, WIND_SEED_MAX } from '@gsfpv/sim-core';
import type { SimParams, ParamOverrides, SimEvent, Life, LifeHeader, RespawnOpts, RespawnPolicy, RespawnReason, WindConfig } from '@gsfpv/sim-core';
import { VoxelContactWorld, findSphereSpawn, openVoxelCollision } from '@gsfpv/collision';
import { validCeiling, validMinBlocks } from '@gsfpv/collision';
import type { FloaterFilter, VoxelCollision, VoxelMetadata } from '@gsfpv/collision';
import { resolveScene, headingFromCamera, noContentError } from '@gsfpv/scenes';
import type { ContentAttempt, ResolvedScene } from '@gsfpv/scenes';
import { BrokenFileError, SplatRenderer, drawOnDevice } from '@gsfpv/render-pc';
import type { DrawingChoice } from '@gsfpv/render-pc';
import { PRESETS, DEFAULT_PRESET } from '../presets';
import { SimClock } from '../simclock';
import { assertWalls } from '../bake';
import { wallsState } from '../flightwalls';
import type { WallsState } from '../flightwalls';
import { SessionLoader } from './loader';
import type { LoadProgress } from './loader';
import { LivesPlayer, lifeProblem } from './replay';
import type { WallsSource } from './replay';
import { measureTwr, dropTest, tunnelSelfTest } from './selftest';
import { IDENTITY, f32, filteredWalls, isIdentity, packed, pointMap, pushOut, sameTransform, scaledCollision, sceneWalls } from './world';
import type { SceneTransform } from './world';
import type { WindSpec } from './wind-source';

export type { LoadStage, LoadPart, LoadProgress } from './loader';

export interface SessionOptions {
    sceneId: string;
    preset?: string;
    overrides?: ParamOverrides;
    latencyMarker?: boolean;
    lagFrames?: number;
    renderScale?: number;
    /** fly with the scan's walls (default) or through everything (flightwalls.ts) */
    wallsOn?: boolean;
    /**
     * false: the logic-only test mode (?render=off, app/flight.ts): the scan is never downloaded
     * or drawn; walls, flight model, input, HUD, crash handling and the test hook run as usual, and
     * the engine only clears the frame. For machines without a GPU (the cloud); never a visual check.
     */
    drawScan?: boolean;
    /** loading state every 100 ms until the first view is on screen */
    onProgress?: (p: LoadProgress) => void;
    /**
     * In-page scene switching (E.4): the page's renderer, kept from the first scene. The session
     * draws with it and never starts or destroys it; dispose() only unloads this scene's splats.
     */
    renderer?: SplatRenderer;
    /** start paused (the scene host holds the flight until the new scene is on screen) */
    paused?: boolean;
    /** the respawn rules and crash.enabled the first flight model is built with (a scene switch carries the page's) */
    policy?: RespawnPolicy;
    crashOn?: boolean;
    /**
     * C.4 'scene': the first life starts as a scene switch, on the platform, with these channels
     * applied (they are in the life's header, so it replays): the arm switch still on keeps it armed
     * when the rules keep it (respawn.keepArmed).
     */
    sceneStart?: { ch: ArrayLike<number> };
    /** the scene's size (E.7, prefs scene.transform): T(w) = s*w + t from the first frame; none = the scan as it is */
    transform?: { s: number; t: readonly number[]; v?: number } | null;
    /** the floater filter (G.3, prefs scene.dropFloaters): pieces of the walls under N blocks dropped; 0 or none = off */
    dropFloaters?: number;
    /**
     * How the scan is drawn from its first frame (v0.7 lane R, app/drawing.ts drawingFor): SuperSplat's
     * stochastic drawing and the splat budget, millions. Asked with the renderer's real device (true =
     * WebGPU) once the renderer exists, and written to it before the scan loads, so it streams with the
     * budget this device gets (render-pc drawOnDevice); none = the renderer's default (sorted, 4 M).
     */
    drawing?: (webgpu: boolean) => DrawingChoice;
    /** the collision ceiling (v0.7, prefs scene.ceiling): no walls at or above this height in the scan's own coordinates; null or none = off */
    ceilingM?: number | null;
    /**
     * the wind (v0.7, app/builtin/wind.ts windFor): awaited with the walls, so the first life already
     * flies in it (the live wind's request runs while the scan loads); null or none = still air
     */
    wind?: WindSpec | null | Promise<WindSpec | null>;
    /** the gust noise's seed (tests); none = a random one per flight session */
    windSeed?: number;
}

/** Who keeps the flight paused (FlightSession.pause). */
export type PauseHolder = 'menu' | 'controls' | 'bake';

export interface Timings {
    settingsMs: number;
    collisionMs: number | null;
    firstFrameMs: number | null;
    visibleMs: number | null;
}

/** A replay on screen: lives played in real time from `startTick`. */
interface ReplayState {
    player: LivesPlayer;
    t0: number;
    startTick: number;
}

/** A gust seed for a new flight session (sim-core WindConfig.seed: an integer 0..2^31-1); it goes in every life header. */
function newWindSeed(): number {
    try {
        return globalThis.crypto.getRandomValues(new Uint32Array(1))[0] & WIND_SEED_MAX;
    } catch {
        return Math.floor(Math.random() * WIND_SEED_MAX);
    }
}

/** Overrides a log header can hold: no undefined, no non-finite numbers (JSON would turn them into null). */
function jsonSafe(o: ParamOverrides): ParamOverrides {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) {
        if (v === undefined || (typeof v === 'number' && !Number.isFinite(v))) continue;
        out[k] = v;
    }
    return out as ParamOverrides;
}

export class FlightSession {
    renderer!: SplatRenderer;
    scene!: ResolvedScene;
    /**
     * What the engine drew this scan with when its splats began to load (v0.7 lane R): the drawing
     * decided with the renderer's real device (SessionOptions.drawing). Benches read it; the drawing
     * feature takes over once the flight is built (the governor's top budget).
     */
    loadDrawing: (DrawingChoice & { webgpu: boolean }) | null = null;
    /**
     * Content files that did not open before the one on screen (v0.8 item 8: a broken lod-meta.json and
     * the scene's meta.json shown instead), with why; empty when the first file opened. Benches and the
     * bug report's technical details read it.
     */
    contentFailures: { url: string; error: string }[] = [];
    /** the walls the craft flies in: the scan's, seen through `transform` (E.7) */
    collision: VoxelCollision | null = null;
    collisionSha256: string | null = null;
    world: VoxelContactWorld | null = null;
    /** the scan's own walls, untransformed: what replays rebuild from (E.7) */
    baseCollision: VoxelCollision | null = null;
    baseWorld: VoxelContactWorld | null = null;
    /** the scene's size now: T(w) = s*w + t, Float32 values (setTransform) */
    transform: SceneTransform = IDENTITY;
    /** the floater filter (G.3): pieces of the walls under this many blocks are dropped; 0 = off (setDropFloaters) */
    floaterMinBlocks = 0;
    /** what the filter dropped from the scan's walls (null: no walls) and the filtered walls' hash (null: filter off) */
    floaterFilter: FloaterFilter | null = null;
    floaterSha256: string | null = null;
    /**
     * The collision ceiling (v0.7): no walls at or above this height in the scan's own coordinates
     * (scan metres, Float32 as a world record holds it); null = none. Change it with setCeiling.
     */
    ceilingM: number | null = null;
    /** The wind the flight flies in (setWind; null: still air), the seed of its gusts, and the scan's ground height (scan metres). */
    windSpec: WindSpec | null = null;
    windSeed = 0;
    windGroundM = 0;
    /**
     * The pilot's walls switch. Off: the flight model gets no contact world (the craft flies
     * through everything, no crash) while the walls stay loaded for the voxel overlay and for
     * switching back on. Change it with setWallsOn.
     */
    wallsOn = true;
    /** the flight model's params; set only by compileModel */
    params!: SimParams;
    /**
     * What `params` were compiled from (compileModel): the overrides every life header writes. A
     * header therefore always describes the Sim it starts, whatever changed since (the wind's ground
     * under new walls, crash.enabled or the wind waiting for applyLifeSettings): a replay rebuilds
     * the Sim from the header alone, so a header made from the settings now could replay another flight.
     */
    private paramsFrom: ParamOverrides = {};
    /** the pilot's physics overrides (drone, settings); crash.enabled is crashOn, merged into each life's header */
    overrides: ParamOverrides = {};
    runner!: Runner;
    spawn: [number, number, number, number] = [0, 0, 0, 0];
    presetId = DEFAULT_PRESET;
    /** the flight's statistics (design D.1): life, session; one count per flight model, lives included */
    stats!: FlightStats;
    /** decides automatic respawns (C.6); R and Y go through it too */
    director!: RespawnDirector;
    history!: StateHistory;
    /** the respawn rules (C.6, A.8 crash group); the respawn feature sets them from the settings */
    policy: RespawnPolicy = { ...DEFAULT_RESPAWN_POLICY };
    /** crash.enabled (C.7): false turns impacts into bounces; part of each life's params */
    crashOn = true;
    /** a new life began (respawn, 'life' setting, a new flight model at the spawn) */
    onLife: ((life: Life) => void) | null = null;
    /** the pilot's camera, render-only (setCamera); null = the drone preset's value */
    private camFovDeg: number | null = null;
    private camUptiltDeg: number | null = null;
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
    /**
     * Called at the start of every frame, before the physics steps: the input reads its device once
     * more (Controls: GamepadSource.pollNow, v0.9 lane E), so a report published after the polling
     * loop's last look is in this frame, not the next one (a whole display period later).
     */
    beforeStep: (() => void) | null = null;
    onEvent: ((e: SimEvent) => void) | null = null;
    private evIdx = 0;
    readonly createdAt = performance.now();
    private readonly holds = new Set<PauseHolder>();
    get paused(): boolean {
        return this.clock.paused;
    }
    /** when true the crash view owns the camera */
    cameraOverride = false;
    private replay: ReplayState | null = null;
    frameTimes: number[] = [];
    private loader: SessionLoader | null = null;
    /** the scan is drawn (false: ?render=off, see SessionOptions.drawScan) */
    drawScan = true;
    /** the renderer is the page's (E.4): never destroyed here */
    private sharedRenderer = false;
    /** the first life's start as a scene switch (SessionOptions.sceneStart), used once */
    private sceneStart: { ch: number[] } | null = null;
    private offEngine: (() => void) | null = null;
    /** dispose() ran: the scene is unloaded and nothing of this session runs any more */
    disposed = false;
    private sceneIntentCb: ((tick: number) => void) | null = null;

    /**
     * scenes.autoSwitch (E.5): with the rules' onCrash 'next-scene', the director calls this at
     * crash + delay instead of a respawn (inside the runner's step: the scene host defers the load).
     */
    get onSceneIntent(): ((tick: number) => void) | null {
        return this.sceneIntentCb;
    }

    set onSceneIntent(cb: ((tick: number) => void) | null) {
        this.sceneIntentCb = cb;
        if (this.director) this.director.onSceneIntent = cb;
    }

    static async start(canvas: HTMLCanvasElement, o: SessionOptions): Promise<FlightSession> {
        const s = new FlightSession();
        s.drawScan = o.drawScan ?? true;
        s.sharedRenderer = !!o.renderer;
        if (o.policy) s.policy = { ...o.policy };
        if (o.crashOn !== undefined) s.crashOn = o.crashOn;
        if (o.sceneStart) s.sceneStart = { ch: Array.from(o.sceneStart.ch) };
        s.loader = new SessionLoader(s, o.onProgress);
        try {
            await s.init(canvas, o);
        } catch (e) {
            s.loader.stop();
            // the render loop starts before the walls land: stop it, the page shows the error instead
            // (the page's own renderer stays: only this scan goes)
            if (s.sharedRenderer) s.dispose();
            else try { s.renderer?.destroy(); } catch { /* half-built */ }
            throw e;
        }
        return s;
    }

    private async init(canvas: HTMLCanvasElement, o: SessionOptions): Promise<void> {
        const loader = this.loader!;
        const tS = performance.now();
        this.scene = await resolveScene(o.sceneId);
        this.timings.settingsMs = performance.now() - tS;
        this.presetId = o.preset && PRESETS[o.preset] ? o.preset : DEFAULT_PRESET;
        this.overrides = jsonSafe(o.overrides ?? {});
        this.wallsOn = o.wallsOn ?? true;
        this.floaterMinBlocks = validMinBlocks(o.dropFloaters) ? o.dropFloaters : 0;
        this.ceilingM = typeof o.ceilingM === 'number' && validCeiling(Math.fround(o.ceilingM)) ? Math.fround(o.ceilingM) : null;
        this.windSeed = o.windSeed !== undefined && Number.isInteger(o.windSeed) && o.windSeed >= 0 && o.windSeed <= WIND_SEED_MAX ? o.windSeed : newWindSeed();
        // the wind joins the model once its ground is known (after the walls, below)
        this.compileModel();
        this.renderer = o.renderer ?? await SplatRenderer.create(canvas, { renderScale: o.renderScale ?? 1, hFovDeg: this.params.cameraFovDeg, latencyMarker: !!o.latencyMarker });
        if (o.renderer) this.renderer.setFov(this.params.cameraFovDeg);
        // this scene's drawing, decided now that the device is known, before its splats load
        if (o.drawing) drawOnDevice(this.renderer, o.drawing);
        this.loadDrawing = { stochastic: this.renderer.stochastic, budgetM: this.renderer.splatBudgetMillions, webgpu: this.renderer.isWebGPU };
        this.renderer.setToneMapping(this.scene.tonemapping);
        this.renderer.setBackground(this.scene.background);
        // the scene's size (E.7) before its splats exist: the renderer gives the entity s and t when it makes it
        // a size set on an older version of the scan keeps its scale, not its offset (the scan moved)
        const tr = o.transform;
        this.transform = tr ? f32(tr.v && tr.v !== this.scene.version ? { s: tr.s, t: [0, 0, 0] } : tr) : IDENTITY;
        this.renderer.setSceneTransform(this.transform.s, [...this.transform.t]);
        const splatLoad = this.drawScan ? this.loadContent() : Promise.resolve(null);
        // the walls download beside the scan, not before it: one slow host no longer holds up the other
        const walls = this.scene.collisionUrl ? loader.loadWalls(this.scene.collisionUrl) : Promise.resolve(null);
        walls.catch(() => { /* awaited below; this only keeps an early failure from counting as unhandled */ });
        await splatLoad;
        // the chunks stream once the engine runs; until the flight model exists, look from the scan's camera
        const cam = this.scene.camera;
        if (cam) {
            const p = this.toFlown(cam.position), q = this.toFlown(cam.target);
            this.renderer.setCameraLookAt(p[0], p[1], p[2], q[0], q[1], q[2]);
        }
        // logic-only: nothing streams, so nothing to wait for (the walls are awaited below)
        const coarse = loader.watchCoarse();
        const onUpdate = (): void => this.frame();
        const onFrameEnd = (): void => {
            if (this.timings.firstFrameMs === null) this.timings.firstFrameMs = performance.now() - this.createdAt;
        };
        const app = this.renderer.app;
        app.on('update', onUpdate);
        app.on('frameend', onFrameEnd);
        this.offEngine = () => { app.off('update', onUpdate); app.off('frameend', onFrameEnd); };
        // the page's renderer already runs (E.4); a session that made its own starts it
        if (!this.sharedRenderer) this.renderer.start();
        const w = await walls;
        if (this.disposed) throw new Error('the scene switch was cancelled');
        if (w) {
            this.baseCollision = w.collision;
            this.baseWorld = w.world;
            this.scaleWalls();
            this.collisionSha256 = w.sha256;
            this.timings.collisionMs = w.ms;
        }
        this.spawn = this.findSpawn();
        this.windGroundM = this.groundUnderSpawn();
        // the wind (a live one was asked for while the scan loaded): the first life flies in it
        this.windSpec = await Promise.resolve(o.wind ?? null).catch(() => null);
        if (this.disposed) throw new Error('the scene switch was cancelled');
        this.compileModel();
        this.buildSim();
        if (o.paused) this.pause(true, 'menu');
        this.lagFrames = o.lagFrames ?? 0;
        // on screen = coarse level resident and walls in; only then the detail streams (it would slow the walls)
        this.visible = coarse.then(() => {
            this.timings.visibleMs = performance.now() - this.createdAt;
            this.renderer.revealFullDetail();
            loader.done();
        });
    }

    /**
     * Open the scan: the first of scene.content that loads (@gsfpv/scenes content.ts: levels of detail
     * first, then the single file). A file that fails (unreadable, not an octree the engine can open: the
     * renderer's loadSplat rejects) is unloaded with whatever it started and the next one is tried; the
     * scene then names the file really on screen (walls baking reads contentUrl). When none opens, the
     * error is @gsfpv/scenes noContentError's: every file damaged (render-pc BrokenFileError) is 'broken',
     * a file whose lookup never answered makes it 'network', otherwise the first file's own error.
     */
    private async loadContent(): Promise<void> {
        const failures: ContentAttempt[] = [];
        for (const c of this.scene.content) {
            try {
                await this.renderer.loadSplat(c.url);
                this.contentFailures = failures.map(({ url, error }) => ({ url, error }));
                if (c.url !== this.scene.contentUrl) this.scene = { ...this.scene, contentUrl: c.url, contentKind: c.kind };
                return;
            } catch (e) {
                if (this.disposed) throw e;
                failures.push({ url: c.url, error: String((e as Error)?.message ?? e), verified: c.verified, broken: e instanceof BrokenFileError, e });
                this.renderer.unloadSplat();
            }
        }
        this.contentFailures = failures.map(({ url, error }) => ({ url, error }));
        throw noContentError(this.scene.id, failures);
    }

    private findSpawn(): [number, number, number, number] {
        const cam = this.scene.camera;
        let pos: [number, number, number] = this.toFlown(cam ? cam.position : [0, 1.5, 0]);
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

    /** on / off (the pilot's switch on a scan with walls) or none (the scan has no walls). */
    get walls(): WallsState {
        return wallsState(!!this.collision, this.wallsOn);
    }

    /** The contact world the flight model flies in: the walls, or none when they are switched off. */
    get flightWorld(): VoxelContactWorld | null {
        return this.wallsOn ? this.world : null;
    }

    /** The flight model now (a 'life' setting swaps in a new one); undefined until the walls are in. */
    get sim(): Sim {
        return this.runner?.sim as Sim;
    }

    /** The current life's log (header and records). */
    get log(): Life {
        return this.runner.current();
    }

    /** The lives kept (the last 30, at most 32 MB), oldest first; the last is the current one. */
    lives(): readonly Life[] {
        // none before the walls are in, and none after dispose() (a scene switch, the picker over the flight)
        return this.runner ? this.runner.lives() : [];
    }

    /** The walls this page replays logs on (replay.ts). */
    get wallsSource(): WallsSource {
        return { collisionSha256: this.collisionSha256, world: this.baseWorld, collision: this.baseCollision };
    }

    /**
     * The pilot's overrides plus crash.enabled and the wind, from the settings now: what the next
     * compileModel compiles. Life headers write the compiled ones (paramsFrom), never these directly.
     */
    lifeOverrides(): ParamOverrides {
        const o: ParamOverrides = this.crashOn ? { ...this.overrides } : { ...this.overrides, crashOn: false };
        const wind = this.windConfig();
        if (wind) o.wind = wind;
        return o;
    }

    /**
     * sim-core's wind for the flight model (ParamOverrides.wind): the wind spec with this session's
     * gust seed and the scan's ground under the spawn; undefined in still air (no field in the header).
     */
    windConfig(): WindConfig | undefined {
        const w = this.windSpec;
        if (!w || (w.speed === 0 && w.gust === 0)) return undefined;
        return { fromDeg: w.fromDeg, speed: w.speed, gust: w.gust, compassDeg: w.compassDeg, seed: this.windSeed, groundM: this.windGroundM };
    }

    /**
     * The wind changed (wind.mode, the custom numbers, a live answer): true when the flight model's
     * wind is another one. The caller applies it as a 'life' setting (applyLifeSettings: a new life
     * where the craft is), as the settings screen's close does for the rest of the model.
     */
    setWind(spec: WindSpec | null): boolean {
        const before = JSON.stringify(this.windConfig() ?? null);
        this.windSpec = spec;
        return JSON.stringify(this.windConfig() ?? null) !== before;
    }

    /**
     * The ground the wind's gradient measures from, in the scan's own coordinates: the floor under the
     * spawn (a ray down through the scan's own walls, filter and ceiling aside), else the spawn's own
     * height (a scan without walls, or nothing below it).
     */
    private groundUnderSpawn(): number {
        const tr = this.transform;
        const sx = (this.spawn[0] - tr.t[0]) / tr.s, sy = (this.spawn[1] - tr.t[1]) / tr.s, sz = (this.spawn[2] - tr.t[2]) / tr.s;
        const hit = this.baseCollision?.queryRay(sx, sy, sz, 0, -1, 0, 500) ?? null;
        return hit ? hit.y : sy;
    }

    /**
     * Compile the flight model from the settings now (lifeOverrides: the pilot's overrides,
     * crash.enabled, the wind with its seed and ground) and keep what it was compiled from for the
     * life headers (paramsFrom). The only place `params` is set.
     */
    private compileModel(): void {
        const from = this.lifeOverrides();
        this.params = compileParams(PRESETS[this.presetId], from);
        this.paramsFrom = from;
    }

    /** A life header for the current params (exactly what they were compiled from) and walls. */
    private header(at: [number, number, number, number], opts: RespawnOpts, reason: RespawnReason | 'start'): LifeHeader {
        return makeLifeHeader({
            simCore: SIM_CORE_VERSION,
            preset: PRESETS[this.presetId],
            overrides: this.paramsFrom,
            collisionSha256: this.flightWorld ? this.collisionSha256 : null,
            scene: this.headerScene(),
            at,
            opts,
            reason
        });
    }

    /** Options of a respawn by the rules now: the platform, the switch kept on (C.3, C.4). */
    private respawnOpts(keepArmed = this.policy.keepArmed): RespawnOpts {
        return { platform: this.policy.platform, keepArmed };
    }

    /**
     * (Re)create the flight model at the spawn; sim time restarts at 0 with a fresh log. The craft
     * starts on the platform when respawn.platform is on (item 16), and parked: a switch already
     * on at load never arms it (B11), the pilot flips it.
     */
    private buildSim(): void {
        const sim = new Sim(this.params, this.flightWorld);
        // C.4 'scene': the first life of a scene switch; the channels go in before the start, so the
        // header holds them and a replay places the craft the same way (armed when kept armed)
        const scene = this.sceneStart;
        this.sceneStart = null;
        if (scene) sim.setChannels(scene.ch);
        // hoverThr: the Sim constructor's own (hoverThrOf), the same in every replay (review C6)
        this.runner = new Runner(sim, scene ? this.header(this.spawn, this.respawnOpts(), 'scene') : this.header(this.spawn, this.respawnOpts(false), 'start'), { traceHash: true });
        this.history = new StateHistory();
        this.director = new RespawnDirector(this.policy, () => this.spawn, this.history, () => this.runner.sim.contactWorld, this.params.boundRadius, hoverStickOf(this.params));
        this.director.onSceneIntent = this.sceneIntentCb;
        this.runner.director = this.director;
        // FlightStats (design D.1) counted inside the step loop, lives included; a new flight model is a new count
        this.stats = new FlightStats([this.spawn[0], this.spawn[1], this.spawn[2]], (this.params.capacityAs * 1000) / 3600);
        this.runner.stats = this.stats;
        this.runner.onLife = (life) => this.lifeStarted(life);
        // a world record (E.7): the walls under the new transform are built already (setTransform)
        this.runner.onWorld = () => { this.runner.sim.world = this.flightWorld; };
        // while paused (menu, settings, drone pick) sim time 0 is the moment the flight resumes
        this.clock.restart(performance.now());
        this.evIdx = 0;
        this.flightStartTick = 0;
        this.onLife?.(this.runner.current());
    }

    private lifeStarted(life: Life): void {
        this.flightStartTick = life.header.life.startTick;
        this.onLife?.(life);
    }

    /** The respawn rules now (the respawn feature, from the settings); they apply from the next decision. */
    setRespawnPolicy(p: RespawnPolicy): void {
        this.policy = { ...p };
        if (this.director) this.director.policy = { ...p };
    }

    /** The first life's start options (whether it began on the platform). */
    get startOpts(): RespawnOpts {
        return this.runner.lives()[0]?.header.life.opts ?? {};
    }

    /**
     * crash.enabled (C.7, item 3): a 'life' setting. Returns false when nothing changed; the
     * caller applies it with applyLifeSettings when the flight runs again (A.7).
     */
    setCrashOn(on: boolean): boolean {
        if (on === this.crashOn) return false;
        this.crashOn = on;
        return true;
    }

    /**
     * The pilot's camera (design A.7, D-h): FOV and uptilt are render-only, so changing them never
     * rebuilds the flight model and never moves the craft. null = the drone preset's value.
     */
    setCamera(fovDeg: number | null, uptiltDeg: number | null): void {
        this.camFovDeg = fovDeg;
        this.camUptiltDeg = uptiltDeg;
        this.renderer.setFov(this.cameraFovDeg);
    }

    get cameraFovDeg(): number {
        return this.camFovDeg ?? this.params.cameraFovDeg;
    }

    get cameraUptiltDeg(): number {
        return this.camUptiltDeg ?? this.params.cameraUptiltDeg;
    }

    /** Flying: armed or at least released from the spawn, not crashed, no replay on screen. */
    private get flying(): boolean {
        if (!this.runner) return false;
        const s = this.sim.s;
        return s[S.hold] === 0 && s[S.crashed] === 0 && !this.replay;
    }

    private here(): [number, number, number, number] {
        const s = this.sim.s;
        return [s[S.px], s[S.py], s[S.pz], attitude(s).yaw];
    }

    /**
     * A 'life' setting changed (design A.7, C.4 kind `here`): the next life gets a new flight
     * model with these params, and a craft in the air goes on from where it is, level and still,
     * on the platform, the switch kept on (C.4 'here': respawn.platform, respawn.keepArmed). The
     * log goes on: a new life, the tick continues. A parked or crashed craft, a replay, or a spot
     * the new walls would put it inside: a new flight model at the spawn, as before.
     */
    applyLifeSettings(presetId: string, overrides: ParamOverrides): void {
        const here = this.runner ? this.here() : null;
        if (!this.flying || !here || !this.spawnIsFree(here)) {
            this.rebuildSim(presetId, overrides);
            return;
        }
        this.setModel(presetId, overrides);
        this.newLife(here, 'settings');
    }

    /** A new Sim on the current params and walls, started as the next life at `at` (Runner.newLife). */
    private newLife(at: [number, number, number, number], reason: RespawnReason): void {
        const sim = new Sim(this.params, this.flightWorld);
        this.runner.newLife(sim, this.header(at, this.respawnOpts(), reason));
    }

    private setModel(presetId: string, overrides: ParamOverrides): void {
        this.presetId = PRESETS[presetId] ? presetId : DEFAULT_PRESET;
        this.overrides = jsonSafe(overrides);
        this.compileModel();
        this.renderer.setFov(this.cameraFovDeg);
    }

    /**
     * Change drone / physics settings: a new flight model at the same scene, at the spawn, a fresh log.
     * A restart is a moment the craft is not flying, so queued walls go in here: after the new drone
     * (the spawn check measures its size), and the model is compiled again on them, because the wind
     * measures from the new walls' floor (setWalls).
     */
    rebuildSim(presetId: string, overrides: ParamOverrides): void {
        this.setModel(presetId, overrides);
        this.replay = null;
        if (this.takePendingWalls()) this.compileModel();
        this.buildSim();
    }

    /**
     * Switch the walls on or off. A life holds one setting, so a craft in the air goes on from
     * where it is in a new life on the new walls (unless walls coming on would put it inside one:
     * then it starts at the spawn), and a parked or crashed one starts again at the spawn. Returns
     * false when nothing changed.
     */
    setWallsOn(on: boolean): boolean {
        if (on === this.wallsOn) return false;
        this.wallsOn = on;
        if (!this.runner) return true;
        const here = this.here();
        if (this.flying && (!on || this.spawnIsFree(here))) this.newLife(here, 'settings');
        else this.rebuildSim(this.presetId, this.overrides);
        return true;
    }

    // ------------------------------------------------------------------ respawns (C.4, C.6)

    /**
     * R: back to the start, on the platform, armed if the switch is on (C.4 'start'). Queued walls
     * go in here: a new flight model at the spawn. Otherwise the director applies it at the next
     * tick, so it is a log record like every other respawn.
     */
    respawnStart(): void {
        this.replay = null;
        if (this.pendingWalls) {
            this.rebuildSim(this.presetId, this.overrides);
            return;
        }
        this.director.request('start');
    }

    /** Y: back rewindS along the path now (or from the crash when crashed), at the next tick. */
    rewind(): void {
        this.replay = null;
        this.director.request('rewind');
    }

    /** Enter: keep the wreck; the automatic respawn waiting to happen is cancelled. */
    keepWreck(): void {
        this.director.keep();
    }

    /** v0.2's respawn(): the start, or (true) the rewind that replaced the last safe point. */
    respawn(fromSafePoint = false): void {
        if (fromSafePoint) this.rewind();
        else this.respawnStart();
    }

    /** The automatic respawn waiting to happen: when (sim ticks), and where it goes (the director's own preview: backoff included). */
    pendingRespawn(): { inTicks: number; delayTicks: number; target: 'rewind' | 'start' | 'scene'; backS: number } | null {
        const p = this.director?.pending();
        if (!p) return null;
        // scenes.autoSwitch: the next scene loads instead (E.5)
        if (this.policy.onCrash === 'next-scene' && this.sceneIntentCb) return { inTicks: Math.max(0, p.atTick - this.sim.tick), delayTicks: this.policy.delayTicks, target: 'scene', backS: 0 };
        const v = this.director?.preview();
        if (!v) return null;
        return { inTicks: Math.max(0, p.atTick - this.sim.tick), delayTicks: this.policy.delayTicks, target: v.target, backS: v.backTicks === null ? 0 : Math.round(v.backTicks / 1000) };
    }

    /**
     * Is the respawn point clear: does the craft's bounding sphere touch no wall? Inside the voxel
     * grid this agrees with isFreeAt; above a scan (an authored camera high up) isFreeAt says "no
     * data" although there is only air, so the body test is the one that answers the question.
     */
    spawnIsFree(p: [number, number, number, number] = this.spawn): boolean {
        if (!this.collision || !this.wallsOn) return true;
        const push = { x: 0, y: 0, z: 0 };
        return !this.collision.querySphere(p[0], p[1], p[2], this.params.boundRadius + 0.01, push);
    }

    /**
     * Leave this scene (E.4, in-page switching): the update handler stops, the scan's splats are
     * unloaded from the page's renderer, the walls, the flight model and the replay are dropped, the
     * loading reports stop. The renderer itself stays (the next scene draws with it). Idempotent.
     */
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.loader?.stop();
        this.offEngine?.();
        this.offEngine = null;
        this.onFrame = null;
        this.beforeStep = null;
        this.onEvent = null;
        this.onLife = null;
        this.sceneIntentCb = null;
        if (this.director) this.director.onSceneIntent = null;
        this.replay = null;
        this.pendingWalls = null;
        this.cameraOverride = false;
        try { this.renderer?.clearDebris(); this.renderer?.unloadSplat(); } catch { /* a renderer that never loaded */ }
        this.collision = null;
        this.world = null;
        this.baseCollision = null;
        this.baseWorld = null;
        this.floaterFilter = null;
        this.runner = undefined as unknown as Runner;
        this.lagQueue = [];
        this.frameTimes = [];
    }

    // ------------------------------------------------------------------ input, pause, frame

    /** page time (ms, performance.now() / event.timeStamp) -> sim microseconds */
    toSimUs(tMs: number): number {
        return this.clock.toSimUs(tMs);
    }

    /** Feed a channel frame from any input source (stamped on the sim clock when stepped). */
    input(ch: ArrayLike<number>, tMs: number, id?: number): void {
        if (!this.runner || this.paused || this.replay) return;
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
        this.beforeStep?.();
        const now = performance.now();
        this.frameTimes.push(now);
        if (this.frameTimes.length > 600) this.frameTimes.shift();
        if (this.replay) {
            this.replayFrame(now);
            this.frames++;
            this.onFrame?.(this, 0);
            return;
        }
        this.clock.advance(this.runner, now); // nothing while paused
        const ev = this.runner.events;
        for (; this.evIdx < ev.length; this.evIdx++) {
            const e = ev[this.evIdx];
            if (e.type === 'crash') this.crashes++;
            this.onEvent?.(e);
        }
        if (ev.length > 2048) {
            ev.splice(0, this.evIdx);
            this.evIdx = 0;
        }
        if (!this.cameraOverride) {
            const s = this.sim.s;
            const frac = this.paused ? 0 : Math.max(0, Math.min(0.001, (this.toSimUs(now) - this.sim.tick * 1000) / 1e6));
            this.renderer.setPose(s[S.px] + s[S.vx] * frac, s[S.py] + s[S.vy] * frac, s[S.pz] + s[S.vz] * frac, s[S.qw], s[S.qx], s[S.qy], s[S.qz], this.cameraUptiltDeg);
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

    // ------------------------------------------------------------------ walls from the tab

    /** Walls waiting for a moment when swapping them cannot move the craft under the pilot. */
    private pendingWalls: { json: Uint8Array; bin: Uint8Array; sha: string | null; onSwap: ((sha: string) => void) | null } | null = null;

    /**
     * Walls built in this tab, from the walls cache or imported: swap them in now, rebuild the model
     * on them and move the spawn out of any wall. The log restarts, because a replay needs the same
     * collision. Walls without one solid voxel are refused (BakeRefusedError 'empty') and the old
     * ones kept: the voxeliser returns an empty octree as success when the GPU refuses its buffer.
     * `sha`: the json + bin digest when the caller already has it (a 90 MB .bin takes ~1 s here).
     */
    installCollision(json: Uint8Array, bin: Uint8Array, sha: string | null = null): string {
        assertWalls(json, bin);
        this.pendingWalls = null; // the newest walls win
        this.setWalls(json, bin, sha);
        this.rebuildSim(this.presetId, this.overrides);
        return this.collisionSha256!;
    }

    /**
     * The same, never under a flying craft: at once when it is parked at the spawn (not armed since
     * the last reset), else at the next start (R) or restart. Refused at once, like installCollision.
     */
    queueCollision(json: Uint8Array, bin: Uint8Array, sha: string | null, onSwap: ((sha: string) => void) | null): void {
        assertWalls(json, bin);
        this.pendingWalls = { json, bin, sha, onSwap };
        this.swapWallsIfParked();
    }

    get wallsPending(): boolean {
        return !!this.pendingWalls;
    }

    /** Swap queued walls in if the craft still sits where a new model would put it. */
    swapWallsIfParked(): boolean {
        if (!this.pendingWalls || !this.runner || this.replay) return false;
        const s = this.sim.s;
        const sp = this.spawn;
        if (s[S.hold] === 0 || Math.hypot(s[S.px] - sp[0], s[S.py] - sp[1], s[S.pz] - sp[2]) > 1e-3) return false;
        this.rebuildSim(this.presetId, this.overrides); // takes the queued walls
        return true;
    }

    /** Swap the queued walls in (setWalls); true when there were some. The caller recompiles the model. */
    private takePendingWalls(): boolean {
        const w = this.pendingWalls;
        if (!w) return false;
        this.pendingWalls = null;
        this.setWalls(w.json, w.bin, w.sha);
        w.onSwap?.(this.collisionSha256!);
        return true;
    }

    private setWalls(json: Uint8Array, bin: Uint8Array, sha: string | null): void {
        const metadata = JSON.parse(new TextDecoder().decode(json)) as VoxelMetadata;
        const collision = openVoxelCollision(metadata, bin);
        let digest = sha;
        if (!digest) {
            const both = new Uint8Array(json.length + bin.length);
            both.set(json, 0);
            both.set(bin, json.length);
            digest = sha256Hex(both);
        }
        this.baseCollision = collision;
        this.baseWorld = new VoxelContactWorld(collision);
        this.scaleWalls();
        this.collisionSha256 = digest;
        if (!this.spawnIsFree()) this.spawn = this.findSpawn();
        // new walls, a new floor under the spawn: the next flight model's wind measures from it
        this.windGroundM = this.groundUnderSpawn();
    }

    private unfiltered: { base: VoxelCollision; tr: SceneTransform; col: VoxelCollision } | null = null;

    /**
     * The scan's own walls before the floater filter, in the flown frame (the scene's size): what
     * the floater preview draws, so the pieces a filter would drop (or drops now) can be seen.
     * The flown walls themselves when the filter is off.
     */
    get unfilteredWalls(): VoxelCollision | null {
        const base = this.baseCollision;
        if (!base) return null;
        const u = this.unfiltered;
        if (u && u.base === base && u.tr === this.transform) return u.col;
        // the same object while base and size stay, also across a filter or ceiling change (the grid is
        // not rebuilt); with a ceiling the flown walls answer "empty" above it, so the scan's own are drawn
        const col = (this.floaterFilter && this.floaterFilter.collision !== base) || this.ceilingM !== null ? scaledCollision(base, this.transform) : this.collision!;
        this.unfiltered = { base, tr: this.transform, col };
        return col;
    }

    // ------------------------------------------------------------------ scene scale (E.7)

    /** A point of the scan (file space) in the flown world: T(p). */
    private toFlown(p: readonly number[]): [number, number, number] {
        const tr = this.transform;
        return [tr.s * p[0] + tr.t[0], tr.s * p[1] + tr.t[1], tr.s * p[2] + tr.t[2]];
    }

    /**
     * The flown walls from the scan's own: the floater filter first, then the collision ceiling, then
     * `transform` (the same functions a replay uses, session/world.ts).
     */
    private scaleWalls(): void {
        const base = this.baseCollision;
        if (!base) return;
        const f = filteredWalls(base, this.floaterMinBlocks);
        this.floaterFilter = f.filter;
        this.floaterSha256 = f.sha256;
        const walls = sceneWalls(base, this.floaterMinBlocks, this.ceilingM);
        this.collision = scaledCollision(walls, this.transform);
        this.world = isIdentity(this.transform) && walls === base ? this.baseWorld : new VoxelContactWorld(this.collision);
    }

    /** The scene as a life header holds it: the transform, the floater filter with its walls' hash (G.3), the ceiling (v0.7). */
    private headerScene(): NonNullable<LifeHeader['scene']> {
        const sc: NonNullable<LifeHeader['scene']> = { id: this.scene.id, version: this.scene.version, transform: packed(this.transform), floaterMinBlocks: this.floaterMinBlocks };
        if (this.floaterMinBlocks > 0 && this.floaterSha256) sc.floaterSha256 = this.floaterSha256;
        if (this.ceilingM !== null) sc.ceilingM = this.ceilingM;
        return sc;
    }

    /** The world record of the scene now (E.7, G.3, v0.7): transform, floater filter, ceiling. */
    private worldNow(): { s: number; t: [number, number, number]; floaterMinBlocks: number; ceilingM: number | null } {
        const tr = this.transform;
        return { s: tr.s, t: [tr.t[0], tr.t[1], tr.t[2]], floaterMinBlocks: this.floaterMinBlocks, ceilingM: this.ceilingM };
    }

    /**
     * The collision ceiling (v0.7, the owner's item 10): no walls at or above `c` (the scan's own
     * coordinates, metres up; null = none). The walls change, so the log gets a world record with it
     * (C.9 /3: ch[5], ch[6]); like a rescale the craft flies on (its state, the recorded path and the
     * respawn rules are untouched), unless walls coming back hold it: then the nearest free spot with a
     * 'world' respawn, and a spawn inside one moves out the same way. Returns false when nothing changed.
     */
    setCeiling(c: number | null): boolean {
        const next = c === null ? null : Math.fround(c);
        if (next !== null && !validCeiling(next)) throw new RangeError(`collision ceiling must be a height within +-10000 m, got ${c}`);
        if (next === this.ceilingM) return false;
        this.ceilingM = next;
        this.scaleWalls();
        if (!this.runner) return true;
        this.replay = null;
        this.runner.world(this.worldNow());
        const r = this.params.boundRadius + 0.03;
        const spawnOut = this.spawnIsFree() ? null : pushOut(this.collision, this.spawn, r);
        if (spawnOut) {
            this.spawn = spawnOut;
            this.stats.moveSpawn([spawnOut[0], spawnOut[1], spawnOut[2]]);
        }
        const here = this.here();
        if (!this.flying || this.spawnIsFree(here)) return true;
        const at = pushOut(this.collision, here, r) ?? this.spawn;
        this.runner.respawn(at[0], at[1], at[2], at[3], this.respawnOpts(), 'world');
        return true;
    }

    /**
     * Drop the walls' floating pieces under n blocks (G.3, the owner's item 24: phantom walls),
     * 0 = keep them all. The walls change, so the log gets a world record with the new filter (C.9:
     * ch[4]) and a craft in the air goes on from where it is in a new life whose header names the
     * filtered walls' hash (a replay rebuilds them from the scan's own and refuses other walls); a
     * parked or crashed one, or one a returning piece would hold, starts again at the spawn.
     * Returns false when nothing changed.
     */
    setDropFloaters(n: number): boolean {
        if (!validMinBlocks(n)) throw new RangeError(`floater filter must be an integer 0..64, got ${n}`);
        if (n === this.floaterMinBlocks) return false;
        this.floaterMinBlocks = n;
        this.scaleWalls();
        if (!this.runner) return true;
        this.replay = null;
        this.runner.world(this.worldNow());
        // pieces coming back may cover the spawn: the nearest free spot, as after a scale-down
        const spawnOut = this.spawnIsFree() ? null : pushOut(this.collision, this.spawn, this.params.boundRadius + 0.03);
        if (spawnOut) {
            this.spawn = spawnOut;
            this.stats.moveSpawn([spawnOut[0], spawnOut[1], spawnOut[2]]);
        }
        const here = this.here();
        if (this.flying && this.spawnIsFree(here)) this.newLife(here, 'settings');
        else this.rebuildSim(this.presetId, this.overrides);
        return true;
    }

    /** Where the scene scales around: the craft, else (before the flight model exists) the spawn. */
    pivot(): [number, number, number] {
        if (!this.runner) return [this.spawn[0], this.spawn[1], this.spawn[2]];
        const s = this.sim.s;
        return [s[S.px], s[S.py], s[S.pz]];
    }

    /**
     * Fly the scene under `next` from now on (E.7). The craft's state does not change (scaling
     * around the drone keeps it where it is, velocity included); the splats, the walls, the spawn,
     * the recorded path (rewinds) and the altitude base follow the scene; the log gets a world
     * record, so a replay rebuilds the same walls from the same scan. A scale-down that leaves the
     * craft touching a wall moves it to the nearest free spot with a 'world' respawn (C.4 'here'),
     * and a spawn inside a wall moves out the same way. Returns the Float32 transform now in use
     * and whether the craft was pushed out.
     */
    setTransform(next: { s: number; t: readonly number[] }): { transform: SceneTransform; pushed: boolean } {
        const to = f32(next);
        const from = this.transform;
        if (sameTransform(from, to)) return { transform: from, pushed: false };
        const map = pointMap(from, to); // throws on a bad transform, before anything changed
        this.transform = to;
        this.renderer.setSceneTransform(to.s, [...to.t]);
        this.scaleWalls();
        const sp = map(this.spawn[0], this.spawn[1], this.spawn[2]);
        this.spawn = [sp[0], sp[1], sp[2], this.spawn[3]];
        if (!this.runner) return { transform: to, pushed: false };
        this.replay = null;
        this.history.mapPositions(map);
        this.stats.moveSpawn(sp);
        this.runner.world(this.worldNow());
        const r = this.params.boundRadius + 0.03;
        const spawnOut = this.spawnIsFree() ? null : pushOut(this.collision, this.spawn, r);
        if (spawnOut) {
            this.spawn = spawnOut;
            this.stats.moveSpawn([spawnOut[0], spawnOut[1], spawnOut[2]]);
        }
        const here = this.here();
        if (this.spawnIsFree(here)) return { transform: to, pushed: false };
        const at = pushOut(this.collision, here, r) ?? this.spawn;
        this.runner.respawn(at[0], at[1], at[2], at[3], this.respawnOpts(), 'world');
        return { transform: to, pushed: true };
    }

    // ------------------------------------------------------------------ replay (C.9: from the log only)

    /**
     * Replay lives on screen: fast-forward to `fromTick`, then play in real time to `toTick`.
     * false (and nothing plays) when one of them cannot replay here (another sim-core version, a
     * preset this build lacks, other walls).
     */
    startReplay(lives: readonly Life[], fromTick: number, toTick: number): boolean {
        if (lives.length === 0 || lives.some((l) => lifeProblem(l.header, this.wallsSource) !== null)) return false;
        const first = lives.findIndex((l) => l.endTick > fromTick);
        const from = lives.slice(Math.max(0, first));
        const player = new LivesPlayer(from, this.wallsSource, toTick);
        const startTick = Math.max(from[0].header.life.startTick, fromTick);
        player.stepTo(startTick);
        this.replay = { player, t0: performance.now(), startTick };
        return true;
    }

    private replayFrame(now: number): void {
        const st = this.replay!;
        st.player.stepTo(st.startTick + Math.floor(now - st.t0));
        const s = st.player.sim.s;
        if (!this.cameraOverride) this.renderer.setPose(s[S.px], s[S.py], s[S.pz], s[S.qw], s[S.qx], s[S.qy], s[S.qz], this.cameraUptiltDeg);
        if (st.player.done) this.replay = null;
    }

    stopReplay(): void {
        this.replay = null;
    }

    get replaying(): boolean {
        return this.replay !== null;
    }

    // ------------------------------------------------------------------ self-tests used by acceptance

    measureTwr(): number {
        return measureTwr(this);
    }

    dropTest(): { g: number; measured: number; fallM: number } {
        return dropTest(this);
    }

    tunnelSelfTest(passes: number, speed: number, seed = 1): { passes: number; speed: number; contacts: number; penetrations: number } {
        return tunnelSelfTest(this, passes, speed, seed);
    }

    /** The flight model on screen: the replay's while one plays, else the live one (the HUD reads it). */
    get shownSim(): Sim {
        return this.replay ? this.replay.player.sim : this.sim;
    }

    /** HUD numbers */
    hud(): { armed: boolean; crashed: boolean; throttlePct: number; speed: number; altitude: number; timeS: number; crashes: number; volts: number; roll: number; pitch: number } {
        const sim = this.shownSim;
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
