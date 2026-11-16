// Lane editor3 I1 (decision D4 of train 3): a turn ring seen edge-on is drawn as a line, and the gizmo's own pick on its thin
// torus misses it. The edit view takes such a ring itself: the nearest ring within RING_PICK_PX of its drawn line, and a drag
// across that line turns the gate about the ring's axis. Pure: the rings come in as their drawn points on the page.

export type P2 = readonly [number, number];

/** how near the pointer must be to a ring's drawn line, CSS px (D4: about 10 px) */
export const RING_PICK_PX = 10;
/** a ring whose drawn ellipse is thinner than this (its minor axis, CSS px) is taken by the edit view, not by the gizmo */
export const RING_EDGE_PX = 25;
/** degrees of turn per CSS px of travel across the ring's line (an estimate, D4: about 0.5) */
export const RING_DEG_PER_PX = 0.5;

export interface DrawnRing {
    /** the ring's points on the page, in order round the ring (closed) */
    readonly pts: readonly P2[];
    /** its minor axis on the page, CSS px */
    readonly minor: number;
    /** the ring's own axis (the one it turns about) as drawn on the page: the way from its centre to centre + axis */
    readonly axis?: P2;
}

/**
 * Review EI-4: an edge-on ring is drawn as a polyline folded on itself, its front and back halves with opposite segment
 * directions, so the nearest segment's direction flipped by a sub-pixel. The tangent is turned so that the way across it
 * (ringTurnDeg's) points along the ring's drawn axis, or, with no axis, to the page's right (then down): the same drag turns
 * the same way on every press.
 */
export function orientTangent(t: P2, axis?: P2): P2 {
    // across the line, as ringTurnDeg reads it: (-t.y, t.x)
    const ax = -t[1];
    const ay = t[0];
    const k = axis && Math.hypot(axis[0], axis[1]) > 1e-6 ? ax * axis[0] + ay * axis[1] : Math.abs(ax) > 1e-9 ? ax : ay;
    return k < 0 ? [-t[0], -t[1]] : t;
}

/** The minor axis of a drawn ring around its drawn centre `c`: twice the nearest point's distance (an ellipse's semi-minor). */
export function minorAxis(pts: readonly P2[], c: P2): number {
    let m = Infinity;
    for (const p of pts) m = Math.min(m, Math.hypot(p[0] - c[0], p[1] - c[1]));
    return Number.isFinite(m) ? 2 * m : 0;
}

/** The distance from `m` to the segment a-b and the segment's unit direction. */
function segment(m: P2, a: P2, b: P2): { d: number; t: P2 } {
    const vx = b[0] - a[0];
    const vy = b[1] - a[1];
    const l2 = vx * vx + vy * vy;
    const k = l2 > 0 ? Math.max(0, Math.min(1, ((m[0] - a[0]) * vx + (m[1] - a[1]) * vy) / l2)) : 0;
    const d = Math.hypot(m[0] - (a[0] + vx * k), m[1] - (a[1] + vy * k));
    const l = Math.sqrt(l2);
    return { d, t: l > 0 ? [vx / l, vy / l] : [1, 0] };
}

/** J1 (E3): a picked ring: its index (0 x, 1 y, 2 z), its line's oriented direction there, the pointer's distance to it,
 *  whether it is seen edge-on, and the page direction a drag must take to turn it the positive way (unit) */
export interface RingPick {
    readonly index: number;
    readonly tangent: P2;
    readonly dist: number;
    readonly edge: boolean;
    readonly dir: P2;
}

/**
 * The ring under the pointer `m`: the nearest within `tolPx` of its drawn line, with the line's unit direction there. J1 (E3
 * of train 3): every ring, not only the thin ones. PlayCanvas 2.23.2 RotateGizmo in its absolute mode turns a ring by the
 * drag projected on one fixed page direction whatever point of the ring was pressed, so a drag along the y ring at its
 * side gave 0 deg after the snap. The edit view turns every ring itself: an edge-on one (minor axis below `edgePx`) by the
 * drag across its line (`dir` = the oriented tangent turned a quarter, as ringTurnDeg), an open one by the drag along the
 * drawn segment (`dir` = the segment's own direction: the points come in the order a positive turn moves them). Null: none.
 */
export function pickRing(m: P2, rings: readonly DrawnRing[], tolPx = RING_PICK_PX, edgePx = RING_EDGE_PX): RingPick | null {
    let best: RingPick | null = null;
    rings.forEach((r, i) => {
        if (r.pts.length < 2) return;
        const edge = r.minor < edgePx;
        for (let k = 0; k < r.pts.length; k++) {
            const s = segment(m, r.pts[k]!, r.pts[(k + 1) % r.pts.length]!);
            if (s.d > tolPx || (best && s.d >= best.dist)) continue;
            const t = orientTangent(s.t, r.axis);
            best = { index: i, tangent: t, dist: s.d, edge, dir: edge ? [-t[1], t[0]] : s.t };
        }
    });
    return best;
}

/** J1 (E3): the turn in degrees for the pointer's travel (dx, dy) from the press: the share along `dir` times `degPerPx` */
export function ringDeg(dir: P2, dx: number, dy: number, degPerPx = RING_DEG_PER_PX): number {
    return degPerPx * (dx * dir[0] + dy * dir[1]);
}

/**
 * Who keeps a press when an edge-on ring is near the pointer. `gizmoAxis`: the axis of the gizmo's own nearest shape under
 * the pointer ('x', 'y', 'z', 'xyz', ...), null when it has none. The edit view takes the press when the gizmo has nothing
 * there or when the gizmo's shape is that same edge-on ring: PlayCanvas 2.23.2 picks a ring seen edge-on but turns it by 0
 * deg (measured: editor3-gizmo.ts on Tunis, 64 px across the y ring with its minor axis at 4 px gave 0 deg). Another ring
 * the gizmo picked (a facing one crossing the line) stays the gizmo's.
 */
export function edgeTakesPress(gizmoAxis: string | null, edgeIndex: number | null): boolean {
    if (edgeIndex === null) return false;
    return !gizmoAxis || gizmoAxis === 'xyz'[edgeIndex];
}

/** The turn in degrees for the pointer's travel (dx, dy) from the press: the share across the ring's line times `degPerPx`. */
export function ringTurnDeg(tangent: P2, dx: number, dy: number, degPerPx = RING_DEG_PER_PX): number {
    // across the line: the tangent turned a quarter (page y points down)
    return degPerPx * (dx * -tangent[1] + dy * tangent[0]);
}
