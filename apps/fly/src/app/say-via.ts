// A spoken line through Fly by Sound's engine, for the recorder (sonic-session/platform.ts re-exports it) and for the rooms'
// announcer (rooms/announce.ts). It lives outside sonic-session/ because the rooms feature is in the main chunk, which must hold
// nothing of the mode (tools/bench/test/sonic-int-lazy.test.ts); it imports only types of the package.
import type { CueEvent, SonicRuntime, SpeechLine } from '@shramko/sonic-fpv';

/** What a speaker passes with a line: `quietCue`, the sound played instead of the line when the narrator is off (else the table's). */
export interface SayViaOptions {
    readonly interrupt?: boolean;
    readonly quietCue?: CueEvent | null;
}

/**
 * The page's runtime (sonic/runtime.ts PageRuntime) answers whether a line said now is quiet (the narrator off in a flight) and the
 * sound of a quiet line (sonic/quiet-cues.ts, the mode's table, so the main chunk holds none of it).
 */
type QuietRuntime = SonicRuntime & { quiet?: () => boolean; quietSound?: (key: string) => CueEvent | null };

/**
 * A spoken line that holds nothing up: the engine speaks it (and captions it) when it can, and a refusal or a missing
 * engine is ignored. The recorder never waits for speech to end (a hidden tab may never finish a line), except where the
 * survey needs the order, and there it uses the returned promise with its own time limit.
 * Lane quiet (review QV-1): with the narrator off in a flight the line goes to the engine quiet (a caption for the eye only, never
 * voiced, never to a screen reader, never waited for) and its sound plays instead (sonic/quiet-cues.ts), as the bridge's own lines do.
 */
export function sayVia(runtime: () => SonicRuntime | null): (line: SpeechLine, options?: SayViaOptions) => Promise<void> {
    return async (line, options) => {
        const rt = runtime() as QuietRuntime | null;
        if (rt === null) return;
        const quiet = rt.quiet?.() === true;
        const interrupt = options?.interrupt;
        try {
            if (quiet) {
                const cue = options?.quietCue !== undefined ? options.quietCue : rt.quietSound?.(line.key) ?? null;
                if (cue) rt.engine.cue(cue);
            }
            await rt.engine.say(line, quiet ? { interrupt, quiet: true } : interrupt === undefined ? undefined : { interrupt });
        } catch {
            // no voice on this system: the captions are the engine's business
        }
    };
}
