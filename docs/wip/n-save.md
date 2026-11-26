# Lane n-save (train 4, the owner's wish 1 of 2026-11-20): Save never refuses what a pilot may accept

Plan: C:/dev/.gsfpv-lanes/designs/t7-plan.md Part A wish 1 and table "Decision 6", Part B item 2, Part C 4, 5.
Base (OLD of every diff and negative control): 03624451b8deb79d179cc9a5d07adf22f1383773 (t7-base). Ports 6900-6919.
Temp: U:/Temp/gsfpv-train4/n-save. Evidence: evidence/2026-11-20/n-save/.

## Status

- [x] S1 the verdict: saveVerdict in packages/tracks/src/editor.ts (blockers mirror the server, warnings never block), canSave is
  `blockers.length === 0`; the near-grid rule (checkTrack `nearGridM`, wallsCheck passes NEAR_GRID_M 10 m; the generator's calls
  stay strict); tests packages/tracks/test/save-verdict.test.ts + tools/bench/test/save-verdict-api.test.ts (local apps/api round
  trip on port 6901); NEG OK on the base. Commit c2fef1f1.
- [x] S2 fixAll: packages/tracks/src/autofix.ts (pure; the 26 ways of the cube at growing distances, each place judged by the
  proof on the gate before, the gate and the gate after; buried gates go straight up first; the later of two crowded gates
  moves; turned along the leg, between the legs within the level's tolerance); tests packages/tracks/test/autofix.test.ts (8)
  and tools/bench/test/save-fix-one.test.ts (2: fixes.ts proposeFixes is fixAll for one gate); NEG OK on the base for both. Commit 45ddad2d.
  n-route's route() is not merged in this tree (048629d is no ancestor), so the turn is along the leg.
- [x] S3 the dialog and the line: saveMine / saveAdmin take the verdict (course.ts verdictNow: the editor's problems plus
  autofix `courseWarnings`, now exported); a blocker is one plain line with its way out (save-words.ts blockerWords); warnings
  open the edit4s offer box turned into the Save dialog (panel.ts askSave: `save-warnings`, `save-fix-all`, `save-as-is`,
  `save-show-me`, the 44 px cross `save-warnings-close`); Fix all = fixAll as one undo step ('replace'), ghosts of the old
  places for GHOST_MS 5 s (flash.ts GateGhosts, an SVG layer), the line `save-fixed` with `save-undo` (the editor's undo of that
  step; no Undo when nothing moved), then the save; Show me = showWrong, else the first warned gate. The old refusedSave /
  applyFixes are gone (one flow). The message line: 16 px, line-height 1.25, max 3.75em, wraps, no ellipsis. Tests
  tools/bench/test/save-dialog.test.ts (8) NEG OK on the base. edit4b step 10 presses `save-show-me` by id; the edit-mouse
  probe never presses Save mine (its top-bar Save only opens the name field), so it does not meet the dialog. Commit d74ab9f9.
- [x] S4 the acceptance by mouse: tools/bench/scripts/n-save-accept.mjs on the local build + local API, and against the live site
  (must FAIL "Save as it is", read only); gates typecheck,vitest,architecture,i18n,b18,leaks; "What the owner should try".
  Done so far (commit 7cbf4e3b + the next): the probe exists; dist/ is rebuilt at 8bee6439 (the reopen fix) with the walls
  copied in (no rebuild needed while only the probe changes). Scan: 70b50d42 (39e63ce9 is too small: every gate in a wall). Run 4 (U:/Temp/gsfpv-train4/n-save/accept4.json, local, port 6902/6903): open, dialog
  (Warnings: 8, ids in order), asIs.saved (201, the API holds the places), showMe, fixAll (2 moved, 201, stored), fixAll.undo PASS.
  Run 7 found a dead end: a course saved as it is did not open again (course.ts 'checked': a stored course that fails the
  walls proof was never shown). Now a course the pilot names (a row's Open, a link) is shown with the line
  course.edit.saveOpenedWarned; test tools/bench/test/save-reopen.test.ts (2) NEG OK on 03624451. The probe presses the
  gizmo's arrows at their drawn tips (__gsfpvEditMeasure parts) and orbits with the middle button for the depth.
  Run 3 of S4 (commits 12fc7a4c..HEAD): the acceptance PASSES on the local build: accept11 (evidence/2026-11-20/n-save/
  accept-local.json): open, build, dialog, asIs.saved, asIs.reload, showMe, fixAll (2 moved, version 2 stored, 201),
  fixAll.undo, reload all PASS. The live site (accept-live.json, the code before this train) FAILS dialog and asIs.saved
  ("Before saving: gate 1 touches a wall ... Make these small corrections and save?"); it stopped before any save (only
  three /api/e analytics POSTs, aborted). Found on the way: the local proxy serve-csp.mjs dropped X-Track-Token, so every
  new version after a reload was 403 'token' only locally (nginx passes it); fixed (For the lead). 'Two gates on one spot'
  cannot be made by mouse: Add gate puts the new gate 2 m off the gate under the click and the arrow along the view takes
  no press, so the build is judged on a gate in a wall and 'same spot' is listed as not run (unit tests hold it). Reload
  after Fix all + Undo: the API holds the fixed course; the page brings back the pilot's later unsaved draft (the Undo) and
  says so with key Ctrl+Z (drafts.ts) - the probe accepts that or the saved places.
  Pictures looked at once: n-save-dialog.png shows the dialog in the editor's window (Warnings: 4, three kind lines, Fix all
  automatically / Save as it is / Show me, the cross); n-save-ghosts.png shows gates 1 and 2 moved with their old places
  dashed and the line "Gates moved to free places: 2 (gates 1, 2) ... Left as it is: A wall on the way to the gate" + Undo.
  Finished in run 4: the top bar over the HUD row is the bar's place, not the message rule (For the lead); the gates'
  first run failed architecture (autofix.ts used Math.sin/cos/acos/atan2/hypot, forbidden in tracks) and, in this shell
  only, vitest and leaks (no `python` on PATH): autofix now turns and measures by arithmetic and Math.sqrt (commit
  10cbebb4; autofix, save-fix-one, edit4s-fixes, save-dialog 27 passed); the second run on that tree, with Python and
  Node 22 on PATH: typecheck, vitest (5700+ passed), architecture, i18n, b18, leaks all PASS (B18 evidence in
  evidence/2026-11-20/n-save/b-repo-b18.json). Claims 7, 8 written; dist/ deleted.

Code against the design: the Save path of apps/fly/src/app/builtin/course.ts now sits at pointAtWrong :1023, refusedSave :1037,
applyFixes :1065, saveMine :1833, saveAdmin :~1885 (the design named :893-1754); the names are the same.

## What the owner does

(See "What the owner should try" at the end.)

## Claims

1. A gate in a wall, two gates on one spot and a gate 2 m past the scan's grid no longer stop Save: no blocker, warnings only;
   the gate 2 m past the grid is no problem at all for the editor (it was 'outside the scanned space'); the generator still
   refuses it. Proof: `npx vitest run packages/tracks/test/save-verdict.test.ts` (6 passed); NEG OK on 03624451.
2. The local API stores that course as it is and gives the same gates back. Proof:
   `N_SAVE_TMP=U:/Temp/gsfpv-train4/n-save npx vitest run tools/bench/test/save-verdict-api.test.ts` (1 passed); NEG OK.

3. Fix all moves a gate in a wall, a gate under the ground and the later of two gates on one spot the short way to a valid
   place, keeps the order, turns a gate along its leg, names a blocked start as left over. Proof:
   `npx vitest run packages/tracks/test/autofix.test.ts` (8 passed); NEG OK on 03624451.
4. The edit4s offer's turn and nudge are fixAll's repair of that one gate. Proof:
   `npx vitest run tools/bench/test/save-fix-one.test.ts tools/bench/test/edit4s-fixes.test.ts` (2 + 9 passed); NEG OK.
5. Save with a gate in a wall and two gates on one spot opens one dialog: the count, one line per kind with the gates from 1,
   the buttons save-fix-all, save-as-is, save-show-me in that order, each answering once; after Fix all the line save-fixed
   names the moved gates and save-undo runs once (none when nothing moved); the ghosts ring the old places; every blocker is
   one line with its way out; the words exist in en, es, pl, ru; the editor's message line is at least 16 px and wraps
   (at most two rows since fix-n-save, claim 9). Proof: `npx vitest run tools/bench/test/save-dialog.test.ts` (8 passed);
   NEG OK on 03624451.

6. A course saved as it is with warnings opens again from Courses (or a link): shown with its warnings and a line that Save
   fixes them; the newest course tried for the flight on its own still skips one that fails the walls. Proof:
   `npx vitest run tools/bench/test/save-reopen.test.ts` (2 passed); NEG OK on 03624451.

7. By mouse on the local build and the local API (1536x730, scale 1.25, pointer lock first, every target by its
   data-testid): a course with a gate in a wall opens the Save dialog; Save as it is stores it and a reload shows it as it
   was; Show me selects the first warned gate; Fix all moves 2 gates, stores version 2 and names them in `save-fixed`;
   `save-undo` gives them back; a reload shows the course saved. Proof: `node tools/bench/scripts/n-save-accept.mjs dist
   70b50d42 <out>` -> evidence/2026-11-20/n-save/accept-local.json, every step PASS.
8. The same probe against the live site (the code before this train) FAILS 'dialog' and 'Save as it is' (the old answer
   "Before saving: gate 1 touches a wall ... Make these small corrections and save?") and stops before any save. Proof:
   evidence/2026-11-20/n-save/accept-live.json (dialog false, asIs.saved false; no track POST).
9. fix-n-save: every page button of the top row (Motor sound, Full screen, Messages, Share) takes a mouse press at its
   centre whatever line the editor's bar shows: at 1536x730 scale 1.25, 1366x768 scale 1 and 844x390 scale 2, with the
   default line ("Editor open. Every key is under Keys."), the longest save warning and no line, `elementFromPoint` at
   each centre gives that button (9 of 9). The line keeps 16 px and takes at most two rows; a longer text ends with an
   ellipsis and goes whole into the Messages list. Proof: `npx vitest run tools/bench/test/n-save-top-row.test.ts` (8
   passed; NEG OK on 511f9594, 5 of 8 fail there) and `MEASURE_TOP=1 node tools/bench/scripts/n-save-accept.mjs dist
   70b50d42 <out>` on a build of 3d58873e -> evidence/2026-11-20/n-save/fix-top-row-head.json (the check's run on the
   build of 511f9594: review-top-row-head.json, the bar to y 78 and the centres covered). The lane's acceptance on that
   build passes every step: fix-accept-local.json.
10. fix-n-save: the editor's bar and the editor's window still do not lie over each other: the edit4a probe's 15 steps
   pass on the same build, drawn, 1536x730 scale 1.25 (step 13 at 844x390 scale 2: `over` [], `outside` []). Proof:
   evidence/2026-11-20/n-save/fix-edit4a-local-run2.json. The repo's probe cannot be run as it is since gen4b (see For
   the lead); the run used a temp copy whose only change is Enter in the Generate dialog after Shift+G.

