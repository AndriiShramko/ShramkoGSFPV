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

/**
 * The ring under the pointer `m` among the thin ones (minor axis below `edgePx`): the nearest within `tolPx` of its drawn
 * line, with the line's unit direction there. Null: none (the gizmo's own pick has the press).
 */
export function pickRing(m: P2, rings: readonly DrawnRing[], tolPx = RING_PICK_PX, edgePx = RING_EDGE_PX): { index: number; tangent: P2; dist: number } | null {
    let best: { index: number; tangent: P2; dist: number } | null = null;
    rings.forEach((r, i) => {
        if (!(r.minor < edgePx) || r.pts.length < 2) return;
        for (let k = 0; k < r.pts.length; k++) {
            const s = segment(m, r.pts[k]!, r.pts[(k + 1) % r.pts.length]!);
            if (s.d <= tolPx && (!best || s.d < best.dist)) best = { index: i, tangent: s.t, dist: s.d };
        }
    });
    return best;
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
