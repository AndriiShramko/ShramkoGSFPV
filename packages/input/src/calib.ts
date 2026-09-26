// Calibration wizard core (no DOM): turns raw device frames into a profile that maps the
// device's axes and buttons onto roll / pitch / throttle / yaw / arm. The UI only shows what the
// state says and feeds frames in; every decision is made here, so simulated people can test it.
//
// Raw frames: axes normalised to [-1, 1] (HID 0..2048 -> -1..1, gamepad as is), buttons bitmask.
//
// Wizard v2 (2026-09-25). The first wizard froze on a real radio: it averaged the stick centres
// over a fixed second while the hands were still moving, then waited forever for the sticks to
// return there. This one measures only while things are still, takes a stick only when it came
// from the middle and was held, and never waits silently: every waiting screen gets a hint and a
// way out within 12 s. All times are in ms of the frame clock, never frame counts (radios send
// 125..1000 reports/s). The TUNING numbers come from a model of people (sim/human.ts) and the
// SimRadio; they are NOT measured on a real radio yet.

export type Fn = 'roll' | 'pitch' | 'throttle' | 'yaw';
export const FNS: Fn[] = ['throttle', 'yaw', 'pitch', 'roll']; // prompt order: left stick first in Mode 2

export type StepId = 'connect' | 'stir' | 'centre' | 'throttle' | 'yaw' | 'pitch' | 'roll' | 'arm' | 'check';
export const STEP_IDS: StepId[] = ['connect', 'stir', 'centre', 'throttle', 'yaw', 'pitch', 'roll', 'arm', 'check'];
export type Phase = 'push' | 'release' | 'on' | 'off' | null;
export type Dir = 'up' | 'down' | 'right' | 'centre' | 'stir' | 'flip';

export interface RawFrame {
    t: number; // ms (page clock)
    axes: Float32Array;
    buttons: number;
}

export interface AxisMap {
    index: number;
    invert: boolean;
    center: number;
    min: number;
    max: number;
}

export type ArmMap =
    // off/on: the two still levels the wizard saw (absent in older profiles); Reverse mirrors the threshold between them
    | { kind: 'axis'; index: number; threshold: number; onAbove: boolean; off?: number; on?: number }
    | { kind: 'button'; bit: number; toggle?: boolean; inverted?: boolean } // toggle: momentary, each press flips
    | { kind: 'key' }; // no switch: Space / on-screen ARM

export interface Profile {
    version: 1;
    deviceKey: string;
    deviceName: string;
    axes: Record<Fn, AxisMap>;
    arm: ArmMap | null;
    angleMode: ArmMap | null;
    deadband: number;
    created: string;
    mode?: 1 | 2; // stick mode chosen for the drawings; never used for mapping
    wizard?: number; // 2 = made by this wizard; absent = made by the first one
}

/** Legacy step number (main.ts, accept-fly): connect/stir 1, centre 2, sticks 3, arm 5, check 6. */
export type Step = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface Hint { key: string; params: Record<string, string | number> }
export type ChannelKind = 'stick' | 'switch' | 'idle';
export interface ChannelLive { v: number; lo: number; hi: number; cover: number; kind: ChannelKind; fn: Fn | 'arm' | null; still: boolean }
export interface Can { back: boolean; cont: boolean; useCurrent: boolean; pick: boolean; skipArm: boolean; fly: boolean; reverse: boolean }
export type ArmSource = { kind: 'ch'; n: number } | { kind: 'button'; n: number } | { kind: 'key' }; // n is 1-based

export interface WizardState {
    // legacy, still read by main.ts, fakehid, accept-fly
    step: Step;
    prompt: Fn | null; // push/release: the fn of the step, else null
    message: string; // i18n key of what to do now
    progress: number; // = hold
    error: string | null; // = hint?.key ?? null
    profile: Profile | null; // set on entering check
    // v2
    id: StepId;
    phase: Phase;
    target: { what: Fn | 'arm' | 'sticks'; dir: Dir } | null;
    hold: number; // 0..1, drives the ring
    ok: boolean; // true during the check-mark pause after a success
    stuckMs: number;
    hint: Hint | null;
    can: Can;
    channels: ChannelLive[]; // length nAxes (0 until the first frame)
    mapped: { roll: number; pitch: number; throttle: number; yaw: number; arm: boolean | null }; // NaN = unknown
    assigned: Partial<Record<Fn, number>>; // channel index per function so far
    armSource: ArmSource | null;
    leader: { ch: number; mag: number } | null; // push only
    sticksDone: number; // stir: stick channels with cover >= STIR_COVER
    checks: { throttleLow: boolean; armOn: boolean | null; centred: boolean } | null; // check only
}

export const TUNING = {
    STILL_P2P: 0.10,
    EMA_TAU_MS: 150,
    MOVING_SPAN: 0.30,
    SWITCH_SPAN: 0.50,
    STICK_SPAN: 1.00,
    OTHER_FRAC: 0.10,
    STIR_SWEEP_BINS: 10,
    STIR_COVER: 0.90,
    STIR_MIN_MS: 2500,
    STIR_HINT_MS: 12000,
    CENTRE_HOLD_MS: 800,
    CENTRE_MIN_MS: 2000,
    CENTRE_HINT_MS: 6000,
    CENTRE_ESCAPE_MS: 10000,
    PUSH: 0.60,
    ARRIVE_FROM: 0.35,
    ARRIVE_STILL_MS: 100,
    QUIET: 0.35,
    STICK_HOLD_MS: 400,
    THROTTLE_HOLD_MS: 700,
    THROTTLE_DOUBT_HOLD_MS: 2000,
    THR_FLIP_STILL_MS: 1000,
    THR_LATE_MS: 1500,
    THR_AWAY_STILL_MS: 300,
    RANGE_ONE_SIDED: 0.5,
    TAKEN_HOLD_MS: 400,
    PUSH_HINT_MS: 5000,
    PUSH_ESCAPE_MS: 8000,
    RELEASE_MID_TOL: 0.20,
    RELEASE_REST_TOL: 0.10,
    RELEASE_HOLD_MS: 300,
    THR_DOWN_TOL: 0.20,
    THR_DOWN_HOLD_MS: 400,
    RELEASE_HINT_MS: 4000,
    RELEASE_ESCAPE_MS: 8000,
    ARM_JUMP: 0.50,
    ARM_SMALL: 0.15,
    ARM_LEVEL_MS: 120,
    ARM_FAR_MS: 20,
    ARM_ON_HOLD_MS: 600,
    ARM_OFF_TOL: 0.20,
    ARM_OFF_HOLD_MS: 400,
    ARM_REACT_MS: 200,
    ARM_SOON_WAIT_MS: 2000,
    ARM_TAP_MS: 600,
    ARM_TAPS_WITHIN_MS: 4000,
    ARM_HINT_MS: 8000,
    ARM_OFF_HINT_MS: 5000,
    ARM_OFF_ESCAPE_MS: 8000,
    CONNECT_HINT_MS: 3000,
    OK_MS: 500,
    CHECK_SUSPECT_MS: 3000,
    CLASSIFY_EVERY_MS: 100,
    HINT_MIN_MS: 1500
} as const;

const T = TUNING;
const NB = 32; // stir histogram bins over [-1, 1]
const NBITS = 24;
const LIVE_STILL_MS = 300; // "still" dot on the channel bars
const TWO_WINDOW_MS = 2000; // "two sticks at once" hint looks this far back

const SAY: Record<string, string> = {
    connect: 'wizard.say.connect',
    stir: 'wizard.say.stir',
    centre: 'wizard.say.centre',
    'throttle/push': 'wizard.say.throttle.push',
    'throttle/release': 'wizard.say.throttle.release',
    'yaw/push': 'wizard.say.yaw.push',
    'pitch/push': 'wizard.say.pitch.push',
    'roll/push': 'wizard.say.roll.push',
    release: 'wizard.say.release',
    'arm/on': 'wizard.say.arm.on',
    'arm/off': 'wizard.say.arm.off',
    check: 'wizard.say.check'
};

interface ArmScratch { armCh: number; onLvl: number; offLvl: number; armBit: number; onVal: number; map: ArmMap | null }
interface Snap { assigned: Partial<Record<Fn, AxisMap>>; rest: number[]; arm: ArmScratch }
interface TrailEntry { id: StepId; phase: Phase; snap: Snap }

function isFn(id: StepId): id is Fn {
    return id === 'throttle' || id === 'yaw' || id === 'pitch' || id === 'roll';
}

function copyAssigned(a: Partial<Record<Fn, AxisMap>>): Partial<Record<Fn, AxisMap>> {
    const out: Partial<Record<Fn, AxisMap>> = {};
    for (const fn of FNS) { const m = a[fn]; if (m) out[fn] = { ...m }; }
    return out;
}

function copyArm(a: ArmMap | null): ArmMap | null {
    return a ? { ...a } : null;
}

