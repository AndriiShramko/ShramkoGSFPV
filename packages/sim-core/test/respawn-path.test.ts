// Review finding C5: a crash less than 5 s after a respawn rewound the craft to before that
// respawn. pickBefore counted plain ticks, so "5 s back" from a crash 3.25 s after an automatic
// rewind reached into the wreck-and-delay window and walked back to the sample 39 ms before the
// first crash, 24 cm in front of that wall; after R it reached back to where the pilot was before R.
// StateHistory now keeps the path the pilot flew (a rewind cuts out what it undid, R starts a new
// one) and measures ages along it. Control: a shadow history fed the same samples and events but
// never told about the respawns, with no crash margin: the old algorithm on the same flight.

import { describe, expect, it } from 'vitest';
import { StateHistory } from '../src/index';
import type { HistorySample, RespawnDecision, RespawnDirector, Runner, SimEvent } from '../src/index';
import { PlaneWorld, Pilot, attachDirector, newRunner, runFrames } from './log-kit';

/** The same samples and events as the director's history, but the old rule: no path edits, no crash margin. */
function shadow(r: Runner, d: RespawnDirector): StateHistory {
    const h = new StateHistory({ crashMarginTicks: 0 });
    const step = r.onStep;
    r.onStep = (sim) => { step?.(sim); h.onStep(sim); };
    const ev = d.onEvent.bind(d);
    d.onEvent = (e: SimEvent) => { h.onEvent(e); ev(e); };
    return h;
}

interface Seen { dec: RespawnDecision; old: HistorySample | null }

/** Every decision as it is applied, with what the old rule would have picked for the same incident. */
function watch(r: Runner, d: RespawnDirector, old: StateHistory): Seen[] {
    const out: Seen[] = [];
    r.onLife = () => {
        if (!d.last) return;
        out.push({ dec: { ...d.last }, old: old.pickBefore(d.last.incidentTick, d.policy.rewindTicks) });
    };
    return out;
}

