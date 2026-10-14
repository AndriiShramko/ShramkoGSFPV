// The owner's admin (/admin/: Scenes and Ideas tabs) end to end in a browser against an EXACT local copy of
// production: the live release's dist (its CI artifact, served by scripts/serve-csp.mjs with nginx.conf's
// admin CSP), the live API code (apps/api, same files as the live commit) and a copy of the live data
// (ideas.json, catalog.json, catalog-history/, reports.jsonl, fetched read-only from the hub by the caller).
// The live site is never touched: the login happens only here, with the TEST password of the gitignored
// .cache/admin-test.json. No e-mail and no Telegram can leave: every TG_*/GMAIL_* is empty and the SMTP and
// Telegram hosts point at a closed local port. Read-only by design: the probe opens cards and the thank-you
// draft but never moves, saves or sends (Not now closes the draft); it checks that only login/logout were
// POSTed and that the data files are byte for byte the same afterwards.
//   DIST=<extracted dist.tgz> DATA=<data copy> npx tsx src/probe-admin-live-copy.ts      (from tools/bench)
//   (+ RELEASE, DIST_SHA256, API_COMMIT, DATA_FETCHED: written into the evidence as its source)
// The copy: ssh the hub "cd <base>/data && tar cf - ideas.json catalog.json catalog-draft.json catalog-history
// reports.jsonl" into a gitignored .cache folder; delete it afterwards (ideas.json holds pilots' e-mail addresses).
// Holds no GPU work but runs a browser: the caller takes the shared GPU lock (C:/dev/.gpu-lock).
// Evidence: evidence/<date>/admin-live-copy.json (no e-mail addresses: "contact present") and
// evidence/<date>/admin-live-copy/*.png (e-mail addresses blanked in the page before every screenshot).
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
const SITE_PORT = 5400 + Math.floor(Math.random() * 90);
const API_PORT = 8100 + Math.floor(Math.random() * 800);
const SITE = `http://127.0.0.1:${SITE_PORT}`;
const API = `http://127.0.0.1:${API_PORT}`;
const SHOTS = join(REPO, 'evidence', today(), 'admin-live-copy');
const PILOT = ['R-20261006-0001', 'R-20261006-0002', 'R-20261006-0003'];
const SCENES = ['887f27aa', '39e63ce9', '7a475d38', '70b50d42', 'b11e45d1', '0230d903'];
const STATUSES = ['new', 'accepted', 'in_progress', 'done', 'rejected'] as const;
const KINDS = ['idea', 'bug', 'note', 'feature'];
const HEADINGS: Record<string, string> = { new: 'New', accepted: 'Accepted: the queue', in_progress: 'In progress', done: 'Done', rejected: 'Rejected' };
const EMAIL_RE = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;
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

