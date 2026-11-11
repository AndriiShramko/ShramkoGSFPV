// The Fly by Sound page and the home band, seen at a phone's width and on a desktop (lane site-sound, 2026-11-11).
// Headless (chrome.mjs). Usage: SITE=http://localhost:<port> OUT=<folder> node tools/bench/scripts/sound-page-shots.mjs
// Without SITE it refuses (no silent default to the live site); SITE=https://gsfpv.flyreelstudio.eu is the live check.
// Per page and width: the full-page screenshot, scrollWidth <= innerWidth (no horizontal scroll), the main column's side gap
// at 375 px (16 px). Scale 1: Chrome repeats tiles in full-page shots taller than 16384 device px, elements wider than the viewport, the h1 count, the h2 order, the home band before #locations.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pickBrowser, describeBrowser } from '../src/chrome.mjs';

const SITE = process.env.SITE;
if (!SITE) {
    console.error('SITE is required (e.g. http://localhost:4321); refusing to default to the live site');
    process.exit(2);
}
const OUT = process.env.OUT ?? 'sound-shots';
const LANGS = (process.env.LANGS ?? 'ru,en,pl,es').split(',');
const SHOT_LANGS = (process.env.SHOT_LANGS ?? 'ru,en').split(',');
const WIDTHS = [
    { name: 'phone', width: 375, height: 812, mobile: true },
    { name: 'desktop', width: 1440, height: 900, mobile: false }
];
mkdirSync(OUT, { recursive: true });
console.log(`sound-page-shots target: ${SITE}`);
const pick = pickBrowser();
const browser = await chromium.launch({ ...pick.launch });
console.log(describeBrowser(pick, browser.version()));
const results = [];
let fails = 0;
for (const w of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width: w.width, height: w.height }, isMobile: w.mobile, hasTouch: w.mobile, deviceScaleFactor: 1, colorScheme: 'dark' });
    for (const l of LANGS) {
        for (const page of [`/${l}/sound/`, `/${l}/`]) {
            const p = await ctx.newPage();
            const res = await p.goto(`${SITE}${page}`, { waitUntil: 'load', timeout: 60000 });
            await p.waitForTimeout(800);
            const seen = await p.evaluate(() => {
                const de = document.documentElement;
                const vw = window.innerWidth;
                const wide = [...document.querySelectorAll('main *')]
                    .filter((e) => {
                        const r = e.getBoundingClientRect();
                        const cs = getComputedStyle(e);
                        return r.width > 0 && (r.right > vw + 1 || r.left < -1) && cs.position !== 'fixed' && !e.closest('[aria-hidden="true"]') && !e.closest('.overflow-hidden, .overflow-x-auto');
                    })
                    .slice(0, 5)
                    .map((e) => `${e.tagName.toLowerCase()}.${String(e.className).slice(0, 40)}`);
                const sec = document.querySelector('#sound-how, #fly-by-sound-title');
                const r = sec ? sec.getBoundingClientRect() : null;
                return {
                    scrollWidth: de.scrollWidth,
                    innerWidth: vw,
                    h1: document.querySelectorAll('h1').length,
                    h2: [...document.querySelectorAll('main h2')].map((h) => h.id).filter(Boolean),
                    gapLeft: r ? Math.round(r.left) : null,
                    gapRight: r ? Math.round(vw - r.right) : null,
                    band: (() => {
                        const b = document.getElementById('fly-by-sound');
                        const loc = document.getElementById('locations');
                        return b && loc ? !!(b.compareDocumentPosition(loc) & Node.DOCUMENT_POSITION_FOLLOWING) : null;
                    })(),
                    startButton: [...document.querySelectorAll('a')].some((a) => (a.getAttribute('href') ?? '').includes('sonic=start')),
                    wide
                };
            });
            const isSound = page.endsWith('/sound/');
            const checks = {
                status200: res?.status() === 200,
                noHorizontalScroll: seen.scrollWidth <= seen.innerWidth,
                oneH1: seen.h1 === 1,
                gap16: w.mobile ? seen.gapLeft === 16 : true,
                bandOrStart: isSound ? seen.startButton : seen.band === true
            };
            const pass = Object.values(checks).every(Boolean);
            if (!pass) fails++;
            let shot = null;
            if (SHOT_LANGS.includes(l)) {
                shot = join(OUT, `${w.name}-${l}-${isSound ? 'sound' : 'home'}.png`);
                if (isSound) await p.screenshot({ path: shot, fullPage: true });
                else {
                    // the home page is long: the first screen plus the band
                    await p.evaluate(() => document.getElementById('fly-by-sound')?.scrollIntoView({ block: 'center' }));
                    await p.waitForTimeout(400);
                    await p.screenshot({ path: shot });
                }
            }
            results.push({ width: w.name, page, pass, checks, seen, shot });
            console.log(`${pass ? 'PASS' : 'FAIL'} ${w.name} ${page} scroll ${seen.scrollWidth}/${seen.innerWidth} h1 ${seen.h1} gap ${seen.gapLeft}/${seen.gapRight} ${isSound ? 'start ' + seen.startButton + ' h2 ' + seen.h2.join(',') : 'band ' + seen.band}${seen.wide.length ? ' wide: ' + seen.wide.join(' ') : ''}`);
            await p.close();
        }
    }
    await ctx.close();
}
await browser.close();
writeFileSync(join(OUT, 'sound-page-shots.json'), JSON.stringify({ site: SITE, at: new Date().toISOString(), results }, null, 1));
console.log(fails ? `FAIL ${fails}` : `PASS ${results.length}/${results.length}`);
process.exit(fails ? 1 : 0);
