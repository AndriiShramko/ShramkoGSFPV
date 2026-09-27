// Real screenshots of the simulator for the landing page and the README, so they can be taken again
// after every release. System Chrome, visible window, stock flags.
//
//   npx tsx tools/bench/src/screens.ts                   every shot, then encode
//   npx tsx tools/bench/src/screens.ts pause crash       only these ids (encode runs for all raw PNGs)
//   ENCODE_ONLY=1 npx tsx tools/bench/src/screens.ts     re-encode the last raw PNGs, no browser work
//   SITE=https://staging.example npx tsx ...             another deployment (default: the live site)
//   FLY=http://localhost:5382/fly/ npx tsx ...           a local production build of this commit
//                                                         (`vite build` + `vite preview`), for a release
//                                                         whose pictures must show what it ships
//
// Output
//   .cache/screens/raw/<id>.png, <id>.panel.json  the untouched capture and where its menu crop is (gitignored)
//   apps/site/public/shots/<id>-<w>.webp           the whole screen: large (<= 1600 px) and small (<= 800 px)
//   apps/site/public/shots/<id>-panel-<w>.webp     the menu itself (see PANEL), the same two sizes
//   docs/screenshots/<id>.webp, <id>-panel.webp    byte copies of the large files (git stores one blob)
//   apps/site/src/config/shots.json                what the landing renders: ids, sizes, date, release
//
// Desktop pictures are taken at device scale 2 (3840 x 2160 for a 1920 x 1080 window) with the scene
// rendered at half that (?scale=0.5, the same 1920 x 1080 backbuffer as a 1x screen), so the menus'
// text is sharp in the crops. The quality governor is off (?governor=0): the detail does not step down
// while the picture is taken.
//
// Test switches of the simulator used here (all read by apps/fly/src/main.ts):
//   simradio=scenario  the bot pilot flies a fixed plan (tour=1: legs through free space, then a dash);
//                      the picture is frozen when the bot is really flying (freezeWhen)
//   simradio=raw&nobuttons=1  the simulated EdgeTX radio walks the calibration wizard, pressing nothing
//   input=touch, refine=offer|off, nowarn=1, scale, governor=0
//   the voxel grid through the page's test hook (__gsfpv.voxels: mode, style, opacity)
// WebP is encoded by Chrome itself (OffscreenCanvas.convertToBlob), so there is no image dependency.
import { chromium } from 'playwright';
import type { Browser, BrowserContext, Page } from 'playwright';
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from './evidence';

const SITE = (process.env.SITE ?? 'https://gsfpv.flyreelstudio.eu').replace(/\/$/, '');
/** where the simulator is opened: the site's English /en/fly/, or FLY (a local build of this commit) */
const FLY = (process.env.FLY ?? `${SITE}/en/fly/`).replace(/\/?$/, '/');
const LOCAL_BUILD = !!process.env.FLY;
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
/** desktop: sharp menus (device scale 2), the scene at the cost of a 1x screen, no governor */
const DESK_Q = 'scale=0.5&governor=0';

type Device = 'desktop' | 'mobile';
interface Clip { x: number; y: number; width: number; height: number }

/**
 * Every shot the landing and the README may show, in gallery order: the menus first, then the
 * voxel grid, the flights and the phone. `flow` is the browser run that produces it (one run makes
 * several shots). The captions live in the site dictionaries under shots.items.<id> (four
 * languages), not here. Shots with a PANEL spec also get a crop of the menu itself.
 */
