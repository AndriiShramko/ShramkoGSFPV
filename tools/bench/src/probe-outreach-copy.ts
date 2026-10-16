// The admin's Outreach tab end to end in a browser against an EXACT local copy of production: a release's admin
// bundle served by scripts/serve-csp.mjs with nginx.conf's admin CSP, the API code of this branch (apps/api, the
// files that would be uploaded), a fresh data folder, and the snapshot pushed the way the vault pushes it
// (apps/api/outreach_cli.py push -, stdin). The live site is never touched: the login happens only here, with the
// TEST password of the gitignored .cache/admin-test.json; no e-mail and no Telegram can leave (every TG_*/GMAIL_* is
// empty). The page only GETs: the probe checks that the browser sent nothing but the login and GETs.
// The snapshot is SYNTHETIC (groups "Synthetic group NNN", made up by this file, timestamps relative to now) and has
// designed posts for each checkpoint case (due +24 h / +72 h / +30 d, missed ones, a removed post, a pending one).
// Every number the page shows is compared with an ORACLE computed here from the snapshot (the formula written out
// again, medians again), never with the server's own answer; the order of a sorted column is checked as monotone
// values, not against a copy of the sort.
// Run against the previous build (DIST = the live admin bundle, TAG=old-build) the first check fails: the control.
//   DIST=<dist with admin/ and fly/> [TAG=<name>] npx tsx src/probe-outreach-copy.ts      (from tools/bench)
//   (+ RELEASE, DIST_SHA256: written into the evidence as its source)
// Holds no GPU work but runs a browser. Evidence: evidence/<date>/outreach-copy[-TAG].json and
// evidence/<date>/outreach-copy[-TAG]/*.png (1440x900 and 390x844).
import { spawn, execFileSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserContext, Page } from 'playwright';
import { launchChrome } from './browser';
import { REPO, today, writeEvidence } from './evidence';

