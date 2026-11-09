// v0.12 v12-int (docs/wip/v12-int.md): the two lanes of Fly by Sound in ONE real page, headless Chrome, the keyboard only. The flight
// lane's mode, lessons and engine and the session lane's recorder run together here for the first time (each lane tested against
// stand-ins for the other). Scenarios, one per run (argv[2]):
//   status   step 3: key I says the lesson's line and then the recording's (status.recording-off, then -on once T, T records).
//   lazy     step 4: a page without ?sonic= (a scan flown, logic only) downloads no script or style that holds the sound package, the
//            mode or the recorder (markers searched in every script and style it fetched); control: a ?sonic= page does, and its
//            lesson runs; a start chunk that does not load shows and says sonic.say.lessonFailed; a mode chunk that does not load
//            says it through the engine and shows the start screen again, and the next Enter opens the lesson.
//   replay   step 5: rings-first flown, T, T (the lesson opens again from its beginning), flown to its pass, rings-line opened by the
//            page, flown 8 s, T and the survey declined; then a new page on hover-height (lesson C), the recording opened from the
//            helper's panel and played to its end: each lesson's world drawn in turn, every event and the cues per lesson, the voice
//            (tone bursts given as the microphone) measured where it comes out against the package's clock; the saved package is
//            checked again in Node, and the package's own one-lesson check of the same bytes is the control.
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
import { DICTS, createTranslator, defaultPrefs, getLesson, lessonPaths } from '../../../packages/sonic-fpv/src';
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

/**
 * Since v0.13 (v13-host W6) I says the runner's status line: status.progress-step in the task, status.progress once an attempt began
 * ("Lesson 6 of 28: Hold your height. Step 1 of 2."), where v0.12 said status.lesson. hover-height's place on the pilot's path and its title.
 */
const PLACE = `Lesson ${lessonPaths().full.indexOf('hover-height') + 1} of ${lessonPaths().full.length}: ${createTranslator('en', DICTS).text(getLesson('hover-height').title)}. Step `;
const isRunnerLine = (e: SpeechEvent | undefined): boolean => (e?.key === 'status.progress-step' || e?.key === 'status.progress') && (e.text ?? '').startsWith(PLACE) && (e.key === 'status.progress' ? /Attempt \d+\. Counted \d+ of \d+\.$/.test(e.text ?? '') : /Step \d+ of \d+\.$/.test(e.text ?? ''));

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
    check('I with no recording: the runner\'s status line (lesson k of n and its step), then "Recording is off", in one press and in that order', off.length === 2 && isRunnerLine(off[0]) && off[1]?.key === 'status.recording-off', off.map((e) => [e.key, e.text]));
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
    check('I while recording: the runner\'s status line (lesson k of n and its step), then "Recording is on", in one press and in that order', onLines.length === 2 && isRunnerLine(onLines[0]) && onLines[1]?.key === 'status.recording-on', onLines.map((e) => [e.key, e.text]));
    check('no page error and no console error', errors.length === 0, errors);
    return { off, on: onLines, said };
}

/** Strings that survive minification and live only in the sound package, the mode or the recorder (not in the main chunk's own code or dictionaries). */
const MARKERS = {
    package: ['shramko-sonic-session/1', 'Answer with a number key', 'ears-headphones'],
    mode: ['sonicRays', 'sonic-captions', 'pause.sonic'],
    recorder: ['voice-sync.jsonl', 'sonicrec-toggle', 'sonicrec.status.asking']
} as const;
const ALL_MARKERS: string[] = Object.values(MARKERS).flat();

/** Every script and style the page fetched, with the markers found in each. */
function collectAssets(page: Page): { list: { url: string; bytes: number; found: string[] }[]; done: () => Promise<void> } {
    const list: { url: string; bytes: number; found: string[] }[] = [];
    const pending: Promise<void>[] = [];
    page.on('response', (r) => {
        const type = r.request().resourceType();
        if (type !== 'script' && type !== 'stylesheet') return;
        pending.push(
            r
                .text()
                .then((body) => {
                    list.push({ url: new URL(r.url()).pathname, bytes: body.length, found: ALL_MARKERS.filter((m) => body.includes(m)) });
                })
                .catch(() => undefined)
        );
    });
    return { list, done: async () => void (await Promise.all(pending)) };
}

