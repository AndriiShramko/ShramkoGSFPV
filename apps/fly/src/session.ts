// One flight: scene + collision + physics + renderer, driven from the engine's update event.
import { Sim, Runner, InputLog, S, compileParams, hoverSolve, SIM_CORE_VERSION, sha256Hex, attitude, spherePoses, replay as replayLog } from '@gsfpv/sim-core';
import type { SimParams, ParamOverrides, SimEvent, LogHeader } from '@gsfpv/sim-core';
import { fetchVoxelCollision, VoxelContactWorld, findSphereSpawn, NoCollisionError, openVoxelCollision } from '@gsfpv/collision';
import type { VoxelCollision, VoxelMetadata } from '@gsfpv/collision';
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
    /** page clock (ms) that maps to sim time 0, shifted forward on hitches and pauses */
    private t0 = 0;
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
    paused = false;
    private pausedAt = 0;
    /** when true the crash view owns the camera */
    cameraOverride = false;
    replayState: ReplayState | null = null;
    safePoint: [number, number, number, number] | null = null;
    private lastContactTick = -1e9;
    frameTimes: number[] = [];

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
        this.overrides = o.overrides ?? {};
        this.params = compileParams(PRESETS[this.presetId], this.overrides);
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
        this.spawn = this.findSpawn();
        this.buildSim();
        this.renderer.app.on('update', () => this.frame());
        this.renderer.app.on('frameend', () => {
            if (this.timings.firstFrameMs === null) this.timings.firstFrameMs = performance.now() - this.createdAt;
        });
        this.renderer.start();
        this.lagFrames = o.lagFrames ?? 0;
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
        this.t0 = performance.now();
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
        return Math.round((tMs - this.t0) * 1000);
    }

    /** Feed a channel frame from any input source. */
    input(ch: ArrayLike<number>, tMs: number, id?: number): void {
        if (!this.runner || this.paused || this.replayState) return;
        this.runner.enqueue({ tUs: this.toSimUs(tMs), ch, id });
    }

    pause(on: boolean): void {
        if (on === this.paused) return;
        if (on) this.pausedAt = performance.now();
        else this.t0 += performance.now() - this.pausedAt; // sim time does not advance while paused
        this.paused = on;
    }

    private frame(): void {
        const now = performance.now();
        this.frameTimes.push(now);
        if (this.frameTimes.length > 600) this.frameTimes.shift();
        if (this.replayState) {
            this.replayFrame(now);
            this.frames++;
            this.onFrame?.(this, 0);
            return;
        }
        if (!this.paused) {
            const target = this.toSimUs(now);
            const before = this.runner.hitches;
            this.runner.advanceTo(target);
            if (this.runner.hitches > before) {
                // long pause (hidden tab, debugger): skip wall time instead of fast-forwarding physics
                const lag = target - this.sim.tick * 1000;
                this.t0 += lag / 1000;
            }
        }
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
            const ox = wide ? g0[0] + rng() * gs[0] : this.spawn[0] + (rng() - 0.5) * 6;
            const oy = wide ? g0[1] + rng() * gs[1] : this.spawn[1] + (rng() - 0.5) * 2;
            const oz = wide ? g0[2] + rng() * gs[2] : this.spawn[2] + (rng() - 0.5) * 6;
            if (wide && !col.isFreeAt(ox, oy, oz)) continue;
            if (col.querySphere(ox, oy, oz, p.boundRadius + 0.05, push)) continue;
            const ang = rng() * Math.PI * 2;
            const dx = Math.cos(ang), dz = Math.sin(ang), dy = (rng() - 0.5) * 0.4;
            const dl = Math.hypot(dx, dy, dz);
            const hit = col.queryRay(ox, oy, oz, dx / dl, dy / dl, dz / dl, 6);
            if (!hit) continue;
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
