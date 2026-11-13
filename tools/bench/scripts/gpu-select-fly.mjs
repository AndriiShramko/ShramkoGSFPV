// One scan in the simulator on a normally started, VISIBLE browser, with the adapter that browser really got
// (lane gpu-select, docs/wip/gpu-select.md). The same run on the integrated and on the discrete GPU is the
// "before / after" of the lane; the load and turn parts answer the owner's question about how a streamed scan
// loads ("far parts sharpen first, near parts last") and what a fast turn costs.
//
// What one run records (camera at the scan's start place, sticks untouched: `input=touch`, nobody arms):
//   load    from the navigation to "nothing left to load": every 250 ms the loading stage, the files the engine
//           still wants, splats drawn, the governor's step and render scale, and the octree's nodes grouped by
//           real distance from the camera (under 8 m, 8-25 m, 25-80 m, beyond) and by "inside 60 degrees of the view
//           axis or not": how many show nothing, how many are at the level the engine wants, the mean level shown.
//           Also every scan file fetched (time, level of detail from its path, bytes).
//   still   STILL seconds at rest: frame intervals (p50, p95, p99, longest), frames held, and Windows' GPU
//           counters of the browser's GPU process per adapter at the same time.
//   turn    the camera turns on the spot (the session's cameraOverride, as probe-v08-flight.ts): slow 360,
//           fast 720 at 360 degrees/s, a snap of 180, back, a snap of 90; per phase the frame intervals, the scan files
//           fetched, the most files the engine still wanted, and how many nodes in view stay coarser than wanted.
// Reads engine internals (gsplatDirector -> ... -> _octreeInstances[].nodeInfos, read-only, as probe-v08-lod.ts).
// Takes the benches' GPU lock (C:/dev/.gpu-lock). Never changes a Windows setting.
//
//   node tools/bench/scripts/gpu-select-fly.mjs --scene 7a475d38 --variant default --label fly-garden-intel
//   node tools/bench/scripts/gpu-select-fly.mjs --scene 70b50d42 --variant force-hp --query "&governor=0"
// Options: --browser chrome|edge|<path>, --site <origin>, --still <s> (20), --no-turn, --load-timeout <s> (300),
// --window (a 1296x920 window instead of a maximized one), --arg=<switch>.
// Output: evidence/<date>/gpu-select/<label>.json (summaries; the per-frame trace is reduced to per-second rows).
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { asciiJson, browserExe, gpuCountersAsync, gpuProcessPid, mask, startStockBrowser, systemInfo, VARIANTS } from './gpu-select-probe.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LOCK = 'C:/dev/.gpu-lock';

export function parseArgs(argv) {
    const o = { browser: 'chrome', variant: 'default', scene: '7a475d38', label: '', site: 'https://gsfpv.flyreelstudio.eu', path: '/en/fly/', lane: 'gpu-select', query: '', still: 20, turn: true, loadTimeout: 300, maximized: true, extra: [], tune: {}, cool: 0, soak: 0 };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--browser') o.browser = argv[++i];
        else if (a === '--variant') o.variant = argv[++i];
        else if (a === '--scene') o.scene = argv[++i];
        else if (a === '--label') o.label = argv[++i];
        else if (a === '--site') o.site = argv[++i].replace(/\/$/, '');
        // the page's path on that site: /en/fly/ on the live site and a release build, /fly/ on the Vite dev server
        else if (a === '--path') o.path = argv[++i];
        // the evidence folder under evidence/<date>/ (another lane's runs of this probe go to its own)
        else if (a === '--lane') o.lane = argv[++i].replace(/[^a-z0-9-]/gi, '');
        else if (a === '--query') o.query = argv[++i];
        else if (a === '--still') o.still = Number(argv[++i]);
        else if (a === '--load-timeout') o.loadTimeout = Number(argv[++i]);
        else if (a === '--no-turn') o.turn = false;
        // --cool <C>: wait until the NVIDIA card is at most that warm before the browser starts (a cold start);
        // --soak <s>: keep the loaded scan drawing that long before the measured rest (the sustained, warmed-up state)
        else if (a === '--cool') o.cool = Number(argv[++i]);
        else if (a === '--soak') o.soak = Number(argv[++i]);
        else if (a === '--tune') {
            // an experiment on the engine's streaming, set in the page before the full detail is asked for:
            // underfill (lodUnderfillLimit), concurrent (the loader's parallel downloads), behind (lodBehindPenalty),
            // angle (lodUpdateAngle), cooldown (cooldownTicks). Measuring only: the product is not changed.
            const [k, v] = argv[++i].split('=');
            if (!['underfill', 'concurrent', 'behind', 'angle', 'cooldown'].includes(k) || !Number.isFinite(Number(v))) throw new Error(`--tune ${k}=${v}: underfill | concurrent | behind | angle | cooldown = number`);
            o.tune[k] = Number(v);
        }
        else if (a === '--window') o.maximized = false;
        else if (a.startsWith('--arg=')) o.extra.push(a.slice(6));
        else throw new Error(`unknown argument ${a}`);
    }
    if (!VARIANTS[o.variant]) throw new Error(`unknown variant ${o.variant}`);
    if (!o.label) o.label = `fly-${o.scene}-${o.variant}`;
    return o;
}

