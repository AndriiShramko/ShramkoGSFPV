// v0.9 lane A acceptance (the owner's items 3b, 8, 10/16 and the oranges-and-lemons scene) in the real page, on a
// local release, with the release before the fix as the negative control: every check must pass on SITE and fail on
// SITE_BEFORE (V3 is a regression guard both pass). Draws scans: run it under the GPU lock (C:/dev/.gpu-lock).
//   V1  single-file scan by link (d8ba72a6, the fruit bowl with oranges and lemons): the first view is shown at most
//       3 s after the stage "Preparing the view" begins, for the reason 'ready' or 'settled'.
//       Control: the base build is still preparing 20 s later (it waited for 30 s of silence).
//   V2  the owner's flow: flying a8cfc66e, the in-page switch (N / the picker, the page's shared renderer) to the
//       single-file 224aba38 (61.5 MB): the same 3 s bound after "Preparing the view". Control: as V1.
//   V3  streamed scan by link (a8cfc66e): shown within 3 s of "Preparing the view" (guard: both builds).
//   V4  the card never stands still (from V1 and V2): the spinner turns, and the card's own rows (stage, numbers,
//       parts) never stay the same for more than 3 s before the view is shown. Control: the base card's rows stand
//       still for 10 s or more while it prepares, and it has no spinner.
//   V5  Fly now: a8cfc66e with one of its two coarse files held back (a slow CDN): the card offers Fly now within 8 s
//       of the start, pressing it shows the view at once (reason 'pilot') and the card says why. Control: the base
//       card offers no Fly now within 12 s.
//   V6  the video export finishes on a big streamed scan over a slow link (1994c65c, 60 M splats, the link throttled to
//       3 MB/s, a 5 s parked flight at 1080p): it ends 'done' within EXPORT_LIMIT_S with every frame encoded, and the
//       saved file is read back: its bytes as the export reports them, an MP4 ('ftyp'). Control: the base export has
//       not finished in the same time (its frame 0 waited for all 60 M splats at the finest level).
//   SITE=http://127.0.0.1:5718 SITE_BEFORE=http://127.0.0.1:5717 npx tsx src/accept-v09-load.ts [V1 V2 ...]
// Evidence: evidence/<date>/v09-load.json
import { readFileSync } from 'node:fs';
import type { Browser, BrowserContext, Page } from 'playwright';
import { launchChrome } from './browser';
import { writeEvidence } from './evidence';

const SITE = (process.env.SITE ?? 'http://127.0.0.1:5718').replace(/\/$/, '');
const SITE_BEFORE = process.env.SITE_BEFORE?.replace(/\/$/, '') ?? null;
const CDN = 'https://d28zzqy0iyovbz.cloudfront.net';
const ONLY = process.argv.slice(2).map((x) => x.toUpperCase());
const want = (id: string) => ONLY.length === 0 || ONLY.includes(id);
const PREPARE_BOUND_MS = 3000;
const STILL_BOUND_MS = 3000;
const EXPORT_LIMIT_S = Number(process.env.EXPORT_LIMIT_S ?? 150);
console.log(`target ${SITE} control ${SITE_BEFORE ?? '(none: controls skipped)'}`);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

/** The loading card and the page's hook now (a string: tsx would wrap a function in __name). */
const CARD = `(() => {
    const h = window.__gsfpv || {};
    const cards = document.querySelectorAll('[data-testid=loading]');
    const card = cards[cards.length - 1] || null;
    const txt = (sel) => { const e = card && card.querySelector(sel); return e ? e.textContent : null; };
    const fly = card && card.querySelector('[data-action=load-fly-now]');
    const spin = card && card.querySelector('.load-spin');
    return {
        card: card ? { stage: card.dataset.stage, reveal: card.dataset.reveal || null, title: txt('.load-stage'), nums: txt('.load-nums'), parts: txt('.load-parts'), hint: txt('.load-hint'),
            flyNow: !!fly && !fly.hidden && getComputedStyle(card.querySelector('.load-actions')).visibility === 'visible',
            spinning: !!spin && spin.getAnimations().some((a) => a.playState === 'running') } : null,
        status: h.status || null, sceneSwitch: h.sceneSwitch || null, loading: h.loading || null,
        visibleMs: h.session && h.session.timings ? h.session.timings.visibleMs : null,
        reveal: h.session && h.session.timings ? h.session.timings.reveal || null : null
    };
})()`;

