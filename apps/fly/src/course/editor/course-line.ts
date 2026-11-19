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
