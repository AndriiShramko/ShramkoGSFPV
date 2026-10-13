// v0.7 owner's item 3, the admin side, end to end in a browser: the admin page (apps/fly/admin on the Vite
// dev server, started here) with /api/** answered by the mock of lane B's ideas API (src/ideas-mock.ts,
// the contract of docs/wip/v07-b.md "Contracts for lane C"). What the owner does on the kanban must reach
// the API as exactly the calls the contract names, and nothing else: above all, no e-mail is queued
// without the owner's own Send (the thank-you) or reply button, a sent text leaves its box (a second click
// sends nothing), a refused one stays, the owner is told what the server did with an e-mail (Gmail off:
// saved, not queued) and a thank-you is never written twice. Every check has a negative control.
//   npx tsx src/accept-v07-ideas.ts                      (from tools/bench; FLY_PORT=5364 by default)
// Draws nothing heavy, but holds the shared GPU lock like every browser run on this PC (the caller takes
// it). Evidence: evidence/<date>/v07-ideas-admin.json + 2 PNG.
// Not covered here: lane B's real server (accept-v06-admin.ts drives the Ideas tab against it after the merge).
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

/** JSON with object keys sorted, so a body is compared by its content, not by the order it was built in. */
function canon(v: unknown): string {
    const sort = (x: unknown): unknown => (Array.isArray(x) ? x.map(sort)
        : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, y]) => [k, sort(y)])) : x);
    return JSON.stringify(sort(v));
}
const same = (a: unknown, b: unknown): boolean => canon(a) === canon(b);

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
const ids = (page: Page): Promise<(string | null)[]> => page.$$eval('[data-idea]', (els) => els.map((e) => e.getAttribute('data-idea')));
/** POSTs to ideas routes since `from`, as [path, body] */
const sentSince = (mock: IdeasMock, from: number): [string, unknown][] => mock.posts().slice(from).map((c) => [c.path, c.body]);
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
const quiet = (page: Page, id: string): Promise<unknown> => page.waitForSelector(`${card(id)}:not([aria-busy])`, { timeout: 10000 });
/** the thank-you e-mails of one idea in the mock's store */
const doneMails = (mock: IdeasMock, id: string): { id: string; state: string }[] =>
    (mock.ideas.find((x) => x.id === id)?.thread as { id: string; kind: string; state: string }[]).filter((m) => m.kind === 'done');
