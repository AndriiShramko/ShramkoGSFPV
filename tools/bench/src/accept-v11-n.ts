// v0.11 lane N: does N go through the owner's catalogue and then on through SuperSplat, on the REAL data?
// (docs/wip/v11-n.md; the owner's item 9 of message 22.) accept-v09-next checks the tour against a MOCKED
// /api/catalog and /api/superspl/explore; this one runs the real page against the real answers.
//   SITE=https://gsfpv.flyreelstudio.eu npx tsx src/accept-v11-n.ts     (the live site: read-only, headless)
//   SITE=http://localhost:<port> FEED=live npx tsx src/accept-v11-n.ts  (a local release, the live answers GET-only)
// Environment: START=<scene id> (default: the first scene of the catalogue the page loaded), PRESSES=<n> (default 16),
// RENDER=off|on (default off: the scan is not drawn, the flight logic is; `on` draws and needs the GPU lock), GAP=<ms> (pause after
// a switch before the next press, default 250), STRESS=scale|budget|both (random render scale / splat budget changes every STRESS_MS=120 ms,
// what the quality governor does on a loaded GPU), FUZZ=toggle (stochastic/sorted switched at random moments, also during a switch), THROTTLE=<rate> (JavaScript <rate> times slower), LOAD=1 (a second page keeps the
// GPU busy), FAULT=first-frame (the renderer's first frame after it was attached during a switch throws, once), TIMELINE=1 (also keep the phases of every switch, not only of the ones that threw),
// SS=abort|503|slow (the SuperSplat proxy stand-in: no answer / 503 / 6.5 s; nothing is sent for it),
// SS=flaky (the first SS_FAILS = 1 requests for a SuperSplat page get no answer, the later ones the real answer: needs the live
// site or FEED=live; the press after the failed one must ask SuperSplat again and bring its scene: the owner's item 9, the
// retry rule of packages/scenes/src/tour.ts; a "retry" verdict is in the evidence),
// CRASH=1 (also the scene after a crash with scenes.autoSwitch), LABEL=<name> (the evidence file's suffix).
// Every press also records what the page threw while it ran (page errors and WebGPU validation errors, each with the page's own
// state at that moment: switch state, scene, whether the session on the hook was disposed, what draws, the hold), so a run that
// logs errors names the press and the phase of the switch (v0.11 lane N, the side finding of docs/wip/v11-n.md section 5).
// Safe by construction: the page's own POST /api/e beacons are answered here with 204, every other write is aborted
// and listed; consent for analytics is answered "no" before the page runs, so nothing goes to Google.
// Every press records from -> to as the page's hook says it (window.__gsfpv.sceneSwitch and scenes.log), where the
// target came from (the catalogue, or not), what the page said, and every SuperSplat request with its status and time.
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import type { BrowserContext, Page } from 'playwright';
import { launchChrome, waitReady } from './browser';
import { REPO, today, writeEvidence } from './evidence';

const SITE = (process.env.SITE ?? '').replace(/\/$/, '');
if (!SITE) throw new Error('SITE=<origin> is required (the live site, or a local release served by tools/bench/scripts/serve-csp.mjs)');
console.log(`accept-v11-n target: ${SITE}`);
const FEED_LIVE = process.env.FEED === 'live';
const LIVE = 'https://gsfpv.flyreelstudio.eu';
const PRESSES = Number(process.env.PRESSES ?? 16);
/** ms between the end of one switch and the next key press (default 250; 0 presses N as soon as the page allows it) */
const GAP = Number(process.env.GAP ?? 250);
/**
 * STRESS=scale|budget|both: the page's own quality governor steps are made frequent and random (a loaded GPU makes frames miss, and
 * the governor then changes the render scale and the splat budget at any moment, also while a scene switches): every STRESS_MS
 * (default 120) the renderer gets a random render scale and/or splat budget, the calls the governor makes (quality.ts apply).
 */
const STRESS = process.env.STRESS === 'scale' || process.env.STRESS === 'budget' || process.env.STRESS === 'both' ? process.env.STRESS : '';
const STRESS_MS = Number(process.env.STRESS_MS ?? 120);
/** THROTTLE=<rate>: the page's JavaScript runs <rate> times slower (CDP Emulation.setCPUThrottlingRate); LOAD=1: a second page of the same browser flies a big scene and keeps the GPU busy */
const THROTTLE = Number(process.env.THROTTLE ?? 1);
const LOAD = process.env.LOAD === '1';
/**
 * FUZZ=toggle: the drawing is switched between stochastic and sorted at random moments (every 30 to 400 ms), the calls REC, the video export,
 * the share picture and the pilot's Render setting make (SplatRenderer.setStochastic), also while a scene switches. Not a pilot's usual
 * night, but each toggle is a call the page makes on its own.
 */
