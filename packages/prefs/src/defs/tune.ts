// Tune (A.8, H.3). Owner: W2-1. null means "the drone preset's own values", which is also what
// ParamOverrides means by an absent field. PID came from v0.2's panel; rates and throttle from
// v0.2's "Import rates from Betaflight", so all three are existing settings.
import type { SettingDef } from '../schema';

export type RatesType = 'BETAFLIGHT' | 'ACTUAL' | 'KISS' | 'RACEFLIGHT';
export interface AxisRates { rcRate: number; rate: number; expo: number }
export interface RatesValue { type: RatesType; roll: AxisRates; pitch: AxisRates; yaw: AxisRates; rateLimit: number }
export interface PidValue { roll: number[]; pitch: number[]; yaw: number[] }
export interface ThrottleValue { mid: number; expo: number }

export const RATE_TYPES: readonly RatesType[] = ['BETAFLIGHT', 'ACTUAL', 'KISS', 'RACEFLIGHT'];

/** CLI bounds of R, S, E per curve type, as sim-core RATE_BOUNDS (a test keeps the two equal). */
export const RATE_BOUNDS: Readonly<Record<RatesType, AxisRates>> = {
    BETAFLIGHT: { rcRate: 255, rate: 100, expo: 100 },
    RACEFLIGHT: { rcRate: 200, rate: 255, expo: 100 },
    KISS: { rcRate: 255, rate: 99, expo: 100 },
    ACTUAL: { rcRate: 200, rate: 200, expo: 100 }
};

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** P, I, D, F per axis, each 0-250 (v0.2's panel bounds). Out of range is clamped, not refused. */
export function validatePid(v: unknown): PidValue | null {
    const o = obj(v);
    if (!o) return null;
    const out: Partial<PidValue> = {};
    for (const ax of ['roll', 'pitch', 'yaw'] as const) {
        const a = o[ax];
        if (!Array.isArray(a) || a.length !== 4 || !a.every(fin)) return null;
        out[ax] = a.map((x: number) => clamp(x, 0, 250));
    }
    return out as PidValue;
}

export function validateRates(v: unknown): RatesValue | null {
    const o = obj(v);
    if (!o || !RATE_TYPES.includes(o.type as RatesType) || !fin(o.rateLimit)) return null;
    const type = o.type as RatesType;
    const b = RATE_BOUNDS[type];
    const axis = (x: unknown): AxisRates | null => {
        const a = obj(x);
        if (!a || !fin(a.rcRate) || !fin(a.rate) || !fin(a.expo)) return null;
        return { rcRate: clamp(a.rcRate, 0, b.rcRate), rate: clamp(a.rate, 0, b.rate), expo: clamp(a.expo, 0, b.expo) };
    };
    const roll = axis(o.roll), pitch = axis(o.pitch), yaw = axis(o.yaw);
    if (!roll || !pitch || !yaw) return null;
    // Betaflight's rate_limit range
    return { type, roll, pitch, yaw, rateLimit: clamp(o.rateLimit, 200, 1998) };
}

/** Betaflight thr_mid / thr_expo as CLI integers 0-100. */
export function validateThrottle(v: unknown): ThrottleValue | null {
    const o = obj(v);
    if (!o || !fin(o.mid) || !fin(o.expo)) return null;
    return { mid: clamp(o.mid, 0, 100), expo: clamp(o.expo, 0, 100) };
}

export const TUNE_DEFS: readonly SettingDef[] = [
    { id: 'tune.pid', group: 'tune', scope: 'drone', type: 'json', kind: 'pid', validate: validatePid, default: null, apply: 'life', shown: ['settings'], status: 'shipped', since: 1, items: [20] },
    // read-only in the panel, filled by "Import from Betaflight"
    { id: 'tune.rates', group: 'tune', scope: 'drone', type: 'json', kind: 'rates', validate: validateRates, default: null, apply: 'life', shown: ['settings'], status: 'shipped', since: 1, items: [21] },
    { id: 'tune.throttle', group: 'tune', scope: 'drone', type: 'json', kind: 'throttle', validate: validateThrottle, default: null, apply: 'life', shown: ['settings'], status: 'shipped', since: 1, items: [21] }
];
