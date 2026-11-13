// A scan as Fly by Sound reads it (v0.12, docs/wip/v12-plan.md 2.4, 2.7, 4.2 step 3; spec section 4 and 13.6): the
// contract's SonicWorld over the flight's own walls and a track's gates.
//
//   rays     against the flown walls (session.collision: the scan's voxels under the scene transform, the floater
//            filter and the ceiling as the flight has them), by the vendored DDA (VoxelCollision.queryRay). Scan
//            voxels carry no material: a hit is floor, ceiling or wall by its surface normal (|ny| > 0.7). The plan
//            named the vendored querySurfaceNormal for it; at 1350 voxel lookups a hit it made 30 rays cost 3.4 ms
//            a frame (p95, Winter Garden x5), so the normal is the hit voxel's 26 neighbours' (@gsfpv/collision
//            voxelNormal), else the face the ray entered (faceNormal); their agreement with querySurfaceNormal is
//            measured by tools/bench/src/sonic-rays.ts. Rays also meet the track's gates (their solid shapes),
//            'obstacle' with the gate's id, as in a lesson world, so a ring's edge sounds like the obstacle it is.
//   objects  the track's gates in the flown world through the scene transform NOW (session.transform), so a
//            rescale moves them with the walls; sizes times s (sonic-fpv trackToObjects).
// The walls and the transform are asked each time (functions), so a rescale, new walls or a scene switch need
// nothing here. One ray costs a DDA walk of distance / (s * voxel) cells: at Winter Garden x5 the cells are 16 cm,
// measured by tools/bench/src/sonic-rays.ts (30 rays per frame).
//   checkpoints  (train 1, lane tracks) a generated course's path for the sound beacon: coursePath of @gsfpv/tracks
//            through the scene transform NOW (points at most 6 m apart, one 1.5 m before each gate), so the package's
//            worldCheckpoints / lessonTrack take it duck-typed (kind 'world'). Without a course there is no getter value
//            (undefined) and a lesson's track stays its own gates.
import { objectPart, shapeBoundRadius, trackToObjects } from '@shramko/sonic-fpv';
import type { MaterialClass, Part, RayHit, SceneTransform, SonicObject, SonicWorld, TrackFile, Vec3, WorldCheckpoint } from '@shramko/sonic-fpv';
import { coursePath } from '@gsfpv/tracks';
import { faceNormal, voxelNormal } from '@gsfpv/collision';
import type { VoxelCollision } from '@gsfpv/collision';

/** A surface whose normal points this far up (or down) is floor (or ceiling); steeper is wall (sonic-fpv's rule). */
export const FLOOR_NY = 0.7;

/** Where the scan world reads the flight: the walls flown now and the scene transform now. */
export interface ScanWorldSource {
    /** the flown walls (session.collision), null when the scan has none */
    collision(): VoxelCollision | null;
    /** T(p) = s * p + t now (session.transform) */
    transform(): { readonly s: number; readonly t: readonly number[] };
}

/** floor, ceiling or wall by the direction of the surface. */
export function classifyNormal(n: Vec3 | null): MaterialClass {
    if (n === null) return 'wall';
    if (n[1] > FLOOR_NY) return 'floor';
    if (n[1] < -FLOOR_NY) return 'ceiling';
    return 'wall';
}

/** Sphere tracing of one gate's solid shape: the steps, the hit tolerance. */
const GATE_STEPS = 96;
const GATE_HIT_M = 1e-3;

interface GatePart {
    readonly obj: SonicObject;
    readonly part: Part;
    readonly r: number;
}

export class ScanSonicWorld implements SonicWorld {
    readonly kind = 'scan' as const;
    readonly id: string;
    readonly version: number;
    private readonly src: ScanWorldSource;
    private readonly track: TrackFile | null;
    private gatesFor: { s: number; t0: number; t1: number; t2: number; objects: readonly SonicObject[]; parts: readonly GatePart[] } | null = null;

    private course: TrackFile | null;
    private pathFor: { s: number; t0: number; t1: number; t2: number; points: readonly WorldCheckpoint[] } | null = null;

    constructor(id: string, version: number, src: ScanWorldSource, track: TrackFile | null = null, opts: { course?: TrackFile | null } = {}) {
        this.id = id;
        this.version = version;
        this.src = src;
        this.track = track;
        this.course = opts.course ?? null;
    }

    /** The course the beacon follows (a generated or served course), or null for none. */
    setCourse(course: TrackFile | null): void {
        this.course = course;
        this.pathFor = null;
    }

    /** The course's path in the flown world now, for the sound package's worldCheckpoints; undefined without a course. */
    get checkpoints(): readonly WorldCheckpoint[] | undefined {
        if (!this.course) return undefined;
        const tr = this.src.transform();
        const p = this.pathFor;
        if (p && p.s === tr.s && p.t0 === tr.t[0] && p.t1 === tr.t[1] && p.t2 === tr.t[2]) return p.points;
        const points = coursePath(this.course, [tr.s, tr.t[0], tr.t[1], tr.t[2]]);
        this.pathFor = { s: tr.s, t0: tr.t[0], t1: tr.t[1], t2: tr.t[2], points };
        return points;
    }

