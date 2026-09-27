// The simulator's dictionaries (docs/architecture-v03.md 1.3): the flat locales/fly/<lang>.json and
// one folder per namespace, locales/fly/<ns>/<lang>.json. apps/fly/src/i18n.ts merges them all into
// one table per language, so a key must have the same placeholders in en/es/pl/ru, English must be
// English, and a key must live in one file only (else the merge order would pick the text).
// The site dictionary has its own check (apps/site/scripts/i18n-check.mjs); this one is the fly's.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const LANGS = ['en', 'es', 'pl', 'ru'] as const;
type Lang = (typeof LANGS)[number];

/** Namespaces named in docs/architecture-v03.md 1.3: more may come, none may go. */
const DESIGN_NAMESPACES = ['prefs', 'set', 'group', 'mode', 'respawn', 'stats', 'summary', 'rotation', 'superspl', 'scale', 'voxels', 'rec', 'keys'];

const HERE = dirname(fileURLToPath(import.meta.url));
const FLY = join(HERE, '..', 'locales', 'fly');
const FLY_I18N = join(HERE, '..', '..', '..', 'apps', 'fly', 'src', 'i18n.ts');

/** The Cyrillic block, U+0400-U+04FF, from code points: no Cyrillic letters in code (repo rule). */
const CYRILLIC = new RegExp(`[${String.fromCharCode(0x400)}-${String.fromCharCode(0x4ff)}]`);
/** The language picker names each language in that language, in every dictionary. */
const ENDONYMS = new Set(['lang.ru']);

/** One set of dictionary files: the flat one (ns '') or a namespace; parsed JSON per language. */
interface DictSet { ns: string; files: Partial<Record<Lang, unknown>> }

