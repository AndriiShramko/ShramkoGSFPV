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
- [x] V1.6 gates.py --only vitest,architecture,i18n,b18 on f3c3ccae: all 4 PASS (vitest 129 s; logs U:/Temp/gsfpv-gates-20261115-115317).
- [x] V1.8 (pass 2) cause of the line-on 2 m/s regression measured (Facts V1-d, tool sonic-line-gate-audit.ts and the switch
  `--line-near-aim` of sonic-speed-measure.ts, off by default).
- [x] V1.9 (pass 2) Tunis 887f27aa measured (Facts V1-e); 2-loudest pilot on Wroclaw (Facts V1-f).
- [ ] V1.7 the browser part of the stage rule (the owner's path on Wroclaw and Tunis): V1 changed nothing a pilot sees, so the
  release build and browser walk belong to the first stage that changes the product (V2).

Left (exact, for the next worker): V1 is complete. V2 starts from Design; the line-on fix is Design 5 (measured in V1-d).

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

### V1-d: why the line makes 2 m/s fail (pass 2, measured)
Tool `npx tsx src/sonic-line-gate-audit.ts --walls <same> --scene 70b50d42 --spawn <same> --track <track-s1|s2> --flights
<v1 out.json> --rows`; outputs U:/Temp/gsfpv-train3/sonic4/line-audit-s1.txt, line-audit-s2.txt. Clear half size for the body:
ring 0.44 m, square 0.58 m.
- The guess of V1-c is false for the line itself: the smoothed line crosses every gate (48 of 48) at its centre (0 m off), from
  the entry side, at 6.4 / 7.5 deg (median, courses 1 / 2) to the gate's axis, max 23.5 deg.
- The pursuit chord (the craft aims at the point LINE_LOOK_S x v ahead, at least 3 m) crosses the plane inside the clear size
  at 2 m/s at 21 and 22 of 24 gates (median 0.16 / 0.20 m off); at the six failing gates the chord is 0.10 to 0.42 m off,
  inside. The craft itself reached the plane 0.72 to 1.61 m off the axis (frame hit). At 5 / 8 / 12 m/s the chord is outside
  at 13-17 / 18-19 / 21-22 of 24 gates (median 0.6 / 1.3 / 1.8 to 2.1 m): the line's look-ahead in seconds cuts the
  corners at speed.
- Code fact: with layers.racingLine the runner returns the line's point before the gate aim (packages/sonic-fpv
  src/lesson/runner.ts beaconTarget, lines 2001-2004 return before gateAim at 2006): the S1 fix that leads through the opening
  near the plane is off while the line is on, and the line has no pull toward the gate's axis near the plane.
- Test of that cause (switch `--line-near-aim 3`: the gate aim takes over on the entry side within 3 m of the plane; outputs
  v1-wroclaw-nearaim-s1/s2.json and .log): 2 m/s course 2 counted 3 of 3 (line on without it: 0 of 3), course 1 0 of 3 but
  gates reached 24, 20, 21 (without it: 11, 6, 10; failures at g24, g20, g21, craft 0.66 to 1.09 m off the axis). 5 to 12 m/s
  unchanged (0 of 12, 1 or 2 gates; turn radius, V1-b).

### V1-e: Tunis 887f27aa (pass 2), line off, 2 courses x 3 seeds
Walls: the cached shipped walls C:/dev/gsfpv-v03/.cache/scenes/887f27aa (read only), spawn 0,2,0 (course audit
887f27aa.sum), course seeds 1 and 2 (24 and 14 gates). Outputs v1-tunis-s1/s2.json and .log.
| m/s | counted | gates median | streams median / worst second | onsets/s | words/10 s | wall lead median s |
|---|---|---|---|---|---|---|
| 2 | 1 of 6 (2 touch, 3 fail) | 8.5 | 6 / 7 | 19.3 | 3.98 | 1.85 |
| 5 | 0 of 6 | 2 | 7 / 7 | 42.5 | 14.0 | 1.44 |
| 8 | 0 of 6 | 1 | 6 / 7 | 47.9 | 38.7 | 1.50 |
| 12 | 0 of 6 | 1.5 | 6 / 7 | 45.8 | 47.3 | 1.19 |
- Tunis is denser than Wroclaw: one stream more (6 to 7 against 4 to 5) and twice the onsets at 2 m/s (19.3 against 10.0); the
  ear pilot counts only 1 of 6 even at 2 m/s. Line on: 0 of 24 at all speeds (the V1-d cause; not re-run with the switch).

### V1-f: Wroclaw with the 2-loudest pilot (pass 2), line off
Outputs v1-wroclaw-loud-s1/s2.json and .log. 0 of 24 counted at every speed; gates reached 2 to 7 at 2 m/s, 1 or 2 at 5 to
12 m/s, 11 of 24 end in a touch: without the hum always attended the pilot does not get past the first gates. The guide must
win the mix at every speed (Design 2), not only be in it.

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
5. The line as the guide at speed only with the gate aim near each gate (V1-d): in runner.ts beaconTarget the gate aim takes
   over on the entry side within max(3 m, 0.4 s x v) of the plane (3 m measured at 2 m/s by `--line-near-aim 3`; the seconds
   term an estimate), and the line's look-ahead at speed must keep its chord inside the opening near a gate (today 18 to 22 of
   24 chords miss at 8 and 12 m/s): shorten the look to the gate's approach point when a gate is nearer than the look. Until
   course 1 counts at 2 m/s with the line on, the gate hum stays the guide.
