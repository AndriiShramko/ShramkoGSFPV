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
import { MARGIN_M, NEAR_GRID_M, checkTrack } from './check';
import type { TrackReport } from './check';
import type { Course } from './format';
import { toTrackV1 } from './format';
import { RING_TUBE_M, SQUARE_BAR_M } from './generate';
import { MAX_COORD, MAX_LEG_M, NAME_EXTRA, NAME_LEN, SERVER_MAX_GATES, MAX_GATE_SIZE_M, TITLE_EXTRA, TITLE_LEN, textIssues } from './server';
import { PIECE_BAR_M, PIECE_OPENING_M, pieceLayout, type PieceKind } from './pieces';

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
/** lane edit4b (E4): a course may hold no gate while it is edited (Delete all gates, New empty course); saving one is refused */
export const MIN_GATES = 0;
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

/** The proof on the scan's walls (flown, flownCollision) at `marginM`, without the free radii (milliseconds per change).
 *  Lane n-save (Decision 6): a gate in the free air within NEAR_GRID_M of the walls' grid is no problem here. */
export function wallsCheck(walls: VoxelCollision, transform: SceneTransform, marginM = MARGIN_M): CourseCheck {
    return (course) => reportProblems(checkTrack(toTrackV1(course), walls, transform, marginM, false, false, NEAR_GRID_M));
}

