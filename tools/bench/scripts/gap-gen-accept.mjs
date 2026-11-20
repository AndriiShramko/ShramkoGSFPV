// Lane gap-gen, stage S3: the owner's own scale (brief lines 537-539, 563, 565, 579-581), with the MOUSE at 1536x730,
// device scale 1.25. Built on gen4-accept-probe.mjs (its page reader and its mouse path to the Generate dialog).
// Steps (each {step, name, pass, detail}):
//   1 the skull 5dfeb49b: a click into the scene (pointer lock), Escape, Scene size x15 with the pause menu's own slider
//   2 the menu's 'Generate a course', Beginner, Compact, Build: a course comes, no 'no course fits' text, >= 5 gates, the
//     start pose and gate 1 within REACH_M of the skull (read from the laid track, CourseHook.inUse, so the live site is
//     judged the same way: |pos - SKULL_SCAN| x the scene size, across the ground)
//   3 the micro-greens ab5efa0e at x15 the same way: a course, no refusal, >= 5 gates, gates under the leaves' top
//     (plan stats underTopShare >= 0.8)
//   4 Hallstatt 1994c65c at x1: Pro, Whole scene (wide), Build: a course, no refusal
// Usage: node tools/bench/scripts/gap-gen-accept.mjs <base with /en> <out.json>
// env: COURSE_MS (the wait for a course, default 240000). Read-only on any site: nothing is saved, sent or created (no
// save button is pressed; a generated course and the Scene size live only in the tab's own profile). Exit 1 on a failure.
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { pickBrowser } from '../src/chrome.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [base, outFile] = process.argv.slice(2);
if (!base || !outFile) { console.error('usage: gap-gen-accept.mjs <base with /en> <out.json>'); process.exit(2); }
const COURSE_MS = Number(process.env.COURSE_MS ?? 240000);
const SIZE = 15;
/** the skull's place in the scan's own units: analyzeScan's core of 5dfeb49b ([-750.809, 139.5, -115.300] flown at x15 by
 *  the transform [15, 0, 0, 0]); a distance in flown m is |p - SKULL_SCAN| x the scene size whatever the size's centre */
const SKULL_SCAN = [-50.054, 9.3, -7.687];
/** the start pose and gate 1 within this many flown m of the skull at x15 (the skull itself is about 3 m across there;
 *  the audit's beginner plans start 6.2-6.7 m from it) */
