// Betaflight's mode switches as a CLI `diff` prints them: the `aux` lines (Modes tab ranges) and the
// `map` line (channel order), read for the radio's Switches screen (packages/input switches.ts).
//
// Format and meanings read from Betaflight 4.5.1 (GPL-3.0): src/main/cli/cli.c (printAux, cliAux,
// processChannelRangeArgs, printMap), src/main/fc/rc_modes.h (MAX_MODE_ACTIVATION_CONDITION_COUNT,
// CHANNEL_RANGE_MIN / MAX, MODE_STEP_TO_CHANNEL_VALUE), src/main/fc/rc_modes.c (isRangeActive and the
// OR / AND logic), src/main/msp/msp_box.c (the permanent ids printed by `aux`) and src/main/rx/rx.h /
// rx.c (MAX_AUX_CHANNEL_COUNT, rcChannelLetters, parseRcChannels). Nothing was copied; see
// docs/PROVENANCE.md.
//
// `aux <slot> <permanent id> <aux channel> <start us> <end us> <logic> <linked permanent id>`: slot
// 0..19, aux channel 0 = AUX1, start / end on the 25 us grid of 900..2100, logic 0 OR / 1 AND, linked
// 0 none. A slot whose start is not below its end and that is linked to nothing is unused (that is how
// `diff all` prints the free slots) and is skipped. A line the firmware cannot have printed is an
// error for the caller, which refuses the whole import (bfdiff.ts's rule).

/** One mode activation condition of the dump, in the radio's channel numbers. */
export interface BfAuxCondition {
    /** the slot, 0..19 */
    slot: number;
    /** Betaflight's permanent box id (msp_box.c), e.g. 0 ARM, 1 ANGLE, 2 HORIZON */
    modeId: number;
    /** Betaflight's box name ("ARM", "AIR MODE"), or "MODE <id>" for an id this table does not know */
    mode: string;
    /** the radio channel, 1-based: AUX1 is CH5 unless a `map` line moves it */
    channel: number;
    /** range start and end in microseconds, as printed (900..2100, step 25); on when start <= value < end */
    lo: number;
    hi: number;
    /** logic 1 (AND) instead of 0 (OR) */
    and: boolean;
    /** the mode this one follows instead of a range (its `linked` id), or null */
    linkedTo: string | null;
}

/** MAX_MODE_ACTIVATION_CONDITION_COUNT */
export const AUX_SLOTS = 20;
/** MAX_AUX_CHANNEL_COUNT: 18 supported RC channels minus the four sticks */
export const AUX_CHANNELS = 14;
export const CHANNEL_US_MIN = 900;
export const CHANNEL_US_MAX = 2100;
export const CHANNEL_US_STEP = 25;

/** Permanent box ids of Betaflight 4.5.1 (msp_box.c); later releases keep these ids. */
const BOX_NAMES: Readonly<Record<number, string>> = {
    0: 'ARM', 1: 'ANGLE', 2: 'HORIZON', 4: 'ANTI GRAVITY', 5: 'MAG', 6: 'HEADFREE', 7: 'HEADADJ', 8: 'CAMSTAB',
    12: 'PASSTHRU', 13: 'BEEPER', 15: 'LEDLOW', 17: 'CALIB', 19: 'OSD DISABLE', 20: 'TELEMETRY', 23: 'SERVO1',
    24: 'SERVO2', 25: 'SERVO3', 26: 'BLACKBOX', 27: 'FAILSAFE', 28: 'AIR MODE', 29: '3D DISABLE / SWITCH',
    30: 'FPV ANGLE MIX', 31: 'BLACKBOX ERASE', 32: 'CAMERA CONTROL 1', 33: 'CAMERA CONTROL 2', 34: 'CAMERA CONTROL 3',
    35: 'FLIP OVER AFTER CRASH', 36: 'PREARM', 37: 'GPS BEEP SATELLITE COUNT', 39: 'VTX PIT MODE', 40: 'USER1',
    41: 'USER2', 42: 'USER3', 43: 'USER4', 44: 'PID AUDIO', 45: 'PARALYZE', 46: 'GPS RESCUE', 47: 'ACRO TRAINER',
    48: 'VTX CONTROL DISABLE', 49: 'LAUNCH CONTROL', 50: 'MSP OVERRIDE', 51: 'STICK COMMANDS DISABLE',
    52: 'BEEPER MUTE', 53: 'READY', 54: 'LAP TIMER RESET'
};

/** Betaflight's name of a permanent box id. */
export function boxName(id: number): string {
    return Object.hasOwn(BOX_NAMES, id) ? BOX_NAMES[id] : `MODE ${id}`;
}

/** One `aux` line as numbers, before the channel map is applied. */
export interface AuxLine { slot: number; modeId: number; auxIndex: number; lo: number; hi: number; logic: number; linked: number }

