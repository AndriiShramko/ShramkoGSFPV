// Lane voxview V4: the walls and voxel panel stays inside the view at the owner's small sizes and
// its top (the header with the close button) is always on screen.
import { describe, expect, it } from 'vitest';
import { placePanel, PANEL_MARGIN } from '../../../apps/fly/src/ui/voxel-panel';

/** the panel's box for a content height h (it grows to h, never past maxHeight) */
function box(chip: { left: number; top: number; right: number; bottom: number }, w: number, hView: number, h: number) {
    const p = placePanel(chip, w, hView);
    const height = Math.min(h, p.maxHeight);
    const top = p.top !== null ? p.top : hView - (p.bottom as number) - height;
    return { left: p.left, top, right: p.left + p.width, bottom: top + height, place: p };
}

// the chip on the credit line: bottom left on a desktop (bottom 40 px), top left on a phone under the pad hint
const sizes: Array<[number, number, { left: number; top: number; right: number; bottom: number }]> = [
    [1366, 768, { left: 16, top: 712, right: 110, bottom: 728 }],
    [1280, 720, { left: 16, top: 664, right: 110, bottom: 680 }],
    [844, 390, { left: 16, top: 334, right: 110, bottom: 350 }],
    [390, 844, { left: 16, top: 190, right: 110, bottom: 206 }],
    // a chip low on a very short view: no room on either side
    [844, 230, { left: 16, top: 174, right: 110, bottom: 190 }]
];

describe('voxel panel placement (V4)', () => {
    for (const [w, h, chip] of sizes) {
        it(`${w}x${h}: the whole panel is inside the view, its top on screen`, () => {
            // 463 px: the measured height of the old menu (panel-before.json); 900: a taller one
            for (const content of [120, 463, 900]) {
                const b = box(chip, w, h, content);
                expect(b.left).toBeGreaterThanOrEqual(PANEL_MARGIN);
                expect(b.right).toBeLessThanOrEqual(w - PANEL_MARGIN);
                expect(b.top).toBeGreaterThanOrEqual(PANEL_MARGIN);
                expect(b.bottom).toBeLessThanOrEqual(h - PANEL_MARGIN);
                expect(b.place.maxHeight).toBeGreaterThan(0);
            }
        });
    }
    it('opens above a chip in the lower half and under a chip in the upper half', () => {
        const low = placePanel({ left: 16, top: 712, right: 110, bottom: 728 }, 1366, 768);
        expect(low.top).toBeNull();
        expect(low.bottom).toBe(768 - 712 + 4);
        const high = placePanel({ left: 16, top: 190, right: 110, bottom: 206 }, 390, 844);
        expect(high.bottom).toBeNull();
        expect(high.top).toBe(210);
    });
    it('the panel does not cover the chip when there is room', () => {
        const chip = { left: 16, top: 334, right: 110, bottom: 350 };
        const b = box(chip, 844, 390, 900);
        expect(b.bottom).toBeLessThanOrEqual(chip.top);
    });
});
