# Lane gen4b (train 4): the generator's options, the Generate dialog, the progress

Design: C:/dev/.gsfpv-lanes/designs/gen4.md, part gen4b (apps/fly only). Owner's words: brief lines 555-556, 563-566.
The contract (packages/tracks/src/request.ts) came from gen4a S0 (b142e495), merged into this branch.

## Status

- [x] B1 dialog: course/generate-dialog.ts (dialogModel, pressAction, dialogKey, GenerateDialog), course.ts routes Shift+G,
      the pause menu item, the editor's G and hook.generateDialog through it; store keys course.level, course.spread;
      locales course.gen.* in en, es, pl, ru; generate-dialog.test.ts (7 tests, NEG OK). Commits 6e525061, 3fde6ad6.
      The CourseJob does not carry the request yet (course.ts keeps it in `request` and on hook.request): B2 sends it.
- [x] B2 worker and progress: worker.ts calls planCourse when the job carries the request (a 'g1.' link keeps the old path);
      progress steps analyse/free/lay (planSteps, planStepMs, ProgressClock.finish); progress-box.ts CourseBox (16 px, bar,
      step, %, time left, Cancel 44 px; stays until the answer); link.ts courseOfLink (g1 legacy, g2 request) and the page
      writes 'g2.' links; the no-room box 'Make the scene xN and build' / 'Try another layout' + Close + 44 px cross; the
      start line 'The start gate is N m away' for 8 s; hook.box, hook.plan, hook.startLine. course-progress.test.ts
      (+5 tests, 20 passed, NEG OK). Commit 25fbb339.
- [x] B3 acceptance: tools/bench/scripts/gen4-accept-probe.mjs (design section 6, 10 steps, mouse, 1536x730 at 1.25),
      local PASS (step 9 pending gen4a), live control FAILS steps 2-8 and 10, one drawn run, the gates. Commits 505ebbc5 and
      9f5e3509 (gate fixes) and the commit that holds this line.
- Step 1 runs on Lublin 2f1ddf5f, not 5dfeb49b: on this tree planCourse is the gen4a S0 stub, and 5dfeb49b at x1 answers
  no room (evidence accept-5dfeb49b-stub.json: the no-room box came, steps 5-8 could not run). G1 (gates at x1 there) is
  gen4a's stage A3; the probe takes the scene as its third argument, so the merged train runs it on 5dfeb49b.

Differences from the design (the code wins):
- The editor's 'regen' branch lives in app/builtin/course.ts (this lane's file), so this lane routed it to the dialog itself.
- The store keys are prefs settings with status 'planned' (stored and validated, no settings row), so no catalogue change.
- Move to the start gate: the session has no public 'place the craft here' call (apps/fly/src/session/index.ts, not this
  lane's file; a spawn move is a replay-log record), so B2 shows the design's other branch for every course: the guide
  arrow and 'The start gate is N m away' for 8 s (or 'You are at the start gate').
- The progress step needs the key progress.step.analyse (progress.ts stepText builds progress.step.<key>), outside the
  course.gen.* prefix.

## What the owner does

1. In flight press Shift+G (or Esc, then 'Course: a new random course' in the pause menu). The flight pauses and the window
   'Generate a course' opens: three large buttons Beginner / Medium / Pro, a line with that level's numbers (gates, the
   opening in drone widths, the largest turn), two buttons Compact / Whole scene and a line on what that means.
2. With a course on the screen the window also says 'Replaces the current course (N gates)', and in the editor with
   unsaved changes 'Your unsaved changes are lost'. The main button then reads 'Replace with a new course'.
3. Press the main button or key Enter: the course is built. Cancel, the cross or key Esc: nothing changes.
4. In the voxels-only view the spread buttons are replaced by the line 'Voxels only view: gates over the whole scene,
   any scan quality, up to 40 gates'.
