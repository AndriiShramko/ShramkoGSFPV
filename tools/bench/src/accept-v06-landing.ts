// v06 landing acceptance: the Places and Scene scale blocks, the three background loops and what
// the first load costs.
//   SITE=http://127.0.0.1:8138 npx tsx src/accept-v06-landing.ts      (a copy of apps/site/out)
// L1 bytes: every byte the browser receives (CDP encodedDataLength), at the top of /en/ until 3 s
//    after the load event, then after scrolling the whole page; the videos apart. The same
//    measurement on the live site (the landing before this change, with its hero.mp4) is the
//    reference. Desktop 1440x900 and phone 375x812.
// L2 lazy loops: no .mp4 before the load event; at the top only the hero's (the Places block
//    peeking in under the first screen does not count as in view); the scale block's loop arrives only once scrolled to
//    (control: the same counter sees it then).
// L3 "Fly a random location": the catalogue answer (the live proxy's, relayed) gives the scene the
//    click opens; control: a failing catalogue opens the simulator without a scene.
// L4 the new blocks exist in 4 languages with their CTAs and video credits.
import type { Page } from 'playwright';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { launchChrome } from './browser';
import { REPO, writeEvidence } from './evidence';

const SITE = process.env.SITE ?? 'http://127.0.0.1:8138';
const LIVE = 'https://gsfpv.flyreelstudio.eu';
const out: Record<string, unknown> = {};
let all = true;
const check = (id: string, pass: boolean, detail: Record<string, unknown>): void => {
    out[id] = { pass, ...detail };
    all &&= pass;
    console.log(`${id} ${pass ? 'PASS' : 'FAIL'}`, JSON.stringify(detail).slice(0, 600));
};

const { browser } = await launchChrome();

type Row = { url: string; bytes: number; at: number };
async function measure(base: string, viewport: { width: number; height: number }, mobile: boolean) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
    await ctx.addInitScript(() => { try { localStorage.setItem('gsfpv_consent', 'no'); } catch { /* */ } });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    const rows = new Map<string, Row>();
    cdp.on('Network.requestWillBeSent', (e: { requestId: string; request: { url: string } }) => { if (!rows.has(e.requestId)) rows.set(e.requestId, { url: e.request.url, bytes: 0, at: Date.now() }); });
    cdp.on('Network.dataReceived', (e: { requestId: string; encodedDataLength: number }) => { const r = rows.get(e.requestId); if (r) r.bytes += e.encodedDataLength; });
    cdp.on('Network.loadingFinished', (e: { requestId: string; encodedDataLength: number }) => { const r = rows.get(e.requestId); if (r) r.bytes = Math.max(r.bytes, e.encodedDataLength); });
    await page.goto(`${base}/en/`, { waitUntil: 'load' });
    const loadAt = Date.now();
    await page.waitForTimeout(3000);
    const kb = (f: (r: Row) => boolean) => Math.round([...rows.values()].filter(f).reduce((n, r) => n + r.bytes, 0) / 1024);
    const isVideo = (r: Row) => /\.(mp4|webm)(\?|$)/.test(r.url);
    const path = (r: Row) => new URL(r.url).pathname;
    const top = { totalKB: kb(() => true), videoKB: kb(isVideo), videos: [...rows.values()].filter(isVideo).map(path), videoBeforeLoad: [...rows.values()].filter((r) => isVideo(r) && r.at < loadAt).map(path) };
    const scaleBefore = [...rows.values()].some((r) => /\/media\/villa-/.test(r.url));
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < height; y += Math.round(viewport.height * 0.8)) {
        await page.evaluate((yy) => window.scrollTo(0, yy), y);
        await page.waitForTimeout(450);
    }
    await page.waitForTimeout(2500);
    const scrolled = { totalKB: kb(() => true), videoKB: kb(isVideo), videos: [...new Set([...rows.values()].filter(isVideo).map(path))] };
    const scaleAfter = [...rows.values()].some((r) => /\/media\/villa-/.test(r.url));
    await ctx.close();
    return { top, scrolled, scaleBefore, scaleAfter, pageHeight: height };
}

// L1 + L2
for (const [name, viewport, mobile] of [['desktop', { width: 1440, height: 900 }, false], ['phone', { width: 375, height: 812 }, true]] as const) {
    const now = await measure(SITE, viewport, mobile);
    let before: unknown = null;
    try { before = await measure(LIVE, viewport, mobile); } catch (e) { before = { error: String(e) }; }
    const t = now.top;
    const lazy = t.videoBeforeLoad.length === 0 && !now.scaleBefore && now.scaleAfter && t.videos.length === 1 && t.videos[0].startsWith('/media/tunis-');
    check(`L1-L2 ${name}`, lazy, { now, before });
}

