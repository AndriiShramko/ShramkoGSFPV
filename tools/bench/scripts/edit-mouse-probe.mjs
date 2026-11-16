// Lane editfix, stage E1-find (docs/wip/editfix.md): the owner's path into the course edit mode, walked as a person does it,
// with the mouse, on a laptop-like screen. Load the scan, close the Controls screen by a click, click into the scene (the page
// takes the pointer lock), take off, Shift+G, wait for the course, Shift+B; then in the edit view: (a) move the view by keys,
// right drag, left drag and wheel; (b) click a gate in view; (c) Add gate on the top bar, then a click on the scene; (d) every
// other control of the top bar and of the editor's window once; (e) Exit. Each step is judged by the page's state; each click
// records the pointer lock before it, the element under the point, the pointer-events of it and its ancestors, and whether
// the window saw the pointerdown and the click (capture phase).
//   node tools/bench/scripts/edit-mouse-probe.mjs <address with /en> <scan> <WxH> <device scale> <touch 0|1> <layout en|ru|pl> <name> <out.json>
// env: LOCK=0 (never click into the scene: no pointer lock; the take-off by keys), EARLY=building|controls (Shift+B while the
// course is made / in the first second after the Controls screen closes), QUERY (more query, e.g. &set.display.deviceClass=
// desktop-weak), FLY=0 (no take-off), SHOTS (U:/Temp/gsfpv-train3/shots). Never presses a save, send, vote or create control
// on an address that is not localhost. Headless (tools/bench/src/chrome.mjs pickBrowser); takes no GPU lock itself (wrap it).
// Exit 1 when a step has no effect.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pickBrowser } from '../src/chrome.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [base, scan, size, dsfArg, touchArg, layout = 'en', name, outPath] = process.argv.slice(2);
if (!base || !scan || !size || !name || !outPath) {
    console.error('usage: edit-mouse-probe.mjs <address /en> <scan> <WxH> <dsf> <touch 0|1> <en|ru|pl> <name> <out.json>');
    process.exit(2);
}
const env = process.env;
const [W, H] = size.split('x').map(Number);
const DSF = Number(dsfArg || 1);
const TOUCH = touchArg === '1';
const LOCK = env.LOCK !== '0';
const EARLY = env.EARLY || '';
const FLY = env.FLY !== '0';
const QUERY = env.QUERY || '';
const SHOTS = env.SHOTS || 'U:/Temp/gsfpv-train3/shots';
const LIVE = !/localhost|127\.0\.0\.1/.test(base);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r2 = (x) => (typeof x === 'number' ? Math.round(x * 100) / 100 : x);
const dist = (a, b) => (a && b ? Math.hypot(...a.map((v, i) => v - (b[i] ?? 0))) : -1);

// event.key of the same physical keys in each layout (Russian JCUKEN; Polish 214 swaps Z and Y; Polish programmers = en)
const KEYS = {
    en: {},
    ru: { KeyQ: '\u0439', KeyW: '\u0446', KeyE: '\u0443', KeyR: '\u043a', KeyT: '\u0435', KeyY: '\u043d', KeyA: '\u0444', KeyS: '\u044b', KeyD: '\u0432', KeyF: '\u0430', KeyG: '\u043f', KeyZ: '\u044f', KeyB: '\u0438', KeyM: '\u044c', KeyP: '\u0437' },
    pl: { KeyZ: 'y', KeyY: 'z' }
};
const SPECIAL = { Space: [' ', 32], Tab: ['Tab', 9], Escape: ['Escape', 27], Enter: ['Enter', 13], ShiftLeft: ['Shift', 16] };
function keyOf(code, shift) {
    if (SPECIAL[code]) return { key: SPECIAL[code][0], vk: SPECIAL[code][1], text: code === 'Space' ? ' ' : undefined };
    const letter = code.startsWith('Key') ? code.slice(3) : code.startsWith('Digit') ? code.slice(5) : code;
    const k = (KEYS[layout] ?? {})[code] ?? letter.toLowerCase();
    const key = shift ? k.toUpperCase() : k;
    return { key, vk: letter.toUpperCase().charCodeAt(0), text: key };
}

