// Lane ground-probe page probe (docs/wip/ground-probe.md, step 4): a fast radio in the centred throttle style.
// A fake DJI FPV Remote Controller 3 on navigator.hid (the descriptor and 13-byte reports of centre-throttle-probe.mjs)
// delivers 500 and then 1000 reports a second, each report in its own task (a MessageChannel pacer on the page clock:
// a timer cannot go under 4 ms; reports that fall due while the page is busy are delivered one after another when it
// is free again, as a real device's queued reports are). One flight of 20 s per rate: the left stick up for 3 s, then
// let go to the centre for 17 s. No arming control is touched.
// A third run, 500b4, is the pattern of the DJI RC 2 source in the hang evidence (evidence/2026-11-13/rc2 on branch rc2:
// answers ride on timers, a late wake fills four request slots at once): a timer every 6 ms hands over the reports
// that fell due, up to four back to back in one task, 500 a second.
// Checks per rate:
//   keepsUp       the page took at least 90 % of the reports that fell due (it does not fall behind the radio)
//   renders       frames per second over the flight >= FPS_MIN and the longest gap between two frames <= FRAME_GAP_MAX_MS
//   mainThread    the longest gap between two pacer tasks <= TASK_GAP_MAX_MS (nothing held the page that long)
//   climbs        up for 3 s: armed, not crashed, at least 1 m higher (centre-throttle-probe's estimate of "in the air")
//   holds         the last 10 s at the centre: the height stays within 0.5 m (app-centre-throttle.test.ts's bound), armed
//   motorsSteady  once the motors are on they stay on: the model never drops out of armed, the pilot's arm state
//                 changes at most twice (off, arming, on)
// The bounds are measured on this PC, see the status file ("Fast radio probe"): FPS_MIN, FRAME_GAP_MAX_MS, TASK_GAP_MAX_MS.
// Last line: JSON {pass, checks}; exit 0 only on pass. Against a build of origin/main bbc9e75e it must fail.
// Usage: node fast-radio-probe.mjs <base with the locale, e.g. http://localhost:5620/en> <out.json> [runs, 500,1000,500b4] [scene]
//        FAST_RADIO_SECONDS (20), FAST_RADIO_SHOTS (folder for the end pictures, default the out file's). Needs the GPU lock C:/dev/.gpu-lock around it (it does not take the lock itself).
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { browserRecord, pickHarnessBrowser } from './visual-browser.mjs';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '');
const require = createRequire(ROOT + '/tools/bench/package.json');
const { chromium } = require('playwright');
const base = process.argv[2] ?? 'http://localhost:5620/en';
const outFile = process.argv[3] ?? ROOT + '/.cache/fast-radio-probe.json';
const rates = (process.argv[4] && process.argv[4] !== 'all' ? process.argv[4] : '500,1000,500b4').split(',').map((x) => { const m = /^(\d+)(?:b(\d+))?$/.exec(x); return { name: `r${x}`, rate: Number(m[1]), burst: m[2] ? Number(m[2]) : 1 }; });
const scene = process.argv[5] ?? '887f27aa';
const SECONDS = Number(process.env.FAST_RADIO_SECONDS || 20);
const UP_S = 3;
const SHOTS = (process.env.FAST_RADIO_SHOTS || dirname(outFile)).replace(/\\/g, '/');
mkdirSync(dirname(outFile), { recursive: true });
mkdirSync(SHOTS, { recursive: true });

// measured bounds (docs/wip/ground-probe.md, "Fast radio probe")
const FPS_MIN = 24;
const FRAME_GAP_MAX_MS = 150;
const TASK_GAP_MAX_MS = 100;