export const SHOTS: { id: string; device: Device; flow: string }[] = [
    { id: 'pause', device: 'desktop', flow: 'garden' },
    { id: 'settings', device: 'desktop', flow: 'tunis' },
    { id: 'drones', device: 'desktop', flow: 'garden' },
    { id: 'wizard-stir', device: 'desktop', flow: 'wizard' },
    { id: 'wizard-throttle', device: 'desktop', flow: 'wizard' },
    { id: 'wizard-arm', device: 'desktop', flow: 'wizard' },
    { id: 'wizard-check', device: 'desktop', flow: 'wizard' },
    { id: 'controls', device: 'desktop', flow: 'wizard' },
    { id: 'arm-card', device: 'desktop', flow: 'wizard' },
    { id: 'keys', device: 'desktop', flow: 'keys' },
    { id: 'walls', device: 'desktop', flow: 'vgarden' },
    { id: 'voxels', device: 'desktop', flow: 'vtunis' },
    { id: 'voxels-wire', device: 'desktop', flow: 'vgarden' },
    { id: 'voxels-only', device: 'desktop', flow: 'vvilla' },
    { id: 'voxels-floaters', device: 'desktop', flow: 'vgarden' },
    { id: 'betaflight', device: 'desktop', flow: 'villa' },
    { id: 'measure', device: 'desktop', flow: 'villa' },
    { id: 'replays', device: 'desktop', flow: 'tunis' },
    { id: 'picker', device: 'desktop', flow: 'picker' },
    { id: 'loading', device: 'desktop', flow: 'loading' },
    { id: 'crash', device: 'desktop', flow: 'tunis' },
    { id: 'cinema', device: 'desktop', flow: 'cinema' },
    { id: 'flight-tunis', device: 'desktop', flow: 'tunis' },
    { id: 'flight-villa', device: 'desktop', flow: 'villa' },
    { id: 'flight-garden', device: 'desktop', flow: 'garden' },
    { id: 'm-flight', device: 'mobile', flow: 'mobile' },
    { id: 'm-touch', device: 'mobile', flow: 'mobile' },
    { id: 'm-pause', device: 'mobile', flow: 'mobile' },
    { id: 'm-crash', device: 'mobile', flow: 'mobile' },
    { id: 'm-picker', device: 'mobile', flow: 'mobile' }
];

/**
 * The crop of each menu shot ("panel"): the menu's box plus about 12 % of the scene around it, as
 * wide as 16:10 or, for a tall menu, down to 5:4; a menu taller than that is cut at its top part.
 * Captured at device scale 2, so a 1000 px crop shown 640 px wide still has 10 px text.
 * `extra` boxes join the union (the crash: the middle of the screen, where the chase camera looks).
 */
interface PanelSpec { sel: string; extra?: Clip[]; pad?: number; minW?: number; maxW?: number }
const MID = { x: DESKTOP.width / 2 - 170, y: DESKTOP.height / 2 - 150, width: 340, height: 260 };
const PANEL: Record<string, PanelSpec> = {
    pause: { sel: '.pause-menu', maxW: 1000 },
    settings: { sel: '.panel', maxW: 700 }, // the panel's width and its top: the walls and voxel grid block
    drones: { sel: '.screen.drones h1, .screen.drones .drone-card:nth-child(-n+4)', maxW: 1200, pad: 0.04 },
    betaflight: { sel: '.panel', maxW: 1000 },
    measure: { sel: '.panel', maxW: 1000 },
    replays: { sel: '.panel', minW: 760 },
    'wizard-stir': { sel: '.wz-steps, .wz-head, .wz-live, .wz-stage, .wz-extra', maxW: 1200, pad: 0.05 },
    'wizard-throttle': { sel: '.wz-steps, .wz-head, .wz-live, .wz-stage, .wz-extra', maxW: 1200, pad: 0.05 },
    'wizard-arm': { sel: '.wz-steps, .wz-head, .wz-live, .wz-stage, .wz-extra', maxW: 1200, pad: 0.05 },
    'wizard-check': { sel: '.wz-steps, .wz-head, .wz-live, .wz-stage, .wz-extra', maxW: 1200, pad: 0.05 },
    'arm-card': { sel: '.arm-card:not(.hidden)', minW: 620 },
    keys: { sel: '.key-card:not(.hidden)', minW: 700 },
    walls: { sel: '[data-testid="walls-more"]', minW: 700 },
    crash: { sel: '.crash-overlay', extra: [MID], maxW: 1100, pad: 0.05 }
};

/** Where the bot's flight is frozen for a picture: a condition on the HUD (x = session.hud()) and the tick. */
const FREEZE = {
    tunis: 's.sim.tick > 6300 && x.speed >= 4.6', // second leg of the tour, 4.7 m/s through the palm garden
    cinema: 's.sim.tick > 4100 && x.speed >= 4.4', // first leg of the tour, another heading
    villa: 'x.speed >= 6', // the dash across the attic room, nose down
    gardenMenus: 's.sim.tick > 7000', // slow part of the tour, for the menus over the garden
    garden: 'x.speed >= 8', // the dash through the garden, 9 m/s
    mobile: 'x.speed >= 6',
    hover: 's.sim.tick > 1500' // armed, hovering at the scan's spawn (the voxel grid pictures)
};

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
const fly = (qs: string): string => `${FLY}?${qs}&${cb()}`;

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
/** A few painted frames, so what was just changed is on screen. */
async function frames(page: Page, n = 3): Promise<void> {
    for (let i = 0; i < n; i++) await page.evaluate('new Promise((r) => requestAnimationFrame(() => r(0)))');
}
/**
 * Freeze the bot's flight at the first painted frame where `cond` holds (checked in the page every
 * frame, so a 5-10 m/s dash is caught mid-air): a hold of our own, the menus' own pause does not
 * lift it. Returns what the HUD showed.
 */
