// Rule 1.4 of scripts/check-architecture.mjs, run on a copy of the tree so a planted violation
// never touches the real sources: the rule passes on prefs as it is, and fails on a `window.`
// planted in the core. Also: prefs imports nothing outside itself ("no dependencies", A.1).
import { describe, expect, it } from 'vitest';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO } from './helpers';

const SRC = join(REPO, 'packages', 'prefs', 'src');

function runRuleOnCopy(plant?: { file: string; line: string }): { code: number | null; out: string } {
    const root = mkdtempSync(join(tmpdir(), 'prefs-arch-'));
    try {
        mkdirSync(join(root, 'scripts'));
        cpSync(join(REPO, 'scripts', 'check-architecture.mjs'), join(root, 'scripts', 'check-architecture.mjs'));
        cpSync(SRC, join(root, 'packages', 'prefs', 'src'), { recursive: true });
        if (plant) {
            const f = join(root, 'packages', 'prefs', 'src', plant.file);
            writeFileSync(f, `${readFileSync(f, 'utf8')}\n${plant.line}\n`);
        }
        const r = spawnSync(process.execPath, [join(root, 'scripts', 'check-architecture.mjs')], { encoding: 'utf8' });
        return { code: r.status, out: `${r.stdout}${r.stderr}` };
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}

describe('architecture rule 1.4', () => {
    it('passes on prefs as it is', () => {
        const r = runRuleOnCopy();
        expect(r.out).toContain('architecture rules: ok');
        expect(r.code).toBe(0);
    });

    it('control: a window. planted in the core fails it', () => {
        const r = runRuleOnCopy({ file: 'store.ts', line: 'export const planted = () => window.localStorage;' });
        expect(r.code).toBe(1);
        expect(r.out).toMatch(/prefs touches the DOM outside browser\.ts .*store\.ts/);
    });

    it('control: localStorage and navigator are caught in any core file; a comment is not code', () => {
        expect(runRuleOnCopy({ file: 'doc.ts', line: 'export const p = () => localStorage.getItem("x");' }).code).toBe(1);
        expect(runRuleOnCopy({ file: 'defs/tune.ts', line: 'export const q = () => navigator.storage;' }).code).toBe(1);
        expect(runRuleOnCopy({ file: 'store.ts', line: '// window.localStorage is only named here' }).code).toBe(0);
    });

    it('browser.ts may use the DOM', () => {
        expect(runRuleOnCopy({ file: 'browser.ts', line: 'export const w = () => window.innerWidth;' }).code).toBe(0);
    });
});

/**
 * The prefs review (docs/wip/wave1-reports.json, prefsReview.mustFix[0]): the first rule fired only
 * on a name followed by '.' or '(', so the lines browser.ts itself uses to reach storage passed in
 * the core. Each line below must fail the rule in store.ts; the same line in browser.ts must pass
 * (the control: the failure comes from the rule's scope, not from a broken copy of the tree).
 */
const BYPASSES: [string, string][] = [
    ['globalThis property', 'export const a = () => globalThis.localStorage ?? null;'],
    ['bare window as a value', "export const b = () => (typeof window === 'undefined' ? null : window);"],
    ['globalThis IndexedDB', 'export const c = () => globalThis.indexedDB ?? null;'],
    ['bare localStorage kept in a variable', 'export const d = () => { const ls = localStorage; return ls; };'],
    ['optional chaining on globalThis', "export const e = () => globalThis.location?.origin ?? '';"],
    ['globalThis with a string index', "export const f = () => globalThis['sessionStorage'];"],
    ['globalThis kept in a variable', 'export const g = () => { const G = globalThis; return G; };'],
    ['self as the window', 'export const k = () => self.navigator;'],
    ['code inside a template literal', 'export const h = () => `${document.title}`;'],
    ['bare navigator after an operator', 'export const m = () => !!navigator;']
];

describe('architecture rule 1.4: bypasses found by the review', () => {
    for (const [name, line] of BYPASSES) {
        it(`fails on ${name} in the core`, () => {
            const r = runRuleOnCopy({ file: 'store.ts', line });
            expect(r.out).toMatch(/prefs touches the DOM outside browser\.ts .*store\.ts/);
            expect(r.code).toBe(1);
        });
    }

    it('control: every bypass line passes in browser.ts, so the failures above are the rule\'s scope', () => {
        const r = runRuleOnCopy({ file: 'browser.ts', line: BYPASSES.map(([, l]) => l).join('\n') });
        expect(r.out).toContain('architecture rules: ok');
        expect(r.code).toBe(0);
    });

    it('text is not code: DOM names inside strings, template text and comments pass; a property named like a global passes', () => {
        const lines = [
            "export const s1 = 'window.localStorage is only named here';",
            'export const s2 = "globalThis.indexedDB, navigator and document in prose";',
            'export const s3 = `the document (A.4) and the window of a tab`;',
            "export const s4 = 'a quote \\' then window.localStorage';",
            '/* a block comment: window.document, globalThis.localStorage */',
            'export const p1 = (o: { document: number; location: string }) => o.document + o.location.length;',
            "export const p2 = 'http://x//y' + (1 / 2);"
        ];
        const r = runRuleOnCopy({ file: 'store.ts', line: lines.join('\n') });
        expect(r.out).toContain('architecture rules: ok');
        expect(r.code).toBe(0);
    });
});

describe('no dependencies', () => {
    it('prefs sources import only each other', () => {
        const bad: string[] = [];
        const walk = (dir: string) => {
            for (const e of readdirSync(dir, { withFileTypes: true })) {
                const p = join(dir, e.name);
                if (e.isDirectory()) walk(p);
                else for (const m of readFileSync(p, 'utf8').matchAll(/(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]/g)) if (!m[1].startsWith('.')) bad.push(`${e.name}: ${m[1]}`);
            }
        };
        walk(SRC);
        expect(bad).toEqual([]);
        expect(JSON.parse(readFileSync(join(REPO, 'packages', 'prefs', 'package.json'), 'utf8')).dependencies).toBeUndefined();
    });
});