function armSourceOf(a: ArmMap | null): ArmSource | null {
    if (!a) return null;
    if (a.kind === 'axis') return { kind: 'ch', n: a.index + 1 };
    if (a.kind === 'button') return { kind: 'button', n: a.bit + 1 };
    return { kind: 'key' };
}

function freshState(): WizardState {
    return {
        step: 0, prompt: null, message: SAY.connect, progress: 0, error: null, profile: null,
        id: 'connect', phase: null, target: null, hold: 0, ok: false, stuckMs: 0, hint: null,
        can: { back: false, cont: false, useCurrent: false, pick: false, skipArm: false, fly: false, reverse: false },
        channels: [], mapped: { roll: NaN, pitch: NaN, throttle: NaN, yaw: NaN, arm: null }, assigned: {},
        armSource: null, leader: null, sticksDone: 0, checks: null
    };
}

export class CalibrationWizard {
    state: WizardState = freshState();
    private deviceKey: string;
    private deviceName: string;
    private started = false;
    private resumed = false;
    private now = 0;
    private lastT = NaN;
    private n = 0;
    // per channel, allocated once on the first frame
    private v = new Float64Array(0);
    private mins = new Float64Array(0);
    private maxs = new Float64Array(0);
    private rest = new Float64Array(0);
    private cur = new Float64Array(0);
    private wMin = new Float64Array(0);
    private wMax = new Float64Array(0);
    private wSum = new Float64Array(0);
    private wN = new Float64Array(0);
    private stillSince = new Float64Array(0);
    private firstVal = new Float64Array(0);
    private hist = new Uint32Array(0);
    private histN = new Uint32Array(0);
    private kinds: ChannelKind[] = [];
    private fnOfCh: (Fn | 'arm' | null)[] = [];
    private armedP = new Uint8Array(0); // push: came from the middle in this phase
    private stillP = new Uint8Array(0); // push: was still at some moment in this phase
    private startHigh = new Uint8Array(0); // push: already pushed when the phase began
    private belowP = new Uint8Array(0); // push: an assigned channel was near its middle in this phase
    private takenSince = new Float64Array(0);
    private lvl = new Float64Array(0); // arm: still level per channel (NaN = none yet)
    private prevLvl = new Float64Array(0);
    private lvlSince = new Float64Array(0);
    private maxExc = new Float64Array(0);
    private farV = new Float64Array(0); // arm: farthest value from the level since it was last still
    private farT = new Float64Array(0); // arm: since when the value is ARM_JUMP away from the level (NaN = not)
    private lvlChanged = new Uint8Array(0);
    private seenLo = new Float64Array(0); // arm steps: lowest and highest still level seen per channel
    private seenHi = new Float64Array(0);
    private offEarly = false; // arm off: the input was already back at OFF before the screen could be read
    private offEarlyT = 0; // ... since when (a button: the time of that change)
    private offMoved = false; // ... and has moved since
    private thrAway = false; // throttle down: seen resting away from "down" in this phase
    private loose = new Uint8Array(0); // taken as a stick by "Continue anyway" without a full stir
    // buttons
    private lastButtons = 0;
    private bitVal = new Uint8Array(NBITS);
    private bitSince = new Float64Array(NBITS);
    private bitBase = new Uint8Array(NBITS);
    private bitChanged = new Uint8Array(NBITS);
    private pressT = new Float64Array(NBITS).fill(NaN);
    private tapT = new Float64Array(NBITS).fill(NaN);
    private tapBit = -1;
    private hintAt = 0;
    private emaDt = -1;
    private emaK = 0;
    // flow
    private id: StepId = 'connect';
    private phase: Phase = null;
    private phaseT0 = 0;
    private stuckT0 = 0;
    private phaseFirst = true;
    private ok = false;
    private okUntil = 0;
    private pendId: StepId = 'connect';
    private pendPhase: Phase = null;
    private fnIdx = 0;
    private trail: TrailEntry[] = [];
    // stir
    private firstMoveT = NaN;
    private lastClassifyT = -Infinity;
    private stickSet: number[] = [];
    private endCh = -1; // centre: a stick still held at its end (not let go yet), else -1
    // push
    private free: number[] = [];
    private restrict: number | null = null;
    private holdStart = NaN;
    private holdCh = -1;
    private holdSign = 0;
    private maxLead = 0;
    private twoT = -Infinity;
    private twoA = -1;
    private twoB = -1;
    private takenCh = -1;
    // result so far
    private assigned: Partial<Record<Fn, AxisMap>> = {};
    private arm: ArmScratch = { armCh: -1, onLvl: NaN, offLvl: NaN, armBit: -1, onVal: 1, map: null };
    private mapOut = new Float32Array(8);

    constructor(deviceKey: string, deviceName: string) {
        this.deviceKey = deviceKey;
        this.deviceName = deviceName;
    }

    /** Resume at the check screen with a saved profile (no trail: Back is disabled). */
    static resume(p: Profile): CalibrationWizard {
        const w = new CalibrationWizard(p.deviceKey, p.deviceName);
        w.resumed = true;
        w.started = true;
        w.id = 'check';
        w.phase = null;
        w.assigned = copyAssigned(p.axes);
        w.arm.map = p.arm;
        const st = w.state;
        st.step = 6;
        st.id = 'check';
        st.message = SAY.check;
        st.profile = p;
        st.armSource = armSourceOf(p.arm);
        for (const fn of FNS) if (p.axes[fn]) st.assigned[fn] = p.axes[fn].index;
        st.checks = { throttleLow: false, armOn: null, centred: false };
        w.timers();
        return w;
    }

    start(t: number): void {
        if (this.resumed) { this.now = Math.max(this.now, t); this.stuckT0 = this.now; return; }
        const keepN = this.n;
        const keep = this.state.channels;
        this.state = freshState();
        this.state.channels = keep;
        this.n = keepN;
        this.started = true;
        this.now = t;
        this.lastT = NaN;
        this.trail = [];
        this.assigned = {};
        this.arm = { armCh: -1, onLvl: NaN, offLvl: NaN, armBit: -1, onVal: 1, map: null };
        this.enter('connect', null, false);
        this.state.step = 1;
    }

    feed(f: RawFrame): WizardState {
        const st = this.state;
        if (!this.started) return st;
        const t = f.t > this.now ? f.t : this.now;
        const dt = Number.isNaN(this.lastT) ? 0 : t - this.lastT;
        this.now = t;
        this.lastT = t;
        if (this.n === 0) this.init(Math.min(8, f.axes.length), f, t);
        this.track(f, t, dt);
        if (this.id === 'connect') this.enter('stir', null, true);
        if (this.ok) {
            if (t >= this.okUntil) this.enterPending();
            else { this.live(f); this.timers(); return st; }
        }
        this.evaluate(t);
        this.live(f);
        this.timers();
        return st;
    }

    /** Timers without frames (connect hint, end of the check-mark pause), and the rules on the held values. */
    tick(t: number): WizardState {
        if (!this.started) return this.state;
        if (t > this.now) this.now = t;
        if (this.ok && this.now >= this.okUntil) this.enterPending();
        // sample and hold: a pad that reports only changes (Gamepad.timestamp frozen, 8-bit axes,
        // a deadzone) sends nothing while the sticks are still, and every hold here is stillness
        if (!this.ok && this.n > 0 && this.id !== 'connect' && this.id !== 'check') this.evaluate(this.now);
        this.timers();
        return this.state;
    }

    // ------------------------------------------------------------------ escapes

    back(): boolean {
        if (this.ok) {
            const top = this.trail[this.trail.length - 1];
            if (!top) return false;
            this.ok = false;
            this.restore(top.snap);
            this.enter(top.id, top.phase, false);
            return true;
        }
        if (this.trail.length < 2) return false;
        this.trail.pop();
        // a release or switch-off is part of its step: going back redoes the whole step
        while (this.trail.length >= 2) {
            const p = this.trail[this.trail.length - 1].phase;
            if (p !== 'release' && p !== 'off') break;
            this.trail.pop();
        }
        const top = this.trail[this.trail.length - 1];
        this.restore(top.snap);
        this.enter(top.id, top.phase, false);
        return true;
    }

    cont(): void {
        if (!this.state.can.cont) return;
        this.state.hint = null;
        if (this.id === 'stir') {
            this.classify();
            this.stickSet = [];
            for (let i = 0; i < this.n; i++) if (this.kinds[i] === 'stick') this.stickSet.push(i);
            // fewer than four sticks: every channel stays a candidate and the stick steps find them
            // (with "Pick the channel by hand" there); the ones not stirred are measured from their rest
            if (this.stickSet.length < 4) {
                this.stickSet = [];
                for (let i = 0; i < this.n; i++) { this.stickSet.push(i); if (this.kinds[i] !== 'stick') this.loose[i] = 1; }
            }
            this.succeed('centre', null);
        } else if (this.id === 'throttle' && this.phase === 'release') {
            // "Continue anyway" while the throttle still reads full on "Throttle all the way down":
            // the pilot says this IS down, so the push was taken the wrong way round
            const a = this.assigned.throttle!;
            const c = a.index;
            const up = a.invert ? this.mins[c] : this.maxs[c];
            if (Math.abs(this.v[c] - up) <= T.THR_DOWN_TOL * this.half(c) && this.stillMs(c) >= T.THR_FLIP_STILL_MS) {
                a.invert = !a.invert;
                a.center = a.invert ? this.maxs[c] : this.mins[c];
            }
            this.succeed(...this.afterRelease());
        } else if (this.id === 'arm' && this.phase === 'off') {
            this.arm.map = this.armFromLevels();
            this.succeed('check', null);
        }
    }

