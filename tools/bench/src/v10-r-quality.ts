// v0.10 lane R, step A (the owner's item 4: "why is the quality so bad in a small room with stochastic?"): the
// same view of a scan drawn sorted and stochastic, scored against the sorted picture.
//   - still camera, four views (yaw 0/90/180/270 deg from the spawn): PSNR and SSIM of one stochastic frame
//     (the page as it is: noise pattern frozen on the screen, camera.jitter 0) and of one with the engine's
//     temporal jitter (a new noise pattern every frame) against the sorted frame of the same view;
//   - convergence: the mean of N jittered stochastic frames against the mean of N jittered sorted frames. If it
//     climbs to a high PSNR the stochastic picture is the right picture plus noise (variance, not bias), and the
//     error of a single frame is the sampling: one coverage test per pixel and splat, nothing averaged over time;
//   - moving camera (the pose changes every frame, about 70 deg/s at 60 Hz): PSNR/SSIM per frame against the
//     sorted frame of the same pose, and flicker = how much consecutive frames differ (mean absolute luma
//     difference), stochastic minus sorted;
//   - the budget (4 and 8 M) and what is drawn (drawnM): a small scan is below both budgets.
// 1:1 crops of the worst tile of each view go to evidence/<date>/v10-r-quality/ as PNG, with a whole-frame JPEG.
// Draws the scan: run it under the GPU lock (C:/dev/.gpu-lock) in a visible window.
//   SITE=http://localhost:5470 SCENES=39e63ce9,7a475d38,224aba38,ba7aa29d,2f1ddf5f BUDGETS=4,8 npx tsx src/v10-r-quality.ts
// Evidence: evidence/<date>/v10-r-quality.json (+ the folder of pictures).
import { mkdirSync, rmdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchChrome, waitReady } from './browser';
import { REPO, today } from './evidence';

const SITE = (process.env.SITE ?? 'http://127.0.0.1:5470').replace(/\/$/, '');
const SCENES = (process.env.SCENES ?? '39e63ce9,7a475d38,224aba38,ba7aa29d,2f1ddf5f').split(',');
const BUDGETS = (process.env.BUDGETS ?? '4,8').split(',').map(Number);
const W = Number(process.env.W ?? 1280);
const H = Number(process.env.H ?? 720);
const FRAMES = Number(process.env.FRAMES ?? 48);
const AVG = Number(process.env.AVG ?? 64);
const PICS = process.env.PICS !== '0';
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

