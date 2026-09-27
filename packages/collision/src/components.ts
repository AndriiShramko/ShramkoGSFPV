// Connected components of occupied 4x4x4 blocks (design G.1, G.3; research-b 4.1). Used to paint
// floaters and, in wave 4, to drop them. Pure, no DOM: safe in a worker.
//
// A dense grid of block ids does not fit big scenes (a 600 m grid at 5 cm is 3000^3 blocks), so
// only occupied blocks are listed, sorted by key (bz*nby + by)*nbx + bx. In that order every
// "earlier" neighbour offset is a constant key offset and its key grows with the block's key, so
// one forward-only pointer per offset finds all neighbours in linear time (no hashing, no search).

import { blockDims, forEachBlock, usesOctree } from './mesh';
import type { VoxelCollision } from './vendor/voxel-collision';

export interface BlockComponents {
    /** Component id of each occupied block, in `keys` order; ids are numbered by each component's lowest key. */
    blockIds: Int32Array;
    /** Size of each component in blocks, by id. */
    sizes: Uint32Array;
    count: number;
    /** Keys (bz*nby + by)*nbx + bx of the occupied blocks, ascending. */
    keys: Float64Array;
    /** Grid size in blocks. */
    dims: [number, number, number];
    connectivity: 6 | 26;
}

/** Analytic test worlds are read voxel by voxel; above this many blocks that would take minutes. */
const ANALYTIC_BLOCK_LIMIT = 1 << 21;

/** Neighbour offsets with a lower key: 13 of the 26, or 3 of the 6 face neighbours. */
function earlierOffsets(connectivity: 6 | 26): [number, number, number][] {
    if (connectivity === 6) return [[-1, 0, 0], [0, -1, 0], [0, 0, -1]];
    const out: [number, number, number][] = [];
    for (let dz = -1; dz <= 0; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (dz === 0 && (dy > 0 || (dy === 0 && dx >= 0))) continue;
        out.push([dx, dy, dz]);
    }
    return out;
}

export function blockComponents(col: VoxelCollision, opts: { connectivity?: 6 | 26 } = {}): BlockComponents {
    const connectivity = opts.connectivity ?? 26;
    if (connectivity !== 6 && connectivity !== 26) throw new RangeError(`connectivity must be 6 or 26, got ${connectivity}`);
    const dims = blockDims(col);
    const [nbx, nby, nbz] = dims;
    if (!usesOctree(col) && nbx * nby * nbz > ANALYTIC_BLOCK_LIMIT) {
        throw new RangeError(`analytic voxel world of ${nbx}x${nby}x${nbz} blocks is too large for components`);
    }

    let keys = new Float64Array(1024);
    let n = 0;
    forEachBlock(col, [0, 0, 0], dims, (bx, by, bz) => {
        if (n === keys.length) {
            const grown = new Float64Array(keys.length * 2);
            grown.set(keys);
            keys = grown;
        }
        keys[n++] = (bz * nby + by) * nbx + bx;
    });
    keys = keys.slice(0, n).sort();

    const parent = new Int32Array(n);
    for (let i = 0; i < n; i++) parent[i] = i;
    const find = (a: number): number => {
        while (parent[a] !== a) {
            parent[a] = parent[parent[a]];
            a = parent[a];
        }
        return a;
    };
    const offs = earlierOffsets(connectivity);
    const ptr = new Int32Array(offs.length);
    const dk = offs.map(([dx, dy, dz]) => (dz * nby + dy) * nbx + dx);
    for (let i = 0; i < n; i++) {
        const k = keys[i];
        const bx = k % nbx, rest = (k - bx) / nbx, by = rest % nby, bz = (rest - by) / nby;
        for (let j = 0; j < offs.length; j++) {
            const x = bx + offs[j][0], y = by + offs[j][1], z = bz + offs[j][2];
            // the key offset wraps across rows and slabs, so the coordinates must stay on the grid
            if (x < 0 || x >= nbx || y < 0 || y >= nby || z < 0) continue;
            const target = k + dk[j];
            let p = ptr[j];
            while (keys[p] < target) p++;
            ptr[j] = p;
            if (keys[p] === target) {
                const ra = find(i), rb = find(p);
                if (ra !== rb) parent[ra > rb ? ra : rb] = ra > rb ? rb : ra;
            }
        }
    }

    const blockIds = new Int32Array(n).fill(-1);
    const rootId = new Int32Array(n).fill(-1);
    let count = 0;
    for (let i = 0; i < n; i++) {
        const r = find(i);
        if (rootId[r] < 0) rootId[r] = count++;
        blockIds[i] = rootId[r];
    }
    const sizes = new Uint32Array(count);
    for (let i = 0; i < n; i++) sizes[blockIds[i]]++;
    return { blockIds, sizes, count, keys, dims, connectivity };
}

/** Index of block (bx, by, bz) in `keys` and `blockIds`, or -1 when it is empty. */
export function blockIndex(c: BlockComponents, bx: number, by: number, bz: number): number {
    const [nbx, nby, nbz] = c.dims;
    if (bx < 0 || by < 0 || bz < 0 || bx >= nbx || by >= nby || bz >= nbz) return -1;
    const key = (bz * nby + by) * nbx + bx;
    let lo = 0, hi = c.keys.length - 1;
    while (lo <= hi) {
        const mid = (lo + hi) >>> 1;
        const v = c.keys[mid];
        if (v === key) return mid;
        if (v < key) lo = mid + 1; else hi = mid - 1;
    }
    return -1;
}

/** Component id of block (bx, by, bz), or -1 when it is empty. */
export function componentAt(c: BlockComponents, bx: number, by: number, bz: number): number {
    const i = blockIndex(c, bx, by, bz);
    return i < 0 ? -1 : c.blockIds[i];
}
