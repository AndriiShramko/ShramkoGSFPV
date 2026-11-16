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
import { blockAboveCut, rowAboveCut } from './ceiling';
import type { CeilingCut } from './ceiling';

/** A connected piece smaller than this (block volume, m³) and not the largest one is painted as a floater. */
export const FLOATER_M3 = 0.5;

/** OverlayChunk.floater's per-quad classes: a wall, a floating piece, a voxel above the collision ceiling (ignored). */
export const QUAD_WALL = 0;
export const QUAD_FLOATER = 1;
export const QUAD_ABOVE_CEILING = 2;

/**
 * The voxel view's far levels (X2): blocks per side of one cube at level 2, 3, ... (level 0 draws
 * voxels, level 1 single 4x4x4 blocks). Level 2 cubes are 8 voxels a side, level 3 cubes 16.
 */
export const COARSE_LEVELS: readonly number[] = [2, 4];

/** The levels a chunk of `size` voxels can be drawn at: 0, 1, then each far level whose cube divides the chunk. */
export function overlayLevels(size: number): number[] {
    const out = [0, 1];
    COARSE_LEVELS.forEach((f, i) => { if ((size / 4) % f === 0) out.push(i + 2); });
    return out;
}

/** Edge of one cube at a level, in voxels. */
export function levelCellVoxels(lod: number): number {
    return lod === 0 ? 1 : lod === 1 ? 4 : 4 * COARSE_LEVELS[lod - 2];
}

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
    /**
     * Per quad, its class: QUAD_WALL, QUAD_FLOATER (a floating piece) or QUAD_ABOVE_CEILING (above the
     * collision ceiling: drawn, but no longer a wall). The name is older than the ceiling.
     */
    floater: Uint8Array;
    quads: number;
    /** Exposed cell faces before merging into quads. */
    faces: number;
    floaterQuads: number;
    /** quads above the collision ceiling */
    aboveQuads: number;
}

/**
 * Mesh chunk (x, y, z) of `size` voxels at level 0 (voxels) or 1 (blocks), with grid UVs and the
 * class per quad: floaters (`floaters` from floaterComponents of the same `comp`), and, with a
 * collision ceiling's `cut` (ceiling.ts ceilingCut), the quads above it; a block the cut passes
 * through stays a wall at level 1.
 */
export function overlayChunk(col: VoxelCollision, chunk: { x: number; y: number; z: number }, size: number, lod: number, comp?: BlockComponents, floaters?: Uint8Array, cut?: CeilingCut | null): OverlayChunk {
    const rows = !!cut;
    // level 1 chunks are closed at their borders: next to a level 0 chunk they leave no crack
    const m = lod === 0 ? buildChunkFaces(col, chunk, size, { ...(comp ? { components: comp } : {}), rows }) : buildChunkBlockFaces(col, chunk, size, { ...(comp ? { components: comp } : {}), closedBorder: true, rows, merge: levelCellVoxels(lod) / 4 });
    const quads = m.indices.length / 6;
    const nv = quads * 4;
    const normals = new Float32Array(nv * 3);
    for (let i = 0; i < nv * 3; i++) normals[i] = m.normals[i];
    if (lod > 1 && !overlayLevels(size).includes(lod)) throw new RangeError(`level ${lod} does not fit a chunk of ${size} voxels`);
    const cell = col.voxelResolution * levelCellVoxels(lod);
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
    let floaterQuads = 0, aboveQuads = 0;
    if (m.component && floaters) {
        for (let k = 0; k < quads; k++) {
            if (floaters[m.component[k * 4]] === 1) { floater[k] = QUAD_FLOATER; floaterQuads++; }
        }
    }
    if (cut && m.rows) {
        // above the ceiling wins: such a piece is no wall at all, floating or not
        for (let k = 0; k < quads; k++) {
            const row = m.rows[k];
            if (lod === 0 ? rowAboveCut(cut, row) : blockAboveCut(cut, row)) {
                if (floater[k] === QUAD_FLOATER) floaterQuads--;
                floater[k] = QUAD_ABOVE_CEILING;
                aboveQuads++;
            }
        }
    }
    return { positions: m.positions, normals, uvs, indices: m.indices, floater, quads, faces: m.faces, floaterQuads, aboveQuads };
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
    /**
     * The whole scene (the view of voxels alone, X2): no radius; past the two budgets every
     * occupied chunk is still planned, at level 2 while `farQuads` lasts and at the coarsest level
     * the chunk size allows after that. Nothing is cut away.
     */
    whole?: boolean;
    farQuads?: number;
    /** with whole: far chunks whose group (FAR_GROUP) is all at the same level are planned as one group mesh */
    groups?: boolean;
    /** quads per chunk at levels 2 and up (lod -> key -> quads) and their running averages (lod -> quads) */
    knownFar?: ReadonlyMap<number, ReadonlyMap<number, number>>;
    avgFar?: ReadonlyMap<number, number>;
}

