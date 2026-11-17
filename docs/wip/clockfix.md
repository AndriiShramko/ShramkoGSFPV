# Lane clockfix: the course clock on a short view (review of 7af2aad5, F1 and F2)

## Status
- [x] branch clockfix from origin/main (efd17add); probe tools/bench/scripts/clock-place-probe.mjs
- [x] probe BEFORE (release of origin/main): key 18 overlaps, touch 48 (negative control fires); evidence/2026-11-17/clockfix/before-*.json
- [x] change: hud.css short view = one chip (backdrop, cross inside); key left column, touch bottom middle; no --cinema-top lift
- [x] F2: editor.css walls-summary `interactivity: inert` (Chrome 157 checked: Tab skips it); tests int3f-clock.test.ts (5, each with a negative control)
- [x] probe AFTER: key 0, touch 0 overlaps at 932x430, 844x390, 740x360, 667x375 (before, flight, finish); after-*.json
- [x] pictures looked at (run 2); tall sizes 1366x768, 1280x720, 390x844: clock and cross rectangles identical before and after (key and touch); only the probe field `flying` differs on touch (its take-off), not the place
- [x] typecheck apps/fly: exit 0 (run 2)
- [x] course-finish-probe.mjs (70b50d42, SIZES=1280x720,844x390,667x375, 3 laps): 0 crashes, 0 errors; evidence finish-after.json
- [x] gates vitest (403 files, 5298 tests), architecture, i18n, b18, leaks: all PASS; a6-reference.test.ts holds its hash (run with int3f-clock.test.ts: 2 files, 6 tests pass)
- [x] server on 5840 stopped (PID 68752)

## Numbers (clock-place-probe, rectangles x,y,w,h in CSS px)
| size, input, state | before (origin/main) | after |
|---|---|---|
| 844x390 key, before take-off | text 633,287 195x15; cross 581,258 (in the prompt's pill) | chip 16,142 249x56; cross 215,148 |
| 667x375 key, before take-off | text 456,272; cross 404,243 (over the prompt) | chip 16,112 190x56; cross 156,118 |
| 844x390 key, flight | 762,135 66x82; cross 710,173 hanging below | chip 16,112 134x94; cross 100,137 inside |
| 844x390 touch, before take-off | text 633,195; cross 581,166 (over the right pad) | chip 290,310 263x56; cross 504,316 |
| 667x375 touch, flight | 585,67 66x82 (over the right pad) | chip 266,257 134x94; cross 351,282 |
| 1366x768 / 1280x720 / 390x844, all states | e.g. 1366 flight 644,120 78x97 | identical |

Overlaps of the clock or its cross with another shown thing at the four short sizes, three states: before key 18, touch 48; after 0 and 0.

course-finish-probe, the clock block after the finish card is gone: 1280x720 at 600.9,142 78.2x97.4 (out of the middle third);
844x390 and 667x375 at 16,112 134x93.6 (left column). The probe's `middleThirdFree` reads false at the two short sizes: it tests
only the height band (y from H/3 to 2H/3); the chip is at the left edge, out of the middle third of the width. Before the change
the clock at these sizes stood in the same height band too (844x390 flight y 135 to 217, at the right edge), so this is not new.

## What the owner sees
On a phone on its side the course clock is one dark chip with its own cross inside: with a keyboard at the left under the
Walls caption, on touch at the bottom between the two sticks. It no longer lies over the take-off prompt, the REC row or a stick,
and the cross can no longer be taken for the prompt's close button. On a laptop (1366x768, 1280x720) and a phone held upright
nothing moved. In the course editor on a short view the Walls caption is no longer reached by Tab.

## Not verified
- No phone and no person took part: all numbers come from headless Chrome (?render=off for clock-place-probe, drawn for course-finish-probe).
- The pictures were taken with ?render=off: the red test-mode line at the bottom (only in that mode) touches the touch chip at
  667x375; a real page has no such line.
- The touch profile with the ARM button (not easy play) was not measured; the chip is meant to stand above it.
- A real rotation of a phone in a flight was not done; the probe resizes the view between states. No value kept by a script
  decides the place any more, so no stale height can remain.
- Browsers without CSS `interactivity` keep the Walls caption's keyboard focus (it still does nothing there).
- Not in this lane, seen on the pictures: on touch the 'Left stick ... Right stick' hint lies over the School chip and the walls caption at 667x375.

## For the lead
Files changed: apps/fly/src/course/hud.css, apps/fly/src/course/editor/editor.css, tools/bench/test/int3f-clock.test.ts,
tools/bench/scripts/clock-place-probe.mjs (new), evidence/2026-11-17/clockfix/{before,after}-{key,touch}.json and finish-after.json, this file.
Only the page changed (CSS of the course clock and the editor caption); no API, nginx or rooms. No push, no deploy.

Deploy order (review 1): the page only (dist of the release build). nginx: no (deploy/ untouched). API files (apps/api): no.
Rooms service: no. Sound package (packages/sonic-fpv pin): no. deploy/live-checks.sh: unchanged by this lane.

## Review
Review 1 (release check, 2026-11-17), head after merging origin/main (a36280e1, STATE only):
- Read the hunks (hud.css, editor.css): CSS inside `@media (max-height: 500px)` only; no script, key, pointer lock, pause,
  Fly by Sound or session path changed. The release build keeps `interactivity:inert` (checked in dist/fly/assets CSS).
- clock-place-probe on my own release build (port 5851): key 0, touch 0 overlaps on the four short views, before take-off,
  flight, finish; 1366x768, 1280x720, 390x844 rectangles equal to the lane's before-*.json (390x844 touch overlaps the credit
  line and the walls caption: the same 7 overlaps on origin/main, not new).
- Drawn walk, keyboard at 1536x730 dpr 1.25 (click into the scene, lock taken, Shift+G, Space, Esc): the clock at 664,120 as
  before; Esc pauses and the pause menu covers it (as on main). Keyboard 844x390 drawn: the chip at 16,142 under the walls
  caption, lock held in the air. Touch 667x375 drawn: the chip between the pads.
- The cross clicked with the mouse (keyboard 844x390, no lock) and tapped (touch 667x375 and 932x430) in a flight: the clock
  hides, Shift+T brings it back; the cross is the top element at its centre (elementFromPoint).
- Negative controls (neg_control.py against origin/main): 'one chip' test fails on the old hud.css, 'takes no keyboard focus'
  fails on the old editor.css: both NEG OK.
- Finding (DOUBT, not repaired, not worse than live): touch with the pilot profile (ARM button, ?set.input.play=pilot) before
  arming, the REC row shows and the chip is lifted 64 px over ARM: its top lies on the REC row's lower edge (844x390: about
  10 px over 'Choose a folder', the cross 6 px; 667x375 the wrapped 'Choose a folder' 3 to 10 px). The live release puts the
  clock and its cross over the right stick pad in that state. In a flight the REC row hides, so the chip is free there.
  The probe could not arm (render=off), so the armed flight in the pilot profile is not measured.
- Not verified: the owner's laptop, a real phone, a real rotation and a person took no part; Tab in the course editor on a
  short view was not walked by me (unit test and the built CSS only); accept-fly not run (the lane touches no flight, key or
  session code).
