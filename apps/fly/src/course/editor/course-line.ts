// The course's line for placing (lane edit4c, stage C1, complaint E11; design edit4.md 1.1 and 5). The owner's words
// (brief 545-546): a new gate stood in a row in front of the last one, not where the course goes. Here, pure and in the
// flown frame: where in the order a clicked point belongs (after the gate whose leg passes nearest to it) and the way an
// upright gate faces there (the bisector of its legs, horizontal). No DOM, no clock.
import type { Q4, V3 } from './drag';

/** a leg shorter than this along the floor gives no direction, flown m (an estimate, as add-place.ts ADD_COURSE_MIN_M) */
export const LINE_MIN_M = 1;

/** The horizontal unit direction from a to b, or null when they stand closer than `min` along the floor. */
function floorDir(a: V3, b: V3, min = LINE_MIN_M): [number, number] | null {
    const dx = b[0] - a[0];
    const dz = b[2] - a[2];
    const l = Math.hypot(dx, dz);
    return l >= min ? [dx / l, dz / l] : null;
}

/** The upright turn (w, x, y, z) whose -Z (the way a gate is passed) points along the floor direction (dx, dz). */
export function yawFacing(dx: number, dz: number): Q4 {
    if (Math.hypot(dx, dz) < 1e-9) return [1, 0, 0, 0];
    // R_y(a) * (0, 0, -1) = (-sin a, 0, -cos a)
    const a = Math.atan2(-dx, -dz);
    return [Math.cos(a / 2), 0, Math.sin(a / 2), 0];
}

/**
 * The way a gate at `at` faces in the course: the bisector of the leg in (prev -> at) and the leg out (at -> next),
 * horizontal; with one leg only, along it; with none (or a U-turn whose legs cancel), along the leg in, else unturned.
 */
export function courseFacing(prev: V3 | null, at: V3, next: V3 | null): Q4 {
    const din = prev ? floorDir(prev, at) : null;
    const dout = next ? floorDir(at, next) : null;
    if (din && dout) {
        const bx = din[0] + dout[0];
        const bz = din[1] + dout[1];
        if (Math.hypot(bx, bz) > 1e-3) return yawFacing(bx, bz);
        return yawFacing(din[0], din[1]);
    }
    const d = din ?? dout;
    return d ? yawFacing(d[0], d[1]) : [1, 0, 0, 0];
}

/** The point of segment a-b nearest to p: its parameter t in [0, 1] and the distance. */
export function nearOnSegment(a: V3, b: V3, p: V3): { t: number; dist: number } {
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const l2 = ab[0]! * ab[0]! + ab[1]! * ab[1]! + ab[2]! * ab[2]!;
    const raw = l2 > 1e-12 ? ((p[0] - a[0]) * ab[0]! + (p[1] - a[1]) * ab[1]! + (p[2] - a[2]) * ab[2]!) / l2 : 0;
    const t = Math.max(0, Math.min(1, raw));
    const q = [a[0] + ab[0]! * t, a[1] + ab[1]! * t, a[2] + ab[2]! * t];
    return { t, dist: Math.hypot(p[0] - q[0]!, p[1] - q[1]!, p[2] - q[2]!) };
}

/** A click's ray passes a leg when it comes this near to it, flown m, at the least (an estimate: a frame's half width) */
export const ON_LEG_MIN_M = 1;
/** ... or this share of the distance along the ray, whichever is more (about 1.7 deg: some 20 px at 115 deg over 1536 px) */
export const ON_LEG_SHARE = 0.03;
/** a gate put on a leg keeps this far from both its ends, flown m (an estimate: no frame touches the gates at the ends) */
export const ON_LEG_END_M = 2;
/** a leg passing nearer to the eye than this along the ray is beside the pilot, not what he clicked, flown m (an estimate) */
export const ON_LEG_NEAR_M = 2;

