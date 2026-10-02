// Scene scale around the drone (docs/architecture-v03.md E.7, the owner's item 11): the world the
// session flies is the scan's under T(w) = s*w + t. Physics stays in metres; the walls are the
// scan's own octree seen through T (collision transformCollision, nothing copied), the splats get
// the same s and t (render-pc setSceneTransform). The values are Float32 everywhere (a world record
// holds Float32), so the live walls, the life header and a replay are built from the same numbers.
//
// The floater filter (G.3, the owner's item 24: phantom walls) is applied first, to the scan's own
// walls (collision dropFloaters: pieces smaller than N blocks removed), then the transform: a
// filter never moves a voxel index, so the two commute, and the filtered walls' hash does not
// depend on the scene's size.
import { VoxelContactWorld, applyTransform, dropFloaters, findSphereSpawn, floaterDigestParts, relativeTransform, transformCollision } from '@gsfpv/collision';
import type { FloaterFilter, SceneTransform, Vec3, VoxelCollision } from '@gsfpv/collision';
import { Sha256 } from '@gsfpv/sim-core';
import type { ContactWorld } from '@gsfpv/sim-core';

export type { SceneTransform };

export const IDENTITY: Readonly<SceneTransform> = Object.freeze({ s: 1, t: Object.freeze([0, 0, 0]) as unknown as Vec3 });

/** The transform as a log record holds it (Float32 s and t). */
export function f32(tr: { s: number; t: readonly number[] }): SceneTransform {
    return { s: Math.fround(tr.s), t: [Math.fround(tr.t[0]), Math.fround(tr.t[1]), Math.fround(tr.t[2])] };
}

export function isIdentity(tr: { s: number; t: readonly number[] }): boolean {
    return tr.s === 1 && tr.t[0] === 0 && tr.t[1] === 0 && tr.t[2] === 0;
}

export function sameTransform(a: { s: number; t: readonly number[] }, b: { s: number; t: readonly number[] }): boolean {
    return a.s === b.s && a.t[0] === b.t[0] && a.t[1] === b.t[1] && a.t[2] === b.t[2];
}

/** [s, tx, ty, tz]: how a life header (LifeHeader.scene.transform) holds it. */
export function packed(tr: SceneTransform): [number, number, number, number] {
    return [tr.s, tr.t[0], tr.t[1], tr.t[2]];
}

/** The walls of the scan under T: the base itself at the identity, else the same octree seen through T. */
export function scaledCollision(base: VoxelCollision, tr: SceneTransform): VoxelCollision {
    return isIdentity(tr) ? base : transformCollision(base, tr.s, tr.t);
}

const digests = new WeakMap<VoxelCollision, string>();

/** sha256 of walls as floaterDigestParts lists them (grid line, octree words, leaf masks), once per collision. */
export function wallsDigest(col: VoxelCollision): string {
    let d = digests.get(col);
    if (!d) {
        const h = new Sha256();
        for (const part of floaterDigestParts(col)) h.update(part);
        d = h.digestHex();
        digests.set(col, d);
    }
    return d;
}

/**
 * The scan's walls with its floating pieces under `minBlocks` blocks dropped (G.3), and the hash a
 * life header carries for them; minBlocks 0: the scan's own walls and no hash. The live session
 * and a replay call this same function on the same base, so they get the same words.
 */
export function filteredWalls(base: VoxelCollision, minBlocks: number): { filter: FloaterFilter; collision: VoxelCollision; sha256: string | null } {
    const filter = dropFloaters(base, minBlocks);
    return { filter, collision: filter.collision, sha256: minBlocks > 0 ? wallsDigest(filter.collision) : null };
}

/** The walls a page has for replays: the scan's own (untransformed) collision and its contact world. */
export interface BaseWalls {
    world: ContactWorld | null;
    collision?: VoxelCollision | null;
}

/**
 * The contact world under T (a life header's transform or a world record's) with the floater filter
 * applied first (G.3): the base world at the identity and no filter, so a flight that never
 * rescaled replays exactly as before; else a new one from the base
 * every time (never chained), so rounding never accumulates. null: no walls, or none to scale.
 */
export function worldUnder(walls: BaseWalls, tr: { s: number; t: readonly number[] }, floaterMinBlocks = 0): ContactWorld | null {
    if (!walls.world) return null;
    if (isIdentity(tr) && floaterMinBlocks === 0) return walls.world;
    if (!walls.collision) return null;
    const col = filteredWalls(walls.collision, floaterMinBlocks).collision;
    return new VoxelContactWorld(isIdentity(tr) ? col : transformCollision(col, tr.s, [tr.t[0], tr.t[1], tr.t[2]]));
}

/** T2 o T1^-1 as a point map: a point of the world under `from` to the same scan point under `to`. */
export function pointMap(from: SceneTransform, to: SceneTransform): (x: number, y: number, z: number) => Vec3 {
    const rel = relativeTransform(from, to);
    return (x, y, z) => applyTransform(rel, [x, y, z]);
}

/**
 * After a scale-down the walls come closer: when the craft's sphere (radius r) touches one, the
 * nearest free spot by findSphereSpawn (same yaw), else null (it stays where it is).
 */
export function pushOut(col: VoxelCollision | null, at: readonly [number, number, number, number], r: number): [number, number, number, number] | null {
    if (!col) return null;
    const push = { x: 0, y: 0, z: 0 };
    if (!col.querySphere(at[0], at[1], at[2], r, push)) return null;
    const out = { x: 0, y: 0, z: 0 };
    if (!findSphereSpawn(col, at[0], at[1], at[2], r, out)) return null;
    return [out.x, out.y, out.z, at[3]];
}
