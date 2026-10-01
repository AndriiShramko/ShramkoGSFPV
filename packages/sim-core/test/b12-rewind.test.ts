// accept-fly B12's negative control in the browser (wave 2, after model-pinned.test.ts): the bot's
// 0.75 m/s dash into a wall on scene 39e63ce9 still ended in a crash in system Chrome. The page's
// own flight log (fixtures/b12-control-chrome-life.json, its last life) replays here bit for bit
// and shows why. The flight model is not at fault:
//  1. the slow touch (0.75 m/s, tick 16770 of that flight) did not crash; the craft tumbled
//     against the wall and slid down it on its side for 6 s, as v0.2's craft did (up-vector y -0.38);
//  2. the page's respawn director (set.respawn.auto=0 turns off the crash respawn only; unstuck
//     stays on) saw it flipped and still for 1.5 s and rewound it 5 s along its path: level, at
//     rest, armed, 0.41 m before the same wall (tick 22810);
//  3. the bot's dash reference ran on with the clock: 10 m past the wall by then. kp x 10 m hit the
//     acceleration cap, so it sent full throttle and full forward pitch, tilted the craft 75 deg and
//     flew it into the wall at 3.2 m/s; the bounce spun it to 68 rad/s and a duct hit at 5.2 m/s:
//     a crash (tick 23092).
// The Node model of B12 (v03-respawn-model.ts, model-pinned.test.ts) runs without the director,
// so it never saw step 2. Fix in the bot (input/src/sim/bot.ts): a dash reference never leads the
// craft by more than max(0.5 m, 0.5 s x speed); a craft held back restarts the dash from where it
// is. Control: bot.dashLeadS = Infinity, the reference before the fix.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import { InputLog, LifePlayer, Runner, S, Sim, compileParams, hoverSolve, lifeParams, lifeSim, normalizeRespawnOpts } from '../src/index';
import type { Life, LifeHeader, ReplayDeps, SimEvent } from '../src/index';
// test-only imports across packages, as model-pinned.test.ts does
import { VoxelContactWorld, findSphereSpawn, openVoxelCollision } from '../../collision/src/index';
import type { VoxelCollision, VoxelMetadata } from '../../collision/src/index';
import { BotPilot } from '../../input/src/sim/bot';
import { Scenario } from '../../input/src/sim/scenario';
import { makePlan } from '../../input/src/sim/plan';
import { PRESET, attachDirector } from './log-kit';

const FIX = join(__dirname, '..', '..', '..', 'fixtures', '39e63ce9');
let COL: VoxelCollision;
let CAM: { position: number[]; target: number[] };
interface Recorded {
    dash: { kind: 'dash'; from: [number, number, number]; dir: [number, number, number]; speed: number; yawDeg: number; t0: number };
    page: { crash: { tick: number; speed: number } };
    life: { header: LifeHeader; b64: string; endTick: number; hash: string; hashFrom: number };
}
let REC: Recorded;

beforeAll(() => {
    const meta = JSON.parse(readFileSync(join(FIX, 'scene.voxel.json'), 'utf8')) as VoxelMetadata;
    let bin = new Uint8Array(readFileSync(join(FIX, 'scene.voxel.bin')));
    if (bin[0] === 0x1f && bin[1] === 0x8b) bin = new Uint8Array(gunzipSync(bin));
    COL = openVoxelCollision(meta, bin);
    CAM = JSON.parse(readFileSync(join(FIX, 'settings.json'), 'utf8')).cameras[0].initial;
    REC = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'b12-control-chrome-life.json'), 'utf8')) as Recorded;
});

type Crash = Extract<SimEvent, { type: 'crash' }>;

