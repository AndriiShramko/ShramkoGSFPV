// The flown walls' octree as the page sends it to a worker (grid, nodes, leaf), and its header. No side effects: the
// course worker (worker.ts) and the editor's check worker (lane editor3, course/editor/check-worker.ts) both import it.
import type { VoxelMetadata } from '@gsfpv/collision';

export interface CourseGrid {
    flip: boolean;
    min: [number, number, number];
    res: number;
    n: [number, number, number];
    leafSize: number;
    treeDepth: number;
}

/** The octree's header from the grid the page sent and the lengths of its two arrays. */
export function metadataOf(g: CourseGrid, nodes: number, leaf: number): VoxelMetadata {
    const max = [0, 1, 2].map((a) => g.min[a]! + g.n[a]! * g.res);
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
