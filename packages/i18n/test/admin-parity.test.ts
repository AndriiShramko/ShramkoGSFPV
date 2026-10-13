// The owner's admin page dictionaries (locales/admin/<lang>.json, apps/fly/src/admin/i18n.ts): the same
// keys and placeholders in en/es/pl/ru, and English is English. Kept apart from the simulator's
// dictionaries so the simulator bundle never carries the admin's words.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATALOG_SCENE_FIELDS } from '../../scenes/src/catalog';

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

/** The admin page's sources: every key they hand to t() must be in the dictionaries. */
const ADMIN_SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'apps', 'fly', 'src', 'admin');

/**
 * The keys a source hands to t(): a quoted literal is a key (t('admin.refresh.field')); a template literal
 * gives its fixed start (t(`admin.kind.${k}`) -> prefix 'admin.kind.'), which some key must begin with.
 */
export function keysUsed(src: string): { keys: string[]; prefixes: string[] } {
    const keys: string[] = [];
    const prefixes: string[] = [];
    for (const m of src.matchAll(/(?<![\w.$])t\(\s*(?:'(admin\.[^'\\]*)'|"(admin\.[^"\\]*)"|`(admin\.[^`$\\]*)(\$\{)?[^`]*`)/g)) {
        if (m[1] ?? m[2]) keys.push((m[1] ?? m[2]) as string);
        else if (m[4]) prefixes.push(m[3]);
        else keys.push(m[3]);
    }
    return { keys, prefixes };
}

/** What the admin page asks for that the English dictionary lacks (parity carries it to the others). */
export function missingKeys(en: Record<string, unknown>, used: { keys: string[]; prefixes: string[] }, fields: readonly string[]): string[] {
    const out: string[] = [];
    for (const k of new Set(used.keys)) if (typeof en[k] !== 'string') out.push(`missing ${k}`);
    for (const p of new Set(used.prefixes)) if (!Object.keys(en).some((k) => k.startsWith(p) && k.length > p.length)) out.push(`no key starts with ${p}`);
    for (const f of fields) if (typeof en[`admin.key.${f}`] !== 'string') out.push(`missing admin.key.${f}`);
    return out;
}

describe('the admin page names only words the dictionaries have', () => {
    const en = read('en');
    const used = { keys: [] as string[], prefixes: [] as string[] };
    for (const f of readdirSync(ADMIN_SRC).filter((n) => n.endsWith('.ts'))) {
        const u = keysUsed(readFileSync(join(ADMIN_SRC, f), 'utf8'));
        used.keys.push(...u.keys);
        used.prefixes.push(...u.prefixes);
    }

    it('every key and key family the admin sources use, and a short name for every catalogue field', () => {
        expect(used.keys).toContain('admin.refresh.field');
        expect(used.prefixes).toContain('admin.changes.');
        expect(missingKeys(en, used, CATALOG_SCENE_FIELDS)).toEqual([]);
    });

    it('the check fires (negative control): a dropped key, a key family with no key, a field without a short name', () => {
        const broken: Record<string, string> = { ...en };
        delete broken['admin.refresh.field'];
        for (const k of Object.keys(broken)) if (k.startsWith('admin.tab.')) delete broken[k];
        delete broken['admin.key.geo'];
        expect(missingKeys(broken, used, CATALOG_SCENE_FIELDS)).toEqual(['missing admin.refresh.field', 'no key starts with admin.tab.', 'missing admin.key.geo']);
        expect(keysUsed("t('admin.a'); x.t('admin.b'); t(`admin.c.${k}`); t(`admin.d`); at('admin.e')")).toEqual({ keys: ['admin.a', 'admin.d'], prefixes: ['admin.c.'] });
    });
});

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
