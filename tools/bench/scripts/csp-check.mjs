// Load the landing and the simulator under the enforced CSP (serve-csp.mjs) and count violations.
// Negative control: an inline script with no hash, injected into the landing, must be reported.
import { fileURLToPath } from 'node:url';
// repo root (tools/bench/scripts/ -> ../../..): no machine-specific paths
const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '');
import { createRequire } from 'node:module';
// system Chrome, or the bundled Chromium where there is none (tools/bench/README.md); a logic check,
// so it runs on either, and records which browser and GL it ran on (visual-browser.mjs)
import { browserRecord, pickHarnessBrowser } from './visual-browser.mjs';
const require = createRequire(ROOT + '/tools/bench/package.json');
const { chromium } = require('playwright');

const base = process.argv[2] ?? 'http://localhost:5320';
const out = { base, pages: [] };
const pick = pickHarnessBrowser({ expected: chromium.executablePath() }, false);
const browser = await chromium.launch({ ...pick.launch, headless: false, args: ['--enable-unsafe-webgpu'] });
{
    const probe = await browser.newContext();
    out.browser = await browserRecord(pick, await probe.newPage(), { visual: false, version: browser.version() });
    await probe.close();
}
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
await ctx.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push({ dir: e.effectiveDirective, blocked: String(e.blockedURI).slice(0, 120), sample: String(e.sample).slice(0, 60), disposition: e.disposition }));
});

async function visit(path, wait) {
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)));
    const resp = await page.goto(base + path, { waitUntil: 'load' });
    const mode = resp.headers()['x-csp-mode'] ?? 'none';
    let extra = {};
    if (wait) extra = await wait(page);
    const csp = await page.evaluate(() => window.__csp);
    out.pages.push({ path, mode, violations: csp, pageErrors: errors, ...extra });
    return page;
}

await visit('/en/', async (page) => {
    await page.waitForTimeout(1500);
    // negative control: this inline script has no hash in the policy, so the browser must block it
    await page.evaluate(() => { const s = document.createElement('script'); s.textContent = 'window.__ran = 1'; document.body.append(s); });
    await page.waitForTimeout(300);
    return { controlBlocked: await page.evaluate(() => window.__ran !== 1) };
});
await visit('/ru/', async (page) => { await page.waitForTimeout(1500); return {}; });
await visit('/en/fly/?scene=39e63ce9&simradio=raw', async (page) => {
    const t0 = Date.now();
    await page.waitForFunction(() => window.__gsfpv && ['ready', 'error'].includes(window.__gsfpv.status), null, { timeout: 90000 });
    const st = await page.evaluate(() => ({ status: window.__gsfpv.status, renderer: window.__gsfpv.info?.currentRenderer, collision: window.__gsfpv.info?.hasCollision, wizard: !!document.querySelector('.screen.radio') }));
    await page.screenshot({ path: ROOT + '/.cache/v02/csp/fly-csp.png' });
    return { ...st, readyMs: Date.now() - t0 };
});
await visit('/en/fly/?scene=9d09ab82', async (page) => {
    const ok = page.locator('[data-action=warning-ok]');
    try { await ok.first().waitFor({ timeout: 15000 }); await ok.first().click(); } catch { /* already accepted in this context */ }
    const t0 = Date.now();
    const samples = [];
    for (let i = 0; i < 60; i++) {
        const s = await page.evaluate(() => ({ status: window.__gsfpv?.status, loading: window.__gsfpv?.loading ?? null, errorCode: window.__gsfpv?.errorCode ?? null, radio: !!document.querySelector('.screen.radio'), text: (document.querySelector('.loading')?.innerText ?? '').slice(0, 160) }));
        samples.push({ t: Date.now() - t0, ...s });
        if (s.status === 'ready' || s.status === 'error') break;
        await page.waitForTimeout(3000);
    }
    await page.screenshot({ path: ROOT + '/.cache/v02/csp/fly-9d09.png' });
    return { samples: samples.filter((_, i) => i % 5 === 0 || i === samples.length - 1) };
});
await browser.close();
const flyViol = out.pages.filter((p) => p.path !== '/en/').flatMap((p) => p.violations);
out.ok = out.pages[0].controlBlocked && out.pages[0].violations.length > 0 && flyViol.length === 0 && out.pages.every((p) => p.pageErrors.length === 0 && p.mode === 'enforced');
console.log(JSON.stringify(out, null, 1));
