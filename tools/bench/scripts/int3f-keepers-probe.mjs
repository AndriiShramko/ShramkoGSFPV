// Integration F of train 3, seam e: two keepers in the view of voxels alone. The splat keeper (packages/render-pc/src/
// governor.ts, read through window.__gsfpv.lod(): governorStep, governorBudgetM) and the voxel view's keeper of its near
// detail (apps/fly/src/voxel-keeper.ts, read through window.__gsfpv.voxels.stats().share). On a local release: the
// keyboard scheme, Shift+G (a course made in this tab, never saved), voxels alone (voxels.setMode('only')), then SECS
// (60) seconds of samples every 250 ms with the camera as the page leaves it (nothing pressed). Per keeper: the values
// seen, the changes, and the alternations (a change whose direction is the reverse of the change before it).
// Also the rAF frame intervals of each second. Pass: neither keeper alternates, and the splat keeper takes no step down.
// Usage: node int3f-keepers-probe.mjs <base with /en> <scene> <out.json>. Takes no GPU lock itself (wrap it).
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { pickBrowser } from '../src/chrome.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [base, id, out] = process.argv.slice(2);
if (!base || !id || !out) { console.error('usage: int3f-keepers-probe.mjs <base with /en> <scene> <out.json>'); process.exit(2); }
const SECS = Number(process.env.SECS || 60);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = pickBrowser({ expected: chromium.executablePath() });
const browser = await chromium.launch({ ...pick.launch, headless: true });
const r = { base, id, secs: SECS, browser: pick.label ?? null, samples: [] };
async function until(page, fn, ok, ms) {
    const s = Date.now();
    let v;
    while (Date.now() - s < ms) { v = await page.evaluate(fn).catch(() => null); if (ok(v)) return v; await sleep(500); }
    throw new Error(`timeout: ${JSON.stringify(v)}`);
}
const changes = (vals) => {
    let n = 0, alt = 0, down = 0, prevDir = 0;
    for (let i = 1; i < vals.length; i++) {
        const d = vals[i] - vals[i - 1];
        if (d === 0) continue;
        n++;
        const dir = Math.sign(d);
        if (prevDir !== 0 && dir !== prevDir) alt++;
        prevDir = dir;
        if (dir < 0) down++;
    }
    return { changes: n, alternations: alt, down, first: vals[0], last: vals[vals.length - 1], distinct: [...new Set(vals)] };
};
try {
    const page = await (await browser.newContext({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 })).newPage();
    await page.goto(`${base}/fly/?scene=${id}&nowarn=1`);
    await page.waitForFunction(() => ['ready', 'error'].includes(window.__gsfpv?.status), null, { timeout: 240000 });
    try {
        await page.waitForSelector('.screen.radio [data-action="radio-keyboard"]', { timeout: 15000 });
        await page.focus('.screen.radio [data-action="radio-keyboard"]');
        await page.keyboard.press('Enter');
    } catch { /* no Controls screen */ }
    await until(page, () => window.__gsfpv?.voxels?.stats?.()?.voxelCm ?? 0, (v) => v > 0, 500000);
    await page.keyboard.press('Shift+KeyG');
    await until(page, () => { const k = window.__gsfpv?.course; return k ? (k.gates ?? 0) : 0; }, (v) => v > 0, 480000);
    await page.evaluate(() => window.__gsfpv.voxels.setMode('only'));
    await until(page, () => window.__gsfpv.voxels.settled(), (v) => !!v, 120000);
    await page.evaluate(() => {
        window.__fr = []; let last = performance.now();
        const f = (t) => { window.__fr.push(t - last); last = t; requestAnimationFrame(f); };
        requestAnimationFrame(f);
    });
    const t0 = Date.now();
    while (Date.now() - t0 < SECS * 1000) {
        const s = await page.evaluate(() => {
            const l = window.__gsfpv.lod?.() ?? {};
            const v = window.__gsfpv.voxels.stats();
            const fr = window.__fr.splice(0);
            fr.sort((a, b) => a - b);
            return { step: l.governorStep, budgetM: l.governorBudgetM, splats: l.splats ?? null, share: v.share, chunks: v.chunks, frames: fr.length, medMs: fr.length ? +fr[fr.length >> 1].toFixed(2) : null, maxMs: fr.length ? +fr[fr.length - 1].toFixed(1) : null };
        });
        s.t = +((Date.now() - t0) / 1000).toFixed(2);
        r.samples.push(s);
        await sleep(250);
    }
    r.splatKeeper = changes(r.samples.map((s) => s.step));
    r.voxelKeeper = changes(r.samples.map((s) => s.share));
    const med = r.samples.map((s) => s.medMs).filter((x) => x != null).sort((a, b) => a - b);
    r.frameMedianMs = med.length ? med[med.length >> 1] : null;
    r.pass = r.splatKeeper.alternations === 0 && r.voxelKeeper.alternations === 0 && r.splatKeeper.down === 0;
} catch (e) {
    r.error = String(e.message || e);
    r.pass = false;
}
await browser.close();
writeFileSync(out, JSON.stringify(r, null, 1));
console.log(JSON.stringify({ pass: r.pass, splatKeeper: r.splatKeeper, voxelKeeper: r.voxelKeeper, frameMedianMs: r.frameMedianMs, error: r.error }));
process.exit(r.pass ? 0 : 1);
