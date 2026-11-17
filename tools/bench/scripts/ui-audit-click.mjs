// Lane uiaudit A2: a direct check of two close crosses on a fresh open (F3's frame line, the course clock's block):
// the cross's rectangle, the element on top at its centre, a real pointer click, and whether the line is hidden after.
// ui-audit-probe.mjs tries the cross only after its other ways closed and reopened the panel; this check does not.
// Usage: node ui-audit-click.mjs <WxH> [base with the locale, default http://localhost:5840/en]. ?render=off: no GPU lock.
import { createRequire } from 'node:module';
import { pickHarnessBrowser } from './visual-browser.mjs';
const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('playwright');
const [vw, vh] = (process.argv[2] ?? '1366x768').split('x').map(Number);
const pick = pickHarnessBrowser({ expected: chromium.executablePath() }, false);
const browser = await chromium.launch({ ...pick.launch });
const page = await (await browser.newContext({ viewport: { width: vw, height: vh } })).newPage();
const S = (ms) => page.waitForTimeout(ms);
await page.goto(`${(process.argv[3] ?? 'http://localhost:5840/en').replace(/\/$/, '')}/fly/?scene=39e63ce9&nowarn=1&render=off&set.input.play=easy`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__gsfpv?.status === 'ready', null, { timeout: 180000 });
await page.locator('[data-action=radio-keyboard]').click({ timeout: 6000 }).catch(() => {});
await S(1500);
const vis = (sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return 'none'; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden' ? 'shown' : 'hidden'; }, sel);
for (const [name, open, line, x] of [['frame', 'F3', '.osd.frame', '[data-action=frame-stats-close]'], ['course', 'Shift+KeyG', '[data-testid=course-hud]', '[data-action=course-hud-close]']]) {
  await page.keyboard.press(open); await S(name === 'course' ? 4000 : 1200);
  const before = await vis(line);
  const at = await page.evaluate((x) => { const e = document.querySelector(x); const r = e.getBoundingClientRect(); const t = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)} top=${t?.tagName}.${t?.className}`; }, x);
  let err = 'ok';
  await page.locator(x).first().click({ timeout: 3000 }).catch((e) => { err = String(e.message).split('\n').slice(0, 4).join(' | ').slice(0, 400); });
  await S(800);
  console.log(`${vw}x${vh} ${name}: before ${before} cross ${at} click ${err} after ${await vis(line)} pointerLock ${await page.evaluate(() => !!document.pointerLockElement)}`);
  if (await vis(line) === 'shown') { await page.evaluate((x) => document.querySelector(x).click(), x); await S(600); console.log(`  js click -> ${await vis(line)}`); }
}
await browser.close();