const P1 = 0x00010000, P9 = 0x00090000;
const djiButtons = { isConstant: false, isArray: false, isRange: true, usageMinimum: P9 | 1, usageMaximum: P9 | 24, reportSize: 1, reportCount: 24, logicalMinimum: 0, logicalMaximum: 1 };
const DJI = [{ usagePage: 1, usage: 5, children: [], inputReports: [{ reportId: 0, items: [
    { isConstant: false, isArray: false, isRange: false, usages: [0x30, 0x31, 0x32, 0x33, 0x34].map((u) => P1 | u), reportSize: 16, reportCount: 5, logicalMinimum: -660, logicalMaximum: 660 }, djiButtons] }] }];
const REST = 11 / 660; // the DJI's measured rest offset (known-devices.ts)

/** In the page, before the app: the fake DJI at cfg.rate reports a second, and the watch (window.__mon). */
function installFastDji(cfg) {
    const hands = { A: 0, E: 0, T: cfg.T, R: 0 };
    window.__hands = hands;
    const mon = { on: false, t0: 0, frames: [], sent: 0, due0: 0, dropped: 0, taskGapMax: 0, taskGapAt: 0 };
    window.__mon = mon;
    const order = ['A', 'E', 'T', 'R'];
    const report = () => {
        const b = new Uint8Array(13);
        const dv = new DataView(b.buffer);
        for (let i = 0; i < 4; i++) dv.setInt16(i * 2, Math.round(Math.max(-1, Math.min(1, hands[order[i]])) * 660), true);
        dv.setInt16(8, 0, true);
        b[10] = 0x50; // bits 4 and 6 held (mode switch N = angle); start/stop never pressed
        return b;
    };
    let dueAll = 0;
    class FakeHidDevice extends EventTarget {
        constructor() { super(); this.vendorId = 0x2ca3; this.productId = 0x1021; this.productName = 'HID Interface'; this.collections = cfg.collections; this.opened = false; }
        async open() {
            this.opened = true;
            const ch = new MessageChannel();
            const t0 = performance.now();
            let sent = 0, last = t0;
            const wake = () => {
                if (!this.opened) return;
                const now = performance.now();
                if (mon.on && now - last > mon.taskGapMax) { mon.taskGapMax = now - last; mon.taskGapAt = now - mon.t0; }
                last = now;
                let due = Math.floor(((now - t0) * cfg.rate) / 1000);
                dueAll = due;
                // a device's queue is not endless: more than a second behind, the oldest reports are lost
                if (due - sent > cfg.rate) { if (mon.on) mon.dropped += due - sent - cfg.rate; sent = due - cfg.rate; }
                for (let k = 0; sent < due && k < cfg.burst; k++) {
                    sent++;
                    if (mon.on) mon.sent++;
                    const e = new Event('inputreport');
                    Object.defineProperties(e, { device: { value: this }, reportId: { value: 0 }, data: { value: new DataView(report().buffer) } });
                    this.dispatchEvent(e);
                }
                if (cfg.burst > 1) setTimeout(wake, 6);
                else ch.port2.postMessage(0);
            };
            ch.port1.onmessage = wake;
            wake();
        }
        async close() { this.opened = false; }
    }
    const dev = new FakeHidDevice();
    const hid = { requestDevice: async () => [dev], getDevices: async () => [], addEventListener() {}, removeEventListener() {} };
    Object.defineProperty(Navigator.prototype, 'hid', { get: () => hid, configurable: true });
    mon.start = () => { mon.frames = []; mon.sent = 0; mon.dropped = 0; mon.taskGapMax = 0; mon.due0 = dueAll; mon.t0 = performance.now(); mon.on = true; };
    mon.read = () => {
        const f = mon.frames;
        const secs = f.length > 1 ? (f[f.length - 1][0] - f[0][0]) / 1000 : 0;
        let gap = 0, gapAt = 0, drops = 0, armChanges = 0, firstArmed = -1;
        const perS = [];
        for (let i = 0; i < f.length; i++) {
            const sec = Math.floor(f[i][0] / 1000);
            perS[sec] = (perS[sec] ?? 0) + 1;
            if (i === 0) continue;
            if (f[i][0] - f[i - 1][0] > gap) { gap = f[i][0] - f[i - 1][0]; gapAt = f[i][0]; }
            if (firstArmed < 0 && f[i][2]) firstArmed = i;
            if (f[i - 1][2] && !f[i][2]) drops++;
            if (f[i][4] !== f[i - 1][4]) armChanges++;
        }
        const late = f.filter((x) => x[0] >= (cfg.seconds - 10) * 1000 && x[1] !== null);
        const alts = late.map((x) => x[1]);
        return {
            seconds: secs, frames: f.length, fps: secs > 0 ? (f.length - 1) / secs : 0, fpsBySecond: Array.from(perS, (v) => v ?? 0),
            frameGapMaxMs: gap, frameGapAtMs: gapAt, taskGapMaxMs: mon.taskGapMax, taskGapAtMs: mon.taskGapAt,
            reportsSent: mon.sent, reportsDue: dueAll - mon.due0, reportsDropped: mon.dropped,
            armedDrops: drops, armStateChanges: armChanges, armedFrom: firstArmed, armStates: [...new Set(f.map((x) => x[4]))],
            crashed: f.some((x) => x[3]), altStart: f.length ? f[0][1] : null, altEnd: f.length ? f[f.length - 1][1] : null,
            lateSpanM: alts.length ? Math.max(...alts) - Math.min(...alts) : null, lateFrames: late.length, lateArmed: late.length > 0 && late.every((x) => x[2]),
            trace: f.filter((_, i) => i % 30 === 0).map((x) => [Math.round(x[0]), x[1] === null ? null : Math.round(x[1] * 100) / 100, x[2], x[4]])
        };
    };
    const raf = () => {
        if (mon.on) {
            const g = window.__gsfpv;
            const hd = g?.session?.hud?.();
            mon.frames.push([performance.now() - mon.t0, hd?.altitude ?? null, hd?.armed ? 1 : 0, hd?.crashed ? 1 : 0, String(g?.throttle?.().centre?.arm ?? '')]);
        }
        requestAnimationFrame(raf);
    };
    requestAnimationFrame(raf);
}

