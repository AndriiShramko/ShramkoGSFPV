// v0.13 Fly by Sound, lane v13-host C6 (docs/wip/v13-host.md "Stage C"): the page proofs of the lane in the real page. A RELEASE build of
// this tree served with nginx's enforced CSP and its /fly/ language redirect (tools/bench/scripts/serve-csp.mjs), headless Chrome, the
// keyboard only (one click on the pause menu's link, as a sighted pilot would).
//   A  the pause menu's item (M41-1): on an ordinary page it is a link to /en/fly/?sonic=start in a new tab, which it says to a screen
//      reader; followed, the mode's start screen opens, with the page about the mode in its footer; the flight stays paused under the menu.
//   B  the start screen (M41-2, W7), a saved progress (one lesson passed, one skipped, one in progress and left off on): "Continue:
//      <lesson>" first with its place and state, "Start the course from the beginning" with lesson 1 and "Your progress is kept"; the 28
//      lessons in the path's order, each "Lesson N of 28" and its state; Reset asks first (No has the focus), Escape keeps everything, Yes
//      clears every lesson and the current one and keeps the sound settings; after a reload every lesson is new.
//   C  the spoken settings list (M41-4, W13): the first key starts the sound and the voice says how the list works, then the stop; the
//      arrows reach the settings by the navigation, Motor volume and Target height note; Left, Right and Enter change them; every focus
//      and every value is said (what reached the browser's voice through the engine), saved, and read back after a reload; Escape goes
//      back to the first Start button.
//   D  the Escape menu in a lesson (M41-3), driven by keys: every line the engine was asked to say (the mode's speech events, which the
//      engine's own onSpeech writes) and what reached the browser's voice: the menu's name and how it works, then the eight items in
//      order, "Item n of 8", each cutting the one before; the flight held while it is up; Escape lets it go.
//   E  the progress panel after an attempt (M41-7): rings-first flown through its ring with W held; once the first attempt is counted
//      the panel says the lesson's place, the step, "Attempt 1" and "Counted 1 of 3", the numbers the runner's view has, large, opaque,
//      in the left part of the page, not over the view's middle.
//   R  the v13-int review's fixes in the page (docs/wip/v13-int-review.md "Fixes"): F1 the lesson menu early in hover-height (the task's
//      lines it cut said again whole after it, every utterance's start and end; the menu's own lines stop at the close), F2 and F4 the
//      start screen over rings-first (B, N, Z, G, R move nothing under it; closed, the focus on the flight's region; control: B moves the
//      lesson once the screen is gone), F3 B at the path's first lesson (closed, the lesson opens again and N moves it), F5 the progress
//      panel hidden while a recording plays and back after it, F7 a phone's way into the lesson menu (Pause, Lesson menu, Next step).
//   F2S the v13-int review's K1: F2's recording flown straight at the wall (W alone, no turn), as evidence/2026-11-09/sonic-v13-page-f2-
//      straight.json (PARTS=F2S EVIDENCE_SUFFIX=-f2-straight); before the fix it read FAIL (sonic-v13-page-f2-straight-before.json).
//   node scripts/build-release.mjs
//   node tools/bench/scripts/serve-csp.mjs dist <port>                       (another shell)
//   cd tools/bench && SITE=http://localhost:<port> npx tsx src/sonic-v13-page.ts
//   (control: CONTROL=reader PARTS=C,DE EVIDENCE_SUFFIX=-control-reader, the voice's checks fail with "my screen reader speaks")
// Holds C:/dev/.gpu-lock: one blocking loop (mkdir, else 20 s, at most 9 minutes), let go at the end, also on an error. Evidence:
// evidence/<date>/sonic-v13-page.json (the commit of the tree it ran on in its context; exit 1 when a check fails). The screenshots stay
// out of the repository (SHOTS, default the system's temp folder): their paths and SHA-256 are in the evidence.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser, BrowserContext, Page } from 'playwright';
import { SCHEMA_VERSION } from '../../../packages/prefs/src';
import { DICTS, SHIPPED_LESSON_IDS, createTranslator, defaultPrefs, getLesson, lessonPaths, readPackage } from '../../../packages/sonic-fpv/src';
import type { LessonProgress, SonicPrefs } from '../../../packages/sonic-fpv/src';
import { launchChrome } from './browser';
import { REPO, today, writeEvidence } from './evidence';

const SITE = (process.env.SITE ?? '').replace(/\/$/, '');
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(SITE)) throw new Error('SITE=http://localhost:<port> of a local release build is needed (never the live site)');
const LOCK = 'C:/dev/.gpu-lock';
const SHOTS = process.env.SHOTS ?? join(tmpdir(), 'gsfpv-sonic-v13-page', today());
mkdirSync(SHOTS, { recursive: true });
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
/**
 * CONTROL=reader: the control run of C and D (EVIDENCE_SUFFIX=-control-reader): the same build and keys with "my screen reader speaks"
 * saved, where the voice says no stop, no value and no menu item (the reader reads them): the checks of the voice must fail there.
 */
const CONTROL = process.env.CONTROL === 'reader';
const VOICE: Partial<SonicPrefs> = CONTROL ? { selfVoice: false } : {};
console.log(`sonic-v13-page target: ${SITE}, screenshots in ${SHOTS}`);

/** The GPU lock: one blocking loop, mkdir or 20 s more, at most 9 minutes. */
async function takeLock(): Promise<void> {
    const end = Date.now() + 9 * 60 * 1000;
    for (;;) {
        try {
            mkdirSync(LOCK);
            return;
        } catch {
            if (Date.now() > end) throw new Error('the GPU lock was not free for 9 minutes');
            console.log('waiting for the GPU lock');
            await sleep(20000);
        }
    }
}
let locked = false;
const letGo = (): void => {
    if (!locked) return;
    locked = false;
    try {
        rmdirSync(LOCK);
    } catch {
        /* gone */
    }
};
process.on('SIGINT', () => {
    letGo();
    process.exit(130);
});

// ------------------------------------------------------------------ words

const flyDict = (ns: string): Record<string, string> => JSON.parse(readFileSync(join(REPO, 'packages', 'i18n', 'locales', 'fly', ns, 'en.json'), 'utf8')) as Record<string, string>;
const MAIN = JSON.parse(readFileSync(join(REPO, 'packages', 'i18n', 'locales', 'fly', 'en.json'), 'utf8')) as Record<string, string>;
const SONIC = { ...flyDict('sonicentry'), ...flyDict('sonic') };
const LOOK = flyDict('soniclook');
const EN = createTranslator('en', DICTS);
const fill = (s: string, vars: Record<string, string | number>): string => Object.entries(vars).reduce((a, [k, v]) => a.split(`{${k}}`).join(String(v)), s);
const TOTAL = SHIPPED_LESSON_IDS.length;
const title = (id: string): string => EN.text(getLesson(id).title);
const placeOf = (id: string): string => fill(SONIC['sonic.progress.lesson'] ?? '', { n: lessonPaths().full.indexOf(id) + 1, total: TOTAL });

// ------------------------------------------------------------------ checks

const checks: { name: string; pass: boolean; value?: unknown }[] = [];
const check = (name: string, pass: boolean, value?: unknown): void => {
    checks.push({ name, pass, value });
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${value === undefined ? '' : '  ' + JSON.stringify(value).slice(0, 300)}`);
};
const shots: { file: string; sha256: string; what: string }[] = [];
async function shot(page: Page, name: string, what: string): Promise<void> {
    const file = join(SHOTS, `${name}.png`);
    const png = await page.screenshot({ path: file });
    shots.push({ file, sha256: createHash('sha256').update(png).digest('hex'), what });
}

// ------------------------------------------------------------------ the page

/** A lesson's saved progress as the runner writes it (v0.13: with `skipped`). */
const P = (id: string, o: Partial<LessonProgress>): LessonProgress => ({ lessonId: id, version: getLesson(id).version, attempts: 0, successes: 0, blocksPassed: 0, passed: false, bestTimeMs: null, lastAt: '2026-11-08T10:00:00.000Z', skipped: false, ...o });

/** The prefs document a profile starts from: the warning seen, these sound settings, this progress and current lesson. */
const doc = (sonic: Partial<SonicPrefs>, progress: Record<string, LessonProgress> = {}, current: string | null = null): object => ({
    format: 'gsfpv-prefs',
    version: SCHEMA_VERSION,
    app: '0.3.0',
    savedAt: '2026-11-08T00:00:00.000Z',
    settings: { global: {}, drone: {}, scene: {} },
    collections: { sonic: { v: 1, prefs: { ...defaultPrefs(), ...sonic }, progress, current }, ui: { v: 1, warned: true } }
});
/** The page's init script: the prefs above (once per profile), every line given to the browser's voice and every cut of it. */
const initScript = (d: object): string => `(() => {
  window.__name = (f) => f;
  try { if (!localStorage.getItem('gsfpv.prefs.v1')) localStorage.setItem('gsfpv.prefs.v1', ${JSON.stringify(JSON.stringify(d))}); } catch (e) {}
  window.__spoken = [];
  window.__spokenAt = [];
  window.__utter = [];
  window.__cancels = 0;
  try {
    const s = window.speechSynthesis;
    const sp = s.speak.bind(s);
    const cancel = s.cancel.bind(s);
    s.speak = (u) => {
      window.__spoken.push(u.text);
      window.__spokenAt.push(performance.now());
      try { const t = u.text; ['start', 'end', 'error'].forEach((k) => u.addEventListener(k, (ev) => window.__utter.push({ text: t, kind: k, at: performance.now(), error: ev && ev.error ? String(ev.error) : null }))); } catch (e) {}
      return sp(u);
    };
    s.cancel = () => { window.__cancels++; return cancel(); };
  } catch (e) {}
})();`;

async function profile(browser: Browser, d: object, scheme?: 'light' | 'dark'): Promise<BrowserContext> {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, ...(scheme ? { colorScheme: scheme } : {}) });
    await ctx.addInitScript({ content: initScript(d) });
    return ctx;
}

/** Polls `read` until `pred` (no waitForFunction: the release's CSP refuses a predicate made with new Function). */
async function until<T>(what: string, read: () => Promise<T>, pred: (v: T) => boolean, ms = 30000): Promise<T> {
    const t0 = Date.now();
    for (;;) {
        const v = await read();
        if (pred(v)) return v;
        if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}: ${JSON.stringify(v).slice(0, 400)}`);
        await sleep(100);
    }
}

