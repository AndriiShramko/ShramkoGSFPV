// The radio's channel functions, "Switches" (v0.7 lane D2; the pilot's idea R-20261006-0003: "mode on
// CH5 and arm on CH6 like on my radio"). No DOM.
//
// The model is Betaflight's Modes tab: a function is on while its channel sits inside a range of
// microseconds. Read from Betaflight 4.5.1 (GPL-3.0, re-implemented, docs/PROVENANCE.md):
// rc_modes.c isRangeActive (on when start <= value < end, the value clamped to 900..2099, ranges on
// a 25 us grid of 900..2100) and updateMasksForMac (ranges of one mode OR together; AND ranges make
// the mode on only when all of them are on, unless an OR range is on), core.c (Angle wins over
// Horizon, neither is Acro).
//
// Functions: `arm`, `angle`, `horizon`, and the app's actions a switch can run, by their keymap ids
// (an action runs once each time its switch enters the range, as if its key were pressed).
//
// Channel values: an axis is 1500 + 512 x its -1..1 reading (EdgeTX sends +-100 % as 988..2012 us
// over CRSF; its USB joystick carries the same +-100 % as +-1). EdgeTX's USB joystick reports
// channels 9..32 as buttons, on when the channel is above its centre, so a button reads 2012 or 988.
//
// Who decides (calib.ts mapFrame / profileArmLevel, apps/fly controls.ts): arm = the arm ranges when a
// profile has any, else the setup wizard's arm (Profile.arm: a switch, a latching button, Space).
// Flight mode = the angle / horizon ranges once a profile has `switches` (none of them: the pilot's
// own mode), else the wizard's mode switch. A profile without `switches` behaves exactly as before.

import { MODE_CHANNEL } from '@gsfpv/sim-core';
import type { BfAuxCondition, FlightMode } from '@gsfpv/sim-core';
import type { ArmMap, Profile, RawFrame } from './calib';
import { DEFAULT_SWITCH_MODES, sameInput, validSwitchInput } from './mode-switch';
import type { SwitchInput, SwitchModes } from './mode-switch';

/** The app's actions a switch can run: keymap action ids of @gsfpv/prefs (a test keeps them shipped). */
export type SwitchAction = 'respawn.rewind' | 'respawn.start' | 'record.toggle' | 'pause.toggle' | 'scene.next' | 'scene.random' | 'hud.toggle';
export const SWITCH_ACTIONS: readonly SwitchAction[] = ['respawn.rewind', 'respawn.start', 'record.toggle', 'pause.toggle', 'scene.next', 'scene.random', 'hud.toggle'];
export type SwitchFn = 'arm' | 'angle' | 'horizon' | SwitchAction;
export const SWITCH_FNS: readonly SwitchFn[] = ['arm', 'angle', 'horizon', ...SWITCH_ACTIONS];

/** One condition: `fn` is on while `input` reads lo <= us < hi (Betaflight's mode activation condition). */
export interface SwitchRange {
    fn: SwitchFn;
    input: SwitchInput;
    /** microseconds, 900..2100 on the 25 us grid, lo < hi */
    lo: number;
    hi: number;
    /** Betaflight's AND logic: with other AND ranges of the same function, all must be on */
    and?: true;
}

/** Profile.switches: every range in use. Version 1. */
export interface Switches { v: 1; ranges: SwitchRange[] }

export const US_MIN = 900;
export const US_MAX = 2100;
export const US_STEP = 25;
const US_CENTRE = 1500;
/** us per unit of a -1..1 reading: +-100 % is 988..2012 us */
const US_HALF = 512;
/** Betaflight's MAX_MODE_ACTIVATION_CONDITION_COUNT */
export const MAX_RANGES = 20;
/**
 * A switch position's band: the thirds of the travel the wizard uses (mode-switch.ts: below -1/3,
 * above +1/3) on the 25 us grid. A button's two positions split at the centre.
 */
export const POSITION_BANDS: readonly (readonly [number, number])[] = [[900, 1325], [1325, 1675], [1675, 2100]];
const BUTTON_BANDS: readonly (readonly [number, number])[] = [[900, 1500], [900, 1500], [1500, 2100]];

