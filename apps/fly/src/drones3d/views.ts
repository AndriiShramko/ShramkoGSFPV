// The turntable's views, pure: the first view's distance that fits a model in its stage (fitDistance), and the view that looks
// at the side of the model a pin faces (a legend row asks for it).
import type { Anchor, Model } from './kit';
import { viewPosition } from './orbit';
import type { OrbitState } from './orbit';

/** The studio camera's vertical field of view, degrees. */
export const FOV_DEG = 28;
/** Room left round the model in the first view: it fills 1 / FIT_MARGIN of the stage's height or width at most. */
export const FIT_MARGIN = 1.1;

/** Where the studio camera looks, in the model's own unit (its radius = 1): a little under half its height up the middle. */
export function targetOf(m: Pick<Model, 'bounds' | 'radius'>): [number, number, number] {
    return [0, ((m.bounds.max[1] - m.bounds.min[1]) / m.radius) * 0.42, 0];
}

/**
 * How far the camera must stand (in model radii) at a yaw and pitch for the whole model to sit inside a stage of the given
 * width / height, with `margin` to spare. The view is the model's first one: a fixed distance clipped the tall X8 (battery on
 * top) and its wide props in a 16:10 stage, and a box round the model would have stood far too far away (a box has corners the
 * model does not). Every vertex of every part is put into the camera's frame and the distance is the one at which the farthest
 * of them reaches the edge. The turntable's other turns see a model whose reach is mostly round, so they sit inside as well,
 * within a few per cent.
 */
export function fitDistance(m: Pick<Model, 'parts' | 'bounds' | 'radius'>, aspect: number, yaw: number, pitch: number, margin: number = FIT_MARGIN): number {
    const unit = 1 / m.radius;
    const t = targetOf(m);
    const eye = viewPosition({ yaw, pitch, dist: 1 }, 1, t);
    // the camera's forward axis (towards the target), its right and up
    let f: [number, number, number] = [t[0] - eye[0], t[1] - eye[1], t[2] - eye[2]];
    const fl = Math.hypot(...f);
    f = [f[0] / fl, f[1] / fl, f[2] / fl];
    let r: [number, number, number] = [-f[2], 0, f[0]];
    const rl = Math.hypot(...r) || 1;
    r = [r[0] / rl, 0, r[2] / rl];
    const u: [number, number, number] = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
    const tanV = Math.tan((FOV_DEG * Math.PI) / 360), tanH = tanV * Math.max(0.2, aspect);
    const kr = margin / tanH, ku = margin / tanV;
    let d = 0;
    for (const part of m.parts) {
        const pos = part.mesh.positions;
        for (let i = 0; i < pos.length; i += 3) {
            const ox = pos[i] * unit - t[0], oy = pos[i + 1] * unit - t[1], oz = pos[i + 2] * unit - t[2];
            const ahead = ox * f[0] + oy * f[1] + oz * f[2];
            // the vertex is d + ahead in front of the camera and must satisfy |side| <= (d + ahead) * tan(half fov)
            const need = Math.max(Math.abs(ox * r[0] + oy * r[1] + oz * r[2]) * kr, Math.abs(ox * u[0] + oy * u[1] + oz * u[2]) * ku) - ahead;
            if (need > d) d = need;
        }
    }
    return d;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/**
 * The camera yaw that sees the pin's side (yaw 0 looks at the model's front, -Z, positive turns to its right, +X), a pitch a
 * little above the pin's own elevation, and a closer distance.
 */
export function viewFor(a: Anchor): Partial<OrbitState> {
    const n = a.normal ?? [0, 0, -1];
    return { yaw: (Math.atan2(n[0], -n[2]) * 180) / Math.PI, pitch: clamp((Math.asin(clamp(n[1], -1, 1)) * 180) / Math.PI + 18, 14, 60), dist: 1.75 };
}
