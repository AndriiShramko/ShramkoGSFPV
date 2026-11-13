// Lane rc2 page probe (docs/wip/rc2.md, stage 3): the DJI RC 2 on the simulator page.
//   usb      a fake navigator.usb with the owner's RC 2 (USB 2CA3:1021, interface 0 FF.43.01 with bulk 1 in/out,
//            interface 2 FF.42.01, as measured on 2026-11-13) that answers every DUML stick request with a DUML stick
//            reply (the recorded frame layout, values from the probe's hands). The Controls screen's "My controller is
//            not in the list": look, the verdict 'rc2', "Fly with this controller"; the wizard (the hands follow its
//            screens as in hid-source-probe.mjs) to the check screen; there the roll stick moves from the centre to the
//            right and the check screen's frames follow; Fly; the left stick goes up from the centre and the drone
//            climbs (+1 m or more, armed). +1 m and 2.5 s are the estimates of centre-throttle-probe.mjs.
//   refused  the same device whose claimInterface rejects (Chrome on Windows with DJI's driver): the helper says the
//            claim failed in plain words, no flight.
//   bridge   (after usb, same browser profile, so the saved setup of 'hid:2ca3:1021:DJI RC 2:12:d' opens the check at
//            once) the Shramko RC bridge (tools/rc-bridge) must be running on ws://127.0.0.1:47310: no WebSocket is made
//            on page load; "Fly through the RC bridge" connects, the check screen opens, stick frames arrive.
//            With BRIDGE_EXPECT=blocked (the page served with a CSP that lacks the bridge) the pass is the reverse:
//            the helper says the bridge does not answer and the browser logged a CSP refusal.
// Pass needs every check of every run. Against a build of origin/main (no RC 2 support) usb and refused must fail.
// Usage: node rc2-probe.mjs <base with the locale, e.g. http://localhost:5393/en> <out.json> [usb,refused,bridge]
// Prints ONE last line of JSON {pass, checks}; exit 0 only on pass.
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pickHarnessBrowser } from './visual-browser.mjs';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '');
const require = createRequire(ROOT + '/tools/bench/package.json');
const { chromium } = require('playwright');
const base = process.argv[2] ?? 'http://localhost:5393/en';
const outFile = process.argv[3] ?? ROOT + '/.cache/rc2-probe.json';
const only = process.argv[4] ? process.argv[4].split(',') : ['usb', 'refused', 'bridge'];
const bridgeBlocked = process.env.BRIDGE_EXPECT === 'blocked';
const scene = '887f27aa'; // open sky above the spawn (centre-throttle-probe.mjs)
mkdirSync(dirname(outFile), { recursive: true });