/**
 * The NVIDIA card's thermal state from nvidia-smi (null without the tool): temperature, power, the graphics clock, the
 * power state and whether the driver says it is slowing the card down for heat. On the laptop of this lane the card
 * reaches 81-82 C after two to three minutes of load and the driver then halves its clock ("SW thermal slowdown"),
 * so a number without this beside it cannot be compared with another.
 */
export function nvidiaThermal() {
    const r = spawnSync('nvidia-smi', ['--query-gpu=temperature.gpu,power.draw,clocks.gr,pstate,clocks_throttle_reasons.active,clocks_throttle_reasons.sw_thermal_slowdown,utilization.gpu', '--format=csv,noheader,nounits'], { encoding: 'utf8', timeout: 15000, windowsHide: true });
    if (r.error || r.status !== 0) return null;
    const [temp, power, clock, pstate, reasons, slow, util] = (r.stdout ?? '').trim().split(/\s*,\s*/);
    return { tempC: Number(temp), powerW: Number(power), clockMHz: Number(clock), pstate: pstate ?? null, throttleReasons: reasons ?? null, thermalSlowdown: /^active/i.test(slow ?? ''), utilPct: Number(util) };
}

/** Waits until the NVIDIA card is at most `maxC` degrees (or `timeoutS` passed): a run that should start cold. */
async function coolDown(maxC, timeoutS) {
    const t0 = Date.now();
    let at = nvidiaThermal();
    while (at && at.tempC > maxC && Date.now() - t0 < timeoutS * 1000) {
        await sleep(5000);
        at = nvidiaThermal();
    }
    return { askedMaxC: maxC, waitedS: Math.round((Date.now() - t0) / 1000), at };
}

/** The benches' GPU lock (tools/bench/src/gpu-lock.ts): a directory made atomically, stale after 30 minutes. */
async function lock() {
    let waited = 0;
    for (;;) {
        try {
            mkdirSync(LOCK);
            return;
        } catch {
            try {
                if (Date.now() - statSync(LOCK).mtimeMs > 30 * 60 * 1000) {
                    rmdirSync(LOCK);
                    continue;
                }
            } catch {
                /* gone */
            }
            if (!waited++) console.log('waiting for the GPU lock');
            await sleep(200);
        }
    }
}
const unlock = () => {
    try {
        rmdirSync(LOCK);
    } catch {
        /* not ours */
    }
};

// ---- in the page (strings: the release CSP refuses new Function, evaluate of a string is allowed) ----

/** Every frame from the moment the renderer exists: [t, interval, files loading, frames held, governor step, render scale, splats drawn, turn phase]. */
const TRACE = `(function hookTrace() {
    window.__gsTrace = window.__gsTrace || [];
    const h = window.__gsfpv; const s = h && h.session; const r = s && s.renderer;
    if (!r || !r.app) { setTimeout(hookTrace, 50); return; }
    if (window.__gsTraceOn) return;
    window.__gsTraceOn = true;
    let last = 0;
    r.app.on('frameend', () => {
        const t = performance.now(); const g = h.governor;
        if (window.__gsTrace.length < 60000) window.__gsTrace.push([Math.round(t * 10) / 10, last ? Math.round((t - last) * 100) / 100 : 0, r.splatFrame ? r.splatFrame.loading : -1, r.framesHeld, g ? g.step : -1, r.renderScale, r.app.stats.frame.gsplats, window.__gsYaw ? window.__gsYaw.phase : '']);
        last = t;
    });
})()`;

/**
 * --tune: the engine's streaming parameters set in the page as soon as its renderer exists (before the page asks for the full
 * detail), and what they were before. An experiment for measuring: `concurrent` reaches the loader, which is not public API.
 */
const TUNE = (t) => `(function tune() {
    const h = window.__gsfpv; const s = h && h.session; const r = s && s.renderer; const a = r && r.app;
    if (!a) { setTimeout(tune, 20); return; }
    if (window.__gsTune) return;
    const g = a.scene.gsplat; const t = ${JSON.stringify(t)};
    window.__gsTune = { at: Math.round(performance.now()), asked: t, before: { underfill: g.lodUnderfillLimit, behind: g.lodBehindPenalty, angle: g.lodUpdateAngle, cooldown: g.cooldownTicks } };
    if (t.underfill !== undefined) g.lodUnderfillLimit = t.underfill;
    if (t.behind !== undefined) g.lodBehindPenalty = t.behind;
    if (t.angle !== undefined) g.lodUpdateAngle = t.angle;
    if (t.cooldown !== undefined) g.cooldownTicks = t.cooldown;
    (function loader() {
        const comp = r.splat && r.splat.gsplat; const oct = comp && comp.resource && comp.resource.octree; const l = oct && oct.assetLoader;
        if (!l) { setTimeout(loader, 20); return; }
        window.__gsTune.before.concurrent = l.maxConcurrentLoads;
        if (t.concurrent !== undefined) l.maxConcurrentLoads = t.concurrent;
        window.__gsTune.loaderAt = Math.round(performance.now());
    })();
})()`;

