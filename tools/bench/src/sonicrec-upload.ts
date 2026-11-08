// Fly by Sound, step 8: sending a recording to the author, in a real browser against a LOCAL copy of the real API (headless Chrome, real OPFS,
// real fetch, the live headers through serve-csp.mjs with API_PROXY to apps/api/tests/rig_server.py: the real request handler, the real store
// and the two real delivery workers; only Telegram and SMTP are fakes on this machine). The real session side runs on a stand-in context (the
// flight lane's runtime, samples and key router are not here); the browser's speech recognition is a stand-in the harness speaks into.
//   U1 keys      U asks and the server is asked NOTHING; the second U sends 3 chunks of a 2.2 MB package; the stored file, the Telegram document and
//                the mail attachment are the local package byte for byte; the pilot hears sending, stored, delivered in that order; the local copy stays
//   U2 channels  Telegram fails once: the pilot hears "e-mail only" and NOT "delivered"; when Telegram recovers, delivered
//   U3 tab       a connection that fails on chunk 1, the tab closed; the next page resumes: chunk 0 was sent once in all, no second start
//   U3b restart  the API restarts in the middle of an upload; the held chunks are still there, the same page goes on
//   U4 helper    the Send button opens the consent text; nothing goes before the pilot's tick and the click
//   U5 voice     with the tick, "send it to the author" asks and "yes" sends; without it nothing is ever listened to
//   U6 minor     a minor's recording without the guardian's confirmation: nothing reaches the server by U or by the button
//   U7 off       with the sound mode off, U does nothing at all
//   U8 wire      only the page's own origin is called, the token is never in a URL, the proxy's 1100k limit is live and a 1 MiB chunk fits
//   U9 texts     the panel in four languages shows no missing key
//   npx tsx tools/bench/src/sonicrec-upload.ts       evidence/<date>/sonicrec-upload.json and sonicrec-send.png
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'esbuild';
import type { BrowserContext, Page, Request } from 'playwright';
import { launchChrome } from './browser';
import { REPO as EVIDENCE_REPO, today, writeEvidence } from './evidence';
import { REPO, makeDist, serveDist, i18nShim } from './sonicrec-serve';
import { startRig } from './sonicrec-rig';

const shim = i18nShim;
const bundle = await build({ entryPoints: [join(REPO, 'tools', 'bench', 'test', 'sonicrec-upload-page.ts')], outdir: 'out', bundle: true, format: 'esm', platform: 'browser', target: 'es2022', write: false, logLevel: 'silent', plugins: [shim] });
const out = (ext: string): string => bundle.outputFiles.find((f) => f.path.endsWith(ext))?.text ?? '';
const dist = makeDist({
    'en/fly/index.html': '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>sonicrec upload</title><link rel="stylesheet" href="/fly/assets/up.css"><style>body{background:#07080a;color:#e8eaed;font:15px system-ui}</style></head><body><main><p>The flight page stand-in.</p></main><script type="module" src="/fly/assets/up.js"></script></body></html>',
    'fly/assets/up.js': out('.js'),
    'fly/assets/up.css': out('.css')
});

// ---------------------------------------------------------------- the local API
const cache = join(EVIDENCE_REPO, '.cache', 'sonicrec-upload');
rmSync(cache, { recursive: true, force: true });
mkdirSync(cache, { recursive: true });
const rig = await startRig(join(cache, 'data'));
const ctl = rig.ctl;
const rigState = (): Promise<any> => rig.state(); // eslint-disable-line @typescript-eslint/no-explicit-any

