# Provenance — where every formula, constant and borrowed file comes from

ShramkoGSFPV is MIT-licensed. This page lists everything that was not invented here, so anyone can check that no incompatible code is included.

## Flight controller behaviour (Betaflight 4.5.1, GPL-3.0)

The formulas and constants below were **read** from Betaflight 4.5.1 (tag `4.5.1`, commit `77d01ba3b76a22909d5f09cb0628820141f95eaa`) and **re-implemented** in TypeScript. No Betaflight code was copied into this repository.

| What | Betaflight source | Our file |
|---|---|---|
| Rate curves: Betaflight, Actual, KISS, Raceflight; final clamp to `rate_limit` | `src/main/fc/rc.c` — `applyBetaflightRates`, `applyActualRates`, `applyKissRates`, `applyRaceFlightRates`, `calculateSetpointRate` | `packages/sim-core/src/rates.ts` |
| `RC_RATE_INCREMENTAL` 14.54, setpoint limit 1998 °/s | `rc.c`, `rc.h` | `rates.ts` |
| Rate curve Quick (v0.7) and its `quickrates_rc_expo` branch; per-type limits of R / S / E (`ratesSettingLimits`, Quick 255 / 200 / 100) | `rc.c` — `applyQuickRates`; `src/main/fc/controlrate_profile.c`; `src/main/cli/settings.c` (`quickrates_rc_expo`, `lookupTableRatesType`) | `rates.ts`, `bfdiff.ts` |
| Mode switches: `aux` line format and permanent box ids, range test `start <= value < end` on the 25 µs grid of 900–2100, OR / AND logic, Angle over Horizon, the `map` line (v0.7) | `src/main/cli/cli.c` (`printAux`, `cliAux`, `printMap`); `src/main/fc/rc_modes.c` / `.h` (`isRangeActive`, `updateMasksForMac`); `src/main/msp/msp_box.c`; `src/main/fc/core.c` (`processRxModes`); `src/main/rx/rx.c` / `.h` (`parseRcChannels`, `MAX_AUX_CHANNEL_COUNT`) | `packages/sim-core/src/bfaux.ts`, `packages/input/src/switches.ts` |
| PID scales: P 0.032029, I 0.244381, D 0.000529, FF 0.013754 × F × 0.01 | `src/main/flight/pid_init.c` lines 275–278 | `packages/sim-core/src/sim.ts` |
| I-term accumulation `Ki · dT · error`, I-term relax (setpoint, 15 Hz, 40 °/s) | `src/main/flight/pid.c` | `sim.ts` |
| D on measurement `−Kd · Δgyro · f` | `pid.c` line 1024 | `sim.ts` |
| Default gyro filters (PT1 250 Hz dynamic minimum, PT1 500 Hz) | `src/main/sensors/gyro.h` | `sim.ts` |
| Default D-term filters (PT1 75–150 Hz dynamic, PT1 150 Hz) | `src/main/flight/pid.h` | `sim.ts` |
| Quad X mixer table and motor order; airmode throttle placement | `src/main/flight/mixer.c`, `mixer_init.c` | `sim.ts` |
| Default rates (Actual 7/67/0), PIDs (roll 45/80/40/120, pitch 47/84/46/125, yaw 45/80/0/120), idle 5.5 % | Betaflight 4.5 defaults | `packages/sim-core/presets/*.json` (`source: "bf-default"`) |

**Reference vectors.** `packages/sim-core/test/vectors/rates-bf451.json` holds numbers only: the four rate functions were extracted by a script from the downloaded `rc.c`, compiled in a harness **outside this repository** (zig cc 0.16.0 / clang 21.1.0, `-O2 -ffp-contract=off -fno-fast-math`, `float` promoted to `double` and `f` suffixes removed from literals so the comparison is about formulas, not float32 rounding), and evaluated on 40 parameter sets × 47 stick positions. Our implementation matches all 1880 values exactly; a deliberately broken curve (x³ instead of x⁵ in Actual) misses by up to 280 °/s. The float32 build differs from the reference by at most 6.3e-4 °/s.

