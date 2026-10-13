// v0.7 lane R in the real page (the owner's item 1): SuperSplat links with ?budget= and ?stochastic,
// the Display setting display.drawing, the desktop/handheld gate, and what stochastic looks like and
// costs. Draws the scan: run it under the GPU lock (C:/dev/.gpu-lock). Every item has a control that
// must come out the other way.
//   R1  link forms (the landing's encoded link, the deep link, the /s?id= form) open with stochastic in
//       the engine (app.scene.gsplat.stochastic) and the link's budget as the governor's top; the
//       address becomes /fly/?scene=<id>&budget=<M>&stochastic. Controls: a plain link and a link with
//       hostile values (budget=1e9, stochastic=<x>) draw sorted at the default top of 4 M.
//   R2  the setting wins: drawing=sorted on a stochastic link draws sorted (the budget stays), drawing=
//       stochastic on a plain link draws stochastic; switching the setting live reaches the engine.
//   R3  a phone (user agent, touch, small viewport): the request is ignored, the HUD says why; the same
//       link on the desktop page (R1) is the control.
//   R4  the picker over a flight: a pasted link with parameters loads with its drawing and the deep link
//       follows; the next scene of the rotation (no request) draws sorted again and drops them.
//   R5  the look, a still camera on one view: sorted twice (control: the same picture), stochastic twice;
//       the luminance change and the fine-detail energy (mean |pixel - mean of its 4 neighbours|).
//   R7  the voxel overlay (V) over each drawing: the share of the picture the voxels change; control: the
//       stochastic view with the overlay layer's depth clear off (the scan's depth then hides the voxels).
//   R8  missed frames (a simulated overload) lower the budget from the link's top of 8 M and keep stochastic;
//       the calm state before is the control.
//   R6  the cost on a heavy scan (2f1ddf5f, 259 M splats at full detail): GPU time per frame (submit ->
//       done) with the camera turning, governor off so both draw the same 8 M budget.
//   SITE=http://127.0.0.1:5372 npx tsx src/accept-v07-render.ts [R1 R2 ...]
// Evidence: evidence/<date>/v07-render.json and v07-render/ (crops of R5).
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Browser, BrowserContext, Page } from 'playwright';
import { launchChrome, waitReady } from './browser';
import { writeEvidence, REPO, today } from './evidence';

const SITE = (process.env.SITE ?? 'http://127.0.0.1:5372').replace(/\/$/, '');
const fly = (qs: string) => (process.env.LOCAL_FLY ? `${SITE}/fly/?${qs}` : `${SITE}/en/fly/?${qs}`);
const A = '39e63ce9';
const C = '887f27aa';
const HEAVY = process.env.HEAVY ?? '2f1ddf5f';
const ONLY = process.argv.slice(2).map((x) => x.toUpperCase());
const want = (id: string) => ONLY.length === 0 || ONLY.includes(id);
const SHOTS = join(REPO, 'evidence', today(), 'v07-render' + (process.env.EVIDENCE_SUFFIX ?? ''));
mkdirSync(SHOTS, { recursive: true });
const EN = JSON.parse(readFileSync(join(REPO, 'packages', 'i18n', 'locales', 'fly', 'drawing', 'en.json'), 'utf8')) as Record<string, string>;
const PHONE_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
/** Run `body` in the page with h = window.__gsfpv, s = its session (a string: tsx would wrap a function). */
const hook = <T = Any>(p: Page, body: string): Promise<T> => p.evaluate(`(() => { const h = window.__gsfpv; const s = h.session; ${body} })()`) as Promise<T>;
const wait = (p: Page, ms: number) => p.waitForTimeout(ms);

