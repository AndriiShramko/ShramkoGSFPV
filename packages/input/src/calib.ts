// Calibration wizard core (no DOM): turns raw device frames into a profile that maps the
// device's axes and buttons onto roll / pitch / throttle / yaw / arm. The UI only shows what the
// state says, feeds frames in and calls the commands its buttons stand for; every decision is
// made here, so simulated people can test it.
//
// Raw frames: axes normalised to [-1, 1] (HID 0..2048 -> -1..1, gamepad as is), buttons bitmask.
//
// Wizard v3 (2026-09-26), user-paced. v2 advanced by itself: a screen ended once the sticks were
// still for a moment, a push counted from the middle of the stirred range (a throttle parked mid
// needed 20 % of its travel), and a throttle resting at an end became "up" after 2 s. On a real
// radio the pilot could not keep up. Here nothing advances unless the pilot presses a button:
// every step is ready -> active -> done, Start opens the measurement, Next leaves the result.
// The only changes a frame makes on its own: the first frame (connect -> stir/ready), an accepted
// push (fn active -> done) and an accepted arm flip (arm active -> done). A push counts only at
// >= 70 % of the way from where the stick rested to its end, held 400 ms; nothing is ever taken
// because time passed. Times are ms of the frame clock (radios send 125..1000 reports/s). The
// TUNING numbers come from the rules, QGroundControl's thresholds and a model of people
// (sim/human.ts); they are NOT measured on a real radio.

export type Fn = 'roll' | 'pitch' | 'throttle' | 'yaw';
export const FNS: Fn[] = ['throttle', 'yaw', 'pitch', 'roll']; // prompt order: left stick first in Mode 2

export type StepId = 'connect' | 'stir' | 'centre' | 'throttle' | 'yaw' | 'pitch' | 'roll' | 'arm' | 'check';
export const STEP_IDS: StepId[] = ['connect', 'stir', 'centre', 'throttle', 'yaw', 'pitch', 'roll', 'arm', 'check'];
export type Stage = 'ready' | 'active' | 'done';
export type Dir = 'up' | 'down' | 'right' | 'centre' | 'stir' | 'on' | 'off' | 'flip';
export type Zone = 'rest' | 'tiny' | 'almost' | 'enough' | 'two';

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
    wizard?: number; // 2 = made by wizard v2 or v3 (main.ts resumes these); absent = made by the first one
}

/** Legacy step number (main.ts, accept-fly): connect/stir 1, centre 2, sticks 3, arm 5, check 6. */
export type Step = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface Hint { key: string; params: Record<string, string | number> }
export type ChannelKind = 'stick' | 'switch' | 'idle';
export interface ChannelLive { v: number; lo: number; hi: number; cover: number; kind: ChannelKind; fn: Fn | 'arm' | null; still: boolean }
export type ArmSource = { kind: 'ch'; n: number } | { kind: 'button'; n: number } | { kind: 'key' }; // n is 1-based
export interface Gauge { ch: number; frac: number; sign: 1 | -1 | 0; zone: Zone; held: number; other: number } // other: 2nd channel for 'two', else -1
/** arm/active: the switch seen so far. 'on' = it is ON, the ring fills while it stays; 'off' = ON counted, now back OFF. */
export interface ArmFlip { src: ArmSource; phase: 'on' | 'off'; held: number; level: number }
export type StepResult =
    | { kind: 'stir'; sticks: number[]; switches: number[]; short: number[] }
    | { kind: 'centre'; centres: { ch: number; pct: number }[]; end: number }
    | { kind: 'fn'; fn: Fn; ch: number; invert: boolean }
    | { kind: 'arm'; source: ArmSource };
export type Verdict = { ok: true } | { ok: false; hint: Hint };
export interface Can {
    begin: boolean; next: boolean; back: boolean; skipArm: boolean; pick: boolean;
    measureAnyway: boolean; reverse: boolean; redo: boolean; fly: boolean;
}

export interface WizardState {
    // legacy, read by main.ts, accept-fly B10/B11, smoke-ui: same meaning as in v2
    step: Step;
    prompt: Fn | null; // the fn of a stick step
    message: string; // i18n key of the say line: wizard.say.<id>.<stage> (connect, check: wizard.say.<id>)
    progress: number; // = hold
    error: string | null; // = hint?.key ?? null
    profile: Profile | null; // check only
    // v3
    id: StepId;
    stage: Stage | null; // null on connect and check
    target: { what: Fn | 'arm' | 'sticks'; dir: Dir } | null; // what the drawing animates
    preview: boolean; // ready stage showing the coming move (dimmed ghost)
    gauge: Gauge | null; // fn/active only
    hold: number; // gauge.held (fn/active), armFlip.held (arm/active), else 0
    armFlip: ArmFlip | null; // arm/active only
    picked: number | null; // the channel listened to after pick() (fn/active, arm), else null
    result: StepResult | null; // done stage only
    redoing: boolean;
    hint: Hint | null;
    can: Can;
    stuckMs: number; // ms in this stage (hint timers only)
    cmds: number; // count of accepted commands (tests pair every stage change with it)
    channels: ChannelLive[]; // length nAxes (0 until the first frame)
    mapped: { roll: number; pitch: number; throttle: number; yaw: number; arm: boolean | null }; // NaN = unknown
    assigned: Partial<Record<Fn, number>>; // channel index per function so far
    inverted: Partial<Record<Fn, boolean>>;
    armSource: ArmSource | null;
    sticksDone: number; // stir: stick channels with cover >= STIR_COVER
    checks: { throttleLow: boolean; armOn: boolean | null; centred: boolean } | null; // check only
}

export const TUNING = {
    // stillness at a pilot's press (rule 3): QGC settle 20/1000 for 500 ms, on an 80 ms EMA
    STILL_TAU_MS: 80,
    STILL_TOL: 0.04,
    STILL_MS: 500,
    // where a stick rests, in halves of its range from the middle
    CENTRE_TOL: 0.15,
    END_TOL: 0.10,
    // the push (rule 2), in shares of the reach from the rest to the end
    PUSH_REST: 0.10,
    PUSH_TINY: 0.30,
    PUSH_ACCEPT: 0.70,
    PUSH_FLICK: 0.90,
    TWO_FRAC: 0.30,
    HOLD_MS: 400,
    REACH_MIN: 0.50,
    // stir (rule 4)
    STIR_COVER: 0.80,
    PLATEAU_MIN: 0.50,
    PLATEAU_TOL: 0.03,
    PLATEAU_AWAY: 0.30,
    PLATEAU_HITS: 3,
    // Next on the throttle result: the bar must read this low
    THR_DOWN_MAX: 0.10,
    MEASURE_ANYWAY_AFTER: 2, // refusals, a pilot's decision, not a timer
    // kept from v2
    STILL_P2P: 0.10,
    MOVING_SPAN: 0.30,
    SWITCH_SPAN: 0.50,
    STICK_SPAN: 1.00,
    OTHER_FRAC: 0.10,
    STIR_SWEEP_BINS: 10,
    // arm (Andrii 2026-09-26: "a weakly-noisy channel gets bound to arming as soon as the screen
    // appears"): only a real flip after Start, ON then back OFF, each level still ARM_LEVEL_MS, the
    // levels ARM_JUMP apart (50 % of -1..1 less EdgeTX's 0.999 top), every hop a jump (the biggest
    // single-report step >= ARM_STEP_FRAC of the hop: knobs, sliders, sticks sweep)
    ARM_JUMP: 0.95,
    ARM_STEP_FRAC: 0.40,
    ARM_PICK_JUMP: 0.30, // a channel the pilot picked by hand: a weight-limited switch, a slider
    ARM_SMALL: 0.15,
    ARM_LEVEL_MS: 300,
    ARM_FAR_MS: 20,
    RANGE_ONE_SIDED: 0.5,
    TAKEN_HOLD_MS: 400,
    CLASSIFY_EVERY_MS: 100,
    HINT_MIN_MS: 1500,
    CONNECT_HINT_MS: 3000,
    CHECK_SUSPECT_MS: 3000,
    // hint-only timers: a text or a button appears, nothing is taken
    STIR_HINT_MS: 8000,
    PUSH_HINT_MS: 5000,
    PUSH_PICK_MS: 8000,
    ARM_HINT_MS: 8000,
    ARM_BACK_HINT_MS: 5000 // "now flip it back OFF" and nothing moves: was it ON at Start?
} as const;

const T = TUNING;
const NB = 32; // stir histogram bins over [-1, 1]
const NBITS = 24;

interface Snap {
    assigned: Partial<Record<Fn, AxisMap>>;
    pushEnd: Partial<Record<Fn, number>>;
    rest: number[];
    arm: ArmMap | null;
    stickSet: number[];
    results: Partial<Record<StepId, StepResult>>;
}

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

