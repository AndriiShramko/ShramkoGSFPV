// The collision ceiling, the log side (v0.7 lane E; C.9 log format /3): a life flown with a ceiling
// carries it in its header (scene.ceilingM), a change in flight is a world record (ch[5] the height,
// ch[6] its flag), and the page's replay (apps/fly session/replay.ts over session/world.ts) rebuilds
// the same walls from the scan's own. The flight model is the real one (sim-core) in a voxel room with
// one floating piece planted on the flight path, high in the room: a sky speck. Controls: without the
// ceiling the craft meets the speck, and a replay that drops the ceiling flies elsewhere.
import { describe, expect, it } from 'vitest';
import { Runner, S, attitude, compileParams, lifeSim, replayLives } from '../../sim-core/src/index';
import type { Life, LifeHeader, Runner as RunnerT } from '../../sim-core/src/index';
import { PRESET, header } from '../../sim-core/test/log-kit';
import { lifeProblem, replayLivesTrack } from '../../../apps/fly/src/session/replay';
import type { WallsSource } from '../../../apps/fly/src/session/replay';
import { IDENTITY, packed, sceneWalls, worldUnder } from '../../../apps/fly/src/session/world';
import { VoxelContactWorld } from '../src/index';
import type { VoxelCollision } from '../src/index';
import { blocksFromFn, encodeCollision } from './helpers';
import type { Dims } from './helpers';

const P = compileParams(PRESET, {});
const RES = 0.1;
const DIMS: Dims = [100, 100, 100]; // a 10 m room, walls one voxel thick, centred on the origin
const MIN: Dims = [-5, -5, -5];
const SHA = 'd'.repeat(64);
const END_US = 4_000_000;

function room(speck: [number, number, number] | null): VoxelCollision {
    const f = speck?.map((v, i) => Math.floor((v - MIN[i]) / RES));
    return encodeCollision(DIMS, blocksFromFn(DIMS, (x, y, z) => {
        if (x === 0 || y === 0 || z === 0 || x === 99 || y === 99 || z === 99) return true;
        return !!f && Math.abs(x - f[0]) <= 2 && Math.abs(y - f[1]) <= 2 && Math.abs(z - f[2]) <= 2;
    }), { res: RES, min: MIN });
}

const walls = (col: VoxelCollision): WallsSource => ({ collisionSha256: SHA, world: new VoxelContactWorld(col), collision: col });

function scene(c: number | null): NonNullable<LifeHeader['scene']> {
    const sc: NonNullable<LifeHeader['scene']> = { id: 'room', version: 1, transform: packed(IDENTITY), floaterMinBlocks: 0 };
    if (c !== null) sc.ceilingM = c;
    return sc;
}

/** A runner as the session builds one: the ceilinged walls, the header naming the ceiling; world records rebuild them. */
function flight(w: WallsSource, c: number | null, at: [number, number, number, number]): RunnerT {
    const r = new Runner(lifeSim(P, worldUnder(w, IDENTITY, 0, c)), header({ at, collisionSha256: SHA, scene: scene(c) }), { traceHash: true });
    r.onWorld = (ev) => { r.sim.world = worldUnder(w, ev, ev.floaterMinBlocks, ev.ceilingM); };
    return r;
}

/** Arm, climb 0.7 s, then pitch forward hard (as floaters-replay.test.ts). */
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
const contactsOf = (r: RunnerT) => r.events.filter((e) => e.type === 'contact' || e.type === 'crash');
const liveHashes = (r: RunnerT): string[] => r.lives().map((l, i, a) => (i === a.length - 1 ? r.liveLifeHash()!.hash : l.traceHash!));
const firstContact = (x: RunnerT) => contactsOf(x)[0]?.tick ?? Infinity;

const START: [number, number, number, number] = [0, -4.5, 0, 0];
// where the craft is 1.2 s in, flying an empty room: the speck goes there
const probe = flight(walls(room(null)), null, START);
let onPath: [number, number, number] = [0, 0, 0];
fly(probe, 0, 1_200_000, (r, t) => { if (t === 1_200_000) onPath = here(r).slice(0, 3) as [number, number, number]; });
const BASE = room(onPath);
const W = walls(BASE);
// the ceiling: 0.5 m under the speck's centre (its lower face is 0.25 m under it)
const C = Math.fround(onPath[1] - 0.5);

