// v0.12 v12-int (docs/wip/v12-int.md): the two lanes of Fly by Sound in ONE real page, headless Chrome, the keyboard only. The flight
// lane's mode, lessons and engine and the session lane's recorder run together here for the first time (each lane tested against
// stand-ins for the other). Scenarios, one per run (argv[2]):
//   status   step 3: key I says the lesson's line and then the recording's (status.recording-off, then -on once T, T records).
// The page is a RELEASE build served with nginx's enforced CSP (a Vite run reloads when a source file changes and kills the run):
//   node scripts/build-release.mjs
//   node tools/bench/scripts/serve-csp.mjs dist 5400                          (another shell)
//   cd tools/bench && SITE=http://localhost:5400 npx tsx src/sonic-int-page.ts status
// Holds the GPU lock (the page draws the helper's view). Evidence: evidence/<date>/sonic-int-<scenario>.json. "My screen reader
// speaks" is on and the speaking speed 2 (the engine says nothing aloud and waits the time a line takes), as the lane's own page
// runs: what is spoken is read from the mode's speech events (window.__gsfpv.sonic), nobody listens.
import { mkdirSync, rmdirSync, statSync } from 'node:fs';
import type { BrowserContext, Page } from 'playwright';
import { SCHEMA_VERSION } from '../../../packages/prefs/src';
import { defaultPrefs } from '../../../packages/sonic-fpv/src';
import { launchChrome } from './browser';
import { writeEvidence } from './evidence';

const SITE = (process.env.SITE ?? '').replace(/\/$/, '');
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(SITE)) throw new Error('SITE=http://localhost:<port> of a local release build is needed (never the live site)');
const SCENARIO = process.argv[2] ?? 'status';
console.log(`sonic-int-page target: ${SITE}, scenario ${SCENARIO}`);
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
                if (Date.now() - statSync(LOCK).mtimeMs > 30 * 60 * 1000) {
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
let locked = false;
const unlock = (): void => {
    if (!locked) return;
    locked = false;
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

/** The prefs document the page starts from: the engine silent (a screen reader would speak), double speed, the warning seen. */
export function prefsDoc(sonic: Record<string, unknown> = {}): object {
    return {
        format: 'gsfpv-prefs',
        version: SCHEMA_VERSION,
        app: '0.3.0',
        savedAt: '2026-11-07T00:00:00.000Z',
        settings: { global: {}, drone: {}, scene: {} },
        collections: { sonic: { v: 1, prefs: { ...defaultPrefs(), selfVoice: false, speechRate: 2, ...sonic }, progress: {}, current: null }, ui: { v: 1, warned: true } }
    };
}

export const initScript = (doc: object): string => `(() => {
  window.__name = (f) => f;
  try { if (!localStorage.getItem('gsfpv.prefs.v1')) localStorage.setItem('gsfpv.prefs.v1', ${JSON.stringify(JSON.stringify(doc))}); } catch (e) {}
  const Orig = window.AudioContext;
  window.__acCount = 0;
  if (Orig) window.AudioContext = class extends Orig { constructor(o) { super(o); window.__acCount++; } };
})();`;

export interface SpeechEvent {
    kind: string;
    t: number;
    key?: string;
    text?: string;
    what?: string;
    lessonId?: string;
    action?: string | null;
}
export interface Probe {
    lesson: string | null;
    phase: string | null;
    attempt: number;
    engine: string;
    speechQueue: number;
    events: SpeechEvent[];
}

export const probe = (page: Page, events = true): Promise<Probe> => page.evaluate((e) => (window as unknown as { __gsfpv: { sonic: (e?: boolean) => unknown } }).__gsfpv.sonic(e), events) as Promise<Probe>;

/** Polls `pred` in the page (no waitForFunction: the release's CSP refuses a predicate made with new Function). */
export async function until<T>(page: Page, what: string, read: () => Promise<T>, pred: (v: T) => boolean, ms = 30000): Promise<T> {
    const t0 = Date.now();
    for (;;) {
        const v = await read();
        if (pred(v)) return v;
        if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}: ${JSON.stringify(v).slice(0, 400)}`);
        await sleep(100);
    }
}

const checks: { name: string; pass: boolean; value?: unknown }[] = [];
const check = (name: string, pass: boolean, value?: unknown): void => {
    checks.push({ name, pass, value });
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${value === undefined ? '' : '  ' + JSON.stringify(value).slice(0, 300)}`);
};

/** Opens /en/fly/?sonic=<lesson> and starts it with Enter on the start screen's button (the user activation), keyboard only. */
async function openLesson(ctx: BrowserContext, lesson: string): Promise<{ page: Page; errors: string[] }> {
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message.slice(0, 300)));
    page.on('console', (m) => {
        // a failed request is logged as a console error without its address: the response handler below names it
        if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(`console: ${m.text()}`.slice(0, 300));
    });
    page.on('response', (r) => {
        if (r.status() >= 400 && !/\/favicon\.ico$/.test(r.url())) errors.push(`${r.status()} ${r.url()}`.slice(0, 300));
    });
    await page.goto(`${SITE}/en/fly/?sonic=${lesson}&nowarn=1`);
    await until(page, 'the start screen', () => page.evaluate(() => !!document.querySelector('[data-testid="sonic-start-asked"]')), (v) => v, 60000);
    await page.focus('[data-testid="sonic-start-asked"]');
    await page.keyboard.press('Enter');
    await until(page, 'the lesson', () => page.evaluate(() => { const h = (window as unknown as { __gsfpv?: { status?: string; sonic?: (e?: boolean) => { lesson: string | null } } }).__gsfpv; return h?.status === 'ready' && h.sonic ? h.sonic(false).lesson : null; }), (v) => v === lesson, 90000);
    return { page, errors };
}

