// v0.7 lane E item 3 acceptance in the real page (docs/wip/v07-e.md section 6): "Save as this scan's
// default" in the pause menu. The admin API is played by the page's own routes here (the dev server
// has none); what the real server does with the draft is tools/bench/test/scene-default.test.ts.
//   A0 control: no admin hint in this browser -> the page asks /api/admin/* nothing, the menu has no item.
//   A1 the hint + a live session: the item is in the scene section; picking it reads the draft, posts
//      the whole draft back with the session's X-CSRF, this scan's entry carries what is flown (walls
//      off, the ceiling, the custom wind as manual), the other scan is untouched, the pilot reads it.
//   L  the "Ignore collisions above" panel's legend after its wrap fix: a screenshot of the panel and
//      each key's swatch and words on one line (evidence for the owner's eyes; the gate is A0/A1).
//   LOCAL_FLY=1 SITE=http://127.0.0.1:5377 npx tsx src/accept-v07-admin-default.ts
// Evidence: evidence/<date>/v07-admin-default.json and v07-ceiling-legend.png.
import type { BrowserContext, Page } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { launchChrome, waitReady } from './browser';
import { REPO, today, writeEvidence } from './evidence';

const SITE = (process.env.SITE ?? 'http://127.0.0.1:5377').replace(/\/$/, '');
const fly = (qs: string) => (process.env.LOCAL_FLY ? `${SITE}/fly/?${qs}` : `${SITE}/en/fly/?${qs}`);
const SCENE = '39e63ce9';
const OTHER = { id: 'bbbb2222', title: 'Beta room', author: 'Test', license: 'CC BY 4.0', kind: 'interior', collision: true, walls: 'off', dropFloaters: 2 };
const CSRF = 'test-csrf-not-a-secret';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const hook = <T = Any>(p: Page, body: string): Promise<T> => p.evaluate(`(async () => { const h = window.__gsfpv; const s = h.session; ${body} })()`) as Promise<T>;

