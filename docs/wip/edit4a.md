# Lane edit4a (train 4): the course editor's interaction (E1 E2 E3)

Design: C:/dev/.gsfpv-lanes/designs/edit4.md, section 2 (part A). Owner's words: brief lines 543-548.
Work copy C:/dev/gsfpv-loadq, branch edit4a, ports 5940-5959, temp U:/Temp/gsfpv-train4/edit4a.

Difference from the design (the code wins): stage S0 "seam" (seam.ts, parts.ts, keys.ts table, TOP_BUTTONS) was never
built; origin/main is e3201fec without it, and the four edit4 lanes started from it at the same time. So this lane builds
against the code as it is: EditView gets the walls ray through its own host (EditViewHost.ray), frames all itself
(EditView.frameAll), and course.ts gets only the smallest edits (listed under For the lead).

## Status

- [x] A1 camera and clicks: orbit, pan, dolly, Home, Numpad ., double click; no automatic camera move (commit 5755d0e8)
- [x] A2 one gizmo: move arrows, size boxes and turn rings at once; nearest handle owns the press; hover tag; no tool buttons;
  Esc / right click cancels a drag (commit b74bd0a8)
  - the drawn check of the hover (design A2 page probe) is folded into A3 step 7: one build and one GPU run for both
- [x] A3 acceptance: tools/bench/scripts/edit4a-probe.mjs (mouse, 1536x730 dsf 1.25), the live run as the negative control
  (commits 5e9d70f1, 3ef5816c, 205f115d, 6b90afbf, 2f835eef, 19caf118; run 4 and the gates in the last commit of the lane)
  - [x] the probe, 14 steps, one JSON verdict, exit 1 on a FAIL
  - [x] drawn run 1 on the local build (evidence accept-local.json): steps 1 to 12 and cancel PASS, 13 (laptop layout) FAIL
    by a probe fault, repaired in 205f115d (its gate could lie under the gate bar)
  - [x] drawn run on the live site (accept-live.json): 2 to 7, 9, 10, cancel, 11 and 13 FAIL (the negative control)
  - [x] drawn run 2 on the local build (accept-local-run2.json): every step PASS but 9.ringY: the press where hitAt named
    turn/ring:y went to the view (an orbit, eye 0.9 m, the gate not turned). Not a probe fault: a real intermittent miss.
  - [x] gates (typecheck, vitest, architecture, i18n, catalog, b18, leaks) on 6b90afbf: all PASS but vitest, whose only two
    failures are rooms-race and rooms-open-vote ('rooms.py did not start' under the load of 15 lanes); both pass alone
    (2 files, 13 passed). This lane changes no rooms file.
  - [x] LEFT 1 done (commit 2f835eef): a probe fault, not a product miss. The gizmo's own press test and partAt read the same event coordinates (e.offsetX) and the
    same shapes in one synchronous call, so a press can differ from the hover only by its point. The probe pressed the
    first point of a part met walking out from the centre, i.e. its very edge (run 2: the y ring at r 10 px, the box
    ends at r 8), at fractional CSS px; the synthetic press lands up to a fraction of a px off. Probe fix: whole px, and
    only a point whose 2 px neighbours name the same part; the press records the page's own coordinates (rec.down).
    The ?render=off repeats are not valid for the arrows: their flip and glance state is set in the gizmo's prerender.
  - [x] drawn run 3 on the local build of 2f835eef (evidence accept-local-run3.json): 1 to 10, cancel and 12 PASS; all 6
    presses took the part named before them and at the page's own press point (res.presses: pre = down.hit = taken).
    11 FAIL: gate 7's x arrow pointed at the eye, no point inside it (probe: now up to three gates, res.tried11).
    13 FAIL, a real product fault: at 844x390 the gate bar placed above the gate (y 43) lay over the editor's window
    [400, 86, 380, 35]. Fixed in bar-place.ts barPlace(keep) and gate-bar.ts keepClear() (the top bar and the editor's
    window): on each row it moves left or right of the box, else the next row. Test editor3-gatebar (4 passed), NEG OK;
    the 6 test files importing bar-place or gate-bar 45 passed; apps/fly typecheck exit 0. (commit 19caf118)
  - [x] drawn run 4 on the release build of 9d588729 (evidence accept-local.json, overwriting run 1's file; run 1's file
    stays in commit 6b90afbf): all 14 steps PASS, fails []; all 5 part presses took the part named before them at the
    page's own press point (res.presses: pre = down.hit = taken); step 11 took the first gate it tried (gate 19).
  - [x] gates once on the staged tree (see Claims 11)
