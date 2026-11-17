---
type: status
status: in-work
summary: Lane editfix - why the course edit mode (Shift+B) does nothing for the owner on his laptop
created: 2026-11-16
---

# Lane editfix (train 3)

The owner's report of 2026-11-16 (translated): he entered the editing and cannot move around the scene, cannot select a
gate, Add gate shows nothing, Exit does nothing; the top menu bar hangs and that is all; Escape works, menus switch.
His laptop: Windows, RTX, 144 Hz, Chrome, keyboard and mouse, layouts ru/pl/en.

## Status

- [x] E1.1 branch editfix from origin/main 88ee98c3; release build of it (exit 0); walls stand-ins in dist/walls.
- [x] E1.2 probe tools/bench/scripts/edit-mouse-probe.mjs (a3b4b2b4; camera, Add place and window-effect fixes in the
  commit of this line). Runner U:/Temp/gsfpv-train3/editfix/run.sh (one GPU lock per case), log runs.log there.
- [x] E1.3 the owner's symptoms reproduced and the main cause found (below), Wroclaw 70b50d42, local release, port 5820.
- [x] E1.4 all cases of the list run (pass 2, 11:43-12:12), live read-only at 1536x730 x1.25 reproduces cause 1; cause 3
  (right drag on the handles moves the gate) found; probe: COURSE_MS, rightDragEmpty, Controls screen scrolled by the
  wheel on short views (commit of this line).
- [x] E1.5 gates.py --only vitest,architecture,i18n,b18,leaks: all PASS (vitest 117 s), logs U:/Temp/gsfpv-gates-20261116-121259.
- [x] E2.1 the three causes repaired (commit of this line): 1 course.ts openEdit takes fly-mode.ts openStep(armed) (hold set,
  armed drone to the start), editor.css keeps Exit clickable while flying, the flying line names Space and the controller
  (en es pl ru); 2 top-bar.ts clears a held line on pointerup, not pointerdown; 3 view-mouse.ts gizmos take the left
  button only (HANDLE_BUTTONS, in place: PlayCanvas 2.23.2 has a getter only). Test tools/bench/test/editfix-e2.test.ts
  6 tests, NEG OK (all 6 fail on origin/main files); editor3-*.test.ts + it: 122 passed; tsc apps/fly exit 0.
- [x] E2.2 release build of ad2d4e2e (exit 0, sha256 2f0ade65...), walls stand-ins copied into dist/walls, serve-csp 5820;
  probe over all 17 cases of E1 (runner U:/Temp/gsfpv-train3/editfix/run-after.sh, list cases-after.txt, log
  runs-after.log, evidence evidence/2026-11-16/editfix-after/, summary sum-after.cjs): table 'After E2' below.
- [x] E2.3 a6-reference: 1 passed. Live check edit-mouse-wroclaw added to deploy/live-checks.sh (ef2fa18a), NOT run.
- [~] E2.4 Courses and Keys of the top bar had no visible effect when the window was already open and the part already on
  screen (17 of 17 cases, d.controls). Made (commit of this line): new apps/fly/src/course/editor/flash.ts flashPart()
  (class ce-shown, SHOWN_MS 1200 = an estimate, a second press starts it again), panel.ts reveal() lights the key table
  or the course list, editor.css draws a green outline and a fading background (no animation under reduced motion); the
  probe's SNAP has 'shown' and SIG counts it. editfix-e2.test.ts 8 passed, NEG OK (the 2 new tests fail on HEAD 47b9a030
  files); tsc apps/fly exit 0. Release build of e1c78781 (exit 0, sha256 ed87ef4e...), walls stand-ins in dist/walls,
  serve-csp 5820: the probe over all 17 cases of E1's table: 17 of 17 pass every step (open, a, b, c, d, e), mode edit,
  pointer lock null at open (U:/Temp/gsfpv-train3/editfix/runs-after.log from '=== e24', evidence editfix-after/).
- [x] E2.5 on the release of e1c78781: editor3-smoke.ts SCENES=70b50d42,887f27aa exit 0 (Tunis: course, 34 gates in
  3697 ms; log U:/Temp/gsfpv-train3/editfix/smoke.log); accept-fly B6 B7 B9 B10 B11 B12 B13 B14 B15 B16 all PASS, exit 0,
  first line 'accept-fly target: http://localhost:5820' (accept-fly.log); gates.py without --only: all 8 PASS, exit 0
  (logs U:/Temp/gsfpv-gates-20261116-125108); tsc apps/fly exit 0; a6-reference passed in E2.3 (no flight, input or
  collision file changed since).
- [x] E2.6 measured: a keyboard pilot's motors do NOT stop by themselves after Shift+B in the air. fly-1536.json 'final'
  (after the whole path and Exit): hud armed true, throttle 22 %, altitude -0.002 m. game.ts 450 'resting' needs Shift
  held (keys.lift < 0). The comment in fly-mode.ts that said otherwise is corrected. Not fixed (see Left after E2).

- [x] E3 verify (independent, not finished): release of 5c545efa, own walk script, runs lap1536, lap1097ru, touch1536;
  all 8 gates PASS. Findings 1 (keyboard test flight after Shift+B in the air) and 3 (second Exit tap on touch) PROVEN,
  NOT repaired (reply budget); finding 2 pre-existing. Left: repair 1 and 3 with tests, NEG, a new browser pass.

