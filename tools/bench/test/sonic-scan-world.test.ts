// v0.12 Fly by Sound, lane v12-flight step 3 (docs/wip/v12-plan.md 2.4, 2.7 and 4.2): a scan as sound reads it
// (apps/fly/src/sonic/scan-world.ts). The cost on Winter Garden x5 is the bench's (tools/bench/src/sonic-rays.ts,
// evidence/2026-11-07/sonic-rays.json); here what can be checked in Node with the repository's fixture scan:
//  - a ray hits where the flight's own walls are (the vendored DDA), on the legacy grid too, and a rescale scales
//    every distance by s exactly; the normal faces the ray (control: a normal that forgets the legacy grid's flip
//    does not);
//  - the cheap normal classes surfaces as well as querySurfaceNormal on geometry whose truth is known, clean and
//    with scan-like noise (control: the entered face alone, the fallback, is clearly worse under noise);
//  - a track's gates follow the scene transform, rays meet their solid shapes as obstacles with the gate's id and
//    pass through their openings.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { analyticCollision, faceNormal, openVoxelCollision, transformCollision, voxelNormal } from '../../../packages/collision/src';
import type { VoxelCollision, VoxelMetadata } from '../../../packages/collision/src';
import { yawQuat } from '../../../packages/sonic-fpv/src';
import type { TrackFile, Vec3 } from '../../../packages/sonic-fpv/src';
import { ScanSonicWorld, classifyNormal } from '../../../apps/fly/src/sonic/scan-world';

const FIX = join(__dirname, '..', '..', '..', 'fixtures', '39e63ce9');
const json = readFileSync(join(FIX, 'scene.voxel.json'), 'utf8');
const binRaw = new Uint8Array(readFileSync(join(FIX, 'scene.voxel.bin')));
const bin = binRaw[0] === 0x1f && binRaw[1] === 0x8b ? new Uint8Array(gunzipSync(binRaw)) : binRaw;
const base = openVoxelCollision(JSON.parse(json) as VoxelMetadata, bin);
const settings = JSON.parse(readFileSync(join(FIX, 'settings.json'), 'utf8')) as { cameras?: { initial?: { position: number[] } }[]; camera?: { position: number[] } };
const camPos = (settings.cameras?.[0]?.initial ?? settings.camera)!.position;
const CAM: Vec3 = [camPos[0], camPos[1], camPos[2]];

function rng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function dirs(n: number, seed: number): Vec3[] {
    const r = rng(seed);
    return Array.from({ length: n }, () => {
        const u = 2 * r() - 1, ph = 2 * Math.PI * r(), sq = Math.sqrt(1 - u * u);
        return [sq * Math.cos(ph), u, sq * Math.sin(ph)] as Vec3;
    });
}

const worldAt = (col: VoxelCollision, s: number, track: TrackFile | null = null, t: readonly number[] = [0, 0, 0]): ScanSonicWorld =>
    new ScanSonicWorld('39e63ce9', 1, { collision: () => col, transform: () => ({ s, t }) }, track);

