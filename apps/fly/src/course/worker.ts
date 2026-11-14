// The course generator off the main thread (train 1, lane tracks, T2; model voxels.worker.ts): it gets its own copy of the
// flown walls' octree, runs freeSpace and generateCourse of @gsfpv/tracks and answers the track. Measured in Node
// (docs/wip/tracks.md, Findings): 0.7-1.4 s a course on Winter Garden, 21.5-23.9 s on 887f27aa, so never on the page's thread.
import { VoxelCollision, FlippedVoxelCollision } from '@gsfpv/collision';
import type { VoxelMetadata } from '@gsfpv/collision';
import { COURSE_DEFAULTS, MARGIN_M, checkTrack, fitCourse, freeSpace } from '@gsfpv/tracks';
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

/** T3: prove a course from the server on the pilot's own walls before it is shown (checkTrack, unmeasured, as the generator). */
export interface CheckJob {
    t: 'check';
    job: number;
    grid: CourseGrid;
    nodes: Uint32Array;
    leaf: Uint32Array;
    track: TrackFile;
    transform: [number, number, number, number];
}

export type FromCourseWorker =
    | { t: 'track'; job: number; track: TrackFile | null; short?: boolean; ms: number }
    | { t: 'checked'; job: number; ok: boolean; issues: string[]; ms: number }
    | { t: 'error'; job: number; message: string };

interface WorkerScope {
    onmessage: ((e: MessageEvent<CourseJob | CheckJob>) => void) | null;
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
    const t0 = performance.now();
    if (m.t === 'check') {
        try {
            const meta = metadataOf(m.grid, m.nodes.length, m.leaf.length);
            const walls = m.grid.flip ? new FlippedVoxelCollision(meta, m.nodes, m.leaf) : new VoxelCollision(meta, m.nodes, m.leaf);
            // a smaller course (K1.2, fitCourse) is proven at the margin it was laid with
            const mg = m.track.generator?.params.marginM;
            const r = checkTrack(m.track, walls, m.transform, typeof mg === 'number' && mg > 0 && mg < MARGIN_M ? mg : MARGIN_M, false);
            scope.postMessage({ t: 'checked', job: m.job, ok: r.ok, issues: r.issues.slice(0, 4), ms: Math.round(performance.now() - t0) });
        } catch (err) {
            scope.postMessage({ t: 'error', job: m.job, message: err instanceof Error ? err.message : String(err) });
        }
        return;
    }
    if (m.t !== 'generate') return;
    try {
        const meta = metadataOf(m.grid, m.nodes.length, m.leaf.length);
        const walls = m.grid.flip ? new FlippedVoxelCollision(meta, m.nodes, m.leaf) : new VoxelCollision(meta, m.nodes, m.leaf);
        const free = freeSpace(walls, { spawn: m.spawn });
        // lane review TR-8: a course under gatesMin is retried with derived seeds; K1.2: then at smaller sizes, and when none
        // reaches gatesMin the one with the most gates is flown (short), never nothing while one gate fits
        const got = fitCourse(free, walls, { seed: m.seed, scene: m.scene, transform: m.transform, created: m.created }, COURSE_DEFAULTS.gatesMin);
        scope.postMessage({ t: 'track', job: m.job, track: got.track, short: got.short, ms: Math.round(performance.now() - t0) });
    } catch (err) {
        scope.postMessage({ t: 'error', job: m.job, message: err instanceof Error ? err.message : String(err) });
    }
};
