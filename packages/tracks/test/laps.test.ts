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

describe('lane mix X2: in Fly by Sound a flat square and a cube frame pass by their ball; in the ordinary flight strictly', () => {
    const c45 = Math.SQRT1_2;
    // a square 1.2 m lying flat 2 m over the line (pitched up 90 degrees: its pass axis points down, it is passed upward)
    const flat: SonicObject = { id: 'g2', shape: { kind: 'square', side: 1.2, bar: 0.1 }, pos: [0, 3.5, -20], quat: [c45, c45, 0, 0], order: 1, solid: false, material: 'obstacle' };
    const cube: SonicObject = { id: 'g2', shape: { kind: 'cube-frame', side: 1.2, bar: 0.1 }, pos: [1.5, 1.5, -20], quat: [1, 0, 0, 0], order: 1, solid: false, material: 'obstacle' };
    const course = (mid: SonicObject): SonicObject[] => [ring(0, -10), mid, ring(2, -30)];
    const byEar = (t: LapTimer, on: boolean): void => (t as { setByEar?: (on: boolean) => void }).setByEar?.(on);
    const kinds = (events: [string, number][]): string[] => events.map((e) => e[0]);
    // the line flies 2 m under the flat square's centre and 1.5 m beside the cube's: inside the ball (0.7 + 1.5 m), outside the opening
    it('the ball counts a flat square and a cube frame passed beside, only while Fly by Sound is on', () => {
        for (const mid of [flat, cube]) {
            const ear = new LapTimer(course(mid), { laps: 1 });
            byEar(ear, true);
            expect(kinds(fly(ear, STRAIGHT).events)).toEqual(['start', 'gate', 'done']);
            const eye = new LapTimer(course(mid), { laps: 1 });
            expect(kinds(fly(eye, STRAIGHT).events)).toEqual(['start']);
        }
    });
    it('the ordinary flight counts the flat square climbed through its opening; the ball does not reach 3 m off', () => {
        const climb: Vec3[] = [[0, 1.5, 0], [0, 1.5, -19], [0, 2, -20], [0, 5, -20], [0, 1.5, -25], [0, 1.5, -40]];
        expect(kinds(fly(new LapTimer(course(flat), { laps: 1 }), climb).events)).toEqual(['start', 'gate', 'done']);
        const far: Vec3[] = [[3, 1.5, 0], [3, 1.5, -40]];
        const ear = new LapTimer([flat], { laps: 1 });
        byEar(ear, true);
        expect(fly(ear, far).events).toEqual([]);
    });
    it('upright squares, rings and a tunnel keep the strict pass in Fly by Sound; switching keeps the progress', () => {
        const upright: SonicObject = { ...flat, quat: [1, 0, 0, 0], pos: [1.5, 1.5, -20] };
        const ear = new LapTimer(course(upright), { laps: 1 });
        byEar(ear, true);
        expect(kinds(fly(ear, STRAIGHT).events)).toEqual(['start']);
        const sw = new LapTimer(course(cube), { laps: 1 });
        const first = fly(sw, [[0, 1.5, 0], [0, 1.5, -15]]);
        byEar(sw, true);
        const rest = fly(sw, [[0, 1.5, -15], [0, 1.5, -40]], first.t);
        expect([...kinds(first.events), ...kinds(rest.events)]).toEqual(['start', 'gate', 'done']);
    });
});

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

    it('course4 C1: the view lists each finished lap of the attempt (the results card reads them)', () => {
        const timer = new LapTimer(GATES, { laps: 1 });
        expect(timer.view().lapTimes).toEqual([]);
        fly(timer, STRAIGHT);
        const v = timer.view();
        expect(v.lapTimes).toHaveLength(1);
        expect(v.lapTimes[0]).toBe(v.lastLapMs);
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
