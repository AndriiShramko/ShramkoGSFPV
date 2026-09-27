// E.7 collision part: a scaled scene is the same world seen through T(w) = s*w + t.
// research-b 2.1's method, reproduced: 20 000 random points (isFreeAt, querySphere hit/miss with
// the radius times s, queryRay 10 m times s) and 3 000 swept segments, formats 1.0 and 1.1.
import { describe, expect, it } from 'vitest';
import {
    openVoxelCollision, transformCollision, transformedMetadata, collisionWithMetadata, fileSpaceOffset,
    applyTransform, rescaleAround, relativeTransform, IDENTITY_TRANSFORM, VoxelContactWorld, VoxelCollision,
    syntheticWall, findSphereSpawn, sphereOverlaps
} from '../src/index';
import type { SceneTransform } from '../src/index';
import { lcg, loadFixture } from './helpers';

const { meta, bin, spawn } = loadFixture();
const v10 = openVoxelCollision(meta, bin);
const v11 = openVoxelCollision({ ...meta, version: '1.1' }, bin);

interface Equivalence {
    isFreeAt: { same: number; diff: number };
    querySphere: { same: number; diff: number; hits: number; pushDiffer: number };
    queryRay: { same: number; diff: number; maxHitErrM: number; hits: number };
    sweepOne: { same: number; diff: number; hits: number };
}

/** rb-scale.ts: every query in `b` at T(w) must answer as `a` at w. */
function equivalence(a: VoxelCollision, b: VoxelCollision, tr: SceneTransform, points = 20000, sweeps = 3000): Equivalence {
    const { s } = tr;
    const T = (w: number[]): number[] => applyTransform(tr, w);
    const rnd = lcg(7);
    const g0 = [a.gridMinX, a.gridMinY, a.gridMinZ];
    const gs = [a.numVoxelsX, a.numVoxelsY, a.numVoxelsZ].map((n) => n * a.voxelResolution);
    const e: Equivalence = {
        isFreeAt: { same: 0, diff: 0 },
        querySphere: { same: 0, diff: 0, hits: 0, pushDiffer: 0 },
        queryRay: { same: 0, diff: 0, maxHitErrM: 0, hits: 0 },
        sweepOne: { same: 0, diff: 0, hits: 0 }
    };
    const wa = new VoxelContactWorld(a), wb = new VoxelContactWorld(b);
    const pa = { x: 0, y: 0, z: 0 }, pb = { x: 0, y: 0, z: 0 };
    for (let k = 0; k < points; k++) {
        // points spread over the grid box (world space; legacy files store x and y negated)
        let w = [0, 1, 2].map((i) => g0[i] + rnd() * gs[i]);
        if (a.flipXY) w = [-w[0], -w[1], w[2]];
        const q = T(w);
        if (a.isFreeAt(w[0], w[1], w[2]) === b.isFreeAt(q[0], q[1], q[2])) e.isFreeAt.same++; else e.isFreeAt.diff++;
        const r = 0.03 + rnd() * 0.2;
        const ha = a.querySphere(w[0], w[1], w[2], r, pa);
        const hb = b.querySphere(q[0], q[1], q[2], s * r, pb);
        if (ha === hb) {
            e.querySphere.same++;
            if (ha) {
                e.querySphere.hits++;
                // the push-out vector is not part of the equivalence (absolute-metre epsilons, research-b 2.1)
                if (Math.max(Math.abs(pb.x - s * pa.x), Math.abs(pb.y - s * pa.y), Math.abs(pb.z - s * pa.z)) > 1e-6) e.querySphere.pushDiffer++;
            }
        } else e.querySphere.diff++;
        const d = [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5];
        const dl = Math.hypot(d[0], d[1], d[2]);
        const ra = a.queryRay(w[0], w[1], w[2], d[0] / dl, d[1] / dl, d[2] / dl, 10);
        const rb = b.queryRay(q[0], q[1], q[2], d[0] / dl, d[1] / dl, d[2] / dl, 10 * s);
        if (!!ra === !!rb) {
            e.queryRay.same++;
            if (ra && rb) {
                e.queryRay.hits++;
                const m = T([ra.x, ra.y, ra.z]);
                e.queryRay.maxHitErrM = Math.max(e.queryRay.maxHitErrM, Math.hypot(m[0] - rb.x, m[1] - rb.y, m[2] - rb.z));
            }
        } else e.queryRay.diff++;
        if (k < sweeps) {
            const end = [w[0] + (rnd() - 0.5), w[1] + (rnd() - 0.5), w[2] + (rnd() - 0.5)];
            const qe = T(end);
            const ta = wa.sweepOne(w[0], w[1], w[2], end[0], end[1], end[2], r);
            const tb = wb.sweepOne(q[0], q[1], q[2], qe[0], qe[1], qe[2], s * r);
            // contact time resolution is LEAF metres along the path in both worlds
            const tol = 1e-3 + 0.00025 / Math.max(1e-6, Math.hypot(end[0] - w[0], end[1] - w[1], end[2] - w[2]));
            if ((ta < 0) === (tb < 0) && Math.abs(ta - tb) < tol) {
                e.sweepOne.same++;
                if (ta >= 0) e.sweepOne.hits++;
            } else e.sweepOne.diff++;
        }
    }
    return e;
}

