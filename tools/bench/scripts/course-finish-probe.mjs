// Lane course4, review CU-6: S1 to S6 of the course in the page, on a local release. Per scan: Shift+G (with SCALE set, the
// Scene size is set first; when the page answers with a 'no course' line, Shift+G is pressed once more, as the line says);
// the start gate's marks (hook course.look), the line before the clock runs and the guide; pictures of the start gate from
// both sides; the banner's size on screen from 60 m (its corners projected through the flight camera); then the scripted
// pilot of course-elements-probe.mjs (it SETS the craft's place each physics step; not a keyboard pilot) flies LAPS laps
// through every gate; at each lap end the splash or card is read (hook course.splash, the element's rects, its font size,
// the clock text) with the view set to the next size of SIZES; a picture of the next gate in lap 2.
//   node tools/bench/scripts/course-finish-probe.mjs http://localhost:5780/en <out.json> <shots dir> <id>[:<name>]
//   env SIZES=1920x1080,1280x720,844x390 (one per lap, the last one repeats), LAPS=3, SCALE=20, OFF=1 (lapSplash off)
// Headless; takes no GPU lock itself (wrap it). Presses only Shift+G: nothing is sent or saved.
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { pickBrowser } from '../src/chrome.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [base, outFile, shots, idArg] = process.argv.slice(2);
if (!base || !outFile || !shots || !idArg) { console.error('usage: course-finish-probe.mjs <base with /en> <out.json> <shots dir> <id>[:name]'); process.exit(2); }
const SIZES = (process.env.SIZES || '1920x1080').split(',').map((s) => { const [w, h] = s.split('x').map(Number); return { width: w, height: h }; });
const LAPS = Number(process.env.LAPS || 3);
const SCALE = process.env.SCALE ? Number(process.env.SCALE) : null;
const OFF = process.env.OFF === '1';
const pick = pickBrowser({ expected: chromium.executablePath() });
const browser = await chromium.launch({ ...pick.launch, headless: true });

const INSTALL = () => {
    const h = window.__gsfpv, s = h.session, sc = h.scenario;
    const cp = window.__cp = { mode: 'idle', a: null, b: null, t0: 0, v: 8, p: null, q: [1, 0, 0, 0], crashes: 0 };
    const hover = s.director.hoverStick;
    if (sc && sc.bot) {
        const orig = sc.bot.update.bind(sc.bot);
        sc.bot.update = (sim) => { const ch = orig(sim); ch[4] = 1; ch[0] = 0; ch[1] = 0; ch[3] = 0; ch[2] = hover * 2 - 1; return ch; };
    }
    const setQ = (st) => { st[6] = cp.q[0]; st[7] = cp.q[1]; st[8] = cp.q[2]; st[9] = cp.q[3]; if (st[35] === 0) st[34] = 1; };
    const prev = s.runner.onStep;
    s.runner.onStep = (sim) => {
        prev?.(sim);
        const st = sim.s;
        if (cp.mode === 'line') {
            const L = Math.max(1e-6, Math.hypot(cp.b[0] - cp.a[0], cp.b[1] - cp.a[1], cp.b[2] - cp.a[2]));
            const f = Math.min(1, ((sim.tick - cp.t0) / 1000) * cp.v / L);
            const d = [(cp.b[0] - cp.a[0]) / L, (cp.b[1] - cp.a[1]) / L, (cp.b[2] - cp.a[2]) / L];
            for (let i = 0; i < 3; i++) { st[i] = cp.a[i] + (cp.b[i] - cp.a[i]) * f; st[3 + i] = d[i] * cp.v; }
            st[49] = 0; setQ(st);
            if (f >= 1) { cp.mode = 'hold'; cp.p = cp.b.slice(); }
        } else if (cp.mode === 'hold') {
            for (let i = 0; i < 3; i++) { st[i] = cp.p[i]; st[3 + i] = 0; }
            st[49] = 0; setQ(st);
        }
    };
    const ev = s.onEvent;
    s.onEvent = (e) => { if (e.type === 'crash') cp.crashes++; ev?.(e); };
    return { bot: !!(sc && sc.bot) };
};

