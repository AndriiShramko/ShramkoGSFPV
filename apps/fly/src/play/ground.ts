// How high the drone is above the ground below it (docs/wip/v09-b.md): the game scheme's soft landing slows a
// descent by this, so holding Shift lands instead of crashing. One sweep of a tiny sphere straight down
// through the scan's own collision (the model's ContactWorld), a rule for every scan: nothing per scene.
// Pure: no DOM; the page asks once per frame.

import type { ContactOut, ContactWorld, SimParams } from '@gsfpv/sim-core';
import { S } from '@gsfpv/sim-core';

/** How far below the craft the probe looks, m. Beyond it the ground is "far": no limit but the speed setting. */
export const PROBE_M = 20;
/** The probe's sphere, m: small, so a thin ledge counts. */
const PROBE_R = 0.05;

const c0 = new Float64Array(3);
const c1 = new Float64Array(3);
const rad = new Float64Array([PROBE_R]);
const pad = new Float64Array([0]);
const out: ContactOut = { sphere: 0, nx: 0, ny: 0, nz: 0 };

/**
 * Clearance of the craft's lowest body point above the solid straight below it, m (0 when touching or
 * inside); null when nothing solid lies within PROBE_M or there is no world.
 */
export function groundClearance(world: ContactWorld | null, s: ArrayLike<number>, p: Pick<SimParams, 'bodyBottom'>): number | null {
    if (!world) return null;
    c0[0] = c1[0] = s[S.px];
    c0[1] = s[S.py];
    c1[1] = s[S.py] - PROBE_M;
    c0[2] = c1[2] = s[S.pz];
    const t = world.sweep(c0, c1, rad, pad, 1, out);
    if (t < 0) return null;
    // the sphere touches when its centre is PROBE_R above the surface: the surface is PROBE_R below where it stopped
    return Math.max(0, t * PROBE_M + PROBE_R - p.bodyBottom);
}
