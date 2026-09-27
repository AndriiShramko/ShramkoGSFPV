// Real screenshots of the simulator for the landing page and the README, shot on the LIVE site so
// they can be re-shot after every release. System Chrome, visible window, stock flags.
//
//   npx tsx tools/bench/src/screens.ts                   every shot, then encode
//   npx tsx tools/bench/src/screens.ts pause crash       only these ids (encode runs for all raw PNGs)
//   ENCODE_ONLY=1 npx tsx tools/bench/src/screens.ts     re-encode the last raw PNGs, no browser work
//   SITE=https://staging.example npx tsx ...             another deployment (default: the live site)
//
// Output
//   .cache/screens/raw/<id>.png                 the untouched capture (gitignored)
//   apps/site/public/shots/<id>-<w>.webp         large (<= 1600 px wide) and small (<= 800 px) WebP
//   docs/screenshots/<id>.webp                   byte copy of the large WebP (git stores one blob)
//   apps/site/src/config/shots.json              what the landing renders: ids, sizes, date, release
//
// Test switches of the simulator used here (all read by apps/fly/src/main.ts):
//   simradio=scenario  the bot pilot flies a fixed plan; the picture is frozen at a chosen sim tick (FLIGHT_TICK)
//   simradio=raw&nobuttons=1  the simulated EdgeTX radio walks the calibration wizard, pressing nothing
//   input=touch, refine=offer|off, nowarn=1
// WebP is encoded by Chrome itself (OffscreenCanvas.convertToBlob), so there is no image dependency.
import { chromium } from 'playwright';
import type { Browser, BrowserContext, Page } from 'playwright';
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from './evidence';

const SITE = (process.env.SITE ?? 'https://gsfpv.flyreelstudio.eu').replace(/\/$/, '');
const RAW = join(REPO, '.cache', 'screens', 'raw');
const SITE_SHOTS = join(REPO, 'apps', 'site', 'public', 'shots');
const DOC_SHOTS = join(REPO, 'docs', 'screenshots');
const MANIFEST = join(REPO, 'apps', 'site', 'src', 'config', 'shots.json');
const ONLY = process.argv.slice(2);
const want = (id: string): boolean => ONLY.length === 0 || ONLY.includes(id);
/** byte caps of the two WebP sizes (the landing's performance budget) */
const CAP_LARGE = 250 * 1024;
const CAP_SMALL = 100 * 1024;
const DESKTOP = { width: 1920, height: 1080 };
const MOBILE = { width: 390, height: 844 };

type Device = 'desktop' | 'mobile';
interface Clip { x: number; y: number; width: number; height: number }

/**
 * Every shot the landing and the README may show, in gallery order. `flow` is the browser run that
 * produces it (one run makes several shots). The captions live in the site dictionaries under
 * shots.items.<id> (four languages), not here.
 */
export const SHOTS: { id: string; device: Device; flow: string }[] = [
    { id: 'flight-tunis', device: 'desktop', flow: 'tunis' },
    { id: 'flight-villa', device: 'desktop', flow: 'villa' },
    { id: 'flight-garden', device: 'desktop', flow: 'garden' },
    { id: 'picker', device: 'desktop', flow: 'picker' },
    { id: 'loading', device: 'desktop', flow: 'loading' },
    { id: 'controls', device: 'desktop', flow: 'wizard' },
    { id: 'wizard-stir', device: 'desktop', flow: 'wizard' },
    { id: 'wizard-throttle', device: 'desktop', flow: 'wizard' },
    { id: 'wizard-arm', device: 'desktop', flow: 'wizard' },
    { id: 'wizard-check', device: 'desktop', flow: 'wizard' },
    { id: 'arm-card', device: 'desktop', flow: 'wizard' },
    { id: 'keys', device: 'desktop', flow: 'keys' },
    { id: 'walls', device: 'desktop', flow: 'keys' },
    { id: 'pause', device: 'desktop', flow: 'garden' },
    { id: 'settings', device: 'desktop', flow: 'garden' },
    { id: 'drones', device: 'desktop', flow: 'garden' },
    { id: 'betaflight', device: 'desktop', flow: 'garden' },
    { id: 'measure', device: 'desktop', flow: 'garden' },
    { id: 'cinema', device: 'desktop', flow: 'garden' },
    { id: 'crash', device: 'desktop', flow: 'tunis' },
    { id: 'replays', device: 'desktop', flow: 'tunis' },
    { id: 'm-flight', device: 'mobile', flow: 'mobile' },
    { id: 'm-touch', device: 'mobile', flow: 'mobile' },
    { id: 'm-pause', device: 'mobile', flow: 'mobile' },
    { id: 'm-crash', device: 'mobile', flow: 'mobile' },
    { id: 'm-picker', device: 'mobile', flow: 'mobile' },
    // SLOT: voxel-grid overlay (Andrii's item 24; architecture-v03 part G). Not live when this script
    // was written, so the flow only looks for the control and shoots nothing: no picture may pretend
    // to show it. Fill flowVoxels() once the overlay ships.
    { id: 'voxels', device: 'desktop', flow: 'voxels' }
];

