// The owner's admin page dictionaries (locales/admin/<lang>.json, apps/fly/src/admin/i18n.ts): the same
// keys and placeholders in en/es/pl/ru, and English is English. Kept apart from the simulator's
// dictionaries so the simulator bundle never carries the admin's words.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'locales', 'admin');
const LANGS = ['en', 'es', 'pl', 'ru'] as const;
const CYRILLIC = new RegExp(`[${String.fromCharCode(0x400)}-${String.fromCharCode(0x4ff)}]`);
const read = (l: string): Record<string, string> => JSON.parse(readFileSync(join(DIR, `${l}.json`), 'utf8'));
const holes = (s: string): string => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

export function adminProblems(d: Record<string, Record<string, unknown>>): string[] {
    const out: string[] = [];
    const en = d.en;
    for (const l of LANGS.slice(1)) {
        for (const k of Object.keys(en)) {
            if (typeof d[l][k] !== 'string') out.push(`${l}: missing ${k}`);
            else if (holes(en[k] as string) !== holes(d[l][k] as string)) out.push(`${l}: placeholders of ${k}`);
        }
        for (const k of Object.keys(d[l])) if (!(k in en)) out.push(`${l}: extra ${k}`);
    }
    for (const [k, s] of Object.entries(en)) if (typeof s !== 'string' || CYRILLIC.test(s)) out.push(`en: ${k}`);
    return out;
}

describe('admin dictionaries', () => {
    const d = Object.fromEntries(LANGS.map((l) => [l, read(l)]));
    it('have the same keys and placeholders in every language', () => {
        expect(adminProblems(d)).toEqual([]);
    });
    it('the check fires (negative control)', () => {
        const broken = { ...d, pl: { ...d.pl, 'admin.login.locked': 'bez minut' }, ru: { ...d.ru, 'admin.extra': 'x' } };
        broken.es = { ...d.es };
        delete (broken.es as Record<string, string>)['admin.logout'];
        expect(adminProblems(broken)).toEqual(['es: missing admin.logout', 'pl: placeholders of admin.login.locked', 'ru: extra admin.extra']);
    });
});
