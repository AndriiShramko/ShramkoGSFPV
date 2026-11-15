// Lane course4 C2 (S7): a macro scan the pilot enlarged (Forest Floor ab5efa0e at Scene size x15 and more) had no usable
// free-space cell: the outdoor rules (a wall straight down within 6 m, the nearest wall within 8 m) and the ray, box and
// room sizes were fixed flown metres while the walls' cell grows as 0.2 x s m (gate-place-audit --scale 20: usable 0).
// FreeSpaceOptions.unitM (the scan's one measure, sceneUnitM: the pilot's Scene size, at least 1) multiplies them.
// Negative control: freespace.ts of the head before course4 C2 pass 2 (unitM ignored: usable 0 at x20).
import { describe, expect, it } from 'vitest';
import { analyticCollision } from '@gsfpv/collision';
import { freeSpace } from '../src';

/** A 6 x 5 x 6 scan of a forest floor: the ground and three stems, flown at Scene size s (walls' voxel 0.05 x s). */
function floorScan(s: number): ReturnType<typeof analyticCollision> {
    const stem = (x: number, z: number, cx: number, cz: number): boolean => Math.abs(x - cx) < 0.2 && Math.abs(z - cz) < 0.2;
    return analyticCollision([-3 * s, -1 * s, -3 * s], [3 * s, 4 * s, 3 * s], 0.05 * s, (x, y, z) => {
        const u = x / s, v = y / s, w = z / s;
        return v < 0 || stem(u, w, -1.5, -1) || stem(u, w, 1, 1.5) || stem(u, w, 1.2, -1.4);
    });
}

describe('free space of a scan flown enlarged', () => {
    it('keeps usable cells at Scene size x20 when the rules follow the scan measure', () => {
        const s = 20;
        const walls = floorScan(s);
        const unitM = s;
        const f = freeSpace(walls, { spawn: [0, 1.5 * s, 0], unitM });
        expect(f.outdoor).toBe(true);
        expect(f.stats.usable).toBeGreaterThan(1000);
        expect(f.volumeM3).toBeGreaterThan(1000 * f.cellM ** 3);
    });

    it('changes nothing for a scan at its true size (unitM 1 is the default)', () => {
        const walls = floorScan(1);
        const a = freeSpace(walls, { spawn: [0, 1.5, 0] });
        const b = freeSpace(walls, { spawn: [0, 1.5, 0], unitM: 1 });
        expect(a.stats.usable).toBeGreaterThan(1000);
        expect(b.stats).toEqual(a.stats);
        expect(b.digest).toBe(a.digest);
    });
});
