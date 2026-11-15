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
- [x] gates.py --only vitest,architecture,i18n,b18 on 65f621e3: all PASS (vitest 163 s; logs U:/Temp/gsfpv-gates-20261114-224937).
- [ ] Browser walk on Wroclaw and Tunis (crash with auto respawn, R, Y on a generated course): a separate stage.

Stage G4-prove (the owner's path in a browser on the scans he uses).

- [x] Release build of ec91e064 (node scripts/build-release.mjs, 1928 files, log U:/Temp/gsfpv-train3/course3/g4/build.log).
- [x] Hook for probes: CourseHook.gatePoses() (centre and rotation of every gate, flown frame) and clockText() (the course
  HUD's text), set in app/builtin/course.ts. tsc apps/fly: 0 errors.
- [x] Probe tools/bench/scripts/course-path-probe.mjs: Shift+G, every progress line with its time, top-down picture of the
  gates over the live walls (gate colour by height above the ground under it), pilot's view at gate 1, the craft led
  through gates 1..3, 6 s hover, sent at 12 m/s into the nearest wall, automatic respawn ('rewind' target), next gate and
  HUD clock before and after; then R.
- [x] Runner U:/Temp/gsfpv-train3/course3/g4/run.sh ran 22:58-23:07 on a release of 8c1dfd71 (serve-csp 5721, GPU lock):
  phase A dist/walls empty: progress-look-probe.mjs on ab5efa0e and 70b50d42 -> g4/build-look.json; phase B stand-in
  U:/Temp/gsfpv-train2/walls/release/70b50d42 in dist/walls: course-path-probe.mjs on 70b50d42 and 887f27aa -> g4/path.json.
  0 page errors in all four. Results in Facts G4.
- [x] Pictures looked at (U:/Temp/gsfpv-train3/shots/): course3-wroclaw-top.png: all 24 gates in one band about 76 m long
  on one street of a 163 x 185 m area, green and yellow (2.2-5.7 m above the ground), none red. course3-wroclaw-pilot.png:
  street at eye level, the next gate green ring ahead, HUD clock 0:00.00 Gate 1 of 24, a tree trunk close in front of the
  camera (the eye point is 6 m before gate 1 on its axis). course3-wroclaw-pilot-b.png: the other yaw, looks away from the course.
- [!] Wroclaw spread NOT met on the page of 8c1dfd71: the stand-in walls course spans 75.9 m (largest gate-to-gate distance
  on the ground plane). Pass 2 below.
- [x] (pass 2, 555bf690) Progress percent no longer goes back between tries: ProgressClock keeps the share the earlier tries
  showed (stepBase) and never shows less than it showed. Test in course-progress.test.ts; neg_control.py against 542e0250:
  NEG OK ("expected 88 to be greater than or equal to 96").
- [x] (pass 2, 555bf690) Spread reach: the audit after3 agrees with the page (Wroclaw reach mean 71 m, farM 79-125 m; page
  75.9 m). Causes: the way out was capped at halfN x 0.7 x legMaxM 15 = 126 m of steps and the far target was drawn from
  0.6 of it. Now a course over a quality map takes legs up to SPREAD_LEG_MAX_M 25 m (estimate) and the far target from 0.8
  of the way (generate.ts). Courses without a map unchanged (generate, fit, fixtures, quality, course-progress: 84/84
  passed). New test in quality.test.ts, 240 m street: reach 98 and 111 m (old: 74.8 and 99); neg_control.py NEG OK
  "expected 74.8 to be greater than or equal to 90". The box QUALITY_BOX_M 240 (120 m each way from the spawn) is the
  next limit. tsc packages/tracks, apps/fly, tools/bench: 0 errors.
- [x] (pass 2) Wroclaw audit of the new walk, 4 seeds (course-quality-audit.ts --quality, U:/Temp/gsfpv-train3/course3/g4b/
  audit-70b50d42.log): farM 181.6, 207.2, 197.6, 176 m (after3: 79-125); reach mean 114 m (after3: 71); gates 21, 24, 22,
  14 (mean 20.3, sd 3.8; after3 20 seeds: 22.3, sd 3.1); all gates in the band; 94 s a course (after3: 84 s). Seed 4
  walked 24 gates but kept 14 (tries 38): the cut after the walk was not looked into.
- [x] (pass 2) gates.py --only vitest,architecture,i18n,b18 on aecae33e: all PASS (vitest 147 s; logs U:/Temp/gsfpv-gates-20261114-232813).
- [ ] (pass 2) Browser proof of the new walk NOT run: release of aecae33e built (g4b/build.log, 1928 files), but the GPU lock
  C:/dev/.gpu-lock was held by other agents from 23:08 to past 23:41 (a render job, then lane editor3), and the reply budget
  ended; the runner was stopped before it took the lock. Next: run U:/Temp/gsfpv-train3/course3/g4b/run.sh again (it
  rebuilds; drop the audit line), then look at course3-wroclaw-top.png and course3-wroclaw-pilot.png and record the span
  (pass 1: 75.9 m), the respawn and R results, and the ab5efa0e percent lines (they must not go back).

Stage fixes (review CR-1..CR-6). Stopped at the reply budget at a clean point.

- [x] CR-1 (blocker) d74ed4b6: the walk's diagnostics (band, banded, farM, outGates, backtracks, plus walked, cutClose,
  drops, kept) no longer go into generator.params; they go to the new CourseOptions.onWalk (WalkInfo). No change to
  server.ts or apps/api/tracks.py needed. quality.test.ts: validateServerTrack ok on courses over the map, onWalk adds up.
  neg_control.py against HEAD (generate.ts): NEG OK by assertion ("generator.params.band: is not a known key" ...).
  generate, fit, fixtures, quality: 70/70 passed (digest pins hold). tsc packages/tracks and tools/bench: 0 errors.
- [x] CR-6 d74ed4b6: a step-back below outGates (only when a far target exists) sets back = false and outGates = -1.
  No unit test (no cheap world builds that dead end); the audit below shows bt 0 on all rows so far, so its effect is not measured.
- [x] CR-2 a956eb9d: walls box shows a bar animated by Element.animate (transform, compositor) while a build runs and,
  in the read and voxelize steps, the line progress.mayStop ("may stand still for up to 25 s; the build goes on"), spoken once
  a build. FREEZE_NOTE_S 25 is an ESTIMATE rounded up from the measured freezes 13.5 s, 10.0 s and 21.0 s unchanged text.
  course-progress.test.ts 15/15; neg_control.py with the old locales: NEG OK ("expected 17 to be 18"). tsc apps/fly: 0 errors.
- [x] CR-5: the For-the-lead line on room races corrected (race-page.ts:53 still resets on every life).
- [x] gates.py --only vitest,architecture,i18n,b18 on a956eb9d: all PASS (vitest 119 s; logs U:/Temp/gsfpv-gates-20261114-235456).
- [~] CR-4: cause found, fix left. 20-seed audit of d74ed4b6 (U:/Temp/gsfpv-train3/course3/fixes/run-audit.sh, output
  fixes/audit/) was cut at hand-over after 9 Wroclaw and 2 Tunis seeds. Seed 4 (Wroclaw): walked 24, closeAt cut 0, the
  whole-course proof dropped 10 (8 'gate', 2 'leg') -> 14. Seeds 1, 3, 13 lost 3, 2, 1 the same way. Cause: the walk's
  one-gate proof (generate.ts, build([gate], yk, cur, 1)) has no leg out, but check.ts (about line 288) also needs the
  turn after a gate (gateExit to the next gate) clear; with 25 m legs on a street that turn hits walls, and each drop
  changes the neighbours' legs (cascade). Fix to do: in the spread walk, accept a candidate only when the exit turn of the
  current gate toward it is free (gateExit from path.ts with the last gate's axis), for courses over a map only (digest pins
  of courses without a map must hold); then rerun run-audit.sh (about 20 min with 4 processes) and compare sd with before3
  (Wroclaw 5.2, Tunis 6.5) and after3 (3.1, 6.6).
- [~] CR-4 (pass 2): fix in generate.ts: over a quality map a candidate is open only when the turn out of the last gate
  toward it (gateExit with the last gate's axis yawForward(nearestYaw(prevDir)) and leg in from the trail) is clear by
  marginM. Without a map exitOk is true at once: quality 4/4, generate/fit/fixtures 65/66; the one failure is the
  60 s timeout of generate.test.ts "2 m hole" (71.5 s, alone 92.9 s), and it fails the same on the HEAD generator
  (neg_control.py --ref HEAD: the old code fails too), so it is the machine's load (48 node processes), not the change.
  tsc packages/tracks: 0 errors. Commit 89b4fe86.
- [x] CR-4 audit of 89b4fe86 (run-audit.sh audit-cr4, U:/Temp/gsfpv-train3/course3/fixes/audit-cr4/, under heavy machine
  load: about 48 node processes of other agents). Wroclaw 70b50d42, 20 seeds: walked 24 on all, gates 24 on 19 seeds and
  23 on seed 17, no drops (SUMMARY gatesSd 0 and 0.3; before3 5.2, after3 3.1); reach mean 114 and 110 m; band share 1.
  Tunis 887f27aa: only 5 seeds before the cut (seeds 1, 2, 11, 12, 13): gates 24, 14, 24, 24, 24 (sd about 4.5 by hand;
  before3 6.5); seed 2 walked 14 itself (no proof drop). Tunis courses took 244-598 s each in Node under load (before3
  mean 59.8 s), so its 20 seeds did not fit: the Tunis audit was stopped by hand (no 887f27aa JSON, no SUMMARY).
  Accept: Wroclaw clearly met; Tunis better on 5 seeds, not shown on 20.
- [x] CR-2 probe: progress-look-probe.mjs records the box's bar ('moving' while its animation runs) (e5fe3588), not run yet.
- [x] gates.py --only vitest,architecture,i18n,b18 on e5fe3588: all PASS (vitest 316 s; logs U:/Temp/gsfpv-gates-20261115-003132).
- [ ] CR-3 (left): course-rate.mjs over audit-cr4 (Wroclaw only): freeMs 4239 and 4228 (Node, without qMs; with the G4b
  qMs 1115-1140 about 5.3 s), msPerTry 102221 and 134664 (one fit try a course; under load), msPerTryPerMLeaf 9824. Old
  constants: COURSE_TRY_MS_5CM 38100, FREE_SPACE_MS 2400 (apps/fly/src/course/progress.ts). Not set yet: the numbers are
  from a loaded machine and the Tunis rows (244-598 s a course) say the walk itself is now the slow part on Tunis; set
  them from a quiet run or scale by these, then time one Wroclaw and one Tunis generation in the browser.
- [ ] Browser proof (left): U:/Temp/gsfpv-train3/course3/g4c/run.sh (release build of HEAD, port 5723, GPU lock;
  phase A Wroclaw build without walls: bar, mayStop line, course generation times; phase B stand-in walls: course-path-probe
  on 70b50d42 and 887f27aa). It waits for fixes/audit-cr4/DONE: create that file (or drop the wait line) and start it
  as the first command of the next stage. It was stopped before its build at the reply budget.
- [ ] Tunis 20-seed audit of the CR-4 walk (left, about 1.5 h with 2 processes under load): run-audit.sh with Wroclaw lines removed.
- [ ] CR-3: tools/bench/scripts/course-rate.mjs now reads course-quality-audit rows (fits as tried). Left: run it over
  fixes/audit/ when the audit is whole, set COURSE_TRY_MS_5CM from ms per fit try (Node, so far Wroclaw rows 35-108 s a
  course, 1 fit each) and FREE_SPACE_MS from the free step: Node qMs 1115-1140 + freeMs 3675 on Wroclaw (g4b), browser
  20.4 s (G4 build-look, 8c1dfd71, includes qualityMap); then time one Wroclaw generation of the current walk in the browser.

Stage F1-no-freeze (train 3 wave 2; the walls build is this lane's now).

- [x] Release build of ec64aa44 first (U:/Temp/gsfpv-train3/course3/f1/build.log, 1928 files).
- [x] 9fb683a4: the walls build runs in a worker (apps/fly/src/bake-worker.ts, its own WebGPU device on an OffscreenCanvas;
  apps/fly/src/bake-off-thread.ts bakeOffThread has bakeCollision's signature; one worker per ladder step, terminated at
  its end). walls.ts uses it for the base build, the refine and the hook's bakeTrial ({ page: true } keeps the old path for
  comparisons); hook.bake.where says 'worker' or 'page'. A worker without WebGPU builds on the page as before; only then
  the box shows the mayStop note.
- [x] 9fb683a4: a ladder step past its limit (bake.ts stepTimeoutMs: 3 x its estimate, at least 180 s, ESTIMATE) is stopped
  (its AbortSignal terminates the worker) and the next lighter step taken; the last step's timeout ends the build with the
  failed line and the button. Applied only while the build runs in a worker (a page build cannot be stopped).
- [x] Unit tests tools/bench/test/walls-offthread.test.ts (4: hung step gives way, a step in time is not stopped, the limit
  rule, errors cross the worker as their classes): 36/36 with walls-ladder and walls. neg_control.py against origin/main
  (bake.ts): NEG OK, all 4 fail by assertion (log U:/Temp/gsfpv-train3/course3/f1/neg.log). tsc apps/fly, tools/bench: 0 errors.
- [x] 0b5a02cd: course-path-probe.mjs records long tasks (PerformanceObserver longtask) from Shift+G, maxSilentS,
  maxReadGapS and hook walls.lastBake; new walls-offthread-same-probe.mjs (worker walls against page walls, SHA-256).
- [~] Browser proof: runner U:/Temp/gsfpv-train3/course3/f1/run.sh (release of 9fb683a4, 1930 files, serve-csp 5724,
  dist/walls empty, GPU lock only around each probe).
- [x] Same walls (walls-offthread-same-probe.mjs, f1/same-ab5efa0e.json, 01:56-01:57, GPU lock held): Forest Floor
  ab5efa0e level 0, 5 cm: page path solid 124612, SHA-256 74c7218a1092...; worker solid 124612, SHA-256 74c7218a1092...
  (equal). Build 10.8 s on the page against 11.8 s in the worker; longest main-thread long task during the build
  6275 ms on the page, none (0 long tasks) with the worker.
- [x] First course-path-probe run failed on both scans before Shift+G: the probe's simradio=scenario needs walls
  ("the bot scenario needs a scene with collision", app/test-modes.ts:57), the page never became ready. NOBOT=1 now
  leaves the bot out (the scripted pilot sets the craft alone).

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
  | 70b50d42 | before3 | 0.386 | 0.05 | 8-24 | 19.3 | 5.2 | 27 | 79153 |
  | 70b50d42 | after3 | 1 | 0.066 | 10-24 | 22.3 | 3.1 | 71 | 84403 |
  | 887f27aa | before3 | 0.237 | 0.229 | 4-23 | 13.5 | 6.5 | 29 | 59802 |
  | 887f27aa | after3 | 1 | 0.188 | 6-24 | 16.6 | 6.6 | 45 | 87266 |
  Gate count steadiness (after3 against before3): steadier on the street scans (sd 3.1 against 5.2 on Wroclaw, 2.3 against
  6.1 on 0230d903, 6.3 against 8.4 on eb5f51dc), not on Tunis (6.6 against 6.5). Wroclaw after3 per seed: farM 79-125 m,
  outGates 12 on all, stop "count".
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

G4-prove (release of 8c1dfd71, serve-csp 5721, headless, GPU lock; U:/Temp/gsfpv-train3/course3/g4/build-look.json, path.json):
- Browser build, ab5efa0e: walls box lines from 0.0 s "Walls: reading the scan. Step 2 of 3, 2 %. 0:00 so far, about 0:40
  left." through 22.2 s "building the walls on your graphics card. Step 3 of 3 ... longer than usual, still working." to
  27.8 s "Walls built in this browser in 28 s. ... Now the course is being built; its progress follows here."; course lines
  27.8 s "Course: finding the free space. Step 1 of 2" to 31.2 s "placing the gates again, try 4. Step 2 of 2, 63 %";
  first gate drawn 32.2 s; 16 walls lines, 3 course lines; longest unchanged text while busy 9.9 s.
- Browser build, 70b50d42 Wroclaw: box 0.1 s "reading the scan. Step 2 of 3, 0 %. about 2:00 left", 60.4 s "59 %. 1:00 so far,
  about 0:45 left", 136.0 s "building the walls on your graphics card. Step 3 of 3. 2:16 so far; longer than usual, still
  working.", 150.5 s "Walls built in 149 s. ... The walls are rough in this scan. Now the course is being built"; course
  150.5 s "finding the free space. Step 1 of 2, 0 %", 170.9 s "placing the gates and obstacles. Step 2 of 2, 33 %", 186.7 s
  "72 %. 0:36 so far, about 0:15 left"; first gate 187.2 s; 156 walls lines, 33 course lines; longest unchanged text 21.0 s
  (the known main-thread freezes of the build, For the lead).
- Owner's path, Wroclaw stand-in walls: course 40.5 s after Shift+G, 24 gates, height above the ground under each gate
  2.2-5.65 m (all 24 at most 5.65 m), largest ground distance between gates 75.9 m, gate y 2.6-5.8. Gates 1-3 passed
  (next 1, 2, 3; clock 0:00.46, 0:01.43, 0:02.39). Before the crash next 3, clock 8.39 s; crash into a wall at 12 m/s,
  respawn 2.0 s later, decision kind 'rewind' (pathAgeTicks 5025), put back 2.0 m from the crash place; after: next 3,
  clock 10.59 s, 2 s later 12.59 s (runs on). R: next 0, clock 0:00.00, "Gate 1 of 24".
- Owner's path, Tunis 887f27aa (walls built in the browser): course 51.5 s, 14 gates, heights 2.0-4.1 m (one gate without
  ground under it within 80 m), span 60.4 m; gates 1-3 passed; before crash next 3 clock 8.36 s; respawn 'rewind' 2.4 m
  from the crash; after next 3, clock 10.66 then 12.70 s; R: next 0, clock 0:00.00.

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

- F1: the whole bake moves to a Web Worker, not slices: the long calls are inside @playcanvas/splat-transform
  (materializeToDataTable, writeVoxel's CPU part), which cannot be cut from outside. The library takes its GPU device
  through createDevice, and PlayCanvas's WebgpuGraphicsDevice works in a worker once the global scope stands in for
  window (it reads window.navigator.gpu) and an OffscreenCanvas stands in for the canvas. Only bytes cross back (json
  and bin transferred). The limits and the memory budget are read on the page from the renderer's device (same adapter).
- F1: one worker per ladder step: terminate() is the only stop the library allows, and it frees that step's memory.

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
  courseLife). Rooms were not changed (CR-5 corrects the earlier line here): apps/fly/src/rooms/race-page.ts:53 still runs
  ctx.events.on('life', () => this.run?.reset()), so in a room every life, a crash respawn at the last place included,
  restarts the race attempt. Decide: keep that (one rule for every racer) or give race-page.ts the solo courseLife plus
  afterLife call (outside this lane).

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
- G4-prove: 30 replies; most went to finding how to move the live craft and where the gates are (test hook, selftest,
  accept-v03-respawn, view.ts); an agent-map line "probe recipe: scripted craft via runner.onStep, gates via
  course.gatePoses()" would have saved about 8 replies, enough for the gates run.
- G3-respawn: about 22 replies; most went to tracing the respawn path (respawn.ts, director.ts, runner.ts, session) to learn
  whether the sim tick goes back on a rewind; an agent-map line "respawn: director decision, life event, tick monotonic"
  would have saved about 4 replies.
- G4-prove pass 2: about 30 replies; most went to waiting on the GPU lock (held by other agents 23:08-23:41+) in 10-minute
  blocking chunks; a lock owner file (who and since when) inside C:/dev/.gpu-lock would let a worker decide at once to hand over.
- fixes: about 32 replies; most went to CR-2 (finding the box, the locale namespace, a name clash with walls.ts's own
  `busy`) and to the 20-seed audit that outlives a worker; a walk-info row in the audit from the start (it exists now) and
  starting the long audit as the first command of a stage would have saved about 6 replies.
- fixes pass 2: about 30 replies; most went to waiting for the Tunis audit (4-10 min a course under other agents' load) in
  10-minute blocks; auditing Wroclaw first and Tunis with fewer seeds, or a quiet machine, would have left room for CR-3.
