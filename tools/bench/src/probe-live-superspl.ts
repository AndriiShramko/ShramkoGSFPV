// Probe the live picker: is the SuperSplat tab there, does it list real scenes, does a card open?
//   SITE=https://gsfpv.flyreelstudio.eu npx tsx src/probe-live-superspl.ts
import { launchChrome } from './browser';

const SITE = (process.env.SITE ?? 'https://gsfpv.flyreelstudio.eu').replace(/\/$/, '');
const { browser } = await launchChrome({ headless: false });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const p = await ctx.newPage();
const errs: string[] = [];
p.on('pageerror', (e) => errs.push(String(e.message).slice(0, 200)));
await p.goto(`${SITE}/en/fly/?nowarn=1`);
await p.waitForTimeout(4000);
const state = () => p.evaluate(`(() => ({ status: window.__gsfpv && window.__gsfpv.status, picker: !!document.querySelector('.screen.scenes'), warning: !!document.querySelector('[data-action="warning-ok"]'), tabs: [...document.querySelectorAll('[role=tab]')].map((b) => b.dataset.tab), cards: document.querySelectorAll('.ss-grid .ss-card, .ss-grid [data-scene]').length }))()`);
const out: Record<string, unknown> = { first: await state() };
if (await p.locator('[data-action="warning-ok"]').count()) { await p.click('[data-action="warning-ok"]'); await p.waitForTimeout(1000); }
out.afterWarning = await state();
if (await p.locator('[data-tab="superspl"]').count()) {
    await p.click('[data-tab="superspl"]');
    await p.waitForTimeout(5000);
    out.tab = await state();
    out.status = await p.evaluate(`document.querySelector('.ss-status')?.textContent ?? null`);
}
await p.screenshot({ path: 'C:/dev/gsfpv-v03/.cache/live-superspl.png' });
out.errors = errs;
console.log(JSON.stringify(out));
await browser.close();
