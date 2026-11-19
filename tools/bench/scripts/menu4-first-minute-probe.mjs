// A new pilot's first minute with the MOUSE (lane menu4, docs/wip/menu4.md; the owner's brief line 373: several kinds of
// newcomer, different first menus, for one who never flew everything simple, a fuller menu later).
// Headless Chrome through tools/bench/src/chrome.mjs, viewport 1536x730 at device scale 1.25 (the owner's laptop), the
// logic-only test mode (?render=off: no scan is drawn). No ?nowarn: the page is a first visit, as a new pilot sees it.
// Pilot "first" (a fresh profile):
//   ask      the "Before you fly" notice asks "Have you flown FPV before?" with three answers
//   answer   a click on "Never. Keep it simple" closes it and the flight page goes on (Controls, then How to fly)
//   capture  the keyboard on the Controls screen, Start flying on the card, a click into the scene: the pointer lock
//   pause    P: the pause menu frees the mouse, shows few items and a "More (n)" line holding the rest
//   fits     every item shown fits the 730 px view with no scrolling, and the items do not lie over each other
//   more     a click on "More (n)" shows the n items
//   settings a click on Settings: fewer rows than the full list and a "Show all settings (n more)" button
//   search   a click into search and "uptilt": the camera uptilt row shows, marked "In the full menu"
//   showAll  clearing the search and a click on "Show all settings": every row shows
//   close    the cross of Settings is at least 44 px and closes it; a click into the scene takes the mouse again
// Pilots "sim" and "expert" (fresh profiles): their answer, then P and Settings: the shown counts of the three pilots
// differ on each screen, and "expert" has no "More" and no "Show all settings" (today's full menus).
// It never presses a send, save or create button and stores nothing outside the fresh browser profiles.
// Usage: node menu4-first-minute-probe.mjs <base with the locale, e.g. http://localhost:6101/en> <out.json> [--shot <dir>]
// Prints PASS/FAIL lines and, as the LAST line, JSON {pass, base, checks:[{name, pass, detail}]}; exit 0 only on pass.
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { pickBrowser } from '../src/chrome.mjs';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '');
const require = createRequire(ROOT + '/tools/bench/package.json');
const { chromium } = require('playwright');
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
const shotDir = flag('--shot');
const base = (args[0] ?? 'http://localhost:6101/en').replace(/\/$/, '');
const outFile = args[1] ?? 'U:/Temp/gsfpv-train4/menu4/first-minute.json';
mkdirSync(dirname(outFile), { recursive: true });
if (shotDir) mkdirSync(shotDir, { recursive: true });

const VIEW = { width: 1536, height: 730 };
const pick = pickBrowser({ expected: chromium.executablePath() });
const browser = await chromium.launch(pick.launch);
const checks = [];
const check = (name, pass, detail) => {
    checks.push({ name, pass: !!pass, detail: detail ?? null });
    console.log(`  ${pass ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(detail ?? '').slice(0, 300)}`);
    return !!pass;
};
const settle = (page, ms = 600) => page.waitForTimeout(ms);
const visible = (page, sel) => page.locator(sel).first().isVisible().catch(() => false);

/** A fresh profile on the first visit of the flight page, at the owner's laptop size. */
async function fresh() {
    const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 1.25 });
    const page = await ctx.newPage();
    page.errors = [];
    page.on('pageerror', (e) => page.errors.push(String(e.message).slice(0, 160)));
    await page.goto(`${base}/fly/?scene=39e63ce9&render=off`, { waitUntil: 'load' });
    await page.waitForSelector('[data-action^="warning-"]', { timeout: 60000 }).catch(() => {});
    return { ctx, page };
}

/** The notice's answer by its data-action; where the page has no such answer (the old page) the single OK goes on. */
async function answer(page, action) {
    const b = page.locator(`[data-action="${action}"]`);
    const has = await b.count() > 0;
    await (has ? b : page.locator('[data-action="warning-ok"]')).first().click();
    await page.waitForFunction(() => window.__gsfpv?.status === 'ready', null, { timeout: 120000 });
    return has;
}

/** The Controls screen of the first visit: the keyboard; then the How to fly card that opens by itself: Start flying. */
async function keyboardAndCard(page) {
    // the first visit's cookie question lies over the page's lower middle: a new pilot answers it (Decline: nothing loads)
    const consent = await page.waitForSelector('[data-action=consent-decline]', { timeout: 4000, state: 'visible' }).then(() => true, () => false);
    if (consent) await page.locator('[data-action=consent-decline]').click();
    const asks = await page.waitForSelector('.screen.radio [data-action=radio-keyboard]', { timeout: 15000 }).then(() => true, () => false);
    if (asks) await page.locator('[data-action=radio-keyboard]').click();
    await page.waitForFunction(() => !document.querySelector('.screen.radio'), null, { timeout: 15000 }).catch(() => {});
    const card = await page.waitForSelector('[data-action=htf-start]', { timeout: 8000, state: 'visible' }).then(() => true, () => false);
    if (card) await page.locator('[data-action=htf-start]').click();
    await settle(page, 1000);
    return { consent, controls: asks, card };
}

