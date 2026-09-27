// Simulated people for the calibration wizard (DOM-free, deterministic). A person holds a radio
// (or a gamepad), reads each screen after a reaction time, stirs, lets go, pushes and flips
// switches, and makes the mistakes people make: still stirring when the text changes, a thumb left
// on a stick, the throttle already up, a slip onto the other axis of the same gimbal, weights below
// 100 %, a model with no switch on any channel, Next pressed before the stick is back. On the
// user-paced wizard (v3) they press the buttons (Start, Done, Measure, Next) after a think time
// and press again when a press is refused. When stuck, they read the hint and press the escape
// buttons. The distributions are guesses from the wizard diag and the UX research, NOT
// measurements of real people. Used by packages/input/test and by ?simradio=raw&human=<seed>.

import { armOn, mapFrame, FNS } from '../calib';
import type { CalibrationWizard, Fn, Profile, RawFrame, Stage, Verdict, WizardState } from '../calib';
import { mulberry32 } from './signals';

export type Stick = 'A' | 'E' | 'T' | 'R';
export type ArmKind = 'ch5-2pos' | 'ch5-3pos' | 'ch6-2pos' | 'button' | 'momentary' | 'none';
export type AuxKind = 'zero' | 'const' | 'switch' | 'pot' | 'potNearBin';

export interface HumanConfig {
    seed: number;
    order: string; // function letter on CH1..CH4, any of the 24 permutations of AETR
    inv: Record<Stick, boolean>;
    trim: Record<'A' | 'E' | 'R', number>; // channel-level centre offset
    noise: number; // stick noise sd, fraction of half travel
    rateHz: number;
    gamepadLike: boolean; // 5 float axes, springing throttle, momentary arm button
    arm: ArmKind;
    aux: AuxKind[]; // CH6..CH8 (a gamepad: all zero)
    auxValue: number[]; // resting value per aux entry; index 3 = a gamepad's fifth axis (CH5)
    auxNoise: number[]; // sd for pots
    rtMean: number; // ms; 0 = the ideal person (no reaction floor)
    stirReach: number;
    stopsStirAfterMs: number | null;
    /** the wizard paces itself (auto): the person does not look for Done, they stop stirring when
     *  the bars are green and let go, as the screen says */
    auto?: boolean;
    flickInStir: boolean;
    leaveArmOn: boolean;
    rangeLimit: number; // channel output reaches only this share of the travel (radio weights)
    lowerThrottleInCentre: boolean;
    thumbRest: number; // 0 or the deflection a resting thumb keeps on one stick during "let go"
    throttleUpReaction: 'downFirst' | 'wait';
    residual: number; // a self-centring gimbal comes back within this
    cross: number; // cross-coupling onto the other axis of the same gimbal
    patienceMs: number;
    slipProb: number;
    ideal: boolean; // the Node twin of the SimRadio robot: fast, exact, no mistakes
    // user-paced wizard (v3): drawn after every other trait, so the people keep them
    thinkLo: number; // ms before a press, drawn per press in [thinkLo, thinkHi]
    thinkHi: number;
    nextEarly: boolean; // sometimes presses Next before the stick is back, reads the refusal, fixes it
    armPrepSkip: boolean; // leaves the arm switch ON on "put it OFF, then Start"
    slow: { lo: number; hi: number } | null; // every reaction and every press waits U(lo, hi)
}

export const STICKS: Stick[] = ['A', 'E', 'T', 'R'];
const SI: Record<Stick, number> = { A: 0, E: 1, T: 2, R: 3 };
const PARTNER = [1, 0, 3, 2]; // A<->E and T<->R share a gimbal
const LETTER_OF: Record<Fn, Stick> = { roll: 'A', pitch: 'E', throttle: 'T', yaw: 'R' };
const TWO_PI = 2 * Math.PI;

export function randomHuman(seed: number, order: string, inv: Record<Stick, boolean>): HumanConfig {
    const r = mulberry32(seed * 7919 + 17);
    const U = (a: number, b: number) => a + (b - a) * r();
    const gamepadLike = r() < 0.08;
    const rateHz = gamepadLike ? (r() < 0.5 ? 125 : 250) : [250, 500, 500, 1000][Math.floor(r() * 4)];
    let arm: ArmKind = 'momentary';
    if (!gamepadLike) {
        const a = r();
        arm = a < 0.45 ? 'ch5-2pos' : a < 0.55 ? 'ch5-3pos' : a < 0.62 ? 'ch6-2pos' : a < 0.70 ? 'button' : 'none';
    }
    const aux: AuxKind[] = [];
    const auxValue: number[] = [];
    const auxNoise: number[] = [];
    for (let k = 0; k < 3; k++) {
        const q = r();
        const kind: AuxKind = gamepadLike ? 'zero' : q < 0.45 ? 'zero' : q < 0.6 ? 'const' : q < 0.75 ? 'switch' : q < 0.9 ? 'pot' : 'potNearBin';
        aux.push(kind);
        auxValue.push(kind === 'const' || kind === 'switch' ? (r() < 0.5 ? -1 : 1) : kind === 'pot' ? U(-0.95, 0.95) : kind === 'potNearBin' ? (Math.floor(U(-4, 4)) * 0.25 + 0.125) : 0);
        auxNoise.push(kind === 'pot' || kind === 'potNearBin' ? U(0.003, 0.01) : 0);
    }
    auxValue.push(U(-0.95, 0.95)); // a gamepad's fifth axis (slider / trigger at rest)
    auxNoise.push(gamepadLike ? U(0.003, 0.01) : 0);
    const flickInStir = r() < 0.3;
    const cfg: HumanConfig = {
        seed, order, inv,
        trim: { A: U(-0.03, 0.03), E: U(-0.03, 0.03), R: U(-0.03, 0.03) },
        noise: U(0.002, 0.01),
        rateHz, gamepadLike, arm, aux, auxValue, auxNoise,
        rtMean: U(300, 1500),
        stirReach: U(0.85, 1.15),
        stopsStirAfterMs: r() < 0.35 ? U(4000, 9000) : null,
        flickInStir,
        leaveArmOn: flickInStir && r() < 0.5,
        rangeLimit: r() < 0.03 ? U(0.7, 0.85) : 1,
        lowerThrottleInCentre: r() < 0.85,
        thumbRest: r() < 0.1 ? U(0.05, 0.15) : 0,
        throttleUpReaction: r() < 0.5 ? 'downFirst' : 'wait',
        residual: U(0, 0.03),
        cross: U(0, 0.12),
        patienceMs: U(2000, 6000),
        slipProb: 0.05,
        ideal: false,
        thinkLo: 0, thinkHi: 0, nextEarly: false, armPrepSkip: false, slow: null
    };
    // drawn after every trait above: the grid people keep all of them
    cfg.thinkLo = U(300, 900);
    cfg.thinkHi = cfg.thinkLo + U(400, 2000);
    cfg.nextEarly = r() < 0.2;
    cfg.armPrepSkip = cfg.leaveArmOn && r() < 0.3;
    return cfg;
}