/** The whole experiment on one loaded scene, run in the page (a string: tsx would wrap a function with helpers the page lacks). */
const EXPERIMENT = `(async (W, H, FRAMES, AVG, PICS) => {
  const h = window.__gsfpv; const s = h.session; const r = s.renderer; const app = r.app; const canvas = r.canvas;
  s.pause(true, 'bake'); s.cameraOverride = true;
  r.setFixedResolution({ w: W, h: H });
  const c0 = r.camera.getPosition(); const p0 = [c0.x, c0.y, c0.z];
  const comp = new OffscreenCanvas(W, H); const cctx = comp.getContext('2d', { willReadFrequently: true });
  const nextEnd = () => new Promise((res) => app.once('frameend', res));
  const settle = async (n) => { for (let i = 0; i < n; i++) await nextEnd(); };
  const grab = () => new Promise((res) => app.once('frameend', () => { cctx.drawImage(canvas, 0, 0, W, H); res(new Uint8ClampedArray(cctx.getImageData(0, 0, W, H).data)); }));
  const luma = (d) => { const o = new Float32Array(W * H); for (let i = 0; i < W * H; i++) o[i] = 0.299 * d[4 * i] + 0.587 * d[4 * i + 1] + 0.114 * d[4 * i + 2]; return o; };
  const psnr = (a, b) => { let e = 0; for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; e += d * d; } e /= a.length; return e === 0 ? 99 : 10 * Math.log10(255 * 255 / e); };
  const mad = (a, b) => { let e = 0; for (let i = 0; i < a.length; i++) e += Math.abs(a[i] - b[i]); return e / a.length; };
  // mean SSIM on luma: 8x8 uniform windows every 4 px, the standard constants (K1 0.01, K2 0.03, L 255)
  const ssim = (a, b) => {
    const C1 = 6.5025, C2 = 58.5225; let sum = 0, n = 0;
    for (let y = 0; y + 8 <= H; y += 4) for (let x = 0; x + 8 <= W; x += 4) {
      let ma = 0, mb = 0, aa = 0, bb = 0, ab = 0;
      for (let j = 0; j < 8; j++) { const o = (y + j) * W + x; for (let i = 0; i < 8; i++) { const u = a[o + i], v = b[o + i]; ma += u; mb += v; aa += u * u; bb += v * v; ab += u * v; } }
      ma /= 64; mb /= 64; const va = aa / 64 - ma * ma, vb = bb / 64 - mb * mb, cv = ab / 64 - ma * mb;
      sum += ((2 * ma * mb + C1) * (2 * cv + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2)); n++;
    }
    return sum / n;
  };
  const r2 = (x) => Math.round(x * 100) / 100, r3 = (x) => Math.round(x * 1000) / 1000;
  const score = (ref, x) => ({ psnr: r2(psnr(ref, x)), ssim: r3(ssim(ref, x)) });
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const look = (yawDeg, k) => {
    const a = yawDeg * Math.PI / 180; r.setCameraLookAt(p0[0], p0[1], p0[2], p0[0] + Math.sin(a), p0[1] - 0.1, p0[2] - Math.cos(a));
  };
  const path = (k) => { const a = k * 0.02; const px = p0[0] + 1.5 * Math.sin(0.5 * a * 3); const pz = p0[2] + 1.5 * (1 - Math.cos(0.5 * a * 3)); r.setCameraLookAt(px, p0[1], pz, px + Math.sin(a), p0[1] - 0.1, pz - Math.cos(a)); };
  const mode = (stochastic, jitter) => { r.setStochastic(stochastic); r.camera.camera.jitter = jitter ? 1 : 0; };
  // the scan is stable: no level of detail in flight for a few frames
  const stable = async () => { let ok = 0; for (let i = 0; i < 240 && ok < 8; i++) { await nextEnd(); ok = (r.splatFrame && r.splatFrame.loading === 0) ? ok + 1 : 0; } return ok >= 8; };
  const toB64 = async (cv) => { const b = await cv.convertToBlob({ type: 'image/png' }); const u = new Uint8Array(await b.arrayBuffer()); let bin = ''; for (let i = 0; i < u.length; i += 8192) bin += String.fromCharCode.apply(null, u.subarray(i, i + 8192)); return btoa(bin); };
  const toJpg = async (rgba) => { cctx.putImageData(new ImageData(rgba, W, H), 0, 0); const b = await comp.convertToBlob({ type: 'image/jpeg', quality: 0.9 }); const u = new Uint8Array(await b.arrayBuffer()); let bin = ''; for (let i = 0; i < u.length; i += 8192) bin += String.fromCharCode.apply(null, u.subarray(i, i + 8192)); return btoa(bin); };
  const cropPng = async (rgba, x0, y0, cw, ch) => {
    const out = new Uint8ClampedArray(cw * ch * 4);
    for (let y = 0; y < ch; y++) out.set(rgba.subarray(((y0 + y) * W + x0) * 4, ((y0 + y) * W + x0 + cw) * 4), y * cw * 4);
    const oc = new OffscreenCanvas(cw, ch); oc.getContext('2d').putImageData(new ImageData(out, cw, ch), 0, 0); return toB64(oc);
  };
  // worst tile: the 160 x 90 tile (on an 8 x 8 grid) where the stochastic frame differs most from the sorted one
  const worstTile = (ref, x) => {
    const tw = 160, th = 90; let best = -1, bx = 0, by = 0;
    for (let ty = 0; ty < H / th; ty++) for (let tx = 0; tx < W / tw; tx++) {
      let e = 0; for (let y = 0; y < th; y++) { const o = (ty * th + y) * W + tx * tw; for (let i = 0; i < tw; i++) { const d = ref[o + i] - x[o + i]; e += d * d; } }
      if (e > best) { best = e; bx = tx * tw; by = ty * th; }
    }
    return { x: bx, y: by };
  };
  const pics = [];
  const out = { size: [W, H], drawnM: null, sceneComplete: null, still: [], moving: null, converged: [] };
  const lodInfo = () => { const l = h.lod ? h.lod() : null; return l ? Math.round(l.drawn / 1e5) / 10 : null; };
  out.stable = await stable();
  out.sceneComplete = r.sceneComplete;
  out.budgetM = r.splatBudgetMillions;

  // ---- still camera, four views
  for (const yaw of [0, 90, 180, 270]) {
    look(yaw);
    mode(false, false); await settle(10); await stable();
    out.drawnM = lodInfo();
    const S = await grab(); const Sl = luma(S);
    mode(true, false); await settle(6); const T = await grab(); const Tl = luma(T);
    mode(true, true); await settle(6); const Tj = await grab(); const Tjl = luma(Tj);
    const row = { yaw, drawnM: lodInfo(), T: score(Sl, Tl), Tjitter: score(Sl, Tjl) };
    if (PICS) {
      const w = worstTile(Sl, Tl); row.worst = w;
      pics.push({ name: 'yaw' + yaw + '-sorted-crop', b64: await cropPng(S, w.x, w.y, 160, 90) });
      pics.push({ name: 'yaw' + yaw + '-stochastic-crop', b64: await cropPng(T, w.x, w.y, 160, 90) });
      if (yaw === 0) { pics.push({ name: 'yaw0-sorted-full', b64: await toJpg(S), jpg: true }); pics.push({ name: 'yaw0-stochastic-full', b64: await toJpg(T), jpg: true }); }
    }
    out.still.push(row);
  }

  // ---- convergence at the first view: mean of AVG jittered frames, stochastic against sorted (both jittered)
  look(0);
  for (const n of [1, 4, 16, AVG]) {
    const acc = (async (stoch) => { mode(stoch, true); await settle(6); const sum = new Float32Array(W * H * 4); for (let m = 0; m < n; m++) { const d = await grab(); for (let i = 0; i < sum.length; i++) sum[i] += d[i]; } const avg = new Uint8ClampedArray(W * H * 4); for (let i = 0; i < avg.length; i++) avg[i] = sum[i] / n; return avg; });
    const A = await acc(false); const B = await acc(true);
    out.converged.push({ frames: n, ...score(luma(A), luma(B)) });
    if (PICS && n === AVG) pics.push({ name: 'yaw0-stochastic-mean' + n + '-full', b64: await toJpg(B), jpg: true });
  }

  // ---- moving camera: the same poses, three drawings
  const run = async (stoch, jit) => {
    mode(stoch, jit); path(0); await settle(10); await stable();
    const fr = [];
    for (let k = 0; k < FRAMES; k++) { path(k); await nextEnd(); fr.push(luma(await grab())); }
    return fr;
  };
  // the pose reaches a frame, the next one shows it (as the recorder bench): grab() takes the one after path(k)
  const S = await run(false, false); const T = await run(true, false); const Tj = await run(true, true);
  const flick = (fr) => mean(fr.slice(1).map((f, i) => mad(fr[i], f)));
  const vs = (X) => { const p = X.map((f, i) => psnr(S[i], f)), q = X.map((f, i) => ssim(S[i], f)); return { psnrMean: r2(mean(p)), psnrMin: r2(Math.min(...p)), ssimMean: r3(mean(q)), ssimMin: r3(Math.min(...q)) }; };
  out.moving = { frames: FRAMES, T: vs(T), Tjitter: vs(Tj), flicker: { sorted: r2(flick(S)), stochastic: r2(flick(T)), stochasticJitter: r2(flick(Tj)) } };
  r.camera.camera.jitter = 0; r.setStochastic(false);
  out.pics = pics;
  return out;
})(${W}, ${H}, ${FRAMES}, ${AVG}, ${PICS})`;

