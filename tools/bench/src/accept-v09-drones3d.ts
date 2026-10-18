// v0.9 lane D acceptance (docs/wip/v09-d.md): the 3D models of the drones in the real simulator, on a release served locally.
// What it proves, each with a negative control that must fire:
//  V1  the drone picker's stage draws a non-empty model for every one of the nine presets (pixels of the canvas against
//      its background), each picture differs from the others, the callouts are there (legend rows, pins), the turntable
//      follows a drag. Controls: the base release has no stage at all (BASE_SITE, built from 631fd5f); the same preset
//      shot twice is not "different"; no drag, no change.
//  V2  GPU memory is freed on close: the stage counts its textures, buffers and shaders while open, closing the picker
//      disposes it (one canvas left on the page, created = disposed, WebGPU reports the device destroyed), five times in a
//      row, and the flight app is alive after. Control: with the picker open the same counters are not zero.
//  V3  the cinelifter: the legend says RED KOMODO 6K and that iFlight sells it without a camera; picking "No camera" on
//      the stage changes the card numbers (TWR 3.3 -> 5.6) and, when the cinelifter is the drone flown, its flight model
//      (mass 4.872 -> 2.872 kg), and it is still so after a reload; "RED KOMODO" again restores the preset's numbers.
//  V4  the pause menu's "Your drone" card draws and goes with the menu; "Change drone" opens the picker.
//  V5  the legend speaks Polish and Russian in the same build (maker names unchanged).
//  V6  the WebGL2 fallback (navigator.gpu removed) draws too.
//  V8  Settings -> Drone & physics: the drone row carries a small turntable of the drone the setting names; picking another
//      drone in the row changes it; closing Settings frees it. Control: the settings row of the base release has no card.
//  V7  the 3D chunk is fetched only when a picker or the pause menu opens, not at page load (and its size).
//  V9  (review finding 2) the same surfaces WITH THE SCAN DRAWN (no ?render=off): the flight canvas draws a real scan while the pause
//      card, the picker and the settings drone card open and close five times each; the flight keeps drawing (engine frames advance,
//      at least half the baseline rate), its device is not lost, its canvas is not blank, nothing is left on the GPU, and the time
//      to the first stage frame and the longest main-thread task are recorded. Controls: the same page with ?render=off has a
//      blank flight canvas (the "scan drawn" predicate fails), and a 400 ms stall injected in the page shows up as a long task and
//      a frame-rate dip (the stall measures can see).
//  V10 (review findings 1, 3, 4, 5, 6, 7), each a check that must FAIL on the release before the fixes (PRE_SITE, built from
//      06bef1f) and PASS on this one: the stage's weight and thrust-to-weight line follows the camera load; the pause card and the
//      settings card show the load the pilot flies with; the GoPro's 157 g and its maker link; a camera chip keeps keyboard focus
//      and the turned view; "Help tune it" applies the load; the first view keeps the model off the stage's edge; the pilot's
//      Reduced motion setting stops the turntable.
// Without V9 the scan is not loaded (?render=off: logic-only page) and the only drawing is the stage's own. It holds the GPU lock.
//   node scripts/build-release.mjs && node tools/bench/scripts/serve-csp.mjs dist <port>     (another shell)
//   cd tools/bench && SITE=http://localhost:<port> BASE_SITE=http://localhost:<port2> PRE_SITE=http://localhost:<port3> npx tsx src/accept-v09-drones3d.ts
// Evidence: evidence/<date>/v09-drones3d.json and evidence/<date>/drones/<preset>.png (the stage of each drone).
import { mkdirSync, rmdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserContext, Page } from 'playwright';
import { launchChrome } from './browser';
import { REPO, today, writeEvidence } from './evidence';

if (!process.env.SITE) throw new Error('accept-v09-drones3d needs SITE=http://localhost:<port> (a local release; never the live site)');
const SITE = process.env.SITE.replace(/\/$/, '');
const BASE_SITE = (process.env.BASE_SITE ?? '').replace(/\/$/, '');
const PRE_SITE = (process.env.PRE_SITE ?? '').replace(/\/$/, '');
const ONLY = (process.env.ACCEPT_ONLY ?? '').split(',').map((x) => x.trim().toUpperCase()).filter(Boolean);
const want = (k: string): boolean => ONLY.length === 0 || ONLY.includes(k);
for (const s of [SITE, BASE_SITE, PRE_SITE]) if (s && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(s)) throw new Error(`SITE, BASE_SITE and PRE_SITE must be local releases, got ${s}`);
console.log(`accept-v09-drones3d target: ${SITE}  base (control): ${BASE_SITE || '(none)'}  before-the-review-fixes (control): ${PRE_SITE || '(none)'}`);
if (!BASE_SITE) throw new Error('BASE_SITE is needed: the negative control is the release built from the base commit 631fd5f');
if (!PRE_SITE) throw new Error('PRE_SITE is needed: the V10 checks must fail on the release built from 06bef1f, before the review fixes');

const IDS = ['pavo20pro-3s', 'pavo20pro2-3s', 'pavo20pro2-4s', 'pavopico-2s', 'meteor65pro-1s', 'air65-1s', 'nazgulf5v3-6s', 'machr5sport-6s', 'taurusx8-komodo-6s'];
const CINE = 'taurusx8-komodo-6s';
const SCENE = '39e63ce9';
const OUT = join(REPO, 'evidence', today(), 'drones');
mkdirSync(OUT, { recursive: true });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
/** ACCEPT_TRACE=1: where a long run is (a step that hangs shows as the last line). Every trace is also a sign of life for the watchdog. */
let lastStep = 'start';
let lastLife = Date.now();
const trace = (...a: unknown[]): void => { lastStep = a.join(' '); lastLife = Date.now(); if (process.env.ACCEPT_TRACE) console.log('trace', ...a); };
const results: Record<string, Any> = {};
const cb = (): string => `cb=${Math.random().toString(36).slice(2)}`;
/** `scan: true` loads and draws the scan (V9); otherwise ?render=off, the logic-only page */
const url = (site: string, qs: string, lang = 'en', scan = false): string => `${site}/${lang}/fly/?scene=${SCENE}&nowarn=1&input=touch${scan ? '' : '&render=off'}&${qs}&${cb()}`;

