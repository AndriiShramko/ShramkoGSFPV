# Lane editor3: the course editor as an edit mode of the same scene (train 3)

Branch editor3 from origin/main 197c2760, worktree C:/dev/gsfpv-voice, ports 5800-5819.

## Status

Stage I3-prove (train 3, 2026-11-15):
- [x] I3.0 merge origin/main b5b62d47 (lead notes only): 02b162e5. Release build of that tree started
  (U:/Temp/gsfpv-train3/editor3/i3/build.log).
- [x] I3.1 probe editor3-prove.ts (76ffff2c): the pad flight puts the selected gate 6 m ahead of the drone
  (__gsfpvEditPutAhead 6, 1, 2.5 as one drag, one Ctrl+Z after). Release build exit 0, release.json sha 76ffff2c (app tree
  of 02b162e5). Chain U:/Temp/gsfpv-train3/editor3/i3/chain.sh (log chain.txt) and tunis2.sh (the chain's two Tunis tries
  each waited 9 min for the lock). tools/bench tsc exit 0.
- [x] I3.2 runs (records i3/tunis/e4.json lock 13:47:16-13:51:08, i3/wroclaw/e4.json lock 13:27:01-13:30:51,
  i3/clean/clean.json Tunis lock 13:30:55-13:32:19, i3/clean/clean-70b50d42.json): see 'What the owner does'.
  accept-fly B6 B7 B9 B10 B11 B12 B13 B14 B15 B16 10/10 PASS (first line 'accept-fly target: http://localhost:5805').
  mouse-free-probe exit 1: TimeoutError waiting for [data-action="pause.rooms"] (the rooms entry, known on a local release
  without the rooms service); every check before it printed PASS. a6-reference.test.ts exit 0. gates.py --only
  vitest,architecture,i18n,b18 on 76ffff2c: all PASS (vitest 277 s).
  Pictures looked at: editor3-turn-1920.png and editor3-size-1920.png (Tunis), editor3-wroclaw-1920.png. Not looked at this
  pass: editor3-move-1920.png, editor3-flying-1920.png, editor3-edit-clean-1920.png (taken 13:48:45, 13:49:38, 13:31:37).
