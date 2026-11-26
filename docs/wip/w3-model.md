# w3-model: a physically sized prop wash on every craft, and the Air65 class whoops

Lane w3-model of train 5. Branch w3-wash (on top of lane w3-wash: docs/wip/w3-wash.md, tools/bench/src/w3-wash-run.ts).
Inputs: docs/wip/w3-wash.md "## Findings"; the research note "ShramkoGSFPV - prop wash and 65 mm whoops - sources"
(owner's vault, read 2026-11-26: sections on VRS, induced velocity by class, the preset table and the three
"Addendum" sections). The blackbox note (measured numbers from real whoop logs) does not exist yet: nothing here
comes from a real flight log.

## Status

- [x] S1 the model: Design; wake.ts per-rotor shake + mean loss sized by sources; every preset carries
      prop_diameter_mm and ducted (the v0.8 wake_loss / wake_shake fields removed); unit tests
      packages/sim-core/test/model-wake.test.ts (7 pass); model-drones-v08 and drone-ranges wake cases updated
      (pass); neg_control.py on origin/main: NEG OK (7 of 7 fail there). Commit 3868ba8c.
      Left red on purpose for S2: tools/bench/test/a6-reference.test.ts (hash moves by decision 5),
      sim-core b12-rewind (2) and log-v2-compat (2): recorded lives of older builds replayed by the new model.
- [ ] S2 the presets and determinism: air65-1s corrected by the note; presets Air65 Champion and Air65 II Champion;
      SIM_CORE_VERSION bump; the new A6 hash everywhere the old one is named; gates
- [ ] S3 the numbers and the pilot: w3-wash-run.ts before/after table for default, Air65, 5-inch; page probe
      (`?render=off`) that the Prop wash row changes the flight and 0 switches it off; For the lead

## Design

1. Scale. x = v_d / v_i: v_d = airspeed along the body's up axis (sinking positive), v_i = sqrt(T0 / (2 rho A)) with
   T0 the clean-air thrust the rotors make now and A = 4 disks of the preset's prop_diameter_mm (the X8's coaxial
   pairs share one disk). In a hover T0 = m g, so v_i = v_h of the craft's own mass, rotor size and count.
2. Band (Veismann, Yos, Gharib 2022, 152 mm rotor, measured): no effect below x = 0.4 (Mambo 63 g onset 0.39) and
   above 1.7, peak at 1.25 (measured 1.2 to 1.4). Bump b(x): smoothstep up 0.4..1.25, smoothstep down 1.25..1.7.
3. Duct (Pickles et al. 2023, qualitative "small delay" of the onset): the whole band moves right by 0.15 on a
   ducted craft (ESTIMATE, the note's 0.1 to 0.2; no number in the paper). Same loss and shake (no source).
4. Sideways fade: k = b / (1 + 4 mu^2), mu = v_side / v_i (kept; ESTIMATE, no quantitative source).
5. Mean loss: every rotor's thrust x (1 - 0.20 k). 0.20 = the base blade of Veismann 2022 at x 1.2 (measured,
   range 0.06 to 0.35 by blade shape) and NASA 2021 multicopter "up to 20 %". Not a per-preset number.
6. Shake: each rotor's thrust x (1 + 0.10 k n_i(t)), n_i an own seeded noise per rotor with SD 1, zero mean.
   0.10 = SD of thrust over thrust at the peak (Veismann 2022 fig. 9/10 0.09 to 0.12; NASA 2021 0.1 at 6 m/s).
   The torque noise comes out of the mixer geometry (roll, pitch, and yaw through kappa); the rate PID fights it.
   Spectrum: two octaves, knots every 40 and 8 ticks at 1 kHz (content about 10 to 100 Hz; ESTIMATE: pilots' band
   20 to 100 Hz on 5-inch, Stack 2004 20 to 50 rotor revolutions = 7 to 23 Hz on a whoop; no whoop number).
7. Multipliers: physics.propWash (0 off, 1 default, up to 2) times an optional preset `wake_scale` (only with a
   source; none today) scales loss and shake; the loss is capped at WAKE_LOSS_MAX 0.9. 0 skips the term: the base
   flight bit for bit. The old per-preset wake_loss / wake_shake fields are gone (refused when found).
8. Not modelled: the SD 0.03 of thrust outside the band (free-stream turbulence, not wash); Reynolds effects at 31 mm.

## Estimates

| Number | Value | Why no source |
|---|---|---|
| WAKE_DUCT_SHIFT | +0.15 in x | Pickles 2023 gives only a qualitative delay; the note's 0.1 to 0.2 |
| WAKE_SIDE_FADE | 4 (k / (1 + 4 mu^2)) | no quantitative fade curve found; helicopter lore 0.5 to 1 v_h |
| Shake spectrum | octaves at 40 and 8 ticks | no measured whoop or 5-inch frequency; pilots' 20 to 100 Hz band |
| Loss and shake on 31 to 56 mm and ducted rotors | same as 152 mm open | no measurement below 152 mm |

## Claims

1. Every preset has prop wash at the default multiplier, the size the sources give (mean loss 0.20, per-rotor SD 0.10
   at the peak), placed by its own v_h and duct; in a held descent at the peak ratio the mean loss of the Air65,
   the Pavo20 Pro and the Nazgul F5 is 0.20 +- 0.02 (measured range 0.06 to 0.35) and exactly 0 outside the band;
   the four rotors fluctuate independently (|r| < 0.05), SD 0.06 to 0.14, and repeat bit for bit; multiplier 0 =
   no term. Command: `npx vitest run packages/sim-core/test/model-wake.test.ts`. Last result: 7 passed; on
   origin/main 7 failed (neg_control.py NEG OK).

## Not verified

- No person, phone, real controller or real blackbox log took part. No pilot compared it with a real quad.

## For the lead

## Cost notes

- S1: the most replies went to rewriting the v0.8 wake tests (model-drones-v08, drone-ranges) and one neg_control
  run lost to calling npx as an argv (Windows needs the whole test command as ONE quoted string).
