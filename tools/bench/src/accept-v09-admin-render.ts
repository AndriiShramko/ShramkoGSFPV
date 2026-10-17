// v0.9 lane R, the admin's side of the owner's item 7 ("how can I add such addresses?"): the owner pastes
// https://superspl.at/scene/2f1ddf5f?budget=8&stochastic in the admin and the scene is added with its
// drawing; pasting the link of a scene that is listed already gives it the drawing instead of stopping at
// "Already in the list"; the editor's drawing field is Auto / Stochastic / Sorted (sorted is a choice the
// owner may keep for a scene, stochastic being the desktop default now); a link with stochastic=0 is
// stored as sorted. The real API (apps/api/server.py) runs on a temporary DATA_DIR with a TEST password
// hash; the release is served by serve-csp (the live CSP) with /api going to that API. SuperSplat's facts and
// the scene CDN are the real services (a handful of reads). No scan is drawn: no GPU lock needed.
// Each check has a control: the BASE build's admin (BASE_DIST) must not do the new things.
//   SITE_DIST=dist BASE_DIST=.cache/dist-base npx tsx src/accept-v09-admin-render.ts   (from tools/bench)
// Evidence: evidence/<date>/v09-admin-render.json
import { spawn, execFileSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { launchChrome } from './browser';
import { REPO, today, writeEvidence } from './evidence';

const DIST = join(REPO, process.env.SITE_DIST ?? 'dist');
const BASE_DIST = join(REPO, process.env.BASE_DIST ?? join('.cache', 'dist-base'));
const API_PORT = 8000 + Math.floor(Math.random() * 900);
const NEW_PORT = API_PORT + 1000;
const BASE_PORT = API_PORT + 2000;
const TMP = join(REPO, '.cache');
mkdirSync(TMP, { recursive: true });
const DATA = mkdtempSync(join(TMP, 'gsfpv-v09-api-'));
const OWNER_SCENE = '2f1ddf5f';
const SORTED_SCENE = 'ba7aa29d'; // not in the snapshot: added by a stochastic=0 link
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
    writeFileSync(f, JSON.stringify(s));
    return s;
}

async function until(url: string, ms = 30000): Promise<void> {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
        try { if ((await fetch(url)).status < 500) return; } catch { /* not up yet */ }
        await sleep(250);
    }
    throw new Error(`${url} did not come up`);
}

const saved = (page: Page): Promise<unknown> => page.waitForFunction(() => {
    const s = document.querySelector('[data-testid=draft-status]');
    return s && !s.textContent?.includes('…') && (s.classList.contains('warn') || s.classList.contains('ok'));
}, null, { timeout: 20000 });

async function login(page: Page, origin: string, password: string): Promise<void> {
    await page.goto(`${origin}/admin/`);
    await page.fill('[data-testid=password]', password);
    await page.press('[data-testid=password]', 'Enter');
    await page.waitForSelector('[data-testid=scene-list] li.row', { timeout: 30000 });
}

/** Paste a link in the "Add a scene" field and wait for the preview. */
async function paste(page: Page, link: string): Promise<void> {
    await page.fill('[data-testid=add-input]', link);
    await page.click('[data-action=find]');
    await page.waitForSelector('[data-testid=add-preview] [data-action=add]', { timeout: 60000 });
    await sleep(300);
}

const published = (): Any => JSON.parse(readFileSync(join(DATA, 'catalog.json'), 'utf8'));
const entry = (id: string): Any => (published().scenes as Any[]).find((s) => s.id === id);

