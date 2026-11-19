// Lane edit4c, stage C3 (docs/wip/edit4c.md): the acceptance of the editor's content (brief 545, 561), walked with the
// MOUSE as the pilot does it, at 1536x730 with device scale 1.25. Load the scan, Keyboard on the Controls screen, a click
// into the scene (the pointer lock), Shift+G, wait for the course, Shift+B. Then:
//   s2.add      Add, a click between two gates far apart: the new gate goes between them and faces their line (15 deg);
//   s3.dv       Add > Double vertical, a click: 2 gates stacked; s3.undo: one Undo press removes both;
//   s4.th       Add > Triple horizontal, a click: 3 gates in a row; s4.undo likewise;
//   s5.tag      a gate dragged by its arrow toward the next gate: the warning tag stands on the page during the drag;
//   s6.putBack  the release asks 'Keep it here?'; Put back gives the old pose back;
//   s7.keep     the same drag again and Keep: the pose stays, the gate is kept (painted orange) until fixed;
//   s8.small    at 844x390 the Add list fits the view, nothing covers its items, its cross is 44 px and closes it.
// Each step is judged by the page's state (window.__gsfpvEditView, __gsfpv.course.editor) and prints PASS or FAIL in one
// JSON. Never presses Save, Send or any control that stores; on a non-localhost address the course stays in the page.
//   node tools/bench/scripts/edit4c-probe.mjs <address with /en> <out.json> [scene 70b50d42]
// env: COURSE_MS (wait for the course, default 300000), QUERY (more query), SHOT (a PNG of the drag's tag).
// Headless (tools/bench/src/chrome.mjs pickBrowser); takes no GPU lock itself (wrap a drawn run). Exit 1 on a FAIL.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pickBrowser } from '../src/chrome.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [base, outPath, scene = '70b50d42'] = process.argv.slice(2);
if (!base || !outPath) {
    console.error('usage: edit4c-probe.mjs <address with /en> <out.json> [scene]');
    process.exit(2);
}
const env = process.env;
const W = 1536;
const H = 730;
const DSF = 1.25;
const STRICT = env.STRICT === '1';
const LIVE = !/localhost|127\.0\.0\.1/.test(base);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r2 = (x) => Math.round(x * 100) / 100;
const deg = (r) => Math.round((r * 1800) / Math.PI) / 10;

const SNAP = `(() => {
    const h = window.__gsfpv || {}; const c = h.course || {}; const e = c.editor || {};
    let v = null; try { v = window.__gsfpvEditView ? window.__gsfpvEditView() : null; } catch (x) { v = { err: String(x) }; }
    const vis = (q) => { const x = document.querySelector(q); if (!x || x.hidden || !x.getClientRects().length) return null; const b = x.getBoundingClientRect(); return { box: [b.left, b.top, b.width, b.height].map(Math.round), text: (x.textContent || '').trim().slice(0, 160) }; };
    return { open: !!e.open, selected: e.selected ?? null, said: String(e.said || '').slice(0, 160), refused: e.refused ?? null, courseGates: c.gates ?? null, courseOn: !!c.on,
        mode: v && v.mode, gates: v && v.gates ? v.gates : null, stand: v && v.stand ? v.stand : null, axes: v ? v.axes : null, dragging: v ? !!v.dragging : null,
        warn: v ? v.warn ?? 'absent' : null, add: v ? v.add ?? 'absent' : null, place: v ? v.place : null,
        list: v && v.course ? v.course.gates.map((g) => ({ id: g.id, pos: g.pos, quat: g.quat })) : null,
        warnDom: vis('[data-testid="ce-warn"]'), askDom: vis('[data-testid="ce-warn"] .ce-warn-ask'), addDom: vis('[data-testid="add-chooser"]'),
        lock: document.pointerLockElement ? document.pointerLockElement.tagName : null, status: h.status ?? null };
})()`;

const res = { address: base, scene, size: [W, H], dsf: DSF, live: LIVE, date: new Date().toISOString(), steps: {} };
const fails = [];
const log = [];
function judge(step, ok, why) {
    res.steps[step] = { verdict: ok ? 'PASS' : 'FAIL', ...why };
    if (!ok) fails.push(step);
}

