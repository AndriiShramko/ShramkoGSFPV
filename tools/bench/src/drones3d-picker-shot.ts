// Screenshots of the real drone picker and the pause menu's "Your drone" card on the dev server (v0.9 lane D), to look at the
// layout while it is being made. Takes the GPU lock. The acceptance run (accept-v09-drones3d.ts) is the evidence.
//   cd apps/fly && npx vite --port <port> --strictPort      (another shell)
//   cd tools/bench && DEV=http://localhost:<port> OUT=<dir> npx tsx src/drones3d-picker-shot.ts [drone] [lang] [width] [height]
import { mkdirSync, rmdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { launchChrome } from './browser';

const DEV = (process.env.DEV ?? '').replace(/\/$/, '');
if (!DEV) throw new Error('DEV=http://localhost:<vite port> is needed');
const OUT = process.env.OUT ?? 'C:/dev/gsfpv-v09-d-shots';
mkdirSync(OUT, { recursive: true });
const [drone = 'taurusx8-komodo-6s', lang = 'en', w = '1280', h = '880'] = process.argv.slice(2);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const LOCK = 'C:/dev/.gpu-lock';
let waited = 0;
async function lock(): Promise<void> {
    for (;;) {
        try { mkdirSync(LOCK); return; } catch {
            try { if (Date.now() - statSync(LOCK).mtimeMs > 20 * 60 * 1000) { rmdirSync(LOCK); continue; } } catch { /* gone */ }
            if (!waited++ || waited % 600 === 0) console.log('waiting for the GPU lock');
            await sleep(100);
        }
    }
}
const unlock = (): void => { try { rmdirSync(LOCK); } catch { /* */ } };
process.on('SIGINT', () => { unlock(); process.exit(130); });

await lock();
try {
    const { browser } = await launchChrome({ headless: false, args: ['--window-position=40,40', `--window-size=${Number(w) + 20},${Number(h) + 120}`] });
    const ctx = await browser.newContext({ viewport: { width: Number(w), height: Number(h) }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const logs: string[] = [];
    page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`.slice(0, 300)));
    page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`.slice(0, 300)));
    await page.goto(`${DEV}/fly/?scene=39e63ce9&nowarn=1&input=touch&render=off&drone=${drone}&lang=${lang}`);
    await page.waitForFunction(() => (window as unknown as { __gsfpv?: { status: string } }).__gsfpv?.status === 'ready', undefined, { timeout: 120000 });
    // pause card
    await page.keyboard.press('KeyP');
    await page.waitForSelector('[data-testid="your-drone"] canvas', { timeout: 30000 });
    await page.waitForFunction(() => ((window as unknown as { __gsfpvDrones3d?: { infos(): { frames: number }[] } }).__gsfpvDrones3d?.infos()[0]?.frames ?? 0) > 20, undefined, { timeout: 30000 });
    await sleep(500);
    await page.screenshot({ path: join(OUT, `pause-${drone}-${lang}.png`) });
    await page.click('[data-action="pause.drone"]');
    await page.waitForSelector('[data-testid="drone-stage"] canvas', { timeout: 30000 });
    await page.waitForFunction(() => ((window as unknown as { __gsfpvDrones3d?: { infos(): { frames: number }[] } }).__gsfpvDrones3d?.infos()[0]?.frames ?? 0) > 20, undefined, { timeout: 30000 });
    await sleep(1500);
    await page.screenshot({ path: join(OUT, `picker-${drone}-${lang}.png`) });
    console.log('shots ok', logs.filter((l) => /error|warn/i.test(l)).slice(0, 8).join(' | '));
    await browser.close();
} finally {
    unlock();
}
