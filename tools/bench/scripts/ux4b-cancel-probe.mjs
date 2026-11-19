// Lane ux4b, stage B-3 (docs/wip/ux4b.md, design voxux4 part ux4b): cancel a scene that is loading, walked as the pilot
// does it, with the mouse, at 1536x730 with device scale 1.25. Flying Wroclaw (70b50d42): a click on Keyboard on the
// Controls screen, a click into the scene (the pointer lock), key P, a click on "Change scan", a click on Lublin (2f1ddf5f).
//   1 within 2 s the loading card shows Cancel, at least 44x44, in view and not covered;
//   2 a click on Cancel: within 1 s the card is gone and the scene list is open (hook.sceneSwitch 'cancelled');
//   3 from one second after the cancel, for 2 s, no new request to a folder Lublin's load had asked;
//   4 the renderer holds no Lublin asset and one gsplat entity at most; no walls bake running;
//   5 a click on the list's cross: Wroclaw flies again (hook.sceneSwitch done, to 70b50d42), "Back to" on the page;
//   6 the list again, Lublin picked, key N during its load: another scene loads, no Lublin entity or asset afterwards;
//   7 at 844x390 (a phone held across; ?render=off, Lublin's requests held 8 s so the card stays) Cancel is in view and
//     not covered.
// The scan is drawn for steps 1-6 (a download is what is cancelled): wrap the run in the GPU lock. Read-only on any site:
// nothing is saved, sent or created (a pick, Cancel, the cross and key N only).
//   node tools/bench/scripts/ux4b-cancel-probe.mjs <address with /en> <out.json>
// Prints one JSON verdict; exit 1 when a step fails.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pickBrowser } from '../src/chrome.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [base, outPath] = process.argv.slice(2);
if (!base || !outPath) {
    console.error('usage: ux4b-cancel-probe.mjs <address with /en> <out.json>');
    process.exit(2);
}
const FROM = '70b50d42';
const TO = '2f1ddf5f';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const res = { base, from: FROM, to: TO, steps: {}, log: [] };
const fails = [];
const errs = [];
// ONLY=7: the phone step alone (?render=off, no GPU), with its cancel and step 8
const ONLY = process.env.ONLY || '';
function judge(step, ok, why = {}) {
    res.steps[step] = { ok: !!ok, ...why };
    if (!ok) fails.push(step);
}

const STATE = `(() => {
    const h = window.__gsfpv || {}; const s = h.session; const a = s && s.renderer && s.renderer.app;
    const out = { status: h.status ?? null, sw: h.sceneSwitch ?? null, scene: s && s.scene ? s.scene.id : null, walls: h.walls ? h.walls.state : null };
    if (a) {
        out.entities = a.root.findComponents('gsplat').length;
        out.assets = a.assets.list().filter((x) => x.type === 'gsplat').map((x) => String(x.file && x.file.url || x.name));
    }
    const card = document.querySelector('[data-testid="loading"]');
    out.card = !!(card && card.getClientRects().length);
    const p = document.querySelector('[data-testid="scenes-in-flight"]');
    out.picker = !!(p && p.getClientRects().length);
    out.text = (document.getElementById('ui') || document.body).innerText.replace(/\\s+/g, ' ').slice(0, 2000);
    return out;
})()`;
/** the box of the first visible match, whether it lies in the view and what the point at its centre hits */
const BOX = (sel) => `(() => {
    const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.getClientRects().length && getComputedStyle(x).visibility !== 'hidden');
    if (!e) return null;
    const b = e.getBoundingClientRect(); const x = b.left + b.width / 2, y = b.top + b.height / 2;
    const top = document.elementFromPoint(x, y);
    return { x, y, w: Math.round(b.width), h: Math.round(b.height), inView: b.left >= 0 && b.top >= 0 && b.right <= innerWidth && b.bottom <= innerHeight,
        covered: !(top && (top === e || e.contains(top))), under: top ? top.tagName + (top.className && typeof top.className === 'string' ? '.' + top.className.split(' ')[0] : '') : null, text: (e.textContent || '').trim().slice(0, 30) };
})()`;

const pick = pickBrowser({ expected: chromium.executablePath() });
const browser = await chromium.launch({ ...pick.launch, headless: true });

async function until(fn, ok, ms, step = 200) {
    const t0 = Date.now();
    let v = await fn();
    while (!ok(v) && Date.now() - t0 < ms) { await sleep(step); v = await fn(); }
    return { ok: ok(v), v, ms: Date.now() - t0 };
}

