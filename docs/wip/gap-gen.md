# Lane gap-gen (train 4, gap lane, plan t6-gaps-plan.md Part B item 1)

Work copy C:/dev/gsfpv-t6-gap-gen, branch gap-gen (from gen4a c8cbfa55). Temp U:/Temp/gsfpv-train4/gap-gen. Ports 6740-6759.
Design: the lane prompt, audit entries generator-1, -3, -4, -5, -10, -13, -14, -15 (t6-audit.json), gen4.md, gen4a.md.
Negative-control ref: the S1 merge of gen4a (5f946305) and gen4b (fb7f6524): 3ef3d4bf.

## Status

- [x] S1 placement at x1 (09355d9f, e758ca38, 05f06941)
  - [x] merge gen4a 5f946305 and gen4b fb7f6524 (no conflict; lock unchanged; tracks typecheck ok): 3ef3d4bf
  - [x] red rules of gen4a run 6 (evidence/2026-11-19/gen4/place.json): gates 6 (70b50d42 beginner seed 3, eb5f51dc
        medium seeds 2-3), nearCore 6 (39e63ce9 medium/pro compact); every other rule 216/216 (server and room already
        green: (b) and (c) need no repair, measured again in place-x1.json). Beginner under 5 gates but excused as
        'shrunk' by the audit: 70b50d42 2-3, ab5efa0e 2, 39e63ce9 1 (new audit rule beginnerMin, no excuse).
  - [x] (a) no NO-ROOM: plan.ts fallbackAsks: the asked one, compact when wide was asked, then compact by the walk of
        each harder level (walkedBy: the level's gates, the harder level's turns and shortest leg); answer flag `eased`.
        Difference from the prompt ('one level easier'): an easier level has a larger gate, longer legs and gentler turns,
        so it never fits where the asked one did not; the synthetic skull at x1 refused beginner and medium while pro's
        walk laid 3 gates. The code wins. 09355d9f
  - [x] (d) a course under gatesMin is walked once more by the next harder walk (same gates, no looser tier): audit
        tries 70b50d42 beginner 8 gates (was 2-3), eb5f51dc medium 10-14 (was 6), ab5efa0e beginner 5 (was 2). 09355d9f
  - [x] (e) ComposeInput.kinds (elements.ts elementOf(u, kinds)), CoursePlace.kinds, plan.ts passes R.level.elements:
        medium no flat square, no cube. 09355d9f
  - [x] (f) gap-gen-plan.test 'anyQuality: more gates than wide, on poor tiles too' (city: 18 vs 14 gates, good 0.94).
        Tests packages/tracks/test/gap-gen-plan.test.ts, NEG OK vs 3ef3d4bf (5 of 6 fail on the old code; the anyQuality
        case is a proof of the code gen4a had, it passes on both); packages/tracks 178/178.
  - [x] gen4-place-audit --scenes 70b50d42,eb5f51dc,ab5efa0e,2f1ddf5f,1994c65c,39e63ce9,7a475d38 ->
        evidence/2026-11-19/gap-gen/place-x1.json: PLANS 126 FAILED 9; course (no NO-ROOM) 126/126, gates 126/126,
        beginnerMin 42/42, server 126/126 (Lublin 18/18), room 18/18 (Winter Garden), cityLow 18/18, time 126/126 (max
        37.4 s of 120 s); nearCore 117/126 (39e63ce9 only, see Not verified). 24 plans walked by a harder walk (eased).
- [x] S2 race rooms (143bbe3d)
  - [x] race.ts: CourseNow.request (the hook's `request`, gen4b), courseFor names a generated asked course by its g2 link
        (courseLinkId), parseCourse reads 'g2.' back to { kind: 'request' }, adoptOf(ref) gives the course feature's adopt
        { seed, request } for it; a course without a request keeps 'g1.<seed>'.
  - [x] race-page.ts build: a 'request' ref is laid by the worker with `request` (and elements, the flown craft's
        boundRadius, as course.ts does) in the CourseJob: the racer's own dialog choice is never read.
  - [x] apps/fly/src/app/builtin/rooms.ts: the room's course is adopted through adoptOf (the request rides along).
  - [x] apps/rooms keeps `course` as an opaque string (protocol.py COURSE_RE [0-9A-Za-z._-]{1,64}; 'g2.<seed36>.pc' fits):
        no service change, no rooms deploy.
  - [x] tools/bench/test/gap-gen-race.test.ts: rooms.py on a free port (the rooms-race rig), host proposes a pro compact
        course, the guest (own dialog: beginner wide) gets the prep message, builds what the id names: the same gate
        positions on the synthetic city (planCourse); the board path (RoomBoard.onBoard) hands the same ask. 2/2 pass;
        NEG OK vs 3ef3d4bf (old race.ts sent 'g1.4242', the guest laid its own beginner wide gates: x 80.2 vs 52.2).
        rooms-race, rooms-board, rooms-race-page still pass (21/21); apps/fly and tools/bench typecheck ok.
  - Difference from the prompt: course.ts's adopt (lane gap-editor's file) reads only `seed` from what rooms.ts hands it
    and builds it with this pilot's own dialog choice: one line there is needed (For the lead). The race page (race-page.ts)
    does not depend on it.
- [ ] S3 his scale and the acceptance (--enlarged 5dfeb49b,ab5efa0e with plants share and start/finish to core;
      gap-gen-accept.mjs by mouse; live control fails the 5dfeb49b step)