async function freezeWhen(page: Page, cond: string, timeoutMs = 120000): Promise<Any> {
    await hook(page, `window.__shotFreeze = null;
        const step = () => {
            const x = s.hud();
            if (${cond}) { s.pause(true, 'shots'); window.__shotFreeze = { tick: s.sim.tick, speed: +x.speed.toFixed(2), altitude: +x.altitude.toFixed(2), pitch: +x.pitch.toFixed(1), roll: +x.roll.toFixed(1), timeS: +x.timeS.toFixed(1) }; return; }
            if (h.lastCrash) { window.__shotFreeze = { crashed: true }; return; }
            requestAnimationFrame(step);
        };
        requestAnimationFrame(step); return 0;`);
    const v = await until(page, 'return window.__shotFreeze;', (x) => !!x, timeoutMs, 50);
    if (v.crashed) throw new Error(`the bot crashed before: ${cond}`);
    await page.waitForTimeout(600);
    await frames(page);
    return v;
}
async function unfreeze(page: Page): Promise<void> {
    await hook(page, "s.pause(false, 'shots'); return 0;");
}
/**
 * The bot's dash ends in a wall. `afterMs` into the tumble the page clock stops (performance.now
 * returns one value), so the wreck and its debris hang in the air while the crash card still
 * appears on its own real timer (1.5 s). restoreClock() lets time run again.
 */
async function crashFrozen(page: Page, afterMs = 320): Promise<Any> {
    await hook(page, `window.__shotCrash = null;
        const step = () => {
            if (h.lastCrash) {
                setTimeout(() => { const t = performance.now(); window.__realNow = performance.now.bind(performance); performance.now = () => t; window.__shotCrash = true; }, ${afterMs});
                return;
            }
            requestAnimationFrame(step);
        };
        requestAnimationFrame(step); return 0;`);
    await until(page, 'return window.__shotCrash;', (x) => !!x, 120000, 50);
    await page.locator('.crash-overlay').waitFor({ timeout: 10000 });
    await page.waitForTimeout(500);
    await frames(page);
    return hook(page, 'return h.lastCrash;');
}
async function restoreClock(page: Page): Promise<void> {
    await hook(page, 'if (window.__realNow) performance.now = window.__realNow; return 0;');
}
/** The union box of the elements, grown to 16:9 (at least minW wide) around its centre, inside the viewport. */
async function clip16x9(page: Page, selector: string, pad = 40, minW = 0): Promise<Clip | undefined> {
    const box = await unionBox(page, selector);
    if (!box) return undefined;
    let w = box.x1 - box.x0 + 2 * pad, h = box.y1 - box.y0 + 2 * pad;
    if (w / h > 16 / 9) h = w * 9 / 16; else w = h * 16 / 9;
    if (w < minW) { h = h * minW / w; w = minW; }
    w = Math.min(w, box.vw); h = Math.min(h, box.vh);
    const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
    const x = Math.max(0, Math.min(box.vw - w, cx - w / 2)), y = Math.max(0, Math.min(box.vh - h, cy - h / 2));
    return { x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h) };
}
interface Box { x0: number; y0: number; x1: number; y1: number; vw: number; vh: number }
/** The union of the visible elements' boxes, cut to the viewport. */
async function unionBox(page: Page, selector: string, extra: Clip[] = []): Promise<Box | null> {
    return page.evaluate(`(() => {
        const els = [...document.querySelectorAll(${JSON.stringify(selector)})];
        let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
        for (const e of els) { const r = e.getBoundingClientRect(); if (!r.width || !r.height) continue; x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top); x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom); }
        if (x1 > x0) for (const c of ${JSON.stringify(extra)}) { x0 = Math.min(x0, c.x); y0 = Math.min(y0, c.y); x1 = Math.max(x1, c.x + c.width); y1 = Math.max(y1, c.y + c.height); }
        x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(innerWidth, x1); y1 = Math.min(innerHeight, y1);
        return x1 > x0 && y1 > y0 ? { x0, y0, x1, y1, vw: innerWidth, vh: innerHeight } : null;
    })()`) as Promise<Box | null>;
}
/** The PANEL crop (see there) of what is on screen now. */
async function panelClip(page: Page, spec: PanelSpec): Promise<Clip | undefined> {
    const box = await unionBox(page, spec.sel, spec.extra);
    if (!box) return undefined;
    const pad = spec.pad ?? 0.12;
    const bw = box.x1 - box.x0, bh = box.y1 - box.y0;
    const padX = pad * bw, padY = Math.min(pad * bh, 60);
    let w = bw + 2 * padX, h = bh + 2 * padY;
    const ar = Math.max(1.25, Math.min(1.6, w / h));
    if (w / h > ar) h = w / ar; else w = h * ar;
    if (spec.minW && w < spec.minW) { w = spec.minW; h = w / ar; }
    const maxW = spec.maxW ?? 1100;
    if (w > maxW) { w = maxW; h = w / ar; }
    w = Math.min(w, box.vw); h = Math.min(h, box.vh);
    const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
    const x = Math.max(0, Math.min(box.vw - w, cx - w / 2));
    // a menu taller than the crop keeps its top (its title and first rows) in the picture
    const y = h >= bh + 2 * padY - 1 ? cy - h / 2 : box.y0 - Math.min(padY, 24);
    return { x: Math.round(x), y: Math.round(Math.max(0, Math.min(box.vh - h, y))), width: Math.round(w), height: Math.round(h) };
}

