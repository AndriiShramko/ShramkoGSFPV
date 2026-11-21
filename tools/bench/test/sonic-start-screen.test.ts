// v0.13 Fly by Sound, lane v13-host stage C (docs/wip/v13-host.md "Stage C"): the mode's start screen itself (apps/fly/src/sonic/
// start-screen.ts) on a small stand-in for the DOM (tools/bench/test/sonic-fake-dom.ts), with the real sound setup (SonicSetup on an
// in-memory prefs store, a fake engine that records what it is asked to say). The real page is the page proof's
// (tools/bench/src/sonic-v13-page.ts).
//  - C1 (M41-1): the pause menu's item opens this screen (sonic-optin.test.ts); the page about the mode stays linked from it.
import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DICTS, SHIPPED_LESSON_IDS, createTranslator, getLesson, lessonPaths } from '../../../packages/sonic-fpv/src';
import type { Locale, LessonProgress, SpeechLine } from '../../../packages/sonic-fpv/src';
import type { AudioDeps, PageEngine } from '../../../apps/fly/src/sonic/audio';
import type { CaptionSink } from '../../../apps/fly/src/sonic/entry';
import { mkStore } from '../../../packages/prefs/test/helpers';
import * as lookPrefs from '../../../apps/fly/src/sonic/look-prefs';
import { FakeDocument, FakeEvent } from './sonic-fake-dom';
import { headRig } from './sonic-head-fakes';
import type { HeadRig } from './sonic-head-fakes';

/** lane head4: the head-tracking stand-ins of the last open() */
let lastRig: HeadRig;
const EN_HEAD_WHAT = 'The web camera follows your head, so sounds stay in place when you turn it. No picture leaves this computer.';
import type { FakeElement } from './sonic-fake-dom';

type ScreenMod = typeof import('../../../apps/fly/src/sonic/start-screen');
type EntryMod = typeof import('../../../apps/fly/src/sonic/entry');
type StoreMod = typeof import('../../../apps/fly/src/sonic/store');
type ModelMod = typeof import('../../../apps/fly/src/sonic/start-model');

let screenMod: ScreenMod;
let entryMod: EntryMod;
let storeMod: StoreMod;
let modelMod: ModelMod;
let doc: FakeDocument;

/** The page's globals on a fresh stand-in document: the DOM, the window's key listeners, the address. */
function stubPage(): FakeDocument {
    const d = new FakeDocument();
    vi.stubGlobal('document', d);
    vi.stubGlobal('addEventListener', (type: string, cb: never, capture?: boolean) => d.window.addEventListener(type, cb, capture));
    vi.stubGlobal('removeEventListener', (type: string, cb: never, capture?: boolean) => d.window.removeEventListener(type, cb, capture));
    vi.stubGlobal('location', { pathname: '/en/fly/', search: '?sonic=start', origin: 'https://gsfpv.flyreelstudio.eu' });
    return d;
}

beforeAll(async () => {
    doc = stubPage();
    // the page's own texts (t()) and the mode's (the start chunk's namespaces), as the start chunk loads them
    await import('../../../apps/fly/src/sonic/texts');
    screenMod = await import('../../../apps/fly/src/sonic/start-screen');
    entryMod = await import('../../../apps/fly/src/sonic/entry');
    storeMod = await import('../../../apps/fly/src/sonic/store');
    modelMod = await import('../../../apps/fly/src/sonic/start-model');
});

afterEach(() => {
    vi.restoreAllMocks();
});

/** The engine as the start screen reaches it: what it was asked to say, in order, with the interrupt flag. */
class SayingEngine {
    state: PageEngine['state'] = 'idle';
    said: { line: SpeechLine; interrupt: boolean }[] = [];
    onSpeech: ((line: SpeechLine, text: string) => void) | null = null;
    auxInput: object | null = null;
    motorInput: object | null = null;
    plan = null;
    async start(): Promise<void> { this.state = 'running'; }
    async suspend(): Promise<void> { this.state = 'suspended'; }
    async resume(): Promise<void> { this.state = 'running'; }
    async close(): Promise<void> { this.state = 'closed'; }
    setTheme(): void { /* not under test */ }
    setPrefs(): void { /* not under test */ }
    setLocale(): void { /* not under test */ }
    setLayers(): void { /* not under test */ }
    update(): void { /* not under test */ }
    cue(): void { /* not under test */ }
    async say(line: SpeechLine, o?: { interrupt?: boolean }): Promise<void> { this.said.push({ line, interrupt: o?.interrupt === true }); }
    activeCues(): readonly never[] { return []; }
}

class Sink implements CaptionSink {
    add(): void { /* not under test */ }
    configure(): void { /* not under test */ }
}

interface Screen {
    readonly s: InstanceType<ScreenMod['StartScreen']>;
    readonly setup: InstanceType<EntryMod['SonicSetup']>;
    readonly store: ReturnType<typeof mkStore>;
    readonly engine: SayingEngine;
    readonly started: string[];
    readonly closed: { n: number };
    readonly doc: FakeDocument;
}

/** The start screen of a page entered through ?sonic=start in `locale`, with the saved progress given, on a fresh document. */
function open(o: { locale?: Locale; progress?: Record<string, LessonProgress>; current?: string | null; overFlight?: boolean; store?: ReturnType<typeof mkStore>; request?: ReturnType<ModelMod['parseSonicParam']>; experienced?: () => boolean; onFlies?: () => void; path?: 'full' | 'fast'; noWebAudio?: boolean; short?: boolean } = {}): Screen {
    doc = stubPage();
    const store = o.store ?? mkStore();
    for (const p of Object.values(o.progress ?? {})) storeMod.saveProgress(store, p);
    if (o.current !== undefined) storeMod.setCurrentLesson(store, o.current);
    const engine = new SayingEngine();
    const deps: AudioDeps = { makeContext: () => (o.noWebAudio ? null : ({ currentTime: 0, sampleRate: 48000, state: 'running' }) as never), unlockSpeech: () => undefined, createEngine: () => engine as unknown as PageEngine };
    const setup = new entryMod.SonicSetup(store, o.locale ?? 'en', new Sink(), { deps });
    // lane head4: the page's head-tracking switch (head/page.ts attachHead), here on stand-ins
    lastRig = headRig(store);
    setup.head = lastRig.head;
    if (o.path) expect(setup.update({ path: o.path }).ok).toBe(true);
    const started: string[] = [];
    const closed = { n: 0 };
    const s = new screenMod.StartScreen({
        setup,
        locale: o.locale ?? 'en',
        request: o.request ?? modelMod.parseSonicParam('start'),
        ...(o.experienced ? { experienced: o.experienced } : {}),
        ...(o.onFlies ? { onFlies: o.onFlies } : {}),
        progress: () => storeMod.allProgress(store),
        current: () => storeMod.currentLesson(store),
        onStart: (id) => void started.push(id),
        resetProgress: () => storeMod.resetProgress(store),
        ...(o.overFlight ? { onClose: () => void closed.n++ } : {})
    }, doc.body as unknown as HTMLElement);
    // lane gap-sound: the settings open at level 'first'; the tests written for the whole list press "Show all settings" first
    if (!o.short) byTestId(doc, 'sonic-settings-all')!.click();
    return { s, setup, store, engine, started, closed, doc };
}

const byTestId = (d: FakeDocument, id: string): FakeElement | null => d.querySelector(`[data-testid="${id}"]`);

/** A lesson's saved progress as the runner writes it (v0.13: with `skipped`). */
const P = (id: string, o: Partial<LessonProgress> = {}): LessonProgress => ({ lessonId: id, version: getLesson(id).version, attempts: 0, successes: 0, blocksPassed: 0, passed: false, bestTimeMs: null, lastAt: '2026-11-08T10:00:00.000Z', skipped: false, ...o });

const EN = createTranslator('en', DICTS);
const titleOf = (id: string): string => EN.text(getLesson(id).title);
/** "Lesson 20 of 28" as the page writes it for `id` on `path` (the full one unless named). */
const placeOf = (id: string, path: 'full' | 'fast' = 'full'): string => {
    const p = modelMod.lessonPlace(id, path);
    return `Lesson ${p.n} of ${p.total}`;
};

