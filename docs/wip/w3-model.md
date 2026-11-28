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
- [x] S2 the presets and determinism: air65-1s corrected by the note; presets Air65 Champion and Air65 II Champion;
      SIM_CORE_VERSION bump; the new A6 hash everywhere the old one is named; gates
      - [x] presets, wiring, sim-core/0.3.0, A6 9cb46a35..., old recordings, catalogue. Commit 66ca8d49.
      - [x] gates run once on 66ca8d49 (logs U:/Temp/gsfpv-gates-20261126-192836): PASS architecture, i18n, catalog,
            leaks. FAIL typecheck and 6 sonic vitest cases: NOT this lane, the packages/sonic-fpv checkout was moved
            off its pin (719aaf54 vs 9ac7876d) before the lanes came (MomentKey, GuideLevel, setAudible missing).
            FAIL b18: only docs/wip/train5-lead.md (the lead's file, on origin/main). FAIL 2 of this lane:
            tools/bench/test/app-game.test.ts "every preset ... Shift lands" (machr5sport-6s slow from 20 m touches
            at 1.42 m/s, limit 1.13) and "the motors stop only at the floor ... control: the Mach R5 stops in the air"
            (the control no longer stops above the floor).
      - [x] the two app-game cases, fixed (commit ef5b3f7b):
            apps/fly/src/play/game.ts `landed` also needs s[S.vy] <= 0 (never on the rise of a hop); the in-air control
            now runs the four landing heights (the old cut-anywhere rule still stops in the air from 1.5 m, the rule on
            none). app-game.test.ts 27 passed; neg_control.py --ref HEAD --files game.ts: NEG OK (the 20 m slow touch
            fails on the old rule). apps/fly tsc: 27 errors, all in src/sonic/* (the off-pin submodule), none here.
            Diagnosis of the time (a throwaway script, game-loop.ts GameLoop): the 1.42 m/s touch is
            the same at propWash 0 (1.43) and 1 (1.42): the new term does not cause it. The game assist
            (apps/fly/src/play/game.ts:446-452, "landed") cuts the motors at 8.65 s, y 0.072 m, vy +0.27 m/s: on the
            rise of a hop; the craft then lands on its spheres at 0.78-1.43 m/s. On origin/main the Mach carried the
            v0.8 hand-set wake_loss/wake_shake, which damped that hop; S1 removed them. Next run: decide the fix
            (likely the assist cuts only when not rising, s[S.vy] <= 0, at the bottom of a hop as its comment says;
            that file is the game's, so name it under For the lead), re-run only app-game.test.ts and the
            EarlierAssist control, then gates once more is NOT needed for the other groups (passed on unchanged inputs).
- [x] S3 the numbers and the pilot: w3-wash-run.ts before/after table for default, Air65, 5-inch; page probe
      (`?render=off`) that the Prop wash row changes the flight and 0 switches it off; For the lead
      - [x] w3-wash-run.ts on the new model (multipliers 0/1/2, 3/4/5 m/s and fast-drop catch, punch angle/acro),
            table "## Numbers (S3)", A6 holds 9cb46a35; bench tsc clean. Commit aa31b733.
      - [x] page probe tools/bench/scripts/w3-model-wash-probe.mjs (commit 300b2d7c) on the release build of 300b2d7c:
            PASS 8 of 8; the same probe on the live site: FAIL 4 (the setting does nothing there: sink 4.72 m at 0, 1
            and 2). Evidence evidence/2026-11-19/w3-model/w3-model-wash-probe*.json. dist removed. For the lead.
            Gates: only b18 again (this file changed); the other groups ran in S2, inputs since then are the bench
            script, the probe, one comment in prefs.ts and docs.

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
| air65iichamp-1s prop_diameter_mm | 31 | Gemfan 1207: the 1.2 inch class like the 1219S; the maker gives no diameter |
| air65iichamp-1s camera_uptilt_deg | 25 | the Air65 canopy's lowest angle; the Air65 II page gives none |
| Both Champions: inertia, tau, kappa, cda, colliders, drag, efficiency | the Air65's estimates | no source for any of them on any 65 mm whoop |

## Presets (S2)

Sources: the research note's table and its maker addendum (betafpv.com read 2026-11-26). No blackbox note exists:
no field comes from a real flight log. Each field's source is in the preset JSON (`source`, `ref`, `note`).

| Preset | Changed or new fields |
|---|---|
| air65-1s | twr 3.5 (estimate) -> 5.26 (maker; motor table check 5.25); battery_mass_g 7 -> 7.11 (maker); auw_g 24.3 -> 24.4 (maker sum); prop named HQ 31 mm Ultralight (maker); camera_uptilt_deg 20 -> 25 (maker canopy 25 to 50). Hover now 32.8 % stick (maker table about 32 %, Oscar Liang 35 %) |
| air65champ-1s (new) | 0702 II 30000 KV, GF 1219S, dry 17.4 g, AUW 24.5 g, TWR 6.4 (maker). The lead's 17.9 g is a review's number (community); the maker's page says 17.4 +- 0.15 g and wins. Hover 24.8 % |
| air65iichamp-1s (new) | 0702 36000 KV, GF 1207, dry 16.6 g, LAVA II 320 mAh 8.2 g, AUW 24.8 g, TWR 6.3 CLAIMED by the maker (its motor table gives 6.34), rpm_loaded_fraction 0.46 from the maker's rpm table. Hover 28.1 % |

Names: the picker shows the preset's `name` (product names, as for every other drone; no locale key holds drone
names today). The Prop wash help text in the four locales now says every drone has it (it said whoops had none).

## Numbers (S3)

`cd tools/bench && npx tsx src/w3-wash-run.ts` (evidence/2026-11-19/w3-model/w3-model-wash.json). 1 kHz, still air,
angle mode. x0 = physics.propWash 0 = the flight before on the default and the Air65 (origin/main gave neither a term;
the Air65 column uses the S2 preset). x1 = default, x2 = the most the setting allows. Before on the Nazgul F5 (origin/main,
its v0.8 one-loss-for-all term, w3-wash run, 4 m/s P loop): held descent 7.5 % loss, 2.7 deg/s, 0.14 deg; punch
79 ms in wash, 25 % peak loss, 7.9 deg/s, 0.30 deg. Cells: x1 (x2). Wobble = RMS roll/pitch rate in the wash, tilt off level.

| Manoeuvre | Pavo20 Pro default (151 g, ducted, v_h 7.9) | Air65 (24.4 g, ducted, v_h 5.7) | Nazgul F5 (736 g, open, v_h 7.5) |
|---|---|---|---|
| held descent 3 m/s: loss, wobble | 0 % (band not reached) | 0.5 %, 0.5 deg/s | 0.2 %, 0 deg/s |
| held descent 4 m/s: loss, wobble, tilt | 0.4 %, 0.6 deg/s, 0.03 deg | 5.9 % (10.3), 2.4 deg/s (4.5), 0.17 deg | 2.3 % (4.1), 1.1 deg/s (2.1), 0.10 deg |
| held descent 5 m/s: loss, wobble, tilt | 3.5 % (6.2), 1.7 deg/s (3.5), 0.12 deg (0.24) | 15.3 % (26.6), 5.2 deg/s (9.8), 0.32 deg (0.67) | 6.6 % (11.1), 3.0 deg/s (5.5), 0.21 deg (0.43) |
| catch after a fast drop (11.7 / 8.7 / 11.6 m/s), stick 1.5 x hover: height lost x0 -> x1 (x2) | 7.17 -> 7.63 m (8.28): +0.47 m (+1.12) | 2.89 -> 3.02 m (3.19): +0.13 m (+0.30) | 6.06 -> 6.88 m (8.30): +0.81 m (+2.23) |
| same catch: time to stop the fall, time in wash, loss in wash | 1407 -> 1455 ms, 498 ms, 8.0 % (16.4) | 746 -> 763 ms, 244 ms, 7.0 % (14.4) | 1116 -> 1204 ms, 633 ms, 9.8 % (20.6) |
| same catch: wobble, tilt | 5.7 deg/s (11.5), 0.40 deg (0.89) | 4.7 deg/s (9.7), 0.28 deg (0.59) | 7.0 deg/s (14.3), 0.55 deg (1.21) |
| full punch after a 1.5 s idle dive: sink x0 -> x1 (x2) | 1.35 -> 1.37 m (1.38), +2 ms | 0.79 -> 0.84 m (0.88), +11 ms | 1.14 -> 1.18 m (1.22), +4 ms |
| same punch: time in wash, loss in wash, wobble, tilt | 18 ms, 7.4 %, 3.2 deg/s, 0.03 deg | 14 ms, 6.9 %, 6.3 deg/s (11.5), 0.04 deg | 35 ms, 6.2 %, 6.2 deg/s (11.3), 0.04 deg |

Reading: the full punch leaves the band in tens of ms (full thrust raises v_i, the ratio drops below the band), so it
bites only a little late; the big effect is a firm (not full) catch after a fast drop: half a metre more on the default,
0.8 m on the 5-inch. Acro gives the same wobble as angle within 0.01 deg/s (the rate PID does the fighting). A punch
after a forward dive (M2b) gets at most 2 ms of wash: the sideways speed fades it. The angle-mode tilt stays under
1 deg at x1: the shake shows as a rate wobble of 3 to 7 deg/s, not as a visible lean. A held 4 to 5 m/s descent then
a catch loses no extra height: the pilot loop already added throttle against the loss.

## Recordings of older builds

sim-core/0.3.0. A life recorded by 0.2.0 is refused, never replayed silently different: the page says
"flown with sim-core/0.2.0, this page runs sim-core/0.3.0" (apps/fly/src/session/replay.ts), and sim-core itself
throws "preset ... is not available" (the preset hash moved with prop_diameter_mm and ducted). Proof that nothing
else changed: the format /2 log fixture and the B12 browser recording, re-headed with today's preset and
physics.propWash 0 (test log-kit wakeOffHeader), replay to their saved hashes bit for bit, and A6 with wake 0 gives
the old 1d01ca5b... (tools/bench/test/a6-reference.test.ts). The old hash stays only in history: evidence/, docs/wip
of earlier lanes, docs/research/drones-v08.md (a v0.8 statement).

## Claims

1. Every preset has prop wash at the default multiplier, the size the sources give (mean loss 0.20, per-rotor SD 0.10
   at the peak), placed by its own v_h and duct; in a held descent at the peak ratio the mean loss of the Air65,
   the Pavo20 Pro and the Nazgul F5 is 0.20 +- 0.02 (measured range 0.06 to 0.35) and exactly 0 outside the band;
   the four rotors fluctuate independently (|r| < 0.05), SD 0.06 to 0.14, and repeat bit for bit; multiplier 0 =
   no term. Command: `npx vitest run packages/sim-core/test/model-wake.test.ts`. Last result: 7 passed; on
   origin/main 7 failed (neg_control.py NEG OK).
2. The A6 reference at default settings is 9cb46a358f1a... (sim-core/0.3.0); with physics.propWash 0 it is the old
   1d01ca5b... bit for bit. Command: `npx vitest run tools/bench/test/a6-reference.test.ts`. Last result: passed.
3. Old recordings (format /2 fixture, the B12 browser life) are refused as recorded and replay to their saved hashes
   with the term off. Command: `npx vitest run packages/sim-core/test/log-v2-compat.test.ts packages/sim-core/test/b12-rewind.test.ts`.
   Last result: 8 passed.
4. Eleven presets; the Air65 hovers at 32.8 % stick. Command: `npx vitest run tools/bench/test/drone-card.test.ts
   tools/bench/test/drones3d` and `npx tsx tools/bench/scripts/w3-model-hover.ts` (from tools/bench). Last result: passed; 32.8 / 24.8 / 28.1 %.
5. The game's Shift landing still lands every preset at every speed and height softly with prop wash on, and the
   motors never stop on the rise of a hop. Command: `npx vitest run tools/bench/test/app-game.test.ts`.
   Last result: 27 passed; the old cut rule fails the Mach R5 slow from 20 m (touch 1.42 m/s, limit 1.13): NEG OK.

6. The Prop wash setting reaches the flight of the default craft in the built page and 0 switches it off: a fast
   drop and a 1.5 x hover catch sink 4.72 m at 0 (no wash at all, wakeLoss = wakeShake = 0), 4.86 m at 1 (256 ms of
   wash, 3.7 deg/s), 5.03 m at 2. Command: build, serve, then `node tools/bench/scripts/w3-model-wash-probe.mjs
   http://localhost:7440/en out.json`. Last result: PASS 8 of 8; on the live site FAIL 4 (4.72 m at 0, 1 and 2).
7. The numbers table "## Numbers (S3)". Command: `cd tools/bench && npx tsx src/w3-wash-run.ts`. Last result: as
   in the table; A6 holds 9cb46a35 at the default.

## What the owner does

1. Open any scan, fly the default drone (Pavo20 Pro). Climb, cut the throttle for about 1.5 s, then catch with about
   half throttle: the drop ends about 15 cm lower than before (half a metre after an 11 m/s drop) and the picture
   trembles a little (3 to 6 deg/s) for a quarter to half a second. A full punch bites only a little late.
2. Settings (expert level) -> Drone -> Prop wash: 0 = the old smooth drop, 1 = the default, 2 = twice as strong.
   The change applies when Settings close (a new life). The Air65 shakes most in a slow 4 to 5 m/s sink;
   the 5-inch loses most height after a fast drop.

## Not verified

- No person, phone, real controller or real blackbox log took part. No pilot compared it with a real quad: the
  sizes are from rotor test stands (152 mm and up) and NASA multicopter data, carried down to 31 to 56 mm by estimate.
- The probe sets the setting by its URL form (set.physics.propWash, the same setting and validation as the row),
  not by clicking the row; the row's apply on close is the settings screen's existing path (settings.ts applyToFlight).
- B18 FAIL on docs/wip/train5-lead.md only (S2 gates): the lead's file, repaired on origin/main; not this lane's.
- typecheck and 6 sonic vitest cases (S2 gates) fail from the packages/sonic-fpv checkout off its pin in this copy.

## For the lead

- A pilot gets, at the default x1: Pavo20 (default) 3.5 % thrust lost in a 5 m/s sink, +0.47 m after an 11.7 m/s
  drop and catch; Air65 15 % lost at 5 m/s, 5 deg/s wobble, +0.13 m after an 8.7 m/s drop; Nazgul F5 6.6 % at
  5 m/s, +0.81 m after an 11.6 m/s drop. Tilt stays under 1 deg everywhere (the rate PID wins); a punch from a
  straight dive leaves the band in 14 to 35 ms. Table: "## Numbers (S3)". On live today: nothing (0 % everywhere).
- Estimates with no source: the "## Estimates" table (duct shift 0.15, side fade 4, the shake spectrum, the loss
  and shake carried to small rotors, two Air65 II fields, the Champions' inertia/drag).
- New A6 hash 9cb46a358f1a... (sim-core/0.3.0); propWash 0 still gives 1d01ca5b... Older recordings are refused
  with the build named ("## Recordings of older builds").
- Files outside sim-core and the presets: apps/fly/src/play/game.ts (landing cut waits for vy <= 0),
  apps/fly/src/app/prefs.ts (comment), locales dronetune x4, prefs defs, docs, tests and bench files listed in S1/S2.
- Release: page only (no API, rooms, nginx or sound package). Live checks: w3-model-wash-probe.mjs on the live site
  must turn PASS 8 of 8; a6-reference and app-game in CI.

## Cost notes

- S1: the most replies went to rewriting the v0.8 wake tests (model-drones-v08, drone-ranges) and one neg_control
  run lost to calling npx as an argv (Windows needs the whole test command as ONE quoted string).
- S2: the most replies went to wiring two presets through tests that pin the preset count and the equipment table,
  and to diagnosing the game-landing failure the gates found; running app-game.test.ts before the gates would
  have found it at once (any flight model change: run it with the model tests).
- S2 close: 12 replies; one lost to a probe loop too short for 20 m (600 x 10 ms). The landing file runs in 10 s:
  probe by editing the test, not by a separate script.
- S3: about 30 replies; the most went to finding how a probe sets a setting and reads the life (the set.<id> URL
  form and window.__gsfpv.session.runner.sim); a note in docs/agent-map.md on those two would save five replies.
  The first bench catch was closed loop and hid the extra sink: measure catches with a fixed stick.
- Review: about 20 replies; the most went to reading the research note's long lines by slice. neg_control.py
  needs npx.cmd (not npx) on Windows; a short English digest of the note's numbers would save three replies.

## Review

Verdict: SHIP (independent check, 2026-11-28, head eb3510a9). No PROVEN finding, nothing repaired.
- Constants checked against the research note: WAKE_LO 0.4, WAKE_HI 1.7, WAKE_PEAK 1.25, WAKE_LOSS_PEAK 0.20,
  WAKE_SHAKE_PEAK 0.10 sourced; WAKE_DUCT_SHIFT, WAKE_SIDE_FADE, WAKE_NOISE_TICKS marked ESTIMATE as the note says.
  Preset fields of the three Air65 presets match the note's maker addendum.
- model-wake, a6-reference, log-v2-compat, b12-rewind: 16 passed; neg_control.py on 078805f0: NEG OK.
  w3-wash-run.ts repeats the "## Numbers (S3)" table bit for bit. A6 with propWash 0 still gives 1d01ca5b.
- Own check: held descent at the peak with side speed mu 0 / 0.5 / 1 / 2 / 3 gives loss 19.9 / 9.9 / 4.0 / 1.2 /
  0.5 % on the Pavo20 Pro, Air65 and Nazgul F5 (design 20 / (1 + 4 mu^2)); a 0.3 v_h descent loses exactly 0.
- DOUBT (not holding): the shake knots put most content below about 60 Hz (comment says 10 to 100 Hz); the duct
  keeps open-rotor v_i; a fixed WAKE_SEED, not one per life; air65-1s prop_diameter_mm has no ref link.
- Not rerun: the page probe and the build, app-game.test.ts, the full gates (only b18 for this file).