/** The page's state in one object; the octree's nodes by distance band and by "in view". */
const STATE = `(() => {
    const h = window.__gsfpv; const s = h && h.session; const r = s && s.renderer; const a = r && r.app;
    const out = { t: Math.round(performance.now()), status: h ? h.status : 'none', error: (h && h.error) || null };
    if (h && h.loading) out.load = { stage: h.loading.stage, fraction: Math.round((h.loading.fraction || 0) * 1000) / 1000, loaded: h.loading.loaded, total: h.loading.total, reveal: h.loading.reveal || null };
    if (!a) return out;
    const g = a.scene.gsplat; const gov = h.governor;
    out.visibleMs = s.timings ? s.timings.visibleMs : null;
    out.firstFrameMs = s.timings ? s.timings.firstFrameMs : null;
    out.loading = r.splatFrame ? r.splatFrame.loading : null;
    out.drawn = a.stats.frame.gsplats;
    out.budgetM = Math.round(g.splatBudget / 1e4) / 100;
    out.step = gov ? gov.step : null;
    out.scale = r.renderScale;
    out.held = r.framesHeld;
    out.phase = window.__gsYaw ? window.__gsYaw.phase : '';
    const cam = r.camera; const cp = cam.getPosition(); const cf = cam.forward;
    const ent = r.splat; const wt = ent && ent.getWorldTransform ? ent.getWorldTransform() : null;
    const sc = wt ? Math.abs(wt.getScale().x) || 1 : 1;
    const v = cp.clone();
    const BANDS = [8, 25, 80, 1e9];
    const mk = () => BANDS.map(() => ({ n: 0, none: 0, atWanted: 0, cur: 0, want: 0, splats: 0 }));
    const view = mk(); const off = mk();
    const perLevel = {}; let nodes = 0; let levels = null; let pending = 0; let prefetch = 0;
    const dir = a.renderer.gsplatDirector;
    if (dir) dir.camerasMap.forEach((cd) => cd.layersMap.forEach((ld) => {
        const m = ld.gsplatManager && ld.gsplatManager.world;
        if (!m || !m._octreeInstances) return;
        m._octreeInstances.forEach((inst) => {
            levels = inst.octree.lodLevels; pending += inst.pending.size; prefetch += inst.prefetchPending.size;
            const ns = inst.octree.nodes;
            inst.nodeInfos.forEach((ni, i) => {
                nodes++;
                const b = ns[i].boundingSphere; v.set(b.x, b.y, b.z); if (wt) wt.transformPoint(v, v);
                const dx = v.x - cp.x, dy = v.y - cp.y, dz = v.z - cp.z; const d = Math.hypot(dx, dy, dz); const rad = b.w * sc;
                const dist = Math.max(0, d - rad);
                const cos = d > 1e-6 ? (dx * cf.x + dy * cf.y + dz * cf.z) / d : 1;
                const o = (cos > 0.5 || d < rad ? view : off)[BANDS.findIndex((x) => dist < x)];
                o.n++;
                const l = ni.currentLod;
                if (l < 0) o.none++; else { o.cur += l; const c = ns[i].lods[l]; const cnt = c ? c.count : 0; o.splats += cnt; perLevel[l] = (perLevel[l] || 0) + cnt; }
                if (ni.optimalLod >= 0) { o.want += ni.optimalLod; if (l === ni.optimalLod) o.atWanted++; }
            });
        });
    }));
    out.nodes = nodes; out.levels = levels; out.pending = pending; out.prefetch = prefetch; out.perLevel = perLevel; out.view = view; out.off = off;
    return out;
})()`;

