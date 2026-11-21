# Lane tutor-moment (train 4)

The pilot's feedback, point 2, inside the sound package: a sound is taught at the action it belongs to (a "moment":
the flight freezes, the sound is named and played alone, the pilot is told what to do, the flight goes on), and the
first set of moments in the fast lessons. Plan: C:/dev/.gsfpv-lanes/designs/t8-plan.md (Part A2-A6, B 2, C 1, 4-7);
brief: C:/dev/.gsfpv-lanes/designs/t8-tutor-brief.md.

Base (host): 03624451b8deb79d179cc9a5d07adf22f1383773. Base (package): 719aaf5454ddb15677ad4dc090ac6faeab853e77.
Package branch: tutor-moment in packages/sonic-fpv of this copy (on no remote).

## Status

- [x] S1 contract: types in src/contract.ts, src/lesson/moments.ts stub, CuePlanner.setAudible, the loader accepts
  `moments`; package typecheck and tests pass (79 files, 1440 tests); package commit 12acc110d491d99fd5e65c305c0ee443f171ddcb;
  pin moved in the host; apps/fly and tools/bench typecheck pass; marker U:/Temp/gsfpv-train4/tutor-moment-contract.txt.
  NEG OK on 719aaf5 (test/moments-contract.test.ts).
- [x] S2 the machine: freeze, what, the forms alone, do, resume, task, done; hint once; keys again / on / know; guide
  levels; test/moments.test.ts (8 tests) + NEG OK on the S1 stub 12acc11. Package commit
  fbe50d00376376af0939bc34f9f9de0f1a4a3800; package typecheck and tests pass (80 files, 1448 tests); apps/fly and
  tools/bench typecheck pass.
  Left for S3/S4 from S2: guide 'new' silences only the moment lines so far; the lesson's own lines (intro, fly.go,
  attempts, pass) under 'new' are S4's ("only the sound names are said"): one gate in Runner.sayLines plus the direct
  'say' pushes; the locale keys `moment.done`, `moment.<id>.do|hint`, `cue.<id>.what` come in S3.
