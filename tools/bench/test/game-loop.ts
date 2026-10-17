// The page around the model for the game scheme's tests (app-game.test.ts and the tuning probes): the Sim steps
// at 1 kHz, the page's frames (60 Hz) refresh what the input reads, the input source emits every 10 ms through
// the real AutoArm and ArmGate, exactly as devices/keyboard.ts + play/game-pilot.ts do in the page.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MODE_CHANNEL, S, Sim, compileParams } from '@gsfpv/sim-core';
import type { ContactOut, ContactWorld, ParamOverrides, PresetJson, SimParams } from '@gsfpv/sim-core';
import { ArmGate } from '@gsfpv/input';
import type { Profile } from '@gsfpv/input';
import { REPO } from '../../../packages/prefs/test/helpers';
import { AutoArm } from '../../../apps/fly/src/play/assist';
import { GameAssist } from '../../../apps/fly/src/play/game';
import type { GameKeys, GameSpeed } from '../../../apps/fly/src/play/game';
import { groundClearance } from '../../../apps/fly/src/play/ground';
import { stickForAngle } from '../../../apps/fly/src/play/keys';

export const PRESET_DIR = join(REPO, 'packages', 'sim-core', 'presets');
export const params = (id = 'pavo20pro-3s', o: ParamOverrides = {}): SimParams => compileParams(JSON.parse(readFileSync(join(PRESET_DIR, `${id}.json`), 'utf8')) as PresetJson, o);

/** A flat floor at y = 0 and nothing else: enough to land on. */
export class FloorWorld implements ContactWorld {
    sweep(c0: Float64Array, c1: Float64Array, r: Float64Array, pad: Float64Array, n: number, out: ContactOut): number {
        let best = -1;
        for (let i = 0; i < n; i++) {
            const rr = r[i] + pad[i];
            const y0 = c0[3 * i + 1] - rr, y1 = c1[3 * i + 1] - rr;
            if (y1 >= 0 && y0 >= 0) continue;
            const t = y0 <= 0 ? 0 : y0 / (y0 - y1);
            if (best < 0 || t < best) { best = t; out.sphere = i; out.nx = 0; out.ny = 1; out.nz = 0; }
        }
        return best;
    }

    pushOut(x: number, y: number, z: number, r: number, out: { x: number; y: number; z: number }): boolean {
        if (y - r >= 0) return false;
        out.x = 0; out.y = r - y; out.z = 0;
        return true;
    }
}

/** One thing the pilot does: held keys and mouse movement for a while. */
export interface Move extends Partial<GameKeys> { ms: number; mouseYawDegPerS?: number; mousePitchDegPerS?: number }

export class GameLoop {
    readonly sim: Sim;
    readonly gate = new ArmGate({ keepArmedAfterCrash: true });
    readonly arm = new AutoArm();
    readonly game = new GameAssist();
    snap: Float64Array;
    snapArmed = false;
    snapGround: number | null = null;
    t = 0;
    private lastEmit = -1e9;
    private wasOn = false;
    readonly sent: number[][] = [];
    /** the keys held now; set by run() */
    keys: GameKeys = { forward: 0, strafe: 0, turn: 0, lift: 0 };
    private mouse = { yaw: 0, pitch: 0 };

    /**
     * `blindGround`: the assist is told there is no ground below (the control of the soft landing).
     * `tiltKeys`: the keys are v0.8's, a fixed tilt while held and level when released, with the height
     * held (the control of "let go and the drone stops": a drone coasts).
     */
    constructor(readonly p: SimParams, readonly world: ContactWorld | null = null, y0 = 50, speed: GameSpeed = 'normal', readonly opts: { blindGround?: boolean; tiltKeys?: boolean } = {}) {
        this.sim = new Sim(p, world);
        this.sim.reset(0, y0, 0, 0, { soc: 1 });
        this.snap = new Float64Array(this.sim.s);
        this.game.speed = speed;
    }

    /** Hold `keys` (and sweep the mouse at the given rates) for `ms`. A flying key asks the motors to start. */
    run(ms: number, keys: Partial<GameKeys> = {}, mouse: { yawDegPerS?: number; pitchDegPerS?: number } = {}): void {
        this.keys = { forward: 0, strafe: 0, turn: 0, lift: 0, ...keys };
        this.mouse = { yaw: mouse.yawDegPerS ?? 0, pitch: mouse.pitchDegPerS ?? 0 };
        const starts = this.keys.forward !== 0 || this.keys.strafe !== 0 || this.keys.turn !== 0 || this.keys.lift > 0;
        if (starts) this.arm.request();
        for (let i = 0; i < ms; i++) {
            if (Math.floor((this.t * 60) / 1000) !== Math.floor(((this.t - 1) * 60) / 1000)) {
                this.snap = new Float64Array(this.sim.s);
                this.snapArmed = this.sim.armed;
                this.snapGround = groundClearance(this.sim.contactWorld, this.snap, this.p);
            }
            if (this.t - this.lastEmit >= 10) {
                const dt = this.lastEmit < 0 ? 0 : (this.t - this.lastEmit) / 1000;
                this.lastEmit = this.t;
                this.emit(dt);
            }
            this.sim.step();
            this.t++;
        }
    }

    /** Several moves one after the other. */
    play(moves: readonly Move[]): void {
        for (const m of moves) this.run(m.ms, m, { yawDegPerS: m.mouseYawDegPerS, pitchDegPerS: m.mousePitchDegPerS });
    }

    private emit(dt: number): void {
        const a = this.arm.step({ simArmed: this.snapArmed, crashed: this.sim.crashed, paused: false, now: this.t });
        const on = !a.holdLow && !this.sim.crashed;
        const sense = { p: this.p, s: this.snap, groundM: this.opts.blindGround ? null : this.snapGround };
        if (dt > 0) this.game.look(this.mouse.yaw * dt, this.mouse.pitch * dt);
        if (on && !this.wasOn) this.game.liftoff(sense);
        this.wasOn = on;
        const o = this.game.update(this.keys, sense, dt, on);
        if (this.opts.tiltKeys) {
            // v0.8's keys: 25 deg of tilt while a key is held, nothing when it is let go (the drone then coasts)
            o.pitch = this.keys.forward * stickForAngle(25, this.p.rates, 'pitch', this.p.level.limitDeg);
            o.roll = this.keys.strafe * stickForAngle(25, this.p.rates, 'roll', this.p.level.limitDeg);
            o.yaw = 0;
        }
        const thr = a.holdLow ? 0 : o.throttle;
        const ch = new Float32Array([o.roll, o.pitch, thr * 2 - 1, o.yaw, a.arm, MODE_CHANNEL.angle, 0, 0]);
        ch[4] = this.gate.update({} as Profile, ch, 0, true, this.sim.crashed);
        this.sent.push(Array.from(ch));
        this.sim.setChannels(ch);
        if (this.game.landed) this.arm.stop();
    }

    get y(): number { return this.sim.s[S.py]; }
    get vy(): number { return this.sim.s[S.vy]; }
    /** speed over the ground, m/s */
    get speed(): number { return Math.hypot(this.sim.s[S.vx], this.sim.s[S.vz]); }
    /** velocity along the body's heading and to its right, m/s */
    along(headingDeg: number): { forward: number; right: number } {
        const h = (headingDeg * Math.PI) / 180;
        const vx = this.sim.s[S.vx], vz = this.sim.s[S.vz];
        return { forward: vx * Math.sin(h) - vz * Math.cos(h), right: vx * Math.cos(h) + vz * Math.sin(h) };
    }
}