const INIT = () => {
    const tagOf = (e) => (e ? `${e.tagName}${e.id ? '#' + e.id : ''}${typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\s+/).slice(0, 3).join('.') : ''}${e.dataset && e.dataset.top ? '[top=' + e.dataset.top + ']' : ''}` : null);
    window.__tagOf = tagOf;
    window.__seen = [];
    for (const t of ['pointerdown', 'mousedown', 'click', 'wheel']) window.addEventListener(t, (e) => { if (window.__seen.length < 5000) window.__seen.push([t, tagOf(e.target), Math.round(e.clientX), Math.round(e.clientY), e.button, !!document.pointerLockElement]); }, true);
    window.__bubbled = [];
    document.addEventListener('click', (e) => { if (window.__bubbled.length < 5000) window.__bubbled.push(tagOf(e.target)); });
};

const SNAP = `(() => {
    const tagOf = window.__tagOf || ((e) => (e ? e.tagName : null));
    const h = window.__gsfpv || {}; const c = h.course || {}; const e = c.editor || {};
    let v = null; try { v = window.__gsfpvEditView ? window.__gsfpvEditView() : null; } catch (x) { v = { err: String(x) }; }
    const cv = document.querySelector('canvas'); const tb = document.querySelector('.ce-topbar'); const pn = document.querySelector('.course-editor');
    let hud = null; try { const d = h.session.hud(); hud = {}; for (const k of Object.keys(d)) if (/arm|mode|alt|crash|speed|ground|throttle/i.test(k) && typeof d[k] !== 'object') hud[k] = d[k]; } catch (x) {}
    const vis = (q) => [...document.querySelectorAll(q)].filter((x) => x.getClientRects().length && getComputedStyle(x).visibility !== 'hidden').map(tagOf).slice(0, 6);
    return { open: !!e.open, selected: e.selected ?? null, changed: !!e.changed, said: String(e.said || '').slice(0, 160), flying: !!e.flying, refused: e.refused ? String(e.refused).slice(0, 120) : null,
        mode: v && v.mode, gatesN: v && v.course && v.course.gates ? v.course.gates.length : null, courseGates: c.gates ?? null, courseOn: !!c.on, problem: c.problem ?? null,
        cam: v && v.cam ? { pos: v.cam.pos, yaw: v.cam.yaw, pitch: v.cam.pitch, speed: v.cam.speed } : null, view: e.view ? { eye: e.view.eye, at: e.view.at } : null,
        handles: v ? v.handles : null, stand: v && v.stand ? v.stand.screen : null, gates: v ? v.gates : null, override: h.session ? !!h.session.cameraOverride : null,
        lock: tagOf(document.pointerLockElement), topLine: tb ? (tb.querySelector('.ce-tb-line') || {}).textContent : null, topClass: tb ? tb.className : null,
        panelClass: pn ? pn.className : null, panelBox: pn ? (() => { const b = pn.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; })() : null,
        panelScroll: pn ? [...pn.querySelectorAll('*')].filter((x) => x.scrollTop > 0).map((x) => x.scrollTop).concat([...pn.querySelectorAll('details[open]')].length) : null,
        canvas: cv ? [cv.width, cv.height, cv.clientWidth, cv.clientHeight] : null, dpr: devicePixelRatio, maxTouch: navigator.maxTouchPoints,
        status: h.status ?? null, paused: h.session ? !!h.session.paused : null, windows: vis('.panel, .screen, [aria-modal="true"]:not([hidden])'), hud, active: tagOf(document.activeElement) };
})()`;

const DIAG = `(([x, y]) => {
    const tagOf = window.__tagOf;
    const el = document.elementFromPoint(x, y);
    const chain = [];
    for (let p = el; p && chain.length < 12; p = p.parentElement) { const pe = getComputedStyle(p).pointerEvents; if (p === el || pe === 'none') chain.push([tagOf(p), pe]); }
    return { lock: tagOf(document.pointerLockElement), under: tagOf(el), chain, seenAt: window.__seen.length, bubAt: window.__bubbled.length };
})`;

