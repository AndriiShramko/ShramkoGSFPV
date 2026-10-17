// Easy play's assists (docs/wip/v08-a.md section 1; the owner's message 21, items 1 and 6). Pure: no DOM,
// no clock of its own (the caller passes time), so Node tests fly them against the real Sim.
//
// Assists are INPUTS to the simulation: what they compute is a stick, sent through Controls and the
// arm gate into the flight log like any other source's channels. A replay replays those channels and
// never runs an assist, so the log stays exact and sim-core does not know assists exist (A6 untouched).
//
//  - AltitudeHelp: holds the height; a climb/sink command (-1..1) asks for a vertical speed instead of
//    a throttle. A vertical-speed PI with a feed-forward computed from the model's own numbers: the
//    thrust that gives the wanted acceleration at the craft's tilt, through the motor law
//    T = tmax(V) w^2, idle and the throttle curve (or the auto-throttle map) back to a stick.
//    It flies in angle mode only (helpFlies) and gives idle when the craft is on its side or
//    upside down (UPRIGHT_MIN_COS): thrust cannot hold the height there, it would push the craft down.
//  - AutoArm: starts the motors without an arm switch. The sim arms on an off -> on edge of the arm
//    channel with the throttle at the bottom (sim.ts step()), so the throttle is held low until the
//    model says armed, and a refused edge is retried.

import { S, autoThrottleStick, hoverThrOf, invertThrottle } from '@gsfpv/sim-core';
import type { FlightMode, SimParams } from '@gsfpv/sim-core';

/** Climb speed at full command, m/s (Shift: x CLIMB_BOOST). */
export const CLIMB_MPS = 2.5;
/** Sink speed at full command, m/s (Shift: x CLIMB_BOOST). Slower than the climb: the ground is below. */
export const SINK_MPS = 2;
/** Shift: climb and sink this much faster. */
export const CLIMB_BOOST = 2;
/** Vertical speed error -> acceleration, 1/s (time constant 0.25 s). */
export const KV = 4;
/** Integral gain on the vertical speed error, 1/s^2: soaks up drag, wind, sag and ground effect. */
export const KI = 2.5;
/** The integral's limit, m/s^2. */
export const I_MAX = 4;
/** Height error -> vertical speed while holding, 1/s, and its limit, m/s. */
export const HOLD_GAIN = 1.5;
export const HOLD_MAX_MPS = 1;
/** Command below this is "no command": hold the height. */
export const DEADBAND = 0.05;
/**
 * The steepest tilt the thrust is compensated for (cos 60 deg = 0.5, angle mode's default limit):
 * tilted further, the help asks for no more than twice the level thrust and the craft sinks.
 */
export const MIN_COS_TILT = 0.5;
/**
 * Below this cosine (about 78 deg: on its side or upside down) thrust cannot hold the height: it
 * pushes the craft sideways or toward the ground, and a speed controller that sees the craft fall
 * would push harder. The help then gives idle and holds its integral until the craft is upright
 * again (the 2026-10-16 review: a horizon flip with the thrust kept on lost about twice the height).
 */
export const UPRIGHT_MIN_COS = 0.2;

/**
 * The flight modes the altitude help flies in: angle only. Angle mode levels the craft within its
 * angle limit, so the thrust is always mostly up; horizon flips at full stick and acro does not
 * level at all, and there the pilot's own throttle flies (pilot school steps 3 and 4).
 */
export function helpFlies(mode: FlightMode): boolean {
    return mode === 'angle';
}

/**
 * The throttle stick (0..1) that makes `thrustN` in total from the four motors at loaded pack
 * voltage `volt`: the exact inverse of the model's thrust chain (sim.ts: T = tmax w^2 per motor,
 * tmax = tmaxMotorNom (V / vNom)^2, w = idle + (1 - idle) throttle, throttle = curve(stick)).
 */
export function stickForThrust(p: SimParams, volt: number, thrustN: number): number {
    const vr = volt / p.vNom;
    const tmax = p.tmaxMotorNom * vr * vr;
    if (!(tmax > 0)) return 1;
    const w = Math.sqrt(Math.max(0, thrustN) / (4 * tmax));
    let thr = (w - p.idle) / (1 - p.idle);
    thr = thr < 0 ? 0 : thr > 1 ? 1 : thr;
    if (p.gravityMode === 'auto-throttle') return autoThrottleStick(thr, (hoverThrOf(p) - p.idle) / (1 - p.idle));
    return invertThrottle(thr, p.throttle);
}

/** The cosine of the craft's tilt from level: the body's up axis against the world's up (r11 of its rotation). */
export function upCos(s: ArrayLike<number>): number {
    const qx = s[S.qx], qz = s[S.qz];
    return 1 - 2 * (qx * qx + qz * qz);
}

/** Height hold and climb/sink by speed. One per input source; reset() on a new life, a crash, a disarm. */
export class AltitudeHelp {
    private holdY: number | null = null;
    private iAcc = 0;
    /** the vertical speed asked for in the last update, m/s (for tests and the HUD) */
    target = 0;
    /** the craft was past UPRIGHT_MIN_COS in the last update: idle was sent (for tests and the bench) */
    tipped = false;
    /**
     * The cosine below which the help gives idle: UPRIGHT_MIN_COS. Only the tests' negative control
     * passes another value (-1: never, the help as first shipped, which pushed an upside-down craft down).
     */
    private readonly uprightMinCos: number;

    constructor(uprightMinCos = UPRIGHT_MIN_COS) {
        this.uprightMinCos = uprightMinCos;
    }

