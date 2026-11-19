// Lane vox4 (voxux4 V-2): the whole-scene plan of the voxels-only view from a point, and what it does with the
// column of chunks under that point (3x3 chunks across, every height): level, rank in the feed order (nearest
// first), group mesh, and the faces each level would draw there. Measures H2 / H3 of the design without a page.
// Usage: npx tsx tools/bench/scripts/vox4-plan.ts <walls dir with scene.voxel.json> <x> <y> <z> [share=1,0.125]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openVoxelCollision, blockComponents, occupiedChunks, overlayChunkSize, chunkDims, chunkKey, chunkAt, overlayChunk, planChunks } from '@gsfpv/collision';

const [dir, xs, ys, zs, sharesS = '1,0.125'] = process.argv.slice(2);
const [x, y, z] = [xs, ys, zs].map(Number);
const meta = JSON.parse(readFileSync(join(dir, 'scene.voxel.json'), 'utf8'));
const col = openVoxelCollision(meta, readFileSync(join(dir, 'scene.voxel.bin')));
const size = overlayChunkSize(col.voxelResolution);
const comp = blockComponents(col);
const occ = new Set<number>(occupiedChunks(col, comp, size));
const dims = chunkDims(col, size);
const c = chunkAt(col, x, y, z, size);
const column: { key: number; x: number; y: number; z: number }[] = [];
for (let cz = c.z - 1; cz <= c.z + 1; cz++) for (let cx = c.x - 1; cx <= c.x + 1; cx++) for (let cy = 0; cy < dims[1]; cy++) {
    if (cx < 0 || cz < 0 || cx >= dims[0] || cz >= dims[2]) continue;
    const key = chunkKey(dims, cx, cy, cz);
    if (occ.has(key)) column.push({ key, x: cx, y: cy, z: cz });
}
const out: Record<string, unknown> = { size, dims, camChunk: c, occupied: occ.size, column: column.length };
// the faces of each column chunk per level (0 voxels .. 3 cubes of 16 voxels)
out.columnQuads = column.map((k) => ({ y: k.y, q: [0, 1, 2, 3].map((lod) => overlayChunk(col, k, size, lod, comp).quads) }));
for (const d of sharesS.split(',').map(Number)) {
    const p = planChunks(col, size, occ, x, y, z, { radius: 20, fineQuads: 600_000 * d, coarseQuads: 250_000 * d, whole: true, groups: true, farQuads: 250_000 * d });
    const member = new Map<number, { rank: number; lod: number; group: number; dist: number }>();
    p.chunks.forEach((m, rank) => {
        const g = m.group ?? 1;
        for (const k of column) if (Math.floor(k.x / g) === m.x && Math.floor(k.y / g) === m.y && Math.floor(k.z / g) === m.z && (g > 1 ? m.key < 0 : m.key === k.key)) member.set(k.key, { rank, lod: m.lod, group: g, dist: Math.round(m.dist) });
    });
    out[`share${d}`] = { meshes: p.chunks.length, perLevel: p.perLevel, fineRadius: Math.round(p.fineRadius), column: column.map((k) => ({ y: k.y, ...member.get(k.key) })) };
}
console.log(JSON.stringify(out));
// --map: the columns of chunks around the point, 15 chunks each way: '#' a column with >= 3 wall chunks,
// '+' 1-2, '.' none, '@' the point's own column (row = z, char = x)
if (process.argv.includes('--map')) {
    const n = new Map<number, number>();
    for (const key of occ) { const cx = key % dims[0], cz = Math.floor(key / (dims[0] * dims[1])); n.set(cz * dims[0] + cx, (n.get(cz * dims[0] + cx) ?? 0) + 1); }
    for (let cz = c.z - 15; cz <= c.z + 15; cz++) {
        let row = '';
        for (let cx = c.x - 15; cx <= c.x + 15; cx++) {
            const v = cx < 0 || cz < 0 || cx >= dims[0] || cz >= dims[2] ? -1 : n.get(cz * dims[0] + cx) ?? 0;
            row += cx === c.x && cz === c.z ? '@' : v < 0 ? ' ' : v >= 3 ? '#' : v > 0 ? '+' : '.';
        }
        console.log(row);
    }
}
