// Lane uiaudit A2: the pure rules of the one panel pattern (apps/fly/src/ui/panel-head.ts).
// U1: Esc closes the top panel (highest z-index, the later one on a tie), not simply the last in the page.
// U2: a panel is whole inside the view; when it is taller it scrolls inside itself from the margin.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../apps/fly/src/ui/panel-head.css', () => ({}));
const { topLayer, fitInView } = await import('../../../apps/fly/src/ui/panel-head');

describe('topLayer (Esc closes the top panel)', () => {
    it('picks the highest z-index even when it is earlier in the page', () => {
        expect(topLayer([{ z: 30, order: 0 }, { z: 5, order: 1 }])).toBe(0);
    });
    it('picks the later one on a tie', () => {
        expect(topLayer([{ z: 5, order: 0 }, { z: 5, order: 1 }, { z: 5, order: 2 }])).toBe(2);
    });
    it('none open: -1', () => {
        expect(topLayer([])).toBe(-1);
    });
});

describe('fitInView (the panel size rule)', () => {
    it('the walls menu at 844x390 (A1: 250x463 at y 123) starts at the margin and scrolls', () => {
        const f = fitInView({ left: 16, top: 123, width: 250, height: 463 }, { w: 844, h: 390 });
        expect(f.top).toBe(8);
        expect(f.maxHeight).toBe(374);
        expect(f.scrolls).toBe(true);
    });
    it('a panel that fits keeps its place and does not scroll', () => {
        const f = fitInView({ left: 16, top: 257, width: 250, height: 463 }, { w: 1366, h: 768 });
        expect(f).toEqual({ left: 16, top: 257, maxWidth: 1350, maxHeight: 503, scrolls: false });
    });
    it('a panel below the view moves up just enough', () => {
        const f = fitInView({ left: 16, top: 500, width: 250, height: 200 }, { w: 1280, h: 600 });
        expect(f.top).toBe(392);
        expect(f.top + 200).toBeLessThanOrEqual(600 - 8);
    });
    it('a panel wider than a phone is held inside the width', () => {
        const f = fitInView({ left: 300, top: 20, width: 560, height: 100 }, { w: 390, h: 844 });
        expect(f.left).toBe(8);
        expect(f.maxWidth).toBe(374);
    });
});
