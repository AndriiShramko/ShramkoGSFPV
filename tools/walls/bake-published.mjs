#!/usr/bin/env node
// Offline bake of published walls (lane walls, stage W2): walls built once on this PC, for every pilot.
//   node tools/walls/bake-published.mjs <outDir> <id>[,<id>...] [--voxel 0.05] [--level 0]
// For each scan: find its version and format on the CDN, read a coarse level to find the dense core
// (cropBox: a far floater 13 km out makes the voxeliser walk the whole bound), then run the
// splat-transform CLI (Node, WebGPU through Dawn on the GPU of this PC) on the chosen level with that box.
// The output is what SuperSplat ships and what the page exports: <outDir>/<id>/v<N>/scene.voxel.json + .bin.
// <outDir>/manifest.json gets one row per scan (sizes, sha256 of json+bin, seconds, box, kept share).
// A scan that cannot be baked keeps a row with ok:false and the reason; nothing is invented.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ST_DIR = join(ROOT, 'apps/fly/node_modules/@playcanvas/splat-transform');
const CLI = join(ST_DIR, 'bin/cli.mjs');
export const CDN = 'https://d28zzqy0iyovbz.cloudfront.net';
/** share of Gaussians dropped at each end of each axis before the margin (a setting, not measured) */
export const CROP_TAIL = 0.005;
/** margin added on each side, as a share of the core span, plus CROP_PAD_M metres (a setting, not measured) */
export const CROP_MARGIN = 0.15;
export const CROP_PAD_M = 5;
/** The voxeliser puts every Gaussian into one GPU buffer: 16 floats each (splat-transform 3.6.4
 *  GpuVoxelization.FLOATS_PER_GAUSSIAN), and Dawn refuses a buffer over 2147483648 bytes (measured:
 *  Wroclaw 70b50d42 level 0, "Buffer size (2699252224) exceeds the max buffer size limit (2147483648)"). */
export const BYTES_PER_GAUSSIAN = 16 * 4;
export const GPU_BUFFER_MAX = 2147483648;

/** The finest LOD level from `start` whose kept Gaussians fit the voxeliser's buffer (the coarsest level if none does). */
export function levelThatFits(counts, start = 0, kept = 1, max = GPU_BUFFER_MAX) {
    const last = counts.length - 1;
    for (let l = Math.min(start, last); l <= last; l++) {
        if (counts[l] == null || counts[l] * kept * BYTES_PER_GAUSSIAN <= max) return l;
    }
    return last;
}

/** The CLI failed on the Gaussian buffer: a coarser voxel cannot help, a lower LOD level can. */
export function isGaussianBufferError(text) {
    return /uploadAllGaussians|exceeds the max buffer size/.test(text);
}

/** The box around the dense core of a set of positions: per axis the CROP_TAIL quantiles plus a margin. */
export function cropBox(xs, ys, zs, tail = CROP_TAIL, margin = CROP_MARGIN, pad = CROP_PAD_M) {
    const out = [];
    for (const a of [xs, ys, zs]) {
        const s = Float32Array.from(a).sort();
        const n = s.length;
        const lo = s[Math.max(0, Math.floor(n * tail))];
        const hi = s[Math.min(n - 1, Math.ceil(n * (1 - tail)) - 1)];
        const m = (hi - lo) * margin + pad;
        out.push([lo - m, hi + m]);
    }
    return { min: out.map((p) => p[0]), max: out.map((p) => p[1]) };
}

/** share of the positions inside the box */
export function keptShare(xs, ys, zs, box) {
    let k = 0;
    for (let i = 0; i < xs.length; i++) {
        if (xs[i] >= box.min[0] && xs[i] <= box.max[0] && ys[i] >= box.min[1] && ys[i] <= box.max[1] && zs[i] >= box.min[2] && zs[i] <= box.max[2]) k++;
    }
    return xs.length ? k / xs.length : 0;
}

async function findContent(id) {
    for (let v = 1; v <= 8; v++) {
        for (const kind of ['lod-meta', 'meta']) {
            const url = `${CDN}/${id}/v${v}/${kind}.json`;
            const r = await fetch(url, { method: 'HEAD' });
            if (r.ok) {
                // a later version replaces an earlier one: keep looking while v+1 answers
                const next = await fetch(`${CDN}/${id}/v${v + 1}/${kind}.json`, { method: 'HEAD' });
                if (next.ok) break;
                return { v, kind, url };
            }
        }
    }
    return null;
}

async function coarsePositions(url, kind, level) {
    const st = await import(pathToFileURL(join(ST_DIR, 'dist/index.mjs')).href);
    const base = url.slice(0, url.lastIndexOf('/') + 1);
    const file = url.slice(base.length);
    const sources = await st.readFile({ filename: file, inputFormat: kind === 'lod-meta' ? 'lod' : 'sog', fileSystem: new st.UrlReadFileSystem(base) });
    const src = kind === 'lod-meta' ? st.selectLod(sources[0], level) : sources[0];
    const t = await st.materializeToDataTable(src, st.createChunkDataPool(), new Set(['position']));
    for (const s of sources) await s.close();
    const col = (n) => t.getColumnByName(n).data;
    return { xs: col('x'), ys: col('y'), zs: col('z') };
}

