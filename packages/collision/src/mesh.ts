// Voxel faces for the overlay (design G.1, research-b 4.2). Pure, no DOM: safe in a worker.
//
// Single isVoxelSolid calls cost about 90 ns each (4.9 s for 64 M), so the chunk is filled by
// walking the octree once per 4x4x4 block and reading the block's 64-bit leaf mask. The walk
// repeats isVoxelSolid's descent exactly, including its two corner cases: a node that is not
// at the last level can still be a mixed leaf (its mask then applies to every block below it),
// and voxels past the grid's voxel counts are empty even when a solid node covers them.

import { VoxelCollision } from './vendor/voxel-collision';
import { componentAt } from './components';
import type { BlockComponents } from './components';

const SOLID = 0xff000000 >>> 0;
const FULL = 0xffffffff >>> 0;

export type BlockVisitor = (bx: number, by: number, bz: number, lo: number, hi: number) => void;

/** True when occupancy comes from the octree arrays, false for analytic worlds that override isVoxelSolid. */
export function usesOctree(col: VoxelCollision): boolean {
    return col.isVoxelSolid === VoxelCollision.prototype.isVoxelSolid;
}

/** Grid size in 4x4x4 blocks (a partial block at the far edge counts). */
export function blockDims(col: VoxelCollision): [number, number, number] {
    return [Math.ceil(col.numVoxelsX / 4), Math.ceil(col.numVoxelsY / 4), Math.ceil(col.numVoxelsZ / 4)];
}

/** Mask of the voxels of a block that lie inside the grid (cx, cy, cz voxels per axis, 1..4). */
function clipMask(cx: number, cy: number, cz: number): [number, number] {
    let lo = 0, hi = 0;
    for (let z = 0; z < cz; z++) for (let y = 0; y < cy; y++) for (let x = 0; x < cx; x++) {
        const bit = z * 16 + y * 4 + x;
        if (bit < 32) lo |= 1 << bit; else hi |= 1 << (bit - 32);
    }
    return [lo >>> 0, hi >>> 0];
}

/**
 * Visit every occupied block with block coordinates in [b0, b1) once, with its 64-bit voxel mask
 * (bit z*16 + y*4 + x, lo word = bits 0..31), clipped to the grid like isVoxelSolid. Order is the
 * octree's, not sorted. Analytic worlds are read voxel by voxel through their own isVoxelSolid.
 */
export function forEachBlock(col: VoxelCollision, b0: readonly number[], b1: readonly number[], cb: BlockVisitor): void {
    const [nbx, nby, nbz] = blockDims(col);
    const x0 = Math.max(0, b0[0]), y0 = Math.max(0, b0[1]), z0 = Math.max(0, b0[2]);
    const x1 = Math.min(nbx, b1[0]), y1 = Math.min(nby, b1[1]), z1 = Math.min(nbz, b1[2]);
    if (x0 >= x1 || y0 >= y1 || z0 >= z1) return;
    const nx = col.numVoxelsX, ny = col.numVoxelsY, nz = col.numVoxelsZ;
    if (!usesOctree(col)) {
        for (let bz = z0; bz < z1; bz++) for (let by = y0; by < y1; by++) for (let bx = x0; bx < x1; bx++) {
            let lo = 0, hi = 0;
            for (let z = 0; z < 4; z++) for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
                if (!col.isVoxelSolid(bx * 4 + x, by * 4 + y, bz * 4 + z)) continue;
                const bit = z * 16 + y * 4 + x;
                if (bit < 32) lo |= 1 << bit; else hi |= 1 << (bit - 32);
            }
            if (lo !== 0 || hi !== 0) cb(bx, by, bz, lo >>> 0, hi >>> 0);
        }
        return;
    }
    const nodes = col.nodes, leaf = col.leafData;
    if (nodes.length === 0) return;
    if (col.leafSize !== 4) throw new Error(`voxel leaf size ${col.leafSize} is not supported (the format uses 4)`);
    const depth = col.treeDepth;
    // isVoxelSolid ignores block bits above the tree depth: a grid wider than the tree is a broken file
    if (Math.max(nbx, nby, nbz) > 2 ** depth) throw new Error(`voxel grid of ${nbx}x${nby}x${nbz} blocks is larger than its octree (depth ${depth})`);
    // last block per axis may be partial
    const px = nx - (nbx - 1) * 4, py = ny - (nby - 1) * 4, pz = nz - (nbz - 1) * 4;
    const emit = (bx: number, by: number, bz: number, lo: number, hi: number): void => {
        if (bx === nbx - 1 || by === nby - 1 || bz === nbz - 1) {
            const [clo, chi] = clipMask(bx === nbx - 1 ? px : 4, by === nby - 1 ? py : 4, bz === nbz - 1 ? pz : 4);
            lo = (lo & clo) >>> 0;
            hi = (hi & chi) >>> 0;
        }
        if (lo !== 0 || hi !== 0) cb(bx, by, bz, lo, hi);
    };
    // explicit stack of (node index, level, block origin); a node at level L spans 2^(L+1) blocks
    const sIdx: number[] = [0], sLvl: number[] = [depth - 1], sX: number[] = [0], sY: number[] = [0], sZ: number[] = [0];
    while (sIdx.length) {
        const idx = sIdx.pop()!, level = sLvl.pop()!, bx = sX.pop()!, by = sY.pop()!, bz = sZ.pop()!;
        const span = 2 ** (level + 1);
        const ax0 = Math.max(x0, bx), ay0 = Math.max(y0, by), az0 = Math.max(z0, bz);
        const ax1 = Math.min(x1, bx + span), ay1 = Math.min(y1, by + span), az1 = Math.min(z1, bz + span);
        if (ax0 >= ax1 || ay0 >= ay1 || az0 >= az1) continue;
        const node = nodes[idx] >>> 0;
        const mask = (node >>> 24) & 0xff;
        if (node === SOLID || mask === 0 || level < 0) {
            const lo = node === SOLID ? FULL : leaf[(node & 0x00ffffff) * 2] >>> 0;
            const hi = node === SOLID ? FULL : leaf[(node & 0x00ffffff) * 2 + 1] >>> 0;
            if (lo === 0 && hi === 0) continue;
            for (let z = az0; z < az1; z++) for (let y = ay0; y < ay1; y++) for (let x = ax0; x < ax1; x++) emit(x, y, z, lo, hi);
            continue;
        }
        const base = node & 0x00ffffff;
        let k = 0;
        for (let bit = 0; bit < 8; bit++) {
            if ((mask & (1 << bit)) === 0) continue;
            sIdx.push(base + k++);
            sLvl.push(level - 1);
            sX.push(bx + ((bit & 1) << level));
            sY.push(by + (((bit >> 1) & 1) << level));
            sZ.push(bz + (((bit >> 2) & 1) << level));
        }
    }
}

