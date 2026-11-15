// Lane fix3a, stage X2-gate-one (finding 2 of integration A: on Tunis, link seed 1, the note says "Fly through gate 1" and no
// gate is in the frame). For the generated course of each scan, as the page's worker asks it (course/worker.ts: quality map,
// qualityBounds box, freeSpace, fitCourse with the worker's deadline), measured from the spawn the session finds
// (session/index.ts findSpawn: the authored camera's position in the flown world, heading from its target, pushed out of
// the walls): the straight distance to gate 1, the distance to the nearest gate, whether gate 1 is inside the spawn view's
// frustum (the craft parked level, the camera tilted up by its uptilt), and whether the course is a closed ring (laps > 1)
// or an open path. Node only: no browser, no GPU.
//
//   cd tools/bench && npx tsx src/gate-one-audit.ts [--walls U:/Temp/gsfpv-train3/walls/release] [--seeds 5] [--scenes id,id] [--out f.json]
// The scans: every folder of --walls (published walls, <id>/v<newest>/scene.voxel.*) and Tunis 887f27aa (shipped walls, scenes.ts).
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { findSphereSpawn, openVoxelCollision } from '@gsfpv/collision';
import type { VoxelCollision, VoxelMetadata } from '@gsfpv/collision';
import { BEFORE_GATE_M, COURSE_DEFAULTS, FIT_BUDGET_MS, fitCourse, flownCollision, freeSpace, gateAxis, qualityBounds, qualityMap } from '@gsfpv/tracks';
import type { SceneTransform, Vec3 } from '@gsfpv/tracks';
import { loadScene, sceneSettings } from './scenes';

/** the camera's defaults (packages/prefs/src/defs/camera.ts fallbacks; a drone preset may set others): horizontal fov, uptilt */
export const FOV_H_DEG = 115;
export const UPTILT_DEG = 20;
/** the page's probes run at 1280x800 */
export const ASPECT = 1280 / 800;
/** the craft's sphere for the push out of the walls (estimate: the session uses the preset's boundRadius + 0.03) */
const SPAWN_R = 0.2;

function arg(name: string): string | null {
    const i = process.argv.indexOf(name);
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : null;
}
const r1 = (n: number): number => Math.round(n * 10) / 10;

/** heading (deg, right-turn positive, 0 = -z) from the authored camera (packages/scenes headingFromCamera) */
function heading(pos: readonly number[], target: readonly number[]): number {
    return (Math.atan2(target[0]! - pos[0]!, -(target[2]! - pos[2]!)) * 180) / Math.PI;
}

/** the point in the spawn camera's frame: right, up, forward (m) */
export function inView(spawn: Vec3, headingDeg: number, p: Vec3, uptiltDeg = UPTILT_DEG): { x: number; y: number; z: number } {
    const h = (headingDeg * Math.PI) / 180, u = (uptiltDeg * Math.PI) / 180;
    const fwd = [Math.sin(h), 0, -Math.cos(h)], right = [Math.cos(h), 0, Math.sin(h)];
    const f = [Math.cos(u) * fwd[0]!, Math.sin(u), Math.cos(u) * fwd[2]!];
    const up = [-Math.sin(u) * fwd[0]!, Math.cos(u), -Math.sin(u) * fwd[2]!];
    const d = [p[0] - spawn[0], p[1] - spawn[1], p[2] - spawn[2]];
    const dot = (a: number[]): number => a[0]! * d[0]! + a[1]! * d[1]! + a[2]! * d[2]!;
    return { x: dot(right), y: dot(up), z: dot(f) };
}