export function idealHuman(order: string, inv: Record<Stick, boolean>): HumanConfig {
    return {
        seed: 1, order, inv, trim: { A: 0, E: 0, R: 0 }, noise: 0.002, rateHz: 500, gamepadLike: false,
        arm: 'ch5-2pos', aux: ['zero', 'zero', 'zero'], auxValue: [0, 0, 0, 0], auxNoise: [0, 0, 0, 0],
        rtMean: 0, stirReach: 1.1, stopsStirAfterMs: null, flickInStir: false, leaveArmOn: false, rangeLimit: 1,
        lowerThrottleInCentre: true, thumbRest: 0, throttleUpReaction: 'downFirst', residual: 0, cross: 0,
        patienceMs: Infinity, slipProb: 0, ideal: true,
        thinkLo: 0, thinkHi: 0, nextEarly: false, armPrepSkip: false, slow: null
    };
}

// ------------------------------------------------------------------ what the person sees

export type InstrKind = 'connect' | 'stir' | 'centre' | 'push' | 'release' | 'throttleDown' | 'armOn' | 'armOff' | 'armFlick' | 'arm' | 'check' | 'idle';
export interface InstrCan {
    cont: boolean; useCurrent: boolean; pick: boolean; skipArm: boolean; fly: boolean;
    begin: boolean; next: boolean; measureAnyway: boolean; reverse: boolean;
}
export interface Instruction {
    kind: InstrKind;
    fn: Fn | null;
    hint: string | null;
    ok: boolean;
    flick?: boolean; // the first wizard asked to flick every switch while stirring
    paced: boolean; // the user-paced wizard (v3): the person presses Start / Next
    stage: Stage | null;
    can: InstrCan;
    // what the screen shows live (not part of "the screen changed")
    thr: number; // the throttle bar 0..1, NaN before the throttle is set
    armLive: boolean | null;
    armPhase: 'on' | 'off' | null; // v3 arm/active: 'off' = ON counted, the screen says "now flip it back OFF"
}
/** The buttons of the wizard screen, as the page and the simulated people press them. */
export type UiAction =
    | { kind: 'begin' | 'next' | 'skipArm' | 'measureAnyway' | 'fly' | 'back' }
    | { kind: 'pick'; ch: number }
    | { kind: 'reverse' | 'redo'; what: Fn | 'arm' }
    | { kind: 'cont' | 'useCurrent' }; // only for the frozen v2 fixture's adapter
export interface Adapter<W> {
    read(w: W): Instruction;
    act(w: W, a: UiAction): void;
    profile(w: W): Profile | null;
    where(w: W): string;
}

const DONE: Verdict = { ok: true };
const NOPE: Verdict = { ok: false, hint: { key: 'wizard.hint.disabled', params: {} } };

/** One dispatcher for the page's simulated radio and the Node harness: every UI action goes through the wizard's commands. */
export function act(w: CalibrationWizard, a: UiAction, t?: number): Verdict {
    switch (a.kind) {
        case 'begin': return w.begin(t);
        case 'next': return w.next(t);
        case 'skipArm': return w.skipArm(t);
        case 'measureAnyway': return w.measureAnyway(t);
        case 'pick': return w.pick(a.ch, t);
        case 'reverse': w.reverse(a.what); return DONE;
        case 'redo': return w.redo(a.what, t);
        case 'back': return w.back() ? DONE : NOPE;
        default: return NOPE; // fly: the UI saves the profile; cont / useCurrent: v2 only
    }
}

export function emptyInstruction(): Instruction {
    return {
        kind: 'idle', fn: null, hint: null, ok: false, paced: false, stage: null,
        can: { cont: false, useCurrent: false, pick: false, skipArm: false, fly: false, begin: false, next: false, measureAnyway: false, reverse: false },
        thr: NaN, armLive: null, armPhase: null
    };
}

/** What a person reads from the wizard's state (the screen), written into `out`. */
export function instructionOf(st: WizardState, out: Instruction = emptyInstruction()): Instruction {
    const id = st.id;
    out.kind = id === 'connect' ? 'connect' : id === 'stir' ? 'stir' : id === 'centre' ? 'centre' : id === 'check' ? 'check' : id === 'arm' ? 'arm' : 'push';
    out.fn = st.prompt;
    out.hint = st.hint ? st.hint.key : null;
    out.ok = false;
    out.flick = false;
    out.paced = true;
    out.stage = st.stage;
    const c = out.can, s = st.can;
    c.cont = false; c.useCurrent = false;
    c.pick = s.pick; c.skipArm = s.skipArm; c.fly = s.fly; c.begin = s.begin; c.next = s.next; c.measureAnyway = s.measureAnyway; c.reverse = s.reverse;
    out.thr = Number.isNaN(st.mapped.throttle) ? NaN : (st.mapped.throttle + 1) / 2;
    out.armLive = st.mapped.arm;
    out.armPhase = st.armFlip ? st.armFlip.phase : null;
    return out;
}

export function newWizardAdapter(): Adapter<CalibrationWizard> {
    const ins = emptyInstruction();
    let lastId = '';
    let lastStage: string | null = null;
    let where = '';
    return {
        read: (w) => instructionOf(w.state, ins),
        act: (w, a) => { act(w, a); },
        profile: (w) => (w.state.id === 'check' ? w.state.profile : null),
        where: (w) => {
            const st = w.state;
            if (st.id !== lastId || st.stage !== lastStage) { lastId = st.id; lastStage = st.stage; where = st.stage ? `${st.id}/${st.stage}` : st.id; }
            return where;
        }
    };
}

function sameIns(a: Instruction, b: Instruction): boolean {
    return a.kind === b.kind && a.fn === b.fn && a.hint === b.hint && a.ok === b.ok && !!a.flick === !!b.flick && a.stage === b.stage
        && a.can.cont === b.can.cont && a.can.useCurrent === b.can.useCurrent && a.can.pick === b.can.pick
        && a.can.skipArm === b.can.skipArm && a.can.fly === b.can.fly && a.can.begin === b.can.begin
        && a.can.next === b.can.next && a.can.measureAnyway === b.can.measureAnyway && a.armPhase === b.armPhase;
}

function copyIns(a: Instruction): Instruction {
    return { kind: a.kind, fn: a.fn, hint: a.hint, ok: a.ok, flick: !!a.flick, paced: a.paced, stage: a.stage, can: { ...a.can }, thr: a.thr, armLive: a.armLive, armPhase: a.armPhase };
}

