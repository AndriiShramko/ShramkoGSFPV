// v0.12 Fly by Sound, lane v12-flight step 7 (docs/wip/v12-plan.md 2.2 and 4.2): the engine in the page, on fakes.
//  - SonicAudio makes ONE AudioContext inside the press that starts the mode (and unlocks speech there), starts the
//    engine on it once, survives a browser with no Web Audio, applies the pilot's settings (another theme swaps the
//    theme) and closes what it made;
//  - SonicSetup checks a change of settings as a whole before it touches anything (a bad one changes nothing and says
//    why), applies it to the engine and the captions, and saves it in the prefs collection 'sonic'; the captions are
//    read by a screen reader exactly when "my screen reader speaks" is on;
//  - the saved progress is not rewritten when only its timestamp moved;
//  - the mode hands the engine each frame (its default input, or a lesson's), not while a replay drives it;
//  - the bridge repeats the last line, interrupting;
//  - the motor sound plugs into the engine's input node on the engine's context (not its own), plays by default in the
//    mode since v0.13 (M41-16; the motor bus it goes into: sonic-motor.test.ts), is silent when the settings turn it off,
//    and never suspends or closes a context that is not its own (control: its own context is closed as before).
import { describe, expect, it, vi } from 'vitest';
import { CuePlanner, defaultPrefs, getBuiltinTheme, getLesson } from '../../../packages/sonic-fpv/src';
import type { AudioContextLike, FlightSample, LessonLayers, Locale, SonicFrameInput, SonicPrefs, SpeechLine, ThemeDef } from '../../../packages/sonic-fpv/src';
import { SonicAudio } from '../../../apps/fly/src/sonic/audio';
import type { AudioDeps, PageEngine } from '../../../apps/fly/src/sonic/audio';
import { SonicSetup, captionMode } from '../../../apps/fly/src/sonic/entry';
import type { CaptionSink } from '../../../apps/fly/src/sonic/entry';
import { followVisit } from '../../../apps/fly/src/sonic/address';
import type { AddressWriter } from '../../../apps/fly/src/sonic/address';
import { pageLink, shareLesson } from '../../../apps/fly/src/sonic/mode-keys';
import { lessonQuery } from '../../../packages/scenes/src/sonic-link';
import { PageRuntime } from '../../../apps/fly/src/sonic/runtime';
import { allProgress, currentLesson, loadSonicPrefs, saveProgress, savedProgress, saveSonicPrefs, setCurrentLesson } from '../../../apps/fly/src/sonic/store';
import { SonicBridge, SILENT_LAYERS } from '../../../apps/fly/src/sonic/bridge';
import { SonicMode } from '../../../apps/fly/src/sonic/mode';
import { MotorSound, motorMix } from '../../../apps/fly/src/audio/motor-sound';
import type { AudioLike, NodeLike } from '../../../apps/fly/src/audio/motor-sound';
import { mkStore } from '../../../packages/prefs/test/helpers';

// ------------------------------------------------------------------ fakes

class FakeEngine {
    state: PageEngine['state'] = 'idle';
    started: unknown[] = [];
    theme: ThemeDef | null = null;
    prefs: SonicPrefs | null = null;
    locale: Locale | null = null;
    layers: LessonLayers[] = [];
    frames: SonicFrameInput[] = [];
    said: { line: SpeechLine; interrupt: boolean }[] = [];
    closed = false;
    onSpeech: ((line: SpeechLine, text: string) => void) | null = null;
    auxInput: object | null = null;
    constructor(readonly opts: Parameters<AudioDeps['createEngine']>[0]) {
        this.theme = opts.theme;
        this.prefs = opts.prefs;
    }
    async start(ac: AudioContextLike): Promise<void> { this.started.push(ac); this.state = 'running'; }
    async suspend(): Promise<void> { this.state = 'suspended'; }
    async resume(): Promise<void> { this.state = 'running'; }
    async close(): Promise<void> { this.closed = true; this.state = 'closed'; }
    setTheme(t: ThemeDef): void { this.theme = t; }
    setPrefs(p: SonicPrefs): void { this.prefs = p; }
    setLocale(l: Locale): void { this.locale = l; }
    setLayers(l: LessonLayers): void { this.layers.push(l); }
    update(i: SonicFrameInput): void { this.frames.push(i); }
    cue(): void { /* not under test */ }
    async say(line: SpeechLine, o?: { interrupt?: boolean }): Promise<void> { this.said.push({ line, interrupt: o?.interrupt === true }); this.opts.caption('text of ' + line.key, line); }
    activeCues(): readonly never[] { return []; }
}

