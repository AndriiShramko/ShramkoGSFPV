// v0.12 v12-int REVIEW probes in the joined page (docs/wip/v12-int-review.md). Each probe is an attempt to break a claim of the int branch in the
// real page: the release build of this tree behind tools/bench/scripts/serve-csp.mjs (nginx's enforced CSP and headers), headless Chrome with a
// fake microphone, the keyboard only, the GPU lock held. Nothing goes to the live site or API: no /api is served at all.
//
//   R1  a digit pressed for the survey must not answer a question the lesson has asked
//       ears-headphones; T, T records; the lesson asks its first question; T stops; the survey offer is answered with 1 and two questions with
//       digits. Control (a page of its own): the same digit with no survey running DOES answer the question, so the probe can see an answer.
//
//   R2  the consent question comes at once when T is pressed, even while the lesson is talking
//       the engine speaks with the browser's own voices (the default of a pilot; speed 0.75); walls-hall opens and says its intro; T is pressed in
//       the middle of it, then pressed again at intervals; speechSynthesis is watched (when each utterance starts). Control: the same T with the
//       lesson silent (its intro heard to the end) is answered within a second.
//
//   R3  a minor's two-line question in "my screen reader speaks" mode is read out after BOTH lines, one after the other
//       the engine silent (a screen reader would read the captions, one line after the other); a guardian-confirmed profile under 18; T asks (rec.minor,
//       rec.ask); a second T after the first line has been read (the estimate at the pilot's speed) but before the question has is not a yes.
//
//   R4  the notice that the microphone stays on (survey.mic-on) is spoken even when the lesson is talking at the stop and the offer is answered at once
//       the engine speaks with the browser's own voice; a recording is started, its lesson opens again and says its intro; T stops it a moment later and
//       1 answers the offer a moment after that; speechSynthesis is watched for the notice.
//
//   R5  a recording made with the browser's own voice (the default of a pilot; the end-to-end run is silent) replays as it was flown
//       ears-headphones recorded and passed with the engine speaking (speed 2), the survey declined; the panel's Replay checks the recording lesson by lesson.
//
//   R6  (sonic-keys) a digit pressed while the headphone check plays a trial's sound answers that trial at once, before its question is said, and
//       "Taken: 1" says so; a digit out of range during the next sound answers nothing and is said back, not dropped in silence.
//
//   R7  (sonic-keys) after a failed headphone check only the trials answered wrong are asked again, without the intro, and right answers pass it.
//
//   R8  (sonic-hints) the keys of the moment are said at the start of every lesson step, once a step (Z does not repeat them, N does), and X
//       leaves the lesson for the mode's main menu in one press, saying the lesson is saved.
//
//   R9  (sonic-beacon) the target hum shows the way: in the corridor (no gate) it sounds while flying, from a side when the pilot turns, never
//       from behind; with the setting off it does not; in rings-line a one-off note of the hum (the preview of the ring after the next)
//       is planned after the first ring. The page's hook reports the hum (feature.ts); the live site before the lane has none.

// Run from tools/bench after `node scripts/build-release.mjs`:   npx tsx src/sonic-int-review.ts [r1|r2|r3|r4|r5|r6|r7|r8|r9]
// SITE=https://gsfpv.flyreelstudio.eu runs a probe against that site instead (after a release; nothing is written to the site).
// Port 5420. Exit 1 when a check fails; the evidence is evidence/<date>/sonic-int-review.json.
import { mkdirSync, rmdirSync, statSync } from 'node:fs';
import type { BrowserContext, Page } from 'playwright';
import { SCHEMA_VERSION } from '../../../packages/prefs/src';
import { DICTS, createTranslator, defaultPrefs } from '../../../packages/sonic-fpv/src';
import { estimateSpeechS } from '../../../packages/sonic-fpv/src/audio/speech';
import { launchChrome } from './browser';
import { gitSha, REPO, writeEvidence } from './evidence';
import { serveDist } from './sonicrec-serve';
import type { Served } from './sonicrec-serve';

// PORT=<n> moves the local server (lanes of a train run on their own ports); 5420 when unset
const PORT = Number(process.env.PORT ?? '') > 0 ? Number(process.env.PORT) : 5420;
const DIST = `${REPO}/dist`;
const LOCK = 'C:/dev/.gpu-lock';
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now();
const log = (...a: unknown[]): void => console.log(`[${((Date.now() - T0) / 1000).toFixed(0).padStart(4)}s]`, ...a);

