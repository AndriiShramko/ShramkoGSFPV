# tutor-say (train 4): say only what is new

Lane of the Fly by Sound tutorial after the first outside feedback (plan C:/dev/.gsfpv-lanes/designs/t8-plan.md Part A1,
Part B 1, Part C 2, 6, 7; brief t8-tutor-brief.md decisions 1, 7, 8, 9 outside moments). Base t7-base
03624451b8deb79d179cc9a5d07adf22f1383773; n-share merged in S1.

## Status

- [x] S1 measure and contract
  - [x] merge n-share (merge commit on tutor-say, before 11f871bd)
  - [x] (a) 11f871bd tools/bench/test/sonic-said-between-steps.test.ts: fails on the base, 4 of 4 (walls-hall: the keys line at
        step 1/2 -> 2/2; ears-headphones then walls-hall: the keys line 4 times in one session)
  - [x] (b) tools/bench/scripts/tutor-say-ax.mjs on a build of t7-base + n-share (the say path is the base's):
        evidence/2026-11-20/tutor-say/ax-base.json, 6 of 6 step changes FAIL.
        CAUSE: (1) the narrator says sonic.say.lessonKeys after the first line of EVERY step (voice), and with "my screen
        reader speaks" the same line is appended to div[data-testid=sonic-captions] role log (announced); (2) div#ui
        (role region, aria-live polite, index.html:13) announces the flight HUD's text at every step change and all the
        time (DISARMED, ANGLE, volts and timer, THR/ALT: 37-40 mutations in each 3 s window); (3) at a lesson change (N on
        the last step opens the next lesson) #ui gets 11 buttons added (the REC bar: F9, Auto, Choose a folder) and the
        focus moves body -> div[data-testid=sonic-flight]. The AX tree's named nodes do not change between two steps of
        one lesson (axAdded empty): the progress panel is not named in the AX tree.
  - [x] (c) the contract commit: SonicState.guide (packages/prefs doc.ts, test packages/prefs/test/sonic-guide.test.ts,
        NEG OK on the base), apps/fly/src/sonic/guide.ts, apps/fly/src/sonic/said-once.ts; prefs and fly typecheck rc 0;
        marker U:/Temp/gsfpv-train4/tutor-say-contract.txt
- [x] S2 the repair (keys line once a session; only the instruction between steps; #ui quiet in a lesson; progress panel one line)
  - [x] (a) 340e8bca the line of keys once a visit (lessons.ts keysDue/keysId + LessonHost.said: SaidOnce, ids 'keys.lesson' and
        'keys.free'): sonic-said-between-steps 4/4 and sonic-hints (H1 rewritten to the new rule; it asserted keys at every
        step) pass; NEG OK on the base (lessons.ts swapped). Fly typecheck rc 0.
  - [x] (b)-(d) one commit (see git log "S2 (b)-(d)"): live-quiet.ts LessonHold (module lessonHold; quietLiveRegion quiets on
        rule() || hold.held, so feature.ts is unchanged), held by progress-panel.ts followProgress = a lesson shown and the flight
        not paused; relayHeldNews (live-quiet.ts, wired in the Captions constructor from ui/messages.ts) adds each new HUD line told
        while held to the captions when a screen reader reads them; the panel is ONE line (StepInstructions: the step's first line
        that is not the title, written by lessons.ts act say; the title before it), no counter, the node kept, text written only
        when changed. Test tools/bench/test/sonic-said-hold.test.ts 5/5, NEG OK on the base; sonic-lesson-keys and
        sonic-review-v13 panel tests moved to the new rule (they asserted the counters); fly typecheck rc 0.
  - [x] (e) tools/bench/scripts/tutor-say-ax.mjs on a build of 99433408: evidence/2026-11-20/tutor-say/ax-repaired.json, 6 of 6 step
        changes PASS (base: 6 of 6 FAIL). Between steps the voice says only the step's line ("Go."; at the lesson change the next
        lesson's title and first line), the screen reader path announces only the same lines in div[sonic-captions]; #ui announces
        nothing (was 37-40 HUD mutations a step); no buttons in a live region. The probe's focus rule now accepts body ->
        div[sonic-flight] (feature.ts R5: the flight's role=application region takes a focus nobody holds when the flight goes on).
        That build's panel showed "Go." in a flying step; the next commit keeps the task said before it (START_CALLS fly.go,
        fly.go-on are not instructions; StepInstructions.heard, test (d) in sonic-said-hold 6/6, NEG OK). S4's build checks the line.
- [x] S3 the start screen and short speech (one commit, see git log "S3")
  - start-screen.ts: the Start buttons are Start flying (sonic-start-quick, the fast path, primary, focused), All lessons
    (sonic-start-all: saves the full path, the lessons counted on it, the focus to the lessons heading; what Full course was),
    Continue third; at open (show() with the sound on, or the first key of a fresh page) the voice says ONE line, openLine() = the
    title and the main button; no listHelp at the first key (key K says it, not in a select), no "Item n of N" in the Start section
    (SpokenList.openedAt keeps the list there without the section name); a setting change redraws only its row (redrawRow: a refused
    change, the head switch's refusal), a visit setting updates the link's note in place (refreshVisit), Show all redraws the settings
    section only; the Start buttons are never drawn again by a setting. Guide row (sonic-guide, level first, after the narrator).
  - locales (four, the same keys; applied by a one-off script, removed in S4 because B18 forbids people's texts outside the locales): new
    sonic.start.all, sonic.guide.label/full/short/new; sonic.start.quick = Start flying; removed sonic.start.full and the panel's
    counters sonic.progress.step/attempt/counted (unused since S2); cut to two short sentences: listHelp, menuOpen, replayOlder,
    scanLoading, start.intro, wallsBuilding, wallsFailed, scanNoWalls, courseReady, start.scanWhat, narratorTip, inPlaceIntro(Course).
    Kept long on purpose (in the test, with reasons): lessonKeys and lessonKeysFree (one sentence a key by lane sonic-hints' key-name
    rule; said once a visit, then on K), the four gpu lines (the owner's wording of 2026-11-14 for a helper, sonic-gpuhint.test.ts).
  - tests: tools/bench/test/sonic-say-length.test.ts 6/6 (with its own negative control of the checker); sonic-start-screen.test.ts
    39/39 (5 new "tutor-say S3", the old ones moved to the new buttons, the Guide row and no Start counter); NEG OK on the base
    (start-screen.ts, spoken-list.ts and the four locales swapped: 10 of 10 fail). Also green: sonic-gpuhint, -in-place, -scan-course,
    -quiet-n6, -walls-free, -review, -garden, -hints, -lesson-keys, -int-lazy, -start, -review-v13, -said-*, course-progress,
    sonic-lessons, share-links-sound-note, sonic-optin, sonic-panels. Fly typecheck rc 0, architecture ok.
- [x] S4 the acceptance by mouse (95943f23 the probe; 2d0a1ba1 the panel fix it found; the closing commit has the evidence)
  - tools/bench/scripts/tutor-say-accept.mjs: fresh profile, 1536 x 730 at scale 1.25, ?render=off, targets by data-testid and key
    action id. Local build of 2d0a1ba1: open, tab, start, steps, once, askK, guide all PASS (evidence accept-local.json). Live site
    (read only, a throwaway profile): open, tab, steps, once, guide FAIL; start and askK PASS (they were never broken) (accept-live.json).
    Live said at the first key "Fly by Sound. The up and down arrows move, ... Escape goes back." then "Start. Full course. ... Item 2
    of 2."; the keys line 3 times in 3 steps; the panel "A small roomLesson 2 of 7Step 1 of 2Counted 0 of 3"; no Guide row.
  - The first local run found the panel showing "Sound 2 of 2." (the package's headphone trial line, headphones.trial) as the
    instruction: progress-panel.ts PLACE_LINES keeps it off the screen (test sonic-said-hold 7/7, NEG OK against 95943f23).
  - Pictures: tutor-say-start.png: the title, Start flying (large, green, focused) beside All lessons, no counter. tutor-say-
    instruction.png: one large white box at the left edge, "Wall", the step's own line, no counter.
  - Pointer lock: the click into the scene does not take it in headless Chrome (pointerLock false in both runs); keys still reach
    the flight.

## What the owner does

What the owner should try:
1. Open the site in a new private window at /en/fly/?sonic=start and press the Down arrow once: the voice says only "Fly by Sound.
   Start flying..." and then "All lessons" (where the focus went). No list of keys, no "Item 2 of 2".
2. Press the Up arrow and click Start flying with the mouse; listen through three steps (key N): each step says its own line only;
   the line of keys ("Next, key N. Back, key B...") is said once, never again. The box at the left shows one line, no "Step 2 of 3".
3. Press key K: the keys are said, because you asked.
4. Back on the sound start screen, Settings, Guide: choose New sounds only, reload the page: it still says New sounds only.

## Claims

1. Between step N and N+1 the voice and the captions say only the step's own lines; the keys line once a visit.
   `npx vitest run tools/bench/test/sonic-said-between-steps.test.ts`: 4/4 (fails on the base).
2. #ui is quiet while a lesson runs, the HUD news still reaches the captions, the panel is one line with no counter.
   `npx vitest run tools/bench/test/sonic-said-hold.test.ts`: 7/7 (NEG OK on the base and on 95943f23).
3. Between two steps the accessibility tree and the live regions announce only the instruction.
   `node tools/bench/scripts/tutor-say-ax.mjs http://localhost:7021 <out>`: 6/6 PASS (base 6/6 FAIL; ax-base.json, ax-repaired.json).
4. The start screen says its title and Start flying once; Start flying, All lessons, Continue; a setting redraws only its row; the
   Guide row. `npx vitest run tools/bench/test/sonic-start-screen.test.ts`: 39/39 (NEG OK on the base).
5. No host line of a lesson or the start screen is longer than two short sentences, in four languages.
   `npx vitest run tools/bench/test/sonic-say-length.test.ts`: 6/6.
6. The Guide level is stored (absent = short). `npx vitest run packages/prefs/test/sonic-guide.test.ts`: pass (NEG OK on the base).
7. The pilot's mouse path: `node tools/bench/scripts/tutor-say-accept.mjs http://localhost:7021 <out>`: 7/7 PASS; the same against
   https://gsfpv.flyreelstudio.eu: open, tab, steps, once, guide FAIL (accept-local.json, accept-live.json).
8. The gates once: `gates.py --only typecheck,vitest,architecture,i18n,b18,leaks,catalog`: typecheck, vitest, architecture, i18n,
   catalog, leaks PASS; b18 FAILed on the S3 locale patch file (people's texts outside the locales), the file removed, b18 again PASS.

## Not verified

No person, phone or real controller took part; the screen reader path is measured through the captions region and the
Chrome accessibility tree, not with a real screen reader.

## For the lead

- tools/bench/src/sonic-v13-page.ts (not mine): its progress panel check (about :490-500) expects the old rows (lesson place, "Step 2 of 2", "Attempt 1", "Counted 1 of 3"); under decision 9 the panel shows one line, the step's instruction (hook text = that line). Update the check to: one line, equal to the hook's panel text, no "n of m". The locale keys sonic.progress.step/attempt/counted are then unused (sonic.progress.lesson stays: start-screen.ts).
- apps/fly/src/sonic/feature.ts (tutor-air): the flight region (data-testid sonic-flight, role application) takes the focus only after a pause ends; at a lesson's first start the focus stays on body. Calling focusFlight() when a lesson opens would make the focus the same from the first step (the AX probe saw body -> sonic-flight at the first lesson change).

- Page probes that are not mine still name the old Start buttons and lines (lane tutor-say S3): tools/bench/src/sonic-quick-walk.ts
  (sonic-start-full at :220, :273), tools/bench/src/sonic-int-review.ts R10 (:985, :998 expect sonic-start-full), tools/bench/src/
  sonic-v13-page.ts (:291 "Quick start" and "Full course"; :341 "the first key says how the list works": now the first key says the
  title and the main button, the list's help is key K; :409 Escape's line has no "Item n of N" now; sonic.progress.step/attempt/
  counted are deleted), tools/bench/src/sonic-start-keyboard.ts (:356 reads the full button's sub), tools/bench/scripts/
  gap-sound-accept.mjs (:234 expects Continue second: it is third now, after All lessons). Move them to: sonic-start-quick,
  sonic-start-all, sonic-start-continue.
- packages/sonic-fpv (lane tutor-moment): the headphone trial still SAYS "Sound 2 of 2." (headphones.trial, runner.ts); decision 7
  asks for no counter unless asked. The screen no longer shows it (PLACE_LINES); the spoken line is the package's to cut. Also
  walls-hall's first step says only "Wall" (a sound's name), so the panel shows "Wall" as that step's line.
- Deploy order: page only (apps/fly, the fly/sonic locales, packages/prefs doc.ts). No API, rooms, nginx or sound package change.
  Live checks after deploy: tools/bench/scripts/tutor-say-accept.mjs https://gsfpv.flyreelstudio.eu (all PASS expected).
- tools/bench/test/sonic-hints.test.ts was not touched in S3; sonic.say.menuOpen keeps its second sentence word for word.

## Cost notes
- S1: the most replies went to reading the rig and the old probe to write the test and the AX probe; a shared "lesson page probe" helper (open a lesson, press N, read the hook) would make it cheaper.
- S2 run 1: the most replies went to finding where #ui's quiet rule and HUD news live (feature.ts, ui/messages.ts, hud.ts) after the plan placed them in live-quiet.ts; the design is now written in Status (b)-(d), so the next run builds without re-reading them.
- S2 run 2: most replies went to test edits through node -e (shell escaping of backticks failed twice; use the Edit tool for any text with quotes or backticks) and to the first probe run showing "Go." as the instruction; reading the runner's say lines for a flying step before choosing the panel rule would have saved a build.
- S4: most replies went to the probe's first run finding a real panel bug (a rebuild, the second build of the stage) and to scoping
  the keys line "named once" in the step check; reading one ears-headphones step's spoken lines in S2's evidence first would have
  caught "Sound 2 of 2." before the build.
- S3: most replies went to moving the old start-screen tests (counts and item numbers shift with one more row); a one-off replace script per test file (U:/Temp) did it in one run; check a replace that renumbers in sequence (n: 14 -> 15 then 15 -> 16 hit the same line).