// ------------------------------------------------------------------ C1

describe('C1 (M41-1): the page about the mode stays linked from the start screen', () => {
    it('the footer links the page about the mode (/{lang}/sound/) and the ordinary simulator (/{lang}/fly/) in the screen\'s language, in en, es, pl and ru', () => {
        for (const l of ['en', 'es', 'pl', 'ru'] as const) {
            const { s } = open({ locale: l });
            const about = byTestId(doc, 'sonic-about');
            const leave = byTestId(doc, 'sonic-leave');
            expect(about?.tagName, l).toBe('A');
            expect(about?.getAttribute('href'), l).toBe(`/${l}/sound/`);
            expect(about?.textContent.length, l).toBeGreaterThan(5);
            expect(about?.closest('footer'), l).not.toBeNull();
            expect(leave?.getAttribute('href'), l).toBe(`/${l}/fly/`);
            s.dispose();
            expect(doc.window.listening, l).toBe(0);
        }
    });
});

// ------------------------------------------------------------------ train 2: a scan link

describe('lane n-share: the start screen of a link with a scene (?sonic=fly|scan&scene=&sz=) has ONE main button, that scene', () => {
    const scanReq = (extra = '') => modelMod.parseSonicParam('fly', new URLSearchParams(`sonic=fly&scene=887f27aa&sz=2${extra}`));
    const order = (): string[] => {
        const parent = byTestId(doc, 'sonic-start-quick')!.parentElement!;
        return parent.children.map((c) => c.getAttribute('data-testid') ?? '').filter((x) => x.startsWith('sonic-start-'));
    };
    const startSection = (): FakeElement => doc.querySelector('#sonic-sec-start')!;
    const primaries = (): string[] => startSection().querySelectorAll('.btn.primary').map((c) => c.getAttribute('data-testid') ?? '');

    it('a browser that never opened the site: "Fly this scan by sound" is the one main button, the lessons a small link; its press flies the scene', () => {
        const fresh = open({ request: scanReq() });
        expect(primaries()).toEqual(['sonic-start-scan']);
        expect(byTestId(doc, 'sonic-start-quick')).toBeNull();
        expect(byTestId(doc, 'sonic-start-lessons')!.tagName.toLowerCase()).toBe('a');
        byTestId(doc, 'sonic-start-scan')!.click();
        expect(fresh.started).toEqual(['scan-free']);
        fresh.s.dispose();
    });

    it('a pilot with progress gets the same screen; a link with a course says its gates come along', () => {
        const back = open({ request: scanReq('&course=g2.abc12'), progress: { 'rings-first': P('rings-first', { attempts: 2 }) } });
        expect(primaries()).toEqual(['sonic-start-scan']);
        expect(byTestId(doc, 'sonic-start-scan')!.textContent).toContain('With the course of the link');
        back.s.dispose();
    });

    it('control: the plain start screen (?sonic=start) has no scan button', () => {
        const { s } = open();
        expect(order()).toEqual(['sonic-start-quick', 'sonic-start-all']);
        s.dispose();
    });

    it('int4 car 5 (n-share x tutor-say): the first key on a link\'s screen says the title and the link\'s one main button once, never Start flying', () => {
        const { s, engine } = shown({ request: scanReq() });
        expect(focusedId(doc)).toBe('sonic-start-scan');
        expect(engine.said).toEqual([]);
        doc.key('ArrowDown');
        const first = heard(engine)[0] ?? '';
        expect(first.startsWith('Fly by Sound. ')).toBe(true);
        expect(first.startsWith('Fly by Sound. Fly this scan by sound.')).toBe(true);
        expect(first).not.toContain('Start flying');
        expect(heard(engine).filter((x) => x.startsWith('Fly by Sound.'))).toHaveLength(1);
        s.dispose();
    });
});

// ------------------------------------------------------------------ C2