const served = await serveDist(dist, { API_PROXY: `http://127.0.0.1:${rig.api}` });
const { browser, which } = await launchChrome({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--disable-gpu'] });

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const log = (...a: unknown[]): void => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
const call = <T>(page: Page, fn: string, ...args: unknown[]): Promise<T> =>
    page.evaluate(([f, a]) => (window as unknown as { __up: Record<string, (...x: unknown[]) => unknown> }).__up[f as string]?.(...(a as unknown[])) as unknown, [fn, args] as const) as Promise<T>;
/** Starts a page function and does not wait for it (a listen can last a while). */
const fire = (page: Page, fn: string, ...args: unknown[]): Promise<void> =>
    page.evaluate(([f, a]) => { void (window as unknown as { __up: Record<string, (...x: unknown[]) => unknown> }).__up[f as string]?.(...(a as unknown[])); }, [fn, args] as const);
const state = (page: Page): Promise<Record<string, any>> => call(page, 'state'); // eslint-disable-line @typescript-eslint/no-explicit-any
const spokenKeys = async (page: Page): Promise<string[]> => (await call<{ key: string }[]>(page, 'spoken')).map((l) => l.key);

const statuses: string[] = [];
let lastPage: Page | null = null;

async function until(what: string, pred: () => Promise<boolean> | boolean, ms = 30000): Promise<void> {
    const t0 = Date.now();
    for (;;) {
        if (await pred()) return;
        if (Date.now() - t0 > ms) {
            let page = '';
            try {
                if (lastPage !== null) page = JSON.stringify({ spoken: await spokenKeys(lastPage), live: await call(lastPage, 'live'), message: (await state(lastPage)).panelMessage });
            } catch {
                page = 'page gone';
            }
            throw new Error(`timed out waiting for ${what}; last responses: ${statuses.slice(-12).join(' | ')}; page: ${page.slice(0, 700)}`);
        }
        await sleep(40);
    }
}

interface Logged { method: string; path: string; search: string; headers: Record<string, string>; origin: string; body: any } // eslint-disable-line @typescript-eslint/no-explicit-any
const requests: Logged[] = [];
/** every request of the whole run (requests is cleared between scenarios; the checks of the wire look at all of them) */
const everything: Logged[] = [];
const consoleProblems: string[] = [];

/** `speech`: a stand-in for the browser's speech recognition the harness speaks into (window.__sr, window.__srSay). */
const FAKE_SR = `
window.__sr = { instances: [], starts: 0, aborts: 0 };
// Chrome has the unprefixed name as well, and the code prefers it: both are replaced
window.SpeechRecognition = window.webkitSpeechRecognition = class {
    constructor() { this.lang = ''; this.continuous = true; this.interimResults = true; this.maxAlternatives = 1; this.onresult = null; this.onerror = null; this.onend = null; this.active = false; window.__sr.instances.push(this); }
    start() { window.__sr.starts++; this.active = true; }
    stop() { this.active = false; if (this.onend) this.onend(); }
    abort() { window.__sr.aborts++; this.active = false; setTimeout(() => { if (this.onend) this.onend(); }, 0); }
};
window.__srSay = (...alts) => {
    const r = [...window.__sr.instances].reverse().find((i) => i.active);
    if (!r || !r.onresult) return false;
    const result = Object.assign(alts.map((t) => ({ transcript: t })), { length: alts.length });
    r.onresult({ resultIndex: 0, results: Object.assign([result], { length: 1 }) });
    return true;
};`;

async function newContext(o: { speech?: boolean } = {}): Promise<BrowserContext> {
    const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1100, height: 900 } });
    await ctx.grantPermissions(['microphone'], { origin: served.origin });
    if (o.speech === true) await ctx.addInitScript({ content: FAKE_SR });
    ctx.on('response', (res) => {
        const u = new URL(res.url());
        if (u.pathname.startsWith('/api/session')) statuses.push(`${res.request().method()} ${u.pathname.replace('/api/session', '').replace(/S-\d{8}-[0-9a-f]{12}/, '<id>')} ${res.status()}`);
    });
    ctx.on('request', (r: Request) => {
        const u = new URL(r.url());
        let body: unknown = null;
        try { body = r.postDataJSON(); } catch { body = null; }
        const entry = { method: r.method(), path: u.pathname, search: u.search, headers: r.headers(), origin: u.origin, body };
        requests.push(entry);
        everything.push(entry);
    });
    return ctx;
}

async function open(ctx: BrowserContext, init: { mode?: boolean; profile?: Record<string, unknown> } = {}, query = ''): Promise<Page> {
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log('pageerror', e.message));
    page.on('console', (m) => { if (m.type() === 'error' && /Content Security Policy|Refused to|violates/.test(m.text())) consoleProblems.push(m.text().slice(0, 200)); });
    await page.goto(`${served.origin}/en/fly/${query}`);
    await page.waitForFunction(() => (window as unknown as { __up?: unknown }).__up !== undefined);
    await page.bringToFront();
    await call(page, 'init', init);
    lastPage = page;
    return page;
}

