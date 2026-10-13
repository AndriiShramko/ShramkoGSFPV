// What a rates editor needs on top of the curves (rates.ts): each type's three fields as Betaflight
// Configurator names and shows them, typed text to CLI integers, the full-stick rate per axis, curve
// samples for a chart, the switch to another type that keeps the feel, and the CLI text that sets
// the same rates on a real quad. Pure and DOM-free: the Settings screen (apps/fly
// ui/settings/rates-editor.ts) only draws what these functions say.
//
// Field names, display scales and steps were read from Betaflight Configurator 10.10.0
// (src/js/tabs/pid_tuning.js, GPL-3.0) and re-implemented; see docs/PROVENANCE.md. Values are
// always stored as the CLI integers (rc_rate, srate, expo) the curves take.

import type { AxisRates, RatesConfig, RatesType } from './rates';
import { RATE_BOUNDS, RATES_TYPES, SETPOINT_RATE_LIMIT, setpointRate } from './rates';

export type RateAxis = 'roll' | 'pitch' | 'yaw';
export const RATE_AXES: readonly RateAxis[] = ['roll', 'pitch', 'yaw'];
/** The stored integer a field edits. */
export type RateKey = keyof AxisRates;
/** Configurator's name of a field (the app's text key is `rates.field.<name>`). */
export type RateFieldName = 'rcRate' | 'superRate' | 'expo' | 'rcCurve' | 'centerSensitivity' | 'maxRate' | 'rate' | 'acroPlus';

/** One input of the editor: shown value = stored integer x scale, typed in steps of `scale`. */
export interface RateField {
    key: RateKey;
    name: RateFieldName;
    /** the CLI setting after the axis: `<axis>_rc_rate`, `<axis>_srate`, `<axis>_expo` */
    cli: 'rc_rate' | 'srate' | 'expo';
    scale: number;
    /** decimals of the shown value */
    decimals: number;
    /** 'degs': the shown value is deg/s */
    unit: '' | 'degs';
    /** stored integer bounds (Configurator's minimum, Betaflight's ratesSettingLimits maximum) */
    min: number;
    max: number;
}

const f = (key: RateKey, name: RateFieldName, scale: number, decimals: number, unit: '' | 'degs', min: number, max: number): RateField =>
    ({ key, name, cli: key === 'rcRate' ? 'rc_rate' : key === 'rate' ? 'srate' : 'expo', scale, decimals, unit, min, max });

/** The three fields of each type, in Configurator's column order (RC Rate, Rate, Expo). */
export const RATE_FIELDS: Readonly<Record<RatesType, readonly [RateField, RateField, RateField]>> = {
    BETAFLIGHT: [f('rcRate', 'rcRate', 0.01, 2, '', 1, 255), f('rate', 'superRate', 0.01, 2, '', 0, 100), f('expo', 'expo', 0.01, 2, '', 0, 100)],
    RACEFLIGHT: [f('rcRate', 'rate', 10, 0, 'degs', 1, 200), f('rate', 'acroPlus', 1, 0, '', 0, 255), f('expo', 'expo', 1, 0, '', 0, 100)],
    KISS: [f('rcRate', 'rcRate', 0.01, 2, '', 1, 255), f('rate', 'rate', 0.01, 2, '', 0, 99), f('expo', 'rcCurve', 0.01, 2, '', 0, 100)],
    ACTUAL: [f('rcRate', 'centerSensitivity', 10, 0, 'degs', 1, 200), f('rate', 'maxRate', 10, 0, 'degs', 1, 200), f('expo', 'expo', 0.01, 2, '', 0, 100)],
    QUICK: [f('rcRate', 'rcRate', 0.01, 2, '', 1, 255), f('rate', 'maxRate', 10, 0, 'degs', 1, 200), f('expo', 'expo', 0.01, 2, '', 0, 100)]
};

/** Betaflight's rate_limit range (deg/s). */
export const RATE_LIMIT_MIN = 200;
export const RATE_LIMIT_MAX = SETPOINT_RATE_LIMIT;

