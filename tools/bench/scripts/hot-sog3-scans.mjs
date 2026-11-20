// Lane hot-sog3 (docs/wip/hot-sog3.md): do SuperSplat scans in SOG version 3 open and DRAW in the simulator?
// For every scene id it opens <base>/fly/?scene=<id> in a fresh headless page and passes the id only when
//   - the page's hook says status 'ready' (never 'error'),
//   - the engine draws splats (app.stats.frame.gsplats > 0 for 3 samples in a row),
//   - the picture is not empty: with the page's notes (#ui) hidden, the share of pixels that differ from the camera's
//     clear colour (any channel more than 24 of 255 away) is at least MINLIT (0.05),
//   - no page error, no console error and no CSP violation (securitypolicyviolation, report-only included).
// Console lines "Failed to load resource: ... 403/404" for the scan CDN are the scene resolver's probes of the files a
// scan may have (lod-meta.json, meta.json, ...): they are listed under `probes403`, not counted as errors.
// A streamed scan that says "ready" over a black scene (engine 2.23.2 and SOG v3) fails on the splat count and the picture.
//   node tools/bench/scripts/hot-sog3-scans.mjs <base with /en> <out.json> [ids, comma separated]
// env: MAXS (300: seconds per id before it fails as not loaded), SHOTS (U:/Temp/gsfpv-train4/shots), PREFIX (hot-sog3),
// MINLIT (0.05). Headless (tools/bench/src/chrome.mjs pickBrowser); takes no GPU lock itself: wrap it.
// Prints one JSON verdict and exits 1 when any id fails.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pickBrowser } from '../src/chrome.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [base, outFile, idsArg] = process.argv.slice(2);
if (!base || !outFile) {
    console.error('usage: hot-sog3-scans.mjs <base with /en> <out.json> [ids]');
    process.exit(2);
}
const IDS = (idsArg || 'f924b0f5,593f8c06,a39abad1,28ad27ed,98f74d54,143e76b0,70b50d42').split(',').filter(Boolean);
const MAXS = Number(process.env.MAXS || 300);
const SHOTS = process.env.SHOTS || 'U:/Temp/gsfpv-train4/shots';
const PREFIX = process.env.PREFIX || 'hot-sog3';
const MINLIT = Number(process.env.MINLIT || 0.05);
mkdirSync(SHOTS, { recursive: true });

const STATE = `(() => {
    const h = window.__gsfpv || {}; const s = h.session; const r = s && s.renderer; const a = r && r.app;
    const l = h.loading || null;
    return { status: h.status || null, error: h.error || null, errorCode: h.errorCode || null,
        stage: l ? l.stage : null, loaded: l ? l.loaded : null, total: l ? l.total : null,
        drawn: a ? a.stats.frame.gsplats : null };
})()`;
const CLEAR = `(() => { const c = window.__gsfpv.session.renderer.camera.camera.clearColor; return [c.r, c.g, c.b].map((v) => Math.round(v * 255)); })()`;
// decoded in a separate blank page, so the app's CSP never sees a data: image
const LIT = (b64, clear) => `(async () => {
    const img = new Image(); img.src = 'data:image/png;base64,${b64}'; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0); const d = g.getImageData(0, 0, c.width, c.height).data;
    const k = ${JSON.stringify(clear)}; let n = 0, lit = 0;
    for (let i = 0; i < d.length; i += 8) { n++; if (Math.abs(d[i] - k[0]) > 24 || Math.abs(d[i + 1] - k[1]) > 24 || Math.abs(d[i + 2] - k[2]) > 24) lit++; }
    return { w: c.width, h: c.height, lit: lit / n };
})()`;

