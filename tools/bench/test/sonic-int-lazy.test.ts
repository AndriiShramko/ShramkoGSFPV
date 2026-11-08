// v0.12 v12-int step 4 (docs/wip/v12-int.md): every visitor of the simulator downloads the main chunk, and a page not entered
// through ?sonic= must download neither the sound package nor the mode (the lessons, the start screen, the recorder). Before this
// step app/builtin/sonic-flight.ts imported the mode statically (+14.6 % gzip on the page's start-up scripts, measured). Here, from
// the sources: the static import graph of the page's entry (apps/fly/src/main.ts) reaches nothing of Fly by Sound but the entry's
// state, the "could not load" note and the GPU hint's words, and the eager dictionaries leave the recorder's namespace out; the
// feature shim installs nothing without an entry. The built chunks and a real page are checked by tools/bench/src/sonic-int-page.ts lazy.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { sonicFlight } from '../../../apps/fly/src/app/builtin/sonic-flight';
import type { FlightContext } from '../../../apps/fly/src/app/context';
import { setSonicEntry, setSonicInstaller } from '../../../apps/fly/src/sonic/entry-state';
import { KEYMAP } from '../../../packages/prefs/src/keymap';
import type { SonicEntry } from '../../../apps/fly/src/sonic/entry';

// LAZY_ROOT=<another checkout>: the same checks on another tree (the tree before this step fails them: docs/wip/v12-int.md step 4)
const ROOT = process.env.LAZY_ROOT ? resolve(process.env.LAZY_ROOT) : resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const rel = (p: string): string => relative(ROOT, p).split('\\').join('/');

