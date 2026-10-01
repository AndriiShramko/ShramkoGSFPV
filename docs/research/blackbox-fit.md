# Item 21: calibrating the Pavo20 presets from Andrii's own flights

Agent W4-3 wrote this on 2026-09-28. It covers design parts H.3 (Betaflight `diff all` import) and H.4 (blackbox calibration).

Item 21, in Andrii's words: "the drone's reaction physics isn't like real life. Either it drifts a lot, or the yaw reaction is too strong."

This note answers four questions:

- what has already changed without his data;
- how he records one flight per quad;
- how he sends it;
- what the fit does with it.

Background is in [`physics-pavo20.md`](physics-pavo20.md). The tooling is in [`tools/blackbox/`](../../tools/blackbox/README.md), and the numbers are in `evidence/2026-09-28/v03-blackbox.json`.

## 1. What already changed for item 21, without his data

Wave 1 (sim-core 0.2.0, `docs/wip/wave1-reports.json`, `modelReport`) added the two missing physical effects. It also replaced the generic tune with BetaFPV's own.

| What you feel | Before (v0.2) | Now | Why |
|---|---|---|---|
| Glide after letting go (10 to 2 m/s) | 18 s over 73 m | 2.3 s over 11 m | The ducts now brake the drone ("duct drag", 0.6 per second). v0.2 had only air drag on the body. |
| Sliding sideways after a 90 deg turn | 3.8 s | 1.5 s | Same duct drag |
| Yaw: time to reach the commanded rate | 95 ms | 22 ms | The props' spin-up now twists the frame ("rotor inertia", 2e-7 kg m^2) |
| Yaw: overshoot on a full-stick yaw | 34.5 % | 5.5 % | Same |
| Yaw: bounce back after a flick | 15.8 deg | 3.9 deg | Same |
| Tilt in angle mode at 1/4 and 1/2 stick | 13.8 / 27.5 deg | 4.9 / 16.6 deg | Betaflight's angle mapping |
| Motor idle | 5.5 % | 10 % (Pro II AT32 board: 8 %) | BetaFPV's own settings |
| PIDs, feed-forward, throttle curve (Pro) | Betaflight defaults | 54/111/44/0, 68/139/60/0, 54/111/0/0; throttle mid 65, expo 20 | BetaFPV's own settings |
| Hover throttle (Pro, full pack) | 35.8 % | 32.7 % | Idle and weight |

- **Rates are unchanged.** They are 670 deg/s on every axis, the same as BetaFPV ships.
- **Side effect:** at a steady 20 deg tilt the drone now cruises at 5 m/s instead of 11.5 m/s.
- **If it feels like syrup:** duct drag is a per-drone setting (`ductDrag`), so the effect can be turned down until his log measures the real value.
- **All the new physics values are still estimates.** His log replaces them with measurements.

## 2. The `diff all` import (H.3): done

His own settings matter most. His yaw can only feel like his quad if the simulator uses his rates.

`packages/sim-core/src/bfdiff.ts` now reads every official BetaFPV dump for both of his drones: nine files, listed in `packages/sim-core/test/fixtures/betafpv/README.md`.

| Dump | Betaflight | Before this change | Now | Idle |
|---|---|---|---|---|
| Pro, ELRS / TBS / SBUS | 4.5.0 | parsed | parsed | 10 % |
| Pro II F405, ELRS / SBUS | 4.5.3 | parsed | parsed | 10 % |
| Pro II AT32, ELRS / SBUS | 2025.12.5 | parsed | parsed | 8 % |
| Pro II AT32, ELRS / SBUS (2026-09-20) | 2026.6.1 | **refused** | parsed, with a warning | 8 % |

**The newest BetaFPV firmware is a 2025.12.5 build with a 2026.6.1 label.** The version line shows it:

- the build hash `7348054f2` is the tag commit of 2025.12.5;
- the date and time are those of BetaFPV's 2025.12.5 build;
- MSP API 1.47 is what 2025.12 reports (2026.6 reports 1.48);
- the dump has no `battery_profile` sections, which a real 2026.6 `diff all` prints.

The warning says all of this. It also checks, and states, that the import reads the same either way.

**Genuine 2026.6 dumps are also accepted.** I checked against the 2026.6.1 source:

- rates, PID defaults and D meanings are those of 2025.12;
- two defaults changed, the D-boost ones: `d_max_gain` 37 -> 0 and `d_max_advance` 20 -> 35;
- `battery_profile` sections are new.

**What the import reads:**

