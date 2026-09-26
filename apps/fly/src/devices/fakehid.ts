// SimRadio, raw level: a fake "EdgeTX Classic" radio that emits real 19-byte joystick reports
// (3 button bytes + 8 x uint16 LE, 0..2048) through the same parser as a real radio. It has a
// channel order, per-channel inversion, a centre offset and noise, and it can follow the
// calibration wizard's screens like an ideal robot (optionally with a reaction delay), or like one
// of the simulated people of @gsfpv/input/sim (humanSeed). SimRadio is NOT a real radio.
//
// The wizard is user-paced (v3): nothing advances unless a button is pressed. The robot therefore
// moves the sticks AND presses the buttons (Start, Done, Measure, Next) through `onAct`, the same
// commands the page's buttons call; it never calls the wizard itself. `noButtons` keeps the hands
// and drops every press (the page-level negative control: the wizard must then stay put).

import type { RawFrame, WizardState } from '@gsfpv/input';
import { Human, emptyInstruction, instructionOf, quantize11, randomHuman } from '@gsfpv/input/sim';
import type { Stick, UiAction } from '@gsfpv/input/sim';
import { parseEdgeTxReport } from './hid';

export interface FakeRadioConfig {
    order: string; // e.g. "TAER" or "AETR": which function sits on channel 1..4
    invert: Partial<Record<'A' | 'E' | 'T' | 'R', boolean>>;
    centerOffset: number; // fraction of half range, e.g. 0.03
    noise: number; // fraction of half range, e.g. 0.01
    armChannel: number; // 0-based channel of the arm switch (4 = CH5); -1 = none: CH5 sends 0.0 like a fresh EdgeTX model
    rateHz: number;
    seed: number;
    brokenStick?: 'A' | 'E' | 'T' | 'R'; // negative control: this stick never moves
    reactMs?: number; // the robot starts on a new screen this long after it appears (default 0)
    humanSeed?: number; // behave like simulated person number N instead of the robot
    noButtons?: boolean; // move the hands as usual, never press a button (negative control)
}

type S = 'A' | 'E' | 'T' | 'R';
type Press = 'begin' | 'next' | 'skipArm';
const FN_STICK: Record<string, S> = { throttle: 'T', yaw: 'R', roll: 'A', pitch: 'E' };
const SLEW = 2 / 150; // full travel in 150 ms: hands move at a finite speed
// after the sticks reach their places: long enough for the wizard's 500 ms stillness at a press
const SETTLE_MS = 900;
const RETRY_MS = 400; // a refused press (the same screen after this long) is pressed again
const STIR_MIN_MS = 1700; // at least one full circle of both sticks before Done

export class FakeEdgeTx {
    readonly cfg: FakeRadioConfig;
    private sticks = { A: 0, E: 0, T: -1, R: 0 }; // physical stick positions -1..1 (T: -1 = low)
    private want = { A: 0, E: 0, T: -1, R: 0 }; // where the robot moves them
    arm = false;
    private timer = 0;
    private rng: () => number;
    readonly frame: RawFrame = { t: 0, axes: new Float32Array(8), buttons: 0 };
    private buf = new DataView(new ArrayBuffer(19));
    onFrame: ((f: RawFrame) => void) | null = null;
    reports = 0;
    follow: (() => WizardState | null) | null = null;
    /** The buttons the robot or the simulated person presses (Start, Next, Pick, Skip, Reverse, Back, Fly). */
    onAct: ((a: UiAction) => void) | null = null;
    /** Presses made (and, with noButtons, the ones dropped), for the page tests. */
    presses = 0;
    dropped = 0;
    readonly human: Human | null = null;
    private ins = emptyInstruction();
    private chv = new Float64Array(8);
    private lastT = NaN;
    private seenKey = '';
    private seenAt = 0;
    private doKey = '';
    private followT0 = 0;
    private arrivedAt = NaN; // when the sticks reached where this screen wants them
    private pressAt = NaN; // next press on this screen (NaN = none planned yet)
    private offSeenAt = NaN; // arm/active: when "now flip it back OFF" appeared

