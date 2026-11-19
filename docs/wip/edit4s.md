# Lane edit4s (train 4): saving the course (E6 E7 E9)

Design: C:/dev/.gsfpv-lanes/designs/edit4.md section 4 (edit4s). Owner's words: brief lines 543-544, 549-550, 559-560.

## Status

- [x] S1 drafts: drafts.ts, parts/keep.ts (draft half), panel.ts (Versions), locales fly/course-save, edit4s-drafts.test.ts, NEG
  (commit: the one that ticks this box; its id is written by S2)
- [ ] S2 save flow: fixes.ts, save-words.ts, store.ts (SaveProblem), parts/keep.ts, server.py, tracks.py, tests, E9 experiment, NEG
- [ ] S3 acceptance: tools/bench/scripts/edit4s-probe.mjs (mouse, 1536x730 dsf 1.25, local api), live negative control, gates

Design versus code (the code wins):
- Stage S0 (the seam: course/editor/seam.ts, parts.ts loader, Course menu) is NOT in this branch (origin/main e3201fec has no
  seam). This lane builds its side against the contract: parts/keep.ts exports a named class with the methods the seam
  events map onto one to one, and course.ts calls it at the few points listed under 'For the lead'.
- The seam's EditAction 'replace' (S0, packages/tracks/src/editor.ts) does not exist: drafts.ts restoredState() does the
  same one undo step on EditorState.
- Going back to a version does not ask confirmLoss (B's dialog is not here): the course as it stands is written as a draft
  first ('restore') and the step is one undo step, so nothing is lost without a way back.
- panel.ts reveal() keeps its literal signature (editor3-fixes.test.ts reads the source); Versions has revealVersions().

## What the owner does

(filled at S3)

## Claims

1. (S1) A change in the course editor is kept as a draft in this browser 2 s later, at once before Generate / opening
   another course and when the page hides or the editor closes; 10 per scene, newest first, one a minute per kind of change,
   3 scenes; a full storage drops the oldest and says once that drafts are not kept. On open the newest unsaved draft newer
   than the opened course comes back as one undo step and the line says its time; Versions lists them with a way back.
   Proof: `npx vitest run tools/bench/test/edit4s-drafts.test.ts` -> 11 passed. NEG: neg_control.py --ref origin/main
   --files drafts.ts parts/keep.ts builtin/course.ts -> NEG OK. Also editfix-e2, editor3-fixes, fly-parity: 39 passed;
   `pnpm --filter @gsfpv/fly typecheck`: 0 errors.

## Not verified

No person, phone or real controller took part in any check of this lane.

## For the lead

Files changed outside the owned files (because S0 is missing): see per stage below.

S1: apps/fly/src/app/builtin/course.ts (S0's file): imports DraftKeeper and restoredState; `keeper`, `keepHook`,
`markChanged(by)` (replaces the three `edChanged = true` of add, drag and key edits); `trackNow()` (showEd's identity rule
lifted out, showEd uses it); openEdit creates the keeper and calls opened(); closeEdit disposes it first; regen and openRow
call beforeLoss before the course goes; saveMine and saveAdmin call saved(body); the panel host gets back(i);
__gsfpvEditView() gets `edit4: { s: keepHook }`. At the S0 merge these become seam listeners: opened -> keeper.opened,
changed -> keeper.changed(by), closed -> dispose, saved -> keeper.saved, a loss (B's confirmLoss yes) -> beforeLoss, and
Course > Versions -> panel.revealVersions(). parts/keep.ts has no `install(seam)` yet: S0's parts loader must skip a part
without it, or the lead adds install() at merge (seam wanted: on, hook('s'), replace(..., 'restore')).

## Cost notes
