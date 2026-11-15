# Lane sonic4: Fly by Sound at FPV speed (train 3)

Worktree C:/dev/gsfpv-center-throttle, branch sonic4 from origin/main 7fb0ddf7. Package C:/dev/ShramkoSonicFPV branch train4
from origin/main b05aeda (no package commit in V1; its two modified evidence files are untouched). Ports 5760-5779.
The owner (message 51, in short): at the normal speed of an FPV flight the sounds become a mess; a guiding line, distances
scaled by time, lessons about speed, checks that make fast flight by sound workable.

## Status

Stage V1-measure (no product change):
- [x] V1.0 the submodule of the worktree stood at 0af508a, not at the pin b05aeda: `git submodule update packages/sonic-fpv` (pin unchanged).
- [x] V1.1 measuring tool tools/bench/src/sonic-speed-measure.ts (Node, no page, no GPU lock): the page's N course over the walls, the package's ear pilot, the cue planner as the page runs it; per flight the mess numbers, lead times and a failure record.
- [x] V1.2 (a) mess as numbers, Wroclaw 70b50d42, 2 courses x 3 pilot seeds x 2, 5, 8, 12 m/s (Facts V1-a).
- [x] V1.3 (b) where the ear pilot fails at 8 and 12 m/s (Facts V1-b).
- [x] V1.4 (c) the same with the racing line on (Facts V1-c).
- [x] V1.5 design from the numbers (Design).
- [ ] V1.6 gates.py --only vitest,architecture,i18n,b18 on this branch (not run: the stage hit its reply budget).
- [ ] V1.7 the browser part of the stage rule (the owner's path on Wroclaw and Tunis): V1 changed nothing a pilot sees, so the
  release build and browser walk belong to the first stage that changes the product (V2).

Left (exact, for the next worker):
1. Run gates.py --only vitest,architecture,i18n,b18 on sonic4 (the only new file is a tool; tsc of tools/bench showed no error in it).
2. Optional cross-check of V1-b with the 2-loudest pilot: same command with `--loudest` (not run).
3. The line-on failures at 2 m/s end on the gate frame; the cause is a guess (Facts V1-c); measure it before the line becomes the guide (V2).

## Facts (measured)

Tool: `cd tools/bench && npx tsx src/sonic-speed-measure.ts --walls U:/Temp/gsfpv-train2/walls/release/70b50d42/v1 --scene 70b50d42
--spawn -11.9,3.12,-16.83 --course-seed <1|2> --track U:/Temp/gsfpv-train3/sonic4/track-70b50d42-s<k>.json --speeds 2,5,8,12
--seeds 1,2,3 --line off,on --out ...`. Walls: the stand-in of lane walls (5 cm, splat-transform 3.6.4). Spawn: the scene spawn
of the course audit U:/Temp/gsfpv-train2/tracks2/audit-new/70b50d42.json. Course: the page worker's steps (qualityMap,
qualityBounds, freeSpace, fitCourse with generateCourse), 1 lap, 24 gates for course seeds 1 and 2 (course made in 0 to 7 s).
Lesson: scanCourseLesson(scanFreeLesson) as lessons.ts builds it (budget on, gate aim on), maxSpeedMps set to the flight's
speed by the tool only. Pilot: the package's ear pilot (src/pilot, hum attended, turn 120 deg/s, reaction 250 ms, all
estimates of the package), craft model src/pilot/craft.ts (accel 8 m/s2, yaw 180 deg/s: the package's estimates, not the
simulator's physics). Frames every 20 ms. Results U:/Temp/gsfpv-train3/sonic4/v1-wroclaw-s1.json, v1-wroclaw-s2.json, logs
*.log, summary sum.txt (sum.py there). Runtime: 20 s per 2 m/s flight, 2 s or less per fast flight.

Definitions: streams = moving voices of the plan plus the height, speed and room beds that are not null; worst second = the
1 s window with the highest mean; onsets = new voice keys plus the pulses of pulsing voices; words = words of the English lines
said after the flying phase began; lead time of a cue = (distance at onset - stop distance) / closing speed, where closing
speed = the craft's velocity along the cue's direction at onset and stop distance = closing^2 / (2 x 8 m/s2) + body radius;
'late' = lead under the 250 ms reaction. Hum spare = time to the gate at onset - reaction - bearing / 120 deg/s; turn need =
bearing / (time to the gate - reaction).

### V1-a: the mess, line off (6 flights per row: 2 courses x 3 seeds)
| m/s | counted | gates reached (median of 24) | streams median / worst second / max | heard by pilot | onsets/s | words/10 s | wall lead median / p10 / min s, late of all | floor+ceiling lead median / min s | hum spare median / min s | turn need median / max deg/s | brake need max m/s2 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 2 | 6 of 6 | 24 | 4 / 6.91 / 7 | 2 | 9.97 | 2.71 | 1.92 / 0.43 / -0.14, 168 of 4626 | 2.87 / 0.82 | 9.55 / 1.77 | 4.0 / 37.6 | 22 |
| 5 | 0 of 6 | 3 | 5 / 6.52 / 7 | 2 | 32.78 | 17.62 | 1.55 / 0.36 / -0.27, 134 of 1787 | 1.26 / 0.12 | 3.10 / 1.37 | 3.4 / 52.9 | 206 |
| 8 | 0 of 6 | 2 | 5 / 6.31 / 7 | 2 | 44.61 | 28.58 | 1.25 / 0.38 / -0.33, 88 of 919 | 1.02 / 0.30 | 0.99 / 0.72 | 3.3 / 59.1 | 214 |
| 12 | 0 of 6 | 2 | 5 / 5.36 / 7 | 2 | 39.14 | 38.32 | 1.10 / 0.20 / -0.27, 47 of 527 | 1.06 / 0.08 | 0.55 / 0.48 | 5.8 / 52.0 | 182 |
- Onsets rise 4.5 times from 2 to 8 m/s; the plan keeps 5 streams at every speed above the 4.5 m/s tier edge although the
  budget (TIER_STREAMS 3) is on: the beds and the hazard voices are counted in the plan; the pilot follows 2.
- Words per 10 s at speed are inflated by short flights that end in the miss lines (retry, hint): the in-flight speech is
  not the main load; the miss lines are.
- Brake need max (closing^2 / 2 x distance at onset) of 180 to 214 m/s2 at 5 to 12 m/s comes from gate frames and surfaces
  heard first within ALWAYS_HEARD_M 0.8 m; the craft gives 8 m/s2.

### V1-b: where the ear pilot fails at 8 and 12 m/s (and at 5)
- 36 failures at 5 to 12 m/s (both line settings): 32 end with the gate missed (lines fly.progress, retry, hint.1), 3 with a
  touch at 8 m/s on course 2 (walls), 1 other. None of the failures is a hum heard too late at its onset: the hum of the next
  gate comes with 0.55 s (12 m/s) to 3.1 s spare and a turn need of 3 to 59 deg/s against the pilot's 120.
- The missed gates come at the final approach: in the failure records (sum.txt) the hum is 1 to 4 m away, heard to the side
  and often behind ('-1b'), the pilot turns at its full 120 deg/s with the forward set point unchanged (the pilot brakes only on
  an urgent hazard), and circles the gate or meets its frame (safety.obstacle at 0 to 0.6 m). The turn radius at 120 deg/s is
  v / 2.09 rad/s: 0.95 m at 2 m/s, 2.4 m at 5, 3.8 m at 8, 5.7 m at 12 (arithmetic): above 5 m/s the hum swings aside inside
  the turn radius, so no turn can make the opening. The gate aim (hum around the frame, TARGET_AHEAD_M 2, target nearM 2) works
  in metres: at 8 m/s 2 m is 0.25 s, the pilot's reaction alone.
- Example s1 8 m/s seed 1, gate 1 at 2.9 s: urgent from 2.58 s, obstacle (frame) 0.78 m -> 0.04 m in 0.3 s at 4.4 -> 2.9 m/s,
  hum 1 to 4 m behind left, command forward 2.4 m/s, turn +-120 alternating.
- Lead of the wall cues: the median falls from 1.92 s (2 m/s) to 1.10 s (12 m/s), the 10th percentile stays 0.2 to 0.4 s,
  and 5 to 10 % of wall onsets come under the reaction time (3.6 % at 2, 7.5 % at 5, 9.6 % at 8, 8.9 % at 12 m/s).
  Floor and ceiling: median 2.87 s at 2 m/s, about 1.0 s at 8 and 12 m/s, minimum 0.08 s.

### V1-c: the racing line on (same courses and seeds)
| m/s | counted | gates median | streams median / worst | onsets/s | words/10 s | wall lead median / p10 s | hum spare median s |
|---|---|---|---|---|---|---|---|
| 2 | 0 of 6 (off: 6 of 6) | 6.5 | 4 / 6.73 | 14.29 | 5.30 | 1.88 / 0.36 | 9.29 |
| 5 | 0 of 6 | 2 | 5 / 6.15 | 34.44 | 31.53 | 1.50 / 0.41 | 1.96 |
| 8 | 0 of 6 | 2 | 5 / 6.58 | 43.82 | 32.64 | 1.17 / 0.20 | 0.99 |
| 12 | 0 of 6 | 1 | 5 / 5.81 | 42.81 | 53.14 | 1.13 / 0.37 | 0.62 |
- On this scan course the line as built makes 2 m/s worse (counted 6 of 6 -> 0 of 6; one timeout with 'wrong way' twice): five
  of six end on the gate's frame (obstacle 0 to 0.2 m) with the hum 1.4 to 3 m away. Onsets at 2 m/s rise 10.0 -> 14.3 per
  second (the beat). Guess, not measured: the smoothed line (Catmull-Rom, LINE_LOOK_S 1.0, LINE_LOOK_MIN_M 3) cuts across the
  frame instead of entering along the gate's axis; on the package's rings-course (Z4 pass 2) it helped.
- Nothing changes at 5 to 12 m/s: the failure is the turn radius at the gate, which the line does not touch.

Not comparable with the browser runs of sonic3 (Wroclaw counted at 5 m/s): those used the page's probe pilot (steerByHum reads
the hum's bearing from the page, brakes by its own rule) and the simulator's physics; here the package's ear pilot and craft.

## Design (from V1; every value without a measurement is an estimate)

1. Lead constants that become seconds (value = seconds x speed, never below the metres of today, so 2 to 4.5 m/s is unchanged):
   | Constant | Today | At speed | Why (V1) |
   |---|---|---|---|
   | gate aim and target ahead (planner.ts TARGET_AHEAD_M, theme target.nearM) | 2 m | 0.6 s x v (estimate) | final approach shorter than the turn radius above 5 m/s (V1-b) |
   | new: gate approach point on the entry axis | none | the turn radius v / 120 deg/s + 1.0 s x v (estimate) | the hum must lead the craft onto the gate's axis before the radius is too big (V1-b) |
   | beacon ahead (beacon.ts BEACON_AHEAD_M) | 6 m | 1.0 s x v (estimate) | the same look-ahead as the line |
   | hazard pulse range (theme safety.distFarM, pulseDistM) | 12 m, 2 m | 1.5 s x v, 0.4 s x v (estimate) | wall lead p10 0.2 to 0.4 s at speed (V1-a) |
   | urgent duck (rules.ts URGENT_DISTANCE_M) | 0.4 m | stop distance v^2 / 16 + 0.25 s x v (estimate) | brake need 180 to 214 m/s2 against 8 (V1-a) |
   | always heard (sampler.ts ALWAYS_HEARD_M) | 0.8 m | stays (contact) | |
   | hazard onset (sampler.ts ONSET_TTC_S) | 2.5 s | stays seconds; add the stop time v / 8 (estimate) | median wall lead falls to 1.1 s at 12 m/s |
   | line look-ahead (line.ts LINE_LOOK_S, LINE_LOOK_MIN_M) | 1.0 s, 3 m | stays | |
2. Streams at speed (tier 1 and up, 4.5 m/s): one guide and one danger. Guide = the gate hum (later the line); danger = the
   hazard with the smallest time to contact, only when it is under 1.5 s (estimate); floor and ceiling count as danger. Stopped
   (not only ducked, sonic3 decision Z2): the room bed, the speed tone, the shape trace, the open-way chime unless it is the
   danger's way out, every second hazard voice. Target of the next measure: plan streams median 2 and worst second at most 3
   at 8 and 12 m/s (today 5 / 6.3 / 7), onsets under 15 per second (today 39 to 45).
3. Speech at speed: in flight only the gate count; the miss lines (retry, hint) wait until the craft is under 2 m/s (V1-a: they
   are the bulk of the words at speed).
4. A brake cue: when the hum is more than 45 degrees aside (estimate) and nearer than the turn radius plus 1 s x v, the speed
   layer says "slow" (a falling tone): the failing manoeuvre of V1-b needs a slower approach, not a later turn. The ear pilot
   gets the matching rule (brake on that cue), so the measure tests the cue, not a cleverer pilot.
5. The line as the guide at speed only after the line-on 2 m/s regression of V1-c is measured and fixed (the line must pass
   each gate through its opening along the gate's axis); until then the gate hum stays the guide.
6. Caps lift by passing, never by choice: speed lessons speed-5 to speed-8 at 6, 8, 10, 12 m/s (estimates, the steps under
   the ear pilot's measured top after V2); each opens only after a counted pass of the step before. The free flight over a scan
   (scan-free, cap 5 today) and courses by N take as cap the highest speed lesson passed, at least 5 m/s. A pilot who has not
   passed speed-4 keeps 5. The ear pilot must count a Wroclaw course at the cap of each lesson before the lesson ships.
7. Acceptance of V2 (the goal): a Wroclaw N course counted by the ear pilot at 8 m/s (2 courses x 3 seeds, at least 4 of 6),
   12 m/s reported as measured, 2 and 5 m/s not worse than the V1 table, and the mess table re-measured with this tool.

## Not verified
- All V1 numbers are the package's ear pilot and kinematic craft in Node, not the simulator's physics and not a human ear;
  the pilot's gains and the craft's limits are the package's estimates.
- The stream count is the planner's plan, not what the engine renders (the budget acts in the planner; beds counted when not
  null, their level not checked).
- Tunis 887f27aa not measured in V1 (Wroclaw only, as the stage asked); the 2-loudest pilot not run.
- No browser run, no gates.py run (Left 1).

## Cost notes
- 2026-11-15 V1: most replies went to finding the pieces for a Node scan flight (spawn, course worker steps, the runner options,
  the submodule standing at an old commit); a short agent-map line on "fly a scan course in Node" (sonic-speed-measure.ts) would
  have saved about 8 replies. The flights themselves are cheap (2 to 21 s each).
