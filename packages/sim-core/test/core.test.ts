import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dsin, dcos, datan2, dexp, datan, sha256Hex, setpointRate, throttleCurve } from '../src/index';
import type { RatesType } from '../src/index';

const here = (p: string) => join(__dirname, p);

describe('rates vs compiled Betaflight 4.5.1', () => {
    const table = JSON.parse(readFileSync(here('vectors/rates-bf451.json'), 'utf8'));
    it('matches all reference points within 1e-9 deg/s', () => {
        let worst = 0;
        let n = 0;
        for (const s of table.sets as { type: RatesType; rc_rate: number; rate: number; expo: number; rate_limit: number; x: number[]; omega: number[] }[]) {
            for (let i = 0; i < s.x.length; i++) {
                const got = setpointRate(s.type, s.x[i], { rcRate: s.rc_rate, rate: s.rate, expo: s.expo }, s.rate_limit);
                worst = Math.max(worst, Math.abs(got - s.omega[i]));
                n++;
            }
        }
        expect(n).toBe(1880);
        expect(worst).toBeLessThanOrEqual(1e-9);
    });
    it('negative control: Actual with x^3 instead of x^5 is caught', () => {
        let worst = 0;
        for (const s of table.sets.filter((t: { type: string }) => t.type === 'ACTUAL')) {
            for (let i = 0; i < s.x.length; i++) {
                const x = s.x[i], a = Math.abs(x), e = s.expo / 100, c = s.rc_rate * 10, m = Math.max(0, s.rate * 10 - c);
                const lim = Math.min(s.rate_limit, 1998);
                const bad = Math.max(-lim, Math.min(lim, x * c + m * a * (x * x * x * e + x * (1 - e))));
                worst = Math.max(worst, Math.abs(bad - s.omega[i]));
            }
        }
        expect(worst).toBeGreaterThan(1e-9);
    });
    it('throttle curve is linear by default and hits its mid point', () => {
        expect(throttleCurve(0.37, { mid: 50, expo: 0 })).toBeCloseTo(0.37, 12);
        expect(throttleCurve(0.5, { mid: 50, expo: 70 })).toBeCloseTo(0.5, 12);
    });
});

describe('deterministic math', () => {
    it('sin/cos/atan2/exp agree with Math to ~1 ulp on a sweep', () => {
        let worst = 0;
        for (let i = -20000; i <= 20000; i++) {
            const x = i * 0.00137;
            worst = Math.max(worst, Math.abs(dsin(x) - Math.sin(x)), Math.abs(dcos(x) - Math.cos(x)));
            worst = Math.max(worst, Math.abs(datan(x) - Math.atan(x)), Math.abs(datan2(x, 0.3 - x) - Math.atan2(x, 0.3 - x)));
            const e = Math.exp(x * 0.01);
            worst = Math.max(worst, Math.abs(dexp(x * 0.01) - e) / e);
        }
        expect(worst).toBeLessThan(5e-16);
    });
    it('handles special values', () => {
        expect(datan2(0, -1)).toBe(Math.PI);
        expect(datan2(1, 0)).toBe(Math.PI / 2);
        expect(dexp(0)).toBe(1);
        expect(dsin(0)).toBe(0);
    });
});

describe('sha256', () => {
    it('matches the FIPS 180-2 vectors', () => {
        expect(sha256Hex(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
        expect(sha256Hex(new Uint8Array(0))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
        expect(sha256Hex(new TextEncoder().encode('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
    });
});