/**
 * One capture. The menu crop is cut from the same PNG by the encoder (raw/<id>.panel.json holds
 * where), not taken as a second screenshot: the wizard moves on by itself, and a second picture a
 * moment later showed the next step.
 */
async function snap(page: Page, id: string, clip?: Clip, extra: Record<string, unknown> = {}): Promise<void> {
    if (!want(id)) return;
    await frames(page);
    const spec = PANEL[id];
    const pc = spec ? await panelClip(page, spec) : undefined;
    if (spec && !pc) throw new Error(`${id}: nothing matches the panel selector ${spec.sel}`);
    const path = join(RAW, `${id}.png`);
    await page.screenshot({ path, clip });
    const vis = await page.evaluate('document.visibilityState');
    const dpr = (await page.evaluate('devicePixelRatio')) as number;
    const data: Record<string, unknown> = { raw: path.slice(REPO.length + 1), clip: clip ?? 'viewport', visibility: vis, ...extra };
    const sidecar = join(RAW, `${id}.panel.json`);
    if (pc) {
        // in raw pixels of the capture above (which may itself be a clip of the viewport)
        const ox = clip?.x ?? 0, oy = clip?.y ?? 0;
        const W = (clip?.width ?? DESKTOP.width) * dpr, H = (clip?.height ?? DESKTOP.height) * dpr;
        const x = Math.max(0, Math.round((pc.x - ox) * dpr)), y = Math.max(0, Math.round((pc.y - oy) * dpr));
        const crop = { x, y, width: Math.min(W - x, Math.round(pc.width * dpr)), height: Math.min(H - y, Math.round(pc.height * dpr)) };
        writeFileSync(sidecar, JSON.stringify({ css: pc, dpr, crop }));
        data.panel = pc;
    } else if (existsSync(sidecar)) rmSync(sidecar);
    note(id, data);
}

async function context(browser: Browser, device: Device): Promise<BrowserContext> {
    const ctx = await browser.newContext(device === 'desktop'
        ? { viewport: DESKTOP, deviceScaleFactor: 2, locale: 'en-US' }
        : { viewport: MOBILE, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'en-US' });
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
    await page.waitForTimeout(600);
}
async function escape(page: Page): Promise<void> {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
}
/** The voxel grid through the test hook, then wait until every chunk in range is built. */
async function voxels(page: Page, mode: 'off' | 'overlay' | 'only', style: string, opacity: number): Promise<Any> {
    await hook(page, `const v = h.voxels; v.setStyle(${JSON.stringify(style)}); v.setMode(${JSON.stringify(mode)}); v.setOpacity(${opacity}); return 0;`);
    if (mode !== 'off') await until(page, 'return h.voxels.settled();', (v) => v === true, 120000, 250);
    await page.waitForTimeout(900);
    await frames(page);
    return hook(page, 'const st = h.voxels.stats(); return { mode: st.mode, style: st.style, chunks: st.chunks, quads: st.quads, floaters: st.floaters, radiusM: st.radiusM && +st.radiusM.toFixed(1) };');
}
/** Camera up and back from the spawn, looking at the scan's own target (as far as free air allows). */
async function highView(page: Page, up = 0.7, back = 1.5, lookDown = 0.3): Promise<void> {
    await hook(page, `const c = s.scene.camera; const p = s.spawn;
        const t = c ? c.target : [p[0] + 1, p[1], p[2]];
        const dx = p[0] - t[0], dz = p[2] - t[2], l = Math.hypot(dx, dz) || 1;
        const col = s.collision; const push = { x: 0, y: 0, z: 0 };
        let f = 1;
        for (; f > 0.05; f *= 0.7) { const q = [p[0] + (dx / l) * ${back} * f, p[1] + ${up} * f, p[2] + (dz / l) * ${back} * f]; if (!col || !col.querySphere(q[0], q[1], q[2], 0.15, push)) break; }
        s.cameraOverride = true;
        s.renderer.setCameraLookAt(p[0] + (dx / l) * ${back} * f, p[1] + ${up} * f, p[2] + (dz / l) * ${back} * f, t[0], t[1] - ${lookDown}, t[2]);
        return 0;`);
    await page.waitForTimeout(400);
}

