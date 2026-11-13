// Entering Fly by Sound (v0.12, docs/wip/v12-plan.md 2.10 and 4.2 step 8): what the page does when it is opened as
// /{lang}/fly/?sonic=start or ?sonic=<lesson id>. No scene picker, no first-visit modal (the start screen carries its own
// hearing note): the accessible start screen (start-screen.ts), the zoom a person who sees badly needs, the sound
// setup (captions, engine, saved settings), and, when a lesson is chosen, the launch of the flight on its world.
//
// The press that starts a lesson is the user activation Web Audio and speechSynthesis wait for: `onStart` makes the
// AudioContext in that call (SonicAudio.start), then the page's flight is launched. The flight itself (fly()) is
// the page's own (app/boot.ts passes `launch`), so this file has no edge to the flight shell and Node tests reach it.
//
// A shared lesson link (v12-optin, @gsfpv/scenes sonic-link.ts: L in a lesson copies one) opens here like any ?sonic= page: the
// start screen offers its lesson first and nothing starts by itself. Its sound settings are in force for this visit only
// (SonicSetup.setVisit), and the start screen says which, with a button to keep them.
import type { Locale } from '@shramko/sonic-fpv';
import { SCAN_FREE_ID, getLesson, scanFreeLesson } from '@shramko/sonic-fpv';
import type { LessonDef } from '@shramko/sonic-fpv';
import type { PrefsStore } from '@gsfpv/prefs';
import { followVisit } from './address';
import { Captions } from './captions';
import { SonicSetup } from './entry';
import { lessonFlightWorld } from './lesson-world';
import type { LessonWorld } from './lesson-world';
import { clearScanPrefs, forceScanPrefs } from './scan-lesson';
import { StartScreen } from './start-screen';
import { experiencedPilot, launchFailureLine, parseSonicParam } from './start-model';
import type { SonicRequest } from './start-model';
import { allProgress, currentLesson, fliesBySound, resetProgress, setCurrentLesson, setFliesBySound } from './store';
import { enableZoom } from './zoom';
import { t } from '../i18n';

/** What the flight shell is asked to open: the lesson, its world (null: a scan lesson flies the scan) and the sound setup. */
export interface LaunchRequest {
    readonly lessonId: string;
    readonly world: LessonWorld | null;
    /** the scan a scan lesson flies */
    readonly sceneId: string | null;
    /** train 2: the free flight over a scan link's scan (scanFreeLesson), the lesson the host opens instead of a shipped one */
    readonly free?: LessonDef | null;
    readonly setup: SonicSetup;
    /** the start screen, for the flight to show again */
    readonly screen: StartScreen;
}

export interface SonicStartDeps {
    readonly prefs: PrefsStore;
    readonly locale: Locale;
    /** the raw ?sonic= value */
    readonly raw: string | null;
    /** the page's query (app/env.ts q): a shared lesson link's sound settings, read for this visit */
    readonly query?: { get(name: string): string | null };
    /** the page's flight (fly()) on the lesson's world; called after the press has made the AudioContext */
    readonly launch: (r: LaunchRequest) => Promise<void>;
    /**
     * Gets the mode's code ready before anything of the flight is set up (boot.ts: the chunk of sonic/feature.ts, v12-int step 4).
     * A rejection is a lesson that did not open: sonic.say.lessonFailed is said and shown, the start screen comes back.
     */
    readonly prepare?: () => Promise<void>;
}

export interface StartHandle {
    readonly screen: StartScreen;
    readonly setup: SonicSetup;
}

/**
 * The free flight a press asks for (train 2): SCAN_FREE_ID on a scan link's screen is the template over that link's scan at its size
 * (scanFreeLesson, transform [size, 0, 0, 0]), else null (a shipped lesson).
 */
export function freeLessonOf(request: SonicRequest, id: string): LessonDef | null {
    if (id !== SCAN_FREE_ID || request.kind !== 'scan') return null;
    return scanFreeLesson(request.sceneId, [request.size, 0, 0, 0]);
}

/** Opens the start screen; a lesson chosen on it launches the flight. */
export function startSonic(d: SonicStartDeps): StartHandle {
    enableZoom();
    // the mode's name in the page's language (v13-int step 6: Russian and Polish name it in their own words)
    document.title = t('sonic.start.name');
    const request = parseSonicParam(d.raw, d.query);
    const captions = new Captions();
    // what of the captions fits above the panels is measured again when the page changes size (v13-int review K2, captions.ts fit)
    addEventListener('resize', () => captions.refit());
    const setup = new SonicSetup(d.prefs, d.locale, captions);
    // a shared link's sound for this visit (never saved unless kept); its scene and size are the lesson's own, which decides. The
    // address carries what of it still stands, so a reload or a restored tab never brings back a setting the pilot kept, changed or
    // let go of (review R2, address.ts)
    followVisit(setup, d.query);
    const screen: StartScreen = new StartScreen({
        setup,
        locale: d.locale,
        request,
        progress: () => allProgress(d.prefs),
        current: () => currentLesson(d.prefs),
        // Reset my progress (v0.13, M41-2): the lessons' progress and the current lesson go, the sound settings stay
        resetProgress: () => resetProgress(d.prefs),
        // a scan link (train 2): the scan first for a pilot who has begun a lesson or once said he flies by sound
        experienced: () => experiencedPilot(allProgress(d.prefs), fliesBySound(d.prefs)),
        onFlies: () => setFliesBySound(d.prefs),
        onStart: (id) => {
            // inside the press: the context and the speech unlock; the rest follows once the engine is up
            const started = setup.audio.start();
            const free = freeLessonOf(request, id);
            // the free flight is no lesson of the course: Continue keeps naming the lesson the pilot is on
            if (!free) setCurrentLesson(d.prefs, id);
            screen.hide();
            void started.then(async () => {
                if (!setup.audio.available) {
                    screen.show();
                    screen.say(t('sonic.start.noAudio'));
                    return;
                }
                const lesson = free ?? getLesson(id);
                const failed = (e: unknown, line: ReturnType<typeof launchFailureLine>): void => {
                    console.warn('fly by sound: the flight did not open', e);
                    screen.show();
                    // told in his language, not with the exception's own English text: aloud with the captions when the engine
                    // speaks, else the captions are the live region a screen reader reads (so the status line stays quiet
                    // there, or it would be read twice)
                    void setup.audio.engine.say(line, { interrupt: true }).catch(() => undefined);
                    if (setup.prefs.selfVoice) screen.say(t(line.key));
                };
                try {
                    // the mode's own code (a chunk of its own, fetched while the screen was read): a chunk that cannot load is a
                    // lesson that did not open, never a silent page
                    await d.prepare?.();
                } catch (e) {
                    failed(e, launchFailureLine(false));
                    return;
                }
                // a scan lesson loads its scan at the lesson's size, walls on: set before the flight loads it (the mode keeps
                // them while it runs and takes them off when it leaves), and the pilot hears that it takes a while
                if (forceScanPrefs(d.prefs, lesson.world)) void setup.audio.engine.say({ key: 'sonic.say.scanLoading' }, { interrupt: false }).catch(() => undefined);
                try {
                    await d.launch({ lessonId: id, world: lessonFlightWorld(lesson), sceneId: lesson.world.kind === 'scan' ? lesson.world.sceneId : null, free, setup, screen });
                } catch (e) {
                    // the flight did not open: the scan lesson's size and walls are not kept for whatever the pilot does next
                    clearScanPrefs(d.prefs);
                    failed(e, launchFailureLine(lesson.world.kind === 'scan'));
                }
            });
        }
    });
    screen.show();
    return { screen, setup };
}
