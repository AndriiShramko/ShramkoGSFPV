// Keyboard input (flying without a radio, latency measurement). Two profiles (prefs input.play;
// docs/wip/v08-a.md, the owner's message 21 item 1: "for gamers the keys are incomprehensible"):
//  - easy (default): the game layout of play/keys.ts (W/S forward/back, A/D left/right, the side
//    arrows or Q/E turn, the up/down arrows climb and sink, Shift faster, Space: a tap starts the
//    motors, a 0.5 s hold stops them, so a tap in the air never drops the drone). A key
//    ramps its stick toward a target in physical units (play/keys.ts keyTargets: 25 deg of tilt,
//    110 deg/s of turn, the drone's own rates turned back into a stick); the motors start with the
//    first flying key and the altitude help flies the throttle (play/easy.ts EasyPilot). Without the
//    help (pilot school step 2 and on) the up/down arrows move a throttle that stays where it is left.
//  - pilot: the Mode 2 layout of v0.2-v0.7, unchanged: W/S throttle (stays where it is left; held W is
//    0 -> 100 % in 0.5 s of real time), A/D yaw, arrows roll/pitch, every key bang-bang, Space arms.
// The flight mode is not read here: M is the page's mode key for every input (keymap mode.cycle,
// app/builtin/modes.ts) and Controls puts the pilot's mode on ch[5].
// F13..F24 are reserved for the latency harness: each press is one numbered input event that
// travels the normal path (queue -> physics tick -> marker in the next rendered frame).
// Every frame goes through Controls and its arm gate, like the other sources. Only the chosen
// source flies: with a radio, a gamepad or touch sticks the keyboard is passive (Space only asks
// Controls to arm, which acts for a radio without an arm switch), so a held or lost key can never
// override the radio (item 22).

import type { Controls } from '../controls';
import type { EasyPilot } from '../play/easy';
import { BOOST_CODES, EASY_THR_DOWN_S, EASY_THR_UP_S, GAME_KEYS, MODE2_KEYS, MotorKey, axisDirs, keyTargets, slew } from '../play/keys';
import type { KeyTargets, PlayProfile } from '../play/keys';
import type { FlightMode, SimParams } from '@gsfpv/sim-core';

/** The pilot layout's keys (Mode 2): read by the pilot profile only. */
const FLY_KEYS = MODE2_KEYS.map((k) => k.code);
/** Every key the easy profile reads: the game layout and Shift. */
const EASY_KEYS = [...GAME_KEYS.map((k) => k.code), ...BOOST_CODES];
/** Keys that ask easy play to fly (Shift alone does not start the motors). */
const EASY_FLYING = GAME_KEYS.map((k) => k.code);

/** Held W takes the throttle from 0 to 100 % in this long, by elapsed time (timers get clamped). */
const THR_UP_MS = 500;
/** Held S takes it from 100 % to 0 faster: cutting throttle is the hurried move. */
const THR_DOWN_MS = 333;
/** A longer gap between two updates is a stalled page, not key-held time the pilot meant. */
const RAMP_MAX_STEP_MS = 200;
/** Easy play sends a frame at least this often while the keyboard flies (the altitude help needs a steady stream). */
const EASY_FRAME_MS = 10;

/** Inputs that take no text: a focused slider or checkbox must not swallow R, P or Esc. */
const NOT_TEXT = new Set(['range', 'checkbox', 'radio', 'button', 'submit', 'reset']);

/** Keys typed into a field (import text, settings numbers) are text, not sticks or shortcuts. */
export function typing(el: EventTarget | null): boolean {
    if (el instanceof HTMLInputElement) return !NOT_TEXT.has(el.type);
    return el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || (el instanceof HTMLElement && el.isContentEditable);
}

/** Keys pressed inside the mode chip's open menu (ui/mode-chip.ts) move through its modes, not the sticks. */
function inChipMenu(el: EventTarget | null): boolean {
    return typeof Element !== 'undefined' && el instanceof Element && el.closest('.mc-pop') !== null;
}

/** A dialog is up (Controls, pause menu, settings, a picker): Space and arrows belong to its buttons. */
export function dialogOpen(): boolean {
    return !!document.querySelector('.screen.radio, .panel, .screen.drones, .screen.scenes');
}

/** What easy play needs from the page besides the keys: the pilot, the model's numbers and the mode. */
export interface KeyboardEasy {
    pilot: EasyPilot;
    params(): SimParams;
    mode(): FlightMode;
}

