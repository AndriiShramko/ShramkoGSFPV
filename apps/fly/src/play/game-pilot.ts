// The game scheme at run time (docs/wip/v09-b.md; the owner's message 22, item 1): what the keyboard and the
// mouse send when prefs input.play is 'easy' and the keyboard is the input. One per page (app/input.ts
// InputHost.game); a radio, a gamepad, a HID device and the touch sticks never go through it (touch has
// EasyPilot, play/easy.ts).
//
// Each frame: AutoArm decides the arm channel (no switch: a flying key starts the motors), GameAssist
// (play/game.ts) turns the keys and the mouse into sticks, and the frame goes through Controls and its arm
// gate like every source's. The model only ever sees channels, so the flight log replays without any of this.

import type { Controls } from '../controls';
import type { FlightSession } from '../session';
import { AutoArm } from './assist';
import { GameAssist } from './game';
import type { GameKeys, GameSpeed } from './game';
import { groundClearance } from './ground';

/** What the game scheme reads around it: the flight on screen now (a scene switch replaces it) and the speed setting. */
export interface GameEnv {
    session(): FlightSession;
    /** prefs input.gameSpeed */
    speed(): GameSpeed;
}

/** The ground below is looked at this often, ms (a probe is one sweep through the scan's collision). */
export const PROBE_EVERY_MS = 33;

export class GamePilot {
    readonly arm = new AutoArm();
    readonly game = new GameAssist();
    /** the throttle stick (0..1) sent last (tests, the bench's hook) */
    throttleSent = 0;
    private lastT = -1;
    private wasOn = false;
    private probeAt = -1e9;
    private ground: number | null = null;
    private ch = new Float32Array([0, 0, -1, 0, -1, 0, 0, 0]);
    private readonly controls: Controls;
    private readonly env: GameEnv;

    constructor(controls: Controls, env: GameEnv) {
        this.controls = controls;
        this.env = env;
    }

    /** A new life or a new scene: the height to hold, the integrals and the aim start again from the craft's new state. */
    resetFlight(): void {
        this.game.reset();
        this.wasOn = false;
        this.ground = null;
        this.probeAt = -1e9;
        this.lastT = -1;
    }

    /** A new input source: nothing wanted, motors off until the first flying key. */
    reset(): void {
        this.arm.reset();
        this.resetFlight();
        this.throttleSent = 0;
    }

    /** Mouse movement in degrees (play/game.ts mouseToAim): the aim turns, the camera gimbal tilts. */
    look(yawDeg: number, pitchDeg: number): void {
        this.game.look(yawDeg, pitchDeg);
    }

    /** The clearance above the ground below, looked at no more often than PROBE_EVERY_MS. */
    private clearance(s: FlightSession, tMs: number): number | null {
        if (tMs - this.probeAt >= PROBE_EVERY_MS || tMs < this.probeAt) {
            this.probeAt = tMs;
            this.ground = groundClearance(s.sim.contactWorld, s.sim.s, s.sim.p);
        }
        return this.ground;
    }

    /** Sends one frame through Controls (and its arm gate) at page time `tMs`. */
    send(keys: GameKeys, tMs: number): void {
        const s = this.env.session();
        const sim = s.sim;
        const dt = this.lastT < 0 ? 0 : (tMs - this.lastT) / 1000;
        this.lastT = tMs;
        const a = this.arm.step({ simArmed: sim.armed, crashed: sim.crashed, paused: s.paused, now: tMs });
        const on = !a.holdLow && !sim.crashed;
        this.game.speed = this.env.speed();
        const sense = { p: sim.p, s: sim.s, groundM: this.clearance(s, tMs) };
        if (on && !this.wasOn) this.game.liftoff(sense);
        this.wasOn = on;
        // a paused flight takes no time: the same sticks again, the integrals wait
        const o = this.game.update(keys, sense, s.paused ? 0 : dt, on);
        if (!s.paused && this.game.landed) this.arm.stop();
        const thr = on ? o.throttle : 0;
        this.throttleSent = thr;
        const ch = this.ch;
        ch[0] = o.roll;
        ch[1] = o.pitch;
        ch[2] = thr * 2 - 1;
        ch[3] = o.yaw;
        ch[4] = a.arm;
        ch[5] = 0; // Controls writes the mode: angle, whatever the pilot chose (the velocity loop commands tilts)
        this.controls.channels(ch, tMs);
    }
}
