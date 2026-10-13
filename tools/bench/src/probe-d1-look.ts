// A look at the v0.7 lane D1 UI (docs/wip/v07-d1.md), for a person or an agent to read the pictures:
// the top bar with Share and the crosshair (desktop 1280 px and phone 390 px), the share panel on
// both, the author notice while recording a pasted scan, "Share your flight" after it, the pause
// menu, the picker's share buttons, and the walls box under a crowded top row (1024 px; phone).
// Logic-only page (?render=off: the scan is not drawn), so this checks layout and words, not the
// picture. No pass/fail: tools/bench/test/flight-ux.test.ts and accept-v07-d1.ts hold the checks;
// this caught the dark "Share your flight" button and the top row printing over the walls box.
// Run (one port per agent; hold the GPU lock as tools/bench/README.md says):
//   cd apps/fly && npx vite --port 5341 --strictPort --host 127.0.0.1
//   cd tools/bench && SITE=http://127.0.0.1:5341 npx tsx src/probe-d1-look.ts [out dir]
// Output: JPEGs in the out dir (default evidence/<date>/d1-ui).
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Browser, Page } from 'playwright';
import { launchChrome, waitReady } from './browser';
import { REPO, today } from './evidence';

const SITE = (process.env.SITE ?? 'http://127.0.0.1:5341').replace(/\/$/, '');
const OUT = process.argv[2] ?? join(REPO, 'evidence', today(), 'd1-ui');
const SHOWCASE = '39e63ce9'; // in apps/fly/public/showcase.json: walls shipped
const PASTED = '723068d7'; // not in it: no walls, the author notice

async function open(browser: Browser, w: number, hgt: number, qs: string, ms = 240000): Promise<{ p: Page; close: () => Promise<void> }> {
    const ctx = await browser.newContext({ viewport: { width: w, height: hgt }, deviceScaleFactor: 1 });
    const p = await ctx.newPage();
    await p.goto(`${SITE}/fly/?nowarn=1&render=off${qs ? `&${qs}` : ''}`);
    await waitReady(p, ms);
    return { p, close: () => ctx.close() };
}

mkdirSync(OUT, { recursive: true });
const shot = (p: Page, name: string) => p.screenshot({ path: join(OUT, `d1-${name}.jpg`) });
const { browser } = await launchChrome({ headless: false, args: ['--window-position=40,40', '--window-size=1296,920'] });
try {
    // the top bar and the share panel, with the crosshair on (ring with a dot)
    for (const [w, hgt, name, qs] of [[1280, 800, 'desk', 'lat=1'], [390, 780, 'phone', 'input=touch']] as const) {
        const { p, close } = await open(browser, w, hgt, `scene=${SHOWCASE}&${qs}`);
        await p.evaluate('window.__gsfpv.prefs.set("crosshair.shape", "ringDot")');
        await p.waitForTimeout(1200);
        await shot(p, `${name}-top`);
        await p.click('[data-action=share-top]');
        await p.waitForTimeout(2500);
        await shot(p, `${name}-share`);
        await close();
    }
    // a pasted scan: recording (the notice under the walls box), after it, the pause menu
    {
        const { p, close } = await open(browser, 1280, 800, `scene=${PASTED}&lat=1`);
        await p.waitForTimeout(800);
        await p.keyboard.press('F9');
        await p.waitForTimeout(1500);
        await shot(p, 'notice');
        await p.keyboard.press('F9');
        await p.waitForTimeout(2500);
        await shot(p, 'after-rec');
        await p.keyboard.press('KeyP');
        await p.waitForTimeout(600);
        await shot(p, 'pause');
        await close();
    }
    // the walls box when the top row reaches it: a narrower window, a phone
    for (const [w, hgt, name, qs] of [[1024, 700, 'mid-pasted', 'lat=1'], [390, 780, 'phone-pasted', 'input=touch']] as const) {
        const { p, close } = await open(browser, w, hgt, `scene=${PASTED}&${qs}`);
        await p.waitForTimeout(1200);
        await shot(p, name);
        await close();
    }
    // the picker: a share button on every card
    {
        const { p, close } = await open(browser, 1280, 800, '', 120000);
        await p.waitForTimeout(1500);
        await shot(p, 'picker');
        await close();
    }
} finally {
    await browser.close();
}
console.log(`pictures in ${OUT}`);
