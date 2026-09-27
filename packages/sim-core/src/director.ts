// RespawnDirector (docs/architecture-v03.md C.6, items 18 and 23): decides automatic respawns
// from the sim state alone. The runner calls decide() after every step and applies the request
// at that same tick, and every respawn is a log record, so replays never run the director and
// frame splits cannot move a respawn. Its counters are not in the hashed state.
//
// - After a crash at tick c (policy.auto): at c + delay, back rewindTicks along the recorded
//   path (or to the start). A crash within 3 s of the previous rewind goes back one more step:
//   5, 10, 15 s ... as far as the history reaches, then the start.
// - Stuck, flipped (Liftoff's rule): not crashed, up-vector y < 0.3, |v| < 0.2 m/s, |w| < 1 rad/s,
//   touching, for 1.5 s. Stuck, wedged: armed, throttle stick >= hover + 0.15, |v| < 0.1 m/s,
//   touching, for 3 s. Both rewind like a crash. An upright, disarmed craft is a landing: never.
//   |v| and |w| are the net motion of the pose over the last 100 ms, not one tick's values: a
//   craft at rest on a floor rocks in the contact solver at up to 3.8 rad/s and 0.17 m/s from
//   tick to tick (v0.2's sim too, measured on a voxel floor), while over 100 ms its pose moves
//   at most 0.27 rad/s and 0.018 m/s. Read per tick, not one tick in 3 s passed the flipped rule.

import { S } from './sim';
import { datan2 } from './dmath';
import type { Sim, SimEvent, ContactWorld } from './sim';
import type { RespawnOpts, RespawnReason } from './contracts';
import type { StateHistory } from './history';

export interface RespawnPolicy {
    auto: boolean;
    delayTicks: number;
    rewindTicks: number;
    target: 'rewind' | 'start';
    /** scenes.autoSwitch: after the delay, ask the scene host for the next scene instead */
    onCrash: 'respawn' | 'next-scene';
    platform: boolean;
    keepArmed: boolean;
    unstuck: boolean;
    refill: 'start' | 'respawn' | 'never';
}

/** A.8 defaults: auto on, 2 s, 5 s back along the path, platform, kept armed, unstuck, fresh pack at the start. */
export const DEFAULT_RESPAWN_POLICY: Readonly<RespawnPolicy> = {
    auto: true,
    delayTicks: 2000,
    rewindTicks: 5000,
    target: 'rewind',
    onCrash: 'respawn',
    platform: true,
    keepArmed: true,
    unstuck: true,
    refill: 'start'
};

export interface RespawnRequest {
    x: number;
    y: number;
    z: number;
    yawDeg: number;
    opts: RespawnOpts;
    reason: RespawnReason;
}

/** What the director last decided: for the "-5 s" label and the tests. */
export interface RespawnDecision {
    tick: number;
    reason: RespawnReason;
    kind: 'rewind' | 'start';
    /** the crash, the start of the stuck pose, or the key press */
    incidentTick: number;
    /** tick of the history sample it went back to (null for the start) */
    sampleTick: number | null;
    /** 1 = one rewindTicks back, 2 = two, ...; 0 for the start */
    backoff: number;
}

/** A crash this soon after a rewind goes further back (C.6 backoff), ticks. */
export const BACKOFF_WINDOW_TICKS = 3000;
/** Stuck poses must hold this long, ticks. */
export const FLIPPED_TICKS = 1500;
export const WEDGED_TICKS = 3000;
/** The touch and stillness checks run on this tick grid, so a stuck respawn lands 0-9 ticks after its hold time. */
export const TOUCH_EVERY_TICKS = 10;
/** |v| and |w| are the pose's net motion over this many ticks; the header says why. */
export const STILL_WINDOW_TICKS = 100;
const FLIPPED_UP_Y = 0.3;
const FLIPPED_V = 0.2;
const FLIPPED_W = 1;
const WEDGED_V = 0.1;
const WEDGED_ABOVE_HOVER = 0.15;
const TOUCH_MARGIN = 0.02;
const POSES = STILL_WINDOW_TICKS / TOUCH_EVERY_TICKS + 1;
const WINDOW_S = STILL_WINDOW_TICKS / 1000;

