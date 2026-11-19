# Lane edit4s (train 4): saving the course (E6 E7 E9)

Design: C:/dev/.gsfpv-lanes/designs/edit4.md section 4 (edit4s). Owner's words: brief lines 543-544, 549-550, 559-560.

## Status

- [x] S1 drafts: drafts.ts, parts/keep.ts (draft half), panel.ts (Versions), locales fly/course-save, edit4s-drafts.test.ts, NEG
  (commit 544a1fd8)
- [x] S2 save flow: fixes.ts, save-words.ts, store.ts (SaveProblem), parts/keep.ts, server.py, tracks.py, tests, E9 experiment, NEG
  - [x] E9 experiment (tools/bench/src/edit4s-e9.ts, evidence/2026-11-19/edit4s/e9-experiment.json) (commit b5f7543d)
  - [x] server.py: refused creates give their hit back (own count 60/h), every tracks 429 has Retry-After; tracks.py
    creates 10 -> 20; test_tracks.py 3 new tests, NEG (commit b5f7543d)
  - [x] store.ts SaveProblem, save-words.ts, panel.ts live name/title check + Save again, keeper.saveFailed(), course.ts
    saveFailed() for saveMine, save, saveAll, saveAdmin; locales; edit4s-save.test.ts, NEG (commit 60971821)
  - [x] E7 corrections offer: fixes.ts proposeFixes (face-line, nudge, lift; window-checked) + confirmFixes (the whole
    check, at most 3 rounds), the offer in the window on refusedSave ([Correct and save] / [Correct] [Show me] and a 44 px
    cross), overview (courseOverview) then one undo step (restoredState), the change list line, then the save;
    edit4s-fixes.test.ts 8 tests, NEG (commits 6e53e61f, 49b200c7)
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
- E9 cause (S2): on 70b50d42 seeds 1-3 an untouched generated course with the name 'Andrii Shramko' passes both the
  page's check and tracks.py, so candidates (b) and (c) were not seen there; seeds 4-50 and 887f27aa not run (3 min a seed,
  no 887f27aa voxel json here). The cause repaired is (a) plus the hidden reason. The page's 'failed' words now live in
  fly/course-save (course.save.problem.*), not in fly/course 'course.save.failed' (that key is no longer used by course.ts).
- An emptied title field no longer fails the save: saveMine keeps the course's own title, as saveAdmin did.
- E7: course-line.ts courseFacing does not exist: face-line turns the gate about the vertical to the bisector of its legs
  (then the leg in), kept when the axis is within AXIS_TOLERANCE_DEG of the leg in. Fix poses are in the course frame
  (TrackGate pos and quat), not FlownPose. A (edit4a) frameAll is not here: fixes.ts courseOverview is the overview (the
  lead replaces it by A's frameAll at merge). B's confirmLoss dialog is not here: the offer lives in the window's flow.
- E7: each candidate is checked on a short course around the changed gates (milliseconds); the whole course's check
  (checkOnPage, seconds on a big scan, on the page thread) runs once, at most 3 times when it drops a fix; the line says
  'Checking the course for small corrections...' before it. A partial set of fixes says Correct (no save) and then points
  at what is left with its words.

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
2. (S2) A create the server refuses (4xx) no longer uses up the creates of the hour (it counts in its own 60 an hour),
   20 creates an hour instead of 10, and every tracks 429 carries Retry-After. Proof: `cd apps/api && python -X utf8 -m
   unittest tests.test_tracks tests.test_tracks_edit tests.test_tracks_fixes tests.test_nginx_tracks` -> 54 OK. NEG:
   neg_control.py --files apps/api/server.py apps/api/tracks.py -- unittest test_tracks.py -> NEG OK (on the old server
   the Http class errors at once: it has no _trbad count; the 429 and Retry-After asserts are not reached).
3. (S2) A failed save says what happened, that the course is kept (a draft is written now, even for an untouched course)
   and what to do: 429 -> the time to save again and a Save again button enabled then; no connection -> Save again;
   a wrong name or title -> the field outlined with its rule, checked while typing; a leg over 60 m -> the gate selected
   and 'add a gate between gate a and gate b'; 5xx/507 -> again in a minute and the Feedback button. Proof:
   `npx vitest run tools/bench/test/edit4s-save.test.ts` -> 9 passed. NEG: neg_control.py --files
   apps/fly/src/course/store.ts -> NEG OK (the old store answered a bare string). `npx vitest run --changed origin/main`
   -> 92 files, 934 passed; fly and tracks typecheck clean.
4. (S2) A Save the check refuses first looks for small corrections and asks in the editor's window: 'Before saving: gate
   3 faces the wrong way. Make these small corrections and save?' [Correct and save] [Show me] and a 44 px cross. Yes ->
   the view pulls back to see the whole course, the gates change in front of the pilot as ONE undo step (key Ctrl+Z),
   the line lists 'gate 3 turned 172 deg', then the save is made. A gate turned 180 deg is faced along the line, a gate
   pushed into a wall moves away up to 1 m, a leg into a wall has its gates lifted up to 1 m; a fix the whole check finds
   a new problem beside is dropped. Proof: `npx vitest run tools/bench/test/edit4s-fixes.test.ts` -> 8 passed. NEG:
   neg_control.py --files fixes.ts panel.ts builtin/course.ts keep.css -> NEG OK. `npx vitest run --changed HEAD~2`
   -> 38 files, 477 passed; `pnpm --filter @gsfpv/fly typecheck` clean.

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

S2: apps/fly/src/app/builtin/course.ts (S0's file): saveFailed() (one path for saveMine, save, saveAll, saveAdmin
failures), saveHook in __gsfpvEditView().edit4.s.save, lastSaveProblem, saveMine keeps the course's title when the field is
emptied; packages/tracks/src/server.ts: NAME_LEN, NAME_EXTRA, TITLE_LEN, TITLE_EXTRA exported (no rule changed).
S2 (E7): apps/fly/src/app/builtin/course.ts: refusedSave(retry) is async and offers the fixes (pointAtWrong is the old
refusal), applyFixes(), fixHook in __gsfpvEditView().edit4.s.fix, viewTanHalfV() lifted out of frameSel, markChanged
takes the offer away on any other change. At the S0 merge: saveRefused -> refusedSave, seam.replace(fixed, 'fix') in
place of restoredState, A's frameAll in place of courseOverview.
Deploy order for S2: apps/api/server.py and apps/api/tracks.py (the API restart) before the page; the page alone still
works with the old API (no Retry-After: the words name the hour's end). nginx: test_nginx_tracks.py passes, Retry-After
is not hidden by the tracks location.

## Cost notes

- S1: the most replies went to finding that S0 (the seam) was never built and reading course.ts's save and change sites;
  a ready seam (or a design that names its absence) would have saved about 8 replies. neg_control needs `npx.cmd`, not `npx`.
  Tests that import apps/fly i18n need `vi.mock` of it (location is undefined in Node).
- S2 (first run): the E9 Node experiment cost 9 minutes for 3 seeds (fitCourse about 3 min a seed), so 50 seeds were not
  affordable; a ready cache of fitted courses per scene would make it seconds. Reading course.ts's save sites took ~6 replies.
- S2 (second run, E7): most replies went to finding the check's geometry (checkTrack gate axis, edit() frames) because the
  design named course-line.ts courseFacing, which does not exist; a design that cites checkTrack's axis rule would save ~4.
