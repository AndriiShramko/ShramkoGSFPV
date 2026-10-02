// Phantom walls (design G.3, the owner's item 24): a noisy scan has floating splats, and the
// voxelizer turns them into small solid pieces the craft crashes into although nothing is there.
// dropFloaters(base, N) gives the walls with every connected piece (26-connected 4x4x4 blocks,
// components.ts) smaller than N blocks removed, and nothing else changed. Pure, no DOM: safe in a
// worker. Wrapper code: the vendored octree code is untouched and only reads the arrays.
//
// The octree is not re-encoded: the base's words are copied and every leaf whose blocks all belong
// to a dropped piece is pointed at one appended all-empty leaf mask (high byte 0 = mixed leaf, so
// isVoxelSolid reads the zero mask at any level). Leaf masks may be shared between nodes, so no
// existing mask is ever edited. The same base and N always give the same words: deterministic, so a
// replay rebuilds the same filtered walls from the scan's own bytes (floaterDigestParts names them).

import { blockComponents, blockIndex } from './components';
import type { BlockComponents } from './components';
import { blockDims, usesOctree } from './mesh';
import { transformedMetadata } from './transform';
import { FlippedVoxelCollision, VoxelCollision } from './vendor/voxel-collision';
import type { VoxelMetadata } from './vendor/voxel-collision';

const SOLID = 0xff000000 >>> 0;

/** The pilot's range (prefs scene.dropFloaters): 0 = off. */
export const FLOATER_MIN_BLOCKS_MAX = 64;

export interface FloaterFilter {
    /** pieces smaller than this many blocks are dropped; 0 = off */
    minBlocks: number;
    /** the walls with them dropped; the base itself when nothing was dropped */
    collision: VoxelCollision;
    /** connected pieces of the base, and the ones dropped (with their blocks) */
    components: number;
    pieces: number;
    blocks: number;
    /** leaves pointed at the empty mask */
    leaves: number;
    /** leaves shared by a dropped and a kept piece, kept whole (a wall of a kept piece is never dropped) */
    shared: number;
}

const compCache = new WeakMap<VoxelCollision, BlockComponents>();
const filterCache = new WeakMap<VoxelCollision, Map<number, FloaterFilter>>();

/** blockComponents of `col`, computed once per collision (the live walls and the replays share it). */
export function componentsOf(col: VoxelCollision): BlockComponents {
    let c = compCache.get(col);
    if (!c) {
        c = blockComponents(col);
        compCache.set(col, c);
    }
    return c;
}

/** The filter's N as a log holds it: an integer 0..64 (Float32 in a world record, a number in a header). */
export function validMinBlocks(n: unknown): n is number {
    return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= FLOATER_MIN_BLOCKS_MAX;
}

/**
 * The walls of `base` without its connected pieces smaller than `minBlocks` blocks (26-connected
 * 4x4x4 blocks). minBlocks 0 returns the base. Cached per base and N (the two latest N), so the
 * live session and a replay of the same scan share one result.
 */
export function dropFloaters(base: VoxelCollision, minBlocks: number): FloaterFilter {
    if (!validMinBlocks(minBlocks)) throw new RangeError(`floater filter must be an integer 0..${FLOATER_MIN_BLOCKS_MAX}, got ${minBlocks}`);
    if (minBlocks === 0) return { minBlocks: 0, collision: base, components: 0, pieces: 0, blocks: 0, leaves: 0, shared: 0 };
    let byN = filterCache.get(base);
    const hit = byN?.get(minBlocks);
    if (hit) return hit;
    const f = rebuild(base, minBlocks, componentsOf(base));
    if (!byN) filterCache.set(base, (byN = new Map()));
    byN.set(minBlocks, f);
    // keep the two latest N per scan: a filter change and the replay of the life before it
    while (byN.size > 2) byN.delete(byN.keys().next().value as number);
    return f;
}