- [x] E4.1 (stage E4-rest, item 1, code part; commit of this line) devices/keyboard.ts stopKeyboardArm() (window event
  KB_ARM_STOP; the active keyboard game pilot calls arm.stop(), drops a held Space; a passive keyboard, i.e. a pad or radio
  flies, is left alone), course.ts openEdit calls it when os.respawn (opened armed). Test tools/bench/test/editfix-e4.test.ts
  3 passed; NEG: keyboard.ts and course.ts of HEAD efd17add in place: 3 failed by assertion (exit 1); editor3-i2-space 3
  passed; a6-reference + editfix-e2: 9 passed (hash unchanged); tsc apps/fly exit 0. NOT walked in a browser yet.
- [~] E4.1b the line when a flight key is pressed in the edit view: after E4.1 a keyboard pilot has no hold left (Space
  arms and flies at once, W A S D E Q move the view), and a pad pilot keeps the E2 line 'Arm your controller to fly the
  course at once'. Reasoned from the code, NOT measured in a browser; no new words added.
- [x] E4.3b gates.py --only vitest,architecture,i18n,b18 on 115d0a21: architecture, i18n, b18 PASS; vitest 1 fail of mine
  (editor3-flying.test.ts matched the old block call; its regex now takes the new second argument, 13 passed, commit of this
  line) and 4 files failed only because this run's shell has no 'python' on PATH (rooms-open-vote, rooms-race,
  rooms-socket, scene-default): with Python 3.11 on PATH 4 files, 26 tests passed. Logs U:/Temp/gsfpv-gates-20261117-011121.
- [x] E4.2 finding 3 (commit of this line). Measured on the release of ebe6442e (walk.mjs copy verify/walk2.mjs logs the Exit
  box per event; U:/Temp/gsfpv-train3/editfix/verify2/touch1536.json step exitlog): tap 2 at x 793: pointerdown on Exit,
  Exit at x 771-815, line 340 px; at pointerup the held line was cleared (line 420 px) and Exit was at 730-775; the click
  (hit-tested after pointerup) went to SPAN.ce-tb-line. Repair: editor.css .ce-tb-line flex 0 1 420px (a fixed basis, the
  text no longer sets the bar's width). Test editfix-e4.test.ts 6 passed; NEG: editor.css of ebe6442e: 1 failed by
  assertion. touch1536 walk after the repair: see E4.6.
- [x] E4.3 finding 2 (commit of this line): app/keys.ts block(blocked, refused?) tells a block the routed action of a key it
  swallowed (not Esc, a repeat, a key a screen took, text); course.ts openEdit's block says 'course.edit.keyOff' (en es pl
  ru: '<key> works in flight, not in the editor: press Esc to leave the editor, then <key>.', the key by event.code, so any
  layout). Keys covered (keymap read once, packages/prefs/src/keymap.ts, every shipped routed binding with a handler on the
  page): P (pause), Y, Enter, N, Shift+N, Shift+F, V, C, H, [ ], F9, F3, O, B, L, 9, 0, K, F, J, Shift+T, Shift+G when
  routed, Backslash and the Fly by Sound letters on its pages. Keys the editor takes itself (Esc, M R T as its tools, Shift+G,
  Ctrl+Z, Tab, F6: its capture listener stops them) never reach the router, so they keep the editor's own words. W A S D E
  Q Space are flying keys (not routed): the view or the test flight. Test editfix-e4.test.ts 5 passed (+ app-keys 22);
  NEG: keys.ts, course.ts, en.json of HEAD 6e2d507d: the 2 new tests fail by assertion; tsc apps/fly exit 0. NOT walked.
- [x] E4.4 not a fault: lap1536 on the release of faa8b553 (walk2.mjs step flash-courses): '.course-editor' roots 1 at 0, 100, 300,
  600, 1000, 1500 ms after the click; '.ce-shown' 2 at 0-100 ms, 1 to 1000 ms, 0 at 1500 ms; the window open. Keys the same (1 root).
