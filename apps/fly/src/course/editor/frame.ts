// Lane editor3 I1 (decision D1 of train 3): "frame selected", as in ordinary 3D editors. When the pilot asks (F, Numpad .,
// a double click on a gate; train 4 edit4a: no longer on every new selection) the edit view glides to a place from which the gate fills about a third of the view's height and is seen
// at an angle: about 35 degrees to the side of its axis and about 20 degrees above its centre, so the opening and all three
// turn rings are seen as ellipses. A place inside or behind a wall (a ray from the gate's centre to the eye hits) is skipped:
// the mirrored side, then 60 degrees each way, then nearer steps down to 1.5 gate sizes. Pure: the walls come in as a ray.

import type { FlyCam } from './fly-cam';

export type V3 = readonly [number, number, number];

/** The distance to the first wall from `o` along the unit direction `d` within `max`, or null when the way is clear. */
export type RayFn = (o: V3, d: V3, max: number) => number | null;

/** the share of the view's height the gate's largest size takes (D1: about a third) */
export const FRAME_SHARE = 1 / 3;
/** the eye's angle to the side of the gate's axis, degrees (D1) */
export const FRAME_SIDE_DEG = 35;
/** the eye's angle above the gate's centre, degrees (D1) */
export const FRAME_UP_DEG = 20;
/** the side angles tried in order: the side nearer the view, the mirrored side, then 60 degrees each way (D1) */
export const FRAME_SIDES: readonly number[] = [FRAME_SIDE_DEG, -FRAME_SIDE_DEG, 60, -60];
/** the nearest step, in gate sizes (D1) */
export const FRAME_MIN_SIZES = 1.5;
/** each nearer step is this share of the one before (an estimate: three or four steps between the two ends) */
export const FRAME_STEP = 0.75;
/** the eye keeps this far from a wall the ray hit, flown m (an estimate, above the near plane) */
export const FRAME_WALL_GAP_M = 0.3;
/** the glide to the framing, ms (D1: about 0.4 s) */
export const FRAME_GLIDE_MS = 400;
/** an axis steeper than this (its up share) is a dive gate lying flat: the eye looks down on it from 90 - 35 degrees */
export const FRAME_FLAT_UP = 0.7;
// lane edit4a A1 (E1, brief 547): train 3 J1 framed the gate again after a drag that took it out of the middle of the view
// (reframeOnDragEnd). The owner: "why move my view when I move an obstacle? No 3D editor does that." It is gone.

export interface FrameIn {
    /** the gate's centre, flown frame */
    readonly centre: V3;
    /** the gate's axis (through its opening), unit, flown frame; the side is chosen by `from` */
    readonly axis: V3;
    /** the gate's largest size, flown m */
    readonly size: number;
    /** tan of half the view's vertical field */
    readonly tanHalfV: number;
    /** the eye now (the side of the gate it stands on is tried first) */
    readonly from: V3;
}

export interface Framing {
    readonly eye: V3;
    readonly at: V3;
    /** the side angle and the distance used (for the status and the probes) */
    readonly sideDeg: number;
    readonly dist: number;
    /** how many places were tried before this one was free (0: the first) */
    readonly skipped: number;
}

const RAD = Math.PI / 180;

/** The distance at which `size` takes `share` of the view's height (vertical field `tanHalfV`). */
export function frameDistance(size: number, tanHalfV: number, share = FRAME_SHARE): number {
    return size / (2 * share * Math.max(1e-3, tanHalfV));
}

/** The distances tried: the framing one, nearer steps, and the nearest (FRAME_MIN_SIZES gate sizes); never below it. */
export function frameDistances(d: number, size: number): number[] {
    const min = FRAME_MIN_SIZES * size;
    const out: number[] = [Math.max(d, min)];
    let s = out[0]! * FRAME_STEP;
    while (s > min) {
        out.push(s);
        s *= FRAME_STEP;
    }
    if (out[out.length - 1]! > min) out.push(min);
    return out;
}

/** The unit direction from the gate's centre to the eye for a side angle (degrees), on the side `from` stands. */
export function frameDir(axis: V3, centre: V3, from: V3, sideDeg: number): V3 {
    const toFrom: V3 = [from[0] - centre[0], from[1] - centre[1], from[2] - centre[2]];
    const flat = Math.abs(axis[1]) > FRAME_FLAT_UP;
    // the base on the floor: the axis's own way (a standing gate) or the way to the view (a gate lying flat)
    let bx = flat ? toFrom[0] : axis[0];
    let bz = flat ? toFrom[2] : axis[2];
    let bl = Math.hypot(bx, bz);
    if (bl < 1e-9) {
        bx = 0;
        bz = 1;
        bl = 1;
    }
    bx /= bl;
    bz /= bl;
    // the side the view stands on first
    if (!flat && bx * toFrom[0] + bz * toFrom[2] < 0) {
        bx = -bx;
        bz = -bz;
    }
    const a = sideDeg * RAD;
    const c = Math.cos(a);
    const s = Math.sin(a);
    // turned about the up axis by the side angle
    const hx = c * bx - s * bz;
    const hz = s * bx + c * bz;
    // a standing gate: 20 degrees above its centre; a gate lying flat: 35 degrees off its (vertical) axis
    const up = (flat ? 90 - FRAME_SIDE_DEG : FRAME_UP_DEG) * RAD;
    // a gate lying flat seen from below stays seen from below (the view's side of it)
    const sign = flat && toFrom[1] < 0 ? -1 : 1;
    return [hx * Math.cos(up), sign * Math.sin(up), hz * Math.cos(up)];
}

