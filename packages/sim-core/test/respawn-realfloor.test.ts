// Respawns on real scan geometry: the 39e63ce9 voxel collision (CC BY fixture), not a plane.
// A craft resting on a voxel floor or pressed under a voxel ceiling chatters in the contact solver
// (about 106 contact events/s here), which the synthetic plane world does not show. Items 18 and
// 23 (C.6, C.12 item 6) and the stuck rules are checked on it, each with its control.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import {
    DEFAULT_RESPAWN_POLICY, MODE_CHANNEL, RespawnDirector, Runner, S, SIM_CORE_VERSION, StateHistory, compileParams, datan2, hoverStickOf,
    lifeSim, makeLifeHeader, replayLives
} from '../src/index';
import type { ContactWorld, ParamOverrides, RespawnDecision, RespawnPolicy, Sim } from '../src/index';
// test-only imports across packages, as log-kit.ts does for the bot
import { VoxelContactWorld, openVoxelCollision } from '../../collision/src/index';
import type { VoxelMetadata } from '../../collision/src/index';
import { BotPilot } from '../../input/src/sim/bot';
import { makePlan } from '../../input/src/sim/plan';
import { PRESET, SPLITS, runFrames } from './log-kit';

const FIX = join(__dirname, '..', '..', '..', 'fixtures', '39e63ce9');
let WORLD: VoxelContactWorld;
let SPAWN: [number, number, number];
let TARGET: [number, number, number];
/** the floor under the spawn (a ray down hits it at y = -0.2) and the ceiling over it */
let FLOOR_Y: number;

beforeAll(() => {
    const meta = JSON.parse(readFileSync(join(FIX, 'scene.voxel.json'), 'utf8')) as VoxelMetadata;
    let bin = new Uint8Array(readFileSync(join(FIX, 'scene.voxel.bin')));
    if (bin[0] === 0x1f && bin[1] === 0x8b) bin = new Uint8Array(gunzipSync(bin));
    const col = openVoxelCollision(meta, bin);
    WORLD = new VoxelContactWorld(col);
    const cam = JSON.parse(readFileSync(join(FIX, 'settings.json'), 'utf8')).cameras[0].initial;
    SPAWN = cam.position;
    TARGET = cam.target;
    FLOOR_Y = col.queryRay(SPAWN[0], SPAWN[1], SPAWN[2], 0, -1, 0, 10)!.y;
});

interface Setup { r: Runner; d: RespawnDirector; at: [number, number, number, number] }

/** A format /2 runner and a director wired as the page wires them (touching = the sim's contactWorld). */
function setup(at: [number, number, number, number], o: { overrides?: ParamOverrides; policy?: Partial<RespawnPolicy>; armed?: boolean; platform?: boolean } = {}): Setup {
    const overrides = o.overrides ?? {};
    const p = compileParams(PRESET, overrides);
    const sim = lifeSim(p, WORLD);
    if (o.armed) sim.setChannels([0, 0, -1, 0, 1, MODE_CHANNEL.acro, 0, 0]);
    const r = new Runner(sim, makeLifeHeader({ simCore: SIM_CORE_VERSION, preset: PRESET, at, overrides, opts: { keepArmed: o.armed === true, platform: o.platform === true } }), { traceHash: true, runHash: true });
    const d = new RespawnDirector({ ...DEFAULT_RESPAWN_POLICY, ...o.policy }, () => at, new StateHistory(), () => r.sim.contactWorld, p.boundRadius, hoverStickOf(p));
    r.director = d;
    return { r, d, at };
}

/** Lays the parked craft on the real floor under the spawn: on its back or upright, disarmed, not crashed. */
function lay(sim: Sim, flipped: boolean): void {
    const s = sim.s;
    s[S.qw] = flipped ? 0 : 1; s[S.qx] = 0; s[S.qy] = 0; s[S.qz] = flipped ? 1 : 0;
    s[S.px] = SPAWN[0]; s[S.py] = FLOOR_Y + 0.034; s[S.pz] = SPAWN[2];
    s[S.hold] = 0;
}

function reasons(r: Runner): string[] {
    return r.lives().map((l) => `${l.header.life.reason}@${l.header.life.startTick}`);
}

