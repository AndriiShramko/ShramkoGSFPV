// A course of gates for Fly by Sound in the scan flown now (train 2, S3; docs/wip/sound2-plan.md 2.1). The course feature
// (app/builtin/course.ts, lane tracks) keeps its generator and its course inside its own closure (its hook gives the track's id,
// not the track) and its keys do nothing while the mode is on (TR-7). So the sound page asks the same worker module
// (course/worker.ts: 'generate', the job shape it exports) for a course over the flown walls, with the seed of the page's
// course= link when it names one (the course Shift+G made on the sighted page that opened this one), else a random seed.
// What the worker answers is the same TrackFile the feature shows (the same seed gives the same course).
import type { TrackFile } from '@shramko/sonic-fpv';
import type { CourseGrid, CourseJob, FromCourseWorker } from '../course/worker';

/** The part of the flight session a course is made from. */
export interface CourseSource {
    readonly collision: {
        readonly flipXY: boolean;
        readonly gridMinX: number;
        readonly gridMinY: number;
        readonly gridMinZ: number;
        readonly voxelResolution: number;
        readonly numVoxelsX: number;
        readonly numVoxelsY: number;
        readonly numVoxelsZ: number;
        readonly leafSize: number;
        readonly treeDepth: number;
        readonly nodes: Uint32Array;
        readonly leafData: Uint32Array;
    } | null;
    readonly spawn: ArrayLike<number>;
    readonly scene: { readonly id: string; readonly version: number };
    readonly transform: { readonly s: number; readonly t: readonly number[] };
}

/** What the page answers when the pilot asks for a course: the course, or why there is none. */
export type CourseAnswer = { ok: true; track: TrackFile } | { ok: false; why: 'no walls' | 'none fits' | 'failed' };

/**
 * The course feature's own limit for a generate job (app/builtin/course.ts GENERATE_LIMIT_MS, an ESTIMATE there: up to three tries
 * of enoughGates, a course took 15-31 s in the page); the same number, so the two give up alike.
 */
export const COURSE_LIMIT_MS = 150_000;

/** The worker's job for a course over the walls flown now (a copy of the walls: its buffers are transferred), or null without walls. */
export function courseJob(s: CourseSource, seed: number, job: number, created: string): CourseJob | null {
    const col = s.collision;
    if (!col) return null;
    const grid: CourseGrid = {
        flip: col.flipXY,
        min: [col.gridMinX, col.gridMinY, col.gridMinZ],
        res: col.voxelResolution,
        n: [col.numVoxelsX, col.numVoxelsY, col.numVoxelsZ],
        leafSize: col.leafSize,
        treeDepth: col.treeDepth
    };
    return {
        t: 'generate',
        job,
        grid,
        nodes: col.nodes.slice(),
        leaf: col.leafData.slice(),
        spawn: [s.spawn[0] as number, s.spawn[1] as number, s.spawn[2] as number],
        seed,
        scene: { id: s.scene.id, version: s.scene.version },
        transform: [s.transform.s, s.transform.t[0] ?? 0, s.transform.t[1] ?? 0, s.transform.t[2] ?? 0],
        created
    };
}

/** The worker's answer to `job` as the page reads it; null for an answer to another job. */
export function courseAnswer(m: FromCourseWorker, job: number): CourseAnswer | null {
    if (m.job !== job) return null;
    if (m.t === 'track') return m.track ? { ok: true, track: m.track } : { ok: false, why: 'none fits' };
    return { ok: false, why: 'failed' };
}

export function randomSeed(): number {
    return Math.floor(Math.random() * 0xffffffff) >>> 0;
}

/** A worker of its own (made on the first ask, ended after each answer: a course is asked for seldom, and the walls copy is large). */
export function askCourse(s: CourseSource, seed: number): Promise<CourseAnswer> {
    const msg = courseJob(s, seed, 1, new Date().toISOString());
    if (!msg) return Promise.resolve({ ok: false, why: 'no walls' });
    return new Promise((resolve) => {
        const worker = new Worker(new URL('../course/worker.ts', import.meta.url), { type: 'module' });
        const done = (a: CourseAnswer): void => {
            clearTimeout(timer);
            worker.terminate();
            resolve(a);
        };
        const timer = setTimeout(() => done({ ok: false, why: 'failed' }), COURSE_LIMIT_MS);
        worker.onmessage = (e: MessageEvent<FromCourseWorker>) => {
            const a = courseAnswer(e.data, msg.job);
            if (a) done(a);
        };
        worker.onerror = () => done({ ok: false, why: 'failed' });
        worker.postMessage(msg, [msg.nodes.buffer, msg.leaf.buffer]);
    });
}
