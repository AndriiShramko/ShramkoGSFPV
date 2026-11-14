# Lane sonic3 (train 3): Fly by Sound in any scene, in place

Worktree C:/dev/gsfpv-center-throttle, branch sonic3 (from origin/main f91273cf). Package repo C:/dev/ShramkoSonicFPV, branch
train3 (from its main 197c2760). Design: docs/wip/sonic3-plan.md.

## Status

Stage fixes (review SO-1 to SO-10, package pin train3-fixes d341b4f, merged into train3 2e1618f):
- [x] SO-1 stands: in place the mode applied LESSON_FLIGHT (bump 'slide') as a 'life' setting on enter and took it back on
  leave, so every switch started a new life (in the air: stopped dead; crashed or held: the scene spawn). Fix: ModeStart.here
  (mode.ts), lessons.ts passes it; in place no lesson bump, so leave() changes nothing. Test sonic-in-place.test.ts "switched
  off while flying ... while crashed": 9 of 9; NEG OK (old mode.ts and lessons.ts: bump 'slide' after the switch on).
  sonic-scan-bump + sonic-mode: 9 of 9; apps/fly tsc 0 errors. The forced 'scene.walls' 'on' stays (see For the lead).
- [x] SO-2 stands: package lessons/scan-free.json version 1 -> 2 (d341b4f, branch train3-fixes from the old pin 4e7cef6, so
  the unpinned speed lessons of 9c40ed2 stay out of the pin; merged into train3 as 2e1618f). Package test/scan-free.test.ts new
  case, NEG OK on the old lesson file; package suite 1336 passed, 4 skipped; simulator tests that use scan-free (5 files): 44 of 44.
- [x] SO-5 stands: Facts now give the measured range 0.23 to 3.3 s with the run names.
- [x] SO-6 stands: Facts table has the Tunis 5 m/s fixed-pilot row.
- [x] SO-7 stands: the failure line uses {key} (KeyNames, as the intro's capOf) in en es pl ru; with no Web Audio the line is
  sonic.start.noAudio (another browser), else the next press makes a new AudioContext in that press (in-place-model.ts
  failedLine, in-place.ts). Test "the line leads on", NEG OK on the old locale files (5942b4a4).
- [x] SO-4 stands: r11 now ends each run with r11Off (pause item label hereOff, W held, Backslash in the same page task as the
  pose reads, moved under 0.1 m beyond own travel, speed at least half, no lesson after, label here) (5942b4a4).
- [~] SO-4 browser run: release build of 5942b4a4, r11 Tunis 887f27aa 5 m/s, port 5823 (U:/Temp/gsfpv-train3/sonic3/fixes-run.sh).
- [x] SO-9 stands: Decisions say the hum-attended pilot is the measure; the ladder and the 1.5 factor are marked estimates.
- [x] SO-10 stands: For the lead says only tier 1 is reachable today.
- [x] SO-3 stands, outside the lane (walls lane): For the lead. SO-8 stands: push of train3 is the lead's (For the lead).
- [ ] gates.py --only vitest,architecture,i18n,b18 after the browser run.

Stage Z5-prove (local release of cc103a49, package pin train3 4e7cef6, port 5820/5821, headless Chrome 157, GPU lock):
- [x] Release build (dist sha cc103a49, 1930 files). Probe r11 in tools/bench/src/sonic-int-review.ts (2f972a90): ordinary
  flight, Controls screen, ONE press of Backslash, first cue and first line timed, N, the course flown to its end with W
  pulsed to hold a speed (Z5_SCENE, Z5_SPEEDS, Z5_WALLS); r10 now reads the lessons item pause.flyBySoundLessons.
- [x] r10 (old case, Tunis): 14 of 14 PASS, course flown to its end (phase passed, 4 fly.stage lines, no last-lesson line).
- [x] r11 Tunis 887f27aa (shipped walls): 7 of 7 PASS at 2 and 5 m/s (Facts Z5).
- [x] r11 Wroclaw 70b50d42 (stand-in walls): 2 m/s PASS; 5 m/s FAIL: the probe's pilot held Shift with E (a chord, no
  turn) on a ledge 2 m above gate 10 for 270 s. Pilot fixed in ac9290c6 (turn first, then height; stall = no move and no turn).
