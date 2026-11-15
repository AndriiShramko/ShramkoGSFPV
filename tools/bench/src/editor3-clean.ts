// Lane editor3, stage I2-clean (docs/wip/editor3.md): what of the flight is drawn in the edit view (D5), the top bar's line
// (D6), the phone (D7) and the keyboard test flight (D8), on a LOCAL release. A course made in the tab (Shift+G, never
// saved), the mode (Shift+B), Tab selects a gate. Per state (edit, flying in the mode, after the disarm, after a crash,
// after Exit) a table of the flight's parts (shown or not), the top bar's rectangle and its line count, and what the top
// bar covers. A refused Save (Ctrl+S; the local server keeps nothing) read at 1 s and 10.5 s and after the next key. The
// keyboard run: the selected gate put 6 m ahead of the drone (__gsfpvEditPutAhead), Space, keys, Space; per step the OSD's
// THR, speed and ALT line and the drone's height. Env: SITE, SCENE (887f27aa), OUT, PARTS (desk,phone,kbd). Run under the
// GPU lock. Never presses send or create; Save only on the local server.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { launchChrome } from './browser';

const SITE = (process.env.SITE ?? 'http://localhost:5801').replace(/\/$/, '');
const SCENE = process.env.SCENE ?? '887f27aa';
const OUT = process.env.OUT ?? 'U:/Temp/gsfpv-train3/editor3/i2';
const SHOTS = 'U:/Temp/gsfpv-train3/shots';
const PARTS = (process.env.PARTS ?? 'desk,phone,kbd').split(',');
const SHOT = process.env.SHOT !== '0';
const TAG = SCENE === '887f27aa' ? '' : `-${SCENE}`;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
type Dbg = { mode?: string; gates?: number[][]; selected?: number; crashActive?: boolean; drone?: number[]; stand?: { screen?: number[] } };
type W = { __gsfpv?: { status?: string; course?: { gates?: number; on?: boolean; next?: number; editor?: { open?: boolean } }; controls?: { source?: string; gate?: { armed?: boolean } } }; __gsfpvEditView?: () => unknown; __gsfpvEditPutAhead?: (m: number, up: number, open: number) => unknown };
const dbg = (p: Page): Promise<Dbg | null> => p.evaluate(() => ((window as unknown as W).__gsfpvEditView?.() ?? null) as Dbg | null);
const course = (p: Page): Promise<{ next?: number; editor?: { open?: boolean } } | null> => p.evaluate(() => (window as unknown as W).__gsfpv?.course ?? null);
type PadW = { __pad?: { set(a: number[] | null, b: number | null): void } };
const pad = (p: Page, axes: number[] | null, buttons?: number | null): Promise<void> => p.evaluate(([a, b]) => (window as unknown as PadW).__pad?.set(a as number[] | null, b as number | null), [axes, buttons ?? null] as const);
const armedNow = (p: Page): Promise<boolean | null> => p.evaluate(() => (window as unknown as W).__gsfpv?.controls?.gate?.armed ?? null);
/** the fake DJI pad of editor3-look.ts, put in the page before load */
function install(): void {
    const s = { axes: [0, 0, -1, 0, 0], buttons: 0x50, ts: performance.now(), present: false };
    (window as unknown as { __pad: unknown }).__pad = { set(a: number[] | null, b: number | null) { if (a) s.axes = a.slice(); if (b !== undefined && b !== null) s.buttons = b; s.ts = performance.now(); s.present = true; } };
    const buttons = Array.from({ length: 24 }, (_, i) => ({ get pressed() { return ((s.buttons >> i) & 1) === 1; }, get value() { return (s.buttons >> i) & 1; }, touched: false }));
    const padObj = { id: 'HID Interface (Vendor: 2ca3 Product: 1021)', index: 0, connected: true, mapping: '', vibrationActuator: null, get axes() { return s.axes.slice(0, 5); }, buttons, get timestamp() { return s.ts; } };
    Object.defineProperty(Navigator.prototype, 'getGamepads', { value: () => [s.present ? padObj : null, null, null, null], configurable: true });
}

