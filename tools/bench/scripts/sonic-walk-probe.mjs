// The owner's path to Fly by Sound from an ordinary flight (train 3, lane sonic3, stage Z1): open a scene, fly a moment, Escape,
// the pause menu's Fly by Sound item, and on until the first sound line is heard. Read only: it never presses save, send or create.
// Every screen is written down (its visible text and buttons) with a screenshot; the walk stops where a pilot would stop.
// Usage: node tools/bench/scripts/sonic-walk-probe.mjs <base with /en> <out.json> <shotsDir> [scene]
// It does not take the GPU lock itself: wrap it (until mkdir C:/dev/.gpu-lock ...; probe; rmdir C:/dev/.gpu-lock).
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pickHarnessBrowser } from './visual-browser.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '');
const require = createRequire(ROOT + '/tools/bench/package.json');
const { chromium } = require('playwright');
const base = process.argv[2] ?? 'https://gsfpv.flyreelstudio.eu/en';
const outFile = process.argv[3] ?? ROOT + '/.cache/sonic-walk.json';
const shots = process.argv[4] ?? 'U:/Temp/gsfpv-train3/shots';
const scene = process.argv[5] ?? '887f27aa';
mkdirSync(dirname(outFile), { recursive: true });
mkdirSync(shots, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const steps = [];

/** In the page: what a pilot sees now (visible screens, buttons, links, captions) and the sound hook if there is one. */
function look() {
    const vis = (el) => !!el && el.offsetParent !== null && getComputedStyle(el).visibility !== 'hidden';
    const txt = (el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
    const screens = [...document.querySelectorAll('.screen, .pause-menu, [role=dialog]')].filter(vis).map(txt);
    const buttons = [...document.querySelectorAll('button, a[href]')].filter(vis).map((b) => ({ t: txt(b).slice(0, 80), href: b.getAttribute('href'), target: b.getAttribute('target') })).slice(0, 30);
    const captions = [...document.querySelectorAll('[aria-live], .sonic-captions, .captions')].map(txt).filter(Boolean).slice(0, 6);
    let sonic = null;
    try {
        const s = window.__gsfpv?.sonic?.();
        if (s) sonic = { lesson: s.lesson ?? null, phase: s.phase ?? null, lastLine: s.lastLine ?? null, speechQueue: s.speechQueue ?? null, walls: s.walls ?? null, engine: s.engine ? Object.keys(s.engine).slice(0, 8) : null };
    } catch (e) {
        sonic = { error: String(e).slice(0, 120) };
    }
    return { url: location.href, status: window.__gsfpv?.status ?? null, screens, buttons, captions, sonic };
}

async function note(page, name, extra = {}) {
    const file = `${shots}/sonic-walk-${scene}-${steps.length + 1}-${name}.png`;
    await page.screenshot({ path: file }).catch(() => undefined);
    const seen = await page.evaluate(look).catch((e) => ({ error: String(e).slice(0, 160) }));
    steps.push({ n: steps.length + 1, name, sec: Math.round((Date.now() - t0) / 1000), shot: file, ...extra, seen });
    console.log(`${steps.length} ${name} ${Math.round((Date.now() - t0) / 1000)}s`);
}

const pick = pickHarnessBrowser({ expected: chromium.executablePath() }, false);
const browser = await chromium.launch({ ...pick.launch, headless: pick.launch.headless });
const out = { base, scene, steps, errors: [] };
try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => out.errors.push(String(e.message).slice(0, 160)));
    await page.goto(`${base}/fly/?scene=${scene}`, { waitUntil: 'load' });
    await sleep(3000);
    await note(page, 'opened');
    // a returning pilot clears the first-visit screens with their first button (recorded above)
    for (let i = 0; i < 4; i++) {
        const ready = await page.evaluate(() => window.__gsfpv?.status === 'ready').catch(() => false);
        if (ready) break;
        const btn = page.locator('.screen button:visible, [role=dialog] button:visible').first();
        if (await btn.count()) {
            const label = (await btn.textContent())?.trim().slice(0, 60);
            await btn.click().catch(() => undefined);
            await sleep(1500);
            await note(page, `pressed-${i + 1}`, { pressed: label });
        } else await sleep(5000);
    }
    await page.waitForFunction(() => window.__gsfpv?.status === 'ready', null, { timeout: 240000 });
    const asks = await page.waitForSelector('.screen.radio [data-action=radio-keyboard]', { timeout: 6000 }).then(() => true, () => false);
    if (asks) {
        await note(page, 'radio-question');
        await page.locator('[data-action=radio-keyboard]').click();
    }
    await sleep(1500);
    await page.keyboard.down('KeyW');
    await sleep(1500);
    await page.keyboard.up('KeyW');
    await note(page, 'flying');
    await page.keyboard.press('Escape');
    await page.waitForSelector('.pause-menu', { timeout: 10000 });
    await sleep(700);
    await note(page, 'pause-menu');
    const item = page.locator('.pause-menu a[href*="sonic="]').first();
    out.item = { count: await item.count(), href: await item.getAttribute('href').catch(() => null), target: await item.getAttribute('target').catch(() => null), text: (await item.textContent().catch(() => ''))?.trim() };
    const popup = ctx.waitForEvent('page', { timeout: 15000 }).catch(() => null);
    await item.click();
    let sp = await popup;
    out.newTab = !!sp;
    if (!sp) sp = page;
    await sp.waitForLoadState('load').catch(() => undefined);
    await sleep(5000);
    await note(sp, 'after-item');
    // the start screen: its first button is what the screen offers first
    const first = sp.locator('.screen button:visible').first();
    out.firstButton = (await first.textContent().catch(() => ''))?.trim().slice(0, 80);
    if (await first.count()) {
        await first.click();
        await sleep(3000);
        await note(sp, 'pressed-first');
    }
    // up to 4 minutes: a lesson or the free flight starts and speaks
    const until = Date.now() + 240000;
    let lines = 0;
    while (Date.now() < until) {
        const s = await sp.evaluate(look).catch(() => null);
        if (s?.sonic?.lastLine && lines === 0) {
            lines++;
            await note(sp, 'first-line');
        }
        if (lines > 0 && Date.now() - t0 > 20000 + steps[steps.length - 1].sec * 1000) break;
        await sleep(3000);
    }
    await note(sp, 'end');
} catch (e) {
    out.errors.push(`walk: ${String(e?.message ?? e).slice(0, 300)}`);
} finally {
    await browser.close();
}
out.sec = Math.round((Date.now() - t0) / 1000);
writeFileSync(outFile, JSON.stringify(out, null, 2) + '\n');
console.log(`done ${out.sec}s steps ${steps.length} errors ${out.errors.length}`);