const pick = pickBrowser({ expected: chromium.executablePath() });
const browser = await chromium.launch({ ...pick.launch, headless: true });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DSF });
const page = await ctx.newPage();
page.on('pageerror', (e) => log.push(`pageerror: ${e.message}`.slice(0, 300)));
const snap = () => page.evaluate(SNAP);
async function until(fn, ok, ms, step = 300) {
    const t0 = Date.now();
    let v = await fn();
    while (!ok(v) && Date.now() - t0 < ms) { await sleep(step); v = await fn(); }
    return { ok: ok(v), v, ms: Date.now() - t0 };
}
const boxOf = (sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e || e.hidden || !e.getClientRects().length) return null; const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width, h: b.height, l: b.left, t: b.top }; }, sel);
async function click(x, y, after = 600) {
    await page.mouse.move(x, y, { steps: 4 });
    await page.mouse.click(x, y);
    await sleep(after);
}
async function clickSel(sel, after = 600) {
    const b = await boxOf(sel);
    if (!b) return false;
    await click(b.x, b.y, after);
    return true;
}
// the scene itself under the point: the canvas, and no gate handle or gate the edit view would pick there instead
const onCanvas = (x, y, strict = false) => page.evaluate(([a, b, st]) => {
    if (document.elementFromPoint(a, b)?.tagName !== 'CANVAS') return false;
    if (!st) return true;
    const v = window.__gsfpvEditView ? window.__gsfpvEditView() : null;
    const s = v?.stand?.screen;
    if (s && Math.hypot(a - s[0], b - s[1]) < 160) return false;
    if ((v?.gates || []).some((g) => g[2] > 0 && Math.hypot(a - g[0], b - g[1]) < 30)) return false;
    return !(window.__gsfpvEditHit && window.__gsfpvEditHit(a, b));
}, [x, y, strict]);
// the course's points in metres flown: the course file's pos times the flown transform [s, tx, ty, tz]
const flown = (p, tr) => [p[0] * tr[0] + tr[1], p[1] * tr[0] + tr[2], p[2] * tr[0] + tr[3]];
// a gate's way: its local -Z turned by quat [w, x, y, z] (sonic-fpv contract), on the floor plane
function wayOf(q) {
    const [w, x, y, z] = q;
    const f = [-(2 * (x * z + w * y)), -(2 * (y * z - w * x)), -(1 - 2 * (x * x + y * y))];
    return [f[0], f[2]];
}
const angle2 = (a, b) => { const d = Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1]); return Math.abs(d); };
const norm2 = (v) => { const n = Math.hypot(v[0], v[1]) || 1; return [v[0] / n, v[1] / n]; };

/** a leg of the course whose two gates are on the canvas, far apart on the page, not starting at the selected gate */
async function legs(s, any = false) {
    const g = s.gates || [];
    const out = [];
    for (let i = 0; i + 1 < g.length; i++) {
        const a = g[i];
        const b = g[i + 1];
        if ((!any && i === s.selected) || !(a[2] > 0 && b[2] > 0)) continue;
        const inV = (p) => p[0] > 40 && p[0] < W - 40 && p[1] > 110 && p[1] < H - 90;
        if (!inV(a) || !inV(b)) continue;
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        if (len < 70 || !(await onCanvas(mid[0], mid[1]))) continue;
        // a leg 4 m off at least (nearer is beside the pilot: course-line.ts ON_LEG_NEAR_M). Another leg drawn within 30 px
        // is allowed: the ray passes the clicked leg exactly, the other only near (legOnRay takes the nearest); STRICT=1 skips it
        const segPx = (p, q) => { const vx = q[0] - p[0], vy = q[1] - p[1]; const l2 = vx * vx + vy * vy || 1; const t = Math.max(0, Math.min(1, ((mid[0] - p[0]) * vx + (mid[1] - p[1]) * vy) / l2)); return Math.hypot(mid[0] - p[0] - vx * t, mid[1] - p[1] - vy * t); };
        let crossed = false;
        for (let j = 0; j + 1 < g.length && !crossed; j++) if (Math.abs(j - i) > 1 && g[j][2] > 0 && g[j + 1][2] > 0 && segPx(g[j], g[j + 1]) < 30) crossed = STRICT;
        if (crossed || Math.min(a[2], b[2]) < 4) continue;
        out.push({ i, len: Math.round(len), mid: mid.map(Math.round), depth: r2(Math.max(a[2], b[2])) });
    }
    // the nearest legs first: a click lands where its ray meets the scan (measured: legs 47 m off were behind a wall 6 m
    // from the eye, so the gate went, rightly, into the leg nearest that wall point)
    return out.sort((x, y) => x.depth - y.depth);
}
/** the view has stopped gliding (a selection frames its gate): the eye and the selected gate's place on the page unchanged
 *  over 250 ms, at most 4 s */
