// ?render=off, the logic-only test mode (apps/fly/src/app/test-modes.ts): nothing a visitor can
// reach turns it on. It is a classified test switch (APP_URL_PARAMS_NOT_SETTINGS), exactly one place
// reads it and only for the exact value 'off', no code builds a URL with it, and no page, dictionary,
// README or llms.txt links to it. Negative controls: a planted link and a planted URL builder are
// both caught by the same scans.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { APP_URL_PARAMS_NOT_SETTINGS } from '../../../packages/prefs/src';
import { REPO } from '../../../packages/prefs/test/helpers';

function files(dir: string, re: RegExp, out: string[] = []): string[] {
    if (!existsSync(dir)) return out;
    for (const n of readdirSync(dir).sort()) {
        if (n === 'node_modules' || n === '.next' || n === 'out' || n === 'dist' || n === 'generated-media') continue;
        const p = join(dir, n);
        if (statSync(p).isDirectory()) files(p, re, out);
        else if (re.test(n)) out.push(p);
    }
    return out;
}
const rel = (p: string) => relative(REPO, p).split('\\').join('/');
/** The code of a source without its whole-line comments (the switch is documented in comments). */
const code = (src: string) => src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

const FLY_SRC = files(join(REPO, 'apps', 'fly', 'src'), /\.ts$/).map((p) => ({ p: rel(p), code: code(readFileSync(p, 'utf8')) }));
/** What a visitor or a crawler reads: the site, the fly page's HTML and public files, the dictionaries, README, llms.txt. */
const PUBLIC = [
    ...files(join(REPO, 'apps', 'site', 'src'), /\.(tsx?|css|json|md)$/),
    ...files(join(REPO, 'apps', 'site', 'public'), /\.(html|json|txt|xml|webmanifest)$/),
    ...files(join(REPO, 'apps', 'fly', 'public'), /\.(html|json|txt)$/),
    join(REPO, 'apps', 'fly', 'index.html'),
    ...files(join(REPO, 'packages', 'i18n', 'locales'), /\.json$/),
    join(REPO, 'README.md'),
    join(REPO, 'llms.txt')
].filter((p) => existsSync(p)).map((p) => ({ p: rel(p), text: readFileSync(p, 'utf8') }));

const LINK = /render(=|%3D)off/i;
const BUILDS = /searchParams\.(set|append)\(\s*['"]render['"]/;
const linksIn = (list: { p: string; text: string }[]) => list.filter((f) => LINK.test(f.text)).map((f) => f.p);
const readersIn = (list: { p: string; code: string }[]) => list.filter((f) => /\bq\.get\(\s*'render'\s*\)/.test(f.code)).map((f) => f.p);
const buildersIn = (list: { p: string; code: string }[]) => list.filter((f) => BUILDS.test(f.code) || (LINK.test(f.code) && !f.p.endsWith('app/test-modes.ts'))).map((f) => f.p);

describe('?render=off cannot be reached from the site or the app UI', () => {
    it('it is a classified test switch, never a setting', () => {
        expect(APP_URL_PARAMS_NOT_SETTINGS.render).toMatch(/^test: /);
        expect(APP_URL_PARAMS_NOT_SETTINGS.render).toMatch(/never a visual/);
    });

    it('one reader, app/test-modes.ts, and only the exact value off', () => {
        expect(readersIn(FLY_SRC)).toEqual(['apps/fly/src/app/test-modes.ts']);
        const tm = FLY_SRC.find((f) => f.p === 'apps/fly/src/app/test-modes.ts')!.code;
        expect(tm).toMatch(/return q\.get\('render'\) === 'off';/);
    });

    it('no fly code builds a URL with it (the page tag in test-modes.ts only names it)', () => {
        expect(buildersIn(FLY_SRC)).toEqual([]);
    });

    it('no public page, dictionary, README or llms.txt links to it', () => {
        expect(PUBLIC.length).toBeGreaterThan(20);
        expect(linksIn(PUBLIC)).toEqual([]);
    });

    it('controls: a planted link on the landing and a planted URL builder in the app are caught', () => {
        const landing = PUBLIC.find((f) => f.p.startsWith('apps/site/src/'))!;
        expect(linksIn([{ ...landing, text: `${landing.text}\n<a href="/en/fly/?scene=39e63ce9&render=off">fly</a>` }])).toEqual([landing.p]);
        const boot = FLY_SRC.find((f) => f.p === 'apps/fly/src/app/boot.ts')!;
        expect(buildersIn([{ ...boot, code: `${boot.code}\nu.searchParams.set('render', 'off');` }])).toEqual([boot.p]);
        expect(readersIn([{ ...boot, code: `${boot.code}\nconst r = q.get('render');` }])).toEqual([boot.p]);
    });
});
