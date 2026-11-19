# Lane edit4c (train 4): course editor content (E11 E12 E13)

Design: C:/dev/.gsfpv-lanes/designs/edit4.md part 5 (edit4c). Owner's words: brief lines 545-546, 557-558, 561-562.
Work copy C:/dev/gsfpv-v13-host, branch edit4c from origin/main e3201fec.

## Status

- [x] C1 placing and warnings (pure + the click path): course-line.ts, add-place.ts placeFor, editor.ts insert along the
      course's line and add after a given gate, warn.ts placeWarnings, course.ts placeAt uses placeFor. Test
      tools/bench/test/edit4c-place.test.ts. Commit e8a812f5.
- [x] C1w live warnings on the page: while a gate drags, its paint 'warn' and a tag beside it; on release with a warning
      a small bar 'Keep it here?' [Keep] [Put back], 8 s no answer = keep; texts in locales fly/course-pieces (en es pl ru).
      warn-live.ts LiveWarnings (pure state: 10 a second, kept gates orange until fixed), warn-bar.ts WarnBar (the box,
      44 px cross, Put back = the undo key's row), warn.ts warnPlace/warnedGates, rules.ts paint 'warn', pieces-texts.ts,
      pieces.css. Test tools/bench/test/edit4c-warn.test.ts. Commit 398ccd1b.
- [x] C2 pieces: double and triple vertical, double and triple horizontal (one undo step each), Add list items.
      packages/tracks pieces.ts (PIECES table, pieceLayout), editor.ts EditAction 'piece', check.ts entryDeg + TURN_PAIR_M
      (a piece's turn round is a way in), warn.ts uses entryDeg, add-place.ts pieceLift/pieceAction, piece-menu.ts
      AddChooser (shown while Add is armed), pieces-texts.ts ADD_CHOICES and keys, pieces.css, course.ts wiring.
      Test tools/bench/test/edit4c-pieces.test.ts. Commit 55fb8b2b.
- [x] C3 styles and pole/flag as a format spec (docs/wip/edit4c-format.md), acceptance probe tools/bench/scripts/edit4c-probe.mjs.
  - [x] C3a the format spec docs/wip/edit4c-format.md (look?: plain/fabric/led, logo null; marker pole/flag by side).
        Commit 9b963eee.
  - [x] C3b the probe edit4c-probe.mjs (mouse, 1536x730 dsf 1.25, Wroclaw 70b50d42), local build run + live negative.
        Commits c830f6ae, 3aada16d, the final probe in the C3c commit (evidence/2026-11-19/edit4c/).
  - [x] C3 fix found by the probe: a click whose ray passes a leg in front of the wall puts the gate on that leg
        (course-line.ts legOnRay, rayToSegment; add-place.ts placeFor). Commits ad7a5b2b, 158f8c79.
  - [x] C3c gates, the status file's last parts (this commit).

Differences from the design (the code wins):
- S0 (the seam, seam.ts, parts.ts) does not exist: all four edit4 lanes branched from e3201fec at once. This lane builds
  its side as plain modules and wires the one click path in course.ts placeAt itself (5 lines, listed under For the lead).
- 'sharp-turn' is not "turn between legs over 120 deg": that fired on 99 turns of 39 generated courses (up to 179 deg,
  flown with the generator's run out after a gate). It is the walls check's own rule instead: the moved gate or the next
  one can no longer be entered forward (axis off its leg in by more than AXIS_TOLERANCE_DEG 35), which refuses the save.
- 'too-close' is "the frames nearer than 0.2 m" (centres closer than the half openings plus CLOSE_GAP_M), not
  1.5 x the larger opening: the design's rule would fire on its own stacked pieces (centres 1.8 m apart).
- A duplicate goes along the course's curve (a cubic Hermite leaving the gate along its axis, entering the next along
  its axis), at most half way, so repeated duplicates bend with the course; the last gate's duplicate goes ahead along
  its axis as before.
- C2: the design's 'Add menu' (top-bar.ts menu(), S0) does not exist. Add still arms a plain gate with ONE press (editor3's
  path and its probes unchanged); while armed, a list 'What to add' (piece-menu.ts) under the Add button offers Gate and
  the four pieces, with its 44 px cross (= Esc = Add again). A piece is EditAction 'piece' (not S0's 'replace', which does
  not exist either).
- C2: the walls check's entry rule (axis within 35 deg of the STRAIGHT leg in) refused every piece: a stack's second gate
  is reached straight up, a row's sideways. check.ts entryDeg: a gate within TURN_PAIR_M 3 m of the gate before it whose
  way is that gate's way reversed (within 35 deg) is entered after a turn round, judged against that reversed way. Only
  closer-than-3-m opposite pairs are affected (the generator makes none: its tunnel gates face one way); the server
  (tracks.py, server.ts) checks structure only, so it needs no change.
- C2: a double piece turns the course round (in through the first, back through the second): the gate after it may then
  warn 'sharp turn' and block saving until it is turned. The triples come out the way they went in.
- C3: the gate looks (E13) and the pole and the flag (E12, second half) are NOT built: they change the course format,
  which lives in packages/sonic-fpv (another repository; the design keeps it out of this train). C3 ships the spec
  docs/wip/edit4c-format.md only; no submodule PR was opened (no push in this train).
- C3 probe: the design's step 1 'Home' does not exist (no key frames the whole course; the view opens on gate 1 with
  the course in front). The probe's step 2 clicks the nearest leg (4 m off at least) that does not start at the selected
  gate, so the old page (new gate after the selected one) cannot pass by luck; a leg behind the scan from the eye (the
  ray met a wall well before it: the pilot clicked that wall) is tried, undone and not judged.
