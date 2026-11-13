# Lane ground-rc2, stage G1-ground-probe-cheap

Branch `ground-probe` from origin/main bbc9e75e. Worktree C:/dev/gsfpv-train1-base. Ports 5620-5639.
Logs and JSON of the runs: U:/Temp/gsfpv-train1c/ground-rc2/ (not in git). Pictures: U:/Temp/gsfpv-train1c/shots/.

## Status

- [x] 1. Measured first (script `tools/bench/src/ground-probe-cost.ts`, numbers under "Measured, old code"). f6e51e46
- [x] 2. Cost bound by design: (a) the sweep in 0.1 m pieces with an early exit, (b) GroundCache in both pilots.
  Old against new on a grid: "Measured, new code". 64bc147d
- [x] 3. centre-throttle-probe.mjs on the local release of 53cb7243 (and before that of 64bc147d): pass (dji-centred
  4 of 4, dji-flip 5 of 5, dji-bottom 3 of 3, no page errors). a6-reference.test.ts: 1 passed (its pinned hash
  holds). 53cb7243
- [x] 4. Probe `tools/bench/scripts/fast-radio-probe.mjs` (500, 1000 and the RC 2 pattern 500b4, 20 s each): pass on
  the releases of 64bc147d and 53cb7243, fails on a build of origin/main's sources. Numbers under "Fast radio
  probe". 53cb7243
- [x] 5. Unit tests `tools/bench/test/app-ground-probe.test.ts` (10 tests), negative control NEG OK: 7 of the first
  9 fail by an assertion on origin/main's sources. 64bc147d, the tenth test in 53cb7243

Nothing is left in this stage.

## Measured, old code (origin/main bbc9e75e)

Command: `node node_modules/tsx/dist/cli.mjs tools/bench/src/ground-probe-cost.ts <out.json>` (Node v22, this PC, scene
887f27aa, 5 cm voxels, 12 ground points around the spawn, body bottom 0.03 m). Output kept in
U:/Temp/gsfpv-train1c/ground-rc2/cost-old.json.

Milliseconds per groundClearance call (one 20 m sweep), by height above the ground:

| height m | p50 | p95 | max |
|---|---|---|---|
| 0.3 | 83.1 | 139.4 | 141.2 |
| 1 | 63.8 | 138.3 | 139.8 |
| 3 | 48.7 | 187.3 | 190.8 |
| 6.67 | 9.1 | 139.2 | 261.0 |
| 10 | 1.2 | 105.9 | 363.4 |
| 20 | 1.6 | 253.1 | 415.0 |

At 10 and 20 m only 4 of the 12 points see the ground at that height (the others have something in between).

