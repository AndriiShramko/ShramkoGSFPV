// Prop wash (v0.8, the owner's item 9; docs/wip/v08-d.md, docs/research/drones-v08.md): the rotors
// lose thrust and shake the craft while it sinks through its own wake.
//
// Physics. Momentum theory gives the induced velocity of a rotor disk of area A making thrust T,
// v_i = sqrt(T / (2 rho A)). Descending along the rotor axis at v_d, the ideal solution breaks down for
// 0 < v_d < 2 v_i: the craft sinks into the air it has just pushed down (vortex ring state). Measured
// rotors lose thrust and the flow turns unsteady in that band, worst near v_d = v_i, and the effect
// fades once the craft moves sideways faster than about v_i (it leaves its wake behind). That is what
// FPV pilots call prop wash: a dive or a fast drop, then throttle up, and the quad shakes and sinks.
//
// Model. The intensity k in [0, 1] is a smooth bump over v_d / v_i between WAKE_LO and WAKE_HI (zero
// at both ends, 1 in the middle), divided by 1 + 4 (v_side / v_i)^2. The thrust of every rotor is
// multiplied by 1 - wakeLoss * k, and a turbulent roll and pitch torque of amplitude
// wakeShake * k * (thrust of one rotor) * (arm) is added (the thrust of each rotor fluctuates in the
// wake, unevenly from side to side), its shape a seeded noise of the tick (WAKE_NOISE_TICKS between
// knots). v_i follows the thrust the rotors make right now (the motor
// state), so a craft that chops the throttle (low thrust, small v_i) falls through without loss and
// meets its wake when it throttles up again, as in real life.
//
// Presets opt in with wake_loss / wake_shake (and prop_diameter_mm for the disk); a preset without them
// flies exactly the model without this term, bit for bit (the A6 hash of the default drone stays).
//
// Determinism. Only + - * /, Math.sqrt and the integer noise of wind.ts: a pure function of the hashed
// state and the tick, so frame splits, rewinds and replays see the same wash.

import { smoothNoise } from './wind';

/**
 * The largest share of thrust the wake may take (wakeLoss): a preset's wake_loss must lie in 0..this, and
 * a preset's wake_loss times the pilot's prop wash multiplier is capped here (params.ts wakeOf), so no
 * setting can make a flight model that cannot be built.
 */
export const WAKE_LOSS_MAX = 0.9;
/** Below this descent ratio v_d / v_i the craft is still in normal working state (no loss). */
export const WAKE_LO = 0.25;
/** At and above this ratio the flow goes up through the disk (windmill brake state): no loss. */
export const WAKE_HI = 2.0;
/** Knots of the turbulence noise every this many 1 kHz ticks (40 Hz knots: a shake of about 10-20 Hz). */
export const WAKE_NOISE_TICKS = 25;
/** Seed of the turbulence noise (a constant: the wash is part of the model, not of the place). */
export const WAKE_SEED = 0x51a57e11;

/** Induced velocity at the disk, m/s, of rotors of total area `area` (m^2) making total thrust `thrust` (N). */
export function inducedVelocity(thrust: number, rho: number, area: number): number {
    if (!(thrust > 0) || !(area > 0)) return 0;
    return Math.sqrt(thrust / (2 * rho * area));
}

/**
 * The wake intensity 0..1: `down` = airspeed along the rotor axis, positive when the air comes up
 * through the disk from below (the craft sinks along its thrust axis), m/s; `side` = airspeed in the
 * rotor plane, m/s; `vi` = induced velocity (inducedVelocity), m/s.
 */
export function wakeIntensity(down: number, side: number, vi: number): number {
    if (!(vi > 0) || !(down > 0)) return 0;
    const x = down / vi;
    if (x <= WAKE_LO || x >= WAKE_HI) return 0;
    const t = (x - WAKE_LO) / (WAKE_HI - WAKE_LO);
    const b = 4 * t * (1 - t);
    const mu = side / vi;
    return (b * b) / (1 + 4 * mu * mu);
}

/** The turbulence shape of one axis (0 roll, 1 pitch) at a tick, about -1..1. */
export function wakeNoise(axis: number, tick: number): number {
    return smoothNoise(WAKE_SEED, axis, tick, WAKE_NOISE_TICKS);
}