/** A level arm input (reads ON or OFF by itself): an axis or a latching button. */
function isLevel(a: ArmMap | null): boolean {
    return !!a && (a.kind === 'axis' || (a.kind === 'button' && !a.toggle));
}

/** Reverse of an arm map, in place. */
function flipArmMap(a: ArmMap | null): void {
    if (!a || a.kind === 'key') return;
    if (a.kind === 'axis') {
        // the threshold sits 3/4 of the way to ON (a 3-position switch reads OFF in its middle);
        // flipping onAbove alone would move it to 1/4 and arm in the middle, so mirror it between
        // the two levels. Without levels (older profile) it is the midpoint, which mirrors onto itself.
        if (a.off !== undefined && a.on !== undefined) {
            a.threshold = a.off + a.on - a.threshold;
            const x = a.off; a.off = a.on; a.on = x;
        }
        a.onAbove = !a.onAbove;
    } else if (a.toggle) return;
    else if (a.inverted) delete a.inverted;
    else a.inverted = true;
}

function noCan(): Can {
    return { begin: false, next: false, back: false, skipArm: false, pick: false, measureAnyway: false, reverse: false, redo: false, fly: false };
}

function freshState(): WizardState {
    return {
        step: 0, prompt: null, message: 'wizard.say.connect', progress: 0, error: null, profile: null,
        id: 'connect', stage: null, target: null, preview: false, gauge: null, hold: 0, armFlip: null, picked: null, result: null, redoing: false,
        hint: null, can: noCan(), stuckMs: 0, cmds: 0,
        channels: [], mapped: { roll: NaN, pitch: NaN, throttle: NaN, yaw: NaN, arm: null }, assigned: {}, inverted: {},
        armSource: null, sticksDone: 0, checks: null
    };
}

const DISABLED: Verdict = { ok: false, hint: { key: 'wizard.hint.disabled', params: {} } };
const OK: Verdict = { ok: true };

export class CalibrationWizard {
    state: WizardState = freshState();
    private deviceKey: string;
    private deviceName: string;
    private started = false;
    private resumed: Profile | null = null;
    private keepProfile: Profile | null = null;
    private now = 0;
    private smT = NaN; // time of the last EMA / still-window update (frame, tick or command)
    private n = 0;
    // per channel, allocated once on the first frame
    private v = new Float64Array(0);
    private mins = new Float64Array(0);
    private maxs = new Float64Array(0);
    private rest = new Float64Array(0);
    private wMin = new Float64Array(0); // raw still window (arm levels)
    private wMax = new Float64Array(0);
    private wSum = new Float64Array(0);
    private wN = new Float64Array(0);
    private stillSince = new Float64Array(0);
    private sm = new Float64Array(0); // smoothed value (rule 3)
    private sMin = new Float64Array(0);
    private sMax = new Float64Array(0);
    private stillSince2 = new Float64Array(0);
    private hist = new Uint32Array(0);
    private histN = new Uint32Array(0);
    private kinds: ChannelKind[] = [];
    private fnOfCh: (Fn | 'arm' | null)[] = [];
    private hiRef = new Float64Array(0); // stir plateau: the extreme at the first hit, per side
    private loRef = new Float64Array(0);
    private hiHits = new Uint8Array(0);
    private loHits = new Uint8Array(0);
    private hiAway = new Uint8Array(0);
    private loAway = new Uint8Array(0);
    private base = new Float64Array(0); // push: where each free channel rested at Start
    private baseEnd = new Int8Array(0); // ... -1 / +1 when that was an end, else 0
    private belowP = new Uint8Array(0); // push: an assigned channel was near its rest in this stage
    private takenSince = new Float64Array(0);
    // arm, per axis channel, from Start on (nothing is measured before it)
    private cand = new Uint8Array(0); // a candidate: not a stick function, not stick-like in the stir (or picked)
    private L0 = new Float64Array(0); // the first still level after Start: OFF (the pilot was told to put it OFF)
    private lvl = new Float64Array(0); // the last still level
    private armSt = new Uint8Array(0); // 0 no level yet, 1 at OFF waiting for ON, 2 ON counted, waiting for OFF
    private onV = new Float64Array(0); // the ON level (the farthest one reached by a jump)
    private stepMax = new Float64Array(0); // biggest single-report step since the last still level
    private swept = new Uint8Array(0); // a hop here was a sweep (knob, slider): never an auto flip in this try
    private maxExc = new Float64Array(0);
    private awayT = new Float64Array(0); // since when the value is a jump away from L0 (NaN = not)
    private movedRefusals = new Uint8Array(0); // centre: Measure refused because this channel moved
    private fr: RawFrame = { t: 0, axes: new Float32Array(8), buttons: 0 };
    // buttons
    private lastButtons = 0;
    private bitVal = new Uint8Array(NBITS);
    private bitSince = new Float64Array(NBITS);
    private bitBase = new Uint8Array(NBITS);
    private pressT = new Float64Array(NBITS).fill(NaN); // arm: pressed (away from its base) since
    private relT = new Float64Array(NBITS).fill(NaN); // arm: back at its base since, after a press
    private bKind = new Uint8Array(NBITS); // arm: 1 = that press was a tap (toggle), 2 = held (level)
    private hintAt = 0;
    // flow
    private id: StepId = 'connect';
    private stage: Stage | null = null;
    private stageT0 = 0;
    private refHint: Hint | null = null; // the hint of a refused command, until the next command or stage
    private redoing = false;
    private redoSnap: Snap | null = null;
    private readySnap: Partial<Record<StepId, Snap>> = {};
    private results: Partial<Record<StepId, StepResult>> = {};
    // stir
    private lastClassifyT = -Infinity;
    private stirOk = false;
    private stickSet: number[] = [];
    // push
    private free: number[] = [];
    private restrict: number | null = null;
    private holdStart = NaN;
    private holdCh = -1;
    private holdSign = 0;
    private holdPeak = 0;
    private flicked = false;
    private inAttempt = false;
    private attemptPeak = 0;
    private lastPeak = 0;
    private everMoved = false;
    private twoA = -1;
    private twoB = -1;
    private takenCh = -1;
    private gauge: Gauge = { ch: -1, frac: 0, sign: 0, zone: 'rest', held: 0, other: -1 };
    // arm
    private wasOnCh = -1; // went over and straight back (a switch left ON at Start, or a flick): 0-based axis, or 100 + bit
    private sweptCh = -1;
    private backSince = NaN; // since when the screen says "now flip it back OFF"
    private flip: ArmFlip = { src: { kind: 'ch', n: 0 }, phase: 'on', held: 0, level: 0 };
    // result so far
    private assigned: Partial<Record<Fn, AxisMap>> = {};
    private pushEnd: Partial<Record<Fn, number>> = {};
    private armMap: ArmMap | null = null;
    private mapOut = new Float32Array(8);

    constructor(deviceKey: string, deviceName: string) {
        this.deviceKey = deviceKey;
        this.deviceName = deviceName;
    }

    /** Resume at the check with a saved profile: ranges seeded from it, so Set again works. */
    static resume(p: Profile): CalibrationWizard {
        const w = new CalibrationWizard(p.deviceKey, p.deviceName);
        w.resumed = p;
        w.started = true;
        w.assigned = copyAssigned(p.axes);
        w.armMap = copyArm(p.arm);
        w.keepProfile = p;
        w.go('check', null);
        return w;
    }

    /** Lifecycle: begin at connect (a resumed wizard stays at its check). */
    start(t: number): void {
        if (this.resumed) { this.now = Math.max(this.now, t); this.stageT0 = this.now; return; }
        const keepN = this.n;
        const keep = this.state.channels;
        const cmds = this.state.cmds;
        this.state = freshState();
        this.state.channels = keep;
        this.state.cmds = cmds;
        this.n = keepN;
        this.started = true;
        this.now = t;
        this.smT = NaN;
        this.assigned = {};
        this.pushEnd = {};
        this.armMap = null;
        this.results = {};
        this.readySnap = {};
        this.redoing = false;
        this.redoSnap = null;
        this.stickSet = [];
        this.go('connect', null);
        this.state.step = 1;
    }

    /** Measure. The only stage changes here: connect -> stir/ready, an accepted push, an accepted arm flip. */
    feed(f: RawFrame): WizardState {
        const st = this.state;
        if (!this.started) return st;
        const t = f.t > this.now ? f.t : this.now;
        this.now = t;
        if (this.n === 0) this.init(Math.min(8, f.axes.length), f, t);
        this.track(f, t);
        if (this.id === 'connect') this.go('stir', 'ready');
        this.evaluate(t);
        this.live();
        this.timers();
        return st;
    }

    /**
     * Timers and hints without frames. A pad that reports only changes (frozen Gamepad.timestamp)
     * sends nothing while still: the held values count on (sample and hold), so a push or a switch
     * held still is still taken here, as a frame would take it.
     */
    tick(t: number): WizardState {
        if (!this.started) return this.state;
        if (t > this.now) this.now = t;
        this.advance(this.now);
        if (this.n > 0 && this.id !== 'connect' && this.id !== 'check') this.evaluate(this.now);
        if (this.n > 0) this.live();
        this.timers();
        return this.state;
    }

