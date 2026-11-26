# Lane w2-pilot (train 5): three things a pilot asked for after flying the live site

Branch w2-pilot from origin/main 1bda96d3. The pilot's words: vault brief lines 668-669 (Polish): no way to choose a
scene again (only next / random); the camera angle setting was hard to find; the drone breaks too fast when it touches
the ground (a lower sensitivity near the ground by default). His fourth point (better textures load slowly) is not this lane's.

## Status

- [x] S1 A, the ground: measurement, the softer default, the test, the negative control (25635abf)
- [ ] S2 B, the camera line in the first-minute menu; the entry points of C and its plan (ten lines below)
- [ ] S3 C, the scene catalogue from the pause menu, with a test
- [ ] S4 the acceptance by mouse (local build PASS, live FAIL), gates once, For the lead

## A. The measurement (origin/main 1bda96d3)

- One rule for every contact: packages/sim-core/src/sim.ts `impact()` crashes the craft when a contact point approaches
  the surface at `approach >= p.vCrash` (m/s, the normal component of the contact point's velocity, the spin included:
  v + w x r). Nothing else damages or crashes the craft: no impulse, angle or damage counter exists; a crash disarms it.
- `p.vCrash` comes from the preset field `v_crash_ms` (estimate): 4.0 m/s for Pavo20 Pro (the default drone), Pavo20
  Pro II, Pavo Pico, Air65, Meteor65 Pro; 5.0 for Mach R5 Sport and Nazgul F5 V3; 3.0 for Taurus X8 (5 kg).
- The pilot's setting: Settings -> Crashes -> "Crash threshold" (`physics.vCrash`, per drone, 2..10 m/s, step 0.5,
  menu level expert) and the switch "Crashes" (`crash.enabled`; off = every hit is a bounce).
- So today a landing at 4 m/s breaks the default drone: a free fall from 0.8 m, or a gentle descent the pilot did
  not stop in time. The floor and a wall are the same.
- `p.vBounce` (1.5 m/s) only chooses the restitution of a contact that does not crash.

## A. The change

- A contact whose normal points up (ny >= `GROUND_NY` = 0.7, within about 45 deg of straight up) crashes from
  `p.vCrashGround`; every other contact (walls, gates, ceilings) from `p.vCrash` as before.
- New setting `physics.vCrashGround` "Ground touch threshold" (crash group, per drone, 2..12 m/s, step 0.5, default
  7 m/s = a free fall from 2.5 m, level expert, next to "Crash threshold"). The strict rule: set it to the crash threshold.
- Not a preset field, on purpose: every saved log names its preset by sha256 (presets unchanged since v0.3), so a
  changed preset JSON would make every saved flight refuse to replay (tried first: sim-core log-v2-compat failed).
  Instead sim-core uses `vCrashGround = override ?? vCrash`: a header without it (every log before, the a6 reference)
  flies exactly as before; the page writes the setting into every life header (apps/fly app/prefs.ts ALWAYS_IN_HEADER).
- a6 reference hash 1d01ca5b... holds (tools/bench/test/a6-reference.test.ts PASS); SIM_CORE_VERSION unchanged
  (no old trace changes: the default model without the override is bit for bit the old one).
- Side effect: at the start of a flight with all defaults the session's model is rebuilt once at the spawn by
  settings.ts applyToFlight (the path any pilot with one changed setting already took).

## What the owner does

(S4)

## Claims

1. At the page default a 5 m/s landing and a 5 m/s-down skid leave the Pavo20 whole; a 12 m/s dive into the ground and a
   5 m/s wall hit still crash it; vCrashGround 4 (or a header without it) crashes on the same landing.
   `npx vitest run packages/sim-core/test/ground-touch.test.ts tools/bench/test/app-settings.test.ts`: 47 passed;
   neg_control.py on origin/main (sim.ts params.ts crash.ts levels.ts app/prefs.ts): NEG OK.
2. Determinism and old logs hold: `npx vitest run packages/sim-core tools/bench/test/a6-reference.test.ts`: 335 passed.

## Not verified

(S4)

## For the lead

(S4)

## Cost notes

- S1: most replies went to the preset-field design that would have broken saved replays (found by sim-core
  log-v2-compat) and to three counting tests in prefs/app-settings; reading runner.ts lifeParams first would have saved it.