/** The lines that reached the browser's voice, in order (the empty utterance that unlocks speech in the first press left out: it says nothing). */
const spoken = (page: Page): Promise<string[]> => page.evaluate(() => [...((window as unknown as { __spoken?: string[] }).__spoken ?? [])].filter((x) => x !== ''));
/** Every utterance with the page's clock (performance.now) at the moment it reached the browser's voice; the empty unlocking utterance left out. */
const spokenAt = (page: Page): Promise<{ text: string; at: number }[]> =>
    page.evaluate(() => {
        const w = window as unknown as { __spoken?: string[]; __spokenAt?: number[] };
        return (w.__spoken ?? []).map((text, i) => ({ text, at: w.__spokenAt?.[i] ?? 0 })).filter((x) => x.text !== '');
    });
const cancels = (page: Page): Promise<number> => page.evaluate(() => (window as unknown as { __cancels?: number }).__cancels ?? 0);
const ready = (page: Page): Promise<string | null> => page.evaluate(() => (window as unknown as { __gsfpv?: { status?: string } }).__gsfpv?.status ?? null);
const pausedNow = (page: Page): Promise<boolean | null> => page.evaluate(() => (window as unknown as { __gsfpv?: { session?: { paused?: boolean } } }).__gsfpv?.session?.paused ?? null);
/** The focused control: its test id, id, tag and text. */
const focusNow = (page: Page): Promise<{ testid: string | null; id: string; tag: string; text: string }> =>
    page.evaluate(() => {
        const a = document.activeElement as HTMLElement | null;
        return { testid: a?.dataset?.testid ?? null, id: a?.id ?? '', tag: a?.tagName ?? '', text: (a?.textContent ?? '').slice(0, 120) };
    });
/** Where the saved sound settings and progress are now. */
const saved = (page: Page): Promise<{ prefs: Record<string, unknown> | null; progress: Record<string, LessonProgress>; current: string | null }> =>
    page.evaluate(() => {
        const d = JSON.parse(localStorage.getItem('gsfpv.prefs.v1') ?? 'null') as { collections?: { sonic?: { prefs?: Record<string, unknown>; progress?: Record<string, LessonProgress>; current?: string | null } } } | null;
        const s = d?.collections?.sonic;
        return { prefs: s?.prefs ?? null, progress: s?.progress ?? {}, current: s?.current ?? null };
    });

/** The three switches v13-int added, as saved: the package's setting in the sound document, the two panels in the collection beside it (absent: on). */
const savedSwitches = (page: Page): Promise<{ heightDirection: unknown; soundPanel: unknown; attitude: unknown }> =>
    page.evaluate(() => {
        const d = JSON.parse(localStorage.getItem('gsfpv.prefs.v1') ?? 'null') as { collections?: { sonic?: { prefs?: Record<string, unknown>; soundPanel?: unknown; attitude?: unknown } } } | null;
        const s = d?.collections?.sonic;
        return { heightDirection: s?.prefs?.heightDirection, soundPanel: s?.soundPanel, attitude: s?.attitude };
    });

interface SpeechEvent { kind: string; key?: string; text?: string; t?: number; what?: string; lessonId?: string }
interface Probe { lesson: string | null; phase: string | null; attempt: number; panel: string; menu: { open: boolean; focused: number }; events: SpeechEvent[]; progress: Record<string, { attempts: number; successes: number; passed: boolean }> }
const probe = (page: Page): Promise<Probe | null> =>
    page.evaluate(() => {
        const h = (window as unknown as { __gsfpv?: { status?: string; sonic?: (e?: boolean) => unknown } }).__gsfpv;
        return h?.status === 'ready' && h.sonic ? (h.sonic(true) as Probe) : null;
    });

/** A key, then a short wait for the page (the voice's lines are queued at once; the DOM is drawn in the same task). */
async function key(page: Page, k: string, n = 1): Promise<void> {
    for (let i = 0; i < n; i++) {
        await page.keyboard.press(k);
        await sleep(120);
    }
}

// ------------------------------------------------------------------ A: the pause menu's item

/** The Controls screen of a first flight ("How will you fly?"): the keyboard, chosen with the keyboard. */
async function chooseKeyboard(page: Page): Promise<void> {
    await page.waitForSelector('.screen.radio [data-action="radio-keyboard"]', { timeout: 30000 });
    await page.focus('.screen.radio [data-action="radio-keyboard"]');
    await page.keyboard.press('Enter');
    await until('the Controls screen to go', () => page.evaluate(() => !document.querySelector('.screen.radio')), (v) => v, 10000);
    await sleep(800);
}

async function partA(browser: Browser, out: Record<string, unknown>): Promise<void> {
    const ctx = await profile(browser, doc({}));
    const page = await ctx.newPage();
    try {
        await page.goto(`${SITE}/en/fly/?scene=39e63ce9&nowarn=1&render=off`);
        await until('the flight', () => ready(page), (v) => v === 'ready', 120000);
        await chooseKeyboard(page);
        await page.keyboard.press('Escape');
        await page.waitForSelector('.pause-menu', { timeout: 10000 });
        const item = await page.evaluate(() => {
            const a = document.querySelector<HTMLElement>('.pause-menu [data-action="pause.flyBySound"]');
            return a ? { tag: a.tagName, href: a.getAttribute('href'), target: a.getAttribute('target'), rel: a.getAttribute('rel'), label: a.querySelector('.pm-label')?.textContent ?? '', newTab: (a.querySelector('.visually-hidden')?.textContent ?? '').trim() } : null;
        });
        out.pauseItem = item;
        check(`A: the pause menu's item is a link to the mode's start screen /en/fly/?sonic=start (not the page about the mode), in a new tab, worded "${SONIC['sonic.menu.page']}", and a screen reader hears "${MAIN['pause.newTab']}"`, !!item && item.tag === 'A' && item.href === '/en/fly/?sonic=start' && item.target === '_blank' && (item.rel ?? '').includes('noopener') && item.label === SONIC['sonic.menu.page'] && item.newTab === MAIN['pause.newTab'], item);
        if (item) {
            const [popup] = await Promise.all([ctx.waitForEvent('page', { timeout: 15000 }), page.click('.pause-menu [data-action="pause.flyBySound"]')]);
            await popup.waitForLoadState('domcontentloaded');
            await popup.waitForSelector('#sonic-start', { timeout: 60000 });
            const landed = await popup.evaluate(() => ({
                url: location.pathname + location.search,
                shown: !(document.querySelector('#sonic-start') as HTMLElement).hidden,
                h1: document.querySelector('#sonic-h1')?.textContent ?? '',
                beginning: !!document.querySelector('[data-testid="sonic-start-beginning"]'),
                lessons: document.querySelectorAll('[data-testid="sonic-lesson"]').length,
                about: document.querySelector('[data-testid="sonic-about"]')?.getAttribute('href') ?? null
            }));
            const stillPaused = await page.evaluate(() => !!document.querySelector('.pause-menu'));
            out.pausePopup = { ...landed, stillPaused };
            check('A: followed, it opens the mode\'s start screen in a new tab (its 28 lessons, the course from the beginning), the page about the mode linked from its footer; the flight stays paused under the menu', landed.url === '/en/fly/?sonic=start' && landed.shown && landed.h1 === 'Fly by Sound' && landed.beginning && landed.lessons === TOTAL && landed.about === '/en/sound/' && stillPaused, out.pausePopup);
            await shot(popup, 'a-start-screen-from-pause-item', 'the start screen the pause item opened');
            await popup.close();
        }
    } finally {
        await ctx.close();
    }
}

// ------------------------------------------------------------------ B: the start screen