describe('rays against the flight\'s walls', () => {
    it('the fixture scan (a legacy grid): a hit where queryRay finds the walls, inside the bounds, its normal facing the ray', () => {
        expect(base.flipXY).toBe(true);
        const w = worldAt(base, 1);
        const b = w.bounds;
        let hits = 0, facing = 0, misses = 0;
        for (const d of dirs(2000, 1)) {
            const h = w.castRay(CAM, d, 30);
            const q = base.queryRay(CAM[0], CAM[1], CAM[2], d[0], d[1], d[2], 30);
            if (!q) { expect(h).toBeNull(); misses++; continue; }
            expect(h).not.toBeNull();
            hits++;
            expect(Math.hypot(h!.point[0] - q.x, h!.point[1] - q.y, h!.point[2] - q.z)).toBeLessThan(1e-9);
            expect(h!.distance).toBeCloseTo(Math.hypot(q.x - CAM[0], q.y - CAM[1], q.z - CAM[2]), 9);
            expect(h!.objectId).toBeNull();
            expect(h!.material).toBe(classifyNormal(h!.normal));
            for (let a = 0; a < 3; a++) {
                expect(h!.point[a]).toBeGreaterThanOrEqual(b.min[a] - 1e-9);
                expect(h!.point[a]).toBeLessThanOrEqual(b.max[a] + 1e-9);
            }
            if (h!.normal && h!.normal[0] * d[0] + h!.normal[1] * d[1] + h!.normal[2] * d[2] < 0) facing++;
        }
        expect(hits).toBeGreaterThan(1500);
        expect(facing / hits).toBeGreaterThan(0.95);
        // control: the same normals with the legacy grid's flip forgotten (x and y not negated back) face the ray far less often
        let wrong = 0, n = 0;
        for (const d of dirs(2000, 1)) {
            const q = base.queryRay(CAM[0], CAM[1], CAM[2], d[0], d[1], d[2], 30);
            const nrm = q ? voxelNormal(base, q.x, q.y, q.z, d[0], d[1], d[2]) : null;
            if (!nrm) continue;
            n++;
            if (-nrm[0] * d[0] - nrm[1] * d[1] + nrm[2] * d[2] < 0) wrong++;
        }
        expect(wrong / n).toBeLessThan(0.75);
    });

    it('at x5 every distance is 5 times the distance at x1 and every class the same (the walls are the same octree seen through T)', () => {
        const w1 = worldAt(base, 1);
        const flown = transformCollision(base, 5, [0, 0, 0]);
        const w5 = worldAt(flown, 5);
        let n = 0;
        for (const d of dirs(500, 2)) {
            const a = w1.castRay(CAM, d, 30);
            const b = w5.castRay([CAM[0] * 5, CAM[1] * 5, CAM[2] * 5], d, 150);
            expect(b === null).toBe(a === null);
            if (!a || !b) continue;
            n++;
            expect(Math.abs(b.distance - 5 * a.distance)).toBeLessThan(1e-6);
            expect(b.material).toBe(a.material);
        }
        expect(n).toBeGreaterThan(400);
    });
});

// ---------------------------------------------------------------- the normal against known geometry

const RES = 0.16; // Winter Garden's 3.2 cm at x5
const N30: Vec3 = [0, Math.cos(Math.PI / 6), Math.sin(Math.PI / 6)];
const N60: Vec3 = [Math.sin(Math.PI / 3), Math.cos(Math.PI / 3), 0];
const sdBox = (x: number, y: number, z: number, hx: number, hy: number, hz: number): number => {
    const qx = Math.abs(x) - hx, qy = Math.abs(y) - hy, qz = Math.abs(z) - hz;
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0);
};
/** A room 30 x 12 x 30 with a 30 degree ramp (a floor), a 60 degree ramp (a wall), a ball and a pillar. */
const PARTS = [
    (x: number, y: number, z: number): number => -sdBox(x, y - 6, z, 15, 6, 15),
    (x: number, y: number, z: number): number => Math.max(N30[0] * x + N30[1] * (y - 1) + N30[2] * (z + 8), sdBox(x + 6, y - 2, z + 8, 3, 3, 4)),
    (x: number, y: number, z: number): number => Math.max(N60[0] * (x - 8) + N60[1] * (y - 2) + N60[2] * z, sdBox(x - 9, y - 3, z, 3, 3, 3)),
    (x: number, y: number, z: number): number => Math.hypot(x - 2, y - 4, z - 7) - 2.5,
    (x: number, y: number, z: number): number => Math.max(Math.hypot(x + 8, z - 6) - 1.2, Math.abs(y - 6) - 6)
];
const sdf = (x: number, y: number, z: number): number => Math.min(...PARTS.map((p) => p(x, y, z)));
function truth(p: Vec3): Vec3 {
    const h = 1e-4;
    const g: Vec3 = [sdf(p[0] + h, p[1], p[2]) - sdf(p[0] - h, p[1], p[2]), sdf(p[0], p[1] + h, p[2]) - sdf(p[0], p[1] - h, p[2]), sdf(p[0], p[1], p[2] + h) - sdf(p[0], p[1], p[2] - h)];
    const l = Math.hypot(...g);
    return [g[0] / l, g[1] / l, g[2] / l];
}
/** The scene as voxels, voxels within 1.2 cells of a surface flipped with probability `noise` (hashed: stable). */
function voxels(noise: number): VoxelCollision {
    const hash = (x: number, y: number, z: number): number => {
        let h = Math.imul((Math.floor(x / RES) * 73856093) ^ (Math.floor(y / RES) * 19349663) ^ (Math.floor(z / RES) * 83492791), 0x9e3779b1);
        h ^= h >>> 15;
        return (h >>> 0) / 4294967296;
    };
    return analyticCollision([-16, -1, -16], [16, 13, 16], RES, (x, y, z) => {
        const d = sdf(x, y, z);
        if (noise > 0 && Math.abs(d) < RES * 1.2 && hash(x, y, z) < noise) return d > 0;
        return d <= 0;
    });
}

