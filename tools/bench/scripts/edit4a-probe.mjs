// Lane edit4a, stage A3 (docs/wip/edit4a.md; design C:/dev/.gsfpv-lanes/designs/edit4.md section 2): the owner's path in the
// course editor with the MOUSE, as a person does it (brief 543-548: "the view moves only when I move it", "one gizmo with the
// arrows, the boxes and the rings at once", "controls as in Blender, also on a touch pad"). Load the scan, close the Controls
// screen by a click, click into the scene (the pointer lock), Shift+G, wait for the course, Shift+B; then:
//   1 open, eye E0; 2 key Home: every gate in front of the eye and inside the canvas; 3 click a gate: selected, eye still;
//   4 left drag on empty space 200 px: an orbit, the distance to the pivot within 2 %; 5 Shift + left drag: a pan, heading kept;
//   6 three wheel notches over the gate: nearer the point under the cursor, never through it; 7 key F, then hover the x
//   arrow, a size box and the y ring: the view names move/x, size, turn/y and shows the tag; 8 drag the x arrow 100 px: the
//   gate goes along its x only, the eye still; 9 drag the y ring: the gate turns; 10 drag a size box: the opening changes;
//   cancel: drag the arrow, key Esc before the release: the gate is back; 11 click another gate from the same eye and drag
//   its arrow: the eye still; 12 double click a third gate: it is framed (its centre in the middle third); 13 the window at
//   844x390 device scale 2 (a laptop, no touch): top bar, gate bar, hover tag and panels do not lie over each other.
// Each step PASS or FAIL in one JSON; exit 1 on a FAIL. Never presses Save, Send, Vote or Create (nothing is stored, so the
// same run on the live site is read-only: it is this lane's negative control).
//   node tools/bench/scripts/edit4a-probe.mjs <address with /en> <scan> <WxH> <device scale> <name> <out.json>
// env: QUERY (more query, e.g. &render=off), COURSE_MS (wait for the course, default 480000), SHOT (a PNG path: the hover
// picture), GATE11 (the gate step 11 takes when it is on screen, default 7). Headless (tools/bench/src/chrome.mjs pickBrowser); takes no GPU lock itself (wrap a drawn run in it).
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pickBrowser } from '../src/chrome.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [base, scan, size, dsfArg, name, outPath] = process.argv.slice(2);
if (!base || !scan || !size || !name || !outPath) {
    console.error('usage: edit4a-probe.mjs <address /en> <scan> <WxH> <dsf> <name> <out.json>');
    process.exit(2);
}
const env = process.env;
const [W, H] = size.split('x').map(Number);
const DSF = Number(dsfArg || 1);
const QUERY = env.QUERY || '';
const LIVE = !/localhost|127\.0\.0\.1/.test(base);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r3 = (x) => (typeof x === 'number' ? Math.round(x * 1000) / 1000 : x);
const dist = (a, b) => (a && b ? Math.hypot(...a.map((v, i) => v - (b[i] ?? 0))) : -1);
const sub = (a, b) => a.map((v, i) => v - b[i]);
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
/** the local x axis of a pose quaternion [w, x, y, z] (drag.ts fromPcQuat) */
const rightOf = ([w, x, y, z]) => [1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y)];
const turnDeg = (a, b) => (2 * Math.acos(Math.min(1, Math.abs(dot(a, b)))) * 180) / Math.PI;

const SPECIAL = { Escape: ['Escape', 27], Home: ['Home', 36], ShiftLeft: ['Shift', 16] };
const res = { address: base, scan, size: [W, H], dsf: DSF, name, query: QUERY, live: LIVE, date: new Date().toISOString(), steps: {} };
const fails = [];
const log = [];
function judge(step, ok, why) {
    res.steps[step] = { ok: !!ok, ...why };
    if (!ok) fails.push(step);
}

const pick = pickBrowser({ expected: chromium.executablePath() });
const browser = await chromium.launch({ ...pick.launch, headless: true });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DSF, hasTouch: false, isMobile: false });
const page = await ctx.newPage();
page.on('pageerror', (e) => log.push(`pageerror: ${e.message}`.slice(0, 300)));
page.on('console', (m) => { if (m.type() === 'error') log.push(`console: ${m.text()}`.slice(0, 300)); });
const cdp = await ctx.newCDPSession(page);

