// Head pose for Fly by Sound's head tracking (lane head4, docs/wip/sonic-headtrack-plan.md part 1). Pure: no DOM, no Web
// Audio. The sound package keeps planning every cue in the craft frame (what is ahead of the nose, the rear timbre, the
// height steps): those codes never move with the head. Only where the ears hear a voice follows the head, and the page
// does that by turning the AudioListener (listener-turn.ts): a listener turned by the head pose hears a voice at
// direction d (craft listener frame) at headDirection(pose, d).
//
// Frames: the listener frame of the sound package, x right, y up, z back (forward is -z). Angles in degrees:
// yaw > 0 the head turns right, pitch > 0 the head tips up (the nose rises), roll > 0 the right ear goes down.

export type Vec3 = readonly [number, number, number];

/** The pilot's head relative to straight ahead at the screen, degrees. */
export interface HeadPose {
    readonly yawDeg: number;
    readonly pitchDeg: number;
    readonly rollDeg: number;
}

/** The head's own axes in the listener frame: what AudioListener.forward and .up take. */
export interface HeadAxes {
    readonly forward: Vec3;
    readonly up: Vec3;
    readonly right: Vec3;
}

export const STRAIGHT: HeadPose = { yawDeg: 0, pitchDeg: 0, rollDeg: 0 };

/**
 * How far each angle may go, degrees. Cat3DA clamps all three at 35 (controls.FOV); past about that a webcam loses the
 * face. Our own limit is measured by the tracker probe of stage H3 [guess until then].
 */
export const POSE_LIMIT_DEG: HeadPose = { yawDeg: 35, pitchDeg: 25, rollDeg: 25 };

const DEG = Math.PI / 180;

function clampTo(v: number, lim: number): number {
    return v > lim ? lim : v < -lim ? -lim : v;
}

export function clampPose(p: HeadPose, lim: HeadPose = POSE_LIMIT_DEG): HeadPose {
    return { yawDeg: clampTo(p.yawDeg, lim.yawDeg), pitchDeg: clampTo(p.pitchDeg, lim.pitchDeg), rollDeg: clampTo(p.rollDeg, lim.rollDeg) };
}

/** pose a minus pose b, angle by angle (the recentre: the pose the pilot held when centring becomes zero). */
export function subtractPose(a: HeadPose, b: HeadPose): HeadPose {
    return { yawDeg: a.yawDeg - b.yawDeg, pitchDeg: a.pitchDeg - b.pitchDeg, rollDeg: a.rollDeg - b.rollDeg };
}

/** a + (b - a) * k, angle by angle. */
export function mixPose(a: HeadPose, b: HeadPose, k: number): HeadPose {
    return { yawDeg: a.yawDeg + (b.yawDeg - a.yawDeg) * k, pitchDeg: a.pitchDeg + (b.pitchDeg - a.pitchDeg) * k, rollDeg: a.rollDeg + (b.rollDeg - a.rollDeg) * k };
}

/** The head's axes: roll about the nose, then pitch about the ears, then yaw about the craft's up. */
export function headAxes(p: HeadPose): HeadAxes {
    const sp = Math.sin(p.pitchDeg * DEG), cp = Math.cos(p.pitchDeg * DEG);
    const sr = Math.sin(p.rollDeg * DEG), cr = Math.cos(p.rollDeg * DEG);
    const sy = Math.sin(p.yawDeg * DEG), cy = Math.cos(p.yawDeg * DEG);
    // pitch: the nose up toward +y, the top of the head back toward +z
    const f0: Vec3 = [0, sp, -cp];
    const u0: Vec3 = [0, cp, sp];
    const r0: Vec3 = [1, 0, 0];
    // roll about the nose: the top of the head toward the right ear's side
    const u1: Vec3 = [cr * u0[0] + sr * r0[0], cr * u0[1] + sr * r0[1], cr * u0[2] + sr * r0[2]];
    const r1: Vec3 = [cr * r0[0] - sr * u0[0], cr * r0[1] - sr * u0[1], cr * r0[2] - sr * u0[2]];
    // yaw about +y: forward (0,0,-1) turns to (sin, 0, -cos), a turn to the right
    const yaw = (v: Vec3): Vec3 => [v[0] * cy - v[2] * sy, v[1], v[0] * sy + v[2] * cy];
    return { forward: yaw(f0), up: yaw(u1), right: yaw(r1) };
}

/** Where a voice at listener-frame direction d is heard by a head at pose p, in the head's own frame (x right, y up, z back). */
export function headDirection(p: HeadPose, d: Vec3): Vec3 {
    const a = headAxes(p);
    const dot = (u: Vec3): number => u[0] * d[0] + u[1] * d[1] + u[2] * d[2];
    return [dot(a.right), dot(a.up), -dot(a.forward)];
}

/** Bearing of a listener-frame direction, degrees, > 0 to the right (the package's pannerDirection azimuth). */
export function bearingDeg(d: Vec3): number {
    return Math.atan2(d[0], -d[2]) / DEG;
}

/**
 * The pose from MediaPipe Face Landmarker's facial transformation matrix (4 x 4, column-major `data`): the canonical
 * face's axes in the camera's frame (x to the right of the picture, y up, z out of the screen toward the pilot). The
 * picture is not mirrored, so the pilot's right is the picture's left: a head turned right points its nose to camera -x.
 * Signs to be confirmed on a recorded head turn by the tracker probe of stage H3 [guess until then].
 */
export function poseFromFaceMatrix(data: ArrayLike<number>): HeadPose {
    // column 1: the face's up, column 2: out of the face (the nose's way)
    const ux = data[4] as number, uy = data[5] as number;
    const nx = data[8] as number, ny = data[9] as number, nz = data[10] as number;
    const yawDeg = Math.atan2(-nx, nz) / DEG;
    const pitchDeg = Math.atan2(ny, Math.hypot(nx, nz)) / DEG;
    const rollDeg = Math.atan2(-ux, uy) / DEG;
    return { yawDeg, pitchDeg, rollDeg };
}
