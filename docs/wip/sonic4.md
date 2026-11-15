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
- [ ] O1.3 rewrite the 5 tests that encode the old design (they fail now, by design change, not by a fault): sonic-scan-course.test.ts (2: "N asks the page for a course", "review SN-2/3/6/9"), sonic-walls-free.test.ts (2), sonic-in-place.test.ts (1: "a course made with N over an in-place flight"); the rig tools/bench/test/sonic-lesson-rig.ts lines 310-330 builds course.ask: give it { key, inUse, generate } over a fake shared course. New tests with negative controls: two courses exist on the old code; progress kept over switch on/off; Shift+G in the sound mode replaces the course; N is the same action; no line names N.
- [ ] O1.4 remove the dead parts: course-ask.ts users (askCourse, randomSeed, courseSpeech, soundCourseSeed imports in feature.ts; CourseAnswer, scanCourseLesson in lessons.ts; this.ready path), after O1.3 decides what the tests still need.
- [ ] O1.5 texts: every line that names N for a course names Shift+G (simulator locales sonic/*, sonickeys/*, the package's texts and lessons in en, es, pl, ru, the keys list, the /sound/ page). The intro when a course is in the scene still says "{course} makes a course of gates here" (now with Shift+G); D1 wants no key line then: a variant line without that clause (4 languages) is left.
- [ ] O1.6 D7 (message 53) not started.
- [ ] O1.7 proof on a new release build: onecourse-probe.mjs (steps 1 to 5 of the stage), the ear pilot (6) at 5 m/s on Wroclaw, sonic-int-review r9, r11 (Wroclaw, Tunis; r11 presses N: adapt to Shift+G, one run keeps N), r12, accept-fly B6 B7 B9 to B16, pause-over-course-probe, a6-reference, gates.py --only vitest,architecture,i18n,b18, picture onecourse-after.png.

### Facts O1-a (measured "before", release 98a065b3, Wroclaw 70b50d42, stand-in walls, render=off; U:/Temp/gsfpv-train3/onecourse/before-off.json, before-on.json)
- Shift+G in the ordinary flight: 24 gates (seed 406159527), drawn 93; the scripted pilot passed gates 1 and 2 (next 1, then 2).
- Backslash: lines sonic.say.inPlaceIntro (names N for a course) and sonic.say.lessonKeys; the hum's target null (the course feature's gate 3 is not led to); the course line goes on at gate 3.
- Shift+G in the sound mode: nothing (the course feature's key ignored the press while ctx.sonic; 240 s watched, same seed, same gate 3).
- N in the sound mode: sonic.say.courseMaking, the progress text, courseReady, the lesson goal; the sound mode's own course, target g1, 51 entities on the sound stage (render=on run) beside the course feature's 112: two gate sets. The course feature's course was reset to gate 1 by the lesson open (its line shows 0:00.00, Gate 1 of 24).
- Backslash off: the course feature's course stays (on, 24 gates), at gate 1 after the reset above.
- No course in the scene, Backslash: inPlaceIntro and lessonKeys; nothing generated.

### What the owner does (after O1.7 passes; not proven yet)
- Shift+G: a course in the scene, in the ordinary flight and in Fly by Sound alike.
- Backslash: Fly by Sound on; the hum leads to the next gate of that course, the gate count goes on.
- Shift+G again (or N in Fly by Sound): a new course replaces the old; the hum leads to gate 1.
- Backslash: Fly by Sound off; the course and its gate count stay.

## Not verified
- All V1 numbers are the package's ear pilot and kinematic craft in Node, not the simulator's physics and not a human ear;
  the pilot's gains and the craft's limits are the package's estimates.
- The stream count is the planner's plan, not what the engine renders (the budget acts in the planner; beds counted when not
  null, their level not checked).
- Tunis line-on not re-run with `--line-near-aim`; the Tunis walls are the cached shipped walls of the lead copy, their
  version against the live release not checked.
- No browser run (V1 changed nothing a pilot sees). gates.py ran on f3c3ccae, before the pass-2 tool and switch (tsc of
  tools/bench: 0 errors in the two tools).

## Cost notes
- 2026-11-15 V1: most replies went to finding the pieces for a Node scan flight (spawn, course worker steps, the runner options,
  the submodule standing at an old commit); a short agent-map line on "fly a scan course in Node" (sonic-speed-measure.ts) would
  have saved about 8 replies. The flights themselves are cheap (2 to 21 s each).
- 2026-11-15 V1 pass 2: most replies went to finding where the line meets the gate aim (runner.ts beaconTarget) and the Tunis
  walls on disk; a note in the agent-map naming the scene voxel cache (.cache/scenes/<id>) and the line/aim order would have
  saved about 4 replies. Running the gates and the Tunis flights detached at the start cost no waiting.
- 2026-11-15 O1 (onecourse): most replies went to reading how the sound course is made (course-ask, lesson host, runner) and to a probe of the owner's path; the build and the two probe runs cost no extra replies. An agent-map line "the course for Fly by Sound: CourseHook.sound (course/hook.ts)" now saves that reading for the next worker; the 5 old tests of the N course need a rewrite before any proof.