- [x] Rerun with the fixed pilot (ac9290c6, U:/Temp/gsfpv-train3/sonic3/z5-rerun.sh): Wroclaw stand-in 7 of 7 PASS, both
  courses flown to their end, 5 m/s and 2 m/s (Facts Z5, z5-r11-wroclaw2.json).
- [x] Tunis 5 m/s with the fixed pilot: 4 of 4 PASS, course passed in 50 s (9 gate changes), W-held speed median 2.8,
  max 4.86 m/s, 0 dodges, N to gate 1 33.9 s, Backslash to first cue 3.3 s (U:/Temp/gsfpv-train3/sonic3/z5-r11-tunis2.json).
- [x] Wroclaw with walls BUILT, pass 2 rerun with rendering ON (Z5_RENDER=on, dist/walls empty, PORT 5822): again no
  course in 420 s. Lines: sonic.say.inPlaceOn, sonic.say.lessonKeys, sonic.say.wallsStill; /walls/70b50d42/v1/scene.voxel.json
  404 (expected: no stand-in); the probe's walls state read "walls": null (no walls hook answer). BLOCKED for this lane: the
  in-page build is apps/fly/src/walls (wallsThen), outside the lane; the lead or the walls lane must say why a headless page
  with rendering on builds no walls for 70b50d42 in 420 s (evidence U:/Temp/gsfpv-train3/sonic3/z5-r11-wroclaw-built2.json/.log).
- [~] Speed lessons, pass 2: built in the package, train3 9c40ed2 (NOT pinned yet): lessons/speed-1..4.json (the ring course
  of rings-course, caps 1.5 2.5 3.5 4.5 m/s, layers.racingLine and speedBudget on, after rings-course on the full path, orders
  of shapes-* and free-garden +4), locales en es pl ru, catalog.ts, library.ts, test/speed-ladder.test.ts 3 of 3 (NEG OK on
  the old library.ts and paths.json), tools/canon-lessons.ts (rewrites lesson files canonically). Package suite after it:
  8 FAIL of 1346 (log U:/Temp/gsfpv-train3/sonic3/pkg-vitest-z7.log), each a list pinned to the old 28 lessons; LEFT, in order:
  a. test/docs.test.ts: "a curriculum of 32 lessons" in CITATION.cff, README, llms.txt, AGENTS.md and the test protocol.
  b. test/pass-rule.test.ts v0.12 control and test/beacon-review.test.ts R1: restrict to lessons that existed in v0.12 /
     to lessons without layers.racingLine (speed-1 has beaconTarget != target by design: 1813 frames).
  c. test/world-scale.test.ts: "the room lessons are the eleven" and the 2-3 s leg rule fail for speed-1 and speed-2 (slow
     caps on 7 m legs): exclude the speed lessons from the room-scale rule (they are speed drills on a known course).
  d. test/lesson-schedule.test.ts (tts fixtures: every line measured) and test/words.test.ts (VL-4-words heard every line):
     the 28 new lines per language are not measured. Either measure them (test/fixtures/measure-tts.ps1, Windows voices) and
     rerun the words check, or list the speed lesson keys as added after those runs; first choice is to measure.
  e. test-audio/page/proofs.ts line 530 (from 9b26882): a quote inside a single-quoted string breaks tsc -p tsconfig.json
     (TS1005, TS1002); fix it, then run the line-side proof (Z4 left 1).
  f. Then the full package suite, pin move to the new commit, and in the simulator: r10/r11-style probe step that opens
     speed-1 from the lessons item and flies it to its end (release build first), gates.
  Ear pilot on the speed lessons (tools/ear-pilot.ts, line and budget on, rungs 1 2 3 4 6 8): hum attended median 6 m/s on
  each (6 6 6), 2 loudest median 4 (4 4 2); at the cap, hum attended, seeds 1 2 3: speed-1 27.8 to 28.3 s, speed-2 17.4 to
  17.6 s, speed-3 12.6 to 12.9 s, speed-4 10.0 to 10.1 s, all pass; attemptLimitS = ceil(slowest x 1.5) = 43, 27, 20, 16 s
  (package evidence/ear-pilot/2026-11-15-speed-lessons-*.json). With the 2-loudest pilot speed-3 and speed-4 exceed
  median / 1.25 (3.2): the lessons teach following the hum (the hum-attended pilot is the measure).
  Still left from Z4: racingLine on in scan courses, rear timbre, reach.ts, ear-pilot-scan.ts, the spoken tier change.