async function until<T>(get: () => Promise<T>, ok: (v: T) => boolean, ms: number): Promise<T> {
    const t0 = Date.now();
    let v = await get();
    while (!ok(v) && Date.now() - t0 < ms) { await sleep(250); v = await get(); }
    return v;
}

/** the flight's parts (D5) and what stays, each shown (1) or not (0); the top bar's rectangle, line count and what it covers */
const table = (p: Page): Promise<Record<string, unknown>> => p.evaluate(() => {
    const parts: Record<string, string> = {
        hint: '.mode-chip', thr: '.hud .osd.bl', keys: '.hud .osd.br', rec: '.rec-bar', recDot: '.rec-dot', volt: '.hud .osd.tr', stats: '.osd-stats',
        crash: '.crash-overlay', crashToast: '.crash-toast', lap: '.course-hud', note: '.hud-note', gateMsg: '.gate-msg', armCard: '.arm-card', f3: '.osd-col', nextHint: '.next-hint',
        modeLine: '.hud .osd.tl', voxels: '.wv', topbar: '.ce-topbar', gatebar: '.ce-gatebar'
    };
    const shown = (e: Element | null): boolean => {
        if (!e) return false;
        const r = e.getBoundingClientRect();
        const st = getComputedStyle(e);
        if (r.width < 2 || r.height < 2 || st.visibility === 'hidden' || Number(st.opacity) === 0 || e.closest('.visually-hidden')) return false;
        return (e.textContent ?? '').trim() !== '' || e.children.length > 0;
    };
    const t: Record<string, number> = {};
    for (const [k, q] of Object.entries(parts)) t[k] = [...document.querySelectorAll(q)].some(shown) ? 1 : 0;
    const box = (e: Element | null): number[] | null => { if (!e) return null; const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; };
    const top = document.querySelector('.ce-topbar');
    const line = document.querySelector('.ce-tb-line') as HTMLElement | null;
    const lh = line ? parseFloat(getComputedStyle(line).lineHeight) || parseFloat(getComputedStyle(line).fontSize) * 1.2 : 0;
    const tr = top?.getBoundingClientRect();
    const over = (a: DOMRect, b: DOMRect): boolean => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    const covers = tr && shown(top) ? [...document.querySelectorAll('button, a, [role=button], summary, .attribution')].filter((e) => !e.closest('.ce-topbar') && shown(e) && over(tr, e.getBoundingClientRect())).map((e) => `${e.tagName.toLowerCase()}.${String((e as HTMLElement).className).slice(0, 30)}`) : [];
    const credit = document.querySelector('.attribution');
    const wallsSum = document.querySelector('[data-testid=walls-summary]');
    const wallsMenu = document.querySelector('[data-testid=walls-more] .walls-menu');
    // the visible text leaves outside the editor's own parts (anything of the flight not in the list above shows here)
    const leaves = [...document.querySelectorAll('#ui *')].filter((e) => {
        if (e.closest('.ce-topbar, .ce-gatebar, .course-editor, .ce-size-tag')) return false;
        const own = [...e.childNodes].some((c) => c.nodeType === 3 && (c.textContent ?? '').trim() !== '');
        return own && shown(e);
    }).map((e) => `${String((e as HTMLElement).className || e.tagName).slice(0, 24)}:${(e.textContent ?? '').trim().slice(0, 24)}`).slice(0, 30);
    return {
        t, top: box(top), lineRect: line ? box(line) : null, lineCount: line && lh ? Math.round(line.getBoundingClientRect().height / lh) : null,
        lineText: line?.textContent ?? null, lineTitle: line?.title ?? null, refused: !!line?.classList.contains('refused'),
        ellipsis: line ? line.scrollWidth > line.clientWidth : null, covers, credit: credit ? box(credit) : null, creditShown: shown(credit),
        wallsSum: shown(wallsSum) ? box(wallsSum) : null, wallsMenu: shown(wallsMenu) ? 1 : 0, leaves
    };
});

