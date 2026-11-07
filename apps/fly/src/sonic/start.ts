// Entering Fly by Sound (v0.12, docs/wip/v12-plan.md 2.10 and 4.2 step 8): what the page does when it is opened as
// /{lang}/fly/?sonic=start or ?sonic=<lesson id>. No scene picker, no first-visit modal (the start screen carries its own
// hearing note): the accessible start screen (start-screen.ts), the zoom a person who sees badly needs, the sound
// setup (captions, engine, saved settings), and, when a lesson is chosen, the launch of the flight on its world.
//
// The press that starts a lesson is the user activation Web Audio and speechSynthesis wait for: `onStart` makes the
// AudioContext in that call (SonicAudio.start), then the page's flight is launched. The flight itself (fly()) is
// the page's own (app/boot.ts passes `launch`), so this file has no edge to the flight shell and Node tests reach it.
import type { Locale } from '@shramko/sonic-fpv';
import { DICTS, createTranslator, getLesson } from '@shramko/sonic-fpv';
import type { PrefsStore } from '@gsfpv/prefs';
import { Captions } from './captions';
import { SonicSetup } from './entry';
import { lessonFlightWorld } from './lesson-world';
import type { LessonWorld } from './lesson-world';
import { StartScreen } from './start-screen';
import { parseSonicParam } from './start-model';
import { allProgress, currentLesson, setCurrentLesson } from './store';
import { enableZoom } from './zoom';
import { t } from '../i18n';

/** What the flight shell is asked to open: the lesson, its world (null: a scan lesson flies the scan) and the sound setup. */
export interface LaunchRequest {
    readonly lessonId: string;
    readonly world: LessonWorld | null;
    /** the scan a scan lesson flies */
    readonly sceneId: string | null;
    readonly setup: SonicSetup;
}

export interface SonicStartDeps {
    readonly prefs: PrefsStore;
    readonly locale: Locale;
    /** the raw ?sonic= value */
    readonly raw: string | null;
    /** the page's flight (fly()) on the lesson's world; called after the press has made the AudioContext */
    readonly launch: (r: LaunchRequest) => Promise<void>;
}

export interface StartHandle {
    readonly screen: StartScreen;
    readonly setup: SonicSetup;
}

/** Opens the start screen; a lesson chosen on it launches the flight. */
export function startSonic(d: SonicStartDeps): StartHandle {
    enableZoom();
    const tr = createTranslator(d.locale, DICTS);
    document.title = tr.say('app.name');
    const request = parseSonicParam(d.raw);
    const setup = new SonicSetup(d.prefs, d.locale, new Captions());
    const screen: StartScreen = new StartScreen({
        setup,
        locale: d.locale,
        request,
        progress: () => allProgress(d.prefs),
        current: () => currentLesson(d.prefs),
        onStart: (id) => {
            // inside the press: the context and the speech unlock; the rest follows once the engine is up
            const started = setup.audio.start();
            setCurrentLesson(d.prefs, id);
            screen.hide();
            void started.then(async () => {
                if (!setup.audio.available) {
                    screen.show();
                    screen.say(t('sonic.start.noAudio'));
                    return;
                }
                const lesson = getLesson(id);
                try {
                    await d.launch({ lessonId: id, world: lessonFlightWorld(lesson), sceneId: lesson.world.kind === 'scan' ? lesson.world.sceneId : null, setup });
                } catch (e) {
                    screen.show();
                    screen.say(String((e as Error)?.message ?? e));
                }
            });
        }
    });
    screen.show();
    return { screen, setup };
}
