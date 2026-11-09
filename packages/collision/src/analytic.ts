// Analytic walls for the built-in worlds (v0.12 Fly by Sound, docs/wip/v12-plan.md 2.4, 2.5 and 4.2 step 1):
// a lesson world is a signed distance function, and the flight model collides with it seen as voxels.
// The vendored voxel collision runs unchanged; only its occupancy lookup asks a function (the pattern of
// synthetic.ts). A voxel is solid when its CENTRE is solid: solid(gridMin + (i + 0.5) * voxelM).
//
// The lookup sits inside every sweep of the 1 kHz flight model, so with a signed distance function it is
// culled by a coarse grid: a cell of CELL^3 voxels whose centre lies further from every surface than the
// cell's half diagonal is all empty (or, as deep inside, all solid). That is exact for a 1-Lipschitz
// distance (|sdf(p) - sdf(q)| <= |p - q|; true for unions, intersections and exact primitive distances),
// with a small margin for rounding. The other cells (those a surface may cross) get the answers of all
// their voxels once, as a bit mask. The answer of every voxel is the answer of solid() at its centre either
// way (tools/bench/test/sonic-world.test.ts compares them voxel by voxel), so a flight log replays the same
// on a cached and an uncached collider. Nothing here knows lessons: the caller gives the functions.

import { VoxelCollision } from './vendor/voxel-collision';
import type { VoxelMetadata } from './vendor/voxel-collision';
import { LEAF, VoxelContactWorld } from './world';
import type { ContactOut } from './world';

/** Solid at a point of the world (metres). */
export type PointSolidFn = (x: number, y: number, z: number) => boolean;
/** Signed distance to the nearest solid surface, metres, negative inside; must be 1-Lipschitz. */
export type DistanceFn = (x: number, y: number, z: number) => number;

/** Voxels per side of a culling cell. */
export const ANALYTIC_CELL = 8;
/** Cells of a grid larger than this are not cached (the lookup asks solid() for every voxel). */
export const ANALYTIC_MAX_CELLS = 1 << 25;
/** Up to this many cells also keep the distance at their centres (4 bytes each), for the contact world's shortcut. */
export const ANALYTIC_MAX_DISTANCE_CELLS = 1 << 22;
/** Classification margin, metres: a cell this close to a surface beyond its half diagonal still counts as crossed. */
const MARGIN_M = 1e-6;

const UNKNOWN = 0;
const EMPTY = 1;
const SOLID = 2;
const MIXED = 3;

/** How the lookup answered so far (benches and tests). */
export interface AnalyticStats {
    /** cells decided by the distance alone */
    cellsUniform: number;
    /** cells whose voxels were asked one by one */
    cellsMixed: number;
    /** calls of solid() */
    solidCalls: number;
    /** calls of the distance function at a query's own point (AnalyticContactWorld's body test) */
    distanceCalls: number;
}

export class AnalyticVoxelCollision extends VoxelCollision {
    readonly solidFn: PointSolidFn;
    readonly distanceFn: DistanceFn | null;
    readonly stats: AnalyticStats = { cellsUniform: 0, cellsMixed: 0, solidCalls: 0, distanceCalls: 0 };
    private readonly ncx: number;
    private readonly ncy: number;
    private readonly cells: Uint8Array | null;
    /** the distance at each classified cell's centre (Float32), or null for a grid too large to keep it */
    private readonly cellD: Float32Array | null;
    private readonly masks = new Map<number, Uint32Array>();
    private readonly halfDiag: number;
    /** half a voxel's diagonal plus the rounding of a Float32 distance, metres */
    private readonly voxelReach: number;
    /** the last point freeWithin asked the distance function at, and its distance (NaN: none yet, every bound fails) */
    private lastX = Number.NaN;
    private lastY = Number.NaN;
    private lastZ = Number.NaN;
    private lastD = Number.NaN;

    constructor(meta: VoxelMetadata, solid: PointSolidFn, sdf: DistanceFn | null) {
        // one node so the upstream queries do not take the walls for missing (nodes.length === 0)
        super(meta, new Uint32Array([0]), new Uint32Array(0));
        this.solidFn = solid;
        this.distanceFn = sdf;
        this.ncx = Math.ceil(this.numVoxelsX / ANALYTIC_CELL);
        this.ncy = Math.ceil(this.numVoxelsY / ANALYTIC_CELL);
        const ncz = Math.ceil(this.numVoxelsZ / ANALYTIC_CELL);
        const n = this.ncx * this.ncy * ncz;
        this.cells = sdf && n <= ANALYTIC_MAX_CELLS ? new Uint8Array(n) : null;
        this.cellD = this.cells && n <= ANALYTIC_MAX_DISTANCE_CELLS ? new Float32Array(n) : null;
        this.halfDiag = (Math.sqrt(3) / 2) * ANALYTIC_CELL * this.voxelResolution;
        this.voxelReach = (Math.sqrt(3) / 2) * this.voxelResolution + 1e-3;
    }

