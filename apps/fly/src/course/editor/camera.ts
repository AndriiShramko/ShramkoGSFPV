// The editor's camera (lane tracks2, stage K2): the selected gate is in view when the editor opens and whenever the selection
// moves or the gate changes. The flight camera stays at the paused drone, which may face away from the gate; this camera
// stands between the drone and the gate, CAM_NEAR_M from the gate and CAM_UP_M above that line, and looks at the gate.
// It never stands in a wall: the way from the drone (always in free space) to the eye is cast against the walls and the eye
// stops short of the first hit. Pure: the walls come in as a ray function.

export type V3 = readonly [number, number, number];

/** the distance from the eye to the selected gate's centre, flown m (an estimate: a 1.2 m gate fills a good part of the view) */
export const CAM_NEAR_M = 3.5;
/** how far the eye rises above the line drone-gate, flown m (an estimate: the gate is seen a little from above) */
export const CAM_UP_M = 0.6;
/** the eye keeps this far from a wall the cast hit, flown m (an estimate, above the near plane) */
export const CAM_WALL_GAP_M = 0.3;

/** The distance to the first wall from `o` along the unit direction `d` within `max`, or null when the way is clear. */
export type RayFn = (o: V3, d: V3, max: number) => number | null;

export interface GateView {
    /** where the camera stands, flown frame */
    readonly eye: V3;
    /** what it looks at: the gate's centre */
    readonly at: V3;
    /** the view's forward on the floor (x, z), unit; the arrows move the gate by it (course/editor/keys.ts arrowMove) */
    readonly forward: readonly [number, number] | null;
}

const sub = (a: V3, b: V3): [number, number, number] => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);

/** The camera for the selected gate at `gate` seen from the paused drone at `drone`; `ray` null: no walls known. */
export function gateCamera(gate: V3, drone: V3, ray: RayFn | null): GateView {
    const back = sub(drone, gate);
    const d = len(back);
    let want: [number, number, number];
    if (d > CAM_NEAR_M) {
        const k = CAM_NEAR_M / d;
        want = [gate[0] + back[0] * k, gate[1] + back[1] * k + CAM_UP_M, gate[2] + back[2] * k];
    } else want = [drone[0], drone[1] + CAM_UP_M, drone[2]];
    // from the drone to the wanted eye: stop short of a wall
    const way = sub(want, drone);
    const w = len(way);
    let eye: V3 = want;
    if (ray && w > 1e-6) {
        const u: V3 = [way[0] / w, way[1] / w, way[2] / w];
        const hit = ray(drone, u, w + CAM_WALL_GAP_M);
        if (hit !== null) {
            const s = Math.max(0, hit - CAM_WALL_GAP_M);
            eye = [drone[0] + u[0] * s, drone[1] + u[1] * s, drone[2] + u[2] * s];
        }
    }
    const look = sub(gate, eye);
    const h = Math.hypot(look[0], look[2]);
    return { eye, at: gate, forward: h > 1e-3 ? [look[0] / h, look[2] / h] : null };
}

/** below this share of the width left free by the editor's window the gate stays in the middle (an estimate) */
export const AIM_MIN_FREE = 0.2;

/**
 * Stage K2.6: where the camera looks so that the gate sits in the middle of the part of the screen the editor's window leaves
 * free on the left. `freeShare` is the window's left edge over the screen's width (1: no window), `hFovDeg` the camera's
 * horizontal field. The look turns right by the angle at which the free part's middle is seen; the eye stays.
 */
export function aimAt(eye: V3, gate: V3, freeShare: number, hFovDeg: number): V3 {
    if (!(freeShare < 0.98) || freeShare < AIM_MIN_FREE || !(hFovDeg > 1 && hFovDeg < 179)) return gate;
    const look = sub(gate, eye);
    const h = Math.hypot(look[0], look[2]);
    if (h < 1e-6) return gate;
    // the free part's middle at screen x (ndc) freeShare - 1, seen at this angle left of the view's axis
    const th = Math.atan((1 - freeShare) * Math.tan((hFovDeg * Math.PI) / 360));
    const fx = look[0] / h;
    const fz = look[2] / h;
    // right on screen = forward x up = (-fz, 0, fx); the axis turns right by th
    const c = Math.cos(th);
    const s = Math.sin(th);
    return [eye[0] + (c * fx - s * fz) * h, gate[1], eye[2] + (c * fz + s * fx) * h];
}

/** The screen x of `p` seen from `eye` towards `at` with the horizontal field `hFovDeg` (pitch left out): 0 left edge, 1 right; null behind. */
export function screenX(p: V3, eye: V3, at: V3, hFovDeg: number): number | null {
    const f = sub(at, eye);
    const fh = Math.hypot(f[0], f[2]);
    if (fh < 1e-9) return null;
    const fx = f[0] / fh;
    const fz = f[2] / fh;
    const v = sub(p, eye);
    const z = v[0] * fx + v[2] * fz;
    if (z <= 0) return null;
    const x = (v[0] * -fz + v[2] * fx) / z;
    return (x / Math.tan((hFovDeg * Math.PI) / 360) + 1) / 2;
}

/** Whether the point `p` is inside the view of a camera at `eye` looking at `at` with a vertical field of `fovDeg`, `aspect`. */
export function inView(p: V3, eye: V3, at: V3, fovDeg: number, aspect: number): boolean {
    const f = sub(at, eye);
    const fl = len(f);
    if (fl < 1e-9) return false;
    const fz: V3 = [f[0] / fl, f[1] / fl, f[2] / fl];
    // right = forward x up(0,1,0), up' = right x forward
    let r: [number, number, number] = [-fz[2], 0, fz[0]];
    const rl = Math.hypot(r[0], r[2]);
    r = rl > 1e-9 ? [r[0] / rl, 0, r[2] / rl] : [1, 0, 0];
    const u: V3 = [r[1] * fz[2] - r[2] * fz[1], r[2] * fz[0] - r[0] * fz[2], r[0] * fz[1] - r[1] * fz[0]];
    const v = sub(p, eye);
    const z = v[0] * fz[0] + v[1] * fz[1] + v[2] * fz[2];
    if (z <= 0) return false;
    const ty = Math.tan((fovDeg * Math.PI) / 360);
    const x = (v[0] * r[0] + v[1] * r[1] + v[2] * r[2]) / z;
    const y = (v[0] * u[0] + v[1] * u[1] + v[2] * u[2]) / z;
    return Math.abs(y) <= ty && Math.abs(x) <= ty * aspect;
}