describe('C2 (M41-2, W7): the course from the beginning, Continue, the 28 lessons with their states, Reset with a confirm', () => {
    it('lane tutor-say S3 (was sound6 S2 (a, b)): before any lesson: no Continue; "Start flying" first and primary, "All lessons" second; no path radios; All lessons saves the full path and takes the focus to the lessons; Start flying saves the fast one and opens its first lesson', () => {
        const { s, started, setup, store } = open();
        expect(byTestId(doc, 'sonic-start-continue')).toBeNull();
        const q = byTestId(doc, 'sonic-start-quick')!;
        const f = byTestId(doc, 'sonic-start-all')!;
        expect(q.parentElement!.querySelectorAll('button').map((b) => b.getAttribute('data-testid'))).toEqual(['sonic-start-quick', 'sonic-start-all']);
        expect(q.textContent).toBe(`Start flying${EN.say('menu.path.fast-what')}`);
        expect(f.textContent).toBe('All lessons');
        expect(q.className).toContain('primary');
        expect(f.className).not.toContain('primary');
        expect(doc.querySelectorAll('input').filter((x) => (x.getAttribute('data-testid') ?? '').startsWith('sonic-path-'))).toHaveLength(0);
        expect(byTestId(doc, 'sonic-start-beginning')).toBeNull();
        f.click();
        expect(started).toEqual([]);
        expect(setup.prefs.path).toBe('full');
        expect(store.collection('sonic').prefs).toMatchObject({ path: 'full' });
        expect(doc.activeElement).toBe(doc.querySelector('#sonic-h-lessons'));
        // the lessons are counted on the full course now
        expect(doc.querySelectorAll('[data-testid="sonic-lesson"]').map((r) => r.getAttribute('data-lesson'))).toEqual(lessonPaths().full);
        byTestId(doc, 'sonic-start-quick')!.click();
        expect(started).toEqual([lessonPaths().fast[0]]);
        expect(started[0]).toBe('ears-headphones');
        expect(setup.prefs.path).toBe('fast');
        expect(store.collection('sonic').prefs).toMatchObject({ path: 'fast' });
        s.dispose();
    });

    it('lane sound6 S2 (c) as lane gap-sound orders it (line 531), with progress: Quick start first, primary and focused, then "Continue: <the lesson left off on>" with its place and state, then Full course; Quick start opens lesson 1 and keeps the progress', () => {
        const progress = { 'walls-hall': P('walls-hall', { passed: true, attempts: 5, successes: 3 }), 'hover-height': P('hover-height', { attempts: 2, skipped: true }), 'rings-first': P('rings-first', { attempts: 2, successes: 1 }) };
        const { s, started, store } = open({ progress, current: 'rings-first' });
        const buttons = byTestId(doc, 'sonic-start-continue')!.parentElement!.querySelectorAll('button').map((b) => b.getAttribute('data-testid'));
        expect(buttons).toEqual(['sonic-start-quick', 'sonic-start-all', 'sonic-start-continue']);
        s.show();
        expect(focusedId(doc)).toBe('sonic-start-quick');
        const c = byTestId(doc, 'sonic-start-continue')!;
        expect(c.textContent).toContain(`Continue: ${titleOf('rings-first')}`);
        expect(c.textContent).toContain(`${placeOf('rings-first', 'fast')}, in progress`);
        expect(c.className).not.toContain('primary');
        const before = JSON.stringify(storeMod.allProgress(store));
        expect(byTestId(doc, 'sonic-start-quick')!.className).toContain('primary');
        const b = byTestId(doc, 'sonic-start-quick')!;
        expect(b.textContent).toContain('Your progress is kept.');
        b.click();
        expect(started).toEqual(['ears-headphones']);
        expect(JSON.stringify(storeMod.allProgress(store))).toBe(before);
        c.click();
        expect(started).toEqual(['ears-headphones', 'rings-first']);
        s.dispose();
    });

    it('the 28 lessons by module in the path\'s order, each with "Lesson N of 28" and its state: passed, skipped, in progress, not started; skipped read back from the saved progress after a reload', () => {
        const progress = { 'ears-headphones': P('ears-headphones', { passed: true, attempts: 1, successes: 1 }), 'hover-height': P('hover-height', { attempts: 3, skipped: true }), 'hover-turn': P('hover-turn', { attempts: 1 }) };
        const first = open({ progress, current: 'hover-turn' });
        first.s.dispose();
        // a new page on the same saved document (the prefs keep `skipped` since v0.13)
        const again = mkStore();
        again.importFile(first.store.exportFile({ include: ['sonic'] }), 'replace');
        const { s } = open({ store: again, path: 'full' });
        const rows = doc.querySelectorAll('[data-testid="sonic-lesson"]');
        expect(rows.map((r) => r.getAttribute('data-lesson'))).toEqual(lessonPaths().full);
        expect(rows).toHaveLength(SHIPPED_LESSON_IDS.length);
        rows.forEach((r, i) => expect(r.textContent, r.getAttribute('data-lesson') ?? '').toContain(`Lesson ${i + 1} of ${SHIPPED_LESSON_IDS.length}`));
        const stateOfRow = (id: string): { state: string | null; text: string } => {
            const r = rows.find((x) => x.getAttribute('data-lesson') === id)!;
            return { state: r.getAttribute('data-state'), text: r.textContent };
        };
        expect(stateOfRow('ears-headphones')).toMatchObject({ state: 'passed' });
        expect(stateOfRow('ears-headphones').text).toContain(', passed');
        expect(stateOfRow('hover-height')).toMatchObject({ state: 'skipped' });
        expect(stateOfRow('hover-height').text).toContain(', skipped');
        expect(stateOfRow('hover-turn')).toMatchObject({ state: 'current' });
        expect(stateOfRow('hover-turn').text).toContain(', in progress');
        expect(stateOfRow('corridor')).toMatchObject({ state: 'new' });
        expect(stateOfRow('corridor').text).toContain(', not started');
        expect(rows.find((r) => r.getAttribute('data-lesson') === 'hover-height')!.className).toContain('sonic-skipped');
        // grouped by module: every module's lessons under its own heading
        expect(doc.querySelectorAll('.sonic-module')).toHaveLength(8);
        s.dispose();
    });

    it('Reset my progress asks first, the focus on No; No and Escape keep everything; Yes clears every lesson and the current one, the sound settings stay, and the screen shows every lesson new', () => {
        const progress = { 'ears-headphones': P('ears-headphones', { passed: true, attempts: 1, successes: 1 }), 'hover-height': P('hover-height', { attempts: 3, skipped: true }) };
        const { s, store, setup } = open({ progress, current: 'hover-height' });
        expect(setup.update({ theme: 'clear', motorSound: false }).ok).toBe(true);
        const saved = (): string => JSON.stringify(store.collection('sonic').progress);
        const before = saved();
        const ask = (): void => byTestId(doc, 'sonic-reset')!.click();
        // asked: the question (the count of lessons in it), No focused first, then Yes
        ask();
        expect(byTestId(doc, 'sonic-reset')).toBeNull();
        expect(byTestId(doc, 'sonic-reset-ask')!.textContent).toContain(`all ${SHIPPED_LESSON_IDS.length} lessons`);
        expect(doc.activeElement).toBe(byTestId(doc, 'sonic-reset-no'));
        expect(byTestId(doc, 'sonic-reset-box')!.getAttribute('aria-labelledby')).toBe('sonic-reset-ask');
        // No: nothing changed, the focus back on Reset
        byTestId(doc, 'sonic-reset-no')!.click();
        expect(saved()).toBe(before);
        expect(doc.activeElement).toBe(byTestId(doc, 'sonic-reset'));
        // Escape is No (and is not the screen's own Escape over a flight)
        ask();
        doc.key('Escape');
        expect(saved()).toBe(before);
        expect(byTestId(doc, 'sonic-reset')).not.toBeNull();
        // Yes: every lesson new, no Continue, the sound settings as they were
        ask();
        byTestId(doc, 'sonic-reset-yes')!.click();
        expect(store.collection('sonic').progress).toEqual({});
        expect(store.collection('sonic').current).toBeNull();
        expect(store.collection('sonic').prefs).toMatchObject({ theme: 'clear', motorSound: false });
        expect(setup.prefs.theme).toBe('clear');
        expect(doc.querySelectorAll('[data-testid="sonic-lesson"]').every((r) => r.getAttribute('data-state') === 'new')).toBe(true);
        expect(byTestId(doc, 'sonic-start-continue')).toBeNull();
        expect(doc.activeElement).toBe(byTestId(doc, 'sonic-start-quick'));
        s.dispose();
    });

    it('control: over a flight, Escape outside the question closes the screen; inside it, it only answers No', () => {
        const { s, closed } = open({ overFlight: true, progress: { 'hover-height': P('hover-height', { attempts: 1 }) } });
        byTestId(doc, 'sonic-reset')!.click();
        doc.key('Escape');
        expect(closed.n).toBe(0);
        doc.key('Escape');
        expect(closed.n).toBe(1);
        s.dispose();
    });
});

// ------------------------------------------------------------------ C3

/** What the voice was asked to say, as text (the screen's own lines are `sonic.say.text` with the text; the others by key). */
const heard = (e: SayingEngine): string[] => e.said.map((x) => (x.line.key === 'sonic.say.text' ? String(x.line.params?.text) : x.line.key));
const lastHeard = (e: SayingEngine): { text: string; interrupt: boolean } => {
    const x = e.said.at(-1)!;
    return { text: x.line.key === 'sonic.say.text' ? String(x.line.params?.text) : x.line.key, interrupt: x.interrupt };
};
/** The control the focus is on, by its test id (or id). */
const focusedId = (d: FakeDocument): string => d.activeElement?.getAttribute('data-testid') ?? d.activeElement?.id ?? '';
/** A fresh page as startSonic opens it: the screen shown, the focus on its first Start button (lane gap-sound). */
function shown(o: Parameters<typeof open>[0] = {}): Screen {
    const x = open(o);
    x.s.show();
    return x;
}

/** The stops of a fresh screen with no progress and the volume part closed, in the page's order. */
const STOPS = [
    ...['#sonic-sec-start', '#sonic-sec-headphones', '#sonic-sec-lessons', '#sonic-sec-settings'],
    'sonic-start-quick', 'sonic-start-all',
    'sonic-hp-left', 'sonic-hp-right',
    ...lessonPaths().full.map((id) => `lesson:${id}`), 'sonic-reset',
    // v13-int step 3: sound from above and below after the target height note; the sound panel and the attitude display after the frame;
    // lane sonic-beacon: the target hum showing the way after sound from above and below
    'sonic-theme', 'sonic-calm', 'sonic-polarity', 'sonic-rate', 'sonic-captions', 'sonic-sr', 'sonic-narrator', 'sonic-guide', 'sonic-motor', 'sonic-motor-level', 'sonic-height-target', 'sonic-height-direction', 'sonic-beacon', 'sonic-frame', 'sonic-look-soundPanel', 'sonic-look-attitude', 'sonic-key-hints', 'sonic-head', 'summary',
    'sonic-about', 'sonic-leave'
];
/** The focused control as STOPS names it. */
const stopName = (d: FakeDocument): string => {
    const a = d.activeElement!;
    if (a.tagName === 'A' && (a.getAttribute('href') ?? '').startsWith('#')) return a.getAttribute('href')!;
    if (a.getAttribute('data-testid') === 'sonic-lesson') return `lesson:${a.getAttribute('data-lesson')}`;
    if (a.tagName === 'SUMMARY') return 'summary';
    return focusedId(d);
};

