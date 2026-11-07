// v0.12 Fly by Sound, lane v12-flight step 3 (docs/wip/v12-plan.md 2.4 and 4.2): what sound's rays cost in a scan.
// The sound package's scene sampler (30 rays per frame: ten sectors of three, 40 m) against the scan world of
// apps/fly/src/sonic/scan-world.ts on Winter Garden (7a475d38) at x5, its shipped 3.2 cm walls flown as 16 cm
// cells, along a walk through the hall at flying height. Budget (plan): p95 under 1 ms per frame on the main thread.
//
//   cd tools/bench && npx tsx src/sonic-rays.ts            (Node only: no browser, no GPU; walls from .cache/scenes)
//   SONIC_RAYS_SAMPLES=4000 SONIC_RAYS_SCALE=5 ...         (defaults 3000 and 5)
//
// Reported per frame (ms): the whole sampler (rays, normals, sectors, hazards) as the page will run it; the same 30
// rays alone with the scan world's normal (the hit voxel's 26 neighbours, @gsfpv/collision voxelNormal), with the
// vendored querySurfaceNormal the plan first named, and with none; plus 8 rings of a synthetic track on the walk
// (their sphere tracing). And how often the cheap normal gives the hit the same class (floor, ceiling, wall) as
// querySurfaceNormal, and the angle between the two. Evidence: evidence/<date>/sonic-rays.json.
import { createSceneSampler, headingBasis, listenerToWorld, sectorRays, yawQuat } from '../../../packages/sonic-fpv/src';
import type { FlightSample, SonicWorld, TrackFile, Vec3 } from '../../../packages/sonic-fpv/src';
import { faceNormal, transformCollision, voxelNormal } from '@gsfpv/collision';
import type { VoxelCollision } from '@gsfpv/collision';
import { ScanSonicWorld, classifyNormal } from '../../../apps/fly/src/sonic/scan-world';
import { loadScene } from './scenes';
import { writeEvidence } from './evidence';

const SCENE = '7a475d38';
const SCALE = Number(process.env.SONIC_RAYS_SCALE ?? 5);
const SAMPLES = Number(process.env.SONIC_RAYS_SAMPLES ?? 3000);
const BUDGET_P95_MS = 1;

/** A seeded generator (the same walk every run). */
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

function stats(ms: number[]): { n: number; mean: number; p50: number; p95: number; p99: number; max: number } {
    const s = [...ms].sort((a, b) => a - b);
    const q = (p: number): number => s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
    const r = (x: number): number => Math.round(x * 10000) / 10000;
    return { n: s.length, mean: r(s.reduce((a, b) => a + b, 0) / s.length), p50: r(q(0.5)), p95: r(q(0.95)), p99: r(q(0.99)), max: r(s[s.length - 1]) };
}

/**
 * A walk through the hall at flying height: 0.15 m a frame (9 m/s at 60 Hz), turning when the next point would put
 * a 0.5 m sphere into the walls, and drifting back to between 1 and 6 m over the floor below (scan metres times s).
 */
function walk(col: VoxelCollision, start: Vec3, n: number, seed: number): { pos: Vec3; dir: Vec3 }[] {
    const r = rng(seed);
    const out: { pos: Vec3; dir: Vec3 }[] = [];
    const push = { x: 0, y: 0, z: 0 };
    let p: Vec3 = start;
    let yaw = r() * Math.PI * 2;
    let climb = 0;
    for (let i = 0; out.length < n && i < n * 50; i++) {
        const d: Vec3 = [Math.sin(yaw) * Math.cos(climb), Math.sin(climb), -Math.cos(yaw) * Math.cos(climb)];
        const q: Vec3 = [p[0] + d[0] * 0.15, p[1] + d[1] * 0.15, p[2] + d[2] * 0.15];
        if (col.querySphere(q[0], q[1], q[2], 0.5, push)) {
            yaw = r() * Math.PI * 2;
            climb = (r() - 0.5) * 0.4;
            continue;
        }
        const floor = col.queryRay(q[0], q[1], q[2], 0, -1, 0, 200);
        const above = floor ? q[1] - floor.y : 0;
        climb = above > 6 * (SCALE / 5) ? -0.15 : above < 1 ? 0.15 : climb * 0.98;
        if (r() < 0.02) yaw += (r() - 0.5) * 1.5;
        p = q;
        out.push({ pos: q, dir: d });
    }
    return out;
}

