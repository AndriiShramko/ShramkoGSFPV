// The editing model behind the course editor (tracks-plan.md 2.11, lane tracks, train 2, stage T2-editor-core). Pure: the
// page routes keys to `edit` actions and shows or says the outcome; nothing here reads the DOM, a clock or Math.random.
// After every change the course is re-checked (`CourseCheck`, by default the proof on the scan's walls, check.ts). A change
// that brings a NEW free-space problem (a gate, a leg or the start into a wall, or out of the walls' grid) is refused with
// that problem as its reason; problems the course already had do not block other edits (a course shown red can be repaired).
// A gate's axis off its leg in is not a free-space problem: it is kept as a problem of the state and blocks saving only.
// Moves and sizes are flown metres (the page's step), written in the scan frame (divided by the scene scale), to 1 mm.
import { quatMultiply, quatNormalize, quatRotate } from '@shramko/sonic-fpv';
import type { ObjectShape, Quat, SceneTransform, TrackGate, Vec3 } from '@shramko/sonic-fpv';
import type { VoxelCollision } from '@gsfpv/collision';
import { MARGIN_M, checkTrack } from './check';
import type { TrackReport } from './check';
import type { Course } from './format';
import { toTrackV1 } from './format';
import { RING_TUBE_M, SQUARE_BAR_M } from './generate';
import { SERVER_MAX_GATES, MAX_GATE_SIZE_M } from './server';

/** tracks-plan 2.11 key table: arrows 0.1 m (Shift 1 m), Q / E 15 degrees, Insert 4 m ahead (estimates of the plan) */
export const MOVE_STEP_M = 0.1;
export const TURN_STEP_DEG = 15;
/** the opening grows or shrinks by this, flown m (estimate) */
export const SIZE_STEP_M = 0.1;
/** the smallest opening, flown m (estimate: below a whoop's frame) */
export const MIN_OPENING_M = 0.5;
export const MAX_OPENING_M = MAX_GATE_SIZE_M;
export const INSERT_AHEAD_M = 4;
/** the format's least gates (validateTrack: at least 1) and the server's most */
export const MIN_GATES = 1;
export const MAX_GATES_EDIT = SERVER_MAX_GATES;
/** undo steps kept (estimate) */
export const UNDO_MAX = 200;

export type GateKind = 'ring' | 'square' | 'cube-frame';

/** What is wrong with a course, as data the page turns into words (its locales) and draws red. */
export type CourseProblem =
    | { readonly code: 'outside'; readonly gate: string }
    | { readonly code: 'start-wall'; readonly freeM: number }
    | { readonly code: 'gate-wall'; readonly gate: string; readonly freeM: number }
    | { readonly code: 'leg-wall'; readonly from: string; readonly to: string; readonly freeM: number }
    | { readonly code: 'gate-direction'; readonly gate: string; readonly deg: number }
    | { readonly code: 'no-start' };

/** free-space problems refuse a change; the others only block saving */
export function isPlacementProblem(p: CourseProblem): boolean {
    return p.code === 'outside' || p.code === 'start-wall' || p.code === 'gate-wall' || p.code === 'leg-wall';
}

const problemKey = (p: CourseProblem): string => (p.code === 'leg-wall' ? `leg:${p.from}>${p.to}` : p.code === 'outside' || p.code === 'gate-wall' || p.code === 'gate-direction' ? `${p.code}:${p.gate}` : p.code);

/** The proof's report as problems. */
export function reportProblems(r: TrackReport): CourseProblem[] {
    if (r.outside.length > 0) return r.outside.map((gate) => ({ code: 'outside', gate }));
    const out: CourseProblem[] = [];
    if (r.issues.some((i) => i.startsWith('the track has no start'))) out.push({ code: 'no-start' });
    else if (!r.startClear) out.push({ code: 'start-wall', freeM: r.startFreeM });
    for (const l of r.legs) if (!l.clear) out.push({ code: 'leg-wall', from: l.from, to: l.to, freeM: l.freeM });
    for (const g of r.gates) {
        if (!g.clear) out.push({ code: 'gate-wall', gate: g.id, freeM: g.freeM });
        if (!g.directionOk) out.push({ code: 'gate-direction', gate: g.id, deg: g.axisInDeg });
    }
    return out;
}

/** Re-checks a course; the editor's only view of the walls. */
export type CourseCheck = (course: Course) => CourseProblem[];

/** The proof on the scan's walls (flown, flownCollision) at `marginM`, without the free radii (milliseconds per change). */
export function wallsCheck(walls: VoxelCollision, transform: SceneTransform, marginM = MARGIN_M): CourseCheck {
    return (course) => reportProblems(checkTrack(toTrackV1(course), walls, transform, marginM, false));
}

export interface EditorState {
    readonly course: Course;
    /** the selected gate's index */
    readonly selected: number;
    readonly undo: readonly { readonly course: Course; readonly selected: number }[];
    readonly redo: readonly { readonly course: Course; readonly selected: number }[];
    /** every problem of the course as it stands (re-checked after every change) */
    readonly problems: readonly CourseProblem[];
}

