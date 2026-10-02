// W5 feedback, bug reports and sharing, in the real pages against the real API (apps/api/server.py
// started here on a temporary DATA_DIR, no Telegram token; the browser's /api/** and /s/** are routed
// to it). The simulator runs on the Vite dev server (start it first), the landing from apps/site/out
// (built first). Every check has a negative control that must fire.
//   cd apps/fly && npx vite --port 5353 --strictPort --host 127.0.0.1      (another shell)
//   pnpm --filter @gsfpv/site build
//   FLY=http://127.0.0.1:5353 npx tsx src/accept-v05-feedback.ts           (from tools/bench)
// Draws the scan: takes the benches' GPU lock (C:/dev/.gpu-lock). Evidence: evidence/<date>/v05-feedback.json.
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, rmdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { BrowserContext, Page } from 'playwright';
import { launchChrome, waitReady } from './browser';
import { REPO, writeEvidence } from './evidence';

const FLY = (process.env.FLY ?? 'http://127.0.0.1:5353').replace(/\/$/, '');
const SCENE = '39e63ce9';
const API_PORT = 8000 + Math.floor(Math.random() * 900);
const SITE_PORT = API_PORT + 1000;
const API = `http://127.0.0.1:${API_PORT}`;
const SITE = `http://127.0.0.1:${SITE_PORT}`;
const DATA = mkdtempSync(join(tmpdir(), 'gsfpv-w5-api-'));
const GPU_LOCK = process.env.GPU_LOCK ?? 'C:/dev/.gpu-lock';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const results: Record<string, Any> = {};
const children: ChildProcess[] = [];
let haveLock = false;

function cleanup(): void {
    for (const c of children) try { c.kill(); } catch { /* gone */ }
    if (haveLock) try { rmdirSync(GPU_LOCK); } catch { /* */ }
    haveLock = false;
    try { rmSync(DATA, { recursive: true, force: true }); } catch { /* a file still open */ }
}
process.on('SIGINT', () => { cleanup(); process.exit(130); });

async function gpuLock(): Promise<void> {
    if (process.platform !== 'win32' && !process.env.GPU_LOCK) return;
    for (;;) {
        try { mkdirSync(GPU_LOCK); haveLock = true; return; } catch {
            try { if (Date.now() - statSync(GPU_LOCK).mtimeMs > 30 * 60 * 1000) { rmdirSync(GPU_LOCK); continue; } } catch { /* gone meanwhile */ }
            console.log('waiting for the GPU lock');
            await sleep(10000);
        }
    }
}

async function until(url: string, ms = 20000): Promise<void> {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
        try { if ((await fetch(url)).status < 500) return; } catch { /* not up yet */ }
        await sleep(250);
    }
    throw new Error(`${url} did not come up`);
}

/** Width and height from a JPEG's frame header, or null (also for anything that is not a whole JPEG). */
function jpegSize(b: Buffer): { w: number; h: number } | null {
    if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8 || b[b.length - 2] !== 0xff || b[b.length - 1] !== 0xd9) return null;
    for (let i = 2; i + 9 < b.length;) {
        if (b[i] !== 0xff) return null;
        const m = b[i + 1];
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) };
        i += 2 + b.readUInt16BE(i + 2);
    }
    return null;
}

/** What a link-preview validator checks on a share page: the tags, an absolute https image, the card type. */
function ogCheck(status: number, html: string): { ok: boolean; tags: Record<string, string>; why: string[] } {
    const tags: Record<string, string> = {};
    for (const m of html.matchAll(/<meta (?:property|name)="([^"]+)" content="([^"]*)">/g)) tags[m[1]] = m[2];
    const why: string[] = [];
    if (status !== 200) why.push(`status ${status}`);
    for (const k of ['og:title', 'og:description', 'og:image', 'og:url', 'twitter:card', 'twitter:image']) if (!tags[k]) why.push(`no ${k}`);
    if (tags['og:image'] && !/^https:\/\/[^/]+\/s\/[A-Za-z0-9_-]{11}\.jpg$/.test(tags['og:image'])) why.push('og:image is not an absolute https URL of the picture');
    if (tags['twitter:card'] && tags['twitter:card'] !== 'summary_large_image') why.push('twitter:card is not summary_large_image');
    if (tags['og:image:width'] !== '1200' || tags['og:image:height'] !== '630') why.push('og:image size not 1200x630');
    return { ok: why.length === 0, tags, why };
}

