// Calibration wizard core (no DOM): turns raw device frames into a profile that maps the
// device's axes and buttons onto roll / pitch / throttle / yaw / arm. The UI only shows prompts
// and feeds frames in; every decision is made here, so the simulated radio can test it.
//
// Raw frames: axes normalised to [-1, 1] (HID 0..2048 -> -1..1, gamepad as is), buttons bitmask.

export type Fn = 'roll' | 'pitch' | 'throttle' | 'yaw';
export const FNS: Fn[] = ['throttle', 'yaw', 'roll', 'pitch']; // prompt order in step 3

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

export type ArmMap = { kind: 'axis'; index: number; threshold: number; onAbove: boolean } | { kind: 'button'; bit: number };

export interface Profile {
    version: 1;
    deviceKey: string;
    deviceName: string;
    axes: Record<Fn, AxisMap>;
    arm: ArmMap | null;
    angleMode: ArmMap | null;
    deadband: number;
    created: string;
}

export type Step = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface WizardState {
    step: Step;
    prompt: Fn | null; // step 3: which stick move is being asked for
    message: string; // i18n key
    progress: number; // 0..1 within the step
    error: string | null;
    profile: Profile | null;
}

const RANGE_CANDIDATE = 1.0; // > 50 % of the full -1..1 span
const STEP1_MS = 8000;
const STEP2_MS = 1000;
const PROMPT_MS = 500;
const RETURN_TOL = 0.05;

export class CalibrationWizard {
    state: WizardState = { step: 0, prompt: null, message: 'wizard.step1', progress: 0, error: null, profile: null };
    private nAxes = 0;
    private mins: number[] = [];
    private maxs: number[] = [];
    private buttonsSeen = 0;
    private stepT0 = 0;
    private centerSum: number[] = [];
    private centerSq: number[] = [];
    private centerN = 0;
    private centers: number[] = [];
    private settle: number[] = [];
    private promptIdx = 0;
    private promptPeak: number[] = [];
    private assigned: Partial<Record<Fn, AxisMap>> = {};
    private switchHist: Map<number, number[]> = new Map();
    private buttonToggles: number[] = [];
    private lastButtons = 0;
    private armPresses = 0;
    private deviceKey: string;
    private deviceName: string;

    constructor(deviceKey: string, deviceName: string) {
        this.deviceKey = deviceKey;
        this.deviceName = deviceName;
    }

    start(t: number): void {
        this.state = { step: 1, prompt: null, message: 'wizard.step1', progress: 0, error: null, profile: null };
        this.stepT0 = t;
    }

    private go(step: Step, t: number, message: string): void {
        this.state.step = step;
        this.state.message = message;
        this.state.progress = 0;
        this.stepT0 = t;
    }

