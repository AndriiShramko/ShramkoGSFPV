// Opening the fly page the way a pilot waits for it (fix-fly, train 5): the navigation only has to COMMIT (the new
// document is there), then the page's own readiness decides (`window.__gsfpv.status` leaves 'loading', the wait the
// B6 lines use). Playwright's default `goto` waits for the browser's `load` under one 30 s budget that also covers
// tearing down the page before (B9 leaves the pause menu and the drone picker open); a pilot never waits for `load`,
// and the scan's own requests run after it anyway. The judge of the readiness is the caller's (waitLogic in
// accept-fly.ts keeps its ACCEPT_RENDER=off check), so nothing a check judges becomes weaker.

/** the part of Playwright's Page this needs (a fake page in the unit test) */
export interface NavPage {
    goto(url: string, options: { waitUntil: 'commit'; timeout: number }): Promise<unknown>;
}

/** what the open took: commit of the navigation, then the page's readiness */
export interface FlyOpened<R> {
    ready: R;
    commitMs: number;
    readyMs: number;
}

/** the navigation's own budget: committing a document, nothing more (the readiness has its own timeout) */
export const COMMIT_TIMEOUT_MS = 60000;

export async function openFlyPage<P extends NavPage, R>(page: P, url: string, waitPageReady: (p: P) => Promise<R>, now: () => number = Date.now): Promise<FlyOpened<R>> {
    const t0 = now();
    await page.goto(url, { waitUntil: 'commit', timeout: COMMIT_TIMEOUT_MS });
    const commitMs = now() - t0;
    const ready = await waitPageReady(page);
    return { ready, commitMs, readyMs: now() - t0 };
}
