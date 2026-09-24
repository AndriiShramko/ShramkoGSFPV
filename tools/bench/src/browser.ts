// System Chrome through Playwright: VISIBLE window, stock flags only (no --disable-gpu-vsync
// and friends). Every run records visibility and the gsplat renderer; a run where the page was
// hidden or the GPU sort was not active is invalid.
import { chromium } from 'playwright';
import type { Browser, BrowserContext, Page } from 'playwright';

export interface Launched {
    browser: Browser;
    context: BrowserContext;
    page: Page;
    console: string[];
}

export async function launch(opts: { width?: number; height?: number; mobile?: boolean } = {}): Promise<Launched> {
    const browser = await chromium.launch({
        channel: 'chrome',
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
    return { browser, context, page, console: lines };
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