async function newPage(browser: Browser): Promise<{ ctx: BrowserContext; page: Page; log: string[] }> {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, acceptDownloads: true });
    await ctx.route('**/api/e', (r) => r.fulfill({ status: 204, body: '' }));
    await ctx.addInitScript('window.__name = window.__name || ((f) => f);');
    const page = await ctx.newPage();
    const log: string[] = [];
    page.on('pageerror', (e) => log.push(`pageerror: ${e.message}`.slice(0, 300)));
    return { ctx, page, log };
}
const flyUrl = (site: string, id: string): string => `${site}/en/fly/?scene=${id}&nowarn=1&input=touch`;

/**
 * Samples the card every 250 ms from t0 until `shown()` says the view is on screen, or `limitMs`, or `afterPrepareMs`
 * after the card's stage became 'prepare'. Returns when each stage began, when the view was shown, and the longest
 * time the card's rows (stage, numbers, parts) stood the same before it.
 */
async function watchLoad(page: Page, t0: number, shown: (x: Any) => boolean, limitMs: number, afterPrepareMs: number): Promise<Any> {
    const stages: Record<string, number> = {};
    let shownAt: number | null = null;
    let rows = '';
    let rowsAt = 0;
    let longestStill = 0;
    let spinning = false;
    let flyNowAt: number | null = null;
    let last: Any = null;
    let prevT = 0; // the last sample that did not yet see the view
    while (Date.now() - t0 < limitMs) {
        const x: Any = await page.evaluate(CARD).catch(() => null);
        const t = Date.now() - t0;
        if (x) {
            last = x;
            // "Preparing the view" lasted less than one sample: it began after the previous sample, so the time from it
            // to the view is at most the gap between the two samples (an upper bound, marked as such)
            if (shown(x) && stages.prepare === undefined && x.card?.stage === 'done') { stages.prepare = prevT; stages.prepareUnseen = 1; }
            if (x.card) {
                if (stages[x.card.stage] === undefined) stages[x.card.stage] = t;
                if (x.card.spinning) spinning = true;
                if (x.card.flyNow && flyNowAt === null) flyNowAt = t;
                const r = `${x.card.title}|${x.card.nums}|${x.card.parts}`;
                if (r !== rows) { rows = r; rowsAt = t; }
                if (x.card.stage !== 'done') longestStill = Math.max(longestStill, t - rowsAt);
            }
            if (shown(x)) { shownAt = t; break; }
        }
        if (stages.prepare !== undefined && t - stages.prepare > afterPrepareMs) break;
        prevT = t;
        await page.waitForTimeout(250);
    }
    const prepareMs = shownAt !== null && stages.prepare !== undefined ? shownAt - stages.prepare : null;
    return { stages, shownAt, prepareMs, longestStillMs: longestStill, spinning, flyNowAt, reveal: last?.reveal ?? last?.loading?.reveal ?? null, last };
}

const firstLoad = (x: Any): boolean => x.visibleMs !== null && x.visibleMs !== undefined;
const switched = (x: Any): boolean => x.sceneSwitch?.state === 'done' || x.sceneSwitch?.state === 'failed';

/** V1/V3: a scene by link. */
async function byLink(browser: Browser, site: string, id: string, control: boolean): Promise<Any> {
    const { ctx, page, log } = await newPage(browser);
    const t0 = Date.now();
    await page.goto(flyUrl(site, id));
    const r = await watchLoad(page, t0, firstLoad, 120000, control ? 20000 : 60000);
    await ctx.close();
    return { site, id, ...r, last: undefined, pageerrors: log };
}

