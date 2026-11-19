/**
 * The craft's start on a scan: the scan's camera, unless that camera looks at the scan from outside it.
 *
 * A SuperSplat scene's camera is placed by its author for a picture, not for a flight: on an overview
 * (2f1ddf5f: 62 m up, above the top of the scanned volume; d10c5638: beside it) the scan's walls hold
 * nothing under the camera, so the craft started in empty air with no ground below. `placeStart` keeps
 * the camera when there is ground within START_MAX_OVER_GROUND_M under it; otherwise it walks the line
 * from the camera through its target (what the author pointed at) to the first point that has ground
 * under it and starts START_OVER_GROUND_M above that ground. A start inside a wall is then pushed out
 * by the vendored findSphereSpawn, as before. No ground on the line (holes in a sparse scan): the nearest
 * ground around the target, ring by ring. Nothing found: the camera, as before.
 */
import type { Collision } from './vendor/collision';
import { findSphereSpawn } from './vendor/find-spawn';

/** Ground further below the camera than this (metres) makes the camera an overview, not a start. */
export const START_MAX_OVER_GROUND_M = 6;
/** How high over the ground a start moved off an overview camera is (the eye band of a walking person). */
export const START_OVER_GROUND_M = 1.5;
/** The line from the camera through its target is walked this many times the camera-target distance. */
export const START_LINE_REACH = 4;
/** Samples along that line (the step is the reach over this). */
export const START_LINE_SAMPLES = 800;

/** No ground on the line: columns around the camera's target are tried this far out (metres) ... */
export const START_RING_M = 60;
/** ... on a grid of this step (metres). */
export const START_RING_STEP_M = 1;

const RAY_M = 1000;

/**
 * Why the start is where it is: the camera itself, a point down the camera's line, the nearest ground
 * around the camera's target, or the camera with nothing better.
 */
export type StartFrom = 'camera' | 'line' | 'around' | 'camera-no-ground';

export interface StartPlace {
    pos: [number, number, number];
    from: StartFrom;
    /** the ground under the start (y), null when none was found */
    groundY: number | null;
}

function free(col: Collision, x: number, y: number, z: number, r: number): [number, number, number] | null {
    const push = { x: 0, y: 0, z: 0 };
    if (!col.querySphere(x, y, z, r, push)) return [x, y, z];
    const out = { x: 0, y: 0, z: 0 };
    return findSphereSpawn(col, x, y, z, r, out) ? [out.x, out.y, out.z] : null;
}

/**
 * The start for a craft of bound radius `r` from the scan's camera `cam` looking at `target` (both in
 * the flown world, metres, y up).
 */
export function placeStart(col: Collision, cam: readonly number[], target: readonly number[] | null, r: number): StartPlace {
    const [cx, cy, cz] = [cam[0]!, cam[1]!, cam[2]!];
    const here = free(col, cx, cy, cz, r) ?? [cx, cy, cz];
    const under = col.queryRay(here[0], here[1], here[2], 0, -1, 0, RAY_M);
    if (under && here[1] - under.y <= START_MAX_OVER_GROUND_M) return { pos: here, from: 'camera', groundY: under.y };
    if (target) {
        const dx = target[0]! - cx, dy = target[1]! - cy, dz = target[2]! - cz;
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (len > 0) {
            for (let i = 0; i <= START_LINE_SAMPLES; i++) {
                const f = (START_LINE_REACH * i) / START_LINE_SAMPLES;
                const px = cx + dx * f, py = cy + dy * f, pz = cz + dz * f;
                // i = 0 is the camera's own column: ground deep below it gives a start over that ground
                const hit = col.queryRay(px, py, pz, 0, -1, 0, RAY_M);
                if (!hit) continue;
                const y = hit.y + START_OVER_GROUND_M;
                const p = free(col, px, y, pz, r);
                if (p) return { pos: p, from: 'line', groundY: hit.y };
            }
        }
    }
    // the line runs over holes only (a sparse scan: 2f1ddf5f's line has no wall under it, the ground is 8 m aside):
    // the nearest column with ground around what the camera looks at, ring by ring
    const [ax, az] = target ? [target[0]!, target[2]!] : [cx, cz];
    const top = Math.max(cy, target ? target[1]! : cy);
    for (let k = 0; k * START_RING_STEP_M <= START_RING_M; k++) {
        let best: { p: [number, number, number]; g: number; d: number } | null = null;
        for (let i = -k; i <= k; i++) for (let j = -k; j <= k; j++) {
            if (Math.max(Math.abs(i), Math.abs(j)) !== k) continue;
            const px = ax + i * START_RING_STEP_M, pz = az + j * START_RING_STEP_M;
            const hit = col.queryRay(px, top, pz, 0, -1, 0, RAY_M);
            if (!hit) continue;
            const d = i * i + j * j;
            if (best && d >= best.d) continue;
            const p = free(col, px, hit.y + START_OVER_GROUND_M, pz, r);
            if (p) best = { p, g: hit.y, d };
        }
        if (best) return { pos: best.p, from: 'around', groundY: best.g };
    }
    return { pos: here, from: under ? 'camera' : 'camera-no-ground', groundY: under ? under.y : null };
}