const SNAP = `(() => {
    const h = window.__gsfpv || {}; const c = h.course || {}; const e = c.editor || {};
    let v = null; try { v = window.__gsfpvEditView ? window.__gsfpvEditView() : null; } catch (x) { v = { err: String(x) }; }
    const tb = document.querySelector('.ce-topbar'); const ht = document.querySelector('.ce-hover-tag');
    return { open: !!e.open, selected: e.selected ?? null, said: String(e.said || '').slice(0, 160), courseGates: c.gates ?? null, courseOn: !!c.on,
        mode: v && v.mode, eye: v && v.cam ? v.cam.pos : null, yaw: v && v.cam ? v.cam.yaw : null, pitch: v && v.cam ? v.cam.pitch : null,
        nav: v ? v.nav ?? null : null, hover: v ? v.hover ?? null : null, cancels: v ? v.cancels ?? null : null, dragging: v ? !!v.dragging : null,
        stand: v && v.stand ? v.stand : null, axes: v ? v.axes ?? null : null, gates: v ? v.gates : null, handles: v ? v.handles : null,
        world: v && v.course && v.course.gates ? v.course.gates.map((g) => g.pos) : null, lock: !!document.pointerLockElement,
        topLine: tb ? (tb.querySelector('.ce-tb-line') || {}).textContent : null,
        hoverTag: ht && !ht.hidden ? ht.textContent : null, cursor: (document.querySelector('canvas') || {}).style ? document.querySelector('canvas').style.cursor : null };
})()`;
const snap = () => page.evaluate(SNAP);
async function until(fn, ok, ms, step = 400) {
    const t0 = Date.now();
    let v = await fn();
    while (!ok(v) && Date.now() - t0 < ms) { await sleep(step); v = await fn(); }
    return { ok: ok(v), v, ms: Date.now() - t0 };
}
async function key(code, { shift = false, hold = 60 } = {}) {
    const sp = SPECIAL[code];
    const letter = code.startsWith('Key') ? code.slice(3) : '';
    const k = sp ? sp[0] : shift ? letter : letter.toLowerCase();
    const vk = sp ? sp[1] : letter.charCodeAt(0);
    const modifiers = shift ? 8 : 0;
    if (shift) await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', code: 'ShiftLeft', key: 'Shift', windowsVirtualKeyCode: 16, modifiers: 8 });
    await cdp.send('Input.dispatchKeyEvent', { type: sp ? 'rawKeyDown' : 'keyDown', code, key: k, text: sp ? undefined : k, windowsVirtualKeyCode: vk, modifiers });
    await sleep(hold);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: k, windowsVirtualKeyCode: vk, modifiers });
    if (shift) await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'ShiftLeft', key: 'Shift', windowsVirtualKeyCode: 16, modifiers: 0 });
}
async function click(x, y, after = 700) {
    await page.mouse.move(x, y, { steps: 4 });
    await page.mouse.click(x, y);
    await sleep(after);
}
/** a press, a move in steps and a release; `mid` runs before the release (the cancel) */
async function drag(x, y, dx, dy, { shift = false, mid = null } = {}) {
    await page.mouse.move(x, y, { steps: 3 });
    await sleep(120);
    if (shift) await page.keyboard.down('Shift');
    // what the view's hit test names at the point the moment before the press (rule and gizmo's own), and what the press
    // took after the first moves: a part named here but not taken is a press that went to the view
    const state = () => page.evaluate(() => { const v = window.__gsfpvEditView && window.__gsfpvEditView(); return v ? { grabbed: v.grabbed, dragging: v.dragging, ring: v.ring, nav: v.nav && v.nav.kind, sets: v.sets, stand: v.stand && v.stand.screen } : null; });
    const rec = { at: [Math.round(x), Math.round(y)], pre: await page.evaluate(([x, y]) => (window.__gsfpvEditHit ? [window.__gsfpvEditHit(x, y), window.__gsfpvEditHit(x, y, true)] : null), [x, y]), before: await state() };
    // the press as the page got it: its own coordinates and what the hit test names there (a capture listener of the probe)
    await page.evaluate(() => { if (window.__probeDown) return; window.__probeDown = {}; window.addEventListener('pointerdown', (e) => { window.__probeDown = { client: [e.clientX, e.clientY], offset: [e.offsetX, e.offsetY], hit: window.__gsfpvEditHit ? window.__gsfpvEditHit(e.clientX, e.clientY) : null }; }, true); });
    await page.mouse.down();
    rec.down = await page.evaluate(() => window.__probeDown);
    await page.mouse.move(x + dx / 4, y + dy / 4, { steps: 4 });
    rec.taken = await state();
    await page.mouse.move(x + dx, y + dy, { steps: 10 });
    await sleep(150);
    (res.presses ??= []).push(rec);
    if (mid) await mid();
    await page.mouse.up();
    if (shift) await page.keyboard.up('Shift');
    await sleep(700);
}
const boxOf = (sel) => page.evaluate((s) => [...document.querySelectorAll(s)].filter((e) => e.getClientRects().length && !e.hidden && getComputedStyle(e).visibility !== 'hidden').map((e) => { const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; }), sel);
/** the gates on screen, in front, away from the selected one's gizmo, nearest first */
const onScreen = (s, w = W, h = H, skip = [], away = 170) => (s.gates || []).map((g, i) => ({ g, i })).filter(({ g, i }) => i !== s.selected && !skip.includes(i) && g[2] > 0 && g[0] > 40 && g[0] < w - 40 && g[1] > 90 && g[1] < h - 60 && (!s.stand || Math.hypot(g[0] - s.stand.screen[0], g[1] - s.stand.screen[1]) > away)).sort((a, b) => a.g[2] - b.g[2]);
/** the candidates a person can click: the scene itself (the canvas) under the gate's point, not a bar over it */
const pickable = async (cands) => {
    const ok = await page.evaluate((pts) => pts.map(([x, y]) => (document.elementFromPoint(x, y) || {}).tagName === 'CANVAS'), cands.map((c) => c.g));
    return cands.filter((_, i) => ok[i]);
};
/** points of the selected gate's gizmo, walking out from its centre with the view's own hit test (hitAt) */
const scanParts = () => page.evaluate(() => {
    const v = window.__gsfpvEditView ? window.__gsfpvEditView() : null;
    const hit = window.__gsfpvEditHit;
    if (!v || !v.stand || !hit) return null;
    const [cx, cy] = v.stand.screen;
    const out = {}; const seen = {};
    // whole CSS px, and only where the part also lies 2 px to each side: a point at a part's very edge (drawn run 2 step 9
    // pressed the y ring 10 px from the centre, beside the box) can be missed by a press that lands a fraction of a px off
    const core = (x, y, key) => [[2, 0], [-2, 0], [0, 2], [0, -2]].every(([dx, dy]) => (hit(x + dx, y + dy) || []).join('/') === key);
    for (let r = 4; r <= 170; r += 2) for (let a = 0; a < 360; a += 5) {
        const x = Math.round(cx + r * Math.cos((a * Math.PI) / 180)), y = Math.round(cy + r * Math.sin((a * Math.PI) / 180));
        const p = hit(x, y);
        if (!p) continue;
        seen[p.join('/')] = (seen[p.join('/')] || 0) + 1;
        const k = p[0] === 'move' && p[1] === 'x' ? 'arrowX' : p[0] === 'size' ? 'box' : p[0] === 'turn' && /y$/.test(p[1]) ? 'ringY' : null;
        if (k && !out[k] && core(x, y, p.join('/'))) out[k] = { at: [x, y], r, a, part: p };
    }
    return { centre: [cx, cy], ...out, seen };
});
/** the gizmo's points once they hold still: each found point names the same part 300 ms later (the gizmo sizes itself to
 *  the view in the engine's frame update, so a scan right after a selection or a frame can read the old shapes) */