export type EditAction =
    | { readonly kind: 'select'; readonly index: number }
    | { readonly kind: 'select-step'; readonly step: number }
    /** along a flown axis (0 x, 1 y up, 2 z), `steps` of `stepM` (default MOVE_STEP_M) */
    | { readonly kind: 'move'; readonly axis: 0 | 1 | 2; readonly steps: number; readonly stepM?: number }
    /** about the vertical, `steps` of TURN_STEP_DEG (positive: E, to the right seen from above) */
    | { readonly kind: 'turn'; readonly steps: number }
    | { readonly kind: 'shape'; readonly to: GateKind }
    /** the axis between level and diving (passed downward) */
    | { readonly kind: 'dive' }
    | { readonly kind: 'size'; readonly steps: number }
    | { readonly kind: 'insert' }
    | { readonly kind: 'delete' }
    /** the selected gate earlier (-1) or later (+1) in the order */
    | { readonly kind: 'order'; readonly step: number }
    | { readonly kind: 'undo' }
    | { readonly kind: 'redo' };

/** Why a change was refused: data the page says through its locales. */
export type EditRefusal =
    | { readonly code: 'placement'; readonly problems: readonly CourseProblem[] }
    | { readonly code: 'min-gates'; readonly min: number }
    | { readonly code: 'max-gates'; readonly max: number }
    | { readonly code: 'size-min'; readonly minM: number }
    | { readonly code: 'size-max'; readonly maxM: number }
    | { readonly code: 'order-edge' }
    | { readonly code: 'same' }
    | { readonly code: 'nothing-to-undo' }
    | { readonly code: 'nothing-to-redo' };

export type EditOutcome =
    | { readonly ok: true; readonly state: EditorState; readonly gate: string; readonly index: number; readonly action: EditAction['kind'] }
    | { readonly ok: false; readonly state: EditorState; readonly reason: EditRefusal };

export function openEditor(course: Course, check: CourseCheck, selected = 0): EditorState {
    return { course, selected: Math.max(0, Math.min(course.gates.length - 1, selected)), undo: [], redo: [], problems: check(course) };
}

/** Saving is allowed only while the course has no problem at all (tracks-plan 2.11). */
export function canSave(s: EditorState): boolean {
    return s.problems.length === 0;
}

const r3 = (v: number): number => {
    const r = Math.round(v * 1000) / 1000;
    return r === 0 ? 0 : r;
};
const r6 = (v: number): number => {
    const r = Math.round(v * 1e6) / 1e6;
    return r === 0 ? 0 : r;
};
/** to 1e-6, the sign with w >= 0 (q and -q are the same turn: a full turn writes the gate as it was) */
const roundQuat = (q: Quat): Quat => {
    const n = quatNormalize(q);
    const k = n[0] < 0 || (n[0] === 0 && (n[1] < 0 || (n[1] === 0 && (n[2] < 0 || (n[2] === 0 && n[3] < 0))))) ? -1 : 1;
    return [r6(k * n[0]), r6(k * n[1]), r6(k * n[2]), r6(k * n[3])];
};
/** a turn about the world's vertical by `deg` (positive: to the right seen from above, as yawQuat) */
const yawQuat = (deg: number): Quat => {
    const h = (deg * Math.PI) / 360;
    return [Math.cos(h), 0, -Math.sin(h), 0];
};
/** the level-to-diving turn about the gate's own x: local -Z (the way it is passed) goes to world down */
const PITCH_DOWN: Quat = [Math.SQRT1_2, -Math.SQRT1_2, 0, 0];
const isDive = (q: Quat): boolean => Math.abs(quatRotate(q, [0, 0, -1])[1]) > 0.7;
/** the yaw of a gate from its local x axis (level under a yaw, level under the dive turn too) */
const yawOfGate = (q: Quat): number => {
    const ex = quatRotate(q, [1, 0, 0]);
    return (Math.atan2(ex[2], ex[0]) * 180) / Math.PI;
};

/** the opening of a gate shape, its own frame's metres */
const openingOf = (s: ObjectShape): number => (s.kind === 'ring' ? s.diameter : s.kind === 'square' || s.kind === 'cube-frame' ? s.side : 0);
function withOpening(s: ObjectShape, opening: number): ObjectShape {
    if (s.kind === 'ring') return { kind: 'ring', diameter: opening, tube: Math.min(s.tube, opening) };
    if (s.kind === 'square' || s.kind === 'cube-frame') return { kind: s.kind, side: opening, bar: Math.min(s.bar, opening) };
    return s;
}

