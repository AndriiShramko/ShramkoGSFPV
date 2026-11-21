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
- [ ] S3 the first set: the moments of the table in the fast lessons; their intro cue lines go; headphones.good once;
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
  Full package run after that: 40 failed of 434 in the 19 files below (log U:/Temp/gsfpv-train4/tutor-moment/s3-test2.log,
  list s3-left.txt). LEFT, in order:
  1. tools/listen-words.ts sampleParams: a sample value for the argument `sound` (words.test.ts, 4 tests);
     test/locales.test.ts ARGUMENTS: `cue.<id>.what` takes ['sound'] (add it by a loop over CUE_IDS).
  2. Tests that build a runner directly on a changed lesson and test the flight, not the teaching: pass
     `known: CUE_IDS` there (runner.test.ts 8, respawn 1, brake-planner 2, gate-aim 1, world-tunnels 1, budget-wired 1,
     line 2, beacon-listen 1, beacon-target 1, world-scale 1, progress via runner.test.ts); lesson-schedule.test.ts 1
     (`runner: { known: CUE_IDS }` where it flies a changed lesson).
  3. Tests whose expectation is the old content, rewritten to the new: quick-path (c) room and (c) later lessons;
     lessons.test.ts (versions; walls-hall goal line; the speak-the-catalogue test must allow an empty intro);
     moments-contract "a lesson without moments" (pick a lesson with none, e.g. hover-height); named-sounds: namedBy()
     counts `lesson.moments` cues, the corridor/tunnel-gaps intro tests become "the corridor teaches target.hum and
     safety.free by moments", the checkpoint-sound test (target.stage / safety.reset are not introduced any more:
     glossary only, note it under "differs"); add the S3 named-sounds checks: every cue has what|do in four locales,
     `what` holds {sound}, the en do|hint lines of a moment never type their sound's own name, every shipped moment id
     is in MOMENT_IDS.
  4. replay.test.ts 3 and report.test.ts 2: recordings of changed lessons are now another lesson version (by design:
     re-record the fixture through test/helpers/record.ts, or point the test at an unchanged lesson).
  5. Then: the whole package run, typecheck, host count tests (tools/bench/test/sonic-*.test.ts), commit, move the pin.
- [ ] S4 the scripted pilot: test/first-set.test.ts in en, es, pl, ru (moving within 60 s, under 60 words before it, no
  prompt over two sentences, one new sound a moment, the set within 420 s, guide 'new' says only names); NEG on 719aaf5;
  host gates once; done marker; "What the owner should try".

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
- test/named-sounds.test.ts exists already on the base (the rule "a sound with no words is named in the first lesson of
  its path"); S3 extends it rather than creating it.

## What the owner does

Nothing yet: S1 is the contract only; no pilot hears a change.

## Claims

1. A lesson may carry `moments`; the loader checks them (forms 2-3 s, far first, one sound once, the line keys), a
   moment event is written and read back, and `CuePlanner.setAudible` plans only the listed cues (null: as before).
   Proof: `cd packages/sonic-fpv && npx vitest run test/moments-contract.test.ts` - 6 passed; NEG OK on 719aaf5.
2. A moment runs in order (freeze with only its cue audible, what, the forms alone with nothing said over them, do,
   the flight goes on, the task, praise); the hint once; again / on / know; guide 'new' says the name only; the moment
   events are recorded and the recording replays with no difference.
   Proof: `cd packages/sonic-fpv && npx vitest run test/moments.test.ts` - 8 passed; NEG OK on 12acc11 (the S1 stub).

## Not verified

- No person, phone or real controller took part. Nothing is heard yet: S1 changes no lesson.

## For the lead

- Files changed outside the owned list (package): src/session/codec.ts, tools/report.ts, src/audio/engine.ts (see above);
  S2: src/replay/compare.ts ('moment' events compared), test/helpers/record.ts (the test host).
- For lane tutor-air (the page): on 'moment' non-null hold the craft and keep stepping frames; on 'audible' call
  engine.setAudible; record the moment keys as `key` events with REPLAY_KEY_ACTIONS.momentAgain|momentOn|momentKnow
  before calling runner.momentKey; persist the cues of 'known' and 'learned' moment events as RunnerOptions.known.
- The package head of branch tutor-moment is on no remote; it must reach the package's main before the page ships.

## Cost notes

- S1: most replies went to finding the planner's output path and the codec's exhaustive lists; a map of "where a new
  SessionEvent kind must be added" in the package's AGENTS.md would save four reads.
- S2: most replies went to the test flights (the hall lesson's own stop goal misses when the craft halts mid-room, and
  approach-stop needs 2 m of path in the attempt); a note of each goal's hidden thresholds beside the test host would
  save three runs. Editing through a Python one-liner wrote CRLF on Windows: use the Edit tool.
- S3 (part 1): the moments in shared lessons broke 65 older tests that fly those lessons; a test helper default (`known`)
  took 25 of them. Cheaper: decide in the plan that flight tests run with every sound known, before adding moments.
