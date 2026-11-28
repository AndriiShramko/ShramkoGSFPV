# w3-wash: the prop wash that went missing (train 5, step 1 of the owner's prop wash and whoop package)

The owner (2026-11-25): "Why is there no physically right prop wash on the drones? We seemed to have it and it went
somewhere. Analyse the settings of the drones and think." This lane: history and the present state only, no new model.
Base: origin/main 078805f0. No flight model, preset or page file changed.

## Status

- [x] 1. History: was there a prop wash model (git log -S / -G over the whole history) - 91347605
- [x] 2. Where it went - 91347605
- [x] 3. Today on origin/main: code, presets, setting, default pilot - 91347605
- [x] 4. The number, headless: tools/bench/src/w3-wash-run.ts, evidence/2026-11-19/w3-wash/w3-wash-headless.json - 91347605
- [x] 5. The cheapest honest way back - 91347605

## Findings

### 1. Was there a model: yes, and it is still there

- Added in feec5618 (2026-10-16, "v08-d: three new drone presets (5-inch freestyle, 5-inch race, X8 cinelifter with a
  RED Komodo) and prop wash (wake.ts)"). It is the only commit in the whole history that brings a wash/wake/vortex term
  (`git log --all -i -G 'prop ?wash|propwash|vortex|dirty.?air|\bVRS\b'` over packages, apps/fly/src, tools/bench;
  `git log --follow packages/sim-core/src/wake.ts` gives feec5618 and 4a21137d only). The owner's item 9 of message 21
  (docs/research/drones-v08.md:3).
- Setting `physics.propWash` and the tune form: bc8b7ab0 (2026-10-16). Cap of the override: 4a21137d (2026-10-16, R5:
  wake_loss x setting capped at WAKE_LOSS_MAX = 0.9, packages/sim-core/src/wake.ts:33, params.ts:184).
- The formula (packages/sim-core/src/wake.ts:44-62): induced velocity v_i = sqrt(T / (2 rho A)) with T the thrust the
  rotors make NOW (sum of tmax x m_i^2, sim.ts:354) and A = 4 disks of prop_diameter_mm (params.ts:188). x = v_d / v_i,
  v_d = airspeed along the body up axis, positive when sinking along the thrust axis (sim.ts:366-369, wind subtracted).
  Intensity k = b^2 / (1 + 4 (v_side / v_i)^2), b = 4 t (1 - t), t = (x - 0.25) / (2 - 0.25), zero outside 0.25 < x < 2
  (wake.ts:35-37, 57-61).