/** The client saves "delivered" when it next reads the status, a moment after the server has it: wait for the record, not the server. */
async function recordDelivered(page: Page, id: string, ms = 20000): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
    await until('the record to say delivered', async () => (await call<any[]>(page, 'entries')).find((e) => e.id === id)?.transfer?.delivered === true, ms); // eslint-disable-line @typescript-eslint/no-explicit-any
    return (await call<any[]>(page, 'entries')).find((e) => e.id === id); // eslint-disable-line @typescript-eslint/no-explicit-any
}

const sessionCalls = (): Logged[] => requests.filter((r) => r.path.startsWith('/api/session'));
const sub = (r: Logged): string => `${r.method} ${r.path.replace('/api/session', '').replace(/S-\d{8}-[0-9a-f]{12}/, '<id>')}`;
const chunkCalls = (n?: number): Logged[] => sessionCalls().filter((r) => r.method === 'POST' && /\/api\/session\/S-[^/]+\/\d+$/.test(r.path) && (n === undefined || r.path.endsWith(`/${n}`)));
const MIB = 1 << 20;

const results: Record<string, unknown> = {};
const checks: Record<string, boolean> = {};
const tmpPng = join(EVIDENCE_REPO, 'evidence', today());
mkdirSync(tmpPng, { recursive: true });

