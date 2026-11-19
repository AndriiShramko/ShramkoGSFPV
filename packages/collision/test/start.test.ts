/**
 * tails4 T2: the craft's start off an overview camera. A synthetic scan: a floor slab 0.1 m thick at
 * y 0..0.1 over x,z 0..10 m, and a box 2 m high at x,z 4..6. The scan's real cases (2f1ddf5f camera
 * 62 m up above the scanned volume, d10c5638 beside it) are measured by tools/bench/src/tails4-spawn-heights.ts.
 */
import { describe, expect, it } from 'vitest';
import { START_MAX_OVER_GROUND_M, START_OVER_GROUND_M, placeStart } from '../src/start';
import { blocksFromFn, encodeCollision } from './helpers';
import type { Dims } from './helpers';

const RES = 0.1;
const dims: Dims = [100, 40, 100]; // 10 x 4 x 10 m
const col = encodeCollision(dims, blocksFromFn(dims, (ix, iy, iz) => iy === 0 || (iy < 20 && ix >= 40 && ix < 60 && iz >= 40 && iz < 60)), { res: RES });
const R = 0.2;

function groundUnder(p: readonly number[]): number | null {
    const hit = col.queryRay(p[0]!, p[1]!, p[2]!, 0, -1, 0, 1000);
    return hit ? hit.y : null;
}

describe('placeStart (an overview camera moves down its own line onto the scan)', () => {
    it('keeps a camera that stands at walking height over the floor', () => {
        const s = placeStart(col, [2, 1.6, 2], [8, 1.6, 2], R);
        expect(s.from).toBe('camera');
        expect(s.pos).toEqual([2, 1.6, 2]);
    });

    it('a camera beside the scan, nothing under it, starts over the floor on its line', () => {
        // like d10c5638: the camera is outside the walls' box, looking in and down
        const s = placeStart(col, [-20, 8, 2], [2, 3, 2], R);
        expect(s.from).toBe('line');
        const g = groundUnder(s.pos);
        expect(g).not.toBeNull();
        expect(s.pos[1] - g!).toBeGreaterThan(START_OVER_GROUND_M - 0.2);
        expect(s.pos[1] - g!).toBeLessThan(START_MAX_OVER_GROUND_M);
        expect(s.pos[0]).toBeGreaterThanOrEqual(0);
    });

    it('a camera high over the scan (ground 60 m below) starts 1.5 m over that ground', () => {
        // like 2f1ddf5f: far above the scanned volume
        const s = placeStart(col, [2, 62, 2], [3, 35, 2], R);
        expect(s.from).toBe('line');
        expect(s.pos[1]).toBeLessThan(START_MAX_OVER_GROUND_M);
        expect(s.pos[1] - groundUnder(s.pos)!).toBeCloseTo(START_OVER_GROUND_M, 0);
    });

    it('lands on top of the box, not inside it, when the line meets the box first', () => {
        const s = placeStart(col, [5, 40, -30], [5, 10, 5], R);
        expect(s.from).toBe('line');
        const push = { x: 0, y: 0, z: 0 };
        expect(col.querySphere(s.pos[0], s.pos[1], s.pos[2], R, push)).toBe(false);
        expect(s.pos[1] - groundUnder(s.pos)!).toBeLessThan(START_MAX_OVER_GROUND_M);
    });

    it('a camera whose line never meets the scan stays where it is', () => {
        const s = placeStart(col, [-100, 8, 2], [-110, 9, 2], R);
        expect(s.from).toBe('camera-no-ground');
        expect(s.pos).toEqual([-100, 8, 2]);
    });

    it('a line over a hole in the walls (a sparse scan) starts over the nearest ground around the target', () => {
        // like 2f1ddf5f: a floor with a 3 m strip missing along z 0..3, the camera's line runs over the strip only
        const holed = encodeCollision(dims, blocksFromFn(dims, (_ix, iy, iz) => iy === 0 && iz >= 30), { res: RES });
        const s = placeStart(holed, [5, 30, 1.5], [5, 20, 1.6], R);
        expect(s.from).toBe('around');
        const hit = holed.queryRay(s.pos[0], s.pos[1], s.pos[2], 0, -1, 0, 1000);
        expect(hit).not.toBeNull();
        expect(s.pos[1] - hit!.y).toBeCloseTo(START_OVER_GROUND_M, 0);
        expect(Math.abs(s.pos[0] - 5)).toBeLessThan(0.01);
        expect(s.pos[2]).toBeLessThan(4.5);
    });
});