/** A chunk's name without its hash: /fly/assets/feature-xOyQzkAI.js -> feature.js */
const chunkName = (url: string): string => url.replace(/^.*\//, '').replace(/-[\w-]{8}\.(js|css)$/, '.$1');
const LESSON_FAILED_EN = 'The lesson did not open. Choose it again, or choose another one.';
const lessonNow = (page: Page): Promise<string | null> =>
    page.evaluate(() => {
        const h = (window as unknown as { __gsfpv?: { status?: string; sonic?: (e?: boolean) => { lesson: string | null } } }).__gsfpv;
        return h?.status === 'ready' && h.sonic ? h.sonic(false).lesson : null;
    });
const startShown = (page: Page): Promise<boolean> => page.evaluate(() => !!document.querySelector('[data-testid="sonic-start-asked"]'));

async function scenarioLazy(ctx: BrowserContext): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {};
    // A: an ordinary flight, no ?sonic=: a scan (39e63ce9, as accept-fly flies it), logic only, until the page is ready
    {
        const page = await ctx.newPage();
        const assets = collectAssets(page);
        const errors: string[] = [];
        page.on('pageerror', (e) => errors.push(e.message.slice(0, 300)));
        await page.goto(`${SITE}/en/fly/?scene=39e63ce9&nowarn=1&input=touch&render=off`);
        await until(page, 'the flight', () => page.evaluate(() => (window as unknown as { __gsfpv?: { status?: string } }).__gsfpv?.status ?? null), (v) => v === 'ready', 120000);
        await sleep(3000);
        await assets.done();
        const hook = await page.evaluate(() => typeof (window as unknown as { __gsfpv: { sonic?: unknown } }).__gsfpv.sonic);
        const holding = assets.list.filter((a) => a.found.length > 0);
        const names = assets.list.map((a) => chunkName(a.url));
        out.plain = { fetched: assets.list.map((a) => [a.url, a.bytes]), holding };
        check('A: a flight without ?sonic= fetched no script or style holding the sound package, the mode or the recorder', assets.list.length >= 3 && holding.length === 0, { fetched: names, holding });
        check('A: no chunk of Fly by Sound was requested (lazy-start, feature, session) and the mode is not installed (no test hook)', !names.some((n) => /^(lazy-start|feature|session)\./.test(n)) && hook === 'undefined', { hook });
        check('A: no page error', errors.length === 0, errors);
        await page.close();
    }
    // B, the control: a ?sonic= page fetches them, and the lesson runs
    {
        const page = await ctx.newPage();
        const assets = collectAssets(page);
        await page.goto(`${SITE}/en/fly/?sonic=hover-height&nowarn=1`);
        await until(page, 'the start screen', () => startShown(page), (v) => v, 60000);
        await page.focus('[data-testid="sonic-start-asked"]');
        await page.keyboard.press('Enter');
        const lesson = await until(page, 'the lesson', () => lessonNow(page), (v) => v === 'hover-height', 90000);
        await until(page, 'the recordings panel', () => page.evaluate(() => !!document.querySelector('.sonicrec-toggle')), (v) => v, 20000);
        const panelText = await page.evaluate(() => document.querySelector('.sonicrec-toggle')?.textContent ?? '');
        await assets.done();
        const found = new Set(assets.list.flatMap((a) => a.found));
        const names = assets.list.map((a) => chunkName(a.url));
        out.control = { fetched: assets.list.map((a) => [a.url, a.bytes, a.found]) };
        check('B (control): a ?sonic= page fetches the start chunk, the mode and the session side, every marker is found, the lesson runs', lesson === 'hover-height' && ['lazy-start.js', 'feature.js', 'session.js'].every((n) => names.includes(n)) && ALL_MARKERS.every((m) => found.has(m)), { names, missing: ALL_MARKERS.filter((m) => !found.has(m)) });
        check('B: the recorder\'s texts arrived with its chunk (the panel\'s button reads "Recording", not a key)', panelText.trim() === 'Recording', panelText);
        await page.close();
    }
    // C: the start chunk does not load
    {
        const page = await ctx.newPage();
        await page.addInitScript({ content: 'window.__spoken = []; try { const s = window.speechSynthesis; const sp = s.speak.bind(s); s.speak = (u) => { window.__spoken.push(u.text); return sp(u); }; } catch (e) {}' });
        await page.route('**/fly/assets/lazy-start-*.js', (r) => r.abort());
        await page.goto(`${SITE}/en/fly/?sonic=start&nowarn=1`);
        const box = await until(
            page,
            'the note',
            () => page.evaluate(() => ({ text: document.querySelector('[data-testid="sonic-unavailable"] p')?.textContent ?? null, role: document.querySelector('[data-testid="sonic-unavailable"]')?.getAttribute('role') ?? null, focus: document.activeElement?.tagName ?? null })),
            (v) => v.text !== null,
            30000
        );
        // a letter, not Space or Enter: those would press "Try again" (the focused button), which reloads the page
        await page.keyboard.press('KeyA');
        await sleep(300);
        const spoken = await page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken);
        out.startFailed = { box, spoken };
        check('C: the start chunk refused: an alert says sonic.say.lessonFailed, the focus on "Try again"', box.text === LESSON_FAILED_EN && box.role === 'alert' && box.focus === 'BUTTON', box);
        check('C: the browser\'s voice is asked to say it, at once and again at the first key', spoken.filter((t) => t === LESSON_FAILED_EN).length >= 2, spoken);
        await page.close();
    }
    // D: the mode's chunk does not load: the start screen says so through the engine and comes back; the next Enter opens the lesson
    {
        const page = await ctx.newPage();
        let blocked = true;
        let refused = 0;
        await page.route('**/fly/assets/feature-*.js', (r) => {
            if (!blocked) return r.continue();
            refused++;
            return r.abort();
        });
        await page.goto(`${SITE}/en/fly/?sonic=hover-height&nowarn=1`);
        await until(page, 'the start screen', () => startShown(page), (v) => v, 60000);
        await sleep(500);
        await page.focus('[data-testid="sonic-start-asked"]');
        await page.keyboard.press('Enter');
        const said = await until(
            page,
            'the failure line',
            () => page.evaluate(() => ({ captions: document.querySelector('[data-testid="sonic-captions"]')?.textContent ?? '', screen: !(document.querySelector('.sonic-start') as HTMLElement | null)?.hidden, hook: typeof (window as unknown as { __gsfpv: { sonic?: unknown } }).__gsfpv.sonic })),
            (v) => v.captions.includes(LESSON_FAILED_EN),
            30000
        );
        check('D: the mode\'s chunk refused: the engine says sonic.say.lessonFailed (in the captions, the screen reader\'s region here), the start screen is back, no flight', said.screen === true && said.hook === 'undefined' && refused >= 1, { ...said, refused });
        blocked = false;
        await page.focus('[data-testid="sonic-start-asked"]');
        await page.keyboard.press('Enter');
        const lesson = await until(page, 'the lesson after the retry', () => lessonNow(page), (v) => v !== null, 60000).catch(() => null);
        out.modeFailed = { said, refused, lessonAfterRetry: lesson };
        check('D: the next Enter, with the chunk reachable again, opens the lesson', lesson === 'hover-height', lesson);
        await page.close();
    }
    return out;
}

