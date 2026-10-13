// v0.7 lane A end to end in a browser (docs/wip/v07-a.md): the owner's item 4 (every published scene is in
// the picker, scenes without walls with a badge, the walls filter only where it applies), the admin's
// draft-vs-live view, "Refresh from SuperSplat", "Add a scene" with SuperSplat's facts and a link's
// budget/stochastic, the place and wind editor (Find place, prevailing wind), publish, and the scene page
// the API renders into the site build's template (screenshot with the site's own CSS).
// The real API (apps/api/server.py) runs here on a temporary DATA_DIR seeded with the live catalogue's
// snapshot and a TEST password hash (the v06 bench's .cache/admin-test.json); SuperSplat's facts, Open-Meteo
// and the scene CDN are the real services (a handful of requests). Every check has a negative control.
//   cd apps/fly && npx vite --port 5362 --strictPort --host 127.0.0.1                 (another shell)
//   pnpm --filter @gsfpv/site build                                                    (the scene templates)
//   FLY=http://127.0.0.1:5362 npx tsx src/accept-v07-catalogue.ts                      (from tools/bench)
// Evidence: evidence/<date>/v07-catalogue.json + PNGs.
import { spawn, execFileSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import type { BrowserContext, Page } from 'playwright';
import { launchChrome } from './browser';
import { REPO, today, writeEvidence } from './evidence';

const FLY = (process.env.FLY ?? 'http://127.0.0.1:5362').replace(/\/$/, '');
const API_PORT = 8000 + Math.floor(Math.random() * 900);
const SITE_PORT = API_PORT + 1000;
const API = `http://127.0.0.1:${API_PORT}`;
const SITE = `http://127.0.0.1:${SITE_PORT}`;
const TEMPLATES = join(REPO, 'apps', 'site', 'out', 'scene-templates');
const TMP = process.env.GSFPV_TMP ?? join(REPO, '.cache');
mkdirSync(TMP, { recursive: true });
const DATA = mkdtempSync(join(TMP, 'gsfpv-v07-api-'));
const NEW_SCENE = '2f1ddf5f'; // the owner's stochastic example (message 18, item 1)
/** the admin page's English words (the browser here asks for English): what the owner reads, checked as text */
const ADMIN_EN: Record<string, string> = JSON.parse(readFileSync(join(REPO, 'packages', 'i18n', 'locales', 'admin', 'en.json'), 'utf8'));
/** a raw dictionary key, an unfilled placeholder or a bare field identifier where the owner should read a word */
const RAW_WORDS = /\badmin\.|\{\w+\}|\b(pinned|geo|wind|render|collections|defaultDrone|license|about|origin|extentM|sizeMb|voxelCm|true|false)\b/;
/** the field part of a Refresh row ("Licence: (empty) -> CC BY 4.0" -> "Licence"); the values are SuperSplat's own words */
const rowField = (row: string): string => row.split(': ')[0];
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const results: Record<string, Any> = {};
const checks: { name: string; ok: boolean; control: boolean }[] = [];
const children: ChildProcess[] = [];

function check(name: string, ok: boolean, control = false): void {
    checks.push({ name, ok, control });
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${control ? '[control] ' : ''}${name}`);
}

function testSecret(): { password: string; hash: string } {
    const f = join(REPO, '.cache', 'admin-test.json');
    if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'));
    const password = `test-${randomBytes(12).toString('base64url')}`;
    const line = execFileSync('python', [join(REPO, 'tools', 'admin', 'hash_password.py'), '--stdin'], { input: `${password}\n` }).toString().trim();
    const s = { password, hash: line.slice('ADMIN_PASSWORD_HASH='.length) };
    mkdirSync(join(REPO, '.cache'), { recursive: true });
    writeFileSync(f, JSON.stringify(s));
    return s;
}

async function until(url: string, ms = 20000): Promise<void> {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
        try { if ((await fetch(url)).status < 500) return; } catch { /* not up yet */ }
        await sleep(250);
    }
    throw new Error(`${url} did not come up`);
}

/** /api/** and the scene pages of `origin` go to the local API with the page's own cookie, CSRF and cache headers. */
async function routeApi(ctx: BrowserContext, origin: string, seen: string[]): Promise<void> {
    await ctx.route((u) => u.origin === origin && (u.pathname.startsWith('/api/') || /^\/(en|es|pl|ru)\/scenes\//.test(u.pathname)), async (route) => {
        const req = route.request();
        const u = new URL(req.url());
        const inH = await req.allHeaders();
        const headers: Record<string, string> = { 'X-Forwarded-For': '198.51.100.1' };
        for (const k of ['content-type', 'cookie', 'x-csrf', 'if-none-match']) if (inH[k]) headers[k] = inH[k];
        const raw = req.postDataBuffer();
        const r = await fetch(API + u.pathname + u.search, { method: req.method(), headers, body: req.method() === 'POST' && raw ? new Uint8Array(raw) : undefined });
        seen.push(`${req.method()} ${u.pathname}${u.search} ${r.status}`);
        const out: Record<string, string> = {};
        for (const k of ['content-type', 'cache-control', 'etag', 'retry-after', 'set-cookie', 'content-security-policy']) { const v = r.headers.get(k); if (v) out[k] = v; }
        await route.fulfill({ status: r.status, headers: out, body: Buffer.from(await r.arrayBuffer()) });
    });
}

const ids = (page: Page, sel: string): Promise<string[]> => page.$$eval(sel, (els) => els.map((e) => e.getAttribute('data-scene') ?? ''));
const saved = (page: Page): Promise<unknown> => page.waitForFunction(() => {
    const s = document.querySelector('[data-testid=draft-status]');
    return s && !s.textContent?.includes('…') && (s.classList.contains('warn') || s.classList.contains('ok'));
}, null, { timeout: 20000 });

async function picker(page: Page): Promise<void> {
    await page.goto(`${FLY}/fly/?nowarn=1`);
    await page.waitForFunction(() => (window as unknown as { __gsfpv?: { status?: string } }).__gsfpv?.status === 'picker', null, { timeout: 60000 });
}

async function main(): Promise<void> {
    const secret = testSecret();
    mkdirSync(join(REPO, 'evidence', today()), { recursive: true });
    if (!existsSync(join(TEMPLATES, 'manifest.json'))) throw new Error('no scene templates: run pnpm --filter @gsfpv/site build first');
    // the live catalogue as the landing's snapshot has it (the owner's two scenes without walls among them)
    const snap = JSON.parse(readFileSync(join(REPO, 'apps', 'site', 'src', 'generated', 'catalog.json'), 'utf8'));
    writeFileSync(join(DATA, 'catalog.json'), JSON.stringify({ v: 1, published: snap.published, collections: snap.collections, scenes: snap.scenes }));
    const noWalls = (snap.scenes as Any[]).filter((s) => s.collision === false).map((s) => s.id as string);
    results.noWalls = noWalls;
    const api = spawn('python', [join(REPO, 'apps', 'api', 'server.py')], {
        env: { ...process.env, DATA_DIR: DATA, PORT: String(API_PORT), ADMIN_PASSWORD_HASH: secret.hash, TG_BOT_TOKEN: '', TG_CHAT_ID: '', MIN_FREE_GB: '0',
               SCENE_TEMPLATES: TEMPLATES, PUBLIC_ORIGIN: 'https://gsfpv.flyreelstudio.eu' },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    children.push(api);
    let apiLog = '';
    api.stdout.on('data', (b) => { apiLog += String(b); });
    api.stderr.on('data', (b) => { apiLog += String(b); });
    const site = spawn('python', ['-m', 'http.server', String(SITE_PORT), '--bind', '127.0.0.1', '--directory', join(REPO, 'apps', 'site', 'out')], { stdio: 'ignore' });
    children.push(site);
    await until(`${API}/api/health`);
    await until(`${SITE}/en/`);

    const { browser, which } = await launchChrome({ headless: true });
    results.browser = which;
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript({ content: "try { localStorage.setItem('gsfpv.warned', '1'); } catch (e) {}" });
    const seen: string[] = [];
    await routeApi(ctx, new URL(FLY).origin, seen);
    await routeApi(ctx, SITE, seen);
    const errors: string[] = [];
    const pilot = await ctx.newPage();
    const admin = await ctx.newPage();
    for (const p of [admin, pilot]) p.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)));

    // ---- item 4: the catalogue tab under the default filter (walls only) ----
    await picker(pilot);
    const grid = await ids(pilot, '.scene-grid .scene-card[data-scene]');
    results.pickerGrid = grid;
    check('the default filter is "walls only"', await pilot.$eval('#f-col', (e) => (e as HTMLInputElement).checked));
    check('every published scene is in the catalogue tab, the two without walls too', (snap.scenes as Any[]).every((s) => grid.includes(s.id)) && noWalls.length === 2);
    check('a scene without walls carries the "no walls" badge', await pilot.$$eval(noWalls.map((id) => `.scene-card[data-scene="${id}"] .sf-badge.nowalls`).join(','), (els) => els.length) === noWalls.length);
    check('the walls filter is not shown on the catalogue tab', await pilot.$eval('label[for=f-col]', (e) => (e as HTMLElement).hidden === true));
    await pilot.click('.tab[data-tab=recent]');
    check('control: the walls filter shows on Recent, where it applies', !(await pilot.$eval('label[for=f-col]', (e) => (e as HTMLElement).hidden === true)), true);
    await pilot.screenshot({ path: join(REPO, 'evidence', today(), 'v07-picker.png') });

    // ---- the admin: clean draft, then changes on screen ----
    await admin.goto(`${FLY}/fly/admin/`);
    await admin.fill('[data-testid=password]', secret.password);
    await admin.press('[data-testid=password]', 'Enter');
    await admin.waitForSelector('[data-testid=scene-list] li.row');
    check('control: a clean draft has Publish off and no change list', await admin.$eval('[data-action=publish]', (b) => (b as HTMLButtonElement).disabled)
        && await admin.$eval('[data-testid=draft-changes]', (e) => (e as HTMLElement).hidden === true), true);
    const pinId = (await ids(admin, '[data-testid=scene-list] li.row'))[1];
    await admin.click(`li.row[data-scene="${pinId}"] [data-action=pin]`);
    await saved(admin);
    const bar = await admin.$eval('[data-action=publish]', (b) => ({ disabled: (b as HTMLButtonElement).disabled, attention: b.classList.contains('attention'), text: b.textContent }));
    results.publishAfterPin = bar;
    check('one change: Publish is on, highlighted and counts it', !bar.disabled && bar.attention && /\(1\)/.test(bar.text ?? ''));
    const changeText = await admin.$eval(`[data-testid=draft-changes] li[data-change=changed][data-scene="${pinId}"]`, (e) => e.textContent ?? '').catch(() => '');
    results.changeText = changeText;
    check('the change list names the scene and the field in words ("Featured", not "pinned")', changeText.includes(ADMIN_EN['admin.key.pinned']) && !RAW_WORDS.test(changeText));
    check('the changed row carries a badge', await admin.$eval(`li.row[data-scene="${pinId}"] .change-badge.changed`, (e) => !(e as HTMLElement).hidden === true).catch(() => false));

    // ---- Refresh from SuperSplat on the Muster Truck Show (its licence is empty in the catalogue) ----
    const muster = '0230d903';
    await admin.click(`li.row[data-scene="${muster}"] [data-action=edit]`);
    await admin.click(`li.row[data-scene="${muster}"] [data-action=refresh]`);
    await admin.waitForSelector(`li.row[data-scene="${muster}"] [data-refresh]`, { timeout: 30000 });
    const offered = await admin.$$eval(`li.row[data-scene="${muster}"] [data-refresh]`, (els) => els.map((e) => [e.getAttribute('data-refresh'), (e as HTMLInputElement).checked]));
    results.refreshOffered = offered;
    check('Refresh offers the licence from SuperSplat, ticked; the title unticked', offered.some(([f, c]) => f === 'license' && c) && !offered.some(([f, c]) => f === 'title' && c));
    const rowText = await admin.$$eval(`li.row[data-scene="${muster}"] label.refresh-row`, (els) => els.map((e) => e.textContent ?? ''));
    results.refreshRows = rowText;
    const licRow = rowText.find((x) => x.includes(ADMIN_EN['admin.key.license'])) ?? '';
    check('each Refresh row reads "field: old -> new" in words (the licence row: its name, "(empty)" and the new licence)',
        rowText.length === offered.length && rowText.every((x) => x.includes('\u2192') && !RAW_WORDS.test(rowField(x)) && !/\badmin\.|\{\w+\}|\[object/.test(x))
        && licRow.includes(ADMIN_EN['admin.refresh.empty']) && /CC|BY|MIT|licen/i.test(licRow.split('\u2192')[1] ?? ''));
    check('control: the raw-key detector fires on what the first cut showed', RAW_WORDS.test(rowField('admin.refresh.field')) && RAW_WORDS.test('Changed: Modlinek (pinned, geo)') && !RAW_WORDS.test(rowField(`${ADMIN_EN['admin.key.license']}: x`)), true);
    await admin.click(`li.row[data-scene="${muster}"] [data-action=refresh-apply]`);
    await saved(admin);

    // ---- place, wind: Find place and the prevailing wind for Wroclaw ----
    const wroclaw = '70b50d42';
    await admin.click(`li.row[data-scene="${wroclaw}"] [data-action=edit]`);
    const ed = `li.row[data-scene="${wroclaw}"] [data-testid=place-editor]`;
    check('control: without a place the prevailing wind cannot be asked', await admin.$eval(`${ed} [data-action=climate]`, (b) => (b as HTMLButtonElement).disabled), true);
    await admin.fill(`${ed} [data-field=find-place]`, 'Wroclaw');
    await admin.click(`${ed} [data-action=find-place]`);
    await admin.waitForSelector(`${ed} [data-place]`, { timeout: 30000 });
    results.places = await admin.$$eval(`${ed} [data-place]`, (els) => els.map((e) => e.getAttribute('data-place')));
    await admin.click(`${ed} [data-place]`);
    check('Find place fills latitude and longitude', Number(await admin.inputValue(`${ed} [data-field=lat]`)) > 50 && Number(await admin.inputValue(`${ed} [data-field=lon]`)) > 16);
    await admin.click(`${ed} [data-action=climate]`);
    await admin.waitForFunction((sel) => (document.querySelector(`${sel} [data-field=windFrom]`) as HTMLInputElement | null)?.value !== '', ed, { timeout: 60000 });
    results.wind = { from: await admin.inputValue(`${ed} [data-field=windFrom]`), speed: await admin.inputValue(`${ed} [data-field=windSpeed]`), gust: await admin.inputValue(`${ed} [data-field=windGust]`) };
    check('the prevailing wind fills the wind fields', Number(results.wind.speed) > 0 && Number(results.wind.from) >= 0);
    await admin.fill(`${ed} [data-about=en]`, 'Fly low along the river front, then up between the two towers.');
    await saved(admin);

    // ---- Add a scene by a link with SuperSplat's drawing parameters ----
    await admin.fill('[data-testid=add-input]', `https://superspl.at/scene/${NEW_SCENE}?budget=8&stochastic`);
    await admin.click('[data-action=find]');
    await admin.waitForSelector('[data-testid=add-preview] [data-action=add]', { timeout: 60000 });
    results.addPreview = await admin.$eval('[data-testid=add-preview]', (e) => e.textContent);
    check('the preview shows SuperSplat\'s facts', await admin.$('[data-testid=add-facts]') !== null);
    check('the preview keeps the link\'s budget and stochastic', /8/.test(await admin.$eval('[data-testid=add-render]', (e) => e.textContent ?? '').catch(() => '')));
    await admin.click('[data-testid=add-preview] [data-action=add]');
    await saved(admin);
    await admin.screenshot({ path: join(REPO, 'evidence', today(), 'v07-admin.png'), fullPage: false });
    await admin.click('[data-action=publish]');
    await admin.waitForFunction(() => document.querySelector('[data-testid=draft-status]')?.classList.contains('ok'), null, { timeout: 20000 });
    check('after Publish: Publish is off again', await admin.$eval('[data-action=publish]', (b) => (b as HTMLButtonElement).disabled));

    const live = JSON.parse(readFileSync(join(DATA, 'catalog.json'), 'utf8'));
    const byId = new Map((live.scenes as Any[]).map((s) => [s.id, s]));
    results.live = { muster: byId.get(muster), wroclaw: byId.get(wroclaw), added: byId.get(NEW_SCENE) };
    check('published: the refreshed licence and SuperSplat\'s origin', byId.get(muster)?.license === 'CC BY 4.0' && byId.get(muster)?.origin?.url === `https://superspl.at/scene/${muster}`);
    check('published: geo, a climate wind and our words', !!byId.get(wroclaw)?.geo && byId.get(wroclaw)?.wind?.source === 'climate' && !!byId.get(wroclaw)?.about?.en);
    check('published: the added scene with render {budgetM 8, stochastic} and origin', byId.get(NEW_SCENE)?.render?.budgetM === 8 && byId.get(NEW_SCENE)?.render?.stochastic === true && !!byId.get(NEW_SCENE)?.origin);

    // ---- the pilot sees it; the scene pages and the wind route answer ----
    await picker(pilot);
    check('the picker shows the scene added and published from the admin', (await ids(pilot, '.scene-grid .scene-card[data-scene]')).includes(NEW_SCENE));
    const wind = await (await fetch(`${API}/api/wind/${wroclaw}?mode=now`)).json();
    results.windNow = wind;
    check('/api/wind/<id>?mode=now answers for a scene with geo', wind.ok === true && wind.source === 'now' && typeof wind.speed === 'number');
    check('control: /api/wind for a scene without geo is 404', (await fetch(`${API}/api/wind/${muster}?mode=now`)).status === 404, true);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)));
    const resp = await page.goto(`${SITE}/en/scenes/${wroclaw}/`);
    const html = await page.content();
    results.scenePage = { status: resp?.status(), csp: resp?.headers()['content-security-policy'] };
    check('the scene page renders with the site\'s design (its CSS loaded)', resp?.status() === 200 && await page.evaluate(() => getComputedStyle(document.body).backgroundColor) === 'rgb(7, 8, 10)');
    check('the scene page carries the curator\'s words, the wind and the credit', html.includes('Fly low along the river front') && /from the|Prevailing wind/.test(html) && html.includes('superspl.at/scene/70b50d42'));
    check('the scene page runs no script', (await page.$$eval('script:not([type="application/ld+json"])', (els) => els.length)) === 0);
    await page.screenshot({ path: join(REPO, 'evidence', today(), 'v07-scene-page.png'), fullPage: true });
    await page.goto(`${SITE}/pl/scenes/`);
    await page.screenshot({ path: join(REPO, 'evidence', today(), 'v07-scene-index-pl.png') });
    check('the index lists the published scenes', (await page.$$eval('main li a[href^="/pl/scenes/"]', (els) => els.length)) >= (live.scenes as Any[]).length);
    check('no page errors', errors.length === 0);
    results.pageErrors = errors;
    results.apiCalls = seen.filter((s) => !s.includes('/api/e '));
    check('the password is in no log or data file', !(apiLog + readFileSync(join(DATA, 'catalog.json'), 'utf8')).includes(secret.password));
    await browser.close();
}

let failed: unknown = null;
try {
    await main();
} catch (e) {
    failed = e;
    console.error(e);
} finally {
    for (const c of children) c.kill();
    try { rmSync(DATA, { recursive: true, force: true }); } catch { /* a file still open */ }
}
const pass = !failed && checks.length > 0 && checks.every((c) => c.ok);
const file = writeEvidence('v07-catalogue', { pass, fly: FLY, error: failed ? String(failed) : null, checks, ...results });
console.log(`${pass ? 'PASS' : 'FAIL'} ${file}`);
process.exit(pass ? 0 : 1);