async function open(page: Page, out: Record<string, unknown>, usePad: boolean): Promise<boolean> {
    await page.goto(`${SITE}/en/fly/?scene=${SCENE}&nowarn=1`);
    const st = await until(() => page.evaluate(() => (window as unknown as W).__gsfpv?.status ?? null), (v) => v === 'ready' || v === 'error', 240000);
    if (st !== 'ready') { out.status = st; return false; }
    if (usePad) {
        await page.waitForSelector('.screen.radio .choice', { timeout: 20000 }).catch(() => undefined);
        await pad(page, [0, 0, 0.3, 0, 0], 0x50);
        await until(() => page.evaluate(() => (window as unknown as { __gsfpv?: { radio?: { wizard?: { state?: { id?: string } } } } }).__gsfpv?.radio?.wizard?.state?.id ?? null), (v) => v === 'check', 8000);
        await pad(page, [0, 0, -1, 0, 0], 0x50);
        await page.locator('[data-action=wizard-done]').click({ timeout: 8000 }).catch(() => undefined);
        out.source = await until(() => page.evaluate(() => (window as unknown as W).__gsfpv?.controls?.source ?? null), (v) => v === 'gamepad', 15000);
    } else {
        await page.waitForSelector('.screen.radio [data-action="radio-keyboard"]', { timeout: 20000 }).catch(() => undefined);
        await page.click('.screen.radio [data-action="radio-keyboard"]', { timeout: 5000 }).catch(() => undefined);
        out.source = await page.evaluate(() => (window as unknown as W).__gsfpv?.controls?.source ?? null);
    }
    await sleep(1500);
    await page.keyboard.press('Shift+KeyG');
    const c = await until(() => page.evaluate(() => (window as unknown as W).__gsfpv?.course ?? null), (h) => (h?.gates ?? 0) > 0 && !!h?.on, 150000);
    out.gates = c?.gates;
    if (!c?.gates) return false;
    await page.keyboard.press('Shift+KeyB');
    await until(() => course(page).then((x) => x?.editor?.open ?? false), (v) => v, 30000);
    await sleep(1200);
    await page.keyboard.press('Tab');
    await sleep(1500);
    return true;
}

const shot = async (page: Page, name: string): Promise<void> => { if (SHOT) await page.screenshot({ path: join(SHOTS, name) }); };
const armPad = async (page: Page): Promise<void> => { await pad(page, [0, 0, -1, 0, 0], 0x50); await sleep(300); await pad(page, null, 0x50 | (1 << 2)); await sleep(150); await pad(page, null, 0x50); };

/** pad test flight: arm, climb 1.5 s, hover 3.5 s (the stats card wants 3 s of air), the table while flying, disarm */
async function padFlight(page: Page, out: Record<string, unknown>, sfx: string): Promise<void> {
    await armPad(page);
    out[`armed${sfx}`] = await until(() => armedNow(page), (v) => v === true, 2000);
    await pad(page, [0, 0, 0.1, 0, 0], null);
    const fm = await until(() => dbg(page), (d) => d?.mode === 'fly', 3000);
    await pad(page, [0, 0, 0.5, 0, 0], null);
    await sleep(1500);
    await pad(page, [0, 0, 0, 0, 0], null);
    await sleep(3500);
    out[`flying${sfx}`] = { mode: fm?.mode, ...(await table(page)) };
    await armPad(page);
    let dis = await until(() => dbg(page), (d) => d?.mode === 'edit', 6000);
    if (dis?.mode !== 'edit') { await page.keyboard.press('Space'); dis = await until(() => dbg(page), (d) => d?.mode === 'edit', 4000); }
    await sleep(1500);
    out[`afterFlight${sfx}`] = { mode: dis?.mode, ...(await table(page)) };
}

async function exitMode(page: Page, out: Record<string, unknown>, sfx: string): Promise<void> {
    await page.keyboard.press('Escape');
    await sleep(500);
    if ((await course(page))?.editor?.open) await page.keyboard.press('Escape');
    await sleep(1000);
    out[`afterExit${sfx}`] = { open: (await course(page))?.editor?.open ?? false, ...(await table(page)) };
}

