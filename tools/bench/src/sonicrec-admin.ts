// Fly by Sound, step 9: the owner's Sessions tab in a real browser, against a LOCAL copy of the real API (apps/api/tests/rig_server.py: the real
// request handler, the real admin session and CSRF check, the real store and delivery workers; Telegram and SMTP are fakes on this machine) and the
// admin page as a release would carry it (vite build of apps/fly, served by serve-csp.mjs under the live admin CSP). The login is a TEST password
// made for this run: the live admin is never visited and its password is never used.
//   S1 list      four recordings sent by the real upload client: the rows, their states and channels, the totals, nothing a pilot would not want shown
//   S2 filter    "not delivered yet", "a channel gave up" and the search narrow the list
//   S3 download  a click saves the package: the SAVED bytes are the ones the pilot sent; without the session the same address answers 401
//   S4 resend    a channel that gave up is sent again at once and arrives; a channel that already arrived asks "send again?" first
//   S5 delete    two clicks; the package and its state are gone, a tombstone stays, the others are untouched; a POST without the CSRF header is refused
//   S6 audit     every download, resend and deletion is in the admin's audit log; no token, no password
//   S7 texts     the tab in four languages shows no missing key
//   npx tsx tools/bench/src/sonicrec-admin.ts       evidence/<date>/sonicrec-admin.json and sonicrec-admin.png
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { MemorySink } from '../../../packages/sonic-fpv/src';
import { Transfer } from '../../../apps/fly/src/sonic-session/upload';
import { launchChrome } from './browser';
import { REPO as EVIDENCE_REPO, today, writeEvidence } from './evidence';
import { REPO, serveDist } from './sonicrec-serve';
import { startRig } from './sonicrec-rig';
import { FakeDirectory } from '../test/sonicrec-fixtures';
import { makeSession } from '../test/sonicrec-send-fixtures';

const sha = (b: Uint8Array | Buffer): string => createHash('sha256').update(b).digest('hex');
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const log = (...a: unknown[]): void => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
const cache = join(EVIDENCE_REPO, '.cache', 'sonicrec-admin');
rmSync(cache, { recursive: true, force: true });
mkdirSync(cache, { recursive: true });
const PASSWORD = `rig-${randomBytes(9).toString('base64url')}`;

// the admin page as a release carries it
log('building the admin page (vite)');
execFileSync(process.execPath, [join(REPO, 'tools', 'bench', 'scripts', 'admin-dist.mjs'), join(cache, 'dist')], { cwd: REPO, stdio: 'ignore' });
const rig = await startRig(join(cache, 'data'), { adminPassword: PASSWORD });
const served = await serveDist(join(cache, 'dist'), { API_PROXY: `http://127.0.0.1:${rig.api}` });
const { browser, which } = await launchChrome({ args: ['--disable-gpu'] });

async function until(what: string, pred: () => Promise<boolean> | boolean, ms = 30000): Promise<void> {
    const t0 = Date.now();
    for (;;) {
        if (await pred()) return;
        if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
        await sleep(50);
    }
}

/** Sends one recording through the real client to the rig (no browser: the upload client runs in Node) and returns what was sent. */
async function sendRecording(id: string, o: { voiceBytes: number; minor?: boolean; guardian?: boolean; at: string; untilDelivered?: boolean }): Promise<{ id: string; bytes: Uint8Array; sha: string; serverId: string }> {
    const made = await makeSession({ id, at: o.at, voiceBytes: o.voiceBytes, ...(o.minor === undefined ? {} : { minor: o.minor, guardian: o.guardian === true }), dir: new FakeDirectory('rec') });
    const bytes = await made.pack();
    const t = new Transfer({ store: new MemorySink(), pack: async () => new Blob([bytes as BlobPart]), consent: { at: o.at, via: 'key' }, fetch, base: `http://127.0.0.1:${rig.api}/api/session`, pollMs: () => 100 });
    const run = t.run();
    if (o.untilDelivered === false) {
        await until('stored', async () => (await rig.state()).sessions.some((s: any) => s.sha256 === sha(bytes))); // eslint-disable-line @typescript-eslint/no-explicit-any
        t.stop();
    }
    await run;
    const st = await rig.state();
    const serverId = st.sessions.find((s: any) => s.sha256 === sha(bytes)).id; // eslint-disable-line @typescript-eslint/no-explicit-any
    return { id, bytes, sha: sha(bytes), serverId };
}

