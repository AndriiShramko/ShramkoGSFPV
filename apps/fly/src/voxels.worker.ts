// Voxel overlay worker (design G.1): builds overlay chunks off the main thread. It gets its own
// copy of the collision's octree once per set of walls, finds the connected pieces (to paint the
// floating ones) and the occupied chunks, then answers chunk requests one by one with vertex
// buffers already interleaved and coloured for the GPU (the main thread only uploads them).
import { VoxelCollision, FlippedVoxelCollision, blockComponents, floaterComponents, occupiedChunks, overlayChunk } from '@gsfpv/collision';
import type { BlockComponents, VoxelMetadata } from '@gsfpv/collision';
// the pure half of render-pc (no engine import: the engine stays out of the worker bundle)
import { packChunk } from '../../../packages/render-pc/src/voxel-colors';
import type { PackedChunk, VoxelLayout, VoxelStyle } from '../../../packages/render-pc/src/voxel-colors';

export interface WorkerGrid {
    flip: boolean;
    min: [number, number, number];
    res: number;
    /** voxels per axis */
    n: [number, number, number];
    leafSize: number;
    treeDepth: number;
}

/**
 * Which pieces are painted as floaters: 0, the small ones by volume (overlay.ts FLOATER_M3); N > 0,
 * the ones the floater filter would drop at N (size under N blocks: the preview of Settings' filter).
 */
export type ToWorker =
    | { t: 'init'; gen: number; grid: WorkerGrid; nodes: Uint32Array; leaf: Uint32Array; size: number; layout: VoxelLayout; minBlocks: number }
    | { t: 'mark'; gen: number; minBlocks: number }
    | { t: 'chunk'; gen: number; key: number; x: number; y: number; z: number; lod: 0 | 1; style: VoxelStyle; lo: number; hi: number };

export type FromWorker =
    | { t: 'ready'; gen: number; occupied: Int32Array; blocks: number; components: number; floaters: number; ms: number }
    | { t: 'marked'; gen: number; floaters: number }
    | ({ t: 'chunk'; gen: number; key: number; lod: 0 | 1; faces: number; floaterQuads: number; ms: number } & PackedChunk)
    | { t: 'error'; gen: number; message: string };

interface WorkerScope {
    onmessage: ((e: MessageEvent<ToWorker>) => void) | null;
    postMessage(m: FromWorker, transfer?: Transferable[]): void;
}
const scope = self as unknown as WorkerScope;

let gen = -1;
let col: VoxelCollision | null = null;
let comp: BlockComponents | null = null;
let floaters: Uint8Array | null = null;
let size = 48;
let layout: VoxelLayout | null = null;

function metadataOf(g: WorkerGrid, nodes: number, leaf: number): VoxelMetadata {
    const max = [0, 1, 2].map((a) => g.min[a] + g.n[a] * g.res);
    return {
        version: g.flip ? '1.0' : '1.1',
        gridBounds: { min: [...g.min], max },
        gaussianBounds: { min: [...g.min], max },
        voxelResolution: g.res,
        leafSize: g.leafSize,
        treeDepth: g.treeDepth,
        numInteriorNodes: 0,
        numMixedLeaves: leaf / 2,
        nodeCount: nodes,
        leafDataCount: leaf
    };
}

/** The floater flags for `minBlocks` (see ToWorker); the number of pieces flagged. */
function mark(minBlocks: number): number {
    if (!comp || !col) return 0;
    if (minBlocks > 0) {
        floaters = new Uint8Array(comp.count);
        for (let i = 0; i < comp.count; i++) if (comp.sizes[i] < minBlocks) floaters[i] = 1;
    } else floaters = floaterComponents(comp, col.voxelResolution);
    let nf = 0;
    for (let i = 0; i < floaters.length; i++) nf += floaters[i];
    return nf;
}

scope.onmessage = (e) => {
    const m = e.data;
    try {
        if (m.t === 'init') {
            const t0 = performance.now();
            gen = m.gen;
            size = m.size;
            layout = m.layout;
            const meta = metadataOf(m.grid, m.nodes.length, m.leaf.length);
            col = m.grid.flip ? new FlippedVoxelCollision(meta, m.nodes, m.leaf) : new VoxelCollision(meta, m.nodes, m.leaf);
            comp = blockComponents(col);
            const nf = mark(m.minBlocks);
            const occupied = occupiedChunks(col, comp, size);
            scope.postMessage({ t: 'ready', gen, occupied, blocks: comp.keys.length, components: comp.count, floaters: nf, ms: performance.now() - t0 }, [occupied.buffer]);
            return;
        }
        if (m.t === 'mark') {
            // the same walls, other pieces painted: the chunks asked for after this carry the new colours
            if (!comp || !col) return;
            gen = m.gen;
            scope.postMessage({ t: 'marked', gen, floaters: mark(m.minBlocks) });
            return;
        }
        if (m.t === 'chunk') {
            if (m.gen !== gen || !col || !layout) return; // walls changed since the request
            const t0 = performance.now();
            const c = overlayChunk(col, { x: m.x, y: m.y, z: m.z }, size, m.lod, comp ?? undefined, floaters ?? undefined);
            const p = packChunk(c, layout, m.style, m.lo, m.hi);
            scope.postMessage(
                { t: 'chunk', gen, key: m.key, lod: m.lod, faces: c.faces, floaterQuads: c.floaterQuads, ms: performance.now() - t0, ...p },
                [p.vertices, p.indices.buffer as ArrayBuffer, p.floater.buffer as ArrayBuffer]
            );
        }
    } catch (err) {
        scope.postMessage({ t: 'error', gen: m.gen, message: String((err as Error)?.message ?? err) });
    }
};