5. The choice is remembered for the next time.
6. After the yes a box under the top row says 'Building the course', the step in words ('finding the best scanned part',
   'finding the free space', 'placing the gates'), 'Step n of 3', a bar with the percent and 'About 0:15 left'; it stays
   until the course is there. Its Cancel button stops the build and says 'Nothing changed'.
7. When the course appears the line 'Gates: 9. The start gate is 45 m away: follow the arrow' stays 8 s, the arrow points
   at gate 1. The address bar holds a 'course=g2....' link that rebuilds the same level and spread.
8. When no gate fits: a box 'No gate your drone passes fits at Scene size x1.' with 'Make the scene x4 and build'
   (one press does both) or 'Try another layout', and Close.

## Claims

1. Shift+G, the pause menu item and the editor's G open the dialog and never build or replace at once; Enter builds,
   Esc cancels. Proof: `npx vitest run tools/bench/test/generate-dialog.test.ts` - 7 passed; NEG OK against origin/main.
2. The settings table holds the two new keys. Proof: `npx vitest run packages/prefs/test` - 247 passed.
3. The asked course's progress has the steps analyse, free, lay, never goes back, ends at 100 on the answer; its box stays
   through a 10 s silent worker (the old note hid after 2 ticks); Cancel, the no-room one-press box and the start line
   work; g1/g2 links parse. Proof: `npx vitest run tools/bench/test/course-progress.test.ts` - 20 passed; NEG OK against
   origin/main (progress.ts, progress-box.ts, four locales swapped).
4. Tests importing the changed page modules stay green: admin-tracks, sonic-scan-free, tracks-finish, tracks-fixes,
   tracks-review, generate-dialog - 46 passed. Typecheck apps/fly and tools/bench clean.
5. The pilot's mouse path works on a local release (render off): pointer lock by a click, Escape, the menu item opens the
   dialog (in view, cross 44x44, nothing built), Beginner + Compact + Build, the progress box (16 px, in view, percent
   0 -> 99 never back, 3 steps in words, there for every sample until the course), 17 gates closed, the start line
   'The start gate is 42 m away' 7.9-8 s, the dialog again says 'Replaces the current course (17 gates)', Cancel keeps it,
   Replace makes a new one, at 844x390 its 12 parts do not overlap, all in view, buttons >= 44 px. Proof:
   `node tools/bench/scripts/gen4-accept-probe.mjs http://localhost:5920/en out.json 2f1ddf5f 2f1ddf5f` - verdict pass,
   step 9 pending (evidence/2026-11-19/gen4b/accept-local.json; steps 1-6 again after the timing fix:
   accept-local-steps1-6.json).
6. The negative control of the whole lane: the same probe against the live site fails steps 2, 3, 4, 5, 6, 7, 8 and 10
   (the menu item built 19 gates at once with no question; a second press replaced the course with no question; no
   progress box, no start line, no plan). Proof: the command of claim 5 with https://gsfpv.flyreelstudio.eu/en and
   STEPS=8 - evidence/2026-11-19/gen4b/accept-live.json. Nothing was saved or sent there (no save button pressed).