/** 8 rings of 2 m (scan metres) along the walk, 10 % of it apart: a stand-in for the step-10 track. */
function ringsOn(path: readonly { pos: Vec3; dir: Vec3 }[], s: number): TrackFile {
    const gates = [1, 2, 3, 4, 5, 6, 7, 8].map((k) => {
        const at = path[Math.floor((k / 10) * path.length)];
        const yawDeg = (Math.atan2(at.dir[0], -at.dir[2]) * 180) / Math.PI;
        return { id: `ring-${k}`, shape: { kind: 'ring' as const, diameter: 2, tube: 0.1 }, pos: [at.pos[0] / s, at.pos[1] / s, at.pos[2] / s] as Vec3, quat: yawQuat(yawDeg), direction: 'any' as const };
    });
    return {
        format: 'shramko-sonic-track/1', id: 'bench-rings', version: 1, parent: null, title: 'bench', scene: { kind: 'scan', id: SCENE, version: 1 }, transform: [s, 0, 0, 0],
        gates, laps: 1, start: null, author: { kind: 'agent', name: 'sonic-rays' }, generator: null, created: '2026-11-07T00:00:00Z'
    };
}

/** The sampler frame by frame over the walk: ms per frame, and what the rays saw. */
function run(world: SonicWorld, path: readonly { pos: Vec3; dir: Vec3 }[]): { ms: number[]; hits: number; rays: number; wallHits: Record<string, number> } {
    const sampler = createSceneSampler();
    const ms: number[] = [];
    let hits = 0;
    const wallHits: Record<string, number> = {};
    path.forEach((w, i) => {
        const yawDeg = (Math.atan2(w.dir[0], -w.dir[2]) * 180) / Math.PI;
        const sample: FlightSample = {
            t: i * 16.7, tick: i * 17, pos: w.pos, vel: [w.dir[0] * 9, w.dir[1] * 9, w.dir[2] * 9], quat: yawQuat(yawDeg), rate: [0, 0, 0],
            yawDeg, pitchDeg: 0, rollDeg: 0, sticks: [0, 0, 0, 0], armed: true, touched: false, paused: false
        };
        const t = performance.now();
        const sc = sampler.sample(sample, world);
        ms.push(performance.now() - t);
        for (const sec of sc.sectors) {
            if (!sec.hit) continue;
            hits++;
            const m = sec.material ?? 'none';
            wallHits[m] = (wallHits[m] ?? 0) + 1;
        }
    });
    return { ms, hits, rays: path.length * 30, wallHits };
}

/** The 30 world directions of the sampler's rays at the walk's heading. */
function raysAt(w: { dir: Vec3 }): Vec3[] {
    const basis = headingBasis((Math.atan2(w.dir[0], -w.dir[2]) * 180) / Math.PI);
    return Object.values(sectorRays(20)).flat().map((d) => listenerToWorld(basis, d));
}

/** The 30 rays alone, without the sampler: the DDA, and the normal of each hit by `normal`. */
function raysOnly(col: VoxelCollision, path: readonly { pos: Vec3; dir: Vec3 }[], normal: 'none' | 'voxel' | 'voxel2' | 'surface'): number[] {
    const ms: number[] = [];
    for (const w of path) {
        const dirs = raysAt(w);
        const t = performance.now();
        for (const d of dirs) {
            const h = col.queryRay(w.pos[0], w.pos[1], w.pos[2], d[0], d[1], d[2], 40);
            if (!h) continue;
            if (normal === 'voxel') voxelNormal(col, h.x, h.y, h.z, d[0], d[1], d[2]) ?? faceNormal(col, h.x, h.y, h.z, d[0], d[1], d[2]);
            else if (normal === 'voxel2') voxelNormal(col, h.x, h.y, h.z, d[0], d[1], d[2], 2) ?? faceNormal(col, h.x, h.y, h.z, d[0], d[1], d[2]);
            else if (normal === 'surface') col.querySurfaceNormal(h.x, h.y, h.z, d[0], d[1], d[2]);
        }
        ms.push(performance.now() - t);
    }
    return ms;
}

