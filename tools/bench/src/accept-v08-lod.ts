// v0.8 lane C (the owner's item 8): levels of detail by default, in the real page. Draws scans: run it
// under the GPU lock (C:/dev/.gpu-lock). Every item has a control that must come out the other way.
//   L1  the owner's streamed city scan ba7aa29d (60.3 M splats, 10 levels) on a desktop: it opens from
//       lod-meta.json, the LOD range opens to every level after the reveal, and in the 20 s after the
//       reveal the governor never cascades (never more than one step below the top, 4 M at render
//       scale 1); the finest level is in use near the camera (or still on its way from the CDN with the
//       drawing under its budget: networkBound), and F3 says "Levels of detail: 10". One
//       step is the governor's answer to one burst of missed frames (10 % of a second), which the
//       streaming can cause now that every missed frame counts (review R1: 2 runs of 2, step 1 for 5 s,
//       once at s9, once at s18); the owner's coarse city was a cascade.
//       Control: the same page of the release before lane C (SITE_BEFORE) cascades, 2 steps or more,
//       within those 20 s (its clock read on-time frames as missed), the camera still.
//   L2  a phone (user agent, touch, small viewport): the same scan streams its levels under SuperSplat's
//       mobile budget, a 2 M top. Control: the desktop's 4 M top in L1.
//   L3  a broken lod-meta.json falls back: 723068d7 is told it has a lod-meta.json (HEAD 200, the body an
//       error page as JSON); the session refuses it, opens meta.json and says so (window.__gsfpv.lod():
//       one content failure, kind meta, F3 "did not open"). Controls: the same scene without the route
//       opens meta.json with no failure; 39e63ce9 with the same broken lod-meta.json, or with one whose
//       first leaf has no bound, and no meta.json ends in the pilot's error card 'broken' (error.broken)
//       within a minute; a release without the check (SITE_BEFORE) does not show that card.
//   L4  SuperSplat's next default, a folder with both files: 39e63ce9 is told it also has a meta.json
//       (HEAD 200); the scan still streams its levels from lod-meta.json and meta.json is never fetched.
//       Control: L3's scene, whose only file is meta.json, fetches it.
//   SITE=http://127.0.0.1:5382 SITE_BEFORE=http://127.0.0.1:5381 npx tsx src/accept-v08-lod.ts [L1 L2 ...]
// Evidence: evidence/<date>/v08-lod.json and v08-lod/*.png.
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Browser, BrowserContext, Page } from 'playwright';
import { launchChrome, waitReady } from './browser';
import { writeEvidence, REPO, today } from './evidence';

const SITE = (process.env.SITE ?? 'http://127.0.0.1:5382').replace(/\/$/, '');
const SITE_BEFORE = process.env.SITE_BEFORE?.replace(/\/$/, '') ?? null;
const CITY = 'ba7aa29d';
const SINGLE = '723068d7';
const STREAMED = '39e63ce9';
const CDN = 'https://d28zzqy0iyovbz.cloudfront.net';
const ONLY = process.argv.slice(2).map((x) => x.toUpperCase());
const want = (id: string) => ONLY.length === 0 || ONLY.includes(id);
const SHOTS = join(REPO, 'evidence', today(), 'v08-lod' + (process.env.EVIDENCE_SUFFIX ?? ''));
mkdirSync(SHOTS, { recursive: true });
const PHONE_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
/** How long after the reveal the drawing must hold (and the control must drop), s. */
const HOLD_S = Number(process.env.HOLD_S ?? 20);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

/** The page's state (a string: tsx would wrap a function in __name). */
const STATE = `(() => {
    const h = window.__gsfpv; const s = h && h.session; const r = s && s.renderer;
    if (!r) return { status: h ? h.status : 'none', errorCode: h ? h.errorCode || null : null };
    const g = h.governor; const comp = r.splat && r.splat.gsplat;
    const perLevel = {};
    const dir = r.app.renderer.gsplatDirector;
    if (dir) dir.camerasMap.forEach((cd) => cd.layersMap.forEach((ld) => {
        const w = ld.gsplatManager && ld.gsplatManager.world;
        if (w && w._octreeInstances) w._octreeInstances.forEach((inst) => inst.nodeInfos.forEach((ni, i) => {
            if (ni.currentLod < 0) return;
            const c = inst.octree.nodes[i].lods[ni.currentLod];
            perLevel[ni.currentLod] = (perLevel[ni.currentLod] || 0) + (c ? c.count : 0);
        }));
    }));
    return {
        status: h.status, errorCode: h.errorCode || null, lod: typeof h.lod === 'function' ? h.lod() : null,
        contentKind: s.scene.contentKind, rangeMin: comp ? comp.lodRangeMin : null, rangeMax: comp ? comp.lodRangeMax : null,
        budgetM: r.app.scene.gsplat.splatBudget / 1e6, scale: r.renderScale, step: g ? g.step : null, top: g ? g.topBudgetMillions : null,
        changes: g ? g.changes : null, hitches: g ? g.streamHitches : null, drawn: r.app.stats.frame.gsplats, perLevel,
        visibleMs: s.timings.visibleMs, firstFrameMs: s.timings.firstFrameMs,
        detailLine: (document.querySelector('[data-testid=detail-line]') || {}).textContent || null
    };
})()`;