/** Share of hits whose class (floor, ceiling, wall) an estimator gets right, and its median angle to the truth. */
function score(col: VoxelCollision, est: (h: { x: number; y: number; z: number }, d: Vec3) => Vec3 | null): { classRight: number; medianDeg: number; hits: number } {
    const r = rng(3);
    let n = 0, right = 0;
    const ang: number[] = [];
    for (let i = 0; i < 6000; i++) {
        const o: Vec3 = [(r() - 0.5) * 20, 1 + r() * 9, (r() - 0.5) * 20];
        if (sdf(...o) < 0.5) continue;
        const u = 2 * r() - 1, ph = 2 * Math.PI * r(), sq = Math.sqrt(1 - u * u);
        const d: Vec3 = [sq * Math.cos(ph), u, sq * Math.sin(ph)];
        const h = col.queryRay(o[0], o[1], o[2], d[0], d[1], d[2], 40);
        if (!h) continue;
        const t = truth([h.x, h.y, h.z]);
        n++;
        const e = est(h, d);
        if (classifyNormal(e) === classifyNormal(t)) right++;
        if (e) ang.push((Math.acos(Math.max(-1, Math.min(1, e[0] * t[0] + e[1] * t[1] + e[2] * t[2]))) * 180) / Math.PI);
    }
    ang.sort((a, b) => a - b);
    return { classRight: right / n, medianDeg: ang[Math.floor(ang.length / 2)], hits: n };
}

describe('the cheap normal (the hit voxel\'s 26 neighbours) against the truth', () => {
    for (const noise of [0, 0.15, 0.3]) {
        it(`noise ${noise}: classes as well as querySurfaceNormal (within 2 points); control: the entered face alone is worse under noise`, () => {
            const col = voxels(noise);
            const cheap = score(col, (h, d) => voxelNormal(col, h.x, h.y, h.z, d[0], d[1], d[2]) ?? faceNormal(col, h.x, h.y, h.z, d[0], d[1], d[2]));
            const qsn = score(col, (h, d) => { const q = col.querySurfaceNormal(h.x, h.y, h.z, d[0], d[1], d[2]); const l = Math.hypot(q.nx, q.ny, q.nz); return [q.nx / l, q.ny / l, q.nz / l]; });
            const face = score(col, (h, d) => faceNormal(col, h.x, h.y, h.z, d[0], d[1], d[2]));
            console.log(`sonic-scan-world normals at noise ${noise} (${cheap.hits} hits): class right cheap ${cheap.classRight.toFixed(3)}, querySurfaceNormal ${qsn.classRight.toFixed(3)}, face ${face.classRight.toFixed(3)}; median angle cheap ${cheap.medianDeg.toFixed(1)}`);
            expect(cheap.hits).toBeGreaterThan(4000);
            expect(cheap.classRight).toBeGreaterThan(0.95);
            expect(cheap.classRight).toBeGreaterThan(qsn.classRight - 0.02);
            expect(cheap.medianDeg).toBeLessThan(25);
            if (noise > 0) expect(face.classRight).toBeLessThan(cheap.classRight - 0.1);
        });
    }
});