    /** The flown walls' grid as a world box (a legacy grid stores x and y negated), with the gates. */
    get bounds(): { readonly min: Vec3; readonly max: Vec3 } {
        const c = this.src.collision();
        let min: [number, number, number] = [Infinity, Infinity, Infinity];
        let max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
        if (c) {
            const r = c.voxelResolution;
            const lo = [c.gridMinX, c.gridMinY, c.gridMinZ];
            const hi = [c.gridMinX + c.numVoxelsX * r, c.gridMinY + c.numVoxelsY * r, c.gridMinZ + c.numVoxelsZ * r];
            min = c.flipXY ? [-hi[0], -hi[1], lo[2]] : [lo[0], lo[1], lo[2]];
            max = c.flipXY ? [-lo[0], -lo[1], hi[2]] : [hi[0], hi[1], hi[2]];
        }
        for (const g of this.gates().parts) {
            for (let a = 0; a < 3; a++) {
                min[a] = Math.min(min[a], g.obj.pos[a] - g.r);
                max[a] = Math.max(max[a], g.obj.pos[a] + g.r);
            }
        }
        if (!Number.isFinite(min[0])) return { min: [0, 0, 0], max: [0, 0, 0] };
        return { min, max };
    }

    /** The track's gates in the flown world now, in course order. */
    objects(): readonly SonicObject[] {
        return this.gates().objects;
    }

    private gates(): { objects: readonly SonicObject[]; parts: readonly GatePart[] } {
        const tr = this.src.transform();
        const g = this.gatesFor;
        if (g && g.s === tr.s && g.t0 === tr.t[0] && g.t1 === tr.t[1] && g.t2 === tr.t[2]) return g;
        const transform: SceneTransform = [tr.s, tr.t[0], tr.t[1], tr.t[2]];
        const objects = this.track ? trackToObjects(this.track, { transform }) : [];
        const parts: GatePart[] = [];
        for (const obj of objects) {
            const part = objectPart(obj);
            if (part) parts.push({ obj, part, r: shapeBoundRadius(obj.shape) });
        }
        this.gatesFor = { s: tr.s, t0: tr.t[0], t1: tr.t[1], t2: tr.t[2], objects, parts };
        return this.gatesFor;
    }

    castRay(origin: Vec3, dir: Vec3, maxDist: number): RayHit | null {
        let dx = dir[0], dy = dir[1], dz = dir[2];
        const len = Math.hypot(dx, dy, dz);
        if (!(len > 0) || !(maxDist > 0)) return null;
        dx /= len; dy /= len; dz /= len;
        const ox = origin[0], oy = origin[1], oz = origin[2];
        let best: RayHit | null = null;
        const col = this.src.collision();
        if (col) {
            const h = col.queryRay(ox, oy, oz, dx, dy, dz, maxDist);
            if (h) {
                const distance = Math.hypot(h.x - ox, h.y - oy, h.z - oz);
                if (distance <= maxDist) {
                    const normal: Vec3 | null = voxelNormal(col, h.x, h.y, h.z, dx, dy, dz) ?? faceNormal(col, h.x, h.y, h.z, dx, dy, dz);
                    best = { distance, point: [h.x, h.y, h.z], normal, material: classifyNormal(normal), objectId: null };
                }
            }
        }
        const far = best ? best.distance : maxDist;
        for (const g of this.gates().parts) {
            const hit = traceGate(g, ox, oy, oz, dx, dy, dz, far);
            if (hit && (!best || hit.distance < best.distance)) best = hit;
        }
        return best;
    }
}

/** First hit of a ray on one gate's solid shape within maxDist: its bounding sphere first, then sphere tracing inside it. */
function traceGate(g: GatePart, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number): RayHit | null {
    const c = g.obj.pos;
    // ray against the bounding sphere: t^2 + 2 b t + cc = 0
    const lx = ox - c[0], ly = oy - c[1], lz = oz - c[2];
    const b = lx * dx + ly * dy + lz * dz;
    const cc = lx * lx + ly * ly + lz * lz - g.r * g.r;
    const disc = b * b - cc;
    if (disc < 0) return null;
    const sq = Math.sqrt(disc);
    let t = Math.max(0, -b - sq);
    const t1 = Math.min(maxDist, -b + sq);
    if (t > t1) return null;
    for (let i = 0; i < GATE_STEPS && t <= t1; i++) {
        const x = ox + dx * t, y = oy + dy * t, z = oz + dz * t;
        const d = g.part.sdf(x, y, z);
        if (d <= GATE_HIT_M) {
            const h = 5e-4;
            const gx = g.part.sdf(x + h, y, z) - g.part.sdf(x - h, y, z);
            const gy = g.part.sdf(x, y + h, z) - g.part.sdf(x, y - h, z);
            const gz = g.part.sdf(x, y, z + h) - g.part.sdf(x, y, z - h);
            const gl = Math.hypot(gx, gy, gz);
            return { distance: t, point: [x, y, z], normal: gl > 1e-9 ? [gx / gl, gy / gl, gz / gl] : null, material: 'obstacle', objectId: g.obj.id };
        }
        t += d;
    }
    return null;
}
