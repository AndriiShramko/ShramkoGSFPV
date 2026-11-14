// Lane rc2-lna (docs/wip/rc2-lna.md): why a page on the public https site cannot reach the RC bridge on
// ws://127.0.0.1:47310 in headless Chrome. One variant per launch context:
//   none           no grant
//   pw:<name>      Playwright context.grantPermissions([name], {origin})
//   cdp-grant:<t>  CDP Browser.grantPermissions({permissions:[t], origin})
//   cdp-set:<name> CDP Browser.setPermission({permission:{name}, setting:'granted', origin})
// In each: the page /en/fly/?rcbridge=1 (its CSP allows the bridge), navigator.permissions.query for the candidate
// names, then a WebSocket to the bridge made in the page (as the helper's button does), its open/error/close with
// times, and what CDP's Network domain and the console say about it. Nothing is pressed on the page.
// Usage: node rc2-lna-diag.mjs <base with locale> <out.json> [variant,variant...]
// With DIAG_ARGS="--disable-features=LocalNetworkAccessChecks" the browser starts with that switch (diagnostic only).
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pickHarnessBrowser } from './visual-browser.mjs';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '');
const require = createRequire(ROOT + '/tools/bench/package.json');
const { chromium } = require('playwright');
const base = process.argv[2] ?? 'https://gsfpv.flyreelstudio.eu/en';
const outFile = process.argv[3] ?? ROOT + '/.cache/rc2-lna-diag.json';
const NAMES = ['local-network-access', 'local-network', 'loopback-network'];
const CDP_TYPES = ['localNetworkAccess', 'localNetwork', 'loopbackNetwork'];
const variants = process.argv[4] ? process.argv[4].split(',') : ['none', ...NAMES.map((n) => 'pw:' + n), ...CDP_TYPES.map((t) => 'cdp-grant:' + t), ...NAMES.map((n) => 'cdp-set:' + n)];
const extraArgs = process.env.DIAG_ARGS ? process.env.DIAG_ARGS.split(' ') : [];
const origin = new URL(base).origin;
mkdirSync(dirname(outFile), { recursive: true });

const pick = pickHarnessBrowser({ expected: chromium.executablePath() }, false);
const browser = await chromium.launch({ ...pick.launch, headless: true, args: extraArgs });
const out = { what: 'rc2-lna-diag.mjs', base, origin, at: new Date().toISOString(), browser: browser.version(), browserKind: pick.kind, args: extraArgs, runs: {} };
const bcdp = await browser.newBrowserCDPSession();

for (const v of variants) {
    const ctx = await browser.newContext();
    const note = { grant: null };
    out.runs[v] = note;
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    try {
        const [kind, name] = v.split(':');
        const { targetInfo } = await cdp.send('Target.getTargetInfo');
        const browserContextId = targetInfo.browserContextId;
        if (kind === 'pw') await ctx.grantPermissions([name], { origin });
        else if (kind === 'cdp-grant') await bcdp.send('Browser.grantPermissions', { permissions: [name], origin, browserContextId });
        else if (kind === 'cdp-set') await bcdp.send('Browser.setPermission', { permission: { name }, setting: 'granted', origin, browserContextId });
        note.grant = kind === 'none' ? 'none' : 'ok';
    } catch (e) {
        note.grant = 'threw: ' + String(e?.message ?? e).split('\n')[0].slice(0, 200);
    }
    if (note.grant !== 'ok' && note.grant !== 'none') { await ctx.close(); writeFileSync(outFile, JSON.stringify(out, null, 1)); continue; }
    const net = [];
    await cdp.send('Network.enable');
    for (const ev of ['webSocketCreated', 'webSocketWillSendHandshakeRequest', 'webSocketHandshakeResponseReceived', 'webSocketFrameError', 'webSocketClosed', 'loadingFailed']) {
        cdp.on('Network.' + ev, (p) => { const s = JSON.stringify(p); if (ev !== 'loadingFailed' || /127\.0\.0\.1|websocket/i.test(s)) net.push({ ev, p: s.slice(0, 600) }); });
    }
    await cdp.send('Audits.enable').catch(() => undefined);
    const issues = [];
    cdp.on('Audits.issueAdded', (p) => issues.push(JSON.stringify(p.issue).slice(0, 600)));
    const consoleLines = [];
    page.on('console', (m) => consoleLines.push(`${m.type()}: ${m.text().slice(0, 300)}`));
    await page.goto(`${base}/fly/?rcbridge=1&nowarn=1`, { waitUntil: 'domcontentloaded' });
    note.query = await page.evaluate(async (names) => {
        const r = {};
        for (const n of names) {
            try { r[n] = (await navigator.permissions.query({ name: n })).state; } catch (e) { r[n] = `${e.name}: ${String(e.message).slice(0, 120)}`; }
        }
        return r;
    }, NAMES);
    note.ws = await page.evaluate(() => new Promise((resolve) => {
        const t0 = performance.now();
        const ev = [];
        const ms = () => Math.round(performance.now() - t0);
        let ws;
        try { ws = new WebSocket('ws://127.0.0.1:47310/'); } catch (e) { resolve({ threw: String(e) }); return; }
        ws.onopen = () => ev.push(['open', ms()]);
        ws.onerror = () => ev.push(['error', ms()]);
        ws.onmessage = (e) => { if (ev.filter((x) => x[0] === 'message').length < 2) ev.push(['message', ms(), String(e.data).slice(0, 80)]); };
        ws.onclose = (e) => { ev.push(['close', ms(), e.code, e.wasClean]); resolve({ ev }); };
        setTimeout(() => { ev.push(['still', ms(), ws.readyState]); try { ws.close(); } catch { /* */ } resolve({ ev }); }, 8000);
    }));
    await page.waitForTimeout(500);
    note.net = net;
    note.issues = issues;
    note.console = consoleLines.filter((l) => /127\.0\.0\.1|local|network|private|websocket/i.test(l)).slice(0, 10);
    process.stderr.write(`${v}: grant ${note.grant} query ${JSON.stringify(note.query)} ws ${JSON.stringify(note.ws).slice(0, 200)}\n`);
    await ctx.close();
    writeFileSync(outFile, JSON.stringify(out, null, 1));
}
await browser.close();
writeFileSync(outFile, JSON.stringify(out, null, 1));
console.log(JSON.stringify(Object.fromEntries(Object.entries(out.runs).map(([k, r]) => [k, { grant: r.grant, ws: r.ws?.ev?.map((e) => e[0]).join('>') ?? r.ws }]))));
