// v0.9 lane A, the owner's items 8, 10/16 and the oranges-and-lemons scene: what the loading of a scan
// really does, frame by frame, on a release (the base build or a fix). Not a gate: it records, the
// acceptance (accept-v09-load.ts) decides. Draws scans: run it under the GPU lock (C:/dev/.gpu-lock).
//
// Cases (argv; default: all of the owner's reports):
//   link:<id>[:<query>]      a fresh browser profile opens /en/fly/?scene=<id>[&<query>] (a link; e.g. budget=8&stochastic)
//   revisit:<id>             the same profile opens it twice (the browser's HTTP cache warm the second time)
//   switch:<from>:<to>[:<s>] open <from>, fly <s> s (3), then N-style in-page switch to <to> (the page's shared renderer)
//   export:<id>[:<s>]        open <id>, let the parked drone's life run <s> s (5), then "Save this flight as video"
//                            (1080p): the export's frame count, waits and the bar's text every second, the engine's state
// VIEW=4k: a 1920 x 1080 window at device pixel ratio 2 (the owner's 4K monitor: a 3840 x 2160 backbuffer).
// For each case, every 250 ms until the first view is revealed (or LIMIT_S): the loading card's stage, hint
// and numbers, and the engine's own state of the scan (gsplat 'frame:ready': ready / files loading, how
// often each flips, splats drawn, the octree's pending and prefetch files, the environment file, the LOD
// range, the budget). The base build's watchCoarse reveals on `ready && loading === 0` after `loading > 0`
// was seen, else after 30 s of silence; this shows which of those the scan ever gives.
//   SITE=http://127.0.0.1:5391 npx tsx src/probe-v09-load.ts link:d8ba72a6 link:a8cfc66e ...
// Evidence: evidence/<date>/v09-load-probe<EVIDENCE_SUFFIX>.json
import type { Browser, Page } from 'playwright';
import { launchChrome } from './browser';
import { writeEvidence } from './evidence';

const SITE = (process.env.SITE ?? 'http://127.0.0.1:5391').replace(/\/$/, '');
const LIMIT_S = Number(process.env.LIMIT_S ?? 75);
const DEFAULT_CASES = ['link:d8ba72a6', 'link:a8cfc66e', 'link:b11e45d1', 'link:a8cfc66e:budget=8&stochastic', 'switch:39e63ce9:a8cfc66e', 'switch:39e63ce9:d8ba72a6', 'revisit:a8cfc66e'];
const CASES = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_CASES;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

/**
 * Attach a counter to the shared renderer's gsplat 'frame:ready' (once per renderer). A string: tsx
 * would wrap a function in __name. Counts frames, ready/loading flips, and keeps the last 8 states.
 */
const ATTACH = `(() => {
    const h = window.__gsfpv; const r = h && h.session && h.session.renderer;
    if (!r) return false;
    if (r.__probe) return true;
    const p = { frames: 0, readyFlips: 0, loadingFlips: 0, readyFrames: 0, maxLoading: 0, last: null, tail: [] };
    r.__probe = p;
    r.app.systems.gsplat.on('frame:ready', (_c, _l, ready, loading) => {
        p.frames++;
        if (ready) p.readyFrames++;
        if (loading > p.maxLoading) p.maxLoading = loading;
        if (p.last) { if (p.last.ready !== ready) p.readyFlips++; if (p.last.loading !== loading) p.loadingFlips++; }
        p.last = { ready, loading };
        p.tail.push((ready ? 'R' : 'r') + loading); if (p.tail.length > 8) p.tail.shift();
    });
    return true;
})()`;

