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

Stage 2, M2-probe-all-windows:
- [x] 1. tools/bench/scripts/mouse-free-probe.mjs walks 9 windows (12 after the review, see MF-R2), each from a flight
  with the capture held: helper (report form from the USB helper, fake navigator.usb), keyB, menu (Feedback),
  pause (the pause menu itself, closed with Continue), settings, radio (the Controls screen), courseKey
  (Shift+G), courseMenu (the menu's New course item), rooms (?rooms=1 page, opened by Shift+L). Per window:
  captured before, free while up, cursor over the window not 'none' (the window and the element at its
  middle), a click on a harmless control inside keeps it free, the window closes, a click on the view
  captures again. Last line JSON {pass, checks}, exit 0 only on pass. Never presses send, save or create.
- [x] 2. Local release build of 0860499a (serve-csp, port 5391), headless, GPU lock: 63 of 63 checks pass,
  exit 0. Evidence: evidence/2026-11-13/mouse-free/probe-local.json. Screenshot of the helper's form with
  the mouse over Send: U:/Temp/gsfpv-train1b/mouse-free-helper-form.png (not in git).
- [x] 3. Negative control, the live site https://gsfpv.flyreelstudio.eu/en (release 41372830, the defect):
  exit 1, 61 pass, 2 fail, exactly "helper: the mouse is free while it is up" (locked true) and "helper: a
  click inside keeps the mouse free" (locked true). Evidence: evidence/2026-11-13/mouse-free/probe-live.json.
- [x] 4. No other window failed on the branch, so no code change and no new unit test in this stage.
  Typecheck tools/bench exit 0.
- Commits: c72105be (probe), 8241bf2d (status, evidence, the probe's second-page start).

R review fixes (independent review of the lane, findings MF-R1 to MF-R6, all minor):
- [x] MF-R1 (export bar not covered): confirmed by reading (vx-bar has no .panel class, no aria-modal).
  '.vx-bar' added to CURSOR_WINDOWS; test 'the video export bar holds the mouse'. Probe entry: not added
  (an export needs a recorded life in the replays panel; see For the lead). Commit: see R-a below.
- [x] MF-R3 (hidden survey and start screen untested): test with a selector stub (the fake DOM has no
  ':not(...)'): hidden ones do not hold the mouse, shown ones do. The play.ts wiring test stays optional:
  under For the lead. Commit: R-a.
- [x] MF-R4 (lock() answered true for a lock being let go): confirmed by reading; lock() returns false while
  `releasing` is set, and its result is `locked && !releasing`. Test with a fake document whose exit lands
  later ('a release still on its way is not a lock'). Commit: R-a.
- [x] MF-R5 (dead '.screen.settings', header contradicting the code): removed from CURSOR_WINDOWS (the
  settings root is 'panel interactive settings', ui/settings/screen.ts:128, so '.panel' covers it); header
  and the `held` getter comment now say a lock that lands while a window is up is let go. Commit: R-a.
- R-a checks: 8 of 8 tests pass; negative control against the lane's HEAD 77379ada mouse-look.ts: NEG OK,
  the 3 new tests fail there, the 5 old ones pass. Typecheck apps/fly and tools/bench exit 0.
  R-a = commit e2e77e66.
- [x] MF-R2 (the probe did not walk every window): entries added for the drones screen (P, Drone), the
  scenes screen (P, Scene) and the ceiling panel (P, Settings, the voxels group's Show button: Settings
  closes and the panel opens in the same click, the owner's pattern). Stage 2 item 1 now means these 12
  entries, not every window: not walked are floaters, share, replays, measure, import, the how-to-fly card,
  the crash view, the export bar and the Fly by Sound screens (covered by CURSOR_WINDOWS and unit tests
  only). Commits 9a477401, 663848e1, R-b below.
- [x] Regression found by the probe after MF-R4 (e2e77e66): when Chrome resolves requestPointerLock before
  it fires pointerlockchange, lock() let the lock go before onChange saw it land, so `releasing` stayed set
  and every later click was refused (21 fails: no capture after the first window). Fix: onChange clears
  `releasing` whenever the lock is gone, lock() clears it when nothing is held. Test 'a lock let go before
  its own event was seen leaves no release hanging'; 9 of 9 pass; NEG OK against e2e77e66's mouse-look.ts
  (only the new test fails). Typecheck apps/fly and tools/bench exit 0. Commit 663848e1.
- [x] Probe on a local release build of 663848e1 (serve-csp 5391, headless, GPU lock): 83 of 84 checks pass,
  the one fail 'ceiling: a click inside keeps the mouse free' (the Show button sat in a group the rail had
  not picked, so Settings stayed up). After the probe picks the row's group (R-b), the ceiling entry alone on
  the same build: 7 of 7 pass, exit 0 (walls true, group voxels, window ceiling-panel). Evidence:
  evidence/2026-11-13/mouse-free/probe-local-review.json and probe-local-review-ceiling.json. The full
  probe was not rerun after R-b (only the ceiling entry changed).
- [x] MF-R6 (clash with lanes rooms-public and rc2 in the probe): no change in the lane (the key 9 and the
  rc2 verdict exist only on the other branches); under For the lead.
- Refuted: none; MF-R1 to MF-R6 were all confirmed by the code. R-b = the commit that adds this text.

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
- Stage 2 probe: the click inside each window goes to a control that changes nothing outside the page (the
  report text field, the settings search box, the Controls screen's USB disclosure, the rooms nickname
  field, the pause menu's heading since every menu item acts). The course has no window: its two entries
  check that no window stays and the flight has the capture, not that it is released.

## For the lead before the merge

- Nothing outside the lane's paths was needed. dialogOpen() in apps/fly/src/devices/keyboard.ts (lane rc2's
  path) still has its own selector list; CURSOR_WINDOWS is a superset of it plus aria-modal dialogs, the
  settings screen and the crash view. Folding the two lists into one is a later cleanup.
- The rooms page on the local release build logs a page error "Cannot read properties of null (reading
  'rooms')" (apps/fly/src/app/builtin/rooms.ts:301, `a.value.rooms` when the local server answers the rooms
  list with no body; serve-csp has no rooms API). The live site (same release 41372830) logs none. Lane
  rooms' path: a guard `a.value?.rooms ?? null` would quiet it. Not a mouse-free defect.
- Level 3: run `node tools/bench/scripts/mouse-free-probe.mjs http://localhost:<port>/en <out.json>` on the
  merged release build; all 84 checks must pass (about 5 minutes, GPU lock).
- MF-R6, after the merge with rooms-public and rc2: in the probe's rooms entry press Digit9 first (keep the
  Shift+L and menu fallbacks) and drop '&rooms=1' once rooms are public; read the helper entry's fieldText
  (rc2 changes the list text for FF.43.01) and that 'Send this list' is still there beside rc2's 'Fly with
  this controller'.
