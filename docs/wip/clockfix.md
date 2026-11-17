# Lane clockfix: the course clock on a short view (review of 7af2aad5, F1 and F2)

## Status
- [x] branch clockfix from origin/main (efd17add); probe tools/bench/scripts/clock-place-probe.mjs
- [x] probe BEFORE (release of origin/main): key 18 overlaps, touch 48 (negative control fires); evidence/2026-11-17/clockfix/before-*.json
- [x] change: hud.css short view = one chip (backdrop, cross inside); key left column, touch bottom middle; no --cinema-top lift
- [x] F2: editor.css walls-summary `interactivity: inert` (Chrome 157 checked: Tab skips it); tests int3f-clock.test.ts (5, each with a negative control)
- [x] probe AFTER: key 0, touch 0 overlaps at 932x430, 844x390, 740x360, 667x375 (before, flight, finish); after-*.json
- [x] pictures looked at (run 2); tall sizes 1366x768, 1280x720, 390x844: clock and cross rectangles identical before and after (key and touch); only the probe field `flying` differs on touch (its take-off), not the place
- [x] typecheck apps/fly: exit 0 (run 2)
- LEFT:
  - course-finish-probe.mjs run, typecheck apps/fly, gates (vitest, architecture, i18n, b18, leaks), a6-reference hash
  - What the owner sees / Not verified / For the lead texts

## What the owner sees
On a phone on its side the course clock is one dark chip with its own cross inside: with a keyboard at the left under the
Walls caption, on touch at the bottom between the two sticks. It no longer lies over the take-off prompt, the REC row or a stick.

## Not verified
No phone and no person took part. ARM-button touch profile (not easy play) not measured. Browsers without CSS interactivity keep the caption's focus.

## For the lead
Files: apps/fly/src/course/hud.css, apps/fly/src/course/editor/editor.css, tools/bench/test/int3f-clock.test.ts,
tools/bench/scripts/clock-place-probe.mjs, evidence/2026-11-17/clockfix/*.json, this file. Only the page changed (no API, nginx or rooms).
