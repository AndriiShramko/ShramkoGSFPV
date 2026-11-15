// Lane onecourse O2.6 (the owner's message 53, D7): the four cases of "wrong way" on the owner's path in a local release, rendering off
// (no GPU lock). Fly by Sound is switched on (Backslash), Shift+G makes the course in the sound mode, then a scripted pilot (the
// course-path-probe.mjs way: position, speed and nose set each step) flies:
//   pass   gate 1 straight through;
//   (a)    gate 2 missed 7 m beside it, 10 m past it, turned round, nose-first back to 4 m in front of it, turned again, through it;
//   (b)    gate 3 flown over 4.5 m above it, 10 m past, back nose-first to its front, through it;
//   (d)    2 m past gate 3 facing gate 4: backing up 3 s, sliding 3 s each way;
//   (c)    turned round there and flown nose-first back along the leg, away from gate 4, 12 m.
// Per case: the lines the mode said (speech events) with their times from the case start, the course's next gate before and after.
// Usage: node tools/bench/scripts/d7-probe.mjs <base with /en> <out.json> <scene> [speed m/s, default 5]
// Nothing is saved or sent: only keys of the flight page are pressed.
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { pickBrowser } from '../src/chrome.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [base, outFile, scene, vArg] = process.argv.slice(2);
if (!base || !outFile || !scene) { console.error('usage: d7-probe.mjs <base with /en> <out.json> <scene> [speed]'); process.exit(2); }
const V = Number(vArg ?? 5) || 5;
const pick = pickBrowser({ expected: chromium.executablePath() });
const browser = await chromium.launch({ ...pick.launch, headless: true });

const INSTALL = () => {
    const h = window.__gsfpv, s = h.session, sc = h.scenario;
    const cp = window.__cp = { mode: 'idle', a: null, b: null, t0: 0, v: 5, p: null, q: [1, 0, 0, 0] };
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
    return { hover, bot: !!(sc && sc.bot) };
};

const READ = () => {
    const g = window.__gsfpv || {};
    const c = g.course;
    let so = null;
    try { so = g.sonic ? g.sonic(true) : null; } catch { so = null; }
    const speech = so ? so.events.filter((e) => e.kind === 'speech').map((e) => ({ t: e.t, key: e.key, text: e.text ? String(e.text).slice(0, 80) : undefined })) : [];
    return {
        course: c ? { on: c.on, seed: c.seed, gates: c.gates, next: c.next, laps: c.laps } : null,
        sonic: so ? { lesson: so.lesson, phase: so.phase, target: so.target ? so.target.id : null, yaw: so.yaw, pos: so.pos, prims: so.stagePrims } : null,
        // lane quiet3 (D7_NARRATOR=off): what reached the voice and the one-shot sounds played (feature.ts hook oneShots)
        voiced: (window.__voiced || []).slice(),
        oneShots: so && so.oneShots ? so.oneShots : [],
        speech
    };
};

const rot = (q, v) => { // q = [w, x, y, z]
    const [w, x, y, z] = q; const [vx, vy, vz] = v;
    const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
    return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
};
const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const local = (g, l) => add(g.pos, rot(g.quat, l));
/** the body quaternion [w, x, y, z] whose nose (yaw 0 = -Z, right positive) points along `d` on the floor */
const noseQ = (d) => { const th = Math.atan2(d[0], -d[2]); const phi = -th; return [Math.cos(phi / 2), 0, Math.sin(phi / 2), 0]; };

const out = { base, scene, speed: V, cases: [], errors: [] };
const save = () => writeFileSync(outFile, JSON.stringify(out, null, 1));