describe('a life flown with a collision ceiling replays only with that ceiling', () => {
    const plain = flight(W, null, START);
    fly(plain, 0, END_US);
    const r = flight(W, C, START);
    fly(r, 0, END_US);
    const end = r.sim.tick;

    it('the speck is on the path: without the ceiling the craft meets it, with it the craft flies on through', () => {
        expect(onPath[1]).toBeGreaterThan(MIN[1] + 1);
        expect(firstContact(plain)).toBeLessThan(1_400);
        expect(firstContact(r)).toBeGreaterThan(firstContact(plain));
        expect(r.lives()[0].header.scene).toMatchObject({ ceilingM: C });
        expect(r.lives()[0].header.format).toBe('gsfpv-input-log/3');
    });

    it('the page\'s replay rebuilds the ceilinged walls from the scan\'s own: the same hashes', () => {
        expect(lifeProblem(r.current().header, W)).toBeNull();
        expect(replayLivesTrack(r.lives(), W, end).hashes).toEqual(liveHashes(r));
    });

    it('control: the same log with the ceiling taken out of its header replays into the speck', () => {
        const lives: Life[] = r.lives().map((l) => {
            const { ceilingM: _drop, ...sc } = l.header.scene!;
            return { ...l, header: { ...l.header, scene: sc }, bytes: () => l.bytes() };
        });
        expect(replayLivesTrack(lives, W, end).hashes).not.toEqual(liveHashes(r));
    });

    it('control: a header with a ceiling the walls cannot take is refused', () => {
        const h = r.current().header;
        expect(lifeProblem({ ...h, scene: { ...h.scene!, ceilingM: 1e9 } }, W)).toMatch(/ceiling/);
        expect(lifeProblem(h, { ...W, collision: null })).toMatch(/collision ceiling/);
    });
});

describe('a ceiling switched on in flight: a world record, the craft flies on (session.setCeiling)', () => {
    const r = flight(W, null, START);
    fly(r, 0, END_US, (rr, t) => {
        if (t === 600_000) rr.world({ s: 1, t: [0, 0, 0], floaterMinBlocks: 0, ceilingM: C });
    });
    const end = r.sim.tick;

    it('one life (no respawn), the record carries the ceiling, and the replay gives the live hash', () => {
        expect(r.lives()).toHaveLength(1);
        expect(firstContact(r)).toBeGreaterThan(1_400);
        expect(replayLivesTrack(r.lives(), W, end).hashes).toEqual(liveHashes(r));
    });

    it('control: the record read as a /2 one (its ceiling flag cleared) replays into the speck', () => {
        const life = r.current();
        const bytes = life.bytes().slice();
        const v = new DataView(bytes.buffer);
        let cleared = 0;
        for (let i = 0; i < bytes.length / 36; i++) {
            if ((v.getInt32(i * 36, true) & 3) !== 2) continue;
            v.setFloat32(i * 36 + 4 + 6 * 4, 0, true); // ch[6]: the flag
            cleared++;
        }
        expect(cleared).toBe(1);
        const asV2: Life = { ...life, bytes: () => bytes };
        expect(replayLivesTrack([asV2], W, end).hashes).not.toEqual(liveHashes(r));
    });

    it('a respawn after it keeps the ceiling in the next header; the walls are the scene walls\' (filter, then ceiling)', () => {
        r.respawn(START[0], START[1], START[2], 0, { platform: true }, 'manual-start');
        expect(r.current().header.scene).toMatchObject({ ceilingM: C });
        expect(sceneWalls(BASE, 0, C).isVoxelSolid(50, 99, 50)).toBe(false); // the room's top is above the ceiling
        expect(sceneWalls(BASE, 0, null).isVoxelSolid(50, 99, 50)).toBe(true);
        // and a plain replay that ignores every world record diverges (control of the record's effect)
        const ignore = replayLives(r.lives().slice(0, 1), { preset: () => PRESET, world: () => W.world }, end);
        expect(ignore.hash).not.toBe(liveHashes(r)[0]);
    });
});