/** Sim ticks (1 tick = 1 ms of flight) at which the bot's flight is frozen for the picture. */
const FLIGHT_TICK: Record<string, number> = { tunis: 3200, villa: 4800, garden: 2200, mobile: 2600 };

// ------------------------------------------------------------------ helpers
const report: Record<string, unknown>[] = [];
const note = (id: string, data: Record<string, unknown>): void => {
    report.push({ id, ...data });
    console.log(`${id}  ${JSON.stringify(data)}`);
};

/** GPU safety: a busy GPU (a DaVinci render, another agent's bench) waits, then gives up. */
function gpuBusy(): number {
    try {
        const out = execSync('nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits', { encoding: 'utf8', timeout: 15000 });
        return Math.max(...out.trim().split(/\s+/).map(Number).filter(Number.isFinite));
    } catch {
        return 0; // no NVIDIA tool: nothing to check
    }
}
async function waitForGpu(): Promise<void> {
    for (let i = 0; i < 30; i++) {
        const samples = [gpuBusy(), (await sleep(1000), gpuBusy()), (await sleep(1000), gpuBusy())];
        const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
        if (avg <= 40) return;
        console.log(`GPU ${avg.toFixed(0)} % busy: waiting 60 s (${i + 1}/30)`);
        await sleep(60000);
    }
    throw new Error('GPU stayed busy for 30 minutes: not shooting');
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const cb = (): string => `cb=${Math.random().toString(36).slice(2, 8)}`;
const fly = (qs: string): string => `${SITE}/en/fly/?${qs}&${cb()}`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
/** Evaluate a string in the page with `h` = the test hook and `s` = the flight session. Strings,
 *  not functions: tsx wraps functions with a __name() helper that does not exist in the page. */
async function hook<T = Any>(page: Page, body: string): Promise<T> {
    return page.evaluate(`(() => { const h = window.__gsfpv; const s = h && h.session; ${body} })()`) as Promise<T>;
}
async function until(page: Page, body: string, ok: (v: Any) => boolean, timeoutMs: number, stepMs = 150): Promise<Any> {
    const t0 = Date.now();
    let v: Any = await hook(page, body);
    while (!ok(v)) {
        if (Date.now() - t0 > timeoutMs) throw new Error(`timeout waiting for: ${body.slice(0, 120)} (last ${JSON.stringify(v)?.slice(0, 200)})`);
        await page.waitForTimeout(stepMs);
        v = await hook(page, body);
    }
    return v;
}
async function ready(page: Page, timeoutMs = 180000): Promise<string> {
    const st = await until(page, 'return h ? h.status : null;', (v) => !!v && v !== 'loading', timeoutMs, 250);
    if (st === 'error') throw new Error(`the page reports an error: ${await hook(page, 'return h.error;')}`);
    return st;
}
/** Every <img> on the page has arrived (the picker's posters, the drone cards). */
async function imagesLoaded(page: Page): Promise<void> {
    await page.waitForFunction('[...document.images].every((i) => i.complete)', undefined, { timeout: 30000 }).catch(() => undefined);
}
/** Two painted frames, so what was just changed is on screen. */
async function frames(page: Page, n = 3): Promise<void> {
    for (let i = 0; i < n; i++) await page.evaluate('new Promise((r) => requestAnimationFrame(() => r(0)))');
}
/** Freeze the bot's flight at a sim tick: a hold of our own, the menus' own pause does not lift it. */
async function freezeAt(page: Page, tick: number): Promise<void> {
    await until(page, 'return s ? s.sim.tick : 0;', (v) => v >= tick, 60000, 20);
    await hook(page, "s.pause(true, 'shots'); return 0;");
    await page.waitForTimeout(250);
    await frames(page);
}
async function unfreeze(page: Page): Promise<void> {
    await hook(page, "s.pause(false, 'shots'); return 0;");
}
/** The union box of the elements, grown to 16:9 (at least minW wide) around its centre, inside the viewport. */
async function clip16x9(page: Page, selector: string, pad = 40, minW = 0): Promise<Clip | undefined> {
    const box = await page.evaluate(`(() => {
        const els = [...document.querySelectorAll(${JSON.stringify(selector)})];
        let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
        for (const e of els) { const r = e.getBoundingClientRect(); if (!r.width) continue; x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top); x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom); }
        return x1 > x0 ? { x0, y0, x1, y1, vw: innerWidth, vh: innerHeight } : null;
    })()`) as { x0: number; y0: number; x1: number; y1: number; vw: number; vh: number } | null;
    if (!box) return undefined;
    let w = box.x1 - box.x0 + 2 * pad, h = box.y1 - box.y0 + 2 * pad;
    if (w / h > 16 / 9) h = w * 9 / 16; else w = h * 16 / 9;
    if (w < minW) { h = h * minW / w; w = minW; }
    w = Math.min(w, box.vw); h = Math.min(h, box.vh);
    const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
    const x = Math.max(0, Math.min(box.vw - w, cx - w / 2)), y = Math.max(0, Math.min(box.vh - h, cy - h / 2));
    return { x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h) };
}

