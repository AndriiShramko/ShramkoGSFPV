// int4 car 2 S2: a click whose ray meets the scan right at the editor's eye (the overview's eye in a tree's voxels: frame.ts
// frameBox has no wall test) must not put the new gate at the eye, lifted out of the view (edit-mouse c.add, Wroclaw, two runs
// of three: hit 0.107 m, the gate at screen y 3769 behind the camera plane). The ray goes on through the scan around the eye
// until it has crossed ADD_EYE_FREE_M of free air.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ADD_EYE_CLEAR_M, ADD_EYE_FREE_M, ADD_EYE_STEP_M, addPoint, hitPastEye } from '../../../apps/fly/src/course/editor/add-place';

/** walls as solid intervals along the ray [start, end) in m; cast(from) = distance from `from` to the first solid, or null */
const along = (solids: Array<[number, number]>) => (from: number): number | null => {
    for (const [a, b] of solids) {
        if (from < b && a + 1e-9 >= from) return a - from;
        if (from >= a && from < b) return 0;
    }
    return null;
};

describe('int4: a click from an eye inside the scan', () => {
    it('a hit at the eye (0.1 m) is passed and the floor 9 m away is the place', () => {
        expect(hitPastEye(along([[0.1, 0.4], [9, 10]]))).toBeCloseTo(9, 9);
    });
    it('an eye inside a voxel (hit 0) steps out of it', () => {
        expect(hitPastEye(along([[0, 0.3], [0.45, 0.6], [5, 6]]))).toBeCloseTo(5, 9);
    });
    it('the measured canopy of the second failing ray (Wroclaw release walls): through 1.3 m of leaves to the branch past 3.3 m of air', () => {
        expect(hitPastEye(along([[0, 0.1], [0.59, 0.7], [1.02, 1.3], [4.63, 5.5], [19.52, 20.5]]))).toBeCloseTo(4.63, 9);
    });
    it('a gap shorter than ADD_EYE_FREE_M inside the canopy does not end it', () => {
        expect(hitPastEye(along([[0.2, 0.3], [0.2 + ADD_EYE_STEP_M + ADD_EYE_FREE_M - 0.1, 2], [6, 7]]))).toBeCloseTo(6, 9);
    });
    it('nothing beyond the near voxels: no hit (the gate goes ADD_AHEAD_M ahead, in view)', () => {
        expect(hitPastEye(along([[0.05, 0.2]]))).toBeNull();
    });
    it('a hit at ADD_EYE_CLEAR_M or further is kept as it was', () => {
        expect(hitPastEye(along([[ADD_EYE_CLEAR_M, 2]]))).toBe(ADD_EYE_CLEAR_M);
        expect(hitPastEye(along([[7, 8]]))).toBe(7);
        expect(hitPastEye(along([]))).toBeNull();
    });
    it('each new cast starts ADD_EYE_STEP_M past the last hit', () => {
        const froms: number[] = [];
        hitPastEye((f) => { froms.push(f); return f === 0 ? 0.1 : null; });
        expect(froms).toEqual([0, 0.1 + ADD_EYE_STEP_M]);
    });
    it('the measured case: with the near hit the gate stood behind the eye; past it, in front', () => {
        const o: [number, number, number] = [-5.0089, 10.5261, -21.8903];
        const d: [number, number, number] = [0.19221, -0.50260, 0.84288];
        const depth = (p: number[]) => (p[0]! - o[0]) * d[0] + (p[1]! - o[1]) * d[1] + (p[2]! - o[2]) * d[2];
        expect(depth(addPoint(o, d, 0.107, 1.386))).toBeLessThan(0);
        expect(depth(addPoint(o, d, hitPastEye(along([[0.107, 0.3], [9, 10]])), 1.386))).toBeGreaterThan(5);
    });
    it('course.ts asks hitPastEye for the click\'s hit, for a gate and a piece alike', () => {
        const src = readFileSync(join(__dirname, '../../../apps/fly/src/app/builtin/course.ts'), 'utf8');
        const place = src.slice(src.indexOf('const placeAt = (ray: Ray): void => {'), src.indexOf("if (what !== 'gate') return placePiece(ray, hit, what);"));
        expect(place).toMatch(/const hit = cast\s*\? hitPastEye\(\(from\) => cast\(\[ray\.o\[0\] \+ ray\.d\[0\] \* from, ray\.o\[1\] \+ ray\.d\[1\] \* from, ray\.o\[2\] \+ ray\.d\[2\] \* from\], ray\.d, ADD_RAY_M - from\)\)/);
        expect(place).not.toMatch(/camRay\(ray\.o, ray\.d, ADD_RAY_M\)/);
    });
});