function screenOf(a: Instruction): string {
    return `${a.kind}|${a.fn}|${a.stage}`;
}

// ------------------------------------------------------------------ the body

class Axis {
    p = 0;
    v = 0;
    target = 0;
    w = TWO_PI * 4;
    z = 0.8;
    held = false;
    constructor(public centring: boolean) {}
    step(dt: number): void {
        const a = this.w * this.w * (this.target - this.p) - 2 * this.z * this.w * this.v;
        this.v += a * dt;
        this.p += this.v * dt;
        if (this.p > 1) { this.p = 1; if (this.v > 0) this.v = 0; }
        if (this.p < -1) { this.p = -1; if (this.v < 0) this.v = 0; }
    }
}

type Sub = 'slip' | 'push' | 'hold' | 'retry' | 'down' | 'dwell' | 'wait' | 'done';
type CanKey = keyof InstrCan;

export class Human {
    readonly c: HumanConfig;
    readonly ax: Axis[];
    arm = false; // physical arm switch (or latching button) position
    btn = false; // momentary button pressed
    onAct: ((a: UiAction) => void) | null = null;
    readonly hints: string[] = [];
    readonly escapes: string[] = [];
    readonly problems: string[] = [];
    private r: () => number;
    private arm3pass = 0;
    private auxV: number[];
    private auxBackAt: number[] = [Infinity, Infinity, Infinity];
    private auxBackTo: number[] = [0, 0, 0];
    private readonly chStick: number[];
    private readonly chInv: boolean[];
    private readonly chTrim: number[];
    // reading
    private last: Instruction | null = null;
    private pending: { ins: Instruction; at: number } | null = null;
    private cur: Instruction | null = null;
    private liveThr = NaN;
    private liveArm: boolean | null = null;
    // a UI click planned for later, only done if the screen still offers it
    private actKind: UiAction | null = null;
    private actAt = Infinity;
    private actNeed: CanKey | null = null;
    private actScreen = '';
    // v3: after a press, look again; still the same screen = refused: fix what the hint says, press again
    private retryAt = Infinity;
    private retryScreen = '';
    private retryAct: UiAction | null = null;
    private retryNeed: CanKey | null = null;
    private refusedHere = 0; // presses refused on this screen
    // switch / button script: flips at given times
    private swQ: { at: number; on: boolean }[] = [];
    private swBtn = false; // the script drives the momentary button, not the switch
    private flickRepeat = false;
    private flipT = -Infinity; // time of the last physical arm flip
    private armLearned = false; // told "was the switch ON?": puts it OFF from now on
    private offAfterQ = false; // v3 arm: "now flip it back OFF" read while a flip was still under way
    // stir
    private stirOn = false;
    private stopAt = Infinity;
    private reach = 1;
    private wL = 0;
    private wR = 0;
    private phiL = 0;
    private phiR = 0;
    private flickAt = Infinity;
    private flickEnd = Infinity;
    private inFlick = false;
    private auxFlicked = false;
    private contPlanned = false;
    // centre
    private lowering = false;
    private thumbK = -1;
    private thumbUntil = Infinity;
    // push
    private pk = -1;
    private po = -1;
    private sub: Sub = 'done';
    private subT = 0;
    private reachP = 1;
    private crossP = 0;
    private reachedAt = 0;
    // throttle down
    private thrDown = false;

    constructor(c: HumanConfig) {
        this.c = c;
        this.r = mulberry32(c.seed * 104729 + 3);
        this.ax = [new Axis(true), new Axis(true), new Axis(c.gamepadLike), new Axis(true)];
        this.ax[2].p = c.gamepadLike ? 0 : -1;
        this.ax[2].target = this.ax[2].p;
        this.auxV = c.auxValue.slice(0, 3);
        this.chStick = [];
        this.chInv = [];
        this.chTrim = [];
        for (let ch = 0; ch < 4; ch++) {
            const l = c.order[ch] as Stick;
            this.chStick.push(SI[l]);
            this.chInv.push(c.inv[l]);
            this.chTrim.push(l === 'T' ? 0 : c.trim[l]);
        }
    }

    private U(a: number, b: number): number { return a + (b - a) * this.r(); }
    private rt(): number {
        const s = this.c.slow;
        if (s) return this.U(s.lo, s.hi);
        return this.c.ideal ? 0 : Math.max(250, this.c.rtMean * this.U(0.8, 1.2));
    }
    /** Time before a press on the paced wizard. */
    private think(): number {
        const s = this.c.slow;
        if (s) return this.U(s.lo, s.hi);
        return this.c.ideal ? 0 : this.U(this.c.thinkLo, this.c.thinkHi);
    }
    /** Unit-variance noise: sum of four uniforms (close enough to normal, and cheap per report). */
    private gauss(): number {
        const r = this.r;
        return (r() + r() + r() + r() - 2) * 1.7320508075688772;
    }

    // ---------------------------------------------------------------- hands

    private hold(k: number, target: number, fHz = 3.5, zeta = 0.75): void {
        const a = this.ax[k];
        a.held = true;
        a.target = target;
        a.w = TWO_PI * (this.c.ideal ? 12 : fHz);
        a.z = this.c.ideal ? 1 : zeta;
    }

    /** Let go: a self-centring gimbal springs back (not exactly), the radio throttle stays. */
    private release(k: number): void {
        const a = this.ax[k];
        a.held = false;
        if (!a.centring) { a.target = a.p; a.w = TWO_PI * 6; a.z = 1; return; }
        if (this.c.ideal) { a.target = 0; a.w = TWO_PI * 12; a.z = 1; return; }
        const snap = this.r() < 0.5;
        a.target = (this.r() < 0.5 ? -1 : 1) * this.U(0, this.c.residual);
        a.w = TWO_PI * (snap ? this.U(6, 10) : this.U(2.5, 4));
        a.z = snap ? this.U(0.2, 0.4) : this.U(0.7, 1.0);
    }

    private releaseCentring(): void {
        for (let k = 0; k < 4; k++) if (this.ax[k].centring) this.release(k);
    }

    private releaseAll(): void {
        for (let k = 0; k < 4; k++) this.release(k);
    }

    /** Throttle all the way down (a radio throttle stays there once let go; a gamepad's springs back). */
    private lowerThrottle(): void {
        if (this.c.gamepadLike) { this.release(2); return; }
        if (this.ax[2].p < -0.97 && !this.ax[2].held) return;
        this.hold(2, -1.05, this.U(2, 3.5), 0.9);
        this.lowering = true;
    }

    private thumbOff(): void {
        if (this.thumbK >= 0) this.release(this.thumbK);
        this.thumbK = -1;
        this.thumbUntil = Infinity;
    }