async function snap(page: Page, id: string, clip?: Clip): Promise<void> {
    if (!want(id)) return;
    await frames(page);
    const path = join(RAW, `${id}.png`);
    await page.screenshot({ path, clip });
    const vis = await page.evaluate('document.visibilityState');
    note(id, { raw: path.slice(REPO.length + 1), clip: clip ?? 'viewport', visibility: vis });
}

async function context(browser: Browser, device: Device): Promise<BrowserContext> {
    const ctx = await browser.newContext(device === 'desktop'
        ? { viewport: DESKTOP, deviceScaleFactor: 1 }
        : { viewport: MOBILE, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    // the first-visit safety note is answered; nothing else is pre-set (a fresh visitor otherwise)
    await ctx.addInitScript({ content: "try { localStorage.setItem('gsfpv.warned', '1'); } catch (e) {}" });
    return ctx;
}
async function open(ctx: BrowserContext): Promise<Page> {
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log(`pageerror: ${e.message.slice(0, 200)}`));
    return page;
}
/** A pause-menu item: P opens the menu, the item opens its screen. */
async function menu(page: Page, action: string): Promise<void> {
    await page.keyboard.press('KeyP');
    await page.locator('.pause-menu').waitFor({ timeout: 5000 });
    await page.click(`[data-action="${action}"]`);
    await page.waitForTimeout(500);
}
async function escape(page: Page): Promise<void> {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(350);
}

// ------------------------------------------------------------------ flows
const flows: Record<string, (b: Browser) => Promise<void>> = {
    async picker(b) {
        const ctx = await context(b, 'desktop');
        const page = await open(ctx);
        await page.goto(fly('nowarn=1'));
        await ready(page);
        await page.locator('.scene-card img').first().waitFor();
        await imagesLoaded(page);
        await page.waitForTimeout(600);
        await snap(page, 'picker', await clip16x9(page, '.screen.scenes > *'));
        await ctx.close();
    },

    async loading(b) {
        // an empty cache and a 20 Mbit/s line, so the screen shows stage, MB, speed and time left
        const ctx = await context(b, 'desktop');
        const page = await open(ctx);
        const cdp = await ctx.newCDPSession(page);
        await cdp.send('Network.enable');
        await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
        await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 40, downloadThroughput: 2.5e6, uploadThroughput: 1e6 });
        await page.goto(fly('scene=887f27aa&input=touch&refine=off'));
        const st = await until(page, 'return h && h.loading ? h.loading : null;', (v) => !!v && v.fraction >= 0.3 && v.elapsedMs >= 6000, 180000, 200);
        await page.waitForTimeout(300);
        await snap(page, 'loading', await clip16x9(page, '.loading > *', 60, 1100));
        note('loading', { progress: st });
        await ctx.close();
    },

    async wizard(b) {
        const ctx = await context(b, 'desktop');
        const page = await open(ctx);
        await page.goto(fly('scene=39e63ce9&simradio=raw&nobuttons=1'));
        await ready(page);
        const state = 'const w = h.radio && h.radio.wizard; return w ? { id: w.state.id, stage: w.state.stage, hold: w.state.hold } : null;';
        const at = async (id: string, stage: string | null, extraMs: number, shot: string): Promise<void> => {
            await until(page, state, (v) => !!v && v.id === id && v.stage === stage, 60000, 40);
            await page.waitForTimeout(extraMs);
            await snap(page, shot);
        };
        await at('stir', 'active', 1600, 'wizard-stir');
        await at('throttle', 'done', 250, 'wizard-throttle');
        await at('arm', 'active', 500, 'wizard-arm');
        await at('check', null, 1200, 'wizard-check');
        // Fly: the flight view, disarmed, with the card that says what arming still needs
        await page.click('[data-action="wizard-done"]');
        await page.locator('.arm-card:not(.hidden)').waitFor({ timeout: 10000 });
        await page.waitForTimeout(1200);
        await snap(page, 'arm-card');
        await page.click('[data-action="open-controls"]');
        await page.locator('.screen.radio').waitFor();
        await page.waitForTimeout(600);
        await snap(page, 'controls', await clip16x9(page, '.screen.radio .radio-body > *'));
        await ctx.close();
    },

    async keys(b) {
        // a fresh visitor on the Winter Garden: the Controls screen first, then the keyboard
        const ctx = await context(b, 'desktop');
        const page = await open(ctx);
        await page.goto(fly('scene=7a475d38&refine=offer'));
        await ready(page);
        await page.click('[data-action="radio-keyboard"]');
        await page.locator('.key-card:not(.hidden)').waitFor({ timeout: 10000 });
        await until(page, 'return h.walls ? h.walls.state : null;', (v) => v === 'offer' || v === 'none' || v === 'refused', 60000, 250);
        await page.waitForTimeout(1500);
        await snap(page, 'keys');
        // the walls line on the credit opens its store (not armed: a keyboard quad left armed takes off)
        await page.click('[data-testid="walls-summary"]');
        await page.waitForTimeout(900);
        await snap(page, 'walls');
        note('walls', { walls: await hook(page, 'return { state: h.walls.state, voxelM: h.walls.voxelM, plan: h.walls.plan };') });
        await ctx.close();
    },

    async tunis(b) {
        const ctx = await context(b, 'desktop');
        const page = await open(ctx);
        await page.goto(fly('scene=887f27aa&simradio=scenario'));
        await ready(page);
        await freezeAt(page, FLIGHT_TICK.tunis);
        await snap(page, 'flight-tunis');
        await unfreeze(page);
        // the bot's dash ends in a wall: the wreck (Rapier debris), then the crash panel
        const crash = await until(page, 'return h.lastCrash || null;', (v) => !!v && !v.pending, 90000, 200);
        await page.locator('.crash-overlay').waitFor({ timeout: 10000 });
        await page.waitForTimeout(700);
        await snap(page, 'crash');
        note('crash', { speed: crash.speed, debris: crash.debris, engine: crash.engine });
        // save the log (the test mode keeps it in the page), then the replays list shows it
        await page.click('[data-action="save"]');
        await page.waitForTimeout(300);
        await menu(page, 'pause.replays');
        await snap(page, 'replays', await clip16x9(page, '.panel', 40, 1280));
        await ctx.close();
    },

    async villa(b) {
        const ctx = await context(b, 'desktop');
        const page = await open(ctx);
        await page.goto(fly('scene=39e63ce9&simradio=scenario'));
        await ready(page);
        await freezeAt(page, FLIGHT_TICK.villa);
        await snap(page, 'flight-villa');
        await ctx.close();
    },

    async garden(b) {
        // the bot flies the Winter Garden; frozen mid-air, every menu opens over the same frame
        const ctx = await context(b, 'desktop');
        const page = await open(ctx);
        await page.goto(fly('scene=7a475d38&simradio=scenario'));
        await ready(page);
        await freezeAt(page, FLIGHT_TICK.garden);
        await snap(page, 'flight-garden');
        await page.keyboard.press('KeyP');
        await page.locator('.pause-menu').waitFor();
        await page.waitForTimeout(400);
        await snap(page, 'pause');
        await escape(page);
        await menu(page, 'pause.settings');
        await page.click('.panel details > summary');
        await page.waitForTimeout(300);
        await snap(page, 'settings');
        await escape(page);
        await menu(page, 'pause.drone');
        await imagesLoaded(page);
        await page.waitForTimeout(500);
        await snap(page, 'drones');
        await escape(page);
        await menu(page, 'pause.measure');
        await page.waitForTimeout(800);
        await snap(page, 'measure');
        await escape(page);
        await menu(page, 'pause.import');
        await page.fill('.import-text', readFileSync(join(REPO, 'packages', 'sim-core', 'test', 'fixtures', 'bf-diff-4.5.1.txt'), 'utf8'));
        await page.click('[data-action="import-apply"]');
        await page.locator('.import-out p').waitFor();
        await page.waitForTimeout(300);
        await snap(page, 'betaflight');
        await escape(page);
        await menu(page, 'pause.cinema');
        await page.waitForTimeout(2500); // full detail streams in
        await snap(page, 'cinema');
        await ctx.close();
    },

    async mobile(b) {
        const ctx = await context(b, 'mobile');
        const page = await open(ctx);
        await page.goto(fly('nowarn=1'));
        await ready(page);
        await page.locator('.scene-card img').first().waitFor();
        await imagesLoaded(page);
        await page.waitForTimeout(500);
        await snap(page, 'm-picker');
        await page.goto(fly('scene=887f27aa&input=touch&refine=off'));
        await ready(page);
        await page.locator('.touch-pad.left').waitFor();
        await page.waitForTimeout(1500);
        await snap(page, 'm-touch');
        await page.click('[data-action="pause"]');
        await page.locator('.pause-menu').waitFor();
        await page.waitForTimeout(400);
        await snap(page, 'm-pause');
        await page.goto(fly('scene=39e63ce9&simradio=scenario'));
        await ready(page);
        await freezeAt(page, FLIGHT_TICK.mobile);
        await snap(page, 'm-flight');
        await unfreeze(page);
        await until(page, 'return h.lastCrash || null;', (v) => !!v && !v.pending, 90000, 200);
        await page.locator('.crash-overlay').waitFor({ timeout: 10000 });
        await page.waitForTimeout(700);
        await snap(page, 'm-crash');
        await ctx.close();
    },

    async voxels(b) {
        // SLOT (see SHOTS): look for the overlay control on the live simulator, shoot nothing yet
        const ctx = await context(b, 'desktop');
        const page = await open(ctx);
        await page.goto(fly('scene=39e63ce9&input=touch&refine=off'));
        await ready(page);
        await page.keyboard.press('KeyP');
        await page.waitForTimeout(400);
        const found = await page.evaluate(`(() => {
            const h = window.__gsfpv || {};
            const items = [...document.querySelectorAll('[data-action]')].map((e) => e.getAttribute('data-action')).filter((a) => /vox/i.test(a));
            return { menuItems: items, hookKeys: Object.keys(h).filter((k) => /vox/i.test(k)) };
        })()`);
        note('voxels', { status: 'not shot: the voxel overlay is not live yet; fill flowVoxels once it ships', found });
        await ctx.close();
    }
};

