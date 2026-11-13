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
//            On an https base (the live site) the probe first grants Chrome's Local Network Access permission for the
//            site (grantLoopback: what a pilot's Allow does; lane rc2-lna) and records which call worked.
//   bridge-nogrant  (only when named) a fresh profile without that grant: what the helper says, after how many ms.
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
const fakeAnswer = process.env.RC2_FAKE_ANSWER === 'timer' ? 'timer' : 'message';
const bridgePort = Number(process.env.RC2_BRIDGE_PORT) || 0;
// a helper on its own port is outside the page's CSP (it allows 47310 only): the probe's contexts then bypass the CSP
const ctxOpts = { viewport: { width: 1600, height: 900 }, ...(bridgePort ? { bypassCSP: true } : {}) };
const RUN_LIMIT_MS = 120000; // a run takes 30-60 s (2026-11-13 runs); twice the longest is a hang
const scene = '887f27aa'; // open sky above the spawn (centre-throttle-probe.mjs)
mkdirSync(dirname(outFile), { recursive: true });

/** In the page, before the app: navigator.usb with one fake RC 2 and hands that follow the wizard; WebSocket counted. */
function installFakeRc2(cfg) {
    const counts = { sockets: 0, requests: 0, replies: 0, claims: 0 };
    window.__rc2Probe = counts;
    const RealWS = window.WebSocket;
    // RC2_BRIDGE_PORT: the page's helper address (ws://127.0.0.1:47310/) goes to the probe's own helper port (the
    // owner's real helper may hold 47310; lane connect)
    window.WebSocket = class extends RealWS { constructor(u, ...a) { super(cfg.bridgePort ? String(u).replace(':47310/', `:${cfg.bridgePort}/`) : u, ...a); counts.sockets++; } };
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
    // the RC 2's left stick springs to the centre (all six at 1024 at rest, measured in stage 1): a hand that lets go of
    // the throttle leaves it in the middle, not at the bottom as on hid-source-probe.mjs's radios
    const REST_T = 0;
    const sticks = { A: 0, E: 0, T: REST_T, R: 0 }, want = { A: 0, E: 0, T: REST_T, R: 0 };
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
                    if (stirStop) { centred(); want.T = REST_T; }
                    else { const a = (el / 1000) * Math.PI * 2 * 0.6; want.A = Math.cos(a); want.E = Math.sin(a); want.R = Math.cos(a * 1.3); want.T = Math.sin(a * 1.3); }
                } else { centred(); want.T = REST_T; }
            } else if (id === 'centre') { centred(); want.T = REST_T; arm = false; }
            else if (id in FN) { centred(); if (id === 'throttle') want.T = REST_T; if (stage === 'active') want[FN[id]] = 1; }
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
    const pending = [];
    const mc = new MessageChannel();
    mc.port1.onmessage = () => { if (pending.length) queue.push(pending.shift()); wake?.(); };
    const dev = {
        vendorId: 0x2ca3, productId: 0x1021, productName: 'DJI RC 2', manufacturerName: 'DJI', opened: false, configuration: null,
        configurations: [{ configurationValue: 1, interfaces: [iface(0, 0x43, bulk), iface(2, 0x42, [])] }],
        async open() { this.opened = true; },
        async close() { this.opened = false; },
        async selectConfiguration(v) { this.configuration = { configurationValue: v }; },
        async claimInterface() { counts.claims++; if (cfg.refuse) throw new DOMException('Unable to claim interface.', 'NetworkError'); },
        async releaseInterface() {},
        async transferOut(_ep, d) {
            counts.requests++;
            const b = reply(d[6] | (d[7] << 8), values());
            // the answer arrives as a task of its own, as a USB completion does (a message, not a timer: in flight the
            // page ran timers about 9 times a second); the real answer time was not measured
            // RC2_FAKE_ANSWER=timer: the earlier fake, the answer 2 ms after its request (estimate)
            if (cfg.answer === 'timer') setTimeout(() => { queue.push(b); wake?.(); }, 2);
            else { pending.push(b); mc.port2.postMessage(0); }
            return { status: 'ok', bytesWritten: d.length };
        },
        async transferIn() {
            while (!queue.length) await new Promise((r) => { wake = r; });
            counts.replies++;
            const b = queue.shift();
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
        probe: window.__rc2Probe, axes: window.__rc2Axes ?? null,
        throttle: g?.throttle ? (({ resolved, setting, centre, now }) => ({ resolved, setting, centre, now }))(g.throttle()) : null,
        card: (() => { const c = document.querySelector('.arm-card'); return c && !c.classList.contains('hidden') ? (c.querySelector('.reason')?.textContent ?? '').slice(0, 200) : null; })()
    };
});
/** the Controls screen's helper, opened (a <details>) */
async function openHelper(page) {
    // lane connect C2: a page that connected by itself is already past the device choice (wizard or check screen)
    await page.waitForFunction(() => window.__gsfpv?.status === 'ready' && (document.querySelector('.screen.radio .choice button') || window.__gsfpv?.radio?.wizard?.state), null, { timeout: 120000 });
    await page.evaluate(() => { const d = document.querySelector('[data-testid=usb-look]'); if (d) d.open = true; });
}
/** the frames the check screen gets: a tap on the HID source's frame callback */
const tapFrames = (page) => page.evaluate(() => {
    const src = window.__gsfpv?.radio?.hid;
    if (!src || src.__tapped) return !!src;
    const orig = src.onFrame;
    src.__tapped = true;
    src.onFrame = (f) => { window.__rc2Axes = Array.from(f.axes.slice(0, 6)).map((x) => Math.round(x * 100) / 100); orig?.(f); };
    // the gate's view every animation frame: the age of the last sample (Controls.lastSampleAt, what the 100 ms stale
    // rule reads), the frame interval (over 80 ms the tick calls it a stalled page) and the block reasons
    const w = { maxAge: 0, ageOver100: 0, maxFrame: 0, frames: 0, blocks: {}, last: NaN };
    window.__rc2Watch = w;
    const watch = () => {
        const now = performance.now();
        const c = window.__gsfpv?.controls;
        if (c) {
            const age = now - c.lastSampleAt;
            w.maxAge = Math.max(w.maxAge, age);
            if (age > 100) w.ageOver100++;
            if (c.block) w.blocks[c.block] = (w.blocks[c.block] ?? 0) + 1;
        }
        if (w.last === w.last) w.maxFrame = Math.max(w.maxFrame, now - w.last);
        w.last = now;
        w.frames++;
        requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
    return true;
});

/** progress on stderr with the seconds since start, so a hang shows its last step */
const T0 = Date.now();
const step = (s) => process.stderr.write(`[${((Date.now() - T0) / 1000).toFixed(1)}s] ${s}\n`);
const pick = pickHarnessBrowser({ expected: chromium.executablePath() }, false);
step('launch ' + JSON.stringify(pick.launch).slice(0, 200));
const browser = await chromium.launch({ ...pick.launch, headless: true });
step('launched ' + browser.version());
const out = { what: 'rc2-probe.mjs: the DJI RC 2 on the simulator page', base, at: new Date().toISOString(), browser: browser.version(), fakeAnswer, runs: {} };
const checks = {};
const errorsOf = {};
let usbCtx = null;

async function run(name, ctx, fn) {
    step(`${name}: new page`);
    const page = await ctx.newPage();
    step(`${name}: page open`);
    // the debugger is on before the page loads: a page stuck later still answers Debugger.pause (a V8 interrupt)
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Debugger.enable');
    curCdp = cdp;
    const errors = [];
    const csp = [];
    page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)));
    page.on('console', (m) => { if (/Content Security Policy|Refused to connect/i.test(m.text())) csp.push(m.text().slice(0, 300)); });
    const note = {};
    out.runs[name] = note;
    // a run that does not end in RUN_LIMIT_MS (a page whose main thread is stuck: page.evaluate never returns) is
    // stopped; the debugger pauses the page's script and records where it was
    let timer;
    const limit = new Promise((r) => { timer = setTimeout(() => r('hung'), RUN_LIMIT_MS); });
    let res;
    try { res = await Promise.race([fn(page, note, csp).then(() => 'done'), limit]); } catch (e) { note.threw = String(e?.message ?? e).slice(0, 300); checks[`${name}.ran`] = false; }
    clearTimeout(timer);
    if (res === 'hung') {
        checks[`${name}.ran`] = false;
        note.hung = true;
        step(`${name}: hung, profile and pause`);
        if (note.profiling) note.profile = await profileOf(cdp);
        step(`${name}: profile ${JSON.stringify(note.profile ?? null).slice(0, 1500)}`);
        // three looks 3 s apart: the same arguments in every look = one call that has not returned
        note.hungStack = [];
        for (let i = 0; i < 3; i++) {
            if (i) await new Promise((r) => setTimeout(r, 3000));
            note.hungStack.push(await stackOf(cdp));
            step(`${name}: stack ${i} ${JSON.stringify(note.hungStack[i]).slice(0, 900)}`);
        }
    }
    note.errors = errors;
    note.csp = csp;
    errorsOf[name] = errors;
    writeFileSync(outFile, JSON.stringify(out, null, 1));
    if (res !== 'hung') await page.screenshot({ path: outFile.replace(/\.json$/, `-${name}.png`) }).catch(() => undefined);
    await Promise.race([page.close(), new Promise((r) => setTimeout(r, 5000))]);
}
/** where the page's script is now: Debugger.pause through CDP, the top frames (10 s at most) */
let curCdp = null;
/** the page's CPU profile since Profiler.start: total ms, self ms of the top functions, ms under ground/sweep */
async function profileOf(cdp) {
    const stop = cdp.send('Profiler.stop').then(({ profile }) => {
        const dt = profile.timeDeltas, byId = new Map(profile.nodes.map((n) => [n.id, n]));
        const self = new Map(), parent = new Map();
        for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
        const under = { ground: 0, sweep: 0, onFrame: 0, total: 0 };
        for (let i = 0; i < profile.samples.length; i++) {
            const ms = (dt[i] ?? 0) / 1000, n = byId.get(profile.samples[i]);
            const k = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber + 1}`;
            self.set(k, (self.get(k) ?? 0) + ms);
            under.total += ms;
            const seen = new Set();
            for (let id = n.id; id !== undefined; id = parent.get(id)) {
                const f = byId.get(id).callFrame.functionName;
                for (const w of ['ground', 'sweep', 'onFrame']) if (!seen.has(w) && f.includes(w)) { seen.add(w); under[w] += ms; }
            }
        }
        const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${Math.round(v)} ${k}`);
        return { msUnder: Object.fromEntries(Object.entries(under).map(([k, v]) => [k, Math.round(v)])), top };
    });
    return Promise.race([stop, new Promise((r) => setTimeout(() => r('no profile in 15 s'), 15000))]).catch((e) => 'profile: ' + String(e?.message ?? e).slice(0, 200));
}
async function stackOf(cdp) {
    // the stack, and the numeric arguments of its top 6 frames (a craft position that blew up shows here)
    const paused = new Promise((r) => cdp.once('Debugger.paused', async (e) => {
        const frames = e.callFrames.slice(0, 14).map((f) => `${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.location.lineNumber + 1}:${f.location.columnNumber + 1}`);
        const args = [];
        const now = await cdp.send('Debugger.evaluateOnCallFrame', { callFrameId: e.callFrames[0].callFrameId, returnByValue: true, expression: 'Math.round(performance.now())' }).catch(() => null);
        args.push(`page ms ${now?.result?.value}`);
        for (const f of e.callFrames.slice(0, 6)) {
            const v = await cdp.send('Debugger.evaluateOnCallFrame', { callFrameId: f.callFrameId, returnByValue: true, expression: 'JSON.stringify(Array.from(arguments).map((a) => typeof a === "number" ? String(a) : a && typeof a.length === "number" ? Array.from(a).slice(0, 16).map(String) : typeof a))' }).catch((x) => ({ result: { value: 'eval: ' + x.message } }));
            args.push(`${f.functionName}: ${String(v.result?.value).slice(0, 400)}`);
        }
        cdp.send('Debugger.resume').catch(() => undefined);
        r({ frames, args });
    }));
    cdp.send('Debugger.pause').catch(() => undefined);
    return Promise.race([paused, new Promise((r) => setTimeout(() => r('no pause in 10 s (not in script?)'), 10000))]);
}

