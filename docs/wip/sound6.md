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
- [ ] S2 the quick path as the default, the full course second; the glossary entry of the cue 'speed.brake'.
  - [x] S2 package side: package quick1 64376d1 + 58b1d7f (simulator commit of this line). fast = ears-headphones,
    ears-walls, walls-hall, corridor, tunnel-gaps, rings-first, rings-course, free-garden (fastPath flags: ears-walls on,
    hover-height off); defaultPrefs path 'fast'. ears-headphones v4: title, one intro line (new text), "Sound 1 of 3",
    then the wall knocks (runner HEADPHONE_CUE = safety.wall); headphones.wired + os-spatial only from attempt 2 on,
    before its first trial (headphones.intro key deleted). ears-walls v4: intro.1 only. walls-hall v3: intro.1 (new
    text) plays height.tone and height.target (the design named only the tone; test/named-sounds.test.ts showed
    height.target first sounds in rings-first and only hover-height named it), then goal.1. Brake cue: CUE_IDS
    'speed.brake' after 'speed.tick', cue.speed.brake.name/.glossary, ears-glossary v4 plays it (planner: the speed
    preview carries brake: true for 'speed.brake'). Deleted keys: ears-headphones intro.2/goal.1, ears-walls
    intro.2/goal.1, walls-hall intro.2/intro.3, headphones.intro (catalog LESSONS specs: ears lessons goals 0; the
    locales test allows no goal line in module 0). Five lines measured with David, Helena, Paulina, Irina
    (measure_changed.py in the temp folder over test/fixtures/measure-tts.ps1). Tests moved with the data (counts,
    versions, the v0.12 walls-hall fixture's world test keeps only the lines this build has). quick-path.test.ts (c)
    3 new tests; NEG OK against 92bb012 (3/3 fail on the old lesson data, locales, catalog and prefs). The 51 test files
    that name these lessons, lines, paths, prefs or fixtures: 944 passed, 1 failed: test/words.test.ts (evidence
    VL-4-words.json is rewritten by `pnpm listen:words` in S5, as planned). Package tsc (three configs) 0 errors.
  - [ ] S2 host side (left, exact): move the pin packages/sonic-fpv to 58b1d7f; apps/fly/src/sonic/start-screen.ts:
    replace "Start the course from the beginning" (testid sonic-start-beginning) and the path radios (sonic-path-*) by
    two buttons sonic-start-quick (primary when no Continue; prefs.path 'fast', opens paths.fast[0]) and
    sonic-start-full ('full', paths.full[0]), sub-lines menu.path.fast-what / full-what; start-model.ts beginningId ->
    firstOf(path); host keys sonic.start.quick, sonic.start.full in packages/i18n/locales/fly/sonic/{en,es,pl,ru}.json,
    remove sonic.start.course / sonic.path.legend if unused (Grep); host tests a-c (copy the buildModel( /
    sonic-start-beginning tests); update probes that click sonic-start-beginning or sonic-path-*
    (tools/bench/src/sonic-start-keyboard.ts and the walk probes); pnpm --filter fly typecheck.
- [ ] S3 the seconds to the first wall sound, counted from lessonSchedule (test b).
- [ ] S4 Firefox: sound (engine placeListener) or a clear line that leads to Chrome or Edge (host engineFailed, test d).
- [ ] S5 pin moved, package suite + listen:words, simulator gates, acceptance probe sonic-quick-walk.

Base: origin/main e3201fec differs from this branch only in STATE.md: not merged.

## What the owner does
(filled in by the last stage)

## Claims
1. The package's quick path is headphones, the walls, the small room, then the flying lessons, and it is the default of
   new prefs; the headphone check plays a wall knock after one intro line. Proof (in C:/dev/ShramkoSonicFPV):
   `pnpm vitest run test/quick-path.test.ts`: 39 passed at 58b1d7f; NEG OK against 92bb012.

## Not verified
No person, phone or real controller took part in this lane.

## For the lead
- Files changed outside the owned files: docs/wip/sonic5.md (the decision of W1.6 written in).

## Cost notes
- S0: reading the design, the sonic5 status and the brief took 4 replies; nothing would make it cheaper.
- S1: the count-based tests (lesson-schedule's measured counts, lessons' versions, progress steps) took 5 replies; the
  design could list them. Finding ring-1's position took 5 replies (a print script): a world dump helper would help.
- S2 package: 17 tests that pin counts (line totals, glossary steps and minutes, versions, the old fast path) took 6
  replies; one run of every test file that greps the changed names, then one edit script, is the cheapest order.
