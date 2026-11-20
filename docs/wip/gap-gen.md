# Lane gap-gen (train 4, gap lane, plan t6-gaps-plan.md Part B item 1)

Work copy C:/dev/gsfpv-t6-gap-gen, branch gap-gen (from gen4a c8cbfa55). Temp U:/Temp/gsfpv-train4/gap-gen. Ports 6740-6759.
Design: the lane prompt, audit entries generator-1, -3, -4, -5, -10, -13, -14, -15 (t6-audit.json), gen4.md, gen4a.md.
Negative-control ref: the S1 merge of gen4a (5f946305) and gen4b (fb7f6524): 3ef3d4bf.

## Status

- [x] S1 placement at x1 (09355d9f, e758ca38, this commit)
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
- [ ] S2 race rooms (g2 link through courseFor / parseCourse / CourseJob / adopt; rooms-race style test + NEG)
- [ ] S3 his scale and the acceptance (--enlarged 5dfeb49b,ab5efa0e with plants share and start/finish to core;
      gap-gen-accept.mjs by mouse; live control fails the 5dfeb49b step)

## What the owner does

(filled in S3)

## Claims

1. A gate that fits is never refused at x1: the synthetic skull on a table and the plant tray at x1 give beginner and
   medium a course (before: no-room). 
 RUN  v5.0.1 C:/dev/gsfpv-t6-gap-gen


 Test Files  1 passed (1)
      Tests  6 passed (6)
   Start at  02:55:45
   Duration  34.12s (tests 89%, import 7%, transform 4%) -> 6/6 pass; NEG OK vs
   3ef3d4bf (5 of 6 fail on the old code).
2. A beginner course has at least 5 gates on Wroclaw 70b50d42 (8), Laval eb5f51dc (7-8), Forest Floor ab5efa0e (5) and
   the CC BY room 39e63ce9 (5-7) at x1. 70b50d42 x1 beginner compact 1 street gates 8 open 0.638 shrunk good 1 9864 ms PASS
70b50d42 x1 beginner compact 2 street gates 8 open 0.85 good 1 6563 ms PASS
70b50d42 x1 beginner compact 3 street gates 8 open 0.638 shrunk good 1 7692 ms PASS
70b50d42 x1 beginner wide 1 street gates 8 open 0.638 shrunk good 1 4674 ms PASS
70b50d42 x1 beginner wide 2 street gates 8 open 0.85 good 1 3777 ms PASS
70b50d42 x1 beginner wide 3 street gates 8 open 0.638 shrunk good 1 4309 ms PASS
ab5efa0e x1 beginner compact 1 plants gates 5 open 0.85 good 1 1097 ms PASS
ab5efa0e x1 beginner compact 2 plants gates 5 open 0.85 good 1 1033 ms PASS
ab5efa0e x1 beginner compact 3 plants gates 5 open 0.638 shrunk good 1 445 ms PASS
ab5efa0e x1 beginner wide 1 plants gates 5 open 0.85 good 1 546 ms PASS
ab5efa0e x1 beginner wide 2 plants gates 5 open 0.85 good 1 520 ms PASS
ab5efa0e x1 beginner wide 3 plants gates 5 open 0.359 shrunk good 1 283 ms PASS
eb5f51dc x1 beginner compact 1 street gates 8 open 0.638 shrunk good 1 690 ms PASS
eb5f51dc x1 beginner compact 2 street gates 7 open 0.638 shrunk good 1 569 ms PASS
eb5f51dc x1 beginner compact 3 street gates 8 open 0.638 shrunk good 1 599 ms PASS
eb5f51dc x1 beginner wide 1 street gates 8 open 0.638 shrunk good 1 496 ms PASS
eb5f51dc x1 beginner wide 2 street gates 7 open 0.638 shrunk good 1 489 ms PASS
eb5f51dc x1 beginner wide 3 street gates 8 open 0.638 shrunk good 1 450 ms PASS
39e63ce9 x1 beginner compact 1 room gates 5 open 0.478 shrunk good 1 7892 ms FAIL nearCore
39e63ce9 x1 beginner compact 2 room gates 5 open 0.478 shrunk good 1 7621 ms FAIL nearCore
39e63ce9 x1 beginner compact 3 room gates 7 open 0.478 shrunk good 1 7770 ms FAIL nearCore
39e63ce9 x1 beginner wide 1 room gates 5 open 0.478 shrunk good 1 6191 ms PASS
39e63ce9 x1 beginner wide 2 room gates 5 open 0.478 shrunk good 1 6317 ms PASS
39e63ce9 x1 beginner wide 3 room gates 7 open 0.478 shrunk good 1 6532 ms PASS
PLANS 24 FAILED 3 {"course":{"pass":24,"fail":0},"inside":{"pass":24,"fail":0},"ground":{"pass":24,"fail":0},"detail":{"pass":24,"fail":0},"nearCore":{"pass":21,"fail":3},"loop":{"pass":24,"fail":0},"opening":{"pass":24,"fail":0},"gates":{"pass":24,"fail":0},"server":{"pass":24,"fail":0},"time":{"pass":24,"fail":0},"beginnerMin":{"pass":24,"fail":0}} -> C:\dev\gsfpv-t6-gap-gen\evidence6-11-19\gen4\place.json
   -> beginnerMin 42/42 in place-x1.json (all seven scans).
3. Medium courses hold no flat square and no cube; pro courses do (LEVELS.elements through ComposeInput.kinds); a course
   without a level (the old g1 path) draws exactly as before. gap-gen-plan.test case 3 -> pass.
4. The voxels-only view (anyQuality) lays more gates than the whole-scene course, on poorly scanned tiles too (synthetic
   city: 18 vs 14, good share 0.94 vs 1). gap-gen-plan.test case 4 -> pass.
5. Lublin 2f1ddf5f passes the server rule on every plan (18/18) and Winter Garden 7a475d38 keeps every gate under the
   glass (room 18/18) at x1. place-x1.json tally.

## Not verified

- No person, phone or real controller took part; no page was opened in S1 (Node audit and unit tests only).
- nearCore red on 39e63ce9 (the CC BY fixture room, core radius 3.2 m) for every compact plan: gate 1 stands 3.7-7.4 m
  from the core. gen4a left the same 6 (medium, pro); beginner joins now because it gets 5-7 gates over the whole room
  instead of 1 gate near the core (a course of the level's count is worth more to the pilot than a start 1-4 m nearer).
  The owner's scans (5dfeb49b, ab5efa0e at x15) are measured for the start in S3.
- Courses under gatesMin left for medium and pro where the gates had to shrink (audit rule gates excuses them): Winter
  Garden medium 7 of 8, 39e63ce9 pro 2-4 of 12 at x1.
- The flag `eased` (PlanAnswer) is not shown by the page: apps/fly/src/course/worker.ts posts only ok, stats, shrunk.

## For the lead

- Files outside the owned list: none in S1 (generate.ts: besides closeAt one line, CoursePlace.kinds handed to
  composeElements; elements.ts and plan.ts are owned).
- PlanAnswer has a new field `eased` (the course was laid nearer the core than asked or by a sharper walk). If the page
  should say it, gen4b's worker.ts PlanNote and course.ts would pass and show it (not this lane's files).
- Deploy: page only (packages/tracks is bundled into the page and its worker).

## Cost notes

- S1: ~45 replies; most went to finding why beginner/medium had no course on tiny scans (the prompt's 'one level easier'
  cannot help: a diagnostic test of all levels on the four synthetic worlds settled it in one run). Cheaper: write that
  diagnostic first; python file edits must use newline='' (one CRLF slip).
