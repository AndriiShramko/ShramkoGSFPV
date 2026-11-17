// Lane clockfix (review of 7af2aad5, finding F1): where the course clock's block and its cross stand, and what they lie over.
// One page per run (keyboard or touch), a Wroclaw course from Shift+G, ?render=off. For each state (before take-off with the
// prompt showing; in a flight after the first gate, the lap clock running; at the finish, after the results card) the view
// is resized to each size of SIZES (a resize in a flight is the rotation case: the block must follow the layout) and the
// page's rectangles are read: the block, its cross, and every other drawn thing (each text run by a Range, each box with a
// backdrop or a border, each button, link, summary, input). It prints every overlap of the block or its cross with another
// thing and with the middle third of the view, and writes all rectangles to the JSON file.
//   node tools/bench/scripts/clock-place-probe.mjs http://localhost:5840/en <out.json> key|touch [shots dir]
//   env SIZES=932x430,844x390,740x360,667x375,1366x768,1280x720,390x844  STATES=before,flight,finish  SCENE=70b50d42
// Exit 1 when the block or its cross lies over anything (or the middle third, or out of the view) on a view lower than
// 500 px; the taller sizes are reported for comparison (their numbers before and after a change), not judged.
// Headless; no GPU lock (render=off). Presses only Shift+G, Space and Enter on the controls screen: nothing is sent or saved.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { pickBrowser } from '../src/chrome.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [base, outFile, input, shots] = process.argv.slice(2);
if (!base || !outFile || !['key', 'touch'].includes(input)) { console.error('usage: clock-place-probe.mjs <base with /en> <out.json> key|touch [shots dir]'); process.exit(2); }
const TOUCH = input === 'touch';
const SIZES = (process.env.SIZES || '932x430,844x390,740x360,667x375,1366x768,1280x720,390x844').split(',').map((s) => { const [w, h] = s.split('x').map(Number); return { width: w, height: h }; });
const STATES = (process.env.STATES || 'before,flight,finish').split(',');
const SCENE = process.env.SCENE || '70b50d42';
if (shots) mkdirSync(shots, { recursive: true });

/** In the page: the clock's rectangles and every overlap with another drawn thing. */
const MEASURE = () => {
    const W = innerWidth, H = innerHeight;
    const rd = (b) => ({ x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width ?? b.w), h: Math.round(b.height ?? b.h) });
    const shown = (e) => {
        for (let p = e, child = null; p && p !== document.documentElement; child = p, p = p.parentElement) {
            // the content of a closed <details> is not drawn (only its summary)
            if (p.tagName === "DETAILS" && !p.open && child && child.tagName !== "SUMMARY") return false;
            const c = getComputedStyle(p);
            if (c.display === 'none' || c.visibility === 'hidden' || Number(c.opacity) === 0) return false;
        }
        return true;
    };
    const clock = document.querySelector('[data-testid=course-hud]');
    const cross = clock && clock.querySelector('.course-hud-x');
    const box = (e) => { if (!e || !shown(e)) return null; const b = e.getBoundingClientRect(); return b.width >= 1 && b.height >= 1 ? rd(b) : null; };
    // the block as drawn: its own box, or the union of its text runs when it has no backdrop (the block before clockfix)
    const block = box(clock), x = box(cross);
    const hit = (a, b) => !!a && !!b && Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0.5 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 0.5;
    const label = (e) => {
        const t = e.closest('[data-testid]');
        const cls = (e.getAttribute && e.getAttribute('class')) || '';
        return `${e.tagName.toLowerCase()}${cls ? '.' + cls.trim().split(/\s+/).slice(0, 2).join('.') : ''}${t ? ' [' + t.getAttribute('data-testid') + ']' : ''}`;
    };
    const things = [];
    const skip = (e) => !e || (clock && (clock.contains(e) || e.contains(clock))) || e.closest('[data-testid=render-off]') || e.tagName === 'CANVAS';
    // boxes with a backdrop or a border, and the controls
    for (const e of document.body.querySelectorAll('*')) {
        if (skip(e)) continue;
        const c = getComputedStyle(e);
        const ctl = /^(BUTTON|A|SUMMARY|INPUT|SELECT|IMG|svg|TEXTAREA)$/.test(e.tagName);
        const bg = !/rgba\(0, 0, 0, 0\)|transparent/.test(c.backgroundColor);
        const bd = ['Top', 'Right', 'Bottom', 'Left'].some((s) => parseFloat(c[`border${s}Width`]) > 0 && !/rgba\(0, 0, 0, 0\)|transparent/.test(c[`border${s}Color`]));
        if (!ctl && !bg && !bd) continue;
        const b = e.getBoundingClientRect();
        if (b.width < 1 || b.height < 1 || b.width * b.height > 0.3 * W * H) continue;
        if (!shown(e)) continue;
        things.push({ what: label(e), text: (e.textContent || '').trim().slice(0, 40), r: rd(b) });
    }
    // text runs
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        if (!n.textContent.trim() || skip(n.parentElement) || !shown(n.parentElement)) continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        for (const b of range.getClientRects()) {
            if (b.width < 1 || b.height < 1) continue;
            things.push({ what: 'text ' + label(n.parentElement), text: n.textContent.trim().slice(0, 40), r: rd(b) });
        }
    }
    const mid = { x: W / 3, y: H / 3, w: W / 3, h: H / 3 };
    const over = [];
    for (const [part, r] of [['block', block], ['cross', x]]) {
        if (!r) continue;
        for (const t of things) if (hit(r, t.r)) over.push({ part, what: t.what, text: t.text, r: t.r });
        if (hit(r, mid)) over.push({ part, what: 'middle third', r: rd(mid) });
        if (r.x < 0 || r.y < 0 || r.x + r.w > W || r.y + r.h > H) over.push({ part, what: 'outside the view', r: { x: 0, y: 0, w: W, h: H } });
    }
    const ui = document.getElementById('ui');
    return {
        W, H, block, cross: x, crossInBlock: !!block && !!x && x.x >= block.x && x.y >= block.y && x.x + x.w <= block.x + block.w && x.y + x.h <= block.y + block.h,
        clockText: (clock && clock.textContent || '').slice(0, 80), over, things: things.length,
        flying: !!ui && ui.classList.contains('hud-flying'), cinemaTop: ui && ui.style.getPropertyValue('--cinema-top'),
        crossLabel: cross && cross.getAttribute('aria-label'), crossTitle: cross && cross.getAttribute('title'),
        next: window.__gsfpv.course.next, laps: window.__gsfpv.course.laps,
    };
};

