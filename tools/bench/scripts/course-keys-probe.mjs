// Lane course5, stage Z3-elements (review CU-9): a keyboard pilot flies a Shift+G course of elements with REAL key events
// (page.keyboard down/up: the page's KeyboardSource and the game scheme, play/keys.ts GAME_KEYS: W/S forward and back,
// A/D strafe, Q/E turn, Space up, ShiftLeft down). Nothing sets the craft's place: the probe only reads it
// (window.__gsfpv.session.sim.s) and decides which keys to hold. Every gate in order: a point before the gate on its pass
// axis, then a point past it (a flat square: below it, then above it: the climb); after each gate the page's next gate is
// read, so each element is counted or not. The climb speed is measured over the flat square's pass (game.ts GAME_SPEEDS
// normal: 5 m/s up).
//   node tools/bench/scripts/course-keys-probe.mjs http://localhost:5780/en <out.json> <id>[:<name>] [maxGates]
// Headless; takes no GPU lock itself (wrap it). Presses only Shift+G and flying keys: nothing is sent or saved.
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { pickBrowser } from '../src/chrome.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [base, outFile, item, maxArg] = process.argv.slice(2);
if (!base || !outFile || !item) { console.error('usage: course-keys-probe.mjs <base with /en> <out.json> <id>[:name] [maxGates]'); process.exit(2); }
const MAX_GATES = Number(maxArg || 99);
const pick = pickBrowser({ expected: chromium.executablePath() });
const browser = await chromium.launch({ ...pick.launch, headless: true });

const rot = (q, v) => { // q = [w, x, y, z]
    const [w, x, y, z] = q; const [vx, vy, vz] = v;
    const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
    return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
};
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const along = (p, d, k) => [p[0] + d[0] * k, p[1] + d[1] * k, p[2] + d[2] * k];
const r2 = (v) => Math.round(v * 100) / 100;

/** elements from the gates (as course-elements-probe.mjs) */
function elementsOf(poses, unit) {
    const ax = poses.map((p) => rot(p.quat, [0, 0, 1]));
    const out = [];
    let i = 0;
    while (i < poses.length) {
        let j = i;
        while (j + 1 < poses.length && poses[j + 1].shape.kind === poses[i].shape.kind && Math.abs(dot(ax[j], ax[j + 1])) > 0.98 && len(sub(poses[j + 1].pos, poses[j].pos)) < 1.6 * unit) j++;
        if (j - i + 1 >= 3) { out.push({ kind: 'tunnel', from: i, to: j }); i = j + 1; continue; }
        const kind = Math.abs(ax[i][1]) > Math.cos((25 * Math.PI) / 180) ? 'flat' : poses[i].shape.kind === 'cube-frame' ? 'cube' : poses[i].shape.kind;
        out.push({ kind, from: i, to: i });
        i++;
    }
    return out;
}

const until = async (page, f, ok, ms, every = 250) => { const t = Date.now(); let v; do { v = await page.evaluate(f); if (ok(v)) return v; await page.waitForTimeout(every); } while (Date.now() - t < ms); return v; };

const [id, name0] = item.split(':');
const r = { id, name: name0 || id, errors: [] };
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => r.errors.push(String(e.message).slice(0, 160)));
const held = new Set();
const setKey = async (code, on) => {
    if (on && !held.has(code)) { held.add(code); await page.keyboard.down(code); }
    else if (!on && held.has(code)) { held.delete(code); await page.keyboard.up(code); }
};
const releaseAll = async () => { for (const k of [...held]) await setKey(k, false); };
const state = () => page.evaluate(() => { const s = window.__gsfpv.session.sim.s; return { p: [s[0], s[1], s[2]], v: [s[3], s[4], s[5]], q: [s[6], s[7], s[8], s[9]], next: window.__gsfpv.course.next, laps: window.__gsfpv.course.laps }; });

/** fly to `t` with keys; `pass` (a gate centre and its pass direction): done once the craft is past the gate's plane by `beyond` m */
async function flyTo(t, tol, pass, ms) {
    const t0 = Date.now();
    let tick = 0, s, vyMax = 0;
    for (;;) {
        s = await state();
        vyMax = Math.max(vyMax, s.v[1]);
        const e = sub(t, s.p);
        if (pass ? dot(sub(s.p, pass.c), pass.d) >= pass.beyond : len(e) < tol) break;
        if (Date.now() - t0 > ms) { await releaseAll(); return { ok: false, s, vyMax }; }
        const f0 = rot(s.q, [0, 0, -1]);
        const fh = Math.hypot(f0[0], f0[2]) || 1;
        const f = [f0[0] / fh, 0, f0[2] / fh], rt = [-f[2], 0, f[0]];
        const ef = dot(e, f), er = dot(e, rt), eu = e[1];
        // heading: toward the target's horizontal part when it is more than 1 m away
        const eh = Math.hypot(e[0], e[2]);
        const turn = eh > 1 ? Math.atan2(dot([e[0], 0, e[2]], rt), dot([e[0], 0, e[2]], f)) : 0;
        // keys pulsed by the error: held for a share of a 4-step cycle (a person taps a key near the target)
        const duty = (x, full) => Math.min(1, Math.abs(x) / full);
        const on = (x, full, dead) => Math.abs(x) > dead && (tick % 4) < Math.max(1, Math.round(duty(x, full) * 4));
        await setKey('KeyW', ef > 0 && on(ef, 2.5, 0.08));
        await setKey('KeyS', ef < 0 && on(ef, 2.5, 0.08));
        await setKey('KeyD', er > 0 && on(er, 1.5, 0.05));
        await setKey('KeyA', er < 0 && on(er, 1.5, 0.05));
        await setKey('Space', eu > 0 && on(eu, 1.5, 0.05));
        await setKey('ShiftLeft', eu < 0 && on(eu, 1.5, 0.05));
        await setKey('KeyE', turn > 0.15);
        await setKey('KeyQ', turn < -0.15);
        tick++;
        await page.waitForTimeout(30);
    }
    return { ok: true, s, vyMax };
}