const DIST = process.env.DIST ?? join(REPO, '.cache', 'outreach-copy', 'dist-new');
const NAME = `outreach-copy${process.env.TAG ? `-${process.env.TAG}` : ''}`;
const DATA = join(REPO, '.cache', 'outreach-copy', `data${process.env.TAG ? `-${process.env.TAG}` : ''}`);
const SITE_PORT = 5500 + Math.floor(Math.random() * 90);
const API_PORT = 8900 + Math.floor(Math.random() * 90);
const SITE = `http://127.0.0.1:${SITE_PORT}`;
const API = `http://127.0.0.1:${API_PORT}`;
const SHOTS = join(REPO, 'evidence', today(), NAME);
const HOUR = 3600 * 1000;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const checks: { name: string; ok: boolean; control: boolean; got?: unknown }[] = [];
const results: Record<string, Any> = {};
const children: ChildProcess[] = [];
function check(name: string, ok: boolean, got?: unknown, control = false): void {
    checks.push({ name, ok, control, ...(got === undefined ? {} : { got }) });
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${control ? '[control] ' : ''}${name}${got === undefined ? '' : ` -> ${JSON.stringify(got).slice(0, 300)}`}`);
}

function testSecret(): { password: string; hash: string } {
    const f = join(REPO, '.cache', 'admin-test.json');
    if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'));
    mkdirSync(join(REPO, '.cache'), { recursive: true });
    const password = `test-${randomBytes(12).toString('base64url')}`;
    const line = execFileSync('python', [join(REPO, 'tools', 'admin', 'hash_password.py'), '--stdin'], { input: `${password}\n` }).toString().trim();
    const s = { password, hash: line.slice('ADMIN_PASSWORD_HASH='.length) };
    writeFileSync(f, JSON.stringify(s));
    return s;
}

// ---------------- the synthetic snapshot and its oracle ----------------

function rng(seed: number): () => number {
    let a = seed >>> 0;
    return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const iso = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const CP = [1, 24, 72, 168, 720];
/** Ages that sit within 0.3 h of a window edge would flip while the probe runs: never drawn. */
const EDGES = [0.5, 1, 18, 24, 54, 72, 126, 168, 540, 720];
const nearEdge = (h: number): boolean => EDGES.some((e) => Math.abs(h - e) < 0.3);
const LANGS = ['pl', 'pl', 'en', 'en', 'en', 'uk', 'de', 'ru'];
const TOPICS = ['fpv-freestyle', 'fpv-racing', 'fpv-beginner', 'cinewhoop', 'whoop', 'dji-fpv', 'sim', '3dgs', 'photogrammetry', 'polish-drone', 'local', 'builders', 'general-drone'];
const VERDICTS = ['post', 'post', 'post', 'post_image', 'text_only', 'comment_only', 'comment_only', 'ask_admin', 'skip', 'skip'];
const MEDIA = ['allowed', 'forbidden', 'unclear'];
const LINKS = ['allowed', 'forbidden', 'comments_only', 'unclear'];
const PROMO = ['allowed', 'showcase_only', 'weekly_thread', 'forbidden', 'ask_admin', 'unclear'];

interface Chk { age_h: number; state: string; reactions: number; comments: number; shares: number; views: number | null; admin_action: string }
interface Pst { id: string; group: string; group_name: string; kind: string; format: string; lang: string | null; sent_at: string; state: string; url: string | null; link_placement: string; first_comment: string; angle: string | null; checks: Chk[]; note: string | null }
interface Grp { id: string; name: string; url: string; lang: string | null; members: number | null; topic: string | null; fit: number | null; verdict: string | null; wave: number | null; policy: Record<string, string>; state: string; prior_sim_post: string; last_post_at: string | null; posts: number; published: number; removed: number; best_reactions: number; best_comments: number; score: number | null; note: string | null }

function makeSnapshot(now: number): { snap: Any; groups: Grp[]; posts: Pst[] } {
    const r = rng(20261016);
    const pick = <T,>(xs: T[]): T => xs[Math.floor(r() * xs.length)];
    const pad = (n: number): string => String(n).padStart(3, '0');
    const groups: Grp[] = [];
    for (let i = 0; i < 140; i++) {
        const verdict = pick(VERDICTS);
        groups.push({
            id: `syn-${pad(i)}`, name: `Synthetic group ${pad(i)}`, url: `https://www.facebook.com/groups/synthetic-${pad(i)}/`,
            lang: i % 23 === 0 ? null : pick(LANGS), members: i % 17 === 0 ? null : 300 + Math.floor(r() * 80000), topic: i % 19 === 0 ? null : pick(TOPICS),
            fit: i % 13 === 0 ? null : 1 + Math.floor(r() * 5), verdict: i % 29 === 0 ? null : verdict, wave: verdict === 'skip' ? null : 1 + Math.floor(r() * 3),
            policy: { video: pick(MEDIA), images: pick(MEDIA), links: pick(LINKS), self_promo: pick(PROMO), post_approval: pick(['yes', 'no', 'unknown']) },
            state: 'researched', prior_sim_post: i % 11 === 0 ? 'published' : 'none', last_post_at: null, posts: 0, published: 0, removed: 0, best_reactions: 0, best_comments: 0, score: null,
            note: i % 5 === 0 ? `Rule ${1 + (i % 7)}: showcase posts are welcome on Fridays` : null
        });
    }
    const posts: Pst[] = [];
    const mk = (n: number, group: Grp, over: Partial<Pst> & { ageH: number; has: number[]; state: string; fmt?: string; react?: number }): Pst => {
        const sent = now - over.ageH * HOUR;
        const checks: Chk[] = over.has.map((cp, k) => ({ age_h: cp, state: over.state === 'pending' ? 'pending' : over.state, reactions: Math.round((over.react ?? 6) * (1 + k * 0.7)), comments: Math.round(((over.react ?? 6) / 4) * (1 + k * 0.5)), shares: k > 0 && (over.react ?? 6) > 20 ? 2 : 0, views: cp >= 24 ? 400 * (k + 1) : null, admin_action: 'none' }));
        return { id: over.id ?? `P-SYN-${String(n).padStart(3, '0')}`, group: group.id, group_name: group.name, kind: over.kind ?? 'post', format: over.fmt ?? 'video', lang: over.lang ?? group.lang, sent_at: iso(sent), state: over.state,
            url: over.state === 'published' ? `https://www.facebook.com/groups/synthetic-${group.id.slice(4)}/posts/${1000 + n}/` : null, link_placement: over.link_placement ?? 'first_comment',
            first_comment: over.first_comment ?? (over.state === 'published' ? 'posted' : 'none'), angle: over.angle ?? `Synthetic angle ${n}: practise in a scan before the field`, checks, note: over.note ?? null };
    };
    // designed cases: one per checkpoint situation (expected strips are in DESIGNED below)
    posts.push(mk(1, groups[1], { id: 'P-DUE-24', ageH: 30, has: [1], state: 'published', react: 12 }));
    posts.push(mk(2, groups[2], { id: 'P-DUE-72', ageH: 100, has: [1, 24], state: 'published', react: 30 }));
    posts.push(mk(3, groups[3], { id: 'P-DUE-720', ageH: 800, has: [1, 24], state: 'published', react: 8, fmt: 'image' }));
    posts.push(mk(4, groups[4], { id: 'P-SENT-5H', ageH: 5, has: [], state: 'sent' }));
    posts.push(mk(5, groups[5], { id: 'P-REMOVED', ageH: 200, has: [1, 24, 72], state: 'removed', react: 4, note: 'Removed: rule 3 (no other simulators)' }));
    posts[4].checks[2].admin_action = 'removed';
    posts.push(mk(6, groups[6], { id: 'P-PENDING-80H', ageH: 80, has: [1], state: 'pending' }));
    posts.push(mk(7, groups[7], { id: 'P-TOP', ageH: 400, has: [1, 24, 72, 168], state: 'published', react: 90, fmt: 'video', angle: 'Synthetic angle 7: the strongest post' }));
    // random ones on groups 8..52, a few groups with two posts
    let n = 8;
    for (let gi = 8; gi < 53; gi++) {
        for (let k = 0; k < (gi % 6 === 0 ? 2 : 1); k++) {
            let age = 2 + r() * 900;
            while (nearEdge(age)) age = 2 + r() * 900;
            const roll = r();
            const state = roll < 0.66 ? 'published' : roll < 0.76 ? 'removed' : roll < 0.84 ? 'pending' : roll < 0.9 ? 'sent' : 'declined';
            const has = CP.filter((cp) => cp <= age && r() < 0.8);
            posts.push(mk(n++, groups[gi], { ageH: age, has: state === 'declined' ? [] : has, state, fmt: pick(['video', 'video', 'image', 'text']), react: Math.floor(r() * 7), kind: gi % 9 === 0 ? 'comment' : 'post' }));
        }
    }
    // the groups' counters, state and best numbers from their posts (the vault's rules)
    for (const g of groups) {
        const mine = posts.filter((p) => p.group === g.id);
        g.posts = mine.length;
        g.published = mine.filter((p) => p.state === 'published').length;
        g.removed = mine.filter((p) => p.state === 'removed').length;
        const all = mine.flatMap((p) => p.checks);
        g.best_reactions = Math.max(0, ...all.map((c) => c.reactions));
        g.best_comments = Math.max(0, ...all.map((c) => c.comments));
        g.last_post_at = mine.length ? mine.map((p) => p.sent_at).sort().at(-1)! : null;
        g.state = g.id === 'syn-009' ? 'banned' : g.removed ? 'removed' : mine.length ? [...mine].sort((a, b) => a.sent_at.localeCompare(b.sent_at)).at(-1)!.state : 'researched';
        g.score = oracleScore(g, mine);
    }
    const snap = {
        v: 1, campaign: 'gsfpv', generated: iso(now), groups, posts,
        visits: { days: 30, by_content: Object.fromEntries(groups.filter((g) => g.posts > 0).slice(0, 25).map((g, i) => [g.id, 3 + ((i * 7) % 29)])), note: 'synthetic arrivals with utm_content, aggregate counts only' },
        meta: { groups_total: 188, groups_researched: groups.length, waves: 1 }
    };
    return { snap, groups, posts };
}

const latest = (p: Pst): Chk | null => (p.checks.length ? p.checks.reduce((a, b) => (b.age_h >= a.age_h ? b : a)) : null);
const engOf = (p: Pst): number | null => { const c = latest(p); return c && c.age_h >= 24 ? c.reactions + 3 * c.comments + 5 * c.shares : null; };
function oracleScore(g: Grp, mine: Pst[]): number | null {
    if (g.posts === 0) return null;
    if (g.state === 'banned') return 0;
    const engs = mine.map(engOf).filter((x): x is number => x !== null);
    const eng = engs.length ? engs.reduce((a, b) => a + b, 0) / engs.length : 0;
    return Math.round((50 * (g.published / g.posts) + 30 * Math.min(1, eng / 50) + 20 * (1 - g.removed / g.posts)) * 10) / 10;
}
const median = (xs: number[]): number | null => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return Math.round((s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) * 10) / 10; };
const num = (s: string | null | undefined): number | null => { const t = (s ?? '').replace(/[,\s]/g, ''); return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null; };