const FUZZ = process.env.FUZZ === 'toggle' ? 'toggle' : '';
/**
 * FAULT=first-frame: the renderer's frame function throws (AccumDrawing.forceFault, inside the guard, the page's own test hook) the first time it
 * should run after the accumulating renderer was attached again during a scene switch: what a real throw in that frame does (the guard hands the
 * renderer back at the frame's end, or after 250 ms when the engine's render threw and the frame never ends). Once per page load.
 */
const FAULT = process.env.FAULT === 'first-frame' ? 'first-frame' : '';
const RENDER = process.env.RENDER === 'on' ? 'on' : 'off';
/** SS=abort|503|slow|flaky: the SuperSplat proxy answers nothing / 503 / after 6.5 s / nothing for the first SS_FAILS requests, then really */
const SS = process.env.SS === 'abort' || process.env.SS === '503' || process.env.SS === 'slow' || process.env.SS === 'flaky' ? process.env.SS : '';
const SS_FAILS = Number(process.env.SS_FAILS ?? 1);
if (SS === 'flaky' && !FEED_LIVE && SITE !== LIVE) throw new Error('SS=flaky needs the real answers for the later requests: FEED=live on a local release, or the live site');
const SHOTS = join(REPO, 'evidence', today(), 'v11-n' + (process.env.LABEL ? `-${process.env.LABEL}` : ''));
mkdirSync(SHOTS, { recursive: true });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const hook = <T = Any>(p: Page, body: string): Promise<T> => p.evaluate(`(() => { const h = window.__gsfpv; const s = h.session; ${body} })()`) as Promise<T>;
const wait = (p: Page, ms: number) => p.waitForTimeout(ms);

interface Req { url: string; status: number | null; ms: number | null; failed?: string }
interface Rec { catalog: Any; catalogRequests: Req[]; explore: Req[]; beacons: string[]; blockedWrites: string[]; requests: number; httpErrors: string[]; exploreAsked: number }

/**
 * Runs in every page before its own scripts: what the page throws, with the page's state at that moment. `window.__ev` gets one entry
 * per page error or WebGPU validation error (uncapturederror of the device), read and emptied after every press. The state is read
 * synchronously inside the handler: the switch (`sw` = state>target), the scene on the hook, `disposed` (the session on the hook was
 * disposed: the old one while a scene loads), what draws, the plan and whether the hold is on, the accumulating renderer's state.
 */
