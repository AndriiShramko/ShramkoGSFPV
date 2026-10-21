// v0.11 lane S: what the engine's work buffer looks like around an in-page scene switch with the accumulating renderer on, to find
// where the WebGPU validation errors of accept-v11-stochastic V7 come from (a 1x1 RGBA8 texture bound where a Uint one is expected).
// Per frame after the switch starts: the work buffer's format hash, streams (name, pixel format) and texture sizes, the resident
// splats, and how many validation errors have been seen. Visible window, GPU lock.
//   FROM=224aba38 TO=ba7aa29d npx tsx src/probe-v11-scene-switch.ts
// Output: evidence/<date>/v11-scene-switch-<FROM>-<TO>[-TAG].json
import { spawn } from 'node:child_process';
import { mkdirSync, rmdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchChrome, waitReady } from './browser';
import { REPO, today } from './evidence';

const DIST = join(REPO, process.env.SITE_DIST ?? 'dist');
const PORT = 5900 + Math.floor(Math.random() * 90);
const SITE = `http://127.0.0.1:${PORT}`;
const CHAIN = (process.env.CHAIN ?? process.env.FROM ?? '224aba38').split(',');
const FROM = CHAIN[0];
const TO = (process.env.TO ?? (CHAIN.length > 1 ? CHAIN[CHAIN.length - 1] : 'ba7aa29d'));
const NEXT = CHAIN.length > 1 ? CHAIN.slice(1) : [TO];
const SCALES = process.env.SCALES === '1';
const TAG = process.env.TAG ? `-${process.env.TAG}` : '';
const LOCK = 'C:/dev/.gpu-lock';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

for (;;) {
    try { mkdirSync(LOCK); break; } catch { console.log('waiting for the GPU lock'); await sleep(3000); }
}
const release = (): void => { try { rmdirSync(LOCK); } catch { /* gone */ } };
process.on('SIGINT', () => { release(); process.exit(130); });

const INIT = `(() => {
  window.__gpuErrors = []; window.__pe = 0; window.addEventListener('error', () => { window.__pe++; });
  const ra = navigator.gpu.requestAdapter.bind(navigator.gpu);
  navigator.gpu.requestAdapter = async (o) => {
    const a = await ra(o); if (!a) return a;
    const rd = a.requestDevice.bind(a);
    a.requestDevice = async (d) => { const dev = await rd(d); dev.addEventListener('uncapturederror', (e) => window.__gpuErrors.push(String(e.error && e.error.message).slice(0, 300))); return dev; };
    return a;
  };
})();`;

const WBFN = `() => {
  const r = window.__gsfpv.session.renderer; const dir = r.app.renderer.gsplatDirector; const out = [];
  for (const cd of dir.camerasMap.values()) for (const ld of cd.layersMap.values()) {
    const m = ld.gsplatManager; if (!m) continue; const wb = m.world.workBuffer; const f = wb.format;
    out.push({ hash: f.hash, textureSize: wb.textureSize, streams: f.streams.map((s) => { const t = wb.getTexture(s.name); return { name: s.name, fmt: s.format, tex: t ? [t.width, t.height, t.format] : null }; }), state: m.world.currentState ? { version: m.world.currentState.version, files: m.world.currentState.splats.length, total: m.world.currentState.totalActiveSplats } : null });
  }
  return out;
}`;
const WB = `(${WBFN})()`;

