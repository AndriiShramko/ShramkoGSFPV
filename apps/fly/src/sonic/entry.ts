// Fly by Sound's entry state (v0.12, docs/wip/v12-plan.md 4.2 steps 7 to 9): what the start screen builds before the
// flight page exists and hands to it. The sound setup (the one AudioContext and the engine, the captions region,
// the pilot's sound settings and where they are saved) is made once per page, when the mode is entered; the flight
// page (app/builtin/sonic-flight.ts) finds it here when its features install, and the lesson host (lessons.ts) uses
// it to open lessons. A page that was not entered through ?sonic= has no entry, so every hook of the mode is off, and
// it never loads this file (the main chunk asks entry-state.ts; v12-int step 4).
import { isBuiltinThemeId, updatePrefs } from '@shramko/sonic-fpv';
import type { LessonDef, Locale, SonicPrefs, SpeechLine, SpeechOut } from '@shramko/sonic-fpv';
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

/** The settings a shared link may set for a visit (@gsfpv/scenes sonic-link.ts): the sound's language, never the listener's own. */
export type VisitPrefs = Partial<Pick<SonicPrefs, 'theme' | 'calm' | 'heightPolarity' | 'listenerFrame'>>;

/**
 * The sound setup of the mode: the engine's host, the captions, the saved settings, and (v12-optin) the settings a shared link
 * set for this visit. What the engine plays is the saved settings with the visit's on top; nothing of the visit is saved until the
 * pilot keeps it (keepVisit) or changes that setting himself (update: his value is saved and that setting leaves the visit), and
 * he can let it go (dropVisit: his own settings again), the way a shared scene's settings sit in the prefs store's visit layer
 * (app/shared-visit.ts). Whatever changes what stands is told to `onVisit` (the page writes it into its address, review R2).
 */
export class SonicSetup {
    readonly audio: SonicAudio;
    readonly captions: CaptionSink;
    readonly host: SonicHost;
    /** what is saved (the visit's settings are not in it) */
    private saved: SonicPrefs;
    private visiting: VisitPrefs = {};
    /** told what of a link's sound still stands, each time that changes (sonic/start.ts: the page's address follows it) */
    onVisit: ((visit: VisitPrefs) => void) | null = null;

    /** `captions`: the page's region (sonic/captions.ts Captions), or any sink; this file touches no DOM itself. */
    constructor(host: SonicHost, locale: Locale, captions: CaptionSink, o: { deps?: AudioDeps; speech?: SpeechOut | null } = {}) {
        this.host = host;
        const prefs = loadSonicPrefs(host);
        this.saved = prefs;
        this.captions = captions;
        this.audio = new SonicAudio({ locale, prefs, onCaption: (text) => captions.add(text), ...(o.deps ? { deps: o.deps } : {}), ...(o.speech === undefined ? {} : { speech: o.speech }) });
        captions.configure(captionMode(prefs));
    }

    /** The settings in force: the saved ones with this visit's on top. */
    get prefs(): SonicPrefs {
        return this.audio.prefs;
    }

    /** The settings a shared link set for this visit that still stand (empty: none). */
    get visit(): VisitPrefs {
        return { ...this.visiting };
    }

    private apply(prefs: SonicPrefs): void {
        this.audio.setPrefs(prefs);
        this.captions.configure(captionMode(prefs));
    }

    /** What of the visit stands now; `onVisit` hears it when it differs from before. */
    private stand(next: VisitPrefs): void {
        const changed = JSON.stringify(next) !== JSON.stringify(this.visiting);
        this.visiting = next;
        if (changed) this.onVisit?.({ ...next });
    }

    /**
     * Changes some of the pilot's sound settings: checked as a whole (the package's own validator), applied to the
     * engine and the captions at once, saved. A change that is not valid changes nothing and says why. A setting a shared
     * link set for this visit becomes the pilot's own when he changes it (it leaves the visit, his value is saved).
     */
    update(patch: Partial<SonicPrefs>): { readonly ok: true } | { readonly ok: false; readonly reasons: string[] } {
        const next = updatePrefs(this.saved, patch);
        if (!next.ok) return { ok: false, reasons: next.issues.map((i) => `${i.path}: ${i.message}`) };
        const rest: VisitPrefs = { ...this.visiting };
        for (const k of Object.keys(patch)) delete (rest as Record<string, unknown>)[k];
        const shown = updatePrefs(next.value, rest);
        this.saved = next.value;
        this.stand(shown.ok ? rest : {});
        this.apply(shown.ok ? shown.value : next.value);
        saveSonicPrefs(this.host, next.value);
        return { ok: true };
    }

    /**
     * The sound settings of a shared link, for this visit only: in force at once (engine and captions), never saved. Each one is
     * checked on its own and one that is not valid is left out, so a bad parameter costs only itself; one equal to the pilot's own
     * saved setting is left out too (it changes nothing, and the note would name it for nothing). Returns what stands.
     */
    setVisit(patch: VisitPrefs): VisitPrefs {
        const ok: VisitPrefs = {};
        for (const [k, v] of Object.entries(patch)) {
            // a theme this release does not have (a later one's, a made-up one) is left out: the engine would play the default under its name
            if (v === undefined || (k === 'theme' && !isBuiltinThemeId(v as string))) continue;
            if ((this.saved as unknown as Record<string, unknown>)[k] === v) continue;
            const one = { [k]: v } as VisitPrefs;
            if (updatePrefs(this.saved, { ...ok, ...one }).ok) Object.assign(ok, one);
        }
        this.stand(ok);
        const shown = updatePrefs(this.saved, ok);
        this.apply(shown.ok ? shown.value : this.saved);
        return { ...ok };
    }

    /** The visit's settings become the pilot's own (saved); the visit is over. */
    keepVisit(): void {
        if (Object.keys(this.visiting).length > 0) this.update({ ...this.visiting });
    }

    /** "Use my own settings": the visit is over, nothing of it is saved, the pilot's own saved settings play again. */
    dropVisit(): void {
        if (Object.keys(this.visiting).length === 0) return;
        this.stand({});
        this.apply(this.saved);
    }
}

/** What the page asks of the start screen once the flight runs (StartScreen; a recorder in tests). */
export interface ScreenPort {
    /** shown with the focus on its heading, or on a section's (the lesson menu's Sound settings: 'settings') */
    show(section?: 'start' | 'headphones' | 'lessons' | 'settings'): void;
    hide(): void;
    /**
     * the screen's own handlers are replaced: a lesson chosen on it opens in the flight, Escape or Back close it; `say` (v0.13 C3): its
     * spoken list's lines go through the page's voice (the lesson's speech queue while one runs); `onReset` (v13-int step 5): told after
     * "Reset my progress" was answered Yes and the saved progress cleared (the lesson running under the screen forgets its counts)
     */
    bind(handlers: { readonly onStart: (lessonId: string) => void; readonly onClose: () => void; readonly say?: (line: SpeechLine, interrupt: boolean) => Promise<void>; readonly onReset?: () => void }): void;
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
    /** train 2: the free flight over a scan link's scan (start.ts freeLessonOf), opened by the host's openFree */
    readonly free?: LessonDef | null;
    /** train 2 (review SN-2): the free flight of the page's scan link for a press of the start screen over a flight (start.ts freeLessonOf) */
    readonly freeOf?: (id: string) => LessonDef | null;
}

// The page's entry itself lives in entry-state.ts (no runtime import: the main chunk asks it on every page).
export { sonicEntry, setSonicEntry } from './entry-state';
