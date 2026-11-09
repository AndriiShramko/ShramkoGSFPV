// The lesson bump (v0.13, Fly by Sound M41-19; docs/wip/v13-look.md L1-1): ParamOverrides.bump 'slide', which every lesson
// world of the simulator brings (apps/fly lesson-world.ts LESSON_FLIGHT), against the drone's own contact (every scan).
//   - slide: a craft that hits a wall leaves it along the normal at SLIDE_RESTITUTION of the speed it came in at (at least
//     SLIDE_PUSH_MPS), keeps its motion along the wall, and is not spun by the bump; the drone's rule at the duct spins it;
//   - a floor keeps friction (a craft sliding on it slows) and gets no push;
//   - the rule is in the life header: a life flown with it replays to its live hash, the same log with the rule taken out
//     of its header does not; a rule this build does not know is refused; without the override nothing changes.
// The probe of the whole lesson flight (pilot, walls, angles, speeds): tools/bench/test/sonic-bump.test.ts.
import { describe, expect, it } from 'vitest';
import { MODE_CHANNEL, S, SLIDE_PUSH_MPS, SLIDE_RESTITUTION, compileParams, lifeConfigHash, lifeHeaderProblem, lifeSim, replayLife } from '../src/index';
import type { Life, LifeHeader, ParamOverrides, Sim } from '../src/index';
import { PRESET, PlaneWorld, Pilot, deps, newRunner, runFrames } from './log-kit';

const WALL_X = 0.5;
const ROOM = PlaneWorld.room({ wallX: WALL_X });

/**
 * A disarmed craft 2 cm off the wall at x = WALL_X, 1 m over the floor, moving at `v` (m/s): it coasts into the wall; the
 * first contact (its speed and the wall's normal) and the state 50 ms later.
 */
function coastIntoWall(overrides: ParamOverrides, v: [number, number, number]): { contactSpeed: number; nx: number; after: Sim } {
    const sim = lifeSim(compileParams(PRESET, { crashOn: false, ...overrides }), ROOM);
    sim.reset(WALL_X - sim.p.boundRadius - 0.02, 1, 0, 0);
    sim.s[S.hold] = 0; // free to move, motors off
    sim.s[S.vx] = v[0];
    sim.s[S.vy] = v[1];
    sim.s[S.vz] = v[2];
    let contactSpeed = -1;
    let nx = 0;
    for (let i = 0; i < 2000 && contactSpeed < 0; i++) {
        const n = sim.events.length;
        sim.step();
        for (let k = n; k < sim.events.length; k++) {
            const e = sim.events[k];
            if (e.type === 'contact') {
                contactSpeed = e.speed;
                nx = e.nx ?? 0;
            }
        }
    }
    for (let i = 0; i < 50; i++) sim.step();
    return { contactSpeed, nx, after: sim };
}

const spin = (s: ArrayLike<number>): number => Math.hypot(s[S.wx], s[S.wy], s[S.wz]);