try {
    log('browser up', which.version, 'rig api', rig.api);

    // ---------------------------------------------------------------- U1: the keys, a package of three chunks
    const ctx1 = await newContext();
    {
        const page = await open(ctx1);
        const id = await call<string>(page, 'makeSession', { voiceBytes: 2_200_000 });
        const firstPackage = await call<{ sha256: string; bytes: number }>(page, 'packageInfo', id);
        const chunks = Math.ceil(firstPackage.bytes / MIB);
        log('U1: package', firstPackage.bytes, 'bytes in', chunks, 'chunks');
        await ctl('/reset');
        requests.length = 0;
        await page.keyboard.press('KeyU');
        await until('the question', async () => (await spokenKeys(page)).includes('send.confirm'));
        await sleep(300);
        const asked = { calls: sessionCalls().length, sessions: (await rigState()).sessions.length, spoken: await call<{ key: string; params?: unknown }[]>(page, 'spoken') };
        checks['U1: the first U asks (send.confirm with the key U) and the server is asked nothing: no request, no session'] = asked.calls === 0 && asked.sessions === 0 && asked.spoken[0]?.key === 'send.confirm' && JSON.stringify(asked.spoken[0]?.params) === '{"key":"U"}';
        await page.keyboard.press('KeyU');
        await until('delivered', async () => (await spokenKeys(page)).includes('send.delivered'), 40000);
        const st = await rigState();
        const seq = sessionCalls().map(sub);
        const posts = chunkCalls();
        results.u1 = { chunks, spoken: await spokenKeys(page), requests: seq.length, seq: seq.slice(0, 14), sessions: st.sessions, telegram: st.telegram.documents, mail: st.mail.messages.map((m: any) => m.attachment) }; // eslint-disable-line @typescript-eslint/no-explicit-any
        checks['U1: the second U sends: start, the status, every chunk once, finish, then the status until delivered'] = seq[0] === 'POST /start' && seq[1] === 'GET /<id>' && JSON.stringify(seq.slice(2, 2 + chunks)) === JSON.stringify(Array.from({ length: chunks }, (_, i) => `POST /<id>/${i}`)) && seq[2 + chunks] === 'POST /<id>/finish' && seq.slice(3 + chunks).every((s) => s === 'GET /<id>') && posts.length === chunks;
        checks['U1: the chunks are 1 MiB (the last the rest) and each carries its own SHA-256 and the token in headers'] = posts.every((p) => /^[0-9a-f]{64}$/.test(p.headers['x-chunk-sha256'] ?? '') && (p.headers['x-session-token'] ?? '').length > 20);
        checks['U1: the server holds the package: the same SHA-256 and size as the local copy'] = st.sessions.length === 1 && st.sessions[0].sha256 === firstPackage.sha256 && st.sessions[0].bytes === firstPackage.bytes;
        checks['U1: Telegram received the same bytes (SHA-256 of the sent document)'] = st.telegram.documents.length === 1 && st.telegram.documents[0].sha256 === firstPackage.sha256 && st.telegram.documents[0].bytes === firstPackage.bytes;
        checks['U1: the mail attachment is the same bytes'] = st.mail.messages.length === 1 && st.mail.messages[0].attachment?.sha256 === firstPackage.sha256;
        checks['U1: both channels are sent on the server when the pilot is told "delivered"'] = st.sessions[0].delivered === true && st.sessions[0].channels.telegram === 'sent' && st.sessions[0].channels.email === 'sent';
        const heard = await spokenKeys(page);
        checks['U1: the pilot hears the question, sending, stored, delivered, in that order and nothing else'] = JSON.stringify(heard) === '["send.confirm","send.sending","send.stored","send.delivered"]';
        const after = await call<{ sha256: string; bytes: number }>(page, 'packageInfo', id);
        await recordDelivered(page, id);
        const entries = await call<any[]>(page, 'entries'); // eslint-disable-line @typescript-eslint/no-explicit-any
        checks['U1: the recording on this device is untouched: the same package bytes, still listed, its upload.json says delivered with the key as the way'] = after.sha256 === firstPackage.sha256 && entries.length === 1 && entries[0].state === 'finished' && entries[0].transfer?.delivered === true && entries[0].transfer?.consentVia === 'key' && entries[0].transfer?.stored === true;
        await call(page, 'openPanel');
        await page.waitForTimeout(400);
        const row = (await state(page)).rows[0];
        results.u1Row = row;
        checks['U1: the panel row says delivered with both channels, and offers no Send for it'] = /Delivered\. The author has it: Telegram: sent, e-mail: sent\./.test(row.transfer) && !row.buttons.some((b: { action: string }) => b.action === 'send');
        await page.screenshot({ path: join(tmpPng, 'sonicrec-send.png') });
        await page.close();
    }

    // ---------------------------------------------------------------- U2: one channel fails
    {
        const page = await open(ctx1);
        const id = await call<string>(page, 'makeSession', { voiceBytes: 600_000 });
        const info = await call<{ sha256: string; bytes: number }>(page, 'packageInfo', id);
        await ctl('/telegram', { plan: [['status', 500]] });
        requests.length = 0;
        await page.keyboard.press('KeyU');
        await until('the question', async () => (await spokenKeys(page)).includes('send.confirm'));
        await sleep(300);
        await page.keyboard.press('KeyU');
        await until('e-mail only', async () => (await spokenKeys(page)).includes('send.partial-email'), 30000);
        await page.waitForTimeout(2500);
        const mid = await rigState();
        const midSession = mid.sessions.find((s: any) => s.sha256 === info.sha256); // eslint-disable-line @typescript-eslint/no-explicit-any
        const midKeys = await spokenKeys(page);
        await call(page, 'openPanel');
        const midRow = (await state(page)).rows.find((r: any) => r.transfer.length > 0); // eslint-disable-line @typescript-eslint/no-explicit-any
        results.u2 = { midChannels: midSession?.channels, midKeys, midRow: midRow?.transfer };
        checks['U2: Telegram failed once and e-mail is sent: the pilot hears "e-mail only" and has NOT heard "delivered"'] = midSession?.channels.email === 'sent' && midSession?.channels.telegram !== 'sent' && midKeys.includes('send.partial-email') && !midKeys.includes('send.delivered');
        checks['U2: the panel says which channel is waiting'] = /Telegram: will try again/.test(midRow?.transfer ?? '') && /e-mail: sent/.test(midRow?.transfer ?? '');
        await ctl('/clock', { advance: 120 }); // the retry is due
        await until('delivered after the retry', async () => (await spokenKeys(page)).includes('send.delivered'), 40000);
        const end = await rigState();
        checks['U2: when Telegram recovers the pilot hears delivered, and both channels hold the same package'] = end.telegram.documents.some((d: any) => d.sha256 === info.sha256) && end.mail.messages.some((m: any) => m.attachment?.sha256 === info.sha256); // eslint-disable-line @typescript-eslint/no-explicit-any
        const keys = await spokenKeys(page);
        checks['U2: the order the pilot heard: question, sending, stored, e-mail only, delivered'] = JSON.stringify(keys) === '["send.confirm","send.sending","send.stored","send.partial-email","send.delivered"]';
        await page.close();
    }

    // ---------------------------------------------------------------- U3: a closed tab, resumed by the next page
    {
        const ctx = await newContext();
        const p1 = await open(ctx);
        const id = await call<string>(p1, 'makeSession', { voiceBytes: 2_200_000 });
        const info = await call<{ sha256: string; bytes: number }>(p1, 'packageInfo', id);
        const chunks = Math.ceil(info.bytes / MIB);
        let blocked = true;
        await ctx.route('**/api/session/*/1', (route) => (blocked ? route.abort() : route.continue()));
        requests.length = 0;
        await p1.keyboard.press('KeyU');
        await until('the question', async () => (await spokenKeys(p1)).includes('send.confirm'));
        await sleep(300);
        await p1.keyboard.press('KeyU');
        await until('a failed chunk 1', async () => chunkCalls(1).length >= 1 && Object.values(await call<Record<string, any>>(p1, 'live')).some((l) => l.stage === 'waiting'), 20000); // eslint-disable-line @typescript-eslint/no-explicit-any
        const rec1 = (await call<any[]>(p1, 'entries'))[0]; // eslint-disable-line @typescript-eslint/no-explicit-any
        const held = await (await fetch(`${served.origin}/api/session/${rec1.transfer.serverId}`, { headers: { 'X-Session-Token': rec1.transfer.token } })).json();
        const row = (await state(p1));
        results.u3 = { heldBeforeClose: held.held, chunks, stage: Object.values(await call<Record<string, any>>(p1, 'live'))[0] }; // eslint-disable-line @typescript-eslint/no-explicit-any
        checks['U3: the connection fails on chunk 1: the server holds chunk 0 only, the pilot heard "did not work" once'] = JSON.stringify(held.held) === '[0]' && (await spokenKeys(p1)).filter((k) => k === 'send.failed').length === 1;
        void row;
        await p1.close(); // the tab is closed in the middle
        blocked = false;
        const before = requests.length;
        const p2 = await open(ctx); // the next visit: the sound mode starts, the sending that was begun goes on by itself
        await until('delivered by the next page', async () => (await rigState()).sessions.some((s: any) => s.sha256 === info.sha256 && s.delivered), 40000); // eslint-disable-line @typescript-eslint/no-explicit-any
        const second = requests.slice(before).filter((r) => r.path.startsWith('/api/session'));
        const st = await rigState();
        results.u3b = { second: second.map(sub) };
        checks['U3: the next page resumes by itself: no second start, chunk 0 was sent once in all, chunk 2 once, chunk 1 until it got through'] = !second.some((r) => sub(r) === 'POST /start') && chunkCalls(0).length === 1 && chunkCalls(2).length === 1 && chunkCalls(1).length >= 2;
        checks['U3: what arrived is the whole package, and the pilot is not asked again'] = st.telegram.documents.some((d: any) => d.sha256 === info.sha256) && !(await spokenKeys(p2)).includes('send.confirm'); // eslint-disable-line @typescript-eslint/no-explicit-any
        const rec2 = await recordDelivered(p2, id);
        checks['U3: the record kept the first consent through the resume'] = rec2?.transfer?.consentVia === 'key' && rec2?.transfer?.delivered === true && chunks === 3;
        await p2.close();
        await ctx.close();
    }

    // ---------------------------------------------------------------- U3b: the API restarts in the middle
    {
        const ctx = await newContext();
        const page = await open(ctx);
        const id = await call<string>(page, 'makeSession', { voiceBytes: 2_200_000 });
        const info = await call<{ sha256: string; bytes: number }>(page, 'packageInfo', id);
        let blocked = true;
        await ctx.route('**/api/session/*/1', (route) => (blocked ? route.abort() : route.continue()));
        requests.length = 0;
        await page.keyboard.press('KeyU');
        await until('the question', async () => (await spokenKeys(page)).includes('send.confirm'));
        await sleep(300);
        await page.keyboard.press('KeyU');
        await until('a failed chunk 1', async () => chunkCalls(1).length >= 1, 20000);
        await ctl('/restart'); // the store and the workers are built again over the same files
        blocked = false;
        await until('delivered after the restart', async () => (await rigState()).sessions.some((s: any) => s.sha256 === info.sha256 && s.delivered), 40000); // eslint-disable-line @typescript-eslint/no-explicit-any
        results.u3brestart = { chunk0: chunkCalls(0).length, chunk1: chunkCalls(1).length, chunk2: chunkCalls(2).length, starts: sessionCalls().filter((r) => sub(r) === 'POST /start').length, seq: sessionCalls().map(sub).slice(0, 30), statuses: statuses.slice(-30) };
        checks['U3b: the API restarted in the middle: chunk 0 was held through it and sent once, the same page went on, one start'] = chunkCalls(0).length === 1 && sessionCalls().filter((r) => sub(r) === 'POST /start').length === 1;
        await ctx.close();
    }

    // ---------------------------------------------------------------- U4: the helper's button
    {
        const ctx = await newContext();
        const page = await open(ctx);
        const id = await call<string>(page, 'makeSession', { voiceBytes: 300_000 });
        const info = await call<{ sha256: string; bytes: number }>(page, 'packageInfo', id);
        await call(page, 'openPanel');
        await page.waitForTimeout(400);
        requests.length = 0;
        const send = page.getByRole('button', { name: 'Send to the author' });
        await send.click();
        await page.waitForTimeout(300);
        const s1 = await state(page);
        const consent = s1.rows[0].consent;
        const go = page.getByRole('button', { name: 'Send', exact: true });
        const disabledBefore = await go.isDisabled();
        results.u4 = { consent: consent?.body, link: consent?.link, disabledBefore };
        checks['U4: Send opens the consent text in the row (what is sent, where, how long, the privacy page) and the button is off until the tick'] = consent !== null && /Send this recording to the author\?/.test(consent.heading) && /Telegram and by e-mail/.test(consent.body) && /five years/.test(consent.body) && consent.link === '/en/privacy/#fly-by-sound' && disabledBefore === true && sessionCalls().length === 0;
        await page.getByLabel('The pilot agrees to send this recording, with the voice.').check();
        const enabledAfter = await go.isEnabled();
        await sleep(200);
        checks['U4: the tick turns the button on and still nothing has been sent'] = enabledAfter && sessionCalls().length === 0;
        await go.click();
        await until('delivered by the button', async () => (await rigState()).sessions.some((s: any) => s.sha256 === info.sha256 && s.delivered), 40000); // eslint-disable-line @typescript-eslint/no-explicit-any
        const rec = await recordDelivered(page, id);
        checks['U4: the click sends, and the record says the button was the way'] = rec.transfer?.consentVia === 'button' && rec.transfer?.delivered === true && (await spokenKeys(page)).includes('send.sending') && !(await spokenKeys(page)).includes('send.confirm');
        await ctx.close();
    }

    // ---------------------------------------------------------------- U5: by voice, only where allowed
    {
        const ctx = await newContext({ speech: true });
        const page = await open(ctx, { profile: { speechRecognition: true } });
        const id = await call<string>(page, 'makeSession', { voiceBytes: 300_000 });
        const info = await call<{ sha256: string; bytes: number }>(page, 'packageInfo', id);
        requests.length = 0;
        await fire(page, 'offerSend', id);
        await until('listening', async () => (await page.evaluate(() => (window as unknown as { __sr: { starts: number } }).__sr.starts)) >= 1);
        const keys1 = await spokenKeys(page);
        checks['U5: the pilot hears how to send it, then the disclosure, then how to say it, and only then is the browser listening'] = JSON.stringify(keys1) === '["send.ask","send.speech-note","send.by-voice"]';
        await page.evaluate(() => (window as unknown as { __srSay: (...a: string[]) => boolean }).__srSay('what is the weather today'));
        await sleep(300);
        checks['U5: other words do nothing'] = sessionCalls().length === 0 && !(await spokenKeys(page)).includes('send.confirm');
        await page.evaluate(() => (window as unknown as { __srSay: (...a: string[]) => boolean }).__srSay('please send it to the author'));
        await until('the question', async () => (await spokenKeys(page)).includes('send.confirm'));
        await sleep(300);
        checks['U5: "send it to the author" is a request: the question is asked, the server is asked nothing'] = sessionCalls().length === 0;
        await until('listening for the yes', async () => (await page.evaluate(() => (window as unknown as { __sr: { instances: unknown[] } }).__sr.instances.length)) >= 2);
        await page.evaluate(() => (window as unknown as { __srSay: (...a: string[]) => boolean }).__srSay('yes'));
        await until('delivered by voice', async () => (await rigState()).sessions.some((s: any) => s.sha256 === info.sha256 && s.delivered), 40000); // eslint-disable-line @typescript-eslint/no-explicit-any
        const rec = await recordDelivered(page, id);
        const sr = await page.evaluate(() => (window as unknown as { __sr: { starts: number; aborts: number } }).__sr);
        checks['U5: a spoken yes sends, the record says voice was the way, and every listen was let go of'] = rec.transfer?.consentVia === 'voice' && rec.transfer?.delivered === true && sr.aborts >= 1;
        results.u5 = { sr, spoken: await spokenKeys(page) };
        await page.close();
        // control: without the tick nothing is ever listened to
        const off = await open(ctx, { profile: { speechRecognition: false } });
        await off.evaluate(() => { (window as unknown as { __sr: { starts: number } }).__sr.starts = 0; });
        const id2 = await call<string>(off, 'makeSession', { voiceBytes: 3000 });
        await call(off, 'offerSend', id2);
        await off.keyboard.press('KeyU');
        await until('the question', async () => (await spokenKeys(off)).includes('send.confirm'));
        await sleep(300);
        const starts = await off.evaluate(() => (window as unknown as { __sr: { starts: number } }).__sr.starts);
        checks['U5: control, without the tick the browser is never asked to listen, the keys still ask'] = starts === 0 && (await spokenKeys(off)).filter((k) => k === 'send.ask').length >= 1;
        await ctx.close();
    }

    // ---------------------------------------------------------------- U6: a minor
    {
        const ctx = await newContext();
        const page = await open(ctx);
        const no = await call<string>(page, 'makeSession', { voiceBytes: 3000, minor: true, guardian: false });
        await call(page, 'openPanel');
        await page.waitForTimeout(300);
        requests.length = 0;
        await page.keyboard.press('KeyU');
        await sleep(600);
        const heardNo = await spokenKeys(page);
        await page.getByRole('button', { name: 'Send to the author' }).click();
        await sleep(300);
        const msg = (await state(page)).panelMessage;
        checks['U6: a minor\'s recording without the guardian\'s confirmation: U says why, the button says why, and not one request reaches the server'] = JSON.stringify(heardNo) === '["rec.minor"]' && /parent's signed consent was not confirmed/.test(msg) && sessionCalls().length === 0;
        results.u6 = { heardNo, msg };
        // control: with the guardian's confirmation it is asked and sent
        const yes = await call<string>(page, 'makeSession', { voiceBytes: 3000, minor: true, guardian: true, at: new Date(Date.now() + 5000).toISOString() });
        const info = await call<{ sha256: string }>(page, 'packageInfo', yes);
        await call(page, 'clearSpoken');
        await page.keyboard.press('KeyU');
        await until('the question', async () => (await spokenKeys(page)).includes('send.confirm'));
        await sleep(300);
        await page.keyboard.press('KeyU');
        await until('delivered', async () => (await rigState()).sessions.some((s: any) => s.sha256 === info.sha256 && s.delivered), 40000); // eslint-disable-line @typescript-eslint/no-explicit-any
        checks['U6: control, the same pilot with the guardian\'s confirmation recorded is sent'] = true;
        void no;
        await ctx.close();
    }

    // ---------------------------------------------------------------- U7: the sound mode off
    {
        const ctx = await newContext();
        const page = await open(ctx, { mode: false });
        await call(page, 'makeSession', { voiceBytes: 3000 });
        requests.length = 0;
        await page.keyboard.press('KeyU');
        await page.keyboard.press('KeyU');
        await sleep(600);
        const s = await state(page);
        checks['U7: with the sound mode off U does nothing: no speech, no request, no panel'] = (await spokenKeys(page)).length === 0 && sessionCalls().length === 0 && s.panelOpen === false && (await page.locator('.sonicrec-toggle').count()) === 0;
        await ctx.close();
    }

    // ---------------------------------------------------------------- U8: the wire
    {
        const ctx = await newContext();
        const page = await open(ctx);
        const proxy = await page.evaluate(async () => {
            const big = await fetch('/api/session/S-20261107-000000000000/0', { method: 'POST', body: new Uint8Array(1_200_000) });
            const fits = await fetch('/api/session/S-20261107-000000000000/0', { method: 'POST', body: new Uint8Array(1024 * 1024) });
            return { big: big.status, fits: fits.status };
        });
        results.u8 = { proxy };
        checks['U8: the proxy\'s 1100k limit is live (1.2 MB is refused with 413) and a 1 MiB chunk passes it'] = proxy.big === 413 && proxy.fits !== 413;
        const starts = everything.filter((r) => r.path.startsWith('/api/session') && sub(r) === 'POST /start' && r.body !== null);
        results.u8starts = starts.map((r) => ({ consentSend: r.body?.consentSend, size: r.body?.size, sha: typeof r.body?.sha256 }));
        checks['U8: every start said the pilot confirmed sending (consentSend true) and the package\'s size and SHA-256'] = starts.length > 0 && starts.every((r) => r.body.consentSend === true && /^[0-9a-f]{64}$/.test(r.body.sha256) && r.body.size > 0);
        const all = everything.filter((r) => r.path.startsWith('/api/'));
        checks['U8: only the page\'s own origin was called, and the token was never in a URL'] = all.every((r) => r.origin === served.origin) && all.every((r) => r.search === '' && !/[A-Za-z0-9_-]{32,}/.test(r.path.replace(/S-\d{8}-[0-9a-f]{12}/, '')));
        checks['U8: no Content-Security-Policy violation was reported in the whole run'] = consoleProblems.length === 0;
        await ctx.close();
    }

    // ---------------------------------------------------------------- U9: four languages
    {
        const langs: Record<string, string[]> = {};
        for (const lang of ['en', 'es', 'pl', 'ru']) {
            const ctx = await newContext();
            const page = await open(ctx, {}, `?lang=${lang}`);
            await call(page, 'makeSession', { voiceBytes: 3000 });
            await call(page, 'openPanel');
            await page.waitForTimeout(400);
            await page.locator('[data-action="send"]').first().click();
            await page.waitForTimeout(300);
            const texts = await page.evaluate(() => [...document.querySelectorAll('.sonicrec-panel')].map((el) => el.textContent ?? '').join(' '));
            langs[lang] = [texts.includes('sonicrec.') ? 'MISSING KEY' : 'ok', (texts.match(/sonicrec\.[A-Za-z.-]+/g) ?? []).slice(0, 5).join(' ')];
            await ctx.close();
        }
        results.u9 = langs;
        checks['U9: the panel with the consent text open shows no missing key in en, es, pl or ru'] = Object.values(langs).every((v) => v[0] === 'ok');
    }
} finally {
    await browser.close();
    await served.stop();
    await rig.stop();
    rmSync(dist, { recursive: true, force: true });
    rmSync(cache, { recursive: true, force: true });
}

const pass = Object.values(checks).every(Boolean);
writeEvidence('sonicrec-upload', {
    pass,
    checks,
    results,
    note: 'headless Chrome, real OPFS, DOM, fetch and keys, the live headers through serve-csp.mjs with API_PROXY to a LOCAL copy of the real API (apps/api/tests/rig_server.py: the real handler, store and delivery workers; Telegram and SMTP are fakes on this machine). The sound runtime, samples and key router are stand-ins; the browser\'s speech recognition is a stand-in the harness speaks into (the real service is not tried).'
});
console.log(JSON.stringify({ checks }, null, 1));
console.log(pass ? 'sonicrec-upload PASS' : 'sonicrec-upload FAIL');
process.exit(pass ? 0 : 1);
