// Select a gate with the mouse (lane editor3, stage E2, docs/wip/editor3.md "The design"): the owner's words of message 51,
// "I clicked an obstacle and the X, Y, Z appeared on it". A ray from the camera through the cursor is tested against each
// gate's bounding sphere; the gate whose sphere the ray enters first is the one clicked. Pure: the ray comes from the page
// (the camera's screenToWorld), the gates in the flown frame (course/run.ts gates, as the stage draws them).
import type { ObjectShape } from '@shramko/sonic-fpv';

export type V3 = readonly [number, number, number];

export interface Ray {
    readonly o: V3;
    /** unit direction */
    readonly d: V3;
}

export interface Pickable {
    readonly pos: V3;
    readonly shape: ObjectShape;
}

/** a click this close to a gate's outline still takes it, flown m (an estimate: a thin ring is hard to hit exactly) */
export const PICK_PAD_M = 0.15;

/** The radius of the sphere around a gate shape of the flown frame (its frame drawn, plus PICK_PAD_M). */
export function pickRadius(shape: ObjectShape): number {
    switch (shape.kind) {
        case 'ring':
            return shape.diameter / 2 + shape.tube + PICK_PAD_M;
        case 'square':
            return shape.side * Math.SQRT1_2 + shape.bar + PICK_PAD_M;
        case 'cube-frame':
            return (shape.side * Math.sqrt(3)) / 2 + shape.bar + PICK_PAD_M;
        case 'pillar':
            return Math.hypot(shape.radius, shape.height / 2) + PICK_PAD_M;
        case 'box':
        case 'zone':
            return Math.hypot(shape.size[0], shape.size[1], shape.size[2]) / 2 + PICK_PAD_M;
        default:
            return 1 + PICK_PAD_M;
    }
}

/** How far along the ray it enters the sphere at `c` of radius `r` (0 when it starts inside), or null when it misses. */
export function raySphere(ray: Ray, c: V3, r: number): number | null {
    const ox = ray.o[0] - c[0];
    const oy = ray.o[1] - c[1];
    const oz = ray.o[2] - c[2];
    const b = ox * ray.d[0] + oy * ray.d[1] + oz * ray.d[2];
    const cc = ox * ox + oy * oy + oz * oz - r * r;
    if (cc <= 0) return 0;
    if (b > 0) return null; // outside and pointing away
    const disc = b * b - cc;
    if (disc < 0) return null;
    return -b - Math.sqrt(disc);
}

/**
 * The index of the gate the ray takes, or -1. The gate whose sphere the ray enters first wins. A sphere the camera stands in
 * (it flies close to a gate) is taken only when the ray enters no other one, and among those the gate whose centre is
 * nearest to the ray: so the gate under the cursor wins over the one around the camera.
 */
export function pickGate(ray: Ray, gates: readonly Pickable[]): number {
    let ahead = -1;
    let aheadT = Infinity;
    let around = -1;
    let aroundMiss = Infinity;
    for (let i = 0; i < gates.length; i++) {
        const g = gates[i]!;
        const t = raySphere(ray, g.pos, pickRadius(g.shape));
        if (t === null) continue;
        if (t > 0) {
            if (t < aheadT) {
                ahead = i;
                aheadT = t;
            }
            continue;
        }
        // how far the gate's centre lies from the ray
        const v: V3 = [g.pos[0] - ray.o[0], g.pos[1] - ray.o[1], g.pos[2] - ray.o[2]];
        const along = v[0] * ray.d[0] + v[1] * ray.d[1] + v[2] * ray.d[2];
        const miss = Math.sqrt(Math.max(0, v[0] * v[0] + v[1] * v[1] + v[2] * v[2] - along * along));
        if (miss < aroundMiss) {
            around = i;
            aroundMiss = miss;
        }
    }
    return ahead >= 0 ? ahead : around;
}

/** The ray from `eye` towards the point `far` (the camera's screenToWorld of the cursor at the far plane). */
export function rayThrough(eye: V3, far: V3): Ray | null {
    const d: V3 = [far[0] - eye[0], far[1] - eye[1], far[2] - eye[2]];
    const n = Math.hypot(d[0], d[1], d[2]);
    if (!(n > 1e-9)) return null;
    return { o: eye, d: [d[0] / n, d[1] / n, d[2] / n] };
}