    private flipArm(on: boolean, t = 0): void {
        if (this.arm === on) return;
        this.arm = on;
        this.flipT = t;
        if (this.c.arm === 'ch5-3pos') this.arm3pass = this.U(30, 60); // passes the middle position
    }

    private isSwitch(): boolean {
        return this.c.arm !== 'momentary' && this.c.arm !== 'none';
    }

    /** Plan switch flips (or momentary taps) from time t. */
    private planSwitch(t: number, want: 'on' | 'off' | 'redoOn' | 'taps'): void {
        const q: { at: number; on: boolean }[] = [];
        if (this.c.arm === 'momentary' || want === 'taps') {
            this.swBtn = true;
            let at = t;
            for (let i = 0; i < 2; i++) {
                q.push({ at, on: true });
                at += this.U(80, 250);
                q.push({ at, on: false });
                at += this.U(200, 600);
            }
        } else {
            this.swBtn = false;
            if (want === 'off') q.push({ at: t, on: false });
            else if (this.arm || want === 'redoOn') { q.push({ at: t, on: false }); q.push({ at: t + this.U(150, 500), on: true }); }
            else q.push({ at: t, on: true });
        }
        this.swQ = q;
    }

    private runSwitch(t: number): void {
        while (this.swQ.length > 0 && this.swQ[0].at <= t) {
            const s = this.swQ.shift()!;
            if (this.swBtn) this.btn = s.on; else this.flipArm(s.on, t);
        }
    }

    // ---------------------------------------------------------------- eyes

    /** The screen as it is now; a change is acted on after a reaction time. */
    see(ins: Instruction, t: number): void {
        this.liveThr = ins.thr;
        this.liveArm = ins.armLive;
        const l = this.last;
        if (l && sameIns(l, ins)) return;
        const okOnly = l !== null && l.kind === ins.kind && l.fn === ins.fn && !l.ok && ins.ok;
        const copy = copyIns(ins);
        this.last = copy;
        if (ins.hint && (!l || l.hint !== ins.hint)) this.hints.push(ins.hint);
        if (ins.kind === 'check' && ins.hint === 'wizard.hint.check.throttle' && !this.problems.includes('check.throttle hint')) this.problems.push('check.throttle hint');
        const delay = this.c.ideal ? 0 : okOnly ? this.U(200, 400) : this.rt();
        if (!this.pending) this.pending = { ins: copy, at: t + delay };
        else {
            this.pending.ins = copy;
            const floor = this.c.ideal ? 0 : this.c.slow ? this.c.slow.lo : 250;
            if (this.pending.at < t + floor) this.pending.at = t + floor;
        }
    }

    private plan(t: number, a: UiAction, need: CanKey | null, delay: number): void {
        this.actKind = a;
        this.actAt = t + delay;
        this.actNeed = need;
        this.actScreen = this.cur ? screenOf(this.cur) : '';
    }

    /** v3: press this button after a think time (and again if it is refused). */
    private planPress(t: number, a: UiAction, need: CanKey, delay = this.think()): void {
        this.plan(t, a, need, delay);
    }

    private press(a: UiAction): void {
        this.escapes.push(a.kind);
        this.onAct?.(a);
    }

    private fire(t: number): void {
        const a = this.actKind!;
        const need = this.actNeed;
        this.actKind = null;
        this.actAt = Infinity;
        const l = this.last;
        if (!l || screenOf(l) !== this.actScreen) return;
        if (need && !l.can[need]) return;
        if (l.paced) this.beforePress(a, l, t);
        this.press(a);
        if (a.kind === 'pick') { this.letGoPush(); this.sub = 'retry'; this.subT = t + this.U(300, 800); }
        if (l.paced && need !== null && need !== 'fly') {
            // look again after a moment: the same screen means the press was refused
            this.retryAt = t + Math.max(this.c.ideal ? 600 : 300, this.think());
            this.retryScreen = this.actScreen;
            this.retryAct = a;
            this.retryNeed = need;
        }
    }

    private adopt(ins: Instruction, t: number): void {
        const prev = this.cur;
        this.cur = ins;
        if (!prev || screenOf(prev) !== screenOf(ins)) {
            this.actKind = null;
            this.actAt = Infinity;
            this.retryAt = Infinity;
            this.refusedHere = 0;
            if (ins.paced) this.startPaced(ins, t); else this.start(ins, t);
        } else if (ins.paced) this.changePaced(prev, ins, t);
        else this.change(prev, ins, t);
    }

    // ---------------------------------------------------------------- what to do on each screen (v2, first wizard)

    private start(ins: Instruction, t: number): void {
        this.thrDown = false;
        this.lowering = false;
        if (ins.kind !== 'stir') this.stirOn = false;
        if (ins.kind !== 'armFlick') this.flickRepeat = false;
        switch (ins.kind) {
            case 'stir': this.startStir(ins, t); break;
            case 'centre': this.startCentre(t); break;
            case 'push': this.startPush(ins.fn!, t); break;
            case 'release': this.releaseCentring(); break;
            case 'throttleDown':
                this.releaseCentring();
                this.hold(2, -1.05, this.U(2, 3.5), 0.9);
                this.thrDown = true;
                break;
            case 'armOn':
                this.releaseCentring();
                if (this.c.gamepadLike) this.release(2);
                if (this.c.arm !== 'none') this.planSwitch(t, 'on');
                break;
            case 'armOff':
                if (this.c.arm !== 'momentary' && this.c.arm !== 'none') this.planSwitch(t, 'off');
                break;
            case 'armFlick': this.flickRepeat = true; this.planFlicks(t); break;
            case 'check': this.plan(t, { kind: 'fly' }, 'fly', this.U(500, 2000)); break;
            default: break;
        }
        this.change(null, ins, t);
    }

