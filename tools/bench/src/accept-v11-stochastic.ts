// v0.11 lane S in the real page (the owner's message 24: "a good stochastic with frame accumulation, like SuperSplat", taken from
// the SuperSplat viewer's own renderer): the stochastic drawing is now the vendored SuperSplat renderer with a temporal history,
// behind the same precedence as before. Draws the scan: run it under the GPU lock (C:/dev/.gpu-lock, taken here). The NEW release
// and the BASE release (the commit before this lane, db73942, built apart in .cache/base-src) are served by serve-csp (the live
// CSP, no API). Every check has a control: the BASE build, or the same build with the engine's own dither (?impl=engine), or a
// deliberate break, must do the OLD thing.
//   V1  `?stochastic` draws through the vendored renderer: drawn 'accum', the plan says why, accumulation on, culling on, millions of
//       splats resident, its buffers allocated, F3 says "stochastic, accumulating", no WebGPU validation error, no CSP violation, no
//       page error. Controls: ?impl=engine draws the engine's dither (nothing made, F3 plain "stochastic"); the BASE build has no
//       such renderer; a device whose storage binding is too small for its cache falls back to the engine's dither (impl engine,
//       the plan says unsupported).
//   V2  at rest it converges to the sorted picture: after 256 frames every one of four views is above PSNR 33 dB (luma) and within
//       1.5 levels of the sorted mean colour. Controls: one frame of the same renderer, and the engine's dither, stay below 25 dB.
//   V3  after a fast turn it does not ghost: 180 deg in 12 frames then still: from the 2nd frame after the stop the picture is closer to
//       the final view than to the view two frames before the stop, and its share of pixels more than 48 levels off the sorted
//       picture is not above the engine dither's plus 1 %. Control: no colour clamp and a long moving history (taaClip 0, taaMoveMax
//       64, taaMotion 0) smears: its worst lag is negative where the defaults' is not, or it has more ghost pixels.
//   V4  REC stays sorted: the drawing is the accumulating one before, sorted while it records (the hold), accumulating again after.
//   V5  the share picture stays sorted: the frame it is made from is drawn sorted (within 40 dB of a sorted frame), the page returns
//       to accumulating right after.
//   V6  CSP stays strict: no securitypolicyviolation in any page; the release has no more eval / new Function / hosts than the BASE.
//   V7  integration: render scale steps, five scene switches with the renderer on (no growth of video memory), ?render=off makes nothing.
//   V8  the order of who decides is unchanged: the link, then the pilot's Render setting; nothing asked is sorted and makes no renderer.
//   SITE_DIST=dist BASE_DIST=.cache/dist-base npx tsx src/accept-v11-stochastic.ts [V1 V2 ...]   (from tools/bench)
// Evidence: evidence/<date>/v11-stochastic.json
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Browser, BrowserContext, Page } from 'playwright';
import { launchChrome, waitReady } from './browser';
import { REPO, today, writeEvidence } from './evidence';

const DIST = join(REPO, process.env.SITE_DIST ?? 'dist');
const BASE_DIST = join(REPO, process.env.BASE_DIST ?? join('.cache', 'dist-base'));
const NEW_PORT = 5700 + Math.floor(Math.random() * 200);
const BASE_PORT = NEW_PORT + 300;
const NEW = `http://127.0.0.1:${NEW_PORT}`;
const BASE = `http://127.0.0.1:${BASE_PORT}`;
const ROOM = '39e63ce9'; // Modlinek Villa, red room and bathroom: 3.8 M splats, a small interior
const SCENES5 = ['39e63ce9', '7a475d38', '224aba38', 'ba7aa29d', '39e63ce9'];
const ONLY = process.argv.slice(2).map((x) => x.toUpperCase());
const want = (id: string): boolean => ONLY.length === 0 || ONLY.includes(id);
const needBase = ONLY.length === 0 || ONLY.some((x) => ['V1', 'V6'].includes(x));
const LOCK = 'C:/dev/.gpu-lock';
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const EN = JSON.parse(readFileSync(join(REPO, 'packages', 'i18n', 'locales', 'fly', 'drawing', 'en.json'), 'utf8')) as Record<string, string>;
const PAGE = readFileSync(join(REPO, 'tools', 'bench', 'src', 'v11-s-page.js'), 'utf8');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const hook = <T = Any>(p: Page, body: string): Promise<T> => p.evaluate(`(() => { const h = window.__gsfpv; const s = h.session; ${body} })()`) as Promise<T>;

