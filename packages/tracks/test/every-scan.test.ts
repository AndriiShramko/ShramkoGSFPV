// Lane course4 C3 (owner's message 57: a room gets gates for a whoop). fitCourse steps down the ladder of gate sizes
// (COURSE_SCALES) and reads the free space again at each smaller step's margin (refree). A low room whose free space is
// empty at the plan's margin (0.5 m) gets a course of small gates; a scan where the plan's course fits keeps it exactly.
// Negative control: fit.ts of the branch before C3 (no refree, ladder 1, 0.5, 0.3) gives no course in the low room.
import { describe, expect, it } from 'vitest';
import { analyticCollision } from '@gsfpv/collision';
import { trackDigest } from '@shramko/sonic-fpv';
import { COURSE_SCALES, MARGIN_M, RING_MIN_DRONE_DIAMETERS, SMALLEST_DRONE_RADIUS_M, SQUARE_SIDE_M, checkTrack, fitCourse, freeAtMargin, flyPath, freeSpace } from '../src';
import type { TrackFile, Vec3 } from '../src';
import { IDENTITY, SPAWN_A, threeRooms } from './worlds';

const SCENE = { id: '0000aaaa', version: 1 };
const CREATED = '2026-11-15T00:00:00.000Z';

const opening = (t: TrackFile, i: number): number => {
    const sh = t.gates[i]!.shape as { kind: string; side?: number; diameter?: number };
    return (sh.kind === 'square' ? sh.side! : sh.diameter!) * t.transform[0];
};

/** A closed low room 5 x 1.2 x 5 m inside, walls 0.3 m: its free cells at the plan margin are one layer, no room. */
function lowRoom(): ReturnType<typeof analyticCollision> {
    const inside = (x: number, y: number, z: number): boolean => x >= 0 && x < 5 && y >= 0 && y < 1.2 && z >= 0 && z < 5;
    return analyticCollision([-0.3, -0.3, -0.3], [5.3, 1.5, 5.3], 0.05, (x, y, z) => !inside(x, y, z));
}

describe('course4 C3: the ladder of gate sizes', () => {
    it('the ladder steps 1.5, 1.0, 0.6, 0.45 m square openings and ends where the smallest drone still passes a ring', () => {
        expect(COURSE_SCALES.map((k) => Math.round(SQUARE_SIDE_M * k * 100) / 100)).toEqual([1.5, 1, 0.6, 0.45]);
        expect(1.2 * COURSE_SCALES[COURSE_SCALES.length - 1]!).toBeGreaterThanOrEqual(RING_MIN_DRONE_DIAMETERS * 2 * SMALLEST_DRONE_RADIUS_M);
    });

    it('a low room (1.2 m high) has no usable cell at the plan margin, and gets a course of small gates', () => {
        const walls = lowRoom();
        const spawn: Vec3 = [2.5, 0.6, 2.5];
        const free = freeSpace(walls, { spawn });
        expect(free.stats.usable).toBe(0);
        const refree = (marginM: number) => freeAtMargin(walls, { spawn }, marginM);
        for (const seed of [1, 2, 3]) {
            const r = fitCourse(free, walls, { seed, scene: SCENE, transform: IDENTITY, created: CREATED }, 4, undefined, null, refree);
            expect(r.track, `seed ${seed}`).not.toBeNull();
            const t = r.track!;
            expect(t.gates.length).toBeGreaterThanOrEqual(2);
            expect(r.scale).toBeLessThan(2 / 3);
            for (let i = 0; i < t.gates.length; i++) {
                expect(opening(t, i)).toBeLessThan(0.8);
                expect(opening(t, i)).toBeGreaterThanOrEqual(RING_MIN_DRONE_DIAMETERS * 2 * SMALLEST_DRONE_RADIUS_M - 1e-9);
            }
            const margin = t.generator!.params.marginM as number;
            expect(margin).toBeLessThan(MARGIN_M);
            expect(checkTrack(t, walls, IDENTITY, margin, false).ok).toBe(true);
            expect(flyPath(t, 3, IDENTITY).done).toBe(true);
        }
    }, 60000);

    it('where the plan course fits, refree changes nothing (the same course, the same digest)', () => {
        const walls = threeRooms();
        const free = freeSpace(walls, { spawn: SPAWN_A });
        const refree = (marginM: number) => freeAtMargin(walls, { spawn: SPAWN_A }, marginM);
        for (const seed of [1, 2]) {
            const a = fitCourse(free, walls, { seed, scene: SCENE, transform: IDENTITY, created: CREATED });
            const b = fitCourse(free, walls, { seed, scene: SCENE, transform: IDENTITY, created: CREATED }, 4, undefined, null, refree);
            expect(b.scale).toBe(1);
            expect(trackDigest(b.track!)).toBe(trackDigest(a.track!));
        }
    }, 60000);
});
