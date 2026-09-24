// Probe runner: launches real Chromium with WebGPU and reports what actually happened.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const URL_ = process.argv[2] || 'http://127.0.0.1:5188/probe/index.html';
const TIMEOUT = Number(process.env.PROBE_TIMEOUT || 180000);

const browser = await chromium.launch({
    channel: 'chrome',              // the user's real Chrome — representative of what pilots run
    headless: process.env.PROBE_HEADLESS === '1',
    args: [
        '--enable-unsafe-webgpu',
        '--enable-features=Vulkan,UseSkiaRenderer',
        '--ignore-gpu-blocklist',
        '--enable-gpu-rasterization',
        '--disable-frame-rate-limit',
        '--disable-gpu-vsync'
    ]
});

const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

const consoleLines = [];
page.on('console', m => consoleLines.push(`${m.type()}: ${m.text()}`.slice(0, 300)));
page.on('pageerror', e => consoleLines.push('pageerror: ' + e.message.slice(0, 300)));

console.log('opening', URL_);
await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 60000 });

// wait for the page to report loaded or failed
const t0 = Date.now();
let probe = null;
while (Date.now() - t0 < TIMEOUT) {
    probe = await page.evaluate(() => window.__probe || null);
    if (probe && (probe.status === 'done' || probe.status === 'failed')) break;
    await page.waitForTimeout(1000);
}

writeFileSync('probe/last-result.json', JSON.stringify(probe, null, 1));
console.log('\n=== PROBE STATE (saved to probe/last-result.json) ===');
console.log(JSON.stringify(probe, null, 1).slice(0, 400));

if (probe?.status === 'loaded') {
    // GPU adapter identity — so a number is never reported without knowing what produced it
    const gpu = await page.evaluate(async () => {
        try {
            const a = await navigator.gpu?.requestAdapter();
            const i = a?.info || (a?.requestAdapterInfo ? await a.requestAdapterInfo() : null);
            return i ? { vendor: i.vendor, architecture: i.architecture, device: i.device, description: i.description } : 'no adapter info';
        } catch (e) { return 'err ' + e.message; }
    });
    console.log('\n=== GPU ADAPTER ===');
    console.log(JSON.stringify(gpu));
}

console.log('\n=== CONSOLE (last 40) ===');
console.log(consoleLines.slice(-40).join('\n'));

await page.screenshot({ path: 'probe/shot.png' });
console.log('\nscreenshot -> probe/shot.png');

await browser.close();
