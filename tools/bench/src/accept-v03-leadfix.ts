// The lead fixer's checks in a real browser and on the built site (review of the cloud's v0.3 work,
// 2026-10-01: findings C8, C13, C14, C15, C18). Fresh browser contexts only, never a pilot's profile.
// Every check has a negative control that must fire; a check whose control does not fire fails.
//   K1 (C18) the visual / latency gate in real Chrome: system Chrome on this PC gets a GPU renderer and
//      counts; control: the same Chrome forced onto SwiftShader is refused.
//   K2 (C8)  the real SuperSplat catalogue client (packages/scenes/src/superspl.ts, bundled) in Chrome,
//      against a local proxy stand-in that answers `public, max-age=600`: a second tab's client asks the
//      proxy again instead of taking the browser's HTTP-cache copy, whose max-age would count twice;
//      control: the same client with the fetch cache mode put back to 'default' gets the cached copy.
//   K3 (C13, C14, C15) the built landing (apps/site/out, `pnpm --filter @gsfpv/site build` first): the
//      counter tiles' nouns agree with their numbers in every language, Space is written in the page's
//      language in es/pl/ru and in English in en, the walls row shows C; control: the same reading of a
//      copy planted with the old words / caps fails.
// No scan is drawn (K1 makes one 1x1 WebGL context), so no GPU lock is needed; the port is the fixer's.
//   npx tsx tools/bench/src/accept-v03-leadfix.ts            evidence/<date>/v03-leadfix.json
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { launchChrome } from './browser';
import { REPO, writeEvidence } from './evidence';
import { NoGpuError, browserRecord, pickHarnessBrowser, webglRenderer } from '../scripts/visual-browser.mjs';
import { TILES, countWord } from '../../../scripts/gen-catalog';

const PORT = Number(process.env.PORT ?? 5325);
const results: Record<string, unknown>[] = [];
const record = (id: string, pass: boolean, controlFired: boolean, data: Record<string, unknown>) => {
    results.push({ id, pass: pass && controlFired, checkPassed: pass, controlFired, ...data });
    console.log(`${id}: ${pass && controlFired ? 'PASS' : 'FAIL'} (check ${pass}, control fired ${controlFired})`);
};

