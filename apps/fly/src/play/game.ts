// The game scheme's assist layer (docs/wip/v09-b.md; the owner's message 22, item 1). Pure: no DOM, no clock
// of its own (the caller passes the time step and the model's state), so Node tests fly it against the real Sim.
//
// What a player of a game expects: the mouse looks, W A S D move relative to where the view faces, Space goes
// up, Shift goes down, and letting go of everything stops the character in place. A drone coasts and hovers
// on thrust, so this layer is the pilot that turns that intent into the sticks of the existing angle-mode
// physics, the way assist.ts does for easy play's altitude help:
//   - velocity: a target velocity in the world frame (keys, relative to the AIM heading), ramped, then a PI
//     loop on the velocity error -> wanted acceleration -> tilt angles (atan(a / g)) in the body's own
//     heading frame -> sticks through the drone's rate curve. No keys: target zero, the loop brakes and holds.
//   - height: AltitudeHelp (assist.ts) flies a vertical speed (Space / Shift) or holds the height; a sink is
//     limited by the ground below (a soft touch-down) and by the drone's crash speed.
//   - heading: the mouse (and the turn keys) move an AIM heading; a P loop on the heading error gives a yaw
//     rate, turned into a stick. The camera looks along the aim, so the view follows the mouse one to one
//     while the body catches up within a fraction of a second.
//   - gimbal: the mouse's vertical movement is the camera's pitch, -60..+30 degrees from the horizon; render only.
// What this layer computes is INPUT to the simulation (sticks through Controls and the arm gate into the
// flight log). A replay replays those channels and never runs this, and sim-core does not know it exists (A6).

import { S, setpointRate } from '@gsfpv/sim-core';
import type { RatesConfig, SimParams } from '@gsfpv/sim-core';
import { AltitudeHelp } from './assist';

/** prefs input.gameSpeed. */
export type GameSpeed = 'slow' | 'normal' | 'fast';
export const GAME_SPEED_IDS: readonly GameSpeed[] = ['slow', 'normal', 'fast'];

/** The speed target of each setting: horizontal and vertical, m/s. */
export const GAME_SPEEDS: Readonly<Record<GameSpeed, { horizontal: number; vertical: number }>> = {
    slow: { horizontal: 4, vertical: 3 },
    normal: { horizontal: 8, vertical: 5 },
    fast: { horizontal: 14, vertical: 8 }
};

/** The target velocity speeds up at this rate, m/s^2 (8 m/s in 1.3 s) ... */
export const ACCEL_MPS2 = 6;
/** ... and slows down at this rate when keys are let go (a drone brakes by tilting back, so a bit harder than it speeds up). */
export const BRAKE_MPS2 = 9;
/** Velocity error -> wanted acceleration, 1/s (a time constant of 0.4 s over the attitude loop's 0.2 s lag). */
export const KV_H = 2.5;
/** Integral gain on the velocity error, 1/s^2: soaks up drag, wind and the tilt a steady speed needs. */
export const KI_H = 2.5;
/** The integral decays by this much per second while the keys are let go, so a stop does not carry the drag of the run. */
export const I_LEAK_PER_S = 2;
/** The tilt the velocity loop may ask for, degrees (also never past the drone's own angle limit). */
export const TILT_MAX_DEG = 55;

/** Turn keys (arrows, Q / E) move the aim heading at this rate, degrees per second. */
export const KEY_TURN_DPS = 120;
/** Heading error -> yaw rate, 1/s (a time constant of 70 ms over the rate loop). */
export const KYAW = 14;

/** The camera gimbal's range from the horizon, degrees (up positive). */
export const GIMBAL_MIN_DEG = -60;
export const GIMBAL_MAX_DEG = 30;
/** Degrees of aim per pixel of mouse movement at sensitivity 1. */
export const MOUSE_DEG_PER_PX = 0.1;

/** A command (Space / Shift, the turn keys) ramps to full in 0.25 s. */
export const COMMAND_RAMP_PER_S = 4;
/** A sink is slowed to touch down at this deceleration, m/s^2 (the help can do 17; this one is gentle) ... */
export const FLARE_MPS2 = 2.5;
/** ... starting this much earlier than the height says, seconds of the present sink speed: the vertical loop lags its target. */
export const FLARE_LAG_S = 0.35;
/**
 * Touch-down speed: this share of the crash speed, and never more than TOUCH_MAX_MPS. Well under the
 * speed a landing bounces at (1.5 m/s on the presets), because the vertical loop lags its target and a
 * floor of voxels is not flat: measured on the real scan, 1.2 m/s touched down at 1.2-1.9 m/s and bounced.
 */