/** The channel's value in us on this frame (Betaflight's clamp to 900..2099), or null when the frame has no such input. */
export function channelUs(input: SwitchInput, f: RawFrame): number | null {
    if (input.kind === 'button') return input.bit >= 0 && input.bit <= 23 ? (((f.buttons >> input.bit) & 1) === 1 ? US_CENTRE + US_HALF : US_CENTRE - US_HALF) : null;
    if (input.index >= f.axes.length) return null;
    const v = f.axes[input.index];
    if (!Number.isFinite(v)) return null;
    const us = US_CENTRE + US_HALF * v;
    return us < US_MIN ? US_MIN : us > US_MAX - 1 ? US_MAX - 1 : us;
}

/** Is the range on for this frame? */
export function rangeOn(r: SwitchRange, f: RawFrame): boolean {
    const us = channelUs(r.input, f);
    return us !== null && r.lo < r.hi && us >= r.lo && us < r.hi;
}

/** Does any range serve this function? */
export function hasFn(sw: Switches, fn: SwitchFn): boolean {
    return sw.ranges.some((r) => r.fn === fn);
}

/** Is the function on: any OR range on, or AND ranges that are all on (Betaflight's mask logic). */
export function fnOn(sw: Switches, fn: SwitchFn, f: RawFrame): boolean {
    let or = false;
    let ands = 0;
    let andsOn = 0;
    for (const r of sw.ranges) {
        if (r.fn !== fn) continue;
        const on = rangeOn(r, f);
        if (r.and) { ands++; if (on) andsOn++; } else if (on) or = true;
    }
    return or || (ands > 0 && andsOn === ands);
}

/** The arm level the ranges give, or null when they have no arm range (the wizard's arm decides). */
export function rangesArm(sw: Switches | undefined, f: RawFrame): boolean | null {
    return sw && hasFn(sw, 'arm') ? fnOn(sw, 'arm', f) : null;
}

/** Does this profile's flight mode come from the ranges (it has angle or horizon ranges)? */
export function hasModeRanges(sw: Switches): boolean {
    return hasFn(sw, 'angle') || hasFn(sw, 'horizon');
}

/** The flight mode the ranges select (Angle over Horizon, neither: Acro), or null when they have no mode range. */
export function rangesMode(sw: Switches | undefined, f: RawFrame): FlightMode | null {
    if (!sw || !hasModeRanges(sw)) return null;
    return fnOn(sw, 'angle', f) ? 'angle' : fnOn(sw, 'horizon', f) ? 'horizon' : 'acro';
}

/** ch[5] for the ranges' mode (acro when they have none; Controls then writes the pilot's mode). */
export function rangesModeChannel(sw: Switches, f: RawFrame): number {
    return MODE_CHANNEL[rangesMode(sw, f) ?? 'acro'];
}

/** A deep copy (ranges and their inputs), so an edited copy never reaches a saved profile. */
export function copySwitches(sw: Switches): Switches {
    return { v: 1, ranges: sw.ranges.map((r) => ({ ...r, input: { ...r.input } })) };
}

/** A stored or imported value: the usable ranges (at most 20) and how many were dropped; null switches when it is not one. */
export function readSwitches(v: unknown): { switches: Switches | null; dropped: number } {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return { switches: null, dropped: 0 };
    const o = v as { v?: unknown; ranges?: unknown };
    if (o.v !== 1 || !Array.isArray(o.ranges)) return { switches: null, dropped: 0 };
    const ranges: SwitchRange[] = [];
    let dropped = 0;
    for (const x of o.ranges) {
        const r = x as Partial<Record<keyof SwitchRange, unknown>> | null;
        const input = validSwitchInput(r?.input);
        const ok = !!r && !!input && (SWITCH_FNS as readonly unknown[]).includes(r.fn) && onGrid(r.lo) && onGrid(r.hi) && (r.lo as number) < (r.hi as number) && (r.and === undefined || r.and === true);
        if (!ok || ranges.length >= MAX_RANGES) { dropped++; continue; }
        ranges.push({ fn: r.fn as SwitchFn, input: input!, lo: r.lo as number, hi: r.hi as number, ...(r.and === true ? { and: true as const } : {}) });
    }
    return { switches: { v: 1, ranges }, dropped };
}