/** What the page knows about itself at the end: the drawing decision, the device class, the adapter, the hint. */
const FINAL = `(() => {
    const h = window.__gsfpv; const s = h.session; const r = s.renderer; const a = r.app;
    const vram = a.graphicsDevice._vram || {}; let vramBytes = 0; for (const k in vram) if (typeof vram[k] === 'number' && k !== 'total') vramBytes += vram[k];
    const hint = h.gpuHint ? { seen: h.gpuHint.seen(), open: h.gpuHint.open(), check: h.gpuHint.check() } : null;
    const d = h.drawing || {};
    // the whole scan: splats per level of detail if every node were drawn at that level (level 0 = the full scan)
    const scan = {}; let scanNodes = 0; let scanFiles = null;
    const dir = a.renderer.gsplatDirector;
    if (dir) dir.camerasMap.forEach((cd) => cd.layersMap.forEach((ld) => {
        const m = ld.gsplatManager && ld.gsplatManager.world;
        if (!m || !m._octreeInstances) return;
        m._octreeInstances.forEach((inst) => {
            scanFiles = inst.octree.files ? inst.octree.files.length : null;
            inst.octree.nodes.forEach((n) => { scanNodes++; n.lods.forEach((c, l) => { scan[l] = (scan[l] || 0) + (c ? c.count : 0); }); });
        });
    }));
    return {
        scan: { nodes: scanNodes, files: scanFiles, splatsPerLevelM: Object.fromEntries(Object.entries(scan).map(([k, v]) => [k, Math.round(v / 1e4) / 100])) },
        lod: typeof h.lod === 'function' ? h.lod() : null,
        info: h.info || null,
        drawing: { class: d.class, classAuto: d.classAuto, classReasons: d.classReasons, classPicked: d.classPicked, gpu: d.gpu, mode: d.mode, budgetM: d.budgetM, engineBudgetM: d.engineBudgetM, renderScale: d.renderScale, drawn: d.drawn },
        gpuInfo: r.gpuInfo, webgpu: r.isWebGPU, hint,
        contentKind: s.scene.contentKind, contentUrl: s.scene.contentUrl,
        backbuffer: [a.graphicsDevice.width, a.graphicsDevice.height], inner: [innerWidth, innerHeight], dpr: devicePixelRatio,
        vramMB: Math.round(vramBytes / 1048576), jsHeapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
        timings: s.timings, visibility: document.visibilityState, focus: document.hasFocus(),
        frameStats: typeof s.frameStats === 'function' ? s.frameStats() : null,
        camera: (() => { const p = r.camera.getPosition(); const f = r.camera.forward; return { pos: [p.x, p.y, p.z].map((x) => Math.round(x * 100) / 100), forward: [f.x, f.y, f.z].map((x) => Math.round(x * 1000) / 1000) }; })()
    };
})()`;

/** The camera turns on the spot through `spec` phases ({ name, dur seconds, rate degrees/s, snap degrees }). */
const TURN = (spec) => `((spec) => {
    const h = window.__gsfpv; const s = h.session; const r = s.renderer; const a = r.app;
    const p = r.camera.getPosition().clone(); const f = r.camera.forward.clone();
    const yaw0 = Math.atan2(f.x, f.z);
    s.cameraOverride = true;
    window.__gsYaw = { phase: spec[0].name, deg: 0 };
    let idx = 0; let tPhase = performance.now(); let base = 0;
    const onUpdate = () => {
        const now = performance.now();
        let ph = spec[idx];
        while (ph && (now - tPhase) / 1000 > ph.dur) { base += (ph.snap || 0) + (ph.rate || 0) * ph.dur; tPhase += ph.dur * 1000; idx++; ph = spec[idx]; }
        if (!ph) { a.off('update', onUpdate); window.__gsYaw.phase = 'done'; return; }
        const deg = base + (ph.snap || 0) + (ph.rate || 0) * (now - tPhase) / 1000;
        window.__gsYaw.phase = ph.name; window.__gsYaw.deg = deg;
        const y = yaw0 + deg * Math.PI / 180;
        r.setCameraLookAt(p.x, p.y, p.z, p.x + Math.sin(y) * 10, p.y, p.z + Math.cos(y) * 10);
    };
    a.on('update', onUpdate);
    return { pos: [p.x, p.y, p.z], yaw0deg: Math.round(yaw0 * 1800 / Math.PI) / 10 };
})(${JSON.stringify(spec)})`;

export const TURN_SPEC = [
    { name: 'rest', dur: 3 },
    { name: 'slow360', dur: 6, rate: 60 },
    { name: 'rest2', dur: 3 },
    { name: 'fast720', dur: 2, rate: 360 },
    { name: 'rest3', dur: 4 },
    { name: 'snap180', dur: 8, snap: 180 },
    { name: 'snapBack', dur: 6, snap: 180 },
    { name: 'snap90', dur: 6, snap: 90 }
];

// ---- numbers ----

const q = (sorted, x) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * x))] : null);
const r2 = (x) => (x === null || x === undefined ? null : Math.round(x * 100) / 100);

/**
 * What the pilot saw, from trace rows. The engine ticks every animation frame, but the renderer does not draw a tick
 * while the GPU still works on the two frames before it (SplatRenderer.maxFramesInFlight: "held", the display repeats
 * a picture). So the numbers that count are of the DRAWN frames: `fps` and the intervals between one drawn frame and
 * the next (p50, p95, p99, longest, share over 25 ms and 50 ms). `ticks` and `tickFps` are the engine's own rate, kept
 * to show the difference; `held` the ticks not drawn and `heldShare` their part.
 */
