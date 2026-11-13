// The course generator off the main thread (train 1, lane tracks, T2; model voxels.worker.ts): it gets its own copy of the
// flown walls' octree, runs freeSpace and generateCourse of @gsfpv/tracks and answers the track. Measured in Node
// (docs/wip/tracks.md, Findings): 0.7-1.4 s a course on Winter Garden, 21.5-23.9 s on 887f27aa, so never on the page's thread.
import { VoxelCollision, FlippedVoxelCollision } from '@gsfpv/collision';
import type { VoxelMetadata } from '@gsfpv/collision';
import { freeSpace, generateCourse } from '@gsfpv/tracks';
import type { TrackFile } from '@shramko/sonic-fpv';

export interface CourseGrid {
    flip: boolean;
    min: [number, number, number];
    res: number;
    n: [number, number, number];
    leafSize: number;
    treeDepth: number;
}

export interface CourseJob {
    t: 'generate';
    job: number;
    grid: CourseGrid;
    nodes: Uint32Array;
    leaf: Uint32Array;
    /** the spawn, flown world */
    spawn: [number, number, number];
    seed: number;
    scene: { id: string; version: number };
    /** [s, tx, ty, tz] of the flight now */
    transform: [number, number, number, number];
    created: string;
}

export type FromCourseWorker =
    | { t: 'track'; job: number; track: TrackFile | null; ms: number }
    | { t: 'error'; job: number; message: string };

interface WorkerScope {
    onmessage: ((e: MessageEvent<CourseJob>) => void) | null;
    postMessage(m: FromCourseWorker): void;
}
const scope = self as unknown as WorkerScope;

function metadataOf(g: CourseGrid, nodes: number, leaf: number): VoxelMetadata {
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

scope.onmessage = (e) => {
    const m = e.data;
    if (m.t !== 'generate') return;
    const t0 = performance.now();
    try {
        const meta = metadataOf(m.grid, m.nodes.length, m.leaf.length);
        const walls = m.grid.flip ? new FlippedVoxelCollision(meta, m.nodes, m.leaf) : new VoxelCollision(meta, m.nodes, m.leaf);
        const free = freeSpace(walls, { spawn: m.spawn });
        const track = generateCourse(free, walls, { seed: m.seed, scene: m.scene, transform: m.transform, created: m.created });
        scope.postMessage({ t: 'track', job: m.job, track: track.gates.length > 0 ? track : null, ms: Math.round(performance.now() - t0) });
    } catch (err) {
        scope.postMessage({ t: 'error', job: m.job, message: err instanceof Error ? err.message : String(err) });
    }
};
