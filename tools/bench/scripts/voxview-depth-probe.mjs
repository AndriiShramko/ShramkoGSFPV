// Lane voxview (stage X1-depth): do the voxel view and the gates share one depth? On a scan with a course (Shift+G), the
// voxels alone (V) and over the scan: the layer and material facts, an eye place where the next gate stands half in
// front of a voxel wall and half behind another (found with rays through the walls), and per sample point of the gate
// the pixel of three pictures: A gates and voxels, B voxels without the gates, C gates alone on black. A point counts
// as "gate shown" when A is nearer to C than to B; the rays say which it should be. --panel instead measures the walls
// and voxels panel (the "Walls 5 cm" chip on the credit line) at four small sizes, with rendering off (no GPU lock).
// Usage: node voxview-depth-probe.mjs <base with /en> <scene> <out.json> <shots dir> <tag> [--panel]
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pickBrowser } from '../src/chrome.mjs';
import { buildFromDialog, shiftG } from './gen-build.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const sharp = (() => { try { return require('sharp'); } catch { return createRequire(new URL('../../../node_modules/.pnpm/sharp@0.35.4_@types+node@22.20.4/node_modules/sharp/package.json', import.meta.url))('sharp'); } })();
const args = process.argv.slice(2);
const [base, id, out, shots, tag] = args;
if (!base || !id || !out || !shots || !tag) { console.error('usage: voxview-depth-probe.mjs <base with /en> <scene> <out.json> <shots dir> <tag> [--panel]'); process.exit(2); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r = { base, id, tag, steps: [] };
const step = (s) => { r.steps.push(s); console.log(s); };
const pick = pickBrowser({ expected: chromium.executablePath() });
const browser = await chromium.launch({ ...pick.launch, headless: true });
const t0 = Date.now();

async function open(w, hgt, extra) {
    const ctx = await browser.newContext({ viewport: { width: w, height: hgt }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log('pageerror ' + String(e.message).slice(0, 200)));
    await page.goto(`${base}/fly/?scene=${id}&nowarn=1${extra}`);
    await page.waitForFunction(() => ['ready', 'error'].includes(window.__gsfpv?.status), null, { timeout: 240000 });
    try {
        await page.waitForSelector('.screen.radio [data-action="radio-keyboard"]', { timeout: 15000 });
        await page.focus('.screen.radio [data-action="radio-keyboard"]');
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => !document.querySelector('.screen.radio'), null, { timeout: 15000 });
        step('controls screen: Enter on "keyboard"');
    } catch { step('no controls screen'); }
    await sleep(1000);
    return { ctx, page };
}

// voxview2: Shift+G (a course), Shift+B (the edit mode), the panel open: does any control of the edit mode lie over the
// panel or its cross, and does a visible voxel legend share pixels with the editor's window?
async function editPass(page, read) {
    await shiftG(page);
    const s0 = Date.now();
    while (Date.now() - s0 < 30000 && !(await page.evaluate(() => (window.__gsfpv?.course?.gates?.length ?? window.__gsfpv?.course?.state?.()?.gates ?? 0) > 0 || !!document.querySelector('.course-hud, [class*=course-]')))) await sleep(500);
    await page.keyboard.press('Shift+KeyB');
    const s1 = Date.now();
    while (Date.now() - s1 < 30000 && !(await page.evaluate(() => !!window.__gsfpv?.course?.editor?.open))) await sleep(500);
    const editOpen = await page.evaluate(() => !!window.__gsfpv?.course?.editor?.open);
    if (!editOpen) return { editOpen };
    await sleep(800);
    await page.evaluate(() => { const d = document.querySelector('[data-testid=walls-more]'); if (d) d.open = true; });
    await sleep(500);
    const v = await read();
    const o = await page.evaluate(() => {
        const box = (el) => { if (!el || el.getClientRects().length === 0 || getComputedStyle(el).visibility === 'hidden') return null; const b = el.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; };
        const cut = (a, b) => !!a && !!b && a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
        const menu = box(document.querySelector('.walls-menu'));
        const legend = box(document.querySelector('[data-testid=voxel-legend]'));
        const parts = {};
        for (const [k, sel] of [['window', '.course-editor'], ['topBar', '.ce-topbar'], ['gateBar', '.ce-gatebar']]) {
            const b = box(document.querySelector(sel));
            const el = document.querySelector(sel);
            let onTop = null;
            if (cut(b, menu)) { const x = (Math.max(b.l, menu.l) + Math.min(b.r, menu.r)) / 2, y = (Math.max(b.t, menu.t) + Math.min(b.b, menu.b)) / 2; const hit = document.elementFromPoint(x, y); onTop = hit && el.contains(hit) ? 'bar' : hit && document.querySelector('.walls-menu')?.contains(hit) ? 'panel' : String(hit?.className ?? null); }
            parts[k] = { box: b, overPanel: cut(b, menu), onTop, overLegend: cut(b, legend) };
        }
        return { parts, legendShown: !!legend };
    });
    return { editOpen, closeOnTop: v.closeOnTop, closeInView: v.closeInView, menuInView: v.menuInView, open: v.open, menu: v.menu, chip: v.chip, close: v.close, ...o };
}

async function panel() {
    r.panel = {};
    for (const [w, hgt] of [[1366, 768], [1280, 720], [844, 390], [390, 844]]) {
        const { ctx, page } = await open(w, hgt, `&render=off${w < 600 || hgt < 500 ? '&input=touch' : ''}`);
        await page.waitForSelector('[data-testid=walls-summary]', { timeout: 30000 });
        await page.click('[data-testid=walls-summary]');
        await sleep(600);
        const read = () => page.evaluate(() => {
            const box = (el) => { if (!el || el.getClientRects().length === 0) return null; const b = el.getBoundingClientRect(); return { l: Math.round(b.left), t: Math.round(b.top), r: Math.round(b.right), b: Math.round(b.bottom), w: Math.round(b.width), h: Math.round(b.height) }; };
            const menu = document.querySelector('.walls-menu');
            const close = document.querySelector('[data-action=voxpanel-close]');
            const fold = document.querySelector('[data-action=voxpanel-fold]');
            const cb = box(close);
            const inView = (b) => !!b && b.l >= 0 && b.t >= 0 && b.r <= innerWidth && b.b <= innerHeight;
            const hit = cb ? document.elementFromPoint((cb.l + cb.r) / 2, (cb.t + cb.b) / 2) : null;
            return { vw: innerWidth, vh: innerHeight, open: !!document.querySelector('[data-testid=walls-more]')?.open, menu: box(menu), menuInView: inView(box(menu)), scrollH: menu?.scrollHeight ?? 0, clientH: menu?.clientHeight ?? 0, overflowY: menu ? getComputedStyle(menu).overflowY : null, close: cb, closeInView: inView(cb), closeOnTop: !!hit && (hit === close || close.contains(hit)), fold: box(fold), title: document.querySelector('.walls-title')?.textContent ?? null, chip: box(document.querySelector('[data-testid=walls-summary]')) };
        });
        const v = await read();
        const f = join(shots, `voxview-panel-${w}${tag === 'before' ? '-before' : ''}.png`);
        if (w === 1366 || w === 844) await page.screenshot({ path: f });
        // the close control, then Esc after opening again, then the chip
        const after = {};
        if (v.close) { await page.click('[data-action=voxpanel-close]'); await sleep(300); after.closeBtn = await page.evaluate(() => !document.querySelector('[data-testid=walls-more]')?.open); }
        await page.click('[data-testid=walls-summary]'); await sleep(300);
        await page.keyboard.press('Escape'); await sleep(300);
        after.esc = await page.evaluate(() => !document.querySelector('[data-testid=walls-more]')?.open);
        // the chip as a person uses it: one click opens, the next click closes
        await page.click('[data-testid=walls-summary]'); await sleep(300);
        after.chipOpened = await page.evaluate(() => !!document.querySelector('[data-testid=walls-more]')?.open);
        await page.click('[data-testid=walls-summary]').catch(() => {}); await sleep(300);
        after.chip = await page.evaluate(() => !document.querySelector('[data-testid=walls-more]')?.open);
        // voxview2: the edit mode's window, top bar and gate bar (new on main) against the panel, its cross and the legend
        after.edit = await editPass(page, read);
        r.panel[`${w}x${hgt}`] = { ...v, after };
        step(`panel ${w}x${hgt}: ${JSON.stringify({ menu: v.menu, inView: v.menuInView, close: v.close, closeInView: v.closeInView, closeOnTop: v.closeOnTop, scroll: [v.scrollH, v.clientH, v.overflowY], after })}`);
        await ctx.close();
    }
}

async function depth() {
    const { page } = await open(1280, 800, '');
    await shiftG(page);
    step('Shift+G');
    for (let k = 0; ; k++) {
        const st = await page.evaluate(() => { const c = window.__gsfpv?.course; return c ? { source: c.source, problem: c.problem ?? null, gates: c.gates } : null; });
        if (st && (st.source === 'generated' || st.problem)) { step(`course after ${Math.round((Date.now() - t0) / 1000)} s: ${JSON.stringify(st)}`); break; }
        if (Date.now() - t0 > 400000) throw new Error('no course');
        await sleep(1000);
    }
    await sleep(2000);
    // the facts of the drawing: layers in order, the voxel layer's clear, the gates' materials
    r.facts = await page.evaluate(() => {
        const app = window.__gsfpv.session.renderer.app;
        const L = app.scene.layers;
        const order = L.layerList.map((l, i) => `${i}:${l.name}${L.subLayerList?.[i] ? ':T' : ':O'}${l.clearDepthBuffer ? ':clearDepth' : ''}`);
        const stage = app.root.findByName('course-stage');
        const mats = [];
        stage?.forEach?.((n) => { const mi = n.render?.meshInstances?.[0]; if (mi && mats.length < 2) mats.push({ name: n.name, layers: [...n.render.layers], depthTest: mi.material.depthTest, depthWrite: mi.material.depthWrite, blend: mi.material.blendType }); });
        return { order, gateMaterials: mats };
    });
    step(`facts ${JSON.stringify(r.facts)}`);
    await page.evaluate(() => window.__gsfpv.voxels.setMode('only'));
    step('voxels: only (the key V twice does the same: off -> over the scan -> voxels only)');
    const settle = async (ms = 45000) => { const s = Date.now(); while (Date.now() - s < ms) { if (await page.evaluate(() => window.__gsfpv.voxels.settled())) return Date.now() - s; await sleep(300); } return -1; };
    r.settleOnlyMs = await settle();
    r.statsSpawn = await page.evaluate(() => { const s = window.__gsfpv.voxels.stats(); return { style: s.style, opacity: s.opacity, depthItems: s.depthItems, chunks: s.chunks, quads: s.quads, fineRadiusM: s.fineRadiusM, radiusM: s.radiusM, voxelCm: s.voxelCm }; });
    step(`voxels at spawn ${JSON.stringify(r.statsSpawn)} settled in ${r.settleOnlyMs} ms`);
    // the hold: the craft kept at a pose every frame (yaw about +y); with a course on, the camera follows the game aim
    // (play.ts: aimYawDeg, heading = -yaw), so the aim carries the held yaw and pitch
    await page.evaluate(() => {
        const ss = window.__gsfpv.session;
        const orig = ss.cameraAim;
        window.__hold = null;
        if (orig) ss.cameraAim = () => { const a = orig.call(ss); return a && window.__hold ? { ...a, yawDeg: (-window.__hold.yaw * 180) / Math.PI, pitchDeg: window.__hold.pitch } : a; };
        const tick = () => { const h = window.__hold; if (h) { const s = ss.sim.s; s[0] = h.pos[0]; s[1] = h.pos[1]; s[2] = h.pos[2]; for (let i = 3; i < 6; i++) s[i] = 0; s[6] = Math.cos(h.yaw / 2); s[7] = 0; s[8] = Math.sin(h.yaw / 2); s[9] = 0; for (let i = 10; i < 13; i++) s[i] = 0; } requestAnimationFrame(tick); };
        tick();
    });
    // sample points on the gate parts (the next gate): each part's box centre and the middles of its two long edges
    const samples = await page.evaluate(() => {
        const g = window.__gsfpv, c = g.course;
        const stage = g.session.renderer.app.root.findByName('course-stage');
        const parts = [];
        stage.children.forEach((n) => { const mi = n.render?.meshInstances?.[0]; if (mi) parts.push(mi.aabb); });
        const next = Math.max(0, c.next);
        const gp = c.gatePoses()[next].pos;
        const pts = [];
        for (const a of parts) {
            const ce = [a.center.x, a.center.y, a.center.z], he = [a.halfExtents.x, a.halfExtents.y, a.halfExtents.z];
            if (Math.hypot(ce[0] - gp[0], ce[1] - gp[1], ce[2] - gp[2]) > 3) continue;
            const ax = [0, 1, 2].sort((i, j) => he[j] - he[i]);
            const big = he[ax[0]] > 0.6 && he[ax[1]] > 0.6; // a ring: its centre is empty, points on the ring at 12 angles
            if (big) for (let k = 0; k < 12; k++) { const a = (k * Math.PI) / 6, p = [...ce]; p[ax[0]] += Math.cos(a) * he[ax[0]] * 0.92; p[ax[1]] += Math.sin(a) * he[ax[1]] * 0.92; pts.push(p); }
            else for (const f of [-0.8, -0.4, 0, 0.4, 0.8]) { const p = [...ce]; p[ax[0]] += f * he[ax[0]]; pts.push(p); } // a box: 5 places along its long axis
        }
        return { gate: next, pos: gp, pts };
    });
    r.gate = { index: samples.gate, pos: samples.pos, points: samples.pts.length };
    // eye places: around the gate, rays from the eye to each point through the walls; mixed = some hidden, some clear
    const cands = await page.evaluate(({ gp, pts }) => {
        const col = window.__gsfpv.session.collision;
        const res = [];
        for (const d of [5, 8, 12, 16]) for (let yd = 0; yd < 360; yd += 15) for (const dh of [0, 1.5]) {
            const y = (yd * Math.PI) / 180;
            const e = [gp[0] + d * Math.sin(y), gp[1] + dh, gp[2] + d * Math.cos(y)];
            if (col.isFreeAt && !col.isFreeAt(e[0], e[1], e[2])) continue;
            let hid = 0;
            const flags = pts.map((p) => { const v = [p[0] - e[0], p[1] - e[1], p[2] - e[2]]; const L = Math.hypot(...v); const h = col.queryRay(e[0], e[1], e[2], v[0] / L, v[1] / L, v[2] / L, L); const o = !!h && Math.hypot(h.x - e[0], h.y - e[1], h.z - e[2]) < L - 0.2; if (o) hid++; return o; });
            // and is there a wall behind the gate (within 40 m) for the visible half to stand in front of
            const v = [gp[0] - e[0], gp[1] - e[1], gp[2] - e[2]]; const L = Math.hypot(...v);
            const back = col.queryRay(gp[0], gp[1], gp[2], v[0] / L, v[1] / L, v[2] / L, 40);
            res.push({ e, yd, d, dh, hid, n: pts.length, flags, back: back ? +Math.hypot(back.x - gp[0], back.y - gp[1], back.z - gp[2]).toFixed(1) : null });
        }
        return res;
    }, { gp: samples.pos, pts: samples.pts });
    const score = (c) => (c.back === null ? 9 : 0) + Math.abs(c.hid / c.n - 0.5);
    cands.sort((a, b) => score(a) - score(b));
    const eyes = [cands[0]];
    const second = cands.find((c) => Math.abs(((c.yd - cands[0].yd + 540) % 360) - 180) > 60);
    if (second) eyes.push(second);
    r.candidates = cands.length;
    const wait = async () => { await sleep(400); await settle(30000); await sleep(800); };
    const look = async (e) => {
        // X1.4a: the yaw whose picture has the gate centre in front of the camera and nearest the middle (projected)
        const dx = samples.pos[0] - e[0], dz = samples.pos[2] - e[2], dy = samples.pos[1] - e[1];
        let best = null;
        for (const yaw of [Math.atan2(-dx, -dz), Math.atan2(dx, dz), Math.atan2(-dx, dz), Math.atan2(dx, -dz)]) {
            await page.evaluate(({ e, yaw }) => { window.__hold = { pos: e, yaw, pitch: 0 }; }, { e, yaw });
            // the camera follows the held yaw with a lag: wait, then ask the guide where the next gate is (bearing 0 = ahead)
            await sleep(1200);
            const gd = await page.evaluate(() => window.__gsfpv.course.guide?.() ?? null);
            const off = gd && Number.isFinite(gd.bearingDeg) ? Math.abs(gd.bearingDeg) : 1e9;
            if (!best || off < best.off) best = { yaw, off: Math.round(off) };
        }
        const pitch = (Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI;
        await page.evaluate(({ e, yaw, pitch }) => { window.__hold = { pos: e, yaw, pitch }; }, { e, yaw: best.yaw, pitch });
        return best;
    };
    const proj = () => page.evaluate((pts) => {
        const cam = window.__gsfpv.session.renderer.camera;
        const V = cam.getPosition().constructor;
        return pts.map((p) => { const s = cam.camera.worldToScreen(new V(p[0], p[1], p[2]), new V()); return [Math.round(s.x), Math.round(s.y), s.z]; });
    }, samples.pts);
    const raw = async (f) => { const buf = await page.screenshot({ path: f ?? undefined }); const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true }); return { data, w: info.width, ch: info.channels }; };
    const px = (img, x, y) => { const i = (y * img.w + x) * img.ch; return [img.data[i], img.data[i + 1], img.data[i + 2]]; };
    const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const course = (on) => page.evaluate((on) => { const s = window.__gsfpv.session.renderer.app.root.findByName('course-stage'); if (s) s.enabled = on; }, on);
    const measure = async (name, mode, eye) => {
        await page.evaluate((m) => window.__gsfpv.voxels.setMode(m), mode);
        await look(eye.e);
        await wait();
        const scr = await proj();
        const A = await raw(join(shots, `${name}.png`));
        await course(false); await sleep(500);
        const B = await raw();
        await course(true);
        await page.evaluate(() => { window.__gsfpv.voxels.setMode('off'); window.__gsfpv.session.renderer.setSplatVisible(false); });
        await sleep(700);
        const C = await raw();
        await page.evaluate((m) => window.__gsfpv.voxels.setMode(m), mode);
        const rows = [];
        scr.forEach(([x, y, z], i) => {
            if (z <= 0 || x < 0 || y < 0 || x >= 1280 || y >= 800) return;
            const a = px(A, x, y), b = px(B, x, y), c = px(C, x, y);
            if (dist(c, [0, 0, 0]) < 60 || dist(b, c) < 40) return; // not on the gate in C, or the voxel looks like the gate here
            const shown = dist(a, c) < dist(a, b);
            rows.push({ x, y, hiddenByRay: eye.flags[i], shown, ok: shown === !eye.flags[i], A: a, B: b, C: c });
        });
        const ok = rows.filter((q) => q.ok).length;
        const front = rows.filter((q) => !q.hiddenByRay), behind = rows.filter((q) => q.hiddenByRay);
        const marked = [front[0], behind[0], front[Math.floor(front.length / 2)] ?? behind[1]].filter(Boolean);
        if (marked.length) {
            const svg = `<svg width="1280" height="800" xmlns="http://www.w3.org/2000/svg">${marked.map((q, k) => `<circle cx="${q.x}" cy="${q.y}" r="9" fill="none" stroke="${q.hiddenByRay ? '#ff00ff' : '#00e5ff'}" stroke-width="2"/><text x="${q.x + 12}" y="${q.y - 10}" fill="#fff" font-size="16" font-family="Arial">${k + 1}</text>`).join('')}</svg>`;
            await sharp(join(shots, `${name}.png`)).composite([{ input: Buffer.from(svg) }]).toFile(join(shots, `${name}-marked.png`));
        }
        const res = { name, mode, eye: { pos: eye.e.map((v) => +v.toFixed(2)), dist: eye.d, yawDeg: eye.yd, hidRays: eye.hid, of: eye.n, wallBehindGateM: eye.back }, points: rows.length, right: ok, front: front.length, frontShown: front.filter((q) => q.shown).length, behind: behind.length, behindShown: behind.filter((q) => q.shown).length, marked };
        step(`${name}: ${JSON.stringify({ ...res, marked: marked.map((q) => ({ x: q.x, y: q.y, hiddenByRay: q.hiddenByRay, shown: q.shown, A: q.A, B: q.B, C: q.C })) })}`);
        return res;
    };
    const sfx = tag === 'before' ? '-before' : '';
    r.pictures = [];
    r.pictures.push(await measure(`voxview-depth-1${sfx}`, 'only', eyes[0]));
    if (eyes[1]) r.pictures.push(await measure(`voxview-depth-2${sfx}`, 'only', eyes[1]));
    r.pictures.push(await measure(`voxview-depth-scan${sfx}`, 'overlay', eyes[0]));
    // the baseline: the scan alone (voxels off) at the same eye: does the scan itself hide the gate behind the wall?
    r.pictures.push(await measure(`voxview-depth-scanonly${sfx}`, 'off', eyes[0]));
    r.guide = await page.evaluate(() => { const gd = window.__gsfpv.course.guide?.(); const el = document.querySelector('[data-testid=course-guide]'); return { hook: gd, text: el?.textContent ?? null, visible: !!el && el.offsetParent !== null }; });
    step(`guide chip ${JSON.stringify(r.guide)}`);
}

