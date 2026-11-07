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
import { VoxelContactWorld } from './world';

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
}

export class AnalyticVoxelCollision extends VoxelCollision {
    readonly solidFn: PointSolidFn;
    readonly distanceFn: DistanceFn | null;
    readonly stats: AnalyticStats = { cellsUniform: 0, cellsMixed: 0, solidCalls: 0 };
    private readonly ncx: number;
    private readonly ncy: number;
    private readonly cells: Uint8Array | null;
    /** the distance at each classified cell's centre (Float32), or null for a grid too large to keep it */
    private readonly cellD: Float32Array | null;
    private readonly masks = new Map<number, Uint32Array>();
    private readonly halfDiag: number;
    /** half a voxel's diagonal plus the rounding of a Float32 distance, metres */
    private readonly voxelReach: number;

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
 * The contact world of analytic walls: VoxelContactWorld with one shortcut. A sphere that fits in the free
 * radius around its centre (AnalyticVoxelCollision.freeRadiusAt: the distance kept at the centre of its cell)
 * cannot overlap a solid voxel, so the overlap test answers "free" without a voxel walk. Exact: the sweep,
 * its contact times and normals are those of VoxelContactWorld on the same walls (sonic-world.test.ts asks
 * both the queries of a flight and replays a flight on both to one hash); in open air a test is a few reads.
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
}