// ------------------------------------------------------------------ K1 the visual gate in real Chrome
const pick = pickHarnessBrowser({ expected: chromium.executablePath() });
const { browser, which } = await launchChrome({ headless: false, args: ['--window-position=40,40', '--window-size=1296,920'] });
try {
    const ctx = await browser.newContext();
    const real = await browserRecord(which, await ctx.newPage());
    await ctx.close();
    const soft = await chromium.launch({ ...pick.launch, headless: false, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    let refused = '';
    let softGl: string | null = null;
    try {
        const p = await (await soft.newContext()).newPage();
        softGl = await webglRenderer(p);
        await browserRecord(pick, p, { version: soft.version(), env: {} }).catch((e: unknown) => { refused = e instanceof NoGpuError ? e.message : `other: ${String(e)}`; });
    } finally {
        await soft.close();
    }
    record('K1-visual-gate', real.kind === 'system-chrome' && real.counts && !real.softwareGl, refused.length > 0 && !refused.startsWith('other'), {
        real, control: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'], webgl: softGl, refused }
    });

    // -------------------------------------------------------------- K2 the catalogue client and the HTTP cache
    const asked = new Map<string, number>();
    const bundle = (await build({ entryPoints: [join(REPO, 'packages', 'scenes', 'src', 'superspl.ts')], bundle: true, format: 'iife', globalName: 'GS', write: false, logLevel: 'silent' })).outputFiles[0].text;
    const server: Server = createServer((req, res) => {
        const u = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
        if (u.pathname === '/api/superspl/explore') {
            asked.set(u.search, (asked.get(u.search) ?? 0) + 1);
            const items = [{ id: 'c67edb74', version: 1, title: 'x', author: 'a', likes: 1, views: 1, sizeBytes: 1, thumbs: {}, format: 'sog' }];
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=600', 'X-Cache': 'hit' });
            res.end(JSON.stringify({ ok: true, query: {}, total: 1, fetchedAt: Math.floor(Date.now() / 1000) - 300, items }));
            return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end('<!doctype html><title>catalogue client</title>');
    });
    await new Promise<void>((ok, fail) => { server.once('error', fail); server.listen(PORT, '127.0.0.1', () => ok()); });
    try {
        const ctx2 = await browser.newContext();
        const page = await ctx2.newPage();
        await page.goto(`http://127.0.0.1:${PORT}/`);
        await page.addScriptTag({ content: bundle });
        // two tabs of one visitor: each has its own (empty) session store; the browser's HTTP cache is shared
        const twoTabs = (skip: number, oldCacheMode: boolean) => page.evaluate(async ({ skip, oldCacheMode }) => {
            const G = (window as unknown as { GS: typeof import('../../../packages/scenes/src/superspl') }).GS;
            const f = oldCacheMode ? (u: string, i?: RequestInit) => fetch(u, { ...i, cache: 'default' }) : undefined;
            const q = { sort: 'starred' as const, order: -1 as const, features: ['walkable' as const], skip, limit: 1 };
            const first = await new G.SuperSplatCatalog({ store: new G.MemoryStore(), fetch: f }).explore(q);
            const second = await new G.SuperSplatCatalog({ store: new G.MemoryStore(), fetch: f }).explore(q);
            return { first: first.from, second: second.from };
        }, { skip, oldCacheMode });
        const fixed = await twoTabs(0, false);
        const control = await twoTabs(40, true);
        await ctx2.close();
        const n = (skip: number) => [...asked].filter(([k]) => k.includes(`skip=${skip}&`)).reduce((a, [, v]) => a + v, 0);
        record('K2-catalogue-http-cache', n(0) === 2, n(40) === 1, {
            note: 'the proxy stand-in answers public, max-age=600 with data read 300 s earlier; a replayed copy would be kept another 600 s',
            fixed: { ...fixed, proxyRequests: n(0) }, control: { cacheMode: 'default (the client before the fix)', ...control, proxyRequests: n(40) }
        });
    } finally {
        server.close();
    }
} finally {
    await browser.close();
}

// ------------------------------------------------------------------ K3 the built landing
{
    const OUT = join(REPO, 'apps', 'site', 'out');
    const site = (l: string) => JSON.parse(readFileSync(join(REPO, 'packages', 'i18n', 'locales', 'site', `${l}.json`), 'utf8')) as { tune: { text: { count: Record<string, Record<string, string>> } } };
    const fly = (l: string) => JSON.parse(readFileSync(join(REPO, 'packages', 'i18n', 'locales', 'fly', `${l}.json`), 'utf8')) as Record<string, string>;
    const old = JSON.parse(execSync('git show 6b5065c:packages/i18n/locales/site/ru.json', { cwd: REPO, encoding: 'utf8' })) as { tune: { count: Record<string, string> } };
    /** What one built page shows: the tiles (word, number), the key-caps of the catalogue, the first cap of the walls row. */
    const read = (html: string) => {
        const root = html.indexOf('data-tc-root');
        const tiles = [...html.slice(root, root + 8000).matchAll(/<dt[^>]*>([^<]+)<\/dt><dd[^>]*>(\d+)<\/dd>/g)].map((m) => [m[1], Number(m[2])] as const);
        const caps = [...html.slice(root).matchAll(/<kbd[^>]*>([^<]+)<\/kbd>/g)].map((m) => m[1]);
        const w = html.indexOf('scene.walls', root);
        const walls = w > 0 ? (/<kbd[^>]*>([^<]+)<\/kbd>/.exec(html.slice(w, w + 4000))?.[1] ?? null) : null;
        return { tiles, caps, walls };
    };
    /** Everything wrong on one page, empty when it is right. */
    const problems = (l: string, html: string): string[] => {
        const r = read(html);
        const p: string[] = [];
        if (r.tiles.length !== TILES.length) p.push(`${TILES.length} tiles expected, ${r.tiles.length} found`);
        r.tiles.forEach(([word, n], i) => {
            const want = countWord(l, site(l).tune.text.count[TILES[i]?.[0] ?? ''] ?? {}, n);
            if (word !== want) p.push(`tile ${TILES[i]?.[0]}: "${word}" after ${n}, the language says "${want}"`);
        });
        const space = fly(l)['arm.keys.space'];
        if (!r.caps.includes(space)) p.push(`no "${space}" key-cap`);
        if (l !== 'en' && r.caps.includes('Space')) p.push('an English "Space" key-cap');
        if (r.walls !== 'C') p.push(`walls row key-cap ${r.walls}`);
        return p;
    };
    const pages: Record<string, string[]> = {};
    for (const l of ['en', 'es', 'pl', 'ru']) pages[l] = problems(l, readFileSync(join(OUT, l, 'index.html'), 'utf8'));
    // control: the ru page planted with what it showed before (the old tile words, Space in English, no C on the walls row)
    let planted = readFileSync(join(OUT, 'ru', 'index.html'), 'utf8');
    const now = read(planted);
    now.tiles.forEach(([word], i) => { planted = planted.replace(`>${word}</dt><dd`, `>${old.tune.count[TILES[i][0]]}</dt><dd`); });
    planted = planted.split(`>${fly('ru')['arm.keys.space']}</kbd>`).join('>Space</kbd>');
    const w = planted.indexOf('scene.walls', planted.indexOf('data-tc-root'));
    planted = planted.slice(0, w) + planted.slice(w).replace(/<kbd[^>]*>C<\/kbd>/, '');
    const controlProblems = problems('ru', planted);
    const allClean = Object.values(pages).every((p) => p.length === 0);
    record('K3-built-landing', allClean, controlProblems.length >= 3, {
        pages: Object.fromEntries(Object.entries(pages).map(([l, p]) => [l, { ...read(readFileSync(join(OUT, l, 'index.html'), 'utf8')), problems: p }])),
        control: { what: 'ru page with the old tile words (6b5065c), "Space" and no C on the walls row', problems: controlProblems }
    });
}

const pass = results.every((r) => r.pass);
const file = writeEvidence('v03-leadfix', { port: PORT, pass, results });
console.log(`\n${pass ? 'ALL PASS' : 'SOME FAIL'}: ${file}`);
if (!pass) process.exitCode = 1;