async function settle() {
    const key = (s) => JSON.stringify([s.stand?.screen, (s.gates || [])[0]]);
    let a = key(await snap());
    for (let t = 0; t < 16; t++) {
        await sleep(250);
        const b = key(await snap());
        if (b === a) return;
        a = b;
    }
}
async function backOff() {
    await page.keyboard.down('KeyS');
    await sleep(600);
    await page.keyboard.up('KeyS');
    await page.keyboard.down('KeyE');
    await sleep(250);
    await page.keyboard.up('KeyE');
    await sleep(500);
    const s = await snap();
    (res.backOffs ??= []).push({ onPage: (s.gates || []).filter((p) => p[2] > 0 && p[0] >= 0 && p[0] < W && p[1] >= 0 && p[1] < H).length, mode: s.mode, open: s.open });
}
/** Add armed (and a piece chosen in the Add list), a click at `at`; the page's state before and after */
const addPressed = () => page.evaluate(() => document.querySelector('.ce-topbar [data-top="add"]')?.getAttribute('aria-pressed') === 'true');
/** adding ends, as the pilot ends it: the Add list's cross when it shows, else a second press on Add (never Esc: Esc with
 *  nothing armed leaves the edit view) */
async function endAdding() {
    if (!(await addPressed())) return;
    if (!(await clickSel('[data-testid="add-chooser"] .ce-add-x', 400))) await clickSel('.ce-topbar [data-top="add"]', 400);
}
async function addAt(choice, at) {
    await endAdding();
    const a = await snap();
    const armed = (await clickSel('.ce-topbar [data-top="add"]', 500)) && (await addPressed());
    let chose = choice === 'gate';
    if (armed && choice !== 'gate') chose = await clickSel(`[data-testid="add-chooser"] [data-add="${choice}"]`, 400);
    if (!armed || !chose) {
        await endAdding();
        return { a, b: await snap(), armed, chose };
    }
    // the Add list now stands under the Add button: the first point (of `at`, one point or several) with the scene under it
    const pts = typeof at[0] === 'number' ? [at] : at;
    let p = null;
    for (const q of pts) if (await onCanvas(q[0], q[1], choice !== 'gate')) { p = q; break; }
    if (!p) {
        await endAdding();
        return { a, b: await snap(), armed, chose, covered: pts.length };
    }
    await click(p[0], p[1], 300);
    const b = (await until(snap, (s) => (s.list?.length ?? 0) > (a.list?.length ?? 0), 5000)).v;
    await endAdding();
    return { a, b, armed, chose, at: p };
}
async function undoOnce() {
    const ok = await clickSel('.ce-topbar [data-top="undo"]', 800);
    return { pressed: ok, s: await snap() };
}
const sameIds = (x, y) => JSON.stringify((x || []).map((g) => g.id)) === JSON.stringify((y || []).map((g) => g.id));

