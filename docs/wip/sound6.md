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
- [x] S2 the quick path as the default, the full course second; the glossary entry of the cue 'speed.brake'.
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
  - [x] S2 host side (simulator commit of this line): pin packages/sonic-fpv at 58b1d7f (local). start-screen.ts: the
    old "Start the course from the beginning" button and the path radios are gone; two buttons sonic-start-quick
    "Quick start" (primary when nothing else is; startPath('fast'): saves prefs.path, opens firstOf('fast')) and
    sonic-start-full "Full course" (startPath('full')), sub-lines menu.path.fast-what / full-what (+ courseKeeps when
    Continue exists); after Reset the focus goes to Quick start. start-model.ts: beginningId -> firstOf(path). Host
    keys sonic.start.quick, sonic.start.full added; sonic.start.course, sonic.start.courseWhat, sonic.path.legend
    removed (no other use). sound-panel.ts: 'speed.brake' has the kind 'tick' (sonic-panels.test.ts wants a kind for
    every glossary cue; the design did not list it). Tests: sonic-start-screen.test.ts (a, b, c of the design),
    sonic-start.test.ts (firstOf; fast path's second lesson ears-walls), sonicrec-recorder.test.ts (a new pilot's
    path is fast). NEG OK against HEAD 156dd1fd (start-screen.ts, start-model.ts, en.json). All 60 host test files
    tools/bench/test/sonic*: 867 tests, 0 failed. Probes moved to the new test ids (not run: S5 runs the walk):
    sonic-start-keyboard.ts, sonic-review-keys.ts, sonic-v13-page.ts, sonic-int-review.ts, sonic-optin-page.ts.
    pnpm --filter fly typecheck 0 errors; tools/bench tsc 0 errors.
- [x] S3 the seconds to the first wall sound, counted from lessonSchedule (test b): package quick1 8daf95d, pin
  packages/sonic-fpv at 8daf95d (local; simulator commit of this line). test/quick-path.test.ts (b) plays each path's
  lessons one after another through lessonSchedule with the four measured voices, every question answered right after
  it is read out. First wall knock at 58b1d7f: en 11.5 s, es 12.7 s, pl 11.9 s, ru 13.3 s: es and ru
  broke the design's 12 s, so the headphone check's intro.1 became "Headphones on, L on your left ear." (4 languages,
  measured 3.1 to 3.8 s, was 7.9 to 9.0 s). Now en 6.9, es 7.9, pl 7.1, ru 8.0 s on both paths. The quick path's
  small room flies 205.0 s after the press with David (headphone check 82.2 s with its 3 sounds, the walls 89.2 s,
  the room's intro 33.6 s; the design guessed 135 s): the test guards 210 s against new talk. NEG OK against 58b1d7f
  (locales + 4 fixtures swapped: es and ru fail). 17 package test files naming the lesson, locales or catalog: 277
  passed, 1 failed: test/words.test.ts (S5's `pnpm listen:words`, as planned). Package tsc (three configs) 0 errors.
  Host: only the key, not the text, is named (sonic-int-review.ts R7), nothing else to move.
- [ ] S4 Firefox: sound (engine placeListener) or a clear line that leads to Chrome or Edge (host engineFailed, test d).
- [ ] S5 pin moved, package suite + listen:words, simulator gates, acceptance probe sonic-quick-walk.

Base: origin/main e3201fec differs from this branch only in STATE.md: not merged.

## What the owner does
(filled in by the last stage)

## Claims
1. The package's quick path is headphones, the walls, the small room, then the flying lessons, and it is the default of
   new prefs; the headphone check plays a wall knock after one intro line. Proof (in C:/dev/ShramkoSonicFPV):
   `pnpm vitest run test/quick-path.test.ts`: 39 passed at 58b1d7f; NEG OK against 92bb012.
2. The start screen shows Quick start (first, primary for a new pilot) and Full course, no path radios; each press
   saves its path and opens its first lesson; a returning pilot sees Continue first. Proof: `npx vitest run
   tools/bench/test/sonic-start-screen.test.ts tools/bench/test/sonic-start.test.ts`: 38 passed; NEG OK against 156dd1fd.
3. After the press of either path the first wall knock comes within 12 s in every language (measured voices: en 6.9,
   es 7.9, pl 7.1, ru 8.0 s), and the quick path's small room flies within 210 s (205.0 s with David). Proof (in
   C:/dev/ShramkoSonicFPV): `pnpm vitest run test/quick-path.test.ts`: 44 passed at 8daf95d; NEG OK against 58b1d7f.

## Not verified
No person, phone or real controller took part in this lane.

## For the lead
- Files changed outside the owned files: docs/wip/sonic5.md (the decision of W1.6 written in);
  apps/fly/src/sonic/sound-panel.ts (one line: the kind of 'speed.brake'); tools/bench/test/sonicrec-recorder.test.ts;
  the probes tools/bench/src/sonic-{start-keyboard,review-keys,v13-page,int-review,optin-page}.ts (new test ids).
- A question for the lead: the host's headphone check on the start screen still has a button "Play a sound behind"
  (sonic-hp-behind). It asks nothing, so S1 left it; if the owner's "no behind or in front" covers it too, it is one
  button and its line.

## Cost notes
- S0: reading the design, the sonic5 status and the brief took 4 replies; nothing would make it cheaper.
- S1: the count-based tests (lesson-schedule's measured counts, lessons' versions, progress steps) took 5 replies; the
  design could list them. Finding ring-1's position took 5 replies (a print script): a world dump helper would help.
- S2 package: 17 tests that pin counts (line totals, glossary steps and minutes, versions, the old fast path) took 6
  replies; one run of every test file that greps the changed names, then one edit script, is the cheapest order.
- S3: 14 replies; the package's vitest hides console.log, so a print helper writing a temp file cost 3 replies; the
  slow quick-path test (S1's every-lesson loop, 100 s) is the bulk of each run: `-t` on the new tests saves it.
- S2 host: 20 replies; reading the old test and probe slices took the most; a design listing every probe line that
  names a test id would save 4. One edit script per file group, then one run of tools/bench/test/sonic*, worked well.