- C3 (not in the design, found by the probe): the design's C1 rule 'the wall point, after the leg nearest to it' took a
  click on a leg in front of a far wall to that wall (Shift+G course: a click between gates 9 and 10, 12 m off, gave a
  gate 36 m off after gate 3). legOnRay: the leg the ray passes nearest (0.3 m or 3 % of the way, not within 2 m of the
  eye) before the wall takes the gate, 2 m from its ends. The wall-point rule stays for clicks on the scan between legs.
- C3 probe: three verdict runs: the course link g1.1 (COURSE=g1.1, the same course on live) and two Shift+G courses
  (a new seed each press: 39 and 27 gates).

## What the owner does

1. Open a scene, take the Keyboard, press key Shift+G for a course, key Shift+B for the editor.
2. Press Add on the top bar. A list 'What to add' opens under it: Gate, Double vertical, Triple vertical, Double
   horizontal, Triple horizontal, and a 44 px cross. Gate is chosen.
3. Click between two gates: on the course's line he sees between them, the new gate stands on that line; on the scan
   beside it, at that spot. Either way it is numbered between them and turned along the course (half way between the
   way in and the way out). The line on top says which gate was added.
4. Press Add, pick Double vertical, click a spot: two gates stacked 1.9 m apart; the line says 'Fly in through gate N,
   turn round, back through the next'. Triple horizontal: three gates in a row 2.1 m apart. One Undo removes the piece.
5. Pull a gate's arrow toward another gate or into a wall: while he drags, the gate turns orange and a tag beside it
   says what breaks ('Too sharp a turn to fly into gate 2', 'The way from gate 1 to gate 2 goes through a wall').
6. He lets go: the tag asks 'Keep it here?' with Keep and 'Put back (key Ctrl+Z)'. Put back returns the gate; Keep (or
   no answer for 8 s) leaves it, and the gate stays orange until he moves it to a good place.