describe('stuck, flipped, on the 39e63ce9 voxel floor (item 18)', () => {
    it('a craft lying on its back is reset 1.50-1.51 s after it lies still, although it spins about its up axis', () => {
        const { r, d } = setup([SPAWN[0], SPAWN[1], SPAWN[2], 0]);
        lay(r.sim, true);
        // the design's literal |w|: the whole rotation between poses 100 ms apart, measured beside the director
        const qs: number[][] = [];
        let rotMin = Infinity;
        let contacts = 0;
        r.onStep = (sim) => {
            const s = sim.s;
            qs.push([s[S.qw], s[S.qx], s[S.qy], s[S.qz]]);
            if (sim.tick > 300 && sim.tick <= 1500 && sim.tick % 10 === 0) {
                const a = qs[qs.length - 101], b = qs[qs.length - 1];
                const dot = Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]));
                rotMin = Math.min(rotMin, (2 * datan2(Math.sqrt(1 - dot * dot), dot)) / 0.1);
            }
        };
        const n0 = r.events.length;
        runFrames(r, 60, 3_000_000);
        contacts = r.events.slice(n0).filter((e) => e.type === 'contact' && e.tick <= 1500).length;
        const L = r.lives()[1]?.header.life;
        console.log(`on its back on the voxel floor: ${contacts} contact events in 1.5 s, the whole rotation reads >= ${rotMin.toFixed(2)} rad/s, respawn ${reasons(r).join(' ')}`);
        expect(L?.reason).toBe('stuck-flipped');
        expect(L!.startTick).toBeGreaterThanOrEqual(1500);
        expect(L!.startTick).toBeLessThanOrEqual(1510);
        expect(d.last!.kind).toBe('start'); // never armed: no safe point, so the spawn
        // why the tilt and not the whole rotation: the craft spins, so the design's |w| < 1 rad/s never held
        expect(contacts).toBeGreaterThan(100);
        expect(rotMin).toBeGreaterThan(1);
    });

    it('control: the same craft upright on the same floor, disarmed (a landing), is left alone for 30 s', () => {
        const { r } = setup([SPAWN[0], SPAWN[1], SPAWN[2], 0]);
        lay(r.sim, false);
        runFrames(r, 60, 30_000_000);
        expect(reasons(r)).toEqual(['start@0']);
    });

    /**
     * Item 18's scenario with crashes off: armed 0.6 m over the floor, a half roll at idle, it lands
     * on its back (a bounce, not a crash) and lies there with the motors at idle in acro.
     */
    function halfFlip(policy: Partial<RespawnPolicy> = {}): { r: Runner; landed: number } {
        const at: [number, number, number, number] = [SPAWN[0], FLOOR_Y + 0.6, SPAWN[2], 0];
        const { r } = setup(at, { overrides: { crashOn: false }, armed: true, policy });
        const hover = hoverStickOf(r.sim.p) * 2 - 1;
        r.enqueue({ tUs: 1000, ch: [0, 0, hover, 0, 1, MODE_CHANNEL.acro, 0, 0] });
        r.enqueue({ tUs: 300_000, ch: [1, 0, -1, 0, 1, MODE_CHANNEL.acro, 0, 0] });
        r.enqueue({ tUs: 570_000, ch: [0, 0, -1, 0, 1, MODE_CHANNEL.acro, 0, 0] });
        let landed = -1;
        r.onStep = (sim) => {
            const upY = 1 - 2 * (sim.s[S.qx] * sim.s[S.qx] + sim.s[S.qz] * sim.s[S.qz]);
            if (landed < 0 && upY < 0.3 && sim.s[S.py] - FLOOR_Y < 0.05) landed = sim.tick;
        };
        runFrames(r, 60, 10_000_000);
        return { r, landed };
    }

    it('crashes off, a half flip onto its back: armed at idle and not crashed, it is reset within 2 s of landing', () => {
        const { r, landed } = halfFlip();
        expect(landed).toBeGreaterThan(500);
        expect(r.events.some((e) => e.type === 'crash')).toBe(false);
        expect(r.events.some((e) => e.type === 'contact' && e.regime === 'bounce')).toBe(true);
        const L = r.lives()[1]?.header.life;
        expect(L?.reason).toBe('stuck-flipped');
        console.log(`half flip: landed on its back at ${landed}, reset at ${L!.startTick} (+${L!.startTick - landed} ms)`);
        expect(L!.startTick - landed).toBeLessThanOrEqual(2000);
    });

    it('control: with respawn.unstuck off it is still on its back 10 s later', () => {
        const { r, landed } = halfFlip({ unstuck: false });
        expect(landed).toBeGreaterThan(500);
        expect(reasons(r)).toEqual(['start@0']);
        expect(1 - 2 * (r.sim.s[S.qx] ** 2 + r.sim.s[S.qz] ** 2)).toBeLessThan(0.3);
    });
});