const dialogStep = (page: Page): Promise<string | null> =>
    page.evaluate(() => document.querySelector('[data-testid=thanks-dialog] [data-step]:not([hidden])')?.getAttribute('data-step') ?? null);

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
    check('five columns with their counts (New 2, Accepted 1, In progress 2, Done 1, Rejected 1)', same(c0, { new: '2', accepted: '1', in_progress: '2', done: '1', rejected: '1' }));
    check('the record with an unknown status is counted, not placed', (await page.textContent('[data-testid=idea-unreadable]'))?.includes('1') === true && !(await page.$(card('R-20261012-0006'))), true);
    check('the old Reports tab is gone', !(await page.$('[data-tab=reports]')));
    check('the mail setup line names the sender', ((await page.textContent('[data-testid=idea-setup]')) ?? '').includes('owner@example.com'));

    // drag New -> Accepted: exactly one update call with the right body
    let before = mock.posts().length;
    await page.dragAndDrop(card('R-20261006-0001'), '[data-column=accepted]');
    await settled(page, 'R-20261006-0001', 'accepted');
    results.dragCalls = sentSince(mock, before);
    check('drag to Accepted sends one POST ideas/update {id, status: accepted}', same(sentSince(mock, before), [['ideas/update', { id: 'R-20261006-0001', status: 'accepted' }]]));
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
    check('ArrowRight on the handle moves the card to the next column', same(sentSince(mock, before), [['ideas/update', { id: 'R-20261008-0003', status: 'accepted' }]]));
    check('the focus stays on the moved card\'s handle', await page.evaluate(() => document.activeElement?.closest('[data-idea]')?.getAttribute('data-idea') === 'R-20261008-0003' && document.activeElement.classList.contains('handle')));

    // a pilot's idea with an e-mail reaches Done: the dialog asks what was done; nothing is sent until Send
    const pid = 'R-20261012-0005';
    await page.focus(`${card(pid)} .handle`);
    before = mock.posts().length;
    await page.keyboard.press('ArrowRight');
    await page.waitForSelector('[data-testid=thanks-dialog] [data-field=thanks-summary]');
    await settled(page, pid, 'done');
    check('Done opens the thank-you dialog at "what was done", after one status call and no e-mail', (await dialogStep(page)) === 'summary'
        && same(sentSince(mock, before), [['ideas/update', { id: pid, status: 'done' }]]) && mock.mails().length === 0);
    before = mock.posts().length;
    await page.click('[data-action=thanks-make]');
    await sleep(300);
    check('"Make the e-mail" with nothing written sends nothing', mock.posts().length === before, true);
    await page.fill('[data-field=thanks-summary]', 'Funkcje kanalow radia sa juz w symulatorze: ARM i tryb na CH5 i CH6.');
    await page.click('[data-action=thanks-make]');
    await page.waitForFunction(() => (document.querySelector('[data-field=thanks-body]') as HTMLTextAreaElement | null)?.value.length);
    results.doneCalls = sentSince(mock, before);
    check('the summary goes in the pilot\'s language to ideas/done, and the server\'s draft is shown', (await dialogStep(page)) === 'draft'
        && same(sentSince(mock, before), [['ideas/done', { id: pid, summary: { pl: 'Funkcje kanalow radia sa juz w symulatorze: ARM i tryb na CH5 i CH6.' } }]])
        && (await page.inputValue('[data-field=thanks-body]')).includes('Funkcje kanalow radia'));
    check('the draft is addressed to the pilot\'s e-mail', (await page.inputValue('[data-field=thanks-to]')) === 'pilot.two@example.com');
    check('the draft is only a draft (nothing queued)', same(mock.mails().map((m) => m.state), ['draft']), true);
    const pidDraft = mock.mails('draft')[0]?.id;
    before = mock.posts().length;
    await page.click('[data-action=thanks-later]');
    await page.waitForSelector('[data-testid=thanks-dialog]', { state: 'detached' });
    check('Not now sends nothing and leaves the draft a draft', mock.posts().length === before && same(mock.mails().map((m) => m.state), ['draft']), true);
    await page.click(`${card(pid)} [data-action=thanks]`);
    await page.waitForSelector('[data-testid=thanks-dialog] [data-step=draft]:not([hidden])');
    check('the card reopens the waiting draft without a call', mock.posts().length === before && (await page.inputValue('[data-field=thanks-to]')) === 'pilot.two@example.com');
    await page.click('[data-action=thanks-send]');
    await page.waitForSelector('[data-testid=thanks-dialog]', { state: 'detached' });
    await quiet(page, pid);
    results.sendCalls = sentSince(mock, before);
    check('Send queues the thank-you once (ideas/send-done {id, mail: the draft read})', same(sentSince(mock, before), [['ideas/send-done', { id: pid, mail: pidDraft }]]) && same(mock.mails().map((m) => m.state), ['queued']));
    const queuedNote = (await page.textContent('.note')) ?? '';
    check('the owner is told the thank-you is queued and when it goes', queuedNote.includes('pilot.two@example.com') && queuedNote.includes('60 s'));
    check('after it the card no longer offers a thank-you', !(await page.$(`${card(pid)} [data-action=thanks]`)));

    // a failing server: the card stays where it was and the owner is told; then a note without an e-mail
    // reaches Done without any thank-you dialog
    mock.failNext = { path: 'ideas/update', status: 500 };
    await page.focus(`${card('N-20261010-0001')} .handle`);
    await page.keyboard.press('ArrowRight');
    await page.waitForSelector('.note.bad');
    check('a refused move leaves the card in its column and says why', (await statusOf(page, 'N-20261010-0001')) === 'in_progress' && /test-failure/.test((await page.textContent('.note')) ?? ''), true);
    await page.focus(`${card('N-20261010-0001')} .handle`);
    await page.keyboard.press('ArrowRight');
    await settled(page, 'N-20261010-0001', 'done');
    await sleep(300);
    check('Done for a note without an e-mail opens no thank-you dialog', !(await page.$('[data-testid=thanks-dialog]')), true);

    // filters and search
    await page.fill('[data-testid=idea-search]', 'crosshair centre');
    await sleep(100);
    check('search keeps only the card with every word', same(await ids(page), ['R-20261006-0002']));
    await page.fill('[data-testid=idea-search]', 'crosshair motor');
    await sleep(100);
    check('a word found nowhere empties the board', (await page.$$('[data-idea]')).length === 0, true);
    await page.fill('[data-testid=idea-search]', '');
    for (const k of ['feature', 'note', 'idea']) await page.click(`[data-kind=${k}]`);
    await sleep(100);
    check('kind toggles: only bugs left', same(await ids(page), ['R-20261008-0003']));
    for (const k of ['feature', 'note', 'idea']) await page.click(`[data-kind=${k}]`);
    await page.selectOption('[data-filter=contact]', 'no');
    await sleep(100);
    check('contact filter: the cards without a contact', same((await ids(page)).sort(), ['F-edgetx-radio-over-usb-webhid-in-chrome', 'N-20261010-0001', 'R-20261008-0003']));
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

    // a card with a contact: reply (then Cancel in the undo window), comment, urgency, public title, the Column select
    const id2 = 'R-20261006-0002';
    await page.click(`${card(id2)} [data-action=details]`);
    check('the contact itself is on the card', ((await page.textContent(`${card(id2)} [data-field=contact]`)) ?? '').includes('pilot.one@example.com or @pilotone on Telegram'));
    const replyBox = `${card(id2)} [data-field=reply-text]`;
    const answer = 'Thanks! It is queued for the next build.';
    // the server refuses the first send: the text stays in the box, nothing is queued
    mock.failNext = { path: 'ideas/reply', status: 500 };
    await page.fill(replyBox, answer);
    await page.click(`${card(id2)} [data-action=reply]`);
    await page.waitForSelector('.note.bad');
    await quiet(page, id2);
    check('a refused reply keeps its text in the box', (await page.inputValue(replyBox)) === answer && !mock.mails().some((m) => m.kind === 'reply'), true);
    before = mock.posts().length;
    await page.click(`${card(id2)} [data-action=reply]`);
    await posts(mock, before + 1);
    await page.waitForSelector(`${card(id2)}:not([aria-busy]) [data-field=mails] [data-state=queued] [data-action=mail-cancel]`);
    check('the reply is queued behind the undo window and the owner is told so', ((await page.textContent('.note')) ?? '').includes('pilot.one@example.com') && mock.mails('queued').some((m) => m.kind === 'reply'));
    check('after the send the reply box is empty', (await page.inputValue(replyBox)) === '');
    const oneReply = mock.posts().length;
    await page.click(`${card(id2)} [data-action=reply]`);
    await sleep(300);
    check('a second click on Send reply sends nothing: the pilot gets one e-mail', mock.posts().length === oneReply && mock.mails().filter((m) => m.kind === 'reply').length === 1, true);
    const replyId = await page.getAttribute(`${card(id2)} [data-field=mails] [data-state=queued] [data-action=mail-cancel]`, 'data-mail');
    await page.click(`${card(id2)} [data-field=mails] [data-state=queued] [data-action=mail-cancel]`);
    await posts(mock, before + 2);
    await page.waitForSelector(`${card(id2)}:not([aria-busy]) [data-field=mails] [data-state=cancelled]`);
    check('Cancel on the queued reply stops it', mock.mails().find((m) => m.id === replyId)?.state === 'cancelled');
    await page.fill(`${card(id2)} [data-field=comment]`, 'With the HUD work');
    await page.click(`${card(id2)} [data-action=comment]`);
    await posts(mock, before + 3);
    await page.waitForSelector(`${card(id2)}:not([aria-busy]) [data-field=urgency]`);
    check('after Add comment the comment box is empty (a second click adds nothing)', (await page.inputValue(`${card(id2)} [data-field=comment]`)) === '');
    await page.selectOption(`${card(id2)} [data-field=urgency]`, 'urgent');
    await page.waitForSelector(`${card(id2)}:not([aria-busy]) [data-chip=urgency].u-urgent`);
    await page.fill(`${card(id2)} [data-field=title-pl]`, 'Celownik na srodku obrazu');
    await page.click(`${card(id2)} [data-action=save-public]`);
    await posts(mock, before + 5);
    await quiet(page, id2);
    results.cardCalls = sentSince(mock, before);
    check('reply, cancel, comment, urgency and public title each send their own call with their body', same(sentSince(mock, before), [
        ['ideas/reply', { id: id2, text: 'Thanks! It is queued for the next build.' }],
        ['ideas/mail/cancel', { id: replyId }],
        ['ideas/update', { id: id2, comment: 'With the HUD work' }],
        ['ideas/update', { id: id2, urgency: 'urgent' }],
        ['ideas/update', { id: id2, publicTitle: { en: 'A crosshair in the centre of the view', pl: 'Celownik na srodku obrazu' }, visible: true }]
    ]));
    await page.selectOption(`${card(id2)} [data-field=status]`, 'in_progress');
    await settled(page, id2, 'in_progress');
    check('the Column select moves the card (touch)', same(mock.posts().at(-1)?.body, { id: id2, status: 'in_progress' }));

    // the landing: shown with an English title and a status the landing shows; the card says what is missing
    check('a card with an English title in a shown status carries the landing chip', !!(await page.$(`${card(id2)} [data-chip=landing]`)));
    check('without an English title no landing chip', !(await page.$(`${card('R-20261006-0001')} [data-chip=landing]`)), true);
    await page.click(`${card('R-20261006-0001')} [data-action=details]`);
    const noteOf = (): Promise<string> => page.textContent(`${card('R-20261006-0001')} [data-field=public-note]`).then((s) => s ?? '');
    const needTitle = await noteOf();
    await page.fill(`${card('R-20261006-0001')} [data-field=title-en]`, 'Rates types with manual editing');
    const missing = await noteOf();
    check('the card asks for the English title first, then names the languages still missing', /English/.test(needTitle) && missing !== needTitle && ['es', 'pl', 'ru'].every((l) => missing.includes(l)));

    // the landing switch is a draft like the titles: redraws before Save (here: the search) keep it unticked
    await page.uncheck(`${card(id2)} [data-field=visible]`);
    await page.fill('[data-testid=idea-search]', 'R-2026');
    await page.fill('[data-testid=idea-search]', '');
    check('the unticked landing switch survives redraws before Save', !(await page.isChecked(`${card(id2)} [data-field=visible]`)));
    before = mock.posts().length;
    await page.click(`${card(id2)} [data-action=save-public]`);
    await posts(mock, before + 1);
    await quiet(page, id2);
    check('Save sends visible: false and the card leaves the landing', (mock.posts().at(-1)?.body as { visible?: unknown } | null)?.visible === false && !(await page.$(`${card(id2)} [data-chip=landing]`)));

    // the owner writes down an idea a pilot told him (item 8): nothing goes without words
    await page.click('[data-testid=note-form] summary');
    before = mock.posts().length;
    await page.click('[data-action=note-add]');
    await sleep(300);
    check('an empty note sends nothing', mock.posts().length === before, true);
    await page.fill('[data-field=note-text]', 'A pilot at the field asked for a lap timer.');
    await page.fill('[data-field=note-contact]', 'pilot.three@example.com');
    await page.selectOption('[data-field=note-lang]', 'es');
    await page.selectOption('[data-field=note-urgency]', 'high');
    await page.click('[data-action=note-add]');
    await page.waitForSelector(`${card('N-20261013-0001')}[data-status=new]`);
    check('the note goes to ideas/note and lands in New', same(sentSince(mock, before), [['ideas/note', { text: 'A pilot at the field asked for a lap timer.', contact: 'pilot.three@example.com', lang: 'es', urgency: 'high', kind: 'note' }]]));

    // Gmail not set up on the server: the owner is told an e-mail is saved, not "queued, goes in 60 s" (the
    // queued notes above are the control); a thank-you saved that way is the one the card offers to Send
    // again (ideas/mail/send), never written a second time
    mock.failNext = null;
    mock.mailConfigured = false;
    await page.fill(replyBox, 'Second answer while Gmail is off.');
    before = mock.posts().length;
    await page.click(`${card(id2)} [data-action=reply]`);
    await posts(mock, before + 1);
    await quiet(page, id2);
    const replyOff = (await page.textContent('.note')) ?? '';
    results.replyWithoutGmail = replyOff;
    check('without Gmail a reply is announced as saved for Gmail, not as queued', mock.mails().at(-1)?.state === 'waiting_setup' && /Gmail/.test(replyOff) && !replyOff.includes('60 s') && replyOff !== queuedNote);
    await page.selectOption(`${card(id2)} [data-field=status]`, 'done');
    await page.waitForSelector('[data-testid=thanks-dialog] [data-field=thanks-summary]');
    await settled(page, id2, 'done');
    await page.fill('[data-field=thanks-summary]', 'Celownik jest teraz w ustawieniach HUD.');
    await page.click('[data-action=thanks-make]');
    await page.waitForSelector('[data-testid=thanks-dialog] [data-step=draft]:not([hidden])');
    const id2Draft = doneMails(mock, id2)[0]?.id;
    await page.click('[data-action=thanks-send]');
    await page.waitForSelector('[data-testid=thanks-dialog]', { state: 'detached' });
    await quiet(page, id2);
    const thanksOff = (await page.textContent('.note')) ?? '';
    results.thanksWithoutGmail = thanksOff;
    check('without Gmail the thank-you is announced as saved for Gmail, not as queued', same(doneMails(mock, id2).map((m) => m.state), ['waiting_setup']) && /Gmail/.test(thanksOff) && !thanksOff.includes('60 s'));
    before = mock.posts().length;
    await page.click(`${card(id2)} [data-action=thanks]`);
    await page.waitForSelector('[data-testid=thanks-dialog] [data-step=draft]:not([hidden])');
    check('the card reopens that thank-you to Send: no new draft, no Edit, its state said', mock.posts().length === before && await page.isHidden('[data-action=thanks-edit]')
        && ((await page.textContent('[data-field=thanks-status]')) ?? '').includes('Gmail'), true);
    mock.mailConfigured = true;
    await page.click('[data-action=thanks-send]');
    await page.waitForSelector('[data-testid=thanks-dialog]', { state: 'detached' });
    await quiet(page, id2);
    results.resendCalls = sentSince(mock, before);
    check('its Send goes to ideas/mail/send with that e-mail: one thank-you, queued, no longer offered', same(sentSince(mock, before), [['ideas/mail/send', { id: id2Draft }]])
        && same(doneMails(mock, id2).map((m) => m.state), ['queued']) && !(await page.$(`${card(id2)} [data-action=thanks]`)));

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
    check('no e-mail went out on its own: two thank-yous queued by Send, one reply cancelled, one waiting for Gmail',
        same(mock.mails().map((m) => [m.kind, m.state]).sort(), [['done', 'queued'], ['done', 'queued'], ['reply', 'cancelled'], ['reply', 'waiting_setup']]));
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
