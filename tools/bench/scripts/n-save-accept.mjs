// Lane n-save, stage S4 (docs/wip/n-save.md): Save never refuses what a pilot may accept (the owner's wish 1 of 2026-11-20,
// t7-plan Decision 1). The pilot's own path with the MOUSE at 1536x730, device scale 1.25, the pointer lock first:
//   open     the scene, Keyboard on the Controls screen, a click into the scene (the pointer lock), Shift+B
//   build    the top bar's Course menu, New empty course; Add gate and a click on one point of the scene, Add gate and a click
//            on the same point (two gates on one spot); Add gate and a click lower down, then the selected gate's vertical
//            gizmo arrow dragged down until the editor names that gate in the scan (a gate in a wall)
//   dialog   the name and a title typed, the top bar's Save: the dialog save-warnings shows the count and its buttons
//            save-fix-all, save-as-is, save-show-me in that order
//   asIs     Save as it is: the local API answers 201; the page loaded again shows the course as it was built
//   showMe   a new title, Save, Show me: no post, the selected gate is one of the warned gates
//   fixAll   Save, Fix all automatically: the line save-fixed names the moved gates, they stand elsewhere, the version is
//            stored (201) with the fixed places; save-undo puts every gate back
//   reload   the page loaded again: the API's newest version of the course holds the fixed places, the page shows 3 gates
//   node tools/bench/scripts/n-save-accept.mjs <dist|https://live/en> <scan> <out.json>
// With a dist folder the probe serves it (serve-csp.mjs, port PORT or 6902) and starts the local API (apps/api/server.py,
// port API_PORT or 6903, a fresh DATA_DIR under TEMP_DIR). With an https address (the live site, the negative control) every
// request to /api/ but GET is aborted and the probe stops at the dialog step: nothing is saved there. ?render=off.
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
if (!where || !scan || !outPath) {
    console.error('usage: n-save-accept.mjs <dist|https://site/en> <scan> <out.json>');
    process.exit(2);
}
const env = process.env;
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const LIVE = /^https?:/.test(where);
const PORT = Number(env.PORT || 6902);
const API_PORT = Number(env.API_PORT || 6903);
const TEMP = env.TEMP_DIR || 'U:/Temp/gsfpv-train4/n-save';
const SHOTS = env.SHOTS || 'U:/Temp/gsfpv-train4/shots';
const base = LIVE ? where.replace(/\/$/, '') : `http://localhost:${PORT}/en`;
const API = `http://127.0.0.1:${API_PORT}`;
const W = 1536, H = 730, DSF = 1.25;
const NAME = 'Andrii Shramko';
const IDS = ['save-fix-all', 'save-as-is', 'save-show-me'];
const WALL = ['gate-wall', 'wall-in-opening', 'outside'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r3 = (v) => (Array.isArray(v) ? v.map((x) => Math.round(x * 1000) / 1000) : v);
const dist3 = (a, b) => (a && b ? Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) : -1);
const samePlaces = (a, b, tol = 1e-3) => !!a && !!b && a.length === b.length && a.every((p, i) => dist3(p, b[i]) >= 0 && dist3(p, b[i]) < tol);