const REACH_M = Number(process.env.SKULL_REACH_M ?? 8);
const GATES_MIN = 5, UNDER_TOP_MIN = 0.8;
const REFUSAL = /No course fits|No gate your drone passes fits/i;
const pick = pickBrowser({ expected: chromium.executablePath() });
const browser = await chromium.launch({ ...pick.launch, headless: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = { base, viewport: '1536x730@1.25', steps: [], errors: [] };
const save = () => writeFileSync(outFile, JSON.stringify(out, null, 1));
const check = (step, name, pass, detail) => {
    out.steps.push({ step, name, pass, detail });
    console.log(`${step} ${name} ${pass ? 'PASS' : 'FAIL'} ${JSON.stringify(detail).slice(0, 400)}`);
    save();
};

/** In the page: the course, the dialog, the box, the visible texts, the scene size. */
const READ = () => {
    const g = window.__gsfpv || {};
    const c = g.course;
    const box = document.querySelector('[data-testid=gen-progress]');
    let bm = null;
    try { bm = c && c.box ? c.box() : null; } catch { bm = null; }
    const shown = (el) => !!el && !el.hidden && (el.offsetParent !== null || getComputedStyle(el).position === 'fixed');
    const texts = Array.from(document.querySelectorAll('.hud-note, [data-testid=gen-noroom], [data-testid=gen-noroom-text], .toast, [role=status], [role=alert]'))
        .filter(shown).map((el) => (el.textContent || '').trim().slice(0, 200)).filter(Boolean);
    return {
        gates: c ? c.gates : 0, drawn: c ? c.drawn : 0,
        plan: c ? c.plan ?? null : null, request: c ? c.request ?? null : null,
        dialog: !!document.querySelector('[data-testid=gen-dialog]'),
        box: bm ? bm.kind : box && shown(box) ? 'progress' : null,
        texts,
        scale: g.scale ? g.scale.size() : null,
        laid: (() => { try { const u = c && c.inUse ? c.inUse() : null; return u ? { start: u.track.start ? u.track.start.pos : null, gates: u.track.gates.map((x) => x.pos) } : null; } catch { return null; } })()
    };
};

async function openPage(id) {
    const ctx = await browser.newContext({ viewport: { width: 1536, height: 730 }, deviceScaleFactor: 1.25 });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => out.errors.push(`${id}: ${String(e.message).slice(0, 160)}`));
    await page.goto(`${base}/fly/?scene=${id}&nowarn=1&set.input.howToFly=false&set.input.play=easy&render=off`, { waitUntil: 'load', timeout: 120000 });
    await page.waitForFunction(() => ['ready', 'error'].includes(window.__gsfpv && window.__gsfpv.status), null, { timeout: 300000 });
    const kb = await page.waitForSelector('.screen.radio [data-action=radio-keyboard]', { timeout: 6000 }).then(() => true, () => false);
    if (kb) await page.locator('[data-action=radio-keyboard]').click();
    else { const x = page.locator('.screen.radio [data-action=radio-close]'); if (await x.count()) await x.first().click(); }
    await page.waitForFunction(() => !document.querySelector('.screen.radio'), null, { timeout: 15000 }).catch(() => 0);
    await page.waitForFunction(() => { const w = window.__gsfpv && window.__gsfpv.walls; return !w || w.state !== 'checking'; }, null, { timeout: 120000 }).catch(() => 0);
    await page.waitForFunction(() => !!(window.__gsfpv && window.__gsfpv.session && window.__gsfpv.session.baseCollision), null, { timeout: 180000 }).catch(() => 0);
    // the owner's-size note (a scene with a curated size): closed with its own button, as a person does
    const hint = page.locator('[data-action=macro-hint-ok]');
    if (await hint.count()) await hint.first().click().catch(() => 0);
    await sleep(1000);
    return { ctx, page };
}

/** a click into the scene (the pointer lock), then Escape: the pause menu */
async function pauseMenu(page) {
    await page.mouse.click(768, Math.round(730 * 0.6));
    await sleep(500);
    const lock = await page.evaluate(() => !!document.pointerLockElement);
    await page.keyboard.press('Escape');
    const menu = await page.waitForSelector('.pause-menu', { timeout: 8000 }).then(() => true, () => false);
    return { lock, menu };
}

/** the menu's Scene size slider, by the mouse: a click at x SIZE's place on its log2 track, then the arrow keys on the
 *  focused slider (the slider's own 0.01 steps) until the row says SIZE within 1 % */
async function sceneSize(page, want) {
    const how = await pauseMenu(page);
    const sl = page.locator('[data-testid=scene-size-slider]');
    if (!(await sl.count())) return { ...how, slider: false, size: await page.evaluate(() => window.__gsfpv.scale?.size() ?? null) };
    await sl.first().scrollIntoViewIfNeeded();
    const b = await sl.first().boundingBox();
    const [lo, hi] = await sl.first().evaluate((el) => [Number(el.min), Number(el.max)]);
    const f = (Math.log2(want) - lo) / (hi - lo);
    await page.mouse.click(b.x + 8 + f * (b.width - 16), b.y + b.height / 2);
    await sleep(700);
    for (let i = 0; i < 60; i++) {
        const s = await page.evaluate(() => window.__gsfpv.scale.size());
        if (Math.abs(s - want) / want <= 0.01) break;
        await page.keyboard.press(s < want ? 'ArrowRight' : 'ArrowLeft');
        await sleep(200);
    }
    await sleep(800);
    return { ...how, slider: true, size: await page.evaluate(() => window.__gsfpv.scale.size()) };
}

/** the menu's course item, then the dialog's level, spread and Build (the live site before this train has no dialog:
 *  the item builds at once, and the answer is judged the same) */
async function generate(page, level, spread, menuOpen) {
    if (!menuOpen) await pauseMenu(page);
    const item = page.locator('.pause-menu [data-action="pause.course"]');
    const has = (await item.count()) > 0;
    if (has) await item.first().click();
    const dialog = await page.waitForSelector('[data-testid=gen-dialog]', { timeout: 4000 }).then(() => true, () => false);
    const pressed = [];
    if (dialog) {
        for (const act of [`gen-level-${level}`, `gen-spread-${spread}`, 'gen-build']) {
            const b = page.locator(`[data-testid=gen-dialog] [data-action="${act}"]`);
            const n = await b.count();
            if (n) { await b.first().click(); await sleep(250); }
            pressed.push(n > 0);
        }
    }
    const t0 = Date.now();
    let s;
    for (;;) {
        s = await page.evaluate(READ);
        const refused = s.box === 'noRoom' || s.texts.some((x) => REFUSAL.test(x));
        if ((s.gates > 0 && s.drawn > 0) || refused || Date.now() - t0 > COURSE_MS) break;
        await sleep(200);
    }
    await sleep(1500); // a refusal note that follows the course's own line
    s = await page.evaluate(READ);
    const refusal = s.texts.find((x) => REFUSAL.test(x)) ?? (s.box === 'noRoom' ? 'noRoom box' : null);
    return { item: has, dialog, pressed, ms: Date.now() - t0, s, refusal };
}

const statsOf = (s) => (s.plan && s.plan.ok ? s.plan.stats : null);
const r3 = (n) => (typeof n === 'number' ? Math.round(n * 1000) / 1000 : n);

try {
    // 1-2 the skull at x15, Beginner compact
    {
        const { ctx, page } = await openPage('5dfeb49b');
        const sz = await sceneSize(page, SIZE);
        check(1, 'skull: Scene size x15 by the menu slider', sz.lock && sz.slider && Math.abs(sz.size - SIZE) / SIZE <= 0.01, sz);
        const g = await generate(page, 'beginner', 'compact', true);
        const st = statsOf(g.s);
        const reach = REACH_M;
        const L = g.s.laid, sc = g.s.scale ?? 1;
        const toSkull = (q) => (q ? r3(Math.hypot(q[0] - SKULL_SCAN[0], q[2] - SKULL_SCAN[2]) * sc) : null);
        const laid = L && { startM: toSkull(L.start), gatesM: L.gates.map(toSkull) };
        const near = !!laid && laid.startM !== null && laid.startM <= reach && laid.gatesM.length > 0 && laid.gatesM[0] <= reach;
        check(2, 'skull x15 beginner compact: a course, no refusal, >= 5 gates, the start and gate 1 at the skull',
            !g.refusal && g.s.gates >= GATES_MIN && g.s.drawn > 0 && near,
            { dialog: g.dialog, pressed: g.pressed, gates: g.s.gates, refusal: g.refusal, texts: g.s.texts, ms: g.ms, scale: g.s.scale, reach, laid,
              stats: st && { kind: st.kind, gates: st.gates, startToCoreM: r3(st.startToCoreM), finishToCoreM: r3(st.finishToCoreM), outside: st.outside, goodShare: r3(st.goodShare) },
              eased: g.s.plan && g.s.plan.eased, shrunk: g.s.plan && g.s.plan.shrunk });
        await ctx.close();
    }
    // 3 the micro-greens at x15, Beginner compact
    {
        const { ctx, page } = await openPage('ab5efa0e');
        const sz = await sceneSize(page, SIZE);
        const g = await generate(page, 'beginner', 'compact', true);
        const st = statsOf(g.s);
        check(3, 'micro-greens x15 beginner compact: a course, no refusal, >= 5 gates, under the leaves\' top',
            Math.abs(sz.size - SIZE) / SIZE <= 0.01 && !g.refusal && g.s.gates >= GATES_MIN && !!st && st.outside === 0 && st.underTopShare >= UNDER_TOP_MIN,
            { size: sz.size, dialog: g.dialog, gates: g.s.gates, refusal: g.refusal, texts: g.s.texts, ms: g.ms,
              stats: st && { kind: st.kind, gates: st.gates, underTopShare: r3(st.underTopShare), startToCoreM: r3(st.startToCoreM), finishToCoreM: r3(st.finishToCoreM), outside: st.outside } });
        await ctx.close();
    }
    // 4 Hallstatt at x1, Pro, the whole scene
    {
        const { ctx, page } = await openPage('1994c65c');
        const scale = await page.evaluate(() => window.__gsfpv.scale?.size() ?? null);
        const g = await generate(page, 'pro', 'wide', false);
        const st = statsOf(g.s);
        check(4, 'Hallstatt x1 pro whole scene: a course, no refusal', scale === 1 && !g.refusal && g.s.gates >= 1 && g.s.drawn > 0,
            { scale, dialog: g.dialog, gates: g.s.gates, refusal: g.refusal, texts: g.s.texts, ms: g.ms, stats: st && { kind: st.kind, gates: st.gates, outside: st.outside } });
        await ctx.close();
    }
} catch (e) { out.fail = String(e).slice(0, 300); console.log('FAIL', out.fail); }
const failed = out.steps.filter((q) => !q.pass).map((q) => q.step);
out.verdict = { pass: !out.fail && failed.length === 0 && out.steps.length === 4, failed };
save();
console.log(JSON.stringify(out.verdict));
await browser.close();
process.exit(out.verdict.pass ? 0 : 1);
