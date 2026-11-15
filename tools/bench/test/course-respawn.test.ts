// Stage G3-respawn (course3, the owner's message 51: "the course progress must be tied to the respawn"). The course in
// flight (apps/fly/src/course/run.ts CourseRun, the same object builtin/course.ts feeds every frame) after a new life of
// the craft, as courseLife decides it from the life's reason and the respawn director's decision:
// - a crash respawned where it was keeps the lap, the next gate and the running clock;
// - R (or any respawn at the very start) restarts the course;
// - Y (a rewind) puts the course back to what it was at the moment the craft is put back to, its clock included.
// Three rings along -Z at 10, 20 and 30 m, an open course; the craft flies 10 m/s in 1 ms ticks, fed every tick.
import { describe, expect, it } from 'vitest';
import type { TrackFile, Vec3 } from '@shramko/sonic-fpv';
import { S } from '@gsfpv/sim-core';
import * as runMod from '../../../apps/fly/src/course/run';
import type { CourseLife, LifeDecision } from '../../../apps/fly/src/course/run';

const ring = (i: number, z: number) => ({
    id: `g${i + 1}`, shape: { kind: 'ring', diameter: 2, tube: 0.05 }, pos: [0, 1.5, z] as Vec3, quat: [1, 0, 0, 0], direction: 'forward'
});
const TRACK = {
    format: 'shramko-sonic-track/1', id: 'respawn-test', version: 1, parent: null, title: 'respawn test',
    scene: { kind: 'scan', id: 'test', version: 1 }, transform: [1, 0, 0, 0],
    gates: [ring(0, -10), ring(1, -20), ring(2, -30)], laps: 1, start: null,
    author: { kind: 'generator', name: 'test' }, generator: null
} as unknown as TrackFile;

/** A stand-in of the sim the feature reads: its tick and the craft's position. */
class FakeSim {
    tick = 0;
    readonly s = new Float64Array(64);
    at(z: number): void {
        this.s[S.px] = 0;
        this.s[S.py] = 1.5;
        this.s[S.pz] = z;
    }
}

/** Fly from z0 to z1 at 10 m/s, one feed a tick; the events with their ticks. */
function fly(run: runMod.CourseRun, sim: FakeSim, z0: number, z1: number): [string, number][] {
    const out: [string, number][] = [];
    const steps = Math.round(Math.abs(z1 - z0) * 100);
    for (let i = 0; i <= steps; i++) {
        if (i > 0) sim.tick++;
        sim.at(z0 + ((z1 - z0) * i) / steps);
        const { ev } = run.fromSim(sim);
        if (ev) out.push([ev, sim.tick]);
    }
    return out;
}

/** The new life as builtin/course.ts hands it on: courseLife decides, afterLife applies (both missing on the old code). */
function life(run: runMod.CourseRun, reason: string, last: LifeDecision | null, now: number): CourseLife {
    const api = runMod as unknown as { courseLife?: unknown };
    expect(typeof api.courseLife, 'courseLife decides what a new life does to the course').toBe('function');
    const l = runMod.courseLife(reason, last, now);
    run.afterLife(l, now);
    return l;
}

const tickOf = (evs: [string, number][], name: string): number => {
    const e = evs.find((x) => x[0] === name);
    expect(e, `event ${name}`).toBeDefined();
    return e![1];
};