// ------------------------------------------------------------------ encode
interface Variant { src: string; w: number; h: number; bytes: number; quality: number }
interface Encoded { id: string; device: Device; raw: { w: number; h: number }; large: Variant; small: Variant }

/** PNG -> two WebP sizes, in Chrome's own encoder: the best quality under each byte cap. */
async function encodeAll(b: Browser): Promise<Encoded[]> {
    mkdirSync(SITE_SHOTS, { recursive: true });
    mkdirSync(DOC_SHOTS, { recursive: true });
    const ctx = await b.newContext();
    const page = await ctx.newPage();
    await page.goto('about:blank');
    const out: Encoded[] = [];
    for (const s of SHOTS) {
        const raw = join(RAW, `${s.id}.png`);
        if (!existsSync(raw)) continue;
        const r = await page.evaluate(`(async () => {
            const b64 = ${JSON.stringify(readFileSync(raw).toString('base64'))};
            const bin = atob(b64); const u = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
            const bmp = await createImageBitmap(new Blob([u], { type: 'image/png' }));
            const W = bmp.width, H = bmp.height;
            const toB64 = async (blob) => { const a = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s); };
            const scaled = (w) => {
                // halve while more than 2x too big (a single big step aliases), then one high-quality step
                let src = bmp, sw = W, sh = H;
                while (sw / 2 >= w * 1.0001 && sw / 2 >= w) {
                    const c = new OffscreenCanvas(Math.round(sw / 2), Math.round(sh / 2)); const g = c.getContext('2d');
                    g.imageSmoothingQuality = 'high'; g.drawImage(src, 0, 0, c.width, c.height); src = c; sw = c.width; sh = c.height;
                }
                const h = Math.round(H * w / W);
                const c = new OffscreenCanvas(w, h); const g = c.getContext('2d');
                g.imageSmoothingQuality = 'high'; g.drawImage(src, 0, 0, w, h);
                return c;
            };
            const best = async (w, cap) => {
                const c = scaled(w);
                let q = 0.86, blob = await c.convertToBlob({ type: 'image/webp', quality: q });
                while (blob.size > cap && q > 0.3) { q = Math.round((q - 0.04) * 100) / 100; blob = await c.convertToBlob({ type: 'image/webp', quality: q }); }
                if (blob.type !== 'image/webp') throw new Error('this Chrome did not encode WebP: ' + blob.type);
                return { w: c.width, h: c.height, q, size: blob.size, b64: await toB64(blob) };
            };
            const lw = Math.min(1600, W), sw = Math.min(800, Math.round(W / 2));
            return { W, H, large: await best(lw, ${CAP_LARGE}), small: await best(sw, ${CAP_SMALL}) };
        })()`) as { W: number; H: number; large: Any; small: Any };
        const write = (v: Any): Variant => {
            const name = `${s.id}-${v.w}.webp`;
            writeFileSync(join(SITE_SHOTS, name), Buffer.from(v.b64, 'base64'));
            return { src: `/shots/${name}`, w: v.w, h: v.h, bytes: v.size, quality: v.q };
        };
        const e: Encoded = { id: s.id, device: s.device, raw: { w: r.W, h: r.H }, large: write(r.large), small: write(r.small) };
        copyFileSync(join(SITE_SHOTS, `${s.id}-${e.large.w}.webp`), join(DOC_SHOTS, `${s.id}.webp`));
        out.push(e);
        console.log(`encoded ${s.id}: ${r.W}x${r.H} -> ${e.large.w}px ${(e.large.bytes / 1024).toFixed(0)} KB q${e.large.quality}, ${e.small.w}px ${(e.small.bytes / 1024).toFixed(0)} KB q${e.small.quality}`);
    }
    await ctx.close();
    // files of shots that are gone (renamed or dropped) must not linger on the site
    const keep = new Set(out.flatMap((e) => [e.large.src.slice(7), e.small.src.slice(7)]));
    for (const f of readdirSync(SITE_SHOTS)) if (f.endsWith('.webp') && !keep.has(f)) rmSync(join(SITE_SHOTS, f));
    const keepDoc = new Set(out.map((e) => `${e.id}.webp`));
    for (const f of readdirSync(DOC_SHOTS)) if (f.endsWith('.webp') && !keepDoc.has(f)) rmSync(join(DOC_SHOTS, f));
    return out;
}

