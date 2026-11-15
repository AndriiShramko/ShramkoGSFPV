# Lane laptop3 (train 3, wave 2): taking in the laptop hand-off

Worktree `C:/dev/gsfpv-site-sound`, branch `laptop3` from origin/main 1de775ed. Ports 5740-5759.

## Status

Stage P1-take-in
- [x] 1. Squash of origin/laptop-handoff (6c859e96) onto origin/main 1de775ed, one commit; lockfile unchanged
- [x] 2. All gates (gates.py exit 0) and a6-reference (on 6ddf601d; this commit records them)
- [x] 3. docs/decisions.md D91: second exception to "public engine API only" in render-pc (this commit)
- [x] 4. Second review of packages/render-pc/src/view-lod.ts and its wiring; one fix with test and negative control (this commit)

Stage P2-measure-here
- [x] 1. Release build of ebcee4ad (dist sha256 f62b80e5...), served by serve-csp on port 5740
- [~] 2. The laptop's probes on this PC (runner U:/Temp/gsfpv-train3/laptop3/run-p2.sh, logs beside it): Lublin and
  Wroclaw at 0.5 M and 1 M, rule on and `&viewlod=0`, and a 16 M reference; scores by lod-view-score.mjs
- [ ] 3. Table next to the laptop's numbers, pictures in U:/Temp/gsfpv-train3/shots, what a person sees in each pair

## Facts (measured)

- The squashed tree has no other program's name: `git grep --cached -i "DJI|otherRows"` finds only this project's own
  lane names in docs/wip/gpu-select.md (gsfpv-dji, app-dji-rc2) and byte matches inside JPEGs; the `.exe` names in the
  evidence are chrome.exe, msedge.exe and firefox.exe only.

- Review fix, view-lod.ts: after a streamed scan was gone (a single-file scan flown next, or the gap of a scan change)
  the wrapper stayed on the engine's class, nothing chose through it, so the axis of the last choice never moved and a
  turned view asked the engine for a full update on every frame: the new test turns the view 20 frames 60 ms apart and
  the old code asked 20 times (`expected 20 to be +0`), the new code 0. view-lod.test.ts 34 of 34 pass; negative control
  NEG OK (neg_control.py, old view-lod.ts from HEAD 32160aae); render-pc typecheck exit 0.

- Gates (gates.py, 2026-11-15): first run FAIL typecheck and vitest (bench: `motorChoice` not in SonicPrefs,
  `scanFreeLesson is not a function`, 13 failures in 6 sonic-* files) because the worktree's submodule
  packages/sonic-fpv was checked out at 378cc50d, left by the merged sound lane, not at the pinned 598a98f9.
  After `git submodule update packages/sonic-fpv`: typecheck PASS, vitest PASS (324 files passed, 1 skipped;
  4807 tests passed, 14 skipped, 0 failed); api-unittest, architecture, i18n, catalog, B18 PASS in the first run
  (logs U:/Temp/gsfpv-gates-20261115-025028 and -025755). a6-reference.test.ts 1 of 1 pass (hash unchanged).

## Decisions

- D91 numbered after main's last D90; renumber at the merge if another lane took D91.
- `active` now also needs a streamed scan present, so on a single-file scan the renderer sets the engine's own rule
  (no effect on a scan without an octree) and `lod().view.active` is false there, as the hand-off's check expects for
  the off case only on streamed scans.

## For the lead

Review of view-lod.ts and its wiring (renderer.ts onViewLod, flight.ts `?viewlod`, app/lod.ts):
- Engine without the members: install() fails on viewLodMissing every frame (a cheap walk), `missing` names them, active
  stays false, the renderer keeps ENGINE_RULE. Read, and held by the existing unit test; no browser run on another engine.
- Scan not streamed: no octree instance, install() false, engine rule. After a streamed scan it was active with stale
  state and asked every frame: fixed (above).
- Scan change in flight: same engine class, the wrapper stays; the gap now resets the turn state; the new scan gets
  multiplier 2 when active flips back (onViewLod calls applyLodMultiplier). The pass at load (loadSplat line ~526) uses
  the last active value, corrected the next frame.
- Fly by Sound with rendering off: no frame drawn means no 'framerender', so tick never runs and nothing is asked; read
  only, no run.
- Room with a second drone: other drones are entities, the page has one camera (`addComponent('camera'` only in
  renderer.ts and the separate drones3d studio app, which has no splats), so the frame and the look-ahead are the one
  camera's. Note for VR or a second view: `after()` takes the engine's camera node but the look-ahead and the stored
  axis come from the renderer's own camera; a second camera drawing the same scan would mix them.
- Two SplatRenderers on one page would take the class-wide wrapper from each other every frame (ownership moves in
  install()); there is one (createRenderer, renderer.ts:373). Not changed.

## Not verified

- No browser run in this stage (the stage asked for none): the review fix is held by the unit test only; the
  hand-off's live checks (`lod().view` active and calls growing on Lublin and Wroclaw, `&viewlod=0`) were not run on a
  local release.
- Fly by Sound with rendering off and the second-drone case: by reading the code, not by a run.
- The gates' api-unittest, architecture, i18n, catalog and B18 ran once, while the review fix was being written; B18
  and architecture ran after it was in place (by the run's timing), the other three do not read the files it changed.

## Cost notes

- P1: the most turns went to the first gates run failing on a stale submodule checkout in a reused worktree; checking
  `git submodule status` right after creating the branch would have saved a gates run.
