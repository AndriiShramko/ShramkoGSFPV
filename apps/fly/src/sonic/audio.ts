// The sound engine in the page (v0.12, docs/wip/v12-plan.md 2.2 and 4.2 step 7; spec sections 2 and 6): one
// AudioContext for the whole mode, made by the start screen's Start button (a user activation: the same press unlocks
// speechSynthesis), the sound package's engine started on it, the pilot's sound settings applied to it. The engine
// owns the context and the output chain (master, limiter at the theme's ceiling, fade-in); the simulator's motor
// sound plugs into it (app/builtin/sound.ts) through its motor bus `motorInput` (v0.13, M41-16: the propellers' band,
// levelled, under the cues, ducked under speech), or `auxInput` on an engine that has none, so it goes through the same
// limiter. `plan` is the engine's last frame plan (the height tone and target note, the open way), for the mode's panels.
//
// Nothing here makes sound by itself: the frames (the lesson host, the feature) call engine.update(). A browser
// with no Web Audio gets no context: `available` is false and everything else still runs, captions and all.
import { createSonicEngine } from '@shramko/sonic-fpv/audio';
import type { FlyBySoundEngine } from '@shramko/sonic-fpv/audio';
import { defaultPrefs, resolveTheme } from '@shramko/sonic-fpv';
import type { AudioContextLike, Locale, SonicPrefs, SpeechLine, SpeechOut, ThemeDef } from '@shramko/sonic-fpv';
import { engineDicts } from './host-lines';

/** What the engine host needs of the engine (FlyBySoundEngine; a fake in tests). */
export type PageEngine = Pick<FlyBySoundEngine, 'state' | 'start' | 'suspend' | 'resume' | 'close' | 'setTheme' | 'setPrefs' | 'setLocale' | 'setLayers' | 'update' | 'cue' | 'say' | 'activeCues' | 'auxInput' | 'motorInput' | 'plan' | 'onSpeech' | 'reset'>;

/** What the engine host asks of the browser (replaced in tests, and by the bench's tap on the output). */
export interface AudioDeps {
    /** a new AudioContext, made inside a user activation; null when the browser has no Web Audio */
    makeContext(): AudioContextLike | null;
    /** an empty utterance, inside the same activation: Chrome lets a page speak only after one */
    unlockSpeech(): void;
    createEngine(o: { theme: ThemeDef; prefs: SonicPrefs; locale: Locale; speech?: SpeechOut | null; caption: (text: string, line: SpeechLine, o: { readonly quiet: boolean }) => void }): PageEngine;
}

export const browserDeps: AudioDeps = {
    makeContext() {
        const Ctor = (globalThis as { AudioContext?: new (o?: AudioContextOptions) => AudioContext }).AudioContext;
        if (!Ctor) return null;
        try {
            return new Ctor({ latencyHint: 'interactive' }) as unknown as AudioContextLike;
        } catch {
            return null;
        }
    },
    unlockSpeech() {
        try {
            const synth = globalThis.speechSynthesis;
            if (synth) synth.speak(new SpeechSynthesisUtterance(''));
        } catch {
            /* no speech in this browser: the captions carry the text */
        }
    },
    // the package's dictionaries and the page's own spoken lines (host-lines.ts)
    createEngine: (o) => createSonicEngine({ theme: o.theme, prefs: o.prefs, locale: o.locale, dicts: engineDicts(), ...(o.speech === undefined ? {} : { speech: o.speech }), caption: o.caption })
};

export interface SonicAudioOptions {
    readonly locale: Locale;
    readonly prefs?: SonicPrefs;
    /** every spoken line's text, for the captions region */
    readonly onCaption?: (text: string, line: SpeechLine, o?: { readonly quiet: boolean }) => void;
    readonly deps?: AudioDeps;
    /** default: the browser's speechSynthesis; null: captions only */
    readonly speech?: SpeechOut | null;
}