const ERROR_CAPTURE = `(() => {
  window.__ev = [];
  // the accumulating renderer's insides (vendored StochasticSplatRenderer, private fields read as plain properties): which of its passes are
  // enabled, whether its view has bindings (the bind pass points the passes at the view's targets from them), whether the resident set is in,
  // and how often its frame function ran (counted by a wrapper put on it the first time it is seen)
  const inside = (a) => { try {
    const w = a && a.r; if (!w) return null;
    if (!w.__w) { w.__w = 1; w.__fc = 0; const f = w.frame; w.frame = function () { w.__fc++; return f.apply(this, arguments); }; }
    return { en: !!w.enabled, rp: !!w.rasterPass.enabled, tp: !!w.taaPass.enabled, cv: !!w.composeInstance.visible, b: w.views[0].bindings.length, nv: w.views.length,
      set: w.set ? 1 : 0, nc: w.numChunks, pa: !!w.provider.active, fc: w.__fc };
  } catch (e) { return { insideError: String(e).slice(0, 80) }; } };
  const snap = () => { try {
    const h = window.__gsfpv; const ss = h && h.session; const r = ss && ss.renderer;
    const a = r && r.accum ? r.accum : null;
    return { sw: h && h.sceneSwitch ? h.sceneSwitch.state + '>' + h.sceneSwitch.to : null, scene: ss && ss.scene ? ss.scene.id : null, disposed: ss ? !!ss.disposed : null,
      drawn: r ? r.drawn : null, plan: r && r.plan ? (r.plan.draw || '') + '/' + (r.plan.why || '') : null, held: r ? !!r.accumHeld : null,
      accum: a ? { on: a.on, failed: a.failed, failedAt: a.failedAt } : null, inside: inside(a), frame: r ? r.frameNumber : null };
  } catch (e) { return { snapError: String(e).slice(0, 100) }; } };
  const push = (kind, message, stack) => { if (window.__ev.length < 60) window.__ev.push(Object.assign({ t: performance.now(), kind, message: String(message).slice(0, 300), stack: String(stack || '').split(String.fromCharCode(10)).slice(0, 10).join(' | ').slice(0, 1200) }, snap())); };
  addEventListener('error', (e) => push('pageerror', e.message, e.error && e.error.stack));
  addEventListener('unhandledrejection', (e) => push('rejection', e.reason && e.reason.message || e.reason, e.reason && e.reason.stack));
  // the phases of a switch as the page lives them, one entry per change (at most 400 a press): which drawing is held, what draws, the switch
  // state, the scene on the hook, whether its session is disposed, the renderer's passes. Read with the errors after every press.
  // This callback is registered before the engine's, so it runs first in a frame: it sees what the last tick and everything between left.
  window.__tl = []; window.__noframe = 0; let last = ''; let lastFc = -1; let lastFrame = -1;
  const tick = () => { try {
    const s = snap(); const k = s.inside || {};
    // FAULT=first-frame: attached again (loading, hold ended), no frame of the renderer has bound a view since: its frame function will throw
    if (window.__fault === 'first-frame' && !window.__faulted && k.en && k.b === 0 && k.set === 0 && s.sw && /^loading/.test(s.sw)) {
      try { window.__gsfpv.session.renderer.accum.forceFault('frame'); window.__faulted = performance.now(); } catch (e) { /* no hook */ }
    }
    const sig = [s.sw, s.scene, s.disposed, s.drawn, s.held, s.plan, s.accum && s.accum.on, k.en, k.rp, k.tp, k.cv, k.b, k.set, k.nc, k.pa].join('|');
    // the renderer is on, the engine drew a frame, and the renderer's frame function did not run in it: the passes ran on whatever the last frame left
    if (k.en && s.frame !== lastFrame && k.fc === lastFc && lastFc >= 0) { window.__noframe++; if (window.__tl.length < 400) window.__tl.push({ t: performance.now(), noFrameCall: true, inside: k, frame: s.frame }); }
    if (sig !== last && window.__tl.length < 400) { last = sig; window.__tl.push({ t: performance.now(), sw: s.sw, scene: s.scene, disposed: s.disposed, drawn: s.drawn, held: s.held, plan: s.plan, accumOn: s.accum && s.accum.on, inside: s.inside, frame: s.frame }); }
    lastFc = k.fc === undefined ? -1 : k.fc; lastFrame = s.frame;
  } catch (e) { /* the page is not up yet */ } requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  if (navigator.gpu) {
    const ra = navigator.gpu.requestAdapter.bind(navigator.gpu);
    navigator.gpu.requestAdapter = async (o) => {
      const a = await ra(o); if (!a) return a;
      const rd = a.requestDevice.bind(a);
      a.requestDevice = async (d) => { const dev = await rd(d); dev.addEventListener('uncapturederror', (e) => push('gpu', e.error && e.error.message, '')); dev.lost.then((i) => push('devicelost', i.reason + ' ' + i.message, '')); return dev; };
      return a;
    };
  }
})();`;