/** In the page, before the app: navigator.usb with one fake RC 2 and hands that follow the wizard; WebSocket counted. */
function installFakeRc2(cfg) {
    const counts = { sockets: 0, requests: 0, replies: 0, claims: 0 };
    window.__rc2Probe = counts;
    const RealWS = window.WebSocket;
    window.WebSocket = class extends RealWS { constructor(...a) { super(...a); counts.sockets++; } };
    // DUML (packages/input/src/dji-duml.ts): CRC-8 seed 0x77 poly 0x8c, CRC-16 seed 0x3692 poly 0x8408, both reflected
    const table = (poly) => { const t = new Uint16Array(256); for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ poly : c >>> 1; t[i] = c; } return t; };
    const T8 = table(0x8c), T16 = table(0x8408);
    const crc8 = (b, n) => { let c = 0x77; for (let i = 0; i < n; i++) c = T8[(b[i] ^ c) & 0xff]; return c; };
    const crc16 = (b, n) => { let c = 0x3692; for (let i = 0; i < n; i++) c = (c >>> 8) ^ T16[(b[i] ^ c) & 0xff]; return c & 0xffff; };
    const reply = (seq, values) => {
        const p = new Uint8Array(19); // payload byte 0 = 0, then (u16 value, channel index) x 6, as recorded
        for (let i = 0; i < 6; i++) { p[1 + i * 3] = values[i] & 0xff; p[2 + i * 3] = values[i] >> 8; p[3 + i * 3] = i + 1; }
        const n = 13 + p.length, b = new Uint8Array(n), v = new DataView(b.buffer);
        b[0] = 0x55; v.setUint16(1, n | (1 << 10), true); b[3] = crc8(b, 3);
        b[4] = 0x06; b[5] = 0x0a; v.setUint16(6, seq, true); b[8] = 0x80; b[9] = 0x06; b[10] = 0x01;
        b.set(p, 11); v.setUint16(n - 2, crc16(b, n - 2), true);
        return b;
    };
    // the hands: the wizard follower of hid-source-probe.mjs; after the wizard the probe sets window.__rc2Hands.fixed
    const SLEW = 2 / 150, STIR_MIN_MS = 1700, REACT_MS = 400;
    const FN = { throttle: 'T', yaw: 'R', roll: 'A', pitch: 'E' };
    let seed = 12345;
    const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 4294967296; };
    const sticks = { A: 0, E: 0, T: -1, R: 0 }, want = { A: 0, E: 0, T: -1, R: 0 };
    const hands = { fixed: null };
    window.__rc2Hands = hands;
    let arm = false, seenKey = '', seenAt = 0, doKey = '', followT0 = 0, stirStop = false, offSeenAt = NaN, lastT = NaN;
    function follow(now) {
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
    const values = () => {
        follow(performance.now());
        const f = hands.fixed;
        const ch = f ? [f.A, f.E, f.T, f.R, f.arm ? 1 : -1, -1] : [sticks.A + 0.02, sticks.E + 0.02, sticks.T + 0.02, sticks.R + 0.02, arm ? 1 : -1, -1];
        // roll, pitch, throttle, yaw, left dial (the arm switch the wizard asks for), right dial: raw 364..1684, centre 1024
        return ch.map((x, i) => Math.round(1024 + Math.max(-1, Math.min(1, x + (i < 4 && !f ? (rnd() * 2 - 1) * 0.005 : 0))) * 660));
    };
    const iface = (n, sub, eps) => ({ interfaceNumber: n, alternates: [{ interfaceClass: 0xff, interfaceSubclass: sub, interfaceProtocol: 1, endpoints: eps }] });
    const bulk = [{ endpointNumber: 1, direction: 'in', type: 'bulk' }, { endpointNumber: 1, direction: 'out', type: 'bulk' }];
    const queue = [];
    let wake = null;
    const dev = {
        vendorId: 0x2ca3, productId: 0x1021, productName: 'DJI RC 2', manufacturerName: 'DJI', opened: false, configuration: null,
        configurations: [{ configurationValue: 1, interfaces: [iface(0, 0x43, bulk), iface(2, 0x42, [])] }],
        async open() { this.opened = true; },
        async close() { this.opened = false; },
        async selectConfiguration(v) { this.configuration = { configurationValue: v }; },
        async claimInterface() { counts.claims++; if (cfg.refuse) throw new DOMException('Unable to claim interface.', 'NetworkError'); },
        async releaseInterface() {},
        async transferOut(_ep, d) { counts.requests++; queue.push(reply(d[6] | (d[7] << 8), values())); wake?.(); return { status: 'ok', bytesWritten: d.length }; },
        async transferIn() {
            while (!queue.length) await new Promise((r) => { wake = r; });
            counts.replies++;
            const b = queue.shift();
            await new Promise((r) => setTimeout(r, 2)); // a bus round trip (estimate; the real one was not measured)
            return { status: 'ok', data: new DataView(b.buffer) };
        }
    };
    const usb = { requestDevice: async () => dev, getDevices: async () => [], addEventListener() {}, removeEventListener() {} };
    Object.defineProperty(Navigator.prototype, 'usb', { get: () => usb, configurable: true });
}

const state = (page) => page.evaluate(() => {
    const g = window.__gsfpv;
    const hd = g?.session?.hud?.();
    const w = g?.radio?.wizard?.state;
    const src = g?.radio?.hid;
    return {
        wizard: w ? (w.stage ? `${w.id}/${w.stage}` : w.id) : null, profileKey: w?.profile?.deviceKey ?? null,
        key: src?.key ?? null, reports: src?.reports ?? null, badReports: src?.badReports ?? null,
        armed: !!hd?.armed, crashed: !!hd?.crashed, alt: hd?.altitude ?? null, radio: !!document.querySelector('.screen.radio'),
        probe: window.__rc2Probe, axes: window.__rc2Axes ?? null
    };
});
/** the Controls screen's helper, opened (a <details>) */
async function openHelper(page) {
    await page.waitForFunction(() => window.__gsfpv?.status === 'ready' && document.querySelector('.screen.radio .choice button'), null, { timeout: 120000 });
    await page.evaluate(() => { const d = document.querySelector('[data-testid=usb-look]'); if (d) d.open = true; });
}
/** the frames the check screen gets: a tap on the HID source's frame callback */
const tapFrames = (page) => page.evaluate(() => {
    const src = window.__gsfpv?.radio?.hid;
    if (!src || src.__tapped) return !!src;
    const orig = src.onFrame;
    src.__tapped = true;
    src.onFrame = (f) => { window.__rc2Axes = Array.from(f.axes.slice(0, 6)).map((x) => Math.round(x * 100) / 100); orig?.(f); };
    return true;
});