/** V2: fly `from`, then switch in the page to `to`. */
async function bySwitch(browser: Browser, site: string, from: string, to: string, control: boolean): Promise<Any> {
    const { ctx, page, log } = await newPage(browser);
    let t0 = Date.now();
    await page.goto(flyUrl(site, from));
    const first = await watchLoad(page, t0, firstLoad, 60000, 30000);
    await page.waitForTimeout(3000);
    t0 = Date.now();
    await page.evaluate(`void window.__gsfpv.scenes.load(${JSON.stringify(to)}, 'pick')`);
    const r = await watchLoad(page, t0, switched, 150000, control ? 20000 : 60000);
    await ctx.close();
    return { site, from, to, firstShownAt: first.shownAt, ...r, last: undefined, pageerrors: log };
}

/** V5: a8cfc66e with one of its two coarse files held back until the end; press Fly now when offered. */
async function flyNowCase(browser: Browser, site: string, control: boolean): Promise<Any> {
    const id = 'a8cfc66e';
    const lod = (await (await fetch(`${CDN}/${id}/v1/lod-meta.json`)).json()) as Any;
    const coarse = lod.lodLevels - 1;
    const files = new Set<number>();
    const walk = (n: Any): void => { if (n.lods?.[coarse]) files.add(n.lods[coarse].file); for (const c of n.children ?? []) walk(c); };
    walk(lod.tree);
    const held = [...files].map((f) => `${CDN}/${id}/v1/${String(lod.filenames[f]).replace(/[^/]*$/, '')}`).sort().pop()!;
    const { ctx, page, log } = await newPage(browser);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => { release = r; });
    await ctx.route(`${held}**`, async (route) => { await gate; await route.continue().catch(() => undefined); });
    const t0 = Date.now();
    await page.goto(flyUrl(site, id));
    const offered = await watchLoad(page, t0, (x) => !!x.card?.flyNow || firstLoad(x), control ? 12000 : 30000, 60000);
    let pressed: Any = null;
    if (offered.flyNowAt !== null) {
        const t1 = Date.now();
        await page.click('[data-action=load-fly-now]');
        pressed = await watchLoad(page, t1, firstLoad, 10000, 10000);
        pressed.card = (await page.evaluate(CARD) as Any).card;
        // the card's last words before it fades: read them right after the reveal
        pressed.hint = pressed.last?.card?.hint ?? null;
    }
    release();
    await ctx.close();
    return { site, held, offeredAt: offered.flyNowAt, shownWithoutPress: offered.shownAt !== null && offered.flyNowAt === null, pressed: pressed ? { shownAt: pressed.shownAt, reveal: pressed.reveal, hint: pressed.hint } : null, pageerrors: log };
}

