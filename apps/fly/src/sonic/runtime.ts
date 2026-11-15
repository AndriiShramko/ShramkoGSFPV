// ctx.sonic: what the mode shows the other features (v0.12, docs/wip/v12-plan.md 4.2 step 7; sonic-fpv SonicRuntime):
// the recorder (lane v12-feedback) reads the engine, the pilot's settings, the world, the lesson and its runner, and
// the replay takes the engine over through playback(). Only this lane writes it. The values are read live: a lesson
// opened after the runtime was made shows in `lesson` and `runner` at once.
import { quietCue } from './quiet-cues';
import type { CueEvent, LessonDef, LessonRunner, SonicEngine, SonicPrefs, SonicRuntime, SonicWorld, ThemeDef } from '@shramko/sonic-fpv';
import type { SonicMode } from './mode';
import type { SonicSetup } from './entry';

/**
 * The engine with its say keeping the narrator setting (lane quiet2, N4): a line with no `quiet` of its own is sent quiet, with its
 * sound, while `quiet()` holds; a line that names `quiet` (app/say-via.ts, the bridge) is passed on as it is.
 */
export function quietEngine(engine: SonicEngine, quiet: () => boolean, sound: (key: string) => CueEvent | null): SonicEngine {
    type Say = SonicEngine['say'];
    const say: Say = (line, o) => {
        if (o?.quiet !== undefined || !quiet()) return engine.say(line, o);
        const cue = sound(line.key);
        if (cue) engine.cue(cue);
        return engine.say(line, { ...o, quiet: true });
    };
    return new Proxy(engine, {
        get(target, p) {
            if (p === 'say') return say;
            const v: unknown = Reflect.get(target, p, target);
            return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
        }
    });
}

export class PageRuntime implements SonicRuntime {
    private readonly setup: SonicSetup;
    private readonly mode: SonicMode;
    private readonly onPlayback: (on: boolean) => void;

    constructor(setup: SonicSetup, mode: SonicMode, onPlayback: (on: boolean) => void = () => undefined) {
        this.setup = setup;
        this.mode = mode;
        this.onPlayback = onPlayback;
    }

    /**
     * Lane quiet (review QV-1): a line said now is quiet (the narrator off in a flight), the same predicate as the bridge's
     * (feature.ts sets mode.bridge.quiet), so the page's other speakers (app/say-via.ts) keep the setting too.
     */
    quiet(): boolean {
        return this.mode.bridge.quiet?.() === true;
    }

    /** The sound a quiet line plays in its place (quiet-cues.ts, the one table), null for none. */
    quietSound(key: string): CueEvent | null {
        return quietCue(key);
    }

    /**
     * The engine as the other features see it. Lane quiet2 (the lead's N4): a line said through it without its own `quiet` (the GPU
     * hint, app/builtin/gpu-hint.ts, says its line straight to the engine) keeps the narrator setting too: quiet in a flight with the
     * narrator off, and its sound (quiet-cues.ts) in its place. Every other member is the engine's own, bound to it.
     */
    get engine(): SonicEngine {
        const engine = this.setup.audio.engine;
        if (this.wrapped?.of !== engine) this.wrapped = { of: engine, view: quietEngine(engine, () => this.quiet(), (k) => this.quietSound(k)) };
        return this.wrapped.view;
    }

    private wrapped: { readonly of: SonicEngine; readonly view: SonicEngine } | null = null;

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
