// Lane editor3, stage E2.4 (docs/wip/editor3.md "The design"): the small bar next to the selected gate. Every button runs an
// editor key (the same thing a key press does), and the bar sits right of the gate, inside the page, hidden when the gate is
// behind the camera or off the page.
import { describe, expect, it } from 'vitest';
import { BAR_BUTTONS, BAR_OFFSET_PX, barPlace } from '../../../apps/fly/src/course/editor/bar-place';
import { editorKey } from '../../../apps/fly/src/course/editor/keys';

describe('editor3 gate bar', () => {
    it('every button is an editor key: kind 1-4, insert, delete, previous and next gate', () => {
        const ids = BAR_BUTTONS.map((b) => b.id);
        expect(ids).toEqual(['prev', 'ring', 'square', 'dive', 'cube', 'insert', 'delete', 'next']);
        for (const b of BAR_BUTTONS) expect(editorKey(b.press, [0, -1]), b.id).not.toBeNull();
        const sel = (id: string): unknown => editorKey(BAR_BUTTONS.find((b) => b.id === id)!.press, [0, -1]);
        expect(JSON.stringify(sel('next'))).not.toEqual(JSON.stringify(sel('prev')));
    });

    it('sits right of the gate, flips left at the page edge, stays inside the page', () => {
        expect(barPlace([400, 300, 5], 1280, 800, 300, 40)).toEqual([400 + BAR_OFFSET_PX, 280]);
        const right = barPlace([1200, 300, 5], 1280, 800, 300, 40)!;
        expect(right[0] + 300).toBeLessThanOrEqual(1272);
        expect(right[0]).toBeLessThan(1200);
        expect(barPlace([400, 2, 5], 1280, 800, 300, 40)![1]).toBe(8);
    });

    it('is hidden for no gate, a gate behind the camera or off the page', () => {
        expect(barPlace(null, 1280, 800, 300, 40)).toBeNull();
        expect(barPlace([400, 300, -2], 1280, 800, 300, 40)).toBeNull();
        expect(barPlace([-50, 300, 5], 1280, 800, 300, 40)).toBeNull();
        expect(barPlace([400, 900, 5], 1280, 800, 300, 40)).toBeNull();
    });
});
