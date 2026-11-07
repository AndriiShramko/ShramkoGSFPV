// Fly by Sound's lesson pilot (v0.12, docs/wip/v12-plan.md 2.3 and 4.2 step 4; spec section 5: "lessons start in
// self-levelling with low speed caps and with a pilot-friendly thrust assist ... No arming step for the pilot ...
// Works with keyboard, gamepad and RC radio").
//
// Installed by app/input.ts in Controls.assist while a lesson runs, for every source alike: the source's channels
// are read as the pilot's INTENTS (pitch stick forward, roll stick right, yaw stick turn, throttle stick up; centred
// asks for nothing, a radio's throttle in the middle holds the height), and the channels that fly are computed here
// before the arm gate reads them:
//   - arm: AutoArm (play/assist.ts) starts the motors with the first flying intent (a stick out of its deadband,
//     or the throttle above START_LIFT), with the throttle held low until the model is armed, so the radio's own
//     arm switch is not needed; the gate still sees an off -> on edge with the sticks centred and the throttle low.
//     When the model drops out by itself (a hidden tab, a stale radio) it is asked again with no new input;
//     when the pilot lands (descending on the ground) the motors stop until the next flying intent.
//   - 'velocity' control with altitude 'hold': GameAssist (play/game.ts) with the lesson's numeric caps (GameCaps:
//     maxSpeedMps, maxClimbMps, maxYawDps): sticks ask a speed, centred brakes and holds, the throttle stick asks a
//     climb or sink speed and centred holds the height. The ground below comes from a ray of the flight's own walls
//     (the voxel sweep of play/ground.ts costs 1.4 to 1.8 ms on lesson walls, a ray 0.006 ms: sonic-world.test.ts).
//   - other controls ('angle', 'horizon', 'acro'): the pilot's own sticks in that mode, the altitude help on the
//     throttle with 'hold', the pilot's throttle with 'own'.
// The keyboard and the touch sticks reach it as intents too (GamePilot and EasyPilot pass their keys on instead of
// flying them while a lesson runs). Everything here is INPUT: the flight log replays without it (A6 untouched).
import { S } from '@gsfpv/sim-core';
import type { FlightMode, Sim } from '@gsfpv/sim-core';
import { applyDeadband } from '@gsfpv/input';
import type { LessonAssists } from '@shramko/sonic-fpv';
import { AltitudeHelp, AutoArm } from './assist';
import { GAME_SPEEDS, GameAssist, KEY_TURN_DPS } from './game';
import type { GameCaps, GameKeys } from './game';

/** A stick within this of its centre asks for nothing (a radio's sticks rest a little off centre). */
export const STICK_DEADBAND = 0.08;
/** The throttle stick above this (-1 bottom .. 1 top; 0 = the middle, hold) starts the motors, as Space does. */
export const START_LIFT = 0.25;
/** The ground below is looked at this often, ms. */
export const LESSON_PROBE_EVERY_MS = 33;
/** How far below the craft the ground is looked for, m. */
export const LESSON_PROBE_M = 20;

/** What the lesson pilot reads around it. */
export interface LessonEnv {
    /** the flight model now (null while a scene switch has none) */
    sim(): Sim | null;
    paused(): boolean;
    /** the clearance of the craft's lowest point above the walls straight below, m; null: nothing within LESSON_PROBE_M */
    ground(sim: Sim): number | null;
}

/** The walls' ray query (VoxelCollision.queryRay). */
export interface RayWalls {
    queryRay(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number): { x: number; y: number; z: number } | null;
}

/** The clearance of the craft's lowest body point above the walls straight below it, by one ray; null when none. */
export function rayClearance(walls: RayWalls | null, sim: Sim): number | null {
    if (!walls) return null;
    const s = sim.s;
    const h = walls.queryRay(s[S.px], s[S.py], s[S.pz], 0, -1, 0, LESSON_PROBE_M);
    if (!h) return null;
    return Math.max(0, s[S.py] - h.y - sim.p.bodyBottom);
}

/** The flight mode a lesson's control flies in: velocity control commands tilts, which only angle mode turns into a tilt. */
export function lessonMode(a: LessonAssists): FlightMode {
    return a.control === 'velocity' ? 'angle' : a.control;
}

/** A lesson's caps as the game assist takes them; a cap the lesson leaves open is the game scheme's normal speed. */
export function lessonCaps(a: LessonAssists): GameCaps {
    return {
        horizontal: a.maxSpeedMps ?? GAME_SPEEDS.normal.horizontal,
        vertical: a.maxClimbMps ?? GAME_SPEEDS.normal.vertical,
        yawDps: a.maxYawDps ?? KEY_TURN_DPS
    };
}