/** Routes: beacons answered, other writes aborted, (FEED=live) the two API answers fetched with a GET from the live site. */
async function guard(ctx: BrowserContext): Promise<Rec> {
    const rec: Rec = { catalog: null, catalogRequests: [], explore: [], beacons: [], blockedWrites: [], requests: 0, httpErrors: [], exploreAsked: 0 };
    await ctx.addInitScript("try { localStorage.setItem('gsfpv_consent', 'no'); } catch (e) { /* blocked */ }");
    await ctx.addInitScript(`window.__fault = ${JSON.stringify(FAULT)};`);
    await ctx.addInitScript(ERROR_CAPTURE);
    await ctx.route('**/*', async (route) => {
        const req = route.request();
        const u = new URL(req.url());
        const method = req.method();
        rec.requests++;
        if (method !== 'GET' && method !== 'HEAD') {
            if (u.pathname === '/api/e') {
                rec.beacons.push(req.postData()?.slice(0, 120) ?? '');
                return route.fulfill({ status: 204, body: '' });
            }
            rec.blockedWrites.push(`${method} ${u.origin}${u.pathname}`);
            return route.abort();
        }
        // SS=abort|503|slow: what the page sees when the SuperSplat proxy does not give a page (nothing is sent to the live site)
        if (u.pathname === '/api/superspl/explore' && SS === 'flaky') {
            rec.exploreAsked++;
            if (rec.exploreAsked <= SS_FAILS) {
                rec.explore.push({ url: u.search, status: null, ms: 0, failed: 'flaky: not answered (mocked)' });
                return route.abort();
            }
        } else if (u.pathname === '/api/superspl/explore' && SS) {
            if (SS === 'slow') await new Promise((r) => setTimeout(r, 6500));
            if (SS === '503') return route.fulfill({ status: 503, contentType: 'application/json', headers: { 'retry-after': '30' }, body: JSON.stringify({ error: 'busy', detail: 'the catalogue is asked too often; try again shortly' }) });
            return route.abort();
        }
        if (FEED_LIVE && (u.pathname === '/api/catalog' || u.pathname === '/api/superspl/explore')) {
            // the local page, the live answers: a GET to the live site, nothing else
            const t0 = Date.now();
            try {
                const r = await route.fetch({ url: `${LIVE}${u.pathname}${u.search}` });
                (u.pathname === '/api/catalog' ? rec.catalogRequests : rec.explore).push({ url: u.search, status: r.status(), ms: Date.now() - t0 });
                return route.fulfill({ response: r });
            } catch (e) {
                (u.pathname === '/api/catalog' ? rec.catalogRequests : rec.explore).push({ url: u.search, status: null, ms: Date.now() - t0, failed: String(e).slice(0, 120) });
                return route.abort();
            }
        }
        return route.continue();
    });
    return rec;
}

/** What the page asked of the two APIs and what came back (for the live site; FEED=live records them in the route above). */
function watch(page: Page, rec: Rec): void {
    const t0 = new Map<string, number>();
    page.on('request', (r) => { if (!FEED_LIVE) t0.set(r.url(), Date.now()); });
    // every answer that is not a success, by status and path (the browser's console says only "403" without the address)
    page.on('response', (r) => {
        if (r.status() < 400) return;
        const u = new URL(r.url());
        rec.httpErrors.push(`${r.status()} ${u.host}${u.pathname.replace(/[0-9a-f]{8,32}/g, '<id>')}`);
    });
    page.on('response', async (r) => {
        if (FEED_LIVE) return;
        const u = new URL(r.url());
        const ms = Date.now() - (t0.get(r.url()) ?? Date.now());
        if (u.pathname === '/api/catalog') {
            rec.catalogRequests.push({ url: u.search, status: r.status(), ms });
            try { rec.catalog = await r.json(); } catch { /* not JSON */ }
        } else if (u.pathname === '/api/superspl/explore') rec.explore.push({ url: u.search, status: r.status(), ms });
    });
    page.on('requestfailed', (r) => {
        const u = new URL(r.url());
        if (u.pathname === '/api/catalog') rec.catalogRequests.push({ url: u.search, status: null, ms: null, failed: r.failure()?.errorText ?? 'failed' });
        else if (u.pathname === '/api/superspl/explore') rec.explore.push({ url: u.search, status: null, ms: null, failed: r.failure()?.errorText ?? 'failed' });
    });
}

interface Press { i: number; key: string; startedAfterMs: number | null; from: string | null; to: string | null; reason: string | null; state: string; code?: string; ms: number | null; now: string; note: string | null; blockers: string[]; exploreRequests: number; pageErrors: string[]; gpuErrors: number; events: Any[]; timeline?: Any[]; tour: Any }

const blockers = (p: Page) => p.evaluate("[...document.querySelectorAll('#ui .screen, #ui .panel')].map((e) => e.className + (e.getAttribute('data-testid') ? '[' + e.getAttribute('data-testid') + ']' : ''))") as Promise<string[]>;
const hudNote = (p: Page) => p.evaluate("(() => { const e = document.querySelector('.hud-note'); return e && !e.hidden ? e.textContent : null; })()") as Promise<string | null>;
const tourState = (p: Page) => hook<Any>(p, 'const t = h.scenes && h.scenes.tour; return t ? { seen: [...t.seen], consumed: t.stream.consumed, buffer: t.stream.buffer.length, nextSkip: t.stream.nextSkip, exhausted: t.stream.exhausted } : null;');

