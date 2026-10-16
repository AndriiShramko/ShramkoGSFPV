// HidSource on a page: a fake navigator.hid (an init script) hands the app a WebHID device with a
// real descriptor that sends real input reports as `inputreport` events; the pilot clicks "Radio or
// controller over USB", and the app takes the device the way it takes a real one: HidSource.request,
// open, makeHidReader on device.collections, e.reportId and e.data per event, the profile key and the
// display name (apps/fly/src/devices/hid.ts, ui/radio.ts connectHid). No ?simradio: not the fake radio
// of the page tests (that one calls makeHidReader itself). The device's hands follow the wizard's
// screens like the SimRadio robot that presses nothing (auto pacing), so a readable device reaches
// the check screen by itself. v0.8: a recognised controller (packages/input known-devices.ts) skips
// the wizard: its known setup opens on the check screen at once. Runs:
//   dji          DJI RC 3, its descriptor as Chromium builds it from the report descriptor, 13-byte reports:
//                recognised, the check screen at once (no wizard step), its name, 11 controls live
//   dji-windows  the same controller in the shape Chromium builds on Windows (one item per axis)
//   edgetx       an EdgeTX radio (Classic), its descriptor from the EdgeTX source, 19-byte reports:
//                named (its channels are the pilot's model), the wizard to the check as before
//   dji-other    negative control of the recognition: the DJI's USB ids with another shape (2 axes):
//                not recognised, the wizard starts (and cannot finish with 2 axes)
//   dji-none     negative control: the DJI's reports from a device whose browser gives no descriptor
//                (the fixed EdgeTX layout, as every device was read before the fix): every report is
//                refused, the wizard stays at connect and says so
// The device choice's pad watch (ui/radio.ts watchPads: a recognised pad on the Gamepad API opens by
// itself) with the same DJI also on the Gamepad API, shown 300 ms after the click (a stick moved):
//   dji-pad-chooser  WebHID picked, the chooser open 3 s: the pick stands, the WebHID device opens
//                    (not the pad that showed meanwhile)
//   dji-pad-cancel   the chooser closed with no device after 0.8 s: the watch runs again, the pad
//                    opens its check after the chooser closed
//   dji-pad-nopick   control of dji-pad-chooser: nothing clicked, the same pad opens its check well
//                    inside the 3 s the chooser was open there, so a watch left running would have
//                    taken over
// Usage: node hid-source-probe.mjs <base with the locale, e.g. http://localhost:5390/en> <outDir> [run,run...]
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { browserRecord, pickHarnessBrowser } from './visual-browser.mjs';
// repo root (tools/bench/scripts/ -> ../../..): no machine-specific paths
const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '');
const require = createRequire(ROOT + '/tools/bench/package.json');
const { chromium } = require('playwright');
const base = process.argv[2] ?? 'http://localhost:5390/en';
const outDir = process.argv[3] ?? ROOT + '/.cache/hid-source-probe';
const only = process.argv[4] ? process.argv[4].split(',') : null; // some runs by name (default: all)
mkdirSync(outDir, { recursive: true });

// the descriptors, as WebHID's device.collections (packages/input/src/sim/devices.ts DJI_RC3,
// DJI_RC3_WINDOWS, EDGETX_CLASSIC; written out here so the page gets plain data)
const P1 = 0x10000;
const P9 = 0x90000;
const djiButtons = { isConstant: false, isArray: false, isRange: true, usageMinimum: P9 | 1, usageMaximum: P9 | 24, reportSize: 1, reportCount: 24, logicalMinimum: 0, logicalMaximum: 1 };
const DJI = [{ usagePage: 1, usage: 5, children: [], inputReports: [{ reportId: 0, items: [
    { isConstant: false, isArray: false, isRange: false, usages: [0x30, 0x31, 0x32, 0x33, 0x34].map((u) => P1 | u), reportSize: 16, reportCount: 5, logicalMinimum: -660, logicalMaximum: 660 }, djiButtons] }] }];
const DJI_WIN = [{ usagePage: 1, usage: 5, children: [], inputReports: [{ reportId: 0, items: [
    ...[0x30, 0x31, 0x32, 0x33, 0x34].map((u) => ({ isConstant: false, isArray: false, isRange: false, usages: [P1 | u], reportSize: 16, reportCount: 1, logicalMinimum: -660, logicalMaximum: 660 })), djiButtons] }] }];
