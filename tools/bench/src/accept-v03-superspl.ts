// W3-2 acceptance in the real page: the SuperSplat tab of the scene picker (docs/architecture-v03.md
// E.6, E.8, E.10; decision D35; owner's items 9, 10). The dev server has no /api, so the context routes
// /api/superspl/** to the LIVE proxy (real data; the browser itself never asks PlayCanvas), and some
// checks to a mocked answer. Every check has a negative control that must fire.
//   S1 the tab lists real scenes with thumbnails (the same ids the live proxy gives Node). Control: a
//      planted card with a missing thumbnail is reported as not loaded.
//   S2 a filter change (sort newest + downloadable) changes the request, the list and the SuperSplat link.
//      Control: with no change, the change detector reports no new request and the same list.
//   S3 search sends search=<text> and shows the proxy's list for it. Control: the list without the
//      search differs from the shown one.
//   S4 Random top-rated opens a scene among the top-liked walkable ones (tier 0 of the best-liked page),
//      beacon source 'random'. Control: when the scene in the address (failed, on screen) is the only
//      candidate, nothing is picked and the tab says so; the same mock with another scene does pick it.
//   S5 a click on a card opens that scene (status ready, beacon source 'superspl'). Control: a card of a
//      scene that does not exist comes back to the picker with an error, so "ready" is not claimed.
//   S6 the favourites star survives a reload and the picker's Favourites tab lists the scene. Control: an
//      unstarred card stays off after the reload, and unstarring is remembered too.
//   S7 a 503 from the proxy shows the busy message with the wait and a Retry; Retry recovers. Control:
//      without the click the tab stays on the message. Offline shows the offline message.
//   S8 phone 375x812: no horizontal overflow, no overlapping controls, every field labelled, keyboard
//      order. Control: a planted 600 px element and a planted overlap are caught; an unlabelled field is caught.
//   S9 ru and pl show the dictionary's texts, never a raw key. Control: the en text differs.
// Logic-only mode (?render=off): no scan is drawn, so no GPU lock is needed; thumbnails are plain images.
//   LOCAL_FLY=1 SITE=http://127.0.0.1:5332 npx tsx src/accept-v03-superspl.ts [S1 S2 ...]
// Evidence: evidence/<date>/v03-superspl.json (+ v03-superspl/*.png).
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Browser, BrowserContext, Page } from 'playwright';
import { launchChrome } from './browser';
import { REPO, today, writeEvidence } from './evidence';

const SITE = (process.env.SITE ?? 'http://127.0.0.1:5332').replace(/\/$/, '');
const PROXY = (process.env.PROXY ?? 'https://gsfpv.flyreelstudio.eu').replace(/\/$/, '');
const fly = (qs: string, lang = 'en') => (process.env.LOCAL_FLY ? `${SITE}/fly/?${qs}` : `${SITE}/${lang}/fly/?${qs}`);
const PICKER = 'nowarn=1&render=off&input=touch';
const SHOTS = join(REPO, 'evidence', today(), 'v03-superspl');
const args = process.argv.slice(2);
const want = (k: string) => !args.some((a) => /^S\d+$/.test(a)) || args.includes(k);
mkdirSync(SHOTS, { recursive: true });
const dict = (l: string): Record<string, string> => JSON.parse(readFileSync(join(REPO, 'packages', 'i18n', 'locales', 'fly', 'superspl', `${l}.json`), 'utf8'));
const EN = dict('en');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const ev = <T = Any>(p: Page, js: string): Promise<T> => p.evaluate(js) as Promise<T>;

interface Wire { mode: 'live' | '503' | 'mock'; items: Any[]; requests: string[]; offline: boolean }

