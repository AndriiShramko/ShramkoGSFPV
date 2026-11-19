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

/** G2: the point the bar follows: none while the drone flies (hidden) or while a handle really drags; else the gate's */
export function barAnchor<T>(hidden: boolean, dragging: boolean, where: T | null): T | null {
    return hidden || dragging ? null : where;
}

/** A box on the page the bar must not lie over (the editor's window, the top bar): left, top, width, height, CSS px. */
export type BarRect = readonly [number, number, number, number];

/** the gap kept between the bar and the page's edge or a box it keeps clear of, CSS px */
const BAR_GAP_PX = 8;

function overlaps(x: number, y: number, bw: number, bh: number, r: BarRect): boolean {
    return x < r[0] + r[2] && r[0] < x + bw && y < r[1] + r[3] && r[1] < y + bh;
}

/** Where the bar goes for a gate at (x, y) on a page w by h: centred under the handles, above them when there is no room
 * below, at the page's bottom edge when neither fits (a phone); kept inside the page; null hides it. Lane edit4a A3: never
 * over a box of `keep` (the owner: nothing lies over another thing; at 844x390 the bar above the gate lay over the editor's
 * window): on each of those rows it moves left or right of the box, and takes the next row when it cannot. */
export function barPlace(at: readonly [number, number, number] | null, w: number, h: number, barW: number, barH: number, keep: readonly BarRect[] = []): [number, number] | null {
    if (!at || !(at[2] > 0) || !Number.isFinite(at[0]) || !Number.isFinite(at[1])) return null;
    if (at[0] < 0 || at[0] > w || at[1] < 0 || at[1] > h) return null;
    const g = BAR_GAP_PX;
    const clampX = (x: number): number => Math.max(g, Math.min(w - barW - g, x));
    const rows: number[] = [];
    const below = at[1] + BAR_CLEAR_PX;
    const up = at[1] - BAR_CLEAR_PX - barH;
    if (below + barH <= h - g) rows.push(below);
    if (up >= g) rows.push(up);
    rows.push(h - barH - g);
    const xs = [clampX(at[0] - barW / 2), ...keep.flatMap((r) => [clampX(r[0] - g - barW), clampX(r[0] + r[2] + g)])];
    for (const y0 of rows) {
        const y = Math.max(g, y0);
        const x = xs.find((cx) => !keep.some((r) => overlaps(cx, y, barW, barH, r)));
        if (x !== undefined) return [Math.round(x), Math.round(y)];
    }
    return [Math.round(xs[0]!), Math.round(Math.max(g, rows[0]!))];
}

// lane edit4a A2: the Move, Turn and Size tools (TOOLS, keys M R T) are gone: the one gizmo has all three parts at once
// (the owner, brief 543); its parts are named by handle-look.ts Handle.

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
