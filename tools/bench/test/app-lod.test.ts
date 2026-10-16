// v0.8 lane C (the owner's item 8): the F3 line that shows the levels of detail at work
// (apps/fly/src/app/lod.ts). The owner could not see whether his streamed city scan used levels of
// detail; each mode gets its own words, the governor's lowering and a content fallback are said, and the
// texts exist in en/es/pl/ru with the same placeholders. Controls: a report without lowering or fallback
// says neither; a missing key comes back as the key itself.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { lodLine, lodReport } from '../../../apps/fly/src/app/lod';
import type { LodReport, Say } from '../../../apps/fly/src/app/lod';
import { REPO } from '../src/evidence';

const LANGS = ['en', 'es', 'pl', 'ru'] as const;
const dict = (l: string) => JSON.parse(readFileSync(join(REPO, 'packages', 'i18n', 'locales', 'fly', 'lod', `${l}.json`), 'utf8')) as Record<string, string>;
/** t() as the page has it: the text with {name} filled, the key itself when there is no text. */
const sayIn = (d: Record<string, string>): Say => (key, vars) => (d[key] ?? key).replace(/\{(\w+)\}/g, (_m, k: string) => String(vars?.[k] ?? `{${k}}`));
const EN = sayIn(dict('en'));

const base: LodReport = {
    kind: 'lod-meta', levels: 10, range: [0, 9], mode: 'auto', drawn: 3_923_895, budgetM: 4, loading: 0,
    contentUrl: 'https://cdn/ba7aa29d/v1/lod-meta.json', contentFailures: [], renderScale: 1, topBudgetM: 4, governorStep: 0, streamHitches: 0
};

describe('lodLine', () => {
    it('the streamed city scan at full quality: levels, how they are chosen, splats of the budget, resolution', () => {
        expect(lodLine(base, EN)).toBe('Levels of detail: 10, chosen by distance · 3.9 of 4.0 M splats · 100 % resolution');
    });

    it.each([
        ['coarse', /the coarsest while the scan loads/],
        ['final', /the finest everywhere/],
        ['single', /^One level of detail/]
    ] as const)('mode %s has its own words', (mode, re) => {
        expect(lodLine({ ...base, mode }, EN)).toMatch(re);
    });

    it('the governor lowered the drawing: from what it was lowered is said; control: at the top nothing is', () => {
        const low = lodLine({ ...base, budgetM: 2, renderScale: 0.6, governorStep: 3 }, EN);
        expect(low).toMatch(/of 2\.0 M splats · 60 % resolution · lowered from 4\.0 M to hold the frame rate$/);
        expect(lodLine(base, EN)).not.toMatch(/lowered/);
        // cinema draws above the top on purpose: not a lowering either way
        expect(lodLine({ ...base, mode: 'final', budgetM: 16 }, EN)).not.toMatch(/lowered/);
    });

    it('a broken lod-meta.json and the single file shown instead is said; control: no failure, no words', () => {
        const fb = lodLine({ ...base, kind: 'meta', levels: 1, mode: 'single', contentFailures: [{ url: 'x/lod-meta.json', error: 'not an octree' }] }, EN);
        expect(fb).toMatch(/the streamed file did not open, the single file is shown$/);
        expect(lodLine({ ...base, mode: 'single' }, EN)).not.toMatch(/did not open/);
    });

    it('every language has every key with the same placeholders', () => {
        const keys = Object.keys(dict('en')).sort();
        const holes = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
        for (const l of LANGS) {
            const d = dict(l);
            expect(Object.keys(d).sort(), l).toEqual(keys);
            for (const k of keys) expect(holes(d[k]), `${l} ${k}`).toBe(holes(dict('en')[k]));
            // every mode the renderer reports has a line
            for (const m of ['auto', 'coarse', 'final', 'single']) expect(d[`lod.line.${m}`], `${l} ${m}`).toBeTruthy();
        }
    });

    it('control: a key that has no text comes back as the key (what a missing translation would show)', () => {
        expect(lodLine({ ...base, mode: 'unknown' as LodReport['mode'] }, EN)).toBe('lod.line.unknown');
    });
});

describe('lodReport', () => {
    it('joins the renderer, the session and the governor', () => {
        const ctx = {
            renderer: { renderScale: 0.85, lodState: () => ({ kind: 'lod-meta' as const, levels: 10, range: [0, 9] as [number, number], mode: 'auto' as const, drawn: 2_000_000, budgetM: 3, loading: 4 }) },
            session: { scene: { contentUrl: 'u/lod-meta.json' }, contentFailures: [] },
            quality: { governor: { topBudgetMillions: 4, step: 1, streamHitches: 7 } }
        } as unknown as Parameters<typeof lodReport>[0];
        expect(lodReport(ctx)).toEqual({ kind: 'lod-meta', levels: 10, range: [0, 9], mode: 'auto', drawn: 2_000_000, budgetM: 3, loading: 4, contentUrl: 'u/lod-meta.json', contentFailures: [], renderScale: 0.85, topBudgetM: 4, governorStep: 1, streamHitches: 7 });
    });
});