/** the scripted pilot of course-finish-probe.mjs: it SETS the craft's place each physics step along a line */
const INSTALL = () => {
    const s = window.__gsfpv.session;
    const cp = window.__cp = { mode: 'hold', a: null, b: null, t0: 0, v: 8, p: [s.sim.s[0], s.sim.s[1], s.sim.s[2]], q: [1, 0, 0, 0] };
    const setQ = (st) => { st[6] = cp.q[0]; st[7] = cp.q[1]; st[8] = cp.q[2]; st[9] = cp.q[3]; };
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
        } else {
            for (let i = 0; i < 3; i++) { st[i] = cp.p[i]; st[3 + i] = 0; }
            st[49] = 0; setQ(st);
        }
    };
    return true;
};
const rot = (q, v) => {
    const [w, x, y, z] = q; const [vx, vy, vz] = v;
    const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
    return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
};
const along = (p, d, k) => [p[0] + d[0] * k, p[1] + d[1] * k, p[2] + d[2] * k];
const yawTo = (d) => { const t = Math.atan2(-d[0], -d[2]); return [Math.cos(t / 2), 0, Math.sin(t / 2), 0]; };

const pick = pickBrowser({ expected: chromium.executablePath() });
const browser = await chromium.launch({ ...pick.launch, headless: true });
const ctx = await browser.newContext({ viewport: SIZES[0], deviceScaleFactor: 1, ...(TOUCH ? { hasTouch: true, isMobile: true } : {}) });
const page = await ctx.newPage();
const ev = (f, a) => page.evaluate(f, a);
const until = async (f, ok, ms, every = 100) => { const t = Date.now(); let v; do { v = await ev(f); if (ok(v)) return v; await page.waitForTimeout(every); } while (Date.now() - t < ms); return v; };
const out = { input, scene: SCENE, sizes: SIZES.map((s) => `${s.width}x${s.height}`), rows: [], notes: [] };
let bad = 0;
const measureAll = async (state, sizes) => {
    for (const s of sizes) {
        await page.setViewportSize(s);
        await page.waitForTimeout(700);
        const m = await ev(MEASURE);
        const tag = `${s.width}x${s.height}`;
        const short = s.height < 500;
        if (short && m.block && m.over.length) bad += m.over.length;
        if (short && !m.block && state !== 'finish-card') { bad++; m.over.push({ part: 'block', what: 'the block is not shown' }); }
        out.rows.push({ state, size: tag, short, ...m });
        const list = m.over.map((o) => `${o.part}>${o.what}${o.text ? ' "' + o.text.slice(0, 24) + '"' : ''}`);
        console.log(`${state.padEnd(7)} ${tag.padEnd(9)} block ${JSON.stringify(m.block)} cross ${JSON.stringify(m.cross)} in ${m.crossInBlock} flying ${m.flying} | ${list.length ? list.join('; ') : 'free'}`);
        if (shots && short) await page.screenshot({ path: `${shots}/clock-${state}-${tag}-${input}.png` });
    }
};
try {
    await page.goto(`${base}/fly/?scene=${SCENE}&nowarn=1&render=off${TOUCH ? '&input=touch' : ''}`);
    await page.waitForFunction(() => ['ready', 'error'].includes(window.__gsfpv?.status), null, { timeout: 240000 });
    await page.waitForFunction(() => { const w = window.__gsfpv && window.__gsfpv.walls; return w && w.state !== 'checking'; }, null, { timeout: 60000 }).catch(() => 0);
    if (!TOUCH) {
        try {
            await page.waitForSelector('.screen.radio [data-action="radio-keyboard"]', { timeout: 15000 });
            await page.focus('.screen.radio [data-action="radio-keyboard"]');
            await page.keyboard.press('Enter');
        } catch { out.notes.push('no controls screen'); }
    }
    await page.waitForTimeout(1500);
    await page.keyboard.press('Shift+KeyG');
    await page.waitForFunction(() => { const e = document.querySelector('[data-testid=course-hud]'); return !!e && e.offsetParent !== null; }, null, { timeout: 240000 });
    await page.waitForTimeout(2500);
    if (STATES.includes('before')) await measureAll('before', SIZES);
    if (STATES.includes('flight') || STATES.includes('finish')) {
        // take off: the keyboard's Space; on touch a tap on the left stick as well
        await page.keyboard.down('Space'); await page.waitForTimeout(400); await page.keyboard.up('Space');
        if (TOUCH) { // the prompt says: touch a stick to take off
            const pad = await ev(() => { const b = document.querySelector(".touch-pad.left")?.getBoundingClientRect(); return b ? [b.x + b.width / 2, b.y + b.height / 2] : null; });
            if (pad) { await page.touchscreen.tap(pad[0], pad[1]); await page.waitForTimeout(600); }
        }
        await ev(INSTALL);
        const poses = await ev(() => window.__gsfpv.course.gatePoses());
        out.gates = poses.length;
        const go = async (a, b, q, v) => {
            await ev(([p0, p1, qq, vv]) => { const cp = window.__cp, s = window.__gsfpv.session; cp.q = qq; cp.a = p0; cp.b = p1; cp.t0 = s.sim.tick; cp.v = vv; cp.mode = 'line'; }, [a, b, q, v]);
            await until(() => window.__cp.mode, (m) => m === 'hold', 30000, 40);
        };
        let at = await ev(() => window.__cp.p);
        const pass = async (k) => {
            const g = poses[k], z = rot(g.quat, [0, 0, 1]);
            const a = along(g.pos, z, 1.2), b = along(g.pos, z, -1.2);
            const q = yawTo([-z[0], 0, -z[2]]);
            await go(at, a, q, 40);
            await go(a, b, q, 8);
            at = b;
        };
        await pass(0);
        await page.waitForTimeout(300);
        out.afterStart = await ev(() => ({ next: window.__gsfpv.course.next, clock: window.__gsfpv.course.clockText() }));
        // in a flight: the tall sizes first, then the short ones (a phone turned on its side mid-flight)
        if (STATES.includes('flight')) await measureAll('flight', [...SIZES].reverse());
        if (STATES.includes('finish')) {
            let n = 0;
            for (let k = await ev(() => window.__gsfpv.course.next); k >= 0 && n < 400; k = await ev(() => window.__gsfpv.course.next), n++) await pass(k);
            out.passes = n + 1;
            out.finished = await ev(() => window.__gsfpv.course.next) === -1;
            await until(() => window.__gsfpv.course.splash().kind, (k) => k === 'none', 15000, 200);
            await measureAll('finish', SIZES);
        }
    }
} catch (e) { out.error = String(e && e.message || e).slice(0, 400); console.error(out.error); bad++; }
out.overlapsOnShortViews = bad;
writeFileSync(outFile, JSON.stringify(out, null, 1));
console.log(`overlaps on short views: ${bad}${out.error ? ' (error)' : ''}`);
await browser.close();
process.exit(bad ? 1 : 0);
