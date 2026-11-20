// Lane gap-save, stage S2 (docs/wip/gap-save.md): a course made at any Scene size saves under the pilot's name. The pilot's
// own path with the MOUSE at 1536x730, device scale 1.25, against a local release build and the local API:
//   open    the scene, Keyboard on the Controls screen, a click into the scene (the pointer lock)
//   whoop   key P, Drone, the 65 mm whoop's card, Fly
//   x15     key P, the Scene size slider dragged to x15 by the mouse
//   s15     Shift+B, Course menu, New empty course, Add gate on, three clicks into the scene, the title 'gap-save x15',
//           the name, Save: the page says saved (201) and GET /api/tracks?scene=<scan> on the local API lists it
//   s15gen  the same at x15 with the Course menu's Generate a new course (the whoop's own small gates), title 'gap-save x15 gen'
//   s100    the same as s15 at x100 (the slider's right end), title 'gap-save x100'
//   s5in    the 5 inch (Drone, its card), Scene size Reset (x1), the same as s15, title 'gap-save 5in x1'
//   node tools/bench/scripts/gap-save-accept.mjs <dist> <scan> <out.json>
// The probe serves the dist folder (serve-csp.mjs, port PORT or 6760) and starts the local API (API_DIR/server.py, API_DIR
// defaults to this repository's apps/api; port API_PORT or 6761, a fresh DATA_DIR under TEMP_DIR). It never takes an https
// address: every step stores a course, so nothing of it runs against the live site. ?render=off: the scan is not drawn.
// Prints one JSON verdict, exit 1 when a step fails.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pickBrowser } from '../src/chrome.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [where, scan, outPath] = process.argv.slice(2);
if (!where || !scan || !outPath || /^https?:/.test(where)) {
    console.error('usage: gap-save-accept.mjs <dist folder> <scan> <out.json> (a local build only: every step saves)');
    process.exit(2);
}
const env = process.env;
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const API_DIR = resolve(env.API_DIR || join(REPO, 'apps', 'api'));
const PORT = Number(env.PORT || 6760);
const API_PORT = Number(env.API_PORT || 6761);
const TEMP = env.TEMP_DIR || 'U:/Temp/gsfpv-train4/gap-save';
const base = `http://localhost:${PORT}/en`;
const API = `http://127.0.0.1:${API_PORT}`;
const W = 1536, H = 730, DSF = 1.25;
const NAME = 'Andrii Shramko';
const WHOOP = 'meteor65pro-1s', FIVE = 'nazgulf5v3-6s';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const res = { address: base, api: API, apiDir: API_DIR, dist: resolve(where), scan, size: [W, H], dsf: DSF, date: new Date().toISOString(), steps: {}, posts: [] };
const fails = [];
const judge = (step, ok, why) => { res.steps[step] = { ok: !!ok, ...why }; if (!ok) fails.push(step); console.log(`${step}: ${ok ? 'PASS' : 'FAIL'} ${JSON.stringify(why).slice(0, 300)}`); };

const kids = [];
const DATA = join(TEMP, `api-data-${Date.now()}`);
async function until(fn, ok, ms, step = 400) {
    const t0 = Date.now();
    let v = await fn();
    while (!ok(v) && Date.now() - t0 < ms) { await sleep(step); v = await fn(); }
    return { ok: ok(v), v, ms: Date.now() - t0 };
}
const health = () => fetch(`${API}/api/health`).then((r) => r.ok).catch(() => false);
const listed = (title) => fetch(`${API}/api/tracks?scene=${scan}&sort=new`).then((r) => r.text()).then((t) => t.includes(title)).catch(() => false);

const SNAP = `(() => {
    const h = window.__gsfpv || {}; const c = h.course || {}; const e = c.editor || {};
    let v = null; try { v = window.__gsfpvEditView ? window.__gsfpvEditView() : null; } catch (x) { v = null; }
    const tb = document.querySelector('.ce-topbar');
    const s = v && v.edit4 ? v.edit4.s : null;
    return { status: h.status ?? null, open: !!e.open, said: String(e.said || '').slice(0, 220),
        topLine: tb ? String((tb.querySelector('.ce-tb-line') || {}).textContent || '').slice(0, 260) : null,
        saved: c.saved ?? null, size: h.scale ? h.scale.size() : null,
        egates: v && v.course ? v.course.gates.length : null, shapes: v && v.course ? v.course.gates.slice(0, 3).map((g) => g.shape) : null,
        save: s && s.save ? { status: s.save.problem ? s.save.problem.status : null, key: s.save.key } : null,
        lock: document.pointerLockElement ? document.pointerLockElement.tagName : null };
})()`;

