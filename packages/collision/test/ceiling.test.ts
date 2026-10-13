// The collision ceiling (v0.7 lane E, src/ceiling.ts): above a height in the scan's own coordinates
// the voxels stop being walls. A voxel above is ignored and one below collides, for every query the
// flight uses; format 1.0's flipped y; any scene scale (the ceiling stays in scan metres); the overlay's
// tint. Every check has a control that fails when the feature is broken.
import { describe, expect, it } from 'vitest';
import {
    QUAD_ABOVE_CEILING, VoxelContactWorld, blockAboveCut, ceilingCut, dropFloaters, openVoxelCollision, overlayChunk, rowAboveCut,
    sphereOverlaps, transformCollision, validCeiling, withCeiling
} from '../src/index';
import type { ContactOut, VoxelCollision } from '../src/index';
import { blocksFromFn, encodeCollision, lcg, loadFixture } from './helpers';
import type { Dims } from './helpers';

// a 2 x 4 x 2 m room at 1/8 m voxels (binary-exact faces): a floor two voxels thick, a pillar up to the
// top, and a sky floater (rows 24..27, y 2.0..2.5) away from the pillar
const RES = 0.125;
const DIMS: Dims = [16, 32, 16];
const MIN: Dims = [-1, -1, -1];
const solid = (ix: number, iy: number, iz: number): boolean =>
    iy < 2 || (ix >= 2 && ix < 4 && iz >= 2 && iz < 4) || (iy >= 24 && iy < 28 && ix >= 10 && ix < 13 && iz >= 10 && iz < 13);
const ROOM = encodeCollision(DIMS, blocksFromFn(DIMS, solid), { res: RES, min: MIN });
const FLOATER = [MIN[0] + 11.5 * RES, MIN[1] + 26 * RES, MIN[2] + 11.5 * RES]; // world centre of the floater
const PILLAR_AT = (y: number) => [MIN[0] + 3 * RES, y, MIN[2] + 3 * RES];

/** The rule written down plainly: voxel row iy is ignored when its lower face (world y) is at or above c. */
function lowerFace(col: VoxelCollision, iy: number): number {
    return col.flipXY ? -(col.gridMinY + (iy + 1) * col.voxelResolution) : col.gridMinY + iy * col.voxelResolution;
}

describe('the cut follows the rule "lower face at or above the ceiling"', () => {
    it('format 1.1 and 1.0, ceilings exactly on a face, just above one, and anywhere', () => {
        const flipped = encodeCollision(DIMS, blocksFromFn(DIMS, solid), { res: RES, min: MIN, version: '1.0' });
        expect(flipped.flipXY).toBe(true);
        const rnd = lcg(5);
        const bad: string[] = [];
        for (const col of [ROOM, flipped]) {
            const ceilings: number[] = [];
            for (let iy = -2; iy <= 34; iy++) ceilings.push(lowerFace(col, iy), lowerFace(col, iy) + 1e-6, lowerFace(col, iy) - 1e-6);
            for (let i = 0; i < 200; i++) ceilings.push(-6 + rnd() * 12);
            for (const c of ceilings) {
                const cut = ceilingCut(col, c);
                for (let iy = -3; iy <= 35; iy++) if (rowAboveCut(cut, iy) !== (lowerFace(col, iy) >= c)) bad.push(`flip=${col.flipXY} c=${c} iy=${iy}`);
            }
        }
        expect(bad).toEqual([]);
    });

    it('a block is above only when all four of its rows are; validCeiling takes the catalogue range', () => {
        const cut = ceilingCut(ROOM, MIN[1] + 25 * RES); // rows 25 and up
        expect(blockAboveCut(cut, 6)).toBe(false); // rows 24..27: cut through it
        expect(blockAboveCut(cut, 7)).toBe(true);
        expect(validCeiling(10000)).toBe(true);
        expect(validCeiling(10000.5)).toBe(false);
        expect(validCeiling(Number.NaN)).toBe(false);
        expect(() => withCeiling(ROOM, Number.POSITIVE_INFINITY)).toThrow(RangeError);
    });
});