    // ------------------------------------------------------------------ commands (the buttons)

    /** "Start" on a ready stage. */
    begin(t?: number): Verdict {
        this.cmdAt(t);
        if (this.stage !== 'ready') return DISABLED;
        const id = this.id;
        if (id === 'stir') {
            if (this.n === 0) return this.refuse('wizard.hint.noData', {});
            this.resetStir();
            return this.accept('stir', 'active');
        }
        if (id === 'centre') {
            this.movedRefusals.fill(0);
            return this.accept('centre', 'active');
        }
        if (isFn(id)) return this.beginPush(id);
        if (id === 'arm') return this.beginArm();
        return DISABLED;
    }

    /** "Done" (stir/active), "Measure" (centre/active), "Next" (every done stage). */
    next(t?: number): Verdict {
        this.cmdAt(t);
        const id = this.id;
        if (this.stage === 'active') {
            if (id === 'stir') return this.stirDone();
            if (id === 'centre') return this.measure(false);
            return DISABLED;
        }
        if (this.stage !== 'done') return DISABLED;
        if (isFn(id)) {
            const v = this.nextFn(id);
            if (!v.ok) return v;
        } else if (id === 'arm') {
            const m = this.armMap;
            if (isLevel(m) && armOn(m, this.frameNow())) return this.refuse('wizard.hint.next.armOn', {});
        }
        this.cmd();
        this.forward();
        return OK;
    }

    /** Back: active -> ready, done -> ready (its capture dropped), ready -> the previous result, check -> arm result. false = nothing before (the UI shows the device choice). */
    back(): boolean {
        const id = this.id;
        if (id === 'connect') return false;
        if (id === 'check') {
            if (!this.results.arm) return false; // a resumed profile: no steps behind it
            this.cmd();
            this.go('arm', 'done');
            return true;
        }
        if (this.stage === 'active') { this.cmd(); this.go(id, 'ready'); return true; }
        if (this.stage === 'done') {
            const s = this.readySnap[id];
            if (s) this.restore(s);
            delete this.results[id];
            this.cmd();
            this.go(id, 'ready');
            return true;
        }
        if (this.redoing && this.redoSnap) {
            this.restore(this.redoSnap);
            this.redoing = false;
            this.redoSnap = null;
            this.cmd();
            this.go('check', null);
            return true;
        }
        if (id === 'stir') return false;
        const prev = STEP_IDS[STEP_IDS.indexOf(id) - 1];
        if (!this.results[prev]) return false;
        this.cmd();
        this.go(prev, 'done');
        return true;
    }

    /** "Set again" on the check: that step once more, then back to the check. */
    redo(what: Fn | 'arm', t?: number): Verdict {
        this.cmdAt(t);
        if (this.id !== 'check') return DISABLED;
        if (this.n === 0) return this.refuse('wizard.hint.noData', {});
        this.redoSnap = this.snap();
        if (what === 'arm') this.armMap = null;
        else { delete this.assigned[what]; delete this.pushEnd[what]; }
        delete this.results[what];
        this.redoing = true;
        this.readySnap[what] = this.snap();
        return this.accept(what, 'ready');
    }

    /** No arm switch: arm with Space / the on-screen button (every arm stage). */
    skipArm(t?: number): Verdict {
        this.cmdAt(t);
        if (this.id !== 'arm' || this.stage === null) return DISABLED;
        this.armMap = { kind: 'key' };
        this.results.arm = { kind: 'arm', source: { kind: 'key' } };
        return this.accept('arm', 'done');
    }

    /**
     * fn/active: listen to this free channel only; the push is still needed. Arm (ready, active,
     * done: Liftoff's clickable dots): listen to this channel only, from now; the flip ON and back
     * OFF is still needed, with a smaller hop (ARM_PICK_JUMP) and no switch-shape test.
     */
    pick(ch: number, t?: number): Verdict {
        this.cmdAt(t);
        if (this.id === 'arm' && this.stage !== null) {
            if (!this.freeChannels().includes(ch)) return DISABLED;
            if (this.stage === 'done') { const s = this.readySnap.arm; if (s) this.restore(s); delete this.results.arm; }
            this.cmd();
            this.go('arm', 'active');
            this.restrict = ch;
            this.state.picked = ch;
            this.armReset();
            this.timers();
            return OK;
        }
        if (!isFn(this.id) || this.stage !== 'active') return DISABLED;
        if (!this.freeChannels().includes(ch)) return DISABLED;
        this.restrict = ch;
        this.state.picked = ch;
        this.free = [ch];
        this.resetPush();
        this.stageT0 = this.now;
        this.cmd();
        this.timers();
        return OK;
    }

    /** centre/active after MEASURE_ANYWAY_AFTER refusals for a moving stick: take it as it is. */
    measureAnyway(t?: number): Verdict {
        this.cmdAt(t);
        if (this.id !== 'centre' || this.stage !== 'active' || !this.canMeasureAnyway()) return DISABLED;
        return this.measure(true);
    }

    /** Reverse: fn/done and arm/done (that line), check (any line). */
    reverse(what: Fn | 'arm'): void {
        const id = this.id;
        const onCheck = id === 'check';
        if (!onCheck && !(this.stage === 'done' && id === what)) return;
        if (what === 'arm') {
            if (!isLevel(this.armMap)) return;
            flipArmMap(this.armMap);
            if (onCheck && this.state.profile) flipArmMap(this.state.profile.arm);
        } else {
            const a = this.assigned[what];
            if (!a) return;
            a.invert = !a.invert;
            if (what === 'throttle') a.center = a.invert ? a.max : a.min;
            const r = this.results[what];
            if (r && r.kind === 'fn') this.results[what] = { ...r, invert: a.invert };
            const p = this.state.profile;
            if (onCheck && p && p.axes[what]) {
                const pa = p.axes[what];
                pa.invert = a.invert;
                if (what === 'throttle') pa.center = pa.invert ? pa.max : pa.min;
            }
        }
        this.cmd();
        this.fnFromAssigned();
        if (this.stage === 'done') this.state.result = this.results[id] ?? null;
        if (this.n > 0) this.live();
        this.timers();
    }

    /** fn ready/active: the channels that may still become this function; arm stages: every channel not set to a stick function (the pick lists). */
    freeChannels(): number[] {
        if (this.id === 'arm' && this.stage !== null) {
            const used = this.usedChannels(null);
            const out: number[] = [];
            for (let i = 0; i < this.n; i++) if (!used.has(i)) out.push(i);
            return out;
        }
        if (!isFn(this.id) || this.stage === 'done' || this.stage === null) return [];
        const used = this.usedChannels(this.id);
        return this.stickSet.filter((c) => !used.has(c));
    }

    // ------------------------------------------------------------------ command plumbing

    private cmdAt(t: number | undefined): void {
        if (t !== undefined && t > this.now) this.now = t;
        this.advance(this.now);
    }

    private cmd(): void {
        this.state.cmds++;
    }

    private accept(id: StepId, stage: Stage | null): Verdict {
        this.cmd();
        this.go(id, stage);
        return OK;
    }

    private refuse(key: string, params: Record<string, string | number>): Verdict {
        const h: Hint = { key, params };
        this.refHint = h;
        this.state.hint = h;
        this.state.error = key;
        this.hintAt = this.now;
        this.timers();
        return { ok: false, hint: h };
    }

    private forward(): void {
        if (this.redoing) {
            this.redoing = false;
            this.redoSnap = null;
            this.go('check', null);
            return;
        }
        const nx = STEP_IDS[STEP_IDS.indexOf(this.id) + 1];
        if (nx !== 'check') this.readySnap[nx] = this.snap();
        this.go(nx, nx === 'check' ? null : 'ready');
    }

    private snap(): Snap {
        return {
            assigned: copyAssigned(this.assigned), pushEnd: { ...this.pushEnd }, rest: Array.from(this.rest),
            arm: copyArm(this.armMap), stickSet: this.stickSet.slice(), results: { ...this.results }
        };
    }

    private restore(s: Snap): void {
        this.assigned = copyAssigned(s.assigned);
        this.pushEnd = { ...s.pushEnd };
        for (let i = 0; i < this.n; i++) this.rest[i] = s.rest[i] ?? 0;
        this.armMap = copyArm(s.arm);
        this.stickSet = s.stickSet.slice();
        this.results = { ...s.results };
    }

    // ------------------------------------------------------------------ measuring

