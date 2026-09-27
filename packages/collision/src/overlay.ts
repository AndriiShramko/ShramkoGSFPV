// Pure helpers behind the voxel overlay (design G, item 24): which chunks to mesh around the
// camera and at which level of detail, which pieces are "floating", and the vertex data the
// renderer draws (positions, normals, grid UVs, a floater flag per quad). No DOM: safe in a worker.
//
// Two levels of detail keep the frame rate with fine grids: a 3.2 cm scan has about 10 M exposed
// faces within 20 m of the spawn (7a475d38, measured), so the nearest chunks are meshed per voxel
// until a face budget is spent and the rest of the radius per 4x4x4 block (16 times fewer faces).

import type { VoxelCollision } from './vendor/voxel-collision';
import type { BlockComponents } from './components';
import { buildChunkBlockFaces, buildChunkFaces, chunkDims } from './mesh';

/** A connected piece smaller than this (block volume, m³) and not the largest one is painted as a floater. */
export const FLOATER_M3 = 0.5;

/** Chunk edge in voxels for a voxel size: about 2.4 m, a multiple of 4, from 32 to 128 voxels. */
export function overlayChunkSize(res: number): number {
    if (!(res > 0)) throw new RangeError(`voxel size must be positive, got ${res}`);
    return Math.max(32, Math.min(128, 4 * Math.round(2.4 / res / 4)));
}

/** Key of chunk (x, y, z) in a grid of `dims` chunks: x fastest. */
export function chunkKey(dims: readonly number[], x: number, y: number, z: number): number {
    return (z * dims[1] + y) * dims[0] + x;
}

export function chunkOfKey(dims: readonly number[], key: number): [number, number, number] {
    const x = key % dims[0], r = (key - x) / dims[0], y = r % dims[1];
    return [x, y, (r - y) / dims[1]];
}

/** Keys of the chunks (of `size` voxels) holding at least one occupied block, ascending. */
export function occupiedChunks(col: VoxelCollision, comp: BlockComponents, size: number): Int32Array {
    if (size % 4 !== 0) throw new RangeError(`chunk size must be a multiple of 4, got ${size}`);
    const dims = chunkDims(col, size);
    if (dims[0] * dims[1] * dims[2] >= 2 ** 31) throw new RangeError('voxel grid has too many chunks for 32-bit keys');
    const cs = size / 4;
    const [nbx, nby] = comp.dims;
    const seen = new Set<number>();
    const keys = comp.keys;
    for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        const bx = k % nbx, r = (k - bx) / nbx, by = r % nby, bz = (r - by) / nby;
        seen.add(chunkKey(dims, Math.floor(bx / cs), Math.floor(by / cs), Math.floor(bz / cs)));
    }
    return Int32Array.from(seen).sort();
}

/** Per component id: 1 when it is a floater (smaller than maxM3 and not the largest piece). */
export function floaterComponents(comp: BlockComponents, res: number, maxM3 = FLOATER_M3): Uint8Array {
    const out = new Uint8Array(comp.count);
    const blockM3 = (4 * res) ** 3;
    let big = -1;
    for (let i = 0; i < comp.count; i++) if (big < 0 || comp.sizes[i] > comp.sizes[big]) big = i;
    for (let i = 0; i < comp.count; i++) if (i !== big && comp.sizes[i] * blockM3 < maxM3) out[i] = 1;
    return out;
}

/** One chunk as the renderer takes it. */
export interface OverlayChunk {
    positions: Float32Array;
    normals: Float32Array;
    /** Per vertex, in cells of the level (voxels at lod 0, blocks at lod 1): a repeating grid texture draws each cell's edges. */
    uvs: Float32Array;
    indices: Uint32Array;
    /** Per quad: 1 when it belongs to a floater. */
    floater: Uint8Array;
    quads: number;
    /** Exposed cell faces before merging into quads. */
    faces: number;
    floaterQuads: number;
}

