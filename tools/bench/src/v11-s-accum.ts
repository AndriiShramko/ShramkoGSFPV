// v0.11 lane S, stage 3: the accumulating stochastic drawing (the vendored SuperSplat renderer) against sorted and the
// engine's own dither, in OUR page on this PC (visible Chrome, strict CSP, 1280x720 at 1:1 like v10-r so the numbers compare).
// The experiment itself is tools/bench/src/v11-s-page.js (plain browser JS, evaluated in the page); this file drives it:
// per scene a cold page, LOD settled, then the modes asked for.
//   q1  still convergence: 4 views, A after 1..256 frames, E, A0 (taa:off), S against S           (PSNR/SSIM on luma, colour shift)
//   q2  cruise (v10-r's path, ~70 deg/s, 48 frames): per-frame PSNR/SSIM against S at the same pose, flicker
//   q3  FPV-agile (360 deg/s, +-60 deg roll, 6 m/s) at the 60 Hz step and at double the step (30 Hz); AN = the no-clamp control
//   q4  flip (180 deg in 12 frames) and stop (64 frames): PSNR after the stop, lag index, ghost pixels, frames to 30/33 dB
//   q5  hover (0.5 px sinusoid): flicker and per-pixel temporal standard deviation
//   k1  colour at 256 frames per tone map, and the control (a wrong output transform)
//   k2  composition: a mesh at five depths, the background colour, the scene scale
// The harness control (v10-r's engine numbers must reproduce) is computed here from evidence/2026-10-20/v10-r-quality.json.
// Draws the scan: GPU lock C:/dev/.gpu-lock (taken here, waited for in-process).
//   SITE=http://127.0.0.1:5611 SCENES=39e63ce9 MODES=q1,q2,q3,q4,q5,k1,k2 BUDGET=4 npx tsx src/v11-s-accum.ts   (from tools/bench)
// Evidence: evidence/<date>/v11-s-accum-<TAG>.json and the 1:1 crops in evidence/<date>/v11-s-accum-<TAG>/
import { existsSync, mkdirSync, readFileSync, rmdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchChrome, waitReady } from './browser';
import { REPO, today } from './evidence';

const SITE = (process.env.SITE ?? 'http://127.0.0.1:5611').replace(/\/$/, '');
const SCENES = (process.env.SCENES ?? '39e63ce9').split(',');
const MODES = (process.env.MODES ?? 'q1,q2,q3,q4,q5,k1,k2').split(',');
const BUDGET = Number(process.env.BUDGET ?? 4);
const W = Number(process.env.W ?? 1280);
const H = Number(process.env.H ?? 720);
const FRAMES = Number(process.env.FRAMES ?? 48);
const PICS = process.env.PICS !== '0';
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

const PAGE = readFileSync(join(REPO, 'tools', 'bench', 'src', 'v11-s-page.js'), 'utf8');
const GPU_ERRORS = `(() => {
  window.__gpuErrors = [];
  const ra = navigator.gpu.requestAdapter.bind(navigator.gpu);
  navigator.gpu.requestAdapter = async (o) => {
    const a = await ra(o); if (!a) return a;
    const rd = a.requestDevice.bind(a);
    a.requestDevice = async (d) => { const dev = await rd(d); dev.addEventListener('uncapturederror', (e) => window.__gpuErrors.push(String(e.error && e.error.message).slice(0, 400))); return dev; };
    return a;
  };
})();`;