    private init(n: number, f: RawFrame, t: number): void {
        this.n = n;
        const F = () => new Float64Array(n);
        this.v = F(); this.mins = F(); this.maxs = F(); this.rest = F();
        this.wMin = F(); this.wMax = F(); this.wSum = F(); this.wN = F(); this.stillSince = F();
        this.sm = F(); this.sMin = F(); this.sMax = F(); this.stillSince2 = F();
        this.hist = new Uint32Array(n * NB); this.histN = new Uint32Array(n);
        this.kinds = new Array<ChannelKind>(n).fill('idle');
        this.fnOfCh = new Array<Fn | 'arm' | null>(n).fill(null);
        this.hiRef = F(); this.loRef = F(); this.hiHits = new Uint8Array(n); this.loHits = new Uint8Array(n);
        this.hiAway = new Uint8Array(n); this.loAway = new Uint8Array(n);
        this.base = F(); this.baseEnd = new Int8Array(n); this.belowP = new Uint8Array(n); this.takenSince = F().fill(NaN);
        this.cand = new Uint8Array(n); this.L0 = F().fill(NaN); this.lvl = F().fill(NaN); this.armSt = new Uint8Array(n); this.onV = F().fill(NaN);
        this.stepMax = F(); this.swept = new Uint8Array(n); this.maxExc = F(); this.awayT = F().fill(NaN);
        this.movedRefusals = new Uint8Array(n);
        for (let i = 0; i < n; i++) {
            const x = f.axes[i];
            this.v[i] = x; this.mins[i] = x; this.maxs[i] = x; this.rest[i] = x;
            this.wMin[i] = x; this.wMax[i] = x; this.wSum[i] = 0; this.wN[i] = 0; this.stillSince[i] = t;
            this.sm[i] = x; this.sMin[i] = x; this.sMax[i] = x; this.stillSince2[i] = t;
        }
        this.smT = t;
        this.lastButtons = f.buttons;
        for (let b = 0; b < NBITS; b++) { this.bitVal[b] = (f.buttons >> b) & 1; this.bitSince[b] = t; }
        const ch: ChannelLive[] = [];
        for (let i = 0; i < n; i++) ch.push({ v: f.axes[i], lo: f.axes[i], hi: f.axes[i], cover: 0, kind: 'idle', fn: null, still: false });
        this.state.channels = ch;
        const p = this.resumed;
        if (p) {
            // the saved ranges and centres, so Set again measures a push as on the first run
            this.stickSet = [];
            for (const fn of FNS) {
                const a = p.axes[fn];
                if (!a || a.index >= n) continue;
                const c = a.index;
                this.mins[c] = Math.min(this.mins[c], a.min);
                this.maxs[c] = Math.max(this.maxs[c], a.max);
                this.rest[c] = a.center;
                this.kinds[c] = 'stick';
                this.stickSet.push(c);
            }
            this.stickSet.sort((a, b) => a - b);
            this.fnFromAssigned();
        }
    }

    private track(f: RawFrame, t: number): void {
        const dt = Number.isNaN(this.smT) ? 0 : t - this.smT;
        if (dt > 0 || Number.isNaN(this.smT)) this.smT = t;
        const k = dt > 0 ? 1 - Math.exp(-dt / T.STILL_TAU_MS) : 0;
        const stir = this.id === 'stir' && this.stage === 'active';
        const arm = this.id === 'arm' && this.stage === 'active';
        for (let i = 0; i < this.n; i++) {
            const x = f.axes[i];
            if (arm) { const d = x > this.v[i] ? x - this.v[i] : this.v[i] - x; if (d > this.stepMax[i]) this.stepMax[i] = d; }
            this.v[i] = x;
            if (x < this.mins[i]) this.mins[i] = x;
            if (x > this.maxs[i]) this.maxs[i] = x;
            const lo = x < this.wMin[i] ? x : this.wMin[i];
            const hi = x > this.wMax[i] ? x : this.wMax[i];
            if (hi - lo > T.STILL_P2P) { this.stillSince[i] = t; this.wMin[i] = x; this.wMax[i] = x; this.wSum[i] = x; this.wN[i] = 1; }
            else { this.wMin[i] = lo; this.wMax[i] = hi; this.wSum[i] += x; this.wN[i]++; }
            this.sm[i] += (x - this.sm[i]) * k;
            this.smWindow(i, t);
            if (stir) {
                let b = Math.floor((x + 1) * (NB / 2));
                b = b < 0 ? 0 : b > NB - 1 ? NB - 1 : b;
                this.hist[i * NB + b]++;
                this.histN[i]++;
                this.plateauTrack(i, x);
            }
        }
        if (f.buttons !== this.lastButtons) {
            const changed = f.buttons ^ this.lastButtons;
            this.lastButtons = f.buttons;
            const armB = arm && this.restrict === null; // a channel picked by hand: buttons are not listened to
            for (let b = 0; b < NBITS; b++) {
                if (!(changed & (1 << b))) continue;
                const val = (f.buttons >> b) & 1;
                this.bitVal[b] = val;
                this.bitSince[b] = t;
                if (!armB) continue;
                if (val !== this.bitBase[b]) { this.pressT[b] = t; this.relT[b] = NaN; continue; }
                // back at its base (OFF). From 0: a press shorter than a level is a tap (momentary
                // button, toggle), a longer one a level. From 1, a short release is a latching
                // button that was ON at Start and got cycled
                const p = this.pressT[b];
                this.pressT[b] = NaN;
                if (Number.isNaN(p)) continue;
                const short = t - p < T.ARM_LEVEL_MS;
                if (short && this.bitBase[b] === 1) { this.wasOnCh = 100 + b; continue; }
                this.bKind[b] = short ? 1 : 2; // the latest press decides
                this.relT[b] = t;
            }
        }
    }

    /** The smoothed still window: restarts when the smoothed value spread over STILL_TOL. */
    private smWindow(i: number, t: number): void {
        const s = this.sm[i];
        const lo = s < this.sMin[i] ? s : this.sMin[i];
        const hi = s > this.sMax[i] ? s : this.sMax[i];
        if (hi - lo > T.STILL_TOL) { this.stillSince2[i] = t; this.sMin[i] = s; this.sMax[i] = s; }
        else { this.sMin[i] = lo; this.sMax[i] = hi; }
    }

    /** Time moves on without a frame: the last values hold (sample and hold). */
    private advance(t: number): void {
        if (this.n === 0 || Number.isNaN(this.smT) || t <= this.smT) return;
        const k = 1 - Math.exp(-(t - this.smT) / T.STILL_TAU_MS);
        this.smT = t;
        for (let i = 0; i < this.n; i++) {
            this.sm[i] += (this.v[i] - this.sm[i]) * k;
            this.smWindow(i, t);
        }
    }

    private plateauTrack(i: number, x: number): void {
        // a stir that keeps coming back to the same extreme after leaving it: a real end (a radio
        // whose output stops below 80 %), counted in movements, never in time
        if (x <= this.maxs[i] - T.PLATEAU_AWAY) this.hiAway[i] = 1;
        else if (this.hiAway[i] && x >= this.maxs[i] - T.PLATEAU_TOL) {
            this.hiAway[i] = 0;
            if (this.hiHits[i] === 0 || this.maxs[i] - this.hiRef[i] >= T.PLATEAU_TOL) { this.hiRef[i] = this.maxs[i]; this.hiHits[i] = 1; }
            else if (this.hiHits[i] < 255) this.hiHits[i]++;
        }
        if (x >= this.mins[i] + T.PLATEAU_AWAY) this.loAway[i] = 1;
        else if (this.loAway[i] && x <= this.mins[i] + T.PLATEAU_TOL) {
            this.loAway[i] = 0;
            if (this.loHits[i] === 0 || this.loRef[i] - this.mins[i] >= T.PLATEAU_TOL) { this.loRef[i] = this.mins[i]; this.loHits[i] = 1; }
            else if (this.loHits[i] < 255) this.loHits[i]++;
        }
    }

    private isStill(i: number): boolean { return this.now - this.stillSince2[i] >= T.STILL_MS; }
    private stillMs(i: number): number { return this.now - this.stillSince[i]; } // raw window (arm)
    private stillMean(i: number): number { return this.wN[i] > 0 ? this.wSum[i] / this.wN[i] : this.v[i]; }
    private mid(i: number): number { return (this.maxs[i] + this.mins[i]) / 2; }
    private half(i: number): number { const h = (this.maxs[i] - this.mins[i]) / 2; return h > 0.05 ? h : 0.05; }
    /** Signed offset of the smoothed value from the middle of the range, in halves. */
    private offMid(i: number): number { return (this.sm[i] - this.mid(i)) / this.half(i); }
    private centred(i: number): boolean { return Math.abs(this.offMid(i)) <= T.CENTRE_TOL; }
    private atEnd(i: number): boolean { return Math.abs(this.offMid(i)) >= 1 - T.END_TOL; }
    /**
     * Stir coverage: how far the channel got towards BOTH ends from the middle of the HID range
     * (the shorter side). Half the span called a stir to -1..+0.61 "80 % covered": its middle then
     * sat at -0.2 and a stick let go at 0 read as held on every later step.
     */
    private cover(i: number): number {
        const lo = -this.mins[i], hi = this.maxs[i];
        const c = lo < hi ? lo : hi;
        return c > 0 ? c : 0;
    }
    private pctOff(i: number): number { return Math.round(Math.abs(this.offMid(i)) * 100); }

