// Stick -> rotation-rate setpoint curves and the throttle curve.
//
// Formulas and constants were read from Betaflight 4.5.1 (src/main/fc/rc.c, GPL-3.0) and
// re-implemented here; no Betaflight code was copied. See docs/PROVENANCE.md.
// All parameters are the integers a pilot types in the Betaflight CLI.

export type RatesType = 'BETAFLIGHT' | 'ACTUAL' | 'KISS' | 'RACEFLIGHT';

export interface AxisRates {
    rcRate: number; // R
    rate: number; // S (super rate / max rate)
    expo: number; // E
}

export interface RatesConfig {
    type: RatesType;
    roll: AxisRates;
    pitch: AxisRates;
    yaw: AxisRates;
    rateLimit: number; // deg/s, <= 1998
}

export const SETPOINT_RATE_LIMIT = 1998;
const RC_RATE_INCREMENTAL = 14.54;

/** UI bounds {R, S, E} per curve type. */
export const RATE_BOUNDS: Record<RatesType, AxisRates> = {
    BETAFLIGHT: { rcRate: 255, rate: 100, expo: 100 },
    RACEFLIGHT: { rcRate: 200, rate: 255, expo: 100 },
    KISS: { rcRate: 255, rate: 99, expo: 100 },
    ACTUAL: { rcRate: 200, rate: 200, expo: 100 }
};

function clampf(v: number, lo: number, hi: number): number {
    return v < lo ? lo : v > hi ? hi : v;
}

/** Setpoint in deg/s for stick x in [-1, 1], before the rate-limit clamp. */
export function rawRate(type: RatesType, x: number, R: number, S: number, E: number): number {
    const a = x < 0 ? -x : x;
    switch (type) {
        case 'BETAFLIGHT': {
            let x1 = x;
            if (E !== 0) {
                const e = E / 100;
                x1 = x * (a * a * a) * e + x * (1 - e);
            }
            let r = R / 100;
            if (r > 2) r += RC_RATE_INCREMENTAL * (r - 2);
            let w = 200 * r * x1;
            if (S !== 0) w *= 1 / clampf(1 - a * (S / 100), 0.01, 1);
            return w;
        }
        case 'ACTUAL': {
            const e = E / 100;
            const x5 = x * x * x * x * x;
            const ex = a * (x5 * e + x * (1 - e));
            const c = R * 10;
            const m = Math.max(0, S * 10 - c);
            return x * c + m * ex;
        }
        case 'KISS': {
            const e = E / 100;
            const s = 1 / clampf(1 - a * (S / 100), 0.01, 1);
            const k = (x * x * x * e + x * (1 - e)) * (R / 1000);
            return clampf(2000 * s * k, -SETPOINT_RATE_LIMIT, SETPOINT_RATE_LIMIT);
        }
        case 'RACEFLIGHT': {
            const x1 = (1 + 0.01 * E * (x * x - 1)) * x;
            let w = 10 * R * x1;
            w = w * (1 + a * S * 0.01);
            return w;
        }
    }
}

export function setpointRate(type: RatesType, x: number, ax: AxisRates, rateLimit: number): number {
    const lim = Math.min(rateLimit, SETPOINT_RATE_LIMIT);
    return clampf(rawRate(type, x, ax.rcRate, ax.rate, ax.expo), -lim, lim);
}

/** Max setpoint at full stick, used by UI previews and the full-stick physics check. */
export function maxRate(cfg: RatesConfig, axis: 'roll' | 'pitch' | 'yaw'): number {
    return setpointRate(cfg.type, 1, cfg[axis], cfg.rateLimit);
}

export interface ThrottleCurve {
    mid: number; // thr_mid, 0..100
    expo: number; // thr_expo, 0..100
}

/**
 * Throttle curve, 11 nodes every 10 % with linear interpolation between them.
 * Node value: m + d * (1 - e + e * (d / y)^2), d = u - m, y = d > 0 ? 1 - m : m.
 */
export function throttleCurve(u: number, tc: ThrottleCurve): number {
    const uu = clampf(u, 0, 1);
    const i = Math.min(9, Math.floor(uu * 10));
    const f = uu * 10 - i;
    const n0 = thrNode(i / 10, tc);
    const n1 = thrNode((i + 1) / 10, tc);
    return n0 + (n1 - n0) * f;
}

function thrNode(u: number, tc: ThrottleCurve): number {
    const m = tc.mid / 100;
    const e = tc.expo / 100;
    const d = u - m;
    const y = d > 0 ? 1 - m : m;
    if (y === 0) return u;
    const q = d / y;
    return m + d * (1 - e + e * q * q);
}

/** Inverse of a monotone curve by bisection — used by the bot pilot, never by the physics. */
export function invertRate(type: RatesType, target: number, ax: AxisRates, rateLimit: number): number {
    let lo = -1;
    let hi = 1;
    for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2;
        if (setpointRate(type, mid, ax, rateLimit) < target) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
}
