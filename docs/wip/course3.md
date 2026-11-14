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

Stage G2-where-the-gates-go (the owner: gates high where the scan is thin, all in one place on a long street, the size
changes between regenerations). NOT finished; stopped at a clean point at the reply budget.

- [x] Quality map packages/tracks/src/quality.ts (qualityMap, denseBand, qualityBounds, tileOf, heightAbove, inDenseBand):
  from the walls the page already has (published, shipped or built), per 4 m tile and per block layer the solid voxel
  count; ground per tile; histogram of voxels by height above the ground; dense band derived from it; well-scanned tiles.
- [x] freeSpace option `bounds` (a world box instead of boxM around the spawn; unused by the page so far).
- [x] generateCourse option `quality`: candidates only in the dense band over good tiles (when at least 8 per wanted gate,
  else all as before); `quality.spread` (trial, off on the page) lifts OUT_LEGS and the half-way turn. Without `quality`
  the generator is unchanged: generate, fit, fixtures tests 66 passed (digest pins hold).
- [x] Audit tool tools/bench/src/course-quality-audit.ts (--hist, --quality, --spread; runner
  U:/Temp/gsfpv-train3/course3/g2/run-before.sh, env Q). tsc packages/tracks and tools/bench: 0 errors.
- [x] (pass 2) Spread walk in generate.ts, used whenever `quality` is given (the trial flag `spread` is gone): steps along
  the free space (quality.ts stepsFrom, 6-neighbour BFS through usable cells) from the start and to a seeded far
  target (a band candidate at 0.6-1.0 of N/2 x 0.7 x legMaxM along the way); the out half lays gate k where the steps
  to the target are the rest shared evenly by the gates left, the back half the same toward the start; score adds the
  free radius up to 4 m (middle of the street); 2048 sweeps a step; pool up to 250 000 cells; up to 8 step-backs from a
  dead end. Params of such a course: version '2' (GENERATOR_VERSION_QUALITY), band, banded, farM, outGates, backtracks.
- [x] (pass 2) Good tiles judged with their 3 x 3 neighbourhood (goodR 1): per tile alone a street's middle had no
  voxels, the walk found 0-41 candidates within a leg (G2_DEBUG runs) and stopped at 4-16 gates.
- [x] (pass 2) denseBand: the first bin lies wholly above minM (ceil): the bin just over the ground is inflated by the
  ground (synthetic street 680 against 396 a bin; Wroclaw 10349 against 6909) and became a one-bin band.
- [x] (pass 2) Wired: apps/fly/src/course/worker.ts runs qualityMap, freeSpace over qualityBounds and fitCourse with
  `quality` (no good tile: box around the spawn as before). tsc apps/fly, packages/tracks, tools/bench: 0 errors.
- [x] (pass 2) Unit tests packages/tracks/test/quality.test.ts (3): denseBand, synthetic street band (dense to 4 m:
  band ends 3.4-4.8 m; control dense to 14 m: above 8 m), course over the map (seeds 1, 2: at least 8 gates, all in the
  band, reach at least 40 m of the 80 m street, validateTrack ok; control without the map: reach under 40 m). 3/3
  passed; neg_control.py against 9335a71a (quality.ts, generate.ts): NEG OK by assertion. generate, fit, fixtures:
  66/66 passed (digest pins of courses without a map hold).
- [~] 20-seed audits of the committed code running detached: U:/Temp/gsfpv-train3/course3/g2/before3/ (old walk) and
  after3/ (--quality: box from qualityBounds, spread walk), scans 70b50d42, 887f27aa, eb5f51dc, 0230d903; each dir gets
  DONE when all 4 end. before2/ and after2/ ran an earlier map (floor first bin): do not use. before/ and after-band/
  are the first pass's (old map, band-only walk). Read the SUMMARY lines of before3 and after3 into the table below.
- [ ] Gate count steadiness: N is still clamp(4 + V/40, 4, 24) (24 on every big scan); the count spread comes from
  walks that stop early; the planned walk reaches N far more often (trial below). Check in the after3 table.
- [ ] Saved courses: a saved course is a file (format unchanged, params free-form; the test validates a new course).
  A g1.<seed> link now rebuilds a different course than before this change (links are rebuilt by the current code
  on both sides; changing the link to g2 touches app/builtin/course.ts and rooms/race.ts, outside the lane): see For the lead.
