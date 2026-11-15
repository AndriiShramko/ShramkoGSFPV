// The course generator off the main thread (train 1, lane tracks, T2; model voxels.worker.ts): it gets its own copy of the
// flown walls' octree, runs freeSpace and generateCourse of @gsfpv/tracks and answers the track. Measured in Node
// (docs/wip/tracks.md, Findings): 0.7-1.4 s a course on Winter Garden, 21.5-23.9 s on 887f27aa, so never on the page's thread.
import { VoxelCollision, FlippedVoxelCollision } from '@gsfpv/collision';
import { COURSE_DEFAULTS, FIT_BUDGET_MS, checkTrack, fitCourse, freeSpace, generateCourse, goodForGate, marginOf, qualityBounds, qualityMap } from '@gsfpv/tracks';
import type { TrackFile } from '@shramko/sonic-fpv';
import { FREE_SPACE_MS, courseTryMs, layTries } from './progress';
import { metadataOf } from './grid';
import type { CourseGrid } from './grid';

export type { CourseGrid } from './grid';

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
    /** stage G1-progress: a step starts ('free': the free space; 'lay': one try of the obstacles), with its expected ms */
    | { t: 'progress'; job: number; step: 'free' | 'lay'; estMs: number }
    | { t: 'track'; job: number; track: TrackFile | null; short?: boolean; proven?: boolean; ms: number }
    | { t: 'checked'; job: number; ok: boolean; issues: string[]; ms: number }
    | { t: 'error'; job: number; message: string };

interface WorkerScope {
    onmessage: ((e: MessageEvent<CourseJob | CheckJob>) => void) | null;
    postMessage(m: FromCourseWorker): void;
}
const scope = self as unknown as WorkerScope;

scope.onmessage = (e) => {
    const m = e.data;
    const t0 = performance.now();
    if (m.t === 'check') {
        try {
            const meta = metadataOf(m.grid, m.nodes.length, m.leaf.length);
            const walls = m.grid.flip ? new FlippedVoxelCollision(meta, m.nodes, m.leaf) : new VoxelCollision(meta, m.nodes, m.leaf);
            // a smaller course (K1.2, fitCourse) is proven at the margin it was laid with
            const r = checkTrack(m.track, walls, m.transform, marginOf(m.track), false);
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
        scope.postMessage({ t: 'progress', job: m.job, step: 'free', estMs: FREE_SPACE_MS });
        // G2: where the scan is good (the dense height band over well-scanned tiles, from these walls): the free space covers
        // the well-scanned extent and the gates go into the band along all of it; no good tile keeps the box around the spawn
        const quality = qualityMap(walls);
        const box = qualityBounds(quality, m.spawn);
        // course4 C0: a spawn in a closed pocket of a poor scan gets the course in the well-scanned part (the guide leads there)
        const free = freeSpace(walls, { spawn: m.spawn, bounds: box ?? undefined, goodAt: box ? goodForGate(quality) : undefined });
        // G1-progress: every try is announced with its expected time: by the rates of progress.ts before the first, then
        // what the last try took here
        const make = layTries((estMs) => scope.postMessage({ t: 'progress', job: m.job, step: 'lay', estMs }), courseTryMs(m.grid.res, free.volumeM3), () => performance.now(), generateCourse);
        // lane review TR-8: a course under gatesMin is retried with derived seeds; K1.2: then at smaller sizes, and when none
        // reaches gatesMin the one with the most gates is flown (short), never nothing while one gate fits
        const got = fitCourse(free, walls, { seed: m.seed, scene: m.scene, transform: m.transform, created: m.created, quality: box ? quality : undefined, spawn: m.spawn }, COURSE_DEFAULTS.gatesMin, make, { at: t0 + FIT_BUDGET_MS, now: () => performance.now() });
        scope.postMessage({ t: 'track', job: m.job, track: got.track, short: got.short, proven: got.proven, ms: Math.round(performance.now() - t0) });
    } catch (err) {
        scope.postMessage({ t: 'error', job: m.job, message: err instanceof Error ? err.message : String(err) });
    }
};