function nextGateId(gates: readonly TrackGate[]): string {
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

const refuse = (state: EditorState, reason: EditRefusal): EditOutcome => ({ ok: false, state, reason });

/**
 * One editing action on the state. A change is re-checked: refused with the new free-space problems as the reason, else
 * the new state (undo step kept, redo cleared). Selection, undo and redo are not checked against the walls (undo returns to
 * a state that was accepted).
 */
export function edit(state: EditorState, action: EditAction, check: CourseCheck): EditOutcome {
    const { course } = state;
    const gates = course.gates;
    const n = gates.length;
    const sel = Math.max(0, Math.min(n - 1, state.selected));
    const s = course.transform[0];
    const at = (st: EditorState): EditOutcome => ({ ok: true, state: st, gate: st.course.gates[st.selected]!.id, index: st.selected, action: action.kind });

    if (action.kind === 'select') return at({ ...state, selected: Math.max(0, Math.min(n - 1, Math.trunc(action.index))) });
    if (action.kind === 'select-step') return at({ ...state, selected: (((sel + Math.trunc(action.step)) % n) + n) % n });
    if (action.kind === 'undo' || action.kind === 'redo') {
        const from = action.kind === 'undo' ? state.undo : state.redo;
        const top = from[from.length - 1];
        if (!top) return refuse(state, { code: action.kind === 'undo' ? 'nothing-to-undo' : 'nothing-to-redo' });
        const here = { course, selected: sel };
        const undo = action.kind === 'undo' ? state.undo.slice(0, -1) : [...state.undo, here];
        const redo = action.kind === 'undo' ? [...state.redo, here] : state.redo.slice(0, -1);
        return at({ course: top.course, selected: top.selected, undo, redo, problems: check(top.course) });
    }

    const g = gates[sel]!;
    let next: TrackGate[] = [...gates];
    let selected = sel;
    if (action.kind === 'move') {
        const d = (action.steps * (action.stepM ?? MOVE_STEP_M)) / s;
        const pos = [...g.pos] as [number, number, number];
        pos[action.axis] = r3(pos[action.axis] + d);
        next[sel] = { ...g, pos };
    } else if (action.kind === 'turn') {
        next[sel] = { ...g, quat: roundQuat(quatMultiply(yawQuat(action.steps * TURN_STEP_DEG), g.quat)) };
    } else if (action.kind === 'dive') {
        const yaw = yawQuat(yawOfGate(g.quat));
        next[sel] = { ...g, quat: roundQuat(isDive(g.quat) ? yaw : quatMultiply(yaw, PITCH_DOWN)) };
    } else if (action.kind === 'shape') {
        if (g.shape.kind === action.to) return refuse(state, { code: 'same' });
        const opening = openingOf(g.shape);
        const shape: ObjectShape = action.to === 'ring' ? { kind: 'ring', diameter: opening, tube: Math.min(r3(RING_TUBE_M / s), opening) } : { kind: action.to, side: opening, bar: Math.min(r3(SQUARE_BAR_M / s), opening) };
        next[sel] = { ...g, shape };
    } else if (action.kind === 'size') {
        const flown = r3(openingOf(g.shape) * s + action.steps * SIZE_STEP_M);
        if (flown < MIN_OPENING_M - 1e-9) return refuse(state, { code: 'size-min', minM: MIN_OPENING_M });
        if (flown > MAX_OPENING_M + 1e-9) return refuse(state, { code: 'size-max', maxM: MAX_OPENING_M });
        next[sel] = { ...g, shape: withOpening(g.shape, r3(flown / s)) };
    } else if (action.kind === 'insert') {
        if (n >= MAX_GATES_EDIT) return refuse(state, { code: 'max-gates', max: MAX_GATES_EDIT });
        const ahead = quatRotate(g.quat, [0, 0, -1]);
        const k = INSERT_AHEAD_M / s;
        const pos: Vec3 = [r3(g.pos[0] + ahead[0] * k), r3(g.pos[1] + ahead[1] * k), r3(g.pos[2] + ahead[2] * k)];
        next.splice(sel + 1, 0, { ...g, id: nextGateId(gates), pos });
        selected = sel + 1;
    } else if (action.kind === 'delete') {
        if (n <= MIN_GATES) return refuse(state, { code: 'min-gates', min: MIN_GATES });
        next.splice(sel, 1);
        selected = Math.min(sel, n - 2);
    } else if (action.kind === 'order') {
        const to = sel + Math.trunc(action.step);
        if (to < 0 || to >= n || to === sel) return refuse(state, { code: 'order-edge' });
        next = [...gates];
        next.splice(sel, 1);
        next.splice(to, 0, g);
        selected = to;
    }

    const changed: Course = { ...course, gates: next };
    const problems = check(changed);
    const before = new Set(state.problems.filter(isPlacementProblem).map(problemKey));
    const fresh = problems.filter((p) => isPlacementProblem(p) && !before.has(problemKey(p)));
    if (fresh.length > 0) return refuse(state, { code: 'placement', problems: fresh });
    const undo = [...state.undo, { course, selected: sel }].slice(-UNDO_MAX);
    return at({ course: changed, selected, undo, redo: [], problems });
}
