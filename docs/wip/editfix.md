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
- [ ] E1.4 left: the cases not run or not finished (see Left).

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

'artefact': the first probe version measured the right drag by cam.yaw, which the hook does not have (fixed now: the eye
and the point looked at, edHook.view); left drag on an empty place is not a way the mode offers (not judged).

## Cause 2 (measured, minor): the second Exit press is lost

nofly-lock-1920 and nofly-nolock-1920: Exit press 1 says 'The changes are not saved. Esc again leaves without saving';
press 2 at the same point: pointerdown on BUTTON[top=exit], click on DIV.ce-topbar (the button moved between down and
up). Guess, not measured: TopBar.onAct (top-bar.ts 25, capture pointerdown) clears the held line at once
(line-hold.ts), the line's text changes width and the centred bar shifts its buttons under the pointer.

## What E2 should change (smallest per cause)

1. Shift+B in the air opens the edit view, not the flight: in openEdit start with the crash hold set when the drone is
   armed (crashHold = sim.armed), so modeStep stays 'edit' until a fresh arm; the drone is put back to the start or held
   (respawnStart, as the crash path does) so it does not fall while he edits. The line in flying mode names the key that
   comes back (Space tap for the keyboard, the arm switch for a pad) and the top bar keeps Exit clickable while flying
   (editor.css 166-167).
2. The top bar does not move under the pointer: fixed width for the line (or the line not centred with the buttons), or
   the line cleared on pointerup/click instead of pointerdown.

## Left (for the next worker)

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
- gates.py (vitest, architecture, i18n, b18, leaks): not run (no app code changed in E1).

## Cost notes

- E1: most replies went to waiting for the GPU lock behind other lanes and two 8-minute cases that made no course;
  cheaper: run the laptop sizes one at a time first, with a short course timeout (120 s), and the owner's flown case
  first, which alone reproduced every symptom.
