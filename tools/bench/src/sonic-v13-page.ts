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
//   node scripts/build-release.mjs
//   node tools/bench/scripts/serve-csp.mjs dist <port>                       (another shell)
//   cd tools/bench && SITE=http://localhost:<port> npx tsx src/sonic-v13-page.ts
// Holds C:/dev/.gpu-lock: one blocking loop (mkdir, else 20 s, at most 9 minutes), let go at the end, also on an error. Evidence:
// evidence/<date>/sonic-v13-page.json (the commit of the tree it ran on in its context; exit 1 when a check fails). The screenshots stay
// out of the repository (SHOTS, default the system's temp folder): their paths and SHA-256 are in the evidence.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser, BrowserContext, Page } from 'playwright';
import { SCHEMA_VERSION } from '../../../packages/prefs/src';
import { DICTS, SHIPPED_LESSON_IDS, createTranslator, defaultPrefs, getLesson, lessonPaths } from '../../../packages/sonic-fpv/src';
import type { LessonProgress, SonicPrefs } from '../../../packages/sonic-fpv/src';
import { launchChrome } from './browser';
import { REPO, today, writeEvidence } from './evidence';

const SITE = (process.env.SITE ?? '').replace(/\/$/, '');
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(SITE)) throw new Error('SITE=http://localhost:<port> of a local release build is needed (never the live site)');
const LOCK = 'C:/dev/.gpu-lock';
const SHOTS = process.env.SHOTS ?? join(tmpdir(), 'gsfpv-sonic-v13-page', today());
mkdirSync(SHOTS, { recursive: true });
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
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
  window.__cancels = 0;
  try {
    const s = window.speechSynthesis;
    const sp = s.speak.bind(s);
    const cancel = s.cancel.bind(s);
    s.speak = (u) => { window.__spoken.push(u.text); return sp(u); };
    s.cancel = () => { window.__cancels++; return cancel(); };
  } catch (e) {}
})();`;

async function profile(browser: Browser, d: object): Promise<BrowserContext> {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
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

const spoken = (page: Page): Promise<string[]> => page.evaluate(() => [...((window as unknown as { __spoken?: string[] }).__spoken ?? [])]);
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
    const ctx = await profile(browser, doc({ speechRate: 2 }));
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
        // to the settings by the navigation: its fourth link, Enter: the section's heading is said, Down goes into it
        await key(page, 'ArrowDown', 3);
        const navAt = await focusNow(page);
        await key(page, 'Enter');
        await sleep(200);
        const head = await focusNow(page);
        let n = (await spoken(page)).length;
        await key(page, 'ArrowDown');
        const lines: string[] = [];
        for (let i = 0; i < 7; i++) await key(page, 'ArrowDown');
        const sNow = await spoken(page);
        lines.push(...sNow.slice(n));
        const motorFocus = await focusNow(page);
        out.settingsWalk = { navAt, head, lines };
        check('C: the navigation\'s Settings link, Enter, the section\'s heading said; Down through the settings, each said with "Item n of 11", to Motor volume', navAt.text === 'Settings' && head.id === 'sonic-h-settings' && sNow.includes('Settings') && lines[0] === 'Settings. Sound theme: Soft. Item 1 of 11.' && lines.at(-1) === 'Motor volume: 0 dB. Item 8 of 11.' && motorFocus.testid === 'sonic-motor-level', out.settingsWalk);
        n = (await spoken(page)).length;
        await key(page, 'ArrowRight');
        await key(page, 'ArrowRight');
        await key(page, 'ArrowRight');
        await key(page, 'ArrowLeft', 5);
        const values = (await spoken(page)).slice(n);
        const level = await page.evaluate(() => ({ value: (document.querySelector('[data-testid="sonic-motor-level"]') as HTMLInputElement).value, text: document.querySelector('[data-testid="sonic-motor-level"]')?.getAttribute('aria-valuetext') ?? '' }));
        out.motorLevel = { values, level, saved: (await saved(page)).prefs?.motorGainDb };
        check('C: Right and Left move Motor volume in 3 dB steps, each value said, the end said as the limit (6 dB), saved', values.join(' | ') === 'Motor volume: 3 dB | Motor volume: 6 dB | Motor volume: 6 dB. That is the limit. | Motor volume: 3 dB | Motor volume: 0 dB | Motor volume: -3 dB | Motor volume: -6 dB | Motor volume: -9 dB' && level.value === '-9' && level.text === '-9 dB' && (await saved(page)).prefs?.motorGainDb === -9, out.motorLevel);
        n = (await spoken(page)).length;
        await key(page, 'ArrowDown');
        await key(page, 'Enter');
        const target = (await spoken(page)).slice(n);
        out.heightTarget = { target, saved: (await saved(page)).prefs?.heightTarget };
        check('C: Down to Target height note (said), Enter turns it off (said), saved', target.join(' | ') === 'Target height note: on. Item 9 of 11. | Target height note: off' && (await saved(page)).prefs?.heightTarget === false, out.heightTarget);
        await shot(page, 'c-settings', 'the settings with Motor volume at -9 dB and the target note off');
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
        const read = await page.evaluate(() => ({ level: (document.querySelector('[data-testid="sonic-motor-level"]') as HTMLInputElement).value, target: (document.querySelector('[data-testid="sonic-height-target"]') as HTMLInputElement).checked }));
        out.readBack = read;
        check('C: after a reload the settings read back: Motor volume -9 dB, the target note off', read.level === '-9' && read.target === false, read);
    } finally {
        await ctx.close();
    }
}

// ------------------------------------------------------------------ D and E: the lesson menu, the progress panel

async function partDE(browser: Browser, out: Record<string, unknown>): Promise<void> {
    const ctx = await profile(browser, doc({ speechRate: 2 }));
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
        // E: through the ring with W held, until the first attempt is counted
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
            return { text: el.innerText, hidden: el.hidden, left: r.left, top: r.top, width: r.width, height: r.height, font: cs.fontSize, weight: cs.fontWeight, color: cs.color, background: cs.backgroundColor, vw: innerWidth, vh: innerHeight };
        });
        const rows = (panel?.text ?? '').split('\n').map((x) => x.trim()).filter((x) => x !== '');
        out.panel = { panel, hookPanel: pv.panel, attempt: pv.attempt, progress: pv.progress['rings-first'] };
        await shot(page, 'e-progress-panel', 'the progress panel after the first counted attempt of rings-first');
        const lessonPlace = fill(SONIC['sonic.progress.lesson'] ?? '', { n: lessonPaths().full.indexOf('rings-first') + 1, total: TOTAL });
        check(`E: after a counted attempt the panel shows rings-first's place (${lessonPlace}), the step (2 of 2), "Attempt 1" and "Counted 1 of 3", as the hook's text`, !!panel && !panel.hidden && rows.some((r) => r === lessonPlace) && rows.some((r) => r === fill(SONIC['sonic.progress.step'] ?? '', { n: 2, total: 2 })) && rows.some((r) => r === fill(SONIC['sonic.progress.attempt'] ?? '', { n: 1 })) && rows.some((r) => r === fill(SONIC['sonic.progress.counted'] ?? '', { n: 1, total: getLesson('rings-first').pass.required })) && pv.panel.split('\n').every((r) => rows.includes(r.trim()) || r.trim() === ''), { rows, hook: pv.panel });
        const font = parseFloat(panel?.font ?? '0');
        check('E: the panel is large (18 px or more), bold, opaque, in the left part of the page and not over the view\'s middle', !!panel && font >= 18 && Number(panel.weight) >= 600 && !/rgba\([^)]*,\s*0(\.\d+)?\)/.test(panel.background) && panel.left + panel.width <= panel.vw * 0.35 && panel.left < panel.vw / 2, panel);
        check('D, E: no page error in the lesson', errors.length === 0, errors);
        out.lessonStart = { phase: p0?.phase, events: (pe?.events.length ?? 0) - m0 };
    } finally {
        await ctx.close();
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
        ({ browser } = await launchChrome({ args: ['--autoplay-policy=no-user-gesture-required'] }));
        const parts: [string, (b: Browser, o: Record<string, unknown>) => Promise<void>][] = [['A', partA], ['B', partB], ['C', partC], ['DE', partDE]];
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
    const file = writeEvidence('sonic-v13-page', { site: SITE, parts: process.env.PARTS ?? 'A,B,C,DE', checks, passed, total: checks.length, shots, result: out });
    writeFileSync(join(SHOTS, 'evidence-path.txt'), file);
    console.log(`${passed} of ${checks.length} checks passed; ${file}`);
    process.exitCode = passed === checks.length && checks.length > 0 ? 0 : 1;
}

main().catch((e) => {
    letGo();
    console.error(e);
    process.exit(2);
});
