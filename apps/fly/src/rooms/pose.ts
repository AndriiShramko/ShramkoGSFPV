// Train 1, lane rooms: the pilot's own pose, read from the shown sim the way apps/fly/src/sonic/bridge.ts reads its
// FlightSample (s[S.px], s[S.qw], ...). Read only: nothing here writes into the sim, the input log or the runner, so an
// ordinary flight is the same flight with a room on (A6, tools/bench/test/rooms-a6.test.ts).
import { S } from '@gsfpv/sim-core';
import type { Sim } from '@gsfpv/sim-core';
import { FLAG_ARMED, FLAG_CRASHED, FLAG_PAUSED } from './codec';
import type { Pose } from './codec';

/** Poses sent a second (rooms-plan.md 2.2; the server keeps 20/s and closes above 60/s, docs/rooms-protocol.md). */
export const POSE_HZ = 15;

/** The pose of `sim` now; `paused`: the flight is paused or a replay runs. */
export function simPose(sim: Pick<Sim, 's' | 'ch' | 'tick' | 'crashed'>, seq: number, paused: boolean): Pose {
    const s = sim.s;
    let flags = 0;
    if (s[S.armed] > 0) flags |= FLAG_ARMED;
    if (sim.crashed) flags |= FLAG_CRASHED;
    if (paused) flags |= FLAG_PAUSED;
    return {
        flags,
        seq: seq & 0xffff,
        tick: sim.tick,
        pos: [s[S.px], s[S.py], s[S.pz]],
        quat: [s[S.qx], s[S.qy], s[S.qz], s[S.qw]],
        vel: [s[S.vx], s[S.vy], s[S.vz]],
        // channel 2 is the throttle, -1 low .. +1 full (sim.ts)
        throttle: Math.max(0, Math.min(1, (sim.ch[2] + 1) / 2))
    };
}

/**
 * Decides on each rendered frame whether a pose goes up: every frame whose time crossed the next 1/15 s boundary
 * (rooms-plan.md 2.2). A long frame sends one pose, not a burst; the boundary then restarts from that frame.
 */
export class PoseClock {
    private next = -Infinity;
    private seq = 0;
    constructor(private readonly hz = POSE_HZ) {}

    /** the seq of the pose to send at `nowMs`, or null when this frame sends none */
    due(nowMs: number): number | null {
        if (nowMs < this.next) return null;
        const period = 1000 / this.hz;
        this.next = nowMs - this.next > 2 * period ? nowMs + period : this.next + period;
        const s = this.seq;
        this.seq = (this.seq + 1) & 0xffff;
        return s;
    }
}
