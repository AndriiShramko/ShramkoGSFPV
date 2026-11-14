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
- [ ] Gates before handing over (vitest, architecture, i18n, b18).
- [ ] See the line once in a browser (walls build and course on a local release).

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

## Not verified

- The rates are Node rates; the worker in the browser may differ. The line re-estimates every later try from the real one.
- The spoken lines were not heard (no browser run with Fly by Sound in this stage).

## Cost notes
