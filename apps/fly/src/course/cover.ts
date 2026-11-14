// Train 2 integration (owner: "the clock and all these statistics lie over the menu that we call with Escape"): the course's
// lap block (course/hud.ts) is not drawn while a full window is up. Plain rule, no DOM, so the unit test
// (tools/bench/test/course-hud-cover.test.ts) imports it without a page; the page check is
// tools/bench/scripts/pause-over-course-probe.mjs.

/** the class course/hud.css hides the block by */
export const COVERED_CLASS = 'course-covered';

/**
 * The pause reasons (app/context.ts PauseReason) that put a window over the flight view: the pause menu, a panel (editor,
 * feedback, drone, how to fly, rooms), the controls screen, the video export and the help card. A hidden tab ('hidden') and a
 * scene that is still loading ('scene') draw no window, so the block stays.
 */
const WINDOWS: readonly string[] = ['menu', 'panel', 'controls', 'export', 'help'];

/** True while any held pause reason draws a window over the flight view. */
export function coveredBy(reasons: readonly string[]): boolean {
    return reasons.some((r) => WINDOWS.includes(r));
}
