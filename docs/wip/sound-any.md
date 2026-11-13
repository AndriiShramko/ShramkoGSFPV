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
- [x] tests: freeLessonOf moved into start-model.ts (pure; start.ts imports it); tools/bench/test/sonic-scan-free.test.ts loads: 4 passed; negative control (neg_control.py --cwd tools/bench, ref origin/main, start-model.ts scan-lesson.ts sonic-flight.ts): NEG OK by 'modeScanPage is not a function'. Earlier NEG OKs without --cwd were void (vitest path not found from the repo root). Start-screen DOM case for the button order: not written (S3 pass 2 commit)
- [ ] packages/prefs/test/migrate.test.ts with a fliesBySound document (kept when true, dropped otherwise); pinned tables of docs/agent-map.md re-run (no setting or key added, so no table change expected)
- [ ] (next) probe: new case (r10) in tools/bench/src/sonic-int-review.ts. Notes for it: its PORT is the const 5420, make it read an env (PORT=5700); it takes C:/dev/.gpu-lock itself (lock()), do not wrap it; build first with node scripts/build-release.mjs (commit before, it may run over 2 min); the start screen's scan button is testid sonic-start-scan or sonic-start-scan-flier; wait for runner phase flying before N; check what __gsfpv.sonic(false) returns for the target and how a probe flies to a gate (r9 flyWithTurns uses keys only). Case: on a local release (ports 5700-5719): scene 887f27aa by the new link, free scan flight running, a wall cue planned flying at a wall; screenshots U:/Temp/gsfpv-train2/shots/sound-start-first.png and sound-start-experienced.png

