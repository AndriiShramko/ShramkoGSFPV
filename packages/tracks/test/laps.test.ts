// LapTimer (packages/tracks/src/laps.ts) on scripted paths: three rings on a line along -Z, flown forward. Controls inside:
// a skipped gate gives no lap, a backward pass does not count, a 5 s pause adds no time, a respawn ends the attempt.
import { describe, expect, it } from 'vitest';
import type { SonicObject, Vec3 } from '@shramko/sonic-fpv';
import { LapTimer } from '../src/laps';

const ring = (i: number, z: number, x = 0): SonicObject => ({
    id: `g${i + 1}`, shape: { kind: 'ring', diameter: 1, tube: 0.05 }, pos: [x, 1.5, z], quat: [1, 0, 0, 0], order: i, solid: false, material: 'obstacle'
});
const GATES = [ring(0, -10), ring(1, -20), ring(2, -30)];

/** Fly the polyline `pts` at `mps` metres a second in 1 ms steps from `t0`; feed the timer; the events with their times. */
function fly(timer: LapTimer, pts: readonly Vec3[], t0 = 0, mps = 10, hook?: (tMs: number) => void): { events: [string, number][]; t: number } {
    const events: [string, number][] = [];
    let t = t0;
    for (let k = 1; k < pts.length; k++) {
        const a = pts[k - 1], b = pts[k];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
        const steps = Math.max(1, Math.round((len / mps) * 1000));
        let prev: Vec3 = a;
        for (let i = 1; i <= steps; i++) {
            const u = i / steps;
            const now: Vec3 = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
            t += 1;
            hook?.(t);
            const e = timer.step(t, prev, now);
            if (e) events.push([e, t]);
            prev = now;
        }
    }
    return { events, t };
}

const STRAIGHT: Vec3[] = [[0, 1.5, 0], [0, 1.5, -40]];

describe('LapTimer', () => {
    it('an open course flown through every gate in order is one lap, timed from gate 1 to the last gate', () => {
        const timer = new LapTimer(GATES, { laps: 1 });
        const { events } = fly(timer, STRAIGHT);
        expect(events.map((e) => e[0])).toEqual(['start', 'gate', 'done']);
        const v = timer.view();
        expect(v.laps).toBe(1);
        // 20 m at 10 m/s = 2000 ms (one step of 1 ms either way)
        expect(Math.abs((v.lastLapMs ?? 0) - 2000)).toBeLessThanOrEqual(1);
        expect(v.bestLapMs).toBe(v.lastLapMs);
    });

    it('control: a skipped gate gives no lap, and the gate after it does not count', () => {
        const timer = new LapTimer(GATES, { laps: 1 });
        // around gate 2 (x = 5 at z = -20), back on the line for gate 3
        const { events } = fly(timer, [[0, 1.5, 0], [0, 1.5, -15], [5, 1.5, -20], [0, 1.5, -25], [0, 1.5, -40]]);
        expect(events.map((e) => e[0])).toEqual(['start']);
        expect(timer.view().laps).toBe(0);
        expect(timer.view().next).toBe(1);
        expect(timer.view().lastLapMs).toBeNull();
    });

    it('control: a backward pass does not count', () => {
        const timer = new LapTimer(GATES, { laps: 1 });
        const { events } = fly(timer, [[0, 1.5, -40], [0, 1.5, 0]]);
        expect(events).toEqual([]);
        expect(timer.view().running).toBe(false);
    });

    it('control: a pause of 5 s inside the lap adds no time', () => {
        const plain = new LapTimer(GATES, { laps: 1 });
        fly(plain, STRAIGHT);
        // half way between gate 1 and gate 2 (z = -15 at 1.5 s) the clock is held for 5 s: the steps after it carry times 5 s later
        const later = new LapTimer(GATES, { laps: 1 });
        let offset = 0;
        const evs: [string, number][] = [];
        let prev: Vec3 = [0, 1.5, 0];
        for (let i = 1; i <= 4000; i++) {
            const now: Vec3 = [0, 1.5, -i / 100];
            if (i === 1500) {
                later.pause(i);
                expect(later.view(i + 5000).lapMs).toBe(later.view(i).lapMs);
                // a step fed while paused is ignored
                expect(later.step(i + 10, prev, prev)).toBeNull();
                later.resume(i + 5000);
                offset = 5000;
            }
            const e = later.step(i + offset, prev, now);
            if (e) evs.push([e, i + offset]);
            prev = now;
        }
        expect(evs.map((e) => e[0])).toEqual(['start', 'gate', 'done']);
        expect(Math.abs((later.view().lastLapMs ?? 0) - (plain.view().lastLapMs ?? 0))).toBeLessThanOrEqual(1);
        // the same 5 s without pause() is counted: the control fires
        const unpaused = new LapTimer(GATES, { laps: 1 });
        prev = [0, 1.5, 0];
        offset = 0;
        for (let i = 1; i <= 4000; i++) {
            const now: Vec3 = [0, 1.5, -i / 100];
            if (i === 1500) offset = 5000;
            unpaused.step(i + offset, prev, now);
            prev = now;
        }
        expect((unpaused.view().lastLapMs ?? 0) - (plain.view().lastLapMs ?? 0)).toBe(5000);
    });

    it('a closed course: gate 1 again ends the lap and starts the next; after `laps` laps the attempt is done', () => {
        const timer = new LapTimer(GATES, { laps: 2 });
        // forward through the line, back outside the gates (x = 10), again, twice
        const loop: Vec3[] = [[0, 1.5, -40], [10, 1.5, -40], [10, 1.5, 0], [0, 1.5, 0], [0, 1.5, -40]];
        const { events } = fly(timer, [...STRAIGHT, ...loop.slice(1), ...loop.slice(1)]);
        expect(events.map((e) => e[0])).toEqual(['start', 'gate', 'gate', 'lap', 'gate', 'gate', 'done']);
        const v = timer.view();
        expect(v.laps).toBe(2);
        expect(v.running).toBe(false);
        // a lap: 30 m out to z = -40, 10 + 40 + 10 m back, 10 m to gate 1 = 100 m at 10 m/s
        expect(Math.abs((v.lastLapMs ?? 0) - 10000)).toBeLessThanOrEqual(2);
    });

    it('control: a respawn ends the attempt, and the best lap stays', () => {
        const timer = new LapTimer(GATES, { laps: 1, bestMs: 1500 });
        fly(timer, [[0, 1.5, 0], [0, 1.5, -25]]);
        expect(timer.view().running).toBe(true);
        timer.reset();
        expect(timer.view().running).toBe(false);
        expect(timer.view().next).toBe(0);
        // the rest of the line alone gives nothing: gate 1 is next again
        expect(fly(timer, [[0, 1.5, -25], [0, 1.5, -40]]).events).toEqual([]);
        expect(timer.view().bestLapMs).toBe(1500);
    });
});
