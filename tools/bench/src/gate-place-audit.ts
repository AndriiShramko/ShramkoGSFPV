// Lane fix3b, stage Y2 (owner's message 52: gates at the height of a person's eyes where the scan is dense, none in the
// poor ends of streets). Node table of the generated courses as the worker makes them (save-check-audit.ts's way):
//   (a) per gate the height of its centre and of its lower edge above the ground under it: the tile's ground (quality.ts,
//       what the generator reads) and the first wall voxel straight below the centre (what a person stands on)
//   (b) the scan's height profile along the course: wall voxels per block layer above the tile ground, summed over the
//       tiles under the gates and the legs (sampled every 1 m), per tile; the layer where it peaks
//   (c) the quality (quality.ts near) at each gate and the lowest along each leg, as a share of the scan's best quarter
// Run: node_modules/.bin/tsx tools/bench/src/gate-place-audit.ts --scenes 70b50d42,887f27aa --seeds 5 --out <json>
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { blockDims, findSphereSpawn, forEachBlock, openVoxelCollision } from '@gsfpv/collision';
import type { VoxelCollision, VoxelMetadata } from '@gsfpv/collision';
import { COURSE_DEFAULTS, EYE_FREE_M, EYE_HI_M, FIT_BUDGET_MS, POOR_SHARE, cellCentre, clearanceM, fitCourse, freeAtMargin, goodForGate, groundBelow, qualityShare, flownCollision, freeSpace, marginOf, qualityBounds, qualityMap, sceneUnitM, upgradeTrack, wallsCheck } from '@gsfpv/tracks';
import type { QualityMap, SceneTransform, Vec3 } from '@gsfpv/tracks';
import { loadScene, sceneSettings } from './scenes';

const SPAWN_R = 0.2;
const MAX_H = 12;

function arg(name: string): string | null {
    const i = process.argv.indexOf(name);
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : null;
}
const r2 = (n: number): number => Math.round(n * 100) / 100;

async function wallsOf(id: string, dir: string | null): Promise<VoxelCollision> {
    if (!dir) return (await loadScene(id)).collision;
    const meta = JSON.parse(readFileSync(join(dir, 'scene.voxel.json'), 'utf8')) as VoxelMetadata;
    let bin: Uint8Array = readFileSync(join(dir, 'scene.voxel.bin'));
    if (bin[0] === 0x1f && bin[1] === 0x8b) bin = gunzipSync(bin);
    return openVoxelCollision(meta, bin);
}

function tileOf(q: QualityMap, p: readonly number[]): number {
    const tx = Math.floor((p[0]! - q.x0) / q.tileM), tz = Math.floor((p[2]! - q.z0) / q.tileM);
    return tx < 0 || tz < 0 || tx >= q.nx || tz >= q.nz ? -1 : tz * q.nx + tx;
}

/** height of the first wall voxel below p (what a person stands on), NaN within MAX_H */
function rayGround(w: VoxelCollision, p: readonly number[]): number {
    const r = w.voxelResolution;
    const o = { x: 0, y: 0, z: 0 };
    for (let y = p[1]!; y > p[1]! - MAX_H; y -= r) if (w.querySphere(p[0]!, y, p[2]!, r * 0.6, o)) return y;
    return NaN;
}

