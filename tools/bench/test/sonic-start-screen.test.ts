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
function open(o: { locale?: Locale; progress?: Record<string, LessonProgress>; current?: string | null; overFlight?: boolean; store?: ReturnType<typeof mkStore> } = {}): Screen {
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
        request: modelMod.parseSonicParam('start'),
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