/** One key press that asks for a scene, and everything observable about what followed. */
async function press(p: Page, rec: Rec, i: number, log: string[], key = 'KeyN'): Promise<Press> {
    const errors0 = log.filter((l) => l.startsWith('pageerror')).length;
    const before = await hook<string>(p, 'return s.scene.id;');
    // the page's own clock at the key press: the errors of this press are told relative to it (one that came between two presses
    // is told by the press after it, with a negative time)
    const pressedAt = await p.evaluate('performance.now()') as number;
    const asked = rec.explore.length;
    const logBefore = await hook<number>(p, 'return h.scenes ? h.scenes.log.length : 0;');
    await hook(p, 'h.sceneSwitch = null; return 0;');
    const notes: string[] = [];
    const note = async (): Promise<void> => { const n = await hudNote(p); if (n && !notes.includes(n)) notes.push(n); };
    const t0 = Date.now();
    await p.keyboard.press(key);
    // the switch starts at once for the catalogue; for SuperSplat it waits for the proxy (4 s at most) first
    let sw: Any = null;
    while (Date.now() - t0 < 30000) {
        sw = await hook<Any>(p, 'return h.sceneSwitch ? { ...h.sceneSwitch } : null;');
        if (sw) break;
        await note();
        await wait(p, 100);
    }
    const startedAfterMs = sw ? Date.now() - t0 : null;
    const stuck = sw === null ? await blockers(p) : [];
    // a switch that began: wait for its end. A scene that fails to load is followed at once by a load of the scene left
    // ('back'), which overwrites the hook, so the failure is read from the host's own log below.
    while (sw && Date.now() - t0 < 240000) {
        const st = await hook<Any>(p, 'return h.sceneSwitch ? { ...h.sceneSwitch } : null;');
        await note();
        if (st && st.state === 'done') { sw = st; break; }
        await wait(p, 150);
    }
    await wait(p, GAP);
    await note();
    const entries = await hook<Any[]>(p, `return h.scenes ? h.scenes.log.slice(${logBefore}).map((x) => ({ from: x.from, to: x.to, reason: x.reason, ok: x.ok, ms: x.ms, code: x.code })) : [];`);
    const now = await hook<string>(p, 'return s.scene.id;');
    const failed = entries.find((e) => !e.ok);
    const state = !sw ? 'no-switch' : failed ? 'failed-then-back' : sw.state;
    const events = (await p.evaluate('window.__ev.splice(0)') as Any[]).map((e) => ({ ...e, t: Math.round(e.t - pressedAt) }));
    // the phases of the switch, kept only for a press that threw (the others would only make the evidence large) or when TIMELINE=1
    const tl = (await p.evaluate('window.__tl.splice(0)') as Any[]).map((e) => ({ ...e, t: Math.round(e.t - pressedAt) }));
    return { i, key, startedAfterMs, from: before, to: entries[0]?.to ?? (sw ? sw.to : null), reason: entries[0]?.reason ?? (sw ? sw.reason : null), state, code: failed?.code, ms: entries[0]?.ms ?? sw?.ms ?? null, now, note: notes.join(' | ') || null, blockers: stuck, exploreRequests: rec.explore.length - asked, pageErrors: log.filter((l) => l.startsWith('pageerror')).slice(errors0).map((l) => l.slice(0, 120)), gpuErrors: events.filter((e) => e.kind === 'gpu').length, events, ...(events.length > 0 || process.env.TIMELINE === '1' ? { timeline: tl } : {}), tour: await tourState(p) };
}

async function open(p: Page, scene: string): Promise<void> {
    await p.goto(`${SITE}/en/fly/?scene=${scene}&nowarn=1&render=${RENDER}&input=touch`);
    await waitReady(p, 240000);
    await wait(p, 600);
}

