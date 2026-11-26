# w1-anchor: a generated course grows from the pilot's place (train 5, R1 of w1-diag)

Branch w1-anchor (from w1-diag), work copy C:/dev/gsfpv-t7-n-share. Design: C:/dev/.gsfpv-lanes/designs/w1-diag.md,
sections Cause and Design proposal (R1). Temp folder U:/Temp/gsfpv-train4/w1-anchor.

## Status

- [x] S1 the anchor (points 1 and 2) with unit tests; negative control on origin/main
  - [x] tracks: `CourseRequest.anchor`, `courseAnchor`, `anchorOf` in plan.ts; world `fringeField`; plan.test.ts tests (f6cb45ef)
  - [x] every caller passes its anchor (apps/fly course/anchor.ts `pilotAnchor`, course.ts generate, rooms through the id); bench scripts (9aa499bd)
  - [x] neg_control.py on origin/main: NEG OK twice (anchorOf missing; gate 1 89.8 m from the anchor)
- [x] S2 the link (point 3): request.test.ts round trip, old link gives the old course; measuring gate (eb5f51dc, Lublin, Tunis); gates.py
  - [x] request.test.ts: anchor round trip; old g2 links gate for gate (hashes from origin/main); the share reader keeps a
        negative anchor (flight-link.ts GENERATED took no '-'); NEG OK twice (f911c2c0)
  - [x] measuring gate (w1-diag-measure.ts: eb5f51dc, Lublin, Tunis): passed, numbers in Claims 6 (b78ce85d)
  - [x] gates.py on b78ce85d: architecture, i18n, leaks PASS; typecheck, vitest, b18 FAIL, none from this lane after one
        fix (see Not verified); walls-first.test.ts's source pattern now allows generate's third argument `from`
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
6. On the real scans the course grows from the pilot at the first load (anchor = the spawn), 18 courses each (3 levels x
   2 spreads x 3 seeds), mean splat-density rank of the gates and gate 1's flat distance from the anchor, before (w1-diag
   live, from the core) -> now: eb5f51dc 0.50 -> 0.99, median 540.6 -> 2.1 m, worst 8.1 m; Lublin 2f1ddf5f 0.62 -> 0.96,
   453.5 -> 4.2 m, worst 4.8 m; control Tunis 887f27aa 0.89 -> 0.92, 34.2 -> 4.0 m (6 of 18 start 12-20 m away: medium
   compact, medium wide 1, pro wide 1 and 3); no refusal, no hang, no gate in the walls (Tunis: 6 legs touch walls, as
   before). `cd tools/bench && npx tsx src/w1-diag-measure.ts --scenes eb5f51dc,2f1ddf5f,887f27aa --versions live --out
   U:/Temp/gsfpv-train4/w1-anchor/measure` -> evidence/2026-11-19/w1-anchor/measure-summary.json and gate1-to-anchor.json.

## Not verified

- apps/fly typecheck shows errors only in src/sonic/* (MomentKey, GuideLevel): this copy's packages/sonic-fpv work tree
  stands at 53a56759, not the pin 9ac7876 (not present locally; not fetched); none in a file of this lane.
- gates.py on b78ce85d (logs U:/Temp/gsfpv-gates-20261126-195902): typecheck FAIL only in apps/fly src/sonic/* and vitest
  14 failures only in tests that import @shramko/sonic-fpv (sonic-*, size-flown), the same stale submodule work tree
  (w1-diag recorded the same 14); B18 FAIL names only docs/wip/train5-lead.md (the lead's note, train4-common B18 NOTE).
  The 15th vitest failure, walls-first.test.ts, was this lane's (S1 gave generate a third argument): its pattern is
  fixed and the file passes (23 passed); the gates were not run a second time.
- Tunis: 6 of 18 courses begin 12-20 m from the anchor (the roughness quality rule pulls to rough tiles near it; R3).
- Finding for R3 (not repaired here): with the anchor on a flat open field 10 m off the village the course began 15 m
  from it: the roughness quality rule (tiers 0/2) still pulls the course to rough tiles near the anchor. R3 (a forbid
  map from the splats) removes that pull.

## For the lead

(S3)

Files outside the tracks package and the course feature: apps/fly/src/share/flight-link.ts (one character class: a
generated course's token may hold '-', so a shared link keeps an anchor with a negative coordinate).

## Cost notes

- S1: about 45 replies; most went to reading course.ts's generate paths and tuning the test world (a dense fuzz made one
  solid run, so the village won the core). Cheaper: print analyzeScan's core for a draft world in one script before the tests.
- S2: about 35 replies; the most went to the gates' failures (telling the stale submodule's apart from this lane's) and
  to finding the share reader's regex. Cheaper: grep every course-id pattern (`g[0-9]`, COURSE_RE, TRACK_ID) before
  changing a link's form; the gate for gate hashes cost one scratch script against a copy of origin/main's src.