- rates;
- P, I, D, and FF;
- the throttle curve;
- the static idle: `dshot_idle_value` up to 4.5, `motor_idle` from 2025.12;
- dynamic idle, `dyn_idle_min_rpm`, reported in rpm with a warning, because the simulator has no rpm-based idle.

`idleForMinRpm()` converts dynamic idle into an idle fraction for a given drone. Every setting the import does not use is listed with its section in `result.ignored`.

**Still to do in the app (not my files):**

- `apps/fly/src/app/builtin/import.ts` must apply `result.idle`;
- imports must be saved in the per-drone prefs (H.3, third point).

## 3. How Andrii records the log (about 10 minutes of work per drone)

### Before the flight (once per drone)

1. **Save your settings.** Plug the drone into Betaflight Configurator (or the Betaflight App), open the CLI tab, type `diff all` and press Enter. Copy all of the output into a text file named after the drone.
2. **Calibrate the accelerometer.** Setup tab, "Calibrate Accelerometer", on a level table. The drag measurement depends on it.
3. **Paste these lines into the CLI**, press Enter, and wait for the reboot:

```
set blackbox_device = SPIFLASH
set blackbox_sample_rate = 1/4
set blackbox_mode = NORMAL
set blackbox_disable_acc = OFF
set blackbox_disable_rpm = OFF
set blackbox_disable_motors = OFF
set blackbox_disable_setpoint = OFF
set blackbox_disable_bat = OFF
set blackbox_disable_debug = OFF
set blackbox_disable_gyrounfilt = ON
set debug_mode = ATTITUDE
set dshot_bidir = ON
save
```

   - The sample rate gives 1 kHz on the Pavo20's 4 kHz loop, about 35 KB/s, so the 16 MB flash holds about 7 minutes.
   - `dshot_bidir` is already ON in BetaFPV's settings. It must be ON, or motor speed is missing from the log.
   - If the Blackbox tab shows no onboard flash (possible on the Pro II AT32 board), stop and tell us.
4. **Erase the flash.** Blackbox tab, "Erase flash".
5. **Weigh the drone** with the battery you will fly on a kitchen scale, and note the grams.

### The flight (about 5 minutes, one full pack, calm air, open field)

Fly in **angle mode** unless a step says otherwise. Hover still for 3 s between steps.

| Step | What to do | What it measures |
|---|---|---|
| A | Hover still at eye level for 10 s. Only small corrections. | Hover throttle, thrust |
| B | Three times: full throttle for about half a second, then throttle down to stop the climb, then hover still. | Motor speed-up, real thrust-to-weight |
| C | Six times, 3 forward and 3 sideways. Hover still for 3 s. Push pitch (or roll) about half way for 2-3 s. Then centre roll, pitch and yaw and keep only the altitude with throttle. Let it glide until it stops by itself (up to 8 s). **Do not correct the glide.** Then stop and hover still. | Duct drag: the "drift" in item 21 |
| D | Yaw flicks: 3 full-stick left and right (0.3-0.5 s each), 3 half-stick, and one full-stick spin of 3 s. | Rotor inertia, yaw strength: the "yaw too strong" in item 21 |
| E | In acro: 3 quick roll flicks and 3 pitch flicks (out and back), then back to angle to level. | Roll and pitch inertia |
| F | Optional: one fast straight pass. | Top speed and body drag (CdA) |

### After the flight

1. **Save the log.** Blackbox tab, "Save flash to file". This gives a `.BBL` file.
2. **Optional:** set `debug_mode` back to `GYRO_SCALED`, BetaFPV's setting. Leaving it at ATTITUDE is harmless.
3. **Note the OSD throttle %** at a steady hover, on a full and on a half pack.

## 4. How he gives it to us

One message per drone, with four things:

- the `.BBL` file;
- the `diff all` text;
- the weight in grams;
- the hover OSD throttle.

**Where to send it:**

- **Best:** a new issue on the ShramkoGSFPV GitHub repository, with the files dragged into it. GitHub stores attachments, and nothing goes into the code repository. Zip the `.BBL` if GitHub refuses it.
- **Or:** a Google Drive link.
- **The vault takes only the text** (diff, weight, throttle): the vault repository stores text only (vault rule 10), so the `.BBL` does not go there.

## 5. How the fit runs

```bash
npx tsx tools/blackbox/src/cli.ts fit Pavo20Pro.BBL --preset pavo20pro-3s --mass 151 --json fit.json
```

It prints three lists:

- what the log identifies, with an error bar and high / medium / low confidence;
- what it cannot identify, and why (for example "no still hover", "no rpm telemetry");
- the proposed preset changes, each tagged `measured:blackbox-<date>`. The site shows that tag.

