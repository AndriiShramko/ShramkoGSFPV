// The numbers of a drone picker card that are computed from the flight model rather than read from the
// preset (ui/drone.ts draws them). Pure: the Node tests check them against sim-core (tools/bench/test/
// drone-card.test.ts).
//
// Hover throttle (review R3 of lane D, docs/wip/v08-d.md). The card used 1/sqrt(TWR) with the motor idle,
// which is the hover at the preset's nominal voltage, about 3.3 V a cell: a nearly empty pack, 7-11 points
// above a fresh one on the new drones (the cinelifter: 52 % against 41 %). Pilots compare the card with what
// their real drone hovers at (the Drone physics form invites exactly that), so the card now gives both ends of
// a pack from sim-core's own hover solution (battery sag included): a full pack and HOVER_LOW_SOC.
// The number is the throttle STICK, as the simulator's HUD shows THR and Betaflight's OSD shows its throttle
// (the stick before the throttle curve): equal to the motor command on a linear curve (the new drones), lower
// on a drone with thr_mid / thr_expo (the Pavo20 Pro 3S: 28 % stick for 33 % motor command on a full pack).
import { hoverSolve } from '@gsfpv/sim-core';
import type { SimParams } from '@gsfpv/sim-core';

/** The "near empty" end of the card's hover range: 15 % charge left, where pilots land. */
export const HOVER_LOW_SOC = 0.15;

/**
 * The hover throttle stick in whole per cent on a full pack and near empty (HOVER_LOW_SOC), or null when the
 * drone cannot hover with this model (thrust below its weight, e.g. a low thrust-to-weight on a heavy world).
 */
export function cardHover(sp: SimParams): { full: number; low: number } | null {
    const full = hoverSolve(sp, 1).stick, low = hoverSolve(sp, HOVER_LOW_SOC).stick;
    if (!Number.isFinite(full) || !Number.isFinite(low)) return null;
    return { full: Math.round(full * 100), low: Math.round(low * 100) };
}
