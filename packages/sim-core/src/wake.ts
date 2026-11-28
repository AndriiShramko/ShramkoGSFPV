// Prop wash (v0.8 the owner's item 9; train 5 lane w3-model, docs/wip/w3-model.md "## Design"): the rotors
// lose thrust and each one's thrust fluctuates on its own while the craft sinks through its own wake.
//
// Physics. Momentum theory gives the induced velocity of a rotor disk of area A making thrust T,
// v_i = sqrt(T / (2 rho A)). Descending along the rotor axis at v_d, the craft sinks into the air it has
// just pushed down (vortex ring state): measured rotors lose mean thrust and their thrust turns unsteady in
// a band of x = v_d / v_i, worst near x = 1.25, and the effect fades once the craft moves sideways (it leaves
// its wake behind). That is what FPV pilots call prop wash: a dive or a fast drop, then throttle up, and the
// quad sinks and shakes.
//
// Sources (the research note of 2026-11-26, sections on VRS and the Addenda; docs/wip/w3-model.md):
// - band and peak: Veismann, Yos, Gharib, Phys. Fluids 34, 035124 (2022), 152 mm rotor, measured: loss band
//   0.5 < x < 1.7, peak at 1.2 to 1.4, independent of rpm and hover thrust; Parrot Mambo (63 g, arXiv
//   1909.09069, measured in flight): onset at x = 0.39.
// - mean loss at the peak: Veismann 2022 base blade 20 % (6 to 35 % by blade shape); Veismann et al. AIAA
//   2021-0193 (NASA/JPL multicopter): up to 20 %.
// - shake: SD of thrust / thrust at the peak 0.09 to 0.12 (Veismann 2022 fig. 9 and 10), 0.1 at 6 m/s descent
//   on a 1.68 kg quad (Veismann 2021); measured per rotor, so each rotor gets its own noise.
// - duct: Pickles et al., Exp. Fluids 2023: a ducted rotor enters VRS like an open one with a "small delay".
//
// Model. k in [0, 1] = b(x - shift) / (1 + 4 mu^2), mu = v_side / v_i, b a smooth bump that is 0 outside
// WAKE_LO..WAKE_HI and 1 at WAKE_PEAK, shift = WAKE_DUCT_SHIFT on a ducted craft. Rotor i's thrust is
// T0_i (1 - L k) (1 + S k n_i(t)): L = WAKE_LOSS_PEAK and S = WAKE_SHAKE_PEAK times the pilot's prop wash
// multiplier (params.ts wakeOf), n_i an own seeded band-limited noise with SD 1 (wakeRotorNoise). Uneven thrust
// across the X makes the roll, pitch and yaw torque noise the rate PID fights. v_i follows the thrust the rotors
// make right now (the motor state; = v_h of the craft's mass, rotor size and count in a hover), so a craft that
// chops the throttle falls through without loss and meets its wake when it throttles up again.
//
// Determinism. Only + - * /, Math.sqrt and the integer noise of wind.ts: a pure function of the hashed
// state and the tick, so frame splits, rewinds and replays see the same wash.

import { smoothNoise } from './wind';

/**
 * The largest share of thrust the wake may take (wakeLoss): the loss times the pilot's prop wash multiplier is
 * capped here (params.ts wakeOf), so no setting can make a flight model that cannot be built.
 */
export const WAKE_LOSS_MAX = 0.9;
/** Below this descent ratio v_d / v_i (open rotor) the craft is in normal working state (Veismann 2022, Mambo 0.39). */
export const WAKE_LO = 0.4;
/** The ratio of the largest mean loss and the largest shake (Veismann 2022: 1.2 to 1.4). */
export const WAKE_PEAK = 1.25;
/** At and above this ratio the flow goes up through the disk (windmill brake state): no loss (Veismann 2022). */
export const WAKE_HI = 1.7;
/**
 * A duct delays the onset (Pickles et al. 2023, qualitative): the whole band moves right by this on a ducted
 * craft. ESTIMATE: the paper gives no number; the research note's 0.1 to 0.2, middle taken.
 */