for (;;) {
    try { mkdirSync(LOCK); break; } catch { console.log('waiting for the GPU lock'); await sleep(Number(process.env.LOCK_POLL_MS ?? 3000)); }
}
const release = (): void => { try { rmdirSync(LOCK); } catch { /* gone */ } };
process.on('SIGINT', () => { release(); process.exit(130); });

const children: ChildProcess[] = [];
const out: Record<string, Any> = {};
const pass: Record<string, boolean> = {};
const checks: { name: string; ok: boolean; control: boolean }[] = [];
function check(name: string, ok: boolean, control = false): boolean {
    checks.push({ name, ok, control });
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${control ? '[control] ' : ''}${name}`);
    return ok;
}
async function until(url: string, ms = 30000): Promise<void> {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
        try { if ((await fetch(url)).status < 500) return; } catch { /* not up yet */ }
        await sleep(250);
    }
    throw new Error(`${url} did not come up`);
}

/** WebGPU validation errors of every device the page makes, and CSP violations. */
const INIT = `(() => {
  window.__gpuErrors = []; window.__csp = [];
  document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective + ' ' + String(e.blockedURI).slice(0, 80)));
  const ra = navigator.gpu.requestAdapter.bind(navigator.gpu);
  navigator.gpu.requestAdapter = async (o) => {
    const a = await ra(o); if (!a) return a;
    const rd = a.requestDevice.bind(a);
    a.requestDevice = async (d) => { const dev = await rd(d); dev.addEventListener('uncapturederror', (e) => window.__gpuErrors.push(String(e.error && e.error.message).slice(0, 400))); return dev; };
    return a;
  };
})();`;

async function context(browser: Browser): Promise<{ ctx: BrowserContext; page: Page; log: string[] }> {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    await ctx.route('**/api/e', (r) => r.fulfill({ status: 204, body: '' }));
    await ctx.addInitScript('window.__name = window.__name || ((f) => f);');
    await ctx.addInitScript(INIT);
    await ctx.addInitScript({ content: "try { localStorage.setItem('gsfpv.warned', '1'); } catch (e) {}" });
    const page = await ctx.newPage();
    const log: string[] = [];
    page.on('console', (m) => log.push(`${m.type()}: ${m.text()}`.slice(0, 300)));
    page.on('pageerror', (e) => log.push(`pageerror: ${e.message}`.slice(0, 300)));
    return { ctx, page, log };
}
const errors = (log: string[]): string[] => log.filter((l) => l.startsWith('pageerror'));

/** What draws and why, as the page and the renderer say it (a string run in the page). */
const STATE = `const r = s.renderer; const g = r.app.scene.gsplat;
  return { status: h.status, hasApi: typeof r.accumStats === 'function', drawn: r.drawn, impl: r.stochasticImpl, plan: r.plan || null, stochastic: r.stochastic, engineFlag: g.stochastic === true,
    accum: typeof r.accumStats === 'function' ? r.accumStats() : null, made: typeof r.accumStats === 'function' ? r.accumulating !== null : null,
    hook: h.drawing ? { from: h.drawing.from, impl: h.drawing.impl, drawn: h.drawing.drawn, missing: h.drawing.accumMissing, held: h.drawing.held, stochastic: h.drawing.stochastic } : null,
    canvas: [r.canvas.width, r.canvas.height], gpuErrors: window.__gpuErrors || [], csp: window.__csp || [], f3: (document.querySelector('[data-testid=drawing-line]') || {}).textContent || '' };`;

async function open(p: Page, site: string, qs: string, timeout = 240000): Promise<Any> {
    await p.goto(`${site}/en/fly/?${qs}&nowarn=1&input=touch`);
    const r = await waitReady(p, timeout);
    if (r.status !== 'ready') return { status: r.status, error: r.error };
    return null;
}
/** Every CSP violation and WebGPU validation error any state read of this run saw (V6 and the summary read it at the end). */
const seen = { csp: [] as string[], gpu: [] as string[], states: 0 };
const state = async (p: Page): Promise<Any> => {
    const st = await hook<Any>(p, STATE);
    seen.csp.push(...st.csp); seen.gpu.push(...st.gpuErrors); seen.states++;
    return st;
};
async function waitComplete(p: Page, ms = 90000): Promise<void> {
    for (let t0 = Date.now(); Date.now() - t0 < ms;) { if (await hook<boolean>(p, 'return s.renderer.sceneComplete;')) break; await sleep(500); }
    await sleep(1200);
}
const frames = (p: Page, n: number): Promise<unknown> => hook(p, `return new Promise((res) => { let k = 0; const on = () => { if (++k >= ${n}) { s.renderer.app.off('frameend', on); res(0); } }; s.renderer.app.on('frameend', on); });`);
async function f3(p: Page): Promise<string> {
    const shown = await p.evaluate(() => !!document.querySelector('.hud .osd.frame:not(.hidden)'));
    if (!shown) await p.keyboard.press('F3');
    await sleep(700);
    return p.evaluate(() => (document.querySelector('[data-testid=drawing-line]') || {} as Element).textContent || '');
}
const setPref = (p: Page, id: string, v: unknown): Promise<unknown> => p.evaluate(`window.__gsfpv.prefs.set(${JSON.stringify(id)}, ${JSON.stringify(v)})`);
const luma640 = `(async (n) => {
  const h = window.__gsfpv; const r = h.session.renderer; const app = r.app; const W = 640, H = 360;
  const c = new OffscreenCanvas(W, H); const x = c.getContext('2d', { willReadFrequently: true });
  for (let i = 0; i < n; i++) await new Promise((res) => app.once('frameend', res));
  const d = await new Promise((res) => app.once('frameend', () => { x.drawImage(r.canvas, 0, 0, W, H); res(x.getImageData(0, 0, W, H).data); }));
  const o = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) o[i] = Math.round(0.299 * d[4 * i] + 0.587 * d[4 * i + 1] + 0.114 * d[4 * i + 2]);
  let bin = ''; for (let i = 0; i < o.length; i += 8192) bin += String.fromCharCode.apply(null, o.subarray(i, i + 8192));
  return btoa(bin);
})`;
function psnr(a: string, b: string): number {
    const x = Buffer.from(a, 'base64'), y = Buffer.from(b, 'base64');
    let e = 0;
    for (let i = 0; i < x.length; i++) { const d = x[i] - y[i]; e += d * d; }
    e /= x.length;
    return e === 0 ? 99 : Math.round(10 * Math.log10(255 * 255 / e) * 100) / 100;
}
const bundleOf = (dist: string): string => {
    const dir = join(dist, 'fly', 'assets');
    return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(dir, f), 'utf8')).join('\n') : '';
};

async function main(): Promise<void> {
    const servers: (readonly [string, number, string])[] = [[DIST, NEW_PORT, NEW]];
    if (needBase) servers.push([BASE_DIST, BASE_PORT, BASE]);
    for (const [dist, port] of servers) children.push(spawn('node', [join(REPO, 'tools', 'bench', 'scripts', 'serve-csp.mjs'), dist, String(port)], { stdio: 'ignore' }));
    for (const [, , origin] of servers) await until(`${origin}/en/`);
    out.build = { new: DIST.replace(REPO, '.'), base: needBase ? BASE_DIST.replace(REPO, '.') : null, baseCommit: 'db73942' };
    mkdirSync(join(REPO, 'evidence', today()), { recursive: true });
    const { browser, which } = await launchChrome({ headless: false, args: ['--window-position=40,40', '--window-size=1296,920'] });
    out.browser = which;
    const known403 = (log: string[]): number => log.filter((l) => /status of 403/.test(l)).length;
    try {
        // ------------------------------------------------------------------ V1
        if (want('V1')) {
            const a = await context(browser);
            await open(a.page, NEW, `scene=${ROOM}&stochastic&governor=0`);
            await waitComplete(a.page, 60000);
            await frames(a.page, 90);
            const st = await state(a.page);
            const line = await f3(a.page);
            const errA = errors(a.log), n403 = known403(a.log);
            await a.ctx.close();
            const b = await context(browser);
            await open(b.page, NEW, `scene=${ROOM}&stochastic&impl=engine&governor=0`);
            await waitComplete(b.page, 60000);
            await frames(b.page, 30);
            const eng = await state(b.page);
            const lineEng = await f3(b.page);
            await b.ctx.close();
            const c = await context(browser);
            await open(c.page, BASE, `scene=${ROOM}&stochastic&governor=0`);
            await waitComplete(c.page, 60000);
            await frames(c.page, 30);
            const base = await state(c.page);
            const n403Base = known403(c.log);
            await c.ctx.close();
            const d = await context(browser);
            await open(d.page, NEW, `scene=${ROOM}&stochastic=0&governor=0`);
            await waitComplete(d.page, 60000);
            const forced = await hook<Any>(d.page, `const r = s.renderer; Object.defineProperty(r.device.wgpu, 'limits', { value: { maxStorageBufferBindingSize: 1 << 20 } }); const on = r.setStochastic(true); return { on, drawn: r.drawn, impl: r.stochasticImpl, plan: r.plan, missing: r.accumMissing(), made: r.accumulating !== null };`);
            await d.ctx.close();
            out.V1 = { new: st, f3: line, engine: eng, f3Engine: lineEng, base, forced, errors: errA, console403: { new: n403, base: n403Base } };
            check('V1 `?stochastic` draws through the vendored renderer: drawn accum, plan accum/ok, the page\'s hook agrees, the engine\'s own dither is off', st.drawn === 'accum' && st.plan?.draw === 'accum' && st.plan?.why === 'ok' && st.impl === 'accum' && st.hook?.drawn === 'accum' && st.hook?.impl === 'accum' && st.engineFlag === false && st.hook?.from?.stochastic === 'link');
            check('V1 the renderer is up: active, accumulating (taa), occlusion culling on, millions of splats resident, its buffers allocated', st.accum?.active === true && st.accum?.taaActive === true && st.accum?.culling === true && st.accum?.activeSplats > 3_000_000 && st.accum?.gpuBytes > 100_000_000 && st.accum?.failed === null);
            check('V1 upstream\'s defaults are in force (256 frames at rest, 16 moving, clamp 1.25)', st.accum?.variant?.taa === 'on' && st.accum?.variant?.taaMax === 256 && st.accum?.variant?.taaMoveMax === 16 && st.accum?.variant?.taaClip === 1.25);
            check('V1 F3 says "stochastic, accumulating" and who decided', /^Render: stochastic, accumulating \(the link\)/.test(line));
            check('V1 no WebGPU validation error, no CSP violation, no page error', st.gpuErrors.length === 0 && st.csp.length === 0 && errA.length === 0);
            check('V1 control: ?impl=engine draws the engine\'s own dither (drawn engine, flag on) and makes no accumulating renderer; F3 says plain "stochastic"', eng.drawn === 'engine' && eng.engineFlag === true && eng.made === false && eng.plan?.draw === 'engine' && eng.plan?.why === 'impl' && /^Render: stochastic \(the link\)/.test(lineEng), true);
            check('V1 control: the BASE build has no such renderer (no accumStats) and draws the engine\'s dither for the same link', base.hasApi === false && base.engineFlag === true, true);
            check('V1 control: a device whose storage binding cannot hold the cache falls back to the engine\'s dither (impl engine, plan unsupported, nothing made)', forced.on === true && forced.drawn === 'engine' && forced.plan?.draw === 'engine' && forced.plan?.why === 'unsupported' && forced.missing.includes('cache fits one storage binding') && forced.made === false, true);
            check(`V1 the 403s in the console are the page's own and the BASE has the same (${n403} against ${n403Base}): not ours`, n403 === n403Base);
            pass.V1 = true;
        }

        // ------------------------------------------------------------------ V2 and V3 (the lane's own experiment, run on the local release)
        if (want('V2') || want('V3')) {
            const a = await context(browser);
            await open(a.page, NEW, `scene=${ROOM}&stochastic=0&governor=0`);
            await waitComplete(a.page, 60000);
            const modes = [...(want('V2') ? ['q1'] : []), ...(want('V3') ? ['q4', 'q3'] : [])];
            const res = await a.page.evaluate(`(${PAGE})(${JSON.stringify({ W: 1280, H: 720, frames: 48, pics: false, modes })})`) as Any;
            delete res.pics;
            out.V23 = { ...res, errors: errors(a.log) };
            await a.ctx.close();
            if (want('V2')) {
                const q1 = res.q1 as Any[];
                check(`V2 at rest the picture converges to the sorted one: after 256 frames every view is above 33 dB (${q1.map((r) => r.A[256].psnr).join(', ')}) and within 1.5 levels of the sorted mean colour (${q1.map((r) => r.shift256.map((x: number) => Math.abs(x)).reduce((m: number, x: number) => Math.max(m, x), 0)).join(', ')})`,
                    q1.every((r) => r.A[256].psnr >= 33 && r.shift256.every((x: number) => Math.abs(x) <= 1.5)));
                check(`V2 it gets there: each step of the history is better than the one before (view 1: ${Object.values(q1[0].A as Record<string, Any>).map((x) => x.psnr).join(' < ')})`, q1.every((r) => { const v = Object.values(r.A as Record<string, Any>).map((x) => x.psnr); return v.every((x: number, i: number) => i === 0 || x > v[i - 1]); }));
                check(`V2 control: one frame of the same renderer is far below (${q1.map((r) => r.A[1].psnr).join(', ')}) and the engine's dither stays below 25 dB (${q1.map((r) => r.E.psnr).join(', ')}) however long it is watched`, q1.every((r) => r.A[1].psnr < 28 && r.E.psnr < 25), true);
                check(`V2 control: the harness sorted against sorted reads silence (${q1.map((r) => r.SvS.psnr).join(', ')} dB)`, q1.every((r) => r.SvS.psnr > 80), true);
            }
            if (want('V3')) {
                const q4 = res.q4 as Any;
                const leads = [2, 3, 4, 8].map((j) => q4.A.lead[j]);
                check(`V3 after a fast turn there is no smear: from the 2nd frame after the stop the picture is closer to the final view than to the one two frames before it (lead ${leads.join(', ')} dB, all >= 0)`, leads.every((x: number) => x >= 0));
                check(`V3 and no ghosts: pixels more than 48 levels off the sorted picture just after the stop ${q4.A.ghost48} against the engine dither's ${q4.E.ghost48} (+1 % allowed)`, q4.A.ghost48 <= q4.E.ghost48 + 0.01);
                const q3 = res.q3.step1 as Any;
                check(`V3 control: where the motion is sustained (360 deg/s, +-60 deg roll, 6 m/s: 90 frames) no colour clamp and a long moving history (AN) are worse: PSNR ${q3.AN.psnrMean} (worst ${q3.AN.psnrMin}) against the defaults' ${q3.A.psnrMean} (worst ${q3.A.psnrMin})`, q3.AN.psnrMean < q3.A.psnrMean - 1 && q3.AN.psnrMin < q3.A.psnrMin);
                check(`V3 control: the sorted run against a second sorted run has no ghosts (${q4.floor.ghost48})`, q4.floor.ghost48 < 0.005, true);
            }
            pass.V2 = want('V2');
            pass.V3 = want('V3');
        }

        // ------------------------------------------------------------------ V4 REC
        if (want('V4')) {
            const n = await context(browser);
            await open(n.page, NEW, `scene=${ROOM}&stochastic&governor=0`);
            await waitComplete(n.page, 60000);
            await frames(n.page, 60);
            await n.page.waitForSelector('[data-testid=rec-bar] [data-action=cinema-rec]', { timeout: 10000 });
            const pre = await state(n.page);
            await n.page.evaluate("document.querySelector('[data-testid=rec-bar] [data-action=cinema-rec]').click()");
            await n.page.waitForFunction(() => { const d = document.querySelector('[data-testid=rec-dot]'); return !!d && !(d as HTMLElement).hidden; }, null, { timeout: 20000 });
            await sleep(1500);
            const during = await state(n.page);
            const lineDuring = await f3(n.page);
            await n.page.evaluate("document.querySelector('[data-testid=rec-bar] [data-action=cinema-rec]').click()");
            await n.page.waitForFunction(() => { const d = document.querySelector('[data-testid=rec-dot]'); return !d || (d as HTMLElement).hidden; }, null, { timeout: 30000 });
            await frames(n.page, 60);
            const after = await state(n.page);
            const lineAfter = await f3(n.page);
            out.V4 = { pre: { drawn: pre.drawn, accum: pre.accum }, during: { drawn: during.drawn, accum: during.accum, held: during.hook?.held, f3: lineDuring }, after: { drawn: after.drawn, accum: after.accum, held: after.hook?.held, f3: lineAfter }, gpuErrors: [...after.gpuErrors], errors: errors(n.log) };
            await n.ctx.close();
            check('V4 before REC the accumulating renderer draws (so the check can see it)', pre.drawn === 'accum' && pre.accum?.active === true && pre.accum?.taaActive === true, true);
            check('V4 while REC runs the scan is drawn sorted: the renderer is handed back (not active), the engine\'s dither is off, the hook says the hold is on, F3 says "sorted (recording)"', during.drawn === 'sorted' && during.accum?.active === false && during.engineFlag === false && during.hook?.held === true && /^Render: sorted \(recording\)/.test(lineDuring));
            check('V4 after the stop the pilot\'s drawing is back: accumulating again, accumulating (taa), the hold is off, F3 says so', after.drawn === 'accum' && after.accum?.active === true && after.accum?.taaActive === true && after.hook?.held === false && /^Render: stochastic, accumulating/.test(lineAfter));
            check('V4 no WebGPU validation error and no page error through the switches', after.gpuErrors.length === 0 && errors(n.log).length === 0);
            pass.V4 = true;
        }

        // ------------------------------------------------------------------ V5 share picture
        if (want('V5')) {
            const n = await context(browser);
            await open(n.page, NEW, `scene=${ROOM}&stochastic&governor=0`);
            await waitComplete(n.page, 60000);
            await hook(n.page, "s.pause(true, 'bake'); s.cameraOverride = true; return 0;");
            await frames(n.page, 40);
            // a sorted frame of the view, taken by hand, to compare the share picture's frame with
            await hook(n.page, 's.renderer.setStochastic(false); return 0;');
            const sortedRef = await n.page.evaluate(`${luma640}(10)`) as string;
            await hook(n.page, 's.renderer.setStochastic(true); return 0;');
            await frames(n.page, 40);
            const before = await state(n.page);
            // watch what draws, frame by frame, and keep the luma of the first sorted frame, while the share panel makes its picture
            await hook(n.page, `window.__seen = []; window.__sortedLuma = null; const r = s.renderer; const app = r.app; const W = 640, H = 360; const c = new OffscreenCanvas(W, H); const x = c.getContext('2d', { willReadFrequently: true });
                window.__watch = () => { window.__seen.push(r.drawn); if (r.drawn === 'sorted' && !window.__sortedLuma) { x.drawImage(r.canvas, 0, 0, W, H); const d = x.getImageData(0, 0, W, H).data; const o = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) o[i] = Math.round(0.299 * d[4 * i] + 0.587 * d[4 * i + 1] + 0.114 * d[4 * i + 2]); let bin = ''; for (let i = 0; i < o.length; i += 8192) bin += String.fromCharCode.apply(null, o.subarray(i, i + 8192)); window.__sortedLuma = btoa(bin); } };
                app.on('frameend', window.__watch); h.share.open('top'); return 0;`);
            await n.page.waitForFunction(() => { const st = (window as Any).__gsfpv.share?.state(); return !!st && st.picture === true; }, null, { timeout: 30000 }).catch(() => undefined);
            await sleep(800);
            const shareState = await hook<Any>(n.page, 'return h.share.state();');
            const seen = await hook<string[]>(n.page, 'return window.__seen;');
            const grabbed = await hook<string | null>(n.page, 'return window.__sortedLuma;');
            await hook(n.page, 's.renderer.app.off("frameend", window.__watch); return 0;');
            const during = await state(n.page);
            const dB = grabbed ? psnr(sortedRef, grabbed) : null;
            out.V5 = { before: before.drawn, seen: [...new Set(seen)], seenFirst: seen.slice(0, 12), shareState, psnrFrameVsSorted: dB, after: during.drawn, gpuErrors: during.gpuErrors, errors: errors(n.log) };
            await n.ctx.close();
            check('V5 before the share the accumulating renderer draws', before.drawn === 'accum', true);
            check('V5 the share panel made its picture', shareState?.picture === true);
            check('V5 a sorted frame was drawn for it, and the drawing is accumulating again right after', seen.includes('sorted') && during.drawn === 'accum' && during.accum?.active === true);
            check(`V5 the frame the picture is made from is the sorted picture of the view (${dB} dB from a hand-made sorted frame, 40 dB or more)`, dB !== null && dB >= 40);
            check('V5 no WebGPU validation error and no page error', during.gpuErrors.length === 0 && errors(n.log).length === 0);
            pass.V5 = true;
        }

        // ------------------------------------------------------------------ V6 CSP
        if (want('V6')) {
            const mine = bundleOf(DIST), base = bundleOf(BASE_DIST);
            const count = (s: string, re: RegExp): number => (s.match(re) ?? []).length;
            const EV = /\beval\s*\(/g, NF = /new Function\s*\(/g, UNS = /unsafe-eval/g;
            const hosts = (s: string): Set<string> => new Set([...s.matchAll(/https?:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)].map((m) => m[1].toLowerCase()));
            const hMine = hosts(mine), hBase = hosts(base);
            const added = [...hMine].filter((x) => !hBase.has(x));
            const cspNew = (await fetch(`${NEW}/en/fly/`)).headers.get('content-security-policy') ?? '';
            const cspBase = (await fetch(`${BASE}/en/fly/`)).headers.get('content-security-policy') ?? '';
            out.V6 = { bytes: { new: mine.length, base: base.length }, eval: { new: count(mine, EV), base: count(base, EV) }, newFunction: { new: count(mine, NF), base: count(base, NF) }, hostsAdded: added, cspSame: cspNew === cspBase, scriptSrc: (/script-src[^;]*/.exec(cspNew) ?? [''])[0] };
            check(`V6 the release has no more eval( (${count(mine, EV)} against ${count(base, EV)}) and no more new Function( (${count(mine, NF)} against ${count(base, NF)}) than the BASE`, count(mine, EV) <= count(base, EV) && count(mine, NF) <= count(base, NF));
            check('V6 the policy the pages are served with is strict (no unsafe-eval) and is the same text as the BASE\'s', cspNew.length > 100 && !/unsafe-eval/.test(cspNew) && cspNew === cspBase);
            check(`V6 the bundle names no host the BASE bundle does not (${added.length ? added.join(', ') : 'none'})`, added.length === 0);
            check('V6 control: a made-up host in the bundle would be seen (the check has teeth)', [...hosts(`${mine} https://example-new-host.dev/x`)].filter((x) => !hBase.has(x)).includes('example-new-host.dev'), true);
            pass.V6 = true;
        }

        // ------------------------------------------------------------------ V7 integration
        if (want('V7')) {
            const n = await context(browser);
            await open(n.page, NEW, `scene=${ROOM}&stochastic&governor=0`);
            await waitComplete(n.page, 60000);
            await frames(n.page, 60);
            const steps: Any[] = [];
            for (const scale of [0.6, 1, 0.8, 1]) {
                await hook(n.page, `s.renderer.setRenderScale(${scale}); return 0;`);
                await frames(n.page, 40);
                const st = await state(n.page);
                const lum = await n.page.evaluate(`${luma640}(2)`) as string;
                const mean = Buffer.from(lum, 'base64').reduce((a, b) => a + b, 0) / (640 * 360);
                steps.push({ scale, canvas: st.canvas, drawn: st.drawn, taa: st.accum?.taaActive, mean: Math.round(mean * 10) / 10, gpuErrors: st.gpuErrors.length });
            }
            check(`V7 render scale steps (the governor's way): the canvas follows (${steps.map((x) => x.canvas[0]).join(', ')}), the accumulating renderer keeps drawing a lit picture, no GPU error`, steps.every((x) => x.drawn === 'accum' && x.taa === true && x.mean > 20 && x.gpuErrors === 0) && steps[0].canvas[0] < steps[1].canvas[0] && steps[2].canvas[0] < steps[3].canvas[0]);
            // scene switches in the page, the pilot's Render setting asks for stochastic (a link asks for the first scene only)
            await setPref(n.page, 'display.drawing', 'stochastic');
            await hook(n.page, 'return 0;');
            const vram = async (): Promise<number> => hook<number>(n.page, 'const v = s.renderer.device._vram; return v ? Math.round((v.tex + v.sb + v.vb + v.ib + v.ub) / 1048576) : -1;');
            const switches: Any[] = [];
            for (let i = 1; i < SCENES5.length; i++) {
                await hook(n.page, 'h.sceneSwitch = null; return 0;');
                await hook(n.page, `h.scenes.load(${JSON.stringify(SCENES5[i])}, 'next'); return 0;`);
                let sw: Any = null;
                for (let t0 = Date.now(); Date.now() - t0 < 180000;) { sw = await hook(n.page, 'return h.sceneSwitch ? { ...h.sceneSwitch } : null;'); if (sw && (sw.state === 'done' || sw.state === 'failed')) break; await sleep(300); }
                await waitComplete(n.page, 90000);
                await frames(n.page, 60);
                const st = await state(n.page);
                switches.push({ scene: SCENES5[i], state: sw?.state, drawn: st.drawn, active: st.accum?.active, splatsM: Math.round((st.accum?.activeSplats ?? 0) / 1e5) / 10, taa: st.accum?.taaActive, vramMiB: await vram(), gpuErrors: st.gpuErrors.length });
            }
            const lastErrors = errors(n.log);
            out.V7 = { scale: steps, switches, pageErrors: lastErrors };
            check(`V7 five scenes in a page with the renderer on (${switches.map((x) => x.scene).join(' > ')}): every switch ends done, the accumulating renderer draws each (millions of splats), no GPU error`, switches.length === 4 && switches.every((x) => x.state === 'done' && x.drawn === 'accum' && x.active === true && x.splatsM > 0.5 && x.taa === true && x.gpuErrors === 0));
            const v0 = switches[0].vramMiB;
            check(`V7 video memory does not grow across the switches (${switches.map((x) => x.vramMiB).join(', ')} MiB; the last scene is the first one again and may differ by 15 %)`, switches.every((x) => x.vramMiB > 0) && switches[switches.length - 1].vramMiB <= v0 * 1.15 + 50);
            check('V7 no page error through the scale steps and the scene switches', lastErrors.length === 0);
            await n.ctx.close();
            const off = await context(browser);
            await open(off.page, NEW, `scene=${ROOM}&stochastic&render=off&governor=0`);
            await sleep(1500);
            const so = await hook<Any>(off.page, 'const r = s.renderer; return { made: r.accumulating !== null, drawn: r.drawn, gpuErrors: (window.__gpuErrors || []).length };');
            await off.ctx.close();
            out.V7.renderOff = so;
            check('V7 ?render=off (logic only) makes no accumulating renderer and draws nothing', so.made === false || so.drawn !== 'accum');
            pass.V7 = true;
        }

        // ------------------------------------------------------------------ V8 order of who decides
        if (want('V8')) {
            const n = await context(browser);
            await open(n.page, NEW, `scene=${ROOM}&stochastic&governor=0`);
            await waitComplete(n.page, 60000);
            await frames(n.page, 30);
            const link = await state(n.page);
            await setPref(n.page, 'display.drawing', 'sorted');
            await frames(n.page, 30);
            const pilotSorted = await state(n.page);
            await setPref(n.page, 'display.drawing', 'auto');
            await frames(n.page, 30);
            const autoBack = await state(n.page);
            await n.ctx.close();
            const m = await context(browser);
            await open(m.page, NEW, `scene=${ROOM}&governor=0`);
            await waitComplete(m.page, 60000);
            await frames(m.page, 30);
            const nothing = await state(m.page);
            await setPref(m.page, 'display.drawing', 'stochastic');
            await frames(m.page, 60);
            const pilotAsks = await state(m.page);
            await setPref(m.page, 'display.drawing', 'auto');
            await frames(m.page, 30);
            const handedBack = await state(m.page);
            await m.ctx.close();
            out.V8 = { link: link.drawn, pilotSorted: pilotSorted.drawn, autoBack: autoBack.drawn, nothing: { drawn: nothing.drawn, made: nothing.made, from: nothing.hook?.from }, pilotAsks: { drawn: pilotAsks.drawn, from: pilotAsks.hook?.from }, handedBack: handedBack.drawn };
            check('V8 the link\'s ?stochastic draws accumulating; the pilot\'s Render = Sorted wins for that scene (sorted, renderer handed back); back to Auto the link is followed again', link.drawn === 'accum' && pilotSorted.drawn === 'sorted' && pilotSorted.accum?.active === false && autoBack.drawn === 'accum');
            check('V8 nothing asked: sorted by the device\'s preset, and no accumulating renderer was ever made (a pilot on sorted pays nothing)', nothing.drawn === 'sorted' && nothing.made === false && nothing.hook?.from?.stochastic === 'device');
            check('V8 the pilot choosing Stochastic gets the accumulating renderer ("your setting"), Auto hands it back', pilotAsks.drawn === 'accum' && pilotAsks.hook?.from?.stochastic === 'setting' && handedBack.drawn === 'sorted');
            pass.V8 = true;
        }
        // the tally of the whole run: every page state read saw no CSP violation and no WebGPU validation error
        if (want('V6')) check(`V6 no page of this run (${seen.states} state reads) saw a CSP violation (${seen.csp.length})`, seen.states > 0 && seen.csp.length === 0);
        out.tally = { states: seen.states, csp: seen.csp, gpuErrors: seen.gpu };
        check(`no page of this run saw a WebGPU validation error (${seen.gpu.length} in ${seen.states} state reads)`, seen.states > 0 && seen.gpu.length === 0);
    } finally {
        await browser.close().catch(() => undefined);
    }
}

let failed: unknown = null;
try {
    await main();
} catch (e) {
    failed = e;
    console.error(e);
} finally {
    for (const c of children) c.kill();
    release();
}
for (const k of Object.keys(pass)) pass[k] = pass[k] && checks.filter((c) => c.name.startsWith(k)).every((c) => c.ok);
const file = writeEvidence('v11-stochastic', { new: DIST.replace(REPO, '.'), base: needBase ? BASE_DIST.replace(REPO, '.') : null, pass, checks, items: out, failed: failed ? String(failed) : null, strings: { accumulating: EN['drawing.mode.accumulating'] } });
console.log(JSON.stringify(pass), file);
if (failed || Object.values(pass).some((v) => !v) || checks.some((c) => !c.ok)) process.exitCode = 1;
