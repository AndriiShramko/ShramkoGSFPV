// Lane n-scan, independent review (docs/wip/n-scan.md "## Review"): the pilot cancels the download of the largest
// scan of the kinds list (c67edb74, compressed PLY, 163 MB) by the MOUSE on the loading card's Cancel, then picks a
// catalog scene in the scene list by the mouse: it must open and fly. Drawn (no GPU lock taken here: wrap it).
// PASS when: Cancel was on the card during the download; after it no error line and the scene list is open; the
// catalog scene reaches 'ready' with splats drawn; after Keyboard and a click into the scene the simulation steps.
//   node tools/bench/scripts/n-scan-review-cancel.mjs <base with /en> <out.json> [scan id]
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pickBrowser } from '../src/chrome.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [base, outFile, scan = 'c67edb74'] = process.argv.slice(2);
if (!base || !outFile) {
    console.error('usage: n-scan-review-cancel.mjs <base with /en> <out.json> [scan id]');
    process.exit(2);
}
console.log(`n-scan-review-cancel: ${base}`);
const STATE = `(() => {
    const h = window.__gsfpv || {}; const s = h.session; const a = s && s.renderer && s.renderer.app;
    const vis = (q) => { const e = document.querySelector(q); return !!(e && e.getClientRects().length); };
    const err = document.querySelector('.scene-error');
    return { status: h.status || null, errorCode: h.errorCode || null, scene: s && s.scene ? s.scene.id : null,
        loaded: h.loading ? h.loading.loaded : null, cancel: vis('[data-action="load-cancel"]'),
        cards: [...document.querySelectorAll('.scene-card[data-scene]:not(.ss-card):not(.scene-continue)')].filter((e) => e.getClientRects().length).length,
        line: err && err.getClientRects().length ? err.textContent : null, drawn: a ? a.stats.frame.gsplats : null,
        tick: s && s.sim ? s.sim.tick : null, sw: h.sceneSwitch || null };
})()`;
async function centre(page, sel) {
    return page.evaluate((q) => {
        const e = [...document.querySelectorAll(q)].find((x) => x.getClientRects().length);
        if (!e) return null;
        e.scrollIntoView({ block: 'center' });
        const r = e.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, id: e.getAttribute('data-scene') };
    }, sel);
}
const res = { base, scan, at: new Date().toISOString(), steps: {}, errors: [], pass: false };
const pick = pickBrowser({ expected: chromium.executablePath() });
const browser = await chromium.launch({ ...pick.launch, headless: true });
try {
    const ctx = await browser.newContext({ viewport: { width: 1536, height: 730 }, deviceScaleFactor: 1.25 });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => res.errors.push(String(e.message).slice(0, 200)));
    await page.goto(`${base}/fly/?scene=${scan}&nowarn=1&set.input.howToFly=false`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    let st = null;
    for (let i = 0; i < 90; i++) {
        await page.waitForTimeout(1000);
        st = await page.evaluate(STATE).catch(() => null);
        if (st && st.cancel && st.loaded > 0) break;
    }
    res.steps.during = st;
    const c = await centre(page, '[data-action="load-cancel"]');
    if (c) { await page.mouse.move(c.x, c.y, { steps: 4 }); await page.mouse.click(c.x, c.y); }
    await page.waitForTimeout(2500);
    res.steps.afterCancel = await page.evaluate(STATE).catch(() => null);
    // Cancel on the first load leaves the scan (like "Choose another scan"): the page without ?scene opens a catalog
    // scene or the scene list; a card of the list is clicked by the mouse when the list is open
    let card = await centre(page, '.scene-card[data-scene]:not(.ss-card):not(.scene-continue)');
    if (card) { await page.mouse.move(card.x, card.y, { steps: 4 }); await page.mouse.click(card.x, card.y); }
    let run = 0;
    for (let i = 0; i < 180 && run < 3; i++) {
        await page.waitForTimeout(1000);
        st = await page.evaluate(STATE).catch(() => null);
        if (!card && st && st.cards > 0) {
            card = await centre(page, '.scene-card[data-scene]:not(.ss-card):not(.scene-continue)');
            if (card) { await page.mouse.move(card.x, card.y, { steps: 4 }); await page.mouse.click(card.x, card.y); }
        }
        const target = card ? st && st.scene === card.id : st && st.scene && st.scene !== scan;
        run = st && st.status === 'ready' && target && st.drawn > 0 ? run + 1 : 0;
    }
    res.steps.card = card || { id: st && st.scene, how: 'opened by the page' };
    res.steps.opened = st;
    const kb = await centre(page, '[data-action="radio-keyboard"]');
    if (kb) await page.mouse.click(kb.x, kb.y);
    await page.waitForTimeout(800);
    await page.mouse.click(768, 365);
    await page.waitForTimeout(500);
    const a = await page.evaluate(STATE);
    await page.waitForTimeout(1500);
    const b = await page.evaluate(STATE);
    res.steps.flight = { keyboard: !!kb, tick0: a.tick, tick1: b.tick };
    await page.screenshot({ path: 'U:/Temp/gsfpv-train4/shots/n-scan-review-cancel.png' });
    const why = [];
    if (!res.steps.during?.cancel) why.push('no Cancel on the card during the download');
    if (!c) why.push('Cancel not clickable');
    if (res.steps.afterCancel?.line) why.push(`an error line after Cancel: ${res.steps.afterCancel.line}`);
    if (run < 3) why.push(`the catalog scene did not open: ${JSON.stringify(st)}`);
    if (!(typeof a.tick === 'number' && b.tick > a.tick)) why.push(`not flown: tick ${a.tick} -> ${b.tick}`);
    if (res.errors.length) why.push(`page error: ${res.errors[0]}`);
    res.why = why;
    res.pass = why.length === 0;
} finally {
    await browser.close();
}
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify(res, null, 2));
console.log(JSON.stringify({ pass: res.pass, why: res.why, card: res.steps.card?.id }));
process.exit(res.pass ? 0 : 1);