export const WAKE_DUCT_SHIFT = 0.15;
/**
 * Sideways fade: k is divided by 1 + this x (v_side / v_i)^2. ESTIMATE: no quantitative source (helicopter
 * lore: VRS gone at 0.5 to 1 v_h forward speed, which this gives as 1/2 to 1/5).
 */
export const WAKE_SIDE_FADE = 4;
/** Mean thrust lost at the peak, share of clean-air thrust: Veismann 2022 base blade 20 % (measured, 152 mm). */
export const WAKE_LOSS_PEAK = 0.2;
/** SD of each rotor's thrust over its mean at the peak: Veismann 2022 fig. 9/10 0.09 to 0.12, NASA 2021 0.1. */
export const WAKE_SHAKE_PEAK = 0.1;
/**
 * The shake's two octaves, knots every this many 1 kHz ticks (content about 10 to 100 Hz). ESTIMATE: pilots'
 * prop-wash band 20 to 100 Hz on 5-inch (Oscar Liang, community), Stack et al. 2004 a cycle of 20 to 50 rotor
 * revolutions (7 to 23 Hz at a whoop's rpm); no measured whoop frequency.
 */
export const WAKE_NOISE_TICKS: readonly [number, number] = [40, 8];
/**
 * Divides the sum of the two octaves so that the noise has SD 1 (the SD of the sum is 0.738 over 10^6 ticks;
 * model-wake.test.ts holds the result to 1 +- 0.05).
 */
export const WAKE_NOISE_NORM = 0.738;
/** Seed of the turbulence noise (a constant: the wash is part of the model, not of the place). */
export const WAKE_SEED = 0x51a57e11;

/** Induced velocity at the disk, m/s, of rotors of total area `area` (m^2) making total thrust `thrust` (N). */
export function inducedVelocity(thrust: number, rho: number, area: number): number {
    if (!(thrust > 0) || !(area > 0)) return 0;
    return Math.sqrt(thrust / (2 * rho * area));
}

/** 0 at 0, 1 at 1, flat at both ends (u clamped to 0..1). */
function smoothstep(u: number): number {
    const v = u < 0 ? 0 : u > 1 ? 1 : u;
    return v * v * (3 - 2 * v);
}

/** The wake bump over the descent ratio x of an open rotor: 0 outside WAKE_LO..WAKE_HI, 1 at WAKE_PEAK. */
export function wakeBump(x: number): number {
    if (!(x > WAKE_LO) || !(x < WAKE_HI)) return 0;
    return x <= WAKE_PEAK ? smoothstep((x - WAKE_LO) / (WAKE_PEAK - WAKE_LO)) : smoothstep((WAKE_HI - x) / (WAKE_HI - WAKE_PEAK));
}

/**
 * The wake intensity 0..1: `down` = airspeed along the rotor axis, positive when the air comes up
 * through the disk from below (the craft sinks along its thrust axis), m/s; `side` = airspeed in the
 * rotor plane, m/s; `vi` = induced velocity (inducedVelocity), m/s; `shift` = WAKE_DUCT_SHIFT on a ducted
 * craft, else 0.
 */
export function wakeIntensity(down: number, side: number, vi: number, shift = 0): number {
    if (!(vi > 0) || !(down > 0)) return 0;
    const b = wakeBump(down / vi - shift);
    if (b === 0) return 0;
    const mu = side / vi;
    return b / (1 + WAKE_SIDE_FADE * mu * mu);
}

/** The thrust fluctuation of rotor `rotor` (0..3) at a tick: zero mean, SD 1, its own stream per rotor. */
export function wakeRotorNoise(rotor: number, tick: number): number {
    const a = smoothNoise(WAKE_SEED, 2 * rotor, tick, WAKE_NOISE_TICKS[0]);
    const b = smoothNoise(WAKE_SEED, 2 * rotor + 1, tick, WAKE_NOISE_TICKS[1]);
    return (a + b) / WAKE_NOISE_NORM;
}