    /** Same screen, something on it changed: a hint, the check mark, a button appeared. */
    private change(prev: Instruction | null, ins: Instruction, t: number): void {
        const newHint = ins.hint !== null && (!prev || prev.hint !== ins.hint);
        const gained = (k: CanKey) => ins.can[k] && (!prev || !prev.can[k]);
        switch (ins.kind) {
            case 'stir':
                if (newHint && (ins.hint === 'wizard.hint.stir.coverage' || ins.hint === 'wizard.hint.stir.few' || ins.hint === 'wizard.needFourAxes')) {
                    this.stirOn = true; this.stopAt = Infinity; this.reach = 1.1;
                }
                if (ins.can.cont && !this.contPlanned) { this.contPlanned = true; this.plan(t, { kind: 'cont' }, 'cont', this.U(2000, 5000)); }
                break;
            case 'centre':
                if (newHint && ins.hint === 'wizard.hint.centre.moving') { this.releaseCentring(); this.thumbUntil = Infinity; this.stirOn = false; }
                if (gained('useCurrent')) this.plan(t, { kind: 'useCurrent' }, 'useCurrent', this.U(1000, 3000));
                break;
            case 'push': {
                if (ins.ok && (!prev || !prev.ok)) { this.letGoPush(); this.sub = 'done'; break; }
                if (newHint) this.pushHintReaction(ins.hint, t);
                if (gained('pick')) this.plan(t, { kind: 'pick', ch: this.c.order.indexOf(LETTER_OF[ins.fn!]) }, 'pick', 3000);
                break;
            }
            case 'release':
                if (newHint) this.releaseCentring();
                if (gained('useCurrent')) this.plan(t, { kind: 'useCurrent' }, 'useCurrent', this.U(1000, 3000));
                break;
            case 'throttleDown':
                if (newHint) { this.hold(2, -1.05, 3, 0.9); this.thrDown = true; }
                if (gained('cont')) this.plan(t, { kind: 'cont' }, 'cont', this.U(1000, 3000));
                break;
            case 'armOn':
                if (newHint && (ins.hint === 'wizard.hint.arm.none' || ins.hint === 'wizard.hint.arm.small')) {
                    if (this.c.arm === 'none') this.plan(t, { kind: 'skipArm' }, 'skipArm', this.U(2000, 5000));
                    else this.planSwitch(t, this.c.arm === 'momentary' ? 'taps' : 'redoOn');
                }
                break;
            case 'armOff':
                if (newHint && this.c.arm !== 'momentary' && this.c.arm !== 'none') this.planSwitch(t, 'off');
                if (gained('cont')) this.plan(t, { kind: 'cont' }, 'cont', this.U(1000, 3000));
                break;
            default: break;
        }
    }

    private pushHintReaction(h: string | null, t: number): void {
        if (h === 'wizard.hint.push.none' || h === 'wizard.hint.push.short') { this.reachP = 1.0; if (this.sub !== 'down' && this.sub !== 'dwell') this.pushNow(); }
        else if (h === 'wizard.hint.push.two') { this.crossP = 0; this.pushNow(); }
        else if (h === 'wizard.hint.throttle.already' && this.pk === 2) { this.hold(2, -1.05, 3, 0.9); this.sub = 'down'; }
        else if (h === 'wizard.hint.push.taken') { this.letGoPush(); this.releaseCentring(); this.sub = 'retry'; this.subT = t + this.U(300, 800); }
    }

    // ---------------------------------------------------------------- what to do on each screen (v3, user-paced)

    private startPaced(ins: Instruction, t: number): void {
        const c = this.c;
        this.thrDown = false;
        if (ins.kind !== 'stir' || ins.stage !== 'active') this.stirOn = false;
        const stage = ins.stage;
        switch (ins.kind) {
            case 'stir':
                if (stage === 'active') this.startStir(ins, t);
                else { this.releaseCentring(); this.planPress(t, { kind: stage === 'ready' ? 'begin' : 'next' }, stage === 'ready' ? 'begin' : 'next'); }
                break;
            case 'centre':
                if (stage === 'active') this.startCentre(t);
                else this.releaseCentring();
                this.planPress(t, { kind: stage === 'ready' ? 'begin' : 'next' }, stage === 'ready' ? 'begin' : 'next');
                break;
            case 'push': {
                const fn = ins.fn!;
                if (stage === 'active') { this.startPush(fn, t); break; }
                this.letGoPush();
                this.releaseCentring();
                this.thumbOff();
                if (fn === 'throttle') this.lowerThrottle();
                if (stage === 'ready') this.planPress(t, { kind: 'begin' }, 'begin');
                else this.planPress(t, { kind: 'next' }, 'next', c.nextEarly && !c.slow ? 0 : this.think());
                break;
            }
            case 'arm':
                if (stage === 'ready') {
                    this.releaseCentring();
                    if (c.gamepadLike) this.release(2);
                    if (this.isSwitch() && (!c.armPrepSkip || this.armLearned)) this.planSwitch(t, 'off');
                    this.planPress(t, { kind: 'begin' }, 'begin');
                } else if (stage === 'active') {
                    if (c.arm !== 'none') this.planSwitch(t, 'on');
                } else {
                    if (this.isSwitch()) this.planSwitch(t, 'off');
                    this.planPress(t, { kind: 'next' }, 'next');
                }
                break;
            case 'check': this.plan(t, { kind: 'fly' }, 'fly', c.slow ? this.U(c.slow.lo, c.slow.hi) : this.U(500, 2000)); break;
            default: break;
        }
        this.changePaced(null, ins, t);
    }

    private changePaced(prev: Instruction | null, ins: Instruction, t: number): void {
        const newHint = ins.hint !== null && (!prev || prev.hint !== ins.hint);
        const gained = (k: CanKey) => ins.can[k] && (!prev || !prev.can[k]);
        const h = ins.hint;
        switch (ins.kind) {
            case 'stir':
                if (ins.stage !== 'active') break;
                if (newHint && (h === 'wizard.hint.stir.coverage' || h === 'wizard.hint.stir.few' || h === 'wizard.needFourAxes' || h === 'wizard.hint.stir.short')) {
                    this.stirOn = true; this.stopAt = Infinity; this.reach = 1.1;
                }
                if (gained('next')) {
                    if (this.c.auto) { this.stirOn = false; this.releaseAll(); } // green: stop and let go
                    else this.planPress(t, { kind: 'next' }, 'next');
                }
                break;
            case 'push':
                if (ins.stage !== 'active') break;
                if (newHint) {
                    if (h === 'wizard.hint.push.hold' && this.pk === 2 && !this.c.gamepadLike) {
                        // "was the throttle up when you pressed Start?": down, Back, then Start again
                        this.lowerThrottle();
                        this.plan(t, { kind: 'back' }, null, this.think());
                    } else this.pushHintReaction(h, t);
                }
                if (gained('pick')) this.plan(t, { kind: 'pick', ch: this.c.order.indexOf(LETTER_OF[ins.fn!]) }, 'pick', this.c.slow ? this.think() : 3000);
                break;
            case 'arm':
                if (ins.stage !== 'active') break;
                // "now flip it back OFF" (read after the reaction time, like any change of the
                // screen): a flip still under way in the hand is finished first. Already OFF in the
                // hand (it was ON at Start): nothing to flip; the hint says what to do
                if (ins.armPhase === 'off' && (!prev || prev.armPhase !== 'off') && this.isSwitch()) {
                    if (this.swQ.length) this.offAfterQ = true;
                    else if (this.arm) this.planSwitch(t, 'off');
                }
                if (!newHint) break;
                if (h === 'wizard.hint.arm.none' || h === 'wizard.hint.arm.small') {
                    if (this.c.arm === 'none') this.plan(t, { kind: 'skipArm' }, 'skipArm', this.c.slow ? this.think() : this.U(2000, 5000));
                    else this.planSwitch(t, this.c.arm === 'momentary' ? 'taps' : 'redoOn');
                } else if (h === 'wizard.hint.arm.wasOn') {
                    // still ON in the hand while the screen says "back OFF": just flip it OFF
                    if (ins.armPhase === 'off' && this.isSwitch() && this.arm) { this.planSwitch(t, 'off'); break; }
                    // switch OFF, Back, Start, flip ON
                    this.armLearned = true;
                    if (this.isSwitch()) this.planSwitch(t, 'off');
                    this.plan(t, { kind: 'back' }, null, this.think());
                }
                break;
            default: break;
        }
    }

