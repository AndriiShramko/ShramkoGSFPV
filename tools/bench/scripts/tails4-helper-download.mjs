// The helper's two download links on the Controls screen, checked by the SAVED bytes (lane tails4 T1; train 2 lead,
// 'Held back': "a probe that presses both links and compares the saved bytes is still missing"). The download event
// alone proves nothing: a link can fire it and still save the wrong text (or Chromium cancels a download that came
// through route.fulfill). So this probe presses each link, saves the file Chrome wrote and compares it byte for byte
// with the repository's tools/rc-bridge files (start-dji-helper.cmd with Windows line ends, dji-helper.py = rc_bridge.py).
//
// How the helper section is reached: the 'nohelper' case of connect-probe.mjs (a fake USB device in the page whose stick
// channel cannot be claimed; no helper program runs, no real controller, the helper's address goes to a closed probe
// port, never 47310). One press on Connect, then the two links.
//
// Negative control: --neg makes the page's Blob carry one byte less (the download still happens, its event fires);
// the probe must then FAIL on both 'bytes' checks.
// Usage: node tails4-helper-download.mjs <base with the locale> <out.json> [--neg]
// Prints ONE last line of JSON {pass, checks}; exit 0 only on pass.
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pickHarnessBrowser } from './visual-browser.mjs';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '');
const require = createRequire(ROOT + '/tools/bench/package.json');
const { chromium } = require('playwright');
const base = process.argv[2] ?? 'http://localhost:6120/en';
const outFile = process.argv[3] ?? ROOT + '/.cache/tails4-helper-download.json';
const neg = process.argv.includes('--neg');
const saveDir = dirname(outFile) + '/tails4-downloads' + (neg ? '-neg' : '');
mkdirSync(saveDir, { recursive: true });
const T0 = Date.now();
const step = (s) => process.stderr.write(`[${((Date.now() - T0) / 1000).toFixed(1)}s] ${s}\n`);

/** the bytes the pilot must get, by the file name the page offers (devices/helper-files.ts HELPER_SOURCE) */
const cmdText = readFileSync(ROOT + '/tools/rc-bridge/start-dji-helper.cmd', 'utf8').replace(/\r?\n/g, '\r\n');
const expected = {
    'start-dji-helper.cmd': Buffer.from(cmdText, 'utf8'),
    'dji-helper.py': readFileSync(ROOT + '/tools/rc-bridge/rc_bridge.py')
};

function installPage(cfg) {
    // the helper's socket to a closed port (nothing listens: the 'no helper' case)
    const RealWS = window.WebSocket;
    window.WebSocket = class extends RealWS { constructor(u, ...a) { super(String(u).replace(':47310/', ':6139/'), ...a); } };
    const st = new EventTarget();
    st.state = 'granted';
    const q = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = (d) => (d && d.name === 'loopback-network' ? Promise.resolve(st) : q(d));
    const iface = (n, sub, eps) => ({ interfaceNumber: n, alternates: [{ interfaceClass: 0xff, interfaceSubclass: sub, interfaceProtocol: 1, endpoints: eps }] });
    const bulk = [{ endpointNumber: 1, direction: 'in', type: 'bulk' }, { endpointNumber: 1, direction: 'out', type: 'bulk' }];
    const dev = {
        vendorId: 0x2ca3, productId: 0x1021, productName: 'Probe USB device', manufacturerName: 'Probe', opened: false, configuration: null,
        configurations: [{ configurationValue: 1, interfaces: [iface(0, 0x43, bulk), iface(2, 0x42, [])] }],
        async open() { this.opened = true; }, async close() { this.opened = false; },
        async selectConfiguration(v) { this.configuration = { configurationValue: v }; },
        async claimInterface() { throw new DOMException('Unable to claim interface.', 'NetworkError'); },
        async releaseInterface() {}, async transferOut() { throw new Error('not claimed'); }, async transferIn() { throw new Error('not claimed'); }
    };
    const usb = { requestDevice: async () => dev, getDevices: async () => [], addEventListener() {}, removeEventListener() {} };
    Object.defineProperty(Navigator.prototype, 'usb', { get: () => usb, configurable: true });
    if (navigator.hid) navigator.hid.requestDevice = async () => [];
    if (cfg.neg) {
        // negative control: every text Blob loses its last character (the download itself still happens)
        const RealBlob = window.Blob;
        window.Blob = class extends RealBlob {
            constructor(parts, o) { super((parts ?? []).map((p) => (typeof p === 'string' && p.length > 0 ? p.slice(0, -1) : p)), o); }
        };
    }
}

