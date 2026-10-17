// v0.9 lane R, step 3 (the owner's item 13): what stochastic drawing costs against sorted on this PC, to
// choose the desktop default budget from numbers, and whether the quality governor holds it on the owner's
// 4K monitor at 30 Hz. Draws the scan: run it under the GPU lock (C:/dev/.gpu-lock) in a visible window.
//   MODE=cost  per scene and resolution, per (drawing, budget): GPU time per frame with the camera turning
//              60 deg/s (the sorted drawing re-sorts every frame), governor off so both draw the same budget.
//              The drawing and the budget come from the link (?budget=B&stochastic / &stochastic=0).
//   MODE=gov   the page as a pilot opens it (no parameters or a stated drawing), governor ON, the camera
//              moving on a circle for SECONDS: does the governor lower the budget / render scale (a cascade)?
//   SITE=http://127.0.0.1:5391 SCENES=ba7aa29d,2f1ddf5f BUDGETS=4,8 RES=3840x2160 REPEATS=2 MODE=cost npx tsx src/v09-r-cost.ts
//   RES=window uses the window as it is (VIEW=1280x800@1 by default).
// Evidence: evidence/<date>/v09-r-<MODE>-<TAG>.json
import { mkdirSync, rmdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { launchChrome, waitReady } from './browser';
import { REPO, today } from './evidence';

const SITE = (process.env.SITE ?? 'http://127.0.0.1:5391').replace(/\/$/, '');
const MODE = process.env.MODE ?? 'cost';
const SCENES = (process.env.SCENES ?? 'ba7aa29d,2f1ddf5f').split(',');
const BUDGETS = (process.env.BUDGETS ?? '4,8').split(',').map(Number);
const RES = process.env.RES ?? '3840x2160';
const REPEATS = Number(process.env.REPEATS ?? 2);
const SECONDS = Number(process.env.SECONDS ?? 10);
const TAG = process.env.TAG ?? (RES === 'window' ? 'window' : RES);
const GOV_QS = process.env.GOV_QS ?? ''; // MODE=gov: extra query, e.g. "drawing=sorted"
const LOCK = 'C:/dev/.gpu-lock';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

for (;;) {
    try { mkdirSync(LOCK); break; } catch { console.log('waiting for the GPU lock'); await sleep(15000); }
}
const release = (): void => { try { rmdirSync(LOCK); } catch { /* gone */ } };
process.on('SIGINT', () => { release(); process.exit(130); });

const vm = /^(\d+)x(\d+)@([\d.]+)$/.exec(process.env.VIEW ?? '1280x800@1')!;
const { browser, which } = await launchChrome({ headless: false, args: ['--window-position=0,0', '--window-size=2600,1500'] });
const runs: Any[] = [];
const hook = <T = Any>(p: Page, body: string): Promise<T> => p.evaluate(`(() => { const h = window.__gsfpv; const s = h.session; ${body} })()`) as Promise<T>;
const q = (a: number[], x: number): number | null => { if (!a.length) return null; const s = [...a].sort((u, v) => u - v); return Math.round(s[Math.min(s.length - 1, Math.floor(x * (s.length - 1)))] * 100) / 100; };

try {
    const ctx = await browser.newContext({ viewport: { width: Number(vm[1]), height: Number(vm[2]) }, deviceScaleFactor: Number(vm[3]) });
    await ctx.route('**/api/e', (r) => r.fulfill({ status: 204, body: '' }));
    await ctx.addInitScript('window.__name = window.__name || ((f) => f);');
    const page = await ctx.newPage();
    const res = /^(\d+)x(\d+)$/.exec(RES);

    /** Open a scene by query and wait until it is ready and its levels of detail are in place (or 60 s). */
    async function open(qs: string): Promise<{ ok: boolean; settledMs: number; state: Any }> {
        const t0 = Date.now();
        await page.goto(`${SITE}/en/fly/?${qs}&nowarn=1&input=touch`);
        const r = await waitReady(page, 240000);
        if (r.status !== 'ready') return { ok: false, settledMs: Date.now() - t0, state: r };
        if (res) await hook(page, `s.renderer.setFixedResolution({ w: ${res[1]}, h: ${res[2]} }); return 0;`);
        while (Date.now() - t0 < 60000 && !(await hook<boolean>(page, 'return s.renderer.sceneComplete;'))) await sleep(500);
        return { ok: true, settledMs: Date.now() - t0, state: null };
    }

    const STATE = `const g = s.renderer.app.scene.gsplat; const l = h.lod ? h.lod() : null; return { engineStochastic: g.stochastic === true, budgetM: g.splatBudget / 1e6, top: h.governor ? h.governor.topBudgetMillions : null, step: h.governor ? h.governor.step : null, changes: h.governor ? h.governor.changes : null, scale: s.renderer.renderScale, canvas: [s.renderer.canvas.width, s.renderer.canvas.height], drawnM: l ? Math.round(l.drawn / 1e5) / 10 : null, from: h.drawing ? h.drawing.from : null, search: location.search };`;

    if (MODE === 'cost') {
        for (const scene of SCENES) {
            // alternate the drawings so a drifting GPU clock hits both: s B4, st B4, s B8, st B8, then again
            for (let rep = 0; rep < REPEATS; rep++) {
                for (const B of BUDGETS) {
                    for (const mode of ['sorted', 'stochastic'] as const) {
                        const qs = `scene=${scene}&budget=${B}&stochastic${mode === 'sorted' ? '=0' : ''}&governor=0`;
                        const o = await open(qs);
                        if (!o.ok) { runs.push({ scene, mode, budgetM: B, rep, qs, error: o.state }); console.log('cost', scene, mode, B, 'not ready', JSON.stringify(o.state)); continue; }
                        // the camera turns 60 deg/s around its spawn point; the sim is paused
                        await hook(page, `s.pause(true, 'bake'); s.cameraOverride = true;
                            const c = s.renderer.camera.getPosition(); const p = [c.x, c.y, c.z]; const t0 = performance.now();
                            window.__turn = () => { const a = (performance.now() - t0) / 1000 * Math.PI / 3; s.renderer.setCameraLookAt(p[0], p[1], p[2], p[0] + Math.sin(a), p[1] - 0.1, p[2] - Math.cos(a)); };
                            s.renderer.app.on('update', window.__turn); window.__frames = []; window.__gpuT = [];
                            const prof = s.renderer.device.gpuProfiler; if (prof) prof.enabled = true;
                            s.renderer.app.on('frameend', () => { window.__frames.push(performance.now()); const t = prof && prof.frameTime; if (typeof t === 'number') window.__gpuT.push(t); });
                            return 0;`);
                        await sleep(3000);
                        await hook(page, 'window.__frames.length = 0; window.__gpuT.length = 0; return 0;');
                        const held0 = await hook<number>(page, 'return s.renderer.framesHeld;');
                        const done: number[] = [];
                        for (let i = 0; i < SECONDS; i++) { await sleep(1000); done.push(...await hook<number[]>(page, 'return [...s.renderer.submitDone];')); }
                        const fr = await hook<number[]>(page, 'return window.__frames.slice();');
                        const gpuT = await hook<number[]>(page, 'return window.__gpuT.slice();');
                        const held = (await hook<number>(page, 'return s.renderer.framesHeld;')) - held0;
                        const st = await hook(page, STATE);
                        const row = { scene, mode, budgetM: B, rep, res: RES, settledMs: o.settledMs, sceneComplete: await hook(page, 'return s.renderer.sceneComplete;'), gpuProfilerMs: { n: gpuT.length, p50: q(gpuT, 0.5), p95: q(gpuT, 0.95) }, submitToDoneMs: { n: done.length, p50: q(done, 0.5), p95: q(done, 0.95) }, drawnHz: fr.length > 1 ? Math.round((fr.length - 1) * 10000 / (fr[fr.length - 1] - fr[0])) / 10 : null, framesHeld: held, state: st };
                        runs.push(row);
                        console.log('cost', scene, mode, B, JSON.stringify({ gpu: row.gpuProfilerMs, done: row.submitToDoneMs, hz: row.drawnHz, held, drawnM: st.drawnM, stoch: st.engineStochastic }));
                    }
                }
            }
        }
    } else {
        // MODE=gov: governor on, the camera orbits (moves AND turns), budgets as a pilot gets them
        for (const scene of SCENES) {
            for (let rep = 0; rep < REPEATS; rep++) {
                const o = await open(`scene=${scene}${GOV_QS ? '&' + GOV_QS : ''}`);
                if (!o.ok) { runs.push({ scene, rep, error: o.state }); continue; }
                await hook(page, `s.pause(true, 'bake'); s.cameraOverride = true;
                    const c = s.renderer.camera.getPosition(); const p = [c.x, c.y, c.z]; const t0 = performance.now();
                    window.__turn = () => { const t = (performance.now() - t0) / 1000; const a = t * Math.PI / 4; s.renderer.setCameraLookAt(p[0] + 3 * Math.sin(a * 0.7), p[1], p[2] + 3 * (1 - Math.cos(a * 0.7)), p[0] + 3 * Math.sin(a * 0.7) + Math.sin(a), p[1] - 0.1, p[2] + 3 * (1 - Math.cos(a * 0.7)) - Math.cos(a)); };
                    s.renderer.app.on('update', window.__turn); return 0;`);
                const timeline: Any[] = [];
                for (let t = 0; t < SECONDS; t += 2) { await sleep(2000); timeline.push(await hook(page, STATE)); }
                const first = timeline[0], last = timeline[timeline.length - 1];
                const row = { scene, rep, query: GOV_QS, res: RES, settledMs: o.settledMs, firstStep: first.step, lastStep: last.step, maxStep: Math.max(...timeline.map((x: Any) => x.step)), changes: last.changes, lowestBudgetM: Math.min(...timeline.map((x: Any) => x.budgetM)), lowestScale: Math.min(...timeline.map((x: Any) => x.scale)), top: last.top, engineStochastic: last.engineStochastic, timeline: timeline.map((x: Any) => [x.step, x.budgetM, x.scale, x.drawnM]) };
                runs.push(row);
                console.log('gov', scene, GOV_QS || '(default)', JSON.stringify({ top: row.top, stoch: row.engineStochastic, changes: row.changes, maxStep: row.maxStep, lowestBudgetM: row.lowestBudgetM, lowestScale: row.lowestScale }));
            }
        }
    }
    await ctx.close();
} finally {
    await browser.close().catch(() => undefined);
    release();
}
const out = join(REPO, 'evidence', today(), `v09-r-${MODE}-${TAG}${process.env.TAG_EXTRA ? '-' + process.env.TAG_EXTRA : ''}.json`);
mkdirSync(join(REPO, 'evidence', today()), { recursive: true });
writeFileSync(out, JSON.stringify({ site: SITE, mode: MODE, browser: which, scenes: SCENES, budgets: BUDGETS, res: RES, view: process.env.VIEW ?? '1280x800@1', repeats: REPEATS, seconds: SECONDS, runs }, null, 2));
console.log('written', out);
