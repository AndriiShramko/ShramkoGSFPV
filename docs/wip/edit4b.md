# Lane edit4b: the course's life in the editor (E4 E5 E8 E10)

Design: C:/dev/.gsfpv-lanes/designs/edit4.md part B. Owner's words: brief lines 541-544, 551-556.

## Status

- [x] B1 life: empty course, Delete all gates (asks), Generate asks first, Fly / Back to editing button, KeyG gone
  (893e3a9f wip; the commit titled 'edit4b B1: the course's life')
- [x] B2 numbers and pointing: gate numbers on screen, every message naming a gate points at it (the commit titled
  'edit4b B2: gate numbers and pointing')
- [ ] B3 acceptance probe tools/bench/scripts/edit4b-probe.mjs, gates, status parts complete

Differences from the design (the code wins):
- Stage S0 (the seam) was never built: no commit of it exists and all four edit4 lanes branched from origin/main
  e3201fec at once. This lane wrote the parts of S0 that B needs: course/editor/seam.ts (the contract's types member for
  member, plus SeamBus), course/editor/parts.ts (the glob loader), the course.ts wiring (makeSeam, testFlight, startNew,
  applyEdit, a default frameAll, project), MIN_GATES 0 / selected -1 / 'replace' / refusal 'no-gate' in editor.ts, and
  the top bar's seven buttons (add undo redo fly save course exit; Courses and Keys moved into the Course menu).
- The design's CourseProblem 'empty' was not added: canSave() is false for an empty course and refusedSave says
  course.life.saveEmpty and turns Add gate on (no new problem code for the other parts' tables).
- gen4's dialog (app/ask.ts askFirst) was absent: parts/life-ask.ts holds the same signature.
- The bar labels went to fly/course as the design says (course.edit.bar.fly|back|course); 'overview' is
  course.life.menu.overview. Two more keys in fly/course: course.edit.key.cleared, course.edit.r.noGate (the tests hold
  REFUSAL_KEYS and ACTION_KEYS to fly/course).
- testFlight needs the keyboard's arm: devices/keyboard.ts got setKeyboardArm(on) (a window event KB_ARM_SET, the same
  mechanism as the existing KB_ARM_STOP). A radio or pad with an arm switch does not follow the button: after 0.9 s the
  line says to flip the switch (course.life.flySwitch / backSwitch).
- B2: the flash paint needs a way from a part to the stage: seam.ts got one member, flashGate(index, on) (course.ts:
  stage.flashEdit). point.ts is no part of its own (no install): gate-numbers.ts owns the labels and drives its GatePointer
  each frame. The edge arrow for a gate behind the eye stands at the bottom middle (project() gives no direction there).
- B2: showWrong (a refused Save, a refused floor-added gate) no longer turns the camera (aim): it calls pointAt; the edge
  arrow's click is the one way to frame the gate (design: auto-framing the named gate rejected). The problem words of the
  window's status line (PROBLEM_KEYS) do not select: every gate they name is a red label (rules.ts badGates).
- B2: selected label yellow (the selected paint has been yellow since train 3 I1, not magenta); the flash is magenta.

## What the owner does

(filled in B3)

## Claims

1. Delete all gates empties the course in one undo step; Ctrl+Z brings every gate back; the last gate can be deleted;
   an empty course takes its first gate from Add and is never saved. Proof: `npx vitest run
   tools/bench/test/edit4b-life.test.ts` (25 with fly-parity: pass). NEG on origin/main: NEG OK (11 failed).
2. The Course menu holds New empty course, Delete all gates, Generate a new course, Overview (then Courses, Keys);
   Generate, New and Delete all ask first and do nothing before Yes. Same test.
3. No key regenerates (KeyG gone); the top bar has Fly the course, which reads Back to editing while flying and stays
   on the bar. Same test, plus the updated pins in editor3-fixes, editor3-flying, tracks-editor-ui, tracks editor.test
   (`npx vitest run --changed origin/main`: 103 files pass after the pin updates).
4. In the edit view every gate in view carries its number from 1 (lime, the selected yellow, a refused one red); a label
   over a nearer one, over an editor bar or behind the eye is dropped. A sentence that names a gate to fix selects it where
   it stands, flashes its number and paint 3 times in 1.5 s (reduced motion: steady 3 s), and an edge arrow with its number
   leads to it when it is out of view; a click on the arrow frames it. Proof: `npx vitest run
   tools/bench/test/edit4b-numbers.test.ts` (9 pass); NEG on origin/main: NEG OK (8 failed). `npx vitest run --changed
   origin/main`: 105 files, 1080 tests pass; fly-parity 13 pass; apps/fly typecheck clean.

## Not verified

No person, phone or real controller took part in any check of this lane.
- B1 is proven by unit tests only; the page path (menu, dialog, Fly button, empty course on the real scene) is B3's
  probe.
- B2 is proven by unit tests and source pins only: the DOM layer (labels on the page, the arrow button) has no Node DOM
  here (no jsdom): B3's probe checks it on the page.

## For the lead

Files changed outside part B's owned list (all because S0 was not built):
- apps/fly/src/app/builtin/course.ts (seam, Fly button, empty course, regen command removed)
- apps/fly/src/course/editor/seam.ts, parts.ts (new, S0's)
- apps/fly/src/course/editor/bar-place.ts (TOP_BUTTONS, TopPress, COURSE_MENU_HUB), keys.ts (KeyG removed),
  texts.ts (no-gate, replace, menu keys), editor.css (fly button stays while flying)
- apps/fly/src/course/hook.ts (source 'new'), apps/fly/src/devices/keyboard.ts (setKeyboardArm)
- packages/tracks/src/editor.ts (MIN_GATES 0, selected -1, 'replace', 'no-gate', canSave false when empty)
- packages/i18n/locales/fly/course/*.json (bar.fly, bar.back, bar.course, key.cleared, r.noGate; flyHint and flying
  name the button)
- tests: packages/tracks/test/editor.test.ts, tools/bench/test/editor3-fixes, editor3-flying, tracks-editor-ui
Merge notes: edit4a, edit4s, edit4c will each have written their own S0 pieces; seam.ts here is the design's contract
verbatim, so an identical file merges clean; course.ts needs a hand merge. seam.gateBar is a no-op here (gate-bar.ts
takes no extra button yet): C's Look button needs it. placeFor and pieceMenu have no default provider here (no B code
calls them). Swap parts/life-ask.ts askFirst for gen4's app/ask.ts at merge (one import in parts/life.ts).
B2 outside the owned list: seam.ts (flashGate, one member more than the design's contract: merge it into the shared seam),
course.ts (makeSeam flashGate; showWrong points instead of aim). Other parts' messages that name a gate (S's save problems,
C's warnings) call seam.call('pointAt', index, reason) on their side.
Deploy order: page only.

## Cost notes

- B1: the most replies went to finding that S0 did not exist and writing its pieces; bash heredocs broke two patch
  scripts (write scripts with the Write tool from the start).
- B2: most replies went to reading the hub (course.ts) for the flown gate pose, the project() path and showWrong; a
  design line naming gateFlownPose and the seam's lack of a paint path would have saved four. neg_control needs npx.cmd on
  Windows.