const res = { address: base, live: LIVE, scan, size: [W, H], dsf: DSF, date: new Date().toISOString(), steps: {}, posts: [], notRun: [], shots: [] };
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
/** the newest version the local API holds of a course: its gates' places */
async function storedPlaces(id) {
    let last = null;
    for (let v = 1; v <= 10; v++) {
        const t = await fetch(`${API}/api/tracks/${id}/v${v}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
        if (!t) break;
        last = { version: v, places: t.gates.map((g) => g.pos) };
    }
    return last;
}

const SNAP = `(() => {
    const h = window.__gsfpv || {}; const c = h.course || {}; const e = c.editor || {};
    let v = null; try { v = window.__gsfpvEditView ? window.__gsfpvEditView() : null; } catch (x) { v = null; }
    const tb = document.querySelector('.ce-topbar');
    const s = v && v.edit4 ? v.edit4.s : null;
    const ids = v && v.course ? v.course.gates.map((g) => g.id) : [];
    return { status: h.status ?? null, open: !!e.open, selected: e.selected ?? null, said: String(e.said || '').slice(0, 220),
        topLine: tb ? String((tb.querySelector('.ce-tb-line') || {}).textContent || '').slice(0, 260) : null,
        courseGates: c.gates ?? null, courseOn: !!c.on, saved: c.saved ?? null,
        gates: v ? v.gates : null, stand: v && v.stand ? v.stand.screen : null, axes: v ? v.axes : null,
        egates: v && v.course ? v.course.gates.map((g) => g.pos) : null,
        problems: v && v.course ? v.course.problems.map((p) => ({ code: p.code, gate: p.gate !== undefined ? ids.indexOf(p.gate) : null })) : null,
        fix: s ? s.fix ?? null : null, save: s && s.save ? { status: s.save.problem ? s.save.problem.status : null, key: s.save.key } : null,
        lock: document.pointerLockElement ? document.pointerLockElement.tagName : null, href: location.href };
})()`;

const pick = pickBrowser({ expected: chromium.executablePath() });
let browser = null;
const log = [];
try {
    if (!LIVE) {
        kids.push(spawn(process.execPath, [join(REPO, 'tools', 'bench', 'scripts', 'serve-csp.mjs'), resolve(where), String(PORT)], { env: { ...env, API_PROXY: API }, stdio: 'ignore' }));
        mkdirSync(DATA, { recursive: true });
        kids.push(spawn('python', [join(REPO, 'apps', 'api', 'server.py')], { env: { ...env, DATA_DIR: DATA, PORT: String(API_PORT), TG_BOT_TOKEN: '', TG_CHAT_ID: '', MIN_FREE_GB: '0' }, stdio: 'ignore' }));
        if (!(await until(health, (v) => v, 30000, 300)).ok) throw new Error('the local API did not answer /api/health');
        if (!(await until(() => fetch(`${base}/fly/`).then((r) => r.ok).catch(() => false), (v) => v, 30000, 300)).ok) throw new Error('the local site did not answer');
    }
    browser = await chromium.launch({ ...pick.launch, headless: true });
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DSF });
    // the live site: nothing is saved, sent or created (every request to /api/ but GET is aborted)
    await ctx.route((u) => u.pathname.startsWith('/api/'), (route) => {
        const m = route.request().method();
        if (LIVE && m !== 'GET' && m !== 'HEAD') { res.posts.push({ aborted: route.request().url().slice(0, 120), method: m }); return route.abort(); }
        return route.continue();
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => log.push(`pageerror: ${e.message}`.slice(0, 300)));
    page.on('response', (r) => { const q = r.request(); if (q.method() === 'POST' && new URL(r.url()).pathname.startsWith('/api/tracks')) res.posts.push({ path: new URL(r.url()).pathname, status: r.status(), at: Date.now() }); });
    const snap = () => page.evaluate(SNAP);
    const boxOf = (sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e || !e.getClientRects().length || e.closest('[hidden]')) return null; const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width, h: b.height, text: (e.textContent || '').trim().slice(0, 300) }; }, sel);
    const inView = (b) => b && b.y > 4 && b.y < H - 4 && b.x > 4 && b.x < W - 4;
    async function click(x, y, after = 600) { await page.mouse.move(x, y, { steps: 4 }); await page.mouse.click(x, y); await sleep(after); }
    async function clickSel(sel, after = 600) { const b = await boxOf(sel); if (!b) return null; await click(b.x, b.y, after); return b; }
    /** the selector brought into view by the mouse wheel over the editor's window (the pilot scrolls), then clicked */
    async function wheelTo(sel, after = 600) {
        for (let n = 0; n < 16; n++) {
            const b = await boxOf(sel);
            if (inView(b)) { await click(b.x, b.y, after); return b; }
            const win = await boxOf('.course-editor');
            await page.mouse.move(win ? win.x : W / 2, win ? Math.min(H - 20, Math.max(20, win.y)) : H / 2);
            await page.mouse.wheel(0, b && b.y < 0 ? -250 : 250);
            await sleep(250);
        }
        return null;
    }
    const shot = async (name) => { const p = join(SHOTS, `n-save-${name}.png`); await page.screenshot({ path: p }); res.shots.push(p); };

    /** the page loaded, Keyboard on the Controls screen, a click into the scene (the pointer lock), Shift+B */
    async function openPage(url) {
        if (url) await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
        else await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
        const ready = await until(snap, (s) => s.status === 'ready' || s.status === 'error', 300000, 1000);
        const KB = '.screen.radio [data-action="radio-keyboard"]';
        if (await page.waitForSelector(KB, { timeout: 15000 }).then(() => true).catch(() => false)) await clickSel(KB, 1500);
        await click(W / 2, H / 2, 900);
        const lock = (await snap()).lock;
        await page.keyboard.press('Shift+KeyB');
        const op = await until(snap, (s) => (s.open && Array.isArray(s.egates)) || s.status === 'error', 300000, 1000);
        await sleep(1500);
        return { status: ready.v.status, lock, open: op.v.open, ms: op.ms, gates: op.v.egates?.length ?? null };
    }
    /** Add gate on the top bar, then a click on (x, y): the gate the click added (its index) */
    async function addAt(x, y) {
        const pressed = await page.evaluate(() => document.querySelector('.ce-topbar [data-top="add"]')?.getAttribute('aria-pressed') === 'true');
        if (!pressed) await clickSel('.ce-topbar [data-top="add"]', 400);
        const n0 = (await snap()).egates?.length ?? 0;
        await click(x, y, 900);
        const s = await snap();
        return (s.egates?.length ?? 0) > n0 ? s.selected : null;
    }
    /** the selected gate's vertical gizmo arrow dragged down by the mouse until the editor names it in the scan */
    async function buryByGizmo(i) {
        const tries = [];
        for (let n = 0; n < 10; n++) {
            const s = await snap();
            if (s.problems?.some((p) => p.gate === i && WALL.includes(p.code))) return { ok: true, tries };
            if (s.selected !== i || !s.stand || !s.axes?.y) { tries.push({ n, selected: s.selected, stand: !!s.stand }); break; }
            const a = s.axes.y;
            const r = [40, 60, 30, 80][n % 4];
            const x0 = s.stand[0] + a[0] * r, y0 = s.stand[1] + a[1] * r;
            // the arrow points up on the screen; down is against it
            const down = a[1] < 0 ? -1 : 1;
            await page.mouse.move(x0, y0, { steps: 3 });
            await sleep(120);
            await page.mouse.down();
            await page.mouse.move(x0 + down * a[0] * 90, Math.min(H - 5, y0 + down * a[1] * 90), { steps: 10 });
            await page.mouse.up();
            await sleep(600);
            const t = await snap();
            tries.push({ n, r, moved: Math.round(dist3(s.egates?.[i], t.egates?.[i]) * 1000) / 1000 });
        }
        const s = await snap();
        return { ok: !!s.problems?.some((p) => p.gate === i && WALL.includes(p.code)), tries };
    }
    /** the name and title typed into the editor's window, then the top bar's Save */
    async function pressSave(title) {
        const opened = await page.evaluate(() => document.querySelector('.course-editor')?.classList.contains('ce-open') ?? false);
        if (!opened) await clickSel('.course-editor .ce-drawer', 500);
        const tb = await wheelTo('.course-editor .ce-course-title', 200);
        if (tb) { await page.keyboard.press('Control+A'); await page.keyboard.type(title); }
        const nb = await wheelTo('.course-editor .ce-name', 200);
        if (nb) { await page.keyboard.press('Control+A'); await page.keyboard.type(NAME); }
        const t0 = Date.now();
        const b = await clickSel('.ce-topbar [data-top="save"]', 600);
        return { t0, pressed: !!b, typed: { title: !!tb, name: !!nb } };
    }
    const dialogOf = () => page.evaluate((ids) => {
        const d = document.querySelector('[data-testid="save-warnings"]');
        if (!d || d.hidden || !d.getClientRects().length) return null;
        const order = [...d.querySelectorAll('[data-testid]')].map((e) => e.dataset.testid).filter((x) => ids.includes(x));
        return { text: (d.textContent || '').trim().slice(0, 400), order };
    }, IDS);
    /** Save and the dialog; null when it never came (the old page refuses instead) */
    async function saveToDialog(title) {
        const p = await pressSave(title);
        const d = await until(dialogOf, (x) => !!x, 15000, 300);
        return { ...p, dialog: d.v, line: (await snap()).topLine };
    }
    const postsSince = (t0) => res.posts.filter((p) => p.at >= t0).map((p) => p.status);

    // ---- open
    const o = await openPage(`${base}/fly/?scene=${scan}&render=off&nowarn=1`);
    judge('open', o.status === 'ready' && o.open, o);
    if (!o.open) throw new Error('the editor did not open');

    // ---- build: a new empty course, two gates on one spot, one gate in a wall
    await clickSel('.ce-topbar [data-top="course"]', 500);
    await clickSel('.ce-menu [data-item="new"]', 800);
    for (let i = 0; i < 2; i++) { const y = await boxOf('.life-ask [data-ask="yes"]'); if (!y) break; await click(y.x, y.y, 800); }
    await until(snap, (s) => (s.egates?.length ?? -1) === 0, 10000, 300);
    const pair = [await addAt(W * 0.5, H * 0.5), await addAt(W * 0.5, H * 0.5)];
    const low = await addAt(W * 0.5, H * 0.72);
    const bury = low !== null ? await buryByGizmo(low) : { ok: false, tries: [] };
    let s = await snap();
    const built = s.egates;
    const pairM = pair[0] !== null && pair[1] !== null ? dist3(built[pair[0]], built[pair[1]]) : -1;
    const bad = [pair[0], pair[1], low].filter((x) => x !== null);
    judge('build', built?.length === 3 && pairM >= 0 && pairM < 0.05 && bury.ok, { gates: built?.length ?? null, pair, pairApart: Math.round(pairM * 1000) / 1000, low, bury, problems: s.problems, line: s.topLine });

    // ---- the dialog and Save as it is
    const d1 = await saveToDialog('n-save as is');
    if (d1.dialog) await shot('dialog');
    judge('dialog', !!d1.dialog && JSON.stringify(d1.dialog.order) === JSON.stringify(IDS) && /\d/.test(d1.dialog.text), { ...d1, kinds: (await snap()).fix?.kinds ?? null });
    if (LIVE) {
        // the negative control: the old page refuses Save; the probe stops before anything could be stored
        judge('asIs.saved', false, { why: d1.dialog ? 'the dialog came' : 'no Save dialog: the page refused the save', line: d1.line, said: (await snap()).said, aborted: res.posts });
        res.notRun.push('asIs.reload', 'showMe', 'fixAll', 'fixAll.undo', 'reload');
        throw new Error('LIVE: stopped before any save');
    }
    const asIsB = await clickSel('[data-testid="save-as-is"]', 400);
    const sv = await until(snap, (x) => !!x.saved && postsSince(d1.t0).includes(201), 20000, 300);
    s = await snap();
    const id = s.saved;
    const stored1 = id ? await storedPlaces(id) : null;
    judge('asIs.saved', !!asIsB && sv.ok && samePlaces(stored1?.places, built), { pressed: !!asIsB, posts: postsSince(d1.t0), id, stored: stored1 ? { version: stored1.version, same: samePlaces(stored1.places, built) } : null, line: s.topLine });
    // the page loaded again on the stored course (the link the save left), the course as it was
    const href = s.href;
    const o2 = await openPage(/[?&]course=/.test(href) ? href : `${base}/fly/?scene=${scan}&course=${id}&render=off&nowarn=1`);
    s = await snap();
    judge('asIs.reload', o2.open && samePlaces(s.egates, built), { open: o2, url: s.href.slice(0, 160), gates: s.egates?.length ?? null, same: samePlaces(s.egates, built), line: s.topLine });

    // ---- Show me (a new title: a change; Show me posts nothing)
    const d2 = await saveToDialog('n-save show me');
    const showB = d2.dialog ? await clickSel('[data-testid="save-show-me"]', 900) : null;
    s = await snap();
    judge('showMe', !!showB && bad.includes(s.selected) && postsSince(d2.t0).length === 0 && s.fix?.answer === 'show', { dialog: !!d2.dialog, selected: s.selected, warned: bad, posts: postsSince(d2.t0), answer: s.fix?.answer ?? null, line: s.topLine });

    // ---- Fix all automatically, then Undo
    const beforeFix = (await snap()).egates;
    const d3 = await saveToDialog('n-save fixed');
    const fixB = d3.dialog ? await clickSel('[data-testid="save-fix-all"]', 300) : null;
    const fl = await until(() => boxOf('[data-testid="save-fixed"]'), (b) => !!b, 10000, 200);
    if (fl.ok) await shot('ghosts');
    const st = await until(snap, () => postsSince(d3.t0).includes(201), 20000, 300);
    s = await snap();
    const fixed = s.egates;
    const moved = s.fix?.moved ?? [];
    const movedOk = moved.length > 0 && moved.every((n) => dist3(fixed?.[n - 1], beforeFix?.[n - 1]) > 1e-3);
    const named = fl.v ? moved.length > 0 && new RegExp(`\\b${moved.length}\\b`).test(fl.v.text) : false;
    const stored3 = id ? await storedPlaces(s.saved ?? id) : null;
    judge('fixAll', !!fixB && fl.ok && named && movedOk && st.ok && samePlaces(stored3?.places, fixed), { line: fl.v?.text ?? null, moved, left: s.fix?.left ?? null, posts: postsSince(d3.t0), stored: stored3 ? { version: stored3.version, same: samePlaces(stored3.places, fixed) } : null, places: { before: beforeFix?.map(r3), after: fixed?.map(r3) } });
    const undoB = await clickSel('[data-testid="save-undo"]', 700);
    s = await snap();
    judge('fixAll.undo', !!undoB && samePlaces(s.egates, beforeFix) && s.fix?.undone === true, { pressed: !!undoB, back: samePlaces(s.egates, beforeFix), undone: s.fix?.undone ?? null, line: s.topLine });

    // ---- the page loaded again: the course saved (the fixed places, the API's newest version)
    const o3 = await openPage(`${base}/fly/?scene=${scan}&course=${s.saved ?? id}&render=off&nowarn=1`);
    s = await snap();
    const stored4 = await storedPlaces(s.saved ?? id);
    judge('reload', o3.open && s.egates?.length === 3 && samePlaces(stored4?.places, fixed), { open: o3, gates: s.egates?.length ?? null, pageSameAsFixed: samePlaces(s.egates, fixed), stored: stored4 ? { version: stored4.version, same: samePlaces(stored4.places, fixed) } : null, line: s.topLine });
} catch (e) {
    res.error = String(e).slice(0, 400);
    if (!(LIVE && /stopped before any save/.test(res.error))) fails.push('error');
}
res.fails = fails;
res.log = log.slice(0, 30);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(res, null, 1));
await browser?.close().catch(() => {});
for (const k of kids) k.kill();
console.log(JSON.stringify({ verdict: fails.length ? 'FAIL' : 'PASS', address: base, fails, steps: Object.fromEntries(Object.entries(res.steps).map(([k, v]) => [k, v.ok ? 'PASS' : 'FAIL'])), error: res.error ?? null }));
process.exit(fails.length ? 1 : 0);
