// Lane edit4s, stage S3 (docs/wip/edit4s.md): the acceptance of saving (E6 drafts, E7 the corrections offer, E9 the save
// that failed for a generated course), walked with the MOUSE as the pilot does it, at 1536x730 with device scale 1.25.
// One generated course (the link course=g1.<seed>) carries every step, in this order:
//   open: Keyboard on the Controls screen, a click into the scene (the pointer lock), the course, Shift+B
//   s8  (local) the API is made to answer 429 (the probe's own helper posts refused bodies for the page's client until the
//       creates are full), the name 'Andrii Shramko' is typed, Save: the line says kept as a draft and the time, Save again
//       is there, the course is unchanged and a draft exists
//   s7  (local) the API is started again (the hour is over), Save, the course untouched: saved, no failure
//   s1  gate 2 selected by a click and moved with the gizmo (the arrow key when the gizmo gets no drag in this mode)
//   s2  within 3 s a draft newer than the move exists (hook edit4.s.drafts)
//   s3  the page reloaded, the editor opened: gate 2 stands where it was moved, the line says the course is back
//   s4  Versions in the editor's window lists at least one entry with its time
//   s5  gate 3 turned by 180 deg (key ] 12 times), Save: the offer of small corrections names gate 3
//   s6  Correct and save: the view pulls back until every gate is on screen, gate 3 selected, the line lists the change,
//       and the version is stored (201)
//   node tools/bench/scripts/edit4s-probe.mjs <dist|https://live/en> <scan> <seed> <out.json>
// With a dist folder the probe serves it (serve-csp.mjs, port PORT or 5980) and starts the local API (server.py, port
// API_PORT or 5981, a fresh DATA_DIR under TEMP). With an https address (the live site, the negative control) every
// request but GET to /api/ is aborted by the probe, s7 and s8 are not run (they store a course) and nothing is saved.
// ?render=off: the scan is not drawn; headless (tools/bench/src/chrome.mjs). Exit 1 when a step fails.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pickBrowser } from '../src/chrome.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [where, scan, seedArg, outPath] = process.argv.slice(2);
if (!where || !scan || !seedArg || !outPath) {
    console.error('usage: edit4s-probe.mjs <dist|https://site/en> <scan> <seed> <out.json>');
    process.exit(2);
}
const env = process.env;
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const LIVE = /^https?:/.test(where);
const PORT = Number(env.PORT || 5980);
const API_PORT = Number(env.API_PORT || 5981);
const TEMP = env.TEMP_DIR || 'U:/Temp/gsfpv-train4/edit4s';
const base = LIVE ? where.replace(/\/$/, '') : `http://localhost:${PORT}/en`;
const API = `http://127.0.0.1:${API_PORT}`;
const CLIENT = '198.51.100.1'; // the address serve-csp.mjs gives every page request (as nginx gives the real one)
const W = 1536, H = 730, DSF = 1.25;
const NAME = 'Andrii Shramko';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r3 = (v) => (Array.isArray(v) ? v.map((x) => Math.round(x * 1000) / 1000) : v);
const dist3 = (a, b) => (a && b ? Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) : -1);
const CLOCK = /\b\d{1,2}[:.]\d{2}\b/;

const res = { address: base, live: LIVE, scan, seed: Number(seedArg), size: [W, H], dsf: DSF, date: new Date().toISOString(), steps: {}, posts: [], notRun: [] };
const fails = [];
const judge = (step, ok, why) => { res.steps[step] = { ok: !!ok, ...why }; if (!ok) fails.push(step); console.log(`${step}: ${ok ? 'PASS' : 'FAIL'} ${JSON.stringify(why).slice(0, 260)}`); };