function popcount(v: number): number {
    v = v - ((v >>> 1) & 0x55555555);
    v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
    return (Math.imul((v + (v >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24) & 0xff;
}

/** (b) voxels per block layer above the tile ground, per tile, over the given tiles */
function profile(w: VoxelCollision, q: QualityMap, tiles: Set<number>): { layerM: number; perTile: number[] } {
    const flip = w.flipXY;
    const blockM = 4 * w.voxelResolution;
    const [nbx, nby, nbz] = blockDims(w);
    const gx = w.gridMinX, gy = w.gridMinY, gz = w.gridMinZ;
    const nb = Math.ceil(MAX_H / blockM);
    const sum = new Float64Array(nb);
    forEachBlock(w, [0, 0, 0], [nbx, nby, nbz], (bx, by, bz, lo, hi) => {
        const cx = gx + (bx + 0.5) * blockM;
        const wx = flip ? -cx : cx;
        const wz = gz + (bz + 0.5) * blockM;
        const t = tileOf(q, [wx, 0, wz]);
        if (t < 0 || !tiles.has(t)) return;
        const L = flip ? nby - 1 - by : by;
        const yb = flip ? -(gy + (nby - L) * blockM) : gy + L * blockM;
        const h = yb - q.ground[t]!;
        if (!(h >= 0)) return;
        const b = Math.floor(h / blockM + 1e-6);
        if (b < nb) sum[b] += popcount(lo >>> 0) + popcount(hi >>> 0);
    });
    return { layerM: r2(blockM), perTile: Array.from(sum, (v) => Math.round(v / Math.max(1, tiles.size))) };
}

async function main(): Promise<void> {
    const root = arg('--walls') ?? 'U:/Temp/gsfpv-train3/walls/release';
    const seeds = Number(arg('--seeds') ?? 5);
    const first = Number(arg('--first') ?? 1);
    const ids = existsSync(root) ? readdirSync(root).filter((d) => /^[0-9a-f]{8}$/.test(d)) : [];
    const newest = (id: string): number => Math.max(...readdirSync(join(root, id)).map((d) => /^v(\d+)$/.exec(d)).filter((m): m is RegExpExecArray => !!m).map((m) => Number(m[1])));
    const all = [...ids.map((id) => ({ id, v: newest(id) })).map(({ id, v }) => ({ id, v, dir: join(root, id, `v${v}`) as string | null })), ...['887f27aa', '39e63ce9', '7a475d38', 'b11e45d1'].map((id) => ({ id, dir: null as string | null, v: 1 }))];
    // course4 C3: the four catalogue scans with shipped walls (catalogue collision true) are read from the CDN as the page does
    const only = arg('--scenes')?.split(',') ?? null;
    // course4 C2: --scale s flies the scan as the page does after the pilot's Scene size x s (transform s,0,0,0; spawn x s)
    const S = Number(arg('--scale') ?? 1);
    const T = [S, 0, 0, 0] as unknown as SceneTransform;
    const rows: Record<string, unknown>[] = [];
    const out = arg('--out');
    for (const s of all) {
        if (only && !only.includes(s.id)) continue;
        try {
            const walls = flownCollision(await wallsOf(s.id, s.dir), T);
            const set = await sceneSettings(s.id, s.v);
            let spawn: Vec3 = [set.position[0] * S, set.position[1] * S, set.position[2] * S];
            const o = { x: 0, y: 0, z: 0 };
            if (walls.querySphere(spawn[0], spawn[1], spawn[2], SPAWN_R, o) && findSphereSpawn(walls, spawn[0], spawn[1], spawn[2], SPAWN_R, o)) spawn = [o.x, o.y, o.z];
            const tq = performance.now();
            const q = qualityMap(walls, { unitM: sceneUnitM(T as unknown as number[]) });
            const qMs = Math.round(performance.now() - tq);
            const box = qualityBounds(q, spawn);
            const freeOpts = { spawn, bounds: box ?? undefined, goodAt: box ? goodForGate(q) : undefined, unitM: sceneUnitM(T as unknown as number[]) };
            const free = freeSpace(walls, { ...freeOpts, ...(arg('--margin') ? { marginM: Number(arg('--margin')) } : {}) });
            // course4 C3: the page's worker reads the free space again at a smaller step's margin (--no-refree: as before C3)
            // the time one fitCourse spent reading the free space again (refreeMs in each row)
            let refreeMs = 0;
            const refree = arg('--no-refree')
                ? null
                : (marginM: number) => {
                      const t = performance.now();
                      const f = freeAtMargin(walls, freeOpts, marginM);
                      refreeMs += performance.now() - t;
                      return f;
                  };
            const share = (t: number): number => (t < 0 || !(q.best > 0) ? 0 : r2(q.near[t]! / q.best));
            if (arg('--diag')) {
                // the generator's eye-band filter (generate.ts walkCourse) counted stage by stage, scale 1
                const c = { cells: 0, roomy: 0, tile: 0, good: 0, share: 0, height: 0, ground: 0, eye: 0 };
                const top = Math.max(EYE_HI_M, q.band[1]);
                const sh: number[] = [];
                for (let i = 0; i < free.room.length; i++) {
                    if (free.room[i]! < 0) continue;
                    c.cells++;
                    const fr = clearanceM(free, i);
                    if (fr < EYE_FREE_M) continue;
                    c.roomy++;
                    const p = cellCentre(free, i);
                    const t = tileOf(q, p);
                    if (t < 0) continue;
                    c.tile++;
                    if (!q.good[t]) continue;
                    c.good++;
                    sh.push(qualityShare(q, p));
                    if (qualityShare(q, p) < POOR_SHARE) continue;
                    c.share++;
                    const ht = p[1] - q.ground[t]!;
                    if (!(ht > -1 && ht < top + 1)) continue;
                    c.height++;
                    const g = groundBelow(walls, p, top + 1);
                    if (!Number.isFinite(g)) continue;
                    c.ground++;
                    if (p[1] - g - Math.min(free.cellM / 2, fr - EYE_FREE_M) <= top) c.eye++;
                }
                sh.sort((a, b) => a - b);
                // course4 C3: the room's free space against the gate sizes: the largest free radius of a usable cell and
                // the longest straight row of usable cells along x or z whose free radius is at least r
                const [nx, ny, nz] = free.dims;
                let maxClear = 0;
                for (let i = 0; i < free.room.length; i++) if (free.room[i]! >= 0) { const c = clearanceM(free, i); if (c < 1e8) maxClear = Math.max(maxClear, c); }
                const straight = (r: number): number => {
                    let best = 0;
                    const ok = (x: number, y: number, z: number): boolean => { const i = x + nx * (y + ny * z); return free.room[i]! >= 0 && clearanceM(free, i) >= r; };
                    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) { let run = 0; for (let x = 0; x < nx; x++) { run = ok(x, y, z) ? run + 1 : 0; best = Math.max(best, run); } }
                    for (let x = 0; x < nx; x++) for (let y = 0; y < ny; y++) { let run = 0; for (let z = 0; z < nz; z++) { run = ok(x, y, z) ? run + 1 : 0; best = Math.max(best, run); } }
                    return r2(best * free.cellM);
                };
                const room = { maxClearM: r2(maxClear), straightM: Object.fromEntries([0.2, 0.4, 0.6, 1.0].map((r) => [r, straight(r)])) };
                const spawnShare = r2(qualityShare(q, spawn));
                console.log(JSON.stringify({ scene: s.id, diag: c, room, stats: free.stats, outdoor: free.outdoor, rooms: free.rooms.length, volumeM3: Math.round(free.volumeM3), box, cellM: free.cellM, res: walls.voxelResolution, tileM: q.tileM, goodTiles: q.goodTiles, best: Math.round(q.best), spawnShare, goodShareQ: [0.1, 0.5, 0.9].map((f) => r2(sh[Math.floor(f * (sh.length - 1))] ?? 0)) }));
                continue;
            }
            // --seed-list a,b,c: the seeds a page run printed (y3/ev regen[].seed), instead of first..first+seeds
            const list = arg('--seed-list')?.split(',').map(Number) ?? Array.from({ length: seeds }, (_, k) => first + k);
            for (const seed of list) {
                const t0 = performance.now();
                // review FY-1: each try's walk (gates walked, cut at the close, drops by kind, kept)
                const walks: string[] = [];
                const onWalk = (w: { walked: number; cutClose: number; drops: readonly string[]; kept: number }): void => {
                    const by: Record<string, number> = {};
                    for (const d of w.drops) by[d] = (by[d] ?? 0) + 1;
                    const x = w as unknown as { banded?: boolean; wanted?: number; farM?: number; band?: number[] | null; refused?: Record<string, number>; stop?: string; eyeHi?: number };
                    // course4 C2: an empty walk says whether it was banded, how many gates it wanted and how far its target lay
                    // course4 C3: and which rule refused its candidates, and why it stopped
                    const why = x.refused ? ` eye${x.eyeHi} ${Object.entries(x.refused).map(([k, v]) => `${k}${v}`).join(' ')} stop:${x.stop}` : '';
                    walks.push(`${w.walked}-${w.cutClose}c-${Object.entries(by).map(([k, v]) => `${v}${k}`).join('.')}=${w.kept}` + (w.walked === 0 ? ` b${x.banded ? 1 : 0} n${x.wanted} far${x.farM} band${JSON.stringify(x.band)}${why}` : ''));
                };
                refreeMs = 0;
                // course4 C4: --elements composes the course as the page's Shift+G does; the last composition is kept
                const ELEM = process.argv.includes('--elements');
                let comp: { drawn: Record<string, number>; placed: Record<string, number>; noSpace: Record<string, number>; noProof: Record<string, number> } | null = null;
                const onElements = (c: typeof comp): void => {
                    comp = c;
                };
                const got = fitCourse(free, walls, { seed, scene: { id: s.id, version: s.v }, transform: T, created: '2026-11-15T00:00:00Z', quality: box ? q : undefined, spawn, onWalk, ...(ELEM ? { elements: true, onElements } : {}) }, COURSE_DEFAULTS.gatesMin, undefined, { at: t0 + FIT_BUDGET_MS, now: () => performance.now() }, refree);
                const ms = Math.round(performance.now() - t0);
                const tr = got.track;
                if (!tr) {
                    rows.push({ scene: s.id, seed, gates: 0, ms, tried: got.tried, walks });
                    continue;
                }
                const problems = wallsCheck(walls, T, marginOf(tr))(upgradeTrack(tr)).length;
                const tiles = new Set<number>();
                const gates = tr.gates.map((g) => {
                    const p = g.pos as unknown as Vec3;
                    const t = tileOf(q, p);
                    tiles.add(t);
                    const sh = g.shape as { kind: string; side?: number; bar?: number; diameter?: number; tube?: number };
                    const half = sh.kind === 'square' ? (sh.side ?? 0) / 2 + (sh.bar ?? 0) : (sh.diameter ?? 0) / 2 + (sh.tube ?? 0) / 2;
                    const gr = rayGround(walls, p);
                    // the page probes' measure: one thin ray straight down (collision.queryRay), not a sphere of 0.6 voxel
                    const thin = walls.queryRay(p[0], p[1], p[2], 0, -1, 0, 80);
                    return { h: t >= 0 ? r2(p[1] - q.ground[t]!) : null, hRay: r2(p[1] - gr), hThin: thin ? r2(p[1] - thin.y) : null, low: r2(p[1] - half - gr), q: share(t), good: t >= 0 ? q.good[t] : 0, kind: sh.kind };
                });
                const pts: number[][] = [(tr.start?.pos as unknown as number[]) ?? (tr.gates[0]!.pos as unknown as number[]), ...tr.gates.map((g) => g.pos as unknown as number[])];
                if (tr.laps > 1) pts.push(pts[1]!);
                const legs: { minQ: number; badM: number }[] = [];
                for (let i = 0; i + 1 < pts.length; i++) {
                    const a = pts[i]!, b = pts[i + 1]!;
                    const L = Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!);
                    let minQ = Infinity, bad = 0;
                    const n = Math.max(1, Math.ceil(L));
                    for (let k = 0; k <= n; k++) {
                        const f = k / n;
                        const t = tileOf(q, [a[0]! + f * (b[0]! - a[0]!), 0, a[2]! + f * (b[2]! - a[2]!)]);
                        tiles.add(t);
                        minQ = Math.min(minQ, share(t));
                        if (t < 0 || !q.good[t]) bad++;
                    }
                    legs.push({ minQ: r2(minQ), badM: r2((bad * L) / (n + 1)) });
                }
                tiles.delete(-1);
                const prof = profile(walls, q, tiles);
                let peak = 0;
                for (let b = 0; b < prof.perTile.length; b++) if (prof.perTile[b]! > prof.perTile[peak]!) peak = b;
                let span = 0;
                for (const a of pts) for (const b of pts) span = Math.max(span, Math.hypot(a[0]! - b[0]!, a[2]! - b[2]!));
                const hs = gates.map((g) => g.h ?? NaN).filter((v) => Number.isFinite(v)).sort((x, y) => x - y);
                const row = {
                    scene: s.id, seed, gates: gates.length, laps: tr.laps, scale: got.scale, tried: got.tried, proven: got.proven, walks, ms, refreeMs: Math.round(refreeMs), problems, qMs, band: q.band, best: Math.round(q.best),
                    span: Math.round(span), hMin: hs[0], hMed: hs[hs.length >> 1], hMax: hs[hs.length - 1],
                    eye: gates.filter((g) => g.h !== null && g.h >= 1.2 && g.h <= 2.0).length,
                    eyeRay: gates.filter((g) => g.hRay >= 1.2 && g.hRay <= 2.0).length,
                    lowUnder03: gates.filter((g) => !(g.low >= 0.3)).length,
                    gateQmin: Math.min(...gates.map((g) => g.q)), legQmin: Math.min(...legs.map((l) => l.minQ)), legBadM: r2(legs.reduce((a, l) => a + l.badM, 0)),
                    layerM: prof.layerM, peakAt: r2(peak * prof.layerM), profile: prof.perTile.slice(0, Math.ceil(6 / prof.layerM)),
                    gateRows: gates, legRows: legs,
                    ...(comp ? { elements: comp } : {}),
                    kinds: gates.reduce<Record<string, number>>((m, g) => ((m[g.kind] = (m[g.kind] ?? 0) + 1), m), {})
                };
                rows.push(row);
                const { gateRows: _g, legRows: _l, profile: _p, ...short } = row;
                console.log(JSON.stringify(short));
                gates.forEach((g, k) => {
                    if (!(g.hThin !== null && g.hThin >= 1.1 && g.hThin <= 2.1)) console.log(JSON.stringify({ outOfBand: k + 1, pos: (tr.gates[k]!.pos as unknown as number[]).map(r2), ...g }));
                });
                if (out) writeFileSync(out, JSON.stringify({ rows }, null, 1));
            }
        } catch (err) {
            rows.push({ scene: s.id, error: String(err).slice(0, 300) });
            console.log(JSON.stringify({ scene: s.id, error: String(err).slice(0, 300) }));
        }
    }
    if (out) writeFileSync(out, JSON.stringify({ rows }, null, 1));
    console.log('DONE ' + rows.length);
}

const argv1 = (process.argv[1] ?? '').replace(/\\/g, '/');
if (/\/gate-place-audit\.(ts|js|mjs)$/.test(argv1)) void main();
