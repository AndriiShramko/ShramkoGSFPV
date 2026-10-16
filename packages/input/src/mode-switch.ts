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
//
// A 3-position switch some controllers report as two button bits (the DJI FPV Remote Controller 3:
// one bit per end, neither in the middle; docs/research/radios/dji-rc3.md) is ONE input of its own
// kind, 'bits': `lo` on = low, `hi` on = high, neither = middle. Both on, which such a switch never
// sends, reads as the middle (no end is clearly selected). Everything that reads a switch input
// (positions here, microseconds and channel numbers in switches.ts, the screens' names) takes it like
// an axis switch with three positions.
import { MODE_CHANNEL } from '@gsfpv/sim-core';
import type { FlightMode } from '@gsfpv/sim-core';
import type { RawFrame } from './calib';
import { FRAME_BUTTONS } from './frame';

/**
 * The input a switch is read from: an axis channel (0-based), a button bit, or a 3-position switch
 * sent as two mutually exclusive button bits (`lo` on = low position, `hi` on = high, neither = middle).
 */
export type SwitchInput = { kind: 'axis'; index: number } | { kind: 'button'; bit: number } | { kind: 'bits'; lo: number; hi: number };
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

/** Highest axis index and button bit a profile may name (8 HID channels, a frame's 24 button bits; pads have fewer). */
const MAX_AXIS = 31;
const MAX_BIT = FRAME_BUTTONS - 1;

