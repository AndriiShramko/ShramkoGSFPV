// Lane voxview V1 (the owner's message 58: "the obstacles are always behind the voxels"): which things
// of the scene give their depth to the voxel layer. The voxel layer clears the depth buffer (the x-ray
// over a scan drawn stochastic, see voxel-overlay.ts), which also cleared the gates' depth, so every
// voxel painted over every gate. Now a depth-only copy of each render item drawn in the World layer
// (the gates, the arrows between them, other pilots' drones, the sound mode's shapes) is drawn right
// after the clear and before the voxels: a voxel behind a gate fails the depth test, a voxel wall in
// front of a gate paints over it. The copies write no colour, so what the World layer drew (the gate,
// or the scan in front of it) stays as it was. Pure: the engine side is in voxel-overlay.ts.

export interface DepthCandidate {
    /** the render component's layer ids */
    layers: readonly number[];
    /** the entity and the component are enabled */
    enabled: boolean;
}

/** A render item gives its depth to the voxels when it is drawn in the World layer and not in a layer of the voxels' own. */
export function joinsVoxelDepth(c: DepthCandidate, worldId: number, ownIds: readonly number[]): boolean {
    if (!c.enabled || !c.layers.includes(worldId)) return false;
    for (const id of ownIds) if (c.layers.includes(id)) return false;
    return true;
}

/** The copies to make (in want, not in have) and to drop (in have, not in want). */
export function diffDepthCopies<K>(have: Iterable<K>, want: Iterable<K>): { add: K[]; drop: K[] } {
    const w = new Set(want);
    const h = new Set(have);
    const add: K[] = [];
    const drop: K[] = [];
    for (const k of w) if (!h.has(k)) add.push(k);
    for (const k of h) if (!w.has(k)) drop.push(k);
    return { add, drop };
}

/**
 * Lane voxview2 V6: the updates between two syncs of the depth copies. The copies share the node of their source, so a
 * moved gate keeps its depth anyway; but a plate made for a new next gate, chevrons made anew, gates rebuilt by the
 * course view or the edit mode, and a drone that joins are new render items that had no copy for up to 9 frames when
 * the sync ran every 10th update. Now every update while the voxels show.
 */
export const DEPTH_SYNC_EVERY = 1;

/** Is the sync due in this update (`sinceSync`: updates since the last sync, this one counted)? */
export function depthSyncDue(sinceSync: number): boolean {
    return sinceSync >= DEPTH_SYNC_EVERY;
}
