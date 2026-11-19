// The edit mode's own camera (lane editor3, stage E2, docs/wip/editor3.md "The design", Camera): the owner's words of message
// 51, "move around the scene: look, go right, go left, move away, with the usual W A S D, up, down, fly between the
// obstacles". W A S D move along the view, E up, Q down (the fly keys of Unity and Unreal), Shift faster; the right mouse
// button held (or a left drag on empty space) turns the view; the wheel sets the speed. The camera is a view, not a drone:
// it passes walls. Pure: the page feeds it the keys held, the mouse movement and the frame time.
// Lane edit4a A1: the wheel now moves the view to the point under the cursor (dollyCam); the speed is the wheel with the
// right button held. A left drag on empty space circles round (orbitCam), Shift slides (panCam).

export type V3 = readonly [number, number, number];

export interface FlyCam {
    readonly pos: V3;
    /** the heading, radians: 0 looks along -Z, positive turns right seen from above (towards +X) */
    readonly yaw: number;
    /** radians, positive looks up; kept inside PITCH_MAX */
    readonly pitch: number;
    /** flown m/s at a plain press */
    readonly speed: number;
}

/** the speed the camera starts at, flown m/s (an estimate: a walk through a room in a few seconds) */
export const CAM_SPEED_M_S = 4;
/** the wheel's range of speeds, flown m/s (The design, Camera) */
export const CAM_SPEED_MIN = 0.5;
export const CAM_SPEED_MAX = 20;
/** one wheel notch multiplies or divides the speed by this (an estimate: about ten notches from the slowest to the fastest) */
export const CAM_WHEEL_STEP = 1.35;
/** Shift held: this many times faster (an estimate) */
export const CAM_FAST = 3;
/** degrees of turn per pixel of mouse movement (an estimate, near a game's default look) */
export const CAM_DEG_PER_PX = 0.2;
/** the view never looks straight up or down (the heading would be lost) */
export const PITCH_MAX = (89 * Math.PI) / 180;
/** a frame longer than this moves the camera as if it were this long (a hitch does not throw the camera away), s */
export const CAM_DT_MAX = 0.1;

/** the keys the camera takes in the edit mode (KeyboardEvent.code) */
export const CAM_KEYS: ReadonlySet<string> = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE', 'KeyQ']);

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** The camera standing at `eye` and looking at `at`. */
export function camFrom(eye: V3, at: V3, speed = CAM_SPEED_M_S): FlyCam {
    const dx = at[0] - eye[0];
    const dy = at[1] - eye[1];
    const dz = at[2] - eye[2];
    const h = Math.hypot(dx, dz);
    const yaw = h > 1e-9 ? Math.atan2(dx, -dz) : 0;
    const pitch = clamp(Math.atan2(dy, h), -PITCH_MAX, PITCH_MAX);
    return { pos: [eye[0], eye[1], eye[2]], yaw, pitch, speed: clamp(speed, CAM_SPEED_MIN, CAM_SPEED_MAX) };
}

/** The unit direction the camera looks along. */
export function camForward(c: FlyCam): [number, number, number] {
    const cp = Math.cos(c.pitch);
    return [Math.sin(c.yaw) * cp, Math.sin(c.pitch), -Math.cos(c.yaw) * cp];
}

/**
 * G2 (measured in g2/floor3): the ray of a click at canvas pixel (x, y) of a w x h canvas, from the edit camera's own pose,
 * not from the renderer's camera entity: after a test flight in the mode the entity held the drone's pose at the time of the
 * pointerup (ray origin 0.69 m over the spawn, looking down, while the edit view stood at 7 m), so a floor click put the gate
 * behind the view inside a wall. `fovDeg` is the camera's field of view, horizontal when `horizontalFov`. No roll (lookAt
 * with the world up, as setCameraLookAt).
 */
export function camRay(c: FlyCam, x: number, y: number, w: number, h: number, fovDeg: number, horizontalFov: boolean): { o: V3; d: V3 } | null {
    if (!(w > 0 && h > 0 && fovDeg > 0 && fovDeg < 180)) return null;
    const aspect = w / h;
    const t = Math.tan((fovDeg * Math.PI) / 360);
    const tanH = horizontalFov ? t : t * aspect;
    const tanV = horizontalFov ? t / aspect : t;
    const nx = (2 * x) / w - 1;
    const ny = 1 - (2 * y) / h;
    const f = camForward(c);
    const sy = Math.sin(c.yaw);
    const cy = Math.cos(c.yaw);
    const sp = Math.sin(c.pitch);
    const cp = Math.cos(c.pitch);
    const r = [cy, 0, sy];
    const u = [-sy * sp, cp, cy * sp];
    const d = [0, 1, 2].map((i) => f[i]! + nx * tanH * r[i]! + ny * tanV * u[i]!);
    const n = Math.hypot(d[0]!, d[1]!, d[2]!);
    if (!(n > 1e-9)) return null;
    return { o: [c.pos[0], c.pos[1], c.pos[2]], d: [d[0]! / n, d[1]! / n, d[2]! / n] };
}

