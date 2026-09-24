// SimRadio, raw level: a fake "EdgeTX Classic" radio that emits real 19-byte joystick reports
// (3 button bytes + 8 x uint16 LE, 0..2048) through the same parser as a real radio. It has a
// channel order, per-channel inversion, a centre offset and noise, and it can follow the
// calibration wizard's prompts like a person would. SimRadio is NOT a real radio.

import type { RawFrame, WizardState } from '@gsfpv/input';
import { parseEdgeTxReport } from './hid';

export interface FakeRadioConfig {
    order: string; // e.g. "TAER" or "AETR": which function sits on channel 1..4
    invert: Partial<Record<'A' | 'E' | 'T' | 'R', boolean>>;
    centerOffset: number; // fraction of half range, e.g. 0.03
    noise: number; // fraction of half range, e.g. 0.01
    armChannel: number; // 0-based channel index of the arm switch (e.g. 4 = CH5)
    rateHz: number;
    seed: number;
    brokenStick?: 'A' | 'E' | 'T' | 'R'; // negative control: this stick never moves
}

export class FakeEdgeTx {
    readonly cfg: FakeRadioConfig;
    private sticks = { A: 0, E: 0, T: -1, R: 0 }; // physical stick positions -1..1 (T: -1 = low)
    arm = false;
    private timer = 0;
    private rng: () => number;
    readonly frame: RawFrame = { t: 0, axes: new Float32Array(8), buttons: 0 };
    private buf = new DataView(new ArrayBuffer(19));
    onFrame: ((f: RawFrame) => void) | null = null;
    reports = 0;
    follow: (() => WizardState | null) | null = null;
    private followT0 = 0;
    private lastStep = -1;
    private lastPrompt: string | null = null;
    private armFlips = 0;

    constructor(cfg: FakeRadioConfig) {
        this.cfg = cfg;
        let a = cfg.seed >>> 0;
        this.rng = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
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

    set(stick: 'A' | 'E' | 'T' | 'R', v: number): void {
        this.sticks[stick] = Math.max(-1, Math.min(1, v));
    }

    /** Behave like a person following the wizard's prompts. */
    private autopilot(now: number): void {
        const st = this.follow?.();
        if (!st) return;
        if (st.step !== this.lastStep) { this.lastStep = st.step; this.followT0 = now; this.armFlips = 0; }
        const el = now - this.followT0;
        const s = this.sticks;
        switch (st.step) {
            case 1: {
                // stir both sticks through their full range, flick the switch
                const w = (el / 1000) * Math.PI * 2 * 0.6;
                s.A = Math.cos(w); s.E = Math.sin(w); s.R = Math.cos(w * 1.3); s.T = Math.sin(w * 1.3);
                this.arm = Math.floor(el / 1500) % 2 === 1;
                break;
            }
            case 2:
                s.A = 0; s.E = 0; s.R = 0; s.T = -1; this.arm = false;
                break;
            case 3: {
                if (st.prompt !== this.lastPrompt) { this.lastPrompt = st.prompt; }
                const map: Record<string, 'A' | 'E' | 'T' | 'R'> = { throttle: 'T', yaw: 'R', roll: 'A', pitch: 'E' };
                if (st.prompt) {
                    // centre the self-centring sticks, then push the prompted one
                    s.A = 0; s.E = 0; s.R = 0;
                    s[map[st.prompt]] = 1;
                }
                break;
            }
            case 4:
                s.A = 0; s.E = 0; s.R = 0; // throttle stays where it is
                break;
            case 5:
                if (el > 250 * (this.armFlips + 1)) { this.arm = !this.arm; this.armFlips++; }
                break;
            default:
                break;
        }
    }

    private emit(now: number): void {
        if (this.follow) this.autopilot(now);
        const c = this.cfg;
        const d = this.buf;
        // 3 button bytes: none used (the arm switch is an axis on EdgeTX)
        d.setUint8(0, 0); d.setUint8(1, 0); d.setUint8(2, 0);
        const fnOnChannel = (ch: number): 'A' | 'E' | 'T' | 'R' | null => (ch < 4 ? (c.order[ch] as 'A' | 'E' | 'T' | 'R') : null);
        for (let ch = 0; ch < 8; ch++) {
            let v: number;
            const fn = fnOnChannel(ch);
            if (fn) {
                v = fn === c.brokenStick ? 0 : this.sticks[fn];
                if (c.invert[fn]) v = -v;
                v += c.centerOffset + (this.rng() * 2 - 1) * c.noise;
            } else if (ch === c.armChannel) {
                v = this.arm ? 1 : -1;
            } else {
                v = -1;
            }
            v = Math.max(-1, Math.min(1, v));
            d.setUint16(3 + ch * 2, Math.round(1024 + v * 1024 * 0.999), true);
        }
        parseEdgeTxReport(d, this.frame);
        this.frame.t = now;
        this.reports++;
        this.onFrame?.(this.frame);
    }
}