describe('the lesson bump (ParamOverrides.bump slide) against the drone\'s own contact', () => {
    it('a 3 m/s hit on a wall: out along the normal at SLIDE_RESTITUTION of it, the motion along the wall kept, no spin', () => {
        const slide = coastIntoWall({ bump: 'slide' }, [3, 0, 1]);
        expect(slide.contactSpeed).toBeGreaterThan(2.9);
        expect(slide.nx).toBe(-1); // the wall
        const s = slide.after.s;
        expect(s[S.vx]).toBeCloseTo(-SLIDE_RESTITUTION * slide.contactSpeed, 1);
        expect(s[S.vz]).toBeGreaterThan(0.97); // no friction along the wall (air drag only)
        expect(spin(s)).toBeLessThan(0.01);
        // control: the drone's own rule at the touching duct spins the craft and slows its slide
        const drone = coastIntoWall({}, [3, 0, 1]);
        expect(spin(drone.after.s)).toBeGreaterThan(5);
        expect(drone.after.s[S.vz]).toBeLessThan(0.9);
    });

    it(`a glancing hit (0.3 m/s into the wall) still pushes out at ${SLIDE_PUSH_MPS} m/s; the drone's rule leaves 0.1 of it`, () => {
        const slide = coastIntoWall({ bump: 'slide' }, [0.3, 0, 3]);
        expect(slide.nx).toBe(-1);
        expect(slide.after.s[S.vx]).toBeCloseTo(-SLIDE_PUSH_MPS, 1);
        const drone = coastIntoWall({}, [0.3, 0, 3]);
        expect(drone.nx).toBe(-1);
        expect(drone.after.s[S.vx]).toBeGreaterThan(-0.1);
    });

    it('a floor keeps friction and gets no push: a craft sliding on it slows, and comes to rest on it', () => {
        const sim = lifeSim(compileParams(PRESET, { crashOn: false, bump: 'slide' }), PlaneWorld.room());
        sim.reset(0, sim.p.bodyBottom + 0.001, 0, 0);
        sim.s[S.hold] = 0;
        sim.s[S.vz] = -2;
        let top = 0;
        for (let i = 0; i < 2000; i++) {
            sim.step();
            if (i > 200) top = Math.max(top, sim.s[S.py] - sim.p.bodyBottom);
        }
        expect(Math.abs(sim.s[S.vz])).toBeLessThan(0.05);
        // on the floor: the 1 mm skin's hops, no push (a push would hop it a centimetre and more for ever)
        expect(top).toBeLessThan(0.003);
    });
});

/** The bot flies a box through the wall at x = WALL_X (acro, 2 m/s): a life with contacts, recorded. */
function flyIntoWall(overrides: ParamOverrides): ReturnType<typeof newRunner> {
    const r = newRunner({ world: ROOM, at: [0, 0.05, 0, 0], overrides: { crashOn: false, ...overrides }, opts: { platform: true } });
    const p = new Pilot(r);
    p.mode = MODE_CHANNEL.acro;
    p.plan = (pp, s) => {
        if (pp.phase === '') { pp.bot.setTask({ kind: 'path', points: [[0, 1, 0], [2, 1, 0], [2, 1, 2], [0, 1, 2]], speed: 2, yawDeg: 0 }, s); pp.phase = 'fly'; }
    };
    runFrames(r, 60, 6_000_000);
    return r;
}

describe('the rule is in the life header: replays fly it, an unknown rule is refused', () => {
    it('a life flown with bump slide replays to its live hash; the same log with the rule taken out of its header does not', () => {
        const r = flyIntoWall({ bump: 'slide' });
        const contacts = r.events.filter((e) => e.type === 'contact').length;
        expect(contacts).toBeGreaterThan(0);
        const life = r.current();
        expect(life.header.overrides.bump).toBe('slide');
        expect(replayLife(life, deps(ROOM)).hash).toBe(r.liveLifeHash()!.hash);
        // control: the header without the rule (its configHash made again, so the header itself is valid)
        const overrides = { ...life.header.overrides };
        delete overrides.bump;
        const h: LifeHeader = { ...life.header, overrides, configHash: lifeConfigHash(life.header.presetSha256, overrides, life.header.simCore) };
        expect(lifeHeaderProblem(h)).toBeNull();
        const changed: Life = { header: h, endTick: life.endTick, bytes: () => life.bytes() };
        expect(replayLife(changed, deps(ROOM)).hash).not.toBe(r.liveLifeHash()!.hash);
    });

    it('a header with a bump rule this build does not know is refused; slide and none are taken', () => {
        const life = flyIntoWall({}).current();
        expect(life.header.overrides.bump).toBeUndefined();
        expect(lifeHeaderProblem(life.header)).toBeNull();
        const withRule = (bump: unknown): LifeHeader => {
            const overrides = { ...life.header.overrides, bump } as ParamOverrides;
            return { ...life.header, overrides, configHash: lifeConfigHash(life.header.presetSha256, overrides, life.header.simCore) };
        };
        expect(lifeHeaderProblem(withRule('slide'))).toBeNull();
        expect(lifeHeaderProblem(withRule('bounce'))).toMatch(/bump rule "bounce"/);
        expect(compileParams(PRESET, {}).bump).toBe('drone');
        expect(compileParams(PRESET, { bump: 'slide' }).bump).toBe('slide');
    });
});