/** The specifiers a module imports for its run time: `import type`, all-type named imports and dynamic import() are left out. */
export function staticImports(src: string): string[] {
    const out: string[] = [];
    const from = /^[ \t]*(import|export)\s+(type\s+)?([^;'"]*?)\s*from\s*['"]([^'"]+)['"]/gm;
    for (const m of src.matchAll(from)) {
        if (m[2]) continue;
        const what = (m[3] ?? '').trim();
        const named = /^\{([\s\S]*)\}$/.exec(what);
        if (named && named[1]!.split(',').map((s) => s.trim()).filter((s) => s !== '').every((s) => s.startsWith('type '))) continue;
        out.push(m[4] as string);
    }
    for (const m of src.matchAll(/^[ \t]*import\s+['"]([^'"]+)['"]/gm)) out.push(m[1] as string);
    return out;
}

/** A file for a specifier: relative paths, the workspace's @gsfpv/* packages by their exports; a bare package as `pkg:<name>`. */
function resolveSpec(fromFile: string, spec: string): string {
    if (spec.startsWith('.')) {
        const base = resolve(dirname(fromFile), spec);
        for (const c of [base, `${base}.ts`, join(base, 'index.ts')]) if (existsSync(c) && !c.endsWith(base + '/') && /\.\w+$/.test(c)) return c;
        throw new Error(`cannot resolve ${spec} from ${rel(fromFile)}`);
    }
    const ws = /^@gsfpv\/([^/]+)(\/.*)?$/.exec(spec);
    if (ws) {
        const pkgDir = join(ROOT, 'packages', ws[1] as string);
        const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')) as { exports?: Record<string, string | Record<string, string>>; main?: string };
        const key = ws[2] ? `.${ws[2]}` : '.';
        let target = pkg.exports?.[key] ?? (key === '.' ? pkg.main : undefined);
        // a pattern export: "./fly/*": "./locales/fly/*"
        for (const [k, v] of Object.entries(pkg.exports ?? {})) {
            if (target !== undefined || !k.endsWith('/*') || !key.startsWith(k.slice(0, -1)) || typeof v !== 'string') continue;
            target = v.replace('*', key.slice(k.length - 1));
        }
        const file = typeof target === 'string' ? target : target?.import ?? target?.default;
        if (!file) throw new Error(`no export ${key} in @gsfpv/${ws[1]}`);
        return join(pkgDir, file);
    }
    return `pkg:${spec}`;
}

/** Every module the run time of `entry` loads before it runs (static imports only), files and bare packages. */
export function staticClosure(entry: string): Set<string> {
    const seen = new Set<string>();
    const walk = (file: string): void => {
        if (seen.has(file)) return;
        seen.add(file);
        if (file.startsWith('pkg:') || !/\.(ts|tsx|js|mjs)$/.test(file)) return;
        for (const spec of staticImports(readFileSync(file, 'utf8'))) walk(resolveSpec(file, spec));
    };
    walk(entry);
    return seen;
}

const MAIN = join(ROOT, 'apps/fly/src/main.ts');
/** What of Fly by Sound the main chunk may hold: the entry's state, the note that it did not load, the GPU hint's words. */
const ALLOWED = new Set(['apps/fly/src/sonic/entry-state.ts', 'apps/fly/src/sonic/unavailable.ts', 'apps/fly/src/sonic/gpu-hint.ts']);
const soundOf = (closure: Set<string>): string[] =>
    [...closure]
        .map((f) => (f.startsWith('pkg:') ? f : rel(f)))
        .filter((f) => /^pkg:@shramko\/sonic-fpv/.test(f) || f.startsWith('packages/sonic-fpv/') || f.startsWith('apps/fly/src/sonic-session/') || (f.startsWith('apps/fly/src/sonic/') && !ALLOWED.has(f)))
        .sort();

/** Every quoted string of `sources` that looks like a key of Fly by Sound's texts (sonic.* or keys.sonic.*). */
function askedSonic(sources: readonly string[]): Set<string> {
    const asked = new Set<string>();
    for (const src of sources) for (const m of src.matchAll(/['`]((?:keys\.)?sonic\.[\w.-]+)['`]/g)) asked.add(m[1] as string);
    return asked;
}

/** The keys of the namespaces only a ?sonic= page loads (the start chunk adds them, sonic/texts.ts), in English. */
const LAZY_KEYS = new Set(['sonic', 'sonickeys'].flatMap((ns) => Object.keys(JSON.parse(readFileSync(join(ROOT, `packages/i18n/locales/fly/${ns}/en.json`), 'utf8')) as Record<string, string>)));
/** Of those, what an ordinary page's code may name because it reads it only on a ?sonic= page: the mode's key labels, the GPU hint's line. */
const ONLY_IN_MODE = new Set([...KEYMAP.filter((b) => b.when === 'sonic').map((b) => b.labelKey), 'sonic.say.gpuHint']);
/** The keys of the mode's own namespaces that `sources` name and an ordinary page would show raw. */
function lazyAsked(sources: readonly string[]): string[] {
    return [...askedSonic(sources)].filter((k) => LAZY_KEYS.has(k) && !ONLY_IN_MODE.has(k)).sort();
}

describe('the main chunk holds nothing of Fly by Sound (static imports from apps/fly/src/main.ts)', () => {
    const closure = staticClosure(MAIN);

    it('reaches neither the sound package nor the mode, the start screen, the lessons or the recorder', () => {
        expect(closure.size).toBeGreaterThan(100); // the walk follows the whole simulator
        expect(soundOf(closure)).toEqual([]);
        expect([...closure].map(rel)).toContain('apps/fly/src/sonic/entry-state.ts');
        expect([...closure].map(rel)).toContain('apps/fly/src/app/builtin/sonic-flight.ts');
    });

    it('the eager dictionaries of the page leave the recorder\'s namespace out (it comes with the session chunk, sonic-session/texts.ts)', () => {
        const globs: string[] = [];
        for (const f of closure) {
            if (f.startsWith('pkg:') || !f.endsWith('.ts')) continue;
            for (const m of readFileSync(f, 'utf8').matchAll(/import\.meta\.glob(?:<[^(]*>)?\(\s*(\[[^\]]*\]|'[^']*')/g)) globs.push(m[1] as string);
        }
        const wide = globs.filter((g) => g.includes('locales/fly/*/'));
        expect(wide.length).toBeGreaterThan(0);
        for (const g of wide) expect(g, g).toMatch(/'!\.\.\/\.\.\/\.\.\/packages\/i18n\/locales\/fly\/sonicrec\/\*\.json'/);
        expect(globs.filter((g) => g.includes('/sonicrec/') && !g.includes('!'))).toEqual([]);
        // v12-optin: nor the mode's own texts (sonic) and the names of its keys (sonickeys); the start chunk adds them (sonic/texts.ts)
        for (const ns of ['sonic', 'sonickeys']) {
            for (const g of wide) expect(g, `${ns}: ${g}`).toContain(`'!../../../packages/i18n/locales/fly/${ns}/*.json'`);
            expect(globs.filter((g) => g.includes(`/fly/${ns}/`) && !g.includes('!')), ns).toEqual([]);
        }
        const texts = readFileSync(join(ROOT, 'apps/fly/src/sonic/texts.ts'), 'utf8');
        expect(texts).toContain("locales/fly/sonic/*.json'");
        expect(texts).toContain("locales/fly/sonickeys/*.json'");
        // the start chunk's first import, so the strings are there before any of its modules runs
        expect(/^\s*import\s+['"]([^'"]+)['"]/m.exec(readFileSync(join(ROOT, 'apps/fly/src/sonic/lazy-start.ts'), 'utf8').replace(/^\s*\/\/.*$/gm, ''))?.[1]).toBe('./texts');
    });

    it('v12-optin: every text of Fly by Sound the main chunk\'s own code asks for is in sonicentry, the one namespace of the mode every page keeps; none of the mode\'s own namespaces (sonic, sonickeys) is asked but where it is read on a ?sonic= page only', () => {
        const entry = JSON.parse(readFileSync(join(ROOT, 'packages/i18n/locales/fly/sonicentry/en.json'), 'utf8')) as Record<string, string>;
        expect(Object.keys(entry).sort()).toEqual(['sonic.menu.page', 'sonic.say.lessonFailed']);
        const sources = [...closure].filter((f) => !f.startsWith('pkg:') && f.endsWith('.ts')).map((f) => readFileSync(f, 'utf8'));
        expect([...askedSonic(sources)].filter((k) => k in entry).sort()).toEqual(['sonic.menu.page', 'sonic.say.lessonFailed']);
        // review R9 (c): the keys of the namespaces the start chunk adds (sonic/texts.ts) are raw keys on an ordinary page, so the main
        // chunk names none of them but those read only on a ?sonic= page: the keymap's labels of the mode's own keys (listed only
        // there) and the GPU hint's spoken line (said by the engine, which is in the start chunk)
        expect(lazyAsked(sources)).toEqual([]);
    });

    it('control: the same check finds a key of the mode\'s namespaces named in the main chunk (a t(\'sonic.close\') would show the raw key on an ordinary page), which the check before review R9 let through', () => {
        const planted = ["import { t } from '../i18n';", "export const back = (): string => t('sonic.close');"].join('\n');
        expect(lazyAsked([planted])).toEqual(['sonic.close']);
        // the check before the review kept only `.say.` and `sonic.menu.` keys: sonic.close slipped through it
        expect([...askedSonic([planted])].filter((k) => k.includes('.say.') || k.startsWith('sonic.menu.'))).toEqual([]);
    });

    it('control: the walk does find the package and the mode where they are imported (the mode\'s own module, the lazy start chunk)', () => {
        const mode = soundOf(staticClosure(join(ROOT, 'apps/fly/src/sonic/feature.ts')));
        expect(mode).toContain('pkg:@shramko/sonic-fpv');
        expect(mode).toContain('apps/fly/src/sonic/mode.ts');
        expect(mode).toContain('apps/fly/src/sonic/lessons.ts');
        const start = soundOf(staticClosure(join(ROOT, 'apps/fly/src/sonic/lazy-start.ts')));
        expect(start).toContain('apps/fly/src/sonic/start.ts');
        expect(start).toContain('pkg:@shramko/sonic-fpv');
        expect(start).not.toContain('apps/fly/src/sonic/feature.ts'); // behind import(): the mode is a chunk of its own
    });

    it('control: the import reader keeps value imports and drops types and import()', () => {
        const src = [
            "import { SonicMode } from '../../sonic/mode';",
            "import type { SonicEntry } from './entry';",
            "import { type A, type B } from './types-only';",
            "import X, { type C } from './default-value';",
            "export { sonicEntry } from './entry-state';",
            "import './side-effect.css';",
            "const m = await import('./lazy');",
            '// import { nope } from "./comment-at-line-start-is-not-code";'
        ].join('\n');
        expect(staticImports(src)).toEqual(['../../sonic/mode', './default-value', './entry-state', './side-effect.css']);
    });
});

describe('the feature shim', () => {
    afterEach(() => {
        setSonicEntry(null);
        setSonicInstaller(null);
    });

    it('a page without an entry installs no mode (no installer is called); only the pause menu\'s link to /sound/, which its teardown takes out (v12-optin)', () => {
        const items: { id: string }[] = [];
        const ctx = { menu: { add: (it: { id: string }) => (items.push(it), () => void items.splice(items.indexOf(it), 1)) } } as unknown as FlightContext;
        let called = 0;
        setSonicInstaller(() => {
            called++;
            return () => undefined;
        });
        const teardown = sonicFlight.install(ctx);
        expect(called).toBe(0);
        expect(items.map((i) => i.id)).toEqual(['pause.flyBySound']);
        (teardown as () => void)();
        expect(items).toEqual([]);
    });

    it('a page with an entry installs the mode the lazy chunk brought, and its teardown is the feature\'s', () => {
        const ctx = {} as FlightContext;
        const entry = { lessonId: 'hover-height' } as unknown as SonicEntry;
        const seen: unknown[] = [];
        let torn = 0;
        setSonicEntry(entry);
        setSonicInstaller((c, e) => {
            seen.push(c, e);
            return () => void torn++;
        });
        const teardown = sonicFlight.install(ctx);
        expect(seen).toEqual([ctx, entry]);
        expect(typeof teardown).toBe('function');
        (teardown as () => void)();
        expect(torn).toBe(1);
        // control: an entry whose mode did not load installs nothing either (the start screen said so)
        setSonicInstaller(null);
        expect(sonicFlight.install(ctx)).toBeUndefined();
    });
});
