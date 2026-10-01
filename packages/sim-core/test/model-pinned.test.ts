// A craft pinned in a corner (sim.ts pinnedContacts). Root cause of accept-fly B12's negative
// control failing since wave 1: the bot's slow dash (0.5 x v_bounce = 0.75 m/s) into a wall on
// scene 39e63ce9 slid down the wall into a corner, where one duct grazing a slanted face won the
// sweep at t = 1e-12 every tick. The whole tick's motion was undone, but only that duct got an
// impulse, so the thrust driving two other ducts into the wall was never resolved: the pose froze
// while the speed grew to 8 m/s and the spin to 97 rad/s, and a "crash" at 6.1 m/s ended a touch
// that never moved faster than 0.75 m/s. v0.2 had the same single-impulse rule and its craft also
// tumbled against that wall (up-vector y -0.38) but never got pinned there; the wave-1 model's
// slightly different motion did. This is B12's own flight in Node (makePlan + Scenario, the page's
// path), on the CC BY fixture. Control: the single-impulse rule (Sim.pinnedPass false).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import { InputLog, Runner, S, Sim, compileParams, hoverSolve } from '../src/index';
import type { SimEvent } from '../src/index';
// test-only imports across packages, as respawn-realfloor.test.ts does
import { VoxelContactWorld, findSphereSpawn, openVoxelCollision } from '../../collision/src/index';
import type { VoxelCollision, VoxelMetadata } from '../../collision/src/index';
import { Scenario } from '../../input/src/sim/scenario';
import { makePlan } from '../../input/src/sim/plan';
import { PRESET } from './log-kit';

const FIX = join(__dirname, '..', '..', '..', 'fixtures', '39e63ce9');
let COL: VoxelCollision;
let CAM: { position: number[]; target: number[] };

beforeAll(() => {
    const meta = JSON.parse(readFileSync(join(FIX, 'scene.voxel.json'), 'utf8')) as VoxelMetadata;
    let bin = new Uint8Array(readFileSync(join(FIX, 'scene.voxel.bin')));
    if (bin[0] === 0x1f && bin[1] === 0x8b) bin = new Uint8Array(gunzipSync(bin));
    COL = openVoxelCollision(meta, bin);
    CAM = JSON.parse(readFileSync(join(FIX, 'settings.json'), 'utf8')).cameras[0].initial;
});

interface Run {
    crashes: Extract<SimEvent, { type: 'crash' }>[];
    contacts: number;
    /** longest run of ticks with the position moving under 1 um per tick while flying, and the speed at its end */
    frozenTicks: number;
    frozenSpeed: number;
    /** largest speed while not crashed, m/s */
    maxSpeed: number;
    minUpY: number;
}

/** accept-fly B12's control flight: the session's spawn, makePlan, respawn at the plan spawn, Scenario with a 0.75 m/s dash. */
function slowDash(pinnedPass: boolean): Run {
    const p = compileParams(PRESET, {});
    const world = new VoxelContactWorld(COL);
    let pos = [...CAM.position];
    const R = p.boundRadius + 0.03;
    const push = { x: 0, y: 0, z: 0 };
    if (COL.querySphere(pos[0], pos[1], pos[2], R, push)) {
        const out = { x: 0, y: 0, z: 0 };
        if (findSphereSpawn(COL, pos[0], pos[1], pos[2], R, out)) pos = [out.x, out.y, out.z];
    }
    const sim = new Sim(p, world);
    sim.pinnedPass = pinnedPass;
    sim.reset(pos[0], pos[1], pos[2], 0);
    sim.hoverThr = hoverSolve(p, 1).motor;
    const runner = new Runner(sim, new InputLog({ format: 'gsfpv-input-log/1', simCore: 'test', preset: PRESET.id, configHash: '', collisionSha256: null, spawn: [pos[0], pos[1], pos[2], 0], seed: 0 }));
    const plan = makePlan(COL, p.boundRadius, pos, CAM.target, 0.5 * p.vBounce, (x, y, z, r, o) => findSphereSpawn(COL, x, y, z, r, o));
    runner.respawn(plan.spawn[0], plan.spawn[1], plan.spawn[2], plan.spawnYawDeg);
    const sc = new Scenario(runner, plan);
    const run: Run = { crashes: [], contacts: 0, frozenTicks: 0, frozenSpeed: 0, maxSpeed: 0, minUpY: 1 };
    let last = [NaN, NaN, NaN];
    let frozen = 0;
    const prev = runner.onStep;
    runner.onStep = (x) => {
        prev?.(x);
        const s = x.s;
        if (s[S.crashed] > 0 || s[S.armed] === 0) { frozen = 0; return; }
        const v = Math.hypot(s[S.vx], s[S.vy], s[S.vz]);
        run.maxSpeed = Math.max(run.maxSpeed, v);
        run.minUpY = Math.min(run.minUpY, 1 - 2 * (s[S.qx] * s[S.qx] + s[S.qz] * s[S.qz]));
        // a pinned tick still moves the pose by t = 1e-12 of its path: under a micrometre is frozen
        if (Math.hypot(s[S.px] - last[0], s[S.py] - last[1], s[S.pz] - last[2]) < 1e-6) {
            frozen++;
            if (frozen > run.frozenTicks) { run.frozenTicks = frozen; run.frozenSpeed = v; }
        } else frozen = 0;
        last = [s[S.px], s[S.py], s[S.pz]];
    };
    let seen = 0;
    for (let t = 16667; !sc.finished && sim.tick < 40000; t += 16667) {
        runner.advanceTo(t);
        for (; seen < runner.events.length; seen++) {
            const e = runner.events[seen];
            if (e.type === 'crash') run.crashes.push(e);
            else if (e.type === 'contact') run.contacts++;
        }
    }
    return run;
}

describe('a craft pinned in a corner (B12 control, root cause)', () => {
    it('the slow dash touches the wall, tumbles against it like v0.2 and never crashes; no frozen pose gathers speed', () => {
        const r = slowDash(true);
        expect(r.contacts).toBeGreaterThan(100);
        expect(r.crashes).toHaveLength(0);
        // it presses on into the wall like v0.2's craft (up-vector y -0.38 there): the control below is not a gentler flight
        expect(r.minUpY).toBeLessThan(0);
        // it may sit wedged, but a pose that does not move does not gather speed
        expect(r.frozenTicks === 0 || r.frozenSpeed < 1).toBe(true);
        expect(r.maxSpeed).toBeLessThan(2);
    });

    it('control: with the single-impulse rule the pose freezes for hundreds of ticks while the speed passes v_crash, and a phantom crash follows', () => {
        const r = slowDash(false);
        const vCrash = compileParams(PRESET, {}).vCrash;
        expect(r.frozenTicks).toBeGreaterThan(300);
        expect(r.frozenSpeed).toBeGreaterThan(vCrash);
        expect(r.crashes).toHaveLength(1);
        expect(r.crashes[0].speed).toBeGreaterThan(vCrash);
    });
});