    useCurrent(): void {
        if (!this.state.can.useCurrent) return;
        this.state.hint = null;
        if (this.id === 'centre') {
            for (const c of this.stickSet) this.rest[c] = this.restNow(c);
            this.succeed(FNS[0], 'push');
        } else if (isFn(this.id) && this.id !== 'throttle' && this.phase === 'release') {
            const a = this.assigned[this.id]!;
            this.rest[a.index] = this.restNow(a.index);
            a.center = this.rest[a.index];
            this.succeed(...this.afterRelease());
        }
    }

    pick(ch: number): void {
        if (this.ok || this.phase !== 'push' || !isFn(this.id)) return;
        if (!this.freeChannels().includes(ch)) return;
        this.restrict = ch;
        this.free = [ch];
        this.armedP.fill(0);
        this.holdStart = NaN;
        this.holdCh = -1;
        this.maxLead = 0;
        this.stuckT0 = this.now;
        this.state.hint = null;
        this.timers();
    }

    skipArm(): void {
        if (!this.state.can.skipArm) return;
        this.state.hint = null;
        this.arm.map = { kind: 'key' };
        this.state.armSource = { kind: 'key' };
        this.enter('check', null, true);
    }

    reverse(what: Fn | 'arm'): void {
        const p = this.state.profile;
        if (this.id !== 'check' || !p) return;
        if (what === 'arm') {
            const a = p.arm;
            if (!a || a.kind === 'key') return;
            if (a.kind === 'axis') {
                // the threshold sits 3/4 of the way to ON (a 3-position switch reads OFF in its
                // middle); flipping onAbove alone would move it to 1/4 and arm in the middle, so
                // mirror it between the two levels. Without levels (older profile) it is the
                // midpoint, which mirrors onto itself.
                if (a.off !== undefined && a.on !== undefined) {
                    a.threshold = a.off + a.on - a.threshold;
                    const x = a.off; a.off = a.on; a.on = x;
                }
                a.onAbove = !a.onAbove;
            } else if (a.inverted) delete a.inverted;
            else a.inverted = true;
            return;
        }
        const a = p.axes[what];
        a.invert = !a.invert;
        if (what === 'throttle') a.center = a.invert ? a.max : a.min;
        const own = this.assigned[what];
        if (own) own.invert = a.invert;
    }

    /** Push: the channels that may still become this function (for the pick list). */
    freeChannels(): number[] {
        if (this.phase !== 'push') return [];
        const used = this.usedChannels();
        return this.stickSet.filter((c) => !used.has(c));
    }

    // ------------------------------------------------------------------ flow

    private init(n: number, f: RawFrame, t: number): void {
        this.n = n;
        const F = () => new Float64Array(n);
        this.v = F(); this.mins = F(); this.maxs = F(); this.rest = F(); this.cur = F();
        this.wMin = F(); this.wMax = F(); this.wSum = F(); this.wN = F(); this.stillSince = F(); this.firstVal = F();
        this.hist = new Uint32Array(n * NB); this.histN = new Uint32Array(n);
        this.kinds = new Array<ChannelKind>(n).fill('idle');
        this.fnOfCh = new Array<Fn | 'arm' | null>(n).fill(null);
        this.armedP = new Uint8Array(n); this.stillP = new Uint8Array(n); this.startHigh = new Uint8Array(n); this.belowP = new Uint8Array(n);
        this.takenSince = F().fill(NaN);
        this.lvl = F().fill(NaN); this.prevLvl = F().fill(NaN); this.lvlSince = F(); this.maxExc = F(); this.farV = F().fill(NaN); this.farT = F().fill(NaN); this.lvlChanged = new Uint8Array(n);
        this.seenLo = F().fill(NaN); this.seenHi = F().fill(NaN); this.loose = new Uint8Array(n);
        for (let i = 0; i < n; i++) {
            const x = f.axes[i];
            this.v[i] = x; this.mins[i] = x; this.maxs[i] = x; this.cur[i] = x; this.firstVal[i] = x;
            this.wMin[i] = x; this.wMax[i] = x; this.wSum[i] = 0; this.wN[i] = 0; this.stillSince[i] = t;
        }
        this.lastButtons = f.buttons;
        for (let b = 0; b < NBITS; b++) { this.bitVal[b] = (f.buttons >> b) & 1; this.bitSince[b] = t; }
        const ch: ChannelLive[] = [];
        for (let i = 0; i < n; i++) ch.push({ v: f.axes[i], lo: f.axes[i], hi: f.axes[i], cover: 0, kind: 'idle', fn: null, still: false });
        this.state.channels = ch;
        if (this.resumed) this.fnFromAssigned();
    }

    private track(f: RawFrame, t: number, dt: number): void {
        if (dt !== this.emaDt) { this.emaDt = dt; this.emaK = 1 - Math.exp(-dt / T.EMA_TAU_MS); }
        const k = this.emaK;
        const stir = this.id === 'stir' && !this.ok;
        for (let i = 0; i < this.n; i++) {
            const x = f.axes[i];
            this.v[i] = x;
            if (x < this.mins[i]) this.mins[i] = x;
            if (x > this.maxs[i]) this.maxs[i] = x;
            const lo = x < this.wMin[i] ? x : this.wMin[i];
            const hi = x > this.wMax[i] ? x : this.wMax[i];
            if (hi - lo > T.STILL_P2P) { this.stillSince[i] = t; this.wMin[i] = x; this.wMax[i] = x; this.wSum[i] = x; this.wN[i] = 1; }
            else { this.wMin[i] = lo; this.wMax[i] = hi; this.wSum[i] += x; this.wN[i]++; }
            this.cur[i] += (x - this.cur[i]) * k;
            if (stir) {
                let b = Math.floor((x + 1) * (NB / 2));
                b = b < 0 ? 0 : b > NB - 1 ? NB - 1 : b;
                this.hist[i * NB + b]++;
                this.histN[i]++;
            }
        }
        if (this.id === 'arm') {
            // every still level on both arm screens and their check-mark pauses: the far end of a
            // 3-position switch is often reached only after its middle was already taken as ON
            for (let i = 0; i < this.n; i++) {
                if (t - this.stillSince[i] < T.ARM_LEVEL_MS) continue;
                const m = this.stillMean(i);
                if (!(m >= this.seenLo[i])) this.seenLo[i] = m;
                if (!(m <= this.seenHi[i])) this.seenHi[i] = m;
            }
        }
        if (f.buttons !== this.lastButtons) {
            const changed = f.buttons ^ this.lastButtons;
            this.lastButtons = f.buttons;
            const taps = this.id === 'arm' && this.phase === 'on' && !this.ok;
            for (let b = 0; b < NBITS; b++) {
                if (!(changed & (1 << b))) continue;
                const val = (f.buttons >> b) & 1;
                this.bitVal[b] = val;
                this.bitSince[b] = t;
                if (!taps) continue;
                this.bitChanged[b] = 1;
                if (val === 1) { this.pressT[b] = t; continue; }
                // a release: a short press is a tap; two taps close together = momentary button
                if (!Number.isNaN(this.pressT[b]) && t - this.pressT[b] < T.ARM_TAP_MS) {
                    if (!Number.isNaN(this.tapT[b]) && t - this.tapT[b] <= T.ARM_TAPS_WITHIN_MS) { if (this.tapBit < 0) this.tapBit = b; }
                    else this.tapT[b] = this.pressT[b];
                } else this.tapT[b] = NaN;
                this.pressT[b] = NaN;
            }
        }
    }

    private stillMs(i: number): number { return this.now - this.stillSince[i]; }
    private stillInPhase(i: number): number { return this.now - Math.max(this.stillSince[i], this.phaseT0); }
    private stillMean(i: number): number { return this.wN[i] > 0 ? this.wSum[i] / this.wN[i] : this.v[i]; }
    /** "Use the current position": the still mean if still, else the smoothed value (cur stops at the last frame of a sparse pad). */
    private restNow(i: number): number { return this.stillMs(i) >= LIVE_STILL_MS ? this.stillMean(i) : this.cur[i]; }
    private half(i: number): number { const h = (this.maxs[i] - this.mins[i]) / 2; return h > 0.05 ? h : 0.05; }
    private dm(i: number): number {
        // a channel let through without a full stir: the middle of the little range seen so far is
        // not its centre (its rest would read as an end), so measure from where it rested
        if (this.loose[i] && this.id !== 'stir' && this.id !== 'centre') {
            const r = this.rest[i];
            return (this.v[i] - r) / Math.max(this.maxs[i] - r, r - this.mins[i], 0.05);
        }
        return (this.v[i] - (this.maxs[i] + this.mins[i]) / 2) / this.half(i);
    }
    private dr(i: number): number { return (this.v[i] - this.rest[i]) / this.half(i); }

