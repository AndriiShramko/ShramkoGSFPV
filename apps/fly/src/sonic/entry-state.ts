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

/** Where live-quiet.ts keeps a live region's own aria-live value while the flight is quiet (one name for it and quietAtPress). */
export const LIVE_SAVED = 'data-sonic-live';

/** What quietAtPress needs of an element (a test passes a small fake). */
export interface PressLiveElement {
    getAttribute(name: string): string | null;
    setAttribute(name: string, value: string): void;
    removeAttribute(name: string): void;
    querySelectorAll(selector: string): ArrayLike<PressLiveElement>;
}

/**
 * Lane quiet3 (the lead's M4): with the narrator off the flight is quiet from the Backslash press on. The mode's chunk loads and its
 * sound starts after the press (measured about 0.2 s), and until feature.ts installs live-quiet.ts the HUD's text in #ui was
 * announced. The shim (app/builtin/sonic-flight.ts) calls this in the press itself: the root and every live region inside it go
 * aria-live "off", their own value kept in LIVE_SAVED, so live-quiet.ts takes them over as its own. Returns what gives them back,
 * for a switch-on that did not come up.
 */
export function quietAtPress(root: PressLiveElement | null): () => void {
    if (!root) return () => undefined;
    const done: PressLiveElement[] = [];
    for (const el of [root, ...Array.from(root.querySelectorAll('[aria-live]'))]) {
        if (el.getAttribute(LIVE_SAVED) !== null) continue;
        el.setAttribute(LIVE_SAVED, el.getAttribute('aria-live') ?? '');
        el.setAttribute('aria-live', 'off');
        done.push(el);
    }
    return () => {
        for (const el of done) {
            const had = el.getAttribute(LIVE_SAVED);
            if (had === null) continue;
            if (had === '') el.removeAttribute('aria-live');
            else el.setAttribute('aria-live', had);
            el.removeAttribute(LIVE_SAVED);
        }
    };
}
