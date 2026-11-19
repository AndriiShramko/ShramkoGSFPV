# Lane edit4a (train 4): the course editor's interaction (E1 E2 E3)

Design: C:/dev/.gsfpv-lanes/designs/edit4.md, section 2 (part A). Owner's words: brief lines 543-548.
Work copy C:/dev/gsfpv-loadq, branch edit4a, ports 5940-5959, temp U:/Temp/gsfpv-train4/edit4a.

Difference from the design (the code wins): stage S0 "seam" (seam.ts, parts.ts, keys.ts table, TOP_BUTTONS) was never
built; origin/main is e3201fec without it, and the four edit4 lanes started from it at the same time. So this lane builds
against the code as it is: EditView gets the walls ray through its own host (EditViewHost.ray), frames all itself
(EditView.frameAll), and course.ts gets only the smallest edits (listed under For the lead).

## Status

- [x] A1 camera and clicks: orbit, pan, dolly, Home, Numpad ., double click; no automatic camera move (commit 5755d0e8)
- [ ] A2 one gizmo: move arrows, size boxes and turn rings at once; nearest handle owns the press; hover tag; no tool buttons
- [ ] A3 acceptance: tools/bench/scripts/edit4a-probe.mjs (mouse, 1536x730 dsf 1.25), the live run as the negative control

## What the owner does

(after A1, in the course editor: open a course, press the Edit button)
1. Click a gate: it lights up with its handles; the view does not move.
2. Press and drag the left mouse button on empty space: the view circles round the selected gate (or round the point under
   the cursor when the selected gate is off screen). Hold Shift while dragging: the view slides. The middle button does the same.
3. Turn the wheel: the view goes towards the point under the cursor (a gate, a wall), never through it. On a laptop touch
   pad: two-finger scroll or pinch does the same.
4. Hold the right button and turn the wheel: the speed of W A S D changes (as before). Right drag still looks round.
5. Key Home: the whole course from above. Key F or Numpad . or a double click on a gate: the view goes to that gate.
6. Tab, Delete, duplicate, a drag of a handle, a refused Save: the view stays where it was.

## Claims

1. The view moves only when the pilot moves it: course.ts calls frameSel only from the F / Numpad . / double click binding;
   no aim(), no reframe after a drag. Proof: `npx vitest run tools/bench/test/edit4a-camera.test.ts` (13 passed); NEG OK
   against origin/main (13 of 13 failed on the old files).
2. Orbit keeps the pivot's distance and its place on the screen; pan keeps the heading; a wheel notch goes 15 % of the way
   to the point under the cursor and stops 0.5 m before it; Home frames every gate inside the view. Proof: the same test file.
3. The old editor tests that asserted the removed framing were rewritten with the owner's rule cited (editor3-ei, -fixes3,
   -flying, -g2, -j1). Proof: `npx vitest run tools/bench/test/editor3-*.test.ts tools/bench/test/editfix-*.test.ts
   tools/bench/test/course-*.test.ts tools/bench/test/edit4a-camera.test.ts` (29 files, 198 passed); `npx vitest run
   --changed origin/main` (9 files, 83 passed); `pnpm --filter ./apps/fly typecheck` exit 0.

## Not verified

- A1 was not run in a browser yet (A3 does it). No person, phone, touch pad or real controller took part.
- Safari's pinch (gesture events) is not handled; Chrome's pinch (wheel with ctrlKey) is.

## For the lead

- Files changed outside the owned list: apps/fly/src/app/builtin/course.ts (S0's lines done here, since S0 was not built:
  frameSel no longer on a new selection, after Tab/Delete/duplicate, after a refused Save or after a drag; `aim`, `framedId`,
  `dragBox` and the reframe hook removed; EditView host gets `ray`). Tests rewritten: tools/bench/test/editor3-ei, -fixes3,
  -flying, -g2, -j1.
- deploy/live-checks.sh edit-mouse-wroclaw records the wheel as a speed change (not judged); after this lane a plain wheel
  is a dolly. Its judged steps do not depend on it.
- Deploy order: page only.

## Cost notes

- A1: the most replies went to finding that S0 was never built and to sed quoting of regex lines in old tests; the Edit tool
  for test lines from the start would be cheaper.
