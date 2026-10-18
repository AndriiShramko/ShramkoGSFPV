// v0.9 lane R in the real page (the owner's items 7 and 13): stochastic drawing is the DEFAULT on a desktop
// WebGPU browser, a SuperSplat link (?budget=8&stochastic) is obeyed everywhere it can be pasted, and the
// order is link > the pilot's settings > the owner's scene entry > the device's default. Draws the scan: run
// it under the GPU lock (C:/dev/.gpu-lock). Every item has a control that must come out the other way; the
// BASE build (the commit before this lane, served by serve-csp on BASE_SITE) is the control for the defaults.
//   D1  desktop, a scene with no parameters: the engine draws stochastic from its first frame (engine state,
//       the hybrid renderer's material define, F3's line), at the measured default budget, "from the device".
//       Control: the base build draws it sorted.
//   D2  the same on a streamed levels-of-detail scan (Opole ba7aa29d): stochastic engaged, several levels.
//   D3  a phone (user agent, touch, small viewport): sorted, the phone's 2 M, no note; control: D1.
//   D4  the order in the page: the pilot's Render setting beats the device default; a stochastic link beats a
//       sorted setting (control: the base build obeys the setting); the pilot's change in flight beats the
//       link for that scene and Auto hands over to the link again; the Splat budget setting; the owner's
//       entry (a fake /api/catalog) beats the device but not the pilot.
//   D5  the owner's exact link (superspl.at/scene/2f1ddf5f?budget=8&stochastic) by every way it is pasted:
//       the deep link in two spellings, the literal second "?", the picker's field, the picker over a flight:
//       stochastic at 8 M. Then the pilot's Render setting is set to Sorted and a link is pasted over the
//       flight (another scene): the link still wins for the scene it opens (control: the base build lets the
//       setting win, D4b).
//       The HUD's share (a refused request still says who asked, the default on a phone does not) is D1 and D3.
//   D6  the share picture (L, the card of /s/<id>) of a stochastic desktop is made from one sorted frame: far
//       fewer bytes than a stochastic grab of the same view, and the pilot's drawing is back right after.
//       Control: the same view grabbed stochastic weighs well over the sorted grab (the measurement can tell).
//   SITE=http://127.0.0.1:5391 BASE_SITE=http://127.0.0.1:5392 npx tsx src/accept-v09-render.ts [D1 D2 ...]
// Evidence: evidence/<date>/v09-render.json; items run alone (EVIDENCE_DATE: the day of the file to add to) replace
// their own entries in it and the others stay, as accept-v07-render.ts does.
import { mkdirSync, rmdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Browser, BrowserContext, Page } from 'playwright';
import { launchChrome, waitReady } from './browser';
import { writeEvidence, REPO, today } from './evidence';
import { STOCHASTIC_BUDGET_M, MOBILE_BUDGET_M, DEFAULT_BUDGET_M } from '../../../packages/render-pc/src/drawing';

const SITE = (process.env.SITE ?? 'http://127.0.0.1:5391').replace(/\/$/, '');
const BASE_SITE = (process.env.BASE_SITE ?? 'http://127.0.0.1:5392').replace(/\/$/, '');
const A = '39e63ce9';
const OPOLE = 'ba7aa29d';
const OWNER_SCENE = '2f1ddf5f';
const ONLY = process.argv.slice(2).map((x) => x.toUpperCase());
const want = (id: string) => ONLY.length === 0 || ONLY.includes(id);
const PHONE_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
const LOCK = 'C:/dev/.gpu-lock';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const EN = JSON.parse(readFileSync(join(REPO, 'packages', 'i18n', 'locales', 'fly', 'drawing', 'en.json'), 'utf8')) as Record<string, string>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const hook = <T = Any>(p: Page, body: string): Promise<T> => p.evaluate(`(() => { const h = window.__gsfpv; const s = h.session; ${body} })()`) as Promise<T>;

for (;;) {
    try { mkdirSync(LOCK); break; } catch { console.log('waiting for the GPU lock'); await sleep(Number(process.env.LOCK_POLL_MS ?? 3000)); }
}
const release = (): void => { try { rmdirSync(LOCK); } catch { /* gone */ } };
process.on('SIGINT', () => { release(); process.exit(130); });

