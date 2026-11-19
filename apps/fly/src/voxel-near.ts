// What the voxel view holds where the craft is (voxux4 V2, the owner's Lublin hole: "the far voxels loaded, the ones
// right under us are a hole"). The experiment (docs/wip/vox4.md, V-2) found the plan and the queue sound: the hole is
// in the walls themselves, a thin scan bakes few wall cells under the craft. So the view measures the column under
// the craft (packages/collision chunksNear) and the panel says why it is empty instead of leaving the pilot to guess.
// Pure: no DOM, no engine.
import { levelCellVoxels } from '@gsfpv/collision';

/** What the view holds of one chunk under or next to the camera (VoxelStats.near). */
export interface NearChunkState {
    key: number;
    /** it holds a wall cell (the walls after the floater filter) */
    occupied: boolean;
    /** the level the plan wants it at / drawn at (null: none); a far group mesh covering it counts as its level */
    wanted: number | null;
    loaded: number | null;
    /** its mesh waits in the upload queue or at the worker */
    pending: boolean;
    /** faces at the drawn level, when measured (null: not yet, or drawn inside a group mesh) */
    quads: number | null;
    /** the group mesh (negative key) that draws it, if any */
    group: number | null;
}

/**
 * The walls where the craft is: 'outside' the grid (beside or under it), 'loading' (a wall chunk there is not
 * drawn yet), 'thin' (all drawn, but they cover under NEAR_THIN_SHARE of the floor under the craft), 'drawn'.
 */
export type NearWalls = 'outside' | 'loading' | 'thin' | 'drawn';

/** Faces (in voxel squares) per floor square under which the walls under the craft count as thin. */
export const NEAR_THIN_SHARE = 0.1;

export interface NearSummary {
    walls: NearWalls;
    /** the drawn faces under the craft, in voxel squares, per voxel square of the floor (1 = a full floor) */
    cover: number;
}

/**
 * Judge the column under the craft. `columns`: chunk columns it spans inside the grid (9 inside, fewer at an edge);
 * `size`: chunk edge in voxels. A face at level L covers levelCellVoxels(L)^2 voxel squares.
 */
export function nearWalls(inside: boolean, columns: number, size: number, near: readonly NearChunkState[]): NearSummary {
    if (!inside || columns <= 0) return { walls: 'outside', cover: 0 };
    let area = 0;
    let unknown = false;
    for (const c of near) {
        if (!c.occupied) continue;
        if (c.loaded === null || c.pending) return { walls: 'loading', cover: 0 };
        if (c.quads === null) { unknown = true; continue; }
        const cell = levelCellVoxels(c.loaded);
        area += c.quads * cell * cell;
    }
    const cover = area / (columns * size * size);
    // a chunk drawn inside a group mesh has no count of its own: its faces are there, so it is not judged thin
    return { walls: unknown || cover >= NEAR_THIN_SHARE ? 'drawn' : 'thin', cover };
}
