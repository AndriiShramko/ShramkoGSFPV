# Lane sound (train 2): sound-any

Worktree C:/dev/gsfpv-tracks, branch sound-any (from origin/main 2a5ac433). Sound package: C:/dev/ShramkoSonicFPV branch
train2 (from its main 378cc50). Ports 5700-5719. Facts: U:/Temp/gsfpv-train2/scout-A.md A1-A3; design
C:/dev/gsfpv-v03/docs/wip/sound2-plan.md.

## Status

Stage S1-direction-motor:
- [x] (a) package: wrong way only while flying nose-first (package train2 4c2ac75)
- [x] (b) package: motor sound off by default, marker motorChoice, old false-to-true migration removed (package train2 1ed6103; CHANGELOG line in it)
- [x] simulator: sound.ts pause switch and start-screen motor row save motorChoice; tests sonic-motor, sonic-audio, sonic-start-screen; probe seed sonic-optin-page (e37e2bb9)
- [x] pin packages/sonic-fpv 378cc50 -> 1ed6103 (e37e2bb9)
- [x] simulator sonic and sonicrec unit tests on the new pin (see Checks)

Stage S2-any-scan (fly THIS scan by sound):
- [x] package: template lessons/scan-free.json + scanFreeLesson(sceneId, transform), SCAN_FREE_ID, catalogue LESSON_TEMPLATES, 7 lines in en/es/pl/ru, test/scan-free.test.ts (package train2 335888d)
- [x] package: the 7 lines measured with the four Windows voices (test/fixtures/measure-tts.ps1), lesson-schedule counts 394->401 / 277->282 (en), 480->487 and es 264, pl 357, ru 487 longer (package train2 b9ccaed)
- [x] package: words check (SHRAMKO_LISTEN_PY=U:/venvs/shramko-listen/Scripts/python.exe node tools/run-tool.mjs listen-words; it takes C:/dev/.gpu-lock itself, do not wrap it): PASS, 545 lines per language, 0 over the bound 0.2 in en, es, pl, ru, control 545 of 545 over (package train2 8b779d4)
- [x] package whole suite 1308 passed, 4 skipped (64 files), typecheck 0 errors; pin packages/sonic-fpv 1ed6103 -> 8b779d4 (this commit)
- [ ] simulator sonic tests on the new pin (tools/bench test/sonic*; S1 baseline 741 passed, 2 timeouts)
- [ ] simulator: pause item apps/fly/src/app/builtin/sonic-flight.ts opens /{lang}/fly/?sonic=scan&scene=<id>&sz=<size> (keep new tab: the flight stays paused under the menu, as today)
- [ ] simulator: start-model parseSonicParam accepts 'scan' with scene and sz; start.ts onStart for the scan uses scanFreeLesson(scene, [sz,0,0,0]) instead of getLesson; forceScanPrefs with that world
- [ ] simulator: store.ts flag "I already fly by sound" (new prefs key: run packages/prefs/test/migrate.test.ts and the pinned tables of docs/agent-map.md); start-screen.ts order: experienced (any savedProgress or the flag) = "Fly this scan by sound" first, "Lessons" second; first-timer = lessons first, then "I already fly by sound: fly this scan"; X back to lessons; texts in packages/i18n/locales/fly/sonic* in en, es, pl, ru
- [ ] simulator: feature.ts scanLesson and scan-lesson.ts buildScanLesson without a track (no loadLessonTrack, no gates; start = the scan's spawn); lessons.ts host openFree
- [ ] simulator: a scan without walls (session.collision null): spoken and shown line plus the walls build of apps/fly/src/walls.ts if it can be called from the sound page with a small hook, else the line only and a note under For the lead
- [ ] tests with negative controls: link carries the scene, start order first-timer and experienced, scan-free without a track
- [ ] probe: new case in tools/bench/src/sonic-int-review.ts on a local release (ports 5700-5719): scene 887f27aa by the new link, free scan flight running, a wall cue planned flying at a wall; screenshots U:/Temp/gsfpv-train2/shots/sound-start-first.png and sound-start-experienced.png

## Checks (numbers printed by the commands)

Package (C:/dev/ShramkoSonicFPV, node node_modules/vitest/vitest.mjs run):
- test/direction.test.ts: 63 passed (3 new cases: backing up nose forward at 1, 2, 3 m/s never told; sliding sideways never told; nose-first control told).
- Negative control (neg_control.py, ref main, src/lesson/runner.ts, -t "owner, train 2"): NEG OK.
- test/events.test.ts + test/repeat-plays.test.ts: 20 passed. test/replay*.test.ts (3 files): 27 passed. No replay hash changed, so no lesson version bump.
- test/prefs.test.ts: 37 passed; negative control (ref main, src/prefs/prefs.ts, -t "chose it"): NEG OK.
- Whole package suite: 1303 passed, 4 skipped (63 files, 26 s). npm run typecheck: no output (clean).

Simulator (this worktree, tools/bench):
- sonic-motor, sonic-audio, sonic-start-screen, sonic-optin: 86 passed.
- Negative control (ref origin/main, sound.ts + start-screen.ts, -t motorChoice): NEG OK.
- tsc apps/fly and tools/bench: no errors.
- tools/bench test/sonic* + test/sonicrec* (43 files, 2 min 13 s): 741 passed, 2 failed, both 'Test timed out in 5000ms':
  sonic-scan-world (passed when re-run alone) and sonic-bump 'walls, pillars, ceiling, floor at 0-85 deg' (9.9 s alone;
  also times out on the old pin 378cc50, so it is not this change; load on this PC).

## Decisions

- Wrong way: the old condition (against the way forward faster than 0.5 m/s for 1 s) AND horizontal speed along the nose
  (headingBasis(yawDeg)) above the same 0.5 m/s, both over the same second; backSince resets when either fails. The
  threshold is the existing WRONG_WAY_MPS, no new number. Leg bookkeeping (legFlown) unchanged.
- Fixtures fixed on purpose, not the rule: the E3 controls ("lane's first rule tells the pilot who backs away") now turn
  round and fly away nose-first (backAway(p, 'turned')); the shipped E3 case checks both backing and turned (never told);
  the second-lap case turns to face ring 4 before flying back. All other old cases already flew nose-first (flyTo faces
  along the motion; turnTo(180) before flying back).
- No lesson version bump: replay tests and goldens unchanged; precedent: the s13-elev rule change (fabfbbe) was also
  unversioned. A real recording that contains a backing-up wrong-way cue would now replay as a mismatch under the same
  lesson version.
- Motor: motorChoice (optional boolean, ADDED key, default false). readPrefs keeps motorSound only when motorChoice is
  true, otherwise off (issue reported when a stored true has no marker). Strict validatePrefs never changes a recorded value.
- Lesson texts: package lessons/*.json and locales mention the motor only as setting names ("Motor sound", "Motor
  volume"); simulator sonic locales do not say the motor is heard by default. No text change.

- S2 scan-free: the open goal is fly-distance 5000 m (the validator's top for that goal), attemptLimitS null, maxTouches null: the
  validator needs one goal or more, and a distance no flight reaches keeps the flight open without a validator change. Layers
  safety, height, room, voice (no target: no course). Assists as free-garden (velocity, altitude hold, 5 m/s). The template is
  not shipped (not in SOURCES, not on a path), so the lesson ladder, LESSONS and the paths stay as they are; its keys sit in
  the catalogue's LESSON_TEMPLATES, after the ladder's keys in every locale file. Version 1, own id 'scan-free'.

## For the lead

- Pin moves to package commit 1ed6103 on branch train2 of C:/dev/ShramkoSonicFPV, which is NOT pushed (no push in this
  workflow): push the package branch (or merge it to the package main and push) before the simulator merge, or the
  submodule pin does not resolve for others.
- Every pilot who flew Fly by Sound before has motorSound true saved without motorChoice: after this release his motor is
  off until he switches it on (the owner asked for off by default).
- Package evidence/audio-proofs.json and evidence/demo-check.json carry a predecessor's uncommitted diff; my runs did not
  regenerate them; left uncommitted.

## Not verified

- No browser run: sonic-optin-page (probe seed changed) and page probes were not run (GPU lock, integration runs them).
- Real pilot recordings with backing up were not replayed (none at hand in the package fixtures).
- sonic-bump.test.ts 'walls, pillars...' case did not finish within its 5 s timeout here on either pin.

## Cost notes

- S1: most turns went to quoting test patches (a heredoc ate the backslash of TS \' strings); a patch script written
  with Write from the start would have saved two turns.
- S2: the package's spoken-line evidence (TTS lengths for four voices, the Whisper words check over every line) is a hidden cost of any new package line: 6 turns before the simulator was touched. A note in the scout's design that new package lines need measure-tts.ps1 and listen:words would have let the stage plan for it.
