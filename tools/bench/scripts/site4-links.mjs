// Lane site4 acceptance: does every page's main button lead where the page promises?
//   node tools/bench/scripts/site4-links.mjs <base, no trailing slash> <out.json> [steps]
// Steps (all by default):
//   sound   the header's main button on /{en,pl}/sound/ clicked with the mouse at 1536x730 (device scale 1.25) and at
//           375x812 (touch) opens /{lang}/fly/ with sonic=start, the same address as the page's own start button
//   soundall  the same href (no click) on /es/ and /ru/sound/ at 1536x730
//   band    the home page's Fly by Sound band has a button to the sound start (clicked)
//   scene   /en/scenes/39e63ce9/ (needs the API: the live site or a local API): the header's button opens that scene
//   person  /en/supporters/kanal-fpv/ (a person with a scene): the header's button opens the person's scene
//   lang    /en/sound/#sound-keys, the header's "pl" clicked: /pl/sound/#sound-keys
//   banner  /es/sound/ at 320x568 and 320x640, cookie banner unanswered: the start button is not under the banner
// Read-only: nothing is saved or sent (the simulator's address is answered by a stub page, /api/** by 204).
// Prints one JSON verdict; exit 1 on a FAIL.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { pickBrowser } from '../src/chrome.mjs';

