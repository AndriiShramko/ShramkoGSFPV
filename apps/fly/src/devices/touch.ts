// Touch sticks: two pads. Left = throttle (or, in easy play with the altitude help, up/down) + yaw;
// right = pitch + roll. Pointer events with coalesced samples, so fast swipes are not quantised to the
// frame rate. The flight mode is the pilot's (prefs flight.mode, angle by default; the HUD mode chip):
// Controls puts it on ch[5], not this file.
//
// A finger grabs a stick where it is (play/touch-map.ts PadGrab; the owner's message 21 item 2): a
// touch-down never moves a stick, then the finger moves it by the same amount per pixel as before
// (full deflection at the pad's half width minus the knob), or sooner on a side where the screen's
// edge is nearer, so full deflection is always reachable. The knob shows the stick's position on
// its pad, as a radio's gimbal would. v0.7's pads were absolute, so a finger
// landing off-centre was a step on that stick and every touch on the left pad set the throttle to
// where the thumb landed: a radio's stick never does either.
//
// Two profiles (prefs input.play, docs/wip/v08-a.md):
//  - easy (default): no ARM button; touching a pad starts the motors (play/easy.ts EasyPilot); with
//    the altitude help on (angle mode) the left stick's up/down asks for a climb or sink speed and
//    springs back to centre (= hold the height), like a camera drone's left stick; without it the left
//    stick is a throttle that stays where it is left.
//  - pilot: the big ARM button, the throttle stays where it is left (v0.7's behaviour).
// The ARM button follows the arm gate: it stays on through a crash and its respawn (with
// respawn.keepArmed the respawned craft flies on, design C.3), and shows ARM again when the gate
// let go for another reason (a refusal, a respawn that wants a new tap, a hidden tab).

import type { Controls } from '../controls';
import type { EasyPilot } from '../play/easy';
import type { PlayProfile } from '../play/keys';
import { PadGrab, padTravel, reachOf } from '../play/touch-map';
import { t } from '../i18n';

/** Keep-alive of the pilot profile (the stale-input gate never applies to touch, the HUD reads it). */
const KEEPALIVE_MS = 20;
/** Easy play sends a frame this often: the altitude help needs a steady stream. */
const EASY_FRAME_MS = 10;

/** One pad: its finger (pointer id), where the finger is now (client px) and where its zero is. */
interface Pad { el: HTMLDivElement; knob: HTMLDivElement; id: number | null; grab: PadGrab; left: boolean; px: number; py: number }

export class TouchSticks {
    readonly root: HTMLDivElement;
    private controls: Controls;
    private ch = new Float32Array([0, 0, -1, 0, -1, 0, 0, 0]); // ch[5]: Controls writes the pilot's mode
    /** the own throttle 0..1 (pilot, and easy play without the altitude help) */
    private throttle = 0;
    /** easy play with the help: the left stick's up/down, -1..1, springs back to 0 */
    private lift = 0;
    private pads: Pad[] = [];
    private armBtn: HTMLButtonElement;
    private hint: HTMLDivElement;
    private readonly profile: PlayProfile;
    private readonly easy: EasyPilot | null;
    /** the left stick flies the altitude help's up/down (it springs back), not a throttle */
    private climbStick = false;
    armed = false;
    lastInput = 0;
    private timer = 0;

    /** `easy`: easy play's pilot (prefs input.play 'easy'); null flies the pilot profile. */
    constructor(parent: HTMLElement, controls: Controls, easy: EasyPilot | null = null) {
        this.controls = controls;
        this.easy = easy;
        this.profile = easy ? 'easy' : 'pilot';
        const root = document.createElement('div');
        root.className = `touch-root interactive ${this.profile}`;
        this.root = root;
        for (const left of [true, false]) {
            const el = document.createElement('div');
            el.className = `touch-pad ${left ? 'left' : 'right'}`;
            el.setAttribute('role', 'application');
            el.setAttribute('aria-label', left ? `${t('touch.throttle')} / yaw` : 'pitch / roll');
            const knob = document.createElement('div');
            knob.className = 'touch-knob';
            el.append(knob);
            root.append(el);
            const pad: Pad = { el, knob, id: null, grab: new PadGrab(), left, px: 0, py: 0 };
            this.pads.push(pad);
            el.addEventListener('pointerdown', (e) => this.down(pad, e));
            // pointermove (rAF-aligned, its coalesced samples read in move()): Chrome dispatches it just
            // before the frame whose physics step takes the samples by their own timestamps, so a touch
            // reaches the flight at the same frame as the earliest handling (pointerrawupdate, a radio's
            // report between frames) would; measured: accept-v08-play.ts T5, docs/wip/v08-a.md section 3
            el.addEventListener('pointermove', (e) => this.move(pad, e));
            el.addEventListener('pointerup', (e) => this.up(pad, e));
            el.addEventListener('pointercancel', (e) => this.up(pad, e));
        }
        const arm = document.createElement('button');
        arm.className = 'touch-arm';
        arm.type = 'button';
        arm.textContent = t('arm.button');
        arm.hidden = this.profile === 'easy'; // easy play has no arming
        arm.addEventListener('click', (e) => {
            // shown on but the gate let go meanwhile: this tap is "arm", so OFF goes out first and
            // the gate sees the edge it waits for
            if (this.armed && this.letGo()) { this.armed = false; this.emit(e.timeStamp); }
            this.setArmed(!this.armed);
            this.emit(e.timeStamp);
        });
        this.armBtn = arm;
        root.append(arm);
        const hint = document.createElement('div');
        hint.className = 'touch-hint';
        this.hint = hint;
        root.append(hint);
        parent.append(root);
        document.body.classList.add('touch-on');
        this.climbStick = this.wantClimb();
        this.drawHint();
        this.layout();
        this.timer = window.setInterval(() => this.emit(performance.now()), this.easy ? EASY_FRAME_MS : KEEPALIVE_MS);
    }

