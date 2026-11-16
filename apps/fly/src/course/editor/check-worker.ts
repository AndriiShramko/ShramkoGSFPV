// Lane editor3, E2.1: the editor's course check off the page's thread (check-core.ts says why). It builds the flown walls
// once per walls message (as course/worker.ts does per job) and answers every course with its problems. The octree header
// comes from course/grid.ts (lane course3 hook, the same function course/worker.ts uses).
import { VoxelCollision, FlippedVoxelCollision } from '@gsfpv/collision';
import { metadataOf } from '../grid';
import { checkAnswerer } from './check-core';
import type { FromCheckWorker, ToCheckWorker, WallsMsg } from './check-core';

interface WorkerScope {
    onmessage: ((e: MessageEvent<ToCheckWorker>) => void) | null;
    postMessage(m: FromCheckWorker): void;
}
const scope = self as unknown as WorkerScope;

const answer = checkAnswerer((m) => {
    const meta = metadataOf(m.grid, m.nodes.length, m.leaf.length);
    return m.grid.flip ? new FlippedVoxelCollision(meta, m.nodes, m.leaf) : new VoxelCollision(meta, m.nodes, m.leaf);
});

scope.onmessage = (e) => {
    const out = answer(e.data);
    if (out) scope.postMessage(out);
};