async function partB(browser: Browser, out: Record<string, unknown>): Promise<void> {
    const progress = {
        'ears-headphones': P('ears-headphones', { passed: true, attempts: 1, successes: 1, blocksPassed: 1 }),
        'hover-height': P('hover-height', { attempts: 3, successes: 1, skipped: true }),
        'hover-turn': P('hover-turn', { attempts: 2, successes: 1 })
    };
    const ctx = await profile(browser, doc({ theme: 'clear', speechRate: 2 }, progress, 'hover-turn'));
    const page = await ctx.newPage();
    try {
        await page.goto(`${SITE}/en/fly/?sonic=start`);
        await page.waitForSelector('#sonic-start [data-testid="sonic-lesson"]', { timeout: 60000 });
        const screen = await page.evaluate(() => {
            const text = (sel: string): string => (document.querySelector(sel)?.textContent ?? '').replace(/\s+/g, ' ').trim();
            const group = [...document.querySelectorAll<HTMLElement>('#sonic-sec-start .sonic-actions button')].map((b) => b.dataset.testid ?? '');
            return {
                group,
                cont: text('[data-testid="sonic-start-continue"]'),
                contPrimary: document.querySelector('[data-testid="sonic-start-continue"]')?.classList.contains('primary') ?? false,
                course: text('[data-testid="sonic-start-beginning"]'),
                lessons: [...document.querySelectorAll<HTMLElement>('[data-testid="sonic-lesson"]')].map((b) => ({ id: b.dataset.lesson ?? '', state: b.dataset.state ?? '', text: (b.textContent ?? '').replace(/\s+/g, ' ').trim() })),
                modules: document.querySelectorAll('.sonic-module').length
            };
        });
        out.startScreen = { ...screen, lessons: screen.lessons.filter((l) => l.state !== 'new').concat(screen.lessons.slice(0, 2)) };
        check(`B: "Continue: ${title('hover-turn')}" comes first, the primary button, with its place and state; then "Start the course from the beginning"`, screen.group[0] === 'sonic-start-continue' && screen.group[1] === 'sonic-start-beginning' && screen.contPrimary && screen.cont.includes(`Continue: ${title('hover-turn')}`) && screen.cont.includes(`${placeOf('hover-turn')}, in progress`), { group: screen.group, cont: screen.cont });
        check('B: "Start the course from the beginning" names lesson 1 of 28 and says the progress is kept', screen.course.startsWith(SONIC['sonic.start.course'] ?? '-') && screen.course.includes(`${placeOf('ears-headphones')}: ${title('ears-headphones')}.`) && screen.course.includes(SONIC['sonic.start.courseKeeps'] ?? '-'), screen.course);
        const byId = (id: string): { state: string; text: string } | undefined => screen.lessons.find((l) => l.id === id);
        const placesOk = screen.lessons.every((l, i) => l.text.includes(fill(SONIC['sonic.progress.lesson'] ?? '', { n: i + 1, total: TOTAL })));
        check('B: the 28 lessons in the path\'s order, by module, each "Lesson N of 28"', screen.lessons.length === TOTAL && screen.lessons.map((l) => l.id).join() === lessonPaths().full.join() && screen.modules === 8 && placesOk, { count: screen.lessons.length, modules: screen.modules, placesOk });
        const states = { passed: byId('ears-headphones'), skipped: byId('hover-height'), current: byId('hover-turn'), fresh: byId('walls-hall') };
        check('B: each lesson with its state from the saved progress: passed, skipped, in progress, not started', states.passed?.state === 'passed' && !!states.passed.text.includes(', passed') && states.skipped?.state === 'skipped' && !!states.skipped.text.includes(', skipped') && states.current?.state === 'current' && !!states.current.text.includes(', in progress') && states.fresh?.state === 'new' && !!states.fresh.text.includes(', not started'), states);
        await shot(page, 'b-start-screen', 'the start screen with a saved progress');
        // Reset my progress: by the keyboard (the focus put on the button, Enter), the question first
        await page.focus('[data-testid="sonic-reset"]');
        await page.keyboard.press('Enter');
        await page.waitForSelector('[data-testid="sonic-reset-ask"]', { timeout: 5000 });
        const asked = await page.evaluate(() => ({ ask: document.querySelector('[data-testid="sonic-reset-ask"]')?.textContent ?? '', focus: (document.activeElement as HTMLElement | null)?.dataset?.testid ?? null, group: document.querySelector('[data-testid="sonic-reset-box"]')?.getAttribute('aria-labelledby') ?? null }));
        await shot(page, 'b-reset-question', 'the reset question, No focused');
        check('B: Reset asks first: the question (28 lessons, the settings stay), the focus on "No, keep my progress", the group labelled by the question', asked.ask === fill(SONIC['sonic.reset.ask'] ?? '', { total: TOTAL }) && asked.focus === 'sonic-reset-no' && asked.group === 'sonic-reset-ask', asked);
        await page.keyboard.press('Escape');
        await sleep(300);
        const kept = await saved(page);
        const afterNo = await page.evaluate(() => ({ reset: !!document.querySelector('[data-testid="sonic-reset"]'), focus: (document.activeElement as HTMLElement | null)?.dataset?.testid ?? null }));
        check('B: Escape answers No: nothing is cleared, the Reset button is back with the focus', Object.keys(kept.progress).length === 3 && kept.current === 'hover-turn' && afterNo.reset && afterNo.focus === 'sonic-reset', { progress: Object.keys(kept.progress), current: kept.current, ...afterNo });
        await page.keyboard.press('Enter');
        await page.waitForSelector('[data-testid="sonic-reset-yes"]', { timeout: 5000 });
        await page.focus('[data-testid="sonic-reset-yes"]');
        await page.keyboard.press('Enter');
        await sleep(400);
        const cleared = await saved(page);
        const after = await page.evaluate(() => ({ states: [...new Set([...document.querySelectorAll<HTMLElement>('[data-testid="sonic-lesson"]')].map((b) => b.dataset.state ?? ''))], cont: !!document.querySelector('[data-testid="sonic-start-continue"]'), focus: (document.activeElement as HTMLElement | null)?.dataset?.testid ?? null, status: document.querySelector('[data-testid="sonic-status"]')?.textContent ?? '' }));
        check('B: Yes clears every lesson and the current one, keeps the sound settings (theme Clear); every lesson new, no Continue, the focus on the course\'s first button, the status line says so', Object.keys(cleared.progress).length === 0 && cleared.current === null && cleared.prefs?.theme === 'clear' && after.states.join() === 'new' && !after.cont && after.focus === 'sonic-start-beginning' && after.status === SONIC['sonic.reset.done'], { saved: { progress: cleared.progress, current: cleared.current, theme: cleared.prefs?.theme }, ...after });
        await page.reload();
        await page.waitForSelector('#sonic-start [data-testid="sonic-lesson"]', { timeout: 60000 });
        const reloaded = await page.evaluate(() => ({ states: [...new Set([...document.querySelectorAll<HTMLElement>('[data-testid="sonic-lesson"]')].map((b) => b.dataset.state ?? ''))], cont: !!document.querySelector('[data-testid="sonic-start-continue"]') }));
        check('B: after a reload every lesson is still new and there is no Continue', reloaded.states.join() === 'new' && !reloaded.cont, reloaded);
    } finally {
        await ctx.close();
    }
}

// ------------------------------------------------------------------ C: the spoken settings list

async function partC(browser: Browser, out: Record<string, unknown>): Promise<void> {
    const ctx = await profile(browser, doc({ speechRate: 2, ...VOICE }));
    const page = await ctx.newPage();
    try {
        await page.goto(`${SITE}/en/fly/?sonic=start`);
        await page.waitForSelector('#sonic-start [data-testid="sonic-lesson"]', { timeout: 60000 });
        await until('the focus on the h1', () => focusNow(page), (f) => f.id === 'sonic-h1', 10000);
        const silent = await spoken(page);
        // the first key: the sound starts in it, the voice says how the list works, then the stop
        await key(page, 'ArrowDown');
        const first = await until('the first lines', () => spoken(page), (s) => s.length >= 2, 10000);
        check('C: nothing is said before a key; the first key says how the list works, then the first stop with its section and place', silent.length === 0 && first[0] === SONIC['sonic.say.listHelp'] && first[1] === 'Fly by Sound sections. Start. Item 1 of 4.', { before: silent, first: first.slice(0, 2) });
        // to the settings by the navigation: its fourth link, Enter: the section's heading is said (so its stops need not name it again),
        // Down goes into it
        await key(page, 'ArrowDown', 3);
        const navAt = await focusNow(page);
        let n = (await spoken(page)).length;
        await key(page, 'Enter');
        await sleep(200);
        const head = await focusNow(page);
        const headSaid = (await spoken(page)).slice(n);
        n = (await spoken(page)).length;
        for (let i = 0; i < 8; i++) await key(page, 'ArrowDown');
        const lines = (await spoken(page)).slice(n);
        const motorFocus = await focusNow(page);
        out.settingsWalk = { navAt, head, headSaid, lines };
        check('C: the navigation\'s Settings link, Enter: the section\'s heading has the focus and is said; Down through the settings, each said with "Item n of 14" (v13-int step 3: three switches more), to Motor volume', navAt.text === 'Settings' && head.id === 'sonic-h-settings' && headSaid.join(' | ') === 'Settings' && lines[0] === 'Sound theme: Soft. Item 1 of 14.' && lines.length === 8 && lines.at(-1) === 'Motor volume: 0 dB. Item 8 of 14.' && motorFocus.testid === 'sonic-motor-level', out.settingsWalk);
        n = (await spoken(page)).length;
        await key(page, 'ArrowRight');
        await key(page, 'ArrowRight');
        await key(page, 'ArrowRight');
        await key(page, 'ArrowLeft', 5);
        const values = (await spoken(page)).slice(n);
        const level = await page.evaluate(() => ({ value: (document.querySelector('[data-testid="sonic-motor-level"]') as HTMLInputElement).value, text: document.querySelector('[data-testid="sonic-motor-level"]')?.getAttribute('aria-valuetext') ?? '' }));
        // the prefs store writes the document a moment after a change (its debounce)
        const levelSaved = await until('the motor level saved', () => saved(page), (x) => x.prefs?.motorGainDb === -9, 5000).then((x) => x.prefs?.motorGainDb).catch(async () => (await saved(page)).prefs?.motorGainDb);
        out.motorLevel = { values, level, saved: levelSaved };
        check('C: Right and Left move Motor volume in 3 dB steps, each value said, the end said as the limit (6 dB), saved', values.join(' | ') === 'Motor volume: 3 dB | Motor volume: 6 dB | Motor volume: 6 dB. That is the limit. | Motor volume: 3 dB | Motor volume: 0 dB | Motor volume: -3 dB | Motor volume: -6 dB | Motor volume: -9 dB' && level.value === '-9' && level.text === '-9 dB' && levelSaved === -9, out.motorLevel);
        n = (await spoken(page)).length;
        await key(page, 'ArrowDown');
        await key(page, 'Enter');
        const target = (await spoken(page)).slice(n);
        const targetSaved = await until('the target note saved', () => saved(page), (x) => x.prefs?.heightTarget === false, 5000).then((x) => x.prefs?.heightTarget).catch(async () => (await saved(page)).prefs?.heightTarget);
        out.heightTarget = { target, saved: targetSaved };
        check('C: Down to Target height note (said), Enter turns it off (said), saved', target.join(' | ') === 'Target height note: on. Item 9 of 14. | Target height note: off' && targetSaved === false, out.heightTarget);
        await shot(page, 'c-settings', 'the settings with Motor volume at -9 dB and the target note off');
        // v13-int step 3 and 10: the three switches the integration added, by the same keys. Down to each (the stop said with its place), Enter turns
        // it off (the new value said): every line is what reached the browser's voice through the engine. Sound from above and below comes after the
        // target note (stop 10 of 14, said with its description), the sound panel and the horizon display after the frame (12 and 13).
        const DIRECTION = EN.say('menu.setting.height-direction');
        const WHAT = EN.say('menu.setting.height-direction-what').replace(/[.]$/, '');
        const PANEL = LOOK['soniclook.setting.soundPanel'] ?? '-';
        const HORIZON = LOOK['soniclook.setting.attitude'] ?? '-';
        const turn = async (downs: number): Promise<string[]> => {
            const n1 = (await spoken(page)).length;
            await key(page, 'ArrowDown', downs);
            await key(page, 'Enter');
            return (await spoken(page)).slice(n1);
        };
        const dirLines = await turn(1);
        const panelLines = await turn(2);
        const horizonLines = await turn(1);
        const offSaved = await until('the three switches saved', () => savedSwitches(page), (x) => x.heightDirection === false && x.soundPanel === false && x.attitude === false, 5000).catch(async () => savedSwitches(page));
        out.switches = { dirLines, panelLines, horizonLines, saved: offSaved };
        check('C: Down to Sound from above and below (said with its description and "Item 10 of 14"), Enter turns it off (said), saved in the sound document', dirLines.join(' | ') === `${DIRECTION}: on. ${WHAT}. Item 10 of 14. | ${DIRECTION}: off` && offSaved.heightDirection === false, { dirLines, saved: offSaved.heightDirection });
        check('C: two Downs to the sound panel switch (the frame\'s stop said on the way, then "Item 12 of 14"), Enter turns it off (said), saved beside the progress', panelLines.length === 3 && /Item 11 of 14[.]$/.test(panelLines[0] ?? '') && panelLines[1] === `${PANEL}: on. Item 12 of 14.` && panelLines[2] === `${PANEL}: off` && offSaved.soundPanel === false, { panelLines, saved: offSaved.soundPanel });
        check('C: Down to the horizon and height display ("Item 13 of 14"), Enter turns it off (said), saved beside the progress', horizonLines.join(' | ') === `${HORIZON}: on. Item 13 of 14. | ${HORIZON}: off` && offSaved.attitude === false, { horizonLines, saved: offSaved.attitude });
        // Escape: back to the first Start button, said
        n = (await spoken(page)).length;
        await key(page, 'Escape');
        const back = { focus: await focusNow(page), said: (await spoken(page)).slice(n) };
        out.escape = back;
        check('C: Escape goes back to the first Start button, said with its section', back.focus.testid === 'sonic-start-beginning' && back.said[0] === `Start. ${SONIC['sonic.start.course']}. ${placeOf('ears-headphones')}: ${title('ears-headphones')}. Item 1 of 3.`, back);
        // every line went through the engine at the theme's voice level: interrupts reached the browser's voice as cuts
        check('C: the lines cut each other (the browser\'s voice cancelled for each new stop)', (await cancels(page)) >= 10, { cancels: await cancels(page) });
        await page.reload();
        await page.waitForSelector('[data-testid="sonic-motor-level"]', { timeout: 60000 });
        const read = await page.evaluate(() => {
            const box = (id: string): boolean | null => (document.querySelector(`[data-testid="${id}"]`) as HTMLInputElement | null)?.checked ?? null;
            return { level: (document.querySelector('[data-testid="sonic-motor-level"]') as HTMLInputElement).value, target: box('sonic-height-target'), direction: box('sonic-height-direction'), soundPanel: box('sonic-look-soundPanel'), attitude: box('sonic-look-attitude') };
        });
        out.readBack = read;
        check('C: after a reload the settings read back: Motor volume -9 dB, the target note off, sound from above and below off, the sound panel and the horizon display off', read.level === '-9' && read.target === false && read.direction === false && read.soundPanel === false && read.attitude === false, read);
    } finally {
        await ctx.close();
    }
}

