// Lane tracks2, stage K2.6: on a narrow or low screen the editor's window covers the right part of the view; the camera
// looks right of the selected gate so that the gate sits in the middle of the free left part
// (apps/fly/src/course/editor/camera.ts aimAt, used by app/builtin/course.ts).
import { describe, expect, it } from 'vitest';
import * as cam from '../../../apps/fly/src/course/editor/camera';
import type { V3 } from '../../../apps/fly/src/course/editor/camera';

const H_FOV = 115; // the renderer's default horizontal field (packages/render-pc/src/renderer.ts)

describe('the editor camera beside the window', () => {
    it('puts the gate in the middle of the free left part, for gates all around', () => {
        expect(typeof cam.aimAt).toBe('function');
        const eye: V3 = [1, 2, -3];
        for (let k = 0; k < 12; k++) {
            const a = (k / 12) * Math.PI * 2;
            const gate: V3 = [eye[0] + Math.cos(a) * 3.5, eye[1] - 0.6, eye[2] + Math.sin(a) * 3.5];
            for (const free of [0.3, 0.45, 0.6, 0.8]) {
                const look = cam.aimAt(eye, gate, free, H_FOV);
                expect(cam.screenX(gate, eye, look, H_FOV)).toBeCloseTo(free / 2, 6);
                // the eye stays, the look keeps the gate's height
                expect(look[1]).toBeCloseTo(gate[1], 9);
            }
        }
    });
    it('looks straight at the gate with no window, a full-width window, or a broken field', () => {
        const eye: V3 = [0, 1, 0];
        const gate: V3 = [0, 1, 4];
        for (const [free, fov] of [[1, H_FOV], [1.2, H_FOV], [0.05, H_FOV], [0.5, 0], [0.5, Number.NaN]] as const) {
            expect(cam.aimAt(eye, gate, free, fov)).toEqual(gate);
        }
        expect(cam.screenX(gate, eye, gate, H_FOV)).toBeCloseTo(0.5, 9);
        expect(cam.screenX([0, 1, -4], eye, gate, H_FOV)).toBe(null);
    });
    it('at 844x390 with the window from x 470 the gate is left of the window', () => {
        const eye: V3 = [0, 1, 0];
        const gate: V3 = [2, 0.4, 3];
        const free = 470 / 844;
        const x = cam.screenX(gate, eye, cam.aimAt(eye, gate, free, H_FOV), H_FOV)!;
        expect(x * 844).toBeLessThan(470);
        expect(x * 844).toBeGreaterThan(0);
    });
});