    reset(): void {
        this.holdY = null;
        this.iAcc = 0;
        this.target = 0;
        this.tipped = false;
    }

    /**
     * The throttle stick (0..1) for this moment. `lift`: -1..1 (up/down keys or the left stick),
     * `s`: the sim's state slots (S), `dtS`: seconds since the last update (0 on the first one).
     */
    update(lift: number, boost: boolean, p: SimParams, s: ArrayLike<number>, dtS: number): number {
        const k = boost ? CLIMB_BOOST : 1;
        if (Math.abs(lift) > DEADBAND) {
            const c = Math.max(-1, Math.min(1, lift));
            return this.follow(c > 0 ? c * CLIMB_MPS * k : c * SINK_MPS * k, p, s, dtS);
        }
        return this.follow(null, p, s, dtS);
    }

    /** Hold this height from now on (until a speed is asked for): a take-off that climbs to it. */
    holdAt(y: number): void {
        this.holdY = y;
    }

    /**
     * The throttle stick (0..1) that flies the vertical speed `vt` (m/s, up positive), or, with null,
     * holds the height (where the craft will stop, unless holdAt() set it). update() asks for the
     * speeds of easy play's climb and sink; the game scheme (play/game.ts) asks for its own.
     */
    follow(vt: number | null, p: SimParams, s: ArrayLike<number>, dtS: number): number {
        const vy = s[S.vy];
        const py = s[S.py];
        if (vt !== null) {
            this.holdY = null;
        } else {
            // released: hold where the craft will stop (about one time constant of travel ahead)
            if (this.holdY === null) this.holdY = py + vy / KV;
            vt = Math.max(-HOLD_MAX_MPS, Math.min(HOLD_MAX_MPS, HOLD_GAIN * (this.holdY - py)));
        }
        this.target = vt;
        const err = vt - vy;
        const cosTilt = upCos(s);
        // on its side or upside down: idle, and the integral waits (the fall is not an error thrust can fix)
        this.tipped = cosTilt < this.uprightMinCos;
        if (this.tipped) return stickForThrust(p, s[S.volt], 0);
        const dt = dtS > 0 && dtS < 0.25 ? dtS : 0; // a stalled page is not time the help should integrate
        this.iAcc = Math.max(-I_MAX, Math.min(I_MAX, this.iAcc + KI * err * dt));
        const g = p.gravity;
        const a = Math.max(-0.9 * g, Math.min(1.5 * g + 3, KV * err + this.iAcc));
        const up = Math.max(MIN_COS_TILT, cosTilt);
        return stickForThrust(p, s[S.volt], (p.mass * (g + a)) / up);
    }
}

/** What AutoArm needs to know each frame. */
export interface ArmSense {
    /** the model's armed flag */
    simArmed: boolean;
    /** the model is in a crash (the arm gate carries the switch through it, design C.3) */
    crashed: boolean;
    /** the flight is paused: no time passes for the retry */
    paused: boolean;
    /** page time, ms */
    now: number;
}

/** What AutoArm sends: the arm channel and whether the throttle must stay at the bottom. */
export interface ArmOut { arm: 1 | -1; holdLow: boolean }

/** An arm edge the model has not taken within this long is tried again (off, then on). */
export const ARM_RETRY_MS = 400;

/**
 * The arm switch of easy play. off -> (want) edge: one OFF frame -> arming: ON with the throttle held
 * low until the model is armed -> on. A model that drops out of armed by itself (the gate let go: a
 * hidden tab, a respawn that wants a new edge) goes back to off and waits for the next flying input;
 * a crash keeps ON, so respawn.keepArmed carries the craft through it like a radio's switch.
 */
export class AutoArm {
    state: 'off' | 'edge' | 'arming' | 'on' = 'off';
    /** the player wants to fly: set by a flying input (request), cleared by stop() or when the model drops out */
    want = false;
    private since = 0;
    private waited = 0;

    /** A flying key or a touch on a stick: start the motors if they are off. */
    request(): void {
        this.want = true;
    }

    /** Motors off (Space in easy play): the next flying input starts them again. */
    stop(): void {
        this.want = false;
    }

    step(i: ArmSense): ArmOut {
        switch (this.state) {
            case 'off':
                if (this.want && !i.paused) this.state = 'edge';
                return { arm: -1, holdLow: true };
            case 'edge':
                this.state = 'arming';
                this.since = i.now;
                this.waited = 0;
                return { arm: -1, holdLow: true };
            case 'arming':
                if (i.simArmed) { this.state = 'on'; return { arm: 1, holdLow: false }; }
                if (!this.want) { this.state = 'off'; return { arm: -1, holdLow: true }; }
                if (!i.paused) this.waited += Math.max(0, i.now - this.since);
                this.since = i.now;
                if (this.waited > ARM_RETRY_MS && !i.crashed) { this.state = 'edge'; return { arm: -1, holdLow: true }; }
                return { arm: 1, holdLow: true };
            case 'on':
                if (!this.want) { this.state = 'off'; return { arm: -1, holdLow: true }; }
                if (!i.simArmed && !i.crashed && !i.paused) {
                    // the model dropped out by itself: wait on the ground for the player's next input
                    this.state = 'off';
                    this.want = false;
                    return { arm: -1, holdLow: true };
                }
                return { arm: 1, holdLow: false };
        }
    }

    /** Back to off, nothing wanted (a new input source, a new gate). */
    reset(): void {
        this.state = 'off';
        this.want = false;
    }
}
