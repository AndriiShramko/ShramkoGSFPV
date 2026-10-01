// The radio's flight-mode switch (docs/architecture-v03.md B.2; the owner's item 15). No DOM.
//
// A profile may name one 2- or 3-position switch as its mode switch: low, middle and high each
// pick a flight mode, and the radio then decides the mode (the app's own mode, prefs flight.mode,
// is used only without one). The wizard finds it on its check screen with no click: the pilot
// flips a switch that is not a stick and not the arm switch, the way the arm step finds its
// switch (a jump between two still levels, never a knob turned or noise). A row of buttons there
// is only an optional override (none, or another mode for a position).
//
// Positions are thirds of the channel's travel, like Betaflight's AUX ranges: below -1/3 low,
// above +1/3 high, the middle third the middle. An EdgeTX 2-position switch sends -100 % / +100 %
// (low / high), a 3-position one -100 / 0 / +100. A button reads low released, high pressed.
import { MODE_CHANNEL } from '@gsfpv/sim-core';
import type { FlightMode } from '@gsfpv/sim-core';
import type { RawFrame } from './calib';

/** The input a mode switch is read from: an axis channel (0-based) or a button bit. */
export type SwitchInput = { kind: 'axis'; index: number } | { kind: 'button'; bit: number };
/** 0 low, 1 middle, 2 high. */
export type SwitchPos = 0 | 1 | 2;
export type SwitchModes = [FlightMode, FlightMode, FlightMode];
export interface ModeSwitch { input: SwitchInput; modes: SwitchModes }

export const FLIGHT_MODES: readonly FlightMode[] = ['acro', 'angle', 'horizon'];
/**
 * A switch found by the wizard: low acro (switch down = no mode, as on a Betaflight AUX channel),
 * middle horizon, high angle. The same order as MODE_CHANNEL (-1, 0, +1).
 */
export const DEFAULT_SWITCH_MODES: Readonly<SwitchModes> = ['acro', 'horizon', 'angle'];

/** Highest axis index and button bit a profile may name (8 HID channels, 24 report bits; pads have fewer). */
const MAX_AXIS = 31;
const MAX_BIT = 23;

/** Which position the switch is in on this frame; null when the frame has no such input. */
export function switchPos(input: SwitchInput, f: RawFrame): SwitchPos | null {
    if (input.kind === 'button') return ((f.buttons >> input.bit) & 1) === 1 ? 2 : 0;
    if (input.index >= f.axes.length) return null;
    const v = f.axes[input.index];
    if (!Number.isFinite(v)) return null;
    return v < -1 / 3 ? 0 : v > 1 / 3 ? 2 : 1;
}

/** The flight mode the switch selects on this frame (the low position's when it cannot be read). */
export function switchMode(ms: ModeSwitch, f: RawFrame): FlightMode {
    return ms.modes[switchPos(ms.input, f) ?? 0];
}

/** ch[5] for this frame: MODE_CHANNEL of the selected mode. */
export function switchChannel(ms: ModeSwitch, f: RawFrame): number {
    return MODE_CHANNEL[switchMode(ms, f)];
}

export function isFlightMode(v: unknown): v is FlightMode {
    return typeof v === 'string' && (FLIGHT_MODES as readonly string[]).includes(v);
}

/**
 * A stored or imported mode switch, checked: null when it cannot be read (the profile then loads
 * without one, so its sticks are never lost over a broken extra). Unknown fields are dropped.
 */
export function validModeSwitch(v: unknown): ModeSwitch | null {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    const o = v as { input?: unknown; modes?: unknown };
    const i = o.input as { kind?: unknown; index?: unknown; bit?: unknown } | null | undefined;
    let input: SwitchInput;
    if (i?.kind === 'axis' && Number.isInteger(i.index) && (i.index as number) >= 0 && (i.index as number) <= MAX_AXIS) input = { kind: 'axis', index: i.index as number };
    else if (i?.kind === 'button' && Number.isInteger(i.bit) && (i.bit as number) >= 0 && (i.bit as number) <= MAX_BIT) input = { kind: 'button', bit: i.bit as number };
    else return null;
    const m = o.modes;
    if (!Array.isArray(m) || m.length !== 3 || !m.every(isFlightMode)) return null;
    return { input, modes: [m[0], m[1], m[2]] };
}

export function copyModeSwitch(ms: ModeSwitch | null | undefined): ModeSwitch | null {
    return ms ? { input: { ...ms.input }, modes: [ms.modes[0], ms.modes[1], ms.modes[2]] } : null;
}

export function sameInput(a: SwitchInput, b: SwitchInput): boolean {
    return a.kind === 'axis' ? b.kind === 'axis' && a.index === b.index : b.kind === 'button' && a.bit === b.bit;
}

// -------------------------------------------------------------- finding the switch (check screen)

export const MODE_SWITCH_TUNING = {
    /** a level counts once the channel holds it this long (the arm step's ARM_LEVEL_MS) */
    LEVEL_MS: 300,
    /** peak-to-peak spread a still channel stays within (the wizard's STILL_P2P) */
    STILL_P2P: 0.10,
    /**
     * the smallest hop between two held levels that can be a flip: half of a 3-position switch's
     * step (-1 / 0 / +1). Noise or drift sitting on a third's border never moves this far.
     */
    MIN_HOP: 0.45,
    /**
     * a switch changes within a report or two; a knob or a slider passes every value in between:
     * the biggest single-report step must be at least this share of the hop (the arm's ARM_STEP_FRAC)
     */
    STEP_FRAC: 0.40
} as const;

const MT = MODE_SWITCH_TUNING;

