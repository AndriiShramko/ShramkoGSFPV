// v0.11 lane S, stage 2c: does the vendored SuperSplat renderer draw in OUR page on engine 2.23.2, under the live CSP?
// Loads one scene with ?stochastic (the link asks for it), waits for the scan, then reads what draws (the test hook), the
// accumulating renderer's numbers, the console and the WebGPU validation errors (an init script hooks 'uncapturederror'
// on every device the page makes), and saves one frame as PNG. Visible window, GPU lock.
//   SITE=http://127.0.0.1:5611 SCENE=39e63ce9 IMPL=accum npx tsx src/probe-v11-first-picture.ts
// Output: evidence/<date>/v11-first-picture-<scene>-<impl>.json and .png
import { mkdirSync, rmdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchChrome, waitReady } from './browser';
import { REPO, today } from './evidence';

const SITE = (process.env.SITE ?? 'http://127.0.0.1:5611').replace(/\/$/, '');
const SCENE = process.env.SCENE ?? '39e63ce9';
const IMPL = process.env.IMPL ?? 'accum';
const BUDGET = process.env.BUDGET ?? '4';
const EXTRA = process.env.EXTRA ?? '';
const W = Number(process.env.W ?? 1280);
const H = Number(process.env.H ?? 720);
const LOCK = 'C:/dev/.gpu-lock';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

for (;;) {
    try { mkdirSync(LOCK); break; } catch { console.log('waiting for the GPU lock'); await sleep(3000); }
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

const READ = `(async () => {
  const h = window.__gsfpv; const s = h.session; const r = s.renderer; const app = r.app; const canvas = r.canvas;
  r.setFixedResolution({ w: ${W}, h: ${H} });
  const nextEnd = () => new Promise((res) => app.once('frameend', res));
  for (let i = 0; i < 90; i++) await nextEnd();
  const out = { drawing: h.drawing ? { ...h.drawing, accum: undefined, gpu: undefined } : null, accumNow: r.accumStats(), drawn: r.drawn, plan: r.plan, impl: r.stochasticImpl, stochastic: r.stochastic };
  out.fps = null;
  const t0 = performance.now(); for (let i = 0; i < 60; i++) await nextEnd(); out.fps = Math.round(60000 / (performance.now() - t0) * 10) / 10;
  const comp = new OffscreenCanvas(${W}, ${H}); const cctx = comp.getContext('2d');
  const png = await new Promise((res) => app.once('frameend', async () => { cctx.drawImage(canvas, 0, 0, ${W}, ${H}); const b = await comp.convertToBlob({ type: 'image/png' }); const u = new Uint8Array(await b.arrayBuffer()); let bin = ''; for (let i = 0; i < u.length; i += 8192) bin += String.fromCharCode.apply(null, u.subarray(i, i + 8192)); res(btoa(bin)); }));
  out.png = png; out.gpuErrors = window.__gpuErrors; out.sceneComplete = r.sceneComplete;
  return out;
})()`;

const { browser, which } = await launchChrome({ headless: false, args: ['--window-position=0,0', '--window-size=1400,1000'] });
const lines: string[] = [];
let result: Record<string, Any> = {};
try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    await ctx.route('**/api/e', (r) => r.fulfill({ status: 204, body: '' }));
    await ctx.addInitScript('window.__name = window.__name || ((f) => f);');
    await ctx.addInitScript(GPU_ERRORS);
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') lines.push(`${m.type()}: ${m.text()}`.slice(0, 500)); });
    page.on('pageerror', (e) => lines.push(`pageerror: ${e.message}`.slice(0, 500)));
    const t0 = Date.now();
    await page.goto(`${SITE}/en/fly/?scene=${SCENE}&budget=${BUDGET}&stochastic&impl=${IMPL}&governor=0&nowarn=1&input=touch${EXTRA}`);
    const ready = await waitReady(page, 240000);
    if (ready.status !== 'ready') throw new Error('not ready: ' + JSON.stringify(ready));
    while (Date.now() - t0 < 90000 && !(await page.evaluate('window.__gsfpv.session.renderer.sceneComplete'))) await sleep(500);
    await sleep(1500);
    result = (await page.evaluate(READ)) as Record<string, Any>;
    result.loadedMs = Date.now() - t0;
    await ctx.close();
} catch (e) {
    result.error = String(e).slice(0, 600);
} finally {
    await browser.close().catch(() => undefined);
    release();
}
const dir = join(REPO, 'evidence', today());
mkdirSync(dir, { recursive: true });
const png = result.png as string | undefined;
delete result.png;
const base = join(dir, `v11-first-picture-${SCENE}-${IMPL}${process.env.TAG ? '-' + process.env.TAG : ''}`);
writeFileSync(`${base}.json`, JSON.stringify({ site: SITE, scene: SCENE, impl: IMPL, budget: BUDGET, size: [W, H], browser: which, console: lines.slice(0, 40), ...result }, null, 2));
if (png) writeFileSync(`${base}.png`, Buffer.from(png, 'base64'));
console.log(JSON.stringify({ ...result, console: lines.slice(0, 12) }, null, 1).slice(0, 3000));
console.log('written', `${base}.json`);