/** The closest approach of the ray o + s d (d unit, s in [0, maxS]) and the segment a-b: s, the segment's t, the distance. */
export function rayToSegment(o: V3, d: V3, maxS: number, a: V3, b: V3): { s: number; t: number; dist: number } {
    const e = [b[0] - a[0], b[1] - a[1], b[2] - a[2]] as const;
    const r = [o[0] - a[0], o[1] - a[1], o[2] - a[2]] as const;
    const ee = e[0] * e[0] + e[1] * e[1] + e[2] * e[2];
    const de = d[0] * e[0] + d[1] * e[1] + d[2] * e[2];
    const dr = d[0] * r[0] + d[1] * r[1] + d[2] * r[2];
    const er = e[0] * r[0] + e[1] * r[1] + e[2] * r[2];
    const clampS = (v: number): number => Math.max(0, Math.min(maxS, v));
    let s: number;
    let t: number;
    if (ee < 1e-12) {
        s = clampS(-dr);
        t = 0;
    } else {
        const den = ee - de * de;
        s = den > 1e-12 ? clampS((de * er - dr * ee) / den) : 0;
        t = (de * s + er) / ee;
        if (t < 0) {
            t = 0;
            s = clampS(-dr);
        } else if (t > 1) {
            t = 1;
            s = clampS(de - dr);
        }
    }
    const p = [o[0] + d[0] * s, o[1] + d[1] * s, o[2] + d[2] * s];
    const q = [a[0] + e[0] * t, a[1] + e[1] * t, a[2] + e[2] * t];
    return { s, t, dist: Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!, p[2]! - q[2]!) };
}

/**
 * Lane edit4c C3 (E11, brief 561: 'on the overview, put the frames out'): the leg a click points at. The pilot sees the
 * course's legs in front of the scan; a click whose ray passes a leg (within ON_LEG_MIN_M, or ON_LEG_SHARE of the way) before
 * it meets the wall at `maxS` means that leg, not the wall behind it (measured on a Shift+G course: a click between gates 9
 * and 10, 12 m off, met a wall 36 m off and the gate went after gate 3). The nearest such leg along the ray wins; the point
 * on it keeps ON_LEG_END_M from both ends. Null: the ray passes no leg (the wall point stands).
 */
export function legOnRay(points: readonly V3[], o: V3, d: V3, maxS: number): { after: number; at: V3 } | null {
    let best: { after: number; s: number; t: number } | null = null;
    for (let i = 0; i + 1 < points.length; i++) {
        const a = points[i]!;
        const b = points[i + 1]!;
        const c = rayToSegment(o, d, maxS, a, b);
        if (c.s < ON_LEG_NEAR_M || c.dist > Math.max(ON_LEG_MIN_M, c.s * ON_LEG_SHARE)) continue;
        if (!best || c.s < best.s) best = { after: i, s: c.s, t: c.t };
    }
    if (!best) return null;
    const a = points[best.after]!;
    const b = points[best.after + 1]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const keep = len > 2 * ON_LEG_END_M ? ON_LEG_END_M / len : 0.5;
    const t = Math.max(keep, Math.min(1 - keep, best.t));
    return { after: best.after, at: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t] };
}

/**
 * Where a new gate at `at` goes in the order of the gates standing at `points` (flown): the index of the gate it follows
 * (-1: before the first). After the gate whose leg to the next passes nearest to the point; beyond the last gate's end of
 * the last leg (or nearer to the last gate than to any leg while the last gate is selected) after the last; before the
 * first leg's start, first. An empty course: first; one gate: after it.
 */
export function placeInCourse(points: readonly V3[], selected: number, at: V3): number {
    const n = points.length;
    if (n === 0) return -1;
    if (n === 1) return 0;
    let best = 0;
    let near = nearOnSegment(points[0]!, points[1]!, at);
    for (let i = 1; i + 1 < n; i++) {
        const c = nearOnSegment(points[i]!, points[i + 1]!, at);
        if (c.dist < near.dist - 1e-9) {
            best = i;
            near = c;
        }
    }
    const last = points[n - 1]!;
    const toLast = Math.hypot(at[0] - last[0], at[1] - last[1], at[2] - last[2]);
    if (best === n - 2 && near.t >= 1 - 1e-9) return n - 1;
    if (selected === n - 1 && toLast <= near.dist) return n - 1;
    if (best === 0 && near.t <= 1e-9) return -1;
    return best;
}
