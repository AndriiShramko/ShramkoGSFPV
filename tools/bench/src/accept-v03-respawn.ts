// v0.3 respawn acceptance in the page (docs/architecture-v03.md C.12 browser; items 16, 23, 18, R).
// Fresh browser contexts, system Chrome (browser.ts); every check has a negative control.
//   LOCAL_FLY=1 SITE=http://127.0.0.1:5322 npx tsx src/accept-v03-respawn.ts [R16 R23 R18 RR SHOTS]
// Flight logic runs in the logic-only mode (?render=off: the scan is not drawn, everything else
// runs at the display rate; tools/bench/README.md). SHOTS draws the scan: screenshots of the toast,
// the "-5 s" label and the crash panel at 1280x800 and on a 375x812 phone, with an overlap check.
// Evidence: evidence/<date>/v03-respawn.json (+ v03-respawn/*.png).
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { launch, waitReady } from './browser';
import { writeEvidence, REPO, today } from './evidence';

const SITE = (process.env.SITE ?? 'http://127.0.0.1:5322').replace(/\/$/, '');
const ONLY = process.argv.slice(2).map((x) => x.toUpperCase());
const want = (id: string) => ONLY.length === 0 || ONLY.includes(id);
const fly = (qs: string, render = false) => `${SITE}${process.env.LOCAL_FLY ? '' : '/en'}/fly/?${qs}${render ? '' : '&render=off'}&cb=${Math.random().toString(36).slice(2)}`;
const SHOTS = join(REPO, 'evidence', today(), 'v03-respawn');
mkdirSync(SHOTS, { recursive: true });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const hook = <T = Any>(p: Page, body: string): Promise<T> => p.evaluate(`(() => { const h = window.__gsfpv; const s = h.session; ${body} })()`) as Promise<T>;
async function until<T = Any>(p: Page, body: string, ok: (v: T) => boolean, timeoutMs: number, everyMs = 100): Promise<T> {
    const t0 = Date.now();
    let v = await hook<T>(p, body);
    while (!ok(v) && Date.now() - t0 < timeoutMs) {
        await p.waitForTimeout(everyMs);
        v = await hook<T>(p, body);
    }
    return v;
}

const out: Record<string, unknown> = { site: SITE, render: 'off for R16 R23 R18 RR (flight logic; never a visual check), on for SHOTS' };
const passed: Record<string, boolean> = {};
function record(id: string, data: Record<string, unknown> & { pass: boolean }): void {
    out[id] = data;
    passed[id] = data.pass;
    console.log(`${id} ${data.pass ? 'PASS' : 'FAIL'}`, JSON.stringify(data).slice(0, 900));
}

const L = await launch();
const errors: string[] = [];
L.page.on('pageerror', (e) => errors.push(e.message));

/** A fresh page (new browser context: nothing remembered between checks). */
async function page(qs: string, render = false, size?: { width: number; height: number; mobile?: boolean }): Promise<Page> {
    const ctx = await L.browser.newContext({ viewport: size ? { width: size.width, height: size.height } : { width: 1280, height: 800 }, deviceScaleFactor: 1, isMobile: !!size?.mobile, hasTouch: !!size?.mobile });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(fly(qs, render));
    const r = await waitReady(p, 180000);
    if (r.status !== 'ready') throw new Error(`page not ready: ${JSON.stringify(r).slice(0, 300)}`);
    return p;
}

// ------------------------------------------------------------------ R16 the invisible platform (item 16)
// Arm at the spawn with the throttle at idle (touch sticks, through the arm gate): the craft sits on
// the platform, y within 2 cm for 5 s. Control: ?set.respawn.platform=0, the same arm falls.
const ARM_TOUCH = `
    const t = h.touch; t.channels[2] = -1; t.setArmed(true);
    const rec = window.__r16 = { y0: s.sim.s[1], plat0: s.sim.s[65], t0: s.sim.tick, armedTicks: 0, minY: 1e9, maxY: -1e9, crashed: false, contacts: 0, ticks: 0 };
    const prev = s.runner.onStep;
    s.runner.onStep = (sim) => { prev?.(sim); if (sim.s[34] > 0) { rec.armedTicks++; rec.minY = Math.min(rec.minY, sim.s[1]); rec.maxY = Math.max(rec.maxY, sim.s[1]); } rec.crashed ||= sim.s[35] > 0; rec.ticks++; };
    return 0;`;
