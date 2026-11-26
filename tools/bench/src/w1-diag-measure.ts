// Lane w1-diag (train 5), stage S2: where does the course generator lay its gates? A fixed set of catalogue scans, three
// seeds, every level and spread the Shift+G dialog offers, for the LIVE generator (planCourse of @gsfpv/tracks) and for the
// generator of the release of 2026-11-16 (main efd17add: qualityMap -> qualityBounds(spawn) -> freeSpace -> fitCourse,
// the old worker's else branch), each plan in a child process with a hang timeout. Node only, no browser.
//
// 'Well scanned' is NOT the generator's own quality map: it is read from the splats themselves. Per horizontal tile of
// side tileM (the walls' footprint / 100, clamped to 0.2-3 m) the opacity mass (sum of the linear opacity of the splats
// whose centre falls in the tile column, at every height) is summed over the 3 x 3 tiles around; a point is 'good' when
// that mass is at least the median over the tiles that hold any splat. A uniform pick among scanned tiles scores 0.5.
//
//   npx tsx src/w1-diag-measure.ts [--scenes a,b] [--seeds 1,2,3] [--versions live,old,neg] [--out DIR] [--hang-ms 150000]
//   (internal) --child <id> <live|old> --skip k1,k2
import { spawn as spawnProc } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { deflateSync, gunzipSync } from 'node:zlib';
import { openVoxelCollision, placeStart, sphereOverlaps } from '@gsfpv/collision';
import type { VoxelCollision, VoxelMetadata } from '@gsfpv/collision';
import { compileParams } from '@gsfpv/sim-core';
import { analyzeScan, courseAnchor, planCourse } from '@gsfpv/tracks';
import type { CourseLevel, CourseSpread, SceneTransform } from '@gsfpv/tracks';
import { loadScene, sceneSettings } from './scenes';
import { REPO } from './evidence';

function arg(name: string): string | null {
    const i = process.argv.indexOf(name);
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : null;
}
const r2 = (n: number): number => Math.round(n * 100) / 100;
type V3 = [number, number, number];
const dist = (a: readonly number[], b: readonly number[]): number => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

const CDN = 'https://d28zzqy0iyovbz.cloudfront.net';
const BAKED = 'U:/Temp/gsfpv-train3/walls/release';
/** the fixed set: a street, a room, a wide open place, the Tunis scan, a city */
const SET: Record<string, string> = { '70b50d42': 'street (Wroclaw)', '39e63ce9': 'room (Modlinek)', eb5f51dc: 'wide open place', '887f27aa': 'Tunis', '2f1ddf5f': 'city (Lublin)' };
const LEVELS: CourseLevel[] = ['beginner', 'medium', 'pro'];
const SPREADS: CourseSpread[] = ['compact', 'wide'];
const OLD_ROOT = 'U:/Temp/gsfpv-train4/w1-diag/old';
/** S3 negative control: a scratch copy of packages/tracks whose planCourse takes the spawn (the author's camera) as
 *  `a.core` (one line after analyzeScan); version 'neg' runs the live jobs with that planCourse */
const NEG_ROOT = 'U:/Temp/gsfpv-train4/w1-diag/neg';
const T = [1, 0, 0, 0] as unknown as SceneTransform;
const CREATED = '2026-11-26T00:00:00.000Z';

interface Walls { walls: VoxelCollision; meta: VoxelMetadata; version: number; flip: boolean; cam: V3; target: V3 }

async function openWalls(id: string): Promise<Walls> {
    const dir = existsSync(join(BAKED, id)) ? join(BAKED, id) : null;
    if (dir) {
        const v = Math.max(...(await import('node:fs')).readdirSync(dir).map((d) => Number(/^v(\d+)$/.exec(d)?.[1] ?? 0)));
        const meta = JSON.parse(readFileSync(join(dir, `v${v}`, 'scene.voxel.json'), 'utf8')) as VoxelMetadata;
        let bin: Uint8Array = readFileSync(join(dir, `v${v}`, 'scene.voxel.bin'));
        if (bin[0] === 0x1f && bin[1] === 0x8b) bin = gunzipSync(bin);
        const walls = openVoxelCollision(meta, bin);
        const s = await sceneSettings(id, v);
        return { walls, meta, version: v, flip: walls.flipXY, cam: s.position, target: s.target };
    }
    const s = await loadScene(id);
    return { walls: s.collision, meta: s.metadata, version: 1, flip: s.collision.flipXY, cam: s.settings.position, target: s.settings.target };
}

