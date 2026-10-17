// The view of the turntable that looks at the side of the model a pin faces (a legend row asks for it). Pure.
import type { Anchor } from './kit';
import type { OrbitState } from './orbit';

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/**
 * The camera yaw that sees the pin's side (yaw 0 looks at the model's front, -Z, positive turns to its right, +X), a pitch a
 * little above the pin's own elevation, and a closer distance.
 */
export function viewFor(a: Anchor): Partial<OrbitState> {
    const n = a.normal ?? [0, 0, -1];
    return { yaw: (Math.atan2(n[0], -n[2]) * 180) / Math.PI, pitch: clamp((Math.asin(clamp(n[1], -1, 1)) * 180) / Math.PI + 18, 14, 60), dist: 1.75 };
}
