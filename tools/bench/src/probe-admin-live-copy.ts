// The owner's admin (/admin/: Scenes and Ideas tabs) end to end in a browser against an EXACT local copy of
// production: a release's dist (the live CI artifact, or a release built here with scripts/build-release.mjs,
// served by scripts/serve-csp.mjs with nginx.conf's admin CSP), the live API code (apps/api, same files as
// the live commit) and a copy of the live data (ideas.json, catalog.json, catalog-history/, reports.jsonl,
// fetched read-only from the hub by the caller).
// The live site is never touched: the login happens only here, with the TEST password of the gitignored
// .cache/admin-test.json. No e-mail and no Telegram can leave: every TG_*/GMAIL_* is empty and the SMTP and
// Telegram hosts point at a closed local port. The page never moves, saves or sends (Not now closes the
// thank-you draft); it checks that only login/logout were POSTed by the browser.
// The live data holds no bug with technical details, so the probe itself POSTs ONE synthetic bug report
// with a small diagnostics file to the LOCAL API (/api/report, exactly as a pilot's page would; nothing is
// delivered: Telegram is blanked) and opens and downloads its details. Afterwards the data files must be
// the copy's plus that one report and nothing else (catalog.json and catalog-history/ byte for byte).
// The layout (2026-10-14, defects found on the first run): an open card must be usable - at least 400 px
// wide, its public titles shown whole, modal, Esc closes it and the focus returns to the card (the old
// layout grew the card inside its ~200 px column: the titles showed 13 characters); no column may be taller
// than 3 viewports (the old phone board drew Done's 60 cards in the page flow, ~12,000 px); Done keeps its
// whole count in the header, draws its newest cards with Show all, and every card stays reachable (search).
// Run against the OLD release (DIST of the live dist.tgz, TAG=old-build), those checks are the negative
// controls: they must fail there.
//   DIST=<extracted dist.tgz> DATA=<data copy> [TAG=<name>] npx tsx src/probe-admin-live-copy.ts      (from tools/bench)
//   (+ RELEASE, DIST_SHA256, API_COMMIT, DATA_FETCHED: written into the evidence as its source)
// The copy: ssh the hub "cd <base>/data && tar cf - ideas.json catalog.json catalog-draft.json catalog-history
// reports.jsonl" into a gitignored .cache folder; delete it afterwards (ideas.json holds pilots' e-mail addresses).
// Holds no GPU work but runs a browser: the caller takes the shared GPU lock (C:/dev/.gpu-lock).
// Evidence: evidence/<date>/admin-live-copy[-TAG].json (no e-mail addresses: "contact present") and
// evidence/<date>/admin-live-copy[-TAG]/*.png (e-mail addresses blanked in the page before every screenshot).
import { spawn, execFileSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserContext, Page } from 'playwright';
import { launchChrome } from './browser';
import { REPO, today, writeEvidence } from './evidence';