function expectEquivalent(e: Equivalence): void {
    expect(e.isFreeAt).toMatchObject({ same: 20000, diff: 0 });
    expect(e.querySphere).toMatchObject({ same: 20000, diff: 0 });
    expect(e.queryRay).toMatchObject({ same: 20000, diff: 0 });
    expect(e.queryRay.maxHitErrM).toBeLessThan(1e-12);
    expect(e.sweepOne).toMatchObject({ same: 3000, diff: 0 });
    // the samples really touch the scan, so the equality is not empty air against empty air
    expect(e.querySphere.hits).toBeGreaterThan(500);
    expect(e.queryRay.hits).toBeGreaterThan(2000);
    expect(e.sweepOne.hits).toBeGreaterThan(100);
}

const around = (s: number, p: number[]): SceneTransform => rescaleAround(IDENTITY_TRANSFORM, s, p);

// research-b 2.1's four runs: 39e63ce9 as stored (1.0, flipped) around the spawn, and the same
// octree read as format 1.1 (no flip) around two other pivots
const CASES: { name: string; col: VoxelCollision; tr: SceneTransform }[] = [
    { name: '1.0 flipped, s = 1.5 around the spawn', col: v10, tr: around(1.5, spawn) },
    { name: '1.0 flipped, s = 0.5 around the spawn', col: v10, tr: around(0.5, spawn) },
    { name: '1.1, s = 0.7 around (0, 2, 0)', col: v11, tr: around(0.7, [0, 2, 0]) },
    { name: '1.1, s = 2 around (3.3, 1.1, -4.2)', col: v11, tr: around(2, [3.3, 1.1, -4.2]) }
];

describe('transformCollision equivalence (fixture 39e63ce9, research-b 2.1)', () => {
    it('the fixture opens as stored (1.0, flipped) and as 1.1 (not flipped)', () => {
        expect(v10.flipXY).toBe(true);
        expect(v11.flipXY).toBe(false);
    });
    for (const c of CASES) {
        it(`${c.name}: 20 000/20 000 queries and 3 000/3 000 sweeps agree`, () => {
            const b = transformCollision(c.col, c.tr.s, c.tr.t);
            expect(b.flipXY).toBe(c.col.flipXY);
            expect(b.voxelResolution).toBeCloseTo(c.tr.s * 0.05, 15);
            const e = equivalence(c.col, b, c.tr);
            console.log(`[transform] ${c.name}: ${JSON.stringify(e)}`);
            expectEquivalent(e);
        });
    }

    it('shares the octree arrays and leaves the base untouched', () => {
        const before = [v10.gridMinX, v10.gridMinY, v10.gridMinZ, v10.voxelResolution];
        const b = transformCollision(v10, 2, [1, 2, 3]);
        expect(b.nodes).toBe(v10.nodes);
        expect(b.leafData).toBe(v10.leafData);
        expect([v10.gridMinX, v10.gridMinY, v10.gridMinZ, v10.voxelResolution]).toEqual(before);
        expect([b.numVoxelsX, b.numVoxelsY, b.numVoxelsZ]).toEqual([v10.numVoxelsX, v10.numVoxelsY, v10.numVoxelsZ]);
        // format 1.0: the file-space offset negates x and y
        expect(b.gridMinX).toBeCloseTo(2 * v10.gridMinX - 1, 12);
        expect(b.gridMinY).toBeCloseTo(2 * v10.gridMinY - 2, 12);
        expect(b.gridMinZ).toBeCloseTo(2 * v10.gridMinZ + 3, 12);
    });
});

