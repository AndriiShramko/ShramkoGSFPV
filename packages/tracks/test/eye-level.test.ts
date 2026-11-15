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
});
