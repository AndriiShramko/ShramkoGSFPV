// Lane vox4 (voxux4 V-3): the acceptance of the voxel view, the pilot's own path with the MOUSE at 1536x730, device
// scale 1.25. Wroclaw 70b50d42: a click into the scene, a click on the controls screen's keyboard, the walls chip,
// "Voxels only". Steps (each PASS or FAIL in one JSON):
//   1 frozen   the scan's drawing is off in voxels only (plan why 'hidden', the accumulating renderer inactive) and with
//              the two voxel layers off for one frame the canvas is the background colour (+-3) almost everywhere
//              (the old build: the last scan frame stays there, frozen);
//   2 moved    the camera held 3 m away: the same picture (still the background, no frozen scan);
//   3 lublin   Lublin 2f1ddf5f at the spawn after 20 s: every occupied near chunk is drawn, VoxelStats.nearWalls says
//              'thin', the panel's status line says so, and one click on "Over the scan" brings the scan back;
//   4 shading  solid style, looking down: the mean luma of top faces and of side faces (told apart by a ray into the
//              walls at each sampled pixel) differ by >= 25 %; far voxels (>= 80 % of the fog's reach) lie within
//              30 % of the background's luma, near ones (< 30 m) do not;
//   5 cost     the mean frame time in voxels only with the fog on and with it off differ by <= 1 ms (AO costs no
//              frame time: it is baked into the vertex colours by the worker);
//   6 panel    the walls panel closes with its own cross of >= 44 px at 1536x730 and at 844x390.
// Usage: node vox4-probe.mjs <base with /en> <out.json> [shots dir] [tag]. Takes no GPU lock itself; exits 1 on a FAIL.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { inflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { pickBrowser } from '../src/chrome.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [base, out, shots = '', tag = 'vox4'] = process.argv.slice(2);
if (!base || !out) { console.error('usage: vox4-probe.mjs <base with /en> <out.json> [shots dir] [tag]'); process.exit(2); }
const here = dirname(fileURLToPath(import.meta.url));
const en = JSON.parse(readFileSync(join(here, '../../../packages/i18n/locales/fly/voxels/en.json'), 'utf8'));
const WROCLAW = '70b50d42', LUBLIN = '2f1ddf5f';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r = { base, tag, steps: {}, errors: [] };
const verdict = (name, pass, data) => { r.steps[name] = { pass: !!pass, ...data }; console.log(`${name} ${pass ? 'PASS' : 'FAIL'} ${JSON.stringify(data).slice(0, 400)}`); };
const pick = pickBrowser({ expected: chromium.executablePath() });
const browser = await chromium.launch({ ...pick.launch, headless: true });
const t0 = Date.now();

