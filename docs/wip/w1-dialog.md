# w1-dialog: the generate dialog asks WHERE (train 5, R2 of w1-diag)

Branch w1-dialog (from w1-anchor), work copy C:/dev/gsfpv-t7-n-share. Design: C:/dev/.gsfpv-lanes/designs/w1-diag.md,
Design proposal, point R2. The owner's brief line 667 (ideas b, c, d). Temp folder U:/Temp/gsfpv-train4/w1-dialog.

## Status

- [x] S1 Here and Whole scan in the dialog, the hint line (idea d), four locales, tests in generate-dialog.test.ts
  - [x] generate-dialog.ts: `CourseWhere` ('here' | 'scan'), `DEFAULT_WHERE` = 'here', the where row replaces the spread row, `hint`
  - [x] course.ts: the dialog opens on Here every time; the level is still remembered; the sound mode's direct press keeps course.spread
  - [x] locales fly/course en, es, pl, ru: course.gen.spread* replaced by course.gen.where*; whereHint
  - [x] gap-gen-accept.mjs presses gen-where-here/scan (gen-spread-* on an older build)
  - [x] NEG OK on w1-anchor (`-t "w1-dialog"`: missing course.gen.whereTitle, DEFAULT_WHERE missing)
- [x] S2 Add here: the old gates kept as occupied places, the new part from the drone, the ring closed; tests with NEG; the link after Add here
  - [x] packages/tracks: CoursePlace.occupied, extend.ts joinCourses (splice at one leg of each ring), PlanInput.keep,
    planCourse answers 'no-join'; the link 'g2.<first>_<seed>.<ls>.<x>.<y>.<z>' (addedLinkId, parseCourseLink adds)
  - [x] add-here.test.ts 9 passed; NEG OK on w1-anchor
  - [x] the page: dialog Add here (only over a course; the line says Here and Whole scan replace it), the worker's keep,
    a 'no-join' answer says what to press (course.addNone), a link's parts laid in turn (course.ts linkAdds), locales
  - [x] flight-link.ts: a course token may hold '_' and up to 240 characters; w1-dialog-link.test.ts, NEG OK
  - [x] generate-dialog.test.ts Add here tests, NEG OK on 31efdfb2; expectations of the link's shape (`adds: []`) updated
    in request, course-progress and w1-anchor tests
- [x] S3 acceptance by mouse at 1536x730@1.25 on a local release build (en, pl; keys alone); gen4-generate-dialog live check and probe; gates.py
  - [x] w1-dialog-accept.mjs (6 steps) and the live check w1-dialog-where; gen4-accept-probe presses Here, reads the where row (e2eab9b0)
  - [x] the probe found a defect: a pick by the keyboard dropped the focus (Tab began at the page's start, never reached Cancel);
    paint() keeps the focus on the same action; generate-dialog.test.ts, NEG OK on e2eab9b0 (bd32c2bd)
  - [x] local release build of bd32c2bd: w1-dialog-accept 6/6 PASS; live site 6/6 FAIL; old gen4 probe FAILS step 3 on the build,
    the new one 11/11 PASS (evidence/2026-11-19/w1-dialog/)
  - [x] gates.py typecheck,vitest,architecture,i18n,b18,leaks (result in Claims 7); dist deleted
  - [x] the gates found two source-text tests broken by S2's signatures (int4-seams 'build: (r, add)', walls-first
    'generate(seed, how, from, keep)'): patterns updated; the probe writes its JSON in ASCII (\u escapes) for B18 and the two
    evidence files were re-encoded the same way (the parsed values checked identical)

## Design vs code

- The design calls Here 'the level's compact or whole spread from the anchor'; the code already had a spread row (Compact,
  Whole scene). Two rows asking the same would be a crutch: the spread row became the where row (Here = compact, Whole
  scan = wide), so the request contract (`CourseAsk.spread`) and the link (`g2.<seed>.<level><c|w|v>`) are unchanged.
- The dialog no longer writes the stored spread (course.spread): Here is the default every time it opens, as the lead asked.

