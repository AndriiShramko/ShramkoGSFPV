// What the site and GitHub catalogue says about keys and counts (review findings C13, C14, C15 of the
// v0.3 cloud work): every row that a key changes shows that key; a key that is a word (Space) is written
// in the page's language, the same in the shortcut list and in the keyboard-flying card; the counter
// tiles of the landing put each noun in the plural form its number needs, and the "Advanced" badge uses
// the simulator's word. Every check has a negative control that must fire.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { KEYMAP, SCHEMA, buildCatalogue, capText, helpKey, labelKey } from '../src';
import type { Schema } from '../src';
import { buildFeatures, countWord, siteDerived, withSiteDerived, TILES } from '../../../scripts/gen-catalog';
import { PRESETS, REPO } from './helpers';

const LANGS = ['en', 'es', 'pl', 'ru'] as const;

/** A complete synthetic dictionary per language (as in catalog.test.ts), optionally with the word for Space. */
function dicts(space?: Record<string, string>): Record<string, Record<string, string>> {
    const out: Record<string, Record<string, string>> = {};
    for (const l of LANGS) {
        const d: Record<string, string> = { 'prefs.on': `on-${l}`, 'prefs.off': `off-${l}`, 'prefs.fromPreset': `preset-${l}`, 'prefs.fromCurated': `curated-${l}` };
        for (const def of SCHEMA.defs) {
            d[labelKey(def)] = `${def.id}-${l}`;
            d[helpKey(def)] = `help ${def.id}-${l}`;
            if (def.type === 'enum') for (const o of def.options) d[`set.${def.id}.opt.${o}`] = `${o}-${l}`;
        }
        for (const g of SCHEMA.groups) d[`group.${g}`] = `${g}-${l}`;
        for (const b of KEYMAP) d[b.labelKey] = `${b.action}-${l}`;
        for (const f of ['drone.twr', 'drone.weight', 'drone.wheelbase', 'drone.motor', 'drone.battery']) d[f] = `${f}-${l}`;
        if (space?.[l]) d['arm.keys.space'] = space[l];
        out[l] = d;
    }
    return out;
}

/** Shipped rows that say a key changes them (shown: 'key') but show no key-cap. */
function keylessRows(schema: Schema): string[] {
    const c = buildCatalogue(schema, KEYMAP, dicts(), PRESETS, { generated: '2026-10-01' });
    const rows = c.locales.en.groups.flatMap((g) => g.settings);
    return schema.defs.filter((d) => d.status === 'shipped' && d.shown.includes('key')).map((d) => d.id).filter((id) => !rows.find((r) => r.id === id)?.keys.length);
}

describe('key-caps in the catalogue (C13, C14)', () => {
    it('every shipped row that a key changes shows its key: the walls row shows C', () => {
        expect(keylessRows(SCHEMA)).toEqual([]);
        const c = buildCatalogue(SCHEMA, KEYMAP, dicts(), PRESETS, { generated: '2026-10-01' });
        expect(c.locales.en.groups.flatMap((g) => g.settings).find((s) => s.id === 'scene.walls')!.keys).toEqual(['C']);
        // control: the walls def as it was (no action) is caught
        const before: Schema = { ...SCHEMA, defs: SCHEMA.defs.map((d) => (d.id === 'scene.walls' ? { ...d, action: undefined } : d)) };
        expect(keylessRows(before)).toEqual(['scene.walls']);
    });

    it('a word key-cap is written in the language of the page; letters and symbols stay', () => {
        expect(['Space', 'Esc', 'Enter', 'Shift+N', 'C', '[', 'F3'].map((k) => capText(k, { 'arm.keys.space': 'X' }))).toEqual(['X', 'Esc', 'Enter', 'Shift+N', 'C', '[', 'F3']);
        const words = { en: 'Space', es: 'Espacio', pl: 'Spacja', ru: 'R-space' };
        const c = buildCatalogue(SCHEMA, KEYMAP, dicts(words), PRESETS, { generated: '2026-10-01' });
        for (const l of LANGS) expect(c.locales[l].keys.find((k) => k.action === 'arm.toggle')!.keys, l).toEqual([words[l]]);
        // control: without the word the English cap is what a page would show
        const bare = buildCatalogue(SCHEMA, KEYMAP, dicts(), PRESETS, { generated: '2026-10-01' });
        expect(bare.locales.ru.keys.find((k) => k.action === 'arm.toggle')!.keys).toEqual(['Space']);
    });

    it('the real catalogue: in es, pl and ru the shortcut list and the flying card write Space the same way, never in English', () => {
        const { features } = buildFeatures('2026-10-01');
        const fly = (l: string) => JSON.parse(readFileSync(join(REPO, 'packages', 'i18n', 'locales', 'fly', `${l}.json`), 'utf8')) as Record<string, string>;
        for (const l of ['es', 'pl', 'ru'] as const) {
            const loc = features.locales[l];
            const word = fly(l)['arm.keys.space'];
            expect(word).not.toBe('Space');
            const all = [...loc.keys.flatMap((k) => k.keys), ...loc.flying.flatMap((k) => k.keys), ...loc.groups.flatMap((g) => g.settings.flatMap((s) => s.keys))];
            expect(all, l).not.toContain('Space');
            expect(loc.keys.find((k) => k.action === 'arm.toggle')!.keys, l).toEqual([word]);
            expect(loc.flying[0].keys, l).toEqual([word]); // the flying card's arm row
        }
        expect(features.locales.en.keys.find((k) => k.action === 'arm.toggle')!.keys).toEqual(['Space']);
    });
});

