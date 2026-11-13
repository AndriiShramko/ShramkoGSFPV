// A spoken line through Fly by Sound's engine, for the recorder (sonic-session/platform.ts re-exports it) and for the rooms'
// announcer (rooms/announce.ts). It lives outside sonic-session/ because the rooms feature is in the main chunk, which must hold
// nothing of the mode (tools/bench/test/sonic-int-lazy.test.ts); it imports only types of the package.
import type { SonicRuntime, SpeechLine } from '@shramko/sonic-fpv';

/**
 * A spoken line that holds nothing up: the engine speaks it (and captions it) when it can, and a refusal or a missing
 * engine is ignored. The recorder never waits for speech to end (a hidden tab may never finish a line), except where the
 * survey needs the order, and there it uses the returned promise with its own time limit.
 */
export function sayVia(runtime: () => SonicRuntime | null): (line: SpeechLine, options?: { readonly interrupt?: boolean }) => Promise<void> {
    return async (line, options) => {
        const rt = runtime();
        if (rt === null) return;
        try {
            await rt.engine.say(line, options);
        } catch {
            // no voice on this system: the captions are the engine's business
        }
    };
}