- What it changes (sim.ts:500-532): every rotor's thrust x (1 - wakeLoss x k) (sim.ts:506, 514); a roll and pitch
  torque of amplitude wakeShake x k x (one rotor's thrust) x arm, shaped by a seeded smooth noise with knots every
  25 ticks = 40 Hz (wake.ts:39-41, 65-67; sim.ts:526-531). Power still follows clean-air thrust (sim.ts:521).
- What it reads: the body-axis descent speed through the own wake and the sideways speed (fade), and the throttle only
  through v_i (a chopped throttle has a small v_i: the craft falls through without loss and meets the wake when it
  throttles up, wake.ts:16-18). It does not read the attitude rate or the throttle change itself.
- Determinism: + - * / and Math.sqrt only, noise from wind.ts smoothNoise (wake.ts:23-26).

### 2. Where it went: it never left the code; it was never given to the default craft

- No removal, no refactor: `git log -G 'wake|wash'` over sim.ts, params.ts, apps/fly/src/app/prefs.ts and the menu
  levels shows only feec5618, bc8b7ab0, 4a21137d. The step still calls it (sim.ts:504-507).
- It is opt-in per preset BY DESIGN: decision D38 (docs/decisions.md:76): "Prop wash is opt-in per preset ... the whoop
  presets have none, so their flight and the A6 hash are bit for bit the ones before". The lane note says the same:
  docs/wip/v08-d.md:28-30 ("absent = 0 = the model of today bit for bit, so the six presets and the A6 hash do not
  change") and :95 ("prop wash is new physics only on them (the whoops fly exactly as before)"). The setting's own
  comment: packages/prefs/src/defs/drone.ts:40-41 ("The whoop presets have no prop wash (their ducts), so it does
  nothing there").
- The default craft has been the Pavo20 Pro 3S whoop since the first simulator commit bcef1bf6
  (`git log -S"DEFAULT_PRESET = "`), today apps/fly/src/presets.ts:12. Its research note put prop wash off until
  blackbox data exists: docs/research/physics-pavo20.md:74 and :308 ("Later, and only after blackbox data: ... prop wash
  or vortex ring state").
- So "we had it" = the three open-prop presets of v0.8; "it went somewhere" = the pilot flies the default whoop, which
  never had the term. No default, flight style, assist or menu change switched it off.

### 3. Today on origin/main (078805f0)

- Code: wake.ts (67 lines), called from sim.ts:504-532, compiled by params.ts:180-188 (wakeOf) and :397.
- Presets with a non-zero value (all `source: estimate`, no measurement):
  nazgulf5v3-6s.json:44-45 (loss 0.25, shake 0.3, prop 129.5 mm), machr5sport-6s.json:44-45 (0.25, 0.3, 129.5 mm),
  taurusx8-komodo-6s.json:47-48 (0.3, 0.3, 203.2 mm). The six whoops (pavo20pro-3s, pavo20pro2-3s, pavo20pro2-4s,
  pavopico-2s, meteor65pro-1s, air65-1s) carry none and no prop_diameter_mm either.
- The setting: `physics.propWash`, multiplier 0..2, default 1, scope drone, advanced, menu level expert
  (packages/prefs/src/defs/drone.ts:42, packages/prefs/src/defs/levels.ts:64), wired to ParamOverrides.wake
  (apps/fly/src/app/prefs.ts:130). A pilot finds it in Settings > Drone (advanced rows), menu level Expert
  (ui.menuLevel default expert, packages/prefs/src/defs/menu.ts:10). On a whoop it does nothing.
- The default pilot gets the Pavo20 Pro 3S: no prop wash at all. The FAQ says so honestly (docs/settings.md:265-266:
  "Yes, on the 5-inch quads and the cinelifter").

### 4. The number (tools/bench/src/w3-wash-run.ts, evidence/2026-11-19/w3-wash/w3-wash-headless.json)

Angle mode, still air, 1 kHz. OFF = ParamOverrides.wake 0. ON = as shipped (5-inch) or, for the whoops, the 5-inch
estimates (loss 0.25, shake 0.3) with a rotor from the preset's own prop field (Pavo20 55.9 mm, Air65 31 mm), for the
comparison only. M1 = a steady descent held at about 4 m/s, then a hover catch; M2 = idle 1.5 s straight down, then
full throttle. Wobble = RMS roll/pitch body rate while the wash is on; tilt = largest tilt off level.

| craft (mass) | M1 descent OFF | M1 descent ON | M2 punch OFF | M2 punch ON |
|---|---|---|---|---|
| pavo20pro-3s, default (151 g), v_i 7.9 m/s | k 0, 0 deg/s, 0 deg | k 0.24, thrust -5.7 %, 2.1 deg/s, 0.11 deg | k 0, 0 deg/s | k peak 1 for 113 ms, thrust -25 % peak, 6.7 deg/s, 0.26 deg |
| air65-1s, lightest (24.3 g), v_i 5.7 m/s | k 0, 0 deg/s, 0 deg | k 0.54, thrust -12.6 %, 5.6 deg/s, 0.35 deg | k 0, 0 deg/s | k peak 1 for 184 ms, -25 % peak, 11.2 deg/s, 0.67 deg |
| nazgulf5v3-6s, shipped term (736 g) | k 0, 0 deg/s | k 0.30, -7.5 %, 2.7 deg/s, 0.14 deg | k 0 | k 0.99 for 79 ms, -25 % peak, 7.9 deg/s, 0.30 deg |

Today the default and the lightest craft go through their own wake glass-smooth (0 deg/s, 0 % thrust lost). Even where
the term exists the shake is a few deg/s and well under 1 degree of tilt: the angle-mode PID cancels a 40 Hz torque of
0.3 x one rotor's thrust easily. What a pilot can feel from today's term is the sink (v0.8's table: 17.1 m lost vs 11.7 m
in a 2 s drop and gentle catch, docs/research/drones-v08.md:136), hardly the shake. A punch after a forward dive (M2b)
gets almost no wash (k at most 0.18, under 15 ms): 3 to 4 m/s sideways fades it (the 1 + 4 mu^2 divisor).
A6: the default craft as shipped hashes to the reference 1d01ca5b...; with the term ON it hashes to 7ada5f20... (moves).

### 5. The cheapest honest way back (half a page)

What must change for the default pilot to feel it: the default craft must carry the term AND the term must shake.
- Cheapest switch: add wake_loss / wake_shake / prop_diameter_mm to pavo20pro-3s.json (one preset, three fields). No
  model code changes. But it moves the A6 hash (measured above: 1d01ca5b... -> 7ada5f20...), so it needs the owner's word,
  a SIM_CORE_VERSION bump (AGENTS.md: old replays must refuse cleanly) and re-recorded A6 evidence and test pin.
- Without the owner's word: the same fields with the setting `physics.propWash` default 0 on whoops would keep the hash
  but give the default pilot nothing - not a way back. An honest middle: a new preset (or the coming Air65 Champion class
  whoop, step 3 of the package) that ships the term, while the default craft's hash stays pinned.
- The size: today's shake would still be close to invisible (2 to 6 deg/s on whoops). A felt prop wash needs a stronger
  or differently shaped disturbance (the step 2 research), and that is a model change: SIM_CORE_VERSION bump either way.
- Gaps the term has today: it ignores the attitude rate and the throttle change; it fades with sideways speed, so the
  classic "dive, flip, punch" wobble of freestyle hardly shows; the noise is the same for every craft (40 Hz knots,
  WAKE_NOISE_TICKS), not scaled by rotor speed or size; ducts are not modelled (the reason given for leaving whoops out).
What the research step must bring (no source exists for any of these today; every value is `estimate`):
1. wake_loss per class (5-inch, 2-inch ducted, 65 mm whoop): thrust lost in axial descent, by disc loading.
2. wake_shake and the shake's spectrum (frequency, by prop size/rpm), from blackbox gyro in a descent and a dive catch.
3. The band edges (WAKE_LO 0.25, WAKE_HI 2) and the sideways fade (the factor 4): vortex ring literature for small rotors.
4. Whether a duct changes the loss or the shake (the D38 reason for leaving whoops out has no measurement).
5. Rotor diameters as preset fields for the whoops (prop_diameter_mm is absent on all six).

## What the owner does

Nothing in the simulator changed. To see today's prop wash: open Settings, set the menu level to Expert, pick the drone
Nazgul F5 V3 class (5-inch freestyle), climb high, chop the throttle for 2 s, then catch with a little more than hover:
the drone sinks further than you expect (the wash); Settings > Drone > Prop wash 0 switches it off. On the default
Pavo20 the Prop wash row does nothing.

## Claims

1. The prop wash term exists on origin/main and is applied only to the three open-prop presets; the default craft has
   none. Command: `cd tools/bench && npx tsx src/w3-wash-run.ts` (crafts[0].shippedTerm all 0; crafts[2].shippedTerm
   wakeLoss 0.25). Last result: as stated, evidence/2026-11-19/w3-wash/w3-wash-headless.json.
2. Giving the default craft the term moves the A6 hash. Same command, field a6: shippedHolds true, withTermHolds false.
3. The bench script typechecks: `cd tools/bench && npx tsc --noEmit -p .` - clean.
4. Gates once (`gates.py --only typecheck,vitest,architecture,i18n,b18,leaks`, staged tree): architecture, i18n, leaks
   PASS; typecheck, vitest, b18 FAIL for reasons outside this lane (see Not verified).

## Not verified

- No browser, no person, no phone and no real controller took part; no real flight or blackbox log was compared.
- Whether the Prop wash row is hidden or disabled on a whoop in the page (tools/bench/src/accept-v08-drones.ts D5 tests
  something near it); if it shows and does nothing, that breaks the owner's "no control that does nothing" rule.
- The whoop rotor diameters (55.9 / 31 mm) are read from the presets' prop strings, not measured.
- Gates in this copy: the apps/fly typecheck (src/sonic/sound-tour.ts:113) and 6 vitest cases (tools/bench/test/
  sonic-tour, sonic-moment-freeze, sonic-moment-card) fail because this copy's packages/sonic-fpv checkout is
  719aaf5 while origin/main pins 9ac7876 (left untouched: not this lane's); B18 names only docs/wip/train5-lead.md
  (from origin/main). None of them reads a file of this lane.
- The M1 descent is held by the script's own P loop on vertical speed (a pilot-like hold), so the thrust loss shows
  partly as more throttle, not only as sink.

## For the lead

- Was it there: yes, feec5618 (v08-d, 2026-10-16), packages/sim-core/src/wake.ts; setting bc8b7ab0; cap 4a21137d.
- Where it went: nowhere in code; it is opt-in per preset (D38, docs/decisions.md:76) and only nazgulf5v3, machr5sport,
  taurusx8 carry it; the default pavo20pro-3s (apps/fly/src/presets.ts:12, since bcef1bf6) never had it.
- A pilot today: default craft, 4 m/s descent and punch: 0 deg/s wobble, 0 % thrust lost. Setting physics.propWash
  (Settings > Drone, advanced, Expert level) does nothing on any whoop.
- Number: term ON (borrowed 5-inch estimates) on Pavo20: thrust -5.7 % mean in a 4 m/s descent, 2.1 deg/s, 0.11 deg;
  punch -25 % peak for 113 ms, 6.7 deg/s. Air65: -12.6 %, 5.6 deg/s; punch 11.2 deg/s. 5-inch shipped: 2.7 / 7.9 deg/s.
- Cheapest way back: three fields in pavo20pro-3s.json, but A6 moves (1d01ca5b -> 7ada5f20): owner's word +
  SIM_CORE_VERSION bump. And the shake is too weak to feel even then: the size needs a model change after research.
- Research must bring: loss and shake per class by disc loading, the shake spectrum, band edges and sideways fade,
  the duct's effect, whoop rotor diameters. Files changed: tools/bench/src/w3-wash-run.ts (new), evidence, this file.
  Deploy: none.

## Cost notes

- Step 1-5 (one run): the most replies went to the bench script (two re-runs: a forward dive with no sideways speed,
  then the wash-window metric); writing the manoeuvres once with a wash-only window would save two runs.
