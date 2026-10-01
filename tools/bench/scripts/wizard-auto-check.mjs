// Wizard with auto pacing on a release build: the fake radio moves its sticks like a person and
// never presses a button (&nobuttons=1) -> must reach the check screen by itself; screenshots of
// the screens it passes; then Fly (the one click). Usage: node auto-check.mjs <base> <shotsDir>
import { fileURLToPath } from 'node:url';
// repo root (tools/bench/scripts/ -> ../../..): no machine-specific paths
const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '');
import { createRequire } from 'node:module';
// system Chrome, or the bundled Chromium where there is none (tools/bench/README.md); a logic check,
// so it runs on either, and records which browser and GL it ran on (visual-browser.mjs)
import { browserRecord, pickHarnessBrowser } from './visual-browser.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const require = createRequire(ROOT + '/tools/bench/package.json');
const { chromium } = require('playwright');
const base = process.argv[2] ?? 'http://localhost:5346';
const shots = process.argv[3] ?? ROOT + '/.cache/wz/auto-shots';
mkdirSync(shots, { recursive: true });
const pick = pickHarnessBrowser({ expected: chromium.executablePath() }, false);
const browser = await chromium.launch({ ...pick.launch, headless: false });
const out = {};
{
    const probe = await browser.newContext();
    out.browser = await browserRecord(pick, await probe.newPage(), { visual: false, version: browser.version() });
    await probe.close();
}
for (const [name, qs, size] of [['nobuttons', '&nobuttons=1&react=900', { width: 1600, height: 900 }], ['human', '&human=5', { width: 375, height: 812 }]]) {
    const ctx = await browser.newContext({ viewport: size });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 160)));
    await page.goto(`${base}/fly/?scene=39e63ce9&simradio=raw${qs}`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__gsfpv?.status === 'ready', null, { timeout: 120000 });
    const t0 = Date.now();
    const path = [];
    let last = '';
    while (Date.now() - t0 < 180000) {
        const s = await page.evaluate(() => { const w = window.__gsfpv?.radio?.wizard?.state; return w ? { id: w.id, stage: w.stage, step: w.step, buttons: [...document.querySelectorAll('.screen.radio button')].filter((b) => b.offsetParent).map((b) => b.dataset.action) } : null; });
        if (!s) break;
        const k = `${s.id}/${s.stage}`;
        if (k !== last) {
            path.push({ t: Date.now() - t0, k, buttons: s.buttons.join(',') });
            if (path.length <= 30) await page.screenshot({ path: `${shots}/${name}-${String(path.length).padStart(2, '0')}-${s.id}-${s.stage}.png` });
            last = k;
        }
        if (s.step === 6) break;
        await page.waitForTimeout(200);
    }
    const end = await page.evaluate(() => { const w = window.__gsfpv?.radio?.wizard?.state; return w ? { id: w.id, profile: !!w.profile, startOrNextVisible: [...document.querySelectorAll('[data-action=wizard-start],[data-action=wizard-next]')].some((b) => b.offsetParent) } : null; });
    out[name] = { seconds: Math.round((Date.now() - t0) / 1000), end, screens: path.length, path, errors };
    await ctx.close();
}
await browser.close();
writeFileSync(`${shots}/result.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify({ browser: out.browser, ...Object.fromEntries(Object.entries(out).filter(([k]) => k !== 'browser').map(([k, v]) => [k, { seconds: v.seconds, end: v.end, screens: v.screens, errors: v.errors, anyStartNext: v.path.some((p) => /wizard-(start|next)/.test(p.buttons)) }])) }, null, 1));
