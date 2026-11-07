// v0.12 Fly by Sound, review of lane v12-flight, D6 (docs/wip/v12-flight-review.md): what a SCREEN READER can hear of a lesson's intro
// in "my screen reader speaks" mode. The engine then says nothing (SonicPrefs.selfVoice off) and the captions region is the only
// voice: a polite live region (sonic/captions.ts). A lesson says four to six lines in one go when it opens, and the region kept the
// last three of them (CAPTION_LINES), taking the older ones out of the page in the same task they were put in, so the title and the
// first lines of every lesson were never in the accessibility tree for a screen reader to announce. Measured in a real page, headless
// Chrome, the keyboard only: every line put into the region (a MutationObserver) and, at each animation frame of the first seconds,
// the lines that were IN the region (what the browser's accessibility tree is built from).
//   cd apps/fly && npx vite --port 5343 --strictPort            (another shell)
//   cd tools/bench && LAB=http://localhost:5343 npx tsx src/sonic-review-captions.ts [lesson id]
// Evidence: evidence/<date>/sonic-review-captions.json. Holds the GPU lock (the page draws the lesson world).
import { mkdirSync, rmdirSync, statSync } from 'node:fs';
import { SCHEMA_VERSION } from '../../../packages/prefs/src';
import { defaultPrefs } from '../../../packages/sonic-fpv/src';
import { launch } from './browser';
import { writeEvidence } from './evidence';

const LAB = (process.env.LAB ?? '').replace(/\/$/, '');
if (!LAB) throw new Error('LAB=http://localhost:<vite port> is needed');
const LESSON = process.argv[2] ?? 'corridor';
// SIZE=740x360: a short window (a phone on its side), where the page shows the last two lines only
const [WIDTH, HEIGHT] = (process.env.SIZE ?? '1280x720').split('x').map(Number) as [number, number];
const MOST_SEEN = HEIGHT <= 500 ? 2 : 3;
const LOCK = 'C:/dev/.gpu-lock';
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function lock(): Promise<void> {
    let waited = 0;
    for (;;) {
        try {
            mkdirSync(LOCK);
            return;
        } catch {
            try {
                if (Date.now() - statSync(LOCK).mtimeMs > 20 * 60 * 1000) {
                    rmdirSync(LOCK);
                    continue;
                }
            } catch {
                /* gone */
            }
            if (!waited++ || waited % 600 === 0) console.log('waiting for the GPU lock');
            await sleep(100);
        }
    }
}
const unlock = (): void => {
    try {
        rmdirSync(LOCK);
    } catch {
        /* not ours */
    }
};
process.on('SIGINT', () => {
    unlock();
    process.exit(130);
});

// "my screen reader speaks": the engine says nothing, the captions region is the live region the screen reader reads
const DOC = {
    format: 'gsfpv-prefs',
    version: SCHEMA_VERSION,
    app: '0.3.0',
    savedAt: '2026-11-07T00:00:00.000Z',
    settings: { global: {}, drone: {}, scene: {} },
    collections: { sonic: { v: 1, prefs: { ...defaultPrefs(), selfVoice: false, speechRate: 2 }, progress: {}, current: null }, ui: { v: 1, warned: true } }
};
// (window.__name: tsx wraps named functions of a page.evaluate callback in __name(), which the page does not have)
const INIT = `(() => {
  window.__name = (f) => f;
  try { if (!localStorage.getItem('gsfpv.prefs.v1')) localStorage.setItem('gsfpv.prefs.v1', ${JSON.stringify(JSON.stringify(DOC))}); } catch (e) {}
  window.__added = [];      // every line put into the region, in order, with the time
  window.__frames = [];     // at each animation frame: the lines in the region then
  window.__vis = [];        // at each animation frame: how many of them the eye can see (a box larger than 4 px)
  window.__live = null;
  const watch = (root) => {
    window.__live = root.getAttribute('aria-live');
    new MutationObserver((records) => {
      for (const r of records) for (const n of r.addedNodes) if (n.nodeType === 1) window.__added.push({ t: Math.round(performance.now()), text: n.textContent });
    }).observe(root, { childList: true });
    const tick = () => {
      // what the accessibility tree has of the region: the lines that are rendered (display:none and visibility:hidden are left out of it, a clipped line is in it)
      window.__frames.push([...root.children].filter((c) => { const cs = getComputedStyle(c); return cs.display !== 'none' && cs.visibility !== 'hidden'; }).map((c) => c.textContent));
      window.__vis.push([...root.children].filter((c) => { const r = c.getBoundingClientRect(); return r.width > 4 && r.height > 4; }).length);
      if (window.__frames.length < 400) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  new MutationObserver((_r, obs) => { const root = document.querySelector('[data-testid="sonic-captions"]'); if (root) { obs.disconnect(); watch(root); } }).observe(document, { childList: true, subtree: true });
})();`;