Looks per second with the real CentrePilot (angle mode, sticks at rest) fed reports on the real clock, one thread
(a model of the page's input handler in Node: no rendering in it):

| height m | reports/s | looks/s | share of time in looks | reports handled/s |
|---|---|---|---|---|
| 1 | 60 | 14.6 | 0.990 | 14.6 |
| 1 | 125 | 14.5 | 0.995 | 14.5 |
| 1 | 250 | 13.8 | 0.997 | 13.8 |
| 1 | 500 | 14.2 | 0.998 | 14.2 |
| 1 | 1000 | 14.7 | 0.999 | 14.7 |
| 6.67 | 60 | 6.9 | 0.991 | 6.9 |
| 6.67 | 125 | 6.7 | 0.996 | 6.7 |
| 6.67 | 250 | 6.6 | 0.998 | 6.6 |
| 6.67 | 500 | 6.9 | 0.999 | 6.9 |
| 6.67 | 1000 | 6.9 | 0.999 | 6.9 |

Reading: a look takes longer than the 33 ms limit and longer than the gap between two reports even at 60 reports a
second, so every report that gets handled makes a look and the handler takes 99 % of the thread at every rate.

The same sweep cut into pieces with an early exit, ms per call over all heights and points (part "pieces"):

| piece m | p50 | p95 | max |
|---|---|---|---|
| 0.1 | 0.204 | 1.049 | 3.590 |
| 0.25 | 0.309 | 1.476 | 5.063 |
| 0.5 | 0.324 | 1.900 | 6.223 |
| 1 | 0.282 | 3.936 | 9.101 |
| 2 | 0.139 | 4.254 | 31.306 |

## Measured, new code (64bc147d)

Same script, parts cost,diff,rate; output U:/Temp/gsfpv-train1c/ground-rc2/cost-new.json.

Milliseconds per groundClearance call now:

| height m | p50 | p95 | max |
|---|---|---|---|
| 0.3 | 0.044 | 0.105 | 0.303 |
| 1 | 0.094 | 1.125 | 1.457 |
| 3 | 0.194 | 0.364 | 1.755 |
| 6.67 | 0.316 | 2.591 | 3.650 |
| 10 | 0.321 | 0.789 | 2.684 |
| 20 | 0.623 | 1.129 | 3.278 |

New answer against the old one (part "diff": 294 positions on a 7 by 7 grid around the spawn, off the voxel lattice, 6
heights from 0.4 m under to 9.6 m over the spawn's height; the old query finished on all of them, its slowest call
378 ms): 3 positions "none" in both, 0 positions where only one says "none", 291 compared: p50 1e-13 m, p95 0.000078 m,
max 0.000156 m.

Looks per second, same model as above:

| height m | reports/s | looks/s | share of time in looks | reports handled/s | longest handler ms |
|---|---|---|---|---|---|
| 1 | 60 | 30.0 | 0.003 | 59.5 | 1.35 |
| 1 | 125 | 25.0 | 0.003 | 124.5 | 0.28 |
| 1 | 250 | 28.0 | 0.003 | 249.5 | 0.19 |
| 1 | 500 | 29.5 | 0.003 | 499.5 | 0.28 |
| 1 | 1000 | 30.5 | 0.003 | 999.5 | 0.42 |
| 6.67 | 60 | 30.0 | 0.010 | 59.5 | 0.47 |
| 6.67 | 125 | 25.0 | 0.008 | 124.5 | 0.47 |
| 6.67 | 250 | 28.0 | 0.010 | 249.5 | 0.48 |
| 6.67 | 500 | 29.5 | 0.011 | 499.5 | 0.52 |
| 6.67 | 1000 | 30.5 | 0.011 | 999.5 | 0.55 |

## Fast radio probe

`node tools/bench/scripts/fast-radio-probe.mjs <base with /en> <out.json> [runs] [scene]`, wrapped in the GPU lock (it
does not take the lock itself). Headless system Chrome, scene 887f27aa, a fake DJI FPV Remote Controller 3 on
navigator.hid, centred style, stick up 3 s then centre 17 s. Runs: r500 and r1000 (one report per task, paced on the
page clock), r500b4 (the DJI RC 2 source's pattern of the hang evidence: a timer every 6 ms hands over the reports
that fell due, up to four back to back in one task).

New build (release of 64bc147d, port 5620), U:/Temp/gsfpv-train1c/ground-rc2/fast-new-final.json, pass, exit 0:

| run | reports handled/s | frames/s | longest frame gap ms | longest task gap ms | climb m | span of the last 10 s m | armed drops | arm state changes | crashed |
|---|---|---|---|---|---|---|---|---|---|
| r500 | 501 | 30.0 | 82.6 | 28.9 | 4.67 | 0.0 | 0 | 1 | no |
| r1000 | 1003 | 30.0 | 81.8 | 28.8 | 4.67 | 0.0 | 0 | 1 | no |
| r500b4 | 501 | 29.9 | 71.5 | 36.0 | 4.67 | 0.0 | 0 | 1 | no |

Two earlier runs of the new build (fast-new-1.json, fast-new-2.json, before the bounds and the 6 ms timer were set):
frames/s 29.9 to 30.0, longest frame gap 70.7 to 95.4 ms, longest task gap 23.4 to 31.5 ms.

Final code (release of 53cb7243, port 5622), fast-final-53cb.json, pass, exit 0: r500 500 reports/s, 30.0 frames/s,
frame gap 69.6 ms, task gap 30.7 ms; r1000 1002, 30.0, 72.0, 37.0; r500b4 501, 29.9, 92.5, 27.9; each climbs 4.67 m,
span 0.0 m, 0 armed drops, not crashed. centre-throttle-probe.mjs on the same release: pass, 12 of 12 checks.

Negative control: the same probe on a build of origin/main's sources (the four changed source files put back to
origin/main bbc9e75e, `node scripts/build-release.mjs`, copy kept in U:/Temp/gsfpv-train1c/ground-rc2/dist-old, port
5621), U:/Temp/gsfpv-train1c/ground-rc2/fast-old-final.json, fail, exit 1:

