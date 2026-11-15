// Stage G4-prove page probe: the owner's path on a generated course (message 51), on a local release.
// Per scan: Shift+G once and wait for the course (walls first if the scan has none; every progress line kept with its time);
// a top-down picture of the gates over the walls (drawn in the page from the live collision grid; gate colour = height
// above the ground under it) and every gate's height above that ground; a pilot's view at gate 1; then the flight model
// is led through gates 1..3 (the probe sets the craft's place and speed each physics step), hovers 6 s, and is sent at
// 12 m/s into the nearest wall: crash, automatic respawn ('rewind' target), and the next gate and the HUD clock are read
// before the crash and after the respawn; then R, and they are read again.
//   node tools/bench/scripts/course-path-probe.mjs http://localhost:5720/en <out.json> <shots dir> <id>[,<id>...]
// Headless; takes no GPU lock itself (wrap it). Presses only Shift+G and R: nothing is sent or saved.
// Stage F1-no-freeze: also every long task of the page's main thread (PerformanceObserver 'longtask') from Shift+G to the
// course, the longest time the shown walls/course text did not change while a build ran (maxSilentS), the longest time the
// page did not answer the probe (maxReadGapS), and where the walls were built (hook walls.lastBake.where).
// PROFILE=1: a CDP CPU profile of the main thread over the same time; every busy run of 300 ms or more with its functions.
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { pickBrowser } from '../src/chrome.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [base, outFile, shots, idsArg] = process.argv.slice(2);
if (!base || !outFile || !shots || !idsArg) { console.error('usage: course-path-probe.mjs <base with /en> <out.json> <shots dir> <id>[,...]'); process.exit(2); }
const NAMES = { '70b50d42': 'wroclaw', '887f27aa': 'tunis', ab5efa0e: 'forest' };
const LIMIT_MS = 900_000;
// F1-no-freeze: a scan without walls cannot load the bot scenario (test-modes.ts needs collision): NOBOT=1 leaves it out
// (the scripted pilot then sets the craft alone; the bot only held it in a hover)
const BOT = process.env.NOBOT ? '' : '&simradio=scenario';
const pick = pickBrowser({ expected: chromium.executablePath() });
const browser = await chromium.launch({ ...pick.launch, headless: true });

const LONGTASKS = () => {
    window.__lt = [];
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true }); } catch { /* no longtask API */ }
};

const READ = () => {
    const g = window.__gsfpv || {};
    const w = g.walls, c = g.course;
    const q = (s) => { const e = document.querySelector(s); return e ? (e.textContent || '').trim().slice(0, 240) : null; };
    const note = document.querySelector('.hud-note');
    return {
        status: g.status, wallsState: w ? w.state : null, wallsProgress: w ? w.progress : null,
        courseProgress: c ? (c.progress ?? null) : null, gates: c ? c.gates : 0, drawn: c ? c.drawn : 0, next: c ? c.next : -1,
        problem: c ? c.problem : null, box: q('[data-testid=bake-status]'), clock: c && c.clockText ? c.clockText() : null,
        note: note && !note.hidden ? (note.textContent || '').trim().slice(0, 240) : null
    };
};

