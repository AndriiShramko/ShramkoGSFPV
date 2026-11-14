// Walls lane, stage W1, step 1: how big is every catalogue scan for a wall build? Reads each scan's
// own metadata from the CDN (a few KB each, no scan data), sums the Gaussians of every level of
// detail over the tree and says which gate of apps/fly/src/bake.ts refuses a whole-scene build on
// two devices: this PC (RTX 4090, both buffer limits 2 GiB, Chrome deviceMemory 8) and a laptop GPU
// with 1 GiB buffers. Run: node node_modules/tsx/dist/cli.mjs tools/bench/scripts/walls-scan-sizes.ts [catalog.json] > out.json
import { readFileSync } from 'node:fs';
import { GB_PER_MILLION, GPU_BYTES_PER_GAUSSIAN, maxGaussians, memCapGb } from '../../../apps/fly/src/bake';

const CDN = 'https://d28zzqy0iyovbz.cloudfront.net';
const DEVICES = {
    pc: { limits: { maxBufferSize: 2 ** 31, maxStorageBufferBindingSize: 2 ** 31 }, capGb: memCapGb(8) },
    laptop1GiB: { limits: { maxBufferSize: 2 ** 30, maxStorageBufferBindingSize: 2 ** 30 }, capGb: memCapGb(8) }
};

interface Node { lods?: Record<string, { count?: number; file?: number } | undefined>; children?: Node[]; bound?: { min: number[]; max: number[] } }

function perLevel(tree: Node | undefined, levels: number): number[] {
    const out = new Array(levels).fill(0);
    const stack: Node[] = tree ? [tree] : [];
    while (stack.length) {
        const n = stack.pop()!;
        for (const [k, v] of Object.entries(n.lods ?? {})) if (typeof v?.count === 'number') out[Number(k)] += v.count;
        if (n.children) stack.push(...n.children);
    }
    return out;
}

async function meta(id: string): Promise<{ v: number; kind: 'lod-meta' | 'meta'; m: Record<string, unknown> } | null> {
    for (let v = 1; v <= 6; v++) {
        for (const kind of ['lod-meta', 'meta'] as const) {
            const r = await fetch(`${CDN}/${id}/v${v}/${kind}.json`);
            if (r.ok) return { v, kind, m: (await r.json()) as Record<string, unknown> };
        }
    }
    return null;
}

type Row = { id: string; title: string; collision: boolean; size?: number };
const raw = JSON.parse(readFileSync(process.argv[2] ?? 'U:/Temp/gsfpv-train2/catalog.json', 'utf8')) as Row[] | { scenes: Row[] };
const catalog = Array.isArray(raw) ? raw : raw.scenes;
const rows: Record<string, unknown>[] = [];
for (const s of catalog) {
    const got = await meta(s.id);
    if (!got) { rows.push({ id: s.id, title: s.title, error: 'no metadata' }); continue; }
    const m = got.m as { count?: number; counts?: number[]; lodLevels?: number; tree?: Node; filenames?: string[]; means?: { mins?: number[]; maxs?: number[] } };
    const levels = got.kind === 'lod-meta' ? (m.lodLevels ?? m.counts?.length ?? 1) : 1;
    const byLevel = got.kind === 'lod-meta' ? perLevel(m.tree, levels) : [m.count ?? 0];
    const b = m.tree?.bound;
    const span = b ? b.max.map((x, i) => Math.round(x - b.min[i])) : null;
    const g0 = byLevel[0];
    const gates: Record<string, unknown> = {};
    for (const [name, d] of Object.entries(DEVICES)) {
        const max = maxGaussians(d.limits, d.capGb);
        const gpuMax = Math.floor(d.limits.maxBufferSize / GPU_BYTES_PER_GAUSSIAN);
        const memMax = Math.floor((d.capGb / GB_PER_MILLION) * 1e6);
        const refusedBy = g0 > gpuMax ? 'gpu-buffer' : g0 > memMax ? 'memory' : null;
        const fit = byLevel.findIndex((n) => n > 0 && n <= max);
        gates[name] = { max, refusedBy: g0 > max ? (g0 > memMax ? 'memory' : 'gpu-buffer') : null, firstGate: refusedBy, overBy: g0 > max ? Number((g0 / max).toFixed(2)) : 0, finestLevelThatFits: fit };
    }
    rows.push({ id: s.id, title: s.title, collision: s.collision, catalogMb: s.size ?? null, v: got.v, kind: got.kind, levels, gaussiansByLevel: byLevel, files: m.filenames?.length ?? 1, spanM: span, gates });
}
console.log(JSON.stringify(rows, null, 1));