describe('C3 (M41-4, W13): the start screen and the mode\'s settings as a spoken list', () => {
    it('the first key of a fresh page starts the sound and the voice says how the list works, then the stop (after it, not over it); Down goes through every stop in the page\'s order and round, each said once, with its section\'s name when the focus comes into one', () => {
        const { s, engine, setup } = shown();
        // lane gap-sound: the page opens on Quick start (one Enter starts); this walk starts from the h1, where a screen reader reads from
        expect(focusedId(doc)).toBe('sonic-start-quick');
        doc.querySelector('#sonic-h1')!.focus();
        // nothing said before a press: the browser speaks only after one
        expect(engine.said).toEqual([]);
        expect(setup.audio.ac).toBeNull();
        const first = doc.key('ArrowDown');
        expect(first.defaultPrevented).toBe(true);
        expect(setup.audio.ac).not.toBeNull();
        // lane tutor-say S3: the opening line (the title and the main button), not how the list works (that is key K's)
        expect(engine.said.map((x) => [x.line.key, x.interrupt])).toEqual([['sonic.say.text', true], ['sonic.say.text', false]]);
        expect(heard(engine)[0]).toBe(`Fly by Sound. Start flying. ${EN.say('menu.path.fast-what').replace(/\.$/, '')}`);
        expect(lastHeard(engine).text).toBe('Fly by Sound sections. Start. Item 1 of 4.');
        const visited = [stopName(doc)];
        for (let i = 1; i < STOPS.length; i++) {
            doc.key('ArrowDown');
            visited.push(stopName(doc));
        }
        expect(visited).toEqual(STOPS);
        // one line a stop, each cutting the one before (but the first, after the list's help)
        expect(engine.said).toHaveLength(STOPS.length + 1);
        expect(engine.said.slice(2).every((x) => x.interrupt)).toBe(true);
        const lines = heard(engine).slice(1);
        const at = (name: string): string => lines[STOPS.indexOf(name)]!;
        // lane tutor-say S3: the Start buttons say no "Item n of N"
        expect(at('sonic-start-quick')).toBe(`Start. Start flying. ${EN.say('menu.path.fast-what').replace(/\.$/, '')}`);
        expect(at('sonic-start-all')).toBe('All lessons');
        expect(at('sonic-hp-left')).toBe('Check your headphones. Play a sound on the left. Item 1 of 2.');
        // a lesson says its own place and state, not an item number
        // a new pilot is on the fast path (lane sound6 S2): its lessons are counted on it
        expect(at('lesson:ears-headphones')).toBe(`Lessons. ${titleOf('ears-headphones')}. Lesson 1 of ${lessonPaths().fast.length}, not started, Fast path`);
        expect(at('lesson:rings-first')).toBe(`${titleOf('rings-first')}. ${placeOf('rings-first', 'fast')}, not started, Fast path`);
        // the settings' stops: the screen's own count, 11 before v13-int's three switches (step 3), 15 before lane sonic-beacon's switch, 16 before lane quiet's
        const settings = STOPS.slice(STOPS.indexOf('sonic-theme'), STOPS.indexOf('summary') + 1).length;
        expect(settings).toBe(19); // lane tutor-say S3: the Guide row; // 17 before lane head4's head tracking row, 16 before lane quiet's narrator switch
        expect(at('sonic-theme')).toBe(`Settings. Sound theme: Soft. Item 1 of ${settings}.`);
        expect(at('sonic-motor-level')).toBe(`Motor volume: 0 dB. Item 10 of ${settings}.`);
        expect(at('sonic-height-target')).toBe(`Target height note: on. Item 11 of ${settings}.`);
        expect(at('sonic-about')).toBe('About Fly by Sound and its source code. Item 1 of 2.');
        // round: Down from the last is the first; Up from the first the last; Home and End
        doc.key('ArrowDown');
        expect(stopName(doc)).toBe(STOPS[0]);
        doc.key('ArrowUp');
        expect(stopName(doc)).toBe(STOPS.at(-1));
        doc.key('Home');
        expect(stopName(doc)).toBe(STOPS[0]);
        doc.key('End');
        expect(stopName(doc)).toBe(STOPS.at(-1));
        s.dispose();
    });

    it('every focus is said, however it came (Tab, a click, a jump of the navigation to a section\'s heading), and Down goes on from where it is', () => {
        const { s, engine } = shown();
        doc.key('ArrowDown');
        byTestId(doc, 'sonic-hp-right')!.focus();
        expect(lastHeard(engine)).toEqual({ text: 'Check your headphones. Play a sound on the right. Item 2 of 2.', interrupt: true });
        doc.key('ArrowDown');
        expect(stopName(doc)).toBe(`lesson:${lessonPaths().full[0]}`);
        // the navigation's Lessons link puts the focus on the section's heading: said, and Down goes to its first lesson
        doc.querySelector('[href="#sonic-sec-lessons"]')!.click();
        expect(doc.activeElement?.id).toBe('sonic-h-lessons');
        expect(lastHeard(engine).text).toBe('Lessons');
        doc.key('ArrowDown');
        expect(stopName(doc)).toBe(`lesson:${lessonPaths().full[0]}`);
        doc.key('ArrowUp');
        expect(stopName(doc)).toBe('sonic-hp-right');
        // Up from a heading is the stop just before it
        doc.querySelector('[href="#sonic-sec-lessons"]')!.click();
        doc.key('ArrowUp');
        expect(stopName(doc)).toBe('sonic-hp-right');
        s.dispose();
    });

    it('Left and Right move a setting one step, Enter takes its next value; each new value is said, applied and saved; the end of a slider says the limit; Motor volume goes from -24 to 6 dB in 3 dB steps and the Target height note on and off, read back after a reload', () => {
        const { s, engine, setup, store } = shown();
        doc.key('ArrowDown');
        const level = byTestId(doc, 'sonic-motor-level')!;
        level.focus();
        expect(level.getAttribute('min')).toBe('-24');
        expect(level.getAttribute('max')).toBe('6');
        expect(level.getAttribute('step')).toBe('3');
        doc.key('ArrowRight');
        expect(lastHeard(engine)).toEqual({ text: 'Motor volume: 3 dB', interrupt: true });
        expect(setup.prefs.motorGainDb).toBe(3);
        doc.key('ArrowRight');
        doc.key('ArrowRight');
        expect(lastHeard(engine).text).toBe('Motor volume: 6 dB. That is the limit.');
        expect(setup.prefs.motorGainDb).toBe(6);
        const seen: number[] = [];
        for (let i = 0; i < 11; i++) {
            doc.key('ArrowLeft');
            seen.push(setup.prefs.motorGainDb ?? NaN);
        }
        expect(seen).toEqual([3, 0, -3, -6, -9, -12, -15, -18, -21, -24, -24]);
        expect(lastHeard(engine).text).toBe('Motor volume: -24 dB. That is the limit.');
        expect(level.getAttribute('aria-valuetext')).toBe('-24 dB');
        doc.key('ArrowRight');
        doc.key('ArrowRight');
        doc.key('ArrowRight');
        expect(setup.prefs.motorGainDb).toBe(-15);
        // the target height note: Enter and the arrows turn it off and on
        const target = byTestId(doc, 'sonic-height-target')!;
        target.focus();
        doc.key('Enter');
        expect(lastHeard(engine)).toEqual({ text: 'Target height note: off', interrupt: true });
        expect(setup.prefs.heightTarget).toBe(false);
        // a choice: Right is the next theme, Enter goes round
        byTestId(doc, 'sonic-theme')!.focus();
        doc.key('ArrowRight');
        expect(lastHeard(engine).text).toBe('Sound theme: Clear');
        expect(setup.prefs.theme).toBe('clear');
        doc.key('ArrowLeft');
        doc.key('ArrowLeft');
        expect(lastHeard(engine).text).toBe('Sound theme: Soft. That is the limit.');
        // a box changed by the page's own Space (a click): said too
        byTestId(doc, 'sonic-calm')!.click();
        expect(lastHeard(engine).text).toBe('Calm mode: on');
        // read back: the saved document, a new setup and a new screen on it
        expect(store.collection('sonic').prefs).toMatchObject({ motorGainDb: -15, heightTarget: false, theme: 'soft', calm: true });
        s.dispose();
        const again = open({ store });
        expect(again.setup.prefs.motorGainDb).toBe(-15);
        expect(again.setup.prefs.heightTarget).toBe(false);
        expect(byTestId(doc, 'sonic-motor-level')!.value).toBe('-15');
        expect(byTestId(doc, 'sonic-height-target')!.checked).toBe(false);
        again.s.dispose();
    });

    it('the motor row (train 2, the owner): off by default; the pilot switching it on saves his choice (motorChoice), a new screen reads it back on', () => {
        const { s, store, setup } = open();
        expect(setup.prefs.motorSound).toBe(false);
        expect(byTestId(doc, 'sonic-motor')!.checked).toBe(false);
        byTestId(doc, 'sonic-motor')!.click();
        expect(store.collection('sonic').prefs).toMatchObject({ motorSound: true, motorChoice: true });
        s.dispose();
        const again = open({ store });
        expect(again.setup.prefs.motorSound).toBe(true);
        expect(byTestId(doc, 'sonic-motor')!.checked).toBe(true);
        again.s.dispose();
    });

    it('the volume and pitch sliders are stops only while their part is open', () => {
        const { s, engine, setup } = shown();
        doc.key('ArrowDown');
        const summary = doc.querySelector('summary')!;
        summary.focus();
        doc.key('ArrowDown');
        expect(stopName(doc)).toBe('sonic-about');
        summary.parentElement!.setAttribute('open', '');
        summary.focus();
        doc.key('ArrowDown');
        expect(focusedId(doc)).toBe('sonic-gain-safety');
        doc.key('ArrowRight');
        expect(lastHeard(engine).text).toBe(`${EN.say('menu.setting.volume', { layer: EN.say('layer.safety.name') })}: 1 dB`);
        expect(setup.prefs.layerGainDb.safety).toBe(1);
        // a second slider keeps the first one's change (each change starts from what is set now)
        doc.key('ArrowDown');
        doc.key('ArrowDown');
        expect(focusedId(doc)).toBe('sonic-gain-height');
        doc.key('ArrowLeft');
        expect(setup.prefs.layerGainDb).toMatchObject({ safety: 1, height: -1 });
        s.dispose();
    });

    it('Escape goes back: from anywhere to the first of the Start buttons on a page of its own (and nothing more from there); over a flight it closes the screen', () => {
        const { s, engine } = shown({ progress: { 'hover-height': P('hover-height', { attempts: 1 }) }, current: 'hover-height' });
        doc.key('ArrowDown');
        byTestId(doc, 'sonic-motor-level')!.focus();
        const esc = doc.key('Escape');
        expect(esc.defaultPrevented).toBe(true);
        expect(focusedId(doc)).toBe('sonic-start-quick');
        expect(lastHeard(engine).text).toBe(`Start. Start flying. ${EN.say('menu.path.fast-what')} Your progress is kept`);
        const again = doc.key('Escape');
        expect(again.defaultPrevented).toBe(false);
        expect(focusedId(doc)).toBe('sonic-start-quick');
        s.dispose();
        const over = shown({ overFlight: true });
        byTestId(doc, 'sonic-theme')!.focus();
        doc.key('Escape');
        expect(over.closed.n).toBe(1);
        over.s.dispose();
    });

    it('the reset question is said, then No after it; Yes says the progress is reset, then where the focus went', () => {
        const { s, engine } = shown({ progress: { 'hover-height': P('hover-height', { attempts: 1 }) }, current: 'hover-height' });
        doc.key('ArrowDown');
        byTestId(doc, 'sonic-reset')!.focus();
        doc.key('Enter');
        // (Enter on a button is the button's: the stand-in page has no default action, so the test clicks as the browser would)
        byTestId(doc, 'sonic-reset')!.click();
        const n = engine.said.length;
        expect(heard(engine).slice(n - 2)).toEqual([`Reset your progress in all ${SHIPPED_LESSON_IDS.length} lessons? Every lesson will be new again. Your sound settings stay as they are.`, 'No, keep my progress']);
        expect(engine.said.slice(n - 2).map((x) => x.interrupt)).toEqual([true, false]);
        byTestId(doc, 'sonic-reset-yes')!.focus();
        byTestId(doc, 'sonic-reset-yes')!.click();
        expect(heard(engine).slice(-2)).toEqual(['Your progress is reset. Every lesson is new again.', `Start. Start flying. ${EN.say('menu.path.fast-what').replace(/\.$/, '')}`]);
        s.dispose();
    });

    it('control: with "my screen reader speaks" the list leaves every key to the page and the voice says no stop and no value (the reader reads the focus); over a flight the lines go through the page\'s voice, not the engine', () => {
        const { s, engine, setup } = shown();
        expect(setup.update({ selfVoice: false }).ok).toBe(true);
        const k = doc.key('ArrowDown');
        expect(k.defaultPrevented).toBe(false);
        expect(focusedId(doc)).toBe('sonic-start-quick');
        byTestId(doc, 'sonic-theme')!.focus();
        expect(doc.key('ArrowRight').defaultPrevented).toBe(false);
        byTestId(doc, 'sonic-calm')!.click();
        expect(engine.said).toEqual([]);
        // Escape still goes back with a screen reader
        expect(doc.key('Escape').defaultPrevented).toBe(true);
        expect(focusedId(doc)).toBe('sonic-start-quick');
        s.dispose();
        // over a flight: bind's voice (the lesson's speech queue), the engine untouched
        const over = shown({ overFlight: true });
        const page: { line: SpeechLine; interrupt: boolean }[] = [];
        over.setup.audio.start();
        over.s.bind({ onStart: () => undefined, onClose: () => undefined, say: async (line, interrupt) => void page.push({ line, interrupt }) });
        over.s.show('settings');
        expect(page.map((x) => x.line.params?.text ?? x.line.key)).toEqual(['Settings']);
        doc.key('ArrowDown');
        expect(page.at(-1)?.line.params?.text).toBe('Sound theme: Soft. Item 1 of 19.');
        expect(over.engine.said).toEqual([]);
        over.s.dispose();
    });
});

