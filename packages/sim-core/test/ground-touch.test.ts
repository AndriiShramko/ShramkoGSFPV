// A touch of the ground (train 5, lane w2-pilot; a pilot after flying the live site: "the drone is damaged too fast when it
// touches the ground"). Until train 5 every contact crashed from one speed, p.vCrash (Pavo20 Pro: 4 m/s), the floor like a
// wall. Now a contact whose normal points up (ny >= GROUND_NY) crashes from p.vCrashGround; walls keep vCrash. The page
// flies with vCrashGround 7 m/s (setting physics.vCrashGround, in every life header); a header without it (every log
// flown before train 5, the a6 reference) crashes on the ground from vCrash, exactly as it was flown.
import { describe, expect, it } from 'vitest';
import { GROUND_NY, S, compileParams, lifeSim } from '../src/index';
import type { ParamOverrides } from '../src/index';
import { PRESET, PlaneWorld } from './log-kit';

const WALL_X = 0.5;
const ROOM = PlaneWorld.room({ wallX: WALL_X });
/** the page's default (packages/prefs defs/crash.ts physics.vCrashGround) */
const PAGE: ParamOverrides = { vCrashGround: 7 };

/** A level, disarmed craft 2 cm from a surface, moving at v (m/s): did it crash, and at what speed did it touch. */
function touch(where: 'floor' | 'wall', v: [number, number, number], o: ParamOverrides): { crashed: boolean; speed: number } {
    const sim = lifeSim(compileParams(PRESET, o), ROOM);
    const r = sim.p.boundRadius;
    if (where === 'floor') sim.reset(0, r + 0.02, 0, 0);
    else sim.reset(WALL_X - r - 0.02, 1, 0, 0);
    sim.s[S.hold] = 0; // free to move, motors off
    sim.s[S.vx] = v[0];
    sim.s[S.vy] = v[1];
    sim.s[S.vz] = v[2];
    let speed = -1;
    let crashed = false;
    for (let i = 0; i < 400 && speed < 0; i++) {
        const n = sim.events.length;
        sim.step();
        for (let k = n; k < sim.events.length; k++) {
            const e = sim.events[k];
            if (e.type === 'crash') { crashed = true; speed = e.speed; }
            else if (e.type === 'contact') speed = e.speed;
        }
    }
    return { crashed, speed };
}

describe('a touch of the ground crashes from vCrashGround, every other contact from vCrash', () => {
    it('the floor normal counts as ground; a header without vCrashGround keeps the one threshold (old logs, a6)', () => {
        expect(GROUND_NY).toBeGreaterThan(0.5);
        expect(GROUND_NY).toBeLessThanOrEqual(1);
        const p = compileParams(PRESET);
        expect(p.vCrash).toBe(4);
        expect(p.vCrashGround).toBe(4);
        expect(compileParams(PRESET, PAGE).vCrashGround).toBe(7);
    });

    it('at the page default a firm landing at 5 m/s and a skid (5 m/s down, 6 m/s along) leave the craft whole', () => {
        const land = touch('floor', [0, -5, 0], PAGE);
        expect(land.speed).toBeGreaterThan(4.5);
        expect(land.crashed).toBe(false);
        const skid = touch('floor', [6, -5, 0], PAGE);
        expect(skid.speed).toBeGreaterThan(4.5);
        expect(skid.crashed).toBe(false);
    });

    it('at the page default a hard dive into the ground (12 m/s) still breaks it, and so does a 5 m/s hit on a wall', () => {
        expect(touch('floor', [0, -12, 0], PAGE).crashed).toBe(true);
        const wall = touch('wall', [5, 0, 0], PAGE);
        expect(wall.speed).toBeGreaterThan(4.5);
        expect(wall.crashed).toBe(true);
    });

    it('the strict rule: vCrashGround at the crash threshold, or a header without it, breaks the craft on the same landing', () => {
        expect(touch('floor', [0, -5, 0], { vCrashGround: 4 }).crashed).toBe(true);
        expect(touch('floor', [0, -5, 0], {}).crashed).toBe(true);
    });
});
