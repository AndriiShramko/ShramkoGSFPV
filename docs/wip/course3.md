---
type: status
status: active
summary: Lane course3 (train 3): progress of the walls build and of the course generation, then the course spread, height and respawn
created: 2026-11-14
---

# Lane course3 (train 3)

Worktree C:/dev/gsfpv-rooms, branch course3 from origin/main 197c2760. Ports 5720-5739.

## Status

Stage G1-progress (the owner's message 51: "I do not understand whether it hung or is working, at which stage, how long to wait").

- [x] Pure progress model apps/fly/src/course/progress.ts: ProgressClock (step, n of m, percent, time so far, what is left;
  past its estimate the line says "longer than usual, still working"), progressLine, spokenLine, SpeechPacer, layTries,
  courseTryMs, wallsSteps, isParked. Locale lines progress.* (17 keys) in packages/i18n/locales/fly/course/{en,es,pl,ru}.json.
- [x] Walls build (walls.ts): the box line is re-drawn every PROGRESS_TICK_MS (1 s) for the base build and the refine; bakeBase
  reports every ladder step's Gaussians (bake.ts onStep) so a lighter way gets its own estimate and name; the end line says
  what comes next when a course waits ("Now the course is being built; its progress follows here."); a failed build keeps it.
- [x] Course generation: the worker posts a progress message before the free-space pass and before every try (estimate of the
  first try from the cell and the free space, of later tries from what the last took); builtin/course.ts shows it on the HUD
  every second and in hook.course.progress.
- [x] A course that arrives while the drone flies (not parked at the spawn) is announced, its gates appear COURSE_WARN_MS (3 s) later.
- [x] Fly by Sound: both lines spoken through the spoken-line hook (app/say-via.ts sayVia, key sonic.say.text; the walls through
  a new WallsOptions.speak set in app/builtin/walls.ts), on every new step and else every 20 s.
- [x] Unit tests tools/bench/test/course-progress.test.ts (13) with walls-ladder.test.ts: 26/26 passed; typecheck apps/fly and tools/bench clean.
- [x] Negative controls: old bake.ts -> the onStep test fails ("expected [] to deeply equal [[10770000,0],[5390000,1]]");
  old course/en.json -> the locale test fails by assertion (neg_control.py NEG OK). Commit 39eefbc0.
- [x] Gates vitest, architecture, i18n, b18: all PASS (vitest 99 s; logs U:/Temp/gsfpv-gates-20261114-215628).
- [x] Line seen in a browser (pass 2): page probe tools/bench/scripts/progress-look-probe.mjs (commit 4f434ef8) on a local
  release of 4f434ef8 (serve-csp 5720, GPU lock, dist/walls empty so Wroclaw builds), Shift+G once, read every 500 ms.
  Runner U:/Temp/gsfpv-train3/course3/g1-look.sh, result g1-look.json, shots U:/Temp/gsfpv-train3/shots/g1-progress-*.png.
  Tunis and Wroclaw: lines step by step, course arrived, 0 page errors. Gates architecture and b18 PASS after the probe.
- [!] Wroclaw breaks "never silent for more than 2 s": three main-thread freezes (Facts G1-look). Cause outside the
  lane (splat-transform's own CPU work on the page's main thread); not worked around, see For the lead.

## Facts (measured)

- Course try time, tools/bench/scripts/course-rate.mjs over the K1.1 audit (U:/Temp/gsfpv-train2/tracks2/audit-new, Node 22,
  this PC): ms per generateCourse try at 5 cm walls 46116 (70b50d42), 30733 (887f27aa), 42767 (9baef54b), 32729 (ba7aa29d),
  mean 38086 -> COURSE_TRY_MS_5CM 38100; at 10 cm 5454 (0230d903) and 6345 (1994c65c); at 20 cm 888 (eb5f51dc); ab5efa0e
  (29 m3 free) 479. Factor about 6.5 per halving of the cell -> exponent 2.7. Mean tries per fitCourse 1.00-1.40 on big scans,
  4.06 on ab5efa0e. Leaf count does not predict the time (ms per M leaf 99 to 44369), the cell does.
- Free-space pass (same audit, freeMs): 62 to 2376 ms -> FREE_SPACE_MS 2400 (the most).
- Walls voxelising per million Gaussians (lastBake.ms of the walls lane's probes, U:/Temp/gsfpv-train2/walls ladder.json,
  ladder-fixes.json, w3-chain*.json): Tunis 4.02 M 7.42, 6.64, 6.44 s; Wroclaw level 2 10.72 M 29.3 s (read 89.4 s, total
  118.8 s) -> VOXELIZE_S_PER_MILLION 2.74 (the most). The total per million is bake.ts LADDER_S_PER_MILLION 9.5 (walls-trials.ts)
  or the machine's own loadBakeSpeed when slower; reading is the rest.
- G1-look (progress-look-probe.mjs, g1-look.json, 1280x720 headless, this PC). Tunis 887f27aa (shipped walls): course line
  from 0.0 s ("finding the free space. Step 1 of 2"), then "placing the gates and obstacles. Step 2 of 2" 5 % to 40 %,
  estimate "about 0:45 left", course in 16.1 s (13 gates); longest time the shown text did not change 1.36 s.
  Wroclaw 70b50d42 (no walls served, build ran): walls line from 0.0 s "reading the scan. Step 2 of 3 ... about 2:00 left",
  "longer than usual, still working" from about 1:20 of the reading step, "building the walls on your graphics card. Step 3
  of 3" from 101.7 s, built in 121 s (estimate 2:00); end line "Walls built in 121 s ... Now the course is being built; its
  progress follows here."; course 122.2 s to 174.7 s (52 s against "about 0:45", "longer than usual" from 0:49), 17 gates.
  Freezes (no line change and no page.evaluate answered): 13.5 s from 88.3 s (end of materializeToDataTable / cropToCore
  before onStage voxelize, bake.ts 439-446), 10.0 s from 110.4 s (end of writeVoxel, bake.ts 463), 4.8 s from 122.2 s
  (just after the walls came in, before the worker's first lay message; cause not found).
- Settings, not measured: PROGRESS_TICK_MS 1000, SPEAK_EVERY_MS 20000, SPEAK_GAP_MS 4000, COURSE_WARN_MS 3000, SIZE_MS 1000,
  COURSE_FULL_M3 15000 (marked ESTIMATE in the code).

## Decisions

- The progress model lives in apps/fly/src/course/progress.ts (DOM-free, used by walls.ts and the course feature) so one
  line format serves both builds.
- The estimate of the course is per try: fitCourse may make up to 9 tries, the big scans needed 1.0-1.4 on average, so the
  line counts the try ("placing the gates again, try 2") instead of promising a total for 9.
- Outside the lane's file list, minimal: app/builtin/course.ts (the worker's progress, the arrival warning, the next line
  passed to WallsHook.build) and app/builtin/walls.ts (WallsOptions.speak). No change in apps/fly/src/sonic/**.

## For the lead

- app/builtin/course.ts and app/builtin/walls.ts carry small edits of this lane (see Decisions); lane editor3 may touch
  builtin/course.ts too: the hunks are in generate(), onWorker() and wallsFirst().
- Decide: the Wroclaw walls build freezes the page 13.5 s and 10 s (Facts G1-look). No line can be drawn while the main
  thread is held by @playcanvas/splat-transform (materializeToDataTable, writeVoxel's CPU part). Real fix: run bake() in a
  worker with its own WebGPU device (outside this lane: the bake pipeline, not its line). Cheaper options inside the lane,
  each a workaround, not done: a CSS-only moving bar in the walls box (compositor animations run while the main thread is
  blocked) and a line said before the freeze ("the picture may stop for up to 15 s"). The 4.8 s freeze after the walls
  come in needs a profile (store write or collision set-up are the suspects, not measured).

## Not verified

- The rates are Node rates; the worker in the browser may differ. The line re-estimates every later try from the real one.
- The spoken lines were not heard (no browser run with Fly by Sound in this stage).

- tools/bench/test/a6-reference.test.ts was not run: no flight, input or collision logic changed (walls.ts only its line).
- The HUD flash re-drawn every second: two screenshots looked at (g1-progress-70b50d42-walls.png, -course.png), readable,
  no overlap with the walls box; flicker between shots not judged (screenshots only).
- Fly by Sound lines in the browser: the probe ran without Fly by Sound, nothing spoken was captured.
- Tunis walls build was not run (it ships walls); the walls line on Tunis was not seen.

## Cost notes

- G1-progress: most turns went to finding the measured rates (audit .sum files, walls probe JSONs scattered under
  U:/Temp/gsfpv-train2) and to reading walls.ts and builtin/course.ts whole; an agent-map line for "walls build progress"
  and "course worker messages" plus one rates table in docs would have saved about 8 turns.
- G1-progress pass 2: 18 replies; most went to choosing a probe (walls-chain-probe.mjs was 90 % of it) and to locating the
  freezes; a probe that logs the longest main-thread gap by itself (it does now) would have saved the analysis turns.