// ------------------------------------------------------------------ D and E: the lesson menu, the progress panel

async function partDE(browser: Browser, out: Record<string, unknown>): Promise<void> {
    const ctx = await profile(browser, doc({ speechRate: 2, ...VOICE }));
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message.slice(0, 300)));
    try {
        await page.goto(`${SITE}/en/fly/?sonic=rings-first`);
        await page.waitForSelector('[data-testid="sonic-start-asked"]', { timeout: 60000 });
        await page.focus('[data-testid="sonic-start-asked"]');
        await page.keyboard.press('Enter');
        const p0 = await until('rings-first to run', () => probe(page), (p) => p !== null && p.lesson === 'rings-first', 120000);
        await sleep(1500);
        // D: Escape opens the lesson menu; the arrows go through its eight items
        const n = (await probe(page))?.events.length ?? 0;
        const s0 = (await spoken(page)).length;
        await key(page, 'Escape');
        const opened = await until('the lesson menu', () => probe(page), (p) => p?.menu.open === true, 10000);
        const held = await pausedNow(page);
        for (let i = 0; i < 7; i++) await key(page, 'ArrowDown');
        await sleep(300);
        const p1 = (await probe(page)) as Probe;
        const lines = p1.events.slice(n).filter((e) => e.kind === 'speech' && e.key !== 'speech.end');
        const voice = (await spoken(page)).slice(s0);
        const items = ['Resume', 'Repeat the task', 'Next step', 'Previous step', 'Next lesson', 'Lesson list', 'Sound settings', 'Leave the mode'];
        const want = [SONIC['sonic.say.menuOpen'], ...items.map((x, i) => `${x}. Item ${i + 1} of 8.`)];
        out.lessonMenu = { lines: lines.map((e) => ({ key: e.key, text: e.text })), voice, focused: p1.menu.focused, held };
        await shot(page, 'd-lesson-menu', 'the lesson menu over the flight, the last item focused');
        check('D: Escape in a lesson holds the flight and opens the lesson menu; the engine was asked to say its name and how it works, then each item the arrows reach, in order, "Item n of 8" (the mode\'s speech events), and the same lines reached the browser\'s voice', opened?.menu.open === true && held === true && lines.map((e) => e.text).join(' | ') === want.join(' | ') && lines[0]?.key === 'sonic.say.menuOpen' && lines.slice(1).every((e) => e.key === 'menu.item') && want.every((w) => voice.includes(w)) && p1.menu.focused === 7, out.lessonMenu);
        await key(page, 'Escape');
        const closed = await until('the menu to close', () => probe(page), (p) => p?.menu.open === false, 5000);
        await sleep(300);
        check('D: Escape lets the flight go and the lesson goes on', closed?.menu.open === false && (await pausedNow(page)) === false && closed.lesson === 'rings-first', { lesson: closed?.lesson, paused: await pausedNow(page) });
        // E: through the ring with W held, until the first attempt is counted (the same function runs again on a dark page, E2)
        const e = await runE(page, 'light', out);
        check('D, E: no page error in the lesson', errors.length === 0, errors);
        out.lessonStart = { phase: p0?.phase, events: e.events };
    } finally {
        await ctx.close();
    }
}

/**
 * E (M41-7), on a light or a dark page: W held through the ring until the first attempt is counted, then the progress panel: rings-first's place,
 * the step, "Attempt 1" and "Counted 1 of 3" (the runner's view, the same text as the hook's), large, bold, opaque, in the left part of the page and
 * not over the view's middle, white on black on a dark page and black on white on a light one with the edge the other way (sonic.css).
 */
async function runE(page: Page, scheme: 'light' | 'dark', out: Record<string, unknown>): Promise<{ events: number }> {
    const tag = scheme === 'dark' ? 'E (dark page)' : 'E';
    const m0 = (await probe(page))?.events.length ?? 0;
    await page.keyboard.down('KeyW');
    let pe: Probe | null = null;
    try {
        pe = await until('a counted attempt', () => probe(page), (p) => p !== null && p.events.slice(m0).some((e) => e.kind === 'lesson' && e.what === 'attempt-pass'), 120000);
    } finally {
        await page.keyboard.up('KeyW');
    }
    await sleep(400);
    const pv = (await probe(page)) as Probe;
    const panel = await page.evaluate(() => {
        const el = document.querySelector<HTMLElement>('[data-testid="sonic-progress"]') ?? document.querySelector<HTMLElement>('.sonic-progress');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return { text: el.innerText, hidden: el.hidden, left: r.left, top: r.top, width: r.width, height: r.height, font: cs.fontSize, weight: cs.fontWeight, color: cs.color, background: cs.backgroundColor, edge: cs.borderTopColor, vw: innerWidth, vh: innerHeight };
    });
    const rows = (panel?.text ?? '').split('\n').map((x) => x.trim()).filter((x) => x !== '');
    out[scheme === 'dark' ? 'panelDark' : 'panel'] = { panel, hookPanel: pv.panel, attempt: pv.attempt, progress: pv.progress['rings-first'] };
    await shot(page, scheme === 'dark' ? 'e-progress-panel-dark' : 'e-progress-panel', `the progress panel after the first counted attempt of rings-first, ${scheme} page`);
    const lessonPlace = fill(SONIC['sonic.progress.lesson'] ?? '', { n: lessonPaths().full.indexOf('rings-first') + 1, total: TOTAL });
    check(`${tag}: after a counted attempt the panel shows rings-first's place (${lessonPlace}), the step (2 of 2), "Attempt 1" and "Counted 1 of 3", as the hook's text`, !!panel && !panel.hidden && rows.some((r) => r === lessonPlace) && rows.some((r) => r === fill(SONIC['sonic.progress.step'] ?? '', { n: 2, total: 2 })) && rows.some((r) => r === fill(SONIC['sonic.progress.attempt'] ?? '', { n: 1 })) && rows.some((r) => r === fill(SONIC['sonic.progress.counted'] ?? '', { n: 1, total: getLesson('rings-first').pass.required })) && pv.panel.split('\n').every((r) => rows.includes(r.trim()) || r.trim() === ''), { rows, hook: pv.panel });
    const font = parseFloat(panel?.font ?? '0');
    check(`${tag}: the panel is large (18 px or more), bold, opaque, in the left part of the page and not over the view's middle`, !!panel && font >= 18 && Number(panel.weight) >= 600 && !/rgba\([^)]*,\s*0(\.\d+)?\)/.test(panel.background) && panel.left + panel.width <= panel.vw * 0.35 && panel.left < panel.vw / 2, panel);
    const ink = scheme === 'dark' ? ['rgb(255, 255, 255)', 'rgb(0, 0, 0)', 'rgb(255, 255, 255)'] : ['rgb(0, 0, 0)', 'rgb(255, 255, 255)', 'rgb(0, 0, 0)'];
    check(`${tag}: on a ${scheme} page the panel is ${scheme === 'dark' ? 'white on black, its edge white' : 'black on white, its edge black'} (the page's scheme, not a fixed one)`, !!panel && panel.color === ink[0] && panel.background === ink[1] && panel.edge === ink[2], { color: panel?.color, background: panel?.background, edge: panel?.edge });
    return { events: (pe?.events.length ?? 0) - m0 };
}

/** The panels as the page shows them: the sound panel and the horizon display (hidden while a switch is off). */
const panelsShown = (page: Page): Promise<{ sounds: boolean; attitude: boolean }> =>
    page.evaluate(() => {
        const on = (sel: string): boolean => {
            const el = document.querySelector<HTMLElement>(sel);
            return !!el && !el.hidden && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0;
        };
        return { sounds: on('.sonic-sounds'), attitude: on('.sonic-attitude') };
    });