describe('every query of the flight sees it', () => {
    const c = MIN[1] + 20 * RES; // 1.5 m: below the floater, through the pillar
    const capped = withCeiling(ROOM, c);
    const R = 0.05;

    it('a voxel above is ignored (sphere, push-out, sweep, ray, isFreeAt); one below collides; control: without the ceiling all collide', () => {
        const [fx, fy, fz] = FLOATER;
        const push = { x: 0, y: 0, z: 0 };
        // the floater: a wall without the ceiling, air with it
        expect(sphereOverlaps(ROOM, fx, fy, fz, R)).toBe(true);
        expect(sphereOverlaps(capped, fx, fy, fz, R)).toBe(false);
        expect(ROOM.querySphere(fx, fy, fz, R, push)).toBe(true);
        expect(capped.querySphere(fx, fy, fz, R, push)).toBe(false);
        expect(ROOM.isFreeAt(fx, fy, fz)).toBe(false);
        expect(capped.isFreeAt(fx, fy, fz)).toBe(true);
        // the pillar below the ceiling is a wall either way; above it, only without the ceiling
        const [px, , pz] = PILLAR_AT(0);
        expect(capped.querySphere(px, c - 0.3, pz, R, push)).toBe(true);
        expect(sphereOverlaps(capped, px, c + 0.3, pz, R)).toBe(false);
        expect(sphereOverlaps(ROOM, px, c + 0.3, pz, R)).toBe(true);
        // a sweep through the floater: hits without the ceiling, free with it
        const out: ContactOut = { sphere: -1, nx: 0, ny: 0, nz: 0 };
        const c0 = Float64Array.from([fx - 0.8, fy, fz]), c1 = Float64Array.from([fx + 0.8, fy, fz]);
        const rr = Float64Array.from([R]), pad = Float64Array.from([0]);
        expect(new VoxelContactWorld(ROOM).sweep(c0, c1, rr, pad, 1, out)).toBeGreaterThanOrEqual(0);
        expect(new VoxelContactWorld(capped).sweep(c0, c1, rr, pad, 1, out)).toBe(-1);
        // a ray down from above the room: the floater's top without the ceiling, the floor's with it
        expect(ROOM.queryRay(fx, 3.5, fz, 0, -1, 0, 10)!.y).toBeCloseTo(MIN[1] + 28 * RES, 6);
        expect(capped.queryRay(fx, 3.5, fz, 0, -1, 0, 10)!.y).toBeCloseTo(MIN[1] + 2 * RES, 6);
    });

    it('a voxel the plane cuts through still collides', () => {
        const mid = withCeiling(ROOM, MIN[1] + 26.5 * RES); // through the middle of row 26
        const [fx, , fz] = FLOATER;
        expect(mid.isVoxelSolid(11, 26, 11)).toBe(true);
        expect(mid.isVoxelSolid(11, 27, 11)).toBe(false);
        expect(mid.isVoxelSolid(11, 25, 11)).toBe(true);
        expect(mid.isFreeAt(fx, MIN[1] + 26.5 * RES, fz)).toBe(false);
    });

    it('the floater filter refuses a ceilinged input (it goes first)', () => {
        expect(() => dropFloaters(capped, 4)).toThrow(/filter before a collision ceiling/);
    });
});