const log = [];
const res = { address: base, scan, size: [W, H], dsf: DSF, touch: TOUCH, layout, name, lockAsked: LOCK, early: EARLY, fly: FLY, query: QUERY, live: LIVE, date: new Date().toISOString(), steps: {}, clicks: [] };
const fails = [];
function judge(step, ok, why) {
    res.steps[step] = { ok, ...why };
    if (!ok) fails.push(step);
}

const pick = pickBrowser({ expected: chromium.executablePath() });
const browser = await chromium.launch({ ...pick.launch, headless: true });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DSF, hasTouch: TOUCH, isMobile: false });
await ctx.addInitScript(INIT);
const page = await ctx.newPage();
page.on('pageerror', (e) => log.push(`pageerror: ${e.message}`.slice(0, 300)));
page.on('console', (m) => { if (m.type() === 'error') log.push(`console: ${m.text()}`.slice(0, 300)); });
const cdp = await ctx.newCDPSession(page);
const snap = () => page.evaluate(SNAP);
async function until(fn, ok, ms, step = 400) {
    const t0 = Date.now();
    let v = await fn();
    while (!ok(v) && Date.now() - t0 < ms) { await sleep(step); v = await fn(); }
    return { ok: ok(v), v, ms: Date.now() - t0 };
}
async function key(code, { shift = false, ctrl = false, hold = 60 } = {}) {
    const k = keyOf(code, shift);
    const modifiers = (shift ? 8 : 0) | (ctrl ? 2 : 0);
    if (shift) await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', code: 'ShiftLeft', key: 'Shift', windowsVirtualKeyCode: 16, modifiers: 8 });
    await cdp.send('Input.dispatchKeyEvent', { type: k.text && !ctrl ? 'keyDown' : 'rawKeyDown', code, key: k.key, text: ctrl ? undefined : k.text, unmodifiedText: ctrl ? undefined : k.text, windowsVirtualKeyCode: k.vk, modifiers });
    await sleep(hold);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: k.key, windowsVirtualKeyCode: k.vk, modifiers });
    if (shift) await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'ShiftLeft', key: 'Shift', windowsVirtualKeyCode: 16, modifiers: 0 });
}
/** a click as a person does it, with the record of what got it */
async function click(label, x, y, { button = 'left', after = 700 } = {}) {
    const d = await page.evaluate(`${DIAG}([${x}, ${y}])`);
    await page.mouse.move(x, y, { steps: 4 });
    await page.mouse.click(x, y, { button });
    await sleep(after);
    const seen = await page.evaluate(([a, b]) => ({ s: window.__seen.slice(a), b: window.__bubbled.slice(b) }), [d.seenAt, d.bubAt]);
    const rec = { label, at: [Math.round(x), Math.round(y)], lockBefore: d.lock, under: d.under, peChain: d.chain, windowSaw: seen.s.filter((e) => e[0] === 'pointerdown' || e[0] === 'click').map((e) => `${e[0]}>${e[1]}${e[5] ? ' locked' : ''}`).slice(0, 4), clickBubbled: seen.b.slice(0, 2) };
    res.clicks.push(rec);
    return rec;
}
async function drag(label, x, y, dx, dy, button = 'left') {
    const d = await page.evaluate(`${DIAG}([${x}, ${y}])`);
    await page.mouse.move(x, y);
    await sleep(100);
    await page.mouse.down({ button });
    await page.mouse.move(x + dx, y + dy, { steps: 12 });
    await page.mouse.up({ button });
    await sleep(600);
    res.clicks.push({ label, at: [Math.round(x), Math.round(y)], lockBefore: d.lock, under: d.under, peChain: d.chain });
}
const boxOf = (sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e || !e.getClientRects().length) return null; const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width, h: b.height, disabled: !!(e.disabled || e.getAttribute('aria-disabled') === 'true'), title: e.title || '', text: (e.textContent || '').trim().slice(0, 40) }; }, sel);
// the eye and the point looked at (a turn moves `at`, a fly key both)
const camOf = (s) => (s.view ? [...s.view.eye, ...s.view.at] : s.cam ? [...s.cam.pos] : null);
const SIG = (s) => JSON.stringify([s.open, s.selected, s.gatesN, s.changed, s.said, s.topLine, s.panelClass, s.panelBox, s.refused, s.windows, s.panelScroll]);

