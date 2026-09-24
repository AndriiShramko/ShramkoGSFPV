// Local smoke of the phase-B simulator UI: bot crash with Rapier debris, and the SimRadio-raw wizard.
import { launch, waitReady } from './browser';

const BASE = process.env.FLY_BASE ?? 'http://localhost:5190/fly/';
const { browser, page, console: log } = await launch();

// 1) crash with debris
await page.goto(`${BASE}?scene=39e63ce9&simradio=scenario&nowarn=1`);
await waitReady(page);
const t0 = Date.now();
let crash: unknown = null;
while (Date.now() - t0 < 60000) {
    crash = await page.evaluate(() => (window as any).__gsfpv.lastCrash ?? null);
    if (crash && !(crash as any).pending) break;
    await page.waitForTimeout(300);
}
await page.waitForTimeout(1800);
await page.screenshot({ path: '.cache/ui-crash.png' });
const overlay = await page.evaluate(() => { const o = document.querySelector('.crash-overlay'); return o ? { text: o.textContent, engine: o.querySelector('[data-engine]')?.getAttribute('data-engine'), debris: o.querySelector('[data-debris]')?.getAttribute('data-debris') } : null; });
console.log('crash', JSON.stringify(crash), 'overlay', JSON.stringify(overlay));
// respawn
await page.click('[data-action="respawn"]');
await page.waitForTimeout(500);
const after = await page.evaluate(() => { const h = (window as any).__gsfpv; const s = h.session; return { crashed: s.sim.crashed, p: [s.sim.s[0], s.sim.s[1], s.sim.s[2]], free: s.spawnIsFree(), overlay: !!document.querySelector('.crash-overlay') }; });
console.log('after respawn', JSON.stringify(after));

// 2) wizard on the simulated EdgeTX radio
await page.goto(`${BASE}?scene=39e63ce9&simradio=raw&order=TAER&inv=E&nowarn=1`);
await waitReady(page);
const t1 = Date.now();
let st: any = null;
while (Date.now() - t1 < 40000) {
    st = await page.evaluate(() => { const r = (window as any).__gsfpv.radio; return r?.wizard ? { step: r.wizard.state.step, msg: r.wizard.state.message, err: r.wizard.state.error, prof: r.wizard.state.profile } : null; });
    if (st?.step === 6) break;
    await page.waitForTimeout(500);
}
await page.screenshot({ path: '.cache/ui-wizard.png' });
console.log('wizard', JSON.stringify(st));
console.log(log.filter((l) => l.startsWith('error') || l.startsWith('pageerror')).slice(0, 10).join('\n'));
await browser.close();