const records = (): Any[] => {
    const f = join(DATA, 'reports.jsonl');
    return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
};
const diagFile = (id: string): Any | null => {
    const f = join(DATA, 'reports', `${id}.json`);
    return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null;
};

interface Posted { path: string; json: Any }
/** /api/** and /s/** of the page go to the local API; the POST bodies are kept as the browser sent them. */
async function routeApi(ctx: BrowserContext, posted: Posted[]): Promise<void> {
    // only the page's own origin: the scene CDN and everything else go to the network as they are
    await ctx.route((u) => (u.origin === new URL(FLY).origin || u.origin === SITE) && /^\/(api|s)\//.test(u.pathname), async (route) => {
        const req = route.request();
        const u = new URL(req.url());
        const raw = req.postDataBuffer();
        const enc = req.headers()['content-encoding'] ?? '';
        if (req.method() === 'POST' && raw && u.pathname !== '/api/e') posted.push({ path: u.pathname, json: JSON.parse((enc === 'gzip' ? gunzipSync(raw) : raw).toString('utf8')) });
        const r = await fetch(API + u.pathname + u.search, {
            method: req.method(),
            headers: { 'Content-Type': req.headers()['content-type'] ?? 'application/json', 'X-Forwarded-For': '198.51.100.1', ...(enc ? { 'Content-Encoding': enc } : {}) },
            body: req.method() === 'POST' && raw ? new Uint8Array(raw) : undefined
        });
        await route.fulfill({ status: r.status, headers: { 'content-type': r.headers.get('content-type') ?? 'application/json' }, body: Buffer.from(await r.arrayBuffer()) });
    });
}

/** Luminance spread inside the picture's middle band (between the drawn words): a frame of a scan varies, a flat picture does not. */
async function pictureStd(page: Page, dataUrl: string): Promise<number> {
    return page.evaluate(async (src) => {
        const img = new Image();
        img.src = src;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const g = c.getContext('2d')!;
        g.drawImage(img, 0, 0);
        const d = g.getImageData(200, 150, 800, 200).data;
        let s = 0, s2 = 0;
        const n = d.length / 4;
        for (let i = 0; i < d.length; i += 4) { const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; s += y; s2 += y * y; }
        return Math.sqrt(Math.max(0, s2 / n - (s / n) ** 2));
    }, dataUrl);
}

async function sendReport(page: Page, kind: 'bug' | 'idea', message: string, consent: boolean, picture: boolean): Promise<string> {
    await page.click(`[data-testid=fb-kind-${kind}]`);
    await page.fill('[data-testid=fb-message]', message);
    if (consent) await page.check('[data-testid=fb-consent]');
    if (picture) await page.check('[data-testid=fb-picture]');
    await page.click('[data-action=feedback-send]');
    await page.waitForSelector('[data-testid=fb-done-id]', { timeout: 30000 });
    return (await page.textContent('[data-testid=fb-done-id]')) ?? '';
}