- [x] gates.py --only vitest,architecture,i18n,b18 on 2f972a90: all four PASS (vitest 129 s).

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
- [x] Pin of packages/sonic-fpv moved to package train3 e133411 (66267e6a).
- [x] gates.py --only vitest,architecture,i18n,b18 on 66267e6a: all four PASS (vitest 175 s), logs U:/Temp/gsfpv-gates-20261114-225951.
- [x] Pass 2, item 2: the rung lost by the 2-loudest pilot on rings was tier 1: a climb at 3 m/s cruise passes 3 m/s
  of speed (climb adds up to 3 m/s). Tier 1 now begins at 4.5 m/s (package 6cbd596, budget.ts TIER_EDGES_MPS, measured
  by tools/ear-pilot.ts, see Facts); test/budget-wired.test.ts holds rings-course at 3 m/s unchanged by the budget (NEG OK).
- [x] Pass 2, item 3: racing line (package 992c9db): src/cues/line.ts, layers.racingLine opt-in, runner.beaconTarget()
  returns the look-ahead point, planner hum takes the line's side level (10 dB at 30 deg) and beating (full 1.5 m off);
  ladder FlyOptions.line, tools/ear-pilot.ts --line on|off; test/line.test.ts 8 of 8, NEG OK on old runner.ts and planner.ts.
  The cue id stays target.hum (no new glossary text): the line is the hum aimed along the line.
- [x] Pass 2: tables after speed (tier edge 4.5) and after line (Facts), evidence in the package (4e7cef6).
- [x] Pass 2: audio proof line-side written (package 9b26882, test-audio/page/proofs.ts, PROOFS_OUT for a partial run).
  NOT run: C:/dev/.gpu-lock was held by another job for the whole wait; the waiting command was stopped before it took the lock.
- [x] Pin of packages/sonic-fpv moved to package train3 4e7cef6 (f0319977).
- [x] gates.py --only vitest,architecture,i18n,b18 on f0319977: all four PASS (vitest 185 s), logs U:/Temp/gsfpv-gates-20261114-231430.
- [ ] LEFT, in this order:
  1. Run the line-side proof: in C:/dev/ShramkoSonicFPV, under the GPU lock,
     PROOFS=line-side PROOFS_OUT=evidence/audio-proofs-line.json node node_modules/vitest/vitest.mjs run --config vitest.proof.config.ts;
     commit evidence/audio-proofs-line.json; if the shipped side is under 8 dB, raise LINE_SIDE_DB or report the measure.
  2. Switch the line on where a pilot flies a course: layers.racingLine true in the scan course lesson (scanCourseLesson in
     the package library) and the new speed lessons; not in shipped lessons with recordings (replay stays).
  3. Corridor stays 0 in every variant, with the line too: the pillar on the path (Facts Z3) is not solved by the line;
     find whether the track points pass the pillar (lessonTrack of corridor) and whether the line should bend around it.
  4. Z3 item 3 (simulator tools/bench/src/ear-pilot-scan.ts, Tunis and Wroclaw) and 4c (src/cues/reach.ts) still open.
  5. Rear timbre, approach brightness by time to the gate, reverb floor (plan 3), test/rear-timbre.test.ts, a proof each.
  6. Lesson turn-listen (plan 3) and speed-1..6 lessons (plan 4) with locales en es pl ru and spoken lines; pass marks from
     the ear pilot (each cap at most median / 1.25: from the after-line table rings 4 m/s (2 loudest) gives 3.2 m/s).
  7. Pin move and gates before handing over.

## Facts (measured)

