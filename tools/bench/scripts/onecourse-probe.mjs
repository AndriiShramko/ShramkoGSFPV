// Lane onecourse (train 3, the owner's message 52): one course in the scene and one key that makes it. The owner's path with real
// key events on a local release: Shift+G in the ordinary flight, gates 1 and 2 flown (the scripted pilot of course-path-probe.mjs
// leads the craft through them), Backslash (Fly by Sound in place), then Shift+G and N in the sound mode, Backslash off, and a
// fresh page with no course where Backslash alone is pressed. Per step: what the mode said, the hum's target, the course feature's
// gates and next gate, the gates the sound mode draws itself (stagePrims), and the drawn entities of the course feature.
// Usage: node tools/bench/scripts/onecourse-probe.mjs <base with /en> <out.json> <shots dir> <scene> [tag]
// RENDER=on draws the scan (needs the GPU lock C:/dev/.gpu-lock, taken by the caller); default render=off (no lock).
// Nothing is saved or sent: only keys of the flight page are pressed.
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { pickBrowser } from '../src/chrome.mjs';
import { buildFromDialog, shiftG } from './gen-build.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [base, outFile, shots, scene, tag = 'run'] = process.argv.slice(2);
if (!base || !outFile || !shots || !scene) { console.error('usage: onecourse-probe.mjs <base with /en> <out.json> <shots dir> <scene> [tag]'); process.exit(2); }
const RENDER = process.env.RENDER === 'on';
const pick = pickBrowser({ expected: chromium.executablePath() });
const browser = await chromium.launch({ ...pick.launch, headless: true });

// the scripted pilot of course-path-probe.mjs (window.__cp): 'line' A -> B at v, then 'hold' at B
const INSTALL = () => {
    const h = window.__gsfpv, s = h.session, sc = h.scenario;
    const cp = window.__cp = { mode: 'idle', a: null, b: null, t0: 0, v: 8, p: null, q: [1, 0, 0, 0] };
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
    };
    return { hover, bot: !!(sc && sc.bot) };
};

// the state of both owners of gates: the course feature (window.__gsfpv.course) and the sound mode (window.__gsfpv.sonic())
const READ = () => {
    const g = window.__gsfpv || {};
    const c = g.course;
    let so = null;
    try { so = g.sonic ? g.sonic() : null; } catch { so = null; }
    // stagePrims: the entities the sound mode's own stage draws (its gates and marks), a number
    const prims = so && typeof so.stagePrims === 'number' ? so.stagePrims : 0;
    return {
        course: c ? { on: c.on, source: c.source, seed: c.seed, gates: c.gates, next: c.next, drawn: c.drawn, laps: c.laps, track: c.track, clock: c.clockText ? c.clockText() : null } : null,
        sonic: so ? { lesson: so.lesson ?? null, phase: so.phase ?? null, target: so.target ? (so.target.id ?? JSON.stringify(so.target).slice(0, 80)) : null, lastLine: so.lastLine ?? null, prims, passed: so.passed ?? null } : null,
        note: (() => { const n = document.querySelector('.hud-note'); return n && !n.hidden ? (n.textContent || '').trim().slice(0, 200) : null; })(),
        // integration C seam (d): the guide chip's gate (0-based, course/hud.ts GuideState) beside the hum's target id ('g' + (gate + 1))
        guide: (() => { try { const q = c && c.guide ? c.guide() : null; return q ? { shown: q.shown, gate: q.gate, metres: Math.round(q.metres) } : null; } catch { return null; } })()
    };
};

const rot = (q, v) => { // q = [w, x, y, z]
    const [w, x, y, z] = q; const [vx, vy, vz] = v;
    const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
    return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
};

const out = { base, scene, tag, render: RENDER, steps: [], errors: [] };
const save = () => writeFileSync(outFile, JSON.stringify(out, null, 1));

async function openPage() {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => out.errors.push(String(e.message).slice(0, 160)));
    await page.goto(`${base}/fly/?scene=${scene}&nowarn=1&set.input.howToFly=false&simradio=scenario&set.respawn.auto=1&set.respawn.target=rewind${RENDER ? '' : '&render=off'}`, { waitUntil: 'load', timeout: 120000 });
    await page.waitForFunction(() => ['ready', 'error'].includes(window.__gsfpv && window.__gsfpv.status), null, { timeout: 300000 });
    await page.waitForFunction(() => { const w = window.__gsfpv && window.__gsfpv.walls; return w && w.state !== 'checking'; }, null, { timeout: 60000 }).catch(() => 0);
    await page.waitForTimeout(2000);
    const x = page.locator('.screen.radio [data-action=radio-close]');
    if (await x.count()) { await x.first().click(); await page.waitForTimeout(800); }
    return { ctx, page };
}

