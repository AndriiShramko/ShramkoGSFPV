// What the HUD's wind dial shows (v0.7 lane E; ui/wind-dial.ts draws it), without the DOM: the wind
// the craft flies in now relative to its nose, and where north is when the scene has a compass
// heading. Angles are degrees clockwise from the nose (screen up), as the craft turns right.
// Node tests: tools/bench/test/wind-ceiling-app.test.ts.

/** Which way the wind comes at the craft: on the nose, from behind, or from a side. */
export type WindSide = 'head' | 'tail' | 'left' | 'right';

export interface WindDialView {
    /** where the wind blows TO, relative to the nose (0 = straight ahead, 90 = to the right); null in still air */
    toRelDeg: number | null;
    /** horizontal wind speed at the craft, m/s; null in still air */
    speed: number | null;
    side: WindSide | null;
    /** where north is, relative to the nose; null when the scene has no compass heading */
    northRelDeg: number | null;
}

/** An angle into (-180, 180]. */
export function wrap180(a: number): number {
    let x = a % 360;
    if (x > 180) x -= 360;
    if (x <= -180) x += 360;
    return x;
}

/** A wind coming from `fromRel` degrees off the nose: within 30 deg of the nose a headwind, within 30 of the tail a tailwind, else its side. */
export function windSide(fromRelDeg: number): WindSide {
    const a = wrap180(fromRelDeg);
    if (Math.abs(a) <= 30) return 'head';
    if (Math.abs(a) >= 150) return 'tail';
    return a > 0 ? 'right' : 'left';
}

/**
 * The dial for a craft with heading `yawDeg` (sim-core attitude().yaw: 0 = the scene's -z, + right)
 * in the wind vector `wind` (world frame, m/s; null or calm = still air), on a scene whose heading 0
 * points to compass `compassDeg` (null: unknown).
 */
export function windDialView(yawDeg: number, wind: ArrayLike<number> | null, compassDeg: number | null): WindDialView {
    let toRelDeg: number | null = null, speed: number | null = null, side: WindSide | null = null;
    if (wind) {
        const h = Math.hypot(wind[0], wind[2]);
        if (h > 1e-3) {
            // heading psi points along (sin psi, 0, -cos psi): the wind's own heading is atan2(x, -z)
            const toDeg = (Math.atan2(wind[0], -wind[2]) * 180) / Math.PI;
            toRelDeg = wrap180(toDeg - yawDeg);
            speed = h;
            side = windSide(toRelDeg + 180);
        }
    }
    // north is scene heading -compassDeg
    const northRelDeg = compassDeg === null ? null : wrap180(-compassDeg - yawDeg);
    return { toRelDeg, speed, side, northRelDeg };
}