/** docs/screenshots/README.md: every shot with its English caption (from the site dictionary). */
function writeDocsIndex(encoded: Encoded[], shotAt: string, release: Record<string, unknown> | null): void {
    const en = JSON.parse(readFileSync(join(REPO, 'packages', 'i18n', 'locales', 'site', 'en.json'), 'utf8')) as { shots?: { items?: Record<string, { t: string; d: string }> } };
    const cap = (id: string) => en.shots?.items?.[id] ?? { t: id, d: '' };
    const cell = (e: Encoded) => `<td width="50%" valign="top"><a href="${e.id}.webp"><img src="${e.id}.webp" alt="${cap(e.id).t}"${e.device === 'mobile' ? ' width="260"' : ''}></a><br><sub><b>${cap(e.id).t}</b> — ${cap(e.id).d}</sub></td>`;
    const table = (list: Encoded[]) => {
        const out: string[] = [];
        for (let i = 0; i < list.length; i += 2) out.push(['<tr>', ...list.slice(i, i + 2).map(cell), '</tr>'].join('\n'));
        return ['<table>', ...out, '</table>'].join('\n');
    };
    const desk = encoded.filter((e) => e.device === 'desktop');
    const phone = encoded.filter((e) => e.device === 'mobile');
    const rel = release?.sha ? ` (the release built from commit \`${String(release.sha)}\`)` : '';
    const md = [
        '# ShramkoGSFPV screenshots',
        '',
        `Real screenshots of the live simulator at https://gsfpv.flyreelstudio.eu, taken on ${shotAt}${rel} by [\`tools/bench/src/screens.ts\`](../../tools/bench/src/screens.ts) in system Chrome (desktop 1920×1080, phone-sized 390×844). The same files are on the [landing page](https://gsfpv.flyreelstudio.eu/en/#gallery) with captions in four languages. To take them again after a release: \`npx tsx tools/bench/src/screens.ts\`.`,
        '',
        "The calibration screens use the simulator's built-in simulated EdgeTX radio (`?simradio=raw`) and the flights are flown by its test pilot (`?simradio=scenario`), so the same screens can be taken again the same way after a release. This file is written by the same script.",
        '',
        `## Desktop (${desk.length})`,
        '',
        table(desk),
        '',
        `## Phone-sized screen (${phone.length})`,
        '',
        table(phone),
        ''
    ].join('\n');
    writeFileSync(join(DOC_SHOTS, 'README.md'), md);
}