export function frameStats(rows) {
    if (rows.length < 2) return { frames: 0 };
    const seconds = (rows[rows.length - 1][0] - rows[0][0]) / 1000;
    const drawn = [];
    for (let i = 1; i < rows.length; i++) if (rows[i][3] === rows[i - 1][3]) drawn.push(rows[i][0]);
    const dts = [];
    for (let i = 1; i < drawn.length; i++) dts.push(drawn[i] - drawn[i - 1]);
    dts.sort((a, b) => a - b);
    const ticks = rows.length - 1;
    const held = rows[rows.length - 1][3] - rows[0][3];
    if (!dts.length || seconds <= 0) return { frames: 0, ticks, held };
    return { frames: drawn.length, fps: r2(drawn.length / seconds), p50ms: r2(q(dts, 0.5)), p95ms: r2(q(dts, 0.95)), p99ms: r2(q(dts, 0.99)), maxMs: r2(dts[dts.length - 1]), over25ms: r2(dts.filter((x) => x > 25).length / dts.length), over50ms: r2(dts.filter((x) => x > 50).length / dts.length), ticks, tickFps: r2(ticks / seconds), held, heldShare: r2(held / ticks) };
}

/**
 * One row per second of a trace: frames DRAWN in it (as frameStats counts them: a tick whose "held" count did not rise),
 * the engine's ticks, the longest interval between two ticks, files loading, governor step, render scale, splats drawn.
 */
export function perSecond(rows, t0) {
    const out = [];
    let cur = null;
    let held = null;
    for (const x of rows) {
        const sec = Math.floor((x[0] - t0) / 1000);
        if (!cur || cur.s !== sec) {
            if (cur) out.push(cur);
            cur = { s: sec, frames: 0, ticks: 0, maxTickMs: 0, loading: 0, step: x[4], scale: x[5], drawn: x[6], phase: x[7] };
        }
        cur.ticks++;
        if (held !== null && x[3] === held) cur.frames++;
        held = x[3];
        cur.maxTickMs = Math.max(cur.maxTickMs, x[1]);
        cur.loading = Math.max(cur.loading, x[2]);
        cur.step = x[4];
        cur.scale = x[5];
        cur.drawn = x[6];
        cur.phase = x[7];
    }
    if (cur) out.push(cur);
    return out;
}

/** A band of nodes as short numbers: count, showing nothing, at the wanted level, mean level shown and wanted, M splats. */
const band = (b) => ({ n: b.n, none: b.none, atWanted: b.atWanted, meanShown: b.n - b.none > 0 ? r2(b.cur / (b.n - b.none)) : null, meanWanted: b.n ? r2(b.want / b.n) : null, splatsM: r2(b.splats / 1e6) });
const bands = (st) => ({ view: st.view ? st.view.map(band) : null, off: st.off ? st.off.map(band) : null });
/** Nodes in view that are coarser than wanted or show nothing. */
const behindInView = (st) => (st.view ? st.view.reduce((a, b) => a + (b.n - b.atWanted), 0) : null);
const nearBehind = (st) => (st.view ? st.view[0].n - st.view[0].atWanted + (st.view[1].n - st.view[1].atWanted) : null);

