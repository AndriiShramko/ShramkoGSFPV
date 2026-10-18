// Keyboard input (flying without a radio, latency measurement). Two profiles (prefs input.play;
// docs/wip/v09-b.md, the owner's message 22 item 1: "ordinary PC gamers still cannot fly a scene on the
// keyboard; nothing like the way games control flying characters"):
//  - easy (default): the game scheme. W/S (or Up/Down) forward and back, A/D left and right, relative to
//    where the drone faces; the side arrows or Q/E turn for players without a mouse; Space up, Shift down;
//    the mouse (pointer lock, play/mouse-look.ts) turns and tilts the camera gimbal. Let go of every key and
//    the drone brakes and holds its place. The first flying key starts the motors (Shift alone does not).
//    The keys are intents: play/game.ts turns them into sticks for the angle-mode physics, play/game-pilot.ts
//    sends the frames. Ctrl is never read (Ctrl+W closes the tab).
//  - pilot: the Mode 2 layout of v0.2-v0.7, unchanged: W/S throttle (stays where it is left; held W is
//    0 -> 100 % in 0.5 s of real time), A/D yaw, arrows roll/pitch, every key bang-bang, Space arms.
// The flight mode is not read here: M is the page's mode key for every input (keymap mode.cycle,
// app/builtin/modes.ts) and Controls puts the pilot's mode on ch[5] (angle in the game scheme).
// F13..F24 are reserved for the latency harness: each press is one numbered input event that
// travels the normal path (queue -> physics tick -> marker in the next rendered frame).
// Every frame goes through Controls and its arm gate, like the other sources. Only the chosen
// source flies: with a radio, a gamepad or touch sticks the keyboard is passive (Space only asks
// Controls to arm, which acts for a radio without an arm switch), so a held or lost key can never
// override the radio (item 22).

import type { Controls } from '../controls';
import type { GamePilot } from '../play/game-pilot';
import { mouseToAim } from '../play/game';
import { GAME_KEYS, GAME_START_CODES, MODE2_KEYS, gameDirs, mode2Sticks } from '../play/keys';
import type { PlayProfile } from '../play/keys';

/** The pilot layout's keys (Mode 2): read by the pilot profile only. */
const FLY_KEYS = MODE2_KEYS.map((k) => k.code);
/** Every key the game scheme reads (Shift is the descent). */
const GAME_CODES = GAME_KEYS.map((k) => k.code);

/** Held W takes the throttle from 0 to 100 % in this long, by elapsed time (timers get clamped). */
const THR_UP_MS = 500;
/** Held S takes it from 100 % to 0 faster: cutting throttle is the hurried move. */
const THR_DOWN_MS = 333;
/** A longer gap between two updates is a stalled page, not key-held time the pilot meant. */
const RAMP_MAX_STEP_MS = 200;
/** The game scheme sends a frame at least this often while the keyboard flies (the loops need a steady stream). */
const GAME_FRAME_MS = 10;

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

/** What the game scheme needs from the page besides the keys: the pilot and the mouse settings. */
export interface KeyboardGame {
    pilot: GamePilot;
    /** prefs input.mouseSensitivity */
    sensitivity(): number;
    /** prefs input.mouseInvertY */
    invertY(): boolean;
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
    /** the game scheme's parts, given by the input host; without them the easy profile flies as pilot */
    game: KeyboardGame | null = null;
    private controls: Controls;
    private timer = 0;
    /** page time the throttle ramp has been integrated up to */
    private rampT = 0;
    private lastGameEmit = -1e9;

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

    /** The game scheme is what flies: the easy profile with its parts given. */
    private get isGame(): boolean {
        return this.profile === 'easy' && this.game !== null;
    }

    /**
     * Shift is held as the game scheme's descent. The key router reads it so that a shortcut pressed
     * meanwhile is read as its chord first, else as the key alone (app/keys.ts shiftIsFlying): Esc
     * pauses while a pilot holds Shift to land.
     */
    shiftFlies(): boolean {
        return !this.passive && this.isGame && (this.down.has('ShiftLeft') || this.down.has('ShiftRight'));
    }

    /** Fly with the keyboard (true) or leave the sticks to another source (false). */
    setActive(on: boolean): void {
        this.passive = !on;
        this.down.clear();
        this.rampT = performance.now();
        if (on) this.emit(performance.now()); // the HUD's arm hint needs one frame from the chosen source
    }

    /** Another profile (Settings): held keys are dropped, the motors stay as they are until the next key. */
    setProfile(p: PlayProfile): void {
        if (p === this.profile) return;
        this.profile = p;
        this.down.clear();
        this.armed = false;
        if (!this.passive) this.emit(performance.now());
    }

    /** Mouse movement in pixels while the pointer is locked (play/mouse-look.ts): the aim turns, the camera gimbal tilts. */
    mouse(dxPx: number, dyPx: number): void {
        if (this.passive || !this.isGame) return;
        const g = this.game!;
        const a = mouseToAim(dxPx, dyPx, g.sensitivity(), g.invertY());
        g.pilot.look(a.yaw, a.pitch);
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
        if (this.isGame) { this.onDownGame(e); return; }
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

    /** Game scheme: a flying key is held until it goes up; the first one that is not Shift starts the motors. */
    private onDownGame(e: KeyboardEvent): void {
        if (!GAME_CODES.includes(e.code)) return;
        this.down.add(e.code);
        if (GAME_START_CODES.includes(e.code)) this.game!.pilot.arm.request();
        this.emitGame(e.timeStamp);
        // Shift has no default action of its own; Space and the arrows would scroll the page
        if (!e.code.startsWith('Shift')) e.preventDefault();
    }

    private onUp = (e: KeyboardEvent): void => {
        if (this.isGame) {
            if (this.down.delete(e.code) && !this.passive) this.emitGame(e.timeStamp);
            return;
        }
        this.ramp(e.timeStamp); // the time since the last tick was held too
        const was = this.down.delete(e.code);
        // with every key up the tick sends nothing more: the throttle where W / S left it goes out now
        if (was && (e.code === 'KeyW' || e.code === 'KeyS')) this.emit(this.rampT);
    };

    private release = (): void => {
        if (!this.isGame) this.ramp(performance.now());
        this.down.clear();
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
        if (this.isGame) {
            if (t - this.lastGameEmit >= GAME_FRAME_MS) this.emitGame(t);
            return;
        }
        this.ramp(t);
        const d = this.down;
        if (d.size === 0 && this.ch[0] === 0 && this.ch[1] === 0 && this.ch[3] === 0) return;
        this.emit(t);
    }

    private emit(t: number): void {
        if (this.passive) return;
        if (this.isGame) { this.emitGame(t); return; }
        const st = mode2Sticks(this.down); // bang-bang, as v0.2-v0.7
        this.ch[0] = st.roll;
        this.ch[1] = st.pitch;
        this.ch[3] = st.yaw;
        this.ch[2] = this.throttle * 2 - 1;
        this.ch[4] = this.armed ? 1 : -1;
        this.controls.channels(this.ch, t);
        // refused (throttle up, a respawn that wants a new flip) or disarmed by the gate: the next
        // Space arms. Not while crashed: with respawn.keepArmed the switch held on through the crash
        // is what arms the respawned craft (design C.3)
        if (this.armed && this.letGo()) this.armed = false;
    }

    private emitGame(t: number): void {
        if (this.passive) return;
        this.lastGameEmit = t;
        this.game!.pilot.send(gameDirs(this.down), t);
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
