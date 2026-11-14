# Lane editor3: the course editor as an edit mode of the same scene (train 3)

Branch editor3 from origin/main 197c2760, worktree C:/dev/gsfpv-voice, ports 5800-5819.

## Status

Stage E1-freeze-and-design (finished, the fix moved to E2 by the reply budget):
- [x] 1. the owner's path measured on the live site, cause found in the code (probe 7ae6c1c1, facts below)
- [x] 2. The design (below)
- [x] 3. the freeze fixed at its cause in pass 2 (E2.1 below, c1e5bf55, 5f149137); gates vitest, architecture, i18n, b18
  PASS on 5f149137 (gates.py, vitest 136 s)

Stage E2 (next worker), in this order:
- [x] E2.1 the check off the main thread (Decisions D1), c1e5bf55 (code), probe facts in this commit
  - [x] code: apps/fly/src/course/editor/check-core.ts (CheckQueue, checkAnswerer), check-worker.ts, wiring in course.ts;
    test tools/bench/test/editor3-check.test.ts (3 tests) plus tracks2-fixes T2-1 moved to edMargin; 7 touched files 35/35
    pass, NEG OK on origin/main course.ts (fails at `not.toMatch(/wallsCheck\(/)`), apps/fly tsc 0
  - [x] the probe re-run on a local release of c1e5bf55 (Facts, E2.1): every key's frame gap 35 ms or less, no long task
- [x] E2.2 the edit camera: W A S D, E up, Q down, Shift faster, right mouse button held (or a left drag on empty space)
  looks, wheel speed 0.5-20 m/s with a flash line; starts where the flight camera is; Tab glides to the gate (code, this commit)
- [x] E2.3 click to select (ray against bounding spheres), TranslateGizmo + RotateGizmo + ScaleGizmo (centre box only,
  uniform) on a stand-in entity at the selected gate, the gate follows live (one redraw per frame), one undo step per drag;
  snap 0.1 m, 15 deg, 0.1 of the opening, Ctrl held free (code, this commit)
  - files: course/editor/fly-cam.ts, pick.ts, drag.ts (pure), view-mouse.ts (canvas, keys, gizmos), keys.ts (Q and E to
    the camera, [ and ] turn), course.ts wiring; locales course.edit.opened (new text), course.edit.camSpeed (new), 4 languages
  - test tools/bench/test/editor3-mouse.test.ts (10 tests) + tracks-editor-ui.test.ts updated: 22/22 pass with
    editor3-check; NEG OK (neg_control.py, origin/main keys.ts: the Q/E tests fail); apps/fly tsc 0
  - gates vitest, architecture, i18n, b18 PASS on bc341bb7 (gates.py, vitest 117 s)
  - [ ] NOT yet run in a browser: the gizmos, the click, the camera keys (next: E2.6 or a smoke probe first)
- [ ] E2.4 the small panel at the selected gate, Add gate by a click on the place, the top bar
- [ ] E2.5 arm flies, disarm edits (The design, Flying through)
- [ ] E2.6 browser proof on a local release, the owner's path on 70b50d42 (local walls stand-in) and 887f27aa

## Facts (measured)

Probe tools/bench/src/editor3-live.ts against the LIVE site (main f91273cf), headless Chrome, 1280x800, 2026-11-14; evidence
U:/Temp/gsfpv-train3/editor3/e1-live.json, screenshots U:/Temp/gsfpv-train3/shots/editor3-e1-*.png. Nothing saved.