export class KeyboardSource {
    private down = new Set<string>();
    private ch = new Float32Array([0, 0, -1, 0, -1, 0, 0, 0]);
    private throttle = 0;
    private armed = false;
    latencyId = 0;
    /** Another source flies; Space calls onArm, every other flying key is ignored. */
    passive = true;
    onArm: (() => void) | null = null;
    /** prefs input.play; set by app/builtin/play.ts */
    profile: PlayProfile = 'pilot';
    /** easy play's parts, given by the input host; without them the easy profile flies as pilot */
    easy: KeyboardEasy | null = null;
    private controls: Controls;
    private timer = 0;
    /** page time the throttle ramp has been integrated up to */
    private rampT = 0;
    // easy play: the ramped sticks, the time they were moved to, the last frame sent
    private sticks = { roll: 0, pitch: 0, yaw: 0 };
    private sticksT = 0;
    private lastEasyEmit = -1e9;
    /** easy play's Space: a tap starts the motors, a hold stops them */
    private readonly motorKey = new MotorKey();
    private targets: { key: SimParams | null; mode: FlightMode | null; t: KeyTargets | null } = { key: null, mode: null, t: null };

    constructor(controls: Controls) {
        this.controls = controls;
        addEventListener('keydown', this.onDown, { capture: true });
        addEventListener('keyup', this.onUp, { capture: true });
        // a key released in another window never sends its keyup here: forget held keys on leaving
        addEventListener('blur', this.release);
        document.addEventListener('visibilitychange', this.release);
        // 500 Hz sampling of held keys, independent of the frame rate
        this.timer = window.setInterval(() => this.tick(performance.now()), 2);
    }

    /** Easy play is what flies: the easy profile with its parts given. */
    private get isEasy(): boolean {
        return this.profile === 'easy' && this.easy !== null;
    }

    /** Fly with the keyboard (true) or leave the sticks to another source (false). */
    setActive(on: boolean): void {
        this.passive = !on;
        this.down.clear();
        this.motorKey.release();
        this.rampT = performance.now();
        this.sticks = { roll: 0, pitch: 0, yaw: 0 };
        this.sticksT = this.rampT;
        if (on) this.emit(performance.now()); // the HUD's arm hint needs one frame from the chosen source
    }

    /** Another profile (Settings): held keys are dropped, the motors stay as they are until the next key. */
    setProfile(p: PlayProfile): void {
        if (p === this.profile) return;
        this.profile = p;
        this.down.clear();
        this.motorKey.release();
        this.sticks = { roll: 0, pitch: 0, yaw: 0 };
        this.armed = false;
        if (!this.passive) this.emit(performance.now());
    }

    private onDown = (e: KeyboardEvent): void => {
        if (typing(e.target) || dialogOpen() || inChipMenu(e.target)) return;
        if (/^F(1[3-9]|2[0-4])$/.test(e.code) || /^F(1[3-9]|2[0-4])$/.test(e.key)) {
            if (/^F2[04]$/.test(e.code) || /^F2[04]$/.test(e.key)) return; // reserved: harness control keys
            if (this.passive) return;
            // latency probe: one numbered event at the OS-stamped time
            this.latencyId++;
            this.controls.channels(this.ch, e.timeStamp, this.latencyId);
            e.preventDefault();
            return;
        }
        if (this.passive) {
            if (e.code === 'Space' && this.onArm) {
                if (!e.repeat) this.onArm();
                e.preventDefault();
            }
            return;
        }
        if (this.isEasy) { this.onDownEasy(e); return; }
        if (e.code === 'Space' && !e.repeat) {
            // the gate let go while no key was held (a respawn that wants a new flip, a refusal):
            // this press is "arm", so OFF goes out first and the gate sees the edge it waits for
            if (this.armed && this.letGo()) { this.armed = false; this.emit(e.timeStamp); }
            this.armed = !this.armed;
            this.emit(e.timeStamp);
            e.preventDefault();
        }
        if (FLY_KEYS.includes(e.code)) {
            if (!this.down.has(e.code)) this.ramp(e.timeStamp); // the ramp starts at the press, not the next tick
            this.down.add(e.code);
            e.preventDefault();
        }
    };

    /** Easy play: Space starts the motors (a tap) or stops them (held, play/keys.ts MotorKey); a flying key starts them and moves its stick. */
    private onDownEasy(e: KeyboardEvent): void {
        const pilot = this.easy!.pilot;
        if (e.code === 'Space') {
            if (!e.repeat && this.motorKey.press(e.timeStamp, pilot.arm.want) === 'start') {
                pilot.arm.request();
                this.emitEasy(e.timeStamp);
            }
            e.preventDefault();
            return;
        }
        if (!EASY_KEYS.includes(e.code)) return;
        if (!this.down.has(e.code)) this.moveSticks(e.timeStamp); // the ramp starts at the press
        this.down.add(e.code);
        if (EASY_FLYING.includes(e.code)) pilot.arm.request();
        this.emitEasy(e.timeStamp);
        e.preventDefault();
    }

    private onUp = (e: KeyboardEvent): void => {
        if (this.isEasy) {
            if (e.code === 'Space') this.motorKey.release();
            this.moveSticks(e.timeStamp);
            if (this.down.delete(e.code) && !this.passive) this.emitEasy(e.timeStamp);
            return;
        }
        this.ramp(e.timeStamp); // the time since the last tick was held too
        const was = this.down.delete(e.code);
        // with every key up the tick sends nothing more: the throttle where W / S left it goes out now
        if (was && (e.code === 'KeyW' || e.code === 'KeyS')) this.emit(this.rampT);
    };

