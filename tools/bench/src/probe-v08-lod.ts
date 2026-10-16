// v0.8 lane C (the owner's item 8): how a streamed scan with levels of detail is really drawn in the page.
// One run opens one scene on one release and records, from the engine itself:
//   - what was loaded: the content file (lod-meta.json or meta.json), the levels the scan has, the LOD range;
//   - the drawing: the engine's splat budget, the governor's step and render scale, splats drawn;
//   - the levels in use: splats drawn per level of detail (each octree node's current level, the engine's
//     own GSplatOctreeInstance.nodeInfos; read-only, for measuring only) and the files fetched per level;
//   - the cost: bytes downloaded, JS heap, the engine's GPU memory count, frames per second, time to the
//     first frame and to the reveal (session.timings), and a screenshot.
// The octree instances are read through renderer.gsplatDirector -> camerasMap -> layersMap ->
// gsplatManager.world._octreeInstances (engine 2.23 internals, read-only, for measuring only).
// Draws the scan: run it under the GPU lock (C:/dev/.gpu-lock). It measures; the pass/fail rules of the
// lane live in accept-v08-lod.ts.
//   SITE=http://127.0.0.1:5381 LABEL=before npx tsx src/probe-v08-lod.ts [scene]
// Options: PHONE=1 (a phone's user agent, touch and viewport), SETTLE_S (seconds sampled after the reveal,
// default 20), QS (more query, e.g. "&governor=0"). Evidence: evidence/<date>/v08-lod-probe-<label>.json and .png.
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import type { Page } from 'playwright';
import { launchChrome, waitReady } from './browser';
import { writeEvidence, REPO, today } from './evidence';

const SITE = (process.env.SITE ?? 'http://127.0.0.1:5381').replace(/\/$/, '');
const LABEL = process.env.LABEL ?? 'run';
const SCENE = process.argv[2] ?? 'ba7aa29d';
const PHONE = process.env.PHONE === '1';
const SETTLE_S = Number(process.env.SETTLE_S ?? 20);
const QS = process.env.QS ?? '';
const PHONE_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

/**
 * The page's state in one object (a string: tsx would wrap a function in __name). Reads the engine's
 * octree instances (see the header).
 */
const STATE = `(() => {
    const h = window.__gsfpv; const s = h && h.session; const r = s && s.renderer; const a = r && r.app;
    if (!a) return { status: h ? h.status : 'none' };
    const g = a.scene.gsplat;
    const comp = r.splat && r.splat.gsplat;
    const oct = comp && comp.resource && comp.resource.octree;
    const perLevel = {}; let nodes = 0; let unloaded = 0;
    const dir = a.renderer.gsplatDirector;
    const dbg = { director: !!dir, cameras: dir ? dir.camerasMap.size : -1, layers: 0, managers: 0, managerKeys: '' };
    if (dir) dir.camerasMap.forEach((cd) => cd.layersMap.forEach((ld) => {
        dbg.layers++;
        const mg = ld.gsplatManager; const m = mg && mg.world;
        if (m) { dbg.managers++; dbg.managerKeys = Object.keys(m).filter((k) => /octree|instance/i.test(k)).join(','); }
        if (!m || !m._octreeInstances) return;
        m._octreeInstances.forEach((inst) => {
            inst.nodeInfos.forEach((ni, i) => {
                nodes++;
                const l = ni.currentLod;
                if (l < 0) { unloaded++; return; }
                const c = inst.octree.nodes[i].lods[l]; const n = c ? c.count : 0;
                perLevel[l] = (perLevel[l] || 0) + n;
            });
        });
    }));
    const vram = a.graphicsDevice._vram || {};
    let vramBytes = 0; for (const k in vram) if (typeof vram[k] === 'number' && k !== 'total') vramBytes += vram[k];
    const gov = h.governor;
    return {
        status: h.status, error: h.error || null,
        contentKind: s.scene.contentKind, contentUrl: s.scene.contentUrl, lod: typeof h.lod === 'function' ? h.lod() : null,
        detailLine: (document.querySelector('[data-testid=detail-line]') || {}).textContent || null,
        lodLevels: oct ? oct.lodLevels : null, rangeMin: comp ? comp.lodRangeMin : null, rangeMax: comp ? comp.lodRangeMax : null,
        budgetM: g.splatBudget / 1e6, budgetMode: g.splatBudgetMode, stochastic: g.stochastic === true, rendererKind: g.currentRenderer,
        governorStep: gov ? gov.step : null, governorTopM: gov ? gov.topBudgetMillions : null, governorChanges: gov ? gov.changes : null,
        governorPeriodMs: gov ? Math.round(gov.displayPeriodMs * 10) / 10 : null, governorHitches: gov ? gov.streamHitches : null,
        renderScale: r.renderScale, backbuffer: [a.graphicsDevice.width, a.graphicsDevice.height],
        drawn: a.stats.frame.gsplats, loading: r.splatFrame.loading, ready: r.splatFrame.ready,
        splatsPerLevel: perLevel, nodes, nodesUnloaded: unloaded, engineDebug: dbg,
        jsHeapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
        vramMB: Math.round(vramBytes / 1048576),
        timings: s.timings, drawing: h.drawing || null, visibility: document.visibilityState, webgpu: r.isWebGPU
    };
})()`;

/** Frames per second over `ms`, counted with requestAnimationFrame in the page. */
const FPS = (ms: number) => `new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < ${ms}) requestAnimationFrame(f); else res(Math.round(n * 10000 / (performance.now() - t0)) / 10); }; requestAnimationFrame(f); })`;

