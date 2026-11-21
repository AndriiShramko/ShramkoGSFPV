// Lane editor3 E4: one press belongs to one handle (apps/fly/src/course/editor/press-owner.ts). The E2 smoke on Wroclaw saw a
// drag on the centre box move the gate 0.3 m and leave its opening: the move and the scale handles both took the press.
// Train 4 edit4a A2 (the owner, brief 543: arrows, boxes and rings on the gate at once): the owner is the handle whose shape
// under the cursor is nearest the eye; on an equal distance the earlier one in PRESS_ORDER (the centre box first).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PRESS_ORDER, pressOwner } from '../../../apps/fly/src/course/editor/press-owner';

const ROOT = join(__dirname, '..', '..', '..');
const view = readFileSync(join(ROOT, 'apps/fly/src/course/editor/view-mouse.ts'), 'utf8');

describe('editor3 E4: one handle owns a press', () => {
    it('the nearest shape owns it; a tie goes to the scale box, then the move handle, then the rings', () => {
        expect(PRESS_ORDER).toEqual(['size', 'move', 'turn']);
        expect(pressOwner([4, 4, null])).toBe(0);
        expect(pressOwner([null, 3, 3])).toBe(1);
        expect(pressOwner([null, null, 2])).toBe(2);
        expect(pressOwner([null, null, null])).toBe(-1);
    });

    it('the edit view decides the owner in a capture listener before the gizmos and switches the others off', () => {
        expect(view).toMatch(/addEventListener\('pointerdown', this\.onOwnPress, true\)/);
        expect(view).toMatch(/this\.byPress = \[size, move, turn\]/);
        expect(view).toMatch(/h\.enabled = false/);
        expect(view).toMatch(/removeEventListener\('pointerdown', this\.onOwnPress, true\)/);
    });
});