const edgeItems = [
    { isConstant: false, isArray: false, isRange: true, usageMinimum: P9 | 1, usageMaximum: P9 | 24, reportSize: 1, reportCount: 24, logicalMinimum: 0, logicalMaximum: 1 },
    { isConstant: false, isArray: false, isRange: false, usages: [0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37].map((u) => P1 | u), reportSize: 16, reportCount: 8, logicalMinimum: 0, logicalMaximum: 2047 }];
const EDGETX = [{ usagePage: 1, usage: 5, inputReports: [{ reportId: 0, items: edgeItems }], children: [{ usagePage: 1, usage: 0, inputReports: [{ reportId: 0, items: edgeItems }], children: [] }] }];

// the DJI on the Gamepad API (its id string as Chrome on Windows gives it, 5 axes, 24 buttons, no
// standard mapping): its profile key (apps/fly/src/devices/gamepad.ts gamepadKey)
const PAD_ID = 'HID Interface (Vendor: 2ca3 Product: 1021)';
const PAD_KEY = `gp:${PAD_ID}:5:24:`;
const CHOOSER_MS = 3000; // the pilot looking for the device in the WebHID chooser (dji-pad-chooser)

const DJI_2AXES = [{ usagePage: 1, usage: 5, children: [], inputReports: [{ reportId: 0, items: [
    { isConstant: false, isArray: false, isRange: false, usages: [0x30, 0x31].map((u) => P1 | u), reportSize: 16, reportCount: 2, logicalMinimum: -660, logicalMaximum: 660 },
    { isConstant: true, reportSize: 16, reportCount: 3 }, djiButtons] }] }];

const RUNS = [
    { name: 'dji', kind: 'dji', vendorId: 0x2ca3, productId: 0x1021, productName: 'HID Interface', collections: DJI, rateHz: 160, expect: { key: 'hid:2ca3:1021:HID Interface:13:d', name: 'DJI FPV Remote Controller', end: 'check', known: 'dji-virtual-joystick', controls: 11, wizard: false } },
    { name: 'dji-windows', kind: 'dji', vendorId: 0x2ca3, productId: 0x1021, productName: 'HID Interface', collections: DJI_WIN, rateHz: 160, expect: { key: 'hid:2ca3:1021:HID Interface:13:d', name: 'DJI FPV Remote Controller', end: 'check', known: 'dji-virtual-joystick', controls: 11, wizard: false } },
    { name: 'edgetx', kind: 'edgetx', vendorId: 0x1209, productId: 0x4f54, productName: 'RadioMaster TX16S Joystick', collections: EDGETX, rateHz: 500, expect: { key: 'hid:1209:4f54:RadioMaster TX16S Joystick:19', name: 'RadioMaster TX16S Joystick', end: 'check', known: 'edgetx-joystick', controls: 0, wizard: true } },
    { name: 'dji-other', kind: 'dji', vendorId: 0x2ca3, productId: 0x1021, productName: 'HID Interface', collections: DJI_2AXES, rateHz: 160, expect: { end: 'wizard', known: null } },
    { name: 'dji-none', kind: 'dji', vendorId: 0x2ca3, productId: 0x1021, productName: 'HID Interface', collections: [], rateHz: 160, expect: { end: 'connect', refused: true } },
    { name: 'dji-pad-chooser', kind: 'dji', vendorId: 0x2ca3, productId: 0x1021, productName: 'HID Interface', collections: DJI, rateHz: 160, pad: { showMs: 300 }, chooserMs: CHOOSER_MS, expect: { key: 'hid:2ca3:1021:HID Interface:13:d', name: 'DJI FPV Remote Controller', end: 'check', known: 'dji-virtual-joystick', controls: 11, wizard: false, requested: 1 } },
    { name: 'dji-pad-cancel', kind: 'dji', vendorId: 0x2ca3, productId: 0x1021, productName: 'HID Interface', collections: DJI, rateHz: 160, pad: { showMs: 300 }, chooserMs: 800, cancel: true, expect: { end: 'pad', key: PAD_KEY, known: 'dji-virtual-joystick', requested: 1, afterMs: 800 } },
    { name: 'dji-pad-nopick', kind: 'dji', vendorId: 0x2ca3, productId: 0x1021, productName: 'HID Interface', collections: DJI, rateHz: 160, pad: { showMs: 300 }, click: false, expect: { end: 'pad', key: PAD_KEY, known: 'dji-virtual-joystick', requested: 0, withinMs: CHOOSER_MS } }
];

