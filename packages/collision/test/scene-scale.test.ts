// Scene scale around the drone (docs/architecture-v03.md E.7, item 11), the log side: a world
// record (kind 2) carries s and t; the page's replay rebuilds the scaled walls from the scan's own
// bytes (apps/fly session/replay.ts depsFor over session/world.ts), so a rescaled flight replays to
// the hash it was flown with. A scale-down that leaves the craft touching a wall pushes it out
// with a 'world' respawn (session.setTransform's pushOut). The flight model is the real one
// (sim-core) in a 10 m voxel room; transformCollision's own equivalence is in transform.test.ts.
import { describe, expect, it } from 'vitest';
import { Runner, S, attitude, compileParams, lifeSim, replayLives } from '../../sim-core/src/index';
import type { LifeHeader, Runner as RunnerT } from '../../sim-core/src/index';
import { PRESET, header } from '../../sim-core/test/log-kit';
import { LivesPlayer, lifeProblem, replayLivesTrack } from '../../../apps/fly/src/session/replay';
import type { WallsSource } from '../../../apps/fly/src/session/replay';
import { IDENTITY, f32, packed, pushOut, scaledCollision, worldUnder } from '../../../apps/fly/src/session/world';
import type { SceneTransform } from '../../../apps/fly/src/session/world';
import { VoxelContactWorld, rescaleAround, syntheticRoom } from '../src/index';

const P = compileParams(PRESET, {});
const ROOM = syntheticRoom(0.05, 5); // walls one voxel thick at +-5 m on every axis
const SHA = 'b'.repeat(64);
const WALLS: WallsSource = { collisionSha256: SHA, world: new VoxelContactWorld(ROOM), collision: ROOM };
const END_US = 6_000_000;

function scene(tr: SceneTransform): LifeHeader['scene'] {
    return { id: 'room', version: 1, transform: packed(tr), floaterMinBlocks: 0 };
}

/** A runner as the session builds one: the walls under the scene's transform, the header saying which. */
function flight(at: [number, number, number, number], tr: SceneTransform = IDENTITY): RunnerT {
    const r = new Runner(lifeSim(P, worldUnder(WALLS, tr)), header({ at, collisionSha256: SHA, scene: scene(tr) }), { traceHash: true });
    // the session's onWorld: the walls under the record's transform (it builds them with the same function)
    r.onWorld = (w) => { r.sim.world = worldUnder(WALLS, w); };
    return r;
}

/** Arm, climb 0.7 s, then pitch forward hard: into the -z or +z wall (as walls-switch.test.ts). */
function fly(r: RunnerT, fromUs: number, toUs: number, at?: (r: RunnerT, us: number) => void): void {
    for (let t = fromUs + 4000; t <= toUs; t += 4000) {
        const climb = t < 700_000;
        const ch = t < 20_000 ? [0, 0, -1, 0, -1, 1, 0, 0] : t < 100_000 ? [0, 0, -1, 0, 1, 1, 0, 0] : [0, climb ? 0 : 0.9, climb ? 0.2 : 0.35, 0, 1, 1, 0, 0];
        r.enqueue({ tUs: t, ch });
        r.advanceTo(t);
        at?.(r, t);
    }
}

const here = (r: RunnerT): [number, number, number, number] => {
    const s = r.sim.s;
    return [s[S.px], s[S.py], s[S.pz], attitude(s).yaw];
};

/** Rescale by k around the craft, as session.setTransform does: Float32 values, a world record. */
function rescale(r: RunnerT, from: SceneTransform, k: number): SceneTransform {
    const to = f32(rescaleAround(from, k, here(r).slice(0, 3)));
    r.world({ s: to.s, t: [to.t[0], to.t[1], to.t[2]], floaterMinBlocks: 0 });
    return to;
}

/** Every life's trace hash as flown: ended lives hold theirs, the current one is read live. */
const liveHashes = (r: RunnerT): string[] => r.lives().map((l, i, a) => (i === a.length - 1 ? r.liveLifeHash()!.hash : l.traceHash!));

