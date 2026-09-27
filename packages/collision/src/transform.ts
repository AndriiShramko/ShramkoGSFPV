// Scene scale around a pivot (design E.7, research-b 2.1 and 2.3).
//
// A scene transform maps the file's world to the flown world: T(w) = s*w + t, uniform s > 0.
// Every vendored query maps world to voxel index only through gridMin and voxelResolution; the
// octree itself is walked by index. So the scaled world is a new VoxelCollision over the SAME
// nodes/leafData arrays with gridMin' = s*gridMin + t_file and res' = s*res. Nothing is copied
// and the vendored code is untouched. Legacy format 1.0 stores x and y negated (the flipped
// adapter negates them on every query), so there t_file = (-tx, -ty, tz).

import { VoxelCollision, FlippedVoxelCollision } from './vendor/voxel-collision';
import type { VoxelMetadata } from './vendor/voxel-collision';

export type Vec3 = [number, number, number];

/** T(w) = s*w + t, stored per scene as scene.transform (E.7). */
export interface SceneTransform {
    s: number;
    t: Vec3;
}

export const IDENTITY_TRANSFORM: Readonly<SceneTransform> = Object.freeze({ s: 1, t: Object.freeze([0, 0, 0]) as unknown as Vec3 });

function check(s: number, t: readonly number[]): void {
    if (!(Number.isFinite(s) && s > 0)) throw new RangeError(`scene scale must be a finite number > 0, got ${s}`);
    if (t.length !== 3 || !t.every(Number.isFinite)) throw new RangeError(`scene offset must be 3 finite numbers, got ${JSON.stringify(t)}`);
}

/** T(p) = s*p + t. */
export function applyTransform(tr: Readonly<SceneTransform>, p: readonly number[]): Vec3 {
    return [tr.s * p[0] + tr.t[0], tr.s * p[1] + tr.t[1], tr.s * p[2] + tr.t[2]];
}

/** Rescale by k around the pivot D (the drone): s2 = k*s1, t2 = D*(1 - k) + k*t1, so T2(T1^-1(D)) = D. */
export function rescaleAround(tr: Readonly<SceneTransform>, k: number, pivot: readonly number[]): SceneTransform {
    check(k, pivot);
    const s = k * tr.s;
    const t: Vec3 = [pivot[0] * (1 - k) + k * tr.t[0], pivot[1] * (1 - k) + k * tr.t[1], pivot[2] * (1 - k) + k * tr.t[2]];
    check(s, t);
    return { s, t };
}

/** T2 o T1^-1: maps a point of the world under `from` to the same scene point under `to` (spawn, history, altitude base). */
export function relativeTransform(from: Readonly<SceneTransform>, to: Readonly<SceneTransform>): SceneTransform {
    check(from.s, from.t);
    check(to.s, to.t);
    const k = to.s / from.s;
    return { s: k, t: [to.t[0] - k * from.t[0], to.t[1] - k * from.t[1], to.t[2] - k * from.t[2]] };
}

/** The offset in the collision's file space: format 1.0 negates x and y. */
export function fileSpaceOffset(base: VoxelCollision, t: readonly number[]): Vec3 {
    return base.flipXY ? [-t[0], -t[1], t[2]] : [t[0], t[1], t[2]];
}

/** Metadata of `base` scaled by s and moved by tFile (already in file space). Exported for the tests' wrong-flip control. */
export function transformedMetadata(base: VoxelCollision, s: number, tFile: readonly number[]): VoxelMetadata {
    const res = s * base.voxelResolution;
    const min = [s * base.gridMinX + tFile[0], s * base.gridMinY + tFile[1], s * base.gridMinZ + tFile[2]];
    // max from the voxel counts, so the constructor's round((max - min) / res) gives the same counts
    const max = [min[0] + base.numVoxelsX * res, min[1] + base.numVoxelsY * res, min[2] + base.numVoxelsZ * res];
    return {
        version: base.flipXY ? '1.0' : '1.1',
        gridBounds: { min, max },
        gaussianBounds: { min: min.slice(), max: max.slice() },
        voxelResolution: res,
        leafSize: base.leafSize,
        treeDepth: base.treeDepth,
        numInteriorNodes: 0,
        numMixedLeaves: 0,
        nodeCount: base.nodes.length,
        leafDataCount: base.leafData.length
    };
}

/** A collision of the same flip class as `base` over its own octree arrays, with the given metadata. */
export function collisionWithMetadata(base: VoxelCollision, meta: VoxelMetadata, flip = base.flipXY): VoxelCollision {
    const out = flip ? new FlippedVoxelCollision(meta, base.nodes, base.leafData) : new VoxelCollision(meta, base.nodes, base.leafData);
    if (base.isVoxelSolid !== VoxelCollision.prototype.isVoxelSolid) {
        // Analytic test worlds (synthetic.ts) answer occupancy themselves. Occupancy is by index and
        // the transform does not change indices, so the scaled world asks the base.
        out.isVoxelSolid = base.isVoxelSolid.bind(base);
    }
    if (out.numVoxelsX !== base.numVoxelsX || out.numVoxelsY !== base.numVoxelsY || out.numVoxelsZ !== base.numVoxelsZ) {
        throw new Error('transformed collision lost its voxel counts');
    }
    return out;
}

/**
 * The world of `base` seen through T(w) = s*w + t: a query at T(w) with lengths times s answers
 * as the base answers at w. Build it from the untransformed base every time (not by chaining),
 * so rounding never accumulates and a replay rebuilds bit-identical grids from the same bytes.
 */
export function transformCollision(base: VoxelCollision, s: number, t: readonly [number, number, number]): VoxelCollision {
    check(s, t);
    return collisionWithMetadata(base, transformedMetadata(base, s, fileSpaceOffset(base, t)));
}
