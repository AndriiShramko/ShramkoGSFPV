// RespawnDirector (docs/architecture-v03.md C.6, items 18 and 23): decides automatic respawns
// from the sim state alone. The runner calls decide() after every step and applies the request
// at that same tick, and every respawn is a log record, so replays never run the director and
// frame splits cannot move a respawn. Its counters are not in the hashed state.
//
// - After a crash at tick c (policy.auto): at c + delay, back rewindTicks along the recorded
//   path (or to the start). A crash within 3 s of the previous rewind goes back one more step:
//   5, 10, 15 s ... as far as the history reaches, then the start. The path is the one the pilot
//   flew: a rewind cuts the stretch it undid out of it, R starts a new one (history.ts, C5).
// - Stuck, flipped (Liftoff's rule): not crashed, up-vector y < 0.3, |v| < 0.2 m/s, |w| < 1 rad/s,
//   touching, for 1.5 s. Stuck, wedged: armed, throttle stick >= hover + 0.15, |v| < 0.1 m/s,
//   touching, for 3 s. Both rewind like a crash. An upright, disarmed craft is a landing: never.
//
// How still is measured (a deviation from the design's wording, kept narrow):
//   |v| is the largest distance the body centre got from where it was 100 ms earlier, per second;
//   |w| is the same for the body's up direction (its tilt), in rad/s. Not one tick's values: a
//   craft at rest in the contact solver rocks at up to 6 rad/s and 0.17 m/s from tick to tick
//   (v0.2's sim too), so read per tick not one tick in 3 s passed the flipped rule. Not the whole
//   rotation either: on the 39e63ce9 voxel floor a craft lying on its back spins about its own up
//   axis at a steady 150 deg/s (contact chatter, about 107 contact events/s) while its tilt only
//   wobbles by 1.3 deg, and a spin about the up axis does not change "lying on its back". Its
//   whole rotation never read under 1.79 rad/s, so the design's |w| never let it count as still
//   (0 respawns in 20 s); its tilt rate stays under 0.66 rad/s. The largest deviation, not the
//   net change, so a rocking that happens to come back after exactly 100 ms still reads as motion.

import { S } from './sim';
import { datan2 } from './dmath';
import { hoverSolve } from './params';
import type { Sim, SimEvent, ContactWorld } from './sim';
import type { SimParams } from './params';
import type { RespawnOpts, RespawnReason } from './contracts';
import type { StateHistory, PathEdit } from './history';

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
    /** back along the recorded path (the log keeps it as a flag, the stats count it); false = the start */
    rewind?: boolean;
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
    /** how far back along the pilot's path the sample is from the incident, ticks (null for the start) */
    pathAgeTicks: number | null;
}

/** A crash this soon after a rewind goes further back (C.6 backoff), ticks. */
export const BACKOFF_WINDOW_TICKS = 3000;
/** Stuck poses must hold this long, ticks. */
export const FLIPPED_TICKS = 1500;
export const WEDGED_TICKS = 3000;
/** The touch and stillness checks run on this tick grid, so a stuck respawn lands 0-9 ticks after its hold time. */
export const TOUCH_EVERY_TICKS = 10;
/** |v| and |w| are the pose's largest deviation over this many ticks; the header says why. */
export const STILL_WINDOW_TICKS = 100;
const FLIPPED_UP_Y = 0.3;
const FLIPPED_V = 0.2;
const FLIPPED_W = 1;
const WEDGED_V = 0.1;
const WEDGED_ABOVE_HOVER = 0.15;
const TOUCH_MARGIN = 0.02;
const POSES = STILL_WINDOW_TICKS / TOUCH_EVERY_TICKS + 1;
const WINDOW_S = STILL_WINDOW_TICKS / 1000;

/** The stick 0..1 that hovers a fresh pack, as the director reads it for a model (auto-throttle aware). */
export function hoverStickOf(p: SimParams): number {
    const s = hoverSolve(p, 1).stick;
    // a model that cannot hover: no stick is "above hover", so nothing is ever wedged
    return s === s ? s : Infinity;
}