/** the gates of a track in the flown world (transform identity) */
function gatesOf(track: { gates: { pos: readonly number[] }[] } | null): V3[] {
    return track ? track.gates.map((g) => [g.pos[0]!, g.pos[1]!, g.pos[2]!] as V3) : [];
}

function wallsHits(walls: VoxelCollision, gates: V3[], closed: boolean): { gatesIn: number; legsIn: number } {
    const R = 0.05;
    let gatesIn = 0, legsIn = 0;
    for (const g of gates) if (sphereOverlaps(walls, g[0], g[1], g[2], R)) gatesIn++;
    const legs = closed && gates.length > 2 ? gates.length : gates.length - 1;
    for (let i = 0; i < legs; i++) {
        const a = gates[i]!, b = gates[(i + 1) % gates.length]!;
        const n = Math.max(2, Math.ceil(dist(a, b) / 0.2));
        // the ends are inside the gates' own frames: sample the middle 80 %
        for (let k = 1; k < n; k++) {
            const f = 0.1 + 0.8 * (k / n);
            if (sphereOverlaps(walls, a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1]), a[2] + f * (b[2] - a[2]), R)) { legsIn++; break; }
        }
    }
    return { gatesIn, legsIn };
}

// ------------------------------------------------------------------------------------------------------------ child

async function child(id: string, version: 'live' | 'old' | 'neg', out: string, skip: Set<string>, seeds: number[]): Promise<void> {
    const w = await openWalls(id);
    const preset = JSON.parse(readFileSync(join(REPO, 'packages/sim-core/presets/pavo20pro-3s.json'), 'utf8'));
    const craftR = compileParams(preset).boundRadius; // the page's default drone (apps/fly/src/presets.ts DEFAULT_PRESET)
    const placed = placeStart(w.walls, w.cam, w.target, craftR + 0.03).pos as V3; // session findSpawn
    const a = analyzeScan(w.walls, T);
    if (!skip.has('head')) appendFileSync(out, JSON.stringify({ head: true, id, version, kind: a.kind, cam: w.cam, spawn: placed, core: a.core, coreRadiusM: a.coreRadiusM, craftR, flip: w.flip, gridBounds: w.meta.gridBounds }) + '\n');
    const jobs: { key: string; seed: number; level?: CourseLevel; spread?: CourseSpread }[] = [];
    if (version !== 'old') for (const level of LEVELS) for (const spread of SPREADS) for (const seed of seeds) jobs.push({ key: `${level}-${spread}-${seed}`, seed, level, spread });
    else for (const seed of seeds) jobs.push({ key: `old-${seed}`, seed });
    const old = version === 'old' ? await import(pathToFileURL(join(OLD_ROOT, 'packages/tracks/src/index.ts')).href) : null;
    const plan: typeof planCourse = version === 'neg' ? (await import(pathToFileURL(join(NEG_ROOT, 'packages/tracks/src/index.ts')).href)).planCourse : planCourse;
    for (const j of jobs) {
        if (skip.has(j.key)) continue;
        console.log(`BEGIN ${j.key}`);
        const t0 = performance.now();
        let track: { gates: { pos: number[] }[] } | null = null, closed = false, note = '';
        if (!old) {
            const r = plan({ walls: w.walls, transform: T, spawn: placed, scene: { id, version: w.version }, created: CREATED, craftRadiusM: craftR, request: { seed: j.seed, level: j.level!, spread: j.spread!, anyQuality: false, anchor: courseAnchor(placed) }, elements: true });
            if (r.ok) { track = r.track as never; closed = r.stats.closed; note = r.shrunk ? 'shrunk' : ''; } else note = `no-room fit ${r.fitSize}`;
        } else {
            // the old worker's else branch (git show efd17add:apps/fly/src/course/worker.ts, lines 74-90), without progress posts
            const unitM = old.sceneUnitM(T);
            const quality = old.qualityMap(w.walls, { unitM });
            const box = old.qualityBounds(quality, placed);
            const freeOpts = { spawn: placed, bounds: box ?? undefined, goodAt: box ? old.goodForGate(quality) : undefined, unitM };
            const free = old.freeSpace(w.walls, freeOpts);
            const got = old.fitCourse(free, w.walls, { seed: j.seed, scene: { id, version: w.version }, transform: T, created: CREATED, quality: box ? quality : undefined, spawn: placed, elements: true, craftRadiusM: craftR }, old.COURSE_DEFAULTS.gatesMin, old.generateCourse, { at: t0 + old.FIT_BUDGET_MS, now: () => performance.now() }, (m: number) => old.freeAtMargin(w.walls, freeOpts, m));
            track = got.track;
            closed = !!(got.track as { closed?: boolean } | null)?.closed;
            note = got.track ? (got.short ? 'short' : '') : 'refused';
        }
        const s = r2((performance.now() - t0) / 1000);
        const gates = gatesOf(track);
        appendFileSync(out, JSON.stringify({ key: j.key, seed: j.seed, level: j.level ?? 'old', spread: j.spread ?? 'old', ok: !!track, note, seconds: s, closed, gates, ...wallsHits(w.walls, gates, closed) }) + '\n');
        console.log(`DONE ${j.key} ${gates.length} gates ${s} s ${note}`);
    }
}