/**
 * One mesh of the plan: a chunk, or (X2, the whole scene) a group of `group` chunks per side at a
 * far level, drawn as one mesh: then x, y, z count groups, key is groupKey's (negative), dist is
 * its nearest chunk's, farDist its farthest one's and members the occupied chunks it covers.
 */
export interface PlannedChunk { key: number; x: number; y: number; z: number; lod: number; dist: number; group?: number; members?: number; farDist?: number }

export interface ChunkPlan {
    chunks: PlannedChunk[];
    /** distance to the farthest chunk at level 0, and at any level (m) */
    fineRadius: number;
    radius: number;
    fineQuads: number;
    coarseQuads: number;
    /** quads planned at levels 2 and up, and the chunks per level (index = lod) */
    farQuads: number;
    perLevel: number[];
    /** occupied chunks the plan covers (a group counts its members) */
    covered: number;
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
    const radius = o.whole ? Infinity : o.radius;
    const reach = o.whole ? Math.max(dims[0], dims[1], dims[2]) : Math.ceil(o.radius / cm) + 1;
    const found: PlannedChunk[] = [];
    const dist1 = (p: number, lo: number): number => (p < lo ? lo - p : p > lo + cm ? p - lo - cm : 0);
    // the whole scene searches the whole grid: an eye far outside it (140 m over a 31 m scan, voxview2
    // VR-9) would otherwise get an empty box around its own chunk and plan nothing
    const lo = o.whole ? [0, 0, 0] : [Math.max(0, c[0] - reach), Math.max(0, c[1] - reach), Math.max(0, c[2] - reach)];
    const hi = o.whole ? [dims[0] - 1, dims[1] - 1, dims[2] - 1] : [Math.min(dims[0] - 1, c[0] + reach), Math.min(dims[1] - 1, c[1] + reach), Math.min(dims[2] - 1, c[2] + reach)];
    const cube = Math.max(0, hi[0] - lo[0] + 1) * Math.max(0, hi[1] - lo[1] + 1) * Math.max(0, hi[2] - lo[2] + 1);
    if (cube > occupied.size) {
        // a wide radius over a sparse grid: fewer occupied chunks than cells in the box, so walk those
        for (const key of occupied) {
            const [cx, cy, cz] = chunkOfKey(dims, key);
            const d = Math.hypot(dist1(px, g[0] + cx * cm), dist1(py, g[1] + cy * cm), dist1(pz, g[2] + cz * cm));
            if (d <= radius) found.push({ key, x: cx, y: cy, z: cz, lod: 0, dist: d });
        }
    } else {
        for (let cz = lo[2]; cz <= hi[2]; cz++) {
            const dz = dist1(pz, g[2] + cz * cm);
            if (dz > radius) continue;
            for (let cy = lo[1]; cy <= hi[1]; cy++) {
                const dy = dist1(py, g[1] + cy * cm);
                if (Math.hypot(dy, dz) > radius) continue;
                for (let cx = lo[0]; cx <= hi[0]; cx++) {
                    const key = chunkKey(dims, cx, cy, cz);
                    if (!occupied.has(key)) continue;
                    const d = Math.hypot(dist1(px, g[0] + cx * cm), dy, dz);
                    if (d > radius) continue;
                    found.push({ key, x: cx, y: cy, z: cz, lod: 0, dist: d });
                }
            }
        }
    }
    found.sort((a, b) => a.dist - b.dist || a.key - b.key);
    const avgF = o.avgFine ?? 1500, avgC = o.avgCoarse ?? 150;
    let fine = 0, coarse = 0, far = 0, fineR = 0, allR = 0;
    let fineOpen = true, coarseOpen = true, farOpen = true;
    const out: PlannedChunk[] = [];
    const levels = overlayLevels(size);
    const top = levels[levels.length - 1];
    const perLevel = [0, 0, 0, 0];
    const farQ = (lod: number, key: number): number => o.knownFar?.get(lod)?.get(key) ?? o.avgFar?.get(lod) ?? avgC / 4 ** (lod - 1);
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
        if (coarseOpen) {
            const q = o.known?.coarse.get(ch.key) ?? avgC;
            if (coarse + q <= o.coarseQuads) {
                coarse += q;
                out.push({ ...ch, lod: 1 });
                allR = ch.dist;
                continue;
            }
            coarseOpen = false;
        }
        if (!o.whole) break;
        // the whole scene: farther chunks only ever get coarser, and the coarsest level takes all the rest
        let lod = top;
        if (farOpen && top > 2) {
            const q = farQ(2, ch.key);
            if (far + q <= (o.farQuads ?? 0)) { far += q; lod = 2; } else farOpen = false;
        }
        if (lod === top) far += lod > 1 ? farQ(lod, ch.key) : 0;
        out.push({ ...ch, lod });
        allR = ch.dist;
    }
    for (const c of out) perLevel[c.lod]++;
    const covered = out.length;
    return { chunks: o.whole && o.groups ? groupPlan(dims, out) : out, covered, fineRadius: fineR, radius: allR, fineQuads: fine, coarseQuads: coarse, farQuads: far, perLevel };
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

