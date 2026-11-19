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
- [ ] C3 styles and pole/flag as a format spec (docs/wip/edit4c-format.md), acceptance probe tools/bench/scripts/edit4c-probe.mjs.
  - [x] C3a the format spec docs/wip/edit4c-format.md (look?: plain/fabric/led, logo null; marker pole/flag by side).
  - [x] C3b the probe edit4c-probe.mjs (mouse, 1536x730 dsf 1.25, Wroclaw 70b50d42), local build run + live negative.
        Commits c830f6ae, 3aada16d (evidence/2026-11-19/edit4c/probe-local-g1.1.json, probe-live-g1.1.json).
  - [ ] C3c gates, the status file's last parts.

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
  the course in front). The probe's step 2 clicks the nearest leg that does not start at the selected gate, so the old
  page (new gate after the selected one) cannot pass by luck. A click lands where its ray meets the scan (measured: a
  leg 30 m off behind a wall 6 m from the eye takes the gate to the leg nearest that wall point; this is placeFor's rule).
- C3 probe: the course is the link g1.1 (COURSE=g1.1) for the verdicts: Shift+G gives a new seed each press (47 and 38
  gates in two runs), which changes which legs stand on the page. The drawn run uses Shift+G, the pilot's own path.

## What the owner does

1. Open a scene, take the Keyboard, press key Shift+G for a course, key Shift+B for the editor.
2. Press Add on the top bar. A list 'What to add' opens under it: Gate, Double vertical, Triple vertical, Double
   horizontal, Triple horizontal, and a 44 px cross. Gate is chosen.
3. Click a spot on the scan between two gates: the new gate stands there, numbered between them, turned along the
   course's line (half way between the way in and the way out). The line on top says which gate was added.
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
4. The pilot's path with the mouse at 1536x730, device scale 1.25, Wroclaw 70b50d42, course g1.1, pointer lock first:
   a click between gates 14 and 15 makes the new gate 15 between them, 0 deg off the bisector of its legs; Double
   vertical adds 2 gates 2.0 m apart up, Triple horizontal 3 gates 2.2 m apart in a row, one Undo press removes each;
   dragging gate 1 by its forward arrow shows the tag ('Too sharp a turn to fly into gate 2') during the drag; the
   release asks Keep / Put back, Put back gives the exact old pose, Keep leaves it and lists the gate as kept (orange);
   at 844x390 the Add list fits, no item is covered, its cross is 44 px and closes it. Proof:
   `COURSE=g1.1 QUERY='&render=off' node tools/bench/scripts/edit4c-probe.mjs http://localhost:6001/en <out.json>` on
   the release build of 3aada16d. Last result: PASS, 10 of 10 (evidence/2026-11-19/edit4c/probe-local-g1.1.json).
   Negative control, the same probe on the live site (read-only: nothing saved; the gates added stay in the page):
   s1 PASS, the nine others FAIL; the same click (same point, same 75.7 m wall hit) puts the gate after gate 1, 89 deg
   off the line; no Add list, no tag, no Keep question (evidence/2026-11-19/edit4c/probe-live-g1.1.json).

## Not verified

- No person, phone or real controller took part. Every page check is headless Chrome with a mouse sent by Playwright.
- The verdict runs use ?render=off (no picture judged); the hit tests and projections are the edit view's own maths.
- Touch: the Add list, the tag and Keep / Put back were not tried with fingers (the C1w unit test places the box in
  844x390; the probe's 844x390 step is a resized mouse page, not a phone).
- The 8 s 'no answer keeps it' is in the pure test only (the probe always answers).
- Other keyboard layouts were not walked in the page: the new controls are buttons; no new key was added.
- A generated course from Shift+G: the probe's verdicts use the link g1.1; how a person's own seed lays out on the
  page differs (see the drawn run below).
- Gate looks and the pole and flag: spec only, nothing to verify in the page.
- Gates (gates.py on 892a7c90: typecheck, vitest, architecture, i18n, b18, leaks): all PASS but vitest, 1 failed of
  5352 (5337 passed, 14 skipped): tools/bench/test/app-dji-rc2.test.ts:188 `rc.late` 1, expected 0, a timing check of the
  DJI RC 2 path while about 15 lanes ran vitest at once. This branch changes neither that test nor apps/fly/src/devices
  (`git diff origin/main..HEAD` on both is empty); the train's rules keep lanes off the DJI RC 2 path, so it was not
  re-run here. Log U:/Temp/gsfpv-gates-20261119-165215.

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
- vitest: tools/bench/test/app-dji-rc2.test.ts:188 failed once in the gates under load (see Not verified); not this
  lane's file, worth one re-run on the merged train.
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
- C3: most replies went to the probe's own aim (9 page runs: legs far off behind a wall, the arrow chosen by screen
  direction, the Add list covering the click, Esc leaving the edit view) and to a GPU lock left by a killed run; a
  shared probe helper (pick a scene point free of handles, pick the arrow by the gate's 3D axes, end adding safely) and
  a lock wrapper with a trap in train4-common.md would have saved five.