const server = spawn('node', [join(REPO, 'tools', 'bench', 'scripts', 'serve-csp.mjs'), DIST, String(PORT)], { stdio: 'ignore' });
const { browser } = await launchChrome({ headless: false, args: ['--window-position=0,0', '--window-size=1400,1000'] });
const result: Record<string, Any> = { from: FROM, to: TO };
try {
    for (let i = 0; i < 30; i++) { try { if ((await fetch(`${SITE}/en/`)).status < 500) break; } catch { /* wait */ } await sleep(250); }
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    await ctx.route('**/api/e', (r) => r.fulfill({ status: 204, body: '' }));
    await ctx.addInitScript('window.__name = window.__name || ((f) => f);');
    await ctx.addInitScript(INIT);
    const page = await ctx.newPage();
    const pageErrors: Any[] = [];
    page.on('pageerror', (e) => { if (pageErrors.length < 6) pageErrors.push({ message: e.message.slice(0, 200), stack: (e.stack ?? '').split(String.fromCharCode(10)).slice(0, 14).join(' | ') }); });
    await page.goto(`${SITE}/en/fly/?scene=${FROM}&stochastic&governor=0&nowarn=1&input=touch`);
    await waitReady(page, 240000);
    for (let t0 = Date.now(); Date.now() - t0 < 90000 && !(await page.evaluate('window.__gsfpv.session.renderer.sceneComplete'));) await sleep(500);
    await sleep(2000);
    await page.evaluate(`window.__wb = ${WBFN}`);
    result.before = await page.evaluate(WB);
    result.beforeErrors = await page.evaluate('window.__gpuErrors.length');
    if (SCALES) { for (const sc of [0.6, 1, 0.8, 1]) { await page.evaluate(`window.__gsfpv.session.renderer.setRenderScale(${sc})`); await sleep(1500); } result.afterScalesErrors = await page.evaluate('window.__gpuErrors.length'); }
    if (NEXT.length > 1 || CHAIN.length > 1) await page.evaluate("window.__gsfpv.prefs.set('display.drawing', 'stochastic')");
    // each switch, then a record of every frame for 160 frames
    result.switches = [];
    for (const to of NEXT) {
      const rows = await page.evaluate(`(async () => {
        const h = window.__gsfpv; const r = h.session.renderer; const app = r.app; const rows = [];
        h.sceneSwitch = null; h.scenes.load(${JSON.stringify(to)}, 'next');
        for (let i = 0; i < 160; i++) {
          await new Promise((res) => app.once('frameend', res));
          const w = window.__wb();
          rows.push({ i, drawn: r.drawn, errors: window.__gpuErrors.length, pe: window.__pe, held: r.accumHeldNow ? r.accumHeldNow() : undefined, hash: w[0] && w[0].hash, files: w[0] && w[0].state && w[0].state.files, total: w[0] && w[0].state && w[0].state.total, streams: w[0] ? w[0].streams.map((s) => s.name + ':' + s.fmt + ':' + (s.tex ? s.tex.join('x') : '-')).join(' ') : null, accum: r.accumStats() && { active: r.accumStats().active, splats: r.accumStats().activeSplats, taa: r.accumStats().taaActive }, sw: h.sceneSwitch && h.sceneSwitch.state });
        }
        return rows;
      })()`) as Any[];
      for (let t0 = Date.now(); Date.now() - t0 < 120000 && !(await page.evaluate('window.__gsfpv.session.renderer.sceneComplete'));) await sleep(500);
      await sleep(1500);
      result.switches.push({ to, rows });
    }
    result.frames = result.switches[result.switches.length - 1].rows;
    result.pageErrors = pageErrors;
    result.errors = await page.evaluate('window.__gpuErrors');
    result.after = await page.evaluate(WB);
    await ctx.close();
} catch (e) {
    result.error = String(e).slice(0, 500);
} finally {
    await browser.close().catch(() => undefined);
    server.kill();
    release();
}
mkdirSync(join(REPO, 'evidence', today()), { recursive: true });
const file = join(REPO, 'evidence', today(), `v11-scene-switch-${CHAIN.join('-')}${SCALES ? '-scales' : ''}${TAG}.json`);
writeFileSync(file, JSON.stringify(result, null, 2));
const allRows = ((result.switches ?? []) as Any[]).flatMap((x) => (x.rows as Any[]).map((r) => ({ ...r, to: x.to })));
let prev = result.beforeErrors ?? 0;
const firstErr = allRows.find((r) => { const bad = r.errors > prev; prev = r.errors; return bad; });
console.log(JSON.stringify({ error: result.error, before: result.before?.[0] && { hash: result.before[0].hash, streams: result.before[0].streams.map((s: Any) => `${s.name}:${s.fmt}`).join(' ') }, after: result.after?.[0] && { hash: result.after[0].hash, streams: result.after[0].streams.map((s: Any) => `${s.name}:${s.fmt}`).join(' ') }, errors: (result.errors ?? []).length, firstErrorFrame: firstErr ? { to: firstErr.to, i: firstErr.i, hash: firstErr.hash, streams: firstErr.streams, files: firstErr.files, total: firstErr.total, sw: firstErr.sw, accum: firstErr.accum } : null, perSwitch: ((result.switches ?? []) as Any[]).map((x) => ({ to: x.to, errorsAtEnd: x.rows[x.rows.length - 1].errors })) }, null, 1));
{
    const rows2 = allRows;
    let pe0 = 0; const idx = rows2.findIndex((r) => r.pe > pe0);
    console.log('first page error at', idx >= 0 ? JSON.stringify({ to: rows2[idx].to, i: rows2[idx].i }) : 'none', 'rows around:', idx >= 0 ? JSON.stringify(rows2.slice(Math.max(0, idx - 3), idx + 4).map((r) => ({ i: r.i, drawn: r.drawn, pe: r.pe, files: r.files, total: r.total, sw: r.sw, accum: r.accum, tex: r.streams && r.streams.split(' ')[0] }))) : '');
    console.log('pe per switch', JSON.stringify(((result.switches ?? []) as Any[]).map((x) => ({ to: x.to, pe: x.rows[x.rows.length - 1].pe }))));
}
console.log('written', file);