/** B12's flight as the page flies it: makePlan + Scenario, and the page's director with respawn.auto off. */
function b12(dash: 'control' | 'crash', leadS: number): { crashes: Crash[]; contacts: number; rewinds: string[]; restarts: number } {
    const p = compileParams(PRESET, {});
    const world = new VoxelContactWorld(COL);
    let pos = [...CAM.position];
    const R = p.boundRadius + 0.03;
    if (COL.querySphere(pos[0], pos[1], pos[2], R, { x: 0, y: 0, z: 0 })) {
        const out = { x: 0, y: 0, z: 0 };
        if (findSphereSpawn(COL, pos[0], pos[1], pos[2], R, out)) pos = [out.x, out.y, out.z];
    }
    const sim = new Sim(p, world);
    sim.reset(pos[0], pos[1], pos[2], 0);
    sim.hoverThr = hoverSolve(p, 1).motor;
    const runner = new Runner(sim, new InputLog({ format: 'gsfpv-input-log/1', simCore: 'test', preset: PRESET.id, configHash: '', collisionSha256: null, spawn: [pos[0], pos[1], pos[2], 0], seed: 0 }));
    const plan = makePlan(COL, p.boundRadius, pos, CAM.target, dash === 'control' ? 0.5 * p.vBounce : 2 * p.vCrash, (x, y, z, r, o) => findSphereSpawn(COL, x, y, z, r, o));
    runner.respawn(plan.spawn[0], plan.spawn[1], plan.spawn[2], plan.spawnYawDeg);
    const d = attachDirector(runner, [plan.spawn[0], plan.spawn[1], plan.spawn[2], plan.spawnYawDeg], { auto: false });
    const sc = new Scenario(runner, plan);
    sc.bot.dashLeadS = leadS;
    const out = { crashes: [] as Crash[], contacts: 0, rewinds: [] as string[], restarts: 0 };
    let seen = 0;
    let lastDecision: unknown = null;
    for (let t = 16667; !sc.finished && sim.tick < 40000; t += 16667) {
        runner.advanceTo(t);
        if (d.last && d.last !== lastDecision) { lastDecision = d.last; out.rewinds.push(d.last.reason); }
        for (; seen < runner.events.length; seen++) {
            const e = runner.events[seen];
            if (e.type === 'crash') out.crashes.push(e);
            else if (e.type === 'contact') out.contacts++;
        }
    }
    out.restarts = sc.bot.dashRestarts;
    return out;
}

function recordedLife(): { life: Life; deps: ReplayDeps } {
    const bytes = new Uint8Array(Buffer.from(REC.life.b64, 'base64'));
    const life: Life = { header: REC.life.header, bytes: () => bytes, endTick: REC.life.endTick, traceHash: REC.life.hash, hashFrom: REC.life.hashFrom };
    const world = new VoxelContactWorld(COL);
    return { life, deps: { preset: () => REC.life.header.presetJson ?? null, world: () => world } };
}

/**
 * The recorded life flown again closed loop: its start (the rewind), the bot on the same dash task
 * and clock, its sticks every 4 ticks as the Scenario sends them (float32, as the runner applies
 * them), until the crash comes to rest. With the control the states equal the recording's.
 */
function flyRecordedLife(leadS: number, each?: (sim: Sim) => void): { crashes: Crash[]; contacts: number; restarts: number } {
    const { life, deps } = recordedLife();
    const h = life.header;
    const sim = lifeSim(lifeParams(h, deps), deps.world(h.scene, null));
    sim.tick = h.life.startTick;
    sim.setChannels(h.life.ch);
    sim.respawn(h.life.at[0], h.life.at[1], h.life.at[2], h.life.at[3], { ...normalizeRespawnOpts(h.life.opts), soc: h.life.soc });
    const bot = new BotPilot(sim.p);
    const { t0, ...task } = REC.dash;
    bot.setTask(task, sim);
    // the dash began 14 s before this life (scenario phase 'dash'); the bot's clock runs from there
    (bot as unknown as { dashT0: number }).dashT0 = t0;
    bot.dashLeadS = leadS;
    const out = { crashes: [] as Crash[], contacts: 0, restarts: 0 };
    while (sim.tick < life.endTick) {
        const n = sim.events.length;
        sim.step();
        for (let i = n; i < sim.events.length; i++) {
            const e = sim.events[i];
            if (e.type === 'crash') out.crashes.push(e);
            else if (e.type === 'contact') out.contacts++;
        }
        each?.(sim);
        if (sim.tick % 4 === 0 && sim.s[S.crashed] < 2) sim.setChannels(Float32Array.from(bot.update(sim)));
    }
    out.restarts = bot.dashRestarts;
    return out;
}

