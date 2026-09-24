// Exact number of solid voxels in a SuperSplat sparse voxel octree (format 1.0 / 1.1), by walking
// the tree the same way the upstream point query descends it:
//   node === 0xFF000000            solid block (all voxels below it are solid)
//   high byte = child mask != 0    interior node, children at base + popcount(mask below the bit)
//   high byte = 0                  mixed leaf: a 4x4x4 block, 64-bit mask in leafData[2i], [2i+1]
// A node visited while descending level L spans 8^(L+1) leaf blocks; the node reached after the
// last level is a single block.

const SOLID = 0xff000000 >>> 0;

function popcount(v: number): number {
    v = v - ((v >>> 1) & 0x55555555);
    v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
    return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

export function countSolidVoxels(treeDepth: number, nodes: Uint32Array, leafData: Uint32Array): number {
    if (nodes.length === 0) return 0;
    // explicit stack: [nodeIndex, level]
    const stackIdx: number[] = [0];
    const stackLvl: number[] = [treeDepth - 1];
    let total = 0;
    while (stackIdx.length) {
        const idx = stackIdx.pop()!;
        const level = stackLvl.pop()!;
        const node = nodes[idx] >>> 0;
        if (node === SOLID) {
            total += 64 * Math.pow(8, level + 1);
            continue;
        }
        const mask = (node >>> 24) & 0xff;
        if (mask === 0 || level < 0) {
            const i = node & 0x00ffffff;
            total += popcount(leafData[i * 2] >>> 0) + popcount(leafData[i * 2 + 1] >>> 0);
            continue;
        }
        const base = node & 0x00ffffff;
        let k = 0;
        for (let bit = 0; bit < 8; bit++) {
            if (mask & (1 << bit)) {
                stackIdx.push(base + k);
                stackLvl.push(level - 1);
                k++;
            }
        }
    }
    return total;
}

/** Same from the .voxel.json + .voxel.bin bytes. */
export function countSolidVoxelsFromBytes(json: Uint8Array | string, bin: Uint8Array): number {
    const meta = JSON.parse(typeof json === 'string' ? json : new TextDecoder().decode(json)) as { treeDepth: number; nodeCount: number; leafDataCount: number };
    const words = new Uint32Array(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
    return countSolidVoxels(meta.treeDepth, words.subarray(0, meta.nodeCount), words.subarray(meta.nodeCount, meta.nodeCount + meta.leafDataCount));
}