/** A context whose /api/superspl/** goes to the live proxy (or a mock); beacons are recorded in the page. */
async function context(b: Browser, o: { w?: number; h?: number; mobile?: boolean; lang?: string } = {}): Promise<{ ctx: BrowserContext; wire: Wire }> {
    const ctx = await b.newContext({ viewport: { width: o.w ?? 1280, height: o.h ?? 800 }, deviceScaleFactor: 1, isMobile: !!o.mobile, hasTouch: !!o.mobile, locale: 'en-US' });
    if (o.lang) await ctx.addCookies([{ name: 'NEXT_LOCALE', value: o.lang, url: SITE }]);
    await ctx.addInitScript(`(() => { window.__beacons = []; const sb = navigator.sendBeacon ? navigator.sendBeacon.bind(navigator) : null; navigator.sendBeacon = (u, d) => { try { window.__beacons.push(JSON.parse(String(d))); } catch {} return true; }; })()`);
    const wire: Wire = { mode: 'live', items: [], requests: [], offline: false };
    await ctx.route('**/api/**', async (route) => {
        const u = new URL(route.request().url());
        if (!u.pathname.startsWith('/api/superspl/')) return route.fulfill({ status: 404, body: '' });
        wire.requests.push(u.search);
        if (wire.offline) return route.abort('internetdisconnected'); // a routed request would reach the proxy from Node
        if (wire.mode === '503') return route.fulfill({ status: 503, contentType: 'application/json', headers: { 'retry-after': '5' }, body: '{"error":"busy","retryAfter":5}' });
        if (wire.mode === 'mock') return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'cache-control': 'no-store', 'x-cache': 'miss' }, body: JSON.stringify({ ok: true, query: {}, total: wire.items.length, fetchedAt: Date.now() / 1000, items: wire.items }) });
        try {
            const r = await fetch(`${PROXY}${u.pathname}${u.search}`, { headers: { accept: 'application/json' } });
            const headers: Record<string, string> = {};
            for (const k of ['cache-control', 'x-cache', 'retry-after', 'content-type']) { const v = r.headers.get(k); if (v) headers[k] = v; }
            return route.fulfill({ status: r.status, headers, body: Buffer.from(await r.arrayBuffer()) });
        } catch {
            return route.abort('failed');
        }
    });
    return { ctx, wire };
}

/** The live proxy's answer to a query, read by Node (what the tab must show). */
async function live(qs: string): Promise<Any> {
    const r = await fetch(`${PROXY}/api/superspl/explore?${qs}`, { headers: { accept: 'application/json' } });
    if (!r.ok) throw new Error(`proxy ${r.status} for ${qs}`);
    return r.json();
}

const mockItem = (id: string, likes = 100) => ({ id, version: 1, title: `Mock ${id}`, author: 'bench', likes, views: 1, sizeBytes: 1e6, thumbs: {}, createdAt: null, license: null, downloadable: false, description: '', format: 'sog' });

async function picker(p: Page, qs = PICKER, lang = 'en'): Promise<void> {
    await p.goto(fly(qs, lang));
    // a scene from the address that fails comes back to the picker with status 'error' (app/flight.ts)
    await p.waitForFunction('!!(window.__gsfpv && window.__gsfpv.status !== "loading" && document.querySelector(".screen.scenes"))', null, { timeout: 120000 });
}

/** Opens the tab and waits for cards or the error line. */
async function openTab(p: Page): Promise<void> {
    await p.click('button[data-tab="superspl"]');
    await settle(p);
}

async function settle(p: Page): Promise<void> {
    await p.waitForFunction('(() => { const g = document.querySelector(".ss-grid"); const e = document.querySelector(".ss-error"); return g && !g.hasAttribute("aria-busy") && (g.children.length > 0 || (e && !e.hidden) || document.querySelector(".ss-status").textContent.length > 0); })()', null, { timeout: 30000 });
}