describe('transformCollision controls', () => {
    it('control: s = 1, t = 0 is the identity, bit for bit, push vectors included', () => {
        const b = transformCollision(v10, 1, [0, 0, 0]);
        expect([b.gridMinX, b.gridMinY, b.gridMinZ, b.voxelResolution]).toEqual([v10.gridMinX, v10.gridMinY, v10.gridMinZ, v10.voxelResolution]);
        const e = equivalence(v10, b, IDENTITY_TRANSFORM);
        console.log(`[transform] control s = 1: ${JSON.stringify(e)}`);
        expectEquivalent(e);
        expect(e.querySphere.pushDiffer).toBe(0);
        expect(e.queryRay.maxHitErrM).toBe(0);
    });

    it('control: a wrong flip of the offset (t_file = t on format 1.0) breaks the equivalence', () => {
        const tr = around(1.5, spawn);
        const wrong = collisionWithMetadata(v10, transformedMetadata(v10, tr.s, tr.t));
        const e = equivalence(v10, wrong, tr, 2000, 300);
        console.log(`[transform] control wrong offset flip: ${JSON.stringify(e)}`);
        expect(e.isFreeAt.diff).toBeGreaterThan(100);
        expect(e.querySphere.diff).toBeGreaterThan(50);
        expect(e.queryRay.diff).toBeGreaterThan(50);
        // and the right flip on the same sample passes
        const right = collisionWithMetadata(v10, transformedMetadata(v10, tr.s, fileSpaceOffset(v10, tr.t)));
        expect(equivalence(v10, right, tr, 2000, 300).isFreeAt.diff).toBe(0);
    });

    it('control: the wrong adapter (format 1.0 data read without the flip) breaks the equivalence', () => {
        const tr = around(1.5, spawn);
        const wrong = collisionWithMetadata(v10, transformedMetadata(v10, tr.s, fileSpaceOffset(v10, tr.t)), false);
        const e = equivalence(v10, wrong, tr, 2000, 300);
        expect(e.isFreeAt.diff).toBeGreaterThan(100);
        expect(e.queryRay.diff).toBeGreaterThan(50);
    });

    it('rejects a scale that is not a finite number above 0, and a bad offset', () => {
        for (const s of [0, -1, NaN, Infinity]) expect(() => transformCollision(v10, s, [0, 0, 0])).toThrow(RangeError);
        expect(() => transformCollision(v10, 1, [0, NaN, 0])).toThrow(RangeError);
        expect(() => rescaleAround(IDENTITY_TRANSFORM, 0, [0, 0, 0])).toThrow(RangeError);
    });
});