/** V6: export a 5 s parked flight on 1994c65c at 1080p over a 3 MB/s link; the saved file read back. */
async function exportCase(browser: Browser, site: string): Promise<Any> {
    const { ctx, page, log } = await newPage(browser);
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 30, downloadThroughput: 3e6, uploadThroughput: 1e6 });
    const t0 = Date.now();
    await page.goto(flyUrl(site, '1994c65c'));
    const load = await watchLoad(page, t0, firstLoad, 120000, 60000);
    await page.waitForTimeout(5000);
    await page.evaluate(`(window.__vx = null, void window.__gsfpv.videoExport.run({ size: '1080p' }).then((r) => { window.__vx = r; }), 0)`);
    const t1 = Date.now();
    const bars: string[] = [];
    let result: Any = null;
    let k = 0;
    while (Date.now() - t1 < EXPORT_LIMIT_S * 1000) {
        await page.waitForTimeout(1000);
        result = await page.evaluate('window.__vx');
        const st: Any = await page.evaluate(`({ k: window.__gsfpv.videoExport.state().k, bar: (document.querySelector('[data-testid=video-export-status]') || {}).textContent || '' })`);
        k = st.k;
        if (bars[bars.length - 1] !== st.bar) bars.push(st.bar);
        if (result) break;
    }
    const seconds = (Date.now() - t1) / 1000;
    let file: Any = null;
    if (result?.ended === 'done' && (await page.$('[data-testid=video-export-offer]'))) {
        // the offered download pressed as the pilot would (fetch() of its blob: URL is refused by the page's CSP,
        // connect-src has no blob:): the bytes the browser saved and their first box
        const [dl] = await Promise.all([
            page.waitForEvent('download', { timeout: 60000 }),
            page.evaluate(`document.querySelector('[data-testid=video-export-offer]').click()`)
        ]);
        const path = await dl.path();
        const b = path ? readFileSync(path) : null;
        file = b ? { name: dl.suggestedFilename(), bytes: b.length, box: b.subarray(4, 8).toString('latin1') } : { name: dl.suggestedFilename(), failure: await dl.failure() };
    }
    if (!result) await page.evaluate('window.__gsfpv.videoExport.cancel()').catch(() => undefined);
    await ctx.close();
    return {
        site, loadShownAt: load.shownAt, seconds, finished: !!result, kAtEnd: k,
        result: result ? { ended: result.ended, frames: result.frames, encoded: result.encoded, forced: result.forced, waited: result.waited, error: result.error ?? null, info: result.info ? { bytes: result.info.bytes, frames: result.info.frames, where: result.info.where, ended: result.info.ended } : null } : null,
        file, bars: bars.slice(0, 12), pageerrors: log
    };
}

