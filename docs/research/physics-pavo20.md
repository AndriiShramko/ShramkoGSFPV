# Item 21: why the Pavo20 presets feel wrong (drift and yaw), and how to fix them

Research notes, 2026-09-25. Scope: the first two drones in the picker, `pavo20pro-3s` (Pavo20 Pro, the default) and `pavo20pro2-3s` (Pavo20 Pro II 3S). Andrii flies both a lot in real life. He says they either skid a lot or the yaw reaction is too strong (brief item 21: "either it skids a lot, or the yaw reaction is too strong"). He was flying ACRO; see brief item 15.

Nothing in the repo was changed. Scratch files are in `C:/dev/ShramkoGSFPV/.cache/v02/`:

- `physics-probe.ts`: runs the real `packages/sim-core` in Node, with modes `base | bf | yaw | skid | drag`.
- `probe-cda2.ts`: checks the existing drag setting.
- Outputs: `probe-base.txt`, `probe-bf.txt`, `probe-yaw.txt`, `probe-skid.txt`, `probe-drag.txt`.
- Manufacturer CLI dumps: `cli/*.txt`.
- Betaflight 4.5 source excerpts: `bf/`.

Run the probe with `export PATH=/c/Users/andri/node-v22:$PATH; ./node_modules/.bin/tsx .cache/v02/physics-probe.ts <mode>` from the repo root.

## TL;DR

1. **The skidding comes from a missing force, not a wrong number.** The model has no linear drag from the rotors or the ducts. The only drag it has is body drag that grows with speed squared, which is almost nothing at whoop speeds.
   - Measured coast-down from 10 m/s to 2 m/s: **18.0 s over 72.6 m**. Down to 0.5 m/s: 47.6 s over 105 m.
   - After a 90 deg yaw at 11.5 m/s, the sideslip stays above 30 deg for **3.8 s**.
   - The existing "Drag x" setting cannot fix this. At its maximum (x2) the coast-down still takes 9.1 s over 36.5 m.
   - Ducts ingest air and turn it downwards, which removes the in-plane momentum. The resulting drag is linear in velocity and scales with rotor speed. Momentum theory gives up to 0.89 1/s for these ducts. The only measurement I found is on an open-prop 610 g quad: 0.24 to 0.54 1/s.
   - Prototype at 0.6 1/s: coast 10 to 2 m/s takes 2.3 s over 11 m, and the sideslip clears 30 deg in 1.5 s.
2. **Self-level (angle) mode is 2 to 3x too aggressive near centre stick.** Our stick-to-tilt mapping is linear (stick x 55 deg). Betaflight 4.5 maps tilt through the acro rate curve: `angle_limit(60) x setpoint(x) / maxRate`.
   - At quarter stick, ours tilts 13.8 deg and Betaflight tilts 4.9 deg.
   - At half stick, ours tilts 27.5 deg and Betaflight tilts 16.6 deg.
   - This matters because item 23 makes self-level the default for everyone.
3. **Yaw overshoots by 30 to 43% in the sim.** On a full yaw step the peak is 901 deg/s against a 670 deg/s setpoint, and there is about 16 deg of bounce-back after release.
   - The cause is that the sim has no reaction torque from the spinning prop and rotor mass (J_r * d omega/dt). Yaw therefore starts slowly: t90 is 80 to 95 ms, against 38 to 40 ms for roll. Meanwhile the I-term winds up.
   - It is **not** feed-forward. The manufacturer's Pavo20 Pro tune has FF = 0 and still overshoots 30%.
   - Prototype with J_r = 2e-7 kg m^2: t90 drops to 21 ms and overshoot to 6%.
   - The total heading change is correct in every case (ratio 1.00). The error is the transient: the craft whips past the target and bounces back.
4. **The preset tunes are generic Betaflight defaults, not what BetaFPV ships.** The official BetaFPV CLI dumps differ in these values:
   - PIDs.
   - Feed-forward: 0 on the Pro, 41 to 53 on the Pro II, against our 120.
   - Motor idle: 10%, or 8% on the AT32 boards, against our 5.5%.
   - Throttle curve on the Pro: `thr_mid 65`, `thr_expo 20`, against our 50/0.

   Rates are the same as ours: Betaflight 4.5 default ACTUAL 7/67/0, which is 670 deg/s. So **the rates are not what makes yaw "too strong"**, unless Andrii's own quads run custom rates.
