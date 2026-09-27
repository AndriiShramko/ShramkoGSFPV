// FlightStats (docs/architecture-v03.md D.1; D.4 unit): the goggles' numbers from per-tick
// state and events, reproduced exactly by a replay of the log.

import { describe, expect, it } from 'vitest';
import { FlightStats, REC_BYTES, S, readRespawn, replayLives } from '../src/index';
import type { Life, Runner, StatsBlock, StatsSource } from '../src/index';
import { PlaneWorld, Pilot, attachDirector, crashCycles, deps, newRunner, runFrames } from './log-kit';

/** A scripted state: armed from tick 1, flying along +x at 1 m/s from x = 0 at 1 m (the spawn height). */
function scripted(gravity = 9.81): { src: StatsSource & { tick: number }; s: Float64Array } {
    const s = new Float64Array(S.size);
    s[S.py] = 1; s[S.qw] = 1; s[S.volt] = 12.1; s[S.amps] = 6;
    return { src: { s, tick: 0, ch: new Float64Array([0, 0, 0.2, 0, 1, -1, 0, 0]), p: { gravity } }, s };
}

describe('scripted path (D.4)', () => {
    function fly10(o: { teleportAt?: number; newLifeAtJump?: boolean } = {}): FlightStats {
        const st = new FlightStats([0, 1, 0], 550);
        const { src, s } = scripted();
        st.onStep(src); // tick 0, disarmed, at x = 0
        for (let t = 1; t <= 10_000; t++) {
            src.tick = t;
            s[S.armed] = 1;
            s[S.vx] = 1;
            const jumped = o.teleportAt !== undefined && t > o.teleportAt;
            s[S.px] = t / 1000 + (jumped ? 5 : 0);
            st.onStep(src);
            if (t === o.teleportAt && o.newLifeAtJump) st.newLife([t / 1000 + 5, 1, 0], 'manual-rewind');
        }
        return st;
    }

    it('1 m/s for 10 s: distance 10.000 +- 0.001 m, max speed 1, airtime 10.000 s', () => {
        const b = fly10().session();
        expect(Math.abs(b.distance - 10)).toBeLessThanOrEqual(0.001);
        expect(b.maxSpeed).toBe(1);
        expect(b.airtimeS).toBeCloseTo(10, 12);
        expect(b.maxDist).toBeCloseTo(10, 12);
        expect(b.maxAlt).toBe(0);
        expect(b.avgThrottle).toBeCloseTo(0.6, 6);
        expect(b.usedMah).toBeCloseTo((6 * 10.001) / 3.6, 9); // 10 001 ticks at 6 A, the disarmed one too
    });

    it('a respawn is a jump, not flown: with newLife the session distance stays 10.000; control: without it the 5 m jump is counted', () => {
        const withLife = fly10({ teleportAt: 5000, newLifeAtJump: true });
        expect(Math.abs(withLife.session().distance - 10)).toBeLessThanOrEqual(0.001);
        expect(Math.abs(withLife.life().distance - 5)).toBeLessThanOrEqual(0.001);
        expect(withLife.session().respawns).toEqual({ 'manual-rewind': 1 });
        expect(withLife.life().airtimeS).toBeCloseTo(5, 12);
        expect(fly10({ teleportAt: 5000 }).session().distance).toBeGreaterThan(14.9);
    });

    it('crash, bounce and arm counts; an arm at a respawn tick is not a new flight', () => {
        const st = new FlightStats([0, 1, 0], 550);
        const crash = (tick: number, speed: number) => st.onEvent({ type: 'crash', tick, speed, nx: 1, ny: 0, nz: 0, px: 0, py: 0, pz: 0 });
        st.onEvent({ type: 'arm', tick: 5 });
        st.onEvent({ type: 'contact', tick: 10, speed: 2.5, regime: 'bounce' });
        st.onEvent({ type: 'contact', tick: 11, speed: 0.3, regime: 'slide' });
        crash(20, 5.5);
        st.onEvent({ type: 'respawn', tick: 2020 });
        st.onEvent({ type: 'arm', tick: 2020 }); // kept armed through the respawn
        st.newLife([0, 1, 0], 'crash');
        st.onEvent({ type: 'contact', tick: 2100, speed: 3, regime: 'bounce' });
        st.onEvent({ type: 'contact', tick: 2101, speed: 3.2, regime: 'bounce' });
        crash(2200, 7.25);
        const b = st.session();
        expect([b.crashes, b.bounces, b.maxImpact, b.flights]).toEqual([2, 3, 7.25, 1]);
        expect(b.respawns).toEqual({ crash: 1 });
        const l = st.life();
        expect([l.crashes, l.bounces, l.maxImpact, l.flights]).toEqual([1, 2, 7.25, 0]);
    });

    it('G is what an accelerometer reads: 1.000 at a hover, 0 in free fall; control: the Moon reads 0.165', () => {
        const run = (gravity: number, fall: boolean): number => {
            const st = new FlightStats([0, 1, 0], 550);
            const { src, s } = scripted(gravity);
            s[S.armed] = 1;
            for (let t = 1; t <= 200; t++) {
                src.tick = t;
                s[S.vy] = fall ? -gravity * t * 0.001 : 0;
                st.onStep(src);
            }
            return st.session().maxG;
        };
        expect(run(9.81, false)).toBeCloseTo(1, 12);
        expect(run(9.81, true)).toBeLessThan(1e-9);
        expect(run(1.62, false)).toBeCloseTo(1.62 / 9.81, 12);
    });
});