export const TOUCH_SHARE = 0.2;
export const TOUCH_MAX_MPS = 0.7;
/** A take-off from the ground climbs to this height, m. */
export const TAKEOFF_HOP_M = 1;
/** The ground within this clearance counts as "on the ground", m. */
export const ON_GROUND_M = 0.5;
/** Landed: Shift held, within LANDED_M of the ground and slower than LANDED_MPS for LANDED_S: the motors stop. */
export const LANDED_M = 0.15;
export const LANDED_MPS = 0.4;
export const LANDED_S = 0.5;

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/** An angle in degrees brought into (-180, 180]. */
export function wrap180(d: number): number {
    let x = d % 360;
    if (x > 180) x -= 360;
    else if (x <= -180) x += 360;
    return x;
}

/** Heading of the nose on the ground, degrees, right turn positive, 0 = -z (sim-core attitude().yaw, from the quaternion slots). */
export function headingDeg(s: ArrayLike<number>): number {
    const qw = s[S.qw], qx = s[S.qx], qy = s[S.qy], qz = s[S.qz];
    const r02 = 2 * (qx * qz + qw * qy);
    const r22 = 1 - 2 * (qx * qx + qy * qy);
    return Math.atan2(-r02, r22) * DEG;
}

/** Mouse movement in pixels -> degrees of aim: yaw right positive, pitch up positive (invertY flips it). */
export function mouseToAim(dxPx: number, dyPx: number, sensitivity: number, invertY: boolean): { yaw: number; pitch: number } {
    const k = MOUSE_DEG_PER_PX * sensitivity;
    // the mouse moves down the screen (dy > 0) = look down, unless inverted
    return { yaw: dxPx * k, pitch: (invertY ? dyPx : -dyPx) * k };
}

/**
 * A monotonic curve sampled once: from a stick (0..1) to a physical value (degrees or degrees per second),
 * inverted by interpolation. The drone's rate curve is the model's own (Betaflight, Actual, KISS ...), so
 * every drone answers a wish alike; sampling it makes the inverse cheap enough for every frame.
 */
export class StickCurve {
    private readonly xs: Float64Array;
    constructor(fn: (stick: number) => number, private readonly n = 128) {
        this.xs = new Float64Array(n + 1);
        for (let i = 0; i <= n; i++) this.xs[i] = fn(i / n);
    }

    /** The value at full stick. */
    get max(): number {
        return this.xs[this.n];
    }

    /** The stick (0..1) whose value is `x` (1 when the curve does not reach it). */
    stickFor(x: number): number {
        const xs = this.xs;
        if (!(x > xs[0])) return 0;
        if (x >= xs[this.n]) return 1;
        let lo = 0;
        let hi = this.n;
        while (hi - lo > 1) {
            const mid = (lo + hi) >> 1;
            if (xs[mid] <= x) lo = mid; else hi = mid;
        }
        const span = xs[hi] - xs[lo];
        return (lo + (span > 0 ? (x - xs[lo]) / span : 0)) / this.n;
    }
}

/** The curves of one drone: stick -> angle target (roll, pitch) and stick -> yaw rate. */
interface Curves { roll: StickCurve; pitch: StickCurve; yaw: StickCurve; limitDeg: number }

function curvesFor(rates: RatesConfig, limitDeg: number): Curves {
    const sp = (axis: 'roll' | 'pitch' | 'yaw') => (u: number): number => setpointRate(rates.type, u, rates[axis], rates.rateLimit, rates.quickRcExpo === true);
    const angle = (axis: 'roll' | 'pitch') => {
        const f = sp(axis);
        const max = f(1);
        // the model levels to limitDeg x setpoint(stick) / setpoint(1) (sim-core Sim.levelRate)
        return (u: number): number => (max > 0 ? (limitDeg * f(u)) / max : 0);
    };
    return { roll: new StickCurve(angle('roll')), pitch: new StickCurve(angle('pitch')), yaw: new StickCurve(sp('yaw')), limitDeg };
}

/** What the held keys ask for: -1, 0 or 1 per axis (play/keys.ts gameDirs). */
export interface GameKeys { forward: number; strafe: number; turn: number; lift: number }

/** What the assist reads of the world around the model. */
export interface GameSense {
    p: SimParams;
    /** the model's state slots (S) */
    s: ArrayLike<number>;
    /** clearance of the lowest body point above the ground below, m; null: none within the probe's reach */
    groundM: number | null;
}

/** What it sends: the sticks (roll right +, pitch forward +, yaw right +, each -1..1) and the throttle stick 0..1. */
export interface GameSticks { roll: number; pitch: number; yaw: number; throttle: number }