// ------------------------------------------------------------------ the GPU lock
const LOCK = 'C:/dev/.gpu-lock';
let haveLock = false;
let waited = 0;
async function lock(): Promise<void> {
    for (;;) {
        try { mkdirSync(LOCK); haveLock = true; lockedAt = Date.now(); return; } catch {
            try { if (Date.now() - statSync(LOCK).mtimeMs > 20 * 60 * 1000) { rmdirSync(LOCK); continue; } } catch { /* gone meanwhile */ }
            if (!waited++ || waited % 600 === 0) console.log('waiting for the GPU lock');
            await sleep(100);
        }
    }
}
const unlock = (): void => { if (haveLock) { try { rmdirSync(LOCK); } catch { /* */ } haveLock = false; } };
process.on('SIGINT', () => { unlock(); process.exit(130); });
// A page whose renderer hangs leaves a Playwright call waiting for good (evaluate has no timeout) and the lock held until another run
// takes it as stale (20 minutes). Every step of the run is a sign of life (trace); no sign for 3 minutes, or 19 minutes with the lock:
// the lock is freed and the run stops, saying where it was.
let lockedAt = 0;
let theCtx: BrowserContext | null = null;
/** Where the JavaScript of each open page is right now (the debugger is asked to pause it): a loop in the page shows as its call stack. */
async function diagnose(): Promise<void> {
    if (!theCtx) return;
    for (const pg of theCtx.pages()) {
        try {
            const cdp = await theCtx.newCDPSession(pg);
            const where = await Promise.race([
                new Promise<string>((res) => {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    cdp.on('Debugger.paused', (e: any) => res(e.callFrames.slice(0, 8).map((f: any) => `${f.functionName || '(anonymous)'} ${String(f.url).split('/').pop()}:${f.location.lineNumber}`).join(' <- ')));
                    void cdp.send('Debugger.enable').then(() => cdp.send('Debugger.pause'));
                }),
                sleep(4000).then(() => 'no pause within 4 s: its JavaScript is not running, or the renderer does not answer')
            ]);
            console.error('  page', pg.url().slice(0, 100), '->', where);
        } catch (e) { console.error('  page', pg.url().slice(0, 100), 'could not be asked:', String(e).slice(0, 120)); }
    }
}
let stopping = false;
setInterval(() => {
    if (!haveLock || stopping) return;
    const quiet = Date.now() - lastLife, held = Date.now() - lockedAt;
    if (quiet > 2 * 60 * 1000 || held > 19 * 60 * 1000) {
        stopping = true;
        console.error(`accept-v09-drones3d: WATCHDOG (${Math.round(quiet / 1000)} s without a step, ${Math.round(held / 1000)} s with the GPU lock), last step: ${lastStep}`);
        void Promise.race([diagnose(), sleep(20000)]).finally(() => { console.error('freed the lock and stopped'); unlock(); process.exit(3); });
    }
}, 5000).unref();

// ------------------------------------------------------------------ page helpers
async function open(page: Page, site: string, qs: string, lang = 'en', scan = false): Promise<void> {
    trace('open', site, qs, scan ? 'scan' : 'render=off');
    await page.goto(url(site, qs, lang, scan));
    const t0 = Date.now();
    for (;;) {
        trace('open: waiting for the page');
        const h = await page.evaluate(() => { const w = window as Any; return w.__gsfpv ? { status: w.__gsfpv.status, error: w.__gsfpv.error } : null; });
        if (h && h.status !== 'loading') { if (h.status !== 'ready') throw new Error(`page not ready: ${JSON.stringify(h)}`); trace('ready'); return; }
        if (Date.now() - t0 > (scan ? 240000 : 120000)) throw new Error('page did not become ready');
        await sleep(250);
    }
}

async function openPicker(page: Page): Promise<void> {
    trace('openPicker');
    await page.keyboard.press('KeyP');
    await page.click('[data-action="pause.drone"]');
    await page.waitForSelector('.screen.drones');
}

async function closePicker(page: Page): Promise<void> {
    trace('closePicker');
    await page.click('[data-action="drone-close"]');
    await page.waitForSelector('.screen.drones', { state: 'detached' });
}

const hookInfos = (page: Page): Promise<Any[]> => page.evaluate(() => ((window as Any).__gsfpvDrones3d?.infos() ?? []) as Any[]);
const hookCounts = (page: Page): Promise<Any> => page.evaluate(() => { const k = (window as Any).__gsfpvDrones3d; return k ? { created: k.created, disposed: k.disposed, live: k.live, lastClosed: k.lastClosed } : null; });

/** The stage has drawn `n` more frames than when this was called. */
async function frames(page: Page, n: number, timeoutMs = 20000): Promise<boolean> {
    trace('frames', n);
    const f0 = (await hookInfos(page))[0]?.frames ?? 0;
    try { await page.waitForFunction((want) => ((window as Any).__gsfpvDrones3d?.infos()[0]?.frames ?? 0) >= want, f0 + n, { timeout: timeoutMs }); return true; } catch { return false; }
}

/** Decode a PNG in the page and measure it: share of pixels unlike the background (the corners), and a 24 x 15 luminance grid. */
async function measure(page: Page, png: Buffer): Promise<{ w: number; h: number; lit: number; sig: number[] }> {
    return page.evaluate(async (b64) => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
        const c = document.createElement('canvas');
        c.width = bmp.width; c.height = bmp.height;
        const g = c.getContext('2d')!;
        g.drawImage(bmp, 0, 0);
        const d = g.getImageData(0, 0, c.width, c.height).data;
        const px = (x: number, y: number): number[] => { const i = (y * c.width + x) * 4; return [d[i], d[i + 1], d[i + 2]]; };
        const corners = [px(2, 2), px(c.width - 3, 2), px(2, c.height - 3), px(c.width - 3, c.height - 3)];
        const bg = [0, 1, 2].map((k) => corners.reduce((s, p) => s + p[k], 0) / 4);
        let lit = 0;
        for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]) > 54) lit++;
        const sig: number[] = [];
        const gw = 24, gh = 15;
        for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
            let s = 0, n = 0;
            const x0 = Math.floor((gx * c.width) / gw), x1 = Math.floor(((gx + 1) * c.width) / gw), y0 = Math.floor((gy * c.height) / gh), y1 = Math.floor(((gy + 1) * c.height) / gh);
            for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) { const i = (y * c.width + x) * 4; s += d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11; n++; }
            sig.push(s / Math.max(1, n) / 255);
        }
        return { w: c.width, h: c.height, lit: lit / (c.width * c.height), sig };
    }, png.toString('base64'));
}
const sigDiff = (a: number[], b: number[]): number => a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0) / a.length;

/** The canvas alone (pins and hints hidden), as a PNG. */
async function canvasShot(page: Page, sel = '.d3-canvas'): Promise<Buffer> {
    await page.addStyleTag({ content: '.d3-pins,.d3-over,.d3-status{visibility:hidden !important}' }).catch(() => undefined);
    const buf = await page.locator(sel).first().screenshot();
    await page.evaluate(() => { for (const s of Array.from(document.querySelectorAll('style'))) if (s.textContent?.includes('.d3-pins,.d3-over')) s.remove(); });
    return buf;
}

/**
 * The picker as the pilot sees it: the window, with the canvas scrolled into view first. Not an element screenshot of the stage: the stage
 * with its legend is taller than the window, and Playwright lays the page out again at the element's height for it (the canvas, clamped to
 * 56vh, comes out another shape, cropped under the heading): the first pictures of this lane were taken that way.
 */
async function stagePicture(page: Page, path: string): Promise<void> {
    await page.locator('.d3-view').scrollIntoViewIfNeeded();
    await page.screenshot({ path });
}
/** The canvas lies wholly inside what the pilot can see: below the top of the scrolling screen and above the bottom of the window. */
async function canvasInView(page: Page): Promise<boolean> {
    return page.evaluate(() => {
        const c = document.querySelector('.d3-canvas')?.getBoundingClientRect();
        const sc = (document.querySelector('.screen.drones') ?? document.documentElement).getBoundingClientRect();
        return !!c && c.top >= sc.top - 0.5 && c.bottom <= Math.min(sc.bottom, innerHeight) + 0.5 && c.left >= -0.5 && c.right <= innerWidth + 0.5;
    });
}

const NONEMPTY = 0.035;
/** the least share of the stage's width or height left free between the model and an edge: at least this, or the model is clipped or touching (V1, V10) */
const EDGE_MIN = 0.01;
/**
 * How far the model is from the nearest edge of the stage, as a share of that dimension (negative: it crosses the edge), from the stage's
 * own camera projection of every vertex of the model (window.__gsfpvDrones3d.extents(); a release without the hook gives null).
 */
async function edgeMargin(page: Page): Promise<number | null> {
    return page.evaluate(() => {
        const k = (window as Any).__gsfpvDrones3d;
        const e = k?.extents ? (k.extents() as Any[])[0] : null;
        if (!e) return null;
        return Math.min(e.x0 / e.width, (e.width - e.x1) / e.width, e.y0 / e.height, (e.height - e.y1) / e.height);
    });
}