export class RespawnDirector {
    policy: RespawnPolicy;
    /** set by the scene host: called at crash + delay when policy.onCrash is 'next-scene' */
    onSceneIntent: ((tick: number) => void) | null = null;
    last: RespawnDecision | null = null;
    readonly history: StateHistory;
    private readonly spawn: () => [number, number, number, number];
    private readonly world: () => ContactWorld | null;
    private boundRadiusNow: number;
    private hoverStickNow: number;
    /** the model the two values above belong to (null until the first decide) */
    private model: SimParams | null = null;
    private crashTick = -1;
    /** the crash of the current life, auto or not (Y rewinds from it), -1 when it has none */
    private crashedAt = -1;
    /** the path edit of the respawn this director just asked for, applied by its 'respawn' event */
    private edit: PathEdit = null;
    private manual: 'start' | 'rewind' | null = null;
    private flipSince = -1;
    private wedgeSince = -1;
    private lastRewind = -Infinity;
    private backoff = 0;
    // poses on the touch grid (x, y, z, up x, up y, up z), for the motion over the span
    private readonly poses = new Float64Array(POSES * 6);
    private poseN = 0;
    private moveV = Infinity;
    private moveW = Infinity;
    private readonly push = { x: 0, y: 0, z: 0 };

    /**
     * world: what "touching" is tested against. Pass the sim's contactWorld, so a craft flipped on
     * the invisible platform counts as lying on something. boundRadius, hoverStick: of the model
     * the director starts with (hoverStickOf(p) gives the stick 0..1 at hover). When a 'life'
     * setting swaps in a new model (another drone, a new throttle curve, gravity), the director
     * takes both from that model at its first step.
     */
    constructor(policy: RespawnPolicy, spawn: () => [number, number, number, number], history: StateHistory, world: () => ContactWorld | null, boundRadius: number, hoverStick: number) {
        this.policy = { ...policy };
        this.spawn = spawn;
        this.history = history;
        this.world = world;
        this.boundRadiusNow = boundRadius;
        this.hoverStickNow = hoverStick;
    }

    /** body radius the touch test uses now, m */
    get boundRadius(): number {
        return this.boundRadiusNow;
    }

    /** throttle stick 0..1 at hover the wedged rule uses now */
    get hoverStick(): number {
        return this.hoverStickNow;
    }

    /** How still the craft is (the stuck rules' |v| m/s and |w| rad/s); Infinity until 100 ms of poses exist. */
    motion(): { v: number; w: number } {
        return { v: this.moveV, w: this.moveW };
    }

    /** Every sim event in order (the runner forwards them, respawns included). It feeds the history too. */
    onEvent(e: SimEvent): void {
        this.history.onEvent(e);
        if (e.type === 'crash') {
            this.crashTick = this.policy.auto ? e.tick : -1;
            this.crashedAt = e.tick;
            this.resetStuck();
        } else if (e.type === 'respawn') {
            this.crashTick = -1;
            this.crashedAt = -1;
            this.resetStuck();
            this.poseN = 0; // the pose jumped: no motion across it
            // a respawn this director did not ask for (a 'life' setting) goes on along the path
            this.history.respawned(e.tick, this.edit);
            this.edit = null;
        }
    }

