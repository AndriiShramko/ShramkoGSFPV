// The centred throttle style of a radio, gamepad or HID controller (lane center-throttle, docs/wip/center-throttle.md;
// the owner's words of 2026-11-12: "for those who always fly DJI drones, where this stick is in the centre ... fly as on
// an ordinary drone with sensors"). Installed by app/input.ts in Controls.assist when the controller's throttle style
// (@gsfpv/input throttle-style.ts) is 'centred' and no Fly by Sound lesson runs; a lesson replaces it and puts it back.
//
// No flight assist of its own: it composes Fly by Sound's LessonPilot (play/lesson-pilot.ts, unchanged), whose assists
// are set every frame from the mode flying, so the controller's mode switch keeps working:
//   - angle (DJI's N): 'velocity' control with altitude 'hold' (GameAssist, play/game.ts): the sticks ask a speed, let
//     go the loop brakes and hovers, the left stick asks a climb or sink speed and its centre holds the height;
//   - horizon (DJI's S): the pilot's own sticks in horizon, the altitude help (AltitudeHelp, play/assist.ts) on the throttle;
//   - acro (DJI's M): the throttle is raw: its centre is half power (the HUD says so). So in acro a stick move does not
//     start the motors: the throttle stick lowered all the way down does (review m6), they start at idle and the stick
//     sets the power from there, the FPV way without an arm switch.
// The caps are the game scheme's speed (prefs input.gameSpeed, GAME_SPEEDS) and the turn keys' rate (KEY_TURN_DPS).
// Motors: AutoArm (via LessonPilot) starts them with the first deliberate move (a stick out of STICK_DEADBAND, or the
// throttle above START_LIFT) and nothing has to be armed; landing (hold the stick down on the ground) stops them in
// velocity control. The controller's own arm input stops them too: an arm switch turned off, or any press of a toggle
// button (the DJI's start/stop button); the sticks must then come back to the centre before a move starts them again.
// Everything here is INPUT: the flight log records its channels and replays without it (A6 untouched).
import { S } from '@gsfpv/sim-core';
import type { FlightMode, Sim } from '@gsfpv/sim-core';
import type { LessonAssists } from '@shramko/sonic-fpv';
import { LessonPilot, flyingIntent, intentsOf } from './lesson-pilot';
import { GAME_SPEEDS, KEY_TURN_DPS } from './game';
import type { GameSpeed } from './game';

/** What the centred pilot reads around it. */
export interface CentreEnv {
    sim(): Sim | null;
    paused(): boolean;
    /** the clearance of the craft's lowest point above what is straight below, m (null: nothing near) */
    ground(sim: Sim): number | null;
    /** the mode flying now (Controls.flyingMode: the controller's switch, else the pilot's mode) */
    mode(): FlightMode;
    /** the game scheme's speed (prefs input.gameSpeed) */
    speed(): GameSpeed;
    /** the controller arms with a toggle button (every press flips; the DJI's start/stop button): any press stops the motors */
    toggleArm(): boolean;
}

/** The lesson assists the centred style flies with in a mode, at a speed. */
export function centreAssists(mode: FlightMode, speed: GameSpeed): LessonAssists {
    const caps = GAME_SPEEDS[speed] ?? GAME_SPEEDS.normal;
    const base = { maxSpeedMps: caps.horizontal, maxClimbMps: caps.vertical, maxYawDps: KEY_TURN_DPS, autoArm: true, onTouch: 'bump' as const };
    if (mode === 'angle') return { control: 'velocity', altitude: 'hold', ...base };
    if (mode === 'horizon') return { control: 'horizon', altitude: 'hold', ...base };
    return { control: 'acro', altitude: 'own', ...base };
}

/** Acro's start mark: the arm gate's own throttle-low mark (<= 5 %, ArmGate in @gsfpv/input), as a channel value. */
export const ACRO_START_LOW = -0.9;

export class CentrePilot {
    readonly pilot: LessonPilot;
    private mode: FlightMode;
    private speed: GameSpeed;
    private lastSw: boolean | null = null;
    /** the motors were stopped by the arm input: the sticks are read as let go until they come back to the centre */
    private hush = false;
    /** acro: the throttle stick was at the bottom on the last frame (null: no frame yet, so a stick resting there starts nothing) */
    private wasLow: boolean | null = null;
    private readonly quiet = new Float32Array(8);

    constructor(private readonly env: CentreEnv) {
        this.mode = env.mode();
        this.speed = env.speed();
        this.pilot = new LessonPilot({ sim: env.sim, paused: env.paused, ground: env.ground }, centreAssists(this.mode, this.speed));
    }

    /** The motors are running (or starting): AutoArm wants them. */
    get motorsWanted(): boolean {
        return this.pilot.arm.want;
    }

    /** A new source or profile: motors off until the first deliberate move. */
    reset(): void {
        this.pilot.reset();
        this.lastSw = null;
        this.hush = false;
        this.wasLow = null;
    }

    /** A new life or scene: the loops start again from the craft's new state. */
    resetFlight(): void {
        this.pilot.resetFlight();
    }

    /** One frame (Controls.assist): the source's channels in `ch`, the channels to fly into out[0..4]. */
    apply(ch: Float32Array, out: Float32Array, tMs: number): void {
        const mode = this.env.mode();
        const speed = this.env.speed();
        if (mode !== this.mode || speed !== this.speed) {
            // another mode (the controller's switch) or speed: its loops start from the craft as it is, the motors stay
            if (mode !== this.mode) { this.pilot.game.reset(); this.pilot.help.reset(); }
            this.mode = mode;
            this.speed = speed;
            this.pilot.setAssists(centreAssists(mode, speed));
        }
        const sw = ch[4] > 0;
        if (this.lastSw !== null && sw !== this.lastSw && this.pilot.arm.state === 'on' && (!sw || this.env.toggleArm())) {
            this.pilot.reset();
            this.hush = true;
        }
        this.lastSw = sw;
        let src: Float32Array = ch;
        const low = ch[2] <= ACRO_START_LOW;
        if (mode === 'acro' && !this.pilot.arm.want) {
            // the raw throttle would start at the stick's centre (half power): only the stick brought down to the bottom
            // starts the motors (an edge: a stop pressed with the stick down does not start them again)
            if (low && this.wasLow === false && !this.hush) this.pilot.arm.request();
            this.quiet.set(ch);
            this.quiet[0] = 0; this.quiet[1] = 0; this.quiet[2] = 0; this.quiet[3] = 0;
            src = this.quiet;
        }
        this.wasLow = low;
        if (this.hush) {
            if (flyingIntent(intentsOf(ch))) {
                this.quiet.set(ch);
                this.quiet[0] = 0; this.quiet[1] = 0; this.quiet[2] = 0; this.quiet[3] = 0;
                src = this.quiet;
            } else this.hush = false;
        }
        this.pilot.apply(src, out, tMs);
    }

    /** For the test hook and the HUD: the motors' state, the control flying, the height held over the ground. */
    state(): { arm: string; control: string; landed: boolean; heightM: number | null } {
        const sim = this.env.sim();
        return { arm: this.pilot.arm.state, control: this.pilot.current.control, landed: this.pilot.game.landed, heightM: sim ? sim.s[S.py] : null };
    }
}
