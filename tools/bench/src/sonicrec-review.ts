// Fly by Sound, the independent review of lane v12-feedback (docs/wip/v12-feedback-review.md): the browser checks of what the review found.
// The same page as tools/bench/src/sonicrec-local.ts (the REAL session side on a stand-in context: headless Chrome, a fake microphone,
// real OPFS and DOM, the live headers through serve-csp.mjs; no scan is drawn: --disable-gpu, no GPU lock needed).
//   R1 live regions   while a recording runs and while a replay is open, nothing inside a live region of the helper's panel may change
//                     unless the sentence itself changed: a screen reader reads out every change of a polite live region, so a clock
//                     or a frame counter inside one is read to the helper every second
//   R2 stop           after the pilot's stop the survey listens with the voice still recording: the pilot is told that recording stopped only when
//                     the microphone has been let go (after the survey), not at the stop
//   R4 survey dialog  the dialog that follows a stop is a modal dialog: the focus moves into it and comes back, and its question is written
//                     after it is shown (a screen reader announces a live region that changes while it is visible)
//   R3 problems       a problem of the recorder (here: too little browser storage) is read in the language of the page
//   R5 a failed Save  (v12-int step 9) a recording whose files are damaged cannot be packed: the helper's panel says so in the language of the
//                     page and in nothing else, no English sentence of the registry's and none of the sound package's own diagnostic
//   npx tsx tools/bench/src/sonicrec-review.ts       evidence/<date>/sonicrec-review.json
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'esbuild';
import type { BrowserContext, Page } from 'playwright';
import { launchChrome } from './browser';
import { REPO as EVIDENCE_REPO, today, writeEvidence } from './evidence';
import { REPO, makeDist, serveDist, i18nShim } from './sonicrec-serve';