| | Wroclaw 70b50d42 | Tunis 887f27aa |
|---|---|---|
| Shift+G to a shown course (walls built in the browser first on Wroclaw) | 106 870 ms, 24 gates | 23 398 ms, 18 gates |
| main-thread long tasks during Shift+G | sum 32 738 ms, longest 14 312 ms | 0 |
| Shift+B: the page frozen (one frame gap) | 5 367 ms | 3 567 ms |
| Tab, Tab, Shift+Tab: frame gap, selection | 34 ms, 0>1>2>1 | 34 ms, 0>1>2>1 |
| ArrowUp, ArrowRight, PageUp, Q, +: one long task each | 5 144 to 5 371 ms | 3 494 to 3 574 ms |
| Ctrl+Z (undo) | frame gap 5 500 ms | long task 3 469 ms |
| W | nothing (the editor blocks the page's keys) | nothing |
| mouse drag and click on the scene | nothing: view, selection unchanged, no pointer lock | the same |
| idle in the editor, 5 s | 150 frames, gap max 34 ms | 150 frames, gap max 34 ms |

- Keyboard focus stays on BODY (class flying) all the time; every key reached the editor's own capture listener first
  (apps/fly/src/app/builtin/course.ts:755), so no other handler swallows keys. The second suspect is cleared.
- The freeze is the first suspect: the course check on the main thread. course.ts:538 makes
  `checkFn = wallsCheck(col, ...)` (packages/tracks/src/editor.ts:69, checkTrack of check.ts:200 with measure false: sphere
  sweeps of every leg and every gate's outline through the walls' octree). It runs in openEditor (editor.ts:118, on Shift+B),
  in edit() after every change (editor.ts:245) and in undo and redo (editor.ts:198). Selection (Tab) does not check: it is
  instant. One check costs 5.1-5.5 s on Wroclaw (24 gates) and 3.5-3.6 s on Tunis (18 gates). Presses made during it queue
  up, so to a person the editor looks dead: "everything froze, I can move nothing".
- The owner's "Tab does not work" did not reproduce headless (Tab moved the selection at once). Likely causes, not verified:
  a Tab pressed during a 5 s freeze, or the focus inside the window after a click on it (then Tab walks the window's buttons,
  keys.ts keyRoute).
- Small bug seen: Shift+Tab says "next gate" (ACTION_KEYS maps select-step to one word).
- E2.1, after the fix: the same probe (tools/bench/src/editor3-live.ts, SITE=http://localhost:5800, local release of
  c1e5bf55 with the Wroclaw walls stand-in U:/Temp/gsfpv-train2/walls/release/70b50d42/v1 copied into dist/walls, GPU lock,
  2026-11-14; U:/Temp/gsfpv-train3/editor3/e21/e1-local.json):

| | Wroclaw 70b50d42 | Tunis 887f27aa |
|---|---|---|
| Shift+B to the open editor (was 5 367 / 3 567 ms) | press 111 ms, open after 5 ms, one long task 83 ms | press 70 ms, open after 4 ms, no long task |
| Tab, Tab, Shift+Tab, ArrowUp, ArrowRight, PageUp, Q, +, Ctrl+Z, W: longest frame gap | 34 ms, 0 long tasks | 35 ms, 0 long tasks |
| idle 5 s | 150 frames, gap max 34 ms | 150 frames, gap max 34 ms |

  Both courses were clean (problems 0 before and after), so the red paint from a worker answer was not seen in the browser;
  the answer path is covered by the unit test only.
- PlayCanvas in apps/fly and packages/render-pc is 2.23.2. It exports TranslateGizmo, RotateGizmo, ScaleGizmo, TransformGizmo
  (snap, snapIncrement, coordSpace, dragMode, enableShape(axis, on), ScaleGizmo.uniform, events transform:start, transform:move,
  transform:end), Gizmo.createLayer(app), and FlyController with KeyboardMouseSource, ViewCube (build/playcanvas.d.ts).

## The design

One mode of the same scene, not another screen. The scan, the drone, the HUD and the course stay as they are.

Enter and leave. Shift+B, the pause menu's "Edit course" and a pencil button on the HUD toggle the mode. On a scene without
walls or a course the button builds them and enters when they are there (as now). Esc leaves; with unsaved changes the top
bar's Save button pulses and Esc a second time leaves.

Camera. The edit camera starts where the flight camera is. W A S D move it along the view, E up, Q down (the Unity and Unreal
fly keys), Shift faster. Holding the right mouse button turns the view (no pointer lock needed; a drag with the left button on
empty space turns it too). The wheel changes the speed (0.5 to 20 m/s, shown for a second). The camera may pass walls: it is a
view, not a drone.

Select and change with the mouse. A left click on a gate selects it (a ray from the cursor against each gate's bounding sphere,
nearest hit). The selected gate carries PlayCanvas's TranslateGizmo (three arrows and the planes), RotateGizmo (three rings,
drawn larger around it) and the uniform handle of ScaleGizmo (enableShape: only the centre box, uniform true: a gate's size is
one number, its opening). All three are attached to the gate's entity at once; dragging one handle moves, turns or scales live.
Snap: 0.1 m, 15 deg and 0.1 m of opening by default, Ctrl held drags free. Each drag (transform:end) is one undo step.

The small panel next to the selected gate (projected to the screen, right of it): its kind as five icon buttons (ring, square,
dive gate, cube; a pillar obstacle once the track format has it as a gate kind, see For the lead), Duplicate, Delete,
Previous, Next. Tab and Shift+Tab also go to the next and previous gate; the camera glides to see it.

Top bar (one row): Add gate, Undo, Redo, Save, Courses (opens today's window as a drawer: names, list, votes), Keys (the key
table for the keyboard-only road), Exit. Add gate: the cursor carries a ghost gate; a click on the scene puts it at the wall
hit of that ray, pulled back 1.5 m towards the camera, or 6 m ahead when the ray hits nothing; it faces the camera and goes
after the selected gate in the order. Esc drops the ghost.

Never blocks. Changes are never refused by a wall check: edit() runs with no check (instant) and the check runs in a worker
that holds the walls (sent once per scene, transferred). The newest course wins; a stale answer is dropped. A gate with a
problem is painted red at once when the answer comes; Save with red gates selects the first red gate and says what to fix,
one press away from fixing it. Save stays as today (my course, for everyone, admin version).

