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
import type { Feature, MenuItem } from '../context';

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

export const sonicFlight: Feature = {
    id: 'sonic-flight',
    install(ctx) {
        const entry = sonicEntry();
        const install = sonicInstaller();
        if (entry) return install ? install(ctx, entry) : undefined;
        // the menu shows it as a link (MenuItem.href); run() is the same page for a caller that runs items
        return ctx.menu.add({ ...SOUND_PAGE_ITEM, run: () => void open(modeStartPage(), '_blank', 'noopener') });
    }
};