function fakeDeps(o: { audio?: boolean } = {}): { deps: AudioDeps; contexts: (AudioContextLike & { closed: boolean })[]; unlocked: { n: number }; engines: FakeEngine[] } {
    const contexts: (AudioContextLike & { closed: boolean })[] = [];
    const unlocked = { n: 0 };
    const engines: FakeEngine[] = [];
    const deps: AudioDeps = {
        makeContext() {
            if (o.audio === false) return null;
            const c = { currentTime: 0, sampleRate: 48000, state: 'suspended', closed: false, async close() { this.closed = true; } };
            contexts.push(c as never);
            return c as never;
        },
        unlockSpeech() { unlocked.n++; },
        createEngine(opts) { const e = new FakeEngine(opts); engines.push(e); return e as unknown as PageEngine; }
    };
    return { deps, contexts, unlocked, engines };
}

class Sink implements CaptionSink {
    lines: string[] = [];
    modes: { visible: boolean; live: boolean }[] = [];
    add(text: string): void { this.lines.push(text); }
    configure(m: { visible: boolean; live: boolean }): void { this.modes.push(m); }
}

// ------------------------------------------------------------------ SonicAudio

describe('SonicAudio: one context from one press', () => {
    it('start() makes one AudioContext, unlocks speech in the same call, starts the engine on it once; a second call is the same promise', async () => {
        const { deps, contexts, unlocked, engines } = fakeDeps();
        const a = new SonicAudio({ locale: 'pl', deps });
        const p1 = a.start();
        // everything that needs the activation has happened before the first await
        expect(contexts).toHaveLength(1);
        expect(unlocked.n).toBe(1);
        const p2 = a.start();
        expect(p2).toBe(p1);
        await p1;
        expect(contexts).toHaveLength(1);
        expect(unlocked.n).toBe(1);
        expect(engines[0]!.started).toEqual([contexts[0]]);
        expect(a.running).toBe(true);
        expect(a.ac).toBe(contexts[0]);
        expect(a.available).toBe(true);
    });

    it('a browser with no Web Audio: nothing throws, available is false, the engine is never started', async () => {
        const { deps, contexts, engines } = fakeDeps({ audio: false });
        const a = new SonicAudio({ locale: 'en', deps });
        await a.start();
        expect(contexts).toHaveLength(0);
        expect(engines[0]!.started).toHaveLength(0);
        expect(a.available).toBe(false);
        expect(a.running).toBe(false);
    });

    it('an engine that fails to start leaves the page running without sound', async () => {
        const { deps, engines } = fakeDeps();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const a = new SonicAudio({ locale: 'en', deps });
        engines[0]!.start = async () => { throw new Error('no audio device'); };
        await a.start();
        expect(a.available).toBe(false);
        warn.mockRestore();
    });

    it('starts with the pilot\'s theme and language; another theme swaps the theme, a language the engine\'s phrases', () => {
        const { deps, engines } = fakeDeps();
        const a = new SonicAudio({ locale: 'ru', prefs: { ...defaultPrefs(), theme: 'clear' }, deps });
        const e = engines[0]!;
        expect(e.opts.locale).toBe('ru');
        expect(e.theme!.id).toBe('clear');
        a.setPrefs({ ...a.prefs, theme: 'race' });
        expect(e.theme!.id).toBe('race');
        expect(a.theme).toBe(getBuiltinTheme('race'));
        const before = e.theme;
        a.setPrefs({ ...a.prefs, calm: true });
        expect(e.theme).toBe(before); // calm is the planner's: the same theme object
        expect(e.prefs!.calm).toBe(true);
        a.setLocale('pl');
        expect(e.locale).toBe('pl');
    });

    it('close() stops the engine and closes the context it made', async () => {
        const { deps, contexts, engines } = fakeDeps();
        const a = new SonicAudio({ locale: 'en', deps });
        await a.start();
        await a.close();
        expect(engines[0]!.closed).toBe(true);
        expect(contexts[0]!.closed).toBe(true);
        expect(a.ac).toBeNull();
    });

    it('the engine\'s spoken lines reach the captions through onCaption', async () => {
        const { deps, engines } = fakeDeps();
        const seen: string[] = [];
        new SonicAudio({ locale: 'en', deps, onCaption: (text) => seen.push(text) });
        await engines[0]!.say({ key: 'fly.go' });
        expect(seen).toEqual(['text of fly.go']);
    });
});

// ------------------------------------------------------------------ SonicSetup: settings, captions, saving