// ------------------------------------------------------------------ v13-int step 5: the reset over a running lesson

describe('v13-int step 5: "Reset my progress" over a flight tells the flight page, after the saved progress is cleared', () => {
    it('Yes: onReset once, with every lesson already cleared; No and Escape: never (control); the lesson host\'s part is sonic-reset-running.test.ts', () => {
        const { s, store } = shown({ progress: { 'hover-height': P('hover-height', { attempts: 1 }) }, current: 'hover-height', overFlight: true });
        const told: number[] = [];
        s.bind({ onStart: () => undefined, onClose: () => undefined, onReset: () => void told.push(Object.keys(store.collection('sonic').progress).length) });
        doc.key('ArrowDown');
        byTestId(doc, 'sonic-reset')!.click();
        byTestId(doc, 'sonic-reset-no')!.click();
        expect(told).toEqual([]);
        byTestId(doc, 'sonic-reset')!.click();
        byTestId(doc, 'sonic-reset-no')!.focus();
        doc.key('Escape');
        expect(told).toEqual([]);
        expect(storeMod.savedProgress(store, 'hover-height')).not.toBeNull();
        byTestId(doc, 'sonic-reset')!.click();
        byTestId(doc, 'sonic-reset-yes')!.click();
        expect(told).toEqual([0]);
        expect(storeMod.savedProgress(store, 'hover-height')).toBeNull();
        s.dispose();
    });
});

// ------------------------------------------------------------------ v13-int step 3: the three new switches