if (only.includes('usb') || only.includes('bridge')) usbCtx = await browser.newContext(ctxOpts);

if (only.includes('usb')) {
    await usbCtx.addInitScript(installFakeRc2, { refuse: false, answer: fakeAnswer, bridgePort });
    await run('usb', usbCtx, async (page, note) => {
        await page.goto(`${base}/fly/?scene=${scene}&nowarn=1&set.input.howToFly=false`, { waitUntil: 'load' });
        step('usb: loaded');
        await openHelper(page);
        step('usb: helper open');
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
        step(`usb: wizard ${s.wizard} after ${note.checkAfterS} s`);
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
        step('usb: flying, climb starts');
        await curCdp.send('Profiler.enable');
        await curCdp.send('Profiler.start');
        note.profiling = true;
        // the arm switch the wizard took (the left dial) stays where it was on the check screen: centred style needs none
        await page.evaluate(() => { const w = window.__rc2Watch; if (w) Object.assign(w, { maxAge: 0, ageOver100: 0, maxFrame: 0, frames: 0, blocks: {}, replies0: window.__rc2Probe?.replies ?? 0, t0: performance.now() }); window.__rc2Hands.fixed.T = 0.6; });
        note.climb = [];
        for (let i = 0; i < 10; i++) { await page.waitForTimeout(250); const x = await state(page); note.climb.push({ alt: x.alt, motors: x.throttle?.centre?.arm ?? null, crashed: x.crashed }); }
        const s1 = await state(page);
        note.profile = await profileOf(curCdp);
        note.profiling = false;
        step(`usb: climb done, profile ${JSON.stringify(note.profile).slice(0, 1200)}`);
        note.gateWatch = await page.evaluate(() => { const w = window.__rc2Watch; const c = window.__gsfpv?.lastCrash; return { ...w, last: undefined, repliesPerS: Math.round(((window.__rc2Probe?.replies ?? 0) - w.replies0) * 1000 / (performance.now() - w.t0)), lastCrash: c ? JSON.stringify(c).slice(0, 300) : null }; });
        note.start = { alt: s0.alt, armed: s0.armed, throttle: s0.throttle, card: s0.card };
        note.up = { alt: s1.alt, armed: s1.armed, crashed: s1.crashed, throttle: s1.throttle, card: s1.card };
        // the climb: motors on (centred style: centre.arm 'on') and +1 m over the start within the 2.5 s. The drone is not
        // asked to stay up: on 2026-11-13 it rose 3 m in 1.25 s and then came down in this scene (see docs/wip/rc2.md)
        const top = Math.max(...note.climb.map((c) => c.alt ?? -Infinity));
        note.topM = s0.alt === null ? null : top - s0.alt;
        checks['usb.climbs'] = s0.alt !== null && note.topM >= 1.0 && note.climb.some((c) => c.motors === 'on') && s0.throttle?.now === 'centred';
        note.probe = s1.probe;
    });
    checks['usb.noPageErrors'] = (errorsOf.usb ?? ['not run']).length === 0;
    // the saved setup of a returning RC 2 pilot, for connect-probe.mjs
    await usbCtx.storageState({ path: outFile.replace(/\.json$/, '-state.json') });
}