- Add here (design: 'the existing track's gates as occupied cells for generateCourse'): the kept gates are occupied
  POINTS (CoursePlace.occupied, the walk's spacing rule), not free-space cells; the new ring is laid round the drone and
  spliced into the kept ring at one leg of each (extend.ts joinCourses), the pair adding the least length first, at most
  JOIN_TRIES whole-course proofs. The kept gates keep position, turn and shape; only the first new gate may be turned.

## The link after Add here (point 4)

A longer link, not a stored track: `g2.<seed>.<ls>.<x>.<y>.<z>_<seed>.<ls>.<x>.<y>.<z>` (one part per Add here, at most
MAX_ADDS 4). Why: the course is the plan of each part on the same walls, so seeds and anchors are enough; a stored track
needs a Save (a server write, a name, the server's reports) before a link exists, and the pilot asked for nothing of that.
Another browser lays the first part, then each part kept-and-joined to the course before it (add-here.test.ts lays it
again gate for gate). A course whose base has no 'g2.' link (a saved or edited one), or a fifth Add here, gets no link:
the address carries the scene alone (no link that lays another course), and Save makes it travel.

## What the owner does

1. Open a scan (for example eb5f51dc), click into the scene, press key Shift+G. The dialog 'Generate a course' shows Level
   (Beginner, Medium, Pro) and Where: Here is already pressed, Whole scan beside it; a line says the course is laid where
   the drone is and that for another place you fly there, press key Esc, then key Shift+G. Press the main button (or key
   Enter): the course comes round the drone, gate 1 a few metres away.
2. Fly about 30 m away, press key Esc (the drone stops in the air), click the menu's course item. The dialog now offers a
   third choice, Add here, and a line: 'Here and Whole scan replace the current course (N gates). Add here keeps it'. Click
   Add here (the line becomes 'Keeps all N gates of the current course'), click 'Add the gates': every old gate stays where
   it was, new gates stand round the drone, all of them one closed ring.
3. Press key Esc, Share: the copied address lays the whole course (both parts) in any other browser.
4. Key Shift+G, Whole scan, the main button: the course is replaced by one that starts at the drone and spreads over the scan.
5. Without a mouse: key Shift+G, key Tab walks through every button, key Space picks one, key Enter on the main button builds,
   key Esc or Cancel closes and keeps the course. The same in Polish (/pl/), Spanish and Russian.

## Claims

1. The dialog offers Here (pressed when it opens) and Whole scan; Here asks a compact course, Whole scan the wide one; one
   line says the course is laid where the drone is and how to have it elsewhere; the texts exist in en, es, pl, ru.
   `npx vitest run tools/bench/test/generate-dialog.test.ts` -> 9 passed. NEG on w1-anchor (`-t "w1-dialog"`) -> NEG OK.

2. Add here keeps the old gates gate for gate (position, turn, shape, order, the start), lays new gates round the drone
   (one within 10 m of it, 28 m from the first course's anchor), closes the ring, proves it on the walls (checkTrack at
   the course's margin), keeps every leg under 60 m and the course under 60 gates; the link lays the very same course.
   `npx vitest run packages/tracks/test/add-here.test.ts` -> 9 passed. NEG on w1-anchor -> NEG OK.
3. The dialog offers Add here only over a course, says beside it that Here and Whole scan replace the course, and names
   what Add here keeps; texts in en, es, pl, ru. `npx vitest run tools/bench/test/generate-dialog.test.ts -t "Add here"`
   -> 2 passed. NEG on 31efdfb2 -> NEG OK.
4. The longest Add here link (4 parts) travels in an address and reads back part for part.
   `npx vitest run tools/bench/test/w1-dialog-link.test.ts` -> 2 passed. NEG on 31efdfb2 -> NEG OK.
5. A choice picked by the keyboard keeps the focus through the dialog's repaint, so key Tab goes on to Cancel and the main
   button. `npx vitest run tools/bench/test/generate-dialog.test.ts` -> 11 passed. NEG on e2eab9b0 -> NEG OK.
6. The pilot's path by the mouse at 1536x730@1.25 on a local release build of bd32c2bd: Here (pressed, gate 1 9.4 m from the
   drone), Add here 30.6 m from the spawn (13 old gates kept to 1 cm, 14 new, nearest new gate near the drone, closed,
   outside 0), the link 'g2.pre1yr.mc.-9.6.-21_33a0vd.mc.17.15.-4' lays the same 27 gates in a fresh context, Whole scan
   replaces (0 old gates kept, spread wide), keys alone (Tab order x, levels, Here, Whole scan, Add here, Cancel, main;
   Space picks, Enter on Cancel keeps), Polish texts and Enter alone builds; the dialog fits, no overlap, buttons 44 px.
   `cd tools/bench && node scripts/w1-dialog-accept.mjs http://localhost:7520/en <out>` -> 6/6 PASS
   (evidence/2026-11-19/w1-dialog/accept-head.json). The live site: 6/6 FAIL (accept-live.json, read only, the negative
   control). gen4-accept-probe: the old one FAILS step 3 on the build (gen4-old-on-head.json), the new one 11/11 PASS
   (gen4-new-on-head.json).
7. The gates: `gates.py --only typecheck,vitest,architecture,i18n,b18,leaks` -> architecture, i18n, leaks PASS; typecheck
   FAIL only in apps/fly/src/sonic/ (27 errors, the stale sonic-fpv work tree, see Not verified); vitest 17 failed: 2 of this
   lane (int4-seams, walls-first; fixed, `npx vitest run tools/bench/test/int4-seams.test.ts tools/bench/test/walls-first.test.ts`
   -> pass), the rest are the sonic tests and packages/tracks size-flown (it imports validateTrack from the stale sonic-fpv;
   it fails the same with the w1-anchor tracks sources: neg_control on ab98035c) and app-dji-rc2 (a timing test, see Not
   verified); `gates.py --only b18` after the fixes -> FAIL naming only docs/wip/train5-lead.md (see Not verified).

## Not verified

- No person, phone or real controller took part; the acceptance is a headless Chromium run with render off (no picture).
- Whole scan on eb5f51dc reaches only a little farther than Here from the same place (32.5 m against 29.5 m, probe step 4):
  the scan's well scanned part is about 35 m across, so both fill most of it. A larger scan was not run with the mouse.
- The page hook's plan carries no 'eased' flag (null in step 4), so the probe cannot tell a wide ask the planner laid
  compact; the spread is judged by the gates' reach only.
- A second release build was made in S3 (the focus defect needed a rebuild to be checked).
- B18 FAILS naming only docs/wip/train5-lead.md: the lead note on a base older than its repair on origin/main (not this lane's).
- app-dji-rc2 'answers 60 ms late' failed once inside the full gate run (a timing test under load); alone it passes
  (`npx vitest run tools/bench/test/app-dji-rc2.test.ts` -> 15 passed). No file of it was touched here.
- The page laying a link's parts in turn (course.ts linkAdds) has no unit test (the course feature has no page-free
  harness); the S3 probe's step 3 opened such a link in a fresh context and got the same 27 gates (PASS).
- Rooms: rooms/race.ts courseFor proposes a generated course by `courseLinkId(now.request)`, so after Add here a room
  would lay only the last part (its COURSE_RE takes 64 characters). Not changed here (rooms' files); see For the lead.

- apps/fly typecheck: 27 errors, all in apps/fly/src/sonic/, from the stale packages/sonic-fpv work tree (checked out at
  53a5675, the pin is 9ac7876; not touched here, as in w1-anchor). No error in a file of this lane.

## For the lead

- A pilot gets: Shift+G asks WHERE (Here by default, Whole scan; Add here over a course keeps every gate and adds a ring round
  the drone), one line on how to have it elsewhere (fly, Esc, Shift+G); keys alone work through every choice.
- Files: apps/fly course/generate-dialog.ts, app/builtin/course.ts, course/worker.ts, share/flight-link.ts; packages/tracks
  extend.ts (new), plan.ts, generate.ts, request.ts, index.ts; locales fly/course en, es, pl, ru; deploy/live-checks.sh.
- The link after Add here is a longer link (g2.<first>_<part>..., at most 4 parts), no stored track: see the section above.
- Deploy: page only (no API, rooms, nginx or sound package). Live checks: gen4-generate-dialog (updated), w1-dialog-where (new),
  gap-gen-asked-course.
- Not verified: a room after Add here lays only the last part (rooms/race.ts courseFor, COURSE_RE 64 characters; not changed,
  rooms' files); Whole scan's reach on a large scan; no person, phone or controller.

## Cost notes

- S3: about 45 replies; most went to the gates' failures (two source-text tests that match course.ts, B18 on Polish letters in
  the evidence) and to shell quoting of a regex; a probe template that writes ASCII JSON, and running the source-text tests
  (`npx vitest run --changed`) in S2, would have saved a rebuild-free 10.

- S2: about 30 replies; most went to reading generate.ts walkCourse and plan.ts planCourse to find the one place for the
  occupied points and the join; a design note naming walkCourse's spacing rule would have saved half.
- S1: about 15 replies; most went to reading course.ts slices and the probes that press the dialog's buttons.
