// Easy play at run time (docs/wip/v08-a.md section 1): what the keyboard and the touch sticks send when
// prefs input.play is 'easy'. One per page (app/input.ts InputHost.easy), shared by whichever of the two
// flies; a radio, a gamepad or a HID device never goes through it.
//
// Each frame: AutoArm decides the arm channel (no switch: a flying input starts the motors), the
// altitude help turns the climb/sink command into a throttle stick (angle mode only: assist.ts helpFlies),
// and the frame goes through Controls and its arm gate like every source's. The model only ever sees
// channels, so the flight log replays without any of this (assist.ts header).

import type { Controls } from '../controls';
import type { FlightSession } from '../session';
import { AltitudeHelp, AutoArm, helpFlies } from './assist';

/** What easy play reads around it: the flight on screen now (a scene switch replaces it) and the help setting. */
export interface EasyEnv {
    session(): FlightSession;
    /** prefs input.altitudeHelp */
    altitudeHelp(): boolean;
}

/**
 * One frame of what the player asks. Sticks -1..1 as the source shaped them (keys ramped, pads as
 * the finger is); `lift` -1..1 is the climb/sink command for the altitude help; `throttle` 0..1 is
 * the source's own throttle, flown when the help is not on.
 */
export interface PlayIntent { roll: number; pitch: number; yaw: number; lift: number; throttle: number; boost: boolean }

export class EasyPilot {
    readonly arm = new AutoArm();
    readonly help = new AltitudeHelp();
    /** the throttle stick (0..1) sent last: a source's own throttle takes over from it when the help goes off */
    throttleSent = 0;
    private lastT = -1;
    private ch = new Float32Array([0, 0, -1, 0, -1, 0, 0, 0]);
    private readonly controls: Controls;
    private readonly env: EasyEnv;

    constructor(controls: Controls, env: EasyEnv) {
        this.controls = controls;
        this.env = env;
    }

    /** The altitude help flies the throttle now: switched on, and the mode flown is one it flies in (angle; assist.ts helpFlies). */
    helpActive(): boolean {
        return this.env.altitudeHelp() && helpFlies(this.controls.flyingMode());
    }

    /** A new life or a new scene: the height to hold and the integral start again. */
    resetHelp(): void {
        this.help.reset();
    }

    /** A new input source: nothing wanted, motors off until its first flying input. */
    reset(): void {
        this.arm.reset();
        this.help.reset();
        this.lastT = -1;
        this.throttleSent = 0;
    }

    /** Sends one frame through Controls (and its arm gate) at page time `tMs`. */
    send(i: PlayIntent, tMs: number): void {
        const s = this.env.session();
        const sim = s.sim;
        // a scene switch replaces the session and for a moment the new one has no model: nothing to send yet
        // (before this guard every frame of the switch threw "reading 'armed'", base 631fd5f too: evidence v07-render R4)
        if (!sim) return;
        const dt = this.lastT < 0 ? 0 : (tMs - this.lastT) / 1000;
        this.lastT = tMs;
        const a = this.arm.step({ simArmed: sim.armed, crashed: sim.crashed, paused: s.paused, now: tMs });
        let thr: number;
        if (a.holdLow || sim.crashed) {
            // waiting for the model to arm (the throttle must be at the bottom on the edge), or a crash
            // in progress: the help starts again from the craft's next state
            thr = 0;
            this.help.reset();
        } else if (this.helpActive()) {
            thr = s.paused ? this.throttleSent : this.help.update(i.lift, i.boost, sim.p, sim.s, dt);
        } else {
            thr = Math.max(0, Math.min(1, i.throttle));
            this.help.reset();
        }
        this.throttleSent = thr;
        const ch = this.ch;
        ch[0] = i.roll;
        ch[1] = i.pitch;
        ch[2] = thr * 2 - 1;
        ch[3] = i.yaw;
        ch[4] = a.arm;
        ch[5] = 0; // Controls writes the pilot's mode
        this.controls.channels(ch, tMs);
    }
}
