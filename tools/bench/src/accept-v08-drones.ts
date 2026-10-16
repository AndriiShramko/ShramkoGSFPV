// v0.8 lane D acceptance (docs/wip/v08-d.md) on a release served locally: the three new drones fly in the
// app (the model's measured thrust-to-weight, prop wash present; the default whoop has none), the drone
// picker and the settings screen offer "help us tune this drone", the Drone physics form sends a report the
// real API stores (drone, log link, Betaflight text and the pilot's settings in the technical-details file,
// the idea's text naming the drone), and the landing's deep link /{lang}/fly/?drone=<id>&open=tune opens it.
// The API (apps/api/server.py) is started here on a temporary DATA_DIR without Telegram; the page's /api/**
// is routed to it. Every check has a negative control that must fire.
//   node scripts/build-release.mjs && node tools/bench/scripts/serve-csp.mjs dist <port>     (another shell)
//   cd tools/bench && SITE=http://localhost:<port> npx tsx src/accept-v08-drones.ts
// Logic-only pages (?render=off): the scan is never downloaded or drawn, so no GPU lock is needed.
// Evidence: evidence/<date>/v08-drones.json.
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { Page } from 'playwright';
import { launch, waitReady } from './browser';
import { REPO, writeEvidence } from './evidence';

if (!process.env.SITE) throw new Error('accept-v08-drones needs SITE=http://localhost:<port> (a local release; never the live site)');
const SITE = process.env.SITE.replace(/\/$/, '');
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(SITE)) throw new Error(`SITE must be a local release, got ${SITE}`);
console.log(`accept-v08-drones target: ${SITE}`);
const SCENE = '39e63ce9';
const NEW = ['nazgulf5v3-6s', 'machr5sport-6s', 'taurusx8-komodo-6s'] as const;
const API_PORT = 8000 + Math.floor(Math.random() * 900);
const API = `http://127.0.0.1:${API_PORT}`;
const DATA = mkdtempSync(join(tmpdir(), 'gsfpv-v08d-api-'));
const DIFF = '# diff all\n# version\n# Betaflight / STM32F7X2 (S7X2) 4.5.1\nprofile 0\nset p_roll = 52\nrateprofile 0\nset roll_srate = 80\n';
const LOG = 'https://drive.example.com/file/d/v08d/view';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const results: Record<string, Any> = {};
const children: ChildProcess[] = [];
const cb = () => `cb=${Math.random().toString(36).slice(2)}`;
const fly = (qs: string) => `${SITE}/en/fly/?scene=${SCENE}&nowarn=1&input=touch&render=off&${qs}&${cb()}`;

function cleanup(): void {
    for (const c of children) try { c.kill(); } catch { /* gone */ }
    try { rmSync(DATA, { recursive: true, force: true }); } catch { /* a file still open */ }
}
process.on('SIGINT', () => { cleanup(); process.exit(130); });

async function until(url: string, ms = 20000): Promise<void> {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
        try { if ((await fetch(url)).status < 500) return; } catch { /* not up yet */ }
        await sleep(250);
    }
    throw new Error(`${url} did not come up`);
}

const records = (): Any[] => {
    const f = join(DATA, 'reports.jsonl');
    return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
};
const tuneFile = (id: string): Any | null => {
    const f = join(DATA, 'reports', `${id}.json`);
    return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')).diagnostics?.tune ?? null : null;
};
const ideaText = (id: string): string => {
    const f = join(DATA, 'ideas.json');
    if (!existsSync(f)) return '';
    return (JSON.parse(readFileSync(f, 'utf8')).ideas as Any[]).find((r) => r.id === id)?.text ?? '';
};

async function hookEval<T>(page: Page, fn: string): Promise<T> {
    return page.evaluate(`(() => { const h = window.__gsfpv; const s = h.session; ${fn} })()`) as Promise<T>;
}

async function open(page: Page, qs: string): Promise<void> {
    await page.goto(fly(qs));
    const h = await waitReady(page, 180000);
    if (h.status !== 'ready') throw new Error(`page not ready: ${JSON.stringify(h)}`);
}

async function openPicker(page: Page): Promise<void> {
    await page.keyboard.press('KeyP');
    await page.click('[data-action="pause.drone"]');
    await page.waitForSelector('.screen.drones');
}

const posted: { path: string; json: Any }[] = [];

