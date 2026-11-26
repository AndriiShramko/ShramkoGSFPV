# w1-anchor: a generated course grows from the pilot's place (train 5, R1 of w1-diag)

Branch w1-anchor (from w1-diag), work copy C:/dev/gsfpv-t7-n-share. Design: C:/dev/.gsfpv-lanes/designs/w1-diag.md,
sections Cause and Design proposal (R1). Temp folder U:/Temp/gsfpv-train4/w1-anchor.

## Status

- [ ] S1 the anchor (points 1 and 2) with unit tests; negative control on origin/main
  - [x] tracks: `CourseRequest.anchor`, `courseAnchor`, `anchorOf` in plan.ts; world `fringeField`; plan.test.ts tests (commit: see git log, 'w1-anchor S1: tracks')
  - [ ] every caller of planCourse passes its anchor (apps/fly course.ts, rooms, sound); bench scripts
  - [ ] neg_control.py on origin/main
- [ ] S2 the link (point 3): request.test.ts round trip, old link gives the old course; measuring gate (eb5f51dc, Lublin, Tunis); gates.py
- [ ] S3 acceptance by mouse against a local release build; the same probe against the live site fails its first step

Design differences (the code wins): the anchor lives in `CourseRequest.anchor` (the request is what the link names, what a
stored track's id is made of and what a room race hands to every racer), so `PlanInput.anchor` is `input.request.anchor`;
`anchorOf(input, a)` reads it. The object kind rule (`flat2(p, a.core) <= objR2`) stays round the object: it is the
object's own rule, not a start.

## What the owner does

(S3)

## Claims

(S1-S3)

## Not verified

(S3)

## For the lead

(S3)

## Cost notes

