// Lane course4, stage C1-start-finish: the pure parts of apps/fly/src/course/finish.ts (lead decisions S1, S4, S5).
import { describe, expect, it } from 'vitest';
import { CARD_HOLD_MS, LAP_SPLASH_DEFAULT, LAP_SPLASH_MODES, SPLASH_FADE_MS, SPLASH_HOLD_MS, gateRoles, lapSplash, lapSplashMode, resultsCard, splashAlpha } from '../../../apps/fly/src/course/finish';

describe('course4 C1: START and FINISH gates (S1)', () => {
    it('a closed course: gate 1 is START / FINISH, no other gate says anything', () => {
        expect(gateRoles(5, true)).toEqual(['startFinish', null, null, null, null]);
    });
    it('an open course: gate 1 says START, the last gate FINISH', () => {
        expect(gateRoles(4, false)).toEqual(['start', null, null, 'finish']);
    });
    it('one gate alone is both; no gates, no roles', () => {
        expect(gateRoles(1, false)).toEqual(['startFinish']);
        expect(gateRoles(0, true)).toEqual([]);
    });
});

describe('course4 C1: the lap splash (S4)', () => {
    it('the first lap: the time alone, white', () => {
        expect(lapSplash(61234, null)).toEqual({ time: '1:01.23', delta: '', tone: 'first' });
    });
    it('a new best: green with the gain', () => {
        expect(lapSplash(59580, 60000)).toEqual({ time: '0:59.58', delta: '-0.42', tone: 'best' });
    });
    it('a slower lap: white with the loss; an equal lap is not a best', () => {
        expect(lapSplash(60380, 60000)).toEqual({ time: '1:00.38', delta: '+0.38', tone: 'slower' });
        expect(lapSplash(60000, 60000).tone).toBe('slower');
        expect(lapSplash(60000, 60000).delta).toBe('+0.00');
    });
    it('held 1.5 s, faded in 0.4 s, gone before 2 s', () => {
        expect(SPLASH_HOLD_MS).toBe(1500);
        expect(SPLASH_FADE_MS).toBe(400);
        expect(splashAlpha(0)).toBe(1);
        expect(splashAlpha(1500)).toBe(1);
        expect(splashAlpha(1700)).toBeCloseTo(0.5, 6);
        expect(splashAlpha(1900)).toBe(0);
        expect(splashAlpha(2000)).toBe(0);
        expect(splashAlpha(-1)).toBe(0);
    });
    it('the results card holds 3 s', () => {
        expect(CARD_HOLD_MS).toBe(3000);
        expect(splashAlpha(3000, CARD_HOLD_MS)).toBe(1);
        expect(splashAlpha(3400, CARD_HOLD_MS)).toBe(0);
    });
});

describe('course4 C1: the setting and the results card', () => {
    it('Lap time on screen: large, small, off; large by default and for anything else', () => {
        expect([...LAP_SPLASH_MODES]).toEqual(['large', 'small', 'off']);
        expect(LAP_SPLASH_DEFAULT).toBe('large');
        expect(lapSplashMode('small')).toBe('small');
        expect(lapSplashMode('off')).toBe('off');
        expect(lapSplashMode('huge')).toBe('large');
        expect(lapSplashMode(undefined)).toBe('large');
    });
    it('the card: the total, the best lap, each lap', () => {
        expect(resultsCard([62310, 60120, 59880])).toEqual({ total: '3:02.31', best: '0:59.88', laps: ['1:02.31', '1:00.12', '0:59.88'] });
    });
});