// ------------------------------------------------------------------ V10: the review's checks (green on SITE, red on PRE_SITE)
/** The luminance spread of a PNG (the flight canvas: a drawn scan has detail, a cleared canvas none). */
async function lumaStd(page: Page, png: Buffer): Promise<number> {
    return page.evaluate(async (b64) => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
        const c = new OffscreenCanvas(bmp.width, bmp.height);
        const g = c.getContext('2d')!;
        g.drawImage(bmp, 0, 0);
        const d = g.getImageData(0, 0, bmp.width, bmp.height).data;
        let s = 0, s2 = 0, n = 0;
        for (let i = 0; i < d.length; i += 8) { const L = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255; s += L; s2 += L * L; n++; }
        const mean = s / n;
        return Math.sqrt(Math.max(0, s2 / n - mean * mean));
    }, png.toString('base64'));
}
const STD_MIN = 0.04;
const squash = (t: string | null): string => (t ?? '').replace(/\s+/g, ' ').trim();
const wrapDiff = (a: number, b: number): number => Math.abs((((b - a + 540) % 360) + 360) % 360 - 180);

/**
 * The checks of the independent review's findings 1, 3, 4, 5, 6 and 7 on one release. Each is a boolean with the numbers beside it.
 * The release of this branch must pass all; the release before the fixes (PRE_SITE) must fail each (the negative control).
 */
async function reviewChecks(ctx: BrowserContext, site: string): Promise<{ checks: Record<string, boolean>; details: Record<string, Any>; pageErrors: string[] }> {
    const page = await ctx.newPage();
    const errs: string[] = [];
    page.on('pageerror', (e) => errs.push(e.message.slice(0, 200)));
    const d: Record<string, Any> = {};
    const STAGE_LINE = '[data-testid="drone-stage"] .d3-side > p.small:not(.muted)';
    const CARD_LINE = '.d3-card-text > p.small:not(.muted)';
    const massAt = (): Promise<number> => page.evaluate(() => (window as Any).__gsfpv.session.params.mass);
    const cardSpec = (spec: string): Promise<string> => page.locator(`.drone-card[data-preset="${CINE}"] [data-spec="${spec}"] .spec-v`).innerText().then((x) => x.trim());
    const settleStage = async (): Promise<void> => { await page.waitForSelector('[data-testid="drone-stage"] canvas', { timeout: 30000 }); await frames(page, 8, 40000); };
    const showDrone = async (id: string): Promise<void> => {
        await page.click(`.drone-card[data-preset="${id}"] [data-action="drone-view3d"]`);
        await page.waitForFunction((want) => (window as Any).__gsfpvDrones3d?.infos()[0]?.drone === want, id, { timeout: 10000 });
        await frames(page, 10);
    };
    const setSetting = async (group: string, id: string, value: string): Promise<void> => {
        await page.keyboard.press('KeyO');
        await page.click(`.set-rail-btn[data-group="${group}"]`);
        // a short enum is a row of radio buttons (their labels are the targets), a long one a select
        const radio = page.locator(`[data-testid="setting-${id}"] input[type="radio"][value="${value}"] + label`);
        if (await radio.count()) await radio.click(); else await page.selectOption(`[data-testid="setting-${id}"] select`, value);
        await page.click('[data-action="settings-close"]');
        await page.waitForSelector('.set-rail-btn', { state: 'detached' });
        await sleep(300);
    };
    try {
        // ---- finding 5: the first view keeps the model off the stage's edge (default load)
        await open(page, site, `drone=${CINE}`);
        await openPicker(page);
        await settleStage();
        const margins: Record<string, number | null> = {};
        const inView: Record<string, boolean> = {};
        for (const id of [CINE, 'nazgulf5v3-6s', 'machr5sport-6s']) {
            await showDrone(id);
            await sleep(1500); // eases to its first view; the idle turn has not started
            margins[id] = await edgeMargin(page);
            inView[id] = await canvasInView(page); // "View in 3D" brings the picture into view (the first cut scrolled its top away under the top bar)
        }
        // control: the measure sees a model that does cross the edge (zoomed right in with the keyboard)
        await page.focus('.d3-canvas');
        for (let i = 0; i < 12; i++) await page.keyboard.press('+');
        await sleep(1200);
        const zoomedMargin = await edgeMargin(page);
        await page.keyboard.press('Home');
        await sleep(1200);
        d.viewInWindow = { canvasInView: inView };
        d.firstView = { edgeMargin: margins, edgeMarginMin: EDGE_MIN, control: { zoomedIn: zoomedMargin, crosses: zoomedMargin !== null && zoomedMargin < 0 } };
        // ---- findings 1 and 7: the stage's own numbers follow the camera load; the GoPro is GoPro's own figure
        await showDrone(CINE);
        const lineKomodo = squash(await page.locator(STAGE_LINE).innerText());
        await page.click('.d3-chip[data-payload="gopro13"]');
        await sleep(500);
        const lineGopro = squash(await page.locator(STAGE_LINE).innerText());
        const hrefs = await page.locator('[data-testid="d3-legend"] a.d3-src').evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''));
        d.gopro = { line: lineGopro, sources: hrefs.filter((h) => /gopro/i.test(h)) };
        await page.click('.d3-chip[data-payload="none"]');
        await sleep(500);
        const lineNone = squash(await page.locator(STAGE_LINE).innerText());
        const cardNone = { weight: await cardSpec('auw_g'), twr: await cardSpec('twr') };
        d.stageLine = { komodo: lineKomodo, none: lineNone, cardNone };
        // ---- finding 6: a camera chip keeps its keyboard focus and the turned view
        await page.focus('.d3-canvas');
        for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
        await sleep(150);
        const v0 = (await hookInfos(page))[0].view;
        await page.evaluate(() => { const b = document.querySelector('.d3-chip[data-payload="bmpcc6kpro"]') as Any; b.__tag = 'same'; b.focus(); });
        await page.keyboard.press('Enter');
        await sleep(700);
        const af = await page.evaluate(() => { const a = document.activeElement as Any; return { tag: a?.__tag ?? null, payload: a?.getAttribute?.('data-payload') ?? null, pressed: a?.getAttribute?.('aria-pressed') ?? null }; });
        const v1 = (await hookInfos(page))[0].view;
        d.chipFocus = { sameElement: af.tag === 'same', focusedPayload: af.payload, pressed: af.pressed, turnedBy: { before: v0, after: v1, yawDeg: +wrapDiff(v0.yaw, v1.yaw).toFixed(2), pitchDeg: +Math.abs(v1.pitch - v0.pitch).toFixed(2) } };
        // ---- finding 4: "Help tune it" applies the chosen load to the flight model
        await page.click('.d3-chip[data-payload="none"]');
        await sleep(300);
        await page.click(`.drone-card[data-preset="${CINE}"] [data-action="drone-tune"]`);
        await sleep(900);
        d.helpTune = { massKg: await massAt() };
        // ---- finding 1 (pause card, settings card): the pilot flies the cinelifter with no camera; the cards say so (the store keeps it)
        await open(page, site, `drone=${CINE}`);
        const flightMass = await massAt();
        await page.keyboard.press('KeyP');
        await page.waitForSelector('[data-testid="your-drone"] canvas', { timeout: 30000 });
        await frames(page, 10, 30000);
        const pc = (await hookInfos(page))[0];
        d.pauseCard = { payload: pc.payload, line: squash(await page.locator(`[data-testid="your-drone"] ${CARD_LINE}`).innerText()), flightMassKg: flightMass };
        await page.keyboard.press('Escape');
        await sleep(900);
        await page.keyboard.press('KeyO');
        await page.click('.set-rail-btn[data-group="drone"]');
        await page.waitForSelector('[data-testid="settings-drone-card"] canvas', { timeout: 30000 });
        await frames(page, 10, 30000);
        const sc = (await hookInfos(page))[0];
        d.settingsCard = { payload: sc.payload, line: squash(await page.locator(`[data-testid="settings-drone-card"] ${CARD_LINE}`).innerText()) };
        await page.click('[data-action="settings-close"]');
        await sleep(900);
        // ---- finding 3: the pilot's Reduced motion setting stops the turntable; off turns it (control)
        const turned = async (waitMs: number): Promise<number> => {
            await openPicker(page);
            await settleStage();
            const y0 = (await hookInfos(page))[0].view.yaw;
            await sleep(waitMs);
            const y1 = (await hookInfos(page))[0].view.yaw;
            await closePicker(page);
            return wrapDiff(y0, y1);
        };
        await setSetting('display', 'display.reducedMotion', 'on');
        const calmDeg = await turned(5500);
        await setSetting('display', 'display.reducedMotion', 'off');
        const liveDeg = await turned(5500);
        await setSetting('display', 'display.reducedMotion', 'system');
        d.reducedMotion = { reducedMotionOnTurnedDeg: +calmDeg.toFixed(2), reducedMotionOffTurnedDeg: +liveDeg.toFixed(2) };
        // ---- put the camera back to the preset's
        await open(page, site, `drone=${CINE}`);
        await openPicker(page);
        await settleStage();
        await page.click('.d3-chip[data-payload="komodo"]');
        await sleep(300);
        await closePicker(page);
        const restored = await massAt();
        d.restored = { massKg: restored };
        const printedKg = (line: string): number => Number((/(\d+) g/.exec(line) ?? [])[1]) / 1000;
        const checks: Record<string, boolean> = {
            viewInWindow: Object.values(inView).every(Boolean),
            firstView: Object.values(margins).every((m) => m !== null && m >= EDGE_MIN) && zoomedMargin !== null && zoomedMargin < 0,
            stageLine: /4872 g/.test(lineKomodo) && /3\.3:1/.test(lineKomodo) && /2872 g/.test(lineNone) && /5\.6:1/.test(lineNone) && cardNone.weight === '2872 g' && cardNone.twr === '5.6:1',
            gopro: /3029 g/.test(lineGopro) && /5\.3:1/.test(lineGopro) && hrefs.some((h) => /^https:\/\/community\.gopro\.com\//.test(h)),
            chipFocus: af.tag === 'same' && af.payload === 'bmpcc6kpro' && af.pressed === 'true' && d.chipFocus.turnedBy.yawDeg < 2 && d.chipFocus.turnedBy.pitchDeg < 2,
            helpTune: Math.abs(d.helpTune.massKg - 2.872) < 1e-9,
            pauseCard: pc.payload === 'none' && /2872 g/.test(d.pauseCard.line) && /5\.6:1/.test(d.pauseCard.line) && Math.abs(printedKg(d.pauseCard.line) - flightMass) < 1e-9,
            settingsCard: sc.payload === 'none' && /2872 g/.test(d.settingsCard.line) && /5\.6:1/.test(d.settingsCard.line),
            reducedMotion: calmDeg < 0.5 && liveDeg > 20,
            restored: Math.abs(restored - 4.872) < 1e-9
        };
        return { checks, details: d, pageErrors: errs };
    } finally {
        await page.close().catch(() => undefined);
    }
}