/** What each designed post's strip must look like (checkpoints +1 h, +24 h, +72 h, +7 d, +30 d). */
const DESIGNED: Record<string, string[]> = {
    'P-DUE-24': ['taken', 'due', 'future', 'future', 'future'],
    'P-DUE-72': ['taken', 'taken', 'due', 'future', 'future'],
    'P-DUE-720': ['taken', 'taken', 'missed', 'missed', 'due'],
    'P-SENT-5H': ['due', 'future', 'future', 'future', 'future'],
    'P-REMOVED': ['taken', 'taken', 'taken', 'missed', 'future'],
    'P-PENDING-80H': ['taken', 'missed', 'due', 'future', 'future']
};

// ---------------- plumbing ----------------

async function until(url: string, ms = 20000): Promise<void> {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
        try { if ((await fetch(url)).status < 500) return; } catch { /* not up yet */ }
        await sleep(250);
    }
    throw new Error(`${url} did not come up`);
}

/** /api/** of the page goes to the local API with the page's cookie and CSRF; a CSV download goes over plain HTTP (proxied by serve-csp). */
async function routeApi(ctx: BrowserContext, seen: string[]): Promise<void> {
    ctx.on('request', (q) => { const u = new URL(q.url()); if (u.pathname.endsWith('/export.csv')) seen.push(`${q.method()} ${u.pathname}${u.search} (proxied)`); });
    await ctx.route((u) => u.origin === SITE && u.pathname.startsWith('/api/') && !u.pathname.endsWith('/export.csv'), async (route) => {
        const req = route.request();
        const u = new URL(req.url());
        const inH = await req.allHeaders();
        const headers: Record<string, string> = { 'X-Forwarded-For': '198.51.100.1' };
        for (const k of ['content-type', 'cookie', 'x-csrf', 'if-none-match']) if (inH[k]) headers[k] = inH[k];
        const raw = req.postDataBuffer();
        const r = await fetch(API + u.pathname + u.search, { method: req.method(), headers, body: req.method() === 'POST' && raw ? new Uint8Array(raw) : undefined });
        seen.push(`${req.method()} ${u.pathname}${u.search} ${r.status}`);
        const out: Record<string, string> = {};
        for (const k of ['content-type', 'cache-control', 'etag', 'retry-after', 'set-cookie', 'content-disposition']) { const v = r.headers.get(k); if (v) out[k] = v; }
        await route.fulfill({ status: r.status, headers: out, body: Buffer.from(await r.arrayBuffer()) });
    });
}

function watch(page: Page, tag: string, sink: { errors: string[]; hosts: Set<string> }): void {
    page.on('console', (m) => { if (m.type() === 'error') sink.errors.push(`${tag} console: ${m.text()} @ ${m.location().url}`.slice(0, 300)); });
    page.on('pageerror', (e) => sink.errors.push(`${tag} pageerror: ${e.message}`.slice(0, 300)));
    page.on('requestfailed', (r) => sink.errors.push(`${tag} requestfailed: ${r.url().split('?')[0]} ${r.failure()?.errorText ?? ''}`.slice(0, 300)));
    page.on('request', (r) => { try { sink.hosts.add(new URL(r.url()).host); } catch { /* data: */ } });
}

async function shot(page: Page, name: string, fullPage = false): Promise<string> {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage, scale: 'css' });
    return `evidence/${today()}/${NAME}/${name}.png`;
}

async function login(page: Page, password: string): Promise<void> {
    await page.goto(`${SITE}/admin/`);
    await page.waitForSelector('[data-testid=password]');
    await page.fill('[data-testid=password]', password);
    await page.press('[data-testid=password]', 'Enter');
    await page.waitForSelector('[data-testid=scene-list] li.row', { timeout: 20000 });
}

const texts = (page: Page, sel: string): Promise<string[]> => page.$$eval(sel, (els) => els.map((e) => (e.textContent ?? '').trim()));
const rowIds = (page: Page, table: string): Promise<string[]> => page.$$eval(`[data-testid=${table}] tbody tr[data-row]`, (els) => els.map((e) => e.getAttribute('data-row') ?? ''));
const col = (page: Page, table: string, key: string): Promise<string[]> => page.$$eval(`[data-testid=${table}] tbody tr td[data-col=${key}]`, (els) => els.map((e) => (e.textContent ?? '').trim()));
const stat = (page: Page, key: string): Promise<number | null> => page.$eval(`[data-testid=o-stats] [data-stat=${key}] .stat-n`, (e) => (e.textContent ?? '').replace(/[,\s]/g, '')).then((s) => num(s)).catch(() => null);

/** Values of a column in the order shown are monotone, with the unset ones (a dash) last. */
function monotone(values: (number | null)[], dir: 'asc' | 'desc'): boolean {
    const firstNull = values.findIndex((v) => v === null);
    const set = firstNull < 0 ? values : values.slice(0, firstNull);
    if (firstNull >= 0 && values.slice(firstNull).some((v) => v !== null)) return false;
    return set.every((v, i) => i === 0 || (dir === 'asc' ? (v as number) >= (set[i - 1] as number) : (v as number) <= (set[i - 1] as number)));
}

async function pushSnapshot(snap: Any, env: NodeJS.ProcessEnv): Promise<{ code: number | null; out: string }> {
    return new Promise((resolve) => {
        const p = spawn('python', [join(REPO, 'apps', 'api', 'outreach_cli.py'), 'push', '-'], { env: { ...env, DATA_DIR: DATA, PYTHONIOENCODING: 'utf-8' }, stdio: ['pipe', 'pipe', 'pipe'] });
        let out = '';
        p.stdout.on('data', (b) => { out += String(b); });
        p.stderr.on('data', (b) => { out += String(b); });
        p.on('close', (code) => resolve({ code, out: out.trim() }));
        p.stdin.end(JSON.stringify(snap));
    });
}