// ------------------------------------------------------------------------------------------------- splat density map

interface Density { id: string; x0: number; z0: number; tileM: number; nx: number; nz: number; mass: number[]; count: number[]; median: number; splats: number; level: number | null; url: string; bboxP01: number[]; bboxP99: number[]; frame: { used: number; other: number } }

async function contentOf(id: string): Promise<{ url: string; kind: 'lod-meta' | 'meta' } | null> {
    for (let v = 8; v >= 1; v--) for (const kind of ['lod-meta', 'meta'] as const) {
        const url = `${CDN}/${id}/v${v}/${kind}.json`;
        const r = await fetch(url, { method: 'HEAD', headers: { Origin: 'https://gsfpv.flyreelstudio.eu' } });
        if (r.ok) return { url, kind };
    }
    return null;
}

async function densityMap(id: string, w: Walls, cacheDir: string): Promise<Density> {
    const file = join(cacheDir, `density-${id}.json`);
    if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')) as Density;
    const c = await contentOf(id);
    if (!c) throw new Error(`${id}: no splat content on the CDN`);
    const st = await import(pathToFileURL(join(REPO, 'apps/fly/node_modules/@playcanvas/splat-transform/dist/index.mjs')).href);
    const base = c.url.slice(0, c.url.lastIndexOf('/') + 1);
    const sources = await st.readFile({ filename: c.url.slice(base.length), inputFormat: c.kind === 'lod-meta' ? 'lod' : 'sog', fileSystem: new st.UrlReadFileSystem(base) });
    let level: number | null = null, src = sources[0];
    if (c.kind === 'lod-meta') {
        const meta = await (await fetch(c.url, { headers: { Origin: 'https://gsfpv.flyreelstudio.eu' } })).json() as { counts?: number[]; lodLevels?: number };
        const counts = meta.counts ?? [];
        level = Math.max(0, counts.findIndex((n) => n <= 16_000_000));
        src = st.selectLod(sources[0], level);
    }
    const t = await st.materializeToDataTable(src, st.createChunkDataPool(), new Set(['position', 'geometric']));
    for (const s of sources) await s.close();
    const col = (n: string): Float32Array => t.getColumnByName(n).data;
    const xs = col('x'), ys = col('y'), zs = col('z'), op = col('opacity');
    let neg = 0;
    for (let i = 0; i < op.length; i += 97) if (op[i]! < 0) neg++;
    const logit = neg > 0; // a logit column has negatives; the linear one never
    // the frame check: opaque splats sit on the walls in the right mapping of the data table into the flown world, and far
    // less in the other one (its own negative control). Measured 2026-11-26: (-x, -y, z) for every scan of the set, legacy
    // (flipped) and 1.1 grids alike (on walls 0.96 to 1.0 against 0 to 0.11), so the mapping is chosen by the check
    const onWalls = (flipIt: boolean): number => {
        let hit = 0, n = 0;
        for (let i = 0; i < xs.length && n < 2000; i += Math.max(1, Math.floor(xs.length / 4000))) {
            const o = logit ? 1 / (1 + Math.exp(-op[i]!)) : op[i]!;
            if (o < 0.5) continue;
            n++;
            const s = flipIt ? -1 : 1;
            if (sphereOverlaps(w.walls, s * xs[i]!, s * ys[i]!, zs[i]!, level ? 1 : 2 * w.meta.voxelResolution)) hit++; // a merged splat of a coarse level sits up to its size off the surface
        }
        return n ? r2(hit / n) : 0;
    };
    const minus = onWalls(true), plus = onWalls(false);
    const sx = minus >= plus ? -1 : 1;
    const frame = { used: Math.max(minus, plus), other: Math.min(minus, plus) };
    // the flown footprint of the walls: a legacy (flipped) grid answers (x, y, z) from its stored (-x, -y, z)
    const gb = w.meta.gridBounds;
    const wx = w.flip ? -1 : 1;
    const xA = [wx * gb.min[0], wx * gb.max[0]].sort((p, q) => p - q), zA = [gb.min[2], gb.max[2]];
    const tileM = Math.min(3, Math.max(0.2, Math.max(xA[1]! - xA[0]!, zA[1]! - zA[0]!) / 100));
    const nx = Math.ceil((xA[1]! - xA[0]!) / tileM), nz = Math.ceil((zA[1]! - zA[0]!) / tileM);
    const raw = new Float64Array(nx * nz), cnt = new Float64Array(nx * nz);
    const fx: number[] = [], fz: number[] = [];
    for (let i = 0; i < xs.length; i++) {
        const x = sx * xs[i]!, z = zs[i]!;
        if (i % 1000 === 0) { fx.push(x); fz.push(z); }
        const tx = Math.floor((x - xA[0]!) / tileM), tz = Math.floor((z - zA[0]!) / tileM);
        if (tx < 0 || tz < 0 || tx >= nx || tz >= nz) continue;
        const o = op[i]!;
        raw[tz * nx + tx] += logit ? 1 / (1 + Math.exp(-o)) : o;
        cnt[tz * nx + tx]++;
    }
    const mass = new Array<number>(nx * nz).fill(0), count = new Array<number>(nx * nz).fill(0);
    for (let tz = 0; tz < nz; tz++) for (let tx = 0; tx < nx; tx++) {
        let m = 0, k = 0;
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
            const u = tx + dx, v = tz + dz;
            if (u >= 0 && v >= 0 && u < nx && v < nz) { m += raw[v * nx + u]!; k += cnt[v * nx + u]!; }
        }
        mass[tz * nx + tx] = Math.round(m * 100) / 100;
        count[tz * nx + tx] = k;
    }
    const filled = mass.filter((_, i) => cnt[i]! > 0).sort((p, q) => p - q);
    const pct = (a: number[], q: number): number => { const s = [...a].sort((p, r) => p - r); return r2(s[Math.floor(q * (s.length - 1))]!); };
    const d: Density = { id, x0: xA[0]!, z0: zA[0]!, tileM, nx, nz, mass, count, median: filled[Math.floor(filled.length / 2)] ?? 0, splats: xs.length, level, url: c.url, bboxP01: [pct(fx, 0.01), pct(fz, 0.01)], bboxP99: [pct(fx, 0.99), pct(fz, 0.99)], frame };
    writeFileSync(file, JSON.stringify(d));
    return d;
}