interface Check {
    name: string;
    pass: boolean;
    value?: unknown;
}
const checks: Check[] = [];
const check = (name: string, pass: boolean, value?: unknown): boolean => {
    checks.push({ name, pass, value });
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${value === undefined ? '' : '  ' + JSON.stringify(value).slice(0, 400)}`);
    return pass;
};

async function lock(): Promise<void> {
    for (let waited = 0; ; waited++) {
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
            if (waited % 600 === 0) log('waiting for the GPU lock');
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

/** The prefs document: the engine silent (a screen reader would speak) at double speed, the first-visit warning seen. */
function prefsDoc(over: Record<string, unknown> = {}): object {
    return {
        format: 'gsfpv-prefs',
        version: SCHEMA_VERSION,
        app: '0.3.0',
        savedAt: '2026-11-08T00:00:00.000Z',
        settings: { global: {}, drone: {}, scene: {} },
        collections: { sonic: { v: 1, prefs: { ...defaultPrefs(), selfVoice: false, speechRate: 2, ...over }, progress: {}, current: null }, ui: { v: 1, warned: true } }
    };
}

/** Before the page's scripts: the prefs, optionally a pilot profile, and an accumulator of every event of the mode (the page's own log keeps 600). */
const initScript = (prefs: object, profile: object | null): string => `(() => {
  window.__name = (f) => f;
  try {
    if (!localStorage.getItem('gsfpv.prefs.v1')) localStorage.setItem('gsfpv.prefs.v1', ${JSON.stringify(JSON.stringify(prefs))});
    ${profile === null ? '' : `if (!localStorage.getItem('gsfpv.sonicrec.profile')) localStorage.setItem('gsfpv.sonicrec.profile', ${JSON.stringify(JSON.stringify(profile))});`}
  } catch (e) {}
  try { delete window.showSaveFilePicker; } catch (e) {}
  window.__rv = { events: [], last: null };
  window.__utt = [];
  try {
    const synth = window.speechSynthesis;
    const speak = synth.speak.bind(synth);
    synth.speak = (u) => {
      const row = { text: u.text, called: performance.now(), started: null, ended: null };
      window.__utt.push(row);
      u.addEventListener('start', () => { row.started = performance.now(); });
      u.addEventListener('end', () => { row.ended = performance.now(); });
      u.addEventListener('error', () => { row.ended = performance.now(); row.error = true; });
      return speak(u);
    };
  } catch (e) {}
  setInterval(() => {
    const h = window.__gsfpv && window.__gsfpv.sonic;
    if (!h) return;
    const ev = h(true).events;
    if (ev.length === 0) return;
    const rv = window.__rv;
    let from = 0;
    if (rv.last !== null) {
      from = ev.length;
      for (let i = ev.length - 1; i >= 0; i--) if (JSON.stringify(ev[i]) === rv.last) { from = i + 1; break; }
      if (from === ev.length && JSON.stringify(ev[ev.length - 1]) !== rv.last) from = 0;
    }
    for (let i = from; i < ev.length; i++) rv.events.push(ev[i]);
    rv.last = JSON.stringify(ev[ev.length - 1]);
  }, 40);
})();`;

interface Ev {
    kind: string;
    t: number;
    key?: string;
    what?: string;
    lessonId?: string;
    item?: string;
    via?: string;
    value?: number | null;
}
interface Probe {
    lesson: string | null;
    phase: string | null;
    attempt: number;
    asking: boolean;
    question: { id: string; options: number } | null;
    engine: string;
    speechQueue: number;
}
type Hook = { __gsfpv: { sonic: (e?: boolean) => unknown; status?: string } };
const probe = (page: Page): Promise<Probe> => page.evaluate(() => (window as unknown as Hook).__gsfpv.sonic(false)) as Promise<Probe>;
const events = (page: Page): Promise<Ev[]> => page.evaluate(() => (window as unknown as { __rv: { events: unknown[] } }).__rv.events) as Promise<Ev[]>;
const spokenAfter = (all: readonly Ev[], from: number): string[] => all.slice(from).filter((e) => e.kind === 'speech' && e.key !== 'speech.end').map((e) => e.key ?? '');
const answersAfter = (all: readonly Ev[], from: number): Ev[] => all.slice(from).filter((e) => e.kind === 'answer');

/** Polls in the page (no waitForFunction: the release's CSP refuses a predicate made with new Function). */
async function until<T>(what: string, read: () => Promise<T>, pred: (v: T) => boolean, ms = 30000, every = 100): Promise<T> {
    const t0 = Date.now();
    for (;;) {
        const v = await read();
        if (pred(v)) return v;
        if (Date.now() - t0 > ms) throw new Error(`timed out (${Math.round(ms / 1000)} s) waiting for ${what}: ${JSON.stringify(v).slice(0, 500)}`);
        await sleep(every);
    }
}

const problems: string[] = [];

async function newContext(browser: () => Promise<BrowserContext>, served: Served, prefs: object, profile: object | null): Promise<BrowserContext> {
    const ctx = await browser();
    await ctx.grantPermissions(['microphone'], { origin: served.origin });
    await ctx.addInitScript({ content: initScript(prefs, profile) });
    return ctx;
}

/** /en/fly/?sonic=<lesson>, Enter on the start screen's button; the lesson runs and the recorder's panel is there. */
async function openLesson(ctx: BrowserContext, served: Served, lesson: string, label: string): Promise<Page> {
    const page = await ctx.newPage();
    page.on('pageerror', (e) => problems.push(`${label}: pageerror ${e.message.slice(0, 300)}`));
    page.on('console', (m) => {
        if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) problems.push(`${label}: console ${m.text().slice(0, 300)}`);
    });
    await page.goto(`${served.origin}/en/fly/?sonic=${lesson}&nowarn=1`);
    await until('the start screen', () => page.evaluate(() => !!document.querySelector('[data-testid="sonic-start-asked"]')), (v) => v, 60000);
    await page.focus('[data-testid="sonic-start-asked"]');
    await page.keyboard.press('Enter');
    await until(`lesson ${lesson}`, async () => ((await page.evaluate(() => (window as unknown as Hook).__gsfpv?.status ?? null)) === 'ready' ? (await probe(page)).lesson : null), (v) => v === lesson, 90000);
    await until('the recordings panel', () => page.evaluate(() => !!document.querySelector('.sonicrec-toggle')), (v) => v, 30000);
    return page;
}

const recordingOn = (page: Page): Promise<boolean> => page.evaluate(() => document.querySelector('.sonicrec-toggle')?.classList.contains('recording') === true);

/** T asks, T agrees (a press before the question has been read out is ignored: press until the recording runs). */
async function startRecording(page: Page, asks: string[]): Promise<void> {
    const from = (await events(page)).length;
    await page.keyboard.press('KeyT');
    await until('the question', () => events(page), (all) => asks.every((k) => spokenAfter(all, from).includes(k)), 20000);
    for (let t0 = Date.now(); !(await recordingOn(page)) && Date.now() - t0 < 60000; ) {
        await sleep(2500);
        if (await recordingOn(page)) break;
        if (spokenAfter(await events(page), from).includes('rec.started')) break;
        await page.keyboard.press('KeyT');
    }
    await until('the recording', () => recordingOn(page), (v) => v, 20000);
}

/** The lesson's first question pending: the intro skipped with N, the question said (nothing left in the speech queue). */
async function reachQuestion(page: Page): Promise<Probe> {
    let skipped = false;
    return until(
        'the first question of ears-headphones',
        async () => {
            const p = await probe(page);
            if (!skipped && p.phase === 'intro') {
                skipped = true;
                await page.keyboard.press('KeyN');
            }
            return p;
        },
        (p) => p.asking && p.speechQueue === 0 && p.question !== null,
        120000,
        80
    );
}

// ------------------------------------------------------------------------------------------------ R1

async function r1(browser: () => Promise<BrowserContext>, served: Served): Promise<void> {
    log('R1 control: a digit with no survey answers the question');
    {
        const ctx = await newContext(browser, served, prefsDoc(), null);
        const page = await openLesson(ctx, served, 'ears-headphones', 'R1c');
        const q = await reachQuestion(page);
        const from = (await events(page)).length;
        await page.keyboard.press('Digit1');
        await sleep(600);
        const got = answersAfter(await events(page), from);
        check('R1 control: with no survey a digit answers the lesson question (the probe sees a lesson answer)', got.length >= 1 && got[0]?.via === 'key', { question: q.question?.id, answers: got });
        await ctx.close();
    }
    log('R1: the survey runs while the lesson asks');
    const ctx = await newContext(browser, served, prefsDoc(), null);
    const page = await openLesson(ctx, served, 'ears-headphones', 'R1');
    await startRecording(page, ['rec.ask']);
    const q = await reachQuestion(page);
    const stopFrom = (await events(page)).length;
    await page.keyboard.press('KeyT');
    await until('the survey offer', () => events(page), (all) => spokenAfter(all, stopFrom).includes('survey.offer'), 30000);
    const before = await probe(page);
    await sleep(500);
    await page.keyboard.press('Digit1');
    await sleep(700);
    const afterYes = await probe(page);
    // two survey questions with digits (the first is a scale or a choice that takes 3), then the rest skipped
    await page.keyboard.press('Digit3');
    await sleep(600);
    await page.keyboard.press('Digit3');
    await sleep(600);
    const afterDigits = await probe(page);
    for (let i = 0; i < 12; i++) {
        const open = await page.evaluate(() => {
            const root = document.querySelector('.sonicrec-survey') as HTMLElement | null;
            return !!root && !root.hidden;
        });
        if (!open) break;
        await page.keyboard.press('Escape');
        await sleep(450);
    }
    await until('the survey closed', () => page.evaluate(() => { const r = document.querySelector('.sonicrec-survey') as HTMLElement | null; return !r || r.hidden === true; }), (v) => v, 20000);
    const all = await events(page);
    const lessonAnswers = answersAfter(all, stopFrom);
    result.r1 = { question: q.question, askingBeforeTheYes: before.asking, askingAfterTheYes: afterYes.asking, askingAfterTheDigits: afterDigits.asking, lessonAnswers, spokenSinceStop: spokenAfter(all, stopFrom) };
    check('R1: the survey offer was heard while the lesson was still asking', before.asking === true && before.question?.id === q.question?.id, { before: before.question });
    check('R1: the digits pressed for the survey (1 for yes, then 3 and 3) answered NO question of the lesson', lessonAnswers.length === 0 && afterYes.asking === true && afterDigits.asking === true, { lessonAnswers, askingAfterTheYes: afterYes.asking, askingAfterTheDigits: afterDigits.asking });
    await ctx.close();
}

// ------------------------------------------------------------------------------------------------ R2

interface Utt {
    text: string;
    called: number;
    started: number | null;
    ended: number | null;
    error?: boolean;
}
const utterances = (page: Page): Promise<Utt[]> => page.evaluate(() => (window as unknown as { __utt: unknown[] }).__utt) as Promise<Utt[]>;
const pageNow = (page: Page): Promise<number> => page.evaluate(() => performance.now());
const ASK = /^May I record/;

async function r2(browser: () => Promise<BrowserContext>, served: Served): Promise<void> {
    const speaking = prefsDoc({ selfVoice: true, speechRate: 0.75 });
    log('R2: T pressed while the lesson talks');
    const ctx = await newContext(browser, served, speaking, null);
    const page = await openLesson(ctx, served, 'walls-hall', 'R2');
    // the lesson's intro is being said (the first utterance has started); T is pressed a moment into it
    await until('the first utterance of the intro', () => utterances(page), (u) => u.some((x) => x.started !== null), 30000, 100);
    await sleep(1500);
    const pressedAt = await pageNow(page);
    await page.keyboard.press('KeyT');
    const timeline: { at: number; what: string }[] = [{ at: 0, what: 'T (first press)' }];
    let askStarted: number | null = null;
    let recordingAt: number | null = null;
    let secondPressAt: number | null = null;
    let secondPressWasHeard = false;
    const t0 = Date.now();
    for (;;) {
        const now = await pageNow(page);
        const rel = Math.round(now - pressedAt);
        const utt = await utterances(page);
        const ask = utt.find((u) => ASK.test(u.text));
        if (ask?.started != null && askStarted === null) {
            askStarted = Math.round(ask.started - pressedAt);
            timeline.push({ at: askStarted, what: 'the question (rec.ask) starts to be spoken' });
        }
        if (recordingAt === null && (await recordingOn(page))) {
            recordingAt = rel;
            timeline.push({ at: rel, what: 'the recording is on' });
        }
        // an impatient pilot: a second press once the recorder's 20 s reading limit has run out
        if (secondPressAt === null && rel >= 21000) {
            secondPressAt = rel;
            secondPressWasHeard = askStarted !== null;
            timeline.push({ at: rel, what: `T (second press); the question had ${askStarted === null ? 'NOT ' : ''}started` });
            await page.keyboard.press('KeyT');
        }
        if ((recordingAt !== null && askStarted !== null) || Date.now() - t0 > 90000) break;
        if (secondPressAt !== null && Date.now() - t0 > 60000) break;
        await sleep(250);
    }
    const utt = await utterances(page);
    const intro = utt.filter((u) => !ASK.test(u.text) && u.started !== null && u.started >= pressedAt - 60000).map((u) => ({ text: u.text.slice(0, 24), start: Math.round((u.started ?? 0) - pressedAt), end: u.ended === null ? null : Math.round(u.ended - pressedAt) }));
    result.r2 = { timeline, askStartedMs: askStarted, recordingAtMs: recordingAt, secondPressAtMs: secondPressAt, secondPressWasHeard, utterances: intro };
    check('R2: the lesson was talking when T was pressed (an utterance of the intro still to come)', intro.some((u) => u.start > 0), intro.slice(0, 6));
    check('R2: the pilot hears the consent question within 2 s of pressing T (it does not wait for the lesson to finish talking)', askStarted !== null && askStarted <= 2000, { askStartedMs: askStarted });
    check('R2: a second press is never taken as the yes before the question has been spoken', !(recordingAt !== null && askStarted === null) && !(recordingAt !== null && askStarted !== null && recordingAt < askStarted), { recordingAtMs: recordingAt, askStartedMs: askStarted });
    await ctx.close();
}

// ------------------------------------------------------------------------------------------------ R3

async function r3(browser: () => Promise<BrowserContext>, served: Served): Promise<void> {
    const rate = 1;
    const reader = prefsDoc({ selfVoice: false, speechRate: rate });
    const tr = createTranslator('en', DICTS);
    const minorMs = estimateSpeechS(tr.text({ key: 'rec.minor' }), rate) * 1000;
    const askMs = estimateSpeechS(tr.text({ key: 'rec.ask', params: { key: 'T' } }), rate) * 1000;
    log(`R3: a minor's question in "my screen reader speaks" mode (a reader needs ${Math.round(minorMs + askMs)} ms for the pair, the longer line alone ${Math.round(Math.max(minorMs, askMs))} ms)`);
    const ctx = await newContext(browser, served, reader, { id: 'reviewMinorPilot01', nickname: null, minor: true, guardianConfirmed: true, headphones: 'wired', surveysSeen: [], speechRecognition: false });
    const page = await openLesson(ctx, served, 'walls-hall', 'R3');
    const from = (await events(page)).length;
    const pressedAt = Date.now();
    await page.keyboard.press('KeyT');
    await until('the guardian line', () => events(page), (all) => spokenAfter(all, from).includes('rec.minor'), 10000, 50);
    // between the end of the longer line (where the parallel waits say "read") and the end of the pair (where a reader is done)
    const between = Math.max(minorMs, askMs) + 0.4 * Math.min(minorMs, askMs);
    await sleep(Math.max(0, pressedAt + between - Date.now()));
    const said = spokenAfter(await events(page), from);
    await page.keyboard.press('KeyT');
    await sleep(1200);
    const earlyOn = await recordingOn(page);
    const earlyAt = Date.now() - pressedAt;
    // once the pair has been read a press is the yes
    await sleep(Math.max(0, pressedAt + minorMs + askMs + 1500 - Date.now()));
    if (!earlyOn) await page.keyboard.press('KeyT');
    const onAt = await until('the recording', () => recordingOn(page), (v) => v, 20000, 100).then(() => Date.now() - pressedAt);
    result.r3 = { minorMs: Math.round(minorMs), askMs: Math.round(askMs), earlyPressAtMs: earlyAt - 1200, recordingOnAfterEarlyPress: earlyOn, recordingOnAtMs: onAt, spokenAtThatPress: said };
    check('R3: the question is two lines (rec.minor, rec.ask) and a reader needs both before a press counts', said.includes('rec.minor'), { said });
    check('R3: a press after the longer line but before the pair has been read is not a yes (no recording)', earlyOn === false, { earlyPressAtMs: earlyAt - 1200, pairReadAtMs: Math.round(minorMs + askMs), longerLineMs: Math.round(Math.max(minorMs, askMs)) });
    check('R3: control: once both lines have been read a press is the yes', onAt >= minorMs + askMs, { recordingOnAtMs: onAt });
    await ctx.close();
}