async function liveRelease(): Promise<Record<string, unknown> | null> {
    try {
        const r = await fetch(`${SITE}/release.json?${cb()}`);
        return r.ok ? ((await r.json()) as Record<string, unknown>) : null;
    } catch {
        return null;
    }
}

// ------------------------------------------------------------------ main
mkdirSync(RAW, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--window-position=40,40', `--window-size=${DESKTOP.width + 16},${DESKTOP.height + 120}`] });
try {
    if (!process.env.ENCODE_ONLY) {
        await waitForGpu();
        const todo = [...new Set(SHOTS.filter((s) => want(s.id)).map((s) => s.flow))];
        for (const f of todo) {
            console.log(`--- flow ${f}`);
            try {
                await flows[f](browser);
            } catch (e) {
                note(`flow:${f}`, { error: String((e as Error)?.message ?? e).slice(0, 400) });
            }
        }
    }
    const encoded = await encodeAll(browser);
    const release = await liveRelease();
    const prev = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : null;
    const manifest = {
        note: 'written by tools/bench/src/screens.ts: real screenshots of the live simulator; captions in packages/i18n/locales/site/*.json under shots.items',
        site: SITE,
        shotAt: process.env.ENCODE_ONLY && prev?.shotAt ? prev.shotAt : new Date().toISOString().slice(0, 10),
        release: process.env.ENCODE_ONLY && prev?.release ? prev.release : release,
        items: encoded
    };
    writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
    writeDocsIndex(encoded, manifest.shotAt, manifest.release as Record<string, unknown> | null);
    writeFileSync(join(REPO, '.cache', 'screens', 'report.json'), JSON.stringify({ site: SITE, release, report }, null, 2));
    const failed = report.filter((r) => 'error' in r);
    console.log(`\nshots: ${encoded.length} encoded; flow errors: ${failed.length}${failed.length ? ' ' + failed.map((f) => f.id).join(', ') : ''}`);
    if (failed.length) process.exitCode = 1;
} finally {
    await browser.close();
}