## Not verified

- The mouse acceptance (claims 7, 8) ran on the build of 8bee6439, before autofix's arithmetic turn (10cbebb4); the
  arithmetic gives the same turn to 1e-6 (the unit tests above pass unchanged), but the browser run was not repeated.
- 'Two gates on one spot' by mouse: Add gate keeps 2 m from the gate under the click, so the mouse acceptance builds a gate
  in a wall only; two on one spot is held by the unit tests (claims 1, 3, 5).

- No person, phone or real controller took part in any check of this lane.
- 'name-refused' in saveVerdict uses the same rule as the server (textIssues of server.ts, which tracks.py mirrors); the page
  passes the typed name and title to it since S3.
- S3 was not run in a browser: the dialog, the ghosts and the line are proved on a fake DOM; S4's mouse acceptance runs it.
- 'sharp-turn' is not in the dialog yet: autofix courseWarnings does not measure it (lane n-level measures it by level).

## For the lead

- Files changed outside the owned list: packages/tracks/test/editor.test.ts and fit.test.ts (two assertions that said "a
  problem blocks saving": they now say Save is allowed while the problems stay).
- S2: packages/tracks/src/index.ts exports autofix.ts (one line); apps/fly/src/course/editor/warn.ts CLOSE_GAP_M is now
  tracks' APART_GAP_M (same 0.2 m).
- S3: tools/bench/test/editor3-i2.test.ts (the line was asserted one line with an ellipsis; Decision 6 reverses it),
  tools/bench/test/edit4s-fixes.test.ts (the page test of the old offer now asserts the Save dialog) and
  tools/bench/test/edit4b-numbers.test.ts (its slice ended at the removed refusedSave; now at fixWalls). course.ts markChanged
  (outside the named Save functions, one line: a change takes the dialog and the fixed line away, as it took the offer away).
- S3, probes not mine that meet the dialog: tools/bench/scripts/gap-save-accept.mjs presses `.ce-fix-yes` (now Fix all
  automatically, which also saves: the same outcome) and tools/bench/scripts/edit4s-probe.mjs reads the old offer
  (`.ce-fix-offer`, fixHook offered/answer 'yes'); its offer step needs `save-fix-all` and the new fixHook
  `{ kinds, answer, moved, left, undone }`.
- S4: apps/fly/src/app/builtin/course.ts, the worker's 'checked' answer (outside the named Save functions): a named course
  (a row's Open, a link) that fails the walls proof is shown with course.edit.saveOpenedWarned instead of refused; without
  it Save as it is was a dead end (the course never opened again). Lane n-level and anyone touching loadServer: keep it.
- S4: tools/bench/scripts/serve-csp.mjs passes X-Track-Token to the local API (as nginx does); before, a course's new
  version after a reload was refused 403 'token' in every local probe.
- S4, not fixed (the bar's place is not mine): at 1536x730 (scale 1.25) the editor's top bar, centred at top 8 px, reaches
  from about x 312 to 1224 CSS px; its message line (x 808-1224, a fixed 420 px since editfix E4.2, the same on the base)
  lies over the page's top row (sound, fullscreen, mail, Share, settings), which starts at about x 968 and y 38. On the base
  the one-line bar already covers that row's top 5-10 px; the 16 px message wrapped to two lines (n-save-ghosts.png) covers
  about 15-20 px. No width of the message alone can clear it (the buttons alone end at x 798, the centred bar cannot end
  left of x 968 with a 420 px line). The fix belongs to the bar's place (.ce-topbar / top-bar.ts place()): on a wide view,
  when the bar's rect meets the top row, put the bar under --top-row-bottom as the narrow-view rule already does.
  Superseded by fix-n-save (below): the bar's place was not needed.
- fix-n-save, the way taken: (c), the first of the lead's list. The default line is one short sentence that names the
  Keys button ("Editor open. Every key is under Keys.", course.edit.opened in en, es, pl, ru) and every line is at most two rows (line-clamp 2, 16 px
  kept); a cut text that is no refusal goes whole into the Messages list (top-bar.ts setLine -> host.cut, course.ts passes
  it to tell). Two rows end the bar at y 58 CSS px at 1536x730 scale 1.25, above the top row's centres (y 60), so (b) and
  (a) were not needed and the bar's place is unchanged (rule 2 holds by construction; the edit4a probe confirms it). Doubt
  3 done: course.edit.saveFix says "Not saved yet. {fix}". Doubt 2 left as told. Files outside the owned list:
  tools/bench/test/editor3-g2.test.ts (it asserted the old default line's key list).
- The top row's centres are reached with 2 px to spare (y 58 vs 60) on the wide view; a third row, a larger font or a
  taller row would cover them again. tools/bench/test/n-save-top-row.test.ts holds the two-row rule.
- fix-n-save, not mine: tools/bench/scripts/edit4a-probe.mjs fails 'no course' on the base (511f9594) and on every build
  since gen4b 3fde6ad6: Shift+G opens the Generate a course dialog, which the probe never presses. Rule 2 was proved with
  a temp copy (U:/Temp/gsfpv-train4/n-save/make-edit4a-copy.mjs: Enter in the dialog, no step changed). Its first run
  failed only step 13's "click another gate" part (a 10-gate course left no gate 125 px inside the 844x390 window;
  `over` [] and `outside` [] held), kept as fix-edit4a-local.json; the second (13 gates) passed every step. The probe's
  owner should press `gen-dialog`'s build after Shift+G and pick step 13's gate after a wider frame.
- Deploy order: page only (no API file changed so far).

## Cost notes

- S1: most replies went to finding how the earlier lane ran the API in a test (it used a Python unittest; a spawn of
  apps/api/server.py with PORT and DATA_DIR was simpler). A pointer to that recipe in docs/agent-map.md would save four replies.
- S2: most replies went to test fixtures (a reversed gate within 3 m is a turn round, the yaw table is 22.5 degrees per
  step); a note on yawQuatStep and TURN_PAIR_M in the scan-worlds header would save three replies.
- S3: most replies went to finding the old offer's users (three tests and two probes assert its code by regex) and the fake
  DOM's limits (no childElementCount); a list of source-regex tests per file in docs/agent-map.md would save four replies.
- S4 (run 1): most replies went to building a bad course by mouse (the add rules: legOnRay, the gizmo over the selected gate,
  flaky gizmo drags with render=off); a probe helper "drag the selected gate's arrow by N m" shared by the editor probes would
  save ten replies.
- S4 (run 2): most replies went to the gizmo pull (the arrows' press bands, the editor refusing a drag into a wall, the depth axis hidden) and to finding why a saved course did not reopen; a shared probe helper 'move the selected gate to X by its arrows' would save ten replies.
- S4 (run 3): most replies went to two probe-harness causes (the local proxy dropping X-Track-Token, Add gate keeping 2 m between gates); logging each refused POST's body and the element under each press from the start would have saved five replies.
- S4 (run 4): most replies went to the gates' environment (this shell has Node 20 and no `python` on PATH; vitest's API
  tests and leaks need Python 3.11, vitest needs Node 22) and to the tracks rule forbidding trig in autofix.ts; running
  `scripts/check-architecture.mjs` after S2 and a PATH line in train4-common.md would have saved six replies.
- Review: most turns went to a build that ran while neg_control.py had swapped files to the base (the bundle held the old
  panel); run negative controls only after the build finishes, never in parallel with it.

## What the owner should try

1. Open the editor on a scan, add three gates and pull one into a wall; press Save mine: one dialog shows "Warnings: N" with
   one line per kind and three buttons.
2. Press "Save as it is": the course is stored with the gate in the wall; reload the page and open it from Courses: it is there.
3. Save again and press "Fix all automatically": the moved gates show their old places dashed for 5 s, the line says how
   many moved; press Undo there and every gate goes back.
4. Press "Show me": the first warned gate is selected for moving by hand.

## Review

Verdict: HOLD (independent check of 511f9594; the full review is U:/Temp/gsfpv-train4/reviews/n-save.md).
- PROVEN, holds: at 1536x730 (scale 1.25), when the editor opens, its 3-line 16 px message makes the top bar end at y 78
  CSS px. It covers 40 of the 44 px of the page's Motor sound, Full screen, Messages and Share buttons, and a click at
  their centre lands on the bar. The live site covers 10 px and every centre is reachable. Evidence:
  evidence/2026-11-20/n-save/review-top-row-head.json and review-top-row-live.json (n-save-accept.mjs MEASURE_TOP=1). The
  fix is the bar's place (top-bar.ts place(), For the lead S4), not the message rule.
- Holding: saveVerdict mirrors tracks.py validate_track and _bounds; NEG OK on the base for save-verdict and save-dialog;
  27 lane tests pass. The mouse acceptance on a build of 511f9594 passes every step, plus the review's own step
  own.handAfterFix (Fix all, then a moved gate dragged by hand: Undo is gone, key Ctrl+Z twice gives every gate back).
  Evidence: evidence/2026-11-20/n-save/review-accept-local.json.
- DOUBT: after a hand edit the fixed line and its Undo go without saying key Ctrl+Z; Show me ends on the words "Not saved. ...".

## Repair after the check

Lane fix-n-save: the check's finding 1 (the top bar over the top-row buttons) and doubt 3 (Show me's words). Doubt 2 is
left as the lead said. The way taken: (c), the first of the lead's list that meets rules 1 to 3.

### Status

- [x] R1.1 the default line one short sentence naming the Keys button (en, es, pl, ru); the line at most two rows, a
  longer text ends with an ellipsis and a cut line that is no refusal goes whole to the Messages list (top-bar.ts
  setLine, host.cut; course.ts passes it to tell); doubt 3: course.edit.saveFix "Not saved yet. {fix}" in the four
  files; tests n-save-top-row (8), save-dialog and editor3-g2 updated; NEG OK on 511f9594 (5 of 8 fail there)
- [x] R1.2 build of 3d58873e; MEASURE_TOP=1 n-save-accept on it: 9 of 9 (three views x three lines) every top-row
  centre reaches its button (evidence fix-top-row-head.json; the bar ends at y 48 with one row, y 58 with two; on 844x390
  the line is hidden as before); the lane's acceptance passes every step (fix-accept-local.json)
- [x] R1.3a edit4a-probe on the build of 3d58873e, drawn: run 2 passes every step (claim 10; the repo probe needs the
  Generate dialog pressed since gen4b, For the lead); Claims 9, 10 and For the lead written
- [ ] R1.3b gates once