async function context(browser: Browser, phone = false): Promise<{ ctx: BrowserContext; page: Page; log: string[]; urls: string[] }> {
    const ctx = await browser.newContext(phone
        ? { viewport: { width: 412, height: 915 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, userAgent: PHONE_UA }
        : { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    await ctx.route('**/api/e', (r) => r.fulfill({ status: 204, body: '' }));
    await ctx.addInitScript('window.__name = window.__name || ((f) => f);');
    const page = await ctx.newPage();
    const log: string[] = [];
    const urls: string[] = [];
    page.on('console', (m) => log.push(`${m.type()}: ${m.text()}`.slice(0, 300)));
    page.on('pageerror', (e) => log.push(`pageerror: ${e.message}`.slice(0, 300)));
    page.on('request', (rq) => { if (rq.url().startsWith(CDN)) urls.push(`${rq.method()} ${rq.url().slice(CDN.length)}`); });
    return { ctx, page, log, urls };
}
const errors = (log: string[]) => log.filter((l) => l.startsWith('pageerror'));

/** Open a scene and wait until it is revealed (or the page shows an error); the state then. */
async function open(page: Page, site: string, id: string, timeoutMs = 180000): Promise<Any> {
    await page.goto(`${site}/en/fly/?scene=${id}&nowarn=1&input=touch`);
    const r = await waitReady(page, timeoutMs);
    if (r.status !== 'ready') return { status: r.status, error: r.error, errorCode: await page.evaluate('window.__gsfpv.errorCode || null') };
    const t0 = Date.now();
    let st: Any = await page.evaluate(STATE);
    while (Date.now() - t0 < timeoutMs && st.visibleMs === null) {
        await page.waitForTimeout(250);
        st = await page.evaluate(STATE);
    }
    return st;
}

/** Sample every second for HOLD_S seconds after the reveal: the drawing and the levels in use. */
async function hold(page: Page): Promise<Any[]> {
    const out: Any[] = [];
    for (let i = 0; i < HOLD_S; i++) {
        await page.waitForTimeout(1000);
        const x: Any = await page.evaluate(STATE);
        out.push({ s: i + 1, budgetM: x.budgetM, scale: x.scale, step: x.step, changes: x.changes, hitches: x.hitches, drawn: x.drawn, perLevel: x.perLevel });
    }
    return out;
}
const finest = (o: Record<string, number>) => { const ks = Object.keys(o ?? {}).map(Number).filter((k) => o[k] > 0); return ks.length ? Math.min(...ks) : null; };
const lowered = (samples: Any[]) => samples.some((x) => x.budgetM < 4 - 1e-9 || x.scale < 1 - 1e-9);
/**
 * The finer levels are still on their way and the drawing is not what holds them back: files in flight
 * and fewer splats drawn than the budget allows. The first run of the day meets CloudFront's cold edge
 * (review runs 2 and 3: 1.2 and 2.7 M of 4 M drawn at the end, 42-58 files in flight, while the control
 * run right after reached 3.6 M), so the finest level near the camera can still be 2 or 3 then.
 */
const networkBound = (end: Any) => (end.lod?.loading ?? 0) > 0 && end.drawn < 0.95 * end.budgetM * 1e6;
/** The governor's deepest step in the samples (0 = the top). */
const deepest = (samples: Any[]) => Math.max(0, ...samples.map((x) => x.step ?? 0));

const out: Record<string, unknown> = {};
const pass: Record<string, boolean> = {};
const { browser, which } = await launchChrome({ headless: false, args: ['--window-position=40,40', '--window-size=1296,920'] });

// ------------------------------------------------------------------ L1
if (want('L1')) {
    const run = async (site: string, label: string): Promise<Any> => {
        const { ctx, page, log } = await context(browser);
        const st = await open(page, site, CITY);
        await page.keyboard.press('F3');
        const samples = st.status === 'ready' ? await hold(page) : [];
        const end: Any = await page.evaluate(STATE);
        await page.screenshot({ path: join(SHOTS, `L1-${label}.png`) });
        await ctx.close();
        return { site, atReveal: st, samples, end, finestAtEnd: finest(end.perLevel), lowered: lowered(samples), pageerrors: errors(log) };
    };
    const after = await run(SITE, 'after');
    const before = SITE_BEFORE ? await run(SITE_BEFORE, 'before') : null;
    const a = after;
    const okAfter = a.atReveal.status === 'ready' && a.end.contentKind === 'lod-meta' && a.end.lod?.levels === 10 && a.end.lod?.mode === 'auto'
        && a.end.rangeMin === 0 && a.end.rangeMax >= 9 && deepest(a.samples) <= 1
        && a.end.top === 4 && a.finestAtEnd !== null && (a.finestAtEnd <= 1 || networkBound(a.end))
        && /^Levels of detail: 10, chosen by distance/.test(a.end.detailLine ?? '') && a.pageerrors.length === 0;
    // the control proves the check can fail: the old governor's cascade (2 steps or more) on the same scan
    const controlFired = before === null ? null : before.atReveal.status === 'ready' && deepest(before.samples) >= 2;
    out.L1 = { after, before, okAfter, controlFired };
    pass.L1 = okAfter && controlFired !== false;
    console.log('L1', pass.L1, JSON.stringify({ okAfter, controlFired, after: { finest: a.finestAtEnd, lowered: a.lowered, deepest: deepest(a.samples), changes: a.end.changes, hitches: a.end.hitches, line: a.end.detailLine }, before: before && { lowered: before.lowered, deepest: deepest(before.samples), changes: before.end.changes } }));
}

// ------------------------------------------------------------------ L2
if (want('L2')) {
    const { ctx, page, log } = await context(browser, true);
    const st = await open(page, SITE, CITY);
    await page.waitForTimeout(3000);
    const end: Any = await page.evaluate(STATE);
    await page.screenshot({ path: join(SHOTS, 'L2-phone.png') });
    await ctx.close();
    out.L2 = { atReveal: st, end, pageerrors: errors(log) };
    pass.L2 = st.status === 'ready' && end.contentKind === 'lod-meta' && end.lod?.levels === 10 && end.rangeMax >= 9 && end.top === 2 && end.budgetM <= 2 && errors(log).length === 0;
    console.log('L2', pass.L2, JSON.stringify({ top: end.top, budgetM: end.budgetM, mode: end.lod?.mode, drawn: end.drawn }));
}

/** Route the HEAD and GET of one CDN file: HEAD answers 200, GET the given body (a broken lod-meta.json) or the real file. */
async function pretend(ctx: BrowserContext, path: string, body: string | null): Promise<void> {
    await ctx.route(`${CDN}${path}`, async (route) => {
        const rq = route.request();
        if (rq.method() === 'HEAD') return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: '' });
        if (body !== null) return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body });
        return route.continue();
    });
}
const BROKEN = JSON.stringify({ message: 'Access Denied' });
/** The simulator's English texts (the picker's error card must say error.broken, not the engine's words). */
const FLY_EN = JSON.parse(readFileSync(join(REPO, 'packages', 'i18n', 'locales', 'fly', 'en.json'), 'utf8')) as Record<string, string>;

