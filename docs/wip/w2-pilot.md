# Lane w2-pilot (train 5): three things a pilot asked for after flying the live site

Branch w2-pilot from origin/main 1bda96d3. The pilot's words: vault brief lines 668-669 (Polish): no way to choose a
scene again (only next / random); the camera angle setting was hard to find; the drone breaks too fast when it touches
the ground (a lower sensitivity near the ground by default). His fourth point (better textures load slowly) is not this lane's.

## Status

- [x] S1 A, the ground: measurement, the softer default, the test, the negative control (25635abf)
- [x] S2 B, the camera line in the first-minute menu; the entry points of C and its plan (ten lines below) (79fc5cdb)
- [x] S3 C, "Choose a scan" on the crash card and as the pause item's label, with a test (this commit)
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

## B. The camera line

- "Before you fly" (apps/fly/src/ui/panels.ts warningModal, lane menu4's first-minute screen) gets one line under
  "You can change this any time": "Camera angle: key O opens Settings, then Camera, Camera uptilt." (`menu.level.camera`
  in fly/menu/{en,es,pl,ru}.json). The key comes from the keymap (`settings.open`), the three names are the Settings
  screen's own labels (pause.settings, group.camera, set.camera.uptiltDeg), so the line cannot drift from the screen.
- The camera angle has no key of its own (camera.uptiltDeg, 0..50 deg, level sim): the line names the settings path.

## C. Entry points and plan

Code differs from the lead's brief: the pause menu ALREADY has "Change scan" (`pause.scene`, app/builtin/scene.ts:45,
order 30, level first) -> `ctx.scenes.openPicker()` (app/scene-host.ts:149) -> `new ScenePicker(ctx.ui, showcase,
collections)`, the same component and data as the start page (app/boot.ts:82). Where a pilot meets "only next or random"
is the crash card (ui/crash-overlay.ts, row `cp-scenes`: Next N, Random Shift+N, Next favourite), the card a pilot who
breaks on landing sees most; and "Change scan" / "Zmien skan" does not say "choose". Plan (one stage of code is enough):
1. Crash card: a first button "Choose a scan" (data-action `scene-pick`) in `cp-scenes`; PanelActions.scenes.pick =
   `ctx.scenes.openPicker()` (app/builtin/crash.ts). Next, random and favourite stay. No new key (the picker has none).
2. Check the crash card leaves when the picker opens or a scene is picked (a 'session' event), else close it on pick.
3. The pause item says what it opens: `pause.scene` gets the catalogue's own title (`scenes.title`) in en/es/pl/ru.
4. Test tools/bench/test/w2-pilot-scene-pick.test.ts (fake DOM, as crash-overlay tests): the button is first in the
   row and runs pick; crash.ts wires it to openPicker; the label equals scenes.title in four locales. NEG on origin/main.
5. S4: the pause path (Esc, the item, a card) is old code, so on the live site it PASSES; the live FAILS are the crash
   card's `scene-pick` and the label. Said so in For the lead.

## C. What was built (S3)

- Crash card (ui/crash-overlay.ts): the scene row starts with "Choose a scan" (data-action `scene-pick`, no key, as the
  pause item has none); app/builtin/crash.ts wires it to `ctx.scenes.openPicker()`, the start page's ScenePicker over
  the flight (opaque, z-index 6, covers the card); a pick loads the scene and `load()` clears the crash; Esc goes back
  to the card. Next, random and favourite stay after it.
- The pause item `pause.scene` now wears `scenes.title` ("Choose a scan" / "Wybierz skan"); the key `pause.scene` is
  gone from the four locale files (nothing else used it). Its menu id is unchanged, so probes clicking
  `[data-action="pause.scene"]` still work.
- tools/bench/src/accept-v03-scenes.ts S3 expects the row with `scene-pick:null` first.

## What the owner does

(S4)

## Claims

1. At the page default a 5 m/s landing and a 5 m/s-down skid leave the Pavo20 whole; a 12 m/s dive into the ground and a
   5 m/s wall hit still crash it; vCrashGround 4 (or a header without it) crashes on the same landing.
   `npx vitest run packages/sim-core/test/ground-touch.test.ts tools/bench/test/app-settings.test.ts`: 47 passed;
   neg_control.py on origin/main (sim.ts params.ts crash.ts levels.ts app/prefs.ts): NEG OK.
2. Determinism and old logs hold: `npx vitest run packages/sim-core tools/bench/test/a6-reference.test.ts`: 335 passed.
3. "Before you fly" names the camera angle and its path in en and pl, and every locale has the line.
   `npx vitest run tools/bench/test/w2-pilot-camera-line.test.ts tools/bench/test/menu4-levels.test.ts`: 6 passed;
   neg_control.py on origin/main (panels.ts, fly/menu/*.json): NEG OK; `pnpm --filter ./apps/fly typecheck`: 0 errors.

4. The crash card's first scene button "Choose a scan" opens the catalogue (openPicker), next/random/favourite stay; the
   pause item wears the catalogue title in four locales.
   `npx vitest run tools/bench/test/w2-pilot-scene-pick.test.ts`: 3 passed; neg_control.py on origin/main (crash-overlay.ts,
   crash.ts, scene.ts, fly/{en,es,pl,ru}.json): NEG OK; `npx vitest run --changed origin/main`: 2307 passed;
   `pnpm --filter ./apps/fly typecheck`: 0 errors.

## Not verified

(S4)

## For the lead

(S4)

## Cost notes

- S1: most replies went to the preset-field design that would have broken saved replays (found by sim-core
  log-v2-compat) and to three counting tests in prefs/app-settings; reading runner.ts lifeParams first would have saved it.
- S2: most replies went to finding where "only next or random" comes from (the crash card, not the pause menu, which
  already opens the picker); grepping the pilot's words' buttons (`scene-random`) first would have found it at once.
  neg_control.py needs `npx.cmd`, not `npx`, on Windows.
- S3: most replies went to the fake DOM (no descendant selectors, no global addEventListener for app/diagnostics.ts);
  reading tools/bench/test/helpers/fake-dom.ts querySelectorAll first would have saved two runs.