    private usedChannels(): Set<number> {
        const s = new Set<number>();
        for (const fn of FNS) { const a = this.assigned[fn]; if (a) s.add(a.index); }
        return s;
    }

    private enter(id: StepId, phase: Phase, push: boolean): void {
        const st = this.state;
        this.id = id;
        this.phase = phase;
        this.phaseT0 = this.now;
        this.stuckT0 = this.now;
        this.phaseFirst = true;
        this.ok = false;
        this.restrict = null;
        this.holdStart = NaN;
        this.holdCh = -1;
        this.maxLead = 0;
        this.twoT = -Infinity;
        this.takenCh = -1;
        this.armedP.fill(0);
        this.stillP.fill(0);
        this.startHigh.fill(0);
        this.belowP.fill(0);
        this.takenSince.fill(NaN);
        if (isFn(id)) this.fnIdx = FNS.indexOf(id);
        if (id === 'stir') this.resetStir();
        if (id === 'arm' && phase === 'on') this.resetArm();
        if (phase === 'push') { const used = this.usedChannels(); this.free = this.stickSet.filter((c) => !used.has(c)); }
        if (push && id !== 'connect') this.trail.push({ id, phase, snap: this.snap() });
        // legacy + v2 fields
        st.id = id;
        st.phase = phase;
        st.step = id === 'connect' || id === 'stir' ? 1 : id === 'centre' ? 2 : isFn(id) ? 3 : id === 'arm' ? 5 : 6;
        st.prompt = isFn(id) ? id : null;
        st.message = SAY[phase === 'release' && id !== 'throttle' ? 'release' : phase ? `${id}/${phase}` : id];
        st.target = this.targetOf(id, phase);
        st.hold = 0;
        st.progress = 0;
        st.ok = false;
        st.stuckMs = 0;
        st.hint = null;
        st.error = null;
        st.leader = null;
        st.checks = null;
        this.endCh = -1;
        this.fnFromAssigned();
        if (id === 'check') {
            this.fixArmPolarity();
            st.profile = this.buildProfile();
            st.armSource = armSourceOf(this.arm.map);
            st.checks = { throttleLow: false, armOn: null, centred: false };
        } else if (!this.resumed) st.profile = null;
        this.timers();
    }

    private targetOf(id: StepId, phase: Phase): WizardState['target'] {
        if (id === 'stir') return { what: 'sticks', dir: 'stir' };
        if (id === 'centre') return { what: 'sticks', dir: 'centre' };
        if (isFn(id)) {
            if (phase === 'push') return { what: id, dir: id === 'throttle' || id === 'pitch' ? 'up' : 'right' };
            return { what: id, dir: id === 'throttle' ? 'down' : 'centre' };
        }
        if (id === 'arm') return { what: 'arm', dir: 'flip' };
        return null;
    }

    private succeed(id: StepId, phase: Phase): void {
        this.ok = true;
        this.okUntil = this.now + T.OK_MS;
        this.pendId = id;
        this.pendPhase = phase;
        const st = this.state;
        st.ok = true;
        st.hold = 1;
        st.progress = 1;
        st.hint = null;
        st.error = null;
        this.fnFromAssigned();
        this.timers();
    }

    private enterPending(): void {
        this.enter(this.pendId, this.pendPhase, true);
    }

    private afterRelease(): [StepId, Phase] {
        return this.fnIdx + 1 < FNS.length ? [FNS[this.fnIdx + 1], 'push'] : ['arm', 'on'];
    }

    private snap(): Snap {
        return { assigned: copyAssigned(this.assigned), rest: Array.from(this.rest), arm: { ...this.arm, map: copyArm(this.arm.map) } };
    }

    private restore(s: Snap): void {
        this.assigned = copyAssigned(s.assigned);
        for (let i = 0; i < this.n; i++) this.rest[i] = s.rest[i] ?? 0;
        this.arm = { ...s.arm, map: copyArm(s.arm.map) };
        this.state.armSource = this.arm.map ? armSourceOf(this.arm.map) : this.arm.armCh >= 0 ? { kind: 'ch', n: this.arm.armCh + 1 } : this.arm.armBit >= 0 ? { kind: 'button', n: this.arm.armBit + 1 } : null;
    }

    private fnFromAssigned(): void {
        const st = this.state;
        for (let i = 0; i < this.fnOfCh.length; i++) this.fnOfCh[i] = null;
        st.assigned = {};
        for (const fn of FNS) {
            const a = this.assigned[fn];
            if (!a) continue;
            st.assigned[fn] = a.index;
            if (a.index < this.fnOfCh.length) this.fnOfCh[a.index] = fn;
        }
        const m = this.arm.map;
        const ac = m && m.kind === 'axis' ? m.index : this.arm.armCh;
        if (ac >= 0 && ac < this.fnOfCh.length) this.fnOfCh[ac] = 'arm';
    }

    // ------------------------------------------------------------------ rules per screen

    private evaluate(t: number): void {
        switch (this.id) {
            case 'stir': this.evalStir(t); break;
            case 'centre': this.evalCentre(); break;
            case 'throttle': case 'yaw': case 'pitch': case 'roll':
                if (this.phase === 'push') this.evalPush(t); else this.evalRelease();
                break;
            case 'arm':
                if (this.phase === 'on') this.evalArmOn(t); else this.evalArmOff();
                break;
            default: break;
        }
        this.phaseFirst = false;
    }

    private resetStir(): void {
        for (let i = 0; i < this.n; i++) {
            const x = this.v[i];
            this.mins[i] = x; this.maxs[i] = x; this.firstVal[i] = x; this.kinds[i] = 'idle';
        }
        this.hist.fill(0);
        this.histN.fill(0);
        this.loose.fill(0);
        this.firstMoveT = NaN;
        this.lastClassifyT = -Infinity;
        this.stickSet = [];
        this.state.sticksDone = 0;
    }

    /**
     * Stick or switch from the stir histogram: a stirred stick sweeps many bins, a switch sits in 2-3.
     * Two signs of a sweep: time spent outside the 3 fullest bins, or many bins crossed at least
     * twice. The second catches someone who stirs corner to corner and pauses in each corner:
     * nearly all their time is at the ends, yet the stick passes through every bin on the way,
     * while a switch jumps across in a frame or two (time share alone called all four sticks switches).
     */
    private classify(): void {
        let done = 0;
        for (let i = 0; i < this.n; i++) {
            const span = this.maxs[i] - this.mins[i];
            const cnt = this.histN[i];
            let a = 0, b = 0, c = 0, crossed = 0;
            for (let k = i * NB, e = k + NB; k < e; k++) {
                const x = this.hist[k];
                if (x >= 2) crossed++;
                if (x > a) { c = b; b = a; a = x; } else if (x > b) { c = b; b = x; } else if (x > c) c = x;
            }
            const other = cnt > 0 ? 1 - (a + b + c) / cnt : 0;
            const sweeps = other >= T.OTHER_FRAC || crossed >= T.STIR_SWEEP_BINS;
            this.kinds[i] = span >= T.STICK_SPAN && sweeps ? 'stick' : span >= T.SWITCH_SPAN && !sweeps ? 'switch' : 'idle';
            if (this.kinds[i] === 'stick' && span / 2 >= T.STIR_COVER) done++;
        }
        this.state.sticksDone = done;
    }

    private evalStir(t: number): void {
        if (Number.isNaN(this.firstMoveT)) {
            for (let i = 0; i < this.n; i++) if (Math.abs(this.v[i] - this.firstVal[i]) >= T.MOVING_SPAN) { this.firstMoveT = t; break; }
        }
        if (t - this.lastClassifyT < T.CLASSIFY_EVERY_MS) return;
        this.lastClassifyT = t;
        this.classify();
        this.state.hold = this.state.progress = Math.min(1, this.state.sticksDone / 4);
        if (this.state.sticksDone >= 4 && !Number.isNaN(this.firstMoveT) && t - this.firstMoveT >= T.STIR_MIN_MS) {
            this.stickSet = [];
            for (let i = 0; i < this.n; i++) if (this.kinds[i] === 'stick') this.stickSet.push(i);
            this.succeed('centre', null);
        }
    }

