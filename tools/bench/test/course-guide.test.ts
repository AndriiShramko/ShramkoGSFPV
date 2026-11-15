// Lane fix3a, stage X2-gate-one: the guide to the next gate (apps/fly/src/course/guide.ts). A camera at the origin looking
// along -z (right +x, up +y), 115 deg horizontal fov at 1280x800, as the page's default camera.
import { describe, expect, it } from 'vitest';
import { GUIDE_MARGIN_PX, GUIDE_NEAR_M, aimOf, placeGuide } from '../../../apps/fly/src/course/guide';
import type { GuideCamera } from '../../../apps/fly/src/course/guide';

const tanH = Math.tan((115 * Math.PI) / 360);
const cam: GuideCamera = { pos: [0, 0, 0], right: [1, 0, 0], up: [0, 1, 0], fwd: [0, 0, -1], tanH, tanV: tanH / 1.6 };

describe('course guide: where the next gate is', () => {
    it('a near gate straight ahead hides the guide', () => {
        const a = aimOf(cam, [0, 0, -(GUIDE_NEAR_M - 2)]);
        expect(a.inFrame).toBe(true);
        expect(a.hide).toBe(true);
        expect(a.metres).toBe(GUIDE_NEAR_M - 2);
    });
    it('a far gate ahead shows the guide over the gate, with whole metres', () => {
        const a = aimOf(cam, [3, 4, -40.4]);
        expect(a.inFrame).toBe(true);
        expect(a.hide).toBe(false);
        expect(a.metres).toBe(Math.round(Math.hypot(3, 4, 40.4)));
        expect(a.side).toBe('right');
    });
    it('a gate behind on the right: behind, side right, the arrow points right', () => {
        const a = aimOf(cam, [2, 0, 15]);
        expect(a.behind).toBe(true);
        expect(a.hide).toBe(false);
        expect(a.side).toBe('right');
        expect(a.dir[0]).toBe(1);
        expect(a.bearingDeg).toBeGreaterThan(90);
    });
    it('a gate behind on the left: side left', () => {
        const a = aimOf(cam, [-2, 0, 15]);
        expect(a.side).toBe('left');
        expect(a.dir[0]).toBe(-1);
        expect(a.bearingDeg).toBeLessThan(-90);
    });
    it('a near gate out of the frame to the left still shows the guide', () => {
        const a = aimOf(cam, [-8, 0, -1]);
        expect(a.inFrame).toBe(false);
        expect(a.hide).toBe(false);
        expect(a.side).toBe('left');
    });
});

describe('course guide: where the arrow goes', () => {
    const W = 844, H = 390, w = 110, h = 30;
    const inside = (p: { x: number; y: number }): boolean =>
        p.x - w / 2 >= GUIDE_MARGIN_PX - 0.01 && p.x + w / 2 <= W - GUIDE_MARGIN_PX + 0.01 && p.y - h / 2 >= GUIDE_MARGIN_PX - 0.01 && p.y + h / 2 <= H - GUIDE_MARGIN_PX + 0.01;
    it('stays inside an 844x390 screen for gates all around', () => {
        for (let deg = 0; deg < 360; deg += 15) {
            const r = (deg * Math.PI) / 180;
            const p = placeGuide(aimOf(cam, [Math.sin(r) * 30, 6, -Math.cos(r) * 30]), W, H, w, h, []);
            expect(inside(p), `bearing ${deg}`).toBe(true);
        }
    });
    it('a gate behind on the right puts it on the right half; on the left, the left half', () => {
        expect(placeGuide(aimOf(cam, [2, 0, 15]), W, H, w, h, []).x).toBeGreaterThan(W / 2);
        expect(placeGuide(aimOf(cam, [-2, 0, 15]), W, H, w, h, []).x).toBeLessThan(W / 2);
    });
    it('never meets the note or the lap block: it goes under them', () => {
        const note = { left: 200, top: 44, right: 644, bottom: 110 };
        const block = { left: 360, top: 120, right: 484, bottom: 230 };
        for (let deg = 0; deg < 360; deg += 15) {
            const r = (deg * Math.PI) / 180;
            const p = placeGuide(aimOf(cam, [Math.sin(r) * 30, 25, -Math.cos(r) * 30]), W, H, w, h, [note, block]);
            for (const b of [note, block]) {
                const meets = p.x - w / 2 < b.right && p.x + w / 2 > b.left && p.y - h / 2 < b.bottom && p.y + h / 2 > b.top;
                expect(meets, `bearing ${deg}`).toBe(false);
            }
        }
    });
});
