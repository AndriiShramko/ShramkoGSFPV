// Keyboard flying as data (docs/wip/v09-b.md; the owner's message 22, item 1: "ordinary PC gamers still
// cannot fly a scene on the keyboard; nothing like the way games control flying characters"). Pure: no
// DOM, so Node tests, the keymap check and the key card read the same tables the page flies with.
//
// Two layouts:
//  - GAME (prefs input.play 'easy', the default for a keyboard): what games for players use, from the
//    research in docs/wip/v09-b.md. The mouse (pointer lock) looks and turns; W/S forward and back,
//    A/D left and right, relative to where the drone faces; Space up, Shift down; the arrows mirror
//    W A S D for players without a mouse (left/right turn), and Q/E turn as in v0.8. Letting go of every
//    key stops the drone and holds the place (play/game.ts). Ctrl is never read: Ctrl+W closes the tab.
//  - MODE2 (the pilot profile): a Mode 2 radio laid on the keys, the layout of v0.2: W/S throttle,
//    A/D yaw, the arrows pitch and roll.

import { setpointRate } from '@gsfpv/sim-core';
import type { RatesConfig } from '@gsfpv/sim-core';

/** How touch sticks and the keyboard fly (prefs input.play): easy play (a keyboard: the game scheme), or as a radio. */
export type PlayProfile = 'easy' | 'pilot';

/** What a pilot-profile key moves: roll, pitch, yaw, or lift (the throttle). */
export type KeyAxis = 'roll' | 'pitch' | 'yaw' | 'lift';

/** One flying key: its KeyboardEvent.code (the same place on every layout), the axis and the side. */
export interface KeyBind<A extends string = KeyAxis> { code: string; axis: A; dir: 1 | -1 }

/** What a game key asks for: forward (+1) / back, strafe right (+1) / left, turn right (+1) / left, lift up (+1) / down. */
export type GameAxis = 'forward' | 'strafe' | 'turn' | 'lift';

/** The game layout. Shift is the descent: it is never a modifier for a flying key (app/keys.ts reads a shortcut with it as the real chord first). */
export const GAME_KEYS: readonly KeyBind<GameAxis>[] = [
    { code: 'KeyW', axis: 'forward', dir: 1 }, { code: 'KeyS', axis: 'forward', dir: -1 },
    { code: 'ArrowUp', axis: 'forward', dir: 1 }, { code: 'ArrowDown', axis: 'forward', dir: -1 },
    { code: 'KeyD', axis: 'strafe', dir: 1 }, { code: 'KeyA', axis: 'strafe', dir: -1 },
    { code: 'ArrowRight', axis: 'turn', dir: 1 }, { code: 'ArrowLeft', axis: 'turn', dir: -1 },
    { code: 'KeyE', axis: 'turn', dir: 1 }, { code: 'KeyQ', axis: 'turn', dir: -1 },
    { code: 'Space', axis: 'lift', dir: 1 },
    { code: 'ShiftLeft', axis: 'lift', dir: -1 }, { code: 'ShiftRight', axis: 'lift', dir: -1 }
];

/** The keys that start the motors: every game key but Shift (Shift alone is "down", there is nothing to descend from). */
export const GAME_START_CODES: readonly string[] = GAME_KEYS.filter((k) => !k.code.startsWith('Shift')).map((k) => k.code);

/** Direction per game axis from the held keys (-1, 0, 1); opposite keys cancel, and a pair on one side (W and Up) counts once. */
export function gameDirs(held: ReadonlySet<string>): Record<GameAxis, number> {
    const out: Record<GameAxis, number> = { forward: 0, strafe: 0, turn: 0, lift: 0 };
    const seen = new Set<string>();
    for (const k of GAME_KEYS) {
        if (!held.has(k.code)) continue;
        const id = `${k.axis}${k.dir}`;
        if (seen.has(id)) continue;
        seen.add(id);
        out[k.axis] += k.dir;
    }
    return out;
}

/** The pilot profile: Mode 2 on the keys (v0.2-v0.7's only layout). */
export const MODE2_KEYS: readonly KeyBind[] = [
    { code: 'KeyW', axis: 'lift', dir: 1 }, { code: 'KeyS', axis: 'lift', dir: -1 },
    { code: 'KeyD', axis: 'yaw', dir: 1 }, { code: 'KeyA', axis: 'yaw', dir: -1 },
    { code: 'ArrowUp', axis: 'pitch', dir: 1 }, { code: 'ArrowDown', axis: 'pitch', dir: -1 },
    { code: 'ArrowRight', axis: 'roll', dir: 1 }, { code: 'ArrowLeft', axis: 'roll', dir: -1 }
];

/** The pilot layout's keys are bang-bang (v0.2-v0.7): pitch and roll this much of full stick the moment a key goes down ... */
export const MODE2_TILT_STICK = 0.6;
/** ... and yaw this much. */
export const MODE2_YAW_STICK = 0.5;

/** The pilot layout's sticks for the held keys (devices/keyboard.ts emit): a step to the magnitude, no ramp. */
export function mode2Sticks(held: ReadonlySet<string>): { roll: number; pitch: number; yaw: number } {
    const d = axisDirs(held, MODE2_KEYS);
    return { roll: d.roll * MODE2_TILT_STICK, pitch: d.pitch * MODE2_TILT_STICK, yaw: d.yaw * MODE2_YAW_STICK };
}

/** Every key code keyboard flying reads in either layout (Space = arm in the pilot profile is the keymap's own binding). */
export function flyingKeyCodes(): string[] {
    return [...new Set([...GAME_KEYS, ...MODE2_KEYS].map((k) => k.code))];
}

/** Direction per axis from the held keys (-1, 0, 1); opposite keys of one axis cancel. */
export function axisDirs(held: ReadonlySet<string>, layout: readonly KeyBind[]): Record<KeyAxis, number> {
    const out: Record<KeyAxis, number> = { roll: 0, pitch: 0, yaw: 0, lift: 0 };
    const seen = new Set<string>();
    for (const k of layout) {
        if (!held.has(k.code)) continue;
        const id = `${k.axis}${k.dir}`;
        if (seen.has(id)) continue;
        seen.add(id);
        out[k.axis] += k.dir;
    }
    return out;
}

// ------------------------------------------------------------------ sticks from physical targets

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
