// Test helpers (not a test file): the adapters that let the simulated people use the frozen first
// wizard and the frozen v2 (negative controls), the people grid used by the tests and the sweep,
// the Rig that feeds a wizard frame by frame, the Watch that checks the command invariant (no
// screen changes without a button press, except the three frame changes of wizard v3), and the
// Presser (someone who presses every enabled button now and then without moving the sticks).

import { CalibrationWizard as HeadWizard } from './fixtures/calib-head';
import { CalibrationWizard as V2Wizard } from './fixtures/calib-v2';
import type { WizardState as V2State } from './fixtures/calib-v2';
import { CalibrationWizard } from '../src/calib';
import type { RawFrame, Verdict, WizardState } from '../src/calib';
import { act, emptyInstruction, Human, newWizardAdapter, quantize11, randomHuman, runHuman, STICKS } from '../src/sim/human';
import { mulberry32 } from '../src/sim/signals';
import type { Adapter, HumanConfig, Instruction, Observer, Outcome, Stick, UiAction } from '../src/sim/human';

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

/** What a person reads from the frozen v2's state (its screens have phases and a check-mark pause). */
export function v2InstructionOf(st: V2State, out: Instruction = emptyInstruction()): Instruction {
    const id = st.id;
    out.kind = id === 'connect' ? 'connect' : id === 'stir' ? 'stir' : id === 'centre' ? 'centre' : id === 'check' ? 'check'
        : id === 'arm' ? (st.phase === 'off' ? 'armOff' : 'armOn')
            : st.phase === 'push' ? 'push' : id === 'throttle' ? 'throttleDown' : 'release';
    out.fn = st.prompt;
    out.hint = st.hint ? st.hint.key : null;
    out.ok = st.ok;
    out.flick = false;
    out.paced = false;
    out.stage = null;
    out.can.cont = st.can.cont;
    out.can.useCurrent = st.can.useCurrent;
    out.can.pick = st.can.pick;
    out.can.skipArm = st.can.skipArm;
    out.can.fly = st.can.fly;
    return out;
}

/** The frozen v2 through the same person model (its escape buttons: Continue, Use current, Pick, Skip). */
export function v2Adapter(): Adapter<V2Wizard> {
    const ins = emptyInstruction();
    let lastId = '';
    let lastPhase: string | null = null;
    let where = '';
    return {
        read: (w) => v2InstructionOf(w.state, ins),
        act: (w, a) => v2Act(w, a),
        profile: (w) => (w.state.id === 'check' ? w.state.profile : null),
        where: (w) => {
            const st = w.state;
            if (st.id !== lastId || st.phase !== lastPhase) { lastId = st.id; lastPhase = st.phase; where = st.phase ? `${st.id}/${st.phase}` : st.id; }
            return where;
        }
    };
}