function approach(cur: number, goal: number, step: number): number {
    return goal > cur ? Math.min(goal, cur + step) : Math.max(goal, cur - step);
}

export class GameAssist {
    readonly help = new AltitudeHelp();
    speed: GameSpeed = 'normal';
    /** the heading the camera looks along and the drone turns to, degrees; null until the first update after a reset */
    aimYawDeg: number | null = null;
    /** the camera gimbal's pitch from the horizon, degrees, up positive */
    gimbalDeg = 0;
    /** the ramped target velocity, world frame, m/s (x, z) */
    private tvx = 0;
    private tvz = 0;
    private ix = 0;
    private iz = 0;
    private lift = 0;
    private turn = 0;
    private landedFor = 0;
    /** mouse yaw that arrived before the first update set the aim, degrees */
    private pendingYaw = 0;
    private curves: { key: SimParams; c: Curves } | null = null;
    /** read by the pilot and the tests: the motors can stop, the drone has been on the ground long enough with Shift held */
    landed = false;
    /** the tilt angles last asked for, degrees (nose down, right side down), for tests and the HUD */
    tilt = { pitch: 0, roll: 0 };
    /** the velocity target last used, m/s along the aim and to its right, for tests */
    goal = { forward: 0, right: 0 };

    /** A new life, scene, drone or input: nothing carried over (the aim starts from the body's heading, the gimbal level). */
    reset(): void {
        this.aimYawDeg = null;
        this.pendingYaw = 0;
        this.gimbalDeg = 0;
        this.tvx = this.tvz = this.ix = this.iz = this.lift = this.turn = 0;
        this.landedFor = 0;
        this.landed = false;
        this.help.reset();
    }

    /** The motors just started: from the ground, climb a short hop so W does not drag the drone over the floor. */
    liftoff(sense: GameSense): void {
        this.help.reset();
        this.lift = 0; // the descent command of the landing (Shift held) must not ramp back through a sink and drop the hop
        this.tvx = this.tvz = this.ix = this.iz = 0;
        this.landedFor = 0;
        this.landed = false;
        if (sense.groundM !== null && sense.groundM < ON_GROUND_M) this.help.holdAt(sense.s[S.py] + TAKEOFF_HOP_M);
    }

    /** Mouse movement, already in degrees (mouseToAim): the aim turns, the gimbal tilts (clamped). */
    look(yawDeg: number, pitchDeg: number): void {
        if (this.aimYawDeg !== null) this.aimYawDeg = wrap180(this.aimYawDeg + yawDeg);
        else this.pendingYaw += yawDeg;
        this.gimbalDeg = Math.max(GIMBAL_MIN_DEG, Math.min(GIMBAL_MAX_DEG, this.gimbalDeg + pitchDeg));
    }

    private curvesOf(p: SimParams): Curves {
        const c = this.curves;
        if (c && c.key === p) return c.c;
        const made = curvesFor(p.rates, p.level.limitDeg);
        this.curves = { key: p, c: made };
        return made;
    }

    /**
     * The sink speed the ground and the drone's crash speed allow, m/s (positive): a touch-down speed well under
     * the crash speed, and from there the speed a gentle deceleration can lose in the height that is left (less
     * the height the loop's lag eats at the present sink speed).
     */
    sinkLimit(p: SimParams, groundM: number | null, sinkMps: number): number {
        const full = GAME_SPEEDS[this.speed].vertical;
        if (groundM === null) return full;
        const touch = Math.min(TOUCH_MAX_MPS, TOUCH_SHARE * p.vCrash);
        const room = Math.max(0, groundM - FLARE_LAG_S * Math.max(0, sinkMps));
        return Math.min(full, touch + Math.sqrt(2 * FLARE_MPS2 * room));
    }