7. Key I (or Insert, or the gate bar's duplicate) repeated on a curved course follows the curve, not a straight row.

## Claims

1. A click with Add armed between gates 3 and 4 puts the new gate after gate 3, facing the bisector of its legs within
   5 deg; three duplicates on a curved course are not collinear; each warning code fires on a made case and none on six
   generated courses. Proof: `npx vitest run tools/bench/test/edit4c-place.test.ts`. Last result: 5 passed; NEG OK on
   origin/main for all five source files, and for packages/tracks/src/editor.ts alone (the duplicates test fails).
2. A drag next to another gate warns at once ('too-close'), the dragged gate is painted 'warn' (orange) at most 10 times a
   second worked out; on the release the warnings come back; a kept gate stays orange until moved to a good place; the
   texts exist in en es pl ru with the same keys and values; the box stands above the gate, under the gate bar or under
   the top bar, inside 1536x730 and 844x390. Proof: `npx vitest run tools/bench/test/edit4c-warn.test.ts`. Last result:
   6 passed; NEG OK against e8a812f5 (rules.ts, warn.ts, warn-live.ts, pieces-texts.ts). Related tests (editor3-*,
   editfix-e4, course-finish, i18n parity, edit4c-*): 28 files, 204 passed.
3. Each of the four pieces puts 2 or 3 new 1.5 m square gates after the gate it follows, ids unique, every second one
   turned round, stacked 1.9 m up or 2.1 m apart in a row, frames not 'too-close'; one undo removes all of them;
   validateServerTrack takes the course; a full course refuses with max-gates; the walls check finds every piece gate's
   direction right and no sharp-turn warning fires on them (and a far opposite pair is still judged by its straight leg);
   the lap judge counts a double vertical's 2 gates flown as a loop and gives no lap when the high gate is passed the
   wrong way; the Add list is Gate + the 4 pieces. Proof: `npx vitest run tools/bench/test/edit4c-pieces.test.ts`. Last
   result: 8 passed; NEG OK on origin/main (all eight source files) and on HEAD~ for packages/tracks/src/check.ts alone
   (the turn-round test fails). `npx vitest run --changed origin/main`: 98 files, 961 passed, 10 skipped; fly-parity and
   edit4c-warn (the four locales, PIECE_KEYS): 19 passed.
4. The pilot's path with the mouse at 1536x730, device scale 1.25, Wroclaw 70b50d42, pointer lock first: a click
   between two gates (not after the selected one) makes the new gate numbered between them, 0 deg off the bisector of
   its legs; Double vertical adds 2 gates 2.0 m apart up, Triple horizontal 3 gates 2.2 m apart in a row, one Undo press
   removes each; dragging a gate by the arrow toward the next gate shows the tag during the drag ('Too sharp a turn to
   fly into gate 2', 'A wall stands in the opening of gate 1', 'The way from gate 1 to gate 2 goes through a wall'); the
   release asks Keep / Put back, Put back gives the exact old pose, Keep leaves it and lists the gate as kept (orange);
   at 844x390 the Add list fits, no item is covered, its cross is 44 px and closes it. Proof:
   `COURSE=g1.1 QUERY='&render=off' node tools/bench/scripts/edit4c-probe.mjs http://localhost:6001/en <out.json>`
   (and without COURSE: a Shift+G course) on the release build of 158f8c79. Last result: PASS 10 of 10 on g1.1 (leg 14 ->
   15, 76 m wall hit) and on two Shift+G courses (39 and 27 gates; leg 2 -> 3, the ray through the leg met a wall 34 m
   off) (evidence/2026-11-19/edit4c/probe-local-g1.1.json, probe-local-shiftg-a.json, probe-local-shiftg-b.json).
   Negative control, the same probe on the live site (read-only: nothing saved; the gates added stay in the page):
   s1 PASS, the nine others FAIL; the same click (same point, same 75.7 m wall hit) puts the gate after gate 1, 89.1 deg
   off the line; no Add list, no tag, no Keep question (evidence/2026-11-19/edit4c/probe-live-g1.1.json).
5. A click whose ray passes a leg in front of the wall puts the gate on that leg (at the point passed, 2 m from its
   ends), faced along it; a wall in front of the leg keeps the wall point; a leg beside the eye (under 2 m) is not the
   one clicked; at a gate shared by two legs the leg passed nearest wins. Proof: `npx vitest run
   tools/bench/test/edit4c-place.test.ts`. Last result: 6 passed; NEG OK on 6df925f4 (add-place.ts, course-line.ts) and
   on ad7a5b2b (course-line.ts, the 1 m first-along-the-ray rule). Related tests (edit4c-*, editor3-flying, -g2, -g3,
   -h1, tracks2-fixes): 8 files, 47 passed; apps/fly typecheck clean.

## Not verified

- No person, phone or real controller took part. Every page check is headless Chrome with a mouse sent by Playwright.
- The verdict runs use ?render=off (no picture judged); the hit tests and projections are the edit view's own maths.
- Touch: the Add list, the tag and Keep / Put back were not tried with fingers (the C1w unit test places the box in
  844x390; the probe's 844x390 step is a resized mouse page, not a phone).
- The 8 s 'no answer keeps it' is in the pure test only (the probe always answers).
- Other keyboard layouts were not walked in the page: the new controls are buttons; no new key was added.
- One drawn run (GPU, Shift+G, the build of c830f6ae, before the legOnRay fix): 9 of 10; its s2 failure was the
  far-wall case that the fix then answered. Picture U:/Temp/gsfpv-train4/shots/edit4c-drag-tag.png: the Wroclaw street,
  gate 1 dragged and drawn in orange and black stripes, the tag 'A wall stands in the opening of gate 1' in a large
  orange-edged box under it, clear of the top bar and the gate bar. The build with the fix was not drawn (no picture
  judged by its steps; the GPU lock is shared by about 15 lanes).
- The probe's s2 aim depends on the view: it skips legs behind the scan and legs nearer than 4 m; on another scan or
  seed it may find no leg to judge (then s2 FAILs with `judged: null`, not a wrong verdict).
- Gate looks and the pole and flag: spec only, nothing to verify in the page.
- Gates (gates.py on 892a7c90: typecheck, vitest, architecture, i18n, b18, leaks): all PASS but vitest, 1 failed of
  5352 (5337 passed, 14 skipped): tools/bench/test/app-dji-rc2.test.ts:188 `rc.late` 1, expected 0, a timing check of the
  DJI RC 2 path while about 15 lanes ran vitest at once. This branch changes neither that test nor apps/fly/src/devices
  (`git diff origin/main..HEAD` on both is empty); the train's rules keep lanes off the DJI RC 2 path, so it was not
  re-run here. Log U:/Temp/gsfpv-gates-20261119-165215.
- Gates on the final code (ad15dce4, after the legOnRay fix): typecheck, architecture, i18n, b18, leaks PASS; vitest
  5332 passed, 21 skipped, no test failed, but one file failed to set up: tools/bench/test/rooms-race.test.ts:110
  'rooms.py did not start' (its own Python server, under the shared load of the other lanes). The DJI RC 2 test of the
  first run passed this time. This branch changes no rooms file (`git diff origin/main..HEAD` on the test,
  apps/rooms and builtin/rooms.ts is empty). Log U:/Temp/gsfpv-gates-20261119-174716.

## For the lead

- Files changed outside the lane's owned files: apps/fly/src/app/builtin/course.ts (placeAt: placeFor instead of
  addFacing; import line; C1w: the WarnBar and LiveWarnings made beside the gate bar and destroyed with it, dragTo asks
  them during the drag and on the release, showEd paints with warns.painted and closes an open question on another
  edit, __gsfpvEditView gets `warn`), apps/fly/src/course/view.ts (one PAINT entry 'warn' orange),
  packages/tracks/test/editor.test.ts (the insert test asserts the new line). C2: course.ts again (the AddChooser made
  and destroyed beside the top bar, showAdding/chooseAdd/placePiece, `add` in __gsfpvEditView), course/editor/texts.ts
  (ACTION_KEYS gets `piece`, one line), packages/tracks/src/index.ts (exports pieces.ts), packages/tracks/src/check.ts
  (entryDeg, TURN_PAIR_M: the design lists check.ts as this lane's, read-mostly).
- Deploy: page only (no API, rooms, nginx or sound package file).
- Seam wanted (C2): Services.pieceMenu = ADD_CHOICES with chooseAdd; when S0's top-bar menu lands, the AddChooser can be
  replaced by its items (one file, piece-menu.ts).
- The WarnBar's page behaviour (the tag during a real mouse drag, Keep / Put back / 8 s) is first seen by the C3 probe;
  C1w has only the pure tests.
- Seam wanted (when S0 lands): Services.placeFor = add-place.ts placeFor bound to the state; EditAction 'add' carries
  `after` (the gate it follows); S0's planned 'place' action can reuse it.
- C3: new files only (docs/wip/edit4c-format.md, tools/bench/scripts/edit4c-probe.mjs, evidence/2026-11-19/edit4c/).
- The owner's yes is needed for the format change (docs/wip/edit4c-format.md): gate looks plain / fabric / led and the
  pole and flag markers. Then the Fly by Sound repository first, the pin move, then tracks.py and the page.
- Live checks after the deploy (read-only): `COURSE=g1.1 QUERY='&render=off' node tools/bench/scripts/edit4c-probe.mjs
  https://gsfpv.flyreelstudio.eu/en <out.json>` must give PASS 10 of 10 (today on live: 1 of 10). It saves nothing.
- vitest: tools/bench/test/app-dji-rc2.test.ts:188 (first gates run) and tools/bench/test/rooms-race.test.ts (second:
  rooms.py did not start) failed once each under load (see Not verified); neither is this lane's file, each passed or
  was not reached in the other run; worth one re-run on the merged train.
- C3 also changed (owned files): apps/fly/src/course/editor/course-line.ts (rayToSegment, legOnRay, ON_LEG_*),
  add-place.ts (placeFor asks legOnRay first), tools/bench/test/edit4c-place.test.ts (the C1 click's eye moved so its
  ray still meets the wall first; the C3 case).
- The C3 drawn run's first try was stopped by the run's time limit while it held C:/dev/.gpu-lock; the lane found the
  lock orphaned (no live holder, edit4a still waiting) at 17:05 and removed it; edit4a took it at once.

## Cost notes

- C1: most replies went to the generated courses' turns (a measured 99 false warnings changed the rule); reading
  check.ts's direction rule first would have saved three replies.
- C1w: most replies went to finding the page seams in course.ts (drag path, showEd, the bar lifecycle, the top bar's
  root); a short map of course.ts's editor closures in docs/agent-map.md would have saved four.
- C2: most replies went to the check's 35 deg entry rule refusing every piece (found by reading check.ts, then a rule) and
  to small fixes (npx needs npx.cmd inside neg_control.py; a DOM module imported by a test pulls i18n's `location`); a
  note in the design that the straight-leg rule forbids turn-round pieces would have saved three.
- C3: most replies (about 100, three builds, some 25 page runs) went to the probe's own aim on random Shift+G views (legs
  behind a wall, the arrow chosen by screen direction, the Add list covering the click, Esc leaving the edit view, the
  view still gliding after a selection, legs beside the eye) and to the far-wall bug it found; a GPU lock left by a
  killed run cost four. Cheaper: run on 2-3 seeds from the first probe run (one seed hid the far-wall bug), a shared
  probe helper (a scene point free of handles, the arrow by the gate's 3D axes, end adding safely, settle) and a lock
  wrapper with a trap in train4-common.md.