// ------------------------------------------------------------------------------------------------ R4

async function r4(browser: () => Promise<BrowserContext>, served: Served): Promise<void> {
    log('R4: the survey\'s notice while the lesson talks');
    const ctx = await newContext(browser, served, prefsDoc({ selfVoice: true, speechRate: 1 }), null);
    const page = await openLesson(ctx, served, 'walls-hall', 'R4');
    await startRecording(page, ['rec.ask']);
    // "Recording started." is said, then the lesson opens again from its beginning and says its intro: it is talking when T is pressed
    await until('the lesson\'s intro after "Recording started."', () => utterances(page), (u) => u.some((x) => /^Recording started/.test(x.text) && x.started !== null), 30000, 100);
    await sleep(2500);
    const stopFrom = (await events(page)).length;
    const stoppedAt = await pageNow(page);
    await page.keyboard.press('KeyT');
    await until('the survey offer', () => events(page), (all) => spokenAfter(all, stopFrom).includes('survey.offer'), 30000, 50);
    // the offer is answered at once (a helper who sees the dialog presses 1)
    await sleep(700);
    await page.keyboard.press('Digit1');
    await sleep(1200);
    for (let i = 0; i < 12; i++) {
        const open = await page.evaluate(() => {
            const root = document.querySelector('.sonicrec-survey') as HTMLElement | null;
            return !!root && !root.hidden;
        });
        if (!open) break;
        await page.keyboard.press('Escape');
        await sleep(450);
    }
    await until('the survey closed', () => page.evaluate(() => { const r = document.querySelector('.sonicrec-survey') as HTMLElement | null; return !r || r.hidden === true; }), (v) => v, 30000);
    const utt = await utterances(page);
    const notice = utt.find((u) => /^The microphone stays on/.test(u.text));
    const afterStop = utt.filter((u) => u.called >= stoppedAt).map((u) => ({ text: u.text.slice(0, 28), called: Math.round(u.called - stoppedAt), started: u.started === null ? null : Math.round(u.started - stoppedAt) }));
    result.r4 = { noticeCalledMs: notice === undefined ? null : Math.round(notice.called - stoppedAt), noticeStartedMs: notice?.started == null ? null : Math.round(notice.started - stoppedAt), afterStop: afterStop.slice(0, 8) };
    check('R4: the lesson was talking when the recording was stopped (its intro was being said)', utt.some((u) => !/^(Recording|May I|The microphone)/.test(u.text) && u.called < stoppedAt && u.called > stoppedAt - 20000), afterStop.slice(0, 3));
    check('R4: the notice that the microphone stays on began to be spoken (an answer given at once did not take it away before it began)', notice !== undefined && notice.started !== null, result.r4);
    check('R4: it began within 2 s of the stop (it did not wait for the lesson to finish talking)', notice?.started != null && notice.started - stoppedAt < 2000, { noticeStartedMs: result.r4 });
    await ctx.close();
}

// ------------------------------------------------------------------------------------------------ R5

