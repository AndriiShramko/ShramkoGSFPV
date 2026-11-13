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

    /** the flown transform the gates were laid with (lane review TR-5: a rescale in flight must re-lay and re-prove them) */
    readonly placedAt: string;

    constructor(track: TrackFile, tr: FlownTransform, bestMs: number | null = null) {
        this.track = track;
        this.placedAt = placementOf(tr);
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

    /** The scene's transform is no longer the one the gates were laid with (the scale feature changed it in flight). */
    stale(tr: FlownTransform): boolean {
        return placementOf(tr) !== this.placedAt;
    }
}

/** A transform as a key: scale and offset, as the session holds them. */
export function placementOf(tr: FlownTransform): string {
    return `${tr.s},${tr.t[0] ?? 0},${tr.t[1] ?? 0},${tr.t[2] ?? 0}`;
}

/**
 * Lane review TR-8: a course under `gatesMin` gates is not a course. `make(seed)` is tried with `seed`, then with seeds derived
 * from it (deterministic, so a link still rebuilds the same course on the same walls), at most `tries` times; the first with
 * at least `gatesMin` gates wins, else none (`short` says some had gates, but too few).
 */
export function enoughGates(make: (seed: number) => TrackFile, seed: number, gatesMin: number, tries = 3): { track: TrackFile | null; short: boolean; tried: number } {
    let short = false;
    let s = seed >>> 0;
    for (let i = 0; i < tries; i++) {
        const t = make(s & 0x7fffffff);
        if (t.gates.length >= gatesMin) return { track: t, short: false, tried: i + 1 };
        if (t.gates.length > 0) short = true;
        s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0;
    }
    return { track: null, short, tried: tries };
}