async function context(browser: Browser, phone = false): Promise<{ ctx: BrowserContext; page: Page; log: string[] }> {
    const ctx = await browser.newContext(phone
        ? { viewport: { width: 412, height: 915 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, userAgent: PHONE_UA }
        : { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    await ctx.route('**/api/e', (r) => r.fulfill({ status: 204, body: '' }));
    // tsx keeps function names with __name(); functions sent to page.evaluate need it in the page
    await ctx.addInitScript('window.__name = window.__name || ((f) => f);');
    const page = await ctx.newPage();
    const log: string[] = [];
    page.on('console', (m) => log.push(`${m.type()}: ${m.text()}`.slice(0, 300)));
    page.on('pageerror', (e) => log.push(`pageerror: ${e.message}`.slice(0, 300)));
    return { ctx, page, log };
}
const errors = (log: string[]) => log.filter((l) => l.startsWith('pageerror'));

/** The drawing as the page decided it and as the engine has it, plus the address. */
const STATE = `return { status: h.status, drawing: h.drawing ?? null, engine: s.renderer.app.scene.gsplat.stochastic === true, top: h.governor ? h.governor.topBudgetMillions : null, budgetM: s.renderer.app.scene.gsplat.splatBudget / 1e6, renderer: s.renderer.currentRenderer, search: location.search, note: (document.querySelector('.hud-note') || {}).textContent || '', noteShown: !!document.querySelector('.hud-note:not([hidden])') };`;

async function open(p: Page, qs: string): Promise<Any> {
    await p.goto(fly(`${qs}&nowarn=1&input=touch`));
    const r = await waitReady(p, 180000);
    if (r.status !== 'ready') return { status: r.status, error: r.error };
    await wait(p, 600);
    return hook(p, STATE);
}

const out: Record<string, unknown> = {};
const pass: Record<string, boolean> = {};
const { browser, which } = await launchChrome({ headless: false, args: ['--window-position=40,40', '--window-size=1296,920'] });

// ------------------------------------------------------------------ R1
if (want('R1')) {
    const { ctx, page, log } = await context(browser);
    const enc = encodeURIComponent;
    const forms: [string, string, boolean][] = [
        ['landing paste (encoded SuperSplat link)', `scene=${enc(`https://superspl.at/scene/${A}?budget=8&stochastic`)}`, true],
        ['deep link', `scene=${A}&budget=8&stochastic`, true],
        ['/s?id= form, stochastic=1', `scene=${enc(`superspl.at/s?id=${A}&budget=8&stochastic=1`)}`, true],
        ['control: plain link', `scene=${enc(`https://superspl.at/scene/${A}`)}`, false],
        ['control: hostile values', `scene=${A}&budget=1e9&stochastic=${enc('<x>')}`, false]
    ];
    const rows: Any[] = [];
    for (const [name, qs, stoch] of forms) {
        const st = await open(page, qs);
        const canonical = stoch ? /[?&]budget=8&stochastic(&|$)/.test(st.search) : !/[?&](budget|stochastic)=?/.test(st.search);
        const ok = st.status === 'ready' && st.engine === stoch && st.top === (stoch ? 8 : 4) && canonical;
        rows.push({ name, qs, expectStochastic: stoch, ok, canonical, ...st });
        console.log('R1', name, ok, JSON.stringify({ engine: st.engine, top: st.top, search: st.search }));
    }
    out.R1 = { rows, pageerrors: errors(log) };
    pass.R1 = rows.every((r) => r.ok) && errors(log).length === 0;
    await ctx.close();
}

// ------------------------------------------------------------------ R2
if (want('R2')) {
    const { ctx, page, log } = await context(browser);
    const sorted = await open(page, `scene=${A}&budget=8&stochastic&drawing=sorted`);
    const forced = await open(page, `scene=${A}&drawing=stochastic`);
    // live: the owner's link, then the pilot switches the setting to sorted and back to auto
    const link = await open(page, `scene=${A}&budget=8&stochastic`);
    await hook(page, `h.prefs.set('display.drawing', 'sorted'); return 0;`);
    await wait(page, 300);
    const liveSorted = await hook(page, STATE);
    await hook(page, `h.prefs.set('display.drawing', 'auto'); return 0;`);
    await wait(page, 300);
    const liveAuto = await hook(page, STATE);
    await hook(page, `h.prefs.reset('display.drawing'); return 0;`);
    const rows = { sorted, forced, link, liveSorted, liveAuto };
    out.R2 = { rows, pageerrors: errors(log) };
    pass.R2 = sorted.engine === false && sorted.top === 8 && forced.engine === true && forced.top === 4
        && link.engine === true && liveSorted.engine === false && liveAuto.engine === true && errors(log).length === 0;
    console.log('R2', pass.R2, JSON.stringify({ sorted: sorted.engine, forced: forced.engine, link: link.engine, liveSorted: liveSorted.engine, liveAuto: liveAuto.engine }));
    await ctx.close();
}

// ------------------------------------------------------------------ R3
if (want('R3')) {
    const { ctx, page, log } = await context(browser, true);
    const st = await open(page, `scene=${A}&budget=8&stochastic`);
    const forced = await open(page, `scene=${A}&drawing=stochastic`);
    out.R3 = { userAgent: PHONE_UA, link: st, forced, expectedNote: EN['drawing.note.handheld'], pageerrors: errors(log) };
    pass.R3 = st.status === 'ready' && st.engine === false && st.top === 4 && st.drawing?.note === 'handheld' && st.note === EN['drawing.note.handheld']
        && forced.engine === false && forced.drawing?.note === 'handheld' && errors(log).length === 0;
    console.log('R3', pass.R3, JSON.stringify({ engine: st.engine, top: st.top, note: st.drawing?.note, text: st.note }));
    await ctx.close();
}

// ------------------------------------------------------------------ R4
if (want('R4')) {
    const { ctx, page, log } = await context(browser);
    const before = await open(page, `scene=${A}`);
    await hook(page, 'h.scenes.openPicker(); return 0;');
    await page.fill('.scenes.in-flight .scene-input', `https://superspl.at/scene/${C}?budget=6&stochastic`);
    await page.press('.scenes.in-flight .scene-input', 'Enter');
    const sw = await switched(page);
    await wait(page, 600);
    const picked = await hook(page, STATE);
    await hook(page, `h.scenes.go('next'); return 0;`);
    const sw2 = await switched(page, 120000, C);
    await wait(page, 600);
    const next = await hook(page, STATE);
    out.R4 = { before, switch: sw, picked, nextSwitch: sw2, next, pageerrors: errors(log) };
    pass.R4 = before.engine === false && sw.state === 'done' && picked.engine === true && picked.top === 6 && /[?&]scene=887f27aa(&|$)/.test(picked.search) && /[?&]budget=6&stochastic(&|$)/.test(picked.search)
        && sw2.state === 'done' && next.engine === false && next.top === 4 && !/[?&](budget|stochastic)/.test(next.search) && errors(log).length === 0;
    console.log('R4', pass.R4, JSON.stringify({ before: before.engine, picked: [picked.engine, picked.top, picked.search], next: [next.engine, next.top, next.search] }));
    await ctx.close();
}

/** Wait for the scene switch under way to end (not one that went to `notTo`); its record. */
async function switched(p: Page, timeoutMs = 120000, notTo?: string): Promise<Any> {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
        const st = await hook<Any>(p, 'return h.sceneSwitch ? { ...h.sceneSwitch } : null;');
        if (st && (st.state === 'done' || st.state === 'failed') && st.to !== notTo) return st;
        await wait(p, 200);
    }
    return { state: 'timeout' };
}

/** Luminance statistics of PNG shots, decoded in the page (no image dependencies). */
async function stats(p: Page, pngs: Buffer[]): Promise<Any> {
    return p.evaluate(async (b64s: string[]) => {
        const lum: Float32Array[] = [];
        let w = 0, hgt = 0;
        for (const b of b64s) {
            const bin = atob(b);
            const u = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
            const bmp = await createImageBitmap(new Blob([u], { type: 'image/png' }));
            w = bmp.width; hgt = bmp.height;
            const c = new OffscreenCanvas(w, hgt);
            const g = c.getContext('2d')!;
            g.drawImage(bmp, 0, 0);
            const d = g.getImageData(0, 0, w, hgt).data;
            const L = new Float32Array(w * hgt);
            for (let i = 0; i < w * hgt; i++) L[i] = (0.2126 * d[4 * i] + 0.7152 * d[4 * i + 1] + 0.0722 * d[4 * i + 2]) / 255;
            lum.push(L);
        }
        const diff = (a: Float32Array, b: Float32Array) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };
        const detail = (a: Float32Array) => {
            let s = 0, n = 0;
            for (let y = 1; y < hgt - 1; y++) for (let x = 1; x < w - 1; x++) {
                const i = y * w + x;
                s += Math.abs(a[i] - 0.25 * (a[i - 1] + a[i + 1] + a[i - w] + a[i + w]));
                n++;
            }
            return s / n;
        };
        return { size: [w, hgt], detail: lum.map(detail), pairs: { s1s2: diff(lum[0], lum[1]), s1t1: diff(lum[0], lum[2]), t1t2: diff(lum[2], lum[3]) } };
    }, pngs.map((b) => b.toString('base64')));
}

// ------------------------------------------------------------------ R5
if (want('R5')) {
    const { ctx, page, log } = await context(browser);
    // no ?drawing=: a URL value sits in the store's session layer, over what prefs.set() stores
    const st0 = await open(page, `scene=${A}&governor=0`);
    // a still picture: the flight model paused, the HUD off, every level of detail in place
    await hook(page, `s.pause(true, 'bake'); h.prefs.set('display.hud', false); return 0;`);
    const settle = async () => {
        const t0 = Date.now();
        while (Date.now() - t0 < 30000) {
            if (await hook<boolean>(page, 'return s.renderer.sceneComplete;')) break;
            await wait(page, 250);
        }
        await wait(page, 1500);
    };
    await settle();
    const canvas = page.locator('#view');
    const s1 = await canvas.screenshot();
    await wait(page, 500);
    const s2 = await canvas.screenshot();
    await hook(page, `h.prefs.set('display.drawing', 'stochastic'); return 0;`);
    await settle();
    const t1 = await canvas.screenshot();
    await wait(page, 500);
    const t2 = await canvas.screenshot();
    const engine = await hook(page, STATE);
    const m = await stats(page, [s1, s2, t1, t2]);
    // crops for the owner's eye: the middle 480 x 300 px at 1:1
    const box = await canvas.boundingBox();
    if (box) {
        const clip = { x: box.x + box.width / 2 - 240, y: box.y + box.height / 2 - 150, width: 480, height: 300 };
        await hook(page, `h.prefs.set('display.drawing', 'sorted'); return 0;`);
        await settle();
        writeFileSync(join(SHOTS, 'look-sorted.jpg'), await page.screenshot({ clip, type: 'jpeg', quality: 90 }));
        await hook(page, `h.prefs.set('display.drawing', 'stochastic'); return 0;`);
        await settle();
        writeFileSync(join(SHOTS, 'look-stochastic.jpg'), await page.screenshot({ clip, type: 'jpeg', quality: 90 }));
    }
    await hook(page, `h.prefs.reset('display.drawing'); h.prefs.reset('display.hud'); return 0;`);
    const CONTROL_MAX = 0.003;
    out.R5 = {
        scene: A, first: st0, engineAfterSwitch: engine.engine, ...m,
        rule: `sorted vs sorted (control) under ${CONTROL_MAX}; sorted vs stochastic over 3x the control; stochastic adds fine detail (dither grain)`,
        pageerrors: errors(log)
    };
    pass.R5 = st0.engine === false && engine.engine === true && m.pairs.s1s2 < CONTROL_MAX && m.pairs.s1t1 > 3 * Math.max(m.pairs.s1s2, 1e-4) && errors(log).length === 0;
    console.log('R5', pass.R5, JSON.stringify(m));
    await ctx.close();
}

// ------------------------------------------------------------------ R7
// The voxel overlay (V) over each drawing: the share of the picture the voxels change. Stochastic
// splats write depth; the overlay's layer clears it first (voxel-overlay.ts), so the x-ray stays.
// Control: the same stochastic view with the layer's clear switched off in the page.
if (want('R7')) {
    const { ctx, page, log } = await context(browser);
    const st0 = await open(page, `scene=${A}&governor=0`);
    await hook(page, `s.pause(true, 'bake'); h.prefs.set('display.hud', false); return 0;`);
    const settle = async () => {
        const t0 = Date.now();
        while (Date.now() - t0 < 30000) {
            if (await hook<boolean>(page, 'return s.renderer.sceneComplete;')) break;
            await wait(page, 250);
        }
        await wait(page, 1200);
    };
    const canvas = page.locator('#view');
    const coverage = async (): Promise<Any> => {
        await hook(page, `h.voxels.setMode('off'); return 0;`);
        await settle();
        const off = await canvas.screenshot();
        await hook(page, `h.voxels.setMode('overlay'); return 0;`);
        const t0 = Date.now();
        while (Date.now() - t0 < 60000 && !(await hook<boolean>(page, 'return h.voxels.settled();'))) await wait(page, 300);
        await wait(page, 800);
        const on = await canvas.screenshot();
        await hook(page, `h.voxels.setMode('off'); return 0;`);
        return page.evaluate(async (b64s: string[]) => {
            const L: Float32Array[] = [];
            for (const b of b64s) {
                const bin = atob(b);
                const u = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
                const bmp = await createImageBitmap(new Blob([u], { type: 'image/png' }));
                const c = new OffscreenCanvas(bmp.width, bmp.height);
                const g = c.getContext('2d')!;
                g.drawImage(bmp, 0, 0);
                const d = g.getImageData(0, 0, bmp.width, bmp.height).data;
                const l = new Float32Array(bmp.width * bmp.height);
                for (let i = 0; i < l.length; i++) l[i] = (0.2126 * d[4 * i] + 0.7152 * d[4 * i + 1] + 0.0722 * d[4 * i + 2]) / 255;
                L.push(l);
            }
            let n = 0;
            for (let i = 0; i < L[0].length; i++) if (Math.abs(L[0][i] - L[1][i]) > 0.08) n++;
            return { changedShare: n / L[0].length };
        }, [off, on].map((b) => b.toString('base64')));
    };
    const sorted = await coverage();
    await hook(page, `h.prefs.set('display.drawing', 'stochastic'); return 0;`);
    const stochastic = await coverage();
    const engine = await hook(page, STATE);
    await hook(page, `s.renderer.app.scene.layers.getLayerByName('GSFPV Voxels').clearDepthBuffer = false; return 0;`);
    const noClear = await coverage();
    await hook(page, `s.renderer.app.scene.layers.getLayerByName('GSFPV Voxels').clearDepthBuffer = true; h.prefs.reset('display.drawing'); h.prefs.reset('display.hud'); return 0;`);
    out.R7 = { scene: A, first: st0.engine, sortedShare: sorted.changedShare, stochasticShare: stochastic.changedShare, engineStochastic: engine.engine, control: { what: 'stochastic with the voxel layer\'s depth clear off', share: noClear.changedShare }, rule: 'sorted > 5 % of the picture; stochastic at least 70 % of sorted; the control under 60 % of stochastic', pageerrors: errors(log) };
    pass.R7 = st0.engine === false && engine.engine === true && sorted.changedShare > 0.05 && stochastic.changedShare >= 0.7 * sorted.changedShare && noClear.changedShare < 0.6 * stochastic.changedShare && errors(log).length === 0;
    console.log('R7', pass.R7, JSON.stringify(out.R7));
    await ctx.close();
}

// ------------------------------------------------------------------ R8
// Missed frames lower the budget from the link's top and keep stochastic. A simulated overload (the
// test hook's setFrameDelay burns CPU in every frame, 1.4 display periods); the state before is the control.
if (want('R8')) {
    const { ctx, page, log } = await context(browser);
    const before = await open(page, `scene=${A}&budget=8&stochastic`);
    // the scan streams its finer levels after the reveal and the hitches step the governor down; it
    // steps back up one level per calm 5 s: wait for the top (or 60 s) before the overload
    const g = `return { step: h.governor.step, budgetM: s.renderer.app.scene.gsplat.splatBudget / 1e6, engine: s.renderer.app.scene.gsplat.stochastic === true, top: h.governor.topBudgetMillions, changes: h.governor.changes };`;
    const tc = Date.now();
    const afterLoad = await hook(page, g);
    let calm: Any = afterLoad;
    while (Date.now() - tc < 60000 && calm.step !== 0) { await wait(page, 1000); calm = await hook(page, g); }
    calm.waitedS = Math.round((Date.now() - tc) / 1000);
    await hook(page, 'h.setFrameDelay(Math.round(h.governor.displayPeriodMs * 1.4)); return 0;');
    const t0 = Date.now();
    let loaded: Any = null;
    while (Date.now() - t0 < 12000) {
        await wait(page, 500);
        loaded = await hook(page, `return { step: h.governor.step, budgetM: s.renderer.app.scene.gsplat.splatBudget / 1e6, engine: s.renderer.app.scene.gsplat.stochastic === true, top: h.governor.topBudgetMillions };`);
        if (loaded.step >= 2) break;
    }
    await hook(page, 'h.setFrameDelay(0); return 0;');
    out.R8 = { before, afterLoad, calm, overloaded: loaded, pageerrors: errors(log) };
    pass.R8 = before.engine === true && calm.step === 0 && calm.budgetM === 8 && loaded.step >= 1 && loaded.budgetM < 8 && loaded.budgetM >= 3 && loaded.engine === true && loaded.top === 8 && errors(log).length === 0;
    console.log('R8', pass.R8, JSON.stringify(out.R8));
    await ctx.close();
}

// ------------------------------------------------------------------ R6
// R6_BUDGET (millions, default 8) and R6_RES ("3840x2160": a fixed backbuffer, the GPU kept busy so its
// clock does not drop at a light load) shape the run; R6_TAG names the item (R6-<tag>) so runs add up.
if (want('R6')) {
    const { ctx, page, log } = await context(browser);
    const runs: Any[] = [];
    const B = Number(process.env.R6_BUDGET ?? 8);
    const res = /^(\d+)x(\d+)$/.exec(process.env.R6_RES ?? '');
    const key = process.env.R6_TAG ? `R6-${process.env.R6_TAG}` : 'R6';
    const sortedQs = `scene=${HEAVY}&budget=${B}&stochastic&drawing=sorted&governor=0`;
    const stochQs = `scene=${HEAVY}&budget=${B}&stochastic&governor=0`;
    for (const [mode, qs] of [['sorted', sortedQs], ['stochastic', stochQs], ['sorted again', sortedQs], ['stochastic again', stochQs]] as const) {
        const t0 = Date.now();
        const st = await open(page, qs);
        if (st.status !== 'ready') { runs.push({ mode, ...st }); continue; }
        if (res) await hook(page, `s.renderer.setFixedResolution({ w: ${res[1]}, h: ${res[2]} }); return 0;`);
        // let it stream at the spawn view (every level of detail in place, or 45 s)
        while (Date.now() - t0 < 60000 && !(await hook<boolean>(page, 'return s.renderer.sceneComplete;'))) await wait(page, 500);
        const settledMs = Date.now() - t0;
        // the camera turns 60 deg/s around its spawn point: the sorted drawing re-sorts every frame
        await hook(page, `s.pause(true, 'bake'); s.cameraOverride = true;
            const c = s.renderer.camera.getPosition(); const p = [c.x, c.y, c.z]; const t0 = performance.now();
            window.__turn = () => { const a = (performance.now() - t0) / 1000 * Math.PI / 3; s.renderer.setCameraLookAt(p[0], p[1], p[2], p[0] + Math.sin(a), p[1] - 0.1, p[2] - Math.cos(a)); };
            s.renderer.app.on('update', window.__turn); window.__frames = []; window.__gpuT = []; window.__pass = null;
            const prof = s.renderer.device.gpuProfiler; if (prof) prof.enabled = true;
            s.renderer.app.on('frameend', () => { window.__frames.push(performance.now()); const t = prof && prof.frameTime; if (typeof t === 'number') { window.__gpuT.push(t); window.__pass = Object.fromEntries([...prof.passTimings].map(([k, v]) => [k, Math.round(v * 100) / 100])); } });
            return 0;`);
        await wait(page, 3000);
        const gpu: number[] = [];
        await hook(page, 'window.__frames.length = 0; window.__gpuT.length = 0; return 0;');
        const held0 = await hook<number>(page, 'return s.renderer.framesHeld;');
        for (let i = 0; i < 10; i++) {
            await wait(page, 1000);
            gpu.push(...await hook<number[]>(page, 'return [...s.renderer.submitDone];'));
        }
        const fr = await hook<number[]>(page, 'return window.__frames.slice();');
        const end = await hook(page, STATE);
        const sorted = [...gpu].sort((a, b) => a - b);
        const q = (x: number) => Math.round(sorted[Math.min(sorted.length - 1, Math.floor(x * (sorted.length - 1)))] * 10) / 10;
        const held = (await hook<number>(page, 'return s.renderer.framesHeld;')) - held0;
        // the engine's GPU profiler (WebGPU timestamp queries): the GPU's own time for each frame's passes
        const gpuT = [...await hook<number[]>(page, 'return window.__gpuT.slice();')].sort((a, b) => a - b);
        const gq = (x: number) => (gpuT.length ? Math.round(gpuT[Math.min(gpuT.length - 1, Math.floor(x * (gpuT.length - 1)))] * 100) / 100 : null);
        const passes = await hook(page, 'return window.__pass;');
        const backbuffer = await hook<number[]>(page, 'return [s.renderer.canvas.width, s.renderer.canvas.height];');
        runs.push({ mode, qs, backbuffer, settledMs, sceneComplete: await hook(page, 'return s.renderer.sceneComplete;'), gpuSubmitToDoneMs: { n: gpu.length, p50: q(0.5), p95: q(0.95) }, gpuProfilerFrameMs: { n: gpuT.length, p50: gq(0.5), p95: gq(0.95) }, lastPassTimingsMs: passes, drawnHz: fr.length > 1 ? Math.round((fr.length - 1) * 10000 / (fr[fr.length - 1] - fr[0])) / 10 : null, framesHeldIn10s: held, period: await hook(page, 'return s.renderer.latencyStats().periodMs;'), engine: end.engine, budgetM: end.budgetM });
        console.log('R6', JSON.stringify(runs[runs.length - 1]));
    }
    out[key] = { scene: HEAVY, budgetM: B, fixedResolution: res ? res[0] : null, runs, pageerrors: errors(log), note: 'governor off: both draw the same budget; submit -> done is GPU time per frame (WebGPU onSubmittedWorkDone), which also moves with the GPU clock (the driver lowers it at a light load); the display caps drawn frames at its rate; frames held = the GPU still had 2 frames in flight' };
    const [s0, st, s1] = runs;
    pass[key] = !!(s0?.engine === false && st?.engine === true && s1?.engine === false && s0.gpuSubmitToDoneMs?.n > 30 && st.gpuSubmitToDoneMs?.n > 30);
    await ctx.close();
}

await browser.close();
// items run separately land in one file: the earlier items of the day stay, a re-run item replaces its own
const prevFile = join(REPO, 'evidence', today(), `v07-render${process.env.EVIDENCE_SUFFIX ?? ''}.json`);
const prev = existsSync(prevFile) ? JSON.parse(readFileSync(prevFile, 'utf8')) as { pass?: Record<string, boolean>; items?: Record<string, unknown>; runs?: Record<string, string> } : {};
const ran = Object.fromEntries(Object.keys(pass).map((k) => [k, new Date().toISOString()]));
const file = writeEvidence('v07-render', { site: SITE, browser: which, pass: { ...prev.pass, ...pass }, runs: { ...prev.runs, ...ran }, items: { ...prev.items, ...out } });
console.log(JSON.stringify(pass), file);