const partsOf = async () => {
    let a = null;
    for (let n = 0; n < 6; n++) {
        a = await scanParts();
        if (!a) return null;
        await sleep(300);
        const same = await page.evaluate((pts) => pts.every(([at, part]) => JSON.stringify(window.__gsfpvEditHit(at[0], at[1])) === JSON.stringify(part)), ['arrowX', 'box', 'ringY'].filter((k) => a[k]).map((k) => [a[k].at, a[k].part]));
        if (same) return { ...a, tries: n + 1 };
    }
    return { ...a, tries: 6, stable: false };
};
/** an empty place on the canvas: no gizmo part, no gate within 120 px, the canvas itself under the point */
const emptyAt = (w, h) => page.evaluate(([w, h]) => {
    const v = window.__gsfpvEditView();
    for (const fy of [0.75, 0.6, 0.4, 0.85]) for (const fx of [0.2, 0.8, 0.35, 0.65, 0.12]) {
        const x = w * fx, y = h * fy;
        const el = document.elementFromPoint(x, y);
        if (!el || el.tagName !== 'CANVAS') continue;
        if (window.__gsfpvEditHit(x, y)) continue;
        if ((v.gates || []).some((g) => g[2] > 0 && Math.hypot(g[0] - x, g[1] - y) < 120)) continue;
        if (x + 200 > w - 10) continue;
        return [Math.round(x), Math.round(y)];
    }
    return [Math.round(w * 0.2), Math.round(h * 0.75)];
}, [w, h]);