- [x] gates.py --only vitest,architecture,i18n,b18 on 35bb6f15: all PASS (vitest 164 s; logs U:/Temp/gsfpv-gates-20261114-223819).
- [ ] Browser look on Wroclaw and Tunis (a separate stage).
- [ ] Gaussian count grid in the bake (the task's other source): not built. Proposal: bake.ts / tools/walls/bake-published.mjs
  keep a 4 m x 4 m x layer count of Gaussians and publish it beside the walls as scene.density.json (lane walls' files).
  The walls' own voxel counts are used meanwhile (data every page has).

Stage G3-respawn (the owner: "If the settings say respawn at the last place, the course must go on from that place; only a
respawn at the very start restarts the course. The course progress must be tied to the respawn.")

- [x] Before: app/builtin/course.ts reset the lap timer on every sim 'crash' and 'respawn' event and on every 'life', so any
  crash or respawn sent the pilot back to gate 1.
- [x] course/run.ts courseLife(reason, director.last, tick): a fresh director decision of kind 'start' (R, a crash or stuck
  craft with the target 'start', a rewind with no path left) restarts; 'manual-rewind' (Y) rewinds the course to the
  decision's sampleTick; a crash or stuck craft put back where it was ('rewind' target) keeps lap, next gate and running
  clock; reasons settings, scene, world, start restart as before. CourseRun.afterLife applies it (the jump is never a pass).
- [x] LapTimer.snapshot() / restore(state, atMs, nowMs) (packages/tracks/src/laps.ts); CourseRun keeps a snapshot after
  every pass, pause, resume and reset (up to 512) and a rewind picks the one that held at sampleTick; the lap clock is put
  back to its value then and runs on from now (sim ticks never go back on a respawn: runner.respawnV2 keeps the tick).
- [x] Wiring: builtin/course.ts no longer resets on a crash; its 'life' listener calls courseLife + afterLife.
- [x] Unit tests tools/bench/test/course-respawn.test.ts (3: crash keeps, R restarts, Y rewinds): 3/3 passed with
  laps.test.ts and tracks-a6.test.ts (11/11). neg_control.py against origin/main (run.ts, laps.ts, builtin/course.ts):
  NEG OK, fails by assertion. tsc apps/fly, packages/tracks, tools/bench: 0 errors each. Log U:/Temp/gsfpv-train3/course3/g3/neg.log.
- [ ] gates.py --only vitest,architecture,i18n,b18 on the G3 commit.
- [ ] Browser walk on Wroclaw and Tunis (crash with auto respawn, R, Y on a generated course): a separate stage.

## Facts (measured)

- G2 quality map (course-quality-audit.ts --hist, Node 22, this PC). Wroclaw 70b50d42 (5 cm walls, 0.2 m blocks, 0.6 m
  bins): 6956 tiles of 4 m, 2279 with a ground, map in 1.0-1.8 s; mean voxels per tile from 0.4 m above the ground in
  0.6 m bins: 10349, 6537, 6182, 6672, 6909 (peak, 2.8-3.4 m), 6764, 6576, 6384, 5951, 5390, 4879, 4490 ... 2895 at
  11.8 m. Dense band at 80 % of the peak: 1.4-5.8 m; at 70 %: 1.4-7.0 m. Tunis 887f27aa: 441 tiles with a ground,
  falls faster: band 0.9-4.9 m in the first run (50 %, aliased bins, minM 1); the final band is in the audit logs. 0230d903: steep fall, band 1.4-3.4 m. eb5f51dc (20 cm
  walls, 0.8 m bins): nearly flat 358-541, band 2.4-10.4 m (not a street scan). 0.5 m bins over 0.2 m layers zig-zagged
  by 40 %: bins are whole block layers now.
- Wroclaw grid 295 x 375 m (x, z), y -4.2 to 20.6 m; the free space's box is 80 m around the spawn (FREE_DEFAULTS.boxM)
  and the out half of the walk keeps within OUT_LEGS x 15 m = 30 m of the start: the two reasons for the cluster.
- Before (old generator, 20 seeds, first runs with the 70 % map): 0230d903 gates in band 1.2 %, mean reach 27 m,
  gates 6-24 (mean 20.7, sd 6.1); eb5f51dc in band 11.4 %, reach 29 m, gates 5-24 (13.6, sd 8.4); eb5f51dc gate heights
  up to 15.6 m above the ground.
- After, band only (--quality, 6 seeds): eb5f51dc 100 % in band, gates 4-21 (15.0, sd 7.1), reach 27 m; 0230d903
  100 % in band, gates 9-17 (11.3, sd 2.6), reach 9 m, visited share 0.005: smaller and tighter, not wired.
- Spread trial (--quality --spread, 4 seeds): eb5f51dc 8-9 gates, reach 63-67 m, stop "no candidate in reach";
  0230d903 5-9 gates, scales 0.3-0.5 on 3 of 4 seeds.
- G2 audit, 20 seeds, committed code 35bb6f15 (course-quality-audit.ts; before3 = no map, after3 = --quality), fast scans
  (Wroclaw and Tunis still running at hand-over):
  | scan | run | gates in band | well-scanned visited | gates | mean | sd | reach m | ms a course |
  |---|---|---|---|---|---|---|---|---|
  | eb5f51dc | before3 | 0.059 | 0.081 | 5-24 | 13.6 | 8.4 | 29 | 1066 |
  | eb5f51dc | after3 | 1 | 0.112 | 5-24 | 17.8 | 6.3 | 33 | 3790 |
  | 0230d903 | before3 | 0.022 | 0.036 | 6-24 | 20.7 | 6.1 | 27 | 7025 |
  | 0230d903 | after3 | 1 | 0.039 | 14-24 | 23 | 2.3 | 56 | 8558 |
- Spread walk trial (pass 2, course-quality-audit.ts --quality, 6 seeds, U:/Temp/gsfpv-train3/course3/g2/trial-walk/*-4.log,
  before the step-backs and the ceil band fix): 0230d903 gates 24, 24, 23, 22, 23 and 17 (scale 1 on all 6; before: 6-24
  over 20 seeds), farM 99-115 m, out half 12 gates on all 6; eb5f51dc 24 (scale 0.5), 9, 6, 5, 20 (0.5), 15: dead ends
  with 0 free legs among 158 options (G2_DEBUG), the reason for the step-backs (not yet measured).
- K1.1 summaries (lane tracks2's audit, 200 seeds per scan, U:/Temp/gsfpv-train2/tracks2/audit-old and audit-new):
  old code: courses failing (a gate not registered when the course's own path is flown at 3 or 12 m/s) 70b50d42
  200/200, 887f27aa 181/200, eb5f51dc 199/200, 0230d903 200/200, 9baef54b 200/200, ba7aa29d 199/200, 1994c65c 198/200,
  ab5efa0e 200/200; cause turns-back-at-gate in all but 13 misses-opening. New code (K1.1 fix plus fitCourse): 0 failing
  and 0 missed on all eight, 200/200 with gates each; gates 3768, 2550, 3233, 4222, 3232, 3723, 4167, 1548; mean ms a
  course 50267, 43026, 892, 5482, 45760, 36493, 6504, 1947. 2f1ddf5f and d10c5638: 0 m3, start not found in both runs.
- K1.2 (why 2f1ddf5f and d10c5638 find no free space): spawns from the CDN camera are 62.0 m and 22.1 m high
  (.sum spawn y); not analysed further here (left).

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

- G3: a crash respawned where it was keeps the gates passed even when the rewind put the craft behind a gate it had passed in
  the last seconds: that gate is not asked again (the task: keep the lap and the next gate; the lost seconds are the cost of
  the crash). Only Y (the pilot's own rewind) undoes passes and time. The best lap is never undone (a lap flown stays flown).
- G3: the decision reads session.director.last only when made at this tick (as builtin/respawn.ts does for its "-5 s").
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

- G2: a g1.<seed> link built before this change rebuilds another course after it (the walk is new). Keep g1 (both sides of
  a room run the same code) or move generated links to g2 (app/builtin/course.ts, course/link.ts, rooms/race.ts).
- G2: four stale detached audits (before2/, after2/ and the first pass's before/, after-band/) may still run; stopping
  them was refused to this worker. They write only under U:/Temp/gsfpv-train3/course3/g2.
- G3: builtin/course.ts carries a third hunk of this lane (the 'sim' crash reset is gone, the 'life' listener calls
  courseLife). rooms/race.ts was not changed: a race in a room now also keeps the attempt over a crash respawn (same CourseRun).

## Not verified

- G3: the negative control fails each test on the missing courseLife (the old reset lived in builtin/course.ts, which a
  Node test cannot drive); the old reset-on-every-life behaviour itself was not replayed in a test.
- G3: not walked in a browser (crash with auto respawn, R, Y on a generated course on Wroclaw and Tunis); the 'life' event's
  tick equal to director.last.tick is read from builtin/respawn.ts, not seen on the page.
- G3: tools/bench/test/a6-reference.test.ts not run: no flight, input or collision code changed (the course only reads the sim).

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
- G2: 27 replies; most went to the walk (band and spread trials) after the map was quick; running the fast scans
  (eb5f51dc, 0230d903) first was right, and a synthetic street world for the walk would have made each trial seconds.
- G2 pass 2: about 28 replies; most went to three trial rounds of the walk before a one-line debug of "why stuck"
  (candidates within a leg, turnable, free legs) showed the real cause (good tiles per tile alone); that debug first,
  and a kill permission for stale detached audits, would have saved about 8 replies and two stale audit runs.
- G1-progress pass 2: 18 replies; most went to choosing a probe (walls-chain-probe.mjs was 90 % of it) and to locating the
  freezes; a probe that logs the longest main-thread gap by itself (it does now) would have saved the analysis turns.
- G3-respawn: about 22 replies; most went to tracing the respawn path (respawn.ts, director.ts, runner.ts, session) to learn
  whether the sim tick goes back on a rewind; an agent-map line "respawn: director decision, life event, tick monotonic"
  would have saved about 4 replies.