/**
 * Mesh chunk (x, y, z) of `size` voxels at level 0 (voxels) or 1 (blocks), with grid UVs and the
 * floater flag per quad (`floaters` from floaterComponents of the same `comp`).
 */
export function overlayChunk(col: VoxelCollision, chunk: { x: number; y: number; z: number }, size: number, lod: 0 | 1, comp?: BlockComponents, floaters?: Uint8Array): OverlayChunk {
    // level 1 chunks are closed at their borders: next to a level 0 chunk they leave no crack
    const m = lod === 0 ? buildChunkFaces(col, chunk, size, comp ? { components: comp } : {}) : buildChunkBlockFaces(col, chunk, size, { ...(comp ? { components: comp } : {}), closedBorder: true });
    const quads = m.indices.length / 6;
    const nv = quads * 4;
    const normals = new Float32Array(nv * 3);
    for (let i = 0; i < nv * 3; i++) normals[i] = m.normals[i];
    const cell = col.voxelResolution * (lod === 0 ? 1 : 4);
    const flip = col.flipXY;
    // world coordinates of the grid's corner: cell edges sit at whole numbers of cells from it
    const origin = [flip ? -col.gridMinX : col.gridMinX, flip ? -col.gridMinY : col.gridMinY, col.gridMinZ];
    const uvs = new Float32Array(nv * 2);
    const p = m.positions;
    for (let v = 0; v < nv; v++) {
        const n = m.normals[v * 3] !== 0 ? 0 : m.normals[v * 3 + 1] !== 0 ? 1 : 2;
        const a = n === 0 ? 2 : 0, b = n === 1 ? 2 : 1;
        uvs[v * 2] = (p[v * 3 + a] - origin[a]) / cell;
        uvs[v * 2 + 1] = (p[v * 3 + b] - origin[b]) / cell;
    }
    const floater = new Uint8Array(quads);
    let floaterQuads = 0;
    if (m.component && floaters) {
        for (let k = 0; k < quads; k++) {
            if (floaters[m.component[k * 4]] === 1) { floater[k] = 1; floaterQuads++; }
        }
    }
    return { positions: m.positions, normals, uvs, indices: m.indices, floater, quads, faces: m.faces, floaterQuads };
}

export interface PlanOptions {
    /** metres around the camera */
    radius: number;
    /** quads at level 0 (voxels) nearest first, then level 1 (blocks) up to its own budget */
    fineQuads: number;
    coarseQuads: number;
    /** quads of a chunk already meshed at a level (key -> quads), else the running average is assumed */
    known?: { fine: ReadonlyMap<number, number>; coarse: ReadonlyMap<number, number> };
    avgFine?: number;
    avgCoarse?: number;
}

export interface PlannedChunk { key: number; x: number; y: number; z: number; lod: 0 | 1; dist: number }

export interface ChunkPlan {
    chunks: PlannedChunk[];
    /** distance to the farthest chunk at level 0, and at any level (m) */
    fineRadius: number;
    radius: number;
    fineQuads: number;
    coarseQuads: number;
}

/**
 * The chunks to draw around a world point, nearest first: level 0 while its budget lasts, then
 * level 1 while that budget lasts, never beyond `radius` (distance to the chunk's box).
 * `occupied` holds the keys of occupiedChunks.
 */