describe('SonicSetup: the pilot\'s sound settings', () => {
    function setup(prefs?: Partial<SonicPrefs>) {
        const host = mkStore();
        if (prefs) saveSonicPrefs(host, { ...defaultPrefs(), ...prefs });
        const f = fakeDeps();
        const captions = new Sink();
        const s = new SonicSetup(host, 'en', captions, { deps: f.deps });
        return { host, s, captions, ...f };
    }

    it('the defaults when nothing is saved: the soft theme, the motor on (M41-16, v0.13), captions on, the engine speaks, the captions are not read', () => {
        const { s, captions } = setup();
        expect(s.prefs).toEqual(defaultPrefs());
        expect(s.prefs.motorSound).toBe(true);
        expect(captions.modes).toEqual([{ visible: true, live: false }]);
    });

    it('saved settings are the ones the engine starts with', () => {
        const { s, engines } = setup({ theme: 'race', speechRate: 1.5, captions: false, selfVoice: false });
        expect(s.prefs.theme).toBe('race');
        expect(engines[0]!.theme!.id).toBe('race');
        expect(captionModeOf(s.prefs)).toEqual({ visible: false, live: true });
    });

    it('update(): checked, applied to the engine and the captions at once, and saved (a new store reads it back)', () => {
        const { host, s, engines, captions } = setup();
        const r = s.update({ selfVoice: false, speechRate: 1.25, motorSound: true });
        expect(r).toEqual({ ok: true });
        expect(engines[0]!.prefs).toMatchObject({ selfVoice: false, speechRate: 1.25, motorSound: true });
        expect(captions.modes.at(-1)).toEqual({ visible: true, live: true });
        expect(loadSonicPrefs(host)).toMatchObject({ selfVoice: false, speechRate: 1.25, motorSound: true });
        expect(loadSonicPrefs(host)).toEqual(s.prefs);
    });

    it('control: a value out of range changes nothing (engine, captions, store) and says which field', () => {
        const { host, s, engines, captions } = setup();
        const stored = JSON.stringify(host.collection('sonic'));
        const modes = captions.modes.length;
        const r = s.update({ speechRate: 5 });
        expect(r.ok).toBe(false);
        expect((r as { reasons: string[] }).reasons.join(' ')).toMatch(/speechRate/);
        expect(s.prefs.speechRate).toBe(1);
        expect(engines[0]!.prefs!.speechRate).toBe(1);
        expect(captions.modes).toHaveLength(modes);
        expect(JSON.stringify(host.collection('sonic'))).toBe(stored);
    });

    it('a stored document with a bad field is repaired field by field, not thrown away', () => {
        const host = mkStore();
        host.updateCollection('sonic', (d) => { d.prefs = { format: 'shramko-sonic-prefs/1', theme: 'clear', speechRate: 99, captions: false }; });
        const p = loadSonicPrefs(host);
        expect(p.theme).toBe('clear');
        expect(p.captions).toBe(false);
        expect(p.speechRate).toBe(1); // the bad one takes its default
    });

    it('captions are read by a screen reader exactly when the engine does not speak', () => {
        expect(captionMode({ ...defaultPrefs(), selfVoice: true, captions: true })).toEqual({ visible: true, live: false });
        expect(captionMode({ ...defaultPrefs(), selfVoice: false, captions: true })).toEqual({ visible: true, live: true });
        expect(captionMode({ ...defaultPrefs(), selfVoice: false, captions: false })).toEqual({ visible: false, live: true });
        expect(captionMode({ ...defaultPrefs(), selfVoice: true, captions: false })).toEqual({ visible: false, live: false });
    });

    // v12-optin: the sound settings of a shared lesson link are in force for the visit and never saved unless kept
    it('setVisit(): a link\'s settings play at once (engine) and are not saved; the pilot\'s own settings stay in the store', () => {
        const { host, s, engines } = setup({ theme: 'race', speechRate: 1.5 });
        const stored = JSON.stringify(host.collection('sonic'));
        expect(s.setVisit({ theme: 'clear', calm: true, heightPolarity: 'up-lower', listenerFrame: 'body' })).toEqual({ theme: 'clear', calm: true, heightPolarity: 'up-lower', listenerFrame: 'body' });
        expect(s.prefs).toMatchObject({ theme: 'clear', calm: true, heightPolarity: 'up-lower', listenerFrame: 'body', speechRate: 1.5 });
        expect(engines[0]!.theme!.id).toBe('clear');
        expect(engines[0]!.prefs).toMatchObject({ calm: true, heightPolarity: 'up-lower' });
        expect(JSON.stringify(host.collection('sonic'))).toBe(stored);
        expect(loadSonicPrefs(host).theme).toBe('race');
        expect(s.visit).toEqual({ theme: 'clear', calm: true, heightPolarity: 'up-lower', listenerFrame: 'body' });
    });

    it('a setting the pilot changes leaves the visit and is saved; keepVisit() saves the rest; the others stay his own', () => {
        const { host, s } = setup({ speechRate: 1.5 });
        s.setVisit({ theme: 'clear', calm: true });
        expect(s.update({ calm: false })).toEqual({ ok: true });
        expect(s.visit).toEqual({ theme: 'clear' });
        expect(s.prefs).toMatchObject({ theme: 'clear', calm: false });
        expect(loadSonicPrefs(host)).toMatchObject({ theme: 'soft', calm: false, speechRate: 1.5 });
        // an unrelated change keeps the visit as it is and saves no setting of it
        expect(s.update({ speechRate: 1.25 })).toEqual({ ok: true });
        expect(s.visit).toEqual({ theme: 'clear' });
        expect(loadSonicPrefs(host).theme).toBe('soft');
        s.keepVisit();
        expect(s.visit).toEqual({});
        expect(loadSonicPrefs(host)).toMatchObject({ theme: 'clear', calm: false, speechRate: 1.25 });
        expect(s.prefs).toEqual(loadSonicPrefs(host));
    });

    it('control: a theme this release does not have, or a bad value, is left out on its own; the rest of the link stands', () => {
        const { s, engines } = setup();
        expect(s.setVisit({ theme: 'disco', calm: true })).toEqual({ calm: true });
        expect(s.prefs.theme).toBe('soft');
        expect(engines[0]!.theme!.id).toBe('soft');
        expect(s.setVisit({ heightPolarity: 'sideways' as never, listenerFrame: 'body' })).toEqual({ listenerFrame: 'body' });
        expect(s.prefs.heightPolarity).toBe('up-higher');
        expect(s.prefs.calm).toBe(false); // the earlier visit is replaced, not added to
    });

    // review R2: a value equal to his own changes nothing and is no part of the visit; "Use my own settings"; what stands is told
    it('setVisit(): a value equal to the pilot\'s own saved one is left out (after Keep a reload of the same link stands for nothing)', () => {
        const { s } = setup({ theme: 'clear', calm: true });
        expect(s.setVisit({ theme: 'clear', calm: true, heightPolarity: 'up-lower' })).toEqual({ heightPolarity: 'up-lower' });
        expect(s.visit).toEqual({ heightPolarity: 'up-lower' });
        expect(s.setVisit({ theme: 'clear', calm: true })).toEqual({});
        // control: the same values on a pilot whose own differ stand
        const other = setup();
        expect(other.s.setVisit({ theme: 'clear', calm: true })).toEqual({ theme: 'clear', calm: true });
    });

    it('dropVisit() ("Use my own settings"): the visit is over, his own saved settings play again, nothing is saved', () => {
        const { host, s, engines } = setup({ theme: 'race' });
        s.setVisit({ theme: 'clear', heightPolarity: 'up-lower' });
        const stored = JSON.stringify(host.collection('sonic'));
        s.dropVisit();
        expect(s.visit).toEqual({});
        expect(s.prefs).toMatchObject({ theme: 'race', heightPolarity: 'up-higher' });
        expect(engines[0]!.theme!.id).toBe('race');
        expect(JSON.stringify(host.collection('sonic'))).toBe(stored);
    });

    it('onVisit hears what stands each time it changes (a link set, a setting changed, Keep, "Use my own settings"), and not for anything else', () => {
        const { s } = setup();
        const heard: unknown[] = [];
        s.onVisit = (v) => heard.push(v);
        s.setVisit({ theme: 'clear', calm: true, heightPolarity: 'up-lower' });
        s.update({ speechRate: 1.5 }); // not a setting of the visit: nothing to tell
        s.update({ calm: false });
        s.keepVisit();
        s.dropVisit(); // nothing stands any more: nothing to tell
        s.setVisit({ listenerFrame: 'body' });
        s.dropVisit();
        expect(heard).toEqual([{ theme: 'clear', calm: true, heightPolarity: 'up-lower' }, { theme: 'clear', heightPolarity: 'up-lower' }, {}, { listenerFrame: 'body' }, {}]);
    });
});