/**
 * C2 (v13-int steps 3 and 10): the sound panel's and the horizon display's switches at once, in a lesson that flies: both panels are on the page; the
 * lesson menu's "Sound settings" opens the settings over the flight; Enter on the sound panel's switch (reached with the focus, then the list's key)
 * takes that panel off the page, Enter again puts it back, each said and each at once (within a second); the same for the horizon display, the
 * other panel never touched; both off, the screen closed with Escape, the flight goes on without them; the page opened again later has them off.
 */
async function partC2(browser: Browser, out: Record<string, unknown>): Promise<void> {
    const ctx = await profile(browser, doc({ speechRate: 2, ...VOICE }));
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message.slice(0, 300)));
    try {
        await page.goto(`${SITE}/en/fly/?sonic=hover-height&nowarn=1`);
        await page.waitForSelector('[data-testid="sonic-start-asked"]', { timeout: 60000 });
        await page.focus('[data-testid="sonic-start-asked"]');
        await page.keyboard.press('Enter');
        await until('hover-height to run', () => probe(page), (p) => p !== null && p.lesson === 'hover-height', 120000);
        const start = await until('both panels', () => panelsShown(page), (x) => x.sounds && x.attitude, 20000).catch(async () => panelsShown(page));
        check('C2: in a lesson that flies both panels are on the page (a pilot who never set them)', start.sounds && start.attitude, start);
        // the lesson menu: Escape, six Downs to "Sound settings" (the seventh of eight items), Enter: the settings over the flight
        await key(page, 'Escape');
        await until('the lesson menu', () => probe(page), (p) => p?.menu.open === true, 10000);
        await key(page, 'ArrowDown', 6);
        await key(page, 'Enter');
        await page.waitForSelector('#sonic-start:not([hidden])', { timeout: 10000 });
        const result: Record<string, unknown> = { start };
        for (const sw of [{ id: 'sonic-look-soundPanel', panel: 'sounds', other: 'attitude', name: LOOK['soniclook.setting.soundPanel'] ?? '-' }, { id: 'sonic-look-attitude', panel: 'attitude', other: 'sounds', name: LOOK['soniclook.setting.attitude'] ?? '-' }] as const) {
            await page.focus(`[data-testid="${sw.id}"]`);
            const n1 = (await spoken(page)).length;
            await page.keyboard.press('Enter');
            const t0 = Date.now();
            const off = await until(`${sw.panel} off`, () => panelsShown(page), (x) => !x[sw.panel], 2000).then((x) => ({ ms: Date.now() - t0, shown: x })).catch(async () => ({ ms: -1, shown: await panelsShown(page) }));
            await key(page, 'Enter');
            const t1 = Date.now();
            const back = await until(`${sw.panel} on`, () => panelsShown(page), (x) => x[sw.panel], 2000).then((x) => ({ ms: Date.now() - t1, shown: x })).catch(async () => ({ ms: -1, shown: await panelsShown(page) }));
            const lines = (await spoken(page)).slice(n1);
            result[sw.panel] = { off, back, lines };
            check(`C2: Enter on "${sw.name}" takes the ${sw.panel === 'sounds' ? 'sound panel' : 'horizon display'} off the page at once (${off.ms} ms), the other one stays; Enter again puts it back (${back.ms} ms); each value said`, off.ms >= 0 && off.ms <= 1000 && !off.shown[sw.panel] && off.shown[sw.other] && back.ms >= 0 && back.ms <= 1000 && back.shown[sw.panel] && back.shown[sw.other] && lines.some((l) => l === `${sw.name}: off`) && lines.some((l) => l === `${sw.name}: on`), result[sw.panel]);
        }
        // both off, the screen closed: the flight goes on without them
        for (const id of ['sonic-look-soundPanel', 'sonic-look-attitude']) {
            await page.focus(`[data-testid="${id}"]`);
            await page.keyboard.press('Enter');
        }
        const bothOff = await until('both panels off', () => panelsShown(page), (x) => !x.sounds && !x.attitude, 2000).catch(async () => panelsShown(page));
        await shot(page, 'c2-settings-over-flight', 'the settings over the flight with both panels switched off');
        await key(page, 'Escape');
        await until('the screen to close', () => page.evaluate(() => (document.getElementById('sonic-start') as HTMLElement).hidden === true), (v) => v, 5000);
        await sleep(600);
        const after = await panelsShown(page);
        const saved = await until('both saved', () => savedSwitches(page), (x) => x.soundPanel === false && x.attitude === false, 5000).catch(async () => savedSwitches(page));
        result.bothOff = bothOff;
        result.after = after;
        result.saved = saved;
        out.switchesInLesson = result;
        check('C2: both switched off, the screen closed with Escape: the lesson goes on without either panel, both saved off', !bothOff.sounds && !bothOff.attitude && !after.sounds && !after.attitude && saved.soundPanel === false && saved.attitude === false && (await probe(page))?.lesson === 'hover-height', { bothOff, after, saved });
        // the page opened again later (the saved document): the lesson flies, neither panel on the page
        await page.goto(`${SITE}/en/fly/?sonic=hover-height&nowarn=1`);
        await page.waitForSelector('[data-testid="sonic-start-asked"]', { timeout: 60000 });
        await page.focus('[data-testid="sonic-start-asked"]');
        await page.keyboard.press('Enter');
        await until('hover-height to run again', () => probe(page), (p) => p !== null && p.lesson === 'hover-height', 120000);
        await sleep(1500);
        const again = await panelsShown(page);
        out.switchesAgain = again;
        check('C2: the lesson opened again later has neither panel on the page (read back from the saved document)', !again.sounds && !again.attitude, again);
        check('C2: no page error', errors.length === 0, errors);
    } finally {
        await ctx.close();
    }
}

/** E2 (v13-int step 10): the progress panel on a dark page, the same checks as E (white on black). */
async function partE2(browser: Browser, out: Record<string, unknown>): Promise<void> {
    const ctx = await profile(browser, doc({ speechRate: 2, ...VOICE }), 'dark');
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message.slice(0, 300)));
    try {
        await page.goto(`${SITE}/en/fly/?sonic=rings-first`);
        await page.waitForSelector('[data-testid="sonic-start-asked"]', { timeout: 60000 });
        await page.focus('[data-testid="sonic-start-asked"]');
        await page.keyboard.press('Enter');
        await until('rings-first to run', () => probe(page), (p) => p !== null && p.lesson === 'rings-first', 120000);
        await sleep(1500);
        const dark = await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches);
        check('E (dark page): the page is drawn for a dark colour scheme', dark, { dark });
        await runE(page, 'dark', out);
        check('E (dark page): no page error in the lesson', errors.length === 0, errors);
    } finally {
        await ctx.close();
    }
}

// ------------------------------------------------------------------ F: the replay in a page (v13-int step 11: W9 and W10 were held in Node only)

interface ReplayState { stage: string; check: { ok: boolean; summary: string; verdict?: string } | null; notes: string[]; details: string; player: { phase: string; tMs: number; durationMs: number; lesson: string | null } | null }
const replayState = (page: Page): Promise<ReplayState | null> => page.evaluate(() => ((window as unknown as { __gsfpv: { sonicReplay?: () => { state: unknown } } }).__gsfpv.sonicReplay?.()?.state ?? null)) as Promise<ReplayState | null>;
const REC = JSON.parse(readFileSync(join(REPO, 'packages', 'i18n', 'locales', 'fly', 'sonicrec', 'en.json'), 'utf8')) as Record<string, string>;
const statusText = (page: Page): Promise<{ text: string; bad: boolean }> => page.evaluate(() => { const el = document.querySelector('.sonicrec-replay-status'); return { text: (el?.textContent ?? '').trim(), bad: el?.classList.contains('bad') ?? false }; });

/** A lesson that flies, opened by Enter on the start screen's button, its task skipped with N until the attempt flies (the replay needs the mode running). */
async function openFlying(page: Page, lesson: string): Promise<void> {
    await page.goto(`${SITE}/en/fly/?sonic=${lesson}&nowarn=1`);
    await page.waitForSelector('[data-testid="sonic-start-asked"]', { timeout: 60000 });
    await page.focus('[data-testid="sonic-start-asked"]');
    await page.keyboard.press('Enter');
    await until(`${lesson} to run`, () => probe(page), (p) => p !== null && p.lesson === lesson, 120000);
    for (const t0 = Date.now(); Date.now() - t0 < 60000;) {
        const p = await probe(page);
        if (p?.phase === 'flying') break;
        if (p?.phase === 'intro') await page.keyboard.press('KeyN');
        await sleep(400);
    }
}

/** The recorder's panel opened (its toggle button): the replay's button and the sessions are in it. */
async function openRecPanel(page: Page): Promise<void> {
    await until('the recordings panel', () => page.evaluate(() => !!document.querySelector('.sonicrec-toggle')), (v) => v, 20000);
    await page.evaluate(() => { const b = document.querySelector('.sonicrec-toggle') as HTMLElement; if (document.querySelector('.sonicrec-panel')?.hasAttribute('hidden')) b.click(); });
}

/**
 * F1 (W9, W10): the package's v0.12 recording of rings-first (the fixture, a flight of 21.9 s with 7 spoken lines) opened as a file in the page's
 * replay: the summary is the older-build sentence (not a FAIL, not marked as one); played, the engine is asked for the older-build line first and then
 * every recorded line in order, each not before its time on the package clock (the 5 of the lesson's start at 0.5 s, "Go." at 14.4 s, "Attempt 2." at
 * 19.9 s), what reached the browser's voice; a seek to 10 s passes the lines before it: played on, only "Go." and "Attempt 2." follow.
 */