export function planChunks(col: VoxelCollision, size: number, occupied: ReadonlySet<number>, x: number, y: number, z: number, o: PlanOptions): ChunkPlan {
    const dims = chunkDims(col, size);
    const res = col.voxelResolution;
    const cm = size * res;
    // file space (format 1.0 flips x and y; distances are the same either way)
    const px = col.flipXY ? -x : x, py = col.flipXY ? -y : y, pz = z;
    const g = [col.gridMinX, col.gridMinY, col.gridMinZ];
    const c = [Math.floor((px - g[0]) / cm), Math.floor((py - g[1]) / cm), Math.floor((pz - g[2]) / cm)];
    const reach = Math.ceil(o.radius / cm) + 1;
    const found: PlannedChunk[] = [];
    const dist1 = (p: number, lo: number): number => (p < lo ? lo - p : p > lo + cm ? p - lo - cm : 0);
    const lo = [Math.max(0, c[0] - reach), Math.max(0, c[1] - reach), Math.max(0, c[2] - reach)];
    const hi = [Math.min(dims[0] - 1, c[0] + reach), Math.min(dims[1] - 1, c[1] + reach), Math.min(dims[2] - 1, c[2] + reach)];
    const cube = Math.max(0, hi[0] - lo[0] + 1) * Math.max(0, hi[1] - lo[1] + 1) * Math.max(0, hi[2] - lo[2] + 1);
    if (cube > occupied.size) {
        // a wide radius over a sparse grid: fewer occupied chunks than cells in the box, so walk those
        for (const key of occupied) {
            const [cx, cy, cz] = chunkOfKey(dims, key);
            const d = Math.hypot(dist1(px, g[0] + cx * cm), dist1(py, g[1] + cy * cm), dist1(pz, g[2] + cz * cm));
            if (d <= o.radius) found.push({ key, x: cx, y: cy, z: cz, lod: 0, dist: d });
        }
    } else {
        for (let cz = lo[2]; cz <= hi[2]; cz++) {
            const dz = dist1(pz, g[2] + cz * cm);
            if (dz > o.radius) continue;
            for (let cy = lo[1]; cy <= hi[1]; cy++) {
                const dy = dist1(py, g[1] + cy * cm);
                if (Math.hypot(dy, dz) > o.radius) continue;
                for (let cx = lo[0]; cx <= hi[0]; cx++) {
                    const key = chunkKey(dims, cx, cy, cz);
                    if (!occupied.has(key)) continue;
                    const d = Math.hypot(dist1(px, g[0] + cx * cm), dy, dz);
                    if (d > o.radius) continue;
                    found.push({ key, x: cx, y: cy, z: cz, lod: 0, dist: d });
                }
            }
        }
    }
    found.sort((a, b) => a.dist - b.dist || a.key - b.key);
    const avgF = o.avgFine ?? 1500, avgC = o.avgCoarse ?? 150;
    let fine = 0, coarse = 0, fineR = 0, allR = 0;
    let fineOpen = true;
    const out: PlannedChunk[] = [];
    for (const ch of found) {
        if (fineOpen) {
            const q = o.known?.fine.get(ch.key) ?? avgF;
            if (fine + q <= o.fineQuads) {
                fine += q;
                out.push(ch);
                fineR = allR = ch.dist;
                continue;
            }
            fineOpen = false; // nearest first: once a chunk goes coarse, every farther one does too
        }
        const q = o.known?.coarse.get(ch.key) ?? avgC;
        if (coarse + q > o.coarseQuads) break;
        coarse += q;
        out.push({ ...ch, lod: 1 });
        allR = ch.dist;
    }
    return { chunks: out, fineRadius: fineR, radius: allR, fineQuads: fine, coarseQuads: coarse };
}

/**
 * planChunks, with the radius doubled (up to maxRadius) while it finds nothing: a camera high
 * above an aerial scan (723068d7 starts 42 m over the ground) still sees the nearest walls. The
 * budgets are the same, so a wider radius never draws more faces.
 */
export function planChunksAround(col: VoxelCollision, size: number, occupied: ReadonlySet<number>, x: number, y: number, z: number, o: PlanOptions, maxRadius = 160): ChunkPlan & { searchRadius: number } {
    let r = o.radius;
    for (;;) {
        const plan = planChunks(col, size, occupied, x, y, z, { ...o, radius: r });
        if (plan.chunks.length > 0 || r >= maxRadius) return { ...plan, searchRadius: r };
        r = Math.min(maxRadius, r * 2);
    }
}