/**
 * The framing of a gate: the first free place in the order side angles (FRAME_SIDES) at the framing distance, then the same
 * angles at each nearer step. A place is free when a ray from the gate's edge (half its size out from the centre) towards it
 * meets no wall before the eye (plus FRAME_WALL_GAP_M). `ray` null: no walls known, the first place. Null when no place is free (the view stays).
 */
export function frameGate(g: FrameIn, ray: RayFn | null): Framing | null {
    const d = frameDistance(g.size, g.tanHalfV);
    // the gate's half size: the rays start there (every distance tried is at least FRAME_MIN_SIZES sizes, beyond it)
    const edge = g.size / 2;
    let skipped = 0;
    for (const dist of frameDistances(d, g.size)) {
        for (const side of FRAME_SIDES) {
            const u = frameDir(g.axis, g.centre, g.from, side);
            // review EI-2: the ray starts at the gate's edge, not its centre: a centre in foliage or a wall voxel made every
            // ray hit at 0 (voxel-collision queryRay) and the gates a pilot has to fix were never framed
            const o: V3 = [g.centre[0] + u[0] * edge, g.centre[1] + u[1] * edge, g.centre[2] + u[2] * edge];
            if (!ray || ray(o, u, dist - edge + FRAME_WALL_GAP_M) === null) {
                const eye: V3 = [g.centre[0] + u[0] * dist, g.centre[1] + u[1] * dist, g.centre[2] + u[2] * dist];
                return { eye, at: g.centre, sideDeg: side, dist, skipped };
            }
            skipped++;
        }
    }
    return null;
}

/** Lane edit4a A1: the overview looks down on the course at this angle, degrees (edit4 design A1) */
export const OVERVIEW_DOWN_DEG = 35;
/** the overview's sphere fills at most this share of the view's smaller field (an estimate: a margin round the gates) */
export const OVERVIEW_FILL = 0.85;

/** The sphere round the gates' centres (half the box's diagonal plus `pad`, flown m); null without gates. */
export function boundsOf(points: readonly V3[], pad = 0): { centre: V3; radius: number } | null {
    if (points.length === 0) return null;
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (const p of points) for (let i = 0; i < 3; i++) {
        lo[i] = Math.min(lo[i]!, p[i]!);
        hi[i] = Math.max(hi[i]!, p[i]!);
    }
    const centre: V3 = [(lo[0]! + hi[0]!) / 2, (lo[1]! + hi[1]!) / 2, (lo[2]! + hi[2]!) / 2];
    return { centre, radius: Math.hypot(hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!) / 2 + pad };
}

/**
 * Lane edit4a A1 (Home, 'frame all'): the view above the sphere (`centre`, `radius`), looking down OVERVIEW_DOWN_DEG along the
 * pilot's own heading, far enough for the sphere to fit the smaller half field `tanHalf`. No wall test: an overview stands
 * above the course. The speed stays.
 */
export function frameBox(c: FlyCam, centre: V3, radius: number, tanHalf: number): FlyCam {
    const half = Math.atan(Math.max(1e-3, tanHalf) * OVERVIEW_FILL);
    const dist = Math.max(1, radius) / Math.sin(half);
    const p = (-OVERVIEW_DOWN_DEG * Math.PI) / 180;
    const f: V3 = [Math.sin(c.yaw) * Math.cos(p), Math.sin(p), -Math.cos(c.yaw) * Math.cos(p)];
    return { pos: [centre[0] - f[0] * dist, centre[1] - f[1] * dist, centre[2] - f[2] * dist], yaw: c.yaw, pitch: p, speed: c.speed };
}

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** The glide between two views at `t` (0..1, eased): the place in a line, the heading the short way round. */
export function blendCam(a: FlyCam, b: FlyCam, t: number): FlyCam {
    const k = t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
    const p: V3 = [a.pos[0] + (b.pos[0] - a.pos[0]) * k, a.pos[1] + (b.pos[1] - a.pos[1]) * k, a.pos[2] + (b.pos[2] - a.pos[2]) * k];
    return { pos: p, yaw: a.yaw + wrap(b.yaw - a.yaw) * k, pitch: a.pitch + (b.pitch - a.pitch) * k, speed: b.speed };
}