try {
    await page.goto(`${base}/fly/?scene=${scene}&nowarn=1${env.COURSE ? `&course=${env.COURSE}` : ''}${env.QUERY || ''}`,{ waitUntil: 'domcontentloaded', timeout: 120000 });
    const ready = await until(() => page.evaluate(() => window.__gsfpv?.status ?? null), (v) => v === 'ready' || v === 'error', 300000, 1000);
    res.ready = { status: ready.v, s: Math.round(ready.ms / 1000) };
    if (ready.v !== 'ready') throw new Error(`page status ${ready.v}`);
    const KB = '.screen.radio [data-action="radio-keyboard"]';
    await page.waitForSelector(KB, { timeout: 20000 }).catch(() => null);
    await clickSel(KB, 1500);
    await click(W / 2, H / 2, 900);
    res.lockAfterClick = (await snap()).lock;
    if (!env.COURSE) await page.keyboard.press('Shift+KeyG');
    const gen = await until(snap, (s) => (s.courseGates ?? 0) > 0 && s.courseOn, Number(env.COURSE_MS || 300000), 1000);
    res.course = { ok: gen.ok, s: Math.round(gen.ms / 1000), gates: gen.v.courseGates };
    if (!gen.ok) throw new Error('no course');
    await sleep(1500);
    await page.keyboard.press('Shift+KeyB');
    const op = await until(snap, (s) => s.open && s.mode === 'edit', 30000, 400);
    await sleep(1500);
    const onPage = (op.v.gates || []).filter((p) => p[2] > 0 && p[0] >= 0 && p[0] < W && p[1] >= 0 && p[1] < H).length;
    const under = await page.evaluate(([w, h]) => [[0.5, 0.5], [0.3, 0.3], [0.7, 0.7], [0.5, 0.8]].map(([fx, fy]) => { const e = document.elementFromPoint(w * fx, h * fy); return e ? `${e.tagName}.${String(e.className).slice(0, 40)}${e.id ? '#' + e.id : ''}` : null; }), [W, H]);
    judge('s1.open', op.ok, { mode: op.v.mode, gates: op.v.list?.length ?? null, onPage, under, screen: (op.v.gates || []).slice(0, 12), selected: op.v.selected, stand: op.v.stand?.screen ?? null, lock: op.v.lock });
    if (!op.ok) throw new Error('edit view did not open');
    await page.keyboard.press('KeyM');
    await sleep(300);

    // s2: a gate between two gates far apart
    {
        let tries = [];
        let found = null;
        let judged = null;
        for (let n = 0; n < 4 && !judged; n++) {
            const s = await snap();
            // only legs not starting at the selected gate: there the old page's 'after the selected one' matches by luck
            // (measured: the live site passed leg 1 -> 2 with gate 1 selected, 3 deg off); none on the page: select a far gate
            const ls = await legs(s);
            if (!ls.length) {
                const far = (s.gates || []).map((p, i) => ({ p, i })).filter(({ p, i }) => i !== s.selected && p[2] > 0 && p[0] > 40 && p[0] < W - 40 && p[1] > 110 && p[1] < H - 90).sort((x, y) => y.p[2] - x.p[2])[0];
                if (far) { await click(far.p[0], far.p[1], 800); await settle(); tries.push({ selectedFar: far.i, now: (await snap()).selected }); } else await backOff();
                continue;
            }
            for (const leg of ls.slice(0, 6)) {
                const { a, b, armed } = await addAt('gate', leg.mid);
                const k = b.selected;
                const grew = (b.list?.length ?? 0) === (a.list?.length ?? 0) + 1;
                const tr = b.place?.tr ?? [1, 0, 0, 0];
                const t = { leg: leg.i, clickedAt: leg.mid, armed, grew, newIndex: k, wantIndex: leg.i + 1, hitM: b.place?.hit ?? null };
                if (grew && k !== null && b.list[k - 1] && b.list[k + 1]) {
                    const p = flown(b.list[k - 1].pos, tr);
                    const c = flown(b.list[k].pos, tr);
                    const q = flown(b.list[k + 1].pos, tr);
                    const bis = norm2([norm2([c[0] - p[0], c[2] - p[2]])[0] + norm2([q[0] - c[0], q[2] - c[2]])[0], norm2([c[0] - p[0], c[2] - p[2]])[1] + norm2([q[0] - c[0], q[2] - c[2]])[1]]);
                    t.offDeg = deg(angle2(norm2(wayOf(b.list[k].quat)), bis));
                    t.neighbours = [b.list[k - 1].id, b.list[k + 1].id];
                    t.wasLeg = [a.list[leg.i]?.id, a.list[leg.i + 1]?.id];
                    t.between = t.neighbours[0] === t.wasLeg[0] && t.neighbours[1] === t.wasLeg[1];
                }
                // the scan in front of the leg: the click's ray met a wall (or nothing: 6 m ahead, add-place.ts ADD_AHEAD_M)
                // well before the leg, so the pilot clicked that wall, not the leg; the gate rightly goes there. Not judged.
                const reach = t.hitM ?? 6;
                t.legDepth = leg.depth;
                t.hidden = reach < 0.8 * Math.min(s.gates[leg.i][2], s.gates[leg.i + 1][2]);
                tries.push(t);
                if (grew) await undoOnce();
                // a click that added nothing (it met a handle or a gate under the point) is tried again elsewhere
                if (!t.hidden && t.armed && t.grew) { judged = t; break; }
            }
            if (!judged) {
                // every leg tried stood behind the scan: select the farthest gate on the page (the view frames it) and go on
                const far = (s.gates || []).map((p, i) => ({ p, i })).filter(({ p, i }) => i !== s.selected && p[2] > 0 && p[0] > 40 && p[0] < W - 40 && p[1] > 110 && p[1] < H - 90).sort((x, y) => y.p[2] - x.p[2])[0];
                if (far) { await click(far.p[0], far.p[1], 800); await settle(); tries.push({ selectedFar: far.i, now: (await snap()).selected }); }
            }
        }
        found = judged && judged.between && judged.offDeg <= 15 ? judged : null;
        judge('s2.add', !!found, { judged, tries: tries.slice(0, 10) });
    }

    // s3 / s4: the pieces, each removed by one Undo press
    for (const [step, choice, n, stack] of [['s3', 'double-vertical', 2, 'up'], ['s4', 'triple-horizontal', 3, 'side']]) {
        let s = await snap();
        let ls = await legs(s, true);
        for (let k = 0; k < 3 && !ls.length; k++) { await backOff(); s = await snap(); ls = await legs(s, true); }
        const at = [...ls.map((l) => l.mid), [W / 2, Math.round(H * 0.6)], [W * 0.35, Math.round(H * 0.6)]];
        const { a, b, armed, chose, covered } = await addAt(choice, at);
        const added = (b.list || []).filter((g) => !(a.list || []).some((o) => o.id === g.id));
        const tr = b.place?.tr ?? [1, 0, 0, 0];
        const ps = added.map((g) => flown(g.pos, tr));
        const gaps = ps.slice(1).map((p, i) => ({ up: r2(p[1] - ps[i][1]), side: r2(Math.hypot(p[0] - ps[i][0], p[2] - ps[i][2])) }));
        const shapeOk = stack === 'up' ? gaps.every((g) => g.up > 1.5 && g.side < 0.3) : gaps.every((g) => Math.abs(g.up) < 0.3 && g.side > 1.5);
        judge(`${step}.piece`, added.length === n && shapeOk, { choice, armed, chose, covered: covered ?? null, added: added.length, gaps, refused: b.refused, said: b.said });
        if (added.length > 0) {
            const u = await undoOnce();
            judge(`${step}.undo`, sameIds(u.s.list, a.list), { pressed: u.pressed, gates: [a.list?.length, b.list?.length, u.s.list?.length] });
        } else judge(`${step}.undo`, false, { why: 'no piece to undo' });
    }

    // s5-s7: a gate dragged by its arrow toward the next gate
    {
        // the gate to drag: one on the page with a next gate, its handles shown (a click selects it)
        let s = await snap();
        let gi = null;
        for (let n = 0; n < 4 && gi === null; n++) {
            const g = s.gates || [];
            // any gate on the page with a next gate: a click selects it and the view frames it (E1); its handles must then
            // stand well inside the page
            const cand = g.map((p, i) => ({ p, i })).filter(({ p, i }) => i + 1 < g.length && p[2] > 0 && p[0] > 40 && p[0] < W - 40 && p[1] > 110 && p[1] < H - 90 && g[i + 1][2] > 0)
                .sort((x, y) => Math.hypot(x.p[0] - W / 2, x.p[1] - H / 2) - Math.hypot(y.p[0] - W / 2, y.p[1] - H / 2));
            for (const c of cand.slice(0, 4)) {
                if (s.selected !== c.i && (await onCanvas(c.p[0], c.p[1]))) { await click(c.p[0], c.p[1], 300); s = (await until(snap, (x) => x.selected === c.i, 2500)).v; await settle(); s = await snap(); }
                const st = s.stand?.screen;
                if (s.selected === c.i && st && st[2] > 0 && st[0] > 100 && st[0] < W - 100 && st[1] > 120 && st[1] < H - 110) { gi = c.i; break; }
            }
            if (gi === null) { await backOff(); s = await snap(); }
        }
        const tags = [];
        /** press on the arrow that points most toward the next gate, travel along it until the tag shows (or maxPx) */
        async function dragToward(label) {
            const d = await snap();
            const from = d.stand?.screen;
            const nb = d.gates?.[gi + 1];
            if (!from || !nb || !d.axes) return { ok: false, why: 'no handles or no next gate' };
            // the arrow whose axis in the scene (the gate's right, up, forward from its quat) points most toward the next gate
            const me = d.list[gi];
            const to = d.list[gi + 1].pos.map((v, i) => v - me.pos[i]);
            const [w, x, y, z] = me.quat;
            const world = { x: [1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y)], y: [2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x)], z: [-(2 * (x * z + w * y)), -(2 * (y * z - w * x)), -(1 - 2 * (x * x + y * y))] };
            const best = ['x', 'y', 'z'].map((k) => ({ k, dot: world[k][0] * to[0] + world[k][1] * to[1] + world[k][2] * to[2] })).sort((p, q) => Math.abs(q.dot) - Math.abs(p.dot))[0];
            const dir = best.dot >= 0 ? d.axes[best.k] : [-d.axes[best.k][0], -d.axes[best.k][1]];
            const hitAt = await page.evaluate(([f, dv, ax]) => {
                const h = window.__gsfpvEditHit;
                for (let r = 14; r <= 400; r += 2) { const x = f[0] + dv[0] * r; const y = f[1] + dv[1] * r; const hit = h?.(x, y); if (hit && hit[1] === ax) return [x, y]; }
                for (let r = 14; r <= 400; r += 2) { const x = f[0] - dv[0] * r; const y = f[1] - dv[1] * r; const hit = h?.(x, y); if (hit && hit[1] === ax) return [x, y]; }
                return null;
            }, [from, d.axes[best.k], best.k]);
            if (!hitAt) return { ok: false, why: `no ${best.k} arrow on the page`, axis: best.k };
            const before = d.list[gi].pos;
            await page.mouse.move(hitAt[0], hitAt[1]);
            await sleep(200);
            await page.mouse.down();
            let tag = null;
            let px = 0;
            for (px = 4; px <= 900; px += 6) {
                await page.mouse.move(hitAt[0] + dir[0] * px, hitAt[1] + dir[1] * px);
                await sleep(30);
                if (px >= 40 && px % 24 === 4) {
                    const m = await snap();
                    if (m.warnDom && m.warn && m.warn !== 'absent' && m.warn.mode === 'tag') { tag = { codes: m.warn.codes, lines: m.warn.lines, box: m.warnDom.box, dragging: m.dragging }; break; }
                }
            }
            await sleep(250);
            if (tag && env.SHOT && label === 'first') await page.screenshot({ path: env.SHOT });
            const during = await snap();
            await page.mouse.up();
            await sleep(700);
            const after = await snap();
            tags.push({ label, axis: best.k, px, tag });
            return { ok: !!tag, tag, px, axis: best.k, before, during: during.list?.[gi]?.pos ?? null, after, id: d.list[gi].id };
        }
        if (gi === null) {
            judge('s5.tag', false, { why: 'no gate with a next gate on the page' });
            judge('s6.putBack', false, { why: 'no drag' });
            judge('s7.keep', false, { why: 'no drag' });
        } else {
            const one = await dragToward('first');
            judge('s5.tag', one.ok, { gate: gi + 1, axis: one.axis, px: one.px, tag: one.tag ?? null, why: one.why ?? null });
            const asked = one.after?.askDom && one.after.warn?.mode === 'ask';
            let back = null;
            if (asked) {
                await clickSel('[data-testid="ce-warn"] [data-warn="put-back"]', 900);
                back = await snap();
            }
            const restored = !!back && back.list?.[gi] && Math.hypot(...back.list[gi].pos.map((v, i) => v - one.before[i])) < 0.01;
            judge('s6.putBack', !!asked && restored, { asked: !!asked, ask: one.after?.askDom?.text ?? null, moved: one.after?.list?.[gi]?.pos ?? null, back: back?.list?.[gi]?.pos ?? null, before: one.before, barAfter: back?.warn?.mode ?? null });
            // the second drag starts from the pose Put back gave; a press that missed the arrow (the bar just closed over the
            // scene) is tried once more
            await settle();
            let two = await dragToward('second');
            if (!two.ok && !two.after?.askDom) { await settle(); two = await dragToward('second-again'); }
            const asked2 = two.after?.askDom && two.after.warn?.mode === 'ask';
            let kept = null;
            if (asked2) {
                await clickSel('[data-testid="ce-warn"] [data-warn="keep"]', 900);
                kept = await snap();
            }
            const stayed = !!kept && kept.list?.[gi] && two.after.list?.[gi] && Math.hypot(...kept.list[gi].pos.map((v, i) => v - two.after.list[gi].pos[i])) < 0.01;
            const moved = !!two.after?.list?.[gi] && Math.hypot(...two.after.list[gi].pos.map((v, i) => v - two.before[i])) > 0.05;
            const orange = !!kept && Array.isArray(kept.warn?.kept) && kept.warn.kept.includes(two.id);
            judge('s7.keep', !!asked2 && stayed && moved && orange, { asked: !!asked2, stayed, moved, kept: kept?.warn?.kept ?? null, id: two.id, barAfter: kept?.warn?.mode ?? null, why: two.why ?? null, px: two.px ?? null });
        }
        res.tags = tags;
    }

    // s8: the Add list at 844x390
    {
        await page.setViewportSize({ width: 844, height: 390 });
        await sleep(1200);
        await clickSel('.ce-topbar [data-top="add"]', 600);
        const m = await page.evaluate(() => {
            const r = document.querySelector('[data-testid="add-chooser"]');
            if (!r || r.hidden || !r.getClientRects().length) return null;
            const box = (e) => { const b = e.getBoundingClientRect(); return [b.left, b.top, b.width, b.height].map(Math.round); };
            const items = [...r.querySelectorAll('button')].map((b) => { const bb = b.getBoundingClientRect(); const top = document.elementFromPoint(bb.left + bb.width / 2, bb.top + bb.height / 2); return { text: (b.textContent || '').trim(), box: box(b), clear: top === b || b.contains(top) }; });
            const x = r.querySelector('.ce-add-x');
            return { box: box(r), items, cross: x ? box(x) : null, view: [innerWidth, innerHeight] };
        });
        const fits = !!m && m.box[0] >= 0 && m.box[1] >= 0 && m.box[0] + m.box[2] <= 844 && m.box[1] + m.box[3] <= 390;
        const clear = !!m && m.items.every((i) => i.clear);
        const cross44 = !!m && !!m.cross && m.cross[2] >= 44 && m.cross[3] >= 44;
        let closed = false;
        if (m && m.cross) {
            await click(m.cross[0] + m.cross[2] / 2, m.cross[1] + m.cross[3] / 2, 600);
            const s = await snap();
            closed = !s.addDom && (await page.evaluate(() => document.querySelector('.ce-topbar [data-top="add"]')?.getAttribute('aria-pressed'))) !== 'true';
        }
        judge('s8.small', fits && clear && cross44 && closed, { fits, clear, cross44, closed, list: m });
    }
} catch (e) {
    res.error = String(e).slice(0, 400);
    fails.push('error');
}
res.fails = fails;
res.log = log.slice(0, 20);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(res, null, 1));
const brief = Object.entries(res.steps).map(([k, v]) => `${k}:${v.verdict}`).join(' ');
console.log(JSON.stringify({ address: base, verdict: fails.length ? 'FAIL' : 'PASS', steps: brief, error: res.error ?? null }));
await browser.close();
process.exit(fails.length ? 1 : 0);