Stage S3-course-by-sound (sound2-plan 2.1, simulator only, no package change, no pin move):
- [x] scan-lesson.ts scanCourseLesson(free, track): scan-free turned into goal timed-course (track.laps), layer target added, world.track = the course; lines are measured package lines (free-garden intro.2 with the hum cue, goal.1, hint.1, retry; scan-free pass). isScanCourse(lesson). buildScanLesson(track, view, { course }) calls ScanSonicWorld.setCourse(track) (world checkpoints = coursePath: respawn to the furthest path point passed); free-garden unchanged (commit of this line)
- [x] course-ask.ts: courseJob / courseAnswer (pure) and askCourse: own Worker of apps/fly/src/course/worker.ts ('generate'), limit COURSE_LIMIT_MS = 150000 (the course feature's GENERATE_LIMIT_MS, an estimate there) (this commit)
- [x] lessons.ts: LessonPage.course { ask, key }; free flight with walls says sonic.say.courseOffer; N in a free scan flight (advance) -> flyCourse: courseMaking, ask, then courseReady (n, laps, key) on the course, or scanNoWalls / courseNone and the free flight again; N in a course asks for another (this commit)
- [x] feature.ts: courseOf(ctx, tracks, names): first ask takes the seed of the page's course= link (seedOfLink), later random; the course goes into the tracks cache (no fetch); scanLesson passes course: lesson.id === SCAN_FREE_ID (this commit)
- [x] locales packages/i18n/locales/fly/sonic/{en,es,pl,ru}.json: sonic.say.courseOffer, courseMaking, courseReady, courseNone (this commit)
- [x] test tools/bench/test/sonic-scan-course.test.ts: 3 passed; negative control redone with --cwd tools/bench (ref origin/main, scan-lesson.ts, whole file): NEG OK by assertion 'expected 0 to be >= 8'
- [x] sonic-flight.ts modeScanPage(ses, location.search): the page's course=g1.<seed> (checked by course/link.ts seedOfLink) goes into the sound link, anything else stays behind; test case 'S3' in sonic-scan-free.test.ts, negative control (ref HEAD, sonic-flight.ts, -t S3): NEG OK by assertion (S3 pass 2 commit)
- [x] host-level rig test: tools/bench/test/sonic-lesson-rig.ts Rig.make({ course }) (page.course; an ok answer goes into rig.courses like feature.ts's tracks cache) and scanLesson by the lesson's own track (trackOf), course world for scan-free; sonic-scan-course.test.ts 'page host' case over a flat analytic floor (packages/collision analyticCollision, the garden track at x5): courseOffer said, no target in the free flight, N in flight -> courseMaking, ask once, courseReady {n 8, laps 1, key N}, target and lit gate ring-1, a follow pilot passes ring-1, then target and lit gate ring-2. 4 passed; negative control (ref 89b2bdb6 = before S3, lessons.ts, -t 'page host'): NEG OK by assertion. sonic-scan-bump + sonic-garden: 21 passed; tsc tools/bench clean
- [ ] probe: new case in tools/bench/src/sonic-int-review.ts on a local release (ports 5700-5719): ?sonic=scan&scene=887f27aa&sz=1, N, wait for courseReady (generation up to 31 s measured by lane tracks), __gsfpv.sonic().target is gate 1, fly through it, then gate 2; lastLine fly.gate
- [ ] key I (where am I) line for the course (gate k of n, metres, lap time): the runner's statusLine as it is now, not checked
- [ ] 2.2 (explore a scan without a course): not started

Stage fixes (review findings SN-1 to SN-10):
- [x] package train2 b6ab45c: runner nextLine gives no line for SCAN_FREE_ID (no "That was the last lesson" after a course); CHANGELOG motor line corrected and the motorChoice line added (SN-3, SN-10). test/praise.test.ts new case, NEG OK (ref train2, runner.ts); package suite 1309 passed, 4 skipped (64 files); typecheck clean. Pin 8b779d4 -> b6ab45c (fixes commit 1)
- [x] SN-1: sonic-flight.ts reads location only when it exists; sonic-optin.test.ts new case (scan page link, built-in control); NEG OK by 'location is not defined' (fixes commit 1)
- [x] SN-2: LaunchRequest/SonicEntry.freeOf (start.ts freeLessonOf over the page's request, boot.ts passes it); LessonHost.openFromScreen(id, freeOf); feature.ts onStart uses it (fixes commit 1)
- [x] SN-3: lessons.ts checkPassed: a passed course reopens the same course and says courseReady again; a new course only on N (fixes commit 1)
- [x] SN-4: the sound link carries the seed as sg=<base 36> (sonic-flight.ts SOUND_COURSE_PARAM, soundCourseSeed; feature.ts courseOf reads it); never course= (fixes commit 1). 'sg' is no param of the page or of SONIC_LINK_PARAMS (grep)
- [x] SN-6: SCAN_FREE_ID runs with progress null and saves nothing (runnerOptions, finish, observe) (fixes commit 1)
- [x] SN-8: a failed course ask says one line; the free flight reopens with open(..., { quiet }) (no second no-walls line, no offer) (fixes commit 1)
- [x] SN-9: flyCourse remembers the runner; a late answer after the pilot left opens nothing (fixes commit 1)
- [x] tests: sonic-scan-course.test.ts case 'review SN-2/3/6/9' (rig: scan button with no free flight before, all 8 gates, idle, scan button after the course, late answer); NEG OK (ref HEAD, lessons.ts) by assertion 'expected false to be true' (the SN-2 step, first in the case); sonic-scan-free S3 case moved to sg=, NEG OK by assertion

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

- S3 keys a pilot uses, in order (for the note to the owner): 1. on a sighted page, Shift+G makes a course (optional), then the pause
  menu's Fly by Sound opens the sound page for this scan; 2. on the start screen, the scan's button (Enter); 3. the free flight says
  "Press N for a course of gates in this scan"; N builds it (up to about half a minute, said). N while the intro is still
  speaking only skips the intro (the runner's N), so a pilot who presses during the intro presses N once more in the flight (rig test); 4. "Course ready. Gates: n, laps: k.
  The hum leads to gate 1": follow the hum; each gate and each lap time are said; 5. N again: another course; I: where am I;
  Escape or X: the menu. No new letter: every free letter is a keyboard-flying key (W A S D Q E) and Shift is the mode's down.
- S3: the course is a scan-free lesson in memory (id SCAN_FREE_ID, version 1) with goal timed-course; no package template
  course-free yet, so no new package lines, no TTS or listen-words run. The sound page asks the course worker itself, since the
  course feature's track and generate() are inside its closure (lane tracks).

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

- S3 hook needed in lane tracks (apps/fly/src/app/builtin/course.ts, apps/fly/src/course/hook.ts): CourseHook has the track's id,
  not the TrackFile, and generate / load are closure functions. The sound page therefore runs its own worker job (course-ask.ts).
  Wanted: hook.course.trackFile(): TrackFile | null and hook.course.generate(seed) (or a 'course' ctx event with the track), and a
  way to keep the course feature's lap HUD and its clock off on a ?sonic= page (one clock: the runner's). A saved (server) course
  by sound needs the same hook (load + check on the pilot's walls); not done.
- S3 recordings: a course flight records lesson scan-free v1 with a track that is not a file of the release: its replay check
  will not re-derive (the plan's "TrackFile into the session package" is not built).

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

- S3: nothing flown in a browser: no worker run, no hum on gate 1 or 2, no gate or lap line heard; the runner gives no target
  before its first step, so the unit test checks the lesson and the world, not the target. The NEG OK of the checkpoints case was
  on scan-lesson.ts only. tools/bench sonic-scan-free.test.ts (S2's, untracked) still does not load (location at import).
  Locale parity tests and the i18n gate were not run (four keys added in all four languages).

- S2: nothing of the simulator part is built yet (items [ ] above); no page probe, no screenshots. The package template was
  not flown in a browser; its texts were heard only by the words check (Windows voices and Whisper), not by a person.

- No browser run: sonic-optin-page (probe seed changed) and page probes were not run (GPU lock, integration runs them).
- Real pilot recordings with backing up were not replayed (none at hand in the package fixtures).
- sonic-bump.test.ts 'walls, pillars...' case did not finish within its 5 s timeout here on either pin.

## Cost notes

- S3 pass 2: about 8 of 30 turns went to finding how N reaches the host (runner next skips the intro first) and how the rig flies a scan without the scan's walls file (analyticCollision flat floor); the page probe did not fit. Earlier NEG OKs without --cwd were void: neg_control.py needs --cwd tools/bench for vitest there; a line about it in the skill or agent-map would have saved a pass.

- S3: about 20 of 30 turns went to reading how the runner, the host, the course feature and the keymap fit (no free letter, course
  track hidden in a closure, runner target only after a step) before writing; a scout note naming these three facts would have saved half.

- S1: most turns went to quoting test patches (a heredoc ate the backslash of TS \' strings); a patch script written
  with Write from the start would have saved two turns.
- S2 pass 2: reading start-screen, lessons, feature and scan-lesson by slices took ~12 turns; a `cat > /dev/null` before a heredoc hung one call. A test that imports start.ts cannot load in Node (location at import): pure helpers belong in start-model.ts from the start.
- S2: the package's spoken-line evidence (TTS lengths for four voices, the Whisper words check over every line) is a hidden cost of any new package line: 6 turns before the simulator was touched. A note in the scout's design that new package lines need measure-tts.ps1 and listen:words would have let the stage plan for it.
