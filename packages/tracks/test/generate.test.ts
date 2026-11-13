// Lane tracks T1 (docs/wip/tracks-plan.md section 3, Stage 1): the generator keeps to the free space joined to the spawn,
// is deterministic, keeps out of what a hole in a wall lets in, and every course it makes is proven. Each test carries its
// negative control (a changed parameter, run inside the test).
import { describe, expect, it } from 'vitest';
import { trackDigest, validateTrack, yawQuat } from '@shramko/sonic-fpv';
import { cellCentre, checkTrack, freeSpace, generateCourse, withGateAt, yawQuatStep } from '../src';
import type { FreeSpace, Rng, TrackFile, Vec3 } from '../src';
import { HOLE_WALL_X, IDENTITY, ROOM_C, SPAWN_A, roomWithHole, threeRooms } from './worlds';

const SCENE = { id: '0000aaaa', version: 1 };
const CREATED = '2026-11-13T00:00:00.000Z';
const usableWhere = (f: FreeSpace, pred: (p: Vec3) => boolean): number => {
    let n = 0;
    for (let i = 0; i < f.room.length; i++) if (f.room[i]! >= 0 && pred(cellCentre(f, i))) n++;
    return n;
};
const inC = (p: Vec3): boolean => p[0] > ROOM_C[0][0];

describe('three rooms: A and B joined by a door, C sealed', () => {
    const walls = threeRooms();
    const free = freeSpace(walls, { spawn: SPAWN_A });
    const track = generateCourse(free, walls, { seed: 7, scene: SCENE, transform: IDENTITY, created: CREATED });

    it('uses only the space joined to the spawn: A and B, never C', () => {
        expect(usableWhere(free, inC)).toBe(0);
        expect(usableWhere(free, (p) => p[0] < 10)).toBeGreaterThan(0);
        expect(usableWhere(free, (p) => p[0] > 10.4 && p[0] < 20.4)).toBeGreaterThan(0);
        expect(free.rooms.length).toBeGreaterThan(0);
    });

    it('makes a valid generator course in A and B, proven clear by 0.5 m', () => {
        expect(validateTrack(JSON.parse(JSON.stringify(track))).ok).toBe(true);
        expect(track.gates.length).toBeGreaterThanOrEqual(3);
        expect(track.author).toEqual({ kind: 'generator', name: 'gsfpv-course' });
        expect(track.generator?.name).toBe('gsfpv-course');
        expect(track.title).toMatch(/^Course [0-9a-z-]{1,24}$/);
        expect(track.gates.every((g) => g.shape.kind === 'ring' || g.shape.kind === 'square')).toBe(true);
        for (const g of track.gates) expect(g.pos[0]).toBeLessThan(20.4);
        const r = checkTrack(track, walls, IDENTITY, 0.5);
        expect(r.issues).toEqual([]);
        expect(r.ok).toBe(true);
    });

    it('control: without the flood fill the sealed room C counts as free space', () => {
        const open = freeSpace(walls, { spawn: SPAWN_A, floodFill: false });
        expect(usableWhere(open, inC)).toBeGreaterThan(0);
    });

    it('control: the course with one gate moved into a wall fails the proof, naming that gate', () => {
        const mid = Math.floor(track.gates.length / 2);
        const bad = withGateAt(track, mid, [10.2, 2.5, 1.5], IDENTITY);
        const r = checkTrack(bad, walls, IDENTITY, 0.5, false);
        expect(r.ok).toBe(false);
        expect(r.issues.some((s) => s.includes(`gate ${track.gates[mid]!.id}`))).toBe(true);
    });
});

describe('determinism', () => {
    const walls = threeRooms();
    const free = freeSpace(walls, { spawn: SPAWN_A });
    const make = (seed: number, rng?: (seed: number) => Rng): TrackFile => generateCourse(free, walls, { seed, scene: SCENE, transform: IDENTITY, created: CREATED, rng });

    it('the same seed twice gives the same trackDigest, the next seed another', () => {
        const a = make(7), b = make(7), c = make(8);
        expect(trackDigest(a)).toBe(trackDigest(b));
        expect(trackDigest(c)).not.toBe(trackDigest(a));
    });

    it('the table yaws are yawQuat to 1e-6', () => {
        for (let k = 0; k < 16; k++) {
            const q = yawQuat(k * 22.5);
            const t = yawQuatStep(k);
            for (let j = 0; j < 4; j++) expect(Math.abs(t[j]! - q[j]!)).toBeLessThan(2e-6);
        }
    });

    it('control: a generator that reads Math.random does not repeat', () => {
        const noisy = (): Rng => ({ next: Math.random, int: (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1)) });
        expect(trackDigest(make(7, noisy))).not.toBe(trackDigest(make(7, noisy)));
    });
});

describe('a room with a 2 m hole in a wall, in an open yard', () => {
    const walls = roomWithHole();
    const spawn: Vec3 = [5, 2.5, 5];
    const outside = (p: Vec3): boolean => p[0] > HOLE_WALL_X;

    it('keeps no free space and no gate outside the hole', () => {
        const free = freeSpace(walls, { spawn, kind: 'indoor' });
        expect(usableWhere(free, outside)).toBe(0);
        expect(usableWhere(free, (p) => p[0] < 10)).toBeGreaterThan(0);
        for (const seed of [1, 2, 3]) {
            const t = generateCourse(free, walls, { seed, scene: SCENE, transform: IDENTITY, created: CREATED });
            expect(t.gates.length).toBeGreaterThan(0);
            for (const g of t.gates) expect(g.pos[0]).toBeLessThan(HOLE_WALL_X - 1);
        }
    });

    it('control: with the enclosure threshold 0 the yard behind the hole counts as free space', () => {
        const free = freeSpace(walls, { spawn, kind: 'indoor', enclosureMin: 0 });
        expect(usableWhere(free, outside)).toBeGreaterThan(0);
        expect(usableWhere(free, (p) => p[0] > HOLE_WALL_X + 1)).toBeGreaterThan(0);
    });
});
