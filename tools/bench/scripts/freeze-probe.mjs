// Lane laptop4, stage Q1-why: why does a huge streamed scan freeze the page when the scan's level-of-detail multiplier is
// below 2 (laptop3 P3: Lublin 2f1ddf5f at budget 0.5 M and ?lodmul=1.7 drew no frame for 30 s), and what paces the frames
// of a headless run on this PC. One page load of a local release, nothing pressed; it records:
//   - every animation frame's interval in the page (rAF) and every engine frame (frameend): files loading, splats drawn;
//   - once a second the streaming state read from engine internals (measuring only): the loader's queue and files in
//     flight, the octree's nodes and levels, the scan's multiplier, the splats drawn, and how long the page took to answer;
//   - long tasks of the main thread (PerformanceObserver 'longtask');
//   - PROFILE=1: a CDP CPU profile of the main thread over the whole run: the busy runs of 300 ms or more with the
//     functions that held them (self and inclusive share), and the top functions of the whole run.
//   node tools/bench/scripts/freeze-probe.mjs http://localhost:5740/en <out.json> "&budget=0.5&lodmul=1.7"
// env: SCENE (2f1ddf5f), SECONDS after the page starts (60), UP metres above the start place to hold the camera after the
// reveal (0 = stay), PITCH (-35), VW and VH (1920 x 1080), CHROME_ARGS (extra browser flags, space separated).
// Headless (tools/bench/src/chrome.mjs pickBrowser); takes no GPU lock itself (wrap it).
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { pickBrowser } from '../src/chrome.mjs';
import { nvidiaThermal } from './gpu-select-fly.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [base, outFile, query = ''] = process.argv.slice(2);
if (!base || !outFile) {
    console.error('usage: freeze-probe.mjs <base with /en> <out.json> [query]');
    process.exit(2);
}
const SCENE = process.env.SCENE || '2f1ddf5f';
const SECONDS = Number(process.env.SECONDS || 60);
const UP = Number(process.env.UP || 0);
const PITCH = Number(process.env.PITCH || -35);
const extra = (process.env.CHROME_ARGS || '').split(' ').filter(Boolean);
const pick = pickBrowser({ expected: chromium.executablePath() });
const browser = await chromium.launch({ ...pick.launch, headless: true, args: [...(pick.launch.args || []), ...extra] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const INIT = () => {
    window.__raf = [];
    window.__fe = [];
    window.__lt = [];
    let last = 0;
    const tick = (t) => {
        if (last && window.__raf.length < 100000) window.__raf.push([Math.round(t), Math.round((t - last) * 100) / 100]);
        last = t;
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    try {
        new PerformanceObserver((l) => {
            for (const e of l.getEntries()) window.__lt.push([Math.round(e.startTime), Math.round(e.duration)]);
        }).observe({ type: 'longtask', buffered: true });
    } catch {
        /* no longtask API */
    }
    (function hook() {
        const h = window.__gsfpv;
        const r = h && h.session && h.session.renderer;
        if (!r || !r.app) {
            setTimeout(hook, 50);
            return;
        }
        let fl = 0;
        r.app.on('frameend', () => {
            const t = performance.now();
            if (window.__fe.length < 100000) window.__fe.push([Math.round(t), fl ? Math.round((t - fl) * 100) / 100 : 0, r.splatFrame ? r.splatFrame.loading : -1, r.app.stats.frame.gsplats]);
            fl = t;
        });
    })();
};

/** The streaming state of the first octree instance (engine internals, read for measuring). */
const STATE = `(() => {
    const t0 = performance.now();
    const h = window.__gsfpv || {}; const s = h.session; const r = s && s.renderer; const a = r && r.app;
    const out = { status: h.status || null, visibleMs: s && s.timings ? s.timings.visibleMs : null };
    if (!a) return out;
    out.drawn = a.stats.frame.gsplats;
    const dir = a.renderer && a.renderer.gsplatDirector;
    let inst = null; let world = null;
    if (dir) dir.camerasMap.forEach((cd) => cd.layersMap.forEach((ld) => { const m = ld.gsplatManager && ld.gsplatManager.world; if (m && m._octreeInstances) m._octreeInstances.forEach((i) => { inst = inst || i; world = world || m; }); }));
    if (inst) {
        const ld = inst.octree.assetLoader;
        out.queue = ld && ld._loadQueue ? ld._loadQueue.size : null;
        out.inFlight = ld && ld._currentlyLoading ? ld._currentlyLoading.size : null;
        out.nodes = inst.octree.nodes.length;
        out.mult = inst.placement.lodMultiplier;
        out.pending = inst.pendingLoadCount ?? null;
        let want = 0, shown = 0;
        if (inst.nodeInfos) for (const n of inst.nodeInfos) { if (n.optimalLod >= 0) want++; }
        out.nodesWithLod = want;
    }
    if (r.splatFrame) out.loading = r.splatFrame.loading;
    const p = r.camera.getPosition(); const f = r.camera.forward;
    out.cam = [p.x, p.y, p.z, f.x, f.y, f.z].map((x) => Math.round(x * 100) / 100);
    out.readMs = Math.round((performance.now() - t0) * 10) / 10;
    return out;
})()`;

const HOLD = (up, pitch) => `(() => {
    const h = window.__gsfpv; const s = h.session; const r = s.renderer; const a = r.app;
    const p = r.camera.getPosition(); const f = r.camera.forward;
    const c = { pos: [p.x, p.y + ${up}, p.z], yaw: Math.atan2(f.x, f.z), pitch: ${pitch} * Math.PI / 180 };
    s.cameraOverride = true;
    a.on('update', () => r.setCameraLookAt(c.pos[0], c.pos[1], c.pos[2], c.pos[0] + Math.sin(c.yaw) * Math.cos(c.pitch) * 10, c.pos[1] + Math.sin(c.pitch) * 10, c.pos[2] + Math.cos(c.yaw) * Math.cos(c.pitch) * 10));
    return c.pos.map((x) => Math.round(x));
})()`;

// busy runs (anything but '(idle)', '(program)' and '(garbage collector)' counted as busy too; gaps under 10 ms) of at
// least 300 ms, each with its functions: self and inclusive share (a function counted once per sample); and the whole run
function profileSummary(p) {
    const byId = new Map(p.nodes.map((n) => [n.id, n]));
    const parent = new Map();
    for (const n of p.nodes) for (const c of n.children || []) parent.set(c, n.id);
    const label = (n) => {
        const f = n.callFrame;
        return `${f.functionName || '(anon)'}@${(f.url || '').split('/').pop()}:${f.lineNumber + 1}:${f.columnNumber + 1}`;
    };
    const runs = [];
    const all = { self: new Map(), incl: new Map(), n: 0 };
    let cur = null;
    let t = p.startTime;
    const add = (acc, n) => {
        acc.n++;
        acc.self.set(label(n), (acc.self.get(label(n)) || 0) + 1);
        const seen = new Set();
        for (let id = n.id; id !== undefined; id = parent.get(id)) {
            const l = label(byId.get(id));
            if (!seen.has(l)) {
                seen.add(l);
                acc.incl.set(l, (acc.incl.get(l) || 0) + 1);
            }
        }
    };
    for (let i = 0; i < p.samples.length; i++) {
        t += p.timeDeltas[i] || 0;
        const n = byId.get(p.samples[i]);
        if (n.callFrame.functionName === '(idle)') {
            if (cur && t - cur.end > 10000) {
                runs.push(cur);
                cur = null;
            }
            continue;
        }
        if (!cur || t - cur.end > 10000) {
            if (cur) runs.push(cur);
            cur = { start: t, end: t, self: new Map(), incl: new Map(), n: 0 };
        }
        cur.end = t;
        add(cur, n);
        add(all, n);
    }
    if (cur) runs.push(cur);
    const top = (m, n, k = 16) => [...m].sort((a, b) => b[1] - a[1]).slice(0, k).map(([x, v]) => [x, Math.round((v / n) * 1000) / 10]);
    const spanS = (p.endTime - p.startTime) / 1e6;
    return {
        spanS: Math.round(spanS * 10) / 10,
        busyShare: Math.round((all.n / Math.max(1, p.samples.length)) * 1000) / 10,
        top: { self: top(all.self, all.n, 24), incl: top(all.incl, all.n, 24) },
        runs: runs.filter((r) => r.end - r.start >= 300000).map((r) => ({ atS: +((r.start - p.startTime) / 1e6).toFixed(1), ms: Math.round((r.end - r.start) / 1000), samples: r.n, selfPct: top(r.self, r.n), inclPct: top(r.incl, r.n) }))
    };
}

const pct = (a, q) => {
    if (!a.length) return null;
    const s = [...a].sort((x, y) => x - y);
    return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};
const frames = (xs, from) => {
    const d = xs.filter((x) => x[0] >= from).map((x) => x[1]);
    return { n: d.length, medianMs: pct(d, 0.5), p90Ms: pct(d, 0.9), maxMs: d.length ? Math.max(...d) : null };
};

const vw = Number(process.env.VW || 1920);
const vh = Number(process.env.VH || 1080);
const ctx = await browser.newContext({ viewport: { width: vw, height: vh } });
const page = await ctx.newPage();
await page.addInitScript(INIT);
const url = `${base}/fly/?scene=${SCENE}&nowarn=1&input=touch&governor=0&drawing=sorted&set.display.deviceClass=desktop-strong${query}`;
const res = { url, browser: { kind: pick.kind, version: browser.version(), extra }, viewport: [vw, vh], seconds: SECONDS, up: UP, errors: [], samples: [] };
page.on('pageerror', (e) => res.errors.push(String(e.message).slice(0, 200)));
const t00 = Date.now();
res.console = [];
page.on('console', (m) => {
    if (res.console.length < 80 && m.type() !== 'debug') res.console.push([Math.round((Date.now() - t00) / 100) / 10, m.type(), m.text().slice(0, 200)]);
});
const cdp = process.env.PROFILE ? await ctx.newCDPSession(page) : null;
const answer = async (expr, ms = 3000) => {
    const t0 = Date.now();
    const v = await Promise.race([page.evaluate(expr).catch((e) => ({ error: String(e.message).slice(0, 120) })), sleep(ms).then(() => ({ noAnswer: true }))]);
    return { v, ms: Date.now() - t0 };
};
try {
    if (cdp) {
        await cdp.send('Profiler.enable');
        await cdp.send('Profiler.setSamplingInterval', { interval: 2000 });
        await cdp.send('Profiler.start');
    }
    // the card's load before the page starts: another program on the GPU (it takes no bench lock) slows every frame
    res.gpuBefore = nvidiaThermal();
    const t0 = Date.now();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
    let held = null;
    while (Date.now() - t0 < SECONDS * 1000) {
        await sleep(1000);
        const a = await answer(STATE);
        const st = a.v || {};
        const gpu = res.samples.length % 5 === 0 ? nvidiaThermal() : null;
        res.samples.push({ s: Math.round((Date.now() - t0) / 100) / 10, answerMs: a.ms, gpuUtil: gpu ? gpu.utilPct : undefined, ...st });
        if (res.revealS === undefined && st.visibleMs !== null && st.visibleMs !== undefined) res.revealS = Math.round((Date.now() - t0) / 100) / 10;
        if (UP && res.revealS !== undefined && !held) {
            held = await answer(HOLD(UP, PITCH));
            res.heldAt = { s: Math.round((Date.now() - t0) / 100) / 10, pos: held.v };
        }
    }
    const tail = await answer('({ raf: window.__raf, fe: window.__fe, lt: window.__lt, now: performance.now() })', 20000);
    if (tail.v && tail.v.raf) {
        const from = res.revealS !== undefined ? tail.v.now - (SECONDS - res.revealS) * 1000 : 0;
        const last20 = tail.v.now - 20000;
        res.raf = { all: frames(tail.v.raf, 0), afterReveal: frames(tail.v.raf, from), last20s: frames(tail.v.raf, last20) };
        // the five longest gaps between animation frames: [page ms at the frame that ended the gap, gap ms]
        res.rafGaps = [...tail.v.raf].sort((a, b) => b[1] - a[1]).slice(0, 5);
        res.engine = { all: frames(tail.v.fe.map((x) => [x[0], x[1]]), 0), last20s: frames(tail.v.fe.map((x) => [x[0], x[1]]), last20), frames: tail.v.fe.length };
        res.longtasks = { n: tail.v.lt.length, totalMs: tail.v.lt.reduce((s, x) => s + x[1], 0), max: tail.v.lt.reduce((m, x) => (x[1] > m[1] ? x : m), [0, 0]), last20s: tail.v.lt.filter((x) => x[0] >= last20).reduce((s, x) => s + x[1], 0) };
    } else res.tail = tail;
    if (cdp) {
        const { profile } = await cdp.send('Profiler.stop');
        res.profile = profileSummary(profile);
    }
} catch (e) {
    res.fail = String(e && e.stack ? e.stack : e).slice(0, 600);
}
writeFileSync(outFile, JSON.stringify(res, null, 1));
const s = res.samples;
console.log(JSON.stringify({ gpuBefore: res.gpuBefore && res.gpuBefore.utilPct, gpuUtil: s.map((x) => x.gpuUtil).filter((x) => x !== undefined), revealS: res.revealS, rendererS: (s.find((x) => x.drawn !== undefined) || {}).s, rafGaps: res.rafGaps, raf: res.raf, engine: res.engine, longtasks: res.longtasks && { n: res.longtasks.n, totalMs: res.longtasks.totalMs, max: res.longtasks.max }, last: s[s.length - 1], noAnswer: s.filter((x) => x.noAnswer).length, busy: res.profile && res.profile.busyShare, runs: res.profile && res.profile.runs.map((r) => [r.atS, r.ms]), fail: res.fail, errors: res.errors.length }));
await browser.close();
