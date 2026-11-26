// fix-fly (train 5): accept-fly's wizard opens the fly page as a pilot waits for it, a committed navigation and then
// the page's own readiness, not the browser's `load` (live run 2 of car 5: `page.goto: Timeout 30000ms exceeded ...
// waiting until "load"` in `wizard` right after B9, while the page itself was fine). Fake pages, no browser starts.
// Negative control: the old wizard (`page.goto(url)`, default waitUntil 'load') has no openFlyPage.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openFlyPage, COMMIT_TIMEOUT_MS } from '../src/fly-open';
import { waitReady } from '../src/browser';

type Status = { status: string } | null;

/** a page whose `load` never comes in time (Playwright throws its timeout) but whose own readiness does */
function fakePage(statuses: Status[]) {
    const calls: { url: string; waitUntil: string | undefined; timeout: number | undefined }[] = [];
    let i = 0;
    return {
        calls,
        async goto(url: string, options?: { waitUntil?: string; timeout?: number }) {
            calls.push({ url, waitUntil: options?.waitUntil, timeout: options?.timeout });
            if (options?.waitUntil !== 'commit') throw new Error('page.goto: Timeout 30000ms exceeded. waiting until "load"');
            return null;
        },
        async evaluate() {
            return statuses[Math.min(i++, statuses.length - 1)];
        },
        async waitForTimeout() {},
    };
}

describe('openFlyPage: commit, then the page readiness', () => {
    it('opens a page whose load is late but which becomes ready', async () => {
        const p = fakePage([null, { status: 'loading' }, { status: 'ready' }]);
        let t = 0;
        const o = await openFlyPage(p, 'https://x/en/fly/?scene=39e63ce9', (pg) => waitReady(pg as never, 5000), () => (t += 10));
        expect(o.ready).toMatchObject({ status: 'ready' });
        expect(p.calls).toEqual([{ url: 'https://x/en/fly/?scene=39e63ce9', waitUntil: 'commit', timeout: COMMIT_TIMEOUT_MS }]);
        expect(o.commitMs).toBeGreaterThan(0);
        expect(o.readyMs).toBeGreaterThan(o.commitMs);
    });

    it('keeps the judge strict: a page that never becomes ready still fails', async () => {
        const p = fakePage([{ status: 'loading' }]);
        await expect(openFlyPage(p, 'https://x/en/fly/', (pg) => waitReady(pg as never, 1))).rejects.toThrow('page did not become ready');
    });

    it('passes an error status through to the caller (B6 and B10 judge it)', async () => {
        const p = fakePage([{ status: 'error' }]);
        const o = await openFlyPage(p, 'https://x/en/fly/', (pg) => waitReady(pg as never, 5000));
        expect(o.ready).toMatchObject({ status: 'error' });
    });

    it("accept-fly's wizard opens the page through openFlyPage, not a bare goto", () => {
        const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'accept-fly.ts'), 'utf8');
        const body = src.slice(src.indexOf('async function wizard('), src.indexOf("if (want('B10') || want('B11'))"));
        expect(body).toContain('openFlyPage(page,');
        expect(body).not.toMatch(/page\.goto\(/);
    });
});