/** The field of a type that edits this integer. */
export function rateField(type: RatesType, key: RateKey): RateField {
    return RATE_FIELDS[type].find((x) => x.key === key)!;
}

/** The shown value of a stored integer (e.g. 67 -> 670 deg/s, 100 -> 1.00). */
export function shownValue(field: RateField, stored: number): number {
    return Number((stored * field.scale).toFixed(field.decimals));
}

/** The shown value as text, with the field's decimals ("1.00", "670"). */
export function shownText(field: RateField, stored: number): string {
    return (stored * field.scale).toFixed(field.decimals);
}

/** Typed text read back: the stored integer, and whether it had to be moved onto the grid or into the bounds. */
export type FieldInput = { ok: true; stored: number; adjusted: boolean } | { ok: false };

/** Reads what a pilot typed into a field ("1,25" and "1.25" alike); text that is no number is refused. */
export function readField(field: RateField, text: string): FieldInput {
    const t = text.trim().replace(',', '.');
    if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(t)) return { ok: false };
    const n = Number(t);
    if (!Number.isFinite(n)) return { ok: false };
    const raw = Math.round(n / field.scale);
    const stored = raw < field.min ? field.min : raw > field.max ? field.max : raw;
    return { ok: true, stored, adjusted: Math.abs(stored * field.scale - n) > 1e-9 };
}

/** Typed rate limit read back: whole deg/s within 200..1998. */
export function readRateLimit(text: string): FieldInput {
    const t = text.trim();
    if (!/^\d+(\.\d*)?$/.test(t)) return { ok: false };
    const n = Number(t);
    const raw = Math.round(n);
    const stored = raw < RATE_LIMIT_MIN ? RATE_LIMIT_MIN : raw > RATE_LIMIT_MAX ? RATE_LIMIT_MAX : raw;
    return { ok: true, stored, adjusted: stored !== n };
}

/** A deep copy (the store and the editor never share objects). */
export function copyRates(c: RatesConfig): RatesConfig {
    const out: RatesConfig = { type: c.type, roll: { ...c.roll }, pitch: { ...c.pitch }, yaw: { ...c.yaw }, rateLimit: c.rateLimit };
    if (c.type === 'QUICK') out.quickRcExpo = c.quickRcExpo === true;
    return out;
}

/** The config with one integer of one axis changed (a copy). */
export function withField(c: RatesConfig, axis: RateAxis, key: RateKey, stored: number): RatesConfig {
    const out = copyRates(c);
    out[axis][key] = stored;
    return out;
}

/** The setpoint of one axis at stick x (the curve the flight uses). */
export function axisRate(c: RatesConfig, axis: RateAxis, x: number): number {
    return setpointRate(c.type, x, c[axis], c.rateLimit, c.quickRcExpo === true);
}

/** deg/s at full stick per axis. */
export function fullStickRates(c: RatesConfig): Record<RateAxis, number> {
    return { roll: axisRate(c, 'roll', 1), pitch: axisRate(c, 'pitch', 1), yaw: axisRate(c, 'yaw', 1) };
}

/** deg/s at n stick positions 0..1 (the curves are odd: the left half mirrors this). */
export function curveSamples(c: RatesConfig, axis: RateAxis, n: number): number[] {
    const out: number[] = [];
    for (let i = 0; i < n; i++) out.push(axisRate(c, axis, n > 1 ? i / (n - 1) : 1));
    return out;
}

// ------------------------------------------------------------------ switching type

/** Stick positions of the fit (0, 0.025, ... 1); full stick counts 20x. The coarse grid uses every 4th. */
const FIT_N = 41;
const FIT_COARSE_EVERY = 4;
const FIT_FULL_WEIGHT = 20;
/** Coarse grid: every 4th rc rate and rate, every 5th expo; then a pattern search from the best few. */
const GRID_RS = 4;
const GRID_E = 5;
const GRID_KEEP = 12;
/** The final polish searches every triple within +-6 rc rate / rate and +-2 expo of the best. */
const POLISH_RS = 6;
const POLISH_E = 2;

/** A type switch: the new config and how far its curve is from the old one at worst (deg/s per axis). */
export interface RatesFit { config: RatesConfig; worst: Record<RateAxis, number> }

