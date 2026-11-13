// Lane connect, stage C2 (docs/wip/connect.md "The flow"): a controller reaches the page with as few presses as the
// browser allows. Three cases on a local release, plus the Controls screen's screenshots:
//   pad       a fresh profile on the Controls screen; 2 s later the browser shows a gamepad that no list knows (as Chrome
//             does after a stick move): the wizard opens with no press.
//   returning a returning DJI RC 2 pilot: the saved setup from rc2-probe.mjs's usb run (its <out>-state.json), Chrome's
//             Local Network Access answered 'granted' (faked in the page as rc2-probe bridge-lna does) and the replay
//             helper running: the check screen (or flight) with no press, stick frames flowing.
//   nohelper  a fresh profile, a DJI RC 2 whose stick channel Chrome cannot claim (Windows with DJI's driver), no helper
//             running: one press of "Connect my controller" ends on the plain line ("1. Double-click"); then the probe
//             starts the helper and the page connects with no second press (the wizard opens). No word "bridge" shown.
// The page's helper address ws://127.0.0.1:47310/ is sent to the probe's own helper port (the owner's real helper may
// hold 47310), so the contexts bypass the page's CSP. The helper is started and stopped by this probe.
// Usage: node connect-probe.mjs <base with the locale> <out.json> <rc2-probe state.json> <helper port> [shots dir]
// Prints ONE last line of JSON {pass, checks}; exit 0 only on pass.
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, openSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { pickHarnessBrowser } from './visual-browser.mjs';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '');
const require = createRequire(ROOT + '/tools/bench/package.json');
const { chromium } = require('playwright');
const base = process.argv[2] ?? 'http://localhost:5780/en';
const outFile = process.argv[3] ?? ROOT + '/.cache/connect-probe.json';
const stateFile = process.argv[4] ?? '';
const helperPort = Number(process.argv[5] ?? 5782);
const shots = process.argv[6] ?? '';
const scene = '887f27aa'; // open sky above the spawn (centre-throttle-probe.mjs)
const RC2_KEY = 'hid:2ca3:1021:DJI RC 2:12:d'; // the RC 2's saved setup key (rc2-probe.mjs usb)
mkdirSync(dirname(outFile), { recursive: true });
if (shots) mkdirSync(shots, { recursive: true });
const T0 = Date.now();
const step = (s) => process.stderr.write(`[${((Date.now() - T0) / 1000).toFixed(1)}s] ${s}\n`);

/** In the page, before the app: the helper socket to the probe's port, its answers counted; Chrome's answer faked. */
function installPage(cfg) {
    const counts = { sockets: 0, answers: 0, claims: 0, hidChooser: 0, usbChooser: 0 };
    window.__connectProbe = counts;
    const RealWS = window.WebSocket;
    window.WebSocket = class extends RealWS {
        constructor(u, ...a) {
            super(String(u).replace(':47310/', `:${cfg.port}/`), ...a);
            counts.sockets++;
            this.addEventListener('message', (e) => { if (typeof e.data === 'string' && e.data.indexOf('"v"') >= 0) counts.answers++; });
        }
    };
    if (cfg.lna) {
        const st = new EventTarget();
        st.state = cfg.lna;
        const q = navigator.permissions.query.bind(navigator.permissions);
        navigator.permissions.query = (d) => (d && d.name === 'loopback-network' ? Promise.resolve(st) : q(d));
    }
    if (cfg.pad) {
        // a gamepad no list knows; the browser shows it only after cfg.pad ms (a stick moved)
        const t0 = performance.now();
        const pad = { id: 'Probe Joystick (Vendor: 1209 Product: 4f54)', index: 0, connected: true, mapping: '', timestamp: 0, axes: [0, 0, -1, 0, 0, 0], buttons: Array.from({ length: 12 }, () => ({ pressed: false, touched: false, value: 0 })) };
        navigator.getGamepads = () => {
            if (performance.now() - t0 < cfg.pad || !document.querySelector('.screen.radio')) return [null, null, null, null];
            pad.timestamp = performance.now();
            return [pad, null, null, null];
        };
    }
    if (cfg.rc2) {
        // the owner's RC 2 (rc2-probe.mjs installFakeRc2): interface 0 with the stick channel, claim refused
        const iface = (n, sub, eps) => ({ interfaceNumber: n, alternates: [{ interfaceClass: 0xff, interfaceSubclass: sub, interfaceProtocol: 1, endpoints: eps }] });
        const bulk = [{ endpointNumber: 1, direction: 'in', type: 'bulk' }, { endpointNumber: 1, direction: 'out', type: 'bulk' }];
        const dev = {
            vendorId: 0x2ca3, productId: 0x1021, productName: 'DJI RC 2', manufacturerName: 'DJI', opened: false, configuration: null,
            configurations: [{ configurationValue: 1, interfaces: [iface(0, 0x43, bulk), iface(2, 0x42, [])] }],
            async open() { this.opened = true; }, async close() { this.opened = false; },
            async selectConfiguration(v) { this.configuration = { configurationValue: v }; },
            async claimInterface() { counts.claims++; throw new DOMException('Unable to claim interface.', 'NetworkError'); },
            async releaseInterface() {}, async transferOut() { throw new Error('not claimed'); }, async transferIn() { throw new Error('not claimed'); }
        };
        const usb = { requestDevice: async () => { counts.usbChooser++; return dev; }, getDevices: async () => [], addEventListener() {}, removeEventListener() {} };
        Object.defineProperty(Navigator.prototype, 'usb', { get: () => usb, configurable: true });
        // the HID chooser closed with nothing picked (the RC 2 has no HID part)
        const hid = navigator.hid;
        if (hid) hid.requestDevice = async () => { counts.hidChooser++; return []; };
    }
}

