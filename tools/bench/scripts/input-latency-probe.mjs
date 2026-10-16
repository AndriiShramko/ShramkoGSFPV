// Input pipeline latency of a DJI FPV Remote Controller 3 on the Gamepad API path against the WebHID
// path (the owner's message 21, item 7: "with the DJI controller the delay feels much higher"), on a
// release build drawing a real scan, in this machine's Chrome at this display's rate. No hardware: a
// fake controller in the page (an init script) changes its roll stick at known moments E (every
// ~0.4 s, off any frame rhythm) and the page's own source reads it as it reads the real one:
//   gamepad  navigator.getGamepads() returns a DJI pad ("HID Interface (Vendor: 2ca3 Product: 1021)",
//            5 axes, 24 buttons) whose state changes at E with Gamepad.timestamp = E, as the browser's
//            gamepad thread fills its shared buffer whatever the page's main thread is doing;
//            GamepadSource polls it (devices/gamepad.ts);
//   hid      navigator.hid hands over a DJI device (its descriptor, 13-byte reports at 160 Hz from a
//            timer: a report after E carries the new value and is dispatched when the main thread is
//            free, stamped then; whether Chrome stamps a real HIDInputReportEvent at arrival or when
//            the page handles it was not checked).
// Both go through the recognised controller's check screen (no wizard: known-devices.ts) and Fly. Then
// every channel frame the session receives is recorded (FlightSession.input wrapped): its arrival
// (performance.now()) and its stamp (the page time the physics applies it at, simclock.ts). Per edge:
//   delivery = first arrival with the new value - E   (when the page has it)
//   stamp    = its stamp - E                           (how late the physics thinks it happened)
//   frame    = first animation frame at or after the arrival - E (the frame that can show it)
// `busy`: every animation frame also blocks the main thread for that many ms (a heavier scan).
// Negative control `hid-late20`: the fake HID device dispatches every report 20 ms late; its delivery
// must come out ~20 ms above the plain hid run, or this probe does not measure what it says.
// Usage: node input-latency-probe.mjs <base with the locale, e.g. http://localhost:5390/en> <outDir> [runs]
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { browserRecord, pickHarnessBrowser } from './visual-browser.mjs';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '');
const require = createRequire(ROOT + '/tools/bench/package.json');
const { chromium } = require('playwright');
const base = process.argv[2] ?? 'http://localhost:5390/en';
const outDir = process.argv[3] ?? ROOT + '/.cache/input-latency';
const only = process.argv[4] ? process.argv[4].split(',') : null;
mkdirSync(outDir, { recursive: true });

const P1 = 0x10000;
const P9 = 0x90000;
const DJI = [{ usagePage: 1, usage: 5, children: [], inputReports: [{ reportId: 0, items: [
    { isConstant: false, isArray: false, isRange: false, usages: [0x30, 0x31, 0x32, 0x33, 0x34].map((u) => P1 | u), reportSize: 16, reportCount: 5, logicalMinimum: -660, logicalMaximum: 660 },
    { isConstant: false, isArray: false, isRange: true, usageMinimum: P9 | 1, usageMaximum: P9 | 24, reportSize: 1, reportCount: 24, logicalMinimum: 0, logicalMaximum: 1 }] }] }];

const RUNS = [
    { name: 'gamepad', path: 'gamepad', busy: 0 },
    { name: 'hid', path: 'hid', busy: 0 },
    { name: 'gamepad-busy25', path: 'gamepad', busy: 25 },
    { name: 'hid-busy25', path: 'hid', busy: 25 },
    { name: 'hid-late20', path: 'hid', busy: 0, late: 20 }
].filter((r) => !only || only.includes(r.name));
const EDGES = 36;

/** In the page, before the app: the fake DJI controller on the asked path, its roll stick on a schedule. */
function installFake(cfg) {
    const ROLL = 0.6;
    const sched = { t0: Infinity };
    // edges at t0 + k * ~397 ms (the k*37 % 50 wobble keeps them off any frame rhythm)
    const edgeAt = (k) => sched.t0 + k * 397 + ((k * 37) % 50);
    const state = (t) => {
        if (!(t >= sched.t0)) return { k: -1, v: 0, e: 0 };
        let k = Math.floor((t - sched.t0) / 397) + 1;
        while (k > 0 && edgeAt(k) > t) k--;
        while (edgeAt(k + 1) <= t) k++;
        return { k, v: k % 2 === 1 ? ROLL : 0, e: edgeAt(k) };
    };
    window.__lat = { sched, edgeAt, start: (t) => { sched.t0 = t; } };
    if (cfg.path === 'gamepad') {
        const buttons = Array.from({ length: 24 }, (_, i) => ({ get pressed() { return i === 4 || i === 6; }, get value() { return i === 4 || i === 6 ? 1 : 0; }, touched: false }));
        const loaded = performance.now();
        const pad = {
            id: 'HID Interface (Vendor: 2ca3 Product: 1021)', index: 0, connected: true, mapping: '', vibrationActuator: null,
            get axes() { const s = state(performance.now()); return [s.v, 0, 0, 0, 0]; },
            buttons,
            get timestamp() { const s = state(performance.now()); return s.k >= 0 ? s.e : loaded; }
        };
        Object.defineProperty(Navigator.prototype, 'getGamepads', { value: () => [pad, null, null, null], configurable: true });
    } else {
        class FakeHidDevice extends EventTarget {
            constructor() { super(); this.vendorId = 0x2ca3; this.productId = 0x1021; this.productName = 'HID Interface'; this.collections = cfg.collections; this.opened = false; this.timer = 0; }
            async open() {
                this.opened = true;
                this.timer = setInterval(() => {
                    const s = state(performance.now());
                    const b = new Uint8Array(13);
                    const dv = new DataView(b.buffer);
                    dv.setInt16(0, Math.round(s.v * 660), true);
                    b[10] = 0x50;
                    const send = () => {
                        const e = new Event('inputreport');
                        Object.defineProperties(e, { device: { value: this }, reportId: { value: 0 }, data: { value: dv } });
                        this.dispatchEvent(e);
                    };
                    if (cfg.late) setTimeout(send, cfg.late); else send();
                }, 6);
            }
            async close() { this.opened = false; clearInterval(this.timer); }
        }
        const dev = new FakeHidDevice();
        const hid = { requestDevice: async () => [dev], getDevices: async () => [], addEventListener() {}, removeEventListener() {} };
        Object.defineProperty(Navigator.prototype, 'hid', { get: () => hid, configurable: true });
    }
}

