# Lane editor3: the course editor as an edit mode of the same scene (train 3)

Branch editor3 from origin/main 197c2760, worktree C:/dev/gsfpv-voice, ports 5800-5819.

## Status

Stage G2-bar-space-floor (train 3 wave 3, the last finishing lane):
- [x] G2.0 the G1 REPRO run on the old dist never got the lock (held by others 05:25-05:45 and 05:37-06:02); the
  measurement came from the new release instead (G2.5).
- [x] G2.1-G2.4 code (this commit), test tools/bench/test/editor3-g2.test.ts (4 tests), NEG OK (neg_control.py ref HEAD
  8364c885, the 10 changed files: fails by the missing exports and assertions); with editor3-*, tracks-editor-ui, a6-reference
  10 files 58/58 pass (a6 hash unchanged); apps/fly tsc 0.
  - 1 the bar: view-mouse.ts listens to pointerup and pointercancel in the CAPTURE phase and handles the up after the dispatch
    (setTimeout 0): PlayCanvas 2.23.2 Gizmo._onPointerUp (playcanvas.mjs 121197-121214) calls stopPropagation when the up lands
    on a gizmo shape, so the old bubble listener missed the up of every drag that ended on the handle (press, mute and the
    drag guard stayed). transform:move counts only while our drag runs; endStale() ends a gizmo that kept its axis after the
    up (detach fires its POINTERUP; its transform:end swallowed by quietEnd; the shown set attached again). The gate bar hides
    by host.dragging() (EditView.isDragging) through bar-place.ts barAnchor; course.ts dragTo no longer sets the hide flag.
    The stopPropagation cause is read from the code, not yet measured (G2.0 is the measurement).
  - 2 Space: devices/keyboard.ts: in the game scheme while '.course-editor.ce-flying' exists (the course flown in the mode),
    Space stops the motors (AutoArm.stop) instead of climbing; the mode's modeStep sees armed false and the edit view comes
    back where it was (existing to-edit path). The pilot scheme already toggled; a controller keeps its arm switch.
  - 3 floor add: add-place.ts addFacing(eye, at, prev): the new gate faces the way from the selected gate (upright, turned
    about the vertical), from the eye when there is no selected gate or it is within ADD_COURSE_MIN_M 1 m (an estimate);
    course.ts placeAt uses it. In front of the camera: aim() after the add (H2). Why Tunis went red (3 -> 6): not measured yet.
  - 4 course.edit.opened in en, es, pl, ru: one set of handles at a time, Move, Turn, Size on the bar under the gate (or M,
    R, T), Space or the arm switch flies, again edits.
- [x] G2.5 release of 95a91a95 (code bfe1003f), REPRO run (g2/repro2, lock 06:02:18-06:02:54, Tunis): the bar was STILL
  hidden: right after the bar's Size click, before any drag, `bar.hidden` false, `dragging` false, vis 'hidden' (57 pointerup
  records). Measured cause: view-mouse.ts standScreen() returned null unless the MOVE set had nodes, so Turn or Size (one set
  at a time, H1) hid the bar. The capture-phase up and endStale of bfe1003f are kept as guards (not the proven cause).
- [x] G2.6 fix 58bb57c2: standScreen() reads whichever set is attached; editor3-g2.test.ts extended, NEG OK (neg_control.py ref
  HEAD 26ac534e, view-mouse.ts), editor3-g2/-tools/-gatebar 13/13, apps/fly tsc 0.
- [x] G2.7 release of 58bb57c2, REPRO run (g2/repro3/e4.json, lock 06:13:50-06:14:58, Tunis, 1920x1080). PROVEN item 1:
  all 8 bar presses after drags found the bar visible and the button under the press (size, turn, size, turn, move, turn,
  turn, size); 0 of 60 pointerup records with the bar hidden two frames after the up; 0 with a gizmo axis left set. Size
  drags 1.2 -> 1.58 -> 2.08 -> 2.73 -> 3.59 -> 4.72 m, moved 0; X arrow moved 0.4 m; rings: quat change 0.52 and 1.93, ring3
  60 deg, ring-out (the drag ended on the top bar, outside the canvas) 150 deg, moved 0.
- [x] gates.py --only vitest,architecture,i18n,b18 on 95a91a95: architecture, i18n PASS; b18 FAIL (editor3-g2.test.ts had
  non-ASCII, fixed in 26ac534e, b18 PASS after); vitest 4793 pass, 1 fail: tools/bench/test/app-dji-rc2.test.ts "answers 60
  ms late" (timing, the release build ran beside it; passes alone 19/19 with editor3-g2). Not re-run in full after 58bb57c2.
- [ ] left (next worker, in this order; dist is the release of 58bb57c2, do not rebuild unless apps/fly changes):
  1. `KBD=1 PHONE=0 OUT=U:/Temp/gsfpv-train3/editor3/g2/full2 SCENES=887f27aa,70b50d42 PORT=5804 bash
     U:/Temp/gsfpv-train3/editor3/g1/run.sh` (the 06:15 try waited 9 min on a lock held by others, no record). Read in
     full2/e4.json: kbd-887f27aa space1 (mode 'fly') and space2 (mode 'edit', armed false: item 2, code bfe1003f, NOT yet seen
     in a browser); floorAdd on both scenes (stand.screen z > 0 = in front, problems before/after = not red, standPosY);
     full.digitInLine false. LOOK at shots/editor3-floor-add-1920.png and editor3-wroclaw-floor-add-1920.png.
  2. If the floor-added gate is still red on Tunis: record the problem's reason (ed(page) said / the window's problem line)
     before changing add-place.ts; the facing along the course (addFacing) is code only so far.
  3. gates.py --only vitest,architecture,i18n,b18 on the final head.