/** The lesson pilot of ears-headphones (the lane's): N for the intro, a digit for each question from the sound that was played (1, 2, 2). */
async function passEarsHeadphones(page: Page): Promise<void> {
    let skipped = false;
    let answered = '';
    const t0 = Date.now();
    for (;;) {
        const p = await probe(page);
        if ((await events(page)).some((e) => e.kind === 'lesson' && e.what === 'passed' && e.lessonId === 'ears-headphones')) return;
        if (Date.now() - t0 > 240000) throw new Error(`ears-headphones was not passed in 4 minutes: ${JSON.stringify(p)}`);
        if (!skipped && p.phase === 'intro') {
            skipped = true;
            await page.keyboard.press('KeyN');
        } else if (p.asking && p.speechQueue === 0 && p.question && answered !== p.question.id) {
            answered = p.question.id;
            await page.keyboard.press(`Digit${Number(p.question.id.split(':')[2]) === 1 ? 1 : 2}`);
        }
        await sleep(60);
    }
}

interface ReplayHook {
    state: { stage: string; title: string; check: { ok: boolean; summary: string } | null; notes: string[]; details: string };
    checks: { lesson: string | null; frames: number; compared: boolean; ok: boolean | null; recorded: number; matched: number; diffs: number; cueShare: number | null; cueClassShare: number | null; cueMismatches?: unknown[] }[];
}
const replayHook = (page: Page): Promise<ReplayHook | null> => page.evaluate(() => (window as unknown as { __gsfpv: { sonicReplay?: () => unknown } }).__gsfpv.sonicReplay?.() ?? null) as Promise<ReplayHook | null>;

async function r5(browser: () => Promise<BrowserContext>, served: Served): Promise<void> {
    log('R5: a recording made with the browser\'s own voice');
    const ctx = await newContext(browser, served, prefsDoc({ selfVoice: true, speechRate: 2 }), null);
    const page = await openLesson(ctx, served, 'ears-headphones', 'R5');
    await startRecording(page, ['rec.ask']);
    await passEarsHeadphones(page);
    const stopFrom = (await events(page)).length;
    await page.keyboard.press('KeyT');
    await until('the survey offer', () => events(page), (all) => spokenAfter(all, stopFrom).includes('survey.offer'), 40000, 50);
    await sleep(800);
    await page.keyboard.press('Digit2');
    await until('rec.saved', () => events(page), (all) => spokenAfter(all, stopFrom).includes('rec.saved'), 40000, 100);
    await page.evaluate(() => {
        const b = document.querySelector('.sonicrec-toggle') as HTMLElement | null;
        if (b && document.querySelector('.sonicrec-panel')?.hasAttribute('hidden')) b.click();
    });
    await until('the replay button', () => page.evaluate(() => !!document.querySelector('.sonicrec-session [data-action="replay"]')), (v) => v, 30000);
    await page.focus('.sonicrec-session [data-action="replay"]');
    await page.keyboard.press('Enter');
    const ready = (await until('the replay checked', () => replayHook(page), (h) => h?.state.stage === 'ready' || h?.state.stage === 'error', 90000)) as ReplayHook;
    const rows = ready.checks;
    result.r5 = { summary: ready.state.check, notes: ready.state.notes, rows, details: ready.state.details.slice(0, 600) };
    check('R5: a recording made with the browser\'s voice is checked: ears-headphones, compared, every recorded event re-derived (0 differences)', rows.length === 1 && rows[0]?.lesson === 'ears-headphones' && rows[0].compared && rows[0].diffs === 0 && rows[0].matched === rows[0].recorded && rows[0].recorded > 5, rows);
    check('R5: the sounds agree (every frame\'s cue ids) and the panel says the replay agrees', rows[0]?.cueShare === 1 && ready.state.check?.ok === true, { rows: rows.map((r) => [r.lesson, r.cueShare, r.cueClassShare, r.cueMismatches]), summary: ready.state.check });
    await ctx.close();
}

// ------------------------------------------------------------------------------------------------ R6 (sonic-keys)

/** Waits for the line `key` said after event `from` and its end; returns the index of the end. */
async function lineDone(page: Page, from: number, key: string): Promise<number> {
    const all = await until(`the line ${key} said and over`, () => events(page), (a) => {
        const i = a.findIndex((e, j) => j >= from && e.kind === 'speech' && e.key === key);
        return i >= 0 && a.slice(i + 1).some((e) => e.kind === 'speech' && e.key === 'speech.end');
    }, 60000, 40);
    const i = all.findIndex((e, j) => j >= from && e.kind === 'speech' && e.key === key);
    return all.findIndex((e, j) => j > i && e.kind === 'speech' && e.key === 'speech.end') + 1;
}

async function r6(browser: () => Promise<BrowserContext>, served: Served): Promise<void> {
    log('R6: a digit while the headphone check plays its sound answers the trial at once and is acknowledged');
    const ctx = await newContext(browser, served, prefsDoc(), null);
    const page = await openLesson(ctx, served, 'ears-headphones', 'R6');
    await until('the intro', () => probe(page), (p) => p.phase === 'intro', 60000, 80);
    await page.keyboard.press('KeyN');
    // trial 1: 1 pressed while its sound plays (the trial's line over, the question not yet said)
    const t1 = await lineDone(page, 0, 'headphones.trial');
    await sleep(700);
    const at1 = (await events(page)).length;
    await page.keyboard.press('Digit1');
    await sleep(900);
    const all1 = await events(page);
    const said1 = spokenAfter(all1, t1);
    const got1 = answersAfter(all1, at1);
    result.r6 = { trial1: { spokenSinceTrialLine: said1, answers: got1 } };
    check('R6: the digit during the sound answers trial 1 (an answer by key, value 1)', got1.length === 1 && got1[0]?.via === 'key' && got1[0]?.value === 1 && (got1[0]?.item ?? '').endsWith(':1:side'), got1);
    check('R6: the question of trial 1 was never said (the digit came during the sound)', !said1.includes('headphones.q-side'), said1);
    check('R6: the answer is acknowledged in words ("Taken: 1")', said1.includes('answer.got'), said1);
    // trial 2: 7 (out of range) during its sound is refused in words, not dropped; then 2 answers it
    const t2 = await lineDone(page, at1, 'headphones.trial');
    await sleep(700);
    const at2 = (await events(page)).length;
    await page.keyboard.press('Digit7');
    await sleep(1500);
    const all2 = await events(page);
    const said2 = spokenAfter(all2, at2);
    const got2 = answersAfter(all2, at2);
    (result.r6 as Record<string, unknown>).trial2 = { spokenAfter7: said2, answers: got2, fromTrialLine: t2 };
    // review I3: 1 to 3 are taken during the sound, so the word names them ("Press 1, 2 or 3"), never "nothing to answer now"
    check('R6: 7 during the sound of trial 2 answers nothing and is said back with the keys that answer (answer.need-123)', got2.length === 0 && said2.includes('answer.need-123') && !said2.includes('answer.not-now'), { said2, got2 });
    // review I2: the refused digit is written for the replay (a key event with the action answer.refused)
    const refused2 = all2.slice(at2).filter((e) => (e as { kind?: string }).kind === 'key' && (e as { action?: string }).action === 'answer.refused');
    check('R6: the refused 7 is in the recording as an input of the replay (key, answer.refused, Digit7)', refused2.length === 1 && (refused2[0] as { code?: string }).code === 'Digit7', refused2);
    await ctx.close();
}

// ------------------------------------------------------------------------------------------------ R7 (sonic-keys)

const isSpeech = (e: Ev, keys: readonly string[]): boolean => e.kind === 'speech' && keys.includes(e.key ?? '');

/**
 * R7: after a failed headphone check only the trials answered wrong are asked again, without the intro.
 * The sides are left, right, left; 2 (right) answers every trial of the first attempt, so trials 1 and 3 fail and trial 2 passes.
 * The retry must ask two trials (both left: 1 answers them) and pass; the old runner asked all three again (a 1 for the right one fails).
 */
