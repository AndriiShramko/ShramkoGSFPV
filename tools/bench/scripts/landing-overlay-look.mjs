// Live look at release 8042182: landing screenshots (ru, 1440 + 390) and the fly overlay / walls switch.
import { fileURLToPath } from 'node:url';
// repo root (tools/bench/scripts/ -> ../../..): no machine-specific paths
const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '');
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
const require = createRequire(ROOT + '/tools/bench/package.json');
const { chromium } = require('playwright');
const OUT = ROOT + '/.cache/wvl/live-look';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: false });
const res = {};
{
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto('https://gsfpv.flyreelstudio.eu/ru/', { waitUntil: 'networkidle' });
    await page.screenshot({ path: `${OUT}/ru-1440-top.png` });
    for (const [i, y] of [[1, 900], [2, 1800], [3, 2700], [4, 3600], [5, 4500]]) { await page.evaluate((yy) => scrollTo(0, yy), y); await page.waitForTimeout(700); await page.screenshot({ path: `${OUT}/ru-1440-${i}.png` }); }
    res.imgs = await page.evaluate(() => ({ total: document.images.length, broken: [...document.images].filter((im) => im.complete && im.naturalWidth === 0).map((im) => im.src.slice(-60)) }));
    await ctx.close();
}
{
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 160)));
    await page.goto('https://gsfpv.flyreelstudio.eu/en/fly/?scene=39e63ce9&input=touch&nowarn=1', { waitUntil: 'load' });
    await page.waitForFunction(() => window.__gsfpv?.status === 'ready', null, { timeout: 120000 });
    await page.waitForTimeout(3000);
    const walls = () => page.evaluate(() => ({ collision: !!window.__gsfpv.session.collision, credit: (document.querySelector('.attribution')?.innerText ?? '').slice(-60), osd: (document.querySelector('.osd')?.innerText ?? '').slice(0, 60) }));
    res.before = await walls();
    await page.keyboard.press('v'); await page.waitForTimeout(2500); await page.screenshot({ path: `${OUT}/fly-overlay.png` });
    await page.keyboard.press('v'); await page.waitForTimeout(2500); await page.screenshot({ path: `${OUT}/fly-voxels-only.png` });
    await page.keyboard.press('v'); await page.waitForTimeout(800);
    await page.keyboard.press('c'); await page.waitForTimeout(800);
    res.afterC = await walls();
    await page.screenshot({ path: `${OUT}/fly-walls-off.png` });
    await page.keyboard.press('c'); await page.waitForTimeout(800);
    res.afterC2 = await walls();
    res.errors = errors;
    await ctx.close();
}
await browser.close();
writeFileSync(`${OUT}/result.json`, JSON.stringify(res, null, 1));
console.log(JSON.stringify(res, null, 1));