export class RespawnDirector {
    policy: RespawnPolicy;
    /** set by the scene host: called at crash + delay when policy.onCrash is 'next-scene' */
    onSceneIntent: ((tick: number) => void) | null = null;
    last: RespawnDecision | null = null;
    readonly history: StateHistory;
    private readonly spawn: () => [number, number, number, number];
    private readonly world: () => ContactWorld | null;
    private readonly boundRadius: number;
    private readonly hoverStick: number;
    private crashTick = -1;
    private manual: 'start' | 'rewind' | null = null;
    private flipSince = -1;
    private wedgeSince = -1;
    private lastRewind = -Infinity;
    private backoff = 0;
    // poses on the touch grid (x, y, z, qw, qx, qy, qz), for the net motion over the window
    private readonly poses = new Float64Array(POSES * 7);
    private poseN = 0;
    private moveV = Infinity;
    private moveW = Infinity;
    private readonly push = { x: 0, y: 0, z: 0 };

    /**
     * world: what "touching" is tested against. Pass the sim's contactWorld, so a craft flipped on
     * the invisible platform counts as lying on something. hoverStick: throttle stick 0..1 at hover.
     */
    constructor(policy: RespawnPolicy, spawn: () => [number, number, number, number], history: StateHistory, world: () => ContactWorld | null, boundRadius: number, hoverStick: number) {
        this.policy = { ...policy };
        this.spawn = spawn;
        this.history = history;
        this.world = world;
        this.boundRadius = boundRadius;
        this.hoverStick = hoverStick;
    }

    /** Every sim event in order (the runner forwards them, respawns included). It feeds the history too. */
    onEvent(e: SimEvent): void {
        this.history.onEvent(e);
        if (e.type === 'crash') {
            this.crashTick = this.policy.auto ? e.tick : -1;
            this.resetStuck();
        } else if (e.type === 'respawn') {
            this.crashTick = -1;
            this.resetStuck();
            this.poseN = 0; // the pose jumped: no motion across it
        }
    }

    /** Called by the runner after every step; the request is applied at this tick. It samples the history first. */
    decide(sim: Sim): RespawnRequest | null {
        this.history.onStep(sim);
        const t = sim.tick;
        const P = this.policy;
        const s = sim.s;
        const grid = t % TOUCH_EVERY_TICKS === 0;
        if (grid) this.samplePose(s);
        if (this.manual) {
            const k = this.manual;
            this.manual = null;
            return k === 'start' ? this.toStart(t, 'manual-start', t) : this.rewind(t, t, 'manual-rewind');
        }
        if (this.crashTick >= 0) {
            if (!P.auto) this.crashTick = -1;
            else if (t >= this.crashTick + P.delayTicks) {
                const c = this.crashTick;
                this.crashTick = -1;
                if (P.onCrash === 'next-scene' && this.onSceneIntent) {
                    this.onSceneIntent(t);
                    return null;
                }
                return P.target === 'start' ? this.toStart(t, 'crash', c) : this.rewind(t, c, 'crash');
            }
            return null;
        }
        if (!P.unstuck) return null;

        // body up-vector y (r11): 1 upright, -1 on its back
        const upY = 1 - 2 * (s[S.qx] * s[S.qx] + s[S.qz] * s[S.qz]);
        if (s[S.crashed] === 0 && upY < FLIPPED_UP_Y) {
            if (grid) {
                const still = this.moveV < FLIPPED_V && this.moveW < FLIPPED_W && this.touching(sim);
                // the still window began STILL_WINDOW_TICKS ago
                if (!still) this.flipSince = -1;
                else if (this.flipSince < 0) this.flipSince = t - STILL_WINDOW_TICKS;
            }
            if (this.flipSince >= 0 && t - this.flipSince >= FLIPPED_TICKS) return this.rewind(t, this.flipSince, 'stuck-flipped');
        } else this.flipSince = -1;

        const stick = (sim.ch[2] + 1) * 0.5;
        if (s[S.armed] > 0 && stick >= this.hoverStick + WEDGED_ABOVE_HOVER) {
            if (grid) {
                const still = this.moveV < WEDGED_V && this.touching(sim);
                if (!still) this.wedgeSince = -1;
                else if (this.wedgeSince < 0) this.wedgeSince = t - STILL_WINDOW_TICKS;
            }
            if (this.wedgeSince >= 0 && t - this.wedgeSince >= WEDGED_TICKS) return this.rewind(t, this.wedgeSince, 'stuck-wedged');
        } else this.wedgeSince = -1;
        return null;
    }

