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
// The scan is not loaded (?render=off: logic-only page), so the only drawing is the stage's own; it holds the GPU lock.
//   node scripts/build-release.mjs && node tools/bench/scripts/serve-csp.mjs dist <port>     (another shell)
//   cd tools/bench && SITE=http://localhost:<port> BASE_SITE=http://localhost:<port2> npx tsx src/accept-v09-drones3d.ts
// Evidence: evidence/<date>/v09-drones3d.json and evidence/<date>/drones/<preset>.png (the stage of each drone).
import { mkdirSync, rmdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { launchChrome } from './browser';
import { REPO, today, writeEvidence } from './evidence';

if (!process.env.SITE) throw new Error('accept-v09-drones3d needs SITE=http://localhost:<port> (a local release; never the live site)');
const SITE = process.env.SITE.replace(/\/$/, '');
const BASE_SITE = (process.env.BASE_SITE ?? '').replace(/\/$/, '');
for (const s of [SITE, BASE_SITE]) if (s && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(s)) throw new Error(`SITE and BASE_SITE must be local releases, got ${s}`);
console.log(`accept-v09-drones3d target: ${SITE}  base (control): ${BASE_SITE || '(none)'}`);
if (!BASE_SITE) throw new Error('BASE_SITE is needed: the negative control is the release built from the base commit 631fd5f');

const IDS = ['pavo20pro-3s', 'pavo20pro2-3s', 'pavo20pro2-4s', 'pavopico-2s', 'meteor65pro-1s', 'air65-1s', 'nazgulf5v3-6s', 'machr5sport-6s', 'taurusx8-komodo-6s'];
const CINE = 'taurusx8-komodo-6s';
const SCENE = '39e63ce9';
const OUT = join(REPO, 'evidence', today(), 'drones');
mkdirSync(OUT, { recursive: true });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const results: Record<string, Any> = {};
const cb = (): string => `cb=${Math.random().toString(36).slice(2)}`;
const url = (site: string, qs: string, lang = 'en'): string => `${site}/${lang}/fly/?scene=${SCENE}&nowarn=1&input=touch&render=off&${qs}&${cb()}`;

// ------------------------------------------------------------------ the GPU lock
const LOCK = 'C:/dev/.gpu-lock';
let haveLock = false;
let waited = 0;
async function lock(): Promise<void> {
    for (;;) {
        try { mkdirSync(LOCK); haveLock = true; return; } catch {
            try { if (Date.now() - statSync(LOCK).mtimeMs > 20 * 60 * 1000) { rmdirSync(LOCK); continue; } } catch { /* gone meanwhile */ }
            if (!waited++ || waited % 600 === 0) console.log('waiting for the GPU lock');
            await sleep(100);
        }
    }
}
const unlock = (): void => { if (haveLock) { try { rmdirSync(LOCK); } catch { /* */ } haveLock = false; } };
process.on('SIGINT', () => { unlock(); process.exit(130); });

// ------------------------------------------------------------------ page helpers
async function open(page: Page, site: string, qs: string, lang = 'en'): Promise<void> {
    await page.goto(url(site, qs, lang));
    const t0 = Date.now();
    for (;;) {
        const h = await page.evaluate(() => { const w = window as Any; return w.__gsfpv ? { status: w.__gsfpv.status, error: w.__gsfpv.error } : null; });
        if (h && h.status !== 'loading') { if (h.status !== 'ready') throw new Error(`page not ready: ${JSON.stringify(h)}`); return; }
        if (Date.now() - t0 > 120000) throw new Error('page did not become ready');
        await sleep(250);
    }
}

async function openPicker(page: Page): Promise<void> {
    await page.keyboard.press('KeyP');
    await page.click('[data-action="pause.drone"]');
    await page.waitForSelector('.screen.drones');
}

async function closePicker(page: Page): Promise<void> {
    await page.click('[data-action="drone-close"]');
    await page.waitForSelector('.screen.drones', { state: 'detached' });
}

const hookInfos = (page: Page): Promise<Any[]> => page.evaluate(() => ((window as Any).__gsfpvDrones3d?.infos() ?? []) as Any[]);
const hookCounts = (page: Page): Promise<Any> => page.evaluate(() => { const k = (window as Any).__gsfpvDrones3d; return k ? { created: k.created, disposed: k.disposed, live: k.live, lastClosed: k.lastClosed } : null; });

/** The stage has drawn `n` more frames than when this was called. */
async function frames(page: Page, n: number, timeoutMs = 20000): Promise<boolean> {
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

const NONEMPTY = 0.035;

async function main(): Promise<void> {
    await lock();
    const { browser } = await launchChrome({ headless: false, args: ['--window-position=40,40', '--window-size=1300,1000'] });
    try {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 880 }, deviceScaleFactor: 1.5 });
        // tsx keeps function names with __name(); functions sent to page.evaluate need it in the page
        await ctx.addInitScript('window.__name = window.__name || ((f) => f);');
        const page = await ctx.newPage();
        const errors: string[] = [];
        page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`.slice(0, 300)));
        page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`.slice(0, 300)); });
        const requested: string[] = [];
        page.on('request', (r) => requested.push(r.url()));

        // ---------------------------------------------------------------- V7 first: nothing of the 3D chunk before a picker opens
        {
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
        {
            await open(page, SITE, 'drone=pavo20pro-3s');
            await openPicker(page);
            await page.waitForSelector('[data-testid="drone-stage"] canvas', { timeout: 30000 });
            const ready = await frames(page, 25, 40000);
            const per: Record<string, Any> = {};
            const sigs: Record<string, number[]> = {};
            for (const id of IDS) {
                await page.click(`.drone-card[data-preset="${id}"] [data-action="drone-view3d"]`);
                await page.waitForFunction((want) => (window as Any).__gsfpvDrones3d?.infos()[0]?.drone === want, id, { timeout: 10000 });
                await frames(page, 12);
                await sleep(1300); // the turntable eases to its first view
                const shot = await canvasShot(page);
                const m = await measure(page, shot);
                const info = (await hookInfos(page))[0];
                const rowsN = await page.locator('[data-testid="d3-legend"] li').count();
                const pinsVisible = info.pins.filter((p: Any) => p.visible && !p.back).length;
                const legendTitles = await page.locator('[data-testid="d3-legend"] .d3-title').allTextContents();
                // the evidence picture: the whole stage with its pins and legend
                await page.locator('[data-testid="drone-stage"]').screenshot({ path: join(OUT, `${id}.png`) });
                if (id === CINE) await page.screenshot({ path: join(OUT, `picker-page-${id}.png`) });
                per[id] = { lit: +m.lit.toFixed(4), nonEmpty: m.lit > NONEMPTY, legendRows: rowsN, pinsVisible, backend: info.tally?.backend, titles: legendTitles, size: `${m.w}x${m.h}` };
                sigs[id] = m.sig;
            }
            // distinct pictures
            const pairs: { a: string; b: string; d: number }[] = [];
            for (let i = 0; i < IDS.length; i++) for (let j = i + 1; j < IDS.length; j++) pairs.push({ a: IDS[i], b: IDS[j], d: +sigDiff(sigs[IDS[i]], sigs[IDS[j]]).toFixed(4) });
            // Presets that are the same airframe sold with another pack, motors or prop (the Pavo20 Pro, its Pro II on 3S and 4S;
            // the 65 mm whoops) are drawn on the same parametric airframe, so their pictures differ in a few pixels only: those
            // pairs must still differ (a stuck model gives exactly 0, as the same-preset control does), the others by a lot.
            const group = (id: string): string => (/^pavo20pro/.test(id) ? 'pavo20' : /^(meteor65|air65)/.test(id) ? 'whoop65' : id);
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
            const distinct = minPair.d > 0.012 && minWithin.d > 0.0004;
            const pass = ready && allNonEmpty && distinct && legendOk && dragChange > 0.012 && same < 0.004;
            results.V1 = { pass, ready, perDrone: per, distinct: { minAcrossAirframes: minPair, threshold: 0.012, minWithinAirframe: minWithin, withinThreshold: 0.0004, pairs }, control: { samePresetTwice: +same.toFixed(5), dragChange: +dragChange.toFixed(4), identicalBelow: same < 0.004, dragAbove: dragChange > 0.012 } };
            console.log('V1', pass, JSON.stringify({ ready, allNonEmpty, distinct, minPair, minWithin, legendOk, same, dragChange }));
            await closePicker(page);
        }

        // V1 control: the base release has no stage
        {
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
        {
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
        {
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
            const shotKomodo = await measure(page, await canvasShot(page));
            // another camera: the stage, the card and (at the picker's close) the flight model follow
            await page.click('.d3-chip[data-payload="none"]');
            await frames(page, 12);
            await sleep(900);
            const info1 = (await hookInfos(page))[0];
            const twr1 = (await page.locator(`.drone-card[data-preset="${CINE}"] [data-spec="twr"] .spec-v`).innerText()).trim();
            const w1 = (await page.locator(`.drone-card[data-preset="${CINE}"] [data-spec="auw_g"] .spec-v`).innerText()).trim();
            const legend1 = (await page.locator('[data-testid="d3-legend"]').textContent()) ?? '';
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
                && info1.payload === 'none' && /None/.test(legend1) && !/RED KOMODO 6K/.test(legend1.split('Cinema camera')[1] ?? 'x') && twr1 === '5.6:1' && w1 === '2872 g'
                && Math.abs(mass0 - 4.872) < 1e-9 && Math.abs(mass1 - 2.872) < 1e-9 && Math.abs(mass2 - 2.872) < 1e-9 && pressed === 'none' && Math.abs(mass3 - 4.872) < 1e-9
                && sigDiff(shotKomodo.sig, shotNone.sig) > 0.004;
            results.V3 = { pass, legendBefore: legend0.split('\n').slice(0, 40).join(' | '), note: note0, card: { before: { twr: twr0, weight: w0 }, afterNone: { twr: twr1, weight: w1 } }, flightMassKg: { start: mass0, afterNone: mass1, afterReload: mass2, backToKomodo: mass3 }, stageChanged: +sigDiff(shotKomodo.sig, shotNone.sig).toFixed(4), pressedAfterReload: pressed, control: { massBeforeChoice: mass0, note: 'the mass at the start is the preset\'s 4.872 kg: the choice, not the picker, moved it' } };
            console.log('V3', pass, JSON.stringify({ twr0, twr1, w0, w1, mass0, mass1, mass2, mass3, pressed }));
        }

        // ---------------------------------------------------------------- V4 the pause menu's card
        {
            await open(page, SITE, 'drone=machr5sport-6s');
            await page.keyboard.press('KeyP');
            await page.waitForSelector('[data-testid="your-drone"] canvas', { timeout: 30000 });
            await frames(page, 15, 30000);
            const card = await page.locator('[data-testid="d3-card"]').innerText();
            const m = await measure(page, await page.locator('[data-testid="your-drone"] .d3-canvas').screenshot());
            const info = (await hookInfos(page))[0];
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
            const pass = /Mach R5 Sport/.test(card) && /Your drone/.test(card) && m.lit > NONEMPTY && info.drone === 'machr5sport-6s' && after?.live === 0 && after.created === after.disposed && cardsLeft === 0 && infos.length === 1;
            results.V4 = { pass, card: card.replace(/\n+/g, ' | '), lit: +m.lit.toFixed(4), liveAfterClose: after?.live, pickerStages: infos.length, cardsLeft, control: { liveWhileOpen: 1 } };
            console.log('V4', pass, JSON.stringify(results.V4));
            await closePicker(page);
        }

        // ---------------------------------------------------------------- V8 the settings screen's picture of the drone
        {
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
        {
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
        {
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
const keys = ['V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7', 'V8'];
const pass = keys.every((k) => results[k]?.pass === true) && !results.error;
const file = writeEvidence('v09-drones3d', { pass, site: SITE, baseSite: BASE_SITE, scene: SCENE, ...results });
writeFileSync(join(OUT, 'README.md'), '# 3D models of the drones, v0.9 lane D\n\nOne picture per drone, taken from the real drone picker of a local release by `tools/bench/src/accept-v09-drones3d.ts` (evidence `../v09-drones3d.json`). The picture is the whole stage: the turntable at its first view, the numbered pins and the legend beside it. Colours, finishes and the layout of wires and screws are stylised; sizes follow the published dimensions (docs/research/drone-models.md).\n');
console.log(`accept-v09-drones3d: ${pass ? 'PASS' : 'FAIL'} -> ${file}`);
process.exit(pass ? 0 : 1);
