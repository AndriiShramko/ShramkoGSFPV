// The camera of the game scheme (docs/wip/v09-b.md): a stabilised gimbal. The view looks along the pilot's aim
// heading at the gimbal's pitch from the horizon, with no roll, however the body pitches and rolls under it;
// like a camera drone's gimbal, and like the view of a game, which is what the mouse sets. Render only: the
// flight model never sees it (it is the same kind of thing as the camera uptilt, session setCamera).
// Pure: no DOM.

/** Where the stabilised camera looks: heading right-turn positive from the scene's -z, pitch up positive, degrees. */
export interface CameraAim { yawDeg: number; pitchDeg: number }

/**
 * The camera's orientation as a quaternion (w, x, y, z) in the world, for the renderer's setPose with an
 * uptilt of 0. The camera looks along its -z; a rotation about +y by -heading turns it to the heading
 * (heading 90 deg looks along +x), and a rotation about its own x by the pitch raises the view.
 */
export function gimbalQuat(aim: CameraAim): [number, number, number, number] {
    const h = (-aim.yawDeg * Math.PI) / 360; // half of -heading, radians
    const p = (aim.pitchDeg * Math.PI) / 360; // half of the pitch
    const wy = Math.cos(h), y = Math.sin(h);
    const wx = Math.cos(p), x = Math.sin(p);
    // q = rotY(-heading) * rotX(pitch)
    return [wy * wx, wy * x, y * wx, -y * x];
}