/** Reads `aux ...`; a string is the reason the firmware cannot have printed it. */
export function parseAuxLine(line: string): AuxLine | string {
    const m = /^aux\s+(.*)$/i.exec(line.trim());
    if (!m) return 'not an aux line';
    const parts = m[1].trim().split(/\s+/);
    if (parts.length !== 7 || !parts.every((p) => /^\d+$/.test(p))) return `"${line.trim()}" is not "aux slot mode channel start end logic linked" with seven whole numbers`;
    const [slot, modeId, auxIndex, lo, hi, logic, linked] = parts.map(Number);
    if (slot >= AUX_SLOTS) return `"${line.trim()}": slot ${slot} is outside 0..${AUX_SLOTS - 1}`;
    if (auxIndex >= AUX_CHANNELS) return `"${line.trim()}": aux channel ${auxIndex} is outside 0..${AUX_CHANNELS - 1}`;
    for (const us of [lo, hi]) {
        if (us < CHANNEL_US_MIN || us > CHANNEL_US_MAX || (us - CHANNEL_US_MIN) % CHANNEL_US_STEP !== 0) return `"${line.trim()}": ${us} is not on the 25 us grid of ${CHANNEL_US_MIN}..${CHANNEL_US_MAX}`;
    }
    if (logic > 1) return `"${line.trim()}": logic ${logic} is neither 0 (OR) nor 1 (AND)`;
    return { slot, modeId, auxIndex, lo, hi, logic, linked };
}

/** The letters of `map` (rx.c rcChannelLetters): roll, pitch, yaw, throttle, AUX1..AUX4. */
const MAP_LETTERS = 'AERT1234';

/**
 * `map XXXXXXXX`: for each logical channel (A E R T 1 2 3 4) the physical channel (0-based) it reads,
 * as parseRcChannels sets rcmap; a string when the firmware cannot have printed it.
 */
export function parseMapLine(line: string): number[] | string {
    const m = /^map\s+(\S+)$/i.exec(line.trim());
    if (!m) return `"${line.trim()}" is not "map" with one word of eight letters`;
    const w = m[1].toUpperCase();
    if (w.length !== MAP_LETTERS.length || [...MAP_LETTERS].some((c) => w.indexOf(c) < 0 || w.indexOf(c) !== w.lastIndexOf(c))) {
        return `"${line.trim()}" is not a channel map: it must hold each of ${MAP_LETTERS} once`;
    }
    return [...MAP_LETTERS].map((c) => w.indexOf(c));
}

/**
 * The conditions that are in use, in the radio's channel numbers: AUX n reads physical channel
 * rcmap[3 + n] for AUX1..AUX4 (the mappable eight), and 3 + n beyond them (rx.c reads channels past the
 * mappable eight as they are). `map` null: the default AETR1234 map.
 */
export function auxConditions(lines: readonly AuxLine[], map: readonly number[] | null): BfAuxCondition[] {
    const out: BfAuxCondition[] = [];
    for (const l of lines) {
        const linked = l.linked !== 0;
        if (l.lo >= l.hi && !linked) continue; // a free slot
        const logical = 4 + l.auxIndex;
        const physical = map && logical < map.length ? map[logical] : logical;
        out.push({ slot: l.slot, modeId: l.modeId, mode: boxName(l.modeId), channel: physical + 1, lo: l.lo, hi: l.hi, and: l.logic === 1, linkedTo: linked ? boxName(l.linked) : null });
    }
    return out.sort((a, b) => a.slot - b.slot);
}

/**
 * Collects a dump's `aux` and `map` lines under the firmware's rules (each slot printed once, one
 * map), for a whole diff (parseBetaflightDiff) and for bare lines (parseAuxPaste) alike.
 */
export class AuxCollector {
    private lines = new Map<number, AuxLine>();
    private map: number[] | null = null;

    /** Is this an `aux` or a `map` line? */
    static takes(line: string): boolean {
        return /^(aux|map)\s/i.test(line.trim());
    }

    /** Reads one `aux` or `map` line: null, or why the firmware cannot have printed it. */
    add(line: string): string | null {
        if (/^aux\s/i.test(line.trim())) {
            const a = parseAuxLine(line);
            if (typeof a === 'string') return `${a}; the firmware cannot have printed it`;
            if (this.lines.has(a.slot)) return `aux slot ${a.slot} appears twice; the firmware prints each slot once`;
            this.lines.set(a.slot, a);
            return null;
        }
        const m = parseMapLine(line);
        if (typeof m === 'string') return `${m}; the firmware cannot have printed it`;
        if (this.map) return '"map" appears twice; the firmware prints it once';
        this.map = m;
        return null;
    }

    /** The conditions in use, in the radio's channel numbers (auxConditions with the map read). */
    conditions(): BfAuxCondition[] {
        return auxConditions([...this.lines.values()], this.map);
    }
}

/**
 * A paste of bare mode lines: the CLI's `aux` command output, or the aux block of a diff, with its
 * `map` line if any; `#` comments and blank lines are skipped. null when the text has any other line
 * (or no aux line at all): it is then a whole diff, for parseBetaflightDiff and its checks.
 */
export function parseAuxPaste(text: string): { aux: BfAuxCondition[]; errors: string[] } | null {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('#'));
    if (!lines.some((l) => /^aux\s/i.test(l)) || !lines.every((l) => AuxCollector.takes(l))) return null;
    const c = new AuxCollector();
    const errors: string[] = [];
    for (const l of lines) {
        const e = c.add(l);
        if (e) errors.push(`${e}. Paste the lines unedited.`);
    }
    return { aux: errors.length ? [] : c.conditions(), errors };
}