/** A point one metre ahead of the camera (what setCameraLookAt looks at). */
export function camTarget(c: FlyCam): [number, number, number] {
    const f = camForward(c);
    return [c.pos[0] + f[0], c.pos[1] + f[1], c.pos[2] + f[2]];
}

/** The camera after `dt` seconds with the key codes `held` down (`fast`: Shift). */
export function stepCam(c: FlyCam, held: ReadonlySet<string>, fast: boolean, dt: number): FlyCam {
    const t = clamp(Number.isFinite(dt) ? dt : 0, 0, CAM_DT_MAX);
    const fw = (held.has('KeyW') ? 1 : 0) - (held.has('KeyS') ? 1 : 0);
    const rt = (held.has('KeyD') ? 1 : 0) - (held.has('KeyA') ? 1 : 0);
    const up = (held.has('KeyE') ? 1 : 0) - (held.has('KeyQ') ? 1 : 0);
    if (t === 0 || (fw === 0 && rt === 0 && up === 0)) return c;
    const f = camForward(c);
    // right of the view on the floor: (cos yaw, 0, sin yaw)
    const r: V3 = [Math.cos(c.yaw), 0, Math.sin(c.yaw)];
    let v: [number, number, number] = [f[0] * fw + r[0] * rt, f[1] * fw + up, f[2] * fw + r[2] * rt];
    const n = Math.hypot(v[0], v[1], v[2]);
    if (n < 1e-9) return c;
    const k = (c.speed * (fast ? CAM_FAST : 1) * t) / n;
    v = [v[0] * k, v[1] * k, v[2] * k];
    return { ...c, pos: [c.pos[0] + v[0], c.pos[1] + v[1], c.pos[2] + v[2]] };
}

/** The camera turned by a mouse movement of `dxPx`, `dyPx` (right and down positive, as MouseEvent.movementX/Y). */
export function turnCam(c: FlyCam, dxPx: number, dyPx: number, degPerPx = CAM_DEG_PER_PX): FlyCam {
    const k = (degPerPx * Math.PI) / 180;
    const yaw = c.yaw + dxPx * k;
    const pitch = clamp(c.pitch - dyPx * k, -PITCH_MAX, PITCH_MAX);
    // the heading kept in (-pi, pi]
    const w = Math.atan2(Math.sin(yaw), Math.cos(yaw));
    return { ...c, yaw: w, pitch };
}

// Lane edit4a A1 (complaint E3, brief 545 and 547: "as in Blender, the pilot sets his own view"): the orbit, the pan and the
// dolly of an ordinary 3D editor, the scheme of PlayCanvas's camera-controls and of the SuperSplat editor. Pure.

/** degrees of orbit per pixel of drag (an estimate, near Blender's turntable at a 1366 px wide window) */
export const ORBIT_DEG_PER_PX = 0.3;
/** one wheel notch moves the view this share of the way to the point under the cursor (edit4 design A1) */
export const DOLLY_SHARE = 0.15;
/** one notch moves at least this far, flown m (edit4 design A1) */
export const DOLLY_MIN_M = 0.2;
/** the dolly stops this far before the point under the cursor, flown m: never through it (edit4 design A1) */
export const DOLLY_STOP_M = 0.5;
/** the pivot of an orbit or the point of a dolly when nothing is under the cursor: this far ahead, flown m (design A1) */
export const PIVOT_AHEAD_M = 10;
/** a pinch on a touch pad (Chrome: a wheel with ctrlKey) sends small steps: this many times one scroll step (an estimate) */
export const PINCH_GAIN = 8;
/** the most notches one wheel event counts as (a fast flick of a free wheel does not throw the view away) */
export const NOTCHES_MAX = 3;

