// Touch sticks: two pads. Left = throttle (sticky, stays where you leave it) + yaw (springs back);
// right = pitch + roll (spring back). Pointer events with coalesced samples, so fast swipes are
// not quantised to the frame rate. A big ARM button. The flight mode is the pilot's (prefs
// flight.mode, angle by default; the HUD mode chip): Controls puts it on ch[5], not this file.
// The ARM button follows the arm gate: it stays on through a crash and its respawn (with
// respawn.keepArmed the respawned craft flies on, design C.3), and shows ARM again when the gate
// let go for another reason (a refusal, a respawn that wants a new tap, a hidden tab).

import type { FlightSession } from '../session';
import type { Controls } from '../controls';
import { t } from '../i18n';

export class TouchSticks {
    readonly root: HTMLDivElement;
    private session: FlightSession;
    private controls: Controls;
    private ch = new Float32Array([0, 0, -1, 0, -1, 0, 0, 0]); // ch[5]: Controls writes the pilot's mode
    private throttle = 0;
    private pads: { el: HTMLDivElement; knob: HTMLDivElement; id: number | null; ox: number; oy: number; left: boolean }[] = [];
    private armBtn: HTMLButtonElement;
    armed = false;
    lastInput = 0;

    constructor(session: FlightSession, parent: HTMLElement, controls: Controls) {
        this.session = session;
        this.controls = controls;
        const root = document.createElement('div');
        root.className = 'touch-root interactive';
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
            const pad = { el, knob, id: null as number | null, ox: 0, oy: 0, left };
            this.pads.push(pad);
            el.addEventListener('pointerdown', (e) => this.down(pad, e));
            el.addEventListener('pointermove', (e) => this.move(pad, e));
            el.addEventListener('pointerup', (e) => this.up(pad, e));
            el.addEventListener('pointercancel', (e) => this.up(pad, e));
        }
        const arm = document.createElement('button');
        arm.className = 'touch-arm';
        arm.type = 'button';
        arm.textContent = t('arm.button');
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
        hint.textContent = t('touch.hint');
        root.append(hint);
        parent.append(root);
        document.body.classList.add('touch-on');
        this.layout();
        this.timer = window.setInterval(() => this.emit(performance.now()), 20); // keep-alive for the stale-input gate
    }

    private timer = 0;

    private layout(): void {
        for (const p of this.pads) this.place(p, 0, p.left ? this.throttle * 2 - 1 : 0);
    }

    private place(p: (typeof this.pads)[number], x: number, y: number): void {
        const r = p.el.clientWidth / 2 - 24;
        p.knob.style.transform = `translate(${x * r}px, ${-y * r}px)`;
    }

    private down(p: (typeof this.pads)[number], e: PointerEvent): void {
        if (p.id !== null) return;
        p.id = e.pointerId;
        p.el.setPointerCapture(e.pointerId);
        const rc = p.el.getBoundingClientRect();
        p.ox = rc.left + rc.width / 2;
        p.oy = rc.top + rc.height / 2;
        this.move(p, e);
        e.preventDefault();
    }

    private move(p: (typeof this.pads)[number], e: PointerEvent): void {
        if (p.id !== e.pointerId) return;
        const evs = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
        const list = evs.length ? evs : [e];
        const r = p.el.clientWidth / 2 - 24;
        for (const ev of list) {
            let x = (ev.clientX - p.ox) / r;
            let y = -(ev.clientY - p.oy) / r;
            x = Math.max(-1, Math.min(1, x));
            y = Math.max(-1, Math.min(1, y));
            if (p.left) {
                this.throttle = (y + 1) / 2;
                this.ch[3] = x;
                this.ch[2] = y;
            } else {
                this.ch[0] = x;
                this.ch[1] = y;
            }
            this.place(p, x, y);
            this.emit(ev.timeStamp);
        }
        e.preventDefault();
    }

    private up(p: (typeof this.pads)[number], e: PointerEvent): void {
        if (p.id !== e.pointerId) return;
        p.id = null;
        if (p.left) {
            this.ch[3] = 0; // yaw springs back, throttle stays
            this.place(p, 0, this.throttle * 2 - 1);
        } else {
            this.ch[0] = 0;
            this.ch[1] = 0;
            this.place(p, 0, 0);
        }
        this.emit(e.timeStamp);
    }

    private emit(tMs: number): void {
        this.ch[4] = this.armed ? 1 : -1;
        this.lastInput = tMs;
        this.controls.channels(this.ch, tMs); // through the arm gate like every other source
        if (this.armed && this.letGo()) this.setArmed(false);
    }

    /** The gate is not armed for a reason other than the crash in progress (which keepArmed rides through). */
    private letGo(): boolean {
        const g = this.controls.gate;
        return !g.armed && g.block !== 'crashed';
    }

    /** Current channels (for tests). */
    get channels(): Float32Array {
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