describe('scene transform algebra (E.7: s2 = k*s1, t2 = D*(1 - k) + k*t1)', () => {
    const D = [1.25, -0.5, 3.75];
    it('rescaling around the drone keeps the drone where it is', () => {
        const t1 = around(1.3, [0.4, 2, -1]);
        const t2 = rescaleAround(t1, 1.1, D);
        expect(t2.s).toBeCloseTo(1.43, 14);
        const back = applyTransform(relativeTransform(t1, t2), D);
        for (let i = 0; i < 3; i++) expect(back[i]).toBeCloseTo(D[i], 12);
        // control: the same k around another point moves the drone
        const off = applyTransform(relativeTransform(t1, rescaleAround(t1, 1.1, [0, 0, 0])), D);
        expect(Math.hypot(off[0] - D[0], off[1] - D[1], off[2] - D[2])).toBeGreaterThan(0.1);
    });
    it('two rescales around one point equal one by the product; a transform relative to itself is the identity', () => {
        const a = rescaleAround(rescaleAround(IDENTITY_TRANSFORM, 1.1, D), 1.1, D);
        const b = rescaleAround(IDENTITY_TRANSFORM, 1.21, D);
        expect(a.s).toBeCloseTo(b.s, 14);
        for (let i = 0; i < 3; i++) expect(a.t[i]).toBeCloseTo(b.t[i], 12);
        const id = relativeTransform(a, a);
        expect(id.s).toBe(1);
        for (let i = 0; i < 3; i++) expect(id.t[i]).toBeCloseTo(0, 14);
    });
    it('a point mapped through T1 then T2 o T1^-1 lands where T2 puts it', () => {
        const t1 = around(0.8, [2, 1, 0]), t2 = around(2.5, [-1, 0, 4]);
        const w = [0.3, -2.2, 5.1];
        const via = applyTransform(relativeTransform(t1, t2), applyTransform(t1, w));
        const direct = applyTransform(t2, w);
        for (let i = 0; i < 3; i++) expect(via[i]).toBeCloseTo(direct[i], 12);
    });
});

describe('transformed analytic worlds and spawn search', () => {
    it('a synthetic wall moves where T puts it (its own occupancy is kept)', () => {
        const wall = syntheticWall(0.02, 2); // x in [0, 0.02)
        const tr = around(2, [1, 0, 0]); // x' = 2x - 1
        const b = transformCollision(wall, tr.s, tr.t);
        const hit = b.queryRay(-3, 0.013, 0.017, 1, 0, 0, 10);
        expect(hit).not.toBeNull();
        expect(Math.abs(hit!.x - -1)).toBeLessThan(1e-12);
        const e = equivalence(wall, b, tr, 5000, 0);
        expect(e.isFreeAt.diff + e.querySphere.diff + e.queryRay.diff).toBe(0);
        expect(e.queryRay.hits).toBeGreaterThan(1000);
        // control: the same grid without the wall's own occupancy has no wall at all
        const bare = new VoxelCollision(transformedMetadata(wall, tr.s, tr.t), wall.nodes, wall.leafData);
        expect(bare.queryRay(-3, 0.013, 0.017, 1, 0, 0, 10)).toBeNull();
    });

    it('spawn search steps by the scaled voxel and finds a clear place after a scale-down', () => {
        const tr = around(0.5, spawn);
        const b = transformCollision(v10, tr.s, tr.t);
        expect(b.voxelResolution).toBeCloseTo(0.025, 15);
        // the drone at the spawn (the pivot) stays put; a point 0.3 m away moves to 0.15 m
        const p = [spawn[0] + 0.3, spawn[1], spawn[2]];
        const q = applyTransform(tr, p);
        expect(q[0] - spawn[0]).toBeCloseTo(0.15, 12);
        // a spot inside a wall of the scaled world is pushed out to a clear one
        const hit = b.queryRay(spawn[0], spawn[1], spawn[2], 0, -1, 0, 20)!;
        expect(hit).not.toBeNull();
        const r = 0.06;
        expect(sphereOverlaps(b, hit.x, hit.y, hit.z, r)).toBe(true);
        const out = { x: 0, y: 0, z: 0 };
        expect(findSphereSpawn(b, hit.x, hit.y, hit.z, r, out)).toBe(true);
        expect(sphereOverlaps(b, out.x, out.y, out.z, r)).toBe(false);
    });
});