/** Camera `up` m above the spawn, turned `yawDeg` (0 = -z, 90 = +x) and pitched `pitchDeg` (up > 0). */
async function lookFrom(page: Page, up: number, yawDeg: number, pitchDeg: number): Promise<void> {
    await hook(page, `const p = s.spawn; const a = ${yawDeg} * Math.PI / 180, e = ${pitchDeg} * Math.PI / 180;
        const x = p[0], y = p[1] + ${up}, z = p[2];
        s.cameraOverride = true;
        s.renderer.setCameraLookAt(x, y, z, x + Math.sin(a) * Math.cos(e), y + Math.sin(e), z - Math.cos(a) * Math.cos(e));
        return 0;`);
    await page.waitForTimeout(400);
}

// ------------------------------------------------------------------ flows
const flows: Record<string, (b: Browser) => Promise<void>> = {
    async picker(b) {
        const ctx = await context(b, 'desktop');
        const page = await open(ctx);
        await page.goto(fly(`nowarn=1&${DESK_Q}`));
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
        await page.goto(fly(`scene=887f27aa&input=touch&refine=off&${DESK_Q}`));
        const st = await until(page, 'return h && h.loading ? h.loading : null;', (v) => !!v && v.fraction >= 0.3 && v.elapsedMs >= 6000, 180000, 200);
        await page.waitForTimeout(300);
        await snap(page, 'loading', await clip16x9(page, '.loading > *', 60, 1100));
        note('loading', { progress: st });
        await ctx.close();
    },

    async wizard(b) {
        const ctx = await context(b, 'desktop');
        const page = await open(ctx);
        await page.goto(fly(`scene=39e63ce9&simradio=raw&nobuttons=1&${DESK_Q}`));
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
        // a fresh visitor on Tunis: the Controls screen first, then the keyboard
        const ctx = await context(b, 'desktop');
        const page = await open(ctx);
        await page.goto(fly(`scene=887f27aa&refine=offer&${DESK_Q}`));
        await ready(page);
        await page.click('[data-action="radio-keyboard"]');
        await page.locator('.key-card:not(.hidden)').waitFor({ timeout: 10000 });
        await until(page, 'return h.walls ? h.walls.state : null;', (v) => v === 'offer' || v === 'none' || v === 'refused', 60000, 250);
        await page.waitForTimeout(2500);
        await snap(page, 'keys');
        await ctx.close();
    },

    async tunis(b) {
        const ctx = await context(b, 'desktop');
        const page = await open(ctx);
        await page.goto(fly(`scene=887f27aa&simradio=scenario&tour=1&${DESK_Q}`));
        await ready(page);
        const f = await freezeWhen(page, FREEZE.tunis);
        await snap(page, 'flight-tunis', undefined, { frozen: f });
        await menu(page, 'pause.settings');
        await page.click('.panel details > summary');
        await page.waitForTimeout(400);
        await snap(page, 'settings');
        await escape(page);
        await unfreeze(page);
        // the tour's last leg is a dash into a wall: the wreck and its debris (Rapier), the crash card
        const crash = await crashFrozen(page);
        await snap(page, 'crash');
        note('crash', { speed: crash?.speed, debris: crash?.debris, engine: crash?.engine });
        await restoreClock(page);
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
        await page.goto(fly(`scene=39e63ce9&simradio=scenario&${DESK_Q}`));
        await ready(page);
        const f = await freezeWhen(page, FREEZE.villa);
        await snap(page, 'flight-villa', undefined, { frozen: f });
        await menu(page, 'pause.measure');
        await page.waitForTimeout(800);
        await snap(page, 'measure');
        await escape(page);
        await menu(page, 'pause.import');
        await page.fill('.import-text', readFileSync(join(REPO, 'packages', 'sim-core', 'test', 'fixtures', 'bf-diff-4.5.1.txt'), 'utf8'));
        await page.click('[data-action="import-apply"]');
        await page.locator('.import-out p').waitFor();
        await page.waitForTimeout(400);
        await snap(page, 'betaflight');
        await ctx.close();
    },

    async garden(b) {
        // the bot flies the Winter Garden: the menus over a slow moment, the flight picture in its dash
        const ctx = await context(b, 'desktop');
        const page = await open(ctx);
        await page.goto(fly(`scene=7a475d38&simradio=scenario&tour=1&${DESK_Q}`));
        await ready(page);
        const m = await freezeWhen(page, FREEZE.gardenMenus);
        note('garden-menus', { frozen: m });
        await page.keyboard.press('KeyP');
        await page.locator('.pause-menu').waitFor();
        await page.waitForTimeout(500);
        await snap(page, 'pause');
        await escape(page);
        await menu(page, 'pause.drone');
        await imagesLoaded(page);
        await page.waitForTimeout(600);
        await snap(page, 'drones');
        await escape(page);
        await unfreeze(page);
        const f = await freezeWhen(page, FREEZE.garden);
        await snap(page, 'flight-garden', undefined, { frozen: f });
        await ctx.close();
    },

    async cinema(b) {
        // cinema mode on Tunis, at another moment and heading of the tour than the flight picture
        const ctx = await context(b, 'desktop');
        const page = await open(ctx);
        await page.goto(fly(`scene=887f27aa&simradio=scenario&tour=1&${DESK_Q}`));
        await ready(page);
        const f = await freezeWhen(page, FREEZE.cinema);
        await menu(page, 'pause.cinema');
        await page.waitForTimeout(3000); // full detail streams in
        await snap(page, 'cinema', undefined, { frozen: f });
        await ctx.close();
    },

    async vtunis(b) {
        // the voxel grid over Tunis in height colours, from the pilot's own camera
        const ctx = await context(b, 'desktop');
        const page = await open(ctx);
        await page.goto(fly(`scene=887f27aa&simradio=scenario&${DESK_Q}`));
        await ready(page);
        await freezeWhen(page, FREEZE.hover);
        await page.waitForTimeout(4000); // detail streams in around the spawn
        const a = await voxels(page, 'overlay', 'height', 0.6);
        await snap(page, 'voxels', undefined, { voxels: a });
        await ctx.close();
    },

    async vgarden(b) {
        // the Winter Garden: its 3.2 cm walls as a wireframe over the scan; the pieces that touch
        // nothing (floaters) in red where the plants are; then the walls switched off (C) and the
        // walls menu on the credit line open
        const ctx = await context(b, 'desktop');
        const page = await open(ctx);
        await page.goto(fly(`scene=7a475d38&simradio=scenario&${DESK_Q}`));
        await ready(page);
        await freezeWhen(page, FREEZE.hover);
        await page.waitForTimeout(4000);
        await highView(page, 0.6, 1.4, 0.25);
        const a = await voxels(page, 'overlay', 'wire', 0.55);
        await snap(page, 'voxels-wire', undefined, { voxels: a });
        // looking into the plants, where the scan's loose splats make small floating pieces
        await lookFrom(page, 0.3, 90, -15);
        const c = await voxels(page, 'overlay', 'floaters', 0.7);
        await snap(page, 'voxels-floaters', undefined, { voxels: c });
        await voxels(page, 'off', 'wire', 0.55);
        await hook(page, 's.cameraOverride = false; return 0;');
        await page.keyboard.press('KeyC');
        await page.waitForTimeout(600);
        await page.click('[data-testid="walls-summary"]');
        await page.waitForTimeout(900);
        const w = await hook(page, 'const b = document.querySelector("[data-testid=walls-summary]"); return { summary: b && b.textContent, walls: h.wallsSwitch ? h.wallsSwitch.state() : null };');
        await snap(page, 'walls', undefined, { walls: w });
        await ctx.close();
    },

    async vvilla(b) {
        // Modlinek Villa as voxels only: the scan hidden, the walls you fly between as solid cubes
        const ctx = await context(b, 'desktop');
        const page = await open(ctx);
        await page.goto(fly(`scene=39e63ce9&simradio=scenario&${DESK_Q}`));
        await ready(page);
        await freezeWhen(page, FREEZE.hover);
        await page.waitForTimeout(2000);
        await highView(page);
        const a = await voxels(page, 'only', 'solid', 1);
        await snap(page, 'voxels-only', undefined, { voxels: a });
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
        const f = await freezeWhen(page, FREEZE.mobile);
        await snap(page, 'm-flight', undefined, { frozen: f });
        await unfreeze(page);
        await crashFrozen(page);
        await snap(page, 'm-crash');
        await restoreClock(page);
        await ctx.close();
    }
};