async function desk(page: Page): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {};
    if (!(await open(page, out, true))) return out;
    out.edit = await table(page);
    await shot(page, `editor3-edit-clean-1920${TAG}.png`);
    // D6: a refused Save stays on the line until the pilot's next action. Ctrl+S without a name opens the name field; a name
    // typed and the window's Save then saves or refuses (Tunis: the start leg; the local server keeps nothing)
    await page.keyboard.press('Control+KeyS');
    await sleep(500);
    out.askLine = (await table(page)).lineText;
    await page.locator('.course-editor .ce-name').fill('Probe').catch(() => undefined);
    await page.locator('.course-editor .ce-save-mine').click({ timeout: 5000 }).catch((e) => { out.saveClick = String(e).slice(0, 120); });
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await until(() => table(page), (v) => !!v.refused, 8000);
    await sleep(1000);
    out.refused1s = await table(page);
    await sleep(9500);
    out.refused10s = await table(page);
    await page.keyboard.press('KeyM');
    await sleep(400);
    out.afterKey = await table(page);
    await padFlight(page, out, '');
    await shot(page, `editor3-after-flight-1920${TAG}.png`);
    // a crash in the test flight: arm, full throttle and full pitch forward until the crash (or 12 s)
    await armPad(page);
    await pad(page, [0, 0, 0.1, 0, 0], null);
    const flyNow = await until(() => dbg(page), (d) => d?.mode === 'fly', 4000);
    await pad(page, [0, 0.9, 1, 0, 0], null);
    const cr = await until(() => dbg(page), (d) => !!d?.crashActive, 15000);
    await pad(page, [0, 0, -1, 0, 0], null);
    out.crashSeen = { modeBefore: flyNow?.mode, crashActive: cr?.crashActive, mode: cr?.mode };
    await until(() => dbg(page), (d) => d?.mode === 'edit', 6000);
    await sleep(1500);
    out.afterCrash = { mode: (await dbg(page))?.mode, ...(await table(page)) };
    await shot(page, `editor3-after-crash-1920${TAG}.png`);
    await sleep(3000);
    out.afterCrash5s = { mode: (await dbg(page))?.mode, ...(await table(page)) };
    await exitMode(page, out, '');
    return out;
}

async function phone(page: Page): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {};
    if (!(await open(page, out, true))) return out;
    out.edit = await table(page);
    out.minBtn = await page.evaluate(() => ['.ce-topbar .ce-tb', '.ce-gatebar .ce-gb'].map((q) => { const b = [...document.querySelectorAll(q)].filter((e) => (e as HTMLElement).offsetParent).map((e) => e.getBoundingClientRect()); return b.length ? [Math.round(Math.min(...b.map((r) => r.width))), Math.round(Math.min(...b.map((r) => r.height)))] : []; }));
    await shot(page, `editor3-844${TAG}.png`);
    await padFlight(page, out, '');
    await exitMode(page, out, '');
    return out;
}

/** D8: the keyboard test flight. The selected gate (gate 1) 6 m ahead of the drone, Space, then the keys; per step the OSD
 * line and the drone's height; steering by the gate's place on screen (turn E/Q, forward W, CLIMB/DESC keys when set) */