/** Faces of one chunk. Positions are world metres of `col` (format 1.0 flip applied), 4 vertices and 6 indices per quad. */
export interface ChunkMesh {
    positions: Float32Array;
    /** Unit outward normal per vertex, world axes. */
    normals: Int8Array;
    /** Two counter-clockwise triangles per quad, seen from the side the normal points to. */
    indices: Uint32Array;
    /** Exposed voxel faces before merging (a solid voxel next to an empty one); quads = indices.length / 6. */
    faces: number;
    /** Component id per vertex (sizes[id] is its size in blocks), only when components were passed. */
    component?: Uint32Array;
}

export interface ChunkOptions {
    /** blockComponents(col) of the same voxel data, to fill ChunkMesh.component. */
    components?: BlockComponents;
    /**
     * buildChunkBlockFaces only: close the chunk at its borders (cells outside it count as empty).
     * A block-level chunk next to a voxel-level one then has no crack: where a block is solid but
     * the voxels facing it across the border are empty, its side is still drawn.
     */
    closedBorder?: boolean;
}

/** The chunk (in units of `size` voxels) holding a world point of `col`. */
export function chunkAt(col: VoxelCollision, x: number, y: number, z: number, size = 32): { x: number; y: number; z: number } {
    const fx = col.flipXY ? -x : x, fy = col.flipXY ? -y : y;
    const res = col.voxelResolution;
    return {
        x: Math.floor(Math.floor((fx - col.gridMinX) / res) / size),
        y: Math.floor(Math.floor((fy - col.gridMinY) / res) / size),
        z: Math.floor(Math.floor((z - col.gridMinZ) / res) / size)
    };
}

/** Number of chunks per axis that cover the grid. */
export function chunkDims(col: VoxelCollision, size = 32): [number, number, number] {
    return [Math.ceil(col.numVoxelsX / size), Math.ceil(col.numVoxelsY / size), Math.ceil(col.numVoxelsZ / size)];
}

// Per face direction (axis, sign): the tangent axes u, v with u x v = normal, so quads come out CCW.
// Runs merge along z for x faces and along x for y and z faces (research-b 4.2's 1-D runs).
const DIRS: readonly { n: number; sg: 1 | -1; u: number; v: number; r: number; q: number }[] = [
    { n: 0, sg: 1, u: 1, v: 2, r: 2, q: 1 },
    { n: 0, sg: -1, u: 2, v: 1, r: 2, q: 1 },
    { n: 1, sg: 1, u: 2, v: 0, r: 0, q: 2 },
    { n: 1, sg: -1, u: 0, v: 2, r: 0, q: 2 },
    { n: 2, sg: 1, u: 0, v: 1, r: 0, q: 1 },
    { n: 2, sg: -1, u: 1, v: 0, r: 0, q: 1 }
];