/** sha256 of every data file the admin reads (the probe must change none of them). */
function dataHashes(): Record<string, string> {
    const out: Record<string, string> = {};
    const add = (rel: string): void => { const p = join(DATA, rel); if (existsSync(p) && statSync(p).isFile()) out[rel] = createHash('sha256').update(readFileSync(p)).digest('hex'); };
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
    await ctx.route((u) => u.origin === SITE && u.pathname.startsWith('/api/'), async (route) => {
        const req = route.request();
        const u = new URL(req.url());
        const inH = await req.allHeaders();
        const headers: Record<string, string> = { 'X-Forwarded-For': '198.51.100.1' };
        for (const k of ['content-type', 'cookie', 'x-csrf', 'if-none-match']) if (inH[k]) headers[k] = inH[k];
        const raw = req.postDataBuffer();
        const r = await fetch(API + u.pathname + u.search, { method: req.method(), headers, body: req.method() === 'POST' && raw ? new Uint8Array(raw) : undefined });
        seen.push(`${req.method()} ${u.pathname} ${r.status}`);
        const out: Record<string, string> = {};
        for (const k of ['content-type', 'cache-control', 'etag', 'retry-after', 'set-cookie']) { const v = r.headers.get(k); if (v) out[k] = v; }
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
    return `evidence/${today()}/admin-live-copy/${name}.png`;
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

async function main(): Promise<void> {
    const secret = testSecret();
    const before = dataHashes();
    results.dataFiles = Object.keys(before);

    // what the board must show, from the data copy itself (the UI's own placement rules: api.ts parseIdea)
    const store = JSON.parse(readFileSync(join(DATA, 'ideas.json'), 'utf8')) as { ideas: Any[] };
    const placeable = store.ideas.filter((r) => typeof r.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(r.id) && (STATUSES as readonly string[]).includes(r.status) && KINDS.includes(r.kind));
    const want = Object.fromEntries(STATUSES.map((s) => [s, String(placeable.filter((r) => r.status === s).length)]));
    const URG = ['low', 'normal', 'high', 'urgent'];
    const onLanding = (r: Any): boolean => r.public?.visible !== false && !!String(r.public?.title?.en ?? '').trim() && ['accepted', 'in_progress', 'done'].includes(r.status) && r.suspect !== true;
    results.expected = {
        records: store.ideas.length, placeable: placeable.length, columns: want,
        kinds: Object.fromEntries(KINDS.map((k) => [k, placeable.filter((r) => r.kind === k).length])),
        withContact: placeable.filter((r) => String(r.contact ?? '') !== '').length,
        onLanding: placeable.filter(onLanding).length,
        highOrAbove: placeable.filter((r) => URG.indexOf(r.urgency) >= 2).length,
        withDiagnostics: placeable.filter((r) => r.diagnostics === true).length
    };
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
    const site = spawn(process.execPath, [join(REPO, 'tools', 'bench', 'scripts', 'serve-csp.mjs'), DIST, String(SITE_PORT)], { stdio: 'ignore' });
    children.push(site);
    await until(`${API}/api/health`);
    await until(`${SITE}/admin/`);
    const adminHead = await fetch(`${SITE}/admin/`);
    results.adminCsp = adminHead.headers.get('content-security-policy');
    check('the admin page is served under nginx.conf\'s admin CSP (script-src \'self\' only)', /script-src 'self';/.test(results.adminCsp ?? '') && adminHead.headers.get('x-csp-mode') === 'admin');

    const { browser, which } = await launchChrome({ headless: true });
    results.browser = which;
    const sink = { errors: [] as string[], hosts: new Set<string>() };
    const seen: string[] = [];

    // ---------------- desktop 1440x900 ----------------
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US' });
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

    // Ideas: the five columns with the counts of ideas.json
    await page.click('[data-tab=ideas]');
    await page.waitForSelector('[data-testid=idea-board] [data-idea]', { timeout: 20000 });
    const c0 = await counts(page);
    results.columns = c0;
    check('the kanban columns New / Accepted / In progress / Done / Rejected count what ideas.json holds', JSON.stringify(c0) === JSON.stringify(want), c0);
    const heads = await page.$$eval('[data-testid=idea-board] .column', (els) => els.map((e) => [e.getAttribute('data-column'), e.querySelector('h2')?.firstChild?.textContent ?? '']));
    check('the column headings, in board order', JSON.stringify(heads) === JSON.stringify(STATUSES.map((s) => [s, HEADINGS[s]])), heads.map((x) => x[1]));
    const total = await shownText(page);
    check(`every record is placed: "${placeable.length} of ${store.ideas.length} shown"`, total === `${placeable.length} of ${store.ideas.length} shown`, total);
    check('no record is reported unreadable', await page.$eval('[data-testid=idea-unreadable]', (e) => (e as HTMLElement).hidden === true));
    results.setupNote = await page.$eval('[data-testid=idea-setup]', (e) => e.textContent ?? '');
    check('the copy\'s API has no Gmail and no Telegram webhook (the page says so): nothing can be sent from here',
        /Gmail is not set up/.test(results.setupNote) && /Telegram only receives reports/.test(results.setupNote), results.setupNote);

    // the Polish pilot's three ideas: in Done, their public titles, a thank-you DRAFT waiting
    const pilot: Record<string, Any> = {};
    for (const id of PILOT) {
        const rec = store.ideas.find((r) => r.id === id);
        const sel = `[data-idea="${id}"]`;
        const st = await page.$eval(sel, (e) => e.getAttribute('data-status')).catch(() => null);
        const chips = await page.$$eval(`${sel} [data-chip]`, (els) => els.map((e) => e.getAttribute('data-chip')));
        const thanksBtn = await page.$eval(`${sel} [data-action=thanks]`, (e) => e.textContent ?? '').catch(() => null);
        await page.click(`${sel} [data-action=details]`);
        await page.waitForSelector(`${sel} .idea-details`);
        const titles = Object.fromEntries(await page.$$eval(`${sel} [data-field^=title-]`, (els) => els.map((e) => [e.getAttribute('data-field')?.slice(6), (e as HTMLInputElement).value])));
        const mails = await page.$$eval(`${sel} [data-field=mails] li[data-mail]`, (els) => els.map((e) => e.getAttribute('data-state')));
        const contactShown = await page.$eval(`${sel} [data-field=contact]`, (e) => !e.classList.contains('muted')).catch(() => false);
        const wantTitles = Object.fromEntries(Object.entries(rec?.public?.title ?? {}).filter(([, v]) => String(v).trim()));
        pilot[id] = { status: st, chips, titleLangs: Object.keys(titles).filter((l) => titles[l]), titleEn: titles.en, mails, contact: contactShown ? 'contact present' : 'none', thanksButton: thanksBtn };
        check(`${id} is in Done`, st === 'done', st);
        check(`${id} shows its public titles (4 languages, as ideas.json)`, JSON.stringify(Object.fromEntries(Object.entries(titles).filter(([, v]) => v))) === JSON.stringify(wantTitles), titles.en);
        check(`${id} is on the landing (chip) and has the pilot's contact`, chips.includes('landing') && chips.includes('contact') && contactShown);
        check(`${id} has exactly one thank-you e-mail, a draft not sent, and offers "read and send"`, JSON.stringify(mails) === '["draft"]' && /read and send/.test(thanksBtn ?? ''), { mails, button: thanksBtn });
        if (id !== 'R-20261006-0002') await page.click(`${sel} [data-action=details]`); // close again
    }
    results.pilot = pilot;

    // the open pilot card (details: public titles, the draft e-mail row), then its draft in the dialog
    const P2 = '[data-idea="R-20261006-0002"]';
    // the whole open card in one picture: its column's own scroll box is let out for the screenshot (display only)
    await page.$eval(P2, (e) => { (e.closest('.cards') as HTMLElement).style.maxHeight = 'none'; });
    await blankEmails(page);
    check('screenshot ideas-pilot-card-open-desktop: no e-mail address visible', (await emailsVisible(page)) === 0);
    mkdirSync(SHOTS, { recursive: true });
    await page.locator(P2).screenshot({ path: join(SHOTS, 'ideas-pilot-card-open-desktop.png'), scale: 'css' });
    shots.pilotCard = `evidence/${today()}/admin-live-copy/ideas-pilot-card-open-desktop.png`;
    await page.$eval(P2, (e) => { (e.closest('.cards') as HTMLElement).style.maxHeight = ''; e.scrollIntoView({ block: 'start' }); });
    const posts0 = seen.filter((s) => s.startsWith('POST')).length;
    await page.click(`${P2} [data-action=thanks]`);
    await page.waitForSelector('[data-testid=thanks-dialog] [data-step=draft]:not([hidden])');
    const dlg = await page.evaluate(() => ({
        subject: (document.querySelector('[data-field=thanks-subject]') as HTMLInputElement).value,
        body: (document.querySelector('[data-field=thanks-body]') as HTMLTextAreaElement).value,
        toSet: !!(document.querySelector('[data-field=thanks-to]') as HTMLInputElement).value,
        summaryHidden: (document.querySelector('[data-step=summary]') as HTMLElement).hidden,
        editShown: !(document.querySelector('[data-action=thanks-edit]') as HTMLElement).hidden,
        sendLabel: document.querySelector('[data-action=thanks-send]')?.textContent ?? ''
    }));
    const m2 = store.ideas.find((r) => r.id === 'R-20261006-0002')?.thread?.find((m: Any) => m.kind === 'done');
    results.draftDialog = { subject: dlg.subject, bodyChars: dlg.body.length, to: dlg.toSet ? 'contact present' : 'none', sendLabel: dlg.sendLabel };
    check('the thank-you dialog opens straight at the DRAFT (step 2), the whole e-mail as stored', dlg.summaryHidden && dlg.subject === m2?.subject && dlg.body === m2?.plain && dlg.toSet,
        { subject: dlg.subject, bodyChars: dlg.body.length });
    check('the draft dialog offers Send and Edit (not pressed)', dlg.editShown && dlg.sendLabel.length > 0);
    shots.thanksDraft = await shot(page, 'ideas-pilot-thanks-draft-desktop');
    await page.click('[data-action=thanks-later]'); // Not now: sends nothing
    await page.waitForSelector('[data-testid=thanks-dialog]', { state: 'detached' });
    check('opening the draft and Not now sent nothing (no POST)', seen.filter((s) => s.startsWith('POST')).length === posts0);
    await page.click(`${P2} [data-action=details]`);

    // search and filters
    const reset = async (): Promise<void> => {
        await page.fill('[data-testid=idea-search]', '');
        for (const f of ['minUrgency', 'contact', 'landing']) await page.selectOption(`[data-filter=${f}]`, 'any');
        for (const k of KINDS) if ((await page.$eval(`[data-kind=${k}]`, (e) => e.getAttribute('aria-pressed'))) !== 'true') await page.click(`[data-kind=${k}]`);
    };
    const filtered: Record<string, Any> = {};
    await page.fill('[data-testid=idea-search]', 'R-20261006-0002');
    filtered.searchId = { ids: await boardIds(page), shown: await shownText(page) };
    check('search "R-20261006-0002" finds exactly that card', JSON.stringify(filtered.searchId.ids) === '["R-20261006-0002"]' && filtered.searchId.shown === `1 of ${store.ideas.length} shown`, filtered.searchId);
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
    check('kind filter: without seeded features the board keeps ideas, bugs and notes', filtered.noFeatures === placeable.length - results.expected.kinds.feature, filtered.noFeatures);
    await reset();
    await page.selectOption('[data-filter=landing]', 'yes');
    filtered.onLanding = (await boardIds(page)).length;
    check('filter "on the landing" keeps what the roadmap shows', filtered.onLanding === results.expected.onLanding, filtered.onLanding);
    await reset();
    await page.selectOption('[data-filter=minUrgency]', 'high');
    filtered.highOrAbove = (await boardIds(page)).length;
    check('filter "urgency high or above" matches the data', filtered.highOrAbove === results.expected.highOrAbove, filtered.highOrAbove);
    await reset();
    check('after the filters are reset the board is whole again', JSON.stringify(await counts(page)) === JSON.stringify(want));
    results.filters = filtered;

    // bug details / download: only where a record has stored diagnostics
    const diagLinks = await page.$$eval('[data-action=diagnostics]', (els) => els.length);
    results.diagnostics = { recordsWithDiagnostics: results.expected.withDiagnostics, linksOnOpenCards: diagLinks };
    check('no record of the live data has stored diagnostics, so no details/download view to open (none shown either)', results.expected.withDiagnostics === 0 && diagLinks === 0, results.diagnostics);

    await page.$eval('[data-testid=idea-board]', (e) => e.scrollIntoView({ block: 'start' }));
    await page.evaluate(() => window.scrollTo(0, 0));
    shots.board = await shot(page, 'ideas-board-desktop');

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
        columns: [...document.querySelectorAll('[data-testid=idea-board] .column')].map((c) => Math.round(c.getBoundingClientRect().width))
    }));
    results.phoneLayout = layout;
    check('phone: no sideways page scroll, one column at a time', layout.pageWidth <= 390 && layout.columns.every((w) => w <= 390), layout);
    // two screens, not the whole page (the 60 Done cards make it ~12000 px tall): the top with the filters and
    // New, then from the Done column's heading
    await phone.evaluate(() => window.scrollTo(0, 0));
    shots.phoneBoard = await shot(phone, 'ideas-board-phone');
    await phone.$eval('[data-column=done]', (e) => e.scrollIntoView({ block: 'start' }));
    shots.phoneDone = await shot(phone, 'ideas-board-phone-done');

    // logout ends both sessions
    for (const p of [page, phone]) {
        await p.click('[data-action=logout]');
        await p.waitForSelector('[data-testid=password]');
    }
    const posts = seen.filter((s) => s.startsWith('POST'));
    results.posts = posts;
    check('the only POSTs were the two logins and the two logouts (nothing moved, saved or sent)',
        posts.length === 4 && posts.filter((s) => s === 'POST /api/admin/login 200').length === 2 && posts.filter((s) => s === 'POST /api/admin/logout 200').length === 2, posts);
    results.screenshots = shots;
    await browser.close();

    // nothing reached the live site or any host but this machine and the scene CDN (posters)
    results.hosts = [...sink.hosts].sort();
    const allowed = new Set([`127.0.0.1:${SITE_PORT}`, 's3-eu-west-1.amazonaws.com', 'd28zzqy0iyovbz.cloudfront.net']);
    check('the browser reached only this machine and the scene posters\' CDN (never the live site)', results.hosts.every((h: string) => allowed.has(h)), results.hosts);
    // console: the browser logs the page's own session probe before the login (api.resume: GET
    // /api/admin/session -> 401 when signed out) as "Failed to load resource"; everything else counts
    const errs = sink.errors.map((e) => e.replace(EMAIL_RE, '[e-mail]'));
    const probe401 = (e: string): boolean => / console: Failed to load resource: the server responded with a status of 401 .*\/api\/admin\/session$/.test(e);
    results.consoleErrors = errs;
    check('no script error, CSP violation or failed request in the console', errs.filter((e) => !probe401(e)).length === 0, errs.filter((e) => !probe401(e)));
    check('the console\'s only error lines are the signed-out session probe\'s 401, one per page load (2 loads)', errs.length === 2 && errs.every(probe401), errs.length);

    // the data: the page changed nothing. The API's outbox thread (live code) does act on an e-mail the live
    // store had QUEUED: with Gmail not set up here it marks it failed / not-configured in the COPY, sends nothing.
    const after = dataHashes();
    const others = (h: Record<string, string>): string => JSON.stringify(Object.entries(h).filter(([k]) => k !== 'ideas.json'));
    check('catalog.json, catalog-history/ and reports.jsonl are byte for byte unchanged, no draft was written', others(after) === others(before));
    const now = JSON.parse(readFileSync(join(DATA, 'ideas.json'), 'utf8')) as { ideas: Any[] };
    const outbox: string[] = [];
    for (const [i, rec] of now.ideas.entries()) for (const [j, m] of (rec.thread ?? []).entries()) {
        const was = store.ideas[i]?.thread?.[j];
        if (was && was.state === 'queued' && m.state === 'failed' && m.error === 'not-configured') {
            outbox.push(`${rec.id} ${m.id} ${m.kind}: queued -> failed (not-configured), attempts ${was.attempts} -> ${m.attempts}`);
            now.ideas[i].thread[j] = was;
        }
    }
    results.outboxOnCopy = outbox;
    check('ideas.json: no change but the outbox thread\'s local "not-configured" on e-mails the live store had queued', JSON.stringify(now) === JSON.stringify(store), outbox);
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
const source = { release: process.env.RELEASE ?? null, distSha256: process.env.DIST_SHA256 ?? null, apiCommit: process.env.API_COMMIT ?? null, dataFetched: process.env.DATA_FETCHED ?? null };
const summary = { pass, source, error: failed ? String(failed).slice(0, 400) : null,
    passed: checks.filter((c) => c.ok).length, failed: checks.filter((c) => !c.ok).length, checks, ...results };
// the summary holds no e-mail address: refuse to write one that does
const text = JSON.stringify(summary).replace(EMAIL_RE, '[e-mail]');
const file = writeEvidence('admin-live-copy', JSON.parse(text));
console.log(`${pass ? 'PASS' : 'FAIL'} ${file}`);
process.exit(pass ? 0 : 1);