const spokenSince = (p: Probe, n: number): SpeechEvent[] => p.events.slice(n).filter((e) => e.kind === 'speech' && e.key !== 'speech.end');
const recordingOn = (page: Page): Promise<boolean> => page.evaluate(() => document.querySelector('.sonicrec-toggle')?.classList.contains('recording') === true);

/** I: the speech events that came after the press, the status lines among them. */
async function pressI(page: Page): Promise<SpeechEvent[]> {
    const before = (await probe(page)).events.length;
    await page.keyboard.press('KeyI');
    await sleep(1500);
    return spokenSince(await probe(page), before).filter((e) => (e.key ?? '').startsWith('status.'));
}

async function scenarioStatus(ctx: BrowserContext): Promise<Record<string, unknown>> {
    const { page, errors } = await openLesson(ctx, 'hover-height');
    await sleep(1500);
    // the session side is loaded when ctx.sonic appears (its toggle button shows)
    await until(page, 'the recordings panel', () => page.evaluate(() => !!document.querySelector('.sonicrec-toggle')), (v) => v, 20000);
    const off = await pressI(page);
    check('I with no recording: the lesson\'s line, then "Recording is off", in one press and in that order', off.map((e) => e.key).join(',') === 'status.lesson,status.recording-off', off.map((e) => [e.key, e.text]));
    // T asks; a second T after the question has been read out is the yes (the recorder ignores a press while it is read)
    const n0 = (await probe(page)).events.length;
    await page.keyboard.press('KeyT');
    await until(page, 'the question', () => probe(page), (p) => spokenSince(p, n0).some((e) => e.key === 'rec.ask'), 15000);
    const t0 = Date.now();
    while (!(await recordingOn(page)) && Date.now() - t0 < 45000) {
        await sleep(2500);
        const p = await probe(page);
        if (await recordingOn(page)) break;
        if (spokenSince(p, n0).some((e) => e.key === 'rec.started')) break;
        await page.keyboard.press('KeyT');
    }
    const on = await until(page, 'the recording', () => recordingOn(page), (v) => v, 20000);
    const said = spokenSince(await probe(page), n0).map((e) => e.key);
    check('T, T: the recording runs (the panel\'s button says recording, the recorder said rec.ask and rec.started)', on && said.includes('rec.ask') && said.includes('rec.started'), said);
    await sleep(1000);
    const onLines = await pressI(page);
    check('I while recording: the lesson\'s line, then "Recording is on", in one press and in that order', onLines.map((e) => e.key).join(',') === 'status.lesson,status.recording-on', onLines.map((e) => [e.key, e.text]));
    check('no page error and no console error', errors.length === 0, errors);
    return { off, on: onLines, said };
}

const SCENARIOS: Record<string, (ctx: BrowserContext) => Promise<Record<string, unknown>>> = { status: scenarioStatus };

async function main(): Promise<void> {
    const run = SCENARIOS[SCENARIO];
    if (!run) throw new Error(`unknown scenario ${SCENARIO}: ${Object.keys(SCENARIOS).join(', ')}`);
    await lock();
    locked = true;
    const { browser } = await launchChrome({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
    try {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
        await ctx.grantPermissions(['microphone'], { origin: SITE });
        await ctx.addInitScript({ content: initScript(prefsDoc()) });
        const result = await run(ctx);
        const passed = checks.filter((c) => c.pass).length;
        const file = writeEvidence(`sonic-int-${SCENARIO}`, { site: SITE, scenario: SCENARIO, checks, passed, total: checks.length, result });
        console.log(`${passed} of ${checks.length} checks passed; ${file}`);
        process.exitCode = passed === checks.length ? 0 : 1;
    } finally {
        await browser.close().catch(() => undefined);
        unlock();
    }
}

main().catch((e) => {
    unlock();
    console.error(e);
    process.exit(2);
});
