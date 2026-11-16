// Lane loadq, stage L1-measure: does a streamed scan load to the detail the pilot set, what lowers it, and what does the
// page tell him (docs/wip/loadq.md). One page load of a local release, nothing pressed; once a second it records:
//   - the splats drawn, the budget in force on the engine, the pilot's setting and who decided the top (hook.drawing.from),
//     the governor's step and its budget, the Quality cap, the view rule's state (hook.lod().view);
//   - the level of detail over the picture (each node in the frame weighted by its solid angle, as lod-view-probe.mjs);
//   - the scan's files: asked, loaded, failed (network), the engine loader's queue, in flight, given up, pending; the bytes;
//   - the frame time (rAF intervals of that second), the JS heap and the engine's GPU memory count;
//   - every 5 s the text of the page's own notes (#ui), what a pilot reads.
// Pictures for lod-view-score.mjs go to .cache/lod-view/<label>-<name>.png (the page's notes hidden for them).
//   node tools/bench/scripts/loadq-probe.mjs http://localhost:5820/en <label> [query]
// env: SCENE (70b50d42), SECS (120), VW, VH (1920 x 1080), CLASS (desktop-strong), GOV (1: the governor on, as a pilot
// has it; 0 off), PILOT ('' = untouched; '16' = the Splat budget setting written at load, as the stored setting),
// PILOT_AT (s after the reveal: the setting is written live then, as the owner did in the settings), DELAY (ms of busy CPU
// per frame from the reveal: hook.setFrameDelay, a slower device), DROP (every Nth distinct scan file fails) and
// DROPTRIES (its first k requests fail: 3 = the engine gives it up; 1 = one failure), STALL (every Nth distinct scan file
// never answers), UP / PITCH (hold the camera that far above the start place, pitch in degrees; unset = the start place
// held as it is), SHOTS (seconds after the reveal for pictures, comma separated; the last sample is always taken as
// `end`), ALIAS (names under which the `end` picture is also written, for a reference run), STILL (G6 measurement switch,
// probe side only: from STILL s after the reveal the budget is raised x1.5 a second while the last second's median frame
// is under STILLMS (66) ms, up to STILLMAX (16) M; pictures rest5, rest10, rest20; then the base budget is put back and
// pictures move0 and move1 taken), UIAT (s after the reveal for one picture with the notes, to the shots dir).
// Headless (tools/bench/src/chrome.mjs pickBrowser; BENCH_UNCAPPED=1 for frame times); takes no GPU lock itself (wrap it).
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pickBrowser } from '../src/chrome.mjs';
import { nvidiaThermal } from './gpu-select-fly.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const [base, label, query = ''] = process.argv.slice(2);
if (!base || !label) {
    console.error('usage: loadq-probe.mjs <base with /en> <label> [query]');
    process.exit(2);
}
const env = process.env;
const SCENE = env.SCENE || '70b50d42';
const SECONDS = Number(env.SECS || 120);
const CLASS = env.CLASS || 'desktop-strong';
const GOV = env.GOV !== '0';
const PILOT = env.PILOT || '';
const PILOT_AT = env.PILOT_AT !== undefined ? Number(env.PILOT_AT) : null;
const DELAY = Number(env.DELAY || 0);
const DROP = Number(env.DROP || 0);
const DROPTRIES = Number(env.DROPTRIES || 3);
const STALL = Number(env.STALL || 0);
// STALLTRIES: only the first k requests of a stalled file go unanswered (unset: every request, a file that never comes)
const STALLTRIES = env.STALLTRIES !== undefined ? Number(env.STALLTRIES) : Infinity;
const UP = env.UP !== undefined ? Number(env.UP) : null;
const PITCH = Number(env.PITCH || -35);
const SHOTS = (env.SHOTS || '').split(',').filter(Boolean).map(Number);
const ALIAS = (env.ALIAS || '').split(',').filter(Boolean);
const STILL = env.STILL !== undefined ? Number(env.STILL) : null;
const STILLMS = Number(env.STILLMS || 66);
const STILLMAX = Number(env.STILLMAX || 16);
const UIAT = env.UIAT !== undefined ? Number(env.UIAT) : null;
// L2 switches: STILLOFF=1 (the product's G6 "More detail at rest" off from the reveal, to compare with L1), PRESSAT (s after
// the reveal: press the detail line's button when shown), MOVEAT (s after the reveal: push the craft to 2 m/s in one frame and log every
// frame's sticks, speed and engine budget: how many frames the base takes to come back), UISTATES (state:name,...: one
// picture with the notes, to the shots dir, the first time the detail line is shown in that state)
const STILLOFF = env.STILLOFF === '1';
const PRESSAT = env.PRESSAT !== undefined ? Number(env.PRESSAT) : null;
const MOVEAT = env.MOVEAT !== undefined ? Number(env.MOVEAT) : null;
// loadq2 switch: FLY (s after the reveal) moves the held camera along its start heading at FLYV (5) m/s for FLYSECS (60) s
// and keeps the craft's sim speed at 2 m/s meanwhile, so the still rule sees a flight (a hook flight, not the keyboard)
const FLY = env.FLY !== undefined ? Number(env.FLY) : null;
const FLYV = Number(env.FLYV || 5);
const FLYSECS = Number(env.FLYSECS || 60);
const UISTATES = (env.UISTATES || '').split(',').filter(Boolean).map((x) => x.split(':'));
// loadq2 switch: GOVLOG=1 wraps the keeper's onFrame from the reveal and records every judged frame (interval, held, the
// interval before, missed as the keeper logged it, the step after); res.govlog has the counts and the frames around
// each step change
const GOVLOG = env.GOVLOG === '1';
const GOVWRAP = `(() => {
    const g = window.__gsfpv.governor; const o = g.onFrame.bind(g); window.__gl = [];
    g.onFrame = (t, ex, held, st) => { const last = g.last, prev = g.prevDt, s0 = g.step, n0 = g.log.length, e0 = g.log[g.log.length - 1];
        const r = o(t, ex, held, st); const e1 = g.log[g.log.length - 1];
        if (e1 && e1 !== e0 && window.__gl.length < 60000) window.__gl.push([Math.round(t * 10) / 10, Math.round((t - last) * 10) / 10, held ? 1 : 0, Math.round(prev * 10) / 10, e1.missed ? 1 : 0, g.step, ex ? 1 : 0, st ? 1 : 0]);
        return r; };
    return { judgedPeriodMs: g.judgedPeriodMs, periodMs: g.displayPeriodMs };
})()`;
const GOVSUM = `(() => {
    const L = window.__gl || []; const m = L.filter((x) => x[4]);
    const out = { frames: L.length, missed: m.length, missedHeld: m.filter((x) => x[2]).length, held: L.filter((x) => x[2]).length,
        missedHeldShort: m.filter((x) => x[2] && x[1] <= 20.8).length, missedDt: m.filter((x) => !x[2]).length,
        judgedPeriodMs: window.__gsfpv.governor.judgedPeriodMs, changes: [] };
    for (let i = 1; i < L.length; i++) if (L[i][5] !== L[i - 1][5]) {
        const w = L.filter((x) => x[0] > L[i][0] - 1000 && x[0] <= L[i][0]);
        out.changes.push({ t: L[i][0], from: L[i - 1][5], to: L[i][5], win: w.length, winMissed: w.filter((x) => x[4]).length, winMissedHeld: w.filter((x) => x[4] && x[2]).length, last: L.slice(Math.max(0, i - 12), i + 1).map((x) => x.slice(1, 5)) });
    }
    return out;
})()`;
const MOVELOG = `(() => {
    const h = window.__gsfpv; const s = h.session; const a = s.renderer.app; window.__mv = [];
    const tick = () => { const sim = s.runner.sim; const v = sim.s; if (window.__mv.length === 10) v[3] += 2; window.__mv.push([performance.now(), sim.ch[0], sim.ch[1], sim.ch[2], sim.ch[3], Math.hypot(v[3], v[4], v[5]), Math.round(a.scene.gsplat.splatBudget / 1e4) / 100, a.stats.frame.gsplats]); if (window.__mv.length < 600) requestAnimationFrame(tick); };
    requestAnimationFrame(tick); return true;
})()`;
const vw = Number(env.VW || 1920);
const vh = Number(env.VH || 1080);
const OUT = env.OUT || 'U:/Temp/gsfpv-train3/loadq';
const PNG = join(REPO, '.cache', 'lod-view');
mkdirSync(OUT, { recursive: true });
mkdirSync(PNG, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r2 = (x) => (x === null || x === undefined || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);

const INIT = () => {
    window.__raf = [];
    let last = 0;
    const tick = (t) => {
        if (last && window.__raf.length < 200000) window.__raf.push([t, t - last]);
        last = t;
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
};

const INSTANCE = `(() => {
    const h = window.__gsfpv; const s = h && h.session; const r = s && s.renderer; const a = r && r.app;
    const dir = a && a.renderer && a.renderer.gsplatDirector;
    let inst = null;
    if (dir) dir.camerasMap.forEach((cd) => cd.layersMap.forEach((ld) => { const m = ld.gsplatManager && ld.gsplatManager.world; if (m && m._octreeInstances) m._octreeInstances.forEach((i) => { inst = inst || i; }); }));
    return inst;
})()`;

const STATE = `(() => {
    const h = window.__gsfpv || {}; const s = h.session; const r = s && s.renderer; const a = r && r.app;
    const out = { status: h.status || null, visibleMs: s && s.timings ? s.timings.visibleMs : null };
    if (!a) return out;
    out.drawn = a.stats.frame.gsplats;
    out.engineBudgetM = Math.round(a.scene.gsplat.splatBudget / 1e4) / 100;
    const d = h.drawing; if (d) { out.from = d.from && d.from.budget; out.topM = d.budgetM; out.setting = d.budgetSetting; out.cls = d.class; }
    const g = h.governor; if (g) { out.govStep = g.step; out.govM = Math.round(g.current.splatBudgetMillions * 100) / 100; out.govOn = g.enabled; out.scale = g.current.renderScale; }
    out.renderScale = r.renderScale;
    try { if (h.detail) { const d = h.detail(); out.detail = { state: d.state, shown: d.shown, text: d.text, action: d.action, stream: d.stream }; } if (h.still) out.still = h.still(); } catch (e) { out.detailErr = String(e).slice(0, 80); }
    try { const l = h.lod && h.lod(); if (l) { out.settingM = Math.round(l.settingBudgetM * 100) / 100; out.lodMode = l.mode; out.levels = l.levels; out.view = l.view && l.view.active; out.contentFailures = l.contentFailures.length; } } catch (e) { out.lodErr = String(e).slice(0, 80); }
    const inst = ${INSTANCE};
    if (inst) {
        const ld = inst.octree.assetLoader;
        out.queue = ld && ld._loadQueue ? ld._loadQueue.size : null;
        out.inFlight = ld && ld._currentlyLoading ? ld._currentlyLoading.size : null;
        out.givenUp = ld && ld._failed ? ld._failed.size : null;
        out.pending = inst.pending ? inst.pending.size : null;
        out.prefetch = inst.prefetchPending ? inst.prefetchPending.size : null;
        const cam = r.camera; const cp = cam.getPosition(); const F = cam.forward, R = cam.right, U = cam.up;
        const c = cam.camera; const aspect = c.aspectRatio > 0 ? c.aspectRatio : 1;
        let tanV = Math.tan(c.fov * Math.PI / 360); if (c.horizontalFov) tanV /= aspect; const tanH = tanV * aspect;
        const cosH = 1 / Math.hypot(1, tanH), sinH = tanH * cosH, cosV = 1 / Math.hypot(1, tanV), sinV = tanV * cosV;
        const wt = inst.placement.node.getWorldTransform(); const sc = Math.abs(wt.getScale().x) || 1; const v = cp.clone();
        const ns = inst.octree.nodes;
        let area = 0, areaLevel = 0, areaWant = 0, nIn = 0, inSplats = 0, allSplats = 0, finer = 0;
        inst.nodeInfos.forEach((ni, i) => {
            const b = ns[i].boundingSphere; v.set(b.x, b.y, b.z); wt.transformPoint(v, v);
            const dx = v.x - cp.x, dy = v.y - cp.y, dz = v.z - cp.z; const dd = Math.hypot(dx, dy, dz); const rad = b.w * sc;
            const z = dx * F.x + dy * F.y + dz * F.z; const x = Math.abs(dx * R.x + dy * R.y + dz * R.z); const y = Math.abs(dx * U.x + dy * U.y + dz * U.z);
            const inside = dd < rad || (z > -rad && x * cosH - z * sinH <= rad && y * cosV - z * sinV <= rad);
            const l = ni.currentLod; const cnt = l >= 0 && ns[i].lods[l] ? ns[i].lods[l].count : 0;
            allSplats += cnt;
            if (!inside) return;
            nIn++; inSplats += cnt;
            if (l > 0) finer++;
            const w = dd > rad ? (rad / dd) * (rad / dd) : 1;
            if (l >= 0) { area += w; areaLevel += w * l; areaWant += w * (ni.optimalLod >= 0 ? ni.optimalLod : l); }
        });
        out.areaLevel = area > 0 ? Math.round(areaLevel / area * 100) / 100 : null;
        out.areaWanted = area > 0 ? Math.round(areaWant / area * 100) / 100 : null;
        out.inFrameM = Math.round(inSplats / 1e4) / 100; out.nodesInFrame = nIn; out.nodesInFrameNotFinest = finer;
        out.lodLevels = inst.octree.lodLevels;
    }
    const vr = a.graphicsDevice && a.graphicsDevice._vram; if (vr) out.vramMB = Math.round(vr.total / 1e6);
    if (performance.memory) out.heapMB = Math.round(performance.memory.usedJSHeapSize / 1e6);
    return out;
})()`;

/** The camera held by the probe (the session's cameraOverride), every engine update; c.pos null = not yet. */
const HOLD = (up, pitch) => `(() => {
    const h = window.__gsfpv; const s = h.session; const r = s.renderer; const a = r.app;
    const p = r.camera.getPosition(); const f = r.camera.forward;
    const c = { pos: [p.x, p.y + ${up ?? 0}, p.z], yaw: Math.atan2(f.x, f.z), pitch: ${up === null ? 'Math.asin(Math.max(-1, Math.min(1, f.y)))' : `${pitch} * Math.PI / 180`} };
    window.__gsHold = c;
    s.cameraOverride = true;
    a.on('update', (dt) => { const k = window.__gsHold; const fl = window.__gsFly;
        if (fl && performance.now() < fl.until) { k.pos[0] += Math.sin(k.yaw) * fl.v * dt; k.pos[2] += Math.cos(k.yaw) * fl.v * dt; const v = s.runner.sim.s; v[3] = 2; v[4] = 0; v[5] = 0; } r.setCameraLookAt(k.pos[0], k.pos[1], k.pos[2], k.pos[0] + Math.sin(k.yaw) * Math.cos(k.pitch) * 10, k.pos[1] + Math.sin(k.pitch) * 10, k.pos[2] + Math.cos(k.yaw) * Math.cos(k.pitch) * 10); });
    return { pos: c.pos.map((x) => Math.round(x * 10) / 10), yawDeg: Math.round(c.yaw * 1800 / Math.PI) / 10, pitchDeg: Math.round(c.pitch * 1800 / Math.PI) / 10 };
})()`;

const pct = (a, q) => {
    if (!a.length) return null;
    const s = [...a].sort((x, y) => x - y);
    return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

const pick = pickBrowser({ expected: chromium.executablePath() });
const browser = await chromium.launch({ ...pick.launch, headless: true });
const ctx = await browser.newContext({ viewport: { width: vw, height: vh } });
const page = await ctx.newPage();
await page.addInitScript(INIT);
const pilotQ = PILOT && PILOT_AT === null ? `&set.display.budget=${PILOT}` : '';
const url = `${base}/fly/?scene=${SCENE}&nowarn=1&input=touch&drawing=sorted&set.display.deviceClass=${CLASS}${GOV ? '' : '&governor=0'}${pilotQ}${query}`;
const res = { label, url, env: { SCENE, SECONDS, CLASS, GOV, PILOT, PILOT_AT, DELAY, DROP, DROPTRIES, STALL, UP, PITCH, STILL, STILLMS, STILLMAX, vw, vh, uncapped: env.BENCH_UNCAPPED === '1' }, browser: { kind: pick.kind, version: browser.version() }, errors: [], samples: [], notes: [], files: { asked: 0, distinct: 0, loaded: 0, failed: 0, dropped: 0, stalled: 0, bytes: 0 } };
page.on('pageerror', (e) => res.errors.push(String(e.message).slice(0, 200)));
const isScanFile = (u) => u.includes(`/${SCENE}/`) && /\/\d+_\d+\//.test(u);
// every Nth distinct scan file: fail its first DROPTRIES requests, or never answer it
const seen = new Map();
const stalled = [];
if (DROP || STALL) {
    await page.route((u) => isScanFile(u.toString()), async (route) => {
        const u = route.request().url();
        if (!seen.has(u)) seen.set(u, { n: seen.size + 1, tries: 0 });
        const e = seen.get(u);
        e.tries++;
        if (DROP && e.n % DROP === 0 && e.tries <= DROPTRIES) {
            res.files.dropped++;
            return route.fulfill({ status: 503, body: 'dropped by loadq-probe' });
        }
        if (STALL && e.n % STALL === 0 && e.tries <= STALLTRIES) {
            res.files.stalled++;
            stalled.push(route);
            return;
        }
        return route.continue();
    });
}
const distinct = new Set();
page.on('request', (q) => { if (isScanFile(q.url())) { res.files.asked++; distinct.add(q.url()); } });
page.on('requestfinished', async (q) => {
    if (!isScanFile(q.url())) return;
    const resp = await q.response().catch(() => null);
    if (resp && resp.status() >= 400) { res.files.failed++; return; }
    res.files.loaded++;
    const sz = await q.sizes().catch(() => null);
    res.files.bytes += sz ? sz.responseBodySize : 0;
});
page.on('requestfailed', (q) => { if (isScanFile(q.url())) res.files.failed++; });
const shot = async (name) => writeFileSync(join(PNG, `${label}-${name}.png`), await page.screenshot({ type: 'png' }));
const frameMs = async (fromMs) => page.evaluate(`window.__raf.filter((x) => x[0] >= ${fromMs}).map((x) => x[1])`).catch(() => []);
try {
    res.gpuBefore = nvidiaThermal();
    const t0 = Date.now();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
    let revealAt = null;
    let still = null;
    const tookShots = new Set();
    for (;;) {
        await sleep(1000);
        const s = Math.round((Date.now() - t0) / 100) / 10;
        const st = await page.evaluate(STATE).catch((e) => ({ error: String(e.message).slice(0, 120) }));
        const now = await page.evaluate('performance.now()').catch(() => 0);
        const ft = await frameMs(now - 1000);
        const row = { s, ...st, frameMedMs: r2(pct(ft, 0.5)), frameP90Ms: r2(pct(ft, 0.9)), fps: ft.length, asked: res.files.asked, distinct: distinct.size, loaded: res.files.loaded, failed: res.files.failed, MB: r2(res.files.bytes / 1e6) };
        if (revealAt === null && st.visibleMs !== null && st.visibleMs !== undefined) {
            revealAt = Date.now();
            res.revealS = s;
            await page.addStyleTag({ content: '#ui.loadq-hide { visibility: hidden !important; }' }).catch(() => {});
            res.hold = await page.evaluate(HOLD(UP, PITCH)).catch((e) => ({ error: String(e.message) }));
        }
        // the hook's setFrameDelay may come after the reveal (loadq2: one run lost its delay): asked every second until set
        if (revealAt !== null && DELAY && !res.delaySet) {
            res.delaySet = await page.evaluate(`typeof window.__gsfpv.setFrameDelay === 'function' ? (window.__gsfpv.setFrameDelay(${DELAY}), ${'performance.now()'}) : false`).catch(() => false);
            if (res.delaySet) res.delaySet = r2((Date.now() - revealAt) / 1000);
        }
        // the keeper is on the hook after the reveal too (loadq2: the first wrap found no hook.governor)
        if (revealAt !== null && GOVLOG && !(res.govWrap && res.govWrap.judgedPeriodMs)) {
            res.govWrap = await page.evaluate(`window.__gsfpv.governor ? ${GOVWRAP} : { missing: true }`).catch((e) => ({ error: String(e.message).slice(0, 160) }));
            if (res.govWrap && res.govWrap.judgedPeriodMs) res.govWrap.at = r2((Date.now() - revealAt) / 1000);
        }
        if (revealAt !== null && res.revealS === s) {
            if (STILLOFF) res.stillOff = await page.evaluate("JSON.stringify(window.__gsfpv.prefs.set('display.stillDetail', false))").catch((e) => String(e.message));
        }
        if (revealAt !== null && FLY !== null && !res.fly && (Date.now() - revealAt) / 1000 >= FLY) {
            res.fly = { at: r2((Date.now() - revealAt) / 1000), v: FLYV, secs: FLYSECS };
            await page.evaluate(`window.__gsFly = { v: ${FLYV}, until: performance.now() + ${FLYSECS * 1000} }`).catch((e) => { res.fly.error = String(e.message); });
        }
        const ds = st.detail;
        for (const [want, name] of UISTATES) if (ds && ds.shown && ds.state === want && !(res.uiStates ||= {})[want]) {
            await page.screenshot({ path: `U:/Temp/gsfpv-train3/shots/${name}.png` });
            res.uiStates[want] = { at: r2(revealAt === null ? null : (Date.now() - revealAt) / 1000), text: ds.text, action: ds.action };
        }
        if (revealAt !== null && PRESSAT !== null && !res.press && (Date.now() - revealAt) / 1000 >= PRESSAT && ds && ds.shown && ds.action) {
            const before = { state: ds.state, text: ds.text, govM: st.govM, engineBudgetM: st.engineBudgetM };
            const ok = await page.click('[data-action="detail-press"]', { timeout: 3000 }).then(() => true, (e) => String(e.message).slice(0, 100));
            await sleep(1500);
            const after = await page.evaluate(STATE).catch(() => ({}));
            res.press = { at: r2((Date.now() - revealAt) / 1000), ok, before, after: { state: after.detail && after.detail.state, text: after.detail && after.detail.text, govM: after.govM, engineBudgetM: after.engineBudgetM, scale: after.renderScale } };
        }
        if (revealAt !== null && MOVEAT !== null && !res.move && (Date.now() - revealAt) / 1000 >= MOVEAT) {
            res.move = { at: r2((Date.now() - revealAt) / 1000), still: st.still };
            await page.evaluate(MOVELOG);
            await sleep(200);
            // the craft pushed to 2 m/s in the 11th logged frame (MOVELOG): a move as the still rule sees it
            await sleep(1500);
            const log = await page.evaluate('window.__mv').catch(() => []);
            const moved = log.findIndex((x) => Math.abs(x[1]) >= 0.05 || Math.abs(x[2]) >= 0.05 || Math.abs(x[4]) >= 0.05 || x[5] >= 0.3);
            const back = moved < 0 ? -1 : log.findIndex((x, i) => i >= moved && x[6] <= (st.still ? st.still.baseM : 0) + 0.01);
            res.move.frames = log.length; res.move.movedFrame = moved; res.move.baseBackFrame = back;
            res.move.framesToBase = moved >= 0 && back >= 0 ? back - moved : null;
            res.move.around = moved >= 0 ? log.slice(Math.max(0, moved - 2), moved + 4).map((x) => x.map((v) => r2(v))) : log.slice(0, 3);
            res.move.drawnAfter = [0, 12, 30, 60].map((k) => (log[moved + k] ? log[moved + k][7] : null));
        }
        const since = revealAt === null ? null : (Date.now() - revealAt) / 1000;
        row.sinceReveal = since === null ? null : r2(since);
        if (since !== null && PILOT && PILOT_AT !== null && !res.pilotSetAt && since >= PILOT_AT) {
            res.pilotSetAt = r2(since);
            res.pilotSet = await page.evaluate(`JSON.stringify(window.__gsfpv.prefs.set('display.budget', '${PILOT}'))`).catch((e) => String(e.message));
        }
        if (since !== null && (since >= res.notes.length * 5 || (UIAT !== null && !res.uiShot && since >= UIAT))) {
            const text = await page.evaluate("(() => { const u = document.getElementById('ui'); return u ? u.innerText.replace(/\\s+/g, ' ').trim().slice(0, 600) : ''; })()").catch(() => '');
            if (since >= res.notes.length * 5) res.notes.push([r2(since), text]);
            if (UIAT !== null && !res.uiShot && since >= UIAT) { await page.screenshot({ path: `U:/Temp/gsfpv-train3/shots/${label}-ui.png` }); res.uiShot = { at: r2(since), text }; }
        }
        for (const at of SHOTS) if (since !== null && since >= at && !tookShots.has(at)) {
            tookShots.add(at);
            await page.evaluate("document.getElementById('ui').classList.add('loadq-hide')");
            await shot(`t${at}`);
            await page.evaluate("document.getElementById('ui').classList.remove('loadq-hide')");
        }
        // G6 measurement switch (probe side, no product change): raise the budget while the picture is still
        if (STILL !== null && since !== null && since >= STILL) {
            if (!still) still = { t0: Date.now(), base: st.engineBudgetM, budget: st.engineBudgetM, steps: [], pics: new Set() };
            const at = (Date.now() - still.t0) / 1000;
            if (at < 20.5 && row.frameMedMs !== null && row.frameMedMs < STILLMS && still.budget < STILLMAX) {
                still.budget = Math.min(STILLMAX, r2(still.budget * 1.5));
                await page.evaluate(`window.__gsfpv.session.renderer.setSplatBudgetMillions(${still.budget})`);
            }
            still.steps.push({ at: r2(at), budgetM: still.budget, drawn: st.drawn, frameMedMs: row.frameMedMs, MB: row.MB, vramMB: st.vramMB, heapMB: st.heapMB, areaLevel: st.areaLevel });
            for (const k of [5, 10, 20]) if (at >= k && !still.pics.has(k)) {
                still.pics.add(k);
                await page.evaluate("document.getElementById('ui').classList.add('loadq-hide')");
                await shot(`rest${k}`);
            }
            if (at >= 20 && !still.moved) {
                still.moved = { drawnBefore: st.drawn };
                await page.evaluate(`window.__gsfpv.session.renderer.setSplatBudgetMillions(${still.base})`);
                const m0 = Date.now();
                await shot('move0');
                still.moved.shot0Ms = Date.now() - m0;
                still.moved.drawn0 = await page.evaluate('window.__gsfpv.session.renderer.app.stats.frame.gsplats');
                await sleep(Math.max(0, 1000 - (Date.now() - m0)));
                await shot('move1');
                still.moved.drawn1 = await page.evaluate('window.__gsfpv.session.renderer.app.stats.frame.gsplats');
                res.still = { base: still.base, steps: still.steps, moved: still.moved };
                res.samples.push(row);
                break;
            }
        }
        res.samples.push(row);
        if (Date.now() - t0 >= SECONDS * 1000) break;
    }
    await page.evaluate("document.getElementById('ui') && document.getElementById('ui').classList.add('loadq-hide')").catch(() => {});
    await shot('end');
    for (const a of ALIAS) await shot(a);
    const done = await page.evaluate(STATE).catch(() => ({}));
    res.end = done;
    if (GOVLOG) res.govlog = await page.evaluate(GOVSUM).catch((e) => ({ error: String(e.message) }));
    // the second from which the picture stopped changing: the drawn count within 0.5 % of the end and nothing loading
    const S = res.samples.filter((x) => x.drawn !== undefined);
    let settled = null;
    for (let i = S.length - 1; i >= 0; i--) {
        const x = S[i];
        const calm = Math.abs(x.drawn - done.drawn) <= 0.005 * Math.max(1, done.drawn) && (x.queue ?? 0) === 0 && (x.inFlight ?? 0) === 0 && (x.pending ?? 0) === 0;
        if (!calm) break;
        settled = x.sinceReveal;
    }
    res.settledSinceRevealS = settled;
} catch (e) {
    res.fail = String(e && e.stack ? e.stack : e).slice(0, 600);
}
for (const r of stalled) r.abort().catch(() => {});
res.files.distinct = distinct.size;
writeFileSync(join(OUT, `${label}.json`), JSON.stringify(res, null, 1));
const e = res.end || {};
console.log(JSON.stringify({ detail: e.detail && [e.detail.state, e.detail.text, e.detail.stream], still: e.still, press: res.press, move: res.move && { framesToBase: res.move.framesToBase, movedFrame: res.move.movedFrame, drawnAfter: res.move.drawnAfter, still: res.move.still }, uiStates: res.uiStates, label, gpuBefore: res.gpuBefore && res.gpuBefore.utilPct, revealS: res.revealS, settled: res.settledSinceRevealS, drawn: e.drawn, engineBudgetM: e.engineBudgetM, topM: e.topM, from: e.from, govStep: e.govStep, govM: e.govM, scale: e.renderScale, area: e.areaLevel, want: e.areaWanted, queue: e.queue, inFlight: e.inFlight, givenUp: e.givenUp, pending: e.pending, files: res.files, vramMB: e.vramMB, fail: res.fail, errors: res.errors.length }));
await browser.close();
