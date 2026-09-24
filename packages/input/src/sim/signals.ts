// SimRadio, channel level: scripted stick signals at a given report rate with seeded jitter.
// Deterministic (dmath + integer PRNG), so Node and every browser produce identical samples.

import { dsin } from '@gsfpv/sim-core';

export type SignalKind = 'hold' | 'step' | 'ramp' | 'sine' | 'chirp' | 'square';

export interface ChannelSignal {
    ch: number;
    kind: SignalKind;
    t0: number; // s
    t1: number; // s
    a: number; // amplitude / target
    b?: number; // offset / start value
    f0?: number; // Hz
    f1?: number; // Hz (chirp end)
}

export function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function value(sig: ChannelSignal, t: number): number | null {
    if (t < sig.t0 || t > sig.t1) return null;
    const u = t - sig.t0;
    const b = sig.b ?? 0;
    const TWO_PI = 6.283185307179586;
    switch (sig.kind) {
        case 'hold':
        case 'step':
            return sig.a;
        case 'ramp':
            return b + (sig.a - b) * (u / Math.max(1e-9, sig.t1 - sig.t0));
        case 'sine':
            return b + sig.a * dsin(TWO_PI * (sig.f0 ?? 1) * u);
        case 'square':
            return b + (Math.floor(2 * (sig.f0 ?? 1) * u) % 2 === 0 ? sig.a : -sig.a);
        case 'chirp': {
            const f0 = sig.f0 ?? 0.5, f1 = sig.f1 ?? 5, T = Math.max(1e-9, sig.t1 - sig.t0);
            return b + sig.a * dsin(TWO_PI * (f0 * u + ((f1 - f0) * u * u) / (2 * T)));
        }
    }
}

export interface ScriptSample { tUs: number; ch: Float32Array }

/**
 * Render a script into timestamped samples at `rateHz` with +-jitterUs timing jitter.
 * Channels default to: sticks centred, throttle low, switches off.
 */
export function renderScript(signals: ChannelSignal[], durationS: number, rateHz: number, jitterUs: number, seed: number): ScriptSample[] {
    const rng = mulberry32(seed);
    const out: ScriptSample[] = [];
    const period = 1e6 / rateHz;
    const cur = new Float32Array([0, 0, -1, 0, -1, -1, 0, 0]);
    for (let k = 0; k * period <= durationS * 1e6; k++) {
        const tNom = k * period;
        const t = tNom / 1e6;
        for (const sig of signals) {
            const v = value(sig, t);
            if (v !== null) cur[sig.ch] = v < -1 ? -1 : v > 1 ? 1 : v;
        }
        const j = Math.round((rng() * 2 - 1) * jitterUs);
        out.push({ tUs: Math.max(0, Math.round(tNom + j)), ch: Float32Array.from(cur) });
    }
    // jitter may reorder neighbours: keep time order
    out.sort((a, b) => a.tUs - b.tUs);
    return out;
}

/** The 30 s determinism script: arm, climb, rolls, a flip, yaw spins, chirps, a dive. */
export function determinismScript(): ChannelSignal[] {
    return [
        { ch: 4, kind: 'step', t0: 0.2, t1: 30, a: 1 },
        { ch: 2, kind: 'ramp', t0: 0.5, t1: 2.0, b: -1, a: -0.15 },
        { ch: 2, kind: 'sine', t0: 2.0, t1: 12, b: -0.2, a: 0.25, f0: 0.3 },
        { ch: 0, kind: 'chirp', t0: 3, t1: 9, a: 0.6, f0: 0.3, f1: 6 },
        { ch: 1, kind: 'square', t0: 9, t1: 12, a: 0.5, f0: 1.5 },
        { ch: 0, kind: 'step', t0: 12, t1: 12.45, a: 1 }, // flip
        { ch: 0, kind: 'step', t0: 12.45, t1: 13, a: 0 },
        { ch: 3, kind: 'sine', t0: 13, t1: 20, a: 0.8, f0: 0.7 },
        { ch: 2, kind: 'hold', t0: 12, t1: 20, a: -0.1 },
        { ch: 1, kind: 'chirp', t0: 20, t1: 26, a: 0.4, f0: 0.5, f1: 8 },
        { ch: 2, kind: 'ramp', t0: 20, t1: 26, b: -0.1, a: 0.6 },
        { ch: 2, kind: 'hold', t0: 26, t1: 30, a: -1 }
    ];
}