// review R2: a page reloaded (or a tab restored) reads the link's sound from its address again; the address carries only what stands
describe('a shared link\'s sound and the page\'s address (sonic/address.ts followVisit, lessons.ts url)', () => {
    /** One profile (one store) and its address bar; load() is a page load: a new setup that reads the address, as sonic/start.ts does. */
    function profile(address: string, write?: AddressWriter) {
        const host = mkStore();
        const bar = { address };
        const own: AddressWriter = (next) => { bar.address = next(bar.address); };
        const load = (): SonicSetup => {
            const s = new SonicSetup(host, 'en', new Sink(), { deps: fakeDeps().deps });
            followVisit(s, new URLSearchParams(bar.address), write ?? own);
            return s;
        };
        return { host, bar, load };
    }

    it('the reviewer\'s probe: link, Keep, Calm mode off, reload: no visit and no note, his saved value in force; the address lost the link\'s sound', () => {
        const { bar, load } = profile('sonic=hover-height&st=clear&sc=1&nowarn=1');
        const a = load();
        expect(a.visit).toEqual({ theme: 'clear', calm: true });
        expect(bar.address).toBe('sonic=hover-height&st=clear&sc=1&nowarn=1'); // what stands is what the link says: not rewritten
        a.keepVisit();
        expect(bar.address).toBe('sonic=hover-height&nowarn=1');
        a.update({ calm: false });
        const b = load();
        expect(b.visit).toEqual({});
        expect(b.prefs).toMatchObject({ theme: 'clear', calm: false });
    });

    it('a setting changed without Keep leaves the address, the rest of the link stands after a reload; "Use my own settings" takes all of it out', () => {
        const { bar, load } = profile('sonic=hover-height&st=clear&sc=1&sh=up-lower');
        const a = load();
        a.update({ heightPolarity: 'up-higher' });
        expect(bar.address).toBe('sonic=hover-height&st=clear&sc=1');
        const b = load();
        expect(b.visit).toEqual({ theme: 'clear', calm: true });
        expect(b.prefs.heightPolarity).toBe('up-higher'); // the reversed height tone never comes back
        b.dropVisit();
        expect(bar.address).toBe('sonic=hover-height');
        const c = load();
        expect(c.visit).toEqual({});
        expect(c.prefs).toMatchObject({ theme: 'soft', calm: false, heightPolarity: 'up-higher' });
    });

    it('a link setting equal to his own, or a theme this release lacks, leaves the address at the load (so nothing names it after a reload)', () => {
        const { host, bar, load } = profile('sonic=start&st=disco&sc=1&sf=body');
        saveSonicPrefs(host, { ...defaultPrefs(), listenerFrame: 'body' });
        const a = load();
        expect(a.visit).toEqual({ calm: true });
        expect(bar.address).toBe('sonic=start&sc=1');
    });

    it('a lesson that opens writes its own link: its scan only for the scan lesson, the sound that stands, the rest of the query kept', () => {
        const garden = getLesson('free-garden');
        const hover = getLesson('hover-height');
        const from = 'sonic=free-garden&scene=7a475d38&sz=5&st=clear&sc=1&nowarn=1';
        expect(lessonQuery(from, pageLink(hover, { theme: 'clear', calm: true }))).toBe('sonic=hover-height&st=clear&sc=1&nowarn=1');
        expect(lessonQuery(from, pageLink(hover, {}))).toBe('sonic=hover-height&nowarn=1');
        expect(lessonQuery('sonic=hover-height&nowarn=1', pageLink(garden, {}))).toBe('sonic=free-garden&nowarn=1&scene=7a475d38&sz=5');
        // the pilot's own settings are never written as a visit (a reload would name them in the note)
        expect(pageLink(hover, {}).sound).toEqual({});
    });

    it('control: an address that is never rewritten (as before review R2) brings Calm mode back after Keep and a change, in the same probe', () => {
        const { load } = profile('sonic=hover-height&st=clear&sc=1', () => undefined);
        const a = load();
        a.keepVisit();
        a.update({ calm: false });
        const b = load();
        expect(b.visit).toEqual({ calm: true });
        expect(b.prefs.calm).toBe(true);
    });
});