function massAt(d: Density, p: readonly number[]): number {
    const tx = Math.floor((p[0]! - d.x0) / d.tileM), tz = Math.floor((p[2]! - d.z0) / d.tileM);
    return tx >= 0 && tz >= 0 && tx < d.nx && tz < d.nz ? d.mass[tz * d.nx + tx]! : 0;
}
/** share of scanned tiles (any splat) whose mass is below this point's: 0 the poorest, 1 the richest */
function rankAt(d: Density, sorted: number[], p: readonly number[]): number {
    const m = massAt(d, p);
    let lo = 0, hi = sorted.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid]! < m) lo = mid + 1; else hi = mid; }
    return sorted.length ? lo / sorted.length : 0;
}

// ---------------------------------------------------------------------------------------------------------- picture

function png(wd: number, ht: number, rgb: Uint8Array): Buffer {
    const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
    const crc = (b: Buffer): number => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255]! ^ (c >>> 8); return (c ^ -1) >>> 0; };
    const chunk = (type: string, data: Buffer): Buffer => {
        const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
        const td = Buffer.concat([Buffer.from(type), data]);
        const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
        return Buffer.concat([len, td, c]);
    };
    const raw = Buffer.alloc((wd * 3 + 1) * ht);
    for (let y = 0; y < ht; y++) { raw[y * (wd * 3 + 1)] = 0; Buffer.from(rgb.buffer, rgb.byteOffset + y * wd * 3, wd * 3).copy(raw, y * (wd * 3 + 1) + 1); }
    const ih = Buffer.alloc(13); ih.writeUInt32BE(wd, 0); ih.writeUInt32BE(ht, 4); ih[8] = 8; ih[9] = 2;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const COLORS: Record<string, V3> = { beginner: [40, 220, 60], medium: [250, 220, 30], pro: [240, 40, 40], old: [255, 140, 0] };

