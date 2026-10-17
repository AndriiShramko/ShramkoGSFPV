// v0.9 lane R, step 1: why did the owner's link https://superspl.at/scene/2f1ddf5f?budget=8&stochastic "not work"?
// Opens the link by every path a person has (the deep link in both spellings, the picker's field, the
// plain deep link) on a scene and prints, for each, what the page decided and what the engine draws with:
// stochastic (engine), the governor's top and current budget, the render scale, the address afterwards.
// Draws the scan: run it under the GPU lock (C:/dev/.gpu-lock).
//   SITE=http://127.0.0.1:5391 SCENE=2f1ddf5f npx tsx src/probe-v09-r-links.ts [P1 P2 ...]
import { mkdirSync, rmdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { launchChrome, waitReady } from './browser';
import { REPO, today } from './evidence';

const SITE = (process.env.SITE ?? 'http://127.0.0.1:5391').replace(/\/$/, '');
const SCENE = process.env.SCENE ?? '2f1ddf5f';
const SETTLE_MS = Number(process.env.SETTLE_MS ?? 12000);
const ONLY = process.argv.slice(2).map((x) => x.toUpperCase());
const want = (id: string) => ONLY.length === 0 || ONLY.includes(id);
const LOCK = 'C:/dev/.gpu-lock';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const link = `https://superspl.at/scene/${SCENE}?budget=8&stochastic`;

for (;;) {
    try { mkdirSync(LOCK); break; } catch { console.log('waiting for the GPU lock'); await sleep(15000); }
}
const release = (): void => { try { rmdirSync(LOCK); } catch { /* gone */ } };
process.on('SIGINT', () => { release(); process.exit(130); });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const STATE = `(() => { const h = window.__gsfpv; const s = h && h.session; const g = s && s.renderer && s.renderer.app.scene.gsplat;
  return { status: h && h.status, errorCode: h && h.errorCode, error: h && h.error, drawing: (h && h.drawing) || null,
    engineStochastic: g ? g.stochastic === true : null, engineBudgetM: g ? g.splatBudget / 1e6 : null, renderer: g ? g.currentRenderer : null,
    top: h && h.governor ? h.governor.topBudgetMillions : null, step: h && h.governor ? h.governor.step : null, changes: h && h.governor ? h.governor.changes : null,
    renderScale: s && s.renderer ? s.renderer.renderScale : null, search: location.search,
    note: (document.querySelector('.hud-note') || {}).textContent || '', picker: !!document.querySelector('.scenes'), pickerError: (document.querySelector('.scene-error') || {}).textContent || '' }; })()`;

const results: Record<string, Any> = {};
const { browser, which } = await launchChrome({ headless: false, args: ['--window-position=0,0', '--window-size=2600,1500'] });
try {
    // VIEW=2560x1440@1.5 is the owner's 4K monitor at 150 % (a 3840x2160 backbuffer)
    const vm = /^(\d+)x(\d+)@([\d.]+)$/.exec(process.env.VIEW ?? '1280x800@1')!;
    const ctx = await browser.newContext({ viewport: { width: Number(vm[1]), height: Number(vm[2]) }, deviceScaleFactor: Number(vm[3]) });
    await ctx.route('**/api/e', (r) => r.fulfill({ status: 204, body: '' }));
    await ctx.addInitScript('window.__name = window.__name || ((f) => f);');
    const page: Page = await ctx.newPage();
    const log: string[] = [];
    page.on('console', (m) => log.push(`${m.type()}: ${m.text()}`.slice(0, 240)));
    page.on('pageerror', (e) => log.push(`pageerror: ${e.message}`.slice(0, 240)));

    const settle = async (name: string, how: string, t0: number): Promise<void> => {
        let ready: Any;
        try { ready = await waitReady(page, 240000); } catch (e) { ready = { status: 'timeout', error: String(e) }; }
        const loadedMs = Date.now() - t0;
        // watch the governor while the view settles: a cascade shows as step / budget / render scale falling over time
        const timeline: Any[] = [];
        for (let waited = 0; waited < SETTLE_MS; waited += 2000) {
            await sleep(2000);
            timeline.push(await page.evaluate(`(() => { const h = window.__gsfpv; const s = h && h.session; const g = h && h.governor; const r = s && s.renderer; return r ? { step: g ? g.step : null, changes: g ? g.changes : null, budgetM: r.app.scene.gsplat.splatBudget / 1e6, scale: r.renderScale, w: r.canvas.width, h: r.canvas.height, period: r.latencyStats ? r.latencyStats().periodMs : null } : null; })()`));
        }
        const st = (await page.evaluate(STATE)) as Any;
        results[name] = { how, loadedMs, ready: ready.status, ...st, timeline, console: log.filter((l) => /error|warn/i.test(l)).slice(-6) };
        console.log(name, how, JSON.stringify({ ready: ready.status, loadedMs, stochastic: st.engineStochastic, budgetM: st.engineBudgetM, top: st.top, step: st.step, scale: st.renderScale, search: st.search, note: st.note, err: st.errorCode || st.error }));
        log.length = 0;
    };

    const open = async (name: string, how: string, qs: string): Promise<void> => {
        const t0 = Date.now();
        await page.goto(`${SITE}/en/fly/?${qs}&nowarn=1&input=touch`);
        await settle(name, how, t0);
    };

    if (want('P1')) await open('P1', 'deep link, scene= the whole link, percent-encoded (the landing)', `scene=${encodeURIComponent(link)}`);
    if (want('P2')) await open('P2', 'deep link, scene= the whole link pasted raw after ?scene=', `scene=${link}`);
    if (want('P3')) await open('P3', 'deep link, scene=<id>&budget=8&stochastic', `scene=${SCENE}&budget=8&stochastic`);
    if (want('P4')) {
        // the picker's own field: no scene in the address, type the link, Enter
        await page.goto(`${SITE}/en/fly/?nowarn=1&input=touch`);
        await page.waitForSelector('.scene-input', { timeout: 60000 });
        const t0 = Date.now();
        await page.fill('.scene-input', link);
        await page.press('.scene-input', 'Enter');
        await settle('P4', 'picker field, link typed, Enter', t0);
    }
    if (want('P5')) await open('P5', 'control: plain deep link (no parameters)', `scene=${SCENE}`);
    if (want('P6')) await open('P6', 'deep link with drawing=stochastic (the pilot setting)', `scene=${SCENE}&drawing=stochastic`);
    await ctx.close();
} finally {
    await browser.close().catch(() => undefined);
    release();
}
const out = join(REPO, 'evidence', today(), `v09-r-probe-links-${SCENE}${process.env.TAG ? '-' + process.env.TAG : ''}.json`);
mkdirSync(join(REPO, 'evidence', today()), { recursive: true });
writeFileSync(out, JSON.stringify({ site: SITE, scene: SCENE, browser: which, link, results }, null, 2));
console.log('written', out);