// L3: the random location
{
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page: Page = await ctx.newPage();
    let served: string[] = [];
    await ctx.route('**/api/superspl/explore**', async (route) => {
        const u = new URL(route.request().url());
        const r = await fetch(`${LIVE}/api/superspl/explore${u.search}`);
        const j = (await r.json()) as { items?: { id: string }[]; total?: number };
        served = (j.items ?? []).map((i) => i.id);
        out.catalogueTotal = j.total;
        out.randomQuery = u.search;
        await route.fulfill({ status: r.status, contentType: 'application/json', body: JSON.stringify(j) });
    });
    await ctx.route('**/en/fly/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>fly</title>' }));
    await page.goto(`${SITE}/en/#locations`, { waitUntil: 'load' });
    await page.locator('#locations [data-random-scene]').click();
    await page.waitForURL(/\/en\/fly\//, { timeout: 15000 });
    const opened = new URL(page.url()).searchParams.get('scene');
    // control: the catalogue fails, the link opens the simulator as it is
    await ctx.unroute('**/api/superspl/explore**');
    await ctx.route('**/api/superspl/explore**', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"ok":false,"error":"busy"}' }));
    await page.goto(`${SITE}/en/#locations`, { waitUntil: 'load' });
    await page.locator('#locations [data-random-scene]').click();
    await page.waitForURL(/\/en\/fly\//, { timeout: 15000 });
    const fallback = new URL(page.url());
    check('L3 random location', !!opened && served.includes(opened) && served.length >= 20 && fallback.pathname === '/en/fly/' && !fallback.searchParams.has('scene'), { opened, pool: served.length, total: out.catalogueTotal, query: out.randomQuery, fallback: fallback.pathname + fallback.search });
    await ctx.close();
}

// L4: the blocks in every language
{
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const page = await ctx.newPage();
    const per: Record<string, unknown> = {};
    let ok = true;
    for (const l of ['en', 'es', 'pl', 'ru']) {
        await page.goto(`${SITE}/${l}/`, { waitUntil: 'load' });
        // a string, not a function: tsx would wrap inner functions in __name (see accept-v05-ux.ts)
        const r = (await page.evaluate(`(() => {
            const q = (s) => document.querySelector(s);
            return {
                order: [...document.querySelectorAll("main > section")].slice(0, 4).map((s) => s.id),
                locH2: q("#locations-title")?.textContent ?? "",
                scaleH2: q("#scale-title")?.textContent ?? "",
                random: q("#locations [data-random-scene]")?.textContent?.trim() ?? "",
                scaleCta: q("#scale a.btn-primary[href$=\\"?scene=39e63ce9\\"]")?.innerText.trim() ?? "",
                credits: [...document.querySelectorAll("#top p, #locations p, #scale p")].filter((p) => /CC BY 4\.0/.test(p.textContent ?? "")).length,
                faq: document.querySelectorAll("#faq details").length,
            };
        })()`)) as { order: string[]; locH2: string; scaleH2: string; random: string; scaleCta: string; credits: number; faq: number };
        const pass = r.order.join(',') === 'top,locations,scale,tour' && /1[\s,. ]?300/.test(r.locH2) && /100/.test(r.scaleH2 + (await page.locator('#scale').innerText())) && !!r.random && !!r.scaleCta && r.credits >= 3 && r.faq === 11;
        ok &&= pass;
        per[l] = { pass, ...r };
    }
    check('L4 blocks in 4 languages', ok, per);
    await ctx.close();
}

// the encodes as shipped (bytes from disk; cut and settings: apps/site/scripts/encode-videos.sh)
const media = JSON.parse(readFileSync(join(REPO, 'apps', 'site', 'src', 'generated', 'media.json'), 'utf8')) as { videos: Record<string, { bytes: Record<string, number> }> };
out.encodes = Object.fromEntries(Object.entries(media.videos).map(([clip, v]) => [clip, v.bytes]));
out.segments = { tunis: { scene: '887f27aa', block: 'hero', from: 12, to: 24.6 }, garden: { scene: '7a475d38', block: 'locations', from: 1, to: 13.6 }, villa: { scene: '39e63ce9', block: 'scale', from: 41.5, to: 54.1 }, loop: '12.0 s each: the last 0.6 s cross-faded into the first 0.6 s', note: 'source: the owner\'s simulator recordings of 2 October 2026, 2160x1080 60 fps; burned-in credit strip cropped (2000x1000 from x=80), 30 fps' };
const over = Object.entries(media.videos).flatMap(([, v]) => Object.entries(v.bytes).filter(([f, b]) => (f.includes('-1280') && b >= 2.5e6) || (f.includes('-1920') && b >= 5e6)).map(([f]) => f));
check('L5 encode sizes', over.length === 0, { over });

await browser.close();
const file = writeEvidence('v06-landing', { pass: all, site: SITE, reference: LIVE, ...out });
console.log(`v06-landing ${all ? 'PASS' : 'FAIL'} -> ${file}`);
process.exit(all ? 0 : 1);
