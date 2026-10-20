// v0.10 lane R, step A (root cause): why does a stochastic picture NOT converge to the sorted one when many frames are
// averaged? v10-r-quality.ts found that the mean of 64 jittered stochastic frames of the same view still sits 17 to 24 dB
// from the sorted picture: a systematic difference (fine detail gone, colours pushed), not only noise. The engine's
// dither (playcanvas 2.23.2, shader chunk opacityDitherPS) keeps a fragment when `alpha >= pow(noise, 2.2)`, so a splat
// of opacity a survives with probability a^(1/2.2), more often than a; with several semi-transparent splats over one
// pixel the front ones win far more often than alpha blending lets them, and what is behind them (thin lines, small
// detail, the surface under a haze) is hidden. This tests that claim by swapping only that chunk on the gsplat material
// (the engine's own supported override, Material.getShaderChunks; the material is app.renderer.gsplatDirector.camerasMap -> layersMap -> gsplatManager.renderer.material) and measuring the same views again:
//   engine   the chunk as shipped (pow 2.2 on the blue-noise sample)
//   linear   the same chunk with the pow removed (survive with probability a, the blue noise as is)
// Each is scored against the sorted picture: one frame, and the mean of N frames with the engine's temporal jitter on
// (a new noise pattern per frame). Mean colour is compared too (channel means of the N-frame stochastic against sorted).
// Draws the scan: run it under the GPU lock (C:/dev/.gpu-lock) in a visible window.
//   SITE=http://localhost:5493 SCENES=224aba38,39e63ce9,7a475d38,ba7aa29d npx tsx src/v10-r-dither.ts
// Evidence: evidence/<date>/v10-r-dither.json (+ v10-r-dither/<scene>-<variant>-crop.png)
import { mkdirSync, rmdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchChrome, waitReady } from './browser';
import { REPO, today } from './evidence';

const SITE = (process.env.SITE ?? 'http://127.0.0.1:5493').replace(/\/$/, '');
const SCENES = (process.env.SCENES ?? '224aba38,39e63ce9,7a475d38,ba7aa29d').split(',');
const W = 1280, H = 720;
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

const CHUNK_HEAD = `
#if STD_OPACITY_DITHER == BAYER2 || STD_OPACITY_DITHER == BAYER4 || STD_OPACITY_DITHER == BAYER8 || STD_OPACITY_DITHER == BAYER16
    #include "bayerPS"
#endif
uniform blueNoiseJitter: vec4f;
#if STD_OPACITY_DITHER == BLUENOISE
    var blueNoiseTex32 : texture_2d<f32>;
    var blueNoiseTex32Sampler : sampler;
#endif
`;
// the engine's chunk with its noise line replaced; the discard tests are the engine's
const chunk = (noise: string): string => `${CHUNK_HEAD}
fn opacityDither(alpha: f32, id: f32) {
    if (alpha <= 0.0) { discard; }
    if (alpha >= 1.0) { return; }
    var uv = fract(pcPosition.xy / 32.0 + uniform.blueNoiseJitter.xy + id);
    var blue: f32 = textureSampleLevel(blueNoiseTex32, blueNoiseTex32Sampler, uv, 0.0).y;
    ${noise}
    if (alpha < noise) { discard; }
}
`;
const VARIANTS: Record<string, string | null> = {
    engine: null,
    linear: chunk('var noise: f32 = blue;')
};
// A third variant, a sin-hash of the pixel and the splat id in place of the blue-noise texture, was tried in the first run
// (evidence v10-r-dither.json, key "hash"): its frames did not change with the engine's jitter and its pictures are nearly empty,
// so it says nothing; it is not part of this tool any more.