    /** Just before a press: what the screen shows live that the person checks first. */
    private beforePress(a: UiAction, l: Instruction, t: number): void {
        // the arm line reads the opposite of the switch in the hand (and the radio had time to show it)
        const armWrong = this.liveArm !== null && this.isSwitch() && this.liveArm !== this.arm && t - this.flipT >= 300 && this.swQ.length === 0;
        if (armWrong && ((l.kind === 'arm' && l.stage === 'done' && a.kind === 'next') || (l.kind === 'check' && a.kind === 'fly'))) this.press({ kind: 'reverse', what: 'arm' });
    }

    /** A press was refused (the same screen after a moment): do what its hint says, press again. */
    private retry(t: number): void {
        let a = this.retryAct!;
        let need = this.retryNeed!;
        this.retryAt = Infinity;
        const l = this.last;
        if (!l || screenOf(l) !== this.retryScreen || !l.can[need]) return;
        this.refusedHere++;
        // "Measure as it is" once Measure kept failing after it was offered (a stick that never settles)
        if (l.kind === 'centre' && l.can.measureAnyway && this.refusedHere >= 4) { a = { kind: 'measureAnyway' }; need = 'measureAnyway'; }
        switch (l.hint) {
            case 'wizard.hint.begin.held': case 'wizard.hint.centre.ends': case 'wizard.hint.centre.held': case 'wizard.hint.next.held':
                this.letGoPush(); this.releaseCentring(); this.thumbOff();
                break;
            case 'wizard.hint.begin.parked': case 'wizard.hint.centre.parked':
                this.releaseCentring(); this.thumbOff(); this.lowerThrottle();
                break;
            case 'wizard.hint.next.thrDown':
                // the throttle is down in the hand, the bar reads it up: the push was taken the wrong way round
                if (!this.c.gamepadLike && this.ax[2].p < -0.9 && !this.lowering && this.liveThr > 0.5) this.press({ kind: 'reverse', what: 'throttle' });
                else this.lowerThrottle();
                break;
            case 'wizard.hint.next.armOn':
                if (!this.arm && this.swQ.length === 0 && t - this.flipT >= 300 && this.liveArm === true) this.press({ kind: 'reverse', what: 'arm' });
                else if (this.isSwitch() && this.arm) this.planSwitch(t, 'off');
                break;
            default: break; // "still moving": wait a moment
        }
        this.planPress(t, a, need, Math.max(this.c.ideal ? 50 : 200, this.think()));
    }

    private startStir(ins: Instruction, t: number): void {
        const c = this.c;
        this.stirOn = true;
        this.contPlanned = false;
        this.reach = c.stirReach;
        this.stopAt = c.stopsStirAfterMs === null ? Infinity : t + c.stopsStirAfterMs;
        this.wL = TWO_PI * this.U(0.5, 1.2) * (this.r() < 0.5 ? -1 : 1);
        this.wR = TWO_PI * this.U(0.5, 1.2) * (this.r() < 0.5 ? -1 : 1);
        this.phiL = this.r() * TWO_PI;
        this.phiR = this.r() * TWO_PI;
        this.flickAt = Infinity;
        this.flickEnd = Infinity;
        this.inFlick = false;
        this.auxFlicked = false;
        if (c.flickInStir || (ins.flick && !c.ideal)) {
            this.flickAt = t + this.U(500, 3000);
            let n = 1 + Math.floor(this.r() * 4);
            const want = c.leaveArmOn;
            if (((this.arm ? 1 : 0) + n) % 2 !== (want ? 1 : 0)) n++;
            const gap = this.U(250, 600);
            const q: { at: number; on: boolean }[] = [];
            let on = this.arm;
            for (let i = 0; i < n; i++) {
                on = !on;
                if (c.arm === 'momentary') { q.push({ at: this.flickAt + i * gap, on: true }); q.push({ at: this.flickAt + i * gap + 100, on: false }); }
                else q.push({ at: this.flickAt + i * gap, on });
            }
            this.swBtn = c.arm === 'momentary';
            this.swQ = q;
            this.flickEnd = this.flickAt + n * gap + 300;
        }
    }

    private startCentre(t: number): void {
        const c = this.c;
        this.stirOn = false;
        this.releaseCentring();
        if (!c.gamepadLike && c.lowerThrottleInCentre) { this.hold(2, -1.05, this.U(2, 3.5), 0.9); this.lowering = true; }
        else this.release(2);
        this.thumbK = -1;
        this.thumbUntil = Infinity;
        if (c.thumbRest > 0) {
            this.thumbK = [0, 1, 3][Math.floor(this.r() * 3)];
            this.hold(this.thumbK, (this.r() < 0.5 ? -1 : 1) * c.thumbRest, 3, 1.0);
            this.thumbUntil = t + this.U(1000, 4000);
        }
    }

    private startPush(fn: Fn, t: number): void {
        const c = this.c;
        this.releaseCentring();
        this.pk = SI[LETTER_OF[fn]];
        this.po = PARTNER[this.pk];
        this.reachP = c.ideal ? 1.0 : this.U(0.88, 1.02);
        this.crossP = c.cross;
        if (this.pk === 2 && !c.gamepadLike && this.ax[2].p > 0.6) {
            // asked for "throttle up" while it is already up
            if (c.throttleUpReaction === 'downFirst') { this.hold(2, -1.05, 3, 0.9); this.sub = 'down'; }
            else this.sub = 'wait';
            return;
        }
        if (this.r() < c.slipProb && this.ax[this.po].centring) {
            this.hold(this.po, (this.r() < 0.5 ? -1 : 1) * this.reachP, this.U(2.5, 4.5));
            this.sub = 'slip';
            this.subT = t + this.U(100, 300);
            return;
        }
        this.pushNow();
    }

    private pushNow(): void {
        const k = this.pk, o = this.po;
        this.hold(k, this.reachP, this.U(2.5, 4.5));
        if (this.ax[o].centring) this.hold(o, (this.r() < 0.5 ? -1 : 1) * this.crossP * this.reachP, 4, 0.8);
        else { const a = this.ax[o]; a.target = Math.max(-1, Math.min(1, a.p + (this.r() - 0.5) * this.crossP * 0.5)); }
        this.sub = 'push';
    }

