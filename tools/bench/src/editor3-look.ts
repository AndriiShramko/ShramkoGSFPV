// Lane editor3, stage H2-look: the edit view's look on a LOCAL release (docs/wip/editor3.md). With the keyboard as the
// input: a course made in the tab (Shift+G, never saved), the mode (Shift+B), Tab selects a gate. Read: the rectangles of
// the top bar, the gate bar, the 'Course editor' window and each flight window (osd-stats, arm-card, course-hud) with their
// display; overlaps; the smallest button of each bar; a Size drag by the x box and by the centre box (opening, position,
// turn before and after, the tag beside the handle, the top bar's line); a test flight (Space, W held, Space) and the windows
// right after its disarm; Exit. Pictures in U:/Temp/gsfpv-train3/shots. Never presses save, send or create. Env: SITE,
// SCENE (887f27aa), OUT. Run under the GPU lock.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { launchChrome } from './browser';

const SITE = (process.env.SITE ?? 'http://localhost:5801').replace(/\/$/, '');
const SCENE = process.env.SCENE ?? '887f27aa';
const OUT = process.env.OUT ?? 'U:/Temp/gsfpv-train3/editor3/h2';
const SHOTS = 'U:/Temp/gsfpv-train3/shots';
const TAG = SCENE === '887f27aa' ? '' : `-${SCENE}`;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
type Dbg = { stand: { pos: number[]; quat: number[]; opening: number; screen: number[] }; axes: { x: number[] }; mode?: string; tag?: string | null; scale3?: number[] };
type W = { __gsfpv?: { status?: string; course?: { gates?: number; on?: boolean; editor?: { open?: boolean; said?: string } } }; __gsfpvEditView?: () => unknown; __gsfpvEditHit?: (x: number, y: number) => string[] | null };
const dbg = (p: Page): Promise<Dbg | null> => p.evaluate(() => ((window as unknown as W).__gsfpvEditView?.() ?? null) as Dbg | null);
const r2 = (x: number): number => Math.round(x * 100) / 100;
type PadW = { __pad?: { set(a: number[] | null, b: number | null): void }; __gsfpv?: { controls?: { source?: string; gate?: { armed?: boolean } }; radio?: { wizard?: { state?: { id?: string } } } } };
const pad = (p: Page, axes: number[] | null, buttons?: number | null): Promise<void> => p.evaluate(([a, b]) => (window as unknown as PadW).__pad?.set(a as number[] | null, b as number | null), [axes, buttons ?? null] as const);
const armedNow = (p: Page): Promise<boolean | null> => p.evaluate(() => (window as unknown as PadW).__gsfpv?.controls?.gate?.armed ?? null);
/** the fake DJI pad of editor3-prove.ts (as known-controller-probe.mjs), put in the page before load */
function install(): void {
    const s = { axes: [0, 0, -1, 0, 0], buttons: 0x50, ts: performance.now(), present: false };
    (window as unknown as { __pad: unknown }).__pad = { set(a: number[] | null, b: number | null) { if (a) s.axes = a.slice(); if (b !== undefined && b !== null) s.buttons = b; s.ts = performance.now(); s.present = true; } };
    const buttons = Array.from({ length: 24 }, (_, i) => ({ get pressed() { return ((s.buttons >> i) & 1) === 1; }, get value() { return (s.buttons >> i) & 1; }, touched: false }));
    const padObj = { id: 'HID Interface (Vendor: 2ca3 Product: 1021)', index: 0, connected: true, mapping: '', vibrationActuator: null, get axes() { return s.axes.slice(0, 5); }, buttons, get timestamp() { return s.ts; } };
    Object.defineProperty(Navigator.prototype, 'getGamepads', { value: () => [s.present ? padObj : null, null, null, null], configurable: true });
}
const dist = (a?: number[], b?: number[]): number => (a && b ? r2(Math.hypot(...a.map((v, i) => v - (b[i] ?? 0)))) : -1);

