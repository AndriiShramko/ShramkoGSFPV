// v0.10 lane R, step A: what does a bigger splat budget buy, in picture and in bytes? The owner asked: keep 4 M or raise
// to 8 M "(65 % more traffic)". Sorted drawing, the page opened with ?budget=B (a cold browser context each time, so the
// bytes are what a pilot downloads), four views from the spawn (yaw 0/90/180/270) after the scan is in place; each
// budget's picture is scored against the highest budget's picture of the same view (PSNR and SSIM on luma; the
// reference is the best this tool can draw: REF M). Also: splats drawn, bytes of every response, GPU frame time.
// A scan smaller than the budget cannot gain anything: drawn stays below the budget, bytes and picture equal.
// Draws the scan: run it under the GPU lock (C:/dev/.gpu-lock) in a visible window.
//   SITE=http://localhost:5493 SCENES=7a475d38,ba7aa29d,2f1ddf5f BUDGETS=2,4,8,16 npx tsx src/v10-r-budget.ts
// Evidence: evidence/<date>/v10-r-budget.json
import { mkdirSync, rmdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchChrome, waitReady } from './browser';
import { REPO, today } from './evidence';

const SITE = (process.env.SITE ?? 'http://127.0.0.1:5493').replace(/\/$/, '');
const SCENES = (process.env.SCENES ?? '7a475d38,ba7aa29d,2f1ddf5f').split(',');
const BUDGETS = (process.env.BUDGETS ?? '2,4,8,16').split(',').map(Number);
const W = 1280, H = 720;
const TAG = process.env.TAG ?? '';
const LOCK = 'C:/dev/.gpu-lock';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

for (;;) {
    try { mkdirSync(LOCK); break; } catch { console.log('waiting for the GPU lock'); await sleep(Number(process.env.LOCK_POLL_MS ?? 3000)); }
}
const release = (): void => { try { rmdirSync(LOCK); } catch { /* gone */ } };
process.on('SIGINT', () => { release(); process.exit(130); });

// grabs the four views as luma arrays kept in the page under window.__views[budget]; scored later against the reference
const GRAB = `(async (W, H) => {
  const h = window.__gsfpv; const s = h.session; const r = s.renderer; const app = r.app; const canvas = r.canvas;
  s.pause(true, 'bake'); s.cameraOverride = true;
  r.setFixedResolution({ w: W, h: H });
  r.setStochastic(false);
  const c0 = r.camera.getPosition(); const p0 = [c0.x, c0.y, c0.z];
  const comp = new OffscreenCanvas(W, H); const cctx = comp.getContext('2d', { willReadFrequently: true });
  const nextEnd = () => new Promise((res) => app.once('frameend', res));
  const settle = async (n) => { for (let i = 0; i < n; i++) await nextEnd(); };
  const grab = () => new Promise((res) => app.once('frameend', () => { cctx.drawImage(canvas, 0, 0, W, H); res(cctx.getImageData(0, 0, W, H).data); }));
  const luma = (d) => { const o = new Float32Array(W * H); for (let i = 0; i < W * H; i++) o[i] = 0.299 * d[4 * i] + 0.587 * d[4 * i + 1] + 0.114 * d[4 * i + 2]; return o; };
  const stable = async () => { let ok = 0; for (let i = 0; i < 360 && ok < 10; i++) { await nextEnd(); ok = (r.splatFrame && r.splatFrame.loading === 0) ? ok + 1 : 0; } return ok >= 10; };
  const prof = r.device.gpuProfiler; if (prof) prof.enabled = true;
  const gpu = [];
  app.on('frameend', () => { const t = prof && prof.frameTime; if (typeof t === 'number') gpu.push(t); });
  const views = [];
  let stableAll = true;
  for (const yaw of [0, 90, 180, 270]) {
    const a = yaw * Math.PI / 180; r.setCameraLookAt(p0[0], p0[1], p0[2], p0[0] + Math.sin(a), p0[1] - 0.1, p0[2] - Math.cos(a));
    await settle(10); stableAll = (await stable()) && stableAll;
    gpu.length = 0; await settle(20);
    views.push(luma(await grab()));
  }
  (window.__views = window.__views || {})[location.search] = views;
  const sorted = gpu.slice().sort((x, y) => x - y);
  const l = h.lod ? h.lod() : null;
  return { drawnM: l ? Math.round(l.drawn / 1e5) / 10 : null, complete: r.sceneComplete, stable: stableAll, gpuMsP50: sorted.length ? Math.round(sorted[Math.floor(sorted.length / 2)] * 100) / 100 : null };
})(${W}, ${H})`;

