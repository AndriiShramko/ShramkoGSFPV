// Lane voxview2 (review of lane voxview): with the voxels alone on, does every render item of the World layer have its
// depth-only copy in the frame it is drawn (V6: a gate moved in the edit mode, the next gate's number plate and the
// chevrons when the next gate changes), and does Esc close only the voxel panel when it is open (V7: in a flight, in a
// pause, in the edit mode)? Pictures <tag>-spawn.png (the pilot's eye after Shift+G), <tag>-start.png (that eye turned to
// the START gate) and <tag>-edit.png (the edit mode).
// Usage: node voxview2-probe.mjs <base with /en> <scene> <out.json> <shots dir> <tag>. Takes no GPU lock itself.
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pickBrowser } from '../src/chrome.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [base, id, out, shots, tag] = process.argv.slice(2);
if (!base || !id || !out || !shots || !tag) { console.error('usage: voxview2-probe.mjs <base with /en> <scene> <out.json> <shots dir> <tag>'); process.exit(2); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r = { base, id, tag, steps: [] };
const step = (s) => { r.steps.push(s); console.log(typeof s === 'string' ? s : JSON.stringify(s)); };
const pick = pickBrowser({ expected: chromium.executablePath() });
const browser = await chromium.launch({ ...pick.launch, headless: true });
const t0 = Date.now();

async function until(page, fn, ok, ms) {
    const s = Date.now();
    let v;
    while (Date.now() - s < ms) { v = await page.evaluate(fn); if (ok(v)) return { ok: true, v, ms: Date.now() - s }; await sleep(500); }
    return { ok: false, v, ms: Date.now() - s };
}

// the counter: each frame, the visible render items of the World layer that have no visible depth copy (same mesh, same node)
const installMiss = () => {
    const app = window.__gsfpv.session.renderer.app;
    window.__miss = { frames: 0, missFrames: 0, maxMiss: 0, items: 0 };
    app.on('frameend', () => {
        const m = window.__miss;
        const dl = app.scene.layers.getLayerByName('GSFPV Voxel depth');
        const world = app.scene.layers.getLayerByName('World');
        if (!dl || !dl.enabled || !world) return;
        const have = new Map();
        for (const c of dl.meshInstances) if (c.visible) { let s = have.get(c.node); if (!s) have.set(c.node, (s = new Set())); s.add(c.mesh); }
        let miss = 0, items = 0;
        for (const rc of app.root.findComponents('render')) {
            if (!rc.enabled || !rc.entity.enabled || !rc.layers.includes(world.id)) continue;
            for (const mi of rc.meshInstances) { if (!mi.visible) continue; items++; if (!have.get(mi.node)?.has(mi.mesh)) miss++; }
        }
        m.frames++; m.items = items;
        if (miss) { m.missFrames++; m.maxMiss = Math.max(m.maxMiss, miss); }
    });
};
const missNow = (page) => page.evaluate(() => ({ ...window.__miss }));
const missReset = (page) => page.evaluate(() => { Object.assign(window.__miss, { frames: 0, missFrames: 0, maxMiss: 0 }); });
const state = (page) => page.evaluate(() => ({
    panelOpen: !!document.querySelector('[data-testid=walls-more]')?.open,
    editOpen: !!window.__gsfpv?.course?.editor?.open,
    panels: [...document.querySelectorAll('.panel')].filter((e) => e.offsetParent !== null).map((e) => e.className)
}));
const openPanel = (page) => page.evaluate(() => { const d = document.querySelector('[data-testid=walls-more]'); if (d) d.open = true; return !!d?.open; });
async function escCase(page, label) {
    const before = await state(page);
    await openPanel(page);
    await sleep(400);
    const opened = await state(page);
    await page.keyboard.press('Escape');
    await sleep(600);
    const after = await state(page);
    const ok = opened.panelOpen && !after.panelOpen && after.editOpen === before.editOpen && after.panels.length === before.panels.length;
    step({ esc: label, ok, before, opened, after });
    return { label, ok, before, opened, after };
}

try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => step('pageerror ' + String(e.message).slice(0, 200)));
    await page.goto(`${base}/fly/?scene=${id}&nowarn=1`);
    await page.waitForFunction(() => ['ready', 'error'].includes(window.__gsfpv?.status), null, { timeout: 240000 });
    try {
        await page.waitForSelector('.screen.radio [data-action="radio-keyboard"]', { timeout: 15000 });
        await page.focus('.screen.radio [data-action="radio-keyboard"]');
        await page.keyboard.press('Enter');
    } catch { step('no controls screen'); }
    const w = await until(page, () => window.__gsfpv?.voxels?.stats?.()?.voxelCm ?? 0, (v) => v > 0, 500000);
    step(`walls ${w.ok} after ${Math.round((Date.now() - t0) / 1000)} s`);
    await page.keyboard.press('Shift+KeyG');
    const c = await until(page, () => { const k = window.__gsfpv?.course; return k ? { gates: k.gates, on: k.on, problem: k.problem ?? null } : null; }, (v) => (v?.gates ?? 0) > 0 && !!v?.on, 480000);
    step({ course: c.ok, ms: c.ms, v: c.v });
    await page.evaluate(installMiss);
    await page.evaluate(() => window.__gsfpv.voxels.setMode('only'));
    const s = await until(page, () => window.__gsfpv.voxels.settled(), (v) => v, 120000);
    await sleep(1500);
    r.start = { settledMs: s.ms, miss: await missNow(page), stats: await page.evaluate(() => { const v = window.__gsfpv.voxels.stats(); return { depthItems: v.depthItems, chunks: v.chunks, share: v.share }; }) };
    await page.screenshot({ path: join(shots, `${tag}-spawn.png`) });
    step({ start: r.start });
    // the pilot's eye at the spawn turned to the START gate (on Wroclaw it is 19 m to the left of the spawn's heading):
    // the craft held at the spawn with a yaw about +y, the camera aim follows the held yaw (as voxview-depth-probe)
    await page.evaluate(() => {
        const ss = window.__gsfpv.session;
        const orig = ss.cameraAim;
        window.__hold = null;
        if (orig) ss.cameraAim = () => { const a = orig.call(ss); return a && window.__hold ? { ...a, yawDeg: (-window.__hold.yaw * 180) / Math.PI, pitchDeg: window.__hold.pitch } : a; };
        const tick = () => { const h = window.__hold; if (h) { const s = ss.sim.s; s[0] = h.pos[0]; s[1] = h.pos[1]; s[2] = h.pos[2]; for (let i = 3; i < 6; i++) s[i] = 0; s[6] = Math.cos(h.yaw / 2); s[7] = 0; s[8] = Math.sin(h.yaw / 2); s[9] = 0; for (let i = 10; i < 13; i++) s[i] = 0; } requestAnimationFrame(tick); };
        tick();
    });
    const face = await page.evaluate(() => { const g = window.__gsfpv, s = g.session.sim.s; return { e: [s[0], s[1] + 0.3, s[2]], gp: g.course.gatePoses()[Math.max(0, g.course.next)].pos }; });
    const dx = face.gp[0] - face.e[0], dz = face.gp[2] - face.e[2];
    let best = null;
    for (const yaw of [Math.atan2(-dx, -dz), Math.atan2(dx, dz), Math.atan2(-dx, dz), Math.atan2(dx, -dz)]) {
        await page.evaluate(({ e, yaw }) => { window.__hold = { pos: e, yaw, pitch: 0 }; }, { e: face.e, yaw });
        await sleep(1200);
        const gd = await page.evaluate(() => window.__gsfpv.course.guide?.() ?? null);
        const off = gd && Number.isFinite(gd.bearingDeg) ? Math.abs(gd.bearingDeg) : 1e9;
        if (!best || off < best.off) best = { yaw, off: Math.round(off) };
    }
    await page.evaluate(({ e, yaw }) => { window.__hold = { pos: e, yaw, pitch: -5 }; }, { e: face.e, yaw: best.yaw });
    await sleep(1500);
    r.startFacing = { eye: face.e, gate: face.gp, bearingDeg: best.off, guide: await page.evaluate(() => window.__gsfpv.course.guide?.() ?? null) };
    await page.screenshot({ path: join(shots, `${tag}-start.png`) });
    step({ startFacing: r.startFacing });
    await page.evaluate(() => { window.__hold = null; });
    r.esc = [];
    r.esc.push(await escCase(page, 'flight'));
    // the pause: Esc without the panel pauses; then the panel and Esc; then Esc closes the pause
    await page.keyboard.press('Escape');
    await sleep(700);
    const paused = await state(page);
    step({ pausedBy: 'Escape', paused });
    r.esc.push(await escCase(page, 'pause'));
    await page.keyboard.press('Escape');
    await sleep(700);
    step({ afterPauseEsc: await state(page) });
    // the edit mode
    await page.keyboard.press('Shift+KeyB');
    const e = await until(page, () => window.__gsfpv?.course?.editor ?? null, (v) => !!v?.open, 30000);
    await sleep(1500);
    step({ edit: e.ok, selected: e.v?.selected });
    r.moves = [];
    for (const k of ['ArrowRight', 'ArrowRight', 'ArrowUp', 'ArrowLeft']) {
        await missReset(page);
        const a = await page.evaluate(() => window.__gsfpvEditView?.()?.stand?.pos ?? null);
        await page.keyboard.press(k);
        await sleep(800);
        const b = await page.evaluate(() => window.__gsfpvEditView?.()?.stand?.pos ?? null);
        const m = await missNow(page);
        r.moves.push({ key: k, from: a, to: b, ...m });
        step({ move: k, from: a, to: b, ...m });
    }
    // Tab: the next gate selected (the edit view repaints the gates)
    await missReset(page);
    await page.keyboard.press('Tab');
    await sleep(1500);
    r.tab = await missNow(page);
    step({ tab: r.tab });
    await page.screenshot({ path: join(shots, `${tag}-edit.png`) });
    r.esc.push(await escCase(page, 'edit'));
    r.final = await state(page);
} catch (e) {
    r.error = String(e?.stack ?? e).slice(0, 600);
    console.log('ERROR ' + r.error);
} finally {
    r.seconds = Math.round((Date.now() - t0) / 1000);
    writeFileSync(out, JSON.stringify(r, null, 1));
    await browser.close();
}