| Preset field | How it is measured | Needs |
|---|---|---|
| `twr` | Still hover: the motor output that holds 1 g in the simulator's thrust model, at the preset's voltage. Without a hover, a thrust fit over the slow parts of the flight. | Step A |
| `motor_tau_ms` | Motor command to rpm, a first-order lag. Command and rpm get the same 40 Hz filter; the delay is searched. | bidirectional DShot |
| `rotor_inertia_kgm2`, `motor_kappa_m` | Yaw acceleration against the rotors' drag torque (rpm^2) and against their acceleration (d rpm/dt) | D, rpm, `--mass` for kappa |
| `inertia_roll_pitch_kgm2` | Roll and pitch acceleration per rpm^2 difference | E, rpm, `--mass` |
| `rotor_drag_per_s` | Coast-downs: the accelerometer is integrated from the still hover before each push. The in-plane force is fitted to the simulator's drag law, with the body drag held at the preset's value. | C |
| `cda_horizontal_cm2` | Only proposed when it is firm, which usually needs step F | F, `--mass` |
| rates, PIDs, throttle, idle | Log header, checked against the logged setpoints | nothing |

**Uncertainties** come from refitting with one block of the data left out each time (a jackknife over 8 time blocks, or over the coasts). The textbook formula would be far too optimistic at 1 kHz.

**Attitude** is our own estimate. The accelerometer corrects it only while it reads gravity alone. A flight controller keeps correcting during glides, where drag tilts the accelerometer reading; that biases its attitude by degrees exactly when the drag fit needs it. Its own estimate (debug ATTITUDE, or the quaternion fields of 2025.12+) is used only as a cross-check.

## 6. How we know it works

**Decoder, against the official `blackbox_decode`:**

- Built from betaflight/blackbox-tools master `f832acf9`.
- Four public logs: one Betaflight 3.1.5 log (PID-Analyzer, Beer-Ware) and three Betaflight 4.5.1 logs (a 6S freestyle quad with GPS, from a repository with no licence, so not stored).
- 53,248,448 cells compared, **0 mismatches**; 10,108 GPS fixes, 0 mismatches.
- We give 93 more rows than the official tool, all after a disarm or flight-mode event, which that tool cannot read.
- The tests pin a 64 KB excerpt bit for bit.

**Fit, on the simulator's own log.** sim-core flies the script above on `pavo20pro-3s` and writes a real binary log. The log has sensor noise, and the rpm telemetry arrives one loop late.

| Parameter | Simulator | Fit |
|---|---|---|
| TWR | 5.0 | 5.00 |
| Motor tau | 15 ms | 15.1 ms |
| Rotor inertia | 2.0e-7 kg m^2 | 2.05e-7 |
| kappa | 0.0075 m | 0.0071 |
| Roll/pitch inertia | 1.11e-4 kg m^2 | 1.10e-4 |
| Duct drag | 0.60 1/s | 0.59 |

**Controls** (each changes one term in the simulator):

- rotor inertia 0: the fit gives about 0;
- duct drag 0: "not distinguishable from 0";
- tau 30 ms: 30.0 ms;
- no rpm telemetry: tau and rotor inertia are listed as not identifiable.

**On the public 4.5.1 logs** (a 6S five-inch, not a Pavo), the fit gives sane numbers, and the three flights agree:

- hover motor output 0.27-0.28;
- motor tau 27-29 ms;
- rotor/yaw inertia ratio 0.7-1.1e-3;
- duct drag 0.20-0.26 1/s, from GPS cruise (published open-prop values are 0.24-0.54);
- rates confirmed: the logged setpoints follow the header curves within 0.6 deg/s.

It also says what those freestyle flights cannot give:

- no still hover;
- no 0.3 s full-throttle punch;
- CdA: 2 of the 3 flights.

## 7. Limits and open points

- **One motor-lag number for the whole range.** The simulator's lag is first order. Fits above and below the median rpm are reported, so the owner's log will show whether one number is enough.
- **Thrust curve.** The simulator's thrust goes with output squared. The TWR is chosen so the hover output matches. If full-throttle rpm says otherwise, the report shows both.
- **Yaw torque (kappa) depends on the yaw inertia**, which is an estimate. Rotor inertia too; the fit gives J_r / I_z exactly.
- **Body drag (CdA)** is weak at glide speeds. It changes the preset only when it is firm.
- **Not built: `validate.ts` (H.4).** It would replay his setpoints through the fitted preset, with the unfitted preset as a negative control. The fit on the simulator's own log checks the same machinery end to end, but not on his quad.
- **Not built: app side of H.3.** Applying the imported idle and saving imports in the prefs are app work (`apps/fly`), not done here.
