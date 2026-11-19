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

1. Opens a scan, clicks Keyboard on the Controls screen, clicks into the scene, takes off, key Shift+G (a course), key
   Shift+B: the edit view. Every gate in view carries its number (1 is the first gate), lime; the selected one yellow; a
   gate with a problem red.
2. Clicks Course on the top bar: a menu under it with its own 44 px cross: New empty course, Delete all gates, Generate a
   new course, Overview, Courses, Keys.
3. Clicks Delete all gates: a question names how many gates go; No keeps them, Yes leaves an empty course and the line
   says how to bring them back (Undo); Undo on the top bar brings every gate back.
4. Course > New empty course: the same question when his gates changed; Yes gives an empty course of his own, and Add
   gate is already on: the next click on the floor puts gate 1, then Add gate and a click put gate 2 (numbers 1 and 2).
5. Clicks Fly the course on the top bar: the drone flies the course at once and the button reads Back to editing; a click
   on it brings the edit view back with the top bar. (A radio or pad with its own arm switch: after 0.9 s the line says
   which switch to flip.)
6. Course > Generate a new course: the question comes first; No leaves his gates as they were.
7. A sentence that names a gate (Save refused: "Not saved. Gate 1 stands in a wall ...") selects that gate where it
   stands; its number and paint flash 3 times; the view does not turn; when the gate is out of view an arrow with its
   number at the screen edge leads to it, and a click on the arrow turns the view to it.
8. On a phone-sized view (844x390) the menu and the question stay inside the screen, their crosses 44 px.

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
5. The pilot's own path with the mouse at 1536x730, device scale 1.25, Wroclaw 70b50d42, on the release build (steps 1-11
   of design B3: numbers in the hook and on screen; Delete all No/Yes; Undo; New empty course with Add on; two floor gates
   numbered 1 and 2; Fly the course within 1 s; Back to editing; Generate asks and No keeps; a refused Save names gate 1
   while gate 2 is selected: gate 1 selected, its number flashing, eye moved 0 m; the menu and the question inside
   844x390 with 44 px crosses). Proof: `QUERY='&render=off' node tools/bench/scripts/edit4b-probe.mjs
   http://localhost:5960/en 70b50d42 1536x730 1.25 local-off <out>`: PASS 11/11
   (evidence/2026-11-19/edit4b/local-off.json).
6. Negative control of the whole lane: the same probe against the live site (the code before this train, read-only:
   nothing saved there, Save is never pressed on it): FAIL on 9 of 11 steps (evidence/2026-11-19/edit4b/live-off.json).
   Steps 4 (Undo) and 8 (back to edit) pass there only because nothing was deleted and the mode never left edit.

## Not verified

No person, phone or real controller took part in any check of this lane.
- The page path ran headless Chrome only (?render=off for the judged run); the mouse is Playwright's.
- The edge arrow's click (frames the pointed gate) is not clicked by the probe: in the judged run the named gate's label
  was on screen, so no arrow was drawn; earlier runs showed the arrow flashing ("3" with an arrow sign) but the click is
  covered by unit tests only.
- Step 10 needs a gate with a problem: gate 1 put on the floor in step 6 stood in a wall in the judged run; when no gate
  has a problem the probe tries floor spots (an accepted gate is undone) and can find none on another scan.
- A gate the pilot adds is still framed by the hub (train 3 I1, D1: a new selection frames it), so a refused floor gate
  is pointed at after that glide; only the pointing itself is proven not to move the eye (0 m on the refused Save).
- Reduced motion (steady 3 s mark) is unit-tested only.

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
B3: one new file, tools/bench/scripts/edit4b-probe.mjs (part B's probe). Live check after the deploy: `QUERY='&render=off'
node tools/bench/scripts/edit4b-probe.mjs https://gsfpv.flyreelstudio.eu/en 70b50d42 1536x730 1.25 live-after <out>`:
expect PASS 11/11 except that step 10 is judged on the refused floor gate there (Save is never pressed on the live site;
the floor gates live only in the page). If edit4s changes what the top bar's Save does (today: it opens the window's save
part at the name), the probe's step 10 Save path (.ce-name, .ce-save-mine) needs its new handles.

## Cost notes

- B1: the most replies went to finding that S0 did not exist and writing its pieces; bash heredocs broke two patch
  scripts (write scripts with the Write tool from the start).
- B2: most replies went to reading the hub (course.ts) for the flown gate pose, the project() path and showWrong; a
  design line naming gateFlownPose and the seam's lack of a paint path would have saved four. neg_control needs npx.cmd on
  Windows.
