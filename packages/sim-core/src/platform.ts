// Invisible one-way respawn platform (docs/architecture-v03.md C.2).
//
// A horizontal disc added to the scene's ContactWorld, so sitting on it, friction, bounces and a
// hard landing use the same contact code as a real floor. It stops a sphere coming from above
// only: a craft respawned under an overhang, or climbing through the disc from below, is never
// trapped. The disc lives in the hashed sim state (S.plat*); this class only answers queries.

import type { ContactOut, ContactWorld } from './sim';

/** A sphere whose bottom is at most this far below the top still counts as "above": float
 *  rounding must not let a craft resting on the disc fall through it (m). */
const ABOVE_TOL = 1e-4;

export class PlatformContact implements ContactWorld {
    inner: ContactWorld | null = null;
    x = 0;
    /** top of the disc */
    y = 0;
    z = 0;
    r = 0;
    /** true: stops spheres from above only (the design); false exists for the test control */
    oneWay: boolean;
    /** the earliest hit of the last sweep was the disc (the sim keeps no skin gap above a plane) */
    hitDisc = false;

    constructor(o: { oneWay?: boolean } = {}) {
        this.oneWay = o.oneWay ?? true;
    }

    set(inner: ContactWorld | null, x: number, y: number, z: number, r: number): this {
        this.inner = inner;
        this.x = x; this.y = y; this.z = z; this.r = r;
        return this;
    }

    sweep(c0: Float64Array, c1: Float64Array, rr: Float64Array, pad: Float64Array, n: number, out: ContactOut): number {
        this.hitDisc = false;
        const tIn = this.inner ? this.inner.sweep(c0, c1, rr, pad, n, out) : -1;
        let best = -1;
        let bestK = -1;
        let bestNy = 1;
        const r2 = this.r * this.r;
        for (let i = 0; i < n; i++) {
            const R = rr[i] + pad[i];
            const y0 = c0[i * 3 + 1], y1 = c1[i * 3 + 1];
            // from above: the bottom of the sphere crosses the top downwards
            let t = -1;
            let ny = 1;
            const b0 = y0 - R - this.y, b1 = y1 - R - this.y;
            if (b0 >= -ABOVE_TOL && b1 < 0 && b1 < b0) t = b0 > 0 ? b0 / (b0 - b1) : 0;
            if (t < 0 && !this.oneWay) {
                // two-way control variant: the underside stops a sphere coming from below as well
                const u0 = this.y - (y0 + R), u1 = this.y - (y1 + R);
                if (u0 >= -ABOVE_TOL && u1 < 0 && u1 < u0) { t = u0 > 0 ? u0 / (u0 - u1) : 0; ny = -1; }
            }
            if (t < 0 || (best >= 0 && t >= best)) continue;
            const cx = c0[i * 3] + (c1[i * 3] - c0[i * 3]) * t - this.x;
            const cz = c0[i * 3 + 2] + (c1[i * 3 + 2] - c0[i * 3 + 2]) * t - this.z;
            if (cx * cx + cz * cz > r2) continue;
            best = t; bestK = i; bestNy = ny;
        }
        if (best < 0 || (tIn >= 0 && tIn <= best)) return tIn;
        // a hit exactly at the start would read as "started overlapping"; the sphere is on the
        // top, not in it, so report the earliest representable fraction instead
        this.hitDisc = true;
        out.sphere = bestK; out.nx = 0; out.ny = bestNy; out.nz = 0;
        return best > 0 ? best : Number.MIN_VALUE;
    }

    pushOut(x: number, y: number, z: number, r: number, out: { x: number; y: number; z: number }): boolean {
        if (this.inner && this.inner.pushOut(x, y, z, r, out)) return true;
        // only a sphere whose centre is above the top is lifted onto it (one-way)
        const dx = x - this.x, dz = z - this.z;
        if (y < this.y || dx * dx + dz * dz > this.r * this.r) return false;
        const pen = this.y - (y - r);
        if (pen <= 0) return false;
        out.x = 0; out.y = pen; out.z = 0;
        return true;
    }
}