// review R1: a refused clipboard must still give the link to a blind pilot alone, whatever his voice and captions are set to
describe('the mode\'s Share with a refused clipboard (mode-keys.ts shareLesson, wired as sonic/feature.ts wires it)', () => {
    const LINK = 'https://gsfpv.flyreelstudio.eu/fly/?sonic=hover-height&st=clear';
    const SETUPS: Record<string, Partial<SonicPrefs>> = {
        'the app speaks, captions on (the defaults)': {},
        'the app speaks, captions off': { captions: false },
        'my screen reader speaks': { selfVoice: false }
    };
    /** The setup a pilot has, its engine and captions, and the mode's Share on it with this copier and entry. */
    async function share(prefs: Partial<SonicPrefs>, copier: () => Promise<boolean>, via: 'key' | 'button' = 'key', lesson: string | null = 'Hold your height') {
        const host = mkStore();
        saveSonicPrefs(host, { ...defaultPrefs(), ...prefs });
        const f = fakeDeps();
        const sink = new Sink();
        const setup = new SonicSetup(host, 'en', sink, { deps: f.deps });
        const fields: { url: string; copied: boolean }[] = [];
        const copied = await shareLesson({ url: LINK, via, lesson, copyKeys: 'Control and C', copy: copier, field: (url, c) => fields.push({ url, copied: c }), say: (line) => setup.audio.engine.say(line, { interrupt: true }) });
        return { copied, fields, said: f.engines[0]!.said, sink };
    }

    for (const [name, prefs] of Object.entries(SETUPS)) {
        it(`${name}: the link goes into the focused, selected field; the line says so with the lesson's name and the keys; the captions never carry the link`, async () => {
            const r = await share(prefs, async () => false);
            expect(r.copied).toBe(false);
            expect(r.fields).toEqual([{ url: LINK, copied: false }]);
            expect(r.said).toEqual([{ line: { key: 'sonic.say.linkSelected', params: { lesson: 'Hold your height', copy: 'Control and C' } }, interrupt: true }]);
            expect(r.sink.lines.join(' ')).not.toContain('sonic=');
            // the three setups differ where the captions go (shown, read by a reader, neither), and the link reaches the pilot in each
            expect(r.sink.modes[0]).toEqual(captionMode({ ...defaultPrefs(), ...prefs }));
        });
    }

    it('on the start screen (no lesson) it names Fly by Sound instead of a lesson', async () => {
        const r = await share({}, async () => false, 'key', null);
        expect(r.said.map((s) => s.line)).toEqual([{ key: 'sonic.say.linkSelectedStart', params: { copy: 'Control and C' } }]);
        expect(r.fields).toHaveLength(1);
    });

    it('control: a clipboard that takes it says it is copied and L opens no field; a visible Share (a helper, a phone) shows the field anyway', async () => {
        const key = await share({}, async () => true);
        expect(key.copied).toBe(true);
        expect(key.fields).toEqual([]);
        expect(key.said.map((s) => s.line)).toEqual([{ key: 'sonic.say.linkCopied' }]);
        const button = await share({}, async () => true, 'button');
        expect(button.fields).toEqual([{ url: LINK, copied: true }]);
    });
});