// ---- the local site and API (never with the live address)
const kids = [];
let apiKid = null;
const DATA = join(TEMP, `api-data-${Date.now()}`);
async function until(fn, ok, ms, step = 400) {
    const t0 = Date.now();
    let v = await fn();
    while (!ok(v) && Date.now() - t0 < ms) { await sleep(step); v = await fn(); }
    return { ok: ok(v), v, ms: Date.now() - t0 };
}
const health = () => fetch(`${API}/api/health`).then((r) => r.ok).catch(() => false);
async function startApi() {
    mkdirSync(DATA, { recursive: true });
    apiKid = spawn('python', [join(REPO, 'apps', 'api', 'server.py')], { env: { ...env, DATA_DIR: DATA, PORT: String(API_PORT), TG_BOT_TOKEN: '', TG_CHAT_ID: '', MIN_FREE_GB: '0' }, stdio: 'ignore' });
    if (!(await until(health, (v) => v, 30000, 300)).ok) throw new Error('the local API did not answer /api/health');
}
async function stopApi() {
    if (!apiKid) return;
    apiKid.kill();
    await until(health, (v) => !v, 10000, 200);
    apiKid = null;
}
/** the probe's api helper: refused bodies (no length) for the page's client until a create answers 429 */
async function fillCreates() {
    for (let n = 1; n <= 200; n++) {
        const r = await fetch(`${API}/api/tracks`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': CLIENT }, body: '' });
        if (r.status === 429) return { posts: n, retryAfter: r.headers.get('retry-after') };
    }
    return { posts: 200, retryAfter: null };
}

const SNAP = `(() => {
    const h = window.__gsfpv || {}; const c = h.course || {}; const e = c.editor || {};
    let v = null; try { v = window.__gsfpvEditView ? window.__gsfpvEditView() : null; } catch (x) { v = null; }
    const tb = document.querySelector('.ce-topbar');
    const s = v && v.edit4 ? v.edit4.s : null;
    return { status: h.status ?? null, open: !!e.open, selected: e.selected ?? null, said: String(e.said || '').slice(0, 220),
        topLine: tb ? String((tb.querySelector('.ce-tb-line') || {}).textContent || '').slice(0, 220) : null, mode: v && v.mode,
        courseGates: c.gates ?? null, courseOn: !!c.on, source: c.source ?? null, saved: c.saved ?? null,
        gates: v ? v.gates : null, stand: v && v.stand ? v.stand.screen : null, axes: v ? v.axes : null, tool: v ? v.tool : null,
        egates: v && v.course ? v.course.gates.map((g) => g.pos) : null, equats: v && v.course ? v.course.gates.map((g) => g.quat) : null,
        s4: s ? { drafts: s.drafts ?? null, newest: s.newest ?? null, restored: s.restored ?? null, save: s.save ? { status: s.save.problem ? s.save.problem.status : null, key: s.save.key, againAt: s.save.again ? s.save.again.at : null } : null, fix: s.fix ?? null } : null,
        lock: document.pointerLockElement ? document.pointerLockElement.tagName : null, href: location.href };
})()`;

const pick = pickBrowser({ expected: chromium.executablePath() });
let browser = null;
const log = [];
try {
    if (!LIVE) {
        kids.push(spawn(process.execPath, [join(REPO, 'tools', 'bench', 'scripts', 'serve-csp.mjs'), resolve(where), String(PORT)], { env: { ...env, API_PROXY: API }, stdio: 'ignore' }));
        await startApi();
        if (!(await until(() => fetch(`${base}/fly/`).then((r) => r.ok).catch(() => false), (v) => v, 30000, 300)).ok) throw new Error('the local site did not answer');
    }
    browser = await chromium.launch({ ...pick.launch, headless: true });
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DSF });
    // the live site: nothing is saved, sent or created (every request but GET to /api/ is aborted)
    await ctx.route((u) => u.pathname.startsWith('/api/'), (route) => {
        const m = route.request().method();
        if (LIVE && m !== 'GET' && m !== 'HEAD') { res.posts.push({ aborted: route.request().url().slice(0, 120), method: m }); return route.abort(); }
        return route.continue();
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => log.push(`pageerror: ${e.message}`.slice(0, 300)));
    page.on('response', (r) => { const q = r.request(); if (q.method() === 'POST' && new URL(r.url()).pathname.startsWith('/api/tracks')) res.posts.push({ path: new URL(r.url()).pathname, status: r.status(), at: Date.now() }); });
    const cdp = await ctx.newCDPSession(page);
    const snap = () => page.evaluate(SNAP);
    const KEYS = { BracketRight: [']', 221], ArrowRight: ['ArrowRight', 39], KeyB: ['b', 66], Space: [' ', 32] };
    async function key(code, { shift = false, hold = 60 } = {}) {
        const [k0, vk] = KEYS[code];
        const k = shift && k0.length === 1 ? k0.toUpperCase() : k0;
        const text = k.length === 1 ? k : undefined;
        if (shift) await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', code: 'ShiftLeft', key: 'Shift', windowsVirtualKeyCode: 16, modifiers: 8 });
        await cdp.send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', code, key: k, text, unmodifiedText: text, windowsVirtualKeyCode: vk, modifiers: shift ? 8 : 0 });
        await sleep(hold);
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: k, windowsVirtualKeyCode: vk, modifiers: shift ? 8 : 0 });
        if (shift) await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'ShiftLeft', key: 'Shift', windowsVirtualKeyCode: 16, modifiers: 0 });
    }
    const boxOf = (sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e || !e.getClientRects().length || e.closest('[hidden]')) return null; const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width, h: b.height, disabled: !!e.disabled, text: (e.textContent || '').trim().slice(0, 200) }; }, sel);
    async function click(x, y, after = 600) { await page.mouse.move(x, y, { steps: 4 }); await page.mouse.click(x, y); await sleep(after); }
    async function clickSel(sel, after = 600) { const b = await boxOf(sel); if (!b) return null; await click(b.x, b.y, after); return b; }

    /** load the page, Keyboard on the Controls screen, a click into the scene, the course, Shift+B */
    async function openEditor(url) {
        if (url) await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
        else await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
        const ready = await until(snap, (s) => s.status === 'ready' || s.status === 'error', 300000, 1000);
        if (ready.v.status !== 'ready') throw new Error(`page status ${ready.v.status}`);
        const KB = '.screen.radio [data-action="radio-keyboard"]';
        if (await page.waitForSelector(KB, { timeout: 15000 }).then(() => true).catch(() => false)) await clickSel(KB, 1500);
        await click(W / 2, H / 2, 900);
        const lock = (await snap()).lock;
        const gen = await until(snap, (s) => (s.courseGates ?? 0) > 0 && s.courseOn, 600000, 1000);
        if (!gen.ok) throw new Error('no course');
        await sleep(1500);
        await key('KeyB', { shift: true });
        const op = await until(snap, (s) => s.open && Array.isArray(s.egates), 30000, 400);
        await sleep(1500);
        return { ok: op.ok, lock, courseMs: gen.ms, gates: gen.v.courseGates, source: gen.v.source };
    }
    /** the top bar's Save; the name typed first when the window asks for it */
    async function pressSave() {
        const nb = await boxOf('.course-editor .ce-name');
        const typed = await page.evaluate(() => document.querySelector('.course-editor .ce-name')?.value ?? '');
        if (nb && typed.trim() !== NAME) { await click(nb.x, nb.y, 200); await page.keyboard.press('Control+A'); await page.keyboard.type(NAME); }
        const t0 = Date.now();
        const b = await clickSel('.ce-topbar [data-top="save"]', 400);
        if (!b) return null;
        const s = await snap();
        if (await page.evaluate(() => document.activeElement?.classList?.contains('ce-name') && !document.activeElement.value)) {
            await page.keyboard.type(NAME);
            await clickSel('.ce-topbar [data-top="save"]', 400);
        }
        return { t0, said: s.said };
    }
    /** a gate selected by a click on it as the pilot does (Tab when no click got it), at most 4 tries */
    async function selectGate(i) {
        for (let n = 0; n < 4; n++) {
            const s = await snap();
            if (s.selected === i) return 'already';
            const g = s.gates?.[i];
            const free = g && g[2] > 0 && g[0] > 20 && g[0] < W - 20 && g[1] > 60 && g[1] < H - 20 && (!s.stand || Math.hypot(g[0] - s.stand[0], g[1] - s.stand[1]) > 120);
            if (!free) break;
            await click(g[0], g[1], 500);
            if ((await snap()).selected === i) return 'click';
        }
        for (let n = 0; n < 40 && (await snap()).selected !== i; n++) { await page.keyboard.press('Tab'); await sleep(250); }
        return (await snap()).selected === i ? 'tab' : null;
    }

    const url = `${base}/fly/?scene=${scan}&course=g1.${Number(seedArg).toString(36)}&render=off&nowarn=1`;
    const o = await openEditor(url);
    res.open = o;
    judge('open', o.ok, o);
    if (!o.ok) throw new Error('edit view did not open');

    if (LIVE) res.notRun.push('s8', 's7');
    else {
        // s8: the creates of the hour are full; an untouched generated course, Save
        const fill = await fillCreates();
        const before = await snap();
        const p = await pressSave();
        const after = (await until(snap, (s) => s.s4?.save?.status != null, 15000, 300)).v;
        await sleep(600);
        const again = await boxOf('.course-editor .ce-save-again');
        const line = after.topLine || after.said;
        judge('s8.failKept', after.s4?.save?.status === 429 && after.s4.save.againAt !== null && !!again && CLOCK.test(line) && JSON.stringify(after.egates) === JSON.stringify(before.egates) && (after.s4.drafts ?? 0) >= 1,
            { fill, pressed: !!p, status: after.s4?.save?.status ?? null, key: after.s4?.save?.key ?? null, line, again, drafts: after.s4?.drafts ?? null, unchanged: JSON.stringify(after.egates) === JSON.stringify(before.egates) });
        // s7: the hour is over (the API started again), the same untouched course, Save
        await stopApi();
        await startApi();
        await pressSave();
        const sv = await until(snap, (s) => !!s.saved || (s.s4?.save?.status != null && s.s4.save.status !== 429), 20000, 300);
        await sleep(800);
        const s7 = await snap();
        judge('s7.untouchedSaved', !!s7.saved && s7.s4?.save?.status == null, { saved: s7.saved, problem: s7.s4?.save ?? null, line: s7.topLine || s7.said, href: s7.href, posts: res.posts.slice(-2) });
    }

    // s1: gate 2 selected by a click, moved with the gizmo (the arrow key when the gizmo takes no drag here)
    const by = await selectGate(1);
    let s = await snap();
    const from = s.egates?.[1] ?? null;
    let moved = null;
    if (by !== null && s.stand && s.axes) {
        for (const ax of ['x', 'z', 'y']) {
            const a = s.axes[ax];
            for (const r of [40, 60, 85, 25]) {
                const x0 = s.stand[0] + a[0] * r, y0 = s.stand[1] + a[1] * r;
                await page.mouse.move(x0, y0, { steps: 3 });
                await sleep(120);
                await page.mouse.down();
                await page.mouse.move(x0 + a[0] * 70, y0 + a[1] * 70, { steps: 10 });
                await page.mouse.up();
                await sleep(500);
                s = await snap();
                if (s.selected === 1 && dist3(s.egates?.[1], from) > 0.05) { moved = { by: 'gizmo', axis: ax, r }; break; }
                if (s.selected !== 1) await selectGate(1);
            }
            if (moved) break;
        }
    }
    if (!moved && (await snap()).selected === 1) { await key('ArrowRight'); await sleep(400); s = await snap(); if (dist3(s.egates?.[1], from) > 0.05) moved = { by: 'key ArrowRight (the gizmo took no drag)' }; }
    const tMove = Date.now();
    s = await snap();
    const movedTo = s.egates?.[1] ?? null;
    judge('s1.moveGate2', !!moved, { select: by, moved, from: r3(from), to: r3(movedTo), m: Math.round(dist3(from, movedTo) * 100) / 100 });

    // s2: a draft within 3 s
    const d = await until(snap, (x) => (x.s4?.newest ?? 0) >= tMove - 50, 3000, 200);
    judge('s2.draftIn3s', d.ok, { ms: d.ms, drafts: d.v.s4?.drafts ?? null, newest: d.v.s4?.newest ?? null, edit4: !!d.v.s4 });

    // s3: reload, open: gate 2 where it was, the line says it is back
    await sleep(500);
    const o2 = await openEditor(null);
    s = await snap();
    const back = s.egates?.[1] ?? null;
    const line3 = `${s.topLine} | ${s.said}`;
    judge('s3.restored', o2.ok && dist3(back, movedTo) >= 0 && dist3(back, movedTo) < 0.01 && s.s4?.restored != null && CLOCK.test(line3),
        { open: o2, gate2: r3(back), want: r3(movedTo), m: Math.round(dist3(back, movedTo) * 1000) / 1000, restored: s.s4?.restored ?? null, line: line3 });

    // s4: Versions in the window: the window opens closed (lane editor3 H1), the pilot clicks its title, then turns the
    // wheel over it until the list is in view
    const opened = await page.evaluate(() => document.querySelector('.course-editor')?.classList.contains('ce-open') ?? false);
    if (!opened) await clickSel('.course-editor .ce-drawer', 500);
    const versOf = () => page.evaluate(() => [...document.querySelectorAll('.course-editor .ce-version-list .ce-version-back')].map((b) => { const r = b.getBoundingClientRect(); const w = document.querySelector('.course-editor').getBoundingClientRect(); return { text: b.textContent.trim().slice(0, 90), shown: r.width > 0 && r.height > 0 && r.top >= Math.max(0, w.top) - 1 && r.bottom <= Math.min(innerHeight, w.bottom) + 1 }; }));
    let vers = await versOf();
    let wheels = 0;
    const wb = await boxOf('.course-editor');
    for (; wb && wheels < 8 && vers.length > 0 && !vers[0].shown; wheels++) { await page.mouse.move(wb.x, wb.y); await page.mouse.wheel(0, 250); await sleep(300); vers = await versOf(); }
    judge('s4.versions', vers.length >= 1 && vers[0].shown && CLOCK.test(vers[0].text), { openedBy: opened ? 'already open' : 'its title', wheels, n: vers.length, first: vers.slice(0, 3) });

    // s5: gate 3 turned by 180 deg, Save: the offer names gate 3
    const by3 = await selectGate(2);
    const q0 = (await snap()).equats?.[2] ?? null;
    for (let n = 0; n < 12; n++) { await key('BracketRight'); await sleep(90); }
    await sleep(500);
    const q1 = (await snap()).equats?.[2] ?? null;
    await pressSave();
    const off = await until(async () => ({ b: await boxOf('.course-editor .ce-fix-offer'), s: await snap() }), (x) => !!x.b || (x.s.s4?.fix?.offered?.length ?? 0) > 0, 30000, 300);
    const offer = await boxOf('.course-editor .ce-fix-offer .ce-fix-text');
    const cross = await boxOf('.course-editor .ce-fix-offer .ce-fix-close');
    judge('s5.offer', !!offer && /\b3\b/.test(offer.text) && (off.v.s.s4?.fix?.offered ?? []).some((f) => f.gates.includes(3)),
        { select: by3, turned: !!q0 && !!q1 && JSON.stringify(q0) !== JSON.stringify(q1), text: offer?.text ?? null, offered: off.v.s.s4?.fix?.offered ?? null, cross: cross ? [Math.round(cross.w), Math.round(cross.h)] : null, line: off.v.s.topLine || off.v.s.said });

    // s6: Correct and save: the overview, gate 3 selected, the change listed, the version stored
    const yes = await boxOf('.course-editor .ce-fix-yes');
    let most = 0, n6 = 0;
    const tYes = Date.now();
    if (yes) {
        await click(yes.x, yes.y, 50);
        for (let t0 = Date.now(); Date.now() - t0 < 15000; ) {
            const x = await snap();
            const on = (x.gates || []).filter((g) => g[2] > 0 && g[0] >= 0 && g[0] <= W && g[1] >= 0 && g[1] <= H).length;
            most = Math.max(most, on);
            n6 = x.egates?.length ?? n6;
            if (x.s4?.fix?.done && res.posts.some((p) => p.at >= tYes)) break;
            await sleep(150);
        }
        await sleep(1500);
    }
    s = await snap();
    const stored = res.posts.filter((p) => p.at >= tYes);
    judge('s6.correctAndSave', !!yes && most === n6 && n6 > 0 && s.selected === 2 && /\b3\b/.test(s.s4?.fix?.done ?? '') && stored.some((p) => p.status === 201) && s.s4?.save?.status == null,
        { yes: !!yes, gatesOnScreenMost: most, gates: n6, selected: s.selected, done: s.s4?.fix?.done ?? null, line: s.topLine || s.said, stored, problem: s.s4?.save ?? null });
} catch (e) {
    res.error = String(e).slice(0, 400);
    fails.push('error');
}
res.fails = fails;
res.log = log.slice(0, 30);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(res, null, 1));
await browser?.close().catch(() => {});
await stopApi().catch(() => {});
for (const k of kids) k.kill();
console.log(JSON.stringify({ verdict: fails.length ? 'FAIL' : 'PASS', address: base, fails, steps: Object.fromEntries(Object.entries(res.steps).map(([k, v]) => [k, v.ok ? 'PASS' : 'FAIL'])), notRun: res.notRun, error: res.error ?? null }));
process.exit(fails.length ? 1 : 0);
