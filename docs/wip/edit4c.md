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
      pieces.css. Test tools/bench/test/edit4c-warn.test.ts. Commit: see git log (edit4c C1w).
- [ ] C2 pieces: double and triple vertical, double and triple horizontal (one undo step each), Add menu items.
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

## Not verified

(filled in at the last stage)

## For the lead

- Files changed outside the lane's owned files: apps/fly/src/app/builtin/course.ts (placeAt: placeFor instead of
  addFacing; import line; C1w: the WarnBar and LiveWarnings made beside the gate bar and destroyed with it, dragTo asks
  them during the drag and on the release, showEd paints with warns.painted and closes an open question on another
  edit, __gsfpvEditView gets `warn`), apps/fly/src/course/view.ts (one PAINT entry 'warn' orange),
  packages/tracks/test/editor.test.ts (the insert test asserts the new line).
- The WarnBar's page behaviour (the tag during a real mouse drag, Keep / Put back / 8 s) is first seen by the C3 probe;
  C1w has only the pure tests.
- Seam wanted (when S0 lands): Services.placeFor = add-place.ts placeFor bound to the state; EditAction 'add' carries
  `after` (the gate it follows); S0's planned 'place' action can reuse it.

## Cost notes

- C1: most replies went to the generated courses' turns (a measured 99 false warnings changed the rule); reading
  check.ts's direction rule first would have saved three replies.
- C1w: most replies went to finding the page seams in course.ts (drag path, showEd, the bar lifecycle, the top bar's
  root); a short map of course.ts's editor closures in docs/agent-map.md would have saved four.