    private evalCentre(): void {
        let least = Infinity;
        for (const c of this.stickSet) least = Math.min(least, this.stillInPhase(c));
        // still is not enough: a stick still at its END has not been let go (a slow reader still
        // pausing in a corner), and its "rest" would be that end. Only the throttle rests at an
        // end, so of the four sticks at most one may sit there (one more per extra stick-like
        // channel, e.g. a pot or a gamepad trigger swept while stirring).
        let ends = 0, endCh = -1, endStill = Infinity, stirred = 0;
        for (const c of this.stickSet) {
            if (this.loose[c]) continue; // an unstirred channel's range says nothing about its ends
            stirred++;
            if (Math.abs(this.dm(c)) < T.PUSH) continue;
            ends++;
            const s = this.stillInPhase(c);
            if (s < endStill) { endStill = s; endCh = c; } // named in the hint: the latest to get there (nothing tells the throttle apart yet)
        }
        this.endCh = ends > Math.max(1, stirred - 3) ? endCh : -1;
        if (this.endCh >= 0) { this.state.hold = this.state.progress = 0; return; }
        // the screen stays at least CENTRE_MIN_MS: someone who was already still has not read it
        // yet, and their late "throttle down" must happen here, not be taken as "throttle up" next
        const shown = this.now - this.phaseT0;
        this.state.hold = this.state.progress = Math.max(0, Math.min(1, least / T.CENTRE_HOLD_MS, shown / T.CENTRE_MIN_MS));
        if (least < T.CENTRE_HOLD_MS || shown < T.CENTRE_MIN_MS) return;
        for (const c of this.stickSet) this.rest[c] = this.stillMean(c);
        this.succeed(FNS[0], 'push');
    }

    private evalPush(t: number): void {
        const fn = FNS[this.fnIdx];
        const F = this.free;
        let count = 0, cand = -1, nHigh = 0, hA = -1, hB = -1, lead = -1, leadMag = -1;
        for (let k = 0; k < F.length; k++) {
            const j = F[k];
            const a = Math.abs(this.dm(j));
            if (this.phaseFirst && a >= T.PUSH) this.startHigh[j] = 1;
            // arrival counts only after the stick was at rest in this phase: a movement already
            // under way when the screen changed (a late reaction to the previous screen, e.g.
            // lowering the throttle for "let go") must not be taken as this push
            if (this.stillMs(j) >= T.ARRIVE_STILL_MS) this.stillP[j] = 1;
            if (a < T.ARRIVE_FROM && this.stillP[j]) this.armedP[j] = 1;
            if (a >= T.PUSH) { if (nHigh === 0) hA = j; else if (nHigh === 1) hB = j; nHigh++; }
            if (this.armedP[j]) {
                if (a > this.maxLead) this.maxLead = a;
                if (a >= T.PUSH) { count++; cand = j; }
            }
            if (a > leadMag) { leadMag = a; lead = j; }
        }
        if (nHigh >= 2) { this.twoT = t; this.twoA = hA; this.twoB = hB; }
        let good = count === 1;
        // every other free stick must be near its rest or near its middle (two references, so a
        // rest polluted by a thumb or a pot parked at an end cannot block the test)
        if (good && this.restrict === null) {
            for (let k = 0; k < F.length; k++) {
                const j = F[k];
                if (j === cand) continue;
                if (!(Math.abs(this.dr(j)) < T.QUIET || Math.abs(this.dm(j)) < T.QUIET)) { good = false; break; }
            }
        }
        const sign = good ? (this.dm(cand) >= 0 ? 1 : -1) : 0;
        if (good) {
            if (cand !== this.holdCh || sign !== this.holdSign || Number.isNaN(this.holdStart)) { this.holdCh = cand; this.holdSign = sign; this.holdStart = t; }
        } else { this.holdStart = NaN; this.holdCh = -1; this.holdSign = 0; }
        let need: number = fn === 'throttle' ? T.THROTTLE_HOLD_MS : T.STICK_HOLD_MS;
        if (good && fn === 'throttle') {
            // two ends are doubtful as "up": the end it rested at during "let go" (told: leave it
            // down) and the raw-low end (down on nearly every radio). An impatient pilot pushes up
            // for a moment and rests back at the bottom; that rest must not become "up" (inverted
            // throttle). The ring fills slower there, so only a deliberate hold passes.
            const rd = (this.rest[cand] - (this.maxs[cand] + this.mins[cand]) / 2) / this.half(cand);
            if (sign < 0 || (Math.abs(rd) >= T.PUSH && (rd >= 0 ? 1 : -1) === sign)) need = T.THROTTLE_DOUBT_HOLD_MS;
        }
        const held = good ? t - this.holdStart : 0;
        const st = this.state;
        st.hold = st.progress = Math.min(1, held / need);
        if (lead >= 0) {
            if (!st.leader) st.leader = { ch: lead, mag: 0 };
            st.leader.ch = lead;
            st.leader.mag = Math.min(1, leadMag);
        } else st.leader = null;
        // an already-set channel pushed on purpose: say so at once
        for (const f2 of FNS) {
            const a2 = this.assigned[f2];
            if (!a2) continue;
            const c2 = a2.index;
            const m = Math.abs(this.dm(c2));
            if (m < T.ARRIVE_FROM) { this.belowP[c2] = 1; this.takenSince[c2] = NaN; if (this.takenCh === c2) this.takenCh = -1; }
            else if (this.belowP[c2] && m >= T.PUSH) {
                if (Number.isNaN(this.takenSince[c2])) this.takenSince[c2] = t;
                else if (t - this.takenSince[c2] >= T.TAKEN_HOLD_MS) this.takenCh = c2;
            } else this.takenSince[c2] = NaN;
        }
        if (good && held >= need) this.assign(fn, cand, sign);
    }

    private assign(fn: Fn, c: number, s: number): void {
        const inv = s < 0;
        this.assigned[fn] = fn === 'throttle'
            ? { index: c, invert: inv, center: inv ? this.maxs[c] : this.mins[c], min: this.mins[c], max: this.maxs[c] }
            : { index: c, invert: inv, center: this.rest[c], min: this.mins[c], max: this.maxs[c] };
        this.state.leader = null;
        this.succeed(fn, 'release');
    }

    private evalRelease(): void {
        const fn = FNS[this.fnIdx];
        const a = this.assigned[fn]!;
        const c = a.index;
        const st = this.state;
        if (fn === 'throttle') {
            const down = a.invert ? this.maxs[c] : this.mins[c];
            const near = Math.abs(this.v[c] - down) <= T.THR_DOWN_TOL * this.half(c);
            // "down" is an answer to this screen only after the stick rested somewhere else in it
            // (held up, then pulled down). Reaching it in one movement that began before the
            // screen, or sitting there already, may be the pilot still doing "up": after a push
            // taken the wrong way round, their own push continues to what reads as "down" and
            // would confirm the inversion silently. So that case must stay there THR_LATE_MS, long
            // enough to read this screen and react (someone who thinks it is up moves away).
            if (this.phaseFirst) this.thrAway = false;
            if (!near && this.stillMs(c) >= T.THR_AWAY_STILL_MS) this.thrAway = true;
            const need = this.thrAway ? T.THR_DOWN_HOLD_MS : T.THR_LATE_MS;
            const s = near ? this.stillInPhase(c) : 0;
            st.hold = st.progress = Math.min(1, s / need);
            if (near && s >= need) this.succeed(...this.afterRelease());
            return;
        }
        // back at the rest taken at "let go" counts only off the ends: if that rest was an end
        // (the person was still pausing in a corner then), the stick held there must not pass
        const back = Math.abs(this.dm(c)) <= T.RELEASE_MID_TOL || (Math.abs(this.dr(c)) <= T.RELEASE_REST_TOL && Math.abs(this.dm(c)) < T.ARRIVE_FROM);
        const s = back ? this.stillInPhase(c) : 0;
        st.hold = st.progress = Math.min(1, s / T.RELEASE_HOLD_MS);
        if (back && s >= T.RELEASE_HOLD_MS) {
            this.rest[c] = this.stillMean(c); // the centre is measured again here: the thumb is off now
            a.center = this.rest[c];
            this.succeed(...this.afterRelease());
        }
    }

    private resetArm(): void {
        this.lvl.fill(NaN);
        this.prevLvl.fill(NaN);
        this.lvlSince.fill(0);
        this.maxExc.fill(0);
        this.farV.fill(NaN);
        this.farT.fill(NaN);
        this.lvlChanged.fill(0);
        this.seenLo.fill(NaN); // an earlier try (before Back) may have used another switch
        this.seenHi.fill(NaN);
        this.arm = { armCh: -1, onLvl: NaN, offLvl: NaN, armBit: -1, onVal: 1, map: null };
        this.bitBase.set(this.bitVal);
        this.bitChanged.fill(0);
        this.pressT.fill(NaN);
        this.tapT.fill(NaN);
        this.tapBit = -1;
        this.state.armSource = null;
    }