// ------------------------------------------------------------------ replay (step 5)

/** The microphone is a 1 kHz tone in bursts of 80 ms every 1.5 s (the ground truth of the voice's timing), and the replay's voice is watched. */
const VOICE_INIT = `(() => {
  window.__voice = { decoded: null, fileOnsets: [], starts: [], onsets: [], tap: null };
  try { delete window.showSaveFilePicker; } catch (e) {}
  const md = navigator.mediaDevices;
  if (md) md.getUserMedia = async () => {
    const ac = new AudioContext();
    const osc = ac.createOscillator();
    osc.frequency.value = 1000;
    const gain = ac.createGain();
    gain.gain.value = 0;
    const dest = ac.createMediaStreamDestination();
    osc.connect(gain);
    gain.connect(dest);
    osc.start();
    const t0 = ac.currentTime + 0.5;
    for (let i = 0; i < 400; i++) { gain.gain.setValueAtTime(0.9, t0 + i * 1.5); gain.gain.setValueAtTime(0, t0 + i * 1.5 + 0.08); }
    return dest.stream;
  };
  const dec = BaseAudioContext.prototype.decodeAudioData;
  BaseAudioContext.prototype.decodeAudioData = function (data, ...rest) {
    const ctx = this;
    return dec.call(this, data, ...rest).then((buf) => {
      if (buf.duration > 2) {
        window.__voice.decoded = buf;
        const ch = buf.getChannelData(0), sr = buf.sampleRate, on = [];
        let quiet = -1e9;
        for (let i = 0; i < ch.length; i++) if (Math.abs(ch[i]) > 0.2) { const t = i / sr; if (t > quiet) on.push(t); quiet = t + 0.3; }
        window.__voice.fileOnsets = on;
        ctx.audioWorklet.addModule('/fly/assets/int-tap.js').then(() => {
          const node = new AudioWorkletNode(ctx, 'int-tap', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
          const mute = ctx.createGain();
          mute.gain.value = 0;
          node.connect(mute);
          mute.connect(ctx.destination);
          node.port.onmessage = (e) => window.__voice.onsets.push(e.data.onset);
          window.__voice.tap = node;
        });
      }
      return buf;
    });
  };
  const start = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (when, offset, duration) {
    if (this.buffer && this.buffer === window.__voice.decoded) {
      window.__voice.starts.push({ when, offset, now: this.context.currentTime });
      if (window.__voice.tap) this.connect(window.__voice.tap);
    }
    return start.call(this, when, offset, duration);
  };
})();`;
/** The tap: the exact audio time at which the voice first rises above 0.2 after 0.3 s of quiet (a burst's onset); served from the page's origin. */
const TAP = `class IntTap extends AudioWorkletProcessor {
  constructor() { super(); this.quietUntil = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) for (let i = 0; i < ch.length; i++) if (Math.abs(ch[i]) > 0.2) { const at = currentTime + i / sampleRate; if (at > this.quietUntil) this.port.postMessage({ onset: at }); this.quietUntil = at + 0.3; }
    return true;
  }
}
registerProcessor('int-tap', IntTap);
`;

