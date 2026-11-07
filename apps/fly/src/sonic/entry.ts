// Fly by Sound's entry state (v0.12, docs/wip/v12-plan.md 4.2 steps 7 to 9): what the start screen builds before the
// flight page exists and hands to it. The sound setup (the one AudioContext and the engine, the captions region,
// the pilot's sound settings and where they are saved) is made once per page, when the mode is entered; the flight
// page (app/builtin/sonic-flight.ts) finds it here when its features install, and the lesson host (lessons.ts) uses
// it to open lessons. A page that was not entered through ?sonic= has no entry, so every hook of the mode is off.
import { updatePrefs } from '@shramko/sonic-fpv';
import type { Locale, SonicPrefs, SpeechOut } from '@shramko/sonic-fpv';
import { SonicAudio } from './audio';
import type { AudioDeps } from './audio';
import type { CaptionMode } from './captions';
import { loadSonicPrefs, saveSonicPrefs } from './store';
import type { SonicHost } from './store';
import type { LessonWorld } from './lesson-world';
import type { FlightSession } from '../session';

/** What the setup needs of the captions region (the real one is a DOM region; a recorder in tests). */
export interface CaptionSink {
    add(text: string): void;
    configure(mode: CaptionMode): void;
}

/** Shown to the eye by SonicPrefs.captions; read by a screen reader when "my screen reader speaks" (selfVoice off). */
export function captionMode(prefs: SonicPrefs): CaptionMode {
    return { visible: prefs.captions, live: !prefs.selfVoice };
}

/** The sound setup of the mode: the engine's host, the captions, the saved settings. */
export class SonicSetup {
    readonly audio: SonicAudio;
    readonly captions: CaptionSink;
    readonly host: SonicHost;

    /** `captions`: the page's region (sonic/captions.ts Captions), or any sink; this file touches no DOM itself. */
    constructor(host: SonicHost, locale: Locale, captions: CaptionSink, o: { deps?: AudioDeps; speech?: SpeechOut | null } = {}) {
        this.host = host;
        const prefs = loadSonicPrefs(host);
        this.captions = captions;
        this.audio = new SonicAudio({ locale, prefs, onCaption: (text) => captions.add(text), ...(o.deps ? { deps: o.deps } : {}), ...(o.speech === undefined ? {} : { speech: o.speech }) });
        captions.configure(captionMode(prefs));
    }

    get prefs(): SonicPrefs {
        return this.audio.prefs;
    }

    /**
     * Changes some of the pilot's sound settings: checked as a whole (the package's own validator), applied to the
     * engine and the captions at once, saved. A change that is not valid changes nothing and says why.
     */
    update(patch: Partial<SonicPrefs>): { readonly ok: true } | { readonly ok: false; readonly reasons: string[] } {
        const next = updatePrefs(this.audio.prefs, patch);
        if (!next.ok) return { ok: false, reasons: next.issues.map((i) => `${i.path}: ${i.message}`) };
        this.audio.setPrefs(next.value);
        this.captions.configure(captionMode(next.value));
        saveSonicPrefs(this.host, next.value);
        return { ok: true };
    }
}

/** What the page asks of the start screen once the flight runs (StartScreen; a recorder in tests). */
export interface ScreenPort {
    show(): void;
    hide(): void;
    /** the screen's own handlers are replaced: a lesson chosen on it opens in the flight, Escape or Back close it */
    bind(handlers: { readonly onStart: (lessonId: string) => void; readonly onClose: () => void }): void;
}

/** What the start screen hands to the flight page. */
export interface SonicEntry {
    readonly setup: SonicSetup;
    /** the start screen, to show over the flight (the pause menu's Fly by Sound item) */
    readonly screen?: ScreenPort;
    /**
     * Hands a new flown session to the page (the flight shell's swapSession: every feature follows the 'session' event).
     * Set by fly() when the page flies a lesson's world; the lesson host uses it to move to a lesson with other walls.
     */
    swapSession?: (next: FlightSession, scene: { id: string }) => void;
    /** the lesson to open first, or null (the mode runs with no lesson) */
    readonly lessonId: string | null;
    /** its world, built before the first flight is made on it (fly()'s `world` option), or null */
    readonly world: LessonWorld | null;
}

let entry: SonicEntry | null = null;

/** The entry of this page; null on a page that was not entered through ?sonic=. */
export function sonicEntry(): SonicEntry | null {
    return entry;
}

export function setSonicEntry(e: SonicEntry | null): void {
    entry = e;
}
