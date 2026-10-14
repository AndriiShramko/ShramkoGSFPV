// v0.6 owner's admin, end to end in a browser: the admin page (/fly/admin/ on the Vite dev server) and
// the pilot's scene picker (/fly/) against the real API (apps/api/server.py started here on a temporary
// DATA_DIR with a TEST password hash; the browser's /api/** is routed to it). Every check has a
// negative control that must fire. The test password is generated once and kept only in the
// gitignored .cache/admin-test.json; the owner's real password is never used.
//   cd apps/fly && npx vite --port 5362 --strictPort --host 127.0.0.1      (another shell)
//   FLY=http://127.0.0.1:5362 npx tsx src/accept-v06-admin.ts               (from tools/bench)
// No GPU needed (the picker and the admin page only). Evidence: evidence/<date>/v06-admin.json + 2 PNG.
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
const API = `http://127.0.0.1:${API_PORT}`;
const TMP = process.env.GSFPV_TMP ?? (existsSync('D:/') ? 'D:/gsfpv-tmp' : join(REPO, '.cache'));
mkdirSync(TMP, { recursive: true });
const DATA = mkdtempSync(join(TMP, 'gsfpv-v06-api-'));
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

/** The test password (made up here, once) and its hash, from the gitignored .cache. */
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

/** /api/** of the page goes to the local API with the page's own cookie, CSRF and cache headers; Set-Cookie comes back. */
async function routeApi(ctx: BrowserContext, seen: string[]): Promise<void> {
    await ctx.route((u) => u.origin === new URL(FLY).origin && u.pathname.startsWith('/api/'), async (route) => {
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

const order = (page: Page, sel: string): Promise<string[]> => page.$$eval(sel, (els) => els.map((e) => e.getAttribute('data-scene') ?? ''));

async function pickerView(page: Page): Promise<{ featured: string[]; grid: string[]; pitch: string }> {
    await page.goto(`${FLY}/fly/?nowarn=1`);
    await page.waitForFunction(() => (window as unknown as { __gsfpv?: { status?: string } }).__gsfpv?.status === 'picker', null, { timeout: 60000 });
    return {
        featured: await order(page, '[data-testid=featured] .scene-card'),
        grid: await order(page, '.scene-grid > .scene-cell > .scene-card'),
        pitch: (await page.$eval('[data-testid=featured] .sf-pitch', (e) => e.textContent ?? '').catch(() => ''))
    };
}

const savedState = (page: Page): Promise<unknown> => page.waitForFunction(() => {
    const s = document.querySelector('[data-testid=draft-status]');
    return s && !s.textContent?.includes('\u2026') && (s.classList.contains('warn') || s.classList.contains('ok'));
}, null, { timeout: 15000 });

async function main(): Promise<void> {
    const secret = testSecret();
    mkdirSync(join(REPO, 'evidence', today()), { recursive: true });
    // no Telegram and no Gmail whatever the shell has: an e-mail the owner Sends here waits (waiting_setup)
    const child = spawn('python', [join(REPO, 'apps', 'api', 'server.py')], {
        env: { ...process.env, DATA_DIR: DATA, PORT: String(API_PORT), ADMIN_PASSWORD_HASH: secret.hash, TG_BOT_TOKEN: '', TG_CHAT_ID: '', TG_OWNER_BOT_TOKEN: '',
            TG_WEBHOOK_SECRET: '', GMAIL_USER: '', GMAIL_APP_PASSWORD: '', MIN_FREE_GB: '0' },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    children.push(child);
    let apiLog = '';
    child.stdout.on('data', (b) => { apiLog += String(b); });
    child.stderr.on('data', (b) => { apiLog += String(b); });
    await until(`${API}/api/health`);
    // a pilot's idea, stored the way the simulator sends it
    const rep = await (await fetch(`${API}/api/report`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.9' },
        body: JSON.stringify({ kind: 'idea', message: 'v06 acceptance: more night scenes please', page: 'fly', locale: 'en', t: 9000 }) })).json();
    results.reportId = rep.id;
    // a second pilot left an e-mail: the thank-you step below (made-up example.com address; nothing is sent)
    const rep2 = await (await fetch(`${API}/api/report`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.10' },
        body: JSON.stringify({ kind: 'idea', message: 'v07 acceptance: a darker night sky', contact: 'pilot.v07@example.com', page: 'fly', locale: 'en', t: 9000 }) })).json();
    results.report2Id = rep2.id;

    const { browser, which } = await launchChrome({ headless: true });
    results.browser = which;
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    await ctx.addInitScript({ content: "try { localStorage.setItem('gsfpv.warned', '1'); } catch (e) {}" });
    const seen: string[] = [];
    await routeApi(ctx, seen);
    const errors: string[] = [];
    const admin = await ctx.newPage();
    const pilot = await ctx.newPage();
    for (const p of [admin, pilot]) p.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)));

    // the pilot's picker before anything: the seeded catalogue (showcase.json), nothing featured
    const before = await pickerView(pilot);
    results.pickerBefore = before;
    check('picker reads /api/catalog', seen.some((s) => s.startsWith('GET /api/catalog 200')));

    // login: a wrong password is refused (control), the test password gets in
    await admin.goto(`${FLY}/fly/admin/`);
    await admin.waitForSelector('[data-testid=password]');
    await admin.fill('[data-testid=password]', `${secret.password}-wrong`);
    await admin.press('[data-testid=password]', 'Enter');
    await admin.waitForSelector('.login [role=alert]:not(:empty)');
    check('wrong password refused in the page', seen.includes('POST /api/admin/login 401') && (await admin.$('[data-testid=scene-list]')) === null, true);
    await admin.fill('[data-testid=password]', secret.password);
    await admin.press('[data-testid=password]', 'Enter');
    await admin.waitForSelector('[data-testid=scene-list] li.row');
    const cookies = await ctx.cookies(); // all: a URL filter would leave out a Secure cookie of an http origin
    const c = cookies.find((x) => x.name === 'gsfpv_admin');
    results.cookie = c ? { httpOnly: c.httpOnly, secure: c.secure, sameSite: c.sameSite, path: c.path } : null;
    check('session cookie is HttpOnly, Secure, SameSite=Strict, Path=/api/admin', !!c && c.httpOnly && c.secure && c.sameSite === 'Strict' && c.path === '/api/admin');
    check('the page cannot read the session cookie', !(await admin.evaluate(() => document.cookie)).includes('gsfpv_admin'));
    const start = await order(admin, '[data-testid=scene-list] li.row');
    results.adminStart = start;
    check('the admin list is the published list', JSON.stringify(start) === JSON.stringify(before.grid));

    // pin the third scene, then reorder: drag the first below the second, and the keyboard (ArrowUp on a handle)
    const pinId = start[2];
    await admin.click(`li.row[data-scene="${pinId}"] [data-action=pin]`);
    await admin.dragAndDrop(`li.row[data-scene="${start[0]}"]`, `li.row[data-scene="${start[1]}"]`);
    const afterDrag = await order(admin, '[data-testid=scene-list] li.row');
    check('drag and drop moved the first scene to second place', afterDrag[0] === start[1] && afterDrag[1] === start[0]);
    await admin.focus(`li.row[data-scene="${pinId}"] .handle`);
    await admin.keyboard.press('ArrowUp');
    const want = await order(admin, '[data-testid=scene-list] li.row');
    check('ArrowUp on a handle moved the scene up', want.indexOf(pinId) === 1);
    // the pitch line of the pinned scene, in the editor
    await admin.click(`li.row[data-scene="${pinId}"] [data-action=edit]`);
    const pitch = 'Fly the old town at full speed';
    await admin.fill(`li.row[data-scene="${pinId}"] .editor [data-pitch=en]`, pitch);
    await savedState(admin);
    check('the draft is saved and marked unpublished', (await admin.$eval('[data-testid=draft-status]', (e) => e.className)).includes('warn'));
    results.draftOrder = want;

    // control: a saved draft changes nothing for pilots
    const draftView = await pickerView(pilot);
    results.pickerWithDraft = draftView;
    check('draft before publish changes nothing in the picker', JSON.stringify(draftView) === JSON.stringify(before), true);

    // publish: the picker shows the pinned scene in Featured and the new order
    await admin.click('[data-action=publish]');
    await admin.waitForFunction(() => document.querySelector('[data-testid=draft-status]')?.classList.contains('ok'), null, { timeout: 15000 });
    await admin.screenshot({ path: join(REPO, 'evidence', today(), 'v06-admin-scenes.png') });
    const after = await pickerView(pilot);
    results.pickerAfter = after;
    check('after publish: the pinned scene is first in Featured', after.featured[0] === pinId);
    check('after publish: the pitch line shows on the Featured card', after.pitch === pitch);
    check('after publish: the rest follows the admin order', JSON.stringify(after.grid) === JSON.stringify(want.filter((x) => x !== pinId)));
    await pilot.waitForFunction(() => [...document.images].every((i) => i.complete), null, { timeout: 20000 }).catch(() => undefined);
    await pilot.screenshot({ path: join(REPO, 'evidence', today(), 'v06-admin-picker.png') });
    results.history = await admin.$$eval('.history [data-version]', (els) => els.map((e) => e.getAttribute('data-version')));
    check('the publish is in the history (undo)', (results.history as string[]).length === 1);

    // adding: a pasted link already in the list cannot be added twice (control); words from a title find
    // scenes on SuperSplat (our proxy), a chosen one is checked on the CDN and goes on top of the draft
    await admin.fill('[data-testid=add-input]', `https://superspl.at/scene/${start[0]}`);
    await admin.click('[data-action=find]');
    await admin.waitForSelector('[data-testid=add-preview] [data-action=add]');
    results.addKnown = await admin.$eval('[data-testid=add-preview]', (e) => e.textContent);
    check('a pasted link of a listed scene is checked on the CDN and cannot be added twice',
        await admin.$eval('[data-testid=add-preview] [data-action=add]', (b) => (b as HTMLButtonElement).disabled) && /v\d+/.test(results.addKnown), true);
    await admin.fill('[data-testid=add-input]', 'Modlinek Villa');
    await admin.click('[data-action=find]');
    await admin.waitForSelector('.results .result', { timeout: 30000 });
    const fresh = (await admin.$$eval('.results .result', (els) => els.map((e) => e.getAttribute('data-scene') ?? ''))).find((id) => !want.includes(id));
    results.addedFromSearch = fresh ?? null;
    if (fresh) {
        await admin.click(`.results .result[data-scene="${fresh}"] button`);
        await admin.waitForSelector('[data-testid=add-preview] [data-action=add]:not([disabled])', { timeout: 30000 });
        results.addPreview = await admin.$eval('[data-testid=add-preview]', (e) => e.textContent);
        await admin.click('[data-testid=add-preview] [data-action=add]');
        await savedState(admin);
        const withNew = await order(admin, '[data-testid=scene-list] li.row');
        check('a scene found by title words is added on top of the draft', withNew[0] === fresh && withNew.length === want.length + 1);
        check('its title and author came from SuperSplat', /Modlinek/.test(await admin.$eval(`li.row[data-scene="${fresh}"]`, (e) => e.textContent ?? '')));
        admin.once('dialog', (d) => void d.accept());
        await admin.click('[data-action=discard]');
        await admin.waitForFunction(() => document.querySelector('[data-testid=draft-status]')?.classList.contains('ok'), null, { timeout: 15000 });
        check('discard draft brings back the published list', JSON.stringify(await order(admin, '[data-testid=scene-list] li.row')) === JSON.stringify(want));
    } else check('SuperSplat search returned a scene that is not listed yet', false);

    // v0.7 lane R: a pasted link's ?budget= and ?stochastic go into the new entry as its render (the
    // catalogue contract field); the server's draft keeps them. Control: the same scene's plain link
    // shows no render line in its preview.
    const RENDER_SCENE = process.env.RENDER_SCENE ?? '2f1ddf5f';
    if (!want.includes(RENDER_SCENE)) {
        await admin.fill('[data-testid=add-input]', `https://superspl.at/scene/${RENDER_SCENE}`);
        await admin.click('[data-action=find]');
        await admin.waitForSelector('[data-testid=add-preview] [data-action=add]', { timeout: 30000 });
        check('the plain link of the same scene shows no render line', (await admin.$('[data-testid=add-preview] [data-testid=add-render]')) === null, true);
        await admin.fill('[data-testid=add-input]', `https://superspl.at/scene/${RENDER_SCENE}?budget=8&stochastic`);
        await admin.click('[data-action=find]');
        await admin.waitForSelector('[data-testid=add-preview] [data-testid=add-render]', { timeout: 30000 });
        results.addRenderLine = await admin.$eval('[data-testid=add-render]', (e) => e.textContent);
        await admin.fill('[data-testid=add-preview] [data-testid=add-title]', 'v07 render check');
        await admin.click('[data-testid=add-preview] [data-action=add]');
        await savedState(admin);
        const draft = JSON.parse(readFileSync(join(DATA, 'catalog-draft.json'), 'utf8')) as { scenes: { id: string; render?: unknown }[] };
        results.draftRender = draft.scenes.find((s) => s.id === RENDER_SCENE)?.render ?? null;
        check('a pasted link\'s budget and stochastic are stored as the entry\'s render', JSON.stringify(results.draftRender) === JSON.stringify({ budgetM: 8, stochastic: true }));
        check('the preview says how the link asks the scene to be drawn', /8/.test(String(results.addRenderLine)));
        admin.once('dialog', (d) => void d.accept());
        await admin.click('[data-action=discard]');
        await admin.waitForFunction(() => document.querySelector('[data-testid=draft-status]')?.classList.contains('ok'), null, { timeout: 15000 });
    } else check(`${RENDER_SCENE} is not in the list yet (the render check adds it)`, false);

    // ideas (v0.7: the Ideas kanban replaced the Reports tab; needs lane B's /api/admin/ideas, so this part
    // passes only on the merged v0.7 branch): the pilot's idea is a card in New with its words; moved to
    // Rejected with the card's Column select, the server keeps it; the visitor's report is unchanged
    await admin.click('[data-tab=ideas]');
    await admin.waitForSelector(`[data-idea="${rep.id}"][data-status=new]`);
    check('the report is a card in New with its words', (await admin.$eval(`[data-idea="${rep.id}"] .idea-text`, (e) => e.textContent)) === 'v06 acceptance: more night scenes please');
    // Details opens the card in the side panel (modal); Esc closes it
    const PANEL = '[data-testid=idea-panel]';
    await admin.click(`[data-idea="${rep.id}"] [data-action=details]`);
    await admin.waitForSelector(`${PANEL}[open][data-panel-idea="${rep.id}"]`);
    await admin.selectOption(`${PANEL} [data-field=status]`, 'rejected');
    await admin.waitForSelector(`[data-idea="${rep.id}"][data-status=rejected]:not([aria-busy])`);
    await admin.keyboard.press('Escape');
    await admin.waitForSelector(`${PANEL}:not([open])`, { state: 'attached' });
    const stored = await admin.evaluate(async (id) => ((await (await fetch('/api/admin/ideas', { cache: 'no-store' })).json()) as { ideas: { id: string; status: string }[] }).ideas.find((x) => x.id === id)?.status, rep.id);
    check('the move is stored server-side', stored === 'rejected');
    const reportsLine = readFileSync(join(DATA, 'reports.jsonl'), 'utf8');
    check('the visitor\'s report itself is unchanged', reportsLine.includes('more night scenes please') && !reportsLine.includes('rejected'), true);

    // the thank-you against the real server (lane B's send-done {id, mail}): the second pilot's idea goes to
    // Done, the owner writes what was done, the server's draft is shown; meanwhile a newer summary replaces
    // it (as an agent or Telegram would: ideas/done again); Send under the draft he read is refused (409
    // stale-draft), the dialog shows the current draft, and Send takes that one. Gmail is not set up on this
    // server: the e-mail waits (waiting_setup), nothing can leave this machine.
    const pid = String(rep2.id);
    type Mail = { id: string; kind: string; state: string };
    const doneThread = async (): Promise<Mail[]> => (await admin.evaluate(async (id) => ((await (await fetch(`/api/admin/ideas/${id}`, { cache: 'no-store' })).json()) as { idea: { thread: Mail[] } }).idea.thread, pid))
        .filter((m) => m.kind === 'done');
    /** A POST with the page's own session and CSRF token (what another tab of the admin would send). */
    const post = (route: string, body: unknown): Promise<{ status: number; json: Any }> => admin.evaluate(async ([r, b]) => {
        const s = (await (await fetch('/api/admin/session', { cache: 'no-store' })).json()) as { csrf: string };
        const res = await fetch(`/api/admin/${r}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF': s.csrf }, body: JSON.stringify(b) });
        return { status: res.status, json: await res.json() };
    }, [route, body] as const);
    await admin.waitForSelector(`[data-idea="${pid}"][data-status=new]`);
    await admin.click(`[data-idea="${pid}"] [data-action=details]`);
    await admin.waitForSelector(`${PANEL}[open][data-panel-idea="${pid}"]`);
    await admin.selectOption(`${PANEL} [data-field=status]`, 'done');
    await admin.waitForSelector('[data-testid=thanks-dialog] [data-field=thanks-summary]');
    await admin.fill('[data-field=thanks-summary]', 'Night scenes are in the list now.');
    await admin.click('[data-action=thanks-make]');
    await admin.waitForSelector('[data-testid=thanks-dialog] [data-step=draft]:not([hidden])');
    const read = await doneThread();
    check('the real server wrote the thank-you as a draft only', JSON.stringify(read.map((m) => m.state)) === '["draft"]');
    const newer = await post('ideas/done', { id: pid, summary: { en: 'Night scenes and a darker sky are in the list now.' } });
    const oldBody = await post('ideas/send-done', { id: pid });
    results.sendDoneWithoutDraft = oldBody;
    check('the real server refuses send-done without the draft id (the old {id} body): 400 bad-mail', oldBody.status === 400 && oldBody.json.reason === 'bad-mail', true);
    await admin.click('[data-action=thanks-send]');
    const shownNewer = await admin.waitForFunction(() => (document.querySelector('[data-field=thanks-body]') as HTMLTextAreaElement | null)?.value.includes('darker sky'), null, { timeout: 10000 }).then(() => true, () => false);
    const staleNote = await admin.textContent('[data-field=thanks-status]');
    const mid = await doneThread();
    results.staleDraft = { states: mid.map((m) => m.state), note: staleNote };
    check('Send under the replaced draft: the real server says stale-draft, nothing waits or goes, the dialog shows the current draft',
        newer.status === 200 && shownNewer && /newer draft/i.test(staleNote ?? '') && JSON.stringify(mid.map((m) => m.state)) === '["superseded","draft"]' && mid[0].id === read[0].id);
    await admin.click('[data-action=thanks-send]');
    await admin.waitForSelector('[data-testid=thanks-dialog]', { state: 'detached' });
    await admin.waitForSelector(`[data-idea="${pid}"]:not([aria-busy])`);
    await admin.keyboard.press('Escape'); // the card's panel, under the thank-you dialog
    await admin.waitForSelector(`${PANEL}:not([open])`, { state: 'attached' });
    const end = await doneThread();
    const said = (await admin.textContent('.note')) ?? '';
    results.thanksEnd = { states: end.map((m) => m.state), note: said };
    check('the next Send takes the current draft: it waits for Gmail here (said so), the replaced one never goes',
        JSON.stringify(end.map((m) => m.state)) === '["superseded","waiting_setup"]' && end[1].id === newer.json.draft?.id && /Gmail/.test(said));

    // the ideas file unreadable on the real server (503 ideas-store): the tab says so, the Scenes tab works,
    // the server never writes over the file; once it reads again the board is back (control)
    const ideasFile = join(DATA, 'ideas.json');
    const good = readFileSync(ideasFile);
    writeFileSync(ideasFile, '{not json');
    try {
        await admin.click('[data-tab=scenes]');
        await admin.waitForSelector('[data-testid=scene-list] li.row');
        await admin.click('[data-tab=ideas]');
        await admin.waitForSelector('[data-testid=idea-down]:not([hidden])', { timeout: 10000 });
        const down = (await admin.textContent('[data-testid=idea-down]')) ?? '';
        results.storeDown = down;
        check('ideas.json unreadable: the Ideas tab says so in plain words (503 ideas-store), no board', /cannot be read/.test(down) && !(await admin.isVisible('[data-testid=idea-board]')));
        await admin.click('[data-tab=scenes]');
        await admin.waitForSelector('[data-testid=scene-list] li.row');
        check('the Scenes tab works meanwhile', (await admin.$$('[data-testid=scene-list] li.row')).length > 0);
        check('the server did not write over the unreadable file', readFileSync(ideasFile, 'utf8') === '{not json');
    } finally {
        writeFileSync(ideasFile, good);
    }
    await admin.click('[data-tab=ideas]');
    await admin.waitForSelector(`[data-idea="${pid}"]`);
    check('once the file reads again the board is back (control)', !(await admin.isVisible('[data-testid=idea-down]')), true);

    // logout ends the session: the next admin call is 401
    await admin.click('[data-action=logout]');
    await admin.waitForSelector('[data-testid=password]');
    const after401 = await admin.evaluate(async () => (await fetch('/api/admin/session')).status);
    check('after logout the session is gone (401)', after401 === 401);

    const audit = readFileSync(join(DATA, 'admin-audit.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    results.audit = audit.map((a) => `${a.action}:${a.ok}`);
    const everything = apiLog + audit.map((a) => JSON.stringify(a)).join('') + readFileSync(join(DATA, 'catalog.json'), 'utf8');
    check('audit has the failed and the good login, the publish and the logout',
        ['login:false', 'login:true', 'publish:true', 'logout:true'].every((x) => (results.audit as string[]).includes(x)));
    // the kanban move from the admin is audited by lane B's admin.py as the route with "-" for "/" and the
    // changed fields in its detail (v0.6 audited the Reports tab's close as report-status)
    const moveAudited = (lines: { action?: string; ok?: boolean; detail?: string }[]): boolean =>
        lines.some((a) => a.action === 'ideas-update' && a.ok === true && (a.detail ?? '').startsWith(`${rep.id} `) && (a.detail ?? '').includes('status'));
    check('audit has the ideas move of the pilot\'s card (ideas-update, its id, status)', moveAudited(audit));
    check('without that line the audit check fails', !moveAudited(audit.filter((a) => a.action !== 'ideas-update')), true);
    check('the password is in no log, audit or data file', !everything.includes(secret.password));
    check('no page errors', errors.length === 0);
    results.pageErrors = errors;
    results.apiCalls = seen;
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
const file = writeEvidence('v06-admin', { pass, fly: FLY, error: failed ? String(failed) : null, checks, ...results });
console.log(`${pass ? 'PASS' : 'FAIL'} ${file}`);
process.exit(pass ? 0 : 1);
