// Page clock -> flight-model clock, and the input samples waiting for the physics. No DOM: the
// caller passes the page time in, so tests drive it with any clock.
//
// A sample is stamped when the physics takes it, not when it arrives. Between the two the clock
// can move: a pause ends, a new flight model starts at sim time 0, a stall is skipped. A sample
// stamped on the old clock then sits in the future, and the runner's queue is strictly in order,
// so every newer sample waits behind it (item 22: the arm switch still reached the arm gate, but
// the throttle did nothing for as long as the pause or stall had lasted).
import { MAX_CATCHUP_STEPS, DT_US } from '@gsfpv/sim-core';
import type { Runner } from '@gsfpv/sim-core';

const CAP = 8192; // ~16 s of a 500 Hz radio with no frame; older samples would never be applied anyway

export class SimClock {
    /** page ms that maps to sim time 0 */
    private t0 = 0;
    private pausedAt = 0;
    paused = false;
    // ring of samples not yet handed to the runner
    private tMs = new Float64Array(CAP);
    private ids = new Float64Array(CAP); // NaN: no id
    private chs = new Float32Array(CAP * 8);
    private head = 0;
    private count = 0;
    /** samples dropped because nothing took them for CAP samples */
    dropped = 0;

    /** A new flight model: sim time 0 is `now`, or the moment of resuming when paused now. */
    restart(now: number): void {
        this.t0 = now;
        // the new model has not lived through the pause so far: resuming must not skip it
        if (this.paused) this.pausedAt = now;
        this.head = 0;
        this.count = 0;
    }

    pause(on: boolean, now: number): void {
        if (on === this.paused) return;
        if (on) this.pausedAt = now;
        else this.t0 += now - this.pausedAt; // sim time does not advance while paused
        this.paused = on;
    }

    /** page time (ms, performance.now() / event.timeStamp) -> sim microseconds */
    toSimUs(tMs: number): number {
        return Math.round((tMs - this.t0) * 1000);
    }

    /** Queue one channel frame with its page time; it is stamped when the physics reaches it. */
    push(ch: ArrayLike<number>, tMs: number, id?: number): void {
        if (this.count === CAP) {
            this.head = (this.head + 1) % CAP;
            this.count--;
            this.dropped++;
        }
        const i = (this.head + this.count) % CAP;
        this.tMs[i] = tMs;
        this.ids[i] = id ?? NaN;
        for (let k = 0; k < 8; k++) this.chs[i * 8 + k] = ch[k] ?? 0;
        this.count++;
    }

    /** Samples not yet handed to the physics. */
    get pending(): number {
        return this.count;
    }

    /**
     * Step the runner up to `now`. The runner takes at most MAX_CATCHUP_STEPS steps per call and
     * counts a hitch when that is not enough; the rest of the wall time is then skipped, not
     * replayed. Only samples those steps reach are handed over, so the ones left are stamped on
     * the shifted clock next time and apply at once instead of waiting in the future.
     */
    advance(runner: Runner, now: number): void {
        if (this.paused) return;
        const target = this.toSimUs(now);
        const reach = Math.min(target, runner.tUs + MAX_CATCHUP_STEPS * DT_US);
        while (this.count > 0) {
            const i = this.head;
            const tUs = this.toSimUs(this.tMs[i]);
            if (tUs > reach) break;
            const id = this.ids[i];
            runner.enqueue({ tUs, ch: this.chs.subarray(i * 8, i * 8 + 8), id: Number.isNaN(id) ? undefined : id });
            this.head = (i + 1) % CAP;
            this.count--;
        }
        const before = runner.hitches;
        runner.advanceTo(target);
        // long stall (hidden tab, debugger): skip wall time instead of fast-forwarding physics
        if (runner.hitches > before) this.t0 += (target - runner.tUs) / 1000;
    }
}