describe('stuck, wedged, under the 39e63ce9 voxel ceiling', () => {
    /** Armed at the spawn with the stick `above` hover: it climbs into the ceiling (about 1.85 m here) and presses. */
    function pressed(above: number): { r: Runner; first: RespawnDecision | null; firstContact: number; perTickRun: number } {
        const at: [number, number, number, number] = [SPAWN[0], SPAWN[1], SPAWN[2], 0];
        const { r, d } = setup(at);
        let first: RespawnDecision | null = null;
        r.onLife = () => { if (!first && d.last) first = { ...d.last }; };
        const stick = hoverStickOf(r.sim.p) + above;
        r.enqueue({ tUs: 1000, ch: [0, 0, -1, 0, -1, MODE_CHANNEL.acro, 0, 0] });
        r.enqueue({ tUs: 20_000, ch: [0, 0, -1, 0, 1, MODE_CHANNEL.acro, 0, 0] });
        r.enqueue({ tUs: 40_000, ch: [0, 0, stick * 2 - 1, 0, 1, MODE_CHANNEL.acro, 0, 0] });
        // the longest run of ticks where one tick's |v| stays under 0.1 m/s (what a per-tick rule would need for 3 s)
        let run = 0;
        let perTickRun = 0;
        r.onStep = (sim) => {
            if (r.lives().length > 1) return;
            const s = sim.s;
            run = Math.sqrt(s[S.vx] * s[S.vx] + s[S.vy] * s[S.vy] + s[S.vz] * s[S.vz]) < 0.1 ? run + 1 : 0;
            if (run > perTickRun) perTickRun = run;
        };
        runFrames(r, 60, 10_000_000);
        const c = r.events.find((e) => e.type === 'contact');
        return { r, first, firstContact: c ? c.tick : -1, perTickRun };
    }

    it('hover + 0.2 pressed under the ceiling: wedged, 3.00-3.01 s after it stopped sliding; one tick\'s |v| never stays under 0.1 for 3 s', () => {
        const { r, first, firstContact, perTickRun } = pressed(0.2);
        const L = r.lives()[1]?.header.life;
        expect(L?.reason).toBe('stuck-wedged');
        const dec = first!;
        console.log(`wedged: first contact ${firstContact}, still from ${dec.incidentTick}, respawn ${L!.startTick}; longest per-tick |v| < 0.1 run ${perTickRun} ticks`);
        expect(firstContact).toBeGreaterThan(0);
        expect(dec.incidentTick).toBeGreaterThan(firstContact);
        expect(L!.startTick - dec.incidentTick).toBeGreaterThanOrEqual(3000);
        expect(L!.startTick - dec.incidentTick).toBeLessThanOrEqual(3010);
        expect(L!.startTick - firstContact).toBeLessThan(6500);
        // control for the span: read per tick, the chatter never lets the rule hold for 3 s
        expect(perTickRun).toBeLessThan(3000);
    });

    it('control: hover + 0.1 presses too, but is no wedge in 10 s', () => {
        const { r } = pressed(0.1);
        expect(r.sim.s[S.py]).toBeGreaterThan(1.7);
        expect(reasons(r)).toEqual(['start@0']);
    });
});