const captionModeOf = captionMode;

// ------------------------------------------------------------------ the saved state

describe('the saved lesson progress', () => {
    const p = (o: Record<string, unknown> = {}) => ({ lessonId: 'walls-hall', version: 1, attempts: 2, successes: 1, blocksPassed: 0, passed: false, bestTimeMs: null, lastAt: '2026-11-07T10:00:00.000Z', ...o });

    it('is saved, read back, listed, and not rewritten when only its timestamp moved', () => {
        const host = mkStore();
        const changes: string[] = [];
        host.onChange((c) => changes.push(c.id));
        saveProgress(host, p());
        saveProgress(host, p({ lastAt: '2026-11-07T10:05:00.000Z' }));
        expect(changes).toEqual(['collection.sonic']);
        saveProgress(host, p({ attempts: 3 }));
        expect(changes).toHaveLength(2);
        expect(savedProgress(host, 'walls-hall')).toMatchObject({ attempts: 3 });
        expect(savedProgress(host, 'corridor')).toBeNull();
        expect(Object.keys(allProgress(host))).toEqual(['walls-hall']);
    });

    it('the lesson the pilot is on is saved and cleared', () => {
        const host = mkStore();
        setCurrentLesson(host, 'rings-first');
        expect(currentLesson(host)).toBe('rings-first');
        setCurrentLesson(host, null);
        expect(currentLesson(host)).toBeNull();
    });
});

// ------------------------------------------------------------------ the mode and the bridge

const SAMPLE: FlightSample = { t: 100, tick: 100, pos: [0, 1.5, 0], vel: [0, 0, 0], quat: [1, 0, 0, 0], rate: [0, 0, 0], yawDeg: 0, pitchDeg: 0, rollDeg: 0, sticks: [0, 0, 0, 0], armed: false, touched: false, paused: false };

function modeWith(engine: FakeEngine | null) {
    const mode = new SonicMode({
        events: { emit() { /* no listeners */ }, on() { return () => undefined; } } as never,
        prefs: { setSession: () => ({ ok: true }) as never, clearSession: () => undefined },
        session: () => ({ paused: false, replaying: false, runner: undefined, shownSim: undefined }) as never,
        setLesson: () => undefined,
        onKey: () => () => undefined,
        note: () => undefined
    });
    if (engine) mode.engine = engine as never;
    return mode;
}

