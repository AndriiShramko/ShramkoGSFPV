// v0.9 lane C acceptance in a real browser on a LOCAL release (docs/wip/v09-c.md): items 14, 15 and 17.
//   - the owner's admin saves a default Scene size per scene (the real admin page, the real API server on a
//     throwaway data folder, a made-up test password that exists only for this run; nothing leaves this machine),
//     Publish makes it public: GET /api/catalog lists a listed scene's size in "scenes" and a hidden scene's in
//     "defaults" (nothing else of it), the unpublished draft stays private;
//   - a deep link, a pasted superspl.at link and N / the scene switch open the scene at the owner's size, a
//     hidden scene too; the pilot's own saved size wins over it; a scene that was never configured stays at x1;
//   - the one-time macro note shows once for a scene that starts at x2 or more, never for an ordinary one;
//   - a share carries the sharer's settings that differ from the scene's defaults (the panel's state, the POST
//     body, the /s/<id> page's link); the receiver opens with them, sees the chip, and Reset gives his own back
//     without storing anything, Keep stores them; a scene switch ends the visit; a malformed link is ignored.
// The release is served the way nginx serves it (tools/bench/scripts/serve-csp.mjs, the enforced CSP) with
// /api/** proxied to the throwaway API. Parts A-C run the flight in the logic-only mode (?render=off: no GPU, the
// scan is not drawn); part D draws, takes the benches' GPU lock (C:/dev/.gpu-lock) and looks at the chip and the note.
//   node scripts/build-release.mjs                       (repo root; dist/)
//   cd tools/bench && npx tsx src/accept-v09-c.ts         (starts the API and the static server itself; both stopped at the end)
//   SKIP_D=1 skips the drawn part (no GPU lock); BASE_ROOT=<a checkout of the base commit with its dist/> is the negative control
// Evidence: evidence/<date>/v09-c-accept.json and v09-c-*.png.
import { spawn, execFileSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, rmdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser, BrowserContext, Page } from 'playwright';
import { launchChrome, waitReady } from './browser';
import { REPO, today, writeEvidence } from './evidence';

// BASE_ROOT: a checkout of the base commit with its own release in dist/ (the negative control: this script must fail on it)
const ROOT = (process.env.BASE_ROOT ?? REPO).replace(/\\/g, '/');
const DIST = (process.env.DIST ?? join(ROOT, 'dist')).replace(/\\/g, '/');
const API_PORT = 8100 + Math.floor(Math.random() * 800);
const SITE_PORT = 5400 + Math.floor(Math.random() * 500);
const API = `http://127.0.0.1:${API_PORT}`;
const SITE = `http://localhost:${SITE_PORT}`;
const GPU_LOCK = process.env.GPU_LOCK ?? 'C:/dev/.gpu-lock';
const LISTED = '39e63ce9'; // owner default x3, listed
const HIDDEN = '7a475d38'; // owner default x30, hidden from the picker
const PLAIN = '887f27aa'; // never configured
const FLY = (qs: string): string => `${SITE}/en/fly/?${qs}`;
const LOGIC = 'nowarn=1&input=touch&render=off';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const results: Record<string, Any> = {};
const checks: { name: string; ok: boolean; control: boolean }[] = [];
const children: ChildProcess[] = [];
const errors: string[] = [];
let haveLock = false;

