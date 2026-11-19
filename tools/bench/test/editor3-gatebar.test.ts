// Lane editor3, stage E2.4 (docs/wip/editor3.md "The design"): the small bar next to the selected gate. Every button runs an
// editor key (the same thing a key press does), and the bar sits right of the gate, inside the page, hidden when the gate is
// behind the camera or off the page.
import { describe, expect, it } from 'vitest';
import { BAR_BUTTONS, BAR_CLEAR_PX, barPlace } from '../../../apps/fly/src/course/editor/bar-place';
import { editorKey } from '../../../apps/fly/src/course/editor/keys';

describe('editor3 gate bar', () => {
    it('every button is an editor key: kind 1-4, duplicate, delete, previous and next gate', () => {
        const ids = BAR_BUTTONS.map((b) => b.id);
        expect(ids).toEqual(['prev', 'ring', 'square', 'dive', 'cube', 'duplicate', 'delete', 'next']);
        for (const b of BAR_BUTTONS) expect(editorKey(b.press, [0, -1]), b.id).not.toBeNull();
        const sel = (id: string): unknown => editorKey(BAR_BUTTONS.find((b) => b.id === id)!.press, [0, -1]);
        expect(JSON.stringify(sel('next'))).not.toEqual(JSON.stringify(sel('prev')));
    });

    it('H1 pass 2: sits under the handles (not on the X arrow), above them near the bottom, inside the page', () => {
        // centred under the gate, clear of the handles' reach
        expect(barPlace([400, 300, 5], 1280, 800, 300, 40)).toEqual([250, 300 + BAR_CLEAR_PX]);
        // never on the gate's own row to the right (where the X arrow points)
        const p = barPlace([960, 540, 3], 1920, 1080, 410, 40)!;
        expect(p[1]).toBeGreaterThanOrEqual(540 + BAR_CLEAR_PX);
        // no room below: above the handles
        expect(barPlace([400, 700, 5], 1280, 800, 300, 40)).toEqual([250, 700 - BAR_CLEAR_PX - 40]);
        // a phone (844x390): neither fits, the bottom edge, inside the page
        expect(barPlace([422, 195, 3], 844, 390, 410, 40)).toEqual([217, 342]);
        const right = barPlace([1200, 300, 5], 1280, 800, 300, 40)!;
        expect(right[0] + 300).toBeLessThanOrEqual(1272);
    });

    it('lane edit4a A3: never over the editor window or the top bar (844x390, drawn run 3 of the edit4a probe)', () => {
        // the gate at (405, 307), bar 390x54: above the gate (y 43) lay over the editor's window [400, 86, 380, 35]
        const keep = [[400, 86, 380, 35], [8, 109, 381, 52]] as const;
        const p = barPlace([405, 307, 54], 844, 390, 390, 54, keep)!;
        const over = (r: readonly number[]): boolean => p[0] < r[0]! + r[2]! && r[0]! < p[0] + 390 && p[1] < r[1]! + r[3]! && r[1]! < p[1] + 54;
        expect(keep.filter(over)).toEqual([]);
        // the row above the gate is kept (it moved left of the window), inside the page
        expect(p).toEqual([8, 43]);
        // no box in the way: the same place as before
        expect(barPlace([405, 307, 54], 844, 390, 390, 54, [[600, 300, 100, 30]])).toEqual(barPlace([405, 307, 54], 844, 390, 390, 54));
        // no row is free: the first row centred (as before), never off the page
        const full = barPlace([400, 300, 5], 1280, 800, 300, 40, [[0, 0, 1280, 800]])!;
        expect(full).toEqual([250, 300 + BAR_CLEAR_PX]);
    });

    it('is hidden for no gate, a gate behind the camera or off the page', () => {
        expect(barPlace(null, 1280, 800, 300, 40)).toBeNull();
        expect(barPlace([400, 300, -2], 1280, 800, 300, 40)).toBeNull();
        expect(barPlace([-50, 300, 5], 1280, 800, 300, 40)).toBeNull();
        expect(barPlace([400, 900, 5], 1280, 800, 300, 40)).toBeNull();
    });
});
