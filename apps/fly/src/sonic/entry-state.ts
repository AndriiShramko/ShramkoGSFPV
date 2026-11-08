// Whether this page was entered through ?sonic=, and with what (v0.12; v12-int step 4). The main chunk of the simulator keeps
// only this: the flight shell (app/flight.ts), the motor sound (app/builtin/sound.ts) and the feature shim
// (app/builtin/sonic-flight.ts) ask it. Everything the entry holds (the sound setup, the start screen, the lesson's world)
// and the mode that runs on it come with the lazy chunk boot.ts loads for a ?sonic= page (sonic/lazy-start.ts); so this file
// has no runtime import at all, and a page entered without ?sonic= downloads none of Fly by Sound.
import type { FlightContext } from '../app/context';
import type { SonicEntry } from './entry';

/** Installs the mode on the flight page (sonic/feature.ts installSonicFlight); the function it returns takes it out. */
export type SonicInstaller = (ctx: FlightContext, entry: SonicEntry) => () => void;

let entry: SonicEntry | null = null;
let installer: SonicInstaller | null = null;

/** The entry of this page; null on a page that was not entered through ?sonic=. */
export function sonicEntry(): SonicEntry | null {
    return entry;
}

export function setSonicEntry(e: SonicEntry | null): void {
    entry = e;
}

/** The mode's installer, once its chunk has loaded (before the flight is made); null on a page without the mode. */
export function sonicInstaller(): SonicInstaller | null {
    return installer;
}

export function setSonicInstaller(i: SonicInstaller | null): void {
    installer = i;
}