export interface EditorState {
    readonly course: Course;
    /** the selected gate's index; -1 when the course has no gate */
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
    /** F2 (lane editor3's Add gate): a gate after the selected one at `pos` and `quat`, the course's own frame (as
     *  TrackGate.pos and .quat); the selected gate's shape; selected afterwards. Refused as insert is (max-gates, placement). */
    | { readonly kind: 'add'; readonly pos: Vec3; readonly quat: Quat; /** lane edit4c C1: the gate it follows (-1 first); default the selected */ readonly after?: number }
    // lane edit4c C2 (E12): a ready piece (pieces.ts), its first gate at pos turned by quat (course frame), all its gates
    // one undo step after the gate `after` (-1 first; default the selected), its last gate selected
    | { readonly kind: 'piece'; readonly piece: PieceKind; readonly pos: Vec3; readonly quat: Quat; readonly after?: number }
    | { readonly kind: 'delete' }
    /** lane edit4b (E4): every gate at once (Delete all gates: []), one undo step; `selected` afterwards (-1: none) */
    | { readonly kind: 'replace'; readonly gates: readonly TrackGate[]; readonly selected: number }
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
    /** lane edit4b: the course has no gate to change (add one first) */
    | { readonly code: 'no-gate' }
    | { readonly code: 'same' }
    | { readonly code: 'nothing-to-undo' }
    | { readonly code: 'nothing-to-redo' };

export type EditOutcome =
    | { readonly ok: true; readonly state: EditorState; readonly gate: string; readonly index: number; readonly action: EditAction['kind'] }
    | { readonly ok: false; readonly state: EditorState; readonly reason: EditRefusal };

export function openEditor(course: Course, check: CourseCheck, selected = 0): EditorState {
    return { course, selected: course.gates.length === 0 ? -1 : Math.max(0, Math.min(course.gates.length - 1, selected)), undo: [], redo: [], problems: check(course) };
}

/**
 * Lane n-save (the owner's wish 1 of 2026-11-20, t7-plan Part C 4): two classes of findings at Save. A blocker is only what
 * the server refuses (apps/api/tracks.py validate_track and _bounds, server.ts validateServerTrack: no gate, too many gates,
 * a gate too big, a leg too long, a point too far, a name refused); a warning is everything a pilot may live with, and
 * warnings never block Save.
 */
export type StoreBlockerKind = 'no-gates' | 'too-many-gates' | 'gate-too-big' | 'leg-too-long' | 'too-far' | 'name-refused';
export type SaveWarningKind = 'in-scan' | 'under-ground' | 'same-place' | 'too-close' | 'sharp-turn' | 'blocked-start' | 'leg-blocked' | 'wrong-way' | 'no-order';
/** the kinds in the order the Save dialog lists them */
export const SAVE_WARNING_KINDS: readonly SaveWarningKind[] = ['in-scan', 'under-ground', 'same-place', 'too-close', 'sharp-turn', 'blocked-start', 'leg-blocked', 'wrong-way', 'no-order'];
export const STORE_BLOCKER_KINDS: readonly StoreBlockerKind[] = ['no-gates', 'too-many-gates', 'gate-too-big', 'leg-too-long', 'too-far', 'name-refused'];

/** One thing the server would refuse. `gate`: the gate it is about ('start' for the start); `limit`: the server's number
 *  (gates, flown m, scan units); `field`: for 'name-refused', which text ('name' or 'title'). */
export interface StoreBlocker {
    readonly kind: StoreBlockerKind;
    readonly gate?: string;
    readonly limit?: number;
    readonly field?: 'name' | 'title';
}
/** One warning: the gates it is about (a leg: its two ends; the start: none). */
export interface SaveWarning {
    readonly kind: SaveWarningKind;
    readonly gates: readonly string[];
}
export interface SaveVerdict {
    readonly blockers: readonly StoreBlocker[];
    readonly warnings: readonly SaveWarning[];
}

/** two gates nearer than this (flown m, centre to centre) stand on one spot (t7-plan Part C 4: under 0.3 m) */
export const SAME_PLACE_M = 0.3;

const asWarningKind = (code: string): SaveWarningKind | null => {
    if (code === 'outside' || code === 'gate-wall' || code === 'wall-in-opening') return 'in-scan';
    if (code === 'start-wall' || code === 'no-start') return 'blocked-start';
    if (code === 'leg-wall') return 'leg-blocked';
    if (code === 'gate-direction') return 'wrong-way';
    return (SAVE_WARNING_KINDS as readonly string[]).includes(code) ? (code as SaveWarningKind) : null;
};

/**
 * The Save verdict of a course (t7-plan Part C 4): `problems` are the editor's (CourseProblem), `warnings` the live ones
 * of warn.ts with the gate's id; `names` the pilot's name and course title when the page has them. Pure. Blockers mirror
 * the server's first class exactly; every problem and warning becomes a SaveWarning (one per kind and gates), in
 * SAVE_WARNING_KINDS order. A live 'leg-long' is the blocker 'leg-too-long' when the server refuses the leg, else nothing.
 */
export function saveVerdict(course: Course, problems: readonly CourseProblem[], warnings: readonly { code: string; gate?: string }[] = [], names?: { readonly name?: string; readonly title?: string }): SaveVerdict {
    const gates = course.gates;
    const s = course.transform[0];
    const blockers: StoreBlocker[] = [];
    if (gates.length === 0) blockers.push({ kind: 'no-gates' });
    if (gates.length > SERVER_MAX_GATES) blockers.push({ kind: 'too-many-gates', limit: SERVER_MAX_GATES });
    for (const g of gates) if (openingOf(g.shape) * s > MAX_GATE_SIZE_M) blockers.push({ kind: 'gate-too-big', gate: g.id, limit: MAX_GATE_SIZE_M });
    const far = (p: readonly number[]): boolean => p.some((c) => !(c <= MAX_COORD && c >= -MAX_COORD));
    for (const g of gates) if (far(g.pos)) blockers.push({ kind: 'too-far', gate: g.id, limit: MAX_COORD });
    if (course.start && far(course.start.pos)) blockers.push({ kind: 'too-far', gate: 'start', limit: MAX_COORD });
    // the server stops at its first long leg (tracks.py _bounds); every one is named here so the pilot sees them all
    const legs: [number, number][] = gates.slice(1).map((_, i) => [i, i + 1]);
    if (course.laps > 1 && gates.length > 1) legs.push([gates.length - 1, 0]);
    for (const [a, b] of legs) if (dist(gates[a]!.pos, gates[b]!.pos) * s > MAX_LEG_M) blockers.push({ kind: 'leg-too-long', gate: gates[a]!.id, limit: MAX_LEG_M });
    if (names) {
        const name: string[] = [];
        const title: string[] = [];
        if (names.name !== undefined) textIssues('author.name', names.name, NAME_LEN, NAME_EXTRA, name);
        if (names.title !== undefined) textIssues('title', names.title, TITLE_LEN, TITLE_EXTRA, title);
        if (name.length > 0) blockers.push({ kind: 'name-refused', field: 'name' });
        if (title.length > 0) blockers.push({ kind: 'name-refused', field: 'title' });
    }

    const found: SaveWarning[] = [];
    const seen = new Set<string>();
    const add = (kind: SaveWarningKind, ids: readonly string[]): void => {
        const key = `${kind}:${ids.join('>')}`;
        if (seen.has(key)) return;
        seen.add(key);
        found.push({ kind, gates: ids });
    };
    // two gates on one spot, from the course itself (the live warnings name only the gate being placed)
    const onSpot = new Set<string>();
    for (let i = 0; i < gates.length; i++) {
        for (let j = i + 1; j < gates.length; j++) {
            if (dist(gates[i]!.pos, gates[j]!.pos) * s < SAME_PLACE_M) {
                onSpot.add(gates[i]!.id);
                onSpot.add(gates[j]!.id);
            }
        }
    }
    for (const g of gates) if (onSpot.has(g.id)) add('same-place', [g.id]);
    for (const p of problems) {
        const kind = asWarningKind(p.code)!;
        if (p.code === 'leg-wall') add(kind, [p.from, p.to]);
        else if (p.code === 'start-wall' || p.code === 'no-start') add(kind, []);
        else add(kind, [p.gate]);
    }
    for (const w of warnings) {
        let kind = asWarningKind(w.code);
        if (!kind) continue;
        if (kind === 'too-close' && w.gate !== undefined && onSpot.has(w.gate)) kind = 'same-place';
        add(kind, w.gate === undefined ? [] : [w.gate]);
    }
    const rank = (w: SaveWarning): number => SAVE_WARNING_KINDS.indexOf(w.kind);
    const order = new Map(gates.map((g, i) => [g.id, i]));
    const at = (w: SaveWarning): number => (w.gates.length === 0 ? -1 : (order.get(w.gates[0]!) ?? gates.length));
    found.sort((a, b) => rank(a) - rank(b) || at(a) - at(b));
    return { blockers, warnings: found };
}

const dist = (a: readonly number[], b: readonly number[]): number => {
    const x = a[0]! - b[0]!, y = a[1]! - b[1]!, z = a[2]! - b[2]!;
    return Math.sqrt(x * x + y * y + z * z);
};

/** Lane n-save: Save is allowed whenever the server would store the course (no blocker); warnings never block it. Before
 *  (tracks-plan 2.11) any problem at all refused it. */
export function canSave(s: EditorState): boolean {
    return saveVerdict(s.course, s.problems).blockers.length === 0;
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

/** the yaw (degrees, as yawQuat) of an upright gate passed along `d` (its -Z along the floor part of d) */
const yawOfDir = (d: Vec3): number => (Math.atan2(d[0], -d[2]) * 180) / Math.PI;

/** the way a gate is passed (its -Z), turned to point along `chord` when the gate may be passed either way */
function passAxis(g: TrackGate, chord: Vec3): Vec3 {
    const a = quatRotate(g.quat, [0, 0, -1]);
    const dot = a[0] * chord[0] + a[1] * chord[1] + a[2] * chord[2];
    return dot < 0 ? [-a[0], -a[1], -a[2]] : a;
}

/** samples of the course's curve between two gates (enough for a few cm on a 60 m leg) */
const LINE_SAMPLES = 64;

/**
 * Lane edit4c C1 (E11, brief 545-546): the point `dist` (course frame) along the course's line from gate a to gate b, and
 * the line's direction there. The line is the cubic Hermite curve that leaves a along its axis and enters b along b's axis
 * (the way a pilot flies the leg), so repeated duplicates follow a curved course instead of making a straight row. Never
 * further than half the curve (the copy stays between the two gates). Null when the gates stand on one spot.
 */
export function alongLine(a: TrackGate, b: TrackGate, dist: number): { pos: Vec3; dir: Vec3 } | null {
    const p0 = a.pos;
    const p1 = b.pos;
    const chord: Vec3 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    const c = Math.hypot(chord[0], chord[1], chord[2]);
    if (!(c > 1e-6)) return null;
    const t0 = passAxis(a, chord);
    const t1 = passAxis(b, chord);
    const at = (u: number): Vec3 => {
        const u2 = u * u;
        const u3 = u2 * u;
        const h00 = 2 * u3 - 3 * u2 + 1;
        const h10 = u3 - 2 * u2 + u;
        const h01 = -2 * u3 + 3 * u2;
        const h11 = u3 - u2;
        const k = (j: 0 | 1 | 2): number => h00 * p0[j] + h10 * c * t0[j] + h01 * p1[j] + h11 * c * t1[j];
        return [k(0), k(1), k(2)];
    };
    const pts: Vec3[] = [];
    for (let i = 0; i <= LINE_SAMPLES; i++) pts.push(at(i / LINE_SAMPLES));
    const cum = [0];
    for (let i = 1; i <= LINE_SAMPLES; i++) cum.push(cum[i - 1]! + Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1], pts[i]![2] - pts[i - 1]![2]));
    const want = Math.min(dist, cum[LINE_SAMPLES]! / 2);
    let i = 1;
    while (i < LINE_SAMPLES && cum[i]! < want) i++;
    const seg = cum[i]! - cum[i - 1]!;
    const f = seg > 1e-12 ? (want - cum[i - 1]!) / seg : 0;
    const A = pts[i - 1]!;
    const B = pts[i]!;
    const pos: Vec3 = [A[0] + (B[0] - A[0]) * f, A[1] + (B[1] - A[1]) * f, A[2] + (B[2] - A[2]) * f];
    const dl = Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2]);
    const dir: Vec3 = dl > 1e-12 ? [(B[0] - A[0]) / dl, (B[1] - A[1]) / dl, (B[2] - A[2]) / dl] : t0;
    return { pos, dir };
}