const shim = i18nShim;
const bundle = await build({ entryPoints: [join(REPO, 'tools', 'bench', 'test', 'sonicrec-local-page.ts')], outdir: 'out', bundle: true, format: 'esm', platform: 'browser', target: 'es2022', write: false, logLevel: 'silent', plugins: [shim] });
const out = (ext: string): string => bundle.outputFiles.find((f) => f.path.endsWith(ext))?.text ?? '';
const dist = makeDist({
    'en/fly/index.html': '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>sonicrec</title><link rel="stylesheet" href="/fly/assets/local.css"><style>body{background:#07080a;color:#e8eaed;font:15px system-ui}</style></head><body><main><p>The flight page stand-in.</p></main><script type="module" src="/fly/assets/local.js"></script></body></html>',
    'fly/assets/local.js': out('.js'),
    'fly/assets/local.css': out('.css')
});
const served = await serveDist(dist);
const { browser, which } = await launchChrome({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--disable-gpu'] });

const call = <T>(page: Page, fn: string, ...args: unknown[]): Promise<T> =>
    page.evaluate(([f, a]) => (window as unknown as { __loc: Record<string, (...x: unknown[]) => unknown> }).__loc[f as string]?.(...(a as unknown[])) as unknown, [fn, args] as const) as Promise<T>;
const state = (page: Page): Promise<Record<string, any>> => call(page, 'state'); // eslint-disable-line @typescript-eslint/no-explicit-any
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const log = (...a: unknown[]): void => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
mkdirSync(join(EVIDENCE_REPO, 'evidence', today()), { recursive: true });

async function until(page: Page, what: string, pred: (s: Record<string, any>) => boolean, ms = 15000): Promise<Record<string, any>> { // eslint-disable-line @typescript-eslint/no-explicit-any
    const t0 = Date.now();
    for (;;) {
        const s = await state(page);
        if (pred(s)) return s;
        if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}: ${JSON.stringify({ phase: s.phase, rows: s.rows, panelMessage: s.panelMessage, panelStatus: s.panelStatus, error: s.status?.error })}`);
        await sleep(50);
    }
}

async function newContext(): Promise<BrowserContext> {
    const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1100, height: 760 } });
    await ctx.grantPermissions(['microphone'], { origin: served.origin });
    await ctx.addInitScript({ content: 'window.showSaveFilePicker = undefined;' });
    return ctx;
}

async function open(ctx: BrowserContext, init: { mode?: boolean } = {}): Promise<Page> {
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log('pageerror', e.message));
    await page.goto(`${served.origin}/en/fly/`);
    await page.waitForFunction(() => (window as unknown as { __loc?: unknown }).__loc !== undefined);
    await page.bringToFront();
    await call(page, 'init', init);
    return page;
}

/** T, T with real key presses; resolves when the recording runs. The second press waits for the question, as a person does. */
async function recordWithKeys(page: Page): Promise<void> {
    await page.keyboard.press('KeyT');
    await until(page, 'the question', (s) => s.phase === 'asking');
    await sleep(120);
    await page.keyboard.press('KeyT');
    await until(page, 'the recording', (s) => s.phase === 'recording');
}

/**
 * Watches the helper's panel for changes inside live regions (an element with role status, alert or log, or aria-live polite or assertive,
 * unless a nearer ancestor says aria-live off). Plain JavaScript text: a function would be rewritten by the TypeScript runner.
 */
const WATCH = `(() => {
  const panel = document.getElementById('sonicrec-panel');
  const seen = new Map();
  function regionOf(node) {
    let el = node.nodeType === 1 ? node : node.parentElement;
    while (el && el !== document.body) {
      const live = el.getAttribute('aria-live');
      if (live === 'off') return null;
      if (live === 'polite' || live === 'assertive') return el;
      const role = el.getAttribute('role');
      if (role === 'status' || role === 'alert' || role === 'log') return el;
      el = el.parentElement;
    }
    return null;
  }
  function name(el) { return (el.className && String(el.className).split(' ')[0]) || el.id || el.tagName.toLowerCase(); }
  const watcher = new MutationObserver((records) => {
    for (const r of records) {
      const el = regionOf(r.target);
      if (el === null) continue;
      const key = name(el);
      const entry = seen.get(key) || { writes: 0, texts: new Set(), last: null };
      entry.writes++;
      const now = (el.textContent || '').replace(/\\s+/g, ' ').trim();
      entry.texts.add(now);
      entry.last = now;
      seen.set(key, entry);
    }
  });
  watcher.observe(panel, { childList: true, subtree: true, characterData: true });
  window.__watch = {
    stop() { watcher.disconnect(); return Object.fromEntries([...seen].map(([k, v]) => [k, { writes: v.writes, differentTexts: v.texts.size, last: v.last }])); },
    reset() { seen.clear(); }
  };
})()`;

const results: Record<string, unknown> = {};
const checks: Record<string, boolean> = {};

try {
    log('browser up', which.version);

    // ---------------------------------------------------------------- R1: live regions of the helper's panel
    {
        const ctx = await newContext();
        const page = await open(ctx);
        await call(page, 'deleteAll');
        await until(page, 'the toggle button', (s) => s.panelBuilt === true && s.toggleHidden === false);
        await page.locator('#sonicrec-toggle').click();
        await until(page, 'the panel open', (s) => s.panelOpen === true);
        await call(page, 'fly', true);
        await recordWithKeys(page);
        await sleep(300);
        await page.evaluate(WATCH);
        await sleep(3500); // a steady recording: nothing but the clock moves
        const recording = await page.evaluate<Record<string, { writes: number; differentTexts: number; last: string }>>('window.__watch.stop()');
        results.recordingRegions = recording;
        const status = recording['sonicrec-status'] ?? { writes: 0, differentTexts: 0, last: '' };
        log('recording: live regions', JSON.stringify(recording));
        checks['R1: a steady recording does not rewrite the panel\'s live status (the clock and the frame counter are not in a live region)'] = status.writes === 0;

        // the replay of the recording that was just made: open, and let it stand for two seconds without pressing Play
        await call(page, 'fly', false);
        await page.keyboard.press('KeyT');
        await until(page, 'the survey offer', (s) => s.surveyOpen === true);
        await page.keyboard.press('Digit2');
        await until(page, 'the recording saved', (s) => s.phase === 'idle' && s.rows.length === 1);
        await page.locator('[data-action="replay"]').first().click();
        await page.waitForFunction(() => (document.querySelector('.sonicrec-replay-status')?.textContent ?? '').length > 5 && document.querySelector('.sonicrec-replay-controls:not([hidden])') !== null, undefined, { timeout: 20000 });
        const replayText = (await page.locator('.sonicrec-replay-status').textContent()) ?? '';
        results.replayStatus = replayText;
        await page.evaluate(WATCH);
        await sleep(2200);
        const replay = await page.evaluate<Record<string, { writes: number; differentTexts: number; last: string }>>('window.__watch.stop()');
        results.replayRegions = replay;
        log('replay open: live regions', JSON.stringify(replay));
        const rs = replay['sonicrec-replay-status'] ?? { writes: 0, differentTexts: 0, last: '' };
        checks['R1: an open replay that is not playing does not rewrite its live status line (the same sentence is not written again every 250 ms)'] = rs.writes === 0;
        await ctx.close();
    }

    // ---------------------------------------------------------------- R2: "Recording stopped" is said when the microphone is let go
    {
        const ctx = await newContext();
        const page = await open(ctx);
        await call(page, 'deleteAll');
        await until(page, 'the toggle button', (s) => s.panelBuilt === true && s.toggleHidden === false);
        await call(page, 'fly', true);
        await recordWithKeys(page);
        await sleep(1500);
        await page.keyboard.press('KeyT'); // the pilot's stop: the survey is offered, the voice goes on
        const offer = await until(page, 'the survey offer', (s) => s.surveyOpen === true);
        await sleep(300);
        const during = (await call<{ key: string }[]>(page, 'spoken')).map((l) => l.key);
        results.spokenWhileTheSurveyListens = { phase: offer.phase, voice: offer.status?.voice, spoken: during };
        log('while the survey listens:', JSON.stringify(results.spokenWhileTheSurveyListens));
        await page.keyboard.press('Digit2'); // declined: the recording ends
        await until(page, 'the recording saved', (s) => s.phase === 'idle' && s.rows.length === 1);
        await sleep(200);
        const after = (await call<{ key: string }[]>(page, 'spoken')).map((l) => l.key);
        results.spokenAfterTheSurvey = after;
        log('after the survey:', JSON.stringify(after));
        checks['R2: while the survey is offered the voice is still being recorded and the pilot has not been told that recording stopped'] = offer.phase === 'closing' && offer.status?.voice === 'recording' && !during.includes('rec.stopped');
        checks['R2: when the survey is over the pilot hears that recording stopped, and then that the flight is saved'] = after.indexOf('rec.stopped') > after.indexOf('rec.started') && after.indexOf('rec.saved') > after.indexOf('rec.stopped');
        await ctx.close();
    }

    // ---------------------------------------------------------------- R3: a recorder problem is read in the language of the page
    {
        const ctx = await newContext();
        // the browser says 5 MB are left of 60: the recorder refuses to start (it wants 50 MB)
        await ctx.addInitScript({ content: 'navigator.storage.estimate = async () => ({ quota: 60000000, usage: 55000000 });' });
        const page = await ctx.newPage();
        page.on('pageerror', (e) => console.log('pageerror', e.message));
        await page.goto(`${served.origin}/en/fly/?lang=es`);
        await page.waitForFunction(() => (window as unknown as { __loc?: unknown }).__loc !== undefined);
        await page.bringToFront();
        await call(page, 'init', {});
        await call(page, 'deleteAll');
        await until(page, 'the toggle button', (s) => s.panelBuilt === true && s.toggleHidden === false);
        await page.locator('#sonicrec-toggle').click();
        await page.keyboard.press('KeyT');
        await until(page, 'the question', (s) => s.phase === 'asking');
        await sleep(120);
        await page.keyboard.press('KeyT');
        const refused = await until(page, 'the refusal', (s) => s.phase === 'idle' && s.status?.error !== null);
        results.lowStorageInSpanish = { error: refused.status?.error, panel: refused.panelStatus };
        log('low storage, page in Spanish:', JSON.stringify(results.lowStorageInSpanish));
        checks['R3: with too little browser storage the panel says so in the language of the page (Spanish), not in English'] = /^Quedan solo \d+ MB .* 50 MB/.test(String(refused.panelStatus)) && !/browser storage/.test(String(refused.panelStatus));
        await ctx.close();
    }

    // ---------------------------------------------------------------- R4: the survey dialog is a modal dialog a screen reader can reach
    {
        const ctx = await newContext();
        // the order in which the dialog is shown and its question is written (plain JavaScript, run before the page's own)
        await ctx.addInitScript({
            content: `(() => {
  window.__order = [];
  const hid = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'hidden');
  Object.defineProperty(HTMLElement.prototype, 'hidden', { configurable: true, get() { return hid.get.call(this); }, set(v) { if (this.classList && this.classList.contains('sonicrec-survey')) window.__order.push('dialog.hidden=' + v); hid.set.call(this, v); } });
  const tc = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent');
  Object.defineProperty(Node.prototype, 'textContent', { configurable: true, get() { return tc.get.call(this); }, set(v) { if (this.classList && this.classList.contains('sonicrec-q')) window.__order.push(v === '' ? 'question=empty' : 'question=text'); tc.set.call(this, v); } });
})()`
        });
        const page = await open(ctx);
        await call(page, 'deleteAll');
        await until(page, 'the toggle button', (s) => s.panelBuilt === true && s.toggleHidden === false);
        await page.locator('#sonicrec-toggle').click(); // the helper's panel opens and its button has the focus
        await page.locator('#sonicrec-toggle').click(); // closed again: the focus stays on the button
        await call(page, 'fly', true);
        await recordWithKeys(page);
        await sleep(1200);
        await page.keyboard.press('KeyT');
        await until(page, 'the survey offer', (s) => s.surveyOpen === true);
        await sleep(150);
        const during = await page.evaluate<{ inside: boolean; tag: string; order: string[] }>(`(() => { const a = document.activeElement; const d = document.querySelector('.sonicrec-survey'); return { inside: !!(a && d && d.contains(a)), tag: a ? a.tagName + '.' + (a.className || a.id || '') : '', order: window.__order.slice(0, 6) }; })()`);
        results.surveyDialogFocus = during;
        log('survey dialog: focus and order', JSON.stringify(during));
        const shownBeforeWritten = during.order.indexOf('dialog.hidden=false') >= 0 && during.order.indexOf('dialog.hidden=false') < during.order.indexOf('question=text');
        checks['R4: when the survey dialog opens the focus moves into it (aria-modal hides the page behind it from a screen reader, so the focus must not stay there)'] = during.inside;
        checks['R4: the dialog is shown before its question is written (a live region that changes while it is hidden is not announced)'] = shownBeforeWritten;
        await page.keyboard.press('Digit2');
        await until(page, 'the recording saved', (s) => s.phase === 'idle' && s.rows.length === 1);
        await sleep(100);
        const after = await page.evaluate<{ id: string; inDialog: boolean }>(`(() => { const a = document.activeElement; const d = document.querySelector('.sonicrec-survey'); return { id: a ? a.id : '', inDialog: !!(a && d && d.contains(a)) }; })()`);
        results.surveyFocusAfter = after;
        checks['R4: when the survey is over the focus goes back to where it was (the panel button), not to the closed dialog'] = !after.inDialog && after.id === 'sonicrec-toggle';
        await ctx.close();
    }

    // ---------------------------------------------------------------- R5: a failed Save is read in the language of the page (v12-int step 9)
    {
        const ctx = await newContext();
        const page = await ctx.newPage();
        page.on('pageerror', (e) => console.log('pageerror', e.message));
        await page.goto(`${served.origin}/en/fly/?lang=es`);
        await page.waitForFunction(() => (window as unknown as { __loc?: unknown }).__loc !== undefined);
        await page.bringToFront();
        await call(page, 'init', {});
        await call(page, 'deleteAll');
        await until(page, 'the toggle button', (s) => s.panelBuilt === true && s.toggleHidden === false);
        await page.locator('#sonicrec-toggle').click();
        await call(page, 'fly', true);
        await recordWithKeys(page);
        await sleep(1200);
        await call(page, 'fly', false);
        await page.keyboard.press('KeyT');
        await until(page, 'the survey offer', (s) => s.surveyOpen === true);
        await page.keyboard.press('Digit2');
        await until(page, 'the recording saved', (s) => s.phase === 'idle' && s.rows.length === 1);
        // the voice in the browser's storage is damaged (10 bytes in the place of its first part): the package cannot be packed
        await page.evaluate(`(async () => {
  const root = await navigator.storage.getDirectory();
  const dir = await root.getDirectoryHandle('sonic-sessions');
  for await (const [, session] of dir.entries()) {
    // a file of a session is kept as small parts (store.ts): the first part of the voice is overwritten, so its size and hash no longer match the manifest
    const names = [];
    for await (const [n] of session.entries()) names.push(n);
    const part = names.filter((n) => n.startsWith('voice.webm')).sort()[0];
    const w = await (await session.getFileHandle(part)).createWritable();
    await w.write(new Uint8Array(10));
    await w.close();
  }
})()`);
        await page.locator('[data-action="save"]').first().click();
        const failed = await until(page, 'the failure line', (s) => /^No se pudo guardar:/.test(String(s.panelMessage)));
        const line = String(failed.panelMessage);
        results.failedSaveInSpanish = line;
        log('a failed save, page in Spanish:', line);
        // Spanish letters are matched by a dot: the repository keeps no accented letters outside the dictionaries
        checks['R5: a recording that cannot be packed says so in Spanish, in the sentence of the dictionary and nothing else'] = /^No se pudo guardar: la grabaci.n est. da.ada y no se puede empaquetar$/.test(line);
        checks['R5: no English reaches the panel with it (not the registry\'s, not the sound package\'s own diagnostic: "bytes", "manifest", "cannot be packed", "Could not save")'] = !/bytes|manifest|cannot be packed|Could not save|another tab/.test(line);
        await ctx.close();
    }
} finally {
    await browser.close();
    await served.stop();
    rmSync(dist, { recursive: true, force: true });
}

const pass = Object.values(checks).every(Boolean);
writeEvidence('sonicrec-review', {
    pass,
    checks,
    results,
    note: 'headless Chrome, a fake microphone, real OPFS and DOM; the sound runtime, samples and key router are stand-ins until the flight lane lands. A screen reader was not used: what it would read is judged from the live regions that change, not heard.'
});
console.log(JSON.stringify({ checks }, null, 1));
console.log(pass ? 'sonicrec-review PASS' : 'sonicrec-review FAIL');
process.exit(pass ? 0 : 1);
