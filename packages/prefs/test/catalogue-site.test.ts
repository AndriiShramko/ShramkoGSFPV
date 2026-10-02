// What the site and GitHub catalogue says about keys and counts (review findings C13, C14, C15 of the
// v0.3 cloud work): every row that a key changes shows that key; a key that is a word (Space) is written
// in the page's language, the same in the shortcut list and in the keyboard-flying card; the counter
// tiles of the landing put each noun in the plural form its number needs, and the "Advanced" badge uses
// the simulator's word. Every check has a negative control that must fire.
// What the landing shows is checked on the committed catalogue (catalogue-committed.ts), never rebuilt
// from the live schema here: whether it is still fresh is `gen-catalog --check`'s job alone, so an agent
// who ships a setting or a key without regenerating keeps a green vitest (catalogue-site-drift.test.ts).
import { describe, expect, it } from 'vitest';
import { KEYMAP, SCHEMA, buildCatalogue, capText, helpKey, labelKey } from '../src';
import type { Schema } from '../src';
import { countWord, siteDerived, withSiteDerived } from '../../../scripts/gen-catalog';
import { committedFeatures, siteText, siteTune, spaceProblems, tileMismatches } from './catalogue-committed';
import { PRESETS } from './helpers';

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

    it('the committed catalogue: in es, pl and ru the shortcut list and the flying card write Space the same way, never in English', () => {
        const f = committedFeatures();
        for (const l of LANGS) expect(spaceProblems(f, l), l).toEqual([]);
        const word = f.locales.ru.keys.find((k) => k.action === 'arm.toggle')!.keys[0];
        expect(word).not.toBe('Space');
        // controls: the English cap left in the Russian flying card, and a Polish flying card that writes it otherwise
        const row = f.locales.en.flying.findIndex((r) => r.keys[0] === 'Space');
        const english = structuredClone(f);
        english.locales.ru.flying[row].keys = ['Space'];
        expect(spaceProblems(english, 'ru')).toEqual([`ru: the shortcut list writes ${word}, the flying card Space`, 'ru: an English Space cap']);
        const other = structuredClone(f);
        other.locales.pl.flying[row].keys = ['Spc'];
        expect(spaceProblems(other, 'pl')).toHaveLength(1);
    });
});

describe('the counter tiles and the Advanced badge on the landing (C15)', () => {
    const forms = (l: string, tile: string) => siteTune(siteText(l)).text.count[tile];

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

    it('each committed dictionary carries the word its tile needs for the number in the committed catalogue', () => {
        const { counts } = committedFeatures();
        for (const l of LANGS) expect(tileMismatches(l, siteText(l), counts), l).toEqual([]);
        // control: the Russian dictionary with the other form for the group count is caught
        const text = siteText('ru');
        const g = forms('ru', 'groups');
        const now = siteTune(text).count.groups;
        const planted = text.replace(`"groups": ${JSON.stringify(now)}`, `"groups": ${JSON.stringify(now === g.few ? g.many : g.few)}`);
        expect(planted).not.toBe(text);
        expect(tileMismatches('ru', planted, counts)).toEqual(['groups']);
    });

    it("the generator rewrites a word that does not fit the count, and an Advanced that is not the simulator's, and nothing else", () => {
        // the committed counts and the Advanced word already in the file: what the lead's last run wrote
        const { counts } = committedFeatures();
        const text = siteText('ru');
        const tune = siteTune(text);
        const g = forms('ru', 'groups');
        const planted = text.replace(`"groups": ${JSON.stringify(tune.count.groups)}`, `"groups": ${JSON.stringify(tune.count.groups === g.few ? g.many : g.few)}`)
            .replace(`"adv": ${JSON.stringify(tune.adv)}`, '"adv": "planted"');
        expect(planted).not.toBe(text);
        const fixed = withSiteDerived(planted, siteDerived('ru', planted, counts, { 'settings.advanced': tune.adv }));
        expect(fixed).toBe(text);
        // the edit touches only those two values: the rest of the file stays byte for byte
        const changed = planted.split('\n').filter((line, i) => line !== fixed.split('\n')[i]);
        expect(changed).toHaveLength(2);
        // and a new word of the simulator's lands in tune.adv
        expect(siteTune(withSiteDerived(text, siteDerived('ru', text, counts, { 'settings.advanced': '\u0420\u0430\u0441\u0448\u0438\u0440\u0435\u043d\u043d\u044b\u0435' }))).adv).toBe('\u0420\u0430\u0441\u0448\u0438\u0440\u0435\u043d\u043d\u044b\u0435');
    });
});