function placeholders(s: string): string {
    return [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
}

/** Everything wrong with the dictionaries, empty when they are sound. */
export function parityProblems(sets: readonly DictSet[]): string[] {
    const out: string[] = [];
    const owner = new Map<string, string>();
    for (const { ns, files } of sets) {
        const where = ns || 'flat';
        const dict: Partial<Record<Lang, Record<string, string>>> = {};
        for (const l of LANGS) {
            const v = files[l];
            if (v === undefined) { out.push(`${where}/${l}.json is missing`); continue; }
            if (!v || typeof v !== 'object' || Array.isArray(v)) { out.push(`${where}/${l}.json is not an object of strings`); continue; }
            const d: Record<string, string> = {};
            for (const [k, s] of Object.entries(v)) {
                if (typeof s === 'string') d[k] = s;
                else out.push(`${where}/${l}: ${k} is not a string (t() reads flat keys only)`);
            }
            dict[l] = d;
        }
        const en = dict.en;
        if (en) {
            for (const l of LANGS.slice(1)) {
                const d = dict[l];
                if (!d) continue;
                for (const k of Object.keys(en)) {
                    if (!(k in d)) out.push(`${where}/${l}: missing ${k}`);
                    else if (placeholders(en[k]) !== placeholders(d[k])) out.push(`${where}/${l}: placeholders of ${k} differ from en`);
                }
                for (const k of Object.keys(d)) if (!(k in en)) out.push(`${where}/${l}: extra key ${k}`);
            }
            for (const [k, s] of Object.entries(en)) if (CYRILLIC.test(s) && !(ns === '' && ENDONYMS.has(k))) out.push(`${where}/en: Cyrillic in ${k}`);
        }
        const keys = new Set(LANGS.flatMap((l) => Object.keys(dict[l] ?? {})));
        for (const k of keys) {
            const first = owner.get(k);
            if (first !== undefined) out.push(`${k} is in ${first} and in ${where}`);
            else owner.set(k, where);
        }
    }
    return out;
}

function readSet(dir: string): Partial<Record<Lang, unknown>> {
    const files: Partial<Record<Lang, unknown>> = {};
    for (const l of LANGS) {
        const p = join(dir, `${l}.json`);
        if (existsSync(p)) files[l] = JSON.parse(readFileSync(p, 'utf8'));
    }
    return files;
}

function loadTree(): DictSet[] {
    const sets: DictSet[] = [{ ns: '', files: readSet(FLY) }];
    for (const n of readdirSync(FLY).sort()) if (statSync(join(FLY, n)).isDirectory()) sets.push({ ns: n, files: readSet(join(FLY, n)) });
    return sets;
}

/** The folder a glob pattern of apps/fly/src/i18n.ts reaches (the pattern minus its `/<ns>/<lang>.json`). */
function globRoot(source: string): string | null {
    const m = source.match(/import\.meta\.glob[^(]*\(\s*'([^']+)'/);
    if (!m || !m[1].endsWith('/*/*.json')) return null;
    return resolve(dirname(FLY_I18N), m[1].slice(0, -'/*/*.json'.length));
}

/** The real tree with one change: `edit` gets a deep copy of the sets. */
function planted(edit: (sets: DictSet[]) => void): DictSet[] {
    const sets = JSON.parse(JSON.stringify(loadTree())) as DictSet[];
    edit(sets);
    return sets;
}
const set = (sets: DictSet[], ns: string): Record<Lang, Record<string, unknown>> => sets.find((s) => s.ns === ns)!.files as Record<Lang, Record<string, unknown>>;
/** A key added in every language of a namespace, placeholders included. */
function addEverywhere(sets: DictSet[], ns: string, key: string, text: string): void {
    for (const l of LANGS) set(sets, ns)[l][key] = text;
}

describe('fly dictionaries: parity', () => {
    it('every namespace of the design exists with its four files', () => {
        const tree = loadTree();
        for (const n of DESIGN_NAMESPACES) {
            const s = tree.find((x) => x.ns === n);
            expect(s, n).toBeDefined();
            expect(Object.keys(s!.files).sort(), n).toEqual([...LANGS].sort());
        }
    });

    it('the flat dictionary and every namespace: same keys and placeholders, English in en, one file per key', () => {
        expect(parityProblems(loadTree())).toEqual([]);
    });

    it('i18n.ts merges the folders this test checks', () => {
        expect(globRoot(readFileSync(FLY_I18N, 'utf8'))).toBe(resolve(FLY));
    });
});

describe('fly dictionaries: negative controls (each must be caught)', () => {
    it('a key missing in pl', () => {
        const sets = planted((s) => {
            addEverywhere(s, 'keys', 'keys.control', 'Control');
            delete set(s, 'keys').pl['keys.control'];
        });
        expect(parityProblems(sets)).toEqual(['keys/pl: missing keys.control']);
    });

    it('a key missing in pl of the flat dictionary', () => {
        const sets = planted((s) => { delete set(s, '').pl['app.title']; });
        expect(parityProblems(sets)).toEqual(['flat/pl: missing app.title']);
    });

    it('a key only es has', () => {
        const sets = planted((s) => { set(s, 'mode').es['mode.extra'] = 'Extra'; });
        expect(parityProblems(sets)).toEqual(['mode/es: extra key mode.extra']);
    });

    it('a placeholder renamed in ru', () => {
        const sets = planted((s) => {
            addEverywhere(s, 'stats', 'stats.control', '{n} crashes');
            set(s, 'stats').ru['stats.control'] = '{count} crashes';
        });
        expect(parityProblems(sets)).toEqual(['stats/ru: placeholders of stats.control differ from en']);
    });

    it('Cyrillic in English, also under a language-name key outside the flat file', () => {
        const ru = String.fromCharCode(0x420, 0x443, 0x441);
        const sets = planted((s) => {
            addEverywhere(s, 'rec', 'rec.control', 'Record');
            set(s, 'rec').en['rec.control'] = `Record ${ru}`;
            addEverywhere(s, 'set', 'lang.ru', ru);
        });
        expect(parityProblems(sets)).toEqual(['rec/en: Cyrillic in rec.control', 'set/en: Cyrillic in lang.ru', 'lang.ru is in flat and in set']);
    });

    it('the same key in two files', () => {
        const sets = planted((s) => addEverywhere(s, 'summary', 'pause.title', 'Paused'));
        expect(parityProblems(sets)).toEqual(['pause.title is in flat and in summary']);
    });

    it('a missing file and a nested object', () => {
        const sets = planted((s) => {
            delete s.find((x) => x.ns === 'voxels')!.files.pl;
            for (const l of LANGS) if (l !== 'pl') set(s, 'voxels')[l]['voxels.style'] = { grid: 'Grid' };
        });
        expect(parityProblems(sets)).toEqual([
            'voxels/en: voxels.style is not a string (t() reads flat keys only)',
            'voxels/es: voxels.style is not a string (t() reads flat keys only)',
            'voxels/pl.json is missing',
            'voxels/ru: voxels.style is not a string (t() reads flat keys only)'
        ]);
    });

    it('a glob that no longer reaches the dictionaries', () => {
        const src = readFileSync(FLY_I18N, 'utf8');
        const wrong = src.replace('../../../packages/i18n/locales/fly/*/*.json', '../../packages/i18n/locales/fly/*/*.json');
        expect(wrong).not.toBe(src);
        expect(globRoot(wrong)).not.toBe(resolve(FLY));
    });
});