function rebuild(base: VoxelCollision, minBlocks: number, comps: BlockComponents): FloaterFilter {
    if (!usesOctree(base)) throw new RangeError('the floater filter needs an octree collision (a scan\'s walls), not an analytic test world');
    const drop = new Uint8Array(comps.count);
    let pieces = 0, blocks = 0;
    for (let id = 0; id < comps.count; id++) {
        if (comps.sizes[id] < minBlocks) {
            drop[id] = 1;
            pieces++;
            blocks += comps.sizes[id];
        }
    }
    const result = (collision: VoxelCollision, leaves: number, shared: number): FloaterFilter =>
        ({ minBlocks, collision, components: comps.count, pieces, blocks, leaves, shared });
    if (pieces === 0) return result(base, 0, 0);

    const nodes = base.nodes, leaf = base.leafData;
    const empty = leaf.length / 2; // index of the appended all-empty mask
    if (empty > 0x00ffffff) throw new RangeError('the collision has too many leaf masks for one more');
    const out = new Uint32Array(nodes);
    const [nbx, nby, nbz] = blockDims(base);
    let leaves = 0, shared = 0;
    // the walk of mesh.ts forEachBlock: (node index, level, block origin); a node at level L spans 2^(L+1) blocks
    const sIdx: number[] = [0], sLvl: number[] = [base.treeDepth - 1], sX: number[] = [0], sY: number[] = [0], sZ: number[] = [0];
    while (sIdx.length) {
        const idx = sIdx.pop()!, level = sLvl.pop()!, bx = sX.pop()!, by = sY.pop()!, bz = sZ.pop()!;
        const node = nodes[idx] >>> 0;
        const mask = (node >>> 24) & 0xff;
        if (node === SOLID || mask === 0 || level < 0) {
            if (node !== SOLID && leaf[(node & 0x00ffffff) * 2] === 0 && leaf[(node & 0x00ffffff) * 2 + 1] === 0) continue;
            // a leaf above the last level covers span^3 blocks: drop it only when every occupied one is dropped
            const span = 2 ** (level + 1);
            let anyDrop = false, anyKeep = false;
            for (let z = bz; z < Math.min(nbz, bz + span); z++) for (let y = by; y < Math.min(nby, by + span); y++) for (let x = bx; x < Math.min(nbx, bx + span); x++) {
                const i = blockIndex(comps, x, y, z);
                if (i < 0) continue; // clipped to nothing at the grid's edge
                if (drop[comps.blockIds[i]] === 1) anyDrop = true; else anyKeep = true;
            }
            if (anyDrop && anyKeep) shared++;
            else if (anyDrop) {
                out[idx] = empty;
                leaves++;
            }
            continue;
        }
        const first = node & 0x00ffffff;
        let k = 0;
        for (let bit = 0; bit < 8; bit++) {
            if ((mask & (1 << bit)) === 0) continue;
            sIdx.push(first + k++);
            sLvl.push(level - 1);
            sX.push(bx + ((bit & 1) << level));
            sY.push(by + (((bit >> 1) & 1) << level));
            sZ.push(bz + (((bit >> 2) & 1) << level));
        }
    }
    if (leaves === 0) return result(base, 0, shared);
    const leafOut = new Uint32Array(leaf.length + 2);
    leafOut.set(leaf);
    // the base's own bounds (s = 1, no offset: the file space is the base's), the new array sizes
    const meta: VoxelMetadata = { ...transformedMetadata(base, 1, [0, 0, 0]), nodeCount: out.length, leafDataCount: leafOut.length, numMixedLeaves: leafOut.length / 2 };
    const col = base.flipXY ? new FlippedVoxelCollision(meta, out, leafOut) : new VoxelCollision(meta, out, leafOut);
    if (col.numVoxelsX !== base.numVoxelsX || col.numVoxelsY !== base.numVoxelsY || col.numVoxelsZ !== base.numVoxelsZ) {
        throw new Error('filtered collision lost its voxel counts');
    }
    return result(col, leaves, shared);
}

/**
 * What identifies filtered walls, to hash in order (sha256 lives in sim-core, which this package
 * may not import): a line with the grid (counts, resolution, origin, depth, flip), then the octree
 * words and the leaf masks. Two filters that drop the same pieces of the same scan give the same bytes.
 */
export function floaterDigestParts(col: VoxelCollision): Uint8Array[] {
    const head = `gsfpv-walls-filtered/1 n=${col.numVoxelsX},${col.numVoxelsY},${col.numVoxelsZ} res=${col.voxelResolution} min=${col.gridMinX},${col.gridMinY},${col.gridMinZ} depth=${col.treeDepth} leaf=${col.leafSize} flip=${col.flipXY ? 1 : 0}\n`;
    const bytes = new Uint8Array(head.length);
    for (let i = 0; i < head.length; i++) bytes[i] = head.charCodeAt(i) & 0x7f;
    const words = (a: Uint32Array) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    return [bytes, words(col.nodes), words(col.leafData)];
}
