// Lane tracks2, stage K2: the editor's camera keeps the selected gate in view (apps/fly/src/course/editor/camera.ts) and a
// vote carries the pilot's best lap (apps/fly/src/course/editor/rules.ts lapOf; the server refuses a vote without one).
import { describe, expect, it } from 'vitest';
import { CAM_NEAR_M, CAM_UP_M, CAM_WALL_GAP_M, gateCamera, inView } from '../../../apps/fly/src/course/editor/camera';
import type { V3 } from '../../../apps/fly/src/course/editor/camera';
import { lapOf } from '../../../apps/fly/src/course/editor/rules';

const dist = (a: V3, b: V3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe('the editor camera on the selected gate', () => {
    it('shows a gate that is behind the drone (the screenshot of 2026-11-13)', () => {
        const drone: V3 = [0, 1, 0];
        const gate: V3 = [0, 1, 8];
        // the drone faces -z: from its own eye the gate is out of view
        expect(inView(gate, drone, [0, 1, -1], 60, 16 / 9)).toBe(false);
        const v = gateCamera(gate, drone, null);
        expect(inView(gate, v.eye, v.at, 60, 16 / 9)).toBe(true);
        expect(inView(gate, v.eye, v.at, 60, 844 / 390)).toBe(true);
        expect(dist(v.eye, gate)).toBeCloseTo(Math.hypot(CAM_NEAR_M, CAM_UP_M), 6);
        expect(v.forward![0]).toBeCloseTo(0, 6);
        expect(v.forward![1]).toBeCloseTo(1, 6);
    });

    it('every gate of a ring around the drone is in view of its own camera', () => {
        const drone: V3 = [2, 1.5, -3];
        for (let i = 0; i < 12; i++) {
            const a = (i / 12) * Math.PI * 2;
            const gate: V3 = [drone[0] + Math.cos(a) * (2 + i), drone[1] + (i % 3) - 1, drone[2] + Math.sin(a) * (2 + i)];
            const v = gateCamera(gate, drone, null);
            expect(inView(gate, v.eye, v.at, 60, 16 / 9)).toBe(true);
        }
    });

    it('stops short of a wall between the drone and the wanted eye', () => {
        const drone: V3 = [0, 1, 0];
        const gate: V3 = [0, 1, 10];
        const v = gateCamera(gate, drone, () => 2);
        expect(dist(v.eye, drone)).toBeCloseTo(2 - CAM_WALL_GAP_M, 6);
        expect(inView(gate, v.eye, v.at, 60, 16 / 9)).toBe(true);
        // control: no wall, the eye goes on to CAM_NEAR_M from the gate
        expect(dist(gateCamera(gate, drone, () => null).eye, drone)).toBeGreaterThan(5);
    });

    it('a gate nearer than CAM_NEAR_M is seen from just above the drone', () => {
        const v = gateCamera([1, 1, 1], [0, 1, 0], null);
        expect(v.eye).toEqual([0, 1 + CAM_UP_M, 0]);
    });
});

describe('a vote carries the best lap', () => {
    it('takes the fastest lap over versions and drones of that course only', () => {
        const bests = { 'abc-1.v1.air65': 41000, 'abc-1.v2.meteor': 35500, 'abc-12.v1.air65': 1200, 'zzz.v1.x': 900, 'abc-1.v3.bad': -1 };
        expect(lapOf('abc-1', bests)).toBe(35500);
        expect(lapOf('none', bests)).toBe(null);
    });
});
