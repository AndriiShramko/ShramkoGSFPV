// Lane course4, stage C4-elements: a Shift+G course of competition elements (rings, squares, cube frames, tunnels of 3-5
// gates, a square lying flat) in the page, on a local release. Per scan: Shift+G once and wait for the course; every gate's
// shape and axis read from the page (hook course.gatePoses); the elements found from them (a tunnel: 3 or more gates in a
// row, parallel axes, centres under 1.6 m x the scan measure apart; flat: the pass axis within 25 deg of vertical; cube:
// shape cube-frame); pictures from a pilot's place (a tunnel from before its first gate, a flat square from the gate before
// it); then the scripted pilot (window.__cp, the same as course-path-probe.mjs: it SETS the craft's place each physics step,
// it is not a keyboard pilot) passes every gate in order along the gate's own axis and back through gate 1 on a closed
// course; after each pass the page's next gate, finished laps and clock are read.
//   node tools/bench/scripts/course-elements-probe.mjs http://localhost:5780/en <out.json> <shots dir> <id>[:<name>][,...]
// Headless; takes no GPU lock itself (wrap it). Presses only Shift+G: nothing is sent or saved.
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { pickBrowser } from '../src/chrome.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [base, outFile, shots, idsArg] = process.argv.slice(2);
if (!base || !outFile || !shots || !idsArg) { console.error('usage: course-elements-probe.mjs <base with /en> <out.json> <shots dir> <id>[:name][,...]'); process.exit(2); }
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

const rot = (q, v) => { // q = [w, x, y, z]
    const [w, x, y, z] = q; const [vx, vy, vz] = v;
    const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
    return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
};
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const along = (p, d, k) => [p[0] + d[0] * k, p[1] + d[1] * k, p[2] + d[2] * k];
// a yaw-only craft rotation looking along the horizontal part of d (the craft looks along its -Z)
const yawTo = (d) => { const t = Math.atan2(-d[0], -d[2]); return [Math.cos(t / 2), 0, Math.sin(t / 2), 0]; };
const r2 = (v) => Math.round(v * 100) / 100;

/** elements from the gates: tunnels, flat squares, cubes, squares, rings (index ranges) */
function elementsOf(poses) {
    const ax = poses.map((p) => rot(p.quat, [0, 0, 1]));
    const out = [];
    let i = 0;
    while (i < poses.length) {
        let j = i;
        while (j + 1 < poses.length && poses[j + 1].shape.kind === poses[i].shape.kind && Math.abs(dot(ax[j], ax[j + 1])) > 0.98 && len(sub(poses[j + 1].pos, poses[j].pos)) < 1.6 * UNIT) j++;
        if (j - i + 1 >= 3) { out.push({ kind: 'tunnel', from: i, to: j, shape: poses[i].shape.kind }); i = j + 1; continue; }
        const kind = Math.abs(ax[i][1]) > Math.cos((25 * Math.PI) / 180) ? 'flat' : poses[i].shape.kind === 'cube-frame' ? 'cube' : poses[i].shape.kind;
        out.push({ kind, from: i, to: i, shape: poses[i].shape.kind });
        i++;
    }
    return out;
}
let UNIT = 1;

const until = async (page, f, ok, ms, every = 250) => { const t = Date.now(); let v; do { v = await page.evaluate(f); if (ok(v)) return v; await page.waitForTimeout(every); } while (Date.now() - t < ms); return v; };