/** In the page, before the app: navigator.hid with one fake device whose hands follow the wizard. */
function installFakeHid(cfg) {
    const SLEW = 2 / 150; // full travel in 150 ms
    const STIR_MIN_MS = 1700;
    const REACT_MS = 400;
    const FN = { throttle: 'T', yaw: 'R', roll: 'A', pitch: 'E' };
    const ORDER = 'TAER'; // channels 1..4; channel 5 is the arm switch (the DJI's wheel axis)
    let seed = 12345;
    const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 4294967296; };
    const sticks = { A: 0, E: 0, T: -1, R: 0 };
    const want = { A: 0, E: 0, T: -1, R: 0 };
    let arm = false, seenKey = '', seenAt = 0, doKey = '', followT0 = 0, stirStop = false, offSeenAt = NaN, lastT = NaN;
    const probe = { requested: 0, opened: 0, sent: 0, listeners: 0 };
    window.__hidProbe = probe;
    function hands(now) {
        const dt = Number.isNaN(lastT) ? 0 : Math.max(0, Math.min(100, now - lastT));
        lastT = now;
        const st = window.__gsfpv?.radio?.wizard?.state;
        if (st) {
            const k = st.stage ? `${st.id}/${st.stage}` : st.id;
            if (k !== seenKey) { seenKey = k; seenAt = now; }
            if (doKey !== seenKey && now - seenAt >= REACT_MS) { doKey = seenKey; stirStop = false; followT0 = now; offSeenAt = NaN; }
            const [id, stage] = doKey.split('/');
            const el = now - followT0;
            const centred = () => { want.A = 0; want.E = 0; want.R = 0; };
            if (id === 'stir') {
                arm = false;
                if (stage === 'active') {
                    if (el >= STIR_MIN_MS && st.can?.next) stirStop = true;
                    if (stirStop) { centred(); want.T = -1; }
                    else { const a = (el / 1000) * Math.PI * 2 * 0.6; want.A = Math.cos(a); want.E = Math.sin(a); want.R = Math.cos(a * 1.3); want.T = Math.sin(a * 1.3); }
                } else { centred(); want.T = -1; }
            } else if (id === 'centre') { centred(); want.T = -1; arm = false; }
            else if (id in FN) { centred(); if (id === 'throttle') want.T = -1; if (stage === 'active') want[FN[id]] = 1; }
            else if (id === 'arm') {
                if (stage === 'active') {
                    const back = st.armFlip?.phase === 'off';
                    if (back && Number.isNaN(offSeenAt)) offSeenAt = now;
                    if (!back) offSeenAt = NaN;
                    arm = !(back && now - offSeenAt >= REACT_MS);
                } else arm = false;
            }
        }
        const step = SLEW * dt;
        for (const q of 'AETR') { const d = want[q] - sticks[q]; sticks[q] += d > step ? step : d < -step ? -step : d; }
    }
    function report() {
        const ch = [];
        for (let i = 0; i < 8; i++) {
            const v = i < 4 ? sticks[ORDER[i]] + 0.02 + (rnd() * 2 - 1) * 0.005 : i === 4 ? (arm ? 1 : -1) : -1;
            ch.push(Math.max(-1, Math.min(1, v)));
        }
        if (cfg.kind === 'dji') {
            // 5 x int16 -660..660, then 3 button bytes; bits 4 and 6 held as on the real controller
            const b = new Uint8Array(13);
            const dv = new DataView(b.buffer);
            for (let i = 0; i < 5; i++) dv.setInt16(i * 2, Math.round(ch[i] * 660), true);
            b[10] = 0x50;
            return b;
        }
        // EdgeTX Classic: 3 button bytes, then 8 x uint16 0..2047 (centre 1024)
        const b = new Uint8Array(19);
        const dv = new DataView(b.buffer);
        for (let i = 0; i < 8; i++) dv.setUint16(3 + i * 2, Math.round(1024 + ch[i] * 1024 * 0.999), true);
        return b;
    }
    class FakeHidDevice extends EventTarget {
        constructor() {
            super();
            this.vendorId = cfg.vendorId; this.productId = cfg.productId; this.productName = cfg.productName;
            this.collections = cfg.collections; this.opened = false; this.timer = 0;
        }
        async open() {
            this.opened = true;
            probe.opened++;
            this.timer = setInterval(() => {
                hands(performance.now());
                const e = new Event('inputreport');
                // what a real HIDInputReportEvent carries; timeStamp is the event's own
                Object.defineProperties(e, { device: { value: this }, reportId: { value: 0 }, data: { value: new DataView(report().buffer) } });
                probe.sent++;
                this.dispatchEvent(e);
            }, Math.max(1, Math.round(1000 / cfg.rateHz)));
        }
        async close() { this.opened = false; clearInterval(this.timer); }
        addEventListener(type, l, o) { if (type === 'inputreport') probe.listeners++; super.addEventListener(type, l, o); }
    }
    const dev = new FakeHidDevice();
    // the chooser: open cfg.chooserMs (the pilot looking for the device), then the device or none (cancelled)
    const hid = {
        requestDevice: async () => {
            probe.requested++;
            if (cfg.chooserMs) await new Promise((r) => setTimeout(r, cfg.chooserMs));
            return cfg.cancel ? [] : [dev];
        },
        getDevices: async () => [], addEventListener() {}, removeEventListener() {}
    };
    Object.defineProperty(Navigator.prototype, 'hid', { get: () => hid, configurable: true });
    if (cfg.pad) {
        // the same controller on the Gamepad API, at rest (throttle down, bits 4 and 6 held); a browser
        // shows a pad only after an input: none until the probe calls window.__padShow()
        let shown = false;
        window.__padShow = () => { shown = true; };
        const buttons = Array.from({ length: 24 }, (_, i) => ({ pressed: ((0x50 >> i) & 1) === 1, value: (0x50 >> i) & 1, touched: false }));
        const pad = { id: cfg.padId, index: 0, connected: true, mapping: '', vibrationActuator: null, axes: [0, 0, -1, 0, 0], buttons, timestamp: 1 };
        Object.defineProperty(Navigator.prototype, 'getGamepads', { value: () => [shown ? pad : null, null, null, null], configurable: true });
    }
}