/** The scene's real lod-meta.json with the `bound` of its first leaf removed: the top level stays right. */
async function leafBroken(id: string): Promise<{ body: string; removed: string }> {
    const json = (await (await fetch(`${CDN}/${id}/v1/lod-meta.json`)).json()) as Any;
    const stack: Any[] = [json.tree];
    while (stack.length > 0) {
        const node = stack.pop();
        if (node.lods) {
            delete node.bound;
            return { body: JSON.stringify(json), removed: 'the bound of the first leaf found' };
        }
        for (const c of node.children ?? []) stack.push(c);
    }
    throw new Error(`${id}: lod-meta.json has no leaf`);
}

// ------------------------------------------------------------------ L3
if (want('L3')) {
    // the broken lod-meta.json in front of a scene that also has meta.json
    const a = await context(browser);
    await pretend(a.ctx, `/${SINGLE}/v1/lod-meta.json`, BROKEN);
    const fell = await open(a.page, SITE, SINGLE);
    await a.page.keyboard.press('F3');
    await a.page.waitForTimeout(800);
    const fellEnd: Any = await a.page.evaluate(STATE);
    await a.page.screenshot({ path: join(SHOTS, 'L3-fallback.png') });
    const fellUrls = [...a.urls];
    await a.ctx.close();
    // control 1: the same scene as the CDN really has it
    const b = await context(browser);
    const plain = await open(b.page, SITE, SINGLE);
    await b.ctx.close();
    // control 2: a broken lod-meta.json with nothing to fall back to, and (review R2/R3) one whose top
    // level is right but whose first leaf has no bound: an error card 'broken' with the pilot's text within
    // a minute. Control (SITE_BEFORE, a release without the check): not the pilot's text. Measured: the
    // engine itself fails such a file ("Error loading gsplat octree": its Http calls the parser's callback
    // inside a try/catch), so a release without the check shows that English message (errorCode
    // 'generic'); the review's "the page waits forever" did not happen for a leaf without a bound.
    const leaf = await leafBroken(STREAMED);
    const brokenRun = async (site: string, body: string, shot: string) => {
        const x = await context(browser);
        await x.ctx.route(`${CDN}/${STREAMED}/v1/lod-meta.json`, (route) => (route.request().method() === 'HEAD' ? route.continue() : route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body })));
        const t1 = Date.now();
        const st: Any = await open(x.page, site, STREAMED, 60000).catch((e: Error) => ({ status: 'timeout', error: e.message }));
        const ms = Date.now() - t1;
        const text = await x.page.evaluate('(document.querySelector(".scene-error") || {}).textContent || null');
        await x.page.screenshot({ path: join(SHOTS, `${shot}.png`) });
        await x.ctx.close();
        return { ...st, ms, text };
    };
    const dead = await brokenRun(SITE, BROKEN, 'L3-no-fallback');
    const leafAfter = await brokenRun(SITE, leaf.body, 'L3-leaf-after');
    const deadBefore = SITE_BEFORE ? await brokenRun(SITE_BEFORE, BROKEN, 'L3-no-fallback-before') : null;
    const leafBefore = SITE_BEFORE ? await brokenRun(SITE_BEFORE, leaf.body, 'L3-leaf-before') : null;
    /** The pilot's card for a damaged scan, in time. */
    const card = (x: Any) => x.status === 'error' && x.errorCode === 'broken' && x.text === FLY_EN['error.broken'] && x.ms < 60000;
    out.L3 = { fallback: { atReveal: fell, end: fellEnd, cdn: fellUrls, pageerrors: errors(a.log) }, plain, noFallback: { after: dead, before: deadBefore }, leaf: { removed: leaf.removed, after: leafAfter, before: leafBefore } };
    pass.L3 = fell.status === 'ready' && fellEnd.contentKind === 'meta' && fellEnd.lod?.contentFailures?.length === 1 && /not an octree/.test(fellEnd.lod.contentFailures[0].error)
        && fellUrls.some((u: string) => u === `GET /${SINGLE}/v1/lod-meta.json`) && fellUrls.some((u: string) => u === `GET /${SINGLE}/v1/meta.json`)
        && /did not open/.test(fellEnd.detailLine ?? '') && errors(a.log).length === 0
        && plain.status === 'ready' && plain.contentKind === 'meta' && plain.lod?.contentFailures?.length === 0
        && card(dead) && card(leafAfter)
        && (leafBefore === null || (leafBefore.status !== 'ready' && !card(leafBefore)));
    const brief = (x: Any) => x && [x.status, x.errorCode, x.ms, x.error && String(x.error).slice(0, 90)];
    console.log('L3', pass.L3, JSON.stringify({ fell: [fell.status, fellEnd.contentKind, fellEnd.lod?.contentFailures], plain: [plain.status, plain.contentKind], dead: brief(dead), leaf: leaf.removed, leafAfter: brief(leafAfter), deadBefore: brief(deadBefore), leafBefore: brief(leafBefore) }));
}