const out = [];
for (const item of idsArg.split(',')) {
    const [id, name0] = item.split(':');
    const name = name0 || id;
    const ctx = await browser.newContext({ viewport: { width: Number(process.env.VW || 1280), height: Number(process.env.VH || 720) } });
    const page = await ctx.newPage();
    const r = { id, name, errors: [] };
    page.on('pageerror', (e) => r.errors.push(String(e.message).slice(0, 160)));
    const ev = (f, a) => page.evaluate(f, a);
    try {
        await page.goto(`${base}/fly/?scene=${id}&nowarn=1&set.input.howToFly=false&simradio=scenario&set.crash.enabled=0`, { waitUntil: 'load', timeout: 120000 });
        await page.waitForFunction(() => ['ready', 'error'].includes(window.__gsfpv && window.__gsfpv.status), null, { timeout: 300000 });
        await page.waitForFunction(() => { const w = window.__gsfpv && window.__gsfpv.walls; return w && w.state !== 'checking'; }, null, { timeout: 60000 }).catch(() => 0);
        await page.waitForTimeout(2000);
        const x = page.locator('.screen.radio [data-action=radio-close]');
        if (await x.count()) { await x.first().click(); await page.waitForTimeout(800); }
        const t0 = Date.now();
        await page.keyboard.press('Shift+KeyG');
        const c = await until(page, () => { const c = window.__gsfpv.course; return { gates: c.gates, drawn: c.drawn, problem: c.problem, seed: c.seed }; }, (v) => (v.gates > 0 && v.drawn > 0), 420000, 500);
        r.courseS = r2((Date.now() - t0) / 1000);
        r.seed = c.seed;
        if (!(c.gates > 0)) throw new Error('no course: ' + c.problem);
        await page.waitForTimeout(3500);
        r.install = await ev(INSTALL);
        UNIT = await ev(() => (window.__gsfpv.session.transform ? window.__gsfpv.session.transform.s : 1)) || 1;
        r.unit = UNIT;
        const poses = await ev(() => window.__gsfpv.course.gatePoses());
        r.gates = poses.length;
        r.shapes = poses.map((p) => p.shape.kind);
        r.elements = elementsOf(poses);
        r.counts = r.elements.reduce((m, e) => ((m[e.kind] = (m[e.kind] ?? 0) + 1), m), {});
        const ax = poses.map((p) => rot(p.quat, [0, 0, 1]));
        const hold = async (from, to, q, tag) => {
            await ev(([a, b, qq]) => { const cp = window.__cp, s = window.__gsfpv.session; cp.q = qq; cp.a = a; cp.b = b; cp.t0 = s.sim.tick; cp.v = 4; cp.mode = 'line'; }, [from, to, q]);
            await until(page, () => window.__cp.mode, (m) => m === 'hold', 8000, 100);
            await page.waitForTimeout(1500);
            await page.screenshot({ path: `${shots}/${tag}.png` });
            r.shots = [...(r.shots ?? []), tag];
        };
        // pictures: a tunnel from before its first gate; a flat square from the gate before it; one view of the course
        const tun = r.elements.find((e) => e.kind === 'tunnel');
        if (tun) {
            const g = poses[tun.from], z = ax[tun.from];
            const eye = along(g.pos, z, 4 * UNIT);
            await hold(along(eye, z, 0.5), eye, yawTo([-z[0], 0, -z[2]]), `course4-elements-tunnel-${name}`);
        }
        const fl = r.elements.find((e) => e.kind === 'flat' && e.from > 0);
        if (fl) {
            const p = poses[fl.from - 1].pos, f = poses[fl.from].pos;
            const d = sub(f, p); const h = Math.hypot(d[0], d[2]) || 1;
            const eye = [f[0] - (d[0] / h) * 5 * UNIT, p[1], f[2] - (d[2] / h) * 5 * UNIT];
            await hold([eye[0], eye[1] + 0.3, eye[2]], eye, yawTo(d), `course4-elements-flat-${name}`);
        }
        {
            const g = poses[1 % poses.length], z = ax[1 % poses.length];
            const eye = along(g.pos, z, 5 * UNIT);
            await hold(along(eye, z, 0.5), eye, yawTo([-z[0], 0, -z[2]]), `course4-elements-view-${name}`);
        }
        // every gate in order, along its own axis (+Z side to -Z side, as course-path-probe.mjs), then gate 1 again
        r.passes = [];
        const closed = await ev(() => { const c = window.__gsfpv.course; return c.track ? c.track.laps > 1 || c.track.closed === true : null; });
        r.closedHint = closed;
        const order = [...poses.keys(), 0];
        let at = await ev(() => { const s = window.__gsfpv.session.sim.s; return [s[0], s[1], s[2]]; });
        for (let n = 0; n < order.length; n++) {
            const k = order[n];
            const g = poses[k], z = ax[k];
            const near = Math.min(...[k - 1, k + 1].filter((m) => m >= 0 && m < poses.length).map((m) => len(sub(poses[m].pos, g.pos))), 4 * UNIT);
            const dA = Math.min(1.5 * UNIT, 0.45 * near);
            const a = along(g.pos, z, dA), b = along(g.pos, z, -dA);
            const q = yawTo([-z[0], 0, -z[2]]);
            const before = await ev(() => window.__gsfpv.course.next);
            await ev(([p0, p1, qq]) => { const cp = window.__cp, s = window.__gsfpv.session; cp.q = qq; cp.a = p0; cp.b = p1; cp.t0 = s.sim.tick; cp.v = 10; cp.mode = 'line'; }, [at, a, q]);
            await until(page, () => window.__cp.mode, (m) => m === 'hold', 20000, 50);
            await ev(([p0, p1, qq]) => { const cp = window.__cp, s = window.__gsfpv.session; cp.q = qq; cp.a = p0; cp.b = p1; cp.t0 = s.sim.tick; cp.v = 5; cp.mode = 'line'; }, [a, b, q]);
            await until(page, () => window.__cp.mode, (m) => m === 'hold', 10000, 50);
            await page.waitForTimeout(150);
            const s = await ev(() => { const c = window.__gsfpv.course; return { next: c.next, laps: c.laps, last: c.lastLapMs, clock: c.clockText ? c.clockText() : null }; });
            r.passes.push({ gate: k + 1, shape: g.shape.kind, flat: Math.abs(z[1]) > 0.9, before, after: s.next, laps: s.laps, last: s.last, clock: (s.clock || '').slice(0, 60) });
            at = b;
        }
        r.counted = r.passes.filter((p, n) => n < poses.length && p.after !== p.before).length;
        r.crashes = await ev(() => window.__cp.crashes);
        r.end = r.passes[r.passes.length - 1];
    } catch (e) { r.fail = String(e).slice(0, 240); }
    out.push(r);
    writeFileSync(outFile, JSON.stringify(out, null, 1));
    await ctx.close();
}
await browser.close();
for (const r of out) console.log(JSON.stringify({ id: r.id, courseS: r.courseS, seed: r.seed, unit: r.unit, gates: r.gates, counts: r.counts, counted: r.counted, end: r.end, crashes: r.crashes, shots: r.shots, errors: r.errors.length, fail: r.fail }));
const bad = out.filter((r) => r.fail || r.counted !== r.gates).length;
console.log(`runs ${out.length}, every gate counted in ${out.length - bad}`);
process.exit(bad ? 1 : 0);
