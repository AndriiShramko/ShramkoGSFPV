// Lane gap-save, stage S2 (docs/wip/gap-save.md): a course made at any Scene size saves under the pilot's name. The pilot's
// own path with the MOUSE at 1536x730, device scale 1.25, against a local release build and the local API:
//   open    the scene, Keyboard on the Controls screen, a click into the scene (the pointer lock)
//   whoop   key P, Drone, the 65 mm whoop's card, Fly
//   x15     key P, the Scene size slider dragged to x15 by the mouse
//   s15     Shift+B, Course menu, New empty course, Add gate on, three clicks into the scene, the title 'gap-save x15',
//           the name, Save: the page says saved (201) and GET /api/tracks?scene=<scan> on the local API lists it
//   s15gen  the same at x15 with the Course menu's Generate a new course (the whoop's own small gates), title 'gap-save x15 gen'
//   review.reopenSmall  (the independent review's step) Course menu, Courses, Open on 'gap-save x15', then on 'gap-save x15
//           small': the page loads the stored x15 course back with its 0.039-unit gates, and the API holds it at scale ~15
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
        saved: c.saved ?? null, problem: c.problem ?? null, hud: String((document.querySelector(".hud-flash, .flash, [data-testid=hud-flash]") || {}).textContent || "").slice(0, 200), size: h.scale ? h.scale.size() : null,
        egates: v && v.course ? v.course.gates.length : null, scr: v ? v.gates : null, shapes: v && v.course ? v.course.gates.slice(0, 3).map((g) => g.shape) : null,
        tr: v && v.course ? v.course.transform : null, save: s && s.save ? { status: s.save.problem ? s.save.problem.status : null, key: s.save.key } : null,
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
    /** the box once it stood still for 400 ms (the pause panel's 3D drone card loads late and moves the rows below it) */
    async function stableBox(sel, ms = 6000) {
        let a = await boxOf(sel);
        for (const t0 = Date.now(); Date.now() - t0 < ms; ) {
            await sleep(400);
            const b = await boxOf(sel);
            if (a && b && Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1) return b;
            a = b;
        }
        return a;
    }
    async function clickSel(sel, after = 600) { const b = await stableBox(sel, 2000); if (!b) return null; await click(b.x, b.y, after); return b; }
    /** the selector brought into view by the mouse wheel over the screen (the pilot scrolls), then clicked */
    async function wheelTo(sel, after = 800) {
        for (let n = 0; n < 20; n++) {
            const b = await stableBox(sel, 2000);
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
        const seen = fly ? null : await page.evaluate((c) => { const e = document.querySelector(c); if (!e) return 'no card'; const b = e.getBoundingClientRect(); return { card: [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)], buttons: [...e.querySelectorAll('button')].map((x) => x.dataset.action) }; }, card);
        const gone = await until(() => boxOf('.screen.drones'), (b) => !b, 10000, 300);
        await closePause();
        const stored = await page.evaluate((d) => Object.values(localStorage).some((v) => typeof v === 'string' && v.includes(d)), id);
        return { menu: !!item, by: fly ? 'Fly' : keep ? 'already in use' : null, closed: gone.ok, stored, seen };
    }

    /** the Scene size row's slider set by mouse clicks on its track (each click corrected by what the row then shows) */
    async function setSize(want) {
        await openPause();
        const sl = '[data-testid=scene-size-slider]';
        const b = await wheelTo(sl, 300);
        if (!b) return { ok: false, why: 'no Scene size row' };
        const span = await page.evaluate((s) => { const e = document.querySelector(s); return [Number(e.min), Number(e.max)]; }, sl);
        const target = want === 'max' ? span[1] : want === 'reset' ? 0 : Math.log2(want);
        let f = want === 'max' ? 1 : (target - span[0]) / (span[1] - span[0]);
        const tries = [];
        if (want === 'reset') await clickSel('[data-testid=scene-size] [data-action="scale-reset"]', 800);
        else {
            for (let n = 0; n < 5; n++) {
                const bb = (await stableBox(sl, 3000)) ?? b;
                const cx = Math.max(bb.l + 1, Math.min(bb.r - 1, bb.l + f * bb.w));
                const at = await page.evaluate(([px, py, s]) => { const e = document.elementFromPoint(px, py); const sl = document.querySelector(s); return { top: e ? `${e.tagName}.${e.className}`.slice(0, 60) : null, value: sl ? sl.value : null }; }, [cx, bb.y, sl]);
                await click(cx, bb.y, 800);
                const s = (await snap()).size;
                tries.push({ x: Math.round(cx), size: Math.round(s * 1000) / 1000, ...at, after: await page.evaluate((q) => document.querySelector(q)?.value ?? null, sl) });
                const err = Math.log2(s) - target;
                if (Math.abs(err) < 0.06 || want === 'max') break;
                f -= err / (span[1] - span[0]);
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
            // with no course yet the key makes one first and the editor opens on it (course.ts openEdit)
            const w = await until(snap, (x) => (x.open && x.egates !== null) || (x.problem !== null && x.problem !== undefined), 300000, 1000);
            s = w.v;
            res.editorOpen = [...(res.editorOpen || []), { open: s.open, ms: w.ms, problem: s.problem, hud: s.hud, line: s.topLine }];
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
    /**
     * three gates by clicks into the middle of the view with Add gate on (pressed again when a click turned it off); between
     * the clicks the pilot holds key W (the view forward) until the gate just set is behind the view, so the course goes on
     * the way he looks and every gate faces the way in
     */
    async function threeGates(shrink = 0) {
        const by = [], walked = [];
        for (let k = 0; k < 3; k++) {
            const pressed = await page.evaluate(() => document.querySelector('.ce-topbar [data-top="add"]')?.getAttribute('aria-pressed') === 'true');
            if (!pressed) await clickSel('.ce-topbar [data-top="add"]', 400);
            const n0 = (await snap()).egates ?? 0;
            await click(W * 0.5, H * (k === 0 ? 0.62 : 0.45), 900);
            const n1 = (await snap()).egates ?? 0;
            by.push(n1 - n0);
            for (let m = 0; m < shrink; m++) { await page.keyboard.press('Minus'); await sleep(120); }
            if (shrink) { await sleep(400); by.push({ shrunk: (await snap()).topLine?.slice(0, 80) ?? null }); }
            if (k === 2) break;
            const t0 = Date.now();
            await page.mouse.move(W * 0.5, H * 0.6);
            await page.keyboard.down('KeyW');
            const w = await until(snap, (x) => { const g = x.scr?.[n1 - 1]; return !g || g[2] <= 0; }, 10000, 100);
            await sleep(300);
            await page.keyboard.up('KeyW');
            await sleep(400);
            walked.push({ ms: Date.now() - t0, behind: w.ok });
        }
        if (walked.length) by.push({ walked });
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
        const settled = (x) => (x.saved && x.saved !== before) || (x.save && x.save.key) || res.posts.some((p) => p.at >= t0 && p.status >= 400);
        let done = await until(async () => ({ s: await snap(), fix: await boxOf('.course-editor .ce-fix-yes') }), (x) => settled(x.s) || !!x.fix, 20000, 300);
        // the offer of small corrections (lane edit4s): the pilot presses Correct and save
        const fix = done.v.fix ? done.v.fix.text : null;
        if (done.v.fix) {
            await click(done.v.fix.x, done.v.fix.y, 400);
            done = await until(async () => ({ s: await snap() }), (x) => settled(x.s), 20000, 300);
        }
        await sleep(800);
        const s = await snap();
        const posts = res.posts.filter((p) => p.at >= t0).map((p) => p.status);
        const inList = await listed(title);
        return { ok: posts.includes(201) && inList && /saved/i.test(`${s.topLine} ${s.said}`), title, typed: { title: !!tb, name: !!nb }, fix, posts, listed: inList, saved: s.saved, line: s.topLine, said: s.said, problem: s.save, ms: done.ms };
    }

    // ---- open
    /** the scene opened (or opened again: the Scene size the pilot set is kept for this scene), Keyboard, a click into it */
    async function openPage() {
        await page.goto(`${base}/fly/?scene=${scan}&render=off&nowarn=1`, { waitUntil: 'domcontentloaded', timeout: 120000 });
        const ready = await until(snap, (s) => s.status === 'ready' || s.status === 'error', 300000, 1000);
        const KB = '.screen.radio [data-action="radio-keyboard"]';
        if (await page.waitForSelector(KB, { timeout: 15000 }).then(() => true).catch(() => false)) await clickSel(KB, 1500);
        await click(W / 2, H / 2, 900);
        return { status: ready.v.status, ms: ready.ms, lock: (await snap()).lock, size: (await snap()).size };
    }
    /** the flown size of the first gate (scene units x the course's transform[0]) */
    const flown = (s) => (s.shapes?.[0] && s.tr ? Math.round(((s.shapes[0].side ?? s.shapes[0].diameter) * s.tr[0]) * 1000) / 1000 : null);

    // ---- open
    const o = await openPage();
    judge('open', o.status === 'ready', o);
    if (o.status !== 'ready') throw new Error('page not ready');

    // ---- the 5 inch at x1 (first: the scan as it opens, the drone at its own start)
    const five = await pickDrone(FIVE);
    const x1 = { ok: Math.abs((await snap()).size - 1) < 1e-6, size: (await snap()).size, how: 'the scan opened at its own size' };
    judge('x1.size', five.by !== null && x1.ok, { drone: five, size: x1 });
    // the 5 inch's own course (Course menu, Generate): three clicked gates at x1 in this scan meet its walls (the editor's
    // way checks refuse them, not the size rule), a generated course is laid clear of them
    const e1 = await openEditor();
    const m1 = await courseMenu('generate');
    const gen1 = await until(snap, (x) => (x.egates ?? 0) > 3 || (x.problem ?? null) !== null, 300000, 1000);
    await sleep(1500);
    const s1 = await saveAs('gap-save 5in x1');
    judge('s5in.generatedSaved', e1 && (gen1.v.egates ?? 0) > 3 && s1.ok, { editor: e1, menu: m1, gates: gen1.v.egates, shapes: gen1.v.shapes, ms: gen1.ms, save: s1 });
    await closeEditor();

    // ---- the whoop at x15: a generated course (the owner's case, brief 559), then a new empty one with three gates
    const whoop = await pickDrone(WHOOP);
    judge('whoop', whoop.by !== null, whoop);
    const x15 = await setSize(15);
    judge('x15.size', x15.ok, x15);
    if (env.QUICK) throw new Error('QUICK: stopped after x15.size');
    const e15g = await openEditor();
    const m15 = await courseMenu('generate');
    const gen = await until(snap, (x) => (x.egates ?? 0) > 3 || /course fits/i.test(`${x.topLine} ${x.said}`), 300000, 1000);
    await sleep(1500);
    const sg = await saveAs('gap-save x15 gen');
    judge('s15gen.generatedSaved', e15g && gen.ok && (gen.v.egates ?? 0) > 3 && sg.ok, { menu: m15, gates: gen.v.egates, shapes: gen.v.shapes, transform: gen.v.tr, line: gen.v.topLine, ms: gen.ms, save: sg });
    const n15 = await courseMenu('new');
    const g15 = await threeGates();
    const f15 = flown(await snap());
    const s15 = await saveAs('gap-save x15');
    judge('s15.emptySaved', g15.gates === 3 && s15.ok, { menu: n15, gates: g15, flownM: f15, save: s15 });
    // the whoop's own gates: each new gate made as small as the editor allows (key Minus ten times: 1.5 m to 0.5 m flown,
    // 0.033 scene units at x15, under the old rule's 0.05 scene units)
    const n15s = await courseMenu('new');
    const g15s = await threeGates(10);
    const s15s = await saveAs('gap-save x15 small');
    judge('s15small.whoopGatesSaved', g15s.gates === 3 && g15s.shapes?.every((sh) => (sh.side ?? sh.diameter) < 0.05) && s15s.ok, { menu: n15s, gates: g15s, save: s15s });
    // review step: the pilot opens what he saved again from the window's list of courses (another course first, then his
    // small-gate one): the page's own load (store.ts load, validateServerTrack) takes the stored x15 course back
    async function openRowByTitle(title, small) {
        // 'It is in Courses on the top bar' (the save line): the top bar's Course menu, its Courses item, shows the window's list
        const top = (await courseMenu('courses')).item;
        const id = await page.evaluate((ti) => [...document.querySelectorAll('.ce-list .ce-row')].find((li) => li.querySelector('.ce-row-head b')?.textContent === ti)?.dataset.id ?? null, title);
        if (!id) return { title, top: !!top, row: false };
        // the mouse wheel over the window's list until the row's Open stands inside the window, then a click on it
        const sel = `.ce-list .ce-row[data-id="${id}"] button.ce-open`;
        let b = null;
        for (let n = 0; n < 20 && !b; n++) {
            const [bb, win] = [await stableBox(sel, 1500), await boxOf('.course-editor')];
            if (bb && win && bb.y > win.y - win.h / 2 + 8 && bb.y < Math.min(H, win.y + win.h / 2) - 8) { await click(bb.x, bb.y, 600); b = bb; break; }
            const list = await boxOf('.course-editor .ce-list');
            if (!list) break;
            await page.mouse.move(list.x, Math.max(10, Math.min(H - 10, list.y)));
            await page.mouse.wheel(0, bb && win && bb.y < win.y ? -200 : 200);
            await sleep(250);
        }
        const w = await until(snap, (x) => (x.open && x.egates === 3 && x.shapes?.every((sh) => ((sh.side ?? sh.diameter) < 0.05) === small)) || !!x.problem, 20000, 400);
        await sleep(1200);
        const s = await snap();
        // the course as the local API stores it: its Scene size (the page's debug view holds no transform)
        const scale = await fetch(`${API}/api/tracks/${id}/v1`).then((r) => r.json()).then((t) => t.transform?.[0] ?? null).catch(() => null);
        return { title, id, row: true, pressed: !!b, scale, open: s.open, saved: s.saved, gates: s.egates, shapes: s.shapes, tr: s.tr, problem: s.problem, line: s.topLine, said: s.said, ms: w.ms };
    }
    const ro1 = await openRowByTitle('gap-save x15', false);
    const ro2 = await openRowByTitle('gap-save x15 small', true);
    judge('review.reopenSmall', ro2.row && ro2.open && ro2.gates === 3 && ro2.shapes?.every((sh) => (sh.side ?? sh.diameter) < 0.05) && Math.abs((ro2.scale ?? 0) - 15) < 1.5 && !/invalid/i.test(`${ro2.line} ${ro2.said} ${ro2.problem ?? ''}`), { other: ro1, small: ro2 });
    await closeEditor();

    // ---- the whoop at x100: the slider's right end, the scene opened again (no course loaded), a new empty course
    const x100 = await setSize('max');
    const o100 = await openPage();
    judge('x100.size', x100.ok && Math.abs(Math.log2(o100.size / 100)) < 0.07, { set: x100, reopened: o100 });
    const e100 = await openEditor();
    const n100 = await courseMenu('new');
    const g100 = await threeGates();
    const f100 = flown(await snap());
    const s100 = await saveAs('gap-save x100');
    judge('s100.emptySaved', e100 && g100.gates === 3 && s100.ok, { editor: e100, opening: (res.editorOpen || []).at(-1) ?? null, menu: n100, gates: g100, flownM: f100, save: s100 });

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