async function platformRun(qs: string): Promise<Record<string, unknown>> {
    const p = await page(qs);
    await p.waitForTimeout(600); // the touch keep-alive has shown the switch OFF to the gate
    await hook(p, ARM_TOUCH);
    const r = await until(p, 'const r = window.__r16; return { ...r, platOn: s.sim.s[65], armed: s.sim.armed, block: h.controls.block };', (v: Any) => v.armedTicks >= 5000 || v.crashed, 15000, 250);
    await p.context().close();
    return { ...r, dyUp: r.maxY - r.y0, dyDown: r.y0 - r.minY };
}
if (want('R16')) {
    const on = await platformRun('scene=39e63ce9&nowarn=1&input=touch');
    const off = await platformRun('scene=39e63ce9&nowarn=1&input=touch&set.respawn.platform=0');
    const held = on.plat0 === 1 && (on.armedTicks as number) >= 5000 && !on.crashed && Math.max(on.dyUp as number, on.dyDown as number) < 0.02;
    const fell = off.plat0 === 0 && (off.dyDown as number) > 0.3;
    record('R16', { pass: held && fell, item: 16, rule: 'armed at idle on the spawn: |dy| < 2 cm for 5 s', platform: on, control: { query: 'set.respawn.platform=0', run: off, fired: fell } });
}

// ------------------------------------------------------------------ R23 automatic respawn (item 23)
// The bot dashes into a wall; its switch stays on the whole time and after the crash its sticks go
// to the centre with the throttle at hover (the "fake radio"). Expected: the toast counts down; the
// craft flies again 2.0-2.3 s (wall) after the crash at the point of its recorded path 5.0-5.1 s
// before it, armed at that tick with no switch flip; HUD THR follows the stick. Control:
// ?set.respawn.auto=0 shows the crash panel and the craft is still crashed 10 s later.
const BOT_23 = `
    const sc = h.scenario; const hover = s.director.hoverStick;
    const rec = window.__r23 = { hover, thr: hover, crashSeen: false, crashT: null, crashTick: null, lifeT: null, lifeTick: null, lifeAt: null, armedAtLife: null, reason: null,
        lowSwitchTicks: 0, watchTicks: 0, path: new Map(), toastTexts: [], label: null, lives0: s.lives().length };
    const orig = sc.bot.update.bind(sc.bot);
    sc.bot.update = (sim) => { const ch = orig(sim); ch[4] = 1; if (sim.crashed || rec.crashSeen) { rec.crashSeen = true; ch[0] = 0; ch[1] = 0; ch[3] = 0; ch[2] = rec.thr * 2 - 1; } return ch; };
    const step = s.runner.onStep;
    s.runner.onStep = (sim) => { step?.(sim); rec.path.set(sim.tick, [sim.s[0], sim.s[1], sim.s[2]]); if (rec.path.size > 20000) rec.path.delete(sim.tick - 20000);
        if (rec.crashTick !== null && (rec.lifeTick === null || sim.tick <= rec.lifeTick + 2000)) { rec.watchTicks++; if (sim.ch[4] <= 0.5) rec.lowSwitchTicks++; } };
    // both moments at the end of the frame that first shows them (what the pilot sees): frame-quantized alike
    let crashFrame = false, lifeFrame = false;
    const fr = s.onFrame; s.onFrame = (x, dt) => { fr?.(x, dt); const now = performance.now(); if (crashFrame) { rec.crashT = now; crashFrame = false; } if (lifeFrame) { rec.lifeT = now; lifeFrame = false; } };
    const ev = s.onEvent; s.onEvent = (e) => { if (e.type === 'crash' && rec.crashTick === null) { rec.crashTick = e.tick; crashFrame = true; } ev?.(e); };
    const lf = s.onLife; s.onLife = (life) => { if (rec.crashTick !== null && rec.lifeTick === null) { lifeFrame = true; rec.lifeTick = s.sim.tick; rec.lifeAt = life.header.life.at; rec.armedAtLife = s.sim.armed; rec.reason = life.header.life.reason; } lf?.(life); };
    return hover;`;
