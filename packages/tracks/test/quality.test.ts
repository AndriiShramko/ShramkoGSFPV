// Lane course3, stage G2: where the scan is good. A street scan is dense up to the height of a walker's eyes and thin
// above; the quality map finds that band from the voxels' height histogram (not a constant), and a course laid over it
// keeps every gate inside the band and goes along the whole street instead of staying near the start. Each test carries
// its negative control (a changed world or no quality map, run inside the test).
import { describe, expect, it } from 'vitest';
import { analyticCollision } from '@gsfpv/collision';
import { validateTrack } from '@shramko/sonic-fpv';
import { denseBand, freeSpace, generateCourse, inDenseBand, qualityBounds, qualityMap } from '../src';
import type { Vec3 } from '../src';
import { IDENTITY } from './worlds';

const SCENE = { id: '0000bbbb', version: 1 };
const CREATED = '2026-11-14T00:00:00.000Z';
const STREET_M = 80;
/** G4: a long street (Wroclaw's streets are scanned for 200 m) */
const LONG_M = 240;
const SPAWN: Vec3 = [6, 2.5, 0];

/**
 * A street 80 m long (x 0..80) and 12 m wide (z -6..6) between facades 2 m thick, closed at both ends, open to the sky,
 * ground at y 0. The facades are scanned solid up to `denseTo` m; above it to 14 m only a thin post every 4 m stands
 * (what a scan filmed from the street keeps of the upper floors).
 */
function street(denseTo: number, lengthM: number = STREET_M) {
    return analyticCollision([-0.4, -1, -8], [lengthM + 0.4, 14, 8], 0.2, (x, y, z) => {
        if (y < 0) return true;
        if (x < 0 || x >= lengthM) return true;
        if (z > -6 && z < 6) return false;
        return y < denseTo || x % 4 < 0.4;
    });
}

describe('quality map: the dense band from the height histogram', () => {
    it('denseBand joins the bins at the share of the densest one', () => {
        // bins of 0.5 m from 0.4 m: dense 1.4..3.4 m, thin above
        const hist = [9, 9, 10, 10, 10, 9, 2, 2, 1, 1];
        expect(denseBand(hist, 0.5, 0.4, 1.4, 0.8)).toEqual([1.4, 3.4]);
        // the bin across minM is left out: a spill just over the ground does not become the band
        expect(denseBand([20, 9, 10, 10, 10, 9, 2, 2], 0.8, 0.8, 1.4, 0.8)[1]).toBeCloseTo(5.6, 6);
        // control: a flat histogram makes the band reach the top
        expect(denseBand([5, 5, 5, 5, 5, 5, 5, 5, 5, 5], 0.5, 0.4, 1.4, 0.8)[1]).toBeCloseTo(5.4, 6);
    });

    it('a street dense to 4 m gets a band ending near 4 m; a street dense to 14 m does not', () => {
        const q = qualityMap(street(4));
        expect(q.band[0]).toBeGreaterThanOrEqual(1.4);
        expect(q.band[1]).toBeGreaterThanOrEqual(3.4);
        expect(q.band[1]).toBeLessThanOrEqual(4.8);
        expect(q.goodTiles).toBeGreaterThan(0);
        expect(inDenseBand(q, [40, 2.5, 0])).toBe(true);
        expect(inDenseBand(q, [40, 9, 0])).toBe(false);
        // control: the same street scanned dense to the top
        const full = qualityMap(street(14));
        expect(full.band[1]).toBeGreaterThan(8);
    });
});

describe('a course over the quality map', () => {
    const walls = street(4);
    const q = qualityMap(walls);
    const box = qualityBounds(q, SPAWN);
    // a street open to the sky in a box mostly outside the grid: the border share would call it indoor
    const free = freeSpace(walls, { spawn: SPAWN, bounds: box ?? undefined, kind: 'outdoor' });
    const reach = (gates: readonly { pos: readonly number[] }[]): number => Math.max(0, ...gates.map((g) => Math.abs(g.pos[0]! - SPAWN[0])));

    it('keeps every gate in the dense band and goes along the street', () => {
        expect(box).not.toBeNull();
        for (const seed of [1, 2]) {
            const t = generateCourse(free, walls, { seed, scene: SCENE, transform: IDENTITY, created: CREATED, quality: q });
            expect(t.gates.length).toBeGreaterThanOrEqual(8);
            for (const g of t.gates) expect(inDenseBand(q, g.pos as Vec3)).toBe(true);
            expect(reach(t.gates)).toBeGreaterThanOrEqual(STREET_M / 2);
            expect(validateTrack(JSON.parse(JSON.stringify(t))).ok).toBe(true);
        }
        // control: without the map the walk keeps within two legs (30 m) of the start
        const old = generateCourse(free, walls, { seed: 1, scene: SCENE, transform: IDENTITY, created: CREATED });
        expect(reach(old.gates)).toBeLessThan(STREET_M / 2);
    });

    it('goes far along a long street (G4: "the street is long and scanned further, but there are no obstacles there")', () => {
        const long = street(4, LONG_M);
        const lq = qualityMap(long);
        const lbox = qualityBounds(lq, SPAWN);
        expect(lbox).not.toBeNull();
        const lfree = freeSpace(long, { spawn: SPAWN, bounds: lbox ?? undefined, kind: 'outdoor' });
        for (const seed of [1, 2]) {
            const t = generateCourse(lfree, long, { seed, scene: SCENE, transform: IDENTITY, created: CREATED, quality: lq });
            expect(t.gates.length).toBeGreaterThanOrEqual(8);
            for (const g of t.gates) expect(inDenseBand(lq, g.pos as Vec3)).toBe(true);
            // the box reaches 120 m from the spawn; the 15 m legs of plan 2.2 reached 75 m on seed 1 (tmp run of G4,
            // farM 78.4), the 25 m legs 98 and 111 m
            expect(reach(t.gates)).toBeGreaterThanOrEqual(90);
            expect(validateTrack(JSON.parse(JSON.stringify(t))).ok).toBe(true);
        }
    });
});