describe('stats from the log (D.4)', () => {
    const WORLD = PlaneWorld.room({ wallX: 4 });
    const SPAWN: [number, number, number, number] = [0, 1, 0, 0];

    function live(): { r: Runner; st: FlightStats; armedTicks: number } {
        const r = newRunner({ world: WORLD, at: SPAWN, opts: { platform: true, keepArmed: true } });
        attachDirector(r, SPAWN);
        const st = new FlightStats([SPAWN[0], SPAWN[1], SPAWN[2]], 550);
        r.stats = st;
        crashCycles(new Pilot(r), { hoverTicks: 6000, speed: 6, maxCrashes: 3 });
        let armedTicks = 0;
        const prev = r.onStep;
        r.onStep = (sim) => { prev?.(sim); if (sim.s[S.armed] > 0) armedTicks++; };
        runFrames(r, 60, 60_000_000);
        return { r, st, armedTicks };
    }

    function replayed(lives: readonly Life[]): { session: StatsBlock; life: StatsBlock } {
        const st = new FlightStats([SPAWN[0], SPAWN[1], SPAWN[2]], 550);
        replayLives(lives, deps(WORLD), { stats: st });
        return { session: st.session(), life: st.life() };
    }

    it('a 60 s bot flight with 3 crashes: the replay gives equal stats; the numbers match the flight', () => {
        const { r, st, armedTicks } = live();
        const rep = replayed(r.lives());
        expect(rep.session).toEqual(st.session());
        expect(rep.life).toEqual(st.life());
        const b = st.session();
        expect(b.airtimeS).toBeCloseTo(armedTicks / 1000, 9);
        expect(b.crashes).toBe(r.events.filter((e) => e.type === 'crash').length);
        expect(b.crashes).toBe(3);
        expect(b.respawns).toEqual({ crash: 3 });
        // each crash went back along the path: the log's rewind flag, counted per life and session (D.1 "rewinds")
        expect(b.rewinds).toBe(3);
        expect(st.life().rewinds).toBe(1);
        for (const l of r.lives().slice(0, 3)) {
            const bytes = l.bytes();
            expect(readRespawn(Array.from(new Float32Array(bytes.slice(bytes.length - 32).buffer))).rewind).toBe(true);
        }
        expect(b.maxSpeed).toBeGreaterThan(5);
        expect(b.maxG).toBeGreaterThan(1);
        expect(b.usedMah).toBeGreaterThan(10);
        expect(b.minVolt).toBeLessThan(b.endVolt + 1);
        console.log('session stats of the 60 s flight:', JSON.stringify(b));
    });

    it('control: hooks wired by hand without the rewind flag miss the rewinds, so only the stats option replays them', () => {
        const { r, st } = live();
        const hand = new FlightStats([SPAWN[0], SPAWN[1], SPAWN[2]], 550);
        replayLives(r.lives(), deps(WORLD), {
            onStep: (sim) => hand.onStep(sim),
            onEvent: (e) => hand.onEvent(e),
            onLife: (l, i) => { if (i > 0) hand.newLife([l.header.life.at[0], l.header.life.at[1], l.header.life.at[2]], l.header.life.reason); }
        });
        expect(hand.session().rewinds).toBe(0);
        expect(hand.session()).not.toEqual(st.session());
        expect({ ...hand.session(), rewinds: 3 }).toEqual(st.session());
    });

    it('R (to the start) is a respawn but not a rewind; Y is both', () => {
        const r = newRunner({ world: WORLD, at: SPAWN });
        const d = attachDirector(r, SPAWN);
        const st = new FlightStats([SPAWN[0], SPAWN[1], SPAWN[2]], 550);
        r.stats = st;
        const p = new Pilot(r);
        p.plan = (pp, sim) => { if (pp.phase === '') { pp.bot.setTask({ kind: 'hover', target: [0, 1, 0], yawDeg: 0 }, sim); pp.phase = 'hover'; } };
        runFrames(r, 60, 7_000_000);
        d.request('start');
        runFrames(r, 60, 7_100_000, { phaseUs: 7_000_000 });
        expect(st.session().respawns).toEqual({ 'manual-start': 1 });
        expect(st.session().rewinds).toBe(0);
        runFrames(r, 60, 13_000_000, { phaseUs: 7_100_000 });
        d.request('rewind');
        runFrames(r, 60, 13_100_000, { phaseUs: 13_000_000 });
        expect(st.session().respawns).toEqual({ 'manual-start': 1, 'manual-rewind': 1 });
        expect(st.session().rewinds).toBe(1);
        expect(d.last!.kind).toBe('rewind');
    });

    it('control: one LSB tampered in the log gives different stats', () => {
        const { r, st } = live();
        const lives = r.lives().map((l, i): Life => {
            if (i !== 0) return l;
            const b = l.bytes().slice();
            const v = new DataView(b.buffer);
            const o = 500 * REC_BYTES + 4 + 2 * 4; // the throttle of record 500, while hovering
            v.setUint32(o, v.getUint32(o, true) ^ 1, true);
            return { header: l.header, endTick: l.endTick, bytes: () => b };
        });
        expect(replayed(lives).session).not.toEqual(st.session());
    });
});