const out: Record<string, Any> = {};
const pass: Record<string, boolean> = {};
const control: Record<string, boolean | null> = {};
const prepOk = (r: Any): boolean => r.prepareMs !== null && r.prepareMs <= PREPARE_BOUND_MS && (r.reveal === 'ready' || r.reveal === 'settled');
const { browser, which } = await launchChrome({ headless: false, args: ['--window-position=40,40', '--window-size=1296,920'] });
try {
    if (want('V1') || want('V4')) {
        const now = await byLink(browser, SITE, 'd8ba72a6', false);
        const before = SITE_BEFORE ? await byLink(browser, SITE_BEFORE, 'd8ba72a6', true) : null;
        out.V1 = { now, before };
        pass.V1 = prepOk(now);
        control.V1 = before ? !(before.prepareMs !== null && before.prepareMs <= PREPARE_BOUND_MS) : null;
        console.log(`V1 ${pass.V1 ? 'PASS' : 'FAIL'} prepare ${now.prepareMs} ms (${now.reveal}); control ${before ? `${before.prepareMs ?? '>20000'} ms -> ${control.V1 ? 'fails as it must' : 'PASSED (bad control)'}` : 'skipped'}`);
    }
    if (want('V2') || want('V4')) {
        const now = await bySwitch(browser, SITE, 'a8cfc66e', '224aba38', false);
        const before = SITE_BEFORE ? await bySwitch(browser, SITE_BEFORE, 'a8cfc66e', '224aba38', true) : null;
        out.V2 = { now, before };
        pass.V2 = now.prepareMs !== null && now.prepareMs <= PREPARE_BOUND_MS && now.last?.sceneSwitch?.state !== 'failed';
        control.V2 = before ? !(before.prepareMs !== null && before.prepareMs <= PREPARE_BOUND_MS) : null;
        console.log(`V2 ${pass.V2 ? 'PASS' : 'FAIL'} switch prepare ${now.prepareMs} ms (stages ${JSON.stringify(now.stages)}); control ${before ? `${before.prepareMs ?? '>20000'} ms -> ${control.V2 ? 'fails as it must' : 'PASSED (bad control)'}` : 'skipped'}`);
    }
    if (want('V3')) {
        const now = await byLink(browser, SITE, 'a8cfc66e', false);
        const before = SITE_BEFORE ? await byLink(browser, SITE_BEFORE, 'a8cfc66e', false) : null;
        out.V3 = { now, before };
        pass.V3 = now.prepareMs !== null && now.prepareMs <= PREPARE_BOUND_MS;
        control.V3 = null; // a guard: the base build passes it too (streamed scans were never the problem)
        console.log(`V3 ${pass.V3 ? 'PASS' : 'FAIL'} streamed prepare ${now.prepareMs} ms (${now.reveal}); base ${before?.prepareMs ?? '-'} ms (guard, no control)`);
    }
    if (want('V4') && out.V1 && out.V2) {
        const runs = [out.V1.now, out.V2.now];
        pass.V4 = runs.every((r) => r.spinning && r.longestStillMs <= STILL_BOUND_MS);
        const bef = [out.V1.before, out.V2.before].filter(Boolean);
        control.V4 = bef.length ? bef.every((r: Any) => !r.spinning && r.longestStillMs >= 10000) : null;
        out.V4 = { now: runs.map((r) => ({ spinning: r.spinning, longestStillMs: r.longestStillMs })), before: bef.map((r: Any) => ({ spinning: r.spinning, longestStillMs: r.longestStillMs })) };
        console.log(`V4 ${pass.V4 ? 'PASS' : 'FAIL'} ${JSON.stringify(out.V4.now)}; control ${JSON.stringify(out.V4.before)} -> ${control.V4 === null ? 'skipped' : control.V4 ? 'fails as it must' : 'PASSED (bad control)'}`);
    }
    if (want('V5')) {
        const now = await flyNowCase(browser, SITE, false);
        const before = SITE_BEFORE ? await flyNowCase(browser, SITE_BEFORE, true) : null;
        out.V5 = { now, before };
        pass.V5 = now.offeredAt !== null && now.offeredAt <= 8000 && now.pressed?.shownAt !== null && now.pressed?.shownAt <= 1500 && now.pressed?.reveal === 'pilot' && !!now.pressed?.hint;
        control.V5 = before ? before.offeredAt === null : null;
        console.log(`V5 ${pass.V5 ? 'PASS' : 'FAIL'} offered at ${now.offeredAt} ms, shown ${now.pressed?.shownAt} ms after the press (${now.pressed?.reveal}) "${now.pressed?.hint}"; control ${before ? `offered ${before.offeredAt} -> ${control.V5 ? 'fails as it must' : 'PASSED (bad control)'}` : 'skipped'}`);
    }
    if (want('V6')) {
        const now = await exportCase(browser, SITE);
        const before = SITE_BEFORE ? await exportCase(browser, SITE_BEFORE) : null;
        out.V6 = { now, before };
        const r = now.result;
        pass.V6 = !!r && r.ended === 'done' && r.encoded === r.frames && r.frames > 0 && !!r.info && r.info.frames === r.frames && !!now.file && now.file.bytes === r.info.bytes && now.file.bytes > 100_000 && now.file.box === 'ftyp';
        control.V6 = before ? !(before.result?.ended === 'done') : null;
        console.log(`V6 ${pass.V6 ? 'PASS' : 'FAIL'} ${r ? `${r.ended} ${r.encoded}/${r.frames} (forced ${r.forced}) in ${now.seconds.toFixed(0)} s, file ${JSON.stringify(now.file)}` : `not finished in ${EXPORT_LIMIT_S} s (frame ${now.kAtEnd})`}; control ${before ? `${before.result ? `${before.result.ended} ${before.result.encoded}/${before.result.frames}` : `not finished in ${EXPORT_LIMIT_S} s, frame ${before.kAtEnd}`} -> ${control.V6 ? 'fails as it must' : 'PASSED (bad control)'}` : 'skipped'}`);
    }
} finally {
    await browser.close();
}
const ok = Object.values(pass).every(Boolean) && Object.values(control).every((c) => c !== false);
writeEvidence('v09-load', { site: SITE, siteBefore: SITE_BEFORE, browser: which, pass, control, ok, out });
console.log(`${ok ? 'ALL PASS' : 'NOT ALL PASS'} ${JSON.stringify(pass)} controls ${JSON.stringify(control)}`);
process.exitCode = ok ? 0 : 1;