function checkChunkArgs(col: VoxelCollision, chunk: { x: number; y: number; z: number }, size: number, comp: BlockComponents | undefined): void {
    if (!Number.isInteger(size) || size < 4 || size % 4 !== 0) throw new RangeError(`chunk size must be a multiple of 4, got ${size}`);
    if (![chunk.x, chunk.y, chunk.z].every(Number.isInteger)) throw new RangeError(`chunk coordinates must be integers, got ${JSON.stringify(chunk)}`);
    const bd = blockDims(col);
    if (comp && (comp.dims[0] !== bd[0] || comp.dims[1] !== bd[1] || comp.dims[2] !== bd[2])) throw new Error('components were computed for another voxel grid');
}

function emptyMesh(comp: BlockComponents | undefined): ChunkMesh {
    return { positions: new Float32Array(0), normals: new Int8Array(0), indices: new Uint32Array(0), faces: 0, ...(comp ? { component: new Uint32Array(0) } : {}) };
}

/**
 * Exposed faces of the voxels in chunk (x, y, z), i.e. voxel indices [x*size, (x+1)*size) per
 * axis, merged into 1-D runs. Neighbours across the chunk border are read, so chunks tile with
 * no double or missing faces. size must be a multiple of 4.
 */
export function buildChunkFaces(col: VoxelCollision, chunk: { x: number; y: number; z: number }, size = 32, opts: ChunkOptions = {}): ChunkMesh {
    const comp = opts.components;
    checkChunkArgs(col, chunk, size, comp);
    const o = [chunk.x * size, chunk.y * size, chunk.z * size];
    // occupancy of the chunk plus a one-voxel halo: local index 0 is voxel o - 1
    const E = size + 2;
    const occ = new Uint8Array(E * E * E);
    let solidInside = 0;
    const b0 = [o[0] / 4 - 1, o[1] / 4 - 1, o[2] / 4 - 1];
    const b1 = [(o[0] + size) / 4 + 1, (o[1] + size) / 4 + 1, (o[2] + size) / 4 + 1];
    forEachBlock(col, b0, b1, (bx, by, bz, lo, hi) => {
        for (let w = 0; w < 2; w++) {
            let bits = w === 0 ? lo : hi;
            while (bits !== 0) {
                const low = bits & -bits;
                const bit = 31 - Math.clz32(low) + w * 32;
                bits = (bits ^ low) >>> 0;
                const lx = bx * 4 + (bit & 3) - o[0] + 1, ly = by * 4 + ((bit >> 2) & 3) - o[1] + 1, lz = bz * 4 + (bit >> 4) - o[2] + 1;
                if (lx < 0 || ly < 0 || lz < 0 || lx >= E || ly >= E || lz >= E) continue;
                occ[(lz * E + ly) * E + lx] = 1;
                if (lx > 0 && ly > 0 && lz > 0 && lx <= size && ly <= size && lz <= size) solidInside++;
            }
        }
    });
    if (solidInside === 0) return emptyMesh(comp);
    return facesFromOcc(col, occ, size, o, 1, comp);
}

/**
 * The same chunk one level coarser: every 4x4x4 block with at least one solid voxel becomes one
 * solid cube of 4 voxels a side (the overlay's far level of detail, about 16 times fewer faces for
 * the same surface). `faces` counts exposed block faces; runs merge the same way, and chunks tile
 * like buildChunkFaces's. A block cut by the grid's far edge is a whole cube.
 */
export function buildChunkBlockFaces(col: VoxelCollision, chunk: { x: number; y: number; z: number }, size = 32, opts: ChunkOptions = {}): ChunkMesh {
    const comp = opts.components;
    checkChunkArgs(col, chunk, size, comp);
    const cells = size / 4;
    const o = [chunk.x * cells, chunk.y * cells, chunk.z * cells];
    // occupancy of the chunk's blocks plus a one-block halo: local index 0 is block o - 1
    const E = cells + 2;
    const occ = new Uint8Array(E * E * E);
    let solidInside = 0;
    const closed = !!opts.closedBorder;
    forEachBlock(col, [o[0] - 1, o[1] - 1, o[2] - 1], [o[0] + cells + 1, o[1] + cells + 1, o[2] + cells + 1], (bx, by, bz) => {
        const lx = bx - o[0] + 1, ly = by - o[1] + 1, lz = bz - o[2] + 1;
        if (lx < 0 || ly < 0 || lz < 0 || lx >= E || ly >= E || lz >= E) return;
        const inside = lx > 0 && ly > 0 && lz > 0 && lx <= cells && ly <= cells && lz <= cells;
        if (!inside && closed) return;
        occ[(lz * E + ly) * E + lx] = 1;
        if (inside) solidInside++;
    });
    if (solidInside === 0) return emptyMesh(comp);
    return facesFromOcc(col, occ, cells, o, 4, comp);
}

