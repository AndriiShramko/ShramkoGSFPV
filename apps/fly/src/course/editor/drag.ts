// A mouse drag of the gizmo to a gate of the course (lane editor3, stage E2, docs/wip/editor3.md "The design"): the owner's
// words of message 51, "click, move, rotate, put it in the right place at the right scale". PlayCanvas's gizmos move, turn
// and scale a stand-in entity at the selected gate in the flown frame; at the end of a drag its pose becomes the gate's pose
// in the course's scan frame, and the course takes it as one undo step. Pure.
//
// Lane course3 owns packages/tracks: an EditAction that sets a gate's pose in one step is asked for there (For the lead);
// until it exists the state is built here the way edit() builds it (undo pushed, redo cleared, the course re-checked).
import { MAX_OPENING_M, MIN_OPENING_M, UNDO_MAX } from '@gsfpv/tracks';
import type { Course, CourseCheck, EditorState } from '@gsfpv/tracks';
import type { ObjectShape } from '@shramko/sonic-fpv';
import type { Handle, HandleAxis } from './handle-look';

export type V3 = readonly [number, number, number];
/** w, x, y, z (the course format's order; PlayCanvas keeps x, y, z, w) */
export type Q4 = readonly [number, number, number, number];
/** the flown frame of a scan: s * p + t (packages/sonic-fpv track/flown.ts) */
export type Flown = readonly [number, number, number, number];

type Gate = Course['gates'][number];

/** A gate's pose in the flown frame, as the gizmo's stand-in carries it. */
export interface FlownPose {
    readonly pos: V3;
    readonly quat: Q4;
    /** the opening, flown m (0 for a shape without one) */
    readonly opening: number;
}

/**
 * Lane edit4a A2 (the edit4 design's DragEvent, named HandleDrag here beside the DOM's own DragEvent): one step of a
 * handle's drag. 'start' when a press takes a handle, 'move' while it is dragged, 'end' when it is let go (the change is
 * kept), 'cancel' on Esc or a right click during the drag (the gate goes back to `base`, nothing is kept).
 */
export interface HandleDrag {
    readonly phase: 'start' | 'move' | 'end' | 'cancel';
    readonly handle: Handle;
    readonly axis: HandleAxis;
    /** the stand-in now (flown frame); `base` on a cancel */
    readonly pose: FlownPose;
    /** the gate when the press began */
    readonly base: FlownPose;
}

const r3 = (v: number): number => {
    const r = Math.round(v * 1000) / 1000;
    return r === 0 ? 0 : r;
};
const r6 = (v: number): number => {
    const r = Math.round(v * 1e6) / 1e6;
    return r === 0 ? 0 : r;
};

/** The quaternion to 1e-6, unit, w >= 0 (q and -q are the same turn), as the editor writes it. */
export function roundQuat(q: Q4): Q4 {
    const n = Math.hypot(q[0], q[1], q[2], q[3]);
    if (!(n > 1e-12)) return [1, 0, 0, 0];
    const u = [q[0] / n, q[1] / n, q[2] / n, q[3] / n] as const;
    const neg = u[0] < 0 || (u[0] === 0 && (u[1] < 0 || (u[1] === 0 && (u[2] < 0 || (u[2] === 0 && u[3] < 0)))));
    const k = neg ? -1 : 1;
    return [r6(k * u[0]), r6(k * u[1]), r6(k * u[2]), r6(k * u[3])];
}

/** PlayCanvas Quat (x, y, z, w) to the course order (w, x, y, z), and back. */
export const fromPcQuat = (x: number, y: number, z: number, w: number): Q4 => [w, x, y, z];
export const toPcQuat = (q: Q4): [number, number, number, number] => [q[1], q[2], q[3], q[0]];

/** The opening of a gate shape in its own frame's metres (0 for a shape without one). */
export function openingOf(s: ObjectShape): number {
    return s.kind === 'ring' ? s.diameter : s.kind === 'square' || s.kind === 'cube-frame' ? s.side : 0;
}

function withOpening(s: ObjectShape, opening: number): ObjectShape {
    if (s.kind === 'ring') return { kind: 'ring', diameter: opening, tube: Math.min(s.tube, opening) };
    if (s.kind === 'square' || s.kind === 'cube-frame') return { kind: s.kind, side: opening, bar: Math.min(s.bar, opening) };
    return s;
}

/** Where a gate of the course stands in the flown frame `tr` (the gizmo's stand-in is put there). */
export function gateFlownPose(g: Gate, tr: Flown): FlownPose {
    const s = tr[0];
    return { pos: [s * g.pos[0] + tr[1], s * g.pos[1] + tr[2], s * g.pos[2] + tr[3]], quat: g.quat, opening: openingOf(g.shape) * s };
}

/** The opening after the scale handle was pulled by `factor` from `start` (flown m), held inside the editor's limits. */
export function scaledOpening(start: number, factor: number): number {
    if (!(start > 0)) return start;
    const f = Number.isFinite(factor) && factor > 0 ? factor : 1;
    return Math.max(MIN_OPENING_M, Math.min(MAX_OPENING_M, start * f));
}

/** The gate `g` put at the flown pose `p`: its position and turn from the pose, its opening (held in the limits) in the scan frame. */
export function placeGate(g: Gate, p: FlownPose, tr: Flown): Gate {
    const s = tr[0];
    const pos: [number, number, number] = [r3((p.pos[0] - tr[1]) / s), r3((p.pos[1] - tr[2]) / s), r3((p.pos[2] - tr[3]) / s)];
    const had = openingOf(g.shape);
    const shape = had > 0 && p.opening > 0 ? withOpening(g.shape, r3(scaledOpening(p.opening, 1) / s)) : g.shape;
    return { ...g, pos, quat: roundQuat(p.quat), shape };
}

const sameGate = (a: Gate, b: Gate): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * The editor's state with gate `index` replaced by `gate`: one undo step, redo cleared, that gate selected, the course
 * re-checked by `check` (the page passes one that keeps the problems; the walls are checked in the worker). Null when
 * nothing changed (a click on a handle without a drag) or the index is out of the course.
 */
export function placeInState(state: EditorState, index: number, gate: Gate, check: CourseCheck): EditorState | null {
    const gates = state.course.gates;
    const old = gates[index];
    if (!old || sameGate(old, gate)) return null;
    const next = [...gates];
    next[index] = gate;
    const course: Course = { ...state.course, gates: next };
    const undo = [...state.undo, { course: state.course, selected: state.selected }].slice(-UNDO_MAX);
    return { course, selected: index, undo, redo: [], problems: check(course) };
}