/** one page: opened, the Controls screen closed by a click, the pointer lock taken by a click into the scene */
async function open(W, H, dsf, query, hold) {
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: dsf, hasTouch: false, isMobile: false });
    const page = await ctx.newPage();
    const reqs = [];
    // the scan's own requests only: fetch/xhr (the posters and the page's chunks are not the load)
    page.on('request', (r) => { const t = r.resourceType(); if (t === 'fetch' || t === 'xhr' || t === 'other') reqs.push([Date.now(), r.url()]); });
    // each distinct page error once, with where it was thrown; errs counts them all (step 8)
    page.on('pageerror', (e) => {
        errs.push(Date.now());
        const m = `pageerror: ${e.message} @ ${String(e.stack || '').split('\n').slice(1, 3).join(' < ').trim()}`.slice(0, 400);
        if (!res.log.includes(m) && res.log.length < 40) res.log.push(m);
    });
    if (hold) await page.route((u) => u.href.includes(TO), async (route) => { await sleep(hold); await route.continue().catch(() => undefined); });
    await page.goto(`${base}/fly/?scene=${FROM}&nowarn=1${query}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    const ready = await until(() => page.evaluate(() => window.__gsfpv?.status ?? null), (v) => v === 'ready' || v === 'error', 300000, 1000);
    if (ready.v !== 'ready') throw new Error(`page status ${ready.v}`);
    const kb = await page.waitForSelector('.screen.radio [data-action="radio-keyboard"]', { timeout: 20000 }).catch(() => null);
    if (kb) { await kb.scrollIntoViewIfNeeded(); await kb.click(); await sleep(1200); }
    await page.mouse.click(W / 2, H / 2);
    await sleep(600);
    const st = () => page.evaluate(STATE);
    const box = (sel) => page.evaluate(BOX(sel));
    return { ctx, page, reqs, st, box, readyMs: ready.ms, lock: await page.evaluate(() => !!document.pointerLockElement) };
}

/** key P, a click on "Change scan", a click on Lublin's card (scrolled into view, as a person scrolls), or its id typed */
async function pickLublin(p) {
    await p.page.keyboard.press('KeyP');
    const ch = await p.page.waitForSelector('[data-action="pause.scene"]', { timeout: 8000 });
    await ch.scrollIntoViewIfNeeded();
    await ch.click();
    await p.page.waitForSelector('[data-testid="scenes-in-flight"]', { timeout: 8000 });
    await sleep(500);
    const card = await p.page.$(`[data-testid="scenes-in-flight"] .scene-card[data-scene="${TO}"]`);
    const t0 = Date.now();
    if (card) { await card.scrollIntoViewIfNeeded(); await card.click(); return { t0: Date.now(), how: 'card', clickMs: Date.now() - t0 }; }
    const input = await p.page.$('[data-testid="scenes-in-flight"] .scene-input');
    await input.click();
    await input.type(TO);
    await p.page.keyboard.press('Enter');
    return { t0: Date.now(), how: 'typed' };
}
const folder = (u) => { try { const x = new URL(u); return x.origin + x.pathname.slice(0, x.pathname.lastIndexOf('/') + 1); } catch { return u; } };
const isLublin = (u, folders) => u.includes(TO) || folders.has(folder(u));

try {
    // ---- steps 1-6 at 1536x730, device scale 1.25, the scan drawn
    if (ONLY !== '7') {
    const p = await open(1536, 730, 1.25, '', 0);
    res.ready = { ms: p.readyMs, lockAfterClick: p.lock };
    const before = new Set(p.reqs.map((r) => folder(r[1])));
    const pk = await pickLublin(p);
    res.pick = pk;
    const c1 = await until(() => p.box('[data-action="load-cancel"]'), (b) => !!b, 2000, 100);
    const b1 = c1.v;
    judge('1.cancel-shown', b1 && b1.w >= 44 && b1.h >= 44 && b1.inView && !b1.covered, { ms: c1.ms, box: b1 });
    // let the download of Lublin get under way, then cancel with the mouse
    await sleep(2500);
    const midSt = await p.st();
    res.beforeCancel = { sw: midSt.sw, assets: midSt.assets, entities: midSt.entities };
    const b2 = await p.box('[data-action="load-cancel"]');
    let tCancel = Date.now();
    if (b2) {
        await p.page.mouse.move(b2.x, b2.y, { steps: 4 });
        tCancel = Date.now();
        await p.page.mouse.click(b2.x, b2.y);
    }
    const c2 = await until(p.st, (s) => !s.card && s.picker, 1000, 50);
    judge('2.cancel-closes', b2 && c2.ok && c2.v.sw && c2.v.sw.state === 'cancelled', { ms: c2.ms, card: c2.v.card, picker: c2.v.picker, sw: c2.v.sw, said: /Loading stopped/.test(c2.v.text) });
    const lublin = new Set(p.reqs.filter((r) => r[0] >= pk.t0 - 200 && r[0] <= tCancel).map((r) => folder(r[1])).filter((f) => !before.has(f)));
    res.lublinFolders = [...lublin].slice(0, 12);
    await sleep(1000);
    const t3 = Date.now();
    await sleep(2000);
    const late = p.reqs.filter((r) => r[0] >= t3 && isLublin(r[1], lublin)).map((r) => r[1]);
    judge('3.no-late-requests', b2 && lublin.size > 0 && late.length === 0, { lublinFolders: lublin.size, late: late.slice(0, 5), lateN: late.length });
    const s4 = await p.st();
    const lAssets = (s4.assets || []).filter((u) => isLublin(u, lublin));
    judge('4.nothing-left', b2 && lAssets.length === 0 && (s4.entities ?? 0) <= 1 && s4.walls !== 'baking', { lublinAssets: lAssets, entities: s4.entities, assets: s4.assets, walls: s4.walls });
    // 5 the list's cross: back to Wroclaw
    const x5 = await p.box('[data-testid="scenes-in-flight"] [data-action="scenes-close"]');
    res.errsWhileCancelled = errs.filter((t) => t >= tCancel).length;
    if (x5) await p.page.mouse.click(x5.x, x5.y);
    const c5 = await until(p.st, (s) => s.sw && s.sw.state === 'done' && s.sw.to === FROM && !s.card, 240000, 500);
    judge('5.back-to-from', x5 && c5.ok && c5.v.scene === FROM, { ms: c5.ms, sw: c5.v.sw, scene: c5.v.scene, said: /Back to/.test(c5.v.text), cross: x5 && { w: x5.w, h: x5.h } });
    // 6 Lublin again, key N during its load
    await p.page.mouse.click(768, 365);
    await sleep(500);
    const pk6 = await pickLublin(p);
    await until(p.st, (s) => s.sw && s.sw.state === 'loading' && s.sw.to === TO, 3000, 100);
    await sleep(2000);
    const at6 = await p.st();
    await p.page.keyboard.press('KeyN');
    const c6 = await until(p.st, (s) => s.sw && s.sw.state === 'done' && s.sw.to !== TO && !s.card, 240000, 500);
    await sleep(1500);
    const s6 = await p.st();
    const l6 = (s6.assets || []).filter((u) => isLublin(u, lublin));
    judge('6.n-replaces', c6.ok && s6.scene !== TO && l6.length === 0 && (s6.entities ?? 0) <= 1, { pickHow: pk6.how, atN: at6.sw, ms: c6.ms, sw: c6.v.sw, scene: s6.scene, lublinAssets: l6, entities: s6.entities });
    await p.ctx.close();
    }

    // ---- step 7 at 844x390: the card's Cancel in view and not covered
    const q = await open(844, 390, 2, '&render=off', 8000);
    await pickLublin(q);
    const c7 = await until(() => q.box('[data-action="load-cancel"]'), (b) => !!b, 3000, 100);
    judge('7.cancel-phone', c7.v && c7.v.w >= 44 && c7.v.h >= 44 && c7.v.inView && !c7.v.covered, { box: c7.v });
    // 8 the list stands after a Cancel: the page throws nothing meanwhile (the flight's loops see no scene)
    const t8 = Date.now();
    if (c7.v) await q.page.mouse.click(c7.v.x, c7.v.y);
    await sleep(3000);
    const e8 = errs.filter((t) => t >= t8).length;
    judge('8.no-errors-after-cancel', c7.v && e8 === 0 && (res.errsWhileCancelled ?? 0) === 0, { phone: e8, desktop: res.errsWhileCancelled ?? null, picker: (await q.st()).picker });
    await q.ctx.close();
} catch (e) {
    res.error = String(e && e.stack || e).slice(0, 600);
    fails.push('error');
}
await browser.close();
res.pass = fails.length === 0;
res.fails = fails;
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(res, null, 1));
console.log(JSON.stringify({ pass: res.pass, fails, steps: Object.fromEntries(Object.entries(res.steps).map(([k, v]) => [k, v.ok])), error: res.error }));
process.exit(res.pass ? 0 : 1);
