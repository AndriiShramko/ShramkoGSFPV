// Live warnings while a gate is dragged or turned (lane edit4c, stage C1, complaint E11; design edit4.md 5 C1). The owner's
// words (brief 557-558): warn at once while he puts a gate into a place that breaks the course, and let him keep it. Pure:
// the gate `index` stands at `pose` (flown frame, the gizmo's stand-in), the rest of the course where it is; the walls are
// the flown-frame walls (or null before they load: then no wall warning). A warning never refuses anything.
import { quatRotate } from '@shramko/sonic-fpv';
import { AXIS_TOLERANCE_DEG, MARGIN_M, MAX_LEG_M, freeRadius, sweepFree } from '@gsfpv/tracks';
import type { Course } from '@gsfpv/tracks';
import type { VoxelCollision } from '@gsfpv/collision';
import { openingOf, type Flown, type FlownPose, type V3 } from './drag';

/**
 * A gate whose axis stands further than this off its leg in cannot be entered forward: the walls check's own rule
 * (check.ts AXIS_TOLERANCE_DEG, a 'gate-direction' problem that refuses the save). Measured on 39 generated courses of the
 * test world: a plain angle between the legs (the design's 120 degrees) fired on 99 of their turns, up to 179 degrees,
 * which the generator flies with a run out after the gate; this rule fires on none.
 */
export const SHARP_TURN_DEG = AXIS_TOLERANCE_DEG;
/** two gates' frames nearer than this to each other (beyond their half openings) stand too close, flown m (an estimate) */
export const CLOSE_GAP_M = 0.2;
/** the leg longest a course may have: the server's rule (packages/tracks server.ts) */
export const LEG_LONG_M = MAX_LEG_M;

export type WarningCode = 'sharp-turn' | 'too-close' | 'wall-in-opening' | 'leg-long' | 'leg-wall';

/** One warning, as data the page turns into words; `gate` and `other` are indexes in the course order (-1: the start). */
export interface Warning {
    readonly code: WarningCode;
    readonly gate: number;
    readonly other?: number;
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);

/** The angle between two legs (0: straight on), degrees; 0 for a leg of no length. */
export function turnDeg(legIn: V3, legOut: V3): number {
    const a = len(legIn);
    const b = len(legOut);
    if (!(a > 1e-9 && b > 1e-9)) return 0;
    const c = (legIn[0] * legOut[0] + legIn[1] * legOut[1] + legIn[2] * legOut[2]) / (a * b);
    return (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI;
}

/**
 * What the gate `index` at `pose` breaks: a turn too sharp to enter it or the next gate forward, a frame too close to another gate's,
 * a wall inside its opening, a leg in or out longer than the server takes, or a leg in or out through a wall (the walls
 * check's sweep at `marginM`, only the two legs of the moved gate).
 */
export function placeWarnings(course: Course, index: number, pose: FlownPose, flown: Flown, walls: VoxelCollision | null, marginM = MARGIN_M): Warning[] {
    const s = flown[0];
    const toFlown = (p: readonly number[]): V3 => [s * p[0]! + flown[1], s * p[1]! + flown[2], s * p[2]! + flown[3]];
    const pts: V3[] = course.gates.map((g, i) => (i === index ? pose.pos : toFlown(g.pos)));
    const open: number[] = course.gates.map((g, i) => (i === index ? pose.opening : openingOf(g.shape) * s));
    const start = course.start ? toFlown(course.start.pos) : null;
    const n = pts.length;
    if (index < 0 || index >= n) return [];
    const before = (j: number): V3 | null => (j > 0 ? pts[j - 1]! : j === 0 ? start : null);
    const out: Warning[] = [];

    // the moved gate's leg in and the next gate's leg in change: either gate may no longer be entered forward
    for (const j of [index, index + 1]) {
        if (j >= n) continue;
        const prev = before(j);
        const axis = quatRotate((j === index ? pose.quat : course.gates[j]!.quat) as [number, number, number, number], [0, 0, -1]);
        if (prev && turnDeg(sub(pts[j]!, prev), axis) > SHARP_TURN_DEG) out.push({ code: 'sharp-turn', gate: j });
    }
    for (let k = 0; k < n; k++) {
        if (k === index) continue;
        if (len(sub(pts[k]!, pose.pos)) < (open[k]! + pose.opening) / 2 + CLOSE_GAP_M) out.push({ code: 'too-close', gate: index, other: k });
    }
    if (walls && pose.opening > 0 && freeRadius(walls, pose.pos, pose.opening) < pose.opening / 2) out.push({ code: 'wall-in-opening', gate: index });
    const legs: [number, number][] = [];
    if (index > 0 || start) legs.push([index - 1, index]);
    if (index + 1 < n) legs.push([index, index + 1]);
    for (const [a, b] of legs) {
        const pa = a < 0 ? start! : pts[a]!;
        const pb = pts[b]!;
        if (a >= 0 && len(sub(pb, pa)) > LEG_LONG_M) out.push({ code: 'leg-long', gate: a, other: b });
        if (walls && !sweepFree(walls, pa, pb, marginM)) out.push({ code: 'leg-wall', gate: a, other: b });
    }
    return out;
}

/** The gates a warning paints orange: the moved gate `index` whenever it has one, and a next gate that can no longer be
 *  entered forward (its own sharp turn). */
export function warnedGates(ws: readonly Warning[], index: number): Set<number> {
    const out = new Set<number>();
    if (ws.length > 0) out.add(index);
    for (const w of ws) if (w.code === 'sharp-turn' && w.gate >= 0) out.add(w.gate);
    return out;
}

/** how often the warnings are worked out while a gate drags (the legs' sweeps), ms: at most 10 times a second */
export const WARN_EVERY_MS = 100;
/** how long the question 'Keep it here?' waits for an answer, ms; no answer keeps the gate where the pilot put it */
export const KEEP_ASK_MS = 8000;
/** the warning box stands this far above the gate's centre, CSS px (the gate bar stands as far below: bar-place.ts BAR_CLEAR_PX) */
export const WARN_CLEAR_PX = 210;

/**
 * Where the warning box goes for a gate at (x, y) on a page w by h: centred above the gate (the gate bar takes the space
 * below), else below the gate bar (`barH` px tall at WARN_CLEAR_PX under the gate), else at the top just under the top bar
 * (`topClear` px from the page's top: a phone); inside the page; null when the gate is not in front of the camera.
 */
export function warnPlace(at: readonly [number, number, number] | null, w: number, h: number, boxW: number, boxH: number, topClear: number, barH = 44): [number, number] | null {
    if (!at || !(at[2] > 0) || !Number.isFinite(at[0]) || !Number.isFinite(at[1])) return null;
    const x = Math.max(8, Math.min(w - boxW - 8, at[0] - boxW / 2));
    const top = topClear + 8;
    const up = at[1] - WARN_CLEAR_PX - boxH;
    const down = at[1] + WARN_CLEAR_PX + barH + 8;
    const y = up >= top ? up : down + boxH <= h - 8 ? down : top;
    return [Math.round(x), Math.round(y)];
}
