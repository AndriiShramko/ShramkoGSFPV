# Lane w2-pilot (train 5): three things a pilot asked for after flying the live site

Branch w2-pilot from origin/main 1bda96d3. The pilot's words: vault brief lines 668-669 (Polish): no way to choose a
scene again (only next / random); the camera angle setting was hard to find; the drone breaks too fast when it touches
the ground (a lower sensitivity near the ground by default). His fourth point (better textures load slowly) is not this lane's.

## Status

- [x] S1 A, the ground: measurement, the softer default, the test, the negative control (25635abf)
- [x] S2 B, the camera line in the first-minute menu; the entry points of C and its plan (ten lines below) (79fc5cdb)
- [x] S3 C, "Choose a scan" on the crash card and as the pause item's label, with a test (this commit)
- [x] S4 the acceptance by mouse (local build 7/7 PASS, live FAILs the built steps) (09235b60), gates once, For the lead (this commit)

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

1. Open /en/fly/ (or /pl/fly/) in a fresh browser: "Before you fly" shows, under the three answers, the line "Camera
   angle: key O opens Settings, then Camera, Camera uptilt." ("Kat kamery: klawisz O otwiera Ustawienia, ..." in pl).
2. Fly and land hard on the floor (a free fall from about 2 m): the drone bounces and flies on. Dive into the ground from
   4 m or more, or hit a wall at 4 m/s: it still crashes. Settings, Crashes, "Ground touch threshold" (7 m/s; expert
   level): set it to the crash threshold (4) for the old strict ground.
3. In flight, Escape: the pause menu's item reads "Choose a scan"; a click opens the start page's catalogue; a click on a
   scan loads it and he flies there.
4. After a crash: Enter (Stay) on the toast, then the crash card's scene row starts with "Choose a scan" (the same
   catalogue), then Next, Random, Next favourite.

The acceptance itself: `node tools/bench/scripts/w2-pilot-accept.mjs <base without locale> <out.json>` (headless, 1536x730
at 1.25, about 2 minutes; it aborts every POST to the site's /api/, so it sends nothing).

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
5. By mouse at 1536x730 at 1.25 on a local release build of f0a97616: the pointer taken by a click; Escape, "Choose a
   scan", another scan loads and the craft climbs there; a ground touch at 5.42 m/s leaves it whole; a fall from 4.6 m
   crashes on the ground at 9.03 m/s; Enter on the crash toast, the card's first scene button "Choose a scan", another
   scan, flying; the camera line in en and pl inside the view. The same probe on the live site FAILS gentle (a 5.43 m/s
   ground touch crashes), cardPick (row: Next, Random, Next favourite), pausePick (label "Change scan"), cameraEn,
   cameraPl; capture and hard PASS there, as they should.
   `node tools/bench/scripts/w2-pilot-accept.mjs http://localhost:7401 <out>`: 7/7 PASS; the same with
   https://gsfpv.flyreelstudio.eu: 5 FAIL (evidence/2026-11-19/w2-pilot/accept-local.json, accept-live.json).
6. The repository gates hold. `gates.py --only typecheck,vitest,architecture,i18n,b18,leaks,catalog`: typecheck, vitest,
   architecture, i18n, leaks PASS; catalog was stale for physics.vCrashGround (S1) and b18 found Polish letters in
   three lane files: regenerated (scripts/gen-catalog.ts) and written as character codes, then `--only typecheck,catalog,b18`:
   typecheck PASS, catalog PASS, b18 FAIL naming only docs/wip/train5-lead.md (the lead note, see Not verified).

## Not verified

- No person, phone, radio or gamepad took part: the drops are the keyboard's pilot keys (set.input.play=pilot, W/S
  throttle) in a headless page with ?render=off; nothing was looked at in a picture (no screenshot taken).