async function until(page, fn, ok, ms, arg) {
    const s = Date.now();
    let v;
    while (Date.now() - s < ms) { v = await page.evaluate(fn, arg); if (ok(v)) return { ok: true, v, ms: Date.now() - s }; await sleep(500); }
    return { ok: false, v, ms: Date.now() - s };
}
/** a mouse click at the middle of the first element the selector finds (as a person clicks) */
async function clickEl(page, sel) {
    const b = await page.locator(sel).first().boundingBox();
    if (!b) throw new Error(`no box for ${sel}`);
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
}
async function openScene(page, id) {
    await page.goto(`${base}/fly/?scene=${id}&nowarn=1${process.env.QUERY ? '&' + process.env.QUERY : ''}`);
    await page.waitForFunction(() => ['ready', 'error'].includes(window.__gsfpv?.status), null, { timeout: 240000 });
    try {
        await page.waitForSelector('.screen.radio [data-action="radio-keyboard"]', { timeout: 15000 });
        await clickEl(page, '.screen.radio [data-action="radio-keyboard"]');
    } catch { /* no controls screen: the pilot chose before */ }
    await sleep(500);
    return until(page, () => window.__gsfpv?.voxels?.stats?.()?.voxelCm ?? 0, (v) => v > 0, 400000);
}
/** a person's Esc while the scene holds the mouse: the browser itself lets the pointer lock go (the page gets no key) */
async function freeMouse(page) {
    const was = await page.evaluate(() => { const l = !!document.pointerLockElement; if (l) document.exitPointerLock(); return l; });
    if (was) await sleep(600);
    return was;
}
/** the walls chip, then "Voxels only" (or another mode), with the mouse; the panel is left open */
async function pickMode(page, mode) {
    await freeMouse(page);
    const open = await page.evaluate(() => !!document.querySelector('[data-testid=walls-more]')?.open);
    if (!open) { await clickEl(page, '[data-testid=walls-summary]'); await sleep(500); }
    await clickEl(page, `[data-action=voxels-mode-${mode}]`);
    await sleep(500);
    const d = await page.evaluate(() => ({ open: !!document.querySelector('[data-testid=walls-more]')?.open, mode: window.__gsfpv.voxels.stats().mode, lock: !!document.pointerLockElement }));
    (r.picks ??= []).push({ want: mode, opened: !open, ...d });
    console.log('pick ' + JSON.stringify(r.picks.at(-1)));
}
const settled = (page) => until(page, () => { const v = window.__gsfpv.voxels; return typeof v.settled === 'function' ? v.settled() : v.settled; }, (v) => !!v, 120000);
/** the craft (and so the camera) held at a pose: yaw about +y (rad), the camera pitch (deg) */
const installHold = (page) => page.evaluate(() => {
    const ss = window.__gsfpv.session;
    const orig = ss.cameraAim;
    window.__hold = null;
    if (orig) ss.cameraAim = () => { const a = orig.call(ss); return a && window.__hold ? { ...a, yawDeg: (-window.__hold.yaw * 180) / Math.PI, pitchDeg: window.__hold.pitch } : a; };
    const tick = () => { const h = window.__hold; if (h) { const s = ss.sim.s; s[0] = h.pos[0]; s[1] = h.pos[1]; s[2] = h.pos[2]; for (let i = 3; i < 6; i++) s[i] = 0; s[6] = Math.cos(h.yaw / 2); s[7] = 0; s[8] = Math.sin(h.yaw / 2); s[9] = 0; for (let i = 10; i < 13; i++) s[i] = 0; } requestAnimationFrame(tick); };
    tick();
    const s = ss.sim.s;
    return [s[0], s[1], s[2]];
});
const hold = (page, pos, yaw, pitch) => page.evaluate((h) => { window.__hold = h; }, { pos, yaw, pitch });
const HIDE_DOM = 'body *{visibility:hidden!important} canvas{visibility:visible!important}';
/** the canvas only (the page's DOM hidden), decoded in the page: [w, h, Uint8 RGBA as a plain array of sampled pixels] */
async function canvasShot(page, file) {
    const tagEl = await page.addStyleTag({ content: HIDE_DOM });
    await sleep(250);
    const png = await page.screenshot(file ? { path: file } : {});
    await tagEl.evaluate((e) => e.remove());
    return png.toString('base64');
}
/** a screenshot PNG (8-bit RGB or RGBA, not interlaced: what Chrome writes) decoded in Node (the page's CSP keeps data: out) */
function decodePng(buf) {
    let p = 8, w = 0, h = 0, ch = 4;
    const idat = [];
    while (p < buf.length) {
        const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8), d = buf.subarray(p + 8, p + 8 + len);
        if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); ch = d[9] === 6 ? 4 : 3; if (d[8] !== 8 || d[12] !== 0) throw new Error('png: not 8-bit / interlaced'); }
        if (type === 'IDAT') idat.push(d);
        p += 12 + len;
    }
    const raw = inflateSync(Buffer.concat(idat)), stride = w * ch, out = Buffer.alloc(h * stride);
    for (let y = 0; y < h; y++) {
        const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, o = y * stride;
        for (let x = 0; x < stride; x++) {
            const a = x >= ch ? out[o + x - ch] : 0, b = y ? out[o - stride + x] : 0, c = x >= ch && y ? out[o - stride + x - ch] : 0;
            const v = raw[src + x];
            let q = 0;
            if (f === 1) q = a; else if (f === 2) q = b; else if (f === 3) q = (a + b) >> 1;
            else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); q = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
            out[o + x] = (v + q) & 255;
        }
    }
    return { w, h, ch, data: out };
}
/** pixels of a screenshot (base64 PNG): for each [x, y] in CSS px of the 1536 px wide view, [r, g, b] */
const pixels = async (_page, b64, pts) => {
    const img = decodePng(Buffer.from(b64, 'base64')), k = img.w / 1536;
    return pts.map(([x, y]) => { const i = (Math.floor(y * k) * img.w + Math.floor(x * k)) * img.ch; return [img.data[i], img.data[i + 1], img.data[i + 2]]; });
};
const grid = (nx, ny, top = 0, bottom = 730) => { const p = []; for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) p.push([Math.round(((i + 0.5) / nx) * 1536), Math.round(top + ((j + 0.5) / ny) * (bottom - top))]); return p; };
const bgColour = (page) => page.evaluate(() => { const c = window.__gsfpv.session.renderer.camera.camera.clearColor; return [c.r, c.g, c.b].map((v) => Math.round(v * 255)); });
const near3 = (a, b) => Math.abs(a[0] - b[0]) <= 3 && Math.abs(a[1] - b[1]) <= 3 && Math.abs(a[2] - b[2]) <= 3;
const luma = (p) => 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
const voxelLayers = (page, on) => page.evaluate((on) => {
    const L = window.__gsfpv.session.renderer.app.scene.layers;
    for (const n of ['GSFPV Voxels', 'GSFPV Voxel depth']) { const l = L.getLayerByName(n); if (l) l.enabled = on; }
}, on);
const drawState = (page) => page.evaluate(() => {
    const rd = window.__gsfpv.session.renderer;
    return { plan: rd.plan, accumActive: !!rd.accumulating?.active, splatEnabled: rd.splat ? !!rd.splat.enabled : null };
});
/** step 1 / 2: the share of background pixels with the voxel layers off for a moment */
async function backgroundShare(page, bg, file) {
    await voxelLayers(page, false);
    await sleep(600);
    const b64 = await canvasShot(page, file);
    await voxelLayers(page, true);
    const px = await pixels(page, b64, grid(32, 16));
    const share = px.filter((p) => near3(p, bg)).length / px.length;
    return { share: Math.round(share * 1000) / 1000, sample: px.filter((p) => !near3(p, bg)).slice(0, 4), b64 };
}
/** rays into the walls at each pixel: the face it hits (top, side, other) and the distance */
const faces = (page, pts) => page.evaluate((pts) => {
    const g = window.__gsfpv, cam = g.session.renderer.camera, col = g.session.collision;
    const o = cam.getPosition(), res = col.voxelResolution, f = col.flipXY ? -1 : 1;
    const frac = (v, min) => { const q = (v - min) / res; return Math.abs(q - Math.round(q)); };
    return pts.map(([x, y]) => {
        const p = cam.camera.screenToWorld(x, y, 1);
        let dx = p.x - o.x, dy = p.y - o.y, dz = p.z - o.z;
        const n = Math.hypot(dx, dy, dz); dx /= n; dy /= n; dz /= n;
        const h = col.queryRay(o.x, o.y, o.z, dx, dy, dz, 1000);
        if (!h) return { kind: 'none', dist: null };
        const fx = frac(f * h.x, col.gridMinX), fy = frac(f * h.y, col.gridMinY), fz = frac(h.z, col.gridMinZ), e = 0.02;
        const kind = fy < e && fx > 0.08 && fz > 0.08 ? (dy < 0 ? 'top' : 'bottom') : (fx < e || fz < e) && fy > 0.08 ? 'side' : 'other';
        const fw = cam.forward;
        return { kind, dist: Math.hypot(h.x - o.x, h.y - o.y, h.z - o.z), depth: (h.x - o.x) * fw.x + (h.y - o.y) * fw.y + (h.z - o.z) * fw.z };
    });
}, pts);
async function frameMs(page, ms) {
    return page.evaluate((ms) => new Promise((res) => {
        const t = []; const s = performance.now();
        const f = (now) => { t.push(now); if (now - s < ms) requestAnimationFrame(f); else res(t.length > 1 ? (t[t.length - 1] - t[0]) / (t.length - 1) : null); };
        requestAnimationFrame(f);
    }), ms);
}

