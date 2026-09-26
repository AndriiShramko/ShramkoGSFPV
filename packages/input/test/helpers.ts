// Test helpers (not a test file): the adapter that lets the simulated people use the frozen first
// wizard (negative control), and the people grid used by the tests and the sweep.

import { CalibrationWizard as HeadWizard } from './fixtures/calib-head';
import { CalibrationWizard } from '../src/calib';
import type { RawFrame, WizardState } from '../src/calib';
import { emptyInstruction, Human, newWizardAdapter, quantize11, randomHuman, runHuman, STICKS } from '../src/sim/human';
import { mulberry32 } from '../src/sim/signals';
import type { Adapter, HumanConfig, Outcome, Stick } from '../src/sim/human';

const HEAD_WHERE = ['step0', 'step1', 'step2', 'step3', 'step4', 'step5', 'step6'];

/** The first wizard through the same person model. It has no hints and no escape buttons. */
export function headAdapter(): Adapter<HeadWizard> {
    const ins = emptyInstruction();
    return {
        read: (w) => {
            const st = w.state;
            ins.kind = st.step <= 1 ? 'stir' : st.step === 2 ? 'centre' : st.step === 3 ? 'push' : st.step === 4 ? 'release' : st.step === 5 ? 'armFlick' : 'check';
            ins.fn = st.step === 3 ? st.prompt : null;
            ins.hint = st.step === 3 && st.error === 'wizard.waiting' ? 'wizard.hint.push.none' : st.step === 1 && st.error === 'wizard.needFourAxes' ? 'wizard.hint.stir.few' : null;
            ins.ok = false;
            ins.flick = st.step <= 1; // it asked to flick every switch while stirring
            ins.can.cont = ins.can.useCurrent = ins.can.pick = ins.can.skipArm = false;
            ins.can.fly = st.step === 6;
            return ins;
        },
        act: () => undefined,
        profile: (w) => (w.state.step === 6 ? w.state.profile : null),
        where: (w) => HEAD_WHERE[w.state.step]
    };
}

/** All 24 channel orders of AETR, in a fixed order. */
export function allOrders(): string[] {
    const out: string[] = [];
    const rec = (pre: string, rest: string) => {
        if (!rest) { out.push(pre); return; }
        for (let i = 0; i < rest.length; i++) rec(pre + rest[i], rest.slice(0, i) + rest.slice(i + 1));
    };
    rec('', 'AETR');
    return out;
}

/** Inversion set number 0..15 as a record (bit 0 = A, 1 = E, 2 = T, 3 = R). */
export function invSet(n: number): Record<Stick, boolean> {
    const r = {} as Record<Stick, boolean>;
    STICKS.forEach((s, i) => { r[s] = ((n >> i) & 1) === 1; });
    return r;
}

export function invText(inv: Record<Stick, boolean>): string {
    return STICKS.filter((s) => inv[s]).join('') || '-';
}

export function runNew(cfg: HumanConfig, maxMs = 180000): Outcome {
    return runHuman(() => new CalibrationWizard('hid:test', 'test'), newWizardAdapter(), cfg, maxMs);
}

export function runHead(cfg: HumanConfig, maxMs = 180000): Outcome {
    return runHuman(() => new HeadWizard('hid:test', 'test'), headAdapter(), cfg, maxMs);
}

/** Person number `i` (0-based) of the fixed 384-person grid: 24 orders x 16 inversion sets, seed i+1. */
export function gridHuman(i: number, capHz = 500): HumanConfig {
    const orders = allOrders();
    const cfg = randomHuman(i + 1, orders[i % 24], invSet(Math.floor(i / 24) % 16));
    cfg.rateHz = Math.min(cfg.rateHz, capHz);
    return cfg;
}

/** Sweep run number i (0-based): person floor(i / 24) + 1, order i % 24, inversions drawn per run (p = 0.5 each). */
export function sweepHuman(i: number): HumanConfig {
    const seed = Math.floor(i / 24) + 1;
    const oi = i % 24;
    const r = mulberry32(seed * 1000 + oi);
    const inv = {} as Record<Stick, boolean>;
    for (const s of STICKS) inv[s] = r() < 0.5;
    return randomHuman(seed, allOrders()[oi], inv);
}