async function r7(browser: () => Promise<BrowserContext>, served: Served): Promise<void> {
    log('R7: after a failed headphone check only the failed trials are asked again, without the intro');
    const ctx = await newContext(browser, served, prefsDoc(), null);
    const page = await openLesson(ctx, served, 'ears-headphones', 'R7');
    await until('the intro', () => probe(page), (p) => p.phase === 'intro', 60000, 80);
    await page.keyboard.press('KeyN');
    const first: Ev[] = [];
    let from = 0;
    for (let n = 1; n <= 3; n++) {
        await lineDone(page, from, 'headphones.trial');
        await sleep(700);
        const at = (await events(page)).length;
        await page.keyboard.press('Digit2');
        await sleep(900);
        first.push(...answersAfter(await events(page), at));
        from = at;
    }
    check('R7: the first attempt took three answers by key (2 each)', first.length === 3 && first.every((e) => e.via === 'key' && e.value === 2), first);
    const RETRY = 'lesson.ears-headphones.retry';
    const PASS = 'lesson.ears-headphones.pass';
    const withRetry = await until('the retry line', () => events(page), (a) => a.slice(from).some((e) => isSpeech(e, [RETRY])), 90000, 40);
    const retryAt = withRetry.findIndex((e, j) => j >= from && isSpeech(e, [RETRY]));
    const second: Ev[] = [];
    let cur = retryAt;
    let trials = 0;
    let passed = false;
    for (;;) {
        const a = await until('the next trial or the pass', () => events(page), (all) => all.slice(cur + 1).some((e) => isSpeech(e, ['headphones.trial', PASS])), 60000, 40);
        const next = a.findIndex((e, j) => j > cur && isSpeech(e, ['headphones.trial', PASS]));
        if (a[next]?.key === PASS) {
            passed = true;
            break;
        }
        if (trials >= 4) break;
        await lineDone(page, next, 'headphones.trial');
        trials++;
        await sleep(700);
        const at = (await events(page)).length;
        await page.keyboard.press('Digit1');
        await sleep(900);
        second.push(...answersAfter(await events(page), at));
        cur = at;
    }
    const said = spokenAfter(await events(page), retryAt);
    result.r7 = { firstAnswers: first, retryTrials: trials, retryAnswers: second, spokenFromRetry: said };
    check('R7: the retry asks only the two failed trials', trials === 2 && second.length === 2, { trials, second });
    check('R7: the retry says no intro (headphones.intro, intro.1, intro.2)', !said.some((k) => k === 'headphones.intro' || k.startsWith('lesson.ears-headphones.intro')), said);
    check('R7: the check passes after the two trials are answered right', passed, said);
    await ctx.close();
}

// ------------------------------------------------------------------------------------------------ R8 (sonic-hints)

const KEYS_LINE = 'sonic.say.lessonKeys';
const keysLines = (all: readonly Ev[], from = 0): number => spokenAfter(all, from).filter((k) => k === KEYS_LINE).length;
const startShown = (page: Page): Promise<boolean> => page.evaluate(() => {
    const s = document.querySelector('[data-testid="sonic-start"]') as HTMLElement | null;
    return !!s && !s.hidden;
});

/**
 * R8: the keys of the moment are said at the start of every lesson step, once a step (the owner's complaint of 2026-11-10), and X
 * leaves the lesson for the mode's main menu in one press. rings-first: its first step names the keys once; Z (the same step) does not
 * say them again; N (step 2) says them once more; X shows the start screen and says where the pilot is (sonic.say.homeBack).
 */
async function r8(browser: () => Promise<BrowserContext>, served: Served): Promise<void> {
    log('R8: the keys line at every step start, once a step; X from the lesson to the main menu');
    const ctx = await newContext(browser, served, prefsDoc(), null);
    const page = await openLesson(ctx, served, 'rings-first', 'R8');
    const first = await until('the keys line of step 1', () => events(page), (a) => keysLines(a) >= 1, 30000, 80);
    const firstKeys = spokenAfter(first, 0);
    check('R8: step 1 names the keys after its first line (sonic.say.lessonKeys)', keysLines(first) === 1 && firstKeys.indexOf(KEYS_LINE) > 0, firstKeys.slice(0, 6));
    await sleep(4000);
    const beforeZ = (await events(page)).length;
    await page.keyboard.press('KeyZ');
    await sleep(5000);
    const afterZ = await events(page);
    check('R8: Z (the same step said again) does not say the keys again', keysLines(afterZ, beforeZ) === 0 && spokenAfter(afterZ, beforeZ).length > 0, spokenAfter(afterZ, beforeZ).slice(0, 8));
    const beforeN = afterZ.length;
    await page.keyboard.press('KeyN');
    const afterN = await until('the keys line of step 2', () => events(page), (a) => keysLines(a, beforeN) >= 1, 20000, 80).catch(async () => events(page));
    await sleep(3000);
    const nSaid = spokenAfter(await events(page), beforeN);
    check('R8: N (the next step) names the keys once more, after the step\'s first line', nSaid.filter((k) => k === KEYS_LINE).length === 1 && nSaid.indexOf(KEYS_LINE) > 0, nSaid.slice(0, 8));
    result.r8 = { step1: firstKeys.slice(0, 6), z: spokenAfter(afterZ, beforeZ).slice(0, 8), n: nSaid.slice(0, 8), total: keysLines(afterN) };
    check('R8: the start screen is not shown during the lesson', !(await startShown(page)));
    const beforeX = (await events(page)).length;
    await page.keyboard.press('KeyX');
    const shown = await until('the start screen after X', () => startShown(page), (v) => v, 5000, 50).catch(() => false);
    const xSaid = await until('the line after X', () => events(page), (a) => spokenAfter(a, beforeX).includes('sonic.say.homeBack'), 5000, 50)
        .then((a) => spokenAfter(a, beforeX))
        .catch(async () => spokenAfter(await events(page), beforeX));
    check('R8: X shows the main menu (the start screen) in one press', shown === true);
    check('R8: X says where the pilot is (sonic.say.homeBack: the lesson is saved, Continue goes back)', xSaid.includes('sonic.say.homeBack'), xSaid.slice(0, 6));
    const cont = await page.evaluate(() => [...document.querySelectorAll('[data-testid="sonic-start"] button')].some((b) => (b.getAttribute('data-lesson') ?? '') === 'rings-first'));
    check('R8: the main menu offers the lesson to continue (a button of rings-first)', cont);
    await ctx.close();
}

// ------------------------------------------------------------------------------------------------ R9 (sonic-beacon)

interface Hum {
    dir: [number, number, number] | null;
    distance: number | null;
    hz: number | null;
}
/** One look of the page's hook: the runner's target, the phase and the target hum of the engine's last plan (null: the page's hook has none). */
interface HumRow {
    t: number;
    target: string | null;
    phase: string | null;
    hum: Hum[] | null;
    beacon: boolean | null;
}

/** Before the page's scripts: every 30 ms one HumRow into window.__hum (taken out by humRows). */
const HUM_WATCH = `(() => {
  window.__hum = [];
  setInterval(() => {
    const h = window.__gsfpv && window.__gsfpv.sonic;
    if (!h) return;
    const s = h(false);
    window.__hum.push({ t: performance.now(), target: s.target ? s.target.id : null, phase: s.phase, hum: s.hum === undefined ? null : s.hum, beacon: s.beacon === undefined ? null : s.beacon });
    if (window.__hum.length > 6000) window.__hum.splice(0, 2000);
  }, 30);
})();`;
const humRows = (page: Page): Promise<HumRow[]> => page.evaluate(() => (window as unknown as { __hum: HumRow[] }).__hum.splice(0)) as Promise<HumRow[]>;
/** The hum's own voice (it has a distance) and a one-off note of it (the preview after a gate: no distance). */
const voices = (rows: readonly HumRow[]): Hum[] => rows.flatMap((r) => (r.hum ?? []).filter((h) => h.distance !== null && h.dir !== null));
const notes = (rows: readonly HumRow[]): Hum[] => rows.flatMap((r) => (r.hum ?? []).filter((h) => h.distance === null && h.dir !== null));
/** Ahead or to a side, never behind: the heading frame's z (-z ahead) at most 0 (a rounding margin). */
const notBehind = (hs: readonly Hum[]): boolean => hs.every((h) => (h.dir as [number, number, number])[2] <= 1e-3);
const sideOf = (h: Hum): number => (h.dir as [number, number, number])[0];

/**
 * A lesson open with its flying phase reached; then W held (forward), D and A each held 1.5 s within it (a turn or a slide to each side),
 * the rows of the flight returned. The keys the pilot uses; nothing is driven through the hook.
 */
