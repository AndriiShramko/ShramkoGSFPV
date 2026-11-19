// Adding a gate by a click on the place (lane editor3, stage E3, docs/wip/editor3.md "The design", Add gate). The owner's
// words of message 51: "changed or added the next and flew again with the controller". A click on the scene puts a gate at
// the wall hit of that ray, pulled back towards the camera, or a few metres ahead when the ray hits nothing; it faces the
// camera (the pilot flies through it the way he looks) and goes after the selected gate in the order. Pure.
//
// The change itself is lane course3's EditAction { kind: 'add', pos, quat } (packages/tracks editor.ts): after the selected
// gate, a copy of its kind and opening, selected afterwards, one undo step, refused on a full course (max-gates).
import { PIECE_BAR_M, PIECE_OPENING_M } from '@gsfpv/tracks';
import type { EditAction, EditorState, PieceKind } from '@gsfpv/tracks';
import { courseFacing, legOnRay, placeInCourse } from './course-line';
import { openingOf, type Flown, type Q4, type V3 } from './drag';

/** the new gate stands this far in front of the wall the click hit, flown m (an estimate: room for the drone before the wall) */
export const ADD_BACK_M = 1.5;
/** a click on open sky puts the gate this far ahead, flown m (an estimate) */
export const ADD_AHEAD_M = 6;
/** never nearer to the camera than this, flown m (an estimate: the gate must be seen whole) */
export const ADD_MIN_M = 1;
/** how far a click looks for a wall, flown m (an estimate) */
export const ADD_RAY_M = 200;

/**
 * review ED-4, G2: the new gate's frame stands this far above the floor the click hit beyond the walls check's margin, flown m
 * (an estimate: about three 10 cm wall voxels). G2.11 (g2/full3, Wroclaw "gate 1 is in a wall"): the lower edge of the
 * OPENING stood 0.5 m up, so the frame (ring tube, square half bar) came nearer the floor than the check's margin (0.5 m).
 */
export const ADD_FLOOR_M = 0.3;

/**
 * Where a click's ray (eye, unit dir) puts the new gate: `hit` is the distance to the wall along it, null for none. `lift`
 * (flown m, addLift): review ED-4, a click that goes down lands on the floor (the natural click), so the gate stands over that
 * spot with its lower edge above the floor, pulled back along the floor (not along the ray, which only lifted it
 * 1.5 * sin(angle) m and left it in the ground) so it does not stand in a wall either.
 */
export function addPoint(eye: V3, dir: V3, hit: number | null, lift = 0): V3 {
    const got = hit !== null && Number.isFinite(hit) && hit > 0;
    if (got && dir[1] < 0 && lift > 0) {
        const h = Math.hypot(dir[0], dir[2]);
        const back = h > 1e-6 ? Math.min(ADD_BACK_M, Math.max(0, hit * h - ADD_MIN_M)) / h : 0;
        return [eye[0] + dir[0] * hit - dir[0] * back, eye[1] + dir[1] * hit + lift, eye[2] + dir[2] * hit - dir[2] * back];
    }
    const d = got ? Math.max(ADD_MIN_M, hit - ADD_BACK_M) : ADD_AHEAD_M;
    return [eye[0] + dir[0] * d, eye[1] + dir[1] * d, eye[2] + dir[2] * d];
}

/** G2: how far a gate's frame reaches past its opening's edge, scan m (packages/tracks check.ts outlineOf: ring tube, square half bar) */
export function frameReach(shape: EditorState['course']['gates'][number]['shape']): number {
    if (shape.kind === 'ring') return shape.tube;
    if (shape.kind === 'square' || shape.kind === 'cube-frame') return shape.bar / 2;
    return 0;
}

/**
 * review ED-4, G2: how far above a floor hit the new gate's centre goes: half its flown opening (a copy of the selected
 * gate's), its frame, the walls check's `margin` (flown m) and ADD_FLOOR_M, so the check finds the gate clear of the floor.
 */
export function addLift(state: EditorState, tr: Flown, margin = 0): number {
    const like = state.course.gates[state.selected] ?? state.course.gates[0];
    return like ? (openingOf(like.shape) / 2 + frameReach(like.shape)) * tr[0] + Math.max(0, margin) + ADD_FLOOR_M : 0;
}

/**
 * The turn (w, x, y, z) of an upright gate a pilot coming from `eye` flies through at `at`: the gate's -Z (the way through,
 * as the editor's insert reads it) along the floor direction from the eye to the gate. Straight above or below: unturned.
 */
