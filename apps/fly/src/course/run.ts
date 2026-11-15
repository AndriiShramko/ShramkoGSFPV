// The course in flight without the page (train 1, lane tracks, T2): a track, its gates in the flown world, the lap timer.
// The feature (app/builtin/course.ts) feeds it the craft's position and the sim's clock once per drawn frame; it only
// reads them, so the flight model, its input log and its trace hash are the same with a course as without
// (tools/bench/test/tracks-a6.test.ts). Gates are not solid. DOM-free: the A6 test runs it in Node.
import { trackToObjects } from '@shramko/sonic-fpv';
import type { SonicObject, TrackFile, Vec3, WorldCheckpoint } from '@shramko/sonic-fpv';
import { S } from '@gsfpv/sim-core';
import { LapTimer, coursePath } from '@gsfpv/tracks';
import type { LapEvent, LapState, LapView } from '@gsfpv/tracks';

/** Changes of the attempt kept for a rewind: a 24-gate course gives about 26 a lap, so this is many laps back. */
const MARKS_MAX = 512;

/** What the respawn director last decided (sim-core RespawnDecision, the fields the course reads). */
export interface LifeDecision {
    readonly tick: number;
    readonly kind: 'rewind' | 'start';
    readonly sampleTick: number | null;
}

/** The reasons of a life the respawn director decides (sim-core RespawnReason); the others are new flights. */
const DIRECTED: readonly string[] = ['crash', 'stuck-flipped', 'stuck-wedged', 'manual-start', 'manual-rewind'];

/** What a new life of the craft does to the course (CourseRun.afterLife). */
export type CourseLife = { readonly kind: 'keep' } | { readonly kind: 'restart' } | { readonly kind: 'rewind'; readonly to: number };

/**
 * The course follows the respawn (the owner's message 51). `reason` is the new life's (AppEvents 'life'), `last` the director's
 * decision, fresh only when made at this tick `nowTick`:
 * - back at the start (R, a crash or a stuck craft with the respawn target 'start', a rewind with no path left): restart;
 * - Y (manual-rewind): the course goes back to what it was at the moment the craft is put back to;
 * - a crash or a stuck craft respawned where it was ('rewind' target): keep the lap, the next gate and the running clock;
 * - anything else (a new flight model, the settings, the scene, the world): restart, as before.
 */
export function courseLife(reason: string, last: LifeDecision | null, nowTick: number): CourseLife {
    if (!DIRECTED.includes(reason) || last === null || last.tick !== nowTick) return { kind: 'restart' };
    if (last.kind === 'start' || last.sampleTick === null) return { kind: 'restart' };
    if (reason === 'manual-rewind') return { kind: 'rewind', to: last.sampleTick };
    return { kind: 'keep' };
}

/** The scene transform as the session has it: T(p) = s * p + t. */
export interface FlownTransform { readonly s: number; readonly t: readonly number[] }

export class CourseRun {
    readonly track: TrackFile;
    readonly gates: readonly SonicObject[];
    readonly path: readonly WorldCheckpoint[];
    private readonly timer: LapTimer;
    private prev: Vec3 | null = null;
    /** the attempt after every change, by sim tick, oldest first (a rewind finds the one that held at its tick) */
    private marks: { t: number; s: LapState }[] = [];

    /** the flown transform the gates were laid with (lane review TR-5: a rescale in flight must re-lay and re-prove them) */
    readonly placedAt: string;

    constructor(track: TrackFile, tr: FlownTransform, bestMs: number | null = null) {
        this.track = track;
        this.placedAt = placementOf(tr);
        const transform: [number, number, number, number] = [tr.s, tr.t[0] ?? 0, tr.t[1] ?? 0, tr.t[2] ?? 0];
        this.gates = trackToObjects(track, { transform });
        this.path = coursePath(track, transform);
        this.timer = new LapTimer(this.gates, { laps: track.laps, bestMs });
        this.marks = [{ t: -Infinity, s: this.timer.snapshot() }];
    }

    /**
     * The craft is at `pos` at sim time `tMs` (one tick = 1 ms). The step from the last position fed is checked against the
     * next gate: per drawn frame that is a straight line over a few ticks (an estimate of the flown arc, never wider than one
     * frame's flight).
     */
    feed(tMs: number, pos: Vec3): LapEvent | null {
        const a = this.prev;
        this.prev = [pos[0], pos[1], pos[2]];
        const ev = a === null ? null : this.timer.step(tMs, a, this.prev);
        if (ev !== null) this.mark(tMs);
        return ev;
    }

    /**
     * One drawn frame of the feature (app/builtin/course.ts frame()): the sim's clock and the craft's position are read, never
     * written. The A6 test drives this same function around the real sim (lane review TR-12).
     */
    fromSim(sim: { readonly tick: number; readonly s: ArrayLike<number> }): { ev: LapEvent | null; view: LapView } {
        const ev = this.feed(sim.tick, [sim.s[S.px]!, sim.s[S.py]!, sim.s[S.pz]!]);
        return { ev, view: this.view(sim.tick) };
    }

    pause(tMs: number): void {
        this.timer.pause(tMs);
        this.mark(tMs);
    }

    resume(tMs: number): void {
        this.timer.resume(tMs);
        this.prev = null;
        this.mark(tMs);
    }

    /** Lane mix (X2): Fly by Sound on or off; in it the flat squares and cube frames pass by the ball (laps.ts soundBallM). */
    byEar(on: boolean): void {
        this.timer.setByEar(on);
    }

    /** R to the start, a new flight model or the course switched off: the attempt ends; the next position starts a new line. */
    reset(): void {
        this.timer.reset();
        this.prev = null;
        this.marks = [{ t: -Infinity, s: this.timer.snapshot() }];
    }

    /**
     * A new life of the craft (the owner's message 51: "the course progress must be tied to the respawn"), as courseLife
     * decided it at sim tick `nowTick`: 'keep' flies on with the lap, the next gate and the running clock; 'restart' is
     * reset(); 'rewind' puts the attempt back to what it was at tick `to`, its clock too. The jump of the craft is never a pass.
     */
    afterLife(l: CourseLife, nowTick: number): void {
        this.prev = null;
        if (l.kind === 'restart') return this.reset();
        if (l.kind === 'keep') return;
        let i = this.marks.length - 1;
        while (i >= 0 && this.marks[i]!.t > l.to) i--;
        if (i < 0) return this.reset();
        this.timer.restore(this.marks[i]!.s, l.to, nowTick);
        this.marks.length = i + 1;
        this.mark(nowTick);
    }

    /** the attempt changed at `t`: kept for a later rewind (oldest dropped past MARKS_MAX) */
    private mark(t: number): void {
        this.marks.push({ t, s: this.timer.snapshot() });
        if (this.marks.length > MARKS_MAX) this.marks.splice(0, this.marks.length - MARKS_MAX);
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
