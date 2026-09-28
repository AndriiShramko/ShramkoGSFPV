// Live check of release 4ca397f: latency guard (with ?guard=0 as the negative control), back buffer
// size, HUD text; walls refine 39e63ce9 5 cm -> 1.6 cm, then a browser restart must hit the cache
// (0 bakes, same sha). Persistent profile so "restart" is real. ONE small bake only (39e63ce9).
import { fileURLToPath } from 'node:url';
// repo root (tools/bench/scripts/ -> ../../..): no machine-specific paths
const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '');
import { createRequire } from 'node:module';
// system Chrome, or the bundled Chromium where there is none (tools/bench/README.md)
import { pickBrowser } from '../src/chrome.mjs';
import { writeFileSync, rmSync, mkdirSync } from 'node:fs';
const require = createRequire(ROOT + '/tools/bench/package.json');
const { chromium } = require('playwright');
const SITE = 'https://gsfpv.flyreelstudio.eu/en/fly/';
const DIR = ROOT + '/.cache/lv/live';
rmSync(`${DIR}/profile`, { recursive: true, force: true });
mkdirSync(DIR, { recursive: true });
const out = {};
async function open(qs) {
    const ctx = await chromium.launchPersistentContext(`${DIR}/profile`, { ...pickBrowser({ expected: chromium.executablePath() }).launch, headless: false, viewport: { width: 1600, height: 900 }, args: ['--window-position=40,40'] });
    await ctx.route('**/api/e', (r) => r.fulfill({ status: 204, body: '' }));
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 160)));
    await page.goto(`${SITE}?${qs}`, { waitUntil: 'load' });
    const ok = page.locator('[data-action=warning-ok]');
    try { await ok.first().waitFor({ timeout: 8000 }); await ok.first().click(); } catch { /* already accepted */ }
    await page.waitForFunction(() => window.__gsfpv?.status === 'ready', null, { timeout: 120000 });
    return { ctx, page, errors };
}
const lat = (page) => page.evaluate(() => {
    const r = window.__gsfpv.session.renderer; const s = r.latencyStats(); const c = document.querySelector('canvas');
    return { ...s, canvas: [c.width, c.height], css: [c.clientWidth, c.clientHeight], dpr: devicePixelRatio };
});
// latency: guard on vs off (lat=1 = keyboard path, no Controls screen, no refine)
for (const [name, qs] of [['guardOn', 'scene=39e63ce9&lat=1&refine=off'], ['guardOff', 'scene=39e63ce9&lat=1&refine=off&guard=0']]) {
    const { ctx, page, errors } = await open(qs);
    await page.waitForTimeout(6000);
    const a = await lat(page);
    await page.evaluate(() => { const t = performance.now(); while (performance.now() - t < 60) { /* a 60 ms main-thread task */ } });
    await page.waitForTimeout(4000);
    const b = await lat(page);
    await page.keyboard.press('F3');
    await page.waitForTimeout(800);
    const hud = await page.evaluate(() => [...document.querySelectorAll('.osd, .frame-stats, [class*=stats]')].map((e) => e.innerText).join(' | ').slice(0, 300));
    out[name] = { afterLoad: a, afterTask: b, hud, errors };
    await page.screenshot({ path: `${DIR}/${name}.png` });
    await ctx.close();
}
// walls: first visit refines, a real browser restart must reuse the cache
{
    const { ctx, page, errors } = await open('scene=39e63ce9&simradio=raw&nobuttons=1&refine=auto');
    const t0 = Date.now();
    let w;
    while (Date.now() - t0 < 120000) {
        w = await page.evaluate(() => { const h = window.__gsfpv.walls; return h && { state: h.state, source: h.source, voxelM: h.voxelM, sha: h.sha, bakes: h.bakes, plan: h.plan && { kind: h.plan.kind, voxelM: h.plan.voxelM, estS: h.plan.estimateS } }; });
        if (w && (w.source === 'bake' || w.state === 'queued' || w.state === 'refused' || w.state === 'failed')) break;
        await page.waitForTimeout(1000);
    }
    out.wallsFirst = { ...w, seconds: Math.round((Date.now() - t0) / 1000), errors };
    await page.screenshot({ path: `${DIR}/walls-first.png` });
    await ctx.close();
}
{
    const { ctx, page, errors } = await open('scene=39e63ce9&simradio=raw&nobuttons=1&refine=auto');
    await page.waitForTimeout(8000);
    const w = await page.evaluate(() => { const h = window.__gsfpv.walls; return { state: h.state, source: h.source, voxelM: h.voxelM, sha: h.sha, bakes: h.bakes, cacheKind: h.cacheKind }; });
    out.wallsRestart = { ...w, errors, sameSha: w.sha === out.wallsFirst?.sha };
    await ctx.close();
}
writeFileSync(`${DIR}/result.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
