// Lane editor3, stage E1-freeze-and-design: what the owner met in the course editor (message 51, train 3), measured in a
// headless browser. READ ONLY on any site: it presses Shift+G (a course made in this tab, never saved), Shift+B (the editor),
// Tab, the arrows, PageUp, Q and the mouse on the canvas; it never presses a save, send or create control.
//   SITE   default https://gsfpv.flyreelstudio.eu (the live site), or a local release server
//   SCENES default 70b50d42,887f27aa (the owner's Wroclaw and Tunis scans)
//   OUT    default U:/Temp/gsfpv-train3/editor3 (evidence JSON and screenshots, never in git)
// Per scene: the time from Shift+G to a shown course, from Shift+B to the open editor, then per key the long tasks of the main
// thread, the longest frame gap, whether the key reached the page past the editor's listener, the hook after it, and where the
// keyboard focus is. Run under the GPU lock: until mkdir C:/dev/.gpu-lock ...; cd tools/bench && npx tsx src/editor3-live.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { launchChrome } from './browser';

const SITE = (process.env.SITE ?? 'https://gsfpv.flyreelstudio.eu').replace(/\/$/, '');
const SCENES = (process.env.SCENES ?? '70b50d42,887f27aa').split(',').filter(Boolean);
const OUT = process.env.OUT ?? 'U:/Temp/gsfpv-train3/editor3';
const SHOTS = 'U:/Temp/gsfpv-train3/shots';
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** installed before the page's own scripts: long tasks, frame gaps, and every keydown seen at window capture and at document */
const INIT = `(() => {
  const w = window;
  const e3 = { lt: [], frames: [], keys: [], last: 0 };
  w.__e3 = e3;
  try { new PerformanceObserver((l) => { for (const x of l.getEntries()) e3.lt.push([Math.round(x.startTime), Math.round(x.duration)]); }).observe({ type: 'longtask', buffered: true }); } catch (e) {}
  const tick = (t) => { if (e3.last) { e3.frames.push([Math.round(t), Math.round(t - e3.last)]); if (e3.frames.length > 4000) e3.frames.splice(0, 2000); } e3.last = t; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  const who = (t) => t && t.tagName ? (t.tagName + (t.className && typeof t.className === 'string' ? '.' + t.className.split(' ')[0] : '')) : String(t);
  w.addEventListener('keydown', (e) => e3.keys.push({ code: e.code, t: Math.round(performance.now()), at: who(e.target), doc: false, prevented: false }), true);
  document.addEventListener('keydown', (e) => { const k = e3.keys[e3.keys.length - 1]; if (k && k.code === e.code) { k.doc = true; k.prevented = e.defaultPrevented; } }, true);
})();`;

type Hook = { gates?: number; on?: boolean; source?: string; problem?: string | null; editor?: { open?: boolean; selected?: number; changed?: boolean; problems?: number; refused?: string | null; said?: string; view?: { eye: number[]; at: number[] } | null } };
const hook = (p: Page): Promise<Hook | null> => p.evaluate(() => ((window as unknown as { __gsfpv?: { course?: Hook } }).__gsfpv?.course ?? null));
const status = (p: Page): Promise<string | null> => p.evaluate(() => (window as unknown as { __gsfpv?: { status?: string } }).__gsfpv?.status ?? null);

async function until<T>(get: () => Promise<T>, ok: (v: T) => boolean, ms: number): Promise<{ ok: boolean; v: T; ms: number }> {
    const t0 = Date.now();
    let v = await get();
    while (!ok(v) && Date.now() - t0 < ms) {
        await sleep(500);
        v = await get();
    }
    return { ok: ok(v), v, ms: Date.now() - t0 };
}

/** long tasks and frame gaps since `from` (page time), and the page time now */
const since = (p: Page, from: number): Promise<{ now: number; ltN: number; ltSum: number; ltMax: number; frames: number; gapMax: number; gapMed: number }> =>
    p.evaluate((f) => {
        const e3 = (window as unknown as { __e3: { lt: [number, number][]; frames: [number, number][] } }).__e3;
        const lt = e3.lt.filter((x) => x[0] >= f);
        const fr = e3.frames.filter((x) => x[0] >= f).map((x) => x[1]).sort((a, b) => a - b);
        return { now: Math.round(performance.now()), ltN: lt.length, ltSum: lt.reduce((s, x) => s + x[1], 0), ltMax: lt.reduce((s, x) => Math.max(s, x[1]), 0), frames: fr.length, gapMax: fr[fr.length - 1] ?? 0, gapMed: fr[fr.length >> 1] ?? 0 };
    }, from);
const now = (p: Page): Promise<number> => p.evaluate(() => Math.round(performance.now()));
const focus = (p: Page): Promise<string> => p.evaluate(() => {
    const a = document.activeElement as HTMLElement | null;
    return a ? `${a.tagName}${a.className && typeof a.className === 'string' ? '.' + a.className.split(' ')[0] : ''}${a.getAttribute('data-action') ? '[' + a.getAttribute('data-action') + ']' : ''}` : 'none';
});
const lastKey = (p: Page): Promise<unknown> => p.evaluate(() => (window as unknown as { __e3: { keys: unknown[] } }).__e3.keys.slice(-1)[0] ?? null);

