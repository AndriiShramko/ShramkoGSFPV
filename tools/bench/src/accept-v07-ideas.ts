// v0.7 owner's item 3, the admin side, end to end in a browser: the admin page (apps/fly/admin on the Vite
// dev server, started here) with /api/** answered by the mock of lane B's ideas API (src/ideas-mock.ts,
// the contract of docs/wip/v07-c.md). What the owner does on the kanban must reach the API as exactly
// the calls the contract names, and nothing else; every check has a negative control.
//   npx tsx src/accept-v07-ideas.ts                      (from tools/bench; FLY_PORT=5364 by default)
// No GPU needed (no drawing). Evidence: evidence/<date>/v07-ideas-admin.json + 2 PNG.
// Not covered here: lane B's real server (run accept-v06-admin.ts after the v0.7 merge for that).
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserContext, Page } from 'playwright';
import { launchChrome } from './browser';
import { REPO, today, writeEvidence } from './evidence';
import { IdeasMock } from './ideas-mock';

const PORT = Number(process.env.FLY_PORT ?? 5364);
const FLY = `http://127.0.0.1:${PORT}`;
const checks: { name: string; ok: boolean; control: boolean }[] = [];
const results: Record<string, unknown> = {};
const children: ChildProcess[] = [];
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function check(name: string, ok: boolean, control = false): void {
    checks.push({ name, ok, control });
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${control ? '[control] ' : ''}${name}`);
}

async function until(url: string, ms = 60000): Promise<void> {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
        try { if ((await fetch(url)).status < 500) return; } catch { /* not up yet */ }
        await sleep(300);
    }
    throw new Error(`${url} did not come up`);
}

/** Every /api/** request of the page goes to the mock (nothing leaves this machine). */
async function routeApi(ctx: BrowserContext, mock: IdeasMock): Promise<void> {
    await ctx.route((u) => u.pathname.startsWith('/api/'), async (route) => {
        const req = route.request();
        const u = new URL(req.url());
        const h = await req.allHeaders();
        const raw = req.postData();
        const a = u.pathname.startsWith('/api/admin/')
            ? mock.handle(req.method(), u.pathname.slice('/api/admin/'.length), h, raw ? JSON.parse(raw) : null)
            : { status: 404, json: { ok: false } };
        await route.fulfill({ status: a.status, headers: { 'content-type': 'application/json', ...(a.headers ?? {}) }, body: JSON.stringify(a.json) });
    });
}

const card = (id: string): string => `[data-idea="${id}"]`;
const statusOf = (page: Page, id: string): Promise<string | null> => page.$eval(card(id), (e) => e.getAttribute('data-status')).catch(() => null);
const counts = (page: Page): Promise<Record<string, string>> =>
    page.$$eval('[data-count]', (els) => Object.fromEntries(els.map((e) => [e.getAttribute('data-count') ?? '', e.textContent ?? ''])));
/** wait until the mock has seen n POSTs to ideas routes */
async function posts(mock: IdeasMock, n: number, ms = 10000): Promise<void> {
    const t0 = Date.now();
    while (mock.posts().length < n) {
        if (Date.now() - t0 > ms) throw new Error(`waited for ${n} ideas calls, saw ${mock.posts().length}`);
        await sleep(50);
    }
}
/** wait until the card sits in that column and is no longer busy */
const settled = (page: Page, id: string, status: string): Promise<unknown> =>
    page.waitForSelector(`${card(id)}[data-status="${status}"]:not([aria-busy])`, { timeout: 10000 });

async function main(): Promise<void> {
    const dir = join(REPO, 'evidence', today());
    mkdirSync(dir, { recursive: true });
    const vite = spawn(process.execPath, [join(REPO, 'apps', 'fly', 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
        { cwd: join(REPO, 'apps', 'fly'), stdio: 'ignore' });
    children.push(vite);
    await until(`${FLY}/fly/admin/`);

    const mock = new IdeasMock();
    const { browser, which } = await launchChrome({ headless: true });
    results.browser = which;
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
    await routeApi(ctx, mock);
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)));
    page.on('dialog', (d) => void d.dismiss());

    await page.goto(`${FLY}/fly/admin/`);
    await page.waitForSelector('[data-tab=ideas]');
    await page.click('[data-tab=ideas]');
    await page.waitForSelector('[data-testid=idea-board] [data-idea]');
    const c0 = await counts(page);
    results.countsAtStart = c0;
    check('five columns with their counts (New 2, Accepted 1, In progress 2, Done 1, Rejected 1)', JSON.stringify(c0) === JSON.stringify({ new: '2', accepted: '1', in_progress: '2', done: '1', rejected: '1' }));
    check('the record with an unknown status is counted, not placed', (await page.textContent('[data-testid=idea-unreadable]'))?.includes('1') === true && !(await page.$(card('X-unknown-status'))));
    check('the old Reports tab is gone', !(await page.$('[data-tab=reports]')));

    // drag New -> Accepted: exactly one status call with the right body
    let before = mock.posts().length;
    await page.dragAndDrop(card('R-20261006-0001'), '[data-column=accepted]');
    await settled(page, 'R-20261006-0001', 'accepted');
    const drag = mock.posts().slice(before);
    results.dragCalls = drag;
    check('drag to Accepted sends one POST ideas/status {id, status: accepted}', JSON.stringify(drag) === JSON.stringify([{ method: 'POST', path: 'ideas/status', body: { id: 'R-20261006-0001', status: 'accepted' } }]));
    before = mock.posts().length;
    await page.dragAndDrop(card('R-20261006-0001'), '[data-column=accepted]');
    await sleep(400);
    check('drop on its own column sends nothing', mock.posts().length === before, true);

    // keyboard: the handle and the arrow keys; at the left edge nothing moves
    await page.focus(`${card('R-20261008-0003')} .handle`);
    before = mock.posts().length;
    await page.keyboard.press('ArrowLeft');
    await sleep(300);
    check('ArrowLeft in New sends nothing (edge)', mock.posts().length === before, true);
    await page.keyboard.press('ArrowRight');
    await settled(page, 'R-20261008-0003', 'accepted');
    check('ArrowRight on the handle moves the card to the next column', JSON.stringify(mock.posts().slice(before)) === JSON.stringify([{ method: 'POST', path: 'ideas/status', body: { id: 'R-20261008-0003', status: 'accepted' } }]));
    check('the focus stays on the moved card\'s handle', await page.evaluate(() => document.activeElement?.closest('[data-idea]')?.getAttribute('data-idea') === 'R-20261008-0003' && document.activeElement.classList.contains('handle')));

    // a pilot's idea with an e-mail reaches Done: the draft opens, nothing is sent until Send
    await page.focus(`${card('R-20261012-0005')} .handle`);
    before = mock.posts().length;
    await page.keyboard.press('ArrowRight');
    await page.waitForSelector('[data-testid=thanks-dialog] [data-field=thanks-body]');
    await page.waitForFunction(() => (document.querySelector('[data-field=thanks-body]') as HTMLTextAreaElement | null)?.value.length);
    const afterDone = mock.posts().slice(before).map((c) => c.path);
    results.doneCalls = afterDone;
    check('Done opens the thank-you draft (status, then thanks/draft) and sends nothing', JSON.stringify(afterDone) === JSON.stringify(['ideas/status', 'ideas/thanks/draft']));
    check('the draft is addressed to the pilot\'s e-mail', (await page.inputValue('[data-field=thanks-to]')) === 'pilot.two@example.com');
    await page.click('[data-action=thanks-later]');
    await page.waitForSelector('[data-testid=thanks-dialog]', { state: 'detached' });
    check('Not now sends nothing', !mock.posts().some((c) => c.path === 'ideas/thanks/send') && (mock.ideas.find((i) => i.id === 'R-20261012-0005')!.mails as unknown[]).length === 0, true);
    await page.click(`${card('R-20261012-0005')} [data-action=thanks]`);
    await page.waitForFunction(() => (document.querySelector('[data-field=thanks-body]') as HTMLTextAreaElement | null)?.value.length);
    await page.fill('[data-field=thanks-subject]', 'Channel functions are in the simulator');
    before = mock.posts().length;
    await page.click('[data-action=thanks-send]');
    await page.waitForSelector('[data-testid=thanks-dialog]', { state: 'detached' });
    const sent = mock.posts().slice(before);
    check('Send sends the thank-you once, with the subject as edited', sent.length === 1 && sent[0].path === 'ideas/thanks/send' && sent[0].body?.subject === 'Channel functions are in the simulator');
    check('after it the card no longer offers a thank-you', !(await page.$(`${card('R-20261012-0005')} [data-action=thanks]`)));

    // a failing server: the card stays where it was and the owner is told
    mock.failNext = { path: 'ideas/status', status: 500 };
    await page.focus(`${card('N-20261010-0001')} .handle`);
    await page.keyboard.press('ArrowRight');
    await page.waitForSelector('.note.bad');
    check('a refused move leaves the card in its column and says why', (await statusOf(page, 'N-20261010-0001')) === 'in_progress' && /test-failure/.test((await page.textContent('.note')) ?? ''), true);

    // filters and search
    await page.fill('[data-testid=idea-search]', 'crosshair centre');
    await sleep(100);
    const found = await page.$$eval('[data-idea]', (els) => els.map((e) => e.getAttribute('data-idea')));
    check('search keeps only the card with every word', JSON.stringify(found) === JSON.stringify(['R-20261006-0002']));
    await page.fill('[data-testid=idea-search]', 'crosshair motor');
    await sleep(100);
    check('a word found nowhere empties the board', (await page.$$('[data-idea]')).length === 0, true);
    await page.fill('[data-testid=idea-search]', '');
    await page.click('[data-kind=feature]');
    await page.click('[data-kind=note]');
    await page.click('[data-kind=idea]');
    await sleep(100);
    const bugs = await page.$$eval('[data-idea]', (els) => els.map((e) => e.getAttribute('data-idea')));
    check('kind toggles: only bugs left', JSON.stringify(bugs) === JSON.stringify(['R-20261008-0003']));
    for (const k of ['feature', 'note', 'idea']) await page.click(`[data-kind=${k}]`);
    await page.selectOption('[data-filter=contact]', 'no');
    await sleep(100);
    const noContact = (await page.$$eval('[data-idea]', (els) => els.map((e) => e.getAttribute('data-idea')))).sort();
    check('contact filter: the cards without a contact', JSON.stringify(noContact) === JSON.stringify(['F-edgetx-radio-over-usb-webhid-in-chrome', 'N-20261010-0001', 'R-20261008-0003']));
    await page.selectOption('[data-filter=contact]', 'any');

    // the bug's card: everything the pilot sent, technical details to open and to download
    await page.click(`${card('R-20261008-0003')} [data-action=details]`);
    const href = await page.getAttribute(`${card('R-20261008-0003')} [data-action=diagnostics]`, 'href');
    const diag = await page.evaluate(async (u) => { const r = await fetch(u!); return { status: r.status, id: (await r.json()).id }; }, href);
    check('technical details open from the card (the stored JSON)', href === '/api/admin/reports/R-20261008-0003/diagnostics' && diag.status === 200 && diag.id === 'R-20261008-0003');
    const [download] = await Promise.all([page.waitForEvent('download'), page.click(`${card('R-20261008-0003')} [data-action=download]`)]);
    check('technical details download as R-20261008-0003.json', download.suggestedFilename() === 'R-20261008-0003.json');
    const sentFields = (await page.textContent(`${card('R-20261008-0003')} .idea-sent`)) ?? '';
    check('the card shows what the pilot sent (language, page, scene, release)', ['en', 'fly', '887f27aa', 'f92d98b'].every((x) => sentFields.includes(x)));
    check('no e-mail left: no reply box, a reason instead', !(await page.$(`${card('R-20261008-0003')} [data-field=reply-text]`)) && !!(await page.$(`${card('R-20261008-0003')} [data-field=reply] p`)), true);

    // a card with a contact: reply, comment, urgency, public title, the Column select
    const id2 = 'R-20261006-0002';
    await page.click(`${card(id2)} [data-action=details]`);
    check('the contact itself is on the card', ((await page.textContent(`${card(id2)} [data-field=contact]`)) ?? '').includes('pilot.one@example.com or @pilotone on Telegram'));
    before = mock.posts().length;
    await page.fill(`${card(id2)} [data-field=reply-text]`, 'Thanks! It is queued for the next build.');
    await page.click(`${card(id2)} [data-action=reply]`);
    await posts(mock, before + 1);
    await page.waitForSelector(`${card(id2)}:not([aria-busy]) [data-field=comment]`);
    await page.fill(`${card(id2)} [data-field=comment]`, 'With the HUD work');
    await page.click(`${card(id2)} [data-action=comment]`);
    await posts(mock, before + 2);
    await page.waitForSelector(`${card(id2)}:not([aria-busy]) [data-field=urgency]`);
    await page.selectOption(`${card(id2)} [data-field=urgency]`, 'urgent');
    await page.waitForSelector(`${card(id2)}:not([aria-busy]) [data-chip=urgency].u-urgent`);
    await page.fill(`${card(id2)} [data-field=title-pl]`, 'Celownik na srodku obrazu');
    await page.selectOption(`${card(id2)} [data-field=group]`, 'controls');
    await page.click(`${card(id2)} [data-action=save-public]`);
    await posts(mock, before + 4);
    await page.waitForSelector(`${card(id2)}:not([aria-busy])`);
    const edits = mock.posts().slice(before).map((c) => [c.path, c.body]);
    results.cardCalls = edits;
    check('reply, comment, urgency and public title each send their own call with their body', JSON.stringify(edits) === JSON.stringify([
        ['ideas/reply', { id: id2, text: 'Thanks! It is queued for the next build.' }],
        ['ideas/comment', { id: id2, text: 'With the HUD work' }],
        ['ideas/urgency', { id: id2, urgency: 'urgent' }],
        ['ideas/public', { id: id2, title: { en: 'A crosshair in the centre of the view', pl: 'Celownik na srodku obrazu' }, roadmap: true, group: 'controls' }]
    ]));
    await page.selectOption(`${card(id2)} [data-field=status]`, 'in_progress');
    await settled(page, id2, 'in_progress');
    check('the Column select moves the card (touch)', mock.posts().at(-1)?.path === 'ideas/status' && mock.posts().at(-1)?.body?.status === 'in_progress');

    // the landing switch needs an English title (control: the box is disabled without one)
    await page.click(`${card('R-20261006-0001')} [data-action=details]`);
    check('without an English title the landing switch is off and disabled', await page.$eval(`${card('R-20261006-0001')} [data-field=roadmap]`, (e) => (e as HTMLInputElement).disabled && !(e as HTMLInputElement).checked), true);
    await page.fill(`${card('R-20261006-0001')} [data-field=title-en]`, 'Rates types with manual editing');
    check('with it the switch can be ticked', await page.$eval(`${card('R-20261006-0001')} [data-field=roadmap]`, (e) => !(e as HTMLInputElement).disabled));

    await page.screenshot({ path: join(dir, 'v07-ideas-admin-1280.png'), fullPage: false });
    // a phone: one column, nothing wider than the screen
    await page.setViewportSize({ width: 375, height: 800 });
    await sleep(300);
    const wide = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    check('at 375 px the board is one column with no sideways scroll', wide <= 0);
    await page.screenshot({ path: join(dir, 'v07-ideas-admin-375.png'), fullPage: false });

    // the Scenes tab still opens
    await page.click('[data-tab=scenes]');
    await page.waitForSelector('[data-testid=scene-list]');
    check('the Scenes tab still opens', true);
    check('no page errors', errors.length === 0);
    results.pageErrors = errors;
    results.calls = mock.calls.map((c) => `${c.method} ${c.path}`);
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
const file = writeEvidence('v07-ideas-admin', { pass, fly: FLY, error: failed ? String(failed) : null, checks, ...results });
console.log(`${pass ? 'PASS' : 'FAIL'} ${file}`);
process.exit(pass ? 0 : 1);
