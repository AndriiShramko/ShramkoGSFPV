// v0.11 lane N: does N go through the owner's catalogue and then on through SuperSplat, on the REAL data?
// (docs/wip/v11-n.md; the owner's item 9 of message 22.) accept-v09-next checks the tour against a MOCKED
// /api/catalog and /api/superspl/explore; this one runs the real page against the real answers.
//   SITE=https://gsfpv.flyreelstudio.eu npx tsx src/accept-v11-n.ts     (the live site: read-only, headless)
//   SITE=http://localhost:<port> FEED=live npx tsx src/accept-v11-n.ts  (a local release, the live answers GET-only)
// Environment: START=<scene id> (default: the first scene of the catalogue the page loaded), PRESSES=<n> (default 16),
// RENDER=off|on (default off: the scan is not drawn, the flight logic is; `on` draws and needs the GPU lock),
// SS=abort|503|slow (the SuperSplat proxy stand-in: no answer / 503 / 6.5 s; nothing is sent for it),
// CRASH=1 (also the scene after a crash with scenes.autoSwitch), LABEL=<name> (the evidence file's suffix).
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
const RENDER = process.env.RENDER === 'on' ? 'on' : 'off';
/** SS=abort|503|slow: the SuperSplat proxy answers nothing / 503 / after 6.5 s (a stand-in for a proxy that is down, busy or slow) */
const SS = process.env.SS === 'abort' || process.env.SS === '503' || process.env.SS === 'slow' ? process.env.SS : '';
const SHOTS = join(REPO, 'evidence', today(), 'v11-n' + (process.env.LABEL ? `-${process.env.LABEL}` : ''));
mkdirSync(SHOTS, { recursive: true });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const hook = <T = Any>(p: Page, body: string): Promise<T> => p.evaluate(`(() => { const h = window.__gsfpv; const s = h.session; ${body} })()`) as Promise<T>;
const wait = (p: Page, ms: number) => p.waitForTimeout(ms);

interface Req { url: string; status: number | null; ms: number | null; failed?: string }
interface Rec { catalog: Any; catalogRequests: Req[]; explore: Req[]; beacons: string[]; blockedWrites: string[]; requests: number; httpErrors: string[] }

/** Routes: beacons answered, other writes aborted, (FEED=live) the two API answers fetched with a GET from the live site. */
async function guard(ctx: BrowserContext): Promise<Rec> {
    const rec: Rec = { catalog: null, catalogRequests: [], explore: [], beacons: [], blockedWrites: [], requests: 0, httpErrors: [] };
    await ctx.addInitScript("try { localStorage.setItem('gsfpv_consent', 'no'); } catch (e) { /* blocked */ }");
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
        if (u.pathname === '/api/superspl/explore' && SS) {
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

interface Press { i: number; key: string; startedAfterMs: number | null; from: string | null; to: string | null; reason: string | null; state: string; code?: string; ms: number | null; now: string; note: string | null; blockers: string[]; exploreRequests: number; pageErrors: string[]; tour: Any }

const blockers = (p: Page) => p.evaluate("[...document.querySelectorAll('#ui .screen, #ui .panel')].map((e) => e.className + (e.getAttribute('data-testid') ? '[' + e.getAttribute('data-testid') + ']' : ''))") as Promise<string[]>;
const hudNote = (p: Page) => p.evaluate("(() => { const e = document.querySelector('.hud-note'); return e && !e.hidden ? e.textContent : null; })()") as Promise<string | null>;
const tourState = (p: Page) => hook<Any>(p, 'const t = h.scenes && h.scenes.tour; return t ? { seen: [...t.seen], consumed: t.stream.consumed, buffer: t.stream.buffer.length, nextSkip: t.stream.nextSkip, exhausted: t.stream.exhausted } : null;');

/** One key press that asks for a scene, and everything observable about what followed. */
async function press(p: Page, rec: Rec, i: number, log: string[], key = 'KeyN'): Promise<Press> {
    const errors0 = log.filter((l) => l.startsWith('pageerror')).length;
    const before = await hook<string>(p, 'return s.scene.id;');
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
    await wait(p, 250);
    await note();
    const entries = await hook<Any[]>(p, `return h.scenes ? h.scenes.log.slice(${logBefore}).map((x) => ({ from: x.from, to: x.to, reason: x.reason, ok: x.ok, ms: x.ms, code: x.code })) : [];`);
    const now = await hook<string>(p, 'return s.scene.id;');
    const failed = entries.find((e) => !e.ok);
    const state = !sw ? 'no-switch' : failed ? 'failed-then-back' : sw.state;
    return { i, key, startedAfterMs, from: before, to: entries[0]?.to ?? (sw ? sw.to : null), reason: entries[0]?.reason ?? (sw ? sw.reason : null), state, code: failed?.code, ms: entries[0]?.ms ?? sw?.ms ?? null, now, note: notes.join(' | ') || null, blockers: stuck, exploreRequests: rec.explore.length - asked, pageErrors: log.filter((l) => l.startsWith('pageerror')).slice(errors0).map((l) => l.slice(0, 120)), tour: await tourState(p) };
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
    const settings = await hook<Any>(page, "return { rotation: h.prefs.get('scenes.rotation'), order: h.prefs.get('scenes.order'), autoSwitch: h.prefs.get('scenes.autoSwitch'), allowNoWalls: h.prefs.get('scenes.allowNoWalls') };");
    out.settings = settings;
    // a run where the scan should be drawn but was not (or the page was hidden) is no evidence for RENDER=on
    out.page = await hook<Any>(page, "return { render: h.info && h.info.render, visibility: document.visibilityState, status: h.status };");
    console.log('page', JSON.stringify(out.page));
    console.log('catalogue', JSON.stringify(catalogueIds), 'start', startScene, 'settings', JSON.stringify(settings));

    const presses: Press[] = [];
    for (let i = 1; i <= PRESSES; i++) {
        const r = await press(page, rec, i, log);
        presses.push(r);
        const where = r.to === null ? '-' : catalogueIds.includes(r.to) ? 'catalogue' : 'NOT-catalogue';
        console.log(`N${String(i).padStart(2)}  ${r.from} -> ${r.to}  [${where}] ${r.state}${r.code ? ' ' + r.code : ''}  now=${r.now}  ms=${r.ms}  startedAfter=${r.startedAfterMs}  explore=${r.exploreRequests}${r.note ? '  note=' + r.note : ''}${r.blockers.length ? '  blockers=' + r.blockers.join(',') : ''}${r.pageErrors.length ? '  PAGE-ERRORS=' + r.pageErrors.length + ' ' + r.pageErrors[0] : ''}`);
        if (r.state === 'no-switch' && r.blockers.length) break;
    }
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
        consoleErrors: log.filter((l) => l.startsWith('error') || l.startsWith('warning')).slice(0, 20)
    };
    console.log('sequence', sequence.join(' > '));
    console.log('catalogue scenes visited', catalogueVisited.size, 'of', catalogueIds.length, '| first press into SuperSplat:', out.run.firstPressIntoSuperSplat, '| repeat before SuperSplat:', JSON.stringify(out.run.repeatBeforeSuperSplat));
    console.log('SuperSplat requests', JSON.stringify(rec.explore), '| blocked writes', JSON.stringify(rec.blockedWrites));
    const byError = new Map<string, number>();
    for (const e of rec.httpErrors) byError.set(e, (byError.get(e) ?? 0) + 1);
    console.log('answers >= 400:', JSON.stringify([...byError]), '| page errors:', out.run.pageErrors.length);
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