/** Each cheap normal against querySurfaceNormal on every hit of every 3rd frame: the same class, and the angle. */
function agreement(col: VoxelCollision, path: readonly { pos: Vec3; dir: Vec3 }[]): Record<string, unknown> {
    type Hit = { x: number; y: number; z: number };
    const kinds: Record<string, (h: Hit, d: Vec3) => Vec3 | null> = {
        voxel1: (h, d) => voxelNormal(col, h.x, h.y, h.z, d[0], d[1], d[2], 1) ?? faceNormal(col, h.x, h.y, h.z, d[0], d[1], d[2]),
        voxel2: (h, d) => voxelNormal(col, h.x, h.y, h.z, d[0], d[1], d[2], 2) ?? faceNormal(col, h.x, h.y, h.z, d[0], d[1], d[2]),
        face: (h, d) => faceNormal(col, h.x, h.y, h.z, d[0], d[1], d[2])
    };
    const acc: Record<string, { same: number; angles: number[]; classes: Record<string, number> }> = {};
    for (const k of Object.keys(kinds)) acc[k] = { same: 0, angles: [], classes: {} };
    let hits = 0;
    for (let i = 0; i < path.length; i += 3) {
        const w = path[i];
        for (const d of raysAt(w)) {
            const h = col.queryRay(w.pos[0], w.pos[1], w.pos[2], d[0], d[1], d[2], 40);
            if (!h) continue;
            hits++;
            const q = col.querySurfaceNormal(h.x, h.y, h.z, d[0], d[1], d[2]);
            const ql = Math.hypot(q.nx, q.ny, q.nz);
            const b: Vec3 = [q.nx / ql, q.ny / ql, q.nz / ql];
            const cb = classifyNormal(b);
            for (const [k, f] of Object.entries(kinds)) {
                const a = f(h, d);
                const ca = classifyNormal(a);
                const r = acc[k];
                if (ca === cb) r.same++;
                r.classes[`${cb}->${ca}`] = (r.classes[`${cb}->${ca}`] ?? 0) + 1;
                if (a) r.angles.push((Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * 180) / Math.PI);
            }
        }
    }
    const out: Record<string, unknown> = { hits };
    for (const [k, r] of Object.entries(acc)) {
        r.angles.sort((x, y) => x - y);
        const q = (p: number): number => Math.round(r.angles[Math.floor(p * (r.angles.length - 1))] * 10) / 10;
        out[k] = { sameClassShare: Math.round((r.same / hits) * 1000) / 1000, angleDeg: { p50: q(0.5), p90: q(0.9) }, classes: r.classes };
    }
    return out;
}

const sc = await loadScene(SCENE);
const flown = transformCollision(sc.collision, SCALE, [0, 0, 0]);
const cam = sc.settings.position;
const path = walk(flown, [cam[0] * SCALE, cam[1] * SCALE, cam[2] * SCALE], SAMPLES, 7);
const walls = new ScanSonicWorld(SCENE, 1, { collision: () => flown, transform: () => ({ s: SCALE, t: [0, 0, 0] }) });
const withRings = new ScanSonicWorld(SCENE, 1, { collision: () => flown, transform: () => ({ s: SCALE, t: [0, 0, 0] }) }, ringsOn(path, SCALE));
// warm the JIT on the first 300 frames, then measure
run(walls, path.slice(0, 300));
raysOnly(flown, path.slice(0, 300), 'voxel');
raysOnly(flown, path.slice(0, 300), 'surface');
const a = run(walls, path);
const b = run(withRings, path);
const noNormal = stats(raysOnly(flown, path, 'none'));
const voxel = stats(raysOnly(flown, path, 'voxel'));
const voxel2 = stats(raysOnly(flown, path, 'voxel2'));
const surface = stats(raysOnly(flown, path, 'surface'));
const agree = agreement(flown, path);
const sampler = stats(a.ms);
const samplerRings = stats(b.ms);
const ok = sampler.p95 < BUDGET_P95_MS;
const result = {
    scene: SCENE,
    scale: SCALE,
    voxelCm: Math.round(sc.collision.voxelResolution * 1000) / 10,
    flownCellCm: Math.round(flown.voxelResolution * 1000) / 10,
    frames: path.length,
    raysPerFrame: 30,
    rangeM: 40,
    budget: { p95Ms: BUDGET_P95_MS },
    ms: { sampler, samplerWithRings: samplerRings, raysVoxelNormal: voxel, raysVoxelNormal5: voxel2, raysSurfaceNormal: surface, raysNoNormal: noNormal },
    normals: agree,
    seen: { hitShare: Math.round((a.hits / (path.length * 10)) * 1000) / 1000, sectorsByMaterial: a.wallHits, withRings: b.wallHits },
    pass: ok,
    note: 'Node (vitest-free tsx), main thread, one core; the page runs the same code once per rendered frame. Walls as shipped (3.2 cm); the 1.6 cm refine (8 cm at x5) is not measured here.'
};
const file = writeEvidence('sonic-rays', result);
console.log(JSON.stringify({ file, ...result }, null, 1));
console.log(`sonic-rays ${SCENE} x${SCALE}: sampler p50 ${sampler.p50} p95 ${sampler.p95} p99 ${sampler.p99} max ${sampler.max} ms per frame of 30 rays: ${ok ? 'PASS' : 'FAIL'} (budget p95 < ${BUDGET_P95_MS} ms)`);
process.exit(ok ? 0 : 1);
