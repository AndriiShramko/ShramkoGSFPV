// v0.11 lane S, stage 3: what the accumulating stochastic drawing costs against sorted and against the engine's own dither on
// this PC (visible Chrome, strict CSP), and what switching costs. Draws the scan: GPU lock C:/dev/.gpu-lock (taken here).
//   C1  frame cost: per scene, resolution, budget and arm (S sorted, E engine dither, A accumulating) a cold page, the camera
//       turning 60 deg/s for SECONDS, governor off: the engine's GPU profiler (frame time and per pass, compute passes included),
//       the queue-drain time (submit -> GPU done), drawn Hz, frames held. The page is fixed to RES by setFixedResolution.
//   C2  memory: the engine's own VRAM counters (texture, storage, vertex) of a fresh sorted page, the same page after switching to A,
//       and a fresh A page; the renderer's own buffers (accumStats().gpuBytes).
//   C3  switch cost: 10 round trips S -> A -> S in one page: the frame intervals around each switch (worst, p50), whether history is
//       rebuilt (taaActive after), the frames until the scan reports complete again.
//   C4  load: time to first frame and the page's load timings, A against S (cold pages).
//   SITE=http://127.0.0.1:5611 SCENES=39e63ce9,ba7aa29d,2f1ddf5f BUDGETS=4 RES=1280x720,3840x2160 MODES=c1,c2,c3,c4 npx tsx src/v11-s-cost.ts
// Evidence: evidence/<date>/v11-s-cost-<TAG>.json
import { mkdirSync, rmdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { launchChrome, waitReady } from './browser';
import { REPO, today } from './evidence';

const SITE = (process.env.SITE ?? 'http://127.0.0.1:5611').replace(/\/$/, '');
const SCENES = (process.env.SCENES ?? '39e63ce9,ba7aa29d,2f1ddf5f').split(',');
const BUDGETS = (process.env.BUDGETS ?? '4').split(',').map(Number);
const RESS = (process.env.RES ?? '1280x720,3840x2160').split(',');
const MODES = (process.env.MODES ?? 'c1,c2,c3,c4').split(',');
const ARMS = (process.env.ARMS ?? 'S,E,A').split(',');
const REPEATS = Number(process.env.REPEATS ?? 1);
const SECONDS = Number(process.env.SECONDS ?? 10);
const TAG = process.env.TAG ?? 'main';
const LOCK = 'C:/dev/.gpu-lock';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

for (;;) {
    try { mkdirSync(LOCK); break; } catch { console.log('waiting for the GPU lock'); await sleep(Number(process.env.LOCK_POLL_MS ?? 3000)); }
}
const release = (): void => { try { rmdirSync(LOCK); } catch { /* gone */ } };
process.on('SIGINT', () => { release(); process.exit(130); });

const GPU_ERRORS = `(() => {
  window.__gpuErrors = [];
  const ra = navigator.gpu.requestAdapter.bind(navigator.gpu);
  navigator.gpu.requestAdapter = async (o) => {
    const a = await ra(o); if (!a) return a;
    const rd = a.requestDevice.bind(a);
    a.requestDevice = async (d) => { const dev = await rd(d); dev.lost.then((i) => { window.__lost = i.reason + ' ' + String(i.message).slice(0, 200); }); dev.addEventListener('uncapturederror', (e) => window.__gpuErrors.push(String(e.error && e.error.message).slice(0, 400))); return dev; };
    return a;
  };
})();`;

const q = (a: number[], x: number): number | null => { if (!a.length) return null; const s = [...a].sort((u, v) => u - v); return Math.round(s[Math.min(s.length - 1, Math.floor(x * (s.length - 1)))] * 100) / 100; };
const hook = <T = Any>(p: Page, body: string): Promise<T> => p.evaluate(`(() => { const h = window.__gsfpv; const s = h.session; ${body} })()`) as Promise<T>;
const ARM_QS: Record<string, string> = { S: 'stochastic=0', E: 'stochastic&impl=engine', A: 'stochastic&impl=accum' };

const VRAM = `const v = s.renderer.device._vram; const m = (x) => Math.round(x / 1048576 * 10) / 10; return v ? { tex: m(v.tex), sb: m(v.sb), vb: m(v.vb), ib: m(v.ib), ub: m(v.ub), total: m(v.tex + v.sb + v.vb + v.ib + v.ub) } : null;`;
const STATE = `const r = s.renderer; const l = h.lod ? h.lod() : null; return { drawn: r.drawn, plan: r.plan, budgetM: r.splatBudgetMillions, canvas: [r.canvas.width, r.canvas.height], drawnM: l ? Math.round(l.drawn / 1e5) / 10 : null, accum: r.accumStats(), timings: s.timings ? { ...s.timings } : null, gpuErrors: window.__gpuErrors || [], limit: (() => { const l2 = r.device.wgpu && r.device.wgpu.limits; return l2 ? { maxStorageBufferBindingSize: l2.maxStorageBufferBindingSize, maxBufferSize: l2.maxBufferSize } : null; })() };`;

const runs: Any[] = [];
const { browser, which } = await launchChrome({ headless: false, args: ['--window-position=0,0', '--window-size=1400,1000'] });
try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    await ctx.route('**/api/e', (r) => r.fulfill({ status: 204, body: '' }));
    await ctx.addInitScript('window.__name = window.__name || ((f) => f);');
    await ctx.addInitScript(GPU_ERRORS);
    const page = await ctx.newPage();

    async function open(qs: string, res: string | null): Promise<{ ok: boolean; settledMs: number; error?: Any }> {
        const t0 = Date.now();
        await page.goto(`${SITE}/en/fly/?${qs}&governor=0&nowarn=1&input=touch`);
        const r = await waitReady(page, 240000);
        if (r.status !== 'ready') return { ok: false, settledMs: Date.now() - t0, error: r };
        const m = res ? /^(\d+)x(\d+)$/.exec(res) : null;
        if (m) await hook(page, `s.renderer.setFixedResolution({ w: ${m[1]}, h: ${m[2]} }); return 0;`);
        while (Date.now() - t0 < 90000 && !(await hook<boolean>(page, 'return s.renderer.sceneComplete;'))) await sleep(500);
        await sleep(1500);
        return { ok: true, settledMs: Date.now() - t0 };
    }
    // the camera turns 60 deg/s around its spawn point; the sim is paused
    const TURN = `s.pause(true, 'bake'); s.cameraOverride = true; s.renderer.maxFramesInFlight = 2;
        const c = s.renderer.camera.getPosition(); const p = [c.x, c.y, c.z]; const t0 = performance.now();
        window.__turn = () => { const a = (performance.now() - t0) / 1000 * Math.PI / 3; s.renderer.setCameraLookAt(p[0], p[1], p[2], p[0] + Math.sin(a), p[1] - 0.1, p[2] - Math.cos(a)); };
        s.renderer.app.on('update', window.__turn); window.__frames = []; window.__gpuT = []; window.__pass = new Map(); window.__passN = 0;
        const prof = s.renderer.device.gpuProfiler; if (prof) prof.enabled = true;
        s.renderer.app.on('frameend', () => { window.__frames.push(performance.now()); const t = prof && prof.frameTime; if (typeof t === 'number') { window.__gpuT.push(t); window.__passN++; for (const [k, v] of prof.passTimings) window.__pass.set(k, (window.__pass.get(k) || 0) + v); } });
        return 0;`;

    if (MODES.includes('c1') || MODES.includes('c2') || MODES.includes('c4')) {
        for (const scene of SCENES) for (const res of RESS) for (const B of BUDGETS) for (let rep = 0; rep < REPEATS; rep++) {
            // alternate the arms inside one (scene, res, budget, rep) so a drifting clock hits all of them
            for (const arm of ARMS) {
                const qs = `scene=${scene}&budget=${B}&${ARM_QS[arm]}`;
                const o = await open(qs, res);
                const key = { scene, res, budgetM: B, arm, rep };
                if (!o.ok) { runs.push({ ...key, error: o.error }); console.log('c1', JSON.stringify(key), 'not ready'); continue; }
                const vram0 = await hook(page, VRAM);
                await hook(page, TURN);
                await sleep(3000);
                await hook(page, 'window.__frames.length = 0; window.__gpuT.length = 0; window.__pass.clear(); window.__passN = 0; return 0;');
                const held0 = await hook<number>(page, 'return s.renderer.framesHeld;');
                const done: number[] = [];
                for (let i = 0; i < SECONDS; i++) { await sleep(1000); done.push(...await hook<number[]>(page, 'return [...s.renderer.submitDone];')); }
                const fr = await hook<number[]>(page, 'return window.__frames.slice();');
                const gpuT = await hook<number[]>(page, 'return window.__gpuT.slice();');
                const pass = await hook<Record<string, number>>(page, 'const o = {}; for (const [k, v] of window.__pass) o[k] = Math.round(v / Math.max(1, window.__passN) * 1000) / 1000; return o;');
                const held = (await hook<number>(page, 'return s.renderer.framesHeld;')) - held0;
                const st = await hook<Any>(page, STATE);
                const vram1 = await hook(page, VRAM);
                const row = {
                    ...key, settledMs: o.settledMs, sceneComplete: await hook(page, 'return s.renderer.sceneComplete;'),
                    gpuProfilerMs: { n: gpuT.length, p50: q(gpuT, 0.5), p95: q(gpuT, 0.95) }, passMs: pass, submitToDoneMs: { n: done.length, p50: q(done, 0.5), p95: q(done, 0.95) },
                    drawnHz: fr.length > 1 ? Math.round((fr.length - 1) * 10000 / (fr[fr.length - 1] - fr[0])) / 10 : null, framesHeld: held,
                    vramMiB: { atLoad: vram0, afterRun: vram1 }, state: st
                };
                runs.push(row);
                console.log('c1', JSON.stringify(key), JSON.stringify({ gpu: row.gpuProfilerMs, done: row.submitToDoneMs, hz: row.drawnHz, held, drawnM: st.drawnM, drawn: st.drawn, vram: vram1 && (vram1 as Any).total, loadMs: st.timings && st.timings.firstFrameMs, err: st.gpuErrors.length }));
            }
        }
    }

    if (MODES.includes('c3')) {
        for (const scene of SCENES) {
            const o = await open(`scene=${scene}&budget=${BUDGETS[0]}&stochastic=0`, RESS[0]);
            if (!o.ok) { runs.push({ c3: true, scene, error: o.error }); continue; }
            const res = await hook<Any>(page, `
                const r = s.renderer; const app = r.app; s.pause(true, 'bake'); s.cameraOverride = true; r.maxFramesInFlight = 2;
                const c = r.camera.getPosition(); r.setCameraLookAt(c.x, c.y, c.z, c.x, c.y - 0.1, c.z - 1);
                return (async () => {
                  const ts = []; app.on('frameend', () => ts.push(performance.now()));
                  const wait = async (n) => { const t = ts.length; while (ts.length < t + n) await new Promise((x) => setTimeout(x, 5)); };
                  const intervals = (from, n) => { const o = []; for (let i = from + 1; i < Math.min(ts.length, from + n); i++) o.push(ts[i] - ts[i - 1]); return o; };
                  await wait(30);
                  const base = intervals(ts.length - 30, 30);
                  const trips = [];
                  const vramBefore = r.device._vram ? r.device._vram.tex + r.device._vram.sb + r.device._vram.vb + r.device._vram.ib + r.device._vram.ub : 0;
                  for (let i = 0; i < 10; i++) {
                    const a0 = ts.length; r.setStochastic(true); await wait(40); const toA = intervals(a0, 41);
                    const taa = r.accumStats() ? r.accumStats().taaActive : null;
                    const b0 = ts.length; r.setStochastic(false); await wait(40); const toS = intervals(b0, 41);
                    trips.push({ toA: { worst: Math.max(...toA), p50: toA.slice().sort((x, y) => x - y)[Math.floor(toA.length / 2)] }, toS: { worst: Math.max(...toS), p50: toS.slice().sort((x, y) => x - y)[Math.floor(toS.length / 2)] }, taaAfterSwitch: taa, drawnAfterToA: null });
                  }
                  const vramAfter = r.device._vram ? r.device._vram.tex + r.device._vram.sb + r.device._vram.vb + r.device._vram.ib + r.device._vram.ub : 0;
                  return { baseline: { p50: base.slice().sort((x, y) => x - y)[Math.floor(base.length / 2)], worst: Math.max(...base) }, trips, vramDeltaMiB: Math.round((vramAfter - vramBefore) / 1048576 * 10) / 10, gpuErrors: window.__gpuErrors || [], drawnEnd: r.drawn };
                })();`);
            runs.push({ c3: true, scene, res: RESS[0], budgetM: BUDGETS[0], ...res });
            const w = (res.trips as Any[]);
            console.log('c3', scene, JSON.stringify({ baseline: res.baseline, worstToA: Math.max(...w.map((t) => t.toA.worst)), worstToS: Math.max(...w.map((t) => t.toS.worst)), p50ToA: q(w.map((t) => t.toA.p50), 0.5), vramDelta: res.vramDeltaMiB, gpuErrors: res.gpuErrors.length, drawnEnd: res.drawnEnd }));
        }
    }
    await ctx.close();
} finally {
    await browser.close().catch(() => undefined);
    release();
}
mkdirSync(join(REPO, 'evidence', today()), { recursive: true });
const file = join(REPO, 'evidence', today(), `v11-s-cost-${TAG}.json`);
writeFileSync(file, JSON.stringify({ site: SITE, browser: which, scenes: SCENES, budgets: BUDGETS, res: RESS, arms: ARMS, repeats: REPEATS, seconds: SECONDS, runs }, null, 2));
console.log('written', file);
