// Probe: does M (mode.cycle) still change the flight mode after an in-page scene switch (N)?
//   LOCAL_FLY=1 SITE=http://127.0.0.1:5301 npx tsx src/probe-mode-after-switch.ts
import { launchChrome, waitReady } from './browser';

const SITE = (process.env.SITE ?? 'http://127.0.0.1:5301').replace(/\/$/, '');
const fly = (qs: string) => (process.env.LOCAL_FLY ? `${SITE}/fly/?${qs}` : `${SITE}/en/fly/?${qs}`);
const { browser } = await launchChrome({ headless: false });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.addInitScript({ content: "try { localStorage.setItem('gsfpv.warned', '1'); } catch (e) {}" });
const p = await ctx.newPage();
const errs: string[] = [];
p.on('pageerror', (e) => errs.push(String(e.message).slice(0, 200)));
await p.goto(fly('scene=39e63ce9&nowarn=1&render=off'));
await waitReady(p, 120000);
await p.locator('[data-action="radio-close"]').click({ timeout: 15000 });
await p.waitForTimeout(1500);
const read = () => p.evaluate(`(() => { const h = window.__gsfpv; const s = h.session; return { scene: new URL(location.href).searchParams.get('scene'), ch5: s && s.sim ? s.sim.ch[5] : null, pref: h.prefs.get('flight.mode'), src: h.controls.source, sessScene: s && s.scene ? s.scene.id : null, sameCtl: h.controls && h.controls.session === undefined }; })()`);
const st = () => p.evaluate(`(() => { const h = window.__gsfpv; const s = h.session; return { menu: !!document.querySelector('.pause-menu'), paused: s ? s.paused : null, tick: s && s.sim ? s.sim.tick : null }; })()`);
const out: Record<string, unknown> = {};
await p.keyboard.press('Escape'); await p.waitForTimeout(500);
out.menuOpen = await st();
await p.click('.pause-menu [data-action="pause.continue"]'); await p.waitForTimeout(800);
out.afterContinue = await st();
await p.waitForTimeout(1000);
out.later = await st();
await p.keyboard.press('KeyN'); await p.waitForTimeout(12000);
await p.keyboard.press('Escape'); await p.waitForTimeout(500);
out.menu2 = await st();
await p.click('.pause-menu [data-action="pause.continue"]'); await p.waitForTimeout(800);
out.afterContinue2 = await st();
out.errors = errs;
console.log(JSON.stringify(out));
await browser.close();