/** The card and the engine now. */
const SAMPLE = `(() => {
    const h = window.__gsfpv || {};
    const card = document.querySelector('[data-testid=loading]');
    const txt = (sel) => { const e = card && card.querySelector(sel); return e ? e.textContent : null; };
    const out = {
        status: h.status, errorCode: h.errorCode || null, loading: h.loading || null, sceneSwitch: h.sceneSwitch || null,
        card: card ? { stage: card.dataset.stage, actions: card.hasAttribute('data-actions'), title: txt('.load-stage'), nums: txt('.load-nums'), parts: txt('.load-parts'), hint: txt('.load-hint') } : null
    };
    const s = h.session; const r = s && s.renderer;
    if (!r) return out;
    const comp = r.splat && r.splat.gsplat;
    const eng = { splatFrame: Object.assign({}, r.splatFrame), frameNumber: r.frameNumber, drawn: r.app.stats.frame.gsplats, budgetM: r.app.scene.gsplat.splatBudget / 1e6,
        stochastic: r.app.scene.gsplat.stochastic === true, range: comp ? [comp.lodRangeMin, comp.lodRangeMax] : null, visibleMs: s.timings.visibleMs, probe: r.__probe ? { ...r.__probe, tail: r.__probe.tail.join(' ') } : null };
    const insts = [];
    try { const dir = r.app.renderer.gsplatDirector;
    if (dir) dir.camerasMap.forEach((cd) => cd.layersMap.forEach((ld) => {
        const w = ld.gsplatManager && ld.gsplatManager.world;
        if (!w) return;
        eng.world = { current: w._currentVersion, last: w._lastWorldStateVersion, awaitingLod: w._awaitingLodUpdate, pendingLoadCount: w.pendingLoadCount };
        if (w._octreeInstances) w._octreeInstances.forEach((inst) => {
            const perLevel = {};
            inst.nodeInfos.forEach((ni) => { if (ni.currentLod >= 0) perLevel[ni.currentLod] = (perLevel[ni.currentLod] || 0) + 1; });
            insts.push({ pending: inst.pending.size, prefetch: inst.prefetchPending.size, env: inst.octree.environmentUrl || null, envPlaced: !!inst.environmentPlacement, nodesPerLevel: perLevel });
        });
    }));
    } catch (e) { eng.engineError = String(e); } // mid-switch: the old octree is being unloaded
    eng.octrees = insts;
    out.engine = eng;
    return out;
})()`;

async function revealOf(page: Page, label: string, t0: number, isSwitch: boolean): Promise<Any> {
    const samples: Any[] = [];
    let revealedAt: number | null = null;
    let attached = false;
    while (Date.now() - t0 < LIMIT_S * 1000) {
        if (!attached) attached = (await page.evaluate(ATTACH).catch(() => false)) as boolean;
        const x: Any = await page.evaluate(SAMPLE).catch((e) => ({ evalError: String(e) }));
        const t = Date.now() - t0;
        samples.push({ t, ...x });
        const done = isSwitch ? x.sceneSwitch?.state === 'done' || x.sceneSwitch?.state === 'failed' : x.engine?.visibleMs != null || x.status === 'error';
        if (done) { revealedAt = t; break; }
        await page.waitForTimeout(250);
    }
    // stage timeline: when each stage began, and the hints seen
    const stages: Record<string, number> = {};
    const hints = new Set<string>();
    for (const s of samples) {
        const st = s.loading?.stage ?? s.card?.stage;
        if (st && stages[st] === undefined) stages[st] = s.t;
        if (s.card?.hint) hints.add(s.card.hint.replace(/\d+/g, 'N'));
    }
    const last = samples[samples.length - 1];
    console.log(`${label}: revealed ${revealedAt === null ? 'NO' : `${(revealedAt / 1000).toFixed(1)} s`} stages ${JSON.stringify(stages)} engine ${JSON.stringify(last?.engine?.probe ?? null)} world ${JSON.stringify(last?.engine?.world ?? null)} octrees ${JSON.stringify(last?.engine?.octrees ?? null)}`);
    return { label, revealedMs: revealedAt, stages, hints: [...hints], last, samples: samples.filter((_, i) => i % 4 === 0 || i === samples.length - 1) };
}

