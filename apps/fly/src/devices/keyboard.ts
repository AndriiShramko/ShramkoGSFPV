// Keyboard input (development, latency measurement, flying without a radio).
// Manual flying: W/S throttle (stays where it is left; held W is 0 -> 100 % in 0.5 s of real
// time), A/D yaw, arrows roll/pitch, Space = arm toggle, M = angle mode.
// F13..F24 are reserved for the latency harness: each press is one numbered input event that
// travels the normal path (queue -> physics tick -> marker in the next rendered frame).
// Every frame goes through Controls and its arm gate, like the other sources. Only the chosen
// source flies: with a radio, a gamepad or touch sticks the keyboard is passive (Space only asks
// Controls to arm, which acts for a radio without an arm switch), so a held or lost key can never
// override the radio (item 22).

import type { Controls } from '../controls';

const FLY_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD'];

/** Held W takes the throttle from 0 to 100 % in this long, by elapsed time (timers get clamped). */
const THR_UP_MS = 500;
/** Held S takes it from 100 % to 0 faster: cutting throttle is the hurried move. */
const THR_DOWN_MS = 333;
/** A longer gap between two updates is a stalled page, not key-held time the pilot meant. */
const RAMP_MAX_STEP_MS = 200;

/** Inputs that take no text: a focused slider or checkbox must not swallow R, P or Esc. */
const NOT_TEXT = new Set(['range', 'checkbox', 'radio', 'button', 'submit', 'reset']);

/** Keys typed into a field (import text, settings numbers) are text, not sticks or shortcuts. */
export function typing(el: EventTarget | null): boolean {
    if (el instanceof HTMLInputElement) return !NOT_TEXT.has(el.type);
    return el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || (el instanceof HTMLElement && el.isContentEditable);
}

/** A dialog is up (Controls, pause menu, settings, a picker): Space and arrows belong to its buttons. */
export function dialogOpen(): boolean {
    return !!document.querySelector('.screen.radio, .panel, .screen.drones, .screen.scenes');
}

export class KeyboardSource {
    private down = new Set<string>();
    private ch = new Float32Array([0, 0, -1, 0, -1, 0, 0, 0]);
    private throttle = 0;
    private armed = false;
    private angle = false;
    latencyId = 0;
    /** Another source flies; Space calls onArm, every other flying key is ignored. */
    passive = true;
    onArm: (() => void) | null = null;
    private controls: Controls;
    private timer = 0;
    /** page time the throttle ramp has been integrated up to */
    private rampT = 0;

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

    /** Fly with the keyboard (true) or leave the sticks to another source (false). */
    setActive(on: boolean): void {
        this.passive = !on;
        this.down.clear();
        this.rampT = performance.now();
        if (on) this.emit(performance.now()); // the HUD's arm hint needs one frame from the chosen source
    }

    private onDown = (e: KeyboardEvent): void => {
        if (typing(e.target) || dialogOpen()) return;
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
        if (e.code === 'Space' && !e.repeat) { this.armed = !this.armed; this.emit(e.timeStamp); e.preventDefault(); }
        if (e.code === 'KeyM' && !e.repeat) { this.angle = !this.angle; this.emit(e.timeStamp); }
        if (FLY_KEYS.includes(e.code)) {
            if (!this.down.has(e.code)) this.ramp(e.timeStamp); // the ramp starts at the press, not the next tick
            this.down.add(e.code);
            e.preventDefault();
        }
    };

    private onUp = (e: KeyboardEvent): void => {
        this.ramp(e.timeStamp); // the time since the last tick was held too
        const was = this.down.delete(e.code);
        // with every key up the tick sends nothing more: the throttle where W / S left it goes out now
        if (was && (e.code === 'KeyW' || e.code === 'KeyS')) this.emit(this.rampT);
    };

    private release = (): void => {
        this.ramp(performance.now());
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
        this.ramp(t);
        const d = this.down;
        if (d.size === 0 && this.ch[0] === 0 && this.ch[1] === 0 && this.ch[3] === 0) return;
        this.emit(t);
    }

    private emit(t: number): void {
        if (this.passive) return;
        const d = this.down;
        this.ch[0] = (d.has('ArrowRight') ? 0.6 : 0) - (d.has('ArrowLeft') ? 0.6 : 0);
        this.ch[1] = (d.has('ArrowUp') ? 0.6 : 0) - (d.has('ArrowDown') ? 0.6 : 0);
        this.ch[3] = (d.has('KeyD') ? 0.5 : 0) - (d.has('KeyA') ? 0.5 : 0);
        this.ch[2] = this.throttle * 2 - 1;
        this.ch[4] = this.armed ? 1 : -1;
        this.ch[5] = this.angle ? 1 : -1;
        this.controls.channels(this.ch, t);
        // refused (throttle up, crashed, respawned) or disarmed by the gate: the next Space arms
        if (this.armed && !this.controls.gate.armed) this.armed = false;
    }

    dispose(): void {
        removeEventListener('keydown', this.onDown, { capture: true });
        removeEventListener('keyup', this.onUp, { capture: true });
        removeEventListener('blur', this.release);
        document.removeEventListener('visibilitychange', this.release);
        clearInterval(this.timer);
    }
}
