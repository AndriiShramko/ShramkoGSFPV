# Lane n-save (train 4, the owner's wish 1 of 2026-11-20): Save never refuses what a pilot may accept

Plan: C:/dev/.gsfpv-lanes/designs/t7-plan.md Part A wish 1 and table "Decision 6", Part B item 2, Part C 4, 5.
Base (OLD of every diff and negative control): 03624451b8deb79d179cc9a5d07adf22f1383773 (t7-base). Ports 6900-6919.
Temp: U:/Temp/gsfpv-train4/n-save. Evidence: evidence/2026-11-20/n-save/.

## Status

- [x] S1 the verdict: saveVerdict in packages/tracks/src/editor.ts (blockers mirror the server, warnings never block), canSave is
  `blockers.length === 0`; the near-grid rule (checkTrack `nearGridM`, wallsCheck passes NEAR_GRID_M 10 m; the generator's calls
  stay strict); tests packages/tracks/test/save-verdict.test.ts + tools/bench/test/save-verdict-api.test.ts (local apps/api round
  trip on port 6901); NEG OK on the base. Commit c2fef1f1.
- [ ] S2 fixAll (packages/tracks/src/autofix.ts, pure): every offending gate the shortest way to a valid place, order kept,
  leftovers named; tests on the scan worlds (gate in a wall, two on one spot, under the ground) + NEG; fixes.ts proposeFixes
  delegates to it for one selected warning.
- [ ] S3 the dialog and the line: `save-warnings` with `save-fix-all`, `save-as-is`, `save-show-me`; `save-fixed` + `save-undo`;
  ghosts (flash.ts); blockers one plain line; the editor's message line at least 16 px, wraps to 3 lines, never "..."; fake-DOM
  tests + NEG; repair the Save steps of the edit4b and edit-mouse probes.
- [ ] S4 the acceptance by mouse: tools/bench/scripts/n-save-accept.mjs on the local build + local API, and against the live site
  (must FAIL "Save as it is", read only); gates typecheck,vitest,architecture,i18n,b18,leaks; "What the owner should try".

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

## Not verified

- No person, phone or real controller took part in any check of this lane.
- 'name-refused' in saveVerdict uses the same rule as the server (textIssues of server.ts, which tracks.py mirrors); the page
  passes the typed name only from S3 on.

## For the lead

- Files changed outside the owned list: packages/tracks/test/editor.test.ts and fit.test.ts (two assertions that said "a
  problem blocks saving": they now say Save is allowed while the problems stay).
- Deploy order: page only (no API file changed so far).

## Cost notes

- S1: most replies went to finding how the earlier lane ran the API in a test (it used a Python unittest; a spawn of
  apps/api/server.py with PORT and DATA_DIR was simpler). A pointer to that recipe in docs/agent-map.md would save four replies.
