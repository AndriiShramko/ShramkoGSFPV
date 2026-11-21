// Per-vertex ambient occlusion of the voxel overlay (voxux4 V-2b; Minecraft-style, after 0fps.net
// "Ambient occlusion for Minecraft-like worlds"): each quad corner looks at the three cells in front
// of the face that touch it (the two beside it and the one across the corner) and darkens by how many
// are solid. Pure: no engine, no DOM; the worker (voxels.worker.ts) runs it, packChunk applies it.
import { forEachBlock, levelCellVoxels } from '@gsfpv/collision';
import type { OverlayChunk, VoxelCollision } from '@gsfpv/collision';

/** How shut in a corner is: 0 open, 3 a corner between two walls. */
export type AoLevel = 0 | 1 | 2 | 3;

/** The corner rule: two solid sides close the corner whatever the cell across it holds. */
export function vertexAo(side1: boolean, side2: boolean, corner: boolean): AoLevel {
    if (side1 && side2) return 3;
    return ((side1 ? 1 : 0) + (side2 ? 1 : 0) + (corner ? 1 : 0)) as AoLevel;
}

/** The grid of one level of detail, as overlayChunk (packages/collision overlay.ts) meshes it. */
export interface AoGrid {
    /** the grid's low corner in voxel-data coordinates (col.gridMinX, gridMinY, gridMinZ) */
    min: readonly [number, number, number];
    /** legacy walls: world x and y are the data's negated (FlippedVoxelCollision) */
    flipXY: boolean;
    /** the cell's edge in metres at this level (voxel size x levelCellVoxels(lod)) */
    cell: number;
    /** whether the cell at these indices (of this level) is solid; outside the grid: false */
    solid(ix: number, iy: number, iz: number): boolean;
}

/**
 * The occlusion of every vertex of a chunk's quads (4 vertices a quad, positions and normals in world
 * space as overlayChunk writes them): one AoLevel per vertex. A quad that is a run of cells gets each
 * end's corners right and blends along the run.
 */
export function quadAo(positions: ArrayLike<number>, normals: ArrayLike<number>, quads: number, g: AoGrid): Uint8Array {
    const ao = new Uint8Array(quads * 4);
    const gc = new Int32Array(12); // the 4 corners in cell indices
    const mid = [0, 0, 0];
    const cellIdx = [0, 0, 0];
    const sgn = (ax: number): number => (g.flipXY && ax < 2 ? -1 : 1);
    for (let k = 0; k < quads; k++) {
        const v0 = k * 4;
        // the normal's axis and side in data coordinates
        let na = 0, ns = 1;
        for (let ax = 0; ax < 3; ax++) {
            const n = normals[v0 * 3 + ax] * sgn(ax);
            if (n !== 0) { na = ax; ns = n > 0 ? 1 : -1; }
        }
        mid[0] = mid[1] = mid[2] = 0;
        for (let c = 0; c < 4; c++) {
            for (let ax = 0; ax < 3; ax++) {
                const i = Math.round((positions[(v0 + c) * 3 + ax] * sgn(ax) - g.min[ax]) / g.cell);
                gc[c * 3 + ax] = i;
                mid[ax] += i / 4;
            }
        }
        const t1 = na === 0 ? 1 : 0, t2 = na === 2 ? 1 : 2;
        for (let c = 0; c < 4; c++) {
            const a = gc[c * 3 + t1], b = gc[c * 3 + t2];
            // the cells beside the corner: inside the quad and outside it, along each tangent axis
            const aOut = a > mid[t1] ? a : a - 1, aIn = a > mid[t1] ? a - 1 : a;
            const bOut = b > mid[t2] ? b : b - 1, bIn = b > mid[t2] ? b - 1 : b;
            // the layer of cells the face looks into
            cellIdx[na] = ns > 0 ? gc[c * 3 + na] : gc[c * 3 + na] - 1;
            cellIdx[t1] = aOut; cellIdx[t2] = bIn;
            const s1 = g.solid(cellIdx[0], cellIdx[1], cellIdx[2]);
            cellIdx[t1] = aIn; cellIdx[t2] = bOut;
            const s2 = g.solid(cellIdx[0], cellIdx[1], cellIdx[2]);
            cellIdx[t1] = aOut; cellIdx[t2] = bOut;
            const corner = !(s1 && s2) && g.solid(cellIdx[0], cellIdx[1], cellIdx[2]);
            ao[v0 + c] = vertexAo(s1, s2, corner);
        }
    }
    return ao;
}