/** the banners' and plate's size on screen: corners of each sign's unit box projected through the flight camera */
const SIGNS = () => {
    const s = window.__gsfpv.session;
    let r = null, key = null;
    for (const k of Object.keys(s)) { const v = s[k]; if (v && v.camera && v.camera.camera && v.app) { r = v; key = k; break; } }
    if (!r) return { error: 'no renderer on session' };
    const cam = r.camera.camera;
    const out = [];
    for (const name of ['course-banner', 'course-plate']) {
        for (const e of r.app.root.find((n) => n.name === name)) {
            const V = e.getPosition().constructor;
            const m = e.getWorldTransform();
            const xs = [], ys = [];
            let behind = false;
            for (const [x, y] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) {
                const w = m.transformPoint(new V(x, y, 0), new V());
                const p = cam.worldToScreen(w, new V());
                if (p.z < 0) behind = true;
                xs.push(p.x); ys.push(p.y);
            }
            const c = e.getPosition();
            out.push({ name, pos: [c.x, c.y, c.z], w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), x0: Math.min(...xs), y0: Math.min(...ys), behind });
        }
    }
    const cv = document.querySelector('canvas');
    return { key, signs: out, canvasW: cv ? cv.clientWidth : null, canvasH: cv ? cv.clientHeight : null, W: innerWidth, H: innerHeight };
};

/** the splash or card as the page shows it now */
const SPLASH = () => {
    const c = window.__gsfpv.course;
    const el = document.querySelector('[data-testid=course-splash]');
    const box = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; };
    const t = el ? el.querySelector('.course-splash-time') : null;
    const cs = el ? getComputedStyle(el) : null;
    const laps = el ? [...el.querySelectorAll('.course-card-lap')].map(box) : [];
    return { sp: c.splash(), rect: box(el), time: box(t), fs: t ? parseFloat(getComputedStyle(t).fontSize) : null, color: t ? getComputedStyle(t).color : null, opacity: cs ? cs.opacity : null, display: cs ? cs.display : null, pe: cs ? cs.pointerEvents : null, lapRects: laps, text: el ? el.textContent : null, clock: c.clockText(), last: c.lastLapMs, best: c.bestLapMs, laps: c.laps, W: innerWidth, H: innerHeight };
};

const rot = (q, v) => { // q = [w, x, y, z]
    const [w, x, y, z] = q; const [vx, vy, vz] = v;
    const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
    return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
};
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const along = (p, d, k) => [p[0] + d[0] * k, p[1] + d[1] * k, p[2] + d[2] * k];
const yawTo = (d) => { const t = Math.atan2(-d[0], -d[2]); return [Math.cos(t / 2), 0, Math.sin(t / 2), 0]; };
const r2 = (v) => Math.round(v * 100) / 100;
const until = async (page, f, ok, ms, every = 250) => { const t = Date.now(); let v; do { v = await page.evaluate(f); if (ok(v)) return v; await page.waitForTimeout(every); } while (Date.now() - t < ms); return v; };
const fmt = (ms) => { const s = ms / 1000; const m = Math.floor(s / 60); const r = (s - m * 60).toFixed(2); return `${m}:${r.padStart(5, '0')}`; };

