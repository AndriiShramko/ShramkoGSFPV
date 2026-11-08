// v0.13 Fly by Sound, lane v13-host stage C (docs/wip/v13-host.md "Stage C"): the mode's start screen itself (apps/fly/src/sonic/
// start-screen.ts) on a small stand-in for the DOM (tools/bench/test/sonic-fake-dom.ts), with the real sound setup (SonicSetup on an
// in-memory prefs store, a fake engine that records what it is asked to say). The real page is the page proof's
// (tools/bench/src/sonic-v13-page.ts).
//  - C1 (M41-1): the pause menu's item opens this screen (sonic-optin.test.ts); the page about the mode stays linked from it.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
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
        ...(o.overFlight ? { onClose: () => void closed.n++ } : {})
    }, doc.body as unknown as HTMLElement);
    return { s, setup, store, engine, started, closed, doc };
}

const byTestId = (d: FakeDocument, id: string): FakeElement | null => d.querySelector(`[data-testid="${id}"]`);

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
