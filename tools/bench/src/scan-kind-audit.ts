// Lane gen4a, stage A1: the scan analysis (packages/tracks/src/scan.ts analyzeScan) over the baked walls and the shipped
// walls of the catalogue scans, against the hand labels of scan-kinds.json. One row per scan and Scene size: kind, label,
// the measures the kind rules read, the tiles, the core, the time and a histogram of tile quality. Node only, no browser.
//   npx tsx src/scan-kind-audit.ts [--walls DIR] [--scenes a,b] [--out FILE]
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { openVoxelCollision } from '@gsfpv/collision';
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
