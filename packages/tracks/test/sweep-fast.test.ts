// Lane course3 F2-fast-course: the generator's sweep (check.ts sweepFree) answers as the flight's sweepOne does and does
// not read the voxels of a cover around the whole leg (on 5 cm walls a 25 m leg's cover is about 6.5e7 voxels). The cost is
// counted in voxel reads, not timed.
import { describe, expect, it } from 'vitest';
import { VoxelContactWorld, analyticCollision, sphereOverlaps } from '@gsfpv/collision';
import type { VoxelCollision } from '@gsfpv/collision';
import { createRng, occupancyOf, overlapsFast, sweeperOf } from '../src';
import type { Vec3 } from '../src';
import { threeRooms } from './worlds';

/** a street 60 m long, 12 m wide, on 5 cm voxels, walls to 8 m, a post in the middle of the street at x 30 */
function street5cm(): VoxelCollision {
    return analyticCollision([-0.2, -0.5, -7], [60.2, 8, 7], 0.05, (x, y, z) => {
        if (y < 0) return true;
        if (x < 0 || x >= 60) return true;
        if (z <= -6 || z >= 6) return true;
        return x > 29.6 && x < 30.4 && z > -0.4 && z < 0.4;
    });
}

function counting(col: VoxelCollision): { col: VoxelCollision; reads: () => number } {
    let n = 0;
    const c = Object.create(col) as VoxelCollision;
    const inner = col.isVoxelSolid.bind(col);
    c.isVoxelSolid = (x: number, y: number, z: number): boolean => {
        n++;
        return inner(x, y, z);
    };
    return { col: c, reads: () => n };
}

describe('the generator sweep', () => {
    it('gives the answer of sweepOne on random segments (three rooms and a street)', () => {
        for (const col of [threeRooms(), street5cm()]) {
            const w = new VoxelContactWorld(col);
            const s = sweeperOf(col);
            const rng = createRng(11);
            const lo = [col.gridMinX, col.gridMinY, col.gridMinZ];
            const span = [col.numVoxelsX, col.numVoxelsY, col.numVoxelsZ].map((n) => n * col.voxelResolution);
            const pt = (): Vec3 => [0, 1, 2].map((i) => lo[i]! + (rng.int(0, 1000) / 1000) * span[i]!) as unknown as Vec3;
            let free = 0, blocked = 0;
            for (let i = 0; i < 300; i++) {
                const a = pt();
                const b = i % 3 === 0 ? a : pt();
                const r = [0.3, 0.5, 0.8][i % 3]!;
                const old = w.sweepOne(a[0], a[1], a[2], b[0], b[1], b[2], r) < 0;
                expect(s.free(a, b, r)).toBe(old);
                if (old) free++;
                else blocked++;
            }
            expect(free).toBeGreaterThan(0);
            expect(blocked).toBeGreaterThan(0);
        }
    });

    it('overlapsFast gives the answer of sphereOverlaps (random spheres, radii 0 to 3 m, in and around the grid)', () => {
        for (const col of [threeRooms(), street5cm()]) {
            const occ = occupancyOf(col);
            const rng = createRng(5);
            const lo = [col.gridMinX, col.gridMinY, col.gridMinZ];
            const span = [col.numVoxelsX, col.numVoxelsY, col.numVoxelsZ].map((n) => n * col.voxelResolution);
            let hits = 0;
            for (let i = 0; i < 3000; i++) {
                const p = [0, 1, 2].map((k) => lo[k]! - 1 + (rng.int(0, 10000) / 10000) * (span[k]! + 2));
                const r = [0, 0.00005, 0.05, 0.3, 0.625, 1.2, 3][i % 7]!;
                const want = sphereOverlaps(col, p[0]!, p[1]!, p[2]!, r);
                expect(overlapsFast(col, occ, p[0]!, p[1]!, p[2]!, r)).toBe(want);
                if (want) hits++;
            }
            expect(hits).toBeGreaterThan(100);
        }
    });

    it('a free 25 m leg along a 5 cm street reads under 20 000 voxels', () => {
        const { col, reads } = counting(street5cm());
        const s = sweeperOf(col);
        const a: Vec3 = [2, 2.5, 3], b: Vec3 = [27, 2.5, 3];
        const r0 = reads();
        expect(s.free(a, b, 0.5)).toBe(true);
        expect(reads() - r0).toBeLessThan(20_000);
        // a blocked leg (through the post) is still found
        expect(s.free([20, 2.5, 0], [40, 2.5, 0], 0.5)).toBe(false);
    });
});
