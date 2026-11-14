// Lane tracks2, stage K1: the course generator's audit. For one scan's walls it builds the free space once, generates
// courses for many seeds and flies each along its own beacon path (packages/tracks/src/fly.ts) through the course's own
// lap detector at 3 m/s and 12 m/s, one detector step per 60 Hz frame as a page feeds it. Every gate that does not
// register is counted with its cause. Node only: no browser, no GPU.
//
//   cd tools/bench && npx tsx src/tracks-audit.ts --walls <dir with scene.voxel.json and .bin> --scene <id>
//       [--seeds 200] [--from 1] [--list s1,s2] [--transform s,tx,ty,tz] [--spawn x,y,z] [--out file.json] [--fit]
// --fit asks fitCourse (K1.2: smaller courses on small scans) as the page's worker does, instead of one generateCourse.
// Every row carries the course's trackDigest (sonic-fpv's), to compare seeds across generator changes.
// The walls directory is read only. Without --spawn the spawn is the scene's settings.json camera next to the walls, else
// the centre of the walls' grid.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { openVoxelCollision } from '@gsfpv/collision';
import type { VoxelMetadata } from '@gsfpv/collision';
import { fitCourse, flownCollision, flyPath, freeSpace, generateCourse } from '@gsfpv/tracks';
import { trackDigest } from '../../../packages/sonic-fpv/src';
import type { SceneTransform, Vec3 } from '@gsfpv/tracks';

function arg(name: string): string | null {
    const i = process.argv.indexOf(name);
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : null;
}
const nums = (s: string): number[] => s.split(',').map(Number);

export function loadWalls(dir: string): { walls: ReturnType<typeof openVoxelCollision>; meta: VoxelMetadata; spawn: Vec3 | null } {
    const meta = JSON.parse(readFileSync(join(dir, 'scene.voxel.json'), 'utf8')) as VoxelMetadata;
    let bin: Uint8Array = readFileSync(join(dir, 'scene.voxel.bin'));
    if (bin[0] === 0x1f && bin[1] === 0x8b) bin = gunzipSync(bin);
    const walls = openVoxelCollision(meta, bin);
    let spawn: Vec3 | null = null;
    const sp = join(dir, 'settings.json');
    if (existsSync(sp)) {
        const j = JSON.parse(readFileSync(sp, 'utf8'));
        const cam = j.cameras?.[0]?.initial ?? j.camera;
        if (cam?.position) spawn = cam.position as Vec3;
    }
    return { walls, meta, spawn };
}

async function main(): Promise<void> {
    const dir = arg('--walls');
    const scene = arg('--scene') ?? 'scan';
    if (!dir) throw new Error('--walls <dir> is needed');
    const T = (arg('--transform') ? nums(arg('--transform')!) : [1, 0, 0, 0]) as unknown as SceneTransform;
    const { walls: base, meta, spawn: own } = loadWalls(dir);
    let camera = own;
    if (!camera && /^[0-9a-f]{8}$/.test(scene)) {
        // the scene's camera from the CDN (a read; the page spawns there), else the grid's centre
        try {
            const r = await fetch(`https://d28zzqy0iyovbz.cloudfront.net/${scene}/v1/settings.json`);
            const j = (await r.json()) as { cameras?: { initial?: { position?: Vec3 } }[]; camera?: { position?: Vec3 } };
            camera = j.cameras?.[0]?.initial?.position ?? j.camera?.position ?? null;
        } catch {
            camera = null;
        }
    }
    const walls = flownCollision(base, T);
    const g = meta.gridBounds;
    const centre: Vec3 = [0, 1, 2].map((a) => (g.min[a]! + g.max[a]!) / 2) as unknown as Vec3;
    const s0 = arg('--spawn') ? (nums(arg('--spawn')!) as unknown as Vec3) : (camera ?? centre);
    const spawn: Vec3 = [T[0] * s0[0] + T[1], T[0] * s0[1] + T[2], T[0] * s0[2] + T[3]];
    const t0 = performance.now();
    const free = freeSpace(walls, { spawn });
    const freeMs = Math.round(performance.now() - t0);
    const list = arg('--list');
    const from = Number(arg('--from') ?? 1);
    const n = Number(arg('--seeds') ?? 200);
    const seeds = list ? list.split(',').map((x) => (/^g1\./.test(x) ? parseInt(x.slice(3), 36) : Number(x))) : Array.from({ length: n }, (_, i) => from + i);
    const speeds = [3, 12];
    const fitMode = process.argv.includes('--fit');
    const rows: Record<string, unknown>[] = [];
    const causes: Record<string, number> = {};
    let courses = 0, withGates = 0, failing = 0, genMs = 0, missedGates = 0, allGates = 0;
    for (const seed of seeds) {
        const c0 = performance.now();
        const opts = { seed, scene: { id: scene, version: 1 }, transform: T, created: '2026-11-14T00:00:00.000Z' };
        const fit = fitMode ? fitCourse(free, walls, opts) : null;
        const track = fit ? fit.track : generateCourse(free, walls, opts);
        if (!track) {
            courses++;
            rows.push({ seed, id: null, gates: 0, scale: fit?.scale, tried: fit?.tried });
            continue;
        }
        const ms = performance.now() - c0;
        genMs += ms;
        courses++;
        const row: Record<string, unknown> = { seed, id: track.id, digest: trackDigest(track), ...(fit ? { scale: fit.scale, short: fit.short, tried: fit.tried } : {}), gates: track.gates.length, laps: track.laps, stop: track.generator?.params.stop, proofOk: (track.generator?.params.proof as { ok?: boolean } | null)?.ok ?? null, ms: Math.round(ms) };
        if (track.gates.length > 0) {
            withGates++;
            allGates += track.gates.length;
            let bad = false;
            for (const v of speeds) {
                const f = flyPath(track, v, T);
                row[`v${v}`] = f.done ? 'done' : `stuck g${f.stuckAt}; ${f.misses.map((m) => `g${m.gate} ${m.cause}`).join(', ')}`;
                if (!f.done) bad = true;
                for (const m of f.misses) {
                    const k = `${v} m/s ${m.cause}`;
                    causes[k] = (causes[k] ?? 0) + 1;
                    missedGates++;
                }
            }
            if (bad) failing++;
        }
        rows.push(row);
        if (rows.length % 10 === 0 || list) console.error(`${scene} ${rows.length}/${seeds.length}: ${JSON.stringify(row)}`);
    }
    const summary = { scene, transform: T, spawn, freeMs, volumeM3: Math.round(free.volumeM3 * 1000) / 1000, rooms: free.rooms.length, outdoor: free.outdoor, startFound: free.startCell >= 0, courses, withGates, failing, gates: allGates, missedGateSpeeds: missedGates, causes, meanGenMs: Math.round(genMs / Math.max(1, courses)) };
    console.log(JSON.stringify(summary));
    const out = arg('--out');
    if (out) writeFileSync(out, JSON.stringify({ summary, rows }, null, 1));
}

const argv1 = (process.argv[1] ?? '').replace(/\\/g, '/');
if (/\/tracks-audit\.(ts|js|mjs)$/.test(argv1)) await main();