async function flyWithTurns(ctx: BrowserContext, served: Served, lesson: string, label: string): Promise<{ page: Page; rows: HumRow[]; flying: boolean }> {
    const page = await openLesson(ctx, served, lesson, label);
    // 150 s (an estimate): the corridor's intro grew by intro.5 and its hum demo (review R3) past the old 60 s wait
    const flying = await until(`${label}: the flying phase`, () => probe(page), (p) => p.phase === 'flying', 150000, 100).then(() => true).catch((e: Error) => {
        log(`${label}: ${e.message.slice(0, 700)}`);
        return false;
    });
    await humRows(page);
    await page.keyboard.down('KeyW');
    await sleep(2500);
    await page.keyboard.down('KeyD');
    await sleep(1500);
    await page.keyboard.up('KeyD');
    await sleep(1000);
    await page.keyboard.down('KeyA');
    await sleep(1500);
    await page.keyboard.up('KeyA');
    await sleep(1500);
    await page.keyboard.up('KeyW');
    await sleep(300);
    const rows = (await humRows(page)).filter((r) => r.phase === 'flying');
    return { page, rows, flying };
}

/**
 * R9: the target hum shows the way (lane sonic-beacon, the owner's complaint of 2026-11-10: in the tunnels nothing says where to fly).
 * The corridor (a world track, no gate): with the beacon (the default) the plan carries the target hum while flying, from a side when the
 * pilot turns, never from behind; with the setting off it carries none (the goal has no gate, the hum has nowhere to point). rings-line
 * (three rings): after the first ring a one-off note of the hum (the preview of the ring after the next) is planned, from ahead or a side.
 */
async function r9(browser: () => Promise<BrowserContext>, served: Served): Promise<void> {
    log('R9: the target hum shows the way in the corridor; none with the setting off; the preview after a ring');
    // Bounds (review R8 of the lane: estimates, not measured): at least 50 flying rows, a hum in at least 80 % of them, a side of |x| at
    // least 0.25 in some frame, z at most 1e-3 (not behind). Measured on the lane's release (evidence/2026-11-12/sonic-int-review-r9.json):
    // 283 rows, share 1.0, sides -0.66 to 0.92.
    const on = await newContext(browser, served, prefsDoc(), null);
    await on.addInitScript({ content: HUM_WATCH });
    const a = await flyWithTurns(on, served, 'corridor', 'R9 corridor');
    const v = voices(a.rows);
    const sides = v.map(sideOf);
    const share = a.rows.length ? a.rows.filter((r) => (r.hum ?? []).some((h) => h.distance !== null)).length / a.rows.length : 0;
    result.r9corridor = { flying: a.flying, rows: a.rows.length, hookHasHum: a.rows.some((r) => r.hum !== null), beacon: a.rows[0]?.beacon ?? null, share: Math.round(share * 100) / 100, voices: v.length, maxLeft: sides.length ? Math.min(...sides) : null, maxRight: sides.length ? Math.max(...sides) : null, behind: v.filter((h) => !notBehind([h])).length, sample: v.filter((_, i) => i % 25 === 0).slice(0, 12) };
    check('R9: the corridor reached its flying phase', a.flying && a.rows.length > 50, { flying: a.flying, rows: a.rows.length });
    check('R9 beacon: the page reports the target hum of the plan (the hook\'s hum) with the setting on', a.rows.length > 0 && a.rows.every((r) => r.hum !== null) && a.rows.every((r) => r.beacon === true), result.r9corridor);
    check('R9 beacon: in the corridor (no gate) the target hum sounds in most flying frames (at least 80 %)', share >= 0.8, share);
    check('R9 beacon: the hum comes from a side when the pilot turns (|x| at least 0.25 in some frame)', sides.some((x) => Math.abs(x) >= 0.25), { min: sides.length ? Math.min(...sides) : null, max: sides.length ? Math.max(...sides) : null });
    check('R9 beacon: the hum never comes from behind (folded to the front half circle)', v.length > 0 && notBehind(v), v.filter((h) => !notBehind([h])).slice(0, 5));
    await on.close();

    const off = await newContext(browser, served, prefsDoc({ beacon: false }), null);
    await off.addInitScript({ content: HUM_WATCH });
    const b = await flyWithTurns(off, served, 'corridor', 'R9 corridor off');
    const vOff = voices(b.rows);
    result.r9off = { flying: b.flying, rows: b.rows.length, hookHasHum: b.rows.length > 0 && b.rows.every((r) => r.hum !== null), beacon: b.rows[0]?.beacon ?? null, voices: vOff.length, sample: vOff.slice(0, 5) };
    check('R9: the corridor with the setting off reached its flying phase', b.flying && b.rows.length > 50, { flying: b.flying, rows: b.rows.length });
    // review R8: only a hook that reports the plan's hum (and the setting off) can tell an absent hum; a build without the hook must fail here
    check('R9 off: with the setting off the plan carries no target hum in the corridor (the goal has no gate to hum at)', b.rows.length > 0 && b.rows.every((r) => r.hum !== null && r.beacon === false) && vOff.length === 0, result.r9off);
    await off.close();

    const rings = await newContext(browser, served, prefsDoc(), null);
    await rings.addInitScript({ content: HUM_WATCH });
    const page = await openLesson(rings, served, 'rings-line', 'R9 rings-line');
    const ready = await until('R9 rings-line: the flying phase', () => probe(page), (p) => p.phase === 'flying', 60000, 100).then(() => true).catch(() => false);
    const before = await humRows(page);
    let first = [...before].reverse().find((r) => r.target !== null)?.target ?? null;
    await page.keyboard.down('KeyW');
    const t0 = Date.now();
    const rows: HumRow[] = [];
    let passedAt = -1;
    while (Date.now() - t0 < 40000) {
        await sleep(200);
        const got = await humRows(page);
        rows.push(...got);
        if (first === null) first = rows.find((r) => r.target !== null)?.target ?? null;
        if (passedAt < 0) {
            const i = rows.findIndex((r) => r.target !== null && first !== null && r.target !== first);
            if (i >= 0) passedAt = i;
        }
        if (passedAt >= 0 && rows.length - passedAt > 100) break;
    }
    await page.keyboard.up('KeyW');
    const after = passedAt >= 0 ? rows.slice(Math.max(0, passedAt - 5), passedAt + 100) : [];
    const pre = notes(after);
    result.r9rings = { flying: ready, first, passedAt, next: passedAt >= 0 ? rows[passedAt]!.target : null, rows: rows.length, previews: pre.length, sample: pre.slice(0, 5), notesBefore: notes(passedAt >= 0 ? rows.slice(0, Math.max(0, passedAt - 5)) : rows).length, targets: [...new Set(rows.map((r) => r.target))].slice(0, 8), phases: [...new Set(rows.map((r) => r.phase))] };
    check('R9: rings-line: the first ring was passed (the target moved on)', passedAt >= 0, result.r9rings);
    check('R9 beacon: after the ring a one-off note of the hum (the preview of the ring after the next) is planned', pre.length > 0, result.r9rings);
    check('R9 beacon: the preview comes from ahead or a side, never from behind', pre.length > 0 && notBehind(pre), pre.slice(0, 5));
    await rings.close();
}

// ------------------------------------------------------------------------------------------------ R10 (train 2, lane sound)

const SCAN = '887f27aa';
const SHOTS = 'U:/Temp/gsfpv-train2/shots';
interface R10Probe extends Probe {
    target: { id: string; pos: [number, number, number] } | null;
    hum: Hum[] | null;
    cues: string[];
    motor: boolean;
    walls: { voxelM: number | null; builtin: boolean; scene: string; scale: number };
    lastLine: string | null;
    pos: [number, number, number];
}
/** The hook's state; before the sound chunk has put its hook up, an empty one (no lesson). */
const probe10 = (page: Page): Promise<R10Probe> => page.evaluate(() => {
    const f = (window as unknown as { __gsfpv?: { sonic?: (e?: boolean) => unknown } }).__gsfpv?.sonic;
    return typeof f === 'function' ? f(false) : { lesson: null, phase: null, attempt: 0, asking: false, question: null, engine: 'none', speechQueue: 0, target: null, hum: null, cues: [], motor: false, walls: { voxelM: null, builtin: false, scene: '', scale: 1 }, lastLine: null, pos: [0, 0, 0] };
}) as Promise<R10Probe>;
const scanOrder = (page: Page): Promise<string[]> => page.evaluate(() => {
    const b = document.querySelector('[data-testid="sonic-start-beginning"]');
    return b?.parentElement ? [...b.parentElement.children].map((c) => c.getAttribute('data-testid') ?? '').filter((x) => x.startsWith('sonic-start-')) : [];
});