describe('the course follows the respawn (G3-respawn)', () => {
    it('a crash respawned where it was keeps the lap, the next gate and the clock, which runs on', () => {
        const run = new runMod.CourseRun(TRACK, { s: 1, t: [0, 0, 0] });
        const sim = new FakeSim();
        const a = fly(run, sim, 0.005, -24);
        const start = tickOf(a, 'start');
        expect(a.map((e) => e[0])).toEqual(['start', 'gate']);
        // the crash at -24 m; the automatic respawn 1.5 s later, rewindS back along the path (to -15 m)
        sim.tick += 1500;
        const now = sim.tick;
        const l = life(run, 'crash', { tick: now, kind: 'rewind', sampleTick: now - 1500 - 900 }, now);
        expect(l).toEqual({ kind: 'keep' });
        const v = run.view(now);
        expect(v.running).toBe(true);
        expect(v.next).toBe(2);
        expect(v.splits.length).toBe(1);
        expect(v.lapMs).toBe(now - start);
        // flies on from -15 m: gate 2 (passed before) does not count again, gate 3 ends the lap on the same clock
        const b = fly(run, sim, -15, -32);
        expect(b.map((e) => e[0])).toEqual(['done']);
        expect(run.view().lastLapMs).toBe(tickOf(b, 'done') - start);
        // a stuck craft put back the same way: the same rule
        expect(runMod.courseLife('stuck-flipped', { tick: 9, kind: 'rewind', sampleTick: 1 }, 9)).toEqual({ kind: 'keep' });
    });

    it('R (back to the very start) restarts the course; so does a crash respawned at the start and a new flight', () => {
        const run = new runMod.CourseRun(TRACK, { s: 1, t: [0, 0, 0] });
        const sim = new FakeSim();
        fly(run, sim, 0.005, -24);
        expect(run.view().next).toBe(2);
        sim.tick += 10;
        const l = life(run, 'manual-start', { tick: sim.tick, kind: 'start', sampleTick: null }, sim.tick);
        expect(l).toEqual({ kind: 'restart' });
        const v = run.view(sim.tick);
        expect(v.running).toBe(false);
        expect(v.next).toBe(0);
        expect(v.lapMs).toBe(0);
        expect(v.splits).toEqual([]);
        // from the start again: gate 1 starts a new attempt
        expect(fly(run, sim, 0.005, -12).map((e) => e[0])).toEqual(['start']);
        expect(runMod.courseLife('crash', { tick: 5, kind: 'start', sampleTick: null }, 5)).toEqual({ kind: 'restart' });
        expect(runMod.courseLife('manual-rewind', { tick: 5, kind: 'start', sampleTick: null }, 5)).toEqual({ kind: 'restart' });
        expect(runMod.courseLife('settings', { tick: 5, kind: 'rewind', sampleTick: 1 }, 5)).toEqual({ kind: 'restart' });
        // a decision of an earlier tick is not this life's
        expect(runMod.courseLife('crash', { tick: 4, kind: 'rewind', sampleTick: 1 }, 5)).toEqual({ kind: 'restart' });
    });

    it('Y puts the course back to that moment: the next gate, the splits and the clock as they were then', () => {
        const run = new runMod.CourseRun(TRACK, { s: 1, t: [0, 0, 0] });
        const sim = new FakeSim();
        const a = fly(run, sim, 0.005, -28);
        const start = tickOf(a, 'start');
        const gate2 = tickOf(a, 'gate');
        expect(run.view().next).toBe(2);
        // Y at -28 m: the craft goes back to where it was 500 ms after the start (-15 m), before gate 2
        sim.tick += 1;
        const now = sim.tick;
        const sample = start + 500;
        const l = life(run, 'manual-rewind', { tick: now, kind: 'rewind', sampleTick: sample }, now);
        expect(l).toEqual({ kind: 'rewind', to: sample });
        const v = run.view(now);
        expect(v.running).toBe(true);
        expect(v.next).toBe(1);
        expect(v.splits).toEqual([]);
        expect(v.lapMs).toBe(500);
        // flown again from there: gate 2 counts again, with the split it had the first time
        const b = fly(run, sim, -15, -21);
        expect(b.map((e) => e[0])).toEqual(['gate']);
        expect(run.view().splits).toEqual([gate2 - start]);
        // a rewind to before the start: the attempt as it was then, not started
        sim.tick += 1;
        life(run, 'manual-rewind', { tick: sim.tick, kind: 'rewind', sampleTick: start - 100 }, sim.tick);
        expect(run.view(sim.tick).running).toBe(false);
        expect(run.view(sim.tick).next).toBe(0);
    });
});
