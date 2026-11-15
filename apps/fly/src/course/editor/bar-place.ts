// The pure part of the gate bar (gate-bar.ts, lane editor3 E2.4): its buttons as editor key rows and where it goes on the
// page. No DOM and no i18n here, so the unit test loads it (tools/bench/test/editor3-gatebar.test.ts).
import type { KeyPress } from './keys';

/** H1 pass 2: the bar sits this far below (or above) the gate's centre, CSS px, clear of the shown handles. Measured by
 * tools/bench/src/editor3-prove.ts (walk with __gsfpvEditHit, 1920x1080, U:/Temp/gsfpv-train3/editor3/h1/after1): the ring
 * of the Turn set reached 148-190 px from the centre on Tunis; the bar placed 150 px right covered the X arrow's head. */
export const BAR_CLEAR_PX = 210;

/** One button of the bar: the key row it runs and its drawing (a 20 px SVG path). */
export const BAR_BUTTONS: readonly { readonly id: string; readonly labelKey: string; readonly press: KeyPress; readonly path: string }[] = [
    { id: 'prev', labelKey: 'course.edit.key.prev', press: { code: 'Tab', shiftKey: true }, path: 'M13 4 L6 10 L13 16' },
    { id: 'ring', labelKey: 'course.edit.key.ring', press: { code: 'Digit1' }, path: 'M10 3 A7 7 0 1 0 10.01 3 Z' },
    { id: 'square', labelKey: 'course.edit.key.square', press: { code: 'Digit2' }, path: 'M4 4 H16 V16 H4 Z' },
    { id: 'dive', labelKey: 'course.edit.key.dive', press: { code: 'Digit3' }, path: 'M3 7 H17 L14 15 H6 Z' },
    { id: 'cube', labelKey: 'course.edit.key.cube', press: { code: 'Digit4' }, path: 'M4 7 L10 4 L16 7 V14 L10 17 L4 14 Z M4 7 L10 10 L16 7 M10 10 V17' },
    // the editor's insert is a copy of the selected gate a few metres ahead (packages/tracks editor.ts): the owner's Duplicate
    { id: 'duplicate', labelKey: 'course.edit.bar.duplicate', press: { code: 'Insert' }, path: 'M7 7 H16 V16 H7 Z M4 13 V4 H13' },
    { id: 'delete', labelKey: 'course.edit.key.delete', press: { code: 'Delete' }, path: 'M5 5 L15 15 M15 5 L5 15' },
    { id: 'next', labelKey: 'course.edit.key.next', press: { code: 'Tab' }, path: 'M7 4 L14 10 L7 16' }
];

/** Where the bar goes for a gate at (x, y) on a page w by h: centred under the handles, above them when there is no room
 * below, at the page's bottom edge when neither fits (a phone); kept inside the page; null hides it. */
export function barPlace(at: readonly [number, number, number] | null, w: number, h: number, barW: number, barH: number): [number, number] | null {
    if (!at || !(at[2] > 0) || !Number.isFinite(at[0]) || !Number.isFinite(at[1])) return null;
    if (at[0] < 0 || at[0] > w || at[1] < 0 || at[1] > h) return null;
    const x = Math.max(8, Math.min(w - barW - 8, at[0] - barW / 2));
    let y = at[1] + BAR_CLEAR_PX;
    if (y + barH > h - 8) {
        const up = at[1] - BAR_CLEAR_PX - barH;
        y = up >= 8 ? up : h - barH - 8;
    }
    return [Math.round(x), Math.round(Math.max(8, y))];
}

/** Lane editor3 H1 (the lead's decision of 2026-11-15): one set of handles at a time, as in ordinary 3D editors. All three
 * on the gate at once put the rings, the arrows and the scale box under one press near the centre. */
export type Tool = 'move' | 'turn' | 'size';

/** the gate bar's three handle buttons and their keys (letters the edit camera's W A S D E Q and the editor's keys leave free) */
export const TOOLS: readonly { readonly id: Tool; readonly labelKey: string; readonly code: string; readonly caps: string; readonly path: string }[] = [
    { id: 'move', labelKey: 'course.edit.tool.move', code: 'KeyM', caps: 'M', path: 'M10 2 V18 M2 10 H18 M7 5 L10 2 L13 5 M7 15 L10 18 L13 15 M5 7 L2 10 L5 13 M15 7 L18 10 L15 13' },
    { id: 'turn', labelKey: 'course.edit.tool.turn', code: 'KeyR', caps: 'R', path: 'M16 10 A6 6 0 1 1 13 4.8 M13 1.5 V5 H16.5' },
    { id: 'size', labelKey: 'course.edit.tool.size', code: 'KeyT', caps: 'T', path: 'M3 9 V17 H11 V9 Z M11 9 L17 3 M12 3 H17 V8' }
];

/** the handle a key picks (no modifier held), null: not a handle key */
export function toolOfKey(code: string, mods: boolean): Tool | null {
    if (mods) return null;
    return TOOLS.find((x) => x.code === code)?.id ?? null;
}

/** the handle shown after put(): Move whenever another gate gets selected, else the one chosen */
export function toolAfter(tool: Tool, prevGate: string | number | null, gate: string | number | null): Tool {
    return gate !== prevGate ? 'move' : tool;
}

/** what a top bar button does that is not a key row: arm Add gate, or open the window at its courses or its keys */
export type TopPress = 'add' | 'courses' | 'keys';

/** One button of the top bar: a key row it runs, or a TopPress. Review ED-7: Save, Courses and Keys as in the design. */
export const TOP_BUTTONS: readonly { readonly id: string; readonly labelKey: string; readonly press: KeyPress | TopPress }[] = [
    { id: 'add', labelKey: 'course.edit.bar.add', press: 'add' },
    // lane editor3 H1: the top bar's own words, each with a capital letter (the key.* texts are lower-case sentence parts)
    { id: 'undo', labelKey: 'course.edit.bar.undo', press: { code: 'KeyZ', ctrlKey: true } },
    { id: 'redo', labelKey: 'course.edit.bar.redo', press: { code: 'KeyY', ctrlKey: true } },
    { id: 'save', labelKey: 'course.edit.bar.save', press: { code: 'KeyS', ctrlKey: true } },
    { id: 'courses', labelKey: 'course.edit.bar.courses', press: 'courses' },
    { id: 'keys', labelKey: 'course.edit.bar.keys', press: 'keys' },
    { id: 'exit', labelKey: 'course.edit.bar.exit', press: { code: 'Escape' } }
];