async function main(): Promise<void> {
    const secret = testSecret();
    rmSync(DATA, { recursive: true, force: true });
    mkdirSync(DATA, { recursive: true });
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
    check('the admin page is served under nginx.conf\'s admin CSP (script-src \'self\', style-src \'self\')', /script-src 'self';/.test(results.adminCsp ?? '') && /style-src 'self';/.test(results.adminCsp ?? '') && adminHead.headers.get('x-csp-mode') === 'admin');
    results.distAdminSha256 = createHash('sha256').update(readFileSync(join(DIST, 'admin', 'index.html'))).digest('hex');

    const { browser, which } = await launchChrome({ headless: true });
    results.browser = which;
    const sink = { errors: [] as string[], hosts: new Set<string>() };
    const seen: string[] = [];

    // ---------------- desktop 1440x900 ----------------
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US', acceptDownloads: true });
    await routeApi(ctx, seen);
    const page = await ctx.newPage();
    watch(page, 'desktop', sink);
    await login(page, secret.password);
    check('login on localhost with the test password', seen.includes('POST /api/admin/login 200'));

    await sleep(1500); // the Scenes tab's posters (the scene CDN) have been asked for by now
    const hostsBeforeOutreach = new Set(sink.hosts);
    const tabPresent = !!(await page.$('[data-tab=outreach]'));
    check('the admin has an Outreach tab next to Scenes and Ideas', tabPresent, await texts(page, 'nav.tabs button'));
    if (!tabPresent) { results.note = 'the Outreach tab is missing in this build (the control for the previous build)'; return; }

    // ---- the empty state: nothing pushed yet ----
    await page.click('[data-tab=outreach]');
    await page.waitForSelector('[data-testid=o-empty]');
    const empty = await page.$eval('[data-testid=o-empty]', (e) => ({ text: e.textContent ?? '', role: e.getAttribute('role') }));
    check('empty state: "No snapshot yet" with the push command, no table drawn', /No snapshot yet/.test(empty.text) && /fbgroups\.py push/.test(empty.text) && empty.role === 'status' && !(await page.$('[data-testid=og-table]')), empty.text.slice(0, 120));
    check('empty state: CSV buttons are not offered without data', !(await page.$('[data-action=csv-groups]')));
    results.shots = { emptyDesktop: await shot(page, 'outreach-empty-desktop') };

    // ---- push the snapshot the way the vault does (docker exec ... outreach_cli.py push -) ----
    const now = Date.now();
    const { snap, groups, posts } = makeSnapshot(now);
    const push = await pushSnapshot(snap, process.env);
    results.push = push.out;
    check('the CLI accepts the synthetic snapshot (push -, stdin)', push.code === 0 && /accepted: 140 groups, \d+ posts/.test(push.out), push.out);
    const file = join(DATA, 'outreach.json');
    check('exactly one new data file: outreach.json, within 256 KB', existsSync(file) && statSync(file).size <= 256 * 1024 && readdirSync(DATA).filter((f) => f.startsWith('outreach')).join() === 'outreach.json', statSync(file).size);

    await page.click('[data-action=refresh]');
    await page.waitForSelector('[data-testid=o-stats]');
    check('Refresh shows the snapshot (the empty state is gone)', !(await page.$('[data-testid=o-empty]')));

    // ---- summary cards, funnel: against the oracle ----
    const live = posts.filter((p) => p.state !== 'failed');
    const want = {
        groups: groups.length, posted: groups.filter((g) => g.posts > 0).length, published: groups.filter((g) => g.published > 0).length, removed: groups.filter((g) => g.removed > 0).length,
        reactions: live.reduce((s, p) => s + (latest(p)?.reactions ?? 0), 0)
    };
    const got = { groups: await stat(page, 'groups'), posted: await stat(page, 'posted'), published: await stat(page, 'published'), removed: await stat(page, 'removed'), reactions: await stat(page, 'reactions') };
    results.stats = { got, want };
    check('summary cards: studied / posted to / post is up / removed / reactions equal the oracle', JSON.stringify(got) === JSON.stringify(want), { got, want });
    const funnel = await page.$$eval('[data-testid=o-funnel] [data-stage]', (els) => els.map((e) => [e.getAttribute('data-stage'), (e.querySelector('.funnel-n')?.firstChild?.textContent ?? '').replace(/[,\s]/g, '')]));
    check('funnel: groups -> posted -> published -> removed with the same counts', JSON.stringify(funnel) === JSON.stringify([['groups', String(want.groups)], ['posted', String(want.posted)], ['published', String(want.published)], ['removed', String(want.removed)]]), funnel);
    const subs = await texts(page, '[data-testid=o-stats] .stat-s');
    check('the first card says "of 188 known" (meta.groups_total)', /188/.test(subs[0] ?? ''), subs[0]);
    const stamp = await page.$eval('[data-testid=o-stamp]', (e) => e.textContent ?? '');
    check('the snapshot stamp names the campaign and when it was built and received', /Campaign gsfpv/.test(stamp) && /Snapshot built/.test(stamp) && /received/.test(stamp) && !(await page.$('[data-testid=o-stale]')), stamp);

    // ---- groups table ----
    const gIds = await rowIds(page, 'og-table');
    check('groups table: one row per group (140)', gIds.length === groups.length && new Set(gIds).size === gIds.length, gIds.length);
    const scoreCells = (await col(page, 'og-table', 'score')).map(num);
    check('groups table: the default order is score, best first, groups without a post last', monotone(scoreCells, 'desc'), scoreCells.slice(0, 12));
    const topScore = Math.max(...groups.map((g) => g.score ?? -1));
    check('the top row shows the highest score of the oracle', scoreCells[0] === topScore, { shown: scoreCells[0], oracle: topScore });
    const wantScores = new Map(groups.map((g) => [g.id, g.score]));
    const shownScores = await page.$$eval('[data-testid=og-table] tbody tr[data-row]', (els) => els.map((e) => [e.getAttribute('data-row') ?? '', (e.querySelector('td[data-col=score]')?.textContent ?? '').trim()]));
    check('every group\'s score on the page equals the oracle\'s formula (50 pub + 30 eng + 20 kept)', shownScores.every(([id, s]) => num(s) === (wantScores.get(id) ?? null)), shownScores.filter(([id, s]) => num(s) !== (wantScores.get(id) ?? null)).slice(0, 5));
    const worthIds = await page.$$eval('[data-testid=og-table] tr.is-worth', (els) => els.map((e) => e.getAttribute('data-row') ?? '').sort());
    const worthWant = groups.filter((g) => g.score !== null && g.score >= 75 && g.removed === 0 && g.state !== 'banned').map((g) => g.id).sort();
    check('"worth more work" highlights exactly the groups with score >= 75, nothing removed, not banned', JSON.stringify(worthIds) === JSON.stringify(worthWant) && worthWant.length > 0, { page: worthIds.length, oracle: worthWant.length });
    const badIds = await page.$$eval('[data-testid=og-table] tr.is-bad', (els) => els.map((e) => e.getAttribute('data-row') ?? '').sort());
    check('groups with a removal or a ban are marked', JSON.stringify(badIds) === JSON.stringify(groups.filter((g) => g.removed > 0 || g.state === 'banned').map((g) => g.id).sort()), badIds.length);
    // ranking
    const rank = await page.$$eval('[data-testid=o-rank] ol.rank li[data-group]', (els) => els.map((e) => [e.getAttribute('data-group') ?? '', (e.querySelector('.rank-score')?.firstChild?.textContent ?? '').trim(), e.classList.contains('is-worth')]));
    const rankScores = rank.map((x) => num(String(x[1])));
    check('ranking: 8 groups, best score first, the same scores as the oracle\'s top 8', rank.length === 8 && monotone(rankScores, 'desc') && JSON.stringify(rankScores) === JSON.stringify(groups.map((g) => g.score).filter((s): s is number => s !== null).sort((a, b) => b - a).slice(0, 8)), rankScores);
    // sort by a header: members, twice
    await page.click('[data-testid=og-table] th[data-col=members] button.sort');
    const m1 = (await col(page, 'og-table', 'members')).map(num);
    check('sort by Members: largest first, groups with unknown membership last', monotone(m1, 'desc') && m1.some((v) => v === null), m1.slice(0, 6));
    check('the pressed header says so (aria-sort descending), the others none', (await page.$eval('[data-testid=og-table] th[data-col=members]', (e) => e.getAttribute('aria-sort'))) === 'descending' && (await page.$eval('[data-testid=og-table] th[data-col=score]', (e) => e.getAttribute('aria-sort'))) === 'none');
    await page.click('[data-testid=og-table] th[data-col=members] button.sort');
    const m2 = (await col(page, 'og-table', 'members')).map(num);
    check('pressing it again flips: smallest first, unknown still last', monotone(m2, 'asc') && m2.at(-1) === null, m2.slice(0, 6));
    await page.click('[data-testid=og-table] th[data-col=name] button.sort');
    const names = await col(page, 'og-table', 'name');
    check('sort by Group: A to Z', JSON.stringify(names) === JSON.stringify([...names].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))), names.slice(0, 3));
    await page.click('[data-testid=og-table] th[data-col=score] button.sort');
    // filters
    const shown = (): Promise<string> => page.$eval('[data-testid=og-shown]', (e) => e.textContent ?? '');
    await page.selectOption('[data-testid=og-section] [data-filter=verdict]', 'comment_only');
    const wantCo = groups.filter((g) => g.verdict === 'comment_only').length;
    check('filter Verdict = comments only keeps exactly those groups', (await rowIds(page, 'og-table')).length === wantCo && (await shown()) === `${wantCo} of 140 shown`, await shown());
    await page.selectOption('[data-testid=og-section] [data-filter=lang]', 'pl');
    const wantPl = groups.filter((g) => g.verdict === 'comment_only' && g.lang === 'pl').length;
    check('and Language = pl narrows it further (two filters together)', (await rowIds(page, 'og-table')).length === wantPl, { page: (await rowIds(page, 'og-table')).length, oracle: wantPl });
    await page.selectOption('[data-testid=og-section] [data-filter=verdict]', 'any');
    await page.selectOption('[data-testid=og-section] [data-filter=lang]', 'none');
    const wantNoLang = groups.filter((g) => g.lang === null).length;
    check('"not set" finds the groups with no language', (await rowIds(page, 'og-table')).length === wantNoLang && wantNoLang > 0, wantNoLang);
    await page.selectOption('[data-testid=og-section] [data-filter=lang]', 'any');
    await page.fill('[data-testid=og-search]', 'synthetic group 042');
    check('search finds a group by its words', JSON.stringify(await rowIds(page, 'og-table')) === JSON.stringify(['syn-042']));
    await page.fill('[data-testid=og-search]', 'showcase posts are welcome');
    check('search looks in the notes too', (await rowIds(page, 'og-table')).length === groups.filter((g) => g.note).length);
    await page.fill('[data-testid=og-search]', 'zzzz-no-such-group');
    check('a search that matches nothing shows 0 rows, not an error', (await rowIds(page, 'og-table')).length === 0 && (await shown()) === '0 of 140 shown', await shown());
    await page.fill('[data-testid=og-search]', '');
    await page.check('[data-testid=og-section] [data-filter=worth]');
    check('"Worth more work only" keeps exactly the highlighted groups', JSON.stringify((await rowIds(page, 'og-table')).sort()) === JSON.stringify(worthWant));
    await page.uncheck('[data-testid=og-section] [data-filter=worth]');
    check('clearing the filters brings all 140 back', (await rowIds(page, 'og-table')).length === 140);

    // ---- posts table and the checkpoint strips ----
    const pIds = await rowIds(page, 'op-table');
    check('posts table: one row per post', pIds.length === live.length, { page: pIds.length, oracle: live.length });
    const strips: Record<string, string[]> = {};
    for (const id of Object.keys(DESIGNED)) {
        strips[id] = await page.$$eval(`[data-testid=op-table] tr[data-row="${id}"] .cp`, (els) => els.map((e) => [...e.classList].find((c) => c.startsWith('cp-'))?.slice(3) ?? ''));
    }
    results.strips = strips;
    for (const [id, want2] of Object.entries(DESIGNED)) check(`checkpoint strip of ${id}: ${want2.join(' / ')}`, JSON.stringify(strips[id]) === JSON.stringify(want2), strips[id]);
    const takenCell = await page.$eval('[data-testid=op-table] tr[data-row="P-TOP"] .cp[data-cp="168"]', (e) => ({ text: (e.textContent ?? '').replace(/\s+/g, ' ').trim(), title: e.getAttribute('title') ?? '' }));
    const topP = posts.find((p) => p.id === 'P-TOP')!.checks[3];
    check('a taken checkpoint shows reactions/comments/shares of that measurement (and the details on hover)', takenCell.text.includes(`${topP.reactions}/${topP.comments}/${topP.shares}`) && takenCell.title.includes(`${topP.reactions} reactions`), takenCell);
    const removedBang = await page.$eval('[data-testid=op-table] tr[data-row="P-REMOVED"] .cp[data-cp="72"] b', (e) => e.getAttribute('title')).catch(() => null);
    check('an admin action on a measurement is flagged (!) with its words', /removed by an admin/.test(removedBang ?? ''), removedBang);
    check('the removed post\'s row is marked', await page.$eval('[data-testid=op-table] tr[data-row="P-REMOVED"]', (e) => e.classList.contains('is-bad')));
    const next = {
        checks: await page.$$eval('[data-testid=o-next] [data-list=checks] li[data-post]', (els) => els.map((e) => e.getAttribute('data-post') ?? '')),
        unresolved: await page.$$eval('[data-testid=o-next] [data-list=unresolved] li[data-post]', (els) => els.map((e) => e.getAttribute('data-post') ?? ''))
    };
    results.next = next;
    for (const id of ['P-DUE-24', 'P-DUE-72', 'P-DUE-720', 'P-SENT-5H', 'P-PENDING-80H']) check(`What next lists ${id} as a measurement due`, next.checks.includes(id) || (await page.$(`[data-testid=o-next] li[data-post="${id}"]`)) !== null, next.checks.length);
    const dueHeadline = await page.$eval('[data-testid=o-next] [data-list=checks]', (e) => e.parentElement?.querySelector('h3 .badge')?.textContent ?? '');
    const dueByStrip = await page.$$eval('[data-testid=op-table] .cp-due', (els) => new Set(els.map((e) => e.closest('tr')?.getAttribute('data-row'))).size);
    check('the number of posts with a "due" cell equals the number in What next', Number(dueHeadline) === dueByStrip, { next: dueHeadline, strips: dueByStrip });
    check('unresolved: the sent post (5 h) and the pending one (80 h) are listed', next.unresolved.includes('P-SENT-5H') && next.unresolved.includes('P-PENDING-80H') && !next.unresolved.includes('P-DUE-24'), next.unresolved);
    const readyIds = await page.$$eval('[data-testid=o-next] [data-list=ready] li[data-group]', (els) => els.map((e) => e.getAttribute('data-group') ?? ''));
    const readyWant = groups.filter((g) => g.wave === 1 && g.posts === 0 && g.verdict !== null && ['post', 'post_image', 'text_only'].includes(g.verdict) && !['banned', 'removed'].includes(g.state)).length;
    const readyBadge = await page.$eval('[data-testid=o-next] [data-list=ready]', (e) => e.parentElement?.querySelector('h3 .badge')?.textContent ?? '');
    check('wave 1 without a post: the count equals the oracle\'s', Number(readyBadge) === readyWant && readyIds.length === Math.min(8, readyWant), { badge: readyBadge, oracle: readyWant });
    // posts filter / sort / search
    await page.selectOption('[data-testid=op-section] [data-filter=state]', 'removed');
    const wantRem = live.filter((p) => p.state === 'removed').length;
    check('posts: filter State = removed keeps exactly the removed posts', (await rowIds(page, 'op-table')).length === wantRem && wantRem > 0, wantRem);
    await page.selectOption('[data-testid=op-section] [data-filter=state]', 'any');
    await page.fill('[data-testid=op-search]', 'strongest post');
    check('posts: the search finds a post by its angle', JSON.stringify(await rowIds(page, 'op-table')) === JSON.stringify(['P-TOP']));
    await page.fill('[data-testid=op-search]', '');
    await page.click('[data-testid=op-table] th[data-col=eng] button.sort');
    const eng = (await col(page, 'op-table', 'eng')).map(num);
    check('posts: sort by Engagement, best first, unmeasured last', monotone(eng, 'desc'), eng.slice(0, 6));
    check('the best engagement on the page is the oracle\'s', eng[0] === Math.max(...live.map((p) => engOf(p) ?? -1)), { page: eng[0] });

    // ---- slices ----
    const sliceRows = async (): Promise<Record<string, string[]>> => Object.fromEntries(await page.$$eval('[data-testid=o-slice-table] tbody tr', (els) => els.map((e) => [e.getAttribute('data-slice-row') ?? '', [...e.querySelectorAll('td')].map((c) => (c.textContent ?? '').trim())])));
    const byFmt = await sliceRows();
    const oracleSlice = (key: (p: Pst) => string) => {
        const m = new Map<string, Pst[]>();
        for (const p of live) m.set(key(p), [...(m.get(key(p)) ?? []), p]);
        return m;
    };
    const fmtWant = oracleSlice((p) => p.format);
    let sliceOk = fmtWant.size === Object.keys(byFmt).length;
    const sliceBad: string[] = [];
    for (const [k, ps] of fmtWant) {
        const meas = ps.filter((p) => engOf(p) !== null);
        const row = byFmt[k];
        const okRow = !!row && num(row[1]) === ps.length && num(row[2]) === meas.length && num(row[row.length - 1]) === median(meas.map((p) => engOf(p) as number)) && num(row[row.length - 3]) === median(meas.map((p) => latest(p)!.reactions));
        if (!okRow) { sliceOk = false; sliceBad.push(k); }
    }
    check('slices by format: posts, measured and the medians of reactions and engagement equal the oracle', sliceOk, { bad: sliceBad, page: byFmt });
    await page.click('[data-testid=o-slices] button[data-slice=topic]');
    const topicKeys = Object.keys(await sliceRows()).sort();
    const topicOf = new Map(groups.map((g) => [g.id, g.topic ?? 'unknown']));
    check('slices by topic: the topics are those of the posts\' groups', JSON.stringify(topicKeys) === JSON.stringify([...new Set(live.map((p) => topicOf.get(p.group)!))].sort()), topicKeys.length);
    await page.click('[data-testid=o-slices] button[data-slice=format_lang_topic]');
    const triple = await sliceRows();
    const tripleWant = new Set(live.map((p) => `${p.format}|${p.lang ?? 'unknown'}|${topicOf.get(p.group)}`));
    check('slices by format x language x topic: one row per combination, the first column holds the format', Object.keys(triple).length === tripleWant.size && Object.keys(triple).every((k) => tripleWant.has(k)), { page: Object.keys(triple).length, oracle: tripleWant.size });
    const medCol = (await page.$$eval('[data-testid=o-slice-table] tbody tr', (els) => els.map((e) => (e.lastElementChild?.textContent ?? '').trim()))).map(num);
    check('the best medians come first', monotone(medCol, 'desc'), medCol.slice(0, 6));
    await page.click('[data-testid=o-slices] button[data-slice=format]');

    // ---- visits ----
    const visitSum = Object.values(snap.visits.by_content as Record<string, number>).reduce((a: number, b: number) => a + b, 0);
    const visitText = await page.$eval('[data-testid=o-visits]', (e) => e.textContent ?? '');
    check('arrivals from Facebook: the total of the snapshot, by group', visitText.includes(String(visitSum)) && (await page.$$('[data-testid=o-visits] li[data-key]')).length === 10, { visitSum });

    // ---- shots (desktop) ----
    await page.evaluate(() => window.scrollTo(0, 0));
    results.shots.topDesktop = await shot(page, 'outreach-top-desktop');
    await page.locator('[data-testid=og-section]').scrollIntoViewIfNeeded();
    await page.evaluate(() => document.querySelector('[data-testid=og-section]')?.scrollIntoView());
    results.shots.groupsDesktop = await shot(page, 'outreach-groups-desktop');
    await page.evaluate(() => document.querySelector('[data-testid=op-section]')?.scrollIntoView());
    results.shots.postsDesktop = await shot(page, 'outreach-posts-desktop');
    await page.evaluate(() => document.querySelector('[data-testid=o-slices]')?.scrollIntoView());
    results.shots.slicesDesktop = await shot(page, 'outreach-slices-desktop');

    // ---- CSV downloads ----
    await page.evaluate(() => window.scrollTo(0, 0));
    for (const table of ['groups', 'posts'] as const) {
        const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.click(`[data-action=csv-${table}]`)]);
        mkdirSync(SHOTS, { recursive: true });
        const f = join(SHOTS, `outreach-${table}.csv`);
        await dl.saveAs(f);
        const bytes = readFileSync(f);
        const text = bytes.toString('utf8').replace(/^﻿/, '');
        const lines = text.trim().split('\r\n');
        results[`csv_${table}`] = { filename: dl.suggestedFilename(), bytes: bytes.length, lines: lines.length, header: lines[0].split(',').slice(0, 5) };
        check(`CSV ${table}: downloaded as an attachment named outreach-gsfpv-${table}-<date>.csv, UTF-8 with BOM`, new RegExp(`^outreach-gsfpv-${table}-\\d{4}-\\d{2}-\\d{2}\\.csv$`).test(dl.suggestedFilename()) && bytes[0] === 0xef && bytes[1] === 0xbb, dl.suggestedFilename());
        check(`CSV ${table}: a header and one line per ${table === 'groups' ? 'group' : 'post'} (${table === 'groups' ? groups.length : live.length})`, lines.length === (table === 'groups' ? groups.length : live.length) + 1, lines.length);
        rmSync(f, { force: true });
    }
    check('the downloads did not take the page away from the admin', page.url().startsWith(`${SITE}/admin/`) && !!(await page.$('[data-testid=outreach]')));

    // ---- tabs keep working; stale; unreadable; refresh again ----
    await page.click('[data-tab=ideas]');
    await page.waitForSelector('[data-testid=idea-board]');
    await page.click('[data-tab=scenes]');
    await page.waitForSelector('[data-testid=scene-list] li.row');
    await page.click('[data-tab=outreach]');
    await page.waitForSelector('[data-testid=o-stats]');
    check('switching Scenes -> Ideas -> Outreach redraws the tab with the same data', (await rowIds(page, 'og-table')).length === 140);

    // a snapshot received 3 days ago is marked old (the file's time is moved in the COPY)
    const doc = JSON.parse(readFileSync(file, 'utf8'));
    doc.received = iso(Date.now() - 72 * HOUR);
    writeFileSync(file, JSON.stringify(doc));
    await page.click('[data-action=refresh]');
    await page.waitForSelector('[data-testid=o-stale]', { timeout: 10000 }).catch(() => undefined);
    const stale = await page.$eval('[data-testid=o-stale]', (e) => e.textContent ?? '').catch(() => null);
    check('a snapshot older than 2 days is marked as old, with what to ask for', /more than 2 days old/.test(stale ?? ''), stale);
    // a damaged file: the page says so and offers the command; the next push restores
    writeFileSync(file, '{"received": "x", "v": 1');
    await page.click('[data-action=refresh]');
    await page.waitForSelector('[data-testid=o-empty]');
    const dmg = await page.$eval('[data-testid=o-empty]', (e) => ({ text: e.textContent ?? '', role: e.getAttribute('role') }));
    check('a damaged file: "cannot be read", an alert, the push command, nothing lost', /cannot be read/.test(dmg.text) && dmg.role === 'alert' && /fbgroups\.py push/.test(dmg.text), dmg.text.slice(0, 100));
    const again = await pushSnapshot(snap, process.env);
    await page.click('[data-action=refresh]');
    await page.waitForSelector('[data-testid=o-stats]');
    check('the next push restores the tab (140 groups again), still one file', again.code === 0 && (await rowIds(page, 'og-table')).length === 140 && readdirSync(DATA).filter((f) => f.startsWith('outreach')).join() === 'outreach.json');
    // a refused push leaves the shown snapshot as it was
    const bad = await pushSnapshot({ ...snap, v: 2 }, process.env);
    const before = readFileSync(file, 'utf8');
    check('a refused push (v:2) is refused with its reason and the stored file is unchanged', bad.code === 1 && /v must be 1/.test(bad.out) && before.includes('"v":1'), bad.out.slice(0, 120));
    const big = await pushSnapshot({ ...snap, groups: [...groups, ...groups.map((g) => ({ ...g, id: `${g.id}-b` }))] }, process.env);
    check('a push over the ceilings (280 groups) is refused', big.code === 1 && /(250|ceiling)/.test(big.out), big.out.slice(0, 120));
    check('and the file is still the same bytes', readFileSync(file, 'utf8') === before);

    // ---- the theme: the admin is dark only; a light-scheme browser must give the same, readable page ----
    const lightCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US', colorScheme: 'light' });
    await routeApi(lightCtx, seen);
    const lp = await lightCtx.newPage();
    watch(lp, 'light', sink);
    await login(lp, secret.password);
    await lp.click('[data-tab=outreach]');
    await lp.waitForSelector('[data-testid=o-stats]');
    const raw = await lp.evaluate(() => ({
        body: getComputedStyle(document.body).backgroundColor,
        cellText: getComputedStyle(document.querySelector('[data-testid=og-table] tbody td:not(.first)')!).color,
        headBg: getComputedStyle(document.querySelector('[data-testid=og-table] th')!).backgroundColor,
        scheme: getComputedStyle(document.documentElement).getPropertyValue('color-scheme')
    }));
    const lum = (c: string): number => { const m = c.match(/\d+(\.\d+)?/g)?.map(Number) ?? [0, 0, 0]; return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255; };
    const colours = { ...raw, bodyLum: lum(raw.body), cellTextLum: lum(raw.cellText) };
    results.light = colours;
    check('light-scheme browser: the page stays on the admin\'s dark palette (as Scenes and Ideas) and the table text is light on dark', colours.bodyLum < 0.1 && colours.cellTextLum > 0.6, colours);
    results.shots.lightDesktop = await shot(lp, 'outreach-top-light-desktop');
    await lightCtx.close();

    // ---- phone 390x844 ----
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'en-US' });
    await routeApi(phone, seen);
    const pp = await phone.newPage();
    watch(pp, 'phone', sink);
    await login(pp, secret.password);
    await pp.click('[data-tab=outreach]');
    await pp.waitForSelector('[data-testid=o-stats]');
    const geom = async (): Promise<Record<string, Any>> => pp.evaluate(() => ({
        scrollW: document.documentElement.scrollWidth, innerW: innerWidth, pageH: document.documentElement.scrollHeight, innerH: innerHeight,
        boxes: Object.fromEntries([...document.querySelectorAll('.table-wrap')].map((e, i) => [`box${i}`, { h: Math.round(e.getBoundingClientRect().height), scrollsX: e.scrollWidth > e.clientWidth, w: Math.round(e.getBoundingClientRect().width) }])),
        statCols: new Set([...document.querySelectorAll('[data-testid=o-stats] .stat')].map((e) => Math.round(e.getBoundingClientRect().left))).size,
        tabs: [...document.querySelectorAll('nav.tabs button')].map((e) => Math.round(e.getBoundingClientRect().right)),
        tap: Math.min(...[...document.querySelectorAll('[data-action=refresh], [data-action=csv-groups], nav.tabs button')].map((e) => Math.round(e.getBoundingClientRect().height)))
    }));
    const g0 = await geom();
    results.phone = g0;
    check('phone 390: the page does not scroll sideways (document width = viewport)', g0.scrollW <= g0.innerW, { scrollW: g0.scrollW, innerW: g0.innerW });
    check('phone 390: the summary is two columns', g0.statCols === 2, g0.statCols);
    check('phone 390: each table is in its own scroll box, no taller than a viewport, scrolling sideways inside', Object.values<Any>(g0.boxes).filter((b) => b.scrollsX).length >= 2 && Object.values<Any>(g0.boxes).every((b) => b.h <= g0.innerH), g0.boxes);
    check('phone 390: the tabs fit on one line and every button is at least 34 px tall', Math.max(...g0.tabs) <= 390 && g0.tap >= 34, { right: Math.max(...g0.tabs), tap: g0.tap });
    check('phone 390: the page is not absurdly long (under 9 viewports)', g0.pageH < 9 * g0.innerH, g0.pageH / g0.innerH);
    results.shots.topPhone = await shot(pp, 'outreach-top-phone');
    await pp.evaluate(() => document.querySelector('[data-testid=o-rank]')?.scrollIntoView());
    results.shots.rankPhone = await shot(pp, 'outreach-rank-phone');
    await pp.evaluate(() => document.querySelector('[data-testid=og-section]')?.scrollIntoView());
    results.shots.groupsPhone = await shot(pp, 'outreach-groups-phone');
    await pp.tap('[data-testid=og-table] th[data-col=members] button.sort');
    const mm = (await col(pp, 'og-table', 'members')).map(num);
    check('phone: a tap on a header sorts the table', monotone(mm, 'desc') && mm[0] !== null);
    await pp.evaluate(() => document.querySelector('[data-testid=op-section]')?.scrollIntoView());
    results.shots.postsPhone = await shot(pp, 'outreach-posts-phone');
    await phone.close();

    // ---- the console, the requests, the data ----
    const errs = sink.errors;
    results.consoleErrors = errs;
    const probe401 = (e: string): boolean => /status of 401/.test(e);
    check('no script error, CSP violation or failed request in the console (the signed-out session probe\'s 401 aside)', errs.filter((e) => !probe401(e)).length === 0, errs.filter((e) => !probe401(e)));
    check('the console\'s only error lines are the session probe\'s 401 (one per login page: 3 contexts)', errs.filter(probe401).length === 3, errs.length);
    const mutating = seen.filter((s) => s.startsWith('POST') && !/\/api\/admin\/login 200$/.test(s));
    results.requests = [...new Set(seen.map((s) => s.replace(/\?.*$/, '').replace(/ \d+$/, '')))];
    check('the browser sent only GETs and the logins (no write of any kind from the Outreach tab)', mutating.length === 0 && seen.some((s) => s.startsWith('GET /api/admin/outreach ')), mutating);
    check('every outreach request answered 200', seen.filter((s) => /\/api\/admin\/outreach/.test(s) && !/proxied/.test(s)).every((s) => / 200$/.test(s)), seen.filter((s) => /outreach/.test(s) && !/ 200$/.test(s)));
    results.hosts = { all: [...sink.hosts], beforeOutreach: [...hostsBeforeOutreach] };
    check('the Outreach tab reached no host but the local site and API (the posters of the Scenes tab come from the scene CDN, asked for before)', [...sink.hosts].filter((h) => !hostsBeforeOutreach.has(h)).every((h) => h.startsWith('127.0.0.1:')), results.hosts);
    check('the API printed no traceback', !/Traceback/.test(apiLog), apiLog.slice(0, 200));
    check('the test password is in no log or data file', !apiLog.includes(secret.password) && !readFileSync(join(DATA, 'admin-audit.jsonl'), 'utf8').includes(secret.password));
    const outreachFiles = readdirSync(DATA).filter((f) => f.startsWith('outreach'));
    check('the data folder holds one outreach file (no history, no temp file) after 4 pushes', outreachFiles.join() === 'outreach.json', outreachFiles);
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
}
const pass = !failed && checks.length > 0 && checks.every((c) => c.ok);
const source = { release: process.env.RELEASE ?? null, distSha256: process.env.DIST_SHA256 ?? null, tag: process.env.TAG ?? null };
const summary = { pass, source, error: failed ? String(failed).slice(0, 400) : null,
    passed: checks.filter((c) => c.ok).length, failed: checks.filter((c) => !c.ok).length, failedChecks: checks.filter((c) => !c.ok).map((c) => c.name), checks, ...results };
const file = writeEvidence(NAME, JSON.parse(JSON.stringify(summary)));
console.log(`${pass ? 'PASS' : 'FAIL'} ${file}`);
process.exit(pass ? 0 : 1);