/**
 * The config of type `to` whose curves are closest to `from`'s: per axis, the integers within the new
 * type's field bounds that minimise the squared deg/s difference over 41 stick positions 0..1, full
 * stick weighted 20x (so the max rate matches first, within about 1 % where the new type's integers
 * cannot hit it exactly). The search: a coarse grid (every 4th rc rate and rate, every 5th expo, 11
 * stick positions), then from the 12 best a 3-D pattern search on all 41 positions (steps 8, 4, 2, 1,
 * diagonal moves included: the valleys of these curves run diagonally), then every triple within
 * +-6 / +-6 / +-2 of the best until none is better. Checked against an exhaustive search in
 * rates-edit.test.ts. Deterministic; the same type comes back unchanged. The rate limit is
 * kept; Quick's quickrates_rc_expo is kept from a Quick config, OFF otherwise.
 */
export function fitRates(from: RatesConfig, to: RatesType): RatesFit {
    if (from.type === to) return { config: copyRates(from), worst: { roll: 0, pitch: 0, yaw: 0 } };
    const config: RatesConfig = { type: to, roll: { rcRate: 0, rate: 0, expo: 0 }, pitch: { rcRate: 0, rate: 0, expo: 0 }, yaw: { rcRate: 0, rate: 0, expo: 0 }, rateLimit: from.rateLimit };
    const qe = to === 'QUICK' ? from.quickRcExpo === true && from.type === 'QUICK' : false;
    if (to === 'QUICK') config.quickRcExpo = qe;
    const worst = { roll: 0, pitch: 0, yaw: 0 };
    const done = new Map<string, AxisRates>(); // equal axes are fitted once
    for (const axis of RATE_AXES) {
        const key = `${from[axis].rcRate}|${from[axis].rate}|${from[axis].expo}`;
        const target: number[] = [];
        for (let i = 0; i < FIT_N; i++) target.push(setpointRate(from.type, i / (FIT_N - 1), from[axis], from.rateLimit, from.quickRcExpo === true));
        const best = done.get(key) ?? fitAxis(target, to, from.rateLimit, qe);
        done.set(key, best);
        config[axis] = { ...best };
        let w = 0;
        for (let i = 0; i < FIT_N; i++) {
            const d = setpointRate(to, i / (FIT_N - 1), best, from.rateLimit, qe) - target[i];
            const a = d < 0 ? -d : d;
            if (a > w) w = a;
        }
        worst[axis] = w;
    }
    return { config, worst };
}

/** The fit's objective: weighted squared deg/s difference at every `every`-th stick position. */
export function fitCost(target: readonly number[], type: RatesType, ax: AxisRates, rateLimit: number, quickRcExpo = false, every = 1): number {
    let sum = 0;
    for (let i = 0; i < FIT_N; i += every) {
        const d = setpointRate(type, i / (FIT_N - 1), ax, rateLimit, quickRcExpo) - target[i];
        sum += (i === FIT_N - 1 ? FIT_FULL_WEIGHT : 1) * d * d;
    }
    return sum;
}

/** Grid values lo, lo + step, ... and always hi. */
function gridOf(lo: number, hi: number, step: number): number[] {
    const out: number[] = [];
    for (let v = lo; v < hi; v += step) out.push(v);
    out.push(hi);
    return out;
}