- [x] E4.5 pictures looked at (8): editfix-after-lap-1097 (bar at the left under the credit, START gate selected, no line on the
  bar: at max-height 500 px the line is hidden by design, so refusal words are not seen there); editfix-after-touch-1536 and
  -pl-1536 (bar, long open line cut with an ellipsis, START gate with handles); verify-lap1097ru-05-add (the new gate selected
  in view); verify-lap1536-07-back and -10-pause (the view sits inside a yellow gate that fills the left half; P showed
  nothing then, now a line); verify-touch1536-06-exit (the edit view still open after tap 2: finding 3, repaired);
  verify-lap1097ru-02-open (opened in the air, no gate in the view, the start gate's arrow at the bottom left edge).
  Finding (listed, not repaired): at 1536x730 x1.25 the top bar (bottom about 46 CSS px) covers about 6 CSS px of the top
  edge of the sound, full screen and Share buttons (top row starts about 40 px); they stay clickable below that.
- [x] E4.6 release of 27151009 (exit 0, sha256 2fabfbc9...), walls in dist/walls, serve-csp 5822. walk2.mjs (walk.mjs plus an
  event log of the Exit box and the Courses flash count): touch1536, lap1536, lap1097ru all exit 0, page errors 0: touch Exit
  tap 2 leaves (tap 1 the unsaved line, tap 2 open false; Exit at x 730-775, line 420 px at pointerdown, pointerup and click);
  lap1536 testfly 1 Space press to the test flight after Shift+B in the air (before: never), P and Shift+T say their line;
  every control has an effect. Chain (U:/Temp/gsfpv-train3/editfix/verify2/chain.log, evidence/2026-11-17/editfix-final):
  probe base-1920 exit 0 70s; probe fly-1536 exit 0 84s; probe fly-ru-1536 exit 0 79s; probe fly-tap-1536 exit 0 79s; probe nofly-lock-1920 exit 0 55s; probe nofly-nolock-1920 exit 0 75s; probe lap-1536 exit 0 72s; probe lap-1280 exit 0 75s; probe lap-1097 exit 0 82s; probe lap-1366 exit 0 74s; probe touch-1536 exit 0 72s; probe ru-1536 exit 0 75s; probe pl-1536 exit 0 76s; probe early-building-1536 exit 0 80s; probe early-controls-1536 exit 0 76s; probe weak-1536 exit 0 78s. a6-reference + editfix-e2 + editfix-e4: 15 passed; tsc apps/fly exit 0; origin/main has no commit the branch lacks. Chain end (chain.log): weak-1280 exit 0 89s; onespace-1536 exit 0 89s; smoke 70b50d42 exit 0; smoke 887f27aa exit 0; accept-fly B6 B7 B9-B16 all PASS exit 0, first line http://localhost:5822; no tracked file rewritten; server stopped. Evidence evidence/2026-11-17/editfix-final (18 json).
- [x] E4.7 parts Verify 2, What the owner does, For the lead written; origin/main merged (134357ee, notes only).
- [x] E4.8 gates.py without --only on a03efdb5: run 1 vitest 1 fail, tools/bench/test/app-dji-rc2.test.ts 'answers 60 ms late' (17 frames, wants more than 20 in 1 s of real time; file and packages/input equal to origin/main; alone it failed 1 of 3 runs: a real-timer flake of the rc2 lane, not repaired here); run 2 all 8 PASS, exit 0 (logs U:/Temp/gsfpv-gates-20261117-085924). The commit of this line changes only this file.

## Left after E4-rest run 2 (done in run 3: items 1-3) (exact list; this run's budget spent)

1. Read U:/Temp/gsfpv-train3/editfix/verify2/chain.log: every probe case, the two smoke runs and accept-fly must say exit 0
   (accept-fly.log first line names http://localhost:5822); restore tracked evidence files accept-fly rewrote
   (git status, git checkout); commit evidence/2026-11-17/editfix-final. Stop the server on 5822 (serve-csp) when done.
2. git fetch; merge origin/main if it moved; gates.py without --only (Python 3.11 on PATH) on the final head, exit 0.
3. Write parts 'Verify 2', 'What the owner does' (add: one Space test-flies after Shift+B, a short Space back; P, Shift+T and
   the other flight keys say a line), 'For the lead' (files since efd17add: course.ts, keys.ts, devices/keyboard.ts,
   editor.css, locales course en es pl ru, edit-mouse-probe.mjs, tests editfix-e4 and editor3-flying, live-checks.sh;
   page only, no server change).

## Left after E4 (run 1)

1. E4.2 touch Exit: measure the Exit box at pointerup and at click in a touch tap (walk.mjs touch1536), then the repair
   (top-bar.ts 64 clears the held line on pointerup: a fixed width for the line, or clear on click), touch1536 again.
2. E4.4 Courses flash: count '.course-editor' roots and '.ce-shown' right after the Courses click; PROVEN or not a fault.
3. E4.5 look at up to 10 pictures of 1536x730, 1097x497 and touch (shots editfix-after-*, verify-*), one sentence each.
4. E4.6 the whole browser pass on a fresh release of the final head (list in Status E4.6), the gates in full (put Python
   3.11 on PATH: C:/Users/andri/AppData/Local/Programs/Python/Python311), deploy/live-checks.sh edit-mouse-wroclaw:
   extend it with 'one Space after Shift+B in the air flies' (read-only), parts 'Verify 2', 'What the owner does',
   'For the lead'. Before the final gates: git fetch and merge origin/main if it moved.
5. Not walked in a browser: E4.1 (one Space test-flies after Shift+B in the air) and E4.3 (the line for P, Shift+T).

## Left after E2

- After Shift+B in the air the drone waits at the start with motors on (ARMED in the corner). The mode stays 'edit'
  (hold), so editing works; to fly again a keyboard pilot needs Space twice (disarm, arm) by the hold rule. Smallest
  fix, not made (flight code, needs a6-reference): in course.ts openEdit, when os.respawn, also stop the arm (game-pilot
  arm.stop) so one Space flies again. Guess, not measured: whether Space while armed disarms for the keyboard pilot.

## Verify (E3, independent check of 5c545efa)

Own script U:/Temp/gsfpv-train3/editfix/verify/walk.mjs (not the lane's probe; not committed), release build of 5c545efa
(exit 0, sha256 1414b42c...), walls stand-ins in dist/walls, serve-csp 5821, Wroclaw 70b50d42. Results per run in
verify/<name>.json, pictures U:/Temp/gsfpv-train3/shots/verify-<name>-NN-<step>.png.

Run lap1536 (1536x730 x1.25, en, mouse, pointer lock taken by a click, take-off to 8.0 m, Shift+G 23 gates, Shift+B):
- open: mode edit, lock null, the whole top bar shown; picture 02-open looked at: bar, ARMED in the corner, the start
  gate's handles at the bottom left edge, no gate in the middle of the view (framing: DOUBT, not judged a fault).
- view: W 3.96 m, right drag from the middle 0.43 and no change made; add: 23 -> 24, the new gate in view.
- select: no other gate on screen at the open; the script did not walk back (fixed in walk.mjs for the later runs).
- Shift+G in the view: 'The changes are not saved. Do it again to drop them' (words). Esc order: Esc 1 the unsaved line,
  Esc 2 leaves. Exit by a click: one press leaves, override false, not paused. After Exit: a click takes the lock back
  (CANVAS#view), Space + W fly (altitude -0.002 -> 6.5 m). Backslash (Fly by Sound here) after the view: the sound hook
  is on, not paused.
- Controls clicked once: drawer, Add, Undo, Redo, Save, Keys show an effect or words; Courses showed no change in the
  script's signature (no '.ce-shown' counted at 900 ms): DOUBT (the lane's probe counted it 17 of 17; the next runs count
  the '.course-editor' roots to rule out a stale root).
- Pages errors: none.

Findings
1. PROVEN (fix's path, keyboard pilot): after Shift+B in the air the drone stays armed at the start with the hold set
   (fly-mode.ts openStep, course.ts openEdit 909-912), and in the game scheme Space never disarms in the edit view
   (devices/keyboard.ts onDownGame: Space only requests the arm; the tap that disarms, onUp 228-232, needs
   editModeFlying()). Measured, run lap1536 step testfly: 3 Space taps of 90 ms, mode stays 'edit', armed true; then
   Space held 1 s and W 0.4 s fly the drone UNSEEN under the edit view (altitude 0.55 -> 5.6 m, speed 2.3 m/s, mode edit).
   Picture 06-testfly looked at: the edit view, ARMED, the line 'Arm your controller to fly the course at once' (names no
   key for the keyboard). So a keyboard pilot cannot test-fly inside the mode after opening it in the air, and the open
   line's promise 'Space ... flies the course' is a key that does nothing. Not repaired (no reply budget left for a
   fix in flight/input code, a6-reference, a test with negative control and a new browser pass). Smallest fix proposed:
   in openEdit, when the drone is armed, stop the arm of the keyboard's game pilot (game-pilot arm.stop, the same call as
   keyboard.ts 232) so the hold clears on the next frame and one Space flies; a pad keeps the hold (switch off and on).
   Also pre-existing for the crash hold (ED-3 says 'Space twice' for a keyboard pilot: measured here, Space does not
   disarm at all in the game scheme).
2. PROVEN, pre-existing (not from this fix): P (pause) and Shift+T in the edit view do nothing and say nothing (P: paused
   false, no window, line unchanged; Shift+T: course on, mode edit, line unchanged). course.ts openEdit ctx.keys.block
   blocks the app's keys while the view is open. Owner's rule 'no key that does nothing'. Not repaired.
3. PROVEN by measurement, cause a guess (touch, fix's path): run touch1536 (hasTouch, every press a touchscreen tap):
   Exit tap 1 'The changes are not saved. Esc again leaves without saving'; Exit tap 2: the view stays open (open true,
   override true), the line back to 'Click a gate to change it...'. Run lap1097ru with the mouse: the second press leaves.
   The lane's touch case used mouse clicks, not touch events, so it could not see this. Guess, not measured: top-bar.ts 64
   now clears the held line on pointerup; for a tap Chrome hit-tests the click after pointerup, the line's new width has
   moved the centred buttons, the click lands beside Exit (E1 cause 2 again, for touch only). Not repaired.

Run lap1097ru (1097x497 x1.75, Cyrillic event.key, event.code KeyW...): flight 7.9 m, 34 gates, open mode edit, lock
null, W 4.15 m, right drag 0.43 no change, a click selects gate 24 at 240,460, add 34 -> 35 in view, Exit 2 clicks (the
unsaved line, then it leaves), after Exit a click takes the lock, Space + W fly. All pass.
Run touch1536: open edit, W 4.15 m, right drag 0.38, select no other gate on screen after 5 S presses, add 21 -> 22 in
view (taps), Exit see finding 3.
Negative control of tools/bench/test/editfix-e2.test.ts: neg_control.py with origin/main for course.ts, fly-mode.ts,
editor.css, top-bar.ts, panel.ts, view-mouse.ts: NEG OK (exit 1). flash.ts has no old version (new file).
gates.py without --only on 5c545efa code (only this status file changed after): all 8 PASS (typecheck 35 s, vitest 123 s,
api-unittest 228 s, architecture, i18n, catalog, b18, leaks), logs U:\Temp\gsfpv-gates-20261116-132518.
Not verified: the pause shown over the edit view (P is blocked there, so it could not be opened), a test flight inside
the mode with a pad, a real touch screen, the owner's laptop. Pictures looked at: lap1536 02-open and 06-testfly only.

## Verify 2 (stage E4-rest, release of 27151009, Wroclaw 70b50d42 with the local walls, port 5822)

- Finding 1 repaired: after Shift+B in the air, one Space press starts the test flight (walk lap1536 step testfly: before
  never, after 1 press; probe case onespace-1536 exit 0). The keyboard's motors stop when the edit view opens in the air
  (before: fly-1536 final armed true, throttle 22 %). A pad keeps its hold and the line 'Arm your controller'.
  a6-reference hash unchanged.
- Finding 3 repaired: touch tap 2 on Exit leaves the editor (before: the click landed on SPAN.ce-tb-line because the line
  shrank from 340 to 420 px wide between pointerdown and pointerup and Exit moved from x 771-815 to 730-775; after: line 420
  px at pointerdown, pointerup and click, Exit at x 730-775 all three times, open false after tap 2).
- Finding 2 repaired: P, Shift+T and every other routed flight key pressed in the edit view say one line '<key> works in
  flight, not in the editor: press Esc to leave the editor, then <key>.' (en es pl ru). Keys listed in Status E4.3.
- Courses flash: not a fault (1 '.course-editor' root at 0-1500 ms after the click).
- Pass: walks touch1536, lap1536, lap1097ru exit 0, page errors 0; probe over 18 cases exit 0; editor3-smoke Wroclaw and
  Tunis exit 0; accept-fly B6 B7 B9-B16 PASS; a6-reference, editfix-e2, editfix-e4 15 passed; tsc apps/fly exit 0.
- Found, not repaired: at 1536x730 x1.25 the top bar covers about 6 CSS px of the top of the sound, full screen and Share
  buttons (they stay clickable below). At max-height 500 px (1097x497) the bar's line is hidden by design, so the refusal
  line for P etc. is not seen there.
- Not verified: the owner's laptop, a real touch screen, a real pad in the edit view; the live check was not run.

## Review (release check 1, 2026-11-17, on b43c2a48 then 2bfd9914)

- origin/main had no commit the branch lacked: no merge. Diff read: course.ts, app/keys.ts, keyboard.ts, editor.css, the
  four locales, live-checks.sh (ONESPACE=1 adds only Space presses; nothing saved or sent).
- Own walk (U:/Temp/gsfpv-train3/reviews/editfix/walk.mjs, release build, Wroclaw 70b50d42, local walls, port 5831,
  1536x730 x1.25, lock by a click first, Shift+B in the air at about 7.8 m): lap1536 and touch1536 exit 0, page errors 0.
  Held W 1 s, Up 0.8 s, Left 0.5 s in the edit view: mode edit, armed false, the drone at the same place each time (the
  arrows moved the selected gate). P: line 'P works in flight ...', no pause. One Space: test flight (1 press), a short
  Space back. Esc twice with changes leaves; touch: Exit tap 2 leaves. Courses and Keys light their part (ce-shown for
  about 1.2 s, sampled every 100 ms, render off). Pictures looked at: lap1536 keyP, testfly; touch1536 holds.
- Finding (PROVEN, repaired in 2bfd9914): Shift+B in the edit view said 'Shift+B works in flight, not in the editor: press
  Esc to leave the editor, then Shift+B.', which sends the pilot out and back into the same editor. Now Shift+B repeats
  the editor's own line (course/editor/keys.ts keyOffLine, course.ts block refusal). Test editfix-e4 'review 1': NEG OK on
  b43c2a48. Re-walked on the release of 2bfd9914: Shift+B line = the editor line; lap1536b exit 0, errors 0.
- Pre-existing, not changed (also live): the first Exit tap with changes says 'Esc again leaves without saving' to a touch
  pilot (course.edit.unsaved); the second tap leaves. A refusal line said in the edit view can still show for a few
  seconds after the test flight starts (seen in the testfly picture).
- NEG of the lane's own tests: editfix-e4 'E4' with keyboard.ts and app/keys.ts of origin/main: 3 failed (NEG OK).
- Ran: tsc apps/fly exit 0; editfix-e4 + editfix-e2 + a6-reference 16 passed (a6 hash held); accept-fly B6 B7 B9-B16 all
  PASS, exit 0, target http://localhost:5831; gates.py on 247629bd: all 8 PASS, exit 0 (typecheck 36 s, vitest 120 s,
  api-unittest 246 s; logs U:/Temp/gsfpv-gates-20261117-094649), run again on the commit of this line.
- Not verified: the owner's laptop, a real phone or touch screen, a real pad, and a person took no part; the live check
  edit-mouse-wroclaw was not run against the live site.

## What the owner does

1. Opens a scan (Wroclaw), clicks into the scene, flies with Space and W.
2. Presses Shift+B (any layout), also in the air: the drone goes back to the start and its motors stop, the cursor is
   free, the bar at the top shows Add gate, Undo, Redo, Save, Courses, Keys, Exit.
3. W A S D move the view (E up, Q down), the right mouse button held turns it, the wheel changes the speed.
4. A click on a gate selects it (its handles and the tool bar under it show).
5. Add gate, then a click in the scene: a new gate stands there.
6. Courses or Keys: the window shows that part with a green outline for a moment.
7. Space once: the test flight of the course starts. A short Space press in the test flight goes back to editing.
8. P, Shift+T or another flight key in the edit view: the line at the top says that key works in flight and to press Esc
   first.
9. Exit (a click, or a tap on a touch screen; the first tap with unsaved changes shows a line, the second leaves) or Esc:
   back to flying.

## Not verified

The owner's laptop was not used. A real touch screen, a real 144 Hz panel and a real Windows display scale were only
emulated in headless Chrome. The live check edit-mouse-wroclaw was not run against the live site (by the task).

## For the lead

Deploy order (review 1): the page only. nginx: no. API files (apps/api): no. Rooms service: no. Sound package
(packages/sonic-fpv pin): no. Page files since origin/main: apps/fly/src/app/builtin/course.ts, apps/fly/src/app/keys.ts,
apps/fly/src/devices/keyboard.ts, apps/fly/src/course/editor/{editor.css, keys.ts}, packages/i18n/locales/fly/course/
{en,es,pl,ru}.json; plus deploy/live-checks.sh (the check script, not a server config) and tests/probe.

Since efd17add (stage E4-rest): apps/fly/src/app/builtin/course.ts, apps/fly/src/app/keys.ts,
apps/fly/src/devices/keyboard.ts, apps/fly/src/course/editor/editor.css, packages/i18n/locales/fly/course/{en,es,pl,ru}.json,
tools/bench/scripts/edit-mouse-probe.mjs, tools/bench/test/editfix-e4.test.ts (new), tools/bench/test/editor3-flying.test.ts,
deploy/live-checks.sh (edit-mouse-wroclaw also judges one Space after Shift+B in the air; read-only), this file, evidence
2026-11-17/editfix-final. Page only: no server, API or sim-core change. keyboard.ts is input code: a6-reference unchanged.

Earlier (E1-E2):
Files changed on branch editfix (page only, plus the probe, a test and the live check): apps/fly/src/app/builtin/course.ts,
apps/fly/src/course/editor/{fly-mode.ts, top-bar.ts, view-mouse.ts, editor.css, panel.ts, flash.ts (new)},
locales of the flying line (en es pl ru), tools/bench/scripts/edit-mouse-probe.mjs, tools/bench/test/editfix-e2.test.ts, tools/bench/test/editor3-i2.test.ts,
deploy/live-checks.sh (check edit-mouse-wroclaw: the probe presses nothing that saves, sends or creates; Save is skipped
when LIVE, window controls matching save/vote/send/report/admin/publish/create are skipped). No server or API change.
Pictures looked at in pass 2: editfix-after-lap-1536.png (a person sees the bar, the selected START gate with its
handles and tool bar, DISARMED in the corner), editfix-after-base-1920.png (the bar and the line 'Editor open...' over
the cathedral, ARMED in the corner, no gate in that view). The other 15 pictures of the after run were not looked at.

## After E2 (Wroclaw 70b50d42, local release of ad2d4e2e, 17 cases)

Every case: open in mode 'edit' (pointer lock null at open), a keys W..Q 3.96-4.34 m each, right drag in the middle
0.40-0.43 (was 0 where the handles stood there), right drag on an empty place 0.38-0.42, wheel 4 -> 5.4; b a click
selects a gate; c Add gate then a click puts a gate in view; e Exit leaves (second press after 'not saved' now lands).
d fails in 17 of 17 only by Courses and Keys (E2.4). The flown cases base-1920, fly-1536, fly-ru-1536, fly-tap-1536,
which failed every step before, now pass a, b, c, e.
- Picture U:/Temp/gsfpv-train3/shots/editfix-after-fly-1536.png, looked at: after a flight and Shift+B a person sees the
  whole top bar (Add gate, Undo, Redo, Save, Courses, Keys, Exit and the line 'Editor open. W A S D move the view...'),
  the gate's tool bar and the start gate with its handles; the corner still says ARMED (the drone was put back on the
  start, its motors are still on). Pictures of the other 16 cases are in the same folder, not looked at.
- Not measured: whether a keyboard pilot's motors stop by themselves at the start after the open (game-pilot.ts landed)
  so that one Space press flies again; the probe's fly-tap case tapped Space before the open, not after.

## The cause (measured)

Case base-1920 (the owner's path: Controls by a click, a click into the scene took the pointer lock CANVAS#view, Space
held 1.5 s and W: hud armed true, altitude 7.9 m, throttle 29 %; Shift+G, 39 gates; Shift+B): the edit view opens in
mode 'fly' within one frame (open.mode fly, flying true, handles false, override false). What the page shows
(U:/Temp/gsfpv-train3/shots/editfix-before-base-1920.png, looked at: the drone's own view, ARMED in the corner, and at the
top only the line 'Flying your course with the changes. Disarm to edit again', no buttons) is exactly the owner's
'the menu bar hangs at the top and that is all'. Every step then fails: W S D A E Q move the edit camera 0 m, the
right drag 0, the wheel speed 4 -> 4, three clicks on gates in view (gates 1, 2, 3 at 1506,853 ...) select nothing (the
click reaches CANVAS#view, the window sees pointerdown and click, the view is suspended), Add, Undo, Redo, Save,
Courses, Keys, Exit are not on screen.
- Why: apps/fly/src/app/builtin/course.ts openEdit (878-969) sets mode 'edit' and crashHold false (line 909); the first
  editFrame (1056) calls modeStep(mode, sim.armed, ...) (course/editor/fly-mode.ts modeStep): armed and no hold gives
  'to-fly', so the view is suspended (view-mouse.ts suspend: handles off, keys and mouse to the flight), the window is
  hidden, and the top bar gets class 'flying'; course/editor/editor.css 166-167 '.ce-topbar.flying .ce-tb {display:none}'
  and '.ce-topbar.flying {pointer-events:none}'. The only way back is a Space tap shorter than 200 ms
  (devices/keyboard.ts EDIT_TAP_MS, an estimate there) or a pad's arm switch; the line says 'Disarm', which names no key
  for a keyboard pilot in the game scheme, where Space is 'up'. Esc still works (the owner: 'Escape works').
- Since: 50777ee8 (2026-11-14, editor3 E3: flying with the controller inside the mode), in release b2e7a73b and live.
- The pointer lock is NOT the cause: after the click into the scene the lock was held (CANVAS#view) and was let go by the
  time the view opened (open.lock null in every case; play.ts frame tick, mouse-look.ts sync with '.course-editor').
  Headless Chrome granted the lock, so candidate 1 is measured, not assumed.

## Case x step (Wroclaw 70b50d42, local release; numbers in evidence/2026-11-16/editfix/<case>.json)

| case | open mode | a view (keys / right drag / wheel) | b select | c add | d top bar | e exit |
|---|---|---|---|---|---|---|
| base-1920 (flown, lock) | fly | FAIL 0 m / 0 / 4->4 | FAIL 0 of 3 | FAIL no button | FAIL none on screen | FAIL no button |
| nofly-lock-1920 | edit | keys 2.8 m each / probe artefact / 4->5.4 | ok gate 1 | probe click hit the gate bar (path) | undo redo save ok; courses keys no change seen | FAIL see cause 2 |
| nofly-nolock-1920 | edit | keys 2.8-2.93 m / artefact / 4->5.4 | no 2nd gate in view (1 on screen) | as above | as above | FAIL see cause 2 |
| lap-1536 at 1.25 | edit | keys 2.67-2.93 m / artefact / 4->5.4 | ok gate 1 | ok 32->33, new gate in view at 782,412 | as above | ok one press |
| lap-1280 at 1.5 | - | - | - | - | - | no course in 480 s ('no course') |
| lap-1097 at 1.75 | - | - | - | - | - | no course in 480 s ('no course') |

Pass 2 (probe with rightDrag at the middle = over the selected gate's handles, rightDragEmpty at 0.2W,0.62H; COURSE_MS):

| case | open mode | keys (m) | right drag middle / empty | wheel | b select | c add | e exit |
|---|---|---|---|---|---|---|---|
| fly-1536 x1.25 (flown, lock) | fly | 0 all | 0 / - | 4->4 | FAIL 0 of 15 | FAIL no button | FAIL no button |
| fly-ru-1536 (ru layout, flown) | fly | 0 all | 0 / - | 4->4 | FAIL 0 of 26 | FAIL | FAIL |
| fly-tap-1536 (flown, then Space 90 ms) | fly -> edit in 262 ms | 3.96-4.53 | 0.4 / - | 4->5.4 | ok | ok 35->36 in view | ok |
| live-fly-1536 (LIVE 7af2aad5, read-only) | fly | 0 all | 0 / 0 | 4->4 | FAIL 0 of 18 | FAIL | FAIL |
| live-nofly-1536 (LIVE) | edit | 3.96-4.53 | 0, gate moved / 0.4 | 4->5.4 | 1 gate on screen | ok | ok |
| touch-1536 (hasTouch) | edit | 3.96-4.15 | 0 / - | 4->5.4 | ok | ok 33->34 | ok |
| ru-1536, pl-1536 | edit | 3.96-4.34 | 0, gate moved / 0.4 | 4->5.4 | ok (pl: 1 on screen) | ok | ok |
| early-building, early-controls | edit | 3.96-4.34 | 0 / - | 4->5.4 | ok | ok | ok |
| weak-1536 (desktop-weak, scale 0.7) | edit | 3.96-4.15 | 0.4 / 0.38 | 4->5.4 | ok | ok | ok |
| lap-1366 x1 | edit | 3.96 | 0 / 0.4 | 4->5.4 | ok | ok | ok |
| lap-1280 x1.5, lap-1097 x1.75 | edit | 3.96-4.53 | 0.4 / 0.38 | 4->5.4 | ok | ok | ok |

- Candidates: 1 lock: no (lock let go before the view opens in every case). 2 laptop sizes and scales: no (all pass once the
  Controls screen is scrolled; the earlier 'no course' at 625/595/497 px was the probe clicking Keyboard at y 687, below the
  view: the screen scrolls by the wheel, Keyboard comes to y 451/421/387). 3 touch screen: no. 4 layout ru/pl: no (keys go
  by event.code; ru and pl move the view like en). 5 early Shift+B: no. 6 weak class and scale 0.7 with dsf 1.25: no
  (picking works). 7 live: cause 1 reproduces on live exactly (mode fly, top bar class 'flying', every step 0). The right
  drag over the handles (cause 3) reproduces where the selected gate stands mid-screen (lap-1366, ru, pl, touch, live);
  where it does not, the middle is empty and the drag turns the view.
- d (top bar Courses, Keys): no change of state because the window is already open (Save opened it) and reveal only
  scrolls (panel.ts 161-166); not a fault. Window rows: the key rows are buttons that run their key (effect seen for
  Up..Esc); rows 0-2 (title, Tab, Shift+Tab) were clicked where elementFromPoint gave the panel's SECTION or null: probe
  artefact (clipped rows, no scrollIntoView), not judged.

'artefact': the first probe version measured the right drag by cam.yaw, which the hook does not have (fixed now: the eye
and the point looked at, edHook.view); left drag on an empty place is not a way the mode offers (not judged).

## Cause 2 (measured, minor): the second Exit press is lost

nofly-lock-1920 and nofly-nolock-1920: Exit press 1 says 'The changes are not saved. Esc again leaves without saving';
press 2 at the same point: pointerdown on BUTTON[top=exit], click on DIV.ce-topbar (the button moved between down and
up). Guess, not measured: TopBar.onAct (top-bar.ts 25, capture pointerdown) clears the held line at once
(line-hold.ts), the line's text changes width and the centred bar shifts its buttons under the pointer.

## Cause 3 (measured): a right drag that starts on the selected gate's handles moves the gate

live-nofly-1536: rightDrag from 768,365 (CANVAS#view under the point): view moved 0, changed false -> true, the line
'Moved. Gate 1 of 38'. The same drag at 307,453 turns the view 0.4. Why: view-mouse.ts onOwnPress (520-522) leaves every
press that is not button 0 to the gizmos, and the PlayCanvas 2.23.2 Gizmo has mouseButtons [true, true, true] by default
(build/playcanvas.mjs 121063, checked at 121171); the app never sets it (no 'mouseButtons' in apps/fly/src), so the
TranslateGizmo (view-mouse.ts 113-115) starts a move on the right button and onPointerMove (572) returns while dragging.
The view opens framed on the selected gate, so its handles stand mid-screen exactly where a person starts to look around:
'I cannot move around the scene'. Since bc341bb7 (2026-11-14, editor3 E2.2/E2.3, the right-button look).

## What E2 should change (smallest per cause)

1. Shift+B in the air opens the edit view, not the flight: in openEdit start with the crash hold set when the drone is
   armed (crashHold = sim.armed), so modeStep stays 'edit' until a fresh arm; the drone is put back to the start or held
   (respawnStart, as the crash path does) so it does not fall while he edits. The line in flying mode names the key that
   comes back (Space tap for the keyboard, the arm switch for a pad) and the top bar keeps Exit clickable while flying
   (editor.css 166-167).
2. The top bar does not move under the pointer: fixed width for the line (or the line not centred with the buttons), or
   the line cleared on pointerup/click instead of pointerdown.
3. The handles take only the left button: mouseButtons = [true, false, false] on the three gizmos (view-mouse.ts 113-115),
   so a right press anywhere is the look. Test: the probe's rightDrag (middle) must turn the view and leave changed false.
4. Not a fault, a nicety: on views 625 px and lower the Controls screen's Keyboard button is below the fold (y 687); the
   screen scrolls by the wheel. Not in E2 unless asked.

## Left (for the next worker)

Pass 2 closed every item of the list below except the two lines marked 'still left'.

- Not run: lap-1366, touch-1536, ru-1536, pl-1536, early-building-1536, early-controls-1536, weak-1536, weak-1280,
  fly-1536, fly-ru-1536 (U:/Temp/gsfpv-train3/editfix/cases2.txt from line 6) and fly-tap-1536 (cases3.txt, TAP=1:
  does a short Space bring the edit view back). Start: node scripts/build-release.mjs is done in this worktree (dist/ with
  dist/walls), serve dist on 5820, then sh U:/Temp/gsfpv-train3/editfix/run.sh <list>. One case takes 50-70 s when the
  lock is free.
- lap-1280 (1.5) and lap-1097 (1.75): Shift+G gave no course in 480 s. Not known whether the scale or GPU contention
  (other lanes held the lock; runs 11:22-11:39). Run again alone before calling it a fault.
- Candidate 4 (layout): the edit keys and the view keys go by event.code (keys.ts 55-62, view-mouse.ts onKey), app keys
  by e.code (app/keys.ts 170): read, not run.
- Candidate 7 (live site, read-only 1536x730 at 1.25): not run.
- d: Courses and Keys showed no change in the first probe's signature (the window already open at 1920 and 1536); the
  signature now also reads the window's scroll and open parts; run again.
- Pictures not looked at: editfix-before-lap-1536.png, editfix-before-nofly-*.png (from the probe version with artefacts).
- gates.py (vitest, architecture, i18n, b18, leaks): pass 2 ran it, result in the Status line E1.5.
- Still left: cause 2 (second Exit press lost) is a guess about why; measure in E2 by the box of BUTTON[top=exit] at
  pointerdown and at click.
- Still left: pictures of pass 2 not looked at (editfix-before-fly-1536.png and the others of 11:44-12:12); the flown
  case picture base-1920 was looked at in pass 1 and shows the symptom.
- Not verified: a real touch screen, a real 144 Hz panel, a real Windows display scale (all emulated in headless Chrome).

## Cost notes

- E3 verify (30 replies): the most went to finding the hooks and keys for my own walk script and to waits on runs;
  cheaper: give the verifier a short hook sheet (editor state, hud, pause, sonic) and let it fix findings in a second stage.

- E2 pass 2 (about 25 replies): the 17-case probe and the heavy checks (smoke, accept-fly) ran in the background
  while the gates ran, which saved most of the waiting; the most turns went to waits on those runs; cheaper: one script
  that runs build, cases, smoke and accept-fly in a row with one log, started right after the fix commit.

- E2 part 1 (about 40 replies): the 17-case probe run (20 min) and reading code around three causes took most; cheaper:
  start the build and the probe run right after the first fix commit (done so) and give Courses/Keys and the heavy
  checks (smoke, accept-fly, all gates) to a second worker from the start.

- E1: most replies went to waiting for the GPU lock behind other lanes and two 8-minute cases that made no course;
  cheaper: run the laptop sizes one at a time first, with a short course timeout (120 s), and the owner's flown case
  first, which alone reproduced every symptom.
- E1 pass 2: about 35 replies; most went to reading results case by case and to a probe fault (Keyboard below the fold
  read as 'no course'); cheaper: a summary script written at the start (sum.cjs) and every click scrolled into view first.
