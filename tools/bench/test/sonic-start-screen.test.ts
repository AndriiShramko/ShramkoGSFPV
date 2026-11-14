// v0.13 Fly by Sound, lane v13-host stage C (docs/wip/v13-host.md "Stage C"): the mode's start screen itself (apps/fly/src/sonic/
// start-screen.ts) on a small stand-in for the DOM (tools/bench/test/sonic-fake-dom.ts), with the real sound setup (SonicSetup on an
// in-memory prefs store, a fake engine that records what it is asked to say). The real page is the page proof's
// (tools/bench/src/sonic-v13-page.ts).
//  - C1 (M41-1): the pause menu's item opens this screen (sonic-optin.test.ts); the page about the mode stays linked from it.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DICTS, SHIPPED_LESSON_IDS, createTranslator, getLesson, lessonPaths } from '../../../packages/sonic-fpv/src';
import type { Locale, LessonProgress, SpeechLine } from '../../../packages/sonic-fpv/src';
import type { AudioDeps, PageEngine } from '../../../apps/fly/src/sonic/audio';
import type { CaptionSink } from '../../../apps/fly/src/sonic/entry';
import { mkStore } from '../../../packages/prefs/test/helpers';
import * as lookPrefs from '../../../apps/fly/src/sonic/look-prefs';
import { FakeDocument } from './sonic-fake-dom';
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
function open(o: { locale?: Locale; progress?: Record<string, LessonProgress>; current?: string | null; overFlight?: boolean; store?: ReturnType<typeof mkStore>; request?: ReturnType<ModelMod['parseSonicParam']>; experienced?: () => boolean; onFlies?: () => void } = {}): Screen {
    doc = stubPage();
    const store = o.store ?? mkStore();
    for (const p of Object.values(o.progress ?? {})) storeMod.saveProgress(store, p);
    if (o.current !== undefined) storeMod.setCurrentLesson(store, o.current);
    const engine = new SayingEngine();
    const deps: AudioDeps = { makeContext: () => ({ currentTime: 0, sampleRate: 48000, state: 'running' }) as never, unlockSpeech: () => undefined, createEngine: () => engine as unknown as PageEngine };
    const setup = new entryMod.SonicSetup(store, o.locale ?? 'en', new Sink(), { deps });
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
    return { s, setup, store, engine, started, closed, doc };
}

const byTestId = (d: FakeDocument, id: string): FakeElement | null => d.querySelector(`[data-testid="${id}"]`);

/** A lesson's saved progress as the runner writes it (v0.13: with `skipped`). */
const P = (id: string, o: Partial<LessonProgress> = {}): LessonProgress => ({ lessonId: id, version: getLesson(id).version, attempts: 0, successes: 0, blocksPassed: 0, passed: false, bestTimeMs: null, lastAt: '2026-11-08T10:00:00.000Z', skipped: false, ...o });

