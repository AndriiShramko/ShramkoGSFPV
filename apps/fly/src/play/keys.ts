// Keyboard flying as data (docs/wip/v08-a.md sections 0-2; the owner's message 21, item 1). Pure: no
// DOM, so Node tests, the keymap check and the key card read the same tables the page flies with.
//
// Two layouts:
//  - GAME (easy play, the default for a keyboard): what games for players use. W/S forward and back,
//    A/D left and right (a tilt; in angle mode the drone moves that way), the side arrows or Q/E turn,
//    the up/down arrows climb and sink (altitude help) or move a throttle that stays where it is left.
//    Shift is faster. Research: GoDrone's web UI (arrows altitude/yaw, WASD pitch/roll), "The Dude"
//    (WASD tilt, arrows turn), NEXUS FPV (Shift boost), Dronesim (an altitude hold key).
//  - MODE2 (the pilot profile): a Mode 2 radio laid on the keys, the layout before v0.8: W/S throttle,
//    A/D yaw, the arrows pitch and roll.
// Easy play turns a key into a stick target in physical units (degrees of tilt, degrees per second)
// through the drone's own rates, so every drone answers a key alike; the stick then ramps to it
// (slew()) instead of jumping (bang-bang was the pilot layout's 0.6 the moment a key went down).

import { setpointRate } from '@gsfpv/sim-core';
import type { FlightMode, RatesConfig } from '@gsfpv/sim-core';

/** How touch sticks and the keyboard fly (prefs input.play): easy play, or as a radio. */
export type PlayProfile = 'easy' | 'pilot';

/** What a flying key moves: roll, pitch, yaw, or lift (climb/sink with altitude help, else the throttle). */
export type KeyAxis = 'roll' | 'pitch' | 'yaw' | 'lift';

/** One flying key: its KeyboardEvent.code (the same place on every layout), the axis and the side. */
export interface KeyBind { code: string; axis: KeyAxis; dir: 1 | -1 }

/** Easy play: the game layout. Pitch +1 is the stick forward (nose down), roll +1 right, yaw +1 right. */
export const GAME_KEYS: readonly KeyBind[] = [
    { code: 'KeyW', axis: 'pitch', dir: 1 }, { code: 'KeyS', axis: 'pitch', dir: -1 },
    { code: 'KeyD', axis: 'roll', dir: 1 }, { code: 'KeyA', axis: 'roll', dir: -1 },
    { code: 'ArrowRight', axis: 'yaw', dir: 1 }, { code: 'ArrowLeft', axis: 'yaw', dir: -1 },
    { code: 'KeyE', axis: 'yaw', dir: 1 }, { code: 'KeyQ', axis: 'yaw', dir: -1 },
    { code: 'ArrowUp', axis: 'lift', dir: 1 }, { code: 'ArrowDown', axis: 'lift', dir: -1 }
];

/** The pilot profile: Mode 2 on the keys (v0.2-v0.7's only layout). */
export const MODE2_KEYS: readonly KeyBind[] = [
    { code: 'KeyW', axis: 'lift', dir: 1 }, { code: 'KeyS', axis: 'lift', dir: -1 },
    { code: 'KeyD', axis: 'yaw', dir: 1 }, { code: 'KeyA', axis: 'yaw', dir: -1 },
    { code: 'ArrowUp', axis: 'pitch', dir: 1 }, { code: 'ArrowDown', axis: 'pitch', dir: -1 },
    { code: 'ArrowRight', axis: 'roll', dir: 1 }, { code: 'ArrowLeft', axis: 'roll', dir: -1 }
];

/** Held for "faster" in easy play (game layout). Not a shortcut: Shift alone runs no action. */
export const BOOST_CODES: readonly string[] = ['ShiftLeft', 'ShiftRight'];

/** The layout of a profile. */
export function layoutFor(profile: PlayProfile): readonly KeyBind[] {
    return profile === 'pilot' ? MODE2_KEYS : GAME_KEYS;
}

/** Every key code keyboard flying reads in either layout (Space = arm is the keymap's own binding). */
export function flyingKeyCodes(): string[] {
    return [...new Set([...GAME_KEYS, ...MODE2_KEYS].map((k) => k.code))];
}

/** Direction per axis from the held keys (-1, 0, 1); opposite keys of one axis cancel. */
export function axisDirs(held: ReadonlySet<string>, layout: readonly KeyBind[]): Record<KeyAxis, number> {
    const out: Record<KeyAxis, number> = { roll: 0, pitch: 0, yaw: 0, lift: 0 };
    const seen = new Set<string>();
    for (const k of layout) {
        if (!held.has(k.code)) continue;
        // Q and the left arrow both turn left: one side counts once
        const id = `${k.axis}${k.dir}`;
        if (seen.has(id)) continue;
        seen.add(id);
        out[k.axis] += k.dir;
    }
    return out;
}