5. **Fastest win with no code:** Andrii pastes `diff all` from each of his two quads into the existing "Import rates from Betaflight" dialog. It applies rates, PIDs and the throttle curve (`main.ts:437-441`), but **not idle**.
   - Tested with `probe-parse.ts` on the 6 official BetaFPV dumps: **5 of 6 parse with 0 errors**.
   - **The newest Pro II firmware (BetaFPV BF 2026.6.1, 2026-09-20) is refused.** The error reads "Betaflight 2026.6 is not supported: the import knows 4.3, 4.4, 4.5 and 2025.12".
   - Oddly, that dump's version line has the same build date and hash (`Aug 10 2026 / 03:56:33 (7348054f2)`) as BetaFPV's 2025.12.5 build.
   - If Andrii's Pro II is on the latest BetaFPV firmware, his paste will fail. The `bfdiff.ts` owner should decide whether to accept 2026.x with 2025.12 semantics.

## (a) What the presets contain today

Sources: `packages/sim-core/presets/*.json`, `params.ts` and `sim.ts`.

| Field | pavo20pro-3s | pavo20pro2-3s | Source tag |
|---|---|---|---|
| AUW | 153 g | 161 g | estimate |
| TWR | 5.0 | 5.9 | manufacturer |
| Tmax per motor | 191 g | 237 g | derived |
| KV / cells | 7200 / 3S | 7200 / 3S | manufacturer |
| Inertia (roll/pitch, yaw) | 1.11e-4, 1.71e-4 kg m^2 | 1.17e-4, 1.81e-4 | estimate |
| motor tau | 15 ms | 15 ms | estimate |
| kappa (yaw torque / thrust) | 0.0075 m | 0.0075 m | estimate |
| idle | 5.5 % | 5.5 % | bf-default (550) |
| CdA horizontal / vertical | 55 / 150 cm^2 | 55 / 150 cm^2 | estimate, "tune against top speed" |
| rates | ACTUAL 7/67/0 (670 deg/s) | same | bf-default |
| PID R / P / Y (P, I, D, F) | 45/80/40/120, 47/84/46/125, 45/80/0/120 | same | bf-default |
| throttle | mid 50, expo 0 | same | bf-default |

What the model contains:

- Thrust is `Tmax*w^2`, where `w` is the motor output after idle. Motors follow a first-order lag with tau.
- Yaw torque is `kappa*T` only.
- Drag is `0.5*rho*|v|*CdA_axis*v_body`, quadratic only, with no linear or rotor term.
- It does **not** model:
  - rotor or duct momentum drag;
  - prop and rotor inertia torque;
  - thrust loss with axial inflow;
  - duct pitching moment;
  - prop wash or vortex ring state;
  - ground effect;
  - Betaflight's I-term windup attenuation at 85% mix range;
  - RC smoothing.
- Angle mode: `sim.ts:213-222`, tilt target = `ch * 55 deg`, gain 5.

## (b) Manufacturer data (with sources)

### Official BetaFPV CLI dumps

These are text files from the BetaFPV Support Center. I read them in full and parsed them with our own `parseBetaflightDiff`.

- Pavo20 Pro: https://support.betafpv.com/hc/en-us/articles/35964224026521
  - `BF405 4.5.0_Pavo20 pro_20A v1.0_ELRS_20241216.txt`, plus the TBS 20240729 and SBUS 20250610 files. All three have identical tuning.
- Pavo20 Pro II 3S: https://support.betafpv.com/hc/en-us/articles/52638111624217
  - `BF4.5.3 F405_20A_Pavo20 Pro II 3S_ELRS 20251230.txt` for the F405 board.
  - `BF2025.12.5 ... 20260810.txt` and `BF2026.6.1 F435 ... 20260920.txt` for the AT32F435 board.

