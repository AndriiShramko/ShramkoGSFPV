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
      (+5 tests, 20 passed, NEG OK). Commit: see git log 'gen4b B2'.
- [ ] B3 acceptance: tools/bench/scripts/gen4-accept-probe.mjs (design section 6), the live negative control, the gates.

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

## Not verified

- No person, phone or real controller took part. The dialog was not yet seen in a browser (B3 probe).

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

## Cost notes

- B1: the most replies went to reading course.ts in slices and to the fake-DOM globals of the test (location, document);
  a note in agent-map that ui/dom.ts tests need location and document before import would save three runs.
- B2: the most replies went to wiring course.ts (six slices); neg_control.py on Windows needs `npx.cmd`, not `npx`; the
  fake DOM has no `firstElementChild` nor child selectors, so keep element references instead of querySelector.
