// The pure part of the gate bar (gate-bar.ts, lane editor3 E2.4): its buttons as editor key rows and where it goes on the
// page. No DOM and no i18n here, so the unit test loads it (tools/bench/test/editor3-gatebar.test.ts).
import type { KeyPress } from './keys';

/** the bar sits this far right of the gate's centre, CSS px (an estimate: clear of the handles' arrows) */
export const BAR_OFFSET_PX = 150;

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

/** Where the bar goes for a gate at (x, y) on a page w by h: right of it, kept inside the page; null hides it. */
export function barPlace(at: readonly [number, number, number] | null, w: number, h: number, barW: number, barH: number): [number, number] | null {
    if (!at || !(at[2] > 0) || !Number.isFinite(at[0]) || !Number.isFinite(at[1])) return null;
    if (at[0] < 0 || at[0] > w || at[1] < 0 || at[1] > h) return null;
    let x = at[0] + BAR_OFFSET_PX;
    if (x + barW > w - 8) x = at[0] - BAR_OFFSET_PX - barW;
    x = Math.max(8, Math.min(w - barW - 8, x));
    const y = Math.max(8, Math.min(h - barH - 8, at[1] - barH / 2));
    return [Math.round(x), Math.round(y)];
}

/** One button of the top bar: a key row it runs, or 'add' (the next click on the scene puts a gate). */
export const TOP_BUTTONS: readonly { readonly id: string; readonly labelKey: string; readonly press: KeyPress | 'add' }[] = [
    { id: 'add', labelKey: 'course.edit.bar.add', press: 'add' },
    { id: 'undo', labelKey: 'course.edit.key.undo', press: { code: 'KeyZ', ctrlKey: true } },
    { id: 'redo', labelKey: 'course.edit.key.redo', press: { code: 'KeyY', ctrlKey: true } },
    { id: 'exit', labelKey: 'course.edit.key.exit', press: { code: 'Escape' } }
];
