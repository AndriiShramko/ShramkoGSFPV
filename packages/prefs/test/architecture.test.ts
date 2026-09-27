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