describe('rewinds stay on the path the pilot flew (review C5)', () => {
    it('a crash 3-5 s after an automatic rewind (3.41 s) goes 5 s back along the path: before the first rewind point, 24 m from the first wall', () => {
        // floor, wall A at x = 4, wall B at z = 3
        const world = new PlaneWorld([[0, 1, 0, 0], [-1, 0, 0, -4], [0, 0, -1, -3]]);
        const spawn: [number, number, number, number] = [-20, 1, 0, 90];
        const r = newRunner({ world, at: spawn });
        const d = attachDirector(r, spawn);
        const old = shadow(r, d);
        const seen = watch(r, d, old);
        const p = new Pilot(r);
        p.plan = (pp, sim, lt) => {
            if (pp.phase === '') { pp.bot.setTask({ kind: 'hover', target: pp.here(sim), yawDeg: 90 }, sim); pp.phase = 'hover'; }
            // life 0: 4 s at the spawn, then along +x into wall A at 4.6 m/s; life 1: 2.5 s, then along +z into wall B
            else if (pp.phase === 'hover' && pp.life === 0 && lt >= 4000 && sim.armed) { pp.bot.setTask({ kind: 'dash', from: pp.here(sim), dir: [1, 0, 0], speed: 4.6, yawDeg: 90 }, sim); pp.phase = 'dash'; }
            else if (pp.phase === 'hover' && pp.life === 1 && lt >= 2500 && sim.armed) { pp.bot.setTask({ kind: 'dash', from: pp.here(sim), dir: [0, 0, 1], speed: 6, yawDeg: 90 }, sim); pp.phase = 'dash'; }
        };
        runFrames(r, 60, 22_000_000);
        const crashes = r.events.filter((e) => e.type === 'crash');
        expect(crashes.length).toBeGreaterThanOrEqual(2);
        const [first, second] = seen;
        expect(first.dec.kind).toBe('rewind');
        expect(second.dec.reason).toBe('crash');
        // the second crash came 3-5 s after the respawn: outside the backoff window, inside the old bug's
        const sinceRespawn = second.dec.incidentTick - r.lives()[1].header.life.startTick;
        expect(sinceRespawn).toBeGreaterThan(3000);
        expect(sinceRespawn).toBeLessThan(5000);
        expect(second.dec.kind).toBe('rewind');
        expect(second.dec.backoff).toBe(1);
        expect(second.dec.pathAgeTicks!).toBeGreaterThanOrEqual(5000);
        expect(second.dec.pathAgeTicks!).toBeLessThanOrEqual(5050);
        // on the first life's path before the point the first rewind went to, near the spawn
        expect(second.dec.sampleTick!).toBeLessThan(first.dec.sampleTick!);
        const at = r.lives()[2].header.life.at;
        expect(4 - at[0]).toBeGreaterThan(20);
        expect(Math.abs(at[2])).toBeLessThan(0.3);
    });

    it('control: the old rule picks the sample just before the first crash, a few centimetres in front of wall A', () => {
        const world = new PlaneWorld([[0, 1, 0, 0], [-1, 0, 0, -4], [0, 0, -1, -3]]);
        const spawn: [number, number, number, number] = [-20, 1, 0, 90];
        const r = newRunner({ world, at: spawn });
        const d = attachDirector(r, spawn);
        const old = shadow(r, d);
        const seen = watch(r, d, old);
        const p = new Pilot(r);
        p.plan = (pp, sim, lt) => {
            if (pp.phase === '') { pp.bot.setTask({ kind: 'hover', target: pp.here(sim), yawDeg: 90 }, sim); pp.phase = 'hover'; }
            else if (pp.phase === 'hover' && pp.life === 0 && lt >= 4000 && sim.armed) { pp.bot.setTask({ kind: 'dash', from: pp.here(sim), dir: [1, 0, 0], speed: 4.6, yawDeg: 90 }, sim); pp.phase = 'dash'; }
            else if (pp.phase === 'hover' && pp.life === 1 && lt >= 2500 && sim.armed) { pp.bot.setTask({ kind: 'dash', from: pp.here(sim), dir: [0, 0, 1], speed: 6, yawDeg: 90 }, sim); pp.phase = 'dash'; }
        };
        runFrames(r, 60, 22_000_000);
        const firstCrash = r.events.find((e) => e.type === 'crash')!;
        const o = seen[1].old!;
        expect(firstCrash.tick - o.tick).toBeLessThanOrEqual(100);
        expect(4 - o.x).toBeLessThan(0.6);
    });

    it('a crash 3-5 s after R (3.56 s) goes back to the start, not to where the pilot was before R', () => {
        const world = PlaneWorld.room({ wallX: 4 });
        const spawn: [number, number, number, number] = [0, 1, 0, 0];
        const r = newRunner({ world, at: spawn });
        const d = attachDirector(r, spawn);
        const old = shadow(r, d);
        const seen = watch(r, d, old);
        const p = new Pilot(r);
        let pressed = false;
        p.plan = (pp, sim, lt) => {
            if (pp.phase === '') { pp.bot.setTask({ kind: 'hover', target: pp.here(sim), yawDeg: 0 }, sim); pp.phase = 'hover'; }
            // life 0: out to (-15, 2, 10), R at 8 s; life 1 (at the spawn): 2.5 s, then into the wall at x = 4
            else if (pp.phase === 'hover' && pp.life === 0 && lt >= 1000 && sim.armed) { pp.bot.setTask({ kind: 'path', points: [[-15, 2, 10]], speed: 4, yawDeg: 0 }, sim); pp.phase = 'out'; }
            else if (pp.phase === 'out' && lt >= 8000 && !pressed) { d.request('start'); pressed = true; }
            else if (pp.phase === 'hover' && pp.life === 1 && lt >= 2500 && sim.armed) { pp.bot.setTask({ kind: 'dash', from: pp.here(sim), dir: [1, 0, 0], speed: 6, yawDeg: 0 }, sim); pp.phase = 'dash'; }
        };
        runFrames(r, 60, 16_000_000);
        const [byR, afterCrash] = seen;
        expect(byR.dec.reason).toBe('manual-start');
        expect(afterCrash.dec.reason).toBe('crash');
        const sinceR = afterCrash.dec.incidentTick - r.lives()[1].header.life.startTick;
        expect(sinceR).toBeGreaterThan(3000);
        expect(sinceR).toBeLessThan(5000);
        // nothing 5 s back on the path since R: the start of that path, the spawn
        expect(afterCrash.dec.kind).toBe('start');
        expect(r.lives()[2].header.life.at).toEqual(spawn);
        // control: the old rule reaches back across R, to the far side of the room
        const o = afterCrash.old!;
        expect(o.tick).toBeLessThan(r.lives()[1].header.life.startTick);
        expect(Math.hypot(o.x - spawn[0], o.z - spawn[2])).toBeGreaterThan(10);
    });

    it('Y after a crash rewinds from the crash, not from the key press 4.8 s later', () => {
        const world = PlaneWorld.room({ wallX: 4 });
        const spawn: [number, number, number, number] = [-10, 1, 0, 0];
        const r = newRunner({ world, at: spawn });
        const d = attachDirector(r, spawn, { auto: false });
        const seen = watch(r, d, shadow(r, d));
        const p = new Pilot(r);
        let crashAt = -1;
        p.plan = (pp, sim, lt) => {
            if (pp.phase === '') { pp.bot.setTask({ kind: 'hover', target: pp.here(sim), yawDeg: 0 }, sim); pp.phase = 'hover'; }
            else if (pp.phase === 'hover' && pp.life === 0 && lt >= 6000 && sim.armed) { pp.bot.setTask({ kind: 'dash', from: pp.here(sim), dir: [1, 0, 0], speed: 6, yawDeg: 0 }, sim); pp.phase = 'dash'; }
            else if (pp.phase === 'dash' && sim.crashed && crashAt < 0) crashAt = sim.tick;
            else if (pp.phase === 'dash' && crashAt >= 0 && sim.tick >= crashAt + 4800) { d.request('rewind'); pp.phase = 'done'; }
        };
        runFrames(r, 60, 18_000_000);
        const y = seen[0].dec;
        expect(y.reason).toBe('manual-rewind');
        expect(y.incidentTick).toBe(r.events.find((e) => e.type === 'crash')!.tick);
        expect(y.pathAgeTicks!).toBeGreaterThanOrEqual(5000);
        expect(y.pathAgeTicks!).toBeLessThanOrEqual(5050);
    });

    it('a sample less than 0.5 s before a crash is not safe (one 40 ms before a 4.6 m/s wall impact is no place to respawn)', () => {
        const world = PlaneWorld.room({ wallX: 4 });
        const spawn: [number, number, number, number] = [-20, 1, 0, 90];
        const r = newRunner({ world, at: spawn });
        const d = attachDirector(r, spawn, { auto: false });
        const old = shadow(r, d);
        const p = new Pilot(r);
        p.plan = (pp, sim, lt) => {
            if (pp.phase === '') { pp.bot.setTask({ kind: 'hover', target: pp.here(sim), yawDeg: 90 }, sim); pp.phase = 'hover'; }
            else if (pp.phase === 'hover' && lt >= 1000 && sim.armed) { pp.bot.setTask({ kind: 'dash', from: pp.here(sim), dir: [1, 0, 0], speed: 4.6, yawDeg: 90 }, sim); pp.phase = 'dash'; }
        };
        runFrames(r, 60, 10_000_000);
        const c = r.events.find((e) => e.type === 'crash')!.tick;
        expect(d.history.pickBefore(c, 0)!.tick).toBeLessThanOrEqual(c - 500);
        // control: without the margin the newest sample before the crash counts as safe
        expect(c - old.pickBefore(c, 0)!.tick).toBeLessThan(100);
    });
});