let shot = null;
try {
    const url = `${base}/fly/?scene=${scan}&nowarn=1${QUERY}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
    const ready = await until(() => page.evaluate(() => window.__gsfpv?.status ?? null), (v) => v === 'ready' || v === 'error', 300000, 1000);
    res.ready = { status: ready.v, ms: ready.ms };
    if (ready.v !== 'ready') throw new Error(`page status ${ready.v}`);
    // the Controls screen: a click on Keyboard, as a person does
    const kb = await page.waitForSelector('.screen.radio [data-action="radio-keyboard"]', { timeout: 20000 }).then(() => boxOf('.screen.radio [data-action="radio-keyboard"]')).catch(() => null);
    if (kb) await click('controls.keyboard', kb.x, kb.y, { after: EARLY === 'controls' ? 300 : 1500 });
    res.afterControls = await snap();
    if (EARLY === 'controls') {
        await key('KeyB', { shift: true });
        res.earlyAt = 'within 0.4 s after the Controls click';
    } else {
        if (LOCK) {
            await click('scene.toFly', W / 2, H / 2, { after: 900 });
            res.lockAfterClick = (await snap()).lock;
        }
        if (FLY) {
            const h0 = (await snap()).hud;
            await key('Space', { hold: 1500 });
            await key('KeyW', { hold: 600 });
            for (let i = 0; i < 6; i++) await page.mouse.move(W / 2 + 40 * (i % 2 ? -1 : 1), H / 2, { steps: 3 });
            await sleep(500);
            const s1 = await snap();
            res.takeoff = { hudBefore: h0, hudAfter: s1.hud, lock: s1.lock };
        }
        await key('KeyG', { shift: true });
        if (EARLY === 'building') {
            await sleep(1200);
            res.buildingAtB = await snap();
            await key('KeyB', { shift: true });
        } else {
            const gen = await until(snap, (s) => (s.courseGates ?? 0) > 0 && s.courseOn, 480000, 1000);
            res.course = { ok: gen.ok, ms: gen.ms, gates: gen.v.courseGates, problem: gen.v.problem };
            if (!gen.ok) throw new Error('no course');
            await sleep(1500);
            await key('KeyB', { shift: true });
        }
    }
    const op = await until(snap, (s) => s.open, EARLY ? 480000 : 30000, 500);
    await sleep(1800);
    const s0 = await snap();
    res.open = { ok: op.ok, ms: op.ms, mode: s0.mode, flying: s0.flying, lock: s0.lock, handles: s0.handles, topClass: s0.topClass, topLine: s0.topLine, canvas: s0.canvas, dpr: s0.dpr, maxTouch: s0.maxTouch, hud: s0.hud, windows: s0.windows, gatesN: s0.gatesN, selected: s0.selected, override: s0.override };
    shot = await page.screenshot();
    judge('open', op.ok, { mode: s0.mode, lock: s0.lock });
    if (!op.ok) throw new Error('edit view did not open');
    // TAP=1: the way back the bar's line names for a keyboard pilot (a short Space while flying in the mode, devices/keyboard.ts)
    if (env.TAP === '1' && s0.mode === 'fly') {
        await key('Space', { hold: 90 });
        const back = await until(snap, (s) => s.mode === 'edit', 4000, 250);
        res.tap = { back: back.ok, ms: back.ms, mode: back.v.mode, hud: back.v.hud, topLine: back.v.topLine };
    }

    // (a) the view: keys, right drag, left drag on the scene, wheel
    const moves = [];
    for (const k of ['KeyW', 'KeyS', 'KeyD', 'KeyA', 'KeyE', 'KeyQ']) {
        const a = camOf(await snap());
        await key(k, { hold: 700 });
        await sleep(200);
        const b = camOf(await snap());
        moves.push({ by: k, moved: r2(dist(a, b)) });
    }
    for (const [lab, x, y, dx, dy, btn] of [['rightDrag', W * 0.5, H * 0.5, 120, 30, 'right'], ['leftDragEmpty', W * 0.2, H * 0.62, 100, 0, 'left']]) {
        const a = camOf(await snap());
        await drag(`view.${lab}`, x, y, dx, dy, btn);
        const b = camOf(await snap());
        moves.push({ by: lab, moved: r2(dist(a, b)) });
    }
    {
        const a = (await snap()).cam?.speed ?? null;
        await page.mouse.move(W * 0.5, H * 0.5);
        await page.mouse.wheel(0, -300);
        await sleep(400);
        const b = (await snap()).cam?.speed ?? null;
        moves.push({ by: 'wheel', speed: [a, b], moved: a === b ? 0 : 1 });
    }
    judge('a.view', moves.filter((m) => m.by.startsWith('Key')).every((m) => m.moved > 0.05) && moves.find((m) => m.by === 'rightDrag').moved > 0.01, { moves });
    await key('Tab'); await sleep(900); await key('Tab', { shift: true }); await sleep(1500);

    // (b) a click on a gate in view, away from the selected one's handles
    let s1 = await snap();
    const cands = (s) => (s.gates || []).map((g, i) => ({ g, i })).filter(({ g, i }) => i !== s.selected && g[2] > 0 && g[0] > 20 && g[0] < W - 20 && g[1] > 60 && g[1] < H - 20 && (!s.stand || Math.hypot(g[0] - s.stand[0], g[1] - s.stand[1]) > 140)).sort((a, b) => a.g[2] - b.g[2]);
    let c = cands(s1);
    for (let n = 0; n < 4 && !c[0]; n++) { await key('KeyS', { hold: 700 }); await sleep(500); s1 = await snap(); c = cands(s1); }
    let picked = null;
    for (const { g, i } of c.slice(0, 3)) {
        const rec = await click(`gate.${i}`, g[0], g[1], { after: 300 });
        const got = await until(snap, (s) => s.selected === i, 2500, 250);
        rec.effect = { selected: got.v.selected, want: i };
        if (got.ok) { picked = i; break; }
    }
    judge('b.select', picked !== null, { candidates: c.length, from: s1.selected, picked, gatesOnScreen: (s1.gates || []).filter((g) => g[2] > 0 && g[0] >= 0 && g[0] < W && g[1] >= 0 && g[1] < H).length });

    // (c) Add gate, then a click on the scene
    {
        const a = await snap();
        const ab = await boxOf('.ce-topbar [data-top="add"]');
        if (!ab) judge('c.add', false, { why: 'no Add button on screen' });
        else {
            const r1 = await click('top.add', ab.x, ab.y, { after: 500 });
            const mid = await snap();
            r1.effect = { topLine: mid.topLine, pressed: await page.evaluate(() => document.querySelector('.ce-topbar [data-top="add"]')?.getAttribute('aria-pressed')) };
            // the place: the first point low in the view where the scene itself (the canvas) is under the mouse
            const spot = await page.evaluate(([w, h]) => { for (const fy of [0.72, 0.66, 0.78, 0.6]) for (const fx of [0.5, 0.4, 0.6, 0.3]) { const e = document.elementFromPoint(w * fx, h * fy); if (e && e.tagName === 'CANVAS') return [w * fx, h * fy]; } return [w * 0.5, h * 0.72]; }, [W, H]);
            await click('scene.place', spot[0], spot[1], { after: 300 });
            const b = (await until(snap, (s) => (s.gatesN ?? 0) > (a.gatesN ?? 0), 6000, 300)).v;
            const ng = b.gates && b.selected !== null ? b.gates[b.selected] : null;
            const inView = !!ng && ng[2] > 0 && ng[0] >= 0 && ng[0] < W && ng[1] >= 0 && ng[1] < H;
            judge('c.add', (b.gatesN ?? 0) > (a.gatesN ?? 0) && inView, { gates: [a.gatesN, b.gatesN], newGate: ng, inView, line: b.topLine, said: b.said });
        }
    }

    // (d) the other top-bar controls, then the editor's window
    const others = [];
    for (const id of ['undo', 'redo', 'save', 'courses', 'keys']) {
        if (LIVE && id === 'save') { others.push({ id, skipped: 'live' }); continue; }
        const bx = await boxOf(`.ce-topbar [data-top="${id}"]`);
        if (!bx) { others.push({ id, ok: false, why: 'not on screen' }); continue; }
        const a = await snap();
        const rec = await click(`top.${id}`, bx.x, bx.y, { after: id === 'save' ? 3000 : 900 });
        const b = await snap();
        const effect = SIG(a) !== SIG(b);
        rec.effect = effect;
        others.push({ id, ok: effect || bx.disabled, effect, disabled: bx.disabled, title: bx.title, line: b.topLine, panel: b.panelBox });
    }
    const wins = [];
    const ctl = await page.evaluate(() => [...document.querySelectorAll('.course-editor button, .course-editor [role="button"], .course-editor input, .course-editor select, .course-editor summary')].filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden').slice(0, 30).map((e, n) => { e.dataset.probeN = String(n); return { n, text: (e.textContent || e.value || e.getAttribute('aria-label') || '').trim().slice(0, 40), act: e.dataset.act || e.dataset.action || e.name || '' }; }));
    for (const k of ctl) {
        if (/save|vote|send|report|admin|publish|create/i.test(`${k.text} ${k.act}`) && (LIVE || /everyone|admin|vote/i.test(`${k.text} ${k.act}`))) { wins.push({ ...k, skipped: 'saves or sends' }); continue; }
        if (!(await snap()).open) { wins.push({ ...k, skipped: 'editor closed before' }); continue; }
        const bx = await boxOf(`[data-probe-n="${k.n}"]`);
        if (!bx) { wins.push({ ...k, skipped: 'gone' }); continue; }
        const a = await snap();
        const rec = await click(`win.${k.n}`, bx.x, bx.y, { after: 800 });
        const b = await snap();
        const effect = SIG(a) !== SIG(b) || (await page.evaluate(() => document.activeElement?.dataset?.probeN ?? null)) === String(k.n);
        rec.effect = effect;
        wins.push({ ...k, effect, disabled: bx.disabled, title: bx.title, under: rec.under });
    }
    judge('d.controls', others.every((o) => o.ok || o.skipped), { top: others, window: wins });

    // (e) Exit: the view closes and the flight is back (a second press when unsaved changes ask)
    if (!(await snap()).open) { await key('KeyB', { shift: true }); await until(snap, (s) => s.open, 30000, 500); await sleep(1000); }
    const presses = [];
    for (let n = 0; n < 2; n++) {
        const bx = await boxOf('.ce-topbar [data-top="exit"]');
        if (!bx) { presses.push({ n, why: 'no Exit on screen' }); break; }
        const rec = await click('top.exit', bx.x, bx.y, { after: 900 });
        const s = await snap();
        rec.effect = { open: s.open, line: s.topLine };
        presses.push({ n, open: s.open, line: s.topLine });
        if (!s.open) break;
    }
    const fin = await snap();
    judge('e.exit', !fin.open && fin.override === false, { presses, override: fin.override, paused: fin.paused, windows: fin.windows });
} catch (e) {
    res.error = String(e).slice(0, 400);
    fails.push('error');
}
res.final = await snap().catch(() => null);
if (res.final) delete res.final.gates;
res.fails = fails;
res.log = log.slice(0, 40);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(res, null, 1));
mkdirSync(SHOTS, { recursive: true });
if (shot) writeFileSync(join(SHOTS, `editfix-${fails.length ? 'before' : 'run'}-${name}.png`), shot);
const brief = Object.entries(res.steps).map(([k, v]) => `${k}:${v.ok ? 'ok' : 'FAIL'}`).join(' ');
console.log(`${name}: ${brief} mode=${res.open?.mode} lock=${res.open?.lock} ${res.error ?? ''}`);
await browser.close();
process.exit(fails.length ? 1 : 0);
