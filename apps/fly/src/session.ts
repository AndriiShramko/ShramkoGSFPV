// One flight: scene + collision + physics + renderer, driven from the engine's update event.
import { Sim, Runner, InputLog, S, compileParams, hoverSolve, SIM_CORE_VERSION, sha256Hex, attitude } from '@gsfpv/sim-core';
import type { SimParams, ParamOverrides, SimEvent } from '@gsfpv/sim-core';
import { fetchVoxelCollision, VoxelContactWorld, findSphereSpawn, NoCollisionError } from '@gsfpv/collision';
import type { VoxelCollision } from '@gsfpv/collision';
import { resolveScene, headingFromCamera } from '@gsfpv/scenes';
import type { ResolvedScene } from '@gsfpv/scenes';
import { SplatRenderer } from '@gsfpv/render-pc';
import { PRESETS, DEFAULT_PRESET } from './presets';

export interface SessionOptions {
    sceneId: string;
    preset?: string;
    overrides?: ParamOverrides;
    latencyMarker?: boolean;
    lagFrames?: number;
    renderScale?: number;
    traceHash?: boolean;
}

export interface Timings {
    settingsMs: number;
    collisionMs: number | null;
    firstFrameMs: number | null;
}

export class FlightSession {
    renderer!: SplatRenderer;
    scene!: ResolvedScene;
    collision: VoxelCollision | null = null;
    collisionSha256: string | null = null;
    world: VoxelContactWorld | null = null;
    params!: SimParams;
    sim!: Sim;
    runner!: Runner;
    log!: InputLog;
    spawn: [number, number, number, number] = [0, 0, 0, 0];
    presetId = DEFAULT_PRESET;
    /** page clock (ms) that maps to sim time 0, shifted forward on hitches */
    private t0 = 0;
    frames = 0;
    timings: Timings & { visibleMs: number | null } = { settingsMs: 0, collisionMs: null, firstFrameMs: null, visibleMs: null };
    /** resolves when the streamed splats have been rendered (loading finished, splats on screen) */
    visible!: Promise<void>;
    crashes = 0;
    flightStartTick = 0;
    private lagQueue: number[] = [];
    onFrame: ((s: FlightSession, dtMs: number) => void) | null = null;
    onEvent: ((e: SimEvent) => void) | null = null;
    private evIdx = 0;
    readonly createdAt = performance.now();

    static async start(canvas: HTMLCanvasElement, o: SessionOptions): Promise<FlightSession> {
        const s = new FlightSession();
        await s.init(canvas, o);
        return s;
    }

    private async init(canvas: HTMLCanvasElement, o: SessionOptions): Promise<void> {
        const tS = performance.now();
        this.scene = await resolveScene(o.sceneId);
        this.timings.settingsMs = performance.now() - tS;
        this.presetId = o.preset && PRESETS[o.preset] ? o.preset : DEFAULT_PRESET;
        this.params = compileParams(PRESETS[this.presetId], o.overrides ?? {});
        this.renderer = await SplatRenderer.create(canvas, { renderScale: o.renderScale ?? 1, hFovDeg: this.params.cameraFovDeg, latencyMarker: !!o.latencyMarker });
        this.renderer.setToneMapping(this.scene.tonemapping);
        this.renderer.setBackground(this.scene.background);
        const splatLoad = this.renderer.loadSplat(this.scene.contentUrl);
        if (this.scene.collisionUrl) {
            const tC = performance.now();
            try {
                const fc = await fetchVoxelCollision(this.scene.collisionUrl);
                this.collision = fc.collision;
                const both = new Uint8Array(fc.jsonBytes.length + fc.binBytes.length);
                both.set(fc.jsonBytes, 0);
                both.set(fc.binBytes, fc.jsonBytes.length);
                this.collisionSha256 = sha256Hex(both);
                this.world = new VoxelContactWorld(fc.collision);
                this.timings.collisionMs = performance.now() - tC;
            } catch (e) {
                if (!(e instanceof NoCollisionError)) throw e;
            }
        }
        await splatLoad;
        this.visible = new Promise<void>((resolve) => {
            const sys = this.renderer.app.systems.gsplat!;
            let streaming = false;
            const handler = (_cam: unknown, _layer: unknown, ready: boolean, loading: number) => {
                // coarse level streamed in and fully resident -> reveal, then stream the detail
                if (loading > 0) streaming = true;
                if (ready && loading === 0 && streaming) {
                    sys.off('frame:ready', handler);
                    this.timings.visibleMs = performance.now() - this.createdAt;
                    this.renderer.revealFullDetail();
                    resolve();
                }
            };
            sys.on('frame:ready', handler);
            setTimeout(() => { this.renderer.revealFullDetail(); resolve(); }, 30000); // never block the pilot forever
        });
        this.setupSim(o);
        this.renderer.app.on('update', () => this.frame());
        this.renderer.app.on('frameend', () => {
            if (this.timings.firstFrameMs === null) this.timings.firstFrameMs = performance.now() - this.createdAt;
        });
        this.renderer.start();
        this.lagFrames = o.lagFrames ?? 0;
    }