if (only.includes('refused')) {
    const ctx = await browser.newContext(ctxOpts);
    await ctx.addInitScript(installFakeRc2, { refuse: true, answer: fakeAnswer, bridgePort });
    await run('refused', ctx, async (page, note) => {
        await page.goto(`${base}/fly/?scene=${scene}&nowarn=1`, { waitUntil: 'load' });
        await openHelper(page);
        await page.locator('[data-action=usb-look]').click();
        await page.locator('[data-action=usb-rc2-fly]').click({ timeout: 10000 });
        await page.waitForFunction(() => document.querySelector('[data-testid=usb-rc2-say]')?.getAttribute('data-state') === 'claim', null, { timeout: 10000 });
        note.say = await page.textContent('[data-testid=usb-rc2-say]');
        const s = await state(page);
        note.probe = s.probe;
        // lane connect C2: the helper is named a small helper program, never a bridge
        checks['refused.saysClaimFailed'] = /could not open the controller's stick channel/.test(note.say) && /helper program/.test(note.say) && !/bridge/i.test(note.say);
        checks['refused.stillOnControls'] = s.radio && s.wizard === null && s.probe.claims === 1;
    });
    checks['refused.noPageErrors'] = (errorsOf.refused ?? ['not run']).length === 0;
    await ctx.close();
}

