// /fly entry. Phase A: load a scene by link, fly it with the keyboard or the SimRadio bot.
import { S } from '@gsfpv/sim-core';
import { parseSceneInput } from '@gsfpv/scenes';
import { Scenario, makePlan } from '@gsfpv/input/sim';
import { findSphereSpawn, VoxelContactWorld, syntheticOpen } from '@gsfpv/collision';
import { FlightSession } from './session';
import { KeyboardSource } from './devices/keyboard';
import { LatencyProbe } from './latency';
import { GSPLAT_RENDERER_RASTER_GPU_SORT } from 'playcanvas';

const q = new URLSearchParams(location.search);
const ui = document.getElementById('ui')!;
const canvas = document.getElementById('view') as HTMLCanvasElement;

interface TestHook {
    status: 'loading' | 'ready' | 'error';
    error?: string;
    session?: FlightSession;
    scenario?: Scenario;
    info?: Record<string, unknown>;
}
const hook: TestHook = { status: 'loading' };
(window as unknown as { __gsfpv: TestHook }).__gsfpv = hook;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
}

async function boot(): Promise<void> {
    const sceneId = parseSceneInput(q.get('scene') ?? '39e63ce9');
    const loading = el('div', 'loading');
    const box = el('div');
    box.append(el('div', undefined, 'Loading scene…'), el('div', 'bar'));
    (box.lastChild as HTMLElement).append(el('i'));
    loading.append(box);
    ui.append(loading);
    if (!sceneId) throw new Error('This is not a SuperSplat link or scene id.');
    const g = q.get('g');
    const gm = q.get('gm') as 'honest' | 'same-twr' | 'auto-throttle' | null;
    const session = await FlightSession.start(canvas, {
        sceneId,
        preset: q.get('drone') ?? undefined,
        overrides: { gravity: g ? Number(g) : undefined, gravityMode: gm ?? undefined },
        latencyMarker: q.get('lat') === '1',
        lagFrames: Number(q.get('lagFrames') ?? 0),
        renderScale: q.get('scale') ? Number(q.get('scale')) : 1,
        traceHash: q.get('trace') === '1'
    });
    hook.session = session;
    await session.visible;
    loading.remove();
    new KeyboardSource(session);

    const sim = q.get('simradio');
    if (sim === 'scenario' || sim === 'open') {
        if (!session.collision) throw new Error('the bot scenario needs a scene with collision');
        const col = session.collision;
        const p = session.params;
        const cam = session.scene.camera!;
        const plan = makePlan(col, p.boundRadius, [session.spawn[0], session.spawn[1], session.spawn[2]], cam.target, Number(q.get('dash') ?? 2 * p.vCrash),
            (x, y, z, r, o) => findSphereSpawn(col, x, y, z, r, o));
        session.runner.respawn(plan.spawn[0], plan.spawn[1], plan.spawn[2], plan.spawnYawDeg);
        // negative control: the identical plan flown in an open volume must not crash
        if (sim === 'open') session.sim.world = new VoxelContactWorld(syntheticOpen(0.05, 1000));
        hook.scenario = new Scenario(session.runner, plan);
    }

    buildHud(session);
    hook.info = {
        webgpu: session.renderer.isWebGPU,
        currentRenderer: session.renderer.currentRenderer,
        gpuSort: session.renderer.currentRenderer === GSPLAT_RENDERER_RASTER_GPU_SORT,
        hasCollision: !!session.collision,
        collisionSha256: session.collisionSha256,
        timings: session.timings,
        spawn: session.spawn,
        preset: session.presetId
    };
    hook.status = 'ready';
    if (q.get('lat') === '1') {
        // latency harness: numbered F13 presses, F24 posts the stage records to /report
        const probe = new LatencyProbe(session);
        const nonce = q.get('nonce') ?? '';
        document.title = `GSFPV-LAT ${nonce} ready dpr=${devicePixelRatio}`;
        addEventListener('keydown', (e) => {
            // F20 toggles the lagFrames control (0 <-> 2) so the harness can interleave both modes
            if (e.code === 'F20' || e.key === 'F20') {
                session.lagFrames = session.lagFrames === 0 ? 2 : 0;
                document.title = `GSFPV-LAT ${nonce} ready dpr=${devicePixelRatio} lag=${session.lagFrames}`;
                return;
            }
            if (e.code !== 'F24' && e.key !== 'F24') return;
            fetch('/report', { method: 'POST', body: JSON.stringify({ page: 'fly', lagFrames: session.lagFrames, records: probe.summary(), framePeriod: probe.framePeriod(), frames: session.frames, hitches: session.runner.hitches, renderer: session.renderer.currentRenderer, visibility: document.visibilityState, userAgent: navigator.userAgent }) })
                .then(() => { document.title = `GSFPV-LAT ${nonce} reported`; });
        });
    }
}

function buildHud(s: FlightSession): void {
    const tl = el('div', 'osd tl'), tr = el('div', 'osd tr'), bl = el('div', 'osd bl'), br = el('div', 'osd br');
    ui.append(tl, tr, bl, br);
    let last = 0;
    s.onFrame = () => {
        const now = performance.now();
        if (now - last < 100) return;
        last = now;
        const h = s.hud();
        tl.innerHTML = `<span class="${h.crashed ? 'crash' : h.armed ? 'armed' : 'disarmed'}">${h.crashed ? 'CRASH' : h.armed ? 'ARMED' : 'DISARMED'}</span>`;
        tr.textContent = `${h.volts.toFixed(1)} V  ${h.timeS.toFixed(1)} s`;
        bl.textContent = `THR ${h.throttlePct}%  ${h.speed.toFixed(1)} m/s  ALT ${h.altitude.toFixed(1)} m`;
        br.textContent = `crashes ${h.crashes}  ${s.presetId}`;
    };
    void S;
}

boot().catch((e) => {
    hook.status = 'error';
    hook.error = String(e?.message ?? e);
    const m = el('div', 'center-msg');
    m.append(el('div', 'error', hook.error));
    ui.replaceChildren(m);
    console.error(e);
});