async function kbd(page: Page): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {};
    if (!(await open(page, out, false))) return out;
    for (let n = 0; n < 40 && (await dbg(page))?.selected !== 0; n++) { await page.keyboard.press('Shift+Tab'); await sleep(80); }
    out.put = await page.evaluate(() => (window as unknown as W).__gsfpvEditPutAhead?.(6, 1, 2.5) ?? 'no hook');
    await sleep(1200);
    const osd = (): Promise<string> => page.evaluate(() => document.querySelector('.hud .osd.bl')?.textContent ?? '');
    const nextBefore = (await course(page))?.next;
    out.nextBefore = nextBefore;
    out.gateBefore = (await dbg(page))?.gates?.[0];
    const t0 = Date.now();
    await page.keyboard.press('Space');
    const fm = await until(() => dbg(page), (d) => d?.mode === 'fly', 4000);
    out.armMs = Date.now() - t0;
    out.modeArmed = fm?.mode;
    const vp = page.viewportSize()!;
    out.droneArmed = fm?.drone;
    const steps: unknown[] = [];
    const climb = process.env.CLIMB ?? '';
    // pass 3: the gate's world height (the hook's answer); the climb key is held across steps while the drone is under it and
    // let go only after 400 ms (a shorter Space is the disarming tap); the gate behind: turn (E); ahead: E/Q to centre, W
    const gateY = (out.put as { gate?: number[] } | null)?.gate?.[1] ?? null;
    let climbAt = 0;
    for (let i = 0; i < 80; i++) {
        const d = await dbg(page);
        const c = await course(page);
        const g = d?.gates?.[0];
        const y = d?.drone?.[1] ?? null;
        steps.push([i, c?.next, d?.mode, (await osd()).replace(/\s+/g, ' '), y, g ? g.map((v) => Math.round(v)) : null, climbAt ? 'C' : '']);
        if (c?.next !== nextBefore || d?.mode !== 'fly') break;
        const keys: string[] = [];
        if (climb && gateY !== null && y !== null) {
            const low = y < gateY - 0.2;
            if (low && !climbAt) { await page.keyboard.down(climb); climbAt = Date.now(); }
            else if (!low && climbAt && Date.now() - climbAt > 400) { await page.keyboard.up(climb); climbAt = 0; }
        }
        if (i >= 2) {
            if (g && g[2]! > 0) {
                const ex = (g[0]! - vp.width / 2) / (vp.width / 2);
                if (ex > 0.1) keys.push('KeyE'); else if (ex < -0.1) keys.push('KeyQ');
                if (Math.abs(ex) < 0.4) keys.push('KeyW');
            } else keys.push('KeyE');
        }
        for (const k of keys) await page.keyboard.down(k);
        await sleep(250);
        for (const k of keys) await page.keyboard.up(k);
        await sleep(50);
    }
    if (climbAt) { await sleep(Math.max(0, 450 - (Date.now() - climbAt))); await page.keyboard.up(climb); }
    await sleep(300);
    out.steps = steps;
    out.nextAfter = (await course(page))?.next;
    out.flyingTable = await table(page);
    const t1 = Date.now();
    await page.keyboard.press('Space');
    const dis = await until(() => dbg(page), (d) => d?.mode === 'edit', 6000);
    out.disarmMs = Date.now() - t1;
    out.modeAfter = dis?.mode;
    await sleep(1200);
    out.afterDisarm = await table(page);
    await shot(page, `editor3-after-kbd-1920${TAG}.png`);
    return out;
}

async function main(): Promise<void> {
    mkdirSync(OUT, { recursive: true });
    mkdirSync(SHOTS, { recursive: true });
    const log: string[] = [];
    const out: Record<string, unknown> = { site: SITE, scene: SCENE, date: new Date().toISOString() };
    const { browser, which } = await launchChrome({ args: ['--window-size=1936,1200'] });
    out.browser = which;
    const file = join(OUT, `clean${TAG}.json`);
    const run = async (name: string, vp: { width: number; height: number }, f: (p: Page) => Promise<Record<string, unknown>>): Promise<void> => {
        const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1 });
        await ctx.addInitScript({ content: `globalThis.__name = (f) => f; (${install.toString()})();` });
        const page = await ctx.newPage();
        page.on('pageerror', (e) => log.push(`${name} pageerror: ${e.message}`.slice(0, 300)));
        try { out[name] = await f(page); } catch (e) { out[name] = { error: String(e).slice(0, 400) }; }
        await ctx.close();
        writeFileSync(file, JSON.stringify({ ...out, log }, null, 1));
    };
    try {
        if (PARTS.includes('kbd')) await run('kbd', { width: 1920, height: 1080 }, kbd);
        if (PARTS.includes('desk')) await run('desk', { width: 1920, height: 1080 }, desk);
        if (PARTS.includes('phone')) await run('phone', { width: 844, height: 390 }, phone);
    } finally {
        await browser.close();
    }
    console.log(`wrote ${file}`);
}

void main().catch((e) => { console.error(e); process.exit(1); });
