// G.3 phantom walls, the log side (C.9): a life flown with the floater filter carries N
// (scene.floaterMinBlocks) and the filtered walls' hash (scene.floaterSha256) in its header; the
// page's replay rebuilds the filtered walls from the scan's own (session/replay.ts over
// session/world.ts) and refuses a header whose filter gives other walls. A filter change in flight
// is a world record (ch[4] = N) and a new life, as session.setDropFloaters does. The flight model
// is the real one (sim-core) in a voxel room with one floating piece planted on the flight path.
import { describe, expect, it } from 'vitest';
import { Runner, S, attitude, compileParams, lifeSim, replayLives } from '../../sim-core/src/index';
import type { LifeHeader, Runner as RunnerT } from '../../sim-core/src/index';
import { PRESET, header } from '../../sim-core/test/log-kit';
import { lifeProblem, replayLivesTrack } from '../../../apps/fly/src/session/replay';
import type { WallsSource } from '../../../apps/fly/src/session/replay';
import { IDENTITY, filteredWalls, packed, worldUnder } from '../../../apps/fly/src/session/world';
import { VoxelContactWorld, blockComponents } from '../src/index';
import type { VoxelCollision } from '../src/index';
import { blocksFromFn, encodeCollision } from './helpers';
import type { Dims } from './helpers';

const P = compileParams(PRESET, {});
const RES = 0.1;
const DIMS: Dims = [100, 100, 100]; // a 10 m room, walls one voxel thick, centred on the origin
const MIN: Dims = [-5, -5, -5];
const SHA = 'c'.repeat(64);
const END_US = 4_000_000;

function room(floater: [number, number, number] | null): VoxelCollision {
    const f = floater?.map((v, i) => Math.floor((v - MIN[i]) / RES));
    return encodeCollision(DIMS, blocksFromFn(DIMS, (x, y, z) => {
        if (x === 0 || y === 0 || z === 0 || x === 99 || y === 99 || z === 99) return true;
        // a 0.4 m cube of voxels around the point: a floating piece of a few blocks
        return !!f && Math.abs(x - f[0]) <= 2 && Math.abs(y - f[1]) <= 2 && Math.abs(z - f[2]) <= 2;
    }), { res: RES, min: MIN });
}

const walls = (col: VoxelCollision): WallsSource => ({ collisionSha256: SHA, world: new VoxelContactWorld(col), collision: col });

function scene(n: number, col: VoxelCollision): LifeHeader['scene'] {
    const sc: NonNullable<LifeHeader['scene']> = { id: 'room', version: 1, transform: packed(IDENTITY), floaterMinBlocks: n };
    const sha = filteredWalls(col, n).sha256;
    if (sha) sc.floaterSha256 = sha;
    return sc;
}

/** A runner as the session builds one: the filtered walls, the header naming them. */
function flight(w: WallsSource, n: number, at: [number, number, number, number]): RunnerT {
    const r = new Runner(lifeSim(P, worldUnder(w, IDENTITY, n)), header({ at, collisionSha256: SHA, scene: scene(n, w.collision!) }), { traceHash: true });
    r.onWorld = (ev) => { r.sim.world = worldUnder(w, ev, ev.floaterMinBlocks); };
    return r;
}

/** Arm, climb 0.7 s, then pitch forward hard (as scene-scale.test.ts). */
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

const START: [number, number, number, number] = [0, -4.5, 0, 0];
// where the craft is 1.2 s in, flying an empty room: the floater goes there
const probe = flight(walls(room(null)), 0, START);
let onPath: [number, number, number] = [0, 0, 0];
fly(probe, 0, 1_200_000, (r, t) => { if (t === 1_200_000) onPath = here(r).slice(0, 3) as [number, number, number]; });
const BASE = room(onPath);
const W = walls(BASE);
const SIZE = Math.min(...Array.from(blockComponents(BASE).sizes));
const N = SIZE + 1; // drops the floater (the room's walls are one piece of thousands of blocks)