Flying through, no extra press. The flight session runs in the mode (not paused). Rule: armed = the drone's camera, disarmed =
the edit camera. Arming the radio or gamepad (or Space for a keyboard pilot) switches the view to the drone at once, hides the
gizmos and the panel, the course restarts from gate 1 with the edits in it; keys go to the flight. Disarming or a crash brings
the edit camera back where it was, the selection kept. "Fly from here" in the top bar puts the drone at the edit camera's
spot, facing its way, and arms nothing.

Keyboard-only road (kept, not the main road): Tab and Shift+Tab select, arrows and PageUp/PageDown move, [ and ] turn (Q and E
are now the camera's down and up), 1-4 kind, + and - size, Insert, Delete, Ctrl+Z and Ctrl+Y, F6 to the window. The Keys
button shows the table.

## Decisions

- D1 (E2.1, the freeze): a check worker in apps/fly/src/course/editor/check-worker.ts imports checkTrack from @gsfpv/tracks
  and keeps the flown walls it got once (grid, nodes, leaf transferred, as course.ts walls() builds them). course.ts opens the
  editor with `openEditor(course, () => [], 0)` and calls `edit(ed, action, () => [])`, then posts the new course with a
  sequence number; the answer sets `ed = { ...ed, problems }` when its number is the newest and repaints (editPaints already
  paints a bad gate red). Saving waits for the pending answer. The existing course/worker.ts is lane course3's file and copies
  the walls per job (course.ts:276 nodes.slice()), so it is not used for per-change checks.
- D2: PlayCanvas's own gizmos (2.23.2) are used, no hand-made handles.
- D3: the edit camera is our own small controller (W A S D E Q, right button look, wheel speed) writing through
  ctx.renderer.setCameraLookAt with cameraOverride, as the editor's camera does today; PlayCanvas FlyController is not used
  because the renderer camera belongs to the flight session.

## For the lead

- Files outside apps/fly/src/course/editor/ this lane touches: tools/bench/src/editor3-live.ts (new probe, E1);
  apps/fly/src/app/builtin/course.ts (the editor's wiring, E2.1 onwards); tools/bench/test/editor3-check.test.ts (new);
  tools/bench/test/tracks2-fixes.test.ts (T2-1 now reads `edMargin = marginOf(run.track)`: the margin goes to the worker).
- E2.1 changes the editor's rule: a change is no longer refused by the walls (edit() runs with a check that keeps the problems
  it had); the worker's answer paints a bad gate red and Save refuses while one is red, as before. check-worker.ts carries a
  copy of course/worker.ts metadataOf (lane course3's file, not exported; importing it would run that worker's onmessage).
  Hook wanted from course3: export metadataOf from a module without side effects.
- Hook wanted from lane course3 (packages/tracks): an EditAction that sets a gate's pose and opening in one step
  (`{ kind: 'place', index, pos, quat, opening }`) for the gizmo drags; until then the editor builds that state itself in its
  own folder. A pillar as a gate kind does not exist (format.ts: pillar and box are obstacles outside the gate order); the
  owner names "pillars" among the kinds.
- Shift+G on live Wroclaw: main-thread long tasks summed 32.7 s, the longest 14.3 s, before the course came (lane walls or
  course3: the walls build or the course hand-off runs on the main thread).

## Not verified

- E2.2/E2.3 in a browser: whether PlayCanvas 2.23.2's gizmos draw and drag on our renderer camera (the gizmo layer is added to
  the camera's layers), whether the fly page's own canvas listeners (pointer lock request on click) disturb a click while the
  editor is open, whether a live redraw per frame (stage.show of all gates) is smooth on Wroclaw's 24 gates. enableShape
  names 'face' (TranslateGizmo) and 'face', 'xyz' (RotateGizmo) are wrapped in try: not checked which exist.
- The new numbers are estimates, not measured: CAM_SPEED_M_S 4, CAM_WHEEL_STEP 1.35, CAM_FAST 3, CAM_DEG_PER_PX 0.2,
  PICK_PAD_M 0.15, CLICK_SLOP_PX 4, turn gizmo size 1.5.

- Why the owner's Tab did nothing (headless Tab worked); see Facts.
- The probe ran headless on this PC's GPU at 30 frames per second; the owner's laptop numbers will differ.
- ArrowRight and PageUp were applied (the said line stayed "Moved", the probe's change detector could not tell); their long
  tasks were measured.

## Cost notes

- E1: the live run took about 20 minutes of waiting (Wroclaw walls build plus two 5 s freezes per key); a wait loop of 9
  minutes cost one reply; reading the whole PlayCanvas export line cost context. The fix did not fit in the 30 replies.
- E1 pass 2 (E2.1): about 25 replies; most went to finding the test layout (apps/fly tests live in tools/bench/test) and the
  probe JSON shape; a line in docs/agent-map.md on both would have saved four replies.
- E2 mouse-and-camera: about 30 replies; most went to finding the gate frames (scan vs flown, w-first quaternions) and the
  PlayCanvas gizmo API in a 77k-line d.ts; a note in agent-map.md on the course frames and the quaternion order would save
  five replies. No browser run fitted.
