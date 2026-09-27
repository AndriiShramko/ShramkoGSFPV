// Lives, determinism and bounded memory (docs/architecture-v03.md C.9; C.12 items 7, 8, 10).

import { beforeAll, describe, expect, it } from 'vitest';
import {
    LifePlayer, MODE_CHANNEL, REC_BYTES, S, SIM_CORE_VERSION, attitude, compileParams, lifeConfigHash, lifeSim,
    lifeTrajectory, replayLife, replayLives, trajPoint
} from '../src/index';
import type { Life, Runner, Sim, TrajectoryPoint } from '../src/index';
import { PRESET, PlaneWorld, Pilot, SPLITS, attachDirector, crashCycles, deps, header, newRunner, runFrames } from './log-kit';

const SPAWN: [number, number, number, number] = [0, 1, 0, 0];
const WORLD = PlaneWorld.room({ wallX: 4 });

/** Starts a life with new params at the craft's current position (A.7 'life' setting change). */
function settingsLife(runner: Runner, sim: Sim, tauMs: number): void {
    const overrides = { tauMs };
    const s = sim.s;
    runner.newLife(lifeSim(compileParams(PRESET, overrides), sim.world), header({ at: [s[S.px], s[S.py], s[S.pz], attitude(s).yaw], overrides, opts: { platform: true, keepArmed: true }, reason: 'settings' }));
}

/**
 * C.12 item 7: 120 s, three dashes into the wall with automatic respawns, a settings life at 60 s
 * and angle mode from 90 to 92 s. Everything is driven per tick, so frame splits cannot matter.
 */
function flight120(frameHz: number, o: { perturb?: boolean; track?: number[] } = {}): Runner {
    const r = newRunner({ world: WORLD, at: SPAWN, opts: { platform: true, keepArmed: true } });
    if (o.perturb) r.sim.perturb = () => Math.random();
    attachDirector(r, SPAWN);
    const p = new Pilot(r);
    crashCycles(p, { hoverTicks: 6000, speed: 6, maxCrashes: 3 });
    const base = p.plan!;
    p.plan = (pp, sim, lt) => {
        pp.mode = sim.tick >= 90_000 && sim.tick < 92_000 ? MODE_CHANNEL.angle : MODE_CHANNEL.acro;
        if (sim.tick === 60_000) settingsLife(r, sim, 18);
        base(pp, sim, lt);
    };
    if (o.track) {
        const t = o.track;
        const prev = r.onStep;
        r.onStep = (sim) => { prev?.(sim); if (sim.tick % 100 === 0) t.push(sim.s[S.px], sim.s[S.py], sim.s[S.pz]); };
    }
    runFrames(r, frameHz, 120_000_000, { phaseUs: 3700 });
    return r;
}

/** Largest distance between two position tracks (x, y, z triples). */
function maxGap(a: number[], b: number[]): number {
    let m = 0;
    for (let i = 0; i + 2 < Math.min(a.length, b.length); i += 3) m = Math.max(m, Math.hypot(a[i] - b[i], a[i + 1] - b[i + 1], a[i + 2] - b[i + 2]));
    return m;
}

describe('determinism with lives (C.12 item 7)', () => {
    const runs = new Map<number, { r: Runner; hash: string; track: number[] }>();
    let ref: { r: Runner; hash: string; track: number[] };
    beforeAll(() => {
        for (const hz of SPLITS) {
            const track: number[] = [];
            const r = flight120(hz, { track });
            runs.set(hz, { r, hash: r.traceHash(), track });
        }
        ref = runs.get(60)!;
    }, 120_000); // four 120 s flights; vitest.config sets testTimeout only

    it('the flight has 3 crashes with automatic respawns, a settings life and a mode switch', () => {
        const reasons = ref.r.lives().map((l) => l.header.life.reason);
        expect(reasons).toEqual(['start', 'crash', 'crash', 'crash', 'settings']);
        expect(ref.r.events.filter((e) => e.type === 'crash').length).toBe(3);
        expect(ref.r.lives()[4].header.overrides).toEqual({ tauMs: 18 });
        expect(ref.r.lives()[4].header.life.startTick).toBe(60_000);
    });

    it('the trace hash is equal at 30, 60, 144 and 240 Hz frame splits, and when replaying all lives', () => {
        for (const hz of SPLITS) expect(runs.get(hz)!.hash, `${hz} Hz`).toBe(ref.hash);
        const lives = ref.r.lives();
        expect(lives[0].header.life.startTick).toBe(0);
        expect(replayLives(lives, deps(WORLD)).hash).toBe(ref.hash);
    });

    it('control: a Math.random perturbation changes the hash', () => {
        const r = flight120(60, { perturb: true });
        expect(r.traceHash()).not.toBe(ref.hash);
    });

    it('control: deleting one respawn record makes the replay diverge by more than 1 cm', () => {
        const lives = ref.r.lives();
        const cut = lives.map((l, i): Life => {
            if (i !== 1) return l;
            const b = l.bytes();
            return { header: l.header, endTick: l.endTick, bytes: () => b.subarray(0, b.length - REC_BYTES) };
        });
        const full: number[] = [];
        const bad: number[] = [];
        const at = (t: number[]) => (sim: Sim) => { if (sim.tick % 100 === 0) t.push(sim.s[S.px], sim.s[S.py], sim.s[S.pz]); };
        replayLives(lives, deps(WORLD), { onStep: at(full) });
        replayLives(cut, deps(WORLD), { onStep: at(bad) });
        expect(maxGap(full, ref.track)).toBe(0);
        expect(maxGap(bad, ref.track)).toBeGreaterThan(0.01);
    });

    it('each life replays alone from its header: equal per-tick states (C.12 item 8); control: a wrong pack in the header differs', () => {
        const lives = ref.r.lives();
        for (const l of lives.slice(0, -1)) expect(replayLife(l, deps(WORLD)).hash, `life ${l.header.life.index}`).toBe(l.traceHash);
        const cur = lives[lives.length - 1];
        expect(Array.from(replayLife(cur, deps(WORLD)).sim.s)).toEqual(Array.from(ref.r.sim.s));
        const l2 = lives[2];
        expect(l2.header.life.soc).toBeLessThan(0.999);
        const fresh: Life = { header: { ...l2.header, life: { ...l2.header.life, soc: 1 } }, endTick: l2.endTick, bytes: () => l2.bytes() };
        expect(replayLife(fresh, deps(WORLD)).hash).not.toBe(l2.traceHash);
    });
});