// --far (stage X2-whole-scene): the voxels alone on the whole scene. Phases (env FAR_PHASES, default spawn,up,weak):
// spawn: the switch at the street eye, share and far distance each second until settled, frame time, picture
// <tag>-street; up: the spawn 60 m higher looking down 40 deg, picture <tag>-far; weak: setDetail(0.125) at the 60 m
// eye, picture <tag>-weak (pitch: negative looks down, game.ts GIMBAL_MIN_DEG -60). Frame time: mean and p95 of requestAnimationFrame gaps over 3 s (BENCH_UNCAPPED=1 unpaces).
async function far() {
    const phases = (process.env.FAR_PHASES ?? 'spawn,up,weak').split(',');
    const { page } = await open(1280, 800, '');
    for (;;) {
        const w = await page.evaluate(() => { const v = window.__gsfpv?.voxels?.stats?.(); return v ? { state: v.state, cm: v.voxelCm } : null; });
        if (w && w.cm) { step(`walls ready after ${Math.round((Date.now() - t0) / 1000)} s ${JSON.stringify(w)}`); break; }
        if (Date.now() - t0 > 500000) throw new Error('no walls ' + JSON.stringify(w));
        await sleep(2000);
    }
    await shiftG(page);
    for (;;) {
        const st = await page.evaluate(() => { const c = window.__gsfpv?.course; return c ? { source: c.source, problem: c.problem ?? null } : null; });
        if (st && (st.source === 'generated' || st.problem)) { step(`course after ${Math.round((Date.now() - t0) / 1000)} s`); break; }
        if (Date.now() - t0 > 560000) { step('no course; the hold uses the craft pose only'); break; }
        await sleep(1000);
    }
    const spawn = await page.evaluate(() => { const s = window.__gsfpv.session.sim.s; return [s[0], s[1], s[2]]; });
    const yaw0 = await page.evaluate(() => { const s = window.__gsfpv.session.sim.s; return 2 * Math.atan2(s[8], s[6]); });
    await page.evaluate(() => {
        const ss = window.__gsfpv.session;
        const orig = ss.cameraAim;
        window.__hold = null;
        if (orig) ss.cameraAim = () => { const a = orig.call(ss); return a && window.__hold ? { ...a, yawDeg: (-window.__hold.yaw * 180) / Math.PI, pitchDeg: window.__hold.pitch } : a; };
        const tick = () => { const h = window.__hold; if (h) { const s = ss.sim.s; s[0] = h.pos[0]; s[1] = h.pos[1]; s[2] = h.pos[2]; for (let i = 3; i < 6; i++) s[i] = 0; s[6] = Math.cos(h.yaw / 2); s[7] = 0; s[8] = Math.sin(h.yaw / 2); s[9] = 0; for (let i = 10; i < 13; i++) s[i] = 0; } requestAnimationFrame(tick); };
        tick();
    });
    const frame = () => page.evaluate(() => new Promise((res) => { const d = []; let last = performance.now(); const end = last + 3000; const f = (t) => { d.push(t - last); last = t; if (t < end) requestAnimationFrame(f); else { d.sort((a, b) => a - b); res({ n: d.length, meanMs: Math.round((d.reduce((a, b) => a + b, 0) / d.length) * 10) / 10, p95Ms: Math.round(d[Math.floor(d.length * 0.95)] * 10) / 10 }); } }; requestAnimationFrame(f); }));
    const pickStats = (s) => ({ chunks: s.chunks, quads: s.quads, triangles: s.triangles, whole: s.whole, wallChunks: s.wallChunks, plannedChunks: s.plannedChunks, drawnChunks: s.drawnChunks, share: s.share, perLevel: s.perLevel, meshesPerLevel: s.meshesPerLevel, pendingUploads: s.pendingUploads, farthestM: s.farthestM, drawnFarM: s.drawnFarM, radiusM: s.radiusM, fineRadiusM: s.fineRadiusM, detail: s.detail, keeperMs: s.frameMs, voxelCm: s.voxelCm });
    const fill = async (label, ms) => {
        const s0 = Date.now(), series = [];
        let full = -1, ok = false;
        while (Date.now() - s0 < ms) {
            const s = await page.evaluate(() => ({ st: window.__gsfpv.voxels.stats(), ok: window.__gsfpv.voxels.settled() }));
            series.push([Math.round((Date.now() - s0) / 100) / 10, s.st.share ?? null, s.st.drawnFarM ?? null, s.st.chunks, s.st.fillLeftS ?? null]);
            if (!r.far.midLine && s.st.share > 0 && s.st.share < 100) r.far.midLine = await page.evaluate(() => [...document.querySelectorAll('.walls-menu *, [class*=voxel] *')].map((e) => e.textContent?.trim() ?? '').find((x) => x.includes('drawn,') && x.includes('%') && x.length < 260) ?? null);
            if (full < 0 && s.st.share === 100) full = Date.now() - s0;
            if (s.ok && Date.now() - s0 > 1500) { ok = true; break; }
            await sleep(1000);
        }
        const st = pickStats(await page.evaluate(() => window.__gsfpv.voxels.stats()));
        const settledMs = ok ? Date.now() - s0 : -1;
        // voxview2: the page's memory (Chrome's performance.memory, JS heap only; the GPU buffers are not in it)
        const memMB = await page.evaluate(() => Math.round((performance.memory?.usedJSHeapSize ?? 0) / 1048576));
        step(`${label}: share 100 at ${full} ms, settled ${settledMs} ms, heap ${memMB} MB, ${JSON.stringify(st)}`);
        return { label, shareFullMs: full, settledMs, memMB, stats: st, series };
    };
    const shot = async (name) => { await sleep(1500); const p = join(shots, `${name}.png`); await page.screenshot({ path: p }); step(`picture ${p}`); return p; };
    r.far = { spawn, yaw0, phases: [] };
    await page.evaluate(([pos, yaw]) => { window.__hold = { pos, yaw, pitch: 10 }; }, [spawn, yaw0]);
    await sleep(1500);
    r.far.frameScanOnly = await frame();
    step(`frame, the scan alone at the spawn ${JSON.stringify(r.far.frameScanOnly)}`);
    await page.evaluate(() => window.__gsfpv.voxels.setMode('only'));
    if (phases.includes('spawn')) {
        const ph = await fill('spawn (street)', 240000);
        ph.frame = await frame();
        ph.picture = await shot(`${tag}-street`);
        ph.line = await page.evaluate(() => [...document.querySelectorAll('.walls-menu, .walls-chip, [class*=walls]')].map((e) => e.textContent?.trim()).filter(Boolean).slice(0, 4));
        step(`frame ${JSON.stringify(ph.frame)} walls text ${JSON.stringify(ph.line)}`);
        r.far.phases.push(ph);
    }
    if (phases.includes('up')) {
        const upM = Number(process.env.FAR_UP_M ?? 60);
        await page.evaluate(([pos, yaw, m]) => { window.__hold = { pos: [pos[0], pos[1] + m, pos[2]], yaw, pitch: -40 }; }, [spawn, yaw0, upM]);
        const ph = await fill(`${upM} m up`, 240000);
        ph.frame = await frame();
        ph.picture = await shot(`${tag}-far`);
        step(`frame ${JSON.stringify(ph.frame)}`);
        r.far.phases.push(ph);
    }
    if (phases.includes('weak')) {
        if (await page.evaluate(() => typeof window.__gsfpv.voxels.setDetail === 'function')) {
            await page.evaluate(() => window.__gsfpv.voxels.setDetail(0.125));
            const ph = await fill('weak (detail 0.125) 60 m up', 180000);
            ph.frame = await frame();
            ph.picture = await shot(`${tag}-weak`);
            step(`frame ${JSON.stringify(ph.frame)}`);
            r.far.phases.push(ph);
        } else step('no setDetail in this build');
    }
}

try {
    if (args.includes('--panel')) await panel(); else if (args.includes('--far')) await far(); else await depth();
} catch (e) {
    r.error = String(e?.stack ?? e).slice(0, 600);
    console.log('ERROR ' + r.error);
} finally {
    r.seconds = Math.round((Date.now() - t0) / 1000);
    writeFileSync(out, JSON.stringify(r, null, 1));
    await browser.close();
}