    /** Arm levels: a level counts only when still; a new level must be ARM_JUMP away (noisy pots never are). */
    private armLevels(): void {
        for (let i = 0; i < this.n; i++) {
            const fnc = this.fnOfCh[i];
            if (fnc !== null && fnc !== 'arm') continue;
            const x = this.v[i];
            // a value far from the level counts once it has lasted ARM_FAR_MS: one glitch sample
            // on a pot must not become a flip (a person's OFF-ON flick stays away far longer)
            const far = !Number.isNaN(this.lvl[i]) && Math.abs(x - this.lvl[i]) >= T.ARM_JUMP;
            if (!far) this.farT[i] = NaN;
            else if (Number.isNaN(this.farT[i])) this.farT[i] = this.now;
            const lasted = !far || this.now - this.farT[i] >= T.ARM_FAR_MS;
            if (lasted && !Number.isNaN(this.lvl[i]) && !(Math.abs(this.farV[i] - this.lvl[i]) >= Math.abs(x - this.lvl[i]))) this.farV[i] = x;
            if (this.stillMs(i) >= T.ARM_LEVEL_MS) {
                const m = this.stillMean(i);
                if (Number.isNaN(this.lvl[i])) { this.lvl[i] = m; this.lvlSince[i] = this.stillSince[i]; }
                else if (Math.abs(m - this.lvl[i]) >= T.ARM_JUMP) {
                    this.prevLvl[i] = this.lvl[i]; this.lvl[i] = m; this.lvlSince[i] = this.stillSince[i]; this.lvlChanged[i] = 1;
                } else if (Math.abs(this.farV[i] - this.lvl[i]) >= T.ARM_JUMP) {
                    // away and straight back, too fast to settle there (a switch that was already
                    // ON, flipped OFF and ON again): the far end is the OFF level
                    this.prevLvl[i] = this.farV[i]; this.lvl[i] = m; this.lvlSince[i] = this.stillSince[i]; this.lvlChanged[i] = 1;
                } else this.lvl[i] = m;
                this.farV[i] = m;
            }
            const e = Number.isNaN(this.lvl[i]) ? 0 : Math.abs(this.v[i] - this.lvl[i]);
            if (e > this.maxExc[i]) this.maxExc[i] = e;
        }
    }

    private evalArmOn(t: number): void {
        this.armLevels();
        const st = this.state;
        let best = 0;
        for (let i = 0; i < this.n; i++) {
            const fnc = this.fnOfCh[i];
            if ((fnc !== null && fnc !== 'arm') || !this.lvlChanged[i]) continue;
            // still at that level right now (a flip back just now is not "held")
            if (this.stillMs(i) < T.ARM_LEVEL_MS) continue;
            const held = t - this.lvlSince[i];
            if (held >= T.ARM_ON_HOLD_MS) {
                this.arm.armCh = i; this.arm.onLvl = this.lvl[i]; this.arm.offLvl = this.prevLvl[i];
                st.armSource = { kind: 'ch', n: i + 1 };
                this.succeed('arm', 'off');
                return;
            }
            best = Math.max(best, held / T.ARM_ON_HOLD_MS);
        }
        for (let b = 0; b < NBITS; b++) {
            if (!this.bitChanged[b]) continue;
            // back at an idle 0 after a press is a tap, not a latching switch
            if (this.bitVal[b] === 0 && this.bitBase[b] === 0) continue;
            const held = t - this.bitSince[b];
            if (held >= T.ARM_ON_HOLD_MS) {
                this.arm.armBit = b; this.arm.onVal = this.bitVal[b];
                st.armSource = { kind: 'button', n: b + 1 };
                this.succeed('arm', 'off');
                return;
            }
            best = Math.max(best, held / T.ARM_ON_HOLD_MS);
        }
        if (this.tapBit >= 0 && this.bitVal[this.tapBit] === 0) {
            this.arm.armBit = this.tapBit;
            this.arm.map = { kind: 'button', bit: this.tapBit, toggle: true };
            st.armSource = { kind: 'button', n: this.tapBit + 1 };
            this.succeed('check', null);
            return;
        }
        st.hold = st.progress = Math.min(1, best);
    }

    private armFromLevels(): ArmMap | null {
        const a = this.arm;
        // threshold 3/4 of the way to ON, not half way: a 3-position switch then reads OFF in its
        // middle position instead of sitting exactly on the threshold
        if (a.armCh >= 0) {
            // a still level seen beyond ON (by half a jump) is the far end of a 3-position switch:
            // its middle was taken as ON because the person paused there on the way. The far end
            // is ON, so the middle reads OFF.
            let on = a.onLvl;
            const far = on > a.offLvl ? this.seenHi[a.armCh] : this.seenLo[a.armCh];
            if (Math.abs(far - a.offLvl) >= Math.abs(on - a.offLvl) + T.ARM_JUMP / 2) on = far;
            return { kind: 'axis', index: a.armCh, threshold: a.offLvl + 0.75 * (on - a.offLvl), onAbove: on > a.offLvl, off: a.offLvl, on };
        }
        if (a.armBit >= 0) return a.onVal === 0 ? { kind: 'button', bit: a.armBit, inverted: true } : { kind: 'button', bit: a.armBit };
        return null;
    }

    /**
     * On entering the check from "Now flip it OFF": if the arm input reads ON, the two levels were
     * swapped, and they are swapped back. It happens with a switch that was ON already (left ON
     * after the stir, or at power-up): the person cycles it OFF -> ON, the OFF pause reaches
     * ARM_ON_HOLD_MS and is taken as ON, and their own flip back ON is then taken as OFF. Only a
     * flip that lands before the check opens is seen here; the check screen shows the live state.
     * (Measured dead end: SWAPPING on a return within 250 ms of the OFF screen flipped fast
     * responders the wrong way. evalArmOff only waits for the next move when the return lands
     * within ARM_REACT_MS, it never decides on the timing alone.)
     */
    private fixArmPolarity(): void {
        const a = this.arm;
        const m = a.map;
        if (!m || m.kind === 'key' || (m.kind === 'button' && m.toggle)) return;
        let on: boolean;
        if (m.kind === 'axis') {
            if (m.index >= this.n) return;
            const v = this.v[m.index];
            on = m.onAbove ? v > m.threshold : v < m.threshold;
        } else on = this.bitVal[m.bit] === a.onVal;
        if (!on) return;
        if (m.kind === 'axis') { const x = a.onLvl; a.onLvl = a.offLvl; a.offLvl = x; }
        else a.onVal = a.onVal ? 0 : 1;
        a.map = this.armFromLevels();
    }

    private evalArmOff(): void {
        const a = this.arm;
        const st = this.state;
        // Back at "OFF" before "Now flip it OFF" was on screen (during the check mark), or within
        // ARM_REACT_MS of it (nobody reads a new screen and flips that fast), is not an answer to
        // it. A switch that was already ON gets cycled OFF -> ON by its owner: the OFF pause was
        // taken as ON and this return is their own flip back ON. So wait for a move after that:
        // settling on the level taken as ON means that one is really OFF (swap); settling back
        // here keeps the levels. Someone who reads the screen first is never held up. Back before
        // the screen: wait however long. Within ARM_REACT_MS after it (also a robot or a script
        // answering at once): wait only up to ARM_SOON_WAIT_MS, then the levels stand.
        if (this.phaseFirst) { this.offEarly = false; this.offMoved = false; }
        const soon = this.phaseT0 + T.ARM_REACT_MS;
        if (a.armCh >= 0) {
            const c = a.armCh;
            if (!this.offEarly && Math.abs(this.v[c] - a.offLvl) <= T.ARM_OFF_TOL && this.stillSince[c] <= soon) { this.offEarly = true; this.offEarlyT = this.stillSince[c]; }
            if (this.offEarly) {
                if (Math.abs(this.v[c] - a.offLvl) >= T.ARM_JUMP / 2) this.offMoved = true;
                if (this.offWait()) { st.hold = st.progress = 0; return; }
                if (this.offMoved && Math.abs(this.stillMean(c) - a.onLvl) <= T.ARM_OFF_TOL && this.stillInPhase(c) >= T.ARM_OFF_HOLD_MS) {
                    const x = a.onLvl; a.onLvl = a.offLvl; a.offLvl = x;
                    a.map = this.armFromLevels();
                    this.succeed('check', null);
                    return;
                }
            }
            const back = Math.abs(this.stillMean(c) - a.offLvl) <= T.ARM_OFF_TOL;
            const s = back ? this.stillInPhase(c) : 0;
            st.hold = st.progress = Math.min(1, s / T.ARM_OFF_HOLD_MS);
            if (back && s >= T.ARM_OFF_HOLD_MS) { a.map = this.armFromLevels(); this.succeed('check', null); }
        } else if (a.armBit >= 0) {
            const b = a.armBit;
            const off = this.bitVal[b] !== a.onVal;
            // pressed from idle and let go before "Now flip it OFF" could be read: held, not
            // latched. A momentary button pressed long on "Flip ON" (as a level it would have to
            // be held all flight)
            if (off && a.onVal === 1 && this.bitBase[b] === 0 && this.bitSince[b] <= soon) {
                a.map = { kind: 'button', bit: b, toggle: true };
                this.succeed('check', null);
                return;
            }
            if (!this.offEarly && off && this.bitSince[b] <= soon) { this.offEarly = true; this.offEarlyT = this.bitSince[b]; }
            if (this.offEarly) {
                if (this.bitSince[b] > this.offEarlyT) this.offMoved = true;
                if (this.offWait()) { st.hold = st.progress = 0; return; }
                if (this.offMoved && !off && this.now - this.bitSince[b] >= T.ARM_OFF_HOLD_MS) {
                    a.onVal = a.onVal ? 0 : 1;
                    a.map = this.armFromLevels();
                    this.succeed('check', null);
                    return;
                }
            }
            const s = off ? this.now - Math.max(this.bitSince[b], this.phaseT0) : 0;
            st.hold = st.progress = Math.min(1, s / T.ARM_OFF_HOLD_MS);
            if (off && s >= T.ARM_OFF_HOLD_MS) { a.map = this.armFromLevels(); this.succeed('check', null); }
        }
    }

