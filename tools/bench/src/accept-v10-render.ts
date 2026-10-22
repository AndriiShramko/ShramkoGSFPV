// v0.10 lane R in the real page, with the real API and the admin (the owner's items 2, 3 and 4 of message 23): good quality
// by default (the page draws SORTED unless something asks otherwise), the device recognised and its class's preset started,
// the presets and the per-scene entries edited in the admin and live after Publish, the pilot's own settings above them,
// and REC drawing the clean picture while it runs. Draws the scan: run it under the GPU lock (C:/dev/.gpu-lock). The real
// API (apps/api/server.py) runs on a temporary DATA_DIR seeded with the catalogue snapshot and a TEST admin password hash (a
// made-up one in .cache/admin-test.json); the NEW release and the BASE release (the commit before this lane) are served
// by serve-csp (the live CSP) with /api going to that API. Every check has a control: the BASE build must do the old thing.
//   R1  a desktop, an interior (39e63ce9, 3.8 M splats), nothing asked: sorted in the engine and in the shader, class
//       desktop-strong from the browser's reading, 4 M, "from this device"; the picture IS the sorted picture (the same
//       view drawn with ?stochastic=0 is within 1 dB of silence: PSNR above 45 dB). Control: the BASE build draws
//       stochastic by default and its picture sits below 25 dB from the sorted one.
//   R2  the class of the device and its preset: a phone (user agent, touch, small screen), a tablet, a desktop whose pilot
//       names the weak class: budget and the render-scale cap of that class (the canvas is that many pixels); the Render
//       row of Settings says which class and what Auto draws. Controls: the BASE build gives the phone a full-size canvas,
//       and has no Device class setting.
//   R3  the admin's Drawing tab: the presets and the scenes' entries are there; a change is a draft (nothing live, a
//       fresh page still gets the built-in table), Publish makes it live (/api/catalog carries `drawing`; a fresh desktop
//       draws what the owner set, a fresh phone the phone's numbers), the history has the version, Reset all and Publish
//       bring the built-in table back. Controls: the BASE admin has no Drawing tab, and the BASE page ignores the owner's
//       preset.
//   R4  the order in the page: the pilot's Render and Splat budget settings beat the owner's preset, the scene's own entry
//       (set in the admin's table) beats the preset, a link's ?budget=&stochastic beats the pilot.
//   R5  REC: the scan is drawn sorted while it records and the pilot's drawing is back after the stop; a setting changed
//       during the recording waits for it. Control: the BASE build keeps drawing stochastic while it records.
//   R6  the share picture (L) of a stochastic view is one sorted frame and the drawing is back right after.
//   R7  (the review round) the pilot's own Splat budget holds above the preset on a phone, a tablet and a desktop without
//       WebGPU, and a phone that sends a DESKTOP user agent ("Request desktop site": more than one touch point, a 412 px
//       screen) is a phone: class phone, the phone's 2 M and 70 %, never stochastic. Controls: the build BEFORE the review
//       round (PRE_DIST, the lane's first release 459ec16) drops the heavier budget and calls the same device a strong desktop.
//   SITE_DIST=.cache/dist-v10r BASE_DIST=.cache/dist-base npx tsx src/accept-v10-render.ts [R1 R2 ...]   (from tools/bench)
//   SITE_DIST=dist PRE_DIST=.cache/dist-pre-review npx tsx src/accept-v10-render.ts R7   (R7 alone needs no BASE build)
// Evidence: evidence/<date>/v10-render.json (+ v10-render-*.png of the admin tab); R7 alone: v10-render-review.json.
import { spawn, execFileSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import type { Browser, BrowserContext, Page } from 'playwright';
import { launchChrome, waitReady } from './browser';
import { REPO, today, writeEvidence } from './evidence';

const DIST = join(REPO, process.env.SITE_DIST ?? join('.cache', 'dist-v10r'));
const BASE_DIST = join(REPO, process.env.BASE_DIST ?? join('.cache', 'dist-base'));
const PRE_DIST = join(REPO, process.env.PRE_DIST ?? join('.cache', 'dist-pre-review'));
const API_PORT = 8000 + Math.floor(Math.random() * 900);
const NEW_PORT = API_PORT + 1000;
const BASE_PORT = API_PORT + 2000;
const PRE_PORT = API_PORT + 3000;
const NEW = `http://127.0.0.1:${NEW_PORT}`;
const BASE = `http://127.0.0.1:${BASE_PORT}`;
const PRE = `http://127.0.0.1:${PRE_PORT}`;
const ROOM = '39e63ce9'; // Modlinek Villa, red room and bathroom: 3.8 M splats, a small interior
const ONLY = process.argv.slice(2).map((x) => x.toUpperCase());
const want = (id: string): boolean => ONLY.length === 0 || ONLY.includes(id);
/** Which release builds this run needs: the BASE build (the commit before the lane) for R1-R6, the PRE build (before the review round) for R7. */
const needBase = ONLY.length === 0 || ONLY.some((x) => x !== 'R7');
const needPre = want('R7');
const LOCK = 'C:/dev/.gpu-lock';
const PHONE_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
const TABLET_UA = 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
/** What Android Chrome sends in "Request desktop site" mode: a Linux desktop. */
const DESKTOP_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const EN = JSON.parse(readFileSync(join(REPO, 'packages', 'i18n', 'locales', 'fly', 'drawing', 'en.json'), 'utf8')) as Record<string, string>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const hook = <T = Any>(p: Page, body: string): Promise<T> => p.evaluate(`(() => { const h = window.__gsfpv; const s = h.session; ${body} })()`) as Promise<T>;

const TMP = join(REPO, '.cache');
mkdirSync(TMP, { recursive: true });
const DATA = mkdtempSync(join(TMP, 'gsfpv-v10-api-'));
const children: ChildProcess[] = [];
const out: Record<string, unknown> = {};
const pass: Record<string, boolean> = {};
const checks: { name: string; ok: boolean; control: boolean }[] = [];
function check(name: string, ok: boolean, control = false): boolean {
    checks.push({ name, ok, control });
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${control ? '[control] ' : ''}${name}`);
    return ok;
}

for (;;) {
    try { mkdirSync(LOCK); break; } catch { console.log('waiting for the GPU lock'); await sleep(Number(process.env.LOCK_POLL_MS ?? 3000)); }
}
const release = (): void => { try { rmdirSync(LOCK); } catch { /* gone */ } };
process.on('SIGINT', () => { release(); process.exit(130); });

function testSecret(): { password: string; hash: string } {
    const f = join(REPO, '.cache', 'admin-test.json');
    if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'));
    const password = `test-${randomBytes(12).toString('base64url')}`;
    const line = execFileSync('python', [join(REPO, 'tools', 'admin', 'hash_password.py'), '--stdin'], { input: `${password}\n` }).toString().trim();
    const s = { password, hash: line.slice('ADMIN_PASSWORD_HASH='.length) };
    writeFileSync(f, JSON.stringify(s));
    return s;
}

async function until(url: string, ms = 30000): Promise<void> {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
        try { if ((await fetch(url)).status < 500) return; } catch { /* not up yet */ }
        await sleep(250);
    }
    throw new Error(`${url} did not come up`);
}

/**
 * A fresh context: a desktop, a phone or a tablet (user agent, touch, screen). 'desktopSitePhone': a phone in "Request desktop
 * site" mode: a desktop user agent, Client Hints not mobile, the phone's 412 px screen and 5 touch points (Playwright's hasTouch
 * reports one point; a phone reports five or ten). `init`: one more script that runs before the page's own.
 */
async function context(browser: Browser, kind: 'desktop' | 'phone' | 'tablet' | 'desktopSitePhone' = 'desktop', init?: string): Promise<{ ctx: BrowserContext; page: Page; log: string[] }> {
    const ctx = await browser.newContext(kind === 'phone'
        ? { viewport: { width: 412, height: 915 }, screen: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: PHONE_UA }
        : kind === 'tablet'
            ? { viewport: { width: 820, height: 1180 }, screen: { width: 820, height: 1180 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: TABLET_UA }
            : kind === 'desktopSitePhone'
                ? { viewport: { width: 412, height: 915 }, screen: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: false, hasTouch: true, userAgent: DESKTOP_UA }
                : { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    await ctx.route('**/api/e', (r) => r.fulfill({ status: 204, body: '' }));
    await ctx.addInitScript('window.__name = window.__name || ((f) => f);');
    if (kind === 'desktopSitePhone') await ctx.addInitScript("Object.defineProperty(Navigator.prototype, 'maxTouchPoints', { get: () => 5 });");
    if (init) await ctx.addInitScript(init);
    await ctx.addInitScript({ content: "try { localStorage.setItem('gsfpv.warned', '1'); } catch (e) {}" });
    const page = await ctx.newPage();
    const log: string[] = [];
    page.on('console', (m) => log.push(`${m.type()}: ${m.text()}`.slice(0, 300)));
    page.on('pageerror', (e) => log.push(`pageerror: ${e.message}`.slice(0, 300)));
    return { ctx, page, log };
}
const errors = (log: string[]): string[] => log.filter((l) => l.startsWith('pageerror'));

/** The drawing as the page decided it and as the engine really has it, the resolution, F3's line (a string run in the page). */
const STATE = `const g = s.renderer.app.scene.gsplat; const dir = s.renderer.app.renderer.gsplatDirector; let hybrid = null;
  if (dir) for (const cd of dir.camerasMap.values()) for (const ld of cd.layersMap.values()) { const m = ld.gsplatManager; const r = m && m.renderer; if (r) hybrid = { gpuSort: r.usesGpuSort === true, stochastic: r.stochastic === true, define: r._material ? !!r._material.getDefine('GSPLAT_STOCHASTIC') : null }; }
  return { status: h.status, drawing: h.drawing ?? null, engine: g.stochastic === true, drawn: s.renderer.drawn ?? null, hybrid, top: h.governor ? h.governor.topBudgetMillions : null, budgetM: g.splatBudget / 1e6, scale: s.renderer.renderScale, canvas: [s.renderer.canvas.width, s.renderer.canvas.height], css: [s.renderer.canvas.clientWidth, s.renderer.canvas.clientHeight], dpr: window.devicePixelRatio, search: location.search, note: (document.querySelector('.hud-note') || {}).textContent || '', f3: (document.querySelector('[data-testid=drawing-line]') || {}).textContent || '' };`;
// v0.11: "stochastic" is drawn by the engine's own dither (v0.10, and `?impl=engine`) or by the vendored accumulating renderer, which switches the
// engine's own renderer off (the engine flag and the shader define read false then); `drawn` (the hook, null before v0.11) tells them apart.
const notAccum = (st: Any): boolean => st.drawn == null || st.drawn === 'sorted' || st.drawn === 'engine';
const sorted = (st: Any): boolean => st.engine === false && st.hybrid?.stochastic === false && st.hybrid?.define === false && st.hybrid?.gpuSort === true && (st.drawn == null || st.drawn === 'sorted');
const dither = (st: Any): boolean => st.engine === true && st.hybrid?.stochastic === true && st.hybrid?.define === true && st.hybrid?.gpuSort === true && notAccum(st);
const stochastic = (st: Any): boolean => dither(st) || st.drawn === 'accum';
/** the fields R5 keeps of a state, drawn included */
const draws = (x: Any): boolean => (x.engine === true && x.hybrid?.stochastic === true && x.hybrid?.define === true && notAccum(x)) || x.drawn === 'accum';
const drawsSorted = (x: Any): boolean => x.engine === false && x.hybrid?.stochastic === false && x.hybrid?.define === false && (x.drawn == null || x.drawn === 'sorted');

async function open(p: Page, site: string, qs: string, timeout = 240000): Promise<Any> {
    await p.goto(`${site}/en/fly/?${qs}&nowarn=1&input=touch`);
    const r = await waitReady(p, timeout);
    if (r.status !== 'ready') return { status: r.status, error: r.error };
    await sleep(900);
    return hook(p, STATE);
}
const state = (p: Page): Promise<Any> => hook(p, STATE);
async function f3(p: Page): Promise<string> {
    const shown = await p.evaluate(() => !!document.querySelector('.hud .osd.frame:not(.hidden)'));
    if (!shown) await p.keyboard.press('F3');
    await sleep(700);
    return p.evaluate(() => (document.querySelector('[data-testid=drawing-line]') || {} as Element).textContent || '');
}
/** Settings (O): the Render row's live line and notes, then closed again. */
async function settingsRow(p: Page): Promise<{ line: string; notes: string[] }> {
    await p.keyboard.press('KeyO');
    // every group's rows are in the DOM, the Display group's section is hidden until its rail button is picked: read it attached
    await p.waitForSelector('[data-testid=drawing-row-line]', { state: 'attached', timeout: 10000 });
    await sleep(300);
    const r = await p.evaluate(() => ({ line: (document.querySelector('[data-testid=drawing-row-line]') || {} as Element).textContent || '', notes: [...document.querySelectorAll('.sr-extra-notes p')].map((e) => e.textContent || '') }));
    await p.keyboard.press('Escape');
    await sleep(300);
    return r;
}
async function waitComplete(p: Page, ms = 90000): Promise<void> {
    for (let t0 = Date.now(); Date.now() - t0 < ms;) { if (await hook<boolean>(p, 'return s.renderer.sceneComplete;')) break; await sleep(500); }
    await sleep(1200);
}
const setPref = (p: Page, id: string, v: unknown): Promise<unknown> => p.evaluate(`window.__gsfpv.prefs.set(${JSON.stringify(id)}, ${JSON.stringify(v)})`);
const sleepFrames = async (p: Page, n: number): Promise<void> => { await hook(p, `return new Promise((res) => { let k = 0; const on = () => { if (++k >= ${n}) { s.renderer.app.off('frameend', on); res(0); } }; s.renderer.app.on('frameend', on); });`); };

/** The luma of the view the page draws NOW at 1280x720, still camera: base64 of W*H bytes. */
async function grabLuma(p: Page): Promise<string> {
    return p.evaluate(`(async () => {
      const h = window.__gsfpv; const s = h.session; const r = s.renderer; const app = r.app; const W = 1280, H = 720;
      s.pause(true, 'bake'); s.cameraOverride = true; r.setFixedResolution({ w: W, h: H });
      const next = () => new Promise((res) => app.once('frameend', res));
      for (let i = 0; i < 24; i++) await next();
      const c = new OffscreenCanvas(W, H); const x = c.getContext('2d', { willReadFrequently: true });
      const d = await new Promise((res) => app.once('frameend', () => { x.drawImage(r.canvas, 0, 0, W, H); res(x.getImageData(0, 0, W, H).data); }));
      const o = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) o[i] = Math.round(0.299 * d[4 * i] + 0.587 * d[4 * i + 1] + 0.114 * d[4 * i + 2]);
      let bin = ''; for (let i = 0; i < o.length; i += 8192) bin += String.fromCharCode.apply(null, o.subarray(i, i + 8192));
      return btoa(bin);
    })()`) as Promise<string>;
}
function psnr(a: string, b: string): number {
    const x = Buffer.from(a, 'base64'), y = Buffer.from(b, 'base64');
    let e = 0;
    for (let i = 0; i < x.length; i++) { const d = x[i] - y[i]; e += d * d; }
    e /= x.length;
    return e === 0 ? 99 : Math.round(10 * Math.log10(255 * 255 / e) * 100) / 100;
}

const saved = (page: Page): Promise<unknown> => page.waitForFunction(() => {
    const s = document.querySelector('[data-testid=draft-status]');
    return s && !s.textContent?.includes('…') && (s.classList.contains('warn') || s.classList.contains('ok'));
}, null, { timeout: 20000 });
async function adminLogin(page: Page, origin: string, password: string): Promise<void> {
    await page.goto(`${origin}/admin/`);
    await page.fill('[data-testid=password]', password);
    await page.press('[data-testid=password]', 'Enter');
    await page.waitForSelector('[data-testid=scene-list] li.row', { timeout: 30000 });
}
async function publish(page: Page): Promise<void> {
    await page.click('[data-action=publish]');
    await page.waitForFunction(() => document.querySelector('[data-testid=draft-status]')?.classList.contains('ok'), null, { timeout: 20000 });
}
const apiCatalog = async (): Promise<Any> => (await fetch(`http://127.0.0.1:${API_PORT}/api/catalog`, { cache: 'no-store' })).json();
const dataFile = (name: string): Any => { const f = join(DATA, name); return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null; };

async function main(): Promise<void> {
    const secret = testSecret();
    mkdirSync(join(REPO, 'evidence', today()), { recursive: true });
    const snap = JSON.parse(readFileSync(join(REPO, 'apps', 'site', 'src', 'generated', 'catalog.json'), 'utf8'));
    writeFileSync(join(DATA, 'catalog.json'), JSON.stringify({ v: 1, published: snap.published, collections: snap.collections, scenes: snap.scenes }));
    const api = spawn('python', [join(REPO, 'apps', 'api', 'server.py')], {
        env: { ...process.env, DATA_DIR: DATA, PORT: String(API_PORT), ADMIN_PASSWORD_HASH: secret.hash, TG_BOT_TOKEN: '', TG_CHAT_ID: '', MIN_FREE_GB: '0', PUBLIC_ORIGIN: 'https://gsfpv.flyreelstudio.eu' },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    children.push(api);
    let apiLog = '';
    api.stdout.on('data', (b) => { apiLog += String(b); });
    api.stderr.on('data', (b) => { apiLog += String(b); });
    const servers: (readonly [string, number, string])[] = [[DIST, NEW_PORT, NEW]];
    if (needBase) servers.push([BASE_DIST, BASE_PORT, BASE]);
    if (needPre) servers.push([PRE_DIST, PRE_PORT, PRE]);
    for (const [dist, port] of servers) {
        children.push(spawn('node', [join(REPO, 'tools', 'bench', 'scripts', 'serve-csp.mjs'), dist, String(port)], { env: { ...process.env, API_PROXY: `http://127.0.0.1:${API_PORT}` }, stdio: 'ignore' }));
    }
    await until(`http://127.0.0.1:${API_PORT}/api/health`);
    for (const [, , origin] of servers) await until(`${origin}/en/`);
    out.build = { new: DIST.replace(REPO, '.'), base: needBase ? BASE_DIST.replace(REPO, '.') : null, pre: needPre ? PRE_DIST.replace(REPO, '.') : null };

    const { browser, which } = await launchChrome({ headless: false, args: ['--window-position=40,40', '--window-size=1296,920'] });
    out.browser = which;
    try {
        // ------------------------------------------------------------------ R1
        if (want('R1')) {
            const a = await context(browser);
            const st = await open(a.page, NEW, `scene=${ROOM}`);
            const line = await f3(a.page);
            await waitComplete(a.page);
            const newDefault = await grabLuma(a.page);
            await a.ctx.close();
            const b = await context(browser);
            const stSorted = await open(b.page, NEW, `scene=${ROOM}&stochastic=0`);
            await waitComplete(b.page);
            const newSorted = await grabLuma(b.page);
            await b.ctx.close();
            const c = await context(browser);
            const stBase = await open(c.page, BASE, `scene=${ROOM}`);
            await waitComplete(c.page);
            const baseDefault = await grabLuma(c.page);
            await c.ctx.close();
            const same = psnr(newDefault, newSorted), baseVsSorted = psnr(baseDefault, newSorted);
            out.R1 = { new: { drawing: st.drawing, top: st.top, hybrid: st.hybrid, f3: line }, linkSorted: { drawing: stSorted.drawing }, base: { drawing: stBase.drawing, top: stBase.top, hybrid: stBase.hybrid }, psnrDefaultVsSorted: same, psnrBaseDefaultVsSorted: baseVsSorted, pageerrors: errors(a.log) };
            check('R1 control: the BASE build draws a desktop interior stochastic by default (engine, shader, from the device)', stochastic(stBase) && stBase.drawing?.from?.stochastic === 'device', true);
            check('R1 desktop, nothing asked: sorted in the engine and in the shader, 4 M, decided by this device (its class preset)', sorted(st) && st.top === 4 && st.drawing?.stochastic === false && st.drawing?.from?.stochastic === 'device' && st.drawing?.from?.budget === 'device' && st.drawing?.note === null);
            check('R1 the class is read from the browser: desktop-strong (reasons: strong), with the GPU the engine got', st.drawing?.class === 'desktop-strong' && st.drawing?.classAuto === 'desktop-strong' && st.drawing?.classPicked === false && JSON.stringify(st.drawing?.classReasons) === '["strong"]' && !!st.drawing?.gpu);
            check('R1 F3 names what draws and the class', /^Render: sorted \(this device\) . budget 4 M splats \(this device\) . desktop, strong graphics$/.test(line));
            check(`R1 the default picture IS the sorted picture: ${same} dB against ?stochastic=0 (above 45)`, same > 45 && sorted(stSorted));
            check(`R1 control: the BASE default picture is ${baseVsSorted} dB from the sorted one (below 25: the grain and the colour shift)`, baseVsSorted < 25, true);
            pass.R1 = errors(a.log).length === 0;
        }

        // ------------------------------------------------------------------ R2
        if (want('R2')) {
            const rows: Record<string, Any> = {};
            // a phone: user agent, touch, small screen; and the same on the BASE build
            for (const [kind, ua] of [['phone', 'phone'], ['tablet', 'tablet']] as const) {
                const n = await context(browser, ua);
                const st = await open(n.page, NEW, `scene=${ROOM}`);
                await waitComplete(n.page, 60000);
                const after = await state(n.page);
                rows[kind] = { drawing: st.drawing, top: st.top, scale: after.scale, canvas: after.canvas, css: after.css, dpr: after.dpr };
                await n.ctx.close();
                const o = await context(browser, ua);
                const stOld = await open(o.page, BASE, `scene=${ROOM}`);
                await waitComplete(o.page, 60000);
                const oldAfter = await state(o.page);
                rows[`${kind}Base`] = { top: stOld.top, scale: oldAfter.scale, canvas: oldAfter.canvas };
                await o.ctx.close();
                const preset = kind === 'phone' ? { budgetM: 2, renderScale: 0.7 } : { budgetM: 2, renderScale: 0.85 };
                const wantPx = Math.round(after.css[0] * after.dpr * preset.renderScale);
                check(`R2 a ${kind}: class ${kind}, sorted, ${preset.budgetM} M, resolution capped at ${preset.renderScale * 100} % (the canvas is ${after.canvas[0]} px wide, ${wantPx} expected), no note`,
                    st.drawing?.class === kind && st.drawing?.classAuto === kind && st.drawing?.stochastic === false && st.top === preset.budgetM && st.drawing?.renderScale === preset.renderScale && after.scale === preset.renderScale && Math.abs(after.canvas[0] - wantPx) <= 2 && st.drawing?.note === null);
                check(`R2 control: the BASE build draws the same ${kind} at the full ${after.css[0] * after.dpr} px width (scale ${oldAfter.scale})`, oldAfter.scale === 1 && Math.abs(oldAfter.canvas[0] - oldAfter.css[0] * oldAfter.dpr) <= 2, true);
            }
            // a desktop whose pilot names the weak class: the weak preset, the row says so
            const d = await context(browser);
            const st0 = await open(d.page, NEW, `scene=${ROOM}`);
            const row0 = await settingsRow(d.page);
            await setPref(d.page, 'display.deviceClass', 'desktop-weak');
            await sleep(800);
            const st1 = await state(d.page);
            const row1 = await settingsRow(d.page);
            rows.desktop = { drawing: st0.drawing, row: row0 };
            rows.weakNamed = { drawing: st1.drawing, top: st1.top, scale: st1.scale, row: row1 };
            check('R2 the Render row of Settings says the class, the GPU and what Auto draws (desktop-strong: sorted, up to 4 M, 100 %)', /^This device: desktop, strong graphics \(.+\)\. Auto draws sorted, up to 4 M splats, at 100 % of the screen's resolution\.$/.test(row0.line) && row0.notes.length === 0);
            check('R2 a pilot who names the weak desktop class gets its preset: class desktop-weak (picked, the browser said desktop-strong), 2.5 M, scale 85 %, sorted', st1.drawing?.class === 'desktop-weak' && st1.drawing?.classPicked === true && st1.drawing?.classAuto === 'desktop-strong' && st1.top === 2.5 && st1.scale === 0.85 && sorted(st1));
            check('R2 the row follows: it names the class the pilot chose and what the browser says', /^This device: desktop, weak graphics/.test(row1.line) && row1.notes.some((x) => /You named this class; the browser says: desktop, strong graphics\./.test(x)));
            await d.ctx.close();
            const e = await context(browser);
            await open(e.page, BASE, `scene=${ROOM}`);
            const hasSetting = await e.page.evaluate(`(() => { try { window.__gsfpv.prefs.set('display.deviceClass', 'desktop-weak'); return window.__gsfpv.prefs.get('display.deviceClass'); } catch (err) { return 'throws: ' + String(err.message || err).slice(0, 60); } })()`);
            const stOldAfter = await state(e.page);
            rows.baseDeviceClass = { result: hasSetting, top: stOldAfter.top };
            check('R2 control: the BASE build has no Device class setting (the call fails or changes nothing: still 4 M stochastic)', stochastic(stOldAfter) && stOldAfter.top === 4, true);
            await e.ctx.close();
            out.R2 = rows;
            pass.R2 = true;
        }

        // ------------------------------------------------------------------ R3, R4: the admin and what a device gets after Publish
        if (want('R3') || want('R4')) {
            const adminCtx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
            await adminCtx.addInitScript({ content: "try { localStorage.setItem('gsfpv.warned', '1'); } catch (e) {}" });
            const admin = await adminCtx.newPage();
            const adminErrors: string[] = [];
            admin.on('pageerror', (e) => adminErrors.push(String(e.message).slice(0, 200)));
            admin.on('dialog', (dlg) => void dlg.accept());
            await adminLogin(admin, NEW, secret.password);
            await admin.click('.tab[data-tab=drawing]');
            await admin.waitForSelector('[data-testid=drawing-presets] .preset-row[data-class]', { timeout: 15000 });
            const classes = await admin.$$eval('[data-testid=drawing-presets] .preset-row[data-class]', (rs) => rs.map((r) => (r as HTMLElement).dataset.class));
            const sceneRows = await admin.$$eval('[data-testid=drawing-scenes] li.row', (rs) => rs.length);
            const shown = await admin.$$eval('[data-testid=drawing-presets] .preset-row[data-class]', (rs) => rs.map((r) => ({ cls: (r as HTMLElement).dataset.class, drawing: (r.querySelector('[data-field=drawing]') as HTMLSelectElement).value, budget: (r.querySelector('[data-field=budgetM]') as HTMLInputElement).value, scale: (r.querySelector('[data-field=renderScale]') as HTMLInputElement).value })));
            const snapScenes = (JSON.parse(readFileSync(join(REPO, 'apps', 'site', 'src', 'generated', 'catalog.json'), 'utf8')).scenes as Any[]).length;
            check('R3 the Drawing tab lists the four classes, each with its built-in values (sorted, 4 / 2.5 / 2 / 2 M, 100 / 85 / 85 / 70 %), and every scene of the catalogue',
                JSON.stringify(classes) === '["desktop-strong","desktop-weak","tablet","phone"]' && JSON.stringify(shown.map((r) => [r.drawing, Number(r.budget), Number(r.scale)])) === '[["sorted",4,100],["sorted",2.5,85],["sorted",2,85],["sorted",2,70]]' && sceneRows === snapScenes);
            await admin.screenshot({ path: join(REPO, 'evidence', today(), 'v10-render-admin-drawing-before.png') });

            // the owner's change: the strong desktop draws stochastic at 6 M, the phone 1.5 M at 60 %; a draft first
            const strong = '[data-testid=drawing-presets] .preset-row[data-class=desktop-strong]';
            const phone = '[data-testid=drawing-presets] .preset-row[data-class=phone]';
            await admin.selectOption(`${strong} [data-field=drawing]`, 'stochastic');
            await admin.fill(`${strong} [data-field=budgetM]`, '6');
            await admin.fill(`${phone} [data-field=budgetM]`, '1.5');
            await admin.fill(`${phone} [data-field=renderScale]`, '60');
            await saved(admin);
            const draft = dataFile('catalog-draft.json');
            const liveBefore = await apiCatalog();
            const markText = await admin.$eval(`${strong} .preset-mark`, (e) => e.textContent ?? '');
            check('R3 a change is saved as a draft on the server with only the fields the owner touched, marked "changed" in the row', JSON.stringify(draft?.drawing) === JSON.stringify({ presets: { 'desktop-strong': { drawing: 'stochastic', budgetM: 6 }, phone: { budgetM: 1.5, renderScale: 0.6 } } }) && markText === 'changed');
            check('R3 the draft is not live: /api/catalog has no drawing yet', liveBefore.drawing === undefined);
            const d1 = await context(browser);
            const stDraft = await open(d1.page, NEW, `scene=${ROOM}`);
            await d1.ctx.close();
            check('R3 control: a fresh desktop page still gets the built-in table while it is a draft (sorted, 4 M)', sorted(stDraft) && stDraft.top === 4 && stDraft.drawing?.owner === null, true);

            await publish(admin);
            const live = await apiCatalog();
            const history = await admin.$$eval('.history li', (l) => l.length);
            check('R3 Publish: /api/catalog carries the owner\'s drawing (and the history has the version)', JSON.stringify(live.drawing) === JSON.stringify({ presets: { 'desktop-strong': { drawing: 'stochastic', budgetM: 6 }, phone: { budgetM: 1.5, renderScale: 0.6 } } }) && history >= 1);

            // what a device gets now
            const d2 = await context(browser);
            const stOwner = await open(d2.page, NEW, `scene=${ROOM}`);
            const lineOwner = await f3(d2.page);
            const rowOwner = await settingsRow(d2.page);
            const rows: Record<string, Any> = { desktopPublished: { drawing: stOwner.drawing, top: stOwner.top, hybrid: stOwner.hybrid, f3: lineOwner, row: rowOwner } };
            check('R3 a fresh desktop draws what the owner set: stochastic at 6 M in the engine and the shader, still "from this device"', stochastic(stOwner) && stOwner.top === 6 && stOwner.drawing?.from?.stochastic === 'device' && stOwner.drawing?.from?.budget === 'device' && stOwner.drawing?.owner?.presets?.['desktop-strong']?.budgetM === 6);
            check('R3 F3 and the Render row say so, and that the owner changed the preset', /^Render: stochastic(?:, accumulating)? \(this device\) . budget 6 M splats \(this device\) . desktop, strong graphics$/.test(lineOwner) && /Auto draws stochastic, up to 6 M splats, at 100 %/.test(rowOwner.line) && rowOwner.notes.includes(EN['drawing.row.owner']));

            // R4: the pilot's own settings and the scene's own entry over the owner's preset
            if (want('R4')) {
                await setPref(d2.page, 'display.drawing', 'sorted');
                await sleep(800);
                const s1 = await state(d2.page);
                await setPref(d2.page, 'display.budget', '2');
                await sleep(800);
                const s2 = await state(d2.page);
                await setPref(d2.page, 'display.drawing', 'auto');
                await setPref(d2.page, 'display.budget', 'auto');
                await sleep(800);
                const s3 = await state(d2.page);
                rows.pilot = { sorted: s1.drawing, budget2: s2.drawing, backToAuto: s3.drawing };
                check('R4 the pilot\'s Render = Sorted beats the owner\'s stochastic preset (from "your setting")', sorted(s1) && s1.drawing?.from?.stochastic === 'setting' && s1.top === 6);
                check('R4 the pilot\'s Splat budget 2 M beats the owner\'s 6 M (from "your setting")', s2.top === 2 && s2.drawing?.from?.budget === 'setting');
                check('R4 back to Auto: the owner\'s preset again (stochastic, 6 M, this device)', stochastic(s3) && s3.top === 6 && s3.drawing?.from?.stochastic === 'device');
                await d2.ctx.close();
                // a link beats the pilot's settings: sorted setting, a link asking stochastic at 3 M
                const l = await context(browser);
                const stLink = await open(l.page, NEW, `scene=${ROOM}&budget=3&stochastic`);
                await setPref(l.page, 'display.drawing', 'sorted');
                await sleep(800);
                const stLinkAfter = await state(l.page);
                rows.link = { drawing: stLink.drawing, afterSetting: stLinkAfter.drawing };
                check('R4 a link\'s ?budget=3&stochastic beats everything below it: stochastic at 3 M from the link', stochastic(stLink) && stLink.top === 3 && stLink.drawing?.from?.stochastic === 'link' && stLink.drawing?.from?.budget === 'link');
                check('R4 a setting changed in flight beats the link for that scene (sorted, the link\'s 3 M kept)', sorted(stLinkAfter) && stLinkAfter.top === 3 && stLinkAfter.drawing?.from?.stochastic === 'setting');
                await l.ctx.close();
            } else {
                await d2.ctx.close();
            }

            // a phone gets the owner's phone numbers
            const ph = await context(browser, 'phone');
            const stPhone = await open(ph.page, NEW, `scene=${ROOM}`);
            await waitComplete(ph.page, 60000);
            const afterPhone = await state(ph.page);
            rows.phonePublished = { drawing: stPhone.drawing, top: stPhone.top, scale: afterPhone.scale };
            check('R3 a fresh phone gets the owner\'s phone preset: 1.5 M, 60 % (and still sorted: the owner\'s stochastic is for the desktop class)', stPhone.top === 1.5 && afterPhone.scale === 0.6 && stPhone.drawing?.class === 'phone' && stPhone.drawing?.stochastic === false && stPhone.drawing?.note === null);
            await ph.ctx.close();
            // control: the BASE page ignores the owner's preset (it draws its own default: stochastic at 4 M)
            const bo = await context(browser);
            const stBaseOwner = await open(bo.page, BASE, `scene=${ROOM}`);
            rows.baseIgnores = { top: stBaseOwner.top, hybrid: stBaseOwner.hybrid };
            check('R3 control: the BASE page, served the same catalogue, ignores the owner\'s preset (stochastic at its own 4 M, not 6)', stochastic(stBaseOwner) && stBaseOwner.top === 4, true);
            await bo.ctx.close();

            // the scene's own entry (the admin's table) beats the preset: 39e63ce9 sorted at 5 M while the preset says stochastic 6 M
            const entry = `[data-testid=drawing-scenes] li.row[data-scene="${ROOM}"]`;
            await admin.selectOption(`${entry} [data-field=render]`, 'sorted');
            await admin.fill(`${entry} [data-field=budgetM]`, '5');
            await saved(admin);
            await publish(admin);
            const pubScene = (dataFile('catalog.json').scenes as Any[]).find((s) => s.id === ROOM);
            const s4 = await context(browser);
            const stEntry = await open(s4.page, NEW, `scene=${ROOM}`);
            rows.entry = { published: pubScene?.render, drawing: stEntry.drawing, top: stEntry.top };
            check('R3 the admin table writes the scene\'s own render ({budgetM 5, stochastic false}) into the catalogue', JSON.stringify(pubScene?.render) === JSON.stringify({ budgetM: 5, stochastic: false }));
            if (want('R4')) check('R4 the scene\'s own entry beats the owner\'s preset: sorted at 5 M, from "the scene\'s entry" (the preset says stochastic 6 M)', sorted(stEntry) && stEntry.top === 5 && stEntry.drawing?.from?.stochastic === 'scene' && stEntry.drawing?.from?.budget === 'scene');
            await s4.ctx.close();

            // Reset all, Publish: the built-in table is back
            await admin.selectOption(`${entry} [data-field=render]`, '');
            await admin.fill(`${entry} [data-field=budgetM]`, '');
            await admin.click('[data-action=drawing-reset-all]');
            await saved(admin);
            await publish(admin);
            const liveAfter = await apiCatalog();
            const s5 = await context(browser);
            const stBack = await open(s5.page, NEW, `scene=${ROOM}`);
            await s5.ctx.close();
            const versions = await admin.$$eval('.history li button[data-version]', (b) => b.length);
            rows.reset = { drawingKey: liveAfter.drawing, drawing: stBack.drawing, versions };
            check('R3 Reset all + Publish: /api/catalog has no drawing again, a fresh desktop is back on sorted 4 M, and the history kept every version', liveAfter.drawing === undefined && sorted(stBack) && stBack.top === 4 && stBack.drawing?.owner === null && versions >= 3);
            await admin.screenshot({ path: join(REPO, 'evidence', today(), 'v10-render-admin-drawing-after.png') });
            out.R3 = rows;

            // the BASE admin has no such tab
            const baseCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
            await baseCtx.addInitScript({ content: "try { localStorage.setItem('gsfpv.warned', '1'); } catch (e) {}" });
            const baseAdmin = await baseCtx.newPage();
            await adminLogin(baseAdmin, BASE, secret.password);
            check('R3 control: the BASE build\'s admin has no Drawing tab', await baseAdmin.$('.tab[data-tab=drawing]') === null, true);
            await baseCtx.close();
            check('R3 the admin page raised no errors; the password is in no log or data file', adminErrors.length === 0 && !(apiLog + readFileSync(join(DATA, 'catalog.json'), 'utf8')).includes(secret.password));
            out.adminErrors = adminErrors;
            pass.R3 = true;
            pass.R4 = want('R4');
            await adminCtx.close();
        }

        // ------------------------------------------------------------------ R5 REC draws sorted
        if (want('R5')) {
            const rec = async (site: string): Promise<Any> => {
                const n = await context(browser);
                const before = await open(n.page, site, `scene=${ROOM}&stochastic&governor=0`);
                await waitComplete(n.page, 60000);
                await n.page.waitForSelector('[data-testid=rec-bar] [data-action=cinema-rec]', { timeout: 10000 });
                const pre = await state(n.page);
                await n.page.evaluate("document.querySelector('[data-testid=rec-bar] [data-action=cinema-rec]').click()");
                await n.page.waitForFunction(() => { const d = document.querySelector('[data-testid=rec-dot]'); return !!d && !(d as HTMLElement).hidden; }, null, { timeout: 20000 });
                await sleep(1500);
                const during = await state(n.page);
                const lineDuring = await f3(n.page);
                // the pilot changes Render while recording: it waits for the recording
                await setPref(n.page, 'display.drawing', 'stochastic').catch(() => undefined);
                await sleep(600);
                const duringSetting = await state(n.page);
                await setPref(n.page, 'display.drawing', 'auto').catch(() => undefined);
                await n.page.evaluate("document.querySelector('[data-testid=rec-bar] [data-action=cinema-rec]').click()");
                await n.page.waitForFunction(() => { const d = document.querySelector('[data-testid=rec-dot]'); return !d || (d as HTMLElement).hidden; }, null, { timeout: 30000 });
                await sleep(1200);
                const after = await state(n.page);
                const lineAfter = await f3(n.page);
                const res = { before: before.drawing, pre: { engine: pre.engine, drawn: pre.drawn, hybrid: pre.hybrid }, during: { engine: during.engine, drawn: during.drawn, hybrid: during.hybrid, drawing: during.drawing, note: during.note, f3: lineDuring }, duringSetting: { engine: duringSetting.engine, drawn: duringSetting.drawn, hybrid: duringSetting.hybrid }, after: { engine: after.engine, drawn: after.drawn, hybrid: after.hybrid, drawing: after.drawing, f3: lineAfter }, errors: errors(n.log) };
                await n.ctx.close();
                return res;
            };
            const r = await rec(NEW);
            const base = await rec(BASE);
            out.R5 = { new: r, base };
            check('R5 control: the BASE build keeps drawing stochastic while it records (the grain goes into the file)', base.pre.engine === true && base.during.engine === true && base.after.engine === true, true);
            check('R5 before REC the link\'s stochastic draws (engine and shader)', draws(r.pre));
            check('R5 while REC runs the scan is drawn sorted (engine and shader), the hook says the hold is on, F3 says "sorted (recording)"', drawsSorted(r.during) && r.during.drawing?.held === true && /^Render: sorted \(recording\)/.test(r.during.f3));
            check('R5 the HUD says once that the recording draws the clean picture (only because the drawing was stochastic)', r.during.note === EN['drawing.rec.clean']);
            check('R5 a Render setting changed during the recording waits for it (still sorted)', drawsSorted(r.duringSetting));
            check('R5 after the stop the pilot\'s drawing is back (the link\'s stochastic: engine and shader), the hold is off', draws(r.after) && r.after.drawing?.held === false && /^Render: stochastic/.test(r.after.f3));
            pass.R5 = r.errors.length === 0;
        }

        // ------------------------------------------------------------------ R6 the share picture
        if (want('R6')) {
            const n = await context(browser);
            // v0.11: ?impl=engine keeps this measurement what it was (the grain of the engine's dither goes into the JPEG's bytes); the accumulating
            // renderer converges to a clean picture at rest, so its share picture is measured by accept-v11-stochastic V5 (PSNR against sorted)
            const st = await open(n.page, NEW, `scene=${ROOM}&stochastic&impl=engine&governor=0`);
            await waitComplete(n.page, 60000);
            const plainGrab = `(async () => { const r = window.__gsfpv.session.renderer; const canvas = r.canvas; const W = 1200, H = 630;
                const frame = await new Promise((res) => { const t = setTimeout(() => res(null), 4000); const on = () => { r.app.off('frameend', on); clearTimeout(t);
                    const o = document.createElement('canvas'); o.width = W; o.height = H; const g = o.getContext('2d'); const k = Math.max(W / canvas.width, H / canvas.height);
                    g.drawImage(canvas, (canvas.width - W / k) / 2, (canvas.height - H / k) / 2, W / k, H / k, 0, 0, W, H); res(o); }; r.app.on('frameend', on); r.renderOnce(); });
                const u = frame ? frame.toDataURL('image/jpeg', 0.88) : ''; return { bytes: Math.round((u.length - 23) * 0.75), stochastic: r.stochastic }; })()`;
            const stochasticGrab = await n.page.evaluate(plainGrab) as Any;
            await hook(n.page, 's.renderer.setStochastic(false); return 0;');
            await sleep(1200);
            const sortedGrab = await n.page.evaluate(plainGrab) as Any;
            await hook(n.page, 's.renderer.setStochastic(true); return 0;');
            await sleep(1200);
            const before = await state(n.page);
            await n.page.keyboard.press('KeyL');
            await n.page.waitForSelector('[data-testid=share-picture]', { timeout: 30000 });
            const src = await n.page.evaluate(`document.querySelector('[data-testid=share-picture]').src`) as string;
            const bytes = Math.round((src.length - 23) * 0.75);
            await sleep(800);
            const after = await state(n.page);
            out.R6 = { stochasticGrabBytes: stochasticGrab.bytes, sortedGrabBytes: sortedGrab.bytes, appPictureBytes: bytes, before: { engine: before.engine, top: before.top }, after: { engine: after.engine, hybrid: after.hybrid, top: after.top } };
            check('R6 control: a grab of the same stochastic view weighs 1.25x or more of the sorted grab (the measurement can tell)', stochasticGrab.stochastic === true && sortedGrab.stochastic === false && stochasticGrab.bytes >= 1.25 * sortedGrab.bytes, true);
            check('R6 the share picture of a stochastic view is one sorted frame: at most 0.8 of the stochastic grab\'s bytes, under the API\'s 400 KB', stochastic(st) && stochastic(before) && bytes <= 0.8 * stochasticGrab.bytes && bytes < 380 * 1024);
            check('R6 the drawing is back right after (stochastic in the engine and the shader, the same budget)', stochastic(after) && after.top === before.top);
            pass.R6 = errors(n.log).length === 0;
            await n.ctx.close();
        }

        // ------------------------------------------------------------------ R7 the review round
        if (want('R7')) {
            const rows: Record<string, Any> = {};
            const noWebgpu = 'if (navigator.gpu) navigator.gpu.requestAdapter = async () => null;';
            /** The page at `site` on a device of `kind`; the pilot's Splat budget set to `budget` after it is up; the state, the hook's drawing. */
            const withBudget = async (site: string, kind: 'phone' | 'tablet' | 'desktop', budget: string, init?: string): Promise<Any> => {
                const n = await context(browser, kind, init);
                await open(n.page, site, `scene=${ROOM}`);
                await setPref(n.page, 'display.budget', budget);
                await sleep(900);
                const st = await state(n.page);
                const e = errors(n.log);
                await n.ctx.close();
                return { ...st, pageerrors: e };
            };
            // a. the pilot's own Splat budget goes ABOVE the class's preset where the device cannot draw stochastic
            for (const [name, kind, init, presetM, cls] of [['phone', 'phone', undefined, 2, 'phone'], ['tablet', 'tablet', undefined, 2, 'tablet'], ['desktop without WebGPU', 'desktop', noWebgpu, 2.5, 'desktop-weak']] as const) {
                const now = await withBudget(NEW, kind, '8', init);
                const pre = await withBudget(PRE, kind, '8', init);
                rows[name] = { now: { drawing: now.drawing, top: now.top }, pre: { drawing: pre.drawing, top: pre.top } };
                check(`R7 a ${name} (class ${cls}, preset ${presetM} M) whose pilot sets Splat budget 8 M: the page draws up to 8 M, "from your setting", sorted, no note`,
                    now.status === 'ready' && now.drawing?.class === cls && now.top === 8 && now.drawing?.budgetM === 8 && now.drawing?.from?.budget === 'setting' && now.drawing?.stochastic === false && now.drawing?.note === null && now.pageerrors.length === 0);
                check(`R7 control: the build before the review round drops the 8 M and keeps ${presetM} M on the ${name}`, pre.status === 'ready' && pre.top === presetM, true);
            }
            // a link's budget is still refused on a phone (a desktop number), and the HUD says so; the pilot's own number stays
            {
                const n = await context(browser, 'phone');
                const st = await open(n.page, NEW, `scene=${ROOM}&budget=8`);
                await setPref(n.page, 'display.budget', '4');
                await sleep(900);
                const after = await state(n.page);
                rows.phoneLink = { link: { drawing: st.drawing, top: st.top, note: st.note }, withSetting: { drawing: after.drawing, top: after.top } };
                check('R7 a phone given a link\'s ?budget=8: refused (the phone\'s 2 M, the note says so); then the pilot sets 4 M: his number wins over the link', st.top === 2 && st.drawing?.note === 'budget-handheld' && after.top === 4 && after.drawing?.from?.budget === 'setting');
                await n.ctx.close();
            }
            // b. a phone in "Request desktop site" mode
            {
                const now = await context(browser, 'desktopSitePhone');
                const st = await open(now.page, NEW, `scene=${ROOM}`);
                await waitComplete(now.page, 60000);
                const after = await state(now.page);
                const asked = await open(now.page, NEW, `scene=${ROOM}&drawing=stochastic`);
                const ua = await now.page.evaluate('({ ua: navigator.userAgent.slice(0, 40), mobile: navigator.userAgentData ? navigator.userAgentData.mobile : null, touch: navigator.maxTouchPoints, screen: [screen.width, screen.height] })');
                await now.ctx.close();
                const old = await context(browser, 'desktopSitePhone');
                const stOld = await open(old.page, PRE, `scene=${ROOM}`);
                await waitComplete(old.page, 60000);
                const oldAfter = await state(old.page);
                const oldAsked = await open(old.page, PRE, `scene=${ROOM}&drawing=stochastic`);
                await old.ctx.close();
                rows.desktopSitePhone = { device: ua, now: { drawing: st.drawing, scale: after.scale, canvas: after.canvas, css: after.css, dpr: after.dpr, asked: { drawing: asked.drawing, engine: asked.engine } }, pre: { drawing: stOld.drawing, top: stOld.top, scale: oldAfter.scale, asked: { engine: oldAsked.engine } } };
                const wantPx = Math.round(after.css[0] * after.dpr * 0.7);
                check(`R7 a phone that sends a desktop user agent (${JSON.stringify(ua)}) is a phone: class phone (reason small-touch-screen), sorted, 2 M, resolution capped at 70 % (canvas ${after.canvas[0]} px, ${wantPx} expected)`,
                    st.status === 'ready' && st.drawing?.class === 'phone' && st.drawing?.classAuto === 'phone' && JSON.stringify(st.drawing?.classReasons) === '["small-touch-screen"]' && st.drawing?.handheld === true
                    && st.drawing?.stochastic === false && st.top === 2 && after.scale === 0.7 && Math.abs(after.canvas[0] - wantPx) <= 2 && st.drawing?.note === null);
                check('R7 it never draws stochastic: the pilot choosing Stochastic is refused and the HUD says so (setting-handheld)', asked.drawing?.stochastic === false && asked.engine === false && asked.drawing?.note === 'setting-handheld' && asked.note === EN['drawing.note.setting-handheld']);
                check(`R7 control: the build before the review round takes the same device for a strong desktop (class ${stOld.drawing?.class}, ${stOld.top} M, scale ${oldAfter.scale}) and lets it draw stochastic when asked`,
                    stOld.drawing?.class === 'desktop-strong' && stOld.top === 4 && oldAfter.scale === 1 && oldAsked.engine === true, true);
            }
            out.R7 = rows;
            pass.R7 = true;
        }
    } finally {
        await browser.close().catch(() => undefined);
    }
    out.apiLogHasPassword = apiLog.includes(secret.password);
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
    try { rmSync(DATA, { recursive: true, force: true }); } catch { /* temp */ }
}
for (const k of Object.keys(pass)) pass[k] = pass[k] && checks.filter((c) => c.name.startsWith(k)).every((c) => c.ok);
// R7 alone (it needs no BASE build) must not replace the evidence of the whole run
const evidenceName = ONLY.length > 0 && ONLY.every((x) => x === 'R7') ? 'v10-render-review' : 'v10-render';
const file = writeEvidence(evidenceName, { new: DIST.replace(REPO, '.'), base: needBase ? BASE_DIST.replace(REPO, '.') : null, pre: needPre ? PRE_DIST.replace(REPO, '.') : null, pass, checks, items: out, failed: failed ? String(failed) : null });
console.log(JSON.stringify(pass), file);
if (failed || Object.values(pass).some((v) => !v) || checks.some((c) => !c.ok)) process.exitCode = 1;