const pick = pickHarnessBrowser({ expected: chromium.executablePath() }, false);
const browser = await chromium.launch({ ...pick.launch, headless: true });
const out = { what: 'tails4-helper-download.mjs: the helper links save the repository bytes', base, neg, at: new Date().toISOString(), browser: browser.version(), files: {} };
const checks = {};
const url = `${base}/fly/?scene=887f27aa&nowarn=1&render=off&set.input.howToFly=false`;
const ctx = await browser.newContext({ viewport: { width: 1536, height: 730 }, deviceScaleFactor: 1.25, acceptDownloads: true, bypassCSP: true });
await ctx.addInitScript(installPage, { neg });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)));
try {
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__gsfpv?.status === 'ready' && !!document.querySelector('.screen.radio'), null, { timeout: 120000 });
    await page.locator('[data-action=radio-connect]').click();
    step('connect pressed');
    // the links turn into same-origin blob URLs once the bundled copies are loaded
    await page.waitForFunction(() => {
        const a = [...document.querySelectorAll('[data-testid=usb-helper-file]')];
        return a.length === 2 && a.every((x) => (x.getAttribute('href') ?? '').startsWith('blob:'));
    }, null, { timeout: 20000 }).catch(() => undefined);
    const links = await page.evaluate(() => [...document.querySelectorAll('[data-testid=usb-helper-file]')].map((a) => ({ file: a.getAttribute('data-file'), href: (a.getAttribute('href') ?? '').slice(0, 60), download: a.getAttribute('download'), target: a.getAttribute('target') })));
    out.links = links;
    checks['links.two'] = links.length === 2;
    checks['links.sameOrigin'] = links.length === 2 && links.every((l) => l.href.startsWith('blob:') && !l.target);
    for (const name of Object.keys(expected)) {
        const note = {};
        out.files[name] = note;
        try {
            const [dl] = await Promise.all([
                page.waitForEvent('download', { timeout: 15000 }),
                page.locator(`[data-testid=usb-helper-file][data-file="${name}"]`).click()
            ]);
            note.event = true;
            note.suggested = dl.suggestedFilename();
            const path = `${saveDir}/${name}`;
            await dl.saveAs(path);
            note.failure = await dl.failure();
            const got = readFileSync(path);
            const want = expected[name];
            note.bytes = got.length;
            note.expectedBytes = want.length;
            note.firstDiff = (() => { const n = Math.min(got.length, want.length); for (let i = 0; i < n; i++) if (got[i] !== want[i]) return i; return got.length === want.length ? -1 : n; })();
            note.crlf = name.endsWith('.cmd') ? !/(^|[^\r])\n/.test(got.toString('utf8')) : null;
        } catch (e) {
            note.threw = String(e?.message ?? e).slice(0, 300);
        }
        checks[`${name}.event`] = note.event === true;
        checks[`${name}.name`] = note.suggested === name;
        checks[`${name}.saved`] = note.failure === null && (note.bytes ?? 0) > 0;
        checks[`${name}.bytes`] = note.firstDiff === -1;
        if (name.endsWith('.cmd')) checks[`${name}.crlf`] = note.crlf === true;
    }
} catch (e) {
    out.threw = String(e?.message ?? e).slice(0, 300);
    checks.ran = false;
}
out.errors = errors;
checks.noPageErrors = errors.length === 0;
await browser.close();
const pass = Object.keys(checks).length > 0 && Object.values(checks).every(Boolean);
out.pass = pass;
out.checks = checks;
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify(out, null, 1));
console.log(JSON.stringify({ pass, checks }));
process.exit(pass ? 0 : 1);
