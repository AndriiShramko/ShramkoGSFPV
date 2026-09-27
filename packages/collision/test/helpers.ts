// Test helpers: the 39e63ce9 fixture, an octree encoder for synthetic grids (so the real octree
// walk is exercised, not the analytic override), and brute-force oracles built on isVoxelSolid.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { openVoxelCollision } from '../src/index';
import type { VoxelCollision, VoxelMetadata, ChunkMesh } from '../src/index';

const FIX = join(__dirname, '..', '..', '..', 'fixtures', '39e63ce9');

export function loadFixture(): { meta: VoxelMetadata; bin: Uint8Array; spawn: [number, number, number] } {
    const meta = JSON.parse(readFileSync(join(FIX, 'scene.voxel.json'), 'utf8')) as VoxelMetadata;
    let bin = new Uint8Array(readFileSync(join(FIX, 'scene.voxel.bin')));
    if (bin[0] === 0x1f && bin[1] === 0x8b) bin = new Uint8Array(gunzipSync(bin));
    const settings = JSON.parse(readFileSync(join(FIX, 'settings.json'), 'utf8'));
    return { meta, bin, spawn: settings.cameras[0].initial.position };
}

/** Same LCG as research-b's rb-scale.ts, so its sample points are reproduced. */
export function lcg(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
        s = (s * 1103515245 + 12345) >>> 0;
        return s / 4294967296;
    };
}

export type Dims = [number, number, number];
/** Occupied blocks: key (bz*nby + by)*nbx + bx -> [lo, hi] 64-bit voxel mask (bit z*16 + y*4 + x). */
export type BlockMasks = Map<number, [number, number]>;

export function blocksFromFn(dims: Dims, solid: (ix: number, iy: number, iz: number) => boolean): BlockMasks {
    const nb = dims.map((d) => Math.ceil(d / 4));
    const out: BlockMasks = new Map();
    for (let iz = 0; iz < dims[2]; iz++) for (let iy = 0; iy < dims[1]; iy++) for (let ix = 0; ix < dims[0]; ix++) {
        if (!solid(ix, iy, iz)) continue;
        setVoxel(out, nb, ix, iy, iz);
    }
    return out;
}

export function setVoxel(blocks: BlockMasks, nb: number[], ix: number, iy: number, iz: number): void {
    const key = ((iz >> 2) * nb[1] + (iy >> 2)) * nb[0] + (ix >> 2);
    const m = blocks.get(key) ?? [0, 0];
    const bit = (iz & 3) * 16 + (iy & 3) * 4 + (ix & 3);
    if (bit < 32) m[0] = (m[0] | (1 << bit)) >>> 0; else m[1] = (m[1] | (1 << (bit - 32))) >>> 0;
    blocks.set(key, m);
}

type Node = { k: 'solid' } | { k: 'leaf'; lo: number; hi: number } | { k: 'inner'; mask: number; kids: Node[] };

/**
 * Encode blocks as the SuperSplat sparse octree (Laine-Karras words in BFS order: children after
 * their parent, 0xFF000000 = solid, high byte 0 = mixed leaf index), then open it through the
 * real loader. `solidMarkers: false` keeps full blocks as leaves with a full mask.
 */
export function encodeCollision(
    dims: Dims,
    blocks: BlockMasks,
    o: { res?: number; min?: Dims; version?: '1.0' | '1.1'; solidMarkers?: boolean } = {}
): VoxelCollision {
    const res = o.res ?? 0.05;
    const min = o.min ?? [0, 0, 0];
    const solidMarkers = o.solidMarkers ?? true;
    const nb = dims.map((d) => Math.ceil(d / 4));
    const depth = Math.max(1, Math.ceil(Math.log2(Math.max(...nb))));
    // occupied ancestors per level, to descend only where blocks exist
    const occupied = new Set<string>();
    for (const key of blocks.keys()) {
        const bx = key % nb[0], by = Math.floor(key / nb[0]) % nb[1], bz = Math.floor(key / (nb[0] * nb[1]));
        for (let level = -1; level < depth; level++) {
            const sh = level + 1;
            occupied.add(`${level}:${bx >> sh},${by >> sh},${bz >> sh}`);
        }
    }
    const build = (level: number, bx: number, by: number, bz: number): Node | null => {
        const sh = level + 1;
        if (!occupied.has(`${level}:${bx >> sh},${by >> sh},${bz >> sh}`)) return null;
        if (level < 0) {
            const m = blocks.get((bz * nb[1] + by) * nb[0] + bx)!;
            if (solidMarkers && m[0] === 0xffffffff && m[1] === 0xffffffff) return { k: 'solid' };
            return { k: 'leaf', lo: m[0], hi: m[1] };
        }
        const kids: Node[] = [];
        let mask = 0;
        for (let bit = 0; bit < 8; bit++) {
            const c = build(level - 1, bx + ((bit & 1) << level), by + (((bit >> 1) & 1) << level), bz + (((bit >> 2) & 1) << level));
            if (c) {
                kids.push(c);
                mask |= 1 << bit;
            }
        }
        if (solidMarkers && mask === 0xff && kids.every((c) => c.k === 'solid')) return { k: 'solid' };
        return { k: 'inner', mask, kids };
    };
    const root = build(depth - 1, 0, 0, 0);
    const nodes: number[] = [];
    const leaf: number[] = [];
    if (!root) {
        nodes.push(0);
        leaf.push(0, 0);
    } else {
        const queue: Node[] = [root];
        for (let i = 0; i < queue.length; i++) {
            const n = queue[i];
            if (n.k === 'solid') nodes.push(0xff000000 >>> 0);
            else if (n.k === 'leaf') {
                nodes.push(leaf.length / 2);
                leaf.push(n.lo, n.hi);
            } else {
                nodes.push(((n.mask << 24) | queue.length) >>> 0);
                queue.push(...n.kids);
            }
        }
    }
    return openRaw(dims, depth, nodes, leaf, { res, min, version: o.version ?? '1.1' });
}