/**
 * Exposed faces of an occupancy grid of `size` cells per axis plus a one-cell halo (local index 0
 * is cell o - 1), merged into 1-D runs. A cell is `cellVox` voxels a side: 1 (voxels) or 4
 * (blocks). Positions are world metres of `col`.
 */
function facesFromOcc(col: VoxelCollision, occ: Uint8Array, size: number, o: number[], cellVox: 1 | 4, comp: BlockComponents | undefined): ChunkMesh {
    const E = size + 2;
    const stride = [1, E, E * E];
    let faces = 0;
    const runs: number[] = []; // per run: dir, then local (1-based) coords of its solid cells: along n, along q, first and last along r
    const c = [0, 0, 0];
    for (let d = 0; d < 6; d++) {
        const { n, sg, r, q } = DIRS[d];
        const step = sg * stride[n];
        for (let a = 1; a <= size; a++) {
            c[n] = a;
            for (let b = 1; b <= size; b++) {
                c[q] = b;
                let start = -1;
                for (let rr = 1; rr <= size + 1; rr++) {
                    let exposed = false;
                    if (rr <= size) {
                        c[r] = rr;
                        const i = c[0] + c[1] * E + c[2] * E * E;
                        exposed = occ[i] === 1 && occ[i + step] === 0;
                    }
                    if (exposed) {
                        faces++;
                        if (start < 0) start = rr;
                    } else if (start >= 0) {
                        runs.push(d, a, b, start, rr - 1);
                        start = -1;
                    }
                }
            }
        }
    }

    const quads = runs.length / 5;
    const positions = new Float32Array(quads * 12);
    const normals = new Int8Array(quads * 12);
    const indices = new Uint32Array(quads * 6);
    const component = comp ? new Uint32Array(quads * 4) : undefined;
    const flip = col.flipXY;
    const res = col.voxelResolution * cellVox; // cell size in metres
    const toBlock = cellVox === 1 ? 2 : 0; // cell index -> block index
    const gmin = [col.gridMinX, col.gridMinY, col.gridMinZ];
    const lo = [0, 0, 0], du = [0, 0, 0], dv = [0, 0, 0];
    for (let k = 0; k < quads; k++) {
        const { n, sg, u, v, r, q } = DIRS[runs[k * 5]];
        const a = runs[k * 5 + 1], b = runs[k * 5 + 2], r0 = runs[k * 5 + 3], r1 = runs[k * 5 + 4];
        // global voxel indices of the face rectangle's low corner and extents
        lo[n] = o[n] + a - 1 + (sg > 0 ? 1 : 0);
        lo[q] = o[q] + b - 1;
        lo[r] = o[r] + r0 - 1;
        const ext = [0, 0, 0];
        ext[q] = 1;
        ext[r] = r1 - r0 + 1;
        du[0] = du[1] = du[2] = 0; dv[0] = dv[1] = dv[2] = 0;
        du[u] = ext[u];
        dv[v] = ext[v];
        for (let corner = 0; corner < 4; corner++) {
            const cu = corner === 1 || corner === 2 ? 1 : 0, cv = corner >= 2 ? 1 : 0;
            const vi = (k * 4 + corner) * 3;
            for (let ax = 0; ax < 3; ax++) {
                const f = gmin[ax] + (lo[ax] + cu * du[ax] + cv * dv[ax]) * res;
                positions[vi + ax] = flip && ax < 2 ? -f : f;
                normals[vi + ax] = ax === n ? (flip && ax < 2 ? -sg : sg) : 0;
            }
        }
        const base = k * 4, ii = k * 6;
        indices[ii] = base; indices[ii + 1] = base + 1; indices[ii + 2] = base + 2;
        indices[ii + 3] = base; indices[ii + 4] = base + 2; indices[ii + 5] = base + 3;
        if (component && comp) {
            // a run is one line of touching solid cells, so the block of its first cell names its component
            c[n] = a; c[q] = b; c[r] = r0;
            const id = componentAt(comp, (o[0] + c[0] - 1) >> toBlock, (o[1] + c[1] - 1) >> toBlock, (o[2] + c[2] - 1) >> toBlock);
            if (id < 0) throw new Error('a face lies in a block the components do not list');
            component.fill(id, k * 4, k * 4 + 4);
        }
    }
    return component ? { positions, normals, indices, faces, component } : { positions, normals, indices, faces };
}
