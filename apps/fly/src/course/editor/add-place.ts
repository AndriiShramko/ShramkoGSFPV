// Adding a gate by a click on the place (lane editor3, stage E3, docs/wip/editor3.md "The design", Add gate). The owner's
// words of message 51: "changed or added the next and flew again with the controller". A click on the scene puts a gate at
// the wall hit of that ray, pulled back towards the camera, or a few metres ahead when the ray hits nothing; it faces the
// camera (the pilot flies through it the way he looks) and goes after the selected gate in the order. Pure.
//
// Lane course3 owns packages/tracks: an EditAction that adds a gate at a pose is asked for there (For the lead); until it
// exists the state is built here the way edit() builds an insert (undo pushed, redo cleared, the course re-checked).
import { MAX_GATES_EDIT, UNDO_MAX } from '@gsfpv/tracks';
import type { Course, CourseCheck, EditorState } from '@gsfpv/tracks';
import { openingOf, placeGate, type Flown, type Q4, type V3 } from './drag';

type Gate = Course['gates'][number];

/** the new gate stands this far in front of the wall the click hit, flown m (an estimate: room for the drone before the wall) */
export const ADD_BACK_M = 1.5;
/** a click on open sky puts the gate this far ahead, flown m (an estimate) */
export const ADD_AHEAD_M = 6;
/** never nearer to the camera than this, flown m (an estimate: the gate must be seen whole) */
export const ADD_MIN_M = 1;
/** how far a click looks for a wall, flown m (an estimate) */
export const ADD_RAY_M = 200;

/** review ED-4: the new gate's lower edge stands this far above the floor the click hit, flown m (an estimate) */
export const ADD_FLOOR_M = 0.5;

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

/** review ED-4: how far above a floor hit the new gate's centre goes: half its flown opening (a copy of the selected gate's) plus ADD_FLOOR_M */
export function addLift(state: EditorState, tr: Flown): number {
    const like = state.course.gates[state.selected] ?? state.course.gates[0];
    return like ? (openingOf(like.shape) * tr[0]) / 2 + ADD_FLOOR_M : 0;
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

/** A gate id not used in the course (g<n+1> after the highest g<n>, as the editor's insert names them). */
export function freeGateId(gates: readonly Gate[]): string {
    const used = new Set(gates.map((g) => g.id));
    let n = 0;
    for (const g of gates) {
        const m = /^g(\d+)$/.exec(g.id);
        if (m) n = Math.max(n, Number(m[1]));
    }
    let id = `g${n + 1}`;
    while (used.has(id)) id = `g${++n + 1}`;
    return id;
}

/**
 * The editor's state with a new gate at flown point `at`, turned by `quat`, after the selected gate: a copy of the selected
 * gate's kind and opening, one undo step, redo cleared, the new gate selected. Null when the course is full.
 */
export function addInState(state: EditorState, at: V3, quat: Q4, tr: Flown, check: CourseCheck): EditorState | null {
    const gates = state.course.gates;
    if (gates.length >= MAX_GATES_EDIT) return null;
    const like = gates[state.selected] ?? gates[0];
    if (!like) return null;
    const copy: Gate = { ...like, id: freeGateId(gates) };
    const gate = placeGate(copy, { pos: at, quat, opening: openingOf(like.shape) * tr[0] }, tr);
    const at1 = Math.min(state.selected + 1, gates.length);
    const next = [...gates];
    next.splice(at1, 0, gate);
    const course: Course = { ...state.course, gates: next };
    const undo = [...state.undo, { course: state.course, selected: state.selected }].slice(-UNDO_MAX);
    return { course, selected: at1, undo, redo: [], problems: check(course) };
}