    private usedChannels(except: Fn | null): Set<number> {
        const s = new Set<number>();
        for (const fn of FNS) { const a = this.assigned[fn]; if (a && fn !== except) s.add(a.index); }
        return s;
    }

    /** The newest still-window start among the channels: the one that moved last. */
    private latestMover(list: number[]): number {
        let ch = -1, since = -Infinity;
        for (const i of list) if (!this.isStill(i) && this.stillSince2[i] > since) { since = this.stillSince2[i]; ch = i; }
        return ch;
    }

    private frameNow(): RawFrame {
        const f = this.fr;
        f.t = this.now;
        f.axes.fill(0);
        for (let i = 0; i < this.n && i < f.axes.length; i++) f.axes[i] = this.v[i];
        f.buttons = this.lastButtons;
        return f;
    }

    // ------------------------------------------------------------------ stages

    private go(id: StepId, stage: Stage | null): void {
        const st = this.state;
        this.id = id;
        this.stage = stage;
        this.stageT0 = this.now;
        this.refHint = null;
        this.restrict = null;
        this.resetPush();
        this.takenSince.fill(NaN);
        this.belowP.fill(0);
        // the arm watch of an earlier try must not speak on this screen (armReset starts a new one)
        this.cand.fill(0);
        this.wasOnCh = -1;
        this.sweptCh = -1;
        this.backSince = NaN;
        if (isFn(id) && stage === 'active') { const used = this.usedChannels(id); this.free = this.stickSet.filter((c) => !used.has(c)); }
        st.id = id;
        st.stage = stage;
        st.step = id === 'connect' || id === 'stir' ? 1 : id === 'centre' ? 2 : isFn(id) ? 3 : id === 'arm' ? 5 : 6;
        st.prompt = isFn(id) ? id : null;
        st.message = stage ? `wizard.say.${id}.${stage}` : `wizard.say.${id}`;
        const [target, preview] = this.targetOf(id, stage);
        st.target = target;
        st.preview = preview;
        st.gauge = null;
        st.armFlip = null;
        st.picked = null;
        st.hold = st.progress = 0;
        st.stuckMs = 0;
        st.hint = null;
        st.error = null;
        st.checks = null;
        st.redoing = this.redoing;
        st.result = stage === 'done' ? this.results[id] ?? null : null;
        this.fnFromAssigned();
        if (id === 'check') {
            st.profile = this.keepProfile ?? this.buildProfile();
            this.keepProfile = null;
            st.checks = { throttleLow: false, armOn: null, centred: false };
        } else st.profile = null;
        st.armSource = armSourceOf(this.armMap);
        if (this.n > 0) this.live();
        this.timers();
    }

    private targetOf(id: StepId, stage: Stage | null): [WizardState['target'], boolean] {
        if (id === 'stir') return stage === 'done' ? [{ what: 'sticks', dir: 'centre' }, false] : [{ what: 'sticks', dir: 'stir' }, stage === 'ready'];
        if (id === 'centre') return [{ what: 'sticks', dir: 'centre' }, false];
        if (isFn(id)) {
            const push: Dir = id === 'throttle' || id === 'pitch' ? 'up' : 'right';
            if (stage === 'ready') return id === 'throttle' ? [{ what: id, dir: 'down' }, false] : [{ what: id, dir: push }, true];
            if (stage === 'active') return [{ what: id, dir: push }, false];
            return [{ what: id, dir: id === 'throttle' && this.pushEnd.throttle ? 'down' : 'centre' }, false];
        }
        if (id === 'arm') return [{ what: 'arm', dir: stage === 'active' ? 'on' : 'off' }, false];
        return [null, false];
    }

    private fnFromAssigned(): void {
        const st = this.state;
        for (let i = 0; i < this.fnOfCh.length; i++) this.fnOfCh[i] = null;
        st.assigned = {};
        st.inverted = {};
        for (const fn of FNS) {
            const a = this.assigned[fn];
            if (!a) continue;
            st.assigned[fn] = a.index;
            st.inverted[fn] = a.invert;
            if (a.index < this.fnOfCh.length) this.fnOfCh[a.index] = fn;
        }
        const m = this.armMap;
        if (m && m.kind === 'axis' && m.index < this.fnOfCh.length) this.fnOfCh[m.index] = 'arm';
    }

    private evaluate(t: number): void {
        if (this.stage === 'active') {
            if (this.id === 'stir') this.evalStir(t);
            else if (isFn(this.id)) this.evalPush(t);
            else if (this.id === 'arm') this.evalArm(t);
        } else if (this.id === 'arm' && this.stage === 'done') this.armFarEnd();
    }

    // ---------------------------------------------------------------- stir (rule 4)

    private resetStir(): void {
        for (let i = 0; i < this.n; i++) {
            const x = this.v[i];
            this.mins[i] = x; this.maxs[i] = x; this.kinds[i] = 'idle';
            this.hiHits[i] = 0; this.loHits[i] = 0; this.hiAway[i] = 0; this.loAway[i] = 0;
        }
        this.hist.fill(0);
        this.histN.fill(0);
        this.lastClassifyT = -Infinity;
        this.stirOk = false;
        this.stickSet = [];
        this.state.sticksDone = 0;
    }