async function scene(page: Page, id: string, log: string[]): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = { scene: id };
    const t0 = Date.now();
    await page.goto(`${SITE}/en/fly/?scene=${id}&nowarn=1`);
    const r = await until(() => status(page), (v) => v === 'ready' || v === 'error', 240000);
    out.readyMs = r.ms;
    out.status = r.v;
    if (r.v !== 'ready') return out;
    try {
        await page.waitForSelector('.screen.radio [data-action="radio-keyboard"]', { timeout: 15000 });
        await page.focus('.screen.radio [data-action="radio-keyboard"]');
        await page.keyboard.press('Enter');
    } catch {
        /* no Controls screen */
    }
    await sleep(2000);
    // Shift+G: walls first when the scene has none shipped (Wroclaw: built in the browser), then the course
    const g0 = await now(page);
    await page.keyboard.press('Shift+KeyG');
    const gen = await until(() => hook(page), (h) => (h?.gates ?? 0) > 0 && !!h?.on, 480000);
    out.generate = { ok: gen.ok, ms: gen.ms, gates: gen.v?.gates, source: gen.v?.source, problem: gen.v?.problem ?? null, main: await since(page, g0) };
    log.push(`${id}: course ${gen.ok} in ${gen.ms} ms, ${gen.v?.gates} gates`);
    if (!gen.ok) return out;
    await sleep(1500);
    // Shift+B: the editor; the wall clock of the press itself (a frozen main thread holds the press's round trip)
    const b0 = await now(page);
    const w0 = Date.now();
    await page.keyboard.press('Shift+KeyB');
    const pressMs = Date.now() - w0;
    const op = await until(() => hook(page), (h) => !!h?.editor?.open, 60000);
    out.open = { ok: op.ok, pressMs, toOpenMs: op.ms, main: await since(page, b0), editor: op.v?.editor, focus: await focus(page) };
    log.push(`${id}: editor open ${op.ok} press ${pressMs} ms, open after ${op.ms} ms`);
    await page.screenshot({ path: join(SHOTS, `editor3-e1-${id}-open.png`) });
    // idle frames in the editor (5 s)
    const i0 = await now(page);
    await sleep(5000);
    out.idle = await since(page, i0);
    const keys: Record<string, unknown>[] = [];
    for (const k of ['Tab', 'Tab', 'Shift+Tab', 'ArrowUp', 'ArrowRight', 'PageUp', 'KeyQ', 'Equal', 'Control+KeyZ', 'KeyW']) {
        const before = (await hook(page))?.editor;
        const k0 = await now(page);
        const kw = Date.now();
        await page.keyboard.press(k);
        const pressMs = Date.now() - kw;
        const ch = await until(() => hook(page), (h) => JSON.stringify(h?.editor?.said) !== JSON.stringify(before?.said) || h?.editor?.selected !== before?.selected, 8000);
        const after = ch.v?.editor;
        keys.push({ key: k, pressMs, toChangeMs: ch.ms, changed: ch.ok, selected: [before?.selected, after?.selected], refused: after?.refused ?? null, said: (after?.said ?? '').slice(0, 140), problems: after?.problems, eyeMoved: JSON.stringify(before?.view?.eye) !== JSON.stringify(after?.view?.eye), seen: await lastKey(page), focus: await focus(page), main: await since(page, k0) });
        await sleep(400);
    }
    out.keys = keys;
    await page.screenshot({ path: join(SHOTS, `editor3-e1-${id}-keys.png`) });
    // the mouse on the canvas: a drag from the middle, then a click on the middle (does the view or the selection change)
    const vp = page.viewportSize() ?? { width: 1280, height: 800 };
    const m0 = await now(page);
    const hb = (await hook(page))?.editor;
    await page.mouse.move(vp.width * 0.35, vp.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(vp.width * 0.25, vp.height * 0.45, { steps: 10 });
    await page.mouse.up();
    await sleep(500);
    await page.mouse.click(vp.width * 0.35, vp.height * 0.5);
    await sleep(800);
    const ha = (await hook(page))?.editor;
    out.mouse = { selected: [hb?.selected, ha?.selected], eyeMoved: JSON.stringify(hb?.view?.eye) !== JSON.stringify(ha?.view?.eye), said: (ha?.said ?? '').slice(0, 140), pointerLock: await page.evaluate(() => !!document.pointerLockElement), focus: await focus(page), main: await since(page, m0) };
    out.totalMs = Date.now() - t0;
    return out;
}

async function main(): Promise<void> {
    mkdirSync(OUT, { recursive: true });
    mkdirSync(SHOTS, { recursive: true });
    const log: string[] = [];
    const out: Record<string, unknown> = { site: SITE, date: new Date().toISOString(), scenes: {} };
    const { browser, which } = await launchChrome({ args: ['--window-size=1296,920'] });
    out.browser = which;
    try {
        for (const id of SCENES) {
            const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
            await ctx.addInitScript(INIT);
            const page = await ctx.newPage();
            page.on('pageerror', (e) => log.push(`${id} pageerror: ${e.message}`.slice(0, 300)));
            page.on('console', (m) => { if (m.type() === 'error') log.push(`${id} console: ${m.text()}`.slice(0, 300)); });
            try {
                (out.scenes as Record<string, unknown>)[id] = await scene(page, id, log);
            } catch (e) {
                (out.scenes as Record<string, unknown>)[id] = { error: String(e).slice(0, 400) };
            }
            await ctx.close();
        }
    } finally {
        await browser.close();
    }
    out.log = log;
    const file = join(OUT, `e1-${SITE.includes('localhost') ? 'local' : 'live'}.json`);
    writeFileSync(file, JSON.stringify(out, null, 1));
    console.log(`wrote ${file}`);
    for (const l of log.slice(0, 30)) console.log(l);
}

void main().catch((e) => {
    console.error(e);
    process.exit(1);
});