/**
 * On an https base Chrome's Local Network Access check stands between the page and ws://127.0.0.1 (lane rc2-lna,
 * docs/wip/rc2-lna.md: Chrome 156 asks for 'loopback-network'). A pilot answers Chrome's prompt with Allow; headless
 * nobody does, so the probe grants it for the site's origin before the press. The first call that does not throw is
 * kept: CDP Browser.setPermission {name:'loopback-network'}, then Playwright's grantPermissions(['local-network-access'])
 * (measured on 2026-11-13: both open the socket; CDP 'local-network-access' or 'local-network' alone do not).
 * http://localhost bases need no grant (the check does not apply to a local page): nothing is called there.
 */
async function grantLoopback(page, note) {
    const origin = new URL(base).origin;
    if (!base.startsWith('https:')) { note.grant = 'not needed (http base)'; return; }
    const tried = [];
    const { targetInfo } = await curCdp.send('Target.getTargetInfo');
    const bcdp = await browser.newBrowserCDPSession();
    const calls = [
        ['cdp Browser.setPermission loopback-network', () => bcdp.send('Browser.setPermission', { permission: { name: 'loopback-network' }, setting: 'granted', origin, browserContextId: targetInfo.browserContextId })],
        ['playwright grantPermissions local-network-access', () => page.context().grantPermissions(['local-network-access'], { origin })]
    ];
    for (const [name, call] of calls) {
        try { await call(); note.grant = name; break; } catch (e) { tried.push(`${name}: ${String(e?.message ?? e).split('\n')[0].slice(0, 160)}`); }
    }
    note.grantTried = tried;
    if (!note.grant) note.grant = 'none worked';
}
/** in the page: what navigator.permissions says for the candidate names (an unknown name: its TypeError) */
const permStates = (page) => page.evaluate(async () => {
    const r = {};
    for (const n of ['local-network-access', 'local-network', 'loopback-network']) {
        try { r[n] = (await navigator.permissions.query({ name: n })).state; } catch (e) { r[n] = String(e?.name ?? e); }
    }
    return r;
});