| run | reports handled/s | frames/s | longest frame gap ms | longest task gap ms | climb m | armed drops | arm state changes | crashed | failed checks |
|---|---|---|---|---|---|---|---|---|---|
| r500 | 7 (139 of 10031) | 6.9 | 177.9 | 174.4 | 4.67 | 0 | 2 | no | keepsUp, renders, mainThread |
| r1000 | 7 (136 of 20215) | 6.7 | 194.2 | 196.6 | 4.65 | 0 | 2 | no | keepsUp, renders, mainThread |
| r500b4 | 10 (216 of 10329) | 4.6 | 640.5 | 689.4 | 3.38 | 7 | 16 | yes | keepsUp, renders, mainThread, climbs, holds, motorsSteady |

Said plainly: with the plain HID fake (one report per task) origin/main does NOT stall and its motors do NOT toggle.
The page crawls (6.7 to 6.9 frames a second instead of 30, 7 of 500 or 1000 reports a second handled, the rest never
flown), but the drone climbs and holds. The stall of the rc2 lane (motors toggle, the drone sinks) needs reports that
arrive several in one task: with the RC 2 pattern (r500b4) origin/main toggles the motors (7 drops out of armed, 16 arm
state changes), climbs 3.38 m, sinks and crashes; the new build flies the same pattern like the other two.

Bounds in the probe, from these runs: FPS_MIN 24 (new 29.9 to 30.0, old 4.6 to 6.9), FRAME_GAP_MAX_MS 150 (new 69.6
to 95.4 over four runs, old 177.9 to 640.5), TASK_GAP_MAX_MS 100 (new 23.4 to 37.0, old 174.4 to 689.4). The climb of
1 m and the 0.5 m hold are the bounds of centre-throttle-probe.mjs and app-centre-throttle.test.ts (estimates there).
The climb stops at 4.67 m on both builds: the drone meets something above the spawn of 887f27aa there (the rc2 lane's
"6.67 m" is the same place in world height).

## Decisions

- The cheap query is the same sweep in pieces of 0.1 m (PROBE_PIECE_M), stopping at the first piece that touches.
  Why not a ray or a voxel column walk: the pieces go through ContactWorld.sweep, so the answer is the old one (same
  sphere, same path) and every world keeps working (the respawn platform's wrapper in sim-core, the test floors, mesh
  and overlay worlds). packages/collision is not changed. 0.1 m is the cheapest of the five lengths measured.
- Bound by design: a look tests at most 200 pieces and no sphere larger than 0.05 + 0.05 m (about 5 voxels across at
  5 cm), where the old cover sphere was 10.05 m (402 voxels across).
- Tolerance 0.25 mm: that is LEAF, the sweep's own contact resolution in packages/collision/src/world.ts, so the old
  answer was never more exact than that. Measured difference: max 0.156 mm, p95 0.078 mm, no position changes between
  "none" and a number. The centred style reads the clearance for the soft landing and the "on the ground" rule, which
  work in centimetres; a quarter of a millimetre is under what they can react to. The unit test pins 0.25 mm.
- GroundCache (apps/fly/src/play/ground.ts) is used by LessonPilot (so by CentrePilot and the lessons) and GamePilot.
  Rule 1, unchanged: a look at most every 33 ms of the input's own time (a report's timeStamp, a frame's time). Rule 2,
  new: after a slow look (GROUND_SLOW_MS = 8 ms or more on the page clock) the next one waits GROUND_REST = 4 times
  the look's own duration, so slow looks take at most a fifth of the page's time whatever a world costs; quick looks
  take at most 8 ms in every 33 ms. With the measured look (max 3.65 ms) rule 2 never applies on this scene, so looks
  happen when they did before; rule 2 is the bound for a slow world. Both numbers are chosen, not measured (8 ms is
  about twice the slowest look measured and half a frame at 60 frames a second).