/** one panel per code version, side by side: the density map (grey, green tint = good), gates, start, camera, core */
function picture(d: Density, sorted: number[], heads: Record<string, Record<string, unknown>>, rows: Record<string, Record<string, unknown>[]>, file: string): void {
    const P = 520, scale = P / Math.max(d.nx, d.nz), pw = Math.ceil(d.nx * scale), ph = Math.ceil(d.nz * scale);
    const versions = Object.keys(rows), W = pw * versions.length + 10 * (versions.length - 1), H = ph;
    const img = new Uint8Array(W * H * 3);
    const top = sorted[Math.floor(0.99 * (sorted.length - 1))] || 1;
    const dot = (x0: number, cx: number, cy: number, r: number, c: V3, ring = false): void => {
        for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y++) for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++) {
            if (x < 0 || y < 0 || x >= pw || y >= H) continue;
            const e = Math.hypot(x - cx, y - cy);
            if (ring ? Math.abs(e - r) <= 1 : e <= r) { const o = (y * W + x0 + x) * 3; img[o] = c[0]; img[o + 1] = c[1]; img[o + 2] = c[2]; }
        }
    };
    versions.forEach((v, k) => {
        const x0 = k * (pw + 10);
        for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
            // north up: z grows downwards on the page, x to the right
            const t = Math.min(d.nz - 1, Math.floor(y / scale)) * d.nx + Math.min(d.nx - 1, Math.floor(x / scale));
            const m = d.mass[t]!, g = Math.round(255 * Math.min(1, Math.log1p(m) / Math.log1p(top)));
            const o = (y * W + x0 + x) * 3;
            const good = d.count[t]! > 0 && m >= d.median;
            img[o] = good ? g * 0.7 : g; img[o + 1] = g; img[o + 2] = good ? g * 0.7 : g;
        }
        const at = (p: readonly number[]): [number, number] => [(p[0]! - d.x0) / d.tileM * scale, (p[2]! - d.z0) / d.tileM * scale];
        for (const r of rows[v]!) {
            const gs = (r.gates as V3[]) ?? [], c = COLORS[String(r.level)]!;
            gs.forEach((g, i) => { const [x, y] = at(g); if (i === 0) { dot(x0, x, y, 6, [0, 0, 0]); dot(x0, x, y, 4.5, c); } else dot(x0, x, y, 2.5, c); });
        }
        const h = heads[v]!;
        const [cx, cy] = at(h.cam as V3); dot(x0, cx, cy, 9, [0, 220, 255], true); dot(x0, cx, cy, 8, [0, 220, 255], true);
        const [sx, sy] = at(h.spawn as V3); dot(x0, sx, sy, 3, [0, 220, 255]);
        const core = (heads.live ?? h).core as V3; const [kx, ky] = at(core);
        dot(x0, kx, ky, 11, [255, 0, 255], true); dot(x0, kx, ky, 10, [255, 0, 255], true);
    });
    writeFileSync(file, png(W, H, img));
}

