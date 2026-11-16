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
- [ ] E2.2 release build; probe over all cases of E1 (fly cases must now open in mode edit); pictures editfix-after-*.
- [ ] E2.3 editor3-smoke Wroclaw and Tunis; accept-fly B6 B7 B9-B16; a6-reference; all gates; live check edit-mouse-wroclaw.

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

- E1: most replies went to waiting for the GPU lock behind other lanes and two 8-minute cases that made no course;
  cheaper: run the laptop sizes one at a time first, with a short course timeout (120 s), and the owner's flown case
  first, which alone reproduced every symptom.
- E1 pass 2: about 35 replies; most went to reading results case by case and to a probe fault (Keyboard below the fold
  read as 'no course'); cheaper: a summary script written at the start (sum.cjs) and every click scrolled into view first.