const pick = pickHarnessBrowser({ expected: chromium.executablePath() }, false);
const browser = await chromium.launch({ ...pick.launch, headless: true });
const out = { what: 'rc2-probe.mjs: the DJI RC 2 on the simulator page', base, at: new Date().toISOString(), browser: browser.version(), runs: {} };
const checks = {};
const errorsOf = {};
let usbCtx = null;

async function run(name, ctx, fn) {
    const page = await ctx.newPage();
    const errors = [];
    const csp = [];
    page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)));
    page.on('console', (m) => { if (/Content Security Policy|Refused to connect/i.test(m.text())) csp.push(m.text().slice(0, 300)); });
    const note = {};
    try { await fn(page, note, csp); } catch (e) { note.threw = String(e?.message ?? e).slice(0, 300); checks[`${name}.ran`] = false; }
    note.errors = errors;
    note.csp = csp;
    errorsOf[name] = errors;
    out.runs[name] = note;
    await page.screenshot({ path: outFile.replace(/\.json$/, `-${name}.png`) }).catch(() => undefined);
    await page.close();
}

if (only.includes('usb') || only.includes('bridge')) usbCtx = await browser.newContext({ viewport: { width: 1600, height: 900 } });

if (only.includes('usb')) {
    await usbCtx.addInitScript(installFakeRc2, { refuse: false });
    await run('usb', usbCtx, async (page, note) => {
        await page.goto(`${base}/fly/?scene=${scene}&nowarn=1&set.input.howToFly=false`, { waitUntil: 'load' });
        await openHelper(page);
        await page.locator('[data-action=usb-look]').click();
        await page.waitForSelector('[data-testid=usb-look-verdict]', { timeout: 10000 });
        note.verdict = await page.getAttribute('[data-testid=usb-look-verdict]', 'data-verdict');
        checks['usb.verdictRc2'] = note.verdict === 'rc2';
        await page.locator('[data-action=usb-rc2-fly]').click();
        const t0 = Date.now();
        note.path = [];
        let s = await state(page);
        while (Date.now() - t0 < 150000) {
            s = await state(page);
            if (note.path[note.path.length - 1] !== s.wizard) note.path.push(s.wizard);
            if (s.wizard === 'check') break;
            await page.waitForTimeout(200);
        }
        note.checkAfterS = Math.round((Date.now() - t0) / 1000);
        checks['usb.checkScreen'] = s.wizard === 'check' && s.profileKey === 'hid:2ca3:1021:DJI RC 2:12:d' && s.key === s.profileKey && s.badReports === 0;
        // the sticks move on the check screen: roll from the centre to the right
        await page.evaluate(() => { window.__rc2Hands.fixed = { A: 0, E: 0, T: 0, R: 0, arm: false }; });
        await tapFrames(page);
        await page.waitForTimeout(700);
        const rest = (await state(page)).axes;
        await page.evaluate(() => { window.__rc2Hands.fixed.A = 1; });
        await page.waitForTimeout(500);
        const moved = (await state(page)).axes;
        await page.evaluate(() => { window.__rc2Hands.fixed.A = 0; });
        note.axesRest = rest;
        note.axesMoved = moved;
        const diff = rest && moved ? moved.map((v, i) => Math.abs(v - rest[i])) : [];
        // one axis moved by most of its travel, the others stayed (which index is roll depends on the wizard's mapping)
        checks['usb.sticksMoveOnCheck'] = diff.length === 6 && diff.filter((d) => d > 0.8).length === 1 && diff.filter((d) => d > 0.1).length === 1;
        await page.waitForTimeout(1200); // the check screen watches where the throttle rests
        await page.locator('[data-action=wizard-done]').click();
        await page.waitForFunction(() => !document.querySelector('.screen.radio'), null, { timeout: 15000 });
        await page.waitForTimeout(1500);
        const s0 = await state(page);
        await page.evaluate(() => { window.__rc2Hands.fixed.arm = true; });
        await page.waitForTimeout(500);
        await page.evaluate(() => { window.__rc2Hands.fixed.T = 0.6; });
        note.climb = [];
        for (let i = 0; i < 10; i++) { await page.waitForTimeout(250); const x = await state(page); note.climb.push({ alt: x.alt, armed: x.armed }); }
        const s1 = await state(page);
        note.start = { alt: s0.alt, armed: s0.armed };
        note.up = { alt: s1.alt, armed: s1.armed, crashed: s1.crashed };
        checks['usb.climbs'] = s1.armed && !s1.crashed && s0.alt !== null && s1.alt !== null && s1.alt - s0.alt >= 1.0;
        note.probe = s1.probe;
    });
    checks['usb.noPageErrors'] = (errorsOf.usb ?? ['not run']).length === 0;
}

