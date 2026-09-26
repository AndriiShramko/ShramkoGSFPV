// A9, latency method step 6 (frame cost), informational, not a gate. Per-pass GPU time from
// WebGPU timestamp queries plus CPU time per engine tick, scene 39e63ce9 (has collision):
//   yaw600 - acro yaw at 600 deg/s in place: the bot holds position, the yaw stick comes from the
//            inverse of the craft's own rate curve; if the craft cannot reach the rate, the camera
//            yaws kinematically at exactly that rate while the bot keeps hovering (physics still runs)
//   wall03 - hover 0.3 m (craft centre to the surface) from a wall found with the collision, facing it
// Every scenario is measured at render scale 1, sqrt(2), 2 (1x, 2x, 4x pixels) and 1 again. More
// pixels must raise the measured GPU time; that is the negative control. Verdicts are computed in
// tools/bench/src/a9-frame.ts; this page only measures and reports raw numbers. Measure the lab
// build (GSFPV_LAB=1 vite build + vite preview): the dev server loads PlayCanvas's debug engine,
// whose extra validation would be measured as frame cost. env.engineBuild records which one ran.
import { GpuPassTimer, CpuFrameTimer } from '@gsfpv/render-pc';
import type { GpuFrameSample, CpuFrameSample } from '@gsfpv/render-pc';
import { S, attitude, invertRate, maxRate, RAD2DEG, DEG2RAD } from '@gsfpv/sim-core';
import type { Sim } from '@gsfpv/sim-core';
import { BotPilot, findWall } from '@gsfpv/input/sim';
import { FlightSession } from '../src/session';

const out: Record<string, unknown> = { status: 'running', phase: 'load' };
(window as unknown as { __frame: unknown }).__frame = out;

const q = new URLSearchParams(location.search);
const SCENE = q.get('scene') ?? '39e63ce9';
const N = Number(q.get('n') ?? 240); // measured frames per window
const WARM = Number(q.get('warm') ?? 45); // frames after a render-scale change
const TRAIL = 12; // frames for the async timestamp readback of the last measured frames
const SCALES = (q.get('scales') ?? '1,1.4142135623730951,2,1').split(',').map(Number);
const ONLY = (q.get('only') ?? 'yaw,wall').split(',');
const YAW_RATE = Number(q.get('rate') ?? 600); // deg/s
const STANDOFF = Number(q.get('standoff') ?? 0.3); // m
const FORCE_KIN = q.get('yaw') === 'kin';

interface Stats { n: number; median: number; p95: number; mean: number; sd: number; min: number; max: number; distinct: number }

const r4 = (x: number) => Math.round(x * 1e4) / 1e4;

function stats(xs: number[]): Stats | null {
    const a = xs.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
    if (!a.length) return null;
    const pick = (p: number) => a[Math.min(a.length - 1, Math.round(p * (a.length - 1)))];
    const mean = a.reduce((s, x) => s + x, 0) / a.length;
    const sd = Math.sqrt(a.reduce((s, x) => s + (x - mean) ** 2, 0) / a.length);
    // distinct at 1 us: a timer that returns the same number every frame is not measuring
    const distinct = new Set(a.map((x) => Math.round(x * 1000))).size;
    return { n: a.length, median: r4(pick(0.5)), p95: r4(pick(0.95)), mean: r4(mean), sd: r4(sd), min: r4(a[0]), max: r4(a[a.length - 1]), distinct };
}

async function adapterInfo(): Promise<Record<string, unknown>> {
    try {
        const gpu = (navigator as unknown as { gpu?: { requestAdapter(o: object): Promise<{ features: Set<string>; info?: Record<string, string> } | null> } }).gpu;
        if (!gpu) return { webgpu: false };
        const ad = await gpu.requestAdapter({ powerPreference: 'high-performance' });
        if (!ad) return { webgpu: true, adapter: null };
        const i = ad.info ?? {};
        return { webgpu: true, vendor: i.vendor, architecture: i.architecture, device: i.device, description: i.description, hasTimestampQuery: ad.features.has('timestamp-query') };
    } catch (e) {
        return { error: String(e) };
    }
}

