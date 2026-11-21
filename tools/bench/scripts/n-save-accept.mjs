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
    page.on('response', async (r) => {
        const q = r.request();
        if (q.method() !== 'POST' || !new URL(r.url()).pathname.startsWith('/api/tracks')) return;
        const e = { path: new URL(r.url()).pathname, status: r.status(), at: Date.now(), token: !!q.headers()['x-track-token'] };
        res.posts.push(e);
        if (r.status() !== 201) e.body = (await r.text().catch(() => '')).slice(0, 200);
    });
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
    /**
     * where the move arrow of one axis takes a press: the gizmo's drawn part farthest out along that axis's screen way and
     * near its line (the cone at the arrow's tip, handle-look.ts moveReach), read from the page's own measure of the drawn
     * parts. Null when the arrow points at the eye (too short to take a press).
     */
    async function arrowTip(s, ax) {
        const a = s.axes?.[ax];
        const m = await page.evaluate(() => { try { return window.__gsfpvEditMeasure ? window.__gsfpvEditMeasure() : null; } catch (x) { return null; } });
        if (!a || !s.stand || !m?.parts) return null;
        let best = null;
        for (const p of m.parts) {
            const cx = p.rect[0] + p.rect[2] / 2 - s.stand[0], cy = p.rect[1] + p.rect[3] / 2 - s.stand[1];
            const along = cx * a[0] + cy * a[1];
            const off = Math.abs(cx * a[1] - cy * a[0]);
            if (off < 10 && along > 50 && (!best || along > best.along)) best = { along, x: s.stand[0] + cx, y: s.stand[1] + cy, name: p.name };
        }
        return best;
    }
    /** the selected gate's vertical gizmo arrow dragged down by the mouse until the editor names it in the scan */
    async function buryByGizmo(i) {
        const tries = [];
        for (let n = 0; n < 10; n++) {
            const s = await snap();
            if (s.problems?.some((p) => p.gate === i && WALL.includes(p.code))) return { ok: true, tries };
            if (s.selected !== i || !s.stand || !s.axes?.y) { tries.push({ n, selected: s.selected, stand: !!s.stand }); break; }
            const a = s.axes.y;
            const tip = await arrowTip(s, 'y');
            if (!tip) { tries.push({ n, tip: null }); break; }
            const x0 = tip.x, y0 = tip.y, r = Math.round(tip.along);
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
    /**
     * the selected gate pulled by its gizmo arrows onto `target` (scene units): each arrow first dragged 40 px to learn which
     * way and how far it moves the gate, then by the share of the gap along that way; a drag that misses the arrow circles
     * the view (the arrows are read again before every drag)
     */
    async function pullOnto(i, target, near = 0.15) {
        const tries = [];
        const learnt = {};
        for (let n = 0; n < 24; n++) {
            const s = await snap();
            const p = s.egates?.[i];
            if (!p || s.selected !== i || !s.stand || !s.axes) { tries.push({ n, lost: { selected: s.selected, gates: s.egates?.length ?? null, stand: !!s.stand } }); break; }
            const gap = [target[0] - p[0], target[1] - p[1], target[2] - p[2]];
            if (Math.hypot(...gap) < near) return { ok: true, tries, apart: Math.hypot(...gap) };
            const ax = ['x', 'z', 'y'][n % 3];
            const a = s.axes[ax];
            const tip = await arrowTip(s, ax);
            if (!a || !tip) { tries.push({ n, ax, tip: null }); continue; }
            const L = learnt[ax];
            let px = 40;
            if (L) {
                const along = gap[0] * L.u[0] + gap[1] * L.u[1] + gap[2] * L.u[2];
                px = Math.max(-220, Math.min(220, along / L.perPx));
                if (Math.abs(px) < 3) continue;
            }
            const x0 = tip.x, y0 = tip.y;
            const hit = await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e ? `${e.tagName}.${e.className}`.slice(0, 40) : null; }, [x0, y0]);
            await page.mouse.move(x0, y0, { steps: 3 });
            await sleep(150);
            await page.mouse.down();
            await page.mouse.move(Math.max(5, Math.min(W - 5, x0 + a[0] * px)), Math.max(5, Math.min(H - 5, y0 + a[1] * px)), { steps: 12 });
            await page.mouse.up();
            await sleep(500);
            const q = (await snap()).egates?.[i];
            const d = q ? [q[0] - p[0], q[1] - p[1], q[2] - p[2]] : [0, 0, 0];
            const m = Math.hypot(...d);
            if (m > 1e-3) learnt[ax] = { u: d.map((x) => x / m * Math.sign(px)), perPx: m / Math.abs(px) };
            tries.push({ n, ax, px: Math.round(px), moved: Math.round(m * 1000) / 1000, tip: tip.name, along: Math.round(tip.along), hit });
        }
        const p = (await snap()).egates?.[i];
        const apart = p ? dist3(p, target) : -1;
        return { ok: apart >= 0 && apart < near, tries, apart };
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
    /** the top bar's Course menu, Courses, then Open on the row with this title (the wheel over the list until it shows) */
    async function openRow(title) {
        await clickSel('.ce-topbar [data-top="course"]', 500);
        const item = await clickSel('.ce-menu [data-item="courses"]', 800);
        const rid = await until(() => page.evaluate((ti) => [...document.querySelectorAll('.ce-list .ce-row')].find((li) => li.querySelector('.ce-row-head b')?.textContent === ti)?.dataset.id ?? null, title), (v) => !!v, 10000, 400);
        if (!rid.v) return { title, item: !!item, row: false };
        const sel = `.ce-list .ce-row[data-id="${rid.v}"] button.ce-open`;
        let pressed = false;
        const seen = [];
        for (let n = 0; n < 20 && !pressed; n++) {
            const [bb, win] = [await boxOf(sel), await boxOf('.course-editor')];
            if (bb && win && bb.y > win.y - win.h / 2 + 8 && bb.y < Math.min(H, win.y + win.h / 2) - 8) {
                const was = JSON.stringify((await snap()).egates);
                const hit = await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e ? `${e.tagName}.${e.className}`.slice(0, 80) : null; }, [bb.x, bb.y]);
                await click(bb.x, bb.y, 600);
                pressed = true;
                seen.push({ hit, line: (await snap()).topLine?.slice(0, 120) ?? null });
                // a course with unsaved changes asks first (the line says so): Open pressed again drops them (review TK-4)
                if (!(await until(snap, (x) => JSON.stringify(x.egates) !== was, 4000, 300)).ok && (await boxOf(sel))) { await clickSel(sel, 600); seen.push({ again: true, line: (await snap()).topLine?.slice(0, 120) ?? null }); }
                break;
            }
            const list = await boxOf('.course-editor .ce-list');
            if (!list) break;
            await page.mouse.move(list.x, Math.max(10, Math.min(H - 10, list.y)));
            await page.mouse.wheel(0, bb && win && bb.y < win.y ? -200 : 200);
            await sleep(250);
        }
        for (let i = 0; i < 2; i++) { const y = await boxOf('.life-ask [data-ask="yes"]'); if (!y) break; await click(y.x, y.y, 800); }
        const w = await until(snap, (x) => x.open && x.egates?.length === 3, 20000, 400);
        await sleep(1000);
        return { title, id: rid.v, row: true, pressed, ms: w.ms, seen };
    }

    // ---- open
    const o = await openPage(`${base}/fly/?scene=${scan}&render=off&nowarn=1`);
    judge('open', o.status === 'ready' && o.open, o);
    if (process.env.MEASURE_TOP === '1') {
        // review: the page's top-row buttons under the editor's top bar (the 16 px message wraps): how much of each is covered,
        // and whether a press at its centre reaches it
        const m = await page.evaluate(() => {
            const bar = document.querySelector('.ce-topbar')?.getBoundingClientRect();
            if (!bar) return null;
            const line = document.querySelector('.ce-topbar .ce-tb-line');
            const out = [...document.querySelectorAll('button, a')].filter((e) => !e.closest('.ce-topbar') && !e.closest('.course-editor')).map((e) => ({ e, r: e.getBoundingClientRect() })).filter(({ r }) => r.width > 0 && r.top < 70 && r.bottom > 20 && r.right > bar.left && r.left < bar.right).map(({ e, r }) => {
                const cover = Math.max(0, Math.min(bar.bottom, r.bottom) - Math.max(bar.top, r.top));
                const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
                return { name: (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 20), top: Math.round(r.top), h: Math.round(r.height), coveredPx: Math.round(cover), centreReaches: !!hit && (hit === e || e.contains(hit)) };
            });
            return { bar: [Math.round(bar.left), Math.round(bar.top), Math.round(bar.right), Math.round(bar.bottom)], line: line?.textContent ?? null, lineH: line ? Math.round(line.getBoundingClientRect().height) : null, under: out };
        });
        console.log(`MEASURE ${JSON.stringify(m)}`);
        res.measureTop = m;
        throw new Error('STOP after measure');
    }
    if (!o.open) throw new Error('the editor did not open');

    // ---- build: a new empty course, two gates on one spot, one gate in a wall
    await clickSel('.ce-topbar [data-top="course"]', 500);
    await clickSel('.ce-menu [data-item="new"]', 800);
    for (let i = 0; i < 2; i++) { const y = await boxOf('.life-ask [data-ask="yes"]'); if (!y) break; await click(y.x, y.y, 800); }
    await until(snap, (s) => (s.egates?.length ?? -1) === 0, 10000, 300);
    // gate A by a click on a point, gate B by a click elsewhere (the gizmo goes to B), then gate C by a click on the very
    // pixel of A: Add gate places on a click even over a gate (view-mouse.ts: the armed click goes to onPlace), so the same
    // ray gives the same spot. When C still lands apart (the camera moved), it is pulled onto A by its arrows.
    const added = [await addAt(W * 0.5, H * 0.5)];
    let s0 = await snap();
    const aPos = s0.egates?.[0] ?? null;
    added.push(await addAt(W * 0.25, H * 0.68));
    s0 = await snap();
    const aNow = s0.egates ? s0.egates.findIndex((p) => dist3(p, aPos) < 1e-6) : -1;
    const aScr = (aNow >= 0 ? s0.gates?.[aNow] : null) ?? [W * 0.5, H * 0.5];
    const c = await addAt(aScr[0], aScr[1]);
    added.push(c);
    s0 = await snap();
    const cOff = { at: aScr.map(Math.round), apart: c !== null ? Math.round(dist3(s0.egates?.[c], aPos) * 1000) / 1000 : null };
    const addOff = async () => { if (await page.evaluate(() => document.querySelector('.ce-topbar [data-top="add"]')?.getAttribute('aria-pressed') === 'true')) await clickSel('.ce-topbar [data-top="add"]', 400); };
    await addOff();
    // the gap lies on the floor (x and z): the view circled to look down on C (the middle button dragged up or down), so both
    // floor arrows lie in the picture; the way that shortens the up arrow is kept
    const upLen = async () => { const t = await snap(); return t.selected === c ? (await arrowTip(t, 'y'))?.along ?? 0 : null; };
    const orbit = async (dy) => { await page.mouse.move(W * 0.5, H * 0.3); await page.mouse.down({ button: 'middle' }); await page.mouse.move(W * 0.5, H * 0.3 + dy, { steps: 12 }); await page.mouse.up({ button: 'middle' }); await sleep(700); };
    const look = { up0: await upLen() };
    if (c !== null && cOff.apart >= 0.25 && look.up0) {
        // 160 px at a time the way the up arrow shortens, until it is short (the floor arrows then lie in the picture)
        let dy = 160, was = look.up0;
        look.steps = [];
        for (let n = 0; n < 6 && was > 40; n++) {
            await orbit(dy);
            const now = await upLen();
            look.steps.push(now === null ? null : Math.round(now));
            if (now === null) break;
            if (now > was && n === 0) dy = -dy;
            was = now;
        }
    }
    const pull = aPos && c !== null && cOff.apart >= 0.25 && s0.selected === c ? { look, ...(await pullOnto(c, aPos, 0.25)) } : { ok: cOff.apart !== null && cOff.apart < 0.25, skipped: true };
    // gate B selected by a click on it (its place on the page), then pulled down (a drag that misses the arrow circles the view)
    let s = await snap();
    const bAt = s.egates ? s.egates.findIndex((p, i) => s.egates.every((q, j) => j === i || dist3(p, q) > 0.5)) : -1;
    const bScr = bAt >= 0 ? s.gates?.[bAt] : null;
    if (bScr && s.selected !== bAt) await click(bScr[0], bScr[1], 700);
    const bury = bAt >= 0 && (await snap()).selected === bAt ? await buryByGizmo(bAt) : { ok: false, tries: [], bAt, selected: (await snap()).selected };
    s = await snap();
    const built = s.egates;
    // the gates by their places (an added gate goes after the nearest leg, so the indices shift): the nearest two are the pair
    let pair = [null, null], pairM = -1;
    for (let i = 0; i < (built?.length ?? 0); i++) for (let j = i + 1; j < built.length; j++) {
        const m = dist3(built[i], built[j]);
        if (pairM < 0 || m < pairM) { pairM = m; pair = [i, j]; }
    }
    const lowNow = s.problems?.find((p) => WALL.includes(p.code) && p.gate !== null && !pair.includes(p.gate))?.gate ?? null;
    const bad = [pair[0], pair[1], lowNow].filter((x) => x !== null);
    // two gates on one spot cannot be made by the mouse: Add gate puts a new gate 2 m off the gate under the click
    // (add-place.ts) and the arrow along the view takes no press; the build is judged on a gate in a wall and the nearest
    // pair, and 'same spot' is listed as not run (the unit tests packages/tracks/test/autofix.test.ts hold it)
    const inWall = s.problems?.some((p) => WALL.includes(p.code) && p.gate !== null) ?? false;
    if (!(pairM >= 0 && pairM < 0.3)) res.notRun.push(`build.samePlace: the nearest two gates stand ${Math.round(pairM * 100) / 100} m apart (Add gate keeps 2 m)`);
    judge('build', built?.length === 3 && pairM >= 0 && bury.ok && inWall, { gates: built?.length ?? null, added, cOff, pull, pair, pairApart: Math.round(pairM * 1000) / 1000, low: lowNow, bury, problems: s.problems, line: s.topLine });
    if (process.env.STOP === 'build') throw new Error('STOP after build');

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
    const o2 = await openPage(`${base}/fly/?scene=${scan}&render=off&nowarn=1`);
    const row2 = await openRow('n-save as is');
    s = await snap();
    judge('asIs.reload', o2.open && row2.pressed && samePlaces(s.egates, built), { open: o2, row: row2, gates: s.egates?.length ?? null, same: samePlaces(s.egates, built), line: s.topLine });

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
    const fixedId = s.saved ?? id;
    const o3 = await openPage(`${base}/fly/?scene=${scan}&render=off&nowarn=1`);
    const row3 = await openRow('n-save fixed');
    s = await snap();
    const stored4 = await storedPlaces(fixedId);
    // the Undo after the save left the gates back, unsaved: the page keeps that draft and brings it back over the stored
    // course, saying so (drafts.ts; the line offers key Ctrl+Z). Either the saved places, or the draft with that line
    const draftBack = samePlaces(s.egates, beforeFix) && /Ctrl\+Z/.test(s.topLine ?? '');
    judge('reload', o3.open && row3.pressed && (samePlaces(s.egates, fixed) || draftBack) && samePlaces(stored4?.places, fixed), { open: o3, row: row3, gates: s.egates?.length ?? null, pageSameAsFixed: samePlaces(s.egates, fixed), draftBack, stored: stored4 ? { version: stored4.version, same: samePlaces(stored4.places, fixed) } : null, line: s.topLine });

    // ---- the review's own step (a thing a pilot does): Fix all, then one moved gate pulled by hand, then the way back.
    // What must hold: the pilot can get every gate back to before Fix all (save-undo, or key Ctrl+Z as the line says), and
    // no Undo button stays that does something else than it says
    const beforeOwn = (await snap()).egates;
    const d5 = await saveToDialog('n-save own');
    if (!d5.dialog) res.notRun.push('own.handAfterFix: no Save dialog on the reloaded page');
    else {
        await clickSel('[data-testid="save-fix-all"]', 300);
        await until(snap, () => postsSince(d5.t0).includes(201), 20000, 300);
        let t = await snap();
        const fixedOwn = t.egates;
        const sel = t.selected;
        const tip = sel !== null && t.axes?.y ? await arrowTip(t, 'y') : null;
        if (tip) {
            const a = t.axes.y, down = a[1] < 0 ? -1 : 1;
            await page.mouse.move(tip.x, tip.y, { steps: 3 }); await sleep(120); await page.mouse.down();
            await page.mouse.move(tip.x + down * a[0] * 60, Math.min(H - 5, tip.y + down * a[1] * 60), { steps: 10 });
            await page.mouse.up(); await sleep(600);
        }
        t = await snap();
        const handMoved = !samePlaces(t.egates, fixedOwn);
        const undoBox = await boxOf('[data-testid="save-undo"]');
        const ways = [];
        if (undoBox) { await click(undoBox.x, undoBox.y, 700); ways.push('save-undo'); }
        for (let n = 0; n < 3 && !samePlaces((await snap()).egates, beforeOwn); n++) { await page.keyboard.press('Control+KeyZ'); await sleep(400); ways.push('Ctrl+Z'); }
        t = await snap();
        judge('own.handAfterFix', handMoved && samePlaces(t.egates, beforeOwn), { handMoved, undoShownAfterHandMove: !!undoBox, ways, back: samePlaces(t.egates, beforeOwn), line: t.topLine });
    }
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