const look = (page) => page.evaluate(() => {
    const g = window.__gsfpv;
    const w = g?.radio?.wizard?.state;
    const say = document.querySelector('[data-testid=usb-bridge-say]');
    const screen = document.querySelector('.screen.radio');
    return {
        ready: g?.status === 'ready', radio: !!screen, wizard: w ? (w.stage ? `${w.id}/${w.stage}` : w.id) : null,
        key: g?.radio?.hid?.key ?? w?.profile?.deviceKey ?? null, probe: window.__connectProbe,
        say: say ? { state: say.getAttribute('data-state'), text: (say.textContent ?? '').slice(0, 400) } : null,
        bridgeWord: screen ? /bridge/i.test(screen.innerText) : null,
        // review CN-5: the line under the button and whether the helper's line is inside the viewport
        connectSay: (document.querySelector('[data-testid=radio-connect-say]')?.textContent ?? '').slice(0, 200),
        sayInView: say ? (() => { const r = say.getBoundingClientRect(); return r.height > 0 && r.top >= 0 && r.bottom <= innerHeight; })() : null
    };
});
const waitFor = async (page, ok, ms) => {
    const t0 = Date.now();
    let s = await look(page);
    while (!ok(s) && Date.now() - t0 < ms) { await page.waitForTimeout(200); s = await look(page); }
    return { s, ms: Date.now() - t0 };
};

let helper = null;
const startHelper = () => {
    const log = openSync(dirname(outFile) + '/connect-helper.log', 'a');
    helper = spawn('python', ['-X', 'utf8', ROOT + '/tools/rc-bridge/rc_bridge.py', '--replay', ROOT + '/evidence/2026-11-13/rc2/frames-rest.json', '--wiggle', '--dev', '--port', String(helperPort)], { stdio: ['ignore', log, log] });
    step(`helper started on ${helperPort} (pid ${helper.pid})`);
};
const stopHelper = () => { if (helper) { helper.kill(); helper = null; step('helper stopped'); } };

const pick = pickHarnessBrowser({ expected: chromium.executablePath() }, false);
const browser = await chromium.launch({ ...pick.launch, headless: true });
const out = { what: 'connect-probe.mjs: a controller reaches the page by itself (lane connect C2)', base, at: new Date().toISOString(), browser: browser.version(), runs: {} };
const checks = {};
const url = `${base}/fly/?scene=${scene}&nowarn=1&set.input.howToFly=false`;

async function run(name, ctxOpts, cfg, fn) {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, bypassCSP: true, ...ctxOpts });
    await ctx.addInitScript(installPage, { port: helperPort, ...cfg });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)));
    const note = {};
    out.runs[name] = note;
    step(`${name}: start`);
    try { await fn(page, note); } catch (e) { note.threw = String(e?.message ?? e).slice(0, 300); checks[`${name}.ran`] = false; }
    note.errors = errors;
    checks[`${name}.noPageErrors`] = errors.length === 0;
    if (shots) await page.screenshot({ path: `${shots}/connect-c2-${name}.png` }).catch(() => undefined);
    writeFileSync(outFile, JSON.stringify(out, null, 1));
    await ctx.close();
    step(`${name}: done`);
}