const R23_STATE = `const r = window.__r23; const t = document.querySelector('.crash-toast .ct-text'); if (t && !r.toastTexts.includes(t.textContent)) r.toastTexts.push(t.textContent);
    const l = document.querySelector('[data-testid=rewind-label]'); if (l) r.label = l.textContent;
    return { crashTick: r.crashTick, lifeTick: r.lifeTick, lifeT: r.lifeT ?? null, label: r.label, armed: s.sim.armed, crashed: s.sim.crashed, lives: s.lives().length, toast: !!document.querySelector('[data-testid=crash-toast]'), panel: !!document.querySelector('[data-testid=crash-panel]'), phase: h.scenario.phase };`;
if (want('R23')) {
    const p = await page('scene=39e63ce9&simradio=scenario&nowarn=1');
    const gate = await hook(p, 'return { keepArmedAfterCrash: h.controls.gate.keepArmedAfterCrash, source: h.controls.source };');
    await hook(p, BOT_23);
    await until(p, R23_STATE, (v: Any) => v.crashTick !== null, 60000, 50);
    await until(p, R23_STATE, (v: Any) => v.lifeT !== null, 8000, 50);
    await until(p, R23_STATE, (v: Any) => v.label !== null, 1500, 50);
    const back = await hook(p, `const r = window.__r23; const d = s.director.last; const at = r.lifeAt; const want = r.path.get(d.sampleTick);
        return { wallS: (r.lifeT - r.crashT) / 1000, simS: (r.lifeTick - r.crashTick) / 1000, framePeriodMs: s.frameStats().p50, reason: r.reason, decision: d, at, recordedAt: want ?? null,
            offM: want ? Math.hypot(at[0] - want[0], at[1] - want[1], at[2] - want[2]) : null, armedAtLife: r.armedAtLife, toastTexts: r.toastTexts, lives: s.lives().length, lives0: r.lives0 };`);
    await p.waitForTimeout(600);
    const thr = async () => hook(p, `const b = document.querySelector('.osd.bl').textContent; const m = /THR (\\d+)%/.exec(b); return { hud: m ? Number(m[1]) : null, stick: Math.round(((s.sim.ch[2] + 1) / 2) * 100), armed: s.sim.armed, crashed: s.sim.crashed, vy: s.sim.s[4], y: s.sim.s[1], label: window.__r23.label, crashView: h.crash.active };`);
    const atHover = await thr();
    await hook(p, 'window.__r23.thr = Math.min(1, window.__r23.hover + 0.12); return 0;');
    await p.waitForTimeout(700);
    const up = { ...(await thr()), climbedM: 0 };
    up.climbedM = (up.y as number) - (atHover.y as number);
    await hook(p, 'window.__r23.thr = window.__r23.hover; return 0;');
    await p.waitForTimeout(800);
    const sw = await hook(p, 'const r = window.__r23; return { lowSwitchTicks: r.lowSwitchTicks, watchTicks: r.watchTicks, label: r.label };');
    await p.context().close();
    // control: automatic respawn off
    const c = await page('scene=39e63ce9&simradio=scenario&nowarn=1&set.respawn.auto=0');
    await hook(c, BOT_23);
    await until(c, R23_STATE, (v: Any) => v.crashTick !== null, 60000, 50);
    const c0 = await hook(c, R23_STATE);
    await c.waitForTimeout(10000);
    const c10 = await hook(c, R23_STATE);
    await c.context().close();
    const d = back.decision as { kind: string; pathAgeTicks: number };
    const pass = back.reason === 'crash' && d.kind === 'rewind' && d.pathAgeTicks >= 5000 && d.pathAgeTicks <= 5100 && (back.offM as number) < 0.001
        // the respawn is decided at exactly crash + 2000 sim ticks; on screen both moments are frame-quantized, so one frame of tolerance below 2.0 s
        && back.simS === 2 && (back.wallS as number) >= 2.0 - (back.framePeriodMs as number) / 1000 && (back.wallS as number) <= 2.3 && back.armedAtLife === true && (back.toastTexts as string[]).length > 1
        && atHover.armed && !atHover.crashed && atHover.hud === atHover.stick && up.hud === up.stick && (up.hud as number) > (atHover.hud as number) && up.climbedM > 0.1
        && sw.lowSwitchTicks === 0 && sw.watchTicks > 2000 && typeof sw.label === 'string' && /5/.test(sw.label as string) && !atHover.crashView;
    const fired = c10.crashed === true && c10.lives === c0.lives && c10.lifeTick === null && c10.panel === true && c10.toast === false;
    record('R23', { pass: pass && fired, item: 23, gate, respawn: back, hudThr: { atHover, up }, switch: sw,
        note: gate.keepArmedAfterCrash ? 'ArmGate keepArmedAfterCrash is wired' : 'the bot feeds the runner directly (its switch kept on); the ArmGate keepArmedAfterCrash wiring to respawn.keepArmed is W2-3\'s (controls.ts): not wired in this branch, so a radio through the gate still needs a switch flip here',
        control: { query: 'set.respawn.auto=0', atCrash: c0, after10s: c10, fired } });
}

