// Lane editor3, stage I3-prove pass 3 (docs/wip/editor3.md I3.5 c): the axis guide line of a transform gizmo is drawn only
// while a handle is dragged, not for the axis that merely lies under the mouse (after a Move drag the pointer rests on the
// X arrow and PlayCanvas 2.23.2 drew a red line across the whole view).
import { describe, expect, it } from 'vitest';
import * as look from '../../../apps/fly/src/course/editor/handle-look';

/** a stand-in of the PlayCanvas gizmo's guide drawing: counts the lines it draws */
class FakeGizmo {
    dragging = false;
    drawn = 0;
    get _dragging(): boolean {
        return this.dragging;
    }
    _drawGuideLines(): void {
        this.drawn += 1;
    }
    prerender(hoverAxis: string): void {
        // PlayCanvas: activeAxis = hover || selected, then _drawGuideLines for it
        if (hoverAxis) this._drawGuideLines();
    }
}

describe('editor3 I3: the axis guide only while dragging', () => {
    it('the helper exists', () => {
        expect(typeof (look as Record<string, unknown>).guideOnlyWhileDragging).toBe('function');
    });

    it('hover alone draws no guide line; a drag draws it; after the drag none again', () => {
        const g = new FakeGizmo();
        const wrap = (look as Record<string, unknown>).guideOnlyWhileDragging as ((x: unknown) => void) | undefined;
        wrap?.(g);
        g.prerender('x');
        expect(g.drawn).toBe(0);
        g.dragging = true;
        g.prerender('x');
        expect(g.drawn).toBe(1);
        g.dragging = false;
        g.prerender('x');
        expect(g.drawn).toBe(1);
    });

    it('a gizmo without the method is left alone', () => {
        const wrap = (look as Record<string, unknown>).guideOnlyWhileDragging as ((x: unknown) => void) | undefined;
        expect(() => wrap?.({})).not.toThrow();
    });
});