7. The drawn run (GPU, steps 1-6): steps 1-5 PASS; step 6 read 7.3 s because the probe then measured from after its own
   screenshot; the measure now starts when the course appears (claim 5's steps 1-6 rerun: 7.9 s, PASS). Picture
   U:/Temp/gsfpv-train4/shots/gen4b-course-start.png: over the drawn Lublin old town the line 'Gates: 17. The start gate is
   44 m away: follow the arrow' sits at the top centre, 'Fly through START' under it with its cross, and the chip
   'START / FINISH 44 m' at the right edge; nothing lies over another thing.
8. The gates: typecheck, architecture, i18n, catalog, b18, leaks PASS; vitest first had 5 failures (four source-reading
   tests and the main chunk's closure, see For the lead), fixed; the vitest gate run again on the fixed tree. Proof:
   `gates.py --only vitest,b18` - B18 PASS; vitest 5328 passed, 0 tests failed, but two suites (rooms-open-vote,
   rooms-socket) stopped at 'rooms.py did not start' under the load of the other lanes; alone
   (`npx vitest run tools/bench/test/rooms-open-vote.test.ts tools/bench/test/rooms-socket.test.ts`) 8 passed, and they
   passed in the first gate run. This lane changed nothing of rooms.

## Not verified

- No person, phone or real controller took part; the browser was headless Chromium driven by the probe.
- Step 9 (Lublin underGround 0, nearGroundShare <= 0.2) and the meaning of step 5's 'outside 0': planCourse on this tree
  answers zero stats (gen4a S0 stub), so the probe reports step 9 as pending; it must be run on the merged train.
- 5dfeb49b at x1: the stub finds no room there (gen4a A3 repairs it); the page's no-room box came, its one press was not
  clicked by the probe.
- The voxels-only view's line and the editor's G route were checked by unit tests only, not by the page probe.
- The 844x390 check resized a desktop page; no touch phone was used.

## For the lead

Files changed outside the owned list:
- apps/fly/src/course/hook.ts: three optional fields (generateDialog, dialog, request) on CourseHook.
- packages/prefs/src/defs/course.ts and packages/prefs/test/defs.test.ts: settings course.level, course.spread (planned).
- Page probes that press Shift+G and expect a course at once now meet the dialog and must press Enter after it (or call
  `__gsfpv.course.adopt({seed})`): tools/bench/src/{editor3-*,rooms-board,sonic-*-page (only when not in the sound mode),
  tracks-page,train1-live,gate-place-audit}.ts, tools/bench/scripts/clock-place-probe.mjs and the others grep KeyG finds.
  The sound mode (?sonic=) still builds at once.
- Probes that read the HUD note for the progress line or 'course.ready' ('Gates: N. Fly through START') now meet the
  .gen-box (data-testid gen-progress, hook.box()) and the start line (hook.startLine): tools/bench/src/tracks-page.ts reads
  course.ready. The spoken lines (course.readySpoken, spokenLine) are unchanged.
- Needed from gen4a (contract only, nothing edited): planCourse's onStep estMs may be 0 (the page then uses the rates of
  progress.ts); fitSize > the current size is used for the no-room box's press.
Deploy order: page only.
Live checks to run after the deploy (read-only): `node tools/bench/scripts/gen4-accept-probe.mjs <site>/en out.json 5dfeb49b`
(all 10 steps PASS on the merged train with gen4a; step 9 then judged, not pending).
- packages/tracks/package.json: a subpath export './request' (src/request.ts, type imports only). apps/fly/src/course/link.ts
  imports parseCourseLink from '@gsfpv/tracks/request': through the package index it pulled @shramko/sonic-fpv
  (check.ts) into the main chunk and sonic-int-lazy.test.ts failed (NEG OK on that test against the previous link.ts).
- Four source-reading tests follow the new routing (the behaviour they guard is kept): editor3-flying.test.ts (the one
  'panel' pause is the Generate dialog's, never the editor's), sonic-in-place.test.ts (Shift+G goes through
  openGenerateDialog, whose 'direct' branch builds at once with pressSeed() in the sound mode), sonic-quiet-w3.test.ts
  (fail() says `spoken`), walls-first.test.ts (generate(seed, how)).
New probe (owned): tools/bench/scripts/gen4-accept-probe.mjs. Evidence: evidence/2026-11-19/gen4b/*.json.

## Cost notes

- B1: the most replies went to reading course.ts in slices and to the fake-DOM globals of the test (location, document);
  a note in agent-map that ui/dom.ts tests need location and document before import would save three runs.
- B2: the most replies went to wiring course.ts (six slices); neg_control.py on Windows needs `npx.cmd`, not `npx`; the
  fake DOM has no `firstElementChild` nor child selectors, so keep element references instead of querySelector.
- B3: the most replies went to two probe runs lost to the stub (5dfeb49b has no room before gen4a) and to hook.scale.size
  being a function; a line in agent-map listing which hook fields are functions, and which scenes the S0 stub can fill,
  would save two runs of five minutes.
