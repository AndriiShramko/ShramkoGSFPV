// The course in flight without the page (train 1, lane tracks, T2): a track, its gates in the flown world, the lap timer.
// The feature (app/builtin/course.ts) feeds it the craft's position and the sim's clock once per drawn frame; it only
// reads them, so the flight model, its input log and its trace hash are the same with a course as without
// (tools/bench/test/tracks-a6.test.ts). Gates are not solid. DOM-free: the A6 test runs it in Node.
import { trackToObjects } from '@shramko/sonic-fpv';
import type { SonicObject, TrackFile, Vec3, WorldCheckpoint } from '@shramko/sonic-fpv';
import { LapTimer, coursePath } from '@gsfpv/tracks';
import type { LapEvent, LapView } from '@gsfpv/tracks';

/** The scene transform as the session has it: T(p) = s * p + t. */
export interface FlownTransform { readonly s: number; readonly t: readonly number[] }

export class CourseRun {
    readonly track: TrackFile;
    readonly gates: readonly SonicObject[];
    readonly path: readonly WorldCheckpoint[];
    private readonly timer: LapTimer;
    private prev: Vec3 | null = null;

    constructor(track: TrackFile, tr: FlownTransform, bestMs: number | null = null) {
        this.track = track;
        const transform: [number, number, number, number] = [tr.s, tr.t[0] ?? 0, tr.t[1] ?? 0, tr.t[2] ?? 0];
        this.gates = trackToObjects(track, { transform });
        this.path = coursePath(track, transform);
        this.timer = new LapTimer(this.gates, { laps: track.laps, bestMs });
    }

    /**
     * The craft is at `pos` at sim time `tMs` (one tick = 1 ms). The step from the last position fed is checked against the
     * next gate: per drawn frame that is a straight line over a few ticks (an estimate of the flown arc, never wider than one
     * frame's flight).
     */
    feed(tMs: number, pos: Vec3): LapEvent | null {
        const a = this.prev;
        this.prev = [pos[0], pos[1], pos[2]];
        return a === null ? null : this.timer.step(tMs, a, this.prev);
    }

    pause(tMs: number): void {
        this.timer.pause(tMs);
    }

    resume(tMs: number): void {
        this.timer.resume(tMs);
        this.prev = null;
    }

    /** A respawn, a crash or the course switched off: the attempt ends; the next position starts a new line. */
    reset(): void {
        this.timer.reset();
        this.prev = null;
    }

    view(tMs?: number): LapView {
        return this.timer.view(tMs);
    }
}