/**
 * A wizard fed frame by frame. A simulated person drives it; `manual` takes over the channels
 * (the person keeps reading the screen but their hands are ignored) so a test can script a case.
 */
export class Rig {
    readonly wz = new CalibrationWizard('hid:test', 'test');
    readonly human: Human;
    readonly ad = newWizardAdapter();
    readonly dt: number;
    t = 0;
    ch = new Float64Array(8);
    buttons = 0;
    manual: ((t: number, ch: Float64Array) => number | void) | null = null;
    flew = false;
    readonly sparse: boolean; // like a pad whose Gamepad.timestamp stays frozen at rest: a frame only when something changed
    skipped = 0; // frames not sent because nothing changed (sparse)
    private frame: RawFrame = { t: 0, axes: new Float32Array(8), buttons: 0 };
    private sent = new Float32Array(8).fill(NaN);
    private sentButtons = -1;
    private nextTick = 250;

    constructor(cfg: HumanConfig, opts: { sparse?: boolean } = {}) {
        this.human = new Human(cfg);
        this.dt = 1000 / cfg.rateHz;
        this.sparse = !!opts.sparse;
        // while a test script has the channels, the person's clicks are ignored too
        this.human.onAct = (a) => { if (this.manual) return; if (a.kind === 'fly') this.flew = true; else this.ad.act(this.wz, a); };
        this.wz.start(0);
    }

    get st(): WizardState { return this.wz.state; }

    step(): void {
        const t = this.t;
        this.human.see(this.ad.read(this.wz), t);
        this.human.update(t, this.dt);
        const b = this.human.channels(this.ch);
        if (this.manual) { const mb = this.manual(t, this.ch); this.buttons = typeof mb === 'number' ? mb : this.buttons; }
        else this.buttons = b;
        let same = this.buttons === this.sentButtons;
        for (let i = 0; i < 8; i++) { const x = quantize11(this.ch[i]); this.frame.axes[i] = x; if (x !== this.sent[i]) same = false; }
        this.frame.buttons = this.buttons;
        this.frame.t = t;
        if (this.sparse && same) this.skipped++;
        else { this.wz.feed(this.frame); this.sent.set(this.frame.axes); this.sentButtons = this.buttons; }
        if (t >= this.nextTick) { this.wz.tick(t); this.nextTick += 250; }
        this.t += this.dt;
    }

    /** Run until pred is true (checked after every frame); false on timeout. */
    until(pred: (st: WizardState) => boolean, maxMs = 60000): boolean {
        const end = this.t + maxMs;
        while (this.t < end) { this.step(); if (pred(this.wz.state)) return true; }
        return false;
    }

    /** Run for ms; `each` gets the state and the time of the frame just fed. */
    for(ms: number, each?: (st: WizardState, t: number) => void): void {
        const end = this.t + ms;
        while (this.t < end) { this.step(); each?.(this.wz.state, this.t - this.dt); }
    }

    /** Until the screen (id, phase) is showing and not in its check-mark pause. */
    to(id: string, phase: string | null = null, maxMs = 60000): boolean {
        return this.until((s) => s.id === id && s.phase === phase && !s.ok, maxMs);
    }

    /** Take over with fixed channel values (sticks centred, throttle down, arm off unless given). */
    hold(values: Partial<Record<number, number>> = {}, buttons = 0): void {
        const v = [0, 0, -1, 0, -1, 0, 0, 0];
        for (const [k, x] of Object.entries(values)) v[Number(k)] = x as number;
        this.manual = (_t, ch) => { for (let i = 0; i < 8; i++) ch[i] = v[i]; return buttons; };
    }
}

/** CI fuzz person i (0-based, 768 of them): seed 1001 + i, every order x inversion set twice. */
export function fuzzHuman(i: number): HumanConfig {
    return randomHuman(1001 + i, allOrders()[i % 24], invSet(Math.floor(i / 24) % 16));
}
export const FUZZ_N = 768;