// installed once per page: the scripted pilot (window.__cp). Modes: 'idle' (bot hovers, nothing set), 'line' (A -> B at v),
// 'hold' (stay at P), 'free' (nothing set: the flight model flies on).
const INSTALL = () => {
    const h = window.__gsfpv, s = h.session, sc = h.scenario;
    const cp = window.__cp = { mode: 'idle', a: null, b: null, t0: 0, v: 8, p: null, q: [1, 0, 0, 0], ticks: 0, crashTick: null, crashAt: null, life: null, lifeTick: null, lifeAt: null, crashes: 0 };
    const hover = s.director.hoverStick;
    if (sc && sc.bot) {
        const orig = sc.bot.update.bind(sc.bot);
        sc.bot.update = (sim) => { const ch = orig(sim); ch[4] = 1; ch[0] = 0; ch[1] = 0; ch[3] = 0; ch[2] = hover * 2 - 1; return ch; };
    }
    const setQ = (st) => { st[6] = cp.q[0]; st[7] = cp.q[1]; st[8] = cp.q[2]; st[9] = cp.q[3]; };
    const prev = s.runner.onStep;
    s.runner.onStep = (sim) => {
        prev?.(sim);
        const st = sim.s;
        if (cp.mode === 'line') {
            const L = Math.hypot(cp.b[0] - cp.a[0], cp.b[1] - cp.a[1], cp.b[2] - cp.a[2]);
            const f = Math.min(1, ((sim.tick - cp.t0) / 1000) * cp.v / L);
            const d = [(cp.b[0] - cp.a[0]) / L, (cp.b[1] - cp.a[1]) / L, (cp.b[2] - cp.a[2]) / L];
            for (let i = 0; i < 3; i++) { st[i] = cp.a[i] + (cp.b[i] - cp.a[i]) * f; st[3 + i] = d[i] * cp.v; }
            st[49] = 0; setQ(st);
            if (f >= 1) { cp.mode = 'hold'; cp.p = cp.b.slice(); }
        } else if (cp.mode === 'hold') {
            for (let i = 0; i < 3; i++) { st[i] = cp.p[i]; st[3 + i] = 0; }
            st[49] = 0; setQ(st);
        }
        cp.ticks++;
    };
    const ev = s.onEvent;
    s.onEvent = (e) => { if (e.type === 'crash') { cp.crashes++; if (cp.crashTick === null && cp.mode === 'free') { cp.crashTick = e.tick; cp.crashAt = [s.sim.s[0], s.sim.s[1], s.sim.s[2]]; } } ev?.(e); };
    const lf = s.onLife;
    s.onLife = (life) => { if (cp.crashTick !== null && cp.lifeTick === null) { cp.lifeTick = s.sim.tick; cp.life = life.header.life.reason; setTimeout(() => { cp.lifeAt = [s.sim.s[0], s.sim.s[1], s.sim.s[2]]; }, 0); } lf?.(life); };
    return { hover, bot: !!(sc && sc.bot) };
};

// top-down picture of the walls around the gates and every gate's height above the ground under it
const TOPDOWN = () => {
    const h = window.__gsfpv, col = h.session.collision, poses = h.course.gatePoses();
    if (!col || !poses.length) return { err: col ? 'no gates' : 'no walls' };
    const xs = poses.map((p) => p.pos[0]), zs = poses.map((p) => p.pos[2]), ys = poses.map((p) => p.pos[1]);
    const m = 60;
    const x0 = Math.min(...xs) - m, x1 = Math.max(...xs) + m, z0 = Math.min(...zs) - m, z1 = Math.max(...zs) + m;
    const step = Math.max(0.5, Math.max(x1 - x0, z1 - z0) / 900);
    const W = Math.ceil((x1 - x0) / step), H = Math.ceil((z1 - z0) / step);
    const yLo = Math.min(...ys) - 15, yHi = Math.max(...ys) + 15;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d'); const img = g.createImageData(W, H);
    let maxN = 1; const cnt = new Uint16Array(W * H);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
        const x = x0 + (i + 0.5) * step, z = z0 + (j + 0.5) * step;
        let n = 0; for (let y = yLo; y <= yHi; y += 0.5) if (!col.isFreeAt(x, y, z)) n++;
        cnt[j * W + i] = n; if (n > maxN) maxN = n;
    }
    for (let k = 0; k < W * H; k++) { const v = cnt[k] ? 60 + Math.round(170 * Math.min(1, cnt[k] / (maxN * 0.5))) : 12; img.data[k * 4] = v; img.data[k * 4 + 1] = v; img.data[k * 4 + 2] = v; img.data[k * 4 + 3] = 255; }
    g.putImageData(img, 0, 0);
    const px = (p) => [(p[0] - x0) / step, (p[2] - z0) / step];
    const heights = poses.map((p) => { const r = col.queryRay(p.pos[0], p.pos[1], p.pos[2], 0, -1, 0, 80); return r ? +(p.pos[1] - r.y).toFixed(2) : null; });
    g.strokeStyle = 'rgba(80,200,255,0.9)'; g.lineWidth = 2; g.beginPath();
    poses.forEach((p, k) => { const [a, b] = px(p.pos); if (k) g.lineTo(a, b); else g.moveTo(a, b); }); g.closePath(); g.stroke();
    poses.forEach((p, k) => {
        const [a, b] = px(p.pos); const hh = heights[k];
        g.fillStyle = hh === null ? '#f0f' : hh <= 4 ? '#3f3' : hh <= 8 ? '#fc3' : '#f33';
        g.beginPath(); g.arc(a, b, 6, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#fff'; g.font = 'bold 13px sans-serif'; g.fillText(String(k + 1), a + 8, b - 6);
    });
    g.fillStyle = '#fff'; g.font = '13px sans-serif';
    g.fillText(`${(x1 - x0).toFixed(0)} x ${(z1 - z0).toFixed(0)} m, ${step.toFixed(2)} m/px; green <= 4 m above ground, yellow <= 8, red higher`, 8, H - 10);
    let span = 0; for (const a of poses) for (const b of poses) span = Math.max(span, Math.hypot(a.pos[0] - b.pos[0], a.pos[2] - b.pos[2]));
    return { url: cv.toDataURL('image/png'), W, H, step, heights, spanM: +span.toFixed(1), yRange: [Math.min(...ys), Math.max(...ys)] };
};