// ------------------------------------------------------------------ encode
interface Variant { src: string; w: number; h: number; bytes: number; quality: number }
interface Encoded { id: string; device: Device; raw: { w: number; h: number }; large: Variant; small: Variant; panel?: { raw: { w: number; h: number }; large: Variant; small: Variant } }

/** One PNG -> two WebP sizes (<= 1600 and <= 800 px wide) in Chrome's own encoder: the best quality under each byte cap. */
async function encodeOne(page: Page, raw: string, name: string, crop?: Clip): Promise<{ raw: { w: number; h: number }; large: Variant; small: Variant }> {
    const r = await page.evaluate(`(async () => {
        const blob0 = await (await fetch(${JSON.stringify(`http://screens.local/raw/${raw.split(/[\\/]/).pop()}`)})).blob();
        const crop = ${JSON.stringify(crop ?? null)};
        const bmp = crop ? await createImageBitmap(blob0, crop.x, crop.y, crop.width, crop.height) : await createImageBitmap(blob0);
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
        const file = `${name}-${v.w}.webp`;
        writeFileSync(join(SITE_SHOTS, file), Buffer.from(v.b64, 'base64'));
        return { src: `/shots/${file}`, w: v.w, h: v.h, bytes: v.size, quality: v.q };
    };
    return { raw: { w: r.W, h: r.H }, large: write(r.large), small: write(r.small) };
}

