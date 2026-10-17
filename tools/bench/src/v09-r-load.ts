// v0.9 lane R, review follow-up: what the desktop default budget (stochastic at 8 M, was sorted at 4 M) costs
// on the LOAD side, which the GPU-time numbers (v09-r-cost.ts) did not cover, and what a share picture of a
// stochastic frame weighs. Draws the scan: run it under the GPU lock (C:/dev/.gpu-lock) in a visible window.
//   per scene and budget, every run in a FRESH browser context (cold HTTP cache, so the bytes are the bytes):
//     readyMs     page.goto -> the page says ready (a scan on screen, the pilot can fly)
//     completeMs  page.goto -> the engine reports the scan complete (levels of detail for the budget in place)
//     bytes       response body bytes of every request that finished (by host), the scan's chunks among them
//   then the share picture (share/picture.ts: the canvas cropped to 1200x630, a JPEG that steps its quality down
//   to fit 380 KB) of the same view drawn stochastic and drawn sorted, at 1920x1080 and 3840x2160 backbuffers.
//   SITE=http://127.0.0.1:5391 SCENES=ba7aa29d,2f1ddf5f BUDGETS=4,8 REPEATS=2 npx tsx src/v09-r-load.ts
// Evidence: evidence/<date>/v09-r-load.json and v09-r-load-share-*.jpg
import { mkdirSync, rmdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { launchChrome, waitReady } from './browser';
import { REPO, today } from './evidence';

const SITE = (process.env.SITE ?? 'http://127.0.0.1:5391').replace(/\/$/, '');
const SCENES = (process.env.SCENES ?? 'ba7aa29d,2f1ddf5f').split(',');
const BUDGETS = (process.env.BUDGETS ?? '4,8').split(',').map(Number);
const REPEATS = Number(process.env.REPEATS ?? 2);
const LIMIT_MS = Number(process.env.LIMIT_MS ?? 90000);
const LOCK = 'C:/dev/.gpu-lock';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

for (;;) {
    try { mkdirSync(LOCK); break; } catch { await sleep(Number(process.env.LOCK_POLL_MS ?? 20000)); }
}
const release = (): void => { try { rmdirSync(LOCK); } catch { /* gone */ } };
process.on('SIGINT', () => { release(); process.exit(130); });

const { browser, which } = await launchChrome({ headless: false, args: ['--window-position=0,0', '--window-size=1400,1000'] });
const hook = <T = Any>(p: Page, body: string): Promise<T> => p.evaluate(`(() => { const h = window.__gsfpv; const s = h.session; ${body} })()`) as Promise<T>;
const runs: Any[] = [];
const outDir = join(REPO, 'evidence', today());
mkdirSync(outDir, { recursive: true });

/**
 * The share picture of the view now, as share/picture.ts makes it before the brand is drawn: grabView's crop
 * (cover) of the canvas into 1200x630 in the engine's frameend, then the JPEG at the qualities it steps through.
 */
const GRAB = `(async () => {
    const h = window.__gsfpv; const r = h.session.renderer; const canvas = r.canvas; const W = 1200, H = 630;
    const frame = await new Promise((res) => {
        const t = setTimeout(() => res(null), 4000);
        const on = () => {
            r.app.off('frameend', on); clearTimeout(t);
            const out = document.createElement('canvas'); out.width = W; out.height = H;
            const g = out.getContext('2d'); const sc = Math.max(W / canvas.width, H / canvas.height); const sw = W / sc, sh = H / sc;
            g.drawImage(canvas, (canvas.width - sw) / 2, (canvas.height - sh) / 2, sw, sh, 0, 0, W, H);
            res(out);
        };
        r.app.on('frameend', on); r.renderOnce();
    });
    if (!frame) return null;
    const bytes = {}; let first = '';
    for (const q of [0.88, 0.8, 0.72, 0.64, 0.56]) { const u = frame.toDataURL('image/jpeg', q); bytes[q] = Math.round((u.length - 23) * 0.75); if (!first) first = u; }
    return { canvas: [canvas.width, canvas.height], stochastic: r.stochastic, bytes, jpeg: first };
})()`;

try {
    for (const scene of SCENES) {
        for (let rep = 0; rep < REPEATS; rep++) {
            for (const B of BUDGETS) {
                const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
                await ctx.route('**/api/e', (r) => r.fulfill({ status: 204, body: '' }));
                await ctx.addInitScript('window.__name = window.__name || ((f) => f);');
                const page = await ctx.newPage();
                const bytesByHost: Record<string, number> = {};
                let total = 0, n = 0;
                page.on('requestfinished', (req) => {
                    void req.sizes().then((sz) => {
                        const b = Math.max(0, sz.responseBodySize);
                        const host = new URL(req.url()).host;
                        bytesByHost[host] = (bytesByHost[host] ?? 0) + b;
                        total += b; n += 1;
                    }).catch(() => undefined);
                });
                const t0 = Date.now();
                // the drawing the default now gives a desktop: stochastic. The link carries the budget under test
                await page.goto(`${SITE}/en/fly/?scene=${scene}&budget=${B}&stochastic&governor=0&nowarn=1&input=touch`);
                const ready = await waitReady(page, 240000);
                const readyMs = Date.now() - t0;
                let completeMs: number | null = null;
                while (Date.now() - t0 < LIMIT_MS) {
                    if (await hook<boolean>(page, 'return s.renderer.sceneComplete;')) { completeMs = Date.now() - t0; break; }
                    await sleep(250);
                }
                const row: Any = { scene, budgetM: B, rep, status: (ready as Any).status, readyMs, completeMs };
                if (row.status === 'ready') {
                    await sleep(1500); // let the last chunks land
                    row.bytes = { total, requests: n, byHost: { ...bytesByHost } };
                    row.drawnM = await hook(page, 'const l = h.lod ? h.lod() : null; return l ? Math.round(l.drawn / 1e5) / 10 : null;');
                    row.stillComplete = await hook(page, 'return s.renderer.sceneComplete;');
                    // the share picture, only in the last repeat of each pair (it is the same view): stochastic, then sorted
                    if (rep === REPEATS - 1) {
                        row.share = {};
                        await hook(page, 's.pause(true, "bake"); s.cameraOverride = true; return 0;');
                        for (const res of [[1920, 1080], [3840, 2160]]) {
                            await hook(page, `s.renderer.setFixedResolution({ w: ${res[0]}, h: ${res[1]} }); return 0;`);
                            for (const mode of ['stochastic', 'sorted']) {
                                await hook(page, `s.renderer.setStochastic(${mode === 'stochastic'}); return 0;`);
                                await sleep(2500);
                                const g = await page.evaluate(GRAB) as Any;
                                if (g) {
                                    const key = `${res[0]}x${res[1]}-${mode}`;
                                    row.share[key] = { canvas: g.canvas, engineStochastic: g.stochastic, bytes: g.bytes };
                                    if (B === BUDGETS[BUDGETS.length - 1]) writeFileSync(join(outDir, `v09-r-load-share-${scene}-${key}.jpg`), Buffer.from(g.jpeg.slice(g.jpeg.indexOf(',') + 1), 'base64'));
                                }
                            }
                        }
                    }
                }
                runs.push(row);
                console.log('load', scene, 'B', B, 'rep', rep, JSON.stringify({ readyMs, completeMs, MB: row.bytes ? Math.round(row.bytes.total / 1e5) / 10 : null, drawnM: row.drawnM, share: row.share ? Object.fromEntries(Object.entries(row.share).map(([k, v]) => [k, (v as Any).bytes['0.88']])) : undefined }));
                await ctx.close();
            }
        }
    }
} finally {
    await browser.close().catch(() => undefined);
    release();
}
const out = join(outDir, 'v09-r-load.json');
writeFileSync(out, JSON.stringify({ site: SITE, browser: which, scenes: SCENES, budgets: BUDGETS, repeats: REPEATS, limitMs: LIMIT_MS, runs }, null, 2));
console.log('written', out);
