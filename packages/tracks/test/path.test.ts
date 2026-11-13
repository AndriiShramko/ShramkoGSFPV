// Lane tracks T1: the beacon's path along a generated course keeps the sound package's WorldCheckpoint rules (points at
// most 6 m apart, one 1.5 m before each gate, segments free). Control: a path with one 8 m gap is refused.
import { describe, expect, it } from 'vitest';
import { coursePath, freeSpace, generateCourse, pathProblems, sweeperOf } from '../src';
import type { Vec3, WorldCheckpoint } from '../src';
import { IDENTITY, SPAWN_A, threeRooms } from './worlds';

describe('coursePath', () => {
    const walls = threeRooms();
    const free = freeSpace(walls, { spawn: SPAWN_A });
    const track = generateCourse(free, walls, { seed: 11, scene: { id: '0000aaaa', version: 1 }, transform: IDENTITY, created: '2026-11-13T00:00:00.000Z' });
    const path = coursePath(track, IDENTITY);
    const sweeper = sweeperOf(walls);
    const dist = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

    it('neighbours at most 6 m apart, a point 1.5 m before each gate, a stage on each gate, segments free', () => {
        expect(track.gates.length).toBeGreaterThanOrEqual(3);
        expect(pathProblems(path, track, IDENTITY, sweeper, 0.3)).toEqual([]);
        for (let i = 0; i + 1 < path.length; i++) expect(dist(path[i]!.pos, path[i + 1]!.pos)).toBeLessThanOrEqual(6 + 1e-6);
        const stages = path.flatMap((c, i) => (c.stage ? [i] : []));
        expect(stages.length).toBe(track.gates.length);
        for (const i of stages) expect(Math.abs(dist(path[i - 1]!.pos, path[i]!.pos) - 1.5)).toBeLessThan(0.01);
        expect(path.every((c) => c.dir[1] === 0)).toBe(true);
    });

    it('control: a path with one 8 m gap is refused', () => {
        const p0 = path[0]!;
        const far: WorldCheckpoint = { pos: [p0.pos[0] + 8 * p0.dir[0], p0.pos[1], p0.pos[2] + 8 * p0.dir[2]], dir: p0.dir };
        const gappy = [p0, far, ...path.slice(1)];
        expect(pathProblems(gappy, track, IDENTITY).some((s) => s.includes('apart'))).toBe(true);
    });

    it('a closed course ends back at the start; an open one (laps 1) ends on its last gate', () => {
        const last = track.gates[track.gates.length - 1]!.pos;
        expect(track.laps).toBeGreaterThan(1);
        expect(dist(path[path.length - 1]!.pos, path[0]!.pos)).toBeLessThan(1e-9);
        const open = coursePath({ ...track, laps: 1 }, IDENTITY);
        expect(dist(open[open.length - 1]!.pos, last)).toBeLessThan(1e-9);
        expect(open[open.length - 1]!.stage).toBe(track.gates.length);
    });
});