    /**
     * Stick or switch from the stir histogram: a stirred stick sweeps many bins, a switch sits in 2-3.
     * Two signs of a sweep: time spent outside the 3 fullest bins, or many bins crossed at least
     * twice (someone who stirs corner to corner and pauses in each corner still passes every bin).
     */
    private classify(): void {
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
        }
        let full = 0;
        for (let i = 0; i < this.n; i++) if (this.kinds[i] === 'stick' && this.cover(i) >= T.STIR_COVER) full++;
        this.state.sticksDone = full;
        const top = this.widestSticks();
        this.stirOk = top.length >= 4 && top.slice(0, 4).every((i) => this.cover(i) >= T.STIR_COVER || this.plateau(i));
    }

    private widestSticks(): number[] {
        const idx: number[] = [];
        for (let i = 0; i < this.n; i++) if (this.kinds[i] === 'stick') idx.push(i);
        return idx.sort((a, b) => (this.maxs[b] - this.mins[b]) - (this.maxs[a] - this.mins[a]));
    }

    private plateau(i: number): boolean {
        return (this.maxs[i] - this.mins[i]) / 2 >= T.PLATEAU_MIN && this.hiHits[i] >= T.PLATEAU_HITS && this.loHits[i] >= T.PLATEAU_HITS
            && this.maxs[i] - this.hiRef[i] < T.PLATEAU_TOL && this.loRef[i] - this.mins[i] < T.PLATEAU_TOL;
    }

    private evalStir(t: number): void {
        if (t - this.lastClassifyT < T.CLASSIFY_EVERY_MS) return;
        this.lastClassifyT = t;
        this.classify();
    }

    private stirDone(): Verdict {
        this.classify();
        this.lastClassifyT = this.now;
        if (!this.stirOk) return { ok: false, hint: this.stirHintOf() ?? { key: 'wizard.hint.stir.few', params: { n: 0 } } };
        const sticks: number[] = [], switches: number[] = [];
        for (let i = 0; i < this.n; i++) { if (this.kinds[i] === 'stick') sticks.push(i); else if (this.kinds[i] === 'switch') switches.push(i); }
        const short = this.widestSticks().slice(0, 4).filter((i) => this.cover(i) < T.STIR_COVER).sort((a, b) => a - b);
        this.stickSet = sticks;
        this.results.stir = { kind: 'stir', sticks, switches, short };
        return this.accept('stir', 'done');
    }

    // ---------------------------------------------------------------- centre (rule 3)

    private measure(anyway: boolean): Verdict {
        const S = this.stickSet;
        if (!anyway) {
            const mover = this.latestMover(S);
            if (mover >= 0) {
                if (this.movedRefusals[mover] < 255) this.movedRefusals[mover]++;
                return this.refuse('wizard.hint.centre.moving', { ch: mover + 1 });
            }
            const allow = S.length - 3; // the throttle, plus one per extra stick-like channel
            const off = S.filter((c) => !this.centred(c));
            const ends = off.filter((c) => this.atEnd(c));
            if (off.length > allow && ends.length >= 2) return this.refuse('wizard.hint.centre.ends', { a: ends[0] + 1, b: ends[1] + 1 });
            if (S.length === 4) {
                const parked = off.find((c) => !this.atEnd(c));
                if (parked !== undefined) return this.refuse('wizard.hint.centre.parked', { ch: parked + 1, pct: this.pctOff(parked) });
            }
            if (off.length > allow) {
                const worst = off.reduce((a, b) => (Math.abs(this.offMid(b)) > Math.abs(this.offMid(a)) ? b : a));
                return this.refuse('wizard.hint.centre.held', { ch: worst + 1, pct: this.pctOff(worst) });
            }
        }
        const centres: { ch: number; pct: number }[] = [];
        let end = -1;
        for (const c of S) {
            this.rest[c] = this.sm[c];
            centres.push({ ch: c, pct: Math.round(this.offMid(c) * 1000) / 10 });
            if (end < 0 && this.atEnd(c)) end = c;
        }
        this.results.centre = { kind: 'centre', centres, end };
        return this.accept('centre', 'done');
    }

    private canMeasureAnyway(): boolean {
        for (let i = 0; i < this.n; i++) if (this.movedRefusals[i] >= T.MEASURE_ANYWAY_AFTER) return true;
        return false;
    }

    // ---------------------------------------------------------------- the stick steps (rule 2)

    private beginPush(fn: Fn): Verdict {
        const used = this.usedChannels(fn);
        const free = this.stickSet.filter((c) => !used.has(c));
        let need = 0;
        for (const f of ['yaw', 'pitch', 'roll'] as Fn[]) if (!this.assigned[f]) need++;
        const extra = free.length - need - (fn === 'throttle' ? 1 : 0);
        const mover = this.latestMover(free);
        if (mover >= 0) return this.refuse('wizard.hint.begin.moving', { ch: mover + 1 });
        const off = free.filter((c) => !this.centred(c));
        if (off.length > free.length - need) {
            const worst = off.reduce((a, b) => (Math.abs(this.offMid(b)) > Math.abs(this.offMid(a)) ? b : a));
            return this.refuse('wizard.hint.begin.held', { ch: worst + 1, pct: this.pctOff(worst) });
        }
        // a throttle left mid (or a thumb): its push could go either way, so it must start from an
        // end or from a spring centre (v2 took a 20 % nudge of a throttle parked mid as "up")
        if (fn === 'throttle' && extra <= 0 && off.length === 1 && !this.atEnd(off[0])) {
            return this.refuse('wizard.hint.begin.parked', { ch: off[0] + 1, pct: this.pctOff(off[0]) });
        }
        for (const c of free) {
            this.base[c] = this.sm[c];
            this.baseEnd[c] = this.atEnd(c) ? (this.offMid(c) > 0 ? 1 : -1) : 0;
        }
        return this.accept(fn, 'active');
    }

    private resetPush(): void {
        this.holdStart = NaN;
        this.holdCh = -1;
        this.holdSign = 0;
        this.holdPeak = 0;
        this.flicked = false;
        this.inAttempt = false;
        this.attemptPeak = 0;
        this.lastPeak = 0;
        this.everMoved = false;
        this.twoA = this.twoB = -1;
        this.takenCh = -1;
        const g = this.gauge;
        g.ch = -1; g.frac = 0; g.sign = 0; g.zone = 'rest'; g.held = 0; g.other = -1;
    }

    /** Share of the way from where the channel rested at Start to its end, and the sign of the move. */
    private pushFrac(j: number): [number, 1 | -1] {
        const d = this.v[j] - this.base[j];
        const s: 1 | -1 = d >= 0 ? 1 : -1;
        const be = this.baseEnd[j];
        if (be !== 0 && s === be) return [0, s]; // resting at an end: it can only go away from it
        let reach = d >= 0 ? this.maxs[j] - this.base[j] : this.base[j] - this.mins[j];
        if (reach < T.REACH_MIN) reach = T.REACH_MIN; // noise near a one-sided range never makes a push
        const f = Math.abs(d) / reach;
        return [f < 1 ? f : 1, s];
    }

    private evalPush(t: number): void {
        const fn = this.id as Fn;
        let lead = -1, lf = 0, ls: 1 | -1 = 1, sec = -1, sf = 0;
        for (const j of this.free) {
            const [f, s] = this.pushFrac(j);
            if (f > lf) { sec = lead; sf = lf; lead = j; lf = f; ls = s; }
            else if (f > sf) { sec = j; sf = f; }
        }
        let zone: Zone = lf < T.PUSH_REST ? 'rest' : lf < T.PUSH_TINY ? 'tiny' : lf < T.PUSH_ACCEPT ? 'almost' : 'enough';
        if (this.restrict === null && sf >= T.TWO_FRAC) { zone = 'two'; this.twoA = Math.min(lead, sec); this.twoB = Math.max(lead, sec); }
        // attempts: an excursion from rest and back, for the "almost" hint
        if (lf >= T.PUSH_REST) {
            if (!this.inAttempt) { this.inAttempt = true; this.attemptPeak = 0; this.lastPeak = 0; }
            this.everMoved = true;
            if (lf > this.attemptPeak) this.attemptPeak = lf;
        } else if (this.inAttempt) { this.inAttempt = false; this.lastPeak = this.attemptPeak; }
        // the hold: enough, on the same channel and sign, continuously
        if (zone === 'enough') {
            if (lead !== this.holdCh || ls !== this.holdSign || Number.isNaN(this.holdStart)) {
                this.holdCh = lead; this.holdSign = ls; this.holdStart = t; this.holdPeak = 0; this.flicked = false;
            }
            if (lf > this.holdPeak) this.holdPeak = lf;
        } else {
            if (!Number.isNaN(this.holdStart) && this.holdPeak >= T.PUSH_FLICK && t - this.holdStart < T.HOLD_MS) this.flicked = true;
            this.holdStart = NaN; this.holdCh = -1; this.holdSign = 0; this.holdPeak = 0;
        }
        const heldMs = zone === 'enough' ? t - this.holdStart : 0;
        const g = this.gauge;
        g.ch = lead; g.frac = lf; g.sign = zone === 'rest' ? 0 : ls; g.zone = zone;
        g.held = Math.min(1, heldMs / T.HOLD_MS); g.other = zone === 'two' ? sec : -1;
        // an already-set channel pushed on purpose: say so, take nothing
        for (const f2 of FNS) {
            const a2 = this.assigned[f2];
            if (!a2 || f2 === fn || a2.index >= this.n) continue;
            const c2 = a2.index;
            const d = this.v[c2] - this.rest[c2];
            let reach = d >= 0 ? this.maxs[c2] - this.rest[c2] : this.rest[c2] - this.mins[c2];
            if (reach < T.REACH_MIN) reach = T.REACH_MIN;
            const m = Math.abs(d) / reach;
            if (m < T.PUSH_TINY) { this.belowP[c2] = 1; this.takenSince[c2] = NaN; if (this.takenCh === c2) this.takenCh = -1; }
            else if (this.belowP[c2] && m >= T.PUSH_ACCEPT) {
                if (Number.isNaN(this.takenSince[c2])) this.takenSince[c2] = t;
                else if (t - this.takenSince[c2] >= T.TAKEN_HOLD_MS) this.takenCh = c2;
            } else this.takenSince[c2] = NaN;
        }
        if (zone === 'enough' && heldMs >= T.HOLD_MS) this.acceptPush(fn, lead, ls);
    }

    private acceptPush(fn: Fn, c: number, s: 1 | -1): void {
        const inv = s < 0; // the asks are always up / right
        this.assigned[fn] = fn === 'throttle'
            ? { index: c, invert: inv, center: inv ? this.maxs[c] : this.mins[c], min: this.mins[c], max: this.maxs[c] }
            : { index: c, invert: inv, center: this.rest[c], min: this.mins[c], max: this.maxs[c] };
        this.pushEnd[fn] = this.baseEnd[c];
        this.results[fn] = { kind: 'fn', fn, ch: c, invert: inv };
        this.go(fn, 'done');
    }

    /** Next on a stick result: the stick is let go (the throttle is down), the centre is measured again. */
    private nextFn(fn: Fn): Verdict {
        const a = this.assigned[fn];
        if (!a) return DISABLED;
        const c = a.index;
        if (fn === 'throttle' && this.pushEnd.throttle) {
            // a radio throttle: the bar must read down. A push taken the wrong way round shows here
            // (the bar full with the stick down) and the pilot fixes it with Reverse
            let u = (this.v[c] - a.min) / Math.max(1e-6, a.max - a.min);
            if (a.invert) u = 1 - u;
            u = u < 0 ? 0 : u > 1 ? 1 : u;
            // no stillness asked here: nothing is measured, and a throttle at its bottom cannot be passing through
            if (u > T.THR_DOWN_MAX) return this.refuse('wizard.hint.next.thrDown', { pct: Math.round(u * 100) });
            return OK;
        }
        if (!this.isStill(c)) return this.refuse('wizard.hint.next.moving', { fn });
        // let go: back near the rest measured on "let go of both sticks", or near the middle (that
        // rest may hold a thumb that rested on the stick then)
        const h = this.half(c);
        const fromRest = Math.abs(this.sm[c] - this.rest[c]) / h;
        if (fromRest > T.CENTRE_TOL && !this.centred(c)) return this.refuse('wizard.hint.next.held', { fn, pct: Math.round(Math.min(fromRest, Math.abs(this.offMid(c))) * 100) });
        if (fn !== 'throttle') {
            this.rest[c] = this.sm[c]; // the thumb is off now
            a.center = this.rest[c];
        }
        return OK;
    }

    // ---------------------------------------------------------------- arm

    /**
     * Start on arm/ready: from now on, and only now, the channels are watched. Not refused for a
     * moving channel: a noisy one would block Start for ever, and the first still level after
     * Start is what counts as OFF anyway.
     */
    private beginArm(): Verdict {
        this.cmd();
        this.go('arm', 'active');
        this.armReset();
        this.timers();
        return OK;
    }

    /** Arm watch from now: candidates, their OFF level if they are still, the buttons' base. */
    private armReset(): void {
        const r = this.restrict;
        for (let i = 0; i < this.n; i++) {
            const f = this.fnOfCh[i];
            // sticks never: the four functions, and anything stirred like a stick (a knob, a slider)
            this.cand[i] = r !== null ? (i === r ? 1 : 0) : (f === null || f === 'arm') && this.kinds[i] !== 'stick' ? 1 : 0;
            const still = this.cand[i] === 1 && this.stillMs(i) >= T.ARM_LEVEL_MS;
            const m = still ? this.stillMean(i) : NaN;
            this.L0[i] = m;
            this.lvl[i] = m;
            this.armSt[i] = still ? 1 : 0;
        }
        this.onV.fill(NaN);
        this.stepMax.fill(0);
        this.swept.fill(0);
        this.maxExc.fill(0);
        this.awayT.fill(NaN);
        this.bitBase.set(this.bitVal);
        this.pressT.fill(NaN);
        this.relT.fill(NaN);
        this.bKind.fill(0);
        this.wasOnCh = -1;
        this.sweptCh = -1;
        this.backSince = NaN;
        this.state.armFlip = null;
    }

    private jumpOf(i: number): number {
        return this.restrict === i ? T.ARM_PICK_JUMP : T.ARM_JUMP;
    }

    /**
     * arm/active, every frame and tick. A channel counts only for a flip ON and back OFF, each
     * level still >= ARM_LEVEL_MS, the ON level >= ARM_JUMP from OFF, every hop a jump. The only
     * acceptance is at the end of the OFF hold: never because time passed with nothing moving.
     */
    private evalArm(t: number): void {
        let rank = 0, fSrc = -1, fHeld = 0, fLevel = 0;
        for (let i = 0; i < this.n; i++) {
            if (!this.cand[i]) continue;
            const x = this.v[i];
            const jm = this.jumpOf(i);
            const picked = this.restrict === i;
            if (this.armSt[i] >= 1) {
                const e = Math.abs(x - this.L0[i]);
                if (e > this.maxExc[i]) this.maxExc[i] = e;
                // over and straight back before it became a level there: a switch left ON at
                // Start and cycled, or a flick too short to read (one glitch sample is neither)
                if (this.armSt[i] === 1) {
                    if (e >= jm) { if (Number.isNaN(this.awayT[i])) this.awayT[i] = t; }
                    else if (e < jm / 2) {
                        const a = this.awayT[i];
                        if (!Number.isNaN(a) && t - a >= T.ARM_FAR_MS && !this.swept[i]) this.wasOnCh = i;
                        this.awayT[i] = NaN;
                    }
                }
            }
            if (this.stillMs(i) >= T.ARM_LEVEL_MS) {
                const m = this.stillMean(i);
                if (this.armSt[i] === 0) { this.L0[i] = m; this.armSt[i] = 1; }
                else {
                    const hop = Math.abs(m - this.lvl[i]);
                    if (hop >= jm / 2) {
                        // a switch changes within a report or two; a knob or a slider (or a stick)
                        // passes every value in between
                        if (!picked && this.stepMax[i] < T.ARM_STEP_FRAC * hop) {
                            this.swept[i] = 1;
                            if (hop >= jm) this.sweptCh = i;
                        } else if (!this.swept[i]) {
                            const fromOff = Math.abs(m - this.L0[i]);
                            if (this.armSt[i] === 1 && fromOff >= jm) { this.armSt[i] = 2; this.onV[i] = m; }
                            else if (this.armSt[i] === 2 && fromOff >= jm && fromOff > Math.abs(this.onV[i] - this.L0[i])) this.onV[i] = m; // a 3-position switch: its far end
                            else if (this.armSt[i] === 2 && fromOff < jm / 2) {
                                const off = this.L0[i], on = this.onV[i];
                                // threshold 3/4 of the way to ON: a 3-position switch reads OFF in its middle
                                this.acceptArm({ kind: 'axis', index: i, threshold: off + 0.75 * (on - off), onAbove: on > off, off, on });
                                return;
                            }
                        }
                    }
                }
                this.lvl[i] = m;
                this.stepMax[i] = 0;
            }
            // what the screen shows: ON under way, or ON counted and on its way back OFF
            if (this.armSt[i] === 2) {
                const held = Math.abs(x - this.L0[i]) < jm / 2 ? Math.min(1, this.stillMs(i) / T.ARM_LEVEL_MS) : 0;
                if (rank < 2 || held > fHeld) { rank = 2; fSrc = i; fHeld = held; fLevel = x; }
            } else if (rank < 2 && this.armSt[i] === 1 && !this.swept[i] && Math.abs(x - this.L0[i]) >= jm
                && (picked || this.stepMax[i] >= T.ARM_STEP_FRAC * Math.abs(x - this.lvl[i]))) {
                const held = Math.min(1, this.stillMs(i) / T.ARM_LEVEL_MS);
                if (rank < 1 || held > fHeld) { rank = 1; fSrc = i; fHeld = held; fLevel = x; }
            }
        }
        if (this.restrict === null) {
            for (let b = 0; b < NBITS; b++) {
                if (this.bitVal[b] !== this.bitBase[b]) {
                    const p = this.pressT[b];
                    if (Number.isNaN(p)) continue;
                    // held long enough to be a level: ON has counted, now it must go back OFF
                    if (t - p >= T.ARM_LEVEL_MS) { if (rank < 2) { rank = 2; fSrc = 100 + b; fHeld = 0; fLevel = this.bitVal[b]; } continue; }
                    if (rank >= 2) continue;
                    const held = (t - p) / T.ARM_LEVEL_MS;
                    if (rank < 1 || held > fHeld) { rank = 1; fSrc = 100 + b; fHeld = held; fLevel = this.bitVal[b]; }
                    continue;
                }
                const r = this.relT[b];
                if (Number.isNaN(r)) continue;
                if (t - r >= T.ARM_LEVEL_MS) {
                    // pressed, then released for a level: a tap is a momentary button (toggle)
                    const inv = this.bitBase[b] === 1;
                    this.acceptArm(this.bKind[b] === 1 ? { kind: 'button', bit: b, toggle: true } : inv ? { kind: 'button', bit: b, inverted: true } : { kind: 'button', bit: b });
                    return;
                }
                const held = (t - r) / T.ARM_LEVEL_MS;
                if (rank < 2 || held > fHeld) { rank = 2; fSrc = 100 + b; fHeld = held; fLevel = this.bitVal[b]; }
            }
        }
        const st = this.state;
        if (rank !== 2) this.backSince = NaN;
        else if (Number.isNaN(this.backSince)) this.backSince = t;
        if (rank === 0) st.armFlip = null;
        else {
            const fl = this.flip;
            fl.src = fSrc >= 100 ? { kind: 'button', n: fSrc - 99 } : { kind: 'ch', n: fSrc + 1 };
            fl.phase = rank === 2 ? 'off' : 'on';
            fl.held = fHeld;
            fl.level = fLevel;
            st.armFlip = fl;
        }
        const back = rank === 2;
        st.message = back ? 'wizard.say.arm.back' : 'wizard.say.arm.active';
        if (st.target) st.target.dir = back ? 'off' : 'on';
        st.hold = st.progress = fHeld;
    }

    private acceptArm(m: ArmMap): void {
        this.armMap = m;
        this.results.arm = { kind: 'arm', source: armSourceOf(m)! };
        this.go('arm', 'done');
    }

    /** arm/done: a still level beyond ON is the far end of a 3-position switch: it is ON, the middle reads OFF. */
    private armFarEnd(): void {
        const m = this.armMap;
        if (!m || m.kind !== 'axis' || m.off === undefined || m.on === undefined || m.index >= this.n) return;
        const c = m.index;
        if (this.stillMs(c) < T.ARM_LEVEL_MS) return;
        const x = this.stillMean(c);
        const span = m.on - m.off;
        if ((x - m.off) * span > 0 && Math.abs(x - m.off) >= Math.abs(span) + T.ARM_JUMP / 2) {
            // Reverse keeps the threshold mirrored between the levels: keep the same relation
            const frac = (m.threshold - m.off) / span;
            m.on = x;
            m.threshold = m.off + frac * (x - m.off);
        }
    }

    // ------------------------------------------------------------------ profile

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
                // was never explored, and its short half would turn a nudge into full deflection
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
            arm: copyArm(this.armMap),
            angleMode: null,
            deadband: 0,
            created: new Date().toISOString(),
            wizard: 2
        };
    }

    // ------------------------------------------------------------------ live values, hints, buttons

    private live(): void {
        const st = this.state;
        const ch = st.channels;
        for (let i = 0; i < this.n; i++) {
            const c = ch[i];
            c.v = this.v[i];
            c.lo = this.mins[i];
            c.hi = this.maxs[i];
            c.cover = this.cover(i);
            c.kind = this.kinds[i];
            c.fn = this.fnOfCh[i];
            c.still = this.isStill(i);
        }
        const f = this.frameNow();
        const m = st.mapped;
        const p = st.profile;
        if (this.id === 'check' && p) {
            const out = mapFrame(p, f, this.mapOut);
            m.roll = out[0]; m.pitch = out[1]; m.throttle = out[2]; m.yaw = out[3];
            m.arm = isLevel(p.arm) ? armOn(p.arm, f) : null;
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
            let u = (this.v[c] - th.min) / Math.max(1e-6, th.max - th.min);
            if (th.invert) u = 1 - u;
            u = u < 0 ? 0 : u > 1 ? 1 : u;
            m.throttle = u * 2 - 1;
        } else m.throttle = NaN;
        m.arm = isLevel(this.armMap) ? armOn(this.armMap, f) : null;
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

    private setHint(key: string | null, params?: Record<string, string | number>): void {
        const st = this.state;
        const cur = st.hint ? st.hint.key : null;
        // a shown hint stays a moment: a text that flickers with the noise cannot be read (and a
        // screen reader would repeat it)
        if (key !== cur && cur !== null && this.now - this.hintAt < T.HINT_MIN_MS) return;
        if (key === null) { st.hint = null; st.error = null; return; }
        let h = st.hint;
        if (!h || key !== cur) { h = st.hint = { key, params: {} }; st.error = key; this.hintAt = this.now; }
        if (params) for (const k of Object.keys(params)) h.params[k] = params[k];
    }

    private timers(): void {
        const st = this.state;
        const stuck = this.now - this.stageT0;
        st.stuckMs = stuck;
        const c = st.can;
        c.begin = c.next = c.skipArm = c.pick = c.measureAnyway = c.reverse = c.redo = c.fly = false;
        c.back = true; // rule 6: every screen has a way back
        const id = this.id, stage = this.stage;
        if (id === 'connect') { this.setHint(stuck >= T.CONNECT_HINT_MS && this.n === 0 ? 'wizard.hint.noData' : null); return; }
        if (id === 'check') {
            c.fly = c.reverse = c.redo = true;
            const p = st.profile;
            const th = p?.axes.throttle;
            if (th && th.index < this.n && !Number.isNaN(st.mapped.throttle)) {
                const u = (st.mapped.throttle + 1) / 2;
                if (u >= 0.95 && this.stillMs(th.index) >= T.CHECK_SUSPECT_MS) this.setHint('wizard.hint.check.throttle', { pct: Math.round(u * 100) });
                else this.setHint(null);
            } else this.setHint(null);
            return;
        }
        if (stage === 'ready') c.begin = this.n > 0;
        else if (stage === 'done') c.next = true;
        if (id === 'arm') {
            c.skipArm = true;
            let used = 0;
            for (const fn of FNS) { const a = this.assigned[fn]; if (a && a.index < this.n) used++; }
            c.pick = this.n > used; // the channel list (Liftoff's dots) on every arm stage
        }
        if (stage === 'done' && (isFn(id) || (id === 'arm' && isLevel(this.armMap)))) c.reverse = true;
        if (stage === 'active') {
            if (id === 'stir') {
                c.next = this.stirOk;
                if (stuck >= T.STIR_HINT_MS) { const h = this.stirHintOf(); this.setHint(h ? h.key : null, h?.params); } else this.setHint(null);
                return;
            }
            if (id === 'centre') { c.next = true; c.measureAnyway = this.canMeasureAnyway(); }
            else if (isFn(id)) {
                c.pick = stuck >= T.PUSH_PICK_MS;
                const g = this.gauge;
                st.gauge = g;
                st.hold = st.progress = g.held;
                this.pushHint(stuck);
                return;
            } else if (id === 'arm') {
                this.armHint(stuck);
                return;
            }
        }
        // ready, done and centre/active: the hint of the last refused command, if any
        const h = this.refHint;
        st.hint = h;
        st.error = h ? h.key : null;
    }

    private stirHintOf(): Hint | null {
        let moving = 0, sticks = 0, part = -1, partSpan = 0;
        for (let i = 0; i < this.n; i++) {
            const span = this.maxs[i] - this.mins[i];
            if (span >= T.MOVING_SPAN) moving++;
            if (this.kinds[i] === 'stick') sticks++;
            else if (this.kinds[i] === 'idle' && span >= T.MOVING_SPAN && span > partSpan) { partSpan = span; part = i; }
        }
        // fewer than four channels move at all: the text asks about USB Joystick mode
        if (moving < 4) return { key: 'wizard.hint.stir.few', params: { n: moving } };
        if (sticks < 4) {
            // they do move, just not like sticks yet: a channel swept part of the way is most
            // likely the missing stick (say how far it got); else ask for the full travel
            if (part >= 0) return { key: 'wizard.hint.stir.coverage', params: { ch: part + 1, pct: Math.round((partSpan / 2) * 100) } };
            return { key: 'wizard.needFourAxes', params: {} };
        }
        // among the four widest sticks, the one furthest from its ends
        let low = -1, lowCover = Infinity;
        for (const i of this.widestSticks().slice(0, 4)) { const cv = this.cover(i); if (cv < lowCover) { lowCover = cv; low = i; } }
        if (low < 0 || lowCover >= T.STIR_COVER) return null;
        const pct = Math.round(lowCover * 100);
        if (this.plateau(low)) return { key: 'wizard.hint.stir.short', params: { ch: low + 1, pct } };
        return { key: 'wizard.hint.stir.coverage', params: { ch: low + 1, pct } };
    }

    private pushHint(stuck: number): void {
        const fnc = this.takenCh >= 0 ? this.fnOfCh[this.takenCh] : null;
        if (fnc && fnc !== 'arm') { this.setHint('wizard.hint.push.taken', { fn: fnc }); return; }
        if (this.gauge.zone === 'two') { this.setHint('wizard.hint.push.two', { a: this.twoA + 1, b: this.twoB + 1 }); return; }
        if (this.flicked) { this.setHint('wizard.hint.push.hold'); return; }
        if (!this.inAttempt && this.lastPeak >= T.PUSH_TINY && this.lastPeak < T.PUSH_ACCEPT) {
            this.setHint('wizard.hint.push.short', { pct: Math.round(this.lastPeak * 100) });
            return;
        }
        if (!this.inAttempt && this.lastPeak < T.PUSH_TINY && stuck >= T.PUSH_HINT_MS) { this.setHint('wizard.hint.push.none'); return; }
        this.setHint(null);
    }

    private armHint(stuck: number): void {
        // a flip under way: the say line and the ring tell what to do. "Now flip it back OFF" with
        // nothing moving for a while: most likely it was ON at Start and the pilot's OFF counted as ON
        const fl = this.state.armFlip;
        if (fl) {
            if (fl.phase === 'off' && fl.held === 0 && this.now - this.backSince >= T.ARM_BACK_HINT_MS) {
                this.setHint('wizard.hint.arm.wasOn', fl.src.kind === 'ch' ? { ch: fl.src.n } : { btn: fl.src.kind === 'button' ? fl.src.n : 0 });
            } else this.setHint(null);
            return;
        }
        if (this.sweptCh >= 0) { this.setHint('wizard.hint.arm.sweep', { ch: this.sweptCh + 1 }); return; }
        if (this.wasOnCh >= 0) { this.setHint('wizard.hint.arm.wasOn', this.wasOnCh >= 100 ? { btn: this.wasOnCh - 99 } : { ch: this.wasOnCh + 1 }); return; }
        if (stuck < T.ARM_HINT_MS) { this.setHint(null); return; }
        let small = -1;
        for (let i = 0; i < this.n; i++) {
            if (!this.cand[i] || this.armSt[i] === 0) continue;
            if (this.maxExc[i] >= T.ARM_SMALL && this.maxExc[i] < this.jumpOf(i)) { small = i; break; }
        }
        if (small >= 0) this.setHint('wizard.hint.arm.small', { ch: small + 1 });
        else this.setHint('wizard.hint.arm.none');
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