describe('a life flown with the floater filter replays only on the same filtered walls (G.3, C.9)', () => {
    const plain = flight(W, 0, START);
    fly(plain, 0, END_US);
    const r = flight(W, N, START);
    fly(r, 0, END_US);
    const end = r.sim.tick;
    const firstContact = (x: RunnerT) => contactsOf(x)[0]?.tick ?? Infinity;

    it('the floater is on the path: without the filter the craft meets it, with the filter it flies on to a wall', () => {
        expect(SIZE).toBeGreaterThan(0);
        expect(SIZE).toBeLessThan(64);
        expect(blockComponents(BASE).count).toBe(2);
        expect(firstContact(plain)).toBeLessThan(1_400);
        expect(firstContact(r)).toBeGreaterThan(firstContact(plain));        expect(r.lives()[0].header.scene).toMatchObject({ floaterMinBlocks: N });
        expect(r.lives()[0].header.scene!.floaterSha256).toMatch(/^[0-9a-f]{64}$/);
    });

    it('the matching filter replays to the same hash and the same final state', () => {
        expect(lifeProblem(r.current().header, W)).toBeNull();
        const rep = replayLivesTrack(r.lives(), W, end);
        expect(rep.hashes).toEqual(liveHashes(r));
    });

    it('control: a header whose filter gives other walls is refused (another N, another hash, no hash)', () => {
        const h = r.current().header;
        const other = { ...h, scene: { ...h.scene!, floaterMinBlocks: 1 } };
        expect(lifeProblem(other, W)).toMatch(/rebuilds differently/);
        const tampered = { ...h, scene: { ...h.scene!, floaterSha256: '0'.repeat(64) } };
        expect(lifeProblem(tampered, W)).toMatch(/rebuilds differently/);
        const { floaterSha256: _drop, ...noHash } = h.scene!;
        expect(lifeProblem({ ...h, scene: noHash }, W)).toMatch(/does not name/);
        expect(lifeProblem({ ...h, scene: { ...h.scene!, floaterMinBlocks: 2.5 } }, W)).toMatch(/whole number/);
        // and walls without the floater (another scan): its own filter hash differs too
        const empty = walls(room(null));
        expect(lifeProblem(h, { ...empty, collisionSha256: SHA })).toMatch(/rebuilds differently/);
    });

    it('control: a replay on the unfiltered walls diverges from the flight', () => {
        const ignore = replayLives(r.lives(), { preset: () => PRESET, world: () => W.world }, end);
        expect(ignore.hash).not.toBe(liveHashes(r)[0]);
    });
});

describe('a filter change in flight: a world record and a new life (session.setDropFloaters)', () => {
    const r = flight(W, 0, START);
    let recorded: number | null = null;
    fly(r, 0, END_US, (rr, t) => {
        if (t !== 600_000) return;
        // the session's order: the world record (ch[4] = N), then a new life at the same spot on the filtered walls
        rr.world({ s: 1, t: [0, 0, 0], floaterMinBlocks: N });
        recorded = N;
        rr.newLife(lifeSim(P, worldUnder(W, IDENTITY, N)), header({ at: here(rr), collisionSha256: SHA, scene: scene(N, BASE), opts: { platform: true, keepArmed: true }, reason: 'settings' }));
    });
    const end = r.sim.tick;

    it('two lives: the first unfiltered, the second names N and the filtered walls\' hash; both replay to their hashes', () => {
        expect(recorded).toBe(N);
        const lives = r.lives();
        expect(lives).toHaveLength(2);
        expect(lives[0].header.scene!.floaterMinBlocks).toBe(0);
        expect(lives[0].header.scene!.floaterSha256).toBeUndefined();
        expect(lives[1].header.scene!.floaterMinBlocks).toBe(N);
        expect(lives[1].header.scene!.floaterSha256).toBe(filteredWalls(BASE, N).sha256);
        for (const l of lives) expect(lifeProblem(l.header, W)).toBeNull();
        const rep = replayLivesTrack(lives, W, end);
        expect(rep.hashes).toEqual(liveHashes(r));
    });

    it('a respawn later in the filtered life keeps N and the hash (the runner copies the scene)', () => {
        r.respawn(START[0], START[1], START[2], 0, { platform: true }, 'manual-start');
        const sc = r.current().header.scene!;
        expect(sc.floaterMinBlocks).toBe(N);
        expect(sc.floaterSha256).toBe(filteredWalls(BASE, N).sha256);
    });
});
