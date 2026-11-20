# Lane gap-gen (train 4, gap lane, plan t6-gaps-plan.md Part B item 1)

Work copy C:/dev/gsfpv-t6-gap-gen, branch gap-gen (from gen4a c8cbfa55). Temp U:/Temp/gsfpv-train4/gap-gen. Ports 6740-6759.
Design: the lane prompt, audit entries generator-1, -3, -4, -5, -10, -13, -14, -15 (t6-audit.json), gen4.md, gen4a.md.
Negative-control ref: the S1 merge of gen4a (5f946305) and gen4b (fb7f6524): 3ef3d4bf.

## Status

- [ ] S1 placement at x1
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
  - [ ] gen4-place-audit --scenes (touched scans) -> evidence/2026-11-19/gap-gen/place-x1.json
- [ ] S2 race rooms (g2 link through courseFor / parseCourse / CourseJob / adopt; rooms-race style test + NEG)
- [ ] S3 his scale and the acceptance (--enlarged 5dfeb49b,ab5efa0e with plants share and start/finish to core;
      gap-gen-accept.mjs by mouse; live control fails the 5dfeb49b step)

## What the owner does

(filled in S3)

## Claims

(filled per stage)

## Not verified

- No person, phone or real controller took part.

## For the lead

(filled per stage)

## Cost notes