async function until<T>(get: () => Promise<T>, ok: (v: T) => boolean, ms: number): Promise<T> {
    const t0 = Date.now();
    let v = await get();
    while (!ok(v) && Date.now() - t0 < ms) { await sleep(300); v = await get(); }
    return v;
}

/** each element's display and rectangle, overlaps of the three edit parts with each other and with the selected gate's
 * handle area (a 160 px square round its centre: an estimate of the handles' reach), the smallest button of each bar */
const layout = (p: Page): Promise<Record<string, unknown>> => p.evaluate(() => {
    const sel = ['.ce-topbar', '.ce-gatebar', '.course-editor', '.osd-stats', '.arm-card', '.course-hud', '.hud-note', '.gate-msg', '.top-actions'];
    const box = (e: Element | null): number[] | null => { if (!e) return null; const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)]; };
    const els: Record<string, unknown> = {};
    for (const s of sel) { const e = document.querySelector(s); els[s] = e ? { display: getComputedStyle(e).display, vis: getComputedStyle(e).visibility, rect: box(e) } : 'absent'; }
    const f = (window as unknown as { __gsfpvEditView?: () => { stand?: { screen?: number[] } } | null }).__gsfpvEditView?.();
    const g = f?.stand?.screen;
    const rects: Record<string, number[] | null> = { top: box(document.querySelector('.ce-topbar')), bar: box(document.querySelector('.ce-gatebar')), win: box(document.querySelector('.course-editor')), handles: g ? [g[0]! - 80, g[1]! - 80, g[0]! + 80, g[1]! + 80] : null };
    const over = (a: number[] | null, b: number[] | null): boolean => !!a && !!b && a[0]! < b[2]! && b[0]! < a[2]! && a[1]! < b[3]! && b[1]! < a[3]!;
    const names = Object.keys(rects);
    const overlaps: string[] = [];
    for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) if (over(rects[names[i]!]!, rects[names[j]!]!)) overlaps.push(`${names[i]}~${names[j]}`);
    const minBtn = (s: string): number[] => { const b = [...document.querySelectorAll(s)].filter((e) => (e as HTMLElement).offsetParent).map((e) => e.getBoundingClientRect()); return b.length ? [Math.round(Math.min(...b.map((r) => r.width))), Math.round(Math.min(...b.map((r) => r.height))), b.length] : []; };
    const inView = (r: number[] | null): boolean => !!r && r[0]! >= 0 && r[1]! >= 0 && r[2]! <= innerWidth && r[3]! <= innerHeight;
    // pass 2: what else of the page each edit part covers (visible leaf text and buttons outside the three parts)
    const parts = ['.ce-topbar', '.ce-gatebar', '.course-editor'];
    const leaves = [...document.querySelectorAll('#ui *, body > *')].filter((e) => {
        if (parts.some((q) => e.closest(q)) || e.closest('.ce-size-tag')) return false;
        const st = getComputedStyle(e);
        if (st.display === 'none' || st.visibility === 'hidden' || !(e as HTMLElement).getClientRects().length) return false;
        const own = [...e.childNodes].some((c) => c.nodeType === 3 && (c.textContent ?? '').trim() !== '');
        return own || e.tagName === 'BUTTON' || e.tagName === 'A';
    });
    const covers: Record<string, string[]> = {};
    for (const q of parts) {
        const pr = box(document.querySelector(q));
        covers[q] = leaves.filter((e) => over(pr, box(e))).map((e) => `${e.tagName.toLowerCase()}.${String((e as HTMLElement).className)}:${(e.textContent ?? '').trim().slice(0, 30)}@${box(e)!.join(',')}`).slice(0, 12);
    }
    return { els, rects, overlaps, covers, topBtn: minBtn('.ce-topbar .ce-tb'), barBtn: minBtn('.ce-gatebar .ce-gb'), inView: { top: inView(rects.top!), bar: inView(rects.bar!) } };
});