function runCli(args, log) {
    const r = spawnSync(process.execPath, ['--max-old-space-size=65536', CLI, ...args], { encoding: 'utf8', maxBuffer: 64 << 20 });
    writeFileSync(log, `${r.stdout ?? ''}\n${r.stderr ?? ''}`);
    return { code: r.status, text: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

async function bakeOne(id, outDir, o) {
    const t0 = Date.now();
    const c = await findContent(id);
    if (!c) return { id, ok: false, reason: 'no lod-meta.json or meta.json on the CDN' };
    const dir = join(outDir, id, `v${c.v}`);
    mkdirSync(dir, { recursive: true });
    const row = { id, v: c.v, kind: c.kind, contentUrl: c.url };
    const args = ['-w', '-g', '0', c.url];
    if (c.kind === 'lod-meta') {
        const meta = await (await fetch(c.url)).json();
        const levels = meta.lodLevels ?? 1;
        const counts = Array.from({ length: levels }, (_, l) => meta.counts?.[l] ?? null);
        // the dense core from a coarse level (every level halves the one above; the shape is the same)
        row.boxFromLevel = Math.min(levels - 1, 4);
        const p = await coarsePositions(c.url, c.kind, row.boxFromLevel);
        const box = cropBox(p.xs, p.ys, p.zs);
        row.box = { min: box.min.map((x) => +x.toFixed(2)), max: box.max.map((x) => +x.toFixed(2)) };
        row.keptShareAtBoxLevel = +keptShare(p.xs, p.ys, p.zs, box).toFixed(5);
        row.levelAsked = Math.min(o.level, levels - 1);
        row.level = levelThatFits(counts, row.levelAsked, row.keptShareAtBoxLevel);
        row.gaussians = counts[row.level];
        row.levels = levels;
        args.push('-B', [...row.box.min, ...row.box.max].join(','));
    }
    // the same ladder as the page: 5 cm, then coarser when the octree format is full;
    // a Gaussian buffer over the GPU limit steps one LOD level down at the same cell size
    const vs = [o.voxel, o.voxel * 2, o.voxel * 4];
    for (let i = 0; i < vs.length;) {
        const v = vs[i];
        const cli = row.level == null ? args : [...args.slice(0, 3), '-L', String(row.level), ...args.slice(3)];
        const r = runCli([...cli, join(dir, 'scene.voxel.json'), '--voxel-size', String(v)], join(dir, `cli-L${row.level ?? 0}-${Math.round(v * 1000)}mm.log`));
        row.voxelM = v;
        if (r.code === 0 && existsSync(join(dir, 'scene.voxel.bin'))) { row.ok = true; break; }
        row.ok = false;
        row.reason = (r.text.split('\n').find((l) => /error|Error/.test(l)) ?? `exit ${r.code}`).trim().slice(0, 300);
        if (isGaussianBufferError(r.text) && row.level != null && row.level < row.levels - 1) { row.level++; row.gaussians = null; continue; }
        if (!/block|octree|exceed/i.test(r.text)) break;
        i++;
    }
    if (row.ok) {
        const json = readFileSync(join(dir, 'scene.voxel.json'));
        const bin = readFileSync(join(dir, 'scene.voxel.bin'));
        row.jsonBytes = json.length;
        row.binBytes = bin.length;
        row.sha256 = createHash('sha256').update(Buffer.concat([json, bin])).digest('hex');
        delete row.reason;
    }
    row.seconds = Math.round((Date.now() - t0) / 1000);
    return row;
}

async function main() {
    const [outDir, ids, ...rest] = process.argv.slice(2);
    if (!outDir || !ids) { console.error('usage: bake-published.mjs <outDir> <id>[,<id>...] [--voxel 0.05] [--level 0]'); process.exit(2); }
    const opt = (k, d) => { const i = rest.indexOf(k); return i >= 0 ? Number(rest[i + 1]) : d; };
    const o = { voxel: opt('--voxel', 0.05), level: opt('--level', 0) };
    mkdirSync(outDir, { recursive: true });
    const mf = join(outDir, 'manifest.json');
    const manifest = existsSync(mf) && statSync(mf).size ? JSON.parse(readFileSync(mf, 'utf8')) : {};
    for (const id of ids.split(',')) {
        let row;
        try { row = await bakeOne(id, outDir, o); } catch (e) { row = { id, ok: false, reason: String(e?.message ?? e).slice(0, 300) }; }
        manifest[id] = row;
        writeFileSync(mf, JSON.stringify(manifest, null, 1));
        console.log(JSON.stringify({ id, ok: row.ok, v: row.v, level: row.level, voxelM: row.voxelM, binBytes: row.binBytes, kept: row.keptShareAtBoxLevel, s: row.seconds, reason: row.reason }));
    }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