type M3 = [number, number, number];
const add = (a: V3, b: V3, k = 1): M3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** The view's right and up (unit, no roll), as camRay uses them. */
export function camBasis(c: FlyCam): { f: M3; r: M3; u: M3 } {
    const sy = Math.sin(c.yaw);
    const cy = Math.cos(c.yaw);
    const sp = Math.sin(c.pitch);
    const cp = Math.cos(c.pitch);
    return { f: camForward(c), r: [cy, 0, sy], u: [-sy * sp, cp, cy * sp] };
}

/**
 * The view circled round `pivot` by a drag of `dxPx`, `dyPx` (right and down positive): the eye and the heading turn
 * together, so the pivot keeps its distance and its place on the screen (Blender's orbit; a drag to the right turns the view
 * right, as turnCam). The pitch stays inside PITCH_MAX.
 */
export function orbitCam(c: FlyCam, pivot: V3, dxPx: number, dyPx: number, degPerPx = ORBIT_DEG_PER_PX): FlyCam {
    const b0 = camBasis(c);
    const v: V3 = [c.pos[0] - pivot[0], c.pos[1] - pivot[1], c.pos[2] - pivot[2]];
    // the eye in the view's own frame
    const lr = dot(v, b0.r);
    const lu = dot(v, b0.u);
    const lf = dot(v, b0.f);
    const t = turnCam(c, dxPx, dyPx, degPerPx);
    const b1 = camBasis(t);
    const p = add(add(add(pivot, b1.r, lr), b1.u, lu), b1.f, lf);
    return { ...t, pos: p };
}

/**
 * The view slid along its own right and up by a drag (Shift held): the scene follows the cursor, so a point `distM` away
 * moves with the pointer. `tanHalfV` and `viewHPx`: the view's vertical field and height. The heading stays.
 */
export function panCam(c: FlyCam, dxPx: number, dyPx: number, distM: number, tanHalfV: number, viewHPx: number): FlyCam {
    if (!(viewHPx > 0) || !(distM > 0) || !(tanHalfV > 0)) return c;
    const mPerPx = (2 * distM * tanHalfV) / viewHPx;
    const b = camBasis(c);
    return { ...c, pos: add(add(c.pos, b.r, -dxPx * mPerPx), b.u, dyPx * mPerPx) };
}

/** How many wheel notches one WheelEvent is (a mouse notch 1, a touch pad's two-finger scroll a share of one); signed as
 *  deltaY (negative: towards the scene). `mode`: WheelEvent.deltaMode (0 pixels, 1 lines, 2 pages); `pinch`: ctrlKey. */
export function wheelNotches(deltaY: number, mode: number, pinch: boolean): number {
    if (!Number.isFinite(deltaY) || deltaY === 0) return 0;
    const n = mode === 1 ? deltaY / 3 : mode === 2 ? deltaY : deltaY / 100;
    const k = pinch ? n * PINCH_GAIN : n;
    return clamp(k, -NOTCHES_MAX, NOTCHES_MAX);
}

/**
 * The view moved towards (`notches` negative) or away from the point `toward` (the scene under the cursor), DOLLY_SHARE of
 * the distance a notch and at least DOLLY_MIN_M, stopping DOLLY_STOP_M before the point. The heading stays.
 */
export function dollyCam(c: FlyCam, toward: V3, notches: number): FlyCam {
    if (!Number.isFinite(notches) || notches === 0) return c;
    const v: V3 = [toward[0] - c.pos[0], toward[1] - c.pos[1], toward[2] - c.pos[2]];
    const d = Math.hypot(v[0], v[1], v[2]);
    if (!(d > 1e-6)) return c;
    const n = Math.abs(notches);
    let step = Math.max(DOLLY_MIN_M * n, d * (1 - Math.pow(1 - DOLLY_SHARE, n)));
    if (notches < 0) step = Math.min(step, d - DOLLY_STOP_M);
    else step = -step;
    if (notches < 0 && step <= 0) return c;
    return { ...c, pos: add(c.pos, v, step / d) };
}

/** The speed after a wheel turn of `deltaY` (WheelEvent.deltaY: negative away from the user = faster). */
export function wheelSpeed(speed: number, deltaY: number): number {
    if (!Number.isFinite(deltaY) || deltaY === 0) return clamp(speed, CAM_SPEED_MIN, CAM_SPEED_MAX);
    const s = deltaY < 0 ? speed * CAM_WHEEL_STEP : speed / CAM_WHEEL_STEP;
    return clamp(s, CAM_SPEED_MIN, CAM_SPEED_MAX);
}