    private letGoPush(): void {
        if (this.pk < 0) return;
        this.release(this.pk);
        if (this.ax[this.po].centring) this.release(this.po);
    }

    private planFlicks(t: number): void {
        const q: { at: number; on: boolean }[] = [];
        let at = t;
        let on = this.arm;
        for (let i = 0; i < 4; i++) {
            if (this.c.arm === 'momentary') { q.push({ at, on: true }); q.push({ at: at + 100, on: false }); }
            else { on = !on; q.push({ at, on }); }
            at += this.U(150, 500);
        }
        this.swBtn = this.c.arm === 'momentary';
        this.swQ = q;
    }

    // ---------------------------------------------------------------- every frame

    update(t: number, dt: number): void {
        if (this.pending && t >= this.pending.at) { const p = this.pending; this.pending = null; this.adopt(p.ins, t); }
        const cur = this.cur;
        const kind = cur ? cur.kind : 'idle';
        if (cur && cur.paced) {
            if (kind === 'stir' && cur.stage === 'active') this.doStir(t, dt);
            else if (kind === 'push' && cur.stage === 'active') this.doPush(t);
            if (this.lowering && this.ax[2].p < -0.97) { this.release(2); this.lowering = false; }
            if (t >= this.thumbUntil && this.thumbK >= 0) this.thumbOff();
        } else if (kind === 'stir') this.doStir(t, dt);
        else if (kind === 'centre') this.doCentre(t);
        else if (kind === 'push') this.doPush(t);
        else if (kind === 'throttleDown') { if (this.thrDown && !this.c.gamepadLike && this.ax[2].p < -0.97) { this.release(2); this.thrDown = false; } }
        else if (kind === 'armFlick' && this.flickRepeat && this.swQ.length === 0) this.planFlicks(t + this.U(1000, 3000));
        this.runSwitch(t);
        if (this.offAfterQ && this.swQ.length === 0) {
            this.offAfterQ = false;
            const l = this.last;
            if (l && l.kind === 'arm' && l.stage === 'active' && l.armPhase === 'off' && this.arm) this.planSwitch(t + this.U(200, 600), 'off');
        }
        if (this.actAt <= t) this.fire(t);
        if (this.retryAt <= t) this.retry(t);
        // body
        const n = Math.max(1, Math.ceil(dt / 4));
        const h = dt / n / 1000;
        for (let s = 0; s < n; s++) for (let k = 0; k < 4; k++) this.ax[k].step(h);
        if (this.arm3pass > 0) this.arm3pass -= dt;
        for (let k = 0; k < 3; k++) if (t >= this.auxBackAt[k]) { this.auxV[k] = this.auxBackTo[k]; this.auxBackAt[k] = Infinity; }
    }

    private doStir(t: number, dt: number): void {
        if (t >= this.flickAt && t < this.flickEnd) {
            // one hand on the switches: the sticks spring back, the throttle stays
            if (!this.inFlick) { this.inFlick = true; this.releaseAll(); }
            if (!this.auxFlicked && t - this.flickAt > 200) {
                this.auxFlicked = true;
                for (let k = 0; k < 3; k++) {
                    if (this.c.aux[k] !== 'switch') continue;
                    this.auxBackTo[k] = this.auxV[k];
                    this.auxV[k] = -this.auxV[k];
                    this.auxBackAt[k] = t + 250;
                }
            }
            return;
        }
        if (this.inFlick) { this.inFlick = false; this.flickAt = Infinity; }
        if (!this.stirOn) return;
        if (t >= this.stopAt) { this.stirOn = false; this.releaseAll(); return; }
        this.phiL += (this.wL * dt) / 1000;
        this.phiR += (this.wR * dt) / 1000;
        const R = this.reach;
        this.hold(3, R * Math.cos(this.phiL), 4, 0.7);
        this.hold(2, R * Math.sin(this.phiL), 4, 0.7);
        this.hold(0, R * Math.cos(this.phiR), 4, 0.7);
        this.hold(1, R * Math.sin(this.phiR), 4, 0.7);
    }

    private doCentre(t: number): void {
        if (this.lowering && this.ax[2].p < -0.97) { this.release(2); this.lowering = false; }
        if (t >= this.thumbUntil && this.thumbK >= 0) { this.release(this.thumbK); this.thumbUntil = Infinity; }
    }

    private doPush(t: number): void {
        const a = this.ax[this.pk];
        switch (this.sub) {
            case 'slip':
                if (t >= this.subT) { this.release(this.po); this.pushNow(); }
                break;
            case 'push':
                if (Math.abs(a.p - Math.max(-1, Math.min(1, a.target))) < 0.05) { this.sub = 'hold'; this.reachedAt = t; }
                break;
            case 'hold':
                if (t - this.reachedAt >= this.c.patienceMs) {
                    // nothing happened: let go and try again (the radio throttle just stays)
                    this.letGoPush();
                    this.sub = 'retry';
                    this.subT = t + this.U(300, 800);
                }
                break;
            case 'retry':
                if (t >= this.subT) this.pushNow();
                break;
            case 'down':
                if (this.ax[2].p < -0.95) { this.sub = 'dwell'; this.subT = t + (this.c.ideal ? 0 : this.U(150, 400)); }
                break;
            case 'dwell':
                if (t >= this.subT) this.pushNow();
                break;
            default:
                break;
        }
    }

    // ---------------------------------------------------------------- what the radio sends

    /** Channel outputs -1..1 (CH1..CH8) into `out`; returns the button bits. */
    channels(out: Float64Array): number {
        const c = this.c;
        for (let ch = 0; ch < 4; ch++) {
            let v = this.ax[this.chStick[ch]].p * c.rangeLimit;
            if (this.chInv[ch]) v = -v;
            out[ch] = v + this.chTrim[ch] + this.gauss() * c.noise;
        }
        const sw = this.arm3pass > 0 ? 0 : this.arm ? 1 : -1;
        if (c.gamepadLike) {
            out[4] = c.auxValue[3] + this.gauss() * c.auxNoise[3];
            out[5] = 0; out[6] = 0; out[7] = 0;
            return this.btn ? 1 : 0;
        }
        out[4] = c.arm === 'ch5-2pos' || c.arm === 'ch5-3pos' ? sw : 0; // a fresh model sends 0.0 on CH5
        for (let k = 0; k < 3; k++) {
            const kind = c.aux[k];
            out[5 + k] = k === 0 && c.arm === 'ch6-2pos' ? sw : kind === 'pot' || kind === 'potNearBin' ? this.auxV[k] + this.gauss() * c.auxNoise[k] : this.auxV[k];
        }
        return c.arm === 'button' && this.arm ? 1 : 0;
    }
}

// ------------------------------------------------------------------ one run, and the verdict

