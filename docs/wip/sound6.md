# Lane sound6: Fly by Sound, the quick first lesson

Work copy C:/dev/gsfpv-center-throttle, branch sound6 (holds the 18 commits of lane sonic5, docs/wip/sonic5.md), ports
6160-6179, temp U:/Temp/gsfpv-train4/sound6. Package work copy C:/dev/ShramkoSonicFPV, branch quick1 (from train6 bd79c96;
the design says train6: the lane prompt wins). Design C:/dev/.gsfpv-lanes/designs/sound6.md. Owner's words: brief lines
531-532 (no "behind or in front" question; the quick lesson is the default; the long course is for those who need it).

## Status
- [x] S0 close sonic5 by the lead's decision of 2026-11-19 (docs/wip/sonic5.md W1.6, W1-build closed).
- [x] S1 the question about behind and in front gone from every lesson: package quick1 92bb012 (simulator commit of this
  line). The ears game asks left or right only (runner.ts SIDES, options SIDES.length); ears-walls brings the wall from
  left and right (sounds.ts APPROACHES); a shape in ears-shapes is named without a side (the design missed it: the old
  fallback said dir.front); turn-listen's intro hum from the right (its start already puts ring-1 at +104 deg on attempt
  1 and -76 deg on attempt 2; the design's text "on one side" fits it, start yaw unchanged); the cube's lines say near
  and far; headphones.q-front-back deleted. Versions ears-game 4, ears-walls 3, ears-shapes 3, turn-listen 3,
  shapes-cube 4. Ten lines measured with David, Helena, Paulina, Irina (test/fixtures/measure-tts.ps1, only the changed
  keys; the prompt's tools/measure-tts.ps1 does not exist). Test test/quick-path.test.ts 36 passed; NEG OK against
  bd79c96 (6 failed). 30 package test files that name these lessons, lines or fixtures: all pass except
  test/words.test.ts (its evidence evidence/listen/VL-4-words.json must be rewritten by `pnpm listen:words`: left for
  S5, after the lines of S2). Three tsc 0 errors. Pin not moved yet (S2 moves it with the host change).
- [ ] S2 the quick path as the default, the full course second (package: paths.json, ears-headphones, ears-walls,
  walls-hall, prefs default; host: Quick start / Full course buttons; tests c and host a-c); the glossary entry of the
  cue 'speed.brake' with its measured lines.
- [ ] S3 the seconds to the first wall sound, counted from lessonSchedule (test b).
- [ ] S4 Firefox: sound (engine placeListener) or a clear line that leads to Chrome or Edge (host engineFailed, test d).
- [ ] S5 pin moved, package suite + listen:words, simulator gates, acceptance probe sonic-quick-walk.

Base: origin/main e3201fec differs from this branch only in STATE.md: not merged.

## What the owner does
(filled in by the last stage)

## Claims
(filled in per stage)

## Not verified
No person, phone or real controller took part in this lane.

## For the lead
- Files changed outside the owned files: docs/wip/sonic5.md (the decision of W1.6 written in).

## Cost notes
- S0: reading the design, the sonic5 status and the brief took 4 replies; nothing would make it cheaper.
- S1: the count-based tests (lesson-schedule's measured counts, lessons' versions, progress steps) took 5 replies; the
  design could list them. Finding ring-1's position took 5 replies (a print script): a world dump helper would help.