    /** Arm off, back at OFF too early to be an answer: still waiting for the next move? */
    private offWait(): boolean {
        return !this.offMoved && (this.offEarlyT <= this.phaseT0 || this.now - this.phaseT0 < T.ARM_SOON_WAIT_MS);
    }

    private buildProfile(): Profile {
        const axes = {} as Record<Fn, AxisMap>;
        for (const fn of FNS) {
            const a = this.assigned[fn];
            if (!a) continue;
            const c = a.index;
            let min = c < this.n ? this.mins[c] : a.min;
            let max = c < this.n ? this.maxs[c] : a.max;
            if (fn !== 'throttle') {
                // gimbals travel as far each way: a side seen less than half as far as the other
                // was never explored (Continue before a full stir), and its short half would turn
                // a nudge into full deflection. Mirror the explored side.
                const up = max - a.center, dn = a.center - min;
                if (dn < T.RANGE_ONE_SIDED * up) min = a.center - up;
                else if (up < T.RANGE_ONE_SIDED * dn) max = a.center + dn;
            }
            axes[fn] = fn === 'throttle'
                ? { index: c, invert: a.invert, center: a.invert ? max : min, min, max }
                : { index: c, invert: a.invert, center: a.center, min, max };
        }
        return {
            version: 1,
            deviceKey: this.deviceKey,
            deviceName: this.deviceName,
            axes,
            arm: copyArm(this.arm.map),
            angleMode: null,
            deadband: 0,
            created: new Date().toISOString(),
            wizard: 2
        };
    }

    // ------------------------------------------------------------------ live values, hints, escapes

    private live(f: RawFrame): void {
        const st = this.state;
        const ch = st.channels;
        for (let i = 0; i < this.n; i++) {
            const c = ch[i];
            c.v = this.v[i];
            c.lo = this.mins[i];
            c.hi = this.maxs[i];
            c.cover = (this.maxs[i] - this.mins[i]) / 2;
            c.kind = this.kinds[i];
            c.fn = this.fnOfCh[i];
            c.still = this.stillMs(i) >= LIVE_STILL_MS;
        }
        const m = st.mapped;
        const p = st.profile;
        if (this.id === 'check' && p) {
            const out = mapFrame(p, f, this.mapOut);
            m.roll = out[0]; m.pitch = out[1]; m.throttle = out[2]; m.yaw = out[3];
            const a = p.arm;
            const level = a && (a.kind === 'axis' || (a.kind === 'button' && !a.toggle));
            m.arm = level ? armOn(a, f) : null;
            const u = (out[2] + 1) / 2;
            const cks = st.checks ?? (st.checks = { throttleLow: false, armOn: null, centred: false });
            cks.throttleLow = u <= 0.05;
            cks.armOn = m.arm;
            cks.centred = Math.abs(out[0]) <= 0.1 && Math.abs(out[1]) <= 0.1 && Math.abs(out[3]) <= 0.1;
            return;
        }
        m.roll = this.mapLive('roll');
        m.pitch = this.mapLive('pitch');
        m.yaw = this.mapLive('yaw');
        const th = this.assigned.throttle;
        if (th && th.index < this.n) {
            const c = th.index;
            let u = (this.v[c] - this.mins[c]) / Math.max(1e-6, this.maxs[c] - this.mins[c]);
            if (th.invert) u = 1 - u;
            u = u < 0 ? 0 : u > 1 ? 1 : u;
            m.throttle = u * 2 - 1;
        } else m.throttle = NaN;
        const a = this.arm;
        if (a.armCh >= 0 && a.armCh < this.n && !Number.isNaN(a.offLvl)) {
            const thr = (a.onLvl + a.offLvl) / 2;
            m.arm = a.onLvl > a.offLvl ? this.v[a.armCh] > thr : this.v[a.armCh] < thr;
        } else if (a.armBit >= 0 && !(a.map && a.map.kind === 'button' && a.map.toggle)) m.arm = this.bitVal[a.armBit] === a.onVal;
        else m.arm = null;
    }

    private mapLive(fn: Fn): number {
        const a = this.assigned[fn];
        if (!a || a.index >= this.n) return NaN;
        const c = a.index;
        const x = this.v[c] - a.center;
        const half = x >= 0 ? this.maxs[c] - a.center : a.center - this.mins[c];
        let r = half > 1e-6 ? x / half : 0;
        r = r < -1 ? -1 : r > 1 ? 1 : r;
        return a.invert ? -r : r;
    }

    private setHint(key: string | null, k1?: string, v1?: string | number, k2?: string, v2?: string | number): void {
        const st = this.state;
        const cur = st.hint ? st.hint.key : null;
        // a shown hint stays a moment: a text that flickers with the noise cannot be read (and a
        // screen reader would repeat it)
        if (key !== cur && cur !== null && this.now - this.hintAt < T.HINT_MIN_MS) return;
        if (key === null) { st.hint = null; st.error = null; return; }
        let h = st.hint;
        if (!h || key !== cur) { h = st.hint = { key, params: {} }; st.error = key; this.hintAt = this.now; }
        const p = h.params;
        if (k1 !== undefined && v1 !== undefined) p[k1] = v1;
        if (k2 !== undefined && v2 !== undefined) p[k2] = v2;
    }

    private timers(): void {
        const st = this.state;
        const stuck = this.now - this.stuckT0;
        st.stuckMs = stuck;
        const c = st.can;
        c.back = c.cont = c.useCurrent = c.pick = c.skipArm = c.fly = c.reverse = false;
        if (this.ok) { c.back = this.trail.length >= 1; st.hint = null; st.error = null; return; }
        const id = this.id;
        switch (id) {
            case 'connect':
                this.setHint(stuck >= T.CONNECT_HINT_MS && this.n === 0 ? 'wizard.hint.noData' : null);
                break;
            case 'stir':
                // after 12 s always a way on: with fewer than four sticks, Continue lets every
                // channel through and the stick steps find them (see cont)
                c.cont = stuck >= T.STIR_HINT_MS;
                if (stuck >= T.STIR_HINT_MS) this.stirHint(); else this.setHint(null);
                break;
            case 'centre': {
                c.back = this.trail.length >= 2;
                c.useCurrent = stuck >= T.CENTRE_ESCAPE_MS;
                if (stuck >= T.CENTRE_HINT_MS) {
                    let worst = this.endCh, least = Infinity; // a stick held at its end first: it is what blocks
                    if (worst < 0) for (const i of this.stickSet) { const s = this.stillInPhase(i); if (s < least) { least = s; worst = i; } }
                    this.setHint(worst >= 0 ? 'wizard.hint.centre.moving' : null, 'ch', worst + 1);
                } else this.setHint(null);
                break;
            }
            case 'throttle': case 'yaw': case 'pitch': case 'roll':
                c.back = this.trail.length >= 2;
                if (this.phase === 'push') { c.pick = stuck >= T.PUSH_ESCAPE_MS; this.pushHint(stuck); }
                else if (id === 'throttle') {
                    c.cont = stuck >= T.RELEASE_ESCAPE_MS;
                    if (stuck >= T.RELEASE_HINT_MS && this.n > 0) {
                        const a = this.assigned.throttle!;
                        const i = a.index;
                        const down = a.invert ? this.maxs[i] : this.mins[i];
                        const up = a.invert ? this.mins[i] : this.maxs[i];
                        const pct = Math.round((100 * (this.v[i] - down)) / (up - down || 1));
                        this.setHint('wizard.hint.throttle.down', 'pct', pct);
                    } else this.setHint(null);
                } else {
                    c.useCurrent = stuck >= T.RELEASE_ESCAPE_MS;
                    if (stuck >= T.RELEASE_HINT_MS && this.n > 0) {
                        const i = this.assigned[id]!.index;
                        if (this.stillMs(i) < T.RELEASE_HOLD_MS) this.setHint('wizard.hint.release.moving');
                        else this.setHint('wizard.hint.release.off', 'fn', id, 'pct', Math.round(Math.abs(this.dm(i)) * 100));
                    } else this.setHint(null);
                }
                break;
            case 'arm':
                c.back = this.trail.length >= 2;
                c.skipArm = true;
                if (this.phase === 'on') {
                    if (stuck >= T.ARM_HINT_MS) {
                        let small = -1;
                        for (let i = 0; i < this.n; i++) {
                            const fnc = this.fnOfCh[i];
                            if (fnc !== null && fnc !== 'arm') continue;
                            if (this.maxExc[i] >= T.ARM_SMALL && this.maxExc[i] < T.ARM_JUMP) { small = i; break; }
                        }
                        if (small >= 0) this.setHint('wizard.hint.arm.small', 'ch', small + 1);
                        else this.setHint('wizard.hint.arm.none');
                    } else this.setHint(null);
                } else {
                    c.cont = stuck >= T.ARM_OFF_ESCAPE_MS;
                    this.setHint(stuck >= T.ARM_OFF_HINT_MS ? 'wizard.hint.arm.back' : null);
                }
                break;
            case 'check': {
                c.back = this.trail.length >= 2;
                c.fly = true;
                c.reverse = true;
                const p = st.profile;
                const th = p?.axes.throttle;
                if (th && th.index < this.n && !Number.isNaN(st.mapped.throttle)) {
                    const u = (st.mapped.throttle + 1) / 2;
                    if (u >= 0.95 && this.stillMs(th.index) >= T.CHECK_SUSPECT_MS) this.setHint('wizard.hint.check.throttle', 'pct', Math.round(u * 100));
                    else this.setHint(null);
                } else this.setHint(null);
                break;
            }
        }
    }