/** A switch flip seen: from one held position to another. */
export interface SwitchFlip { input: SwitchInput; from: SwitchPos; to: SwitchPos }

/**
 * Watches every channel that is not excluded (the sticks, the arm switch) for a switch flip: a
 * still level held LEVEL_MS, then a jump to a level in another position, held LEVEL_MS again.
 * Noise and drift stay in one position; a knob or a slider is a sweep (no single big step) and is
 * never taken in this watch; a glitch shorter than LEVEL_MS is not a level. Buttons: a bit that
 * changed and holds LEVEL_MS. Nothing is ever taken because time passed: only a held new position.
 */
export class ModeSwitchDetector {
    private n = 0;
    private v = new Float64Array(0);
    private wMin = new Float64Array(0);
    private wMax = new Float64Array(0);
    private wSum = new Float64Array(0);
    private wN = new Float64Array(0);
    private stillSince = new Float64Array(0);
    private level = new Float64Array(0); // the last held level (NaN: none yet)
    private stepMax = new Float64Array(0); // biggest single-report step since that level
    private swept = new Uint8Array(0);
    private bits = 0;
    private bitSince = new Float64Array(24);
    private bitLevel = 0; // the held value of every bit
    private started = false;
    private now = 0;
    private exAxes = new Set<number>();
    private exBits = new Set<number>();

    /** Inputs never taken: the stick channels and the arm switch. */
    exclude(axes: Iterable<number>, bits: Iterable<number>): void {
        this.exAxes = new Set(axes);
        this.exBits = new Set(bits);
    }

    /** Forget every level: a new watch (a new check screen, or "find the switch again"). */
    reset(): void {
        this.started = false;
        this.n = 0;
    }

    /** One frame; a flip that just completed, or null. */
    feed(f: RawFrame): SwitchFlip | null {
        const t = f.t > this.now ? f.t : this.now;
        this.now = t;
        if (!this.started) { this.init(f, t); return null; }
        for (let i = 0; i < this.n; i++) {
            const x = f.axes[i];
            const d = x > this.v[i] ? x - this.v[i] : this.v[i] - x;
            if (d > this.stepMax[i]) this.stepMax[i] = d;
            this.v[i] = x;
            const lo = x < this.wMin[i] ? x : this.wMin[i];
            const hi = x > this.wMax[i] ? x : this.wMax[i];
            if (hi - lo > MT.STILL_P2P) { this.stillSince[i] = t; this.wMin[i] = x; this.wMax[i] = x; this.wSum[i] = x; this.wN[i] = 1; }
            else { this.wMin[i] = lo; this.wMax[i] = hi; this.wSum[i] += x; this.wN[i]++; }
        }
        const changed = f.buttons ^ this.bits;
        if (changed) {
            for (let b = 0; b < 24; b++) if (changed & (1 << b)) this.bitSince[b] = t;
            this.bits = f.buttons;
        }
        return this.evaluate(t);
    }

    /** Time without a frame: the held values count on (a pad that reports only changes). */
    tick(t: number): SwitchFlip | null {
        if (!this.started || t <= this.now) return null;
        this.now = t;
        return this.evaluate(t);
    }

    private init(f: RawFrame, t: number): void {
        const n = Math.min(32, f.axes.length);
        this.n = n;
        const F = () => new Float64Array(n);
        this.v = F(); this.wMin = F(); this.wMax = F(); this.wSum = F(); this.wN = F(); this.stillSince = F();
        this.level = F().fill(NaN); this.stepMax = F(); this.swept = new Uint8Array(n);
        for (let i = 0; i < n; i++) {
            const x = f.axes[i];
            this.v[i] = x; this.wMin[i] = x; this.wMax[i] = x; this.wSum[i] = x; this.wN[i] = 1; this.stillSince[i] = t;
        }
        this.bits = f.buttons;
        this.bitLevel = f.buttons;
        this.bitSince.fill(t);
        this.started = true;
    }

    private evaluate(t: number): SwitchFlip | null {
        let found: SwitchFlip | null = null;
        for (let i = 0; i < this.n; i++) {
            if (t - this.stillSince[i] < MT.LEVEL_MS) continue;
            const m = this.wN[i] > 0 ? this.wSum[i] / this.wN[i] : this.v[i];
            const prev = this.level[i];
            if (Number.isNaN(prev)) { this.level[i] = m; this.stepMax[i] = 0; continue; }
            const from = posOf(prev), to = posOf(m);
            const hop = Math.abs(m - prev);
            if (from !== to && hop >= MT.MIN_HOP) {
                // a knob or a slider sweeps: it is never the mode switch in this watch
                if (this.stepMax[i] < MT.STEP_FRAC * hop) this.swept[i] = 1;
                else if (!this.swept[i] && !this.exAxes.has(i) && !found) found = { input: { kind: 'axis', index: i }, from, to };
            }
            this.level[i] = m;
            this.stepMax[i] = 0;
        }
        const diff = this.bits ^ this.bitLevel;
        if (diff) {
            for (let b = 0; b < 24; b++) {
                if (!(diff & (1 << b)) || t - this.bitSince[b] < MT.LEVEL_MS) continue;
                const on = (this.bits >> b) & 1;
                this.bitLevel = on ? this.bitLevel | (1 << b) : this.bitLevel & ~(1 << b);
                if (!this.exBits.has(b) && !found) found = { input: { kind: 'button', bit: b }, from: on ? 0 : 2, to: on ? 2 : 0 };
            }
        }
        return found;
    }
}

function posOf(v: number): SwitchPos {
    return v < -1 / 3 ? 0 : v > 1 / 3 ? 2 : 1;
}