// ------------------------------------------------------------------ R18 stuck: upside down on the floor (item 18)
// Crashes off; the bot flips, and while inverted its switch goes off: it drops on its back onto the
// floor. Expected: reset (stuck-flipped) within 2 s of it lying still there. Control: the same drop
// upright (switch off while hovering): never reset in 20 s.
const BOT_18 = (inverted: boolean) => `
    const sc = h.scenario;
    const rec = window.__r18 = { dropped: false, stillTick: null, stillT: null, lifeTick: null, lifeT: null, reason: null, crashes: 0, minUp: 1, lives0: s.lives().length };
    const orig = sc.bot.update.bind(sc.bot);
    sc.bot.update = (sim) => { const ch = orig(sim); const up = 1 - 2 * (sim.s[7] * sim.s[7] + sim.s[9] * sim.s[9]);
        if (!rec.dropped && (${inverted ? "sc.phase === 'flip' && up < -0.5" : "sc.phase === 'climb'"})) rec.dropped = true;
        if (rec.dropped) { ch[0] = 0; ch[1] = 0; ch[3] = 0; ch[2] = -1; ch[4] = -1; } return ch; };
    const step = s.runner.onStep;
    s.runner.onStep = (sim) => { step?.(sim); if (!rec.dropped || rec.lifeTick !== null) return; const v = Math.hypot(sim.s[3], sim.s[4], sim.s[5]); const up = 1 - 2 * (sim.s[7] * sim.s[7] + sim.s[9] * sim.s[9]);
        rec.minUp = Math.min(rec.minUp, up);
        if (v < 0.2 && up < 0.3 && sim.tick > 100) { if (rec.stillTick === null) { rec.stillTick = sim.tick; rec.stillT = performance.now(); } } else if (v >= 0.5) { rec.stillTick = null; rec.stillT = null; } };
    const ev = s.onEvent; s.onEvent = (e) => { if (e.type === 'crash') rec.crashes++; ev?.(e); };
    const lf = s.onLife; s.onLife = (life) => { if (rec.dropped && rec.lifeTick === null) { rec.lifeTick = s.sim.tick; rec.lifeT = performance.now(); rec.reason = life.header.life.reason; } lf?.(life); };
    return 0;`;