/** Open hand-made octree words through the real loader. */
export function openRaw(dims: Dims, depth: number, nodes: number[], leaf: number[], o: { res: number; min: Dims; version: '1.0' | '1.1' }): VoxelCollision {
    const meta: VoxelMetadata = {
        version: o.version,
        gridBounds: { min: o.min.slice(), max: o.min.map((m, i) => m + dims[i] * o.res) },
        gaussianBounds: { min: o.min.slice(), max: o.min.map((m, i) => m + dims[i] * o.res) },
        voxelResolution: o.res,
        leafSize: 4,
        treeDepth: depth,
        numInteriorNodes: 0,
        numMixedLeaves: leaf.length / 2,
        nodeCount: nodes.length,
        leafDataCount: leaf.length
    };
    const words = new Uint32Array(nodes.length + leaf.length);
    words.set(nodes);
    words.set(leaf, nodes.length);
    return openVoxelCollision(meta, new Uint8Array(words.buffer));
}

// Face directions in mesh.ts order: +x, -x, +y, -y, +z, -z.
const DIR: Dims[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

/** Brute force: every exposed face of the chunk, one isVoxelSolid call per voxel and neighbour. */
export function bruteFaces(col: VoxelCollision, chunk: { x: number; y: number; z: number }, size: number): Set<string> {
    const out = new Set<string>();
    for (let z = 0; z < size; z++) for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const ix = chunk.x * size + x, iy = chunk.y * size + y, iz = chunk.z * size + z;
        if (!col.isVoxelSolid(ix, iy, iz)) continue;
        for (let d = 0; d < 6; d++) {
            if (!col.isVoxelSolid(ix + DIR[d][0], iy + DIR[d][1], iz + DIR[d][2])) out.add(`${d},${ix},${iy},${iz}`);
        }
    }
    return out;
}

export interface Unrolled {
    faces: Set<string>;
    duplicates: number;
    area: number;
    badWinding: number;
    notARun: number;
    offGrid: number;
}

/**
 * Turn the quads back into unit faces, from their world positions and normals alone (undoing the
 * format 1.0 flip), and check winding and the 1-D run shape on the way.
 */
export function unrollQuads(col: VoxelCollision, m: ChunkMesh): Unrolled {
    const flip = col.flipXY;
    const res = col.voxelResolution;
    const g = [col.gridMinX, col.gridMinY, col.gridMinZ];
    const faces = new Set<string>();
    let duplicates = 0, area = 0, badWinding = 0, notARun = 0, offGrid = 0;
    const quads = m.indices.length / 6;
    for (let k = 0; k < quads; k++) {
        const p: number[][] = [];
        for (let c = 0; c < 4; c++) {
            const v = m.indices[k * 6 + (c === 3 ? 5 : c)];
            p.push([m.positions[v * 3], m.positions[v * 3 + 1], m.positions[v * 3 + 2]]);
        }
        const nv = m.indices[k * 6];
        const nw = [m.normals[nv * 3], m.normals[nv * 3 + 1], m.normals[nv * 3 + 2]];
        // winding: (p1 - p0) x (p2 - p0) must point along the normal, in world space
        const a = p[1].map((v, i) => v - p[0][i]), b = p[2].map((v, i) => v - p[0][i]);
        const cr = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
        if (cr[0] * nw[0] + cr[1] * nw[1] + cr[2] * nw[2] <= 0) badWinding++;
        // back to file space, in voxel units
        const nf = flip ? [-nw[0], -nw[1], nw[2]] : nw;
        const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
        for (const q of p) {
            const f = flip ? [-q[0], -q[1], q[2]] : q;
            for (let i = 0; i < 3; i++) {
                const u = (f[i] - g[i]) / res;
                const r = Math.round(u);
                if (Math.abs(u - r) > 1e-3) offGrid++;
                lo[i] = Math.min(lo[i], r);
                hi[i] = Math.max(hi[i], r);
            }
        }
        const n = nf.findIndex((v) => v !== 0);
        const d = n * 2 + (nf[n] > 0 ? 0 : 1);
        const tang = [0, 1, 2].filter((i) => i !== n);
        const ext = tang.map((i) => hi[i] - lo[i]);
        if (hi[n] !== lo[n] || Math.min(...ext) !== 1) notARun++;
        const plane = nf[n] > 0 ? lo[n] - 1 : lo[n];
        for (let s = lo[tang[0]]; s < hi[tang[0]]; s++) for (let t = lo[tang[1]]; t < hi[tang[1]]; t++) {
            const idx = [0, 0, 0];
            idx[n] = plane;
            idx[tang[0]] = s;
            idx[tang[1]] = t;
            const key = `${d},${idx[0]},${idx[1]},${idx[2]}`;
            if (faces.has(key)) duplicates++;
            faces.add(key);
            area++;
        }
    }
    return { faces, duplicates, area, badWinding, notARun, offGrid };
}

export function sameSet(a: Set<string>, b: Set<string>): { missing: number; extra: number } {
    let missing = 0, extra = 0;
    for (const k of a) if (!b.has(k)) missing++;
    for (const k of b) if (!a.has(k)) extra++;
    return { missing, extra };
}