// reads every 250 ms for `ms`, gathers the lines the mode said, stops early when `ok` holds
async function watch(page, ms, ok = () => false) {
    const lines = [];
    const t = Date.now();
    let s = null;
    for (;;) {
        s = await page.evaluate(READ);
        const l = s.sonic?.lastLine;
        if (l && lines[lines.length - 1] !== l) lines.push(l);
        // lane mix M1: the course's next gate over time with the craft and the last life decision (why progress changed)
        const tr = await page.evaluate(() => { const g = window.__gsfpv, se = g.session, d = se.director && se.director.last; return { next: g.course ? g.course.next : null, pilot: window.__cp ? window.__cp.mode : null, y: se.runner.sim.s[1], tick: se.runner.sim.tick, life: d ? { kind: d.kind ?? null, tick: d.tick ?? null, sampleTick: d.sampleTick ?? null, reason: d.reason ?? null } : null }; }).catch(() => null);
        if (tr && (out.trace = out.trace || []) && (out.trace.length === 0 || out.trace[out.trace.length - 1].next !== tr.next || JSON.stringify(out.trace[out.trace.length - 1].life) !== JSON.stringify(tr.life))) out.trace.push({ s: +((Date.now() - t) / 1000).toFixed(2), ...tr });
        if (ok(s) || Date.now() - t > ms) break;
        await page.waitForTimeout(250);
    }
    return { ...s, lines, s: +((Date.now() - t) / 1000).toFixed(1) };
}

async function step(name, page, fn, ms, ok) {
    const before = await page.evaluate(READ);
    await fn();
    const after = await watch(page, ms, (s) => ok(s, before));
    out.steps.push({ name, before, after });
    console.log(name, JSON.stringify({ course: after.course, sonic: after.sonic, lines: after.lines.slice(-6) }).slice(0, 600));
    save();
    return after;
}

try {
    const { ctx, page } = await openPage();
    // 1. Shift+G in the ordinary flight
    await step('shiftG-flight', page, () => shiftG(page), 300000, (s) => (s.course?.gates ?? 0) > 0 && (s.course?.drawn ?? 0) > 0);
    await page.waitForTimeout(3500);
    out.install = await page.evaluate(INSTALL);
    // 2. gates 1 and 2 flown by the scripted pilot (in at +4 on the gate's z, out at -3), then held behind gate 2
    const poses = await page.evaluate(() => window.__gsfpv.course.gatePoses());
    out.passes = [];
    for (let k = 0; k < Math.min(2, poses.length); k++) {
        const g = poses[k], z = rot(g.quat, [0, 0, 1]);
        const a = [g.pos[0] + z[0] * 4, g.pos[1] + z[1] * 4, g.pos[2] + z[2] * 4], b = [g.pos[0] - z[0] * 3, g.pos[1] - z[1] * 3, g.pos[2] - z[2] * 3];
        await page.evaluate(([aa, bb]) => { const cp = window.__cp, s = window.__gsfpv.session; cp.a = aa; cp.b = bb; cp.t0 = s.sim.tick; cp.v = 8; cp.mode = 'line'; }, [a, b]);
        await page.waitForFunction(() => window.__cp.mode === 'hold', null, { timeout: 15000 }).catch(() => 0);
        out.passes.push({ gate: k + 1, next: await page.evaluate(() => window.__gsfpv.course.next) });
    }
    console.log('passes', JSON.stringify(out.passes));
    // 3. Backslash: Fly by Sound in place over the course
    await step('backslash-on', page, () => page.keyboard.press('Backslash'), 12000, () => false);
    if (RENDER) await page.screenshot({ path: `${shots}/onecourse-${tag}-sound-on.png` });
    // 4. Shift+G in the sound mode
    await step('shiftG-sound', page, () => page.keyboard.press('Shift+KeyG'), Number(process.env.SG_MS ?? 240000), (s, b) => s.course?.seed !== b.course?.seed && (s.course?.gates ?? 0) > 0 && (s.course?.drawn ?? 0) > 0 && s.sonic?.target != null);
    await page.waitForTimeout(3000);
    // integration C seam (e): the course made by Shift+G in the sound mode passes the Save check untouched (read only, nothing saved)
    out.saveCheckSound = await page.evaluate(() => { try { return window.__gsfpv.course.saveCheck?.() ?? 'no hook'; } catch (e) { return 'error ' + String(e).slice(0, 120); } });
    out.afterShiftGSound = await page.evaluate(READ);
    if (RENDER) await page.screenshot({ path: `${shots}/onecourse-${tag}-shiftg-again.png` });
    // 5. N in the sound mode
    await step('N-sound', page, () => page.keyboard.press('KeyN'), 240000, (s, b) => (s.course?.seed !== b.course?.seed && (s.course?.gates ?? 0) > 0 && s.sonic?.target != null) || (s.sonic?.target != null && s.sonic?.target !== b.sonic?.target && (s.sonic?.prims ?? 0) > 0));
    await page.waitForTimeout(3000);
    out.afterN = await page.evaluate(READ);
    if (RENDER) await page.screenshot({ path: `${shots}/onecourse-${tag}.png` });
    // 6. Backslash off: the course and its progress stay
    await step('backslash-off', page, () => page.keyboard.press('Backslash'), 8000, () => false);
    await ctx.close();
    // 7. a fresh page with no course: Backslash alone
    if (process.env.NOCOURSE !== '0') {
        const p2 = await openPage();
        await step('nocourse-backslash', p2.page, () => p2.page.keyboard.press('Backslash'), 20000, () => false);
        await p2.page.waitForTimeout(15000);
        out.nocourseLater = await p2.page.evaluate(READ);
        await p2.ctx.close();
    }
} catch (e) { out.fail = String(e).slice(0, 300); console.log('FAIL', out.fail); }
save();
await browser.close();