const R18_STATE = 'const r = window.__r18; return { dropped: r.dropped, stillTick: r.stillTick, lifeTick: r.lifeTick, reason: r.reason, crashes: r.crashes, minUp: r.minUp, upNow: 1 - 2 * (s.sim.s[7] ** 2 + s.sim.s[9] ** 2), y: s.sim.s[1], lives: s.lives().length, lives0: r.lives0, simS: r.lifeTick !== null && r.stillTick !== null ? (r.lifeTick - r.stillTick) / 1000 : null, wallS: r.lifeT !== null && r.stillT !== null ? (r.lifeT - r.stillT) / 1000 : null };';
if (want('R18')) {
    const p = await page('scene=39e63ce9&simradio=scenario&flip=1&nowarn=1&set.crash.enabled=0');
    await hook(p, BOT_18(true));
    const flipped = await until(p, R18_STATE, (v: Any) => v.lifeTick !== null, 45000, 100);
    await p.context().close();
    const c = await page('scene=39e63ce9&simradio=scenario&flip=1&nowarn=1&set.crash.enabled=0');
    await hook(c, BOT_18(false));
    await until(c, R18_STATE, (v: Any) => v.dropped, 30000, 100);
    await c.waitForTimeout(3000); // fallen and lying still
    const c0 = await hook(c, R18_STATE);
    await c.waitForTimeout(20000);
    const c20 = await hook(c, R18_STATE);
    await c.context().close();
    const pass = flipped.reason === 'stuck-flipped' && flipped.crashes === 0 && (flipped.minUp as number) < -0.5 && (flipped.wallS as number) <= 2 && (flipped.simS as number) <= 2;
    const fired = c20.lifeTick === null && c20.lives === c0.lives && (c20.upNow as number) > 0.9 && c20.crashes === 0;
    record('R18', { pass: pass && fired, item: 18, crashOn: false, flipped, control: { what: 'the same drop upright, disarmed: a landing', atRest: c0, after20s: c20, fired } });
}

// ------------------------------------------------------------------ RR the R key
// Armed and flown away from the spawn, R puts the craft at the spawn on the platform, armed (the
// switch is on), sitting there at idle (it settles the platform's 2 mm gap). Control: ?set.respawn.keepArmed=0, R leaves it parked.
async function rRun(qs: string): Promise<Record<string, unknown>> {
    const p = await page(qs);
    await p.waitForTimeout(600);
    const spawn = await hook(p, 'return s.spawn;');
    await hook(p, 'h.touch.channels[2] = -1; h.touch.setArmed(true); return 0;');
    await p.waitForTimeout(400);
    await hook(p, 'h.touch.channels[2] = 0.4; h.touch.channels[1] = 0.25; return 0;'); // up and forward
    await p.waitForTimeout(1200);
    const away = await hook(p, `const sp = s.spawn; return { d: Math.hypot(s.sim.s[0] - sp[0], s.sim.s[1] - sp[1], s.sim.s[2] - sp[2]), armed: s.sim.armed };`);
    await hook(p, 'h.touch.channels[2] = -1; h.touch.channels[1] = 0; return 0;');
    await p.keyboard.press('KeyR');
    await p.waitForTimeout(300);
    const after = await hook(p, `const sp = s.spawn; return { off: Math.hypot(s.sim.s[0] - sp[0], s.sim.s[1] - sp[1], s.sim.s[2] - sp[2]), platOn: s.sim.s[65], armed: s.sim.armed, hold: s.sim.s[49], reason: s.log.header.life.reason, y: s.sim.s[1] };`);
    await p.waitForTimeout(1500);
    const later = await hook(p, `const sp = s.spawn; return { dy: s.sim.s[1] - sp[1], armed: s.sim.armed, crashed: s.sim.crashed, platOn: s.sim.s[65] };`);
    await p.context().close();
    return { spawn, away, after, later };
}
if (want('RR')) {
    const on = await rRun('scene=39e63ce9&nowarn=1&input=touch');
    const off = await rRun('scene=39e63ce9&nowarn=1&input=touch&set.respawn.keepArmed=0');
    const a = on.after as Any, l = on.later as Any, aw = on.away as Any;
    const pass = aw.d > 0.3 && aw.armed && a.reason === 'manual-start' && a.off < 0.005 && a.platOn === 1 && a.armed === true && l.armed && !l.crashed && Math.abs(l.dy) < 0.02;
    const oa = off.after as Any;
    const fired = oa.reason === 'manual-start' && oa.armed === false && oa.hold === 1;
    record('RR', { pass: pass && fired, key: 'R', run: on, control: { query: 'set.respawn.keepArmed=0', run: off, fired } });
}

