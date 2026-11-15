// Lane fix3b, review FY-5: the finished course's legs are read for a poor scan, the ring's closing legs too (last gate ->
// start and last gate -> gate 1), and the course keeps at least gatesMin gates. The world is a plaza scanned only along
// its facades: its middle is poor, so a ring that closes across the plaza would show the pilot the poor scan.
import { describe, expect, it } from 'vitest';
import { analyticCollision } from '@gsfpv/collision';
import { COURSE_DEFAULTS, POOR_SHARE, freeSpace, generateCourse, qualityBounds, qualityMap, qualityShare } from '../src';
import type { Vec3 } from '../src';
import { IDENTITY } from './worlds';

const SCENE = { id: '0000ffff', version: 1 };
const CREATED = '2026-11-15T00:00:00.000Z';
/** the plaza is S x S m; the facades are a band of FACADE_M along its edges, solid to 4 m */
const S = 48;
const FACADE_M = 2;
const SPAWN: Vec3 = [6, 2.5, 6];

function plaza() {
    return analyticCollision([-0.4, -1, -0.4], [S + 0.4, 14, S + 0.4], 0.2, (x, y, z) => {
        if (y < 0) return true;
        if (x < 0 || x >= S || z < 0 || z >= S) return true;
        const edge = x < FACADE_M || x >= S - FACADE_M || z < FACADE_M || z >= S - FACADE_M;
        return edge && y < 4;
    });
}

/** the lowest quality share read along a leg at the generator's points (every 1 m, LEG_STEP_M; a leg may clip a poor
 *  tile's corner between two points: seed 3 by 0.2 m) */
function legShare(q: ReturnType<typeof qualityMap>, a: Vec3, b: Vec3): number {
    const dx = b[0] - a[0], dz = b[2] - a[2];
    const n = Math.max(1, Math.ceil(Math.sqrt(dx * dx + dz * dz) / 1));
    let lo = Infinity;
    for (let j = 0; j <= n; j++) lo = Math.min(lo, qualityShare(q, [a[0] + (dx * j) / n, 0, a[2] + (dz * j) / n]));
    return lo;
}

describe('review FY-5: no leg of a generated course, closing legs included, crosses a poor scan', () => {
    const walls = plaza();
    const q = qualityMap(walls);
    const box = qualityBounds(q, SPAWN);
    const free = freeSpace(walls, { spawn: SPAWN, bounds: box ?? undefined, kind: 'outdoor' });

    it('the world: the plaza middle is poor, the spawn is not', () => {
        expect(qualityShare(q, [S / 2, 0, S / 2])).toBeLessThan(POOR_SHARE);
        expect(qualityShare(q, SPAWN)).toBeGreaterThanOrEqual(POOR_SHARE);
    });

    it('every leg of every course reads at least POOR_SHARE, and each course keeps at least gatesMin gates', () => {
        let closed = 0;
        for (const seed of [1, 2, 3, 4, 5]) {
            const t = generateCourse(free, walls, { seed, scene: SCENE, transform: IDENTITY, created: CREATED, quality: q });
            expect(t.gates.length).toBeGreaterThanOrEqual(COURSE_DEFAULTS.gatesMin);
            expect(t.start).not.toBeNull();
            const pts: Vec3[] = [t.start!.pos as unknown as Vec3, ...t.gates.map((g) => g.pos as unknown as Vec3)];
            const legs: [Vec3, Vec3][] = [];
            for (let i = 0; i + 1 < pts.length; i++) legs.push([pts[i]!, pts[i + 1]!]);
            if (t.laps > 1) {
                closed++;
                legs.push([pts[pts.length - 1]!, pts[0]!], [pts[pts.length - 1]!, pts[1]!]);
            }
            for (const [a, b] of legs) expect(legShare(q, a, b)).toBeGreaterThanOrEqual(POOR_SHARE * 0.999);
        }
        // the closing legs were judged on at least one course
        expect(closed).toBeGreaterThan(0);
    });
});
