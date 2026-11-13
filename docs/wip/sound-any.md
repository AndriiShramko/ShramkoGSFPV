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
- [x] simulator tools/bench test/sonic + test/sonicrec on pin 8b779d4 (43 files): 740 passed, 3 failed, all 'Test timed out in 5000ms' under load: sonic-bump 'walls, pillars...' (times out on the old pin too, S1) and two sonic-scan-world normal cases (the file alone: 7 passed)
- [x] simulator: pause item sonic-flight.ts modeScanPage(ctx.session) -> /{lang}/fly/?sonic=scan&scene=<id>&sz=<size> (sharedNumber 3 places); built-in world or no session -> ?sonic=start. Stays a NEW TAB: the flight stays paused under the menu, the pilot returns where he was (this commit)
- [x] simulator: start-model parseSonicParam(raw, query) accepts 'scan' and 'scan-free' with scene (/^[A-Za-z0-9_-]{1,64}$/) and sz (SHARED_LIMITS.size, no sz = 1) -> kind 'scan'; experiencedPilot, scanStartOrder; start.ts freeLessonOf(request, id) = scanFreeLesson(scene, [sz,0,0,0]); onStart uses it (no setCurrentLesson for it), forceScanPrefs runs on its world; LaunchRequest.free -> boot.ts -> SonicEntry.free -> feature.ts h.openFree (this commit)
- [x] simulator: prefs doc.ts SonicState.fliesBySound (kept only when true, no migration: absent = first-timer); store.ts fliesBySound / setFliesBySound; start-screen.ts: scan link puts sonic-start-scan (primary) first for an experienced pilot, else the lesson buttons first and sonic-start-scan-flier after them (its press saves the flag); 4 keys in packages/i18n/locales/fly/sonic/{en,es,pl,ru}.json (sonic.start.scan, scanFlier, scanWhat, sonic.say.scanNoWalls) (this commit)
- [x] simulator: buildScanLesson(track | null) (no track: no gates, the scan's spawn); feature.ts scanLesson fetches no track when the lesson names none; lessons.ts openFree(lesson), open() takes SCAN_FREE_ID when set, no setCurrentLesson and no address rewrite for it (the address stays the scan link), N / previous go to the menu (this commit)
- [x] simulator: no walls in a free flight (voxelM null): bridge.say sonic.say.scanNoWalls (spoken and in the captions) with the way to build walls. Message only: WallsHook (apps/fly/src/walls.ts) exposes refine() but no bake(); the bake starts only from the walls box's own button (see For the lead) (this commit)
- [~] tests: tools/bench/test/sonic-scan-free.test.ts written (link, order, scan-free without a track) but it does NOT load: importing apps/fly/src/sonic/start.ts reaches a module that reads `location` at import ("ReferenceError: location is not defined"). Next step: move freeLessonOf from start.ts into start-model.ts (pure; start.ts imports it), import it from there in the test, run the test, then the negative control (neg_control.py --ref origin/main --files apps/fly/src/sonic/start-model.ts apps/fly/src/sonic/scan-lesson.ts apps/fly/src/app/builtin/sonic-flight.ts -- node ../../node_modules/vitest/vitest.mjs run test/sonic-scan-free.test.ts, from tools/bench). The NEG OK printed in this pass is void (the test failed on both codes). Also add a start-screen DOM case (button order by testid) in tools/bench/test/sonic-start-screen.test.ts
- [ ] packages/prefs/test/migrate.test.ts with a fliesBySound document (kept when true, dropped otherwise); pinned tables of docs/agent-map.md re-run (no setting or key added, so no table change expected)
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

S2 pass 2 checks: tsc apps/fly, tools/bench, packages/prefs: no errors. tools/bench sonic-optin + sonic-start-screen: 42 passed. packages/prefs migrate + defs: 41 passed.

## Decisions

- S2 pass 2: the pause item stays a new tab (the flight is left paused under the menu, as before). "Back to the lessons" from a free
  flight is the mode's existing menu key (the start screen with the lessons); no new key X was added. Experienced = any saved lesson
  progress or fliesBySound true.

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

- S2 walls: starting the walls build from the sound page needs more than a small hook: apps/fly/src/walls.ts WallsHook has refine()
  but no bake(); the bake is wired to the box's own button inside mountWalls. The free flight only says sonic.say.scanNoWalls.

- S2: the pin is now package commit 8b779d4 on branch train2 of C:/dev/ShramkoSonicFPV (not pushed), on top of S1's 1ed6103.
- The words check (listen-words) takes C:/dev/.gpu-lock itself: a wrapper that holds the lock deadlocks it (it happened here
  once; I released my own lock by hand and the run finished, 35 min in all).

- Pin moves to package commit 1ed6103 on branch train2 of C:/dev/ShramkoSonicFPV, which is NOT pushed (no push in this
  workflow): push the package branch (or merge it to the package main and push) before the simulator merge, or the
  submodule pin does not resolve for others.
- Every pilot who flew Fly by Sound before has motorSound true saved without motorChoice: after this release his motor is
  off until he switches it on (the owner asked for off by default).
- Package evidence/audio-proofs.json and evidence/demo-check.json carry a predecessor's uncommitted diff; my runs did not
  regenerate them; left uncommitted.

## Not verified

- S2: nothing of the simulator part is built yet (items [ ] above); no page probe, no screenshots. The package template was
  not flown in a browser; its texts were heard only by the words check (Windows voices and Whisper), not by a person.

- No browser run: sonic-optin-page (probe seed changed) and page probes were not run (GPU lock, integration runs them).
- Real pilot recordings with backing up were not replayed (none at hand in the package fixtures).
- sonic-bump.test.ts 'walls, pillars...' case did not finish within its 5 s timeout here on either pin.

## Cost notes

- S1: most turns went to quoting test patches (a heredoc ate the backslash of TS \' strings); a patch script written
  with Write from the start would have saved two turns.
- S2 pass 2: reading start-screen, lessons, feature and scan-lesson by slices took ~12 turns; a `cat > /dev/null` before a heredoc hung one call. A test that imports start.ts cannot load in Node (location at import): pure helpers belong in start-model.ts from the start.
- S2: the package's spoken-line evidence (TTS lengths for four voices, the Whisper words check over every line) is a hidden cost of any new package line: 6 turns before the simulator was touched. A note in the scout's design that new package lines need measure-tts.ps1 and listen:words would have let the stage plan for it.
