// Lane course4, stage C1-start-finish: the pure parts of apps/fly/src/course/finish.ts (lead decisions S1, S4, S5).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as finish from '../../../apps/fly/src/course/finish';
import { CARD_HOLD_MS, LAP_SPLASH_DEFAULT, LAP_SPLASH_MODES, SPLASH_FADE_MS, SPLASH_HOLD_MS, gateRoles, lapSplash, lapSplashMode, resultsCard, splashAlpha } from '../../../apps/fly/src/course/finish';
import { SCHEMA } from '../../../packages/prefs/src';

describe('course4 review CU-4: no course at a Scene size leads to one that gives a course', () => {
    it('names a measured Scene size and the four locales say it with the press', () => {
        const to = (finish as { noCourseSize?: (s: number) => number }).noCourseSize;
        expect(typeof to).toBe('function');
        // Forest Floor ab5efa0e: none at x15, x20, x100 (gate-place-audit); courses at x10 and x1
        expect([15, 20, 100].map((s) => to!(s))).toEqual([10, 10, 10]);
        expect([0.5, 3, 10].map((s) => to!(s))).toEqual([1, 1, 1]);
        expect(to!(1)).toBe(2);
        for (const lang of ['en', 'es', 'pl', 'ru']) {
            const loc = JSON.parse(readFileSync(new URL(`../../../packages/i18n/locales/fly/course/${lang}.json`, import.meta.url), 'utf8')) as Record<string, string>;
            expect(loc['course.noneResize']).toMatch(/Shift\+G[^]*x\{to\}/);
            expect(loc['course.noneResize']).toContain('x{s}');
        }
    });
});

describe('course4 C1: the setting Lap time on screen in the settings schema (S4)', () => {
    it('is a Display setting with the three values of finish.ts, large by default, shown in Settings', () => {
        const d = SCHEMA.byId.get('course.lapSplash');
        expect(d?.type).toBe('enum');
        expect(d && d.type === 'enum' ? [...d.options] : []).toEqual([...LAP_SPLASH_MODES]);
        expect(d?.default).toBe(LAP_SPLASH_DEFAULT);
        expect(d?.shown).toContain('settings');
    });
});

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

describe('course4 review CU-1 and CU-2: the merge seams with lane onecourse', () => {
    const en = JSON.parse(readFileSync(new URL('../../../packages/i18n/locales/fly/course/en.json', import.meta.url), 'utf8')) as Record<string, string>;
    const tr = (k: string, vars?: Record<string, string | number>): string => (en[k] ?? k).replace(/\{(\w+)\}/g, (_, n: string) => String(vars?.[n] ?? ''));

    it('CU-1: a course asked by Fly by Sound holds single upright gates only; the eyes mode asks the elements', () => {
        const el = (finish as { courseElements?: (s: unknown) => boolean }).courseElements;
        expect(typeof el).toBe('function');
        expect(el!({ on: true })).toBe(false);
        expect(el!(null)).toBe(true);
        expect(el!(undefined)).toBe(true);
        // the page feature sends this answer in its generate job
        const src = readFileSync(new URL('../../../apps/fly/src/app/builtin/course.ts', import.meta.url), 'utf8');
        expect(src).toMatch(/elements:\s*courseElements\(ctx\.sonic\)/);
    });

    it('CU-2: a lap end gives both the splash and the spoken lap line; the course end the card and the line', () => {
        const end = (finish as { lapEnd?: (ev: 'lap' | 'done', ms: number, before: number | null, laps: readonly number[], t: typeof tr) => { splash: unknown; said: string; card: unknown; spoken: string; best: boolean } }).lapEnd;
        expect(typeof end).toBe('function');
        const lap = end!('lap', 61230, 60000, [61230], tr);
        expect(lap.best).toBe(false);
        expect(lap.splash).toEqual(lapSplash(61230, 60000));
        expect(lap.card).toBeNull();
        expect(lap.spoken).toBe(tr('course.lapDone', { time: '1:01.23' }));
        expect(lap.spoken).toBe(lap.said);
        const done = end!('done', 59880, 60000, [61230, 59880], tr);
        expect(done.best).toBe(true);
        expect(done.splash).toEqual(lapSplash(59880, 60000));
        expect(done.card).toEqual(resultsCard([61230, 59880]));
        expect(done.spoken).toBe(`${tr('course.best', { time: '0:59.88' })}. ${tr('course.card.title')}. ${tr('course.card.total', { time: '2:01.11' })}`);
        const src = readFileSync(new URL('../../../apps/fly/src/app/builtin/course.ts', import.meta.url), 'utf8');
        expect(src).toMatch(/hud\.splash\(end\.splash/);
        expect(src).toMatch(/sayLine\(end\.spoken\)/);
    });
});

describe('course5 Z1: the guide names START / FINISH on the screen (the 3D banner is 16 px wide from 60 m)', () => {
    const en = JSON.parse(readFileSync(new URL('../../../packages/i18n/locales/fly/course/en.json', import.meta.url), 'utf8')) as Record<string, string>;
    const tr = (k: string, vars?: Record<string, string | number>): string => (en[k] ?? k).replace(/\{(\w+)\}/g, (_, n: string) => String(vars?.[n] ?? ''));
    const f = finish as unknown as Record<string, unknown>;
    it('the label of a gate with a role says the role, the others their number', () => {
        expect(typeof f['guideLabel']).toBe('function');
        const label = f['guideLabel'] as (g: number, m: number, r: string | null, t: typeof tr) => string;
        const role = f['gateRole'] as (i: number, n: number, closed: boolean) => string | null;
        expect(label(0, 60, role(0, 30, true), tr)).toBe('START / FINISH · 60 m');
        expect(label(0, 60, role(0, 30, false), tr)).toBe('START · 60 m');
        expect(label(29, 12, role(29, 30, false), tr)).toBe('FINISH · 12 m');
        expect(label(4, 20, role(4, 30, false), tr)).toBe('Gate 5 · 20 m');
        for (const closed of [true, false]) for (const n of [1, 2, 7]) expect(Array.from({ length: n }, (_, i) => role(i, n, closed))).toEqual(gateRoles(n, closed));
    });
    it('the page passes the role of the guided gate', () => {
        const src = readFileSync(new URL('../../../apps/fly/src/app/builtin/course.ts', import.meta.url), 'utf8');
        expect(src).toMatch(/hud\.guide\([^\n]*gateRole\(target, run\.gates\.length, run\.track\.laps > 1\)\)/);
        for (const l of ['en', 'es', 'pl', 'ru']) {
            const j = JSON.parse(readFileSync(new URL(`../../../packages/i18n/locales/fly/course/${l}.json`, import.meta.url), 'utf8')) as Record<string, string>;
            expect(j['course.hud.guideRole']).toMatch(/\{role\}.*\{m\}/);
        }
    });
});
