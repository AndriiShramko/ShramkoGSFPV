# w1-dialog: the generate dialog asks WHERE (train 5, R2 of w1-diag)

Branch w1-dialog (from w1-anchor), work copy C:/dev/gsfpv-t7-n-share. Design: C:/dev/.gsfpv-lanes/designs/w1-diag.md,
Design proposal, point R2. The owner's brief line 667 (ideas b, c, d). Temp folder U:/Temp/gsfpv-train4/w1-dialog.

## Status

- [x] S1 Here and Whole scan in the dialog, the hint line (idea d), four locales, tests in generate-dialog.test.ts
  - [x] generate-dialog.ts: `CourseWhere` ('here' | 'scan'), `DEFAULT_WHERE` = 'here', the where row replaces the spread row, `hint`
  - [x] course.ts: the dialog opens on Here every time; the level is still remembered; the sound mode's direct press keeps course.spread
  - [x] locales fly/course en, es, pl, ru: course.gen.spread* replaced by course.gen.where*; whereHint
  - [x] gap-gen-accept.mjs presses gen-where-here/scan (gen-spread-* on an older build)
  - [x] NEG OK on w1-anchor (`-t "w1-dialog"`: missing course.gen.whereTitle, DEFAULT_WHERE undefined)
- [x] S2 Add here: the old gates kept as occupied places, the new part from the drone, the ring closed; tests with NEG; the link after Add here
  - [x] packages/tracks: CoursePlace.occupied, extend.ts joinCourses (splice at one leg of each ring), PlanInput.keep,
    planCourse answers 'no-join'; the link 'g2.<first>_<seed>.<ls>.<x>.<y>.<z>' (addedLinkId, parseCourseLink adds)
  - [x] add-here.test.ts 9 passed; NEG OK on w1-anchor
  - [x] the page: dialog Add here (only over a course; the line says Here and Whole scan replace it), the worker's keep,
    a 'no-join' answer says what to press (course.addNone), a link's parts laid in turn (course.ts linkAdds), locales
  - [x] flight-link.ts: a course token may hold '_' and up to 240 characters; w1-dialog-link.test.ts, NEG OK
  - [x] generate-dialog.test.ts Add here tests, NEG OK on 31efdfb2; expectations of the link's shape (`adds: []`) updated
    in request, course-progress and w1-anchor tests
- [ ] S3 acceptance by mouse at 1536x730@1.25 on a local release build (en, pl; keys alone); gen4-generate-dialog live check and probe; gates.py

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

(S3)

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

## Not verified

- The page laying a link's parts in turn (course.ts linkAdds) has no unit test (the course feature has no page-free
  harness); the S3 probe opens such a link in a fresh context.
- Rooms: rooms/race.ts courseFor proposes a generated course by `courseLinkId(now.request)`, so after Add here a room
  would lay only the last part (its COURSE_RE takes 64 characters). Not changed here (rooms' files); see For the lead.

- apps/fly typecheck: 27 errors, all in apps/fly/src/sonic/, from the stale packages/sonic-fpv work tree (checked out at
  53a5675, the pin is 9ac7876; not touched here, as in w1-anchor). No error in a file of this lane.
- No person, phone or real controller took part.

## For the lead

(S3)

## Cost notes

- S2: about 30 replies; most went to reading generate.ts walkCourse and plan.ts planCourse to find the one place for the
  occupied points and the join; a design note naming walkCourse's spacing rule would have saved half.
- S1: about 15 replies; most went to reading course.ts slices and the probes that press the dialog's buttons.