// ------------------------------------------------------------------ L4
if (want('L4')) {
    const a = await context(browser);
    await pretend(a.ctx, `/${STREAMED}/v1/meta.json`, null);
    const both = await open(a.page, SITE, STREAMED);
    await a.page.waitForTimeout(1500);
    const end: Any = await a.page.evaluate(STATE);
    const urls = [...a.urls];
    await a.ctx.close();
    const b = await context(browser);
    const single = await open(b.page, SITE, SINGLE);
    const singleUrls = [...b.urls];
    await b.ctx.close();
    out.L4 = { both: { atReveal: both, end, cdn: urls }, control: { state: single, cdn: singleUrls } };
    pass.L4 = both.status === 'ready' && end.contentKind === 'lod-meta' && end.lod?.levels === 4 && end.lod?.contentFailures?.length === 0
        && urls.includes(`HEAD /${STREAMED}/v1/meta.json`) && !urls.includes(`GET /${STREAMED}/v1/meta.json`)
        && single.status === 'ready' && singleUrls.includes(`GET /${SINGLE}/v1/meta.json`);
    console.log('L4', pass.L4, JSON.stringify({ kind: end.contentKind, levels: end.lod?.levels, metaGets: urls.filter((u: string) => u.endsWith('/meta.json') && u.startsWith('GET') && !/\d+_\d+/.test(u)) }));
}

await browser.close();
writeEvidence('v08-lod', { site: SITE, siteBefore: SITE_BEFORE, browser: which, holdS: HOLD_S, pass, items: out });
console.log(JSON.stringify(pass));
process.exit(Object.values(pass).every(Boolean) ? 0 : 1);
