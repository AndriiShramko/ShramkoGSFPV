# Lane laptop3 (train 3, wave 2): taking in the laptop hand-off

Worktree `C:/dev/gsfpv-site-sound`, branch `laptop3` from origin/main 1de775ed. Ports 5740-5759.

## Status

Stage P1-take-in
- [x] 1. Squash of origin/laptop-handoff (6c859e96) onto origin/main 1de775ed, one commit; lockfile unchanged
- [ ] 2. All gates (gates.py exit 0) and a6-reference
- [x] 3. docs/decisions.md D91: second exception to "public engine API only" in render-pc (this commit)
- [x] 4. Second review of packages/render-pc/src/view-lod.ts and its wiring; one fix with test and negative control (this commit)

## Facts (measured)

- The squashed tree has no other program's name: `git grep --cached -i "DJI|otherRows"` finds only this project's own
  lane names in docs/wip/gpu-select.md (gsfpv-dji, app-dji-rc2) and byte matches inside JPEGs; the `.exe` names in the
  evidence are chrome.exe, msedge.exe and firefox.exe only.

- Review fix, view-lod.ts: after a streamed scan was gone (a single-file scan flown next, or the gap of a scan change)
  the wrapper stayed on the engine's class, nothing chose through it, so the axis of the last choice never moved and a
  turned view asked the engine for a full update on every frame: the new test turns the view 20 frames 60 ms apart and
  the old code asked 20 times (`expected 20 to be +0`), the new code 0. view-lod.test.ts 34 of 34 pass; negative control
  NEG OK (neg_control.py, old view-lod.ts from HEAD 32160aae); render-pc typecheck exit 0.

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

## Cost notes