    /**
     * A radius around (x, y, z) (world metres) inside which no solid voxel lies, from the distance kept at
     * the centre of the point's cell (1-Lipschitz: the distance at the point is at least that minus the way
     * to the centre, and a solid voxel's points are at most half a voxel diagonal from the surface); 0 or
     * less when nothing is known (a point off the grid, a grid too large to keep distances).
     */
    freeRadiusAt(x: number, y: number, z: number): number {
        const d = this.cellD;
        if (!d) return -1;
        const res = this.voxelResolution;
        const ix = Math.floor((x - this.gridMinX) / res), iy = Math.floor((y - this.gridMinY) / res), iz = Math.floor((z - this.gridMinZ) / res);
        if (ix < 0 || iy < 0 || iz < 0 || ix >= this.numVoxelsX || iy >= this.numVoxelsY || iz >= this.numVoxelsZ) return -1;
        const cx = (ix / ANALYTIC_CELL) | 0, cy = (iy / ANALYTIC_CELL) | 0, cz = (iz / ANALYTIC_CELL) | 0;
        const c = (cz * this.ncy + cy) * this.ncx + cx;
        if (this.cells![c] === UNKNOWN) this.classify(c, cx, cy, cz);
        const half = (ANALYTIC_CELL * res) / 2;
        const dx = x - (this.gridMinX + cx * ANALYTIC_CELL * res + half);
        const dy = y - (this.gridMinY + cy * ANALYTIC_CELL * res + half);
        const dz = z - (this.gridMinZ + cz * ANALYTIC_CELL * res + half);
        return d[c] - Math.sqrt(dx * dx + dy * dy + dz * dz) - this.voxelReach;
    }

    /**
     * Whether no solid voxel lies within `need` of (x, y, z): freeRadiusAt first (a few reads); when that cannot tell,
     * the distance at the point itself (one call of the distance function), which is tighter by up to the way to the
     * cell's centre, so in a way narrower than two cells (tunnel-long's 0.7 m at 0.05 m voxels: 0.4 m cells) it often
     * tells. The call is made only when it can succeed: the distance at the point is at most the centre's plus that way
     * (1-Lipschitz), so near a wall the cells' "no" stands without it. False when nothing is known.
     */
    freeWithin(x: number, y: number, z: number, need: number): boolean {
        const d = this.cellD;
        if (!d) return false;
        const res = this.voxelResolution;
        const ix = Math.floor((x - this.gridMinX) / res), iy = Math.floor((y - this.gridMinY) / res), iz = Math.floor((z - this.gridMinZ) / res);
        if (ix < 0 || iy < 0 || iz < 0 || ix >= this.numVoxelsX || iy >= this.numVoxelsY || iz >= this.numVoxelsZ) return false;
        const cx = (ix / ANALYTIC_CELL) | 0, cy = (iy / ANALYTIC_CELL) | 0, cz = (iz / ANALYTIC_CELL) | 0;
        const c = (cz * this.ncy + cy) * this.ncx + cx;
        if (this.cells![c] === UNKNOWN) this.classify(c, cx, cy, cz);
        const half = (ANALYTIC_CELL * res) / 2;
        const dx = x - (this.gridMinX + cx * ANALYTIC_CELL * res + half);
        const dy = y - (this.gridMinY + cy * ANALYTIC_CELL * res + half);
        const dz = z - (this.gridMinZ + cz * ANALYTIC_CELL * res + half);
        const way = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (need < d[c] - way - this.voxelReach) return true;
        if (need >= d[c] + way - this.voxelReach) return false;
        // the last distance asked bounds this one as well (the craft's queries come a few millimetres apart): free, or no use
        const lx = x - this.lastX, ly = y - this.lastY, lz = z - this.lastZ;
        const moved = Math.sqrt(lx * lx + ly * ly + lz * lz);
        if (need < this.lastD - moved - this.voxelReach) return true;
        if (need >= this.lastD + moved - this.voxelReach) return false;
        this.stats.distanceCalls++;
        const at = this.distanceFn!(x, y, z);
        this.lastX = x;
        this.lastY = y;
        this.lastZ = z;
        this.lastD = at;
        return need < at - this.voxelReach;
    }

