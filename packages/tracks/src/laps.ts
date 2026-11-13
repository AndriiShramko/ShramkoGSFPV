// The lap timer of a course (train 1, lane tracks, stage T2; docs/wip/tracks-plan.md 2.5). Pure: no clock, no DOM. The
// caller feeds it the time and the craft's position before and after every physics step (flown world) and tells it about
// pauses and respawns; it answers which gate is next, the splits, the laps, the last and the best lap.
//
//   start     crossing gate 0 forward (the sound package's gateCrossing: from the gate's +Z side to its -Z side, inside
//             its opening) starts the clock. Only the gate that is next counts: a skipped gate stops the lap there, a
//             gate passed backward is no pass (gateCrossing answers null for it).
//   open      (track laps 1) the lap ends at the last gate; the attempt is over, gate 0 starts a new one.
//   closed    (laps > 1) after the last gate gate 0 again ends the lap and starts the next; after `laps` laps the
//             attempt is over.
//   pause     pause(t) .. resume(t) adds nothing to the lap; steps fed while paused are ignored.
//   respawn   reset() ends the attempt (a crash, R or Y): the clock stops, gate 0 is next again.
// The time of a pass is the time of the step that crossed (one physics step is 1 ms: sim-core DT).
import { gateCrossing } from '@shramko/sonic-fpv';
import type { SonicObject, Vec3 } from '@shramko/sonic-fpv';

export type LapEvent = 'start' | 'gate' | 'lap' | 'done';

export interface LapOptions {
    /** laps of one attempt (the track's `laps`); 1 = an open course that ends at its last gate */
    readonly laps: number;
    /** the best lap known before (kept by the caller per track, version and drone) */
    readonly bestMs?: number | null;
}

export interface LapView {
    readonly running: boolean;
    /** the gate to fly next (0-based) */
    readonly next: number;
    /** the lap flown now, 1-based (0 before the first start) */
    readonly lap: number;
    readonly lapsPerRun: number;
    /** finished laps of this attempt */
    readonly laps: number;
    /** time of this lap so far, ms (0 when not running) */
    readonly lapMs: number;
    /** the splits of this lap: ms from the lap's start to each gate passed */
    readonly splits: readonly number[];
    readonly lastLapMs: number | null;
    readonly bestLapMs: number | null;
}

export class LapTimer {
    private readonly gates: readonly SonicObject[];
    private readonly lapsPerRun: number;
    private running = false;
    private next = 0;
    private lapStart = 0;
    private pausedMs = 0;
    private pausedAt: number | null = null;
    private nowMs = 0;
    private splits: number[] = [];
    private lapTimes: number[] = [];
    private lastMs: number | null = null;
    private bestMs: number | null;

    constructor(gates: readonly SonicObject[], opts: LapOptions) {
        this.gates = gates;
        this.lapsPerRun = Math.max(1, Math.floor(opts.laps));
        this.bestMs = opts.bestMs ?? null;
    }

    get closed(): boolean {
        return this.lapsPerRun > 1;
    }

    /** One physics step from `a` to `b` ending at `tMs`; what happened, or null. */
    step(tMs: number, a: Vec3, b: Vec3): LapEvent | null {
        this.nowMs = tMs;
        if (this.pausedAt !== null) return null;
        const gate = this.gates[this.next];
        if (gate === undefined) return null;
        const x = gateCrossing(gate, a, b);
        if (x === null || !x.inside) return null;
        if (!this.running) {
            if (this.next !== 0) return null;
            this.running = true;
            this.lapStart = tMs;
            this.pausedMs = 0;
            this.splits = [];
            this.lapTimes = [];
            this.next = this.gates.length > 1 ? 1 : 0;
            return 'start';
        }
        const t = tMs - this.lapStart - this.pausedMs;
        if (this.next === 0) return this.endLap(t, tMs);
        this.splits.push(t);
        if (this.next < this.gates.length - 1) {
            this.next++;
            return 'gate';
        }
        if (this.closed) {
            this.next = 0;
            return 'gate';
        }
        return this.endLap(t, tMs);
    }

    private endLap(t: number, tMs: number): LapEvent {
        this.lapTimes.push(t);
        this.lastMs = t;
        if (this.bestMs === null || t < this.bestMs) this.bestMs = t;
        if (this.lapTimes.length >= this.lapsPerRun) {
            this.running = false;
            this.next = 0;
            this.splits = [];
            return 'done';
        }
        this.lapStart = tMs;
        this.pausedMs = 0;
        this.splits = [];
        this.next = this.gates.length > 1 ? 1 : 0;
        return 'lap';
    }

    /** The clock stops (the pause menu, a hidden tab). */
    pause(tMs: number): void {
        if (this.pausedAt === null) this.pausedAt = tMs;
    }

    resume(tMs: number): void {
        if (this.pausedAt === null) return;
        if (this.running) this.pausedMs += Math.max(0, tMs - this.pausedAt);
        this.pausedAt = null;
        this.nowMs = tMs;
    }

    /** A respawn or a crash: the attempt ends, gate 0 is next. The best lap stays. */
    reset(): void {
        this.running = false;
        this.next = 0;
        this.splits = [];
        this.lapTimes = [];
        this.pausedMs = 0;
        this.pausedAt = null;
    }

    /** The state at `tMs` (default: the last step's time). */
    view(tMs: number = this.nowMs): LapView {
        const at = this.pausedAt ?? tMs;
        return {
            running: this.running,
            next: this.next,
            lap: this.running ? this.lapTimes.length + 1 : this.lapTimes.length,
            lapsPerRun: this.lapsPerRun,
            laps: this.lapTimes.length,
            lapMs: this.running ? Math.max(0, at - this.lapStart - this.pausedMs) : 0,
            splits: [...this.splits],
            lastLapMs: this.lastMs,
            bestLapMs: this.bestMs
        };
    }
}