const DIST = process.env.DIST ?? join(REPO, '.cache', 'admin-live', 'dist');
const DATA = process.env.DATA ?? join(REPO, '.cache', 'admin-live', 'data');
const NAME = `admin-live-copy${process.env.TAG ? `-${process.env.TAG}` : ''}`;
const SITE_PORT = 5400 + Math.floor(Math.random() * 90);
const API_PORT = 8100 + Math.floor(Math.random() * 800);
const SITE = `http://127.0.0.1:${SITE_PORT}`;
const API = `http://127.0.0.1:${API_PORT}`;
const SHOTS = join(REPO, 'evidence', today(), NAME);
const PILOT = ['R-20261006-0001', 'R-20261006-0002', 'R-20261006-0003'];
const SCENES = ['887f27aa', '39e63ce9', '7a475d38', '70b50d42', 'b11e45d1', '0230d903'];
const STATUSES = ['new', 'accepted', 'in_progress', 'done', 'rejected'] as const;
const KINDS = ['idea', 'bug', 'note', 'feature'];
const HEADINGS: Record<string, string> = { new: 'New', accepted: 'Accepted: the queue', in_progress: 'In progress', done: 'Done', rejected: 'Rejected' };
const EMAIL_RE = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;
/** An open card narrower than this cannot hold its fields (the old layout: ~250 px). */
const MIN_OPEN_WIDTH = 400;
/** No column may be taller than this many viewports (the old phone board: Done ~14 viewports). */
const MAX_COLUMN_VIEWPORTS = 3;
/** What an archive column draws before Show all (apps/fly/src/admin/ideas/board.ts CLIP_AT). */
const CLIP_AT = 8;
/** The synthetic bug's technical details: small, like the simulator's shape, no real device or person. */
const SYNTH_DIAG = {
    release: 'probe',
    browser: { userAgent: 'Mozilla/5.0 (synthetic; probe-admin-live-copy) no real browser', screen: { w: 1440, h: 900, dpr: 1 }, input: 'keyboard',
        gpu: { api: 'webgpu', adapter: { vendor: 'synthetic', architecture: 'none', description: 'written by the probe, no real device' } } },
    frames: { renderHz: 60, p50ms: 16.7, p99ms: 21.4 },
    errors: ['synthetic: no real error, written by probe-admin-live-copy on a local data copy'],
    settings: { rates: 'betaflight', cameraAngle: 25 }
};
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const checks: { name: string; ok: boolean; control: boolean; got?: unknown }[] = [];
const results: Record<string, Any> = {};
const children: ChildProcess[] = [];
function check(name: string, ok: boolean, got?: unknown, control = false): void {
    checks.push({ name, ok, control, ...(got === undefined ? {} : { got }) });
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${control ? '[control] ' : ''}${name}${got === undefined ? '' : ` -> ${JSON.stringify(got)}`}`);
}

/** The test password (made up once) and its hash, from the gitignored .cache (shared with accept-v06-admin). */
function testSecret(): { password: string; hash: string } {
    const f = join(REPO, '.cache', 'admin-test.json');
    if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'));
    const password = `test-${randomBytes(12).toString('base64url')}`;
    const line = execFileSync('python', [join(REPO, 'tools', 'admin', 'hash_password.py'), '--stdin'], { input: `${password}\n` }).toString().trim();
    const s = { password, hash: line.slice('ADMIN_PASSWORD_HASH='.length) };
    writeFileSync(f, JSON.stringify(s));
    return s;
}

const sha256 = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');

/** sha256 of every data file the admin reads (catalog files must not change at all). */
function dataHashes(): Record<string, string> {
    const out: Record<string, string> = {};
    const add = (rel: string): void => { const p = join(DATA, rel); if (existsSync(p) && statSync(p).isFile()) out[rel] = sha256(readFileSync(p)); };
    for (const f of ['ideas.json', 'catalog.json', 'catalog-draft.json', 'reports.jsonl']) add(f);
    if (existsSync(join(DATA, 'catalog-history'))) for (const f of readdirSync(join(DATA, 'catalog-history'))) add(`catalog-history/${f}`);
    return out;
}

async function until(url: string, ms = 20000): Promise<void> {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
        try { if ((await fetch(url)).status < 500) return; } catch { /* not up yet */ }
        await sleep(250);
    }
    throw new Error(`${url} did not come up`);
}

/** Poll a page function (evaluate runs through CDP: no eval under the admin's CSP). */
async function poll(page: Page, fn: () => boolean, what: string, ms = 15000): Promise<void> {
    const t0 = Date.now();
    while (!(await page.evaluate(fn).catch(() => false))) {
        if (Date.now() - t0 > ms) throw new Error(`timeout: ${what}`);
        await sleep(100);
    }
}

/** /api/** of the page goes to the local API (nginx's role), with the page's cookie, CSRF and cache headers. */
async function routeApi(ctx: BrowserContext, seen: string[]): Promise<void> {
    // the diagnostics download goes over plain HTTP through serve-csp's API_PROXY (Chromium cancels a download
    // served by route.fulfill); every other /api/ call is fulfilled here so the probe sees each one
    ctx.on('request', (q) => { const u = new URL(q.url()); if (u.pathname.endsWith('/diagnostics/download')) seen.push(`${q.method()} ${u.pathname} (proxied)`); });
    await ctx.route((u) => u.origin === SITE && u.pathname.startsWith('/api/') && !u.pathname.endsWith('/diagnostics/download'), async (route) => {
        const req = route.request();
        const u = new URL(req.url());
        const inH = await req.allHeaders();
        const headers: Record<string, string> = { 'X-Forwarded-For': '198.51.100.1' };
        for (const k of ['content-type', 'cookie', 'x-csrf', 'if-none-match']) if (inH[k]) headers[k] = inH[k];
        const raw = req.postDataBuffer();
        const r = await fetch(API + u.pathname + u.search, { method: req.method(), headers, body: req.method() === 'POST' && raw ? new Uint8Array(raw) : undefined });
        seen.push(`${req.method()} ${u.pathname} ${r.status}`);
        const out: Record<string, string> = {};
        for (const k of ['content-type', 'cache-control', 'etag', 'retry-after', 'set-cookie', 'content-disposition']) { const v = r.headers.get(k); if (v) out[k] = v; }
        await route.fulfill({ status: r.status, headers: out, body: Buffer.from(await r.arrayBuffer()) });
    });
}

/** Console errors, page errors, failed requests and every host the page reached. */
function watch(page: Page, tag: string, sink: { errors: string[]; hosts: Set<string> }): void {
    page.on('console', (m) => { if (m.type() === 'error') sink.errors.push(`${tag} console: ${m.text()} @ ${m.location().url}`.slice(0, 300)); });
    page.on('pageerror', (e) => sink.errors.push(`${tag} pageerror: ${e.message}`.slice(0, 300)));
    page.on('requestfailed', (r) => sink.errors.push(`${tag} requestfailed: ${r.url().split('?')[0]} ${r.failure()?.errorText ?? ''}`.slice(0, 300)));
    page.on('request', (r) => { try { sink.hosts.add(new URL(r.url()).host); } catch { /* data: */ } });
}

/** E-mail addresses out of the page before a screenshot (text and form values; the DOM only, nothing is sent). */
async function blankEmails(page: Page): Promise<number> {
    return page.evaluate((src) => {
        const has = new RegExp(src);
        const all = new RegExp(src, 'g');
        let n = 0;
        const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let t = w.nextNode(); t; t = w.nextNode()) if (has.test(t.nodeValue ?? '')) { t.nodeValue = (t.nodeValue ?? '').replace(all, '[e-mail hidden]'); n++; }
        for (const el of document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')) {
            if (has.test(el.value)) { el.value = el.value.replace(all, '[e-mail hidden]'); n++; }
        }
        return n;
    }, EMAIL_RE.source);
}
const emailsVisible = (page: Page): Promise<number> => page.evaluate((src) => {
    const re = new RegExp(src, 'g');
    const vals = [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')].map((e) => e.value).join('\n');
    return ((document.body.innerText + '\n' + vals).match(re) ?? []).length;
}, EMAIL_RE.source);

async function shot(page: Page, name: string, fullPage = false): Promise<string> {
    const blanked = await blankEmails(page);
    const left = await emailsVisible(page);
    check(`screenshot ${name}: no e-mail address visible (blanked ${blanked})`, left === 0, left);
    mkdirSync(SHOTS, { recursive: true });
    const file = join(SHOTS, `${name}.png`);
    await page.screenshot({ path: file, fullPage, scale: 'css' });
    return `evidence/${today()}/${NAME}/${name}.png`;
}

async function login(page: Page, password: string): Promise<void> {
    await page.goto(`${SITE}/admin/`);
    await page.waitForSelector('[data-testid=password]');
    await page.fill('[data-testid=password]', password);
    await page.press('[data-testid=password]', 'Enter');
    await page.waitForSelector('[data-testid=scene-list] li.row', { timeout: 20000 });
}

const counts = (page: Page): Promise<Record<string, string>> =>
    page.$$eval('[data-count]', (els) => Object.fromEntries(els.map((e) => [e.getAttribute('data-count') ?? '', e.textContent ?? ''])));
const boardIds = (page: Page): Promise<string[]> => page.$$eval('[data-testid=idea-board] [data-idea]', (els) => els.map((e) => e.getAttribute('data-idea') ?? ''));
const shownText = (page: Page): Promise<string> => page.$eval('[data-testid=idea-shown]', (e) => e.textContent ?? '');
const drawnIn = (page: Page, col: string): Promise<string[]> => page.$$eval(`[data-column=${col}] [data-idea]`, (els) => els.map((e) => e.getAttribute('data-idea') ?? ''));

// ---------------- an open card, in either layout ----------------
// The release under test decides where an open card's details are drawn: the side panel (the fix:
// [data-panel-idea]) or inside the card in its column (the old layout). The helpers find either, so the
// same checks run on both builds and the old one fails the layout checks (the negative control).

/** Opens a card's details; the selector of what holds them (the panel, or the card itself in the old layout). */
async function openCard(page: Page, id: string): Promise<string> {
    await page.click(`[data-testid=idea-board] [data-idea="${id}"] [data-action=details]`);
    const panel = `[data-panel-idea="${id}"]`;
    const inCard = `[data-testid=idea-board] [data-idea="${id}"]`;
    await page.waitForSelector(`${panel} .idea-details, ${inCard} .idea-details`);
    return (await page.$(`${panel} .idea-details`)) ? panel : inCard;
}

/** Esc; if the details are still open (the old layout has no Esc), its Details button closes them. */
async function closeCard(page: Page, id: string): Promise<void> {
    await page.keyboard.press('Escape');
    if (await page.$(`[data-testid=idea-board] [data-idea="${id}"] .idea-details`)) await page.click(`[data-testid=idea-board] [data-idea="${id}"] [data-action=details]`);
    await page.waitForSelector(`[data-panel-idea="${id}"] .idea-details, [data-testid=idea-board] [data-idea="${id}"] .idea-details`, { state: 'detached' });
}

/** How an open card is laid out: its width, whether it is modal, its public titles' boxes, where the focus is. */
const openLayout = (page: Page, scope: string): Promise<{ width: number; modal: boolean; focusIn: boolean; titles: { lang: string; width: number; whole: boolean; chars: number }[] }> =>
    page.$eval(scope, (e) => ({
        width: Math.round(e.getBoundingClientRect().width),
        modal: e.matches(':modal'),
        focusIn: e.contains(document.activeElement),
        titles: [...e.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-field^=title-]')].map((t) => ({
            lang: (t.getAttribute('data-field') ?? '').slice(6),
            width: Math.round(t.getBoundingClientRect().width),
            // nothing of the words hidden past the box's edge (a single-line input scrolls sideways)
            whole: t.scrollWidth <= t.clientWidth + 1 && t.scrollHeight <= t.clientHeight + 1,
            chars: t.value.length
        }))
    }));

/** Where the focus is: the card (data-idea) and the control (data-action / data-field), or the panel. */
const focusAt = (page: Page): Promise<{ idea: string | null; action: string | null; inPanel: boolean }> => page.evaluate(() => {
    const a = document.activeElement;
    return { idea: a?.closest('[data-testid=idea-board] [data-idea]')?.getAttribute('data-idea') ?? null, action: a?.getAttribute('data-action') ?? a?.getAttribute('data-field') ?? null,
        inPanel: !!a?.closest('[data-panel-idea]') };
});

/** Height of every column of the board, and the page's. */
const heights = (page: Page): Promise<{ page: number; viewport: number; columns: Record<string, number> }> => page.evaluate(() => ({
    page: document.documentElement.scrollHeight,
    viewport: innerHeight,
    columns: Object.fromEntries([...document.querySelectorAll('[data-testid=idea-board] .column')].map((c) => [c.getAttribute('data-column') ?? '', Math.round(c.getBoundingClientRect().height)]))
}));

/** Show all on a column when it has one that is not pressed (the old layout has none): true if pressed. */
async function showAll(page: Page, col: string): Promise<boolean> {
    const b = await page.$(`[data-column=${col}] [data-action=col-all][aria-expanded=false]`);
    if (!b) return false;
    await b.click();
    return true;
}
async function showNewest(page: Page, col: string): Promise<void> {
    const b = await page.$(`[data-column=${col}] [data-action=col-all][aria-expanded=true]`);
    if (b) await b.click();
}

/**
 * The column checks of one width: no column taller than MAX_COLUMN_VIEWPORTS viewports; Done draws its
 * newest CLIP_AT with Show all (n) and its header still counts all of them; after Show all every card is
 * drawn and the column is still not taller (its own scroll box); the oldest Done card, not drawn before
 * Show all, is found by the search.
 */
async function columnChecks(page: Page, tag: string, want: Record<string, string>): Promise<Record<string, Any>> {
    const out: Record<string, Any> = {};
    const total = Number(want.done);
    const h0 = await heights(page);
    out.heights = h0;
    const limit = MAX_COLUMN_VIEWPORTS * h0.viewport;
    const tall = Object.entries(h0.columns).filter(([, v]) => v > limit);
    check(`${tag}: no column is taller than ${MAX_COLUMN_VIEWPORTS} viewports (${limit} px)`, tall.length === 0, h0.columns);
    const drawn = await drawnIn(page, 'done');
    const count = (await counts(page)).done;
    const button = await page.$eval('[data-column=done] [data-action=col-all]', (e) => e.textContent ?? '').catch(() => null);
    out.done = { drawn: drawn.length, count, button };
    check(`${tag}: Done draws its newest ${CLIP_AT}, its header still counts all ${total}, with "Show all (${total})"`,
        drawn.length === CLIP_AT && count === String(total) && button === `Show all (${total})`, out.done);
    if (!(await showAll(page, 'done'))) {
        check(`${tag}: Show all draws every Done card in the column's own scroll box`, false, 'no Show all button');
        return out;
    }
    const all = await drawnIn(page, 'done');
    const h1 = await heights(page);
    const box = await page.$eval('[data-column=done] .cards', (e) => ({ scrolls: e.scrollHeight > e.clientHeight + 1, height: Math.round(e.clientHeight) }));
    out.showAll = { drawn: all.length, column: h1.columns.done, box, page: h1.page };
    check(`${tag}: Show all draws every Done card (${total}) in the column's own scroll box, the column still under ${limit} px`,
        all.length === total && h1.columns.done <= limit && box.scrolls, out.showAll);
    const oldest = all.at(-1) ?? '';
    await showNewest(page, 'done');
    const hiddenAgain = !(await drawnIn(page, 'done')).includes(oldest);
    check(`${tag}: Show only the newest ${CLIP_AT} draws ${CLIP_AT} again; the oldest Done card ${oldest} is not drawn then`, (await drawnIn(page, 'done')).length === CLIP_AT && hiddenAgain, null, true);
    await page.fill('[data-testid=idea-search]', oldest);
    const found = await boardIds(page);
    out.oldest = { id: oldest, found };
    check(`${tag}: the search finds the oldest Done card ${oldest} (not drawn before): no card is out of reach`, JSON.stringify(found) === JSON.stringify([oldest]), found);
    await page.fill('[data-testid=idea-search]', '');
    return out;
}