const ADAPTER = `(async () => {
  const o = { deviceMemory: navigator.deviceMemory ?? null, cores: navigator.hardwareConcurrency, dpr: devicePixelRatio, touch: navigator.maxTouchPoints, screen: [screen.width, screen.height], ua: navigator.userAgent.slice(0, 120), uaMobile: navigator.userAgentData ? navigator.userAgentData.mobile : null, coarse: matchMedia('(pointer: coarse)').matches };
  try {
    const a = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    const i = a.info || (a.requestAdapterInfo ? await a.requestAdapterInfo() : {});
    o.adapter = { vendor: i.vendor, architecture: i.architecture, device: i.device, description: i.description, isFallback: a.isFallbackAdapter, features: [...a.features].length,
      limits: { maxBufferSize: a.limits.maxBufferSize, maxStorageBufferBindingSize: a.limits.maxStorageBufferBindingSize, maxTextureDimension2D: a.limits.maxTextureDimension2D, maxComputeInvocationsPerWorkgroup: a.limits.maxComputeInvocationsPerWorkgroup } };
  } catch (e) { o.adapterError = String(e); }
  return o;
})()`;

const out: Record<string, Any> = { site: SITE, size: [W, H], frames: FRAMES, avg: AVG, scenes: {} };
const picDir = join(REPO, 'evidence', today(), 'v10-r-quality' + (TAG ? '-' + TAG : ''));
const { browser, which } = await launchChrome({ headless: false, args: ['--window-position=0,0', '--window-size=1400,1000'] });
try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    await ctx.route('**/api/e', (r) => r.fulfill({ status: 204, body: '' }));
    await ctx.addInitScript('window.__name = window.__name || ((f) => f);');
    const page = await ctx.newPage();
    await page.goto(`${SITE}/en/fly/?nowarn=1`);
    out.device = await page.evaluate(ADAPTER);
    console.log('device', JSON.stringify(out.device).slice(0, 600));
    for (const scene of SCENES) {
        for (const B of BUDGETS) {
            const key = `${scene}@${B}M`;
            const t0 = Date.now();
            await page.goto(`${SITE}/en/fly/?scene=${scene}&budget=${B}&stochastic=0&governor=0&nowarn=1&input=touch`);
            const ready = await waitReady(page, 240000);
            if (ready.status !== 'ready') { out.scenes[key] = { error: ready }; console.log(key, 'not ready'); continue; }
            while (Date.now() - t0 < 90000 && !(await page.evaluate('window.__gsfpv.session.renderer.sceneComplete'))) await sleep(500);
            await sleep(2000);
            try {
                const res = (await page.evaluate(EXPERIMENT)) as Any;
                const pics = res.pics as { name: string; b64: string; jpg?: boolean }[];
                delete res.pics;
                if (PICS && B === BUDGETS[0]) {
                    mkdirSync(picDir, { recursive: true });
                    for (const p of pics) writeFileSync(join(picDir, `${scene}-${p.name}.${p.jpg ? 'jpg' : 'png'}`), Buffer.from(p.b64, 'base64'));
                }
                out.scenes[key] = { loadedMs: Date.now() - t0, ...res };
                const st = res.still;
                const avgp = (k: string, f: string) => Math.round(st.reduce((a: number, x: Any) => a + x[k][f], 0) / st.length * 100) / 100;
                console.log(key, JSON.stringify({ drawnM: res.drawnM, complete: res.sceneComplete, stillT: { psnr: avgp('T', 'psnr'), ssim: avgp('T', 'ssim') }, stillTj: { psnr: avgp('Tjitter', 'psnr'), ssim: avgp('Tjitter', 'ssim') }, conv: res.converged.map((c: Any) => `${c.frames}:${c.psnr}`), moving: res.moving }));
            } catch (e) {
                out.scenes[key] = { error: String(e).slice(0, 400) };
                console.log(key, 'failed', String(e).slice(0, 300));
            }
        }
    }
    await ctx.close();
} finally {
    await browser.close().catch(() => undefined);
    release();
}
out.browser = which;
mkdirSync(join(REPO, 'evidence', today()), { recursive: true });
const file = join(REPO, 'evidence', today(), `v10-r-quality${TAG ? '-' + TAG : ''}.json`);
writeFileSync(file, JSON.stringify(out, null, 2));
console.log('written', file);