**Quick reference vectors (v0.7).** `packages/sim-core/test/vectors/rates-bf451-quick.json` holds numbers only: the Quick rates function of the downloaded 4.5.1 `rc.c` was transcribed statement by statement into a short Python script **outside this repository** (IEEE double like the table above, the firmware's `uint16_t` products `rcRate = 2 × rc_rate` and `maxDPS = MAX(10 × srate, rcRate)` kept as integers) and evaluated on 24 parameter sets (both `quickrates_rc_expo` branches, the 0.01 clamp of the super factor, `srate` below the centre sensitivity, rate limits) × 47 stick positions. Our implementation matches all 1128 values within 1e-9 °/s; the expo on the wrong branch and a centre sensitivity of R instead of 2R both miss by more than 1 °/s (`packages/sim-core/test/rates-quick.test.ts`).

**Rates editor (v0.7).** The field names, display scales and steps per type (RC Rate 0.01–2.55, Actual Center Sensitivity / Max Rate in 10 °/s steps, Raceflight Rate in 10 °/s and Acro+ 0–255, ...) were read from Betaflight Configurator 10.10.0 (`src/js/tabs/pid_tuning.js`, GPL-3.0) and re-implemented in `packages/sim-core/src/rates-edit.ts`; no Configurator code was copied. Converting a curve to another type is our own (a least-squares fit; the Configurator resets to defaults instead).

## Collision (SuperSplat viewer, MIT)

`packages/collision/src/vendor/` contains three files copied from [playcanvas/supersplat-viewer](https://github.com/playcanvas/supersplat-viewer) v1.35.0 (commit `e669b5d785a80571763bdf272849bcb8e50a5eb8`), MIT, Copyright (c) 2011-2026 PlayCanvas Ltd. The logic is unchanged; the only edits are an attribution header and two extra exports. Details: [`packages/collision/UPSTREAM.md`](../packages/collision/UPSTREAM.md).

## Deterministic math (fdlibm / musl)

`packages/sim-core/src/dmath.ts` ports the algorithms and coefficients of `__sin`, `__cos`, `__rem_pio2` (medium path), `atan`, `atan2` and `exp` from fdlibm as distributed in musl libc. fdlibm: "Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved. Developed at SunPro, a Sun Microsystems, Inc. business. Permission to use, copy, modify, and distribute this software is freely granted, provided that this notice is preserved." musl: MIT.

## Physical numbers

Every preset number carries its own `source` (`manufacturer`, `measured:<who>`, `estimate`, `bf-default`) and, where it exists, a link. Estimates are labelled as estimates everywhere they are shown.

**v0.8 presets** (`nazgulf5v3-6s`, `machr5sport-6s`, `taurusx8-komodo-6s`): weights, geometry, motors, props and packs from iFlight's published specifications (the RED Komodo 6K body weight from its rental and dealer listings); thrust-to-weight, inertia, motor lag, drag and the cinelifter's PID and angle feed-forward are estimates, each derivation written out with its sources in [`research/drones-v08.md`](research/drones-v08.md).

**Prop wash** (`packages/sim-core/src/wake.ts`, v0.8): our own model from textbook momentum theory (induced velocity `sqrt(T / (2 rho A))`, the vortex-ring band of axial descent between about 0.25 and 2 induced velocities). No code or table from another simulator. Its turbulence uses the seeded noise of `wind.ts` (murmur3's 32-bit finaliser constants, public domain).

## Scenes

No scene data is part of this repository except the collision fixture of scene `39e63ce9` (scan by Andrii Shramko, CC BY 4.0), see [`fixtures/39e63ce9/ATTRIBUTION.md`](../fixtures/39e63ce9/ATTRIBUTION.md). Scenes are loaded at runtime from the SuperSplat CDN.

## What is not used

No code from SplatFPV, Liftoff, VelociDrone, DRL or any other simulator. No research-licensed Gaussian splatting code (Inria `diff-gaussian-rasterization` and derivatives).
