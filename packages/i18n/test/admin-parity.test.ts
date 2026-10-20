// The owner's admin page dictionaries (apps/fly/src/admin/i18n.ts): the flat locales/admin/<lang>.json and
// one folder per tab, locales/admin/<ns>/<lang>.json (the Ideas tab: ideas/, the Outreach tab: outreach/, the Drawing tab: drawing/). In every file the same keys
// and placeholders in en/es/pl/ru, English is English, and a key lives in one file only (i18n.ts merges
// them, so the merge order must never pick a text). Kept apart from the simulator's dictionaries so the
// simulator bundle never carries the admin's words.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATALOG_SCENE_FIELDS } from '../../scenes/src/catalog';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'locales', 'admin');
const LANGS = ['en', 'es', 'pl', 'ru'] as const;
const CYRILLIC = new RegExp(`[${String.fromCharCode(0x400)}-${String.fromCharCode(0x4ff)}]`);
const holes = (s: string): string => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

type Dicts = Record<string, Record<string, unknown> | undefined>;
/** One dictionary file per language: '' is the flat set, otherwise the namespace (folder) name. */
type Sets = Record<string, Dicts>;

function readSets(): Sets {
    const read = (dir: string): Dicts => Object.fromEntries(LANGS.map((l) => {
        const f = join(dir, `${l}.json`);
        return [l, existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : undefined];
    }));
    const sets: Sets = { '': read(DIR) };
    for (const ns of readdirSync(DIR)) if (statSync(join(DIR, ns)).isDirectory()) sets[ns] = read(join(DIR, ns));
    return sets;
}

/** One file set: same keys and placeholders, nothing extra, English without Cyrillic. */
export function adminProblems(d: Dicts, where = ''): string[] {
    const out: string[] = [];
    const at = where ? `${where}/` : '';
    for (const l of LANGS) if (!d[l]) out.push(`${at}${l}: file missing`);
    const en = d.en ?? {};
    for (const l of LANGS.slice(1)) {
        const x = d[l];
        if (!x) continue;
        for (const k of Object.keys(en)) {
            if (typeof x[k] !== 'string') out.push(`${at}${l}: missing ${k}`);
            else if (holes(en[k] as string) !== holes(x[k] as string)) out.push(`${at}${l}: placeholders of ${k}`);
        }
        for (const k of Object.keys(x)) if (!(k in en)) out.push(`${at}${l}: extra ${k}`);
    }
    for (const [k, s] of Object.entries(en)) if (typeof s !== 'string' || CYRILLIC.test(s)) out.push(`${at}en: ${k}`);
    return out;
}

/** Every file set, plus a key defined in two sets. */
export function allProblems(sets: Sets): string[] {
    const out = Object.entries(sets).flatMap(([ns, d]) => adminProblems(d, ns));
    const owner = new Map<string, string>();
    for (const [ns, d] of Object.entries(sets)) {
        for (const k of Object.keys(d.en ?? {})) {
            const was = owner.get(k);
            if (was !== undefined) out.push(`${k} is in ${was || 'flat'} and ${ns || 'flat'}`);
            else owner.set(k, ns);
        }
    }
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
    // English as i18n.ts builds it: the flat file plus every tab's folder; the sources of every tab too
    const en: Record<string, unknown> = Object.assign({}, ...Object.values(readSets()).map((d) => d.en ?? {}));
    const used = { keys: [] as string[], prefixes: [] as string[] };
    for (const f of readdirSync(ADMIN_SRC, { recursive: true, encoding: 'utf8' }).filter((n) => n.endsWith('.ts'))) {
        const u = keysUsed(readFileSync(join(ADMIN_SRC, f), 'utf8'));
        used.keys.push(...u.keys);
        used.prefixes.push(...u.prefixes);
    }

    it('every key and key family the admin sources use, and a short name for every catalogue field', () => {
        expect(used.keys).toContain('admin.refresh.field');
        expect(used.prefixes).toContain('admin.changes.');
        expect(used.keys).toContain('admin.ideas.help');
        expect(used.prefixes).toContain('admin.ideas.kind.');
        expect(missingKeys(en, used, CATALOG_SCENE_FIELDS)).toEqual([]);
    });

    it('the check fires (negative control): a dropped key, a key family with no key, a field without a short name', () => {
        const broken: Record<string, unknown> = { ...en };
        delete broken['admin.refresh.field'];
        for (const k of Object.keys(broken)) if (k.startsWith('admin.tab.')) delete broken[k];
        delete broken['admin.key.geo'];
        expect(missingKeys(broken, used, CATALOG_SCENE_FIELDS)).toEqual(['missing admin.refresh.field', 'no key starts with admin.tab.', 'missing admin.key.geo']);
        expect(keysUsed("t('admin.a'); x.t('admin.b'); t(`admin.c.${k}`); t(`admin.d`); at('admin.e')")).toEqual({ keys: ['admin.a', 'admin.d'], prefixes: ['admin.c.'] });
    });
});

describe('admin dictionaries', () => {
    const sets = readSets();
    it('have the same keys and placeholders in every language, each key in one file', () => {
        expect(Object.keys(sets).sort()).toEqual(['', 'drawing', 'ideas', 'outreach']);
        expect(allProblems(sets)).toEqual([]);
    });
    it('the check fires (negative control)', () => {
        const d = sets[''];
        const broken: Dicts = { ...d, pl: { ...d.pl, 'admin.login.locked': 'bez minut' }, ru: { ...d.ru, 'admin.extra': 'x' }, es: { ...d.es } };
        delete (broken.es as Record<string, string>)['admin.logout'];
        expect(adminProblems(broken)).toEqual(['es: missing admin.logout', 'pl: placeholders of admin.login.locked', 'ru: extra admin.extra']);
    });
    it('a key in two files and a namespace without a language are caught (negative control)', () => {
        const ideas = sets.ideas;
        const twice: Sets = { '': { ...sets[''], en: { ...sets[''].en, 'admin.tab.ideas': 'Ideas' } }, ideas };
        expect(allProblems(twice)).toContain('admin.tab.ideas is in flat and ideas');
        const noPl: Sets = { ...sets, ideas: { ...ideas, pl: undefined } };
        expect(allProblems(noPl)).toContain('ideas/pl: file missing');
    });
});