async function open(page: Page, out: Record<string, unknown>, usePad = false): Promise<boolean> {
    await page.goto(`${SITE}/en/fly/?scene=${SCENE}&nowarn=1`);
    const st = await until(() => page.evaluate(() => (window as unknown as W).__gsfpv?.status ?? null), (v) => v === 'ready' || v === 'error', 240000);
    if (st !== 'ready') { out.status = st; return false; }
    if (usePad) {
        // as editor3-prove.ts prepare(): the pad is seen, the wizard's check, done
        await page.waitForSelector('.screen.radio .choice', { timeout: 20000 }).catch(() => undefined);
        await pad(page, [0, 0, 0.3, 0, 0], 0x50);
        await until(() => page.evaluate(() => (window as unknown as PadW).__gsfpv?.radio?.wizard?.state?.id ?? null), (v) => v === 'check', 8000);
        await pad(page, [0, 0, -1, 0, 0], 0x50);
        await page.locator('[data-action=wizard-done]').click({ timeout: 8000 }).catch(() => undefined);
        out.source = await until(() => page.evaluate(() => (window as unknown as PadW).__gsfpv?.controls?.source ?? null), (v) => v === 'gamepad', 15000);
    } else {
        await page.waitForSelector('.screen.radio [data-action="radio-keyboard"]', { timeout: 20000 }).catch(() => undefined);
        await page.click('.screen.radio [data-action="radio-keyboard"]', { timeout: 5000 }).catch(() => undefined);
    }
    await sleep(1500);
    await page.keyboard.press('Shift+KeyG');
    const c = await until(() => page.evaluate(() => (window as unknown as W).__gsfpv?.course ?? null), (h) => (h?.gates ?? 0) > 0 && !!h?.on, 150000);
    out.gates = c?.gates;
    if (!c?.gates) return false;
    await page.keyboard.press('Shift+KeyB');
    await until(() => page.evaluate(() => (window as unknown as W).__gsfpv?.course?.editor?.open ?? false), (v) => v, 30000);
    await sleep(1200);
    await page.keyboard.press('Tab');
    await sleep(1500);
    return true;
}

/** walk out from the gate's centre until the Size tool's shape `want` is under the point; drag it by (dx, dy) */
async function sizeDrag(page: Page, dir: number[], min: number, want: string, d: number, shot: string | null): Promise<Record<string, unknown>> {
    const a = (await dbg(page))!;
    const w = await page.evaluate(([f, dv, m, wa]) => {
        const h = (window as unknown as W).__gsfpvEditHit;
        const n = Math.hypot(dv[0]!, dv[1]!) || 1;
        for (let r = m; r <= 450; r += 4) { const x = f[0]! + (dv[0]! / n) * r; const y = f[1]! + (dv[1]! / n) * r; const hit = h?.(x, y); if (hit && hit[1] === wa) return { r, x, y, hit }; }
        return null;
    }, [a.stand.screen, dir, min, want] as const);
    if (!w) return { want, hit: null };
    const n = Math.hypot(dir[0]!, dir[1]!) || 1;
    await page.mouse.move(w.x, w.y);
    await sleep(150);
    await page.mouse.down();
    await page.mouse.move(w.x + (dir[0]! / n) * d, w.y + (dir[1]! / n) * d, { steps: 12 });
    await sleep(200);
    const mid = await dbg(page);
    if (shot) await page.screenshot({ path: join(SHOTS, shot) });
    await page.mouse.up();
    await sleep(900);
    const b = (await dbg(page))!;
    const line = await page.evaluate(() => document.querySelector('.ce-tb-line')?.textContent ?? '');
    return { want, r: w.r, hit: w.hit, opening: [r2(a.stand.opening), r2(b.stand.opening)], movedM: dist(a.stand.pos, b.stand.pos), turned: dist(a.stand.quat, b.stand.quat), tagMid: mid?.tag ?? null, scaleMid: mid?.scale3?.map(r2), tagAfter: b.tag ?? null, line };
}