describe('B12 control in the browser: a stuck-flipped rewind and the bot (root cause)', () => {
    it("the page's recorded life replays to its hash: a rewind 0.41 m before the wall, full throttle and pitch, a crash at 5.2 m/s", () => {
        const { life, deps } = recordedLife();
        expect(life.header.life.reason).toBe('stuck-flipped');
        expect(life.header.life.opts).toMatchObject({ platform: true, keepArmed: true });
        const p = new LifePlayer(life, deps, life.endTick, { hash: true });
        const crashes: Crash[] = [];
        let maxPitch = -1, maxThrottle = -1, vBefore = 0;
        p.onEvent = (e) => { if (e.type === 'crash') crashes.push(e); };
        p.onStep = (sim) => {
            if (sim.tick <= life.header.life.startTick + 60) { maxPitch = Math.max(maxPitch, sim.ch[1]); maxThrottle = Math.max(maxThrottle, sim.ch[2]); }
            if (crashes.length === 0) vBefore = Math.max(vBefore, Math.hypot(sim.s[S.vx], sim.s[S.vy], sim.s[S.vz]));
        };
        p.stepTo(life.endTick);
        expect(p.digest()).toBe(REC.life.hash);
        // 0.41 m from the wall (x = -5.2), at rest
        expect(life.header.life.at[0] - -5.2).toBeLessThan(0.45);
        expect(maxPitch).toBeGreaterThan(0.95);
        expect(maxThrottle).toBeGreaterThan(0.95);
        expect(crashes).toHaveLength(1);
        expect(crashes[0].tick).toBe(REC.page.crash.tick);
        expect(crashes[0].speed).toBe(REC.page.crash.speed);
        expect(vBefore).toBeGreaterThan(3);
    });

    it('flown again from that rewind, the bot restarts its dash and touches the wall without a crash; control: the old reference flies the recording tick for tick', () => {
        const fixed = flyRecordedLife(0.5);
        expect(fixed.crashes).toHaveLength(0);
        expect(fixed.contacts).toBeGreaterThan(0);
        expect(fixed.restarts).toBeGreaterThan(0);

        const { life, deps } = recordedLife();
        const rec = new LifePlayer(life, deps, life.endTick, { hash: false });
        let diverged = -1;
        const control = flyRecordedLife(Infinity, (sim) => {
            rec.stepTo(sim.tick);
            if (diverged < 0) for (let j = 0; j < S.size; j++) if (sim.s[j] !== rec.sim.s[j]) { diverged = sim.tick; break; }
        });
        expect(diverged).toBe(-1);
        expect(control.crashes).toHaveLength(1);
        expect(control.crashes[0].speed).toBe(REC.page.crash.speed);
    });

    it("the whole control flight with the page's director: a stuck-flipped rewind, then no crash; control: the old reference crashes after the rewind", () => {
        const vCrash = compileParams(PRESET, {}).vCrash;
        const fixed = b12('control', 0.5);
        expect(fixed.contacts).toBeGreaterThan(100);
        expect(fixed.crashes).toHaveLength(0);
        // the craft still ends up flipped against the wall and is rewound: the director is not the fix
        expect(fixed.rewinds).toContain('stuck-flipped');

        const old = b12('control', Infinity);
        expect(old.rewinds).toContain('stuck-flipped');
        expect(old.crashes).toHaveLength(1);
        expect(old.crashes[0].speed).toBeGreaterThan(vCrash);
    });

    it("B12's first half is untouched: the 8 m/s dash never restarts and crashes exactly as before, at >= 1.9 v_crash", () => {
        const vCrash = compileParams(PRESET, {}).vCrash;
        const fixed = b12('crash', 0.5);
        const old = b12('crash', Infinity);
        expect(fixed.restarts).toBe(0);
        expect(fixed.crashes).toHaveLength(1);
        expect(fixed.crashes[0].speed).toBeGreaterThanOrEqual(1.9 * vCrash);
        expect(fixed.crashes[0]).toEqual(old.crashes[0]);
    });
});