// ------------------------------------------------------------------ easy play: physical targets

/** A tilt key in angle and horizon modes: degrees (Shift: BOOST). */
export const KEY_TILT_DEG = 25;
/** A tilt key in acro: degrees per second (Shift: BOOST). */
export const KEY_ACRO_DPS = 200;
/** A turn key: degrees per second (Shift: BOOST). */
export const KEY_YAW_DPS = 110;
/** Shift multiplies a key's target by this (tilt 45 deg, turn 220 deg/s, acro 400 deg/s). */
export const BOOST = 1.8;

/** The stick (0..1) whose setpoint on this axis is `dps`, by bisection of the drone's own curve; 1 if it cannot reach it. */
export function stickForRate(dps: number, rates: RatesConfig, axis: 'roll' | 'pitch' | 'yaw'): number {
    const at = (x: number): number => setpointRate(rates.type, x, rates[axis], rates.rateLimit, rates.quickRcExpo === true);
    if (dps <= 0) return 0;
    if (at(1) <= dps) return 1;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        if (at(mid) < dps) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
}

/**
 * The stick (0..1) whose angle-mode target is `deg`: the model levels to limitDeg x setpoint(stick) /
 * setpoint(1) (sim-core Sim.levelRate), so the angle follows the rate curve, expo and all.
 */
export function stickForAngle(deg: number, rates: RatesConfig, axis: 'roll' | 'pitch', limitDeg: number): number {
    if (limitDeg <= 0 || deg <= 0) return 0;
    if (deg >= limitDeg) return 1;
    const max = setpointRate(rates.type, 1, rates[axis], rates.rateLimit, rates.quickRcExpo === true);
    return stickForRate((deg / limitDeg) * max, rates, axis);
}

/** Stick magnitudes (0..1) of one key per axis for a drone in a mode, normal and with Shift. */
export interface KeyTargets { roll: number; pitch: number; yaw: number; boost: { roll: number; pitch: number; yaw: number } }

/** The easy-play key targets of a drone (its rates and angle limit) in a flight mode. */
export function keyTargets(rates: RatesConfig, limitDeg: number, mode: FlightMode): KeyTargets {
    const tilt = (axis: 'roll' | 'pitch', k: number): number => (mode === 'acro' ? stickForRate(KEY_ACRO_DPS * k, rates, axis) : stickForAngle(KEY_TILT_DEG * k, rates, axis, limitDeg));
    return {
        roll: tilt('roll', 1),
        pitch: tilt('pitch', 1),
        yaw: stickForRate(KEY_YAW_DPS, rates, 'yaw'),
        boost: { roll: tilt('roll', BOOST), pitch: tilt('pitch', BOOST), yaw: stickForRate(KEY_YAW_DPS * BOOST, rates, 'yaw') }
    };
}

// ------------------------------------------------------------------ ramps

/** Stick units per second toward a key's target (0 -> 0.5 in 0.2 s). */
export const RAMP_RISE_PER_S = 2.5;
/** Stick units per second back toward centre on release (0.5 -> 0 in 0.08 s): letting go is quick. */
export const RAMP_FALL_PER_S = 6;

/**
 * One stick moved toward `target` over `dtS` seconds: away from centre at RAMP_RISE_PER_S, toward
 * centre (a release, a reversal) at RAMP_FALL_PER_S. A reversal crosses centre at the fall rate and
 * continues at the rise rate, all within the same step.
 */
export function slew(cur: number, target: number, dtS: number, rise = RAMP_RISE_PER_S, fall = RAMP_FALL_PER_S): number {
    let x = cur;
    let t = Math.max(0, dtS);
    // toward centre first when the target is nearer to it or on the other side
    if (x !== 0 && (Math.sign(target) !== Math.sign(x) || Math.abs(target) < Math.abs(x))) {
        const stop = Math.sign(target) === Math.sign(x) ? target : 0;
        const need = Math.abs(x - stop) / fall;
        if (need >= t) return x + Math.sign(stop - x) * fall * t;
        x = stop;
        t -= need;
    }
    if (x === target) return x;
    const need = Math.abs(target - x) / rise;
    if (need >= t) return x + Math.sign(target - x) * rise * t;
    return target;
}

/** Keyboard throttle in easy play without altitude help: 0 -> 100 % in this long (the pilot layout: 0.5 s). */
export const EASY_THR_UP_S = 1.0;
/** ... and 100 % -> 0 in this long (the pilot layout: 0.333 s). */
export const EASY_THR_DOWN_S = 0.6;
