// Integration F of train 3, seam d: at a short view (default 844x390) the course's clock block and the REC row. On a
// local release with ?render=off (no GPU lock): the keyboard scheme, Shift+G (a course made in this tab, never saved),
// then the rectangles of the clock block, the REC row, its folder control and the clock's cross, whether any two of
// them overlap, and one picture. Exit 0 when the clock block lies over none of the REC row's controls.
// Usage: node int3f-clock-shot.mjs <base with /en> <scene> <out.json> <picture.png> [WxH]
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { pickBrowser } from '../src/chrome.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [base, id, out, png, size = '844x390'] = process.argv.slice(2);
if (!base || !id || !out || !png) { console.error('usage: int3f-clock-shot.mjs <base with /en> <scene> <out.json> <picture.png> [WxH]'); process.exit(2); }
const [W, H] = size.split('x').map(Number);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = pickBrowser({ expected: chromium.executablePath() });
const browser = await chromium.launch({ ...pick.launch, headless: true });
const r = { base, id, size };
try {
    const page = await (await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })).newPage();
    await page.goto(`${base}/fly/?scene=${id}&nowarn=1&render=off`);
    await page.waitForFunction(() => ['ready', 'error'].includes(window.__gsfpv?.status), null, { timeout: 240000 });
    try {
        await page.waitForSelector('.screen.radio [data-action="radio-keyboard"]', { timeout: 15000 });
        await page.focus('.screen.radio [data-action="radio-keyboard"]');
        await page.keyboard.press('Enter');
    } catch { /* no Controls screen */ }
    await sleep(1500);
    await page.keyboard.press('Shift+KeyG');
    await page.waitForFunction(() => { const e = document.querySelector('[data-testid=course-hud]'); return !!e && e.offsetParent !== null; }, null, { timeout: 240000 });
    await sleep(2500);
    Object.assign(r, await page.evaluate(() => {
        const R = (e) => { if (!e || e.offsetParent === null) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
        const hit = (a, b) => !!a && !!b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        const clock = R(document.querySelector('[data-testid=course-hud]'));
        const bar = document.querySelector('[data-testid=rec-bar]');
        const ctrls = bar ? [...bar.querySelectorAll('button, select, label, summary')].map((e) => ({ text: (e.textContent || '').trim().slice(0, 30), rect: R(e) })).filter((c) => c.rect) : [];
        const cross = R(document.querySelector('[data-testid=course-hud] [data-action$=close], [data-testid=course-hud] .panel-x, [data-testid=course-hud] button[aria-keyshortcuts]'));
        return { clock, recBar: R(bar), cross, controls: ctrls, clockOver: ctrls.filter((c) => hit(clock, c.rect)).map((c) => c.text), crossOver: ctrls.filter((c) => hit(cross, c.rect)).map((c) => c.text) };
    }));
    await page.screenshot({ path: png });
    r.pass = !!r.clock && r.clockOver.length === 0 && r.crossOver.length === 0;
} catch (e) { r.error = String(e.message || e); r.pass = false; }
await browser.close();
writeFileSync(out, JSON.stringify(r, null, 1));
console.log(JSON.stringify({ pass: r.pass, clock: r.clock, recBar: r.recBar, clockOver: r.clockOver, crossOver: r.crossOver, error: r.error }));
process.exit(r.pass ? 0 : 1);
