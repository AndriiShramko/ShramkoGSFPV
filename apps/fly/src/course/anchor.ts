// Lane w1-anchor (train 5, design C:/dev/.gsfpv-lanes/designs/w1-diag.md R1): where a generated course grows from. Since car
// 3 the generator walked from the analysis core, the voxels' roughest window, and on scans whose roughest place is a badly
// captured fringe every course landed there (eb5f51dc: gate 1 540 m from the author's camera). A course now grows from the
// pilot's place: the drone when it is in the air or paused in the air, the spawn (the author's camera, session findSpawn)
// when it is parked there or the scene has just loaded. DOM-free: tools/bench/test/w1-anchor.test.ts runs it in Node.
import { S } from '@gsfpv/sim-core';
import { courseAnchor } from '@gsfpv/tracks/request';
import type { CourseAnchor } from '@gsfpv/tracks/request';
import { isParked } from './progress';

/** The anchor of a course asked now: the spawn while the drone is parked on it, else the drone's place (whole flown m). */
export function pilotAnchor(sim: ArrayLike<number>, spawn: ArrayLike<number>): CourseAnchor {
    return courseAnchor(isParked(sim, spawn) ? spawn : [sim[S.px]!, sim[S.py]!, sim[S.pz]!]);
}

/** Where generate() takes the anchor from: the pilot's place at the moment the job is sent ('pilot': a key, the dialog, a
 *  press of the sound mode), or the one a link or a room's course named ('named'; null: an old 'g2.' link without one, laid
 *  from the analysis core as before, so the course it names stays the same). */
export type AnchorFrom = { readonly kind: 'pilot' } | { readonly kind: 'named'; readonly anchor: CourseAnchor | null };
export const FROM_PILOT: AnchorFrom = { kind: 'pilot' };