const ids = (p: Page) => ev<string[]>(p, '[...document.querySelectorAll(".ss-grid .ss-card")].map((b) => b.dataset.scene)');
const status = (p: Page) => ev<string>(p, 'document.querySelector(".ss-status")?.textContent ?? ""');
const errorLine = (p: Page) => ev<string | null>(p, '(() => { const e = document.querySelector(".ss-error"); return e && !e.hidden ? e.textContent : null; })()');
const beacons = (p: Page) => ev<Any[]>(p, 'window.__beacons ?? []');
const sceneInUrl = (p: Page) => new URL(p.url()).searchParams.get('scene');
/** thumbnails of the first n cards: loaded = a decoded picture with a width */
const thumbs = (p: Page, n: number) => ev<{ src: string; loaded: boolean }[]>(p, `Promise.all([...document.querySelectorAll(".ss-grid .ss-card img")].slice(0, ${n}).map(async (i) => { i.loading = "eager"; try { await i.decode(); } catch {} return { src: i.src, loaded: i.complete && i.naturalWidth > 0 }; }))`);
async function waitRequest(w: Wire, from: number, test: (s: string) => boolean, ms = 15000): Promise<string | null> {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
        const hit = w.requests.slice(from).find(test);
        if (hit) return hit;
        await new Promise((r) => setTimeout(r, 100));
    }
    return null;
}
const q = (s: string) => new URLSearchParams(s);
/** after a pick: the flight is up ('ready'), or it failed (back at the picker with an error, or 'error') */
async function waitFlight(p: Page, ms = 180000): Promise<Record<string, unknown>> {
    await p.waitForFunction('(() => { const h = window.__gsfpv; return h && (h.status === "ready" || h.status === "error" || (h.status === "picker" && !!h.errorCode)); })()', null, { timeout: ms, polling: 250 });
    return ev(p, '({ status: window.__gsfpv.status, errorCode: window.__gsfpv.errorCode ?? null, error: window.__gsfpv.error ?? null })');
}

const { browser, which } = await launchChrome({ headless: false, args: ['--window-position=40,40', '--window-size=1296,920'] });
const out: Record<string, unknown> = { site: SITE, proxy: PROXY, browser: which, mode: 'render=off (logic only): no scan is drawn; the list is the live proxy unless a check says mocked' };
const results: Record<string, { pass: boolean; control: boolean; [k: string]: unknown }> = {};
const errors: string[] = [];

async function check(name: string, f: () => Promise<{ pass: boolean; control: boolean; [k: string]: unknown }>): Promise<void> {
    if (!want(name)) return;
    try {
        results[name] = await f();
    } catch (e) {
        results[name] = { pass: false, control: false, error: String((e as Error)?.stack ?? e).slice(0, 600) };
    }
    console.log(name, JSON.stringify(results[name]).slice(0, 400));
}

const DEFAULT_QS = 'sort=trending&order=-1&time=all&features=walkable&skip=0&limit=24';