describe('v13-int step 3: sound from above and below, the sound panel and the attitude display in the settings and the spoken list', () => {
    /** The engine as the page's setup reaches it, keeping the settings it was given (setPrefs). */
    class PrefsEngine extends SayingEngine {
        prefs: unknown[] = [];
        override setPrefs(p?: unknown): void {
            this.prefs.push(p);
        }
    }
    /** A screen on `store` whose engine keeps the settings it is given. */
    function withPrefs(store = mkStore(), o: { selfVoice?: boolean } = {}): Screen & { readonly pe: PrefsEngine } {
        doc = stubPage();
        const pe = new PrefsEngine();
        const deps: AudioDeps = { makeContext: () => ({ currentTime: 0, sampleRate: 48000, state: 'running' }) as never, unlockSpeech: () => undefined, createEngine: () => pe as unknown as PageEngine };
        const setup = new entryMod.SonicSetup(store, 'en', new Sink(), { deps });
        setup.head = headRig(store).head;
        if (o.selfVoice === false) expect(setup.update({ selfVoice: false }).ok).toBe(true);
        const s = new screenMod.StartScreen({ setup, locale: 'en', request: modelMod.parseSonicParam('start'), progress: () => storeMod.allProgress(store), current: () => storeMod.currentLesson(store), onStart: () => undefined }, doc.body as unknown as HTMLElement);
        byTestId(doc, 'sonic-settings-all')!.click();
        s.show();
        return { s, setup, store, engine: pe, started: [], closed: { n: 0 }, doc, pe };
    }
    const DIRECTION_WHAT = EN.say('menu.setting.height-direction-what').replace(/\.$/, '');
    const BEACON_WHAT = EN.say('menu.setting.beacon-what').replace(/\.$/, '');
    const SWITCHES = [
        { id: 'sonic-height-direction', name: EN.say('menu.setting.height-direction'), n: 12, tail: `. ${DIRECTION_WHAT}` },
        // lane sonic-beacon: the package's words for the target hum showing the way, its description after the value
        { id: 'sonic-beacon', name: EN.say('menu.setting.beacon'), n: 13, tail: `. ${BEACON_WHAT}` },
        { id: 'sonic-look-soundPanel', name: 'Sound panel: see every sound', n: 15, tail: '' },
        { id: 'sonic-look-attitude', name: 'Horizon and height display', n: 16, tail: '' }
    ] as const;
    /** what each switch keeps: the package's setting in the saved sound document, the panels in the collection beside it */
    const saved = (store: ReturnType<typeof mkStore>, id: string): unknown => {
        const c = store.collection('sonic');
        return id === 'sonic-height-direction' ? (c.prefs as Record<string, unknown>)['heightDirection'] : id === 'sonic-beacon' ? (c.prefs as Record<string, unknown>)['beacon'] : id === 'sonic-look-soundPanel' ? c.soundPanel : c.attitude;
    };

    it('each is said with its section (coming from another one), its value and "Item n of N" (the package\'s words for sound from above and below and for the target hum showing the way, each description after the value); all four are on for a pilot who never set them', () => {
        const { s, engine } = withPrefs();
        expect(EN.say('menu.setting.height-direction')).toBe('Sound from above and below');
        expect(EN.say('menu.setting.beacon')).toBe('Target hum shows the way');
        doc.key('ArrowDown');
        for (const sw of SWITCHES) {
            byTestId(doc, 'sonic-about')!.focus();
            byTestId(doc, sw.id)!.focus();
            expect(lastHeard(engine), sw.id).toEqual({ text: `Settings. ${sw.name}: on${sw.tail}. Item ${sw.n} of 19.`, interrupt: true });
            expect(byTestId(doc, sw.id)!.checked, sw.id).toBe(true);
        }
        // and within the section, the next stop after the long description cuts it (a line that interrupts)
        byTestId(doc, 'sonic-height-direction')!.focus();
        doc.key('ArrowDown');
        expect(focusedId(doc)).toBe('sonic-beacon');
        expect(engine.said.at(-1)!.interrupt).toBe(true);
        s.dispose();
    });

    it('Enter and the arrows turn each off and on: the new value said, applied (sound from above and below to the running engine at once) and saved; read back after a reload; control: a switch left alone keeps its value', () => {
        const store = mkStore();
        const { s, engine, setup, pe } = withPrefs(store);
        doc.key('ArrowDown');
        for (const sw of SWITCHES) {
            byTestId(doc, sw.id)!.focus();
            doc.key('Enter');
            expect(lastHeard(engine), sw.id).toEqual({ text: `${sw.name}: off`, interrupt: true });
            expect(byTestId(doc, sw.id)!.checked, sw.id).toBe(false);
            expect(saved(store, sw.id), sw.id).toBe(false);
        }
        // at once: the engine was given the setting off; the page's panels read the store (look-prefs.ts)
        expect(setup.prefs.heightDirection).toBe(false);
        expect((pe.prefs.at(-1) as { heightDirection?: boolean }).heightDirection).toBe(false);
        expect(setup.prefs.beacon).toBe(false);
        expect((pe.prefs.at(-1) as { beacon?: boolean }).beacon).toBe(false);
        expect(lookPrefs.panelOn(store, 'soundPanel')).toBe(false);
        expect(lookPrefs.panelOn(store, 'attitude')).toBe(false);
        // the attitude display on again with Right: the sound panel stays off (each its own)
        byTestId(doc, 'sonic-look-attitude')!.focus();
        doc.key('ArrowRight');
        expect(lastHeard(engine)).toEqual({ text: 'Horizon and height display: on', interrupt: true });
        expect(lookPrefs.panelOn(store, 'attitude')).toBe(true);
        expect(lookPrefs.panelOn(store, 'soundPanel')).toBe(false);
        s.dispose();
        // a reload: a new setup and screen on the same saved document, and the engine made with it (the next start)
        const again = withPrefs(store);
        expect(again.setup.prefs.heightDirection).toBe(false);
        expect(byTestId(doc, 'sonic-height-direction')!.checked).toBe(false);
        expect(again.setup.prefs.beacon).toBe(false);
        expect(byTestId(doc, 'sonic-beacon')!.checked).toBe(false);
        expect(byTestId(doc, 'sonic-look-soundPanel')!.checked).toBe(false);
        expect(byTestId(doc, 'sonic-look-attitude')!.checked).toBe(true);
        doc.key('ArrowDown');
        byTestId(doc, 'sonic-height-direction')!.focus();
        expect(lastHeard(again.engine).text).toBe(`Settings. Sound from above and below: off. ${DIRECTION_WHAT}. Item 12 of 19.`);
        byTestId(doc, 'sonic-beacon')!.focus();
        expect(lastHeard(again.engine).text).toBe(`Target hum shows the way: off. ${BEACON_WHAT}. Item 13 of 19.`);
        again.s.dispose();
    });

    it('with "my screen reader speaks" the native controls work (a click is the page\'s Space) and the voice says nothing: each value applied and saved all the same', () => {
        const store = mkStore();
        const { s, engine, setup } = withPrefs(store, { selfVoice: false });
        for (const sw of SWITCHES) {
            byTestId(doc, sw.id)!.focus();
            // the list leaves the keys to the page: Enter and the arrows are the reader's and the box's own
            expect(doc.key('Enter').defaultPrevented, sw.id).toBe(false);
            byTestId(doc, sw.id)!.click();
            expect(byTestId(doc, sw.id)!.checked, sw.id).toBe(false);
            expect(saved(store, sw.id), sw.id).toBe(false);
        }
        expect(setup.prefs.heightDirection).toBe(false);
        expect(setup.prefs.beacon).toBe(false);
        expect(engine.said).toEqual([]);
        s.dispose();
    });
});

// ------------------------------------------------------------------ v13-int review F2 and F4