function fitAxis(target: readonly number[], type: RatesType, rateLimit: number, qe: boolean): AxisRates {
    const [fr, fs, fe] = RATE_FIELDS[type];
    type P = { r: number; s: number; e: number; c: number };
    const fine = (r: number, s: number, e: number): number => fitCost(target, type, { rcRate: r, rate: s, expo: e }, rateLimit, qe);
    // coarse grid on 11 stick positions; keep the best few (ties: the first in grid order)
    const kept: P[] = [];
    for (const e of gridOf(fe.min, fe.max, GRID_E)) for (const r of gridOf(fr.min, fr.max, GRID_RS)) for (const s of gridOf(fs.min, fs.max, GRID_RS)) {
        const c = fitCost(target, type, { rcRate: r, rate: s, expo: e }, rateLimit, qe, FIT_COARSE_EVERY);
        if (kept.length < GRID_KEEP || c < kept[kept.length - 1].c) {
            kept.push({ r, s, e, c });
            kept.sort((a, b) => a.c - b.c);
            if (kept.length > GRID_KEEP) kept.pop();
        }
    }
    const inside = (r: number, s: number, e: number) => r >= fr.min && r <= fr.max && s >= fs.min && s <= fs.max && e >= fe.min && e <= fe.max;
    /** Pattern search on all 41 positions: the best of the 26 neighbours at this step, halve the step when none is better. */
    const search = (p: P): P => {
        let cur = p;
        for (const step of [8, 4, 2, 1]) {
            for (;;) {
                let next = cur;
                for (const dr of [-step, 0, step]) for (const ds of [-step, 0, step]) for (const de of [-step, 0, step]) {
                    if (dr === 0 && ds === 0 && de === 0) continue;
                    const r = cur.r + dr, s = cur.s + ds, e = cur.e + de;
                    if (!inside(r, s, e)) continue;
                    const c = fine(r, s, e);
                    if (c < next.c) next = { r, s, e, c };
                }
                if (next === cur) break;
                cur = next;
            }
        }
        return cur;
    };
    let best: P | null = null;
    for (const p of kept) {
        const q = search({ ...p, c: fine(p.r, p.s, p.e) });
        if (!best || q.c < best.c) best = q;
    }
    // polish: every triple in a window around the best, again until it stays (narrow valleys whose
    // direction no single +-1 step follows)
    let cur = best!;
    for (let round = 0; round < 8; round++) {
        let next = cur;
        for (let e = cur.e - POLISH_E; e <= cur.e + POLISH_E; e++) for (let r = cur.r - POLISH_RS; r <= cur.r + POLISH_RS; r++) for (let s = cur.s - POLISH_RS; s <= cur.s + POLISH_RS; s++) {
            if (!inside(r, s, e)) continue;
            const c = fine(r, s, e);
            if (c < next.c) next = { r, s, e, c };
        }
        if (next === cur) break;
        cur = next;
    }
    return { rcRate: cur.r, rate: cur.s, expo: cur.e };
}

// ------------------------------------------------------------------ Betaflight CLI

/**
 * The `set` lines that give a Betaflight 4.5 quad these rates on its current rate profile (the CLI's
 * names; parseBetaflightDiff reads them back to the same config). The pilot pastes them into the CLI
 * and types `save`.
 */
export function ratesCli(c: RatesConfig): string {
    const lines = ['# ShramkoGSFPV rates', `set rates_type = ${c.type}`];
    if (c.type === 'QUICK') lines.push(`set quickrates_rc_expo = ${c.quickRcExpo === true ? 'ON' : 'OFF'}`);
    for (const k of ['rc_rate', 'expo', 'srate'] as const) {
        const key: RateKey = k === 'rc_rate' ? 'rcRate' : k === 'srate' ? 'rate' : 'expo';
        for (const ax of RATE_AXES) lines.push(`set ${ax}_${k} = ${Math.round(c[ax][key])}`);
    }
    for (const ax of RATE_AXES) lines.push(`set ${ax}_rate_limit = ${Math.round(c.rateLimit)}`);
    return `${lines.join('\n')}\n`;
}

/** Is this a type the editor knows (stored values come from outside)? */
export function isRatesType(v: unknown): v is RatesType {
    return typeof v === 'string' && (RATES_TYPES as readonly string[]).includes(v);
}

/** Every integer within its field's bounds (the editor's bounds, a little stricter than the CLI's minimum 0). */
export function fieldsInBounds(c: RatesConfig): boolean {
    for (const ax of RATE_AXES) for (const fd of RATE_FIELDS[c.type]) {
        const v = c[ax][fd.key];
        if (!(v >= fd.min && v <= fd.max) || Math.round(v) !== v) return false;
    }
    return c.rateLimit >= RATE_LIMIT_MIN && c.rateLimit <= RATE_LIMIT_MAX && RATE_BOUNDS[c.type] !== undefined;
}
