// Analytic voxel worlds for tests: the upstream collision code runs unchanged, only the
// per-voxel occupancy lookup is replaced.

import { VoxelCollision } from './vendor/voxel-collision';
import type { VoxelMetadata } from './vendor/voxel-collision';

export type SolidFn = (ix: number, iy: number, iz: number) => boolean;

class AnalyticVoxelCollision extends VoxelCollision {
    private readonly solid: SolidFn;
    constructor(meta: VoxelMetadata, solid: SolidFn) {
        super(meta, new Uint32Array([0]), new Uint32Array(0));
        this.solid = solid;
    }
    override isVoxelSolid(ix: number, iy: number, iz: number): boolean {
        if (ix < 0 || iy < 0 || iz < 0 || ix >= this.numVoxelsX || iy >= this.numVoxelsY || iz >= this.numVoxelsZ) return false;
        return this.solid(ix, iy, iz);
    }
}

function meta(min: number, max: number, res: number): VoxelMetadata {
    return {
        version: '1.1',
        gridBounds: { min: [min, min, min], max: [max, max, max] },
        gaussianBounds: { min: [min, min, min], max: [max, max, max] },
        voxelResolution: res,
        leafSize: 4,
        treeDepth: 1,
        numInteriorNodes: 0,
        numMixedLeaves: 0,
        nodeCount: 1,
        leafDataCount: 0
    };
}

/** A single wall one voxel thick (default 2 cm) in the plane x in [0, res), filling a 4 m cube. */
export function syntheticWall(res = 0.02, half = 2): VoxelCollision {
    const m = meta(-half, half, res);
    const wallIx = Math.round(half / res);
    return new AnalyticVoxelCollision(m, (ix) => ix === wallIx);
}

/** Open volume: no solid voxels at all (negative controls). */
export function syntheticOpen(res = 0.05, half = 50): VoxelCollision {
    return new AnalyticVoxelCollision(meta(-half, half, res), () => false);
}

/** Closed box room with 1-voxel walls (inner size ~ 2*half), for bot tests without a scan. */
export function syntheticRoom(res = 0.05, half = 5): VoxelCollision {
    const m = meta(-half, half, res);
    const n = Math.round((2 * half) / res);
    return new AnalyticVoxelCollision(m, (ix, iy, iz) => ix === 0 || iy === 0 || iz === 0 || ix === n - 1 || iy === n - 1 || iz === n - 1);
}