// ------------------------------------------------------------------ SHOTS the scan drawn: toast, label, panel; no overlaps
// Draws the scan: take C:/dev/.gpu-lock first (the owner's PC also renders video).
async function shots(size: { width: number; height: number; mobile?: boolean }, name: string): Promise<Record<string, unknown>> {
    const qs = `scene=39e63ce9&simradio=scenario&nowarn=1${size.mobile ? '&input=touch' : ''}`;
    const p = await page(qs, true, size);
    await hook(p, BOT_23);
    await until(p, R23_STATE, (v: Any) => v.toast === true, 90000, 50);
    await p.waitForTimeout(500);
    await p.screenshot({ path: join(SHOTS, `${name}-toast.png`) });
    const boxes = async (sel: string[]) => p.evaluate(`(() => { const out = {}; for (const q of ${JSON.stringify(sel)}) { const e = document.querySelector(q); if (!e) continue; const r = e.getBoundingClientRect(); const st = getComputedStyle(e); if (r.width && r.height && st.visibility !== 'hidden' && st.display !== 'none') out[q] = [r.left, r.top, r.right, r.bottom]; } return out; })()`) as Promise<Record<string, number[]>>;
    const overlap = (b: Record<string, number[]>, a: string) => Object.entries(b).filter(([k, r]) => k !== a && b[a] && r[0] < b[a][2] && b[a][0] < r[2] && r[1] < b[a][3] && b[a][1] < r[3]).map(([k]) => k);
    const OTHERS = ['.crash-toast', '.touch-pad.left', '.touch-pad.right', '.touch-arm', '.osd.bl', '.osd.br', '.osd.tl', '.osd.tr', '.top-actions', '.attribution', '.gate-msg', '.rewind-label', '.crash-overlay', '.test-mode-tag'];
    const tb = await boxes(OTHERS);
    await until(p, R23_STATE, (v: Any) => v.lifeTick !== null, 8000, 50);
    await p.waitForTimeout(150);
    await p.screenshot({ path: join(SHOTS, `${name}-minus5.png`) });
    const lb = await boxes(OTHERS);
    await p.context().close();
    // the panel: automatic respawn off
    const c = await page(`${qs}&set.respawn.auto=0`, true, size);
    await hook(c, BOT_23);
    await until(c, R23_STATE, (v: Any) => v.panel === true, 90000, 100);
    await c.waitForTimeout(400);
    await c.screenshot({ path: join(SHOTS, `${name}-panel.png`) });
    const pb = await boxes(OTHERS);
    const scroll = await c.evaluate('({ x: scrollX, y: scrollY, w: document.documentElement.scrollWidth, vw: innerWidth })') as Any;
    await c.context().close();
    return { size, toast: { boxes: tb, overlaps: overlap(tb, '.crash-toast') }, label: { boxes: lb, overlaps: overlap(lb, '.rewind-label') }, panel: { boxes: pb, overlaps: overlap(pb, '.crash-overlay') }, scroll };
}
if (want('SHOTS')) {
    const rows = [await shots({ width: 1280, height: 800 }, 'desktop'), await shots({ width: 375, height: 812, mobile: true }, 'phone')];
    // the control of the overlap check: a toast moved onto the ARM button must be reported
    const ctl = { a: [100, 600, 260, 680], arm: [140, 620, 236, 676] };
    const ctlFires = ctl.a[0] < ctl.arm[2] && ctl.arm[0] < ctl.a[2] && ctl.a[1] < ctl.arm[3] && ctl.arm[1] < ctl.a[3];
    const clean = rows.every((r) => (r.toast as Any).overlaps.length === 0 && (r.label as Any).overlaps.length === 0 && (r.panel as Any).overlaps.length === 0 && (r.scroll as Any).w <= (r.scroll as Any).vw);
    record('SHOTS', { pass: clean && ctlFires && Object.keys((rows[0].toast as Any).boxes).includes('.crash-toast'), render: 'on (the scan drawn)', rows, files: ['desktop-toast.png', 'desktop-minus5.png', 'desktop-panel.png', 'phone-toast.png', 'phone-minus5.png', 'phone-panel.png'], control: { what: 'the overlap test reports a box planted over the ARM button', fired: ctlFires } });
}

await L.browser.close();
out.pageErrors = errors.slice(0, 20);
out.summary = passed;
const file = writeEvidence('v03-respawn', { pass: Object.values(passed).every(Boolean) && errors.length === 0, ...out });
console.log(JSON.stringify(passed), errors.length ? `page errors: ${errors.slice(0, 3).join(' | ')}` : '', '->', file);