async function partF1(browser: Browser, out: Record<string, unknown>): Promise<void> {
    const ctx = await profile(browser, doc({ speechRate: 2, ...VOICE }));
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message.slice(0, 300)));
    try {
        await openFlying(page, 'hover-height');
        await openRecPanel(page);
        await page.waitForSelector('[data-action="replay-open"]', { timeout: 10000 });
        const file = join(REPO, 'packages', 'sonic-fpv', 'test', 'fixtures', 'session-v012-rings-first.zip');
        const pkg = readPackage(new Uint8Array(readFileSync(file)));
        const recorded = pkg.events.filter((e) => e.kind === 'speech' && (e as { key?: string }).key !== 'speech.end') as unknown as { t: number; key: string; text: string }[];
        const older = fill(SONIC['sonic.say.replayOlder'] ?? '', { recorded: 1, here: getLesson('rings-first').version });
        await page.setInputFiles('[data-testid="replay-file"]', file);
        const ready = await until('the replay checked', () => replayState(page), (r) => r?.stage === 'ready' || r?.stage === 'error', 60000);
        const status = await statusText(page);
        out.olderSummary = { status, check: ready?.check, notes: ready?.notes, details: ready?.details?.slice(0, 300), player: ready?.player };
        check('F1: the v0.12 recording of rings-first (the package\'s fixture) opened in the page: the summary is the older-build sentence (sonicrec.replay.check.older), the verdict "older-build", not marked as a failure', ready?.stage === 'ready' && status.text === REC['sonicrec.replay.check.older'] && ready.check?.verdict === 'older-build' && !status.bad, out.olderSummary);
        check('F1: the player is ready on rings-first, a flight of about 22 s (the recording\'s last frame)', ready?.player?.lesson === 'rings-first' && Math.abs((ready.player?.durationMs ?? 0) - (pkg.frames.at(-1)?.t ?? 0)) < 1500, { player: ready?.player, last: pkg.frames.at(-1)?.t });
        // play it from the start: the lines the engine was asked for reached the browser's voice, in order, at their times
        const want = [older, ...recorded.map((r) => r.text)];
        const n0 = (await spokenAt(page)).length;
        await page.focus('[data-action="replay-toggle"]');
        await page.keyboard.press('Enter');
        const tPlay = await page.evaluate(() => performance.now());
        await until('the replay to end', () => replayState(page), (r) => r?.player?.phase === 'ended', 90000);
        await sleep(500);
        const all = (await spokenAt(page)).slice(n0);
        const mine = all.filter((l) => want.includes(l.text));
        const lag = mine.slice(1).map((l, i) => Math.round((l.at - tPlay) - (recorded[i]?.t ?? 0)));
        out.olderPlay = { lines: all.map((l) => l.text), want, lagMs: lag, foreign: all.length - mine.length };
        check('F1: played from the start, the browser\'s voice was given the older-build line first, then each of the 7 recorded lines, in the recording\'s order', mine.map((l) => l.text).join(' | ') === want.join(' | '), { got: mine.map((l) => l.text), foreign: all.length - mine.length });
        check('F1: no recorded line reached the voice before its time on the package clock (its lag on the page\'s clock is at least -150 ms) and none more than 2 s late', lag.length === recorded.length && Math.min(...lag) >= -150 && Math.max(...lag) <= 2000, { lagMs: lag, times: recorded.map((r) => r.t) });
        // a seek: to 10 s, the lines before it are passed; played on, only the later ones follow
        await page.evaluate(() => { const sl = document.getElementById('sonicrec-replay-pos') as HTMLInputElement; sl.value = '10000'; sl.dispatchEvent(new Event('input', { bubbles: true })); });
        await sleep(400);
        const sought = await replayState(page);
        const n1 = (await spokenAt(page)).length;
        await page.focus('[data-action="replay-toggle"]');
        await page.keyboard.press('Enter');
        await until('the replay to end again', () => replayState(page), (r) => r?.player?.phase === 'ended', 90000);
        await sleep(500);
        const later = (await spokenAt(page)).slice(n1).map((l) => l.text).filter((x) => want.includes(x) && x !== older);
        out.seek = { toMs: sought?.player?.tMs, later };
        check('F1: a seek to 10 s: the position is 10 s, the lines before it are passed, played on only "Go." and "Attempt 2." follow (none of the five of the lesson\'s start again)', Math.abs((sought?.player?.tMs ?? 0) - 10000) < 300 && later.join(' | ') === recorded.filter((r) => r.t > 10000).map((r) => r.text).join(' | ') && later.length === 2, out.seek);
        await page.focus('[data-action="replay-close"]');
        await page.keyboard.press('Enter');
        check('F1: no page error', errors.length === 0, errors);
    } finally {
        await ctx.close();
    }
}

/**
 * F2 (W10): a recording made on this build (rings-first: T, T starts it, N, W through the ring to a counted attempt, T stops, the survey declined with
 * 2) opened by the recorder's own Replay button: the summary is the pass sentence (every recorded event worked out again), the verdict "pass", not
 * marked as a failure; played to its end.
 */
async function partF2(browser: Browser, out: Record<string, unknown>, straight = false): Promise<void> {
    // F2S (v13-int review K1): the same recording flown straight at the wall, W alone; its checks are named F2S
    const F = straight ? 'F2S' : 'F2';
    const ctx = await profile(browser, doc({ speechRate: 2, ...VOICE }));
    // Save is a download here, not the file picker (nothing could answer it)
    await ctx.addInitScript({ content: 'try { delete window.showSaveFilePicker; } catch (e) {}' });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message.slice(0, 300)));
    try {
        await page.goto(`${SITE}/en/fly/?sonic=rings-first&nowarn=1`);
        await page.waitForSelector('[data-testid="sonic-start-asked"]', { timeout: 60000 });
        await page.focus('[data-testid="sonic-start-asked"]');
        await page.keyboard.press('Enter');
        await until('rings-first to run', () => probe(page), (p) => p !== null && p.lesson === 'rings-first', 120000);
        await until('the recordings panel', () => page.evaluate(() => !!document.querySelector('.sonicrec-toggle')), (v) => v, 20000);
        await sleep(1500);
        const recOn = (): Promise<boolean> => page.evaluate(() => document.querySelector('.sonicrec-toggle')?.classList.contains('recording') === true);
        const heard = async (key: string, since: number): Promise<boolean> => ((await probe(page))?.events.slice(since) ?? []).some((e) => e.kind === 'speech' && e.key === key);
        const n0 = (await probe(page))?.events.length ?? 0;
        await page.keyboard.press('KeyT');
        await until('the question', () => heard('rec.ask', n0), (v) => v, 15000);
        for (const t0 = Date.now(); !(await recOn()) && Date.now() - t0 < 45000;) {
            await sleep(2500);
            if ((await recOn()) || (await heard('rec.started', n0))) break;
            await page.keyboard.press('KeyT');
        }
        await until('the recording', () => recOn(), (v) => v, 20000);
        // the recording starts the lesson again from its beginning: the task is skipped, W held through the ring until the first attempt is counted
        const m0 = (await probe(page))?.events.length ?? 0;
        for (const t0 = Date.now(); Date.now() - t0 < 30000;) {
            const p = await probe(page);
            if (p?.phase === 'flying') break;
            if (p?.phase === 'intro') await page.keyboard.press('KeyN');
            await sleep(400);
        }
        // F2: a small turn to the right first. F2S (v13-int review K1): none, W alone dead ahead at the front wall, a left-right tie for the wall's
        // sectors, which before the sound package's mirror tie (s13-int c819995) the live engine and the replay's planner broke the other way round
        // (evidence/2026-11-09/sonic-v13-page-f2-straight-before.json: 83.7 % of the sounds, 100 % by kind, FAIL)
        if (!straight) {
            await page.keyboard.down('KeyE');
            await sleep(300);
            await page.keyboard.up('KeyE');
        }
        await page.keyboard.down('KeyW');
        try {
            await until('a counted attempt', () => probe(page), (p) => p !== null && p.events.slice(m0).some((e) => e.kind === 'lesson' && e.what === 'attempt-pass'), 120000);
        } finally {
            await page.keyboard.up('KeyW');
        }
        await sleep(500);
        await page.keyboard.press('KeyT');
        const k0 = (await probe(page))?.events.length ?? 0;
        await until('the survey offer', () => heard('survey.offer', 0), (v) => v, 20000);
        await sleep(1500);
        await page.keyboard.press('Digit2');
        await until('the recording saved', () => page.evaluate(() => document.querySelectorAll('.sonicrec-session').length), (n) => n >= 1, 30000);
        await until('the recorder idle', () => recOn(), (v) => !v, 30000);
        await sleep(1000);
        void k0;
        await openRecPanel(page);
        await until('the replay button', () => page.evaluate(() => !!document.querySelector('.sonicrec-session [data-action="replay"]')), (v) => v, 20000);
        // the saved package (a voice in it: never committed, it goes to the screenshots' folder outside the repository), for a look at the check in Node
        const download = page.waitForEvent('download', { timeout: 30000 });
        await page.focus('.sonicrec-session [data-action="save"]');
        await page.keyboard.press('Enter');
        const zip = join(SHOTS, 'f2-recording.zip');
        await (await download).saveAs(zip);
        out.ownZip = zip;
        await page.focus('.sonicrec-session [data-action="replay"]');
        await page.keyboard.press('Enter');
        const ready = await until('the replay checked', () => replayState(page), (r) => r?.stage === 'ready' || r?.stage === 'error', 60000);
        const status = await statusText(page);
        const m = /^The replay agrees with the recording: (\d+) of (\d+) events were worked out again, and (\d+) % of the sounds are the same\.$/.exec(status.text);
        const rows = await page.evaluate(() => ((window as unknown as { __gsfpv: { sonicReplay?: () => { checks: unknown } } }).__gsfpv.sonicReplay?.()?.checks ?? null));
        out.ownSummary = { status, check: ready?.check, player: ready?.player, details: ready?.details, notes: ready?.notes, rows };
        check(`${F}: a recording made on this build (rings-first${straight ? ', W alone dead ahead at the front wall' : ''}, a counted attempt) opened by the recorder's Replay button: the summary is the pass sentence, every recorded event worked out again, the verdict "pass", not marked as a failure`, ready?.stage === 'ready' && !!m && m[1] === m[2] && Number(m[2]) > 0 && ready.check?.verdict === 'pass' && ready.check.ok === true && !status.bad, out.ownSummary);
        await page.focus('[data-action="replay-toggle"]');
        await page.keyboard.press('Enter');
        const end = await until('the replay to end', () => replayState(page), (r) => r?.player?.phase === 'ended', 120000);
        out.ownPlay = { phase: end?.player?.phase, durationMs: end?.player?.durationMs };
        check(`${F}: played to its end`, end?.player?.phase === 'ended' && (end.player.durationMs ?? 0) > 5000, out.ownPlay);
        await page.focus('[data-action="replay-close"]');
        await page.keyboard.press('Enter');
        check(`${F}: no page error`, errors.length === 0, errors);
    } finally {
        await ctx.close();
    }
}

// ------------------------------------------------------------------ G: Reset my progress over a running lesson (v13-int step 5)

