// Lane vox4 (voxux4 V-2b): what per-vertex ambient occlusion adds to the worker's time per chunk, on baked walls.
// Meshes the `n` occupied chunks nearest a point at levels 0 and 1 and times overlayChunk alone against
// chunkAo after it. Usage: npx tsx tools/bench/scripts/vox4-ao-cost.ts <walls dir with scene.voxel.json> <x> <y> <z> [n=150]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openVoxelCollision, blockComponents, occupiedChunks, overlayChunkSize, chunkDims, chunkOfKey, overlayChunk } from '@gsfpv/collision';
import { chunkAo } from '../../../apps/fly/src/voxel-ao';

const [dir, xs, ys, zs, ns = '150'] = process.argv.slice(2);
const p = [xs, ys, zs].map(Number);
const meta = JSON.parse(readFileSync(join(dir, 'scene.voxel.json'), 'utf8'));
const col = openVoxelCollision(meta, readFileSync(join(dir, 'scene.voxel.bin')));
const size = overlayChunkSize(col.voxelResolution);
const comp = blockComponents(col);
const dims = chunkDims(col, size);
const edge = size * col.voxelResolution;
const centre = (k: number): number[] => chunkOfKey(dims, k).map((c, ax) => {
    const g = [col.gridMinX, col.gridMinY, col.gridMinZ][ax] + (c + 0.5) * edge;
    return col.flipXY && ax < 2 ? -g : g;
});
const keys = Array.from(occupiedChunks(col, comp, size))
    .map((k) => ({ k, d: Math.hypot(...centre(k).map((c, ax) => c - p[ax])) }))
    .sort((a, b) => a.d - b.d).slice(0, Number(ns)).map((e) => e.k);
const out: Record<string, unknown> = { chunks: keys.length, size };
for (const lod of [0, 1]) {
    let mesh = 0, ao = 0, quads = 0, shaded = 0, verts = 0;
    for (const k of keys) {
        const [x, y, z] = chunkOfKey(dims, k);
        const t0 = performance.now();
        const c = overlayChunk(col, { x, y, z }, size, lod, comp);
        const t1 = performance.now();
        const a = chunkAo(col, { x, y, z }, size, c, lod)!;
        ao += performance.now() - t1;
        mesh += t1 - t0;
        quads += c.quads;
        verts += a.length;
        for (const v of a) if (v) shaded++;
    }
    out[`lod${lod}`] = { meshMs: +mesh.toFixed(1), aoMs: +ao.toFixed(1), addedPct: Math.round((100 * ao) / mesh), quads, shadedVertexPct: Math.round((100 * shaded) / Math.max(1, verts)) };
}
console.log(JSON.stringify(out));