try {
    // ---------------------------------------------------------------- the API and the landing
    children.push(spawn('python', [join(REPO, 'apps', 'api', 'server.py')], { env: { ...process.env, DATA_DIR: DATA, PORT: String(API_PORT), TG_BOT_TOKEN: '', TG_CHAT_ID: '', MIN_FREE_GB: '0' }, stdio: 'ignore' }));
    await until(`${API}/api/health`);
    const OUT = join(REPO, 'apps', 'site', 'out');
    if (!existsSync(join(OUT, 'en', 'index.html'))) throw new Error('apps/site/out missing: pnpm --filter @gsfpv/site build');
    children.push(spawn('python', ['-m', 'http.server', String(SITE_PORT), '--bind', '127.0.0.1', '--directory', OUT], { stdio: 'ignore' }));
    await until(`${SITE}/en/`);

    const nv = await new Promise<string>((res) => {
        const p = spawn('nvidia-smi', ['--query-gpu=memory.free', '--format=csv,noheader,nounits']);
        let s = '';
        p.stdout.on('data', (d) => { s += d; });
        p.on('close', () => res(s.trim()));
        p.on('error', () => res(''));
    });
    results.gpuFreeMiB = Number(nv.split('\n')[0]) || null;
    if (results.gpuFreeMiB !== null && results.gpuFreeMiB < 2500) throw new Error(`only ${results.gpuFreeMiB} MiB free on the GPU`);
    await gpuLock();

    const { browser, which } = await launchChrome({ headless: false, args: ['--window-position=40,40', '--window-size=1296,920'] });
    results.browser = which;
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    const posted: Posted[] = [];
    await routeApi(ctx, posted);
    const page = await ctx.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message.slice(0, 300)));
    await page.goto(`${FLY}/fly/?scene=${SCENE}&nowarn=1&input=touch`);
    const ready = await waitReady(page, 240000);
    await page.waitForTimeout(3000); // a few drawn frames of the scan
    results.flyReady = ready.status;

    // ---------------------------------------------------------------- F1 bug WITH consent: diagnostics reach the API
    await page.click('[data-action=open-feedback]');
    await page.waitForSelector('[data-testid=feedback]');
    const listed = await page.$$eval('[data-testid=fb-diag-list] li', (l) => l.length);
    const pictureDisabledBefore = await page.$eval('[data-testid=fb-picture]', (b) => (b as HTMLInputElement).disabled);
    const idWith = await sendReport(page, 'bug', 'W5 acceptance: bug with technical details', true, true);
    const sentWith = posted.filter((p) => p.path === '/api/report').at(-1)?.json ?? {};
    const recWith = records().find((r) => r.id === idWith);
    const dWith = diagFile(idWith)?.diagnostics ?? null;
    const shot = typeof dWith?.screenshot === 'string' ? Buffer.from(dWith.screenshot.replace(/^data:image\/jpeg;base64,/, ''), 'base64') : null;
    results.F1_bugWithConsent = {
        pass: /^R-\d{8}-\d{4}$/.test(idWith) && listed === 8 && pictureDisabledBefore && sentWith.diagnosticsConsent === true && !!sentWith.diagnostics
            && recWith?.diagnostics === true && recWith?.scene === SCENE && !!dWith && dWith.scene?.id === SCENE && typeof dWith.release?.sha === 'string'
            && Array.isArray(dWith.settings) && Array.isArray(dWith.errors) && typeof dWith.frames?.renderHz === 'number' && !!dWith.browser?.gpu?.api
            && (dWith.flightLog?.format === 'gsfpv-flight/2' || dWith.flightLog?.omitted === 'too long') && !!shot && jpegSize(shot)?.w === 480,
        id: idWith, itemsListed: listed, pictureBoxDisabledUntilConsent: pictureDisabledBefore,
        record: recWith, diagnosticsKeys: dWith ? Object.keys(dWith) : null, release: dWith?.release, gpu: dWith?.browser?.gpu, frames: dWith?.frames,
        settingsCount: dWith?.settings?.length, errorsCount: dWith?.errors?.length,
        flightLog: dWith?.flightLog ? { format: dWith.flightLog.format, lives: dWith.flightLog.lives?.length, records: dWith.flightLog.records, omitted: dWith.flightLog.omitted } : null,
        screenshot: shot ? { bytes: shot.length, size: jpegSize(shot) } : null, bodyBytesDiag: JSON.stringify(sentWith.diagnostics ?? {}).length
    };
    await page.click('[data-action=feedback-close]');

    // ---------------------------------------------------------------- F2 control: the same bug WITHOUT consent carries nothing
    await page.click('[data-action=open-feedback]');
    const idWithout = await sendReport(page, 'bug', 'W5 acceptance: bug without technical details', false, false);
    const sentWithout = posted.filter((p) => p.path === '/api/report').at(-1)?.json ?? {};
    const recWithout = records().find((r) => r.id === idWithout);
    results.F2_bugWithoutConsent = {
        pass: !!idWithout && idWithout !== idWith && !('diagnostics' in sentWithout) && sentWithout.diagnosticsConsent === false && recWithout?.diagnostics === false && diagFile(idWithout) === null,
        id: idWithout, sentKeys: Object.keys(sentWithout), record: recWithout, diagnosticsFile: diagFile(idWithout) !== null
    };
    await page.click('[data-action=feedback-close]');

    // ---------------------------------------------------------------- F3 Cooperation = the landing's contact form, to /api/lead
    await page.keyboard.press('KeyB');
    const openedByB = await page.isVisible('[data-testid=feedback]');
    await page.click('[data-testid=fb-kind-coop]');
    const siteEn = JSON.parse(readFileSync(join(REPO, 'packages', 'i18n', 'locales', 'site', 'en.json'), 'utf8')).contact.form;
    const coopText = await page.textContent('.panel.feedback .fb-body');
    const sameWords = [siteEn.role.label, siteEn.role.pilot, siteEn.email.label, siteEn.consent.text, siteEn.submit].every((s: string) => coopText?.includes(s));
    const disabledEmpty = await page.$eval('[data-action=feedback-lead-send]', (b) => (b as HTMLButtonElement).disabled);
    await page.click('label[for=fb-role-pilot]');
    await page.fill('#fb-lead-email', 'w5-acceptance@example.com');
    await page.check('#fb-lead-consent');
    await page.click('[data-action=feedback-lead-send]');
    await page.waitForSelector('[data-testid=fb-done]', { timeout: 30000 });
    const leads = existsSync(join(DATA, 'leads.jsonl')) ? readFileSync(join(DATA, 'leads.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
    const lead = leads.at(-1);
    results.F3_cooperation = {
        pass: openedByB && sameWords && disabledEmpty && lead?.role === 'pilot' && lead?.email === 'w5-acceptance@example.com' && lead?.scene === SCENE && lead?.suspect === false,
        openedByB, sameWordsAsLanding: sameWords, sendDisabledUntilFilled: disabledEmpty, lead: lead ? { role: lead.role, scene: lead.scene, suspect: lead.suspect } : null
    };
    await page.click('[data-action=feedback-close]');
    // control for B: a key bound to nothing opens nothing
    await page.keyboard.press('KeyJ');
    results.F3_cooperation.controlUnboundKeyOpensNothing = !(await page.isVisible('[data-testid=feedback]'));
    results.F3_cooperation.pass &&= results.F3_cooperation.controlUnboundKeyOpensNothing;

    // ---------------------------------------------------------------- F4 Share this scene: a real 1200x630 JPEG of the view
    await page.click('[data-action=pause]');
    await page.click('[data-action="pause.share"]');
    await page.waitForSelector('[data-testid=share-url]:not([hidden])', { timeout: 30000 });
    const shareUrl = await page.inputValue('[data-testid=share-url]');
    const sent = posted.filter((p) => p.path === '/api/share').at(-1)?.json ?? {};
    const jpeg = Buffer.from(String(sent.image ?? '').replace(/^data:image\/jpeg;base64,/, ''), 'base64');
    const std = sent.image ? await pictureStd(page, sent.image) : 0;
    // control: the same measure on a flat picture of the same size stays near 0, so a blank frame cannot pass
    const flat = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 1200; c.height = 630; const g = c.getContext('2d')!; g.fillStyle = '#556677'; g.fillRect(0, 0, 1200, 630); return c.toDataURL('image/jpeg', 0.88); });
    const flatStd = await pictureStd(page, flat);
    const targets = await page.$$eval('.panel.share [data-share]', (a) => a.map((x) => ({ id: (x as HTMLElement).dataset.share, href: (x as HTMLAnchorElement).href })));
    const id = shareUrl.split('/s/')[1] ?? '';
    const stored = existsSync(join(DATA, 'share', `${id}.jpg`)) ? readFileSync(join(DATA, 'share', `${id}.jpg`)) : null;
    results.F4_sharePicture = {
        pass: /\/s\/[A-Za-z0-9_-]{11}$/.test(shareUrl) && jpegSize(jpeg)?.w === 1200 && jpegSize(jpeg)?.h === 630 && std > 8 && flatStd < 2 && !!stored && stored.equals(jpeg)
            && targets.length === 6 && targets.every((t) => t.href.includes(encodeURIComponent(shareUrl))),
        shareUrl, jpeg: { bytes: jpeg.length, size: jpegSize(jpeg) }, viewStd: Math.round(std * 10) / 10, controlFlatStd: Math.round(flatStd * 10) / 10,
        storedEqualsUploaded: !!stored && stored.equals(jpeg), sent: { scene: sent.scene, title: sent.title, credit: sent.credit, locale: sent.locale }, targets: targets.map((t) => t.id)
    };
    if (sent.image) {
        const dir = join(REPO, 'evidence', new Date().toISOString().slice(0, 10));
        mkdirSync(dir, { recursive: true });
        await import('node:fs').then((fs) => fs.writeFileSync(join(dir, 'v05-share-picture.jpg'), jpeg));
    }
    await page.click('.panel.share .panel-x');

    // ---------------------------------------------------------------- F5 the share page as a link-preview crawler reads it
    const pg = await fetch(`${API}/s/${id}`);
    const og = ogCheck(pg.status, await pg.text());
    const imgPath = og.tags['og:image'] ? new URL(og.tags['og:image']).pathname : '';
    const img = Buffer.from(await (await fetch(`${API}${imgPath}`)).arrayBuffer());
    const missing = await fetch(`${API}/s/AAAAAAAAAAA`);
    const ogMissing = ogCheck(missing.status, await missing.text());
    results.F5_sharePageOg = {
        pass: og.ok && img.equals(jpeg) && !ogMissing.ok && missing.status === 404,
        tags: og.tags, why: og.why, imageServedEqualsUpload: img.equals(jpeg),
        control: { unknownIdStatus: missing.status, validatorRejects: !ogMissing.ok, why: ogMissing.why }
    };
    results.flyPageErrors = pageErrors;
    await ctx.close();
    if (haveLock) { rmdirSync(GPU_LOCK); haveLock = false; }

    // ---------------------------------------------------------------- S1-S3 the landing: Feedback on every page, share buttons, the card
    const sctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    const sposted: Posted[] = [];
    await routeApi(sctx, sposted);
    const sp = await sctx.newPage();
    const onPages: Record<string, boolean> = {};
    for (const path of ['/en/', '/pl/privacy/', '/ru/licenses/']) {
        await sp.goto(`${SITE}${path}`);
        const box = await sp.locator('[data-testid=feedback-open]').boundingBox();
        onPages[path] = !!box && box.y + box.height <= 800 && box.x >= 0;
    }
    await sp.goto(`${SITE}/en/`);
    await sp.click('[data-testid=feedback-open]');
    const dialogOpen = await sp.$eval('dialog[data-testid=feedback]', (d) => (d as HTMLDialogElement).open);
    await sp.click('label:has([data-testid=feedback-kind-bug])');
    await sp.fill('[data-testid=feedback-message]', 'W5 acceptance: landing bug with details');
    await sp.check('[data-testid=feedback-consent]');
    await sp.click('[data-testid=feedback-send]');
    await sp.waitForSelector('[data-testid=feedback-id]', { timeout: 30000 });
    const sid1 = (await sp.textContent('[data-testid=feedback-id]')) ?? '';
    const s1 = records().find((r) => r.id === sid1);
    await sp.reload();
    await sp.click('[data-testid=feedback-open]');
    await sp.click('label:has([data-testid=feedback-kind-bug])');
    await sp.fill('[data-testid=feedback-message]', 'W5 acceptance: landing bug without details');
    await sp.click('[data-testid=feedback-send]');
    await sp.waitForSelector('[data-testid=feedback-id]', { timeout: 30000 });
    const sid2 = (await sp.textContent('[data-testid=feedback-id]')) ?? '';
    const s2 = records().find((r) => r.id === sid2);
    results.S1_landingFeedback = {
        pass: Object.values(onPages).every(Boolean) && dialogOpen && s1?.page === 'site' && s1?.diagnostics === true && diagFile(sid1)?.diagnostics?.page?.path === '/en/'
            && s2?.diagnostics === false && diagFile(sid2) === null,
        visibleOn: onPages, dialogOpen, withConsent: { id: sid1, diagnostics: s1?.diagnostics }, controlWithoutConsent: { id: sid2, diagnostics: s2?.diagnostics, file: diagFile(sid2) !== null }
    };
    // Cooperation goes to the contact form
    await sp.click('[data-testid=feedback-close]').catch(() => undefined);
    await sp.goto(`${SITE}/en/`);
    await sp.click('[data-testid=feedback-open]');
    await sp.click('label:has([data-testid=feedback-kind-coop])');
    // control: the form is not in view before (the check below can fail)
    const inViewBefore = await sp.evaluate(() => { const r = document.getElementById('contact')?.getBoundingClientRect(); return !!r && r.top < innerHeight && r.bottom > 0; });
    await sp.click('[data-testid=feedback-coop]');
    // the page scrolls smoothly (globals.css): wait for the form to arrive, up to 6 s
    const atForm = await sp.waitForFunction(() => { const r = document.getElementById('contact')?.getBoundingClientRect(); return !!r && r.top < innerHeight && r.bottom > 0; }, undefined, { timeout: 6000 }).then(() => true, () => false);
    const closed = await sp.$eval('dialog[data-testid=feedback]', (d) => !(d as HTMLDialogElement).open);
    results.S2_landingCooperation = { pass: atForm && closed && !inViewBefore, contactFormInView: atForm, dialogClosed: closed, controlNotInViewBefore: !inViewBefore };

    // share buttons and the landing's own card
    const hero = await sp.$$eval('[data-testid=share-hero] [data-share]', (a) => a.map((x) => (x as HTMLAnchorElement).href));
    await sp.goto(`${SITE}/pl/`);
    const footerPl = await sp.$$eval('[data-testid=share-footer] [data-share]', (a) => a.map((x) => (x as HTMLAnchorElement).href));
    const html = readFileSync(join(OUT, 'en', 'index.html'), 'utf8');
    const ogImg = html.match(/<meta property="og:image" content="([^"]+)"/)?.[1];
    const ogJpg = readFileSync(join(OUT, 'og.jpg'));
    const enUrl = encodeURIComponent('https://gsfpv.flyreelstudio.eu/en/');
    const plUrl = encodeURIComponent('https://gsfpv.flyreelstudio.eu/pl/');
    results.S3_landingShare = {
        pass: hero.length === 6 && hero.every((h) => h.includes(enUrl)) && footerPl.length === 6 && footerPl.every((h) => h.includes(plUrl) && !h.includes(enUrl))
            && ogImg === 'https://gsfpv.flyreelstudio.eu/og.jpg' && jpegSize(ogJpg)?.w === 1200 && jpegSize(ogJpg)?.h === 630 && ogJpg.length < 300 * 1024,
        heroTargets: hero.length, footerTargetsPl: footerPl.length, controlPlLinksNameTheirOwnPage: footerPl.every((h) => !h.includes(enUrl)),
        ogImage: ogImg, ogJpg: { bytes: ogJpg.length, size: jpegSize(ogJpg) }, ogTitle: html.match(/<meta property="og:title" content="([^"]+)"/)?.[1]
    };
    await sctx.close();
    await browser.close();
} catch (e) {
    results.error = String((e as Error).stack ?? e).slice(0, 2000);
} finally {
    results.storedFiles = existsSync(DATA) ? readdirSync(DATA) : [];
    cleanup();
}

const checks = Object.entries(results).filter(([k]) => /^[FS]\d_/.test(k));
const pass = !results.error && checks.length === 8 && checks.every(([, v]) => v.pass === true);
const file = writeEvidence('v05-feedback', { pass, fly: FLY, scene: SCENE, ...results });
console.log(JSON.stringify(Object.fromEntries(checks.map(([k, v]) => [k, v.pass])), null, 1));
console.log(`${pass ? 'PASS' : 'FAIL'} -> ${file}`);
process.exit(pass ? 0 : 1);
