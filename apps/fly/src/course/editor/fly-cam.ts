// The edit mode's own camera (lane editor3, stage E2, docs/wip/editor3.md "The design", Camera): the owner's words of message
// 51, "move around the scene: look, go right, go left, move away, with the usual W A S D, up, down, fly between the
// obstacles". W A S D move along the view, E up, Q down (the fly keys of Unity and Unreal), Shift faster; the right mouse
// button held (or a left drag on empty space) turns the view; the wheel sets the speed. The camera is a view, not a drone:
// it passes walls. Pure: the page feeds it the keys held, the mouse movement and the frame time.

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

/** The speed after a wheel turn of `deltaY` (WheelEvent.deltaY: negative away from the user = faster). */
export function wheelSpeed(speed: number, deltaY: number): number {
    if (!Number.isFinite(deltaY) || deltaY === 0) return clamp(speed, CAM_SPEED_MIN, CAM_SPEED_MAX);
    const s = deltaY < 0 ? speed * CAM_WHEEL_STEP : speed / CAM_WHEEL_STEP;
    return clamp(s, CAM_SPEED_MIN, CAM_SPEED_MAX);
}
