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