try {
    // the Controls screen of a fresh profile, at the two sizes (C2.5)
    if (shots) {
        for (const [w, hgt] of [[1920, 1080], [844, 390]]) {
            const ctx = await browser.newContext({ viewport: { width: w, height: hgt } });
            const page = await ctx.newPage();
            await page.goto(url, { waitUntil: 'load' });
            await page.waitForFunction(() => window.__gsfpv?.status === 'ready' && document.querySelector('[data-action=radio-connect]'), null, { timeout: 120000 });
            await page.waitForTimeout(800);
            await page.screenshot({ path: `${shots}/connect-c2-controls-${w}x${hgt}.png` });
            out[`shot${w}`] = await page.evaluate(() => { const b = document.querySelector('[data-action=radio-connect]')?.getBoundingClientRect(); return b ? { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), inView: b.bottom <= innerHeight && b.right <= innerWidth } : null; });
            checks[`shots.connectButtonInView${w}`] = !!out[`shot${w}`]?.inView;
            await ctx.close();
        }
    }

    await run('pad', {}, { pad: 2000 }, async (page, note) => {
        await page.goto(url, { waitUntil: 'load' });
        const a = await waitFor(page, (s) => s.ready && s.radio, 120000);
        note.controlsShown = a.s.radio && !a.s.wizard;
        const b = await waitFor(page, (s) => !!s.wizard, 8000);
        note.wizard = b.s.wizard;
        note.key = b.s.key;
        note.afterMs = a.ms + b.ms;
        checks['pad.controlsFirst'] = note.controlsShown;
        checks['pad.wizardWithNoPress'] = !!b.s.wizard;
    });

    startHelper();
    await new Promise((r) => setTimeout(r, 1500)); // the helper's socket listening (estimate)
    const haveState = !!stateFile && existsSync(stateFile);
    note0: {
        if (!haveState) { checks['returning.ran'] = false; out.runs.returning = { skipped: 'no rc2-probe state file: ' + stateFile }; break note0; }
        await run('returning', { storageState: stateFile }, { lna: 'granted' }, async (page, note) => {
            await page.goto(url, { waitUntil: 'load' });
            const a = await waitFor(page, (s) => s.ready && ((s.wizard === 'check' && s.key === RC2_KEY) || (!s.radio && (s.probe?.answers ?? 0) > 0)), 30000);
            note.reached = a.s.wizard ?? (a.s.radio ? 'controls' : 'flight');
            note.key = a.s.key;
            note.afterMs = a.ms;
            const n0 = (await look(page)).probe.answers;
            await page.waitForTimeout(2000);
            note.answersIn2s = (await look(page)).probe.answers - n0;
            note.sockets = (await look(page)).probe.sockets;
            checks['returning.checkOrFlightWithNoPress'] = note.reached === 'check' ? note.key === RC2_KEY : note.reached === 'flight';
            // 2 s of the replay helper's answers: at least 50 (rc2-probe bridge's floor)
            checks['returning.framesFlow'] = note.answersIn2s >= 50;
        });
    }
    stopHelper();
    await new Promise((r) => setTimeout(r, 1000));

    // Chrome's Local Network Access answered 'granted' (the pilot allowed it once): headless Chrome on http://localhost
    // says 'prompt' for 'loopback-network' (measured on 2026-11-13 by this probe), and while it asks the page waits
    // for the Allow instead of retrying (no question may come by itself)
    await run('nohelper', {}, { rc2: true, lna: 'granted' }, async (page, note) => {
        await page.goto(url, { waitUntil: 'load' });
        await waitFor(page, (s) => s.ready && s.radio, 120000);
        await page.waitForSelector('[data-action=radio-connect]', { timeout: 10000 });
        note.permissions = await page.evaluate(async () => { try { return (await navigator.permissions.query({ name: 'loopback-network' })).state; } catch (e) { return String(e?.name ?? e); } });
        await page.locator('[data-action=radio-connect]').click();
        note.presses = 1;
        const a = await waitFor(page, (s) => s.say?.state === 'nobridge' || !!s.wizard, 15000);
        note.line = a.s.say;
        note.choosers = { hid: a.s.probe.hidChooser, usb: a.s.probe.usbChooser, claims: a.s.probe.claims };
        note.bridgeWord = a.s.bridgeWord;
        checks['nohelper.plainLine'] = a.s.say?.state === 'nobridge' && /1\. Double-click/.test(a.s.say.text);
        checks['nohelper.noWordBridge'] = a.s.bridgeWord === false;
        checks['nohelper.onePress'] = a.s.probe.usbChooser === 1 && a.s.probe.claims === 1;
        await page.waitForTimeout(1200); // the smooth scroll settles (estimate)
        const v = await look(page);
        note.connectSay = v.connectSay;
        note.sayInView = v.sayInView;
        checks['nohelper.lineUnderButton'] = /just below/.test(v.connectSay);
        checks['nohelper.helperLineInView'] = v.sayInView === true;
        if (shots) await page.screenshot({ path: `${shots}/connect-c2-nohelper-line.png` }).catch(() => undefined);
        await page.waitForTimeout(3000);
        startHelper();
        const b = await waitFor(page, (s) => !!s.wizard || s.say?.state === 'flying', 20000);
        await page.waitForTimeout(500);
        const c = await look(page);
        note.afterHelperMs = b.ms;
        note.after = { wizard: c.wizard, say: c.say?.state ?? null, answers: c.probe.answers };
        checks['nohelper.connectsWhenHelperStarts'] = !!c.wizard && c.probe.answers > 0;
    });
} finally {
    stopHelper();
}
await browser.close();
const pass = Object.keys(checks).length > 0 && Object.values(checks).every(Boolean);
out.pass = pass;
out.checks = checks;
writeFileSync(outFile, JSON.stringify(out, null, 1));
console.log(JSON.stringify({ pass, checks }));
process.exit(pass ? 0 : 1);
