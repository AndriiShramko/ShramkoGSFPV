// Fly by Sound, the flight side (v0.12, lane v12-flight, docs/wip/v12-plan.md section 4.2): the mode, its lessons and its engine
// in the flight page. This feature is a shim in the main chunk (v12-int step 4): every visitor of the simulator installs it, so
// it holds nothing of the mode. On a page entered through ?sonic= boot.ts has loaded the mode's chunk before the flight was made
// (sonic/lazy-start.ts) and set the entry; the shim then installs sonic/feature.ts installSonicFlight.
//
// On any other page the mode is not pressed on anyone (v12-optin, the owner's message 40): no listener, no key (the mode's keys
// exist only on a ?sonic= page, keymap `when: 'sonic'`), no hint, no tour step, nothing of the sound package or the lessons
// downloaded. One quiet way in stays, for a pilot who is curious: one item of the pause menu, a link that opens the mode's own
// start screen (/{lang}/fly/?sonic=start: its lessons, its sound settings, and a link to the site's page about the mode) in a new
// tab, the flight left paused under the menu. Since v0.13 (the owner's M41-1: an ordinary pilot opens the mode from the menu, no
// address codes) the item opens the mode itself, no longer the page about it (/{lang}/sound/, which the start screen links).
import { sonicEntry, sonicInstaller } from '../../sonic/entry-state';
import { sharedNumber } from '@gsfpv/scenes';
import { seedOfLink } from '../../course/link';
import type { Feature, MenuItem } from '../context';

/** The sound link's course seed (base 36), not course= (the sighted course feature's own name, review SN-4). 'sg': no other param of the page. */
export const SOUND_COURSE_PARAM = 'sg';

/** The course seed a sound link carries (sg=<seed in base 36>, the range of course/link.ts seedOfLink), or null. */
export function soundCourseSeed(search: string): number | null {
    const v = new URLSearchParams(search).get(SOUND_COURSE_PARAM);
    if (v === null || !/^[0-9a-z]{1,7}$/.test(v)) return null;
    const seed = parseInt(v, 36);
    return Number.isFinite(seed) && seed >= 0 && seed <= 0xffffffff ? seed : null;
}

/** The page's language as i18n.ts writes it on <html lang> (read when the menu opens), English when it has none. */
const pageLang = (): string => document.documentElement.lang || 'en';

/** The site's page about Fly by Sound in the page's language: what it is, for whom (the mode's start screen links it). */
export const soundPage = (): string => `/${pageLang()}/sound/`;

/** The mode's start screen in the page's language: the lessons, where the pilot stands in each, the sound settings. */
export const modeStartPage = (): string => `/${pageLang()}/fly/?sonic=start`;

/**
 * The pause menu's way into the mode on an ordinary page: no key, one line, last of the tools section (after "Report a bug or an
 * idea", 110), so it reads as the quiet end of the list (review R8); its words name blind and low-vision pilots as the site does.
 * A link (MenuItem.href): the menu draws it with target _blank and tells a screen reader it opens a new tab (pause.newTab).
 */
export const SOUND_PAGE_ITEM: Omit<MenuItem, 'run'> = { id: 'pause.flyBySound', action: null, labelKey: 'sonic.menu.page', order: 120, section: 'tools', href: modeStartPage };

/** What of the flight the link to the mode takes: the scan flown and its size now (FlightSession; absent before a flight). */
export interface FlownScan {
    readonly builtin?: unknown;
    readonly scene?: { readonly id: string } | null;
    readonly transform?: { readonly s: number } | null;
}

/**
 * Train 2 (the owner: "if I already fly by sound I just want to try other interiors and exteriors"): the mode's start screen for THIS
 * scan, /{lang}/fly/?sonic=scan&scene=<id>&sz=<size>, so a pilot who flies by sound can fly it at the size he flies it now (the size
 * written as a shared link writes it, 3 places). A built-in world (no scan) or no flight: the plain start screen.
 */
export function modeScanPage(ses: FlownScan | null | undefined, search = ''): string {
    const id = ses && !ses.builtin ? ses.scene?.id ?? '' : '';
    const s = ses?.transform?.s;
    if (id === '' || typeof s !== 'number' || !Number.isFinite(s) || s <= 0) return modeStartPage();
    // S3: the course the page's address names (Shift+G writes course=g1.<seed>) goes along, so N on the sound page flies that course
    // first (sonic/feature.ts courseOf reads it with soundCourseSeed); under the mode's own name, never course= (review SN-4: that
    // name starts the sighted course feature, its gates, lap clock and best laps, on the sound page); anything else stays behind
    const seed = seedOfLink(search);
    const course = seed === null ? '' : `&${SOUND_COURSE_PARAM}=${seed.toString(36)}`;
    return `/${pageLang()}/fly/?sonic=scan&scene=${encodeURIComponent(id)}&sz=${sharedNumber(s, 3)}${course}`;
}

export const sonicFlight: Feature = {
    id: 'sonic-flight',
    install(ctx) {
        const entry = sonicEntry();
        const install = sonicInstaller();
        if (entry) return install ? install(ctx, entry) : undefined;
        // the menu shows it as a link (MenuItem.href) to the mode's start screen for the scan flown now, read when the menu opens; it
        // stays a new tab (as before): the flight is left paused under the menu, and the pilot comes back to it where he was. run()
        // is the same page for a caller that runs items
        // location: a page always has it; Node (unit tests) does not (review SN-1)
        const href = (): string => modeScanPage((ctx as { session?: FlownScan }).session, typeof location === 'undefined' ? '' : location.search);
        return ctx.menu.add({ ...SOUND_PAGE_ITEM, href, run: () => void open(href(), '_blank', 'noopener') });
    }
};