const rot = (q, v) => { // q = [w, x, y, z]
    const [w, x, y, z] = q; const [vx, vy, vz] = v;
    const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
    return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
};
const clockMs = (txt) => { const m = /(\d+):(\d{2})(?:[.,](\d+))?/.exec(txt || ''); return m ? (Number(m[1]) * 60 + Number(m[2])) * 1000 + (m[3] ? Number(m[3].padEnd(3, '0').slice(0, 3)) : 0) : null; };

// runs of busy samples (anything but '(idle)', gaps under 10 ms) of at least 300 ms in a CDP profile, each with the
// functions that held it: self time and inclusive time (a function counted once per sample); seconds from Profiler.start
const busyRuns = (p) => {
    const byId = new Map(p.nodes.map((n) => [n.id, n]));
    const parent = new Map();
    for (const n of p.nodes) for (const c of n.children || []) parent.set(c, n.id);
    const label = (n) => { const f = n.callFrame; return `${f.functionName || '(anon)'}@${(f.url || '').split('/').pop()}:${f.lineNumber + 1}:${f.columnNumber + 1}`; };
    const runs = []; let cur = null, t = p.startTime;
    for (let i = 0; i < p.samples.length; i++) {
        t += p.timeDeltas[i] || 0;
        const n = byId.get(p.samples[i]);
        if (n.callFrame.functionName === '(idle)') { if (cur && t - cur.end > 10000) { runs.push(cur); cur = null; } continue; }
        if (!cur || t - cur.end > 10000) { if (cur) runs.push(cur); cur = { start: t, end: t, self: new Map(), incl: new Map(), n: 0 }; }
        cur.end = t; cur.n++;
        cur.self.set(label(n), (cur.self.get(label(n)) || 0) + 1);
        const seen = new Set();
        for (let id = n.id; id !== undefined; id = parent.get(id)) { const l = label(byId.get(id)); if (!seen.has(l)) { seen.add(l); cur.incl.set(l, (cur.incl.get(l) || 0) + 1); } }
    }
    if (cur) runs.push(cur);
    const top = (m, n) => [...m].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => [k, Math.round((v / n) * 100)]);
    return runs.filter((r) => r.end - r.start >= 300000).map((r) => ({ atS: +((r.start - p.startTime) / 1e6).toFixed(1), ms: Math.round((r.end - r.start) / 1000), samples: r.n, selfPct: top(r.self, r.n), inclPct: top(r.incl, r.n) }));
};

