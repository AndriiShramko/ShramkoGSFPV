// Train 1, lane rooms: another pilot's drone drawn from the poses that came in (rooms-plan.md 2.2). Remote drones are
// interpolated, never simulated: a 150 ms playout buffer on the server's clock, Hermite between the two poses around the
// time shown (the poses' velocities as tangents), slerp for the attitude; past the newest pose the drone flies on along
// its velocity for at most 250 ms, then it stops (frozen: the connection is lost).
//
// Time of a pose: the sender's sim tick is 1 ms of its flight (DT_US = 1000 in sim-core), so the poses keep their own
// exact spacing whatever the network did; tick -> server ms is the smallest (serverMs - tick) of the recent poses (the
// fastest path through the network and the server's 15 Hz tick). A tick that goes back (a new life, a new scene) or a
// jump of that difference by more than half a second (the sender paused) starts the track again.
// The error bound is measured on scripted poses with jitter and loss in tools/bench/test/rooms-interp.test.ts.
import type { Pose, Quat4, Vec3 } from './codec';

/** rooms-plan.md 2.2 */
export const PLAYOUT_MS = 150;
/** rooms-plan.md 2.2 */
export const EXTRAPOLATE_MS = 250;
/** a jump of (serverMs - tick) that means the sender paused or switched scene (estimate) */
export const RESTART_JUMP_MS = 500;
/** poses the tick -> server ms mapping is the minimum of: about 4 s at 15 Hz (estimate) */
export const MAP_WINDOW = 64;
/** poses kept at most (about 4 s at 15 Hz) */
const KEEP = 64;

export interface TrackOptions { playoutMs?: number; extrapolateMs?: number }

export interface Shown {
    pos: Vec3;
    /** x y z w */
    quat: Quat4;
    /** past the extrapolation limit: the drone stopped where it was */
    frozen: boolean;
    /** the sender's tick shown (ms of its flight) */
    tick: number;
    flags: number;
    throttle: number;
}

interface Kept { tick: number; pose: Pose }

export class RemoteTrack {
    private kept: Kept[] = [];
    private diffs: number[] = [];
    private base = 0;
    /** local ms the newest new pose came in (for ageMs) */
    lastArrival = -Infinity;
    private readonly playout: number;
    private readonly extrap: number;

    constructor(o: TrackOptions = {}) {
        this.playout = o.playoutMs ?? PLAYOUT_MS;
        this.extrap = o.extrapolateMs ?? EXTRAPOLATE_MS;
    }

    get size(): number {
        return this.kept.length;
    }

    /** A pose of this pilot from a snapshot stamped `serverMs`, arrived at local `localMs`. */
    push(serverMs: number, pose: Pose, localMs: number): void {
        const last = this.kept[this.kept.length - 1];
        const d = serverMs - pose.tick;
        if (last && pose.tick === last.tick) {
            // the same pose again (the server repeats the newest; a paused sender sends the same tick): only its flags
            last.pose = pose;
            return;
        }
        this.lastArrival = localMs;
        if (!last || pose.tick < last.tick || d > this.base + RESTART_JUMP_MS) {
            this.kept = [];
            this.diffs = [];
        }
        this.diffs.push(d);
        if (this.diffs.length > MAP_WINDOW) this.diffs.shift();
        this.base = Math.min(...this.diffs);
        this.kept.push({ tick: pose.tick, pose });
        if (this.kept.length > KEEP) this.kept.shift();
    }

    /** The drone at the server's ms `serverNow` (null before any pose). */
    sample(serverNow: number): Shown | null {
        const k = this.kept;
        if (k.length === 0) return null;
        const at = serverNow - this.playout - this.base;
        const first = k[0], last = k[k.length - 1];
        if (at <= first.tick) return shown(first.pose, first.pose.pos, first.pose.quat, false, first.tick);
        if (at >= last.tick) {
            const e = Math.min(at - last.tick, this.extrap);
            const v = last.pose.vel, p = last.pose.pos;
            const pos: Vec3 = [p[0] + (v[0] * e) / 1000, p[1] + (v[1] * e) / 1000, p[2] + (v[2] * e) / 1000];
            return shown(last.pose, pos, last.pose.quat, at - last.tick > this.extrap, last.tick + e);
        }
        let i = k.length - 2;
        while (i > 0 && k[i].tick > at) i--;
        const a = k[i], b = k[i + 1];
        const hMs = b.tick - a.tick;
        const u = (at - a.tick) / hMs;
        const h = hMs / 1000;
        const u2 = u * u, u3 = u2 * u;
        const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
        const pa = a.pose.pos, pb = b.pose.pos, va = a.pose.vel, vb = b.pose.vel;
        const pos = [0, 1, 2].map((j) => h00 * pa[j] + h10 * h * va[j] + h01 * pb[j] + h11 * h * vb[j]) as Vec3;
        // drop what is more than a second behind the time shown
        while (k.length > 2 && k[1].tick < at - 1000) k.shift();
        return shown(u < 0.5 ? a.pose : b.pose, pos, slerp(a.pose.quat, b.pose.quat, u), false, at);
    }
}

function shown(p: Pose, pos: Vec3, quat: Quat4, frozen: boolean, tick: number): Shown {
    return { pos, quat, frozen, tick, flags: p.flags, throttle: p.throttle };
}

/** Spherical interpolation of two unit quaternions (x y z w), the short way round. */
export function slerp(a: Quat4, b: Quat4, u: number): Quat4 {
    let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
    let s = 1;
    if (dot < 0) { dot = -dot; s = -1; }
    let wa: number, wb: number;
    if (dot > 0.9995) {
        wa = 1 - u;
        wb = u;
    } else {
        const th = Math.acos(Math.min(1, dot));
        const sin = Math.sin(th);
        wa = Math.sin((1 - u) * th) / sin;
        wb = Math.sin(u * th) / sin;
    }
    const q = [0, 1, 2, 3].map((j) => wa * a[j] + s * wb * b[j]) as Quat4;
    const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
    return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}