async function encodeAll(b: Browser): Promise<Encoded[]> {
    mkdirSync(SITE_SHOTS, { recursive: true });
    mkdirSync(DOC_SHOTS, { recursive: true });
    const ctx = await b.newContext();
    // the raw PNGs are handed to the page from disk (a 3840 px PNG is too big to inline)
    await ctx.route('http://screens.local/**', async (route) => {
        const u = new URL(route.request().url());
        if (u.pathname.startsWith('/raw/')) await route.fulfill({ path: join(RAW, decodeURIComponent(u.pathname.slice(5))), contentType: 'image/png' });
        else await route.fulfill({ body: '<!doctype html><title>encode</title>', contentType: 'text/html' });
    });
    const page = await ctx.newPage();
    await page.goto('http://screens.local/');
    const out: Encoded[] = [];
    for (const s of SHOTS) {
        const raw = join(RAW, `${s.id}.png`);
        if (!existsSync(raw)) continue;
        const full = await encodeOne(page, raw, s.id);
        const e: Encoded = { id: s.id, device: s.device, ...full };
        copyFileSync(join(SITE_SHOTS, `${s.id}-${e.large.w}.webp`), join(DOC_SHOTS, `${s.id}.webp`));
        const side = join(RAW, `${s.id}.panel.json`);
        if (PANEL[s.id] && existsSync(side)) {
            e.panel = await encodeOne(page, raw, `${s.id}-panel`, (JSON.parse(readFileSync(side, 'utf8')) as { crop: Clip }).crop);
            copyFileSync(join(SITE_SHOTS, `${s.id}-panel-${e.panel.large.w}.webp`), join(DOC_SHOTS, `${s.id}-panel.webp`));
        }
        out.push(e);
        const kb = (v: Variant) => `${v.w}px ${(v.bytes / 1024).toFixed(0)} KB q${v.quality}`;
        console.log(`encoded ${s.id}: ${e.raw.w}x${e.raw.h} -> ${kb(e.large)}, ${kb(e.small)}${e.panel ? `; panel ${e.panel.raw.w}x${e.panel.raw.h} -> ${kb(e.panel.large)}, ${kb(e.panel.small)}` : ''}`);
    }
    await ctx.close();
    // files of shots that are gone (renamed or dropped) must not linger on the site
    const keep = new Set(out.flatMap((e) => [e.large, e.small, ...(e.panel ? [e.panel.large, e.panel.small] : [])].map((v) => v.src.slice(7))));
    for (const f of readdirSync(SITE_SHOTS)) if (f.endsWith('.webp') && !keep.has(f)) rmSync(join(SITE_SHOTS, f));
    const keepDoc = new Set(out.flatMap((e) => [`${e.id}.webp`, ...(e.panel ? [`${e.id}-panel.webp`] : [])]));
    for (const f of readdirSync(DOC_SHOTS)) if (f.endsWith('.webp') && !keepDoc.has(f)) rmSync(join(DOC_SHOTS, f));
    return out;
}