Stage G1-merge-hooks (train 3 wave 3):
- [x] G1.1 `git merge --no-ff course3` (493526f5, course3 head 18e6a876). Conflicts only in
  packages/i18n/locales/fly/course/{en,es,pl,ru}.json: both sides kept (editor keys and course3's progress.* keys), 156
  keys each, JSON parses.
- [x] G1.2 the three hooks joined (this commit): check-worker.ts imports metadataOf from course/grid.ts (its own copy gone),
  check-core.ts takes CourseGrid from course/grid.ts; add-place.ts addAction(at, quat, tr) gives course3's
  EditAction { kind: 'add', pos, quat } in the course frame (addInState and freeGateId removed); course.ts placeAt runs
  edit(ed, addAction(...)) and says a refusal (max-gates, placement) with refusalText; the top bar's Add gate arms the
  same click; course.ts sets edHook.flying (false on open, true on to-fly, false on to-edit and on close; the field is
  readonly in hook.ts, written through a cast); texts.ts ACTION_KEYS.add points at course.edit.bar.add.
- [x] G1.3 apps/fly tsc 0, packages/tracks tsc 0; vitest editor3-* (8 files), tracks-editor-ui, course3-hooks,
  a6-reference: 10 files 57/57 pass; NEG OK (neg_control.py ref HEAD 493526f5, course.ts and check-worker.ts: the
  editor3-flying hook test fails by an assertion).
- [~] G1.4 release of 05dbc189 built (g1/build2.log: sha 05dbc189, 1934 files); probe 05dbc189 records after every
  pointerup (window listener in the init script: at the up, after the task, two frames later) GateBar.debug() (hidden flag,
  drawn visibility), the shown tool and each set [enabled, nodes, selectedAxis, hoverAxis]; course.ts __gsfpvEditView adds
  `bar`. Runner U:/Temp/gsfpv-train3/editor3/g1/run.sh (copies the wave-3 walls of 70b50d42 into dist/walls).
  REPRO run once (05:25-05:34): the GPU lock C:/dev/.gpu-lock was held by others the whole 9 min (made 05:25:01; node jobs
  seen: integA walls-cache-probe.mjs on 5760, sonic-int-review.ts r11), so the runner gave up ("lock wait over 9 min"),
  no browser record exists yet. Nothing about the hidden bar is measured in G1.
- [ ] left (next worker, in this order):
  1. dist is the release of 05dbc189 (no apps/fly change since; do not rebuild). Run
     `REPRO=1 OUT=U:/Temp/gsfpv-train3/editor3/g1/repro SCENES=887f27aa PORT=5802 bash U:/Temp/gsfpv-train3/editor3/g1/run.sh`
     as the first command (it waits up to 9 min for the lock, holds it at most 590 s, stops its server).
  2. Read `scenes["repro-887f27aa"].ups` in g1/repro/e4.json: for each pointerup n after a centre-box drag, `bar.hidden` and
     `bar.vis` at up / task / frame2, `tool`, `dragging`, and the shown set's selectedAxis (sets[i][2] of the enabled set).
     Write under Facts what it shows (hidden true with dragging false = the dragTo hide flag left set; selectedAxis still
     'xyz' after the up = the gizmo still believes it drags). Then H2 pass 2 left 1 (the fix) with a test and a negative
     control, and the lead's items (2) Space disarms a keyboard pilot in the mode, (3) the floor-added gate in view and not red.

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
  - [x] smoke probe in a local release (pass 2, 7658ddfb probe, 529da832 fix): tools/bench/src/editor3-smoke.ts, Facts E2 smoke.
    Fixed from it: the move handle's centre sphere is 'xyz' in PlayCanvas 2.23.2 (not 'face'), now switched off (529da832).
  - [ ] the scale box drag still did not change the opening in run 2 on Wroclaw (the gate moved 0.3 m instead): find which
    handle takes a press on the centre (all three gizmos get the pointerdown; try the scale gizmo alone, or a bigger drag
    than 56 px against snap 0.1), fix, re-run the probe
- [~] E2.4 the small panel at the selected gate, Add gate by a click on the place, the top bar
  - [x] the gate bar (dbb1dd8c): apps/fly/src/course/editor/gate-bar.ts (DOM, follows the gate each frame, hidden while a
    handle drags), bar-place.ts (pure: BAR_BUTTONS, barPlace), editor.css .ce-gatebar; buttons previous, ring, square,
    dive, cube, insert, delete, next run the same key rows (no new locale keys: course.edit.key.*). Test
    tools/bench/test/editor3-gatebar.test.ts 3 pass, NEG OK (the file is new: fails by the missing module), apps/fly tsc 0.
    Seen in the browser on Wroclaw: visible right of the gate, Next took the next gate, focus back on BODY.
  - [ ] Duplicate (today Insert adds a gate after; a copy of the selected gate is not an EditAction yet), Add gate by a
    click on the scene (ghost gate), the top bar (Add, Undo, Redo, Save, Courses, Keys, Exit)
  - gates vitest, architecture, i18n, b18 PASS on f30a4c03 (gates.py, vitest 139 s)
- [x] E2.5 arm flies, disarm edits: done in stage E3 below
- [ ] E2.6 browser proof on a local release, the owner's path on 70b50d42 (local walls stand-in) and 887f27aa: its own
  stage (E3-proof), see left below

Stage E3-panel-and-flying:
- [x] E3.1 code (commit 50777ee8): the gate bar's insert button is now Duplicate (the editor's insert already copies the
  selected gate, its kind and opening, 4 m ahead: packages/tracks editor.ts insert); a top bar (top-bar.ts, TOP_BUTTONS in
  bar-place.ts): Add gate, Undo, Redo, Exit and a line saying what to do now; Add gate arms the next left click on the scene
  (view-mouse.ts onPlace): add-place.ts puts a gate at the wall hit of that ray pulled back 1.5 m, or 6 m ahead on open sky,
  facing the camera, after the selected gate, a copy of its kind and opening, one undo step; Esc drops the armed Add.
  Flying (fly-mode.ts): no pause in the mode any more; each frame modeStep(armed, crashed): armed shows the drone's camera
  (cameraOverride off), hides the handles, the gate bar, the window and the top bar's buttons, the course restarts from gate 1
  with the edits; keys go to the flight (ctx.keys.block and the editor's keydown only in 'edit'); disarm or crash brings the
  edit camera back where it was with the selection kept. The lap clock and the best lap stay off while the mode is open
  (frame(true): next gate lights up, no hud.update, no writeBest). Tab and the bar's Next already went to the next gate.
  - texts: course.edit.bar.add, .bar.addHint, .bar.duplicate, .flyHint, .flying in en, es, pl, ru (texts.ts list)
  - test tools/bench/test/editor3-flying.test.ts (10 tests) + editor3-gatebar.test.ts (ids): with editor3-mouse,
    editor3-check, tracks-editor-ui 5 files 34/34 pass; NEG OK twice (neg_control.py: ref origin/main, the new modules
    missing; ref HEAD 3efc0f65 course.ts and bar-place.ts: the test fails, exit 1); apps/fly tsc 0
- [x] E3.2 gates vitest, architecture, i18n, b18 PASS on 50777ee8 (gates.py, vitest 157 s)
- [ ] E3-proof (own stage, starts with the release build): the owner's path walked headless on 70b50d42 (walls stand-in) and
  887f27aa: open the mode, click a gate, the bar's Duplicate, Next, Tab, top bar Add gate then a click on the scene, Undo,
  Redo; arm (a gamepad cannot be plugged in headless: Space with the keyboard as the chosen input, or a probe that sets the
  arm gate) and see the drone's camera, no lap clock, gates lit in order; disarm and see the edit camera where it was.
  Also left from E2: the scale box drag that moved the gate 0.3 m instead of changing its opening on Wroclaw.

Stage E4-prove (NOT finished, stopped at the reply budget; the proof found three faults):
- [x] E4.1 the centre-box fault from E2 fixed at its cause (d726a3cb): all three PlayCanvas gizmos took one press (a gizmo's
  stopPropagation does not stop the others on the same canvas); press-owner.ts picks one owner in a window capture listener
  (scale box, then move, then rings) and switches the others off until the button goes up. Test
  tools/bench/test/editor3-press.test.ts 2 pass, NEG OK (neg_control.py, ref HEAD 73558d42 view-mouse.ts), apps/fly tsc 0.
  NOT yet seen working in a browser: the E4 run's drags all missed (fault 1 below).
- [x] E4.2 probe tools/bench/src/editor3-prove.ts (218719fb, 3b8748a0), runner U:/Temp/gsfpv-train3/editor3/e4/run.sh,
  evidence U:/Temp/gsfpv-train3/editor3/e4/e4.json; run on a local release of d726a3cb (Facts, E4)
- [x] E4.3 gates vitest, architecture, i18n, b18 PASS on 3b8748a0 (gates.py, vitest 121 s)
- [ ] E4.4 fault 1: after the gate bar's Delete the selection is gate 1 but no handles and no gate bar are drawn on it and the
  camera does not go to it (screenshots editor3-select-1920.png, editor3-wroclaw-1920.png); every drag after it hit empty
  space (moveX, turn, scale all 0 on both scenes). Look at course.ts's delete path: the stand-in put() and the glide must run
  for the new selection. Then re-run run.sh and read moveX (screenPx should follow the 80 px drag), turn, scale (opening
  changes, movedM 0).
- [ ] E4.5 fault 2: the bar's Square changed nothing it said on Tunis and said "next gate. Gate 22 of 22" on Wroclaw (the
  click landed on a stale bar position or the bar was hidden: same root as fault 1, re-check after it).
- [ ] E4.6 fault 3, 844x390 (editor3-844.png): the top bar wraps to three lines and the course window covers the right
  half and the top bar's text; the gate bar is behind the window. Phone layout: the window as a drawer closed by default,
  the top bar's hint line hidden under 900 px.
- [ ] E4.7 flying with the controller: the fake DJI pad flies (controls.source gamepad) and the mode switched to 'fly' and back
  to 'edit' with the edit eye back within 0 m, but the profile is the camera drone ("no arming needed", gate.armed stayed
  false) and the 4 s of stick did not pass a gate (next stayed 0). To prove "fly through the moved gate": put the moved gate
  ahead of the drone's spawn, or use a racing profile with an arm switch, then read course.next go 0 to 1.
