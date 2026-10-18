// How late is the green stick on the disarmed flight view's arm card (v0.9 lane E review, the owner's item 12)?
// A fake gamepad (the DJI controller's ids, so it is recognised and opens its check screen by itself) whose
// sticks the probe moves at random moments; the lag is the time from the move (the new values are in the
// browser's gamepad state) to the moment the page has drawn it: a MutationObserver on the card's knobs
// (`.rb-mini .rb-kg`, the `transform` attribute) fires after the frame that drew it. Logic-only page
// (?render=off): no GPU, the question is about the HUD's own cadence, not the picture.
//
// The HUD's text gate (`now - last < 100`) used to cover the knobs too: a move waited for the next text
// update, 0 to 100 ms (a mean of ~50 at 60 Hz). Fixed, a move is drawn in the next frame. Run on the fixed
// build with `--expect fast` and on a build with the gate (the negative control) with `--expect gated`.
//   fast:  p95 lag <= 2 frame periods (measured in the page) and the mean under a frame and a half
//   gated: the mean lag over 30 ms (half the text gate) - it proves the probe can see the gate
// Usage: node arm-card-knob-probe.mjs <base with the locale, e.g. http://localhost:5390/en> <outDir> [--expect fast|gated] [--n 60]
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { browserRecord, pickHarnessBrowser } from './visual-browser.mjs';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '');
const require = createRequire(ROOT + '/tools/bench/package.json');
const { chromium } = require('playwright');
const args = process.argv.slice(2);
const flag = (name, dflt) => { const i = args.indexOf(name); if (i < 0) return dflt; const v = args[i + 1]; args.splice(i, 2); return v; };
const expect = flag('--expect', 'fast');
const N = Number(flag('--n', '60'));
const base = args[0] ?? 'http://localhost:5390/en';
const outDir = args[1] ?? ROOT + '/.cache/arm-card-knob-probe';
mkdirSync(outDir, { recursive: true });
const DJI_ID = 'HID Interface (Vendor: 2ca3 Product: 1021)';

/** In the page: a fake DJI pad whose sticks `__pad.move(values)` sets; its timestamp is the move's time (as Chromium stamps a report at arrival). */
function installPad(cfg) {
    const s = { present: sessionStorage.getItem('__padShown') === '1', axes: [0, 0, -1, 0, 0], ts: performance.now() };
    const buttons = Array.from({ length: 24 }, () => ({ pressed: false, value: 0, touched: false }));
    const pad = {
        id: cfg.id, index: 0, connected: true, mapping: '', vibrationActuator: null, buttons,
        get axes() { return s.axes; },
        get timestamp() { return s.ts; }
    };
    window.__pad = {
        show() { s.present = true; sessionStorage.setItem('__padShown', '1'); },
        move(values) { s.axes = values; s.ts = performance.now(); return s.ts; }
    };
    Object.defineProperty(Navigator.prototype, 'getGamepads', { value: () => [s.present ? pad : null, null, null, null], configurable: true });
}

const pick = pickHarnessBrowser({ expected: chromium.executablePath() }, false);
const browser = await chromium.launch({ ...pick.launch, headless: false });
const out = { what: 'the lag of the green stick on the arm card (arm-card-knob-probe.mjs)', base, expect, n: N };
{
    const probe = await browser.newContext();
    out.browser = await browserRecord(pick, await probe.newPage(), { visual: false, version: browser.version() });
    await probe.close();
}
let failed = 0;
const check = (name, pass, detail) => { if (!pass) failed++; console.log(`  ${pass ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(detail)}`); return { name, pass, ...detail }; };

const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 160)));
await page.addInitScript(installPad, { id: DJI_ID });
await page.goto(`${base}/fly/?scene=39e63ce9&nowarn=1&render=off`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__gsfpv?.status === 'ready' && document.querySelector('.screen.radio .choice'), null, { timeout: 120000 });
await page.evaluate(() => window.__pad.show());
await page.waitForFunction(() => window.__gsfpv?.radio?.wizard?.state?.id === 'check', null, { timeout: 15000 }).catch(() => undefined);
await page.locator('[data-action=wizard-done]').click();
await page.waitForFunction(() => window.__gsfpv?.controls?.source === 'gamepad' && !document.querySelector('.screen.radio'), null, { timeout: 15000 }).catch(() => undefined);
await page.waitForTimeout(1500);

const state = await page.evaluate(() => {
    const knobs = [...document.querySelectorAll('.rb-mini .rb-kg')];
    const card = knobs[0]?.closest('.arm-card');
    return { source: window.__gsfpv?.controls?.source ?? null, knobs: knobs.length, cardShown: !!card && !card.classList.contains('hidden') && card.offsetParent !== null };
});
const rows = [];
rows.push(check('flying with the gamepad, the arm card is up with its two knobs', state.source === 'gamepad' && state.knobs === 2 && state.cardShown, state));

const res = await page.evaluate(async (n) => {
    const knobs = [...document.querySelectorAll('.rb-mini .rb-kg')];
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    // the frame period of this page (rAF), over one second
    const period = await new Promise((resolve) => {
        const ts = [];
        const step = (t) => { ts.push(t); if (t - ts[0] < 1000) requestAnimationFrame(step); else resolve((ts[ts.length - 1] - ts[0]) / (ts.length - 1)); };
        requestAnimationFrame(step);
    });
    let tSet = 0;
    let seen = null;
    const mo = new MutationObserver(() => { if (seen === null && tSet > 0) seen = performance.now(); });
    for (const k of knobs) mo.observe(k, { attributes: true, attributeFilter: ['transform'] });
    const lags = [];
    let rnd = 987654321;
    const rand = () => { rnd = (rnd * 1664525 + 1013904223) >>> 0; return rnd / 4294967296; };
    for (let i = 0; i < n; i++) {
        await wait(150 + rand() * 120); // a random phase against the frames and the text gate
        seen = null;
        const sign = i % 2 === 0 ? 0.7 : -0.7;
        tSet = window.__pad.move([sign, -sign * 0.5, -1, sign * 0.8, 0]);
        const t0 = performance.now();
        while (seen === null && performance.now() - t0 < 600) await wait(1);
        lags.push(seen === null ? NaN : seen - tSet);
        tSet = 0;
    }
    mo.disconnect();
    return { period, lags };
}, N);

const ok = res.lags.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
const mean = ok.reduce((a, b) => a + b, 0) / (ok.length || 1);
const p95 = ok[Math.floor(ok.length * 0.95)] ?? NaN;
const max = ok[ok.length - 1] ?? NaN;
const stats = { period: +res.period.toFixed(2), n: ok.length, of: N, mean: +mean.toFixed(1), p95: +p95.toFixed(1), max: +max.toFixed(1) };
rows.push(check('every move was drawn (none lost)', ok.length === N, stats));
if (expect === 'fast') {
    rows.push(check('the knobs follow the stick within frames: p95 <= 2 frame periods, mean <= 1.5', p95 <= 2 * res.period && mean <= 1.5 * res.period, stats));
} else {
    rows.push(check('control (a build with the 100 ms text gate): the mean lag is over 30 ms, so the probe sees the gate', mean > 30, stats));
}
rows.push(check('no page errors', errors.length === 0, { errors }));
out.stats = stats;
out.rows = rows;
await ctx.close();
await browser.close();
out.failed = failed;
writeFileSync(`${outDir}/result-${expect}.json`, JSON.stringify(out, null, 1));
console.log(failed === 0 ? 'ALL PASS' : `${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
