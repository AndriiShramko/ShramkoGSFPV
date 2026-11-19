// Lane ux4a, stage A-3 (docs/wip/ux4a.md, design voxux4 part ux4a): the acceptance of the one message service on the
// flight page, the pilot's own path with the MOUSE at 1536x730 (device scale 1.25) and at 844x390.
// Per size, on one page of scene 70b50d42 (Wroclaw), ?render=off (no picture is judged, no GPU lock):
//   a click into the scene (the pointer lock first), Esc frees the mouse;
//   4 the top-row Pause button -> "Generate course" with the course worker's script refused (page.route): the problem
//     line stays after 20 s, has a 44x44 cross, a fix line and "Send to the author", which opens the report form with
//     the problem's text in its message box (the form is closed by its cross, nothing is sent); the cross closes the line;
//   1 the route lifted, Pause -> "Generate course" again: a line appears, its font-size >= 16 px;
//   3 the course's progress lines replace each other in place (never two nodes under the key course.progress);
//   2 the "Gates: N ..." line stays at least shownMs(text) - 200 ms (messages-logic.ts: 3 s + 70 ms a character, 4-15 s);
//   5 the top-row Messages button opens the list, which holds the lines of 1 and 4; Shift+L closes and opens it; its
//     cross closes it; Esc closes it;
//   6 every 100 ms every message rectangle: inside the view, over no top-row button and no OSD block, outside the
//     middle third (wide view: its bottom above a third of the height; narrow or low: left of a third of the width).
// The old page (one .hud-note line) is read as one line, so the same run against the live site fails the steps the
// lane repairs. Read only there too: a course is only generated in the page, the report form is opened, never sent.
// Usage: node tools/bench/scripts/ux4a-messages-probe.mjs <base with /en> <out.json> [--scene 70b50d42] [--sizes 1536x730@1.25,844x390@1]
// Prints one line per step and, as the LAST line, one JSON verdict; exits 1 when a step fails.
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pickBrowser } from '../src/chrome.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '');
const require = createRequire(ROOT + '/tools/bench/package.json');
const { chromium } = require('playwright');
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
const scene = flag('--scene') ?? '70b50d42';
const sizes = (flag('--sizes') ?? '1536x730@1.25,844x390@1').split(',').map((s) => { const [wh, d] = s.split('@'); const [w, h] = wh.split('x').map(Number); return { w, h, dsf: Number(d ?? 1) }; });
const base = (args[0] ?? 'http://localhost:6040/en').replace(/\/$/, '');
const outFile = args[1] ?? `${ROOT}/.cache/ux4a-messages.json`;
mkdirSync(dirname(outFile), { recursive: true });

// the texts of the course feature (en), as patterns: the problem of a worker that did not load and the ready line
const course = JSON.parse(readFileSync(`${ROOT}/packages/i18n/locales/fly/course/en.json`, 'utf8'));
const pattern = (s) => '^' + s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\{n\\\}/g, '\\d+') + '$';
const FAILED = pattern(course['course.failed']);
const READY = pattern(course['course.ready']);
/** messages-logic.ts shownMs for an info or done line (copied numbers: BASE_MS 3000, MS_PER_CHAR 70, 4000-15000) */
const shownMs = (text) => Math.min(15000, Math.max(4000, 3000 + 70 * text.length));