- [ ] E4.8 re-run, LOOK at the four screenshots again, the owner's mouse steps below checked against them.

E4-prove pass 2 (stopped at the reply budget: the GPU lock C:/dev/.gpu-lock was held from 23:48 to past 00:12 by another
lane's course-quality-audit runs in C:/dev/gsfpv-rooms, so no browser run happened in this pass):
- [x] probe changes (this commit, tools/bench/src/editor3-prove.ts, tsc of tools/bench clean for this file):
  - after the bar's Delete it records `delete.handles`, `delete.dragging`, `delete.stand` (screen), `delete.gate` (the
    selected gate's screen point) and `delete.bar` (the bar's display and place): this is the diagnosis of fault 1;
  - the ring, the centre box and the kind now act on gate 2 (Tab), then Shift+Tab back to gate 1 and only its X arrow is
    dragged, so the gate flown through is only moved (a ring turn could leave it facing sideways);
  - the kind button is chosen from the window's gate line (ring when it is a square, else square) and clicked without
    force (a hidden bar now shows as kindClickError instead of a click on whatever lies there): explains E4.5 on Tunis,
    where Square was pressed on a gate that already was a square;
  - E4.7: flying steers at the moved gate by where it is on the drone's camera (yaw keeps it centred, throttle at its
    height, pitch forward; yaw and pitch signs found by trying), up to 15 s, stops when course.next changes; records
    flyYawSign, flyPitch and per step [i, next, mode, gate screen point].
- [x] E4.6 code (this commit, NOT yet seen in a browser): under 900 px wide or 500 px high the course window is a drawer,
  closed by default (only its title and the gate line, top right); its title is now a button (panel.ts, .ce-drawer) that
  opens and closes it and gives the focus back to the page; the top bar keeps one line and hides its hint line
  (editor.css). No new texts. apps/fly tsc 0.
- [ ] E4.4 fault 1, next step: get the GPU lock, run
  `OUT=U:/Temp/gsfpv-train3/editor3/e4diag SCENES=887f27aa PHONE=0 bash U:/Temp/gsfpv-train3/editor3/e4/run.sh`
  (dist is the release of d726a3cb; rebuild first if apps/fly changed: this pass changed panel.ts and editor.css) and read
  `delete` in e4diag/e4.json. Reading of the code so far: course.ts applyKey runs showEd() after the delete, and showEd()
  calls view.put() for the new selection; view-mouse.ts put() returns at once while `this.dragging` is true, and
  standScreen() (the bar's place) is null when the move handle has no nodes. So either `dragging` stuck true (a
  transform:start without a transform:end) or the handles were detached. If `delete.dragging` is true: end a drag in
  view-mouse.ts onUp when the button goes up and the flag is still set (call host.onDrag(pose, true)). Also make
  applyKey call aim() when the gate count changes (delete, duplicate), so the camera goes to the new selection. Each with
  a test in tools/bench/test/editor3-mouse.test.ts and a negative control.
- [ ] then the full run (`bash U:/Temp/gsfpv-train3/editor3/e4/run.sh`, both scenes, PHONE=1) on a fresh release build,
  read moveX (screenPx follows the 80 px drag), turn, scale (opening changes, movedM 0), kind, fly (next goes 0 to 1),
  LOOK at editor3-select-1920.png, editor3-drag-1920.png, editor3-wroclaw-1920.png, editor3-844.png (the drawer),
  then gates.py --only vitest,architecture,i18n,b18.