- Z5 browser runs (tools/bench/src/sonic-int-review.ts r10 and r11, evidence copies in U:/Temp/gsfpv-train3/sonic3/z5-*.json,
  shots U:/Temp/gsfpv-train3/shots/z5-*.png). Backslash to first planned cue (height.tone, room.bed): 0.23 to 0.35 s in
  z5-r11-tunis.json (0.268, 0.251), z5-r11-wroclaw.json (0.283, 0.233) and the second run of z5-r11-wroclaw2.json (0.350);
  1.783 s in the first run of z5-r11-wroclaw2.json and 3.317 s in z5-r11-tunis2.json (both the first press of a fresh page
  in the fixed-pilot reruns; the cause of the longer time is not measured). Range over all runs: 0.23 to 3.3 s. First spoken
  line lesson.scan-free.title 0.235 to 3.321 s; phases intro then flying; nothing else pressed.
  | Scene, walls | asked m/s | N to gate 1 | course | flight | W-held speed median / max | dodges |
  |---|---|---|---|---|---|---|
  | Tunis, shipped | 2 | 51.8 s | passed, 12 gates | 139 s | 0.43 / 1.99 | 2 |
  | Tunis, shipped | 5 | 47.3 s | passed on attempt 3 (2 fails at g7) | 108 s | 4.19 / 5.00 | 0 |
  | Tunis, shipped, fixed pilot (z5-r11-tunis2.json) | 5 | 33.9 s | passed, 3-gate course looped 3 times (9 gate changes) | 50 s | 2.8 / 4.86 | 0 |
  | Wroclaw, stand-in | 2 | 110.5 s | passed (attempt 1 failed at g15) | 172 s | 0.51 / 1.99 | 0 |
  | Wroclaw, stand-in | 5 | 59.3 s | NOT passed: stuck at g10 (pilot fault, see Status) | 363 s cap | 2.84 / 4.98 | 1 |
  | Wroclaw, stand-in, fixed pilot | 5 | 61.9 s | passed on attempt 3 (6 gates) | 89 s | 3.73 / 5.00 | 0 |
  | Wroclaw, stand-in, fixed pilot | 2 | 81.4 s | passed on attempt 3 (failed at g10, then g4) | 209 s | 0.57 / 2.00 | 0 |
  | Wroclaw, built | 3 | none in 420 s (sonic.say.wallsStill) | - | - | - | - |
  | Wroclaw, built, render on (pass 2) | 3 | none in 420 s (sonic.say.wallsStill, walls state null) | - | - | - | - |
  The median of W-held samples is low at 2 m/s because W is pulsed and each restart from a turn is sampled.
  /walls/70b50d42/v1/scene.voxel.json and .bin answered 200 in the stand-in runs. r10 Tunis: 14 of 14 in 936 s.

- Z4 pass 2, the three tables (tools/ear-pilot.ts, beacon on, soft theme, seeds 1 2 3, rungs 1 2 3 4 6 8 10 12 15 18 22,
  budget on in both after-columns; package evidence/ear-pilot/2026-11-14-after-speed2-*.json and -after-line-*.json):

  | Pilot | rings before | rings after speed (edge 4.5) | rings after line | corridor before / speed / line |
  |---|---|---|---|---|
  | 2 loudest, turn 120 deg/s | 3 m/s (3 2 3) | 3 m/s (3 2 3) | 4 m/s (4 4 2) | 0 / 0 / 0 |
  | hum attended, turn 120 deg/s | 6 m/s (6 6 4) | 4 m/s (4 6 4) | 6 m/s (6 6 6) | 0 / 0 / 0 |

  The hum-attended rings median fell 6 to 4 after speed (seed 3 at 6 m/s: fail; the before run had seed 3 at 4 too), and
  the line gives it back with all three seeds at 6. Runtime corridor 46 to 73 s, rings 5 to 7 s per ladder.
- Tier edge probe (tools/ear-pilot.ts --lessons rings-course --rungs 2,3,4 --budget on, seeds 1 2 3): edge 3 and 3.2 gave
  2 m/s (2 2 2 with 3.2); edge 4.5 gave 3 m/s (3 2 3), the before value. Budget off at seed 1: 3 m/s.
- line.test.ts on rings-course 2 m/s seed 1: with the line the 5th percentile of the hum's distance is above 2.5 m, without
  it under 1.5 m (the gate passed); every frame with the hum 30 deg or more aside has 9.5 dB or more between the ears.