6. Caps lift by passing, never by choice: speed lessons speed-5 to speed-8 at 6, 8, 10, 12 m/s (estimates, the steps under
   the ear pilot's measured top after V2); each opens only after a counted pass of the step before. The free flight over a scan
   (scan-free, cap 5 today) and courses by N take as cap the highest speed lesson passed, at least 5 m/s. A pilot who has not
   passed speed-4 keeps 5. The ear pilot must count a Wroclaw course at the cap of each lesson before the lesson ships.
7. Acceptance of V2 (the goal): a Wroclaw N course counted by the ear pilot at 8 m/s (2 courses x 3 seeds, at least 4 of 6),
   12 m/s reported as measured, 2 and 5 m/s not worse than the V1 table, and the mess table re-measured with this tool.

## One course (lane onecourse, stage O1, the owner's messages 52 and 53)

### Status
- [x] O1.0 release build of the branch as it was (98a065b3, package pin 7678880), walls stand-in U:/Temp/gsfpv-train2/walls/release copied into dist/walls, server serve-csp port 5760.
- [x] O1.1 probe tools/bench/scripts/onecourse-probe.mjs (the owner's path with real keys; render=off by default, RENDER=on for pictures under the GPU lock). Measured "before" (Facts O1-a); picture U:/Temp/gsfpv-train3/shots/onecourse-before.png looked at: two gate sets at once (the course feature's gate and the sound mode's own teal and yellow rings).
- [~] O1.2 D1 to D6 built, apps/fly tsc 0 errors (this commit), NOT yet proven:
  - apps/fly/src/course/hook.ts: CourseForSound (inUse: track, next, gates; onChange; generate), CourseHook.sound.
  - apps/fly/src/app/builtin/course.ts: hook.sound filled; change listeners called from setRun and toggle; the `ctx.sonic` guard removed from course.generate only (Shift+G works in the sound mode; course.toggle and course.edit keep it).
  - apps/fly/src/sonic/lessons.ts: page.course is now { key, inUse, generate }; flyCourse (N in the free flight) calls generate (the same action, no ask, no scanCourseLesson, no gates of its own); frame() takes courseTarget() (the next gate of the course in the scene) when the runner has no target; the courseOffer line only when no course is in the scene.
  - apps/fly/src/sonic/feature.ts: courseOf reads ctx.hook.course.sound; key() names course.generate; inPlaceIntro's {course} names course.generate (Shift+G).
- [x] O1.3 (pass 2) the rig gives the page a SharedCourse (tools/bench/test/sonic-lesson-rig.ts: the course feature's course over the real CourseRun and lap timer, fed the craft's position each frame); the 5 old N-course tests rewritten (walls-free 2, in-place 1 use SharedCourse; the two scan-course host tests replaced). New describe "one course in the scene" in sonic-scan-course.test.ts, 4 tests: a course made before the switch-on is the one flown (no offer, no own course, target gate 1 then gate 2 by the course's count); progress kept over off and on; N replaces the course (Shift+G's action, target gate 1, no courseMaking/courseReady); no course: one offer naming Shift+G, nothing made. vitest of the 3 files: 23 passed. Negative control (neg_control.py, old lessons.ts of 98a065b3): NEG OK. The "no course" test guards D4 and may pass on the old code too (the old offer also came from page.course).
  - Shift+G in the sound mode itself (course.ts no longer ignores it while ctx.sonic) has no unit test: course.ts has no feature harness; the browser probe step (2) is its proof.
- [x] O1.4 (pass 3, this commit) dead parts removed: the askCourse, randomSeed, courseSpeech, soundCourseSeed imports in feature.ts; CourseAnswer, scanCourseLesson imports, the `ready` field and the "course passed, fly it again" branch in lessons.ts checkPassed; flyCourse's comment says what it does now. Kept: the modules course-ask.ts, course-speech.ts and scanCourseLesson with their module tests (sonic-scan-course.test.ts first describe; tools/bench/src/sonic-speed-measure.ts still uses them), the rig's `courses` map and trackOf (trackOf is still called at rig line 319, returns the lesson's own track when the map is empty). tsc apps/fly 0 errors; vitest sonic-scan-course, sonic-optin, sonic-in-place, sonic-walls-free: 45 passed.
- [~] O1.5 (pass 2, done part) the course lines take the key of course.generate (feature.ts, pass 1), so no course line names N; a chord is said with the letter last, "Shift and key G" (key-names.ts spokenKey, new locale word sonic.key.ChordJoin in en, es, pl, ru); K's key help has a new line sonic.say.helpCourse for Shift+G (mode-keys.ts KEY_HELP, 4 languages; sonic-optin.test.ts pinned lists updated). New test "the key help names Shift+G" in sonic-scan-course.test.ts, negative control against f91e6512 (old key-names.ts, mode-keys.ts): NEG OK. vitest of scan-course, walls-free, in-place, optin, hints, lesson-keys before the optin pin update: 91 passed, 2 failed (the two pinned lists, updated; re-run: optin and scan-course all passed). tsc apps/fly 0 errors, tools/bench 0 errors. LEFT of O1.5: the package's texts and lessons were searched for N naming a course (grep in C:/dev/ShramkoSonicFPV/src, demo): none found, not changed; the /sound/ page names no course key (site locale grep); the intro variant without "makes a course here" when a course is in the scene (D1) is not written.
- [~] O1.5 (pass 3, this commit) the intro variant written: sonic.say.inPlaceIntroCourse ("The hum leads you to the next gate of the course", no key that makes a course) in en, es, pl, ru; feature.ts says it instead of inPlaceIntro when ctx.hook.course.sound.inUse() is not null. LEFT: a unit test for the choice (the in-place harness of sonic-in-place.test.ts with a SharedCourse made before the switch-on: expect inPlaceIntroCourse, and inPlaceIntro without a course), with its negative control; and the sonic-scan-course.test.ts "no line names N" list should take inPlaceIntroCourse too.
- [~] O1.6 D7 (message 53), pass 3:
  - Simulator (this commit, NOT tested yet): lessons.ts gateBehind(): over the course in the scene (the free flight's courseTarget), the next gate's plane crossed forward outside its opening and outside its near miss (the package's gateCrossing: !inside && !near) says sonic.say.gateBehind ("The gate is behind you.", new in en, es, pl, ru) once per gate; reset when the target changes. Over that course nothing says "wrong way" (the runner's free flight has no track and no gate goal, so checkDirection finds no way; the course feature has no wrong-way line: grep "wrong" in apps/fly/src/course and course.ts found none). LEFT: a unit test with the rig (SharedCourse, fly beside gate 1 past it: one gateBehind, no fly.wrong-way; through it: none) and its negative control against ffb112d7.
  - Package (NOT committed; built, measured, reverted): the runner change is saved as U:/Temp/gsfpv-train3/onecourse/pkg-d7-runner.diff (checkDirection(s, prev): courseGate(); nearing(gate, s) = the craft closes on the gate or on its line-up point (gate.pos + quatRotate(gate.quat, [0, 0, lineUpM(leg)])) faster than WRONG_WAY_MPS, then no wrong way; a gate crossed forward outside its opening and near miss says 'fly.gate-behind' once, reset in passedGate). With the new line in catalog.ts and locales/*.json and an assert in test/direction.test.ts R1 ("fly.gate-behind" once): direction, runner, i18n tests 109 passed, NEG OK against HEAD; the full package run: 1352 passed, 2 failed: test/words.test.ts (evidence/listen/VL-4-words.json: en 580 measured, 581 lines) and test/lesson-schedule.test.ts (tts-es-helena.json etc.: every line measured). A new package line needs the voices run `pnpm listen:words` (a machine with the voices and a GPU) and new TTS fixtures: that is why it was reverted. LEFT: (a) apply the nearing rule alone (no new line) with a test that fails on the old code: a pilot far beside the next gate (further than its line-up distance), in front of it, flying toward its line-up point against the leg, nose-first, for more than 1 s: old code says fly.wrong-way, new code says nothing; the R1 control at direction.test.ts line 173 must still say it once; (b) the package's "gate behind" line only together with the voices run, else the simulator's line above covers the owner's path (his course is the course feature's).
- [~] O2 (stage O2-wrong-way, D7, message 53):
  - [x] O2.1 measured on the old package code (test/gate-behind.test.ts with D7_OUT, open course of 4 rings 20 m apart; U:/Temp/gsfpv-train3/onecourse/d7-pkg-before.json): (a) 3 m beyond the near miss beside ring 2, 10 m past, back nose-first to its line-up point, through: nothing said; (a-wide, 9 m) nothing; (b) over ring 2 and back: nothing; (c) turned round 6 m past ring 1, nose-first back: "wrong way" at 7.9 s; (d) backing up, sliding: nothing. (a-near) 3 m from the centre (inside the near miss, edge 1.95 m): the attempt ends (fly.progress 8 s, fly.go 9.5 s), no wrong way. So the package runner in an open course did not shout in (a), (b); the owner's shout came from the live release's N course (scan-lesson.ts over the runner), which lane onecourse O1 removed from his path. Not measured: the old live N course on a scan with walls.
  - [x] O2.2 package (train4 74a05dd): runner.ts checkDirection: no wrong way while the craft closes on the next gate or its line-up point faster than WRONG_WAY_MPS; a gate passed beside or over it (plane crossed forward outside opening and near miss) says fly.gate-behind once (en "The gate is behind you.", es, pl, ru; plain words, no native speaker checked them). After (d7-pkg-after.json): a 8.2 s, a-wide 8.9 s, b 7.9 s fly.gate-behind once, ring 2 counts after the return; c "wrong way" 7.9 s; d nothing. NEG OK on the old runner.ts. TTS of the new line (test/fixtures/measure-tts.ps1, this PC's voices): es 2.19 s, pl 2.095 s, ru 2.31 s; lesson-schedule counts 523 lines, longer than estimate es 282, pl 382, ru 523. listen-words (SHRAMKO_LISTEN_PY=U:/venvs/shramko-listen/Scripts/python.exe): PASS, 581 lines per language, 0 over the bound, 17 of 17 key lines. Package suite 1360 passed, 4 skipped; tsc 0 on tsconfig.json, core, node.
  - [x] O2.3 pin packages/sonic-fpv to 74a05dd (this commit); tsc apps/fly 0 errors.
  - [x] O2.4 (pass 2, this commit) simulator: lessons.ts wrongWay() beside gateBehind(), over courseTarget(): the leg from gates[next-1] (gate 1: the course's last gate only after a lap, seen as the target before it), ahead of the gate and further than lineUpM(leg), the leg flown first (vel along it > WRONG_WAY_MPS, as the runner's legFlown), not closing on the gate or its line-up point, nose-first against the leg for WRONG_WAY_S, at most every WRONG_WAY_EVERY_S: cue 'wrong-way' (dir to the gate) and fly.wrong-way. Three rig tests in sonic-scan-course.test.ts (SharedCourse over the garden rings x5, 9 m legs): (a) 7 m beside gate 2, 10 m past, back to 4 m in front, through: gateBehind 1, wrong-way 0, next 2; (b) 4.5 m over it, the same; (c)+(d) backing 2 s, sliding 2 s each way: 0 wrong-way, then turned round and flown back along the leg: wrong-way 1, gateBehind 0. neg_control.py: against 1715dc7c NEG OK (c fails: 0 wrong-way); against ffb112d7 NEG OK for (a),(b) (gateBehind 0). vitest scan-course, optin, in-place, walls-free: 48 passed; tsc apps/fly 0 errors, tools/bench 0 errors.
  - [x] O2.5 (on b5a967e5) gates.py --only vitest,architecture,i18n,b18: vitest PASS (105 s), architecture PASS, i18n PASS, b18 FAIL only for this file (a Polish letter in "What the owner does"; replaced by ASCII in this commit; b18 not re-run). a6-reference: 1 passed (no flight, input or collision code changed).
  - [~] O2.6 (pass 2) release build b5a967e5 done (dist sha256 7e18d4dc...), walls stand-in copied into dist/walls. New probe tools/bench/scripts/d7-probe.mjs (render off, no lock; Backslash, Shift+G in the sound mode, then the scripted pilot flies pass gate 1, (a) gate 2 7 m beside, (b) gate 3 4.5 m over, (d) backing and sliding on leg 3-4, (c) turned round on leg 3-4; speech events with times). First run on 70b50d42 (port 5760): FAIL at the wait after Shift+G in the sound mode: no course gates and sonic target within 300 s (U:/Temp/gsfpv-train3/onecourse/d7-browser.json). Not looked into yet: the wait condition needs the course and sonic(false).target together; O1-a measured Shift+G in the ordinary flight working on this scene; the walls build of a free flight may hold the course. Next: log READ every 10 s during that wait, then re-run.
  - [x] O2.6 (pass 3) the timeout measured (probe log every 10 s, U:/Temp/gsfpv-train3/onecourse/d7-run2.log): Shift+G in the sound mode made the course (24 gates at 21 s) and the course stayed at next 0, but the debug hook's sonic(false).target read the runner's own target only, null over the scene's course; the wait was the probe's fault, not the course's. Fix e3a0bc72: LessonHost.target() (the runner's target, else the course's next gate, as frame() uses) and the hook reads it (apps/fly/src/sonic/lessons.ts, feature.ts); tsc apps/fly 0 errors. b18 PASS (5 s). Release build e3a0bc72 (sha256 682ee43a...), walls stand-in copied, port 5760, render off, Wroclaw 70b50d42, d7-probe at 5 m/s (U:/Temp/gsfpv-train3/onecourse/d7-browser.json, d7-run3.log): course by Shift+G in the sound mode 24 gates at 10.9 s, target g1; pass gate 1: no line, next 0 to 1; (a) gate 2 7 m beside, 10 m past, back, through: sonic.say.gateBehind at 3.79 s, no wrong way, next 1 to 2 (counted); (b) gate 3 4.5 m over, back, through: gateBehind at 2.95 s, no wrong way, next 2 to 3; (d) backing 3 s and sliding 3 s each way: nothing said; (c) turned round on leg 3-4 (9.4 m), nose-first back 12 m: fly.wrong-way at 3.11 s, once. Page errors 0.
  - [x] O2.6 (pass 3) r11 adapted (4a7269c8: Shift+G by default, Z5_COURSE_KEY=KeyN keeps N, the end is the course feature's first lap) and run on release e3a0bc72, Wroclaw, 5 m/s, render off, PORT 5761 (evidence/2026-11-15/sonic-int-review-r11-onecourse-shiftg.json): 9 of 10; Shift+G made 24 gates in 10 s, target g1; FAIL the flight: 364 s, course next 0, laps 0, hum null in every trail sample, median speed 0, the craft at y 125 m. Measured cause: the engine planned no target.hum over the scene's course: scan-free's layers (packages/sonic-fpv/lessons/scan-free.json) have no 'target', and the runner's beaconTarget() (its own target) was null and the planner hums input.beacon when the field is there. So in the owner's path the hum did NOT lead to the course in Fly by Sound (D1 was not met by O1). Fix (this commit, apps/fly/src/sonic/lessons.ts frame()): over the scene's course the beacon is the course's gate and the bridge's layers get 'target' (back to the lesson's when the course is gone). Test: sonic-scan-course.test.ts "a course in the scene before the switch-on" asserts one target.hum planned; neg_control.py against HEAD 4a7269c8 lessons.ts: NEG OK (expected 0 to be 1). vitest scan-course, in-place, walls-free, optin: 48 passed; tsc apps/fly 0 errors. NOT yet in a release build or a browser.
  - [ ] O2.6 rest: new release build (the hum fix), copy the walls stand-in into dist/walls, re-run r11 on Wroclaw at 5 m/s (PORT=5761 Z5_SCENE=70b50d42 Z5_SPEEDS=5 Z5_TAG=onecourse-shiftg; render off takes no lock); then one run with Z5_COURSE_KEY=KeyN; d7-probe again on the new build (port 5760); r9 and r12 (they take the GPU lock themselves; PORT in 5760-5779). The r11 check label still says "N makes a course" (cosmetic). Then proof on the release build, render off, Wroclaw 70b50d42, course by Shift+G in the sound mode: the four cases with lines and times (onecourse-probe.mjs plus a scripted flight), the ear pilot at 5 m/s to the course end, sonic-int-review r9 and r12; then O1.7 below.
- [ ] O1.7 proof on a new release build: onecourse-probe.mjs (steps 1 to 5 of the stage), the ear pilot (6) at 5 m/s on Wroclaw, sonic-int-review r9, r11 (Wroclaw, Tunis; r11 presses N: adapt to Shift+G, one run keeps N), r12, accept-fly B6 B7 B9 to B16, pause-over-course-probe, a6-reference, gates.py --only vitest,architecture,i18n,b18, picture onecourse-after.png.

### Fixes (stage fixes, review OC-1 to OC-6)
- [x] OC-1 stands (course.ts fail() and the busy return only flashed the HUD). Fix: fail() also says its text to Fly by Sound (sayLine; the texts course.none and course.failed name Shift+G); a press while a course is being made says the progress line (hook.progress). No unit test: course.ts has no feature harness; browser proof below.
- [x] OC-2 partly refuted, partly fixed. Refuted: "after the last gate the hum stops": packages/tracks/src/laps.ts endLap sets next = 0 at 'done', so inUse().next is 0 and courseTarget() leads to gate 1 again (a pass there starts a new run). Stands: the lap and best-lap lines were HUD only. Fix: course.ts frame() says the same line (course.best / course.lapDone) by sayLine. No unit test (no harness); browser proof below.
- [ ] OC-3 stands, the lead's decision (not changed here). Measured: git -C C:/dev/ShramkoSonicFPV branch -r --contains 74a05dd and 7678880 print nothing (neither is on a remote); b05aeda..74a05dd = 7678880 (lane sonic4 sound design) + 74a05dd (D7). Prepared without touching the package's work tree: branch train4-d7only = ab2d6ac, 74a05dd alone on b05aeda (git merge-tree: clean, 12 files, +216 -25). The package tests were NOT run on ab2d6ac. The pin stays 74a05dd.
- [x] OC-4 stands (sg= written by modeScanPage, read by nothing). Fix: course.ts reads soundCourseSeed(liveSearch()) once; the first Shift+G or N on that page makes the course of that seed, later presses a random one (pressSeed). sonic-flight.ts comment updated. No unit test (no harness).
- [x] OC-5 stands. Fix: lessons.ts behindSaid and leg.gate hold the gate objects, not ids. Test sonic-scan-course.test.ts "review OC-5" (gate 1 missed, N makes a new course with the same ids, its gate 1 missed: gateBehind 2, wrong-way 0). neg_control.py against HEAD a053c187 lessons.ts: NEG OK (expected 1 to be 2).
- [x] OC-6 kept on purpose: D6 asks for the change event; the object keys of OC-5 make the sound mode correct without it. Removing it is the lead's choice (course/hook.ts:69, course.ts hook.sound.onChange).
- Checks: vitest sonic-scan-course, sonic-optin, sonic-in-place, sonic-walls-free, sonic-int-lazy: 57 passed; tsc apps/fly 0 errors.
- [x] Browser proof (45deda0f probe change), release build 8695f71f (sha256 72eed43b...), walls stand-in in dist/walls, serve-csp port 5760, Wroclaw 70b50d42, render off (no lock), Shift+G in the sound mode, d7-probe at 5 m/s:
  - random seed (U:/Temp/gsfpv-train3/onecourse/d7-browser-fixes.json): course 24 gates at 7.8 s; pass gate 1 silent; (a) gateBehind at 4.33 s, counted; (b) gateBehind at 3.88 s, counted; (d) silent; (c) fly.wrong-way once at 3.12 s; page errors 0.
  - d7-probe now has D7_SG (adds sg= to the page) and a last case "(lap)": gates 4 to N, then gate 1. With D7_SG=9w94zz (d7-browser-lap3.json): the course seed is 598369679 = sg (OC-4 proven in the browser); (a), (b) "The gate is behind you." once each, (c) "You are flying back. Turn around." once, (d) silent; (lap) laps 0 to 1 and the mode said "Best lap! 2:27.33" at 96 s (OC-2 proven); page errors 0.
- [x] gates.py --only vitest,architecture,i18n,b18 on 27e1f89b: architecture, i18n, b18 PASS; vitest FAIL 1 test: tools/bench/test/sonic-lessons.test.ts "lane sonic-beacon" (expected 0 to be greater than 0.8). Cause measured: a053c187 gave the engine beacon = target whenever the runner had no target, so the corridor lesson (no gate, no course in the scene) lost its track-point beacon. Fix (this commit, apps/fly/src/sonic/lessons.ts frame()): the beacon is the course's gate only when the course gives the target, else the runner's beaconTarget(). That test is the guard: neg_control.py against 27e1f89b: NEG OK. vitest sonic-lessons, scan-course, in-place, walls-free, optin: 76 passed; tsc apps/fly 0 errors. The browser proof above ran on 8695f71f, without this fix; the fix leaves the course path (fromCourse) as it was. Re-run of gates.py --only vitest,architecture,i18n,b18 on 965c3e65: all PASS (vitest 101 s).
- [x] OC-1 in a browser, the busy press (pass 2, dbbfbeeb probe change, release build 22ad9fd4 = 965c3e65 code, sha256 b8524f22..., walls stand-in in dist/walls, Wroclaw 70b50d42, render off, D7_SG=9w94zz): Backslash, Shift+G, Shift+G again 1.17 s later (D7_BUSY=1). Said (U:/Temp/gsfpv-train3/onecourse/d7-busy.json): "Course: finding the free space. Step 1 of 2, 11 %. 0:01 so far, about 0:10 left." then the usual step 2, ready and gates lines; one course, seed 598369679, 24 gates. Control without the second press (d7-busy-ctl.json, port 5762): the same lines without that one, same seed, 24 gates. So the busy press is said and makes no second course.
- [x] Re-run on release 22ad9fd4 (pass 2), Wroclaw, render off: d7-probe D7_SG=9w94zz (U:/Temp/gsfpv-train3/onecourse/d7-p3.json): (a) and (b) "The gate is behind you." once each (4.31 s, 3.87 s), counted after the return; (d) silent; (c) "You are flying back. Turn around." once at 3.1 s; (lap) laps 0 to 1, "Best lap! 2:27.43" said at 96 s. r11 with Z5_COURSE_KEY=KeyN, 5 m/s, PORT 5761 (evidence/2026-11-15/sonic-int-review-r11-onecourse-keyn.json): 10 of 10; the ear pilot flew g1 to g24 and g1 again by the hum (laps 1, 199 s, median 3.83 m/s, 1 life: stuck-flipped at 13.9 s). N and Shift+G call the same generate (D3), so the Shift+G FAIL above (12 lives, restart after g24) points at the restart on a life, not at the hum; still a guess for that run.
- [x] gates.py --only vitest,architecture,i18n,b18 on 3d9ec4a8: all PASS (vitest 143 s). tsc tools/bench 0 errors (oc-hum-los.ts).
- Left of the O1.7 list (not run in pass 3): r9, r12, Tunis 887f27aa, accept-fly B6 B7 B9 to B16, pause-over-course-probe, a6-reference on the final head, picture onecourse-after.png (render on, needs the GPU lock); r11 Shift+G again with course.next logged per life.
- Seen, not fixed (one line each): lessonKeys in the free flight over a course says "Next, key N" (N there makes the course, D3), apps/fly/src/sonic/in-place.ts or feature.ts lessonKeys; the course feature's spoken line "Gates: 24. Fly through gate 1 to start the clock. Shift+T hides the course" names a chord as "Shift+T", not "Shift and key T" (D2 style), apps/fly/src/app/builtin/course.ts sayLine of the course.ready text.
- [ ] OC-1 in a browser, a failed generate (course.none or course.failed said): not run; no cheap way to make the worker fail on a catalogue scan was found in this pass.
- Left (new faults, not fixed, seen in this stage):
  - r11 Shift+G on Wroclaw at 5 m/s, release 8695f71f, PORT 5761 (evidence/2026-11-15/sonic-int-review-r11-onecourse-shiftg-fixes.json): 8 of 10. The hum now exists over the scene's course (trail: hum dir and d 23.5 m in every sample; before a053c187 it was null), but the ear pilot stayed 23.5 m from g1 near (10.5, 5.4, -14) from 297 s to 355 s, median speed 1.86, 5 dodges; FAIL flight (363 s, next 0, laps 0) and FAIL "speed kept on the switch off" (follows: the craft stood). Guess, not measured: a wall of the scan between the craft and gate 1 and a straight-line hum (the course feature's gate 1 is not placed near the craft as the old N course was). Files to look at: tools/bench/src/sonic-int-review.ts steerByHum, apps/fly/src/sonic/lessons.ts courseTarget.
    - Measured (pass 2, tool tools/bench/src/oc-hum-los.ts on that evidence and the stand-in walls; U:/Temp/gsfpv-train3/onecourse/oc-los.json): in 27 of the 30 trail samples (297 s to 359 s) a 0.15 m sphere at the craft touches the scan walls; the ray hits a wall at z = -14.0 within 0 to 0.2 m: the craft is pressed against a scan wall the whole last minute. The trail's hum dir is in the craft's frame, so the gate's world point is not known from it; whether that wall stands between the craft and g1 is not proven.
    - Measured (pass 2, same evidence): flight.gates (the target ids the pilot was led to, in order) is g1, g2, ... g24, g1, and the end is laps 0, next 0. packages/tracks/src/laps.ts endLap (113-121) keeps lapTimes at 'done' (laps would read 1 after the last gate), so the attempt was RESTARTED while g24 was the target, not finished: the ear pilot flew 23 gates of the scene's course by the hum, then the run went back to gate 1. The flight had 12 lives (crash, stuck-flipped, stuck-wedged) from 198 s on; apps/fly/src/course/run.ts courseLife restarts on a life whose director decision is not fresh at that tick or is 'start' (respawn.target default 'rewind', packages/prefs/src/defs/crash.ts:13). Guess, not measured: one of those stuck lives had no rewind sample and was put at the start, which restarts the attempt. That code is stage G3-respawn's (course/run.ts), not this lane's; r11's end check (laps >= 1) cannot pass after such a restart within its 360 s cap. Next measure: log course.next with the life events in r11 (sonic-int-review.ts lifeLog) to tie the restart to one life.
  - d7-probe with a random seed 1028588672 (d7-browser-lap.json): in (b) the course's next went from 2 to 0 after the return through gate 3 (a reset of the run), so (c) and (lap) ran against gate 1. Guess, not measured: the scripted pilot sets the position through the scan's walls and the course run resets on a crash or the rewind respawn (the page sets set.respawn.target=rewind).

### Close (lane onecourse2, stage P1-close, the lead's decisions P1 to P4)
- [x] P1 package pin: new package branch train5 = train4-d7only (ab2d6ac, D7 alone on b05aeda; 7678880 stays on train4, not deleted); packages/sonic-fpv checked out at train5 ab2d6ac. Package tests (vitest in packages/sonic-fpv): 1355 passed, 4 skipped; tsc tsconfig.core.json, tsconfig.json, tsconfig.node.json: 0 errors each; tsc apps/fly 0 errors, tools/bench 0 errors; release build of fefeeceb + pin ab2d6ac: exit 0, 1934 files, sha256 6a67c7e6... (U:/Temp/gsfpv-train3/onecourse2/p1.log).
- [x] P2, P3 and the two left tests (611042f8): lessons.ts keysLine() in the free flight says sonic.say.lessonKeysFree (no "Next, key N"; en, es, pl, ru); mode-keys.ts keyHelpLines(cap, { free }) leaves help.next out in the free flight (feature.ts passes host.lesson.id === SCAN_FREE_ID); course.ts says course.readySpoken ("Shift and key T hide the course", 4 languages), the HUD keeps course.ready with Shift+T; CourseForSound.onChange and its listeners removed (nothing listened: grep onChange in apps/fly/src/sonic found only prefs.onChange); in-place-model.ts introKey() is the intro choice feature.ts uses. Tests in tools/bench/test/sonic-in-place.test.ts describe "one course: the intro, Shift+G in Fly by Sound, no key N in the free flight" (5 tests; the Shift+G and readySpoken tests read course.ts, which has no feature harness). vitest sonic-in-place, scan-course, optin, walls-free, lesson-keys: 91 passed after one regex fix. neg_control.py: intro and Shift+G tests against 98a065b3 (in-place-model.ts, feature.ts, course.ts): NEG OK (introKey not defined in the old code); P2 tests against 0e4fd38d (lessons.ts, mode-keys.ts, feature.ts, course.ts): NEG OK (expected lessonKeys to be lessonKeysFree). tsc apps/fly 0, tools/bench 0. 30d891d4: r11's life spy logs course next and laps at each life and next 0.5 s later.
- [x] Proofs on release build 30d891d4 (sha256 61b27ce8..., 1933 files, pin ab2d6ac, walls stand-in copied into dist/walls; logs U:/Temp/gsfpv-train3/onecourse2/):
  - (1) onecourse-probe, Wroclaw 70b50d42, render off, port 5760 (onecourse.json): Shift+G in the flight 24 gates (seed 551687542), 2 gates passed; Backslash: next 2 kept, the hum's target g3 of the same seed, lines inPlaceIntroCourse and lessonKeysFree (no line names N or a key that makes a course); the sound mode drew 0 gates of its own (prims 0), course drawn 85 to 98: one gate set; Shift+G in the sound mode: new seed 232069865, target g1; N: new seed 1317725352, target g1, no own course; Backslash off: course on, 24 gates, same seed and next; no course: inPlaceIntro (names Shift+G) and lessonKeysFree, nothing generated. Page errors 0.
  - (5) d7-probe D7_SG=9w94zz (d7.json): seed 598369679; gate 1 silent; (a) gateBehind 4.23 s, next 1 to 2; (b) gateBehind 3.81 s, next 2 to 3; (d) silent; (c) fly.wrong-way once at 3.08 s; (lap) laps 0 to 1, "Best lap! 2:27.20" at 96 s. Page errors 0.
  - (2) r11 Wroclaw 70b50d42, 5 m/s, render off (evidence/2026-11-15/sonic-int-review-r11-oc2-*.json, not in git: the folder is ignored):
    - Shift+G run 1 (port 5761): 9 of 10; FAIL flight end only: 363 s cap, the ear pilot was led g1 to g19 (next 18), median 3.22 m/s; 7 lives (stuck-flipped, stuck-wedged, crash), at each life next before = next 0.5 s later (0 five times, 9 twice): no life restarted the attempt (P4 not seen).
    - Shift+G run 2 (port 5762): 8 of 10; the ear pilot was led g1 to g24 and then g1 again (25 targets): all 24 gates flown, the lap closes only at gate 1 (laps.ts; the d7 (lap) case counts the lap there); it stayed near gate 1 from 160 s to the 363 s cap (7 lives, next 0 before and after each), so the lap was not counted; FAIL also "speed kept on the switch off" (the craft stood). So the earlier guess "a life restarted the attempt after g24" is refuted by this run: next stays at each life, and g1 after g24 is the lap's closing gate.
    - N run (port 5763): 9 of 10; FAIL flight: the ear pilot never passed gate 1 (14 lives, 13 stuck-wedged, median 0.06 m/s); next 0 at every life. A random seed each run; the previous pass's N run on 22ad9fd4 flew the lap (10 of 10).
  - (3) r11 Tunis 887f27aa, Shift+G, 5 m/s (port 5764): 10 of 10 in 223 s.
- [x] Proofs pass 2 on release build c9bfb2f1 (same code as 30d891d4; exit 0, 1933 files, sha256 6136c9ca...; walls stand-in copied, 10 entries; script U:/Temp/gsfpv-train3/onecourse2/proofs3.sh, log proofs3.log):

  | Proof | Result |
  |---|---|
  | r11 Wroclaw 70b50d42, Shift+G run 3, 5 m/s, render off, cap 600 s, port 5767 | 10 of 10 in 193 s; lap counted at 162 s (laps 1, gates g1..g24 then g1), median 3.82 m/s, 1 dodge, 0 misses; 3 lives (stuck-wedged 10.7 s, crash 14.9 s, stuck-flipped 137.8 s), course next before = 0.5 s after at each (0, 0, 22): no restart (P4 not seen) |
  | pause-over-course-probe, render off, port 5770 | pass true (1920 and 844 wide: shown in flight, hidden under the menu, control, back after the menu) |
  | accept-fly B6 B7 B9 B10 B11 B12 B13 B14 B15 B16, SITE=http://localhost:5770 (first line "accept-fly target: http://localhost:5770") | all 10 true |
  | r9 (port 5765, lock taken by the tool) | 11 of 11 in 184 s |
  | r12 (port 5766, lock taken by the tool) | 9 of 9 in 158 s |
  | onecourse-probe RENDER=on, Wroclaw, under the lock (onecourse-on.json) | exit 0; the sound mode's own prims 0 in all 9 samples; course drawn 91 to 114 while on, 0 with no course; picture U:/Temp/gsfpv-train3/shots/onecourse-after.png looked at: one set of teal course gates with the yellow next-gate ring, the spoken line "Shift and key T hide the course" beside the HUD's "Shift+T hides the course" |
  | a6-reference on c9bfb2f1 | 1 passed |
  | gates.py --only vitest,architecture,i18n,b18 on c9bfb2f1 | vitest PASS (86 s), architecture PASS, i18n PASS, b18 FAIL only for one placeholder-rule word in this file (the JavaScript word for a missing value); reworded, b18 re-run on the doc change: PASS |

  - Counted r11 runs with Shift+G on Wroclaw: run 3 above to the end (10 of 10); runs 1 and 2 of pass 1 ended at the 363 s cap (g19, and the lap's closing gate 1). Tunis 887f27aa: 10 of 10 (pass 1).
  - Seen, not fixed: the ear pilot (tools/bench/src/sonic-int-review.ts steerByHum) wedges at walls near gate 1 on some random Wroclaw courses (N run of pass 1; run 2 at the lap's close): a straight-line pilot against scan walls, suspect the pilot, not the page (a guess, not measured).
  - Seen in the picture, not fixed: the course feature's clock block ("0:00.00 Lap 1 of 3") sits under the three speech captions at the top centre and is hard to read while they show (apps/fly/src/app/builtin/course.ts or the caption CSS; one picture only).

### For the lead (lane onecourse, whole branch)
- Package pin: packages/sonic-fpv = ab2d6ac on package branch train5 (created from train4-d7only; 7678880 stays on train4). Nothing new committed in C:/dev/ShramkoSonicFPV; its evidence/audio-proofs.json and evidence/demo-check.json untouched; README not touched. train5 and train4-d7only are local only (no push).
- Files changed outside apps/fly/src/sonic over origin/main..HEAD: apps/fly/src/app/builtin/course.ts, apps/fly/src/app/builtin/sonic-flight.ts, apps/fly/src/course/hook.ts, docs/wip/sonic4.md, docs/wip/train3-lead.md, packages/i18n/locales/fly/course/{en,es,pl,ru}.json, packages/i18n/locales/fly/sonic/{en,es,pl,ru}.json, packages/sonic-fpv (pin), tools/bench/scripts/d7-probe.mjs, tools/bench/scripts/onecourse-probe.mjs, tools/bench/src/oc-hum-los.ts, tools/bench/src/sonic-int-review.ts, tools/bench/src/sonic-line-gate-audit.ts, tools/bench/src/sonic-speed-measure.ts, tools/bench/test/sonic-in-place.test.ts, tools/bench/test/sonic-lesson-rig.ts, tools/bench/test/sonic-optin.test.ts, tools/bench/test/sonic-scan-course.test.ts, tools/bench/test/sonic-walls-free.test.ts.
- P4 is kept as decided; no life in the four Wroclaw r11 runs moved the course's next gate (pass 2 run 3: lives at next 0, 0, 22, kept).
- Pass 2 changed no code: only this file. The release to ship is the code of 30d891d4 (= c9bfb2f1 and later in code) with the pin ab2d6ac.

### Facts O1-a (measured "before", release 98a065b3, Wroclaw 70b50d42, stand-in walls, render=off; U:/Temp/gsfpv-train3/onecourse/before-off.json, before-on.json)
- Shift+G in the ordinary flight: 24 gates (seed 406159527), drawn 93; the scripted pilot passed gates 1 and 2 (next 1, then 2).
- Backslash: lines sonic.say.inPlaceIntro (names N for a course) and sonic.say.lessonKeys; the hum's target null (the course feature's gate 3 is not led to); the course line goes on at gate 3.
- Shift+G in the sound mode: nothing (the course feature's key ignored the press while ctx.sonic; 240 s watched, same seed, same gate 3).
- N in the sound mode: sonic.say.courseMaking, the progress text, courseReady, the lesson goal; the sound mode's own course, target g1, 51 entities on the sound stage (render=on run) beside the course feature's 112: two gate sets. The course feature's course was reset to gate 1 by the lesson open (its line shows 0:00.00, Gate 1 of 24).
- Backslash off: the course feature's course stays (on, 24 gates), at gate 1 after the reset above.
- No course in the scene, Backslash: inPlaceIntro and lessonKeys; nothing generated.

### What the owner does (steps 1 to 5 and the D7 cases proven on release 30d891d4, Wroclaw, render off; picture, r9, r11 to the end, r12, accept-fly on c9bfb2f1)
- Shift+G: a course in the scene, in the ordinary flight and in Fly by Sound alike.
- In Fly by Sound's free flight the key lines name no N: Back, Repeat, Menu and Main menu only; the course's spoken ready line says "Shift and key T hide the course".
- Backslash: Fly by Sound on; the hum leads to the next gate of that course, the gate count goes on.
- Shift+G again (or N in Fly by Sound): a new course replaces the old; the hum leads to gate 1.
- Backslash: Fly by Sound off; the course and its gate count stay.
- He flies past a gate beside it or over it: he hears once "The gate is behind you" (pl "Bramka jest za tob(a-ogonek)"), the hum leads back to it, he turns, flies back to the front and through it, and it counts; no "wrong way" on the way back (d7-probe in the browser, Wroclaw). Turned round and flying back along a leg nose-first, he hears "You are flying back. Turn around." once.

## Quiet (lane quiet, the owner's message 54: Fly by Sound without the narrator, no flight waits for a line)

### Status (stage K1-no-waits)
- [x] K1.0 release build of sonic4 704f2043 (pin ab2d6ac): vite and pages built; the last step (tar of dist.tgz) failed with
  "file changed as we read it" because the walls stand-in was copied into dist/walls while tar ran (this worker's order, not the
  code). dist itself is whole; the next build must copy the walls only after "exit 0" in the log. Server serve-csp port 5760.
- [x] K1.1 probe tools/bench/scripts/quiet-probe.mjs (render off, no lock; READER=1 sets selfVoice off in the prefs document,
  NARRATOR=off sets the new setting once built) and quiet-summary.mjs. Measured "before" on Wroclaw 70b50d42 (Facts K1-a).
- [ ] K1.2 measure the ?sonic=scan page (the sound page's free flight on a scan, not in place): the owner most likely opened
  the scan there. Suspect from reading, not measured: packages/sonic-fpv/src/lesson/runner.ts startAttempt() sends the craft back
  to the start when it moved more than START_SLACK_M (1 m) while the task was said ("left"), so flying during the intro is undone
  at its end; in place (Backslash) lessons.ts act() skips that place. The probe needs a PAGE=sonic switch: read the scan's scale
  from the ordinary page (modeScanPage in apps/fly/src/app/builtin/sonic-flight.ts builds ?sonic=scan&scene=..&sz=..).
- [x] K1.3a package (pass 2, train5 = 293ebae on ab2d6ac, also in C:/dev/ShramkoSonicFPV branch train5; its work tree on train4
  untouched): SonicPrefs.narrator (absent or true: on; prefs.ts KEYS, ADDED_KEYS, validator, default); engine say({ quiet }):
  onSpeech and caption(text, line, { quiet }) only, not voiced, not waited, no duck; RunnerOptions.freeFlight: the first
  attempt is not placed back. test/free-start.test.ts (NEG OK on the old runner.ts); test/prefs.test.ts default list.
  Package suite 1358 passed, 4 skipped; tsc tsconfig.json, core, node: 0 errors each (U:/Temp/gsfpv-train3/quiet/pkg-*.log).
- [x] K1.3b green (stage K2 pass 1): apps/fly tsc 0 errors (audio.ts createEngine caption type and bridge.ts BridgeEngine.say
  take `quiet`); sonic-quiet.test.ts Q2 now asserts the craft's distance from the start never shrinks by 0.5 m or more (the old
  bound of 2 m a step failed on the rig craft's own speed, 2.5 m a 100 ms step, not on a place back); runnerOptions test store
  has collection(); sonic-start-screen.test.ts: settings 17 stops, the stops after 'sonic-narrator' one place later.
  sonic-quiet, sonic-start-screen, sonic-int-reader, sonic-scan-course: 50 passed (U:/Temp/gsfpv-train3/quiet/k2-v4.log).
  neg_control.py against 704f2043 for apps/fly/src/sonic/lessons.ts: NEG OK, 3 of 7 fail by assertion (k2-neg1.log).
- [x] K1.3b history (pass 2): bridge.ts `quiet` predicate (say with quiet, no sequential read
  time); entry.ts quietFlight(prefs, lessonId, paused) (narrator false, lesson scan-free, not paused) and CaptionSink.add(text,
  { live }); captions.ts add: a quiet line is not added when the captions are hidden, aria-hidden when the region is live;
  audio.ts passes the caption's quiet; feature.ts wires bridge.quiet; lessons.ts runnerOptions gives freeFlight to scan-free;
  start-screen.ts check 'sonic-narrator' after 'sonic-sr' (texts sonic.settings.narrator, narratorWhat in en, es, pl, ru);
  rig say honours quiet; new tools/bench/test/sonic-quiet.test.ts. Pin packages/sonic-fpv = 293ebae (this commit).
  State at the stop (U:/Temp/gsfpv-train3/quiet/k1-vitest.log, k1-tsc-fly.log):
  - tsc apps/fly: 5 errors, all audio.ts:81: apps/fly sees the old caption type `(text, line) => void` (AudioDeps.createEngine's
    option type in audio.ts, or the package's built types: look which; fix the type, not the call).
  - sonic-quiet.test.ts: the 3 Q1 tests pass; the 3 Q2 tests and the runnerOptions test fail (not read yet: open the log; the
    Q2 harness opens openFree without a course and with `track: null as never` in RigScan, a guess for the cause).
  - sonic-start-screen.test.ts: 4 tests fail after the new 'sonic-narrator' stop (pinned counts or "Item n of N" lists in that
    file beyond STOPS; read the failures and update the pinned lists).
  - sonic-int-reader.test.ts, sonic-scan-course.test.ts: pass.
- [ ] K1.4 Q2 no wait in a flight: code done in K1.3 (freeFlight); proven only when sonic-quiet.test.ts Q2 passes, with
  neg_control.py against 704f2043 for apps/fly/src/sonic/bridge.ts, lessons.ts, entry.ts. Seen while reading: K's key help and I's
  status (asked by the pilot) are quiet too with the narrator off in a flight (quietFlight does not tell them apart): decide.
- [ ] K1.5 unit tests with negative controls (narrator off: no line to the voice or the reader's region in a flight; no wait in a
  flight in each setting; the setting kept and applied at once; captions by their own setting); package tests and its three
  typechecks; pin packages/sonic-fpv to the new train5 commit; tsc apps/fly; gates.py --only vitest,architecture,i18n,b18; a6-reference.
- [ ] K1.6 the same numbers after (quiet-probe before/after, both pages, three settings).
- [x] K1.4/K1.5 per change (stage K2 pass 1, on 6c1a140a): gates.py --only vitest,architecture,i18n,b18 all PASS (vitest 88 s;
  logs U:/Temp/gsfpv-gates-20261115-163251); a6-reference 1 passed (U:/Temp/gsfpv-train3/quiet/k2-a6.log);
  packages/prefs/test/migrate.test.ts 25 passed. 'Quote' is used nowhere in apps/fly/src, packages/prefs/src, packages/sonic-fpv/src. K's key help and I's status are quiet too with the narrator off: still open.

### Status (stage K2-sounds-prove)
- [x] K2.0 K1 made green first (commit 6c1a140a, see K1.3b): the stage could not build on red tests.
- [x] K2.1 Q4 built (pass 2): KEYMAP sonic.narrator = Quote (cap "'", when 'sonic'); apps/fly/src/sonic/narrator-key.ts (the
  handler: a repeat does nothing, setup.update({narrator}) then on: sonic.say.narratorOn said with interrupt, off: a cue only);
  feature.ts wires it beside sonic.home (when: mode active, a lesson open, no dialog, no menu); KEY_HELP line sonic.say.helpNarrator
  after helpHome; locales keys.sonic.narrator, sonic.key.Quote, sonic.say.helpNarrator, narratorOn (plus narratorTip for Q6 and
  lessonNarrator for Q5, not used yet) in en, es, pl, ru. The off sound is the package's checkpoint chime ({kind:'checkpoint'})
  until K2.2 gives its own. Tests: new tools/bench/test/sonic-narrator-key.test.ts (4), keymap.test, app-keys.test, sonic-optin
  (the K list gains "'"), sonic-quiet: 84 passed (U:/Temp/gsfpv-train3/quiet/k2p2-v2.log); tsc apps/fly 0 errors; neg_control.py
  on keymap.ts and mode-keys.ts against HEAD: NEG OK by assertion (k2p2-neg1.log). The feature.ts wiring itself is not covered by
  a unit test (the rig runs SonicMode and LessonHost, not feature.ts): K2.6's browser proof (2) covers it. Commit 8cfea748; then
  packages/prefs/test/catalog.test.ts follows the seventh mode key (list, caps, count 7); gates.py --only
  vitest,architecture,i18n,b18 all PASS (vitest 84 s; U:/Temp/gsfpv-gates-20261115-164350).
  Left from Q4: the off sound is the checkpoint chime (K2.2 gives the narrator its own); not run in a browser.
  Choice of the key, kept: `Quote` (cap "'", aria "Quote"), when 'sonic'. Why: packages/prefs/src/keymap.ts says every
  plain letter is bound (the free ones W A S D Q E are FLYING_CODES); Quote is bound nowhere in KEYMAP; Slash opens quick find in
  Firefox; digits belong to a running lesson's question (sonic/digit-key.ts), and the free flight is a running lesson. Work:
  KEYMAP entry `sonic.narrator` beside sonic.home (line about 126), label `keys.sonic.narrator` in the four fly locales,
  packages/prefs/test/keymap.test.ts DESIGN_TABLE, tools/bench/test/app-keys.test.ts; handler in apps/fly/src/sonic/feature.ts
  beside `ctx.keys.on('sonic.home', ...)` (line about 554): flip entry.setup.prefs.narrator through the same path the start
  screen's check uses (start-screen.ts line about 595, `this.change({ narrator: v }, said)`), so it is saved and applied at once;
  on: say a two-word line (new `sonic.say.narratorOn`, four locales) after the flip (bridge.quiet then answers false); off: a cue
  only. Test in tools/bench/test/sonic-quiet.test.ts with the rig; negative control on feature.ts.
- [x] K2.2 built in stage fixes (QV-2, below: quiet-cues.ts, package cues only; browser proof still K2.6). Q3 the table of every line a flight can say and its sound with the narrator off (course ready chime, gate passed and
  finish notes exist, gate behind: hum from behind plus one short sound, wrong way, crash, mode on and off). Lines to list: the
  runner's free-flight lines (packages/sonic-fpv/src/lesson/runner.ts), apps/fly/src/sonic/course-speech.ts, host-lines.ts,
  in-place.ts, feature.ts intro (line about 585). New sounds go in the package (C:/dev/ShramkoSonicFPV branch train5, pin in
  packages/sonic-fpv) with an offline audio proof (level against the bar, no clipping) and the limit of sounds at once; the
  package's voices evidence needs `pnpm listen:words` only for new spoken lines (see cost notes O1 pass 3, O2).
- [x] K2.3 Q5 (stage fixes pass 2): a lesson of the list keeps its words with the narrator off (entry.ts quietFlight, from K1);
  now it says sonic.say.lessonNarrator ("The narrator is on for this lesson. It goes off again when the lesson ends.") once,
  right after its title (lessons.ts 'say' action, the first step; LessonPage.narratorOff wired in feature.ts). The saved value
  is never changed by a lesson, so nothing has to be given back. Test tools/bench/test/sonic-lesson-narrator.test.ts 3 passed;
  neg_control.py on lessons.ts against HEAD: NEG OK by assertion (q5-neg.log); with sonic-hints, sonic-quiet, sonic-quiet-cues,
  sonic-narrator-key: 31 passed (q5-v2.log); tsc apps/fly 0 errors. Not run in a browser.
- [ ] K2.4 Q6 one line after the first course finished by sound with the narrator on, naming the K2.1 key; a flag in the sonic
  collection so it is never said again.
- [ ] K2.5 Q7 captions: at most two lines, never over the course's clock block; measure the rectangles at 1920x1080, 1280x720,
  844x390 (apps/fly/src/sonic/captions.ts and sonic.css; the clock block is the course feature's, lane editor3i/fix3b own
  their code: place the captions, do not move the clock).
- [ ] K2.6 browser proof on the release build, render off, Wroclaw 70b50d42 and once Tunis 887f27aa, items (1) to (7) of the
  stage text; accept-fly B6 B7 B9 to B16; two pictures quiet-settings.png and quiet-captions.png under the lock.

### Fixes (stage fixes, review QV-1 to QV-5)
- [x] QV-1 stands (read: sayVia called rt.engine.say with no quiet). PageRuntime.quiet() returns mode.bridge.quiet (the predicate
  feature.ts sets) and PageRuntime.quietSound(key); app/say-via.ts sends a quiet line with { quiet: true } and plays its sound.
  Covers course.ts (Shift+G progress and ready), walls.ts, rooms/announce.ts, sonic-session/session.ts. Not changed (another
  agent's file): apps/fly/src/sonic/gpu-hint.ts about line 353 still says its line straight to the engine.
- [x] QV-2 stands (K2.2 was not built). One table apps/fly/src/sonic/quiet-cues.ts (QUIET_SOUNDS: every line a flight says, its
  cue or 'nothing' with the reason), read by bridge.ts say and by sayVia. Only the package's existing cues, no new sound, so no new
  offline proof and the planner's limit of sounds at once is unchanged: gate behind (sonic.say.gateBehind, fly.gate-behind):
  'wrong-side' (centred; the hum leads back); put back (fly.reset-start, fly.reset-checkpoint): 'reset' sweep; mode on
  (sonic.say.inPlaceOn): 'answer' yes (two notes up); walls ready (sonic.say.wallsIn) and course ready (course.ts
  course.readySpoken, passed as quietCue): 'checkpoint' chime; wrong way, wrong side, stage: nothing added (their cue is sent with
  the line, runner.ts 1158, 959, 1256, lessons.ts 354); intro, keys, course offer, fly.go, walls building, progress: nothing (they
  teach or report a flight that goes on). Crash: the touch cue (mode.ts 409) as before.
- [x] QV-3 stands: feature.ts says sonic.say.scanLoading only with the narrator on; scanFailed stays spoken. No unit test (feature.ts
  is not in the rig).
- [x] QV-4 stands: the narrator-off sound is NARRATOR_OFF_CUE = 'answer' no (two notes down), not the checkpoint chime.
- [x] QV-5 stands (from knowledge of the layouts, not measured): spokenKey names only Key*/Digit* codes from getLayoutMap, Quote by
  the locale. es sonic.key.Quote = "a la derecha de la \u00d1" (the key right of N-tilde, Spain and Latin America), ru = "\u042d"
  (the key E-reversed on JCUKEN). en and pl keep the apostrophe (their layouts print it there).
- Tests: new tools/bench/test/sonic-quiet-cues.test.ts (sayVia off and on, PageRuntime.quiet, the bridge's sounds off and on,
  the table); with sonic-quiet, sonic-narrator-key, sonic-int-lazy: 25 passed (U:/Temp/gsfpv-train3/quiet/fx-v2.log); tsc apps/fly
  0 errors; neg_control.py against HEAD on say-via.ts, bridge.ts, runtime.ts: NEG OK, 3 failed (fx-neg1.log, bridge case by
  assertion). First try put the table in app/: sonic-int-lazy failed (the main chunk named 13 mode texts), so it lives in sonic/.
  Commit 64b565c1. Then gates.py --only vitest,architecture,i18n,b18 all PASS (vitest 85 s; U:/Temp/gsfpv-gates-20261115-165721);
  a6-reference 1 passed (fx-a6.log).
- [x] Browser proof (stage fixes pass 2): release build of 6af1a229 (build-release exit 0, sha256 b764fb82...; walls stand-in copied
  into dist/walls after the exit), serve-csp port 5760, quiet-probe.mjs (now records every speechSynthesis.speak, text added in a
  live region that is not aria-hidden, the plan's cues, QUOTE=1 presses the narrator key twice), render off, no lock. Files
  U:/Temp/gsfpv-train3/quiet/p2-off.json, p2-on.json, p2-reader.json, p2-tunis-off.json. Steps:
  (1) Wroclaw 70b50d42, narrator off: 0 lines voiced in the flight (speak calls: an empty one at 0.03 s, the engine's warm-up, and
  "Narrator on." after the key); the 11 lines of the flight are only reported (events, captions). (2) No wait: the craft answers
  KeyW at 0.56 s (off), 0.57 s (on), 0.56 s (reader), 0.57 s (Tunis off), and again at 16.5 s in each. (3) Shift+G: the first hum
  of gate 1 in the same sample as the course (7.02 s off, 8.38 s on, 8.71 s reader, 5.86 s Tunis). (4) Narrator off: the cue
  target.checkpoint at the course's start (27.32 s, the gates appear at 27.28 s), Wroclaw and Tunis (26.08 s); with the narrator on
  no such cue, the line is voiced instead (4 course lines voiced at 20.26 to 28.51 s). (5) Quote key: narrator on, first press at
  31.62 s gives cue target.answer at 31.74 s (the off sound), second press at 35.66 s voices "Narrator on." at 35.67 s; started off,
  the first press voices "Narrator on." at 30.38 s, the second gives target.answer at 34.42 s; the saved value follows (true, false).
  (6) Tunis 887f27aa narrator off: 0 voiced, checkpoint cue, no wait. (7) Reader box (selfVoice off): 0 voiced, no wait, hum at
  the course. Pages: 0 page errors in all four runs.
- [x] Handover check (pass 2, on d8b55f43): gates.py --only vitest,architecture,i18n,b18 all PASS (vitest 94 s;
  U:/Temp/gsfpv-gates-20261115-170756). a6-reference not re-run: no flight, input or collision file changed since fx-a6.log.
  Server on 5760 stopped.
- [ ] Left (stage fixes): K2.4 (Q6) and K2.5 (Q7) still open; K2.3 (Q5) not run in a browser. For Q6 the course's finish in a
  free flight was not found yet: lessons.ts observe() sees 'attempt-pass' and 'passed' events (line about 717), and the runner
  pushes a 'lap' cue in passedGate (packages/sonic-fpv/src/lesson/runner.ts about 948); which of them marks the course of Shift+G
  finished in scan-free is to be read first. The probe still did not drive a course to its finish, so gate passed, finish, gate
  behind and wrong way with the narrator off were proven by unit tests only (sonic-quiet-cues), not in a browser. Seen in the proof, not this lane's code, not fixed: #ui is a
  polite live region (apps/fly page shell) and receives the HUD (THR, ARMED, ANGLE about 10 times a second) and the course box
  lines ("Course: finding the free space ... Course ready: 24 gates", apps/fly/src/app/builtin/course.ts box text) in every
  setting; with the reader box on and the narrator off a screen reader would still read the course box. Suspect file: the #ui
  aria-live attribute in the page shell; a guess, not measured with a real screen reader.

### Status (lane quiet2, stage W1-finish, the lead's N1 to N6)
- [x] W1.0 merge of origin/main into sonic4 (7dde5e2c, no conflict); tsc apps/fly 0 errors; release build exit 0 (sha 7dde5e2c,
  sha256 2d058ef6...; U:/Temp/gsfpv-train3/quiet2/tsc-merge.log, build-merge.log).
- [x] N1 (this commit): BridgeLike say(line, interrupt, { asked: true }) is never quiet; feature.ts sayAsked for K's KeyHelp and I's
  status. Test tools/bench/test/sonic-quiet2.test.ts (N1 block).
- [x] N2 (this commit): the narrator key is Shift+V (code KeyV with Shift; V for voice). Why: every plain letter is bound in the
  ordinary flight (always) or in the sound mode; the bound Shift chords are N F T G B; V is in the same place on QWERTY, QWERTZ,
  AZERTY, Polish and Spanish (from knowledge of the layouts, not measured). Spoken by its letter through key-names.ts spokenKey's
  chord path ("Shift and key V", the layout's letter). sonic.key.Quote removed from the four locales; es, pl, ru helpNarrator say
  "{key}" without the word for key (the chord brings it). keymap.test, app-keys.test, sonic-narrator-key.test follow.
- [ ] N3: decision so far, not built: the off sound stays NARRATOR_OFF_CUE = 'answer' no (two notes down, QV-4), which is not a
  gate's chime; a free flight asks no question, so no other line of a flight plays it. A sound of its own in the package (train5,
  offline proof, pin) was not made: the lead decides whether 'answer' no is enough.
- [x] N4 (this commit): PageRuntime.engine is quietEngine(engine): a line with no `quiet` of its own (the GPU hint's,
  app/builtin/gpu-hint.ts line about 353, not changed) is sent quiet with its table sound while the flight is quiet. #ui:
  new apps/fly/src/sonic/live-quiet.ts sets aria-live off on #ui and every live region inside it (walls.ts bake-status) while
  quiet, and gives the own values back; feature.ts syncs it every 250 ms (estimate, not measured). No file outside apps/fly/src/sonic
  changed for N4. Test sonic-quiet2.test.ts (N4 blocks).
- [x] N5 the table (apps/fly/src/sonic/quiet-cues.ts QUIET_SOUNDS is the code's copy), narrator off in a flight:
  gate behind (sonic.say.gateBehind, fly.gate-behind): 'wrong-side' cue; put back (fly.reset-start, fly.reset-checkpoint): 'reset'
  sweep; mode on (sonic.say.inPlaceOn): 'answer' yes; walls ready (sonic.say.wallsIn) and course ready (course.readySpoken): 'checkpoint'
  chime; wrong way, wrong side, stage: their own cue is sent with the line (runner.ts, lessons.ts), nothing added; gate passed and
  finish: the runner's gate and lap notes, no line needed; crash: the touch cue; scanLoading: not said, nothing (the page shows the
  load, and the scan's sound starts when it is in); scanFailed: still spoken (else the pilot has no sign at all); GPU hint: nothing
  (it reports the graphics, not the flight); intro, keys, course offer, fly.go, walls building, course and walls progress: nothing
  (they teach or report a flight that goes on); K and I: spoken (asked, N1); narrator off: 'answer' no; narrator on: spoken.
- [x] N6 Q6 (pass 2, this commit): the scan-free runner emits no 'attempt-pass' for the course in the scene (its goal is 5000 m;
  the course feature counts the gates), so the hook is the course hook's finished laps (CourseHook.laps, LapTimer keeps the count
  after 'done'): lessons.ts tipAfterCourse() in frame(): a rise of the count over the course in use, in the free flight, narrator on,
  not said before: sonic.say.narratorTip once with the key's name (names.of('sonic.narrator')); the mark SonicState.narratorTip
  (packages/prefs doc.ts, kept only when true; store.ts narratorTipSaid / setNarratorTipSaid). A course lapped before the switch-on
  does not count. "First course finished" = the first lap finished (a generated course of more laps says it after lap 1).
  Test tools/bench/test/sonic-quiet-n6.test.ts 5 passed, with migrate.test 30 passed (quiet2/n6-v1.log); NEG OK on lessons.ts
  against HEAD (n6-neg.log); tsc apps/fly, packages/prefs, tools/bench 0 errors. No new localStorage key (a field in the sonic
  collection), so no pinned table changes.
- [x] N6 Q7 (stage W2, built first because the stage's picture needs it): captions.ts CAPTION_LINES 3 to 2; CLOCK '.course-hud':
  fit() sets the region's inline top CAPTION_GAP_PX under the clock block's bottom while it is shown and meets the region's columns
  (cleared otherwise); feature.ts's 250 ms timer also calls captions.refit(). sonic-captions-fit.test.ts follows the two lines and
  gains 3 clock cases; with sonic-review and sonic-quiet2: 28 passed (quiet2/q7-v2.log); NEG OK on captions.ts (q7-neg.log); tsc
  apps/fly 0 errors. The rectangles in a browser: W2.
- [x] Checks of N1, N2, N4: sonic-quiet2 (6), catalog.test: 16 passed (U:/Temp/gsfpv-train3/quiet2/v2.log); with sonic-narrator-key,
  app-keys, keymap.test, sonic-quiet-cues, sonic-quiet: 82 passed in v1.log (its 3 fails fixed in v2); tsc apps/fly 0 errors
  (tsc1.log); neg_control.py against 7dde5e2c on bridge.ts and runtime.ts: NEG OK (neg1.log). live-quiet.ts is new (no old
  version) and the 250 ms wiring in feature.ts is not in the rig: browser proof needed.
- [ ] Q7 plan (pass 2, read, not built): CAPTION_LINES 3 to 2 (captions.ts line 12). '.course-hud' into PANELS alone is not
  enough: the captions start at 92 px and the clock block at about 120 px (hud.css .course-hud top 14+30+76 px), and fit() always
  keeps the newest line, so one line still covers the clock. Build: in fit() place the region under the visible .course-hud
  (root.style.top = its bottom + CAPTION_GAP_PX, cleared when it is hidden or covered; guard a stand-in without style), and refit
  from feature.ts's 250 ms liveTimer (the course box appears without a caption). Tests that pin three shown lines follow:
  tools/bench/test/sonic-captions-fit.test.ts (the 'all three shown' cases), sonic-review.test.ts 145-177 use mod.CAPTION_LINES;
  new case: a stand-in .course-hud (its querySelectorAll stub answers only '.sonic-attitude' today) pushes the region under it.
  Then measure the rectangles in a browser (captions box against .course-hud) on the release build.
- [ ] Left: N3 decision by the lead (or a package sound); N6 Q7; gates.py --only vitest,architecture,i18n,b18;
  a6-reference (keymap.ts changed, an input file); browser proof stage (Shift+V both ways, K and I voiced with the narrator off,
  #ui aria-live off in a quiet flight, the GPU hint quiet) on the release build, Wroclaw and Tunis.

### Status (lane quiet2, stage W2-prove)
- [x] W2.0 Q7 built first (c719a4ab, see N6 Q7 above). Release build of c719a4ab exit 0 (quiet2/w2-build.log); walls stand-in
  (U:/Temp/gsfpv-train2/walls/release, 9 scans and manifest) copied into dist/walls after the exit; serve-csp 5760 (stopped).
- [x] W2.1 quiet-probe.mjs: the narrator key is Shift+KeyV (QUOTE=1), new KI=1 presses K then I. Render off, no lock.
  Wroclaw 70b50d42 narrator off (quiet2/w2-wro-off.json): the craft answers KeyW at 0.57 s after Backslash (speed over 0.5 m/s);
  course ready 16.05 s after Shift+G, the hum of gate 1 and the cue target.checkpoint in the same sample (0 s apart); 0 lines voiced
  from the switch on until K (only the engine's empty warm-up at 0.04 s). K at 39.44 s: the 14 lines of the key help voiced (N1).
  Shift+V at 51.67 s: "Narrator on." voiced at 51.68 s. Tunis 887f27aa off (w2-tun-off.json): KeyW at 0.66 s, course 6.68 s, hum
  and checkpoint in the same sample, 0 voiced until K, K voiced. 0 page errors in both.
- [ ] Found in W2.1, not fixed (measured, cause a guess): (a) I pressed 6 s after K said "Back to the flight." (Wroclaw 45.55 s,
  Tunis 36.15 s), not the status: K's key help seems to stay open as a menu and I closes it; I alone after the help is gone was
  not run. Suspect apps/fly/src/sonic/feature.ts (KeyHelp and the I handler). (b) #ui got text announced while quiet: 8 lines at
  0.13 s (the HUD's DISARMED, ANGLE, volts before the first 250 ms sync of live-quiet.ts; a guess: sync once at the switch on) and
  244 (Tunis) / 222 (Wroclaw) during the K help (bridge.paused makes quietFlight false while the help is open, by design the menus
  keep their words; the HUD text in #ui is then read too). Suspect apps/fly/src/sonic/feature.ts liveTimer and entry.ts quietFlight.
- [x] W2 pass 2 (this commit): (a) is by design, not a fault: K's help holds the flight while its 14 lines play and any key cuts
  it, that press doing only that (mode-keys.ts KeyHelp); I was pressed 6 s after K. quiet-probe.mjs KI now presses I after the
  hold ends (session.paused false, at most 90 s), recorded as ki[0].heldUntil. (b) fixed in live-quiet.ts and feature.ts: tick()
  every frame (after the HUD wrote, acts only on a change) plus a sync at install, and liveRegionPaused(): K's 'help' hold alone
  keeps #ui quiet (its lines go to the captions, outside #ui). sonic-optin's pinned K list follows Shift+V. sonic-quiet2 and
  sonic-optin 28 passed (quiet2/w2p2-v1.log); NEG OK on live-quiet.ts against HEAD (w2p2-neg.log, the old file has no tick:
  TypeError); tsc apps/fly 0 errors (w2p2-tsc.log).
- [x] W2 pass 2 browser recheck: release of f64e6d87 exit 0 (sha256 d2043976..., quiet2/w2p2-build.log), stand-in walls in
  dist/walls, serve-csp 5760, render off, no lock; NARRATOR=off KI=1 QUOTE=1 FLY_S=15 (quiet2/w2p2-70b50d42-off.json, -887f27aa-).
  Wroclaw: KeyW answered at 0.57 s; course ready and hum of g1 +16.62 s after Shift+G (same sample); voiced from 0.1 s until K: 0;
  K: 14 lines voiced, the hold ended at 55.88 s (K at 39.77); I at 57.92: "Lesson 1 of 1: Free flight in this scan. Step 2 of 2.
  Attempt 1. Counted 0 of 1." and "Recording is off." voiced (finding (a) gone); Shift+V at 62.02: narratorOn voiced. Tunis: course
  and hum +7.84 s, voiced until K 0, K 14, I the same two lines. #ui text announced while quiet, from the switch on to Shift+V:
  Wroclaw 7 (was 8 + 222), Tunis 5 (was 8 + 244); 0 during K's help in both. 0 page errors.
- [ ] Left of (b), measured, not fixed: the 7 and 5 lines are all at 0.01 to 0.11 s after Backslash ("on", "55 %", DISARMED,
  ANGLE, volts, THR line), while the host's lesson is still null (samples: lesson null at 0.12 s, scan-free at 0.24 s), so
  quietFlight is false then; plus the recorder's own live region (where "sonicrec-status", outside #ui) says "Not recording." at
  0.18 s. A fix needs the in-place start to count as the free flight before the lesson is set (feature.ts, h.inPlace or the
  Backslash path) and the recorder's region in the same rule (apps/fly/src/sonic, recorder status; file not looked up).
- [x] gates.py --only vitest,architecture,i18n,b18 on 5a253254: all PASS (vitest 95 s; logs U:/Temp/gsfpv-gates-20261115-174544);
  a6-reference 1 passed (quiet2/w2p2-a6.log; keymap.ts from W1).
- [ ] Left for pass 3 (in this order): the first 0.11 s of (b) above; (1) the ear pilot to the course's end at 5 m/s narrator off
  (sonic-int-review.ts r11: Z5_NARRATOR=off in prefsDoc, a cue set to steerByHum, count window.__utt); (2) missed gate and wrong
  way narrator off; (5) READER=1 narrator on; (6) a lesson of the list narrator off, and left half way with X; (7) the hint once
  (r11 narrator on); (8) r9, r11 Wroclaw Shift+G and Tunis, r12; (9) ?sonic=scan in three settings; accept-fly B6 B7 B9 to B16;
  pause-over-course-probe; the pictures quiet-settings.png and quiet-captions.png with the caption rectangles at 1920x1080,
  1280x720, 844x390; 'What the owner does'; 'For the lead'. N3 stays the lead's decision.
- [x] (pass 1 record) gates on the W2 tree before the fix: architecture, i18n, b18 PASS; vitest FAIL 1 of 5035:
  tools/bench/test/sonic-optin.test.ts "K in the mode ... Escape N B Z I G R T U L" pins the K list of caps and does not follow N2's
  Shift+V (from W1 cb5e9272, gates were not run in W1). Fix: update that pinned list to the received one (Shift+V in place of the
  old cap), then re-run the gates (logs U:/Temp/gsfpv-gates-20261115-173456).
- [ ] Left of W2 (in this order): sonic-optin fix and gates; findings (a) and (b) above; (1) the ear pilot flies the course to its end
  at 5 m/s with the narrator off and lists the cues of a passed gate and of the finish: sonic-int-review.ts r11 has no narrator
  switch yet (add Z5_NARRATOR=off to prefsDoc, pass a cue set to steerByHum, count window.__utt after the switch on); (2) missed
  gate and wrong way with the narrator off; (5) READER=1 with the narrator on (lane quiet measured no wait before: 0.56 s);
  (6) a lesson of the list with the narrator off (r12 with Z5_NARRATOR=off; and left half way with X); (7) the hint once
  (r11 narrator on: sonic.say.narratorTip once; a second course not in the browser); (8) r9, r11 Wroclaw Shift+G and Tunis, r12;
  (9) ?sonic=scan in three settings; accept-fly B6 B7 B9 to B16; pause-over-course-probe; a6-reference (keymap.ts changed in W1);
  the two pictures quiet-settings.png and quiet-captions.png with the caption rectangles at 1920x1080, 1280x720, 844x390;
  'What the owner does'; For the lead (package pin 293ebae on train5, unchanged in W2; files outside apps/fly/src/sonic changed
  in W1 and W2: tools/bench tests and scripts, packages/prefs keymap.ts, doc.ts, store.ts, the four fly locales, this file).
- Not verified: nothing was heard by a human ear; no real screen reader; es, pl, ru texts not checked by a native speaker.

### Facts K1-a (measured "before", release of 704f2043, Wroclaw 70b50d42, stand-in walls, render off; Backslash in place)
Files U:/Temp/gsfpv-train3/quiet/before-voice.json and before-reader.json (READER=1, the owner's box). Same numbers in both:
- The craft answers the stick at once: KeyW held from the Backslash press, speed over 0.5 m/s at 0.56 s; the runner's phase is
  'intro' from 0.25 s to 10.55 s (reader case 10.64 s), then 'flying'. No place back in place (one position jump at 19.4 s
  from y 0.9 to 3.1 after the craft sat on the floor: a crash life, not the runner).
- Lines said at the switch on (t 0.0): lesson.scan-free.title, lessonKeysFree, inPlaceOn, courseOffer, inPlaceIntro; at 10.4 s
  fly.go and lessonKeysFree again. The host's speech queue is busy from 0.25 s to 32.7 s (reader case 33.0 s).
- Shift+G 20.2 s after the switch on: the course ready (24 gates) at +10.8 s, the first hum of gate 1 in the same sample (+10.8 s):
  the 10.8 s are the generation; the talk (4 progress and ready lines, sonic.say.text at 20.0, 24.1, 27.8, 30.8 s) does not hold
  the hum. Spoken lines in the 180 s flight with a course: 11 in each case.
- Headless Chrome has no system voices: the "voice" case's waits are the engine's estimates too, so both cases show the same
  times; a real voice was not measured.

## Not verified (lane onecourse2)
- OC-1 with a failed generate (course.none or course.failed said in Fly by Sound): not run in a browser; no cheap way to make the course worker fail on a catalogue scan was found.
- The ear pilot's wedges at Wroclaw walls (pilot or page): not measured.
- The picture was looked at once; the gate count in it is read by eye together with the probe's prims 0, not counted by a pixel tool.
- The es, pl, ru words of the new lines were not checked by a native speaker.

## Not verified
- O2: the new line's es, pl, ru words were checked by Whisper only, not by a native speaker. No browser run of O2 yet.
- All V1 numbers are the package's ear pilot and kinematic craft in Node, not the simulator's physics and not a human ear;
  the pilot's gains and the craft's limits are the package's estimates.
- The stream count is the planner's plan, not what the engine renders (the budget acts in the planner; beds counted when not
  null, their level not checked).
- Tunis line-on not re-run with `--line-near-aim`; the Tunis walls are the cached shipped walls of the lead copy, their
  version against the live release not checked.
- No browser run (V1 changed nothing a pilot sees). gates.py ran on f3c3ccae, before the pass-2 tool and switch (tsc of
  tools/bench: 0 errors in the two tools).

## Cost notes
- 2026-11-15 W2 (quiet2): Q7 had to be built before the proof (6 replies, mostly Edit's read-before-edit); the stage's proof list
  (9 items, 2 pictures, 5 probes) does not fit 30 replies with one worker: one stage per 2 or 3 items, and r11 with a narrator switch
  ready before the stage, would have made it fit.
- 2026-11-15 V1: most replies went to finding the pieces for a Node scan flight (spawn, course worker steps, the runner options,
  the submodule standing at an old commit); a short agent-map line on "fly a scan course in Node" (sonic-speed-measure.ts) would
  have saved about 8 replies. The flights themselves are cheap (2 to 21 s each).
- 2026-11-15 V1 pass 2: most replies went to finding where the line meets the gate aim (runner.ts beaconTarget) and the Tunis
  walls on disk; a note in the agent-map naming the scene voxel cache (.cache/scenes/<id>) and the line/aim order would have
  saved about 4 replies. Running the gates and the Tunis flights detached at the start cost no waiting.
- 2026-11-15 O1 (onecourse): most replies went to reading how the sound course is made (course-ask, lesson host, runner) and to a probe of the owner's path; the build and the two probe runs cost no extra replies. an agent-map line "the course for Fly by Sound: CourseHook.sound (course/hook.ts)" would save that reading (not added yet: the lead's file); the 5 old tests of the N course need a rewrite before any proof.
- 2026-11-15 O1 pass 2: most replies went to reading the rig, the old tests and the key-name code before each edit (the Edit tool needs a Read of every file first: about 6 replies on reads only); a fake course over the real CourseRun made the tests cheap. Reading each file's needed slice with Read (not sed) from the start would have saved about 5 replies.
- 2026-11-15 O1 pass 3: most replies went to the package's D7 change, built and tested and then reverted because a new package line fails the voices evidence tests (words.test.ts, lesson-schedule.test.ts); knowing up front that every package line needs `pnpm listen:words` (a note in the package's agent map) would have saved about 6 replies.
- 2026-11-15 K1 pass 2 (quiet): most replies went to finding where a line travels (bridge.say, the engine's say, the caption
  callback, the start screen's check, the rig's fake engine) one file at a time, and the Edit tool's read-before-edit cost 3 extra
  replies; an agent-map line "a spoken line: bridge.say -> engine.say -> onSpeech/caption -> captions.add" would have saved about 6.
- 2026-11-15 O2 pass 2: the simulator judge and its three rig tests passed at the first run (the rig's follow pilot reused as a point pilot); most replies went to finding the hook fields for a browser probe (speech events, scripted pilot) and the b18 failure from one Polish letter in this file; writing this file ASCII-only from the start and a probe skeleton in the agent map would have saved about 4 replies.
- 2026-11-15 O2.6 pass 3: most replies went to finding why the ear pilot got no hum (hook target, then beacon, then the free flight's layers: three layers of the same gap); one rig assert "target.hum is planned over the scene's course" in O1 would have caught it before any browser run and saved about 8 replies.
- 2026-11-15 O2 (wrong way): most replies went to the package's voices evidence (TTS fixtures by measure-tts.ps1, then listen-words failing on the plain python until SHRAMKO_LISTEN_PY=U:/venvs/shramko-listen/Scripts/python.exe); a note of that venv in the package's agent map would have saved 3 replies. Writing the four cases as one test file with a record switch (D7_OUT) gave the measurement and the negative control in one run.
- 2026-11-15 fixes (OC-1 to OC-6) pass 2: most replies went to the lap proof (a random course reset its run in (b), and the speech text sat in e.text, not e.params): a fixed seed by sg= from the start and the event shape in the probe's header would have saved 3 replies; the gate run found a real regression (corridor beacon) that the per-change tests had not covered.
- 2026-11-15 onecourse2 P1-close: most replies went to the four r11 runs (about 26 min, read one by one) and to Edit's read-before-write rule on 8 locale files; running proofs1 and proofs2 as one detached script from the start and reading all evidence with one summary script would have saved about 5 replies, so the lock proofs did not fit.
- 2026-11-15 onecourse2 P1-close pass 2: the whole left list ran as one detached script (build, r11, proofs2, gates) with four blocking waits, about 14 replies; most of the rest went to finding the life log inside the r11 evidence (value.spy) and two b18 fails from a placeholder-rule word in this file (the second from naming it in the fix note); a one-line summary per r11 run printed by the tool itself would have saved 3 replies.
- 2026-11-15 quiet K1 pass 1: most replies went to finding where a flight could wait (bridge, runner, lessons, mode: no explicit hold found by reading) and to the probe's setup (prefs key, stick key); the in-place measure showed no wait, so the owner's page (?sonic=scan) is still to measure. A map line "where a sound flight can hold the pilot: runner startAttempt place, bridge sequential" would have saved about 6 replies; the stage (measure, package plus simulator, tests, gates) does not fit 30 replies and should be split into measure, build and proof.
- 2026-11-15 K2 pass 1 (quiet): most replies went to making K1's red tests green (three pinned item numbers found one run at a
  time, a jump bound that measured the rig craft's speed) before K2 could start; K1 left red cost this stage its build budget.
  Splitting K2 into build (Q3 to Q7) and proof (K2.6) and printing every pinned "Item n of N" failure in one run would save about 5.
- 2026-11-15 K2 pass 2 (quiet): most replies went to finding the files that pin the mode's key list (keymap.test, app-keys,
  sonic-optin, then catalog.test found only by the gate run, two gate runs more); a grep for "'sonic.home'" across all tests
  before the first edit would have found all four and saved about 4 replies. Only K2.1 fitted; K2.2 to K2.6 need a fresh worker each.
- 2026-11-15 fixes pass 3 (continuation): most replies went to measuring the r11 Shift+G failure (a new tool for the walls, then reading laps.ts and run.ts); r11's trail logging course.next with each life would have shown the restart in one read. Running the busy probe, the d7 re-run and r11 in one detached script cost one wait.
- 2026-11-15 lane quiet stage fixes: most replies went to finding every speaker and cue kind (runner, lessons, course, walls, planner) and to the move of the table after sonic-int-lazy failed; a list of the engine's speakers and the planner's one-off cue kinds in docs/agent-map.md, and knowing that the main chunk must not name mode texts, would have saved about 6 replies. The browser proof did not fit and needs a fresh worker started with the release build.
- 2026-11-15 quiet2 W1-finish: most replies went to finding the speakers (K help, I status, the GPU hint's ctx.sonic.engine, #ui)
  and every test that pins the narrator key; one patch script with asserts for locales and pinned tests saved the read-before-edit
  replies. N1 to N6 with a package sound does not fit 30 replies: split into N1-N5 and N6 plus gates.
- 2026-11-15 lane quiet fixes pass 2: most replies went to the browser proof (one probe extension for voice and live-region hooks, four runs, two summaries) and to finding the rig's hooks for Q5; three probes run in parallel without the lock saved two replies. Cheaper: a probe that already recorded speak calls and cues from K1, and a note in agent-map of where a course of Shift+G finishes in the sound mode.
- 2026-11-15 quiet2 W1-finish pass 2: most replies went to finding where the course of Shift+G finishes in the sound mode (runner
  events, then the course hook, then LapTimer: the answer is CourseHook.laps, the runner sees nothing) and to Edit's read-before-edit
  on four files; a map line "course finished in Fly by Sound = CourseHook.laps rises" would have saved about 6 replies. Q7 and the
  gates did not fit; the Q7 plan is written above.
- Lane quiet2 W2 pass 2: most replies went to reading feature.ts, the probe and the test rig in slices before the two fixes, and to
  splitting the probe's JSON by phase with node one-liners; a quiet-summary.mjs line per phase (switch on to K, K's hold, I, after
  Shift+V) would have saved about 4 replies. The whole proof list (1) to (9) does not fit one 30-reply pass after a fix.
