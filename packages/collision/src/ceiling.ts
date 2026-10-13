// The collision ceiling (v0.7, the owner's item 10; docs/wip/v07-e.md section 4): outdoor scans have
// floating sky splats the voxelizer turns into walls, and a pilot crashed into them. Above a height
// the scan's voxels stop being walls.
//
// The height is in the scan's own coordinates: the world before the scene scale (E.7, T(w) = s*w + t),
// scale 1, metres along +Y (the catalogue's `ceilingM`, the life header's `scene.ceilingM`). A voxel is
// ignored when its lower face is at or above the ceiling; a voxel the plane cuts through still
// collides. The rule is turned into voxel rows once (ceilingCut), in the octree's index space, so:
//   - every query sees it: withCeiling gives the same octree arrays (nothing copied) behind an
//     isVoxelSolid that answers "empty" above the cut, the layer analytic test worlds already use;
//     the vendored querySphere / queryRay / isFreeAt and our swept test all ask isVoxelSolid;
//   - any scene scale keeps it exactly: transformCollision changes gridMin and the voxel size, never
//     the indices, and carries an overridden isVoxelSolid along (transform.ts collisionWithMetadata);
//   - format 1.0 (x and y stored negated) is handled here, in the cut, once.
// Order (the live walls and a replay alike, apps/fly session/world.ts): floater filter, then the
// ceiling, then the scene transform. dropFloaters refuses a ceilinged input (it needs the plain
// octree), and octree walkers (mesh.ts forEachBlock) read a ceilinged collision voxel by voxel like an
// analytic world: correct, slower. The voxel overlay therefore draws the walls without the ceiling and
// tints the rows above the cut (overlay.ts overlayChunk's `cut`).

import type { VoxelCollision } from './vendor/voxel-collision';
import { collisionWithMetadata, transformedMetadata } from './transform';

/** The catalogue's range for ceilingM, m (packages/scenes catalog.ts readScene). */
export const CEILING_LIMIT_M = 10000;

/** A ceiling the walls and the log accept: a finite height within +-CEILING_LIMIT_M. */
export function validCeiling(c: unknown): c is number {
    return typeof c === 'number' && Number.isFinite(c) && c >= -CEILING_LIMIT_M && c <= CEILING_LIMIT_M;
}

/** The voxel rows a ceiling removes, in the collision's index space (iy). */
export interface CeilingCut {
    /** the ignored row nearest the ceiling */
    row: number;
    /** 1: rows `row` and up are ignored (format 1.1, file y = world y); -1: rows `row` and down (format 1.0 negates y) */
    dir: 1 | -1;
}

/**
 * The rows of `scanWalls` at or above `ceilingM` (scan coordinates). Only the grid's y origin and voxel
 * size are read, so the scan's walls, its filtered walls and any scaled copy share one cut.
 */
export function ceilingCut(scanWalls: VoxelCollision, ceilingM: number): CeilingCut {
    if (!validCeiling(ceilingM)) throw new RangeError(`collision ceiling must be a number within +-${CEILING_LIMIT_M} m, got ${ceilingM}`);
    const res = scanWalls.voxelResolution, gy = scanWalls.gridMinY;
    // 1.1: voxel iy spans [gy + iy res, gy + (iy + 1) res]; its lower face is at or above c from iy = ceil((c - gy) / res)
    if (!scanWalls.flipXY) return { row: Math.ceil((ceilingM - gy) / res), dir: 1 };
    // 1.0: world y = -file y, so voxel iy spans [-(gy + (iy + 1) res), -(gy + iy res)]; its lower face is at or above c up to this row
    return { row: Math.floor((-ceilingM - gy) / res) - 1, dir: -1 };
}

/** Is voxel row iy above the cut (ignored)? */
export function rowAboveCut(cut: CeilingCut, iy: number): boolean {
    return cut.dir > 0 ? iy >= cut.row : iy <= cut.row;
}

/**
 * Is every voxel row of block row `by` (4 voxels a side) above the cut? A block the cut passes
 * through still has walls, so it is not.
 */
export function blockAboveCut(cut: CeilingCut, by: number): boolean {
    return cut.dir > 0 ? by * 4 >= cut.row : by * 4 + 3 <= cut.row;
}

/**
 * The scan's walls with every voxel at or above `ceilingM` (scan coordinates, see the header) empty:
 * the same octree arrays behind an isVoxelSolid that checks the row first. Give it the scan's own
 * (or floater-filtered) walls at scale 1, then scale the result (transformCollision): a ceiling
 * applied to already scaled walls would read ceilingM in flown metres.
 */
export function withCeiling(scanWalls: VoxelCollision, ceilingM: number): VoxelCollision {
    const cut = ceilingCut(scanWalls, ceilingM);
    // a twin over the same arrays (an analytic world's own isVoxelSolid comes along, bound to it)
    const out = collisionWithMetadata(scanWalls, transformedMetadata(scanWalls, 1, [0, 0, 0]));
    const inner = out.isVoxelSolid;
    const below = cut.dir > 0 ? (iy: number) => iy < cut.row : (iy: number) => iy > cut.row;
    out.isVoxelSolid = (ix: number, iy: number, iz: number): boolean => below(iy) && inner.call(out, ix, iy, iz);
    return out;
}
