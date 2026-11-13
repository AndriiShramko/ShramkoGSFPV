// The admin's Courses tab on a LOCAL copy (train 2, lane tracks, stage T4-admin A2; docs/wip/tracks-edit.md). Pattern of
// probe-admin-live-copy.ts (login with the TEST password of the gitignored .cache/admin-test.json, never the live admin) and
// tracks-serve.ts (the release build dist/ under serve-csp.mjs with the admin CSP, the REAL apps/api server.Handler on a fresh temporary
// DATA_DIR, bound to 127.0.0.1). Nothing leaves this machine: the API's Telegram and mail settings are blanked.
//   seed  (straight to the local API) course A = apps/api/tests/fixtures/tracks/valid-basic.json (generator), course B = a pilot's fork of
//         A (valid-person-fork.json) with a second version (valid-person-version-2.json, with B's edit token), one vote up on A
//   tab   login, tab "Courses": two rows; B's marks "created by the generator" and "edited by Ann (a pilot)", versions v1, v2; A's votes +1;
//         the Open link of A is /en/fly/?scene=..&course=A&edit=1 in a new tab and the page answers 200; layout at 1920x1080 and 844x390
//         (no sideways scroll, the row buttons inside the view); screenshots to SHOTS
//   acts  Hide A (hidden note, the open link replaced, the public list leaves A out), Show A (back in the public list); Rename A (a new
//         version: title changed, "edited by the admin", versions v1, v2); Reset votes on A (two clicks: the first only asks); Delete v1
//         of B (two clicks: versions v2 only); Delete A (the first click asks and deletes nothing, the second deletes; the public file 404)
//   no console error, no page error, no request to another host
//   node scripts/build-release.mjs
//   cd tools/bench && SONIC_PORTS=5720-5739 npx tsx src/tracks-admin.ts
// Takes C:/dev/.gpu-lock itself while the browser runs (one blocking loop, 20 s steps, at most 9 minutes; let go also on an error).
// Evidence: evidence/<date>/tracks-admin.json (exit 1 when a check fails). Screenshots: SHOTS (default U:/Temp/gsfpv-train2/shots).
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { launchChrome } from './browser';
import { REPO, today, writeEvidence } from './evidence';
import { serveTracks } from './tracks-serve';