    /** solid() at the centre of voxel (ix, iy, iz), asked directly (no cache). */
    voxelCentreSolid(ix: number, iy: number, iz: number): boolean {
        const r = this.voxelResolution;
        this.stats.solidCalls++;
        return this.solidFn(this.gridMinX + (ix + 0.5) * r, this.gridMinY + (iy + 0.5) * r, this.gridMinZ + (iz + 0.5) * r);
    }

    override isVoxelSolid(ix: number, iy: number, iz: number): boolean {
        if (ix < 0 || iy < 0 || iz < 0 || ix >= this.numVoxelsX || iy >= this.numVoxelsY || iz >= this.numVoxelsZ) return false;
        const cells = this.cells;
        if (!cells) return this.voxelCentreSolid(ix, iy, iz);
        const cx = (ix / ANALYTIC_CELL) | 0, cy = (iy / ANALYTIC_CELL) | 0, cz = (iz / ANALYTIC_CELL) | 0;
        const c = (cz * this.ncy + cy) * this.ncx + cx;
        let state = cells[c];
        if (state === UNKNOWN) state = this.classify(c, cx, cy, cz);
        if (state === EMPTY) return false;
        if (state === SOLID) return true;
        let mask = this.masks.get(c);
        if (!mask) mask = this.fill(c, cx, cy, cz);
        const bit = ((iz - cz * ANALYTIC_CELL) * ANALYTIC_CELL + (iy - cy * ANALYTIC_CELL)) * ANALYTIC_CELL + (ix - cx * ANALYTIC_CELL);
        return ((mask[bit >>> 5] >>> (bit & 31)) & 1) === 1;
    }

    private classify(c: number, cx: number, cy: number, cz: number): number {
        const r = this.voxelResolution;
        const half = (ANALYTIC_CELL * r) / 2;
        const d = this.distanceFn!(this.gridMinX + cx * ANALYTIC_CELL * r + half, this.gridMinY + cy * ANALYTIC_CELL * r + half, this.gridMinZ + cz * ANALYTIC_CELL * r + half);
        let state = MIXED;
        if (d > this.halfDiag + MARGIN_M) state = EMPTY;
        else if (d < -(this.halfDiag + MARGIN_M)) state = SOLID;
        if (state === MIXED) this.stats.cellsMixed++;
        else this.stats.cellsUniform++;
        this.cells![c] = state;
        if (this.cellD) this.cellD[c] = d;
        return state;
    }

    /** Every voxel of a crossed cell asked once; voxels past the grid's end stay empty (isVoxelSolid never reads them). */
    private fill(c: number, cx: number, cy: number, cz: number): Uint32Array {
        const mask = new Uint32Array((ANALYTIC_CELL * ANALYTIC_CELL * ANALYTIC_CELL) / 32);
        const x0 = cx * ANALYTIC_CELL, y0 = cy * ANALYTIC_CELL, z0 = cz * ANALYTIC_CELL;
        const x1 = Math.min(this.numVoxelsX, x0 + ANALYTIC_CELL), y1 = Math.min(this.numVoxelsY, y0 + ANALYTIC_CELL), z1 = Math.min(this.numVoxelsZ, z0 + ANALYTIC_CELL);
        for (let iz = z0; iz < z1; iz++) {
            for (let iy = y0; iy < y1; iy++) {
                for (let ix = x0; ix < x1; ix++) {
                    if (!this.voxelCentreSolid(ix, iy, iz)) continue;
                    const bit = ((iz - z0) * ANALYTIC_CELL + (iy - y0)) * ANALYTIC_CELL + (ix - x0);
                    mask[bit >>> 5] |= 1 << (bit & 31);
                }
            }
        }
        this.masks.set(c, mask);
        return mask;
    }
}

/**
 * The walls of an analytic world: a voxel grid from `min` to at least `max` (world metres) at `voxelM`,
 * its voxels solid where `solid` says at their centres. `sdf` (optional) culls the lookup by cells; without
 * it every voxel asks `solid`. The grid starts exactly at `min`, so walls on multiples of voxelM from it
 * are voxel faces.
 */