const pick = pickHarnessBrowser({ expected: chromium.executablePath() }, false);
const browser = await chromium.launch({ ...pick.launch, headless: false });
const out = { what: 'HidSource on the local release with a fake navigator.hid (hid-source-probe.mjs)', base };
{
    const probe = await browser.newContext();
    out.browser = await browserRecord(pick, await probe.newPage(), { visual: false, version: browser.version() });
    await probe.close();
}
let allPass = true;
const runs = RUNS.filter((r) => !only || only.includes(r.name));
for (const run of runs) {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 160)));
    await page.addInitScript(installFakeHid, { kind: run.kind, vendorId: run.vendorId, productId: run.productId, productName: run.productName, collections: run.collections, rateHz: run.rateHz, chooserMs: run.chooserMs ?? 0, cancel: !!run.cancel, pad: !!run.pad, padId: PAD_ID });
    await page.goto(`${base}/fly/?scene=39e63ce9&nowarn=1`, { waitUntil: 'load' }); // nowarn: past the first-visit warning
    await page.waitForFunction(() => window.__gsfpv?.status === 'ready' && document.querySelector('.screen.radio .choice button'), null, { timeout: 120000 });
    const t0 = Date.now();
    // the first choice of the Controls screen: "Radio or controller over USB"
    if (run.click !== false) await page.locator('.screen.radio .choice button').first().click();
    // a stick moved: the browser shows the pad (the WebHID chooser, if any, still open)
    if (run.pad) { await page.waitForTimeout(run.pad.showMs); await page.evaluate(() => window.__padShow()); }
    const path = [];
    let last = '';
    let checkAt = null; // ms from t0 to the first check screen
    const limit = run.expect.end === 'connect' ? 30000 : run.expect.end === 'wizard' ? 12000 : run.expect.end === 'pad' ? 8000 : 150000;
    while (Date.now() - t0 < limit) {
        const s = await page.evaluate(() => { const w = window.__gsfpv?.radio?.wizard?.state; return w ? { id: w.id, stage: w.stage, step: w.step } : null; });
        const k = s ? `${s.id}/${s.stage}` : 'none';
        if (k !== last) {
            path.push({ t: Date.now() - t0, k });
            // no shots while a pad run is timed (a shot takes hundreds of ms)
            if (path.length <= 30 && !run.pad) await page.screenshot({ path: `${outDir}/${run.name}-${String(path.length).padStart(2, '0')}-${k.replace('/', '-')}.png` });
            last = k;
        }
        if (s?.id === 'check') { checkAt = Date.now() - t0; break; }
        await page.waitForTimeout(run.pad ? 50 : 200);
    }
    const end = await page.evaluate(() => {
        const r = window.__gsfpv?.radio;
        const w = r?.wizard?.state;
        const src = r?.hid;
        return {
            id: w?.id ?? null, profile: !!w?.profile, profileKey: w?.profile?.deviceKey ?? null, profileName: w?.profile?.deviceName ?? null,
            key: src?.key ?? null, reports: src?.reports ?? null, badReports: src?.badReports ?? null, lastBadLen: src?.lastBadLen ?? null, rateHz: src ? Math.round(src.rateHz) : null,
            deviceName: src?.device?.productName ?? null, hint: document.querySelector('.wz-hint:not([hidden])')?.textContent ?? '', probe: window.__hidProbe,
            known: w?.profile?.known ?? null, knownNote: !!document.querySelector('[data-testid=known-note]'),
            controls: document.querySelectorAll('[data-testid=known-controls] .kp-row').length
        };
    });
    await page.screenshot({ path: `${outDir}/${run.name}-end.png` });
    const e = run.expect;
    // the wizard ran = a screen of it was passed before the check (a recognised controller opens on the check)
    const wizardRan = path.some((p) => !p.k.startsWith('check') && p.k !== 'none');
    end.checkAt = checkAt;
    const pass = (e.requested === undefined || end.probe.requested === e.requested) && (e.end === 'check'
        ? end.id === 'check' && end.profile && end.key === e.key && end.profileKey === e.key && end.profileName === e.name && end.badReports === 0 && end.reports > 0 && errors.length === 0
            && end.known === e.known && end.controls === e.controls && wizardRan === e.wizard && end.knownNote === (e.known !== null)
        : e.end === 'pad'
            // the pad's check: its profile on the Gamepad API key, recognised, within / after the given time
            ? end.id === 'check' && end.profileKey === e.key && end.known === e.known && end.knownNote && end.probe.opened === 0 && errors.length === 0
                && (e.withinMs === undefined || checkAt <= e.withinMs) && (e.afterMs === undefined || checkAt >= e.afterMs)
            : e.end === 'wizard'
                ? end.id !== 'check' && end.id !== null && !end.knownNote && end.known === null && end.reports > 0 && errors.length === 0
                : end.id === 'connect' && end.reports === 0 && end.badReports > 0 && end.lastBadLen === 13 && /13/.test(end.hint) && errors.length === 0);
    allPass &&= pass;
    out[run.name] = { pass, expect: e, seconds: Math.round((Date.now() - t0) / 1000), end, screens: path.length, path, errors };
    await ctx.close();
}
await browser.close();
out.pass = allPass;
writeFileSync(`${outDir}/result.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify({ pass: allPass, browser: out.browser?.version, ...Object.fromEntries(runs.map((r) => [r.name, { pass: out[r.name].pass, seconds: out[r.name].seconds, end: out[r.name].end.id, key: out[r.name].end.key, profileKey: out[r.name].end.profileKey, checkAt: out[r.name].end.checkAt, profileName: out[r.name].end.profileName, reports: out[r.name].end.reports, badReports: out[r.name].end.badReports, rateHz: out[r.name].end.rateHz, hint: out[r.name].end.hint.slice(0, 80), errors: out[r.name].errors.length }])) }, null, 1));