function onGrid(v: unknown): v is number {
    return typeof v === 'number' && Number.isInteger(v) && v >= US_MIN && v <= US_MAX && (v - US_MIN) % US_STEP === 0;
}

/** A value moved onto the 25 us grid of 900..2100 (Betaflight's CHANNEL_VALUE_TO_STEP rounds down; a handle rounds to the nearest). */
export function snapUs(us: number): number {
    const c = us < US_MIN ? US_MIN : us > US_MAX ? US_MAX : us;
    return US_MIN + US_STEP * Math.round((c - US_MIN) / US_STEP);
}

/** The position band an input's level falls in (a button: released or pressed). */
export function bandOf(input: SwitchInput, us: number): readonly [number, number] {
    const bands = input.kind === 'button' ? BUTTON_BANDS : POSITION_BANDS;
    return bands.find(([lo, hi]) => us >= lo && us < hi) ?? bands[2];
}

/** The switches with every range of `fn` replaced by one range (flip-to-assign, a new channel). */
export function assignRange(sw: Switches, fn: SwitchFn, input: SwitchInput, lo: number, hi: number): Switches {
    const out = copySwitches(sw);
    out.ranges = out.ranges.filter((r) => r.fn !== fn);
    out.ranges.push({ fn, input: { ...input }, lo, hi });
    return out;
}

/** The one input every angle / horizon range reads, or null (none, or several inputs). */
export function modeInput(sw: Switches): SwitchInput | null {
    const list = sw.ranges.filter((r) => r.fn === 'angle' || r.fn === 'horizon');
    if (!list.length) return null;
    const i = list[0].input;
    return list.every((r) => sameInput(r.input, i)) ? { ...i } : null;
}

/** The mode each position of `input` gives under these ranges (low, middle, high; a button: released, -, pressed). */
export function modePositions(sw: Switches, input: SwitchInput): SwitchModes {
    const frameAt = (us: number): RawFrame => {
        if (input.kind === 'button') return { t: 0, axes: new Float32Array(0), buttons: us >= US_CENTRE ? 1 << input.bit : 0 };
        const axes = new Float32Array(input.index + 1);
        axes[input.index] = (us - US_CENTRE) / US_HALF;
        return { t: 0, axes, buttons: 0 };
    };
    const only: Switches = { v: 1, ranges: sw.ranges.filter((r) => (r.fn === 'angle' || r.fn === 'horizon') && sameInput(r.input, input)) };
    const at = (us: number): FlightMode => rangesMode(only, frameAt(us)) ?? 'acro';
    return input.kind === 'button' ? [at(988), at(988), at(2012)] : [at(1100), at(1500), at(1900)];
}

/**
 * The flight mode on one switch, position by position: every angle / horizon range goes, and each
 * position's band becomes a range of its mode (Acro needs none); neighbours with the same mode merge.
 */
export function setModePositions(sw: Switches, input: SwitchInput, modes: SwitchModes): Switches {
    const out = copySwitches(sw);
    out.ranges = out.ranges.filter((r) => r.fn !== 'angle' && r.fn !== 'horizon');
    const bands = input.kind === 'button' ? [BUTTON_BANDS[0], BUTTON_BANDS[2]] : POSITION_BANDS;
    const ms = input.kind === 'button' ? [modes[0], modes[2]] : modes;
    let i = 0;
    while (i < bands.length) {
        let j = i;
        while (j + 1 < bands.length && ms[j + 1] === ms[i]) j++;
        const m = ms[i];
        if (m === 'angle' || m === 'horizon') out.ranges.push({ fn: m, input: { ...input }, lo: bands[i][0], hi: bands[j][1] });
        i = j + 1;
    }
    return out;
}