const pick = pickBrowser({ expected: chromium.executablePath() });
const browser = await chromium.launch({ ...pick.launch, headless: true });
const res = { base, browser: { kind: pick.kind, version: browser.version() }, maxS: MAXS, minLit: MINLIT, ids: {}, pass: true };
const blank = await (await browser.newContext()).newPage();
try {
    for (const id of IDS) {
        const r = { pass: false, why: null, errors: [], console: [], csp: [], probes403: 0, samples: [] };
        res.ids[id] = r;
        const ctx = await browser.newContext({ viewport: { width: 1536, height: 730 } });
        const page = await ctx.newPage();
        await page.addInitScript(() => {
            window.__csp = [];
            document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.disposition} ${e.effectiveDirective} ${String(e.blockedURI).slice(0, 100)}`));
        });
        page.on('pageerror', (e) => r.errors.push(String(e.message).slice(0, 240)));
        page.on('console', (m) => {
            if (m.type() !== 'error') return;
            const t = m.text();
            if (/^Failed to load resource: the server responded with a status of 40[34]/.test(t)) { r.probes403++; return; }
            r.console.push(t.slice(0, 240));
        });
        // nowarn: past the first-visit warning screen (without it the scan never starts loading); howToFly off: no lesson overlay
        const url = `${base}/fly/?scene=${id}&nowarn=1&set.input.howToFly=false`;
        const t0 = Date.now();
        try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
            let drawnRun = 0, last = null;
            while ((Date.now() - t0) / 1000 < MAXS) {
                await page.waitForTimeout(1000);
                last = await page.evaluate(STATE).catch((e) => ({ evalError: String(e).slice(0, 120) }));
                const s = Math.round((Date.now() - t0) / 1000);
                if (s % 10 === 0) r.samples.push({ s, ...last });
                if (last.status === 'error') { r.why = `page error state: ${last.errorCode} ${last.error}`; break; }
                drawnRun = last.status === 'ready' && last.drawn > 0 ? drawnRun + 1 : 0;
                if (drawnRun >= 3) break;
            }
            r.last = last;
            r.seconds = Math.round((Date.now() - t0) / 1000);
            if (!r.why && drawnRun < 3) r.why = `not drawn in ${MAXS} s: status ${last && last.status}, splats drawn ${last && last.drawn}`;
            if (!r.why) {
                await page.waitForTimeout(3000);
                const clear = await page.evaluate(CLEAR);
                await page.evaluate(`(() => { const u = document.getElementById('ui'); if (u) u.style.visibility = 'hidden'; })()`);
                await page.waitForTimeout(300);
                const png = await page.screenshot({ type: 'png' });
                const shot = join(SHOTS, `${PREFIX}-${id}.png`);
                writeFileSync(shot, png);
                const lit = await blank.evaluate(LIT(png.toString('base64'), clear));
                r.picture = { shot, clear, ...lit };
                r.drawn = (await page.evaluate(STATE)).drawn;
                if (lit.lit < MINLIT) r.why = `picture empty: ${(lit.lit * 100).toFixed(1)} % of pixels differ from the clear colour`;
            }
        } catch (e) {
            r.why = `probe: ${String(e.message || e).slice(0, 200)}`;
        }
        r.csp = await page.evaluate('window.__csp || []').catch(() => []);
        if (!r.why && r.errors.length) r.why = `page error: ${r.errors[0]}`;
        if (!r.why && r.console.length) r.why = `console error: ${r.console[0]}`;
        if (!r.why && r.csp.length) r.why = `CSP: ${r.csp[0]}`;
        r.pass = !r.why;
        if (!r.pass) res.pass = false;
        console.error(`${id}: ${r.pass ? 'PASS' : 'FAIL'} ${r.seconds ?? '-'} s${r.why ? ' ' + r.why : ''}`);
        await ctx.close();
    }
} finally {
    await browser.close();
}
res.summary = Object.fromEntries(Object.entries(res.ids).map(([k, v]) => [k, v.pass ? 'PASS' : `FAIL ${v.why}`]));
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify(res, null, 2));
console.log(JSON.stringify({ pass: res.pass, base, summary: res.summary }));
process.exit(res.pass ? 0 : 1);
