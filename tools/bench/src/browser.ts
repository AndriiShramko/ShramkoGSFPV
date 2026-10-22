// System Chrome through Playwright: VISIBLE window, stock flags only (no --disable-gpu-vsync
// and friends). Every run records visibility and the gsplat renderer; a run where the page was
// hidden or the GPU sort was not active is invalid.
// Without system Chrome (the cloud container) Playwright's bundled Chromium runs instead, still
// headful (under `xvfb-run -a` where there is no display): chrome.mjs picks, and every evidence
// file of the run says which browser it was (evidence.ts context().browser). tools/bench/README.md.
import { chromium } from 'playwright';
import type { Browser, BrowserContext, Page } from 'playwright';
import { describeBrowser, pickBrowser } from './chrome.mjs';
import type { BrowserInfo } from './chrome.mjs';
import { noteBrowser } from './evidence';

export interface Launched {
    browser: Browser;
    context: BrowserContext;
    page: Page;
    console: string[];
    /** which browser this is: system Chrome, or the bundled Chromium where there is none */
    which: BrowserInfo;
}

/**
 * BENCH_BACKGROUND (the owner's request of 2026-10-22: the tests run in the background and never take his screen, focus or mouse):
 *   headless  new headless Chrome (no window at all)
 *   offscreen a headed Chrome parked at -32000,-32000 (for a driver that cannot draw headless)
 * In both a page's pointer lock is stubbed (see POINTER_LOCK_STUB): nothing can grab the real mouse. Unset: the visible window as before.
 */
export const BACKGROUND = process.env.BENCH_BACKGROUND === 'headless' || process.env.BENCH_BACKGROUND === 'offscreen' ? process.env.BENCH_BACKGROUND : null;

/** Pointer lock without the real pointer: the page's own state (`pointerLockElement`, `pointerlockchange`) follows the call, the mouse stays the owner's. */
export const POINTER_LOCK_STUB = `(() => {
  let locked = null;
  Object.defineProperty(Document.prototype, 'pointerLockElement', { configurable: true, get() { return locked; } });
  Element.prototype.requestPointerLock = function () { locked = this; queueMicrotask(() => document.dispatchEvent(new Event('pointerlockchange'))); return Promise.resolve(); };
  Document.prototype.exitPointerLock = function () { if (locked) { locked = null; queueMicrotask(() => document.dispatchEvent(new Event('pointerlockchange'))); } };
})();`;

/** chromium.launch() on system Chrome, else the bundled Chromium (chrome.mjs); the choice goes into the evidence. */
export async function launchChrome(o: Parameters<typeof chromium.launch>[0] = {}): Promise<{ browser: Browser; which: BrowserInfo }> {
    const pick = pickBrowser({ expected: chromium.executablePath() });
    const asked = BACKGROUND === 'headless' ? { ...o, headless: true, args: [...(o.args ?? []).filter((a) => !a.startsWith('--window-')), '--window-size=1296,920'] }
        : BACKGROUND === 'offscreen' ? { ...o, headless: false, args: [...(o.args ?? []).filter((a) => !a.startsWith('--window-')), '--window-position=-32000,-32000', '--window-size=1296,920'] }
            : o;
    const browser = await chromium.launch({ ...asked, ...pick.launch });
    if (BACKGROUND) {
        // every context of a background browser carries the stub; the contexts the drivers make themselves too
        const newContext = browser.newContext.bind(browser);
        browser.newContext = (async (opts?: Parameters<Browser['newContext']>[0]) => {
            const c = await newContext(opts);
            await c.addInitScript(POINTER_LOCK_STUB);
            return c;
        }) as Browser['newContext'];
    }
    const which = describeBrowser(pick, browser.version());
    noteBrowser(which);
    return { browser, which };
}

export async function launch(opts: { width?: number; height?: number; mobile?: boolean } = {}): Promise<Launched> {
    const { browser, which } = await launchChrome({
        headless: false,
        // Playwright adds its automation defaults; we add nothing that changes rendering or vsync
        args: ['--window-position=40,40', `--window-size=${(opts.width ?? 1280) + 16},${(opts.height ?? 800) + 120}`]
    });
    const context = await browser.newContext({
        viewport: { width: opts.width ?? 1280, height: opts.height ?? 800 },
        deviceScaleFactor: 1,
        isMobile: !!opts.mobile,
        hasTouch: !!opts.mobile
    });
    const page = await context.newPage();
    const lines: string[] = [];
    page.on('console', (m) => lines.push(`${m.type()}: ${m.text()}`.slice(0, 400)));
    page.on('pageerror', (e) => lines.push(`pageerror: ${e.message}`.slice(0, 400)));
    return { browser, context, page, console: lines, which };
}

export async function visibility(page: Page): Promise<string> {
    return page.evaluate(() => document.visibilityState);
}

/** Wait for the /fly test hook to be ready or failed. */
export async function waitReady(page: Page, timeoutMs = 120000): Promise<Record<string, unknown>> {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
        const h = await page.evaluate(() => {
            const w = window as unknown as { __gsfpv?: { status: string; error?: string; info?: Record<string, unknown> } };
            return w.__gsfpv ? { status: w.__gsfpv.status, error: w.__gsfpv.error, info: w.__gsfpv.info } : null;
        });
        if (h && h.status !== 'loading') return h as Record<string, unknown>;
        await page.waitForTimeout(250);
    }
    throw new Error('page did not become ready');
}