    /** R / Y from the page: applied at the next tick. */
    request(kind: 'start' | 'rewind'): void {
        this.manual = kind;
    }

    /** Enter: keep the wreck, cancel the pending automatic respawn. */
    keep(): void {
        this.crashTick = -1;
    }

    /** The automatic respawn waiting to happen, for the toast countdown. */
    pending(): { crashTick: number; atTick: number } | null {
        return this.crashTick >= 0 && this.policy.auto ? { crashTick: this.crashTick, atTick: this.crashTick + this.policy.delayTicks } : null;
    }

    private resetStuck(): void {
        this.flipSince = -1;
        this.wedgeSince = -1;
    }

    /** Records the pose on the grid; net speed and turn rate over the last STILL_WINDOW_TICKS, Infinity until that is filled. */
    private samplePose(s: Float64Array): void {
        const p = this.poses;
        const k = (this.poseN % POSES) * 7;
        p[k] = s[S.px]; p[k + 1] = s[S.py]; p[k + 2] = s[S.pz];
        p[k + 3] = s[S.qw]; p[k + 4] = s[S.qx]; p[k + 5] = s[S.qy]; p[k + 6] = s[S.qz];
        this.poseN++;
        if (this.poseN < POSES) {
            this.moveV = Infinity;
            this.moveW = Infinity;
            return;
        }
        const o = (this.poseN % POSES) * 7; // the oldest pose in the ring
        const dx = p[k] - p[o], dy = p[k + 1] - p[o + 1], dz = p[k + 2] - p[o + 2];
        this.moveV = Math.sqrt(dx * dx + dy * dy + dz * dz) / WINDOW_S;
        let dot = p[k + 3] * p[o + 3] + p[k + 4] * p[o + 4] + p[k + 5] * p[o + 5] + p[k + 6] * p[o + 6];
        if (dot < 0) dot = -dot;
        if (dot > 1) dot = 1;
        this.moveW = (2 * datan2(Math.sqrt(1 - dot * dot), dot)) / WINDOW_S;
    }

    private touching(sim: Sim): boolean {
        const w = this.world();
        const s = sim.s;
        return w !== null && w.pushOut(s[S.px], s[S.py], s[S.pz], this.boundRadius + TOUCH_MARGIN, this.push);
    }

    private rewind(t: number, incident: number, reason: RespawnReason): RespawnRequest {
        const P = this.policy;
        this.backoff = incident - this.lastRewind < BACKOFF_WINDOW_TICKS ? this.backoff + 1 : 1;
        const age = this.backoff * P.rewindTicks;
        const smp = age <= this.history.depthTicks ? this.history.pickBefore(incident, age) : null;
        if (!smp) return this.toStart(t, reason, incident);
        this.lastRewind = t;
        this.resetStuck();
        this.last = { tick: t, reason, kind: 'rewind', incidentTick: incident, sampleTick: smp.tick, backoff: this.backoff };
        return { x: smp.x, y: smp.y, z: smp.z, yawDeg: smp.yawDeg, opts: this.opts(P.refill === 'respawn'), reason };
    }

    private toStart(t: number, reason: RespawnReason, incident: number): RespawnRequest {
        const P = this.policy;
        const [x, y, z, yawDeg] = this.spawn();
        this.backoff = 0;
        this.lastRewind = -Infinity;
        this.resetStuck();
        this.last = { tick: t, reason, kind: 'start', incidentTick: incident, sampleTick: null, backoff: 0 };
        return { x, y, z, yawDeg, opts: this.opts(P.refill !== 'never'), reason };
    }

    private opts(freshPack: boolean): RespawnOpts {
        const o: RespawnOpts = { platform: this.policy.platform, keepArmed: this.policy.keepArmed };
        if (freshPack) o.soc = 1;
        return o;
    }
}