/**
 * Why the sound did not come up (lane sound6 S4): 'no-web-audio', the browser has no Web Audio at all; 'engine-failed', it has
 * one but the engine threw while starting on it (Firefox did before the package's placeListener). 'none': it came up, or no
 * start was tried yet.
 */
export type AudioFailure = 'none' | 'no-web-audio' | 'engine-failed';

/** The line the start screen shows for a failure (a way on in each: another browser, or a reload), null when there is none. */
export function audioProblemKey(f: AudioFailure): 'sonic.start.noAudio' | 'sonic.start.engineFailed' | null {
    return f === 'no-web-audio' ? 'sonic.start.noAudio' : f === 'engine-failed' ? 'sonic.start.engineFailed' : null;
}

export class SonicAudio {
    readonly engine: PageEngine;
    private readonly deps: AudioDeps;
    private context: AudioContextLike | null = null;
    private starting: Promise<void> | null = null;
    private prefsValue: SonicPrefs;
    private themeValue: ThemeDef;
    private localeValue: Locale;
    private failureValue: AudioFailure = 'none';

    constructor(o: SonicAudioOptions) {
        this.deps = o.deps ?? browserDeps;
        this.prefsValue = o.prefs ?? defaultPrefs();
        this.themeValue = resolveTheme(this.prefsValue.theme);
        this.localeValue = o.locale;
        this.engine = this.deps.createEngine({
            theme: this.themeValue,
            prefs: this.prefsValue,
            locale: o.locale,
            ...(o.speech === undefined ? {} : { speech: o.speech }),
            caption: (text, line, c) => o.onCaption?.(text, line, c)
        });
    }

    get prefs(): SonicPrefs {
        return this.prefsValue;
    }

    get theme(): ThemeDef {
        return this.themeValue;
    }

    get locale(): Locale {
        return this.localeValue;
    }

    /** The context the engine plays on, once started. */
    get ac(): AudioContextLike | null {
        return this.context;
    }

    /** Web Audio exists in this browser (false after a start that found none). */
    get available(): boolean {
        return this.failureValue === 'none';
    }

    /** Why the sound did not come up ('none' while it runs or before a start). */
    get failure(): AudioFailure {
        return this.failureValue;
    }

    /** The engine runs: the context exists and the graph is built. */
    get running(): boolean {
        return this.engine.state === 'running';
    }

    /**
     * Makes the one AudioContext and starts the engine on it. Call it inside the press that starts the mode (a click or
     * a key on the Start button): the context and the speech unlock must happen in that user activation, so the work
     * before the first await is all there is to do synchronously. A second call gives the same promise.
     */
    start(): Promise<void> {
        if (this.starting) return this.starting;
        this.deps.unlockSpeech();
        const ac = this.deps.makeContext();
        if (!ac) {
            this.failureValue = 'no-web-audio';
            this.starting = Promise.resolve();
            return this.starting;
        }
        this.context = ac;
        this.starting = this.engine.start(ac).catch((e: unknown) => {
            console.warn('fly by sound: the engine did not start', e);
            this.failureValue = 'engine-failed';
        });
        return this.starting;
    }

    /** New settings (the pilot's own): the engine takes them at once; another theme id swaps the theme. */
    setPrefs(prefs: SonicPrefs): void {
        const themeChanged = prefs.theme !== this.prefsValue.theme;
        this.prefsValue = prefs;
        if (themeChanged) {
            this.themeValue = resolveTheme(prefs.theme);
            this.engine.setTheme(this.themeValue);
        }
        this.engine.setPrefs(prefs);
    }

    setLocale(locale: Locale): void {
        this.localeValue = locale;
        this.engine.setLocale(locale);
    }

    /** The mode ends: the engine stops and the context closes (the page is about to reload or go). */
    async close(): Promise<void> {
        await this.engine.close();
        const ac = this.context as unknown as { close?: () => Promise<void> } | null;
        this.context = null;
        if (ac?.close) await ac.close().catch(() => undefined);
    }
}