- Why the 8 ms threshold: the first version (64bc147d) rested after every look. A harness that flies faster than the
  clock (unit tests with a simulated input time and the real clock) would then skip looks depending on the machine's
  speed. With the threshold such harnesses get the same looks as before on every machine.
- A fixed time slice was chosen over a per-rendered-frame hook: the pilots have no frame callback, the frame loop is
  outside this lane's paths, and 33 ms is at most one look per frame at the 30 frames a second measured here.
- The probe's fake paces reports with a MessageChannel, not a timer: a timer cannot go under 4 ms (250 a second).

## For the lead

- New files for docs/agent-map.md (not this lane's file): `tools/bench/scripts/fast-radio-probe.mjs <base with /en>
  <out.json> [runs 500,1000,500b4] [scene]` (needs the GPU lock around it, env FAST_RADIO_SHOTS for the pictures);
  `tools/bench/src/ground-probe-cost.ts [out.json] [cost,pieces,diff,rate]` (Node; the parts "cost" and "diff" still
  run the old 20 m sweep as the reference, so the script takes a few minutes).
- After branch rc2 is merged on top of this: rerun the rc2 lane's rc2-probe.mjs (usb.climbs was open there because of
  this cost) before the RC 2 is called flying. Not run here: rc2's code is not on this branch.
- dist/ in this worktree is the release of 53cb7243 (the last commit after it changes this file only).
- tools/bench/test/sonic-bump.test.ts: its test "walls, pillars, ceiling, floor at 0-85 deg and 1-5 m/s" runs into
  the 5 s test limit on this PC, on origin/main's sources as well (run alone, three times: twice with this branch,
  once with origin/main's ground.ts, lesson-pilot.ts, game-pilot.ts; 1 failed, 6 passed each time). Not this lane's.
- The scene cache .cache/scenes/887f27aa in this worktree was copied from C:/dev/gsfpv-v03/.cache (read only there).

## Not verified

- No real radio was flown: neither the DJI RC 2 nor a real WebHID radio at 500 or 1000 reports a second. All page
  numbers come from the fake on navigator.hid in headless Chrome on this PC.
- The RC 2 source itself (branch rc2) was not run with this fix; r500b4 imitates its pattern at the HID level.
- Looks per second were counted in the Node model, not inside the page; the page shows the effect only (reports
  handled, frames, gaps).
- Only scene 887f27aa was measured. Other scans (other voxel sizes) were not.
- Whether 30 frames a second is the page's or headless Chrome's limit was not measured (no run without a radio).
- The keyboard game pilot and the Fly by Sound lessons got the cache too: unit tests only (app-game.test.ts and the
  lesson tests named under Checks), no page probe.
- Full gates and the full browser regression were not run (the lead's, once per milestone).

## Checks run

- tools/bench/test/app-ground-probe.test.ts: 10 passed (the tenth, "a quick look owes no rest", was added with
  53cb7243; the negative control was run on the first 9). On origin/main's ground.ts, lesson-pilot.ts, game-pilot.ts:
  7 failed by an assertion (10.05 m sphere against 0.101; 20 m sweep against 0.1; 40 looks against 9, twice; no
  GroundCache, three times), 2 passed (the answer equals the whole sweep; an instant look every 33 ms: both are
  "nothing moved" checks). NEG OK.
- app-centre-throttle.test.ts 21 passed, app-game.test.ts 27 passed, a6-reference.test.ts 1 passed (again on the
  final code: 59 passed in the four files together).
- Tests that import the pilots or ground.ts (8 files, on 64bc147d): 99 passed, 1 failed (the sonic-bump limit above).
- tsc --noEmit: apps/fly clean, tools/bench clean.

## Cost notes

- Most turns went to the page probe: one run to learn the page's numbers, one on the old build, then the RC 2 pattern
  and a timer period that could not deliver its own rate. Cheaper: read the rc2 evidence for "four reports in one
  wake" before writing the fake, and build old and new releases in one background command from the start (done).
- A shell heredoc ate a backslash in a regex of the probe (one extra turn): edit files with the Edit tool only.
- The rest rule on the real clock had to be narrowed after the code was built and probed (one more build and probe
  run). Cheaper: run every test file that imports the changed pilots before the first release build.