let shot = null;
try {
    await page.goto(`${base}/fly/?scene=${scan}&nowarn=1${QUERY}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    const ready = await until(() => page.evaluate(() => window.__gsfpv?.status ?? null), (v) => v === 'ready' || v === 'error', 300000, 1000);
    if (ready.v !== 'ready') throw new Error(`page status ${ready.v}`);
    const KB = '.screen.radio [data-action="radio-keyboard"]';
    await page.waitForSelector(KB, { timeout: 20000 }).catch(() => null);
    const kb = (await boxOf(KB))[0];
    if (kb) await click(kb[0] + kb[2] / 2, kb[1] + kb[3] / 2, 1500);
    // the pointer lock first, by a click into the scene (as the pilot does before he flies)
    await click(W / 2, H / 2, 900);
    res.lockBeforeEditor = (await snap()).lock;
    await key('KeyG', { shift: true });
    const gen = await until(snap, (s) => (s.courseGates ?? 0) > 0 && s.courseOn, Number(env.COURSE_MS || 480000), 1000);
    res.course = { ok: gen.ok, ms: gen.ms, gates: gen.v.courseGates };
    if (!gen.ok) throw new Error('no course');
    await sleep(1500);
    await key('KeyB', { shift: true });
    const op = await until(snap, (s) => s.open && s.mode === 'edit', 30000, 500);
    await sleep(1800);
    const s0 = await snap();
    judge('1.open', op.ok && !!s0.eye, { mode: s0.mode, lock: s0.lock, gates: (s0.gates || []).length, E0: s0.eye });

    // 2 key Home: the whole course in view
    await page.mouse.move(W * 0.5, H * 0.95);
    await key('Home');
    await sleep(1200);
    const s2 = await snap();
    const out2 = (s2.gates || []).map((g, i) => [i, g]).filter(([, g]) => !(g[2] > 0 && g[0] >= 0 && g[0] <= W && g[1] >= 0 && g[1] <= H));
    judge('2.home', (s2.gates || []).length > 0 && out2.length === 0 && dist(s0.eye, s2.eye) > 0.1, { nav: s2.nav, eyeMoved: r3(dist(s0.eye, s2.eye)), outside: out2.slice(0, 5) });

    // 3 click a gate: it is selected, the eye stays
    const c3 = await pickable(onScreen(s2));
    const g3 = c3.find((c) => c.i === 3) ?? c3[0];
    let E3 = s2.eye;
    if (!g3) judge('3.select', false, { why: 'no gate on screen away from the selected one' });
    else {
        await click(g3.g[0], g3.g[1], 300);
        const got = await until(snap, (s) => s.selected === g3.i, 2500, 250);
        await sleep(800);
        const s3 = await snap();
        judge('3.select', got.ok && dist(s2.eye, s3.eye) < 0.01, { gate: g3.i, selected: s3.selected, eyeMoved: r3(dist(s2.eye, s3.eye)), line: s3.topLine });
        E3 = s3.eye;
    }
    const gi = g3 ? g3.i : 0;

    // 4 left drag on empty space: an orbit round the selected gate (on screen), the distance kept
    {
        const [x, y] = await emptyAt(W, H);
        const a = await snap();
        await drag(x, y, 200, 0);
        const b = await snap();
        const pivot = b.nav && b.nav.at ? b.nav.at : a.world ? a.world[gi] : null;
        const d0 = dist(a.eye, pivot), d1 = dist(b.eye, pivot);
        judge('4.orbit', !!b.nav && b.nav.kind === 'orbit' && dist(a.eye, b.eye) > 0.1 && Math.abs(d1 - d0) <= 0.02 * d0, { at: [x, y], nav: b.nav, distBefore: r3(d0), distAfter: r3(d1), eyeMoved: r3(dist(a.eye, b.eye)), pivotIsGate: a.world ? dist(pivot, a.world[gi]) < 0.01 : null });
    }
    // 5 Shift + left drag: a pan, the heading kept
    {
        const [x, y] = await emptyAt(W, H);
        const a = await snap();
        await drag(x, y, 120, 40, { shift: true });
        const b = await snap();
        judge('5.pan', !!b.nav && b.nav.kind === 'pan' && dist(a.eye, b.eye) > 0.05 && Math.abs(a.yaw - b.yaw) < 1e-6 && Math.abs(a.pitch - b.pitch) < 1e-6, { nav: b.nav && b.nav.kind, eyeMoved: r3(dist(a.eye, b.eye)), yaw: [r3(a.yaw), r3(b.yaw)], pitch: [r3(a.pitch), r3(b.pitch)] });
    }
    // 6 three wheel notches over the gate: nearer, never through the point under the cursor
    {
        const a = await snap();
        const g = a.gates[gi];
        const on = g && g[2] > 0 && g[0] > 0 && g[0] < W && g[1] > 0 && g[1] < H;
        await page.mouse.move(on ? g[0] : W / 2, on ? g[1] : H / 2, { steps: 3 });
        for (let n = 0; n < 3; n++) { await page.mouse.wheel(0, -100); await sleep(250); }
        await sleep(400);
        const b = await snap();
        const at = b.nav && b.nav.at;
        const ok = !!at && b.nav.kind === 'dolly' && dist(b.eye, at) < dist(a.eye, at) - 0.05 && dot(sub(at, a.eye), sub(at, b.eye)) > 0 && dist(b.eye, at) >= 0.45;
        judge('6.wheel', ok, { overGate: !!on, nav: b.nav, distBefore: r3(dist(a.eye, at)), distAfter: r3(dist(b.eye, at)), toGate: a.world ? [r3(dist(a.eye, a.world[gi])), r3(dist(b.eye, a.world[gi]))] : null });
    }

    // 7 key F frames the selected gate; hover the x arrow, a size box and the y ring
    await key('KeyF');
    await sleep(1200);
    let parts = await partsOf();
    res.parts = parts;
    {
        const seen = {};
        for (const [k, want] of [['arrowX', (h) => h && h[0] === 'move' && h[1] === 'x'], ['box', (h) => h && h[0] === 'size'], ['ringY', (h) => h && h[0] === 'turn' && /y$/.test(h[1])]]) {
            const p = parts && parts[k];
            if (!p) { seen[k] = { ok: false, why: 'no such part found by hitAt' }; continue; }
            await page.mouse.move(p.at[0] - 30, p.at[1] - 30);
            await page.mouse.move(p.at[0], p.at[1], { steps: 5 });
            await sleep(350);
            const s = await snap();
            seen[k] = { ok: want(s.hover) && !!s.hoverTag, hover: s.hover, tag: s.hoverTag, cursor: s.cursor };
            if (k === 'ringY' && env.SHOT) shot = await page.screenshot();
        }
        judge('7.hover', Object.values(seen).every((x) => x.ok), seen);
    }
    // 8 drag the x arrow 100 px: the gate moves along its own x only, the eye stays
    {
        const a = await snap();
        const p = parts && parts.arrowX;
        if (!p || !a.stand || !a.axes) judge('8.arrowX', false, { why: 'no x arrow' });
        else {
            await drag(p.at[0], p.at[1], a.axes.x[0] * 100, a.axes.x[1] * 100);
            const b = await snap();
            const d = sub(b.stand.pos, a.stand.pos);
            const ax = rightOf(a.stand.quat);
            const along = dot(d, ax);
            const off = Math.hypot(...d.map((v, i) => v - along * ax[i]));
            judge('8.arrowX', Math.abs(along) > 0.05 && off < 0.01 && dist(a.eye, b.eye) < 0.01, { along: r3(along), off: r3(off), eyeMoved: r3(dist(a.eye, b.eye)), line: b.topLine });
        }
    }
    // 9 drag the y ring: the gate turns
    parts = await partsOf();
    {
        const a = await snap();
        const p = parts && parts.ringY;
        if (!p) judge('9.ringY', false, { why: 'no y ring' });
        else {
            const rad = [p.at[0] - parts.centre[0], p.at[1] - parts.centre[1]];
            const n = Math.hypot(...rad) || 1;
            await drag(p.at[0], p.at[1], (-rad[1] / n) * 80, (rad[0] / n) * 80);
            const b = await snap();
            const deg = turnDeg(a.stand.quat, b.stand.quat);
            judge('9.ringY', deg > 2 && dist(a.stand.pos, b.stand.pos) < 0.01 && dist(a.eye, b.eye) < 0.01, { part: p.part, deg: r3(deg), moved: r3(dist(a.stand.pos, b.stand.pos)), eyeMoved: r3(dist(a.eye, b.eye)), line: b.topLine });
        }
    }
    // 10 drag a size box outwards: the opening changes
    parts = await partsOf();
    {
        const a = await snap();
        const p = parts && parts.box;
        if (!p) judge('10.box', false, { why: 'no size box' });
        else {
            const rad = [p.at[0] - parts.centre[0], p.at[1] - parts.centre[1]];
            const n = Math.hypot(...rad) || 1;
            await drag(p.at[0], p.at[1], (rad[0] / n) * 60, (rad[1] / n) * 60);
            const b = await snap();
            const k = (s) => (s.stand.opening ?? 1) * (s.stand.scale ?? 1);
            judge('10.box', Math.abs(k(b) / k(a) - 1) > 0.01 && dist(a.eye, b.eye) < 0.01, { part: p.part, opening: [r3(a.stand.opening), r3(b.stand.opening)], scale: [r3(a.stand.scale), r3(b.stand.scale)], eyeMoved: r3(dist(a.eye, b.eye)), line: b.topLine });
        }
    }
    // cancel: drag the x arrow, key Esc before the release: the gate is back, the tag says so
    parts = await partsOf();
    {
        const a = await snap();
        const p = parts && parts.arrowX;
        if (!p || !a.axes) judge('cancel', false, { why: 'no x arrow' });
        else {
            let mid = null;
            await drag(p.at[0], p.at[1], a.axes.x[0] * 80, a.axes.x[1] * 80, { mid: async () => { mid = await snap(); await key('Escape'); await sleep(200); } });
            const b = await snap();
            judge('cancel', !!mid && dist(mid.stand.pos, a.stand.pos) > 0.05 && dist(b.stand.pos, a.stand.pos) < 0.01 && (b.cancels ?? 0) > (a.cancels ?? 0), { movedMid: mid ? r3(dist(mid.stand.pos, a.stand.pos)) : null, after: r3(dist(b.stand.pos, a.stand.pos)), cancels: [a.cancels, b.cancels], tag: b.hoverTag });
        }
    }

    // 11 click another gate from the same eye, then drag its arrow: the eye never moves
    await page.mouse.move(W * 0.5, H * 0.95);
    await key('Home');
    await sleep(1200);
    const s11 = await snap();
    const c11 = await pickable(onScreen(s11));
    const g7 = c11.find((c) => c.i === Number(env.GATE11 ?? 7)) ?? c11[0];
    if (!g7) judge('11.another', false, { why: 'no other gate on screen' });
    else {
        await click(g7.g[0], g7.g[1], 300);
        const got = await until(snap, (s) => s.selected === g7.i, 2500, 250);
        await sleep(800);
        const p = await partsOf();
        const m = await snap();
        if (p && p.arrowX && m.axes) {
            res.hit11 = await page.evaluate(([x, y]) => [window.__gsfpvEditHit(x, y), window.__gsfpvEditHit(x, y, true)], p.arrowX.at);
            await drag(p.arrowX.at[0], p.arrowX.at[1], m.axes.x[0] * 80, m.axes.x[1] * 80, { mid: async () => { const v = await page.evaluate(() => window.__gsfpvEditView()); res.mid11 = { dragging: v.dragging, grabbed: v.grabbed, sets: v.sets, nav: v.nav, muted: v.muted, lock: v.lock }; } });
        }
        const b = await snap();
        res.parts11 = p;
        judge('11.another', got.ok && !!(p && p.arrowX) && dist(s11.eye, m.eye) < 0.01 && dist(s11.eye, b.eye) < 0.01 && dist(m.stand.pos, b.stand.pos) > 0.05, { gate: g7.i, selected: b.selected, eyeAfterClick: r3(dist(s11.eye, m.eye)), eyeAfterDrag: r3(dist(s11.eye, b.eye)), gateMoved: r3(dist(m.stand.pos, b.stand.pos)) });
    }
    // 12 double click a third gate: selected and framed (its centre in the middle third of the canvas)
    {
        const a = await snap();
        const c = await pickable(onScreen(a, W, H, g7 ? [g7.i] : []));
        const g = c[0];
        if (!g) judge('12.double', false, { why: 'no third gate on screen' });
        else {
            await page.mouse.move(g.g[0], g.g[1], { steps: 4 });
            await page.mouse.dblclick(g.g[0], g.g[1]);
            await sleep(1500);
            const b = await snap();
            const q = b.gates[g.i];
            const mid = q && q[2] > 0 && q[0] > W / 3 && q[0] < (2 * W) / 3 && q[1] > H / 3 && q[1] < (2 * H) / 3;
            judge('12.double', b.selected === g.i && mid && dist(a.eye, b.eye) > 0.1, { gate: g.i, selected: b.selected, screen: q, eyeMoved: r3(dist(a.eye, b.eye)) });
        }
    }

    // 13 a laptop window, 844x390 at device scale 2, no touch: nothing lies over another thing
    {
        const w = 844, h = 390;
        await page.setViewportSize({ width: w, height: h });
        await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: false });
        await sleep(1500);
        await page.mouse.move(w * 0.5, h * 0.95);
        await key('Home');
        await sleep(1200);
        const a = await snap();
        // the gizmo's arrows end 115 px out (handle-look.ts handleBands): a press further away is on the scene
        const c = await pickable(onScreen(a, w, h, [], 125));
        const tried = [];
        for (const { g, i } of c.slice(0, 3)) {
            await click(g[0], g[1], 1200);
            const got = (await snap()).selected;
            tried.push([i, g, got]);
            if (got === i) break;
        }
        const p = await partsOf();
        const hp = p && (p.arrowX || p.ringY || p.box);
        if (hp) { await page.mouse.move(hp.at[0], hp.at[1], { steps: 4 }); await sleep(400); }
        const rects = {};
        for (const [k, sel] of [['topbar', '.ce-topbar'], ['gatebar', '.ce-gatebar'], ['hoverTag', '.ce-hover-tag'], ['sizeTag', '.ce-size-tag'], ['editor', '.course-editor'], ['panels', '.panel, .screen']]) rects[k] = await boxOf(sel);
        const all = Object.entries(rects).flatMap(([k, rs]) => rs.map((r) => [k, r]));
        const over = [];
        for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
            const [ka, A] = all[i], [kb, B] = all[j];
            if (A[0] < B[0] + B[2] && B[0] < A[0] + A[2] && A[1] < B[1] + B[3] && B[1] < A[1] + A[3]) over.push([ka, kb]);
        }
        const outside = all.filter(([, r]) => r[0] < 0 || r[1] < 0 || r[0] + r[2] > w || r[1] + r[3] > h).map(([k]) => k);
        const s = await snap();
        judge('13.laptop', tried.some((t) => t[0] === t[2]) && !!hp && rects.topbar.length === 1 && rects.gatebar.length === 1 && !!s.hoverTag && over.length === 0 && outside.length === 0, { before: a.selected, tried, candidates: c.length, selected: s.selected, line: s.topLine, hovered: s.hover, rects, over, outside });
    }
} catch (e) {
    res.error = String(e).slice(0, 400);
    fails.push('error');
}
res.final = await snap().catch(() => null);
if (res.final) { delete res.final.gates; delete res.final.world; }
res.fails = fails;
res.log = log.slice(0, 30);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(res, null, 1));
if (shot && env.SHOT) { mkdirSync(dirname(env.SHOT), { recursive: true }); writeFileSync(env.SHOT, shot); }
console.log(JSON.stringify({ name, address: base, pass: fails.length === 0, steps: Object.fromEntries(Object.entries(res.steps).map(([k, v]) => [k, v.ok ? 'PASS' : 'FAIL'])), error: res.error ?? null }));
await browser.close();
process.exit(fails.length ? 1 : 0);
