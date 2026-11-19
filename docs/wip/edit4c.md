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

## What the owner does

(filled in at the last stage)

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

## Not verified

(filled in at the last stage)

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

## Cost notes

- C1: most replies went to the generated courses' turns (a measured 99 false warnings changed the rule); reading
  check.ts's direction rule first would have saved three replies.
- C1w: most replies went to finding the page seams in course.ts (drag path, showEd, the bar lifecycle, the top bar's
  root); a short map of course.ts's editor closures in docs/agent-map.md would have saved four.
- C2: most replies went to the check's 35 deg entry rule refusing every piece (found by reading check.ts, then a rule) and
  to small fixes (npx needs npx.cmd inside neg_control.py; a DOM module imported by a test pulls i18n's `location`); a
  note in the design that the straight-leg rule forbids turn-round pieces would have saved three.