/** An arm the wizard made, as a range: a switch or a held button; null for a latching button or Space. */
function armRange(a: ArmMap | null, fn: 'arm' | 'angle'): SwitchRange | null {
    if (!a || a.kind === 'key') return null;
    if (a.kind === 'button') {
        if (a.toggle) return null;
        const [lo, hi] = a.inverted ? BUTTON_BANDS[0] : BUTTON_BANDS[2];
        return { fn, input: { kind: 'button', bit: a.bit }, lo, hi };
    }
    const t = US_CENTRE + US_HALF * a.threshold;
    const lo = a.onAbove ? US_MIN + US_STEP * Math.ceil((t - US_MIN) / US_STEP) : US_MIN;
    const hi = a.onAbove ? US_MAX : US_MIN + US_STEP * Math.floor((t - US_MIN) / US_STEP);
    const clo = lo < US_MIN ? US_MIN : lo > US_MAX ? US_MAX : lo;
    const chi = hi < US_MIN ? US_MIN : hi > US_MAX ? US_MAX : hi;
    return clo < chi ? { fn, input: { kind: 'axis', index: a.index }, lo: clo, hi: chi } : null;
}

/**
 * What the setup wizard decided, as ranges: the Switches screen's starting point. The arm switch's
 * threshold becomes a range (a latching button or Space has none and keeps deciding the arm), the
 * mode switch's positions become position bands, v0.1's angle switch an Angle range.
 */
export function switchesFromProfile(p: Profile): Switches {
    let sw: Switches = { v: 1, ranges: [] };
    const arm = armRange(p.arm, 'arm');
    if (arm) sw.ranges.push(arm);
    if (p.modeSwitch) sw = setModePositions(sw, p.modeSwitch.input, p.modeSwitch.modes);
    else {
        const angle = armRange(p.angleMode, 'angle');
        if (angle) sw.ranges.push(angle);
    }
    return sw;
}

/** The radio channel (1-based) an input is on a USB EdgeTX radio: axes CH1..CH8, buttons CH9..CH32. */
export function channelOf(input: SwitchInput): number {
    return input.kind === 'axis' ? input.index + 1 : input.bit + 9;
}

/** The device a radio profile is for: a USB radio through WebHID ('hid') or a gamepad ('gamepad'). */
export type RadioDevice = 'hid' | 'gamepad';

/** How the pilot reads an input: a channel number ("CH6") or a gamepad's button ("button 3"). */
export interface InputName { kind: 'ch' | 'button'; n: number }

/**
 * The one naming of a switch input (the Switches screen, the HUD's arm label and mode chip). A USB
 * radio: its channel (channelOf, buttons are CH9..CH32 on EdgeTX). A gamepad: an axis by its number
 * and a button as "button n", 1-based, as the wizard names them (a gamepad has no channels).
 */
export function inputName(input: SwitchInput, device: RadioDevice): InputName {
    if (device === 'hid') return { kind: 'ch', n: channelOf(input) };
    return input.kind === 'axis' ? { kind: 'ch', n: input.index + 1 } : { kind: 'button', n: input.bit + 1 };
}

/** The input a radio channel arrives on over USB (EdgeTX joystick, classic layout). */
export function channelInput(ch: number): SwitchInput {
    return ch <= 8 ? { kind: 'axis', index: ch - 1 } : { kind: 'button', bit: ch - 9 };
}

/** What a Betaflight import did with each condition. */
export interface AuxImport {
    switches: Switches;
    applied: BfAuxCondition[];
    /** conditions not applied: a mode the simulator does not have, or one that follows another mode */
    skipped: { cond: BfAuxCondition; why: 'notInSimulator' | 'linked' | 'tooMany' }[];
}

const BF_MODES: Readonly<Record<string, SwitchFn>> = { ARM: 'arm', ANGLE: 'angle', HORIZON: 'horizon' };

/**
 * Betaflight's `aux` conditions (parseBetaflightDiff(...).aux) as switches: ARM, ANGLE and HORIZON
 * with their channel, range and logic; everything else is listed as skipped. The result replaces the
 * switches as a whole, like loading the Modes tab of the quad.
 */
