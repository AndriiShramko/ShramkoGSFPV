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
        r.panel[`${w}x${hgt}`] = { ...v, after };
        step(`panel ${w}x${hgt}: ${JSON.stringify({ menu: v.menu, inView: v.menuInView, close: v.close, closeInView: v.closeInView, closeOnTop: v.closeOnTop, scroll: [v.scrollH, v.clientH, v.overflowY], after })}`);
        await ctx.close();
    }
}

async function depth() {
    const { page } = await open(1280, 800, '');
    await page.keyboard.press('Shift+KeyG');
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
    // the hold: the craft kept at a pose every frame (yaw about +y), pitch through the camera aim
    await page.evaluate(() => {
        const ss = window.__gsfpv.session;
        const orig = ss.cameraAim;
        window.__hold = null;
        if (orig) ss.cameraAim = () => { const a = orig.call(ss); return a && window.__hold ? { ...a, pitchDeg: window.__hold.pitch } : a; };
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
            await sleep(400);
            const sc = await page.evaluate((g) => { const cam = window.__gsfpv.session.renderer.camera; const V = cam.getPosition().constructor; const s = cam.camera.worldToScreen(new V(g[0], g[1], g[2]), new V()); return [s.x, s.y, s.z]; }, samples.pos);
            const off = sc[2] > 0 ? Math.abs(sc[0] - 640) : 1e9;
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
    r.guide = await page.evaluate(() => { const gd = window.__gsfpv.course.guide?.(); const el = document.querySelector('[data-testid=course-guide]'); return { hook: gd, text: el?.textContent ?? null, visible: !!el && el.offsetParent !== null }; });
    step(`guide chip ${JSON.stringify(r.guide)}`);
}

try {
    if (args.includes('--panel')) await panel(); else await depth();
} catch (e) {
    r.error = String(e?.stack ?? e).slice(0, 600);
    console.log('ERROR ' + r.error);
} finally {
    r.seconds = Math.round((Date.now() - t0) / 1000);
    writeFileSync(out, JSON.stringify(r, null, 1));
    await browser.close();
}