/** In the page, once flying: record every channel frame the session gets and every animation frame; optional main-thread load per frame. */
function record(busy) {
    const s = window.__gsfpv.session;
    const rec = { samples: [], frames: [] };
    window.__rec = rec;
    const orig = s.input.bind(s);
    s.input = (ch, t, id) => { rec.samples.push([performance.now(), t, ch[0]]); return orig(ch, t, id); };
    const loop = (ts) => {
        rec.frames.push(performance.now());
        if (busy > 0) { const end = performance.now() + busy; while (performance.now() < end) { /* a heavier scan */ } }
        requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
}

const q = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))] * 10) / 10; };

const pick = pickHarnessBrowser({ expected: chromium.executablePath() }, true);
const browser = await chromium.launch({ ...pick.launch, headless: false });
const out = { what: 'input pipeline latency, Gamepad API vs WebHID, fake DJI FPV Remote Controller 3 (input-latency-probe.mjs)', base, edges: EDGES };
{
    const probe = await browser.newContext();
    out.browser = await browserRecord(pick, await probe.newPage(), { visual: true, version: browser.version() });
    await probe.close();
}
for (const run of RUNS) {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 160)));
    await page.addInitScript(installFake, { path: run.path, collections: DJI, late: run.late ?? 0 });
    await page.goto(`${base}/fly/?scene=39e63ce9&nowarn=1`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__gsfpv?.status === 'ready' && document.querySelector('.screen.radio'), null, { timeout: 120000 });
    // the gamepad path opens its check screen by itself (a recognised pad on the device choice); WebHID by its button
    if (run.path === 'hid') await page.locator('.screen.radio .choice button').first().click();
    await page.waitForFunction(() => window.__gsfpv?.radio?.wizard?.state?.id === 'check', null, { timeout: 30000 });
    const check = await page.evaluate(() => ({
        note: document.querySelector('[data-testid=known-note]')?.textContent ?? null,
        controls: document.querySelectorAll('[data-testid=known-controls] .kp-row').length,
        known: window.__gsfpv.radio.wizard.state.profile?.known ?? null,
        name: window.__gsfpv.radio.wizard.state.profile?.deviceName ?? null
    }));
    await page.screenshot({ path: `${outDir}/${run.name}-check.png` });
    await page.locator('[data-action=wizard-done]').click();
    await page.waitForFunction((k) => window.__gsfpv?.controls?.source === k && !document.querySelector('.screen.radio'), run.path, { timeout: 15000 });
    await page.evaluate(record, run.busy);
    await page.waitForTimeout(1500);
    const t0 = await page.evaluate(() => { const t = performance.now() + 300; window.__lat.start(t); return t; });
    await page.waitForTimeout(300 + EDGES * 400 + 800);
    const data = await page.evaluate((n) => ({ samples: window.__rec.samples, frames: window.__rec.frames, edges: Array.from({ length: n }, (_, k) => window.__lat.edgeAt(k + 1)) }), EDGES);
    await page.screenshot({ path: `${outDir}/${run.name}-flight.png` });
    await ctx.close();
    const delivery = [], stamp = [], frame = [];
    for (let k = 0; k < data.edges.length; k++) {
        const e = data.edges[k];
        const want = (k + 1) % 2 === 1; // odd edges move the stick to 0.6, even ones back to 0
        const s = data.samples.find((x) => x[0] >= e && (want ? x[2] > 0.3 : x[2] < 0.3));
        if (!s) continue;
        delivery.push(s[0] - e);
        stamp.push(s[1] - e);
        const f = data.frames.find((x) => x >= s[0]);
        if (f !== undefined) frame.push(f - e);
    }
    const gaps = data.frames.slice(1).map((x, i) => x - data.frames[i]);
    const stats = (a) => ({ n: a.length, p50: q(a, 0.5), p90: q(a, 0.9), max: q(a, 1) });
    out[run.name] = { run, check, framePeriodMs: q(gaps, 0.5), samples: data.samples.length, delivery: stats(delivery), stamp: stats(stamp), frame: stats(frame), errors, t0 };
    console.log(run.name, JSON.stringify({ check: { known: check.known, controls: check.controls }, framePeriodMs: out[run.name].framePeriodMs, delivery: out[run.name].delivery, stamp: out[run.name].stamp, frame: out[run.name].frame, errors: errors.length }));
}
await browser.close();
// the control: 20 ms of extra dispatch delay must show as ~20 ms more delivery
if (out.hid && out['hid-late20']) {
    const d = out['hid-late20'].delivery.p50 - out.hid.delivery.p50;
    out.control = { addedMs: 20, measuredMs: Math.round(d * 10) / 10, fired: d > 15 && d < 25 };
}
writeFileSync(`${outDir}/result.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify({ browser: out.browser?.version, webgl: out.browser?.webgl, control: out.control }, null, 1));
