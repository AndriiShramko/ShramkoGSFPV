// The chunk app/boot.ts loads for a page entered through ?sonic= (v0.12, v12-int step 4): the start screen, the sound setup and
// the sound package come with it, the mode (sonic/feature.ts: the lesson host, the helper's view, the scan lesson) in a chunk of
// its own, fetched while the pilot reads the start screen and awaited when a lesson starts (before the flight is made). A page
// entered without ?sonic= loads neither: the main chunk keeps only sonic/entry-state.ts and the feature shim. The mode's texts
// come first (texts.ts: the sonic and sonickeys dictionaries, v12-optin), before anything here can call t().
import './texts';
import type { SonicInstaller } from './entry-state';

export { startSonic } from './start';

let mode: Promise<SonicInstaller> | null = null;

/** The mode's installer, loaded once; a load that failed is tried again at the next call (the next Start). */
export function loadMode(): Promise<SonicInstaller> {
    mode ??= import('./feature').then(
        (m) => m.installSonicFlight,
        (e: unknown) => {
            mode = null;
            throw e;
        }
    );
    return mode;
}