describe('v13-int review F2, F4: the screen over a flight takes every key it is shown with; the focus leaves it when it hides', () => {
    /** The page's key router stand-in: a listener on the window after the screen's (KeyRouter.attach: the window, bubbling). */
    function router(d: FakeDocument): string[] {
        const seen: string[] = [];
        d.window.addEventListener('keydown', ((e: { code: string }) => void seen.push(e.code)) as never, false);
        return seen;
    }

    it('F2: shown over a lesson, the lesson\'s keys and the page\'s (B, N, Z, G, R, I, T, U, L, K, P, a digit) stop at the screen: the page\'s router never sees them; the harness keys F13 to F24 go on', () => {
        const { s } = shown({ overFlight: true });
        const seen = router(doc);
        byTestId(doc, 'sonic-start-quick')!.focus();
        const codes = ['KeyB', 'KeyN', 'KeyZ', 'KeyG', 'KeyR', 'KeyI', 'KeyT', 'KeyU', 'KeyL', 'KeyK', 'KeyP', 'Digit1'];
        for (const code of codes) {
            const ev = doc.key(code.slice(-1).toLowerCase(), { code });
            expect(ev.propagationStopped, code).toBe(true);
        }
        expect(seen).toEqual([]);
        doc.key('F13', { code: 'F13' });
        expect(seen).toEqual(['F13']);
        s.dispose();
    });

    it('F2 control: hidden (the flight has the page), every key reaches the page\'s router as before', () => {
        const { s } = shown({ overFlight: true });
        const seen = router(doc);
        s.hide();
        for (const code of ['KeyB', 'KeyN', 'KeyZ']) expect(doc.key(code.slice(-1).toLowerCase(), { code }).propagationStopped, code).toBe(false);
        expect(seen).toEqual(['KeyB', 'KeyN', 'KeyZ']);
        s.dispose();
    });

    it('F2: the screen\'s own keys still work while it takes the others (Down moves the spoken list, Escape closes it over the flight)', () => {
        const { s, closed } = shown({ overFlight: true });
        router(doc);
        byTestId(doc, 'sonic-start-quick')!.focus();
        const before = doc.activeElement;
        doc.key('ArrowDown');
        expect(doc.activeElement).not.toBe(before);
        doc.key('Escape');
        expect(closed.n).toBe(1);
        s.dispose();
    });

    it('F4: hide() takes the focus off the screen\'s control at once, so the flight page finds the body and puts the focus on its region (feature.ts focusFlight); control: a focus outside the screen is left alone', () => {
        const { s } = shown({ overFlight: true });
        byTestId(doc, 'sonic-start-quick')!.focus();
        expect(s.root.contains(doc.activeElement as never)).toBe(true);
        s.hide();
        expect(doc.activeElement).toBe(doc.body);
        expect(s.shown).toBe(false);
        // control: a control outside the screen keeps the focus when the screen hides
        s.show();
        const outside = doc.createElement('button');
        doc.body.append(outside);
        outside.focus();
        s.hide();
        expect(doc.activeElement).toBe(outside);
        s.dispose();
    });
});

describe('lane head4: "Turn my head to listen" in the settings', () => {
    it('the last setting, off for a pilot who never set it, said with its description; Enter speaks the explanation before the camera is asked; a refusal draws it off again', async () => {
        const { s, engine, store } = shown();
        doc.key('ArrowDown');
        byTestId(doc, 'sonic-about')!.focus();
        byTestId(doc, 'sonic-head')!.focus();
        expect(lastHeard(engine)).toEqual({ text: `Settings. Turn my head to listen: off. ${EN_HEAD_WHAT.replace(/\.$/, '')}. Item 18 of 19.`, interrupt: true });
        expect(byTestId(doc, 'sonic-head')!.checked).toBe(false);
        lastRig.camera.refuse = 'NotAllowedError';
        doc.key('Enter');
        // the lazy import of head/tracking can take past vitest's 1 s default under the full suite's load (review head4)
        await vi.waitFor(() => expect(lastRig.log.at(-1)).toBe('say:denied'), { timeout: 10_000 });
        expect(lastRig.log).toEqual(['say:ask', 'load', 'gum', 'say:denied']);
        expect(store.collection('sonic').headTrack).toBeUndefined();
        expect(byTestId(doc, 'sonic-head')!.checked).toBe(false);
        s.dispose();
    });
});

// ------------------------------------------------------------------ lane sound6 S4