const out = [];
for (const id of idsArg.split(',')) {
    const name = NAMES[id] || id;
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    const r = { id, errors: [], lines: [] };
    await page.addInitScript(LONGTASKS);
    page.on('pageerror', (e) => r.errors.push(String(e.message).slice(0, 160)));
    const ev = (f, a) => page.evaluate(f, a);
    const until = async (f, ok, ms, every = 500) => { const t = Date.now(); for (;;) { const v = await ev(f); if (ok(v) || Date.now() - t > ms) return v; await page.waitForTimeout(every); } };
    try {
        await page.goto(`${base}/fly/?scene=${id}&nowarn=1&set.input.howToFly=false${BOT}&set.respawn.auto=1&set.respawn.target=rewind&set.crash.enabled=1`, { waitUntil: 'load', timeout: 120000 });
        await page.waitForFunction(() => ['ready', 'error'].includes(window.__gsfpv && window.__gsfpv.status), null, { timeout: 300000 });
        await page.waitForFunction(() => { const w = window.__gsfpv && window.__gsfpv.walls; return w && w.state !== 'checking'; }, null, { timeout: 60000 }).catch(() => 0);
        await page.waitForTimeout(2000);
        const x = page.locator('.screen.radio [data-action=radio-close]');
        if (await x.count()) { await x.first().click(); await page.waitForTimeout(800); }
        r.pressAtMs = await ev(() => performance.now());
        // PROFILE=1: a CPU profile of the page's main thread from Shift+G to the course (CDP Profiler, 2 ms samples)
        const cdp = process.env.PROFILE ? await ctx.newCDPSession(page) : null;
        if (cdp) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 2000 }); await cdp.send('Profiler.start'); }
        const t0 = Date.now();
        await page.keyboard.press('Shift+KeyG');
        let lastShown = null, lastChange = 0, lastRead = 0;
        r.maxSilentS = 0; r.maxReadGapS = 0;
        for (;;) {
            const s = await ev(READ);
            const at = +((Date.now() - t0) / 1000).toFixed(1);
            r.maxReadGapS = Math.max(r.maxReadGapS, +(at - lastRead).toFixed(1)); lastRead = at;
            if (s.wallsProgress || s.courseProgress) {
                const shown = `${s.box ?? ''}|${s.note ?? ''}`;
                if (lastShown === null || shown !== lastShown) { if (lastShown !== null) r.maxSilentS = Math.max(r.maxSilentS, +(at - lastChange).toFixed(1)); lastShown = shown; lastChange = at; }
                else r.maxSilentS = Math.max(r.maxSilentS, +(at - lastChange).toFixed(1));
            } else lastShown = null;
            for (const k of ['wallsProgress', 'box', 'courseProgress', 'note']) if (s[k] && !r.lines.some((l) => l.k === k && l.text === s[k] && l === r.lines.findLast((m) => m.k === k))) r.lines.push({ at, k, text: s[k] });
            if (s.gates > 0 && s.drawn > 0) { r.courseAtS = at; break; }
            if (s.problem && !s.wallsProgress && !s.courseProgress && at > 5 && !s.gates) { r.problem = s.problem; break; }
            if (Date.now() - t0 > LIMIT_MS) { r.fail = 'timeout'; break; }
            await page.waitForTimeout(500);
        }
        r.bake = await ev(() => { const w = window.__gsfpv.walls; return w && w.lastBake ? JSON.parse(JSON.stringify(w.lastBake)) : null; });
        const lt = await ev((from) => (window.__lt || []).filter((e) => e[0] >= from), r.pressAtMs);
        r.longtasks = { n: lt.length, sumMs: Math.round(lt.reduce((a, e) => a + e[1], 0)), maxMs: Math.round(Math.max(0, ...lt.map((e) => e[1]))),
            top: lt.slice().sort((a, b) => b[1] - a[1]).slice(0, 8).map((e) => ({ atS: +((e[0] - r.pressAtMs) / 1000).toFixed(1), ms: Math.round(e[1]) })) };
        if (cdp) { const { profile } = await cdp.send('Profiler.stop'); r.profile = busyRuns(profile); }
        if (r.courseAtS === undefined) throw new Error(r.problem || r.fail || 'no course');
        await page.waitForTimeout(3500); // the arrival warning and the gates' delay
        // the scripted pilot goes in after the walls: a walls swap (session.rebuildSim) makes a new runner, and a hook set
        // on the old one before Shift+G never ran (F1 run of 02:08: no pass, no crash)
        r.install = await ev(INSTALL);
        const poses = await ev(() => window.__gsfpv.course.gatePoses());
        r.gates = poses.length;
        const top = await ev(TOPDOWN);
        if (top.url) { writeFileSync(`${shots}/course3-${name}-top.png`, Buffer.from(top.url.split(',')[1], 'base64')); delete top.url; }
        r.top = top;
        // pilot's view: 6 m in front of gate 1 on its +Z side, looking through it (two yaw guesses, the right one is chosen by eye)
        const g0 = poses[0];
        const zAx = rot(g0.quat, [0, 0, 1]);
        const eye = [g0.pos[0] + zAx[0] * 6, g0.pos[1] + zAx[1] * 6, g0.pos[2] + zAx[2] * 6];
        const flip = (q) => [-q[2], q[3], q[0], -q[1]]; // q * (0, 1, 0, 0): yaw by 180 degrees about the gate's own Y
        for (const [tag, q] of [['pilot', g0.quat], ['pilot-b', flip(g0.quat)]]) {
            await ev(([p, qq]) => { const cp = window.__cp; cp.p = p; cp.q = qq; cp.mode = 'hold'; }, [eye, q]);
            await page.waitForTimeout(1500);
            await page.screenshot({ path: `${shots}/course3-${name}-${tag}.png` });
        }
        // through gates 1..3
        r.passes = [];
        for (let k = 0; k < Math.min(3, poses.length - 1); k++) {
            const g = poses[k], z = rot(g.quat, [0, 0, 1]);
            const a = [g.pos[0] + z[0] * 4, g.pos[1] + z[1] * 4, g.pos[2] + z[2] * 4], b = [g.pos[0] - z[0] * 3, g.pos[1] - z[1] * 3, g.pos[2] - z[2] * 3];
            await ev(([aa, bb]) => { const cp = window.__cp, s = window.__gsfpv.session; cp.a = aa; cp.b = bb; cp.t0 = s.sim.tick; cp.v = 8; cp.mode = 'line'; }, [a, b]);
            const s = await until(() => ({ mode: window.__cp.mode, next: window.__gsfpv.course.next, clock: window.__gsfpv.course.clockText() }), (v) => v.mode === 'hold', 10000, 100);
            r.passes.push({ gate: k + 1, next: s.next, clock: s.clock });
        }
        await page.waitForTimeout(6000); // hover past the rewind length so the respawn comes back here
        const before = await ev(READ);
        r.beforeCrash = { next: before.next, clock: before.clock, clockMs: clockMs(before.clock) };
        r.aim = await ev(() => {
            const s = window.__gsfpv.session, col = s.collision, cp = window.__cp; const p = cp.p;
            let best = null;
            for (let k = 0; k < 24; k++) { const a = (k / 24) * Math.PI * 2; const d = [Math.cos(a), -0.05, Math.sin(a)]; const L = Math.hypot(...d);
                const hit = col.queryRay(p[0], p[1], p[2], d[0] / L, d[1] / L, d[2] / L, 25);
                if (hit) { const m = Math.hypot(hit.x - p[0], hit.y - p[1], hit.z - p[2]); if (m > 2 && (!best || m < best.m)) best = { m, d: [d[0] / L, d[1] / L, d[2] / L] }; } }
            if (!best) return null;
            const st = s.sim.s; for (let i = 0; i < 3; i++) st[3 + i] = best.d[i] * 12; cp.mode = 'free';
            return { wallM: +best.m.toFixed(1) };
        });
        if (!r.aim) throw new Error('no wall within 25 m of gate 3');
        const life = await until(() => { const cp = window.__cp; return { crashTick: cp.crashTick, lifeTick: cp.lifeTick }; }, (v) => v.lifeTick !== null, 20000, 100);
        r.crash = await ev(() => { const cp = window.__cp, s = window.__gsfpv.session; return { crashTick: cp.crashTick, lifeTick: cp.lifeTick, reason: cp.life, decision: s.director.last, crashAt: cp.crashAt, lifeAt: cp.lifeAt, crashes: cp.crashes }; });
        if (life.lifeTick !== null) {
            await ev(() => { window.__cp.mode = 'idle'; });
            const a1 = await ev(READ); await page.waitForTimeout(2000); const a2 = await ev(READ);
            r.afterRespawn = [{ next: a1.next, clock: a1.clock, clockMs: clockMs(a1.clock) }, { next: a2.next, clock: a2.clock, clockMs: clockMs(a2.clock) }];
            if (r.crash.crashAt && r.crash.lifeAt) r.crash.backM = +Math.hypot(...r.crash.crashAt.map((v, i) => v - r.crash.lifeAt[i])).toFixed(1);
            await page.screenshot({ path: `${shots}/course3-${name}-respawn.png` });
        }
        await page.keyboard.press('KeyR');
        await page.waitForTimeout(1500);
        const ar = await ev(READ);
        r.afterR = { next: ar.next, clock: ar.clock, clockMs: clockMs(ar.clock) };
        await page.screenshot({ path: `${shots}/course3-${name}-after-r.png` });
    } catch (e) { r.fail = String(e).slice(0, 240); }
    out.push(r);
    writeFileSync(outFile, JSON.stringify(out, null, 1));
    await ctx.close();
}
await browser.close();
for (const r of out) console.log(JSON.stringify({ id: r.id, courseAtS: r.courseAtS, where: r.bake?.where, bakeS: r.bake?.ms ? Math.round(r.bake.ms.total / 1000) : null, tried: r.bake?.tried, maxSilentS: r.maxSilentS, maxReadGapS: r.maxReadGapS, longMaxMs: r.longtasks?.maxMs, longN: r.longtasks?.n, busy: r.profile?.map((x) => [x.atS, x.ms]), lines: r.lines.length, gates: r.gates, heights: r.top?.heights, passes: r.passes, before: r.beforeCrash, crash: r.crash && { reason: r.crash.reason, kind: r.crash.decision?.kind, backM: r.crash.backM }, after: r.afterRespawn, afterR: r.afterR, errors: r.errors.length, fail: r.fail }));
