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
//   rings-first       W held: through the ring, eight of ten; after the pass the next lesson of the path opens in the page
//                     (its world swapped in) and the engine, the page and the one AudioContext go on;
//   hover-height      Space until the craft is in the 2 to 3 m band, then nothing (the height is held): four of five;
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
import { defaultPrefs } from '../../../packages/sonic-fpv/src';
import { launch } from './browser';
import { REPO, today, writeEvidence } from './evidence';

const LAB = (process.env.LAB ?? '').replace(/\/$/, '');
if (!LAB) throw new Error('LAB=http://localhost:<vite port> is needed');
const LOCK = 'C:/dev/.gpu-lock';
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const OUT = join(REPO, 'evidence', today(), 'sonic-lessons-page');
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

/** The prefs document the page starts from: the engine does not speak (a screen reader would), at double speed. */
const DOC = {
    format: 'gsfpv-prefs',
    version: SCHEMA_VERSION,
    app: '0.3.0',
    savedAt: '2026-11-07T00:00:00.000Z',
    settings: { global: {}, drone: {}, scene: {} },
    collections: { sonic: { v: 1, prefs: { ...defaultPrefs(), selfVoice: false, speechRate: 2 }, progress: {}, current: null }, ui: { v: 1, warned: true } }
};

const INIT = `(() => {
  window.__name = (f) => f;
  try { if (!localStorage.getItem('gsfpv.prefs.v1')) localStorage.setItem('gsfpv.prefs.v1', ${JSON.stringify(JSON.stringify(DOC))}); } catch (e) {}
  const Orig = window.AudioContext;
  window.__acCount = 0;
  window.__tap = { maxRms: 0, maxPeak: 0, polls: 0, loud: 0 };
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
        const first = await probe(page);
        check(`${id}: the page flies the lesson (the mode runs, the engine runs, one AudioContext, the helper's view is drawn)`, first.lesson === id && first.engine === 'running' && first.stagePrims > 0 && (await page.evaluate(() => (window as unknown as { __acCount: number }).__acCount)) === 1, { lesson: first.lesson, engine: first.engine, prims: first.stagePrims });
        const state: Record<string, unknown> = {};
        let passed = false;
        let shot = false;
        let last: Probe = first;
        const limit = Date.now() + (id === 'rings-first' || id === 'hover-height' ? 9 : 6) * 60000;
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
                // the pause menu's Fly by Sound item opens the start screen over the flight; Escape closes it
                await page.keyboard.press('Escape');
                await page.waitForSelector('[data-action="pause.sonic"]', { timeout: 5000 }).catch(() => undefined);
                const item = await page.$('[data-action="pause.sonic"]');
                if (item) {
                    await item.focus();
                    await page.keyboard.press('Enter');
                    await page.waitForSelector('#sonic-start:not([hidden])', { timeout: 5000 }).catch(() => undefined);
                    const open = await page.evaluate(() => { const r = document.getElementById('sonic-start')!; return { visible: !r.hidden, focus: document.activeElement?.id, paused: (window as unknown as { __gsfpv: { session: { paused: boolean } } }).__gsfpv.session.paused }; });
                    await page.keyboard.press('Escape');
                    await sleep(400);
                    const closed = await page.evaluate(() => ({ hidden: document.getElementById('sonic-start')!.hidden, paused: (window as unknown as { __gsfpv: { session: { paused: boolean } } }).__gsfpv.session.paused }));
                    check('the pause menu offers Fly by Sound; its item shows the start screen over the flight (flight paused), Escape closes it and the flight goes on', open.visible && open.focus === 'sonic-h1' && open.paused && closed.hidden && !closed.paused, { open, closed });
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
        check(`${id}: the lesson's speech was said through the engine and its end reported (speech events and speech.end markers)`, speechLines >= 3 && speechEnds >= 2, { speechLines, speechEnds });
        check(`${id}: the engine made sound (RMS over 1e-3 at some point) and held the ceiling (peak at most 0.5013)`, tap.maxRms > 1e-3 && tap.maxPeak <= 0.5013, tap);
        if (id === 'ears-headphones') {
            check('ears-headphones: three questions answered by digit keys, right (the lesson says the headphones work well)', answers.length >= 3 && answers.every((a) => a.via === 'key' && a.value !== null) && end.events.some((e) => e.kind === 'speech' && e.key === 'headphones.good'), answers.map((a) => a.value));
        } else if (id === 'hover-height') {
            check('hover-height: four attempts met the goal (20 s in the 2 to 3 m band, 80 % of the time)', end.events.filter((e) => e.kind === 'goal' && e.what === 'met').length >= 4, undefined);
            check('hover-height: the motors started by the first press of Space (no arm switch)', last.armed || end.armed, undefined);
        } else {
            check(`${id}: gates passed, each inside the opening`, gates.length >= (id === 'rings-first' ? 8 : 2) && gates.every((g) => (g as unknown as { missM: number }).missM < 1.5), gates.length);
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
        results.push({ lesson: id, passed, seconds: secs, attempts: prog?.attempts, successes: prog?.successes, answers: answers.length, gates: gates.length, touches: end.events.filter((e) => e.kind === 'touch').length, speechLines, speechEnds, tap, captionLines, stagePrims: end.stagePrims });
    }
    const missing = notFound.filter((u) => !/\/favicon\.ico$/.test(u) && !/\/api\//.test(u));
    const errors = L.console.filter((l) => /^(error|pageerror)/i.test(l) && !/Failed to load resource.*404/.test(l));
    check('no console errors and no missing file (but the favicon and the API the dev server does not have)', errors.length === 0 && missing.length === 0, { errors: errors.slice(0, 6), missing });
    const file = writeEvidence('sonic-lessons-page', {
        step: 'v12-flight 9: lessons passed end to end in the real page by a scripted keyboard pilot',
        page: `${LAB}/fly/?sonic=<lesson> (Vite dev server)`,
        note: 'headless Chrome runs muted (--mute-audio); the engine says nothing (my screen reader speaks, speed 2) and waits the time a line takes; how anything sounds is not judged here',
        results,
        notFound: [...new Set(notFound)],
        checks,
        pass: checks.every((c) => c.pass)
    });
    console.log(`evidence ${file}; ${checks.filter((c) => c.pass).length}/${checks.length} checks pass`);
    await L.browser.close();
} finally {
    unlock();
}