async function newPage(browser: Browser): Promise<{ page: Page; log: string[]; close: () => Promise<void> }> {
    const ctx = await browser.newContext(process.env.VIEW === '4k' ? { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 } : { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    await ctx.route('**/api/e', (r) => r.fulfill({ status: 204, body: '' }));
    await ctx.addInitScript('window.__name = window.__name || ((f) => f);');
    const page = await ctx.newPage();
    const log: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') log.push(`${m.type()}: ${m.text()}`.slice(0, 300)); });
    page.on('pageerror', (e) => log.push(`pageerror: ${e.message}`.slice(0, 300)));
    return { page, log, close: () => ctx.close() };
}

const flyUrl = (id: string, extra = ''): string => `${SITE}/en/fly/?scene=${id}&nowarn=1&input=touch${extra}`;

const results: Any[] = [];
const { browser, which } = await launchChrome({ headless: false, args: ['--window-position=40,40', '--window-size=1296,920'] });
console.log(`target ${SITE} browser ${which.kind} ${which.version}`);
try {
    for (const c of CASES) {
        const [kind, a, b] = c.split(':');
        const { page, log, close } = await newPage(browser);
        try {
            if (kind === 'link') {
                const t0 = Date.now();
                await page.goto(flyUrl(a, b ? `&${c.split(':').slice(2).join(':')}` : ''));
                results.push({ case: c, ...(await revealOf(page, c, t0, false)), log: log.slice(0, 20) });
            } else if (kind === 'revisit') {
                for (const pass of ['cold', 'warm']) {
                    const t0 = Date.now();
                    await page.goto(flyUrl(a));
                    results.push({ case: `${c}:${pass}`, ...(await revealOf(page, `${c}:${pass}`, t0, false)), log: log.slice(0, 20) });
                }
            } else if (kind === 'switch') {
                const t0 = Date.now();
                await page.goto(flyUrl(a));
                const first = await revealOf(page, `${c}:first`, t0, false);
                await page.waitForTimeout(1000 * Number(c.split(':')[3] ?? 3));
                const t1 = Date.now();
                await page.evaluate(`window.__gsfpv.scenes.load(${JSON.stringify(b)}, 'pick')`);
                results.push({ case: c, first: { revealedMs: first.revealedMs }, ...(await revealOf(page, c, t1, true)), log: log.slice(0, 20) });
            } else if (kind === 'export') {
                // the parked drone's life for <b> s (5), then "Save this flight as video" at 1080p
                const t0 = Date.now();
                await page.goto(flyUrl(a));
                const first = await revealOf(page, `${c}:load`, t0, false);
                await page.waitForTimeout(1000 * Number(b ?? 5));
                // not awaited in the page (evaluate would wait for the whole export): sampled below
                await page.evaluate(`(window.__vx = null, void window.__gsfpv.videoExport.run({ size: '1080p' }).then((r) => { window.__vx = r; }), 0)`);
                const t1 = Date.now();
                const samples: Any[] = [];
                let result: Any = null;
                while (Date.now() - t1 < LIMIT_S * 1000) {
                    await page.waitForTimeout(1000);
                    result = await page.evaluate('window.__vx');
                    const x: Any = await page.evaluate(`({ st: window.__gsfpv.videoExport.state(), bar: (document.querySelector('[data-testid=video-export-status]') || {}).textContent || null, eng: ${SAMPLE}.engine || null })`);
                    samples.push({ t: Date.now() - t1, k: x.st.k, frames: x.st.frames, waited: x.st.waited, bar: x.bar, splatFrame: x.eng?.splatFrame, octrees: x.eng?.octrees, budgetM: x.eng?.budgetM, range: x.eng?.range, drawn: x.eng?.drawn });
                    if (result) break;
                }
                const last = samples[samples.length - 1];
                console.log(`${c}: export ${result ? `${result.ended} ${result.encoded}/${result.frames} in ${((Date.now() - t1) / 1000).toFixed(0)} s error=${result.error ?? ''}` : `still running after ${LIMIT_S} s: frame ${last?.k}/${last?.frames}, waited ${last?.waited}, bar "${last?.bar}", engine ${JSON.stringify(last?.splatFrame)} ${JSON.stringify(last?.octrees)}`}`);
                if (!result) await page.evaluate('window.__gsfpv.videoExport.cancel()').catch(() => undefined);
                results.push({ case: c, load: { revealedMs: first.revealedMs }, result, samples, log: log.slice(0, 20) });
            } else throw new Error(`unknown case ${c}`);
        } finally {
            await close();
        }
    }
} finally {
    await browser.close();
}
writeEvidence('v09-load-probe', { site: SITE, limitS: LIMIT_S, cases: results });
