# Lane sonic3 (train 3): Fly by Sound in any scene, in place

Worktree C:/dev/gsfpv-center-throttle, branch sonic3 (from origin/main f91273cf). Package repo C:/dev/ShramkoSonicFPV, branch
train3 (from its main 197c2760). Design: docs/wip/sonic3-plan.md.

## Status

Stage Z1-any-scene-in-place:
- [x] Step 1: owner's path walked on the LIVE site (read only), Tunis 887f27aa and Wroclaw 70b50d42; findings in
  sonic3-plan.md "What stops a pilot today"; probe tools/bench/scripts/sonic-walk-probe.mjs (this commit).
- [x] Step 3: package README line "Spatial-audio consultant: Bartlomiej Mroz (Gdansk University of Technology)" (Polish
  letters in README.md), earlier sentence removed; test/docs.test.ts holds it. Package commit 2ec8653 on train3.
- [x] Step 2: the in-place switch (this commit). Backslash (KEYMAP action flyBySound.toggle, when 'always') and the pause item
  "Fly by Sound here" switch the mode on over the running flight: sonic/in-place-model.ts InPlaceSwitch (pure) and
  sonic/in-place.ts (wiring, loaded by import() at the first press); free flight = scan-free template on the scene flown now at
  its size (a built-in world too: no package change was needed, scanFreeLesson takes any scene id); feature.ts scanLesson gives
  the craft's pose as the start when `here`; lessons.ts openFree(lesson, { here }) keeps it for every reopen (walls in, failed
  course). First-timer line sonic.say.inPlaceIntro once (store.ts fliesBySound). Lesson menu Leave and X switch off / open the
  lessons tab when there is no start screen. Second pause item "Fly by Sound lessons" keeps the new-tab link.
- [x] Pin of packages/sonic-fpv moved to package train3 2ec8653 (this commit).
- [x] gates.py --only vitest,architecture,i18n,b18 on 98ef20d8: all four PASS (vitest 197 s), logs U:/Temp/gsfpv-gates-20261114-221332.
- [ ] Browser proof (own stage, release build first) on Tunis and Wroclaw with the walls stand-in.