- The gentle drop is not scripted to one speed: the keyboard climb varies, the touches measured on the local build were
  5.0 to 6.6 m/s (survived), and twice above 7 m/s when the craft spun (crashed, as the rule says). One landing touched
  the ground at 5.4 m/s, then bounced into a wall (ny 0) at 4.5 m/s and crashed: walls stay strict. The step judges the
  rule (no ground crash below 7 m/s, one whole landing at 4.6..6.9), up to 3 fresh profiles.
- Gamepad and radio sticks were not flown; the rule is in sim-core, the same for every input.
- Fresh lanes on origin/main after 1bda96d3 (54 commits) are not merged into this branch.
- Gate b18 FAILS naming only docs/wip/train5-lead.md: the lead note on a base older than its repair on origin/main
  (not this lane's file; not repaired, not merged for it).

## For the lead

- A: a ground touch (normal within 45 deg of up) crashes from 7 m/s, was 4.0 (Pavo20 Pro; every contact alike); walls,
  gates, ceilings still from vCrash 4.0. Setting physics.vCrashGround (Crashes, 2..12, expert). a6 hash holds, no version bump.
- B: "Before you fly" names the camera angle: key O, Settings, Camera, Camera uptilt (en/es/pl/ru).
- C: "Choose a scan" is the pause item's label (it already opened the start page's ScenePicker) and the crash card's
  first scene button; next, random, favourite stay.
- Files outside apps/fly: packages/sim-core (sim.ts, params.ts, a test), packages/prefs (defs/crash.ts, defs/levels.ts,
  tests), packages/i18n/locales/fly, tools/bench (accept-v03-scenes.ts, 3 tests, scripts/w2-pilot-accept.mjs). Page only.
- Live check after deploy: w2-pilot-accept.mjs against the site turns 7/7 PASS (today 5 FAIL, evidence accept-live.json).
- Not done: a crash with respawn.auto (default) shows a toast naming only N and Shift+F; "Choose a scan" is one Enter
  away (the card) or Escape. A toast hint for it would close the pilot's point fully.
- Not verified: no person, radio or gamepad; a scan's floor may lie 1-2 m under the spawn disc (platform.ts).

## Cost notes

- S1: most replies went to the preset-field design that would have broken saved replays (found by sim-core
  log-v2-compat) and to three counting tests in prefs/app-settings; reading runner.ts lifeParams first would have saved it.
- S2: most replies went to finding where "only next or random" comes from (the crash card, not the pause menu, which
  already opens the picker); grepping the pilot's words' buttons (`scene-random`) first would have found it at once.
  neg_control.py needs `npx.cmd`, not `npx`, on Windows.
- S3: most replies went to the fake DOM (no descendant selectors, no global addEventListener for app/diagnostics.ts);
  reading tools/bench/test/helpers/fake-dom.ts querySelectorAll first would have saved two runs.
- S4: most replies went to making a keyboard drop land at a known speed on a real scan (the spawn's one-way disc, low
  ceilings, a noisy climb in a headless page); reading platform.ts and judging the sim's own contact events from the
  first run would have saved about ten probe runs. Routing every request in Playwright stalls the scan downloads.
- Review: most turns went to reading the level filter of the Settings screen to prove the camera line; a status line
  naming each text's menu level would have made it one grep.

## Review

Verdict: SHIP (independent check, 2026-11-28; review file U:/Temp/gsfpv-train4/reviews/w2-pilot.md).
- Repaired (c53abcc2): at menu level first (the first, focused answer of Before you fly) Settings had no Camera group,
  so the camera line pointed to a path not on the screen; camera.uptiltDeg moved to level first, test in
  w2-pilot-camera-line.test.ts, NEG OK.
- Mouse run on a local release build of 81d38d6b (evidence accept-review.json): 6/7 PASS; gentle FAILED: two of three
  1.3 m drops on scene 7a475d38 crashed on a contact with ny 0.59 (6.36 m/s) and ny 0.15 (4.76 m/s) after a ground touch
  survived; the third survived a 4.06 m/s ground touch (the base crashes from 4.0). Not worse than live; on an uneven
  scan floor the softer ground helps only where the normal is within 45 deg of up.