const locked = (page) => page.evaluate(() => document.pointerLockElement !== null);
/** A click into the scene (the middle of the view, where nothing keeps the click) until the mouse is captured. */
async function capture(page) {
    for (let i = 0; i < 6; i++) {
        if (await locked(page)) return true;
        await page.mouse.click(VIEW.width / 2, VIEW.height / 2 + 40);
        await settle(page, 400);
        if (await locked(page)) return true;
        await settle(page, 900); // the browser refuses a lock asked for too soon after a release
    }
    return false;
}

/** The pause menu as the pilot sees it: the items shown, the "More" line, the rectangles. */
const pauseLook = (page) => page.evaluate(() => {
    const menu = document.querySelector('.pause-menu');
    if (!menu) return null;
    // an item inside a closed "More" keeps a layout box in Chrome (details content-visibility), so it counts as hidden by its details
    const shown = (e) => { const r = e.getBoundingClientRect(); return r.height > 0 && r.width > 0 && (e.tagName === 'SUMMARY' || !e.closest('details:not([open])')); };
    const items = [...menu.querySelectorAll('[data-action^="pause."]')];
    const vis = items.filter(shown);
    const more = menu.querySelector('[data-action=menu-more]');
    const rects = vis.map((e) => { const r = e.getBoundingClientRect(); return { id: e.getAttribute('data-action'), top: r.top, bottom: r.bottom, left: r.left, right: r.right }; });
    if (more && shown(more)) { const r = more.getBoundingClientRect(); rects.push({ id: 'menu-more', top: r.top, bottom: r.bottom, left: r.left, right: r.right }); }
    let overlap = null;
    for (let i = 0; i < rects.length && !overlap; i++) for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i], b = rects[j];
        if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) { overlap = [a.id, b.id]; break; }
    }
    // below the fold now (the panel scrolls: the drone card and the rows stand above the list; reported, not judged)
    const outside = rects.filter((r) => r.top < 0 || r.bottom > innerHeight + 0.5).map((r) => r.id);
    const span = rects.length ? Math.round(Math.max(...rects.map((r) => r.bottom)) - Math.min(...rects.map((r) => r.top))) : 0;
    return {
        total: items.length, shown: vis.length, ids: vis.map((e) => e.getAttribute('data-action')),
        more: more && shown(more) ? more.textContent.trim() : null, overlap, outside, span, view: innerHeight,
        locked: document.pointerLockElement !== null
    };
});

/** Settings as the pilot sees it: rows shown (a row hidden by the level has the hidden attribute), the "Show all" button. */
const settingsLook = (page) => page.evaluate(() => {
    const s = document.querySelector('[data-testid=settings]');
    if (!s) return null;
    const rows = [...s.querySelectorAll('.sr')];
    const all = s.querySelector('[data-action=settings-show-all]');
    const x = s.querySelector('[data-action=settings-close]');
    const xr = x?.getBoundingClientRect();
    return {
        total: rows.length, shown: rows.filter((r) => !r.hidden).length,
        showAll: all && !all.hidden && all.getBoundingClientRect().height > 0 ? all.textContent.trim() : null,
        cross: xr ? { w: Math.round(xr.width), h: Math.round(xr.height) } : null
    };
});
const uptiltRow = (page) => page.evaluate(() => {
    const r = document.querySelector('[data-testid="setting-camera.uptiltDeg"]');
    if (!r) return { found: false };
    const m = r.querySelector('[data-testid=setting-mark]');
    return { found: true, shown: !r.hidden && r.getBoundingClientRect().height > 0, mark: m && !m.hidden ? m.textContent.trim() : null };
});

async function openPause(page) {
    await page.keyboard.press('KeyP');
    await page.waitForSelector('.pause-menu [data-action="pause.continue"]', { timeout: 5000 }).catch(() => {});
    await settle(page);
}
async function openSettings(page) {
    await page.locator('.pause-menu [data-action="pause.settings"]').first().click({ timeout: 5000 }).catch(() => {});
    await page.waitForSelector('[data-testid=settings]', { timeout: 5000 }).catch(() => {});
    await settle(page);
}

const out = { what: "a new pilot's first minute with the mouse (menu4-first-minute-probe.mjs)", base, view: { ...VIEW, deviceScaleFactor: 1.25 }, browser: { kind: pick.kind, version: browser.version() }, pilots: {} };