    private stirHint(): void {
        let moving = 0, sticks = 0, part = -1, partSpan = 0;
        for (let i = 0; i < this.n; i++) {
            const span = this.maxs[i] - this.mins[i];
            if (span >= T.MOVING_SPAN) moving++;
            if (this.kinds[i] === 'stick') sticks++;
            else if (this.kinds[i] === 'idle' && span >= T.MOVING_SPAN && span > partSpan) { partSpan = span; part = i; }
        }
        // fewer than four channels move at all: the text asks about USB Joystick mode
        if (moving < 4) { this.setHint('wizard.hint.stir.few', 'n', moving); return; }
        if (sticks < 4) {
            // they do move, just not like sticks yet: no word about USB mode. A channel swept part
            // of the way is most likely the missing stick (say how far it got); else ask for the
            // full travel in every direction (only jumps between a few points so far)
            if (part >= 0) this.setHint('wizard.hint.stir.coverage', 'ch', part + 1, 'pct', Math.round((partSpan / 2) * 100));
            else this.setHint('wizard.needFourAxes');
            return;
        }
        // among the four widest sticks, the one furthest from its ends
        const idx: number[] = [];
        for (let i = 0; i < this.n; i++) if (this.kinds[i] === 'stick') idx.push(i);
        idx.sort((a, b) => (this.maxs[b] - this.mins[b]) - (this.maxs[a] - this.mins[a]));
        let low = -1, lowCover = Infinity;
        for (const i of idx.slice(0, 4)) { const cv = (this.maxs[i] - this.mins[i]) / 2; if (cv < lowCover) { lowCover = cv; low = i; } }
        if (low < 0 || lowCover >= T.STIR_COVER) { this.setHint(null); return; }
        this.setHint('wizard.hint.stir.coverage', 'ch', low + 1, 'pct', Math.round(lowCover * 100));
    }

    private pushHint(stuck: number): void {
        if (this.takenCh >= 0) {
            const fnc = this.fnOfCh[this.takenCh];
            if (fnc && fnc !== 'arm') { this.setHint('wizard.hint.push.taken', 'fn', fnc); return; }
        }
        if (stuck < T.PUSH_HINT_MS) { this.setHint(null); return; }
        const fn = FNS[this.fnIdx];
        if (fn === 'throttle') {
            // a stick that has not come from the middle: pushed before the screen changed, or
            // pushed from half way (the throttle does not spring back)
            for (const j of this.free) {
                if (this.armedP[j]) continue;
                if (this.startHigh[j] || Math.abs(this.dm(j)) >= T.ARRIVE_FROM) { this.setHint('wizard.hint.throttle.already'); return; }
            }
        }
        if (this.now - this.twoT <= TWO_WINDOW_MS && this.twoA >= 0 && this.twoB >= 0) {
            this.setHint('wizard.hint.push.two', 'a', this.twoA + 1, 'b', this.twoB + 1);
            return;
        }
        this.setHint(this.maxLead >= 0.3 ? 'wizard.hint.push.short' : 'wizard.hint.push.none');
    }
}

/** Channel order of a profile as a string like "AETR" (roll=A, pitch=E, throttle=T, yaw=R). */
export function channelOrder(p: Profile): string {
    const letters: Record<Fn, string> = { roll: 'A', pitch: 'E', throttle: 'T', yaw: 'R' };
    return (Object.entries(p.axes) as [Fn, AxisMap][]).sort((a, b) => a[1].index - b[1].index).map(([fn]) => letters[fn]).join('');
}

/** Map a raw frame through a profile to channels ch[0..5] (roll, pitch, throttle, yaw, arm, mode). */
export function mapFrame(p: Profile, f: RawFrame, out: Float32Array): Float32Array {
    for (const fn of ['roll', 'pitch', 'yaw'] as Fn[]) {
        const a = p.axes[fn];
        const v = f.axes[a.index] - a.center;
        const half = v >= 0 ? a.max - a.center : a.center - a.min;
        let x = half > 1e-6 ? v / half : 0;
        if (Math.abs(x) < p.deadband) x = 0;
        x = x < -1 ? -1 : x > 1 ? 1 : x;
        if (a.invert) x = -x;
        out[fn === 'roll' ? 0 : fn === 'pitch' ? 1 : 3] = x;
    }
    const th = p.axes.throttle;
    let u = (f.axes[th.index] - th.min) / Math.max(1e-6, th.max - th.min);
    if (th.invert) u = 1 - u;
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    out[2] = u * 2 - 1;
    out[4] = armOn(p.arm, f) ? 1 : -1;
    out[5] = p.angleMode && armOn(p.angleMode, f) ? 1 : -1;
    return out;
}

/** Raw arm input level. A key arm is never on here (ArmLatch holds it); a button honours `inverted`. */
export function armOn(a: ArmMap | null, f: RawFrame): boolean {
    if (!a || a.kind === 'key') return false;
    if (a.kind === 'button') {
        const on = ((f.buttons >> a.bit) & 1) === 1;
        return a.inverted ? !on : on;
    }
    const v = f.axes[a.index];
    return a.onAbove ? v > a.threshold : v < a.threshold;
}

/** Arm level from the profile's arm input; momentary buttons and the keyboard arm latch here. */
export class ArmLatch {
    on = false;
    private prevPressed = false;

    level(arm: ArmMap | null, f: RawFrame | null): boolean {
        if (!arm) return false;
        if (arm.kind === 'key') return this.on;
        if (arm.kind === 'button' && arm.toggle) {
            // each press edge flips the latch; holding the button does nothing more
            const pressed = f ? ((f.buttons >> arm.bit) & 1) === 1 : this.prevPressed;
            if (pressed && !this.prevPressed) this.on = !this.on;
            this.prevPressed = pressed;
            return this.on;
        }
        return f ? armOn(arm, f) : false;
    }

    toggle(): void {
        this.on = !this.on;
    }

    reset(): void {
        this.on = false;
    }
}

// -------------------------------------------------------------- arm gate

export type ArmBlock = null | 'noProfile' | 'center' | 'throttle' | 'switch' | 'stale' | 'hidden' | 'crashed';

/**
 * Arm only when: a profile exists; every stick passed through its centre since load (protects
 * against the Chromium gamepad trap where an axis reports 0.0 until first moved); throttle <= 5 %;
 * the arm switch goes off -> on; not crashed; the last sample is <= 100 ms old; the tab is visible.
 */
export class ArmGate {
    private passedCenter: Record<string, boolean> = { roll: false, pitch: false, yaw: false };
    private prevArm = true; // switch must be seen OFF first
    armed = false;
    block: ArmBlock = 'noProfile';

    update(p: Profile | null, ch: Float32Array, lastSampleAgeMs: number, visible: boolean, crashed: boolean): number {
        if (!p) { this.block = 'noProfile'; return this.out(false); }
        for (const [k, i] of [['roll', 0], ['pitch', 1], ['yaw', 3]] as const) if (Math.abs(ch[i]) < 0.1) this.passedCenter[k] = true;
        const sw = ch[4] > 0;
        const rising = sw && !this.prevArm;
        this.prevArm = sw;
        if (!sw) { this.armed = false; }
        if (lastSampleAgeMs > 100) { this.block = 'stale'; this.armed = false; return this.out(false); }
        if (!visible) { this.block = 'hidden'; this.armed = false; return this.out(false); }
        if (crashed) { this.block = 'crashed'; this.armed = false; return this.out(false); }
        if (this.armed) { this.block = null; return this.out(true); }
        if (!Object.values(this.passedCenter).every(Boolean)) { this.block = 'center'; return this.out(false); }
        if ((ch[2] + 1) / 2 > 0.05) { this.block = 'throttle'; return this.out(false); }
        if (!rising) { this.block = 'switch'; return this.out(false); }
        this.armed = true;
        this.block = null;
        return this.out(true);
    }

    private out(on: boolean): number {
        return on ? 1 : -1;
    }
}