- [ ] I3.3 left (next worker, in this order):
  a. Probe editor3-prove.ts pad flight: the selected gate at that point is gate 20 (index 19, the X-arrow gate; shiftTabBack
     false on both scenes), so PutAhead moved gate 20 and course.next stayed 0; armed false, mode 'edit' at arming on both
     (150 steps 'fly' with next 0). Select gate 1 (Home or the bar's previous until index 0) before PutAhead and check why
     the pad did not arm (H3 pass armed with the same pad calls). The keyboard flight through gate 1 6 m ahead IS proven
     (clean.ts, below).
  b. Save not proven in this run: both scenes refused (Tunis: 'the way from gate 1 to gate 2 goes through a wall';
     Wroclaw: 'Gate 2 faces away from the way in'), redRemoved loops picked gate 17 again and again. So the fresh-page
     Courses reopen is not proven either (no reload record). In H3 Wroclaw saved; the new refusal 'faces away' is the check
     (lane fix3a's), not changed here.
  c. Add gate by the top bar: add.ok false on both (gates 24 to 24; Tunis said 'Moved. Gate 1 of 24', Wroclaw 'Click the
     place for the new gate'); the floor add later worked (24 to 25). Suspect the probe's click point (scene middle on a
     gate or a handle), not looked into.
  d. The Tunis pictures show the selected gate in orange, about 400-700 px and thick, not the yellow outline of Wroclaw;
     guess: the red of a problem gate mixed with the selection colour (course/editor view-mouse.ts). The turn picture shows
     the red ring edge-on as a line (D4 takes it, turn 60 deg per 60 px drag on x). Wroclaw: a red line crosses the whole
     view (the X axis guide during or after the drag?), not looked into.
  e. Wroclaw crash in the test flight still not produced (afterCrash mode 'fly'); the crash proof is Tunis only.

Stage I2-clean (train 3, 2026-11-15), pass 1 stopped at the reply budget:
- [x] I2.0 merge origin/main 7fb0ddf7 (lead notes only): 6c4aa696. Release build of 6c4aa696's tree exit 0
  (U:/Temp/gsfpv-train3/editor3/i2/build0.log), kept as U:/Temp/gsfpv-train3/editor3/i2/dist-before.
- [x] I2.1 code a11f109d: D5 editor.css hides also .mode-chip (the 'Stick in the centre' hint under the mode line),
  .hud .osd.bl (THR, speed, ALT), .osd.br (key hints), .osd.tr (voltage, time), .osd-col (F3), .rec-bar, .rec-dot,
  .rec-notice, .crash-overlay (the crash card) while the mode is open and not flying; .osd.tl (mode line) stays.
  D6 course/editor/line-hold.ts LineHold: a refusal stays until the next key or press that started after it
  (Event.timeStamp > the telling); what an edit did 3 s (DONE_MS, as before); top-bar.ts listens on window keydown and
  pointerdown (capture, modifiers and repeats are no action), the line's title holds the full text; the line is one line
  (nowrap, ellipsis, max-width 420 px). Probe hooks in course.ts: __gsfpvEditPutAhead(m, up, open) (the selected gate m
  ahead of the drone as one drag) and drone [x, y, z] in __gsfpvEditView. Probe tools/bench/src/editor3-clean.ts (run by
  U:/Temp/gsfpv-train3/editor3/i2/cl.sh NAME SCENE PORT DIST PARTS [CLIMB]; record i2/NAME/clean[-scene].json).
  Checks: tools/bench/test/editor3-i2.test.ts 5 pass (fake timers: the refusal on the line at 10 s and 60 s, gone at the
  next action); NEG OK (neg_control.py ref HEAD, top-bar.ts editor.css); apps/fly and tools/bench tsc 0 errors.
- [x] I2.2 before run (dist-before, Tunis 887f27aa, lock 12:10:08-12:12:01, i2/before/clean.json):
  - 1920 edit view: shown hint (mc-thr 'Stick in the centre'), THR line, key hints ('crashes 0 . R respawn'), REC row,
    voltage and time, and the Walls chip's panel open (.wv: walls switch, voxel grid, style, opacity, export, import).
    Top bar 660x40 with the gate line, 819x47 with the standing hint: the line is 2 lines (lineCount 2).
  - 844x390 edit view: the same parts shown; the top bar [8,82,381x52] covers the Walls switch (button.wv-switch) and the
    mode chip (button.mc-chip). The scene credit is '.attribution' (the probe's credit selector missed it: fix the probe).
  - D8 measured (keyboard source, the default profile 'easy' = the game scheme, play/keys.ts GAME_KEYS): Space armed in
    293 ms; W held 250 ms per step: speed 0.3 -> 7.1 m/s in 14 steps while the OSD said THR 28-31 % and ALT 0.0-0.1 m
    the whole time; step 20 the mode went back to edit (a crash, guess: ran into the ground or a wall at 7 m/s); Space
    disarm 19 ms. Cause (from the code, the number above agrees): the game scheme's only climb key is Space
    (GAME_KEYS lift +1) and in the edit test flight Space is taken as disarm (devices/keyboard.ts onDown, isGame &&
    Space && editModeFlying); the take-off hop (play/game.ts liftoff, TAKEOFF_HOP_M 1) did not show in ALT (0.1 m), not
    measured why. The gate was not ahead (no hook in that build).
- [x] I2.4 (pass 2) a, b, c done in the commit "editor3 I2 pass 2: ...": probe editor3-clean.ts: refusal by Ctrl+S (name
  field), a name filled and the window's Save clicked, the input blurred, then the line read at 1 s, 10.5 s and after M;
  crash: wait for mode fly, then only crashActive (15 s), then mode edit; credit '.attribution', the walls summary box and
  whether the walls menu shows; covers also lists summary and .attribution. D7 editor.css (max-height 500px): the Walls
  chip's open menu ([data-testid=walls-more] > :not(summary)) hidden in the edit view, the summary stays. D8
  devices/keyboard.ts: while flying in the edit mode a held Space climbs (the game scheme's lift) and a tap shorter than
  EDIT_TAP_MS 200 ms (an estimate) disarms on keyup; the arming press is never taken as that tap (editSpaceAt is set only
  by a press made while flying). course.edit.opened says so in en es pl ru. Checks: editor3-i2-space.test.ts 3 pass, NEG
  OK (neg_control.py ref HEAD, keyboard.ts); editor3-g2 (assertion moved to the tap) and editor3-i2 6 pass;
  a6-reference.test.ts pass; apps/fly and tools/bench tsc 0 errors.
- [x] I2.5 (pass 2) release build of b557c043's tree exit 0 (i2/build-after.log). Tunis 887f27aa after run (cl.sh after
  887f27aa 5801 dist kbd,desk,phone Space; lock 12:21:07-12:23:02; i2/after/clean.json, summary i2/after/sum-tunis.txt by
  i2/sum.py). Parts table (1 shown, 0 not): hint thr keys rec volt stats crash crashToast lap note gateMsg f3:
  - 1920 edit, refused 1 s, refused 10 s, after M, after the pad flight's disarm, after a crash, 5 s later: all 0; mode
    line 1, top bar 1, gate bar 1. Flying in the mode: hint 1, thr 1, keys 1, volt 1 (rec 0: the REC row shows only
    after Exit's flight). After Exit: hint 1, thr 1, keys 1, volt 1, lap 1.
  - Top bar one line (lineCount 1) in every 1920 state, covers nothing: [630,8,660,40], refused [580,8,761,40], idle
    [520,8,879,40], flying [788,8,344,28]. D6: the refusal ('The course was not saved this time. Press save again': the
    local server keeps nothing) on the line at 1 s and 10.5 s (refused true), gone after M (refused false).
  - Crash: crashActive true, then mode edit; crash card 0 after the crash and 5 s later.
  - 844x390 edit: all flight parts 0, Walls menu 0 (voxels 0), the bars' buttons 44x44; after Exit the menu is back.
  - Pictures looked at: editor3-edit-clean-1920.png (no flight part, gate 2 yellow, small handles, credit and 'Walls 5 cm'
    readable), editor3-after-crash-1920.png (no crash card; mode line 'CRASH . ANGLE'; but see left b), editor3-844.png
    (credit readable on two lines; the top bar hides 'Walls 5 cm', left a).
  - kbd (D8): Space armed in 287 ms, Space tap disarmed in 14 ms and the edit view came back (mode edit). The gate did NOT
    come ahead: course.next stayed 0 (left c).
- [x] I2.6 (pass 3) a, b, c in 5457e113 and 5a9144e8; gates fix below. a: top-bar.ts place() writes the lowest bottom of
  '.attribution' and [data-testid=walls-box] (+4 px) to --ce-below on show, resize, ResizeObserver and flying(); editor.css
  (max-height 500px) .ce-topbar top = max(top row + 4, --ce-below). b: .next-hint (ui/next-hint.ts) in the D5 hide list.
  c: probe kbd: height first (Space held gap / 4.2 s, 300 ms to 1 s, an estimate from runs 1 and 2: 3.8 m per about 900 ms
  held), Shift down, W only within 0.6 m of the gate's height, E when the gate is behind. The guess of pass 2 was wrong:
  arming did not move the drone (droneArmed [0,2,0] = the pose before); the probe never turned to the gate. Checks:
  editor3-i2.test.ts 7 pass, NEG OK (neg_control.py ref HEAD, top-bar.ts editor.css); apps/fly and tools/bench tsc 0.
  Release build of 5457e113's tree exit 0 (i2/build-p3.log). Runs (i2/after3, i2/after3-run1):
  - Tunis 887f27aa (lock 12:30:47-12:32:46, after3-run1/clean.json): 1920 edit, refused 1 s and 10 s, after M, after the
    pad flight, after a crash and 5 s later: no flight part shown (nextHint 0 too); top bar one line, covers nothing. After
    Exit: hint, thr, keys, volt, lap, nextHint back. 844x390: top bar [8,123,381,52] under the credit [16,44,396,75] and
    the Walls summary [16,79,396,40], covers nothing, buttons 44x44; flight parts 0 in edit, back after Exit.
  - Tunis kbd (lock 12:33:29-12:34:04, after3-run1/clean-tunis-kbd-run2.json): Space armed 277 ms, climbed ALT 0 to 3.8 m,
    course.next 0 to 1 at step 17, Space tap disarmed 283 ms, mode edit, no flight part after.
  - Wroclaw 70b50d42 (lock 12:34:33-12:37:05 and 12:49:25-12:51:48, after3/clean-70b50d42.json, first run
    after3-run1/clean-70b50d42-run2.json): edit, refused 1 s and 10 s, after M, after the pad flight: no flight part, top
    bar one line. Phone: top bar [8,105,381,52] under credit [16,44,378,57] and Walls [16,61,378,40], covers nothing. kbd:
    armed 293 ms, course.next 0 to 1 (second approach, step 49), disarm 46 ms, mode edit.
  - Pictures looked at: editor3-844.png ('Walls 5 cm' and the credit readable, the bar under them),
    editor3-after-crash-1920.png and editor3-after-flight-1920.png (Tunis: no crash card, no next-scene hint, no flight part).
  - gates.py --only vitest,architecture,i18n,b18 on 5a9144e8: architecture, i18n, b18 PASS; vitest 5012 pass, 1 fail:
    editor3-g3.test.ts (its regex did not allow the drone field a11f109d put into __gsfpvEditView); fixed in the test, that
    file and editor3-i2 10 pass; the full vitest was not run again.
- [ ] I2.7 left (pass 3):
  a. Wroclaw crash in the test flight not produced: 15 s of full pitch and throttle, then 12 s throttle down and full pitch
     met nothing (crashActive false, mode fly); so Wroclaw afterCrash and afterExit rows were taken while flying. Guess, not
     measured: open sky over the stand-in walls and a soft ground. The crash proof stands on Tunis only.
  b. The Wroclaw pictures (editor3-*-70b50d42.png of this run) not looked at.
  c. Wroclaw kbd: in the first approach the drone passed beside the gate (screen x 3485 at depth 0), stopped for 15 steps
     at 0 m/s still in mode fly (THR 37-56 %), then was at the start again; probe or sim, not looked into.
  d. The full vitest once more after the editor3-g3 test fix; 'What the owner does' item 9 (Space held climbs, a tap goes
     back to editing) not written yet.
- [x] I2.3 (pass 2 left list; a, b, c done in I2.6, d done in I2.6 except I2.7 a to c, e: I2.7 d):
  a. Phone: the top bar [8,82,381,52] covers the Walls chip's summary [16,79,396,40] ('summary.' in covers) and touches the
     credit [16,44,396,75] (two lines, ends at 119). Put the top bar below the bottom of '.attribution' and
     [data-testid=walls-box] (measure in top-bar.ts on show and on resize into a CSS variable used by the
     (max-height 500px) rule), re-run phone, look at editor3-844.png.
  b. After the crash the toast 'Want another place? Press N for the next scene' stands in the edit view
     (editor3-after-crash-1920.png, bottom middle): find its class (the locale key of that text, its ui file) and add it to
     the D5 hide list in editor.css and to editor3-i2.test.ts.
  c. kbd: __gsfpvEditPutAhead (course.ts 772) put the gate behind the drone: put returned drone [0,2,0], gate [6,3,0]; in the
     flight the gate's view depth went -1 to -24 while W flew 7.1 m/s, THR 28-29 %, ALT 0.0-0.1 m (Space never pressed:
     the probe climbs only when the gate is in front). Guess, not measured: forwardOf (course/editor/keys.ts, -z forward)
     read the sim's pose before arming, and arming puts the drone at the course start (Tunis yaw 180). Repair the probe:
     call the hook after Space (mode fly) or put the gate from the drone's pose after arming; steer: hold Space while the
     drone's y is under the gate's y - 0.2, E (turn) when the gate is behind, W only when it is ahead. Re-run kbd with
     CLIMB=Space: course.next 0 to 1, Space tap back to edit.
  d. Wroclaw 70b50d42 run (cl.sh after 70b50d42 5801 C:/dev/gsfpv-voice/dist kbd,desk,phone Space); look at
     editor3-after-flight-1920.png (not looked at yet) and the Wroclaw pictures.
  e. gates.py --only vitest,architecture,i18n,b18; this status and 'What the owner does' (item 9: Space held climbs, a tap
     goes back to editing).
- Old left list of pass 1 (a, b, c done in I2.4; d, e are d, e above):
  a. Probe fixes in editor3-clean.ts: the refusal: Ctrl+S opened the name field ('Your name' on the line), not a refusal;
     use Add gate + a floor click that gives a red gate on Tunis (H3: 'add -> red, the line names gate 2'), or the
     window's Save with a name typed; the crash: wait for mode 'fly' before the full-throttle push and then wait only
     for crashActive (the run read mode 'edit' before arming took effect, so afterCrash and afterExit were taken while
     flying); credit selector '.attribution'.
  b. D7 editor.css (max-height 500px): hide the Walls chip's open panel (.wv inside the chip; the chip's summary
     'Walls 5 cm' stays), keep the top bar off .wv-switch, .mc-chip (hidden now by D5) and '.attribution'.
  c. D8 repair: in the edit test flight with the game scheme give a climb that is not Space (a decision to make:
     Space held = climb and a short tap = disarm, or the take-off hop to the selected gate's height); then
     a6-reference.test.ts (input code) and an editor3-i2 test with a negative control.
  d. Release build, cl.sh after runs on Tunis and Wroclaw (kbd with the gate 6 m ahead, desk, phone), the four pictures
     editor3-edit-clean-1920.png, editor3-after-flight-1920.png, editor3-after-crash-1920.png, editor3-844.png looked at.
  e. gates.py --only vitest,architecture,i18n,b18; status and owner's part.

Stage I1-gizmo (train 3, 2026-11-15):
- [x] I1.0 merge origin/main 6999085a into editor3: 47f4d434 (no conflicts). Release build of 47f4d434's tree: exit 0
  (U:/Temp/gsfpv-train3/editor3/i1/build-before.log); that dist is kept as U:/Temp/gsfpv-train3/editor3/i1/dist-before
  for the before numbers.
- [x] I1.1 code (commit below "editor3 I1: frame selected ..."):
  - D1 course/editor/frame.ts frameGate: distance size / (2 * 1/3 * tan(vfov/2)), eye 35 deg aside of the gate's axis on the
    view's side, 20 deg above (a dive gate lying flat: 55 deg above); fallbacks in order +35, -35, +60, -60 at that distance,
    then nearer steps (x0.75) down to 1.5 gate sizes; a place is free when the walls ray from the gate's centre meets no wall
    before eye + 0.3 m; none free: the view stays (__gsfpvEditMeasure().frame = {blocked: true}). Glide 400 ms (blendCam);
    keys or look end it; a drag never moves the view. course.ts frames on every new selection (showEd, framedId) and aim()
    (refused Save, key select) now frames too; F frames again (view-mouse onKey, stops the page's F), CAM_ROWS 'F' with
    course.edit.cam.frame en es pl ru. Size = the opening (an estimate of the gate's largest size).
  - D2 course/editor/handle-look.ts: px sizes (arrows 90 px with 16x10 px tips, rings 85 px radius, lines 2.5 px, size
    cubes 12 px at 90 px, centre cube 14 px, pick tolerance 8 px); gizmo size = 100 / (0.3 * half extent px) so one gizmo
    unit is 100 CSS px (PlayCanvas 2.23.2 _updateScale); setTheme: x (0.96,0.16,0.16), y (0.18,0.84,0.18), z (0.16,0.42,1),
    hover and dragged yellow (1,0.86,0.08), alpha 1. Move planes off; Size shows x, y, z cubes for every kind. Tags beside the
    handle while dragged: course.edit.moveTag (m), course.edit.turnTag (deg), sizeTag (en es pl ru).
  - D3 course/view.ts PAINT selected bright yellow [1, 0.92, 0.25] (was magenta); the others unchanged.
  - D4 course/editor/ring-pick.ts: a ring whose drawn minor axis is under 25 px is taken by the edit view when the pointer is
    within 10 px of its line; turn = 0.5 deg per px of travel across the line (an estimate), snapped to 15 deg unless Ctrl.
  - Probe hook window.__gsfpvEditMeasure(): eyeDist, gatePx (the opening along the gate's up), viewH, rings (minor px x y z),
    parts (each shown handle mesh's page rectangle), frame. __gsfpvEditHit names an edge ring 'edge:x|y|z'.
  - Checks: tools/bench/test/editor3-i1.test.ts 10 tests pass; NEG OK (neg_control.py ref HEAD, view-mouse.ts course.ts
    view.ts keys.ts); editor3-*.test.ts 13 files 75 tests pass (editor3-h2look: the z cube is now always on); apps/fly and
    tools/bench tsc 0 errors.
- [x] I1.2 release build of 9aabf0e2's tree: exit 0 (i1/build-after.log). Probe tools/bench/src/editor3-gizmo.ts (7958afe4;
  MODE=before|after, SCENE, SITE; run by U:/Temp/gsfpv-train3/editor3/i1/gz.sh, which copies the Wroclaw stand-in walls
  into DIST/walls and holds the GPU lock around one run). Records U:/Temp/gsfpv-train3/editor3/i1/gizmo/gizmo-*.json.
  BEFORE (dist-before = 47f4d434's tree, 1920x1080, a gate selected by a click):
  - Tunis 887f27aa: after Tab the eye 18.43 m from a 1.2 m gate (height on screen 40 px, an estimate from the eye distance
    and the 115 deg field: 3.7 % of 1080); the clicked gate 0: eye 5.44 m, 135 px (12.5 %). Pick rectangles of the
    handles (__gsfpvEditHit grid, 5 px): move y 60x195, z 100x105, x 175x55; turn x 310x500, z 430x420, y 455x145; size
    y 70x170, centre 95x110, x 145x70.
  - Wroclaw 70b50d42: after Tab 21.6 m, 42 px (3.9 %); the clicked gate 0: 17.94 m, 51 px (4.7 %). Picks: move x 265x70,
    z 150x120, y 60x185; turn y 495x85, z 360x470, x 220x505; size y 205x225, centre 165x90, x 170x75.
  AFTER (dist of 5c51b4f1's tree, build-after2.log exit 0; gizmo-after-*.json; gizmo-after1-887f27aa.json is the run on
  9aabf0e2 before the two fixes below):
  - Tunis: the click selected gate 15 (from 1): eye 2.55 m, the opening 342 px = 0.32 of 1080; frame side 35, skipped 0.
    Tab x3 -> 16, 17, 18: each 2.04 m, 342 px (0.32), rings' minor axes 100, 63, 147 px. Flown away (S, D): 4.84 m,
    152 px; F: back to 2.04 m, 342 px.
  - Wroclaw: the click selected gate 2: 2.04 m, 342 px (0.32), side 35. Tab x3 -> 3, 4, 5: 2.55 m, 342 px, rings 67, 42,
    98 px. Flown away 5.2 m, 176 px; F: 2.55 m, 342 px.
  - Parts (the drawn extent from the mesh vertices, measure()): move head x 14x9, head y 10x18, head z 16x11, lines
    58x16, 3x73, 49x25; size centre box 20x20, box x 16x16, box y 18x16, box z 19x20; turn rings (disk) 115x163,
    77x170, 174x36. Same on both scenes (the framing puts the gate in the same place).
  - Measure artefact: rings right after the click read [0,0,0] (Tunis) and [332,201,528] (Wroclaw): the Turn handle's
    scale is set only once that handle has been shown; after R every reading is as above. Not a visible fault.
- [x] I1.3 browser proof (real mouse and keys, rendering on; holds Tunis 11:47:37-11:48:44, Wroclaw 11:48:47-11:49:58):
  - Click select ok on both; Tab x3 ok; F after flying away ok (numbers above).
  - Move by the X arrow: 2.0 m (Tunis 316 px, Wroclaw 272 px of travel), turned 0, tag 'Moved 2.0 m'; undo back 0 m.
  - Turn: x, y, z each 30 deg (24, 24, 36 px of travel), quaternions before/after in the records (Tunis [0.2,0,0.98,0] ->
    x [0.19,-0.05,0.95,0.25], y [-0.07,0,1,0], z [0.19,-0.25,0.95,-0.05]); tag 'Turned 30 deg'; each undo back 0 deg.
  - Edge-on: Q taps until the y ring's minor axis was 4 px (Tunis) / 6 px (Wroclaw); the pick 'edge:y'; 64 px across the
    line: 30 deg on both; undo back. The first after run (9aabf0e2) gave 0 deg here: the gizmo's own pick took the press
    on the same edge-on ring. Fixed in 5c51b4f1 (ring-pick.ts edgeTakesPress, used by onOwnPress and hitAt).
  - Size: end cube x: Tunis 1.2 -> 1.92 m, Wroclaw 1.5 -> 2.58 m; centre cube 1.2 -> 1.56, 1.5 -> 2.22; moved 0; tags
    'Opening 1.9 m' etc.; undo back.
  - Also fixed in 5c51b4f1: the shapes switched off by enableShape were still drawn grey (a 143 px grey sphere and a face
    ring inside the Turn rings, seen in the first editor3-turn-1920.png); now hidden, also after each drag (_drag wrap).
    editor3-i1.test.ts 12 tests pass, NEG OK (neg_control.py ref HEAD, ring-pick.ts view-mouse.ts); apps/fly and
    tools/bench tsc 0 errors.
  - Pictures (U:/Temp/gsfpv-train3/shots; the named one is taken with the mouse on the handle, '-drag' while dragged):
    editor3-move-1920.png, editor3-turn-1920.png (looked at: the yellow selected ring gate fills the middle third among
    the palms, the three small rings red, blue and yellow inside it, no grey disc), editor3-size-1920.png,
    editor3-wroclaw-move-1920.png (looked at: the yellow square gate in the square, small green and blue arrows with the
    hovered x arrow yellow and its red guide line), editor3-wroclaw-turn-1920.png (looked at: the square gate with three
    thin rings, the hovered y ring yellow), editor3-wroclaw-size-1920.png (looked at: white centre cube, green, blue and
    yellow end cubes on thin lines inside the gate). Tunis move and size of this run, and the -drag pictures, were not
    looked at (the first run's move and size, same handles before the grey-shape fix, were: gate seen, handle small).
  - Acceptance: gate height 0.32 of the view on every framing (25-45 %: yes); every ring's minor axis after the framing
    42-147 px (at least 25: yes); no part over 16 px except lines and rings: NO, the drawn extents are 18 px (move head y)
    and 20 px (size centre box, box z): a 12 px cube seen at an angle spans up to 12*sqrt(3) px and the 115 deg field
    stretches parts off the centre.
- [x] I1.4 gates.py --only vitest,architecture,i18n,b18 on 5c51b4f1: all PASS (vitest 123 s, architecture, i18n, b18;
  i1/gates.log, logs U:/Temp/gsfpv-gates-20261115-115016).
- [x] I1.5 (pass 3) parts shrunk, 9e2c2af6: handle-look.ts HANDLE_PX cone 13x9 px, end cubes 9 px, centre cube 9.5 px
  as set; DRAWN_PER_SET 1.67 (measured by editor3-gizmo.ts on 5c51b4f1's tree: drawn/set 1.13 cone, up to 1.67 cube).
  editor3-i1.test.ts 12 pass, NEG OK (neg_control.py ref HEAD, handle-look.ts); apps/fly and tools/bench tsc 0 errors.
  Release build of 3a42b572's tree plus the change: exit 0 (i1/build-after3.log; the bundle holds arrowLength:13,
  sizeBox:9, centreBox:9.5). gz.sh after: Tunis lock 11:56:30-11:57:55, Wroclaw 11:57:58-11:59:09 and a second
  Wroclaw run 11:59:38-12:00:50 (records gizmo-after-*.json; run1-gizmo-after-70b50d42.json; the 5c51b4f1 records kept
  as prev2-gizmo-after-*.json).
  - maxSmallPart 15 px on both scenes (was 20). Move heads x 12x8, y 9x15, z 13x9; Size centre box 13x13, box x 12x12,
    box y 13x12, box z 15x15; lines 3 px wide; rings unchanged (disk 115x163, 77x170, 174x36).
  - Tunis: click selected gate 4 (ok), eye 2.04 m, 342 px = 0.32; Tab x3 -> 5, 6, 7 at 0.32, rings' minor axes 82/52/120,
    67/42/98, 82/52/120 px; flown away 4.72 m 157 px, F back to 2.04 m 342 px; X arrow 316 px -> 2.0 m, turned 0, undo 0;
    rings x, y, z 30 deg each (24, 24, 36 px), undo 0 deg; edge-on y (minor 4 px) picked 'edge:y', 64 px -> 30 deg, undo;
    Size end x 1.2 -> 1.92 m, centre 1.2 -> 1.56 m, moved 0, undo back.
  - Wroclaw: the click on gate 2 did NOT select it in either run (at [996,314] and [830,383], selected stayed 1; on
    5c51b4f1's tree it selected at [560,322]). The rest ran on gate 1 framed after opening: 2.04 / 2.55 m, 0.32; Tab x3
    2, 3, 4 at 0.32, rings 82/52/120, 67/42/98, 67/42/98; F 5.33 m 171 px -> 2.55 m 342 px; X 2.0 m; rings 30 deg each;
    edge-on y (6 px) 30 deg; Size end 1.5 -> 2.58 m, centre 1.5 -> 2.22 m; every undo back.
  - Pictures looked at (pass 3, earlier run of 5c51b4f1): Tunis move: the yellow selected ring gate in the middle third
    among the palms, small arrows at its centre, the orange course chevrons inside it are larger than the handles. Tunis
    size: the same gate, small white centre cube and coloured end cubes on thin lines. All six -drag pictures: the
    tag ('Moved 2.0 m', 'Turned 30 deg', 'Opening 1.9 m' / '2.6 m') beside the handle, the gate yellow and fully seen,
    the dragged axis' long guide line across the view. The six named pictures of this run (smaller parts) were not
    looked at again.
- [x] I1.6 gates.py --only vitest,architecture,i18n,b18 on 7a769d40: all PASS (vitest 120 s; i1/gates3.log, logs
  U:/Temp/gsfpv-gates-20261115-120124).
- [ ] left: the Wroclaw click select (above). Measured: two runs, two points, no selection; suspect the click lands in
  the opening of gate 2 and pick.ts pickGate (used by view-mouse.ts 591) takes only the frame, or the probe aims at the
  centre; a guess, not measured. Not this stage's fix: D5 and D6 (THR, speed and ALT line, key hints, REC row, voltage
  and time still in the edit view; the top bar line wraps to two lines, seen in every picture).

Stage H3-prove (train 3, 2026-11-15):
- [x] H3.0 code e8d3655b: the crash toast (.crash-toast, ui/crash-overlay.ts) hidden in the edit view (H2 c2); the top bar
  line max-width 360 px (an estimate, H2 g); editor3-h2look test NEG OK (neg_control.py ref HEAD, editor.css);
  editor3-*.test.ts 12 files 65 tests pass. Merge origin/main a7f39528 (sonic3, Integration B): db0a064d, no conflicts,
  packages/sonic-fpv checked out at the pin b05aeda; apps/fly and tools/bench tsc 0 errors.
- [x] H3.1 code 176374af: after Save the top bar line says the course is in Courses on the top bar (course.edit.savedMine
  en es pl ru); probe editor3-prove.ts opens the saved course on a fresh page from Courses (top bar) and its row's Open,
  flies gate 1 with the keyboard (keyboardFly), records the top line after Save; the /api/tracks stand-in lists by scene.
  Release build of 176374af's tree: exit 0 (U:/Temp/gsfpv-train3/editor3/h3/build2.log), Wroclaw stand-in walls in dist/walls.
- [x] H3.2 chain.sh + chain2.sh (U:/Temp/gsfpv-train3/editor3/h3; pass 1 waited over 9 min for the lock twice, pass 2
  held it Tunis 10:31:58-10:36:22, Wroclaw 10:36:25-10:40:00). Records h3/tunis/e4.json, h3/wroclaw/e4.json, sums sum.txt.
  - accept-fly B6 B7 B9-B16 on http://localhost:5805 (first line 'accept-fly target: http://localhost:5805'): 10/10 PASS.
  - mouse-free-probe http://localhost:5805/en: 78 PASS, 0 FAIL; the rooms entry threw (waitForSelector 5 s, no rooms
    service on a local release: known). a6-reference 1/1 pass. gates.py --only vitest,architecture,i18n,b18 on 6cd4fd99:
    all PASS (vitest 212 s).
  - Tunis 887f27aa (rows): open 24 gates, gate 1 selected with handles; add -> 25, red, the line names gate 2 and what to
    do; click: no target (clicks []); Tab 1 -> 2; delete 25 -> 24, next selected with handles; Move X 80 px -> 0.45 m;
    turn rings y and x quatChange 0 (z not reached in this record's first rows); turn undo/redo true/true; Size centre box
    1.2 -> 1.56 m, moved 0; size undo/redo true/true; kinds square, dive with lines; kind undo/redo true/true; bar next and
    previous 1 -> 2 -> 1; duplicate 24 -> 25 undo/redo true; delete 25 -> 24 undo/redo true; W S D A E Q 2.4-2.53 m a step;
    right-button look at moved 0.48; pad flight course.next 0 -> 1, back to edit (eye moved 0 m); floor add 24 -> 25, red
    (problems 6 -> 8), undo works; Save REFUSED after the probe deleted the red gates: "Not saved. The way from the start
    to gate 1 goes through a wall. Pull the arrows of gate 1 toward the start"; Esc x3 closed (first Esc showed the refusal
    line, second 'Esc again leaves', third left).
  - Tunis keyboard run: W in the mode does not arm (camera moved 2.27 m), Space arms (328 ms, mode fly), Space disarms
    (333 ms, mode edit). keyboardFly: NOT passed (course.next 0 -> 0, 150 steps): at arming gate 1 (grown 23 steps to 3.5 m)
    stood BEHIND the drone's camera (depth -2.8 m), the steps never brought it in front.
  - Tunis 844x390: top bar [8,82,381x52], gate bar [8,328,542x54], fits, the canvas under the gate point.
  - Wroclaw 70b50d42: open 24, click on gate 24 selects it; Move X 0.9 m; turn ring 1 quatChange 0, ring 2 0.518; Size
    1.5 -> 1.94 m; W S D A E Q 2.4-2.53 m; pad flight course.next 0 -> 1, back to edit; floor add 24 -> 25 not red (said
    'Add gate. Gate 2 of 25: square, 1.5 m'); Save OK in 306 ms, id becbec-b18783b2, the top bar line: "Saved as your
    course: Course bo42nq, version 1. It is in Courses on the top bar"; Esc x2 left. Fresh page: not loaded by itself (as
    decided); Courses list showed "No course is saved for this scene yet" (rows 0): a PROBE fault, most likely the H3 scene
    filter of the /api/tracks stand-in (the saved id starts 'becbec', so body.scene is not '70b50d42'); not proven.
- [x] H3.3 pass 2 probe 0b8e0501 (commit 'probe lists every saved course'): no app change since 176374af, so the release of
  176374af's tree was reused. Runs U:/Temp/gsfpv-train3/editor3/h3b (lock Tunis 10:49:52-10:57:48, Wroclaw 10:59:52-11:03:49).
  - a DONE: Wroclaw fresh page, Courses: 1 row "Course 70v9kv gates: 22", Open -> track becbec-0eca9077 v1, 22 gates, the
    editor open, the compared gate at offM 0 (pos [33.4,7.4,9.8]).
  - b NOT passed: keyboard flight 150 steps, course.next 0 -> 0; the probe's throttle estimate 53-65 %, the OSD ALT read
    0.0 every step, gate 1 depth -0.9 m: the drone never left the ground under W. Cause not measured (guess: the W ramp does
    not reach the flight in the edit mode's fly state, or the estimate is wrong; record the OSD THR next).
  - c measured: Tunis refusal line 1 s after Save: "Not saved. The way from the start to gate 1 goes through a wall. Pull the
    arrows of gate 1 toward the start ..."; gate 1 selected (wrong.index 0, legStart). The probe pulled X and Z of gate 1 eight
    times (0.32-0.92 m each): problems 4 -> 4 every time (undone). Then 10+ deletes of gate 1: every new gate 1 still had
    leg-wall from the start. Start pos [0.1,2.1,0.3] yaw 180, no start-wall problem. Points at the generator's start (lane
    fix3a, packages/tracks generate/fit), a strong guess, not proven; not fixed here.
  - d measured: rings tried with 60 and 140 px tangent drags. Tunis y 0/0 deg, x 0/0 deg; Wroclaw y 0/0, x 0/0, z 60/120 deg.
    editor3-turn-1920.png: the view looks straight along the gate, so the x and y rings are drawn edge-on as lines and only
    the facing ring turns. Fix to decide: frame a gate for Turn from an oblique view, or turn handles that are not rings.
  - e: Tunis no second gate on screen after 4 back-offs (S+E 0.7 s each); Wroclaw click on gate 11 selects it.
  - f measured: the refusal stays on the top bar line 6 s (top-bar.ts tell, 6000 ms timer), at 7 s it is the fly hint again.
    Proposal: a refused line stays until the next tell. Not changed (needs a build and a browser proof).
  - g looked at: move (Tunis gate 1 among palm fronds, handles clear), turn (x and y rings edge-on), size (white centre box,
    green and pink boxes), wroclaw (gate before a wall, bar under it), flying (ARMED, THR 28 % ALT 3.6, gate 1 inside a palm
    crown), 844 (top bar [8,82,381x52] over the ANGLE chip, gate bar [8,328]). The ANGLE CH5 'Stick in the centre' chip stays
    top left in the edit view at 1920.
  - Pad flight course.next 0 -> 1 on Tunis and Wroclaw, back to edit; Esc x2 leaves (Tunis), x1 after Save (Wroclaw).
  - gates.py --only vitest,architecture,i18n,b18 on the probe commit: result in h3b/gates.log and the next commit message.
- [ ] left (next worker): b (keyboard flight: record OSD THR and ALT per step), c (lane fix3a: Tunis start leg), d (turn
  rings edge-on), f (refusal line timer), e (Tunis click target), then the walk again.
- older left list (pass 1):
  a. editor3-prove.ts fakeTracks: drop the scene filter added in H3 (or match the scene the page sends); re-run Wroclaw to
     prove: Courses -> Open -> the moved gate where it was put.
  b. keyboardFly: before Space put the view 6 m before gate 1 facing it (S held until the gate's depth is about 6 m, the
     gate in front), then fly; record course.next 0 -> 1.
  c. Tunis Save: the start leg "from the start to gate 1 goes through a wall" stays after deletes. The probe should do what
     the line says (pull gate 1's arrows toward the start) instead of deleting. If the start pose itself is in a wall, the
     cause is the course generator's start (lane fix3a): report, do not fix here.
  d. Turn rings: on Tunis y and x gave quatChange 0, on Wroclaw ring 1 gave 0 (H1.2 guess unmeasured: drag across an
     edge-on ring stays under the 15 degree snap). Measure the gizmo angle per move.
  e. Tunis: no click target (no other gate on screen more than 160 px away): turn the view to a second gate first.
  f. After a refused Save the top bar line read "Click a gate to change it..." 20 s later (save.topLine), the refusal only
     in 'said': check whether the refusal line is replaced too early (course.ts say / sayLine).
  g. Pictures editor3-move/turn/size/wroclaw/flying-1920.png and editor3-844.png were taken again in this run
     (U:/Temp/gsfpv-train3/shots) but NOT looked at (reply budget); editor3-after-kbd-flight-1920.png too.

Stage H2-look (train 3, 2026-11-15; NOT finished, stopped at the reply budget):
- Pass 2 (2026-11-15, NOT finished, stopped at the reply budget):
  - [x] H2.3 (a) code 600e08a4: editor.css hides .hud-note (course.ts flashes 'Gates: 24. Fly through gate 1') and .gate-msg
    (ui/hud.ts take-off prompt) in the edit view too; the test regex follows; NEG OK (neg_control.py ref HEAD, editor.css).
    Browser: in the edit view .hud-note and .gate-msg display none at 1920 and 844 (Tunis and Wroclaw); after Exit both
    display block again (Tunis).
  - [~] H2.4 (b) code 600e08a4: on a phone the top bar sits at top calc(--top-row-bottom + 4px), left 8px, buttons padding
    3px 5px. Measured 844x390 (Tunis): top bar [8,82,389,134], window [400,86,780,121], gate bar [8,328,550,382], top row
    .top-actions [428,38,828,78]: the top bar no longer covers the top row; every top bar and gate bar button 44x44 (7, 11).
    NOT done: it now covers the scene credit .attribution [16,44,412,119] (with the Walls chip) and the 160 px handle square
    (top~handles, Tunis [120,116,280,276], Wroclaw [122,123,282,283]); the window covers the credit too; the gate bar covers
    the voxel panel (.wv-label, .wv-note), the OSD's bottom line and the REC button [491,310,590,350]. The phone needs one
    layout decision: in the edit mode hide the credit, the voxel panel, the REC row and the OSD lines (smallest: add them to
    the :has rule at max-height 500px), or move the top bar. Record U:/Temp/gsfpv-train3/editor3/h2b/look.json 'covers'.
  - [x] H2.5 gates.py --only vitest,architecture,i18n,b18 on 600e08a4: all PASS (vitest 120 s; U:/Temp/gsfpv-gates-20261115-093834).
  - [x] H2.6 release of 600e08a4 (build exit 0, 87 s, sha256 0d0c1844...), runs on 5802 Tunis and Wroclaw 70b50d42 (stand-in
    walls copied into dist/walls), U:/Temp/gsfpv-train3/editor3/h2b/look.json and look-70b50d42.json:
    Size by the x box: Tunis 1.2 -> 1.43 m, Wroclaw 1.5 -> 1.79 m, moved 0, turn 0, scale mid-drag [1.19,1,1]; centre box:
    Tunis 1.43 -> 1.61, Wroclaw 1.79 -> 2.04, moved 0, turn 0, scale [1.13..1.14 x3]; the top bar line 'Size changed. Gate 2
    of 24: ring|square, N m'. Edit view at 1920: nothing of the page covered by the three parts, no overlaps.
  - left (next worker, in this order):
    c2. The pad test flight now starts (in the flight rects the top bar is the 'flying' strip and the window is display none)
        but it CRASHED: editor3-after-flight-1920.png shows CRASH, ALT -2.1 m and the crash card 'Crash 8.9 m/s, back 5 s
        in 1.2 s' with Enter/R/N/Shift+F keys standing over the lower middle of the edit view after the return to edit.
        That card is a flight window that is NOT hidden: find its class (ui/ crash card) and add it to the :has rule. The
        probe's disarm sets throttle -1 first (as editor3-prove.ts), which drops the camera drone into the ground: disarm
        with the sticks centred. .osd-stats never appeared (absent in flight, after disarm and after Exit), so the stats
        card is still unproven; dbg mode read 'edit' at 3 s, the flight started later: wait up to 6 s.
    g.  At 1920 after the flight the top bar grew to [480,8,1440,55] (its line 'Click a gate to change it. Arm your controller
        to fly the course at once, disarm to edit again' wraps to two lines) and covers the speaker button [1404,38,1446,78].
        Give .ce-tb-line a max-width (about 420 px, an estimate) or shorten the line.
    b.  the phone layout decision above (H2.4).
    d2. editor3-edit-clean-1920.png and editor3-844.png of pass 2 not looked at; editor3-after-flight-1920.png looked at (above).
- [x] H2.0 origin/main had no new commits after the H1.0 merge 607e1cb9 (git log HEAD..origin/main empty), no merge needed.
- [x] H2.1 code fb81ed2d: view-mouse.ts Size tool: x and y boxes (z too for a cube-frame, put(..., deep)) plus the centre
  box (axisBoxSize 0.22, axisCenterSize 0.3, axisLineThickness 0.04: estimates); pose() takes the axis pulled furthest from
  1 as the factor of the one opening; a tag "Opening N m" (course.edit.sizeTag en es pl ru) beside the handle while it is
  dragged; course.ts says "Size changed. Gate N of M: ring, N m" after a Size drag (Turned after a turn). editor.css: the
  flight windows .osd-stats, .arm-card, .course-hud hidden while .course-editor:not(.ce-flying) is in the page (CSS :has,
  the mode flag of keyboard.ts EDIT_MODE; no file outside the lane changed); phone media: top bar and gate bar buttons 44 px.
  Test tools/bench/test/editor3-h2look.test.ts 3 tests, NEG OK (neg_control.py, ref HEAD, all seven changed files);
  editor3-g2 and editor3-tools regexes follow the new source; editor3-*.test.ts 12 files 65 tests pass; apps/fly and
  tools/bench tsc 0 errors. Release build of fb81ed2d exit 0 (U:/Temp/gsfpv-train3/editor3/h2/build.log).
- [x] H2.2 browser run (new probe tools/bench/src/editor3-look.ts, keyboard input, Tunis 887f27aa, local release on 5801,
  record U:/Temp/gsfpv-train3/editor3/h2/look.json):
  - 1920x1080 edit view: top bar [630,8,1290,48], gate bar [563,754,973,796], Course editor [1532,86,1912,129]; .arm-card
    and .course-hud display none, .osd-stats absent; no overlaps among top bar, gate bar, window and a 160 px square round
    the gate (an estimate of the handles' reach).
  - Size by the x box: hit ['size','x'], opening 1.2 -> 1.43 m, moved 0 m, turn 0, stand scale mid-drag [1.19,1,1], tag
    "Opening 1.4 m", top bar "Size changed. Gate 2 of 24: ring, 1.4 m". By the centre box: hit 'xyz', 1.43 -> 1.61, moved 0,
    turn 0, scale [1.13,1.13,1.13], tag "Opening 1.6 m", line "... ring, 1.6 m". Picture editor3-size-1920.png looked at:
    the tag stands beside the x box.
  - 844x390: top bar [216,4,628,56], gate bar [8,328,550,382], window [400,86,780,121]; every top bar button min 44x44 (7),
    every gate bar button 44x44 (11); no overlap among the three and the gate square. Picture editor3-844.png looked at.
  - After Exit: .course-hud display block again (back).
- [ ] left (next worker, in this order):
  a. 844 picture shows two flight lines still in the edit view: "Gates: 24. Fly through gate 1 ... course" under the
     Course editor title (NOT .course-hud, which is display none: find its element, probably the integration's note slot
     or ui/next-hint.ts) and "Click to fly, or press W or Space to take off" (a take-off prompt of ui/hud.ts). Add both
     classes to the editor.css :has rule, re-run editor3-look.ts.
  b. 844: the top bar [216..628, 4..56] covers the page's top row (Share, settings, Feedback at y 40..76) and the "ANGLE"
     chip: the probe's overlap list does not include the top row (ui/top-row.ts). Measure it, then place the top bar so it
     does not cover them (e.g. below --top-row-bottom on the left, checked against the window at x 400).
  c. The test flight in the probe did not start: Space with the keyboard left mode 'edit' (look.json desk.flying.mode
     'edit'), so the stats card never appeared and editor3-after-flight-1920.png is not a picture after a flight. Use the
     fake pad of editor3-prove.ts (install(), pad arm on button 2) for the flight and the disarm with airtime over 3 s
     (summary-stats.ts CARD_MIN_AIRTIME_S), read .osd-stats display in the flight (shown) and after disarm (none).
  d. Look at editor3-edit-clean-1920.png and editor3-after-flight-1920.png (taken, not looked at yet).
  e. Wroclaw 70b50d42 run (copy U:/Temp/gsfpv-train2/walls/release/70b50d42 into dist/walls first, SCENE=70b50d42).
  f. gates.py --only vitest,architecture,i18n,b18 on the final commit (not run in H2), commit.

Stage H1-tunis (train 3, 2026-11-15; NOT finished, stopped at the reply budget):
- [x] H1.0 merge origin/main 78efaaaf into editor3: commit 607e1cb9 (no conflicts). apps/fly and tools/bench tsc 0 errors;
  editor3-*.test.ts 9 files 53 tests pass; release build of 607e1cb9 into dist: exit 0 (log U:/Temp/gsfpv-train3/editor3/h1/build.log).
  dist/walls is NOT filled yet: the Wroclaw stand-in walls (U:/Temp/gsfpv-train2/walls/release/70b50d42) must be copied
  into dist/walls before a Wroclaw run (as in G3.2).
- [x] H1.1 (b) answered by reading the code, not run: the Save refusal "the way from gate 0 to gate 1 goes through a wall"
  is the leg from the START to the first gate. packages/tracks check.ts 247 puts { id: 'start' } before the gates, so the
  leg report's from is 'start'; words.ts gateNo('start') was findIndex -1 + 1 = 0. Deleting the first gate only makes the
  next gate the first one: the leg from the start (the generator's start pose, which the editor never moves) to it is
  checked again, so the problem stays. Fixed in the words: texts.ts problemParts (numbers from 1; a leg from the start
  says "the way from the start to gate N"), new key course.edit.p.legStart in en, es, pl, ru. Test
  tools/bench/test/editor3-h1.test.ts 3 tests, NEG OK (neg_control.py ref HEAD, texts.ts, words.ts and the four locale
  files; on the old code the import of problemParts is missing, so it fails by a TypeError, not an assertion).
  editor3-*.test.ts 10 files 56 tests pass; apps/fly tsc 0. Commit d2aa14f1. gates.py --only vitest,architecture,i18n,b18
  on d2aa14f1: all PASS (vitest 150 s; logs U:/Temp/gsfpv-gates-20261115-083332).
- [x] H1.2 (c) read from the G3 records (g3/runA/e4.json), not run again:
  - "No click target" on Tunis: the probe's candidate list was EMPTY (click.clicks []), i.e. no other gate stood on screen
    more than 160 px from the selected one (editor3-prove.ts 207). The page's pick was never tried on Tunis; not an
    editor fault by this record. A proof needs the probe to turn the view to a second gate first.
  - Kind undo on Tunis: NOT a lost undo. After the bar's Dive the gate is tilted; Cube and Ring then change the shape but
    leave the tilt, and gateLine (words.ts 34-43) names any gate whose axis points down "dive gate". The record shows the
    lines "Shape changed. Gate 2 of 24: dive gate" after Cube and after Ring, and the probe's sample (pos, quat, opening,
    line) has no shape field, so undo of ring -> cube looked unchanged. The real fault for the pilot: pressing Ring or
    Cube on a dive gate keeps it a dive gate (the tilt stays). Fix wanted: a kind other than Dive also stands the gate up
    (packages/tracks editor.ts 'shape' action or the bar's handler in course.ts; not changed).
  - Rings on Tunis: y ring (walk r 88 px, drag 60 px down) and x ring (r 190) gave quatChange 0; z ring (r 196) 0.518.
    Cause NOT measured (a guess: the probe drags along a circle's tangent, but a ring seen nearly edge-on is a thin
    ellipse and PlayCanvas RotateGizmo turns by the angle about the ring's axis, so a drag across the ellipse gives
    less than the 15 degree snap SNAP_TURN_DEG and rounds to 0). Measure next: record the gizmo's angle per move
    (RotateGizmo 'transform:move') with snap off.
- [x] H1.3 pass 2 (items b, c, d of the list below, code and unit tests; browser not yet), commit 535fde74: texts.ts
  firstWrong (the lowest gate a problem points at; a leg points at its far gate, the start's problems at gate 1; with a
  focus id only that gate's problems) and FIX_KEYS, keys course.edit.fix.* plus saveFix and addFix in en, es, pl, ru (a leg
  from the start says "pull the arrows of gate N toward the start"). course.ts showWrong / refusedSave: a refused Save
  (saveMine, saveAdmin) selects that gate, showEd + aim turn the view to it with its handles, says "Not saved. <what and
  what to do>"; a floor add remembers its gate (addedId) and the check worker's answer on it says "The new gate is red. ..."
  and selects it. __gsfpvEditView() also gives wrong (index, key) and course (gates, start, problems).
  packages/tracks editor.ts 'shape': a kind pressed on a dive gate stands it up (the same kind on a dive gate only stands it
  up; the same kind on a level gate is refused 'same' as before), one undo step. Test tools/bench/test/editor3-h1b.test.ts
  6 tests; NEG OK twice (all six files; editor.ts alone, by AssertionError "expected false to be true"). editor3-h1b,
  editor3-h1, packages/tracks editor.test.ts 18/18; apps/fly and packages/tracks tsc 0.
- [x] H1.4 gates.py --only vitest,architecture,i18n,b18 on 535fde74 plus the new probe: all PASS (vitest 202 s; logs
  U:/Temp/gsfpv-gates-20261115-084330).
- [~] H1.5 (a) in Node: new tools/bench/src/editor3-tunis-check.ts (CDN walls of 887f27aa, transform 1,0,0,0 assumed,
  fitCourse as the page's worker without the quality box, checkTrack measure=true at marginOf). Seed 1: 19 gates, start
  clear, 0 refused legs, 0 refused gates: an untouched generated Tunis course of seed 1 PASSES the check in this replica.
  It took 804 s for one seed (fitCourse ran far past FIT_BUDGET_MS 120 s in Node), so seeds 2 and 3 were stopped
  (log U:/Temp/gsfpv-train3/editor3/h1/tunis-check.log). Not the page's own seed or transform: the page's course is
  still to be read through __gsfpvEditView().course (added in 535fde74) in the browser run.
- [ ] left (next worker, in this order; b, c, d are coded in H1.3, their browser proof is in f):
  a0. Run seeds 2 and 3 detached (about 14 min each): cd tools/bench; npx tsx src/editor3-tunis-check.ts --seeds 2,3
     --out U:/Temp/gsfpv-train3/editor3/h1/tunis-check-23.json. In the browser run read __gsfpvEditView().course.problems
     on the page's own course right after opening the editor (no edit) and write whether it is empty.
  a. Tunis measurement (a): load http://localhost:58xx/en/fly/?scene=887f27aa&nowarn=1&course=g1.<seed> for the page's
     own seed and two more (the probe's Shift+G uses randomSeed(), course.ts 942; a link seed is seedOfLink), open the
     editor, dump the full course (add the course's gates and start to __gsfpvEditView, course.ts 716) and the problems;
     then in Node checkTrack(track, flownCollision(walls, T), T, marginOf(track), true) on the CDN walls of 887f27aa
     (tools/bench/src/scenes.ts loadScene) for freeM and the place of each refused leg and gate, height above the ground
     and nearestWall distance (check.ts 353). Write whether an untouched generated Tunis course passes; if not, numbers
     go under 'For the lead' (generator is lane fix3a's; do not change it or the check).
  b. The refused Save (lead's decision): canSave false -> select the first wrong gate (for 'leg-wall' the gate 'to', for
     'start-wall' gate 1), view.setCam toward it (camera.ts), handles on it, one sentence from problemParts plus what to
     do (move it, turn it, delete it) in en, es, pl, ru; course.ts saveMine 976 and saveAdmin 1025. Same for a floor add
     the check refuses (course.ts placeAt / onPlace): say why, keep it selected.
  c. A leg from the start that a moved first gate cannot clear: the start pose is fixed; the sentence must lead to moving
     gate 1 (the "to" gate) toward the start, not to deleting it.
  d. Ring or Cube on a dive gate stands the gate up (H1.2 kind undo), with a unit test.
  e. Rings: measure the angle per move as said in H1.2, then fix or change the probe's drag.
  f. Browser proof on Tunis and once on Wroclaw as the stage asks (pictures editor3-tunis-refused-1920.png,
     editor3-tunis-turn-1920.png), gates.py --only vitest,architecture,i18n,b18, commit.

Stage G3-prove (train 3 wave 3):
- [x] G3.1 code 67c8d31e: G2 left 1 (who poses the camera after a floor add) read from the code: crashview.ts frame() (line
  117-144) writes the chase camera every frame while a crash is active, before the features' frame work; the G2.13 pictures
  showed "crashes 1" and the drone in a palm. course.ts editFrame now holds the edit camera every frame (view.setCam when the
  renderer's camera is off the edit eye or the override is false) and counts it in camTaken; back to editing after a crash
  calls ctx.clearCrash() (the page's own "back from a crash": chase camera, stats window, replay go) and counts crashCleared.
  The writer is a reading until the run's camTaken says so. view-mouse.ts isSuspended(). Test tools/bench/test/editor3-g3.test.ts
  3 tests, NEG OK (neg_control.py ref HEAD 60f54e59, course.ts and view-mouse.ts); editor3-g2/-g3/-flying 22/22;
  apps/fly and tools/bench tsc 0. Probe: floorAdd records camTaken, crashCleared, crashActive, statsWindow; FULL=0 (1c2b773d).
- [x] G3.2 release of 1c2b773d (build done 07:13:12, train-3 walls of 70b50d42 copied into dist/walls), runA Tunis + Wroclaw
  (g3/runA/e4.json, lock 07:20:18-07:25:03), runB keyboard + 844x390 on Tunis (g3/runB/e4.json, lock 07:25:07-07:25:54).
  MEASURED cause of G2 left 1: after the floor add another writer took the camera with cameraOverride false (no crash
  active): camTaken n 56 (Tunis) and 55 (Wroclaw) frames, override false, crash false; on Wroclaw before the add 3 frames
  with crash true. The per-frame hold fixes the picture: shots/editor3-floor-add-1920.png (looked at) shows the edit view,
  the new gate under the Move handles and the gate bar; stand.screen z 8 (Tunis) and 12 (Wroclaw) = in front (was -2).
  Which code sets the override false is not named (suspect a 'life' event: respawn.ts 94 onLife -> clearCrash, a guess).
  Stats window after the disarm: not on the page (statsWindow false, crashCleared 0).
  Also proven in runA, both scans: open with one key (mode edit, handles); Add gate (24 -> 25, selected 1); click on
  another gate (Wroclaw 11 selected; Tunis no click target found); Tab 1 -> 2 (Tunis), 11 -> 12 (Wroclaw); Delete (next
  gate selected, handles, bar flex); Turn ring drag quatChange 0.518, moved 0 (Tunis: 2 of 3 rings gave 0 change, the z ring
  turned); Size 1.2 -> 1.58 (Tunis), 1.5 -> 1.98 (Wroclaw), moved 0; each kind from the bar; bar Next/Previous 1 -> 2 -> 1;
  Duplicate 24 -> 25; Delete 25 -> 24; Shift+Tab back; X arrow moved 0.45 m (Tunis) and 0.54 m (Wroclaw) for an 80 px drag,
  opening unchanged; undo and redo of turn, size, kind (Wroclaw; Tunis undoChanged false for the kind), duplicate, delete,
  move, floor add; W S D A E Q moved the eye 2.27-2.53 m each; right-button look moved the look point 0.48 m. Frame rate
  before 30 / 29.7, in the mode idle 29.9 / 29.9, during drags 29.6 / 29; longest long task in the mode path 160 ms
  (Tunis), 129 ms (Wroclaw), idle in mode 56 ms. runB: keyboard Space 1 fly armed (315 ms), Space 2 edit disarmed (309 ms);
  full course line has no digit; 844x390: gate bar [8, 340, 410x42] and top bar [217, 4, 409x36] fit, the selected gate's
  point is the canvas (nothing covers it).
- [x] G3.3 pass 2 (probe 260e5638, dist = release of 1c2b773d, no app code changed): runC Tunis (g3/runC/e4.json, lock
  07:33:23-07:36:29), runD Wroclaw (g3/runD/e4.json, lock 07:36:32-07:39:19). gates.py --only vitest,architecture,i18n,b18
  on 260e5638: all PASS (vitest 108 s, logs U:/Temp/gsfpv-gates-20261115-073152). a6-reference 1/1 pass (hash unchanged,
  no flight code touched). mouse-free-probe on http://localhost:5814/en (render off, no lock): 78 PASS, 0 FAIL in 11
  entries; the 12th entry 'rooms' threw (waitForSelector [data-action="pause.rooms"] 5 s: a local release has no rooms
  service; lane rooms, not this lane). Measured in runC/runD:
  - Keyboard Space with the PAD as the chosen source: Space does not arm (mode edit after 3.1 s, both scans); the keyboard
    is passive then (devices/keyboard.ts header). Space toggle with the keyboard as the source is proven in runB.
  - Pad flight: sticks put the mode in 'fly' (handles hidden) and the disarm brings the edit view back where it was
    (editEyeBackM 0, both scans); controls.gate.armed stays false (camera drone, no arming). Gate 1 stands 13.4 m (Tunis)
    and 9.6 m (Wroclaw) ahead of the spawn, nearly centred (x 841 and 848 of 1920). course.next stayed 0: the probe read
    the yaw's sign on the EDIT camera (startZ 2.3 m), turned away and lost the gate. Fixed in the probe after the run
    (sign read on the drone's camera, lower yaw gains), NOT run yet. '+' 23 / 20 times made the opening 3.5 m, 23 / 20
    Ctrl+Z gave 1.2 / 1.5 back.
  - Red-gate loop: deleting gate index 1 again and again did not clear "the way from gate 0 to gate 1 goes through a
    wall" on Tunis (problems 6 -> 5 -> 4 ..., Save refused, Problems 5). Probe now deletes the moved gate when the same
    pick gives no fewer problems (NOT run yet). Wroclaw reached Save: refused with problem "save: http 201", the page says
    "The course was not saved this time. Press save again": suspect the probe's local /api/tracks stand-in in
    editor3-prove.ts main() answers 201 where the page wants another answer, or the page's save treats 201 as a failure
    (a guess, not read).
  - Exit: two Esc presses with unsaved changes: the second still said "The changes are not saved. Esc again leaves
    without saving" and the editor stayed open (closed false, both scans). Suspect the floor add's undo or the delete
    loop resets askedFor between the presses, or 900 ms is too short; course.ts command('exit') ask() (a guess).
  - Path long task max 156 ms (Tunis), 88 ms (Wroclaw); fps before 30, idle in mode 30 (Wroclaw).
- [x] G3.4 pass 3 (probe 73a6d46a, dist = release of 1c2b773d, no app code changed in this pass): read store.ts
  saveMine/save (line 83, 113): the page takes a save only with status 201 AND an id that matches SERVER_TRACK_ID
  '<6-32 hex>-<8 hex>' (packages/tracks server.ts 12); the probe's stand-in echoed the page's own id, so 'save: http 201'
  was the PROBE's fault, not the page's. Probe now answers like the server (new id, versions path), records the compared
  gate's pose right before Save (out.compare, isMoved), presses Esc up to 3 times 1.5 s apart and records each line.
  Runs by U:/Temp/gsfpv-train3/editor3/g3/chain3.sh: runE Tunis (lock 07:42:46-07:45:38), runF Wroclaw (07:45:42-07:48:29).
  MEASURED (g3/runE/e4.json, g3/runF/e4.json):
  - Test flight with the simulated gamepad: course.next 0 -> 1 on BOTH scans (Tunis flight step 90 of 91, Wroclaw step
    82 of 83; gate 1 was 13.5 m / 9.7 m ahead, opening made 3.5 m by '+' and taken back by 23 Ctrl+Z); the disarm brought
    the edit view back: modeAfter 'edit', editEyeBackM 0 (both). Item 1 of pass 2 PROVEN for the pad.
  - Save on the local stand-in: Wroclaw saved ('Saved as your course: Course ayh0ah, version 1', id becbec-8ded5a40, 307 ms)
    after the loop deleted 11 red gates (24 -> 13, problems 0). Tunis refused: 'Not saved: fix the red gates first.
    Problems: 2. the way from gate 0 to gate 1 goes through a wall', the loop deleted gate 0 again and again (24 -> 10)
    and problems stayed 1-3.
  - Exit: Tunis closed after 3 Esc (escSaid: 1st left the save refusal line, 2nd 'The changes are not saved. Esc again
    leaves without saving', 3rd closed); Wroclaw (saved, nothing unsaved) closed after 2 Esc. So the second Esc after the
    warning DOES leave; in pass 2 the first Esc went to the focused name field (nameField 'ce-name' after Save), a reading
    of escSaid, not traced in code. Item 6 of pass 2: not an editor fault.
  - Reload of the saved course (Wroclaw): the page did NOT take the saved course by itself after a fresh load (auto.gates 0,
    source 'none', 30 s); the probe did not open the Courses list, so 'the moved gate is where it was put after load' is
    NOT proven. Also the loop had deleted the moved gate (movedGone true).
  - Floor add: Tunis problems 5 -> 7 ('the way from gate 0 to gate 1 goes through a wall'), Wroclaw 4 -> 4 (the new gate
    not red; the one line 'gate 2 to gate 3'); the new gate in front of the view on both (stand.screen z 8 and 12).
  - Long tasks on the path: max 81 ms (Tunis), 75 ms (Wroclaw); fps before 30 / 29.9, idle in the mode 30 / 29.9, path 29.9.
  - Pictures (Read, looked at): move-1920: a Unity user knows it at once (3 coloured arrows, plane squares, the bar under
    the gate; but the gate stands in a palm). turn-1920: a Blender user knows the rotate rings at once. size-1920: weakest,
    only one small white box on a grey line, no X/Y/Z boxes, a Blender user would have to try it. wroclaw-1920: clear
    (move arrows on the gate, the bar under it, the street ahead). flying-1920: clear (ARMED, gate in green, the line
    'Flying your course with the changes. Disarm to edit again', no handles). 844: the gate bar fits at the bottom and the
    selected gate with its handles is visible, BUT the course line 'Gates: 24. Fly through gate 1' lies under the 'Course
    editor' window head and the controller hint box covers the middle of the view; a person would understand the bar, not
    the crowded top.
- [x] G3.5 accept-fly B6 B7 B9 B10 B11 B12 B13 B14 B15 B16 on the local release (first line 'accept-fly target:
  http://localhost:5815', it held the lock 07:49:25-07:55:16): 10 of 10 PASS (log g3/accept.log). gates.py --only
  vitest,architecture,i18n,b18 on 73a6d46a + this status: all PASS (vitest 90 s; logs U:/Temp/gsfpv-gates-20261115-075516).
  a6-reference 1/1 pass and mouse-free-probe 78 PASS / 0 FAIL stand from pass 2 (G3.3): no app code changed since.
- [ ] left (next worker, in this order; dist is the release of 1c2b773d):
  a. Tunis Save: the course had 5 problems before the floor add (at open: not recorded) and 'the way from gate 0 to gate 1 goes through a wall' does
     not go by deleting gate 0 (14 deletes, 24 -> 10). Record gate 0's and 1's pose and the leg report before more
     deletes; suspect the leg from the spawn or course3's generator on Tunis (packages/tracks, a guess).
  b. Reload: open the Courses list after the fresh load, pick the saved course and compare out.compare.pos (probe work in
     tools/bench/src/editor3-prove.ts reloadSaved). Make the loop keep the moved gate (delete it only as the last way).
  c. Keyboard course flight (keyboard as the source) course.next 0 -> 1: the Space toggle is proven (runB), the pass is not.
  d. 844x390: the course line under the 'Course editor' head and the hint box over the view (seen in editor3-844.png);
     suspect the fly page's top-right window layout, not the editor folder.
  e. Size handle reads weakly for a Blender user (one white box); PlayCanvas ScaleGizmo with uniform only? apps/fly/src/
     course/editor (a guess).
  f. Pass 2 items still open: 4 (who sets cameraOverride false after an add), 5 (Tunis rings y 0 / z 0.131), 8 (0-based
     gate number in the save refusal, course3's text).
- [ ] superseded left list of pass 2 (0, 1, 2 partly, 6 done in G3.4):
  0. Run chain U:/Temp/gsfpv-train3/editor3/g3/chain2.sh again with OUT runE/runF (the probe fixes of this pass), then
     items 1, 2, 6 below from its record. accept-fly B6 B7 B9-B16 on a local address is NOT run yet (it takes the lock
     itself: SITE=http://localhost:<port> npx tsx src/accept-fly.ts B6 B7 B9 B10 B11 B12 B13 B14 B15 B16).
  1. Test flight with the simulated gamepad: fly.armed false, nextAfter 0 on both scans, modeAfter edit. The HUD in the
     picture says "ANGLE CH5, Stick in the centre (camera drone): no arming needed", so the probe's pad may fly a camera
     drone that never arms, and gate 1 is not put 6 m ahead of the spawn. Probe work in tools/bench/src/editor3-prove.ts
     (fly section near line 380-420): put gate 1 6 m ahead facing the spawn (Move drag or EditAction add), arm by the
     keyboard (Space, proven in runB) and fly W; then the pad with its arm switch; record course.next 0 -> 1.
  2. Save: the probe does not delete the red gates first, so Save refused ("Problems: 5", Tunis; 3, Wroclaw) and the
     reload of the moved gate is not proven. Add a loop: select each red gate (ed.problems / the red list) and Delete
     until problems 0, then Save, then load and compare savedGatePos with the moved pose.
  3. Added gate still red: Tunis problems 5 -> 7 ("the way from gate 0 to gate 1 goes through a wall"), Wroclaw 3 -> 2.
     Record the check's leg report (packages/tracks check.ts 257-270) before a change.
  4. Name the code that sets cameraOverride false after an add (record a stack in a setter on ctx.session.cameraOverride
     in the probe's init script).
  5. Tunis ring drags: 2 of 3 gave quatChange 0 (r 88 y ring, r 190 x ring); Tunis kind undo undoChanged false.
  6. Exit: closed false on both scans.
  7. Look at the six pictures and write the Blender/Unity line for each; mouse-free-probe; accept-fly B6 B7 B9-B16 on
     a local address; a6-reference; gates.py --only vitest,architecture,i18n,b18.
  8. The save refusal shows a 0-based gate number ("gate 0 to gate 1"): course3's text (For the lead).

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
- [x] G2.8 full run on the release of 58bb57c2 (g2/full2/e4.json, lock 06:26:25-06:30:51, Tunis, Wroclaw, keyboard Tunis,
  1920x1080). PROVEN item 2: kbd-887f27aa space1 mode 'fly' armed true (312 ms), space2 mode 'edit' armed false (320 ms).
  PROVEN full course: line "The course is full. Delete a gate you do not need first: click it and press the cross on its
  bar. Then add the new one.", digitInLine false. FAILED item 3 on both scans: the gate is added (24 -> 25) but
  stand.screen z -2 (behind the camera; Tunis [901,-1138], Wroclaw [941,-922]), problems 6 -> 7 (Tunis) and 2 -> 3
  (Wroclaw) = the new gate is red; its course-frame pos [0.16, 1, 0] (Tunis) while the selected gate 0 stands at
  [12.41, 7.72, 0.32]. The two pictures show no gate and a view looking up at the sky from near the ground. Cause not
  measured yet: G2.9 records the click's ray, wall hit, point and the edit view before the click (746d5c95).
- [x] G2.9 measurement (release 746d5c95, g2/floor3/e4.json, lock 06:36:58-06:38:54, Tunis): the edit view before the
  click stood at eye [9.45, 7.03, 0.13] (picture editor3-floor-before-1920.png shows the gate with its handles and bar), but
  the click's ray (view-mouse.ts onUp, from the renderer's camera entity: getPosition and screenToWorld) started at
  [-0.42, 0.69, 0.04] looking down (d y -0.99): the drone's pose after the test flight, held by the entity between frames.
  Wall hit 0.84 m, the gate went to [-0.46, 0.95, -0.03], behind the view; problems 5 -> 6, the problem line "the way from
  gate 0 to gate 1 goes through a wall". MEASURED cause, not the facing.
- [x] G2.10 fix 8fbb67e3: fly-cam.ts camRay(cam, x, y, w, h, fov, horizontalFov) builds the click ray from the edit camera's
  own pose; view-mouse.ts uses it for the pick and the add, and writes the edit pose to the entity before the gizmos pick
  (onOwnPress). editor3-g2.test.ts 5/5, NEG OK (neg_control.py ref HEAD 746d5c95, fly-cam.ts and view-mouse.ts); editor3-*
  and a6-reference 9 files 50/50; apps/fly tsc 0.
- [x] G2.11 run on the release of 8fbb67e3 (g2/full3/e4.json, lock 06:43:26-06:47:43, Tunis and Wroclaw, KBD=0). The ray
  now starts at the edit eye (Tunis o [9.45, 7.03, 0.13] = view eye; Wroclaw o [-5.88, 6.52, -16.46] = view eye), wall hit
  10.8 m and 15.2 m, the gate goes 7.9 m (Tunis) and 11.6 m (Wroclaw) ahead of the view along its look (computed from
  place.at and floorBefore.viewBefore). NOT done: problems still rise (Tunis 5 -> 7, "the way from gate 0 to gate 1 goes
  through a wall"; Wroclaw 2 -> 3, "gate 1 is in a wall"), and the pictures after the add show the DRONE's view (no handles,
  no bar, no gate), while editor3-floor-before-1920.png showed the edit view with handles right before the click.
- New fault seen, not in this list (left): after the test flight's disarm the flight STATS window (AIR TIME ... "Enter or
  Esc: all stats and the menu") stands over the edit view (editor3-floor-before-1920.png); suspect the flight-end stats
  panel of the fly page (not the editor folder).
- [x] G2.12 measured from g2/full3/e4.json floorAdd.viewAfter (already recorded, no new run needed): after the add the edit
  eye stood at Tunis [1.53, 0.45, 0.87] (2 m from the drone on the floor, gate at [15.41, 4.05, 6.21]) and Wroclaw
  [-0.51, 2.43, -9.01]. Cause in my own wiring: placeAt's aim() (H2) moved the eye to camView = gateCamera(gate, drone, ray),
  which starts at the drone and stops at the first wall: the drone's view. Not course3's code. Fix: placeAt no longer calls
  aim() (the ray fix 8fbb67e3 already puts the gate 7.9 m / 11.6 m ahead of the view).
  Red gate, from the check's code (packages/tracks check.ts 295-315, MARGIN_M 0.5): a gate is clear only when its frame loop
  (opening/2 + ring tube or square bar/2) swept with a 0.5 m sphere touches no wall; addLift put the OPENING's lower edge
  0.5 m over the floor, so the frame plus the sphere reached into the floor on any flat floor (Wroclaw "gate 1 is in a
  wall"). Fix: addLift(state, tr, margin) = (opening/2 + frame) * s + margin (edMargin) + ADD_FLOOR_M 0.3 (an estimate).
  Tunis "the way from gate 0 to gate 1 goes through a wall" (leg sweep from gate 0, 7.7 m up, to the floor gate): not
  explained by the lift alone; to be seen in the next run. Test editor3-g2.test.ts 6 tests (new: floor clearance, placeAt
  without aim), editor3-flying, a6-reference: 3 files 20/20; NEG OK (neg_control.py ref HEAD 535b09c4, add-place.ts and
  course.ts: AssertionError -0.1 >= 0.5); apps/fly tsc 0.
- [x] G2.13 release of 18aff22e (g2/build5.log), full run g2/full5/e4.json (lock 07:00:22-07:04:39, Tunis and Wroclaw,
  KBD=0). Measured: the edit view's own eye now stays where the click came from (viewAfter = click eye: Tunis
  [9.49, 7.03, 0.00], Wroclaw [-5.88, 6.52, -16.46]). Wroclaw: problems 2 -> 1, the new gate is no longer "in a wall"
  (the one problem left: "gate 1 is turned 44 degrees away from the way in"; which gate, not checked). Tunis: problems
  5 -> 7, still "the way from gate 0 to gate 1 goes through a wall". BUT both pictures after the add
  (shots/editor3-floor-add-1920.png, editor3-wroclaw-floor-add-1920.png, 07:02 and 07:04) STILL show the drone's view
  (Tunis inside a palm looking up, ALT 4.1 m; Wroclaw in a tree, ALT 3.9 m; "crashes 1" on the HUD), no gate, no
  handles, no bar, while edHook.view holds the edit eye. So the renderer is posed by someone else after the add: the
  aim() removal was right but not the cause of the picture.
- gates.py --only vitest,architecture,i18n,b18 on 18aff22e: PASS (vitest 114 s, architecture, i18n, b18; logs
  U:/Temp/gsfpv-gates-20261115-070527).
- [ ] left (next worker, in this order; dist is the release of 18aff22e, do not rebuild before a code change):
  1. MEASURE who poses the camera after Add gate + floor click. Add to course.ts __gsfpvEditView: ctx.session.cameraOverride,
     mode, the view's suspended flag, ctx.crash.active, and a counter of onCamera calls; read them in the probe
     (tools/bench/src/editor3-prove.ts floorAdd) right after the click and 2 s later. Lead to check first (a guess, not
     measured): app/builtin/respawn.ts line 94 calls ctx.clearCrash() when s.cameraOverride is true, and the HUD shows
     "crashes 1"; if clearCrash sets cameraOverride false (crash.ts), the session poses the drone again and the edit view's
     onCamera writes only on its next move. If the respawn is triggered by course3's course-respawn link
     (apps/fly/src/course/run.ts or packages/tracks), return blocked with that file; if the trigger is in course.ts or
     the editor folder, set the override back (e.g. view.setCam(view.cam) after showEd) and prove it in a browser run.
  2. Tunis "the way from gate 0 to gate 1 goes through a wall" after the lift fix: record the check's leg report (freeM and
     at of the leg into the new gate, packages/tracks check.ts 257-270) before changing anything; gate 0 stands 7.7 m up
     and the new gate 4.4 m, the click eye saw the floor point by a thin ray, the check sweeps a 0.5 m sphere.
  3. New fault, not in this list (seen in G2.9 and again): after the test flight's disarm the flight STATS window stands
     over the edit view (shots/editor3-floor-before-1920.png); suspect the flight-end stats panel of the fly page.
  4. gates.py --only vitest,architecture,i18n,b18 after the next code change.
- [ ] superseded left list of pass 2 (dist was the release of 8fbb67e3; items 1 and 2 of the stage and the full line are
  proven in G2.7/G2.8, the old list below is done except its point 3):
  1. MEASURE why the page draws the drone's view after Add gate + floor click (full3 pictures). Add to course.ts
     __gsfpvEditView: ctx.session.cameraOverride, mode, view's suspended flag, and a frame counter of the last onCamera; read
     them in the probe right after the click and 2 s later (floorAdd). Guesses only, not measured: course3's "course tied to
     the respawn" resets the session camera on a course change, or showEd/aim after the add. If the cause is in course3's
     files (apps/fly/src/course/** outside editor/, packages/tracks/**), stop and return blocked with the file.
  2. Then why the added gate is red with the gate in front (Tunis "the way from gate 0 to gate 1 goes through a wall",
     Wroclaw "gate 1 is in a wall"): record the floor hit point, the gate's lower edge height over it (addLift: opening/2 +
     ADD_FLOOR_M 0.5) and the check's margin before changing add-place.ts.
  3. Note for probes: view-mouse.ts standScreen() and the probe's stand.screen use the renderer entity, which between frames
     may hold the drone's pose; judge "in front" by place.at against floorBefore.viewBefore (as G2.11 did).
  4. gates.py --only vitest,architecture,i18n,b18: PASS on 239ae5bb (vitest 105 s, architecture, i18n, b18; logs
     U:/Temp/gsfpv-gates-20261115-064831). Run again after the next code change.
- [ ] old left list of pass 1 (1 and 2 done in G2.8-G2.11):
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

- I2 pass 2 outside apps/fly/src/course/editor and course.ts: apps/fly/src/devices/keyboard.ts (D8: while flying in the edit
  mode a held Space climbs and a tap shorter than EDIT_TAP_MS 200 ms, an estimate, disarms on keyup; was: every Space press
  disarmed, so the game scheme had no climb key there), packages/i18n/locales/fly/course/{en,es,pl,ru}.json
  (course.edit.opened says it), tools/bench/test/editor3-g2.test.ts (its text assertion follows the tap),
  tools/bench/test/editor3-i2-space.test.ts (new). a6-reference.test.ts passes.

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

## What the owner does (as of I3-prove, release of 76ffff2c, Tunis 887f27aa and Wroclaw 70b50d42, records in i3/)

1. Shift+B: the same scene, gate 1 selected with the Move arrows, the top bar and the gate bar. Proven on both (24 gates).
2. Click a gate: selected with its handles. Proven on both (gate 2; Wroclaw at the second try, the first click picked 1).
3. Tab: the next gate (1 -> 2), focus stays on the page. Proven on both. Bar's next and previous: 6 -> 7 -> 6 on both.
4. X arrow (Move, W key in the bar): 80 px drag moved the gate 0.3 m along X on both; Ctrl+Z / Ctrl+Y changed and back.
5. Turn (bar or R), pull a ring: ring x 60 deg for 60 px and 135 deg for 140 px, z also turned, on both; undo/redo proven.
6. Size (bar or T), pull the centre cube: Tunis 1.2 -> 2.28 m, Wroclaw 1.5 -> 2.94 m, no move, no turn; undo/redo proven.
7. Bar: ring, square, dive, cube: each changes the kind and the line says it; undo/redo proven on both.
8. Bar: Copy: 24 -> 25 gates, the copy selected with handles; Delete (cross): 25 -> 24, the next gate selected; undo/redo
   proven on both. Shift+Tab back to gate 1: NOT proven (shiftTabBack false on both).
9. F frames the selected gate: not re-measured this pass (I1: gate 0.32 of the view height).
10. Add gate on the top bar, click the floor: 24 -> 25, the new gate selected (Tunis standing 0.58 m, red: 'Gate 21 faces
    away...'; Wroclaw 1.58 m, red); undo/redo proven. The first Add in the path did not add (left c).
11. W A S D, E, Q fly the view 2.27-2.53 m per step on both; the right button held turns the look (0.46 m of the aim).
12. Test flight, keyboard (gate 1 put 6 m ahead): Space armed 276 ms (Tunis) / 268 ms (Wroclaw), keys flew, course.next
    0 -> 1 on both, a Space tap disarmed (21 ms / 281 ms), the edit view back, no flight part shown after.
13. Test flight, pad: NOT proven this pass (the probe put gate 20 ahead and the pad did not arm, left a).
14. A crash in the test flight comes back to the edit view, no crash card: proven on Tunis; Wroclaw no crash produced.
15. The flight's parts in the edit view: hint, THR line, key hints, REC, voltage, stats, crash, lap, note, gate message,
    next-scene hint all 0 in edit, after a flight and after a crash; back after Exit (both scenes); top bar one line.
16. Save (Ctrl+S or Save): NOT proven this pass: both refused by the check (Tunis 'the way from gate 1 to gate 2 goes
    through a wall', Wroclaw 'Gate 2 faces away from the way in'); the refusal stays on the line and selects the gate.
17. Fresh page, Courses, open the saved course: NOT proven this pass (nothing saved); proven in H3 pass 2 on Wroclaw.
18. Esc says 'The changes are not saved. Esc again leaves without saving'; Esc again leaves. Proven on both.

## Cost notes
- I3-prove: about 30 replies; the most went to the 18-minute lock wait on Tunis (two tries in the chain gave up) and to
  reading the 4 records by hand. Cheaper: one summary script for e4.json and clean.json that prints the owner's-path rows,
  and a run.sh that waits for the lock as long as it takes instead of giving up after 9 minutes.
- I2-clean pass 2: about 40 replies, stopped after the Tunis run; the most went to finding the save path (askName, the
  window's Save) and the walls chip's DOM before the probe edits, and to the keyboard test with stubbed globals. Cheaper: a
  probe helper that triggers a refusal and a crash in one call, shared by the editor3 probes.
- I2-clean pass 1: about 40 replies, stopped with code a11f109d and the before run; the most went to finding the class
  names of each flight part (hud.ts, mode-chip.ts, cinema.ts, crash-overlay.ts) and the keyboard's game scheme
  (keyboard.ts, play/keys.ts, game-pilot.ts) before the first run. Cheaper: run the probe's generic leaves list first (it
  named every part with its class in one run), then read only the files it names.
- I1-gizmo pass 2: about 45 replies (over budget); the most went to the two fixes the first after run showed (edge-on ring
  0 deg, grey disabled shapes) and their rebuild and second run, plus one 9-minute lock wait that gave up. Cheaper: read
  PlayCanvas's Shape.disabled and the gizmo's own pick before building D2/D4, and look at the first picture before the
  status is written.
- I1-gizmo pass 3: about 30 replies; the most went to reading nine pictures and to a second Wroclaw run when the click did
  not select. Cheaper: the probe should record the gate's on-screen size and the pick result at the click point, so one
  run tells a probe aim fault from an app fault.
- I1-gizmo pass 1: about 34 replies, stopped before the browser part; the most went to finding where the handles, the
  framing and the PlayCanvas gizmo sizes live (view-mouse.ts, course.ts showEd/aim, playcanvas.mjs 121246 _updateScale and
  setTheme) and to one heredoc that broke (edits now go through a Python file written with Write). Cheaper: a map entry in
  docs/agent-map.md for the edit view (view-mouse.ts = handles, course.ts showEd = selection and camera), and the next
  worker writes the probe first thing while the build runs.
- H3-prove pass 2: about 31 replies; the most went to reading the 900-line probe in slices before the edits; the one
  background chain (two scene holds plus gates) cost only two waits. A step list of the probe in the status file would have
  saved three reads.
- H3-prove: about 40 replies; the most went to the GPU lock (two 9-minute waits that both gave up, then a second
  pass) and to probe edits written without a dry run; a run.sh that keeps waiting for the lock and a 60 s dry run of
  the new probe steps (keyboard flight start, Courses list) would have saved a pass.

- editor3 H2-look pass 2: most turns went to shell quoting (a heredoc python with an apostrophe failed and a test title
  with an apostrophe broke the parse) and to reading the probe; a probe that lists what each part covers found three new
  faults in one run, cheaper than looking at pictures first.

- H2-look: most turns went to reading the 856-line probe and PlayCanvas's ScaleGizmo, and to two failed probe runs (a 'var
  __name' init script stays local to Playwright's wrapper; a backgrounded 'cd && node &' chain left the shell elsewhere).
  Cheaper: a shared probe helper module (open, layout, pad) so a new look probe is 60 lines, and globalThis.__name in it.

- H1-tunis pass 2: about 30 replies; the code (b, c, d) took 10, the Node replica of (a) took the rest: one seed of
  fitCourse ran 804 s in Node, so a measurement of three seeds does not fit a stage; reading the page's own course through
  the new __gsfpvEditView().course in the browser run would have answered (a) for the real seed in the same run as (f).

- H1-tunis: about 30 replies; the most went to finding where the page's generated course and its seed come from
  (worker.ts, course.ts, tracks-audit.ts) before any measurement; a debug accessor that returns the whole edited course
  and its full check report on the page would have made (a) one browser run instead of a Node replica.

- G3-prove pass 3: about 25 replies; the most went to the two scene runs and the accept-fly plus gates run (about 15
  minutes of waiting in three blocking commands); reading store.ts's save check before pass 2's run (one grep) would have
  fixed the probe's stand-in id a pass earlier.

- G3-prove pass 2: about 31 replies; the most went to finding the run's own probe faults (the yaw sign read on the wrong
  camera, a delete loop that kept deleting the same index) one browser run late; dumping the first 3 flight samples and
  the first 2 delete steps in a 60 s dry run before the full chain would have caught both.

- G3-prove: about 32 replies; the most went to the 7-minute GPU lock queue and to the full path run whose summary showed
  four probe gaps (no 6 m gate, no red-gate deletion before Save, a camera-drone pad, no Exit) at once; a probe step list
  checked against the stage text before the run would have closed those gaps in the same build.

- G2 pass 3: the most turns went to the build plus browser run (about 9 min) that showed the camera fix was not the cause
  of the picture; reading the pictures of full3 against viewAfter BEFORE fixing (the eye was right in the record, the
  picture was not) would have pointed at the renderer's other writer at once and saved one build and run.

- G2 pass 2: about 30 replies; the most went to three release builds with a browser run each (about 7 minutes per pair);
  recording the click's ray and the view in the debug hook from the first floor-add run would have named the cause one
  build earlier, and a camera-override field in the hook would have explained the drone's view after the add in this pass.

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
- I2 pass 3: about 31 replies; the most went to three keyboard-flight runs that tuned the probe's height control and a
  10-minute GPU lock wait; logging the climb per held second in the first run (one short calibration flight) would have
  saved a run, and the gates subset run before the browser runs would have caught the stale editor3-g3 regex earlier.
