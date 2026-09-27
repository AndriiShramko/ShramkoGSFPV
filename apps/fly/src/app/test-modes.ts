// Test-only switches, never linked from the site:
//   ?simradio=scenario|open  a bot flies a plan (open: in an empty world); &tour, &dash, &quick, &flip, &loop
//   ?simradio=raw            a simulated EdgeTX radio runs the calibration wizard like a person
//   ?lat=1                   keyboard input and the latency harness keys (F20 lag toggle, F24 report)
import { makePlan, makeTourPlan, Scenario } from '@gsfpv/input/sim';
import { findSphereSpawn, VoxelContactWorld, syntheticOpen } from '@gsfpv/collision';
import { FakeEdgeTx } from '../devices/fakehid';
import { LatencyProbe } from '../latency';
import { RadioScreen } from '../ui/radio';
import { q } from './env';
import { newLife } from './lives';
import type { FlightContext } from './context';

/** Start the test mode the URL asks for; false: none, the pilot's own input flies. */
export function startTestMode(ctx: FlightContext): boolean {
    const simMode = q.get('simradio');
    if (simMode === 'scenario' || simMode === 'open') scenario(ctx, simMode);
    else if (simMode === 'raw') simRadio(ctx);
    else if (q.get('lat') === '1') {
        ctx.controls.source = 'keyboard';
        ctx.input.keyboard.setActive(true);
    } else return false;
    return true;
}

function scenario(ctx: FlightContext, simMode: 'scenario' | 'open'): void {
    const session = ctx.session;
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
    const toPlanStart = (): void => session.runner.respawn(plan.spawn[0], plan.spawn[1], plan.spawn[2], plan.spawnYawDeg);
    newLife(ctx, 'manual-start', toPlanStart);
    if (simMode === 'open') session.sim.world = new VoxelContactWorld(syntheticOpen(0.05, 1000));
    ctx.hook.scenario = new Scenario(session.runner, plan);
    ctx.controls.source = 'sim';
    // B17: crash loop — after each crash settles, respawn and fly the same plan again
    let loopsLeft = Number(q.get('loop') ?? 0);
    ctx.hook.loops = 0;
    let restSince = 0;
    if (loopsLeft > 0) {
        // subscribed after every feature: it runs after the crash view and the HUD of this frame
        ctx.events.on('frame', () => {
            const sc = ctx.hook.scenario;
            if (!sc || !sc.finished || loopsLeft <= 0) { restSince = 0; return; }
            const now = performance.now();
            if (!restSince) restSince = now;
            if (now - restSince < 2500) return; // crash camera and overlay play out first
            restSince = 0;
            loopsLeft--;
            ctx.hook.loops = (ctx.hook.loops ?? 0) + 1;
            newLife(ctx, 'manual-start', toPlanStart);
            ctx.hook.scenario = new Scenario(session.runner, plan);
        });
    }
}

/** A simulated EdgeTX radio (raw 19-byte reports) running the calibration wizard like a person. */
function simRadio(ctx: FlightContext): void {
    const fake = new FakeEdgeTx({
        order: q.get('order') ?? 'TAER',
        invert: Object.fromEntries((q.get('inv') ?? 'E').split('').filter(Boolean).map((k) => [k, true])),
        centerOffset: Number(q.get('offset') ?? 0.03),
        noise: Number(q.get('noise') ?? 0.01),
        armChannel: Number(q.get('armch') ?? 4), // -1: no switch on any channel (fresh EdgeTX model)
        rateHz: Number(q.get('rate') ?? 250),
        seed: 7,
        brokenStick: (q.get('broken') as 'A' | 'E' | 'T' | 'R' | null) ?? undefined,
        reactMs: Number(q.get('react') ?? 0),
        // &human=<seed>: one of the simulated people (their mistakes, hints read, buttons pressed)
        humanSeed: q.get('human') !== null ? Number(q.get('human')) : undefined
    });
    ctx.hook.fake = fake;
    ctx.pause('controls');
    const r = new RadioScreen(ctx.ui);
    ctx.hook.radio = r;
    fake.follow = () => r.wizard?.state ?? null;
    fake.onAct = (a) => {
        const w = r.wizard;
        if (!w) return;
        if (a.kind === 'fly') document.querySelector<HTMLButtonElement>('[data-action="wizard-done"]')?.click();
        else if (a.kind === 'pick') w.pick(a.ch);
        else w[a.kind]();
    };
    r.runWizard(fake.key, 'SimRadio EdgeTX Classic', (cb) => { fake.onFrame = cb; }, () => fake.cfg.rateHz, 'hid');
    r.onDone = (c) => {
        r.remove();
        ctx.resume('controls');
        ctx.controls.setProfile(c.profile);
        ctx.controls.source = 'hid';
        fake.follow = null;
        fake.onAct = null;
        fake.onFrame = (f) => ctx.controls.raw(f);
    };
    fake.start();
}

/** ?lat=1: F20 toggles two frames of added lag, F24 posts the probe's records to the harness. */
export function latencyHarness(ctx: FlightContext): void {
    if (q.get('lat') !== '1') return;
    const session = ctx.session;
    const probe = new LatencyProbe(session);
    const nonce = q.get('nonce') ?? '';
    document.title = `GSFPV-LAT ${nonce} ready dpr=${devicePixelRatio}`;
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