async function run() {
    const canvas = document.getElementById('c') as HTMLCanvasElement;
    const session = await FlightSession.start(canvas, { sceneId: SCENE, renderScale: 1 });
    const r = session.renderer;
    const app = r.app;
    const device = r.device;
    const col = session.collision;
    if (!col) throw new Error(`scene ${SCENE} has no collision`);

    const frames = (n: number) => new Promise<void>((res) => {
        let k = 0;
        const h = () => { if (++k >= n) { app.off('frameend', h); res(); } };
        app.on('frameend', h);
    });
    const waitFor = async (pred: () => boolean, timeoutMs: number): Promise<boolean> => {
        const t0 = performance.now();
        while (performance.now() - t0 < timeoutMs) {
            if (pred()) return true;
            await frames(1);
        }
        return pred();
    };
    const sleep = (ms: number): Promise<boolean> => waitFor(() => false, ms); // frame-paced, so the engine keeps ticking

    // streaming state: frame cost while splats still stream in is not the steady cost
    let loadingNow = -1;
    let readyNow = false;
    let inWindow = false;
    let streamingFrames = 0;
    app.systems.gsplat!.on('frame:ready', (_cam: unknown, _layer: unknown, ready: boolean, loading: number) => {
        readyNow = ready;
        loadingNow = loading;
        if (inWindow && loading > 0) streamingFrames++;
    });

    out.phase = 'settle';
    await session.visible;
    const tSettle = performance.now();
    let calm = 0;
    const settled = await waitFor(() => { calm = readyNow && loadingNow === 0 ? calm + 1 : 0; return calm >= 30; }, 45000);
    out.settle = { settled, ms: Math.round(performance.now() - tSettle), visibleMs: session.timings.visibleMs };

    // which engine runs: the debug build opens a 'validation' error scope in every frameStart and
    // render pass (WebgpuDebug), the release build never does; counted, not assumed from the URL.
    // Only 'validation': splat-transform's bake guards allocations with 'out-of-memory' scopes.
    const wgpu = (device as unknown as { wgpu?: { pushErrorScope: (filter: string) => unknown } }).wgpu;
    let validationScopes: number | null = null;
    if (wgpu) {
        const orig = wgpu.pushErrorScope;
        let n = 0;
        wgpu.pushErrorScope = function (this: unknown, filter: string) { if (filter === 'validation') n++; return orig.call(this, filter); };
        await frames(30);
        wgpu.pushErrorScope = orig;
        validationScopes = n;
    }

    const gpu = new GpuPassTimer(device);
    const cpu = new CpuFrameTimer(app);
    out.env = {
        engineBuild: import.meta.env.DEV ? 'debug' : 'release',
        viteMode: import.meta.env.MODE,
        validationScopesPer30Frames: validationScopes,
        userAgent: navigator.userAgent,
        devicePixelRatio: devicePixelRatio,
        viewportCss: [canvas.clientWidth, canvas.clientHeight],
        isWebGPU: r.isWebGPU,
        gsplatRenderer: r.currentRenderer,
        adapter: await adapterInfo()
    };
    out.gpuTimer = {
        supported: gpu.supported,
        mechanism: 'PlayCanvas 2.22.4 GPU profiler: WebGPU timestampWrites (begin/end) on every render and compute pass; raw per-frame timings taken from GpuProfiler.report, not the aggregated _frameTime',
        busyMs: 'sum of pass durations in one frame',
        spanMs: 'earliest pass begin -> latest pass end in one frame (idle gaps included)',
        resolution: 'Chrome without flags quantizes WebGPU timestamps (about 0.1 ms)'
    };

    // ---- bot: same input path as a pilot (channels through the Runner queue, 250 Hz) ----
    const sim: Sim = session.sim;
    const p = session.params;
    const rc = p.rates;
    const home: [number, number, number] = [session.spawn[0], session.spawn[1], session.spawn[2]];
    const bot = new BotPilot(p);
    bot.setTask({ kind: 'hover', target: home, yawDeg: session.spawn[3] }, sim);
    let yawStick: number | null = null;
    session.runner.onStep = (s) => {
        if (s.tick % 4 !== 0) return;
        // spinning: the bot keeps position and attitude, the yaw stick is ours
        if (yawStick !== null && bot.task.kind === 'hover') bot.task.yawDeg = attitude(s.s).yaw;
        const ch = bot.update(s);
        if (yawStick !== null && s.armed) ch[3] = yawStick;
        session.runner.enqueue({ tUs: (s.tick + 1) * 1000, ch });
    };
    const pos = (): [number, number, number] => [sim.s[S.px], sim.s[S.py], sim.s[S.pz]];
    const yawRate = () => -sim.s[S.wy] * RAD2DEG; // body yaw rate, right turn positive
    let contactCount = 0;
    const prevOnEvent = session.onEvent;
    session.onEvent = (e) => { prevOnEvent?.(e); if (e.type === 'contact' || e.type === 'crash') contactCount++; };
    const contacts = () => contactCount;

    out.phase = 'arm';
    const armed = await waitFor(() => sim.armed, 10000);
    if (!armed) throw new Error('bot did not arm');
    await sleep(3000); // settle the hover

    // ---- one measured window at one render scale ----
    interface FrameProbe { perFrame(): void; summary(): Record<string, unknown> }
    const measure = async (label: string, scale: number, probe: FrameProbe): Promise<Record<string, unknown>> => {
        r.setRenderScale(scale);
        await frames(WARM);
        const size = [canvas.width, canvas.height];
        const frameEnds: number[] = [];
        const onEnd = () => { frameEnds.push(performance.now()); probe.perFrame(); };
        streamingFrames = 0;
        inWindow = true;
        const crashedBefore = sim.crashed;
        app.on('frameend', onEnd);
        gpu.begin();
        cpu.begin();
        await frames(N);
        const rvEnd = (device as unknown as { renderVersion: number }).renderVersion;
        const cpuS: CpuFrameSample[] = cpu.end();
        app.off('frameend', onEnd);
        inWindow = false;
        await frames(TRAIL);
        const gpuS: GpuFrameSample[] = gpu.end().filter((g) => g.renderVersion <= rvEnd);
        // GpuPassTimer.dropped counts only reports that ARRIVED without timings; a readback that fails
        // to map never reports at all, so lost frames show as samples < frames, not here
        const emptyReports = gpu.dropped;
        const perPass: Record<string, number[]> = {};
        for (const g of gpuS) {
            const inFrame: Record<string, number> = {};
            for (const ps of g.passes) inFrame[ps.name] = (inFrame[ps.name] ?? 0) + ps.ms;
            for (const [k, v] of Object.entries(inFrame)) (perPass[k] ??= []).push(v);
        }
        const passes: Record<string, number | null> = {};
        for (const [k, v] of Object.entries(perPass)) passes[k] = stats(v)?.median ?? null;
        return {
            label,
            renderScale: scale,
            canvasPx: size,
            pixels: size[0] * size[1],
            frames: frameEnds.length,
            streamingFrames,
            crashedDuring: !crashedBefore && sim.crashed,
            gpu: {
                samples: gpuS.length,
                emptyReports,
                passesPerFrame: stats(gpuS.map((g) => g.passes.length))?.median ?? null,
                busyMs: stats(gpuS.map((g) => g.busyMs)),
                spanMs: stats(gpuS.map((g) => g.spanMs)),
                passMedianMs: passes
            },
            cpu: {
                totalMs: stats(cpuS.map((c) => c.totalMs)),
                updateMs: stats(cpuS.map((c) => c.updateMs)),
                renderMs: stats(cpuS.map((c) => c.renderMs))
            },
            frameIntervalMs: stats(frameEnds.slice(1).map((t, i) => t - frameEnds[i])),
            scenario: probe.summary()
        };
    };
    const scenarios: Record<string, unknown> = {};
    out.scenarios = scenarios;

    // ---- yaw600 ----
    if (ONLY.includes('yaw')) {
        out.phase = 'yaw600';
        const maxYaw = maxRate(rc, 'yaw');
        const stick = invertRate(rc.type, YAW_RATE, rc.yaw, rc.rateLimit);
        const sc: Record<string, unknown> = { targetRateDegS: YAW_RATE, craftMaxYawRateDegS: maxYaw, yawStick: r4(stick), home: home.map(r4) };
        scenarios.yaw600 = sc;
        let mode: 'bot' | 'kinematic' = FORCE_KIN ? 'kinematic' : 'bot';
        if (mode === 'bot') {
            yawStick = stick;
            await sleep(2000); // spin up
            const rates: number[] = [];
            await waitFor(() => { rates.push(yawRate()); return false; }, 1500);
            const med = stats(rates)?.median ?? 0;
            const d = Math.hypot(pos()[0] - home[0], pos()[1] - home[1], pos()[2] - home[2]);
            sc.botCheck = { medianRateDegS: r4(med), driftM: r4(d), crashed: sim.crashed };
            if (sim.crashed || Math.abs(med - YAW_RATE) > 0.1 * YAW_RATE || d > 0.5) {
                mode = 'kinematic';
                yawStick = null;
                if (sim.crashed) {
                    session.runner.respawn(home[0], home[1], home[2], session.spawn[3]);
                    bot.setTask({ kind: 'hover', target: home, yawDeg: session.spawn[3] }, sim);
                    await waitFor(() => sim.armed, 10000);
                }
                await sleep(2000);
            }
        }
        sc.mode = mode;
        // kinematic: the camera turns at exactly the target rate at the craft's position
        let kinYaw = attitude(sim.s).yaw;
        let kinT = performance.now();
        const onKin = () => {
            const now = performance.now();
            kinYaw += (YAW_RATE * (now - kinT)) / 1000;
            kinT = now;
            const h = -kinYaw * DEG2RAD * 0.5;
            const [x, y, z] = pos();
            r.setPose(x, y, z, Math.cos(h), 0, Math.sin(h), 0, p.cameraUptiltDeg);
        };
        if (mode === 'kinematic') {
            session.cameraOverride = true;
            app.on('update', onKin);
            await frames(30);
        }
        const windows: unknown[] = [];
        for (const s of SCALES) {
            const rates: number[] = [];
            const drift: number[] = [];
            let camPrev: number | null = null;
            let camT = 0;
            const probe: FrameProbe = {
                perFrame: () => {
                    if (mode === 'bot') rates.push(yawRate());
                    else {
                        const now = performance.now();
                        if (camPrev !== null && now > camT) rates.push(((kinYaw - camPrev) * 1000) / (now - camT));
                        camPrev = kinYaw;
                        camT = now;
                    }
                    const q0 = pos();
                    drift.push(Math.hypot(q0[0] - home[0], q0[1] - home[1], q0[2] - home[2]));
                },
                summary: () => ({ yawRateDegS: stats(rates), driftFromHomeM: stats(drift) })
            };
            windows.push(await measure(`yaw600 x${r4(s * s)}`, s, probe));
        }
        sc.windows = windows;
        if (mode === 'kinematic') {
            app.off('update', onKin);
            session.cameraOverride = false;
        }
        yawStick = null;
        bot.setTask({ kind: 'hover', target: home, yawDeg: session.spawn[3] }, sim);
        r.setRenderScale(1);
        await sleep(3000);
    }

    // ---- wall03 ----
    if (ONLY.includes('wall')) {
        out.phase = 'wall03';
        if (sim.crashed) {
            session.runner.respawn(home[0], home[1], home[2], session.spawn[3]);
            bot.setTask({ kind: 'hover', target: home, yawDeg: session.spawn[3] }, sim);
            await waitFor(() => sim.armed, 10000);
            await sleep(3000);
        }
        const from = pos();
        const ray = (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, m: number) => col.queryRay(ox, oy, oz, dx, dy, dz, m);
        const wall = findWall(ray, from, 1, 8);
        const sc: Record<string, unknown> = { requestedStandoffM: STANDOFF, boundRadiusM: r4(p.boundRadius), from: from.map(r4) };
        scenarios.wall03 = sc;
        if (!wall) {
            sc.error = 'no wall 1..8 m from the hover point (horizontal rays every 10 deg)';
        } else {
            const [dx, , dz] = wall.dir;
            const at = (d: number): [number, number, number] => [from[0] + dx * (wall.dist - d), from[1], from[2] + dz * (wall.dist - d)];
            // the craft's bounding sphere must be clear of the wall at the hold point
            const push = { x: 0, y: 0, z: 0 };
            let standoff = STANDOFF;
            while (standoff < 1 && col.querySphere(...at(standoff), p.boundRadius, push)) standoff += 0.02;
            const target = at(standoff);
            Object.assign(sc, { wallYawDeg: wall.yawDeg, wallDistFromStartM: r4(wall.dist), holdStandoffM: r4(standoff), target: target.map(r4) });
            bot.setTask({ kind: 'path', points: [target], speed: 1, yawDeg: wall.yawDeg }, sim);
            const reached = await waitFor(() => bot.status.done || sim.crashed, 20000);
            bot.setTask({ kind: 'hover', target, yawDeg: wall.yawDeg }, sim);
            await sleep(3000);
            const distNow = () => {
                const [x, y, z] = pos();
                const h = col.queryRay(x, y, z, dx, 0, dz, 3);
                return h ? Math.hypot(h.x - x, h.z - z) : NaN;
            };
            sc.approach = { reached, crashed: sim.crashed, distAfterSettleM: r4(distNow()) };
            const c0 = contacts();
            const windows: unknown[] = [];
            for (const s of SCALES) {
                const dist: number[] = [];
                const probe: FrameProbe = {
                    perFrame: () => { dist.push(distNow()); },
                    summary: () => ({ distToWallM: stats(dist) })
                };
                windows.push(await measure(`wall03 x${r4(s * s)}`, s, probe));
            }
            sc.windows = windows;
            sc.contactsDuringWindows = contacts() - c0;
        }
        r.setRenderScale(1);
    }

    gpu.dispose();
    cpu.dispose();
    Object.assign(out, { status: 'done', phase: 'done', visibility: document.visibilityState });
}

run().catch((e) => Object.assign(out, { status: 'error', error: String(e?.stack ?? e) }));