- [x] S3 the first set: the moments of the table in the fast lessons; their intro cue lines go; headphones.good once;
  cue.<id>.what and cue.<id>.do for all 28 sounds in four languages; test/named-sounds.test.ts; lesson versions bumped;
  host count tests updated.
  DONE so far (package branch tutor-moment, commits 0a205e6 and 4ebeba934d05c9c2e0e616fb9975abfbf8c6d2e5; the host
  pin is deliberately still fbe50d0 until the package tests are green again, so `git status` in the host shows
  packages/sonic-fpv as new commits: that is expected):
  catalog MOMENT_IDS + momentKeys() + cue.<id>.what|do in requiredKeys; the texts in four languages (source:
  U:/Temp/gsfpv-train4/tutor-moment/texts.json, merged by merge-texts.cjs there); `lesson.ears-headphones.pass` is now
  "Now let's fly." (headphones.good is the only "they work" line); validate: intro may be empty when `moments` exist;
  lessons (edit-lessons.cjs there, then `node tools/run-tool.mjs canon-lessons ...`): walls-hall v5 intro [] moments
  height (height.tone, start, hold-height 2-2.6 m) and wall-ahead (safety.wall, near front 3 m, approach-stop 1.5 m);
  corridor v5 intro [goal.1] moments target (target.hum, start, fly-distance 5 m) and way-through (safety.free, free,
  no task); tunnel-gaps v5 intro [goal.1]; rings-first v4 intro [goal.1] moments gate-height (height.target, start) and
  gate-passed (target.note, passed); rings-course v4 intro [goal.1], layer `speed` added, moments speed (speed.tick,
  above 2 m/s) and brake (speed.brake, above 3 m/s); test/helpers/pilot.ts defaults `known: CUE_IDS`.
  S3 part 2 (package commits 8d6bed3, a4bd37f, f6cb37f, 098923a38789538c1fd9512c38153594b639c5e5; pin moved to 098923a):
  the content tests hold the moments (quick-path, lessons, named-sounds, world-scale, world-tunnels, respawn, replay,
  report); named-sounds gained "one name and one definition" (what|do of the 28 sounds in four languages, `what` names
  its sound only through {sound}, moment ids = MOMENT_IDS, one sound a moment, en moment lines never type a name of
  two words, a control); the 46 new plain lines measured with the four Windows voices (tts fixtures, lesson-schedule
  counts: en 476/309, es pl ru 562, longer 283/403/562); the words check VL-4 PASS (648 lines a language, 0 over the
  bound; two pl lines and one en hint reworded where Whisper misheard them). An absent RunnerOptions.known now means a
  host that does not teach (no moment, nothing gated, as before), so the simulator as it is keeps working on the new
  pin; the runner writes `known` and `guide` into its lesson open event and the replay reads them. Package: typecheck
  0, full run 1447 passed, 1 failed (words, then fixed: 111 of 111 in the five text files after the rerun).
  S3 part 3 (host): sonic-lesson-keys B5 "resumed while a line is still being said" keeps rings-first and now asserts
  that every line begun before the end of speech was said through by it, and the voice speaks again only with a line
  begun at that end (rings-first's "Go." follows its one task line at once). The four host count tests: 89 of 89
  (sonic-start, sonic-lesson-keys, sonic-lessons, sonic-int-replay; B7, a file scan, timed out at 5 s once under the
  load of the four files together and passed alone: 3 of 3).
- [x] S4 the scripted pilot: test/first-set.test.ts in en, es, pl, ru (moving within 60 s, under 60 words before it, no
  prompt over two sentences, one new sound a moment, the set within 420 s, guide 'new' says only names); NEG on 719aaf5;
  host gates once; done marker; "What the owner should try".
  DONE so far (package commits a1524a0, a017e447ef9c8593c74eb316adc3fd9960090376; pin moved to a017e44):
  test/first-set.test.ts, 20 of 20 (the numbers: evidence/2026-11-20/tutor-moment/first-set.json). Moving at en 38.8 s,
  es 40.9, pl 40.5, ru 46.0 (base: 114 s en); words before it 57 / 58 / 52 / 50; at most 2 sentences a line; 8 moments,
  each adds its one cue; the set (headphones to rings-course passed) 298 / 302 / 308 / 327 s; guide 'new': only
  `cue.<id>.name` in the flying lessons, 223-230 s. NEG OK on 719aaf5 (19 of 20 fail there). What it took (runner, for a
  host that teaches, i.e. RunnerOptions.known given; absent known: as before): the second headphone trial asks with no
  words (the keys come with the waiting sound after 7 s), plays the first side twice and the second once; no "Taken: n."
  (the answer's sound says it); no "Lesson passed. Next..." (the next lesson says its title); no "Go." when a start
  moment freezes the first frame; guide 'new' gates every line but the names (Runner.sayLines and takeActions). The room
  (walls-hall, still v5, unreleased) says its goal line, the pilot flies at once, wall-ahead first, the height tone at
  the start of the next attempt. test/helpers/pilot.ts: the test pilot is a host that does not teach (absent known).
  Package: typecheck 0, full run 1471 passed, 4 skipped. Host: the four count tests 89 of 89.
  Host gates once (logs U:/Temp/gsfpv-gates-20261121-142649): typecheck, architecture, i18n, b18, leaks PASS; vitest
  FAIL on one test only, tools/bench/test/sonicrec-replay.test.ts:501 (from S3: the old rings-first and room recordings
  derive no cue now that the intro cue plays are gone); fixed to "the player's cues = what the replay core derives", as
  the same file does at line 288; that file 28 of 28. The gates were not run a second time (one test file changed).
  Done marker U:/Temp/gsfpv-train4/tutor-moment-done.txt.

### Where the code differs from the plan (one line each)

- The contract's `task: GoalDef | null`: the package's goal type is `Goal` (src/contract.ts), used as is.
- A new SessionEvent kind needs src/session/codec.ts (EVENT_KINDS, EVENT_KEYS, the reader) and tools/report.ts (its
  exhaustive switch): both changed, outside the owned list, the smallest change that compiles.
- The host reaches the planner only through SonicEngine: `setAudible?(cues)` added to SonicEngine (optional, so older
  engines and the host's fakes compile) and to src/audio/engine.ts (one line to the planner).
- The forms' far and near: `repeat-cue` gained `distanceM` (the form's distance); the planner (not this lane's file
  beyond setAudible) does not read it yet: a safety cue's play sweeps its own approach. MomentForm.dir is honoured.
- Moment triggers are checked in order (the next moment only after the one before is done); 'near' casts a ray of
  `withinM` in the heading frame; 'free' asks findFreeWay (the planner's own finder) with the default body radius.
- The host holds the craft while a moment is frozen and keeps stepping frames (t moves on); the runner flies nothing
  then and leaves the frozen time out of the attempt's clock. A moment's key is recorded as a `key` event with action
  `moment.again|on|know` (REPLAY_KEY_ACTIONS); ReplayInput gained `known` and `guide` (src/replay, for the marker).
- test/helpers/record.ts (the test host) handles 'audible' and 'moment' and the moment keys.
- S3: the hum moment `target` is in the corridor, not rings-first: the hum already leads the corridor's way (the beacon),
  so it must be taught where it first sounds. The eighth moment is `gate-height` (height.target, rings-first), not floor
  or ceiling: the target note sounds once a second at every gate and would otherwise come unnamed.
- S3: `brake` waits for speed above 3 m/s only (a MomentWhen has one condition, no "and gate within 6 m"); rings-course
  gains the `speed` layer, without which speed.tick and speed.brake never sound on the fast path.
- S3: floor, ceiling, target.stage and safety.reset are no longer played before a flight; they stay audible and in the
  glossary (key G): the first set has room for eight moments only.
- S3: `known` absent = every sound known (no moment runs): the plan left it open; the other way the simulator not yet
  wired by tutor-air would run moments it cannot hold and record cues its replay could not derive (10 host tests).
- S3: the recorder keeps the sample a moment froze on (test/helpers/record.ts): the held frames after it would hide a
  speed trigger from the replay. A host's recorder must do the same (For the lead).
- S4: the room teaches the wall first and the height tone second (table rows 1 and 2 swapped): a 'start' moment
  before the first movement kept a ru pilot still until 84 s; now the pilot flies after the room's goal line.
- test/named-sounds.test.ts exists already on the base (the rule "a sound with no words is named in the first lesson of
  its path"); S3 extends it rather than creating it.

## What the owner does

Nothing yet: the package carries the moments, and the simulator turns them on only when lane tutor-air's page passes
`known` (until then a pilot hears the lessons as before, apart from the room saying its goal line before the flight).

### What the owner should try (after the release with lane tutor-air's page)

1. Press Start flying. The headphone check: knocks on the left, press key 1; knocks on the right, press key 2 (the
   second time nothing is asked aloud; after 7 s the keys are said again). "Good. Your headphones work well."
2. "A small room. Fly to each wall and stop close to it without touching it." Push forward: you move within a minute.
3. Near the front wall the flight stops: "Wall: a wooden knock from a wall near you, faster as you get closer.", then
   the knock alone, far and then near, then "Fly on slowly until the knocks come fast, then stop."
4. Fly until it knocks fast and stop: a short success sound, "That's it." The next sound (the height tone) comes only
   at the start of the next run, when it is needed; every later sound comes the same way, one at a time.

## Claims

1. A lesson may carry `moments`; the loader checks them (forms 2-3 s, far first, one sound once, the line keys), a
   moment event is written and read back, and `CuePlanner.setAudible` plans only the listed cues (null: as before).
   Proof: `cd packages/sonic-fpv && npx vitest run test/moments-contract.test.ts` - 6 passed; NEG OK on 719aaf5.
2. A moment runs in order (freeze with only its cue audible, what, the forms alone with nothing said over them, do,
   the flight goes on, the task, praise); the hint once; again / on / know; guide 'new' says the name only; the moment
   events are recorded and the recording replays with no difference.
   Proof: `cd packages/sonic-fpv && npx vitest run test/moments.test.ts` - 8 passed; NEG OK on 12acc11 (the S1 stub).
3. The first set, flown by a scripted pilot with the measured voices in en, es, pl, ru: moving within 60 s of the
   press (38.8-46.0 s; 114 s on the base), under 60 words before it (50-58), no line over two sentences, 8 moments each
   bringing exactly one new sound never audible before it, the set within 420 s (298-327 s), guide 'new' says only the
   sounds' names; the headphone question's keys once, no "Taken: n.", no "next lesson" line, "they work" once.
   Proof: `cd packages/sonic-fpv && npx vitest run test/first-set.test.ts` - 20 passed; NEG OK on 719aaf5 (19 of 20
   fail there). Numbers: evidence/2026-11-20/tutor-moment/first-set.json.
4. Every one of the 28 sounds has one name and a definition (`cue.<id>.what`, `cue.<id>.do`) in four languages.
   Proof: `cd packages/sonic-fpv && npx vitest run test/named-sounds.test.ts test/locales.test.ts` - passed in the full
   package run (1471 passed, 4 skipped).

## Not verified

- No person, phone or real controller took part; no browser ran (the page is lane tutor-air's). The times are of a
  scripted pilot with the measured Windows voices; lines with a parameter (the `what` lines name their sound) use the
  package's estimate, which is faster than Irina (ru): a real ru first movement may come a few seconds later than 46 s.
- `pnpm listen` (the virtual listener, GPU) was not re-run for S4: no sound, theme or engine changed, only the order and
  the words of lessons; the words check was run in S3 and no line was reworded in S4.

## For the lead

- Files changed outside the owned list (package): src/session/codec.ts, tools/report.ts, src/audio/engine.ts (see above);
  S2: src/replay/compare.ts ('moment' events compared), test/helpers/record.ts (the test host).
- For lane tutor-air (the page): on 'moment' non-null hold the craft and keep stepping frames; on 'audible' call
  engine.setAudible; record the moment keys as `key` events with REPLAY_KEY_ACTIONS.momentAgain|momentOn|momentKnow
  before calling runner.momentKey; persist the cues of 'known' and 'learned' moment events as RunnerOptions.known.
- For lane tutor-air: pass RunnerOptions.known ([] for a new pilot) to turn the moments on; absent = no moments. Record
  the flight frame on which a 'moment' action (non-null, after null) arrives, beside the 30 Hz frames, as touches are.
- S3 changed outside the owned list: package src/session/codec.ts (the open event's known, guide), src/replay/replay.ts,
  tools/listen-words.ts (sample for {sound}), evidence/listen/VL-4-words.json (rerun), test/fixtures/tts-*.json
  (measured), and the tests named in Status; host tools/bench/test/sonic-lesson-keys.test.ts (Z and B5 open lessons
  that still name sounds) and sonic-int-replay.test.ts (control frame indices within the shorter flight).
- S4 changed outside the owned list, host: tools/bench/test/sonicrec-replay.test.ts (the v012 recordings' cue count).
- S4 changed outside the owned list: package src/lesson/schedule.ts (a question with no words is read out at once),
  test/helpers/pilot.ts (the test pilot does not teach), test/helpers/record.ts (a measured voice), test/world-scale.test.ts
  (the room's intro); src/lesson/moments.ts (`startsFrozen`) is owned.
- For lane tutor-air: with RunnerOptions.known given the runner itself leaves out "Taken: n.", the second headphone
  question's words and the "Lesson passed. Next..." line: the page must open the next lesson on its own after a pass
  (it says its title), and must not add those lines back.
- Deploy order: the sound package first (its branch tutor-moment merged into its main), then the page; no API, rooms or
  nginx change. Live checks after the deploy: the first-set path by hand (What the owner should try).
- The package head of branch tutor-moment, a017e447ef9c8593c74eb316adc3fd9960090376, is on no remote; it must reach the
  package's main before the page ships.

## Cost notes

- S1: most replies went to finding the planner's output path and the codec's exhaustive lists; a map of "where a new
  SessionEvent kind must be added" in the package's AGENTS.md would save four reads.
- S2: most replies went to the test flights (the hall lesson's own stop goal misses when the craft halts mid-room, and
  approach-stop needs 2 m of path in the attempt); a note of each goal's hidden thresholds beside the test host would
  save three runs. Editing through a Python one-liner wrote CRLF on Windows: use the Edit tool.
- S3 (part 1): the moments in shared lessons broke 65 older tests that fly those lessons; a test helper default (`known`)
  took 25 of them. Cheaper: decide in the plan that flight tests run with every sound known, before adding moments.
- S3 (part 3): two runs of the four host files (one B5 fix, one load timeout in B7); cheaper: give file-scan tests a longer timeout.
- S3 (part 2): the run overran (about 90 calls): the words check needs the listen venv (U:/venvs/shramko-listen) and a
  copy of the Whisper model in the lane's cache, and host tests that fly a changed lesson's task timing. Cheaper: name
  the listen environment and the "absent = as before" default for new runner options in the common prompt.
- Review: most replies went to a test pilot that presses a moment key on the very frame a moment freezes
  (RecordingHost.flyTo runs a whole freeze inside one call); a `flyTo(to, speed, onFrame)` hook in the test host would save four runs.
- S4: most replies went to fitting the 60 s bound (three runs: the headphone check's repeated question and three plays, then the room's start moment); a schedule print of the first minute per language at the stage start would have shown both at once. One gate test from S3 (a v012 replay) surfaced only in the full host run: run tools/bench sonic*-replay tests with the count tests when lesson intros change.

## Review

Verdict: SHIP (independent check, 2026-11-21; review file U:/Temp/gsfpv-train4/reviews/tutor-moment.md).

- PROVEN, repaired: leaving a lesson inside a moment (lesson menu, next or previous lesson) left the last 'moment'
  action non-null and the engine's audible list at the moment's one cue; CuePlanner.reset keeps that list and a lesson
  without moments (tunnel-gaps) sends none, so a host that follows the actions would hold the craft and sound one cue
  in the next lesson. MomentMachine.leave (called by Runner.leave before 'go') sends 'moment' null and 'audible' null.
  test/moments-review.test.ts, NEG OK on a017e44. Package head 9ac7876dee42b8a874e51e6d46eb7cf8d70c3a48.
- DOUBT: a 'start' moment fires on the first flying frame after the moment before it ends, not on an attempt's first
  frame: after 'I know this' at the wall the flight freezes again at once for the height tone (one frame later).
- DOUBT: ru moment.way-through.do says the free way's name (declined) by hand; the name check covers en only.
- Rechecked: the lane's two negative controls with only runner.ts and the five lessons at 719aaf5 (ru first move
  121.6 s there; one new sound a moment fails), the five lane test files 95 of 95, the package 1474 passed, 4 skipped.
- Host gates once on the repaired tree (logs U:/Temp/gsfpv-gates-20261121-144317): typecheck PASS, b18 PASS, vitest 5743
  passed, 2 failed on timing under load: sonic-start-screen (a 1 s waitFor of a lazy import; passed alone with the four
  count tests, 122 of 122) and app-dji-rc2 (HidSource timing; not this lane's, not rerun).