const out: Record<string, Any> = { site: SITE, size: [W, H], budgetM: BUDGET, modes: MODES, frames: FRAMES, scenes: {} };
const picDir = join(REPO, 'evidence', today(), `v11-s-accum-${TAG}`);
const { browser, which } = await launchChrome({ headless: false, args: ['--window-position=0,0', '--window-size=1400,1000'] });
try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    await ctx.route('**/api/e', (r) => r.fulfill({ status: 204, body: '' }));
    await ctx.addInitScript('window.__name = window.__name || ((f) => f);');
    await ctx.addInitScript(GPU_ERRORS);
    const page = await ctx.newPage();
    const lines: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') lines.push(m.text().slice(0, 300)); });
    page.on('pageerror', (e) => lines.push(`pageerror: ${e.message}`.slice(0, 300)));
    for (const scene of SCENES) {
        const t0 = Date.now();
        lines.length = 0;
        await page.goto(`${SITE}/en/fly/?scene=${scene}&budget=${BUDGET}&stochastic=0&governor=0&nowarn=1&input=touch`);
        const ready = await waitReady(page, 240000);
        if (ready.status !== 'ready') { out.scenes[scene] = { error: ready }; console.log(scene, 'not ready'); continue; }
        while (Date.now() - t0 < 90000 && !(await page.evaluate('window.__gsfpv.session.renderer.sceneComplete'))) await sleep(500);
        await sleep(2000);
        try {
            const res = (await page.evaluate(`(${PAGE})(${JSON.stringify({ W, H, frames: FRAMES, pics: PICS, modes: MODES })})`)) as Any;
            const pics = res.pics as { name: string; b64: string; jpg?: boolean }[];
            delete res.pics;
            if (PICS && pics.length) {
                mkdirSync(picDir, { recursive: true });
                for (const p of pics) writeFileSync(join(picDir, `${scene}-${p.name}.${p.jpg ? 'jpg' : 'png'}`), Buffer.from(p.b64, 'base64'));
            }
            out.scenes[scene] = { loadedMs: Date.now() - t0, consoleErrors: lines.slice(0, 10), ...res };
            const q1 = res.q1 as Any[] | undefined;
            const avg = (f: (r: Any) => number) => q1 ? Math.round(q1.reduce((a, r) => a + f(r), 0) / q1.length * 100) / 100 : null;
            console.log(scene, JSON.stringify({
                drawnM: res.drawnM, timings: res.timingsMs,
                q1: q1 && { S_S: avg((r) => r.SvS.psnr), E: avg((r) => r.E.psnr), A1: avg((r) => r.A[1].psnr), A16: avg((r) => r.A[16].psnr), A64: avg((r) => r.A[64].psnr), A256: avg((r) => r.A[256].psnr), to30: q1.map((r) => r.framesTo30dB) },
                q2: res.q2 && { E: res.q2.E.psnrMean, A: res.q2.A.psnrMean, A0: res.q2.A0.psnrMean, flickS: res.q2.S.flicker, flickE: res.q2.E.flicker, flickA: res.q2.A.flicker },
                q3: res.q3 && { s1A: res.q3.step1.A.psnrMean, s1E: res.q3.step1.E.psnrMean, s2A: res.q3.step2.A.psnrMean, s2E: res.q3.step2.E.psnrMean },
                q4: res.q4 && { A: res.q4.A.after, lead: res.q4.A.lead, ghostA: res.q4.A.ghost48, ghostE: res.q4.E.ghost48, ghostAN: res.q4.AN.ghost48 },
                k1: res.k1, k2: res.k2, gpuErrors: res.gpuErrors.length
            }));
        } catch (e) {
            out.scenes[scene] = { error: String(e).slice(0, 600) };
            console.log(scene, 'failed', String(e).slice(0, 400));
        }
    }
    await ctx.close();
} finally {
    await browser.close().catch(() => undefined);
    release();
}
out.browser = which;
// the harness control: the engine arm must reproduce v10-r's numbers (same page, same views, same budget) within 0.5 dB
const v10 = join(REPO, 'evidence', '2026-10-20', 'v10-r-quality.json');
if (existsSync(v10)) {
    const old = JSON.parse(readFileSync(v10, 'utf8')).scenes as Record<string, Any>;
    out.controlE = {};
    for (const scene of SCENES) {
        const mine = out.scenes[scene], theirs = old[`${scene}@${BUDGET}M`];
        if (!mine?.q1 || !theirs) continue;
        const m = mine.q1.map((r: Any) => r.E.psnr), t = theirs.still.map((r: Any) => r.T.psnr);
        const mm = m.reduce((a: number, b: number) => a + b, 0) / m.length, tt = t.reduce((a: number, b: number) => a + b, 0) / t.length;
        out.controlE[scene] = { stillMeanMine: Math.round(mm * 100) / 100, stillMeanV10r: Math.round(tt * 100) / 100, diffDb: Math.round((mm - tt) * 100) / 100, movingMine: mine.q2?.E?.psnrMean ?? null, movingV10r: theirs.moving?.T?.psnrMean ?? null };
    }
    console.log('control E vs v10-r', JSON.stringify(out.controlE));
}
mkdirSync(join(REPO, 'evidence', today()), { recursive: true });
const file = join(REPO, 'evidence', today(), `v11-s-accum-${TAG}.json`);
writeFileSync(file, JSON.stringify(out, null, 2));
console.log('written', file);