/** Which position the switch is in on this frame; null when the frame has no such input. */
export function switchPos(input: SwitchInput, f: RawFrame): SwitchPos | null {
    if (input.kind === 'button') return ((f.buttons >> input.bit) & 1) === 1 ? 2 : 0;
    if (input.kind === 'bits') return bitsPos(input, f.buttons);
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

/** The position of a two-bit switch for a button mask: lo on = low, hi on = high, neither (or both) = middle. */
export function bitsPos(input: { lo: number; hi: number }, buttons: number): SwitchPos {
    const lo = ((buttons >> input.lo) & 1) === 1;
    const hi = ((buttons >> input.hi) & 1) === 1;
    return lo === hi ? 1 : lo ? 0 : 2;
}

export function isFlightMode(v: unknown): v is FlightMode {
    return typeof v === 'string' && (FLIGHT_MODES as readonly string[]).includes(v);
}

/**
 * A stored or imported switch input, checked (an axis 0..31, a button bit 0..23, or two different bits
 * 0..23); null when it cannot be read. A build from before the 'bits' kind returns null for one, so it
 * drops that range or mode switch and keeps the profile (its rule for anything it cannot read).
 */
export function validSwitchInput(v: unknown): SwitchInput | null {
    const i = v as { kind?: unknown; index?: unknown; bit?: unknown; lo?: unknown; hi?: unknown } | null | undefined;
    const isBit = (b: unknown): b is number => Number.isInteger(b) && (b as number) >= 0 && (b as number) <= MAX_BIT;
    if (i?.kind === 'axis' && Number.isInteger(i.index) && (i.index as number) >= 0 && (i.index as number) <= MAX_AXIS) return { kind: 'axis', index: i.index as number };
    if (i?.kind === 'button' && isBit(i.bit)) return { kind: 'button', bit: i.bit };
    if (i?.kind === 'bits' && isBit(i.lo) && isBit(i.hi) && i.lo !== i.hi) return { kind: 'bits', lo: i.lo, hi: i.hi };
    return null;
}

/**
 * A stored or imported mode switch, checked: null when it cannot be read (the profile then loads
 * without one, so its sticks are never lost over a broken extra). Unknown fields are dropped.
 */
export function validModeSwitch(v: unknown): ModeSwitch | null {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    const o = v as { input?: unknown; modes?: unknown };
    const input = validSwitchInput(o.input);
    if (!input) return null;
    const m = o.modes;
    if (!Array.isArray(m) || m.length !== 3 || !m.every(isFlightMode)) return null;
    return { input, modes: [m[0], m[1], m[2]] };
}

export function copyModeSwitch(ms: ModeSwitch | null | undefined): ModeSwitch | null {
    return ms ? { input: { ...ms.input }, modes: [ms.modes[0], ms.modes[1], ms.modes[2]] } : null;
}

export function sameInput(a: SwitchInput, b: SwitchInput): boolean {
    if (a.kind === 'axis') return b.kind === 'axis' && a.index === b.index;
    if (a.kind === 'button') return b.kind === 'button' && a.bit === b.bit;
    return b.kind === 'bits' && a.lo === b.lo && a.hi === b.hi;
}

/** The button bits an input reads (none for an axis). */
export function inputBits(i: SwitchInput): number[] {
    return i.kind === 'button' ? [i.bit] : i.kind === 'bits' ? [i.lo, i.hi] : [];
}

/** A short stable text for an input (a select's value, a rebuild key): a6, b4, p6.7. */
export function inputKey(i: SwitchInput): string {
    return i.kind === 'axis' ? `a${i.index}` : i.kind === 'button' ? `b${i.bit}` : `p${i.lo}.${i.hi}`;
}

/** inputKey back to an input; null for a text that is not one. */
export function inputFromKey(k: string): SwitchInput | null {
    const m = /^(?:a(\d+)|b(\d+)|p(\d+)\.(\d+))$/.exec(k);
    if (!m) return null;
    if (m[1] !== undefined) return validSwitchInput({ kind: 'axis', index: Number(m[1]) });
    if (m[2] !== undefined) return validSwitchInput({ kind: 'button', bit: Number(m[2]) });
    return validSwitchInput({ kind: 'bits', lo: Number(m[3]), hi: Number(m[4]) });
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
 * changed and holds LEVEL_MS. Two-bit switches (kind 'bits'): a pair named up front (`pairs`, a
 * recognised controller's switches) is watched as one 3-position switch, so a flip into its middle
 * (one bit off, none on) is that switch too; an unknown pair is learned from an end-to-end flip, one
 * bit going off as another comes on within LEVEL_MS (through a short middle or none), and reported as
 * the pair; from then on it is one switch as well. Before a pair is known, a bit going off alone is
 * that button released. Nothing is ever taken because time passed: only a held new position.
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
    private bitSince = new Float64Array(FRAME_BUTTONS);
    private bitLevel = 0; // the held value of every bit
    private started = false;
    private now = 0;
    private exAxes = new Set<number>();
    private exBits = new Set<number>();
    /** two-bit switches named up front (`pairs`) */
    private given: { lo: number; hi: number }[] = [];
    /** the given ones and those learned from an end-to-end flip in this watch */
    private pairList: { lo: number; hi: number }[] = [];

    /** Inputs never taken: the stick channels and the arm switch. */
    exclude(axes: Iterable<number>, bits: Iterable<number>): void {
        this.exAxes = new Set(axes);
        this.exBits = new Set(bits);
    }

    /** Two-bit 3-position switches known before any flip (a recognised controller's): each is watched as one switch. */
    pairs(list: Iterable<{ lo: number; hi: number }>): void {
        this.given = [...list].map((p) => ({ lo: p.lo, hi: p.hi }));
        this.pairList = this.given.map((p) => ({ ...p }));
    }

    /** The two-bit switches this watch knows now (given and learned). */
    knownPairs(): { lo: number; hi: number }[] {
        return this.pairList.map((p) => ({ ...p }));
    }

    /** Forget every level and every learned pair: a new watch (a new check screen, or "find the switch again"). */
    reset(): void {
        this.started = false;
        this.n = 0;
        this.pairList = this.given.map((p) => ({ ...p }));
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
            for (let b = 0; b < FRAME_BUTTONS; b++) if (changed & (1 << b)) this.bitSince[b] = t;
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
        if (this.bits ^ this.bitLevel) {
            // the two-bit switches first: a pair moves as one switch once both its bits have held
            for (const p of this.pairList) {
                const mask = (1 << p.lo) | (1 << p.hi);
                const diff = (this.bits ^ this.bitLevel) & mask;
                if (!diff || !this.settled(diff, t)) continue;
                const from = bitsPos(p, this.bitLevel);
                this.bitLevel = (this.bitLevel & ~mask) | (this.bits & mask);
                const to = bitsPos(p, this.bitLevel);
                if (from !== to && !this.exBits.has(p.lo) && !this.exBits.has(p.hi) && !found) found = { input: { kind: 'bits', lo: p.lo, hi: p.hi }, from, to };
            }
            const diff = this.bits ^ this.bitLevel;
            for (let b = 0; b < FRAME_BUTTONS; b++) {
                if (!(diff & (1 << b)) || t - this.bitSince[b] < MT.LEVEL_MS || this.paired(b)) continue;
                const on = (this.bits >> b) & 1;
                // a bit that went off while another came on within LEVEL_MS: an end-to-end flip of a
                // two-bit switch, reported by the bit that came on (below), never by this one
                if (!on && this.partnerOf(b, 1, t) >= 0) continue;
                const off = on ? this.partnerOf(b, 0, t) : -1;
                if (off === -2) continue; // the other end went off just after this one came on: wait until it has held
                if (off >= 0) {
                    // learned: one switch from now on; the flip goes from the end that went off to this one
                    const p = { lo: Math.min(b, off), hi: Math.max(b, off) };
                    this.pairList.push(p);
                    const mask = (1 << p.lo) | (1 << p.hi);
                    const from = bitsPos(p, this.bitLevel);
                    this.bitLevel = (this.bitLevel & ~mask) | (this.bits & mask);
                    const to = bitsPos(p, this.bitLevel);
                    if (!this.exBits.has(b) && !this.exBits.has(off) && !found) found = { input: { kind: 'bits', lo: p.lo, hi: p.hi }, from, to };
                    continue;
                }
                this.bitLevel = on ? this.bitLevel | (1 << b) : this.bitLevel & ~(1 << b);
                if (!this.exBits.has(b) && !found) found = { input: { kind: 'button', bit: b }, from: on ? 0 : 2, to: on ? 2 : 0 };
            }
        }
        return found;
    }

    /** Every changed bit of `mask` has held LEVEL_MS. */
    private settled(mask: number, t: number): boolean {
        for (let b = 0; b < FRAME_BUTTONS; b++) if (mask & (1 << b) && t - this.bitSince[b] < MT.LEVEL_MS) return false;
        return true;
    }

    private paired(b: number): boolean {
        return this.pairList.some((p) => p.lo === b || p.hi === b);
    }

    /**
     * An unpaired, not excluded bit other than `b` whose change is pending in the other direction:
     * `want` 1 = it came on, 0 = it went off, within LEVEL_MS of `b`'s change. -1 = none; for `want` 0,
     * -2 = there is one but it has not held yet (the end-to-end flip is complete only when both ends have).
     */
    private partnerOf(b: number, want: 0 | 1, t: number): number {
        let waiting = false;
        for (let c = 0; c < FRAME_BUTTONS; c++) {
            if (c === b || this.exBits.has(c) || this.paired(c)) continue;
            const now = (this.bits >> c) & 1;
            const held = (this.bitLevel >> c) & 1;
            if (now !== want || held === want) continue;
            if (Math.abs(this.bitSince[c] - this.bitSince[b]) >= MT.LEVEL_MS) continue;
            if (want === 0 && t - this.bitSince[c] < MT.LEVEL_MS) { waiting = true; continue; }
            return c;
        }
        return waiting ? -2 : -1;
    }
}

function posOf(v: number): SwitchPos {
    return v < -1 / 3 ? 0 : v > 1 / 3 ? 2 : 1;
}