    constructor(cfg: FakeRadioConfig) {
        this.cfg = cfg;
        let a = cfg.seed >>> 0;
        this.rng = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
        if (cfg.humanSeed !== undefined) {
            const inv = { A: !!cfg.invert.A, E: !!cfg.invert.E, T: !!cfg.invert.T, R: !!cfg.invert.R } as Record<Stick, boolean>;
            this.human = new Human(randomHuman(cfg.humanSeed, cfg.order, inv));
            this.human.onAct = (act) => this.emitAct(act);
        }
    }

    get key(): string {
        return `hid:1209:4f54:SimRadio EdgeTX Classic ${this.cfg.order}:19`;
    }

    start(): void {
        this.timer = window.setInterval(() => this.emit(performance.now()), Math.max(1, Math.round(1000 / this.cfg.rateHz)));
    }

    stop(): void {
        clearInterval(this.timer);
    }

    /** Move a stick by hand (tests after the wizard); the robot then leaves it there. */
    set(stick: 'A' | 'E' | 'T' | 'R', v: number): void {
        const x = Math.max(-1, Math.min(1, v));
        this.sticks[stick] = x;
        this.want[stick] = x;
    }

    private emitAct(a: UiAction): void {
        if (this.cfg.noButtons) { this.dropped++; return; }
        this.presses++;
        this.onAct?.(a);
    }

    /** Behave like an ideal pilot following the wizard's screens (after reactMs): hands, then the button. */
    private autopilot(now: number, dt: number): void {
        const st = this.follow?.();
        if (!st) return;
        const k = st.stage ? `${st.id}/${st.stage}` : st.id;
        if (k !== this.seenKey) { this.seenKey = k; this.seenAt = now; }
        if (this.doKey !== this.seenKey && now - this.seenAt >= (this.cfg.reactMs ?? 0)) {
            this.doKey = this.seenKey;
            this.followT0 = now;
            this.arrivedAt = NaN;
            this.pressAt = NaN;
            this.offSeenAt = NaN;
        }
        const [id, stage] = this.doKey.split('/');
        const w = this.want;
        const el = now - this.followT0;
        let press: Press | null = null;
        let settle = SETTLE_MS;
        const centred = () => { w.A = 0; w.E = 0; w.R = 0; };
        switch (id) {
            case 'stir':
                this.arm = false;
                if (stage === 'active') {
                    // both sticks round and round through their full range; switches stay put
                    const a = (el / 1000) * Math.PI * 2 * 0.6;
                    w.A = Math.cos(a); w.E = Math.sin(a); w.R = Math.cos(a * 1.3); w.T = Math.sin(a * 1.3);
                    // Done once it is enabled and a full circle is behind (Done stays disabled for a broken stick)
                    if (el >= STIR_MIN_MS && st.can.next) { press = 'next'; settle = 0; }
                } else { centred(); w.T = -1; press = stage === 'ready' ? 'begin' : 'next'; }
                break;
            case 'centre':
                centred(); w.T = -1; this.arm = false;
                press = stage === 'ready' ? 'begin' : 'next'; // active: Measure
                break;
            case 'throttle': case 'yaw': case 'pitch': case 'roll': {
                const s = FN_STICK[id];
                centred();
                if (id === 'throttle') w.T = -1; // the other steps: the throttle stays where it is
                if (stage === 'active') w[s] = 1; // the asks are up / right; the drawing shows which
                else press = stage === 'ready' ? 'begin' : 'next'; // done: the stick is let go (throttle down) first
                break;
            }
            case 'arm':
                if (stage === 'ready') {
                    this.arm = false;
                    press = this.cfg.armChannel < 0 ? 'skipArm' : 'begin'; // no switch on any channel: arm with Space
                } else if (stage === 'active') {
                    // ON, and back OFF once the screen says so (after the reaction time, like a screen)
                    const back = st.armFlip?.phase === 'off';
                    if (back && Number.isNaN(this.offSeenAt)) this.offSeenAt = now;
                    if (!back) this.offSeenAt = NaN;
                    this.arm = !(back && now - this.offSeenAt >= (this.cfg.reactMs ?? 0));
                } else if (stage === 'done') { this.arm = false; press = 'next'; }
                break;
            default:
                break;
        }
        // hands move at a finite speed: a stick never jumps across its middle between two reports
        const step = SLEW * dt;
        let far = false;
        for (const q of ['A', 'E', 'T', 'R'] as S[]) {
            const d = w[q] - this.sticks[q];
            this.sticks[q] += d > step ? step : d < -step ? -step : d;
            if (Math.abs(w[q] - this.sticks[q]) > 0.02) far = true;
        }
        if (!press || id === 'check' || id === 'connect') return;
        if (settle > 0 && Number.isNaN(this.arrivedAt)) {
            if (far) return;
            this.arrivedAt = now;
            this.pressAt = now + settle;
        }
        if (now < this.pressAt) return; // false while NaN (stir Done: no arrival to wait for)
        // only an enabled button is pressed; the same screen after RETRY_MS = refused: press again
        this.pressAt = now + Math.max(RETRY_MS, this.cfg.reactMs ?? 0);
        if (press === 'begin' ? st.can.begin : press === 'next' ? st.can.next : st.can.skipArm) this.emitAct({ kind: press });
    }

