// SimRadio, raw level: a fake "EdgeTX Classic" radio that emits real 19-byte joystick reports
// (3 button bytes + 8 x uint16 LE, 0..2048) through the same parser as a real radio. It has a
// channel order, per-channel inversion, a centre offset and noise, and it can follow the
// calibration wizard's screens like an ideal robot (optionally with a reaction delay), or like one
// of the simulated people of @gsfpv/input/sim (humanSeed). SimRadio is NOT a real radio.

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
}

type S = 'A' | 'E' | 'T' | 'R';
const FN_STICK: Record<string, S> = { throttle: 'T', yaw: 'R', roll: 'A', pitch: 'E' };
const SLEW = 2 / 150; // full travel in 150 ms: a stick passes the middle on the way (the wizard's arrival rule)

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
    /** Clicks of the simulated person (humanSeed): Continue, Use current, Pick, Skip, Fly. */
    onAct: ((a: UiAction) => void) | null = null;
    readonly human: Human | null = null;
    private ins = emptyInstruction();
    private chv = new Float64Array(8);
    private lastT = NaN;
    private seenId = '';
    private seenPhase: string | null = null;
    private seenAt = 0;
    private doId = '';
    private doPhase: string | null = null;
    private followT0 = 0;

    constructor(cfg: FakeRadioConfig) {
        this.cfg = cfg;
        let a = cfg.seed >>> 0;
        this.rng = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
        if (cfg.humanSeed !== undefined) {
            const inv = { A: !!cfg.invert.A, E: !!cfg.invert.E, T: !!cfg.invert.T, R: !!cfg.invert.R } as Record<Stick, boolean>;
            this.human = new Human(randomHuman(cfg.humanSeed, cfg.order, inv));
            this.human.onAct = (act) => this.onAct?.(act);
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

    /** Behave like an ideal person following the wizard's screens (after reactMs). */
    private autopilot(now: number, dt: number): void {
        const st = this.follow?.();
        if (!st) return;
        if (st.id !== this.seenId || st.phase !== this.seenPhase) { this.seenId = st.id; this.seenPhase = st.phase; this.seenAt = now; }
        if ((this.seenId !== this.doId || this.seenPhase !== this.doPhase) && now - this.seenAt >= (this.cfg.reactMs ?? 0)) {
            this.doId = this.seenId;
            this.doPhase = this.seenPhase;
            this.followT0 = now;
        }
        const w = this.want;
        const el = now - this.followT0;
        switch (this.doId) {
            case 'stir': {
                // both sticks round and round through their full range; switches stay put
                const a = (el / 1000) * Math.PI * 2 * 0.6;
                w.A = Math.cos(a); w.E = Math.sin(a); w.R = Math.cos(a * 1.3); w.T = Math.sin(a * 1.3);
                this.arm = false;
                break;
            }
            case 'centre':
                w.A = 0; w.E = 0; w.R = 0; w.T = -1; this.arm = false;
                break;
            case 'throttle':
                w.A = 0; w.E = 0; w.R = 0;
                w.T = this.doPhase === 'push' ? 1 : -1;
                break;
            case 'yaw': case 'pitch': case 'roll':
                w.A = 0; w.E = 0; w.R = 0; // the throttle stays where it is
                if (this.doPhase === 'push') w[FN_STICK[this.doId]] = 1;
                break;
            case 'arm':
                this.arm = this.doPhase === 'on';
                break;
            default:
                break;
        }
        // hands move at a finite speed: a stick never jumps across its middle between two reports
        const step = SLEW * dt;
        for (const k of ['A', 'E', 'T', 'R'] as S[]) {
            const d = w[k] - this.sticks[k];
            this.sticks[k] += d > step ? step : d < -step ? -step : d;
        }
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

    /** A simulated person (sim/human.ts) reads the wizard's screen and moves the sticks. */
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