    private release = (): void => {
        if (this.isEasy) this.moveSticks(performance.now());
        else this.ramp(performance.now());
        this.down.clear();
        this.motorKey.release();
    };

    /** Move the throttle by the time W / S were held since the last call (not by timer ticks). */
    private ramp(t: number): void {
        const dt = Math.min(RAMP_MAX_STEP_MS, Math.max(0, t - this.rampT));
        if (t > this.rampT) this.rampT = t;
        if (this.passive || dt === 0) return;
        if (this.down.has('KeyW')) this.throttle = Math.min(1, this.throttle + dt / THR_UP_MS);
        if (this.down.has('KeyS')) this.throttle = Math.max(0, this.throttle - dt / THR_DOWN_MS);
    }

    private tick(t: number): void {
        if (this.passive) return;
        if (this.isEasy) {
            this.moveSticks(t);
            if (this.motorKey.tick(t) === 'stop') { this.easy!.pilot.arm.stop(); this.emitEasy(t); }
            if (t - this.lastEasyEmit >= EASY_FRAME_MS) this.emitEasy(t);
            return;
        }
        this.ramp(t);
        const d = this.down;
        if (d.size === 0 && this.ch[0] === 0 && this.ch[1] === 0 && this.ch[3] === 0) return;
        this.emit(t);
    }

    private emit(t: number): void {
        if (this.passive) return;
        if (this.isEasy) { this.emitEasy(t); return; }
        const d = this.down;
        this.ch[0] = (d.has('ArrowRight') ? 0.6 : 0) - (d.has('ArrowLeft') ? 0.6 : 0);
        this.ch[1] = (d.has('ArrowUp') ? 0.6 : 0) - (d.has('ArrowDown') ? 0.6 : 0);
        this.ch[3] = (d.has('KeyD') ? 0.5 : 0) - (d.has('KeyA') ? 0.5 : 0);
        this.ch[2] = this.throttle * 2 - 1;
        this.ch[4] = this.armed ? 1 : -1;
        this.controls.channels(this.ch, t);
        // refused (throttle up, a respawn that wants a new flip) or disarmed by the gate: the next
        // Space arms. Not while crashed: with respawn.keepArmed the switch held on through the crash
        // is what arms the respawned craft (design C.3)
        if (this.armed && this.letGo()) this.armed = false;
    }

    // ------------------------------------------------------------------ easy play

    /** The key targets of the drone and mode flown now (recomputed when either changes). */
    private keyTargets(): KeyTargets {
        const e = this.easy!;
        const p = e.params();
        const mode = e.mode();
        const c = this.targets;
        if (c.t === null || c.key !== p || c.mode !== mode) {
            c.key = p;
            c.mode = mode;
            c.t = keyTargets(p.rates, p.level.limitDeg, mode);
        }
        return c.t;
    }

    /** Ramp the sticks toward the held keys' targets and the own throttle by the up/down keys, up to page time `t`. */
    private moveSticks(t: number): void {
        const dt = Math.min(RAMP_MAX_STEP_MS, Math.max(0, t - this.sticksT)) / 1000;
        if (t > this.sticksT) this.sticksT = t;
        if (this.passive || dt === 0) return;
        const dirs = axisDirs(this.down, GAME_KEYS);
        const boost = BOOST_CODES.some((c) => this.down.has(c));
        const k = this.keyTargets();
        const tg = boost ? k.boost : k;
        this.sticks.roll = slew(this.sticks.roll, dirs.roll * tg.roll, dt);
        this.sticks.pitch = slew(this.sticks.pitch, dirs.pitch * tg.pitch, dt);
        this.sticks.yaw = slew(this.sticks.yaw, dirs.yaw * tg.yaw, dt);
        const pilot = this.easy!.pilot;
        if (pilot.helpActive()) this.throttle = pilot.throttleSent; // the own throttle takes over from the help without a jump
        else if (dirs.lift > 0) this.throttle = Math.min(1, this.throttle + dt / EASY_THR_UP_S);
        else if (dirs.lift < 0) this.throttle = Math.max(0, this.throttle - dt / EASY_THR_DOWN_S);
    }

    private emitEasy(t: number): void {
        if (this.passive) return;
        this.lastEasyEmit = t;
        const dirs = axisDirs(this.down, GAME_KEYS);
        this.easy!.pilot.send({ roll: this.sticks.roll, pitch: this.sticks.pitch, yaw: this.sticks.yaw, lift: dirs.lift, throttle: this.throttle, boost: BOOST_CODES.some((c) => this.down.has(c)) }, t);
    }

    /** The gate is not armed for a reason other than the crash in progress. */
    private letGo(): boolean {
        const g = this.controls.gate;
        return !g.armed && g.block !== 'crashed';
    }

    dispose(): void {
        removeEventListener('keydown', this.onDown, { capture: true });
        removeEventListener('keyup', this.onUp, { capture: true });
        removeEventListener('blur', this.release);
        document.removeEventListener('visibilitychange', this.release);
        clearInterval(this.timer);
    }
}