// ------------------------------------------------------------------------------------------------------------ parent

function runChild(id: string, version: string, rowsFile: string, seeds: string, hangMs: number): Promise<void> {
    return new Promise((resolve) => {
        const doneKeys = (): Set<string> => new Set(existsSync(rowsFile) ? readFileSync(rowsFile, 'utf8').split('\n').filter(Boolean).map((l) => { const j = JSON.parse(l); return j.head ? 'head' : j.key; }) : []);
        const start = (): void => {
            const skip = [...doneKeys()].join(',') || 'none';
            const p = spawnProc(process.execPath, [...process.execArgv, '--max-old-space-size=8192', process.argv[1]!, '--child', id, version, '--skip', skip, '--seeds', seeds, '--rows', rowsFile], { stdio: ['ignore', 'pipe', 'pipe'] });
            let current = '', timer: NodeJS.Timeout | null = null, killed = false;
            const arm = (): void => { if (timer) clearTimeout(timer); timer = setTimeout(() => { killed = true; p.kill(); }, hangMs); };
            arm();
            p.stdout.on('data', (b: Buffer) => { for (const l of b.toString().split('\n')) { const m = /^BEGIN (\S+)/.exec(l); if (m) { current = m[1]!; arm(); } if (l.trim()) console.log(`[${id} ${version}] ${l.trim()}`); } });
            p.stderr.on('data', (b: Buffer) => console.error(`[${id} ${version}] ERR ${b.toString().trim().slice(0, 400)}`));
            p.on('exit', (code) => {
                if (timer) clearTimeout(timer);
                if (killed && current) {
                    appendFileSync(rowsFile, JSON.stringify({ key: current, hang: true, ok: false, seconds: hangMs / 1000, gates: [], level: current.split('-')[0], spread: current.split('-')[1] }) + '\n');
                    console.log(`[${id} ${version}] HANG ${current}`);
                    start();
                } else {
                    if (code) console.log(`[${id} ${version}] exit ${code}`);
                    resolve();
                }
            });
        };
        start();
    });
}

