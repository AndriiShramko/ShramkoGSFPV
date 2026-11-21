// Lane n-scan S3 (docs/wip/n-scan.md): a scan that cannot open says why in one plain line, never an endless loader.
// Opens <base>/fly/?scene=a39abad1&render=off (logic only: no GPU lock) in a fresh headless page per case, with the
// scan's CDN answers stubbed by the page's own request routing (nothing is sent anywhere but reads):
//   gone     every file of the scan answers 404           -> hook errorCode 'gone',           line scene.open.gone
//   huge     meta.json says 400 M splats (recorded meta)   -> hook errorCode 'too-large',      line scene.open.too-large
//   newer    meta.json says SOG version 4                  -> hook errorCode 'unknown-format', line scene.open.unknown-format
//   control  nothing stubbed: the real scan                -> hook status 'ready' (the check refuses no real scan)
// A case passes when the hook reaches the expected state within MAXS seconds and, for a failure, the scene list's
// error line (.scene-error) is exactly the English line of packages/i18n/locales/fly/en.json.
//   node tools/bench/scripts/n-scan-errors.mjs <base with /en> <out.json>
// env: MAXS (60). Prints one JSON verdict and exits 1 when any case fails.
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pickBrowser } from '../src/chrome.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [base, outFile] = process.argv.slice(2);
if (!base || !outFile) {
    console.error('usage: n-scan-errors.mjs <base with /en> <out.json>');
    process.exit(2);
}
const MAXS = Number(process.env.MAXS || 60);
const ID = 'a39abad1';
const repo = new URL('../../../', import.meta.url);
const EN = JSON.parse(readFileSync(new URL('packages/i18n/locales/fly/en.json', repo), 'utf8'));
const KINDS = JSON.parse(readFileSync(new URL('packages/scenes/test/fixtures/superspl-kinds.json', repo), 'utf8')).kinds;
const META = KINDS.find((k) => k.id === ID).meta;

/** the scan's own files on the CDN (not this site, not the walls published here) */
const scanFile = (url) => { const u = new URL(url); return !/^(localhost|127\.)/.test(u.hostname) && u.pathname.includes(`/${ID}/`); };
const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
const CASES = [
    { name: 'gone', code: 'gone', stub: () => ({ status: 404, contentType: 'text/plain', body: 'Not Found' }) },
    { name: 'huge', code: 'too-large', stub: (url) => (url.endsWith('/meta.json') ? json({ ...META, count: 400_000_000 }) : null) },
    { name: 'newer', code: 'unknown-format', stub: (url) => (url.endsWith('/meta.json') ? json({ ...META, version: 4 }) : null) },
    { name: 'control', code: null, stub: null }
];

const STATE = `(() => { const h = window.__gsfpv || {}; const e = document.querySelector('.scene-error');
    return { status: h.status || null, errorCode: h.errorCode || null, error: h.error ? String(h.error).slice(0, 200) : null,
        line: e ? e.textContent : null }; })()`;

const pick = pickBrowser();
const browser = await chromium.launch({ ...pick.launch, headless: true });
const res = { base, at: new Date().toISOString(), id: ID, cases: {}, pass: false };
try {
    for (const c of CASES) {
        const r = { pass: false, why: null, expect: c.code ? { errorCode: c.code, line: EN[`scene.open.${c.code}`] } : { status: 'ready' }, stubbed: 0 };
        res.cases[c.name] = r;
        const ctx = await browser.newContext({ viewport: { width: 1536, height: 730 } });
        const page = await ctx.newPage();
        if (c.stub) {
            await page.route((url) => scanFile(url.toString()), async (route) => {
                const answer = c.stub(route.request().url());
                if (!answer) return route.continue();
                r.stubbed++;
                return route.fulfill(answer);
            });
        }
        const t0 = Date.now();
        try {
            await page.goto(`${base}/fly/?scene=${ID}&render=off&nowarn=1&set.input.howToFly=false`, { waitUntil: 'domcontentloaded', timeout: 60000 });
            let last = null;
            while ((Date.now() - t0) / 1000 < MAXS) {
                await page.waitForTimeout(500);
                last = await page.evaluate(STATE).catch(() => null);
                if (last && (last.status === 'error' || last.status === 'ready') && (last.status === 'ready' || last.line)) break;
            }
            r.last = last;
            r.seconds = Math.round((Date.now() - t0) / 1000);
            if (!last || (last.status !== 'error' && last.status !== 'ready')) r.why = `no answer in ${MAXS} s (status ${last && last.status}): an endless loader`;
            else if (!c.code && last.status !== 'ready') r.why = `the real scan did not open: ${last.errorCode} ${last.error}`;
            else if (c.code && last.errorCode !== c.code) r.why = `errorCode ${last.errorCode}, expected ${c.code}`;
            else if (c.code && last.line !== r.expect.line) r.why = `the line is "${last.line}", expected "${r.expect.line}"`;
            else if (c.stub && !r.stubbed) r.why = 'the stub was never asked: the case proves nothing';
        } catch (e) {
            r.why = `probe: ${String(e.message || e).slice(0, 200)}`;
        }
        r.pass = !r.why;
        await ctx.close();
    }
} finally {
    await browser.close();
}
res.pass = Object.values(res.cases).every((r) => r.pass);
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify(res, null, 2));
console.log(JSON.stringify({ pass: res.pass, cases: Object.fromEntries(Object.entries(res.cases).map(([k, v]) => [k, v.pass ? 'PASS' : `FAIL: ${v.why}`])) }));
process.exit(res.pass ? 0 : 1);