/** A page that stopped answering must not hang the probe. */
const within = (p, ms, what) => {
    let timer;
    return Promise.race([p, new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`no answer in ${ms} ms: ${what}`)), ms); })]).finally(() => clearTimeout(timer));
};

const pick = pickHarnessBrowser({ expected: chromium.executablePath() }, false);
const browser = await chromium.launch({ ...pick.launch, headless: true });
const out = { what: 'fast-radio-probe.mjs: a fake DJI FPV Remote Controller 3 at 500 and 1000 reports a second, centred style', base, scene, seconds: SECONDS, bounds: { FPS_MIN, FRAME_GAP_MAX_MS, TASK_GAP_MAX_MS }, at: new Date().toISOString(), runs: {} };
{
    const c = await browser.newContext();
    out.browser = await browserRecord(pick, await c.newPage(), { visual: false, version: browser.version() });
    await c.close();
}
const allChecks = {};
for (const { name, rate, burst } of rates) {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 160)));
    await page.addInitScript(installFastDji, { collections: DJI, T: REST, rate, burst, seconds: SECONDS });
    const checks = { keepsUp: false, renders: false, mainThread: false, climbs: false, holds: false, motorsSteady: false };
    const note = {};
    const t0 = Date.now();
    const step = (s) => { note.lastStep = s; process.stderr.write(`[${name} ${Math.round((Date.now() - t0) / 1000)} s] ${s}\n`); };
    try {
        step('open');
        await page.goto(`${base}/fly/?scene=${scene}&nowarn=1&set.input.howToFly=false`, { waitUntil: 'load', timeout: 120000 });
        await page.waitForFunction(() => window.__gsfpv?.status === 'ready' && document.querySelector('.screen.radio .choice button'), null, { timeout: 120000 });
        step('connect');
        await page.locator('.screen.radio .choice button').first().click({ timeout: 30000 });
        await page.waitForFunction(() => window.__gsfpv?.radio?.wizard?.state?.id === 'check', null, { timeout: 60000 });
        await page.waitForTimeout(1200); // the check screen watches where the throttle rests (0.5 s still)
        note.checkStyle = await within(page.evaluate(() => document.querySelector('[data-testid=throttle-style-row]')?.getAttribute('data-style') ?? null), 15000, 'check row');
        step('fly');
        await page.locator('[data-action=wizard-done]').click({ timeout: 30000 });
        await page.waitForFunction(() => !document.querySelector('.screen.radio'), null, { timeout: 30000 });
        await page.waitForTimeout(1500); // the connection's rest watch
        note.style = await within(page.evaluate(() => window.__gsfpv?.throttle?.().now ?? null), 15000, 'style');
        step('stick up');
        await within(page.evaluate(() => { window.__mon.start(); window.__hands.T = 0.6; }), 15000, 'stick up');
        await new Promise((r) => setTimeout(r, UP_S * 1000));
        note.up = await within(page.evaluate((rest) => { const hd = window.__gsfpv.session.hud(); window.__hands.T = rest; return { alt: hd.altitude, armed: !!hd.armed, crashed: !!hd.crashed, atMs: performance.now() - window.__mon.t0 }; }, REST), 15000, 'let go');
        step('centre');
        await new Promise((r) => setTimeout(r, (SECONDS - UP_S) * 1000));
        const m = await within(page.evaluate(() => { const r = window.__mon.read(); window.__mon.on = false; return r; }), 15000, 'read the watch');
        step('read');
        note.watch = m;
        const perS = m.seconds > 0 ? m.reportsSent / m.seconds : 0;
        note.reportsPerS = Math.round(perS);
        note.climbM = m.altStart !== null && note.up.alt !== null ? note.up.alt - m.altStart : null;
        checks.keepsUp = m.reportsDue > 0 && m.reportsSent >= 0.9 * m.reportsDue && m.reportsDropped === 0;
        checks.renders = m.seconds >= SECONDS - 1 && m.fps >= FPS_MIN && m.frameGapMaxMs <= FRAME_GAP_MAX_MS;
        checks.mainThread = m.taskGapMaxMs <= TASK_GAP_MAX_MS;
        checks.climbs = note.style === 'centred' && note.up.armed && !note.up.crashed && note.climbM !== null && note.climbM >= 1.0;
        checks.holds = m.lateFrames > 0 && m.lateArmed && !m.crashed && m.lateSpanM !== null && m.lateSpanM <= 0.5;
        checks.motorsSteady = m.armedFrom >= 0 && m.armedDrops === 0 && m.armStateChanges <= 2;
    } catch (e) {
        errors.push(`probe: ${String(e.message).slice(0, 200)}`);
    }
    await within(page.screenshot({ path: `${SHOTS}/${outFile.replace(/^.*\//, '').replace(/\.json$/, '')}-${name}.png` }), 10000, 'screenshot').catch(() => undefined);
    checks.noPageErrors = errors.length === 0;
    const pass = Object.values(checks).every(Boolean);
    out.runs[name] = { pass, rate, burst, seconds: Math.round((Date.now() - t0) / 1000), checks, note, errors };
    for (const [k, v] of Object.entries(checks)) allChecks[`${name}.${k}`] = v;
    out.pass = Object.values(allChecks).every(Boolean);
    out.checks = allChecks;
    writeFileSync(outFile, JSON.stringify(out, null, 1));
    await within(ctx.close(), 10000, 'close the page').catch(() => undefined);
}
await within(browser.close(), 10000, 'close the browser').catch(() => undefined);
const pass = rates.length > 0 && Object.values(allChecks).every(Boolean);
out.pass = pass;
out.checks = allChecks;
writeFileSync(outFile, JSON.stringify(out, null, 1));
console.log(JSON.stringify({ pass, checks: allChecks }));
process.exit(pass ? 0 : 1);