// ---------------------------------------------------------------- a track's gates

/** Two rings of 1 m (scan metres) in the fixture's open space, 1.5 and 3 m along -x from its camera (6 m free there), laid out for x1. */
function track(): TrackFile {
    return {
        format: 'shramko-sonic-track/1', id: 'test-rings', version: 1, parent: null, title: 'test', scene: { kind: 'scan', id: '39e63ce9', version: 1 }, transform: [1, 0, 0, 0],
        gates: [
            { id: 'g1', shape: { kind: 'ring', diameter: 1, tube: 0.05 }, pos: [CAM[0] - 1.5, CAM[1], CAM[2]], quat: yawQuat(-90), direction: 'forward' },
            { id: 'g2', shape: { kind: 'ring', diameter: 1, tube: 0.05 }, pos: [CAM[0] - 3, CAM[1], CAM[2]], quat: yawQuat(-90), direction: 'any' }
        ],
        laps: 1, start: null, author: { kind: 'agent', name: 'test' }, generator: null, created: '2026-11-07T00:00:00Z'
    };
}

describe('a track\'s gates in the scan world', () => {
    it('follow the scene transform now: positions T(p), sizes times s, course order; a rescale moves them at once', () => {
        const tr = { s: 1, t: [0, 0, 0] as number[] };
        let col: VoxelCollision = base;
        const w = new ScanSonicWorld('39e63ce9', 1, { collision: () => col, transform: () => tr }, track());
        const g1 = w.objects()[0];
        expect(w.objects().map((o) => [o.id, o.order, o.material, o.solid])).toEqual([['g1', 0, 'obstacle', false], ['g2', 1, 'obstacle', false]]);
        expect(g1.pos).toEqual([CAM[0] - 1.5, CAM[1], CAM[2]]);
        tr.s = 5;
        tr.t = [1, 2, 3];
        col = transformCollision(base, 5, [1, 2, 3]);
        const g5 = w.objects()[0];
        expect(g5.pos).toEqual([(CAM[0] - 1.5) * 5 + 1, CAM[1] * 5 + 2, CAM[2] * 5 + 3]);
        expect(g5.shape).toEqual({ kind: 'ring', diameter: 5, tube: 0.25 });
    });

    it('a ray meets a ring\'s tube as an obstacle with the gate\'s id; a ray through its opening passes it (control)', () => {
        const w = worldAt(base, 1, track());
        const g = w.objects()[0];
        // at the bottom of the tube (centre line radius 0.55, tube 0.05), from the camera's x, 1.5 m before the ring
        // (the fixture's ceiling is too low for the top); the scan itself leaves that line free for more than 1.5 m
        const o: Vec3 = [CAM[0], g.pos[1] - 0.55, g.pos[2]];
        const free = base.queryRay(o[0], o[1], o[2], -1, 0, 0, 10);
        expect(free === null || Math.hypot(free.x - o[0], free.y - o[1], free.z - o[2]) > 1.6).toBe(true);
        const h = w.castRay(o, [-1, 0, 0], 10);
        expect(h).not.toBeNull();
        expect(h!.objectId).toBe('g1');
        expect(h!.material).toBe('obstacle');
        expect(h!.distance).toBeCloseTo(1.5 - 0.05, 2);
        expect(h!.normal![0]).toBeGreaterThan(0.9);
        // through the middle of both openings: no ring
        const through = w.castRay(CAM, [-1, 0, 0], 10);
        expect(through?.objectId ?? null).toBeNull();
        // the same tube ray in a world without the track meets no gate (control)
        const bare = worldAt(base, 1).castRay(o, [-1, 0, 0], 10);
        expect(bare?.objectId ?? null).toBeNull();
        expect(bare === null || bare.distance > 1.5).toBe(true);
    });
});