async function main(): Promise<void> {
    const { browser } = await launchChrome({ headless: false, args: ['--window-position=40,40', '--window-size=1296,920'] });
    const ctx = await browser.newContext(PHONE
        ? { viewport: { width: 412, height: 915 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, userAgent: PHONE_UA }
        : { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    await ctx.route('**/api/e', (r) => r.fulfill({ status: 204, body: '' }));
    await ctx.addInitScript('window.__name = window.__name || ((f) => f);');
    const page: Page = await ctx.newPage();
    const log: string[] = [];
    page.on('console', (m) => log.push(`${m.type()}: ${m.text()}`.slice(0, 300)));
    page.on('pageerror', (e) => log.push(`pageerror: ${e.message}`.slice(0, 300)));
    // bytes per level of detail, from the responses' content-length (the CDN sends no Timing-Allow-Origin)
    const bytes = { total: 0, files: 0, perLevel: {} as Record<string, number>, filesPerLevel: {} as Record<string, number>, content: [] as string[] };
    page.on('response', (resp) => {
        const u = resp.url();
        if (!u.includes(`/${SCENE}/`)) return;
        const n = Number(resp.headers()['content-length'] ?? 0) || 0;
        bytes.total += n;
        bytes.files++;
        const m = u.match(/\/(\d+)_\d+\/[^/]+$/);
        if (m) {
            bytes.perLevel[m[1]] = (bytes.perLevel[m[1]] ?? 0) + n;
            if (u.endsWith('/meta.json')) bytes.filesPerLevel[m[1]] = (bytes.filesPerLevel[m[1]] ?? 0) + 1;
        } else if (/(lod-meta|meta)\.json$|\.ply$/.test(u)) bytes.content.push(u.slice(u.indexOf(`/${SCENE}/`)));
    });
    // per frame from the start: interval, files the streamer still loads, frames held, the governor's step
    await ctx.addInitScript(`window.__lodTrace = []; (function hookTrace() {
        const h = window.__gsfpv; const s = h && h.session; const r = s && s.renderer;
        if (!r) { setTimeout(hookTrace, 50); return; }
        let last = 0;
        r.app.on('frameend', () => {
            const t = performance.now(); const g = h.governor;
            if (window.__lodTrace.length < 20000) window.__lodTrace.push([Math.round(t), last ? Math.round((t - last) * 10) / 10 : 0, r.splatFrame.loading, r.framesHeld, g ? g.step : -1]);
            last = t;
        });
    })();`);
    const t0 = Date.now();
    await page.goto(`${SITE}/en/fly/?scene=${SCENE}&nowarn=1&input=touch${QS}`);
    const ready = await waitReady(page, 240000);
    const tReady = Date.now() - t0;
    let st: Any = await page.evaluate(STATE);
    const tv = Date.now();
    while (Date.now() - tv < 240000 && !(st.timings && st.timings.visibleMs !== null)) {
        await page.waitForTimeout(500);
        st = await page.evaluate(STATE);
    }
    const atReveal = st;
    const samples: Any[] = [];
    for (let i = 0; i < SETTLE_S; i++) {
        await page.waitForTimeout(1000);
        const x: Any = await page.evaluate(STATE);
        samples.push({ s: i + 1, budgetM: x.budgetM, step: x.governorStep, periodMs: x.governorPeriodMs, hitches: x.governorHitches, scale: x.renderScale, drawn: x.drawn, loading: x.loading, perLevel: x.splatsPerLevel, vramMB: x.vramMB, jsHeapMB: x.jsHeapMB });
    }
    const fps = await page.evaluate(FPS(5000));
    const end: Any = await page.evaluate(STATE);
    const trace: number[][] = await page.evaluate('window.__lodTrace || []');
    const dir = join(REPO, 'evidence', today());
    mkdirSync(dir, { recursive: true });
    const shot = join(dir, `v08-lod-probe-${LABEL}.png`);
    await page.screenshot({ path: shot });
    const finest = (o: Record<string, number>) => { const ks = Object.keys(o).map(Number).filter((k) => o[k] > 0); return ks.length ? Math.min(...ks) : null; };
    const summary = {
        site: SITE, label: LABEL, scene: SCENE, phone: PHONE, query: QS,
        readyMs: tReady, status: ready.status, error: ready.error ?? null,
        contentKind: end.contentKind, contentUrl: end.contentUrl, lod: end.lod, lodLevels: end.lodLevels, lodRange: [end.rangeMin, end.rangeMax],
        firstFrameMs: end.timings?.firstFrameMs ?? null, visibleMs: end.timings?.visibleMs ?? null,
        budgetM: end.budgetM, governorStep: end.governorStep, governorTopM: end.governorTopM, governorChanges: end.governorChanges, renderScale: end.renderScale,
        drawn: end.drawn, splatsPerLevel: end.splatsPerLevel, finestLevelInUse: finest(end.splatsPerLevel ?? {}),
        filesPerLevel: bytes.filesPerLevel, bytesPerLevelMB: Object.fromEntries(Object.entries(bytes.perLevel).map(([k, v]) => [k, Math.round(v / 1e5) / 10])),
        downloadedMB: Math.round(bytes.total / 1e5) / 10, filesDownloaded: bytes.files, contentFiles: bytes.content,
        jsHeapMB: end.jsHeapMB, vramMB: end.vramMB, fps, webgpu: end.webgpu, visibility: end.visibility, drawing: end.drawing
    };
    console.log(JSON.stringify(summary, null, 1));
    writeEvidence(`v08-lod-probe-${LABEL}`, { summary, atReveal, samples, end, traceColumns: ['t', 'dtMs', 'loading', 'framesHeld', 'governorStep'], trace, screenshot: shot.slice(REPO.length + 1).split('\\').join('/'), pageerrors: log.filter((l) => l.startsWith('pageerror')), console: log.slice(-40) });
    await browser.close();
}

await main();
