// Step 0 of v0.12 (docs/wip/v12-plan.md section 3): the two guards that keep the Fly by Sound submodule
// (packages/sonic-fpv, its own public repository) honest. Each is the real script run on a copy of the
// tree in a temp folder, so a planted violation never touches the real sources and the submodule is
// never edited:
//   - scripts/check-architecture.mjs rule 7: the package's src imports only its own files;
//   - scripts/build-release.mjs: stops with "run git submodule update --init" when the package is missing.
// Every claim has a control that must fire: without one, a mistyped path inside a rule passes for ever.
// Node only. The first rule-7 test copies the package's real src, so it fails loudly in a checkout
// where the submodule was not initialised, which is the point.
import { describe, expect, it } from 'vitest';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));

interface Run { code: number | null; out: string }

/** check-architecture.mjs on a temp tree: the package's real src, plus `plant` (paths inside the package -> text). */
function archOnCopy(plant: Record<string, string> = {}): Run {
    const root = mkdtempSync(join(tmpdir(), 'sonic-arch-'));
    try {
        mkdirSync(join(root, 'scripts'));
        cpSync(join(REPO, 'scripts', 'check-architecture.mjs'), join(root, 'scripts', 'check-architecture.mjs'));
        // rule 6 requires the SuperSplat client to exist; copy it so only rule 7 decides here
        cpSync(join(REPO, 'packages', 'scenes', 'src', 'superspl.ts'), join(root, 'packages', 'scenes', 'src', 'superspl.ts'));
        cpSync(join(REPO, 'packages', 'sonic-fpv', 'src'), join(root, 'packages', 'sonic-fpv', 'src'), { recursive: true });
        for (const [rel, text] of Object.entries(plant)) {
            const f = join(root, 'packages', 'sonic-fpv', rel);
            mkdirSync(dirname(f), { recursive: true });
            writeFileSync(f, text);
        }
        const r = spawnSync(process.execPath, [join(root, 'scripts', 'check-architecture.mjs')], { encoding: 'utf8' });
        return { code: r.status, out: `${r.stdout}${r.stderr}` };
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}

describe('architecture rule 7: packages/sonic-fpv/src imports only itself', () => {
    it('passes on the package as it is (its real src, copied)', () => {
        const r = archOnCopy();
        expect(r.out).toContain('architecture rules: ok');
        expect(r.code).toBe(0);
    });

    const BAD: [string, string, RegExp][] = [
        ['a package', "import { x } from 'playcanvas';", /sonic-fpv imports playcanvas:/],
        ['a simulator package', "import type { S } from '@gsfpv/sim-core';", /sonic-fpv imports @gsfpv\/sim-core:/],
        ['a re-export of a simulator package', "export * from '@gsfpv/prefs';", /sonic-fpv imports @gsfpv\/prefs:/],
        ['a Node built-in', "import { readFileSync } from 'node:fs';", /sonic-fpv imports node:fs:/],
        ['a bare import with no binding', "import 'playcanvas';", /sonic-fpv imports playcanvas:/],
        ['a dynamic import', "export const load = () => import('playcanvas');", /sonic-fpv imports playcanvas:/],
        ['a relative path that leaves the package', "import { t } from '../../../apps/fly/src/i18n';", /sonic-fpv imports \.\.\/\.\.\/\.\.\/apps\/fly\/src\/i18n:/]
    ];
    for (const [name, line, want] of BAD) {
        it(`control: ${name} in src fails the rule`, () => {
            const r = archOnCopy({ 'src/planted.ts': `${line}\n` });
            expect(r.out).toMatch(want);
            expect(r.code).toBe(1);
        });
    }

    it('control: the same lines pass where the rule does not look (the package\'s test and tools folders)', () => {
        const r = archOnCopy({ 'test/planted.test.ts': `${BAD.map(([, l]) => l).join('\n')}\n`, 'tools/planted.ts': "import { readFileSync } from 'node:fs';\n" });
        expect(r.out).toContain('architecture rules: ok');
        expect(r.code).toBe(0);
    });

    it('control: its own files, near and far inside the package, pass', () => {
        const r = archOnCopy({ 'src/planted.ts': "import { a } from './index';\nexport { b } from '../src/index';\nimport './index';\n" });
        expect(r.out).toContain('architecture rules: ok');
        expect(r.code).toBe(0);
    });
});

/** build-release.mjs on a temp tree with or without the package's package.json; --skip-build so nothing is ever built. */
function buildOnCopy(withPackage: boolean): Run {
    const root = mkdtempSync(join(tmpdir(), 'sonic-build-'));
    try {
        mkdirSync(join(root, 'scripts'));
        cpSync(join(REPO, 'scripts', 'build-release.mjs'), join(root, 'scripts', 'build-release.mjs'));
        if (withPackage) {
            mkdirSync(join(root, 'packages', 'sonic-fpv'), { recursive: true });
            writeFileSync(join(root, 'packages', 'sonic-fpv', 'package.json'), '{}\n');
        }
        const r = spawnSync(process.execPath, [join(root, 'scripts', 'build-release.mjs'), '--skip-build'], { encoding: 'utf8' });
        return { code: r.status, out: `${r.stdout}${r.stderr}` };
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}

describe('build-release.mjs: the sound package must be there', () => {
    it('stops with the command that fixes it when packages/sonic-fpv/package.json is missing', () => {
        const r = buildOnCopy(false);
        expect(r.out).toContain('packages/sonic-fpv is missing: run git submodule update --init');
        expect(r.code).toBe(1);
    });

    it('control: with the package there it gets past that check (and stops later, on the GA sources the bare copy lacks)', () => {
        const r = buildOnCopy(true);
        expect(r.out).not.toContain('git submodule update --init');
        expect(r.out).toMatch(/ENOENT/);
        expect(r.code).toBe(1);
    });
});