function check(name: string, ok: boolean, control = false): void {
    checks.push({ name, ok, control });
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${control ? '[control] ' : ''}${name}`);
}

function cleanup(): void {
    for (const c of children) try { c.kill(); } catch { /* gone */ }
    if (haveLock) try { rmdirSync(GPU_LOCK); } catch { /* */ }
    haveLock = false;
}
process.on('exit', cleanup);

async function until(url: string, ms = 30000): Promise<void> {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
        try { if ((await fetch(url)).status < 500) return; } catch { /* not up yet */ }
        await sleep(250);
    }
    throw new Error(`${url} did not come up`);
}

async function takeGpuLock(): Promise<void> {
    for (;;) {
        try { mkdirSync(GPU_LOCK); haveLock = true; return; } catch { await sleep(5000); }
    }
}

/** One part of the run: an exception is a failed check with its message, not the end of the run (the base build must fail, not crash, the script). */
async function section(label: string, fn: () => Promise<void>): Promise<void> {
    try {
        await fn();
    } catch (e) {
        check(`${label} threw: ${String((e as Error)?.message ?? e).split('\n')[0].slice(0, 160)}`, false);
    }
}

const hook = <T = Any>(p: Page, body: string): Promise<T> => p.evaluate(`(async () => { const h = window.__gsfpv; ${body} })()`) as Promise<T>;

async function newCtx(browser: Browser, extra: (c: BrowserContext) => Promise<void> = async () => undefined): Promise<BrowserContext> {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    await extra(ctx);
    return ctx;
}

async function openFly(ctx: BrowserContext, qs: string): Promise<Page> {
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(`${qs.slice(0, 60)}: ${String(e.message).slice(0, 200)}`));
    await p.goto(FLY(qs));
    const r = await waitReady(p, 180000);
    if (r.status !== 'ready') throw new Error(`${qs}: status ${String(r.status)} ${String(r.error ?? '')}`);
    await hook(p, 'await h.session.visible; return 0;');
    return p;
}

const size = (p: Page): Promise<number> => hook<number>(p, 'return h.scale.size();');
const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-3 * Math.max(1, Math.abs(b));
const chipText = (p: Page): Promise<string | null> => p.locator('[data-testid=shared-chip] .sn-text').first().textContent({ timeout: 1500 }).catch(() => null);
const chipCount = (p: Page): Promise<number> => p.locator('[data-testid=shared-chip]').count();
const explicit = (p: Page): Promise<string[]> => hook<string[]>(p, 'h.prefs.flush(); return h.prefs.explicitList().map((e) => e.id + "@" + (e.key ?? "*"));');
const search = (p: Page): Promise<string> => p.evaluate(() => location.search);

async function main(): Promise<void> {
    console.log(`target: ${SITE} (local release ${DIST}; API ${API}; accept-v09-c reads SITE-less: it starts both)`);
    if (!existsSync(join(DIST, 'csp-hashes.conf'))) throw new Error(`no release in ${DIST}: run node scripts/build-release.mjs first`);
    mkdirSync(join(REPO, 'evidence', today()), { recursive: true });
    // the test password: made up for this run, only its hash goes to the throwaway API
    const password = `test-${randomBytes(12).toString('base64url')}`;
    const line = execFileSync('python', [join(REPO, 'tools', 'admin', 'hash_password.py'), '--stdin'], { input: `${password}\n` }).toString().trim();
    const hash = line.slice('ADMIN_PASSWORD_HASH='.length);
    const data = mkdtempSync(join(tmpdir(), 'gsfpv-v09c-api-'));
    const api = spawn('python', [join(ROOT, 'apps', 'api', 'server.py')], {
        env: { ...process.env, DATA_DIR: data, PORT: String(API_PORT), ADMIN_PASSWORD_HASH: hash, TG_BOT_TOKEN: '', TG_CHAT_ID: '', TG_OWNER_BOT_TOKEN: '', TG_WEBHOOK_SECRET: '', GMAIL_USER: '', GMAIL_APP_PASSWORD: '', MIN_FREE_GB: '0' },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    children.push(api);
    let apiLog = '';
    api.stdout!.on('data', (b) => { apiLog += String(b); });
    api.stderr!.on('data', (b) => { apiLog += String(b); });
    await until(`${API}/api/health`);
    const site = spawn('node', [join(REPO, 'tools', 'bench', 'scripts', 'serve-csp.mjs'), DIST, String(SITE_PORT)], { env: { ...process.env, API_PROXY: API }, stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(site);
    await until(`${SITE}/en/fly/`);
    results.target = { site: SITE, api: API, dist: DIST };

    const { browser, which } = await launchChrome({ headless: true });
    results.browser = which;
    try {
        // ======================================================================== A. the owner's admin
        await section('A admin', async () => {
        const admin = await newCtx(browser, async (c) => { await c.addInitScript({ content: "try { localStorage.setItem('gsfpv.warned', '1'); } catch (e) {}" }); });
        const a = await admin.newPage();
        a.on('pageerror', (e) => errors.push(`admin: ${String(e.message).slice(0, 200)}`));
        await a.goto(`${SITE}/admin/`);
        await a.waitForSelector('[data-testid=password]');
        await a.fill('[data-testid=password]', `${password}-wrong`);
        await a.press('[data-testid=password]', 'Enter');
        await a.waitForSelector('.login [role=alert]:not(:empty)');
        check('A0 a wrong password is refused in the page', (await a.$('[data-testid=scene-list]')) === null, true);
        // the form is busy until the refusal is drawn: type the real one when it takes input again (a loaded machine is slower)
        await a.waitForFunction(() => { const i = document.querySelector('[data-testid=password]') as HTMLInputElement | null; return !!i && !i.disabled; });
        await a.fill('[data-testid=password]', password);
        await a.press('[data-testid=password]', 'Enter');
        await a.waitForSelector('[data-testid=scene-list] li.row', { timeout: 60000 });
        const rows = await a.$$eval('[data-testid=scene-list] li.row', (els) => els.map((e) => e.getAttribute('data-scene') ?? ''));
        results.adminRows = rows;
        check('A1 the admin lists the seeded scenes, the three of this run among them', [LISTED, HIDDEN, PLAIN].every((id) => rows.includes(id)));
        const saved = (): Promise<unknown> => a.waitForFunction(() => {
            const s = document.querySelector('[data-testid=draft-status]');
            return s && !s.textContent?.includes('\u2026') && (s.classList.contains('warn') || s.classList.contains('ok'));
        }, null, { timeout: 15000 });
        const draftOf = (id: string): Promise<Any> => a.evaluate(async (sid) => {
            const j = await (await fetch('/api/admin/catalog')).json();
            return j.draft.scenes.find((s: { id: string }) => s.id === sid) ?? null;
        }, id);
        const publicCatalog = (): Promise<Any> => a.evaluate(async () => (await fetch('/api/catalog', { cache: 'no-store' })).json());

        await a.click(`li.row[data-scene="${LISTED}"] [data-action=edit]`);
        const field = a.locator(`li.row[data-scene="${LISTED}"] .editor [data-field=scale]`);
        check('A2 the scale field is in the scene editor, range 0.25..100', (await field.getAttribute('min')) === '0.25' && (await field.getAttribute('max')) === '100');
        await field.fill('3');
        await saved();
        check('A3 typing x3 saves it into the draft', (await draftOf(LISTED))?.scale === 3);
        await field.fill('150');
        await saved();
        check('A4 out of range (x150) is not saved: the field is dropped', (await draftOf(LISTED))?.scale === undefined, true);
        await field.fill('3');
        await saved();
        await a.click(`li.row[data-scene="${HIDDEN}"] [data-action=edit]`);
        await a.locator(`li.row[data-scene="${HIDDEN}"] .editor [data-field=scale]`).fill('30');
        await saved();
        check('A5 x30 (above the old x4 limit) saves', (await draftOf(HIDDEN))?.scale === 30);
        await a.click(`li.row[data-scene="${HIDDEN}"] [data-action=hide]`);
        await saved();
        check('A6 the scene can be hidden from the picker', (await draftOf(HIDDEN))?.hidden === true);

        const before = await publicCatalog();
        check('A7 before Publish the public catalogue knows nothing of the draft', before.defaults === undefined && before.scenes.find((s: Any) => s.id === LISTED)?.scale === undefined, true);
        await a.click('[data-action=publish]');
        await a.waitForFunction(() => document.querySelector('[data-testid=draft-status]')?.classList.contains('ok'), null, { timeout: 15000 });
        const pub = await publicCatalog();
        results.publicCatalog = { defaults: pub.defaults, listedScale: pub.scenes.find((s: Any) => s.id === LISTED)?.scale, hiddenInScenes: pub.scenes.some((s: Any) => s.id === HIDDEN) };
        check('A8 after Publish a listed scene carries its size in "scenes"', pub.scenes.find((s: Any) => s.id === LISTED)?.scale === 3);
        check('A9 a hidden scene is not in "scenes", its size is in "defaults" and nothing else of it is public', !pub.scenes.some((s: Any) => s.id === HIDDEN) && JSON.stringify(pub.defaults) === JSON.stringify({ [HIDDEN]: { scale: 30 } }));
        const hist = await a.$$eval('.history [data-version]', (els) => els.length);
        check('A10 the published version is in the history (undo)', hist === 1);
        await admin.close();
        });

        // ======================================================================== B. the pilot, logic only
        await section('block 1', async () => {
            const ctx = await newCtx(browser);
            const p = await openFly(ctx, `scene=${LISTED}&${LOGIC}`);
            const s1 = await size(p);
            const p2 = await openFly(ctx, `scene=${PLAIN}&${LOGIC}`);
            const s2 = await size(p2);
            results.B1 = { listed: s1, plain: s2 };
            check('B1 a deep link to a listed scene opens at the owner size x3', near(s1, 3));
            check('B1c a scene the owner never configured opens at x1', near(s2, 1), true);
            await ctx.close();
        });
        await section('block 2', async () => {
            const ctx = await newCtx(browser);
            const p = await openFly(ctx, `scene=${HIDDEN}&${LOGIC}`);
            results.B2 = { hidden: await size(p) };
            check('B2 a deep link to a HIDDEN scene opens at its public default x30', near(results.B2.hidden, 30));
            await ctx.close();
            const down = await newCtx(browser, async (c) => { await c.route('**/api/catalog', (r) => r.abort()); });
            const pd = await openFly(down, `scene=${HIDDEN}&${LOGIC}`);
            const sd = await size(pd);
            check('B2c with /api/catalog down (the static list) the same link opens at x1: the default comes from the API', near(sd, 1), true);
            await down.close();
        });
        await section('block 3', async () => {
            const ctx = await newCtx(browser);
            const pk = await ctx.newPage();
            pk.on('pageerror', (e) => errors.push(`picker: ${String(e.message).slice(0, 200)}`));
            await pk.goto(FLY('nowarn=1&input=touch&render=off'));
            await pk.waitForSelector('.scene-input');
            await pk.fill('.scene-input', `https://superspl.at/scene/${HIDDEN}?budget=8`);
            await pk.press('.scene-input', 'Enter');
            // the picker is itself "ready" (status picker): wait for the flight
            await pk.waitForFunction(() => { const s = (window as unknown as { __gsfpv?: { status?: string } }).__gsfpv?.status; return s === 'ready' || s === 'error'; }, null, { timeout: 180000 });
            const r = await waitReady(pk, 180000);
            await hook(pk, 'await h.session.visible; return 0;');
            results.B3 = { status: r.status, size: await size(pk), search: await search(pk) };
            check('B3 a pasted superspl.at link to the hidden scene opens at x30', r.status === 'ready' && near(results.B3.size, 30) && results.B3.search.includes(`scene=${HIDDEN}`));
            await ctx.close();
        });
        await section('block 4', async () => {
            const ctx = await newCtx(browser);
            const p = await openFly(ctx, `scene=${LISTED}&${LOGIC}`);
            const sizes: number[] = [await size(p)];
            for (const id of [HIDDEN, PLAIN, LISTED]) {
                await hook(p, `return await h.scenes.load('${id}', 'next');`);
                sizes.push(await size(p));
            }
            results.B4 = sizes;
            check('B4 switching scenes in the page (N / auto-switch use the same load) starts each at its own size', near(sizes[0], 3) && near(sizes[1], 30) && near(sizes[2], 1) && near(sizes[3], 3));
            await ctx.close();
        });
        await section('block 5', async () => {
            const ctx = await newCtx(browser);
            let p = await openFly(ctx, `scene=${LISTED}&${LOGIC}`);
            await hook(p, `h.prefs.set('scene.transform', { s: 2, t: [0, 0, 0], v: 0 }, { scene: '${LISTED}' }); h.prefs.flush(); return 0;`);
            await p.close();
            p = await openFly(ctx, `scene=${LISTED}&${LOGIC}`);
            const own = await size(p);
            await hook(p, `h.prefs.reset('scene.transform', { scene: '${LISTED}' }); h.prefs.flush(); return 0;`);
            await p.close();
            p = await openFly(ctx, `scene=${LISTED}&${LOGIC}`);
            const back = await size(p);
            results.B5 = { own, back };
            check('B5 the pilot\'s own saved size (x2) wins over the owner\'s x3; after his reset the owner\'s default is back', near(own, 2) && near(back, 3));
            await ctx.close();
        });
        await section('block 6', async () => {
            const ctx = await newCtx(browser);
            const p = await openFly(ctx, `scene=${LISTED}&${LOGIC}`);
            await p.waitForSelector('[data-testid=macro-hint]', { timeout: 8000 }).catch(() => undefined);
            const txt = await p.locator('[data-testid=macro-hint] .sn-text').textContent().catch(() => null);
            const seen = await p.evaluate(() => { try { return localStorage.getItem('gsfpv.hint.macro'); } catch { return 'blocked'; } });
            await p.close();
            const again = await openFly(ctx, `scene=${LISTED}&${LOGIC}`);
            await again.waitForTimeout(2500);
            const second = await again.locator('[data-testid=macro-hint]').count();
            results.B6 = { txt, seen, second };
            check('B6 a scene that starts at x3 says once what that means', !!txt && /x3/.test(txt) && !txt.startsWith('scale.') && seen === '1');
            check('B6b ... and not again on the next visit', second === 0, true);
            await ctx.close();
            const c2 = await newCtx(browser);
            const q = await openFly(c2, `scene=${PLAIN}&${LOGIC}`);
            await q.waitForTimeout(2500);
            check('B6c an ordinary scene (x1) never shows it', (await q.locator('[data-testid=macro-hint]').count()) === 0, true);
            await c2.close();
        });

        // ======================================================================== C. a shared link
        const SHARED = 'sz=5&wl=0&fl=4&wd=270,4,2&ce=12.5';
        await section('block 7', async () => {
            // the sender: what he flies that differs from the scene's defaults, as the panel would carry it (no picture in this mode: the plain link)
            const ctx = await newCtx(browser);
            const p = await openFly(ctx, `scene=${LISTED}&${LOGIC}`);
            const none = await hook<string>(p, `h.share.open('top'); await new Promise((r) => setTimeout(r, 600)); return h.share.state().shared;`);
            await p.keyboard.press('Escape');
            await hook(p, `const sc = { scene: '${LISTED}' }; h.prefs.set('scene.transform', { s: 5, t: [0, 0, 0], v: 0 }, sc); h.prefs.set('scene.walls', 'off'); h.prefs.set('scene.dropFloaters', 4, sc); h.prefs.set('scene.ceiling', 'custom', sc); h.prefs.set('scene.ceilingM', 12.5, sc); h.prefs.set('wind.mode', 'custom'); h.prefs.set('wind.fromDeg', 270, sc); h.prefs.set('wind.speed', 4, sc); h.prefs.set('wind.gust', 2, sc); return 0;`);
            await p.waitForTimeout(500);
            const st = await hook<Any>(p, `h.share.open('key'); await new Promise((r) => setTimeout(r, 1200)); return h.share.state();`);
            results.C0 = { none, shared: st?.shared, url: st?.url };
            check('C0a a pilot who changed nothing shares nothing extra (his link is the plain scene page)', none === '', true);
            check('C0 what he flies that differs from the scene\'s defaults is in the share, in the link\'s order', st?.shared === SHARED && /\/s\/[A-Za-z0-9_-]{11}$/.test(st?.url ?? ''));
            await ctx.close();
        });
        await section('block 8', async () => {
            // the receiver opens the link: flies with them, sees the chip, his saved prefs untouched
            const ctx = await newCtx(browser);
            const p = await openFly(ctx, `scene=${LISTED}&${SHARED}&${LOGIC}`);
            const f = await hook<Any>(p, `const s = h.session; return { size: h.scale.size(), walls: s.wallsOn, floaters: s.floaterMinBlocks, ceiling: s.ceilingM, wind: s.windSpec && { from: s.windSpec.fromDeg, speed: s.windSpec.speed, gust: s.windSpec.gust, source: s.windSpec.source } };`);
            const chip = await chipText(p);
            const own = await explicit(p);
            results.C1 = { flown: f, chip, explicit: own, search: await search(p) };
            check('C1 the scene opens with the shared size x5, walls off, cleanup 4, ceiling, wind', near(f.size, 5) && f.walls === false && f.floaters === 4 && near(f.ceiling, 12.5) && f.wind?.source === 'custom' && f.wind.speed === 4);
            check('C1b the chip names them in words (no raw key)', !!chip && /x5/.test(chip) && /walls off/.test(chip) && !chip.includes('shared.') && (await chipCount(p)) === 1);
            check('C1c the pilot\'s saved settings are untouched', own.length === 0);
            // Reset: his own again (the owner default x3, walls on...), live, nothing stored, the address clean
            await p.click('[data-action=shared-reset]');
            await p.waitForTimeout(800);
            const g = await hook<Any>(p, `const s = h.session; return { size: h.scale.size(), walls: s.wallsOn, floaters: s.floaterMinBlocks, ceiling: s.ceilingM, wind: s.windSpec };`);
            const after = { chips: await chipCount(p), explicit: await explicit(p), search: await search(p) };
            results.C2 = { flown: g, ...after };
            check('C2 Reset gives his own settings back live: x3, walls on, no cleanup, no ceiling, no wind', near(g.size, 3) && g.walls === true && g.floaters === 0 && g.ceiling === null && g.wind === null);
            check('C2b ... the chip is gone, nothing was stored, the address lost the parameters', after.chips === 0 && after.explicit.length === 0 && !/(^|[?&])(sz|wl|fl|wd|ce)=/.test(after.search));
            await ctx.close();
        });
        await section('block 9', async () => {
            // Keep: they become his own
            const ctx = await newCtx(browser);
            const p = await openFly(ctx, `scene=${LISTED}&${SHARED}&${LOGIC}`);
            await p.click('[data-action=shared-keep]');
            await p.waitForTimeout(500);
            const ex = await explicit(p);
            await p.close();
            const q = await openFly(ctx, `scene=${LISTED}&${LOGIC}`);
            const f = await hook<Any>(q, `const s = h.session; return { size: h.scale.size(), walls: s.wallsOn, floaters: s.floaterMinBlocks, ceiling: s.ceilingM };`);
            results.C3 = { explicit: ex, next: f };
            check('C3 Keep stores the settings as his own', ex.includes(`scene.transform@${LISTED}`) && ex.includes('scene.walls@*') && ex.includes(`scene.dropFloaters@${LISTED}`));
            check('C3b ... and the next plain visit flies with them', near(f.size, 5) && f.walls === false && f.floaters === 4 && near(f.ceiling, 12.5) && (await chipCount(q)) === 0);
            await ctx.close();
        });
        await section('block 10', async () => {
            // precedence: his own saved x2, a link with x5, Reset -> x2 (his own, not the owner's x3)
            const ctx = await newCtx(browser);
            let p = await openFly(ctx, `scene=${LISTED}&${LOGIC}`);
            await hook(p, `h.prefs.set('scene.transform', { s: 2, t: [0, 0, 0], v: 0 }, { scene: '${LISTED}' }); h.prefs.flush(); return 0;`);
            await p.close();
            p = await openFly(ctx, `scene=${LISTED}&sz=5&${LOGIC}`);
            const shared = await size(p);
            await p.click('[data-action=shared-reset]');
            await p.waitForTimeout(600);
            const own = await size(p);
            results.C4 = { shared, own };
            check('C4 a shared size beats his saved size for the visit, and Reset restores HIS (x2), not the default', near(shared, 5) && near(own, 2));
            await ctx.close();
        });
        await section('block 11', async () => {
            // a scene switch ends the visit; coming back is the scene's default, not the link's
            const ctx = await newCtx(browser);
            const p = await openFly(ctx, `scene=${LISTED}&${SHARED}&${LOGIC}`);
            await hook(p, `return await h.scenes.load('${PLAIN}', 'next');`);
            const gone = { chips: await chipCount(p), search: await search(p), size: await size(p) };
            await hook(p, `return await h.scenes.load('${LISTED}', 'back');`);
            const back = { chips: await chipCount(p), size: await size(p) };
            results.C5 = { gone, back };
            check('C5 N / a scene switch ends the visit: no chip, the parameters are out of the address, the next scene is x1', gone.chips === 0 && !/(^|[?&])(sz|wl|fl|wd|ce)=/.test(gone.search) && near(gone.size, 1));
            check('C5b ... and coming back opens the scene\'s own default x3, not the link\'s x5', back.chips === 0 && near(back.size, 3));
            await ctx.close();
        });
        await section('block 12', async () => {
            // the pilot changes a shared setting himself: the chip names what is still shared; none left, no chip
            const ctx = await newCtx(browser);
            const p = await openFly(ctx, `scene=${LISTED}&sz=5&wl=0&${LOGIC}`);
            await hook(p, 'h.scale.set(7); return 0;');
            await p.waitForTimeout(400);
            const t1 = await chipText(p);
            await hook(p, `h.prefs.set('scene.walls', 'on'); return 0;`);
            await p.waitForTimeout(400);
            results.C6 = { after: t1, left: await chipCount(p), size: await size(p) };
            check('C6 his own change of the size takes it out of the chip, the walls stay named', !!t1 && !/x5|x7/.test(t1) && /walls off/.test(t1) && near(results.C6.size, 7));
            check('C6b with nothing shared left the chip goes', results.C6.left === 0);
            await ctx.close();
        });
        await section('block 13', async () => {
            // malformed values are ignored (the rest of the link still counts)
            const ctx = await newCtx(browser);
            const p = await openFly(ctx, `scene=${LISTED}&sz=999&wl=2&fl=65&wd=1,2&ce=1e3&drone=../x&${LOGIC}`);
            const s0 = await size(p);
            results.C7 = { size: s0, chips: await chipCount(p) };
            check('C7 malformed shared parameters are ignored: the scene opens at its default and no chip is offered', near(s0, 3) && (await chipCount(p)) === 0, true);
            await ctx.close();
            const c2 = await newCtx(browser);
            const q = await openFly(c2, `scene=${LISTED}&sz=999&wl=1&${LOGIC}`);
            const chip = await chipText(q);
            check('C7b a valid parameter next to a malformed one still counts', !!chip && /walls on/.test(chip) && near(await size(q), 3));
            await c2.close();
        });

        // ======================================================================== D. drawn: the hidden scene at x30, a share with its picture, the look
        if (!process.env.SKIP_D) await section('D drawn', async () => {
        await takeGpuLock();
        const drawn = await launchChrome({ headless: false, args: ['--window-position=40,40', '--window-size=1296,920'] });
        try {
            const ctx = await drawn.browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
            const p = await ctx.newPage();
            p.on('pageerror', (e) => errors.push(`drawn: ${String(e.message).slice(0, 200)}`));
            await p.goto(FLY(`scene=${HIDDEN}&nowarn=1&input=touch`));
            const r = await waitReady(p, 240000);
            await hook(p, 'await h.session.visible; return 0;');
            await p.waitForTimeout(3500);
            const d1 = await hook<Any>(p, 'return { size: h.scale.size(), render: h.info.render, frames: h.session.frames ?? null };');
            const shot = join(REPO, 'evidence', today(), 'v09-c-macro-x30.png');
            await p.screenshot({ path: shot });
            results.D1 = { status: r.status, ...d1, screenshot: shot, note: await p.locator('[data-testid=macro-hint] .sn-text').textContent().catch(() => null) };
            check('D1 the hidden scene opens drawn at x30 (the engine takes the scene transform)', r.status === 'ready' && d1.render === 'on' && near(d1.size, 30));
            await ctx.close();

            const c2 = await drawn.browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
            const q = await c2.newPage();
            q.on('pageerror', (e) => errors.push(`drawn2: ${String(e.message).slice(0, 200)}`));
            await q.goto(FLY(`scene=${LISTED}&nowarn=1&input=touch`));
            await waitReady(q, 240000);
            await hook(q, 'await h.session.visible; return 0;');
            await hook(q, `const sc = { scene: '${LISTED}' }; h.prefs.set('scene.transform', { s: 5, t: [0, 0, 0], v: 0 }, sc); h.prefs.set('scene.walls', 'off'); return 0;`);
            await q.waitForTimeout(1500);
            const st = await hook<Any>(q, `h.share.open('top'); for (let i = 0; i < 60 && !(h.share.state() && h.share.state().url); i++) await new Promise((r) => setTimeout(r, 250)); return h.share.state();`);
            results.D2 = { url: st?.url, shared: st?.shared, picture: st?.picture };
            const sid = /\/s\/([A-Za-z0-9_-]{11})$/.exec(st?.url ?? '')?.[1];
            check('D2 a share from the flight makes the picture page and carries the settings', !!sid && st.shared === 'sz=5&wl=0');
            if (sid) {
                const page = await (await fetch(`${API}/s/${sid}`)).text();
                results.D2.link = /href="(\/en\/fly\/[^"]*)"/.exec(page)?.[1] ?? null;
                check('D2b the /s/<id> page sends a visitor on to the scene with the same settings', results.D2.link === `/en/fly/?scene=${LISTED}&amp;sz=5&amp;wl=0`);
            }
            await c2.close();

            const c3 = await drawn.browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
            const r3 = await c3.newPage();
            r3.on('pageerror', (e) => errors.push(`drawn3: ${String(e.message).slice(0, 200)}`));
            await r3.goto(FLY(`scene=${LISTED}&${SHARED}&nowarn=1&input=touch`));
            await waitReady(r3, 240000);
            await hook(r3, 'await h.session.visible; return 0;');
            await r3.waitForTimeout(3500);
            const shot3 = join(REPO, 'evidence', today(), 'v09-c-shared-chip.png');
            await r3.screenshot({ path: shot3 });
            const box = await r3.locator('[data-testid=shared-chip]').boundingBox();
            results.D3 = { chip: await chipText(r3), box, screenshot: shot3 };
            check('D3 drawn: the chip sits inside the view (screenshot kept for the eyes)', !!box && box.x >= 0 && box.x + box.width <= 1280 && box.y >= 0 && box.y + box.height <= 800);
            await c3.close();
        } finally {
            await drawn.browser.close();
            try { rmdirSync(GPU_LOCK); } catch { /* */ }
            haveLock = false;
        }
        });
    } finally {
        await browser.close();
    }

    // The base build raises the same "reading 'armed'" error every frame after an in-page scene switch with the touch sticks
    // in the logic-only mode (v09-c-accept-base-control.json: 717 of them); it is the input's (play/easy.ts send on a session
    // without a model), not this lane's, so it is listed apart and every other error still fails the run.
    const known = errors.filter((e) => /reading 'armed'/.test(e));
    const fresh = errors.filter((e) => !/reading 'armed'/.test(e));
    check('no page errors on any page of the run (the base build\'s own "armed" error after a scene switch left out, counted apart)', fresh.length === 0);
    results.pageErrors = fresh;
    results.knownBaseErrors = { armedAfterSceneSwitch: known.length };
    results.apiLogTail = apiLog.split('\n').slice(-8);
    const failed = checks.filter((c) => !c.ok);
    const out = { site: SITE, checks, passed: checks.length - failed.length, failed: failed.map((c) => c.name), results };
    const file = writeEvidence(process.env.BASE_ROOT ? 'v09-c-accept-base-control' : 'v09-c-accept', out);
    console.log(`\n${checks.length - failed.length}/${checks.length} checks passed; evidence ${file}`);
    rmSync(data, { recursive: true, force: true });
    cleanup();
    process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
    console.error(e);
    cleanup();
    process.exit(2);
});
