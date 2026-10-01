// The control of the gate itself (review of the lead-fix branch, two findings on catalogue-site.test.ts):
// a parallel agent ships settings or changes keyboard flying and, by the wave rules, may not regenerate
// the catalogue. In that branch the catalogue checks of catalogue-site.test.ts must stay green (they read
// the committed catalogue), while the comparison with the live schema they replaced goes red there: the
// control that shows the branch really is one the old test failed in. Only `gen-catalog --check` (CI)
// says "stale" in such a branch, and the lead regenerates after the merge.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type * as Prefs from '../src';

type PrefsModule = typeof Prefs;

/** Import the generator and the committed-catalogue checks in a branch where the prefs package is patched. */
async function inBranch(patch: (real: PrefsModule) => Partial<PrefsModule>) {
    vi.resetModules();
    vi.doMock('../src', async (importOriginal) => {
        const real = await importOriginal<PrefsModule>();
        return { ...real, ...patch(real) };
    });
    const gen = await import('../../../scripts/gen-catalog');
    const committed = await import('./catalogue-committed');
    return { gen, committed };
}

afterEach(() => {
    vi.doUnmock('../src');
    vi.resetModules();
});

/** The Russian plural category of a number, and the settings count in the committed catalogue (a plain read). */
const ruCat = (n: number) => new Intl.PluralRules('ru').select(n);
const REPO = join(__dirname, '..', '..', '..');
const committedSettings = (): number =>
    (JSON.parse(readFileSync(join(REPO, 'apps', 'site', 'src', 'generated', 'features.json'), 'utf8')) as { counts: { settings: number } }).counts.settings;

describe('a branch that ships without regenerating keeps the catalogue checks green (gate control)', () => {
    it('settings shipped until the Russian word for their count changes: the committed check is green, the live comparison red', async () => {
        const { gen, committed } = await inBranch((real) => {
            const base = committedSettings();
            const planned = real.SCHEMA.defs.filter((d) => d.status === 'planned');
            let defs = real.SCHEMA.defs;
            for (let k = 1; k <= planned.length; k++) {
                const ship = new Set(planned.slice(0, k).map((d) => d.id));
                defs = real.SCHEMA.defs.map((d) => (ship.has(d.id) ? { ...d, status: 'shipped' as const } : d));
                if (ruCat(base + k) !== ruCat(base)) break;
            }
            return { SCHEMA: real.defineSettings(defs) };
        });
        const live = gen.buildFeatures('2026-10-01').features.counts;
        const counts = committed.committedFeatures().counts;
        expect(ruCat(live.settings)).not.toBe(ruCat(counts.settings));
        // control: the old test's assertion (the dictionary regenerated from the live schema equals the
        // committed one) is red in this branch, on the settings tile
        const text = committed.siteText('ru');
        const fly = JSON.parse(readFileSync(join(REPO, 'packages', 'i18n', 'locales', 'fly', 'ru.json'), 'utf8')) as Record<string, string>;
        expect(gen.withSiteDerived(text, gen.siteDerived('ru', text, live, fly))).not.toBe(text);
        expect(committed.tileMismatches('ru', text, live)).toEqual(['settings']);
        // the checks of catalogue-site.test.ts: green
        for (const l of committed.SITE_LANGS) {
            expect(committed.tileMismatches(l, committed.siteText(l), counts), l).toEqual([]);
            expect(committed.spaceProblems(committed.committedFeatures(), l), l).toEqual([]);
        }
    });

    it('keyboard flying changed (the M key no longer shared): the committed check is green, the live build stops', async () => {
        const { gen, committed } = await inBranch(() => ({ SHARED_WITH_FLYING: {} }));
        // control: the old Space test built the catalogue from the live keymap and threw here
        expect(() => gen.buildFeatures('2026-10-01')).toThrow(/keyboard flying changed/);
        for (const l of committed.SITE_LANGS) expect(committed.spaceProblems(committed.committedFeatures(), l), l).toEqual([]);
    });
});