if (only.includes('refused')) {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    await ctx.addInitScript(installFakeRc2, { refuse: true });
    await run('refused', ctx, async (page, note) => {
        await page.goto(`${base}/fly/?scene=${scene}&nowarn=1`, { waitUntil: 'load' });
        await openHelper(page);
        await page.locator('[data-action=usb-look]').click();
        await page.locator('[data-action=usb-rc2-fly]').click({ timeout: 10000 });
        await page.waitForFunction(() => document.querySelector('[data-testid=usb-rc2-say]')?.getAttribute('data-state') === 'claim', null, { timeout: 10000 });
        note.say = await page.textContent('[data-testid=usb-rc2-say]');
        const s = await state(page);
        note.probe = s.probe;
        checks['refused.saysClaimFailed'] = /could not open the controller's stick channel/.test(note.say) && /Fly through the RC bridge/.test(note.say);
        checks['refused.stillOnControls'] = s.radio && s.wizard === null && s.probe.claims === 1;
    });
    checks['refused.noPageErrors'] = (errorsOf.refused ?? ['not run']).length === 0;
    await ctx.close();
}

if (only.includes('bridge')) {
    if (!only.includes('usb')) await usbCtx.addInitScript(installFakeRc2, { refuse: false });
    await run('bridge', usbCtx, async (page, note, csp) => {
        await page.goto(`${base}/fly/?scene=${scene}&nowarn=1`, { waitUntil: 'load' });
        await openHelper(page);
        await page.waitForTimeout(1500);
        note.socketsBeforePress = (await state(page)).probe.sockets;
        checks['bridge.noSocketOnLoad'] = note.socketsBeforePress === 0;
        await page.locator('[data-action=usb-rc2-bridge]').click();
        await page.waitForFunction(() => { const s = document.querySelector('[data-testid=usb-bridge-say]')?.getAttribute('data-state'); return s && s !== 'opening'; }, null, { timeout: 10000 });
        note.sayState = await page.getAttribute('[data-testid=usb-bridge-say]', 'data-state');
        note.say = await page.textContent('[data-testid=usb-bridge-say]');
        if (bridgeBlocked) {
            checks['bridge.blockedSaysNoBridge'] = note.sayState === 'nobridge' && /does not answer/.test(note.say);
            checks['bridge.blockedByCsp'] = csp.some((m) => /ws:\/\/127\.0\.0\.1:47310/.test(m));
            return;
        }
        checks['bridge.connected'] = note.sayState === 'flying';
        await page.waitForFunction(() => window.__gsfpv?.radio?.wizard?.state?.id === 'check', null, { timeout: 15000 }).catch(() => undefined);
        const a = await state(page);
        await page.waitForTimeout(2000);
        const b = await state(page);
        note.check = { wizard: b.wizard, key: b.key, reportsIn2s: (b.reports ?? 0) - (a.reports ?? 0), badReports: b.badReports };
        await tapFrames(page);
        await page.waitForTimeout(300);
        note.axes = (await state(page)).axes;
        checks['bridge.checkScreenAtOnce'] = b.wizard === 'check' && b.key === 'hid:2ca3:1021:DJI RC 2:12:d';
        // 2 s of frames: at least 50 (the real bridge gave 63 per second on 2026-11-13; 25 per second is the floor here)
        checks['bridge.framesFlow'] = note.check.reportsIn2s >= 50 && b.badReports === 0;
        checks['bridge.cspQuiet'] = csp.length === 0;
    });
    checks['bridge.noPageErrors'] = (errorsOf.bridge ?? ['not run']).length === 0;
}
if (usbCtx) await usbCtx.close();
await browser.close();
const pass = Object.keys(checks).length > 0 && Object.values(checks).every(Boolean);
out.pass = pass;
out.checks = checks;
writeFileSync(outFile, JSON.stringify(out, null, 1));
console.log(JSON.stringify({ pass, checks }));
process.exit(pass ? 0 : 1);