/**
 * G (v13-int step 5; the two lines in feature.ts that tell the lesson are held by no Node test): rings-first flown to one counted attempt (the panel says
 * "Counted 1 of 3", the progress is saved); the lesson menu's "Lesson list" opens the start screen over the flight; Reset my progress, Yes: the saved
 * progress is gone; Escape closes the screen and the lesson starts again from its beginning (its title said again, the panel at the task with nothing
 * counted); flown through the ring once more the attempt is saved as the first (successes 1, not the old count + 1).
 */
async function partG(browser: Browser, out: Record<string, unknown>): Promise<void> {
    const ctx = await profile(browser, doc({ speechRate: 2, ...VOICE }));
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message.slice(0, 300)));
    const through = async (): Promise<Probe> => {
        const m0 = (await probe(page))?.events.length ?? 0;
        await page.keyboard.down('KeyW');
        try {
            return (await until('a counted attempt', () => probe(page), (p) => p !== null && p.events.slice(m0).some((e) => e.kind === 'lesson' && e.what === 'attempt-pass'), 120000)) as Probe;
        } finally {
            await page.keyboard.up('KeyW');
        }
    };
    try {
        await openFlying(page, 'rings-first');
        const one = await through();
        await sleep(600);
        const before = await saved(page);
        const panelBefore = ((await probe(page)) as Probe).panel;
        out.resetBefore = { successes: before.progress['rings-first']?.successes, attempts: before.progress['rings-first']?.attempts, panel: panelBefore };
        check('G: rings-first flown to one counted attempt: the progress panel says "Counted 1 of 3" and the saved progress has the success', (before.progress['rings-first']?.successes ?? 0) === 1 && panelBefore.includes(fill(SONIC['sonic.progress.counted'] ?? '', { n: 1, total: getLesson('rings-first').pass.required })), out.resetBefore);
        void one;
        // the lesson menu: Escape, five Downs to "Lesson list" (the sixth of eight items), Enter: the start screen over the flight
        await key(page, 'Escape');
        await until('the lesson menu', () => probe(page), (p) => p?.menu.open === true, 10000);
        await key(page, 'ArrowDown', 5);
        await key(page, 'Enter');
        await page.waitForSelector('#sonic-start:not([hidden])', { timeout: 10000 });
        await page.focus('[data-testid="sonic-reset"]');
        await page.keyboard.press('Enter');
        await page.waitForSelector('[data-testid="sonic-reset-yes"]', { timeout: 5000 });
        await page.focus('[data-testid="sonic-reset-yes"]');
        await page.keyboard.press('Enter');
        const cleared = await until('the progress cleared', () => saved(page), (x) => Object.keys(x.progress).length === 0, 5000).catch(async () => saved(page));
        check('G: Reset my progress, Yes, over the running lesson: the saved progress is gone', Object.keys(cleared.progress).length === 0, { progress: Object.keys(cleared.progress) });
        // Escape closes the screen: the lesson that ran under it starts again from its beginning, new
        const n1 = ((await probe(page)) as Probe).events.length;
        await key(page, 'Escape');
        await until('the screen to close', () => page.evaluate(() => (document.getElementById('sonic-start') as HTMLElement).hidden === true), (v) => v, 5000);
        const again = await until('the lesson to start again', () => probe(page), (p) => p !== null && p.events.slice(n1).some((e) => e.kind === 'speech' && e.key === 'lesson.rings-first.title'), 15000).catch(async () => probe(page));
        await sleep(600);
        const panelAgain = ((await probe(page)) as Probe).panel;
        const afterReset = await saved(page);
        out.resetAfter = { titleSaid: !!again?.events.slice(n1).some((e) => e.kind === 'speech' && e.key === 'lesson.rings-first.title'), lesson: again?.lesson, phase: again?.phase, panel: panelAgain, progress: Object.keys(afterReset.progress) };
        check('G: Escape closes the screen and the lesson starts again from its beginning: its title is said again, the progress panel is at the task with nothing counted, nothing saved yet', !!again && again.lesson === 'rings-first' && (out.resetAfter as { titleSaid: boolean }).titleSaid && panelAgain.includes(fill(SONIC['sonic.progress.counted'] ?? '', { n: 0, total: getLesson('rings-first').pass.required })) && panelAgain.includes(fill(SONIC['sonic.progress.step'] ?? '', { n: 1, total: 2 })) && Object.keys(afterReset.progress).length === 0, out.resetAfter);
        // the task skipped, W through the ring: the attempt is saved as the first
        for (const t0 = Date.now(); Date.now() - t0 < 30000;) {
            const p = await probe(page);
            if (p?.phase === 'flying') break;
            if (p?.phase === 'intro') await page.keyboard.press('KeyN');
            await sleep(400);
        }
        await through();
        await sleep(800);
        const second = await saved(page);
        const panelSecond = ((await probe(page)) as Probe).panel;
        out.resetSecond = { successes: second.progress['rings-first']?.successes, attempts: second.progress['rings-first']?.attempts, panel: panelSecond };
        check('G: flown through the ring once more, the attempt is saved as the first (successes 1, not the old count and one), the panel says "Counted 1 of 3"', second.progress['rings-first']?.successes === 1 && panelSecond.includes(fill(SONIC['sonic.progress.counted'] ?? '', { n: 1, total: getLesson('rings-first').pass.required })), out.resetSecond);
        check('G: no page error', errors.length === 0, errors);
    } finally {
        await ctx.close();
    }
}

// ------------------------------------------------------------------ R: the v13-int review's fixes in the page

/** Every utterance handed to the browser's voice: its start, its end or its error (interrupted, cancelled), on the page's clock. */
const utterances = (page: Page): Promise<{ text: string; kind: string; at: number; error: string | null }[]> =>
    page.evaluate(() => [...((window as unknown as { __utter?: { text: string; kind: string; at: number; error: string | null }[] }).__utter ?? [])]);
const nowMs = (page: Page): Promise<number> => page.evaluate(() => performance.now());
const lessonLine = (id: string, part: string): string => EN.text({ key: `lesson.${id}.${part}` });

/** R F1: the lesson menu early in hover-height: the task's lines it cut are said again whole after it; the menu's own lines stop at the close. */
async function partR1(browser: Browser, out: Record<string, unknown>): Promise<void> {
    const ctx = await profile(browser, doc({ ...VOICE }));
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message.slice(0, 300)));
    try {
        await page.goto(`${SITE}/en/fly/?sonic=hover-height&nowarn=1`);
        await page.waitForSelector('[data-testid="sonic-start-asked"]', { timeout: 60000 });
        await page.focus('[data-testid="sonic-start-asked"]');
        await page.keyboard.press('Enter');
        await until('hover-height to run', () => probe(page), (p) => p !== null && p.lesson === 'hover-height', 120000);
        // the keys line handed (right after the title), then Escape 1.2 s later and Escape again 0.3 s after it, as the reviewer's P3
        await until('the keys line', () => probe(page), (p) => !!p && p.events.some((e) => e.kind === 'speech' && e.key === 'sonic.say.lessonKeys'), 20000);
        await sleep(1200);
        await page.keyboard.press('Escape');
        await until('the lesson menu', () => probe(page), (p) => p?.menu.open === true, 5000);
        await sleep(300);
        await page.keyboard.press('Escape');
        const closed = await nowMs(page);
        await until('the first attempt', () => probe(page), (p) => p?.phase === 'flying', 180000);
        await sleep(500);
        const u = await utterances(page);
        const whole = (text: string): { start: number; end: number } | null => {
            for (const s of u.filter((x) => x.text === text && x.kind === 'start' && x.at >= closed)) {
                const e = u.find((x) => x.text === text && x.at >= s.at && (x.kind === 'end' || x.kind === 'error'));
                if (e && e.kind === 'end') return { start: s.at - closed, end: e.at - closed };
            }
            return null;
        };
        const lines = { intro1: whole(lessonLine('hover-height', 'intro.1')), intro2: whole(lessonLine('hover-height', 'intro.2')), intro3: whole(lessonLine('hover-height', 'intro.3')) };
        const menuTexts = new Set([SONIC['sonic.say.menuOpen'] ?? '', fill(EN.say('menu.item', { label: SONIC['sonic.say.menuResume'] ?? '', n: 1, total: 8 }), {})]);
        const menuAfter = u.filter((x) => menuTexts.has(x.text) && x.kind === 'end' && x.at > closed + 1000).length;
        out.reviewF1 = { closedAtMs: Math.round(closed), lines, menuEndsAfterClose: menuAfter, utterances: u.length };
        check('R F1: hover-height, Escape 1.2 s after the keys line and again 0.3 s later: intro.1 and intro.2 start and end whole (no error) after the menu closed, in order, before intro.3 (before the fix they were never handed again)', !!lines.intro1 && !!lines.intro2 && !!lines.intro3 && lines.intro1.end <= lines.intro2.start + 50 && lines.intro2.end <= lines.intro3.start + 50, out.reviewF1);
        check('R F1: the menu\'s own lines stop at the close: none of them ends later than 1 s after it (before: they spoke on for 10 s)', menuAfter === 0, out.reviewF1);
        check('R F1: no page error', errors.length === 0, errors);
    } finally {
        await ctx.close();
    }
}