const [id, name0] = idArg.split(':');
const name = name0 || id;
const ctx = await browser.newContext({ viewport: SIZES[0] });
const page = await ctx.newPage();
const r = { id, name, sizes: SIZES, laps: LAPS, scale: SCALE, off: OFF, errors: [], checks: {} };
page.on('pageerror', (e) => r.errors.push(String(e.message).slice(0, 160)));
const ev = (f, a) => page.evaluate(f, a);
const shot = async (tag) => { await page.screenshot({ path: `${shots}/${tag}.png` }); (r.shots ??= []).push(tag); };
try {
    await page.goto(`${base}/fly/?scene=${id}&nowarn=1&set.input.howToFly=false&simradio=scenario&set.crash.enabled=0${OFF ? '&set.course.lapSplash=off' : ''}`, { waitUntil: 'load', timeout: 120000 });
    await page.waitForFunction(() => ['ready', 'error'].includes(window.__gsfpv && window.__gsfpv.status), null, { timeout: 300000 });
    await page.waitForFunction(() => { const w = window.__gsfpv && window.__gsfpv.walls; return w && w.state !== 'checking'; }, null, { timeout: 60000 }).catch(() => 0);
    await page.waitForTimeout(2000);
    const x = page.locator('.screen.radio [data-action=radio-close]');
    if (await x.count()) { await x.first().click(); await page.waitForTimeout(800); }
    if (SCALE) {
        await ev((s) => window.__gsfpv.scale.set(s), SCALE);
        r.sizeSet = await until(page, () => ({ size: window.__gsfpv.scale.size(), pending: window.__gsfpv.scale.pending() }), (v) => v.pending === 1, 60000, 500);
        await page.waitForTimeout(3000);
    }
    const want = () => { const c = window.__gsfpv.course; return { gates: c.gates, drawn: c.drawn, problem: c.problem, seed: c.seed, progress: c.progress }; };
    let t0 = Date.now();
    await page.keyboard.press('Shift+KeyG');
    let c = await until(page, want, (v) => (v.gates > 0 && v.drawn > 0) || !!v.problem, 420000, 500);
    r.firstS = r2((Date.now() - t0) / 1000);
    if (!(c.gates > 0)) {
        r.firstProblem = c.problem;
        r.firstLine = await ev(() => document.body.innerText.split('\n').filter((l) => /Scene size|Shift\+G/.test(l)).slice(0, 3));
        t0 = Date.now();
        await page.keyboard.press('Shift+KeyG');
        c = await until(page, want, (v) => v.gates > 0 && v.drawn > 0, 420000, 500);
        r.secondS = r2((Date.now() - t0) / 1000);
        r.sizeAfter = await ev(() => (window.__gsfpv.scale ? window.__gsfpv.scale.size() : null));
    }
    r.seed = c.seed;
    if (!(c.gates > 0)) throw new Error('no course: ' + c.problem);
    await page.waitForTimeout(3500);
    r.install = await ev(INSTALL);
    const UNIT = await ev(() => (window.__gsfpv.session.transform ? window.__gsfpv.session.transform.s : 1)) || 1;
    r.unit = UNIT;
    const poses = await ev(() => window.__gsfpv.course.gatePoses());
    r.gates = poses.length;
    r.shapes = poses.map((p) => p.shape.kind);
    r.closed = await ev(() => { const c = window.__gsfpv.course; return c.track ? c.track.laps : null; });
    r.look = await ev(() => window.__gsfpv.course.look());
    r.before = await ev(() => ({ clock: window.__gsfpv.course.clockText(), guide: window.__gsfpv.course.guide(), next: window.__gsfpv.course.next, laps: window.__gsfpv.course.laps }));
    const ax = poses.map((p) => rot(p.quat, [0, 0, 1]));
    const sx = poses.map((p) => rot(p.quat, [1, 0, 0]));
    const go = async (a, b, q, v = 4) => {
        await ev(([p0, p1, qq, vv]) => { const cp = window.__cp, s = window.__gsfpv.session; cp.q = qq; cp.a = p0; cp.b = p1; cp.t0 = s.sim.tick; cp.v = vv; cp.mode = 'line'; }, [a, b, q, v]);
        await until(page, () => window.__cp.mode, (m) => m === 'hold', 30000, 50);
    };
    // S1: the start gate from the front (the side the pilot comes from), from the back, from 60 m; a side point between
    // them so that no move crosses the gate's opening
    const g0 = poses[0], z0 = ax[0], x0 = sx[0];
    const side = along(along(g0.pos, x0, 12 * UNIT), [0, 1, 0], 4 * UNIT);
    const front = along(g0.pos, z0, 8 * UNIT), back = along(g0.pos, z0, -8 * UNIT);
    await go(along(front, z0, 0.3), front, yawTo([-z0[0], 0, -z0[2]]));
    await page.waitForTimeout(1500);
    await shot(`course4-start-gate-${name}`);
    await go(side, side, yawTo([-z0[0], 0, -z0[2]]));
    await go(along(back, z0, -0.3), back, yawTo(z0));
    await page.waitForTimeout(1500);
    await shot(`course4-start-gate-back-${name}`);
    await go(side, side, yawTo([-z0[0], 0, -z0[2]]));
    const far = along(g0.pos, z0, 60 * UNIT);
    await go(along(far, z0, 0.3), far, yawTo([-z0[0], 0, -z0[2]]));
    await page.waitForTimeout(1500);
    const signs = await ev(SIGNS);
    const near = (s) => len(sub(s.pos, g0.pos));
    r.at60 = signs.signs ? { ...signs, signs: signs.signs.filter((s) => s.name === 'course-banner').sort((a, b) => near(a) - near(b)).slice(0, 1).map((s) => ({ w: r2(s.w), h: r2(s.h), x0: r2(s.x0), y0: r2(s.y0), behind: s.behind })) } : signs;
    await shot(`course4-start-60m-${name}`);
    r.afterPictures = await ev(() => ({ clock: window.__gsfpv.course.clockText(), next: window.__gsfpv.course.next, laps: window.__gsfpv.course.laps }));
    await go(side, side, yawTo([-z0[0], 0, -z0[2]]));
    // laps: gate 1, every gate, ... gate 1 again at each lap end
    const order = [];
    for (let l = 0; l < LAPS; l++) for (let k = 0; k < poses.length; k++) order.push(k);
    order.push(0);
    r.ends = [];
    r.passes = 0;
    let at = side;
    let lap = 0;
    for (let n = 0; n < order.length; n++) {
        const k = order[n];
        const g = poses[k], z = ax[k];
        const nb = Math.min(...[k - 1, k + 1].filter((m) => m >= 0 && m < poses.length).map((m) => len(sub(poses[m].pos, g.pos))), 4 * UNIT);
        const dA = Math.min(1.5 * UNIT, 0.45 * nb);
        const a = along(g.pos, z, dA), b = along(g.pos, z, -dA);
        const q = yawTo([-z[0], 0, -z[2]]);
        const before = await ev(() => window.__gsfpv.course.laps);
        await go(at, a, q, 14);
        await go(a, b, q, 6);
        at = b;
        r.passes++;
        await page.waitForTimeout(120);
        const laps = await ev(() => window.__gsfpv.course.laps);
        if (laps > before) {
            const s = await ev(SPLASH);
            const tag = `${name}-lap${laps}`;
            await shot(`course4-${s.sp.kind === 'card' ? 'finish-card' : 'lap-splash'}-${tag}`);
            const H = s.H;
            const rect = s.rect;
            const shown = s.sp.kind !== 'none' && s.display !== 'none' && rect && rect.h > 0;
            r.ends.push({
                lap: laps, size: `${s.W}x${s.H}`, kind: s.sp.kind, text: s.sp.text, delta: s.sp.delta, tone: s.sp.tone, mode: s.sp.mode, alpha: r2(s.sp.alpha),
                color: s.color, opacity: s.opacity, pointerEvents: s.pe, shown,
                rect: rect && { x: r2(rect.x), y: r2(rect.y), w: r2(rect.w), h: r2(rect.h) },
                centreShare: s.time ? r2((s.time.y + s.time.h / 2) / H) : null, fontShare: s.fs ? r2(s.fs / H) : null,
                middleThirdFree: rect ? rect.y + rect.h <= H / 3 + 0.5 || rect.y >= (2 * H) / 3 : null,
                insideWidth: rect ? rect.x >= -0.5 && rect.x + rect.w <= s.W + 0.5 : null,
                lapsInside: s.lapRects.every((b) => b.x >= -0.5 && b.x + b.w <= s.W + 0.5),
                lastMs: s.last, bestMs: s.best, lastText: s.last != null ? fmt(s.last) : null,
                clockHasIt: !!(s.clock && s.sp.text && s.clock.includes(s.sp.text)), clock: (s.clock || '').slice(0, 120), cardText: s.sp.kind === 'card' ? (s.text || '').slice(0, 200) : undefined,
            });
            lap = laps;
            // fades: the splash is gone after its hold and fade
            if (laps === 1) { await page.waitForTimeout(2200); r.ends[r.ends.length - 1].after2s = await ev(() => { const c = window.__gsfpv.course.splash(); return { kind: c.kind, alpha: Math.round(c.alpha * 100) / 100 }; }); }
            if (lap < LAPS) await page.setViewportSize(SIZES[Math.min(lap, SIZES.length - 1)]);
            if (lap >= LAPS) break;
        }
        // S2: the next gate in lap 2, from the gate just passed
        if (lap === 1 && k === 3 && poses.length > 5 && !r.nextShot) {
            r.nextShot = true;
            const nx = poses[k + 1].pos;
            await go(b, b, yawTo(sub(nx, b)));
            await page.waitForTimeout(1200);
            r.nextLook = await ev(() => ({ next: window.__gsfpv.course.next, plate: window.__gsfpv.course.look().plate }));
            await shot(`course4-next-gate-${name}`);
        }
    }
    r.crashes = await ev(() => window.__cp.crashes);
    if (r.ends.length) { const e = r.ends[r.ends.length - 1]; await page.waitForTimeout(3800); e.after38s = await ev(() => { const c = window.__gsfpv.course.splash(); return { kind: c.kind, alpha: Math.round(c.alpha * 100) / 100 }; }); }
} catch (e) { r.fail = String(e).slice(0, 240); }
writeFileSync(outFile, JSON.stringify(r, null, 1));
await ctx.close();
await browser.close();
console.log(JSON.stringify({ id: r.id, scale: r.scale, firstProblem: r.firstProblem, sizeAfter: r.sizeAfter, seed: r.seed, unit: r.unit, gates: r.gates, laps: r.closed, look: r.look, before: r.before && r.before.clock, at60: r.at60 && r.at60.signs, ends: (r.ends || []).map((e) => [e.lap, e.size, e.kind, e.text, e.delta, e.tone, e.shown, e.centreShare, e.fontShare, e.middleThirdFree, e.insideWidth, e.lapsInside, e.clockHasIt]), crashes: r.crashes, errors: r.errors.length, fail: r.fail }));
process.exit(r.fail || !(r.ends && r.ends.length) ? 1 : 0);
