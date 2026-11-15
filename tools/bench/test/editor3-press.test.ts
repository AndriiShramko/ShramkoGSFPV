// Lane editor3 E4: one press belongs to one handle (apps/fly/src/course/editor/press-owner.ts). The E2 smoke on Wroclaw saw a
// drag on the centre box move the gate 0.3 m and leave its opening: the move and the scale handles both took the press.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PRESS_ORDER, pressOwner } from '../../../apps/fly/src/course/editor/press-owner';

const ROOT = join(__dirname, '..', '..', '..');
const view = readFileSync(join(ROOT, 'apps/fly/src/course/editor/view-mouse.ts'), 'utf8');

describe('editor3 E4: one handle owns a press', () => {
    it('the scale box is asked first, then the move handle, then the rings', () => {
        expect(PRESS_ORDER).toEqual(['size', 'move', 'turn']);
        expect(pressOwner([true, true, false])).toBe(0);
        expect(pressOwner([false, true, true])).toBe(1);
        expect(pressOwner([false, false, true])).toBe(2);
        expect(pressOwner([false, false, false])).toBe(-1);
    });

    it('the edit view decides the owner in a capture listener before the gizmos and switches the others off', () => {
        expect(view).toMatch(/addEventListener\('pointerdown', this\.onOwnPress, true\)/);
        expect(view).toMatch(/this\.byPress = \[size, move, turn\]/);
        expect(view).toMatch(/h\.enabled = false/);
        expect(view).toMatch(/removeEventListener\('pointerdown', this\.onOwnPress, true\)/);
    });
});