async function main(): Promise<void> {
    const secret = testSecret();
    mkdirSync(join(REPO, 'evidence', today()), { recursive: true });
    const snap = JSON.parse(readFileSync(join(REPO, 'apps', 'site', 'src', 'generated', 'catalog.json'), 'utf8'));
    // the snapshot without the two scenes this check adds
    const scenes = (snap.scenes as Any[]).filter((s) => s.id !== OWNER_SCENE && s.id !== SORTED_SCENE);
    writeFileSync(join(DATA, 'catalog.json'), JSON.stringify({ v: 1, published: snap.published, collections: snap.collections, scenes }));
    const api = spawn('python', [join(REPO, 'apps', 'api', 'server.py')], {
        env: { ...process.env, DATA_DIR: DATA, PORT: String(API_PORT), ADMIN_PASSWORD_HASH: secret.hash, TG_BOT_TOKEN: '', TG_CHAT_ID: '', MIN_FREE_GB: '0', PUBLIC_ORIGIN: 'https://gsfpv.flyreelstudio.eu' },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    children.push(api);
    let apiLog = '';
    api.stdout.on('data', (b) => { apiLog += String(b); });
    api.stderr.on('data', (b) => { apiLog += String(b); });
    for (const [dist, port] of [[DIST, NEW_PORT], [BASE_DIST, BASE_PORT]] as const) {
        children.push(spawn('node', [join(REPO, 'tools', 'bench', 'scripts', 'serve-csp.mjs'), dist, String(port)], { env: { ...process.env, API_PROXY: `http://127.0.0.1:${API_PORT}` }, stdio: 'ignore' }));
    }
    await until(`http://127.0.0.1:${API_PORT}/api/health`);
    await until(`http://127.0.0.1:${NEW_PORT}/en/`);
    await until(`http://127.0.0.1:${BASE_PORT}/en/`);

    const { browser, which } = await launchChrome({ headless: true });
    results.browser = which;
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript({ content: "try { localStorage.setItem('gsfpv.warned', '1'); } catch (e) {}" });
    const errors: string[] = [];
    const admin = await ctx.newPage();
    admin.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)));
    const NEW = `http://127.0.0.1:${NEW_PORT}`;

    await login(admin, NEW, secret.password);

    // ---- 1. the owner's address is added with its drawing ----
    await paste(admin, `https://superspl.at/scene/${OWNER_SCENE}?budget=8&stochastic`);
    const line1 = await admin.$eval('[data-testid=add-render]', (e) => e.textContent ?? '').catch(() => '');
    results.addLine = line1;
    check('1 the preview of the owner\'s address names the drawing it will store (stochastic, 8 M)', /8/.test(line1) && /tochast/i.test(line1));
    await admin.click('[data-testid=add-preview] [data-action=add]');
    await saved(admin);
    await admin.click('[data-action=publish]');
    await admin.waitForFunction(() => document.querySelector('[data-testid=draft-status]')?.classList.contains('ok'), null, { timeout: 20000 });
    check('1 published: the scene is in the catalogue with render {budgetM 8, stochastic true}', entry(OWNER_SCENE)?.render?.budgetM === 8 && entry(OWNER_SCENE)?.render?.stochastic === true);

    // ---- 2. the same address again: the listed scene can be given the drawing ----
    // first the scene's drawing is cleared in the editor, so that pasting the link has something to set
    await admin.click(`li.row[data-scene="${OWNER_SCENE}"] [data-action=edit]`);
    const ed = `li.row[data-scene="${OWNER_SCENE}"] [data-testid=place-editor]`;
    await admin.selectOption(`${ed} [data-field=render]`, '');
    await admin.fill(`${ed} [data-field=budgetM]`, '');
    await saved(admin);
    check('2 the editor\'s drawing field is Auto / Stochastic / Sorted; Auto and no budget remove the entry\'s render', await admin.$$eval(`${ed} [data-field=render] option`, (o) => o.map((x) => (x as HTMLOptionElement).value).join(',')) === ',stochastic,sorted'
        && await admin.$eval('[data-action=publish]', (b) => !(b as HTMLButtonElement).disabled));
    await admin.click('[data-action=publish]');
    await admin.waitForFunction(() => document.querySelector('[data-testid=draft-status]')?.classList.contains('ok'), null, { timeout: 20000 });
    check('2 published with Auto: the scene has no render at all (the device decides)', entry(OWNER_SCENE) !== undefined && entry(OWNER_SCENE).render === undefined);
    await paste(admin, `https://superspl.at/scene/${OWNER_SCENE}?budget=8&stochastic`);
    const already = await admin.$eval('[data-testid=add-preview] [data-action=add]', (b) => (b as HTMLButtonElement).disabled);
    const upd = await admin.$('[data-testid=add-preview] [data-action=update-render]');
    check('2 a listed scene pasted again: "Add" stays off and "Give the scene in the list this drawing" is offered', already && upd !== null);
    if (upd) {
        await upd.click();
        await saved(admin);
    }
    await admin.click('[data-action=publish]');
    await admin.waitForFunction(() => document.querySelector('[data-testid=draft-status]')?.classList.contains('ok'), null, { timeout: 20000 });
    check('2 published: the listed scene now has render {budgetM 8, stochastic true}', entry(OWNER_SCENE)?.render?.budgetM === 8 && entry(OWNER_SCENE)?.render?.stochastic === true);

    // ---- 3. Sorted is a choice the owner keeps for a scene ----
    await admin.selectOption(`${ed} [data-field=render]`, 'sorted');
    await saved(admin);
    await admin.click('[data-action=publish]');
    await admin.waitForFunction(() => document.querySelector('[data-testid=draft-status]')?.classList.contains('ok'), null, { timeout: 20000 });
    check('3 the editor\'s Sorted is published as render.stochastic false, the budget kept', entry(OWNER_SCENE)?.render?.stochastic === false && entry(OWNER_SCENE)?.render?.budgetM === 8);
    const apiCatalog = await (await fetch(`http://127.0.0.1:${API_PORT}/api/catalog`)).json() as Any;
    check('3 /api/catalog (what the simulator reads) carries it', (apiCatalog.scenes as Any[]).find((s) => s.id === OWNER_SCENE)?.render?.stochastic === false);

    // ---- 4. a link with stochastic=0 is stored as sorted ----
    await paste(admin, `https://superspl.at/scene/${SORTED_SCENE}?stochastic=0`);
    const line4 = await admin.$eval('[data-testid=add-render]', (e) => e.textContent ?? '').catch(() => '');
    results.sortedLine = line4;
    check('4 the preview of a stochastic=0 link says sorted', /sorted|classic/i.test(line4));
    await admin.click('[data-testid=add-preview] [data-action=add]');
    await saved(admin);
    await admin.click('[data-action=publish]');
    await admin.waitForFunction(() => document.querySelector('[data-testid=draft-status]')?.classList.contains('ok'), null, { timeout: 20000 });
    check('4 published: render {stochastic false}', JSON.stringify(entry(SORTED_SCENE)?.render) === JSON.stringify({ stochastic: false }));
    await admin.screenshot({ path: join(REPO, 'evidence', today(), 'v09-admin-render.png') });

    // ---- controls: the base build's admin ----
    // a context of its own: the session cookie is per host, not per port, and would log the base admin in already
    const baseCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await baseCtx.addInitScript({ content: "try { localStorage.setItem('gsfpv.warned', '1'); } catch (e) {}" });
    const baseAdmin = await baseCtx.newPage();
    baseAdmin.on('pageerror', (e) => errors.push(`base: ${String(e.message).slice(0, 200)}`));
    await login(baseAdmin, `http://127.0.0.1:${BASE_PORT}`, secret.password);
    await paste(baseAdmin, `https://superspl.at/scene/${OWNER_SCENE}?budget=8&stochastic`);
    check('control: the base build\'s admin stops at "Already in the list" (no way to give the listed scene the drawing)', await baseAdmin.$eval('[data-testid=add-preview] [data-action=add]', (b) => (b as HTMLButtonElement).disabled)
        && await baseAdmin.$('[data-testid=add-preview] [data-action=update-render]') === null, true);
    await baseAdmin.click(`li.row[data-scene="${OWNER_SCENE}"] [data-action=edit]`);
    check('control: the base build\'s editor has a stochastic checkbox, not the three-way field', await baseAdmin.$(`li.row[data-scene="${OWNER_SCENE}"] [data-field=stochastic]`) !== null && await baseAdmin.$(`li.row[data-scene="${OWNER_SCENE}"] [data-field=render]`) === null, true);
    const rejected = await (await fetch(`http://127.0.0.1:${API_PORT}/api/catalog`)).json() as Any;
    check('the server kept the sorted entry through the base admin\'s read (nothing was rewritten)', (rejected.scenes as Any[]).find((s) => s.id === OWNER_SCENE)?.render?.stochastic === false);
    check('no page errors', errors.length === 0);
    results.pageErrors = errors;
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
const file = writeEvidence('v09-admin-render', { pass, error: failed ? String(failed) : null, checks, ...results });
console.log(`${pass ? 'PASS' : 'FAIL'} ${file}`);
process.exit(pass ? 0 : 1);
