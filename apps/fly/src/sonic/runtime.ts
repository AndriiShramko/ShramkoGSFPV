// ctx.sonic: what the mode shows the other features (v0.12, docs/wip/v12-plan.md 4.2 step 7; sonic-fpv SonicRuntime):
// the recorder (lane v12-feedback) reads the engine, the pilot's settings, the world, the lesson and its runner, and
// the replay takes the engine over through playback(). Only this lane writes it. The values are read live: a lesson
// opened after the runtime was made shows in `lesson` and `runner` at once.
import type { LessonDef, LessonRunner, SonicEngine, SonicPrefs, SonicRuntime, SonicWorld, ThemeDef } from '@shramko/sonic-fpv';
import type { SonicMode } from './mode';
import type { SonicSetup } from './entry';

export class PageRuntime implements SonicRuntime {
    private readonly setup: SonicSetup;
    private readonly mode: SonicMode;
    private readonly onPlayback: (on: boolean) => void;

    constructor(setup: SonicSetup, mode: SonicMode, onPlayback: (on: boolean) => void = () => undefined) {
        this.setup = setup;
        this.mode = mode;
        this.onPlayback = onPlayback;
    }

    get engine(): SonicEngine {
        return this.setup.audio.engine;
    }

    get prefs(): SonicPrefs {
        return this.setup.audio.prefs;
    }

    get theme(): ThemeDef {
        return this.setup.audio.theme;
    }

    get world(): SonicWorld | null {
        return this.mode.bridge.world;
    }

    get lesson(): LessonDef | null {
        return this.mode.lesson;
    }

    get runner(): LessonRunner | null {
        return this.mode.bridge.runner;
    }

    /** On: live frames and the lesson stop being heard, the caller drives the view and the engine; off: they come back. */
    playback(on: boolean): void {
        this.mode.playback(on);
        this.onPlayback(on);
    }
}