describe('real scan data, format 1.0 (39e63ce9): random points', () => {
    const { meta, bin, spawn } = loadFixture();
    const base = openVoxelCollision(meta, bin);
    const c = spawn[1];
    const capped = withCeiling(base, c);

    it('above the ceiling nothing collides; well below it every answer is the scan\'s own; control: the scan has walls above it', () => {
        const rnd = lcg(11);
        const lo = [base.gridMinX, base.gridMinY, base.gridMinZ];
        const span = [base.numVoxelsX, base.numVoxelsY, base.numVoxelsZ].map((n) => n * base.voxelResolution);
        let solidAbove = 0, differBelow = 0, hitsAbove = 0, below = 0;
        for (let i = 0; i < 40000; i++) {
            // file space -> world (format 1.0 negates x and y)
            const x = -(lo[0] + rnd() * span[0]), y = -(lo[1] + rnd() * span[1]), z = lo[2] + rnd() * span[2];
            const r = 0.03;
            const own = sphereOverlaps(base, x, y, z, r);
            const cap = sphereOverlaps(capped, x, y, z, r);
            if (y - r >= c + base.voxelResolution) {
                if (own) solidAbove++;
                if (cap) hitsAbove++;
            } else if (y + r <= c - base.voxelResolution) {
                below++;
                if (own !== cap) differBelow++;
            }
        }
        expect(solidAbove).toBeGreaterThan(50);
        expect(hitsAbove).toBe(0);
        expect(below).toBeGreaterThan(1000);
        expect(differBelow).toBe(0);
    });
});

describe('scene scale: the ceiling stays in scan metres', () => {
    const c = MIN[1] + 21 * RES;
    for (const [s, t] of [[0.25, [0.3, -0.7, 2]], [4, [-1, 2.5, 0.5]], [100, [10, -40, 3]]] as [number, [number, number, number]][]) {
        it(`x${s}: the scaled walls answer at T(p) as the unscaled ones at p; control: a ceiling applied after the scale does not`, () => {
            const scaled = transformCollision(withCeiling(ROOM, c), s, t);
            const wrong = withCeiling(transformCollision(ROOM, s, t), c); // ceilingM read in flown metres
            const rnd = lcg(Math.round(s * 7));
            let differ = 0, wrongDiffer = 0;
            for (let i = 0; i < 6000; i++) {
                const p = [MIN[0] + rnd() * 2, MIN[1] + rnd() * 4, MIN[2] + rnd() * 2];
                const r = 0.02 + rnd() * 0.1;
                const q = [s * p[0] + t[0], s * p[1] + t[1], s * p[2] + t[2]];
                const want = sphereOverlaps(withCeiling(ROOM, c), p[0], p[1], p[2], r);
                if (sphereOverlaps(scaled, q[0], q[1], q[2], s * r) !== want) differ++;
                if (sphereOverlaps(wrong, q[0], q[1], q[2], s * r) !== want) wrongDiffer++;
            }
            expect(differ).toBe(0);
            expect(wrongDiffer).toBeGreaterThan(0);
        });
    }
});

describe('the voxel overlay tints the quads above the ceiling', () => {
    it('lod 0: every quad above the cut and none below; lod 1: whole blocks above only; control: no cut, no tint', () => {
        const cut = ceilingCut(ROOM, MIN[1] + 25 * RES);
        for (const lod of [0, 1] as const) {
            const ch = overlayChunk(ROOM, { x: 0, y: 0, z: 0 }, 32, lod, undefined, undefined, cut);
            let want = 0;
            for (let k = 0; k < ch.quads; k++) {
                // a quad's lowest corner row (positions are world metres: format 1.1, y up)
                let y = Infinity;
                for (let v = 0; v < 4; v++) y = Math.min(y, ch.positions[(k * 4 + v) * 3 + 1]);
                const ny = Math.abs(ch.normals[k * 12 + 1]);
                // the cell's row: a top face sits on the cell's upper face
                const top = ny > 0.5 && ch.normals[k * 12 + 1] > 0;
                const cell = lod === 0 ? 1 : 4;
                const row = Math.round((y - MIN[1]) / (RES * cell)) - (top ? 1 : 0);
                const above = lod === 0 ? rowAboveCut(cut, row) : blockAboveCut(cut, row);
                if (above) want++;
                expect(ch.floater[k] === QUAD_ABOVE_CEILING, `lod ${lod} quad ${k} row ${row}`).toBe(above);
            }
            expect(ch.aboveQuads).toBe(want);
            expect(want).toBeGreaterThan(0);
            expect(overlayChunk(ROOM, { x: 0, y: 0, z: 0 }, 32, lod).aboveQuads).toBe(0);
        }
    });
});