/** A fresh context: desktop or a phone; `catalog`: a fake /api/catalog (the owner's published list). */
async function context(browser: Browser, o: { phone?: boolean; catalog?: unknown } = {}): Promise<{ ctx: BrowserContext; page: Page; log: string[] }> {
    const ctx = await browser.newContext(o.phone
        ? { viewport: { width: 412, height: 915 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, userAgent: PHONE_UA }
        : { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    await ctx.route('**/api/e', (r) => r.fulfill({ status: 204, body: '' }));
    if (o.catalog) await ctx.route('**/api/catalog', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o.catalog) }));
    await ctx.addInitScript('window.__name = window.__name || ((f) => f);');
    const page = await ctx.newPage();
    const log: string[] = [];
    page.on('console', (m) => log.push(`${m.type()}: ${m.text()}`.slice(0, 300)));
    page.on('pageerror', (e) => log.push(`pageerror: ${e.message}`.slice(0, 300)));
    return { ctx, page, log };
}
const errors = (log: string[]) => log.filter((l) => l.startsWith('pageerror'));

/**
 * The drawing as the page decided it and as the engine really has it: the gsplat parameter, and the hybrid
 * renderer's own state and material define (the shader that draws), plus the address, the HUD note, F3's line.
 */
const STATE = `const g = s.renderer.app.scene.gsplat; const dir = s.renderer.app.renderer.gsplatDirector; let hybrid = null;
  if (dir) for (const cd of dir.camerasMap.values()) for (const ld of cd.layersMap.values()) { const m = ld.gsplatManager; const r = m && m.renderer; if (r) hybrid = { gpuSort: r.usesGpuSort === true, stochastic: r.stochastic === true, define: r._material ? !!r._material.getDefine('GSPLAT_STOCHASTIC') : null }; }
  const l = h.lod ? h.lod() : null;
  return { status: h.status, drawing: h.drawing ?? null, engine: g.stochastic === true, hybrid, top: h.governor ? h.governor.topBudgetMillions : null, budgetM: g.splatBudget / 1e6, renderer: g.currentRenderer, levels: l ? l.levels : null, search: location.search, note: (document.querySelector('.hud-note') || {}).textContent || '', f3: (document.querySelector('[data-testid=drawing-line]') || {}).textContent || '' };`;

async function open(p: Page, site: string, qs: string, timeout = 240000): Promise<Any> {
    await p.goto(`${site}/en/fly/?${qs}&nowarn=1&input=touch`);
    const r = await waitReady(p, timeout);
    if (r.status !== 'ready') return { status: r.status, error: r.error };
    await sleep(900);
    return hook(p, STATE);
}
/** F3 (frame stats) on, then its drawing line. */
async function f3(p: Page): Promise<string> {
    await p.keyboard.press('F3');
    await sleep(700);
    return p.evaluate(() => (document.querySelector('[data-testid=drawing-line]') || {} as Element).textContent || '');
}

