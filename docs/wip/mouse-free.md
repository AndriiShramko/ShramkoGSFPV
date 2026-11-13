# Lane mouse-free (train 1B)

Worktree: C:/dev/gsfpv-tracks (reused from lane tracks), branch mouse-free from origin/main 41372830.

Goal: a window that needs the mouse always gets the mouse (the owner's report of 2026-11-13: the report form
opened from "My controller is not in the list" on the Controls screen left the pointer captured by the flight).

## Cause

"Send this list" closes the Controls screen first: its pause reason was the last one, so the flight asked for
the pointer lock inside that click; the report form opened in the same click, and its pause found no lock to
release yet (requestPointerLock is asynchronous), so the lock landed over the form and stayed.

## Status

Stage 1, M1-cause-and-fix:
- [x] 1. Reproduced on a local release build of origin/main, headless: tools/bench/scripts/mouse-free-probe.mjs
  (fake navigator.usb, DJI RC 2 2CA3:1021, FF.43.01 06.01.01 FF.42.01). After Send this list:
  pointerLockElement set, a click inside the form stays locked; form cursor auto, tab Bug checked, title
  Feedback, list text in the field, Send reached by 7 Tab presses. Old build: 25 checks pass, 2 fail (exactly
  those two). Key B, the pause menu's Feedback and Settings release the lock already.
- [x] 2. Fix in one place: play/mouse-look.ts MouseLook has host.held() (default cursorWindowOpen(), the
  CURSOR_WINDOWS list); a lock that lands while a window is up is let go at once without onLost; sync() for a
  window opened while locked. play.ts passes held = menu open or dialogOpen() or cursorWindowOpen(), calls
  sync() on every pause event and on the 250 ms frame tick. Fixed build: 27 of 27 probe checks pass.
- [x] 3. The form from the helper already shows the tab it is sent under (Bug), the list is in the field and
  Send is reachable by Tab (7 presses from the focused Bug tab), on origin/main and on the fix. Nothing to fix.
- [x] 4. tools/bench/test/app-mouse-free.test.ts: 5 tests pass; negative control NEG OK (all 5 fail on
  origin/main's mouse-look.ts and play.ts). Typecheck apps/fly and tools/bench exit 0.
- Commit: 7fa41712 (items 1 to 4).

Stage 2: not started (named by the train plan).

## Decisions

- The rule lives in MouseLook (the one place every lock goes through), not in each window: windows only add
  their class to CURSOR_WINDOWS if they are not a panel (ui/dom.ts) or one of the listed screens.
- No check of held() before requestPointerLock: the pause menu's Continue asks for the lock inside its click
  while the menu is still up (the menu closes in the button's own handler). The decision is made when the lock
  lands (pointerlockchange) and after the request resolves. A deferred request (setTimeout) was rejected: it
  leans on the browser keeping the gesture.
- Point 3 needed no change, so there is no unit test for it (a negative control cannot fail on origin/main);
  the probe checks it on the page (tab, field text, Tab to Send). The owner's "Opinion" is the window title in
  Polish and Spanish (fb.title "Opinia" / "Opinion"), not a tab; his report arrived as kind bug, as selected.

## For the lead before the merge

- Nothing outside the lane's paths was needed. dialogOpen() in apps/fly/src/devices/keyboard.ts (lane rc2's
  path) still has its own selector list; CURSOR_WINDOWS is a superset of it plus aria-modal dialogs, the
  settings screen and the crash view. Folding the two lists into one is a later cleanup.

## Not verified

- A headed Chrome with the real DJI RC 2 and a real mouse (the owner's PC): only headless with a fake
  navigator.usb.
- Firefox and Safari pointer lock (the probe runs Chromium).
- The pause menu's Continue taking the lock again was not a probe step (the probe closes windows with their
  x; a click on the view captures again after every entry).

## Cost notes

- Stage 1: most turns went to finding how the screens open and how a probe drives the page (no existing probe
  fakes navigator.usb). Cheaper: a probe template in the code map that starts a game-scheme flight and opens
  the Controls screen. Also: neg_control.py cannot start npx on Windows; call node node_modules/vitest/vitest.mjs
  and add --reporter=json --outputFile to see which tests failed on the old code.