    private emit(now: number): void {
        const dt = Number.isNaN(this.lastT) ? 0 : Math.max(0, Math.min(100, now - this.lastT));
        this.lastT = now;
        const d = this.buf;
        if (this.human) this.emitHuman(now, dt);
        else {
            if (this.follow) this.autopilot(now, dt);
            const c = this.cfg;
            // 3 button bytes: none used (the arm switch is an axis on EdgeTX)
            d.setUint8(0, 0); d.setUint8(1, 0); d.setUint8(2, 0);
            const fnOnChannel = (ch: number): S | null => (ch < 4 ? (c.order[ch] as S) : null);
            for (let ch = 0; ch < 8; ch++) {
                let v: number;
                const fn = fnOnChannel(ch);
                if (fn) {
                    v = fn === c.brokenStick ? 0 : this.sticks[fn];
                    if (c.invert[fn]) v = -v;
                    v += c.centerOffset + (this.rng() * 2 - 1) * c.noise;
                } else if (ch === c.armChannel) {
                    v = this.arm ? 1 : -1;
                } else if (ch === 4 && c.armChannel < 0) {
                    v = 0; // a fresh EdgeTX model mixes only the four sticks: CH5 sits at 0
                } else {
                    v = -1;
                }
                v = Math.max(-1, Math.min(1, v));
                d.setUint16(3 + ch * 2, Math.round(1024 + v * 1024 * 0.999), true);
            }
        }
        parseEdgeTxReport(d, this.frame);
        this.frame.t = now;
        this.reports++;
        this.onFrame?.(this.frame);
    }

    /** A simulated person (sim/human.ts) reads the wizard's screen, moves the sticks and presses the buttons. */
    private emitHuman(now: number, dt: number): void {
        const h = this.human!;
        const st = this.follow?.();
        if (st) h.see(instructionOf(st, this.ins), now);
        h.update(now, dt);
        const buttons = h.channels(this.chv);
        const d = this.buf;
        d.setUint8(0, buttons & 0xff); d.setUint8(1, (buttons >> 8) & 0xff); d.setUint8(2, (buttons >> 16) & 0xff);
        for (let ch = 0; ch < 8; ch++) d.setUint16(3 + ch * 2, Math.round(quantize11(this.chv[ch]) * 1024 + 1024), true);
    }
}
