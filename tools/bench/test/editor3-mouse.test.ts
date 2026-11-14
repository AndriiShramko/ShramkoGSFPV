// Lane editor3, stage E2 (docs/wip/editor3.md): the pure parts of the edit mode's mouse and camera. A click picks the gate
// under the cursor (pick.ts), a handle drag becomes the gate's pose in the scan frame as one undo step (drag.ts), and the free
// camera moves with W A S D E Q, turns with the mouse and takes its speed from the wheel (fly-cam.ts). Q and E belong to the
// camera now (keys.ts: [ and ] turn a gate).
import { describe, expect, it } from 'vitest';
import { edit } from '@gsfpv/tracks';
import type { Course, CourseCheck, EditorState } from '@gsfpv/tracks';
import { pickGate, pickRadius, rayThrough, raySphere } from '../../../apps/fly/src/course/editor/pick';
import type { Pickable } from '../../../apps/fly/src/course/editor/pick';
import { fromPcQuat, gateFlownPose, placeGate, placeInState, scaledOpening, toPcQuat } from '../../../apps/fly/src/course/editor/drag';
import { CAM_FAST, CAM_SPEED_MAX, CAM_SPEED_MIN, PITCH_MAX, camForward, camFrom, stepCam, turnCam, wheelSpeed } from '../../../apps/fly/src/course/editor/fly-cam';
import { editorKey } from '../../../apps/fly/src/course/editor/keys';

type Gate = Course['gates'][number];
const ring = (d: number): Gate['shape'] => ({ kind: 'ring', diameter: d, tube: 0.05 });
const gate = (id: string, pos: [number, number, number], d = 1.2): Gate => ({ id, shape: ring(d), pos, quat: [1, 0, 0, 0], direction: 'forward' });
const pk = (pos: [number, number, number], d = 1.2): Pickable => ({ pos, shape: ring(d) });
const keep: CourseCheck = () => [];
// a scan flown at twice its size, moved by (10, 0, -5)
const TR = [2, 10, 0, -5] as const;

function stateOf(gates: Gate[]): EditorState {
    const course = { gates, transform: [2, 10, 0, -5] } as unknown as Course;
    return { course, selected: 0, undo: [], redo: [], problems: [] };
}

describe('editor3 E2: a click picks the gate under the cursor', () => {
    it('the ray takes the nearest gate it passes through, not one beside it or behind it', () => {
        const ray = rayThrough([0, 1, 0], [0, 1, -100])!;
        const gates = [pk([3, 1, -5]), pk([0, 1, -12]), pk([0, 1, -6]), pk([0, 1, 4])];
        expect(pickGate(ray, gates)).toBe(2);
        // nothing on the way: none
        expect(pickGate(rayThrough([0, 1, 0], [0, 100, 0])!, gates)).toBe(-1);
    });

    it('a click on the rim of a ring still takes it; a click a metre beside it does not', () => {
        const r = pickRadius(ring(1.2));
        expect(r).toBeGreaterThan(0.6);
        expect(raySphere({ o: [0.62, 1, 0], d: [0, 0, -1] }, [0, 1, -5], r)).not.toBeNull();
        expect(raySphere({ o: [1.6, 1, 0], d: [0, 0, -1] }, [0, 1, -5], r)).toBeNull();
    });

    it('the camera inside a big gate still picks the small gate the cursor is on', () => {
        const ray = rayThrough([0, 1, 0], [0, 1, -50])!;
        // the camera stands in gate 0 (a 4 m ring around it); gate 1 is ahead on the cursor
        const gates = [pk([1.2, 1, 0], 4), pk([0, 1, -5], 1)];
        expect(pickGate(ray, gates)).toBe(1);
        // the cursor on nothing else: the gate around the camera
        expect(pickGate(rayThrough([0, 1, 0], [0, 100, 0])!, gates)).toBe(0);
    });
});

