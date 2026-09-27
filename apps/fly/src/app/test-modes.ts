// Test-only query switches (never linked from the site):
//   ?simradio=scenario|open  the bot pilot flies a plan (&tour=1, &dash=m/s, &quick=1, &flip=1,
//                            &loop=N crash loops for B17); open: in a synthetic open volume
//   ?simradio=raw            a simulated EdgeTX radio runs the calibration wizard like a person
//                            (&order= &inv= &offset= &noise= &armch= &rate= &broken= &react= &human= &nobuttons=1)
//   ?lat=1                   latency harness: keyboard input, F20 toggles 2 lag frames, F24 reports
//   ?voxels=overlay|only &vstyle= &vopacity= &vradius=   the voxel grid for screenshots and checks
// Nothing here is remembered.
import { Scenario, makePlan, makeTourPlan, act } from '@gsfpv/input/sim';
import { findSphereSpawn, VoxelContactWorld, syntheticOpen } from '@gsfpv/collision';
import { FakeEdgeTx } from '../devices/fakehid';
import { LatencyProbe } from '../latency';
import { RadioScreen } from '../ui/radio';
import type { VoxelStyle } from '../voxels';
import { q } from './env';
import type { FlightContext } from './context';

/** Start the test input the URL asks for; false when there is none (the pilot's own input starts). */
export function startTestMode(ctx: FlightContext): boolean {
    const simMode = q.get('simradio');
    if (simMode === 'scenario' || simMode === 'open') {
        botPilot(ctx, simMode);
        return true;
    }
    if (simMode === 'raw') {
        simRadio(ctx);
        return true;
    }
    if (q.get('lat') === '1') {
        ctx.controls.source = 'keyboard';
        ctx.input.keyboard.setActive(true);
        return true;
    }
    return false;
}

function botPilot(ctx: FlightContext, simMode: 'scenario' | 'open'): void {
    const { session, controls, hook } = ctx;
    if (!session.collision) throw new Error('the bot scenario needs a scene with collision');
    const col = session.collision;
    const p = session.params;
    const cam = session.scene.camera!;
    const plan = q.get('tour') === '1'
        ? makeTourPlan(col, p.boundRadius, [session.spawn[0], session.spawn[1], session.spawn[2]], cam.target, Number(q.get('dash') ?? 2 * p.vCrash))
        : makePlan(col, p.boundRadius, [session.spawn[0], session.spawn[1], session.spawn[2]], cam.target, Number(q.get('dash') ?? 2 * p.vCrash),
            (x, y, z, r, o) => findSphereSpawn(col, x, y, z, r, o));
    if (q.get('quick') === '1') plan.box = [plan.spawn]; // crash loops: hover, aim, dash
    if (q.get('flip') === '1') {
        // flip point: straight above the spawn with 0.6 m of air above the craft (at most +1.5 m)
        const up = col.queryRay(plan.spawn[0], plan.spawn[1], plan.spawn[2], 0, 1, 0, 3);
        const room = up ? up.y - plan.spawn[1] - 0.6 - p.boundRadius : 1.5;
        plan.flipAt = [plan.spawn[0], plan.spawn[1] + Math.max(0, Math.min(1.5, room)), plan.spawn[2]];
    }
    session.runner.respawn(plan.spawn[0], plan.spawn[1], plan.spawn[2], plan.spawnYawDeg);
    if (simMode === 'open') session.sim.world = new VoxelContactWorld(syntheticOpen(0.05, 1000));
    hook.scenario = new Scenario(session.runner, plan);
    controls.source = 'sim';
    // B17: crash loop — after each crash settles, respawn and fly the same plan again
    let loopsLeft = Number(q.get('loop') ?? 0);
    hook.loops = 0;
    let restSince = 0;
    if (loopsLeft > 0) {
        ctx.events.on('frame', () => {
            const sc = hook.scenario;
            if (!sc || !sc.finished || loopsLeft <= 0) { restSince = 0; return; }
            const now = performance.now();
            if (!restSince) restSince = now;
            if (now - restSince < 2500) return; // crash camera and overlay play out first
            restSince = 0;
            loopsLeft--;
            hook.loops = (hook.loops ?? 0) + 1;
            ctx.clearCrash();
            session.runner.respawn(plan.spawn[0], plan.spawn[1], plan.spawn[2], plan.spawnYawDeg);
            hook.scenario = new Scenario(session.runner, plan);
        });
    }
}