    lagFrames = 0;

    private setupSim(o: SessionOptions): void {
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
        this.spawn = [pos[0], pos[1], pos[2], yaw];
        this.sim = new Sim(this.params, this.world);
        this.sim.reset(pos[0], pos[1], pos[2], yaw);
        this.sim.hoverThr = hoverSolve(this.params, 1).motor;
        this.log = new InputLog({
            format: 'gsfpv-input-log/1',
            simCore: SIM_CORE_VERSION,
            preset: this.presetId,
            configHash: sha256Hex(new TextEncoder().encode(JSON.stringify({ o: o.overrides ?? {}, p: this.presetId }))),
            collisionSha256: this.collisionSha256,
            spawn: this.spawn,
            seed: 0
        });
        this.runner = new Runner(this.sim, this.log, !!o.traceHash);
        this.t0 = performance.now();
    }

    /** page time (ms, performance.now() / event.timeStamp) -> sim microseconds */
    toSimUs(tMs: number): number {
        return Math.round((tMs - this.t0) * 1000);
    }

    /** Feed a channel frame from any input source. */
    input(ch: ArrayLike<number>, tMs: number, id?: number): void {
        if (!this.runner) return;
        this.runner.enqueue({ tUs: this.toSimUs(tMs), ch, id });
    }

    private frame(): void {
        const now = performance.now();
        const target = this.toSimUs(now);
        const before = this.runner.hitches;
        this.runner.advanceTo(target);
        if (this.runner.hitches > before) {
            // long pause (hidden tab, debugger): skip wall time instead of fast-forwarding physics
            const lag = target - this.sim.tick * 1000;
            this.t0 += lag / 1000;
        }
        // events
        for (; this.evIdx < this.runner.events.length; this.evIdx++) {
            const e = this.runner.events[this.evIdx];
            if (e.type === 'crash') this.crashes++;
            this.onEvent?.(e);
        }
        if (this.runner.events.length > 2048) {
            this.runner.events.splice(0, this.evIdx);
            this.evIdx = 0;
        }
        // render pose, extrapolated over the < 1 ms remainder
        const s = this.sim.s;
        const frac = Math.max(0, Math.min(0.001, (this.toSimUs(now) - this.sim.tick * 1000) / 1e6));
        this.renderer.setPose(s[S.px] + s[S.vx] * frac, s[S.py] + s[S.vy] * frac, s[S.pz] + s[S.vz] * frac, s[S.qw], s[S.qx], s[S.qy], s[S.qz], this.params.cameraUptiltDeg);
        // latency marker: id of the last input the physics consumed (optionally delayed N frames)
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

    respawn(): void {
        this.runner.respawn(this.spawn[0], this.spawn[1], this.spawn[2], this.spawn[3]);
        this.flightStartTick = this.sim.tick;
    }

    /** HUD numbers */
    hud(): { armed: boolean; crashed: boolean; throttlePct: number; speed: number; altitude: number; timeS: number; crashes: number; volts: number; roll: number; pitch: number } {
        const s = this.sim.s;
        const a = attitude(s);
        return {
            armed: s[S.armed] > 0,
            crashed: s[S.crashed] > 0,
            throttlePct: Math.round(((this.sim.ch[2] + 1) / 2) * 100),
            speed: Math.hypot(s[S.vx], s[S.vy], s[S.vz]),
            altitude: s[S.py] - this.spawn[1],
            timeS: (this.sim.tick - this.flightStartTick) / 1000,
            crashes: this.crashes,
            volts: s[S.volt],
            roll: a.roll,
            pitch: a.pitch
        };
    }
}