/** The prefs document of a pilot who said "I already fly by sound" (prefsDoc's, with fliesBySound). */
function experiencedDoc(): object {
    const d = prefsDoc() as { collections: { sonic: Record<string, unknown> } };
    d.collections.sonic.fliesBySound = true;
    return d;
}

/** Steers by the target hum as a blind pilot would (W held, E or Q when the hum is to a side, Space or Shift for its height) until `done`. */
async function steerByHum(page: Page, done: (p: R10Probe) => boolean, ms: number, seen: Set<string>, trail?: object[], cueSeen?: Set<string>): Promise<R10Probe> {
    const held = new Set<string>();
    let lastTrail = 0;
    const hold = async (code: string, on: boolean): Promise<void> => {
        if (on && !held.has(code)) { await page.keyboard.down(code); held.add(code); }
        if (!on && held.has(code)) { await page.keyboard.up(code); held.delete(code); }
    };
    let p = await probe10(page);
    for (const t0 = Date.now(); !done(p) && Date.now() - t0 < ms; ) {
        const v = (p.hum ?? []).find((h) => h.distance !== null && h.dir !== null)?.dir as [number, number, number] | undefined;
        await hold('KeyW', v !== undefined && Math.abs(v[0]) < 0.5);
        await hold('KeyE', v !== undefined && v[0] > 0.12);
        await hold('KeyQ', v !== undefined && v[0] < -0.12);
        // height by the hum's slope: 0.08 (an estimate) is about 0.5 m at 6 m; at 0.2 the pilot of run 4 flew 1 m under gate 2 into an obstacle for 230 s
        await hold('Space', v !== undefined && v[1] > 0.08);
        await hold('ShiftLeft', v !== undefined && v[1] < -0.08);
        await sleep(60);
        p = await probe10(page);
        if (p.lastLine) seen.add(p.lastLine);
        for (const c of cueSeen ? (p.cues ?? []) : []) cueSeen?.add(c);
        if (trail && Date.now() - lastTrail >= 2000) {
            lastTrail = Date.now();
            const h = (p.hum ?? []).find((x) => x.distance !== null) ?? null;
            trail.push({ s: Math.round((Date.now() - t0) / 1000), pos: p.pos.map((c) => Math.round(c * 10) / 10), target: p.target?.id ?? null, phase: p.phase, attempt: p.attempt, hum: h ? { dir: h.dir?.map((c) => Math.round(c * 100) / 100), d: h.distance === null ? null : Math.round(h.distance * 10) / 10 } : null, keys: [...held] });
        }
    }
    for (const c of [...held]) await hold(c, false);
    return p;
}

/**
 * R10: fly THIS scan by sound (train 2). The pause menu's item of an ordinary flight in scene 887f27aa links the sound page of that
 * scan; its start screen puts the lessons first for a first-timer and the scan first for a pilot who flies by sound (screenshots);
 * the free scan flight runs there with the motor silent, a wall cue is planned flying at a wall; N makes a course of gates, the hum
 * leads to gate 1 and then gate 2, the gate line is said, backing up along a leg is not called the wrong way, and the course's end
 * does not say "that was the last lesson" (review SN-3).
 */