- MF-R1, not done in the lane: a probe entry for the video export bar (needs a recorded life in the
  replays panel before Export). CURSOR_WINDOWS has '.vx-bar' and a unit test covers it.
- MF-R3, optional and not done: a unit test of the play.ts wiring (held = menu open or dialogOpen() or
  cursorWindowOpen(), sync() on each pause event and on the 250 ms tick) with a fake context. The probe
  covers it on the page.
- dialogOpen() in devices/keyboard.ts (lane rc2) lists '.screen.settings' too; it matches nothing (the
  settings root is 'panel interactive settings'). Not in this lane's paths.

## Not verified

- A headed Chrome with the real DJI RC 2 and a real mouse (the owner's PC): only headless with a fake
  navigator.usb.
- Firefox and Safari pointer lock (the probe runs Chromium).
- (Closed in stage 2: the probe's pause entry checks that Continue takes the capture again; it passes.)
- A real mouse: headless Chromium does not paint the OS cursor, so the screenshot shows the hover and focus
  of Send, and the probe reads the computed cursor style; nobody looked at a real cursor on a real screen.
- After the review: the full probe was not rerun after the ceiling entry's group pick (R-b); the export
  bar, floaters, share, replays, measure, import, how-to-fly, crash view and Fly by Sound pages are not
  walked by the probe (CURSOR_WINDOWS and unit tests only). Whether Chrome resolves requestPointerLock before
  or after pointerlockchange on the owner's PC: both orders are covered by unit tests, only headless Chromium
  was run.
- A real screen reader (NVDA, JAWS, VoiceOver) announcing each window: not run; the probe only checks
  that Send is reachable by Tab on the report form.
- The course has no window of its own: Shift+G and the menu's New course leave no window up, and the
  flight keeps or takes the capture again. If a course window is added later, the probe needs an entry.

## Cost notes

- Stage 1: most turns went to finding how the screens open and how a probe drives the page (no existing probe
  fakes navigator.usb). Cheaper: a probe template in the code map that starts a game-scheme flight and opens
  the Controls screen. Also: neg_control.py cannot start npx on Windows; call node node_modules/vitest/vitest.mjs
  and add --reporter=json --outputFile to see which tests failed on the old code.
- Stage 2: most turns went to finding how each window opens and which control inside is harmless (no
  send, save or create), plus one rerun because the second page of a profile skips the Controls screen.
  Cheaper: a list in the code map of every window with its opener and a safe inside control.
- Review fixes: most turns went to the browser runs (two builds of about 2 minutes, one wait for another
  lane's GPU lock) and to finding where the ceiling row sits (a rail group of Settings, walls load after
  'ready'). Cheaper: a fake document in the unit test that can fire the lock event after the promise
  (would have caught the hanging release before the probe), and the code map naming each setting's group.
