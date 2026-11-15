// Lane course5, stage Z2. A3 (review CU-7): the ladder's smallest gate lets the craft
// that is flown pass (RING_MIN_DRONE_DIAMETERS of its diameters), not only the smallest craft of the catalogue.
// Negative control: fit.ts of 5e574e35 (no craft in the ladder): the opening assertion fails (0.36 against 0.6134).
import { describe, expect, it } from 'vitest';
import { analyticCollision } from '@gsfpv/collision';
import { COURSE_SCALES, RING_MIN_DRONE_DIAMETERS, fitCourse, freeAtMargin, freeSpace, generateCourse } from '../src';
import type { TrackFile, Vec3 } from '../src';
import { IDENTITY } from './worlds';

const SCENE = { id: '0000ffff', version: 1 };
const CREATED = '2026-11-15T00:00:00.000Z';

/** the opening's radius of a gate, flown m (identity transform) */
const radiusOf = (t: TrackFile, i: number): number => {
    const sh = t.gates[i]!.shape as { kind: string; side?: number; diameter?: number };
    return (sh.kind === 'square' ? sh.side! : sh.diameter!) / 2;
};

describe('course5 Z2 A3: the ladder sized by the flown craft', () => {
    /** A closed room 6 x 3 x 6 m inside: its course comes from a step under the plan's size. */
    const walls = analyticCollision([-0.3, -0.3, -0.3], [6.3, 3.3, 6.3], 0.1, (x, y, z) => !(x >= 0 && x < 6 && y >= 0 && y < 3 && z >= 0 && z < 6));
    const spawn: Vec3 = [3, 1.5, 3];
    const free = freeSpace(walls, { spawn });
    const refree = (m: number) => freeAtMargin(walls, { spawn }, m);

    it('a pavo20pro-3s (boundRadius 0.0768 m) gets no gate narrower than 4 of its diameters; the smallest craft keeps the ladder', () => {
        const craft = 0.0768;
        const got = fitCourse(free, walls, { seed: 1, scene: SCENE, transform: IDENTITY, created: CREATED, spawn, craftRadiusM: craft }, 4, generateCourse, null, refree);
        expect(got.track).not.toBeNull();
        const t = got.track!;
        for (let i = 0; i < t.gates.length; i++) expect(2 * radiusOf(t, i)).toBeGreaterThanOrEqual(RING_MIN_DRONE_DIAMETERS * 2 * craft - 1e-3);
        const small = fitCourse(free, walls, { seed: 1, scene: SCENE, transform: IDENTITY, created: CREATED, spawn }, 4, generateCourse, null, refree);
        expect(small.track).not.toBeNull();
        expect(COURSE_SCALES).toContain(small.scale);
    });
});