const pick = pickBrowser({ expected: chromium.executablePath() });
let browser = null;
const log = [];
try {
    kids.push(spawn(process.execPath, [join(REPO, 'tools', 'bench', 'scripts', 'serve-csp.mjs'), resolve(where), String(PORT)], { env: { ...env, API_PROXY: API }, stdio: 'ignore' }));
    mkdirSync(DATA, { recursive: true });
    kids.push(spawn('python', [join(API_DIR, 'server.py')], { env: { ...env, DATA_DIR: DATA, PORT: String(API_PORT), TG_BOT_TOKEN: '', TG_CHAT_ID: '', MIN_FREE_GB: '0' }, stdio: 'ignore' }));
    if (!(await until(health, (v) => v, 30000, 300)).ok) throw new Error('the local API did not answer /api/health');
    if (!(await until(() => fetch(`${base}/fly/`).then((r) => r.ok).catch(() => false), (v) => v, 30000, 300)).ok) throw new Error('the local site did not answer');

    browser = await chromium.launch({ ...pick.launch, headless: true });
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DSF });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => log.push(`pageerror: ${e.message}`.slice(0, 300)));
    page.on('response', (r) => { const q = r.request(); if (q.method() === 'POST' && new URL(r.url()).pathname.startsWith('/api/tracks')) res.posts.push({ path: new URL(r.url()).pathname, status: r.status(), at: Date.now() }); });
    const snap = () => page.evaluate(SNAP);
    const boxOf = (sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e || !e.getClientRects().length || e.closest('[hidden]')) return null; const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, l: b.left, r: b.right, w: b.width, h: b.height, disabled: !!e.disabled, text: (e.textContent || '').trim().slice(0, 160) }; }, sel);
    const inView = (b) => b && b.y > 0 && b.y < H && b.x > 0 && b.x < W;
    async function click(x, y, after = 600) { await page.mouse.move(x, y, { steps: 4 }); await page.mouse.click(x, y); await sleep(after); }
    async function clickSel(sel, after = 600) { const b = await boxOf(sel); if (!b) return null; await click(b.x, b.y, after); return b; }
    /** the selector brought into view by the mouse wheel over the screen (the pilot scrolls), then clicked */
    async function wheelTo(sel, after = 800) {
        for (let n = 0; n < 20; n++) {
            const b = await boxOf(sel);
            if (inView(b)) { await click(b.x, b.y, after); return b; }
            await page.mouse.move(W / 2, H / 2);
            await page.mouse.wheel(0, b && b.y < 0 ? -300 : 300);
            await sleep(250);
        }
        return null;
    }
    const panelOpen = async () => !!(await boxOf('[data-testid=scene-size]')) || !!(await boxOf('#ui .pause-menu'));
    async function openPause() {
        if (!(await panelOpen())) await page.keyboard.press('KeyP');
        return (await until(panelOpen, (v) => v, 8000, 250)).ok;
    }
    async function closePause() {
        if (await panelOpen()) await page.keyboard.press('KeyP');
        await until(panelOpen, (v) => !v, 5000, 250);
        await sleep(500);
    }
    /** a pause menu item (under More when it is folded there) */
    async function menuItem(action) {
        let b = await boxOf(`[data-action="${action}"]`);
        if (!b) await clickSel('[data-action="menu-more"]', 500);
        b = await wheelTo(`[data-action="${action}"]`);
        return b;
    }

    async function pickDrone(id) {
        await openPause();
        const item = await menuItem('pause.drone');
        const card = `.drone-card[data-preset="${id}"]`;
        await until(() => boxOf(card), (b) => !!b, 15000, 300);
        const fly = await wheelTo(`${card} [data-action="drone-pick"]`, 1500);
        const keep = fly ? null : await wheelTo(`${card} [data-action="drone-keep"]`, 1000);
        const gone = await until(() => boxOf('.screen.drones'), (b) => !b, 10000, 300);
        await closePause();
        const stored = await page.evaluate((d) => Object.values(localStorage).some((v) => typeof v === 'string' && v.includes(d)), id);
        return { menu: !!item, by: fly ? 'Fly' : keep ? 'already in use' : null, closed: gone.ok, stored };
    }

    /** the Scene size row's slider set by mouse clicks on its track (each click corrected by what the row then shows) */
    async function setSize(want) {
        await openPause();
        const sl = '[data-testid=scene-size-slider]';
        const b = await wheelTo(sl, 300);
        if (!b) return { ok: false, why: 'no Scene size row' };
        const span = await page.evaluate((s) => { const e = document.querySelector(s); return [Number(e.min), Number(e.max)]; }, sl);
        const target = want === 'max' ? span[1] : want === 'reset' ? 0 : Math.log2(want);
        let x = want === 'max' ? b.r - 1 : b.l + ((target - span[0]) / (span[1] - span[0])) * b.w;
        const tries = [];
        if (want === 'reset') await clickSel('[data-testid=scene-size] [data-action="scale-reset"]', 800);
        else {
            for (let n = 0; n < 5; n++) {
                await click(Math.max(b.l + 1, Math.min(b.r - 1, x)), b.y, 800);
                const s = (await snap()).size;
                tries.push(Math.round(s * 1000) / 1000);
                const err = Math.log2(s) - target;
                if (Math.abs(err) < 0.06 || want === 'max') break;
                x -= (err / (span[1] - span[0])) * b.w;
            }
        }
        const size = (await snap()).size;
        const shown = (await boxOf('[data-testid=scene-size-value]'))?.text ?? null;
        await closePause();
        const goal = want === 'max' ? 100 : want === 'reset' ? 1 : want;
        return { ok: Math.abs(Math.log2(size / goal)) < 0.07, size, shown, tries };
    }

    async function openEditor() {
        let s = await snap();
        if (!s.open) {
            await click(W / 2, H / 2, 800);
            await page.keyboard.press('Shift+KeyB');
            s = (await until(snap, (x) => x.open && x.egates !== null, 30000, 400)).v;
            await sleep(1200);
        }
        return s.open;
    }
    async function closeEditor() {
        if (!(await snap()).open) return;
        await clickSel('.ce-topbar [data-top="exit"]', 800);
        const d = await until(snap, (x) => !x.open, 8000, 300);
        if (!d.ok) { await page.keyboard.press('Escape'); await until(snap, (x) => !x.open, 5000, 300); }
        // a question (leave without saving?) answered Yes when it shows
        await clickSel('.life-ask [data-ask="yes"]', 600);
        await sleep(600);
    }
    /** the Course menu's item: 'new' or 'generate', and Yes when the page asks first */
    async function courseMenu(item) {
        await clickSel('.ce-topbar [data-top="course"]', 500);
        const b = await clickSel(`.ce-menu [data-item="${item}"]`, 800);
        const asked = await boxOf('.life-ask [data-ask="yes"]');
        if (asked) await click(asked.x, asked.y, 800);
        return { item: !!b, asked: asked?.text ?? null };
    }
    /** three gates by clicks into the scene with Add gate on (pressed again when a click turned it off) */
    async function threeGates() {
        const spots = [[0.32, 0.55], [0.5, 0.45], [0.68, 0.55]];
        const by = [];
        for (const [fx, fy] of spots) {
            const pressed = await page.evaluate(() => document.querySelector('.ce-topbar [data-top="add"]')?.getAttribute('aria-pressed') === 'true');
            if (!pressed) await clickSel('.ce-topbar [data-top="add"]', 400);
            const n0 = (await snap()).egates ?? 0;
            await click(W * fx, H * fy, 900);
            const n1 = (await snap()).egates ?? 0;
            by.push(n1 - n0);
        }
        const s = await snap();
        return { gates: s.egates, added: by, shapes: s.shapes, line: s.topLine };
    }
    /** title and name typed into the editor's window, then the top bar's Save; the answer read off the page and the API */
    async function saveAs(title) {
        const opened = await page.evaluate(() => document.querySelector('.course-editor')?.classList.contains('ce-open') ?? false);
        if (!opened) await clickSel('.course-editor .ce-drawer', 500);
        const tb = await wheelTo('.course-editor .ce-course-title', 200);
        if (tb) { await page.keyboard.press('Control+A'); await page.keyboard.type(title); }
        const nb = await wheelTo('.course-editor .ce-name', 200);
        if (nb) { await page.keyboard.press('Control+A'); await page.keyboard.type(NAME); }
        const before = (await snap()).saved;
        const t0 = Date.now();
        await clickSel('.ce-topbar [data-top="save"]', 400);
        const done = await until(snap, (x) => (x.saved && x.saved !== before) || (x.save && x.save.key) || res.posts.some((p) => p.at >= t0 && p.status >= 400), 20000, 300);
        await sleep(800);
        const s = await snap();
        const posts = res.posts.filter((p) => p.at >= t0).map((p) => p.status);
        const inList = await listed(title);
        return { ok: posts.includes(201) && inList && /saved/i.test(`${s.topLine} ${s.said}`), title, typed: { title: !!tb, name: !!nb }, posts, listed: inList, saved: s.saved, line: s.topLine, said: s.said, problem: s.save, ms: done.ms };
    }

    // ---- open
    await page.goto(`${base}/fly/?scene=${scan}&render=off&nowarn=1`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    const ready = await until(snap, (s) => s.status === 'ready' || s.status === 'error', 300000, 1000);
    const KB = '.screen.radio [data-action="radio-keyboard"]';
    if (await page.waitForSelector(KB, { timeout: 15000 }).then(() => true).catch(() => false)) await clickSel(KB, 1500);
    await click(W / 2, H / 2, 900);
    const lock = (await snap()).lock;
    judge('open', ready.v.status === 'ready', { status: ready.v.status, ms: ready.ms, lock });
    if (ready.v.status !== 'ready') throw new Error('page not ready');

    // ---- the whoop at x15: an empty course with three gates, then a generated one
    const whoop = await pickDrone(WHOOP);
    judge('whoop', whoop.by !== null, whoop);
    const x15 = await setSize(15);
    judge('x15.size', x15.ok, x15);
    const e15 = await openEditor();
    const n15 = await courseMenu('new');
    const g15 = await threeGates();
    const s15 = await saveAs('gap-save x15');
    judge('s15.emptySaved', e15 && g15.gates === 3 && s15.ok, { editor: e15, menu: n15, gates: g15, save: s15 });
    const m15 = await courseMenu('generate');
    const gen = await until(snap, (x) => (x.egates ?? 0) > 3 || /course fits/i.test(`${x.topLine} ${x.said}`), 300000, 1000);
    await sleep(1500);
    const sg = await saveAs('gap-save x15 gen');
    judge('s15gen.generatedSaved', gen.ok && (gen.v.egates ?? 0) > 3 && sg.ok, { menu: m15, gates: gen.v.egates, shapes: gen.v.shapes, line: gen.v.topLine, ms: gen.ms, save: sg });
    await closeEditor();

    // ---- the whoop at x100
    const x100 = await setSize('max');
    judge('x100.size', x100.ok, x100);
    const e100 = await openEditor();
    const n100 = await courseMenu('new');
    const g100 = await threeGates();
    const s100 = await saveAs('gap-save x100');
    judge('s100.emptySaved', e100 && g100.gates === 3 && s100.ok, { editor: e100, menu: n100, gates: g100, save: s100 });
    await closeEditor();

    // ---- the 5 inch at x1
    const five = await pickDrone(FIVE);
    const x1 = await setSize('reset');
    judge('x1.size', five.by !== null && x1.ok, { drone: five, size: x1 });
    const e1 = await openEditor();
    const n1 = await courseMenu('new');
    const g1 = await threeGates();
    const s1 = await saveAs('gap-save 5in x1');
    judge('s5in.emptySaved', e1 && g1.gates === 3 && s1.ok, { editor: e1, menu: n1, gates: g1, save: s1 });
} catch (e) {
    res.error = String(e).slice(0, 400);
    fails.push('error');
}
res.fails = fails;
res.log = log.slice(0, 30);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(res, null, 1));
await browser?.close().catch(() => {});
for (const k of kids) k.kill();
console.log(JSON.stringify({ verdict: fails.length ? 'FAIL' : 'PASS', address: base, apiDir: API_DIR, fails, steps: Object.fromEntries(Object.entries(res.steps).map(([k, v]) => [k, v.ok ? 'PASS' : 'FAIL'])), error: res.error ?? null }));
process.exit(fails.length ? 1 : 0);