const EN = createTranslator('en', DICTS);
const titleOf = (id: string): string => EN.text(getLesson(id).title);
/** "Lesson 20 of 28" as the page writes it for `id` on the full path. */
const placeOf = (id: string): string => {
    const p = modelMod.lessonPlace(id, 'full');
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

describe('train 2: the start screen of a scan link (?sonic=scan&scene=&sz=) orders its buttons by the pilot', () => {
    const scanReq = () => modelMod.parseSonicParam('scan', new URLSearchParams('sonic=scan&scene=887f27aa&sz=2'));
    const order = (): string[] => {
        const parent = byTestId(doc, 'sonic-start-beginning')!.parentElement!;
        return parent.children.map((c) => c.getAttribute('data-testid') ?? '').filter((x) => x.startsWith('sonic-start-'));
    };

    it('an experienced pilot: "Fly this scan by sound" first and primary, then the lessons; a first-timer: the lessons first, then "I already fly by sound", whose press saves the flag', () => {
        const exp = open({ request: scanReq(), experienced: () => true });
        expect(order()).toEqual(['sonic-start-scan', 'sonic-start-beginning']);
        expect(byTestId(doc, 'sonic-start-scan')!.className).toContain('primary');
        expect(byTestId(doc, 'sonic-start-beginning')!.className).not.toContain('primary');
        byTestId(doc, 'sonic-start-scan')!.click();
        expect(exp.started).toEqual(['scan-free']);
        exp.s.dispose();

        let flies = 0;
        const first = open({ request: scanReq(), experienced: () => false, onFlies: () => void flies++ });
        expect(order()).toEqual(['sonic-start-beginning', 'sonic-start-scan-flier']);
        expect(byTestId(doc, 'sonic-start-beginning')!.className).toContain('primary');
        expect(byTestId(doc, 'sonic-start-scan-flier')!.className).not.toContain('primary');
        byTestId(doc, 'sonic-start-scan-flier')!.click();
        expect(flies).toBe(1);
        expect(first.started).toEqual(['scan-free']);
        first.s.dispose();
    });

    it('control: the plain start screen (?sonic=start) has no scan button', () => {
        const { s } = open();
        expect(order()).toEqual(['sonic-start-beginning']);
        s.dispose();
    });
});

// ------------------------------------------------------------------ C2

describe('C2 (M41-2, W7): the course from the beginning, Continue, the 28 lessons with their states, Reset with a confirm', () => {
    it('before any lesson: no Continue; "Start the course from the beginning" says lesson 1 of 28 and opens it', () => {
        const { s, started } = open();
        expect(byTestId(doc, 'sonic-start-continue')).toBeNull();
        const b = byTestId(doc, 'sonic-start-beginning')!;
        expect(b.textContent).toContain('Start the course from the beginning');
        expect(b.textContent).toContain(`Lesson 1 of ${SHIPPED_LESSON_IDS.length}: ${titleOf('ears-headphones')}.`);
        expect(b.textContent).not.toContain('Your progress is kept');
        expect(b.className).toContain('primary');
        b.click();
        expect(started).toEqual(['ears-headphones']);
        s.dispose();
    });

    it('with progress: "Continue: <the lesson left off on>" first, with its place and state; the course from the beginning opens lesson 1 and keeps the progress', () => {
        const progress = { 'walls-hall': P('walls-hall', { passed: true, attempts: 5, successes: 3 }), 'hover-height': P('hover-height', { attempts: 2, skipped: true }), 'rings-first': P('rings-first', { attempts: 2, successes: 1 }) };
        const { s, started, store } = open({ progress, current: 'rings-first' });
        const buttons = byTestId(doc, 'sonic-start-continue')!.parentElement!.querySelectorAll('button').map((b) => b.getAttribute('data-testid'));
        expect(buttons.slice(0, 2)).toEqual(['sonic-start-continue', 'sonic-start-beginning']);
        const c = byTestId(doc, 'sonic-start-continue')!;
        expect(c.textContent).toContain(`Continue: ${titleOf('rings-first')}`);
        expect(c.textContent).toContain(`${placeOf('rings-first')}, in progress`);
        expect(c.className).toContain('primary');
        const before = JSON.stringify(storeMod.allProgress(store));
        const b = byTestId(doc, 'sonic-start-beginning')!;
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
        const { s } = open({ store: again });
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
        expect(doc.activeElement).toBe(byTestId(doc, 'sonic-start-beginning'));
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
/** A fresh page as startSonic opens it: the screen shown, the focus on its h1. */
function shown(o: Parameters<typeof open>[0] = {}): Screen {
    const x = open(o);
    x.s.show();
    return x;
}

/** The stops of a fresh screen with no progress and the volume part closed, in the page's order. */
const STOPS = [
    ...['#sonic-sec-start', '#sonic-sec-headphones', '#sonic-sec-lessons', '#sonic-sec-settings'],
    'sonic-start-beginning', 'sonic-path-full', 'sonic-path-fast',
    'sonic-hp-left', 'sonic-hp-right', 'sonic-hp-behind',
    ...lessonPaths().full.map((id) => `lesson:${id}`), 'sonic-reset',
    // v13-int step 3: sound from above and below after the target height note; the sound panel and the attitude display after the frame;
    // lane sonic-beacon: the target hum showing the way after sound from above and below
    'sonic-theme', 'sonic-calm', 'sonic-polarity', 'sonic-rate', 'sonic-captions', 'sonic-sr', 'sonic-motor', 'sonic-motor-level', 'sonic-height-target', 'sonic-height-direction', 'sonic-beacon', 'sonic-frame', 'sonic-look-soundPanel', 'sonic-look-attitude', 'sonic-key-hints', 'summary',
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
        expect(doc.activeElement?.id).toBe('sonic-h1');
        // nothing said before a press: the browser speaks only after one
        expect(engine.said).toEqual([]);
        expect(setup.audio.ac).toBeNull();
        const first = doc.key('ArrowDown');
        expect(first.defaultPrevented).toBe(true);
        expect(setup.audio.ac).not.toBeNull();
        expect(engine.said.map((x) => [x.line.key, x.interrupt])).toEqual([['sonic.say.listHelp', true], ['sonic.say.text', false]]);
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
        expect(at('sonic-start-beginning')).toBe(`Start. Start the course from the beginning. Lesson 1 of ${SHIPPED_LESSON_IDS.length}: ${titleOf('ears-headphones')}. Item 1 of 3.`);
        expect(at('sonic-path-fast')).toMatch(/^Path: Fast path, off\. .+\. Item 3 of 3\.$/);
        expect(at('sonic-hp-left')).toBe('Check your headphones. Play a sound on the left. Item 1 of 3.');
        // a lesson says its own place and state, not an item number
        expect(at('lesson:ears-headphones')).toBe(`Lessons. ${titleOf('ears-headphones')}. Lesson 1 of ${SHIPPED_LESSON_IDS.length}, not started, Fast path`);
        expect(at('lesson:rings-first')).toBe(`${titleOf('rings-first')}. ${placeOf('rings-first')}, not started, Fast path`);
        // the settings' stops: the screen's own count, 11 before v13-int's three switches (step 3), 15 before lane sonic-beacon's switch
        const settings = STOPS.slice(STOPS.indexOf('sonic-theme'), STOPS.indexOf('summary') + 1).length;
        expect(settings).toBe(16);
        expect(at('sonic-theme')).toBe(`Settings. Sound theme: Soft. Item 1 of ${settings}.`);
        expect(at('sonic-motor-level')).toBe(`Motor volume: 0 dB. Item 8 of ${settings}.`);
        expect(at('sonic-height-target')).toBe(`Target height note: on. Item 9 of ${settings}.`);
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
        expect(lastHeard(engine)).toEqual({ text: 'Check your headphones. Play a sound on the right. Item 2 of 3.', interrupt: true });
        doc.key('ArrowDown');
        expect(stopName(doc)).toBe('sonic-hp-behind');
        // the navigation's Lessons link puts the focus on the section's heading: said, and Down goes to its first lesson
        doc.querySelector('[href="#sonic-sec-lessons"]')!.click();
        expect(doc.activeElement?.id).toBe('sonic-h-lessons');
        expect(lastHeard(engine).text).toBe('Lessons');
        doc.key('ArrowDown');
        expect(stopName(doc)).toBe(`lesson:${lessonPaths().full[0]}`);
        doc.key('ArrowUp');
        expect(stopName(doc)).toBe('sonic-hp-behind');
        // Up from a heading is the stop just before it
        doc.querySelector('[href="#sonic-sec-lessons"]')!.click();
        doc.key('ArrowUp');
        expect(stopName(doc)).toBe('sonic-hp-behind');
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

    it('the volume and pitch sliders are stops only while their part is open; the path\'s two choices go to each other with Left and Right', () => {
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
        // the path
        byTestId(doc, 'sonic-path-full')!.focus();
        doc.key('ArrowRight');
        expect(setup.prefs.path).toBe('fast');
        expect(focusedId(doc)).toBe('sonic-path-fast');
        expect(lastHeard(engine).text).toMatch(/^Path: Fast path, on\. /);
        doc.key('ArrowLeft');
        expect(setup.prefs.path).toBe('full');
        expect(focusedId(doc)).toBe('sonic-path-full');
        s.dispose();
    });

    it('Escape goes back: from anywhere to the first of the Start buttons on a page of its own (and nothing more from there); over a flight it closes the screen', () => {
        const { s, engine } = shown({ progress: { 'hover-height': P('hover-height', { attempts: 1 }) }, current: 'hover-height' });
        doc.key('ArrowDown');
        byTestId(doc, 'sonic-motor-level')!.focus();
        const esc = doc.key('Escape');
        expect(esc.defaultPrevented).toBe(true);
        expect(focusedId(doc)).toBe('sonic-start-continue');
        expect(lastHeard(engine).text).toBe(`Start. Continue: ${titleOf('hover-height')}. ${placeOf('hover-height')}, in progress. Item 1 of 4.`);
        const again = doc.key('Escape');
        expect(again.defaultPrevented).toBe(false);
        expect(focusedId(doc)).toBe('sonic-start-continue');
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
        expect(heard(engine).slice(-2)).toEqual(['Your progress is reset. Every lesson is new again.', `Start. Start the course from the beginning. Lesson 1 of ${SHIPPED_LESSON_IDS.length}: ${titleOf('ears-headphones')}. Item 1 of 3.`]);
        s.dispose();
    });

    it('control: with "my screen reader speaks" the list leaves every key to the page and the voice says no stop and no value (the reader reads the focus); over a flight the lines go through the page\'s voice, not the engine', () => {
        const { s, engine, setup } = shown();
        expect(setup.update({ selfVoice: false }).ok).toBe(true);
        const k = doc.key('ArrowDown');
        expect(k.defaultPrevented).toBe(false);
        expect(doc.activeElement?.id).toBe('sonic-h1');
        byTestId(doc, 'sonic-theme')!.focus();
        expect(doc.key('ArrowRight').defaultPrevented).toBe(false);
        byTestId(doc, 'sonic-calm')!.click();
        expect(engine.said).toEqual([]);
        // Escape still goes back with a screen reader
        expect(doc.key('Escape').defaultPrevented).toBe(true);
        expect(focusedId(doc)).toBe('sonic-start-beginning');
        s.dispose();
        // over a flight: bind's voice (the lesson's speech queue), the engine untouched
        const over = shown({ overFlight: true });
        const page: { line: SpeechLine; interrupt: boolean }[] = [];
        over.setup.audio.start();
        over.s.bind({ onStart: () => undefined, onClose: () => undefined, say: async (line, interrupt) => void page.push({ line, interrupt }) });
        over.s.show('settings');
        expect(page.map((x) => x.line.params?.text ?? x.line.key)).toEqual(['Settings']);
        doc.key('ArrowDown');
        expect(page.at(-1)?.line.params?.text).toBe('Sound theme: Soft. Item 1 of 16.');
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
        if (o.selfVoice === false) expect(setup.update({ selfVoice: false }).ok).toBe(true);
        const s = new screenMod.StartScreen({ setup, locale: 'en', request: modelMod.parseSonicParam('start'), progress: () => storeMod.allProgress(store), current: () => storeMod.currentLesson(store), onStart: () => undefined }, doc.body as unknown as HTMLElement);
        s.show();
        return { s, setup, store, engine: pe, started: [], closed: { n: 0 }, doc, pe };
    }
    const DIRECTION_WHAT = EN.say('menu.setting.height-direction-what').replace(/\.$/, '');
    const BEACON_WHAT = EN.say('menu.setting.beacon-what').replace(/\.$/, '');
    const SWITCHES = [
        { id: 'sonic-height-direction', name: EN.say('menu.setting.height-direction'), n: 10, tail: `. ${DIRECTION_WHAT}` },
        // lane sonic-beacon: the package's words for the target hum showing the way, its description after the value
        { id: 'sonic-beacon', name: EN.say('menu.setting.beacon'), n: 11, tail: `. ${BEACON_WHAT}` },
        { id: 'sonic-look-soundPanel', name: 'Sound panel: see every sound', n: 13, tail: '' },
        { id: 'sonic-look-attitude', name: 'Horizon and height display', n: 14, tail: '' }
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
            expect(lastHeard(engine), sw.id).toEqual({ text: `Settings. ${sw.name}: on${sw.tail}. Item ${sw.n} of 16.`, interrupt: true });
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
        expect(lastHeard(again.engine).text).toBe(`Settings. Sound from above and below: off. ${DIRECTION_WHAT}. Item 10 of 16.`);
        byTestId(doc, 'sonic-beacon')!.focus();
        expect(lastHeard(again.engine).text).toBe(`Target hum shows the way: off. ${BEACON_WHAT}. Item 11 of 16.`);
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
        byTestId(doc, 'sonic-start-beginning')!.focus();
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
        byTestId(doc, 'sonic-start-beginning')!.focus();
        const before = doc.activeElement;
        doc.key('ArrowDown');
        expect(doc.activeElement).not.toBe(before);
        doc.key('Escape');
        expect(closed.n).toBe(1);
        s.dispose();
    });

    it('F4: hide() takes the focus off the screen\'s control at once, so the flight page finds the body and puts the focus on its region (feature.ts focusFlight); control: a focus outside the screen is left alone', () => {
        const { s } = shown({ overFlight: true });
        byTestId(doc, 'sonic-start-beginning')!.focus();
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