describe('bounded memory (C.9, D-f; C.12 item 8)', () => {
    const MIB = 1024 * 1024;

    /** A parked craft fed 500 Hz radio samples that always change; respawns every 3 min for the first hour. */
    function hours(r: Runner, endMin: number, respawnUntilMin: number, check: (r: Runner) => void): void {
        const ch = new Float32Array([0, 0, -1, 0, -1, -1, 0, 0]);
        r.onStep = (sim) => {
            if (sim.tick % 2 === 0) {
                ch[0] = ((sim.tick >> 1) % 200) / 100 - 1;
                r.enqueue({ tUs: (sim.tick + 1) * 1000, ch });
            }
            if (sim.tick % 60_000 === 0) check(r);
            if (sim.tick % 180_000 === 0 && sim.tick <= respawnUntilMin * 60_000) r.respawn(0, 1, 0, 0, {}, 'manual-start');
        };
        runFrames(r, 60, endMin * 60_000_000);
    }

    it('two simulated hours at 500 Hz stay within 32 MiB (one of them a single life); control: unbounded grows past it', () => {
        const r = newRunner({ world: null, at: SPAWN, runner: { traceHash: false } });
        let worst = 0;
        let checks = 0;
        hours(r, 120, 60, (x) => { worst = Math.max(worst, x.bytesKept()); checks++; });
        expect(checks).toBe(120);
        expect(worst).toBeLessThanOrEqual(32 * MIB);
        expect(worst).toBeGreaterThan(24 * MIB); // the budget is used, not dodged
        const cur = r.current();
        expect(cur.snapshot).toBeDefined(); // the hour-long life lost its head
        expect(cur.endTick - cur.snapshot!.tick).toBeGreaterThan(7 * 60_000); // but keeps at least 7 minutes
        const p = new LifePlayer(cur, deps(null), undefined, { hash: false });
        p.stepTo(cur.endTick);
        expect(Array.from(p.sim.s)).toEqual(Array.from(r.sim.s));
        expect(Array.from(p.sim.ch)).toEqual(Array.from(r.sim.ch));

        const u = newRunner({ world: null, at: SPAWN, runner: { traceHash: false, maxBytes: Infinity, maxLives: Infinity } });
        let grown = 0;
        hours(u, 40, 0, (x) => { grown = Math.max(grown, x.bytesKept()); });
        expect(grown).toBeGreaterThan(32 * MIB);
    });

    it('at most 30 lives are kept, oldest dropped, and the kept ones still replay in one pass; control: no cap keeps all 36', () => {
        const run = (maxLives?: number): Runner => {
            const r = newRunner({ world: WORLD, at: [0, 0.04, 0, 0], runner: { traceHash: true, maxLives } });
            for (let k = 1; k <= 35; k++) {
                r.advanceTo(k * 100_000);
                r.respawn(0.01 * k, 0.04, 0, 0, { platform: true }, 'manual-start');
            }
            r.advanceTo(3_600_000);
            return r;
        };
        const r = run();
        const lives = r.lives();
        expect(lives.length).toBe(30);
        expect(lives[0].header.life.index).toBe(6);
        expect(Array.from(replayLives(lives, deps(WORLD)).sim.s)).toEqual(Array.from(r.sim.s));
        expect(run(Infinity).lives().length).toBe(36);
    });

    it('a flying life longer than the budget replays from its snapshot; control: its records from the header start diverge', () => {
        const r = newRunner({ world: WORLD, at: SPAWN, runner: { traceHash: false, maxBytes: 64 * 1024 } });
        const p = new Pilot(r);
        p.plan = (pp, sim) => {
            if (pp.phase === '') {
                pp.bot.setTask({ kind: 'path', points: [[0, 1, 0], [2, 1.5, 0], [2, 1, 2], [0, 1.5, 2], [0, 1, 0], [2, 1.5, 0], [2, 1, 2], [0, 1, 2]], speed: 2.5, yawDeg: 'along' }, sim);
                pp.phase = 'fly';
            }
        };
        let worst = 0;
        const prev = r.onStep;
        r.onStep = (sim) => { prev?.(sim); if (sim.tick % 100 === 0) worst = Math.max(worst, r.bytesKept()); };
        runFrames(r, 144, 30_000_000);
        expect(worst).toBeLessThanOrEqual(64 * 1024);
        const cur = r.current();
        expect(cur.snapshot).toBeDefined();
        expect(cur.snapshot!.tick).toBeGreaterThan(20_000);
        expect(Array.from(replayLife(cur, deps(WORLD)).sim.s)).toEqual(Array.from(r.sim.s));
        const headless: Life = { header: cur.header, endTick: cur.endTick, bytes: () => cur.bytes() };
        const wrong = replayLife(headless, deps(WORLD)).sim.s;
        expect(Math.hypot(wrong[S.px] - r.sim.s[S.px], wrong[S.py] - r.sim.s[S.py], wrong[S.pz] - r.sim.s[S.pz])).toBeGreaterThan(0.01);
    });
});

