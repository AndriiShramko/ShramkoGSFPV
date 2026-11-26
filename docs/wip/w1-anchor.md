# w1-anchor: a generated course grows from the pilot's place (train 5, R1 of w1-diag)

Branch w1-anchor (from w1-diag), work copy C:/dev/gsfpv-t7-n-share. Design: C:/dev/.gsfpv-lanes/designs/w1-diag.md,
sections Cause and Design proposal (R1). Temp folder U:/Temp/gsfpv-train4/w1-anchor.

## Status

- [x] S1 the anchor (points 1 and 2) with unit tests; negative control on origin/main
  - [x] tracks: `CourseRequest.anchor`, `courseAnchor`, `anchorOf` in plan.ts; world `fringeField`; plan.test.ts tests (f6cb45ef)
  - [x] every caller passes its anchor (apps/fly course/anchor.ts `pilotAnchor`, course.ts generate, rooms through the id); bench scripts (9aa499bd)
  - [x] neg_control.py on origin/main: NEG OK twice (anchorOf missing; gate 1 89.8 m from the anchor)
- [ ] S2 the link (point 3): request.test.ts round trip, old link gives the old course; measuring gate (eb5f51dc, Lublin, Tunis); gates.py
  - [x] request.test.ts: anchor round trip; old g2 links gate for gate (hashes from origin/main); the share reader keeps a
        negative anchor (flight-link.ts GENERATED took no '-'); NEG OK twice
  - [ ] measuring gate (w1-diag-measure.ts: eb5f51dc, Lublin, Tunis)
  - [ ] gates.py
- [ ] S3 acceptance by mouse against a local release build; the same probe against the live site fails its first step

Design differences (the code wins): the anchor lives in `CourseRequest.anchor` (the request is what the link names, what a
stored track's id is made of and what a room race hands to every racer), so `PlanInput.anchor` is `input.request.anchor`;
`anchorOf(input, a)` reads it. The object kind rule (`flat2(p, a.core) <= objR2`) stays round the object: it is the
object's own rule, not a start.

### Callers and the anchor each passes (point 2)

| caller | path | anchor |
|---|---|---|
| Shift+G, the pause menu item, the editor's G: the dialog's main button | course.ts `build` -> `generate(seed)` -> worker -> planCourse | `pilotAnchor` read when the job is sent (after a resize and the walls): the spawn when parked on it, else the drone |
| a direct press (pressAction 'direct'), Shift+T with no course and none saved, the editor with no course, the no-room box's press | course.ts `generate(seed)` | the same `pilotAnchor` |
| the course made at the first load: a `g2.` link in the address (`tryLink`) | course.ts `generate(seed, 'request', named)` | the link's anchor; an old link without one: null, laid from the core as before (no other path reads null) |
| no link at the first load | nothing is generated until a press; the drone is then parked on the spawn | the spawn (the author's camera) |
| the sound mode's courses (hook.sound.generate, Fly by Sound's N) | course.ts `generate(pressSeed())` | `pilotAnchor` |
| sonic/course-ask.ts `askCourse` | no caller in apps/fly; it sends no request, so the worker takes the old path | none (the spawn, old generator; not planCourse) |
| the legacy `g1.` branch (an old `g1.` link, a room's `g1.` course) | course.ts `generate(seed, 'legacy')` -> worker's old path | none: the old generator grows from the spawn as it did; not planCourse |
| a room race: hook.adopt and rooms/race-page.ts `generate(seed, request)` | the host's `g2.` id parsed (rooms/race.ts parseCourse) | the host's anchor carried in the id; every racer lays it from there |
| bench: w1-diag-measure.ts | planCourse | `courseAnchor(spawn)` (the pilot at the first load) |
| bench: gen4-place-audit.ts | planCourse | null: its spawn was the core; it measures as before |

### Old links (point 3)

A `g2.` link of the old form names no anchor: `parseCourseLink` gives `anchor: null`, and `anchorOf` then answers the
analysis core, the very place planCourse walked from before; nothing else in the plan reads the anchor. A link made now
carries the anchor, whole flown metres, `g2.<seed>.<level><spread>.<x>.<y>.<z>` (at most 37 characters: within TRACK_ID's 80
and the rooms' COURSE_RE 64); a stored track's id is that link (plan.ts `id: courseLinkId(request)`), so it carries the
anchor too. Proof: request.test.ts lays three old links (a room, a city, the fringe world) and compares every gate's
pos, quat and shape with hashes taken from origin/main's planCourse: equal. `g1.` links never reach planCourse.

## What the owner does

(S3)

## Claims

1. On a world whose roughest corner (the analysis core) lies 60 m and more from the author's camera, gate 1 lies within
   10 m of the anchor on every level for seeds 1, 2, 3, and no gate within 30 m of the core; with the anchor moved 28 m
   the course moves with it. `npx vitest run packages/tracks/test/plan.test.ts` -> 29 passed (45 s). On origin/main:
   `neg_control.py ... -t "within 10 m of the anchor"` -> NEG OK (gate 1 89.8 m from the anchor).
2. The page's anchor is the spawn when parked on it, else the drone (paused in the air too), whole metres, and it
   survives the link. `npx vitest run tools/bench/test/w1-anchor.test.ts` -> 3 passed; NEG OK (no anchor.ts on origin/main).
3. The touched tests hold: `npx vitest run tools/bench/test/w1-anchor.test.ts tools/bench/test/course-progress.test.ts
   tools/bench/test/gap-gen-race.test.ts tools/bench/test/generate-dialog.test.ts packages/tracks/test/request.test.ts
   packages/tracks/test/gap-gen-plan.test.ts` -> 6 files, 43 passed.

4. A link with an anchor round-trips (every level and spread, negative and far places, -0 as 0, at most 64 characters;
   half an anchor refused), and an old `g2.` link lays the same course as origin/main, gate for gate.
   `npx vitest run packages/tracks/test/request.test.ts` -> passed; NEG OK on origin/main (`-t "with an anchor round-trips"`).
5. A shared link keeps a course whose anchor is negative: a fresh browser reads `course=g2.2r.mc.12.-3.-540` as that course.
   `npx vitest run tools/bench/test/w1-anchor.test.ts -t "shared link"` -> passed; NEG OK on origin/main (readFlightLink
   gave course null: the share reader's GENERATED took no '-').

## Not verified

- apps/fly typecheck shows errors only in src/sonic/* (MomentKey, GuideLevel): this copy's packages/sonic-fpv work tree
  stands at 53a56759, not the pin 9ac7876 (not present locally; not fetched); none in a file of this lane.
- Finding for R3 (not repaired here): with the anchor on a flat open field 10 m off the village the course began 15 m
  from it: the roughness quality rule (tiers 0/2) still pulls the course to rough tiles near the anchor. R3 (a forbid
  map from the splats) removes that pull.

## For the lead

(S3)

## Cost notes

- S1: about 45 replies; most went to reading course.ts's generate paths and tuning the test world (a dense fuzz made one
  solid run, so the village won the core). Cheaper: print analyzeScan's core for a draft world in one script before the tests.