const checks: { name: string; pass: boolean; value?: unknown }[] = [];
const check = (name: string, pass: boolean, value?: unknown): void => {
    checks.push({ name, pass, value });
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${value === undefined ? '' : '  ' + JSON.stringify(value).slice(0, 400)}`);
};

await lock();
let failed = false;
try {
    const L = await launch({ width: WIDTH, height: HEIGHT });
    await L.context.addInitScript(INIT);
    await L.context.addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: LAB }]);
    const page = L.page;
    await page.goto(`${LAB}/fly/?sonic=${LESSON}&nowarn=1`);
    await page.waitForSelector('[data-testid="sonic-start-asked"]', { timeout: 60000 });
    await page.focus('[data-testid="sonic-start-asked"]');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => { const h = (window as unknown as { __gsfpv?: { status?: string; sonic?: () => { lesson: string | null } } }).__gsfpv; return h?.status === 'ready' && h.sonic?.().lesson !== null; }, undefined, { timeout: 90000 });
    await sleep(3000);
    const r = await page.evaluate(() => {
        const w = window as unknown as { __added: { t: number; text: string }[]; __frames: string[][]; __vis: number[]; __live: string | null };
        const seen = new Set<string>();
        for (const f of w.__frames) for (const l of f) seen.add(l);
        return { live: w.__live, added: w.__added, inRegionAtSomeFrame: [...seen], frames: w.__frames.length, maxAtOnce: Math.max(0, ...w.__frames.map((f) => f.length)), maxSeen: Math.max(0, ...w.__vis) };
    });
    // the lines put in within 50 ms of the first one: the intro said in one go when the lesson opened
    const t0 = r.added[0]?.t ?? 0;
    const burst = r.added.filter((a) => a.t - t0 < 50).map((a) => a.text);
    check('the captions region is the live region (aria-live polite) in "my screen reader speaks" mode', r.live === 'polite', { live: r.live });
    check('the lesson says several lines in one go when it opens (4 or more within 50 ms)', burst.length >= 4, { burst: burst.length, lines: burst });
    const missed = burst.filter((l) => !r.inRegionAtSomeFrame.includes(l));
    check('every line of that burst is in the region at some animation frame, so the browser\'s accessibility tree has it to announce', missed.length === 0, { burst: burst.length, inTheRegionAtAFrame: burst.length - missed.length, neverInTheRegion: missed });
    check(`while the eye sees at most ${MOST_SEEN} lines at a time (the helper's view is not covered; the older ones have no box of their own)`, r.maxSeen >= 1 && r.maxSeen <= MOST_SEEN, { maxLinesSeenByTheEye: r.maxSeen, maxLinesInTheRegionAtOnce: r.maxAtOnce });
    const errors = L.console.filter((l) => l.startsWith('pageerror') || (l.startsWith('error') && !/favicon|404|\/api\//.test(l)));
    check('no page errors', errors.length === 0, errors.slice(0, 5));
    failed = checks.some((c) => !c.pass);
    const file = writeEvidence(`sonic-review-captions${process.env.SIZE ? `-${process.env.SIZE}` : ''}`, { lab: LAB, lesson: LESSON, size: [WIDTH, HEIGHT], passed: checks.filter((c) => c.pass).length, total: checks.length, checks });
    console.log(`${checks.filter((c) => c.pass).length} of ${checks.length} checks pass; evidence ${file}`);
    await L.browser.close();
} finally {
    unlock();
}
process.exit(failed ? 1 : 0);