const pick = pickBrowser({ expected: chromium.executablePath() });
const browser = await chromium.launch({ ...pick.launch, headless: true });
const out = { what: 'ux4a message service acceptance (ux4a-messages-probe.mjs)', base, scene, browser: pick.label ?? null, sizes: [], pass: false };
/** a Playwright error without its colours, its end (where the reason is) */
// eslint-disable-next-line no-control-regex
const errText = (e) => String(e && e.message).replace(/\u001b\[\d+m/g, '').slice(-600);
const save = () => writeFileSync(outFile, JSON.stringify(out, null, 1));

/** In the page: every 100 ms the lines of the message stack (the old page: the one .hud-note) and the faults of their place. */
const SAMPLER = () => {
    const S = window.__ux4a = { lines: {}, maxKeyNodes: 0, faults: {}, samples: 0 };
    const ids = new WeakMap();
    let next = 1;
    const vis = (e) => { if (!e || !e.isConnected) return false; const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
    const cut = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
    // a fault: where the line stood the first time, how many samples had it, and the top row then (fly.css note-crowded)
    const fault = (k, v) => {
        const f = S.faults[k];
        if (f) { f.n++; return; }
        const ui = document.getElementById('ui');
        const row = document.querySelector('.top-actions');
        const rr = row ? row.getBoundingClientRect() : null;
        S.faults[k] = { at: v, n: 1, t: Math.round(performance.now()), crowded: !!ui && ui.classList.contains('note-crowded'), row: rr ? `${Math.round(rr.left)},${Math.round(rr.top)} ${Math.round(rr.width)}x${Math.round(rr.height)}` : null };
    };
    const name = (e) => `${e.tagName.toLowerCase()}.${String(e.className).trim().split(/\s+/).slice(0, 2).join('.')}${e.dataset && e.dataset.action ? '[' + e.dataset.action + ']' : ''}`;
    setInterval(() => {
        const now = performance.now();
        const W = innerWidth, H = innerHeight;
        const root = document.querySelector('#ui > .hud-note') ?? document.querySelector('.hud-note');
        const stack = !!root && root.classList.contains('msg-stack');
        const els = !root ? [] : stack ? [...root.querySelectorAll(':scope > .msg, :scope > .msg-more')] : [root];
        const tops = [...document.querySelectorAll('.top-actions button')].filter(vis);
        const osd = [...document.querySelectorAll('#ui .osd')].filter((e) => vis(e) && (e.textContent ?? '').trim() !== '');
        const side = W < 900 || H < 500;
        let keyNodes = 0;
        for (const el of els) {
            if (!vis(el)) continue;
            if (el.dataset.key === 'course.progress') keyNodes++;
            const r = el.getBoundingClientRect();
            const where = `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`;
            if (r.left < -1 || r.top < -1 || r.right > W + 1 || r.bottom > H + 1) fault('outside the view', where);
            for (const b of tops) if (cut(r, b.getBoundingClientRect())) fault(`over ${name(b)}`, where);
            for (const o of osd) if (cut(r, o.getBoundingClientRect())) fault(`over ${name(o)}`, where);
            if (!side && r.bottom > H / 3 + 1) fault('wide view: below a third of the height', where);
            if (side && r.right > W / 3 + 1) fault('narrow view: in the middle third', where);
            if (el.classList.contains('msg-more')) continue;
            let id = ids.get(el);
            if (!id) { id = next++; ids.set(el, id); }
            const textEl = el.querySelector('.msg-text') ?? el;
            const text = (textEl.textContent ?? '').trim();
            const kind = el.dataset.kind ?? '?';
            const L = S.lines[id] = S.lines[id] ?? { id, key: el.dataset.key ?? null, texts: {}, kinds: [], font: parseFloat(getComputedStyle(textEl).fontSize) };
            const T = L.texts[text] = L.texts[text] ?? { first: now, kind };
            T.last = now;
            if (L.kinds[L.kinds.length - 1] !== kind) L.kinds.push(kind);
        }
        S.maxKeyNodes = Math.max(S.maxKeyNodes, keyNodes);
        S.samples++;
    }, 100);
};

/** The lines seen so far, flat: one row per (node, text). */
const seen = (page) => page.evaluate(() => {
    const S = window.__ux4a;
    const rows = [];
    for (const L of Object.values(S.lines)) for (const [text, T] of Object.entries(L.texts)) rows.push({ id: L.id, key: L.key, font: L.font, kind: T.kind, text, first: T.first, last: T.last, ms: Math.round(T.last - T.first) });
    return { rows, maxKeyNodes: S.maxKeyNodes, faults: S.faults, samples: S.samples, now: performance.now() };
});

async function pollUntil(page, fn, ms) {
    const t0 = Date.now();
    for (;;) {
        const s = await seen(page);
        if (fn(s) || Date.now() - t0 > ms) return s;
        await page.waitForTimeout(250);
    }
}

async function runSize({ w, h, dsf }) {
    const res = { size: `${w}x${h}@${dsf}`, steps: {}, errors: [] };
    out.sizes.push(res);
    const step = (n, name, pass, detail) => { res.steps[n] = { name, pass: !!pass, ...detail }; console.log(`${res.size} step ${n} ${pass ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(detail).slice(0, 300)}`); save(); };
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dsf });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => res.errors.push(String(e.message).slice(0, 160)));
    let refuse = true;
    await page.route('**/fly/assets/worker-*.js', (r) => (refuse ? r.abort() : r.continue()));
    await page.goto(`${base}/fly/?scene=${scene}&nowarn=1&set.input.howToFly=false&render=off`, { waitUntil: 'load', timeout: 120000 });
    await page.waitForFunction(() => ['ready', 'error'].includes(window.__gsfpv && window.__gsfpv.status), null, { timeout: 300000 });
    await page.waitForFunction(() => { const x = window.__gsfpv && window.__gsfpv.walls; return x && x.state !== 'checking'; }, null, { timeout: 120000 }).catch(() => 0);
    res.status = await page.evaluate(() => ({ status: window.__gsfpv.status, walls: window.__gsfpv.walls ? window.__gsfpv.walls.state : null }));
    await page.waitForTimeout(1500);
    const radioX = page.locator('.screen.radio [data-action=radio-close]');
    if (await radioX.count()) { await radioX.first().click(); await page.waitForTimeout(600); }
    await page.evaluate(SAMPLER);
    // the pointer lock first: a click into the scene; Esc frees the mouse (and opens the pause menu)
    await page.mouse.click(Math.round(w / 2), Math.round(h * 0.55));
    await page.waitForTimeout(400);
    res.pointerLock = await page.evaluate(() => !!document.pointerLockElement);
    res.escFrees = 0;
    /** the pilot's Esc when the flight holds the mouse (the page takes it back after every window): the cursor is free to click */
    const free = async () => {
        if (!(await page.evaluate(() => !!document.pointerLockElement))) return;
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
        res.escFrees++;
    };
    await free();
    const centre = () => page.mouse.move(Math.round(w / 2), Math.round(h * 0.6));
    const generate = async () => {
        await free();
        if (!(await page.locator('[data-action="pause.course"]').isVisible().catch(() => false))) {
            await page.locator('.top-actions [data-action=pause]').click({ timeout: 5000 });
        }
        await page.locator('[data-action="pause.course"]').click({ timeout: 5000 });
        await centre();
    };

    // ---- 4: a problem stays, says what to do, and goes to the author ----
    try {
        await generate();
        const failedAt = Date.now();
        const s = await pollUntil(page, (q) => q.rows.some((r) => new RegExp(FAILED).test(r.text)), 240000);
        const p0 = s.rows.find((r) => new RegExp(FAILED).test(r.text));
        if (!p0) throw new Error(`no problem line in ${Math.round((Date.now() - failedAt) / 1000)} s: ${JSON.stringify(s.rows.map((r) => r.text)).slice(0, 200)}`);
        await page.waitForTimeout(20500);
        const s2 = await seen(page);
        const p = s2.rows.find((r) => r.id === p0.id && r.text === p0.text);
        const stays = !!p && s2.now - p.last < 400 && p.ms >= 20000;
        const parts = await page.evaluate(() => {
            const el = [...document.querySelectorAll('.hud-note .msg-problem, .hud-note')].find((e) => /\S/.test(e.textContent ?? ''));
            if (!el) return null;
            const x = el.querySelector('.msg-x');
            const r = x ? x.getBoundingClientRect() : null;
            const at = r ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null;
            return { cross: r ? { w: Math.round(r.width), h: Math.round(r.height), free: !!at && (at === x || x.contains(at)) } : null, fix: (el.querySelector('.msg-fix')?.textContent ?? '').trim(), send: !!el.querySelector('.msg-send') };
        });
        res.problemText = p0.text;
        // the pilot frees the mouse with Esc (the flight holds it): the pause menu opens and the line waits under it
        await free();
        const menuUp = () => page.locator('[data-action="pause.continue"]').isVisible().catch(() => false);
        if (!(await menuUp())) await page.locator('.top-actions [data-action=pause]').click({ timeout: 5000 });
        await page.waitForTimeout(400);
        const underMenu = await page.evaluate(() => { const n = document.querySelector('#ui > .hud-note'); return !!n && (n.hidden || !n.querySelector('.msg-problem')); });
        // the menu leads to the Messages list; there the problem has its Send to the author
        await page.locator('[data-action="pause.messages"]').click({ timeout: 5000 });
        await page.waitForTimeout(600);
        const inList = await page.evaluate((text) => [...document.querySelectorAll('.messages-panel .msg-item.msg-problem')].some((li) => (li.querySelector('.msg-text')?.textContent ?? '').trim() === text && !!li.querySelector('.msg-send') && (li.querySelector('.msg-fix')?.textContent ?? '').trim() !== ''), p0.text);
        await page.locator('.messages-panel .msg-item.msg-problem .msg-send').first().click({ timeout: 5000 });
        await page.waitForTimeout(800);
        const form = await page.evaluate(() => { const m = document.querySelector('[data-testid=fb-message]'); return m ? { value: m.value } : null; });
        const fx = page.locator('.panel:has([data-testid=fb-message]) .panel-x');
        if (await fx.count()) await fx.first().click();
        await page.waitForTimeout(600);
        if (await menuUp()) { await page.keyboard.press('Escape'); await page.waitForTimeout(500); }
        const inForm = !!form && form.value.includes(p0.text);
        // seen in the list: the problem left the screen (it stays in the list)
        const offScreen = await page.evaluate(() => !document.querySelector('#ui > .hud-note:not([hidden]) .msg-problem'));
        await centre();
        step(4, 'a problem stays 20 s with a 44 px cross and a fix line; Esc, Messages, Send to the author opens the form with its text',
            stays && parts?.cross && parts.cross.w >= 44 && parts.cross.h >= 44 && parts.cross.free && parts.fix.length > 0 && underMenu && inList && inForm && offScreen,
            { text: p0.text, shownMs: p ? p.ms : null, cross: parts?.cross ?? null, fix: parts?.fix ?? null, send: parts?.send ?? false, underMenu, inList, formHasText: inForm, offScreenAfterList: offScreen });
    } catch (e) { step(4, 'a problem stays', false, { error: errText(e) }); }

    // ---- 1, 3, 2: the course made: a readable line, progress in place, the ready line long enough ----
    try {
        refuse = false;
        await page.waitForTimeout(300);
        await generate();
        const s = await pollUntil(page, (q) => q.rows.some((r) => new RegExp(READY).test(r.text) && q.now - r.last > 300), 300000);
        const ready = s.rows.find((r) => new RegExp(READY).test(r.text));
        const after = s.rows.filter((r) => !new RegExp(FAILED).test(r.text) && r.first > (s.rows.find((x) => new RegExp(FAILED).test(x.text))?.last ?? 0));
        const first = after[0] ?? null;
        step(1, 'Generate course: a line appears, its font-size >= 16 px', !!first && first.font >= 16, { text: first?.text ?? null, font: first?.font ?? null });
        const prog = after.filter((r) => r.key === 'course.progress' || (r.kind === '?' && !new RegExp(READY).test(r.text)));
        const nodes = new Set(prog.map((r) => r.id));
        step(3, 'progress lines replace in place (one node under course.progress)', prog.length >= 2 && nodes.size === 1 && s.maxKeyNodes <= 1,
            { texts: prog.length, nodes: nodes.size, maxNodesAtOnce: s.maxKeyNodes, sample: prog.slice(0, 3).map((r) => r.text) });
        res.readyText = ready?.text ?? null;
        const need = ready ? shownMs(ready.text) - 200 : null;
        step(2, 'the ready line stays >= shownMs(text) - 200 ms', !!ready && ready.ms >= need, { text: ready?.text ?? null, shownMs: ready?.ms ?? null, need });
    } catch (e) { step(1, 'Generate course', false, { error: errText(e) }); }

    // ---- 5: the Messages list ----
    try {
        const open = () => page.evaluate(() => { const p = document.querySelector('.messages-panel'); return !!p && p.getBoundingClientRect().height > 0; });
        const btn = page.locator('.top-actions [data-action=messages-open]');
        const has = (await btn.count()) > 0 && await btn.first().isVisible();
        const r = { button: has };
        if (has) {
            await free();
            await btn.first().click({ timeout: 5000 });
            await page.waitForTimeout(500);
            r.opened = await open();
            const items = await page.evaluate(() => [...document.querySelectorAll('.messages-panel .msg-item .msg-text')].map((e) => (e.textContent ?? '').trim()));
            r.items = items.length;
            r.hasProblem = !!res.problemText && items.includes(res.problemText);
            r.hasReady = !!res.readyText && items.includes(res.readyText);
            const x = await page.evaluate(() => { const e = document.querySelector('.messages-panel .panel-x'); const b = e ? e.getBoundingClientRect() : null; return b ? { w: Math.round(b.width), h: Math.round(b.height) } : null; });
            r.cross = x;
            await page.locator('.messages-panel .panel-x').first().click({ timeout: 3000 }).catch(() => 0); await page.waitForTimeout(400);
            r.crossCloses = !(await open());
            // the pause menu Esc opened to free the mouse goes with its own Esc; then Shift+L works in the flight
            r.menuAfterList = await page.locator('[data-action="pause.continue"]').isVisible().catch(() => false);
            if (r.menuAfterList) { await page.keyboard.press('Escape'); await page.waitForTimeout(500); }
            await page.keyboard.press('Shift+KeyL'); await page.waitForTimeout(400);
            r.shiftHOpens = await open();
            await page.keyboard.press('Shift+KeyL'); await page.waitForTimeout(400);
            r.shiftHCloses = !(await open());
            await page.keyboard.press('Shift+KeyL'); await page.waitForTimeout(400);
            const again = await open();
            r.lockBeforeEsc = await page.evaluate(() => !!document.pointerLockElement);
            await page.keyboard.press('Escape'); await page.waitForTimeout(400);
            r.menuAfterEsc = await page.locator('[data-action="pause.continue"]').isVisible().catch(() => false);
            r.escCloses = again && !(await open());
        }
        step(5, 'the top-row Messages button opens the list with 1 and 4; Shift+L toggles it; its cross and Esc close it',
            has && r.opened && r.hasProblem && r.hasReady && r.cross && r.cross.w >= 44 && r.cross.h >= 44 && r.shiftHCloses && r.shiftHOpens && r.crossCloses && r.escCloses, r);
    } catch (e) { step(5, 'the Messages list', false, { error: errText(e) }); }

    // ---- 7 (the review's step): the pause menu's Messages item names its key; one press of Shift+L there opens the list ----
    try {
        const open = () => page.evaluate(() => { const p = document.querySelector('.messages-panel'); return !!p && p.getBoundingClientRect().height > 0; });
        const r = {};
        if (await open()) { await page.locator('.messages-panel .panel-x').first().click({ timeout: 3000 }).catch(() => 0); await page.waitForTimeout(400); }
        await free();
        const menuUp = () => page.locator('[data-action="pause.continue"]').isVisible().catch(() => false);
        if (!(await menuUp())) await page.locator('.top-actions [data-action=pause]').click({ timeout: 5000 });
        await page.waitForTimeout(400);
        r.menu = await menuUp();
        r.itemKey = (await page.locator('[data-action="pause.messages"]').first().textContent({ timeout: 3000 }).catch(() => '') ?? '').includes('Shift+L');
        await page.keyboard.press('Shift+KeyL'); await page.waitForTimeout(500);
        r.opened = await open();
        await page.keyboard.press('Escape'); await page.waitForTimeout(400);
        r.escCloses = !(await open());
        step(7, 'with the pause menu up, key Shift+L (named on its Messages item) opens the list at one press; Esc closes it', r.menu && r.itemKey && r.opened && r.escCloses, r);
    } catch (e) { step(7, 'Shift+L in the pause menu', false, { error: errText(e) }); }

    // ---- 8 (the review's repair): in the course editor's edit mode (key Shift+B, the course of steps 1-3) the pilot
    //      presses three keys that work only in flight (Shift+L, Shift+N, P): the page says once, in place, what to press
    //      (one line, no amber problem, no "Send to the author") and the line goes by itself (it stayed for good before) ----
    try {
        const edit = () => page.evaluate(() => !!document.querySelector('.course-editor:not(.ce-flying)'));
        const lines = () => page.evaluate(() => [...document.querySelectorAll('#ui > .hud-note:not([hidden]) > .msg:not([hidden])')]
            .map((e) => ({ kind: e.dataset.kind ?? '?', text: (e.querySelector('.msg-text')?.textContent ?? '').trim(), send: !!e.querySelector('.msg-send') }))
            .filter((l) => / in flight, /.test(l.text)));
        const r = {};
        if (await page.locator('[data-action="pause.continue"]').isVisible().catch(() => false)) { await page.keyboard.press('Escape'); await page.waitForTimeout(500); }
        await page.keyboard.press('Shift+KeyB'); await page.waitForTimeout(2500);
        r.editMode = await edit();
        for (const k of ['Shift+KeyL', 'Shift+KeyN', 'KeyP']) { await page.keyboard.press(k); await page.waitForTimeout(400); }
        const now = await lines();
        r.lines = now.length;
        r.said = now[0]?.text ?? null;
        r.problems = now.filter((l) => l.kind === 'problem' || l.send).length;
        await page.waitForTimeout(16000);
        r.after16s = (await lines()).length;
        step(8, 'edit mode: three keys of the flight give one line saying what to press, no problem, gone by itself',
            r.editMode && r.lines === 1 && /\bP\b/.test(r.said ?? '') && r.problems === 0 && r.after16s === 0, r);
    } catch (e) { step(8, 'refused keys in the edit mode', false, { error: errText(e) }); }

    // ---- 6: where every line stood, every 100 ms of the run ----
    const s = await seen(page);
    step(6, 'every message: inside the view, over no top-row button or OSD, outside the middle third', s.samples > 100 && Object.keys(s.faults).length === 0, { samples: s.samples, faults: s.faults });
    res.lines = s.rows.map((r) => ({ id: r.id, key: r.key, kind: r.kind, ms: r.ms, font: r.font, text: r.text.slice(0, 100) }));
    await ctx.close();
}

try {
    for (const sz of sizes) await runSize(sz);
} catch (e) { out.error = String(e.message).slice(0, 300); }
const all = out.sizes.flatMap((z) => [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ size: z.size, n, pass: z.steps[n]?.pass === true })));
out.pass = !out.error && all.length === sizes.length * 8 && all.every((x) => x.pass);
save();
await browser.close();
console.log(JSON.stringify({ base, pass: out.pass, steps: Object.fromEntries(out.sizes.map((z) => [z.size, Object.fromEntries(Object.entries(z.steps).map(([n, v]) => [n, v.pass ? 'PASS' : 'FAIL']))])), error: out.error ?? null }));
process.exit(out.pass ? 0 : 1);