/** the opening of a gate shape, its own frame's metres */
const openingOf = (s: ObjectShape): number => (s.kind === 'ring' ? s.diameter : s.kind === 'square' || s.kind === 'cube-frame' ? s.side : 0);
function withOpening(s: ObjectShape, opening: number): ObjectShape {
    if (s.kind === 'ring') return { kind: 'ring', diameter: opening, tube: Math.min(s.tube, opening) };
    if (s.kind === 'square' || s.kind === 'cube-frame') return { kind: s.kind, side: opening, bar: Math.min(s.bar, opening) };
    return s;
}

/** lane edit4b: the first gate of an empty course (a square of DEFAULT_OPENING_M flown, the course's frame at scale `s`) */
export const DEFAULT_OPENING_M = 1.5;
function firstGate(s: number): TrackGate {
    const side = r3(DEFAULT_OPENING_M / s);
    return { id: 'g0', shape: { kind: 'square', side, bar: Math.min(r3(SQUARE_BAR_M / s), side) }, pos: [0, 0, 0], quat: [1, 0, 0, 0], direction: 'forward' };
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
    const sel = n === 0 ? -1 : Math.max(0, Math.min(n - 1, state.selected));
    const s = course.transform[0];
    const at = (st: EditorState): EditOutcome => ({ ok: true, state: st, gate: st.course.gates[st.selected]?.id ?? '', index: st.selected, action: action.kind });

    if (n === 0 && (action.kind === 'select' || action.kind === 'select-step')) return refuse(state, { code: 'no-gate' });
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

    let next: TrackGate[] = [...gates];
    let selected = sel;
    if (action.kind === 'replace') {
        next = [...action.gates];
        selected = next.length === 0 ? -1 : Math.max(0, Math.min(next.length - 1, Math.trunc(action.selected)));
        const changed: Course = { ...course, gates: next };
        if (next.length === n && next.every((x, i) => x === gates[i])) return refuse(state, { code: 'same' });
        const undo = [...state.undo, { course, selected: sel }].slice(-UNDO_MAX);
        return at({ course: changed, selected, undo, redo: [], problems: check(changed) });
    }
    // an empty course: only a gate placed by Add (the default gate of the course's scale) is a change
    const g = gates[sel] ?? (action.kind === 'add' ? firstGate(s) : null);
    if (!g) return refuse(state, { code: 'no-gate' });
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
        // lane editor3 H1: a kind other than dive pressed on a dive gate also stands it up (the pilot asked for a ring, not a
        // diving ring); the same kind on a dive gate only stands it up
        const dive = isDive(g.quat);
        if (g.shape.kind === action.to && !dive) return refuse(state, { code: 'same' });
        const opening = openingOf(g.shape);
        const shape: ObjectShape = g.shape.kind === action.to ? g.shape : action.to === 'ring' ? { kind: 'ring', diameter: opening, tube: Math.min(r3(RING_TUBE_M / s), opening) } : { kind: action.to, side: opening, bar: Math.min(r3(SQUARE_BAR_M / s), opening) };
        next[sel] = { ...g, shape, quat: dive ? roundQuat(yawQuat(yawOfGate(g.quat))) : g.quat };
    } else if (action.kind === 'size') {
        const flown = r3(openingOf(g.shape) * s + action.steps * SIZE_STEP_M);
        if (flown < MIN_OPENING_M - 1e-9) return refuse(state, { code: 'size-min', minM: MIN_OPENING_M });
        if (flown > MAX_OPENING_M + 1e-9) return refuse(state, { code: 'size-max', maxM: MAX_OPENING_M });
        next[sel] = { ...g, shape: withOpening(g.shape, r3(flown / s)) };
    } else if (action.kind === 'insert') {
        if (n >= MAX_GATES_EDIT) return refuse(state, { code: 'max-gates', max: MAX_GATES_EDIT });
        const on = gates[sel + 1] ? alongLine(g, gates[sel + 1]!, INSERT_AHEAD_M / s) : null;
        if (on) {
            const pos: Vec3 = [r3(on.pos[0]), r3(on.pos[1]), r3(on.pos[2])];
            const quat = isDive(g.quat) || Math.hypot(on.dir[0], on.dir[2]) < 1e-6 ? g.quat : roundQuat(yawQuat(yawOfDir(on.dir)));
            next.splice(sel + 1, 0, { ...g, id: nextGateId(gates), pos, quat });
        } else {
            // the last gate: the course goes on ahead along its axis (editor3, tracks-plan 2.11)
            const ahead = quatRotate(g.quat, [0, 0, -1]);
            const k = INSERT_AHEAD_M / s;
            const pos: Vec3 = [r3(g.pos[0] + ahead[0] * k), r3(g.pos[1] + ahead[1] * k), r3(g.pos[2] + ahead[2] * k)];
            next.splice(sel + 1, 0, { ...g, id: nextGateId(gates), pos });
        }
        selected = sel + 1;
    } else if (action.kind === 'add') {
        if (n >= MAX_GATES_EDIT) return refuse(state, { code: 'max-gates', max: MAX_GATES_EDIT });
        const pos: Vec3 = [r3(action.pos[0]), r3(action.pos[1]), r3(action.pos[2])];
        const after = action.after === undefined ? sel : Math.max(-1, Math.min(n - 1, Math.trunc(action.after)));
        next.splice(after + 1, 0, { ...g, id: nextGateId(gates), pos, quat: roundQuat(action.quat) });
        selected = after + 1;
    } else if (action.kind === 'piece') {
        const poses = pieceLayout(action.piece, action.pos, action.quat, 1 / s);
        if (n + poses.length > MAX_GATES_EDIT) return refuse(state, { code: 'max-gates', max: MAX_GATES_EDIT });
        const after = action.after === undefined ? sel : Math.max(-1, Math.min(n - 1, Math.trunc(action.after)));
        const shape: ObjectShape = { kind: 'square', side: r3(PIECE_OPENING_M / s), bar: r3(PIECE_BAR_M / s) };
        const made: TrackGate[] = [];
        for (const p of poses) {
            const pos: Vec3 = [r3(p.pos[0]), r3(p.pos[1]), r3(p.pos[2])];
            made.push({ ...g, id: nextGateId([...gates, ...made]), shape, pos, quat: roundQuat(p.quat), direction: 'forward' });
        }
        next.splice(after + 1, 0, ...made);
        selected = after + made.length;
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
