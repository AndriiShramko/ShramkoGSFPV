# Lane gen4b (train 4): the generator's options, the Generate dialog, the progress

Design: C:/dev/.gsfpv-lanes/designs/gen4.md, part gen4b (apps/fly only). Owner's words: brief lines 555-556, 563-566.
The contract (packages/tracks/src/request.ts) came from gen4a S0 (b142e495), merged into this branch.

## Status

- [x] B1 dialog: course/generate-dialog.ts (dialogModel, pressAction, dialogKey, GenerateDialog), course.ts routes Shift+G,
      the pause menu item, the editor's G and hook.generateDialog through it; store keys course.level, course.spread;
      locales course.gen.* in en, es, pl, ru; generate-dialog.test.ts (7 tests, NEG OK). Commit: see git log "gen4b B1".
- [ ] B2 worker and progress: worker.ts calls planCourse with the request; progress step 'analyse'; progress-box.ts (16 px,
      bar, step, %, time left, Cancel 44 px); link.ts g2 via parseCourseLink; move to the start gate; the no-room box with
      'Make the scene xN and build'. course-progress.test.ts: steps analyse/free/lay, share never goes back, 100 on answer;
      NEG: the old hud.flash line hides after 2 ticks.
- [ ] B3 acceptance: tools/bench/scripts/gen4-accept-probe.mjs (design section 6), the live negative control, the gates.

Differences from the design (the code wins):
- The editor's 'regen' branch lives in app/builtin/course.ts (this lane's file), so this lane routed it to the dialog itself.
- The store keys are prefs settings with status 'planned' (stored and validated, no settings row), so no catalogue change.

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

## Claims

1. Shift+G, the pause menu item and the editor's G open the dialog and never build or replace at once; Enter builds,
   Esc cancels. Proof: `npx vitest run tools/bench/test/generate-dialog.test.ts` - 7 passed; NEG OK against origin/main.
2. The settings table holds the two new keys. Proof: `npx vitest run packages/prefs/test` - 247 passed.

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
Deploy order: page only.

## Cost notes

- B1: the most replies went to reading course.ts in slices and to the fake-DOM globals of the test (location, document);
  a note in agent-map that ui/dom.ts tests need location and document before import would save three runs.
