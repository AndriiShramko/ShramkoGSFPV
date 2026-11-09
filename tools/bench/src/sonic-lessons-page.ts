// v0.12 Fly by Sound, lane v12-flight step 9 (docs/wip/v12-plan.md 4.2): lessons passed end to end in the real page, headless
// Chrome, the keyboard only. For each lesson: /fly/?sonic=<id> on the Vite dev server, Enter on the start screen's
// "Start: <lesson>" button (the user activation), then a scripted pilot reads the page's test hook (window.__gsfpv.sonic: the
// lesson, its phase, the craft, the question asked, the mode's events) and presses keys like a person, until the lesson's own
// `lesson passed` event. The page is the real one: the flight model on the lesson's built-in world, the lesson pilot, the
// sound engine on one AudioContext, the sound package's lesson runner, the helper's view drawn. "My screen reader speaks" is
// on and the speaking speed 2 (the engine says nothing, waits the time a line takes, at double speed) so that the run is
// not dominated by speech; a tap in front of the destination measures what the engine produced.
//   ears-headphones   N once (skips the intro), then a digit for each question from the sound that was played;
//   shapes-square     W held: through the square, two of three;
//   rings-first       W held: through the ring, the lesson's required number of gates (3 since v0.13); after the pass the next lesson of the path opens in the page
//                     (its world swapped in) and the engine, the page and the one AudioContext go on;
//   hover-height      Space until the craft is in the 2 to 3 m band, then nothing (the height is held): the lesson's required number of attempts (3 since v0.13);
//                     Escape and the pause menu's "Fly by Sound" item open the start screen over the flight and Escape closes it.
// Module 7 is a scan (step 10); the first lessons of modules 2, 3 and 4 are passed through the same host in
// tools/bench/test/sonic-lessons.test.ts (virtual time, the real flight model), not here: they take minutes of real time.
// Evidence: evidence/<date>/sonic-lessons-page.json and screenshots next to it. Holds the GPU lock (the page draws).
//   cd apps/fly && npx vite --port 5342 --strictPort            (another shell)
//   cd tools/bench && LAB=http://localhost:5342 npx tsx src/sonic-lessons-page.ts [lesson ids]
import { mkdirSync, rmdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { SCHEMA_VERSION } from '../../../packages/prefs/src';
import { defaultPrefs, getLesson, lessonPaths } from '../../../packages/sonic-fpv/src';
import { launch } from './browser';
import { REPO, today, writeEvidence } from './evidence';

const LAB = (process.env.LAB ?? '').replace(/\/$/, '');
if (!LAB) throw new Error('LAB=http://localhost:<vite port> is needed');
const LOCK = 'C:/dev/.gpu-lock';
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
/** SONIC_CSS=<css>: the control of the captions check, a style put on the page after it is ready (own evidence name). */
const CONTROL_CSS = process.env.SONIC_CSS ?? '';
const NAME = process.env.SONIC_VOICE === '1' ? 'sonic-lessons-page-voice' : CONTROL_CSS ? 'sonic-lessons-page-control' : 'sonic-lessons-page';
const OUT = join(REPO, 'evidence', today(), NAME);
mkdirSync(OUT, { recursive: true });

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

/**
 * SONIC_VOICE=1 leaves the engine speaking with the browser's own voices (the default of a pilot, speed 1); else the prefs
 * document the page starts from has the engine silent (a screen reader would speak), at double speed, so that the run is not
 * dominated by speech.
 */
const VOICE = process.env.SONIC_VOICE === '1';
const DOC = {
    format: 'gsfpv-prefs',
    version: SCHEMA_VERSION,
    app: '0.3.0',
    savedAt: '2026-11-07T00:00:00.000Z',
    settings: { global: {}, drone: {}, scene: {} },
    collections: { sonic: { v: 1, prefs: VOICE ? { ...defaultPrefs() } : { ...defaultPrefs(), selfVoice: false, speechRate: 2 }, progress: {}, current: null }, ui: { v: 1, warned: true } }
};

const INIT = `(() => {
  window.__name = (f) => f;
  try { if (!localStorage.getItem('gsfpv.prefs.v1')) localStorage.setItem('gsfpv.prefs.v1', ${JSON.stringify(JSON.stringify(DOC))}); } catch (e) {}
  window.__speech = { speaks: 0, cancels: 0, texts: [] };
  try {
    const synth = window.speechSynthesis;
    const speak = synth.speak.bind(synth), cancel = synth.cancel.bind(synth);
    synth.speak = (u) => { if (u.text) { window.__speech.speaks++; window.__speech.texts.push(u.text); } return speak(u); };
    synth.cancel = () => { window.__speech.cancels++; return cancel(); };
  } catch (e) {}
  const Orig = window.AudioContext;
  window.__acCount = 0;
  window.__tap = { maxRms: 0, maxPeak: 0, polls: 0, loud: 0, last: 0 };
  class TapContext extends Orig {
    constructor(o) { super(o); window.__acCount++; }
    get destination() {
      if (!this.__tapIn) {
        const real = super.destination;
        const g = this.createGain();
        const an = this.createAnalyser();
        an.fftSize = 2048;
        g.connect(an);
        g.connect(real);
        this.__tapIn = g;
        const buf = new Float32Array(2048);
        setInterval(() => {
          an.getFloatTimeDomainData(buf);
          let s = 0, p = 0;
          for (let i = 0; i < buf.length; i++) { const x = buf[i]; s += x * x; const a = Math.abs(x); if (a > p) p = a; }
          const rms = Math.sqrt(s / buf.length);
          const t = window.__tap;
          t.polls++;
          t.last = rms;
          if (rms > t.maxRms) t.maxRms = rms;
          if (p > t.maxPeak) t.maxPeak = p;
          if (rms > 1e-3) t.loud++;
        }, 50);
      }
      return this.__tapIn;
    }
  }
  window.AudioContext = TapContext;
})();`;

interface Probe {
    lesson: string | null;
    phase: string | null;
    attempt: number;
    touches: number;
    passed: boolean;
    asking: boolean;
    question: { id: string; options: number } | null;
    engine: string;
    pos: [number, number, number];
    yaw: number;
    speed: number;
    armed: boolean;
    speechQueue: number;
    lastLine: string | null;
    stagePrims: number;
    progress: Record<string, { passed: boolean; attempts: number; successes: number }>;
    events: { kind: string; what?: string; lessonId?: string; t: number; via?: string; value?: number | null; gateId?: string; item?: string; key?: string; text?: string }[];
}

const checks: { name: string; pass: boolean; value?: unknown }[] = [];
const check = (name: string, pass: boolean, value?: unknown): void => {
    checks.push({ name, pass, value });
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${value === undefined ? '' : '  ' + JSON.stringify(value).slice(0, 260)}`);
};

const probe = (page: Page, events = false): Promise<Probe> => page.evaluate((e) => (window as unknown as { __gsfpv: { sonic: (e?: boolean) => unknown } }).__gsfpv.sonic(e), events) as Promise<Probe>;
const hasPassed = (p: Probe, id: string): boolean => p.events.some((e) => e.kind === 'lesson' && e.what === 'passed' && e.lessonId === id);

/** The largest output level of the tap over `ms` (polled every 30 ms). */
async function levelOver(page: Page, ms: number): Promise<number> {
    let max = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
        max = Math.max(max, await page.evaluate(() => (window as unknown as { __tap: { last: number } }).__tap.last));
        await sleep(30);
    }
    return max;
}

/** What a pilot does for a lesson: called every 50 ms with the probe, presses keys. */
type Pilot = (page: Page, p: Probe, state: Record<string, unknown>) => Promise<void>;

/** Keys held down, only the changes are sent. */
async function hold(page: Page, state: Record<string, unknown>, key: string, want: boolean): Promise<void> {
    if ((state[key] === true) === want) return;
    state[key] = want;
    if (want) await page.keyboard.down(key);
    else await page.keyboard.up(key);
}

const PILOTS: Record<string, Pilot> = {
    // each trial: the sound that was played tells the digit (the runner plays left, right, behind: 1, 2, 2)
    'ears-headphones': async (page, p, state) => {
        if (state.skipped !== true && p.phase === 'intro') {
            state.skipped = true;
            await page.keyboard.press('KeyN');
            return;
        }
        if (!p.asking || p.speechQueue > 0 || !p.question) return;
        if (state.answered === p.question.id) return;
        state.answered = p.question.id;
        const i = Number(p.question.id.split(':')[2]);
        const digit = i === 1 ? 1 : 2;
        await page.keyboard.press(`Digit${digit}`);
    },
    'shapes-square': async (page, p, state) => {
        if (state.skipped !== true && p.phase === 'intro') {
            state.skipped = true;
            await page.keyboard.press('KeyN');
        }
        await hold(page, state, 'KeyW', true);
    },
    'rings-first': async (page, p, state) => {
        if (state.skipped !== true && p.phase === 'intro') {
            state.skipped = true;
            await page.keyboard.press('KeyN');
        }
        await hold(page, state, 'KeyW', true);
    },
    'hover-height': async (page, p, state) => {
        if (state.skipped !== true && p.phase === 'intro') {
            state.skipped = true;
            await page.keyboard.press('KeyN');
        }
        // up until the craft is in the band's middle, then the keys let go: the height is held
        await hold(page, state, 'Space', p.pos[1] < 2.3);
    }
};

await lock();
const results: Record<string, unknown>[] = [];
try {
    const L = await launch({ width: 1280, height: 720 });
    await L.context.addInitScript(INIT);
    await L.context.addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: LAB }]);
    const page = L.page;
    const notFound: string[] = [];
    page.on('response', (r) => { if (r.status() === 404) notFound.push(r.url()); });
    const ids = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(PILOTS);

    for (const id of ids) {
        const pilot = PILOTS[id];
        if (!pilot) throw new Error(`no pilot for ${id}`);
        const t0 = Date.now();
        await page.goto(`${LAB}/fly/?sonic=${id}&nowarn=1`);
        await page.waitForSelector('[data-testid="sonic-start-asked"]', { timeout: 60000 });
        // the keyboard alone: focus the button, Enter (the user activation)
        await page.focus('[data-testid="sonic-start-asked"]');
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => { const h = (window as unknown as { __gsfpv?: { status?: string; sonic?: () => { lesson: string | null } } }).__gsfpv; return h?.status === 'ready' && h.sonic?.().lesson !== null; }, undefined, { timeout: 90000 });
        if (CONTROL_CSS) await page.addStyleTag({ content: CONTROL_CSS });
        const first = await probe(page);
        check(`${id}: the page flies the lesson (the mode runs, the engine runs, one AudioContext, the helper's view is drawn)`, first.lesson === id && first.engine === 'running' && first.stagePrims > 0 && (await page.evaluate(() => (window as unknown as { __acCount: number }).__acCount)) === 1, { lesson: first.lesson, engine: first.engine, prims: first.stagePrims });
        // the captions (the lines the lesson says) must not cover what the page draws: the take-off line, the keys strip, the
        // recording bar, the top bar, and must leave the view's centre, where the target is, free (seen covered once, in a screenshot)
        await page.waitForFunction(() => document.querySelectorAll('[data-testid="sonic-captions"] .sonic-caption').length >= 2, undefined, { timeout: 15000 }).catch(() => undefined);
        const cover = await page.evaluate(() => {
            const lines = [...document.querySelectorAll('[data-testid="sonic-captions"] .sonic-caption')].map((e) => e.getBoundingClientRect());
            const covered: string[] = [];
            for (const el of document.querySelectorAll('#ui *')) {
                const r = el.getBoundingClientRect();
                if (r.width < 2 || r.height < 2) continue;
                const cs = getComputedStyle(el);
                if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
                const own = [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? '').trim() !== '');
                if (!own && el.tagName !== 'BUTTON') continue;
                if (lines.some((l) => r.left < l.right && r.right > l.left && r.top < l.bottom && r.bottom > l.top)) covered.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}: ${(el.textContent ?? '').trim().slice(0, 30)}`);
            }
            return { lines: lines.length, covered, lowest: Math.round(Math.max(0, ...lines.map((l) => l.bottom))), centre: Math.round(window.innerHeight / 2) };
        });
        check(`${id}: the captions cover nothing the page draws and stay above the view's centre (2 or more lines, no element of the page under them)`, cover.lines >= 2 && cover.covered.length === 0 && cover.lowest < cover.centre - 20, cover);
        const state: Record<string, unknown> = {};
        let passed = false;
        let shot = false;
        let last: Probe = first;
        const limit = Date.now() + (id === 'rings-first' || id === 'hover-height' ? 9 : 6) * 60000 * (VOICE ? 2 : 1);
        let menuChecked = false;
        while (Date.now() < limit) {
            last = await probe(page, false);
            await pilot(page, last, state);
            if (!shot && last.phase === 'flying') {
                shot = true;
                await sleep(800);
                writeFileSync(join(OUT, `${id}-flying.png`), await page.screenshot({ type: 'png' }));
            }
            if (id === 'hover-height' && !menuChecked && last.phase === 'flying' && last.pos[1] > 2.2) {
                menuChecked = true;
                await hold(page, state, 'Space', false);
                // v0.13 (v13-host B3, B4): Z repeats the whole task, not the last line: the key is written first (action repeat), then the lesson's title,
                // every line of its task (the sounds they name played three times) and "Go on." at the end, the attempt waiting meanwhile; I says the
                // runner's status line (lesson k of n, step, attempt, counted). Both are speech events of the mode (and captions); the lesson may say a
                // line of its own meanwhile, so the events after the key are searched in order, not counted.
                type Ev = { kind: string; key?: string; text?: string; action?: string };
                const eventsNow = async (): Promise<Ev[]> => (await probe(page, true)).events as unknown as Ev[];
                const speechAfter = (list: Ev[]): Ev[] => list.filter((e) => e.kind === 'speech' && e.key !== 'speech.end');
                const lesson = getLesson(id);
                const nZ = (await eventsNow()).length;
                await page.keyboard.press('KeyZ');
                let afterZ: Ev[] = [];
                for (const t1 = Date.now(); Date.now() - t1 < 90000;) {
                    afterZ = (await eventsNow()).slice(nZ);
                    if (afterZ.some((e) => e.kind === 'speech' && e.key === 'fly.go-on')) break;
                    await sleep(300);
                }
                const zSpeech = speechAfter(afterZ);
                const nI = (await eventsNow()).length;
                await page.keyboard.press('KeyI');
                await sleep(500);
                const afterI = speechAfter((await eventsNow()).slice(nI));
                const statusLine = afterI.find((e) => e.key === 'status.progress');
                const place = lessonPaths().full.indexOf(id) + 1;
                check('Z repeats the whole task (its key event first, then the lesson\'s title, every line of the task, "Go on." last) and I says where the pilot is (the runner\'s status line: lesson k of n, step, attempt, counted)', afterZ.find((e) => e.kind === 'key')?.action === 'repeat' && zSpeech[0]?.key === lesson.title.key && lesson.intro.every((l) => zSpeech.some((e) => e.key === l.key)) && zSpeech.at(-1)?.key === 'fly.go-on' && !!statusLine && (statusLine.text ?? '').startsWith(`Lesson ${place} of ${lessonPaths().full.length}: `) && /Step \d+ of \d+\. Attempt \d+\. Counted \d+ of \d+\.$/.test(statusLine.text ?? ''), { z: zSpeech.map((e) => e.key), i: afterI.map((e) => e.text) });
                // the height tone sounds while the flight runs
                const before = await levelOver(page, 900);
                // the pause menu's Fly by Sound item opens the start screen over the flight; Escape closes it. Since v0.13 (v13-host B6) Escape in a
                // lesson opens the lesson menu: the page's pause menu is on P
                await page.keyboard.press('KeyP');
                await page.waitForSelector('[data-action="pause.sonic"]', { timeout: 5000 }).catch(() => undefined);
                const item = await page.$('[data-action="pause.sonic"]');
                if (item) {
                    await item.focus();
                    await page.keyboard.press('Enter');
                    await page.waitForSelector('#sonic-start:not([hidden])', { timeout: 5000 }).catch(() => undefined);
                    // frames stopped: the bridge sent setLayers({ on: [] }), the engine falls silent (the layers release in tens of ms)
                    await sleep(700);
                    const during = await levelOver(page, 900);
                    const open = await page.evaluate(() => { const r = document.getElementById('sonic-start')!; return { visible: !r.hidden, focus: document.activeElement?.id, paused: (window as unknown as { __gsfpv: { session: { paused: boolean } } }).__gsfpv.session.paused }; });
                    await page.keyboard.press('Escape');
                    await sleep(400);
                    const closed = await page.evaluate(() => ({ hidden: document.getElementById('sonic-start')!.hidden, paused: (window as unknown as { __gsfpv: { session: { paused: boolean } } }).__gsfpv.session.paused }));
                    check('the pause menu offers Fly by Sound; its item shows the start screen over the flight (flight paused), Escape closes it and the flight goes on', open.visible && open.focus === 'sonic-h1' && open.paused && closed.hidden && !closed.paused, { open, closed });
                    const after = await levelOver(page, 1500);
                    // the motor sound: ON in the mode by default since v0.13 (M41-16: the motors play into the engine's motor bus under the cues, through
                    // its limiter, on its context, from the lesson's start); the top bar's speaker flips it: the first press turns it off, the second on.
                    // The volume is put to 100 for the test: the motors are then at their loudest, and the ceiling of the limiter is what the peak must hold under
                    type SoundHook = { context: string | null; mix: { master: number } | null };
                    const soundHook = (): Promise<SoundHook | undefined> => page.evaluate(() => (window as unknown as { __gsfpv: { sound?: () => SoundHook } }).__gsfpv.sound?.());
                    const peakNow = (): Promise<number> => page.evaluate(() => (window as unknown as { __tap: { maxPeak: number } }).__tap.maxPeak);
                    const sound0 = await soundHook();
                    await page.evaluate(() => (window as unknown as { __gsfpv: { prefs: { set(id: string, v: unknown): unknown } } }).__gsfpv.prefs.set('sound.volume', 100));
                    await page.focus('[data-action="sound-toggle"]');
                    await page.keyboard.press('Enter');
                    await sleep(700);
                    const motorOff = await levelOver(page, 1500);
                    const soundOff = await soundHook();
                    await page.keyboard.press('Enter');
                    await sleep(700);
                    const motorOn = await levelOver(page, 1500);
                    const soundOn = await soundHook();
                    const peakOn = await peakNow();
                    await page.evaluate(() => (window as unknown as { __gsfpv: { prefs: { reset(id: string): void } } }).__gsfpv.prefs.reset('sound.volume'));
                    const acs = await page.evaluate(() => (window as unknown as { __acCount: number }).__acCount);
                    check('the motor sound in the mode (v0.13: on by default): the graph is on the engine\'s own context from the start (one AudioContext, master over 0); the speaker button\'s first press turns it off (master 0), the second on again (master over 0), the output a little louder with the motors (they play under the cues) and its peak under the limiter\'s ceiling (0.5013)', sound0?.context === 'running' && (sound0.mix?.master ?? 0) > 0 && (soundOff?.mix?.master ?? 1) === 0 && (soundOn?.mix?.master ?? 0) > 0 && motorOn > motorOff * 1.1 && peakOn <= 0.5013 && acs === 1, { sound0: { ctx: sound0?.context, master: sound0?.mix?.master }, soundOff: { master: soundOff?.mix?.master }, soundOn: { master: soundOn?.mix?.master }, levels: { after, motorOff, motorOn, ratio: Math.round((motorOn / motorOff) * 1000) / 1000 }, peakOn, audioContexts: acs });
                    // the pause leaves the motors' own floor (about 1e-4 RMS, measured: the motors are on by default since v0.13); the tone's silence is a factor of 20 or more under its level
                    check('the sound follows the frames: the height tone sounds (RMS over 1e-3), is silent while the flight is paused behind the start screen (RMS under 3e-4 and 20 times under the tone: setLayers none, only the motors\' floor is left), and is back when the flight goes on', before > 1e-3 && during < 3e-4 && during * 20 < before && after > 1e-3, { before, during, after });
                } else check('the pause menu offers a Fly by Sound item', false);
            }
            const withEvents = await probe(page, true);
            if (hasPassed(withEvents, id)) {
                passed = true;
                last = withEvents;
                break;
            }
            await sleep(40);
        }
        for (const k of Object.keys(state)) if (state[k] === true && /^(Key|Space)/.test(k)) await page.keyboard.up(k);
        const end = await probe(page, true);
        const secs = Math.round((Date.now() - t0) / 1000);
        const answers = end.events.filter((e) => e.kind === 'answer');
        const gates = end.events.filter((e) => e.kind === 'gate');
        const speechEnds = end.events.filter((e) => e.kind === 'speech' && e.key === 'speech.end').length;
        const speechLines = end.events.filter((e) => e.kind === 'speech' && e.key !== 'speech.end').length;
        const tap = await page.evaluate(() => (window as unknown as { __tap: { maxRms: number; maxPeak: number; polls: number; loud: number } }).__tap);
        const captionLines = await page.evaluate(() => [...document.querySelectorAll('[data-testid="sonic-captions"] .sonic-caption')].map((e) => e.textContent));
        const prog = end.progress[id];
        check(`${id}: passed end to end by the keyboard (the lesson's own 'passed' event)`, passed, { seconds: secs, attempts: prog?.attempts, successes: prog?.successes });
        check(`${id}: progress saved in the prefs collection (passed, attempts, successes)`, !!prog && prog.passed === true && prog.attempts >= 1 && prog.successes >= 1, prog);
        const said = await page.evaluate(() => (window as unknown as { __speech: { speaks: number; cancels: number; texts: string[] } }).__speech);
        check(`${id}: the lesson's lines are speech events of the mode (the captions' source)`, speechLines >= 3, { speechLines, speechEnds });
        if (VOICE) {
            // the engine speaks: its lines reach speechSynthesis, and what a key interrupts is cancelled there (say.interrupt)
            check(`${id}: with the voice on, the lines reach speechSynthesis (at least 3 utterances) and an interrupt cancels what was queued`, said.speaks >= 3 && said.cancels >= (id === 'ears-headphones' ? 1 : 1), { utterances: said.speaks, cancels: said.cancels, first: said.texts.slice(0, 2) });
        } else {
            // my screen reader speaks: the engine reports the lines (captions) and says none of them itself
            check(`${id}: with "my screen reader speaks" the engine says nothing itself (no utterance reaches speechSynthesis)`, said.speaks === 0, { utterances: said.speaks });
        }
        if (id === 'ears-headphones') check('ears-headphones: the speech queue ran empty at least twice (speech.end markers, the replay\'s input)', speechEnds >= 2, { speechEnds });
        check(`${id}: the engine made sound (RMS over 1e-3 at some point) and held the ceiling (peak at most 0.5013)`, tap.maxRms > 1e-3 && tap.maxPeak <= 0.5013, tap);
        if (id === 'ears-headphones') {
            check('ears-headphones: three questions answered by digit keys, right (the lesson says the headphones work well)', answers.length >= 3 && answers.every((a) => a.via === 'key' && a.value !== null) && end.events.some((e) => e.kind === 'speech' && e.key === 'headphones.good'), answers.map((a) => a.value));
        } else if (id === 'hover-height') {
            check(`hover-height: the lesson's required number of attempts (${getLesson('hover-height').pass.required}) met the goal (the lesson's own, in the 2 to 3 m band)`, end.events.filter((e) => e.kind === 'goal' && e.what === 'met').length >= getLesson('hover-height').pass.required, undefined);
            check('hover-height: the motors started by the first press of Space (no arm switch)', last.armed || end.armed, undefined);
        } else {
            check(`${id}: gates passed, each inside the opening`, gates.length >= getLesson(id).pass.required && gates.every((g) => (g as unknown as { missM: number }).missM < 1.5), gates.length);
        }
        // what follows a pass: the next lesson of the path opens in the page
        if (passed) {
            const nextId = await (async (): Promise<string | null> => {
                for (let i = 0; i < 100; i++) {
                    const p = await probe(page);
                    if (p.lesson !== id && p.lesson !== null) return p.lesson;
                    await sleep(200);
                }
                return null;
            })();
            const after = await probe(page);
            const scene = await page.evaluate(() => (window as unknown as { __gsfpv: { session: { scene: { id: string } } } }).__gsfpv.session.scene.id);
            check(`${id}: after the pass the next lesson of the path opens (${nextId}) and the page goes on (scene ${scene}, engine ${after.engine}, one AudioContext)`, nextId !== null && after.engine === 'running' && scene.startsWith('lesson-') && (await page.evaluate(() => (window as unknown as { __acCount: number }).__acCount)) === 1, { next: nextId, scene });
            writeFileSync(join(OUT, `${id}-after-pass.png`), await page.screenshot({ type: 'png' }));
        }
        results.push({ lesson: id, voice: VOICE, passed, seconds: secs, utterances: said.speaks, cancels: said.cancels, attempts: prog?.attempts, successes: prog?.successes, answers: answers.length, gates: gates.length, touches: end.events.filter((e) => e.kind === 'touch').length, speechLines, speechEnds, tap, captionLines, stagePrims: end.stagePrims });
    }
    // G opens the sound glossary from any lesson (and would come back to it): a fresh page on shapes-square, one key
    if (ids.includes('shapes-square')) {
        await page.goto(`${LAB}/fly/?sonic=shapes-square&nowarn=1`);
        await page.waitForSelector('[data-testid="sonic-start-asked"]', { timeout: 60000 });
        await page.focus('[data-testid="sonic-start-asked"]');
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => { const h = (window as unknown as { __gsfpv?: { status?: string; sonic?: () => { lesson: string | null } } }).__gsfpv; return h?.status === 'ready' && h.sonic?.().lesson !== null; }, undefined, { timeout: 90000 });
        await sleep(600);
        await page.keyboard.press('KeyG');
        await page.waitForFunction(() => (window as unknown as { __gsfpv: { sonic: () => { lesson: string | null } } }).__gsfpv.sonic().lesson === 'ears-glossary', undefined, { timeout: 15000 }).catch(() => undefined);
        const g = await probe(page, true);
        const opens = g.events.filter((e) => e.kind === 'lesson' && e.what === 'open').map((e) => e.lessonId);
        check('G opens the sound glossary from a lesson (ears-glossary runs, the helper\'s view is the glossary\'s floor)', g.lesson === 'ears-glossary' && opens.includes('ears-glossary') && g.engine === 'running', { lesson: g.lesson, opens });
    }
    const missing = notFound.filter((u) => !/\/favicon\.ico$/.test(u) && !/\/api\//.test(u));
    const errors = L.console.filter((l) => /^(error|pageerror)/i.test(l) && !/Failed to load resource.*404/.test(l));
    check('no console errors and no missing file (but the favicon and the API the dev server does not have)', errors.length === 0 && missing.length === 0, { errors: errors.slice(0, 6), missing });
    const file = writeEvidence(NAME, {
        step: 'v12-flight 9: lessons passed end to end in the real page by a scripted keyboard pilot',
        page: `${LAB}/fly/?sonic=<lesson> (Vite dev server)`,
        voice: VOICE ? 'the engine speaks with the browser\'s own voices (speed 1)' : 'the engine says nothing (my screen reader speaks, speed 2): it waits the time a line takes',
        voices: await page.evaluate(() => speechSynthesis.getVoices().length),
        note: 'headless Chrome runs muted (--mute-audio); how anything sounds is not judged here',
        results,
        notFound: [...new Set(notFound)],
        checks,
        pass: checks.every((c) => c.pass)
    });
    console.log(`evidence ${file}; ${checks.filter((c) => c.pass).length}/${checks.length} checks pass`);
    process.exitCode = checks.every((c) => c.pass) ? 0 : 1;
    await L.browser.close();
} finally {
    unlock();
}
