// Quick rates (Betaflight 4.5.1 `rates_type = QUICK`) against reference values transcribed from the
// firmware's formula outside this repository (vectors/rates-bf451-quick.json; how they were made is in
// the file and in docs/PROVENANCE.md). Negative controls: the expo on the wrong branch, and a max
// rate without the firmware's floor at the centre sensitivity, both miss the table.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RATE_BOUNDS, RATES_TYPES, maxRate, setpointRate } from '../src/index';

interface QuickSet { id: number; rc_rate: number; rate: number; expo: number; quickrates_rc_expo: boolean; rate_limit: number; x: number[]; omega: number[] }
const table = JSON.parse(readFileSync(join(__dirname, 'vectors/rates-bf451-quick.json'), 'utf8')) as { sets: QuickSet[] };

/** Worst |f(x) - omega| over the table for a candidate curve. */
function worst(f: (s: QuickSet, x: number) => number): number {
    let w = 0;
    for (const s of table.sets) for (let i = 0; i < s.x.length; i++) w = Math.max(w, Math.abs(f(s, s.x[i]) - s.omega[i]));
    return w;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

describe('Quick rates vs the Betaflight 4.5.1 formula', () => {
    it('matches every reference point within 1e-9 deg/s', () => {
        const n = table.sets.reduce((k, s) => k + s.x.length, 0);
        expect(n).toBe(24 * 47);
        expect(table.sets.some((s) => s.quickrates_rc_expo)).toBe(true);
        expect(worst((s, x) => setpointRate('QUICK', x, { rcRate: s.rc_rate, rate: s.rate, expo: s.expo }, s.rate_limit, s.quickrates_rc_expo))).toBeLessThanOrEqual(1e-9);
    });

    it('negative control: quickrates_rc_expo ignored (expo always on the super factor) is caught', () => {
        const w = worst((s, x) => setpointRate('QUICK', x, { rcRate: s.rc_rate, rate: s.rate, expo: s.expo }, s.rate_limit, false));
        expect(w).toBeGreaterThan(1);
    });

    /** The Quick curve with two knobs to break it: the centre sensitivity's factor and the max rate's floor. */
    const variant = (o: { centre: number; floor: boolean }) => (s: QuickSet, x: number): number => {
        const r = s.rc_rate * o.centre, m = o.floor ? Math.max(s.rate * 10, r) : s.rate * 10, e = s.expo / 100, a = Math.abs(x);
        const k = (m / r - 1) / (m / r);
        const curve = s.quickrates_rc_expo ? x * x * x * e + x * (1 - e) : a * a * a * e + a * (1 - e);
        const sf = 1 / clamp(1 - (s.quickrates_rc_expo ? a : curve) * k, 0.01, 1);
        const w = s.quickrates_rc_expo ? curve * r * sf : x * r * sf;
        return clamp(clamp(w, -1998, 1998), -s.rate_limit, s.rate_limit);
    };

    it('the test\'s own transcription with the firmware\'s knobs agrees with the table (the controls below start from it)', () => {
        expect(worst(variant({ centre: 2, floor: true }))).toBeLessThanOrEqual(1e-9);
    });

    it('negative control: centre sensitivity R instead of 2 R deg/s is caught', () => {
        expect(worst(variant({ centre: 1, floor: true }))).toBeGreaterThan(1);
    });

    it('negative control: without the floor max(10 S, 2 R), srate 0 gives NaN at centre stick', () => {
        const s = table.sets.find((t) => t.rate === 0)!;
        expect(Number.isNaN(variant({ centre: 2, floor: false })(s, 0))).toBe(true);
        expect(setpointRate('QUICK', 0, { rcRate: s.rc_rate, rate: s.rate, expo: s.expo }, s.rate_limit)).toBe(0);
    });

    it('full stick gives max(10 S, 2 R), never more than the rate limit', () => {
        const cfg = (R: number, S: number, E: number, lim = 1998, q = false) => ({ type: 'QUICK' as const, roll: { rcRate: R, rate: S, expo: E }, pitch: { rcRate: R, rate: S, expo: E }, yaw: { rcRate: R, rate: S, expo: E }, rateLimit: lim, quickRcExpo: q });
        expect(maxRate(cfg(100, 67, 0), 'roll')).toBeCloseTo(670, 9);
        expect(maxRate(cfg(100, 67, 80, 1998, true), 'pitch')).toBeCloseTo(670, 9);
        expect(maxRate(cfg(255, 10, 0), 'yaw')).toBeCloseTo(510, 9);
        expect(maxRate(cfg(100, 200, 0, 900), 'roll')).toBe(900);
        // centre sensitivity: 2 R deg/s per unit stick
        expect(setpointRate('QUICK', 0.001, { rcRate: 100, rate: 67, expo: 0 }, 1998) / 0.001).toBeCloseTo(200, 0);
    });

    it('rc rate 0 (below the CLI minimum) gives 0, never NaN', () => {
        expect(setpointRate('QUICK', 0.7, { rcRate: 0, rate: 67, expo: 30 }, 1998)).toBe(0);
    });

    it('QUICK is the fifth type with Betaflight limits 255 / 200 / 100', () => {
        expect(RATES_TYPES).toEqual(['BETAFLIGHT', 'RACEFLIGHT', 'KISS', 'ACTUAL', 'QUICK']);
        expect(RATE_BOUNDS.QUICK).toEqual({ rcRate: 255, rate: 200, expo: 100 });
    });
});
