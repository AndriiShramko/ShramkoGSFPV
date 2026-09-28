# tools/blackbox: Betaflight blackbox decoder and flight-model fit

This is Node-only tooling for design part H.4. Nothing here ships with the simulator. How the owner records a log, and what the fit tells us, is in [`docs/research/blackbox-fit.md`](../../docs/research/blackbox-fit.md).

## Commands

```bash
npx tsx tools/blackbox/src/cli.ts info    LOG00001.BBL
npx tsx tools/blackbox/src/cli.ts decode  LOG00001.BBL [--index N] [--out file.csv]
npx tsx tools/blackbox/src/cli.ts compare LOG00001.BBL official.csv [--gps official.gps.csv]
npx tsx tools/blackbox/src/cli.ts fit     LOG00001.BBL [--index N] [--preset pavo20pro-3s] [--mass 151] [--json fit.json]
```

- **`fit`** prints three things:
  - what the log identifies, each with a standard error and a confidence;
  - what it cannot identify, and why;
  - with `--preset`, the proposed changes to that preset, tagged `measured:blackbox-<date>`.
- **`--mass`** takes the all-up weight in grams, weighed with the battery. It unlocks k_T, the roll/pitch inertia and CdA.
- **`compare`** checks our decoder row by row against a CSV from the official `blackbox_decode`, run with `--unit-vbat raw --unit-amperage raw --unit-flags raw`.

## Files

| File | What |
|---|---|
| `src/decode.ts` | The decoder: headers, I/P/S/G/H/E frames, every encoding and predictor, frame validation and resync, time rollover, several logs per file. |
| `src/compare.ts` | Row-by-row comparison with the official CSV (and the GPS CSV). |
| `src/signals.ts` | Turns a log into SI signals in Betaflight's body frame (x forward, y left, z up), and reads the rates, PIDs and idle from the header. |
| `src/imu.ts` | Attitude estimate. The accelerometer corrects it only while it reads gravity alone. |
| `src/fit.ts` | The fits: hover and thrust curve, motor lag, yaw and rotor inertia, roll/pitch authority, duct drag; then the preset diff. |
| `src/report.ts`, `src/cli.ts` | Text report, command line. |
| `scripts/make-vectors.ts` | Builds the compact test vector from an official CSV. |
| `scripts/evidence.ts` | Writes `evidence/<date>/v03-blackbox.json`. |
| `test/encode.ts` | A log writer for tests, written from the format documentation. |
| `test/synth.ts` | The simulator flies the H.4 script and writes a binary log. |
| `test/*.test.ts` | Tests: decoder against the official CSV, round trip, the fit on the simulator's log, and their controls. |
| `fixtures/` | A 64 KB Beer-Ware log excerpt and its official vector. `fixtures/README.md` gives sources and licences. |

## Provenance

- **Log format:** read from the "Blackbox Logging Internals" page, https://github.com/betaflight/betaflight.com/blob/master/docs/development/Blackbox-Internals.md. That page covers frame types, predictors 0-10, the encodings, P-frame sampling and validation.
- **Firmware facts** (read from the source, not copied): Betaflight 4.5 / 2025.12 / 2026.6 `src/main/blackbox`. They settle:
  - predictor 11 (MINMOTOR);
  - the single-field TAG8_8SVB group;
  - the nibble order of TAG8_4S16;
  - TAG2_3SVARIABLE;
  - the event payloads;
  - `P interval:N` meaning 1/N;
  - the eRPM unit (100 eRPM);
  - high-resolution scaling;
  - the `imuQuaternion` fields of 2025.12;
  - the ATTITUDE debug index;
  - the axis signs, including the yaw sum being negated before the mixer.
- **No code copied:** nothing from Betaflight, blackbox-tools or Blackbox Explorer (all GPL-3.0).
- **The official decoder** was built outside the repository, only to produce the comparison CSVs.
- **Fit models:** our own least-squares formulations of the simulator's equations (`packages/sim-core/src/sim.ts`).
- **Attitude filter:** the Mahony complementary filter as published (Mahony, Hamel, Pflimlin, IEEE TAC 2008).

## Known differences from `blackbox_decode` (master f832acf9)

- **`P interval:N`** (Betaflight 4.x): blackbox_decode reads only the `num/denom` form, so its `loopIteration` steps by 1 per frame. We step by N, like the firmware and Blackbox Explorer.
- **Event types 15 (disarm) and 30 (flight mode)** are unknown to it. It loses sync and drops the main frames up to the next I-frame. We decode them.
- **A frame cut by the end of the file:** it emits it with the missing bytes read as zero. We drop it.
