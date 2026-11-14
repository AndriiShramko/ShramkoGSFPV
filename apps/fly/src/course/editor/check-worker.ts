// Lane editor3, E2.1: the editor's course check off the page's thread (check-core.ts says why). It builds the flown walls
// once per walls message (as course/worker.ts does per job) and answers every course with its problems.
import { VoxelCollision, FlippedVoxelCollision } from '@gsfpv/collision';
import type { VoxelMetadata } from '@gsfpv/collision';
import { checkAnswerer } from './check-core';
import type { FromCheckWorker, ToCheckWorker, WallsMsg } from './check-core';

interface WorkerScope {
    onmessage: ((e: MessageEvent<ToCheckWorker>) => void) | null;
    postMessage(m: FromCheckWorker): void;
}
const scope = self as unknown as WorkerScope;

/** the octree's header from the grid the page sent (the same as course/worker.ts metadataOf) */
function metadataOf(m: WallsMsg): VoxelMetadata {
    const g = m.grid;
    const max = [0, 1, 2].map((a) => g.min[a]! + g.n[a]! * g.res);
    return {
        version: g.flip ? '1.0' : '1.1',
        gridBounds: { min: [...g.min], max },
        gaussianBounds: { min: [...g.min], max },
        voxelResolution: g.res,
        leafSize: g.leafSize,
        treeDepth: g.treeDepth,
        numInteriorNodes: 0,
        numMixedLeaves: m.leaf.length / 2,
        nodeCount: m.nodes.length,
        leafDataCount: m.leaf.length
    };
}

const answer = checkAnswerer((m) => {
    const meta = metadataOf(m);
    return m.grid.flip ? new FlippedVoxelCollision(meta, m.nodes, m.leaf) : new VoxelCollision(meta, m.nodes, m.leaf);
});

scope.onmessage = (e) => {
    const out = answer(e.data);
    if (out) scope.postMessage(out);
};