try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    // lane quiet3 (D7_NOCOURSE=1, X2 row 3): the course worker's answer loses its track, so Shift+G gives no course (course.none)
    if (process.env.D7_NOCOURSE) {
        await ctx.addInitScript(() => {
            const W = window.Worker;
            window.Worker = class extends W {
                set onmessage(fn) {
                    super.onmessage = (e) => {
                        const d = e.data;
                        if (d && typeof d === 'object' && 'track' in d && d.t !== 'progress' && d.t !== 'checked' && d.t !== 'error') { window.__noCourse = (window.__noCourse || 0) + 1; return fn.call(this, { data: { ...d, track: null, short: false } }); }
                        return fn.call(this, e);
                    };
                }
                get onmessage() { return super.onmessage; }
            };
        });
    }
    const page = await ctx.newPage();
    page.on('pageerror', (e) => out.errors.push(String(e.message).slice(0, 160)));
    await page.goto(`${base}/fly/?scene=${scene}&nowarn=1&set.input.howToFly=false&simradio=scenario&set.respawn.auto=1&set.respawn.target=rewind&render=off${process.env.D7_SG ? `&sg=${process.env.D7_SG}` : ''}`, { waitUntil: 'load', timeout: 120000 });
    await page.waitForFunction(() => ['ready', 'error'].includes(window.__gsfpv && window.__gsfpv.status), null, { timeout: 300000 });
    if (process.env.D7_NARRATOR === 'off') {
        // lane quiet3: the narrator setting off in the prefs document, a spy on the voice, then the page again
        await ctx.addInitScript(() => { window.__voiced = []; try { const s = window.speechSynthesis; const sp = s.speak.bind(s); s.speak = (u) => { window.__voiced.push(String(u.text).slice(0, 80)); return sp(u); }; } catch { /* no voice */ } });
        out.prefsKey = await page.evaluate(() => {
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                let d;
                try { d = JSON.parse(localStorage.getItem(k)); } catch { continue; }
                if (!d || !d.collections || !d.collections.sonic) continue;
                d.collections.sonic.prefs = { ...(d.collections.sonic.prefs || {}), narrator: false };
                localStorage.setItem(k, JSON.stringify(d));
                return k;
            }
            return null;
        });
        await page.reload({ waitUntil: 'load', timeout: 120000 });
        await page.waitForFunction(() => ['ready', 'error'].includes(window.__gsfpv && window.__gsfpv.status), null, { timeout: 300000 });
    }
    await page.waitForFunction(() => { const w = window.__gsfpv && window.__gsfpv.walls; return w && w.state !== 'checking'; }, null, { timeout: 60000 }).catch(() => 0);
    await page.waitForTimeout(2000);
    const x = page.locator('.screen.radio [data-action=radio-close]');
    if (await x.count()) { await x.first().click(); await page.waitForTimeout(800); }
    // Fly by Sound on, then Shift+G in the sound mode
    await page.keyboard.press('Backslash');
    await page.waitForTimeout(8000);
    const t0 = Date.now();
    await page.keyboard.press('Shift+KeyG');
    // review OC-1 (D7_BUSY=1): a second Shift+G 1 s later, while the course is being made, must be said, not dropped
    const nBusy = (await page.evaluate(READ)).speech.length;
    if (process.env.D7_BUSY) { await page.waitForTimeout(1000); await page.keyboard.press('Shift+KeyG'); out.busyPressS = +((Date.now() - t0) / 1000).toFixed(2); }
    if (process.env.D7_NOCOURSE) {
        // row 3: what the pilot hears when Shift+G gives no course (with D7_NARRATOR=off: a sound, no words)
        const n0 = (await page.evaluate(READ)).oneShots.length;
        for (;;) {
            const r = await page.evaluate(READ);
            const shots = r.oneShots.slice(n0);
            const said = r.speech.slice(nBusy);
            if (shots.some((s) => String(s.cue).includes('wrong-side')) || said.some((e) => e.key === 'course.none') || Date.now() - t0 > 180000) {
                await page.waitForTimeout(1500);
                const z = await page.evaluate(READ);
                out.noCourse = { s: +((Date.now() - t0) / 1000).toFixed(1), forced: await page.evaluate(() => window.__noCourse || 0), course: z.course, voiced: z.voiced, oneShots: z.oneShots.slice(n0), said: z.speech.slice(nBusy).map((e) => ({ t: e.t, key: e.key, text: e.text })) };
                break;
            }
            await page.waitForTimeout(500);
        }
        save();
        console.log('no course', JSON.stringify(out.noCourse).slice(0, 600));
        await browser.close();
        process.exit(0);
    }
    // the wait logs what it reads every 10 s (pass 3: the first run timed out here with no log)
    out.wait = [];
    for (let k = 0; ; k++) {
        const r = await page.evaluate(READ);
        const ok = (r.course?.gates ?? 0) > 0 && r.sonic && r.sonic.target;
        if (k % 20 === 0 || ok) { const w = { s: +((Date.now() - t0) / 1000).toFixed(1), course: r.course, target: r.sonic?.target ?? null, lesson: r.sonic?.lesson ?? null, phase: r.sonic?.phase ?? null, said: r.speech.slice(-4).map((e) => e.key) }; out.wait.push(w); console.log('wait', JSON.stringify(w)); save(); }
        if (ok) break;
        if (Date.now() - t0 > 300000) throw new Error('no course gates and sonic target within 300 s after Shift+G');
        await page.waitForTimeout(500);
    }
    out.course = { ...(await page.evaluate(READ)).course, madeS: +((Date.now() - t0) / 1000).toFixed(1) };
    // every line said from the first Shift+G to the course made (times are the page's event times, ms)
    out.saidWhileMaking = (await page.evaluate(READ)).speech.slice(nBusy).map((e) => ({ t: e.t, key: e.key, text: e.text }));
    save();
    if (process.env.D7_BUSY_ONLY) { console.log('busy only: done'); await browser.close(); process.exit(0); }
    await page.waitForTimeout(6000);
    out.install = await page.evaluate(INSTALL);
    const poses = await page.evaluate(() => window.__gsfpv.course.gatePoses());
    out.gates = poses.length;
    // one leg of the scripted pilot: a -> b at `v`, the nose along `nose` (default: the way it moves); resolves at b
    let at = null;
    const fly = async (b, o = {}) => {
        const a = at ?? (await page.evaluate(() => window.__gsfpv.sonic(false).pos));
        const d = [b[0] - a[0], 0, b[2] - a[2]];
        const q = noseQ(o.nose ?? (Math.hypot(d[0], d[2]) > 1e-3 ? d : [0, 0, -1]));
        await page.evaluate(([aa, bb, qq, vv]) => { const cp = window.__cp, s = window.__gsfpv.session; cp.a = aa; cp.b = bb; cp.q = qq; cp.t0 = s.sim.tick; cp.v = vv; cp.mode = 'line'; }, [a, b, q, o.v ?? V]);
        await page.waitForFunction(() => window.__cp.mode === 'hold', null, { timeout: 60000 }).catch(() => 0);
        at = b;
        if (o.hold) await page.waitForTimeout(o.hold);
    };
    const turnAt = async (nose, ms = 800) => { await page.evaluate((qq) => { window.__cp.q = qq; }, noseQ(nose)); await page.waitForTimeout(ms); };
    const runCase = async (name, fn) => {
        const before = await page.evaluate(READ);
        const n0 = before.speech.length;
        const tc = Date.now();
        const seen = [];
        let stop = false;
        const poll = (async () => { let k = n0; while (!stop) { const s = await page.evaluate(READ); for (; k < s.speech.length; k++) seen.push({ key: s.speech[k].key, text: s.speech[k].text, s: +((Date.now() - tc) / 1000).toFixed(2) }); await page.waitForTimeout(100); } })();
        await fn();
        await page.waitForTimeout(2500);
        stop = true;
        await poll;
        const after = await page.evaluate(READ);
        const c = { name, nextBefore: before.course?.next, nextAfter: after.course?.next, lapsBefore: before.course?.laps, lapsAfter: after.course?.laps, lines: seen, wrongWay: seen.filter((l) => l.key === 'fly.wrong-way').length, gateBehind: seen.filter((l) => /gate-?[bB]ehind/.test(l.key)).length, voiced: after.voiced.slice(before.voiced.length), sounds: after.oneShots.slice(before.oneShots.length).map((o) => o.cue), s: +((Date.now() - tc) / 1000).toFixed(1) };
        out.cases.push(c);
        console.log(name, JSON.stringify(c).slice(0, 500));
        save();
    };
    const through = async (g) => { await fly(local(g, [0, 0, 4])); await fly(local(g, [0, 0, -3])); };
    await runCase('pass gate 1', async () => { await through(poses[0]); });
    const missBack = async (g, off) => {
        await fly(local(g, [off[0], off[1], 4]));
        await fly(local(g, [off[0], off[1], -10]));
        await turnAt(add(local(g, [0, 0, 4]), at, -1));
        await fly(local(g, [0, 0, 4]));
        await turnAt(add(local(g, [0, 0, -3]), at, -1));
        await fly(local(g, [0, 0, -3]));
    };
    await runCase('(a) gate 2 missed 7 m beside, 10 m past, back, through', () => missBack(poses[1], [7, 0]));
    await runCase('(b) gate 3 flown over 4.5 m above, back, through', () => missBack(poses[2], [0, 4.5]));
    const g3 = poses[2], g4 = poses[3];
    const leg = [g4.pos[0] - g3.pos[0], 0, g4.pos[2] - g3.pos[2]];
    const L = Math.hypot(leg[0], leg[2]);
    const al = [leg[0] / L, 0, leg[2] / L];
    const side = [-al[2], 0, al[0]];
    out.leg34 = +L.toFixed(1);
    const p0 = add(g3.pos, al, 2);
    await runCase('(d) 2 m past gate 3: backing up 3 s, sliding 3 s each way', async () => {
        await fly(p0, { nose: al });
        await fly(add(p0, al, -6), { nose: al, v: 2 });
        await fly(add(add(p0, al, -6), side, 6), { nose: al, v: 2 });
        await fly(add(p0, al, -6), { nose: al, v: 2 });
    });
    await runCase('(c) turned round on the leg 3-4, nose-first back along it 12 m', async () => {
        await fly(p0, { nose: al });
        await turnAt([-al[0], 0, -al[2]]);
        await fly(add(p0, al, -12));
    });
    // review OC-2: the rest of the lap (gates 4 to N, then gate 1 again where the course is a loop); the lap line must be said
    await runCase('(lap) gates 4 to N straight through, then gate 1', async () => {
        for (let i = 3; i < poses.length; i++) await through(poses[i]);
        const c = (await page.evaluate(READ)).course;
        if (c && c.laps < 1) await through(poses[0]);
    });
    await ctx.close();
} catch (e) { out.fail = String(e).slice(0, 300); console.log('FAIL', out.fail); }
save();
await browser.close();
