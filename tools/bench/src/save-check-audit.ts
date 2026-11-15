// Lane fix3b, stage Y1-save-check: does the generated course pass the edit mode's Save check untouched? For each scan and
// seed the course is made as the page's worker makes it (gate-one-audit.ts: the spawn the session finds, quality map,
// qualityBounds box, freeSpace, fitCourse with the worker's deadline), then checked as the Save checks it (wallsCheck on
// the same walls, the flown transform, marginOf(track)). Rows: the problems, the start's free radius and nearest wall, the
// failing legs (ends, freeM), the generator's own proof flag, the time. Node only: no browser, no GPU.
//
//   cd tools/bench && npx tsx src/save-check-audit.ts [--walls U:/Temp/gsfpv-train3/walls/release] [--seeds 5] [--scenes id,id] [--out f.json]
// The scans: every folder of --walls (published walls) and Tunis 887f27aa (shipped walls, scenes.ts), as the page uses them.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { findSphereSpawn, openVoxelCollision } from '@gsfpv/collision';
import type { VoxelCollision, VoxelMetadata } from '@gsfpv/collision';
import { COURSE_DEFAULTS, FIT_BUDGET_MS, checkTrack, fitCourse, flownCollision, freeSpace, marginOf, nearestWall, qualityBounds, qualityMap, upgradeTrack, wallsCheck } from '@gsfpv/tracks';
import type { SceneTransform, Vec3 } from '@gsfpv/tracks';
import { loadScene, sceneSettings } from './scenes';

/** the craft's sphere for the push out of the walls (as gate-one-audit.ts: estimate of the session's boundRadius + 0.03) */
const SPAWN_R = 0.2;

function arg(name: string): string | null {
    const i = process.argv.indexOf(name);
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : null;
}
const r3 = (n: number): number => Math.round(n * 1000) / 1000;

async function wallsOf(id: string, dir: string | null): Promise<VoxelCollision> {
    if (!dir) return (await loadScene(id)).collision;
    const meta = JSON.parse(readFileSync(join(dir, 'scene.voxel.json'), 'utf8')) as VoxelMetadata;
    let bin: Uint8Array = readFileSync(join(dir, 'scene.voxel.bin'));
    if (bin[0] === 0x1f && bin[1] === 0x8b) bin = gunzipSync(bin);
    return openVoxelCollision(meta, bin);
}

async function main(): Promise<void> {
    const root = arg('--walls') ?? 'U:/Temp/gsfpv-train3/walls/release';
    const seeds = Number(arg('--seeds') ?? 5);
    const first = Number(arg('--first') ?? 1);
    const ids = existsSync(root) ? readdirSync(root).filter((d) => /^[0-9a-f]{8}$/.test(d)) : [];
    const newest = (id: string): number => Math.max(...readdirSync(join(root, id)).map((d) => /^v(\d+)$/.exec(d)).filter((m): m is RegExpExecArray => !!m).map((m) => Number(m[1])));
    const all: { id: string; dir: string | null; v: number }[] = [...ids.map((id) => ({ id, v: newest(id) })).map(({ id, v }) => ({ id, v, dir: join(root, id, `v${v}`) })), { id: '887f27aa', dir: null, v: 1 }];
    const only = arg('--scenes')?.split(',') ?? null;
    const T = [1, 0, 0, 0] as unknown as SceneTransform;
    const T4: [number, number, number, number] = [1, 0, 0, 0];
    const rows: Record<string, unknown>[] = [];
    const out = arg('--out');
    for (const s of all) {
        if (only && !only.includes(s.id)) continue;
        try {
            const walls = flownCollision(await wallsOf(s.id, s.dir), T);
            const set = await sceneSettings(s.id, s.v);
            let spawn: Vec3 = [set.position[0], set.position[1], set.position[2]];
            if (walls.querySphere(spawn[0], spawn[1], spawn[2], SPAWN_R, { x: 0, y: 0, z: 0 })) {
                const o = { x: 0, y: 0, z: 0 };
                if (findSphereSpawn(walls, spawn[0], spawn[1], spawn[2], SPAWN_R, o)) spawn = [o.x, o.y, o.z];
            }
            const quality = qualityMap(walls);
            const box = qualityBounds(quality, spawn);
            const free = freeSpace(walls, { spawn, bounds: box ?? undefined });
            for (let seed = first; seed < first + seeds; seed++) {
                const t0 = performance.now();
                const got = fitCourse(free, walls, { seed, scene: { id: s.id, version: s.v }, transform: T, created: '2026-11-15T00:00:00Z', quality: box ? quality : undefined, spawn }, COURSE_DEFAULTS.gatesMin, undefined, { at: t0 + FIT_BUDGET_MS, now: () => performance.now() });
                const ms = Math.round(performance.now() - t0);
                const tr = got.track;
                if (!tr) {
                    rows.push({ scene: s.id, seed, gates: 0, ms });
                    console.log(JSON.stringify(rows[rows.length - 1]));
                    continue;
                }
                const margin = marginOf(tr);
                const problems = wallsCheck(walls, T, margin)(upgradeTrack(tr));
                // the measured report (free radii every 0.25 m) took about 20 min for one 300 m Tunis course on 5 cm walls
                // (seed 3, audit-before-tunis.log): measured only when the Save check finds a problem
                const rep = checkTrack(tr, walls, T4, margin, problems.length > 0);
                const st = tr.start?.pos as Vec3 | undefined;
                const near = st ? nearestWall(walls, st) : null;
                const row = {
                    scene: s.id, seed, gates: tr.gates.length, laps: tr.laps, scale: got.scale, short: got.short, tried: got.tried, ms, margin,
                    res: walls.voxelResolution, spawn: spawn.map(r3), start: st ? st.map(r3) : null, gate1: (tr.gates[0]?.pos as Vec3 | undefined)?.map(r3) ?? null,
                    proof: (tr.generator?.params as { proof?: unknown } | undefined)?.proof ?? null,
                    problems, startFreeM: rep.startFreeM, nearWallM: near ? r3(near.distance) : null,
                    badLegs: rep.legs.filter((l) => !l.clear).map((l) => ({ from: l.from, to: l.to, freeM: l.freeM, at: l.at })),
                    badGates: rep.gates.filter((g) => !g.clear || !g.directionOk).map((g) => ({ id: g.id, freeM: g.freeM, axisInDeg: g.axisInDeg }))
                };
                rows.push(row);
                console.log(JSON.stringify(row));
                if (out) writeFileSync(out, JSON.stringify({ rows }, null, 1));
            }
        } catch (err) {
            rows.push({ scene: s.id, error: String(err).slice(0, 200) });
            console.log(JSON.stringify({ scene: s.id, error: String(err).slice(0, 200) }));
        }
    }
    if (out) writeFileSync(out, JSON.stringify({ rows }, null, 1));
    console.log('DONE ' + rows.length);
}

const argv1 = (process.argv[1] ?? '').replace(/\\/g, '/');
if (/\/save-check-audit\.(ts|js|mjs)$/.test(argv1)) void main();