describe('lane sound6 S4: a sound that did not start says so on the screen, with the way on', () => {
    const flush = async (): Promise<void> => {
        for (let i = 0; i < 5; i++) await Promise.resolve();
    };
    const noteText = (): string => byTestId(doc, 'sonic-audio-problem')?.textContent ?? '';
    const EN_LINES = JSON.parse(readFileSync(new URL('../../../packages/i18n/locales/fly/sonic/en.json', import.meta.url), 'utf8')) as Readonly<Record<string, string>>;

    it('(d) the engine rejecting its start (Firefox before the package fix): the engineFailed line is shown at the top of Start, not noAudio, and Copy link has the focus', async () => {
        const { setup, engine } = open();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        engine.start = async () => { throw new TypeError("can't access property \"value\", listener.positionX is undefined"); };
        expect(byTestId(doc, 'sonic-audio-problem')).toBeNull();
        byTestId(doc, 'sonic-hp-left')!.click();
        await flush();
        expect(setup.audio.failure).toBe('engine-failed');
        expect(warn).toHaveBeenCalled();
        const note = byTestId(doc, 'sonic-audio-problem')!;
        expect(note.closest('section')?.getAttribute('id')).toBe('sonic-sec-start');
        expect(noteText()).toContain(EN_LINES['sonic.start.engineFailed']);
        expect(noteText()).toContain('Chrome or Edge');
        expect(noteText()).not.toContain(EN_LINES['sonic.start.noAudio']);
        expect(doc.activeElement?.getAttribute('data-testid')).toBe('sonic-copy-link');
        expect(byTestId(doc, 'sonic-copy-link')!.textContent).toBe('Copy link');
    });

    it('a browser with no Web Audio: the noAudio line, the same Copy link', async () => {
        const { setup } = open({ noWebAudio: true });
        byTestId(doc, 'sonic-hp-right')!.click();
        await flush();
        expect(setup.audio.failure).toBe('no-web-audio');
        expect(noteText()).toContain(EN_LINES['sonic.start.noAudio']);
        expect(byTestId(doc, 'sonic-copy-link')).not.toBeNull();
    });

    it('Copy link puts the page\'s address on the clipboard and says so under the button; a refused clipboard names the address bar', async () => {
        const { engine } = open();
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        engine.start = async () => { throw new Error('no audio device'); };
        const href = 'https://gsfpv.flyreelstudio.eu/en/fly/?sonic=start';
        vi.stubGlobal('location', { pathname: '/en/fly/', search: '?sonic=start', origin: 'https://gsfpv.flyreelstudio.eu', href });
        const copied: string[] = [];
        const before = globalThis.navigator;
        vi.stubGlobal('navigator', { clipboard: { writeText: async (x: string) => void copied.push(x) } });
        try {
            byTestId(doc, 'sonic-hp-left')!.click();
            await flush();
            byTestId(doc, 'sonic-copy-link')!.click();
            await flush();
            expect(copied).toEqual([href]);
            expect(byTestId(doc, 'sonic-copy-result')!.textContent).toBe(EN_LINES['sonic.start.linkCopied']);
            vi.stubGlobal('navigator', { clipboard: { writeText: async () => { throw new Error('denied'); } } });
            byTestId(doc, 'sonic-copy-link')!.click();
            await flush();
            expect(byTestId(doc, 'sonic-copy-result')!.textContent).toBe(EN_LINES['sonic.start.copyFailed']);
        } finally {
            vi.stubGlobal('navigator', before);
        }
    });

    it('a sound that starts shows no problem note', async () => {
        const { setup } = open();
        byTestId(doc, 'sonic-hp-left')!.click();
        await flush();
        expect(setup.audio.failure).toBe('none');
        expect(byTestId(doc, 'sonic-audio-problem')).toBeNull();
    });

    it('every package line the screen names exists in all four languages (S2 deleted headphones.intro and the screen still named it)', () => {
        const src = readFileSync(new URL('../../../apps/fly/src/sonic/start-screen.ts', import.meta.url), 'utf8');
        const keys = [...src.matchAll(/this\.key\('([^']+)'/g)].map((m) => m[1]!);
        expect(keys.length).toBeGreaterThan(3);
        for (const l of ['en', 'es', 'pl', 'ru'] as const) {
            const tr = createTranslator(l, DICTS);
            expect(keys.filter((k) => !tr.has(k)), l).toEqual([]);
        }
    });
});

// ------------------------------------------------------------------ lane gap-sound (the owner's line 531)

describe('lane gap-sound: Quick start first and focused for every pilot, no sound behind, the settings at level first', () => {
    const settingIds = (): string[] => doc.querySelector('#sonic-sec-settings')!.querySelectorAll('[data-testid]').map((x) => x.getAttribute('data-testid') ?? '').filter((x) => x.startsWith('sonic-') && !x.startsWith('sonic-gain-') && !x.startsWith('sonic-pitch-'));

    it('a returning pilot (a lesson left off on): Quick start is the first button, primary and focused when the screen opens; Continue is second and says what it resumes; a first visit the same', () => {
        const progress = { 'corridor': P('corridor', { attempts: 2, successes: 1 }) };
        const back = shown({ progress, current: 'corridor', short: true });
        const group = byTestId(doc, 'sonic-start-quick')!.parentElement!;
        expect(group.querySelectorAll('button').map((b) => b.getAttribute('data-testid'))).toEqual(['sonic-start-quick', 'sonic-start-all', 'sonic-start-continue']);
        expect(focusedId(doc)).toBe('sonic-start-quick');
        expect(byTestId(doc, 'sonic-start-quick')!.className).toContain('primary');
        expect(byTestId(doc, 'sonic-start-continue')!.textContent).toContain(`Continue: ${titleOf('corridor')}`);
        // Enter on the focused button is the native click: the quick path's first lesson
        byTestId(doc, 'sonic-start-quick')!.click();
        expect(back.started).toEqual(['ears-headphones']);
        back.s.dispose();
        const fresh = shown({ short: true });
        expect(focusedId(doc)).toBe('sonic-start-quick');
        fresh.s.dispose();
    });

    it('the headphone check offers left and right only, and no sonic locale keeps a line about a sound behind', () => {
        const { s } = open({ short: true });
        const hp = doc.querySelector('#sonic-sec-headphones')!.querySelectorAll('button').map((b) => b.getAttribute('data-testid'));
        expect(hp).toEqual(['sonic-hp-left', 'sonic-hp-right']);
        expect(Object.keys(screenMod.HEADPHONE_DIRS)).toEqual(['left', 'right']);
        s.dispose();
        for (const l of ['en', 'es', 'pl', 'ru'] as const) {
            const keys = Object.keys(JSON.parse(readFileSync(new URL(`../../../packages/i18n/locales/fly/sonic/${l}.json`, import.meta.url), 'utf8')) as object);
            expect(keys.filter((k) => /behind/.test(k)), l).toEqual([]);
        }
    });

    it('the settings show the rows of level first and "Show all settings (12 more)"; its press shows all 19 and puts the focus on the first new row; a shared link with a sound setting shows all', () => {
        const { s, engine } = shown({ short: true });
        expect(settingIds()).toEqual(['sonic-rate', 'sonic-captions', 'sonic-sr', 'sonic-narrator', 'sonic-guide', 'sonic-key-hints', 'sonic-head', 'sonic-settings-all']);
        const all = byTestId(doc, 'sonic-settings-all')!;
        expect(all.tagName).toBe('BUTTON');
        expect(all.textContent).toBe('Show all settings (12 more)');
        // a stop of the spoken list like any other
        doc.key('ArrowDown');
        all.focus();
        expect(lastHeard(engine).text).toBe('Settings. Show all settings (12 more). Item 8 of 8.');
        all.click();
        expect(byTestId(doc, 'sonic-settings-all')).toBeNull();
        expect(settingIds()).toHaveLength(18);
        expect(doc.querySelector('#sonic-sec-settings')!.querySelector('summary')).not.toBeNull();
        expect(focusedId(doc)).toBe('sonic-theme');
        expect(lastHeard(engine).text).toBe('Sound theme: Soft. Item 1 of 19.');
        // it stays open for this page (a redraw after a change keeps it)
        byTestId(doc, 'sonic-calm')!.click();
        s.render();
        expect(byTestId(doc, 'sonic-settings-all')).toBeNull();
        s.dispose();
        expect(Object.entries(screenMod.SONIC_SETTING_LEVELS).every(([, v]) => v === 'first')).toBe(true);
        expect(screenMod.sonicSettingLevel('sonic-theme')).toBe('expert');
    });
});

// ------------------------------------------------------------------ train 4, lane tutor-say S3 (decisions 7 and 8)

describe('tutor-say S3: the start screen says its title and the main button once; the rest only when focused or asked; a setting redraws its own row', () => {
    const OPEN = `Fly by Sound. Start flying. ${EN.say('menu.path.fast-what').replace(/\.$/, '')}`;

    it('the first key of a fresh page: the title and Start flying, then the stop the key went to (All lessons); no list of keys, no "Item n of N"', () => {
        const { s, engine } = shown();
        expect(focusedId(doc)).toBe('sonic-start-quick');
        expect(engine.said).toEqual([]);
        doc.key('ArrowDown');
        expect(focusedId(doc)).toBe('sonic-start-all');
        expect(heard(engine)).toEqual([OPEN, 'All lessons']);
        expect(engine.said.map((x) => x.interrupt)).toEqual([true, false]);
        expect(heard(engine).some((x) => /Item \d+ of|sonic\.say\.listHelp/.test(x))).toBe(false);
        s.dispose();
    });

    it('shown again with the sound on: one line, the title and the main button; the focus on it', () => {
        const { s, engine } = shown();
        doc.key('ArrowDown');
        const n = engine.said.length;
        s.hide();
        s.show();
        expect(focusedId(doc)).toBe('sonic-start-quick');
        expect(heard(engine).slice(n)).toEqual([OPEN]);
        s.dispose();
    });

    it('key K says how the list works (only when asked); not in a select, where a letter picks an option', () => {
        const { s, engine } = shown();
        doc.key('ArrowDown');
        const n = engine.said.length;
        const k = doc.key('k', { code: 'KeyK' });
        expect(k.defaultPrevented).toBe(true);
        expect(engine.said.slice(n).map((x) => x.line.key)).toEqual(['sonic.say.listHelp']);
        byTestId(doc, 'sonic-guide')!.focus();
        const m = engine.said.length;
        expect(doc.key('k', { code: 'KeyK' }).defaultPrevented).toBe(false);
        expect(engine.said.slice(m)).toEqual([]);
        s.dispose();
    });

    it('Guide: Full / Short / New sounds only, at the first level, Short at first; a change is said, saved, kept after a reload, and draws nothing but its row (the Start buttons stay, the focus stays)', () => {
        const { s, engine, store } = shown({ short: true });
        doc.key('ArrowDown');
        const quick = byTestId(doc, 'sonic-start-quick')!;
        const guide = byTestId(doc, 'sonic-guide')!;
        expect(guide.querySelectorAll('option').map((o) => o.textContent)).toEqual(['Full', 'Short', 'New sounds only']);
        expect(guide.value).toBe('short');
        guide.focus();
        expect(lastHeard(engine).text).toBe('Settings. Guide: Short. Item 5 of 8.');
        doc.key('ArrowRight');
        expect(lastHeard(engine).text).toBe('Guide: New sounds only');
        expect(store.collection('sonic').guide).toBe('new');
        expect(byTestId(doc, 'sonic-start-quick')).toBe(quick);
        expect(doc.activeElement).toBe(byTestId(doc, 'sonic-guide'));
        s.dispose();
        const again = shown({ store, short: true });
        expect(byTestId(doc, 'sonic-guide')!.value).toBe('new');
        again.s.dispose();
    });

    it('a refused change draws its own row again from what is set: the other rows and the Start buttons are the same nodes, the focus stays on the control', () => {
        const { s } = shown();
        const quick = byTestId(doc, 'sonic-start-quick')!;
        const calm = byTestId(doc, 'sonic-calm')!;
        const rate = byTestId(doc, 'sonic-rate')!;
        rate.focus();
        rate.value = '99';
        rate.dispatchEvent(new FakeEvent('input'));
        const fresh = byTestId(doc, 'sonic-rate')!;
        expect(fresh).not.toBe(rate);
        expect(fresh.value).toBe('1');
        expect(doc.activeElement).toBe(fresh);
        expect(byTestId(doc, 'sonic-start-quick')).toBe(quick);
        expect(byTestId(doc, 'sonic-calm')).toBe(calm);
        s.dispose();
    });
});
