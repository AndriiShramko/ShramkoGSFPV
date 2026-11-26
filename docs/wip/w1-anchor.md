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
- [x] S3 acceptance by mouse against a local release build; the same probe against the live site fails its first step
  - [x] probe tools/bench/scripts/w1-anchor-accept.mjs (e8f33fa9, 49d76338); local release build of e8f33fa9: 4 of 4 PASS
        (drawn, one picture); live: step 1 FAIL (gate 1 492.6 m from the camera); evidence; dist deleted (this commit)

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

1. Open scan eb5f51dc (the chateau). Click into the scene, press key Shift+G, click Build in the dialog. The note says
   "Gates: 14. The start gate is 3 m away": the gates stand in the sharp courtyard round the place the scene opened at, not
   in the dark fringe 500 m off.
2. Fly away (Space up, W forward) about 30 m, press Escape (the drone stops in the air), click the course item of the menu,
   click Build: the new course starts beside the drone (gate 1 about 4 m from it).
3. Escape, Share: the address ends with `course=g2.<seed>.mc.17.15.-4` (the place, whole metres). Open it in another browser:
   the same gates in the same places.
4. An address shared before this change (`course=g2.<seed>.mc`, no place) still lays the very course it laid before.

Picture U:/Temp/gsfpv-train4/shots/w1-anchor-camera.png (pilot's eye right after step 1 on the local build): the sunny
chateau courtyard, sharp walls and windows, two teal gates within a few metres of the drone and the line "The start gate is
3 m away".

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
7. By the mouse at 1536x730, scale 1.25, pointer locked by a click, on a local release build of e8f33fa9, scan eb5f51dc:
   Shift+G and Build at the load: gate 1 3.3 m from the spawn (mean gate 16 m); flown 30.4 m, paused in the air, the
   menu's course item, Build: gate 1 3.8 m from the drone (34.2 m from the spawn); Share gives
   `course=g2.ery7ej.mc.17.15.-4`; a fresh context lays the same 14 gates to 1 cm. `RENDER=on node
   tools/bench/scripts/w1-anchor-accept.mjs http://localhost:7480/en <out>` -> {"pass":true} (also with render off).
   Negative control, the same probe on https://gsfpv.flyreelstudio.eu/en: step 1 FAIL, gate 1 492.6 m from the camera
   (step 2 FAIL 504.6 m from the drone; step 3 FAIL, `g2.ev43kd.mc` has no place). Read only: the probe aborted only
   POST /api/e and POST /api/share. evidence/2026-11-19/w1-anchor/accept-local.json, accept-live-negative.json.

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
- No person, phone or real controller took part: the acceptance is a headless Chrome driven by the probe (mouse clicks,
  keys). Only scan eb5f51dc was flown in the page; Lublin and Tunis only by the measuring script.
- The work tree is clean but for `packages/sonic-fpv` (its work tree at 53a56759, not the pin; not this lane's, never
  edited here, not committed).
- No text for people was needed: no locale file changed (the dialog's texts are the next lane, w1-dialog).

## For the lead

- A pilot gets: Shift+G (any generate press, the sound mode's too) lays the course round him: at the author's camera when
  parked or just loaded, round the drone when it is in the air or paused there. eb5f51dc by mouse: live gate 1 492.6 m from
  the camera, this build 3.3 m; 30 m away and paused: 3.8 m from the drone; the link lays the same gates elsewhere.
- Numbers (rank of the gates; gate 1 from the anchor, median): eb5f51dc 0.50 -> 0.99, 540.6 -> 2.1 m; Lublin 0.62 -> 0.96,
  453.5 -> 4.2 m; Tunis control 0.89 -> 0.92, 34.2 -> 4.0 m.
- Callers and anchors: the table above (dialog, direct press, sound: the pilot's place; a link or a room: its named anchor;
  an old g2 link: the core as before; g1: the old generator, from the spawn).
- Old links: `g2.<seed>.<ls>` without a place lay the same course gate for gate (hashes from origin/main).
- Files: packages/tracks request.ts, plan.ts, tests; apps/fly course/anchor.ts (new), course.ts, generate-dialog.ts; outside:
  share/flight-link.ts (a course token may hold '-'); tools/bench w1-anchor-accept.mjs, two bench scripts, four tests.
- Deploy: page only. Live check after deploy: tools/bench/scripts/w1-anchor-accept.mjs on the site gives {"pass":true}.
- Not verified: no person or phone; Tunis 6 of 18 start 12-20 m off (R3); gates.py not re-run after S2's one-line fix.

## Cost notes

- S1: about 45 replies; most went to reading course.ts's generate paths and tuning the test world (a dense fuzz made one
  solid run, so the village won the core). Cheaper: print analyzeScan's core for a draft world in one script before the tests.
- S2: about 35 replies; the most went to the gates' failures (telling the stale submodule's apart from this lane's) and
  to finding the share reader's regex. Cheaper: grep every course-id pattern (`g[0-9]`, COURSE_RE, TRACK_ID) before
  changing a link's form; the gate for gate hashes cost one scratch script against a copy of origin/main's src.
- S3: about 30 replies; the most went to finding the keys of easy mode and the hook's fields, and one wasted pair of runs:
  the probe's read-only guard aborted the CDN's HEAD requests, so the scene never loaded. Cheaper: allow GET/HEAD/OPTIONS
  from the start and record the landing state in the first version of a probe.
- Review: about 35 replies; the most went to neg_control.py failing on `npx` (Windows needs `node
  node_modules/vitest/vitest.mjs`) and to a scratch test whose console output vitest hid. Cheaper: call vitest through node
  and write scratch results to a file from the start.

## Review

Verdict: SHIP (independent check, head bc031d1d; full text U:/Temp/gsfpv-train4/reviews/w1-anchor.md).
- No path reaches `a.core` as a start, compact zone or zone box except an old link's (anchor null); the object kind rule
  keeps the core on purpose. The dialog, a direct press and the sound mode read the pilot's place when the job is sent.
- Old g2 links: the same gates on the base and the head (4 links, one with a seed the lane did not use).
- Unit tests 40 passed; NEG OK on the base. Measuring script, seeds 7 and 11: eb5f51dc rank 0.99, gate 1 median 6.1 m,
  worst 12.5 m; Wroclaw 70b50d42 (new scan) rank 0.97, median 3.1 m, worst 8.8 m; no refusal, hang or gate in walls.
- Mouse probe on a local release build: eb5f51dc gate 1 1.9 m from the spawn, 12.3 m from the paused drone 30 m away,
  link and fresh context the same gates; Wroclaw gate 1 12.5 m from the spawn, 3.1 m from the drone, link the same gates.
- DOUBT: gate 1 is not within 10 m for every seed (12.3-12.5 m seen; the live site 490-540 m); the probe's 10 m line fails
  on such seeds. DOUBT: a link's anchor is flown metres, so it depends on the Scene size travelling with the link.
- Repaired: nothing. Not run: gates.py (no repair), the live site, a two-page room race, a drawn run.

