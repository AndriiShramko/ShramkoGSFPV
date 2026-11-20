# Lane gap-gen (train 4, gap lane, plan t6-gaps-plan.md Part B item 1)

Work copy C:/dev/gsfpv-t6-gap-gen, branch gap-gen (from gen4a c8cbfa55). Temp U:/Temp/gsfpv-train4/gap-gen. Ports 6740-6759.
Design: the lane prompt, audit entries generator-1, -3, -4, -5, -10, -13, -14, -15 (t6-audit.json), gen4.md, gen4a.md.
Negative-control ref: the S1 merge of gen4a (5f946305) and gen4b (fb7f6524): 3ef3d4bf.

## Status

- [ ] S1 placement at x1
  - [x] merge gen4a 5f946305 and gen4b fb7f6524 (no conflict; lock unchanged; tracks typecheck ok): 3ef3d4bf
  - [ ] red rules of gen4a run 6 (evidence/2026-11-19/gen4/place.json): gates 6 (70b50d42 beginner seed 3, eb5f51dc
        medium seeds 2-3), nearCore 6 (39e63ce9 medium/pro compact); every other rule 216/216 (server and room already
        green: (b) and (c) need no repair, measured again in place-x1.json)
  - [ ] (a) no NO-ROOM: wide -> compact -> one level easier, flagged
  - [ ] (d) beginner >= gatesMin on 70b50d42, eb5f51dc, ab5efa0e
  - [ ] (e) ComposeInput.kinds, plan.ts passes LEVELS[level].elements
  - [ ] (f) plan.test 'anyQuality: more gates than wide, on poor tiles too'
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
