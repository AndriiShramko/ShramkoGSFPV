// The menu level of every pause-menu item (docs/wip/menu-plan.md 2.2; the owner's three kinds of new pilot).
// One table, beside the settings' table (packages/prefs/src/defs/levels.ts), so the three pause menus are read
// and changed in one place. An item missing here is `expert`: added later, it is never lost, only collapsed
// under "More". A hidden item stays in the menu (in "More") and its key runs it while the menu is up.
import { levelShows, MENU_LEVELS } from '@gsfpv/prefs';
import type { MenuLevel, PrefsStore } from '@gsfpv/prefs';
import { pilotSet } from './prefs';

export const PAUSE_LEVELS: Readonly<Record<string, MenuLevel>> = {
    // first: fly, start again, another place, the controls, how to fly, the settings, a report; Fly by Sound is the
    // way in for blind pilots, so it stays at every level
    'pause.continue': 'first',
    'pause.restart': 'first',
    'pause.scene': 'first',
    'pause.radio': 'first',
    'pause.howtofly': 'first',
    'pause.settings': 'first',
    'pause.feedback': 'first',
    'pause.flyBySound': 'first',
    'pause.flyBySoundLessons': 'first',
    // sim: what a pilot of another simulator looks for
    'pause.rewind': 'sim',
    'pause.share': 'sim',
    'pause.drone': 'sim',
    'pause.replays': 'sim',
    'pause.course': 'sim',
    'pause.course.toggle': 'sim',
    'pause.sound': 'sim',
    'pause.rooms': 'sim',
    'pause.sonic': 'sim',
    'pause.sonic.lessonMenu': 'sim'
    // expert (absent): sceneDefault, course load / save / edit, measure, import, cinema, record
};

/** An item's menu level: its row of PAUSE_LEVELS, else expert. */
export function pauseLevel(id: string): MenuLevel {
    return PAUSE_LEVELS[id] ?? 'expert';
}

/** A stored menu level, or expert for anything else (an old profile, a test page without the setting). */
export function asMenuLevel(v: unknown): MenuLevel {
    return MENU_LEVELS.includes(v as MenuLevel) ? (v as MenuLevel) : 'expert';
}

/** True when a pilot at `level` finds the item under "More" rather than in the menu's first list. */
export function inMore(id: string, level: MenuLevel): boolean {
    return !levelShows(level, pauseLevel(id));
}

/** Where the pause menu reads the pilot's level and where "Always show everything" writes it. */
export interface MenuLevelSource {
    level(): MenuLevel;
    /** the pilot asked to see every item and every setting from now on */
    showAll(): void;
}

/** The pilot's setting `ui.menuLevel` (Settings, Display, Menu; the question in "Before you fly"). */
export function prefsLevels(store: PrefsStore): MenuLevelSource {
    return {
        level: () => asMenuLevel(store.get('ui.menuLevel')),
        showAll: () => { pilotSet(store, 'ui.menuLevel', 'expert'); }
    };
}

/** Without a source (bench pages, tests that make a bare PauseMenu): every item shows, nothing collapses. */
export const EXPERT_LEVEL: MenuLevelSource = { level: () => 'expert', showAll: () => undefined };