if (only.includes('bridge')) {
    if (!only.includes('usb')) await usbCtx.addInitScript(installFakeRc2, { refuse: false, answer: fakeAnswer, bridgePort });
    await run('bridge', usbCtx, async (page, note, csp) => {
        if (!bridgeBlocked) await grantLoopback(page, note);
        await page.goto(`${base}/fly/?scene=${scene}&nowarn=1`, { waitUntil: 'load' });
        if (base.startsWith('https:')) note.permissions = await permStates(page);
        await openHelper(page);
        await page.waitForTimeout(1500);
        note.socketsBeforePress = (await state(page)).probe.sockets;
        // lane connect C2 (a): with the saved RC 2 setup and Chrome not asking, the page reaches the helper by itself
        // (a socket at load is allowed then); with the CSP blocking it, the quiet try fails and the press shows the line
        note.autoConnected = !!(await state(page)).wizard;
        if (!note.autoConnected) await page.locator('[data-action=usb-rc2-bridge]').click();
        // connected: the Controls screen moves on to the check (the helper and its line leave the page)
        // 'asking' (Chrome's loopback question is 'prompt' on http://localhost) is passed on the way: the socket still
        // connects; the first poll saw it in the fixes run of 2026-11-13 although the check screen came (race, not a fault)
        await page.waitForFunction(() => { const s = document.querySelector('[data-testid=usb-bridge-say]')?.getAttribute('data-state'); return (s && s !== 'opening' && s !== 'asking') || !!window.__gsfpv?.radio?.wizard?.state; }, null, { timeout: 10000 }).catch(() => undefined);
        const said = await page.evaluate(() => { const e = document.querySelector('[data-testid=usb-bridge-say]'); return e ? { state: e.getAttribute('data-state'), text: e.textContent } : null; });
        note.sayState = said ? said.state : 'flying';
        note.say = said?.text ?? '';
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

// bridge-nogrant (only when asked for): a fresh profile on an https base without the Local Network Access grant, the
// path of a pilot who has not answered Chrome's prompt yet (headless: the prompt never gets an answer). Records what the
// helper says and after how many ms; passes when the line says something other than 'opening' within 10 s and the page
// threw nothing. No grant, no Allow: what the pilot sees after Allow is the 'bridge' run.
if (only.includes('bridge-nogrant')) {
    const ctx = await browser.newContext(ctxOpts);
    await ctx.addInitScript(installFakeRc2, { refuse: true, answer: fakeAnswer, bridgePort });
    await run('bridge-nogrant', ctx, async (page, note) => {
        await page.goto(`${base}/fly/?scene=${scene}&nowarn=1`, { waitUntil: 'load' });
        if (base.startsWith('https:')) note.permissions = await permStates(page);
        await openHelper(page);
        await refuseFirst(page);
        const t0 = Date.now();
        await page.locator('[data-action=usb-rc2-bridge]').click();
        await page.waitForFunction(() => { const s = document.querySelector('[data-testid=usb-bridge-say]')?.getAttribute('data-state'); return (s && s !== 'opening') || !!window.__gsfpv?.radio?.wizard?.state; }, null, { timeout: 10000 }).catch(() => undefined);
        note.afterMs = Date.now() - t0;
        const said = await page.evaluate(() => { const e = document.querySelector('[data-testid=usb-bridge-say]'); return e ? { state: e.getAttribute('data-state'), text: e.textContent } : null; });
        note.sayState = said ? said.state : 'flying';
        note.say = said?.text ?? '';
        // 3 s later: still the same line (a pending prompt is not given up), and how many sockets the page made
        await page.waitForTimeout(3000);
        note.sayStateAfter3s = await page.evaluate(() => document.querySelector('[data-testid=usb-bridge-say]')?.getAttribute('data-state') ?? 'gone');
        note.sockets = (await state(page)).probe.sockets;
        checks['bridgeNoGrant.answered'] = !!note.sayState && note.sayState !== 'opening';
    });
    checks['bridgeNoGrant.noPageErrors'] = (errorsOf['bridge-nogrant'] ?? ['not run']).length === 0;
    await ctx.close();
}

// bridge-lna (only when named; lane rc2-lna): Chrome's question simulated in the page, on any base, so the page's own
// handling is seen in a browser: navigator.permissions.query('loopback-network') answers a fake status, and while it is
// not 'granted' the page's sockets go to a closed port (as Chrome blocks them). 'prompt': the helper shows the asking
// line and keeps it 3 s; after the fake Allow (state 'granted' and a change event) the wizard opens with no second
// press. 'denied': the no-answer line (site settings), no socket. The bridge must be running, as for 'bridge'.
/** lane connect C2: in a fresh profile the helper is offered after the stick channel was refused (helperOffered) */
async function refuseFirst(page) {
    await page.locator('[data-action=usb-look]').click();
    await page.locator('[data-action=usb-rc2-fly]').click({ timeout: 10000 });
    await page.waitForSelector('[data-action=usb-rc2-bridge]', { timeout: 10000 });
}
const installFakeLna = ({ mode }) => {
    const st = new EventTarget();
    st.state = mode;
    const q = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = (d) => (d && d.name === 'loopback-network' ? Promise.resolve(st) : q(d));
    window.__lnaAllow = () => { st.state = 'granted'; st.dispatchEvent(new Event('change')); };
    const Inner = window.WebSocket;
    window.WebSocket = class extends Inner { constructor(u, ...r) { super(st.state === 'granted' ? u : 'ws://127.0.0.1:9/', ...r); } };
};
if (only.includes('bridge-lna')) {
    for (const mode of ['prompt', 'denied']) {
        const ctx = await browser.newContext(ctxOpts);
        await ctx.addInitScript(installFakeRc2, { refuse: true, answer: fakeAnswer, bridgePort });
        await ctx.addInitScript(installFakeLna, { mode });
        const name = `bridge-lna-${mode}`;
        await run(name, ctx, async (page, note) => {
            await page.goto(`${base}/fly/?scene=${scene}&nowarn=1`, { waitUntil: 'load' });
            await openHelper(page);
            await refuseFirst(page);
            const sayOf = () => page.evaluate(() => { const e = document.querySelector('[data-testid=usb-bridge-say]'); return e ? { state: e.getAttribute('data-state'), text: e.textContent } : { state: 'gone', text: '' }; });
            await page.locator('[data-action=usb-rc2-bridge]').click();
            note.clicks = 1;
            await page.waitForFunction(() => { const s = document.querySelector('[data-testid=usb-bridge-say]')?.getAttribute('data-state'); return !!s && s !== 'opening'; }, null, { timeout: 10000 }).catch(() => undefined);
            note.first = await sayOf();
            if (mode === 'denied') {
                note.sockets = (await state(page)).probe.sockets;
                checks['bridgeLna.deniedSaysSettings'] = note.first.state === 'denied' && /site settings/.test(note.first.text);
                checks['bridgeLna.deniedNoSocket'] = note.sockets === 0;
                return;
            }
            await page.waitForTimeout(3000);
            note.after3s = await sayOf();
            note.socketsWhileAsking = (await state(page)).probe.sockets;
            checks['bridgeLna.promptAsks'] = note.first.state === 'asking' && /Allow/.test(note.first.text) && note.after3s.state === 'asking';
            const t0 = Date.now();
            await page.evaluate(() => window.__lnaAllow());
            await page.waitForFunction(() => !!window.__gsfpv?.radio?.wizard?.state, null, { timeout: 15000 }).catch(() => undefined);
            note.wizardAfterMs = Date.now() - t0;
            const b = await state(page);
            note.wizard = b.wizard;
            note.socketsAfterAllow = b.probe.sockets;
            checks['bridgeLna.allowConnectsWithOnePress'] = !!b.wizard;
        });
        checks[`bridgeLna.${mode}.noPageErrors`] = (errorsOf[name] ?? ['not run']).length === 0;
        await ctx.close();
    }
}
if (usbCtx) await usbCtx.close();
await browser.close();
const pass = Object.keys(checks).length > 0 && Object.values(checks).every(Boolean);
out.pass = pass;
out.checks = checks;
writeFileSync(outFile, JSON.stringify(out, null, 1));
console.log(JSON.stringify({ pass, checks }));
process.exit(pass ? 0 : 1);