const out: Record<string, unknown> = {};
const pass: Record<string, boolean> = {};
const checks: { name: string; ok: boolean; control: boolean }[] = [];
function check(name: string, ok: boolean, control = false): boolean {
    checks.push({ name, ok, control });
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${control ? '[control] ' : ''}${name}`);
    return ok;
}
const stochasticOn = (st: Any): boolean => st.engine === true && st.hybrid?.stochastic === true && st.hybrid?.define === true && st.hybrid?.gpuSort === true;

const { browser, which } = await launchChrome({ headless: false, args: ['--window-position=40,40', '--window-size=1296,920'] });
try {
    // ------------------------------------------------------------------ D1
    if (want('D1')) {
        const { ctx, page, log } = await context(browser);
        const st = await open(page, SITE, `scene=${A}`);
        const line = await f3(page);
        const base = await open(page, BASE_SITE, `scene=${A}`);
        out.D1 = { st, line, base, pageerrors: errors(log) };
        const a = check('D1 desktop, no parameters: stochastic from the first frame (engine, hybrid renderer, its shader define)', st.status === 'ready' && stochasticOn(st));
        const b = check(`D1 at the measured default budget (${STOCHASTIC_BUDGET_M} M), decided by the device`, st.top === STOCHASTIC_BUDGET_M && st.drawing?.from?.stochastic === 'device' && st.drawing?.from?.budget === 'device' && st.drawing?.note === null);
        const c = check('D1 the HUD says nothing about the drawing (a default is not news) and F3 says what draws and who decided', !/tochastic/.test(st.note) && /stochastic/.test(line) && /this device/.test(line) && new RegExp(`${STOCHASTIC_BUDGET_M} M`).test(line));
        const d = check('D1 control: the base build draws the same scene sorted at 4 M', base.status === 'ready' && base.engine === false && base.top === DEFAULT_BUDGET_M, true);
        pass.D1 = a && b && c && d && errors(log).length === 0;
        await ctx.close();
    }

    // ------------------------------------------------------------------ D2
    if (want('D2')) {
        const { ctx, page, log } = await context(browser);
        const st = await open(page, SITE, `scene=${OPOLE}`);
        const base = await open(page, BASE_SITE, `scene=${OPOLE}`);
        out.D2 = { st, base, pageerrors: errors(log) };
        const a = check('D2 a streamed scan (Opole): stochastic engaged in the engine and the shader, from the device', stochasticOn(st) && st.drawing?.from?.stochastic === 'device');
        const b = check('D2 it is a levels-of-detail scan (more than one level) drawn under the stochastic budget', (st.levels ?? 0) > 1 && st.top === STOCHASTIC_BUDGET_M);
        const c = check('D2 control: the base build draws it sorted', base.engine === false && base.hybrid?.define === false, true);
        pass.D2 = a && b && c && errors(log).length === 0;
        await ctx.close();
    }

    // ------------------------------------------------------------------ D3
    if (want('D3')) {
        const { ctx, page, log } = await context(browser, { phone: true });
        const st = await open(page, SITE, `scene=${A}`);
        const withLink = await open(page, SITE, `scene=${A}&budget=8&stochastic`);
        out.D3 = { st, withLink, pageerrors: errors(log) };
        const a = check('D3 a phone with nothing asked: sorted at the phone\'s 2 M, no note, decided by the device', st.status === 'ready' && st.engine === false && st.hybrid?.stochastic !== true && st.top === MOBILE_BUDGET_M && !/tochastic|splats/.test(st.note) && st.drawing?.note === null && st.drawing?.from?.stochastic === 'device');
        const b = check('D3 a phone given the owner\'s link: still sorted at 2 M, and the HUD says who asked (the scene)', withLink.engine === false && withLink.top === MOBILE_BUDGET_M && withLink.note === EN['drawing.note.scene-handheld']);
        pass.D3 = a && b && errors(log).length === 0;
        await ctx.close();
    }

    // ------------------------------------------------------------------ D4
    if (want('D4')) {
        const { ctx, page, log } = await context(browser);
        const rows: Any = {};
        const catalogEntry = (render: unknown) => ({ v: 1, published: '2026-10-17T00:00:00Z', collections: [], scenes: [{ id: A, title: 'Fake entry', author: 'x', license: 'CC BY 4.0', kind: 'interior', collision: true, render }] });

        // a. the pilot's setting beats the device default
        rows.settingSorted = await open(page, SITE, `scene=${A}&drawing=sorted`);
        rows.settingStochasticOnPhoneless = await open(page, SITE, `scene=${A}&drawing=stochastic`);
        check('D4a the pilot\'s Render = Sorted beats the device default (stochastic)', rows.settingSorted.engine === false && rows.settingSorted.drawing?.from?.stochastic === 'setting' && rows.settingSorted.top === DEFAULT_BUDGET_M);
        // b. the link beats the setting (the base build obeys the setting: the control)
        rows.linkOverSetting = await open(page, SITE, `scene=${A}&drawing=sorted&budget=8&stochastic`);
        rows.base = await open(page, BASE_SITE, `scene=${A}&drawing=sorted&budget=8&stochastic`);
        check('D4b a stochastic link beats a Sorted setting (stochastic at 8 M, "from the link")', stochasticOn(rows.linkOverSetting) && rows.linkOverSetting.top === 8 && rows.linkOverSetting.drawing?.from?.stochastic === 'link');
        check('D4b control: the base build lets the setting beat the link (sorted)', rows.base.engine === false, true);
        // c. the pilot's change in flight beats the link for that scene; Auto hands over to the link again
        // (the page is on the BASE build after the control above: back to this build, on the link, first)
        await open(page, SITE, `scene=${A}&budget=8&stochastic`);
        await hook(page, `h.prefs.set('display.drawing', 'auto'); return 0;`);
        await sleep(400);
        rows.liveStart = await hook(page, STATE);
        await hook(page, `h.prefs.set('display.drawing', 'sorted'); return 0;`);
        await sleep(500);
        rows.liveSorted = await hook(page, STATE);
        await hook(page, `h.prefs.set('display.drawing', 'auto'); return 0;`);
        await sleep(500);
        rows.liveAuto = await hook(page, STATE);
        check('D4c a stochastic link; the pilot picks Sorted in flight: sorted at once (the control never looks dead)', stochasticOn(rows.liveStart) && rows.liveSorted.engine === false && rows.liveSorted.hybrid?.define === false);
        check('D4c back to Auto: the link rules again (stochastic at 8 M)', stochasticOn(rows.liveAuto) && rows.liveAuto.top === 8);
        // d. the Splat budget setting, and a link's budget beating it
        rows.budget = await open(page, SITE, `scene=${A}`);
        await hook(page, `h.prefs.set('display.budget', '2'); return 0;`);
        await sleep(500);
        rows.budget2 = await hook(page, STATE);
        await hook(page, `h.prefs.set('display.budget', 'auto'); return 0;`);
        await sleep(500);
        rows.budgetAuto = await hook(page, STATE);
        check('D4d the Splat budget setting: 2 M at once, stochastic stays, then Auto gives the default back', rows.budget2.top === 2 && rows.budget2.engine === true && rows.budgetAuto.top === STOCHASTIC_BUDGET_M && rows.budget2.drawing?.from?.budget === 'setting');
        // e. the owner's entry (a fake catalogue) beats the device, not the pilot, not the link
        const sorted = await context(browser, { catalog: catalogEntry({ stochastic: false, budgetM: 6 }) });
        rows.entrySorted = await open(sorted.page, SITE, `scene=${A}`);
        rows.entryOverPilot = await open(sorted.page, SITE, `scene=${A}&drawing=stochastic`);
        rows.entryOverLink = await open(sorted.page, SITE, `scene=${A}&stochastic`);
        await sorted.ctx.close();
        check('D4e the owner\'s entry "sorted, 6 M" beats the device default', rows.entrySorted.engine === false && rows.entrySorted.top === 6 && rows.entrySorted.drawing?.from?.stochastic === 'scene');
        check('D4e the pilot\'s Stochastic beats the owner\'s sorted entry; the entry\'s budget stays', stochasticOn(rows.entryOverPilot) && rows.entryOverPilot.top === 6 && rows.entryOverPilot.drawing?.from?.stochastic === 'setting' && rows.entryOverPilot.drawing?.from?.budget === 'scene');
        check('D4e a stochastic link beats the owner\'s sorted entry', stochasticOn(rows.entryOverLink) && rows.entryOverLink.drawing?.from?.stochastic === 'link');
        out.D4 = { rows, pageerrors: errors(log) };
        pass.D4 = checks.filter((c) => c.name.startsWith('D4')).every((c) => c.ok) && errors(log).length === 0;
        await ctx.close();
    }

    // ------------------------------------------------------------------ D5
    if (want('D5')) {
        const { ctx, page, log } = await context(browser);
        const link = `https://superspl.at/scene/${OWNER_SCENE}?budget=8&stochastic`;
        const rows: Any = {};
        rows.encoded = await open(page, SITE, `scene=${encodeURIComponent(link)}`);
        rows.raw = await open(page, SITE, `scene=${link}`);
        rows.deep = await open(page, SITE, `scene=${OWNER_SCENE}&budget=8&stochastic`);
        // SuperSplat's "add ?budget=8&stochastic to the URL" copied literally into our address: a second "?"
        rows.literal = await open(page, SITE, `scene=${OWNER_SCENE}?budget=8&stochastic`);
        const literalBase = await open(page, BASE_SITE, `scene=${OWNER_SCENE}?budget=8&stochastic`);
        // the picker's own field, no scene in the address
        await page.goto(`${SITE}/en/fly/?nowarn=1&input=touch`);
        await page.waitForSelector('.scene-input', { timeout: 60000 });
        await page.fill('.scene-input', link);
        await page.press('.scene-input', 'Enter');
        await page.waitForFunction(() => (window as unknown as { __gsfpv?: { status?: string } }).__gsfpv?.status === 'ready', null, { timeout: 240000 });
        await sleep(900);
        rows.field = await hook(page, STATE);
        // the picker over a flight
        await hook(page, `h.scenes.openPicker(); return 0;`);
        await page.fill('.scenes.in-flight .scene-input', `<${link}>.`);
        await page.press('.scenes.in-flight .scene-input', 'Enter');
        for (let i = 0; i < 480; i++) { const sw = await hook<Any>(page, 'return h.sceneSwitch ? { ...h.sceneSwitch } : null;'); if (sw && (sw.state === 'done' || sw.state === 'failed')) break; await sleep(250); }
        await sleep(900);
        rows.inFlight = await hook(page, STATE);
        const all = Object.entries(rows).map(([k, v]) => [k, stochasticOn(v as Any) && (v as Any).top === 8 && /[?&]scene=2f1ddf5f(&|$)/.test((v as Any).search)] as const);
        // the pilot has Render = Sorted stored (the setting the owner's link must not lose to), the picker over the flight
        // again with a link to another scene: that scene opens stochastic at 8 M, "from the link"
        await hook(page, `h.prefs.set('display.drawing', 'sorted'); return 0;`);
        await sleep(500);
        await hook(page, `h.scenes.openPicker(); return 0;`);
        await page.fill('.scenes.in-flight .scene-input', `https://superspl.at/scene/${A}?budget=8&stochastic`);
        await page.press('.scenes.in-flight .scene-input', 'Enter');
        for (let i = 0; i < 480; i++) { const sw = await hook<Any>(page, 'return h.sceneSwitch ? { ...h.sceneSwitch } : null;'); if (sw && (sw.state === 'done' || sw.state === 'failed')) break; await sleep(250); }
        await sleep(900);
        rows.inFlightOverSorted = await hook(page, STATE);
        const overSorted = stochasticOn(rows.inFlightOverSorted) && rows.inFlightOverSorted.top === 8 && rows.inFlightOverSorted.drawing?.from?.stochastic === 'link' && new RegExp(`[?&]scene=${A}(&|$)`).test(rows.inFlightOverSorted.search);
        out.D5 = { rows, pageerrors: errors(log) };
        check('D5 control: the base build answers the literal "...?scene=2f1ddf5f?budget=8&stochastic" with the picker ("not a SuperSplat link")', literalBase.status === 'picker', true);
        check('D5 the owner\'s link draws stochastic at 8 M by every way it is pasted (deep link encoded and raw, deep link, the literal second "?", the picker\'s field, the picker over a flight, wrapped in <> and a full stop)', all.every(([, ok]) => ok));
        check('D5 a link pasted over a flight beats a stored Render = Sorted for the scene it opens (stochastic at 8 M, "from the link")', overSorted);
        console.log('D5', JSON.stringify(all), 'overSorted', overSorted);
        pass.D5 = all.every(([, ok]) => ok) && overSorted && errors(log).length === 0;
        await ctx.close();
    }

    // ------------------------------------------------------------------ D6
    if (want('D6')) {
        const { ctx, page, log } = await context(browser);
        const st = await open(page, SITE, `scene=${OPOLE}&governor=0`);
        for (let i = 0; i < 120; i++) { if (await hook<boolean>(page, 'return s.renderer.sceneComplete;')) break; await sleep(500); }
        await sleep(1500);
        // the same crop and JPEG as share/picture.ts makes, of the drawing the engine has NOW (before the brand is drawn)
        const plainGrab = `(async () => { const r = window.__gsfpv.session.renderer; const canvas = r.canvas; const W = 1200, H = 630;
            const frame = await new Promise((res) => { const t = setTimeout(() => res(null), 4000); const on = () => { r.app.off('frameend', on); clearTimeout(t);
                const o = document.createElement('canvas'); o.width = W; o.height = H; const g = o.getContext('2d'); const k = Math.max(W / canvas.width, H / canvas.height);
                g.drawImage(canvas, (canvas.width - W / k) / 2, (canvas.height - H / k) / 2, W / k, H / k, 0, 0, W, H); res(o); }; r.app.on('frameend', on); r.renderOnce(); });
            const u = frame ? frame.toDataURL('image/jpeg', 0.88) : ''; return { bytes: Math.round((u.length - 23) * 0.75), stochastic: r.stochastic }; })()`;
        const stochasticGrab = await page.evaluate(plainGrab) as Any;
        await hook(page, 's.renderer.setStochastic(false); return 0;');
        await sleep(1500);
        const sortedGrab = await page.evaluate(plainGrab) as Any;
        await hook(page, 's.renderer.setStochastic(true); return 0;');
        await sleep(1500);
        const before = await hook(page, STATE);
        // the app's own share picture: L opens the share panel, which makes the card from the view
        const t0 = Date.now();
        await page.keyboard.press('KeyL');
        await page.waitForSelector('[data-testid=share-picture]', { timeout: 30000 });
        const ms = Date.now() - t0;
        const src = await page.evaluate(`document.querySelector('[data-testid=share-picture]').src`) as string;
        const bytes = Math.round((src.length - 23) * 0.75);
        await sleep(800);
        const after = await hook(page, STATE);
        const day6 = process.env.EVIDENCE_DATE ?? today();
        mkdirSync(join(REPO, 'evidence', day6), { recursive: true });
        writeFileSync(join(REPO, 'evidence', day6, 'v09-render-share-picture.jpg'), Buffer.from(src.slice(src.indexOf(',') + 1), 'base64'));
        out.D6 = { before: { engine: before.engine, top: before.top }, stochasticGrabBytes: stochasticGrab.bytes, sortedGrabBytes: sortedGrab.bytes, appPictureBytes: bytes, appPictureMs: ms, after: { engine: after.engine, hybrid: after.hybrid, top: after.top }, pageerrors: errors(log) };
        check('D6 control: the grab of the same view is rougher stochastic than sorted (the stochastic grab weighs 1.25x or more of the sorted one)', stochasticGrab.stochastic === true && sortedGrab.stochastic === false && stochasticGrab.bytes >= 1.25 * sortedGrab.bytes, true);
        check("D6 the share picture of a stochastic desktop is made from the sorted frame: at most 0.8 of the stochastic grab's bytes, and well under the API's 400 KB", stochasticOn(st) && stochasticOn(before) && bytes <= 0.8 * stochasticGrab.bytes && bytes < 380 * 1024);
        check("D6 the pilot's drawing is back right after (stochastic in the engine and the shader, the same budget)", stochasticOn(after) && after.top === before.top);
        console.log('D6', JSON.stringify(out.D6));
        pass.D6 = errors(log).length === 0;
        await ctx.close();
    }
} finally {
    await browser.close().catch(() => undefined);
    release();
}
for (const k of Object.keys(pass)) pass[k] = pass[k] && checks.filter((c) => c.name.startsWith(k)).every((c) => c.ok);
// items run alone land in the file of the day: the other items stay, a re-run item replaces its own
const day = process.env.EVIDENCE_DATE ?? today();
const prevFile = join(REPO, 'evidence', day, 'v09-render.json');
type Prev = { pass?: Record<string, boolean>; checks?: { name: string }[]; items?: Record<string, unknown>; runs?: Record<string, string> };
const prev: Prev = existsSync(prevFile) ? JSON.parse(readFileSync(prevFile, 'utf8')) as Prev : {};
const ran = Object.keys(pass);
const keep = (c: { name: string }) => !ran.some((k) => c.name.startsWith(k));
const stamp = Object.fromEntries(ran.map((k) => [k, new Date().toISOString()]));
const file = writeEvidence('v09-render', {
    site: SITE, baseSite: BASE_SITE, browser: which,
    pass: { ...prev.pass, ...pass }, runs: { ...prev.runs, ...stamp },
    checks: [...(prev.checks ?? []).filter(keep), ...checks], items: { ...prev.items, ...out }
}, day);
console.log(JSON.stringify({ ...prev.pass, ...pass }), file);
if (existsSync(file) && Object.values({ ...prev.pass, ...pass }).some((v) => !v)) process.exitCode = 1;