describe('the engine hears the mode\'s frames', () => {
    it('hear(): the default input is the flight in its world with the lesson\'s floor; a lesson\'s own input wins', () => {
        const e = new FakeEngine({ theme: getBuiltinTheme('soft'), prefs: defaultPrefs(), locale: 'en', caption: () => undefined });
        const mode = modeWith(e);
        mode.enter({ floorY: 2 });
        mode.hear(SAMPLE);
        expect(e.frames).toHaveLength(1);
        expect(e.frames[0]).toMatchObject({ sample: SAMPLE, world: null, target: null, floorY: 2 });
        const own: SonicFrameInput = { sample: SAMPLE, world: null, target: null, floorY: 0 };
        mode.hear(SAMPLE, own);
        expect(e.frames[1]).toBe(own);
    });

    it('hear() (lane sonic-beacon): the frame carries beaconTarget() of the runner as `beacon` beside its target(); a runner without the method and no runner give null', () => {
        const e = new FakeEngine({ theme: getBuiltinTheme('soft'), prefs: defaultPrefs(), locale: 'en', caption: () => undefined });
        const mode = modeWith(e);
        mode.enter({ floorY: 0 });
        const gate = { id: 'g1', kind: 'ring', pos: [0, 1.5, -10], size: [2, 2, 0.2], order: 1 } as const;
        const point = { id: 'beacon:p3', kind: 'zone', pos: [4, 1.5, -6], size: [1, 1, 1], order: null } as const;
        const bridge = (mode as unknown as { bridge: { runner: unknown } }).bridge;
        bridge.runner = { target: () => gate, beaconTarget: () => point };
        mode.hear(SAMPLE);
        expect(e.frames[0]).toMatchObject({ target: gate, beacon: point });
        // an older runner (no beaconTarget): the frame has no beacon field, so the planner hums at the target (review R6:
        // a null beacon would silence it)
        const zoneGate = { id: 'g1', shape: { kind: 'zone', size: [1, 1, 1] }, pos: [0, 1.5, -10], quat: [1, 0, 0, 0], order: 1, solid: false, material: 'obstacle' } as const;
        bridge.runner = { target: () => zoneGate };
        mode.hear(SAMPLE);
        expect(e.frames[1]).toMatchObject({ target: zoneGate });
        expect('beacon' in (e.frames[1] as object)).toBe(false);
        const planner = new CuePlanner({ theme: getBuiltinTheme('soft'), prefs: defaultPrefs(), layers: { on: ['target'], heightBandM: null, hazardVoices: 0 } });
        const hum = planner.plan(e.frames[1] as SonicFrameInput).voices.find((v) => v.cue === 'target.hum');
        expect(hum?.distance).toBeCloseTo(10, 6);
        bridge.runner = null;
        mode.hear(SAMPLE);
        expect(e.frames[2]).toMatchObject({ target: null });
        expect('beacon' in (e.frames[2] as object)).toBe(false);
    });

    it('control: nothing is heard while the mode is off, in playback, or with no engine', () => {
        const e = new FakeEngine({ theme: getBuiltinTheme('soft'), prefs: defaultPrefs(), locale: 'en', caption: () => undefined });
        const mode = modeWith(e);
        mode.hear(SAMPLE);
        expect(e.frames).toHaveLength(0); // off
        mode.enter({});
        mode.playback(true);
        expect(mode.inPlayback).toBe(true);
        mode.hear(SAMPLE);
        expect(e.frames).toHaveLength(0);
        mode.playback(false);
        mode.hear(SAMPLE);
        expect(e.frames).toHaveLength(1);
        const bare = modeWith(null);
        bare.enter({});
        expect(() => bare.hear(SAMPLE)).not.toThrow();
    });

    it('entering the mode again starts out of playback (a replay left on would keep the lesson deaf)', () => {
        const e = new FakeEngine({ theme: getBuiltinTheme('soft'), prefs: defaultPrefs(), locale: 'en', caption: () => undefined });
        const mode = modeWith(e);
        mode.enter({ lesson: getLesson('walls-hall') });
        mode.playback(true);
        expect(mode.inPlayback).toBe(true);
        mode.enter({});
        expect(mode.inPlayback).toBe(false);
        mode.hear(SAMPLE);
        expect(e.frames).toHaveLength(1);
    });

    it('PageRuntime reads the mode live and routes playback to it', () => {
        const e = new FakeEngine({ theme: getBuiltinTheme('soft'), prefs: defaultPrefs(), locale: 'en', caption: () => undefined });
        const f = fakeDeps();
        const s = new SonicSetup(mkStore(), 'en', new Sink(), { deps: f.deps });
        const mode = modeWith(e);
        const calls: boolean[] = [];
        const rt = new PageRuntime(s, mode, (on) => calls.push(on));
        expect(rt.lesson).toBeNull();
        expect(rt.runner).toBeNull();
        expect(rt.world).toBeNull();
        expect(rt.prefs).toBe(s.prefs);
        expect(rt.theme).toBe(s.audio.theme);
        mode.enter({ lesson: getLesson('corridor') });
        expect(rt.lesson!.id).toBe('corridor');
        rt.playback(true);
        expect(mode.inPlayback).toBe(true);
        expect(calls).toEqual([true]);
        s.update({ calm: true });
        expect(rt.prefs.calm).toBe(true);
    });
});