- A3 done.

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
(after A2)
7. A selected gate carries one gizmo: small boxes near the centre (size), three rings round them (turn), and arrows further
   out (move). No Move, Turn, Size buttons on the bar under the gate any more; keys M R T do nothing.
8. Rest the mouse on a part: it lights yellow, the cursor is a hand, and a tag at the cursor says 'Move along X',
   'Turn around Y' or 'Size'. Where a ring lies in front of a box, the ring (the nearer one) is lit and taken.
9. Drag the part: the gate moves, turns or changes size; the top bar says what was done. Press key Esc or the right
   mouse button during the drag: the gate jumps back and the tag says 'Cancelled: the gate is back where it was'.
10. The editor's opening line and the Keys window name the drag on empty space, the wheel, key F and key Home.
(A3, the probe walks these steps with the mouse in a 1536x730 window at device scale 1.25)
11. In a small laptop window (844x390) the top bar, the gate bar, the hover tag and the editor's window stand apart.

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

4. One handle owns a press: the one whose shape under the cursor is nearest the eye (press-owner.ts pressOwner with
   distances from view-mouse.ts shapeHit, the engine's own pick with its distance); a turn ring is taken by the edit view
   unless an arrow or a box is nearer. Proof: `npx vitest run tools/bench/test/edit4a-gizmo.test.ts
   tools/bench/test/editor3-press.test.ts tools/bench/test/editor3-tools.test.ts` (3 files, 17 passed); NEG OK against origin/main
   (11 failed on the old press-owner, handle-look, view-mouse, gate-bar, bar-place, course.ts).
5. The three handles are on the gate at once in bands that do not overlap (boxes to 35 px + half a box, rings 60 +- 8 px,
   arrows 75 to 115 px; handle-look.ts handleBands, bandGap >= 4 px; the old 85-90 px layout gives a negative gap). The
   gate bar has no tool buttons, TOOLS/toolOfKey/toolAfter are gone. Proof: the same test files.
6. A drag sends start/move/end/cancel (drag.ts HandleDrag); Esc or a right click during it puts the gate back without an
   undo step (course.ts dragCancel). The opening line and the Keys rows no longer name M R T or the wheel as speed.
   Proof: `npx vitest run --changed origin/main` (53 files, 577 passed); `pnpm --filter ./apps/fly typecheck` exit 0.
7. On the page, with the mouse (1536x730, device scale 1.25, the pointer lock taken first by a click into the scene, scan
   Wroclaw 70b50d42, a generated course of 24 gates): Home shows every gate; a click selects gate 3 and the eye moves 0 m; a
   drag on empty space orbits it (distance 71.17 m before and after); Shift+drag pans with the heading kept; three wheel
   notches go from 103.3 m to 69.9 m of the point under the cursor; the x arrow, a size box and the y ring each name their
   part with the tag ('Move along X', 'Size', 'Turn around Y') and a hand cursor; the arrow drag moves the gate 0.8 m along
   its x, 0 m off it; the ring turns it 30 deg; the box makes the opening 1.2 -> 1.61 m; key Esc mid-drag puts it back; a
   click and a drag on another gate leave the eye where it was; a double click frames a gate in the middle third. The eye
   moved 0 m in every drag. Proof: `until mkdir C:/dev/.gpu-lock 2>/dev/null; do sleep 15; done; node
   tools/bench/scripts/edit4a-probe.mjs http://localhost:5941/en 70b50d42 1536x730 1.25 local
   evidence/2026-11-19/edit4a/accept-local.json; rmdir C:/dev/.gpu-lock` (release build of 9d588729, dist served by
   serve-csp.mjs). Last result (drawn run 4, 2026-11-19, a generated course of 35 gates): all 14 steps PASS, exit 0,
   fails []; the x arrow, the y ring and the size box presses each took the part the hover named (res.presses). The
   numbers above are drawn run 1's (its file is in commit 6b90afbf); runs 2 and 3 are kept as accept-local-run2/-run3.json.
8. At 844x390, device scale 2, no touch, nothing lies over another thing: top bar, gate bar, hover tag and the editor's
   window are disjoint and inside the window. Proof: step 13.laptop of the same drawn run 4: PASS (it failed in run 3 on
   the gate bar over the editor's window, repaired in 19caf118, claim 10).
9. Negative control: the same probe on the live site (`https://gsfpv.flyreelstudio.eu/en`, drawn, read-only: it never
   presses Save, nothing is stored) FAILS the steps this lane repairs: 2 Home (no move), 3 the click glides the eye 30.4 m,
   4 orbit and 5 pan (no move), 6 the wheel (no dolly), 7 hover (no part named, no tag), 9 and 10 (no ring, no box beside
   the arrows), cancel (the gate stays 0.7 m away), 11 the click glides the eye 22.9 m, 13 the gate bar lies over the
   editor's window. It PASSES 1, 8 and 12 (the old editor also opened, moved along x and framed on a click).
   Proof: evidence/2026-11-19/edit4a/accept-live.json.
11. The gates on the tree of 2e290cbb (files staged): `python -X utf8 C:/Users/andri/.claude/skills/gsfpv/scripts/gates.py
   --repo C:/dev/gsfpv-loadq --only typecheck,vitest,architecture,i18n,b18,leaks`: typecheck, architecture, i18n, b18, leaks
   PASS; vitest 408 files passed, 1 failed: tools/bench/test/rooms-race.test.ts ('rooms.py did not start' inside its 10 s
   start wait while 15 lanes load the machine). Alone: the first try failed the same way, the second passed (7 passed).
   This lane changes no rooms or apps/api file (`git diff --stat origin/main -- apps/api apps/rooms` is empty).
10. The gate bar never lies over the editor's window or the top bar (barPlace keep, A3). Proof: `npx vitest run
   tools/bench/test/editor3-gatebar.test.ts` (4 passed); NEG OK against 2f835eef (the new case fails on the old files).

## Not verified

- No person, phone, touch pad or real controller took part: the probe is a headless Chrome with a synthetic mouse. A touch
  pad's two-finger scroll and pinch are proven only by unit tests (wheelNotches with deltaMode and ctrlKey).
- The press misses of runs 1 and 2 were the probe pressing a part's very edge (Status, LEFT 1); drawn run 3 took every
  press it named. ?render=off runs are not valid for the arrows (their flip and glance state is set in the gizmo's
  prerender, which does not run without drawing); the render-off run is used for the laptop layout (step 13) only.
- Two drawn local runs were made in this stage (the rule is one): the first one's step 13 judged a click that the gate bar
  covered, a probe fault; the second run waited about 45 minutes for the GPU lock.
- Picture (U:/Temp/gsfpv-train4/shots/edit4a-hover-local.png, looked at once): the selected ring gate lit yellow with the
  small gizmo inside it, the hovered y ring lit yellow, the red x arrow and the green y arrow out from the centre boxes, and
  the tag 'Turn around Y' at the cursor; nothing else lies over the gizmo.
- The local server answered some scan files 403 (the line 'files that did not arrive: 3. Trying again' in the picture): a
  property of serve-csp.mjs and the local CDN cache, not of this lane.
- Safari's pinch (gesture events) is not handled; Chrome's pinch (wheel with ctrlKey) is.

## For the lead

- Files changed outside the owned list: apps/fly/src/app/builtin/course.ts (S0's lines done here, since S0 was not built:
  frameSel no longer on a new selection, after Tab/Delete/duplicate, after a refused Save or after a drag; `aim`, `framedId`,
  `dragBox` and the reframe hook removed; EditView host gets `ray`). Tests rewritten: tools/bench/test/editor3-ei, -fixes3,
  -flying, -g2, -j1.
- deploy/live-checks.sh edit-mouse-wroclaw records the wheel as a speed change (not judged); after this lane a plain wheel
  is a dolly. Its judged steps do not depend on it.
- A2 outside the owned list: course.ts (onDrag takes the HandleDrag event; dragCancel; dragTo names the dragged handle for
  its words; GateBar host without tool/setTool; host.text = t), texts.ts (TOOLS keys dropped from the list), locales
  fly/course en es pl ru (course.edit.opened and course.edit.cam.frame/look/wheel rewritten: they named M R T and the wheel
  as speed; course.edit.tool.* removed, unused). Tests rewritten with the owner's rule cited: editor3-press, -tools, -g2,
  -fixes3, -flying, -h2look, -i1. New: locales fly/course-view (course.view.*), view-texts.ts, view.css, edit4a-gizmo.test.ts.
- Difference from the design: its DragEvent is named HandleDrag (drag.ts) beside the DOM's own DragEvent; Handle and
  HandleAxis live in handle-look.ts (no seam.ts). The Keys table (keys.ts CAM_ROWS, S0's file) got no Home row: Home is
  named in the F row's words instead.
- Deploy order: page only.
- A3: new tools/bench/scripts/edit4a-probe.mjs (no product file). Live checks after the deploy, by name: this probe against
  the live address (`node tools/bench/scripts/edit4a-probe.mjs https://gsfpv.flyreelstudio.eu/en 70b50d42 1536x730 1.25
  live <out.json>`, drawn, inside the GPU lock; read-only) must PASS all 14 steps; deploy/live-checks.sh edit-mouse-wroclaw.
- The merged train's probe run (design section 6) should run this probe drawn, never with ?render=off for steps 7 to 11.

## Cost notes

- A1: the most replies went to finding that S0 was never built and to sed quoting of regex lines in old tests; the Edit tool
  for test lines from the start would be cheaper.
- A2: the most replies went to the old tests that pinned the one-tool layout (7 files) and to finding the stale opening
  line; a grep of the locales for the removed keys and words at the start would be cheaper.
- A3: the most replies went to a gizmo press that went to the orbit in ?render=off runs (stale gizmo shapes without drawing)
  and to waiting for the shared GPU lock; trusting the design's 'render=off cannot draw gizmos' and going drawn at once,
  with the probe's clicks checked against the bars beforehand, would be cheaper. Next run: start from LEFT 1 with one drawn
  run that writes res.presses, before reading any engine code.
- A3 run 3: reading the engine's gizmo code showed in a few replies that press and hover share coordinates and shapes, so
  the miss had to be the probe's edge point; the build (dist had been deleted) and the GPU wait took the most time.
  Keeping dist between runs of one stage (delete it only at LANE-DONE) would save a build.
- A3 run 4 (last): 12 replies; the build and the gates (about 10 minutes) took the most time. The probe records only PASS
  per step, so the claims' numbers had to come from run 1: writing each step's measured numbers into the JSON would save that.
- Review: the most replies went to finding which keydown listener sees Esc first (two window capture listeners, ordered by
  registration) and to the two builds; a probe step that cancels twice from the start would have shown it in the lane.

## Review

Independent check, 2026-11-19. Verdict: SHIP (full text: U:/Temp/gsfpv-train4/reviews/edit4a.md).
- PROVEN, repaired: key Esc during a handle drag also reached the editor's own key listener in course.ts (registered first,
  at feature setup), which ran 'exit': the first Esc-cancelled drag on a changed course said 'Esc again leaves without
  saving', the next Esc-cancelled drag closed the editor and dropped the unsaved changes (on an unchanged course the first
  one closed it). New probe step R.escTwice: FAIL on the build of 26d94483 (evidence review-before-renderoff.json, the editor
  closed); after the repair (course.ts returns on Esc while view.isDragging()) PASS on a drawn run (review-local.json).
  Test: edit4a-gizmo.test.ts 'Esc in a drag only cancels it', NEG OK against 26d94483.
- Rerun: claims 1 (edit4a-camera, NEG OK against origin/main), 4 (edit4a-gizmo, 24 passed with camera), 10 (editor3-gatebar,
  NEG OK against 2f835eef); the drawn probe on the repaired build: steps 1 to 12, cancel and R.escTwice PASS.
- DOUBT: step 13.laptop FAILED in the review's drawn run with 0 gates to click after Home at 844x390 (a new random course
  of 34 gates); its layout part held (nothing over anything, nothing outside). The step depends on the course drawn; it
  passed in the lane's run 4.
- Gates on the staged review tree (`gates.py --only typecheck,vitest,b18,leaks`): all PASS (vitest 149 s).
- Not checked: touch (a one-finger drag on empty space is now an orbit, was a look), Safari, a person, a real controller.