export function v2Act(w: V2Wizard, a: UiAction): void {
    switch (a.kind) {
        case 'cont': w.cont(); break;
        case 'useCurrent': w.useCurrent(); break;
        case 'skipArm': w.skipArm(); break;
        case 'pick': w.pick(a.ch); break;
        case 'reverse': w.reverse(a.what); break;
        case 'back': w.back(); break;
        default: break; // v2 has no Start / Next: its screens end by themselves
    }
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

// ------------------------------------------------------------------ the command invariant (I1)

/** Screen key of wizard v3: `id/stage`, or the id on connect and check. */
export const v3Key = (st: WizardState): string => (st.stage ? `${st.id}/${st.stage}` : st.id);
/** Screen key of the frozen v2: `id/phase`, or the id. */
export const v2Key = (st: V2State): string => (st.phase ? `${st.id}/${st.phase}` : st.id);

/** v3: the only changes a frame may make (connect -> stir/ready, an accepted push, an accepted arm flip). */
export function v3FrameChange(from: string, to: string): boolean {
    if (from === 'connect') return to === 'stir/ready';
    const m = /^(throttle|yaw|pitch|roll|arm)\/active$/.exec(from);
    return !!m && to === `${m[1]}/done`;
}
/** The same rule for v2: its first frame opens the stir; any other change needs a button. */
export function v2FrameChange(from: string, to: string): boolean {
    return from === 'connect' && to === 'stir';
}

/**
 * Records every screen change and whether a command (a button) caused it. A change seen after a
 * frame or a tick that is not an allowed frame change breaks I1; so does a change in a command
 * that did not count as accepted (v3's `cmds`).
 */
export class Watch {
    readonly changes: { from: string; to: string; t: number; cause: 'frame' | 'cmd' }[] = [];
    readonly violations: string[] = [];
    private key = '';
    private cmds = 0;
    constructor(private readonly allowed: (from: string, to: string) => boolean) {}

    observe(key: string, cause: 'frame' | 'cmd', t: number, cmds = -1): void {
        const from = this.key;
        if (key !== from) {
            this.key = key;
            if (from !== '') {
                this.changes.push({ from, to: key, t, cause });
                if (cause === 'frame' && !this.allowed(from, key)) this.violations.push(`${from} -> ${key} at ${(t / 1000).toFixed(2)} s without a button`);
                if (cause === 'cmd' && cmds >= 0 && cmds === this.cmds) this.violations.push(`${from} -> ${key} at ${(t / 1000).toFixed(2)} s in a command that was not accepted`);
            }
        }
        if (cause === 'frame' && cmds >= 0 && cmds !== this.cmds && from !== '') this.violations.push(`cmds changed without a command at ${(t / 1000).toFixed(2)} s`);
        if (cmds >= 0) this.cmds = cmds;
    }
}

export function v3Observer(watch: Watch): Observer<CalibrationWizard> {
    return (w, cause, t) => watch.observe(v3Key(w.state), cause, t, w.state.cmds);
}

export function runNew(cfg: HumanConfig, maxMs = 180000, watch?: Watch): Outcome {
    return runHuman(() => new CalibrationWizard('hid:test', 'test'), newWizardAdapter(), cfg, maxMs, watch ? v3Observer(watch) : undefined);
}

export function runV2(cfg: HumanConfig, maxMs = 180000, watch?: Watch): Outcome {
    return runHuman(() => new V2Wizard('hid:test', 'test'), v2Adapter(), cfg, maxMs, watch ? (w, cause, t) => watch.observe(v2Key(w.state), cause, t) : undefined);
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

/** A slow person: grid person i whose every reaction to a screen and every press takes 3..15 s. */
export function slowHuman(i: number): HumanConfig {
    const cfg = gridHuman(i, 250);
    cfg.slow = { lo: 3000, hi: 15000 };
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

/** CI fuzz person i (0-based, 768 of them): seed 1001 + i, every order x inversion set twice. */
export function fuzzHuman(i: number): HumanConfig {
    return randomHuman(1001 + i, allOrders()[i % 24], invSet(Math.floor(i / 24) % 16));
}
export const FUZZ_N = 768;

// ------------------------------------------------------------------ rigs

/**
 * A wizard fed frame by frame. A simulated person drives it; `manual` takes over the channels
 * (the person keeps reading the screen but their hands are ignored) so a test can script a case.
 * `clicks: false` drops every press of the person (their hands still follow the screens). Every
 * screen change is recorded by `watch` (I1).
 */
export class Rig {
    readonly wz = new CalibrationWizard('hid:test', 'test');
    readonly human: Human;
    readonly ad = newWizardAdapter();
    readonly dt: number;
    readonly watch = new Watch(v3FrameChange);
    t = 0;
    ch = new Float64Array(8);
    buttons = 0;
    manual: ((t: number, ch: Float64Array) => number | void) | null = null;
    clicks = true;
    flew = false;
    readonly sparse: boolean; // like a pad whose Gamepad.timestamp stays frozen at rest: a frame only when something changed
    skipped = 0; // frames not sent because nothing changed (sparse)
    each: ((rig: Rig) => void) | null = null; // runs every frame after the frame (a Presser, a probe)
    private frame: RawFrame = { t: 0, axes: new Float32Array(8), buttons: 0 };
    private sent = new Float32Array(8).fill(NaN);
    private sentButtons = -1;
    private nextTick = 250;

    constructor(cfg: HumanConfig, opts: { sparse?: boolean } = {}) {
        this.human = new Human(cfg);
        this.dt = 1000 / cfg.rateHz;
        this.sparse = !!opts.sparse;
        // while a test script has the channels, the person's clicks are ignored too
        this.human.onAct = (a) => { if (this.manual || !this.clicks) return; if (a.kind === 'fly') this.flew = true; else this.press(a); };
        this.wz.start(0);
        this.observe('frame');
    }

    get st(): WizardState { return this.wz.state; }

    /** Press a button of the screen (as the UI does), recorded by the watch. */
    press(a: UiAction): Verdict {
        const v = act(this.wz, a, this.t);
        this.observe('cmd');
        return v;
    }

    private observe(cause: 'frame' | 'cmd'): void {
        this.watch.observe(v3Key(this.wz.state), cause, this.t, this.wz.state.cmds);
    }

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
        this.observe('frame');
        if (t >= this.nextTick) { this.wz.tick(t); this.nextTick += 250; this.observe('frame'); }
        this.each?.(this);
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

    /** Until the screen (id, stage) is showing. */
    to(id: string, stage: string | null = null, maxMs = 60000): boolean {
        return this.until((s) => s.id === id && s.stage === stage, maxMs);
    }

    /** Take over with fixed channel values (sticks centred, throttle down, arm off unless given). */
    hold(values: Partial<Record<number, number>> = {}, buttons = 0): void {
        const v = [0, 0, -1, 0, -1, 0, 0, 0];
        for (const [k, x] of Object.entries(values)) v[Number(k)] = x as number;
        this.manual = (_t, ch) => { for (let i = 0; i < 8; i++) ch[i] = v[i]; return buttons; };
    }
}

/** The frozen v2 fed frame by frame, the same way (for the negative controls). */
export class V2Rig {
    readonly wz = new V2Wizard('hid:test', 'test');
    readonly human: Human;
    readonly ad = v2Adapter();
    readonly dt: number;
    readonly watch = new Watch(v2FrameChange);
    t = 0;
    ch = new Float64Array(8);
    buttons = 0;
    manual: ((t: number, ch: Float64Array) => number | void) | null = null;
    each: ((rig: V2Rig) => void) | null = null;
    private frame: RawFrame = { t: 0, axes: new Float32Array(8), buttons: 0 };
    private nextTick = 250;

    constructor(cfg: HumanConfig) {
        this.human = new Human(cfg);
        this.dt = 1000 / cfg.rateHz;
        this.human.onAct = (a) => { if (this.manual) return; if (a.kind !== 'fly') this.press(a); };
        this.wz.start(0);
        this.watch.observe(v2Key(this.wz.state), 'frame', 0);
    }

    get st(): V2State { return this.wz.state; }

    press(a: UiAction): void {
        v2Act(this.wz, a);
        this.watch.observe(v2Key(this.wz.state), 'cmd', this.t);
    }

    step(): void {
        const t = this.t;
        this.human.see(this.ad.read(this.wz), t);
        this.human.update(t, this.dt);
        const b = this.human.channels(this.ch);
        if (this.manual) { const mb = this.manual(t, this.ch); this.buttons = typeof mb === 'number' ? mb : this.buttons; }
        else this.buttons = b;
        for (let i = 0; i < 8; i++) this.frame.axes[i] = quantize11(this.ch[i]);
        this.frame.buttons = this.buttons;
        this.frame.t = t;
        this.wz.feed(this.frame);
        this.watch.observe(v2Key(this.wz.state), 'frame', t);
        if (t >= this.nextTick) { this.wz.tick(t); this.nextTick += 250; this.watch.observe(v2Key(this.wz.state), 'frame', t); }
        this.each?.(this);
        this.t += this.dt;
    }

    until(pred: (st: V2State) => boolean, maxMs = 60000): boolean {
        const end = this.t + maxMs;
        while (this.t < end) { this.step(); if (pred(this.wz.state)) return true; }
        return false;
    }

    for(ms: number): void {
        const end = this.t + ms;
        while (this.t < end) this.step();
    }

    hold(values: Partial<Record<number, number>> = {}, buttons = 0): void {
        const v = [0, 0, -1, 0, -1, 0, 0, 0];
        for (const [k, x] of Object.entries(values)) v[Number(k)] = x as number;
        this.manual = (_t, ch) => { for (let i = 0; i < 8; i++) ch[i] = v[i]; return buttons; };
    }
}

/**
 * Someone who presses buttons without moving the sticks: every U(1000, 3000) ms the first enabled
 * of Start, Next / Done / Measure, Measure anyway, Pick (the first free channel), Skip. Never Back
 * or Start again (they would only loop). For v2: its escapes (Continue, Use current, Pick, Skip).
 */
export class Presser {
    readonly pressed: string[] = [];
    private r: () => number;
    private at: number;
    constructor(seed: number, t0: number) {
        this.r = mulberry32(seed * 31 + 7);
        this.at = t0 + this.gap();
    }
    private gap(): number { return 1000 + 2000 * this.r(); }

    step(rig: Rig): void {
        if (rig.t < this.at) return;
        this.at = rig.t + this.gap();
        const c = rig.st.can;
        let a: UiAction | null = null;
        if (c.begin) a = { kind: 'begin' };
        else if (c.next) a = { kind: 'next' };
        else if (c.measureAnyway) a = { kind: 'measureAnyway' };
        else if (c.pick) { const f = rig.wz.freeChannels(); if (f.length) a = { kind: 'pick', ch: f[0] }; }
        else if (c.skipArm) a = { kind: 'skipArm' };
        if (!a) return;
        this.pressed.push(a.kind);
        rig.press(a);
    }

    stepV2(rig: V2Rig): void {
        if (rig.t < this.at) return;
        this.at = rig.t + this.gap();
        const c = rig.st.can;
        let a: UiAction | null = null;
        if (c.cont) a = { kind: 'cont' };
        else if (c.useCurrent) a = { kind: 'useCurrent' };
        else if (c.pick) { const f = rig.wz.freeChannels(); if (f.length) a = { kind: 'pick', ch: f[0] }; }
        else if (c.skipArm) a = { kind: 'skipArm' };
        if (!a) return;
        this.pressed.push(a.kind);
        rig.press(a);
    }
}