async function r10(browser: () => Promise<BrowserContext>, served: Served): Promise<void> {
    log('R10: the scan link, its start screen, the free flight and a course by sound in 887f27aa');
    const ctx = await newContext(browser, served, prefsDoc(), null);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => problems.push(`R10 sighted: pageerror ${e.message.slice(0, 300)}`));
    await page.goto(`${served.origin}/en/fly/?scene=${SCAN}&nowarn=1&render=off`);
    await until('the sighted flight', () => page.evaluate(() => (window as unknown as Hook).__gsfpv?.status ?? null), (v) => v === 'ready', 120000, 250);
    // the Controls screen first (as sonic-optin-page.ts chooseKeyboard): the pause menu opens only over the flight
    await page.waitForSelector('.screen.radio [data-action="radio-keyboard"]', { timeout: 20000 });
    await page.focus('.screen.radio [data-action="radio-keyboard"]');
    await page.keyboard.press('Enter');
    await until('the Controls screen to go', () => page.evaluate(() => !document.querySelector('.screen.radio')), (v) => v, 10000);
    await sleep(800);
    await page.keyboard.press('Escape');
    await page.waitForSelector('.pause-menu', { timeout: 10000 });
    const href = await page.evaluate(() => document.querySelector('.pause-menu [data-action="pause.flyBySound"]')?.getAttribute('href') ?? null);
    result.r10link = href;
    check(`R10: the pause menu links this scan by sound (/en/fly/?sonic=scan&scene=${SCAN}&sz=<size>)`, new RegExp(`^/en/fly/\\?sonic=scan&scene=${SCAN}&sz=\\d+(\\.\\d+)?$`).test(href ?? ''), href);
    const [first] = await Promise.all([ctx.waitForEvent('page', { timeout: 15000 }), page.click('[data-action="pause.flyBySound"]')]);
    first.on('pageerror', (e) => problems.push(`R10 first: pageerror ${e.message.slice(0, 300)}`));
    await until('the start screen (first-timer)', () => first.evaluate(() => !!document.querySelector('[data-testid="sonic-start-beginning"]')), (v) => v, 60000);
    const firstOrder = await scanOrder(first);
    await first.screenshot({ path: `${SHOTS}/sound-start-first.png`, fullPage: false });
    result.r10first = firstOrder;
    check('R10: a first-timer sees the lessons first, then "I already fly by sound" (sonic-start-beginning, sonic-start-scan-flier)', firstOrder.join() === 'sonic-start-beginning,sonic-start-scan-flier', firstOrder);
    await ctx.close();

    const exp = await newContext(browser, served, experiencedDoc(), null);
    await exp.addInitScript({ content: HUM_WATCH });
    const fly = await exp.newPage();
    fly.on('pageerror', (e) => problems.push(`R10 flight: pageerror ${e.message.slice(0, 300)}`));
    fly.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) problems.push(`R10 flight: console ${m.text().slice(0, 300)}`); });
    await fly.goto(`${served.origin}${href ?? `/en/fly/?sonic=scan&scene=${SCAN}&sz=1`}&nowarn=1`);
    await until('the start screen (experienced)', () => fly.evaluate(() => !!document.querySelector('[data-testid="sonic-start-scan"]')), (v) => v, 60000);
    const expOrder = await scanOrder(fly);
    await fly.screenshot({ path: `${SHOTS}/sound-start-experienced.png`, fullPage: false });
    result.r10experienced = expOrder;
    check('R10: a pilot who flies by sound sees "Fly this scan by sound" first (sonic-start-scan, sonic-start-beginning)', expOrder.join() === 'sonic-start-scan,sonic-start-beginning', expOrder);
    await fly.focus('[data-testid="sonic-start-scan"]');
    await fly.keyboard.press('Enter');
    let skipped = false;
    const inFlight = await until('the free scan flight', async () => {
        const p = await probe10(fly);
        if (!skipped && p.phase === 'intro') { skipped = true; await fly.keyboard.press('KeyN'); }
        return p;
    }, (p) => p.lesson === 'scan-free' && p.phase === 'flying', 150000, 100);
    result.r10free = { lesson: inFlight.lesson, phase: inFlight.phase, walls: inFlight.walls, motor: inFlight.motor, target: inFlight.target };
    check(`R10: the free scan flight runs in scene ${SCAN} (lesson scan-free, flying, no target)`, inFlight.walls.scene === SCAN && inFlight.target === null, result.r10free);
    check('R10: the motor is silent by default (motorSound off)', inFlight.motor === false, inFlight.motor);

    // at a wall: W held up to 20 s (an estimate), the plan's cue ids collected
    const ids = new Set<string>();
    await fly.keyboard.down('KeyW');
    // the plan's ids carry the side: 'safety.wall:front' (measured in the first R10 run, 2026-11-13)
    const wall = (): boolean => [...ids].some((c) => c.startsWith('safety.wall'));
    for (const t0 = Date.now(); Date.now() - t0 < 20000 && !wall(); ) {
        for (const c of (await probe10(fly)).cues ?? []) ids.add(c);
        await sleep(80);
    }
    await fly.keyboard.up('KeyW');
    result.r10cues = [...ids];
    check('R10: flying at a wall a wall cue is planned (safety.wall:<side>)', wall(), [...ids]);

    // N: a course of gates
    const from = (await events(fly)).length;
    const lines = new Set<string>();
    await sleep(1500);
    await fly.keyboard.press('KeyN');
    const ready = await until('the course', async () => {
        const p = await probe10(fly);
        if (p.lastLine) lines.add(p.lastLine);
        return p;
    }, (p) => p.target !== null || lines.has('sonic.say.courseNone') || lines.has('sonic.say.scanNoWalls'), 180000, 150).catch((e: Error) => { log(e.message.slice(0, 300)); return null; });
    const spoken0 = spokenAfter(await events(fly), from);
    result.r10course = { target: ready?.target ?? null, lines: [...lines], spoken: spoken0.slice(0, 20) };
    check('R10 course: N makes a course; the hum\'s target is gate 1', ready?.target !== null && ready?.target !== undefined && /1$/.test(ready.target.id), result.r10course);
    if (!ready?.target) { await exp.close(); return; }
    const gate1 = ready.target.id;
    const trail1: object[] = [];
    const gateCues = new Set<string>();
    const after1 = await steerByHum(fly, (p) => p.target !== null && p.target.id !== gate1, 90000, lines, trail1, gateCues);
    for (const t0 = Date.now(); Date.now() - t0 < 2500; ) {
        for (const c of (await probe10(fly)).cues ?? []) gateCues.add(c);
        await sleep(60);
    }
    const atGate1 = spokenAfter(await events(fly), from);
    result.r10gate1 = { from: gate1, now: after1.target?.id ?? null, phase: after1.phase, spokenTail: atGate1.slice(-6), gateNote: gateCues.has('target.note'), trail: trail1.slice(-6) };
    check('R10 course: after flying through gate 1 the target is gate 2', after1.target !== null && after1.target.id !== gate1 && /2$/.test(after1.target.id), result.r10gate1);
    // a gate is told by its note (the gate melody, cue target.note) and the preview of the gate after it: the runner says no line
    // at a gate (fly.gate is a catalogue key no code says, grep of packages/sonic-fpv/src; run 4 heard no fly.stage at gate 1 either)
    check('R10 course: gate 1 is told by its note (target.note planned)', gateCues.has('target.note'), result.r10gate1);

    // backing up along the leg (S held 3 s): never the wrong way
    const backFrom = (await events(fly)).length;
    const backIds = new Set<string>();
    await fly.keyboard.down('KeyS');
    for (const t0 = Date.now(); Date.now() - t0 < 3000; ) {
        for (const c of (await probe10(fly)).cues ?? []) backIds.add(c);
        await sleep(80);
    }
    await fly.keyboard.up('KeyS');
    await sleep(1200);
    const backSpoken = spokenAfter(await events(fly), backFrom);
    result.r10back = { cues: [...backIds], spoken: backSpoken };
    check('R10 course: backing up along a leg is not called the wrong way (no fly.wrong-way, no safety.wrong-way)', !backSpoken.includes('fly.wrong-way') && !backIds.has('safety.wrong-way'), result.r10back);

    // I: where am I (the runner's status line)
    const iFrom = (await events(fly)).length;
    await fly.keyboard.press('KeyI');
    await sleep(2500);
    const iSpoken = spokenAfter(await events(fly), iFrom);
    result.r10where = iSpoken;
    check('R10 course: I says where the pilot is (a status line)', iSpoken.some((k) => k.startsWith('status.')), iSpoken);

    const trail: object[] = [];
    const end = await steerByHum(fly, (p) => p.phase === 'passed' || p.phase === 'idle', 240000, lines, trail);
    await sleep(4000);
    const evAll = await events(fly);
    const all = spokenAfter(evAll, from);
    const digest = evAll.slice(from).filter((e) => e.kind !== 'speech').map((e) => `${e.kind}:${e.what ?? e.key ?? e.item ?? ''}`);
    result.r10end = { phase: end.phase, target: end.target?.id ?? null, stages: all.filter((k) => k === 'fly.stage').length, lastLesson: all.includes('fly.last-lesson'), lines: [...lines], spoken: all.slice(-60), events: digest.slice(-60), trail };
    check('R10 course: the course was flown to its end by the hum', end.phase === 'passed' || end.phase === 'idle', result.r10end);
    check('R10 course: its end does not say "that was the last lesson" (review SN-3)', !all.includes('fly.last-lesson') && !lines.has('fly.last-lesson'), result.r10end);
    await exp.close();
}

// ------------------------------------------------------------------------------------------------ main

const result: Record<string, unknown> = {};

async function main(): Promise<void> {
    const which = (process.argv[2] ?? 'r1').toLowerCase();
    // SITE=https://... runs the probe against that site (the live one after a release) instead of the local build; no /api is needed either way
    const site = (process.env.SITE ?? '').replace(/\/$/, '');
    let release: unknown = null;
    if (site !== '') {
        release = await (await fetch(`${site}/release.json`, { cache: 'no-store' })).json();
        console.log(`sonic-int-review target: ${site}`);
    } else {
        try {
            release = JSON.parse((await import('node:fs')).readFileSync(`${DIST}/release.json`, 'utf8'));
        } catch {
            throw new Error('dist/release.json is missing: run `node scripts/build-release.mjs` first');
        }
        if ((release as { sha?: string }).sha !== gitSha()) console.log(`NOTE: dist was built at ${(release as { sha?: string }).sha}, the tree is at ${gitSha()}`);
    }
    await lock();
    locked = true;
    let served: Served | null = null;
    let browserHandle: Awaited<ReturnType<typeof launchChrome>>['browser'] | null = null;
    let failure: string | null = null;
    try {
        served = site !== '' ? { port: 0, origin: site, stop: async () => undefined } : await serveDist(DIST, {}, PORT);
        const launched = await launchChrome({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
        browserHandle = launched.browser;
        log('up:', launched.which.version, served.origin, JSON.stringify(release));
        const b = browserHandle;
        const fresh = (): Promise<BrowserContext> => b.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, acceptDownloads: true });
        if (which === 'r1') await r1(fresh, served);
        else if (which === 'r2') await r2(fresh, served);
        else if (which === 'r3') await r3(fresh, served);
        else if (which === 'r4') await r4(fresh, served);
        else if (which === 'r5') await r5(fresh, served);
        else if (which === 'r6') await r6(fresh, served);
        else if (which === 'r7') await r7(fresh, served);
        else if (which === 'r8') await r8(fresh, served);
        else if (which === 'r9') await r9(fresh, served);
        else if (which === 'r10') await r10(fresh, served);
        else throw new Error(`no probe named ${which}`);
        check('no page error, no console error in any page', problems.length === 0, problems);
    } catch (e) {
        failure = e instanceof Error ? (e.stack ?? e.message) : String(e);
        check('the run reached its end without an exception', false, failure.slice(0, 700));
    } finally {
        await browserHandle?.close().catch(() => undefined);
        await served?.stop().catch(() => undefined);
        unlock();
    }
    const passed = checks.filter((c) => c.pass).length;
    const file = writeEvidence(`sonic-int-review-${which}${site !== '' ? '-live' : ''}`, { site: site !== '' ? site : `http://127.0.0.1:${PORT}`, release, git: gitSha(), seconds: Math.round((Date.now() - T0) / 1000), passed, total: checks.length, pass: failure === null && passed === checks.length, checks, result, problems });
    console.log(`${passed} of ${checks.length} checks passed in ${Math.round((Date.now() - T0) / 1000)} s; ${file}`);
    process.exit(failure === null && passed === checks.length ? 0 : 1);
}

process.on('SIGINT', () => {
    unlock();
    process.exit(130);
});
main().catch((e) => {
    unlock();
    console.error(e);
    process.exit(2);
});