// ------------------------------------------------------------------ V9: the same surfaces with the scan drawn
async function scanDrawn(ctx: BrowserContext): Promise<Record<string, Any>> {
    const page = await ctx.newPage();
    const errs: string[] = [];
    page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`.slice(0, 200)));
    page.on('console', (m) => { if (m.type() === 'error') errs.push(`console: ${m.text()}`.slice(0, 200)); });
    await page.addInitScript(() => {
        (window as Any).__long = [];
        try { new PerformanceObserver((l) => { for (const e of l.getEntries()) (window as Any).__long.push({ start: e.startTime, dur: e.duration }); }).observe({ type: 'longtask', buffered: true }); } catch { /* no long-task support */ }
    });
    try {
        await open(page, SITE, `drone=${CINE}`, 'en', true);
        await sleep(6000); // the scan streams in and settles
        // the flight's engine frames over a window, and the splats the scan had drawn in its last frame (lod().drawn: the scan really is on screen)
        const hz = (ms: number): Promise<{ frames: number; hz: number; drawn: number }> => page.evaluate(async (ms) => {
            const w = window as Any;
            const s = w.__gsfpv.session;
            const f0 = s.frames, t0 = performance.now();
            await new Promise((r) => setTimeout(r, ms));
            const n = s.frames - f0;
            return { frames: n, hz: n / ((performance.now() - t0) / 1000), drawn: Number(w.__gsfpv.lod?.()?.drawn ?? 0) };
        }, ms);
        const now = (): Promise<number> => page.evaluate(() => performance.now());
        const longSince = (t: number): Promise<number> => page.evaluate((t) => ((window as Any).__long as Any[]).filter((e) => e.start >= t).reduce((m, e) => Math.max(m, e.dur), 0), t);
        const flightStd = async (): Promise<number> => lumaStd(page, await page.locator('#view').screenshot());
        const head = await page.evaluate(() => { const w = window as Any; const s = w.__gsfpv.session; const dev = s.renderer.app.graphicsDevice; w.__flightLost = null; const l = dev.wgpu?.lost; if (l) l.then((i: Any) => { w.__flightLost = i?.reason ?? 'lost'; }); return { render: w.__gsfpv.info?.render ?? 'on', currentRenderer: w.__gsfpv.info?.currentRenderer, webgpu: !!dev.isWebGPU, drawn: Number(w.__gsfpv.lod?.()?.drawn ?? 0) }; });
        const stdBefore = await flightStd();
        const base = [await hz(2000), await hz(2000), await hz(2000)];
        const tb = await now();
        await sleep(3000);
        const baseLong = Math.round(await longSince(tb));
        const baseMin = Math.min(...base.map((b) => b.hz));
        const surfaces: Record<string, { open: () => Promise<void>; sel: string; close: () => Promise<void> }> = {
            pause: { open: () => page.keyboard.press('KeyP'), sel: '[data-testid="your-drone"] canvas', close: async () => { await page.keyboard.press('Escape'); await page.waitForSelector('[data-testid="your-drone"]', { state: 'detached' }); } },
            picker: { open: async () => { await page.keyboard.press('KeyP'); await page.waitForSelector('[data-action="pause.drone"]'); await page.click('[data-action="pause.drone"]'); }, sel: '[data-testid="drone-stage"] canvas', close: () => closePicker(page) },
            settings: { open: async () => { await page.keyboard.press('KeyO'); await page.click('.set-rail-btn[data-group="drone"]'); }, sel: '[data-testid="settings-drone-card"] canvas', close: async () => { await page.click('[data-action="settings-close"]'); await page.waitForSelector('[data-testid="settings-drone-card"]', { state: 'detached' }); } }
        };
        const per: Record<string, Any[]> = {};
        for (const [name, sf] of Object.entries(surfaces)) {
            const rounds: Any[] = [];
            for (let i = 0; i < 5; i++) {
                trace('V9', name, i + 1);
                const tOpen = await now();
                const w0 = Date.now();
                await sf.open();
                await page.waitForSelector(sf.sel, { timeout: 30000 });
                await page.waitForFunction(() => { const k = (window as Any).__gsfpvDrones3d; return !!k && k.live >= 1 && (k.infos()[0]?.frames ?? 0) > 0; }, null, { polling: 'raf', timeout: 30000 });
                const firstFrameMs = Date.now() - w0;
                const f = await hz(1500);
                const longest = Math.round(await longSince(tOpen));
                await sf.close();
                await sleep(700);
                const c = await hookCounts(page);
                rounds.push({ round: i + 1, firstFrameMs, flightHz: +f.hz.toFixed(1), flightFrames: f.frames, splatsDrawn: f.drawn, longestTaskMs: longest, liveAfterClose: c?.live, created: c?.created, disposed: c?.disposed });
            }
            per[name] = rounds;
        }
        const all = Object.values(per).flat();
        const stdAfter = await flightStd();
        const end = await page.evaluate(() => { const w = window as Any; const dev = w.__gsfpv.session.renderer.app.graphicsDevice; return { lostReason: w.__flightLost ?? null, contextLost: !!dev.contextLost, renderer: w.__gsfpv.info?.currentRenderer }; });
        const counts = await hookCounts(page);
        // control 1: a stall in the page shows as a long task and a dip of the flight's frame rate (the measures can see one)
        const tStall = await now();
        const stalled = await page.evaluate(async () => {
            const s = (window as Any).__gsfpv.session;
            const f0 = s.frames, t0 = performance.now();
            await new Promise((r) => setTimeout(r, 200));
            const t = performance.now();
            while (performance.now() - t < 1000) { /* hold the main thread */ }
            await new Promise((r) => setTimeout(r, 300));
            const n = s.frames - f0;
            return { frames: n, hz: n / ((performance.now() - t0) / 1000) };
        });
        await sleep(300);
        const stallLong = Math.round(await longSince(tStall));
        // control 2: the logic-only page draws no scan: the flight canvas is blank, the "scan drawn" predicate fails on it
        const off = await ctx.newPage();
        await open(off, SITE, `drone=${CINE}`);
        await sleep(2500);
        const stdOff = await lumaStd(off, await off.locator('#view').screenshot());
        const drawnOff = Number(await off.evaluate(() => (window as Any).__gsfpv.lod?.()?.drawn ?? 0));
        await off.close();
        const worst = (k: string): number => Math.max(...all.map((r) => r[k] as number));
        const control = { stallInjectedMs: 1000, stallLongTaskMs: stallLong, stallHz: +stalled.hz.toFixed(1), stallSeen: stallLong >= 900 && stalled.hz < 0.5 * baseMin, renderOffSplatsDrawn: drawnOff, renderOffDrawsNoScan: drawnOff === 0, renderOffFlightCanvasStd: +stdOff.toFixed(4) };
        // The first stage a page makes pays for the second graphics device (adapter, shaders, the environment atlas): the scan behind a
        // paused menu then stutters for about a second (recorded as firstOpenStall). Every later open must leave the flight at half its
        // baseline rate or better; the first only has to leave it drawing (frames advance) and recover by the next round.
        const warm = per.pause[0];
        const rest = all.filter((r) => r !== warm);
        const firstOpenStall = { flightHz: warm.flightHz, flightFrames: warm.flightFrames, baselineHz: +baseMin.toFixed(1), recoveredNextRound: per.pause[1].flightHz >= 0.5 * baseMin };
        const pass = head.render !== 'off' && head.drawn > 0 && stdBefore > STD_MIN && stdAfter > STD_MIN && baseMin > 5
            && all.every((r) => r.firstFrameMs < 5000 && r.flightFrames > 0 && r.splatsDrawn > 0 && r.liveAfterClose === 0)
            && rest.every((r) => r.flightHz >= 0.5 * baseMin) && firstOpenStall.recoveredNextRound
            && end.lostReason === null && !end.contextLost && end.renderer === head.currentRenderer
            && counts?.live === 0 && counts.created === counts.disposed
            && errs.filter((e) => /pageerror/.test(e)).length === 0
            && control.stallSeen && control.renderOffDrawsNoScan;
        return {
            pass, scanDrawn: { render: head.render, splatsDrawn: head.drawn, flightBackend: head.webgpu ? 'webgpu' : 'webgl2', canvasStdBefore: +stdBefore.toFixed(4), canvasStdAfter: +stdAfter.toFixed(4), stdMin: STD_MIN },
            baseline: { flightHz: base.map((b) => +b.hz.toFixed(1)), longestTaskMsWithNoStage: baseLong },
            firstOpenStall, summary: { rounds: all.length, worstFirstFrameMs: worst('firstFrameMs'), lowestFlightHzAfterTheFirstOpen: Math.min(...rest.map((r) => r.flightHz as number)), longestTaskMs: worst('longestTaskMs'), flightHzFloor: +(0.5 * baseMin).toFixed(1) },
            perSurface: per, flightDevice: end, stageCounts: { created: counts?.created, disposed: counts?.disposed, live: counts?.live }, control, pageErrors: errs.slice(0, 8)
        };
    } finally {
        await page.close().catch(() => undefined);
    }
}

async function main(): Promise<void> {
    await lock();
    const { browser } = await launchChrome({ headless: false, args: ['--window-position=40,40', '--window-size=1300,1000'] });
    try {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 880 }, deviceScaleFactor: 1.5 });
        theCtx = ctx;
        // tsx keeps function names with __name(); functions sent to page.evaluate need it in the page
        await ctx.addInitScript('window.__name = window.__name || ((f) => f);');
        const page = await ctx.newPage();
        const errors: string[] = [];
        page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`.slice(0, 300)));
        page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`.slice(0, 300)); });
        const requested: string[] = [];
        page.on('request', (r) => requested.push(r.url()));

        // ---------------------------------------------------------------- V7 first: nothing of the 3D chunk before a picker opens
        if (want('V7')) {
            requested.length = 0;
            await open(page, SITE, `drone=${CINE}`);
            const before = requested.filter((u) => /drones3d-[\w-]+\.(js|css)/.test(u)).length;
            await openPicker(page);
            await page.waitForSelector('[data-testid="drone-stage"] canvas', { timeout: 30000 });
            const after = requested.filter((u) => /drones3d-[\w-]+\.(js|css)/.test(u));
            const sizes = await page.evaluate(async (urls) => Promise.all(urls.map(async (u) => { const r = await fetch(u); const b = await r.arrayBuffer(); return { u: u.split('/').pop(), bytes: b.byteLength, gz: r.headers.get('content-length') }; })), after);
            results.V7 = { pass: before === 0 && after.length >= 1, requestedAtLoad: before, requestedAtOpen: after.length, chunk: sizes };
            console.log('V7', results.V7.pass, JSON.stringify(results.V7));
            await closePicker(page);
        }

        // ---------------------------------------------------------------- V1 every preset on the stage
        if (want('V1')) {
            await open(page, SITE, 'drone=pavo20pro-3s');
            await openPicker(page);
            await page.waitForSelector('[data-testid="drone-stage"] canvas', { timeout: 30000 });
            const ready = await frames(page, 25, 40000);
            const per: Record<string, Any> = {};
            const sigs: Record<string, number[]> = {};
            for (const id of IDS) {
                await page.click(`.drone-card[data-preset="${id}"] [data-action="drone-view3d"]`);
                await page.waitForFunction((want) => (window as Any).__gsfpvDrones3d?.infos()[0]?.drone === want, id, { timeout: 10000 });
                trace('V1', id, 'shown');
                await frames(page, 12);
                await sleep(1300); // the turntable eases to its first view
                trace('V1', id, 'settled');
                const shot = await canvasShot(page);
                trace('V1', id, 'canvas shot');
                const m = await measure(page, shot);
                trace('V1', id, 'measured');
                const info = (await hookInfos(page))[0];
                const rowsN = await page.locator('[data-testid="d3-legend"] li').count();
                const pinsVisible = info.pins.filter((p: Any) => p.visible && !p.back).length;
                const legendTitles = await page.locator('[data-testid="d3-legend"] .d3-title').allTextContents();
                // the evidence picture: the whole stage with its pins and legend
                await stagePicture(page, join(OUT, `${id}.png`));
                trace('V1', id, 'picture');
                const margin = await edgeMargin(page);
                const inView = await canvasInView(page);
                per[id] = { canvasInView: inView, lit: +m.lit.toFixed(4), edgeMargin: margin === null ? null : +margin.toFixed(4), insideStage: margin !== null && margin >= EDGE_MIN, nonEmpty: m.lit > NONEMPTY, legendRows: rowsN, pinsVisible, backend: info.tally?.backend, titles: legendTitles, size: `${m.w}x${m.h}` };
                sigs[id] = m.sig;
            }
            // distinct pictures
            const pairs: { a: string; b: string; d: number }[] = [];
            for (let i = 0; i < IDS.length; i++) for (let j = i + 1; j < IDS.length; j++) pairs.push({ a: IDS[i], b: IDS[j], d: +sigDiff(sigs[IDS[i]], sigs[IDS[j]]).toFixed(4) });
            // The four families of the design note (docs/wip/v09-d.md section 1): ducted 2" HD cinewhoops, tiny 65 mm whoops,
            // open-prop X quads, the coaxial X8. A family is one parametric build, sized from each preset, so its members look alike
            // by design (the Pavo20 Pro and its Pro II are the same frame: 93.7 and 93.9 mm). Across families the pictures must
            // differ a lot; within one they must still differ (a model stuck on one preset gives exactly 0, as does the
            // same-preset control below), by a smaller margin.
            const group = (id: string): string => (/^pavo/.test(id) ? 'ducted-hd' : /^(meteor65|air65)/.test(id) ? 'tiny-whoop' : /^taurus/.test(id) ? 'cinelifter' : 'open-x');
            const across = pairs.filter((p) => group(p.a) !== group(p.b));
            const within = pairs.filter((p) => group(p.a) === group(p.b));
            const minPair = across.reduce((m, p) => (p.d < m.d ? p : m), across[0]);
            const minWithin = within.reduce((m, p) => (p.d < m.d ? p : m), within[0]);
            // control for "different": the same preset shot twice (no motion in between)
            await page.click(`.drone-card[data-preset="${CINE}"] [data-action="drone-view3d"]`);
            await frames(page, 12);
            await sleep(1400);
            const s1 = await measure(page, await canvasShot(page));
            await sleep(500);
            const s2 = await measure(page, await canvasShot(page));
            const same = sigDiff(s1.sig, s2.sig);
            // the drag: pointer down on the canvas, move, up -> the picture changes; control: no drag, no change
            const box = (await page.locator('.d3-canvas').boundingBox())!;
            await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
            await page.mouse.down();
            for (let i = 1; i <= 12; i++) { await page.mouse.move(box.x + box.width * (0.5 + i * 0.02), box.y + box.height * 0.5); await sleep(16); }
            await page.mouse.up();
            await frames(page, 10);
            const afterDrag = await measure(page, await canvasShot(page));
            const dragChange = sigDiff(s2.sig, afterDrag.sig);
            const legendOk = IDS.every((id) => per[id].legendRows >= 6 && per[id].pinsVisible >= 4);
            const allNonEmpty = IDS.every((id) => per[id].nonEmpty);
            const allInside = IDS.every((id) => per[id].insideStage);
            const allInView = IDS.every((id) => per[id].canvasInView);
            const distinct = minPair.d > 0.012 && minWithin.d > 0.0004;
            const pass = ready && allNonEmpty && allInside && allInView && distinct && legendOk && dragChange > 0.012 && same < 0.004;
            results.V1 = { pass, ready, allCanvasInView: allInView, allInsideStage: allInside, edgeMarginMin: EDGE_MIN, perDrone: per, distinct: { minAcrossFamilies: minPair, threshold: 0.012, minWithinFamily: minWithin, withinThreshold: 0.0004, pairs }, control: { samePresetTwice: +same.toFixed(5), dragChange: +dragChange.toFixed(4), identicalBelow: same < 0.004, dragAbove: dragChange > 0.012 } };
            console.log('V1', pass, JSON.stringify({ ready, allNonEmpty, allInside, allInView, edgeMarginByDrone: Object.fromEntries(IDS.map((id) => [id, per[id].edgeMargin])), distinct, minPair, minWithin, legendOk, same, dragChange }));
            await closePicker(page);
        }

        // V1 control: the base release has no stage
        if (want('V1')) {
            const base = await ctx.newPage();
            await open(base, BASE_SITE, 'drone=pavo20pro-3s');
            await openPicker(base);
            await sleep(2500);
            const stage = await base.locator('[data-testid="drone-stage"]').count();
            const canvases = await base.locator('.screen.drones canvas.d3-canvas').count();
            const hook = await base.evaluate(() => typeof (window as Any).__gsfpvDrones3d);
            results.V1.baseRelease = { stage, canvases, hook, noModel: stage === 0 && canvases === 0 && hook === 'undefined' };
            console.log('V1 base release has no model:', results.V1.baseRelease.noModel);
            results.V1.pass = results.V1.pass && results.V1.baseRelease.noModel;
            await base.close();
        }

        // ---------------------------------------------------------------- V2 GPU memory freed on close
        if (want('V2')) {
            await open(page, SITE, 'drone=nazgulf5v3-6s');
            const rounds: Any[] = [];
            let alive = true;
            for (let i = 0; i < 5; i++) {
                await openPicker(page);
                await page.waitForSelector('[data-testid="drone-stage"] canvas', { timeout: 30000 });
                await frames(page, 15, 30000);
                const open1 = (await hookInfos(page))[0];
                const liveOpen = (await hookCounts(page))?.live;
                const canvasesOpen = await page.locator('.d3-canvas').count();
                await closePicker(page);
                await sleep(1200);
                const counts = await hookCounts(page);
                const canvasesClosed = await page.locator('.d3-canvas').count();
                rounds.push({ round: i + 1, whileOpen: open1?.tally, liveOpen, canvasesOpen, canvasesClosed, counts: { created: counts?.created, disposed: counts?.disposed, live: counts?.live }, closedDrone: counts?.lastClosed?.drone, closedTally: counts?.lastClosed?.tally, gpuReleased: counts?.lastClosed?.gpuReleased });
            }
            // the flight app is alive: the page still steps its physics
            const t0 = await page.evaluate(() => (window as Any).__gsfpv.session.sim.tick as number);
            await sleep(700);
            const t1 = await page.evaluate(() => (window as Any).__gsfpv.session.sim.tick as number);
            alive = t1 > t0 && errors.filter((e) => /pageerror/.test(e)).length === 0;
            const last = rounds[rounds.length - 1];
            // each round makes two stages: the pause menu's "Your drone" card (gone as the picker takes over) and the picker's own;
            // only the picker's is alive while it is open, and every one made is disposed (no device is left behind)
            const freed = rounds.every((r) => r.counts.live === 0 && r.liveOpen === 1 && r.counts.created === 2 * r.round && r.counts.disposed === 2 * r.round && r.canvasesOpen === 1 && r.canvasesClosed === 0 && r.gpuReleased === true && r.closedTally?.destroyed === true);
            const heldWhileOpen = rounds.every((r) => (r.whileOpen?.textures ?? 0) > 3 && (r.whileOpen?.buffers ?? 0) > 3 && (r.whileOpen?.shaders ?? 0) > 3);
            results.V2 = { pass: freed && heldWhileOpen && alive, rounds, simClock: { t0, t1 }, pageErrors: errors.slice(0, 5), control: { openCountersNonZero: heldWhileOpen, base: 'the base release creates no stage (V1 baseRelease)' } };
            console.log('V2', results.V2.pass, JSON.stringify({ freed, heldWhileOpen, alive, last: { whileOpen: last.whileOpen, closed: last.closedTally, gpuReleased: last.gpuReleased } }));
        }

        // ---------------------------------------------------------------- V3 the cinelifter and its camera
        if (want('V3')) {
            await open(page, SITE, `drone=${CINE}`);
            const massAt = (): Promise<number> => page.evaluate(() => (window as Any).__gsfpv.session.params.mass);
            const mass0 = await massAt();
            await openPicker(page);
            await page.waitForSelector('[data-testid="drone-stage"] canvas', { timeout: 30000 });
            await frames(page, 12, 30000);
            const legend0 = (await page.locator('[data-testid="d3-legend"]').textContent()) ?? '';
            const note0 = (await page.locator('[data-testid="d3-note"]').innerText()).trim();
            const twr0 = (await page.locator(`.drone-card[data-preset="${CINE}"] [data-spec="twr"] .spec-v`).innerText()).trim();
            const w0 = (await page.locator(`.drone-card[data-preset="${CINE}"] [data-spec="auw_g"] .spec-v`).innerText()).trim();
            const lineKomodo = ((await page.locator('[data-testid="drone-stage"] .d3-side > p.small:not(.muted)').innerText()) ?? '').replace(/\s+/g, ' ').trim();
            const shotKomodo = await measure(page, await canvasShot(page));
            // another camera: the stage, the card and (at the picker's close) the flight model follow
            await page.click('.d3-chip[data-payload="none"]');
            await frames(page, 12);
            await sleep(900);
            const info1 = (await hookInfos(page))[0];
            const twr1 = (await page.locator(`.drone-card[data-preset="${CINE}"] [data-spec="twr"] .spec-v`).innerText()).trim();
            const w1 = (await page.locator(`.drone-card[data-preset="${CINE}"] [data-spec="auw_g"] .spec-v`).innerText()).trim();
            const legend1 = (await page.locator('[data-testid="d3-legend"]').textContent()) ?? '';
            const lineNone = ((await page.locator('[data-testid="drone-stage"] .d3-side > p.small:not(.muted)').innerText()) ?? '').replace(/\s+/g, ' ').trim();
            const shotNone = await measure(page, await canvasShot(page));
            await closePicker(page);
            const mass1 = await massAt();
            // after a reload the choice holds
            await open(page, SITE, `drone=${CINE}`);
            const mass2 = await massAt();
            await openPicker(page);
            await page.waitForSelector('[data-testid="drone-stage"] canvas', { timeout: 30000 });
            const pressed = await page.locator('.d3-chip[aria-pressed="true"]').getAttribute('data-payload');
            // back to the preset's camera
            await page.click('.d3-chip[data-payload="komodo"]');
            await sleep(400);
            await closePicker(page);
            const mass3 = await massAt();
            const pass = /RED KOMODO 6K/.test(legend0) && /Sold without a camera/.test(note0) && /Blackmagic BMPCC/.test(note0) && twr0 === '3.3:1' && w0 === '4872 g'
                && /4872 g/.test(lineKomodo) && /3\.3:1/.test(lineKomodo) && /2872 g/.test(lineNone) && /5\.6:1/.test(lineNone)
                && info1.payload === 'none' && /None/.test(legend1) && !/RED KOMODO 6K/.test(legend1.split('Cinema camera')[1] ?? 'x') && twr1 === '5.6:1' && w1 === '2872 g'
                && Math.abs(mass0 - 4.872) < 1e-9 && Math.abs(mass1 - 2.872) < 1e-9 && Math.abs(mass2 - 2.872) < 1e-9 && pressed === 'none' && Math.abs(mass3 - 4.872) < 1e-9
                && sigDiff(shotKomodo.sig, shotNone.sig) > 0.004;
            results.V3 = { pass, legendBefore: legend0.split('\n').slice(0, 40).join(' | '), note: note0, card: { before: { twr: twr0, weight: w0 }, afterNone: { twr: twr1, weight: w1 } }, stageLine: { komodo: lineKomodo, none: lineNone }, flightMassKg: { start: mass0, afterNone: mass1, afterReload: mass2, backToKomodo: mass3 }, stageChanged: +sigDiff(shotKomodo.sig, shotNone.sig).toFixed(4), pressedAfterReload: pressed, control: { massBeforeChoice: mass0, note: 'the mass at the start is the preset\'s 4.872 kg: the choice, not the picker, moved it' } };
            console.log('V3', pass, JSON.stringify({ twr0, twr1, w0, w1, mass0, mass1, mass2, mass3, pressed }));
        }

        // ---------------------------------------------------------------- V4 the pause menu's card
        if (want('V4')) {
            await open(page, SITE, 'drone=machr5sport-6s');
            await page.keyboard.press('KeyP');
            await page.waitForSelector('[data-testid="your-drone"] canvas', { timeout: 30000 });
            await frames(page, 15, 30000);
            const card = await page.locator('[data-testid="d3-card"]').innerText();
            const m = await measure(page, await page.locator('[data-testid="your-drone"] .d3-canvas').screenshot());
            const info = (await hookInfos(page))[0];
            const liveWhileOpen = (await hookCounts(page))?.live;
            await page.locator('[data-testid="your-drone"]').screenshot({ path: join(OUT, 'pause-card-machr5sport-6s.png') });
            // closing the menu frees it
            await page.keyboard.press('Escape');
            await sleep(1200);
            const after = await hookCounts(page);
            // "Change drone" opens the picker with its own stage
            await page.keyboard.press('KeyP');
            await page.waitForSelector('[data-testid="your-drone"] canvas', { timeout: 30000 });
            await page.click('[data-action="d3-change"]');
            await page.waitForSelector('.screen.drones');
            await page.waitForSelector('[data-testid="drone-stage"] canvas', { timeout: 30000 });
            await sleep(800);
            const cardsLeft = await page.locator('[data-testid="your-drone"]').count();
            const infos = await hookInfos(page);
            const pass = /Mach R5 Sport/.test(card) && /Your drone/.test(card) && m.lit > NONEMPTY && info.drone === 'machr5sport-6s' && liveWhileOpen === 1 && after?.live === 0 && after.created === after.disposed && cardsLeft === 0 && infos.length === 1;
            results.V4 = { pass, card: card.replace(/\n+/g, ' | '), lit: +m.lit.toFixed(4), liveAfterClose: after?.live, pickerStages: infos.length, cardsLeft, control: { liveWhileOpen, note: 'measured while the card is open: one stage alive; after the menu closes none' } };
            console.log('V4', pass, JSON.stringify(results.V4));
            await closePicker(page);
        }

        // ---------------------------------------------------------------- V8 the settings screen's picture of the drone
        if (want('V8')) {
            await open(page, SITE, 'drone=pavo20pro-3s');
            await page.keyboard.press('KeyO');
            await page.click('.set-rail-btn[data-group="drone"]');
            await page.waitForSelector('[data-testid="settings-drone-card"] canvas', { timeout: 30000 });
            await frames(page, 15, 30000);
            const name0 = ((await page.locator('[data-testid="settings-drone-card"] h3').textContent()) ?? '').trim();
            const m = await measure(page, await page.locator('[data-testid="settings-drone-card"] .d3-canvas').screenshot());
            await page.locator('[data-testid="settings-drone-card"]').screenshot({ path: join(OUT, 'settings-card-pavo20pro-3s.png') });
            await page.selectOption('[data-testid="setting-drone.current"] select', 'nazgulf5v3-6s');
            await sleep(900);
            const name1 = ((await page.locator('[data-testid="settings-drone-card"] h3').textContent()) ?? '').trim();
            const info = (await hookInfos(page))[0];
            await page.click('[data-action="settings-close"]');
            await sleep(1200);
            const after = await hookCounts(page);
            const base = await ctx.newPage();
            await open(base, BASE_SITE, 'drone=pavo20pro-3s');
            await base.keyboard.press('KeyO');
            await base.click('.set-rail-btn[data-group="drone"]');
            await sleep(1500);
            const baseCards = await base.locator('[data-testid="settings-drone-card"]').count();
            await base.close();
            const pass = /Pavo20 Pro/.test(name0) && /Nazgul Evoque/.test(name1) && info?.drone === 'nazgulf5v3-6s' && m.lit > NONEMPTY && after?.live === 0 && after.created === after.disposed && baseCards === 0;
            results.V8 = { pass, name0, name1, lit: +m.lit.toFixed(4), liveAfterClose: after?.live, control: { baseReleaseCards: baseCards } };
            console.log('V8', pass, JSON.stringify(results.V8));
        }

        // ---------------------------------------------------------------- V5 Polish and Russian
        if (want('V5')) {
            const out: Record<string, Any> = {};
            for (const [lang, want] of [['pl', { motors: 'Silniki', none: 'Brak', note: 'Sprzedawany bez kamery' }], ['ru', { motors: '\u041c\u043e\u0442\u043e\u0440\u044b', none: '\u041d\u0435\u0442', note: '\u041f\u0440\u043e\u0434\u0430\u0451\u0442\u0441\u044f \u0431\u0435\u0437 \u043a\u0430\u043c\u0435\u0440\u044b' }]] as const) {
                await open(page, SITE, `drone=${CINE}`, lang);
                await openPicker(page);
                await page.waitForSelector('[data-testid="drone-stage"] canvas', { timeout: 30000 });
                await frames(page, 8, 30000);
                const legend = (await page.locator('[data-testid="d3-legend"]').textContent()) ?? '';
                const note = (await page.locator('[data-testid="d3-note"]').textContent()) ?? '';
                out[lang] = { hasMotorsWord: legend.includes(want.motors), hasNone: legend.includes(want.none), note: note.includes(want.note), makerName: legend.includes('XING2 3110 1250 KV') && legend.includes('RED KOMODO 6K') };
                await closePicker(page);
            }
            // control: the English legend has none of those words
            await open(page, SITE, `drone=${CINE}`, 'en');
            await openPicker(page);
            await page.waitForSelector('[data-testid="drone-stage"] canvas', { timeout: 30000 });
            const en = (await page.locator('[data-testid="d3-legend"]').textContent()) ?? '';
            await closePicker(page);
            const pass = Object.values(out).every((o) => Object.values(o).every(Boolean)) && !en.includes('Silniki') && en.includes('Motors');
            results.V5 = { pass, ...out, control: { englishHasPolishWord: en.includes('Silniki') } };
            console.log('V5', pass, JSON.stringify(out));
        }

        // ---------------------------------------------------------------- V6 the WebGL2 fallback
        if (want('V6')) {
            const p2 = await ctx.newPage();
            await p2.addInitScript(() => { try { Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true }); } catch { /* */ } });
            const errs: string[] = [];
            p2.on('pageerror', (e) => errs.push(e.message.slice(0, 200)));
            await open(p2, SITE, 'drone=air65-1s');
            await openPicker(p2);
            await p2.waitForSelector('[data-testid="drone-stage"] canvas', { timeout: 30000 });
            const ok = await frames(p2, 15, 40000);
            const info = (await hookInfos(p2))[0];
            const m = await measure(p2, await canvasShot(p2));
            await closePicker(p2);
            await sleep(800);
            const counts = await hookCounts(p2);
            const pass = ok && info?.tally?.backend === 'webgl2' && m.lit > NONEMPTY && counts?.live === 0 && counts.disposed === 2 && errs.length === 0;
            results.V6 = { pass, backend: info?.tally?.backend, lit: +m.lit.toFixed(4), tallyOpen: info?.tally, counts: { live: counts?.live, disposed: counts?.disposed }, pageErrors: errs };
            console.log('V6', pass, JSON.stringify(results.V6));
            await p2.close();
        }

        // ---------------------------------------------------------------- V10 the review's checks: green here, red before the fixes
        if (want('V10')) {
            const green = await reviewChecks(ctx, SITE);
            const red = await reviewChecks(ctx, PRE_SITE);
            const names = Object.keys(green.checks);
            const allGreen = names.every((n) => green.checks[n]);
            // each finding's check fails on the release built from 06bef1f (restored is the harness's own, not a finding)
            // (firstView is not asked to fail there: that build has no extent hook to measure with; its control is the unit test's old fixed distance and the picture)
            const mustBeRed = names.filter((n) => n !== 'restored' && n !== 'firstView');
            const redOk = mustBeRed.every((n) => red.checks[n] === false);
            results.V10 = { pass: allGreen && redOk && green.pageErrors.length === 0, checks: green.checks, details: green.details, control: { release: 'built from 06bef1f, before the review fixes', checks: red.checks, details: red.details, everyCheckFailsBefore: redOk }, pageErrors: green.pageErrors };
            console.log('V10', results.V10.pass, JSON.stringify({ green: green.checks, red: red.checks }));
        }

        // ---------------------------------------------------------------- V9 the surfaces with the scan drawn
        if (want('V9')) {
            results.V9 = await scanDrawn(ctx);
            console.log('V9', results.V9.pass, JSON.stringify({ scanDrawn: results.V9.scanDrawn, baseline: results.V9.baseline, firstOpenStall: results.V9.firstOpenStall, summary: results.V9.summary, control: results.V9.control }));
        }

        results.pageErrors = errors.slice(0, 10);
    } finally {
        await browser.close().catch(() => undefined);
        unlock();
    }
}

try {
    await main();
} catch (e) {
    results.error = String((e as Error).stack ?? e);
    console.error(e);
    unlock();
}
const keys = ['V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7', 'V8', 'V9', 'V10'].filter(want);
const pass = keys.every((k) => results[k]?.pass === true) && !results.error;
const file = writeEvidence(ONLY.length ? `v09-drones3d-partial-${ONLY.join('-').toLowerCase()}` : 'v09-drones3d', { pass, site: SITE, baseSite: BASE_SITE, preFixSite: PRE_SITE, scene: SCENE, ...results });
writeFileSync(join(OUT, 'README.md'), '# 3D models of the drones, v0.9 lane D\n\nOne picture per drone, taken from the real drone picker of a local release by `tools/bench/src/accept-v09-drones3d.ts` (evidence `../v09-drones3d.json`). The picture is the picker as the pilot sees it in a 1280 x 880 window (device scale 1.5): the turntable at its first view with its numbered pins, and the legend beside it. Colours, finishes and the layout of wires and screws are stylised; sizes follow the published dimensions (docs/research/drone-models.md).\n');
console.log(`accept-v09-drones3d: ${pass ? 'PASS' : 'FAIL'} -> ${file}`);
process.exit(pass ? 0 : 1);