    /** Easy play's left stick flies the altitude help now (on, and in angle mode). */
    private wantClimb(): boolean {
        return !!this.easy && this.easy.helpActive();
    }

    private drawHint(): void {
        const s = this.profile === 'pilot' ? t('touch.hint') : t(this.climbStick ? 'play.touch.hint.climb' : 'play.touch.hint.throttle');
        if (this.hint.textContent !== s) this.hint.textContent = s;
    }

    /** The left stick's vertical value as drawn: up/down with the help, else the throttle. */
    private leftY(): number {
        return this.climbStick ? this.lift : this.throttle * 2 - 1;
    }

    private layout(): void {
        for (const p of this.pads) this.place(p, p.left ? this.ch[3] : this.ch[0], p.left ? this.leftY() : this.ch[1]);
    }

    private travel(p: Pad): number {
        return padTravel(p.el.clientWidth);
    }

    private place(p: Pad, x: number, y: number): void {
        const r = this.travel(p);
        p.knob.style.transform = `translate(${x * r}px, ${-y * r}px)`;
    }

    private down(p: Pad, e: PointerEvent): void {
        if (p.id !== null) return;
        p.id = e.pointerId;
        p.el.setPointerCapture(e.pointerId);
        // the finger takes the stick where it is: the spring axes at centre, the throttle where it was left
        p.grab.grab(e.clientX, e.clientY, p.left ? this.ch[3] : this.ch[0], p.left ? this.leftY() : this.ch[1], this.travel(p), reachOf(innerWidth, innerHeight));
        this.easy?.arm.request(); // easy play: a touch on a stick starts the motors
        this.move(p, e);
        e.preventDefault();
    }

    private move(p: Pad, e: PointerEvent): void {
        if (p.id !== e.pointerId) return;
        const evs = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
        const list = evs.length ? evs : [e];
        for (const ev of list) {
            p.px = ev.clientX;
            p.py = ev.clientY;
            const [x, y] = p.grab.read(ev.clientX, ev.clientY);
            if (p.left) {
                this.ch[3] = x;
                if (this.climbStick) this.lift = y;
                else this.throttle = (y + 1) / 2;
            } else {
                this.ch[0] = x;
                this.ch[1] = y;
            }
            this.place(p, x, y);
            this.emit(ev.timeStamp);
        }
        e.preventDefault();
    }

    private up(p: Pad, e: PointerEvent): void {
        if (p.id !== e.pointerId) return;
        p.id = null;
        if (p.left) {
            this.ch[3] = 0; // yaw springs back; the throttle stays, the up/down of the help springs back too
            this.lift = 0;
            this.place(p, 0, this.leftY());
        } else {
            this.ch[0] = 0;
            this.ch[1] = 0;
            this.place(p, 0, 0);
        }
        this.emit(e.timeStamp);
    }

    private emit(tMs: number): void {
        this.lastInput = tMs;
        if (this.easy) {
            // the help switched on or off (Settings, a school step, the mode): the left stick changes job
            // without a jump: the own throttle continues from what the help sent
            const climb = this.wantClimb();
            if (climb !== this.climbStick) {
                this.climbStick = climb;
                this.throttle = this.easy.throttleSent;
                this.lift = 0;
                this.drawHint();
                // a finger on the left pad keeps its place: the stick's new value is under it from now on
                const lp = this.pads[0];
                if (lp.id !== null) lp.grab.grab(lp.px, lp.py, this.ch[3], this.leftY(), this.travel(lp), reachOf(innerWidth, innerHeight));
                this.place(lp, this.ch[3], this.leftY());
            } else if (climb) this.throttle = this.easy.throttleSent;
            this.easy.send({ roll: this.ch[0], pitch: this.ch[1], yaw: this.ch[3], lift: this.lift, throttle: this.throttle, boost: false }, tMs);
            return;
        }
        this.ch[2] = this.throttle * 2 - 1;
        this.ch[4] = this.armed ? 1 : -1;
        this.controls.channels(this.ch, tMs); // through the arm gate like every other source
        if (this.armed && this.letGo()) this.setArmed(false);
    }

    /** The gate is not armed for a reason other than the crash in progress (which keepArmed rides through). */
    private letGo(): boolean {
        const g = this.controls.gate;
        return !g.armed && g.block !== 'crashed';
    }

    /** Current channels as the sticks set them (for tests): roll, pitch, throttle (or the help's up/down), yaw. */
    get channels(): Float32Array {
        this.ch[2] = this.leftY();
        return this.ch;
    }

    setArmed(on: boolean): void {
        this.armed = on;
        this.armBtn.textContent = on ? t('arm.disarm') : t('arm.button');
        this.armBtn.classList.toggle('on', on);
    }

    dispose(): void {
        clearInterval(this.timer);
        document.body.classList.remove('touch-on');
        this.root.remove();
    }
}