async function main() {
    const o = parseArgs(process.argv.slice(2));
    if (process.platform !== 'win32') throw new Error('gpu-select-fly: Windows only');
    const exe = browserExe(o.browser);
    if (!exe) throw new Error(`no executable for --browser ${o.browser}`);
    const date = new Date().toISOString().slice(0, 10);
    const outDir = join(REPO, 'evidence', date, o.lane);
    mkdirSync(outDir, { recursive: true });
    const url = `${o.site}${o.path}?scene=${o.scene}&nowarn=1&input=touch${o.query}`;
    const result = { name: `${o.lane}/${o.label}`, date: new Date().toISOString(), label: o.label, scene: o.scene, url, browserName: o.browser, variant: o.variant, query: o.query, bandsMetres: [8, 25, 80, 'more'], inView: 'node centre within 60 degrees of the view axis, or the camera inside the node' };
    let stock = null;
    let held = false;
    // stopped by hand (Ctrl+C): the browser and its profile go, and the lock too when it is this run's
    process.on('SIGINT', () => {
        void (async () => {
            try {
                if (stock) await stock.close(false);
            } catch {
                /* already gone */
            } finally {
                if (held) unlock();
                process.exit(130);
            }
        })();
    });
    await lock();
    held = true;
    try {
        result.thermal = { cool: o.cool ? await coolDown(o.cool, 300) : null, beforeStart: nvidiaThermal() };
        stock = await startStockBrowser({ exe, label: o.label, variant: o.variant, extra: o.extra, maximized: o.maximized });
        const { cdp, context, page } = stock;
        result.launch = stock.launch;
        result.browser = stock.version;
        const files = [];
        let nav0 = Date.now();
        page.on('response', (resp) => {
            const u = resp.url();
            if (!u.includes(`/${o.scene}/`)) return;
            const m = u.match(/\/(\d+)_(\d+)\/([^/?]+)/);
            files.push({ t: Date.now() - nav0, level: m ? Number(m[1]) : null, file: m ? `${m[1]}_${m[2]}/${m[3]}` : u.slice(u.indexOf(`/${o.scene}/`) + o.scene.length + 2).split('?')[0], bytes: Number(resp.headers()['content-length'] ?? 0) || 0, status: resp.status() });
        });
        await context.addInitScript(TRACE);
        if (Object.keys(o.tune).length) await context.addInitScript(TUNE(o.tune));
        await page.bringToFront();
        nav0 = Date.now();
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
        // ---- load ----
        const timeline = [];
        const trace = [];
        const drain = async () => {
            const rows = await page.evaluate('window.__gsTrace ? window.__gsTrace.splice(0) : []').catch(() => []);
            for (const x of rows) trace.push(x);
        };
        let calm = 0;
        let revealAt = null;
        let settledAt = null;
        let last = null;
        for (;;) {
            await sleep(250);
            const st = await page.evaluate(STATE).catch((e) => ({ status: 'eval-error', error: String(e.message ?? e).slice(0, 200) }));
            st.wall = Date.now() - nav0;
            last = st;
            timeline.push({ wall: st.wall, status: st.status, stage: st.load?.stage ?? null, fraction: st.load?.fraction ?? null, loading: st.loading ?? null, pending: st.pending ?? null, prefetch: st.prefetch ?? null, drawnM: st.drawn !== undefined ? r2(st.drawn / 1e6) : null, budgetM: st.budgetM ?? null, step: st.step ?? null, scale: st.scale ?? null, perLevelM: st.perLevel ? Object.fromEntries(Object.entries(st.perLevel).map(([k, v]) => [k, r2(v / 1e6)])) : null, ...bands(st), behindInView: behindInView(st), nearBehind: nearBehind(st) });
            await drain();
            if (st.status === 'error') throw new Error(`the page failed: ${st.error}`);
            if (revealAt === null && st.visibleMs !== null && st.visibleMs !== undefined) revealAt = st.wall;
            if (revealAt !== null && st.loading === 0 && (st.pending ?? 0) === 0 && (st.prefetch ?? 0) === 0) calm++;
            else calm = 0;
            if (calm >= 12) {
                settledAt = st.wall - 3000;
                break;
            }
            if (st.wall > o.loadTimeout * 1000) break;
        }
        // the owner's question in numbers: after the reveal, how long until what is NEAR and in view is at the level the engine
        // wants, against the same for everything in view; and the mean level shown near the camera 1, 2, 3 and 5 s after it
        // "Sharp" is the moment a band is at the level the engine wants FOR GOOD: the first sample after the last one in which
        // some node of the band was not there. (The first sharp sample is not it: at the reveal every node still shows the
        // coarse level it was told to want, and the opened range shows up a sample or two later.) null: the run ended before
        // that, or the band has no node; 0: the band never was behind.
        const after = revealAt === null ? [] : timeline.filter((x) => x.wall >= revealAt && x.view);
        const t0 = revealAt;
        const sharp = (x, bandsIdx) => bandsIdx.every((i) => x.view[i].atWanted === x.view[i].n);
        const sharpFrom = (bandsIdx) => {
            if (!after.some((x) => bandsIdx.some((i) => x.view[i].n > 0))) return null;
            const hit = after[after.map((x) => sharp(x, bandsIdx)).lastIndexOf(false) + 1];
            return hit ? hit.wall - t0 : null;
        };
        const shownAt = (ms, i) => { const hit = after.find((x) => x.wall - t0 >= ms); return hit ? hit.view[i].meanShown : null; };
        result.order = {
            nearSharpMs: sharpFrom([0]), near25SharpMs: sharpFrom([0, 1]), farSharpMs: sharpFrom([2, 3]), allInViewSharpMs: sharpFrom([0, 1, 2, 3]),
            nearLevelShown: { atReveal: shownAt(0, 0), after1s: shownAt(1000, 0), after2s: shownAt(2000, 0), after3s: shownAt(3000, 0), after5s: shownAt(5000, 0), wantedAtEnd: after.length ? after[after.length - 1].view[0].meanWanted : null },
            farLevelShown: { atReveal: shownAt(0, 3), after1s: shownAt(1000, 3), after2s: shownAt(2000, 3), after3s: shownAt(3000, 3), after5s: shownAt(5000, 3), wantedAtEnd: after.length ? after[after.length - 1].view[3].meanWanted : null },
            note: 'near: nodes under 8 m in view; near25: under 25 m; far: beyond 25 m; level 0 is the finest; ms count from the reveal; "sharp" is the first sample (every 250 ms) after the last one in which a node of the band was not at the level the engine wants'
        };
        result.load = {
            revealWallMs: revealAt, settledWallMs: settledAt, timedOut: settledAt === null, visibleMs: last?.visibleMs ?? null, firstFrameMs: last?.firstFrameMs ?? null,
            nodes: last?.nodes ?? null, levels: last?.levels ?? null,
            files: { count: files.length, megabytes: r2(files.reduce((a, b) => a + b.bytes, 0) / 1e6), perLevel: Object.fromEntries([...new Set(files.map((f) => f.level))].sort((a, b) => (a ?? -1) - (b ?? -1)).map((l) => [l === null ? 'other' : l, { files: files.filter((f) => f.level === l).length, megabytes: r2(files.filter((f) => f.level === l).reduce((a, b) => a + b.bytes, 0) / 1e6), firstMs: Math.min(...files.filter((f) => f.level === l).map((f) => f.t)), lastMs: Math.max(...files.filter((f) => f.level === l).map((f) => f.t)) }])) },
            // the order the levels of detail arrived in: one entry per fetched level file, time and level only
            order: files.filter((f) => f.level !== null).map((f) => [f.t, f.level])
        };
        // the timeline thinned to one row per second (every row while something changes fast is too much to keep)
        result.loadTimeline = timeline.filter((x, i) => i % 4 === 0 || i === timeline.length - 1);
        result.loadFrames = { beforeReveal: frameStats(trace.filter((x) => revealAt !== null && x[0] < (last?.t ?? 0) - (last.wall - revealAt))), afterReveal: frameStats(trace.filter((x) => revealAt !== null && x[0] >= (last?.t ?? 0) - (last.wall - revealAt))) };
        // ---- still ----
        const gpuPid = await gpuProcessPid(cdp);
        result.gpuProcessPid = gpuPid;
        result.systemInfo = await systemInfo(cdp);
        await drain();
        // --soak: the scan keeps drawing at rest until the card has warmed up; the frames of the soak are kept per 30 s
        if (o.soak > 0) {
            const soak = [];
            const s0 = Date.now();
            while (Date.now() - s0 < o.soak * 1000) {
                trace.length = 0;
                const part0 = Date.now();
                while (Date.now() - part0 < 30000 && Date.now() - s0 < o.soak * 1000) {
                    await sleep(500);
                    await drain();
                }
                soak.push({ atS: Math.round((Date.now() - s0) / 1000), frames: frameStats(trace), thermal: nvidiaThermal() });
            }
            result.soak = { seconds: o.soak, parts: soak };
        }
        trace.length = 0;
        result.thermal.stillStart = nvidiaThermal();
        const counters = gpuPid ? gpuCountersAsync(gpuPid, o.still) : Promise.resolve({ error: 'no GPU process' });
        const stillT0 = Date.now();
        while (Date.now() - stillT0 < o.still * 1000) {
            await sleep(500);
            await drain();
        }
        result.thermal.stillEnd = nvidiaThermal();
        const stillState = await page.evaluate(STATE);
        result.still = { seconds: o.still, frames: frameStats(trace), drawnM: r2(stillState.drawn / 1e6), budgetM: stillState.budgetM, governorStep: stillState.step, renderScale: stillState.scale, perLevelM: Object.fromEntries(Object.entries(stillState.perLevel ?? {}).map(([k, v]) => [k, r2(v / 1e6)])), ...bands(stillState), perSecond: perSecond(trace, trace.length ? trace[0][0] : 0), counters: await counters };
        // ---- turn ----
        if (o.turn) {
            await drain(); // the rows the page gathered while the counters were read belong to the rest, not to the turn
            trace.length = 0;
            const start = await page.evaluate(TURN(TURN_SPEC));
            const total = TURN_SPEC.reduce((a, b) => a + b.dur, 0);
            const snaps = [];
            const tt0 = Date.now();
            const turnNav = tt0 - nav0;
            while (Date.now() - tt0 < (total + 1) * 1000) {
                await sleep(250);
                const st = await page.evaluate(STATE);
                snaps.push({ ms: Date.now() - tt0, phase: st.phase, loading: st.loading, pending: st.pending, prefetch: st.prefetch, drawnM: r2(st.drawn / 1e6), step: st.step, scale: st.scale, behindInView: behindInView(st), nearBehind: nearBehind(st), viewNear: st.view ? band(st.view[0]) : null, viewMid: st.view ? band(st.view[1]) : null });
                await drain();
            }
            const phases = {};
            const names = new Set(TURN_SPEC.map((p) => p.name));
            let from = 0;
            for (const ph of TURN_SPEC) {
                // the phase's rows and the row before its first: the interval that crosses into a phase (where the hitch of a
                // snap lands) is the phase's own
                const i0 = trace.findIndex((x) => x[7] === ph.name);
                const rows = i0 < 0 ? [] : trace.slice(Math.max(0, i0 - 1)).filter((x, k) => k === 0 || x[7] === ph.name);
                const ss = snaps.filter((x) => x.phase === ph.name);
                // nothing left to load FOR GOOD: the first calm sample after the last busy one (null: the phase ended busy)
                const calmFrom = ss[ss.map((x) => !(x.loading === 0 && x.pending === 0 && x.prefetch === 0)).lastIndexOf(true) + 1];
                // the scan files fetched while the phase ran (by the phase's place in the turn's schedule)
                const got = files.filter((f) => f.t - turnNav >= from * 1000 && f.t - turnNav < (from + ph.dur) * 1000);
                from += ph.dur;
                phases[ph.name] = { ...ph, frames: frameStats(rows), filesFetched: got.length, megabytesFetched: r2(got.reduce((a, b) => a + b.bytes, 0) / 1e6), maxLoading: ss.reduce((a, b) => Math.max(a, b.loading ?? 0), 0), maxBehindInView: ss.reduce((a, b) => Math.max(a, b.behindInView ?? 0), 0), maxNearBehind: ss.reduce((a, b) => Math.max(a, b.nearBehind ?? 0), 0), endBehindInView: ss.length ? ss[ss.length - 1].behindInView : null, endNearBehind: ss.length ? ss[ss.length - 1].nearBehind : null, msToNothingLoading: ss.length && calmFrom ? calmFrom.ms - ss[0].ms : null, drawnMinM: ss.reduce((a, b) => Math.min(a, b.drawnM ?? 1e9), 1e9), drawnMaxM: ss.reduce((a, b) => Math.max(a, b.drawnM ?? 0), 0) };
            }
            const turnFiles = files.filter((f) => f.t >= turnNav);
            result.turn = { start, phases, filesFetched: turnFiles.length, megabytesFetched: r2(turnFiles.reduce((a, b) => a + b.bytes, 0) / 1e6), snapshots: snaps.filter((x, i) => i % 2 === 0), all: frameStats(trace.filter((x) => names.has(x[7]))) };
            result.thermal.turnEnd = nvidiaThermal();
        }
        result.final = await page.evaluate(FINAL);
        result.tune = Object.keys(o.tune).length ? await page.evaluate('window.__gsTune || null') : null;
        result.verdict = {
            adapter: result.final.gpuInfo ? `${result.final.gpuInfo.vendor} ${result.final.gpuInfo.architecture}` : result.final.webgpu ? 'webgpu, unnamed' : 'webgl',
            deviceClass: result.final.drawing?.class ?? null, hint: result.final.hint?.check ?? null,
            revealS: revealAt !== null ? r2(revealAt / 1000) : null, settledS: settledAt !== null ? r2(settledAt / 1000) : null, filesMB: result.load.files.megabytes,
            order: `after the reveal: far nodes at their level in ${result.order.farSharpMs} ms, nodes under 8 m in ${result.order.nearSharpMs} ms, everything in view in ${result.order.allInViewSharpMs} ms; level shown under 8 m: ${result.order.nearLevelShown.atReveal} at the reveal, ${result.order.nearLevelShown.after2s} after 2 s, ${result.order.nearLevelShown.after5s} after 5 s (wanted ${result.order.nearLevelShown.wantedAtEnd})`,
            tune: result.tune ? result.tune.asked : null,
            // the NVIDIA card at the end of the measured rest: without this beside it a frame rate cannot be compared
            nvidiaAtRest: result.thermal.stillEnd ? `${result.thermal.stillEnd.tempC} C, clock ${result.thermal.stillEnd.clockMHz} MHz, ${result.thermal.stillEnd.pstate}, ${result.thermal.stillEnd.thermalSlowdown ? 'THERMAL SLOWDOWN' : 'no thermal slowdown'}` : null,
            still: `${result.still.frames.fps} frames drawn per second (the engine ticks ${result.still.frames.tickFps}/s, ${Math.round((result.still.frames.heldShare ?? 0) * 100)} % of them held), between drawn frames p50 ${result.still.frames.p50ms} ms, p95 ${result.still.frames.p95ms} ms, p99 ${result.still.frames.p99ms} ms; ${result.still.drawnM} M splats of ${result.still.budgetM} M, step ${result.still.governorStep}, scale ${result.still.renderScale}`,
            turn: result.turn ? `${result.turn.all.fps} frames drawn per second (${Math.round((result.turn.all.heldShare ?? 0) * 100)} % held), p95 ${result.turn.all.p95ms} ms, longest ${result.turn.all.maxMs} ms` : null,
            backbuffer: result.final.backbuffer, busiest: Object.entries(result.still.counters?.perAdapter ?? {}).sort((a, b) => b[1].max3d - a[1].max3d).map(([n, v]) => `${n}: 3D ${v.avg3d} % avg, ${v.max3d} % max, dedicated ${v.dedicatedMb} MB, shared ${v.sharedMb} MB`)
        };
    } catch (e) {
        result.error = String(e?.stack ?? e).slice(0, 1500);
    } finally {
        if (stock) await stock.close(false);
        stock = null;
        unlock();
        held = false;
    }
    const file = join(outDir, `${o.label}.json`);
    writeFileSync(file, asciiJson(mask(JSON.stringify(result, null, 1))) + '\n');
    console.log(JSON.stringify({ file: file.replace(REPO, '.').replace(/\\/g, '/'), verdict: result.verdict ?? null, error: result.error ?? null }, null, 2));
    if (result.error) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === resolve(process.argv[1]).toLowerCase()) await main();
