// Lane vox4 review: a scene switch made from "voxels only" (the step the acceptance probe vox4-probe.mjs does not take:
// it opens every scene with a fresh page). Wroclaw 70b50d42 with the walls panel picked by the MOUSE at 1536x730,
// dsf 1.25 ("Voxels only", or "Over the scan" as the control), then the scene host's switch to Lublin 2f1ddf5f
// (window.__gsfpv.scenes.load, the call the scene picker makes). PASS when the switch from voxels only reveals the next
// scan as the control does (reason not 'stall') and takes at most 10 s longer, and voxels only holds after it.
// Usage: node vox4-switch.mjs <base with /en> <out.json>. Draws (the reveal needs drawn splats): run it under the GPU lock.
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { pickBrowser } from '../src/chrome.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [base, out] = process.argv.slice(2);
if (!base || !out) { console.error('usage: vox4-switch.mjs <base with /en> <out.json>'); process.exit(2); }
const WROCLAW = '70b50d42', LUBLIN = '2f1ddf5f';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = pickBrowser({ expected: chromium.executablePath() });
const browser = await chromium.launch({ ...pick.launch, headless: true });

async function until(page, fn, ok, ms) {
    const s = Date.now();
    let v;
    while (Date.now() - s < ms) { v = await page.evaluate(fn); if (ok(v)) return { ok: true, v, ms: Date.now() - s }; await sleep(250); }
    return { ok: false, v, ms: Date.now() - s };
}
async function clickEl(page, sel) {
    const b = await page.locator(sel).first().boundingBox();
    if (!b) throw new Error(`no box for ${sel}`);
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
}

/** one run: Wroclaw, the mode by the mouse, then the switch to Lublin; what the switch took and showed */
async function run(mode) {
    const ctx = await browser.newContext({ viewport: { width: 1536, height: 730 }, deviceScaleFactor: 1.25 });
    const page = await ctx.newPage();
    try {
        await page.goto(`${base}/fly/?scene=${WROCLAW}&nowarn=1`);
        await page.waitForFunction(() => ['ready', 'error'].includes(window.__gsfpv?.status), null, { timeout: 240000 });
        try {
            await page.waitForSelector('.screen.radio [data-action="radio-keyboard"]', { timeout: 15000 });
            await clickEl(page, '.screen.radio [data-action="radio-keyboard"]');
        } catch { /* no controls screen */ }
        const walls = await until(page, () => window.__gsfpv?.voxels?.stats?.()?.voxelCm ?? 0, (v) => v > 0, 400000);
        await sleep(500);
        const open = await page.evaluate(() => !!document.querySelector('[data-testid=walls-more]')?.open);
        if (!open) { await clickEl(page, '[data-testid=walls-summary]'); await sleep(500); }
        await clickEl(page, `[data-action=voxels-mode-${mode}]`);
        await sleep(800);
        const before = await page.evaluate(() => ({ mode: window.__gsfpv.voxels.stats().mode, splatVisible: window.__gsfpv.session.renderer.splatVisible }));
        await page.evaluate((id) => { void window.__gsfpv.scenes.load(id, 'pick'); }, LUBLIN);
        const sw = await until(page, () => window.__gsfpv.sceneSwitch?.state ?? null, (v) => v === 'done' || v === 'failed', 180000);
        const after = await page.evaluate(() => ({
            sceneSwitch: window.__gsfpv.sceneSwitch,
            reveal: window.__gsfpv.session?.timings?.reveal ?? null,
            visibleMs: Math.round(window.__gsfpv.session?.timings?.visibleMs ?? -1),
            mode: window.__gsfpv.voxels.stats().mode,
            splatVisible: window.__gsfpv.session.renderer.splatVisible
        }));
        return { mode, wallsMs: walls.ms, before, switchOk: sw.ok, switchWaitMs: sw.ms, ...after };
    } finally { await ctx.close(); }
}

const r = { base, runs: {} };
try {
    r.runs.only = await run('only');
    r.runs.overlay = await run('overlay');
    const o = r.runs.only, c = r.runs.overlay;
    const pass = o.before.mode === 'only' && o.sceneSwitch?.state === 'done' && o.reveal !== 'stall' && o.switchWaitMs <= c.switchWaitMs + 10000 && o.mode === 'only' && o.splatVisible === false;
    r.steps = { '7-switch-from-only': { pass, onlyMs: o.switchWaitMs, overlayMs: c.switchWaitMs, onlyReveal: o.reveal, overlayReveal: c.reveal } };
    console.log(`7-switch-from-only ${pass ? 'PASS' : 'FAIL'} ${JSON.stringify(r.steps['7-switch-from-only'])}`);
} catch (e) { r.error = String(e?.stack ?? e).slice(0, 600); console.log('ERROR ' + r.error); }
await browser.close();
writeFileSync(out, JSON.stringify(r, null, 2));
process.exit(r.steps?.['7-switch-from-only']?.pass ? 0 : 1);