- Package tests touched: budget 7, budget-wired 6, line 8, lessons + ear-pilot + beacon-target 36 more: all pass;
  package tsc -p tsconfig.core.json: 0 errors. Simulator sonic-scan-free + sonic-in-place on the new pin: 12 of 12.

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
- Z7 (review SO-9): for the speed lessons the hum-attended ear pilot is the measure, not the 2-loudest reference of Z3: with
  the budget on the hum is one of the streams by rule, and the lessons teach following it. Estimates, not measured: the cap
  ladder 1.5 / 2.5 / 3.5 / 4.5 m/s (chosen steps under the measured 6 m/s median and the 4.8 ceiling) and the attempt factor
  1.5 (attemptLimitS = ceil(slowest ear-pilot time x 1.5)). Caps 3.5 and 4.5 are above the 2-loudest pilot's median / 1.25 =
  3.2 m/s. None of this ships until the speed lessons are pinned.
- Fixes stage: the free flight is scan-free version 2 since the stream budget (SO-2); in place the mode applies no lesson
  bump (SO-1), so a switch keeps the flight as it was.

## For the lead

- Pilot's guide (Z5). Keys a pilot uses: Backslash switches Fly by Sound on and off over any flight (also the pause item
  "Fly by Sound here"); W S forward and back, Q E turn, A D side, Space and Shift up and down (turn first: Shift with a letter
  is a chord); N makes a course of gates here (walls first when the scan has none); B the previous; R back to the last
  checkpoint (held: the start); I where am I; Z repeat the last line; G the glossary of sounds; K all keys; T record, U send;
  X home; Escape the menu with "Fly by Sound lessons" (new tab).
- The three ear-pilot tables (rings-course median top speed, seeds 1 2 3; corridor 0 in every column, a pillar on the path):
  before 3 m/s (2 loudest) and 6 m/s (hum attended); after the stream budget 3 and 4 m/s (tier edge 4.5); after the racing
  line 4 and 6 m/s (6 6 6). Details in Facts "Z4 pass 2, the three tables".
- What a listener should notice: one press, sound within 0.23 to 3.3 s (Facts Z5; under half a second in 5 of 7 runs; height tone and room bed), then the spoken intro
  once; near walls their pulses on that side; on N "making a course", then the hum of gate 1: it is louder in the ear it is
  on, and in a course with the line on (not shipped yet) it beats when the craft is off the line; at a gate its note and a
  short preview of the next; above 4.5 m/s fewer streams (tier 1: three). Only tier 1 can sound in anything that ships today:
  in place the pilot flies with scan-free's 5 m/s cap, so tier 2 (from 8 m/s: two streams and the open-way chime instead of the
  hazards, the height ticks off) has been measured only in the package's ear-pilot ladder, never in a shipped flight; the
  owner's "normal FPV speed" is not reached until a speed stage lifts that cap (review SO-10). Front and back can still be
  confused: turn a little and hear where the hum moves.

- Review fixes (stage fixes): SO-3 stands and is outside the lane: ctx.hook.walls.build for 70b50d42 in a headless page with
  rendering on did not resolve in 420 s (apps/fly/src/app/walls-then.ts, walls lane); rerun r11 with Z5_WALLS=built after it is
  found. SO-8 stands: the pin d341b4f and package branch train3 (2e1618f, which merges train3-fixes d341b4f) exist only in
  C:/dev/ShramkoSonicFPV; push train3 to the package origin before merging sonic3 (this lane may not push).
- SO-1 part left as it is: in place the mode still forces 'scene.walls' 'on' (mode.ts forceScanPrefs) because the sound reads
  the walls; a pilot who had walls off gets a walls change on the switch on and off (with the default walls on nothing changes).

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

- 2026-11-15 Z5 pass 2: most replies went to the speed lessons' fallout: 8 package tests pin the count of 28 lessons and
  every spoken line (tts fixtures, words run, docs counts, room scale); a list of "tests that pin the lesson set" in the
  package docs would have shown the cost before adding lessons, and the lessons belong in their own stage.

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
- 2026-11-14 Z4 pass 2: most replies went to the audio proof setup (reading proofs.ts and the evidence writer) and then
  waiting for the GPU lock another job held; a proof that needs no GPU (offline audio) should not take the GPU lock, or the
  lock should name its holder so a worker knows whether to wait.
- 2026-11-15 Z5-prove: most turns went to waiting for browser runs (GPU lock held 15 min by another job, then 10 to 15 min per
  run); one script queueing every run with the next one's setup would have cut the waits to one call; the walls-built case
  should have been run first with rendering on, as the walls lane did.