describe('a world record replays to the same hash (E.7)', () => {
    const r = flight([0, -3.5, 0, 0]);
    let tr: SceneTransform = IDENTITY;
    fly(r, 0, END_US, (rr, t) => { if (t === 1_000_000) tr = rescale(rr, tr, 0.6); });
    const end = r.sim.tick;
    const contacts = r.events.filter((e) => e.type === 'contact' || e.type === 'crash').length;

    it('the record is in the log and the walls of the flight are the scaled ones', () => {
        expect(tr.s).toBe(Math.fround(0.6));
        expect(contacts).toBeGreaterThan(0);
        expect(r.lives()).toHaveLength(1);
        expect(lifeProblem(r.current().header, WALLS)).toBeNull();
    });

    it('the page replay (depsFor over the scan\'s own walls) gives the same hash and the same final state', () => {
        const rep = replayLivesTrack(r.lives(), WALLS, end);
        expect(rep.hashes).toEqual(liveHashes(r));
        const pl = new LivesPlayer(r.lives(), WALLS, end);
        pl.stepTo(end);
        expect(Array.from(pl.sim.s)).toEqual(Array.from(r.sim.s));
    });

    it('control: a replay that ignores the world record (the scan\'s walls throughout) diverges', () => {
        const ignore = replayLives(r.lives(), { preset: () => PRESET, world: () => WALLS.world }, end);
        expect(Array.from(ignore.sim.s)).not.toEqual(Array.from(r.sim.s));
        // and so does one that cannot rebuild the scaled walls: they vanish instead
        const noBase = new LivesPlayer(r.lives(), { ...WALLS, collision: null }, end);
        noBase.stepTo(end);
        expect(Array.from(noBase.sim.s)).not.toEqual(Array.from(r.sim.s));
    });
});

describe('a scale-down that leaves the craft in a wall pushes it out (E.7)', () => {
    const R = P.boundRadius + 0.03; // session.setTransform's push-out radius
    const touch = P.boundRadius + 0.01; // session.spawnIsFree's test
    // parked 1.5 R from the +x wall's face (x = 4.95): halving the scene around it leaves 0.75 R
    const at: [number, number, number, number] = [4.95 - 1.5 * R, 0, 0, 0];
    const r = flight(at);
    r.advanceTo(200_000);
    const to = rescale(r, IDENTITY, 0.5);
    const walls = scaledCollision(ROOM, to);
    const push = { x: 0, y: 0, z: 0 };
    const inside = walls.querySphere(at[0], at[1], at[2], touch, push);
    const out = pushOut(walls, here(r), R);
    if (out) r.respawn(out[0], out[1], out[2], out[3], { platform: true, keepArmed: true }, 'world');
    fly(r, 200_000, 1_200_000);
    const end = r.sim.tick;

    it('control: without the push-out the craft starts inside a wall', () => {
        expect(here(r)).not.toEqual(at); // (the push-out below moved it)
        expect(inside).toBe(true);
    });

    it('the push-out moves it to a free spot near where it was, with a \'world\' respawn that keeps the new size', () => {
        expect(out).not.toBeNull();
        const o = out!;
        expect(walls.querySphere(o[0], o[1], o[2], touch, push)).toBe(false);
        expect(Math.hypot(o[0] - at[0], o[1] - at[1], o[2] - at[2])).toBeLessThan(4 * R);
        const lives = r.lives();
        expect(lives).toHaveLength(2);
        expect(lives[1].header.life.reason).toBe('world');
        expect(lives[1].header.scene?.transform).toEqual(packed(to));
    });

    it('both lives replay to the hashes they were flown with', () => {
        expect(replayLivesTrack(r.lives(), WALLS, end).hashes).toEqual(liveHashes(r));
    });
});

describe('the identity is the scan as it is (no rescale: replays exactly as before E.7)', () => {
    it('worldUnder gives the base world itself, scaledCollision the base collision', () => {
        expect(worldUnder(WALLS, IDENTITY)).toBe(WALLS.world);
        expect(scaledCollision(ROOM, IDENTITY)).toBe(ROOM);
        expect(worldUnder(WALLS, { s: 2, t: [0, 0, 0] })).not.toBe(WALLS.world);
    });

    it('a life flown rescaled cannot replay where the scan\'s own walls are missing', () => {
        const h = header({ at: [0, 0, 0, 0], collisionSha256: SHA, scene: scene({ s: 2, t: [0, 0, 0] }) });
        expect(lifeProblem(h, WALLS)).toBeNull();
        expect(lifeProblem(h, { ...WALLS, collision: null })).toMatch(/rescaled/);
    });
});