/** A fresh context and page on the scan; `admin` calls of the page are logged (and answered when `fake`). */
async function open(ctx: BrowserContext, calls: { method: string; path: string; csrf: string | null; body: Any }[], fake: boolean): Promise<Page> {
    await ctx.route('**/api/admin/**', async (route) => {
        const req = route.request();
        const path = new URL(req.url()).pathname;
        const body = req.postData() ? JSON.parse(req.postData()!) : null;
        calls.push({ method: req.method(), path, csrf: req.headers()['x-csrf'] ?? null, body });
        if (!fake) return route.fulfill({ status: 401, contentType: 'application/json', body: '{"ok":false,"reason":"login"}' });
        const json = (o: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
        if (path === '/api/admin/session') return json({ ok: true, csrf: CSRF });
        const scene = { id: SCENE, title: 'Modlinek Villa', author: 'Andrii Shramko', license: 'CC BY 4.0', kind: 'interior', collision: true, walls: 'on', wind: { fromDeg: 200, speed: 3, gust: 1, source: 'climate' } };
        if (path === '/api/admin/catalog') return json({ ok: true, draft: { collections: [], scenes: [scene, OTHER] }, published: null, dirty: false, history: [] });
        if (path === '/api/admin/catalog/draft' && req.method() === 'POST') return json({ ok: true, draft: body.catalog, published: null, dirty: true, history: [] });
        return route.fulfill({ status: 404, body: '{}' });
    });
    const p = await ctx.newPage();
    await p.goto(fly(`scene=${SCENE}&nowarn=1&input=touch`));
    await waitReady(p, 240000);
    await hook(p, 'await s.visible; return 0;');
    return p;
}

/** Open the pause menu and list its items' data-action. */
async function menuItems(p: Page): Promise<string[]> {
    await p.keyboard.press('KeyP');
    await p.waitForTimeout(300);
    return p.$$eval('[data-action^="pause."]', (els) => els.map((e) => e.getAttribute('data-action') ?? ''));
}

const { browser, which } = await launchChrome({ headless: false, args: ['--window-position=40,40', '--window-size=1296,920'] });
const out: Record<string, Any> = { site: SITE, browser: which, scene: SCENE };
try {
    // ---- A0: no hint, no admin call, no item
    {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
        const calls: Any[] = [];
        const p = await open(ctx, calls, false);
        await p.waitForTimeout(1500);
        const items = await menuItems(p);
        out.A0 = { calls, items, pass: calls.length === 0 && items.length > 3 && !items.includes('pause.sceneDefault') };
        await ctx.close();
    }
    // ---- A1: the hint and a live session
    {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
        await ctx.addInitScript(() => { try { localStorage.setItem('gsfpv.admin', '1'); } catch { /* none */ } });
        const calls: Any[] = [];
        const p = await open(ctx, calls, true);
        // fly something worth saving: walls off, a ceiling 0.2 m above the start, a custom wind
        await hook(p, `s.setWallsOn(false); h.ceiling.set(0.2); h.prefs.set('wind.mode', 'custom'); const sc = { scene: '${SCENE}' }; h.prefs.set('wind.fromDeg', 270, sc); h.prefs.set('wind.speed', 3, sc); h.prefs.set('wind.gust', 0, sc); await h.wind.apply(); await new Promise((r) => setTimeout(r, 100)); return 0;`);
        const flown = await hook(p, 'return h.sceneDefault.flown();');
        const offered = await hook<boolean>(p, 'return h.sceneDefault.offered();');
        const items = await menuItems(p);
        const label = await p.locator('[data-action="pause.sceneDefault"]').textContent().catch(() => null);
        await p.click('[data-action="pause.sceneDefault"]');
        await p.waitForFunction(() => { const n = document.querySelector('.hud-note'); return !!n && !(n as HTMLElement).hidden && /draft/.test(n.textContent ?? ''); }, null, { timeout: 10000 }).catch(() => null);
        const note = await p.locator('.hud-note').textContent();
        const post = calls.find((c) => c.method === 'POST' && c.path === '/api/admin/catalog/draft');
        const entry = post?.body?.catalog?.scenes?.find((x: Any) => x.id === SCENE);
        const other = post?.body?.catalog?.scenes?.find((x: Any) => x.id === OTHER.id);
        out.A1 = {
            flown, offered, items, label, calls: calls.map((c) => ({ method: c.method, path: c.path, csrf: c.csrf })), entry, other, note,
            pass: offered && items.includes('pause.sceneDefault') && !!label && !!post && post.csrf === CSRF
                && calls[0]?.path === '/api/admin/session' && calls.some((c) => c.method === 'GET' && c.path === '/api/admin/catalog')
                && entry?.walls === 'off' && entry?.ceilingM === flown.ceilingM && typeof flown.ceilingM === 'number'
                && JSON.stringify(entry?.wind) === JSON.stringify({ fromDeg: 270, speed: 3, gust: 0, source: 'manual' })
                && JSON.stringify(other) === JSON.stringify(OTHER) && /draft/.test(note ?? '')
        };
        // ---- L: the ceiling panel's legend
        await p.keyboard.press('Escape').catch(() => null);
        await hook(p, 'h.ceiling.open(); await new Promise((r) => setTimeout(r, 300)); return 0;');
        const keys = await p.$$eval('.ceiling-panel .ce-key', (els) => els.map((e) => { const r = e.getBoundingClientRect(); return { text: e.textContent, h: Math.round(r.height), lines: e.getClientRects().length }; }));
        const dir = join(REPO, 'evidence', today());
        mkdirSync(dir, { recursive: true });
        const shot = join(dir, 'v07-ceiling-legend.png');
        await p.locator('[data-testid="ceiling-panel"]').screenshot({ path: shot });
        out.L = { keys, screenshot: shot, oneLineEach: keys.length === 3 && keys.every((k: Any) => k.lines === 1 && k.h < 24) };
        await ctx.close();
    }
} catch (e) {
    out.error = String((e as Error)?.stack ?? e).slice(0, 2000);
} finally {
    out.pass = !out.error && out.A0?.pass === true && out.A1?.pass === true;
    const file = writeEvidence('v07-admin-default', out);
    console.log('v07 admin default', out.pass ? 'PASS' : 'FAIL', JSON.stringify({ A0: out.A0?.pass, A1: out.A1?.pass, legend: out.L?.oneLineEach, error: out.error?.slice(0, 300) }), '->', file);
    await browser.close();
}