const LOCK = 'C:/dev/.gpu-lock';
const SHOTS = process.env.SHOTS ?? 'U:/Temp/gsfpv-train2/shots';
const FIX = join(REPO, 'apps', 'api', 'tests', 'fixtures', 'tracks');
const SCENE = '39e63ce9';
const NEW_TITLE = 'Loop renamed by the admin';
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const checks: { name: string; pass: boolean; value?: unknown }[] = [];
const check = (name: string, pass: boolean, value?: unknown): boolean => {
    checks.push({ name, pass, value });
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${value === undefined ? '' : '  ' + JSON.stringify(value).slice(0, 300)}`);
    return pass;
};

let locked = false;
async function takeLock(): Promise<void> {
    const end = Date.now() + 9 * 60 * 1000;
    for (;;) {
        try {
            mkdirSync(LOCK);
            locked = true;
            return;
        } catch {
            if (Date.now() > end) throw new Error('the GPU lock was not free for 9 minutes');
            console.log('waiting for the GPU lock');
            await sleep(20000);
        }
    }
}
const letGo = (): void => {
    if (!locked) return;
    locked = false;
    try {
        rmdirSync(LOCK);
    } catch {
        /* gone */
    }
};

/** The test password and its hash: this tree's .cache, else the lead copy's (read only), else a new one made up in this tree's .cache. */
function testSecret(): { password: string; hash: string } {
    for (const f of [join(REPO, '.cache', 'admin-test.json'), 'C:/dev/gsfpv-v03/.cache/admin-test.json']) {
        if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'));
    }
    const password = `test-${randomBytes(12).toString('base64url')}`;
    const line = execFileSync('python', [join(REPO, 'tools', 'admin', 'hash_password.py'), '--stdin'], { input: `${password}\n` }).toString().trim();
    const s = { password, hash: line.slice('ADMIN_PASSWORD_HASH='.length) };
    mkdirSync(join(REPO, '.cache'), { recursive: true });
    writeFileSync(join(REPO, '.cache', 'admin-test.json'), JSON.stringify(s));
    return s;
}

const fixture = (name: string): Any => JSON.parse(readFileSync(join(FIX, name), 'utf8'));

async function post(url: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: Any }> {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => null) };
}

const row = (id: string): string => `[data-testid=t-list] li.row[data-id="${id}"]`;
const text = (page: Page, sel: string): Promise<string> => page.locator(sel).first().textContent().then((s) => s ?? '');
const rowIds = (page: Page): Promise<string[]> => page.$$eval('[data-testid=t-list] li.row', (els) => els.map((e) => e.getAttribute('data-id') ?? ''));

async function publicIds(api: string): Promise<string[]> {
    const r = await fetch(`${api}/api/tracks?scene=${SCENE}&sort=new`);
    return ((await r.json()) as { tracks: { id: string }[] }).tracks.map((t) => t.id);
}

/** Layout at the page's size: no sideways scroll and every button of the rows inside the view's width. */
const layout = (page: Page): Promise<{ scrollW: number; viewW: number; buttons: number; outside: number }> =>
    page.evaluate(() => {
        const b = [...document.querySelectorAll('[data-testid=t-list] li.row .row-actions > *')] as HTMLElement[];
        return {
            scrollW: document.documentElement.scrollWidth,
            viewW: window.innerWidth,
            buttons: b.length,
            outside: b.filter((e) => { const r = e.getBoundingClientRect(); return r.left < -1 || r.right > window.innerWidth + 1; }).length
        };
    });

async function main(): Promise<number> {
    const secret = testSecret();
    const served = await serveTracks(join(REPO, 'dist'), {
        ADMIN_PASSWORD_HASH: secret.hash, TG_BOT_TOKEN: '', TG_CHAT_ID: '', TG_OWNER_BOT_TOKEN: '', TG_OWNER_CHAT_ID: '', TG_OWNER_USER_ID: '',
        TG_WEBHOOK_SECRET: '', TG_API_BASE: 'http://127.0.0.1:9', GMAIL_USER: '', GMAIL_APP_PASSWORD: '', SMTP_HOST: '127.0.0.1', SMTP_PORT: '9'
    });
    const out: Record<string, unknown> = { site: served.site };
    const errors: string[] = [];
    const hosts = new Set<string>();
    let browser: Any = null;
    try {
        // ---- seed through the public API
        const a = await post(`${served.api}/api/tracks`, fixture('valid-basic.json'));
        const A = String(a.body?.id ?? '');
        const fork = { ...fixture('valid-person-fork.json'), parent: { id: A, version: 1 } };
        const b = await post(`${served.api}/api/tracks`, fork);
        const B = String(b.body?.id ?? '');
        const b2 = await post(`${served.api}/api/tracks/${B}/versions`, fixture('valid-person-version-2.json'),{ 'X-Track-Token': String(b.body?.editToken ?? '') });
        const vote = await post(`${served.api}/api/tracks/${A}/vote`, { v: 1, voter: randomBytes(16).toString('hex') });
        out.seed = { A, B, statuses: [a.status, b.status, b2.status, vote.status], errors: [a, b, b2, vote].filter((x) => x.status >= 300).map((x) => x.body) };
        if (!check('seed: A created, B forked from A, B version 2, one vote on A (201 201 201 200)', a.status === 201 && b.status === 201 && b2.status === 201 && vote.status === 200, out.seed)) return 1;

        await takeLock();
        const launched = await launchChrome({ headless: true });
        browser = launched.browser;
        out.browser = launched.which;
        const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, locale: 'en-US' });
        const page: Page = await ctx.newPage();
        page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`.slice(0, 300)); });
        page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`.slice(0, 300)));
        page.on('request', (r) => { try { hosts.add(new URL(r.url()).host); } catch { /* data: */ } });

        // ---- login and the tab
        await page.goto(`${served.site}/admin/`);
        await page.waitForSelector('[data-testid=password]');
        await page.fill('[data-testid=password]', secret.password);
        await page.press('[data-testid=password]', 'Enter');
        await page.waitForSelector('button[data-tab=tracks]', { timeout: 20000 });
        await page.click('button[data-tab=tracks]');
        await page.waitForSelector(row(B), { timeout: 20000 });
        check('the Courses tab lists both courses of the scene', JSON.stringify((await rowIds(page)).sort()) === JSON.stringify([A, B].sort()), await rowIds(page));
        const bMarks = await text(page, `${row(B)} [data-testid=t-marks]`);
        check('B: "created by the generator" (the origin\'s creator) and "edited by Ann (a pilot)"', /created by the generator/.test(bMarks) && /edited by Ann \(a pilot\)/.test(bMarks), bMarks);
        const bVers = await text(page, `${row(B)} [data-testid=t-versions]`);
        check('B: versions v1, v2 (latest v2)', /v1, v2/.test(bVers) && /latest v2/.test(bVers), bVers);
        const aVotes = await text(page, `${row(A)} [data-testid=t-votes]`);
        check('A: votes +1 / -0', /\+1 \/ -0/.test(aVotes), aVotes);
        const link = await page.locator(`${row(A)} a[data-action=t-open]`).evaluate((e) => ({ href: e.getAttribute('href'), target: e.getAttribute('target') }));
        const want = `/en/fly/?scene=${SCENE}&course=${A}&edit=1`;
        const opened = await fetch(served.site + (link.href ?? '/none'));
        check('A: "Open in the editor" links to the simulator page with course and edit=1 in a new tab, and that page answers 200', link.href === want && link.target === '_blank' && opened.status === 200, { ...link, want, status: opened.status });

        mkdirSync(SHOTS, { recursive: true });
        const l1920 = await layout(page);
        check('1920x1080: no sideways scroll, every row button inside the view', l1920.scrollW <= l1920.viewW + 1 && l1920.outside === 0 && l1920.buttons > 0, l1920);
        await page.screenshot({ path: join(SHOTS, 'tracks-admin-1920.png'), fullPage: true });
        await page.setViewportSize({ width: 844, height: 390 });
        await sleep(300);
        const l844 = await layout(page);
        check('844x390: no sideways scroll, every row button inside the view', l844.scrollW <= l844.viewW + 1 && l844.outside === 0 && l844.buttons > 0, l844);
        await page.screenshot({ path: join(SHOTS, 'tracks-admin-844.png'), fullPage: true });
        await page.setViewportSize({ width: 1920, height: 1080 });

        // ---- hide and show
        await page.click(`${row(A)} [data-action=t-hide]`);
        await page.waitForSelector(`${row(A)} [data-testid=t-hidden]`, { timeout: 10000 });
        const hiddenOpen = await page.locator(`${row(A)} [data-testid=t-open-hidden]`).count();
        const pubHidden = await publicIds(served.api);
        check('Hide: A shows the hidden note, the open link becomes the note, the public list leaves A out', hiddenOpen === 1 && !pubHidden.includes(A) && pubHidden.includes(B), { hiddenOpen, pubHidden });
        await page.click(`${row(A)} [data-action=t-hide]`);
        await page.waitForSelector(`${row(A)} a[data-action=t-open]`, { timeout: 10000 });
        const pubShown = await publicIds(served.api);
        check('Show: A back in the public list, the open link back', pubShown.includes(A) && (await page.locator(`${row(A)} [data-testid=t-hidden]`).count()) === 0, pubShown);

        // ---- rename (a new version marked as the admin's)
        await page.click(`${row(A)} [data-action=t-rename]`);
        await page.fill('[data-testid=t-rename-input]', NEW_TITLE);
        await page.click('[data-action=t-rename-save]');
        await page.waitForSelector(`${row(A)} [data-testid=t-title]:text-is("${NEW_TITLE}")`, { timeout: 10000 }).catch(async (e) => {
            const note = await text(page, 'p.note');
            const formErr = await page.locator('.t-rename p.bad').count() ? await text(page, '.t-rename p.bad') : '';
            throw new Error(`rename not shown; note "${note}", form "${formErr}": ${String(e).slice(0, 120)}`);
        });
        const aMarks = await text(page, `${row(A)} [data-testid=t-marks]`);
        const aVers = await text(page, `${row(A)} [data-testid=t-versions]`);
        const file2 = await fetch(`${served.api}/api/tracks/${A}/v2`).then((r) => r.json() as Promise<Any>).catch(() => null);
        check('Rename: A\'s title changed, "edited by the admin", versions v1, v2; the public v2 file has the new title',
            /edited by (the admin|.+ \(the admin\))/.test(aMarks) && /v1, v2/.test(aVers) && file2?.title === NEW_TITLE, { aMarks, aVers, title: file2?.title });

        // ---- reset votes: the first click only asks
        await page.click(`${row(A)} [data-action=t-reset-votes]`);
        const asked = await text(page, `${row(A)} [data-action=t-reset-votes]`);
        const stillVoted = await text(page, `${row(A)} [data-testid=t-votes]`);
        await page.click(`${row(A)} [data-action=t-reset-votes]`);
        await page.waitForSelector(`${row(A)} [data-testid=t-votes]:has-text("+0 / -0")`, { timeout: 10000 });
        check('Reset votes: the first click asks "Sure? Click again" and changes nothing, the second resets to +0 / -0', /Sure\?/.test(asked) && /\+1 \/ -0/.test(stillVoted), { asked, stillVoted });

        // ---- delete v1 of B
        await page.click(`${row(B)} [data-action=t-delete-v1]`);
        await page.click(`${row(B)} [data-action=t-delete-v1]`);
        await page.waitForSelector(`${row(B)} [data-testid=t-versions]:has-text("Versions: v2 ")`, { timeout: 10000 });
        const v1 = await fetch(`${served.api}/api/tracks/${B}/v1`);
        const v2 = await fetch(`${served.api}/api/tracks/${B}/v2`);
        check('Delete v1 of B (two clicks): versions v2 only; the public v1 file 404, v2 200', v1.status === 404 && v2.status === 200, { v1: v1.status, v2: v2.status });

        // ---- delete the course A: the first click asks and deletes nothing
        await page.click(`${row(A)} [data-action=t-delete]`);
        await sleep(500);
        const afterFirst = await rowIds(page);
        const askedDel = await text(page, `${row(A)} [data-action=t-delete]`);
        await page.click(`${row(A)} [data-action=t-delete]`);
        await page.waitForSelector(row(A), { state: 'detached', timeout: 10000 });
        const gone = await fetch(`${served.api}/api/tracks/${A}/v1`);
        check('Delete A: the first click asks and keeps the row, the second removes it; the public file 404; B stays',
            afterFirst.includes(A) && /Sure\?/.test(askedDel) && gone.status === 404 && (await rowIds(page)).includes(B), { askedDel, status: gone.status, rows: await rowIds(page) });

        const site = new URL(served.site).host;
        const other = [...hosts].filter((h) => h !== site);
        check('no console error, no page error, no request to another host', errors.length === 0 && other.length === 0, { errors: errors.slice(0, 5), other });
    } finally {
        if (browser) await browser.close().catch(() => undefined);
        letGo();
        await served.stop();
    }
    const failed = checks.filter((c) => !c.pass).length;
    const file = writeEvidence(process.env.EVIDENCE_NAME ?? 'tracks-admin', { step: 'tracks T4-admin A2: the admin Courses tab on a local copy', pass: failed === 0, checks, ...out });
    console.log(`${checks.length - failed}/${checks.length} checks passed; evidence ${file}; date ${today()}`);
    return failed === 0 ? 0 : 1;
}

process.on('SIGINT', () => { letGo(); process.exit(130); });
main().then((code) => process.exit(code), (e) => { letGo(); console.error(e); process.exit(1); });
