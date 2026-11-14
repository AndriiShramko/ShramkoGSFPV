// Walls W2 page probe: a scan with published walls opens with them and builds nothing in the browser; a scan
// with nothing published still opens and offers its own build (the 404 of /walls/ is not an error).
//   node tools/bench/scripts/walls-published-probe.mjs http://localhost:5800/en <out.json> <published-id>[,...] [<unpublished-id>,...]
// Run against a local release whose dist/walls/<id>/v<N>/ holds the stand-in files (the bake tool's output).
// Headless; takes no GPU lock itself (wrap it). Reads only; presses nothing that sends or saves.
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { pickBrowser } from '../src/chrome.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [base, outFile, pubArg, unpubArg] = process.argv.slice(2);
if (!base || !outFile || !pubArg) { console.error('usage: walls-published-probe.mjs <base with /en> <out.json> <published ids> [<unpublished ids>]'); process.exit(2); }
const cases = [
    ...pubArg.split(',').map((id) => ({ id, expect: 'published' })),
    ...(unpubArg ? unpubArg.split(',').map((id) => ({ id, expect: 'offer' })) : [])
];
const pick = pickBrowser({ expected: chromium.executablePath() });
const browser = await chromium.launch({ ...pick.launch, headless: true });
// in-page code as plain functions of this .mjs (no bundler helpers; the page's CSP forbids strings to eval)
const READ = () => {
    const g = window.__gsfpv || {};
    const w = g.walls;
    const q = (s) => { const e = document.querySelector(s); return e ? (e.textContent || '').trim().slice(0, 160) : null; };
    return {
        status: g.status, error: g.error || null,
        walls: w ? { state: w.state, source: w.source, voxelM: w.voxelM, sha: w.sha, lastBake: w.lastBake || null } : null,
        bake: g.bake || null,
        wallsOn: g.wallsSwitch && g.wallsSwitch.on ? g.wallsSwitch.on() : null,
        action: q('[data-testid=walls-box] button'), inUse: q('[data-testid=walls-in-use]'), summary: q('[data-testid=walls-summary]')
    };
};
const out = [];
let failed = 0;
for (const c of cases) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    const r = { id: c.id, expect: c.expect, errors: [], walls404: 0, wallsFiles: [] };
    page.on('pageerror', (e) => r.errors.push(String(e.message).slice(0, 160)));
    page.on('response', (res) => {
        const u = new URL(res.url());
        if (!u.pathname.startsWith('/walls/')) return;
        if (res.status() === 404) r.walls404++;
        else r.wallsFiles.push(`${u.pathname} ${res.status()}`);
    });
    const t0 = Date.now();
    try {
        await page.goto(`${base}/fly/?scene=${c.id}&nowarn=1&set.input.howToFly=false`, { waitUntil: 'load', timeout: 120000 });
        await page.waitForFunction(() => ['ready', 'error'].includes(window.__gsfpv && window.__gsfpv.status), null, { timeout: 240000 });
        r.readyS = (Date.now() - t0) / 1000;
        // the walls box settles after the session: give it the time a pilot would
        await page.waitForFunction(() => { const w = window.__gsfpv && window.__gsfpv.walls; return w && w.state !== 'checking'; }, null, { timeout: 60000 }).catch(() => 0);
        await page.waitForTimeout(3000);
        r.page = await page.evaluate(READ);
        // review WL-8: the drone stops at the published walls (20 flights into them at 25 m/s, as the ladder run did)
        if (c.expect === 'published' && r.page?.walls?.source === 'published') r.tunnel = await page.evaluate(() => window.__gsfpv.session.tunnelSelfTest(20, 25));
        await page.screenshot({ path: `U:/Temp/gsfpv-train2/shots/walls-w2-${c.id}.png` });
    } catch (e) { r.fail = String(e).slice(0, 200); try { r.page = await page.evaluate(READ); } catch { /* page gone */ } }
    const w = r.page?.walls;
    const noBuild = !r.page?.bake && !w?.lastBake && w?.state !== 'baking';
    r.pass = c.expect === 'published'
        ? r.page?.status === 'ready' && w?.source === 'published' && w?.voxelM > 0 && noBuild && r.wallsFiles.length === 2 && r.errors.length === 0
            && r.tunnel?.passes > 0 && r.tunnel?.penetrations === 0
        : r.page?.status === 'ready' && w?.source === 'none' && w?.state === 'offer' && noBuild && r.errors.length === 0;
    if (!r.pass) failed++;
    out.push(r);
    await ctx.close();
}
await browser.close();
writeFileSync(outFile, JSON.stringify(out, null, 1));
for (const r of out) console.log(JSON.stringify({ id: r.id, pass: r.pass, readyS: r.readyS, state: r.page?.walls?.state, source: r.page?.walls?.source, voxelM: r.page?.walls?.voxelM, bake: !!r.page?.bake, files: r.wallsFiles, walls404: r.walls404, inUse: r.page?.inUse, tunnel: r.tunnel ? { passes: r.tunnel.passes, penetrations: r.tunnel.penetrations } : null, errors: r.errors.length, fail: r.fail }));
process.exit(failed ? 1 : 0);