if (process.env.LABEL) process.env.EVIDENCE_SUFFIX ??= `-${process.env.LABEL}`;
const { browser, which } = await launchChrome();
const out: Record<string, Any> = { site: SITE, feed: FEED_LIVE ? `live answers (${LIVE}, GET only)` : 'the page\'s own', browser: which, render: RENDER, presses: PRESSES, superSplatProxy: SS ? `simulated: ${SS}` : 'real' };
try {
    // ------------------------------------------------------------------ the catalogue as the page sees it
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    const rec = await guard(ctx);
    const page = await ctx.newPage();
    const log: string[] = [];
    page.on('console', (m) => log.push(`${m.type()}: ${m.text()}`.slice(0, 300)));
    page.on('pageerror', (e) => log.push(`pageerror: ${e.message}`.slice(0, 300)));
    watch(page, rec);
    const first = process.env.START ?? '887f27aa';
    if (THROTTLE > 1) await (await ctx.newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
    if (LOAD) {
        // another page on the same GPU, drawing a big scene at full size all the time (its own context: no state shared with the measured one)
        const lctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
        await lctx.route('**/api/e', (r) => r.fulfill({ status: 204, body: '' }));
        await lctx.addInitScript("try { localStorage.setItem('gsfpv_consent', 'no'); } catch (e) { /* blocked */ }");
        const lpage = await lctx.newPage();
        await lpage.goto(`${SITE}/en/fly/?scene=0230d903&nowarn=1&render=on&input=touch&stochastic`);
        await waitReady(lpage, 240000);
        out.load = 'a second page flies 0230d903 drawn (stochastic) for the whole run';
    }
    await open(page, first);
    const catalogue: Any[] = rec.catalog?.scenes ?? [];
    if (FEED_LIVE) {
        // the route fulfilled the live answer: read it back the same way the page did
        const c = await page.evaluate("fetch('/api/catalog').then((r) => r.json())") as Any;
        rec.catalog = c;
    }
    const scenes: Any[] = (rec.catalog?.scenes ?? catalogue) as Any[];
    const order = scenes.filter((s) => !s.hidden);
    const catalogueIds: string[] = [...order.filter((s) => s.pinned), ...order.filter((s) => !s.pinned)].map((s) => s.id);
    out.catalogue = { count: scenes.length, ids: catalogueIds, pinned: scenes.filter((s) => s.pinned).map((s) => s.id), hidden: scenes.filter((s) => s.hidden).map((s) => s.id), requests: rec.catalogRequests };
    const startScene = await hook<string>(page, 'return s.scene.id;');
    out.start = startScene;
    if (FUZZ) {
        out.fuzz = FUZZ;
        await page.evaluate(`(() => { const r = window.__gsfpv.session.renderer; window.__fuzzCalls = 0;
          const go = () => { r.setStochastic(Math.random() < 0.5); window.__fuzzCalls++; window.__fuzz = setTimeout(go, 30 + Math.random() * 370); };
          window.__fuzz = setTimeout(go, 500); })()`);
    }
    if (STRESS) {
        out.stress = { kind: STRESS, everyMs: STRESS_MS };
        await page.evaluate(`(() => { const r = window.__gsfpv.session.renderer; const pick = (a) => a[Math.floor(Math.random() * a.length)];
          window.__stress = setInterval(() => {
            if (${JSON.stringify(STRESS)} !== 'budget') r.setRenderScale(pick([0.5, 0.6, 0.75, 0.9, 1]));
            if (${JSON.stringify(STRESS)} !== 'scale') r.setSplatBudgetMillions(pick([1, 1.5, 2, 3, 4]));
          }, ${STRESS_MS}); })()`);
    }
    const settings = await hook<Any>(page, "return { rotation: h.prefs.get('scenes.rotation'), order: h.prefs.get('scenes.order'), autoSwitch: h.prefs.get('scenes.autoSwitch'), allowNoWalls: h.prefs.get('scenes.allowNoWalls') };");
    out.settings = settings;
    // a run where the scan should be drawn but was not (or the page was hidden) is no evidence for RENDER=on
    out.page = await hook<Any>(page, "return { render: h.info && h.info.render, visibility: document.visibilityState, status: h.status };");
    // what draws (the owner's presets decide it on the live catalogue: stochastic is the desktop default there)
    out.drawing = await hook<Any>(page, "const d = h.drawing; return d ? { class: d.class, stochastic: d.stochastic, from: d.from, impl: d.impl, plan: d.plan, drawn: d.drawn, accumMissing: d.accumMissing, webgpu: d.webgpu } : null;");
    console.log('page', JSON.stringify(out.page), 'drawing', JSON.stringify(out.drawing));
    console.log('catalogue', JSON.stringify(catalogueIds), 'start', startScene, 'settings', JSON.stringify(settings));

    const presses: Press[] = [];
    for (let i = 1; i <= PRESSES; i++) {
        const r = await press(page, rec, i, log);
        presses.push(r);
        const where = r.to === null ? '-' : catalogueIds.includes(r.to) ? 'catalogue' : 'NOT-catalogue';
        console.log(`N${String(i).padStart(2)}  ${r.from} -> ${r.to}  [${where}] ${r.state}${r.code ? ' ' + r.code : ''}  now=${r.now}  ms=${r.ms}  startedAfter=${r.startedAfterMs}  explore=${r.exploreRequests}${r.note ? '  note=' + r.note : ''}${r.blockers.length ? '  blockers=' + r.blockers.join(',') : ''}${r.pageErrors.length ? '  PAGE-ERRORS=' + r.pageErrors.length + ' ' + r.pageErrors[0] : ''}${r.gpuErrors ? '  GPU-ERRORS=' + r.gpuErrors : ''}`);
        if (r.state === 'no-switch' && r.blockers.length) break;
    }
    if (FUZZ) out.fuzzCalls = await page.evaluate('window.__fuzzCalls');
    if (FAULT) out.faulted = await page.evaluate('window.__faulted || null');
    await wait(page, 1500);
    const lateEvents = (await page.evaluate('window.__ev.splice(0)') as Any[]);
    const sequence = [startScene, ...presses.map((p) => p.now)];
    const switchLog = await hook<Any>(page, 'return h.scenes ? h.scenes.log.map((x) => ({ from: x.from, to: x.to, reason: x.reason, ok: x.ok, ms: x.ms, code: x.code })) : null;');
    const firstNonCatalogue = presses.findIndex((p) => p.to !== null && !catalogueIds.includes(p.to));
    const catalogueVisited = new Set(sequence.filter((id) => catalogueIds.includes(id)));
    const wrappedEarly = presses.find((p, k) => p.to !== null && catalogueIds.includes(p.to) && sequence.slice(0, k + 1).includes(p.to));
    await page.screenshot({ path: join(SHOTS, 'after-presses.png') });
    out.run = {
        sequence,
        presses,
        switchLog,
        catalogueScenesVisited: catalogueVisited.size,
        firstPressIntoSuperSplat: firstNonCatalogue >= 0 ? firstNonCatalogue + 1 : null,
        // a catalogue scene shown a second time before every one was shown once, or SuperSplat never reached
        repeatBeforeSuperSplat: wrappedEarly ? { press: wrappedEarly.i, to: wrappedEarly.to } : null,
        superSplatRequests: rec.explore,
        beaconsAnswered: rec.beacons.length,
        blockedWrites: rec.blockedWrites,
        requests: rec.requests,
        httpErrors: rec.httpErrors,
        pageErrors: log.filter((l) => l.startsWith('pageerror')).slice(0, 10),
        // every page error and WebGPU validation error of the run, by press (the events themselves are in presses[].events)
        errorsByPress: presses.filter((p) => p.events.length > 0).map((p) => ({ press: p.i, from: p.from, to: p.to, ms: p.ms, pageErrors: p.events.filter((e) => e.kind === 'pageerror').length, gpuErrors: p.gpuErrors })),
        errorsAfterTheLastPress: lateEvents,
        totalPageErrors: log.filter((l) => l.startsWith('pageerror')).length,
        totalGpuErrors: presses.reduce((n, p) => n + p.gpuErrors, 0) + lateEvents.filter((e) => e.kind === 'gpu').length,
        consoleErrors: log.filter((l) => l.startsWith('error') || l.startsWith('warning')).slice(0, 20)
    };
    console.log('sequence', sequence.join(' > '));
    console.log('catalogue scenes visited', catalogueVisited.size, 'of', catalogueIds.length, '| first press into SuperSplat:', out.run.firstPressIntoSuperSplat, '| repeat before SuperSplat:', JSON.stringify(out.run.repeatBeforeSuperSplat));
    console.log('SuperSplat requests', JSON.stringify(rec.explore), '| blocked writes', JSON.stringify(rec.blockedWrites));
    const byError = new Map<string, number>();
    for (const e of rec.httpErrors) byError.set(e, (byError.get(e) ?? 0) + 1);
    console.log('answers >= 400:', JSON.stringify([...byError]), '| page errors:', out.run.totalPageErrors, '| WebGPU validation errors:', out.run.totalGpuErrors, '| by press:', JSON.stringify(out.run.errorsByPress));
    if (SS === 'flaky') {
        // the retry rule (packages/scenes/src/tour.ts): SuperSplat failed at press k (its request got no answer), so press k+1 asks again and
        // brings a SuperSplat scene; the failed press itself showed the owner's next scene and the list-starts-again note
        const failedAt = presses.findIndex((p) => p.exploreRequests > 0);
        const failedPress = failedAt >= 0 ? presses[failedAt] : null;
        const next = failedAt >= 0 ? presses[failedAt + 1] : null;
        out.retry = {
            failsConfigured: SS_FAILS,
            failedPress: failedPress ? { i: failedPress.i, to: failedPress.to, inCatalogue: failedPress.to !== null && catalogueIds.includes(failedPress.to), note: failedPress.note } : null,
            nextPress: next ? { i: next.i, to: next.to, inCatalogue: next.to !== null && catalogueIds.includes(next.to), exploreRequests: next.exploreRequests } : null,
            // the first press after the last mocked failure must bring a scene that is not the owner's
            pass: !!failedPress && failedPress.to !== null && catalogueIds.includes(failedPress.to) && /starts again/.test(failedPress.note ?? '')
                && presses.slice(failedAt, failedAt + SS_FAILS).every((p) => p.to !== null && catalogueIds.includes(p.to) && p.exploreRequests > 0)
                && !!presses[failedAt + SS_FAILS] && presses[failedAt + SS_FAILS].to !== null && !catalogueIds.includes(presses[failedAt + SS_FAILS].to!) && presses[failedAt + SS_FAILS].exploreRequests > 0
        };
        console.log('retry', out.retry.pass ? 'PASS' : 'FAIL', JSON.stringify(out.retry));
    }
    await ctx.close();

    // ------------------------------------------------------------------ the scene after a crash (scenes.autoSwitch)
    if (process.env.CRASH === '1') {
        const c2 = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
        const rec2 = await guard(c2);
        const p2 = await c2.newPage();
        const log2: string[] = [];
        p2.on('pageerror', (e) => log2.push(`pageerror: ${e.message}`.slice(0, 300)));
        watch(p2, rec2);
        await p2.goto(`${SITE}/en/fly/?scene=${first}&simradio=raw&nobuttons=1&react=300&nowarn=1&render=${RENDER}`);
        await waitReady(p2, 240000);
        const t0 = Date.now();
        while (Date.now() - t0 < 90000) {
            if ((await hook<string | null>(p2, 'const w = h.radio && h.radio.wizard; return w ? w.state.id : null;')) === 'check') break;
            await wait(p2, 250);
        }
        await p2.click('[data-action="wizard-done"]');
        await wait(p2, 400);
        await hook(p2, "h.prefs.set('scenes.autoSwitch', true); return 0;");
        const crashes: Any[] = [];
        for (let k = 1; k <= 3; k++) {
            const from = await hook<string>(p2, 'return s.scene.id;');
            await hook(p2, 'h.sceneSwitch = null; return 0;');
            await hook(p2, "h.fake.set('T', -1); h.fake.arm = false; h.prefs.set('respawn.platform', false); s.rebuildSim(s.presetId, { ...s.overrides, vCrash: 2 }); h.prefs.set('respawn.platform', true); return 0;");
            await wait(p2, 400);
            await hook(p2, 'h.fake.arm = true; return 0;');
            let sw: Any = null;
            const t1 = Date.now();
            while (Date.now() - t1 < 60000) {
                sw = await hook<Any>(p2, 'return h.sceneSwitch ? { ...h.sceneSwitch } : null;');
                if (sw && (sw.state === 'done' || sw.state === 'failed')) break;
                await wait(p2, 200);
            }
            await wait(p2, 500);
            const now = await hook<string>(p2, 'return s.scene.id;');
            crashes.push({ k, from, switch: sw, now, note: await hudNote(p2) });
            console.log(`crash ${k}: ${from} -> ${sw ? sw.to : 'no switch'} (${sw ? sw.state + '/' + sw.reason : '-'}) now=${now}`);
        }
        out.crash = { startScene: first, crashes, expectedFirst: catalogueIds[(catalogueIds.indexOf(first) + 1) % catalogueIds.length], pageErrors: log2.filter((l) => !/reading 'armed'/.test(l)).slice(0, 10), blockedWrites: rec2.blockedWrites };
        await c2.close();
    }
} finally {
    await browser.close();
}
const file = writeEvidence('v11-n', out);
console.log('evidence', file);