try {
    const ctx = await browser.newContext({ viewport: { width: 1536, height: 730 }, deviceScaleFactor: 1.25 });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => r.errors.push(String(e.message).slice(0, 200)));
    // ---- Wroclaw: steps 1, 2, 4, 5, 6 (1536x730)
    const w = await openScene(page, WROCLAW);
    r.wroclawWalls = { ok: w.ok, s: Math.round((Date.now() - t0) / 1000) };
    // the walls chip and "Voxels only" before the flight: once the scene holds the mouse, a person's Esc lets it go and
    // opens the pause menu, which is modal and lies over the walls chip at 1536x730 (For the lead in docs/wip/vox4.md)
    await pickMode(page, 'only');
    // then the pointer lock, by a click into the scene (the pilot looks around in voxels only)
    await page.mouse.click(1100, 300);
    await sleep(500);
    r.sceneClick = await page.evaluate(() => ({ lock: !!document.pointerLockElement, mode: window.__gsfpv.voxels.stats().mode, panelOpen: !!document.querySelector('[data-testid=walls-more]')?.open }));
    const st = await settled(page);
    await sleep(1500);
    const spawn = await installHold(page);
    const yaw0 = await page.evaluate(() => { const s = window.__gsfpv.session.sim.s; return 2 * Math.atan2(s[8], s[6]); });
    await hold(page, spawn, yaw0, -10);
    await sleep(1500);
    if (shots) await page.screenshot({ path: join(shots, `${tag}-wroclaw-only.png`) });
    const bg = await bgColour(page);
    const ds = await drawState(page);
    const b1 = await backgroundShare(page, bg, shots ? join(shots, `${tag}-wroclaw-nolayers.png`) : '');
    verdict('1-frozen', ds.plan?.why === 'hidden' && !ds.accumActive && b1.share >= 0.9, { settled: st.ok, bg, draw: ds, bgShare: b1.share, notBg: b1.sample });
    const moved = [spawn[0] + 3, spawn[1], spawn[2]];
    await hold(page, moved, yaw0, -10);
    await sleep(1500);
    const b2 = await backgroundShare(page, bg, '');
    verdict('2-moved', b2.share >= 0.9 && b1.share >= 0.9, { moved3m: true, bgShare: b2.share, notBg: b2.sample });
    // step 4: the solid style, looking down from 2 m over the spawn
    await page.evaluate(() => window.__gsfpv.voxels.setStyle('solid'));
    await hold(page, [spawn[0], spawn[1] + 2, spawn[2]], yaw0, -35);
    await settled(page);
    await sleep(2500);
    const pts = grid(48, 24, 40, 700);
    const shot = await canvasShot(page, '');
    const [px, fc] = [await pixels(page, shot, pts), await faces(page, pts)];
    const fog = await page.evaluate(() => { const f = window.__gsfpv.session.renderer.app.scene.fog; return f ? { type: f.type, start: f.start, end: f.end } : null; });
    const fogEnd = fog && fog.type !== 'none' ? fog.end : 1000;
    const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
    const sel = (p, f, fn) => p.filter((_, i) => fn(f[i])).map(luma);
    const top = mean(sel(px, fc, (h) => h.kind === 'top' && h.dist < 30)), side = mean(sel(px, fc, (h) => h.kind === 'side' && h.dist < 30));
    const nearAll = sel(px, fc, (h) => h.kind !== 'none' && h.dist < 30);
    // the fog, measured as what it changes: the same pixels with the scene's fog on and for a moment off. Voxels within
    // 30 m keep their luma; voxels from 100 m of view depth (the engine's fog distance, not the ray's) go darker toward
    // the background. Wroclaw's spawn sees no voxel past 80 % of the reach (the design's first idea), so the far views
    // are level ones to the four sides from 40 m up, 8 deg down; the design's rule is reported where it has samples.
    const fogOffShot = async () => {
        await page.evaluate(() => { window.__gsfpv.session.renderer.app.scene.fog.type = 'none'; });
        await sleep(400);
        const b = await canvasShot(page, '');
        await page.evaluate((t) => { window.__gsfpv.session.renderer.app.scene.fog.type = t; }, fog?.type ?? 'none');
        await sleep(300);
        return b;
    };
    const pairs = []; // [depth, luma fog on, luma fog off]
    if (fog && fog.type !== 'none') {
        const npx = await pixels(page, await fogOffShot(), pts);
        fc.forEach((h, i) => { if (h.kind !== 'none') pairs.push([h.depth, luma(px[i]), luma(npx[i])]); });
    }
    const far = [];
    for (let k = 0; k < 4; k++) {
        await hold(page, [spawn[0], spawn[1] + 40, spawn[2]], yaw0 + (k * Math.PI) / 2, -8);
        await settled(page);
        await sleep(1800);
        const lp = grid(48, 12, 200, 420), ls = await canvasShot(page, '');
        const [lpx, lfc] = [await pixels(page, ls, lp), await faces(page, lp)];
        const opx = fog && fog.type !== 'none' ? await pixels(page, await fogOffShot(), lp) : lpx;
        lfc.forEach((h, i) => { if (h.kind !== 'none') pairs.push([h.depth, luma(lpx[i]), luma(opx[i])]); });
        far.push(...sel(lpx, lfc, (h) => h.kind !== 'none' && h.depth >= 0.8 * fogEnd));
    }
    const edges = [0, 30, 60, 100, 150, 250, 1000];
    const bins = edges.slice(0, -1).map((a, i) => { const v = pairs.filter(([d]) => d >= a && d < edges[i + 1]); return { m: `${a}-${edges[i + 1]}`, n: v.length, on: v.length ? Math.round(mean(v.map((p) => p[1]))) : null, off: v.length ? Math.round(mean(v.map((p) => p[2]))) : null }; });
    const bgL = luma(bg);
    const ratio = (v) => { const off = mean(v.map((p) => Math.abs(p[2] - bgL))); return v.length && off > 1 ? mean(v.map((p) => Math.abs(p[1] - bgL))) / off : null; };
    const nearRatio = ratio(pairs.filter(([d]) => d < 30)), farRatio = ratio(pairs.filter(([d]) => d >= 100));
    const farL = mean(far);
    const farOk = nearRatio !== null && farRatio !== null && nearRatio >= 0.97 && farRatio <= 0.85;
    const designFar = far.length ? far.filter((l) => Math.abs(l - bgL) <= 0.3 * 255).length / far.length : null;
    const nearL = mean(nearAll);
    const nearOff = nearAll.length ? nearAll.filter((l) => Math.abs(l - bgL) > 0.3 * 255).length / nearAll.length : null;
    const diff = top !== null && side !== null ? Math.abs(top - side) / Math.max(top, side, 1) : null;
    const counts = fc.reduce((m, h) => ((m[h.kind] = (m[h.kind] ?? 0) + 1), m), {});
    verdict('4-shading', diff !== null && diff >= 0.25 && farOk && nearOff >= 0.8, { topLuma: top && Math.round(top), sideLuma: side && Math.round(side), diff: diff && Math.round(diff * 100) / 100, counts, fog, far: far.length, farLuma: farL && Math.round(farL), nearLuma: nearL && Math.round(nearL), fogNearRatio: nearRatio && Math.round(nearRatio * 100) / 100, fogFarRatio: farRatio && Math.round(farRatio * 100) / 100, farToward: farOk, designFarWithin30: designFar, nearAwayFromBg: nearOff, bgLuma: Math.round(bgL), bins });
    // step 5: frame time with the fog on and off (the same view, the same voxels), alternated three times, medians
    await hold(page, [spawn[0], spawn[1] + 2, spawn[2]], yaw0, -10);
    await sleep(1500);
    const on = [], off = [];
    for (let k = 0; k < 3; k++) {
        on.push(await frameMs(page, 2000));
        await page.evaluate(() => { window.__gsfpv.session.renderer.app.scene.fog.type = 'none'; });
        off.push(await frameMs(page, 2000));
        await page.evaluate((t) => { window.__gsfpv.session.renderer.app.scene.fog.type = t; }, fog?.type ?? 'none');
    }
    const med = (a) => [...a].sort((x, y) => x - y)[1];
    const fogOn = med(on), fogOff = med(off);
    verdict('5-cost', fog?.type === 'linear' && fogOn !== null && fogOff !== null && fogOn - fogOff <= 1, { fogType: fog?.type ?? null, msFogOn: Math.round(fogOn * 100) / 100, msFogOff: Math.round(fogOff * 100) / 100, on: on.map((v) => Math.round(v * 10) / 10), off: off.map((v) => Math.round(v * 10) / 10), uncapped: process.env.BENCH_UNCAPPED === '1' });
    await page.evaluate(() => { window.__hold = null; });
    // ---- Lublin: step 3 (the pilot keeps the voxels-only choice: the mode is a stored setting)
    const lw = await openScene(page, LUBLIN);
    const mode0 = await page.evaluate(() => window.__gsfpv.voxels.stats().mode);
    if (mode0 !== 'only') await pickMode(page, 'only');
    else { const o = await page.evaluate(() => !!document.querySelector('[data-testid=walls-more]')?.open); if (!o) { await clickEl(page, '[data-testid=walls-summary]'); await sleep(500); } }
    await sleep(20000);
    const ls = await page.evaluate(() => {
        const v = window.__gsfpv.voxels.stats();
        return { mode: v.mode, nearWalls: v.nearWalls ?? null, near: v.near ?? null, status: document.querySelector('[data-testid=voxels-status]')?.textContent ?? '' };
    });
    if (shots) await page.screenshot({ path: join(shots, `${tag}-lublin-only.png`) });
    const occ = (ls.near ?? []).filter((c) => c.occupied);
    const drawn = occ.every((c) => c.loaded !== null && c.loaded !== undefined);
    const says = ls.status.includes(en['voxels.nearThin'].slice(0, 40));
    await pickMode(page, 'overlay');
    await sleep(2500);
    const back = await drawState(page);
    // int4: since tails4 (car 1) Lublin's start stands 1.5 m over the scanned ground, where its walls are drawn (cover 0.52 on
    // the release build of car 2), no longer thin: the status must say what is true near the drone either way (thin: it says
    // so; drawn: it does not); the thin case itself is vox4's unit test (tools/bench/test/vox4-near.test.ts)
    const truthful = ls.nearWalls?.walls === 'thin' ? says : ls.nearWalls?.walls === 'drawn' && !says;
    verdict('3-lublin', lw.ok && ls.mode === 'only' && truthful && drawn && back.plan?.why !== 'hidden' && back.splatEnabled !== false, { walls: lw.ok, mode: ls.mode, nearWalls: ls.nearWalls, nearOccupied: occ.length, nearDrawn: drawn, statusSaysThin: says, status: ls.status.slice(0, 220), afterOverlay: back });
    // ---- step 6: the panel's cross at 1536x730 (this page) and at 844x390
    const cross = async (pg) => {
        await freeMouse(pg);
        const o = await pg.evaluate(() => !!document.querySelector('[data-testid=walls-more]')?.open);
        if (!o) { await clickEl(pg, '[data-testid=walls-summary]'); await sleep(500); }
        const v = await pg.evaluate(() => {
            const c = document.querySelector('[data-action=voxpanel-close]');
            if (!c || c.getClientRects().length === 0) return null;
            const b = c.getBoundingClientRect(), hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
            return { w: Math.round(b.width), h: Math.round(b.height), inView: b.left >= 0 && b.top >= 0 && b.right <= innerWidth && b.bottom <= innerHeight, onTop: !!hit && (hit === c || c.contains(hit)) };
        });
        if (v) { await clickEl(pg, '[data-action=voxpanel-close]'); await sleep(400); }
        const closed = await pg.evaluate(() => !document.querySelector('[data-testid=walls-more]')?.open);
        return { ...v, closed, ok: !!v && v.w >= 44 && v.h >= 44 && v.inView && v.onTop && closed };
    };
    const big = await cross(page);
    const ctx2 = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 1 });
    const p2 = await ctx2.newPage();
    await p2.goto(`${base}/fly/?scene=${WROCLAW}&nowarn=1&render=off&input=touch`);
    await p2.waitForFunction(() => ['ready', 'error'].includes(window.__gsfpv?.status), null, { timeout: 240000 });
    await p2.waitForSelector('[data-testid=walls-summary]', { timeout: 120000 });
    await sleep(800);
    const small = await cross(p2);
    await ctx2.close();
    verdict('6-panel', big.ok && small.ok, { '1536x730': big, '844x390': small });
} catch (e) {
    r.errors.push(String(e?.stack ?? e).slice(0, 600));
    console.log('ERROR ' + String(e?.message ?? e).slice(0, 300));
} finally {
    r.seconds = Math.round((Date.now() - t0) / 1000);
    await browser.close();
}
const names = ['1-frozen', '2-moved', '3-lublin', '4-shading', '5-cost', '6-panel'];
r.pass = names.every((n) => r.steps[n]?.pass);
writeFileSync(out, JSON.stringify(r, null, 1));
console.log(JSON.stringify({ pass: r.pass, steps: Object.fromEntries(names.map((n) => [n, r.steps[n]?.pass ?? 'not run'])), errors: r.errors.slice(0, 3), seconds: r.seconds }));
process.exit(r.pass ? 0 : 1);