export function inFrustum(c: { x: number; y: number; z: number }, fovH = FOV_H_DEG, aspect = ASPECT): boolean {
    if (c.z <= 0) return false;
    const th = Math.tan((fovH * Math.PI) / 360), tv = th / aspect;
    return Math.abs(c.x / c.z) <= th && Math.abs(c.y / c.z) <= tv;
}

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
    const ids = existsSync(root) ? readdirSync(root).filter((d) => /^[0-9a-f]{8}$/.test(d)) : [];
    // the newest published version of each scan's walls (ab5efa0e is at v2); its settings are read from the same version
    const newest = (id: string): number => Math.max(...readdirSync(join(root, id)).map((d) => /^v(\d+)$/.exec(d)).filter((m): m is RegExpExecArray => !!m).map((m) => Number(m[1])));
    const all: { id: string; dir: string | null; v: number }[] = [...ids.map((id) => ({ id, v: newest(id) })).map(({ id, v }) => ({ id, v, dir: join(root, id, `v${v}`) })), { id: '887f27aa', dir: null, v: 1 }];
    const only = arg('--scenes')?.split(',') ?? null;
    const T = [1, 0, 0, 0] as unknown as SceneTransform;
    const rows: Record<string, unknown>[] = [];
    for (const s of all) {
        if (only && !only.includes(s.id)) continue;
        try {
            const walls = flownCollision(await wallsOf(s.id, s.dir), T);
            const set = await sceneSettings(s.id, s.v);
            let spawn: Vec3 = [set.position[0], set.position[1], set.position[2]];
            const yaw = heading(set.position, set.target);
            const push = { x: 0, y: 0, z: 0 };
            let pushed = false;
            if (walls.querySphere(spawn[0], spawn[1], spawn[2], SPAWN_R, push)) {
                const out = { x: 0, y: 0, z: 0 };
                if (findSphereSpawn(walls, spawn[0], spawn[1], spawn[2], SPAWN_R, out)) {
                    spawn = [out.x, out.y, out.z];
                    pushed = true;
                }
            }
            const quality = qualityMap(walls);
            const box = qualityBounds(quality, spawn);
            const free = freeSpace(walls, { spawn, bounds: box ?? undefined });
            for (let seed = 1; seed <= seeds; seed++) {
                const t0 = performance.now();
                const got = fitCourse(free, walls, { seed, scene: { id: s.id, version: s.v }, transform: T, created: '2026-11-15T00:00:00Z', quality: box ? quality : undefined, spawn }, COURSE_DEFAULTS.gatesMin, undefined, { at: t0 + FIT_BUDGET_MS, now: () => performance.now() });
                const gates = (got.track?.gates ?? []).map((g) => g.pos as Vec3);
                const dist = (p: Vec3): number => Math.hypot(p[0] - spawn[0], p[1] - spawn[1], p[2] - spawn[2]);
                const g1 = gates[0] ?? null;
                const c = g1 ? inView(spawn, yaw, g1) : null;
                const nearest = gates.length ? gates.map(dist).reduce((a, b) => Math.min(a, b)) : null;
                const nearestIdx = gates.length ? gates.map(dist).indexOf(nearest!) + 1 : null;
                const ring = (got.track?.laps ?? 0) > 1;
                const bearing = c ? r1((Math.atan2(c.x, c.z) * 180) / Math.PI) : null;
                // stage X3: the nearest gate as gate 1 with the generator's direction. A gate counts when passed along its
                // axis (path.ts gateAxis); from the spawn the pilot reaches the point BEFORE_GATE_M before it on the axis and
                // flies through. 'side' > 0: the spawn is on the gate's exit side (it must fly round the gate first).
                // flyInM: straight spawn -> that point + BEFORE_GATE_M (no walls taken into account: a lower bound).
                const gs = got.track?.gates ?? [];
                const flyIn = (i: number): { side: number; flyInM: number } => {
                    const ax = gateAxis(gs[i]!.quat as unknown as number[]);
                    const p = gs[i]!.pos as Vec3;
                    const entry: Vec3 = [p[0] - ax[0] * BEFORE_GATE_M, p[1] - ax[1] * BEFORE_GATE_M, p[2] - ax[2] * BEFORE_GATE_M];
                    const side = (spawn[0] - p[0]) * ax[0] + (spawn[1] - p[1]) * ax[1] + (spawn[2] - p[2]) * ax[2];
                    return { side: r1(side), flyInM: r1(dist(entry) + BEFORE_GATE_M) };
                };
                const st = got.track?.start?.pos ?? null;
                const x3 = gs.length && nearestIdx !== null
                    ? {
                          startToSpawnM: st ? r1(dist(st as unknown as Vec3)) : null,
                          gate1Side: flyIn(0).side, gate1FlyInM: flyIn(0).flyInM,
                          nearestSide: flyIn(nearestIdx - 1).side, nearestFlyInM: flyIn(nearestIdx - 1).flyInM,
                          minFlyInM: r1(Math.min(...gs.map((_, i) => flyIn(i).flyInM))), minFlyInGate: gs.map((_, i) => flyIn(i).flyInM).reduce((b, v, i, a) => (v < a[b]! ? i : b), 0) + 1
                      }
                    : null;
                const row = {
                    scene: s.id, seed, gates: gates.length, spawn: spawn.map(r1), yaw: r1(yaw), pushed,
                    toGate1M: g1 ? r1(dist(g1)) : null, nearestM: nearest === null ? null : r1(nearest), nearestGate: nearestIdx,
                    gate1InFrame: c ? inFrustum(c) : null, gate1BearingDeg: bearing, ring, laps: got.track?.laps ?? null,
                    lastToFirstM: gates.length > 1 ? r1(Math.hypot(gates[0]![0] - gates[gates.length - 1]![0], gates[0]![2] - gates[gates.length - 1]![2])) : null,
                    ms: Math.round(performance.now() - t0),
                    x3
                };
                rows.push(row);
                console.log(JSON.stringify(row));
            }
        } catch (err) {
            rows.push({ scene: s.id, error: String(err).slice(0, 200) });
            console.log(JSON.stringify({ scene: s.id, error: String(err).slice(0, 200) }));
        }
    }
    const out = arg('--out');
    if (out) writeFileSync(out, JSON.stringify({ fovH: FOV_H_DEG, uptilt: UPTILT_DEG, aspect: ASPECT, rows }, null, 1));
    console.log('DONE ' + rows.length);
}

const argv1 = (process.argv[1] ?? '').replace(/\\/g, '/');
if (/\/gate-one-audit\.(ts|js|mjs)$/.test(argv1)) void main();