const results: Record<string, unknown> = {};
const checks: Record<string, boolean> = {};
const shots = join(EVIDENCE_REPO, 'evidence', today());
mkdirSync(shots, { recursive: true });
const posts: string[] = [];

try {
    log('browser up', which.version, 'rig api', rig.api);
    // ---------------------------------------------------------------- the recordings the pilots "sent"
    const A = await sendRecording('adminRecA000000000001', { voiceBytes: 2_200_000, at: '2026-11-07T10:00:00Z' });
    await rig.ctl('/telegram', { plan: [['status', 500]] });
    const B = await sendRecording('adminRecB000000000002', { voiceBytes: 600_000, at: '2026-11-07T10:10:00Z', untilDelivered: false });
    await until('B: e-mail sent and Telegram waiting', async () => { const s = (await rig.state()).sessions.find((x: any) => x.id === B.serverId); return s?.channels.email === 'sent' && s?.channels.telegram === 'retrying'; }); // eslint-disable-line @typescript-eslint/no-explicit-any
    const C = await sendRecording('adminRecC000000000003', { voiceBytes: 5000, minor: true, guardian: true, at: '2026-11-07T10:20:00Z' });
    const D = await sendRecording('adminRecD000000000004', { voiceBytes: 4000, at: '2026-11-07T10:30:00Z' });
    await rig.ctl('/channel', { id: D.serverId, channel: 'telegram', status: 'failed' });
    log('four recordings on the server');

    const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1400, height: 1000 } });
    await ctx.addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: served.origin }]);
    ctx.on('request', (r) => { if (r.method() === 'POST') posts.push(new URL(r.url()).pathname.replace(/S-\d{8}-[0-9a-f]{12}/, '<id>')); });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log('pageerror', e.message));
    const problems: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error' && /Content Security Policy|Refused to|violates/.test(m.text())) problems.push(m.text().slice(0, 200)); });

    await page.goto(`${served.origin}/admin/`);
    await page.locator('input[name="password"]').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByRole('tab', { name: 'Recordings' }).click();
    await page.locator('[data-testid="s-table"] tbody tr').first().waitFor({ timeout: 15000 });

    const rowsOf = async (): Promise<{ id: string; state: string; text: string; tg: string; mail: string }[]> =>
        page.evaluate(() => [...document.querySelectorAll('[data-testid="s-table"] tbody tr')].map((tr) => ({
            id: tr.getAttribute('data-id') ?? '',
            state: tr.getAttribute('data-state') ?? '',
            text: (tr.textContent ?? '').replace(/\s+/g, ' ').trim(),
            tg: (tr.querySelector('[data-channel="telegram"]')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
            mail: (tr.querySelector('[data-channel="email"]')?.textContent ?? '').replace(/\s+/g, ' ').trim()
        })));
    const byServerId = (rows: Awaited<ReturnType<typeof rowsOf>>, rec: { serverId: string }) => rows.find((r) => r.id === rec.serverId);

    // ---------------------------------------------------------------- S1: the list
    {
        const rows = await rowsOf();
        const summary = (await page.locator('[data-testid="s-summary"]').textContent()) ?? '';
        results.s1 = { rows, summary };
        checks['S1: the tab lists the four recordings, newest first'] = rows.length === 4 && rows.map((r) => r.id).join() === [D, C, B, A].map((x) => x.serverId).join();
        checks['S1: each row reads right: delivered, one channel done, delivered, a channel gave up'] = rows.map((r) => r.state).join() === 'failed,delivered,half,delivered';
        checks['S1: the channels say what happened (Telegram will try again for B, gave up for D, e-mail sent for B)'] = /will try again/.test(byServerId(rows, B)?.tg ?? '') && /sent/.test(byServerId(rows, B)?.mail ?? '') && /gave up/.test(byServerId(rows, D)?.tg ?? '');
        checks['S1: the summary counts them: 4 stored, 2 delivered, 2 waiting, 1 with a channel that gave up'] = /4 stored, 2 delivered, 2 waiting, 1 with a channel that gave up/.test(summary);
        checks['S1: a minor\'s row says guardian confirmed; the lesson and the length are shown'] = /under 18, guardian confirmed/.test(byServerId(rows, C)?.text ?? '') && /walls-hall/.test(byServerId(rows, A)?.text ?? '') && /0:02/.test(byServerId(rows, A)?.text ?? '');
        const text = (await page.locator('[data-testid="sessions"]').textContent()) ?? '';
        checks['S1: the tab shows no upload token, no hash of it, no device and no user agent'] = !/token/i.test(text) && !/userAgent|vitest/i.test(text);
        checks['S1: both channels are set up on this copy and the tab says so'] = (await page.locator('[data-channel="telegram"][data-configured="true"]').count()) === 1 && (await page.locator('[data-channel="email"][data-configured="true"]').count()) === 1;
        await page.screenshot({ path: join(shots, 'sonicrec-admin.png') });
    }

    // ---------------------------------------------------------------- S2: filter and search
    {
        await page.selectOption('[data-testid="s-filter"]', 'undelivered');
        const undelivered = (await rowsOf()).map((r) => r.id);
        await page.selectOption('[data-testid="s-filter"]', 'failed');
        const failed = (await rowsOf()).map((r) => r.id);
        await page.selectOption('[data-testid="s-filter"]', 'all');
        // typed one key at a time, as a person does (fill() would hide a re-render that sends the caret back to the start)
        await page.locator('[data-testid="s-search"]').pressSequentially('walls', { delay: 40 });
        const typed = await page.locator('[data-testid="s-search"]').inputValue();
        const focused = await page.evaluate(() => document.activeElement?.id === 's-search');
        const searched = (await rowsOf()).length;
        checks['S2: typing in the search box key by key keeps the text in order and the focus in the box'] = typed === 'walls' && focused;
        await page.locator('[data-testid="s-search"]').fill('');
        await page.locator('[data-testid="s-search"]').fill('no-such-lesson');
        const none = (await rowsOf()).length;
        await page.locator('[data-testid="s-search"]').fill('');
        checks['S2: "not delivered yet" shows B and D, "a channel gave up" only D, the search narrows (and finds nothing for nonsense)'] = JSON.stringify(undelivered) === JSON.stringify([D.serverId, B.serverId]) && JSON.stringify(failed) === JSON.stringify([D.serverId]) && searched === 4 && none === 0;
    }

    // ---------------------------------------------------------------- S3: download
    {
        const rowA = page.locator(`tr[data-id="${A.serverId}"]`);
        const [download] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), rowA.locator('[data-action="download"]').click()]);
        const saved = join(cache, 'saved-A.zip');
        await download.saveAs(saved);
        const bytes = readFileSync(saved);
        results.s3 = { name: download.suggestedFilename(), bytes: bytes.length, failure: await download.failure() };
        checks['S3: the click saves the package: the SAVED bytes (not the event) are the ones the pilot sent, under the name with the id'] = sha(bytes) === A.sha && bytes.length === A.bytes.length && download.suggestedFilename() === `fly-by-sound-${A.serverId}.zip` && (await download.failure()) === null;
        const anon = await fetch(`${served.origin}/api/admin/sessions/${A.serverId}/package`);
        checks['S3: control, the same address without the session is refused with 401 and sends no byte of the package'] = anon.status === 401 && (await anon.arrayBuffer()).byteLength < 200;
    }

    // ---------------------------------------------------------------- S4: resend
    {
        const before = await rig.state();
        const docs = before.telegram.documents.filter((d: any) => d.sha256 === D.sha).length; // eslint-disable-line @typescript-eslint/no-explicit-any
        await page.locator(`tr[data-id="${D.serverId}"] [data-action="resend-telegram"]`).click();
        await until('D to be sent again', async () => (await rig.state()).telegram.documents.filter((d: any) => d.sha256 === D.sha).length === docs + 1); // eslint-disable-line @typescript-eslint/no-explicit-any
        await until('the row to read delivered after a refresh', async () => { await page.locator('[data-action="refresh"]').click(); await sleep(300); return byServerId(await rowsOf(), D)?.state === 'delivered'; });
        checks['S4: "Send by Telegram again" on a channel that gave up sends the file at once (Telegram holds a second copy) and the row turns delivered'] = true;
        // a channel that already arrived asks first
        const mailBefore = (await rig.state()).mail.messages.length;
        const resendMail = page.locator(`tr[data-id="${A.serverId}"] [data-action="resend-email"]`);
        await resendMail.click();
        const label = (await page.locator(`tr[data-id="${A.serverId}"] [data-action="resend-email"]`).textContent()) ?? '';
        await sleep(400);
        const mailMid = (await rig.state()).mail.messages.length;
        const labelFull = (await page.locator(`tr[data-id="${A.serverId}"] [data-action="resend-email"]`).getAttribute('aria-label')) ?? '';
        checks['S4: a channel that already arrived asks "send again?" first (short on the button, the whole sentence as its accessible name), and nothing is sent by the first click'] = /Send again\?/.test(label) && /already arrived/.test(labelFull) && mailMid === mailBefore;
        await page.locator(`tr[data-id="${A.serverId}"] [data-action="resend-email"]`).click();
        await until('A to be mailed again', async () => (await rig.state()).mail.messages.length === mailBefore + 1);
        const att = (await rig.state()).mail.messages.at(-1)?.attachment;
        checks['S4: the second click sends it again, the same package'] = att?.sha256 === A.sha;
        results.s4 = { mailBefore, label };
    }

    // ---------------------------------------------------------------- S5: delete
    {
        const dataDir = rig.data;
        const exists = (id: string): boolean => existsSync(join(dataDir, 'sessions', id));
        // a POST from the page's own session without the CSRF header is refused, and nothing happens
        const csrf = await page.evaluate(async (id) => (await fetch(`/api/admin/sessions/${id}/delete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"confirm":true}' })).status, C.serverId);
        checks['S5: control, a delete without the CSRF header is refused with 403 and the recording is still there'] = csrf === 403 && exists(C.serverId);
        const del = page.locator(`tr[data-id="${C.serverId}"] [data-action="delete"]`);
        await del.click();
        const sure = (await page.locator(`tr[data-id="${C.serverId}"] [data-action="delete"]`).textContent()) ?? '';
        await sleep(300);
        checks['S5: the first click only asks "Delete for good?" and deletes nothing'] = /Delete for good\?/.test(sure) && exists(C.serverId);
        await page.locator(`tr[data-id="${C.serverId}"] [data-action="delete"]`).click();
        await until('C to be gone', async () => byServerId(await rowsOf(), C) === undefined);
        const index = readFileSync(join(dataDir, 'sessions', 'index.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
        const tomb = index.filter((l: any) => l.deleted); // eslint-disable-line @typescript-eslint/no-explicit-any
        const rows = await rowsOf();
        checks['S5: the second click deletes: the row is gone, the folder is gone, a tombstone line names only the id and the reason'] = !exists(C.serverId) && tomb.length === 1 && tomb[0].id === C.serverId && tomb[0].reason === 'request' && !('sha256' in tomb[0]);
        checks['S5: the other recordings are untouched'] = rows.length === 3 && [A, B, D].every((x) => exists(x.serverId) && byServerId(rows, x) !== undefined);
    }

    // ---------------------------------------------------------------- S6: audit
    {
        const audit = readFileSync(join(rig.data, 'admin-audit.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
        const acts = audit.filter((a: any) => String(a.action).startsWith('sessions.')); // eslint-disable-line @typescript-eslint/no-explicit-any
        results.s6 = acts.map((a: any) => `${a.action} ${a.ok} ${String(a.detail ?? '').replace(/S-\d{8}-[0-9a-f]{12}/, '<id>')}`); // eslint-disable-line @typescript-eslint/no-explicit-any
        checks['S6: the audit log has the download, both resends and the deletion, each ok, with the id'] = JSON.stringify(acts.map((a: any) => a.action)) === JSON.stringify(['sessions.download', 'sessions.resend', 'sessions.resend', 'sessions.delete']) && acts.every((a: any) => a.ok === true && /S-\d{8}-[0-9a-f]{12}/.test(a.detail)); // eslint-disable-line @typescript-eslint/no-explicit-any
        const raw = readFileSync(join(rig.data, 'admin-audit.jsonl'), 'utf8');
        checks['S6: no password and no upload token is in the audit log'] = !raw.includes(PASSWORD) && !/"token"/.test(raw);
        const sessionsDir = join(rig.data, 'sessions');
        const metaFiles = readdirSync(sessionsDir).filter((n) => n.startsWith('S-')).map((n) => readFileSync(join(sessionsDir, n, 'meta.json'), 'utf8')).join('');
        checks['S6: control, the tokens exist only as hashes on the server (so the check above could have failed)'] = /tokenSha256/.test(metaFiles) && !/"token":/.test(metaFiles);
        const adminPosts = posts.filter((p) => p.startsWith('/api/admin/'));
        results.posts = adminPosts;
        checks['S6: the browser POSTed only the login, the two resends and two deletes (the control without CSRF, and the real one)'] = JSON.stringify(adminPosts) === JSON.stringify(['/api/admin/login', '/api/admin/sessions/<id>/resend', '/api/admin/sessions/<id>/resend', '/api/admin/sessions/<id>/delete', '/api/admin/sessions/<id>/delete']);
        checks['S6: no Content-Security-Policy violation was reported'] = problems.length === 0;
    }

    // ---------------------------------------------------------------- S7: four languages
    {
        const langs: Record<string, string> = {};
        for (const lang of ['es', 'pl', 'ru', 'en']) {
            await ctx.addCookies([{ name: 'NEXT_LOCALE', value: lang, url: served.origin }]);
            await page.goto(`${served.origin}/admin/`);
            await page.getByRole('tablist').waitFor();
            await page.locator('[data-tab="sessions"]').click();
            await page.locator('[data-testid="s-table"] tbody tr').first().waitFor({ timeout: 15000 });
            const text = (await page.locator('[data-testid="sessions"]').textContent()) ?? '';
            const tab = (await page.locator('[data-tab="sessions"]').textContent()) ?? '';
            langs[lang] = `${page.url().includes('/admin') ? 'ok' : 'moved'} ${tab} ${/admin\.sessions\.|admin\.tab\./.test(text + tab) ? 'MISSING KEY' : 'no missing key'} lang=${await page.evaluate(() => document.documentElement.lang)}`;
        }
        results.s7 = langs;
        checks['S7: the tab shows no missing key in en, es, pl or ru, and the page language follows'] = Object.entries(langs).every(([l, v]) => v.includes('no missing key') && v.endsWith(`lang=${l}`));
    }
    await ctx.close();
} finally {
    await browser.close();
    await served.stop();
    await rig.stop();
    rmSync(cache, { recursive: true, force: true });
}

const pass = Object.values(checks).every(Boolean);
writeEvidence('sonicrec-admin', {
    pass,
    checks,
    results,
    note: 'headless Chrome, the admin page built by vite as a release carries it and served under the live admin CSP (serve-csp.mjs), against a LOCAL copy of the real API (apps/api/tests/rig_server.py) with a TEST admin password; the recordings were sent by the real upload client; Telegram and SMTP are fakes on this machine. The live admin is never visited.'
});
console.log(JSON.stringify({ checks }, null, 1));
console.log(pass ? 'sonicrec-admin PASS' : 'sonicrec-admin FAIL');
process.exit(pass ? 0 : 1);