    /** Called by the runner after every step; the request is applied at this tick. It samples the history first. */
    decide(sim: Sim): RespawnRequest | null {
        this.history.onStep(sim);
        if (sim.p !== this.model) {
            // a new model (the runner's newLife): its body and its hover, not the old drone's
            if (this.model !== null) {
                this.boundRadiusNow = sim.p.boundRadius;
                this.hoverStickNow = hoverStickOf(sim.p);
            }
            this.model = sim.p;
        }
        const t = sim.tick;
        const P = this.policy;
        const s = sim.s;
        const grid = t % TOUCH_EVERY_TICKS === 0;
        if (grid) this.samplePose(s);
        if (this.manual) {
            const k = this.manual;
            this.manual = null;
            // Y after a crash goes back from the crash, not from the key press
            return k === 'start' ? this.toStart(t, 'manual-start', t) : this.rewind(t, this.crashedAt >= 0 ? this.crashedAt : t, 'manual-rewind');
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
        if (s[S.armed] > 0 && stick >= this.hoverStickNow + WEDGED_ABOVE_HOVER) {
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

    /**
     * Records the pose on the grid. moveV / moveW: the largest distance of the centre, and the
     * largest angle of the body's up direction, from the pose STILL_WINDOW_TICKS ago, over that
     * span, per second; Infinity until the span is filled.
     */
    private samplePose(s: Float64Array): void {
        const p = this.poses;
        const k = (this.poseN % POSES) * 6;
        const qw = s[S.qw], qx = s[S.qx], qy = s[S.qy], qz = s[S.qz];
        p[k] = s[S.px]; p[k + 1] = s[S.py]; p[k + 2] = s[S.pz];
        // body up axis in world (the second column of the rotation matrix)
        p[k + 3] = 2 * (qx * qy - qw * qz); p[k + 4] = 1 - 2 * (qx * qx + qz * qz); p[k + 5] = 2 * (qy * qz + qw * qx);
        this.poseN++;
        if (this.poseN < POSES) {
            this.moveV = Infinity;
            this.moveW = Infinity;
            return;
        }
        const o = (this.poseN % POSES) * 6; // the oldest pose in the ring
        let d2 = 0;
        let tilt = 0;
        for (let j = 1; j < POSES; j++) {
            const i = ((this.poseN + j) % POSES) * 6;
            const dx = p[i] - p[o], dy = p[i + 1] - p[o + 1], dz = p[i + 2] - p[o + 2];
            const dd = dx * dx + dy * dy + dz * dz;
            if (dd > d2) d2 = dd;
            // angle between two unit vectors, well conditioned at 0 and at 180 deg: 2 atan2(|a - b|, |a + b|)
            const ax = p[i + 3] - p[o + 3], ay = p[i + 4] - p[o + 4], az = p[i + 5] - p[o + 5];
            const bx = p[i + 3] + p[o + 3], by = p[i + 4] + p[o + 4], bz = p[i + 5] + p[o + 5];
            const a = 2 * datan2(Math.sqrt(ax * ax + ay * ay + az * az), Math.sqrt(bx * bx + by * by + bz * bz));
            if (a > tilt) tilt = a;
        }
        this.moveV = Math.sqrt(d2) / WINDOW_S;
        this.moveW = tilt / WINDOW_S;
    }

    private touching(sim: Sim): boolean {
        const w = this.world();
        const s = sim.s;
        return w !== null && w.pushOut(s[S.px], s[S.py], s[S.pz], this.boundRadiusNow + TOUCH_MARGIN, this.push);
    }

    private rewind(t: number, incident: number, reason: RespawnReason): RespawnRequest {
        const P = this.policy;
        this.backoff = incident - this.lastRewind < BACKOFF_WINDOW_TICKS ? this.backoff + 1 : 1;
        const age = this.backoff * P.rewindTicks;
        const smp = age <= this.history.depthTicks ? this.history.pickBefore(incident, age) : null;
        if (!smp) return this.toStart(t, reason, incident);
        this.lastRewind = t;
        this.resetStuck();
        this.edit = { rewindTo: smp.tick };
        this.last = { tick: t, reason, kind: 'rewind', incidentTick: incident, sampleTick: smp.tick, backoff: this.backoff, pathAgeTicks: this.history.pathTick(incident) - smp.path };
        return { x: smp.x, y: smp.y, z: smp.z, yawDeg: smp.yawDeg, opts: this.opts(P.refill === 'respawn'), reason, rewind: true };
    }

    private toStart(t: number, reason: RespawnReason, incident: number): RespawnRequest {
        const P = this.policy;
        const [x, y, z, yawDeg] = this.spawn();
        this.backoff = 0;
        this.lastRewind = -Infinity;
        this.resetStuck();
        this.edit = 'restart';
        this.last = { tick: t, reason, kind: 'start', incidentTick: incident, sampleTick: null, backoff: 0, pathAgeTicks: null };
        return { x, y, z, yawDeg, opts: this.opts(P.refill !== 'never'), reason, rewind: false };
    }

    private opts(freshPack: boolean): RespawnOpts {
        const o: RespawnOpts = { platform: this.policy.platform, keepArmed: this.policy.keepArmed };
        if (freshPack) o.soc = 1;
        return o;
    }
}