    feed(f: RawFrame): WizardState {
        const st = this.state;
        if (st.step === 0 || st.step === 6) return st;
        if (this.nAxes === 0) {
            this.nAxes = f.axes.length;
            this.mins = new Array(this.nAxes).fill(Infinity);
            this.maxs = new Array(this.nAxes).fill(-Infinity);
            this.centerSum = new Array(this.nAxes).fill(0);
            this.centerSq = new Array(this.nAxes).fill(0);
        }
        const el = f.t - this.stepT0;
        switch (st.step) {
            case 1: {
                for (let i = 0; i < this.nAxes; i++) {
                    const v = f.axes[i];
                    if (v < this.mins[i]) this.mins[i] = v;
                    if (v > this.maxs[i]) this.maxs[i] = v;
                }
                this.buttonsSeen |= f.buttons;
                st.progress = Math.min(1, el / STEP1_MS);
                const candidates = this.candidates();
                if (el >= STEP1_MS) {
                    if (candidates.length < 4) {
                        st.error = 'wizard.needFourAxes';
                        this.go(1, f.t, 'wizard.step1');
                    } else {
                        st.error = null;
                        this.go(2, f.t, 'wizard.step2');
                    }
                }
                break;
            }
            case 2: {
                for (let i = 0; i < this.nAxes; i++) {
                    this.centerSum[i] += f.axes[i];
                    this.centerSq[i] += f.axes[i] * f.axes[i];
                }
                this.centerN++;
                st.progress = Math.min(1, el / STEP2_MS);
                if (el >= STEP2_MS) {
                    this.centers = this.centerSum.map((s) => s / this.centerN);
                    this.settle = this.centerSq.map((q, i) => {
                        const m = this.centers[i];
                        const sd = Math.sqrt(Math.max(0, q / this.centerN - m * m));
                        return Math.max(0.02, 3 * sd);
                    });
                    this.promptIdx = 0;
                    this.promptPeak = new Array(this.nAxes).fill(0);
                    st.prompt = FNS[0];
                    this.go(3, f.t, `wizard.step3.${FNS[0]}`);
                }
                break;
            }
            case 3: {
                // amplitude race: which free candidate axis moved the most (normalised by its range)
                const cands = this.candidates().filter((i) => !Object.values(this.assigned).some((a) => a && a.index === i));
                for (const i of cands) {
                    const range = (this.maxs[i] - this.mins[i]) / 2 || 1;
                    const d = (f.axes[i] - this.centers[i]) / range;
                    if (Math.abs(d) > Math.abs(this.promptPeak[i])) this.promptPeak[i] = d;
                }
                st.progress = Math.min(1, el / PROMPT_MS);
                if (el >= PROMPT_MS) {
                    let best = -1;
                    let bestV = 0;
                    for (const i of cands) {
                        if (Math.abs(this.promptPeak[i]) > Math.abs(bestV)) { bestV = this.promptPeak[i]; best = i; }
                    }
                    const fn = FNS[this.promptIdx];
                    if (best < 0 || Math.abs(bestV) < 0.3) {
                        // nothing moved enough: ask again
                        this.promptPeak.fill(0);
                        this.stepT0 = f.t;
                        st.error = 'wizard.waiting';
                        break;
                    }
                    st.error = null;
                    this.assigned[fn] = {
                        index: best,
                        invert: bestV < 0, // pushed "up/right" but the value went down
                        center: fn === 'throttle' ? this.mins[best] : this.centers[best],
                        min: this.mins[best],
                        max: this.maxs[best]
                    };
                    this.promptIdx++;
                    this.promptPeak.fill(0);
                    if (this.promptIdx < FNS.length) {
                        st.prompt = FNS[this.promptIdx];
                        this.go(3, f.t, `wizard.step3.${FNS[this.promptIdx]}`);
                    } else {
                        st.prompt = null;
                        this.go(4, f.t, 'wizard.step4');
                    }
                }
                break;
            }
            case 4: {
                // release: roll/pitch/yaw return to centre, throttle stays -> confirms the throttle
                const back = (['roll', 'pitch', 'yaw'] as Fn[]).every((fn) => {
                    const a = this.assigned[fn]!;
                    const range = (a.max - a.min) / 2 || 1;
                    return Math.abs(f.axes[a.index] - a.center) / range <= RETURN_TOL;
                });
                st.progress = Math.min(1, el / 400);
                if (back && el >= 400) {
                    // throttle: centre of a non-centring stick is its minimum
                    const th = this.assigned.throttle!;
                    if (th.invert) th.center = th.max;
                    this.go(5, f.t, 'wizard.step5');
                    this.lastButtons = f.buttons;
                    this.switchHist.clear();
                }
                break;
            }
            case 5: {
                // arm switch: a non-stick axis that jumps between 2 or 3 clusters, or a button bit that toggles
                const used = new Set(Object.values(this.assigned).map((a) => a!.index));
                for (let i = 0; i < this.nAxes; i++) {
                    if (used.has(i)) continue;
                    const h = this.switchHist.get(i) ?? [];
                    const q = Math.round(f.axes[i] * 4) / 4; // coarse bins
                    if (h.length === 0 || h[h.length - 1] !== q) h.push(q);
                    this.switchHist.set(i, h);
                }
                const changed = f.buttons ^ this.lastButtons;
                if (changed) {
                    for (let b = 0; b < 24; b++) if (changed & (1 << b)) this.buttonToggles[b] = (this.buttonToggles[b] ?? 0) + 1;
                    this.lastButtons = f.buttons;
                }
                const axisArm = [...this.switchHist.entries()].find(([, h]) => h.length >= 4 && new Set(h).size >= 2 && new Set(h).size <= 3);
                const btnArm = this.buttonToggles.findIndex((n) => (n ?? 0) >= 4);
                this.armPresses = Math.max(axisArm ? axisArm[1].length : 0, btnArm >= 0 ? this.buttonToggles[btnArm] : 0);
                st.progress = Math.min(1, this.armPresses / 4);
                if (axisArm || btnArm >= 0) {
                    let arm: ArmMap;
                    if (axisArm) {
                        const vals = [...new Set(axisArm[1])].sort((a, b) => a - b);
                        const hi = vals[vals.length - 1];
                        const lo = vals[0];
                        arm = { kind: 'axis', index: axisArm[0], threshold: (hi + lo) / 2, onAbove: true };
                    } else {
                        arm = { kind: 'button', bit: btnArm };
                    }
                    this.state.profile = this.buildProfile(arm);
                    this.go(6, f.t, 'wizard.step6');
                }
                break;
            }
        }
        return st;
    }

    private candidates(): number[] {
        const out: number[] = [];
        for (let i = 0; i < this.nAxes; i++) if (this.maxs[i] - this.mins[i] > RANGE_CANDIDATE) out.push(i);
        return out;
    }

    private buildProfile(arm: ArmMap): Profile {
        return {
            version: 1,
            deviceKey: this.deviceKey,
            deviceName: this.deviceName,
            axes: this.assigned as Record<Fn, AxisMap>,
            arm,
            angleMode: null,
            deadband: 0,
            created: new Date().toISOString()
        };
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

export function armOn(a: ArmMap | null, f: RawFrame): boolean {
    if (!a) return false;
    if (a.kind === 'button') return ((f.buttons >> a.bit) & 1) === 1;
    const v = f.axes[a.index];
    return a.onAbove ? v > a.threshold : v < a.threshold;
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
