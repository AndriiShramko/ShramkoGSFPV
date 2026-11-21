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
- [ ] S4 the acceptance by mouse: tools/bench/scripts/n-save-accept.mjs on the local build + local API, and against the live site
  (must FAIL "Save as it is", read only); gates typecheck,vitest,architecture,i18n,b18,leaks; "What the owner should try".
  Done so far (commit 7cbf4e3b + the next): the probe exists; dist/ is built at 373cd684 with the walls copied in (no rebuild
  needed while only the probe changes). Run 4 (U:/Temp/gsfpv-train4/n-save/accept4.json, local, port 6902/6903): open, dialog
  (Warnings: 8, ids in order), asIs.saved (201, the API holds the places), showMe, fixAll (2 moved, 201, stored), fixAll.undo PASS.
  LEFT, exactly:
  1. build: "two gates on one spot" by mouse. A click on gate A's place cannot do it (course-line.ts legOnRay puts the new gate
     ON_LEG_END_M 2 m along the leg; with A alone its gizmo takes the click). pullOnto drags the third gate onto A with the gizmo
     arrows, but with ?render=off most drags miss the arrow and circle the view (accept4: 3 of 24 drags moved). Try: hover
     the arrow and wait for the hook's hover before mouse.down, or take the arrow's tip from the gizmo itself; else note it.
  2. asIs.reload / reload: openRow now presses Open twice when the first press only asks (unsaved draft); rerun to confirm.
  3. the live negative control: `node tools/bench/scripts/n-save-accept.mjs https://gsfpv.flyreelstudio.eu/en 70b50d42 <out>`
     (POSTs aborted, stops at the dialog; must FAIL asIs.saved).
  4. look once at U:/Temp/gsfpv-train4/shots/n-save-dialog.png and n-save-ghosts.png; evidence JSON under
     evidence/2026-11-20/n-save/; gates once; "What the owner does"; delete dist/ at the end.

Code against the design: the Save path of apps/fly/src/app/builtin/course.ts now sits at pointAtWrong :1023, refusedSave :1037,
applyFixes :1065, saveMine :1833, saveAdmin :~1885 (the design named :893-1754); the names are the same.

## What the owner does

(Written in S4.)

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
   one line with its way out; the words exist in en, es, pl, ru; the editor's message line is at least 16 px, wraps to three
   lines and has no ellipsis. Proof: `npx vitest run tools/bench/test/save-dialog.test.ts` (8 passed); NEG OK on 03624451.

## Not verified

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