const out: Record<string, Any> = { site: SITE, size: [W, H], budgets: BUDGETS, ref: Math.max(...BUDGETS), scenes: {} };
const { browser, which } = await launchChrome({ headless: false, args: ['--window-position=0,0', '--window-size=1400,1000'] });
try {
    for (const scene of SCENES) {
        const rows: Any[] = [];
        const lumas: Record<number, number[][]> = {};
        for (const B of BUDGETS) {
            const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
            await ctx.route('**/api/e', (r) => r.fulfill({ status: 204, body: '' }));
            await ctx.addInitScript('window.__name = window.__name || ((f) => f);');
            const page = await ctx.newPage();
            let bytes = 0;
            page.on('response', async (res) => { try { const b = await res.body(); bytes += b.length; } catch { /* a redirect or a cancelled request has no body */ } });
            const t0 = Date.now();
            await page.goto(`${SITE}/en/fly/?scene=${scene}&budget=${B}&stochastic=0&governor=0&nowarn=1&input=touch`);
            const ready = await waitReady(page, 240000);
            if (ready.status !== 'ready') { rows.push({ budgetM: B, error: ready }); await ctx.close(); continue; }
            while (Date.now() - t0 < 120000 && !(await page.evaluate('window.__gsfpv.session.renderer.sceneComplete'))) await sleep(500);
            await sleep(3000);
            try {
                const g = (await page.evaluate(GRAB)) as Any;
                // keep the four luma arrays of this budget as plain numbers outside the page (about 3.7 MB each as Float32 -> JSON is big; score inside the page of the NEXT run instead)
                const views = (await page.evaluate('Object.values(window.__views)[0].map((v) => Array.from(v, (x) => Math.round(x)))')) as number[][];
                lumas[B] = views;
                rows.push({ budgetM: B, bytesMB: Math.round(bytes / 1048576 * 10) / 10, loadedMs: Date.now() - t0, ...g });
                console.log(scene, B, JSON.stringify(rows[rows.length - 1]));
            } catch (e) {
                rows.push({ budgetM: B, error: String(e).slice(0, 300) });
            }
            await ctx.close();
        }
        // score each budget against the reference budget, here in Node (luma arrays of W*H numbers)
        const ref = lumas[Math.max(...BUDGETS)];
        for (const row of rows) {
            const v = lumas[row.budgetM];
            if (!v || !ref) continue;
            const psnr = (a: number[], b: number[]) => { let e = 0; for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; e += d * d; } e /= a.length; return e === 0 ? 99 : 10 * Math.log10(255 * 255 / e); };
            const ssim = (a: number[], b: number[]) => {
                const C1 = 6.5025, C2 = 58.5225; let sum = 0, n = 0;
                for (let y = 0; y + 8 <= H; y += 4) for (let x = 0; x + 8 <= W; x += 4) {
                    let ma = 0, mb = 0, aa = 0, bb = 0, ab = 0;
                    for (let j = 0; j < 8; j++) { const o = (y + j) * W + x; for (let i = 0; i < 8; i++) { const u = a[o + i], q = b[o + i]; ma += u; mb += q; aa += u * u; bb += q * q; ab += u * q; } }
                    ma /= 64; mb /= 64; const va = aa / 64 - ma * ma, vb = bb / 64 - mb * mb, cv = ab / 64 - ma * mb;
                    sum += ((2 * ma * mb + C1) * (2 * cv + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2)); n++;
                }
                return sum / n;
            };
            const p = v.map((x, i) => psnr(ref[i], x)), q = v.map((x, i) => ssim(ref[i], x));
            row.vsRef = { psnrMean: Math.round(p.reduce((a, b) => a + b, 0) / p.length * 100) / 100, psnrMin: Math.round(Math.min(...p) * 100) / 100, ssimMean: Math.round(q.reduce((a, b) => a + b, 0) / q.length * 1000) / 1000 };
            console.log(scene, row.budgetM, 'vs', out.ref, JSON.stringify(row.vsRef));
        }
        out.scenes[scene] = rows;
    }
} finally {
    await browser.close().catch(() => undefined);
    release();
}
out.browser = which;
mkdirSync(join(REPO, 'evidence', today()), { recursive: true });
writeFileSync(join(REPO, 'evidence', today(), `v10-r-budget${TAG ? '-' + TAG : ''}.json`), JSON.stringify(out, null, 2));
console.log('written');
