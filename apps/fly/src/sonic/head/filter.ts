// From the tracker's raw poses to the pose the ears follow (lane head4). Pure. A one-euro filter smooths the jitter of a
// webcam tracker while letting a quick turn through (Casiez, Roussel, Vogel 2012; Cat3DA smooths the same way); the
// pose the pilot holds when centring becomes zero; the pose is clamped; a lost face holds its last pose, then glides
// back to straight ahead and reports the loss once. The craft-frame codes of the sound package never depend on any of
// this, so losing the face loses only the movement cue, never information.

import { clampPose, mixPose, STRAIGHT, subtractPose, type HeadPose } from './pose';

export interface OneEuroParams {
    /** Hz: the cut-off at rest (lower = steadier) */
    readonly minCutoffHz: number;
    /** how much the cut-off rises with speed, per degree a second (higher = less lag in a quick turn) */
    readonly beta: number;
    /** Hz: the cut-off of the speed estimate */
    readonly derivCutoffHz: number;
}

/** [guess] the published starting values for a pointer in degrees; tuned on a recorded head turn in stage H3. */
export const HEAD_ONE_EURO: OneEuroParams = { minCutoffHz: 1, beta: 0.02, derivCutoffHz: 1 };

function alpha(cutoffHz: number, dtS: number): number {
    const tau = 1 / (2 * Math.PI * cutoffHz);
    return 1 / (1 + tau / dtS);
}

/** One channel of a one-euro filter. */
export class OneEuro {
    private x: number | null = null;
    private dx = 0;
    private tMs = 0;

    constructor(private readonly p: OneEuroParams = HEAD_ONE_EURO) {}

    reset(value: number | null, tMs = 0): void {
        this.x = value;
        this.dx = 0;
        this.tMs = tMs;
    }

    filter(value: number, tMs: number): number {
        if (this.x === null) {
            this.reset(value, tMs);
            return value;
        }
        const dtS = Math.max(1e-3, (tMs - this.tMs) / 1000);
        this.tMs = tMs;
        const rawDx = (value - this.x) / dtS;
        this.dx += alpha(this.p.derivCutoffHz, dtS) * (rawDx - this.dx);
        const cutoff = this.p.minCutoffHz + this.p.beta * Math.abs(this.dx);
        this.x += alpha(cutoff, dtS) * (value - this.x);
        return this.x;
    }
}

/** How long a lost face holds its last pose, and how long the glide back to straight ahead takes, ms [guess, plan 1.3]. */
export const LOST_HOLD_MS = 500;
export const LOST_GLIDE_MS = 300;

/** What one tracker result did to the pose. */
export type HeadEvent = 'none' | 'centred' | 'lost' | 'found';

export interface HeadStep {
    readonly pose: HeadPose;
    readonly event: HeadEvent;
    /** a face is being tracked now */
    readonly tracking: boolean;
}

/**
 * The pose the ears follow. `step(raw, tMs)` once per tracker result (`raw` null: no face in this picture) and
 * `tick(tMs)` on frames without a result (the hold and the glide go on by time). The first face after start is the
 * centre; `recentre()` makes the next face the centre again (the pilot faces the screen and presses the key).
 */
export class HeadPoseFilter {
    private readonly yaw: OneEuro;
    private readonly pitch: OneEuro;
    private readonly roll: OneEuro;
    private centre: HeadPose | null = null;
    private out: HeadPose = STRAIGHT;
    private lastFaceMs: number | null = null;
    /** the pose at the start of the glide back, null when not gliding or the glide is done */
    private glideFrom: HeadPose | null = null;
    private lostSaid = false;
    private faceSeen = false;

    constructor(p: OneEuroParams = HEAD_ONE_EURO) {
        this.yaw = new OneEuro(p);
        this.pitch = new OneEuro(p);
        this.roll = new OneEuro(p);
    }

    get pose(): HeadPose {
        return this.out;
    }

    /** the next face seen becomes straight ahead */
    recentre(): void {
        this.centre = null;
    }

    step(raw: HeadPose | null, tMs: number): HeadStep {
        if (raw === null) return this.tick(tMs);
        let event: HeadEvent = 'none';
        if (this.centre === null) {
            this.centre = raw;
            this.resetFilters(this.out, tMs);
            event = 'centred';
        } else if (this.lostSaid) {
            // back from a glide: start the smoothing from where the ears are now, so the return is a glide too
            this.resetFilters(this.out, tMs);
            event = 'found';
        }
        this.lostSaid = false;
        this.glideFrom = null;
        this.lastFaceMs = tMs;
        this.faceSeen = true;
        const rel = clampPose(subtractPose(raw, this.centre));
        this.out = { yawDeg: this.yaw.filter(rel.yawDeg, tMs), pitchDeg: this.pitch.filter(rel.pitchDeg, tMs), rollDeg: this.roll.filter(rel.rollDeg, tMs) };
        return { pose: this.out, event, tracking: true };
    }

    tick(tMs: number): HeadStep {
        if (!this.faceSeen || this.lastFaceMs === null) return { pose: this.out, event: 'none', tracking: false };
        const since = tMs - this.lastFaceMs;
        // a face missing for a few pictures still counts as tracked: the ears hold its last pose
        if (since <= LOST_HOLD_MS) return { pose: this.out, event: 'none', tracking: true };
        let event: HeadEvent = 'none';
        if (!this.lostSaid) {
            this.lostSaid = true;
            this.glideFrom = this.out;
            event = 'lost';
        }
        if (this.glideFrom !== null) {
            const k = Math.min(1, (since - LOST_HOLD_MS) / LOST_GLIDE_MS);
            this.out = mixPose(this.glideFrom, STRAIGHT, k);
            if (k >= 1) this.glideFrom = null;
        }
        return { pose: this.out, event, tracking: false };
    }

    private resetFilters(p: HeadPose, tMs: number): void {
        this.yaw.reset(p.yawDeg, tMs);
        this.pitch.reset(p.pitchDeg, tMs);
        this.roll.reset(p.rollDeg, tMs);
    }
}
