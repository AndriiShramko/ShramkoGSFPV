// Probe entry: exposes the viewer's MIT collision layer to the measurement harness,
// plus a minimal quadcopter flight model, so both can be driven from the page.
import { loadVoxelCollision, VoxelCollision } from '../src/collision';
import type { Collision, PushOut } from '../src/collision';

type Vec = { x: number; y: number; z: number };

const push: PushOut = { x: 0, y: 0, z: 0 };

/**
 * Honest clearance sampling: from a free point, march along a direction until the
 * collision says the sphere of `radius` no longer fits. That distance is what the
 * pilot experiences as "how close can I get to that surface", which is NOT the same
 * as the voxel size — the carve radius dominates it.
 */
const clearanceAlong = (
    c: Collision,
    from: Vec,
    dir: Vec,
    radius: number,
    maxDist: number,
    step: number
): number | null => {
    const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
    const dx = dir.x / len, dy = dir.y / len, dz = dir.z / len;

    // first find the surface with a ray
    const hit = c.queryRay(from.x, from.y, from.z, dx, dy, dz, maxDist);
    if (!hit) return null;
    const surfDist = Math.hypot(hit.x - from.x, hit.y - from.y, hit.z - from.z);

    // now walk back from the surface until a sphere of `radius` is accepted
    for (let d = 0; d < surfDist; d += step) {
        const t = surfDist - d;
        const px = from.x + dx * t, py = from.y + dy * t, pz = from.z + dz * t;
        if (!c.querySphere(px, py, pz, radius, push)) {
            return d; // gap between the surface and the closest legal sphere centre
        }
    }
    return surfDist;
};

/** Uniformly distributed directions (Fibonacci sphere) — no RNG, so runs are comparable. */
const directions = (n: number): Vec[] => {
    const out: Vec[] = [];
    const phi = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < n; i++) {
        const y = 1 - (i / (n - 1)) * 2;
        const r = Math.sqrt(Math.max(0, 1 - y * y));
        const th = phi * i;
        out.push({ x: Math.cos(th) * r, y, z: Math.sin(th) * r });
    }
    return out;
};

const api = {
    loadVoxelCollision,
    VoxelCollision,
    clearanceAlong,
    directions,
    /** Does the swept move from a→b ever pass through solid? Substepped, like the sim will be. */
    sweepHitsSolid(c: Collision, a: Vec, b: Vec, radius: number, substeps: number): number {
        let hits = 0;
        for (let i = 0; i <= substeps; i++) {
            const t = i / substeps;
            const x = a.x + (b.x - a.x) * t;
            const y = a.y + (b.y - a.y) * t;
            const z = a.z + (b.z - a.z) * t;
            if (c.querySphere(x, y, z, radius, push)) hits++;
        }
        return hits;
    }
};

(window as unknown as { __gsfpv: typeof api }).__gsfpv = api;

export default api;