function simRadio(ctx: FlightContext): void {
    const { controls, hook } = ctx;
    const fake = new FakeEdgeTx({
        order: q.get('order') ?? 'TAER',
        invert: Object.fromEntries((q.get('inv') ?? 'E').split('').filter(Boolean).map((k) => [k, true])),
        centerOffset: Number(q.get('offset') ?? 0.03),
        noise: Number(q.get('noise') ?? 0.01),
        armChannel: Number(q.get('armch') ?? 4), // -1: no switch on any channel (fresh EdgeTX model)
        rateHz: Number(q.get('rate') ?? 250),
        seed: 7,
        brokenStick: (q.get('broken') as 'A' | 'E' | 'T' | 'R' | null) ?? undefined,
        reactMs: Number(q.get('react') ?? 400),
        // &human=<seed>: one of the simulated people (their mistakes, hints read, buttons pressed)
        humanSeed: q.get('human') !== null ? Number(q.get('human')) : undefined,
        // &nobuttons=1: the hands follow the screens, no button is ever pressed (the wizard must stay put)
        noButtons: q.get('nobuttons') === '1'
    });
    hook.fake = fake;
    ctx.pause('controls');
    const r = new RadioScreen(ctx.ui);
    hook.radio = r;
    fake.follow = () => r.wizard?.state ?? null;
    fake.onAct = (a) => {
        const w = r.wizard;
        if (!w) return;
        // the same commands the wizard's buttons call; Fly through the button, which saves the profile
        if (a.kind === 'fly') document.querySelector<HTMLButtonElement>('[data-action="wizard-done"]')?.click();
        else act(w, a, performance.now());
    };
    r.runWizard(fake.key, 'SimRadio EdgeTX Classic', (cb) => { fake.onFrame = cb; }, () => fake.cfg.rateHz, 'hid');
    r.onDone = (c) => {
        r.remove();
        ctx.resume('controls');
        controls.setProfile(c.profile);
        controls.source = 'hid';
        fake.follow = null;
        fake.onAct = null;
        fake.onFrame = (f) => controls.raw(f);
    };
    fake.start();
}

/** ?lat=1: the latency probe, and the harness keys F20 (2 lag frames on / off) and F24 (report). */
export function latencyHarness(ctx: FlightContext): void {
    if (q.get('lat') !== '1') return;
    const session = ctx.session;
    const probe = new LatencyProbe(session);
    const nonce = q.get('nonce') ?? '';
    document.title = `GSFPV-LAT ${nonce} ready dpr=${devicePixelRatio}`;
    // F13-F24 are the harness's (keymap RESERVED_CODES), never the router's: their own listener
    addEventListener('keydown', (e) => {
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

/** ?voxels= &vstyle= &vopacity= &vradius=: the voxel grid for screenshots and checks, this load only. */
export function voxelSwitches(ctx: FlightContext): void {
    const voxels = ctx.voxels;
    const vq = q.get('voxels');
    const vs = q.get('vstyle');
    const vo = q.get('vopacity');
    const vr = q.get('vradius');
    if (vr) voxels.radiusM = Math.max(2, Math.min(60, Number(vr) || voxels.radiusM));
    if (vs || vo) voxels.configure({ style: (vs as VoxelStyle | null) ?? undefined, opacity: vo ? Number(vo) : undefined, mode: vq === 'overlay' || vq === 'only' ? vq : undefined });
    if (vq === 'overlay' || vq === 'only') voxels.setMode(vq);
}