/** docs/screenshots/README.md: every shot with its English caption (from the site dictionary). */
function writeDocsIndex(encoded: Encoded[], shotAt: string, release: Record<string, unknown> | null): void {
    const en = JSON.parse(readFileSync(join(REPO, 'packages', 'i18n', 'locales', 'site', 'en.json'), 'utf8')) as { shots?: { items?: Record<string, { t: string; d: string }> } };
    const cap = (id: string) => en.shots?.items?.[id] ?? { t: id, d: '' };
    // the tile is the menu itself when there is a crop of it; the link opens the whole screen
    const cell = (e: Encoded) => `<td width="50%" valign="top"><a href="${e.id}.webp"><img src="${e.panel ? `${e.id}-panel` : e.id}.webp" alt="${cap(e.id).t}"${e.device === 'mobile' ? ' width="260"' : ''}></a><br><sub><b>${cap(e.id).t}</b> — ${cap(e.id).d}${e.panel ? ` <a href="${e.id}.webp">Whole screen</a>.` : ''}</sub></td>`;
    const table = (list: Encoded[]) => {
        const out: string[] = [];
        for (let i = 0; i < list.length; i += 2) out.push(['<tr>', ...list.slice(i, i + 2).map(cell), '</tr>'].join('\n'));
        return ['<table>', ...out, '</table>'].join('\n');
    };
    const desk = encoded.filter((e) => e.device === 'desktop');
    const phone = encoded.filter((e) => e.device === 'mobile');
    const sha = release?.sha ? String(release.sha) : '';
    const where = LOCAL_BUILD
        ? `Real screenshots of the simulator, taken on ${shotAt} from a production build of commit \`${sha}\`, the release deployed to https://gsfpv.flyreelstudio.eu with these pictures,`
        : `Real screenshots of the live simulator at https://gsfpv.flyreelstudio.eu, taken on ${shotAt}${sha ? ` (the release built from commit \`${sha}\`)` : ''}`;
    const md = [
        '# ShramkoGSFPV screenshots',
        '',
        `${where} by [\`tools/bench/src/screens.ts\`](../../tools/bench/src/screens.ts) in system Chrome (desktop 1920×1080 at device scale 2, phone-sized 390×844). The same files are on the [landing page](https://gsfpv.flyreelstudio.eu/en/#gallery) with captions in four languages. To take them again after a release: \`npx tsx tools/bench/src/screens.ts\`.`,
        '',
        "Each menu has two files: `<name>-panel.webp` is the menu itself with a little of the scene around it (sharp enough to read), `<name>.webp` the whole screen. The calibration screens use the simulator's built-in simulated EdgeTX radio (`?simradio=raw`) and the flights are flown by its test pilot (`?simradio=scenario`), frozen while it is really flying, so the same screens can be taken again the same way after a release. This file is written by the same script.",
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

async function releaseInfo(): Promise<Record<string, unknown> | null> {
    if (LOCAL_BUILD) {
        const sha = execSync(`git -C "${REPO}" rev-parse --short HEAD`, { encoding: 'utf8' }).trim();
        return { sha, built: new Date().toISOString(), from: 'local production build (vite build + vite preview)' };
    }
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
    const release = await releaseInfo();
    const prev = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : null;
    const manifest = {
        note: 'written by tools/bench/src/screens.ts: real screenshots of the simulator (whole screen + "panel", the menu itself); captions in packages/i18n/locales/site/*.json under shots.items',
        site: SITE,
        fly: FLY,
        shotAt: process.env.ENCODE_ONLY && prev?.shotAt ? prev.shotAt : new Date().toISOString().slice(0, 10),
        release: process.env.ENCODE_ONLY && prev?.release ? prev.release : release,
        items: encoded
    };
    writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
    writeDocsIndex(encoded, manifest.shotAt, manifest.release as Record<string, unknown> | null);
    writeFileSync(join(REPO, '.cache', 'screens', 'report.json'), JSON.stringify({ site: SITE, fly: FLY, release, report }, null, 2));
    const failed = report.filter((r) => 'error' in r);
    console.log(`\nshots: ${encoded.length} encoded; flow errors: ${failed.length}${failed.length ? ' ' + failed.map((f) => f.id).join(', ') : ''}`);
    if (failed.length) process.exitCode = 1;
} finally {
    await browser.close();
}