export function facingFrom(eye: V3, at: V3): Q4 {
    const dx = at[0] - eye[0];
    const dz = at[2] - eye[2];
    if (Math.hypot(dx, dz) < 1e-6) return [1, 0, 0, 0];
    // R_y(a) * (0, 0, -1) = (-sin a, 0, -cos a)
    const a = Math.atan2(-dx, -dz);
    return [Math.cos(a / 2), 0, Math.sin(a / 2), 0];
}

/** G2: a gate further than this along the floor from the selected one faces the way from it, flown m (an estimate) */
export const ADD_COURSE_MIN_M = 1;

/**
 * G2, the owner's path: the added gate goes after the selected one, so it faces along the course, the way from the selected
 * gate `prev` to it (upright, turned about the vertical only); with no selected gate or one right above it, the way from the eye.
 */
export function addFacing(eye: V3, at: V3, prev: V3 | null): Q4 {
    if (prev && Math.hypot(at[0] - prev[0], at[2] - prev[2]) >= ADD_COURSE_MIN_M) return facingFrom(prev, at);
    return facingFrom(eye, at);
}

/** The Add gate change for flown point `at` turned by `quat`: the course frame of TrackGate.pos and .quat (flown = s * scan + offset).
 *  `after` (lane edit4c C1): the index of the gate it follows, -1 first; left out, after the selected gate (editor3). */
export function addAction(at: V3, quat: Q4, tr: Flown, after?: number): Extract<EditAction, { kind: 'add' }> {
    const s = tr[0];
    const a: Extract<EditAction, { kind: 'add' }> = { kind: 'add', pos: [(at[0] - tr[1]) / s, (at[1] - tr[2]) / s, (at[2] - tr[3]) / s], quat: [quat[0], quat[1], quat[2], quat[3]] };
    return after === undefined ? a : { ...a, after };
}

/** Lane edit4c C2: how far above a floor hit a piece's first gate's centre goes (as addLift, with the piece's own square), flown m */
export function pieceLift(margin = 0): number {
    return PIECE_OPENING_M / 2 + PIECE_BAR_M + Math.max(0, margin) + ADD_FLOOR_M;
}

/** Lane edit4c C2: the change that puts piece `piece` with its first gate at flown `at` turned by `quat`, after gate `after` */
export function pieceAction(piece: PieceKind, at: V3, quat: Q4, tr: Flown, after: number): Extract<EditAction, { kind: 'piece' }> {
    const a = addAction(at, quat, tr, after);
    return { kind: 'piece', piece, pos: a.pos, quat: a.quat, after };
}

/** A click with Add armed: the eye `o`, the unit ray `d` and the wall hit along it (null: none), flown frame. */
export interface AddClick {
    readonly o: V3;
    readonly d: V3;
    readonly hit: number | null;
}

/** Where the click puts the new gate (flown pose) and the gate it follows in the order (-1: first). */
export interface Placement {
    readonly pos: V3;
    readonly quat: Q4;
    readonly after: number;
}

/**
 * Lane edit4c C1 (E11, brief 545-546): the gate a click adds takes the place and the angle of the course's line. The point
 * is addPoint's (the wall hit, lifted over a floor); it goes after the gate whose leg passes nearest to it (course-line.ts
 * placeInCourse) and faces the bisector of its two legs there (courseFacing); with no leg at all, the way from the eye.
 */
export function placeFor(state: EditorState, tr: Flown, click: AddClick, lift: number): Placement {
    const s = tr[0];
    const points: V3[] = state.course.gates.map((g) => [s * g.pos[0] + tr[1], s * g.pos[1] + tr[2], s * g.pos[2] + tr[3]]);
    // C3: a click on a leg seen in front of the scan puts the gate on that leg (course-line.ts legOnRay)
    const seen = click.hit !== null && Number.isFinite(click.hit) && click.hit > 0 ? click.hit : ADD_RAY_M;
    const leg = legOnRay(points, click.o, click.d, seen);
    const pos = leg ? leg.at : addPoint(click.o, click.d, click.hit, lift);
    const after = leg ? leg.after : placeInCourse(points, state.selected, pos);
    const prev = points[after] ?? null;
    const next = points[after + 1] ?? null;
    const far = (p: V3 | null): boolean => !!p && Math.hypot(pos[0] - p[0], pos[2] - p[2]) >= ADD_COURSE_MIN_M;
    const quat = far(prev) || far(next) ? courseFacing(far(prev) ? prev : null, pos, far(next) ? next : null) : facingFrom(click.o, pos);
    return { pos, quat, after };
}
