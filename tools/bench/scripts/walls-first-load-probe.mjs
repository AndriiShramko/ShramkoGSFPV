// What a pilot downloads before a scan is ready to fly (walls stage V1-finish): the bytes on the wire
// (CDP encodedDataLength, so after the CDN's compression) from the page open until __gsfpv.status is
// 'ready', without the /walls/ files. Published walls should not take longer to download than this.
//   node tools/bench/scripts/walls-first-load-probe.mjs http://localhost:5801/en <out.json> <id>[,<id>...]
// Headless; takes no GPU lock itself (wrap it). Reads only; presses nothing.
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { pickBrowser } from '../src/chrome.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [base, outFile, ids] = process.argv.slice(2);
if (!base || !outFile || !ids) { console.error('usage: first-load-probe.mjs <base with /en> <out.json> <ids>'); process.exit(2); }
const pick = pickBrowser({ expected: chromium.executablePath() });
const browser = await chromium.launch({ ...pick.launch, headless: true });
const out = [];
for (const id of ids.split(',')) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    const urls = new Map();
    const r = { id, wire: 0, wireScan: 0, wireWalls: 0, requests: 0 };
    cdp.on('Network.requestWillBeSent', (e) => urls.set(e.requestId, e.request.url));
    cdp.on('Network.loadingFinished', (e) => {
        const u = urls.get(e.requestId) || '';
        r.requests++;
        if (u.includes('/walls/')) { r.wireWalls += e.encodedDataLength; return; }
        r.wire += e.encodedDataLength;
        if (!u.startsWith(new URL(base).origin)) r.wireScan += e.encodedDataLength;
    });
    const t0 = Date.now();
    try {
        await page.goto(`${base}/fly/?scene=${id}&nowarn=1&set.input.howToFly=false`, { waitUntil: 'load', timeout: 120000 });
        await page.waitForFunction(() => ['ready', 'error'].includes(window.__gsfpv && window.__gsfpv.status), null, { timeout: 240000 });
        r.readyS = (Date.now() - t0) / 1000;
        r.status = await page.evaluate(() => window.__gsfpv.status);
        r.wireAtReady = r.wire;
        r.wireScanAtReady = r.wireScan;
    } catch (e) { r.fail = String(e).slice(0, 200); }
    out.push(r);
    console.log(JSON.stringify(r));
    await ctx.close();
}
await browser.close();
writeFileSync(outFile, JSON.stringify(out, null, 1));