// ---- pilot "first": the whole minute, step by step
{
    console.log('pilot first');
    const { ctx, page } = await fresh();
    const r = out.pilots.first = {};
    r.ask = await page.evaluate(() => ({ answers: [...document.querySelectorAll('[data-action^="warning-"]')].map((b) => b.getAttribute('data-action')), question: document.querySelector('#level-ask-q')?.textContent ?? null }));
    check('ask: the notice asks the question with three answers', r.ask.answers.length === 3 && !!r.ask.question, r.ask);
    if (shotDir) await page.screenshot({ path: `${shotDir}/menu4-ask.png` });
    const had = await answer(page, 'warning-first');
    check('answer: a click on "Never. Keep it simple" goes on to the flight', had, { answered: had ? 'warning-first' : 'warning-ok (no such answer)' });
    r.flow = await keyboardAndCard(page);
    check('capture: a click into the scene takes the mouse', await capture(page), r.flow);
    await openPause(page);
    r.pause = await pauseLook(page);
    const p = r.pause;
    check('pause: P frees the mouse and shows few items with "More (n)" holding the rest', !!p && !p.locked && p.shown <= 12 && !!p.more && p.total - p.shown >= 10, p && { shown: p.shown, total: p.total, more: p.more, locked: p.locked });
    check('fits: the list of items shown is shorter than the 730 px view and none lies over another', !!p && p.span > 0 && p.span <= p.view && p.overlap === null, p && { span: p.span, view: p.view, overlap: p.overlap, belowTheFold: p.outside });
    if (shotDir) await page.screenshot({ path: `${shotDir}/menu4-pause-first.png` });
    if (p?.more) await page.locator('[data-action=menu-more]').click();
    await settle(page);
    const after = await pauseLook(page);
    r.more = after && { shown: after.shown, total: after.total };
    check('more: a click on "More (n)" shows every item', !!p?.more && !!after && after.shown === after.total, r.more);
    await openSettings(page);
    r.settings = await settingsLook(page);
    const s = r.settings;
    check('settings: fewer rows than the full list and a "Show all settings (n more)" button', !!s && s.shown < s.total && !!s.showAll, s);
    if (shotDir) await page.screenshot({ path: `${shotDir}/menu4-settings-first.png` });
    const search = page.locator('[data-testid=settings-search]');
    await search.click().catch(() => {});
    await page.keyboard.type('uptilt');
    await settle(page);
    r.search = await uptiltRow(page);
    check('search: "uptilt" shows the camera uptilt row marked "In the full menu"', r.search.shown && !!r.search.mark, r.search);
    await search.fill('').catch(() => {});
    await settle(page, 300);
    await page.locator('[data-action=settings-show-all]').click({ timeout: 3000 }).catch(() => {});
    await settle(page);
    r.showAll = await settingsLook(page);
    check('showAll: a click on "Show all settings" shows every row', !!s?.showAll && !!r.showAll && r.showAll.shown === r.showAll.total, r.showAll);
    const crossOk = !!s?.cross && s.cross.w >= 44 && s.cross.h >= 44;
    await page.locator('[data-action=settings-close]').click({ timeout: 3000 }).catch(() => {});
    await settle(page);
    const closed = !(await visible(page, '[data-testid=settings]'));
    if (await visible(page, '[data-action="pause.continue"]')) await page.locator('[data-action="pause.continue"]').click();
    await settle(page);
    const again = await capture(page);
    check('close: the 44 px cross closes Settings and a click into the scene takes the mouse again', crossOk && closed && again, { cross: s?.cross, closed, locked: again });
    r.errors = page.errors;
    check('first: no page error', page.errors.length === 0, page.errors);
    await ctx.close();
}

// ---- pilots "sim" and "expert": the answer, the pause menu and Settings, counted
for (const [level, action] of [['sim', 'warning-sim'], ['expert', 'warning-ok']]) {
    console.log(`pilot ${level}`);
    const { ctx, page } = await fresh();
    const r = out.pilots[level] = {};
    r.answered = await answer(page, action);
    r.flow = await keyboardAndCard(page);
    await capture(page);
    await openPause(page);
    r.pause = await pauseLook(page);
    await openSettings(page);
    r.settings = await settingsLook(page);
    r.errors = page.errors;
    await ctx.close();
}
{
    const f = out.pilots.first, si = out.pilots.sim, ex = out.pilots.expert;
    const pc = [f.pause?.shown, si.pause?.shown, ex.pause?.shown], sc = [f.settings?.shown, si.settings?.shown, ex.settings?.shown];
    check('levels: the three pilots see three different counts in the pause menu and in Settings', si.answered && new Set(pc).size === 3 && new Set(sc).size === 3 && pc[0] < pc[1] && pc[1] < pc[2] && sc[0] < sc[1] && sc[1] < sc[2], { pause: pc, settings: sc });
    check('expert: today\'s full menus (no "More", no "Show all settings")', !!ex.pause && ex.pause.more === null && ex.pause.shown === ex.pause.total && !!ex.settings && ex.settings.showAll === null && ex.settings.shown === ex.settings.total, { pause: ex.pause && { shown: ex.pause.shown, total: ex.pause.total, more: ex.pause.more }, settings: ex.settings });
    check('sim, expert: no page error', si.errors.length === 0 && ex.errors.length === 0, [...si.errors, ...ex.errors]);
}

await browser.close();
const pass = checks.every((c) => c.pass);
out.pass = pass;
out.checks = checks;
writeFileSync(outFile, JSON.stringify(out, null, 2));
console.log(JSON.stringify({ pass, base, checks }));
process.exit(pass ? 0 : 1);