interface ReplayHook {
    state: { stage: string; title: string; check: { ok: boolean; summary: string } | null; notes: string[]; details: string; player: { phase: string; tMs: number; durationMs: number; lesson: string | null; part: number; parts: number; frame: number; frames: number } | null };
    trace: { fed: { t: number; ac: number; part: number }[]; switches: { t: number; ac: number; part: number; lesson: string | null; world: string | null; shown: boolean }[]; voiceStarts: { t: number; ac: number }[] } | null;
    checks: { lesson: string | null; frames: number; compared: boolean; ok: boolean | null; recorded: number; matched: number; diffs: number; cueShare: number | null; cueClassShare: number | null }[];
}
const replayHook = (page: Page): Promise<ReplayHook | null> => page.evaluate(() => (window as unknown as { __gsfpv: { sonicReplay?: () => unknown } }).__gsfpv.sonicReplay?.() ?? null) as Promise<ReplayHook | null>;

async function pressOn(page: Page, selector: string): Promise<void> {
    await page.focus(selector);
    await page.keyboard.press('Enter');
}

async function scenarioReplay(ctx: BrowserContext): Promise<Record<string, unknown>> {
    const { mkdirSync: mk, writeFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { REPO, today } = await import('./evidence');
    const shots = join(REPO, 'evidence', today(), 'sonic-int-replay');
    mk(shots, { recursive: true });
    await ctx.addInitScript({ content: VOICE_INIT });
    // the tap's module from the page's own origin (a worklet's request does not pass Playwright's routes): written into the served build
    // for this run, removed after it (dist/ is the local build, untracked)
    const tapFile = join(REPO, 'dist', 'fly', 'assets', 'int-tap.js');
    writeFileSync(tapFile, TAP);
    try {
        return await replayRun(ctx, shots);
    } finally {
        const { rmSync } = await import('node:fs');
        rmSync(tapFile, { force: true });
    }
}

async function replayRun(ctx: BrowserContext, shots: string): Promise<Record<string, unknown>> {
    const { writeFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const out: Record<string, unknown> = {};
    // 1. record: rings-first, then rings-line after its pass
    const { page, errors } = await openLesson(ctx, 'rings-first');
    await until(page, 'the recordings panel', () => page.evaluate(() => !!document.querySelector('.sonicrec-toggle')), (v) => v, 20000);
    await sleep(1500);
    const n0 = (await probe(page)).events.length;
    await page.keyboard.press('KeyT');
    await until(page, 'the question', () => probe(page), (p) => spokenSince(p, n0).some((e) => e.key === 'rec.ask'), 15000);
    for (let t0 = Date.now(); !(await recordingOn(page)) && Date.now() - t0 < 45000; ) {
        await sleep(2500);
        if ((await recordingOn(page)) || spokenSince(await probe(page), n0).some((e) => e.key === 'rec.started')) break;
        await page.keyboard.press('KeyT');
    }
    await until(page, 'the recording', () => recordingOn(page), (v) => v, 20000);
    const reopened = await until(page, 'rings-first opened again', () => probe(page), (p) => p.events.slice(n0).some((e) => e.kind === 'lesson' && e.what === 'open' && e.lessonId === 'rings-first'), 10000);
    check('the recording started and rings-first opened again from its beginning (a lesson open inside the recording)', !!reopened);
    // W held through the ring until rings-line has opened, then 8 s of rings-line
    await page.keyboard.down('KeyW');
    await until(page, 'rings-line', () => page.evaluate(() => (window as unknown as { __gsfpv: { sonic: (e?: boolean) => { lesson: string | null } } }).__gsfpv.sonic(false).lesson), (l) => l === 'rings-line', 240000);
    await sleep(8000);
    await page.keyboard.up('KeyW');
    // T stops; the survey is offered (the voice still recorded) and declined with 2
    await page.keyboard.press('KeyT');
    const offer = await until(page, 'the survey offer', () => probe(page), (p) => p.events.some((e) => e.kind === 'speech' && e.key === 'survey.offer'), 20000);
    const surveyLines = offer.events.filter((e) => e.kind === 'speech' && (e.key ?? '').startsWith('survey.')).map((e) => e.key);
    await sleep(1500);
    await page.keyboard.press('Digit2');
    await until(page, 'the recording saved', () => page.evaluate(() => document.querySelectorAll('.sonicrec-session').length), (n) => n >= 1, 30000);
    await until(page, 'the recorder idle', () => recordingOn(page), (v) => !v, 30000);
    await sleep(1000);
    check('the survey offer came with the microphone notice before it (survey.mic-on, step 2)', surveyLines.indexOf('survey.mic-on') >= 0 && surveyLines.indexOf('survey.mic-on') < surveyLines.indexOf('survey.offer'), surveyLines);
    // the saved package, for the check in Node (the panel's Save: a download here)
    await page.evaluate(() => { const b = document.querySelector('.sonicrec-toggle') as HTMLElement | null; if (b && document.querySelector('.sonicrec-panel')?.hasAttribute('hidden')) b.click(); });
    const dl = page.waitForEvent('download', { timeout: 30000 });
    await pressOn(page, '.sonicrec-session [data-action="save"]');
    // a package with a voice is never committed, even a synthetic one: it goes to the system's temporary folder
    const saved = join((await import('node:os')).tmpdir(), `sonic-int-replay-${Date.now()}.zip`);
    await (await dl).saveAs(saved);
    out.recordErrors = [...errors];
    await page.close();

    // 2. lesson C on a new page; the recording opened from the panel and played to its end
    const { page: p2, errors: errors2 } = await openLesson(ctx, 'hover-height');
    await until(p2, 'the recordings panel', () => p2.evaluate(() => !!document.querySelector('.sonicrec-toggle')), (v) => v, 20000);
    const cPrims = (await p2.evaluate(() => (window as unknown as { __gsfpv: { sonic: (e?: boolean) => { stagePrims: number } } }).__gsfpv.sonic(false).stagePrims));
    await p2.evaluate(() => (document.querySelector('.sonicrec-toggle') as HTMLElement).click());
    await until(p2, 'the replay button', () => p2.evaluate(() => !!document.querySelector('.sonicrec-session [data-action="replay"]')), (v) => v, 20000);
    await pressOn(p2, '.sonicrec-session [data-action="replay"]');
    const ready = await until(p2, 'the replay checked', () => replayHook(p2), (h) => h?.state.stage === 'ready' || h?.state.stage === 'error', 60000);
    out.check = { summary: ready?.state.check, notes: ready?.state.notes, details: ready?.state.details, checks: ready?.checks, title: ready?.state.title };
    const rows = ready?.checks ?? [];
    check('the replay is checked lesson by lesson: rings-first then rings-line, each compared, every recorded event re-derived (no difference)', rows.map((r) => r.lesson).join(',') === 'rings-first,rings-line' && rows.every((r) => r.compared && r.diffs === 0 && r.matched === r.recorded && r.recorded > 0), rows);
    check('100 % of the sounds per lesson (the cue ids of every frame, within the comparer\'s one-frame slack) and the panel says the replay agrees', rows.length === 2 && rows.every((r) => r.cueShare === 1) && ready?.state.check?.ok === true, { rows: rows.map((r) => [r.lesson, r.cueShare, r.cueClassShare]), summary: ready?.state.check });
    check('no "another place" note: the page draws both lessons\' worlds itself', !(ready?.state.notes ?? []).some((n) => /another place/i.test(n)), ready?.state.notes);
    await pressOn(p2, '[data-action="replay-toggle"]');
    let lastLesson: string | null = null;
    const prims: Record<string, number> = {};
    const t0 = Date.now();
    for (;;) {
        const h = await replayHook(p2);
        const pl = h?.state.player;
        if (pl && pl.lesson !== lastLesson && pl.phase === 'playing') {
            lastLesson = pl.lesson;
            await sleep(1500);
            prims[pl.lesson ?? '-'] = await p2.evaluate(() => (window as unknown as { __gsfpv: { sonic: (e?: boolean) => { stagePrims: number } } }).__gsfpv.sonic(false).stagePrims);
            writeFileSync(join(shots, `replay-${pl.lesson}.png`), await p2.screenshot({ type: 'png' }));
        }
        if (!pl || pl.phase === 'ended' || Date.now() - t0 > 360000) break;
        await sleep(200);
    }
    const end = await replayHook(p2);
    const tr = end?.trace;
    const voice = await p2.evaluate(() => {
        const v = (window as unknown as { __voice: { fileOnsets: number[]; starts: { when: number; offset: number; now: number }[]; onsets: number[] } }).__voice;
        return { fileOnsets: v.fileOnsets, starts: v.starts, onsets: v.onsets };
    });
    out.replay ={ phase: end?.state.player?.phase, switches: tr?.switches, voiceStarts: tr?.voiceStarts, fed: tr?.fed.length, prims, cPrims, voice: { fileOnsets: voice.fileOnsets, starts: voice.starts, onsets: voice.onsets } };
    check('played to its end', end?.state.player?.phase === 'ended', end?.state.player);
    const sw = tr?.switches ?? [];
    check('each lesson\'s world drawn in turn: rings-first, then rings-line when its first frame was due (both shown by the page\'s view), other primitives than lesson C\'s', sw.map((s) => `${s.lesson}:${s.shown}`).join(',') === 'rings-first:true,rings-line:true' && sw[0]?.world !== sw[1]?.world && prims['rings-first'] !== undefined && prims['rings-line'] !== undefined, { switches: sw.map((s) => [s.lesson, s.world, s.shown, s.t]), prims, cPrims });
    // frames fed on the package clock: the reference of the voice's start (package time t was audio time ac)
    const ref = tr?.voiceStarts[0];
    const fedLag = ref && tr ? tr.fed.map((f) => (ref.t + (f.ac - ref.ac) * 1000) - f.t) : [];
    const sorted = [...fedLag].sort((a, b) => a - b);
    out.fedLag = { n: fedLag.length, min: sorted[0], p50: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.floor(sorted.length * 0.95)], max: sorted.at(-1) };
    check('every frame of both lessons fed once, in order, never before its package time and within 200 ms after it on the audio clock', !!tr && tr.fed.length === (end?.state.player?.frames ?? -1) && Math.min(...fedLag) >= -1 && Math.max(...fedLag) <= 200, out.fedLag);
    // close: the mode's own view back
    await pressOn(p2, '[data-action="replay-close"]');
    await sleep(800);
    const after = await p2.evaluate(() => (window as unknown as { __gsfpv: { sonic: (e?: boolean) => { stagePrims: number } } }).__gsfpv.sonic(false).stagePrims);
    check('closed: lesson C\'s own view is back', after === cPrims, { after, cPrims });
    out.replayErrors = [...errors2];
    check('no page error and no console error in either page', errors.length === 0 && errors2.length === 0, { record: errors, replay: errors2 });
    await p2.close();

    // 3. in Node, the saved bytes: the same check as the page, and the control
    const { readFileSync } = await import('node:fs');
    const { readPackage, checkSession } = await import('../../../packages/sonic-fpv/src');
    const { checkPackage } = await import('../../../apps/fly/src/sonic-session/replay-check');
    const pkg = readPackage(new Uint8Array(readFileSync(saved)));
    const mine = await checkPackage(pkg);
    const old = checkSession(pkg);
    out.node = { frames: pkg.frames.length, events: pkg.events.length, voiceBytes: pkg.voice?.length ?? 0, voiceOffsetMs: pkg.manifest.clock.voiceOffsetMs, segments: mine.segments.map((s) => ({ lesson: s.segment.lessonId, frames: s.segment.frames.length, ok: s.check?.ok, diffs: s.check?.events.diffs.length, share: s.check?.cues.share })), oldCheck: { ok: old.check.ok, diffs: old.check.events.diffs.length, notes: old.check.notes.map((n) => n.code), share: old.check.cues.share } };
    check('Node, the saved package: the lesson-by-lesson check says what the page said', mine.check?.ok === ready?.state.check?.ok && mine.segments.length === 2, out.node);
    check('control: the package\'s own one-lesson check of the same bytes (the replay before this step) does not agree', !old.check.ok && old.check.notes.some((n) => n.code === 'other-lesson-events'), out.node);
    // 4. the voice: where each burst came out of the AudioContext, on the package's clock, against where the package puts it
    const vo = pkg.manifest.clock.voiceOffsetMs ?? 0;
    const expected = voice.fileOnsets.map((f) => vo + f * 1000);
    const heard = ref ? voice.onsets.map((a) => ref.t + (a - ref.ac) * 1000) : [];
    const errs = heard.map((h) => expected.reduce((best, e) => (Math.abs(h - e) < Math.abs(best) ? h - e : best), Infinity));
    const lastA = (pkg.frames.filter((f) => f.t < (sw[1]?.t ?? Infinity)).at(-1)?.t ?? 0);
    out.voiceSync = { bursts: expected.length, heard: heard.length, inLessonB: heard.filter((h) => h > lastA).length, maxAbsErrMs: Math.max(...errs.map(Math.abs)), errorsMs: errs.map((e) => Math.round(e * 10) / 10) };
    check('the voice: every burst heard within 200 ms of its place on the package clock, over both lessons', heard.length >= 10 && heard.length >= expected.length - 2 && Math.max(...errs.map(Math.abs)) <= 200 && heard.some((h) => h > lastA), out.voiceSync);
    return { ...out, savedZip: saved };
}

const SCENARIOS: Record<string, (ctx: BrowserContext) => Promise<Record<string, unknown>>> = { status: scenarioStatus, lazy: scenarioLazy, replay: scenarioReplay };

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