export function analyticCollision(min: readonly number[], max: readonly number[], voxelM: number, solid: PointSolidFn, sdf: DistanceFn | null = null): AnalyticVoxelCollision {
    if (!(Number.isFinite(voxelM) && voxelM > 0)) throw new RangeError(`voxel size must be a finite number > 0, got ${voxelM}`);
    const lo = [min[0], min[1], min[2]];
    const n = [0, 1, 2].map((a) => {
        const span = max[a] - min[a];
        if (!(Number.isFinite(span) && span > 0)) throw new RangeError(`analytic walls need min < max on every axis, got ${JSON.stringify(min)} .. ${JSON.stringify(max)}`);
        return Math.max(1, Math.ceil(span / voxelM - 1e-9));
    });
    // max from the counts, so the constructor's round((max - min) / res) gives exactly these counts
    const hi = [lo[0] + n[0] * voxelM, lo[1] + n[1] * voxelM, lo[2] + n[2] * voxelM];
    const meta: VoxelMetadata = {
        version: '1.1',
        gridBounds: { min: lo, max: hi },
        gaussianBounds: { min: lo.slice(), max: hi.slice() },
        voxelResolution: voxelM,
        leafSize: 4,
        treeDepth: 1,
        numInteriorNodes: 0,
        numMixedLeaves: 0,
        nodeCount: 1,
        leafDataCount: 0
    };
    const col = new AnalyticVoxelCollision(meta, solid, sdf);
    if (col.numVoxelsX !== n[0] || col.numVoxelsY !== n[1] || col.numVoxelsZ !== n[2]) throw new Error('analytic walls lost their voxel counts');
    return col;
}

/**
 * The contact world of analytic walls: VoxelContactWorld with shortcuts that answer "free" without a voxel walk.
 *   - overlap: a sphere that fits in the free radius around its centre (AnalyticVoxelCollision.freeRadiusAt: the
 *     distance kept at the centre of its cell) cannot overlap a solid voxel; in open air a test is a few reads.
 *   - sweep and pushOut (v0.13, lane v13-look, W16): the whole body at once. A ball that holds every sphere's first
 *     test of VoxelContactWorld.sweepOne (the whole-segment cover) and lies in the free radius at its centre (the
 *     cell's, else the distance at the point itself, one call) means every sweepOne answers -1; a pushOut sphere in
 *     the free radius has nothing to push out of. In tunnel-long's 0.7 m ways (0.05 m voxels, 0.4 m cells) the cells
 *     rarely tell, the distance at the point mostly does.
 * Exact: the sweep, its contact times and normals are those of VoxelContactWorld on the same walls (sonic-world.test.ts
 * asks both the queries of a flight and replays a flight on both to one hash).
 */
export class AnalyticContactWorld extends VoxelContactWorld {
    private readonly walls: AnalyticVoxelCollision;

    constructor(col: AnalyticVoxelCollision) {
        super(col);
        this.walls = col;
    }

    override overlap(x: number, y: number, z: number, r: number): boolean {
        if (r < this.walls.freeRadiusAt(x, y, z)) {
            this.stats.overlapTests++;
            return false;
        }
        return super.overlap(x, y, z, r);
    }

    override sweep(c0: Float64Array, c1: Float64Array, r: Float64Array, pad: Float64Array, n: number, out: ContactOut): number {
        if (n > 0 && this.bodyFree(c0, c1, r, pad, n)) {
            this.stats.overlapTests++;
            return -1;
        }
        return super.sweep(c0, c1, r, pad, n, out);
    }

    override pushOut(x: number, y: number, z: number, r: number, out: { x: number; y: number; z: number }): boolean {
        if (this.walls.freeWithin(x, y, z, r)) return false;
        return super.pushOut(x, y, z, r, out);
    }

    /**
     * No sphere's sweep can meet a solid voxel: the ball around the middles of the spheres' moves that holds each one's
     * whole-segment cover (radius r + pad + half the move; r + pad + LEAF for a sphere that does not move, sweepOne's
     * test then) lies within the free radius at its centre.
     */
    private bodyFree(c0: Float64Array, c1: Float64Array, r: Float64Array, pad: Float64Array, n: number): boolean {
        let cx = 0, cy = 0, cz = 0;
        for (let k = 0; k < n; k++) {
            cx += c0[k * 3] + c1[k * 3];
            cy += c0[k * 3 + 1] + c1[k * 3 + 1];
            cz += c0[k * 3 + 2] + c1[k * 3 + 2];
        }
        cx /= 2 * n; cy /= 2 * n; cz /= 2 * n;
        let reach = 0;
        for (let k = 0; k < n; k++) {
            const ax = c0[k * 3], ay = c0[k * 3 + 1], az = c0[k * 3 + 2];
            const dx = c1[k * 3] - ax, dy = c1[k * 3 + 1] - ay, dz = c1[k * 3 + 2] - az;
            const half = Math.sqrt(dx * dx + dy * dy + dz * dz) * 0.5;
            const mx = ax + dx * 0.5 - cx, my = ay + dy * 0.5 - cy, mz = az + dz * 0.5 - cz;
            const R = Math.sqrt(mx * mx + my * my + mz * mz) + r[k] + pad[k] + Math.max(half, LEAF);
            if (R > reach) reach = R;
        }
        return this.walls.freeWithin(cx, cy, cz, reach);
    }
}
