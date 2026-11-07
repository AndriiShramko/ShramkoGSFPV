// v0.12 Fly by Sound, review of lane v12-flight, D3 (docs/wip/v12-flight-review.md): a lesson that does not open at the ENTRY. The
// scan lesson (?sonic=free-garden) loads Winter Garden from the CDN before it can fly; when that fails (no connection, the CDN
// down) startSonic's catch showed the start screen again and put the raw message of the exception into its live region: an
// English technical sentence, in every language, read by a screen reader and never said by the engine, so a pilot without a
// screen reader (the engine's own voice, the default) heard nothing at all. The same failure from inside a flight says
// "The scan did not load. Check the connection, then choose the lesson again." in the pilot's language through the engine.
// Run in a real page, headless Chrome, the keyboard only, with every request to another origin than the dev server refused.
//   cd apps/fly && npx vite --port 5343 --strictPort            (another shell)
//   cd tools/bench && LAB=http://localhost:5343 npx tsx src/sonic-review-launch.ts [en|es|pl|ru]
// Evidence: evidence/<date>/sonic-review-launch.json. Holds the GPU lock (the page is a flight page).
import { mkdirSync, readFileSync, rmdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { SCHEMA_VERSION } from '../../../packages/prefs/src';
import { defaultPrefs } from '../../../packages/sonic-fpv/src';
import type { Locale } from '../../../packages/sonic-fpv/src';
import { launch } from './browser';
import { REPO, writeEvidence } from './evidence';

const LAB = (process.env.LAB ?? '').replace(/\/$/, '');
if (!LAB) throw new Error('LAB=http://localhost:<vite port> is needed');
const LOCALE = (process.argv[2] ?? 'en') as Locale;
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

// the engine speaks (the default: no screen reader), so what it says reaches speechSynthesis, which the page counts
const DOC = {
    format: 'gsfpv-prefs',
    version: SCHEMA_VERSION,
    app: '0.3.0',
    savedAt: '2026-11-07T00:00:00.000Z',
    settings: { global: {}, drone: {}, scene: {} },
    collections: { sonic: { v: 1, prefs: { ...defaultPrefs() }, progress: {}, current: null }, ui: { v: 1, warned: true } }
};
// (window.__name: tsx wraps named functions of a page.evaluate callback in __name(), which the page does not have)
const INIT = `(() => {
  window.__name = (f) => f;
  try { if (!localStorage.getItem('gsfpv.prefs.v1')) localStorage.setItem('gsfpv.prefs.v1', ${JSON.stringify(JSON.stringify(DOC))}); } catch (e) {}
  window.__speech = { texts: [] };
  try {
    const synth = window.speechSynthesis;
    const speak = synth.speak.bind(synth);
    synth.speak = (u) => { if (u.text) window.__speech.texts.push(u.text); return speak(u); };
  } catch (e) {}
})();`;

const checks: { name: string; pass: boolean; value?: unknown }[] = [];
const check = (name: string, pass: boolean, value?: unknown): void => {
    checks.push({ name, pass, value });
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${value === undefined ? '' : '  ' + JSON.stringify(value).slice(0, 400)}`);
};

await lock();
let failed = false;
try {
    const L = await launch({ width: 1280, height: 720 });
    await L.context.addInitScript(INIT);
    await L.context.addCookies([{ name: 'NEXT_LOCALE', value: LOCALE, url: LAB }]);
    // no connection to anything but the dev server: the scan cannot load
    await L.context.route('**/*', (route) => (new URL(route.request().url()).origin === LAB ? route.continue() : route.abort()));
    const page = L.page;
    await page.goto(`${LAB}/fly/?sonic=free-garden&nowarn=1`);
    await page.waitForSelector('[data-testid="sonic-start-asked"]', { timeout: 60000 });
    await page.focus('[data-testid="sonic-start-asked"]');
    await page.keyboard.press('Enter');
    // the flight fails to open and the start screen comes back
    await page.waitForFunction(() => !document.getElementById('sonic-start')!.hidden, undefined, { timeout: 90000 });
    await sleep(2500);
    const r = await page.evaluate(() => ({
        status: (document.querySelector('[data-testid="sonic-status"]')?.textContent ?? '').trim(),
        spoken: (window as unknown as { __speech: { texts: string[] } }).__speech.texts,
        captions: [...document.querySelectorAll('[data-testid="sonic-captions"] .sonic-caption')].map((e) => e.textContent ?? '')
    }));
    // the line the same failure gets from inside a flight (sonic-flight.ts scanLesson): the simulator's own dictionary, this language
    const dict = JSON.parse(readFileSync(join(REPO, 'packages', 'i18n', 'locales', 'fly', 'sonic', `${LOCALE}.json`), 'utf8')) as Record<string, string>;
    const scanFailed = dict['sonic.say.scanFailed'] ?? '';
    check('the start screen is shown again after the flight failed to open', true);
    check('what the pilot is told (the live region) is that sentence, not the raw message of an exception', scanFailed !== '' && r.status === scanFailed, { status: r.status, expected: scanFailed });
    check('the engine says it (speechSynthesis got exactly that line) and the captions carry it', scanFailed !== '' && r.spoken.includes(scanFailed) && r.captions.includes(scanFailed), { spoken: r.spoken, captions: r.captions });
    const errors = L.console.filter((l) => l.startsWith('pageerror'));
    check('no page errors', errors.length === 0, errors.slice(0, 5));
    failed = checks.some((c) => !c.pass);
    const file = writeEvidence(`sonic-review-launch${LOCALE === 'en' ? '' : `-${LOCALE}`}`, { lab: LAB, locale: LOCALE, expectedLine: scanFailed, observed: r, passed: checks.filter((c) => c.pass).length, total: checks.length, checks });
    console.log(`${checks.filter((c) => c.pass).length} of ${checks.length} checks pass; evidence ${file}`);
    await L.browser.close();
} finally {
    unlock();
}
process.exit(failed ? 1 : 0);