Stage Z2-design-speed-and-space:
- [x] docs/wip/sonic3-plan.md Part 2 (this commit): what is a mess at speed (every cue's reach today, from the code), reach in
  seconds, speed tiers with a stream budget and a priority table, the racing line, space codes that do not rest on the HRTF
  (rear timbre, approach, ILD at speed, reverb floor, turn-and-listen lesson), the ear pilot check and speed lesson ladder, later
  designs (web camera head tracking, HRTF pick test, phone app), build stages Z3 to Z8 with files and tests.
- [x] gates.py --only vitest,architecture,i18n,b18 on eac597c8: all four PASS (vitest 133 s), logs U:/Temp/gsfpv-gates-20261114-222253.
- [ ] Z4 reach and budget, Z5 racing line, Z6 space codes, Z7 speed lessons, Z8 browser proof (plan section 6).

Stage Z3-ear-pilot-and-speed (worker 1 stopped at its reply budget, clean commits):
- [x] Package train3 6079170: src/pilot/perceive.ts (Ear: FramePlan voices to percepts: 2 loudest after layer gain and
  urgent duck, side by 10 deg / 2 dB ILD, 29 % front-back flips seeded per voice, hum elevation and on-course octave from
  its pitch against a learned base note; never reads distance), src/pilot/ear-pilot.ts (EarPilot: 250 ms delay, turn to
  the hum's side, 1.5 s hum memory, dodge, urgent brake, ceiling/floor by timbre), src/pilot/craft.ts (velocity craft,
  8 m/s2, 180 deg/s, climb 3 m/s), src/pilot/ladder.ts (flyLesson, ladder: runner + planner host loop, pass = runner
  attempt-pass with 0 touches within 3 x course length / speed; trace hook), tools/ear-pilot.ts (ladder over lessons,
  writes JSON), tools/ear-debug.ts (one flight's trace). Typecheck tsconfig.core.json: 0 errors.
- [x] First 'before' run (package rules of train3 2ec8653, beacon on, soft theme), evidence/ear-pilot/2026-11-14-train3-2ec8653.json.
- [x] 1. Corridor and full ladder (package afec518): Hearing.attendHum (the hum is always one of the 2 streams) as an option,
  default off as the plan says; both run on rungs 1..22, table in Facts "Z3 before table". Corridor is 0 in every variant.
- [x] 2. test/ear-pilot.test.ts (package afec518): 5 of 5 pass; the swapped and deaf cases are the controls (each fails the
  lowest rung on rings-course by assertion while the true sound passes it with seeds 1 2 3).
- [x] 4a. Package 2d83aa9: src/cues/budget.ts (TierGate: tiers at 3, 8, 15 m/s, down at 85 %, hold 500 ms; applyBudget:
  streams by rank urgent hazard, guide, open-way chime, other hazards, shape; tier 1 keeps 3 and no shape, tier 2 and up
  keeps 2 and the chime replaces the hazards; previews never cut; layerPlanOn: ticks and height tone off at tier 2 and up).
  Pure, NOT wired into the planner yet. test/budget.test.ts 7 of 7.
- [x] Pin of packages/sonic-fpv moved to package train3 2d83aa9 (this commit; the engine imports neither src/pilot nor budget.ts).
- [ ] LEFT, in this order:
  3. Simulator tools/bench/src/ear-pilot-scan.ts on Tunis 887f27aa and Wroclaw 70b50d42 (walls stand-in), plan section 4.
  4b. Wire budget.ts into planner.ts plan(): tried and reverted in pass 2 (diff: `tiers = new TierGate()` field, reset,
     `tier = tiers.update(length(s.vel), t)` before height/speed, `applyBudget(requests, tier, urgentKeys)` before
     `moving.assign`, urgentKeys = scene.hazards with isUrgent as `safety:${h.sector}`, FramePlan `tier?`, cut keys into
     `dropped`). With it 8 package tests fail (themes unbumped): elevation.test.ts 4 open-way chime cases (the chime is
     checked in frames flown at speed), cues.test.ts "at most 8 moving voices, hazards first", lesson-schedule.test.ts
     ears-shapes (shape cut at tier 1: 0.74 of frames heard, needs 0.9; fix: never cut the shape trace in a lesson whose
     layers have no target, or keep budget off in module 0), beacon-listen.test.ts tunnel-wide and beacon-target.test.ts
     (recordings at speed replay differently: bump themes/clear, race, soft "version" 2 to 3; then replay.test.ts and
     sonic-keys-versions.test.ts expectations about the build's own version need the new number: with the bump 11 fail).
     Log U:/Temp/gsfpv-train3/sonic3/pkg-vitest-z4.log, pkg-z4-fails.log.
  4c. src/cues/reach.ts (plan 2.1 table as data, reachM(cue, speedMps)), wiring in sampler.ts rangeS and freeway.ts depth by
     time, test/reach.test.ts with a negative control.
  4d. Ear pilot after-run (tools/ear-pilot.ts, rungs 1..22, both columns) against the before table; a course that loses
     more than one rung is not handed over. Then move the pin again.
  5. gates.py --only vitest,architecture,i18n,b18 on the worktree before handing over (pass 2 ran it on this commit: see Facts).

Stage Z4-line-space-lessons (worker 1 stopped at its reply budget, clean commits):
- [x] 4b. Budget wired (package f8688dd): planner.ts plan() runs TierGate and applyBudget only when the lesson's
  layers.speedBudget is true (new optional field, contract.ts LessonLayers, validate.ts); absent = off, so every shipped
  lesson and every recording sounds and replays as before (package suite 65 files, 1321 tests pass, no theme bump needed).
  On in lessons/scan-free.json, the free flight that "Fly by Sound here" opens on any scan. FramePlan.tier; cut keys go to
  `dropped`; height and speed layers off at tier 2. Ladder FlyOptions.budget and tools/ear-pilot.ts --budget on|off.
  test/budget-wired.test.ts 5 of 5, NEG OK on the old planner.ts and scan-free.json.
- [x] 4d. After-speed ear pilot runs (package e133411), table "Z4 after speed" in Facts.
- [x] Pin of packages/sonic-fpv moved to package train3 e133411 (this commit).
- [ ] LEFT, in this order:
  1. Z3 item 3 (simulator tools/bench/src/ear-pilot-scan.ts, Tunis and Wroclaw) and 4c (src/cues/reach.ts) are still open.
  2. The one rung lost by the 2-loudest pilot on rings (seed 1: 3 to 2 m/s): see if it is the shape trace cut at tier 1
     (tier 1 begins exactly at 3 m/s); ear-debug at 3 m/s seed 1 with --budget on vs off.
  3. Racing line (plan 2.3): pure src/cues/line.ts (polyline of the runner's track points, Catmull-Rom, arc position never
     back more than 2 m, look-ahead max(3 m, 1.0 s x v), off-line distance); wiring: runner.beaconTarget() returns the
     look-ahead point when layers.racingLine (new optional field, as speedBudget) is on; target.hum then points there
     (beacon fold and ILD exist in planner.targetVoice); side ILD up to 10 dB at 30 deg; beating by off-line distance;
     test/line.test.ts with a negative control; ear pilot "after line" table (third table); offline render as audio proof.
  4. Rear timbre, approach brightness by time to the gate, reverb floor (plan 3), test/rear-timbre.test.ts.
  5. Lesson turn-listen (plan 3) and speed-1..6 lessons (plan 4) with locales en es pl ru and spoken lines; the ladder's
     pass marks from the ear pilot (each cap at most median / 1.25).
  6. Offline renders of each new cue as the package's audio proofs; pin move; gates before handing over.

## Facts (measured)

- Z4 after speed (tools/ear-pilot.ts --budget on, package f8688dd, beacon on, soft theme, seeds 1 2 3, rungs 1..22;
  evidence/ear-pilot/2026-11-14-after-speed-loudest.json and -after-speed-attend-hum.json), against the Z3 before table:

  | Pilot | rings before | rings after speed | corridor before | corridor after speed |
  |---|---|---|---|---|
  | 2 loudest, turn 120 deg/s | 3 m/s (3 2 3) | 2 m/s (2 2 3) | 0 | 0 |
  | hum attended, turn 120 deg/s | 6 m/s (6 6 4) | 6 m/s (4 6 6) | 0 | 0 |

  Runtime 77 s and 68 s corridor, 8 s and 7 s rings. The third table (after line) does not exist yet: the line is not built.
- Ladder flights with the budget (debug test, removed): corridor 6 and 10 m/s reach tier 1 only (the pilot brakes, top
  measured speed 5.1 and 7.1 m/s, touch at 8.8 s and 5.3 s); rings-course 10 m/s reaches tier 2 (fail at 1.9 s).
- Simulator after the pin move: vitest 327 files passed, 1 skipped (4733 tests); apps/fly tsc 0 errors. Package tsc 0 errors.

- Live walk, sonic-walk-probe.mjs, 2026-11-14, results U:/Temp/gsfpv-train3/sonic3/walk-live-887f27aa.json and
  walk-live-70b50d42.json: pause item href /en/fly/?sonic=scan&scene=<id>&sz=1, target _blank, a new tab opened (newTab true)
  on both scans; the new tab showed the start screen with "Start the course from the beginning" first; status stayed loading
  and no sound line for 271 s with nothing pressed (steps 6 to 7, 24 s to 295 s on Tunis).
- Wroclaw 70b50d42 live: walls 0.0 MB downloaded, top bar "No walls yet: C builds them.", walls off.
- Package docs test: 10 of 10 passed with the new README; on main's README it fails by an assertion (negative control).
- Step 2 unit tests: sonic-in-place, sonic-optin, sonic-int-lazy, sonic-walls-free, sonic-scan-free, sonic-scan-course, keymap,
  app-keys: 8 files, 100 of 100 passed. Typecheck apps/fly and packages/prefs: 0 errors each.
- Negative controls (neg_control.py, ref origin/main) for sonic-in-place.test.ts: keymap.ts NEG OK (expected null to be
  'flyBySound.toggle'); sonic-flight.ts NEG OK (expect(item.href).toBeUndefined fails); lessons.ts NEG OK (craft back at the
  spawn: 0.0002 m, expected over 3 m). Logs U:/Temp/gsfpv-train3/sonic3/neg-*.log.
- The runner itself places the craft at its start pose when a lesson begins (package runner.ts begin, 'place' action), so
  keeping the position needs the start = the craft's pose (feature.ts scanLesson `here`), not only skipping mode.place.

- Z3 baseline (tools/ear-pilot.ts, package train3 6079170 on rules of 2ec8653, beacon on, theme soft, seeds 1 2 3, rungs
  1 2 3 4 6 8 10 m/s): rings-course median top 3 m/s (by seed 3, 2, 3; above it: touches and fails); corridor 0 (at 1 m/s a touch at 56 s:
  side-wall pulses mask the hum, see LEFT 1). Runtime 31 s corridor, 4 s rings.
- Z3 before table (tools/ear-pilot.ts, package afec518 with the cue rules of 2ec8653, beacon on, soft theme, seeds 1 2 3,
  rungs 1 2 3 4 6 8 10 12 15 18 22 m/s; evidence/ear-pilot/2026-11-14-before-loudest.json and -before-attend-hum.json):

  | Pilot | rings-course median top (by seed) | corridor median top |
  |---|---|---|
  | 2 loudest streams (plan), turn 120 deg/s | 3 m/s (3 2 3); 8 m/s and up: touch or fail every seed | 0 (touch every rung) |
  | hum always attended, turn 120 deg/s | 6 m/s (6 6 4); 8 m/s touch, 10 m/s and up fail | 0 (touch every rung) |
  | 2 loudest, turn 60 / 40 deg/s (rungs 1..6) | 2 / 3 m/s | 0 / 0 |
  | hum attended, turn 60 / 40 deg/s (rungs 1..6) | 6 (6 6 6) / 3 m/s | 0 / 0 |

  Corridor with the hum attended, 1 m/s seed 1 (ear-debug --attend-hum): the touch is at z -20, where a pillar sits on
  the path: the obstacle pulse comes centred (side 0, no side to dodge to), not urgent until close, and the open-way chime
  (right) is not among the 2 streams; so the corridor is 0 for want of a side code of the free way, not for the hum alone.
  Ladder runtime: corridor 50 s, rings 7 s.
- Z4 part: package budget.test.ts 7 of 7; mutation controls (each mutant in budget.ts, then restored by git checkout):
  TIER_DOWN_SHARE 1 fails the hysteresis case (99 tier changes, expected 0), TIER_STREAMS 9 fails 2 cases, the chime rule at
  tier 9 fails 1 case, all by assertion. ear-pilot.test.ts 5 of 5. Package typecheck tsconfig.core.json and tsconfig.json: 0 errors.
- gates.py --only vitest,architecture,i18n,b18 on 3a0f219f: all four PASS (vitest 157 s), logs U:/Temp/gsfpv-gates-20261114-224403.
- Z2: the numbers of plan Part 2 section 1 are constants read from the package code (train3 2ec8653: sampler.ts, rules.ts,
  beacon.ts, freeway.ts, planner.ts, voices.ts, themes/*.json printed by a node one-liner), the seconds are those constants
  divided by the speed; nothing in Z2 was measured by a run. Lesson speed caps: lessons/*.json maxSpeedMps 0 to 5, 12 lessons at 3.

## Decisions

- In place = install sonic/feature.ts installSonicFlight on the running flight context after the press (the KeyRouter's sonic
  option is already a live function of sonicEntry()), not a new page.
- Action name flyBySound.toggle, not sonic.inPlace: app-keys.test.ts holds that no 'sonic.*' action is listed on an ordinary
  page, and this key must be listed on every page.
- Switching on in place opens the free flight with its own assists (velocity control, 5 m/s top as scan-free.json sets): the
  speed stages of this train change that, not this step.
- Key Backslash: every plain letter is bound (keymap.ts) and no binding names Backslash (grep 'Slash' in keymap.ts: 0). Not
  Shift plus S: Shift is a flying key in the game scheme (app/keys.ts shiftIsFlying note), that chord would fire while descending.

- Z2: the ear pilot comes first (Z3) so every later change has a before and after; it lives in the package (src/pilot,
  DOM-free) and its scan runs in the simulator (tools/bench/src/ear-pilot-scan.ts) because walls and courses live there.
- Z2: at speed a cut stream stops (fades out), it is not only ducked: the owner asked for fewer sounds, not quieter ones.
- Z2: every new threshold in the plan is marked an estimate; the ear pilot sets the final values.
- Z3: the measure keeps the plan's pilot (2 loudest streams, turn 120 deg/s) as the reference; the hum-attended column is
  recorded beside it because the stream budget of Z4 makes the guide one of the 2 streams by rule, so it is the target the
  budget must reach without the pilot's help.

- Z4: the budget is a lesson opt-in (layers.speedBudget), not a theme change: the shipped lessons, their recordings and
  the theme versions stay as they were; new speed lessons and the free flight switch it on.

## For the lead

- Z4: the pin points at package train3 e133411 (local only, not pushed). The stream budget is a lesson opt-in
  (layers.speedBudget), on only in scan-free; courses and speed lessons get it when they are built.

- Step 2 is built (98ef20d8); the browser proof is the next stage (release build first; Tunis 887f27aa and Wroclaw 70b50d42
  with the walls stand-in): fly, Backslash, intro and first cue heard, pose unchanged, walls build spoken on Wroclaw, N a course,
  Backslash off.
- The pin points at package train3 2ec8653, which is only in C:/dev/ShramkoSonicFPV (not pushed): the package branch must reach
  its origin before the merge.
- Old tests changed on purpose (the owner's message 51 overrides v12-optin's "one quiet link, no key"): sonic-optin.test.ts and
  sonic-int-lazy.test.ts now expect two items and the in-place key; sonic-lesson-rig.ts honours `here` as feature.ts does.

- Z2 needs reading by the lead (no web access here): the Cat3DA repository (licence, face tracker and its licence, motion-to-sound
  delay, rotation method; plan 5.1) and the licences of SADIE II and HUTUBS (plan 5.2).
- Z2 plan 4 quotes the consultant's 29 % quadrant error for a generic HRTF from the vault note as the ear pilot's confusion rate.

## Not verified
- Z4 4b: nothing heard in a browser; the budget acts only in the free flight (scan-free), not in courses or lessons yet;
  the 2-loudest pilot lost one rung on rings (allowed by the plan's rule, cause not yet found).
- Z3/Z4 pass 2: the scan ear pilot (Tunis, Wroclaw) not built; the budget is not wired, so no 'after' run exists and the
  owner hears no change yet; the 85 % / 500 ms / 3-8-15 m/s values are estimates. tsconfig.node.json typecheck not run.
- Z3: the corridor baseline of 0 may be a fault of the ladder or the pilot, not of the cues (LEFT item 1). The ear pilot's
  gains (turn 120 deg/s, dodge 1 m/s, brake 0.3, memory 1.5 s, delay 250 ms) are estimates; rungs 12 to 22 not run.
- Z2: the plan's speed tiers, look-ahead, stream counts and pass marks are estimates; no ear pilot exists yet to measure them.
- Z2: the onset counts at speed (about 44 per second, soft theme) are arithmetic from theme constants, not a recording of the
  engine.

- The live walk did not reach the first cue: the probe looked for '.screen button' and the start screen uses other markup, so it
  pressed nothing in the new tab. The screenshots show the screen; what the second press does was read in code (lessons.ts open,
  mode.place(start)), not seen in a browser.
- Backslash on Polish and Russian keyboard layouts (code Backslash exists on both; its printed cap not checked).
- Nothing of step 2 was seen in a browser yet: the sound starting from a key press after the import() (Chrome's autoplay rule
  with sticky activation), the built-in world's walls heard through ScanSonicWorld, the menu label switching to "Switch off",
  X and the lesson menu's Lessons item opening the new tab, the respawn at the craft's own pose when the runner begins (the
  craft stops dead for a moment: velocity reset).
- a6-reference.test.ts not run: only the keymap gained a binding; flight, input devices and collision code are unchanged.

## Cost notes

- 2026-11-14 Z1: most replies went to reading the sound mode's entry chain (boot, start, feature, lessons) before design; a
  short agent-map section "how the mode is installed and what it needs at install time" would have saved four reads.
- 2026-11-14 Z1 pass 2: the most replies went to old tests that pinned the replaced design (optin, int-lazy) and to the stale
  submodule checkout (scanFreeLesson missing until the pin moved); moving the pin first and grepping tests for the item id
  before editing would have saved four replies.
- 2026-11-14 Z2: most replies went to finding each cue's reach constant across six package files and three theme JSONs; a
  generated table of every cue's reach constant (name, file, unit) in the package's docs would have made it one read.
- 2026-11-14 Z3: most replies went to reading the planner's frame types and the runner's host loop to build the ear
  pilot; a short doc of the host loop contract (actions, events, pass) next to test/helpers/pilot.ts would have saved four.
- 2026-11-14 Z3 pass 2: most replies went to wiring the budget into the planner and finding which 8 old tests pin cue sets at
  speed; a list of the tests that fly above 3 m/s (and of the replay fixtures tied to theme versions) would have shown the
  cost before the edit, and the stage would have split wiring into its own stage from the start.
- 2026-11-14 Z4-line-space-lessons: the stage held five builds (line, rear timbre, reverb, two lesson kinds) plus the
  unfinished Z3 items; most replies went to the budget wiring and a debug of why the corridor never reached tier 2 (vitest
  hides console output; a trace option in tools/ear-pilot.ts printing max tier and speed would have been one command).
  A lesson-level opt-in flag (layers.speedBudget) avoided the 11 replay and theme-version failures of pass 2.