/**
 * Chunks per side of the group meshes a level may join into, largest first (X2): the whole scene
 * is 27236 chunks on Wroclaw 70b50d42, one draw each; a group whose area holds another level falls
 * back to the next smaller side. tools/bench/scripts/voxview-cells.ts --plan counts the meshes the
 * plan leaves (status file, Facts X2).
 */
export const FAR_GROUP: Readonly<Record<number, readonly number[]>> = { 1: [2], 2: [4, 2], 3: [8, 4, 2] };
const GROUP_SIDES = [2, 4, 8];

/** Key of group (x, y, z) of g chunks per side (2, 4 or 8): negative, apart from every chunk key. */
export function groupKey(dims: readonly number[], g: number, x: number, y: number, z: number): number {
    const slot = GROUP_SIDES.indexOf(g);
    if (slot < 0) throw new RangeError(`group side must be 2, 4 or 8, got ${g}`);
    const gd = dims.map((d) => Math.ceil(d / g));
    return -1 - (((z * gd[1] + y) * gd[0] + x) * GROUP_SIDES.length + slot);
}

/** The group a negative key names (null for a chunk key). */
export function groupOfKey(dims: readonly number[], key: number): { g: number; x: number; y: number; z: number } | null {
    if (key >= 0) return null;
    const n = -1 - key, slot = n % GROUP_SIDES.length, g = GROUP_SIDES[slot];
    const gd = dims.map((d) => Math.ceil(d / g));
    const [x, y, z] = chunkOfKey(gd, (n - slot) / GROUP_SIDES.length);
    return { g, x, y, z };
}

/**
 * The keys whose meshes cover some of the same chunks as key at another grain: a chunk's groups,
 * a group's chunks and the groups of the other sides that meet it. A mesh leaves only when the
 * wanted meshes among these are on screen (no hole while a group replaces its chunks).
 */
export function overlapKeys(dims: readonly number[], key: number): number[] {
    const g0 = groupOfKey(dims, key);
    const side = g0 ? g0.g : 1;
    const lo = g0 ? [g0.x * side, g0.y * side, g0.z * side] : chunkOfKey(dims, key);
    const hi = [0, 1, 2].map((a) => Math.min(dims[a], lo[a] + side));
    const out = new Set<number>();
    for (const g of [1, ...GROUP_SIDES]) {
        if (g === side) continue;
        for (let z = Math.floor(lo[2] / g); z * g < hi[2]; z++) for (let y = Math.floor(lo[1] / g); y * g < hi[1]; y++) for (let x = Math.floor(lo[0] / g); x * g < hi[0]; x++) {
            out.add(g === 1 ? chunkKey(dims, x, y, z) : groupKey(dims, g, x, y, z));
        }
    }
    return [...out];
}

/**
 * Join chunks into group meshes (FAR_GROUP): a group of side g is one mesh when every occupied chunk
 * in its area is planned at one level that offers g and at least two of them are not yet in a
 * larger group; any other chunk stays itself. Each chunk is covered once, nearest first.
 */
export function groupPlan(dims: readonly number[], chunks: readonly PlannedChunk[], far: Readonly<Record<number, readonly number[]>> = FAR_GROUP): PlannedChunk[] {
    const keyOf = (c: PlannedChunk, g: number): number => groupKey(dims, g, Math.floor(c.x / g), Math.floor(c.y / g), Math.floor(c.z / g));
    // per side: the levels found in each group's area
    const masks = new Map<number, Map<number, number>>();
    for (const g of GROUP_SIDES) {
        const m = new Map<number, number>();
        for (const c of chunks) { const k = keyOf(c, g); m.set(k, (m.get(k) ?? 0) | (1 << c.lod)); }
        masks.set(g, m);
    }
    const out: PlannedChunk[] = [];
    const joined = new Set<PlannedChunk>();
    for (const [lodS, sides] of Object.entries(far)) {
        const lod = Number(lodS);
        for (const g of sides) {
            const groups = new Map<number, PlannedChunk[]>();
            for (const c of chunks) {
                if (c.lod !== lod || joined.has(c)) continue;
                const k = keyOf(c, g);
                if (masks.get(g)!.get(k) !== 1 << lod) continue;
                const list = groups.get(k);
                if (list) list.push(c); else groups.set(k, [c]);
            }
            for (const [key, members] of groups) {
                if (members.length < 2) continue;
                const f = members[0];
                let dist = Infinity, farDist = 0;
                for (const c of members) { joined.add(c); dist = Math.min(dist, c.dist); farDist = Math.max(farDist, c.dist); }
                out.push({ key, x: Math.floor(f.x / g), y: Math.floor(f.y / g), z: Math.floor(f.z / g), lod, dist, group: g, members: members.length, farDist });
            }
        }
    }
    for (const c of chunks) if (!joined.has(c)) out.push(c);
    out.sort((a, b) => a.dist - b.dist || a.key - b.key);
    return out;
}
