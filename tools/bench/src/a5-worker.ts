// Worker: runs N passes for one (scene, speed) job and returns aggregate counts.
import { parentPort, workerData } from 'node:worker_threads';
import { syntheticWall, VoxelContactWorld } from '@gsfpv/collision';
import type { VoxelCollision } from '@gsfpv/collision';
import { runPass, mulberry32, randomRotation } from './a5-tunnel';
import type { Body } from './a5-tunnel';
import { loadScene } from './scenes';

interface Job { scene: string; speed: number; passes: number; seed: number; body: { local: number[]; r: number[] } }

const job = workerData as Job;

function unitVec(rng: () => number): [number, number, number] {
    const z = rng() * 2 - 1;
    const a = rng() * 2 * Math.PI;
    const r = Math.sqrt(1 - z * z);
    return [r * Math.cos(a), z, r * Math.sin(a)];
}

async function main() {
    const b: Body = { local: Float64Array.from(job.body.local), r: Float64Array.from(job.body.r), n: job.body.r.length };
    let col: VoxelCollision;
    let spawn = [0, 0, 0];
    let oracleStep: number;
    if (job.scene === 'wall-2cm') {
        col = syntheticWall(0.02, 2);
    } else {
        const sc = await loadScene(job.scene);
        col = sc.collision;
        spawn = sc.settings.position;
    }
    oracleStep = col.voxelResolution / 4;
    const world = new VoxelContactWorld(col);
    const rng = mulberry32(job.seed);
    const R = new Float64Array(9);
    const c0 = new Float64Array(b.n * 3), c1 = new Float64Array(b.n * 3), tmp = new Float64Array(b.n * 3);
    const pad = new Float64Array(b.n);
    const push = { x: 0, y: 0, z: 0 };
    const agg = { passes: 0, contacts: 0, penetrations: 0, passesWithPenetration: 0, ctl30: { tunnel: 0, late: 0, ok: 0 }, ctl144: { tunnel: 0, late: 0, ok: 0 }, rejected: 0, meanLen: 0, examples: [] as unknown[] };
    const bodyFree = (x: number, y: number, z: number) => {
        for (let i = 0; i < b.n; i++) {
            const lx = b.local[i * 3], ly = b.local[i * 3 + 1], lz = b.local[i * 3 + 2];
            if (col.querySphere(x + R[0] * lx + R[1] * ly + R[2] * lz, y + R[3] * lx + R[4] * ly + R[5] * lz, z + R[6] * lx + R[7] * ly + R[8] * lz, b.r[i] + 0.002, push)) return false;
        }
        return true;
    };
    let lenSum = 0;
    // start points: around the authored camera; when that keeps missing (a camera high above the
    // scan, outside the voxel grid), anywhere inside the collision grid instead
    let streak = 0;
    let inGrid = false;
    const g0 = [col.gridMinX, col.gridMinY, col.gridMinZ];
    const gs = [col.numVoxelsX * col.voxelResolution, col.numVoxelsY * col.voxelResolution, col.numVoxelsZ * col.voxelResolution];
    while (agg.passes < job.passes) {
        if (!inGrid && streak > 2000 && job.scene !== 'wall-2cm') inGrid = true;
        randomRotation(rng, R, true);
        let sx: number, sy: number, sz: number, dx: number, dy: number, dz: number, maxLen: number;
        if (job.scene === 'wall-2cm') {
            sx = -0.15 - rng() * 1.65; sy = (rng() - 0.5) * 2.4; sz = (rng() - 0.5) * 2.4;
            // direction within 70 deg of the wall normal (+x)
            let d: [number, number, number];
            do { d = unitVec(rng); } while (d[0] < Math.cos((70 * Math.PI) / 180));
            [dx, dy, dz] = d;
            maxLen = (0.3 - sx) / dx; // well past the wall
        } else {
            if (inGrid) { sx = g0[0] + rng() * gs[0]; sy = g0[1] + rng() * gs[1]; sz = g0[2] + rng() * gs[2]; }
            else { sx = spawn[0] + (rng() - 0.5) * 40; sy = spawn[1] + (rng() - 0.5) * 10; sz = spawn[2] + (rng() - 0.5) * 40; }
            if (!col.isFreeAt(sx, sy, sz)) { agg.rejected++; streak++; continue; }
            [dx, dy, dz] = unitVec(rng);
            const hit = col.queryRay(sx, sy, sz, dx, dy, dz, 5);
            if (!hit) { agg.rejected++; streak++; continue; }
            streak = 0;
            const D = Math.hypot(hit.x - sx, hit.y - sy, hit.z - sz);
            // start 0.2..3 m before the surface, pass continues 0.5 m beyond it
            const back = Math.min(D, 0.2 + rng() * 2.8);
            sx = hit.x - dx * back; sy = hit.y - dy * back; sz = hit.z - dz * back;
            maxLen = back + 0.5;
        }
        if (!bodyFree(sx, sy, sz)) { agg.rejected++; continue; }
        const r = runPass(col, world, b, sx, sy, sz, dx, dy, dz, job.speed, maxLen, R, oracleStep, c0, c1, pad, tmp);
        agg.passes++;
        lenSum += Math.min(r.sweepStopDist, maxLen);
        if (r.sweepStopDist !== Infinity) agg.contacts++;
        agg.penetrations += r.penetrations;
        if (r.penetrations > 0) {
            agg.passesWithPenetration++;
            if (agg.examples.length < 5) agg.examples.push({ start: [sx, sy, sz], dir: [dx, dy, dz], R: Array.from(R), maxLen, ...r });
        }
        agg.ctl30[r.ctl30]++;
        agg.ctl144[r.ctl144]++;
    }
    agg.meanLen = lenSum / agg.passes;
    parentPort!.postMessage(agg);
}

main().catch((e) => { parentPort!.postMessage({ error: String(e && e.stack || e) }); });