/** A source's channels (roll, pitch, throttle, yaw) as the pilot's intents, each with the deadband taken out. */
export function intentsOf(ch: ArrayLike<number>): GameKeys {
    const c = (v: number): number => applyDeadband(Math.max(-1, Math.min(1, v)), STICK_DEADBAND);
    return { forward: c(ch[1]), strafe: c(ch[0]), turn: c(ch[3]), lift: c(ch[2]) };
}

/** A flying intent: a stick moved, or the throttle pushed above START_LIFT (descending alone starts nothing). */
export function flyingIntent(k: GameKeys): boolean {
    return k.forward !== 0 || k.strafe !== 0 || k.turn !== 0 || k.lift > START_LIFT;
}

export class LessonPilot {
    readonly arm = new AutoArm();
    readonly game = new GameAssist();
    readonly help = new AltitudeHelp();
    private assists: LessonAssists;
    private readonly env: LessonEnv;
    private lastT = -1;
    private wasOn = false;
    private wasFlying = false;
    private rearm = false;
    private stopped = false;
    private probeAt = -1e9;
    private groundM: number | null = null;

    constructor(env: LessonEnv, assists: LessonAssists) {
        this.env = env;
        this.assists = assists;
    }

    /** The lesson's assists now (a new lesson, the next step of one): caps and arming apply from the next frame. */
    setAssists(a: LessonAssists): void {
        this.assists = a;
    }

    get current(): LessonAssists {
        return this.assists;
    }

    /** A new life or a new scene: the loops start again from the craft's new state; the motors' wish stays. */
    resetFlight(): void {
        this.game.reset();
        this.help.reset();
        this.wasOn = false;
        this.groundM = null;
        this.probeAt = -1e9;
        this.lastT = -1;
    }

    /** A new source or a new lesson: nothing wanted, motors off until the first flying intent. */
    reset(): void {
        this.arm.reset();
        this.resetFlight();
        this.wasFlying = false;
        this.rearm = false;
        this.stopped = false;
    }

    private clearance(sim: Sim, tMs: number): number | null {
        if (tMs - this.probeAt >= LESSON_PROBE_EVERY_MS || tMs < this.probeAt) {
            this.probeAt = tMs;
            this.groundM = this.env.ground(sim);
        }
        return this.groundM;
    }

    /** One frame (Controls.assist): the source's intents in `ch`, the channels to fly into out[0..4]. */
    apply(ch: ArrayLike<number>, out: Float32Array, tMs: number): void {
        const sim = this.env.sim();
        const dt = this.lastT < 0 ? 0 : (tMs - this.lastT) / 1000;
        this.lastT = tMs;
        if (!sim) {
            out[0] = 0; out[1] = 0; out[2] = -1; out[3] = 0; out[4] = -1;
            return;
        }
        const a = this.assists;
        const keys = intentsOf(ch);
        const paused = this.env.paused();
        const flying = flyingIntent(keys);
        let armCh: number;
        let holdLow: boolean;
        if (a.autoArm) {
            if ((flying && !this.wasFlying) || this.rearm) {
                this.arm.request();
                this.rearm = false;
            }
            const before = this.arm.state;
            const r = this.arm.step({ simArmed: sim.armed, crashed: sim.crashed, paused, now: tMs });
            // the model dropped out by itself (the gate let go: a hidden tab, a stale radio): ask again, no new input needed
            if (before === 'on' && this.arm.state === 'off' && !this.stopped) this.rearm = true;
            this.stopped = false;
            armCh = r.arm;
            holdLow = r.holdLow;
        } else {
            armCh = ch[4] > 0 ? 1 : -1;
            holdLow = false;
        }
        this.wasFlying = flying;
        const on = armCh > 0 && !holdLow && !sim.crashed;
        const step = paused ? 0 : dt;
        if (a.control === 'velocity') {
            this.game.caps = lessonCaps(a);
            const sense = { p: sim.p, s: sim.s, groundM: this.clearance(sim, tMs) };
            if (on && !this.wasOn) this.game.liftoff(sense);
            const o = this.game.update(keys, sense, step, on);
            if (!paused && a.autoArm && this.game.landed) {
                this.arm.stop();
                this.stopped = true;
            }
            out[0] = o.roll;
            out[1] = o.pitch;
            out[2] = (on ? o.throttle : 0) * 2 - 1;
            out[3] = o.yaw;
        } else {
            // the flight mode itself flies: the pilot's sticks; the altitude help on the throttle with 'hold'
            out[0] = ch[0];
            out[1] = ch[1];
            out[3] = ch[3];
            if (!on) {
                out[2] = -1;
                this.help.reset();
            } else if (a.altitude === 'hold') {
                const vcap = lessonCaps(a).vertical;
                out[2] = this.help.follow(keys.lift !== 0 ? keys.lift * vcap : null, sim.p, sim.s, step) * 2 - 1;
            } else out[2] = ch[2];
        }
        this.wasOn = on;
        out[4] = armCh;
    }
}