Stage fixes (review ED-1 to ED-7; NOT finished, stopped at the reply budget):
- [x] ED-2 stands (keyboard.ts dialogOpen looked for '.panel', the editor's root is '.course-editor'): dialogOpen() now also
  matches EDIT_MODE '.course-editor:not(.ce-flying)'; Space in the mode (no other dialog, not on a control of the editor) still
  reaches the keyboard source and arms (editModeArm); course.ts editFrame sets ce-flying on the window while the drone flies.
  File outside the editor folder: apps/fly/src/devices/keyboard.ts (input of the fly page). flyHint text unchanged (it says
  "arm your controller"; Space is not named in it yet).
- [x] ED-3 stands (a crash sets armed 0, the keepArmed respawn arms again): decided "a crash keeps flying" (fly-mode.ts
  editModeOf holds `prev` while crashed); disarm is the way back to editing. The design's line "disarm or crash brings the edit
  camera back" now reads: disarm brings it back; a crash flies on after the respawn (or edits when respawn.keepArmed is off).
- [x] ED-4 stands: add-place.ts addPoint(eye, dir, hit, lift) puts a downward click's gate over the floor spot, centre lifted by
  addLift (half the flown opening of the copied gate + ADD_FLOOR_M 0.5 m, an estimate), pulled back ADD_BACK_M along the floor.
- [x] ED-1 code part: view-mouse.ts onUp ends a drag still set when the button goes up (host.onDrag(pose, true)); course.ts
  applyKey calls aim() when the gate count changes (delete, duplicate). The cause is NOT yet confirmed by the diagnosis probe.
- tests: tools/bench/test/editor3-flying.test.ts (ED-2, ED-3, ED-4, ED-1 cases); with editor3-mouse, -press, -gatebar, -check,
  tracks-editor-ui 6 files 40/40 pass; NEG OK (neg_control.py, ref 2b198f72, the five changed sources); apps/fly tsc 0;
  tools/bench/test/a6-reference.test.ts 1/1 pass (keyboard.ts touched).
- [ ] ED-1 diagnosis: `OUT=U:/Temp/gsfpv-train3/editor3/e4diag SCENES=887f27aa PHONE=0 bash U:/Temp/gsfpv-train3/editor3/e4/run.sh`
  on the dist of d726a3cb; read `delete` (handles, dragging, stand, bar) in e4diag/e4.json. Run once in this stage (2026-11-15
  00:25-00:40 local): the course never came on Tunis (course.ok false after 240148 ms, gates 0), so no `delete` record. Next:
  rebuild the release from 227ec760 (it holds the ED-1 code fixes), run again; if the course again does not come, read
  probe.log for the walls/generate line before anything else.
  Reading of PlayCanvas 2.23.2 (build/playcanvas.mjs 121167-121215, 121405-121450): a gizmo's own pointerup returns while it
  is switched off (`!this.enabled`), so it then sends no transform:end; the onUp guard of 227ec760 covers that case.
- [x] ED-5 stands (an error answer or a dead worker left the problems at [] or stale): course.ts keeps `okCourse`, the course
  of the newest ok answer; checked() (both save paths) runs check-core checkOnPage (wallsCheck on the page thread, once) when
  the course now is not okCourse. ED-6 stands: texts.ts actionKey() says course.edit.key.prev for a step back and the new
  course.edit.selected for a click. ED-7 stands: TOP_BUTTONS add Save (Ctrl+S), Courses and Keys (panel.reveal opens the
  window or the phone's drawer at that part; askName and F6 open it too); keys.ts CAM_ROWS (W A S D, E / Q, Shift, right
  button look, wheel, click a gate, Space) as lines of the Keys table. New texts in en, es, pl, ru: course.edit.selected,
  course.edit.bar.save/.courses/.keys, course.edit.cam.* (7). Test tools/bench/test/editor3-fixes.test.ts 7 pass, NEG OK
  (neg_control.py ref c0d4b218, the 8 changed sources); with editor3-flying (TOP_BUTTONS ids updated), -gatebar, -mouse,
  -check, -press, tracks-editor-ui 7 files 47 tests, 46 pass before the flying update, 20/20 after it on the two changed
  files; apps/fly tsc 0.
- [x] ED-1 browser run (pass 2): release of c0d4b218 (code of 227ec760 plus the probe), walls stand-in in dist/walls,
  `OUT=U:/Temp/gsfpv-train3/editor3/e5 PHONE=1 bash U:/Temp/gsfpv-train3/editor3/fixes2.sh`, evidence
  U:/Temp/gsfpv-train3/editor3/e5/e4.json. The course came on both scenes this time (Tunis 5 gates in 10.5 s, Wroclaw 18
  gates in 50 s, no Shift+G retry; the 403s are cloudfront probes of 887f27aa v1-v5 meta/settings, the scene was ready in
  2.6 s). Facts:
  - delete (fault 1): on both scenes after the bar's Delete `handles` true, `dragging` false, the stand and the selected gate
    at the same screen point [774, 532, 3.13 m], the gate bar shown (flex). Fault 1 (E4.4) is gone with 227ec760 (aim() on a
    gate count change); `dragging` was not stuck in this run, so the onUp guard is kept as a guard, not as the proven cause.
  - moveX: both scenes 80 px drag of the X arrow -> the gate's screen point followed 78 px, moved 0.4 m, opening unchanged.
  - scale (the centre box, d726a3cb): Tunis opening 1.2 -> 1.53 m with movedM 0 (proven). Wroclaw: three drags, opening 1.5
    stayed 1.5, movedM 0 (open, see left).
  - turn: 0 on both scenes for every try. LOOKED at shots/editor3-drag-1920.png (Tunis, 3.1 m from the gate): the rotate rings
    are about 230 px from the centre, the probe presses at 110-150 px (inside, on the gate's own torus). The probe's radii are
    wrong, so this run does not prove or disprove the rings (left).
  - kind: Tunis ring -> square, said "Shape changed. Gate 2 of 5: square, 1.5 m". Wroclaw: the bar's ring button not
    clickable in 5 s (kindClickError: the bar hidden or off screen after the scale tries; left).
  - keys W A S D E Q moved the edit eye 2.4-2.53 m each on both; right-button look: Wroclaw at moved 0.85 m, Tunis 0 (left).
  - fly (E4.7): the camera-drone profile (no arming), mode went to 'fly' and back, course.next stayed 0 on both (as E4).
  - frames: in the mode 29.8-30 fps, longest gap 34 ms idle and while dragging; the whole path on Wroclaw 3 long tasks up to
    158 ms; 0 page errors in 35 log lines.
  - phone 844x390 (Tunis, the 4-button top bar of c0d4b218): the top bar one line, 295 px wide at y 4; the gate bar at
    360,156. The 7-button bar of 3c972fee is NOT yet seen on a phone.
- [ ] left (next worker, in this order):
  1. probe tools/bench/src/editor3-prove.ts turn step: press at the ring radius (try 230, 200, 260 px, or read it from the
     gizmo), re-run on Tunis, read turn quatChange > 0 with movedM 0.
  2. Wroclaw: why the centre box drag did not scale (the selected gate's distance; stand.screen vs the box) and why the
     ring button of the gate bar was not clickable after it; screenshot shots/editor3-wroclaw-drag-1920.png not yet looked at.
  3. ED-2 probe step with the keyboard as the chosen input: W in the mode must not arm, Space must (code 227ec760, not seen
     in a browser).
  4. a release of 3c972fee (ED-5/6/7) and one phone run: the 7-button top bar on 844x390 (wraps or not), Courses and Keys
     open the drawer.
  5. E4.7 the flight through the moved gate (a racing profile with an arm switch, or the moved gate ahead of the spawn).
- [x] gates.py --only vitest,architecture,i18n,b18 PASS on 9a426a3f (vitest 180 s; logs U:/Temp/gsfpv-gates-20261115-004525).

Stage H1-handles-first (train 3 wave 2, the finishing lane):
- [~] H1.0 release of bb670ead built (build-release sha bb670ead, 1932 files); the 'before' run of the E4 probe
  (runner U:/Temp/gsfpv-train3/editor3/h1/run.sh, OUT h1/before) queued on the GPU lock
- [x] H1.1 code (this commit): one set of handles at a time. bar-place.ts TOOLS (Move M, Turn R, Size T; letters the edit
  camera and editorKey leave free), toolOfKey, toolAfter (Move whenever another gate gets selected, by the gate's id);
  view-mouse.ts put(pose, gateId) attaches only the shown set, setTool, the others disabled, the M/R/T keys, hitAt(x, y) for the
  probes (the shown set's shape under a page point), the right-button look by clientX/Y steps (movementX was 0 on Tunis);
  gate-bar.ts three tool buttons first (aria-pressed lit); editor.css: the window opens closed on every screen (title only,
  Courses and Keys open it), refused line colour; top-bar.ts tell(): what an edit did shows on the top bar line (the window is
  closed), a refusal also on the HUD flash (course.ts say()); the top bar's own words Undo, Redo, Exit (course.edit.bar.*);
  a full course: Add gate says course.edit.r.maxGates before arming, and that text now names what to do with no number.
  New texts in en, es, pl, ru: course.edit.tool.move/.turn/.size, course.edit.bar.undo/.redo/.exit; r.maxGates rewritten.
  Test tools/bench/test/editor3-tools.test.ts 6 pass; with editor3-fixes, -flying, -gatebar, -mouse, -press,
  tracks-editor-ui 7 files 50/50; NEG OK (neg_control.py ref bb670ead, 8 files); apps/fly tsc 0. NOT yet seen in a browser.

- [x] H1.1b course.ts exposes window.__gsfpvEditHit(x, y) (view.hitAt, read only) for the probe; apps/fly tsc 0 (this commit)
H1 pass 2:
- [x] left 1: no 'before' run exists (h1/before has only serve.log); skipped as the list said. The release of f6e5042a was
  built (build2.log) but the lock was held by another lane from 01:37, so the new runs use a fresh build of 2692c7c2.
- [x] left 2 (2692c7c2): the probe clicks the gate bar's Turn button before the ring step, presses T before the centre box,
  reads tool 'move' before the X arrow; each press point is found by walk(): out from stand.screen in 6 px steps with
  window.__gsfpvEditHit (the gizmo's own picking, so the radius drawn), recorded as r and hit in turn/scale/moveX.
- [x] left 3 ED-3 (2692c7c2): fly-mode.ts modeStep(prev, armed, crashed, hold) returns hold; a crash in 'fly' goes to
  'edit' at once and holds it while the keepArmed respawn is armed; flying again needs armed seen false, then true.
  course.ts keeps crashHold (reset when the mode opens). No session disarm API exists (grep of session/index.ts and
  controls.ts: only toggleArm); with keepArmed the respawned drone sits armed on the start platform at idle, the keyboard's
  flying keys are blocked in 'edit' (ctx.keys.block), so it does not drift by keys. editor3-flying.test.ts ED-3 test flipped
  (now: crash -> edit:to-edit, the re-armed respawn stays edit, off-then-on flies). Tests editor3-flying + editor3-tools 19/19,
  NEG OK (neg_control.py ref HEAD f6e5042a, fly-mode.ts and course.ts), apps/fly tsc 0, tools/bench tsc 0,
  a6-reference 1/1 pass.
- [x] left 4 (2692c7c2): probe run kbd-<scene> (KBD, keyboard chosen): W held 600 ms -> armed, mode; Space -> 'fly'; Space ->
  'edit'; Insert until the course stops growing, then Add gate: the top bar line, digitInLine, a click after it adds
  nothing; shot editor3-full-1920.png. ED-4 step after the flight in scene(): Add gate, click at 0.85 of the height, 4 s,
  problems before/after, shot editor3-floor-add-1920.png (Wroclaw: editor3-wroclaw-floor-add-1920.png).
- [x] left 5 run (release of 4bedab95 = code of 2692c7c2; after1 lock 01:57:37-02:01:16, after2 02:01:19-02:05:13;
  evidence U:/Temp/gsfpv-train3/editor3/h1/after1/e4.json and after2/e4.json). Facts:
  - one set at a time seen: turnTool 'turn', sizeTool 'size', moveTool 'move' on both scenes. LOOKED at
    shots/editor3-drag-1920.png (Tunis): only the Move arrows on the gate, the window closed (title "Course editor" only),
    top bar Add gate, Undo, Redo, Save, Courses, Keys, Exit with capitals, the gate bar's 11 buttons readable.
  - turn (the ring found by walk): Tunis quatChange 0.39 at r 190 (diagonal), movedM 0; Wroclaw 0.39 at r 40, movedM 0.
    PROVEN on both.
  - scale (key T, the centre box at r 0): Tunis opening 1.2 -> 1.58, Wroclaw 1.5 -> 1.94, movedM 0, quatChange 0. The
    Wroclaw scale fault is gone (PROVEN).
  - look on Tunis (right button 140 px): atMovedM 0.48, eye 0 (PROVEN; was 0). Keys W S D A E Q 2.4-2.53 m on both.
  - ED-3 seen: Tunis flight steps 0-33 mode 'fly', step 34 'edit' (a crash: the edit view came back and the flight loop
    saw it stay; Wroclaw 60 steps flown). course.next stayed 0 on both (no gate passed; camera-drone profile).
  - ED-2 (kbd run, keyboard chosen, Tunis): W held 600 ms -> armed false, mode 'edit', the edit camera moved 2.27 m;
    Space -> mode 'fly', armed true in 305 ms. A second Space did NOT disarm (mode 'fly', armed true after 4.3 s).
  - ED-4 floor add (click at 0.85 of the height): gates +1 on both; Tunis problems 3 -> 6 (the new gate has problems, likely
    red), Wroclaw problems 2 -> 2 (not red). The new gate's screen point was behind the camera (z -1) in both: the
    added gate is placed but not in view. Shots editor3-floor-add-1920.png, editor3-wroclaw-floor-add-1920.png NOT looked at.
  - kind button: Playwright click timed out on both (log cut at 120 chars; c0b99584 records the reason and clicks as a person).
  - moveX: hit null on both: hitAt returned the axis '' (fixed in c0b99584: the axis is the mesh node name after ':').
  - full course: not reached (the second Space left the drone flying, so Insert went to the flight; fullGates 20).
  - phone 844x390: top bar one line 409 px wide at y 4; gate bar 410x42 at 354,186 (before c0b99584's new place).
- [x] c0b99584: the gate bar sits centred BAR_CLEAR_PX 210 below the gate (above when no room, the bottom edge on a phone):
  on 1920 it covered the X arrow's head (seen in editor3-drag-1920.png). Test editor3-gatebar flipped, with -tools, -mouse,
  -press 21/21, NEG OK (neg_control.py ref HEAD 4bedab95, bar-place.ts), apps/fly tsc 0, tools/bench tsc 0.
  view-mouse.ts hitAt reads the axis from the hit's meshInstances[0].node.name (PlayCanvas 2.23.2 playcanvas.mjs 121283, 121530).
- [ ] left (next worker, in this order):
  1. ED-2 second Space: in the mode the keyboard pilot's Space armed but did not disarm. Read apps/fly/src/devices/keyboard.ts
     (line 5 says "Space up" in one mode, line 11 "Space arms"; editModeArm line 73-77) and controls.ts toggleArm (line 371):
     while flying in the mode Space may be throttle; decide the disarm press (Space again is the owner's expectation) and fix
     in keyboard.ts with a test; a6-reference after (keyboard.ts is input).
  2. ED-4: the floor-added gate's screen point is behind the camera (z -1) and Tunis problems went 3 -> 6. Read add-place.ts
     addPoint for a downward ray; the camera should aim at the new gate (course.ts placeAt: aim() as for duplicate). Look at
     shots/editor3-floor-add-1920.png first.
  3. Startup line (course.edit.opened, 4 languages) still says "drag its arrows, rings or centre box": say one set at a time
     (Move, Turn, Size on the gate's bar).
  4. Release build, then `OUT=U:/Temp/gsfpv-train3/editor3/h1/after3 SCENES=887f27aa,70b50d42 KBD=0 PHONE=0 bash
     U:/Temp/gsfpv-train3/editor3/h1/run.sh` and `OUT=.../after4 SCENES=887f27aa KBD=1 PHONE=1 bash .../run.sh` (each under
     10 min of lock): read moveX (hit axis 'x', screenPx follows 80 px), kindButton/kindClickError, full (digitInLine false,
     gatesAfterClick unchanged), floorAdd; LOOK at editor3-drag-1920.png (bar under the gate), editor3-844.png,
     editor3-full-1920.png.
  5. gates.py --only vitest,architecture,i18n,b18 (not run in pass 2).

Stage H2-prove (train 3 wave 2):
- [x] H2.0 release of 7fcdeb5b built (build-release sha 7fcdeb5b, 1932 files); run1 of the H1 probe on it queued
  (OUT h2/run1, both scenes, PHONE=1)
- [x] H2.1 (this commit) left 2: course.ts placeAt calls aim() after an Add gate (the camera goes to the new gate);
  left 3: course.edit.opened in en, es, pl, ru names Move, Turn, Size on the gate's bar instead of all three handles.
  Probe tools/bench/src/editor3-prove.ts: shots editor3-move/turn/size/flying-1920.png and editor3-wroclaw-1920.png (Move on
  Wroclaw); undo and redo by the top bar's buttons after the X drag, the ring, the size box, the kinds, Duplicate, Delete and
  the floor Add; each kind once from the bar; the bar's Next and Previous; Save against a stand-in of /api/tracks routed
  inside the browser context (nothing leaves the PC) and the page loaded again; the flight steers forward only when the gate
  is near the middle; the phone run reads what lies on the selected gate. tools/bench tsc 0, apps/fly tsc 0.
- [x] H2.2 run1: release of 7fcdeb5b (no aim fix yet), the probe of cc5ccea2 (tsx read it at start), GPU lock 02:14:17-02:20:25,
  `OUT=U:/Temp/gsfpv-train3/editor3/h2/run1 KBD=0 PHONE=1 bash U:/Temp/gsfpv-train3/editor3/h1/run.sh`, evidence
  h2/run1/e4.json. Facts:
  - course by Shift+G: Tunis 6 gates in 38.2 s, Wroclaw (walls stand-in) 24 gates in 25.6 s.
  - frames: before the mode 30.1 / 30.2 fps, in the mode 30.0 / 29.9 fps, while dragging 30.0 / 30.0, longest frame gap
    34 ms in each; the whole path: longest long task 84 ms (Tunis) and 115 ms (Wroclaw), 3 long tasks each, longest gap
    134 / 100 ms. Under the 200 ms aim. Measured while holding the GPU lock.
  - PROVEN on both: Add gate + click (+1 gate, the new gate selected); a click on another gate (Tunis 6, Wroclaw 17); Tab
    (focus stays BODY); the bar's Delete (ED-1: handles true, dragging false, handles at the selected gate, bar shown);
    Turn from the bar (tool 'turn', ring found at r 172 / 40 px, quat change 0.518, moved 0 m); Undo and Redo of the turn
    by the top bar (undo gives the old quat, redo the turned one); Undo and Redo of the floor Add (7 -> 6 -> 7 gates);
    the right-button look (look point moved 0.48 m, eye 0).
  - FAULT (blocks the rest of the path): Size from the bar, the centre box under the press (hitAt 'size' at r 0), three drags:
    opening unchanged, moved 0 on both. LOOKED at shots/editor3-size-1920.png: the edit camera looks straight up into a
    tree, no gate on screen: the three drags turned the VIEW (the left drag on empty space looks), so the scale gizmo did not
    take the press. In H1 (after2, key T, no Undo/Redo before it) the same drag scaled. Differences now: Size by the bar's
    button and the top bar's Undo + Redo just before (both call showEd -> view.put()). With the gate off screen the gate bar
    is hidden (visibility) and every later step (each kind, Next, Previous, Duplicate, Delete, the X arrow: hit null) clicked
    the canvas: none made an undo step (each Undo after them undid the turn again).
  - flight (fake pad, camera-drone profile, no arming): mode 'fly', 110 steps of 250 ms, course.next stayed 0 on both;
    disarm brought the edit view back (eye 0 m off). Not a proof of a pass.
  - floor Add (no aim fix in this build): the new gate behind the camera (z -10 Tunis, -2 Wroclaw), Tunis problems 3 -> 6.
  - Save (local /api/tracks stand-in): the name field took the focus (ce-name), 'Probe H2' + Enter; refused: "Not saved: fix
    the red gates first. Problems: 3. the way from gate 0 to gate 1 goes through a wall" (the generated Tunis course plus
    the added gate had red gates). The text says "gate 0": a 0-based number shown to the pilot (see For the lead).
  - Esc, Esc did not close the mode on either scene (exit.closed false; likely the focus in the name field: Esc gives it back
    first).
  - phone 844x390 (Tunis): top bar one line 409x36 at y 4, gate bar 410x42 at 58,340, both inside the screen; the selected gate
    at 263,160 with the canvas on top (nothing covers it). editor3-844.png NOT looked at.
- [x] H2.3 a release of cc5ccea2 was built (h2/build2.log sha cc5ccea2, dist in the worktree); its runs (h2/chain.sh) were
  stopped in the lock queue at the reply budget (no lock taken, no result).
- [ ] left (next worker, in this order):
  1. The Size press after Undo/Redo. Reproduce in one short probe run on Tunis (dist of cc5ccea2 is there; rebuild only
     if apps/fly changes): select a gate, Size by the bar, drag the centre box (expect scale), then top bar Undo + Redo,
     drag again; and the same with the key T. Read view-mouse.ts put() and setTool(): after put() for the same gate the
     ScaleGizmo may be re-attached without its shape (enableShape / uniform) or left muted (press-owner muted list).
     Fix with a test in tools/bench/test/editor3-tools.test.ts and a negative control.
  2. Probe: after each step record the camera's look point, and if the selected gate is off screen press Tab, Shift+Tab
     (the view glides to it) before the next step, so one fault does not void the rest. Record the Size click error.
  3. Save: the course must be clean first. Read problems before the edits; delete the red gates by the bar (or take the
     course the save selects: Save with red gates selects the first one) until problems is 0, then Save; Esc the name
     field once before the two Esc of exit.
  4. Flight pass: next stays 0 with the camera drone and a steered pad. Put gate 1 (index 0) 6 m ahead of the drone's
     spawn facing it (read the drone pose from window.__gsfpv if exposed; else Add gate with a click at the screen centre
     right after arming and disarming at spawn), then pitch forward only.
  5. `bash U:/Temp/gsfpv-train3/editor3/h2/chain.sh` (build, run2a both scenes, run2b Tunis KBD=1 PHONE=1, each run under
     its own lock of at most 590 s); LOOK at editor3-move/turn/size/flying-1920.png, editor3-wroclaw-1920.png, editor3-844.png
     and write the one-line Blender/Unity verdict for each.
  6. mouse-free-probe, accept-fly B6 B7 B9 B10 B11 B12 B13 B14 B15 B16 on the local address, a6-reference,
     gates.py --only vitest,architecture,i18n,b18; then "What the owner does" rewritten from the proven steps.
  7. ED-2 second Space (For the lead) unless the lead decides.

H2 pass 2 (stopped at the reply budget; the GPU lock was held by another lane from 02:21 to 02:28 and 02:31 to 02:46):
- [x] view-mouse.ts hitAt read the axis wrong: PlayCanvas 2.23.2 _getSelection (playcanvas.mjs 121263-121300) returns the
  nearest shape's mesh instances, not hit records; now `sel[0].node.name` (hits now name 'xyz', 'y', 'z'). debug() also
  gives each set's [enabled, nodes, _selectedAxis, _hoverAxis], `muted` and `lock` (pointer lock) for the probes. apps/fly
  tsc 0, tools/bench tsc 0. Release of this code built (h2p2/build1.log, sha 740da9b2 plus these two files).
- [x] probe REPRO=1 (tools/bench/src/editor3-prove.ts sizeRepro; clickBar now returns what lies under its press and the
  bar's visibility): `REPRO=1 OUT=U:/Temp/gsfpv-train3/editor3/h2p2/repro2 SCENES=887f27aa PORT=5804 bash
  U:/Temp/gsfpv-train3/editor3/h1/run.sh` (lock 02:46:53-02:47:56). Facts (Tunis, 18 gates, gate 2 selected):
  - left 1 (the Size fault of run1) does NOT reproduce: 5 of 5 centre-box drags scaled with movedM 0 and the look point
    still (lookAtMovedM 0): the bar's Size (1.5 -> 1.94 m), then top bar Undo + Redo (undo and redo both proven) and again
    (1.94 -> 2.5), the key T (2.5 -> 3.23), Undo + Redo then the bar's Size (3.23 -> 4.17), Undo + Redo then T (4.17 ->
    5.38). During each press only the size set was on (muted 2), its _selectedAxis 'xyz', no pointer lock. So the run1
    fault is not "Size after Undo/Redo"; its cause is still unknown (the run1 course had 6 gates and the gate was 3.1 m away).
  - NEW FAULT (blocks run1's later steps the same way): after the centre-box drags the gate bar stays hidden
    (visibility hidden while the gate is on screen and no drag runs): before the first drag the bar's Size lay under its
    press (bar:size, visible); after three drags the bar's Turn and Size presses hit the CANVAS (bar hidden), so Turn
    could not be chosen (both ring tries ran with tool 'size'). barPlace (bar-place.ts) is not null for a gate on screen, so
    GateBar.hidden stayed true: hide(true) comes only from course.ts dragTo(end false) (a transform:move) and the to-fly
    change. Suspect: a transform:move after the drag ended (the gizmo's own pointerup returned while the grown box was under
    the cursor, playcanvas.mjs 121438-121448: `_hover` sets _hoverAxis first, so `_dragging` reads false and no
    transform:end is sent; the onUp guard ends ours, a later pointer move then reads the stale drag).
  repro1 (h2p2/repro1) had a Tab + Shift+Tab between tries, which sets Move by design (toolAfter); not a fault.
- [ ] left (next worker, in this order):
  1. The hidden bar: let the bar hide only while the view really drags (GateBar host `dragging()` from EditView.dragging,
     instead of the hide flag set by dragTo), and in view-mouse.ts end a gizmo's stale drag on pointerup (detach and attach
     the shown set when its _selectedAxis is still set after the up, which fires its POINTERUP, playcanvas.mjs 121449-121454).
     Test in tools/bench/test/editor3-gatebar.test.ts or editor3-tools.test.ts, negative control, apps/fly tsc. Then the same
     REPRO run: every bar press after a drag must say bar:<id> visible, and the ring tries must turn.
  2.-7. as items 2-7 of the H2 list above (probe camera look point and re-aim; Save on a clean course; flight pass with the
     gate ahead of the spawn; chain.sh and the six pictures; mouse-free-probe, accept-fly, a6-reference, gates.py; ED-2).

Old list of pass 1 (items 1-4 done above):
- [ ] left (next worker, in this order; stopped at the reply budget of 30):
  1. the 'before' run: if U:/Temp/gsfpv-train3/editor3/h1/before/e4.json exists, read it (release of bb670ead, both scenes);
     else skip it: the lock was held by another lane from 01:37 and the run was stopped at the budget.
  2. probe tools/bench/src/editor3-prove.ts for one set of handles: before the ring step click
     `.ce-gatebar [data-bar="turn"]` and record dbg().tool; before the centre box press the key T; before the X arrow read
     tool 'move' (set by Shift+Tab to another gate: toolAfter). Find the press point by walking out from stand.screen along
     the axis in 6 px steps with window.__gsfpvEditHit(x, y) until it names the shown tool (ring radius read from the gizmo),
     then press there. Record the radius found.
  3. ED-3 per the lead's wording (after a crash the view returns to the edit camera and stays there): fly-mode.ts today keeps
     flying through a crash (review ED-3 decision of the fixes stage, test editor3-flying.test.ts line 122). Change to: a crash
     in 'fly' goes to 'edit' and holds there while the keepArmed respawn re-arms; flying again needs armed seen false then
     true (switch off/on, or Space). Update that test (its expectation flips), negative control on fly-mode.ts. Look for a way
     to disarm the respawned drone from course.ts first (else it may drift while the edit view shows); a6-reference stays.
  4. probe ED-2 step: in the keys step read controls.gate.armed and mode after W (must stay false/'edit'); then Space: mode
     'fly'; Space again (or disarm): 'edit'. ED-4 step: Add gate, click at 0.85 of the height (floor), wait 4 s, record the
     new gate's paint/problems (not red) and a screenshot editor3-floor-add-1920.png; look at it.
  5. a release build of this branch, then `OUT=U:/Temp/gsfpv-train3/editor3/h1/after PHONE=1 bash
     U:/Temp/gsfpv-train3/editor3/h1/run.sh` (both scenes, port 5801, lock taken only around the probe, 590 s cap); read
     turn quatChange > 0 with movedM 0, scale opening changes with movedM 0 on Wroclaw, kind click ok, look atMovedM > 0 on
     Tunis; LOOK at editor3-drag-1920.png and editor3-wroclaw-drag-1920.png (one set of handles, window closed) and
     editor3-844.png (the gate bar with 11 buttons readable at 844 wide).
  6. full course with Add gate in a browser (the text is unit-tested only); gates.py --only vitest,architecture,i18n,b18.

## Facts (measured)

- E4 (tools/bench/src/editor3-prove.ts, SITE http://localhost:5800, release of d726a3cb with the Wroclaw walls stand-in in
  dist/walls/70b50d42/v1, GPU lock, headless 1920x1080, fake DJI pad; U:/Temp/gsfpv-train3/editor3/e4/e4.json):

| | Tunis 887f27aa | Wroclaw 70b50d42 |
|---|---|---|
| controller taken (source) | gamepad | gamepad |
| Shift+G course | 13 gates, 33.9 s | 22 gates, 49.9 s |
| 5 s before the mode: fps, longest gap, longest long task | 29.8, 67 ms, 0 | 29.9, 34 ms, 0 |
| 5 s idle in the mode | 29.9, 34 ms, 0 | 30.0, 34 ms, 0 |
| during the drags | 30.0, 34 ms, 0 | 30.0, 34 ms, 0 |
| whole path (open to exit): longest long task | 0 ms | 0 ms |
| Add gate + click on the scene | 13 to 14, new gate selected (2) | 22 to 23, selected 2 |
| click on another gate | 1 to 0 at once | 1 to 4 (second try; first target 5 missed) |
| Tab | 0 to 1, focus BODY | 4 to 5, focus BODY |
| bar Delete on gate 1 | 14 to 13 | 23 to 22 |
| X arrow, ring, centre box drags | all 0 (fault 1) | all 0 (fault 1) |
| W S D A E Q 600 ms each, m | 2.53 2.4 2.4 2.4 2.4 2.4 | 2.4 2.54 2.4 2.53 2.53 2.4 |
| right button 140 px: eye, look point | 0, 0.48 m | 0, 0.49 m |
| pad sticks: mode, back to edit, edit eye moved | fly, edit, 0 m | fly, edit, 0 m |
| a gate passed while flying | no (next 0) | no (next 0) |
| page errors | 0 | 0 (403 console lines as in E2) |

  Screenshots (looked at): editor3-select-1920.png: Tunis, top bar and window right, the selected square far ahead and small,
  no handles, no gate bar (fault 1). editor3-drag-1920.png: the same view, the gate red, "Problems: 3" (the added gate's
  leg goes through a wall), nothing moved. editor3-wroclaw-1920.png: Wroclaw, the selected gate red at mid-left, no handles,
  "Problems: 4". editor3-844.png: handles drawn large on the gate, but the top bar wraps and the window covers half the
  screen (fault 3).

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
- E2 smoke (pass 2): tools/bench/src/editor3-smoke.ts, SITE=http://localhost:5800, local release with the Wroclaw walls
  stand-in in dist/walls/70b50d42/v1, GPU lock, headless 1280x800, 2026-11-14, runner U:/Temp/gsfpv-train3/editor3/e2s/run.sh.
  Run 1 (release of 7658ddfb, e2s.json), both scenes; run 2 (release of 529da832, e2s2.json), Wroclaw complete:

| | Tunis 887f27aa (run 1) | Wroclaw 70b50d42 (run 1 / run 2) |
|---|---|---|
| handles attached, gizmo layer on the camera, pointer lock | yes, yes, none | yes, yes, none |
| W S D A E Q held 700 ms each (m moved, speed 4 m/s) | 2.93 2.8 2.93 2.93 2.8 2.8 | 2.94 2.8 2.8 2.8 2.93 2.8 / 2.4 2.8 2.8 2.8 2.93 2.8 |
| right button drag 120 px: eye moved, look point moved | 0, 0.43 m | 0, 0.30 / 0, 0.43 |
| wheel up 300: speed | 4 to 5.4 | 4 to 5.4 |
| click on another gate | gate 0 to 6 | run 1 missed (gate 1 at 17 m stayed 0); run 2 gate 0 to 2, under the cursor CANVAS |
| gate bar (run 2 only) | Next button: Playwright click timed out (not stable: the bar moves every frame) | visible at 598,385, Next 3 to 4, focus BODY |
| drag on the centre box: opening | 1.2 to 1.2, gate moved 0.44 m | 1.5 to 1.5, moved 2.24 / 0.3 m |
| drag on the x arrow at 70 px | moved 0.4 m | 2.3 / 0.4 m |
| drag on a ring at 130 px (110 px missed) | turned (quat change 0.39) | 0.131 / 0.39 |
| Ctrl+Z after the turn | turn undone (0.39) | undone |
| Esc, Esc | editor closed | closed |
| page errors | 0 | 0 (six 403 console lines on Wroclaw, not traced) |

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

- H2: ED-2 second Space. A keyboard pilot (game scheme, the default) arms in the mode with Space (devices/keyboard.ts
  editModeArm), but while flying Space is the climb key (keys.ts GAME_KEYS), so a second Space cannot disarm; the game pilot
  disarms only when landed (play/game-pilot.ts arm.stop). Decision wanted: a key or a top-bar button "Back to editing" while
  flying in the mode that calls the game pilot's arm.stop() (input code, outside this lane), or the edit view held like a
  crash (fly-mode.ts hold) with Space releasing the hold. Not changed in H2.
- H2: the save refusal says "the way from gate 0 to gate 1 goes through a wall": a 0-based gate number shown to the pilot
  (problemsLine / the check's reason text, packages/tracks or course3's texts).
- H2 outside the editor folder: apps/fly/src/app/builtin/course.ts placeAt (one line: aim() after Add gate),
  packages/i18n/locales/fly/course/{en,es,pl,ru}.json (course.edit.opened rewritten), tools/bench/src/editor3-prove.ts.

- H1 pass 2 outside the editor folder: apps/fly/src/app/builtin/course.ts (crashHold, 3 lines: ED-3 holds the edit view
  after a crash until a fresh arm), tools/bench/src/editor3-prove.ts, tools/bench/test/editor3-flying.test.ts and
  editor3-gatebar.test.ts. ED-3 changes a rule: a crash in the mode's flight now returns to editing (was: flies on).

- Stage E3 touches outside the editor folder: apps/fly/src/app/builtin/course.ts (top bar, Add, flying wiring, no
  ctx.pause('panel')), packages/i18n/locales/fly/course/{en,es,pl,ru}.json (5 keys), tools/bench/test/editor3-flying.test.ts
  (new), tools/bench/test/editor3-gatebar.test.ts (ids).
- E3 changes a rule: the edit mode no longer pauses the flight. The 'pause' event no longer carries 'panel' for the editor,
  so the lap HUD is hidden by hud.update(null, 0) in showEd, not by coveredBy. A drone flying when the mode opens keeps flying
  with its own camera; the edit view comes when it disarms or crashes.
- Hook wanted from lane course3 (packages/tracks): an EditAction that adds a gate at a pose after the selected one
  (`{ kind: 'add', pos, quat }`); until then add-place.ts addInState builds that state (and its own copy of nextGateId,
  freeGateId). A read-only `flying` field in course/hook.ts CourseEditorHook would let the probes read the mode; today the
  probe reads `mode` from window.__gsfpvEditView().
- A full course (MAX_GATES_EDIT) with Add gate falls back to the Insert key, which says the editor's own refusal text.

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

- E3 in a browser: none of it walked yet (the browser proof is its own stage). In particular whether the keyboard pilot's
  capture listener and the edit camera share W A S D without harm while disarmed (the keyboard source does not stop
  propagation; disarmed, its throttle does nothing, by reading, not run), whether pointer lock is taken by a click while the
  window is hidden in flight, and whether run.reset() on arming starts the course at gate 1 on the first pass.
- tools/bench/test/a6-reference.test.ts not run: E3 does not touch flight, input or collision code (course.ts only reads
  sim.armed and sim.crashed).
- The new numbers are estimates, not measured: ADD_BACK_M 1.5, ADD_AHEAD_M 6, ADD_MIN_M 1, ADD_RAY_M 200.

- E2.2/E2.3 in a browser: whether PlayCanvas 2.23.2's gizmos draw and drag on our renderer camera (the gizmo layer is added to
  the camera's layers), whether the fly page's own canvas listeners (pointer lock request on click) disturb a click while the
  editor is open, whether a live redraw per frame (stage.show of all gates) is smooth on Wroclaw's 24 gates. Pass 2 smoke
  (Facts, E2 smoke) answered: the gizmos draw and drag, a click selects, the keys and the right button move the view, no
  pointer lock is taken. Still open: the scale box drag, the gate bar's Next on Tunis (probe click not stable), frame
  smoothness during a drag (not measured), the six 403 lines on Wroclaw.
- Pass 2 outside the editor folder: apps/fly/src/app/builtin/course.ts also creates the GateBar and sets a read-only
  window.__gsfpvEditView (the probe's view of the handles); new tools/bench/src/editor3-smoke.ts and
  tools/bench/test/editor3-gatebar.test.ts.
- The new numbers are estimates, not measured: CAM_SPEED_M_S 4, CAM_WHEEL_STEP 1.35, CAM_FAST 3, CAM_DEG_PER_PX 0.2,
  PICK_PAD_M 0.15, CLICK_SLOP_PX 4, turn gizmo size 1.5.

- Why the owner's Tab did nothing (headless Tab worked); see Facts.
- The probe ran headless on this PC's GPU at 30 frames per second; the owner's laptop numbers will differ.
- ArrowRight and PageUp were applied (the said line stayed "Moved", the probe's change detector could not tell); their long
  tasks were measured.

## What the owner does (mouse first; to be checked again after E4.4-E4.6)

1. Shift+B (or the pause menu's Edit course): the same scene, the top bar appears: Add gate, Undo, Redo, Exit.
2. Click a gate: the arrows, rings and the centre box appear on it, the small bar right of it.
3. Pull an arrow to move, a ring to turn, the centre box to resize; Ctrl held for no snap; Ctrl+Z undoes a drag.
4. The bar: ring, square, dive, cube change the kind; Duplicate; Delete; the arrows go to the previous and next gate (Tab too).
5. Add gate, then click on the scene where the gate goes.
6. W A S D move the view, E up, Q down, the right button held looks, the wheel sets the speed.
7. Move the sticks of the controller (or arm it): the view is the drone's, fly the course; disarm or crash: the edit view
   comes back where it was.
8. Exit (or Esc twice) leaves; Save in the window keeps the course.

## Cost notes

- G2-bar-space-floor: about 50 replies; the most went to waiting on the GPU lock held by others (three 9-minute give-ups) and
  to a first fix written from reading PlayCanvas (stopPropagation) before a measurement; the REPRO record of the first bar
  click (bar hidden with no drag at all) named the real cause in one run, so a 60 s REPRO before any code would have saved
  a build and two replies.

- G1-merge-hooks: about 34 replies; the most went to a release build started before the last source change (killed and
  rebuilt, 2 extra replies) and a 9-minute GPU lock wait that ended with no run; adding every page hook before the first
  build, and starting the lock wait right after the build in one command, would have saved both.

- H2-prove: about 32 replies; the most went to extending the probe with every step at once and then finding that one fault
  (the Size drag turned the view) voided all later steps; a probe that re-centres the selected gate after each step, and one
  short run on one scene before the full path, would have shown the fault and kept the rest of the evidence.

- H1 pass 2: about 40 replies; the most went to reading the probe's results field by field and finding PlayCanvas's
  selection shape (hitAt's axis was always ''); a probe that asserts each hook field once (axis non-empty, tool set) in a
  60 s smoke before the full run would have caught the '' axis and the Space disarm a run earlier.

- H1: about 30 replies; the most went to reading view-mouse.ts, course.ts and the probe in slices and to a 'before' probe that
  waited on the GPU lock held by another lane (01:37 onwards), so no browser run fitted; a lock queue that says the holder
  and its end time, and a probe step list kept in the status file, would have let the code go first and the run land.

- fixes pass 2: about 33 replies; the most went to the release build (about 6 minutes) and the probe run waited out, and to
  reading the locale and panel layout for ED-7; starting the build and the probe as the first command and writing ED-5/6/7
  while they ran saved most of the wait; a probe that reads the gizmo's ring radius instead of fixed radii would have
  made the turn step prove something on the first run.

- fixes: about 30 replies; the most went to reading PlayCanvas gizmo internals again for ED-1 and a diagnosis run that got no
  course on Tunis in 240 s (gates 0), so it recorded nothing; a probe that loads a saved course file instead of generating
  one would make the diagnosis certain and cut 5 minutes per run.
- E4-prove pass 2: about 30 replies; the most went to waiting 25 minutes on a GPU lock held by another lane (my run.sh had a
  15-minute timeout and died in the queue) and reading PlayCanvas gizmo internals to guess fault 1; a lock queue with
  the holder's name and expected end, and the diagnosis fields in the probe from the first run, would have saved both.
- E4-prove: about 30 replies; the most went to one wasted 25-minute probe run (tsx's __name in an init script and a
  480 s course wait); writing the probe's init script as text from the start and a 60 s smoke on one scene before the full
  run would have saved the run and three replies.

- E3 panel-and-flying: about 25 replies; the most went to reading course.ts's wiring (924 lines) in slices to find where the
  pause, the key block and the frame event live; a short wiring map of builtin/course.ts in docs/agent-map.md would save
  three replies.

- E1: the live run took about 20 minutes of waiting (Wroclaw walls build plus two 5 s freezes per key); a wait loop of 9
  minutes cost one reply; reading the whole PlayCanvas export line cost context. The fix did not fit in the 30 replies.
- E1 pass 2 (E2.1): about 25 replies; most went to finding the test layout (apps/fly tests live in tools/bench/test) and the
  probe JSON shape; a line in docs/agent-map.md on both would have saved four replies.
- E2 mouse-and-camera: about 30 replies; most went to finding the gate frames (scan vs flown, w-first quaternions) and the
  PlayCanvas gizmo API in a 77k-line d.ts; a note in agent-map.md on the course frames and the quaternion order would save
  five replies. No browser run fitted.
- E2 pass 2: about 30 replies; most went to two release builds plus probe runs (about 8 minutes each, waited in one blocking
  call) and reading PlayCanvas shape names from build/playcanvas.mjs; a probe that takes a prebuilt dist and only one
  scene per run would halve the wait.
- H2 pass 2: about 27 replies; the most went to reading PlayCanvas gizmo internals to guess the Size fault and to 16 minutes
  in the GPU lock queue; a short REPRO run with each gizmo's own state in the debug hook answered it in one run, and should
  have been the first step.