describe('editor3 E2: a handle drag becomes the gate pose, one undo step', () => {
    it('the flown pose goes back to the scan frame: position, turn (w x y z), opening', () => {
        const g = gate('g1', [1, 2, 3]);
        const fp = gateFlownPose(g, TR);
        expect(fp.pos).toEqual([12, 4, 1]);
        expect(fp.opening).toBeCloseTo(2.4, 9);
        // a drag 1 m along flown x, a quarter turn about y, the opening pulled to 1.5x
        const h = Math.SQRT1_2;
        const q = fromPcQuat(0, h, 0, h);
        expect(q).toEqual([h, 0, h, 0]);
        expect(toPcQuat(q)).toEqual([0, h, 0, h]);
        const placed = placeGate(g, { pos: [13, 4, 1], quat: q, opening: scaledOpening(fp.opening, 1.5) }, TR);
        expect(placed.pos).toEqual([1.5, 2, 3]);
        expect(placed.quat).toEqual([0.707107, 0, 0.707107, 0]);
        expect(placed.shape).toEqual({ kind: 'ring', diameter: 1.8, tube: 0.05 });
        expect(placed.id).toBe('g1');
    });

    it('the opening stays inside the editor\'s limits however far the scale handle is pulled', () => {
        expect(scaledOpening(1.2, 100)).toBeLessThan(100);
        expect(scaledOpening(1.2, 0.01)).toBeGreaterThanOrEqual(0.5);
        expect(scaledOpening(1.2, Number.NaN)).toBeCloseTo(1.2, 9);
    });

    it('one drag is one undo step: undo brings the gate back, redo puts it again; no move, no step', () => {
        const s0 = stateOf([gate('g1', [0, 0, 0]), gate('g2', [0, 0, -5]), gate('g3', [0, 0, -10])]);
        const moved = placeGate(s0.course.gates[1]!, { pos: [10, 0.6, -15], quat: [1, 0, 0, 0], opening: 2.4 }, TR);
        const s1 = placeInState(s0, 1, moved, keep)!;
        expect(s1).not.toBeNull();
        expect(s1.selected).toBe(1);
        expect(s1.course.gates[1]!.pos).toEqual([0, 0.3, -5]);
        expect(s1.undo.length).toBe(1);
        expect(s1.redo.length).toBe(0);
        const u = edit(s1, { kind: 'undo' }, keep);
        expect(u.ok).toBe(true);
        expect(u.state.course.gates[1]!.pos).toEqual([0, 0, -5]);
        const r = edit(u.state, { kind: 'redo' }, keep);
        expect(r.state.course.gates[1]!.pos).toEqual([0, 0.3, -5]);
        // a click on a handle without a drag changes nothing and adds no undo step
        expect(placeInState(s0, 1, placeGate(s0.course.gates[1]!, gateFlownPose(s0.course.gates[1]!, TR), TR), keep)).toBeNull();
    });
});

describe('editor3 E2: the free edit camera', () => {
    it('W goes along the view, D to its right, E up, Q down; Shift faster; nothing held, no move', () => {
        const c = camFrom([0, 1, 0], [0, 1, -1], 4);
        expect(stepCam(c, new Set(['KeyW']), false, 0.05).pos[2]).toBeCloseTo(-0.2, 9);
        expect(stepCam(c, new Set(['KeyD']), false, 0.05).pos[0]).toBeCloseTo(0.2, 9);
        expect(stepCam(c, new Set(['KeyE']), false, 0.05).pos[1]).toBeCloseTo(1.2, 9);
        expect(stepCam(c, new Set(['KeyQ']), false, 0.05).pos[1]).toBeCloseTo(0.8, 9);
        expect(stepCam(c, new Set(['KeyW']), true, 0.05).pos[2]).toBeCloseTo(-0.2 * CAM_FAST, 9);
        expect(stepCam(c, new Set(), false, 0.05)).toBe(c);
        // facing +X, D goes to +Z (right of +X seen from above, y up)
        const east = camFrom([0, 1, 0], [1, 1, 0], 4);
        const d = stepCam(east, new Set(['KeyD']), false, 0.1).pos;
        expect(d[2]).toBeCloseTo(0.4, 9);
        expect(d[0]).toBeCloseTo(0, 9);
    });

    it('the mouse turns the view right and up; it never looks straight up', () => {
        const c = camFrom([0, 1, 0], [0, 1, -1], 4);
        const r = turnCam(c, 100, 0);
        expect(camForward(r)[0]).toBeGreaterThan(0.1);
        expect(camForward(turnCam(c, 0, -50))[1]).toBeGreaterThan(0.1);
        expect(turnCam(c, 0, -100000).pitch).toBeCloseTo(PITCH_MAX, 9);
    });

    it('the wheel sets the speed inside its range', () => {
        expect(wheelSpeed(4, -100)).toBeGreaterThan(4);
        expect(wheelSpeed(4, 100)).toBeLessThan(4);
        let s = 4;
        for (let i = 0; i < 50; i++) s = wheelSpeed(s, -100);
        expect(s).toBe(CAM_SPEED_MAX);
        for (let i = 0; i < 50; i++) s = wheelSpeed(s, 100);
        expect(s).toBe(CAM_SPEED_MIN);
    });

    it('the camera keys are not the editor\'s keys (Q and E no longer turn a gate)', () => {
        for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE', 'KeyQ']) expect(editorKey({ code }, [0, -1]), code).toBeNull();
    });
});