/** R F2, F4: the start screen over rings-first: the lesson's keys move nothing under it; closed, the focus is on the flight's region. */
async function partR2(browser: Browser, out: Record<string, unknown>): Promise<void> {
    const ctx = await profile(browser, doc({ speechRate: 2, ...VOICE }));
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message.slice(0, 300)));
    try {
        await openFlying(page, 'rings-first');
        await sleep(800);
        // the lesson menu's Sound settings (the seventh item): the start screen over the flight
        await key(page, 'Escape');
        await until('the lesson menu', () => probe(page), (p) => p?.menu.open === true, 5000);
        await key(page, 'ArrowDown', 6);
        await key(page, 'Enter');
        await page.waitForSelector('#sonic-start:not([hidden])', { timeout: 10000 });
        await sleep(600);
        const before = (await probe(page)) as Probe;
        const n0 = before.events.length;
        for (const k of ['KeyB', 'KeyN', 'KeyZ', 'KeyG', 'KeyR', 'KeyB']) await key(page, k);
        await sleep(800);
        const after = (await probe(page)) as Probe;
        const moved = after.events.slice(n0).filter((e) => e.kind === 'key' || e.kind === 'lesson').map((e) => `${e.kind} ${e.what ?? ''}`);
        out.reviewF2 = { lesson: after.lesson, phase: after.phase, moved, screen: await page.evaluate(() => !(document.getElementById('sonic-start') as HTMLElement).hidden) };
        check('R F2: the start screen over rings-first (the lesson menu\'s Sound settings): B, N, Z, G, R and B again write no key and no lesson event; the lesson is still rings-first, the screen still up (before the fix two B opened tunnel-long under it)', moved.length === 0 && after.lesson === 'rings-first' && (out.reviewF2 as { screen: boolean }).screen, out.reviewF2);
        await key(page, 'Escape');
        await until('the screen to close', () => page.evaluate(() => (document.getElementById('sonic-start') as HTMLElement).hidden === true), (v) => v, 5000);
        await sleep(400);
        const focus = await focusNow(page);
        out.reviewF4 = focus;
        check('R F4: Escape closes the screen and the focus is on the flight\'s region (data-testid sonic-flight, role application), not the body', focus.testid === 'sonic-flight', focus);
        // control: with the screen gone, B is the lesson's again
        const n1 = ((await probe(page)) as Probe).events.length;
        await key(page, 'KeyB');
        await sleep(600);
        const ctl = ((await probe(page)) as Probe).events.slice(n1).filter((e) => e.kind === 'key').map((e) => (e as { action?: string }).action);
        out.reviewF2Control = ctl;
        check('R F2 control: the screen closed, B moves the lesson (its key event "previous")', ctl.includes('previous'), ctl);
        check('R F2: no page error', errors.length === 0, errors);
    } finally {
        await ctx.close();
    }
}

/** R F3: B at the first step of the path's first lesson: the start screen; Escape: the lesson opens again and N moves it. */
async function partR3(browser: Browser, out: Record<string, unknown>): Promise<void> {
    const ctx = await profile(browser, doc({ speechRate: 2, ...VOICE }));
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message.slice(0, 300)));
    try {
        const first = lessonPaths().full[0] as string;
        await page.goto(`${SITE}/en/fly/?sonic=${first}&nowarn=1`);
        await page.waitForSelector('[data-testid="sonic-start-asked"]', { timeout: 60000 });
        await page.focus('[data-testid="sonic-start-asked"]');
        await page.keyboard.press('Enter');
        await until(`${first} to run`, () => probe(page), (p) => p !== null && p.lesson === first, 120000);
        await sleep(1500);
        await key(page, 'KeyB');
        await page.waitForSelector('#sonic-start:not([hidden])', { timeout: 10000 });
        await sleep(500);
        await key(page, 'Escape');
        await until('the screen to close', () => page.evaluate(() => (document.getElementById('sonic-start') as HTMLElement).hidden === true), (v) => v, 5000);
        const opened = await until('the lesson to open again', () => probe(page), (p) => !!p && p.events.filter((e) => e.kind === 'lesson' && e.what === 'open').length >= 2, 15000).catch(async () => probe(page));
        const opens = (opened?.events ?? []).filter((e) => e.kind === 'lesson' && e.what === 'open').map((e) => e.lessonId);
        await sleep(800);
        const n = ((await probe(page)) as Probe).events.length;
        await key(page, 'KeyN');
        await sleep(1500);
        const p = (await probe(page)) as Probe;
        const after = p.events.slice(n);
        out.reviewF3 = { opens, lesson: p.lesson, phase: p.phase, panel: p.panel, afterN: after.map((e) => `${e.kind} ${e.what ?? (e as { action?: string }).action ?? e.key ?? ''}`).slice(0, 12) };
        check(`R F3: B 1.5 s into ${first} (lesson 1 of the path): the start screen; Escape: the lesson opens again from its beginning (a second "lesson open"), and N moves it (its key event and a lesson or speech event after it; before the fix nothing followed the key)`, opens.length === 2 && opens.every((x) => x === first) && after.some((e) => e.kind === 'key' && (e as { action?: string }).action === 'next') && after.some((e) => e.kind === 'lesson' || (e.kind === 'speech' && e.key !== 'speech.end')), out.reviewF3);
        check('R F3: no page error', errors.length === 0, errors);
    } finally {
        await ctx.close();
    }
}

/** R F5: a recording played over hover-height: the progress panel hidden while it plays, back when the replay is closed. */
async function partR5(browser: Browser, out: Record<string, unknown>): Promise<void> {
    const ctx = await profile(browser, doc({ speechRate: 2, ...VOICE }));
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message.slice(0, 300)));
    try {
        await openFlying(page, 'hover-height');
        await sleep(600);
        const live = ((await probe(page)) as Probe).panel;
        await openRecPanel(page);
        await page.waitForSelector('[data-action="replay-open"]', { timeout: 10000 });
        await page.setInputFiles('[data-testid="replay-file"]', join(REPO, 'packages', 'sonic-fpv', 'test', 'fixtures', 'session-v012-rings-first.zip'));
        await until('the replay checked', () => replayState(page), (r) => r?.stage === 'ready' || r?.stage === 'error', 60000);
        await page.focus('[data-action="replay-toggle"]');
        await page.keyboard.press('Enter');
        await until('the replay to play', () => replayState(page), (r) => r?.player?.phase === 'playing', 20000);
        await sleep(3000);
        const during = await page.evaluate(() => { const el = document.querySelector('.sonic-progress') as HTMLElement | null; return { hidden: !el || el.hidden, text: (el?.innerText ?? '').replace(/\s+/g, ' ').trim() }; });
        const panelDuring = ((await probe(page)) as Probe).panel;
        await page.focus('[data-action="replay-close"]');
        await page.keyboard.press('Enter');
        await sleep(1500);
        const back = ((await probe(page)) as Probe).panel;
        out.reviewF5 = { live, during, panelDuring, back };
        check('R F5: hover-height\'s progress panel is on the page; while the recording of rings-first plays it is hidden (nothing of the live lesson over the replay); after the replay it is back', live.includes(title('hover-height')) && during.hidden && panelDuring === '' && back.includes(title('hover-height')), out.reviewF5);
        check('R F5: no page error', errors.length === 0, errors);
    } finally {
        await ctx.close();
    }
}

/** R F7: on a phone (touch), the pause menu's Lesson menu opens the lesson menu, and its Next step moves the lesson. */
async function partR7(browser: Browser, out: Record<string, unknown>): Promise<void> {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    await ctx.addInitScript({ content: initScript(doc({ speechRate: 2, ...VOICE })) });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message.slice(0, 300)));
    try {
        await page.goto(`${SITE}/en/fly/?sonic=rings-first&nowarn=1&input=touch`);
        await page.waitForSelector('[data-testid="sonic-start-asked"]', { timeout: 60000 });
        await page.tap('[data-testid="sonic-start-asked"]');
        await until('rings-first to run', () => probe(page), (p) => p !== null && p.lesson === 'rings-first', 120000);
        await sleep(1500);
        await page.tap('[data-action="pause"]');
        await page.waitForSelector('.pause-menu [data-action="pause.sonic.lessonMenu"]', { timeout: 10000 });
        const item = await page.evaluate(() => { const b = document.querySelector('.pause-menu [data-action="pause.sonic.lessonMenu"]') as HTMLElement | null; return b ? { text: (b.textContent ?? '').trim(), disabled: b.hasAttribute('disabled') || b.getAttribute('aria-disabled') === 'true' } : null; });
        await page.tap('.pause-menu [data-action="pause.sonic.lessonMenu"]');
        await until('the lesson menu', () => probe(page), (p) => p?.menu.open === true, 5000);
        const n = ((await probe(page)) as Probe).events.length;
        await page.tap('.sonic-menu-item[data-item="next-step"]');
        await sleep(1200);
        const p = (await probe(page)) as Probe;
        const keys = p.events.slice(n).filter((e) => e.kind === 'key').map((e) => (e as { action?: string }).action);
        out.reviewF7 = { item, menuOpen: p.menu.open, keys, paused: await pausedNow(page) };
        check('R F7: a phone upright with touch sticks: the top bar\'s Pause opens the pause menu with "Lesson menu", which opens the lesson menu; its Next step, tapped, moves the lesson (the key event "next"), and the flight goes on', !!item && !item.disabled && item.text.includes(SONIC['sonic.say.menuTitle'] ?? 'Lesson menu') && keys.includes('next') && !p.menu.open && (out.reviewF7 as { paused: boolean | null }).paused === false, out.reviewF7);
        check('R F7: no page error', errors.length === 0, errors);
    } finally {
        await ctx.close();
    }
}

async function partR(browser: Browser, out: Record<string, unknown>): Promise<void> {
    for (const run of [partR1, partR2, partR3, partR5, partR7]) {
        try {
            await run(browser, out);
        } catch (e) {
            check(`R: ${run.name} reached its end`, false, String(e).slice(0, 400));
        }
    }
}

async function main(): Promise<void> {
    await takeLock();
    locked = true;
    const out: Record<string, unknown> = {};
    // the build served: its commit and the sound package's (dist/release.json)
    out.release = await fetch(`${SITE}/release.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    let browser: Browser | null = null;
    try {
        ({ browser } = await launchChrome({ args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] }));
        const parts: [string, (b: Browser, o: Record<string, unknown>) => Promise<void>][] = [['A', partA], ['B', partB], ['C', partC], ['C2', partC2], ['DE', partDE], ['E2', partE2], ['F1', partF1], ['F2', partF2], ['G', partG], ['R', partR], ['F2S', (b, o) => partF2(b, o, true)]];
        const only = process.env.PARTS;
        for (const [name, run] of parts) {
            if (only && !only.split(',').includes(name)) continue;
            try {
                await run(browser, out);
            } catch (e) {
                check(`${name}: the part reached its end`, false, String(e).slice(0, 400));
            }
        }
    } finally {
        await browser?.close().catch(() => undefined);
        letGo();
    }
    const passed = checks.filter((c) => c.pass).length;
    const file = writeEvidence('sonic-v13-page', { site: SITE, parts: process.env.PARTS ?? 'A,B,C,C2,DE,E2,F1,F2,G,R,F2S', control: CONTROL ? 'reader' : null, checks, passed, total: checks.length, shots, result: out });
    writeFileSync(join(SHOTS, 'evidence-path.txt'), file);
    console.log(`${passed} of ${checks.length} checks passed; ${file}`);
    process.exitCode = passed === checks.length && checks.length > 0 ? 0 : 1;
}

main().catch((e) => {
    letGo();
    console.error(e);
    process.exit(2);
});