const EXPERIMENT = `(async (W, H, AVG, PICS, VARIANTS) => {
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
  const chan = (d) => { const m = [0, 0, 0]; for (let i = 0; i < W * H; i++) { m[0] += d[4 * i]; m[1] += d[4 * i + 1]; m[2] += d[4 * i + 2]; } return m.map((x) => r2(x / (W * H))); };
  const look = (yawDeg) => { const a = yawDeg * Math.PI / 180; r.setCameraLookAt(p0[0], p0[1], p0[2], p0[0] + Math.sin(a), p0[1] - 0.1, p0[2] - Math.cos(a)); };
  const stable = async () => { let ok = 0; for (let i = 0; i < 240 && ok < 8; i++) { await nextEnd(); ok = (r.splatFrame && r.splatFrame.loading === 0) ? ok + 1 : 0; } return ok >= 8; };
  const avgOf = async (stoch, n) => { r.setStochastic(stoch); r.camera.camera.jitter = 1; await settle(6); const sum = new Float32Array(W * H * 4); for (let m = 0; m < n; m++) { const d = await grab(); for (let i = 0; i < sum.length; i++) sum[i] += d[i]; } const avg = new Uint8ClampedArray(W * H * 4); for (let i = 0; i < avg.length; i++) avg[i] = sum[i] / n; return avg; };
  const toB64 = async (cv) => { const b = await cv.convertToBlob({ type: 'image/png' }); const u = new Uint8Array(await b.arrayBuffer()); let bin = ''; for (let i = 0; i < u.length; i += 8192) bin += String.fromCharCode.apply(null, u.subarray(i, i + 8192)); return btoa(bin); };
  const cropPng = async (rgba, x0, y0, cw, ch) => { const out = new Uint8ClampedArray(cw * ch * 4); for (let y = 0; y < ch; y++) out.set(rgba.subarray(((y0 + y) * W + x0) * 4, ((y0 + y) * W + x0 + cw) * 4), y * cw * 4); const oc = new OffscreenCanvas(cw, ch); oc.getContext('2d').putImageData(new ImageData(out, cw, ch), 0, 0); return toB64(oc); };

  // find the gsplat material (the engine's own 'material:created' event gives it to applications; here the director's map)
  let material = null;
  try { for (const [, data] of app.renderer.gsplatDirector.camerasMap) { for (const [, ld] of data.layersMap) { const m = ld.gsplatManager && ld.gsplatManager.renderer && ld.gsplatManager.renderer.material; if (m) material = m; } } } catch (e) { return { error: 'no director: ' + e }; }
  if (!material) return { error: 'no gsplat material' };
  const original = material.hasShaderChunks ? material.getShaderChunks('wgsl').get('opacityDitherPS') : undefined;
  const setChunk = async (code) => {
    const m = material.getShaderChunks('wgsl');
    if (code) { m.set('opacityDitherPS', code); material.shaderChunksVersion = '2.23'; } else if (m.has('opacityDitherPS')) m.delete('opacityDitherPS');
    material.update();
    r.setStochastic(false); await settle(4); r.setStochastic(true); await settle(8);
  };

  await stable();
  const out = { size: [W, H], variants: {}, pics: [] };
  // sorted, jittered mean (the reference of the convergence test) and the single still frame, at yaw 0 and 90
  const view = async (yaw) => { look(yaw); r.setStochastic(false); r.camera.camera.jitter = 0; await settle(10); await stable(); return grab(); };
  const refs = {};
  for (const yaw of [0, 90]) { refs[yaw] = await view(yaw); }
  const refMean = {};
  for (const yaw of [0, 90]) { look(yaw); refMean[yaw] = await avgOf(false, AVG); }
  out.sortedChannelMeans = chan(refMean[0]);
  for (const [name, code] of Object.entries(VARIANTS)) {
    await setChunk(code);
    const rows = [];
    for (const yaw of [0, 90]) {
      look(yaw); r.camera.camera.jitter = 0; r.setStochastic(true); await settle(8);
      const single = await grab();
      look(yaw);
      const conv = [];
      let lastMean = null;
      for (const n of [1, 4, 16, AVG]) { look(yaw); const m = await avgOf(true, n); conv.push({ frames: n, ...score(luma(refMean[yaw]), luma(m)) }); lastMean = m; }
      rows.push({ yaw, single: score(luma(refs[yaw]), luma(single)), converged: conv, meanChannelDelta: chan(lastMean).map((v, i) => r2(v - chan(refMean[yaw])[i])) });
      if (PICS && yaw === 0) { const t = { x: 480, y: 270 }; out.pics.push({ name: name + '-single-crop', b64: await cropPng(single, t.x, t.y, 320, 180) }, { name: name + '-mean-crop', b64: await cropPng(lastMean, t.x, t.y, 320, 180) }); if (name === 'engine') out.pics.push({ name: 'sorted-crop', b64: await cropPng(refs[0], t.x, t.y, 320, 180) }); }
    }
    out.variants[name] = rows;
  }
  await setChunk(null);
  r.camera.camera.jitter = 0; r.setStochastic(false);
  out.chunkRestored = !material.getShaderChunks('wgsl').has('opacityDitherPS');
  return out;
})(${W}, ${H}, ${AVG}, ${PICS}, ${JSON.stringify(VARIANTS)})`;

const out: Record<string, Any> = { site: SITE, avg: AVG, scenes: {} };
const picDir = join(REPO, 'evidence', today(), 'v10-r-dither' + (TAG ? '-' + TAG : ''));
const { browser, which } = await launchChrome({ headless: false, args: ['--window-position=0,0', '--window-size=1400,1000'] });
try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    await ctx.route('**/api/e', (r) => r.fulfill({ status: 204, body: '' }));
    await ctx.addInitScript('window.__name = window.__name || ((f) => f);');
    const page = await ctx.newPage();
    const logs: string[] = [];
    page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`.slice(0, 300)));
    page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`.slice(0, 300)));
    for (const scene of SCENES) {
        const t0 = Date.now();
        await page.goto(`${SITE}/en/fly/?scene=${scene}&budget=4&stochastic=0&governor=0&nowarn=1&input=touch`);
        const ready = await waitReady(page, 240000);
        if (ready.status !== 'ready') { out.scenes[scene] = { error: ready }; continue; }
        while (Date.now() - t0 < 90000 && !(await page.evaluate('window.__gsfpv.session.renderer.sceneComplete'))) await sleep(500);
        await sleep(2000);
        try {
            const res = (await page.evaluate(EXPERIMENT)) as Any;
            const pics = (res.pics ?? []) as { name: string; b64: string }[];
            delete res.pics;
            if (PICS && pics.length) { mkdirSync(picDir, { recursive: true }); for (const p of pics) writeFileSync(join(picDir, `${scene}-${p.name}.png`), Buffer.from(p.b64, 'base64')); }
            out.scenes[scene] = res;
            const v = res.variants ?? {};
            console.log(scene, res.error ?? JSON.stringify(Object.fromEntries(Object.entries(v).map(([k, rows]) => [k, (rows as Any[]).map((x) => `${x.single.psnr}/${x.converged[x.converged.length - 1].psnr}dB dRGB${JSON.stringify(x.meanChannelDelta)}`)]))));
        } catch (e) {
            out.scenes[scene] = { error: String(e).slice(0, 400), logs: logs.slice(-5) };
            console.log(scene, 'failed', String(e).slice(0, 300));
        }
    }
    await ctx.close();
} finally {
    await browser.close().catch(() => undefined);
    release();
}
out.browser = which;
mkdirSync(join(REPO, 'evidence', today()), { recursive: true });
writeFileSync(join(REPO, 'evidence', today(), `v10-r-dither${TAG ? '-' + TAG : ''}.json`), JSON.stringify(out, null, 2));
console.log('written');
