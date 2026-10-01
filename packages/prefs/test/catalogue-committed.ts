// The landing's catalogue as it is committed: apps/site/src/generated/features.json and the site
// dictionaries' tune.count / tune.adv. Only scripts/gen-catalog.ts writes them, and only the lead runs
// it, so both always move together. Tests that check what the site shows read these files and never the
// live schema or keymap: an agent who ships a setting, a key or a keyboard-flying change in a parallel
// branch may not regenerate the catalogue, and its `vitest run` must stay green all the same. Whether the
// committed catalogue still matches the live schema is the job of one gate only,
// `node --import tsx scripts/gen-catalog.ts --check` (CI), which may be stale in such a branch
// (review of the lead-fix branch: the vitest freshness test that went red on a parallel agent's count).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { countWord, TILES } from '../../../scripts/gen-catalog';
import type { Features } from '../../../scripts/gen-catalog';
import { REPO } from './helpers';

export const SITE_LANGS = ['en', 'es', 'pl', 'ru'] as const;

/** The committed catalogue the landing renders. */
export function committedFeatures(): Features {
    return JSON.parse(readFileSync(join(REPO, 'apps', 'site', 'src', 'generated', 'features.json'), 'utf8')) as Features;
}

/** A committed site dictionary, as text (the generator edits it in place). */
export function siteText(lang: string): string {
    return readFileSync(join(REPO, 'packages', 'i18n', 'locales', 'site', `${lang}.json`), 'utf8');
}

interface SiteTune { count: Record<string, string>; adv: string; text: { count: Record<string, Record<string, string>> } }
export const siteTune = (text: string): SiteTune => (JSON.parse(text) as { tune: SiteTune }).tune;

/** The tiles whose word in a site dictionary is not the plural form its number in `counts` needs. */
export function tileMismatches(lang: string, text: string, counts: Features['counts']): string[] {
    const tune = siteTune(text);
    return TILES.filter(([tile, key]) => tune.count[tile] !== countWord(lang, tune.text.count[tile], counts[key])).map(([tile]) => tile);
}

/**
 * What is wrong with how a catalogue writes Space in one language (review C14): in es, pl and ru the
 * word is the page's own, never the English cap, and the shortcut list and the flying card write it the
 * same way; in en it is Space. The flying card's Space row is found by its English caps, not by position.
 */
export function spaceProblems(f: Features, lang: (typeof SITE_LANGS)[number]): string[] {
    const loc = f.locales[lang];
    const out: string[] = [];
    const arm = loc.keys.find((k) => k.action === 'arm.toggle')?.keys;
    const row = f.locales.en.flying.findIndex((r) => r.keys.length === 1 && r.keys[0] === 'Space');
    const flying = row < 0 ? undefined : loc.flying[row]?.keys;
    if (!arm || arm.length !== 1) out.push(`${lang}: no single cap for arm.toggle`);
    if (!flying) out.push(`${lang}: no Space row in the flying card`);
    if (arm && flying && JSON.stringify(arm) !== JSON.stringify(flying)) out.push(`${lang}: the shortcut list writes ${arm.join('+')}, the flying card ${flying.join('+')}`);
    if (lang === 'en') {
        if (arm?.[0] !== 'Space') out.push('en: arm.toggle is not Space');
        return out;
    }
    const all = [...loc.keys.flatMap((k) => k.keys), ...loc.flying.flatMap((k) => k.keys), ...loc.groups.flatMap((g) => g.settings.flatMap((s) => s.keys))];
    if (all.includes('Space')) out.push(`${lang}: an English Space cap`);
    return out;
}
