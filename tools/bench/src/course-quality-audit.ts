// Lane course3, stage G2: where the gates go against where the scan is good (packages/tracks/src/quality.ts). For one
// scan's walls: the quality map (height histogram above the ground, the dense band, the well-scanned tiles), then courses
// for many seeds, each measured: share of gates inside the dense band over a well-scanned tile, share of the
// well-scanned tiles the course visits (a tile within VISIT_M of a gate), the gate count. Node only, walls read only.
//
//   cd tools/bench && npx tsx src/course-quality-audit.ts --walls <dir> --scene <id> --spawn x,y,z [--seeds 20]
//       [--from 1] [--hist] [--quality [--spread]] [--out file.json]
// --hist prints the map only (no courses). The courses are fitCourse's, as the page's worker asks them.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { openVoxelCollision } from '@gsfpv/collision';
import type { VoxelMetadata } from '@gsfpv/collision';
import { fitCourse, flownCollision, freeSpace, qualityBounds, qualityMap, heightAbove, inDenseBand, tileOf } from '@gsfpv/tracks';
import type { SceneTransform, Vec3 } from '@gsfpv/tracks';

/** a tile counts as visited when a gate stands within this many flown m of its centre (estimate: one long leg's half) */
export const VISIT_M = 8;

function arg(name: string): string | null {
    const i = process.argv.indexOf(name);
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : null;
}
const nums = (s: string): number[] => s.split(',').map(Number);

function main(): void {
    const dir = arg('--walls');
    const scene = arg('--scene') ?? 'scan';
    if (!dir) throw new Error('--walls <dir> is needed');
    const meta = JSON.parse(readFileSync(join(dir, 'scene.voxel.json'), 'utf8')) as VoxelMetadata;
    let bin: Uint8Array = readFileSync(join(dir, 'scene.voxel.bin'));
    if (bin[0] === 0x1f && bin[1] === 0x8b) bin = gunzipSync(bin);
    const T = [1, 0, 0, 0] as unknown as SceneTransform;
    const walls = flownCollision(openVoxelCollision(meta, bin), T);
    const spawn = nums(arg('--spawn') ?? '0,0,0') as unknown as Vec3;
    const t0 = performance.now();
    const q = qualityMap(walls);
    const qMs = Math.round(performance.now() - t0);
    let withGround = 0;
    for (let t = 0; t < q.ground.length; t++) if (q.ground[t] === q.ground[t]) withGround++;
    // the extent a course may use: the good tiles inside qualityBounds (the same denominator before and after G2)
    const box = qualityBounds(q, spawn);
    let boxGood = 0;
    for (let t = 0; t < q.good.length; t++) {
        if (!q.good[t] || !box) continue;
        const tx = t % q.nx, tz = (t - tx) / q.nx;
        const cx = q.x0 + (tx + 0.5) * q.tileM, cz = q.z0 + (tz + 0.5) * q.tileM;
        if (cx >= box.min[0] && cx <= box.max[0] && cz >= box.min[2] && cz <= box.max[2]) boxGood++;
    }
    const map = { scene, qMs, tileM: q.tileM, tiles: q.nx * q.nz, withGround, goodTiles: q.goodTiles, boxGood, box, band: q.band, binM: q.binM, hist: q.hist, spawnH: heightAbove(q, spawn) };
    console.log(JSON.stringify(map));
    if (process.argv.includes('--hist')) return;

    const f0 = performance.now();
    // --quality: the page's way after G2 (box over the well-scanned extent, courses laid over the quality map)
    const withQ = process.argv.includes('--quality');
    const free = freeSpace(walls, { spawn, bounds: process.argv.includes('--spread') ? qualityBounds(q, spawn) ?? undefined : undefined });
    const freeMs = Math.round(performance.now() - f0);
    const seeds = Number(arg('--seeds') ?? 20), from = Number(arg('--from') ?? 1);
    const rows: unknown[] = [];
    const visitT = Math.ceil(VISIT_M / q.tileM);
    for (let seed = from; seed < from + seeds; seed++) {
        const g0 = performance.now();
        const fit = fitCourse(free, walls, { seed, scene: { id: scene, version: 1 }, transform: T, quality: withQ ? { ...q, spread: process.argv.includes('--spread') } : undefined });
        const ms = Math.round(performance.now() - g0);
        const gates = fit.track?.gates ?? [];
        const pos = gates.map((g) => g.pos as Vec3);
        const heights = pos.map((p) => Math.round(heightAbove(q, p) * 100) / 100);
        const inBand = pos.filter((p) => inDenseBand(q, p)).length;
        const seen = new Set<number>();
        for (const p of pos) {
            const t = tileOf(q, p);
            if (t < 0) continue;
            const tx = t % q.nx, tz = (t - tx) / q.nx;
            for (let dz = -visitT; dz <= visitT; dz++) for (let dx = -visitT; dx <= visitT; dx++) {
                const X = tx + dx, Z = tz + dz;
                if (X < 0 || Z < 0 || X >= q.nx || Z >= q.nz) continue;
                const cx = q.x0 + (X + 0.5) * q.tileM - p[0], cz = q.z0 + (Z + 0.5) * q.tileM - p[2];
                if (cx * cx + cz * cz <= VISIT_M * VISIT_M && q.good[Z * q.nx + X]) seen.add(Z * q.nx + X);
            }
        }
        let reach = 0;
        for (const p of pos) reach = Math.max(reach, Math.hypot(p[0] - spawn[0], p[2] - spawn[2]));
        const P = (fit.track?.generator?.params ?? {}) as Record<string, unknown>;
        const row = { seed, stop: P.stop, walked: P.walked, wanted: P.wanted, tries: P.tries, gates: gates.length, scale: fit.scale, inBand, visited: seen.size, reachM: Math.round(reach), heights, ms };
        rows.push(row);
        console.log(JSON.stringify(row));
    }
    const R = rows as { gates: number; inBand: number; visited: number; reachM: number; ms: number }[];
    const n = R.length || 1;
    const counts = R.map((r) => r.gates);
    const mean = counts.reduce((a, b) => a + b, 0) / n;
    const sd = Math.sqrt(counts.reduce((a, b) => a + (b - mean) * (b - mean), 0) / n);
    const allGates = counts.reduce((a, b) => a + b, 0) || 1;
    const summary = {
        scene, quality: withQ, freeMs, volumeM3: Math.round(free.volumeM3), cellM: free.cellM, goodTiles: q.goodTiles, boxGood, band: q.band,
        bandShare: Math.round((R.reduce((a, r) => a + r.inBand, 0) / allGates) * 1000) / 1000,
        visitedShare: Math.round((R.reduce((a, r) => a + r.visited, 0) / n / Math.max(1, boxGood)) * 1000) / 1000,
        gatesMin: Math.min(...counts), gatesMax: Math.max(...counts), gatesMean: Math.round(mean * 10) / 10, gatesSd: Math.round(sd * 10) / 10,
        reachMeanM: Math.round(R.reduce((a, r) => a + r.reachM, 0) / n), meanMs: Math.round(R.reduce((a, r) => a + r.ms, 0) / n)
    };
    console.log('SUMMARY ' + JSON.stringify(summary));
    const out = arg('--out');
    if (out) writeFileSync(out, JSON.stringify({ map, summary, rows }, null, 1));
}

const argv1 = (process.argv[1] ?? '').replace(/\\/g, '/');
if (/\/course-quality-audit\.(ts|js|mjs)$/.test(argv1)) main();
