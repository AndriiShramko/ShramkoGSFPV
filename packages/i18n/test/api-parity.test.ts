// The API's dictionaries (apps/api/texts.py): locales/bot/<lang>.json, the owner's Telegram bot
// (the owner reads Russian), and locales/mail/<lang>.json, the e-mails to pilots in their language.
// Flat {key: text}; the same keys and {placeholders} in en/es/pl/ru (a missing placeholder would
// raise in str.format, an extra one would print braces), English is English, and a translation is not
// the English text left in place (unless it has no words: "{id}: {status}").
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LANGS = ['en', 'es', 'pl', 'ru'] as const;
const HERE = dirname(fileURLToPath(import.meta.url));
const CYRILLIC = new RegExp(`[${String.fromCharCode(0x400)}-${String.fromCharCode(0x4ff)}]`);
const holes = (s: string): string => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
const words = (s: string): string => s.replace(/\{\w+\}/g, '').replace(/[^\p{L}]+/gu, '');
const read = (group: string, l: string): Record<string, unknown> => JSON.parse(readFileSync(join(HERE, '..', 'locales', group, `${l}.json`), 'utf8'));

export function apiProblems(d: Record<string, Record<string, unknown>>): string[] {
    const out: string[] = [];
    const en = d.en;
    for (const [k, s] of Object.entries(en)) if (typeof s !== 'string' || CYRILLIC.test(s)) out.push(`en: ${k}`);
    for (const l of LANGS.slice(1)) {
        for (const k of Object.keys(en)) {
            const s = d[l][k];
            if (typeof s !== 'string') out.push(`${l}: missing ${k}`);
            else if (holes(en[k] as string) !== holes(s)) out.push(`${l}: placeholders of ${k}`);
            else if (s === en[k] && words(s)) out.push(`${l}: ${k} is the English text`);
        }
        for (const k of Object.keys(d[l])) if (!(k in en)) out.push(`${l}: extra ${k}`);
    }
    return out;
}

describe.each(['bot', 'mail'])('%s dictionaries', (group) => {
    const d = Object.fromEntries(LANGS.map((l) => [l, read(group, l)]));
    it('have the same keys and placeholders in every language, translated', () => {
        expect(apiProblems(d)).toEqual([]);
    });
    it('the check fires (negative control)', () => {
        const [k0, k1, k2] = Object.keys(d.en).filter((k) => holes(d.en[k] as string));
        const broken = { ...d, pl: { ...d.pl, [k0]: 'bez dziur' }, ru: { ...d.ru, extra: 'x' }, es: { ...d.es, [k2]: d.en[k2] } };
        delete (broken.es as Record<string, unknown>)[k1];
        expect(apiProblems(broken)).toEqual([`es: missing ${k1}`, `es: ${k2} is the English text`, `pl: placeholders of ${k0}`, 'ru: extra extra']);
    });
});