try {
    await page.goto(`${base}/fly/?scene=${id}&nowarn=1&set.input.howToFly=false&set.crash.enabled=0`, { waitUntil: 'load', timeout: 120000 });
    await page.waitForFunction(() => ['ready', 'error'].includes(window.__gsfpv && window.__gsfpv.status), null, { timeout: 300000 });
    await page.waitForFunction(() => { const w = window.__gsfpv && window.__gsfpv.walls; return w && w.state !== 'checking'; }, null, { timeout: 60000 }).catch(() => 0);
    await page.waitForTimeout(2000);
    // the radio screen opens on a page without ?simradio and takes the keys (course-elements-probe.mjs closes it too)
    const x = page.locator('.screen.radio [data-action=radio-close]');
    if (await x.count()) { await x.first().click(); await page.waitForTimeout(800); }
    r.screens = await page.evaluate(() => [...document.querySelectorAll('.screen')].filter((e) => e.offsetParent).map((e) => e.className).join('|'));
    const t0 = Date.now();
    await page.keyboard.press('Shift+KeyG');
    const c = await until(page, () => { const c = window.__gsfpv.course; return { gates: c.gates, drawn: c.drawn, problem: c.problem, seed: c.seed }; }, (v) => v.gates > 0 && v.drawn > 0, 240000, 500);
    r.courseS = r2((Date.now() - t0) / 1000);
    r.seed = c.seed;
    if (!(c.gates > 0)) throw new Error('no course: ' + c.problem + ' screens ' + r.screens);
    await page.waitForTimeout(3000);
    const unit = (await page.evaluate(() => (window.__gsfpv.session.transform ? window.__gsfpv.session.transform.s : 1))) || 1;
    const poses = await page.evaluate(() => window.__gsfpv.course.gatePoses());
    const ax = poses.map((p) => rot(p.quat, [0, 0, 1]));
    r.unit = unit; r.gates = poses.length; r.elements = elementsOf(poses, unit);
    r.counts = r.elements.reduce((m, e) => ((m[e.kind] = (m[e.kind] ?? 0) + 1), m), {});
    // the motors start on a game key; a short climb first
    await setKey('Space', true); await page.waitForTimeout(600); await setKey('Space', false); await page.waitForTimeout(800);
    r.passes = [];
    const tStart = Date.now();
    const n = Math.min(poses.length, MAX_GATES);
    for (let k = 0; k < n; k++) {
        const g = poses[k], z = ax[k];
        const near = Math.min(...[k - 1, k + 1].filter((m) => m >= 0 && m < poses.length).map((m) => len(sub(poses[m].pos, g.pos))), 4 * unit);
        const dA = Math.min(1.5 * unit, 0.45 * near);
        const a = along(g.pos, z, dA), b = along(g.pos, z, -dA);
        const before = (await state()).next;
        const tg = Date.now();
        const toA = await flyTo(a, 0.25, null, 40000);
        const thru = await flyTo(b, 0, { c: g.pos, d: [-z[0], -z[1], -z[2]], beyond: 0.4 * dA }, 15000);
        await page.waitForTimeout(100);
        const after = (await state()).next;
        const el = r.elements.find((e) => k >= e.from && k <= e.to);
        r.passes.push({ gate: k + 1, kind: el ? el.kind : g.shape.kind, shape: g.shape.kind, flat: Math.abs(z[1]) > 0.9, reachedA: toA.ok, through: thru.ok, before, after, counted: after !== before, s: r2((Date.now() - tg) / 1000), vyMax: r2(Math.max(toA.vyMax, thru.vyMax)), riseM: r2(-z[1] > 0.9 ? 2 * dA : 0) });
        console.log(JSON.stringify(r.passes[r.passes.length - 1]));
    }
    await releaseAll();
    r.flownS = r2((Date.now() - tStart) / 1000);
    r.counted = r.passes.filter((p) => p.counted).length;
    r.byKind = {};
    for (const p of r.passes) { const m = (r.byKind[p.kind] ??= { gates: 0, counted: 0 }); m.gates++; if (p.counted) m.counted++; }
    r.lap = await page.evaluate(() => { const c = window.__gsfpv.course; return { laps: c.laps, last: c.lastLapMs, clock: c.clockText ? c.clockText() : null }; });
} catch (e) { r.fail = String(e).slice(0, 240); }
writeFileSync(outFile, JSON.stringify(r, null, 1));
await ctx.close();
await browser.close();
console.log(JSON.stringify({ id: r.id, screens: r.screens, courseS: r.courseS, seed: r.seed, gates: r.gates, counts: r.counts, flown: r.passes?.length, counted: r.counted, byKind: r.byKind, flownS: r.flownS, lap: r.lap, errors: r.errors.length, fail: r.fail }));
process.exit(r.fail || r.counted !== r.passes?.length ? 1 : 0);