const BASE = process.argv[2];
const OUT = process.argv[3];
const WANT = (process.argv[4] ?? 'sound,soundall,band,scene,person,lang,banner').split(',');
if (!BASE || !OUT) {
    console.error('usage: site4-links.mjs <base> <out.json> [steps]');
    process.exit(2);
}
const DESK = { viewport: { width: 1536, height: 730 }, deviceScaleFactor: 1.25 };
const PHONE = { viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

const pick = pickBrowser({ expected: chromium.executablePath() });
const browser = await chromium.launch({ ...pick.launch });
const steps = [];
const step = (name, pass, detail) => {
    steps.push({ name, pass, detail });
    console.error(`${pass ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(detail)}`);
};

async function ctxFor(opts, consent = 'no') {
    const ctx = await browser.newContext(opts);
    if (consent === 'no') await ctx.addInitScript(() => {
        try {
            localStorage.setItem('gsfpv_consent', 'no');
        } catch {
            /* storage blocked */
        }
    });
    // the simulator is not loaded: its address is the answer
    await ctx.route(/\/[a-z]{2}\/fly\//, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>stub</title>' }));
    await ctx.route(/\/api\/(?!catalog|roadmap)/, (r) => r.fulfill({ status: 204 }));
    await ctx.route(/google-analytics|googletagmanager|doubleclick/, (r) => r.abort());
    return ctx;
}

/** The menu's main button: the header's primary link where it shows, else the bottom bar's (the phone's menu button). */
const MAIN = 'header a.btn-primary, .sticky-cta a.btn-primary';

async function clickMain(page) {
    const all = page.locator(MAIN);
    const n = await all.count();
    for (let i = 0; i < n; i++) {
        const el = all.nth(i);
        if (!(await el.isVisible())) continue;
        const href = await el.getAttribute('href');
        const box = await el.boundingBox();
        const nav = page.waitForURL(/\/fly\//, { timeout: 8000 }).then(() => true, () => false);
        if (box) {
            const isTouch = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
            if (isTouch) await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
            else await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        }
        await nav;
        return { href, url: page.url(), text: (await page.title()) === 'stub' ? 'stub' : '' };
    }
    return { href: null, url: page.url(), none: `no visible ${MAIN}` };
}

const query = (u) => {
    try {
        return new URL(u);
    } catch {
        return null;
    }
};

if (WANT.includes('sound')) {
    for (const lang of ['en', 'pl']) {
        for (const [size, opts] of [['1536x730', DESK], ['375x812', PHONE]]) {
            const ctx = await ctxFor(opts);
            const page = await ctx.newPage();
            await page.goto(`${BASE}/${lang}/sound/`, { waitUntil: 'networkidle' });
            const own = await page.locator('main a.btn-primary').first().getAttribute('href');
            const r = await clickMain(page);
            const u = query(r.url);
            const pass = !!u && u.pathname === `/${lang}/fly/` && u.searchParams.get('sonic') === 'start' && r.href === own;
            step(`sound ${lang} ${size}: the menu's main button opens the sound start`, pass, { ...r, own });
            await ctx.close();
        }
    }
}

if (WANT.includes('soundall')) {
    const ctx = await ctxFor(DESK);
    const page = await ctx.newPage();
    for (const lang of ['es', 'ru']) {
        await page.goto(`${BASE}/${lang}/sound/`, { waitUntil: 'domcontentloaded' });
        const href = await page.locator('header a.btn-primary').first().getAttribute('href');
        const own = await page.locator('main a.btn-primary').first().getAttribute('href');
        step(`sound ${lang} 1536x730: the header's button has the start button's address`, !!href && href === own && href.includes('sonic=start'), { href, own });
    }
    await ctx.close();
}

if (WANT.includes('band')) {
    const ctx = await ctxFor(DESK);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/en/`, { waitUntil: 'networkidle' });
    const btn = page.locator('#fly-by-sound a[href*="sonic=start"]').first();
    let r = { href: null, url: null };
    if (await btn.count()) {
        await btn.scrollIntoViewIfNeeded();
        const box = await btn.boundingBox();
        const nav = page.waitForURL(/\/fly\//, { timeout: 8000 }).then(() => true, () => false);
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await nav;
        r = { href: await Promise.resolve(null), url: page.url() };
    }
    const u = query(r.url ?? '');
    step('band en 1536x730: the Fly by Sound band starts the sound mode', !!u && u.pathname === '/en/fly/' && u.searchParams.get('sonic') === 'start', r);
    await ctx.close();
}

for (const [key, path, scene] of [['scene', '/en/scenes/39e63ce9/', '39e63ce9'], ['person', '/en/supporters/kanal-fpv/', '39e63ce9']]) {
    if (!WANT.includes(key)) continue;
    const ctx = await ctxFor(DESK);
    const page = await ctx.newPage();
    const res = await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
    if (!res || res.status() !== 200) {
        step(`${key}: ${path} is there`, false, { status: res?.status() });
        await ctx.close();
        continue;
    }
    const r = await clickMain(page);
    const u = query(r.url);
    step(`${key} en 1536x730: the header's button opens scene ${scene}`, !!u && u.pathname === '/en/fly/' && u.searchParams.get('scene') === scene, r);
    await ctx.close();
}

if (WANT.includes('lang')) {
    const ctx = await ctxFor(DESK);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/en/sound/#sound-keys`, { waitUntil: 'networkidle' });
    const a = page.locator('[data-testid="lang-nav"] a[data-lang="pl"]');
    const box = await a.boundingBox();
    const nav = page.waitForURL(/\/pl\/sound\//, { timeout: 8000 }).then(() => true, () => false);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await nav;
    step('lang en->pl on /en/sound/#sound-keys keeps the page and its anchor', page.url().endsWith('/pl/sound/#sound-keys'), { url: page.url() });
    await ctx.close();
}

if (WANT.includes('banner')) {
    for (const h of [568, 640]) {
        const ctx = await ctxFor({ viewport: { width: 320, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, 'ask');
        const page = await ctx.newPage();
        await page.goto(`${BASE}/es/sound/`, { waitUntil: 'networkidle' });
        const banner = page.locator('[role="region"][aria-label]').filter({ has: page.locator('button') }).last();
        const shown = await banner.isVisible().catch(() => false);
        const bb = shown ? await banner.boundingBox() : null;
        const start = page.locator('main a.btn-primary').first();
        const sb = await start.boundingBox();
        const hit = await page.evaluate(() => {
            const s = document.querySelector('main a.btn-primary');
            const r = s.getBoundingClientRect();
            const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
            return !!top && s.contains(top);
        });
        const overlap = !!bb && !!sb && bb.y < sb.y + sb.height && sb.y < bb.y + bb.height;
        // a banner that is not shown proves nothing: the step needs the banner up (the build with a GA id)
        step(`banner es 320x${h}: the start button is on screen and not under the cookie banner`, shown && !overlap && hit && sb.y + sb.height <= h, { shown, banner: bb, start: sb, hit });
        await ctx.close();
    }
}

await browser.close();
const verdict = { base: BASE, pass: steps.every((s) => s.pass), failed: steps.filter((s) => !s.pass).map((s) => s.name), steps };
writeFileSync(OUT, JSON.stringify(verdict, null, 1));
console.log(JSON.stringify({ base: BASE, pass: verdict.pass, failed: verdict.failed }));
process.exit(verdict.pass ? 0 : 1);