try {
    children.push(spawn('python', [join(REPO, 'apps', 'api', 'server.py')], { env: { ...process.env, DATA_DIR: DATA, PORT: String(API_PORT), TG_BOT_TOKEN: '', TG_CHAT_ID: '', MIN_FREE_GB: '0' }, stdio: 'ignore' }));
    await until(`${API}/api/health`);
    const L = await launch();
    const { browser, context, page } = L;
    // the page's /api/** goes to the local API; the POST bodies are kept as the browser sent them
    await context.route((u) => u.origin === new URL(SITE).origin && u.pathname.startsWith('/api/'), async (route) => {
        const req = route.request();
        const u = new URL(req.url());
        const raw = req.postDataBuffer();
        const enc = req.headers()['content-encoding'] ?? '';
        if (req.method() === 'POST' && raw && u.pathname === '/api/report') posted.push({ path: u.pathname, json: JSON.parse((enc === 'gzip' ? gunzipSync(raw) : raw).toString('utf8')) });
        const r = await fetch(API + u.pathname + u.search, {
            method: req.method(),
            headers: { 'Content-Type': req.headers()['content-type'] ?? 'application/json', 'X-Forwarded-For': '198.51.100.8', ...(enc ? { 'Content-Encoding': enc } : {}) },
            body: req.method() === 'POST' && raw ? new Uint8Array(raw) : undefined
        });
        await route.fulfill({ status: r.status, headers: { 'content-type': r.headers.get('content-type') ?? 'application/json' }, body: Buffer.from(await r.arrayBuffer()) });
    });

    // ---------------------------------------------------------------- D1 the new drones fly in the app
    {
        const rows: Any[] = [];
        for (const id of [...NEW, 'pavo20pro-3s']) {
            await open(page, `drone=${id}`);
            rows.push(await hookEval(page, 'return { preset: s.presetId, twr: s.params.twr, measured: s.measureTwr(), wakeLoss: s.params.wakeLoss, tauMs: s.params.tau * 1000, massKg: s.params.mass };'));
        }
        const fresh = rows.slice(0, 3), pavo = rows[3];
        const ok = fresh.every((r, i) => r.preset === NEW[i] && Math.abs(r.measured / r.twr - 1) <= 0.05 && r.wakeLoss > 0);
        // control: the default whoop has no prop wash, and the three differ from it and from each other
        const control = pavo.preset === 'pavo20pro-3s' && pavo.wakeLoss === 0 && new Set(rows.map((r) => r.twr)).size === 4;
        results.D1 = { pass: ok && control, rows, control: { pavoWake: pavo.wakeLoss, distinctTwr: new Set(rows.map((r) => r.twr)).size, fired: control } };
        console.log('D1', results.D1.pass, JSON.stringify(rows));
    }

    // ---------------------------------------------------------------- D2 the picker offers help-us-tune, the form opens on that drone
    {
        await open(page, 'drone=pavo20pro-3s');
        const before = await page.locator('[data-action="drone-tune"]').count();
        await openPicker(page);
        const cards = await page.locator('.drone-card').count();
        const tuneButtons = await page.locator('.drone-card [data-action="drone-tune"]').count();
        const note = await page.locator('[data-testid="drone-tune"]').isVisible();
        await page.click('.drone-card[data-preset="machr5sport-6s"] [data-action="drone-tune"]');
        await page.waitForSelector('[data-testid="feedback"]');
        const form = {
            pickerGone: (await page.locator('.screen.drones').count()) === 0,
            kindChecked: await page.getAttribute('[data-testid="fb-kind-drone"]', 'aria-checked'),
            drone: await page.inputValue('[data-testid="fb-drone"]')
        };
        const pass = before === 0 && cards === 9 && tuneButtons === cards && note && form.pickerGone && form.kindChecked === 'true' && form.drone === 'machr5sport-6s';
        results.D2 = { pass, cards, tuneButtons, note, form, control: { tuneButtonsBeforeThePicker: before, fired: before === 0 } };
        console.log('D2', pass, JSON.stringify(results.D2));
    }

    // ---------------------------------------------------------------- D3 the form sends a report the API stores (bad link refused first)
    {
        await page.fill('[data-testid="fb-message"]', 'Hover throttle feels lower than on my real one [v08-d acceptance]');
        await page.fill('[data-testid="fb-betaflight"]', DIFF);
        await page.fill('[data-testid="fb-log"]', 'ftp://example.com/log.bbl');
        const n0 = posted.length;
        await page.click('[data-testid="fb-drone-form"] [data-action="feedback-send"]');
        await sleep(500);
        const badText = await page.textContent('[data-testid="fb-drone-form"] [data-testid="fb-status"]');
        const refused = posted.length === n0 && /https:\/\//.test(badText ?? '');
        await page.fill('[data-testid="fb-log"]', LOG);
        await page.click('[data-testid="fb-drone-form"] [data-action="feedback-send"]');
        await page.waitForSelector('[data-testid="fb-done"]', { timeout: 20000 });
        const id = (await page.textContent('[data-testid="fb-done-id"]'))?.trim() ?? '';
        const rec = records().find((r) => r.id === id) ?? null;
        const tune = tuneFile(id);
        const body = posted[posted.length - 1]?.json ?? null;
        const text = ideaText(id);
        const pass = refused && !!rec && rec.kind === 'drone' && rec.drone === 'machr5sport-6s' && rec.logUrl === LOG && !!tune && tune.betaflight === DIFF.trim()
            && !!tune.settings && typeof tune.settings.flightMode === 'string' && body?.kind === 'drone' && text.startsWith(`Drone physics: machr5sport-6s\nBlackbox log: ${LOG}`);
        results.D3 = { pass, id, record: rec, tuneKeys: tune ? Object.keys(tune) : null, settings: tune?.settings ?? null, ideaHead: text.split('\n').slice(0, 3), control: { badLinkRefusedBeforeSending: refused, status: badText } };
        console.log('D3', pass, id);
        await page.click('[data-action="feedback-close"]');
    }

    // ---------------------------------------------------------------- D4 the landing's deep link opens the form once, on its drone
    {
        await open(page, 'drone=taurusx8-komodo-6s&open=tune');
        await page.waitForSelector('[data-testid="feedback"]', { timeout: 10000 });
        const drone = await page.inputValue('[data-testid="fb-drone"]');
        const flown = await hookEval<string>(page, 'return s.presetId;');
        await page.click('[data-testid="feedback"] .panel-x');
        await sleep(300);
        const urlAfter = page.url();
        // control: the same link without open=tune opens no form
        await open(page, 'drone=taurusx8-komodo-6s');
        await sleep(1500);
        const without = await page.locator('[data-testid="feedback"]').count();
        const pass = drone === 'taurusx8-komodo-6s' && flown === 'taurusx8-komodo-6s' && !urlAfter.includes('open=tune') && without === 0;
        results.D4 = { pass, drone, flown, urlAfterHasOpen: urlAfter.includes('open=tune'), control: { formsWithoutTheParameter: without, fired: without === 0 } };
        console.log('D4', pass, JSON.stringify(results.D4));
    }

    // ---------------------------------------------------------------- D5 the settings screen: the row under Drone and the prop wash setting
    {
        await page.keyboard.press('KeyO');
        // the screen opens on its first group: the rail's Drone & physics shows the drone's rows
        await page.click('.set-rail-btn[data-group="drone"]');
        await page.waitForSelector('[data-testid="settings-tune-row"]', { timeout: 10000 });
        const propWash = await page.locator('[data-testid="setting-physics.propWash"]').count();
        await page.click('[data-testid="settings-drone-tune"]');
        await page.waitForSelector('[data-testid="feedback"]');
        const settingsGone = (await page.locator('[data-testid="settings-tune-row"]').count()) === 0;
        const drone = await page.inputValue('[data-testid="fb-drone"]');
        const flown = await hookEval<string>(page, 'return s.presetId;');
        await page.click('[data-testid="feedback"] .panel-x');
        // "Ask for another drone": the form on a new drone, nothing of a preset to send
        await openPicker(page);
        await page.click('[data-action="drone-ask"]');
        await page.waitForSelector('[data-testid="feedback"]');
        const askDrone = await page.inputValue('[data-testid="fb-drone"]');
        const settingsBoxDisabled = await page.isDisabled('[data-testid="fb-settings"]');
        // control: on a preset the same box is enabled
        await page.selectOption('[data-testid="fb-drone"]', 'nazgulf5v3-6s');
        const enabledOnPreset = !(await page.isDisabled('[data-testid="fb-settings"]'));
        const pass = propWash === 1 && settingsGone && drone === flown && askDrone === 'new' && settingsBoxDisabled && enabledOnPreset;
        results.D5 = { pass, propWashRow: propWash, settingsGone, drone, flown, askDrone, settingsBoxDisabled, control: { enabledOnPreset, fired: enabledOnPreset } };
        console.log('D5', pass, JSON.stringify(results.D5));
    }

    results.console = L.console.filter((l) => /error/i.test(l)).slice(0, 20);
    await browser.close();
} catch (e) {
    results.error = String((e as Error).stack ?? e);
    console.error(e);
} finally {
    cleanup();
}

const pass = ['D1', 'D2', 'D3', 'D4', 'D5'].every((k) => results[k]?.pass === true) && !results.error;
const file = writeEvidence('v08-drones', { pass, site: SITE, scene: SCENE, ...results });
console.log(`accept-v08-drones: ${pass ? 'PASS' : 'FAIL'} -> ${file}`);
process.exit(pass ? 0 : 1);