async function desk(page: Page): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {};
    if (!(await open(page, out, true))) return out;
    out.edit = await layout(page);
    await page.screenshot({ path: join(SHOTS, `editor3-edit-clean-1920${TAG}.png`) });
    await page.keyboard.press('KeyT');
    await sleep(500);
    const ax = (await dbg(page))!.axes.x;
    out.sizeX = await sizeDrag(page, ax, 10, 'x', 50, `editor3-size-1920${TAG}.png`);
    out.sizeCentre = await sizeDrag(page, [0.71, -0.71], 0, 'xyz', 40, null);
    // the test flight inside the mode with the pad (pass 2: the keyboard's Space did not start it): arm on button 2, the
    // sticks out of the centre start the camera drone, up for 1.5 s and hover 3.5 s (airtime over summary-stats.ts
    // CARD_MIN_AIRTIME_S 3), then disarm on button 2
    await pad(page, [0, 0, -1, 0, 0], 0x50);
    await sleep(300);
    await pad(page, null, 0x50 | (1 << 2));
    await sleep(150);
    await pad(page, null, 0x50);
    const armed = await until(() => armedNow(page), (v) => v === true, 2000);
    await pad(page, [0, 0, 0.1, 0, 0], null);
    const fm = await until(() => dbg(page), (d) => d?.mode === 'fly', 3000);
    await pad(page, [0, 0, 0.5, 0, 0], null);
    await sleep(1500);
    await pad(page, [0, 0, 0, 0, 0], null);
    await sleep(3500);
    out.flying = { armed, mode: fm?.mode, ...(await layout(page)) };
    await pad(page, [0, 0, -1, 0, 0], 0x50);
    await sleep(300);
    await pad(page, null, 0x50 | (1 << 2));
    await sleep(150);
    await pad(page, null, 0x50);
    let dis = await until(() => dbg(page), (d) => d?.mode === 'edit', 6000);
    if (dis?.mode !== 'edit') { await page.keyboard.press('Space'); dis = await until(() => dbg(page), (d) => d?.mode === 'edit', 4000); }
    await sleep(1500);
    out.afterFlight = { mode: dis?.mode, armed: await armedNow(page), ...(await layout(page)) };
    await page.screenshot({ path: join(SHOTS, `editor3-after-flight-1920${TAG}.png`) });
    await page.keyboard.press('Escape');
    await sleep(500);
    if (await page.evaluate(() => (window as unknown as W).__gsfpv?.course?.editor?.open ?? false)) await page.keyboard.press('Escape');
    await sleep(800);
    out.afterExit = { open: await page.evaluate(() => (window as unknown as W).__gsfpv?.course?.editor?.open ?? false), ...(await layout(page)) };
    return out;
}

async function phone(page: Page): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {};
    if (!(await open(page, out))) return out;
    out.edit = await layout(page);
    await page.screenshot({ path: join(SHOTS, `editor3-844${TAG}.png`) });
    return out;
}

async function main(): Promise<void> {
    mkdirSync(OUT, { recursive: true });
    mkdirSync(SHOTS, { recursive: true });
    const log: string[] = [];
    const out: Record<string, unknown> = { site: SITE, scene: SCENE, date: new Date().toISOString() };
    const { browser, which } = await launchChrome({ args: ['--window-size=1936,1200'] });
    out.browser = which;
    const run = async (name: string, vp: { width: number; height: number }, f: (p: Page) => Promise<Record<string, unknown>>): Promise<void> => {
        const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1 });
        // tsx wraps named inner functions in __name(); a 'var' in an init script stays local to Playwright's wrapper
        await ctx.addInitScript({ content: `globalThis.__name = (f) => f; (${install.toString()})();` });
        const page = await ctx.newPage();
        page.on('pageerror', (e) => log.push(`${name} pageerror: ${e.message}`.slice(0, 300)));
        try { out[name] = await f(page); } catch (e) { out[name] = { error: String(e).slice(0, 400) }; }
        await ctx.close();
        writeFileSync(join(OUT, `look${TAG}.json`), JSON.stringify({ ...out, log }, null, 1));
    };
    try {
        await run('desk', { width: 1920, height: 1080 }, desk);
        await run('phone', { width: 844, height: 390 }, phone);
    } finally {
        await browser.close();
    }
    console.log(`wrote ${join(OUT, `look${TAG}.json`)}`);
}

void main().catch((e) => { console.error(e); process.exit(1); });