/** POST one synthetic bug report with diagnostics to the LOCAL API, as the pilot's page would. */
async function postSyntheticBug(): Promise<{ status: number; body: Any; sent: Any }> {
    const sent = {
        kind: 'bug', locale: 'en', page: 'fly', scene: SCENES[0], release: (process.env.RELEASE ?? 'probe').slice(0, 40), t: 5000, hp: '', contact: '',
        message: '[TEST] Synthetic bug report written by probe-admin-live-copy on the LOCAL copy of the data only, to open and download its technical details. Not a real report.',
        diagnosticsConsent: true, diagnostics: SYNTH_DIAG
    };
    if (!API.startsWith('http://127.0.0.1:')) throw new Error('the synthetic report goes to the local API only');
    const r = await fetch(`${API}/api/report`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.2' }, body: JSON.stringify(sent) });
    return { status: r.status, body: await r.json().catch(() => null), sent };
}

async function main(): Promise<void> {
    const secret = testSecret();
    const before = dataHashes();
    results.dataFiles = Object.keys(before);
    const reportsBefore = existsSync(join(DATA, 'reports.jsonl')) ? readFileSync(join(DATA, 'reports.jsonl'), 'utf8') : '';
    const store = JSON.parse(readFileSync(join(DATA, 'ideas.json'), 'utf8')) as { ideas: Any[] };
    const liveWithDiagnostics = store.ideas.filter((r) => r.diagnostics === true).length;
    const catalog = JSON.parse(readFileSync(join(DATA, 'catalog.json'), 'utf8')) as { scenes: Any[] };
    const historyFiles = existsSync(join(DATA, 'catalog-history')) ? readdirSync(join(DATA, 'catalog-history')).length : 0;

    // the API from the live commit's apps/api on the data copy; nothing can leave this machine
    const api = spawn('python', [join(REPO, 'apps', 'api', 'server.py')], {
        env: { ...process.env, DATA_DIR: DATA, PORT: String(API_PORT), ADMIN_PASSWORD_HASH: secret.hash, MIN_FREE_GB: '0',
            TG_BOT_TOKEN: '', TG_CHAT_ID: '', TG_OWNER_BOT_TOKEN: '', TG_OWNER_CHAT_ID: '', TG_OWNER_USER_ID: '', TG_WEBHOOK_SECRET: '',
            TG_API_BASE: 'http://127.0.0.1:9', GMAIL_USER: '', GMAIL_APP_PASSWORD: '', SMTP_HOST: '127.0.0.1', SMTP_PORT: '9' },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    children.push(api);
    let apiLog = '';
    api.stdout.on('data', (b) => { apiLog += String(b); });
    api.stderr.on('data', (b) => { apiLog += String(b); });
    const site = spawn(process.execPath, [join(REPO, 'tools', 'bench', 'scripts', 'serve-csp.mjs'), DIST, String(SITE_PORT)], { stdio: 'ignore', env: { ...process.env, API_PROXY: API } });
    children.push(site);
    await until(`${API}/api/health`);
    await until(`${SITE}/admin/`);
    const adminHead = await fetch(`${SITE}/admin/`);
    results.adminCsp = adminHead.headers.get('content-security-policy');
    check('the admin page is served under nginx.conf\'s admin CSP (script-src \'self\' only)', /script-src 'self';/.test(results.adminCsp ?? '') && adminHead.headers.get('x-csp-mode') === 'admin');

    // the one synthetic bug with technical details (the live data has none), stored by the local API
    const synth = await postSyntheticBug();
    const SB = String(synth.body?.id ?? '');
    const diagFile = join(DATA, 'reports', `${SB}.json`);
    results.synthetic = { status: synth.status, answer: synth.body, diagnosticsFileBytes: existsSync(diagFile) ? statSync(diagFile).size : null };
    check('a synthetic bug report with diagnostics is stored by the LOCAL API (POST /api/report 200, diagnostics true, delivered to nobody)',
        synth.status === 200 && /^R-\d{8}-\d{4,}$/.test(SB) && synth.body?.diagnostics === true && synth.body?.delivered === false && existsSync(diagFile), results.synthetic);
    const stored = JSON.parse(readFileSync(join(DATA, 'ideas.json'), 'utf8')) as { ideas: Any[] };
    const synthRec = stored.ideas.find((r) => r.id === SB);
    check('the synthetic report became a bug card in New with diagnostics in ideas.json (the API\'s own path)', synthRec?.kind === 'bug' && synthRec?.status === 'new' && synthRec?.diagnostics === true,
        synthRec ? { kind: synthRec.kind, status: synthRec.status, diagnostics: synthRec.diagnostics } : null);
    const board = { ideas: [...store.ideas, ...(synthRec ? [synthRec] : [])] };

    // what the board must show, from the data copy itself (the UI's own placement rules: api.ts parseIdea)
    const placeable = board.ideas.filter((r) => typeof r.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(r.id) && (STATUSES as readonly string[]).includes(r.status) && KINDS.includes(r.kind));
    const want = Object.fromEntries(STATUSES.map((s) => [s, String(placeable.filter((r) => r.status === s).length)]));
    const URG = ['low', 'normal', 'high', 'urgent'];
    const onLanding = (r: Any): boolean => r.public?.visible !== false && !!String(r.public?.title?.en ?? '').trim() && ['accepted', 'in_progress', 'done'].includes(r.status) && r.suspect !== true;
    results.expected = {
        records: board.ideas.length, placeable: placeable.length, columns: want,
        kinds: Object.fromEntries(KINDS.map((k) => [k, placeable.filter((r) => r.kind === k).length])),
        withContact: placeable.filter((r) => String(r.contact ?? '') !== '').length,
        onLanding: placeable.filter(onLanding).length,
        highOrAbove: placeable.filter((r) => URG.indexOf(r.urgency) >= 2).length,
        withDiagnostics: placeable.filter((r) => r.diagnostics === true).length,
        liveWithDiagnostics
    };

    const { browser, which } = await launchChrome({ headless: true });
    results.browser = which;
    const sink = { errors: [] as string[], hosts: new Set<string>() };
    const seen: string[] = [];

    // ---------------- desktop 1440x900 ----------------
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US', acceptDownloads: true });
    await routeApi(ctx, seen);
    const page = await ctx.newPage();
    watch(page, 'desktop', sink);
    page.on('dialog', (d) => void d.dismiss());
    await login(page, secret.password);
    check('login on localhost with the test password', seen.includes('POST /api/admin/login 200'));

    // Scenes: the six published scenes in the live order, each with its state
    const rows = await page.$$eval('[data-testid=scene-list] li.row', (els) => els.map((e) => ({
        id: e.getAttribute('data-scene') ?? '',
        title: e.querySelector('.row-title')?.textContent ?? '',
        badges: [...e.querySelectorAll('.badges .badge:not(.change-badge)')].map((b) => b.textContent ?? ''),
        changed: [...e.querySelectorAll('.change-badge')].some((b) => !(b as HTMLElement).hidden),
        hiddenRow: e.classList.contains('is-hidden'), pinnedRow: e.classList.contains('is-pinned')
    })));
    results.scenes = rows;
    check('Scenes lists the 6 published scenes in the live order', JSON.stringify(rows.map((r) => r.id)) === JSON.stringify(SCENES), rows.map((r) => r.id));
    check('the list equals catalog.json of the copy', JSON.stringify(rows.map((r) => r.id)) === JSON.stringify(catalog.scenes.map((s) => s.id)));
    const wantBadges = (s: Any): string[] => [s.pinned ? 'Featured' : '', s.hidden ? 'Hidden' : '', !s.collision ? 'No walls' : '', s.collision && s.walls === 'off' ? 'Walls off by default' : ''].filter(Boolean);
    const badgeOk = catalog.scenes.every((s) => JSON.stringify(rows.find((r) => r.id === s.id)?.badges) === JSON.stringify(wantBadges(s)));
    check('each scene shows its state (Featured / Hidden / No walls / Walls off) as catalog.json says', badgeOk,
        Object.fromEntries(rows.map((r) => [r.id, r.badges.length ? r.badges : ['visible, walls on']])));
    check('no scene carries an unpublished-change badge', rows.every((r) => !r.changed));
    const status = await page.$eval('[data-testid=draft-status]', (e) => ({ text: e.textContent ?? '', cls: e.className }));
    results.draftStatus = status;
    check('the draft status says pilots see exactly this list (no draft on the hub)', /Pilots see exactly this list/.test(status.text) && status.cls.includes('ok'), status.text);
    const history = await page.$$eval('.history [data-version]', (els) => els.map((e) => e.getAttribute('data-version') ?? ''));
    results.history = history;
    check(`the publish history lists the ${historyFiles} versions of catalog-history/`, history.length === historyFiles, history.length);
    await poll(page, () => [...document.images].every((i) => i.complete), 'posters', 20000).catch(() => undefined);
    results.postersLoaded = await page.$$eval('[data-testid=scene-list] img', (els) => els.filter((i) => (i as HTMLImageElement).naturalWidth > 0).length);
    check('every scene row shows its poster', results.postersLoaded === SCENES.length, results.postersLoaded);
    const shots: Record<string, string> = {};
    shots.scenes = await shot(page, 'scenes-desktop');

    // Ideas: the five columns with the counts of ideas.json (+ the synthetic bug in New)
    await page.click('[data-tab=ideas]');
    await page.waitForSelector('[data-testid=idea-board] [data-idea]', { timeout: 20000 });
    const c0 = await counts(page);
    results.columns = c0;
    check('the kanban columns New / Accepted / In progress / Done / Rejected count what ideas.json holds', JSON.stringify(c0) === JSON.stringify(want), c0);
    const heads = await page.$$eval('[data-testid=idea-board] .column', (els) => els.map((e) => [e.getAttribute('data-column'), e.querySelector('h2')?.firstChild?.textContent ?? '']));
    check('the column headings, in board order', JSON.stringify(heads) === JSON.stringify(STATUSES.map((s) => [s, HEADINGS[s]])), heads.map((x) => x[1]));
    const total = await shownText(page);
    check(`every record is placed: "${placeable.length} of ${board.ideas.length} shown"`, total === `${placeable.length} of ${board.ideas.length} shown`, total);
    check('no record is reported unreadable', await page.$eval('[data-testid=idea-unreadable]', (e) => (e as HTMLElement).hidden === true));
    results.setupNote = await page.$eval('[data-testid=idea-setup]', (e) => e.textContent ?? '');
    check('the copy\'s API has no Gmail and no Telegram webhook (the page says so): nothing can be sent from here',
        /Gmail is not set up/.test(results.setupNote) && /Telegram only receives reports/.test(results.setupNote), results.setupNote);
    await page.evaluate(() => window.scrollTo(0, 0));
    shots.board = await shot(page, 'ideas-board-desktop');

    // long columns at 1440 (Done holds 60): drawn newest first with Show all, every card reachable
    results.desktopColumns = await columnChecks(page, 'desktop 1440', want);

    // the Polish pilot's three ideas: in Done, their public titles, a thank-you DRAFT waiting. The owner
    // reaches them with Show all (the newest 8 of Done are the latest features).
    await showAll(page, 'done');
    const pilot: Record<string, Any> = {};
    // R-20261006-0002 last: it stays open for the layout checks below, and an open side panel is modal (the
    // board behind it takes no clicks), so every other card is opened and closed before it
    for (const id of [...PILOT.filter((x) => x !== 'R-20261006-0002'), 'R-20261006-0002']) {
        const rec = store.ideas.find((r) => r.id === id);
        const sel = `[data-testid=idea-board] [data-idea="${id}"]`;
        const st = await page.$eval(sel, (e) => e.getAttribute('data-status')).catch(() => null);
        const chips = await page.$$eval(`${sel} [data-chip]`, (els) => els.map((e) => e.getAttribute('data-chip')));
        const thanksBtn = await page.$eval(`${sel} [data-action=thanks]`, (e) => e.textContent ?? '').catch(() => null);
        const scope = await openCard(page, id);
        const titles = Object.fromEntries(await page.$$eval(`${scope} [data-field^=title-]`, (els) => els.map((e) => [e.getAttribute('data-field')?.slice(6), (e as HTMLInputElement).value])));
        const mails = await page.$$eval(`${scope} [data-field=mails] li[data-mail]`, (els) => els.map((e) => e.getAttribute('data-state')));
        const contactShown = await page.$eval(`${scope} [data-field=contact]`, (e) => !e.classList.contains('muted')).catch(() => false);
        const wantTitles = Object.fromEntries(Object.entries(rec?.public?.title ?? {}).filter(([, v]) => String(v).trim()));
        pilot[id] = { status: st, chips, titleLangs: Object.keys(titles).filter((l) => titles[l]), titleEn: titles.en, mails, contact: contactShown ? 'contact present' : 'none', thanksButton: thanksBtn };
        check(`${id} is in Done`, st === 'done', st);
        check(`${id} shows its public titles (4 languages, as ideas.json)`, JSON.stringify(Object.fromEntries(Object.entries(titles).filter(([, v]) => v))) === JSON.stringify(wantTitles), titles.en);
        check(`${id} is on the landing (chip) and has the pilot's contact`, chips.includes('landing') && chips.includes('contact') && contactShown);
        check(`${id} has exactly one thank-you e-mail, a draft not sent, and offers "read and send"`, JSON.stringify(mails) === '["draft"]' && /read and send/.test(thanksBtn ?? ''), { mails, button: thanksBtn });
        if (id !== 'R-20261006-0002') await closeCard(page, id);
    }
    results.pilot = pilot;

    // defect 1: the open card at 1440 (R-20261006-0002 is open): wide enough, its titles whole, modal; Esc
    // closes it and the focus returns to the card. The old layout (the card grew in its column) fails these.
    const P2id = 'R-20261006-0002';
    const P2 = await openCard(page, P2id).catch(() => `[data-panel-idea="${P2id}"]`); // already open: the same scope
    const lay = await openLayout(page, P2);
    results.openCard = { scope: P2.includes('panel') ? 'side panel' : 'card in its column', ...lay };
    check(`desktop: the open card is at least ${MIN_OPEN_WIDTH} px wide`, lay.width >= MIN_OPEN_WIDTH, lay.width);
    check('desktop: its four public titles are shown whole (no words hidden past the box), each box at least 400 px wide',
        lay.titles.length === 4 && lay.titles.every((x) => x.whole && x.width >= 400), lay.titles);
    check('desktop: the open card is modal (the board behind takes no clicks or Tab), the focus inside it', lay.modal && lay.focusIn, { modal: lay.modal, focusIn: lay.focusIn });
    const f0 = await focusAt(page);
    check('desktop: while it is open the focus is not on the board (control for the return)', f0.idea === null, f0, true);

    // the open card in one picture: what the owner sees at 1440, and the whole panel (let out for the shot)
    await blankEmails(page);
    check('screenshot ideas-pilot-card-open-desktop: no e-mail address visible', (await emailsVisible(page)) === 0);
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: join(SHOTS, 'ideas-pilot-card-open-desktop.png'), scale: 'css' });
    shots.pilotCard = `evidence/${today()}/${NAME}/ideas-pilot-card-open-desktop.png`;
    const isPanel = P2.startsWith('[data-panel-idea');
    await page.$eval(P2, (e, panel) => {
        const box = (panel ? e : e.closest('.cards')) as HTMLElement;
        box.style.height = 'auto';
        box.style.maxHeight = 'none';
        box.style.overflow = 'visible';
    }, isPanel);
    await page.locator(P2).screenshot({ path: join(SHOTS, 'ideas-pilot-card-open-full.png'), scale: 'css' });
    shots.pilotCardFull = `evidence/${today()}/${NAME}/ideas-pilot-card-open-full.png`;
    await page.$eval(P2, (e, panel) => {
        const box = (panel ? e : e.closest('.cards')) as HTMLElement;
        box.style.height = box.style.maxHeight = box.style.overflow = '';
    }, isPanel);

    // its thank-you draft in the dialog (opened from the open card), then Not now
    const posts0 = seen.filter((s) => s.startsWith('POST')).length;
    await page.click(`${P2} [data-action=thanks]`).catch(async () => page.click(`[data-testid=idea-board] [data-idea="${P2id}"] [data-action=thanks]`));
    await page.waitForSelector('[data-testid=thanks-dialog] [data-step=draft]:not([hidden])');
    const dlg = await page.evaluate(() => ({
        subject: (document.querySelector('[data-field=thanks-subject]') as HTMLInputElement).value,
        body: (document.querySelector('[data-field=thanks-body]') as HTMLTextAreaElement).value,
        toSet: !!(document.querySelector('[data-field=thanks-to]') as HTMLInputElement).value,
        summaryHidden: (document.querySelector('[data-step=summary]') as HTMLElement).hidden,
        editShown: !(document.querySelector('[data-action=thanks-edit]') as HTMLElement).hidden,
        sendLabel: document.querySelector('[data-action=thanks-send]')?.textContent ?? ''
    }));
    const m2 = store.ideas.find((r) => r.id === P2id)?.thread?.find((m: Any) => m.kind === 'done');
    results.draftDialog = { subject: dlg.subject, bodyChars: dlg.body.length, to: dlg.toSet ? 'contact present' : 'none', sendLabel: dlg.sendLabel };
    check('the thank-you dialog opens straight at the DRAFT (step 2), the whole e-mail as stored', dlg.summaryHidden && dlg.subject === m2?.subject && dlg.body === m2?.plain && dlg.toSet,
        { subject: dlg.subject, bodyChars: dlg.body.length });
    check('the draft dialog offers Send and Edit (not pressed)', dlg.editShown && dlg.sendLabel.length > 0);
    shots.thanksDraft = await shot(page, 'ideas-pilot-thanks-draft-desktop');
    await page.click('[data-action=thanks-later]'); // Not now: sends nothing
    await page.waitForSelector('[data-testid=thanks-dialog]', { state: 'detached' });
    check('opening the draft and Not now sent nothing (no POST)', seen.filter((s) => s.startsWith('POST')).length === posts0);
    const stillOpen = !!(await page.$(`${P2} .idea-details`));
    check('after Not now the open card is still open (the dialog was over it)', stillOpen);
    await page.keyboard.press('Escape');
    await sleep(150);
    const f1 = await focusAt(page);
    const closedByEsc = !(await page.$(`${P2} .idea-details`));
    results.escape = { closed: closedByEsc, focus: f1 };
    check('desktop: Esc closes the open card and the focus returns to its Details button', closedByEsc && f1.idea === P2id && f1.action === 'details', results.escape);
    if (!closedByEsc) await closeCard(page, P2id);
    await showNewest(page, 'done');

    // search and filters
    const reset = async (): Promise<void> => {
        await page.fill('[data-testid=idea-search]', '');
        for (const f of ['minUrgency', 'contact', 'landing']) await page.selectOption(`[data-filter=${f}]`, 'any');
        for (const k of KINDS) if ((await page.$eval(`[data-kind=${k}]`, (e) => e.getAttribute('aria-pressed'))) !== 'true') await page.click(`[data-kind=${k}]`);
    };
    const filtered: Record<string, Any> = {};
    await page.fill('[data-testid=idea-search]', 'R-20261006-0002');
    filtered.searchId = { ids: await boardIds(page), shown: await shownText(page) };
    check('search "R-20261006-0002" finds exactly that card', JSON.stringify(filtered.searchId.ids) === '["R-20261006-0002"]' && filtered.searchId.shown === `1 of ${board.ideas.length} shown`, filtered.searchId);
    await page.fill('[data-testid=idea-search]', 'R-20261006-9999');
    const none = await boardIds(page);
    check('search for an id that does not exist finds nothing', none.length === 0, none.length, true);
    const words = String(store.ideas.find((r) => r.id === 'R-20261006-0002')?.public?.title?.en ?? '').split(/\s+/).filter((w) => w.length > 4).slice(0, 2).join(' ');
    await page.fill('[data-testid=idea-search]', words);
    filtered.searchWords = { query: words, ids: await boardIds(page) };
    check(`search by words of its public title ("${words}") finds R-20261006-0002`, filtered.searchWords.ids.includes('R-20261006-0002'), filtered.searchWords.ids.length);
    await reset();
    await page.selectOption('[data-filter=contact]', 'yes');
    filtered.contactYes = (await boardIds(page)).length;
    check(`filter "with contact" keeps the ${results.expected.withContact} records that have one, the pilot's three among them`,
        filtered.contactYes === results.expected.withContact && (await boardIds(page)).filter((x) => PILOT.includes(x)).length === 3, filtered.contactYes);
    await reset();
    await page.click('[data-kind=feature]');
    filtered.noFeatures = (await boardIds(page)).length;
    check('kind filter: without seeded features the board keeps ideas, bugs and notes (every match drawn)', filtered.noFeatures === placeable.length - results.expected.kinds.feature, filtered.noFeatures);
    await reset();
    await page.selectOption('[data-filter=landing]', 'yes');
    filtered.onLanding = (await boardIds(page)).length;
    check('filter "on the landing" keeps what the roadmap shows, every one drawn (Done included)', filtered.onLanding === results.expected.onLanding, filtered.onLanding);
    await reset();
    await page.selectOption('[data-filter=minUrgency]', 'high');
    filtered.highOrAbove = (await boardIds(page)).length;
    check('filter "urgency high or above" matches the data', filtered.highOrAbove === results.expected.highOrAbove, filtered.highOrAbove);
    await reset();
    check('after the filters are reset the board is whole again', JSON.stringify(await counts(page)) === JSON.stringify(want));
    results.filters = filtered;

    // 3. a bug's technical details: the synthetic bug's card, the details view (a new tab with the stored
    // JSON) and the download (the same bytes); the pilot's idea without diagnostics offers neither (control)
    const bugSel = `[data-testid=idea-board] [data-idea="${SB}"]`;
    const bugCard = await page.$eval(bugSel, (e) => ({ status: e.getAttribute('data-status'), chips: [...e.querySelectorAll('[data-chip]')].map((c) => c.textContent) })).catch(() => null);
    check(`the synthetic bug ${SB} is a card in New with the Bug chip`, bugCard?.status === 'new' && (bugCard?.chips ?? []).includes('Bug'), bugCard);
    const bug = await openCard(page, SB);
    const links = await page.$eval(bug, (e) => ({
        details: e.querySelector('[data-action=diagnostics]')?.getAttribute('href') ?? null,
        download: e.querySelector('[data-action=download]')?.getAttribute('download') ?? null,
        downloadHref: e.querySelector('[data-action=download]')?.getAttribute('href') ?? null,
        sent: e.querySelector('.idea-sent')?.textContent ?? ''
    }));
    results.bugDetails = links;
    const diagUrl = `/api/admin/reports/${SB}/diagnostics`;
    check('its open card offers Technical details and Download, both to the stored file', links.details === diagUrl && links.downloadHref === `${diagUrl}/download` && links.download === `${SB}.json`, links);
    check('it shows what the page sent (language, page, scene, release)', ['Language: en', 'Sent from: fly', `Scene ${SCENES[0]}`, `Release: ${synth.sent.release}`].every((x) => links.sent.includes(x)), links.sent);
    const fileBytes = readFileSync(diagFile);
    const [tab] = await Promise.all([ctx.waitForEvent('page'), page.click(`${bug} [data-action=diagnostics]`)]);
    await tab.waitForLoadState();
    const viewText = await tab.evaluate(() => document.body.innerText);
    let viewJson: Any = null;
    try { viewJson = JSON.parse(viewText); } catch { /* not JSON */ }
    results.bugView = { url: new URL(tab.url()).pathname, chars: viewText.length, id: viewJson?.id ?? null };
    check('Technical details opens a tab with the stored JSON: the same file, the diagnostics as the page sent them',
        new URL(tab.url()).pathname === diagUrl && JSON.stringify(viewJson) === JSON.stringify(JSON.parse(fileBytes.toString('utf8'))) && JSON.stringify(viewJson?.diagnostics) === JSON.stringify(SYNTH_DIAG), results.bugView);
    await tab.close();
    const [download] = await Promise.all([page.waitForEvent('download'), page.click(`${bug} [data-action=download]`)]);
    const dlPath = await download.path();
    const dlBytes = dlPath ? readFileSync(dlPath) : Buffer.alloc(0);
    results.bugDownload = { name: download.suggestedFilename(), bytes: dlBytes.length, sha256: sha256(dlBytes), fileSha256: sha256(fileBytes) };
    check(`Download saves ${SB}.json, byte for byte the stored diagnostics file`, download.suggestedFilename() === `${SB}.json` && dlBytes.length > 0 && sha256(dlBytes) === sha256(fileBytes), results.bugDownload);
    shots.bugDetails = await shot(page, 'ideas-bug-details-desktop');
    await closeCard(page, SB);
    const p2 = await openCard(page, P2id);
    const noDiag = !(await page.$(`${p2} [data-action=diagnostics]`)) && !(await page.$(`${p2} [data-action=download]`));
    const noFile = await page.evaluate(async (u) => (await fetch(u, { cache: 'no-store' })).status, `/api/admin/reports/${P2id}/diagnostics`);
    check('an idea without diagnostics offers neither, and its diagnostics route answers 404 (control)', noDiag && noFile === 404, { links: !noDiag, status: noFile }, true);
    await closeCard(page, P2id);

    await page.evaluate(() => window.scrollTo(0, 0));

    // ---------------- phone 390x844 ----------------
    const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'en-US' });
    await routeApi(phoneCtx, seen);
    const phone = await phoneCtx.newPage();
    watch(phone, 'phone', sink);
    await login(phone, secret.password);
    const phoneRows = await phone.$$eval('[data-testid=scene-list] li.row', (els) => els.map((e) => e.getAttribute('data-scene')));
    check('phone: Scenes lists the same 6 scenes', JSON.stringify(phoneRows) === JSON.stringify(SCENES));
    await phone.click('[data-tab=ideas]');
    await phone.waitForSelector('[data-testid=idea-board] [data-idea]', { timeout: 20000 });
    const pc = await counts(phone);
    check('phone: the board has the same five columns and counts', JSON.stringify(pc) === JSON.stringify(want), pc);
    const layout = await phone.evaluate(() => ({
        pageWidth: document.documentElement.scrollWidth,
        pageHeight: document.documentElement.scrollHeight,
        columns: [...document.querySelectorAll('[data-testid=idea-board] .column')].map((c) => Math.round(c.getBoundingClientRect().width))
    }));
    results.phoneLayout = layout;
    check('phone: no sideways page scroll, one column at a time', layout.pageWidth <= 390 && layout.columns.every((w) => w <= 390), layout);
    await phone.evaluate(() => window.scrollTo(0, 0));
    shots.phoneBoard = await shot(phone, 'ideas-board-phone');
    await phone.$eval('[data-column=done]', (e) => e.scrollIntoView({ block: 'start' }));
    shots.phoneDone = await shot(phone, 'ideas-board-phone-done');
    // defect 2: the long Done column on a phone
    results.phoneColumns = await columnChecks(phone, 'phone 390', want);
    // the whole board on a phone in one picture, now that no column runs it long
    await phone.evaluate(() => window.scrollTo(0, 0));
    shots.phoneBoardFull = await shot(phone, 'ideas-board-phone-full', true);

    // defect 1 on a phone: the open card takes the screen, its titles whole; Esc returns the focus
    const pp = await openCard(phone, P2id);
    const play = await phone.$eval(pp, (e) => ({ width: Math.round(e.getBoundingClientRect().width), screen: document.documentElement.clientWidth }));
    const ptitles = (await openLayout(phone, pp)).titles;
    results.phoneOpenCard = { ...play, titles: ptitles };
    check('phone: the open card is the whole screen width, its four public titles shown whole',
        play.width === play.screen && ptitles.length === 4 && ptitles.every((x) => x.whole), results.phoneOpenCard);
    shots.phoneCard = await shot(phone, 'ideas-pilot-card-open-phone');
    await phone.keyboard.press('Escape');
    await sleep(150);
    const pf = await focusAt(phone);
    check('phone: Esc closes it and the focus returns to the card', !(await phone.$(`${pp} .idea-details`)) && pf.idea === P2id, pf);
    if (await phone.$(`${pp} .idea-details`)) await closeCard(phone, P2id);

    // logout ends both sessions
    for (const p of [page, phone]) {
        await p.click('[data-action=logout]');
        await p.waitForSelector('[data-testid=password]');
    }
    const posts = seen.filter((s) => s.startsWith('POST'));
    results.posts = posts;
    check('the only POSTs of the browser were the two logins and the two logouts (nothing moved, saved or sent)',
        posts.length === 4 && posts.filter((s) => s === 'POST /api/admin/login 200').length === 2 && posts.filter((s) => s === 'POST /api/admin/logout 200').length === 2, posts);
    results.screenshots = shots;
    await browser.close();

    // nothing reached the live site or any host but this machine and the scene CDN (posters)
    results.hosts = [...sink.hosts].sort();
    const allowed = new Set([`127.0.0.1:${SITE_PORT}`, 's3-eu-west-1.amazonaws.com', 'd28zzqy0iyovbz.cloudfront.net']);
    check('the browser reached only this machine and the scene posters\' CDN (never the live site)', results.hosts.every((h: string) => allowed.has(h)), results.hosts);
    // console: the browser logs the page's own session probe before the login (api.resume: GET
    // /api/admin/session -> 401 when signed out) as "Failed to load resource"; the 404 of the control
    // above (an idea without diagnostics) likewise; everything else counts
    const errs = sink.errors.map((e) => e.replace(EMAIL_RE, '[e-mail]'));
    const probe401 = (e: string): boolean => / console: Failed to load resource: the server responded with a status of 401 .*\/api\/admin\/session$/.test(e);
    const control404 = (e: string): boolean => new RegExp(` console: Failed to load resource: the server responded with a status of 404 .*/api/admin/reports/${P2id}/diagnostics$`).test(e);
    results.consoleErrors = errs;
    check('no script error, CSP violation or failed request in the console', errs.filter((e) => !probe401(e) && !control404(e)).length === 0, errs.filter((e) => !probe401(e) && !control404(e)));
    check('the console\'s only error lines are the signed-out session probe\'s 401 (one per page load, 2 loads) and the control\'s 404',
        errs.filter(probe401).length === 2 && errs.filter(control404).length <= 1, errs.length);

    // the data: the page changed nothing; the only addition is the synthetic report (its line, its idea,
    // its diagnostics file). The API's outbox thread (live code) does act on an e-mail the live store had
    // QUEUED: with Gmail not set up here it marks it failed / not-configured in the COPY, sends nothing.
    const after = dataHashes();
    const catalogOnly = (h: Record<string, string>): string => JSON.stringify(Object.entries(h).filter(([k]) => k !== 'ideas.json' && k !== 'reports.jsonl'));
    check('catalog.json and catalog-history/ are byte for byte unchanged, no draft was written', catalogOnly(after) === catalogOnly(before));
    const reportsAfter = readFileSync(join(DATA, 'reports.jsonl'), 'utf8');
    const added = reportsAfter.startsWith(reportsBefore) ? reportsAfter.slice(reportsBefore.length).split('\n').filter(Boolean) : null;
    check('reports.jsonl: the copy\'s lines unchanged plus exactly the synthetic report\'s line', !!added && added.length === 1 && JSON.parse(added[0]).id === SB, added?.length ?? 'rewritten');
    const now = JSON.parse(readFileSync(join(DATA, 'ideas.json'), 'utf8')) as { ideas: Any[] };
    const synthNow = now.ideas.find((r) => r.id === SB);
    check('the synthetic bug is in ideas.json exactly as the API made it (the page moved or saved nothing)', JSON.stringify(synthNow) === JSON.stringify(synthRec));
    now.ideas = now.ideas.filter((r) => r.id !== SB);
    const outbox: string[] = [];
    for (const [i, rec] of now.ideas.entries()) for (const [j, m] of (rec.thread ?? []).entries()) {
        const was = store.ideas[i]?.thread?.[j];
        if (was && was.state === 'queued' && m.state === 'failed' && m.error === 'not-configured') {
            outbox.push(`${rec.id} ${m.id} ${m.kind}: queued -> failed (not-configured), attempts ${was.attempts} -> ${m.attempts}`);
            now.ideas[i].thread[j] = was;
        }
    }
    results.outboxOnCopy = outbox;
    // the store's file may carry its own top-level fields (version, seq): compared whole, the ideas aside
    const rest = (s: Any): string => JSON.stringify({ ...s, ideas: undefined, seq: undefined });
    check('ideas.json: every live record unchanged but the outbox thread\'s local "not-configured" on e-mails the live store had queued',
        JSON.stringify(now.ideas) === JSON.stringify(store.ideas) && rest(now) === rest(store), outbox);
    // what the API printed (no request log: only start-up and errors), e-mail addresses scrubbed
    results.apiLog = apiLog.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 40).map((l) => l.replace(EMAIL_RE, '[e-mail]').slice(0, 200));
    check('the API printed no traceback', !/Traceback/.test(apiLog));
    check('the test password is in no log or data file', !apiLog.includes(secret.password) && !readFileSync(join(DATA, 'admin-audit.jsonl'), 'utf8').includes(secret.password));
}

let failed: unknown = null;
try {
    await main();
} catch (e) {
    failed = e;
    console.error(e);
} finally {
    for (const c of children) c.kill();
}
const pass = !failed && checks.length > 0 && checks.every((c) => c.ok);
// what was run (the caller says: the release id and its dist.tgz sha256, the API's commit, when the data was copied)
const source = { release: process.env.RELEASE ?? null, distSha256: process.env.DIST_SHA256 ?? null, apiCommit: process.env.API_COMMIT ?? null, dataFetched: process.env.DATA_FETCHED ?? null, tag: process.env.TAG ?? null };
const summary = { pass, source, error: failed ? String(failed).slice(0, 400) : null,
    passed: checks.filter((c) => c.ok).length, failed: checks.filter((c) => !c.ok).length, failedChecks: checks.filter((c) => !c.ok).map((c) => c.name), checks, ...results };
// the summary holds no e-mail address: refuse to write one that does
const text = JSON.stringify(summary).replace(EMAIL_RE, '[e-mail]');
const file = writeEvidence(NAME, JSON.parse(text));
console.log(`${pass ? 'PASS' : 'FAIL'} ${file}`);
process.exit(pass ? 0 : 1);
