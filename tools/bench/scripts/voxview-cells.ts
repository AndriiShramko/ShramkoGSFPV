// Measure what a walls file holds against what the voxel view can draw (lane voxview, X2):
// solid voxels, solid 4x4x4 blocks, occupied overlay chunks, the grid's extent, and the quads of
// the whole scene at every coarse level of the overlay (cells of 4, 8, 16, 32 voxels), with the
// worker time per level. Usage: npx tsx tools/bench/scripts/voxview-cells.ts <walls dir with scene.voxel.json>
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openVoxelCollision, countSolidVoxelsFromBytes, blockComponents, occupiedChunks, overlayChunkSize, chunkOfKey, chunkDims, overlayChunk, planChunks, COARSE_LEVELS, FAR_GROUP } from '@gsfpv/collision';

const dir = process.argv[2];
const json = readFileSync(join(dir, 'scene.voxel.json'));
const bin = readFileSync(join(dir, 'scene.voxel.bin'));
const meta = JSON.parse(json.toString('utf8'));
const col = openVoxelCollision(meta, bin);
const res = col.voxelResolution;
const size = overlayChunkSize(res);
const t0 = performance.now();
const comp = blockComponents(col);
const occ = occupiedChunks(col, comp, size);
const dims = chunkDims(col, size);
const out: Record<string, unknown> = {
    dir, voxelCm: Math.round(res * 1000) / 10, voxels: [col.numVoxelsX, col.numVoxelsY, col.numVoxelsZ],
    extentM: [col.numVoxelsX * res, col.numVoxelsY * res, col.numVoxelsZ * res].map((v) => Math.round(v)),
    solidVoxels: countSolidVoxelsFromBytes(json, bin), solidBlocks: comp.keys.length, chunkVoxels: size,
    chunkDims: dims, occupiedChunks: occ.length, componentsMs: Math.round(performance.now() - t0)
};
const levels: Record<string, unknown> = {};
for (const lod of process.argv.includes('--plan') ? [] : [1, ...COARSE_LEVELS.map((_, i) => i + 2)] as const) {
    const t = performance.now();
    let quads = 0, nonEmpty = 0;
    for (const key of occ) {
        const [x, y, z] = chunkOfKey(dims, key);
        const c = overlayChunk(col, { x, y, z }, size, lod as 1, comp);
        quads += c.quads;
        if (c.quads > 0) nonEmpty++;
    }
    levels[`lod${lod}`] = { quads, nonEmptyChunks: nonEmpty, ms: Math.round(performance.now() - t) };
}
out.levels = levels;
console.log(JSON.stringify(out));

// The whole-scene plan from the grid's centre, 2 m over its floor, with the view's budgets: the
// meshes (draws) it leaves without and with the far groups (overlay.ts FAR_GROUP).
if (process.argv.includes('--plan')) {
    const occSet = new Set<number>(occ);
    const cx = col.gridMinX + (col.numVoxelsX * res) / 2, cy = col.gridMinY + 2, cz = col.gridMinZ + (col.numVoxelsZ * res) / 2;
    const [px, py] = col.flipXY ? [-cx, -cy] : [cx, cy];
    const o = { radius: 20, fineQuads: 600_000, coarseQuads: 250_000, whole: true, farQuads: 250_000 };
    const a = planChunks(col, size, occSet, px, py, cz, o);
    const b = planChunks(col, size, occSet, px, py, cz, { ...o, groups: true });
    const byLevel = (cs: { lod: number }[]): number[] => [0, 1, 2, 3].map((l) => cs.filter((c) => c.lod === l).length);
    console.log(JSON.stringify({ plan: { perLevelChunks: a.perLevel, covered: b.covered, meshesWithout: a.chunks.length, meshesWith: b.chunks.length, meshesByLevel: byLevel(b.chunks), groups: b.chunks.filter((c) => c.group).length, far: FAR_GROUP } }));
}
