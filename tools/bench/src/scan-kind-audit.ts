// Lane gen4a, stage A1: the scan analysis (packages/tracks/src/scan.ts analyzeScan) over the baked walls and the shipped
// walls of the catalogue scans, against the hand labels of scan-kinds.json. One row per scan and Scene size: kind, label,
// the measures the kind rules read, the tiles, the core, the time and a histogram of tile quality. Node only, no browser.
//   npx tsx src/scan-kind-audit.ts [--walls DIR] [--scenes a,b] [--out FILE]
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { blockDims, forEachBlock, openVoxelCollision } from '@gsfpv/collision';
import type { VoxelCollision, VoxelMetadata } from '@gsfpv/collision';
import { KIND_RULES, analyzeScan, flownCollision } from '@gsfpv/tracks';
import type { SceneTransform } from '@gsfpv/tracks';
import { loadScene } from './scenes';

function arg(name: string): string | null {
    const i = process.argv.indexOf(name);
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : null;
}
const r3 = (n: number): number => Math.round(n * 1000) / 1000;

/** the scans read from the CDN as the page does (no baked walls in the release folder) */
const CDN_SCENES = ['5dfeb49b', '7a475d38', '39e63ce9'];
/** the owner flew these enlarged (brief lines 537-540 and 579): audited at x15 too */
const ENLARGED = ['5dfeb49b', 'ab5efa0e'];

function wallsFromDir(dir: string): VoxelCollision {
    const meta = JSON.parse(readFileSync(join(dir, 'scene.voxel.json'), 'utf8')) as VoxelMetadata;
    let bin: Uint8Array = readFileSync(join(dir, 'scene.voxel.bin'));
    if (bin[0] === 0x1f && bin[1] === 0x8b) bin = gunzipSync(bin);
    return openVoxelCollision(meta, bin);
}

/** --profile: per block column the occupied layers, so kind rules are designed from data (median / p90 over columns) */
function profile(walls: VoxelCollision, unitM: number): Record<string, unknown> {
    const [nbx, nby, nbz] = blockDims(walls);
    const W = Math.ceil(nby / 32);
    const bits = new Uint32Array(nbx * nbz * W), vox = new Float64Array(nbx * nbz);
    forEachBlock(walls, [0, 0, 0], [nbx, nby, nbz], (bx, by, bz, lo, hi) => {
        const L = walls.flipXY ? nby - 1 - by : by;
        const c = bz * nbx + bx;
        bits[c * W + (L >> 5)] |= 1 << (L & 31);
        let v = lo >>> 0, n = 0;
        while (v) { v &= v - 1; n++; }
        v = hi >>> 0;
        while (v) { v &= v - 1; n++; }
        vox[c] += n;
    });
    const blockM = 4 * walls.voxelResolution;
    const freeL = Math.max(1, Math.ceil(unitM / blockM));
    const occ: number[] = [], crisp: number[] = [], run: number[] = [], span: number[] = [], fill: number[] = [], upper: number[] = [];
    let cols = 0, ceil = 0, multi = 0;
    for (let c = 0; c < nbx * nbz; c++) {
        if (!vox[c]) continue;
        cols++;
        const on = (L: number): boolean => ((bits[c * W + (L >> 5)]! >>> (L & 31)) & 1) === 1;
        let lo = -1, hi = -1, n = 0;
        for (let L = 0; L < nby; L++) if (on(L)) { if (lo < 0) lo = L; hi = L; n++; }
        let e = lo;
        while (e + 1 < nby && on(e + 1)) e++;
        let gap = 0, hasCeil = false;
        for (let L = e + 1; L <= hi; L++) { if (on(L)) { if (gap >= freeL) hasCeil = true; gap = 0; } else gap++; }
        if (hasCeil) ceil++;
        if (hi > e) multi++;
        occ.push(n); crisp.push(vox[c]! / n); run.push(((e - lo + 1) * blockM) / unitM); span.push(((hi - lo + 1) * blockM) / unitM);
        fill.push(n / (hi - lo + 1)); upper.push((n - (e - lo + 1)) / n);
    }
    if (process.argv.includes('--map')) {
        // 16 x 16 map over the grid: max surface (top of the lowest run) and share of columns with something above a gap
        const M = 16, h = new Float64Array(M * M).fill(-1), mu = new Float64Array(M * M), n = new Float64Array(M * M);
        for (let bz = 0; bz < nbz; bz++) for (let bx = 0; bx < nbx; bx++) {
            const c = bz * nbx + bx;
            if (!vox[c]) continue;
            const on = (L: number): boolean => ((bits[c * W + (L >> 5)]! >>> (L & 31)) & 1) === 1;
            let lo = 0;
            while (!on(lo)) lo++;
            let e = lo, top = lo;
            while (e + 1 < nby && on(e + 1)) e++;
            for (let L = e + 1; L < nby; L++) if (on(L)) top = L;
            const m = Math.floor((bz * M) / nbz) * M + Math.floor(((walls.flipXY ? nbx - 1 - bx : bx) * M) / nbx);
            h[m] = Math.max(h[m]!, e + 1);
            if (top > e) mu[m]++;
            n[m]++;
        }
        const x0 = walls.flipXY ? -(walls.gridMinX + nbx * blockM) : walls.gridMinX;
        console.log(`grid x ${r3(x0)}..${r3(x0 + nbx * blockM)} z ${r3(walls.gridMinZ)}..${r3(walls.gridMinZ + nbz * blockM)} y layers ${nby} block ${blockM}`);
        for (let r = 0; r < M; r++) {
            const row: string[] = [];
            for (let i = 0; i < M; i++) row.push(n[r * M + i] ? `${h[r * M + i]}:${Math.round((100 * mu[r * M + i]!) / n[r * M + i]!)}` : '.');
            console.log(row.join(' '));
        }
    }
    const q = (v: number[], p: number): number => { v.sort((a, b) => a - b); return v.length ? r3(v[Math.min(v.length - 1, Math.floor(v.length * p))]!) : 0; };
    const mp = (v: number[]): string => `${q(v, 0.5)}/${q(v, 0.9)}`;
    return { cols, ceilShare: r3(ceil / cols), multiShare: r3(multi / cols), occ: mp(occ), crisp: mp(crisp), runU: mp(run), spanU: mp(span), fill: mp(fill), upper: mp(upper) };
}