    /**
     * One step. `keys`: what the held keys ask for; `dt`: seconds since the last update (0 on the first);
     * returns the sticks. `flying` false (motors not on yet): only the aim moves, the sticks are neutral.
     */
    update(keys: GameKeys, sense: GameSense, dt: number, flying = true): GameSticks {
        const { p, s } = sense;
        const dtc = dt > 0 && dt < 0.25 ? dt : 0; // a stalled page is not time the loops should integrate
        const heading = headingDeg(s);
        if (this.aimYawDeg === null) {
            this.aimYawDeg = wrap180(heading + this.pendingYaw);
            this.pendingYaw = 0;
        }
        // turn keys: the aim moves, ramped like the other commands
        this.turn = approach(this.turn, keys.turn, COMMAND_RAMP_PER_S * dtc);
        this.aimYawDeg = wrap180(this.aimYawDeg + this.turn * KEY_TURN_DPS * dtc);
        if (!flying) {
            this.help.reset();
            this.lift = 0;
            this.landedFor = 0;
            this.landed = false;
            return { roll: 0, pitch: 0, yaw: 0, throttle: 0 };
        }
        const curves = this.curvesOf(p);

        // ---- velocity: target in the aim frame, ramped; PI to an acceleration; tilt in the body's heading frame
        const aim = this.aimYawDeg * RAD;
        const hv = GAME_SPEEDS[this.speed].horizontal;
        let kf = keys.forward;
        let kr = keys.strafe;
        const kn = Math.hypot(kf, kr);
        if (kn > 1) { kf /= kn; kr /= kn; } // a diagonal is not faster
        this.goal.forward = kf * hv;
        this.goal.right = kr * hv;
        const sa = Math.sin(aim), ca = Math.cos(aim);
        // forward = (sin a, -cos a), right = (cos a, sin a) on the ground (x, z)
        const gx = this.goal.forward * sa + this.goal.right * ca;
        const gz = -this.goal.forward * ca + this.goal.right * sa;
        const dvx = gx - this.tvx, dvz = gz - this.tvz;
        const dist = Math.hypot(dvx, dvz);
        if (dist > 0) {
            const speeding = Math.hypot(gx, gz) >= Math.hypot(this.tvx, this.tvz);
            const step = (speeding ? ACCEL_MPS2 : BRAKE_MPS2) * dtc;
            const k = dist <= step ? 1 : step / dist;
            this.tvx += dvx * k;
            this.tvz += dvz * k;
        }
        const ex = this.tvx - s[S.vx], ez = this.tvz - s[S.vz];
        const idle = kf === 0 && kr === 0;
        const leak = idle ? Math.max(0, 1 - I_LEAK_PER_S * dtc) : 1;
        const g = p.gravity;
        const tiltMax = Math.min(TILT_MAX_DEG, p.level.limitDeg);
        const aMax = g * Math.tan(tiltMax * RAD);
        let ax = KV_H * ex + this.ix;
        let az = KV_H * ez + this.iz;
        const am = Math.hypot(ax, az);
        const saturated = am > aMax;
        if (saturated) { ax *= aMax / am; az *= aMax / am; }
        // anti-windup: the integral stops growing while the tilt is at its limit
        if (!saturated) {
            const iMax = 0.6 * aMax;
            this.ix = Math.max(-iMax, Math.min(iMax, (this.ix + KI_H * ex * dtc) * leak));
            this.iz = Math.max(-iMax, Math.min(iMax, (this.iz + KI_H * ez * dtc) * leak));
        } else {
            this.ix *= leak;
            this.iz *= leak;
        }
        // world acceleration -> the body's heading frame (the body is still turning toward the aim)
        const hb = heading * RAD;
        const sb = Math.sin(hb), cb = Math.cos(hb);
        const af = ax * sb - az * cb;
        const ar = ax * cb + az * sb;
        const pitchDeg = Math.atan2(af, g) * DEG;
        const rollDeg = Math.atan2(ar, g) * DEG;
        this.tilt.pitch = pitchDeg;
        this.tilt.roll = rollDeg;
        const pitch = Math.sign(pitchDeg) * curves.pitch.stickFor(Math.abs(pitchDeg));
        const roll = Math.sign(rollDeg) * curves.roll.stickFor(Math.abs(rollDeg));

        // ---- heading: P on the error to the aim -> a yaw rate -> a stick through the rate curve
        const err = wrap180(this.aimYawDeg - heading);
        const rate = KYAW * err;
        const yaw = Math.sign(rate) * curves.yaw.stickFor(Math.abs(rate));

        // ---- height: Space / Shift ramp to a vertical speed; none holds the height
        this.lift = approach(this.lift, keys.lift, COMMAND_RAMP_PER_S * dtc);
        let vt: number | null = null;
        if (Math.abs(this.lift) > 0.02) {
            vt = this.lift > 0 ? this.lift * GAME_SPEEDS[this.speed].vertical : this.lift * this.sinkLimit(p, sense.groundM, -s[S.vy]);
        }
        const throttle = this.help.follow(vt, p, s, dtc);

        // ---- landed: Shift held, on the ground, at rest
        const resting = keys.lift < 0 && sense.groundM !== null && sense.groundM < LANDED_M && Math.abs(s[S.vy]) < LANDED_MPS;
        this.landedFor = resting ? this.landedFor + dtc : 0;
        this.landed = this.landedFor >= LANDED_S;
        return { roll, pitch, yaw, throttle };
    }
}
