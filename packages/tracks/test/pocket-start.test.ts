// Lane course4, stage C0 (4): the Lublin scan 2f1ddf5f puts the spawn in a closed pocket of a poorly scanned part (the
// free space joined to it, 900 cells of 0.8 m, has no tile of POOR_SHARE; fix3b Y2 audit --diag). The course then lies in
// the well-scanned part nearest the spawn, and the guide leads the pilot there.
import { describe, expect, it } from 'vitest';
import { analyticCollision } from '@gsfpv/collision';
import { freeSpace, generateCourse, goodForGate, qualityBounds, qualityMap } from '../src';
import type { Vec3 } from '../src';
import { IDENTITY } from './worlds';

const SCENE = { id: '0000eeef', version: 1 };
const CREATED = '2026-11-15T00:00:00.000Z';
/** the street is scanned well up to this x (as in eye-level.test.ts) */
const WELL_M = 48;
/** the spawn inside the closed pocket beyond the street's end */
const POCKET_SPAWN: Vec3 = [109, 1.5, 0];
const STREET_SPAWN: Vec3 = [6, 2.5, 0];

/** The street of eye-level.test.ts (x 0..80) with facades 8 m thick (the pocket's thin shell is then under POOR_SHARE
 *  of the best quarter, as Lublin's pocket is), its end wall x 80..80.4, then open ground with a closed box (the pocket):
 *  shell 0.2 m thick around x 104.2..113.8, y 0..10.2, z -4.8..4.8; its roof is over the dense band, so its tiles are poor. */
function streetAndPocket() {
    return analyticCollision([-0.4, -1, -14], [118.4, 14, 14], 0.2, (x, y, z) => {
        if (y < 0) return true;
        if (x < 0 || (x >= 80 && x < 80.4)) return true;
        if (x >= 80.4) {
            const inBox = x >= 104 && x < 114 && z > -5 && z < 5 && y < 10.4;
            const inside = x >= 104.2 && x < 113.8 && z > -4.8 && z < 4.8 && y < 10.2;
            return inBox && !inside;
        }
        if (z > -6 && z < 6) return false;
        if (x < WELL_M) return y < 4 || x % 4 < 0.4;
        return x % 4 < 0.4;
    });
}

describe('course4 C0: a spawn in a closed pocket of a poor scan', () => {
    const walls = streetAndPocket();
    const q = qualityMap(walls);
    const good = goodForGate(q);

    it('the course lies in the well-scanned street, not in the pocket', () => {
        // the world is what the test means: the pocket is poor, the street is good
        expect(good(POCKET_SPAWN)).toBe(false);
        expect(good([20, 1.6, -4])).toBe(true);
        const box = qualityBounds(q, POCKET_SPAWN);
        expect(box).not.toBeNull();
        const free = freeSpace(walls, { spawn: POCKET_SPAWN, bounds: box ?? undefined, kind: 'outdoor', goodAt: good });
        for (const seed of [1, 2]) {
            const t = generateCourse(free, walls, { seed, scene: SCENE, transform: IDENTITY, created: CREATED, quality: q, spawn: POCKET_SPAWN });
            expect(t.gates.length).toBeGreaterThanOrEqual(6);
            for (const g of t.gates) expect((g.pos as unknown as Vec3)[0]).toBeLessThan(WELL_M + 8);
        }
    });

    it('a spawn in the good street keeps the free space it had (goodAt changes nothing there)', () => {
        const box = qualityBounds(q, STREET_SPAWN) ?? undefined;
        const a = freeSpace(walls, { spawn: STREET_SPAWN, bounds: box, kind: 'outdoor' });
        const b = freeSpace(walls, { spawn: STREET_SPAWN, bounds: box, kind: 'outdoor', goodAt: good });
        expect(b.stats).toEqual(a.stats);
        expect(b.startCell).toBe(a.startCell);
        expect(b.digest).toBe(a.digest);
    });
});