/**
 * The solid cells of one chunk and a one-cell halo around it, at level 0 (voxels) or 1 (blocks: a block with
 * any solid voxel), read block by block once (forEachBlock) rather than through the octree per sample.
 * Cells outside the window fall back to the grid itself.
 */
export function cellWindow(col: VoxelCollision, chunk: { x: number; y: number; z: number }, size: number, lod: 0 | 1): (ix: number, iy: number, iz: number) => boolean {
    const n = lod === 0 ? size : size / 4; // cells a side
    const E = n + 2;
    const o = [chunk.x * n - 1, chunk.y * n - 1, chunk.z * n - 1]; // the window's first cell
    const occ = new Uint8Array(E * E * E);
    const b0 = lod === 0 ? o.map((c) => Math.floor(c / 4)) : o;
    const b1 = lod === 0 ? o.map((c) => Math.floor((c + E - 1) / 4) + 1) : o.map((c) => c + E);
    forEachBlock(col, b0, b1, (bx, by, bz, lo, hi) => {
        if (lod === 1) {
            if ((lo | hi) === 0) return;
            occ[((bz - o[2]) * E + (by - o[1])) * E + (bx - o[0])] = 1;
            return;
        }
        for (let w = 0; w < 2; w++) {
            let bits = w === 0 ? lo : hi;
            while (bits !== 0) {
                const low = bits & -bits;
                const bit = 31 - Math.clz32(low) + w * 32;
                bits = (bits ^ low) >>> 0;
                const lx = bx * 4 + (bit & 3) - o[0], ly = by * 4 + ((bit >> 2) & 3) - o[1], lz = bz * 4 + (bit >> 4) - o[2];
                if (lx < 0 || ly < 0 || lz < 0 || lx >= E || ly >= E || lz >= E) continue;
                occ[(lz * E + ly) * E + lx] = 1;
            }
        }
    });
    const far = lod === 0 ? (x: number, y: number, z: number): boolean => col.isVoxelSolid(x, y, z) : (x: number, y: number, z: number): boolean => {
        // a block of the grid outside the window: any of its voxels
        let any = false;
        forEachBlock(col, [x, y, z], [x + 1, y + 1, z + 1], (_bx, _by, _bz, lo, hi) => { if ((lo | hi) !== 0) any = true; });
        return any;
    };
    return (x, y, z) => {
        const lx = x - o[0], ly = y - o[1], lz = z - o[2];
        if (lx < 0 || ly < 0 || lz < 0 || lx >= E || ly >= E || lz >= E) return far(x, y, z);
        return occ[(lz * E + ly) * E + lx] === 1;
    };
}

/**
 * The ambient occlusion of the vertices of chunk (x, y, z) of `size` voxels, meshed as `c` (overlayChunk), at
 * level 0 (voxels) and 1 (blocks); the coarser levels merge cells into big quads and stay unshaded (null).
 */
export function chunkAo(col: VoxelCollision, chunk: { x: number; y: number; z: number }, size: number, c: OverlayChunk, lod: number): Uint8Array | null {
    if (lod !== 0 && lod !== 1) return null;
    const grid: AoGrid = {
        min: [col.gridMinX, col.gridMinY, col.gridMinZ],
        flipXY: col.flipXY,
        cell: col.voxelResolution * levelCellVoxels(lod),
        solid: cellWindow(col, chunk, size, lod)
    };
    return quadAo(c.positions, c.normals, c.quads, grid);
}