describe('item 23 on the 39e63ce9 scan: a crash, then 2 s later the craft flies again 5 s back along its path', () => {
    interface Flight { r: Runner; d: RespawnDirector; decision: RespawnDecision | null; track: Map<number, number[]>; armedAt: number[]; hash: string }

    /** Hovers 6 s at the spawn on the platform (the bot, acro), then dashes into the wall the plan finds; the switch stays on. */
    function fly(frameHz: number, policy: Partial<RespawnPolicy> = {}): Flight {
        const p = compileParams(PRESET);
        const plan = makePlan(WORLD.col, p.boundRadius, SPAWN, TARGET, 2 * p.vCrash);
        const at: [number, number, number, number] = [plan.spawn[0], plan.spawn[1], plan.spawn[2], plan.spawnYawDeg];
        const { r, d } = setup(at, { policy, platform: true });
        const bot = new BotPilot(r.sim.p);
        let phase = '';
        let decision: RespawnDecision | null = null;
        const track = new Map<number, number[]>();
        const armedAt: number[] = [];
        r.onLife = (life) => {
            decision = d.last ? { ...d.last } : null;
            armedAt.push(r.sim.armed ? 1 : 0, r.sim.s[S.platOn], life.header.life.startTick);
            phase = 'again';
        };
        let everArmed = false;
        r.onStep = (sim) => {
            track.set(sim.tick, [sim.s[S.px], sim.s[S.py], sim.s[S.pz]]);
            if (sim.tick % 4 !== 0) return;
            const here: [number, number, number] = [sim.s[S.px], sim.s[S.py], sim.s[S.pz]];
            if (phase === '' || phase === 'again') { bot.setTask({ kind: 'hover', target: here, yawDeg: at[3] }, sim); phase = phase === '' ? 'hover' : 'after'; }
            else if (phase === 'hover' && sim.tick >= 6000 && sim.armed) { bot.setTask({ kind: 'dash', from: here, dir: plan.wallDir!, speed: 6, yawDeg: at[3] }, sim); phase = 'dash'; }
            if (sim.armed) everArmed = true;
            const ch = bot.update(sim);
            // the pilot never lets go of the arm switch (the bot would flip it off while crashed)
            if (everArmed) ch[4] = 1;
            r.enqueue({ tUs: (sim.tick + 1) * 1000, ch });
        };
        runFrames(r, frameHz, 14_000_000, { phaseUs: 2300 });
        return { r, d, decision, track, armedAt, hash: r.traceHash() };
    }

    let runs: Flight[] = [];
    beforeAll(() => {
        runs = SPLITS.map((hz) => fly(hz));
    }, 120_000);

    it('at 30, 60, 144 and 240 Hz: the crash, a respawn at exactly crash + 2000, a point 5.00-5.05 s back, equal hashes', () => {
        const ref = runs[1];
        const crash = ref.r.events.find((e) => e.type === 'crash')!;
        expect(crash.tick).toBeGreaterThan(6000);
        for (const f of runs) {
            const lives = f.r.lives();
            expect(lives.map((l) => l.header.life.reason)).toEqual(['start', 'crash']);
            expect(f.r.events.find((e) => e.type === 'crash')!.tick).toBe(crash.tick);
            expect(lives[1].header.life.startTick).toBe(crash.tick + 2000);
            expect(f.decision!.kind).toBe('rewind');
            expect(f.hash).toBe(ref.hash);
        }
        const dec = ref.decision!;
        const age = dec.incidentTick - dec.sampleTick!;
        console.log(`item 23: crash ${crash.tick} at ${(crash as { speed: number }).speed.toFixed(2)} m/s, respawn ${crash.tick + 2000}, back ${age} ticks`);
        expect(age).toBeGreaterThanOrEqual(5000);
        expect(age).toBeLessThanOrEqual(5050);
        expect(replayLives(ref.r.lives(), { preset: () => PRESET, world: () => WORLD as ContactWorld }).hash).toBe(ref.hash);
    });

    it('it respawns where the craft was at that tick, at the height it had, on the platform, armed with no switch flip, and flies on', () => {
        const f = runs[1];
        const L = f.r.lives()[1].header.life;
        const was = f.track.get(f.decision!.sampleTick!)!;
        for (let k = 0; k < 3; k++) expect(L.at[k]).toBe(Math.fround(was[k]));
        expect(L.opts).toEqual({ platform: true, keepArmed: true });
        // armed and on the platform at the respawn tick, without an off -> on edge of the switch
        expect(f.armedAt).toEqual([1, 1, L.startTick]);
        // throttle reaches the motors: the bot holds it near that point for the rest of the run
        const end = f.r.sim.s;
        expect(Math.hypot(end[S.px] - L.at[0], end[S.py] - L.at[1], end[S.pz] - L.at[2])).toBeLessThan(0.1);
        expect(f.r.sim.armed).toBe(true);
    });

    it('control: with respawn.auto off the craft is still crashed 5 s after the crash, and there is one life', () => {
        const f = fly(60, { auto: false });
        const crash = f.r.events.find((e) => e.type === 'crash')!;
        expect(14_000 - crash.tick).toBeGreaterThan(5000);
        expect(f.r.lives().length).toBe(1);
        expect(f.r.sim.crashed).toBe(true);
    });
});