describe('the bridge repeats the last line (Z)', () => {
    function bridgeOn(engine: { say(l: SpeechLine, o?: { interrupt?: boolean }): Promise<void>; setLayers(l: LessonLayers): void; cue(): void }) {
        const b = new SonicBridge({ sample: () => undefined, event: () => undefined });
        b.engine = engine as never;
        b.start({ runner: undefined, shownSim: undefined, paused: false, replaying: false });
        return b;
    }

    it('says it again with interrupt; nothing before a first line; the last line is the one spoken last, and a new start forgets it', async () => {
        const said: { key: string; interrupt: boolean }[] = [];
        const b = bridgeOn({ say: async (l, o) => { said.push({ key: l.key, interrupt: o?.interrupt === true }); }, setLayers: () => undefined, cue: () => undefined });
        await b.repeat();
        expect(said).toEqual([]);
        await b.say({ key: 'fly.go' }, false);
        await b.say({ key: 'fly.gate' }, false);
        expect(b.last).toEqual({ key: 'fly.gate' });
        await b.repeat();
        expect(said.at(-1)).toEqual({ key: 'fly.gate', interrupt: true });
        b.start({ runner: undefined, shownSim: undefined, paused: false, replaying: false });
        expect(b.last).toBeNull();
        void SILENT_LAYERS;
    });
});

// ------------------------------------------------------------------ the motor sound on the engine

class FakeParam {
    value = 0;
    targets: number[] = [];
    setTargetAtTime(v: number): void { this.targets.push(v); }
}
class FakeNode {
    to: unknown[] = [];
    started = false;
    stopped = false;
    constructor(readonly kind: string) {}
    connect(n: unknown): void { this.to.push(n); }
    disconnect(): void { this.to = []; }
    start(): void { this.started = true; }
    stop(): void { this.stopped = true; }
}
class FakeAudio {
    currentTime = 0;
    sampleRate = 8000;
    state = 'running';
    ops: string[] = [];
    destination = new FakeNode('destination');
    nodes: (FakeNode & Record<string, unknown>)[] = [];
    private add<T extends FakeNode>(n: T): T { this.nodes.push(n as FakeNode & Record<string, unknown>); return n; }
    createGain() { return this.add(Object.assign(new FakeNode('gain'), { gain: new FakeParam() })); }
    createOscillator() { return this.add(Object.assign(new FakeNode('osc'), { frequency: new FakeParam(), setPeriodicWave() { /* no wave */ } })); }
    createBiquadFilter() { return this.add(Object.assign(new FakeNode('filter'), { type: '', frequency: new FakeParam(), Q: new FakeParam() })); }
    createBuffer(_c: number, len: number) { const d = new Float32Array(len); return { getChannelData: () => d }; }
    createBufferSource() { return this.add(Object.assign(new FakeNode('noise'), { buffer: null as unknown, loop: false })); }
    createPeriodicWave(real: Float32Array, imag: Float32Array) { return { real, imag }; }
    async resume() { this.ops.push('resume'); this.state = 'running'; }
    async suspend() { this.ops.push('suspend'); this.state = 'suspended'; }
    async close() { this.ops.push('close'); this.state = 'closed'; }
}

describe('the motor sound plugs into the engine, not into the speakers', () => {
    it('with the engine\'s input node: the master goes into it, never to the context\'s destination; suspend, resume and close leave the context alone', async () => {
        const ac = new FakeAudio();
        const aux = new FakeNode('engine-aux');
        const s = new MotorSound(ac as unknown as AudioLike, 3, aux as unknown as NodeLike);
        const master = ac.nodes.find((n) => n.to.includes(aux))!;
        expect(master).toBeDefined();
        expect(ac.nodes.some((n) => n.to.includes(ac.destination))).toBe(false);
        await s.suspend();
        await s.resume();
        await s.close();
        expect(ac.ops).toEqual([]);
        expect(ac.state).toBe('running');
        expect(s.closed).toBe(true);
        expect(master.to).toEqual([]); // taken off the engine's input
    });

    it('control: with no input node it is the old graph: into the destination, and close() closes its own context', async () => {
        const ac = new FakeAudio();
        const s = new MotorSound(ac as unknown as AudioLike, 3);
        expect(ac.nodes.some((n) => n.to.includes(ac.destination))).toBe(true);
        await s.suspend();
        await s.resume();
        await s.close();
        expect(ac.ops).toEqual(['suspend', 'resume', 'close']);
    });

    it('on by default, silent when the settings say so: the default sound settings have the motor on (M41-16), and an off mix has a zero master', () => {
        expect(defaultPrefs().motorSound).toBe(true);
        const m = motorMix({ state: { motors: [0.5, 0.5, 0.5, 0.5], volt: 11.4, omegaMaxPerVolt: 500, armed: true, crashed: false, speed: 3 }, paused: false, hidden: false, enabled: false, volume: 100 });
        expect(m.master).toBe(0);
    });
});
