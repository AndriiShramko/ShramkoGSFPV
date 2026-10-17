// v0.9 lane R, step 4 (the owner's item 13, and the question "how does a recording look with stochastic
// drawing?"): stochastic drawing leaves a fine grain that the engine does not smooth over time. A video
// encoder spends its bits on grain and the viewer sees it. This measures it on the recorder's own settings:
// one deterministic camera path through a scan, drawn sorted (the clean reference S), stochastic (T), and
// stochastic accumulated from M jittered sub-frames per output frame (A); each encoded with WebCodecs H.264
// at bitrateFor(w, h, fps) = w x h x fps x 0.1 (apps/fly/src/cinema.ts) and decoded again.
//   bytes        what the encoder produced for the same bitrate setting
//   psnr(S, T)   raw grain: how far a stochastic frame is from the clean sorted frame of the same view
//   psnr(S, dec) the clean video as the viewer gets it (the codec alone)
//   psnr(S, decT) and psnr(S, decA): the video as the viewer gets it, stochastic and accumulated
// Draws the scan: run it under the GPU lock (C:/dev/.gpu-lock) in a visible window.
//   SITE=http://127.0.0.1:5391 SCENES=39e63ce9,ba7aa29d FRAMES=72 SUB=4 npx tsx src/v09-r-recording.ts
// Evidence: evidence/<date>/v09-r-recording.json
import { mkdirSync, rmdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { launchChrome, waitReady } from './browser';
import { REPO, today } from './evidence';

const SITE = (process.env.SITE ?? 'http://127.0.0.1:5391').replace(/\/$/, '');
const SCENES = (process.env.SCENES ?? '39e63ce9,ba7aa29d').split(',');
const FRAMES = Number(process.env.FRAMES ?? 72);
const SUB = Number(process.env.SUB ?? 4);
const W = Number(process.env.W ?? 1280);
const H = Number(process.env.H ?? 720);
const BUDGET = Number(process.env.BUDGET ?? 4);
const LOCK = 'C:/dev/.gpu-lock';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

for (;;) {
    try { mkdirSync(LOCK); break; } catch { console.log('waiting for the GPU lock'); await sleep(15000); }
}
const release = (): void => { try { rmdirSync(LOCK); } catch { /* gone */ } };
process.on('SIGINT', () => { release(); process.exit(130); });

/** The whole experiment, run in the page (a string: tsx would wrap a function with helpers the page lacks). */
const EXPERIMENT = `(async (FRAMES, SUB, W, H, BUDGET) => {
  const h = window.__gsfpv; const s = h.session; const r = s.renderer; const app = r.app; const canvas = r.canvas;
  s.pause(true, 'bake'); s.cameraOverride = true;
  r.setFixedResolution({ w: W, h: H });
  r.setSplatBudgetMillions(BUDGET);
  const c0 = r.camera.getPosition(); const p0 = [c0.x, c0.y, c0.z];
  // the recorder's own bitrate rule (cinema.ts bitrateFor) and a 60 fps timeline
  const bitrate = Math.round(W * H * 60 * 0.1);
  const pose = (k) => { const a = k * 0.02; const px = p0[0] + 1.5 * Math.sin(0.5 * a * 3); const pz = p0[2] + 1.5 * (1 - Math.cos(0.5 * a * 3)); r.setCameraLookAt(px, p0[1], pz, px + Math.sin(a), p0[1] - 0.1, pz - Math.cos(a)); };
  const comp = new OffscreenCanvas(W, H); const cctx = comp.getContext('2d', { willReadFrequently: true });
  const nextEnd = () => new Promise((res) => app.once('frameend', res));
  const luma = (d) => { const o = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) o[i] = (0.299 * d[4 * i] + 0.587 * d[4 * i + 1] + 0.114 * d[4 * i + 2]) | 0; return o; };
  const psnr = (a, b) => { let e = 0; for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; e += d * d; } e /= a.length; return e === 0 ? 99 : 10 * Math.log10(255 * 255 / e); };
  // draw the frame as the camera sees it NOW and hand back its pixels (inside the frame's own end event)
  const grab = () => new Promise((res) => app.once('frameend', () => { cctx.drawImage(canvas, 0, 0, W, H); res(cctx.getImageData(0, 0, W, H).data); }));
  const settle = async (n) => { for (let i = 0; i < n; i++) await nextEnd(); };

  async function pass(stochastic, jitter, sub, encode) {
    // the frame intervals right after the switch: does flipping the drawing hitch (a new shader variant)?
    const stamps = []; const stamp = () => stamps.push(performance.now()); app.on('frameend', stamp);
    r.setStochastic(stochastic);
    r.camera.camera.jitter = jitter ? 1 : 0;
    pose(0); await settle(12);
    app.off('frameend', stamp);
    const switchIntervalsMs = stamps.slice(1, 11).map((t, i) => Math.round((t - stamps[i]) * 10) / 10);
    const lumas = []; const chunks = []; let bytes = 0; let encErr = null;
    let enc = null;
    if (encode) {
      enc = new VideoEncoder({ output: (c) => { chunks.push(c); bytes += c.byteLength; }, error: (e) => { encErr = String(e); } });
      enc.configure({ codec: 'avc1.640033', width: W, height: H, bitrate, framerate: 60, latencyMode: 'quality', avc: { format: 'annexb' } });
    }
    for (let k = 0; k < FRAMES; k++) {
      pose(k);
      await nextEnd(); // the pose reaches a frame, the next one shows it
      const sum = new Float32Array(W * H * 4);
      for (let m = 0; m < sub; m++) {
        const d = await grab();
        for (let i = 0; i < sum.length; i++) sum[i] += d[i];
      }
      const avg = new Uint8ClampedArray(W * H * 4);
      for (let i = 0; i < avg.length; i++) avg[i] = sum[i] / sub;
      cctx.putImageData(new ImageData(avg, W, H), 0, 0);
      lumas.push(luma(avg));
      if (enc) {
        // encode the SAME pixels the luma was taken from: the real RGB, averaged over the sub-frames when accumulating
        const vf = new VideoFrame(comp, { timestamp: Math.round(k * 1e6 / 60) });
        enc.encode(vf, { keyFrame: k % 30 === 0 }); vf.close();
      }
    }
    let decoded = null;
    if (enc) {
      await enc.flush();
      decoded = [];
      const dec = new VideoDecoder({ output: (f) => { cctx.drawImage(f, 0, 0, W, H); decoded.push(luma(cctx.getImageData(0, 0, W, H).data)); f.close(); }, error: (e) => { encErr = String(e); } });
      dec.configure({ codec: 'avc1.640033', optimizeForLatency: true });
      for (const c of chunks) dec.decode(c);
      await dec.flush();
    }
    r.camera.camera.jitter = 0;
    return { lumas, bytes, decoded, encErr, chunks: chunks.length, switchIntervalsMs };
  }

  const S = await pass(false, false, 1, true);
  const T = await pass(true, false, 1, true);
  const A = await pass(true, true, SUB, true);
  const T2 = await pass(true, false, 1, false);
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const minp = (a) => Math.min(...a);
  const each = (X, Y) => X.lumas.map((l, k) => psnr(l, Y.lumas[k]));
  const dec = (Ref, X) => (X.decoded && X.decoded.length === Ref.lumas.length) ? Ref.lumas.map((l, k) => psnr(l, X.decoded[k])) : null;
  const row = (a) => a ? { mean: Math.round(mean(a) * 100) / 100, min: Math.round(minp(a) * 100) / 100 } : null;
  return {
    frames: FRAMES, size: [W, H], bitrate, sub: SUB, budgetM: BUDGET,
    bytes: { sorted: S.bytes, stochastic: T.bytes, accumulated: A.bytes }, chunks: { sorted: S.chunks, stochastic: T.chunks, accumulated: A.chunks },
    decodedFrames: { sorted: S.decoded && S.decoded.length, stochastic: T.decoded && T.decoded.length, accumulated: A.decoded && A.decoded.length },
    errors: [S.encErr, T.encErr, A.encErr].filter(Boolean),
    // frame intervals (ms) of the first frames after switching to each drawing (display period ~33 ms): a hitch shows as a long one
    switchIntervalsMs: { toSorted: S.switchIntervalsMs, toStochastic: T.switchIntervalsMs, toAccumulated: A.switchIntervalsMs, toStochasticAgain: T2.switchIntervalsMs },
    // the same stochastic view twice: is the grain stable (static pattern) frame to frame?
    psnr_T_vs_T_again: row(each(T, T2)),
    // grain alone: stochastic and accumulated against the clean sorted frame of the same view
    psnr_S_vs_T: row(each(S, T)), psnr_S_vs_A: row(each(S, A)),
    // as the viewer gets it: the clean video (the codec alone), the stochastic video, the accumulated video, all against the clean source
    psnr_S_vs_decS: row(dec(S, S)), psnr_S_vs_decT: row(dec(S, T)), psnr_S_vs_decA: row(dec(S, A)),
    // how well each encode keeps ITS OWN source (what the encoder was asked to preserve)
    psnr_own: { sorted: row(dec(S, S)), stochastic: row(dec(T, T)), accumulated: row(dec(A, A)) }
  };
})(${FRAMES}, ${SUB}, ${W}, ${H}, ${BUDGET})`;

const results: Record<string, Any> = {};
const { browser, which } = await launchChrome({ headless: false, args: ['--window-position=0,0', '--window-size=1400,1000'] });
try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    await ctx.route('**/api/e', (r) => r.fulfill({ status: 204, body: '' }));
    await ctx.addInitScript('window.__name = window.__name || ((f) => f);');
    const page: Page = await ctx.newPage();
    const log: string[] = [];
    page.on('console', (m) => log.push(`${m.type()}: ${m.text()}`.slice(0, 240)));
    page.on('pageerror', (e) => log.push(`pageerror: ${e.message}`.slice(0, 240)));
    for (const scene of SCENES) {
        await page.goto(`${SITE}/en/fly/?scene=${scene}&governor=0&nowarn=1&input=touch`);
        const ready = await waitReady(page, 240000);
        if (ready.status !== 'ready') { results[scene] = { error: ready }; continue; }
        const t0 = Date.now();
        while (Date.now() - t0 < 60000 && !(await page.evaluate('window.__gsfpv.session.renderer.sceneComplete'))) await sleep(500);
        try {
            results[scene] = await page.evaluate(EXPERIMENT);
            console.log(scene, JSON.stringify(results[scene]).slice(0, 900));
        } catch (e) {
            results[scene] = { error: String(e), log: log.slice(-6) };
            console.log(scene, 'failed', String(e).slice(0, 300));
        }
    }
    await ctx.close();
} finally {
    await browser.close().catch(() => undefined);
    release();
}
const out = join(REPO, 'evidence', today(), 'v09-r-recording.json');
mkdirSync(join(REPO, 'evidence', today()), { recursive: true });
writeFileSync(out, JSON.stringify({ site: SITE, browser: which, results }, null, 2));
console.log('written', out);