describe('the counter tiles and the Advanced badge on the landing (C15)', () => {
    const site = (l: string) => readFileSync(join(REPO, 'packages', 'i18n', 'locales', 'site', `${l}.json`), 'utf8');
    const forms = (l: string, tile: string) => (JSON.parse(site(l)) as { tune: { text: { count: Record<string, Record<string, string>> } } }).tune.text.count[tile];

    it('picks the form each number needs in Russian and Polish (CLDR plural rules)', () => {
        const ru = forms('ru', 'groups');
        const got = [1, 2, 4, 5, 7, 11, 12, 14, 21, 22, 25, 101, 111].map((n) => countWord('ru', ru, n));
        expect(got).toEqual([ru.one, ru.few, ru.few, ru.many, ru.many, ru.many, ru.many, ru.many, ru.one, ru.few, ru.many, ru.one, ru.many]);
        const pl = forms('pl', 'keys');
        expect([1, 2, 5, 12, 17, 22, 25].map((n) => countWord('pl', pl, n))).toEqual([pl.one, pl.few, pl.many, pl.many, pl.many, pl.few, pl.many]);
        const en = forms('en', 'settings');
        expect([1, 22].map((n) => countWord('en', en, n))).toEqual(['setting', 'settings']);
        // control: the nominative plural the tiles used to show for every count is wrong for 7 groups and 17 keys
        expect(countWord('ru', ru, 7)).not.toBe(ru.few);
        expect(countWord('pl', pl, 17)).not.toBe(pl.few);
    });

    it('the committed dictionaries carry the words for today\'s counts and the simulator\'s Advanced', () => {
        const { features } = buildFeatures('2026-10-01');
        for (const l of LANGS) {
            const fly = JSON.parse(readFileSync(join(REPO, 'packages', 'i18n', 'locales', 'fly', `${l}.json`), 'utf8')) as Record<string, string>;
            const text = site(l);
            const d = siteDerived(l, text, features.counts, fly);
            expect(withSiteDerived(text, d), `${l}: run node --import tsx scripts/gen-catalog.ts`).toBe(text);
            const tune = (JSON.parse(text) as { tune: { count: Record<string, string>; adv: string } }).tune;
            for (const [tile, key] of TILES) expect(tune.count[tile], `${l} ${tile}`).toBe(countWord(l, forms(l, tile), features.counts[key]));
            expect(tune.adv).toBe(fly['settings.advanced']);
        }
    });

    it('control: a fixed word that does not fit the count, and an Advanced the simulator does not use, are rewritten', () => {
        const { features } = buildFeatures('2026-10-01');
        const fly = JSON.parse(readFileSync(join(REPO, 'packages', 'i18n', 'locales', 'fly', 'ru.json'), 'utf8')) as Record<string, string>;
        const text = site('ru');
        const tune = (JSON.parse(text) as { tune: { count: Record<string, string>; adv: string } }).tune;
        const g = forms('ru', 'groups');
        const planted = text.replace(`"groups": ${JSON.stringify(tune.count.groups)}`, `"groups": ${JSON.stringify(countWord('ru', g, features.counts.groups) === g.few ? g.many : g.few)}`)
            .replace(`"adv": ${JSON.stringify(tune.adv)}`, '"adv": "planted"');
        expect(planted).not.toBe(text);
        const fixed = withSiteDerived(planted, siteDerived('ru', planted, features.counts, fly));
        expect(fixed).toBe(text);
        // the edit touches only those two values: the rest of the file stays byte for byte
        const changed = planted.split('\n').filter((line, i) => line !== fixed.split('\n')[i]);
        expect(changed).toHaveLength(2);
    });
});
