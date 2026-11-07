// Fly by Sound, the independent review of lane v12-feedback (docs/wip/v12-feedback-review.md): the browser checks of what the review found.
// The same page as tools/bench/src/sonicrec-local.ts (the REAL session side on a stand-in context: headless Chrome, a fake microphone,
// real OPFS and DOM, the live headers through serve-csp.mjs; no scan is drawn: --disable-gpu, no GPU lock needed).
//   R1 live regions   while a recording runs and while a replay is open, nothing inside a live region of the helper's panel may change
//                     unless the sentence itself changed: a screen reader reads out every change of a polite live region, so a clock
//                     or a frame counter inside one is read to the helper every second
//   R2 stop           after the pilot's stop the survey listens with the voice still recording: the pilot is told that recording stopped only when
//                     the microphone has been let go (after the survey), not at the stop
//   npx tsx tools/bench/src/sonicrec-review.ts       evidence/<date>/sonicrec-review.json
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'esbuild';
import type { Plugin } from 'esbuild';
import type { BrowserContext, Page } from 'playwright';
import { launchChrome } from './browser';
import { REPO as EVIDENCE_REPO, today, writeEvidence } from './evidence';
import { REPO, makeDist, serveDist } from './sonicrec-serve';

const SHIM = join(REPO, 'tools', 'bench', 'test', 'sonicrec-i18n-shim.ts');
const shim: Plugin = { name: 'i18n-shim', setup: (b) => b.onResolve({ filter: /\/i18n$/ }, (a) => (a.importer.includes('sonic-session') ? { path: SHIM } : undefined)) };
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
