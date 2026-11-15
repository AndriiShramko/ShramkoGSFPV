// Lane fix3b, stage Y2 (owner's message 52, 2026-11-15): the gates of a course over a quality map stand at the eye level of
// a person (centre 1.2 to 2.0 m above the ground under it, lower edge at least 0.3 m above it) and none stands, and no leg
// runs, where the scan is poor (the end of a street scanned only thinly).
import { describe, expect, it } from 'vitest';
import { analyticCollision } from '@gsfpv/collision';
import { freeSpace, generateCourse, qualityBounds, qualityMap } from '../src';
import type { Vec3 } from '../src';
import { IDENTITY } from './worlds';

const SCENE = { id: '0000eeee', version: 1 };
const CREATED = '2026-11-15T00:00:00.000Z';
const SPAWN: Vec3 = [6, 2.5, 0];
/** the street is scanned well up to this x; beyond it only a post every 4 m stands (a street's poor end) */
const WELL_M = 48;

/** A street 80 m long (x 0..80), 12 m wide (z -6..6), ground at y 0, facades solid to 4 m for x under WELL_M. */
function street() {
    return analyticCollision([-0.4, -1, -8], [80.4, 14, 8], 0.2, (x, y, z) => {
        if (y < 0) return true;
        if (x < 0 || x >= 80) return true;
        if (z > -6 && z < 6) return false;
        if (x < WELL_M) return y < 4 || x % 4 < 0.4;
        return x % 4 < 0.4;
    });
}

describe('fix3b Y2: gates at eye level, none in the poor end of a street', () => {
    const walls = street();
    const q = qualityMap(walls);
    const box = qualityBounds(q, SPAWN);
    const free = freeSpace(walls, { spawn: SPAWN, bounds: box ?? undefined, kind: 'outdoor' });

    it('every gate centre is 1.2 to 2.0 m above the ground, its lower edge at least 0.3 m, none beyond the well-scanned part', () => {
        expect(box).not.toBeNull();
        for (const seed of [1, 2, 3]) {
            const t = generateCourse(free, walls, { seed, scene: SCENE, transform: IDENTITY, created: CREATED, quality: q });
            expect(t.gates.length).toBeGreaterThanOrEqual(6);
            for (const g of t.gates) {
                const p = g.pos as unknown as Vec3;
                const sh = g.shape as { kind: string; side?: number; bar?: number; diameter?: number; tube?: number };
                const half = sh.kind === 'square' ? (sh.side ?? 0) / 2 + (sh.bar ?? 0) : (sh.diameter ?? 0) / 2 + (sh.tube ?? 0) / 2;
                expect(p[1]).toBeGreaterThanOrEqual(1.2);
                expect(p[1]).toBeLessThanOrEqual(2.0);
                expect(p[1] - half).toBeGreaterThanOrEqual(0.3);
                // the quality map judges a tile with its neighbours within one 4 m tile
                expect(p[0]).toBeLessThan(WELL_M + 8);
            }
        }
    });

    it('review FY-6: the eye band is used only at the plan size on a scan flown at its true size', () => {
        const eyeOf = (transform: typeof IDENTITY, scale?: number): number => {
            let hi = -1;
            generateCourse(free, walls, { seed: 1, scene: SCENE, transform, created: CREATED, quality: q, params: scale ? { scale } : undefined, onWalk: (w) => (hi = w.eyeHi) });
            return hi;
        };
        // control: the street at its true size gets the eye band
        expect(eyeOf(IDENTITY)).toBeGreaterThan(0);
        expect(eyeOf([4, 0, 0, 0] as unknown as typeof IDENTITY)).toBe(0);
        expect(eyeOf(IDENTITY, 0.5)).toBe(0);
    });
});

// Y3 pass 2: the page measures the height with one straight ray down; the generator's sphere also touched voxels beside the
// column, so a gate over a sparse layer (a grate, a rail) stood 1.6 m above that layer and 3.2 m above the ground under it.
describe('fix3b Y3: the ground under a gate is the one a straight ray finds', () => {
    /** the street of Y2, but from x 12 to 44 a pit 1.6 m deep under a grate of every other 0.2 m voxel at street level */
    function grated() {
        return analyticCollision([-0.4, -2, -8], [80.4, 14, 8], 0.2, (x, y, z) => {
            if (x < 0 || x >= 80) return true;
            const inner = z > -6 && z < 6;
            const pit = inner && x >= 12 && x < 44;
            if (pit) {
                if (y < -1.6) return true;
                if (y >= -0.2 && y < 0) return (Math.floor(x / 0.2) + Math.floor(z / 0.2)) % 2 === 0;
                return false;
            }
            if (y < 0) return true;
            if (inner) return false;
            if (x < WELL_M) return y < 4 || x % 4 < 0.4;
            return x % 4 < 0.4;
        });
    }
    const walls = grated();
    const q = qualityMap(walls);
    const box = qualityBounds(q, SPAWN);
    const free = freeSpace(walls, { spawn: SPAWN, bounds: box ?? undefined, kind: 'outdoor' });

    it('a straight ray down from every gate centre meets the ground 1.2 to 2.0 m below (one voxel of slack)', () => {
        let gates = 0;
        for (const seed of [1, 2, 3, 4]) {
            const t = generateCourse(free, walls, { seed, scene: SCENE, transform: IDENTITY, created: CREATED, quality: q });
            for (const g of t.gates) {
                const p = g.pos as unknown as Vec3;
                const hit = walls.queryRay(p[0], p[1], p[2], 0, -1, 0, 10);
                expect(hit).not.toBeNull();
                const h = p[1] - hit!.y;
                expect(h).toBeGreaterThanOrEqual(1.0);
                expect(h).toBeLessThanOrEqual(2.2);
                gates++;
            }
        }
        expect(gates).toBeGreaterThanOrEqual(12);
    });
});