async function parent(): Promise<void> {
    const outDir = arg('--out') ?? 'U:/Temp/gsfpv-train4/w1-diag';
    const ids = arg('--scenes')?.split(',') ?? Object.keys(SET);
    const versions = (arg('--versions') ?? 'live,old').split(',');
    const seeds = arg('--seeds') ?? '1,2,3';
    const hangMs = Number(arg('--hang-ms') ?? 150_000);
    mkdirSync(outDir, { recursive: true });
    const work: Promise<void>[] = [];
    if (!process.argv.includes('--report-only'))
        for (const id of ids) for (const v of versions) work.push(runChild(id, v, join(outDir, `rows-${id}-${v}.jsonl`), seeds, hangMs));
    await Promise.all(work);
    // the report: per course one line of the table; per scan one picture
    const table: string[] = ['scan\tkind\tversion\tlevel\tspread\tseed\tok\tgates\tgoodShare\tmeanRank\tgate1ToStartM\tgate1ToCamM\tgate1ToCoreM\tgatesInWalls\tlegsInWalls\tseconds\tnote'];
    const summary: Record<string, unknown>[] = [];
    for (const id of ids) {
        const w = await openWalls(id);
        const d = await densityMap(id, w, outDir);
        const sorted = d.mass.filter((_, i) => d.count[i]! > 0).sort((p, q) => p - q);
        const heads: Record<string, Record<string, unknown>> = {}, rows: Record<string, Record<string, unknown>[]> = {};
        for (const v of versions) {
            const f = join(outDir, `rows-${id}-${v}.jsonl`);
            if (!existsSync(f)) continue;
            const lines = readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
            heads[v] = lines.find((l) => l.head)!;
            rows[v] = lines.filter((l) => !l.head);
        }
        for (const v of Object.keys(rows)) {
            const h = heads[v]!;
            let good = 0, all = 0, rankSum = 0, refusals = 0, hangs = 0, inW = 0, legW = 0, secs = 0;
            const g1Start: number[] = [], g1Core: number[] = [];
            for (const r of rows[v]!) {
                const gs = (r.gates as V3[]) ?? [];
                const ranks = gs.map((g) => rankAt(d, sorted, g));
                const gd = gs.filter((g) => massAt(d, g) >= d.median).length;
                good += gd; all += gs.length; rankSum += ranks.reduce((p, q) => p + q, 0);
                if (r.hang) hangs++; else if (!r.ok) refusals++;
                inW += Number(r.gatesIn ?? 0); legW += Number(r.legsIn ?? 0); secs += Number(r.seconds ?? 0);
                const g1 = gs[0];
                if (g1) { g1Start.push(dist(g1, h.spawn as V3)); g1Core.push(dist(g1, (heads.live ?? h).core as V3)); }
                table.push([id, SET[id] ?? '', v, r.level, r.spread, r.seed ?? '', r.hang ? 'HANG' : r.ok ? 'ok' : 'REFUSED', gs.length, gs.length ? r2(gd / gs.length) : '', gs.length ? r2(ranks.reduce((p, q) => p + q, 0) / gs.length) : '', g1 ? r2(dist(g1, h.spawn as V3)) : '', g1 ? r2(dist(g1, h.cam as V3)) : '', g1 ? r2(dist(g1, (heads.live ?? h).core as V3)) : '', r.gatesIn ?? '', r.legsIn ?? '', r.seconds, r.note ?? ''].join('\t'));
            }
            const med = (a: number[]): number | null => (a.length ? r2([...a].sort((p, q) => p - q)[Math.floor(a.length / 2)]!) : null);
            summary.push({ id, scan: SET[id], kind: h.kind, version: v, courses: rows[v]!.length, refusals, hangs, gates: all, goodShare: all ? r2(good / all) : null, meanRank: all ? r2(rankSum / all) : null, medGate1ToStartM: med(g1Start), medGate1ToCoreM: med(g1Core), gatesInWalls: inW, legsInWalls: legW, seconds: r2(secs), spawnRank: r2(rankAt(d, sorted, h.spawn as V3)), coreRank: r2(rankAt(d, sorted, (heads.live ?? h).core as V3)), startToCoreM: r2(dist(h.spawn as V3, (heads.live ?? h).core as V3)) });
        }
        if (Object.keys(rows).length) picture(d, sorted, heads, rows, join(outDir, `top-${id}.png`));
        console.log(`${id} density: ${d.splats} splats${d.level !== null ? ` (LOD ${d.level})` : ''}, tile ${r2(d.tileM)} m, ${d.nx}x${d.nz}, median ${d.median}; splat x/z p1 ${d.bboxP01} p99 ${d.bboxP99}; walls ${JSON.stringify(w.meta.gridBounds)} flip ${w.flip}; opaque splats on walls: mapping used ${d.frame.used}, other ${d.frame.other}`);
    }
    writeFileSync(join(outDir, 'table.tsv'), table.join('\n') + '\n');
    writeFileSync(join(outDir, 'summary.json'), JSON.stringify({ what: 'w1-diag S2: gates against an independent splat density (opacity mass per tile column, 3x3 tiles, good = at least the median of scanned tiles); live planCourse vs the 2026-11-16 generator', summary }, null, 1));
    for (const s of summary) console.log(JSON.stringify(s));
}

if (process.argv.includes('--child')) {
    const i = process.argv.indexOf('--child');
    const skip = new Set((arg('--skip') ?? '').split(','));
    void child(process.argv[i + 1]!, process.argv[i + 2] as 'live' | 'old' | 'neg', arg('--rows')!, skip, (arg('--seeds') ?? '1,2,3').split(',').map(Number)).then(() => process.exit(0), (e) => { console.error(String(e?.stack ?? e)); process.exit(2); });
} else void parent();