## What the owner does

(filled in S3)

## Claims

1. A gate that fits is never refused at x1: the synthetic skull on a table and the plant tray at x1 give beginner and
   medium a course (before: no-room). `npx vitest run packages/tracks/test/gap-gen-plan.test.ts` -> 6/6 pass; NEG OK vs
   3ef3d4bf (5 of 6 fail on the old code).
2. A beginner course has at least 5 gates on Wroclaw 70b50d42 (8), Laval eb5f51dc (7-8), Forest Floor ab5efa0e (5) and
   the CC BY room 39e63ce9 (5-7) at x1. `npx tsx tools/bench/src/gen4-place-audit.ts --scenes 70b50d42,eb5f51dc,ab5efa0e,...`
   -> beginnerMin 42/42 in evidence/2026-11-19/gap-gen/place-x1.json (all seven scans).
3. Medium courses hold no flat square and no cube; pro courses do (LEVELS.elements through ComposeInput.kinds); a course
   without a level (the old g1 path) draws exactly as before. gap-gen-plan.test case 3 -> pass.
4. The voxels-only view (anyQuality) lays more gates than the whole-scene course, on poorly scanned tiles too (synthetic
   city: 18 vs 14, good share 0.94 vs 1). gap-gen-plan.test case 4 -> pass.
5. Lublin 2f1ddf5f passes the server rule on every plan (18/18) and Winter Garden 7a475d38 keeps every gate under the
   glass (room 18/18) at x1. place-x1.json tally.
6. A dialog course raced in a room is one course for the host and every guest: the race names it by its g2 link (level,
   spread, seed), the service keeps it, a guest whose own dialog says beginner wide lays the host's pro compact gates.
   `npx vitest run tools/bench/test/gap-gen-race.test.ts` -> 2/2 pass; NEG OK vs 3ef3d4bf.

## Not verified

- No person, phone or real controller took part; no page was opened in S1 (Node audit and unit tests only).
- nearCore red on 39e63ce9 (the CC BY fixture room, core radius 3.2 m) for every compact plan: gate 1 stands 3.7-7.4 m
  from the core. gen4a left the same 6 (medium, pro); beginner joins now because it gets 5-7 gates over the whole room
  instead of 1 gate near the core (a course of the level's count is worth more to the pilot than a start 1-4 m nearer).
  The owner's scans (5dfeb49b, ab5efa0e at x15) are measured for the start in S3.
- Courses under gatesMin left for medium and pro where the gates had to shrink (audit rule gates excuses them): Winter
  Garden medium 7 of 8, 39e63ce9 pro 2-4 of 12 at x1.
- The flag `eased` (PlanAnswer) is not shown by the page: apps/fly/src/course/worker.ts posts only ok, stats, shrunk.
- S2: no two browsers raced (RACE_ON is still false in race.ts; the race page is not loaded on the site). The test runs
  rooms.py and two RoomSockets in Node and lays both courses with planCourse on a synthetic city, not on a scan's walls
  in the worker. The board path (the room's course adopted by the course feature) is right only after the course.ts line
  under For the lead. A guest in Fly by Sound lays the asked course with the level's elements in the race page, while
  its course feature (courseElements(ctx.sonic)) would lay single gates: not measured.

## For the lead

- Files outside the owned list: none in S1 (generate.ts: besides closeAt one line, CoursePlace.kinds handed to
  composeElements; elements.ts and plan.ts are owned).
- PlanAnswer has a new field `eased` (the course was laid nearer the core than asked or by a sharper walk). If the page
  should say it, gen4b's worker.ts PlanNote and course.ts would pass and show it (not this lane's files).
- Deploy: page only (packages/tracks is bundled into the page and its worker).
- S2 files: apps/fly/src/rooms/race.ts, race-page.ts, apps/fly/src/app/builtin/rooms.ts (owned), the new test
  tools/bench/test/gap-gen-race.test.ts. apps/rooms is unchanged (the course id is opaque there): no rooms deploy.
- S2 needs one line in apps/fly/src/app/builtin/course.ts (lane gap-editor's file), hook.adopt at line ~101, so a room's
  g2 course is built with the asker's level and spread (rooms.ts already hands `{ seed, request }`, race.ts AdoptRef):
  `hook.adopt = (c) => ('request' in c && c.request ? ((request = { level: c.request.level, spread: c.request.spread,`
  `anyQuality: c.request.anyQuality }), generate(c.seed >>> 0)) : 'seed' in c ? generate(c.seed >>> 0) : void loadServer(0, true, c));`
  and widen CourseHook.adopt in apps/fly/src/course/hook.ts to race.ts AdoptRef. Without it a guest adopting the room's
  course from the board lays the seed with its own dialog choice, gets another id and offers it as the room's course.

## Cost notes

- S1: ~45 replies; most went to finding why beginner/medium had no course on tiny scans (the prompt's 'one level easier'
  cannot help: a diagnostic test of all levels on the four synthetic worlds settled it in one run). Cheaper: write that
  diagnostic first; python file edits must use newline='' (one CRLF slip).
- S2: ~25 replies; most went to tracing where the room's course is built (race-page, board, rooms.ts, course.ts adopt).
  Cheaper: grep `adopt` and `parseCourse` across apps/fly at once; neg_control.py needs "npx.cmd ..." as one argument on
  Windows (bare npx: FileNotFoundError).