async function main(): Promise<void> {
    const root = arg('--walls') ?? 'U:/Temp/gsfpv-train3/walls/release';
    const out = arg('--out') ?? join(import.meta.dirname, '../../../evidence/2026-11-19/gen4/scan-kinds.json');
    const only = arg('--scenes')?.split(',') ?? null;
    const labels = (JSON.parse(readFileSync(join(import.meta.dirname, 'scan-kinds.json'), 'utf8')) as { scenes: Record<string, { label: string }> }).scenes;
    const baked = existsSync(root) ? readdirSync(root).filter((d) => /^[0-9a-f]{8}$/.test(d)) : [];
    const newest = (id: string): string => {
        const v = readdirSync(join(root, id)).map((d) => /^v(\d+)$/.exec(d)).filter((m): m is RegExpExecArray => !!m).map((m) => Number(m[1]));
        return join(root, id, `v${Math.max(...v)}`);
    };
    const all = [...baked.map((id) => ({ id, dir: newest(id) as string | null })), ...CDN_SCENES.map((id) => ({ id, dir: null as string | null }))];
    const rows: Record<string, unknown>[] = [];
    let match = 0, labelled = 0;
    for (const s of all) {
        if (only && !only.includes(s.id)) continue;
        let base: VoxelCollision;
        try {
            base = s.dir ? wallsFromDir(s.dir) : (await loadScene(s.id)).collision;
        } catch (e) {
            rows.push({ id: s.id, error: String(e) });
            console.log(`${s.id} ERROR ${String(e).slice(0, 120)}`);
            continue;
        }
        for (const scale of ENLARGED.includes(s.id) ? [1, 15] : [1]) {
            const T = [scale, 0, 0, 0] as unknown as SceneTransform;
            const walls = scale === 1 ? base : flownCollision(base, T);
            if (process.argv.includes('--profile')) {
                console.log(`${s.id} x${scale} ${labels[s.id]?.label ?? '-'} v ${walls.voxelResolution} ${JSON.stringify(profile(walls, scale))}`);
                continue;
            }
            const t0 = performance.now();
            const a = analyzeScan(walls, T);
            const ms = Math.round(performance.now() - t0);
            const hist = new Array<number>(10).fill(0);
            for (let t = 0; t < a.quality.length; t++) if (a.footprint[t]) hist[Math.min(9, Math.floor(a.quality[t]! * 10))]!++;
            const label = labels[s.id]?.label ?? null;
            if (label) {
                labelled++;
                if (label === a.kind) match++;
            }
            const m = Object.fromEntries(Object.entries(a.measures).map(([k, v]) => [k, r3(v)]));
            rows.push({ id: s.id, scale, label, kind: a.kind, match: label === a.kind, voxelM: walls.voxelResolution, tileM: r3(a.tileM), tiles: [a.nx, a.nz], extentM: r3(a.extentM), core: a.core.map(r3), coreRadiusM: r3(a.coreRadiusM), ms, measures: m, qualityHist: hist });
            console.log(`${s.id} x${scale} ${label ?? '-'} -> ${a.kind} ${label === a.kind ? 'OK' : 'MISS'} tile ${r3(a.tileM)} ext ${r3(a.extentM)} ${ms} ms ${JSON.stringify(m)}`);
        }
    }
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify({ what: 'gen4a A1 scan-kind-audit: analyzeScan kind against hand labels', rules: KIND_RULES, match, labelled, rows }, null, 1));
    console.log(`MATCH ${match}/${labelled} -> ${out}`);
}

void main();