// ---- S1..S3 and S6 on one live context ----
const main = await context(browser);
const page = await main.ctx.newPage();
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`.slice(0, 300)));
await picker(page);
await openTab(page);

await check('S1', async () => {
    const shown = await ids(page);
    const want1 = (await live(DEFAULT_QS)).items.map((x: Any) => x.id);
    const th = await thumbs(page, 6);
    const titles = await ev<string[]>(page, '[...document.querySelectorAll(".ss-grid .ss-card .scene-title")].map((e) => e.textContent)');
    const req = main.wire.requests[0] ?? '';
    await page.screenshot({ path: join(SHOTS, 'desktop.png') });
    // control: a planted card whose thumbnail does not exist must be reported as not loaded
    await ev(page, `(() => { const b = document.createElement("button"); b.className = "scene-card ss-card"; b.dataset.scene = "00000000"; const i = document.createElement("img"); i.src = "https://s3-eu-west-1.amazonaws.com/images.playcanvas.com/splat/00000000/v1/m.webp"; b.append(i); document.querySelector(".ss-grid").prepend(b); })()`);
    const planted = (await thumbs(page, 1))[0];
    await ev(page, 'document.querySelector(".ss-grid .ss-card[data-scene=\\"00000000\\"]").remove()');
    const pass = shown.length >= 12 && JSON.stringify(shown) === JSON.stringify(want1) && th.length === 6 && th.every((x) => x.loaded && x.src.startsWith('https://s3-eu-west-1.amazonaws.com/images.playcanvas.com/splat/')) && titles.every((s) => s && s.trim().length > 0) && q(req).get('sort') === 'trending' && q(req).get('features') === 'walkable';
    return { pass, control: planted?.loaded === false, cards: shown.length, sameIdsAsProxy: JSON.stringify(shown) === JSON.stringify(want1), thumbsLoaded: th.filter((x) => x.loaded).length, firstRequest: req, status: await status(page), plantedThumb: planted };
});

await check('S2', async () => {
    const before = await ids(page);
    const n0 = main.wire.requests.length;
    const timeWasDisabled = await ev<boolean>(page, 'document.querySelector(".ss-time").disabled');
    await page.selectOption('.ss-sort', 'newest');
    await page.check('.ss-dl');
    const req = await waitRequest(main.wire, n0, (s) => q(s).get('sort') === 'createdAt' && q(s).get('features') === 'walkable,downloadable');
    await settle(page);
    await page.waitForTimeout(300);
    await settle(page);
    const after = await ids(page);
    const expect2 = (await live('sort=createdAt&order=-1&time=all&features=walkable,downloadable&skip=0&limit=24')).items.map((x: Any) => x.id);
    const badges = await ev<boolean[]>(page, '[...document.querySelectorAll(".ss-grid .ss-card")].map((b) => !!b.querySelector(".ss-badge.dl") && !!b.querySelector(".ss-badge.walk"))');
    const href = await ev<string>(page, 'document.querySelector(".ss-open").href');
    const timeNowEnabled = !(await ev<boolean>(page, 'document.querySelector(".ss-time").disabled'));
    // control: no change -> the same detector sees no new request and the same list
    const n1 = main.wire.requests.length;
    await page.selectOption('.ss-sort', 'newest');
    await page.waitForTimeout(1500);
    const same = await ids(page);
    const controlFired = main.wire.requests.length === n1 && JSON.stringify(same) === JSON.stringify(after);
    const pass = !!req && JSON.stringify(after) !== JSON.stringify(before) && JSON.stringify(after) === JSON.stringify(expect2) && badges.length > 0 && badges.every(Boolean) && href.includes('sort=newest') && href.includes('features=walkable,downloadable') && timeWasDisabled && timeNowEnabled;
    return { pass, control: controlFired, request: req, before: before.slice(0, 4), after: after.slice(0, 4), sameIdsAsProxy: JSON.stringify(after) === JSON.stringify(expect2), cardsWithBothBadges: `${badges.filter(Boolean).length}/${badges.length}`, href, timeWasDisabled, timeNowEnabled };
});

await check('S3', async () => {
    await page.selectOption('.ss-sort', 'likes');
    await page.uncheck('.ss-dl');
    await settle(page);
    await page.waitForTimeout(300);
    const n0 = main.wire.requests.length;
    await page.fill('.ss-search', 'church');
    await page.press('.ss-search', 'Enter');
    const req = await waitRequest(main.wire, n0, (s) => q(s).get('search') === 'church');
    await page.waitForTimeout(300);
    await settle(page);
    const shown = await ids(page);
    const withSearch = await live('sort=starred&order=-1&time=all&features=walkable&search=church&skip=0&limit=24');
    const without = await live('sort=starred&order=-1&time=all&features=walkable&skip=0&limit=24');
    const st = await status(page);
    const pass = !!req && shown.length > 0 && JSON.stringify(shown) === JSON.stringify(withSearch.items.map((x: Any) => x.id)) && withSearch.total < without.total;
    const control = JSON.stringify(shown) !== JSON.stringify(without.items.map((x: Any) => x.id));
    await page.fill('.ss-search', '');
    await page.press('.ss-search', 'Enter');
    await settle(page);
    return { pass, control, request: req, shown: shown.length, totalWithSearch: withSearch.total, totalWithout: without.total, status: st };
});

await check('S6', async () => {
    const list = await ids(page);
    const [a, b] = [list[1], list[2]];
    await page.click(`.ss-grid button.star[data-fav="${a}"]`);
    const pressed = await ev<string>(page, `document.querySelector('.ss-grid button.star[data-fav="${a}"]').getAttribute('aria-pressed')`);
    // since W3-1 the favourites live in the prefs store (collection sceneLibrary), not in v0.2's gsfpv.favourites.v1
    const stored = await ev<string[]>(page, 'window.__gsfpv.prefs.collection("sceneLibrary").favourites');
    await page.reload();
    await page.waitForFunction('window.__gsfpv && window.__gsfpv.status === "picker"');
    await openTab(page);
    const starA = await ev<string | null>(page, `document.querySelector('.ss-grid button.star[data-fav="${a}"]')?.getAttribute('aria-pressed') ?? null`);
    const starB = await ev<string | null>(page, `document.querySelector('.ss-grid button.star[data-fav="${b}"]')?.getAttribute('aria-pressed') ?? null`);
    await page.click('button[data-tab="favourites"]');
    const inFavTab = await ev<boolean>(page, `!!document.querySelector('.scene-card[data-scene="${a}"]')`);
    // control: unstar, reload: it is off (the star follows the click, it is not always on)
    await openTab(page);
    await page.click(`.ss-grid button.star[data-fav="${a}"]`);
    await page.reload();
    await page.waitForFunction('window.__gsfpv && window.__gsfpv.status === "picker"');
    await openTab(page);
    const starAAfterUnstar = await ev<string | null>(page, `document.querySelector('.ss-grid button.star[data-fav="${a}"]')?.getAttribute('aria-pressed') ?? null`);
    // W3-1 keeps the title and walls with a favourite: the Favourites tab shows it under the default walls-only filter
    const pass = pressed === 'true' && stored.includes(a) && starA === 'true' && inFavTab;
    return { pass, control: starB === 'false' && starAAfterUnstar === 'false', starred: a, unstarred: b, storedFavourites: stored, afterReload: { a: starA, b: starB }, afterUnstarAndReload: starAAfterUnstar, observation: { inFavouritesTabWithWallsOnly: inFavTab, why: 'ui/scenes.ts (W3-1) lists a favourite with no history entry as a scene without walls, so the default walls-only filter hides it; favourites carry no title or walls flag' } };
});

// ---- S4 random (live), then its control on a mocked pool ----
await check('S4', async () => {
    const top = (await live('sort=starred&order=-1&time=all&features=walkable&skip=0&limit=40')).items as Any[];
    const ranked = top.slice().sort((x, y) => y.likes - x.likes || y.views - x.views || (x.id < y.id ? -1 : 1));
    const tier0 = ranked.slice(0, 20).filter((x) => ['sog', 'ssog', 'sogs'].includes(x.format)).map((x) => x.id);
    const { ctx, wire } = await context(browser);
    const p = await ctx.newPage();
    await picker(p);
    await openTab(p);
    await p.click('.ss-random');
    const ready = await waitFlight(p);
    const picked = sceneInUrl(p);
    const bc = (await beacons(p)).filter((x) => x.e === 'scene_open');
    const starredReq = wire.requests.find((s) => q(s).get('sort') === 'starred') ?? null;
    await ctx.close();
    // control: the only candidate is the scene in the address (it failed to load): nothing is picked
    const c = await context(browser);
    const cp = await c.ctx.newPage();
    await picker(cp, `scene=deadbeef&${PICKER}`);
    const pickerError = await ev<string>(cp, 'document.querySelector(".scene-error")?.textContent ?? ""');
    c.wire.mode = 'mock';
    c.wire.items = [mockItem('deadbeef', 999)];
    await openTab(cp);
    const statusBefore = await ev<string>(cp, 'window.__gsfpv.status');
    await cp.click('.ss-random');
    await cp.waitForTimeout(1500);
    const noneText = await status(cp);
    const stillPicker = (await ev<string>(cp, 'window.__gsfpv.status')) === statusBefore && (await ev<boolean>(cp, '!!document.querySelector(".ss-tab")'));
    const randomBeacons = (await beacons(cp)).filter((x) => x.e === 'scene_open' && x.p?.source === 'random').length;
    const controlNothing = noneText === EN['superspl.random.none'] && stillPicker && sceneInUrl(cp) === 'deadbeef' && randomBeacons === 0;
    // the same mock with another scene: it is picked (so "nothing" above is the skip, not a broken mock)
    c.wire.items = [mockItem('deadbeef', 999), mockItem('39e63ce9', 5)];
    await cp.click('.ss-random');
    await cp.waitForFunction('new URL(location.href).searchParams.get("scene") === "39e63ce9"', null, { timeout: 15000 }).catch(() => null);
    const otherPicked = sceneInUrl(cp);
    const s4b = (await beacons(cp)).filter((x) => x.e === 'scene_open').map((x) => x.p?.source);
    await c.ctx.close();
    const pass = ready.status === 'ready' && !!picked && tier0.includes(picked) && bc.length === 1 && bc[0].p?.source === 'random' && !!starredReq;
    return { pass, control: controlNothing && otherPicked === '39e63ce9' && s4b.includes('random'), picked, status: ready.status, tier0Size: tier0.length, beacons: bc, starredRequest: starredReq, controlPickerError: pickerError, controlMessage: noneText, controlOtherPicked: otherPicked };
});

// ---- S5 a card click opens that scene; control: a card of a scene that does not exist ----
await check('S5', async () => {
    const list = (await live(DEFAULT_QS)).items as Any[];
    const target = list.find((x) => ['sog', 'ssog', 'sogs'].includes(x.format))?.id;
    const { ctx } = await context(browser);
    const p = await ctx.newPage();
    await picker(p);
    await openTab(p);
    await p.click(`.ss-grid .ss-card[data-scene="${target}"]`);
    const ready = await waitFlight(p);
    const bc = (await beacons(p)).filter((x) => x.e === 'scene_open');
    const opened = sceneInUrl(p);
    await ctx.close();
    const c = await context(browser);
    c.wire.mode = 'mock';
    c.wire.items = [mockItem('deadbeef')];
    const cp = await c.ctx.newPage();
    await picker(cp);
    await openTab(cp);
    await cp.click('.ss-grid .ss-card[data-scene="deadbeef"]');
    await cp.waitForFunction('window.__gsfpv.status !== "loading" && window.__gsfpv.errorCode', null, { timeout: 120000 }).catch(() => null);
    const ctrl = await ev<Any>(cp, '({ status: window.__gsfpv.status, errorCode: window.__gsfpv.errorCode ?? null, picker: !!document.querySelector(".screen.scenes") })');
    await c.ctx.close();
    const pass = ready.status === 'ready' && opened === target && bc.length === 1 && bc[0].p?.source === 'superspl';
    return { pass, control: ctrl.status !== 'ready' && !!ctrl.errorCode && ctrl.picker, target, opened, status: ready.status, beacons: bc, controlMissingScene: ctrl };
});

// ---- S7 503 then Retry; offline ----
await check('S7', async () => {
    const { ctx, wire } = await context(browser);
    wire.mode = '503';
    const p = await ctx.newPage();
    await picker(p);
    await openTab(p);
    const msg = await errorLine(p);
    const cards0 = (await ids(p)).length;
    const retryVisible = await p.isVisible('.ss-retry');
    const filtersVisible = await p.isVisible('.ss-sort');
    wire.mode = 'live';
    await p.waitForTimeout(1500);
    const stillMsg = await errorLine(p);
    const cardsWithoutClick = (await ids(p)).length;
    await p.click('.ss-retry');
    await settle(p);
    const cardsAfter = (await ids(p)).length;
    const msgAfter = await errorLine(p);
    await ctx.setOffline(true);
    wire.offline = true;
    await p.selectOption('.ss-sort', 'oldest');
    await p.waitForFunction('(() => { const e = document.querySelector(".ss-error"); return e && !e.hidden; })()', null, { timeout: 15000 }).catch(() => null);
    const offline = await errorLine(p);
    await ctx.setOffline(false);
    wire.offline = false;
    await p.click('.ss-retry');
    await settle(p);
    const cardsBack = (await ids(p)).length;
    await ctx.close();
    const busyText = `${EN['superspl.error.busy']} ${EN['superspl.error.wait'].replace('{s}', '5')}${EN['superspl.retry']}`;
    const pass = msg === busyText && cards0 === 0 && retryVisible && filtersVisible && cardsAfter > 0 && msgAfter === null && (offline ?? '').startsWith(EN['superspl.error.offline']) && cardsBack > 0;
    return { pass, control: stillMsg === msg && cardsWithoutClick === 0, message: msg, retryVisible, filtersVisible, cardsAfterRetry: cardsAfter, offlineMessage: offline, cardsBackOnline: cardsBack };
});

// ---- S8 phone ----
const OVERLAP_JS = `(() => {
    const vw = document.documentElement.clientWidth;
    const scr = document.querySelector('.screen.scenes');
    const overflow = Math.max(document.documentElement.scrollWidth, scr.scrollWidth) - Math.max(vw, scr.clientWidth);
    const sel = ['.tabs .tab', '.ss-search', '.ss-sort', '.ss-time', '.ss-check', '.ss-random', '.ss-open', '.ss-status', '.ss-grid > .scene-cell', '.ss-more:not([hidden])', '.planted'];
    const els = sel.flatMap((s) => [...document.querySelectorAll(s)]).filter((e) => e.getClientRects().length);
    const r = els.map((e) => ({ n: (e.className || e.tagName).toString().slice(0, 30), b: e.getBoundingClientRect() }));
    const hits = [];
    for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) {
        const a = r[i].b, c = r[j].b;
        if (a.width && c.width && a.left < c.right - 1 && c.left < a.right - 1 && a.top < c.bottom - 1 && c.top < a.bottom - 1) hits.push(r[i].n + ' x ' + r[j].n);
    }
    const out = r.filter((x) => x.b.left < -1 || x.b.right > vw + 1).map((x) => x.n);
    const inner = [...document.querySelectorAll('.ss-grid > .scene-cell')].slice(0, 4).flatMap((cell) => {
        const s = cell.querySelector('.star').getBoundingClientRect(); const bd = cell.querySelector('.ss-badges').getBoundingClientRect();
        return bd.width && s.left < bd.right - 1 && bd.left < s.right - 1 && s.top < bd.bottom - 1 && bd.top < s.bottom - 1 ? ['star x badges'] : [];
    });
    const unlabelled = [...document.querySelectorAll('.ss-tab input, .ss-tab select')].filter((e) => !e.getAttribute('aria-label') && !(e.id && document.querySelector('label[for="' + e.id + '"]'))).map((e) => e.className || e.type);
    return { vw, overflow, overlaps: hits.concat(inner), offscreen: out, unlabelled, checked: r.length };
})()`;

await check('S8', async () => {
    const { ctx } = await context(browser, { w: 375, h: 812, mobile: true });
    const p = await ctx.newPage();
    await picker(p);
    await openTab(p);
    const m = await ev<Any>(p, OVERLAP_JS);
    const phoneThumb = (await thumbs(p, 1))[0];
    await p.screenshot({ path: join(SHOTS, 'phone-375.png') });
    // keyboard order from the search field
    await p.focus('.ss-search');
    const order: string[] = [];
    for (let i = 0; i < 9; i++) {
        await p.keyboard.press('Tab');
        order.push(await ev<string>(p, '(() => { const a = document.activeElement; return (a.className || a.tagName).toString().split(" ").filter((c) => c.startsWith("ss-") || c === "star" || c === "scene-card").join(".") || a.tagName; })()'));
    }
    // controls: a 600 px element, an element over the Random button, an unlabelled field
    await ev(p, `(() => { const t = document.querySelector('.ss-tab'); const w = document.createElement('div'); w.className = 'planted-wide'; w.style.cssText = 'width:600px;height:10px'; t.append(w); const r = document.querySelector('.ss-random').getBoundingClientRect(); const o = document.createElement('div'); o.className = 'planted'; o.style.cssText = 'position:fixed;left:' + r.left + 'px;top:' + r.top + 'px;width:' + r.width + 'px;height:' + r.height + 'px'; document.body.append(o); const i = document.createElement('input'); t.append(i); })()`);
    const c = await ev<Any>(p, OVERLAP_JS);
    await ctx.close();
    const expectOrder = ['ss-sort', 'ss-walk', 'ss-dl', 'ss-random', 'ss-open', 'ss-retry'];
    const seen = expectOrder.filter((k) => order.includes(k));
    const reachesCard = order.includes('scene-card.ss-card') && order.includes('star');
    const pass = !!phoneThumb?.loaded && m.overflow <= 0 && m.overlaps.length === 0 && m.offscreen.length === 0 && m.unlabelled.length === 0 && reachesCard && order.indexOf('ss-sort') < order.indexOf('ss-random') && order.indexOf('ss-random') < order.indexOf('scene-card.ss-card');
    return { pass, control: c.overflow > 0 && c.overlaps.length > 0 && c.unlabelled.length > 0, measured: m, phoneThumb, keyboard: order, inOrder: seen, controlMeasured: { overflow: c.overflow, overlaps: c.overlaps.slice(0, 3), unlabelled: c.unlabelled } };
});

// ---- S9 languages ----
await check('S9', async () => {
    const res: Record<string, Any> = {};
    for (const l of ['ru', 'pl']) {
        const d = dict(l);
        const { ctx } = await context(browser, { lang: l });
        const p = await ctx.newPage();
        await picker(p, PICKER, l);
        const tabLabel = await ev<string>(p, 'document.querySelector(\'button[data-tab="superspl"]\').textContent');
        await openTab(p);
        const got = await ev<Any>(p, '({ random: document.querySelector(".ss-random").textContent, more: document.querySelector(".ss-more").textContent, sort: document.querySelector(".ss-sort").getAttribute("aria-label"), rawKeys: [...document.querySelectorAll(".ss-tab *")].filter((e) => e.children.length === 0 && /^superspl\\./.test(e.textContent)).length, option: document.querySelector(".ss-sort option[value=likes]").textContent })');
        res[l] = { ...got, tabLabel, ok: got.random === d['superspl.random'] && got.more === d['superspl.more'] && got.sort === d['superspl.sort'] && got.option === d['superspl.sort.likes'] && got.rawKeys === 0 && tabLabel === d['superspl.tab'] };
        await ctx.close();
    }
    return { pass: res.ru.ok && res.pl.ok, control: res.ru.random !== EN['superspl.random'] && res.pl.random !== EN['superspl.random'], ...res };
});

await main.ctx.close();
await browser.close();
const names = Object.keys(results);
out.results = results;
out.pageErrors = errors;
out.summary = { checks: names.length, passed: names.filter((k) => results[k].pass).length, controlsFired: names.filter((k) => results[k].control).length };
const file = writeEvidence('v03-superspl', out);
console.log(JSON.stringify(out.summary), errors.length ? `page errors: ${errors.length}` : '', file);
process.exit(names.every((k) => results[k].pass && results[k].control) && errors.length === 0 ? 0 : 1);