export function switchesFromBetaflight(aux: readonly BfAuxCondition[]): AuxImport {
    const out: AuxImport = { switches: { v: 1, ranges: [] }, applied: [], skipped: [] };
    for (const c of aux) {
        const fn = Object.hasOwn(BF_MODES, c.mode) ? BF_MODES[c.mode] : null;
        if (!fn) { out.skipped.push({ cond: c, why: 'notInSimulator' }); continue; }
        if (c.linkedTo !== null) { out.skipped.push({ cond: c, why: 'linked' }); continue; }
        if (out.switches.ranges.length >= MAX_RANGES) { out.skipped.push({ cond: c, why: 'tooMany' }); continue; }
        out.switches.ranges.push({ fn, input: channelInput(c.channel), lo: c.lo, hi: c.hi, ...(c.and ? { and: true as const } : {}) });
        out.applied.push(c);
    }
    return out;
}

/** The functions a Betaflight diff decides (the quad's Modes tab): arm and the flight mode. */
export const BETAFLIGHT_FNS: readonly SwitchFn[] = ['arm', 'angle', 'horizon'];

/** A Betaflight import laid over the pilot's switches (importOver): the result and what the pilot is told. */
export interface ImportOver {
    switches: Switches;
    /** the simulator's own function ranges kept from before (rewind, record...), in their order */
    kept: SwitchRange[];
    /** kept ranges that did not fit under MAX_RANGES after the diff's (removed) */
    dropped: number;
    /** the diff sets no ARM: the setup wizard's arm still arms (Profile.arm) */
    noArm: boolean;
    /** the diff sets no ANGLE / HORIZON (the quad flies Acro): the pilot picks the mode in the simulator */
    noMode: boolean;
}

/**
 * The diff's ARM / ANGLE / HORIZON ranges (switchesFromBetaflight) over the pilot's switches: they
 * replace arm and the flight mode as a whole, as loading the quad's Modes tab does; the simulator's
 * own functions (rewind, record...), which no diff has, stay as they were, after the diff's ranges
 * while MAX_RANGES allows. `current` undefined: the wizard's setup, nothing of the pilot's to keep.
 */
export function importOver(current: Switches | undefined, imported: Switches): ImportOver {
    const ranges = copySwitches(imported).ranges;
    const kept: SwitchRange[] = [];
    let dropped = 0;
    for (const r of current?.ranges ?? []) {
        if (BETAFLIGHT_FNS.includes(r.fn)) continue;
        if (ranges.length >= MAX_RANGES) { dropped++; continue; }
        const k = { ...r, input: { ...r.input } };
        ranges.push(k);
        kept.push(k);
    }
    return {
        switches: { v: 1, ranges },
        kept,
        dropped,
        noArm: !hasFn(imported, 'arm'),
        noMode: !hasModeRanges(imported)
    };
}

/**
 * Runs actions on switch edges: each time an action's switch goes from off to on. The first frame
 * (and a range just added) only learns where the switch is, so a switch already on never fires.
 */
export class SwitchActionWatch {
    private prev = new Map<SwitchAction, boolean>();

    reset(): void {
        this.prev.clear();
    }

    /** The actions to run for this frame, in SWITCH_ACTIONS order. */
    update(sw: Switches | undefined, f: RawFrame): SwitchAction[] {
        if (!sw) { this.prev.clear(); return []; }
        const out: SwitchAction[] = [];
        for (const a of SWITCH_ACTIONS) {
            if (!hasFn(sw, a)) { this.prev.delete(a); continue; }
            const on = fnOn(sw, a, f);
            if (this.prev.get(a) === false && on) out.push(a);
            this.prev.set(a, on);
        }
        return out;
    }
}

/** Default modes of a newly assigned flight-mode switch: the wizard's (low acro, middle horizon, high angle). */
export function defaultSwitchModes(): SwitchModes {
    return [DEFAULT_SWITCH_MODES[0], DEFAULT_SWITCH_MODES[1], DEFAULT_SWITCH_MODES[2]];
}
