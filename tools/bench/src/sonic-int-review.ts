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
// Run from tools/bench after `node scripts/build-release.mjs`:   npx tsx src/sonic-int-review.ts [r1|r2|r3|r4|r5]
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

const PORT = 5420;
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
    checks: { lesson: string | null; frames: number; compared: boolean; ok: boolean | null; recorded: number; matched: number; diffs: number; cueShare: number | null; cueClassShare: number | null }[];
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
    check('R5: the sounds agree (every frame\'s cue ids) and the panel says the replay agrees', rows[0]?.cueShare === 1 && ready.state.check?.ok === true, { rows: rows.map((r) => [r.lesson, r.cueShare, r.cueClassShare]), summary: ready.state.check });
    await ctx.close();
}

// ------------------------------------------------------------------------------------------------ main

const result: Record<string, unknown> = {};

async function main(): Promise<void> {
    const which = (process.argv[2] ?? 'r1').toLowerCase();
    let release: unknown = null;
    try {
        release = JSON.parse((await import('node:fs')).readFileSync(`${DIST}/release.json`, 'utf8'));
    } catch {
        throw new Error('dist/release.json is missing: run `node scripts/build-release.mjs` first');
    }
    if ((release as { sha?: string }).sha !== gitSha()) console.log(`NOTE: dist was built at ${(release as { sha?: string }).sha}, the tree is at ${gitSha()}`);
    await lock();
    locked = true;
    let served: Served | null = null;
    let browserHandle: Awaited<ReturnType<typeof launchChrome>>['browser'] | null = null;
    let failure: string | null = null;
    try {
        served = await serveDist(DIST, {}, PORT);
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
    const file = writeEvidence(`sonic-int-review-${which}`, { site: `http://127.0.0.1:${PORT}`, release, git: gitSha(), seconds: Math.round((Date.now() - T0) / 1000), passed, total: checks.length, pass: failure === null && passed === checks.length, checks, result, problems });
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