export interface Outcome {
    kind: 'correct' | 'wrong' | 'hang';
    ms: number;
    where: string;
    problems: string[];
    phaseMs: Record<string, number>;
    escapes: string[];
    hints: string[];
}

/** EdgeTX Classic joystick report value, as the parser reads it back. */
export function quantize11(v: number): number {
    let raw = Math.round(v * 1024) + 1024;
    raw = raw < 0 ? 0 : raw > 2047 ? 2047 : raw;
    return (raw - 1024) / 1024;
}

/** Called after every frame / tick ('frame') and after every UI action ('cmd'): the tests' command invariant. */
export type Observer<W> = (w: W, cause: 'frame' | 'cmd', t: number) => void;

export function runHuman<W extends { start(t: number): void; feed(f: RawFrame): unknown; tick?(t: number): unknown }>(
    make: () => W, ad: Adapter<W>, cfg: HumanConfig, maxMs = 180000, obs?: Observer<W>): Outcome {
    const w = make();
    const h = new Human(cfg);
    let flyAt = -1;
    let now = 0;
    h.onAct = (a) => { if (a.kind === 'fly') { if (flyAt < 0) flyAt = now; } else { ad.act(w, a); obs?.(w, 'cmd', now); } };
    const frame: RawFrame = { t: 0, axes: new Float32Array(8), buttons: 0 };
    const ch = new Float64Array(8);
    const dt = 1000 / cfg.rateHz;
    const phaseMs: Record<string, number> = {};
    let where = '';
    let whereT = 0;
    let nextTick = 250;
    const hasTick = typeof w.tick === 'function';
    w.start(0);
    for (let k = 0; ; k++) {
        const t = k * dt;
        if (t > maxMs) break;
        now = t;
        h.see(ad.read(w), t);
        h.update(t, dt);
        if (flyAt >= 0) break;
        frame.buttons = h.channels(ch);
        for (let i = 0; i < 8; i++) {
            const v = ch[i];
            frame.axes[i] = cfg.gamepadLike ? (v < -1 ? -1 : v > 1 ? 1 : v) : quantize11(v);
        }
        frame.t = t;
        w.feed(frame);
        obs?.(w, 'frame', t);
        if (hasTick && t >= nextTick) { w.tick!(t); nextTick += 250; obs?.(w, 'frame', t); }
        const wh = ad.where(w);
        if (wh !== where) {
            if (where) phaseMs[where] = (phaseMs[where] ?? 0) + (t - whereT);
            where = wh;
            whereT = t;
        }
    }
    const end = flyAt >= 0 ? flyAt : maxMs;
    if (where) phaseMs[where] = (phaseMs[where] ?? 0) + (end - whereT);
    if (flyAt < 0) return { kind: 'hang', ms: maxMs, where, problems: [`hang at ${where}`], phaseMs, escapes: h.escapes, hints: h.hints };
    const p = ad.profile(w);
    const problems = p ? judge(cfg, p) : ['no profile at check'];
    problems.push(...h.problems);
    return { kind: problems.length ? 'wrong' : 'correct', ms: flyAt, where, problems, phaseMs, escapes: h.escapes, hints: h.hints };
}

/** What is wrong with a profile for this person's radio (empty = correct). */
export function judge(cfg: HumanConfig, p: Profile): string[] {
    const bad: string[] = [];
    const out = new Float32Array(8);
    for (const fn of FNS) {
        const l = LETTER_OF[fn];
        const want = cfg.order.indexOf(l);
        const a = p.axes[fn];
        if (!a) { bad.push(`${fn} missing`); continue; }
        if (a.index !== want) { bad.push(`${fn} on CH${a.index + 1}, should be CH${want + 1}`); continue; }
        if (a.invert !== cfg.inv[l]) { bad.push(`${fn} inverted wrong`); continue; }
        if (fn !== 'throttle') {
            const trim = cfg.trim[l as 'A' | 'E' | 'R'];
            const err = Math.abs(a.center - trim) / ((a.max - a.min) / 2 || 1);
            if (err > 0.05) bad.push(`${fn} centre off ${(err * 100).toFixed(1)} %`);
            continue;
        }
        // the physical throttle ends through the profile
        const f: RawFrame = { t: 0, axes: new Float32Array(8), buttons: 0 };
        for (const fn2 of FNS) if (p.axes[fn2]) f.axes[p.axes[fn2].index] = p.axes[fn2].center;
        const end = (phys: number) => { const v = phys * cfg.rangeLimit * (cfg.inv.T ? -1 : 1); return cfg.gamepadLike ? v : quantize11(v); };
        f.axes[want] = end(-1);
        const down = (mapFrame(p, f, out)[2] + 1) / 2;
        f.axes[want] = end(1);
        const up = (mapFrame(p, f, out)[2] + 1) / 2;
        if (down > 0.05) bad.push(`throttle down reads ${(down * 100).toFixed(0)} %`);
        if (up < 0.95) bad.push(`throttle up reads ${(up * 100).toFixed(0)} %`);
    }
    const fr = (index: number, v: number, buttons = 0): RawFrame => { const ax = new Float32Array(8); if (index >= 0) ax[index] = v; return { t: 0, axes: ax, buttons }; };
    const a = p.arm;
    switch (cfg.arm) {
        case 'none':
            if (!a || a.kind !== 'key') bad.push(`arm should be the key (no switch on any channel), got ${JSON.stringify(a)}`);
            break;
        case 'ch5-2pos': case 'ch5-3pos': case 'ch6-2pos': {
            const idx = cfg.arm === 'ch6-2pos' ? 5 : 4;
            if (!a || a.kind !== 'axis' || a.index !== idx) { bad.push(`arm should be CH${idx + 1}, got ${JSON.stringify(a)}`); break; }
            if (!armOn(a, fr(idx, quantize11(1))) || armOn(a, fr(idx, quantize11(-1)))) bad.push(`arm threshold wrong ${JSON.stringify(a)}`);
            if (cfg.arm === 'ch5-3pos' && armOn(a, fr(idx, 0))) bad.push(`3-position switch arms in the middle ${JSON.stringify(a)}`);
            break;
        }
        case 'button':
            if (!a || a.kind !== 'button' || a.bit !== 0 || a.toggle) { bad.push(`arm should be button 1 (level), got ${JSON.stringify(a)}`); break; }
            if (!armOn(a, fr(-1, 0, 1)) || armOn(a, fr(-1, 0, 0))) bad.push(`arm button polarity wrong ${JSON.stringify(a)}`);
            break;
        case 'momentary':
            if (!a || a.kind !== 'button' || a.bit !== 0 || !a.toggle) bad.push(`arm should be button 1 (toggle), got ${JSON.stringify(a)}`);
            break;
    }
    return bad;
}