describe('header v2 (C.12 item 10, removes D-g)', () => {
    const PID_A = { roll: [60, 110, 40, 90], pitch: [64, 115, 45, 95], yaw: [55, 100, 0, 80] };
    const PID_B = { roll: [30, 110, 40, 90], pitch: [64, 115, 45, 95], yaw: [55, 100, 0, 80] };

    it('a PID changed after recording does not change the replay: the params come from the header; control: the session params diverge', () => {
        const r = newRunner({ world: WORLD, at: SPAWN, overrides: { pid: PID_A } });
        const p = new Pilot(r);
        p.plan = (pp, sim) => {
            if (pp.phase === '') { pp.bot.setTask({ kind: 'path', points: [[0, 1, 0], [2, 1, 0], [2, 1, 2], [0, 1, 2], [0, 1, 0]], speed: 2, yawDeg: 0 }, sim); pp.phase = 'fly'; }
        };
        runFrames(r, 60, 12_000_000);
        const life = r.current();
        const live = Array.from(r.sim.s);
        const hash = r.traceHash();
        // the session moves on to PID_B; the saved life still says PID_A
        const rep = replayLife(life, deps(WORLD));
        expect(rep.hash).toBe(hash);
        expect(Array.from(rep.sim.s)).toEqual(live);
        const h = life.header;
        const asSession: Life = { header: { ...h, overrides: { pid: PID_B }, configHash: lifeConfigHash(h.presetSha256, { pid: PID_B }, SIM_CORE_VERSION) }, endTick: life.endTick, bytes: () => life.bytes() };
        const bad = replayLife(asSession, deps(WORLD)).sim.s;
        expect(Math.hypot(bad[S.px] - live[S.px], bad[S.py] - live[S.py], bad[S.pz] - live[S.pz])).toBeGreaterThan(0.01);
    });
});

describe('trajectory from the log (C.9: no live array, D-f)', () => {
    it('the export recomputed from the log equals the samples taken live; control: one tampered LSB changes it', () => {
        const r = newRunner({ world: WORLD, at: SPAWN });
        const live: TrajectoryPoint[] = [];
        const p = new Pilot(r);
        crashCycles(p, { hoverTicks: 3000, speed: 5, maxCrashes: 1 });
        const prev = r.onStep;
        r.onStep = (sim) => { prev?.(sim); if (sim.tick % 10 === 0) live.push(trajPoint(sim)); };
        runFrames(r, 60, 6_000_000);
        const life = r.current();
        expect(live.some((t) => t.crashed)).toBe(true);
        expect(lifeTrajectory(life, deps(WORLD))).toEqual(live);
        const b = life.bytes().slice();
        const v = new DataView(b.buffer);
        // throttle of record 500 (2 s, hovering): a non-zero value, so one LSB is a real change
        const o = 500 * REC_BYTES + 4 + 2 * 4;
        expect(v.getFloat32(o, true)).not.toBe(0);
        v.setUint32(o, v.getUint32(o, true) ^ 1, true);
        const tampered: Life = { header: life.header, endTick: life.endTick, bytes: () => b };
        expect(lifeTrajectory(tampered, deps(WORLD))).not.toEqual(live);
    });
});