| Setting | Pavo20 Pro (BF 4.5.0) | Pavo20 Pro II 3S, F405 (BF 4.5.3), profile 0 "O4 Pro" | Pro II, AT32 (BF 2025.12.5 / 2026.6.1), profile 0 | Pro II profile 1 "DJI O4" | Our preset |
|---|---|---|---|---|---|
| rates | default ACTUAL 7/67/0 | default | default | default | same |
| roll P/I/D/F | 54/111/44/**0** | 51/105/46/41 | 53/110/46/43 | 45/92/37/23 | 45/80/40/120 |
| pitch P/I/D/F | 68/139/60/**0** | 64/133/63/51 | 67/139/63/53 | 58/120/53/31 | 47/84/46/125 |
| yaw P/I/D/F | 54/111/0/**0** | 51/105/0/41 | 53/110/0/43 | 45/92/0/23 | 45/80/0/120 |
| idle | dshot_idle_value 1000 = **10 %** | 1000 = 10 % | motor_idle 800 = **8 %** | same | 5.5 % |
| throttle curve | **thr_mid 65, thr_expo 20** | default 50/0 | default | default | 50/0 |
| D boost | none (simplified_dmax_gain 0) | none | none | none | none |
| TPA | tpa_rate 60, breakpoint 1250 | breakpoint 1280 | rate 70, breakpoint 1280 | rate 60, breakpoint 1240 | not modelled |
| D-term LPF | 86..172 Hz dyn, LPF2 172 Hz | same | same | same | hard-coded 75..150 / 150 |
| gyro LPF2 | 550 Hz, 1 dyn notch 250..500 | same | same | same | 250/500 PT1 |
| bidirectional DShot | ON, 12 poles | ON | ON | ON | n/a (useful for blackbox) |
| pid_process_denom | 2 | 2 | 2 | 2 | n/a |

### Weights and hardware

- **Pavo20 Pro:**
  - Motors LAVA 1104 7200KV; Gemfan 2218 3-blade props; wheelbase 93.7 mm; F4 2-3S 20A AIO.
  - Manufacturer TWR is "greater than 5:1".
  - Weight is 66.3 g (O3 PNP) or 71 g (O4 Pro PNP), from https://betafpv.com/products/pavo20-pro-brushless-whoop-quadcopter
  - Oscar Liang measured 70.1 g without the VTX and 108 g with the O3: https://oscarliang.com/betafpv-pavo20-pro/
  - Oscar Liang measured 107 g with the O4 Pro, and AUW about 150 g with 3S 550: https://oscarliang.com/betafpv-pavo20-pro-dji-o4-pro/
  - LAVA 3S 550 mAh battery: **43.2 g** (https://betafpv.com/products/lava-2s-3s-4s-550mah-75c-battery-2pcs).
- **Pavo20 Pro II:**
  - 116.2 g with the O4 Pro and 72.6 g PNP; wheelbase 93.9 mm; Gemfan D2.2 3-blade props.
  - 3S uses 7200KV motors and TWR **5.9**. 4S uses 5500KV and TWR 5.5. Source: https://betafpv.com/products/pavo20-pro-ii-brushless-whoop-quadcopter
  - LAVA II 3S 580 mAh battery: **42 g** (https://betafpv.com/products/lava-ii-3s-battery).
  - unmanned.tech measured 113.4 g stock and 155.9 g with a LAVA 550 3S: https://blog.unmanned.tech/betafpv-pavo20-pro-ii-review-stable-whoop/
- **Motor, LAVA 1104** (https://betafpv.com/products/lava-series-1104-brushless-motors):
  - 5.3 g; 7200KV rated 122.5 W and 10.2 A.
  - "with the Gemfan D2.2 3-Blade Propellers, the max thrust can reach more than 230g".
  - Efficiency 4.7 g/W at low throttle and 1.9 g/W at full throttle.
  - Consistency check: 4 x 233 g / 158 g gives TWR 5.9, which matches the Pro II figure.
  - The Pro (2218 props) has no per-motor figure, only ">5:1". If it also reaches 230 g, its TWR would be 6.1.
- **Hover:**
  - Pavo20 Pro II **4S** hovers at about 28% and weighs 168.3 g with 4S 580: https://oscarliang.com/betafpv-pavo20-pro-ii-4s/
  - The original Pavo20 (2-blade, 1103) hovers at about 30%: https://oscarliang.com/betafpv-pavo20-cinewhoop/
  - **I found no hover figure for the 3S Pro or the 3S Pro II.**
- **Top speed:**
  - The only number found is Oscar's **estimate** of "roughly 100 km/h" for the Pro II 4S. It is not GPS-measured (same URL as above).
  - A GPS speed test of the Pavo20 Pro exists: https://www.youtube.com/watch?v=RhtqFebsyW8 and https://www.youtube.com/shorts/Yh91tZyQatE (SquaddingQuads / BoyWonderFPV, 2025-10-25/26). **I could not extract the number.** It is not in the description, and the caption endpoint returned empty.
- **Handling quotes** (short):
  - Pro II 4S: "very little propwash".
  - Pro: "handles propwash better".
  - Pro II V2 reader comment: "glide around the place at 0 throttle".

  None of them measures braking or drift.

### Physics references

- Faessler, Franchi, Scaramuzza, "Differential Flatness of Quadrotor Dynamics Subject to Rotor Drag", IEEE RA-L 2018, https://arxiv.org/abs/1712.02402. I read the PDF text.
  - The model is linear rotor drag `D = diag(dx, dy, dz)`, mass-normalised.
  - Identified values on a 610 g, 6-inch, TWR 4 **open-prop** quad: dx = 0.425 to 0.544 1/s, dy = 0.236 to 0.386 1/s, dz of about 0.
  - They note that the drag physically scales with rotor speed, which is about sqrt(thrust).
- Martin and Salaun, "The true role of accelerometer feedback in quadrotor control", ICRA 2010, http://vigir.missouri.edu/~gdesouza/Research/Conference_CDs/IEEE_ICRA_2010/data/papers/0918.pdf. Only the abstract was read.
  - Rotor drag puts velocity into the x/y accelerometer readings.
  - This is the basis of the blackbox method in (d).
- Momentum drag of a duct, my derivation, which needs checking.
  - Mass flow through a duct is `mdot = rho*A*v_i`, with `v_i = sqrt(T/(rho*A))` for exit area ratio 1. The flow leaves axially, so in-plane momentum `mdot*V` is removed.
  - For the Pavo20 Pro: A per duct is about 2.45e-3 m^2 (2.2-inch prop), and T per duct at hover is 0.375 N.
  - That gives v_i = 11 m/s and total `mdot` = 0.137 kg/s.
  - So D/(m*V) is **0.89 1/s**, equivalent to `sqrt(g*rho/disk_loading)`.
  - The same formula applied to Faessler's open-prop quad gives about 0.85 1/s ideal, against 0.4 to 0.54 measured, a ratio of about 0.5 to 0.65. For the Pavo, the plausible band is therefore **0.45 to 0.9 1/s**.
  - Ducted-fan literature describes large lateral momentum drag in crossflow, for example the PSU thesis "Aerodynamic Experiments on a Ducted Fan in Hover and Edgewise Flight", https://etda.libraries.psu.edu/catalog/9585. **I found it by search and did not read it.**
- Betaflight 4.5 source, `4.5-maintenance`. Copies are in `.cache/v02/bf/`; they were read, not copied.
  - `pid.c:136` `itermWindupPointPercent = 85`; `pid.c:138` `angle_limit = 60`; `pid.c:225` `angle_earth_ref = 100`; `PID_LEVEL {50,75,75,50}`, so the angle gain is 5.
  - `pid.c:377-420` `pidLevel()`: `angleTarget = angleLimit * currentPidSetpoint / maxRcRate`, followed by a PT3 at 50 Hz.
  - `pid.c:858-862` windup attenuation `dynCi = clamp((1 - motorMixRange) / 0.15, 0, 1)`.
  - `acceleration_init.c:142` `acc_lpf_hz = 25`; `blackbox.c:99` default sample rate 1/4.
  - `debug.c:106` has the debug mode `ATTITUDE`, with roll/pitch in `debug[0..1]` in decidegrees (`imu.c:747-748`).
  - Blackbox fields include `gyroADC`, `accSmooth`, `motor[]`, `eRPM[]`, `setpoint[]`, `rcCommand[]`, `vbatLatest` and `amperageLatest`.

## (c) Measurements of our sim-core (Node, no world, fresh pack)

### Hover and rates

| | Pavo20 Pro (ours) | Pavo20 Pro II 3S (ours) | Real |
|---|---|---|---|
| hover motor output | 0.393 | 0.349 | n/a |
| hover throttle (curve output) | 35.8 % at full pack, 41.5 % at half | 31.1 % / 36.2 % | Pro II 4S about 28 %, original Pavo20 about 30 % (OSD); no 3S Pro figure |
| max rate at full stick | 670 deg/s on all axes | same | same (BetaFPV keeps the default rates) |

With BetaFPV's 10% idle, the hover throttle drops by about 3.5 points (e.g. Pro 35.8 to about 32.5%). That is closer to the reports but still unverified.

### Rate step responses (mode `base` and `bf`)

Setpoint 670 deg/s at full stick and 185 at half.

| | t63 / t90 | peak (overshoot) | max ang. acc |
|---|---|---|---|
| Pro roll, full step | 17 / 40 ms | 680 (1.5 %) | 37,600 deg/s^2 |
| Pro **yaw**, full step | 71 / 95 ms | **901 (34.5 %)** | 7,467 deg/s^2 |
| Pro yaw, half, 80 ms thumb ramp at 16 ms frames | 90 / 105 ms | 237 (28 %) | n/a |
| Pro **yaw** with BetaFPV tune (FF 0) | 71 / 95 ms | 873 (30 %) | n/a |
| Pro II yaw, full step | 61 / 80 ms | 915 (36.6 %) | 9,168 deg/s^2 |
| Pro II yaw with BetaFPV 4.5.3 tune | 61 / 80 ms | 894 (33 %) | n/a |

**Yaw pulses** (mode `yaw`). A half stick held for 300 ms gives 66.4 deg of heading, exactly as commanded (ratio 1.00). A full-stick 200 ms flick gives the right total but peaks at 901 deg/s and bounces back 15.8 deg after the stick is centred.

**With prop/rotor inertia added outside the Sim** (`jRotor`, applied as a yaw impulse per 1 ms step, Pro):

| J_r kg m^2 | full step t90 | overshoot | bounce-back after a full flick |
|---|---|---|---|
| 0 (today) | 95 ms | 34.5 % | 15.8 deg |
| 1e-7 | 49 ms | 14.1 % | 6.5 deg |
| **2e-7** | **21 ms** | **5.6 %** | **0.8 deg** |
| 3e-7 | 12 ms | 3.9 % | 1.9 deg |

How I estimated J_r (unverified): the prop is about 1.0 to 1.2 g with a radius of gyration of about 10 mm, giving about 1.2e-7. The 1104 bell is about 1.8 g at about 6.5 mm, giving about 0.8e-7. The total is about **2e-7**, with a range of 1e-7 to 3e-7.

Why this term matters so much: a 0.4 motor-output swing is about 2,500 rad/s. That swings `4 * J_r * d omega` = 2e-3 kg m^2/s of angular momentum into the body. Divided by I_yaw of 1.7e-4, that is about 670 deg/s. On a whoop, prop inertia **is** the yaw kick.

**kappa check:** 122.5 W electrical at 230 g, with 75 to 80% motor efficiency at 45 to 57 krpm loaded, gives Q/T of about 0.0071 to 0.0089 m. Our 0.0075 is fine.

### Coast-down and skid (mode `drag`, `skid`, `probe-cda2.ts`)

Level (angle mode, sticks centred) at hover throttle, forward speed set to 10 m/s:

| model | 10 to 5 m/s | 10 to 2 m/s | distance to 2 m/s | to 0.5 m/s |
|---|---|---|---|---|
| today (CdA 55) | 4.5 s | **18.0 s** | **72.6 m** | 47.6 s / 105 m |
| today with Drag x2 (the max of the existing setting) | n/a | 9.1 s | 36.5 m | n/a |
| + momentum drag 0.3 1/s | 1.5 s | 4.0 s | 18.8 m | 8.3 s |
| + 0.45 | 1.1 s | 2.9 s | 13.9 m | 5.8 s |
| **+ 0.6** | **0.9 s** | **2.3 s** | **11.0 m** | **4.5 s / 13.4 m** |
| + 0.9 | 0.66 s | 1.6 s | 7.8 m | 3.1 s |

The Pro II numbers are within 3% of these.

**Skid test.** Angle mode, cruise at 20 deg tilt, then a 90 deg yaw at half stick while still holding pitch:

| drag | cruise speed | sideslip over 30 deg after the yaw | sideslip over 15 deg |
|---|---|---|---|
| today | 11.5 m/s | **3.8 s** | 6.1 s |
| 0.3 | 7.2 m/s | 2.2 s | 3.5 s |
| 0.6 | 5.0 m/s | 1.5 s | 2.3 s |
| 0.9 | 3.9 m/s | 1.1 s | 1.7 s |

The cruise speed at a given tilt is a second observable. Andrii can judge it, and the blackbox can measure it.

### Top speed

Full throttle, pitch bisected for zero climb, 16 s runs:

| model | Pro | Pro II 3S |
|---|---|---|
| today | 97 km/h at 58.7 deg pitch | 107 km/h at 62.2 deg |
| + momentum drag 0.6 | 94 km/h at 78.5 deg | 105 km/h at 80 deg |
| + 0.6, CdA x0.6, axial-inflow thrust loss (zero-thrust speed 60 m/s) | 90 km/h at 76 deg | 96 km/h |
| + 0.6, CdA x0.4, same loss | 103 km/h at 77 deg | 110 km/h |

Momentum drag barely changes top speed. At full speed the craft is pitched about 78 to 80 deg, so the flow runs mostly along the duct axis. That steep attitude is realistic for whoops at full speed.

The axial-inflow term ties top speed to prop pitch instead of an inflated CdA. The zero-thrust speed of 60 m/s comes from the 2218 prop: 1.8-inch pitch at 59 krpm is 45 m/s of geometric pitch speed, and zero thrust sits about 1.2 to 1.3x above that. It is an estimate.

### Angle mode tilt for stick x

Mode `yaw`, `angleMap`:

| stick | 0.1 | 0.25 | 0.5 | 0.75 | 1.0 |
|---|---|---|---|---|---|
| ours (x * 55 deg) | 5.5 | **13.8** | **27.5** | 41.3 | 55 |
| Betaflight 4.5 (60 * setpoint/670) | 1.2 | **4.9** | **16.6** | 34.9 | 60 |

Horizontal acceleration is `g*tan(tilt)`. At quarter stick ours accelerates 2.8x harder, and at half stick 1.7x harder.

## (d) Proposed corrections

Each change below has its source. There are two kinds:

- **Data changes** are preset JSON only and cheap. They change no model code, but they do change traces, so the logs' `configHash` changes.
- **Model changes** touch `sim-core` and need `SIM_CORE_VERSION` bumped. Old replays will then refuse to load (`session.ts:518`). The `tools/bench/src/a4-physics.ts` checks also need updating: moonHover `motor 0.18` depends on TWR and idle, and `pidStepCheck` covers roll.

### D1. Preset data (both drones)

| Field | Pavo20 Pro: now, then proposed | Pavo20 Pro II 3S: now, then proposed | Source |
|---|---|---|---|
| battery_mass_g | 45 est, then **43.2** | 45 est, then **42** | manufacturer battery pages above |
| auw_g | 153, then **151** (108 measured + 43.2) | 161, then **158** (116.2 + 42) | Oscar Liang measured / manufacturer; unmanned.tech measured 155.9 with 550 mAh |
| motor_idle | 0.055, then **0.10** | 0.055, then **0.10** on F405 (4.5.3) or **0.08** on AT32 (2025.12+) | BetaFPV CLI `dshot_idle_value 1000` / `motor_idle 800` |
| throttle | 50/0, then **mid 65, expo 20** | unchanged 50/0 | BetaFPV CLI rateprofile 0 |
| pid_roll / pitch / yaw | BF defaults, then **54/111/44/0, 68/139/60/0, 54/111/0/0** | BF defaults, then **51/105/46/41, 64/133/63/51, 51/105/0/41** (F405 "O4 Pro" profile) | BetaFPV CLI profile 0 |
| rates | unchanged | unchanged | CLI keeps BF 4.5 defaults; re-tag the source as "manufacturer (CLI = default)" |
| twr | 5.0 kept | 5.9 kept | manufacturer; see D3 for the check |

For the Pro II, the correct values depend on which board and air unit Andrii has (F405 or AT32; O4 Pro or O4). His own `diff all` resolves this.

These tune changes **do not fix the skidding**: measured yaw overshoot is still 30 to 33% with the BetaFPV PIDs. They make the stick feel match his quad, especially the Pro's throttle curve and FF 0.

### D2. Model changes, in priority order

Each one targets a measured symptom.

1. **Rotor and duct momentum drag**, which removes the skidding.
   - Add a force opposing the in-rotor-plane velocity: `F = -k_lin * m * (sum w_i / sum w_hover) * v_perp`, where `v_perp = v - (v.up)up`.
   - Put it in the force sum inside `step()` next to the quadratic drag. It is zero when disarmed or crashed, because `w = 0`, so free-fall terminal velocity and the bench terminal-velocity check are untouched.
   - New preset field `rotor_drag_per_s`: value **0.6**, source `estimate`, min 0.3, max 0.9.
   - Reference note: momentum-theory bound 0.89; Faessler 2018 measured 0.24 to 0.54 on an open-prop 6-inch quad; ducts are expected to sit toward the top of the band.
   - Expose it in Settings as "Duct drag" so Andrii can A/B it live. The existing "Drag x" cannot do this job.
   - Expected result: coast 10 to 2 m/s goes from 18 s to 2.3 s, and sideslip over 30 deg after a 90 deg yaw goes from 3.8 s to 1.5 s.
2. **Betaflight angle-mode mapping**, which makes the self-level default gentle like the real quad.
   - Tilt target = `angle_limit(60) * setpointRate(x) / maxRate(axis)`.
   - Add the PT3 at 50 Hz on the angle-rate output, and angle feed-forward 50 if it is worth it.
   - Change `ANGLE_MAX_DEG` from 55 to 60 (`pid.c:138`).
   - Optionally add angle_earth_ref (yaw about vertical while tilted, `pid.c:401-408`).
   - Source: Betaflight 4.5 `pidLevel()`.
3. **Prop and rotor inertia yaw reaction**, which removes the whip and bounce-back.
   - Add `tauY += sum motorYaw_i * J_r * omegaMax(V) * dw_i/dt` in the motor loop. `dw/dt` is already known from the lag filter.
   - New field `rotor_inertia_kgm2`: **2e-7**, source `estimate` (mass times radius of gyration, as above), min 1e-7, max 3e-7.
   - Expected result: yaw t90 goes from 95 to 21 ms and overshoot from 35 to 6%.
4. **Betaflight I-term windup attenuation at 85% motor-mix range.** Small effect; it matches Betaflight 4.5 `pid.c:858-862`. Today we only freeze I above 100%.
5. **Axial-inflow thrust loss plus a lower CdA.**
   - Add `T *= max(0, 1 - v_axial / (v0 * w))`, with v0 = zero-thrust speed of about 60 m/s at full rpm, then lower CdA.
   - Result: top speed stays about 90 to 105 km/h, set by physics instead of an inflated CdA.
   - This is the lowest priority, because it is not what Andrii complained about.
6. Later, and only after blackbox data: the duct/blade-flapping nose-up pitching moment at speed, prop wash or vortex ring state, and ground effect near the invisible spawn platform (item 16).

Sequencing: D1, then 1 and 2 together (one SIM_CORE_VERSION bump), then 3, then 4 and 5. Andrii compares each step against his real quad.

### D3. Checks that need Andrii's real data

- **His `diff all`** from each quad (Betaflight CLI, `diff all`, copy). Paste it into the existing importer. A 2026.6.x version line is refused today; see TL;DR 5.
  - This settles rates, PIDs, throttle curve, board type and FF, and whether his yaw rate is custom.
  - He flies ACRO (item 15), so yaw in the sim equals his real yaw rate only if his rates are the defaults.
- **The OSD throttle at a steady hover**, with a full pack and at half pack, plus **AUW from a kitchen scale** with his usual battery. That checks TWR and idle.
- **Cross-check for the input owner:** if the calibration records stick extremes smaller than the real ones, the sticks saturate early. With the ACTUAL curve, a 10% under-recorded range makes 90% physical yaw give 670 instead of 549 deg/s, which is 22% "too strong".
  - This is **a hypothesis, not measured**. Andrii's calibration was not available to me.

## Blackbox calibration plan (how we would fit drag, yaw and thrust)

### What Andrii records

This is one flight on each quad. The Pavo20 Pro FC has 16 MB of flash (manufacturer page), which fits a battery at a 1 kHz log rate.

CLI once, before the flight, then save:

```
set debug_mode = ATTITUDE        # roll/pitch estimate into debug[0..1] (BetaFPV ships GYRO_SCALED)
set blackbox_sample_rate = 1/4   # default: 1 kHz at the 4 kHz PID loop
set blackbox_mode = NORMAL
set blackbox_disable_gyrounfilt = ON   # optional, saves space
# dshot_bidir is already ON in BetaFPV's CLI, so eRPM[0..3] are logged
save
```

Before flying, `diff all` goes into the chat. The quad is weighed with its battery.

Flight script, calm air, open space. Each item is separated by a 3 s steady hover.

- A. **Hover 10 s**, holding still. This gives hover rpm, hover throttle and the accelerometer bias.
- B. **Punch-outs**, 3 x 1 s at full throttle from hover. This gives peak specific force, which is TWR (low speed, little drag). It also gives the motor time constant, from `motor[]` steps against the `eRPM` response.
- C. **Coast-downs** in ANGLE mode: accelerate about 3 s, centre the sticks, keep hover throttle, and wait until stopped. Do it 3x forward and 3x sideways (roll). **This is the drag data.**
- D. **Yaw**: full-stick flicks left and right, 0.3 to 0.5 s, 3 each; half-stick flicks, 3 each; one steady 3 s full-stick spin.
- E. **Roll and pitch** flicks in ACRO, 3 each.
- F. Optional, only with GPS: a straight full-speed pass for top speed.

### Signals and fits

We would build this ourselves in Node; see "Tooling" below. With `m` the measured AUW:

1. **Motor map.** Convert `eRPM` to rpm (eRPM x 100 / (motor_poles / 2), with 12 poles). Fit rpm against `motor[]` and `vbatLatest`, giving omega(u, V). This replaces the assumption that rpm is linear in command. The first-order fit on the steps from B gives **tau**.
2. **Thrust.** At hover, `accSmooth_z/acc_1G` is about 1, so `k_T = m*g / sum(omega_i^2)`. B gives T_max and **TWR**. The `k_T*omega^2` fit also tells us whether thrust follows `w^2` in our output units or needs an exponent.
3. **Drag** (C). The accelerometer measures specific force. Thrust is along body z, so `acc_x` and `acc_y` equal the in-plane aerodynamic force divided by m, **for any attitude**.
   - To get velocity, integrate `R(t)*f(t) + g` **backwards from the stopped hover** at the end of each coast, where v = 0. Roll and pitch come from `debug[0..1]` and yaw from integrated gyro; drift stays small over about 3 s windows.
   - Then least-squares fit `f_perp = -(k_lin * w_mean/w_hover) * v_perp - c*|v|*v_perp`, which gives **rotor_drag_per_s** and **CdA**. Martin and Salaun (2010) show `acc_xy` is close to linear in v for exactly this reason.
4. **Yaw** (D). Least-squares fit of `gyro_z' = a * sum(+/- omega_i^2) + b * sum(+/- omega_i') - c * gyro_z`. This gives kappa*k_T/I_z, **J_r/I_z** and yaw damping.
5. **Roll and pitch** (E). Fit `gyro' = (arm*k_T/I) * sum(+/- omega_i^2)`, which gives I_roll and I_pitch.
6. **Validation.** Feed his logged `setpoint[]` and throttle into our sim with the fitted preset. The deterministic runner already exists. Compare:
   - gyro traces, target RMS below about 10% of the setpoint;
   - coast-down curves, time from 10 to 2 m/s within 15%;
   - hover throttle, within 2 points.

   Add a negative control, as the bench already does: the unfitted preset must fail the same thresholds.

### Tooling

This is a decision for the orchestrator.

- Betaflight logs (`.BBL`) are binary. There are three ways to read them:
  - `blackbox_decode` (C, betaflight/blackbox-tools, GPL) as an external tool.
  - Blackbox Explorer's JS parser (GPL), run offline as a tool and not shipped.
  - Our own small decoder for the field types listed in the header. That is doable; the formats are in `blackbox.c`.
- No npm dependency is needed for the fits. They are small least-squares problems.
- Where fitted values would go: new sources `measured:blackbox-<date>` in the presets. The site already shows the source label for each field.

## Uncertainty

- **No flight data from a real Pavo was measured by me.** Every "real" number above is a manufacturer figure, a reviewer's measurement or a reviewer's estimate, as labelled.
  - The 0.6 1/s drag and 2e-7 kg m^2 rotor inertia are physics estimates with a stated band, not measurements.
  - I cannot say which value inside the band is right without the blackbox coast-downs.
- The drag and inertia prototypes were applied **outside** the Sim, as a per-step velocity or angular-velocity correction. That is first-order equivalent, but not the final implementation. The numbers are for sizing, not for shipping.
- The cruise-speed side effect (5 m/s at 20 deg tilt with drag 0.6) is a real prediction that could come out wrong. If Andrii says the new version "feels like flying in syrup", the band's low end (0.3 to 0.45) is the fallback until the fit arrives.
- The top speed of the Pavo20 Pro is unknown. There is only a 4S estimate of about 100 km/h and a GPS video whose number I could not read.

## What I could NOT do

- Watch the SquaddingQuads GPS video, so I have no top-speed number.
- Find a hover-throttle report for the **3S** Pro or Pro II.
- Read the PSU ducted-fan thesis, and the Martin and Salaun paper beyond its abstract.
- Verify how big the calibration-range hypothesis is on Andrii's radio.
- Run anything against the live site. It was not needed; all measurements are sim-core in Node.
